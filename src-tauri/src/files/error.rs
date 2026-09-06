use std::fmt::{Display, Formatter};

use serde::Serialize;
use ts_rs::TS;

use crate::projects::ProjectsError;

/// Describes Files failures without exposing native paths or raw errors.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
#[ts(tag = "code", rename_all = "camelCase", export_to = "files/files.ts")]
pub enum FilesError {
    WindowNotAllowed,
    InvalidProjectId,
    ProjectNotFound { project_id: String },
    ProjectUnavailable { project_id: String },
    ProjectRemovalInProgress { project_id: String },
    ProjectAccessFailed,
    InvalidRelativePath,
    InvalidSearch,
    InvalidCursor,
    EntryNotFound { relative_path: String },
    EntryNotVisible { relative_path: String },
    NotDirectory { relative_path: String },
    NotRegularFile { relative_path: String },
    LinkTraversalDenied { relative_path: String },
    TraversalLimitExceeded,
    FileSystemReadFailed,
    InvalidSessionTarget,
    PaneNotEmpty { pane_id: String },
    SessionAttachFailed,
    InvalidFileHandleId,
    FileHandleNotFound { file_handle_id: String },
    RevisionConflict { current_revision: String },
    NoExternalConflict,
    FileChangedAgain { current_revision: String },
    UnsavedChangesWouldBeLost,
    FileChangedDuringRead,
    FileReadFailed,
    FileMemoryLimitReached,
    ProjectRootChanged { project_id: String },
    RevealFailed,
    InvalidLimit,
    RecentFilesFailed,
    ClockFailed,
    OpenExternalFailed,
}

impl Display for FilesError {
    /// Formats a stable category without including payload values.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::WindowNotAllowed => "the invoking window is not allowed to access files",
            Self::InvalidProjectId => "the project identifier is not a canonical UUID",
            Self::ProjectNotFound { .. } => "the project no longer exists",
            Self::ProjectUnavailable { .. } => "the project root is unavailable",
            Self::ProjectRemovalInProgress { .. } => "the project is being removed",
            Self::ProjectAccessFailed => "the project could not be accessed",
            Self::InvalidRelativePath => "the relative path is invalid",
            Self::InvalidSearch => "the file search is invalid",
            Self::InvalidCursor => "the file cursor is invalid",
            Self::EntryNotFound { .. } => "the file entry no longer exists",
            Self::EntryNotVisible { .. } => "the file entry is not visible",
            Self::NotDirectory { .. } => "the file entry is not a directory",
            Self::NotRegularFile { .. } => "the file entry is not a regular file",
            Self::LinkTraversalDenied { .. } => "link traversal is denied",
            Self::TraversalLimitExceeded => "the traversal limit was exceeded",
            Self::FileSystemReadFailed => "the filesystem query failed",
            Self::InvalidSessionTarget => "the session target is invalid",
            Self::PaneNotEmpty { .. } => "the target pane is not empty",
            Self::SessionAttachFailed => "the file could not be attached to the session",
            Self::InvalidFileHandleId => "the file handle identifier is invalid",
            Self::FileHandleNotFound { .. } => "the file handle no longer exists",
            Self::RevisionConflict { .. } => "the file handle revision is stale",
            Self::NoExternalConflict => "the file handle has no external conflict",
            Self::FileChangedAgain { .. } => "the file changed again",
            Self::UnsavedChangesWouldBeLost => "unsaved changes would be lost",
            Self::FileChangedDuringRead => "the file changed while it was read",
            Self::FileReadFailed => "the file could not be read",
            Self::FileMemoryLimitReached => "the file memory limit was reached",
            Self::ProjectRootChanged { .. } => "the project root changed during the query",
            Self::RevealFailed => "the file entry could not be revealed",
            Self::InvalidLimit => "the requested limit is invalid",
            Self::RecentFilesFailed => "recent files could not be accessed",
            Self::ClockFailed => "the system clock could not be read",
            Self::OpenExternalFailed => "the file could not be opened externally",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for FilesError {}

impl FilesError {
    /// Maps a Projects failure while retaining only safe identifiers.
    pub(crate) fn from_projects(error: ProjectsError, project_id: &str) -> Self {
        match error {
            ProjectsError::InvalidProjectId => Self::InvalidProjectId,
            ProjectsError::ProjectNotFound { .. } => Self::ProjectNotFound {
                project_id: project_id.to_owned(),
            },
            ProjectsError::ProjectUnavailable { .. } => Self::ProjectUnavailable {
                project_id: project_id.to_owned(),
            },
            ProjectsError::RemovalInProgress { .. } => Self::ProjectRemovalInProgress {
                project_id: project_id.to_owned(),
            },
            _ => Self::ProjectAccessFailed,
        }
    }
}
