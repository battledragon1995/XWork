use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "reminders.ts")]
pub enum ReminderDeliveryStatusDto {
    Active,
    Missed,
    Snoozed,
    Dismissed,
    Suppressed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "reminders.ts")]
pub struct ReminderDeliveryDto {
    pub id: String,
    pub event_id: String,
    pub occurrence_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub starts_at_ms: String,
    pub original_due_at_ms: String,
    pub time_zone_id: String,
    pub minutes_before: u32,
    pub status: ReminderDeliveryStatusDto,
    pub snoozed_until_ms: Option<String>,
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "reminders.ts")]
pub struct ReminderCursorDto {
    pub original_due_at_ms: String,
    pub id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "reminders.ts")]
pub struct MissedReminderPageDto {
    pub sequence: String,
    pub missed_count: u32,
    pub items: Vec<ReminderDeliveryDto>,
    pub next_cursor: Option<ReminderCursorDto>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "reminders.ts")]
pub struct EventReminderDeliveriesDto {
    pub sequence: String,
    pub event_id: String,
    pub occurrence_id: String,
    pub items: Vec<ReminderDeliveryDto>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "reminders.ts")]
pub struct ReminderTargetDto {
    pub event_id: String,
    pub occurrence_id: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "reminders.ts")]
pub struct ReminderActionResultDto {
    pub sequence: String,
    pub missed_count: u32,
    pub delivery: ReminderDeliveryDto,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    export_to = "reminders.ts"
)]
pub enum VisibleCalendarEventInputDto {
    Show {
        view_token: String,
        event_id: String,
        occurrence_id: Option<String>,
    },
    Hide {
        view_token: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "reminders.ts")]
pub struct ReminderChangedDto {
    pub sequence: String,
    pub missed_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case", export_to = "reminders.ts")]
pub enum ReminderError {
    UnauthorizedWindow,
    InvalidDeliveryId,
    InvalidEventId,
    InvalidOccurrenceId,
    InvalidViewToken,
    InvalidVersion,
    InvalidCursor,
    InvalidLimit { min: u16, max: u16 },
    InvalidSnoozeMinutes,
    DeliveryNotFound,
    DeliveryChanged,
    ActionNotAllowed,
    TargetUnavailable,
    ClockOutOfRange,
    SchedulerCatchingUp,
    DependencyUnavailable,
    CorruptStoredDelivery { field: String },
    PersistenceFailed,
    Unavailable,
}

impl std::fmt::Display for ReminderError {
    /// Formats only a sanitized error category.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for ReminderError {}
impl From<crate::storage::StorageError> for ReminderError {
    /// Hides storage details at the reminder boundary.
    fn from(_: crate::storage::StorageError) -> Self {
        Self::PersistenceFailed
    }
}
impl From<rusqlite::Error> for ReminderError {
    /// Hides SQL and stored content at the reminder boundary.
    fn from(_: rusqlite::Error) -> Self {
        Self::PersistenceFailed
    }
}
/// Validates canonical lowercase UUID v4 identifiers.
pub(crate) fn reminder_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(
        // Rejects aliases and non-random UUID versions.
        |id| id.get_version_num() == 4 && id.to_string() == value,
    )
}
/// Validates the stable prefixed delivery identity.
pub(crate) fn delivery_id(value: &str) -> Result<(), ReminderError> {
    if value
        .strip_prefix("reminder-delivery-")
        .is_some_and(reminder_uuid)
    {
        Ok(())
    } else {
        Err(ReminderError::InvalidDeliveryId)
    }
}
/// Parses one lossless nonnegative SQLite integer without aliases.
pub(crate) fn decimal(value: &str) -> Option<i64> {
    value.parse::<i64>().ok().filter(
        // Rejects negatives and noncanonical decimal spellings.
        |n| *n >= 0 && n.to_string() == value,
    )
}
/// Validates the public event and occurrence pair without accessing Calendar storage.
pub(crate) fn event_ids(event: &str, occurrence: &str) -> Result<(), ReminderError> {
    if !reminder_uuid(event) {
        return Err(ReminderError::InvalidEventId);
    }
    if occurrence.is_empty() || occurrence.len() > 80 || occurrence.chars().any(char::is_control) {
        return Err(ReminderError::InvalidOccurrenceId);
    }
    Ok(())
}
