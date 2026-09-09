use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "calendar.ts")]
pub enum CalendarWeekdayDto {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
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
    export_to = "calendar.ts"
)]
pub enum EventRecurrenceEndDto {
    Never,
    OnDate { date: String },
    AfterCount { count: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
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
    export_to = "calendar.ts"
)]
pub enum EventRecurrenceDto {
    None,
    Daily {
        end: EventRecurrenceEndDto,
    },
    Weekly {
        weekdays: Vec<CalendarWeekdayDto>,
        end: EventRecurrenceEndDto,
    },
    Monthly {
        end: EventRecurrenceEndDto,
    },
    Yearly {
        end: EventRecurrenceEndDto,
    },
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
    export_to = "calendar.ts"
)]
pub enum EventTimeInputDto {
    Timed {
        start_local: String,
        end_local: String,
        time_zone_id: String,
    },
    AllDay {
        start_date: String,
        end_date_exclusive: String,
        time_zone_id: String,
    },
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
    export_to = "calendar.ts"
)]
pub enum EventTimeDto {
    Timed {
        start_local: String,
        end_local: String,
        time_zone_id: String,
        #[ts(type = "number")]
        start_at_ms: i64,
        #[ts(type = "number")]
        end_at_ms: i64,
    },
    AllDay {
        start_date: String,
        end_date_exclusive: String,
        time_zone_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct EventInputDto {
    pub title: String,
    pub description: String,
    pub project_id: Option<String>,
    pub time: EventTimeInputDto,
    pub recurrence: EventRecurrenceDto,
    pub reminder_minutes_before: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct EventReminderDto {
    pub id: String,
    pub minutes_before: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct CalendarEventDto {
    pub id: String,
    pub title: String,
    pub description: String,
    pub project_id: Option<String>,
    pub time: EventTimeDto,
    pub recurrence: EventRecurrenceDto,
    pub reminders: Vec<EventReminderDto>,
    pub revision: String,
    #[ts(type = "number")]
    pub created_at_ms: i64,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct CalendarRangeInputDto {
    pub start_date: String,
    pub end_date_exclusive: String,
    pub viewer_time_zone_id: String,
    pub project_id: Option<String>,
    pub only_with_reminders: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct CalendarOccurrenceDto {
    pub occurrence_id: String,
    pub event_id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub time: EventTimeDto,
    pub recurrence: EventRecurrenceDto,
    pub reminders: Vec<EventReminderDto>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct CalendarOccurrenceListDto {
    pub revision: String,
    pub items: Vec<CalendarOccurrenceDto>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct EventRevisionInputDto {
    pub event_id: String,
    pub expected_revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct UpdateCalendarEventInputDto {
    pub event_id: String,
    pub expected_revision: String,
    pub event: EventInputDto,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct DeleteCalendarEventImpactDto {
    pub request_id: u32,
    pub event_id: String,
    pub title: String,
    pub is_recurring: bool,
    pub reminder_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct ConfirmDeleteCalendarEventInputDto {
    pub request_id: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct DeletedCalendarEventDto {
    pub event_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "calendar.ts")]
pub enum CalendarChangeKindDto {
    Created,
    Updated,
    Deleted,
    BackupImported,
    Reset,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "calendar.ts")]
pub struct CalendarChangedEventDto {
    pub sequence: String,
    pub kind: CalendarChangeKindDto,
    pub event_id: Option<String>,
    pub revision: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CalendarNotificationContext {
    pub event_id: String,
    pub occurrence_id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub starts_at_ms: i64,
    pub time_zone_id: String,
    pub reminder_definitions: Vec<CalendarReminderDefinition>,
}

#[derive(Clone, Debug)]
pub struct CalendarReminderDefinition {
    pub reminder_id: String,
    pub minutes_before: u32,
}

#[derive(Clone, Debug)]
pub struct CalendarReminderOccurrence {
    pub event_id: String,
    pub occurrence_id: String,
    pub reminder_id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub starts_at_ms: i64,
    pub due_at_ms: i64,
    pub time_zone_id: String,
    pub minutes_before: u32,
}

#[derive(Clone, Debug)]
pub struct CalendarEventSearchRecord {
    pub event_id: String,
    pub title: String,
    pub matching_description: Option<String>,
    pub project_id: Option<String>,
    pub starts_at_ms: i64,
    pub time_zone_id: String,
}

#[derive(Clone, Debug)]
pub struct CalendarEventSearchCandidates {
    pub items: Vec<CalendarEventSearchRecord>,
    pub has_more: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventBackupRecordV1 {
    pub id: String,
    pub title: String,
    pub description: String,
    pub project_id: Option<String>,
    pub time: EventTimeBackupV1,
    pub recurrence: EventRecurrenceBackupV1,
    pub reminders: Vec<EventReminderBackupRecordV1>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EventTimeBackupV1 {
    Timed {
        start_local: String,
        end_local: String,
        time_zone_id: String,
    },
    AllDay {
        start_date: String,
        end_date_exclusive: String,
        time_zone_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EventRecurrenceBackupV1 {
    None,
    Daily {
        end: EventRecurrenceEndBackupV1,
    },
    Weekly {
        weekdays: Vec<CalendarWeekdayBackupV1>,
        end: EventRecurrenceEndBackupV1,
    },
    Monthly {
        end: EventRecurrenceEndBackupV1,
    },
    Yearly {
        end: EventRecurrenceEndBackupV1,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EventRecurrenceEndBackupV1 {
    Never,
    OnDate { date: String },
    AfterCount { count: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarWeekdayBackupV1 {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventReminderBackupRecordV1 {
    pub id: String,
    pub minutes_before: u32,
}

#[derive(Clone, Debug)]
pub struct EventImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
}

#[derive(Clone, Debug)]
pub struct EventReminderIdRemap {
    pub source_reminder_id: String,
    pub effective_reminder_id: String,
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
    export_to = "calendar.ts"
)]
pub enum CalendarError {
    UnauthorizedCaller,
    InvalidEventId,
    InvalidRevision,
    InvalidTitle,
    DescriptionTooLong,
    InvalidProjectId,
    ProjectNotFound,
    ProjectChanged,
    InvalidDate,
    InvalidLocalDateTime,
    InvalidTimeZone,
    NonexistentLocalTime,
    InvalidTimeRange,
    DateOutOfRange,
    InvalidRecurrence,
    InvalidRecurrenceEnd,
    TooManyReminders,
    DuplicateReminder,
    InvalidReminderOffset,
    InvalidRange,
    OccurrenceLimitExceeded,
    EventNotFound,
    RevisionConflict { current_revision: String },
    DeleteConfirmationMissing,
    DeleteConfirmationExpired,
    DeleteImpactChanged,
    CorruptStoredData,
    StorageUnavailable,
}

impl From<crate::storage::StorageError> for CalendarError {
    /// Redacts storage details at the calendar boundary.
    fn from(_: crate::storage::StorageError) -> Self {
        Self::StorageUnavailable
    }
}
impl From<rusqlite::Error> for CalendarError {
    /// Reports project deletion races without disclosing SQL details.
    fn from(error: rusqlite::Error) -> Self {
        if matches!(error.sqlite_error(), Some(error) if error.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY)
        {
            Self::ProjectChanged
        } else {
            Self::StorageUnavailable
        }
    }
}
impl std::fmt::Display for CalendarError {
    /// Formats only the redacted domain error.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for CalendarError {}

// Empty struct variants enforce unknown-field rejection that serde unit variants omit.
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum StrictRecurrence<W, E> {
    None {},
    Daily { end: E },
    Weekly { weekdays: Vec<W>, end: E },
    Monthly { end: E },
    Yearly { end: E },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum StrictRecurrenceEnd {
    Never {},
    OnDate { date: String },
    AfterCount { count: u32 },
}

macro_rules! deserialize_recurrence {
    ($target:ty, $weekday:ty, $end:ty) => {
        impl<'de> Deserialize<'de> for $target {
            /// Rejects fields on every variant, including the non-recurring unit variant.
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                Ok(
                    match StrictRecurrence::<$weekday, $end>::deserialize(deserializer)? {
                        StrictRecurrence::None {} => Self::None,
                        StrictRecurrence::Daily { end } => Self::Daily { end },
                        StrictRecurrence::Weekly { weekdays, end } => {
                            Self::Weekly { weekdays, end }
                        }
                        StrictRecurrence::Monthly { end } => Self::Monthly { end },
                        StrictRecurrence::Yearly { end } => Self::Yearly { end },
                    },
                )
            }
        }
    };
}

macro_rules! deserialize_recurrence_end {
    ($target:ty) => {
        impl<'de> Deserialize<'de> for $target {
            /// Rejects fields on the open-ended unit variant as well as finite ends.
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                Ok(match StrictRecurrenceEnd::deserialize(deserializer)? {
                    StrictRecurrenceEnd::Never {} => Self::Never,
                    StrictRecurrenceEnd::OnDate { date } => Self::OnDate { date },
                    StrictRecurrenceEnd::AfterCount { count } => Self::AfterCount { count },
                })
            }
        }
    };
}
deserialize_recurrence!(
    EventRecurrenceDto,
    CalendarWeekdayDto,
    EventRecurrenceEndDto
);
deserialize_recurrence!(
    EventRecurrenceBackupV1,
    CalendarWeekdayBackupV1,
    EventRecurrenceEndBackupV1
);
deserialize_recurrence_end!(EventRecurrenceEndDto);
deserialize_recurrence_end!(EventRecurrenceEndBackupV1);

#[cfg(test)]
mod tests {
    use super::*;

    /// Rejects unknown input fields at both event and nested tagged-union boundaries.
    #[test]
    fn calendar_inputs_reject_unknown_fields() {
        let input = serde_json::json!({"title":"Planning","description":"","projectId":null,"time":{"kind":"timed","startLocal":"2026-09-09T09:00","endLocal":"2026-09-09T10:00","timeZoneId":"UTC"},"recurrence":{"kind":"none"},"reminderMinutesBefore":[]});
        assert!(serde_json::from_value::<EventInputDto>(input.clone()).is_ok());
        let mut extra = input.clone();
        extra["rawRrule"] = serde_json::json!("FREQ=DAILY");
        assert!(serde_json::from_value::<EventInputDto>(extra).is_err());
        let mut extra = input.clone();
        extra["time"]["startAtMs"] = serde_json::json!(0);
        assert!(serde_json::from_value::<EventInputDto>(extra).is_err());
        let mut extra = input.clone();
        extra["recurrence"]["count"] = serde_json::json!(5);
        assert!(serde_json::from_value::<EventInputDto>(extra).is_err());
    }

    /// Rejects unexpected fields on both DTO and backup unit variants.
    #[test]
    fn recurrence_unit_variants_are_strict_for_dto_and_backup() {
        let none = serde_json::json!({"kind":"none","count":3});
        let never = serde_json::json!({"kind":"never","date":"2026-09-09"});
        assert!(serde_json::from_value::<EventRecurrenceDto>(none.clone()).is_err());
        assert!(serde_json::from_value::<EventRecurrenceBackupV1>(none).is_err());
        assert!(serde_json::from_value::<EventRecurrenceEndDto>(never.clone()).is_err());
        assert!(serde_json::from_value::<EventRecurrenceEndBackupV1>(never).is_err());
    }

    /// Keeps public errors tagged and omits raw SQL failure information.
    #[test]
    fn calendar_errors_are_tagged_and_redacted() {
        let error = CalendarError::from(rusqlite::Error::InvalidParameterName(
            "private calendar title".into(),
        ));
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({"kind":"storage_unavailable"})
        );
        assert_eq!(
            serde_json::to_value(CalendarError::RevisionConflict {
                current_revision: "2".into()
            })
            .unwrap(),
            serde_json::json!({"kind":"revision_conflict","currentRevision":"2"})
        );
    }
}
