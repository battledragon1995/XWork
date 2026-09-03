use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::error::ProjectsError;

/// Summarizes the repository and visible changes for one project.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub struct ProjectGitSummaryDto {
    pub project_id: String,
    pub repository_kind: GitRepositoryKindDto,
    pub head: Option<GitHeadDto>,
    pub changed_count: u32,
    pub untracked_count: u32,
}

/// Returns a Git summary together with its stable, project-relative entries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub struct ProjectGitStatusDto {
    pub summary: ProjectGitSummaryDto,
    pub changes: Vec<GitFileChangeDto>,
}

/// Distinguishes a plain folder, worktree, and bare repository.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum GitRepositoryKindDto {
    NotRepository,
    Worktree,
    Bare,
}

/// Describes the branch, unborn branch, or detached commit at HEAD.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum GitHeadDto {
    Branch {
        name: String,
    },
    Unborn {
        name: String,
    },
    Detached {
        #[serde(rename = "shortOid")]
        #[ts(rename = "shortOid")]
        short_oid: String,
    },
}

/// Describes one deduplicated path in a detailed Git snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub struct GitFileChangeDto {
    pub path: String,
    pub previous_path: Option<String>,
    pub change: GitFileChangeKindDto,
    pub is_directory: bool,
}

/// Classifies the highest-priority visible change for one path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum GitFileChangeKindDto {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

/// Bounds the display name in Unicode scalar values after trimming.
const DISPLAY_NAME_MAX_LENGTH: usize = 255;

/// Bounds the list filter in Unicode scalar values after trimming.
const SEARCH_MAX_LENGTH: usize = 256;

/// Describes one registered project and its freshly measured availability.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub struct ProjectDto {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub is_pinned: bool,
    // Millisecond timestamps stay inside the safe JavaScript integer range.
    #[ts(type = "number")]
    pub added_at_ms: i64,
    #[ts(type = "number")]
    pub last_opened_at_ms: i64,
    pub availability: ProjectAvailabilityDto,
}

/// Reports whether a project root is usable right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", content = "reason", rename_all = "camelCase")]
#[ts(tag = "status", content = "reason", rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum ProjectAvailabilityDto {
    Available,
    Unavailable(ProjectUnavailableReasonDto),
}

/// Explains why a persisted project root is currently unusable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum ProjectUnavailableReasonDto {
    Missing,
    NotDirectory,
    AccessDenied,
    Io,
}

/// Reports the outcome of a native folder selection flow.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "outcome", rename_all = "camelCase")]
#[ts(tag = "outcome", rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum ProjectFolderSelectionDto {
    Cancelled,
    Selected { project: ProjectDto },
}

/// Supplies the facts a remove-confirmation dialog must show.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub struct RemoveProjectImpactDto {
    pub project_id: String,
    pub display_name: String,
    pub root_path: String,
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

/// Identifies the project whose metadata was removed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub struct RemoveProjectResultDto {
    pub project_id: String,
}

/// Carries the invalidation key emitted after a committed project mutation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub struct ProjectChangedEventDto {
    pub change: ProjectChangeKindDto,
    pub project_id: String,
}

/// Classifies the committed mutation that produced a change event.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "projects/projects.ts")]
pub enum ProjectChangeKindDto {
    Added,
    Updated,
    Removed,
}

/// Reports current project availability to the Sessions consumer adapter.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectAvailabilitySnapshot {
    pub project_id: String,
    pub is_available: bool,
}

/// Supplies a validated canonical root to backend filesystem consumers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AvailableProjectRoot {
    pub project_id: String,
    pub root_path: std::path::PathBuf,
}

/// Stores one persisted project row including its private path identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ProjectRow {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub path_key: String,
    pub is_pinned: bool,
    pub added_at_ms: i64,
    pub last_opened_at_ms: i64,
}

impl ProjectRow {
    /// Projects one persisted row into its public snapshot.
    pub(super) fn to_dto(&self, availability: ProjectAvailabilityDto) -> ProjectDto {
        ProjectDto {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            root_path: self.root_path.clone(),
            is_pinned: self.is_pinned,
            added_at_ms: self.added_at_ms,
            last_opened_at_ms: self.last_opened_at_ms,
            availability,
        }
    }
}

/// Carries one project row through the version 1 backup package.
///
/// The record is an owner-controlled maintenance type: it never derives `TS`
/// and never travels over IPC.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectBackupRecordV1 {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub is_pinned: bool,
    pub added_at_ms: i64,
    pub last_opened_at_ms: i64,
}

/// Maps validated source project identifiers to their committed target identifiers.
///
/// The representation stays opaque so no other capability can depend on the
/// Projects path key or on how the mapping is stored.
#[derive(Clone, Debug, Default)]
pub struct ProjectImportMap {
    entries: std::collections::HashMap<String, String>,
}

impl ProjectImportMap {
    /// Creates one import map from already validated source-to-target pairs.
    pub(super) fn from_entries(entries: std::collections::HashMap<String, String>) -> Self {
        Self { entries }
    }

    /// Resolves one validated source project ID to its committed target ID.
    pub fn resolve<'a>(&'a self, source_project_id: &str) -> Option<&'a str> {
        self.entries.get(source_project_id).map(
            // Only the borrowed target identifier leaves the opaque map.
            String::as_str,
        )
    }
}

/// Counts the merge decisions a prepared project import would apply.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProjectImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
    pub path_matches: u32,
}

/// Holds every owned operation a coordinator transaction will apply.
#[derive(Clone, Debug)]
pub struct ProjectImportPlan {
    pub counts: ProjectImportCounts,
    pub import_map: ProjectImportMap,
    /// Rows to insert, already validated and keyed by their canonical path.
    pub(super) inserts: Vec<ProjectRow>,
    /// Rows to replace in place, already validated against the local snapshot.
    pub(super) updates: Vec<ProjectRow>,
    /// The publication this plan produces once the coordinator commits.
    pub(super) projection: ProjectCommittedProjection,
}

/// Carries the owned change payloads published after a coordinator commit.
///
/// The projection holds no transaction, lock, path key, secret, or callback, so
/// publishing it can never fail or re-enter storage.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectCommittedProjection {
    pub(super) changes: Vec<ProjectChangedEventDto>,
}

impl ProjectCommittedProjection {
    /// Creates one projection from already committed change payloads.
    pub(super) fn new(changes: Vec<ProjectChangedEventDto>) -> Self {
        Self { changes }
    }

    /// Reports how many committed changes this projection will publish.
    pub fn change_count(&self) -> usize {
        self.changes.len()
    }
}

/// Orders rows exactly like the repository's `idx_projects_list_order` index.
pub(super) fn compare_list_order(left: &ProjectRow, right: &ProjectRow) -> Ordering {
    // Pinned projects come first, then insertion time, then the stable identifier.
    right
        .is_pinned
        .cmp(&left.is_pinned)
        .then(left.added_at_ms.cmp(&right.added_at_ms))
        .then(left.id.cmp(&right.id))
}

/// Reports whether a row matches an already lowercased Unicode filter.
pub(super) fn matches_search(row: &ProjectRow, lowercased_search: &str) -> bool {
    // Unicode lowercasing happens in Rust because SQLite `NOCASE` is ASCII-only.
    row.display_name.to_lowercase().contains(lowercased_search)
        || row.root_path.to_lowercase().contains(lowercased_search)
}

/// Accepts only a lowercase hyphenated UUID produced by this backend.
pub(super) fn validate_project_id(project_id: &str) -> Result<(), ProjectsError> {
    let parsed = uuid::Uuid::parse_str(project_id).map_err(
        // Any unparsable identifier is rejected before storage or platform work.
        |_| ProjectsError::InvalidProjectId,
    )?;
    if parsed.hyphenated().to_string() == project_id {
        Ok(())
    } else {
        // Rejecting other renderings keeps one canonical identifier form in every layer.
        Err(ProjectsError::InvalidProjectId)
    }
}

/// Trims and validates a user-supplied or derived project display name.
pub(super) fn normalize_display_name(display_name: &str) -> Result<String, ProjectsError> {
    let trimmed = display_name.trim();
    let length = trimmed.chars().count();
    if length == 0 || length > DISPLAY_NAME_MAX_LENGTH {
        return Err(ProjectsError::InvalidDisplayName);
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ProjectsError::InvalidDisplayName);
    }
    Ok(trimmed.to_owned())
}

/// Trims and validates the list filter, treating a blank filter as absent.
pub(super) fn normalize_search(search: Option<&str>) -> Result<Option<String>, ProjectsError> {
    let Some(raw) = search else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > SEARCH_MAX_LENGTH {
        return Err(ProjectsError::InvalidSearch);
    }
    if trimmed.chars().any(char::is_control) {
        return Err(ProjectsError::InvalidSearch);
    }
    Ok(Some(trimmed.to_lowercase()))
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use super::{
        ProjectAvailabilityDto, ProjectChangeKindDto, ProjectChangedEventDto, ProjectDto,
        ProjectFolderSelectionDto, ProjectRow, ProjectUnavailableReasonDto, RemoveProjectImpactDto,
        RemoveProjectResultDto, compare_list_order, matches_search, normalize_display_name,
        normalize_search, validate_project_id,
    };
    use crate::projects::error::{InvalidProjectFolderReasonDto, ProjectsError};

    /// Builds one persisted fixture row for model-level assertions.
    fn row(id: &str, name: &str, path: &str, pinned: bool, added: i64) -> ProjectRow {
        ProjectRow {
            id: id.to_owned(),
            display_name: name.to_owned(),
            root_path: path.to_owned(),
            path_key: path.to_lowercase(),
            is_pinned: pinned,
            added_at_ms: added,
            last_opened_at_ms: added,
        }
    }

    /// Serializes a value into its exact wire representation.
    fn json<T: serde::Serialize>(value: &T) -> String {
        serde_json::to_string(value).expect("the contract type should serialize")
    }

    /// Verifies the exact camel-case wire shape of the project snapshot.
    #[test]
    fn project_snapshot_uses_camel_case_fields() {
        let dto = row(
            "11111111-1111-4111-8111-111111111111",
            "XWork",
            "C:\\Work\\XWork",
            true,
            42,
        )
        .to_dto(ProjectAvailabilityDto::Available);

        assert_eq!(
            json(&dto),
            "{\"id\":\"11111111-1111-4111-8111-111111111111\",\
             \"displayName\":\"XWork\",\
             \"rootPath\":\"C:\\\\Work\\\\XWork\",\
             \"isPinned\":true,\
             \"addedAtMs\":42,\
             \"lastOpenedAtMs\":42,\
             \"availability\":{\"status\":\"available\"}}"
        );
    }

    /// Verifies the adjacently tagged availability and its reason names.
    #[test]
    fn availability_keeps_its_status_and_reason_tags() {
        assert_eq!(
            json(&ProjectAvailabilityDto::Unavailable(
                ProjectUnavailableReasonDto::NotDirectory
            )),
            "{\"status\":\"unavailable\",\"reason\":\"notDirectory\"}"
        );
        assert_eq!(
            json(&ProjectAvailabilityDto::Unavailable(
                ProjectUnavailableReasonDto::AccessDenied
            )),
            "{\"status\":\"unavailable\",\"reason\":\"accessDenied\"}"
        );
        assert_eq!(
            json(&ProjectAvailabilityDto::Unavailable(
                ProjectUnavailableReasonDto::Io
            )),
            "{\"status\":\"unavailable\",\"reason\":\"io\"}"
        );
        assert_eq!(
            json(&ProjectAvailabilityDto::Unavailable(
                ProjectUnavailableReasonDto::Missing
            )),
            "{\"status\":\"unavailable\",\"reason\":\"missing\"}"
        );
    }

    /// Verifies the internally tagged folder-selection outcomes.
    #[test]
    fn folder_selection_distinguishes_cancel_from_selection() {
        assert_eq!(
            json(&ProjectFolderSelectionDto::Cancelled),
            "{\"outcome\":\"cancelled\"}"
        );
        let selected = ProjectFolderSelectionDto::Selected {
            project: row(
                "22222222-2222-4222-8222-222222222222",
                "Docs",
                "/srv/docs",
                false,
                7,
            )
            .to_dto(ProjectAvailabilityDto::Available),
        };
        assert!(json(&selected).starts_with("{\"outcome\":\"selected\",\"project\":{"));
    }

    /// Verifies the remove impact, remove result, and change event wire shapes.
    #[test]
    fn removal_and_event_contracts_use_camel_case_fields() {
        assert_eq!(
            json(&RemoveProjectImpactDto {
                project_id: "33333333-3333-4333-8333-333333333333".to_owned(),
                display_name: "Docs".to_owned(),
                root_path: "/srv/docs".to_owned(),
                session_count: 2,
                running_process_count: 1,
                unsaved_file_count: 3,
            }),
            "{\"projectId\":\"33333333-3333-4333-8333-333333333333\",\
             \"displayName\":\"Docs\",\
             \"rootPath\":\"/srv/docs\",\
             \"sessionCount\":2,\
             \"runningProcessCount\":1,\
             \"unsavedFileCount\":3}"
        );
        assert_eq!(
            json(&RemoveProjectResultDto {
                project_id: "33333333-3333-4333-8333-333333333333".to_owned(),
            }),
            "{\"projectId\":\"33333333-3333-4333-8333-333333333333\"}"
        );
        assert_eq!(
            json(&ProjectChangedEventDto {
                change: ProjectChangeKindDto::Removed,
                project_id: "33333333-3333-4333-8333-333333333333".to_owned(),
            }),
            "{\"change\":\"removed\",\
             \"projectId\":\"33333333-3333-4333-8333-333333333333\"}"
        );
        assert_eq!(json(&ProjectChangeKindDto::Added), "\"added\"");
        assert_eq!(json(&ProjectChangeKindDto::Updated), "\"updated\"");
    }

    /// Verifies that public errors serialize safely under their `code` tag.
    #[test]
    fn errors_serialize_without_leaking_internals() {
        assert_eq!(
            json(&ProjectsError::UnauthorizedWindow),
            "{\"code\":\"unauthorizedWindow\"}"
        );
        assert_eq!(
            json(&ProjectsError::ProjectNotFound {
                project_id: "44444444-4444-4444-8444-444444444444".to_owned(),
            }),
            "{\"code\":\"projectNotFound\",\
             \"project_id\":\"44444444-4444-4444-8444-444444444444\"}"
        );
        assert_eq!(
            json(&ProjectsError::InvalidProjectFolder {
                reason: InvalidProjectFolderReasonDto::FileSystemRoot,
            }),
            "{\"code\":\"invalidProjectFolder\",\"reason\":\"fileSystemRoot\"}"
        );
        assert_eq!(
            json(&ProjectsError::PersistenceFailed),
            "{\"code\":\"persistenceFailed\"}"
        );
    }

    /// Verifies that error display text never contains a path, SQL, or bind value.
    #[test]
    fn error_display_text_stays_generic() {
        let messages = [
            ProjectsError::UnauthorizedWindow.to_string(),
            ProjectsError::ProjectNotFound {
                project_id: "44444444-4444-4444-8444-444444444444".to_owned(),
            }
            .to_string(),
            ProjectsError::ProjectAlreadyExists {
                project_id: "44444444-4444-4444-8444-444444444444".to_owned(),
            }
            .to_string(),
            ProjectsError::PersistenceFailed.to_string(),
        ];

        for message in messages {
            assert!(!message.contains("44444444"));
            assert!(!message.contains("SELECT"));
            assert!(!message.contains('\\'));
            assert!(!message.contains('/'));
        }
    }

    /// Verifies that only a lowercase hyphenated UUID is accepted.
    #[test]
    fn project_id_validation_requires_canonical_uuid() {
        assert_eq!(
            validate_project_id("11111111-1111-4111-8111-111111111111"),
            Ok(())
        );
        for rejected in [
            "",
            "not-a-uuid",
            "11111111111141118111111111111111",
            "11111111-1111-4111-8111-111111111111 ",
            "11111111-1111-4111-8111-11111111111G",
            "{11111111-1111-4111-8111-111111111111}",
            "11111111-1111-4111-8111-11111111111A",
        ] {
            assert_eq!(
                validate_project_id(rejected),
                Err(ProjectsError::InvalidProjectId),
                "identifier {rejected:?} should be rejected"
            );
        }
    }

    /// Verifies display-name trimming, length limits, and control-character rejection.
    #[test]
    fn display_name_validation_trims_and_bounds_input() {
        assert_eq!(normalize_display_name("  XWork  "), Ok("XWork".to_owned()));
        assert_eq!(
            normalize_display_name(&"é".repeat(255)),
            Ok("é".repeat(255))
        );
        for rejected in ["", "   ", "\t\n"] {
            assert_eq!(
                normalize_display_name(rejected),
                Err(ProjectsError::InvalidDisplayName)
            );
        }
        assert_eq!(
            normalize_display_name(&"é".repeat(256)),
            Err(ProjectsError::InvalidDisplayName)
        );
        assert_eq!(
            normalize_display_name("Docs\u{7f}"),
            Err(ProjectsError::InvalidDisplayName)
        );
    }

    /// Verifies search normalization, blank collapsing, and limits.
    #[test]
    fn search_validation_normalizes_and_bounds_input() {
        assert_eq!(normalize_search(None), Ok(None));
        assert_eq!(normalize_search(Some("   ")), Ok(None));
        assert_eq!(
            normalize_search(Some("  ÄÖÜ  ")),
            Ok(Some("äöü".to_owned()))
        );
        assert_eq!(
            normalize_search(Some(&"a".repeat(256))),
            Ok(Some("a".repeat(256)))
        );
        assert_eq!(
            normalize_search(Some(&"a".repeat(257))),
            Err(ProjectsError::InvalidSearch)
        );
        assert_eq!(
            normalize_search(Some("docs\u{0}")),
            Err(ProjectsError::InvalidSearch)
        );
    }

    /// Verifies that the Rust comparator matches the persisted display order.
    #[test]
    fn list_order_puts_pinned_first_then_insertion_time() {
        let pinned_late = row("bbbb", "B", "/b", true, 20);
        let pinned_early = row("aaaa", "A", "/a", true, 10);
        let unpinned_early = row("cccc", "C", "/c", false, 5);
        let same_time_low_id = row("dddd", "D", "/d", false, 30);
        let same_time_high_id = row("eeee", "E", "/e", false, 30);

        assert_eq!(
            compare_list_order(&pinned_early, &unpinned_early),
            Ordering::Less
        );
        assert_eq!(
            compare_list_order(&pinned_early, &pinned_late),
            Ordering::Less
        );
        assert_eq!(
            compare_list_order(&same_time_low_id, &same_time_high_id),
            Ordering::Less
        );
        assert_eq!(
            compare_list_order(&same_time_high_id, &same_time_low_id),
            Ordering::Greater
        );

        let mut rows = vec![
            same_time_high_id.clone(),
            unpinned_early.clone(),
            pinned_late.clone(),
            same_time_low_id.clone(),
            pinned_early.clone(),
        ];
        rows.sort_by(compare_list_order);
        assert_eq!(
            rows.into_iter()
                .map(
                    // Keeps only the identifier so the assertion shows the order directly.
                    |row| row.id
                )
                .collect::<Vec<_>>(),
            vec!["aaaa", "bbbb", "cccc", "dddd", "eeee"]
        );
    }

    /// Verifies Unicode case-insensitive matching over name and root path.
    #[test]
    fn search_matches_name_and_path_case_insensitively() {
        let candidate = row("aaaa", "Größe", "C:\\Work\\Türkçe", false, 1);

        assert!(matches_search(
            &candidate,
            &normalize_search(Some("GRÖ"))
                .expect("the filter should normalize")
                .unwrap_or_default()
        ));
        assert!(matches_search(
            &candidate,
            &normalize_search(Some("türkçe"))
                .expect("the filter should normalize")
                .unwrap_or_default()
        ));
        assert!(!matches_search(&candidate, "missing"));
    }

    /// Verifies that the row projection copies every public field verbatim.
    #[test]
    fn row_projection_preserves_persisted_values() {
        let source = ProjectRow {
            id: "55555555-5555-4555-8555-555555555555".to_owned(),
            display_name: "Docs".to_owned(),
            root_path: "/srv/docs".to_owned(),
            path_key: "/srv/docs".to_owned(),
            is_pinned: true,
            added_at_ms: 5,
            last_opened_at_ms: 9,
        };

        let dto = source.to_dto(ProjectAvailabilityDto::Unavailable(
            ProjectUnavailableReasonDto::Missing,
        ));

        assert_eq!(
            dto,
            ProjectDto {
                id: source.id.clone(),
                display_name: source.display_name.clone(),
                root_path: source.root_path.clone(),
                is_pinned: true,
                added_at_ms: 5,
                last_opened_at_ms: 9,
                availability: ProjectAvailabilityDto::Unavailable(
                    ProjectUnavailableReasonDto::Missing
                ),
            }
        );
    }
}
