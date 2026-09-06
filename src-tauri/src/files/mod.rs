pub(crate) mod commands;
mod error;
mod models;
mod path_policy;
mod platform;
mod service;
mod walker;

pub use error::FilesError;
pub use models::{
    FileEntryPathsDto, FileEntryRequestDto, FileSearchTruncatedReasonDto, FileTreeEntryDto,
    FileTreeEntryKindDto, FileTreePageDto, FileTreeSearchDto, FileTreeWarningDto,
    FileTreeWarningReasonDto, ListFileChildrenRequestDto, SearchFileTreeRequestDto,
};
pub use service::FilesService;

/// Supplies the native reveal seam used by composition and isolated tests.
#[doc(hidden)]
pub type FilesRevealCallback = Arc<dyn Fn(&Path) -> Result<(), FilesError> + Send + Sync>;
use std::{path::Path, sync::Arc};
