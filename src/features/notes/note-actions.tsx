import { useEffect, useRef, useState } from "react";
import type { EmptyNotesTrashImpactDto, NotesError } from "@/bindings/notes";
import type { ProjectDto } from "@/bindings/projects/projects";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as ipc from "@/lib/ipc/notes";
import { listProjects } from "@/lib/ipc/projects";
import { noteErrorCopy } from "./note-error-copy";
import { useNotes } from "./notes-provider";
/** Read project choices by public identity without dropping unavailable projects. */
export function useNoteProjects() {
  const { epoch } = useNotes();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [error, setError] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch invalidates project labels and FK links.
  useEffect(
    /** Retire project reads on Notes or FK invalidation. */ () => {
      let live = true;
      void listProjects()
        .then(
          /** Publish the current project choices. */ (result) => {
            if (live) {
              setProjects(result);
              setError(false);
            }
          },
        )
        .catch(
          /** Keep the current selection recoverable. */ () => {
            if (live) setError(true);
          },
        );
      return () => {
        live = false;
      };
    },
    [epoch],
  );
  return { projects, error };
}
/** Apply revision-checked lifecycle and metadata actions after the latest text flush. */
export function NoteActions() {
  const { owner, draft, blocked, actionBusy } = useNotes();
  const { projects, error } = useNoteProjects();
  const [copy, setCopy] = useState(false);
  if (!draft) return null;
  const base = draft.base;
  const active = !base || base.status === "active";
  const disabled = blocked || actionBusy || draft.phase === "saving";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {active && (
        <label>
          Project{" "}
          <select
            aria-label="Note project"
            disabled={disabled}
            value={draft.projectId ?? ""}
            onChange={
              /** Link only the explicitly selected project. */ (event) => {
                const projectId = event.target.value || null;
                if (!base) owner.edit({ projectId });
                else
                  void owner.mutate(
                    /** Use the revision acknowledged by the preceding flush. */ (current) =>
                      ipc.setNoteProject({
                        noteId: current.id,
                        expectedRevision: current.revision,
                        projectId,
                      }),
                  );
              }
            }
          >
            <option value="">No project</option>
            {draft.projectId &&
              !projects.some(
                /** Keep removed choices explicit until authoritative refresh. */ (project) =>
                  project.id === draft.projectId,
              ) && <option value={draft.projectId}>Project unavailable</option>}
            {projects.map(
              /** Include unavailable registered projects as valid links. */ (project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                  {project.availability.status === "unavailable" ? " (unavailable)" : ""}
                </option>
              ),
            )}
          </select>
        </label>
      )}
      {error && (
        <span role="alert">
          Could not load projects. <Button onClick={owner.invalidate}>Refresh</Button>
        </span>
      )}
      {base && active && (
        <>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={
              /** Toggle the pin against the latest revision. */ () => {
                void owner.mutate((current) =>
                  ipc.setNotePinned({
                    noteId: current.id,
                    expectedRevision: current.revision,
                    pinned: !current.isPinned,
                  }),
                );
              }
            }
          >
            {base.isPinned ? "Unpin" : "Pin"}
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={
              /** Archive after saving admitted text. */ () => {
                void owner.mutate((current) =>
                  ipc.archiveNote({ noteId: current.id, expectedRevision: current.revision }),
                );
              }
            }
          >
            Archive
          </Button>
        </>
      )}
      {base && base.status !== "trash" && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={
            /** Move the selected record into Trash. */ () => {
              void owner.mutate((current) =>
                ipc.moveNoteToTrash({ noteId: current.id, expectedRevision: current.revision }),
              );
            }
          }
        >
          Move to Trash
        </Button>
      )}
      {base && base.status !== "active" && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={
            /** Restore using the server-owned previous lifecycle. */ () => {
              void owner.mutate((current) =>
                (current.status === "trash" ? ipc.restoreNoteFromTrash : ipc.restoreArchivedNote)({
                  noteId: current.id,
                  expectedRevision: current.revision,
                }),
              );
            }
          }
        >
          Restore
        </Button>
      )}
      {base?.status === "trash" && (
        <Button
          variant="destructive"
          disabled={disabled}
          onClick={
            /** Delete precisely one explicitly chosen Trash record. */ () => {
              void owner.mutate(async (current) => {
                await ipc.deleteNotePermanently({
                  noteId: current.id,
                  expectedRevision: current.revision,
                });
                return null;
              });
            }
          }
        >
          Delete permanently
        </Button>
      )}
      <Button
        variant="outline"
        onClick={/** Expose raw Markdown for native text selection. */ () => setCopy(!copy)}
      >
        Copy Markdown
      </Button>
      {copy && (
        <label className="w-full">
          Select and copy Markdown
          <textarea
            aria-label="Copy Markdown"
            readOnly
            value={draft.contentMarkdown}
            className="block min-h-32 w-full border border-hairline p-3"
          />
        </label>
      )}
    </div>
  );
}
/** Require a fresh explicit confirmation for each authoritative Trash impact. */
export function EmptyTrash({ disabled }: { disabled: boolean }) {
  const { owner, blocked, actionBusy } = useNotes();
  const [impact, setImpact] = useState<EmptyNotesTrashImpactDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const request = useRef<EmptyNotesTrashImpactDto | null>(null);
  request.current = impact;
  /** Cancel only a preview; never interrupt an admitted confirmation. */
  function cancel() {
    if (lock.current) return;
    const current = request.current;
    request.current = null;
    setImpact(null);
    setError(null);
    if (current)
      void ipc
        .cancelEmptyNotesTrash(current.requestId)
        .catch(/** Cancellation is best-effort and cannot delete. */ () => {});
  }
  useEffect(
    /** Retire previews when hidden or removed. */ () => {
      const visibility = /** Cancel an unconfirmed hidden preview. */ () => {
        if (document.hidden && !lock.current) {
          const current = request.current;
          request.current = null;
          setImpact(null);
          if (current)
            void ipc
              .cancelEmptyNotesTrash(current.requestId)
              .catch(/** Ignore expired cancellation. */ () => {});
        }
      };
      document.addEventListener("visibilitychange", visibility);
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        const current = request.current;
        if (current && !lock.current)
          void ipc
            .cancelEmptyNotesTrash(current.requestId)
            .catch(/** Dispose a pending preview only. */ () => {});
      };
    },
    [],
  );
  /** Prepare a new request without replaying deletion. */
  async function prepare() {
    if (lock.current || owner.state.blocked || owner.state.actionBusy) return;
    lock.current = true;
    setBusy(true);
    try {
      setImpact(await ipc.prepareEmptyNotesTrash());
      setError(null);
    } catch (failure) {
      setError(noteErrorCopy(failure));
      owner.invalidate();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  /** Confirm one request once and preserve changed impacts for another user intent. */
  async function confirm() {
    if (!impact || lock.current || owner.state.blocked || owner.state.actionBusy) return;
    lock.current = true;
    setBusy(true);
    owner.publish({ actionBusy: true });
    try {
      await owner.flush(true);
      await ipc.confirmEmptyNotesTrash(impact.requestId);
      if (owner.state.draft?.base?.status === "trash") owner.publish({ draft: null });
      setImpact(null);
      setError(null);
      owner.invalidate();
    } catch (failure) {
      const payload =
        failure instanceof IpcCallError ? (failure.payload as NotesError | null) : null;
      if (payload?.code === "trash_changed") setImpact(payload.impact);
      else if (payload?.code === "trash_empty") {
        setImpact(null);
        owner.invalidate();
      } else setImpact(null);
      setError(noteErrorCopy(failure));
      owner.invalidate();
    } finally {
      lock.current = false;
      setBusy(false);
      owner.publish({ actionBusy: false });
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || blocked || actionBusy || busy}
        onClick={prepare}
      >
        Empty Trash
      </Button>
      {error && !impact && (
        <p role="alert">
          {error}{" "}
          <Button onClick={prepare} disabled={busy || blocked || actionBusy}>
            Prepare new preview
          </Button>
        </p>
      )}
      <Dialog
        open={impact !== null}
        onOpenChange={
          /** Dismiss with Escape or the close control. */ (open) => {
            if (!open) cancel();
          }
        }
      >
        <DialogContent showCloseButton={!busy}>
          <DialogTitle>Empty Trash?</DialogTitle>
          <DialogDescription>
            Permanently delete {impact?.noteCount ?? 0} notes. This cannot be undone.
          </DialogDescription>
          {error && <p role="alert">{error}</p>}
          <ul>
            {impact?.notes.map(
              /** Show only backend-provided bounded labels. */ (note) => (
                <li key={note.noteId}>{note.displayTitle}</li>
              ),
            )}
          </ul>
          {impact?.hasMore && <p>More notes are included in this count.</p>}
          <Button variant="destructive" onClick={confirm} disabled={busy || blocked}>
            Delete all notes
          </Button>
          <Button variant="outline" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
