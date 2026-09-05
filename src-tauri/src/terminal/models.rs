use std::{
    fmt::{Display, Formatter},
    future::Future,
    path::PathBuf,
    pin::Pin,
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ResolvedCliProfile;

/// Contains a measured terminal grid size.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub struct PtySizeDto {
    pub columns: u16,
    pub rows: u16,
}

impl PtySizeDto {
    /// Validates the supported terminal grid bounds.
    pub fn validate(self) -> Result<Self, TerminalError> {
        if !(2..=500).contains(&self.columns) || !(1..=300).contains(&self.rows) {
            return Err(TerminalError::InvalidPtySize);
        }
        Ok(self)
    }
}

/// Describes the public process state of a terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub enum TerminalProcessStateDto {
    Running,
    Closing,
    Exited,
    Failed,
}

/// Classifies a launch profile that cannot currently resolve.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub enum TerminalProfileUnavailableReasonDto {
    CommandNotFound,
    ShellNotFound,
    CredentialMissing,
    CredentialStoreUnavailable,
}

/// Contains the safe public snapshot of one terminal runtime.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub struct TerminalDto {
    pub id: String,
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub profile_id: String,
    pub title: String,
    pub size: PtySizeDto,
    pub state: TerminalProcessStateDto,
    pub exit_code: Option<String>,
    pub was_terminated: bool,
    pub needs_attention: bool,
    pub output_subscribed: bool,
    pub latest_output_sequence: String,
}

/// Reports output replay boundaries after attaching a subscriber.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub struct TerminalSubscriptionDto {
    pub terminal: TerminalDto,
    pub first_available_sequence: String,
    pub latest_sequence: String,
}

/// Acknowledges one fully written terminal input chunk.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub struct TerminalInputAckDto {
    pub accepted_sequence: String,
}

/// Acknowledges the latest applied terminal resize.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub struct TerminalResizeAckDto {
    pub accepted_sequence: String,
    pub size: PtySizeDto,
}

/// Classifies one low-frequency terminal state change.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub enum TerminalStateChangeKindDto {
    ProcessChanged,
    AttentionChanged,
    StreamDetached,
    Disposed,
}

/// Carries a safe terminal state change without terminal bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/terminal.ts")]
pub struct TerminalStateChangedDto {
    pub change: TerminalStateChangeKindDto,
    pub terminal: TerminalDto,
    pub final_output_sequence: Option<String>,
}

/// Identifies the authoritative Sessions pane selected for launch.
pub struct TerminalPaneTarget {
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub project_id: String,
    pub profile_id: String,
    pub title: String,
}

/// Replaces the Sessions-owned activity facts for one terminal pane.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerminalActivity {
    pub running_process_count: u32,
    pub needs_attention: bool,
    pub finished_process_count: u32,
    pub failed_process_count: u32,
}

/// Boxes an asynchronous Terminal dependency operation.
pub type TerminalFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Supplies authoritative owner operations consumed by Terminal.
pub trait TerminalDependencies: Send + Sync {
    /// Resolves and validates the current tool-selection pane.
    fn launch_target<'a>(
        &'a self,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<TerminalPaneTarget, TerminalError>>;
    /// Resolves the current canonical project root.
    fn available_project_root<'a>(
        &'a self,
        project_id: &'a str,
    ) -> TerminalFuture<'a, Result<PathBuf, TerminalError>>;
    /// Resolves structured launch data immediately before spawn.
    fn resolve_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> TerminalFuture<'a, Result<ResolvedCliProfile, TerminalError>>;
    /// Replaces a tool selection with the spawned terminal.
    fn attach_terminal<'a>(
        &'a self,
        target: &'a TerminalPaneTarget,
        terminal_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>>;
    /// Records one real output edge for unseen-output aggregation.
    fn record_output<'a>(
        &'a self,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>>;
    /// Replaces the current pane activity snapshot.
    fn update_activity<'a>(
        &'a self,
        pane_id: &'a str,
        activity: TerminalActivity,
    ) -> TerminalFuture<'a, Result<(), TerminalError>>;
}

/// Describes stable Terminal failures without exposing launch or stream data.
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
#[ts(export_to = "terminal/terminal.ts")]
pub enum TerminalError {
    UnauthorizedWindow,
    InvalidRuntimeId {
        field: String,
    },
    SessionNotFound {
        session_id: String,
    },
    TabNotFound {
        tab_id: String,
    },
    PaneNotFound {
        pane_id: String,
    },
    PaneNotLaunchable {
        pane_id: String,
    },
    TerminalAlreadyAttached {
        pane_id: String,
        terminal_id: Option<String>,
    },
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
        reason: TerminalProfileUnavailableReasonDto,
    },
    ProfileLookupFailed,
    InvalidPtySize,
    InvalidSequence {
        field: String,
    },
    InputOutOfOrder {
        expected_sequence: String,
        received_sequence: String,
    },
    InputTooLarge {
        max_bytes: u32,
    },
    TerminalNotFound {
        terminal_id: String,
    },
    TerminalNotRunning {
        terminal_id: String,
    },
    OutputReplayUnavailable {
        first_available_sequence: String,
        latest_sequence: String,
    },
    StreamAttachFailed,
    PtyUnavailable,
    PtyOpenFailed,
    ProcessSpawnFailed,
    ProcessIoFailed,
    ResizeFailed,
    TerminationFailed,
    SessionAttachFailed,
    RuntimeShuttingDown,
}

impl Display for TerminalError {
    /// Formats only a stable category and never payload data.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::UnauthorizedWindow => "the invoking window cannot access terminals",
            Self::InvalidRuntimeId { .. } => "a runtime identifier is invalid",
            Self::SessionNotFound { .. } => "the session no longer exists",
            Self::TabNotFound { .. } => "the tab no longer exists",
            Self::PaneNotFound { .. } => "the pane no longer exists",
            Self::PaneNotLaunchable { .. } => "the pane cannot launch a terminal",
            Self::TerminalAlreadyAttached { .. } => "the pane already owns a terminal",
            Self::ProjectNotFound { .. } => "the project no longer exists",
            Self::ProjectUnavailable { .. } => "the project is unavailable",
            Self::ProjectLookupFailed => "the project root could not be resolved",
            Self::ProfileNotFound { .. } => "the profile no longer exists",
            Self::ProfileUnavailable { .. } => "the profile is unavailable",
            Self::ProfileLookupFailed => "the profile could not be resolved",
            Self::InvalidPtySize => "the terminal size is invalid",
            Self::InvalidSequence { .. } => "a terminal sequence is invalid",
            Self::InputOutOfOrder { .. } => "terminal input is out of order",
            Self::InputTooLarge { .. } => "terminal input is too large",
            Self::TerminalNotFound { .. } => "the terminal no longer exists",
            Self::TerminalNotRunning { .. } => "the terminal is not running",
            Self::OutputReplayUnavailable { .. } => "terminal output replay is unavailable",
            Self::StreamAttachFailed => "the terminal output stream could not be attached",
            Self::PtyUnavailable => "the native terminal service is unavailable",
            Self::PtyOpenFailed => "the native terminal could not be opened",
            Self::ProcessSpawnFailed => "the terminal process could not be started",
            Self::ProcessIoFailed => "terminal process I/O failed",
            Self::ResizeFailed => "the terminal could not be resized",
            Self::TerminationFailed => "the terminal process tree could not be stopped",
            Self::SessionAttachFailed => "the terminal could not be attached to its pane",
            Self::RuntimeShuttingDown => "the terminal runtime is shutting down",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for TerminalError {}

/// Parses a decimal sequence without accepting signs or whitespace.
pub(crate) fn parse_sequence(value: &str, field: &str) -> Result<u64, TerminalError> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(TerminalError::InvalidSequence {
            field: field.to_owned(),
        });
    }
    value.parse().map_err(|_| TerminalError::InvalidSequence {
        field: field.to_owned(),
    })
}

/// Validates one runtime identifier using its owner prefix and decimal counter.
pub(crate) fn validate_runtime_id(
    value: &str,
    prefix: &str,
    field: &str,
) -> Result<(), TerminalError> {
    let Some(counter) = value.strip_prefix(prefix) else {
        return Err(TerminalError::InvalidRuntimeId {
            field: field.to_owned(),
        });
    };
    if counter.is_empty()
        || !counter.bytes().all(|byte| byte.is_ascii_digit())
        || counter.parse::<u64>().is_err()
    {
        return Err(TerminalError::InvalidRuntimeId {
            field: field.to_owned(),
        });
    }
    Ok(())
}

/// Validates a profile identifier, including immutable built-in IDs.
pub(crate) fn validate_profile_id(value: &str) -> Result<(), TerminalError> {
    if matches!(
        value,
        "builtin:terminal" | "builtin:codex" | "builtin:claude"
    ) {
        return Ok(());
    }
    let Some(identifier) = value.strip_prefix("profile-") else {
        return Err(TerminalError::InvalidRuntimeId {
            field: "profileId".to_owned(),
        });
    };
    if uuid::Uuid::try_parse(identifier).is_err() || identifier != identifier.to_ascii_lowercase() {
        return Err(TerminalError::InvalidRuntimeId {
            field: "profileId".to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies size, sequence, and runtime identifier boundaries.
    #[test]
    fn validates_public_scalars() {
        assert!(
            PtySizeDto {
                columns: 2,
                rows: 1
            }
            .validate()
            .is_ok()
        );
        assert!(
            PtySizeDto {
                columns: 0,
                rows: 1
            }
            .validate()
            .is_err()
        );
        assert_eq!(
            parse_sequence("18446744073709551615", "sequence"),
            Ok(u64::MAX)
        );
        assert!(parse_sequence("18446744073709551616", "sequence").is_err());
        assert!(validate_runtime_id("terminal-1", "terminal-", "terminalId").is_ok());
        assert!(validate_profile_id("builtin:terminal").is_ok());
        assert!(validate_profile_id("profile-11111111-1111-4111-8111-111111111111").is_ok());
    }

    /// Verifies public serialization is camel-case and diagnostics redact payloads.
    #[test]
    fn serializes_safely() {
        let error = TerminalError::TerminalAlreadyAttached {
            pane_id: "sensitive-pane".into(),
            terminal_id: Some("sensitive-terminal".into()),
        };
        let value = serde_json::to_value(&error).expect("the error should serialize");
        assert_eq!(value["code"], "terminalAlreadyAttached");
        assert_eq!(value["paneId"], "sensitive-pane");
        let display = error.to_string();
        assert!(!display.contains("sensitive"));
    }
}
