import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type * as N from "@/bindings/notes";
import { invokeCommand } from "./ipc-error";
/** Read server-ordered summaries and lifecycle counts. */
export function listNotes(input: N.ListNotesInputDto) {
  return invokeCommand<N.NoteListPageDto, N.NotesError>("list_notes", { input });
}
/** Revalidate an opaque note identity. */
export function getNote(noteId: string) {
  return invokeCommand<N.NoteDto, N.NotesError>("get_note", { noteId });
}
/** Create one note only after content admission. */
export function createNote(input: N.CreateNoteInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("create_note", { input });
}
/** Save content against an opaque revision. */
export function autosaveNote(input: N.AutosaveNoteInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("autosave_note", { input });
}
/** Change the active note pin. */
export function setNotePinned(input: N.SetNotePinnedInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("set_note_pinned", { input });
}
/** Change the active note project link. */
export function setNoteProject(input: N.SetNoteProjectInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("set_note_project", { input });
}
/** Archive an active note. */
export function archiveNote(input: N.NoteRevisionInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("archive_note", { input });
}
/** Restore an archived note. */
export function restoreArchivedNote(input: N.NoteRevisionInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("restore_archived_note", { input });
}
/** Move a note into Trash. */
export function moveNoteToTrash(input: N.NoteRevisionInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("move_note_to_trash", { input });
}
/** Restore the lifecycle recorded before Trash. */
export function restoreNoteFromTrash(input: N.NoteRevisionInputDto) {
  return invokeCommand<N.NoteDto, N.NotesError>("restore_note_from_trash", { input });
}
/** Permanently delete one explicitly chosen Trash record. */
export function deleteNotePermanently(input: N.NoteRevisionInputDto) {
  return invokeCommand<N.DeletedNoteDto, N.NotesError>("delete_note_permanently", { input });
}
/** Prepare a bounded authoritative Trash impact. */
export function prepareEmptyNotesTrash() {
  return invokeCommand<N.EmptyNotesTrashImpactDto, N.NotesError>("prepare_empty_notes_trash");
}
/** Confirm precisely the prepared Trash impact. */
export function confirmEmptyNotesTrash(requestId: number) {
  return invokeCommand<N.EmptyNotesTrashResultDto, N.NotesError>("confirm_empty_notes_trash", {
    requestId,
  });
}
/** Retire a prepared request without deletion. */
export function cancelEmptyNotesTrash(requestId: number) {
  return invokeCommand<void, N.NotesError>("cancel_empty_notes_trash", { requestId });
}
/** Subscribe to invalidation without exposing the native event envelope. */
export function onNotesChanged(
  handler: (event: N.NoteChangedEventDto) => void,
): Promise<UnlistenFn> {
  return listen<N.NoteChangedEventDto>(
    "notes://changed",
    /** Forward only the public payload. */ (event) => handler(event.payload),
  );
}
