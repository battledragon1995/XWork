import type { NotesError } from "@/bindings/notes";
import { IpcCallError } from "@/lib/ipc/ipc-error";
const COPY: Record<NotesError["code"], string> = {
  invalid_title: "Use at most 255 characters without control characters for the title.",
  empty_initial_content: "Add some content to save this note.",
  content_too_large: "Keep Markdown within 1 MiB of UTF-8 text.",
  invalid_search: "Use at most 128 characters and 8 search words without control characters.",
  invalid_project_id: "Refresh the project choices.",
  project_not_found: "This project no longer exists. Refresh the project choices.",
  invalid_note_id: "This note is no longer available.",
  note_not_found: "This note is no longer available.",
  note_not_editable: "This note is read-only. Refresh to see its current status.",
  invalid_transition: "This action is no longer available. Refresh the note.",
  revision_conflict: "This note changed elsewhere.",
  trash_changed: "Trash changed. Review the updated list before confirming again.",
  no_pending_trash_operation: "This preview expired. Prepare a new preview.",
  stale_trash_request: "This preview expired. Prepare a new preview.",
  trash_empty: "Trash is empty.",
  invalid_revision: "XWork could not complete this action. Restart XWork.",
  invalid_filter: "XWork could not complete this action. Restart XWork.",
  invalid_pagination: "XWork could not complete this action. Restart XWork.",
  unauthorized_window: "XWork could not complete this action. Restart XWork.",
  revision_exhausted: "This note cannot accept another revision.",
  clock_failed: "Could not save this note. Try again.",
  persistence_failed: "Could not save this note. Try again.",
};
/** Return non-sensitive copy without rendering native payloads. */
export function noteErrorCopy(error: unknown): string {
  const code =
    error instanceof IpcCallError ? (error.payload?.code as NotesError["code"]) : undefined;
  return (code && COPY[code]) || "Could not confirm this action. Refresh before trying again.";
}
