pub(crate) mod commands;
mod error;
mod handles;
mod models;
mod path_policy;
mod platform;
mod reader;
mod repository;
mod service;
mod walker;
mod watcher;

pub use error::FilesError;
pub use models::{
    ExternalFileResolutionDto, FileContentDto, FileDiskVersionDto, FileEditorSnapshot,
    FileEntryPathsDto, FileEntryRequestDto, FileHandleChangeKindDto, FileHandleChangedEventDto,
    FileHandleDto, FileHandleRequestDto, FileHandleStateDto, FilePaneTarget,
    FileSearchTruncatedReasonDto, FileTreeEntryDto, FileTreeEntryKindDto, FileTreePageDto,
    FileTreeSearchDto, FileTreeWarningDto, FileTreeWarningReasonDto, FileWatchModeDto,
    LineEndingDto, ListFileChildrenRequestDto, OpenFileInPaneRequestDto, OpenFileResultDto,
    OpenFileWarningDto, OpenableFileSearchItem, OpenableFileSearchSlice, RecentFileAvailabilityDto,
    RecentFileDto, RecentFilesChangedEventDto, RecentFilesResetPlan, RecentFilesResetProjection,
    ResolveExternalFileChangeRequestDto, SearchFileTreeRequestDto, TextEncodingDto, TextFileDto,
    TextFileModeDto,
};
pub use service::{FilesService, system_files_clock};

/// Invalidates one file handle after a committed runtime change.
pub const FILE_HANDLE_CHANGED_EVENT: &str = "files://handle-changed";
/// Invalidates one project's durable recent-file list.
pub const RECENT_FILES_CHANGED_EVENT: &str = "files://recent-changed";

pub use handles::{FileHandleManager, FileHandleManagerWeak};

/// Boxes one asynchronous Files dependency call while preserving borrowed input.
pub type FilesFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

/// Supplies Files with narrowly scoped Projects and Sessions owner operations.
pub trait FileDependencies: Send + Sync {
    /// Resolves an empty pane and derives its project identity.
    fn resolve_empty_pane<'a>(
        &'a self,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
    ) -> FilesFuture<'a, Result<FilePaneTarget, FilesError>>;
    /// Resolves the currently available canonical project root.
    fn available_project_root<'a>(
        &'a self,
        project_id: &'a str,
    ) -> FilesFuture<'a, Result<PathBuf, FilesError>>;
    /// Returns project identifiers in Projects-owned order.
    fn ordered_project_ids<'a>(&'a self) -> FilesFuture<'a, Result<Vec<String>, FilesError>>;
    /// Atomically attaches one Files-owned content reference.
    fn attach_file<'a>(
        &'a self,
        target: &'a FilePaneTarget,
        file_handle_id: &'a str,
        title: &'a str,
    ) -> FilesFuture<'a, Result<(), FilesError>>;
}

/// Supplies the native reveal seam used by composition and isolated tests.
#[doc(hidden)]
pub type FilesRevealCallback = Arc<dyn Fn(&Path) -> Result<(), FilesError> + Send + Sync>;
/// Supplies the default-application opener seam for validated files.
#[doc(hidden)]
pub type FilesOpenCallback = Arc<dyn Fn(&Path) -> Result<(), FilesError> + Send + Sync>;
/// Supplies a checked epoch clock for runtime observations.
#[doc(hidden)]
pub type FilesClock = Arc<dyn Fn() -> Result<i64, FilesError> + Send + Sync>;
/// Publishes one sanitized handle invalidation.
#[doc(hidden)]
pub type FileHandleEventSink =
    Arc<dyn Fn(FileHandleChangedEventDto) -> Result<(), FilesError> + Send + Sync>;
/// Publishes one sanitized recent-list invalidation.
#[doc(hidden)]
pub type RecentFilesEventSink =
    Arc<dyn Fn(RecentFilesChangedEventDto) -> Result<(), FilesError> + Send + Sync>;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
