use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Maximum accepted UTF-8 byte length of a relative path.
pub const MAX_RELATIVE_PATH_BYTES: usize = 4_096;
/// Maximum number of components in a relative path.
pub const MAX_PATH_COMPONENTS: usize = 128;
/// Maximum number of entries in one directory page.
pub const MAX_PAGE_ENTRIES: usize = 500;
/// Maximum number of retained search matches.
pub const MAX_SEARCH_RESULTS: usize = 200;
/// Maximum number of inspected filesystem entries per query.
pub const MAX_SCAN_ENTRIES: usize = 100_000;
/// Maximum number of warnings serialized in one response.
pub const MAX_WARNINGS: usize = 20;
/// Maximum encoded cursor size.
pub const MAX_CURSOR_BYTES: usize = 8 * 1_024;
/// Maximum file size retained by the source viewer.
pub const MAX_VIEWER_BYTES: u64 = 5 * 1_024 * 1_024;
/// Maximum number of attached and retained file handles.
pub const MAX_FILE_HANDLES: usize = 64;
/// Maximum aggregate bytes retained by text handles.
pub const MAX_TEXT_BUFFER_BYTES: usize = 64 * 1_024 * 1_024;

/// Requests one page of visible direct children.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct ListFileChildrenRequestDto {
    pub project_id: String,
    pub directory: String,
    pub cursor: Option<String>,
}

/// Requests a recursive visible-entry basename search.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct SearchFileTreeRequestDto {
    pub project_id: String,
    pub query: String,
}

/// Identifies one registered-project entry.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileEntryRequestDto {
    pub project_id: String,
    pub relative_path: String,
}

/// Classifies a tree entry without following links.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum FileTreeEntryKindDto {
    Directory,
    File,
    SymbolicLink,
    Other,
}

/// Describes one lossless project-relative filesystem entry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileTreeEntryDto {
    pub name: String,
    pub relative_path: String,
    pub kind: FileTreeEntryKindDto,
}

/// Classifies a recoverable traversal issue.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum FileTreeWarningReasonDto {
    UnreadableEntry,
    InvalidIgnoreRule,
    UnsupportedName,
}

/// Reports one recoverable issue without leaking an absolute path.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileTreeWarningDto {
    pub relative_directory: String,
    pub reason: FileTreeWarningReasonDto,
}

/// Returns a stable page of direct children.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileTreePageDto {
    pub project_id: String,
    pub directory: String,
    pub entries: Vec<FileTreeEntryDto>,
    pub next_cursor: Option<String>,
    pub warning_count: u32,
    pub warnings_truncated: bool,
    pub warnings: Vec<FileTreeWarningDto>,
}

/// Explains why a recursive search returned only a deterministic prefix.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum FileSearchTruncatedReasonDto {
    ResultLimit,
    ScanLimit,
    DepthLimit,
}

/// Returns flat matches from one fresh project scan.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileTreeSearchDto {
    pub project_id: String,
    pub query: String,
    pub matches: Vec<FileTreeEntryDto>,
    pub truncated_reason: Option<FileSearchTruncatedReasonDto>,
    pub warning_count: u32,
    pub warnings_truncated: bool,
    pub warnings: Vec<FileTreeWarningDto>,
}

/// Returns copyable lexical paths for one freshly validated entry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileEntryPathsDto {
    pub relative_path: String,
    pub absolute_path: String,
}

/// Requests opening one project-relative file in an empty pane.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct OpenFileInPaneRequestDto {
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub relative_path: String,
}

/// Identifies one process-local file handle.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileHandleRequestDto {
    pub file_handle_id: String,
}

/// Selects how an external Markdown conflict is resolved in memory.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum ExternalFileResolutionDto {
    KeepMine,
    ReloadFromDisk,
}

/// Requests resolving a conflict against an exact handle revision.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct ResolveExternalFileChangeRequestDto {
    pub file_handle_id: String,
    pub expected_revision: String,
    pub resolution: ExternalFileResolutionDto,
}

/// Classifies whether a valid text file belongs to the future Markdown editor.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum TextFileModeDto {
    SourceReadOnly,
    Markdown,
}

/// Identifies the lossless text encoding returned by Files.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum TextEncodingDto {
    Utf8,
}

/// Describes logical line-ending bytes without modifying them.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum LineEndingDto {
    None,
    Lf,
    Crlf,
    Mixed,
}

/// Returns one bounded, lossless UTF-8 source snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct TextFileDto {
    pub text: String,
    pub byte_size: u64,
    pub line_count: u32,
    pub mime_type: String,
    pub syntax_hint: Option<String>,
    pub encoding: TextEncodingDto,
    pub has_utf8_bom: bool,
    pub line_ending: LineEndingDto,
    pub mode: TextFileModeDto,
}

/// Classifies viewer content without exposing binary bytes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    export_to = "files/files.ts"
)]
pub enum FileContentDto {
    Text {
        file: TextFileDto,
    },
    Binary {
        byte_size: u64,
        mime_type: String,
    },
    TooLarge {
        byte_size: u64,
        limit_bytes: u64,
        mime_type: String,
    },
}

/// Describes one observed disk version with an opaque fingerprint token.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileDiskVersionDto {
    pub disk_revision: String,
    pub observed_at_ms: i64,
    pub modified_at_ms: Option<i64>,
    pub byte_size: u64,
    pub mime_type: String,
}

/// Describes the current authoritative runtime state of a file handle.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    export_to = "files/files.ts"
)]
pub enum FileHandleStateDto {
    Ready {
        content: FileContentDto,
        disk: FileDiskVersionDto,
    },
    ExternalConflict {
        local: TextFileDto,
        external: FileDiskVersionDto,
    },
    Missing {
        last_disk: Option<FileDiskVersionDto>,
        local: Option<TextFileDto>,
    },
    Unreadable {
        last_disk: Option<FileDiskVersionDto>,
        local: Option<TextFileDto>,
    },
    ProjectRootChanged,
}

/// Reports whether a handle receives native hints or targeted polling.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum FileWatchModeDto {
    Native,
    PollingFallback,
}

/// Returns one bounded process-local file handle snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileHandleDto {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub name: String,
    pub relative_path: String,
    pub revision: String,
    pub watch_mode: FileWatchModeDto,
    pub is_dirty: bool,
    pub dirty_since_ms: Option<i64>,
    pub edit_count: u32,
    pub state: FileHandleStateDto,
}

/// Reports a recoverable post-attach warning.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum OpenFileWarningDto {
    RecentFileNotRecorded,
}

/// Returns the attached handle and any bounded post-attach warning.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct OpenFileResultDto {
    pub file: FileHandleDto,
    pub warnings: Vec<OpenFileWarningDto>,
}

/// Classifies current availability of one durable recent path.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum RecentFileAvailabilityDto {
    Available,
    Missing,
    NotVisible,
    LinkDenied,
    ProjectUnavailable,
    Unreadable,
}

/// Returns one recent file enriched with current runtime facts.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct RecentFileDto {
    pub project_id: String,
    pub name: String,
    pub parent_path: String,
    pub relative_path: String,
    pub opened_at_ms: i64,
    pub availability: RecentFileAvailabilityDto,
    pub is_open: bool,
    pub has_unsaved_changes: bool,
}

/// Identifies the visible reason a handle revision changed.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub enum FileHandleChangeKindDto {
    Reloaded,
    ConflictDetected,
    Missing,
    Unreadable,
    ProjectRootChanged,
    WatchModeChanged,
}

/// Invalidates one handle without sending source content through an event.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct FileHandleChangedEventDto {
    pub file_handle_id: String,
    pub revision: String,
    pub change: FileHandleChangeKindDto,
}

/// Invalidates the recent list of one project.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "files/files.ts")]
pub struct RecentFilesChangedEventDto {
    pub project_id: String,
}

/// Carries a future editor snapshot without exposing an IPC command in stage16.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileEditorSnapshot {
    pub text: String,
    pub expected_handle_revision: String,
    pub base_disk_revision: String,
}

/// Identifies an empty pane resolved by the Sessions owner.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FilePaneTarget {
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub project_id: String,
}

/// Supplies one owner-filtered regular file to Unified Search.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenableFileSearchItem {
    pub project_id: String,
    pub relative_path: String,
    pub file_name: String,
    pub source_order: u32,
}

/// Returns a bounded candidate slice and whether more matches exist.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenableFileSearchSlice {
    pub items: Vec<OpenableFileSearchItem>,
    pub has_more: bool,
}

/// Owns recent reset facts outside the coordinator transaction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecentFilesResetPlan {
    pub removed_count: u32,
    pub affected_project_ids: Vec<String>,
}

/// Owns post-commit recent invalidations.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecentFilesResetProjection {
    pub removed_count: u32,
    pub affected_project_ids: Vec<String>,
}

/// Saturates an arbitrary issue count into the public warning count.
pub(crate) fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::{FileTreeEntryKindDto, ListFileChildrenRequestDto};

    /// Verifies public request and enum casing stays camel-case.
    #[test]
    fn public_contract_uses_camel_case() {
        let request = serde_json::from_value::<ListFileChildrenRequestDto>(serde_json::json!({
            "projectId": "11111111-1111-4111-8111-111111111111",
            "directory": "",
            "cursor": null
        }))
        .expect("the request should deserialize");
        assert_eq!(request.directory, "");
        assert_eq!(
            serde_json::to_value(FileTreeEntryKindDto::SymbolicLink)
                .expect("the kind should serialize"),
            serde_json::json!("symbolicLink")
        );
    }
}
