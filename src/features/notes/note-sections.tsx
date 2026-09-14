import { Link } from "react-router";
import type { NotePinnedFilterDto } from "@/bindings/notes";
import { Button } from "@/components/ui/button";
import { useNotesQuery } from "./notes-provider";

/** Render one independently recoverable bounded server projection. */
function NoteSection({
  title,
  limit,
  pinnedFilter,
  projectId,
  home = false,
}: {
  title: string;
  limit: number;
  pinnedFilter: NotePinnedFilterDto;
  projectId?: string;
  home?: boolean;
}) {
  const query = useNotesQuery({
    status: "active",
    query: null,
    projectFilter: projectId ? { kind: "project", projectId } : { kind: "all" },
    pinnedFilter,
    offset: 0,
    limit,
  });
  const suffix = projectId ? `&projectId=${encodeURIComponent(projectId)}` : "";
  const empty = !query.loading && !query.error && !query.page?.items.length;
  if (home && pinnedFilter === "only" && empty) return null;
  return (
    <section aria-label={title} className="min-w-0 space-y-3" aria-busy={query.loading}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted">
          {home && empty ? "Notes" : title}
        </h2>
        <div className="flex items-center gap-3 text-xs text-brand">
          <Link to={`/notes?view=active${suffix}`}>All notes</Link>
          {projectId && <Link to={`/notes?new=1${suffix}`}>New note</Link>}
        </div>
      </div>
      {query.loading && <p role="status">Loading notes…</p>}
      {query.error && <p role="alert">{query.error}</p>}
      {empty && (
        <div className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center">
          <p className="font-display text-xl text-ink">No notes yet</p>
          {home && (
            <p className="mt-1 text-xs text-muted">
              Capture a thought above. Your notes will appear here.
            </p>
          )}
        </div>
      )}
      <ul className={home ? "grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2" : "space-y-2"}>
        {query.page?.items.map(
          /** Preserve server ordering and stable row identity. */ (note) => (
            <li key={note.id}>
              <Link
                className="block rounded-lg border border-hairline p-4 focus-visible:ring-2 focus-visible:ring-ring"
                to={`/notes?noteId=${encodeURIComponent(note.id)}&view=active`}
              >
                <span className="block font-medium">{note.title || "Untitled note"}</span>
                <span className="block whitespace-pre-wrap break-words text-sm text-muted">
                  {note.snippet}
                </span>
              </Link>
            </li>
          ),
        )}
      </ul>
      <div className="flex flex-wrap gap-3">
        {query.error && (
          <Button variant="outline" onClick={query.refresh}>
            Refresh
          </Button>
        )}
      </div>
    </section>
  );
}
/** Compose the two distinct Home caps without mixing pin groups. */
export function HomeNoteSections() {
  return (
    <div className="space-y-6">
      <NoteSection title="Pinned notes" limit={2} pinnedFilter="only" home />
      <NoteSection title="Recent notes" limit={3} pinnedFilter="exclude" home />
    </div>
  );
}
/** Project composition receives only the loaded public project identity. */
export function ProjectNotesSection({ projectId }: { projectId: string }) {
  return <NoteSection title="Linked notes" limit={5} pinnedFilter="any" projectId={projectId} />;
}
