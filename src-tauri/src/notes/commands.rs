use super::*;
use tauri::{Runtime, State, WebviewWindow};

/// Authorizes the caller before delegating list notes.
#[tauri::command]
pub(crate) async fn list_notes<R: Runtime>(
    input: ListNotesInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteListPageDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.list_notes(input).await
}
/// Authorizes the caller before delegating create note.
#[tauri::command]
pub(crate) async fn create_note<R: Runtime>(
    input: CreateNoteInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), true)?;
    let service = state.inner().clone();
    service.create_note(input).await
}
/// Authorizes the caller before delegating autosave note.
#[tauri::command]
pub(crate) async fn autosave_note<R: Runtime>(
    input: AutosaveNoteInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.autosave_note(input).await
}
/// Authorizes the caller before delegating set note pinned.
#[tauri::command]
pub(crate) async fn set_note_pinned<R: Runtime>(
    input: SetNotePinnedInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.set_note_pinned(input).await
}
/// Authorizes the caller before delegating set note project.
#[tauri::command]
pub(crate) async fn set_note_project<R: Runtime>(
    input: SetNoteProjectInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.set_note_project(input).await
}
/// Authorizes the caller before delegating archive note.
#[tauri::command]
pub(crate) async fn archive_note<R: Runtime>(
    input: NoteRevisionInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.archive_note(input).await
}
/// Authorizes the caller before delegating restore archived note.
#[tauri::command]
pub(crate) async fn restore_archived_note<R: Runtime>(
    input: NoteRevisionInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.restore_archived_note(input).await
}
/// Authorizes the caller before delegating move note to trash.
#[tauri::command]
pub(crate) async fn move_note_to_trash<R: Runtime>(
    input: NoteRevisionInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.move_note_to_trash(input).await
}
/// Authorizes the caller before delegating restore note from trash.
#[tauri::command]
pub(crate) async fn restore_note_from_trash<R: Runtime>(
    input: NoteRevisionInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.restore_note_from_trash(input).await
}
/// Authorizes the caller before delegating delete note permanently.
#[tauri::command]
pub(crate) async fn delete_note_permanently<R: Runtime>(
    input: NoteRevisionInputDto,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<DeletedNoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.delete_note_permanently(input).await
}
/// Authorizes the caller before delegating get note.
#[tauri::command]
pub(crate) async fn get_note<R: Runtime>(
    note_id: String,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<NoteDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.get_note(note_id).await
}
/// Authorizes the caller before delegating prepare empty notes trash.
#[tauri::command]
pub(crate) async fn prepare_empty_notes_trash<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<EmptyNotesTrashImpactDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.prepare_empty_notes_trash().await
}
/// Authorizes the caller before delegating confirm empty notes trash.
#[tauri::command]
pub(crate) async fn confirm_empty_notes_trash<R: Runtime>(
    request_id: u32,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<EmptyNotesTrashResultDto, NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.confirm_empty_notes_trash(request_id).await
}
/// Authorizes the caller before delegating cancel empty notes trash.
#[tauri::command]
pub(crate) async fn cancel_empty_notes_trash<R: Runtime>(
    request_id: u32,
    window: WebviewWindow<R>,
    state: State<'_, NotesService>,
) -> Result<(), NotesError> {
    authorize_notes_caller(window.label(), false)?;
    let service = state.inner().clone();
    service.cancel_empty_notes_trash(request_id).await
}
/// Enforces the exact main/Quick Note command boundary.
pub fn authorize_notes_caller(label: &str, create: bool) -> Result<(), NotesError> {
    if label == "main" || (create && label == "quick-note") {
        Ok(())
    } else {
        Err(NotesError::UnauthorizedWindow)
    }
}
