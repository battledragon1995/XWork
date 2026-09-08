use super::models::*;
use serde::Serialize;
use ts_rs::TS;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case", export_to = "notes.ts")]
pub enum NotesError {
    UnauthorizedWindow,
    InvalidNoteId,
    InvalidRevision,
    InvalidTitle,
    EmptyInitialContent,
    ContentTooLarge,
    InvalidSearch,
    InvalidPagination,
    InvalidFilter,
    InvalidProjectId,
    ProjectNotFound,
    NoteNotFound,
    NoteNotEditable { status: NoteStatusDto },
    InvalidTransition { status: NoteStatusDto },
    RevisionConflict { current: Box<NoteDto> },
    RevisionExhausted,
    TrashEmpty,
    NoPendingTrashOperation,
    StaleTrashRequest,
    TrashChanged { impact: EmptyNotesTrashImpactDto },
    ClockFailed,
    PersistenceFailed,
}

impl From<crate::storage::StorageError> for NotesError {
    /// Redacts storage internals at the public boundary.
    fn from(_: crate::storage::StorageError) -> Self {
        Self::PersistenceFailed
    }
}
impl From<rusqlite::Error> for NotesError {
    /// Distinguishes only the nullable project foreign-key failure.
    fn from(error: rusqlite::Error) -> Self {
        if error.sqlite_error().is_some_and(
            // Identifies the Notes table's sole foreign key.
            |error| error.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY,
        ) {
            Self::ProjectNotFound
        } else {
            Self::PersistenceFailed
        }
    }
}
