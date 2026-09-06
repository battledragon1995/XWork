use crate::sessions::SessionNotificationContext;
use serde::{Deserialize, Serialize};
use std::{future::Future, pin::Pin};
use ts_rs::TS;

/// Identifies the three Phase 1 terminal occurrences.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "notifications/notifications.ts")]
pub enum NotificationKindDto {
    TerminalNeedsInput,
    TerminalProcessFinished,
    TerminalProcessFailed,
}

/// Returns an opaque live route without exposing terminal source identity.
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
#[ts(export_to = "notifications/notifications.ts")]
pub enum NotificationTargetDto {
    Session {
        project_id: String,
        session_id: String,
        tab_id: String,
        pane_id: String,
    },
}

/// Contains one sanitized event-time notification snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "notifications/notifications.ts")]
pub struct NotificationDto {
    pub id: String,
    pub kind: NotificationKindDto,
    pub title: String,
    pub context: String,
    pub target: NotificationTargetDto,
    pub status_code: Option<String>,
    pub created_at_ms: String,
    pub read_at_ms: Option<String>,
}
/// Carries the last descending key from the preceding page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "notifications/notifications.ts")]
pub struct NotificationCursorDto {
    pub created_at_ms: String,
    pub id: String,
}
/// Returns a bounded page and the whole-center unread count.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "notifications/notifications.ts")]
pub struct NotificationPageDto {
    pub revision: String,
    pub unread_count: u32,
    pub items: Vec<NotificationDto>,
    pub next_cursor: Option<NotificationCursorDto>,
}
/// Reports one committed mutation or unchanged snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "notifications/notifications.ts")]
pub struct NotificationCenterStateDto {
    pub revision: String,
    pub unread_count: u32,
    pub affected_count: u32,
}
/// Combines an exact live navigation target with its read-state change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "notifications/notifications.ts")]
pub struct OpenNotificationDto {
    pub target: NotificationTargetDto,
    pub state: NotificationCenterStateDto,
}
/// Invalidates frontend page caches after a committed change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "notifications/notifications.ts")]
pub struct NotificationCenterChangedDto {
    pub revision: String,
    pub unread_count: u32,
}
/// Exposes stable error categories without database or user content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
#[ts(export_to = "notifications/notifications.ts")]
pub enum NotificationError {
    UnauthorizedWindow,
    InvalidNotificationId,
    InvalidCursor,
    InvalidLimit { min: u16, max: u16 },
    NotificationNotFound,
    TargetUnavailable,
    DependencyUnavailable,
    CorruptStoredNotification { field: String },
    PersistenceFailed,
    Unavailable,
}
impl std::fmt::Display for NotificationError {
    /// Displays only the sanitized typed error.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for NotificationError {}
impl From<crate::storage::StorageError> for NotificationError {
    /// Removes internal storage details at the capability boundary.
    fn from(_: crate::storage::StorageError) -> Self {
        Self::PersistenceFailed
    }
}
impl From<rusqlite::Error> for NotificationError {
    /// Removes raw SQL and database paths from errors.
    fn from(_: rusqlite::Error) -> Self {
        Self::PersistenceFailed
    }
}
/// Carries effective terminal intake and OS policy without exposing settings IPC.
pub struct TerminalNotificationPolicy {
    pub terminal_activity_enabled: bool,
    pub os_needs_input: bool,
    pub os_process_finished: bool,
    pub os_process_failed: bool,
}
/// Reserves the documented Rust consumer shape for the later Calendar adapter.
pub struct NotificationEventTarget {
    pub event_id: String,
    pub occurrence_id: String,
    pub project_id: Option<String>,
}
pub type NotificationFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
/// Resolves owner facts without crossing capability implementation boundaries.
pub trait NotificationDependencies: Send + Sync {
    /// Reads current session display context.
    fn session_context<'a>(
        &'a self,
        session_id: &'a str,
    ) -> NotificationFuture<'a, Result<Option<SessionNotificationContext>, NotificationError>>;
    /// Validates the full live terminal target relationship.
    fn session_target_exists<'a>(
        &'a self,
        project_id: &'a str,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
        terminal_id: &'a str,
    ) -> NotificationFuture<'a, Result<bool, NotificationError>>;
    /// Resolves future Calendar occurrences; Phase 1 returns None.
    fn event_target<'a>(
        &'a self,
        event_id: &'a str,
        occurrence_id: &'a str,
    ) -> NotificationFuture<'a, Result<Option<NotificationEventTarget>, NotificationError>>;
    /// Reads the effective policy at the ingestion decision point.
    fn terminal_policy(&self) -> Result<TerminalNotificationPolicy, NotificationError>;
}
/// Validates canonical lowercase version-four UUIDs.
pub(crate) fn uuid_valid(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        // Checks the canonical value before accepting the snapshot.
        .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
}
/// Validates the backend-generated notification identity.
pub(crate) fn validate_id(value: &str) -> Result<(), NotificationError> {
    // Checks the canonical value before accepting the snapshot.
    if value.strip_prefix("notification-").is_some_and(uuid_valid) {
        Ok(())
    } else {
        Err(NotificationError::InvalidNotificationId)
    }
}
/// Accepts only canonical nonnegative SQLite-range decimal timestamps.
pub(crate) fn timestamp(value: &str) -> Result<i64, NotificationError> {
    value
        .parse::<i64>()
        .ok()
        // Keeps only values permitted by the public normalization contract.
        .filter(|n| *n >= 0 && n.to_string() == value)
        .ok_or(NotificationError::InvalidCursor)
}
/// Collapses whitespace and removes non-whitespace controls before scalar truncation.
pub(crate) fn normalize(value: &str, limit: usize) -> String {
    value
        .chars()
        // Keeps only values permitted by the public normalization contract.
        .filter(|c| !c.is_control() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}
