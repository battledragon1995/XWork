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
    "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <main
      className="flex h-dvh min-w-0 flex-col bg-background text-foreground"
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
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
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
          <h1 className="font-semibold">XWork / Quick Note</h1>
          <span className="text-xs text-muted-foreground">Esc cancel</span>
        </div>
        <Button variant="ghost" disabled={busy} aria-label="Close Quick Note" onClick={close}>
          ×
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-busy={busy}>
        <label className="space-y-1">
          Title (optional)
          <input
            ref={titleInput}
            className={inputClass}
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
        <label className="flex min-h-32 flex-1 flex-col gap-1">
          Markdown
          <textarea
            ref={bodyInput}
            className={`${inputClass} min-h-28 flex-1 resize-none`}
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
        <label>
          Project
          <select
            className={inputClass}
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
        {projectPhase === "loading" && <p role="status">Loading projects…</p>}
        {projectPhase === "error" && <p role="alert">Could not load projects.</p>}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={
            /** Refresh without replacing the chosen project or draft. */ () =>
              setRefresh(refresh + 1)
          }
        >
          Refresh projects
        </Button>
        <p className="text-xs text-muted-foreground">
          Markdown supported. Saved notes appear in Notes and on the linked project.
        </p>
        {message && <p role="alert">{message}</p>}
        <footer className="flex flex-wrap justify-end gap-2">
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
      </div>
    </main>
  );
}
