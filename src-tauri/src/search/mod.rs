use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use tauri::{Runtime, State, WebviewWindow};
use ts_rs::TS;

mod ranking;
mod service;

pub use service::SearchService;

/// Represents one asynchronous owner query consumed by Search.
pub type SearchFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Accepts one unified-search request from the frontend.
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "search.ts")]
pub struct UnifiedSearchInputDto {
    pub query: String,
    pub context_project_id: Option<String>,
}

/// Identifies one half-open Unicode-scalar range in display text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "search.ts")]
pub struct SearchTextRangeDto {
    pub start_scalar: u32,
    pub end_scalar: u32,
}

/// Identifies the domain represented by a result or group.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "search.ts")]
pub enum SearchResultKindDto {
    Project,
    Session,
    File,
    Command,
}

/// Carries the current shortcut shown beside a command result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "search.ts")]
pub struct SearchShortcutDto {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub key_code: String,
    pub is_conflicted: bool,
}

/// Identifies the owner action for one Phase 1 result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    export_to = "search.ts"
)]
pub enum SearchTargetDto {
    Project {
        project_id: String,
    },
    Session {
        project_id: String,
        session_id: String,
    },
    File {
        project_id: String,
        relative_path: String,
    },
    Command {
        action_id: String,
        project_id: Option<String>,
    },
}

/// Describes one ranked and display-ready search result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "search.ts")]
pub struct SearchResultDto {
    pub key: String,
    pub kind: SearchResultKindDto,
    pub title: String,
    pub context: Option<String>,
    pub title_highlights: Vec<SearchTextRangeDto>,
    pub context_highlights: Vec<SearchTextRangeDto>,
    pub target: SearchTargetDto,
    pub shortcut: Option<SearchShortcutDto>,
    pub supports_open_in_split: bool,
}

/// Groups ranked results from one active source.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "search.ts")]
pub struct SearchGroupDto {
    pub kind: SearchResultKindDto,
    pub label: String,
    pub results: Vec<SearchResultDto>,
    pub has_more: bool,
}

/// Identifies one active Phase 1 source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "search.ts")]
pub enum SearchSourceDto {
    Projects,
    Sessions,
    Files,
    Commands,
}

/// Classifies a sanitized source failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "search.ts")]
pub enum SearchSourceFailureReasonDto {
    Timeout,
    Unavailable,
}

/// Reports an unavailable source without exposing owner details.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "search.ts")]
pub struct SearchSourceFailureDto {
    pub source: SearchSourceDto,
    pub reason: SearchSourceFailureReasonDto,
}

/// Returns the normalized query and all successful result groups.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "search.ts")]
pub struct UnifiedSearchResponseDto {
    pub query: String,
    pub groups: Vec<SearchGroupDto>,
    pub result_count: u32,
    pub source_failures: Vec<SearchSourceFailureDto>,
}

/// Exposes stable top-level failures at the search command boundary.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case", export_to = "search.ts")]
pub enum UnifiedSearchError {
    UnauthorizedWindow,
    InvalidQuery,
    InvalidContextProjectId,
    Unavailable,
}

impl std::fmt::Display for UnifiedSearchError {
    /// Formats only the stable error category.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnauthorizedWindow => "unauthorized_window",
            Self::InvalidQuery => "invalid_query",
            Self::InvalidContextProjectId => "invalid_context_project_id",
            Self::Unavailable => "unavailable",
        })
    }
}

impl std::error::Error for UnifiedSearchError {}

/// Supplies one public project snapshot to Search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectSearchDocument {
    pub project_id: String,
    pub display_name: String,
    pub root_path: String,
    pub is_available: bool,
    pub source_order: u32,
}

/// Describes the aggregate status needed for session matching.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchSessionStatus {
    NoToolYet,
    Running,
    UnseenOutput,
    NeedsAttention,
    Finished,
    ExitedWithError,
}

/// Supplies one public runtime-session summary to Search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionSearchDocument {
    pub session_id: String,
    pub project_id: String,
    pub name: String,
    pub status: SearchSessionStatus,
    pub source_order: u32,
}

/// Stores one platform-neutral current shortcut.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchShortcutChord {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub key_code: String,
}

/// Supplies one current shortcut action to the command catalog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShortcutActionSearchDocument {
    pub action_id: String,
    pub label: String,
    pub current_chord: SearchShortcutChord,
    pub shortcut_conflicted: bool,
    pub source_order: u32,
}

/// Supplies one bounded openable file candidate to Search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileSearchDocument {
    pub project_id: String,
    pub relative_path: String,
    pub file_name: String,
    pub project_name: String,
    pub supports_open_in_split: bool,
    pub source_order: u32,
}

/// Carries one bounded source-owned candidate prefix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchCandidates<T> {
    pub items: Vec<T>,
    pub has_more: bool,
}

/// Sanitizes every owner failure into one source-level category.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchSourceError {
    Unavailable,
}

/// Lists project metadata in owner-defined stable order.
pub trait ProjectSearchSource: Send + Sync {
    /// Reads the current public project snapshot.
    fn list_projects<'a>(
        &'a self,
    ) -> SearchFuture<'a, Result<Vec<ProjectSearchDocument>, SearchSourceError>>;
}

/// Lists runtime sessions in owner-defined stable order.
pub trait SessionSearchSource: Send + Sync {
    /// Reads the current public session snapshot.
    fn list_sessions<'a>(
        &'a self,
    ) -> SearchFuture<'a, Result<Vec<SessionSearchDocument>, SearchSourceError>>;
}

/// Searches owner-filtered openable files without absolute paths.
pub trait FileSearchSource: Send + Sync {
    /// Returns a bounded matching candidate slice.
    fn search_files<'a>(
        &'a self,
        query: &'a str,
        candidate_limit: u32,
    ) -> SearchFuture<'a, Result<SearchCandidates<FileSearchDocument>, SearchSourceError>>;
}

/// Reads the current action and shortcut catalog.
pub trait ShortcutCatalogSource: Send + Sync {
    /// Returns an immutable current shortcut snapshot.
    fn shortcut_actions(&self) -> Result<Vec<ShortcutActionSearchDocument>, SearchSourceError>;
}

/// Searches active Phase 1 sources for the authorized main window.
#[tauri::command]
pub async fn search_unified<R: Runtime>(
    window: WebviewWindow<R>,
    input: UnifiedSearchInputDto,
    state: State<'_, SearchService>,
) -> Result<UnifiedSearchResponseDto, UnifiedSearchError> {
    if window.label() != "main" {
        return Err(UnifiedSearchError::UnauthorizedWindow);
    }
    state.search(input).await
}
