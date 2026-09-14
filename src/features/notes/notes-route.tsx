import { Archive, Folder, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { NoteStatusDto, NoteSummaryDto, NoteTextRangeDto } from "@/bindings/notes";
import { Button } from "@/components/ui/button";
import { listProjects } from "@/lib/ipc/projects";
import { EmptyTrash, useNoteProjects } from "./note-actions";
import { NoteEditor } from "./note-editor";
import { noteErrorCopy } from "./note-error-copy";
import { useNotes, useNotesQuery } from "./notes-provider";

interface Filters {
  query: string;
  project: string;
  pinned: boolean;
}
const CLEAR: Filters = { query: "", project: "", pinned: false };
/** Render backend scalar ranges without HTML interpretation or UTF-16 slicing. */
export function NoteHighlight({ text, ranges }: { text: string; ranges: NoteTextRangeDto[] }) {
  const scalars = Array.from(text);
  return (
    <>
      {scalars.map(
        /** Mark only backend-selected scalar indices. */ (value, index) =>
          ranges.some((range) => index >= range.startScalar && index < range.endScalar) ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: scalar positions are immutable text coordinates, not stateful rows.
            <mark key={`${index}-${value}`}>{value}</mark>
          ) : (
            value
          ),
      )}
    </>
  );
}
/** Render Notes filters, authoritative pagination and the retained editor. */
export function NotesRoute() {
  const { owner, draft, epoch, blocked, actionBusy, listenerFailed } = useNotes();
  const [params, setParams] = useSearchParams();
  const viewParam = params.get("view");
  const view: NoteStatusDto =
    viewParam === "archived" || viewParam === "trash" ? viewParam : "active";
  const [filters, setFilters] = useState<Record<NoteStatusDto, Filters>>({
    active: { ...CLEAR, project: params.get("projectId") ?? "" },
    archived: { ...CLEAR },
    trash: { ...CLEAR },
  });
  const filter = filters[view];
  const [search, setSearch] = useState(filter.query);
  const composing = useRef(false);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<NoteSummaryDto[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectionRetry, setSelectionRetry] = useState(0);
  const { projects, error: projectsError } = useNoteProjects();
  const requested = params.toString();
  const rowKey = JSON.stringify([view, filter, epoch]);
  const lastKey = useRef(rowKey);
  const staleRows = lastKey.current !== rowKey;
  const query = useNotesQuery(
    {
      status: view,
      query: filter.query || null,
      projectFilter:
        filter.project === "unlinked"
          ? { kind: "unlinked" }
          : filter.project
            ? { kind: "project", projectId: filter.project }
            : { kind: "all" },
      pinnedFilter: filter.pinned ? "only" : "any",
      offset: staleRows ? 0 : offset,
      limit: 50,
    },
    150,
  );
  useEffect(
    /** Reset pagination on every query or invalidation lifetime. */ () => {
      lastKey.current = rowKey;
      setOffset(0);
      setRows([]);
    },
    [rowKey],
  );
  useEffect(
    /** Append server pages by ID while preserving server order. */ () => {
      if (!query.page || query.loading || query.error) return;
      const page = query.page;
      setRows((previous) =>
        page.offset === 0
          ? page.items
          : [
              ...previous,
              ...page.items.filter((item) => !previous.some((existing) => existing.id === item.id)),
            ],
      );
    },
    [query.page, query.loading, query.error],
  );
  useEffect(
    /** Keep each lifecycle's independent search text. */ () => {
      setSearch(filters[view].query);
    },
    [view, filters],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: serialized URL and explicit retry own selection admission.
  useEffect(
    /** Validate route input before creating a local entry draft. */ () => {
      let live = true;
      const noteId = params.get("noteId");
      const isNew = params.get("new");
      const projectId = params.get("projectId");
      const invalid =
        (viewParam !== null && !["active", "archived", "trash"].includes(viewParam)) ||
        (isNew !== null && isNew !== "1") ||
        (!!isNew && !!noteId) ||
        ["noteId", "new", "view", "projectId"].some((key) => params.getAll(key).length > 1) ||
        noteId === "" ||
        projectId === "";
      if (invalid) {
        setSelectionError("This Notes link is invalid.");
        return;
      }
      if (!noteId && !isNew) return;
      if (isNew && owner.state.draft && !owner.state.draft.base) return;
      /** Resolve the requested target without replacing an unresolved retained draft. */
      async function select() {
        try {
          if (isNew && projectId) {
            const list = await listProjects();
            if (!list.some((project) => project.id === projectId))
              throw new Error("Project unavailable");
          }
          if (!live) return;
          await owner.select(noteId, projectId);
          if (live) setSelectionError(null);
        } catch (failure) {
          if (live) setSelectionError(owner.state.draft?.message ?? noteErrorCopy(failure));
        }
      }
      void select();
      return () => {
        live = false;
        ++owner.selection;
      };
    },
    [requested, selectionRetry, owner],
  );
  useEffect(
    /** Reflect acknowledged creation or lifecycle changes only for the current draft route. */ () => {
      if (!draft?.base || selectionError) return;
      const id = params.get("noteId");
      if (id === draft.base.id || (params.get("new") === "1" && !id)) {
        const next = new URLSearchParams(params);
        next.delete("new");
        next.set("noteId", draft.base.id);
        next.set("view", draft.base.status);
        if (next.toString() !== params.toString()) setParams(next, { replace: true });
      }
    },
    [draft?.base, params, setParams, selectionError],
  );
  /** Change one filter while retiring obsolete pages synchronously at render. */
  function change(patch: Partial<Filters>) {
    setFilters((previous) => ({ ...previous, [view]: { ...previous[view], ...patch } }));
  }
  /** Change list context while retaining the provider-owned draft. */
  function changeView(status: NoteStatusDto) {
    const next = new URLSearchParams(params);
    next.set("view", status);
    next.delete("new");
    next.delete("noteId");
    setParams(next);
  }
  /** Start a new local draft only after the retained edit can settle. */
  async function newNote() {
    try {
      await owner.select(
        null,
        filter.project && filter.project !== "unlinked" ? filter.project : null,
      );
      setSelectionError(null);
      setParams({ new: "1", view: "active" });
    } catch (failure) {
      setSelectionError(owner.state.draft?.message ?? noteErrorCopy(failure));
    }
  }
  return (
    <div className="flex h-full min-w-0 flex-col overflow-auto lg:flex-row">
      <aside
        aria-label="Notes list"
        className="flex max-h-[45vh] shrink-0 flex-col gap-3 border-b border-hairline p-3 lg:max-h-none lg:w-[280px] lg:border-r lg:border-b-0"
      >
        <div className="flex items-center gap-2">
          <h1 tabIndex={-1} className="sr-only">
            Notes
          </h1>
          <Button
            className="order-2 shrink-0"
            size="icon-sm"
            variant="ghost"
            aria-label="New note"
            title="New note"
            onClick={newNote}
            disabled={blocked || actionBusy}
          >
            <Plus aria-hidden="true" />
          </Button>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search notes</span>
            <Search aria-hidden="true" className="absolute top-2 left-2 size-3.5 text-muted" />
            <input
              aria-label="Search notes"
              placeholder="Search notes"
              value={search}
              onCompositionStart={
                /** Keep incomplete IME text out of search. */ () => {
                  composing.current = true;
                }
              }
              onCompositionEnd={
                /** Admit the committed search text. */ (event) => {
                  composing.current = false;
                  change({ query: event.currentTarget.value });
                }
              }
              onChange={
                /** Debounce committed queries at the query owner. */ (event) => {
                  setSearch(event.target.value);
                  if (!composing.current) change({ query: event.target.value });
                }
              }
              className="h-8 w-full rounded-md border border-hairline bg-transparent pr-2 pl-7 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            aria-label="All notes"
            aria-pressed={view === "active" && !filter.pinned && !filter.project}
            className="h-7 px-2 aria-pressed:bg-surface-card"
            onClick={
              /** Return to active notes with unrestricted pin/project scope. */ () => {
                setFilters((previous) => ({
                  ...previous,
                  active: { ...previous.active, pinned: false, project: "" },
                }));
                changeView("active");
              }
            }
          >
            All
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label="Pinned only"
            aria-pressed={filter.pinned}
            className="h-7 px-2 aria-pressed:bg-surface-card"
            onClick={
              /** Toggle the existing combined pin filter. */ () =>
                change({ pinned: !filter.pinned })
            }
          >
            Pinned
          </Button>
          <label className="flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md border border-hairline px-2 text-xs">
            <Folder aria-hidden="true" className="size-3 shrink-0" />
            <span className="sr-only">Project filter</span>
            <select
              aria-label="Project filter"
              className="min-w-0 max-w-32 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filter.project}
              onChange={
                /** Send the chosen public filter. */ (event) =>
                  change({ project: event.target.value })
              }
            >
              <option value="">Project</option>
              <option value="unlinked">No project</option>
              {filter.project &&
                filter.project !== "unlinked" &&
                !projects.some((project) => project.id === filter.project) && (
                  <option value={filter.project}>Project unavailable</option>
                )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(filter.query || filter.project || filter.pinned) && (
          <Button
            variant="outline"
            onClick={/** Reset only this lifecycle's filters. */ () => change(CLEAR)}
          >
            Clear filters
          </Button>
        )}
        {projectsError && <p role="alert">Could not load projects.</p>}
        {listenerFailed && <p role="alert">Live updates unavailable</p>}
        {query.error && <p role="alert">{query.error}</p>}
        {view === "trash" && <EmptyTrash disabled={!query.page?.counts.trash} />}
        {selectionError && (
          <p role="alert">
            {selectionError}{" "}
            <Button
              onClick={
                /** Retry a target only after resolving the current draft. */ () =>
                  setSelectionRetry((value) => value + 1)
              }
            >
              Retry selection
            </Button>
          </p>
        )}
        <div aria-busy={query.loading} className="min-h-0 flex-1 overflow-auto">
          {query.loading && <p role="status">Loading notes…</p>}
          {!query.loading && !query.error && rows.length === 0 && (
            <p>
              {filter.query || filter.project || filter.pinned
                ? "No matching notes"
                : view === "active"
                  ? "No notes yet"
                  : view === "archived"
                    ? "Archive is empty"
                    : "Trash is empty"}
            </p>
          )}
          <ul className="space-y-2">
            {!staleRows &&
              rows.map((note, index) => (
                <li key={note.id}>
                  {view === "active" &&
                    !filter.query &&
                    (index === 0 || rows[index - 1]?.isPinned !== note.isPinned) && (
                      <h2 className="my-2 text-sm font-semibold">
                        {note.isPinned ? "Pinned" : "Recent"}
                      </h2>
                    )}
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-2.5 text-left outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-surface-card"
                    aria-pressed={draft?.base?.id === note.id}
                    disabled={blocked || actionBusy}
                    onClick={
                      /** Select through the route's serialized detail admission. */ () =>
                        setParams({ noteId: note.id, view: note.status })
                    }
                  >
                    <span className="block font-medium">
                      <NoteHighlight
                        text={note.title || "Untitled note"}
                        ranges={note.titleHighlights}
                      />
                    </span>
                    <span className="block whitespace-pre-wrap break-words text-sm text-muted">
                      <NoteHighlight text={note.snippet} ranges={note.snippetHighlights} />
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          {query.page?.hasMore && (
            <Button
              disabled={query.loading}
              onClick={
                /** Advance by received items even when duplicate IDs were suppressed. */ () =>
                  setOffset((query.page?.offset ?? 0) + (query.page?.items.length ?? 0))
              }
            >
              Load more
            </Button>
          )}
        </div>
        <nav className="shrink-0 border-t border-hairline pt-2" aria-label="Note lifecycle">
          {(["archived", "trash"] as const).map(
            /** Keep secondary lifecycle navigation at the list footer. */ (status) => (
              <Button
                key={status}
                size="sm"
                variant="ghost"
                className="w-full justify-start aria-pressed:bg-surface-card"
                aria-pressed={view === status}
                onClick={
                  /** Keep the retained draft out of an unrelated list context. */ () =>
                    changeView(status)
                }
              >
                {status === "archived" ? (
                  <Archive aria-hidden="true" />
                ) : (
                  <Trash2 aria-hidden="true" />
                )}
                {status === "archived" ? "Archive" : "Trash"}
                <span className="ml-auto text-xs text-muted">
                  {query.page?.counts[status] ?? ""}
                </span>
              </Button>
            ),
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh"
            title="Refresh notes"
            onClick={owner.invalidate}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </nav>
      </aside>
      {(
        view === "active"
          ? !draft?.base || draft.base.status === "active"
          : draft?.base?.status === view && params.get("noteId") === draft.base.id
      ) ? (
        <NoteEditor />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted">
          {view === "archived"
            ? "Select an archived note to view it"
            : view === "trash"
              ? "Select a note in Trash to view it"
              : "Select a note or create a new one"}
        </div>
      )}
    </div>
  );
}
