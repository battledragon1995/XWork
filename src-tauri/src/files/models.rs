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
