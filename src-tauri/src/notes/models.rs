use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "notes.ts")]
pub enum NoteStatusDto {
    Active,
    Archived,
    Trash,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "notes.ts")]
pub enum NotePreviousStatusDto {
    Active,
    Archived,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "notes.ts")]
pub enum NotePinnedFilterDto {
    Any,
    Only,
    Exclude,
}

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
    export_to = "notes.ts"
)]
pub enum NoteProjectFilterDto {
    All,
    Unlinked,
    Project { project_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct ListNotesInputDto {
    pub status: NoteStatusDto,
    pub query: Option<String>,
    pub project_filter: NoteProjectFilterDto,
    pub pinned_filter: NotePinnedFilterDto,
    pub offset: u32,
    pub limit: u16,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct NoteTextRangeDto {
    pub start_scalar: u32,
    pub end_scalar: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct NoteSummaryDto {
    pub id: String,
    pub title: Option<String>,
    pub snippet: String,
    pub project_id: Option<String>,
    pub is_pinned: bool,
    pub status: NoteStatusDto,
    #[ts(type = "number")]
    pub created_at_ms: i64,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
    #[ts(type = "number | null")]
    pub archived_at_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub trashed_at_ms: Option<i64>,
    pub revision: String,
    pub title_highlights: Vec<NoteTextRangeDto>,
    pub snippet_highlights: Vec<NoteTextRangeDto>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct NoteDto {
    pub id: String,
    pub title: Option<String>,
    pub content_markdown: String,
    pub project_id: Option<String>,
    pub is_pinned: bool,
    pub status: NoteStatusDto,
    pub trashed_from: Option<NotePreviousStatusDto>,
    #[ts(type = "number")]
    pub created_at_ms: i64,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
    #[ts(type = "number | null")]
    pub archived_at_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub trashed_at_ms: Option<i64>,
    pub revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct NoteCountsDto {
    pub active: u32,
    pub archived: u32,
    pub trash: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct NoteListPageDto {
    pub items: Vec<NoteSummaryDto>,
    pub offset: u32,
    pub total_matches: u32,
    pub has_more: bool,
    pub counts: NoteCountsDto,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct CreateNoteInputDto {
    pub title: Option<String>,
    pub content_markdown: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct AutosaveNoteInputDto {
    pub note_id: String,
    pub expected_revision: String,
    pub title: Option<String>,
    pub content_markdown: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct SetNotePinnedInputDto {
    pub note_id: String,
    pub expected_revision: String,
    pub pinned: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct SetNoteProjectInputDto {
    pub note_id: String,
    pub expected_revision: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct NoteRevisionInputDto {
    pub note_id: String,
    pub expected_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct DeletedNoteDto {
    pub note_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct TrashNoteLabelDto {
    pub note_id: String,
    pub display_title: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct EmptyNotesTrashImpactDto {
    pub request_id: u32,
    pub note_count: u32,
    pub notes: Vec<TrashNoteLabelDto>,
    pub has_more: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct EmptyNotesTrashResultDto {
    pub deleted_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "notes.ts")]
pub enum NoteChangeKindDto {
    Created,
    Autosaved,
    PinnedChanged,
    ProjectChanged,
    Archived,
    Restored,
    Trashed,
    PermanentlyDeleted,
    TrashEmptied,
    BackupImported,
    Reset,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "notes.ts")]
pub struct NoteChangedEventDto {
    pub sequence: String,
    pub kind: NoteChangeKindDto,
    pub note_id: Option<String>,
    pub revision: Option<String>,
}

pub struct NoteSearchRecord {
    pub note_id: String,
    pub title: Option<String>,
    pub matching_snippet: Option<String>,
    pub project_id: Option<String>,
    pub updated_at_ms: i64,
}

pub struct NoteSearchCandidates {
    pub items: Vec<NoteSearchRecord>,
    pub has_more: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteBackupRecordV1 {
    pub id: String,
    pub title: Option<String>,
    pub content_markdown: String,
    pub project_id: Option<String>,
    pub is_pinned: bool,
    pub status: NoteStatusDto,
    pub trashed_from: Option<NotePreviousStatusDto>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub archived_at_ms: Option<i64>,
    pub trashed_at_ms: Option<i64>,
}

pub struct NotesImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
}

pub struct NotesImportPlan {
    pub(crate) rows: Vec<NoteDto>,
    pub counts: NotesImportCounts,
}

pub enum NotesMaintenanceChange {
    BackupImported,
    Reset,
}

pub struct NotesCommittedProjection {
    pub change: NotesMaintenanceChange,
    pub affected_count: u32,
}
