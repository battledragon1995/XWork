use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::SessionsError;

/// Summarizes one process-local session for grouped lists and events.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub struct SessionSummaryDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub status: SessionStatusDto,
    pub running_process_count: u32,
    pub tab_count: u32,
}

/// Contains one complete immutable session snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub struct SessionDetailDto {
    pub summary: SessionSummaryDto,
    pub tabs: Vec<TabDto>,
    pub active_tab_id: Option<String>,
    pub can_reopen_last_closed_tab: bool,
    pub revision: String,
}

/// Contains one tab and its complete pane layout.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub struct TabDto {
    pub id: String,
    pub name: String,
    pub layout: PaneLayoutNodeDto,
    pub active_pane_id: String,
    pub maximized_pane_id: Option<String>,
}

/// Represents a leaf pane or a full binary split node.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export_to = "sessions/sessions.ts")]
pub enum PaneLayoutNodeDto {
    Pane {
        pane: PaneDto,
    },
    Split {
        split_id: String,
        axis: SplitAxisDto,
        ratio_basis_points: u16,
        first: Box<PaneLayoutNodeDto>,
        second: Box<PaneLayoutNodeDto>,
    },
}

/// Identifies how the two children of a split are arranged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub enum SplitAxisDto {
    Horizontal,
    Vertical,
}

/// Contains the opaque identity and public content of one pane.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub struct PaneDto {
    pub id: String,
    pub content: PaneContentDto,
}

/// Describes the public content attached to one pane.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export_to = "sessions/sessions.ts")]
pub enum PaneContentDto {
    Empty,
    ToolSelection {
        profile_id: String,
        title: String,
    },
    Terminal {
        terminal_id: String,
        profile_id: String,
        title: String,
    },
    File {
        file_handle_id: String,
        title: String,
    },
}

/// Reports the highest-priority aggregate state of one session.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub enum SessionStatusDto {
    NoToolYet,
    Running,
    UnseenOutput,
    NeedsAttention,
    Finished,
    ExitedWithError,
}

/// Identifies the direction in which a new pane is inserted.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub enum SplitDirectionDto {
    Right,
    Down,
}

/// Identifies the exact runtime structure requested for closing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export_to = "sessions/sessions.ts")]
pub enum CloseTargetDto {
    Session {
        session_id: String,
    },
    Tab {
        session_id: String,
        tab_id: String,
    },
    Pane {
        session_id: String,
        tab_id: String,
        pane_id: String,
    },
}

impl CloseTargetDto {
    /// Returns the parent session identifier carried by every close target.
    pub(crate) fn session_id(&self) -> &str {
        match self {
            Self::Session { session_id }
            | Self::Tab { session_id, .. }
            | Self::Pane { session_id, .. } => session_id,
        }
    }

    /// Returns the most specific opaque identifier for sanitized failures.
    pub(crate) fn target_id(&self) -> &str {
        match self {
            Self::Session { session_id } => session_id,
            Self::Tab { tab_id, .. } => tab_id,
            Self::Pane { pane_id, .. } => pane_id,
        }
    }
}

/// Reports current process and unsaved-file blockers for a close target.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub struct CloseImpactDto {
    pub target: CloseTargetDto,
    pub requires_confirmation: bool,
    pub running_process_count: u32,
    pub running_process_labels: Vec<String>,
    pub unsaved_file_count: u32,
    pub unsaved_file_labels: Vec<String>,
}

/// Returns the surviving session snapshot after a close mutation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub struct CloseResultDto {
    pub target: CloseTargetDto,
    pub session: Option<SessionDetailDto>,
}

/// Carries a committed runtime invalidation and its post-mutation summary.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub struct SessionRuntimeEventDto {
    pub revision: String,
    pub change: SessionChangeKindDto,
    pub project_id: String,
    pub session_id: String,
    pub summary: Option<SessionSummaryDto>,
}

/// Classifies the observable change represented by a runtime event.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "sessions/sessions.ts")]
pub enum SessionChangeKindDto {
    Created,
    Updated,
    ActivityChanged,
    Deleted,
}

/// Reports whether a project may receive a newly created session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectSessionAvailability {
    Available,
    Unavailable,
}

/// Carries the current profile title and launch availability needed by Sessions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchableProfile {
    pub id: String,
    pub display_name: String,
    pub is_available: bool,
}

/// Describes content owned by Sessions or a future backend capability.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum PaneContentRef {
    ToolSelection {
        profile_id: String,
        title: String,
    },
    Terminal {
        terminal_id: String,
        profile_id: String,
        title: String,
    },
    File {
        file_handle_id: String,
        title: String,
    },
}

impl PaneContentRef {
    /// Converts backend-owned content into its safe public DTO.
    pub(crate) fn to_dto(&self) -> PaneContentDto {
        match self {
            Self::ToolSelection { profile_id, title } => PaneContentDto::ToolSelection {
                profile_id: profile_id.clone(),
                title: title.clone(),
            },
            Self::Terminal {
                terminal_id,
                profile_id,
                title,
            } => PaneContentDto::Terminal {
                terminal_id: terminal_id.clone(),
                profile_id: profile_id.clone(),
                title: title.clone(),
            },
            Self::File {
                file_handle_id,
                title,
            } => PaneContentDto::File {
                file_handle_id: file_handle_id.clone(),
                title: title.clone(),
            },
        }
    }

    /// Converts a non-empty DTO into the internal content-port representation.
    pub(crate) fn from_dto(content: &PaneContentDto) -> Option<Self> {
        match content {
            PaneContentDto::Empty => None,
            PaneContentDto::ToolSelection { profile_id, title } => Some(Self::ToolSelection {
                profile_id: profile_id.clone(),
                title: title.clone(),
            }),
            PaneContentDto::Terminal {
                terminal_id,
                profile_id,
                title,
            } => Some(Self::Terminal {
                terminal_id: terminal_id.clone(),
                profile_id: profile_id.clone(),
                title: title.clone(),
            }),
            PaneContentDto::File {
                file_handle_id,
                title,
            } => Some(Self::File {
                file_handle_id: file_handle_id.clone(),
                title: title.clone(),
            }),
        }
    }
}

/// Carries current close blockers supplied by a pane content owner.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PaneCloseImpact {
    pub running_process_labels: Vec<String>,
    pub unsaved_file_labels: Vec<String>,
}

/// Selects whether closed content is discarded or retained for tab reopen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseRetention {
    Discard,
    ReopenLastTab,
}

/// Identifies the backend owner responsible for a retained content token.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PaneContentOwner {
    Sessions,
    Terminal,
    Files,
}

/// Carries an opaque runtime-only token used to reopen content.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ReopenHandle {
    pub owner: PaneContentOwner,
    pub token: String,
}

/// Replaces the aggregate activity facts for one pane.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PaneActivitySnapshot {
    pub running_process_count: u32,
    pub needs_attention: bool,
    pub finished_process_count: u32,
    pub failed_process_count: u32,
}

/// Reports runtime counts used by application Quit and Reset.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ShutdownImpact {
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

/// Reports runtime counts scoped to one project removal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProjectSessionsImpact {
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

/// Supplies notification policy with one consistent session visibility snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionNotificationContext {
    pub project_id: String,
    pub session_name: String,
    pub is_observed: bool,
}

/// Carries an attention summary and the revision of its latest transition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionAttentionSnapshot {
    pub summary: SessionSummaryDto,
    pub attention_sequence: u64,
}

/// Boxes an asynchronous dependency operation while preserving borrowed inputs.
pub type PaneRuntimeFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Supplies project availability and display ordering to Sessions.
pub trait ProjectSessionAccess: Send + Sync {
    /// Resolves whether one project may receive a new session.
    fn session_availability<'a>(
        &'a self,
        project_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<ProjectSessionAvailability, SessionsError>>;

    /// Returns project identifiers in Projects-owned display order.
    fn ordered_project_ids<'a>(
        &'a self,
    ) -> PaneRuntimeFuture<'a, Result<Vec<String>, SessionsError>>;
}

/// Supplies current CLI profile launchability without resolving launch secrets.
pub trait CliProfileLookup: Send + Sync {
    /// Resolves one profile's current display name and availability.
    fn launchable_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<LaunchableProfile, SessionsError>>;
}

/// Owns close, reopen, and impact work for non-empty pane content.
pub trait PaneContentRuntime: Send + Sync {
    /// Inspects current process and unsaved-file blockers.
    fn close_impact<'a>(
        &'a self,
        content: &'a PaneContentRef,
    ) -> PaneRuntimeFuture<'a, Result<PaneCloseImpact, SessionsError>>;

    /// Closes content and optionally returns a runtime-only reopen handle.
    fn close<'a>(
        &'a self,
        content: &'a PaneContentRef,
        retention: CloseRetention,
    ) -> PaneRuntimeFuture<'a, Result<Option<ReopenHandle>, SessionsError>>;

    /// Restores retained content without restarting a process.
    fn reopen<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<PaneContentRef, SessionsError>>;

    /// Permanently releases an evicted runtime-only handle.
    fn discard<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<(), SessionsError>>;
}

/// Trims and validates a session or tab display name.
pub(crate) fn normalize_name(name: &str) -> Result<String, SessionsError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 80 || trimmed.chars().any(char::is_control) {
        return Err(SessionsError::InvalidName);
    }
    Ok(trimmed.to_owned())
}

/// Counts pane leaves in one layout without trusting frontend state.
pub(crate) fn pane_count(node: &PaneLayoutNodeDto) -> usize {
    match node {
        PaneLayoutNodeDto::Pane { .. } => 1,
        PaneLayoutNodeDto::Split { first, second, .. } => pane_count(first) + pane_count(second),
    }
}

/// Finds one immutable pane leaf by opaque identifier.
pub(crate) fn find_pane<'a>(node: &'a PaneLayoutNodeDto, pane_id: &str) -> Option<&'a PaneDto> {
    match node {
        PaneLayoutNodeDto::Pane { pane } => (pane.id == pane_id).then_some(pane),
        PaneLayoutNodeDto::Split { first, second, .. } => {
            // The second subtree is searched only when the first has no matching leaf.
            find_pane(first, pane_id).or_else(|| find_pane(second, pane_id))
        }
    }
}

/// Finds one mutable pane leaf by opaque identifier.
pub(crate) fn find_pane_mut<'a>(
    node: &'a mut PaneLayoutNodeDto,
    pane_id: &str,
) -> Option<&'a mut PaneDto> {
    match node {
        PaneLayoutNodeDto::Pane { pane } => (pane.id == pane_id).then_some(pane),
        PaneLayoutNodeDto::Split { first, second, .. } => {
            // The mutable first-subtree borrow ends before the sibling search begins.
            find_pane_mut(first, pane_id).or_else(|| find_pane_mut(second, pane_id))
        }
    }
}

/// Finds one split node's current ratio.
pub(crate) fn find_split_ratio_mut<'a>(
    node: &'a mut PaneLayoutNodeDto,
    split_id: &str,
) -> Option<&'a mut u16> {
    match node {
        PaneLayoutNodeDto::Pane { .. } => None,
        PaneLayoutNodeDto::Split {
            split_id: current,
            ratio_basis_points,
            first,
            second,
            ..
        } => {
            if current == split_id {
                Some(ratio_basis_points)
            } else {
                find_split_ratio_mut(first, split_id)
                    // A valid split identifier can occur only in the sibling subtree now.
                    .or_else(|| find_split_ratio_mut(second, split_id))
            }
        }
    }
}

/// Replaces one pane leaf with a newly constructed split node.
pub(crate) fn replace_pane_with_split(
    node: &mut PaneLayoutNodeDto,
    pane_id: &str,
    split_id: String,
    new_pane: PaneDto,
    direction: SplitDirectionDto,
) -> bool {
    match node {
        PaneLayoutNodeDto::Pane { pane } if pane.id == pane_id => {
            let existing = node.clone();
            *node = PaneLayoutNodeDto::Split {
                split_id,
                axis: match direction {
                    SplitDirectionDto::Right => SplitAxisDto::Vertical,
                    SplitDirectionDto::Down => SplitAxisDto::Horizontal,
                },
                ratio_basis_points: 5000,
                first: Box::new(existing),
                second: Box::new(PaneLayoutNodeDto::Pane { pane: new_pane }),
            };
            true
        }
        PaneLayoutNodeDto::Pane { .. } => false,
        PaneLayoutNodeDto::Split { first, second, .. } => {
            replace_pane_with_split(
                first,
                pane_id,
                split_id.clone(),
                new_pane.clone(),
                direction,
            ) || replace_pane_with_split(second, pane_id, split_id, new_pane, direction)
        }
    }
}

/// Removes one leaf and collapses its parent split into the sibling subtree.
pub(crate) fn collapse_pane(node: &mut PaneLayoutNodeDto, pane_id: &str) -> Option<String> {
    let PaneLayoutNodeDto::Split { first, second, .. } = node else {
        return None;
    };
    if matches!(first.as_ref(), PaneLayoutNodeDto::Pane { pane } if pane.id == pane_id) {
        let replacement = (**second).clone();
        let nearest = first_pane_id(&replacement).to_owned();
        *node = replacement;
        return Some(nearest);
    }
    if matches!(second.as_ref(), PaneLayoutNodeDto::Pane { pane } if pane.id == pane_id) {
        let replacement = (**first).clone();
        let nearest = last_pane_id(&replacement).to_owned();
        *node = replacement;
        return Some(nearest);
    }
    collapse_pane(first, pane_id)
        // Search the sibling only when the target was not nested in the first subtree.
        .or_else(|| collapse_pane(second, pane_id))
}

/// Returns the first pane identifier in visual tree order.
pub(crate) fn first_pane_id(node: &PaneLayoutNodeDto) -> &str {
    match node {
        PaneLayoutNodeDto::Pane { pane } => &pane.id,
        PaneLayoutNodeDto::Split { first, .. } => first_pane_id(first),
    }
}

/// Returns the last pane identifier in visual tree order.
pub(crate) fn last_pane_id(node: &PaneLayoutNodeDto) -> &str {
    match node {
        PaneLayoutNodeDto::Pane { pane } => &pane.id,
        PaneLayoutNodeDto::Split { second, .. } => last_pane_id(second),
    }
}

/// Collects all pane leaves in stable visual tree order.
pub(crate) fn collect_panes(node: &PaneLayoutNodeDto, panes: &mut Vec<PaneDto>) {
    match node {
        PaneLayoutNodeDto::Pane { pane } => panes.push(pane.clone()),
        PaneLayoutNodeDto::Split { first, second, .. } => {
            collect_panes(first, panes);
            collect_panes(second, panes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds one empty pane leaf for pure layout tests.
    fn leaf(id: &str) -> PaneLayoutNodeDto {
        PaneLayoutNodeDto::Pane {
            pane: PaneDto {
                id: id.to_owned(),
                content: PaneContentDto::Empty,
            },
        }
    }

    /// Verifies names use trimmed Unicode scalar values and reject control characters.
    #[test]
    fn names_follow_the_unicode_contract() {
        assert_eq!(normalize_name("  hello  "), Ok("hello".to_owned()));
        assert!(normalize_name(&"é".repeat(80)).is_ok());
        assert_eq!(
            normalize_name(&"é".repeat(81)),
            Err(SessionsError::InvalidName)
        );
        assert_eq!(normalize_name("bad\nname"), Err(SessionsError::InvalidName));
    }

    /// Verifies right and down splits preserve old-first and new-second ordering.
    #[test]
    fn split_and_collapse_preserve_tree_rules() {
        let mut layout = leaf("pane-1");
        assert!(replace_pane_with_split(
            &mut layout,
            "pane-1",
            "split-2".to_owned(),
            PaneDto {
                id: "pane-3".to_owned(),
                content: PaneContentDto::Empty
            },
            SplitDirectionDto::Right,
        ));
        assert_eq!(pane_count(&layout), 2);
        assert!(matches!(
            layout,
            PaneLayoutNodeDto::Split {
                axis: SplitAxisDto::Vertical,
                ratio_basis_points: 5000,
                ..
            }
        ));
        assert_eq!(
            collapse_pane(&mut layout, "pane-1"),
            Some("pane-3".to_owned())
        );
        assert_eq!(first_pane_id(&layout), "pane-3");
    }

    /// Verifies data-bearing enum fields serialize with the exact camel-case IPC shape.
    #[test]
    fn data_enum_fields_are_camel_case() {
        let target = CloseTargetDto::Pane {
            session_id: "session-1".to_owned(),
            tab_id: "tab-2".to_owned(),
            pane_id: "pane-3".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(target).expect("the close target should serialize"),
            serde_json::json!({
                "kind": "pane",
                "sessionId": "session-1",
                "tabId": "tab-2",
                "paneId": "pane-3"
            })
        );
        let mut layout = leaf("pane-1");
        replace_pane_with_split(
            &mut layout,
            "pane-1",
            "split-2".to_owned(),
            PaneDto {
                id: "pane-3".to_owned(),
                content: PaneContentDto::Empty,
            },
            SplitDirectionDto::Down,
        );
        let value = serde_json::to_value(layout).expect("the layout should serialize");
        assert_eq!(value["splitId"], "split-2");
        assert_eq!(value["ratioBasisPoints"], 5000);
        assert_eq!(value["axis"], "horizontal");
    }
}
