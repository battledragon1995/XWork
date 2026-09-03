pub(crate) mod commands;
mod error;
mod git_status;
mod models;
mod platform;
mod repository;
mod service;

pub use error::{InvalidProjectFolderReasonDto, ProjectsError};
pub use models::{
    AvailableProjectRoot, GitFileChangeDto, GitFileChangeKindDto, GitHeadDto, GitRepositoryKindDto,
    ProjectAvailabilityDto, ProjectAvailabilitySnapshot, ProjectBackupRecordV1,
    ProjectChangeKindDto, ProjectChangedEventDto, ProjectCommittedProjection, ProjectDto,
    ProjectFolderSelectionDto, ProjectGitStatusDto, ProjectGitSummaryDto, ProjectImportCounts,
    ProjectImportMap, ProjectImportPlan, ProjectUnavailableReasonDto, RemoveProjectImpactDto,
    RemoveProjectResultDto,
};
pub use platform::{
    NoProjectRuntimeGuard, PROJECTS_CHANGED_EVENT, ProjectClock, ProjectEventSink, ProjectFuture,
    ProjectIdFactory, ProjectPlatform, ProjectRuntimeGuard, ProjectRuntimeImpact,
    TauriProjectEventSink, TauriProjectPlatform,
};
pub use service::{CURRENT_PATH_IDENTITY, PathIdentity, ProjectService};
