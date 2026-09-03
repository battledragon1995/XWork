use std::fmt::{Display, Formatter};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::models::{ProjectUnavailableReasonDto, RemoveProjectImpactDto};
use crate::storage::StorageError;

/// Explains why a selected folder cannot be registered as a project root.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum InvalidProjectFolderReasonDto {
    NotAbsolute,
    Missing,
    NotDirectory,
    FileSystemRoot,
    NotUtf8,
    AccessDenied,
    CannotCanonicalize,
}

/// Describes Projects failures without exposing SQL, bind values, or system paths.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
#[ts(tag = "code", rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum ProjectsError {
    UnauthorizedWindow,
    InvalidProjectId,
    ProjectNotFound {
        project_id: String,
    },
    InvalidSearch,
    InvalidDisplayName,
    FolderPickerFailed,
    InvalidProjectFolder {
        reason: InvalidProjectFolderReasonDto,
    },
    ProjectAlreadyExists {
        project_id: String,
    },
    ProjectUnavailable {
        reason: ProjectUnavailableReasonDto,
    },
    RemovalInProgress {
        project_id: String,
    },
    ConfirmationRequired {
        impact: RemoveProjectImpactDto,
    },
    RuntimeInspectionFailed,
    RuntimeCleanupFailed,
    GitInspectionFailed {
        project_id: String,
    },
    OpenFolderFailed,
    ClockFailed,
    PersistenceFailed,
}

impl Display for ProjectsError {
    /// Formats one stable category label without any user or system path.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        // Variant payloads are deliberately omitted so identifiers and paths never leak.
        let message = match self {
            Self::UnauthorizedWindow => "the invoking window is not allowed to manage projects",
            Self::InvalidProjectId => "the project identifier is not a canonical UUID",
            Self::ProjectNotFound { .. } => "the project no longer exists",
            Self::InvalidSearch => "the project filter is not valid",
            Self::InvalidDisplayName => "the project display name is not valid",
            Self::FolderPickerFailed => "the native folder picker could not be used",
            Self::InvalidProjectFolder { .. } => "the selected folder cannot be a project root",
            Self::ProjectAlreadyExists { .. } => "the folder is already registered as a project",
            Self::ProjectUnavailable { .. } => "the project root is currently unavailable",
            Self::RemovalInProgress { .. } => "the project is being removed",
            Self::ConfirmationRequired { .. } => {
                "removing a project requires explicit confirmation"
            }
            Self::RuntimeInspectionFailed => "the project runtime impact could not be inspected",
            Self::RuntimeCleanupFailed => "the project runtime could not be closed",
            Self::GitInspectionFailed { .. } => "the Git repository could not be inspected",
            Self::OpenFolderFailed => "the project root could not be opened",
            Self::ClockFailed => "the system clock did not provide a valid timestamp",
            Self::PersistenceFailed => "the project database operation failed",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for ProjectsError {}

impl From<StorageError> for ProjectsError {
    /// Collapses every storage failure into the safe persistence category.
    fn from(_error: StorageError) -> Self {
        Self::PersistenceFailed
    }
}

impl From<rusqlite::Error> for ProjectsError {
    /// Collapses every SQLite failure into the safe persistence category.
    fn from(_error: rusqlite::Error) -> Self {
        Self::PersistenceFailed
    }
}

#[cfg(test)]
mod tests {
    use super::ProjectsError;
    use crate::storage::StorageError;

    /// Verifies that storage failures never reach the frontend as distinct codes.
    #[test]
    fn storage_failures_collapse_into_persistence_failed() {
        let converted = ProjectsError::from(StorageError::LockPoisoned);

        assert_eq!(converted, ProjectsError::PersistenceFailed);
    }

    /// Verifies that SQLite failures never reach the frontend as distinct codes.
    #[test]
    fn sqlite_failures_collapse_into_persistence_failed() {
        let converted = ProjectsError::from(rusqlite::Error::QueryReturnedNoRows);

        assert_eq!(converted, ProjectsError::PersistenceFailed);
    }
}
