use std::fmt::{Display, Formatter};

use serde::Serialize;
use ts_rs::TS;

use super::models::CloseImpactDto;

/// Describes stable Sessions failures without exposing user content or native errors.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "code",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "code",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export_to = "sessions/sessions.ts")]
pub enum SessionsError {
    UnauthorizedWindow,
    ProjectNotFound {
        project_id: String,
    },
    ProjectUnavailable {
        project_id: String,
    },
    ProjectLookupFailed,
    ProfileNotFound {
        profile_id: String,
    },
    ProfileUnavailable {
        profile_id: String,
    },
    ProfileLookupFailed,
    SessionNotFound {
        session_id: String,
    },
    TabNotFound {
        tab_id: String,
    },
    PaneNotFound {
        pane_id: String,
    },
    SplitNotFound {
        split_id: String,
    },
    InvalidName,
    InvalidMove,
    InvalidSplitRatio,
    PaneLimitReached,
    SessionNotEmpty,
    PaneNotEmpty,
    NoClosedTab {
        session_id: String,
    },
    ConfirmationRequired {
        impact: CloseImpactDto,
    },
    CloseInProgress {
        session_id: String,
    },
    ContentLifecycleFailed {
        operation: String,
        target_id: String,
    },
    RuntimeShuttingDown,
}

impl Display for SessionsError {
    /// Formats only the stable category so user-controlled values never reach logs.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::UnauthorizedWindow => "the invoking window cannot access sessions",
            Self::ProjectNotFound { .. } => "the project no longer exists",
            Self::ProjectUnavailable { .. } => "the project is currently unavailable",
            Self::ProjectLookupFailed => "the project snapshot could not be read",
            Self::ProfileNotFound { .. } => "the CLI profile no longer exists",
            Self::ProfileUnavailable { .. } => "the CLI profile is currently unavailable",
            Self::ProfileLookupFailed => "the CLI profile snapshot could not be read",
            Self::SessionNotFound { .. } => "the session no longer exists",
            Self::TabNotFound { .. } => "the tab no longer exists",
            Self::PaneNotFound { .. } => "the pane no longer exists",
            Self::SplitNotFound { .. } => "the split no longer exists",
            Self::InvalidName => "the display name is not valid",
            Self::InvalidMove => "the tab move is not valid",
            Self::InvalidSplitRatio => "the split ratio is not valid",
            Self::PaneLimitReached => "the pane limit has been reached",
            Self::SessionNotEmpty => "the session already contains a tab",
            Self::PaneNotEmpty => "the pane already contains content",
            Self::NoClosedTab { .. } => "there is no retained tab to reopen",
            Self::ConfirmationRequired { .. } => "the close operation requires confirmation",
            Self::CloseInProgress { .. } => "the session already has a close operation",
            Self::ContentLifecycleFailed { .. } => "pane content lifecycle work failed",
            Self::RuntimeShuttingDown => "the session runtime is shutting down",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for SessionsError {}

#[cfg(test)]
mod tests {
    use super::SessionsError;

    /// Verifies error text omits every opaque identifier carried by a variant.
    #[test]
    fn display_redacts_payloads() {
        let error = SessionsError::ContentLifecycleFailed {
            operation: "close".to_owned(),
            target_id: "pane-secret".to_owned(),
        };
        let text = error.to_string();
        assert!(!text.contains("pane-secret"));
        assert!(!text.contains("close"));
    }

    /// Verifies error payload fields use the exact generated camel-case contract.
    #[test]
    fn error_payload_fields_are_camel_case() {
        let value = serde_json::to_value(SessionsError::ContentLifecycleFailed {
            operation: "close".to_owned(),
            target_id: "pane-1".to_owned(),
        })
        .expect("the error should serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "code": "contentLifecycleFailed",
                "operation": "close",
                "targetId": "pane-1"
            })
        );
    }
}
