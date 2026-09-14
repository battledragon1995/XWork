import { Folder, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NoteDto } from "@/bindings/notes";
import type { ProjectDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { createNote } from "@/lib/ipc/notes";
import { listProjects } from "@/lib/ipc/projects";
import { closeQuickNoteWindow, startQuickNoteWindowDrag } from "@/lib/ipc/quick-note-window";
import { noteErrorCopy } from "./note-error-copy";

/** Render one isolated manually saved native Quick Note instance. */
export function QuickNoteWindow(): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectPhase, setProjectPhase] = useState("loading");
  const [refresh, setRefresh] = useState(0);
  const [phase, setPhase] = useState("editing");
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<{ title?: string; body?: string }>({});
  const live = useRef(false);
  const flight = useRef(false);
  const committed = useRef<NoteDto | null>(null);
  const composing = useRef(false);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(
    /** Own only this renderer lifetime and initial capture focus. */ () => {
      live.current = true;
      bodyInput.current?.focus();
      return /** Retire asynchronous completions after native destruction. */ () => {
        live.current = false;
      };
    },
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit refresh starts a fresh project snapshot.
  useEffect(
    /** Load choices independently of main providers. */ () => {
      let current = true;
      setProjectPhase("loading");
      void listProjects()
        .then(
          /** Publish only the current query. */ (rows) => {
            if (current) {
              setProjects(rows);
              setProjectPhase("ready");
            }
          },
        )
        .catch(
          /** Keep unlinked capture available on read failure. */ () => {
            if (current) setProjectPhase("error");
          },
        );
      return /** Ignore retired project queries. */ () => {
        current = false;
      };
    },
    [refresh],
  );
  /** Close without recreating an acknowledged note. */
  async function close() {
    if (flight.current || composing.current) return;
    flight.current = true;
    setPhase("closing");
    setMessage(null);
    try {
      await closeQuickNoteWindow();
    } catch {
      if (live.current) {
        setPhase("close-error");
        setMessage(
          committed.current
            ? "Note saved, but the window could not close."
            : "The window could not close. Your draft is still here.",
        );
      }
    } finally {
      flight.current = false;
    }
  }
  /** Admit one explicit create and remember its acknowledgement before closing. */
  async function save() {
    if (flight.current || committed.current || phase === "uncertain" || composing.current) return;
    const errors: typeof invalid = {};
    if (
      Array.from(title.trim()).length > 255 ||
      Array.from(title).some(
        /** Match backend title control limits. */ (char) => {
          const point = char.codePointAt(0) ?? 0;
          return point < 32 || (point >= 127 && point <= 159);
        },
      )
    )
      errors.title = "Use at most 255 characters without control characters.";
    if (!body.trim()) errors.body = "Write a note before saving.";
    else if (new TextEncoder().encode(body).length > 1048576)
      errors.body = "Keep Markdown within 1 MiB.";
    setInvalid(errors);
    if (errors.title || errors.body) {
      (errors.title ? titleInput : bodyInput).current?.focus();
      return;
    }
    flight.current = true;
    setPhase("saving");
    setMessage(null);
    try {
      const note = await createNote({ title, contentMarkdown: body, projectId });
      committed.current = note;
      if (!live.current) return;
      flight.current = false;
      await close();
    } catch (error) {
      if (live.current) {
        const known = error instanceof IpcCallError && error.payload !== null;
        setPhase(known ? "error" : "uncertain");
        setMessage(
          known
            ? noteErrorCopy(error)
            : "Could not confirm creation. Check Notes in the main window before creating another note.",
        );
      }
    } finally {
      flight.current = false;
    }
  }
  const busy = phase === "saving" || phase === "closing";
  const readonly = phase === "uncertain" || committed.current !== null;
  const inputClass =
    "w-full min-w-0 border-0 bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted-soft focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";
  return (
    <main
      className="flex h-[calc(100dvh/var(--ui-scale))] min-w-0 flex-col overflow-hidden bg-background text-foreground"
      onCompositionStart={
        /** Guard all explicit actions during IME composition. */ () => {
          composing.current = true;
        }
      }
      onCompositionEnd={
        /** Admit actions once IME commits. */ () => {
          composing.current = false;
        }
      }
      onKeyDown={
        /** Escape discards only an idle local draft. */ (event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && !composing.current) {
            event.preventDefault();
            void close();
          }
        }
      }
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-1.5">
        <div
          className="flex flex-1 items-center gap-3 select-none"
          onPointerDown={
            /** Drag only the primary pointer on the noninteractive titlebar. */ (event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              void startQuickNoteWindowDrag().catch(
                /** Preserve capture when native dragging fails. */ () => {
                  if (live.current) setMessage("Could not move the window. Try again.");
                },
              );
            }
          }
        >
          <span className="font-display text-xl text-ink" aria-hidden="true">
            <span className="text-brand">X</span>Work
          </span>
          <h1 className="text-xs text-muted">Quick Note</h1>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          <kbd className="rounded border border-hairline px-1 font-mono">Esc</kbd> cancel
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label="Close Quick Note"
          onClick={close}
        >
          <X aria-hidden="true" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-2" aria-busy={busy}>
        <label className="shrink-0">
          <span className="sr-only">Title (optional)</span>
          <input
            ref={titleInput}
            className={`${inputClass} font-display text-[24px] text-ink`}
            placeholder="Title (optional)"
            value={title}
            disabled={busy}
            readOnly={readonly}
            aria-invalid={!!invalid.title}
            onChange={
              /** Retain the raw manual title. */ (event) => {
                setTitle(event.target.value);
                setInvalid({});
              }
            }
          />
        </label>
        {invalid.title && <p role="alert">{invalid.title}</p>}
        <label className="flex min-h-20 flex-1 flex-col">
          <span className="sr-only">Markdown</span>
          <textarea
            ref={bodyInput}
            className={`${inputClass} min-h-20 flex-1 resize-none leading-relaxed`}
            placeholder="Write a note… Markdown works here."
            value={body}
            disabled={busy}
            readOnly={readonly}
            aria-invalid={!!invalid.body}
            onChange={
              /** Retain verbatim Markdown without autosave. */ (event) => {
                setBody(event.target.value);
                setInvalid({});
              }
            }
          />
        </label>
        {invalid.body && <p role="alert">{invalid.body}</p>}
        {projectPhase === "loading" && (
          <p role="status" className="sr-only">
            Loading projects…
          </p>
        )}
        {(projectPhase === "error" || phase === "error") && (
          <div className="px-4 py-2 text-xs">
            {projectPhase === "error" && <p role="alert">Could not load projects.</p>}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={
                /** Retry project loading without replacing the local capture. */ () =>
                  setRefresh(refresh + 1)
              }
            >
              Refresh projects
            </Button>
          </div>
        )}
        {message && (
          <p role="alert" className="px-4 py-2 text-sm">
            {message}
          </p>
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
        <label className="mr-auto flex min-w-0 max-w-48 items-center gap-1.5 rounded-md bg-surface-soft px-2 text-xs">
          <Folder aria-hidden="true" className="size-3 shrink-0" />
          <span className="sr-only">Project</span>
          <select
            className="h-7 min-w-0 max-w-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={projectId ?? ""}
            disabled={busy || readonly}
            onChange={
              /** Preserve the selected opaque identity. */ (event) =>
                setProjectId(event.target.value || null)
            }
          >
            <option value="">No project</option>
            {projectId &&
              !projects.some(
                /** Keep removed choices visible. */ (project) => project.id === projectId,
              ) && <option value={projectId}>Project unavailable</option>}
            {projects.map(
              /** Include registered unavailable projects. */ (project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                  {project.availability.status === "unavailable" ? " (unavailable)" : ""}
                </option>
              ),
            )}
          </select>
        </label>
        {phase === "close-error" ? (
          <Button onClick={close}>Retry Close</Button>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button disabled={busy || readonly} onClick={save}>
              {phase === "saving" ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </footer>
    </main>
  );
}
