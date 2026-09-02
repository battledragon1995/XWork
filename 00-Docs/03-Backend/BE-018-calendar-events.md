# BE-018 — Calendar events

Tài liệu này đặc tả contract backend cho định nghĩa sự kiện lịch, quy tắc lặp, nhiều mốc nhắc và phép chiếu occurrence. Contract đủ dữ kiện để Calendar, Home, Project Overview, Command Palette, backup v3 và reminder scheduler dùng chung một nguồn dữ liệu mà không đọc table nội bộ.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-018` |
| Phase | `4` |
| Capability | `src-tauri/src/calendar/` |
| Yêu cầu chức năng | §13.1–13.2; liên quan §14 và §17.6 |
| Frontend liên quan | `FE-003`, `FE-005`, `FE-009`, `FE-021`, `FE-022` |
| Phụ thuộc | `BE-002`, `BE-003`, `BE-010`, `BE-012`, `BE-016` |

## Mục tiêu

Cung cấp CRUD bền vững cho event timed/all-day, timezone IANA, recurrence có giới hạn kết thúc và tối đa nhiều reminder definition. Capability chiếu event definition thành occurrence theo khoảng ngày, đồng thời cung cấp public Rust port hẹp cho unified search, backup v3 và BE-019 mà không materialize occurrence hoặc trạng thái delivery vào database.

### Ngoài phạm vi

- Scheduler, OS/in-app notification, trạng thái sent/read/missed, snooze và dismiss thuộc `BE-019`; tab `07-Calendar.html#missed` không phải dữ liệu do BE-018 tạo.
- Không có reminder độc lập ngoài event, per-occurrence exception, `EXDATE`/`RDATE`, sửa hoặc xóa “chỉ occurrence này”, custom interval hay import raw RRULE trong v1.
- Không đồng bộ calendar bên ngoài, chia sẻ event hoặc attendee.

### Quyết định và giả định đã chốt

1. Edit/delete event lặp tác động toàn series. Đây là mặc định nhỏ nhất đáp ứng §13.2 và không tạo ngầm exception model chưa có trong yêu cầu.
2. Recurrence public dùng enum typed; backend sinh và parse canonical RRULE. Frontend và backup không truyền raw RRULE để tránh hai nguồn validation khác nhau.
3. `interval` cố định bằng `1`. Weekly cho phép chọn một hoặc nhiều thứ; Daily/Monthly/Yearly bám ngày bắt đầu. Monthly ngày 29–31 và Yearly ngày 29/02 bỏ qua tháng/năm không có ngày tương ứng, theo phép chiếu RFC của `rrule`.
4. Timed event giữ giờ tường trong timezone event khi lặp qua DST. Local time không tồn tại bị từ chối ở event gốc; occurrence tương lai có start hoặc end không tồn tại bị bỏ qua; local time mơ hồ chọn instant UTC sớm hơn. Candidate không hợp lệ bị bỏ qua trước khi tăng bộ đếm `AfterCount`, vì `COUNT` là số occurrence hợp lệ của domain chứ không phải số local candidate thư viện đã thử.
5. All-day dùng khoảng ngày half-open `[startDate, endDateExclusive)` và vẫn lưu timezone IANA. Ngày là dữ liệu floating để hiển thị; timezone chỉ xác định instant phục vụ reminder/search adapter. Resolver lấy instant nhỏ nhất `t` sao cho `t` chiếu qua timezone có local date đúng `startDate`; định nghĩa này tự chọn nhánh UTC sớm hơn khi local time mơ hồ, đi qua gap đầu ngày và bỏ occurrence nếu tập instant rỗng vì cả ngày bị timezone skip. Recurrence all-day vẫn chiếu theo ngày lịch, không đổi ngày khi DST đổi offset.
6. Reminder là số phút trước start, duy nhất trong một event, tối đa 16 mốc và tối đa 365 ngày. Wireframe cho phép thêm nhiều dòng nhưng không yêu cầu vô hạn; giới hạn này ngăn payload/scheduler fan-out quá lớn.
7. Truy vấn occurrence trả mọi occurrence giao với khoảng ngày, kể cả bắt đầu trước khoảng; không phân trang nhưng giới hạn khoảng 62 ngày và 5.000 occurrence. Vượt giới hạn trả lỗi thay vì âm thầm cắt, để UI không hiển thị lịch thiếu.
8. Home dùng cùng occurrence query với `onlyWithReminders = true`; Project Overview truyền `projectId`; Upcoming dùng khoảng 14 ngày. `BE-010` nhận một document cho base event, không materialize từng occurrence vào Command Palette.
9. Event có optional project link. Project bị xóa làm link thành `NULL`; project unavailable vẫn là link hợp lệ theo `BE-003`.
10. Backup schema v3 giữ event/reminder identity khi semantic `(eventId, minutesBefore)` không đổi, nhưng không giữ search projection, runtime revision, occurrence hay delivery state. Khi incoming event thắng mà cùng reminder ID đổi `minutesBefore`, prepare cấp UUID v5 xác định và lưu remap trong plan để identity delivery cũ không bị tái sử dụng cho semantic mới; event cùng ID vẫn ghi đè record local theo merge policy `BE-012` và được cấp revision mới.
11. `chrono`, `chrono-tz` và `rrule` được khai báo trực tiếp đúng version Tech Stack; dependency `uuid` hiện có bật thêm feature `v5` cho remap deterministic. Mọi phép parse/expand nằm trong Rust capability, không lệ thuộc timezone của OS.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo trực tiếp `chrono`, `chrono-tz`, `rrule` và bật feature UUID v5 cho reminder remap |
| `src-tauri/Cargo.lock` | Khóa dependency calendar đã resolve |
| `src-tauri/src/lib.rs` | Export module `calendar` |
| `src-tauri/src/calendar/mod.rs` | Public export của model, service, source và maintenance contract |
| `src-tauri/src/calendar/models.rs` | Domain type, public DTO, backup record và typed error |
| `src-tauri/src/calendar/recurrence.rs` | Parse local time/timezone, canonical RRULE và expand occurrence có giới hạn |
| `src-tauri/src/calendar/repository.rs` | SQL parameterized cho CRUD, candidate range/search và transaction-scoped maintenance |
| `src-tauri/src/calendar/service.rs` | Validation, revision, transaction, query occurrence và public Rust consumer port |
| `src-tauri/src/calendar/commands.rs` | Tauri command mỏng và kiểm tra caller |
| `src-tauri/src/calendar/backup.rs` | Typed backup v3 export/prepare/apply/reset/publish contract |
| `src-tauri/src/storage/migrations.rs` | Đăng ký migration `0008` theo thứ tự sau `0007` |
| `src-tauri/migrations/0008_create_calendar_events.sql` | Tạo `calendar_events`, `event_reminders` và index |
| `src-tauri/src/app/mod.rs` | Manage `CalendarService`, đăng ký command và event sink |
| `src-tauri/src/app/search_sources.rs` | Adapter `CalendarService` sang `EventSearchSource` của BE-010 và resolve project name qua BE-003 |
| `src-tauri/src/app/data_participants.rs` | Adapter clone Event backup record, remap link bằng public `ProjectImportMap::resolve`, rồi gọi Calendar maintenance API |
| `src-tauri/src/settings/data.rs` | Gắn `EventBackupRecordV1` vào typed `BackupDataV3.events` đã do BE-012 định nghĩa |
| `src-tauri/src/bin/export_bindings.rs` | Đăng ký DTO/event/error calendar với binding generator |
| `src/bindings/calendar.ts` | Binding sinh tự động cho command, DTO và event calendar; không sửa tay |
| `src-tauri/tests/calendar_commands.rs` | Integration test CRUD, validation, caller, optimistic concurrency và project FK |
| `src-tauri/tests/calendar_occurrences.rs` | Integration test timed/all-day, range overlap, recurrence, DST, sort và giới hạn |
| `src-tauri/tests/calendar_consumers.rs` | Contract test BE-010/BE-019 consumer port và event invalidation |
| `src-tauri/tests/data_management_contract.rs` | Golden backup v3, compatibility v1/v2, merge/remap/reset/rollback Events |
| `src-tauri/tests/app_builder.rs` | Xác nhận manage/register Calendar, shared gate và adapters đúng một lần |
| `src-tauri/tests/export_bindings.rs` | Contract test binding trên đĩa khớp Rust source |

Không thêm capability permission mới: các command chỉ dùng core invoke đã có. Mọi file implementation có thể chạm cho BE-018 đều nằm trong bảng này.

## Dữ liệu

### Migration `0008_create_calendar_events.sql`

```sql
CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id TEXT NULL REFERENCES projects(id) ON DELETE SET NULL,
    is_all_day INTEGER NOT NULL CHECK (is_all_day IN (0, 1)),
    start_local TEXT NOT NULL,
    end_local TEXT NOT NULL,
    time_zone_id TEXT NOT NULL,
    start_at_ms INTEGER NULL,
    end_at_ms INTEGER NULL,
    recurrence_rule TEXT NULL,
    search_text TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    CHECK (
        (is_all_day = 1
            AND length(start_local) = 10
            AND length(end_local) = 10
            AND start_at_ms IS NULL
            AND end_at_ms IS NULL)
        OR
        (is_all_day = 0
            AND length(start_local) = 16
            AND length(end_local) = 16
            AND start_at_ms IS NOT NULL
            AND end_at_ms IS NOT NULL
            AND end_at_ms > start_at_ms)
    ),
    CHECK (end_local > start_local),
    CHECK (recurrence_rule IS NULL OR length(recurrence_rule) BETWEEN 1 AND 256)
) STRICT;

CREATE TABLE event_reminders (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    minutes_before INTEGER NOT NULL
        CHECK (minutes_before BETWEEN 0 AND 525600),
    UNIQUE (event_id, minutes_before)
) STRICT;

CREATE INDEX idx_calendar_events_project
    ON calendar_events(project_id);
CREATE INDEX idx_calendar_events_timed_range
    ON calendar_events(start_at_ms, end_at_ms)
    WHERE is_all_day = 0 AND recurrence_rule IS NULL;
CREATE INDEX idx_calendar_events_all_day_range
    ON calendar_events(start_local, end_local)
    WHERE is_all_day = 1 AND recurrence_rule IS NULL;
CREATE INDEX idx_calendar_events_recurring_start
    ON calendar_events(is_all_day, start_local)
    WHERE recurrence_rule IS NOT NULL;
CREATE INDEX idx_calendar_events_search
    ON calendar_events(search_text);
CREATE INDEX idx_event_reminders_event
    ON event_reminders(event_id, minutes_before DESC);
```

Migration runner của `BE-002` đăng ký file này sau `0007_create_notes.sql`; đây là domain migration đầu tiên của Calendar và không sửa migration đã phát hành. `PRAGMA foreign_keys = ON` do Storage connection thiết lập.

### Bảng `calendar_events`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `TEXT` | PK, UUID canonical | Identity ổn định của base event/series |
| `title` | `TEXT` | NOT NULL | Title đã trim |
| `description` | `TEXT` | NOT NULL | Plain text đã normalize newline |
| `project_id` | `TEXT` | NULL, FK `projects`, `ON DELETE SET NULL` | Optional project link |
| `is_all_day` | `INTEGER` | `0` hoặc `1` | Chọn representation thời gian |
| `start_local`, `end_local` | `TEXT` | NOT NULL, half-open | `YYYY-MM-DDTHH:mm` cho timed hoặc `YYYY-MM-DD` cho all-day |
| `time_zone_id` | `TEXT` | NOT NULL | Tên IANA canonical do `chrono_tz::Tz` trả về |
| `start_at_ms`, `end_at_ms` | `INTEGER` | Cặp NULL cho all-day, cặp NOT NULL cho timed | Instant UTC cache của base timed event |
| `recurrence_rule` | `TEXT` | NULL hoặc canonical RRULE ≤256 byte | `NULL` là không lặp; không chứa `DTSTART` |
| `search_text` | `TEXT` | NOT NULL | Projection nội bộ từ title + description để candidate filtering |
| `revision` | `INTEGER` | NOT NULL, ≥1 | Optimistic concurrency, serialize ra decimal string |
| `created_at_ms`, `updated_at_ms` | `INTEGER` | Unix ms UTC, không âm | Audit timestamp |

### Bảng `event_reminders`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `TEXT` | PK, UUID canonical | Identity reminder definition ổn định qua backup |
| `event_id` | `TEXT` | FK, NOT NULL, CASCADE | Event sở hữu reminder |
| `minutes_before` | `INTEGER` | 0–525600, unique theo event | Số phút trước occurrence start; `0` là đúng giờ |

Service giới hạn tối đa 16 reminder/event. Khi update, offset còn tồn tại giữ nguyên reminder ID; offset bỏ đi bị delete; offset mới nhận UUID mới. Query luôn sort `minutes_before` giảm dần rồi `id` tăng dần.

## DTO public

Mọi struct public dùng `camelCase`, enum dùng literal `snake_case`, enum có dữ liệu dùng discriminator `kind`. Input có `deny_unknown_fields`. `revision`, `sequence` và `occurrenceId` là opaque string ở frontend.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum CalendarWeekdayDto {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum EventRecurrenceEndDto {
    Never,
    OnDate { date: String },
    AfterCount { count: u32 },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum EventRecurrenceDto {
    None,
    Daily { end: EventRecurrenceEndDto },
    Weekly {
        weekdays: Vec<CalendarWeekdayDto>,
        end: EventRecurrenceEndDto,
    },
    Monthly { end: EventRecurrenceEndDto },
    Yearly { end: EventRecurrenceEndDto },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[ts(tag = "kind", rename_all = "snake_case")]
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

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum EventTimeDto {
    Timed {
        start_local: String,
        end_local: String,
        time_zone_id: String,
        start_at_ms: i64,
        end_at_ms: i64,
    },
    AllDay {
        start_date: String,
        end_date_exclusive: String,
        time_zone_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct EventInputDto {
    pub title: String,
    pub description: String,
    pub project_id: Option<String>,
    pub time: EventTimeInputDto,
    pub recurrence: EventRecurrenceDto,
    pub reminder_minutes_before: Vec<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct EventReminderDto {
    pub id: String,
    pub minutes_before: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CalendarEventDto {
    pub id: String,
    pub title: String,
    pub description: String,
    pub project_id: Option<String>,
    pub time: EventTimeDto,
    pub recurrence: EventRecurrenceDto,
    pub reminders: Vec<EventReminderDto>,
    pub revision: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct CalendarRangeInputDto {
    pub start_date: String,
    pub end_date_exclusive: String,
    pub viewer_time_zone_id: String,
    pub project_id: Option<String>,
    pub only_with_reminders: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CalendarOccurrenceDto {
    pub occurrence_id: String,
    pub event_id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub time: EventTimeDto,
    pub recurrence: EventRecurrenceDto,
    pub reminders: Vec<EventReminderDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CalendarOccurrenceListDto {
    pub revision: String,
    pub items: Vec<CalendarOccurrenceDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct EventRevisionInputDto {
    pub event_id: String,
    pub expected_revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct UpdateCalendarEventInputDto {
    pub event_id: String,
    pub expected_revision: String,
    pub event: EventInputDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DeleteCalendarEventImpactDto {
    pub request_id: u32,
    pub event_id: String,
    pub title: String,
    pub is_recurring: bool,
    pub reminder_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ConfirmDeleteCalendarEventInputDto {
    pub request_id: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DeletedCalendarEventDto {
    pub event_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum CalendarChangeKindDto {
    Created,
    Updated,
    Deleted,
    BackupImported,
    Reset,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CalendarChangedEventDto {
    pub sequence: String,
    pub kind: CalendarChangeKindDto,
    pub event_id: Option<String>,
    pub revision: Option<String>,
}
```

`EventTimeDto` trong occurrence chứa start/end của occurrence, không phải base event. `occurrenceId` là `{event UUID}@t:{startAtMs}` cho timed và `{event UUID}@d:{startDate}:{startAtMs}` cho all-day; frontend coi chuỗi này opaque. `startAtMs` khiến identity all-day đổi khi timezone/reconciliation đổi instant, nên BE-019 có thể hủy delivery cũ và không nhầm occurrence mới. Range list sort theo ngày hiển thị trong `viewerTimeZoneId`, all-day trước timed, rồi start, title Unicode case-insensitive, `eventId`, `occurrenceId` để thứ tự ổn định.

## Public Rust consumer và maintenance contract

Các type dưới đây public trong crate Rust nhưng không derive `TS` và không là Tauri command.

```rust
pub struct CalendarNotificationContext {
    pub event_id: String,
    pub occurrence_id: String,
    pub title: String,
    pub project_id: Option<String>,
    pub starts_at_ms: i64,
    pub time_zone_id: String,
    pub reminder_definitions: Vec<CalendarReminderDefinition>,
}

pub struct CalendarReminderDefinition {
    pub reminder_id: String,
    pub minutes_before: u32,
}

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

pub struct CalendarEventSearchRecord {
    pub event_id: String,
    pub title: String,
    pub matching_description: Option<String>,
    pub project_id: Option<String>,
    pub starts_at_ms: i64,
    pub time_zone_id: String,
}

pub struct CalendarEventSearchCandidates {
    pub items: Vec<CalendarEventSearchRecord>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EventRecurrenceBackupV1 {
    None,
    Daily { end: EventRecurrenceEndBackupV1 },
    Weekly {
        weekdays: Vec<CalendarWeekdayBackupV1>,
        end: EventRecurrenceEndBackupV1,
    },
    Monthly { end: EventRecurrenceEndBackupV1 },
    Yearly { end: EventRecurrenceEndBackupV1 },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventReminderBackupRecordV1 {
    pub id: String,
    pub minutes_before: u32,
}

pub struct EventImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
}

pub struct EventReminderIdRemap {
    pub source_reminder_id: String,
    pub effective_reminder_id: String,
}

pub struct PreparedEventMerge {
    pub counts: EventImportCounts,
    pub reminder_id_remaps: Vec<EventReminderIdRemap>,
    row_operations: Vec<PreparedEventRowOperation>,
    next_sequence: u64,
}

pub enum CalendarMaintenanceChange {
    BackupImported,
    Reset,
}

pub struct CalendarMaintenanceProjection {
    pub change: CalendarMaintenanceChange,
    pub affected_event_count: u32,
    next_sequence: u64,
}

impl CalendarService {
    pub async fn search_for_unified(
        &self,
        query: &str,
        candidate_limit: u32,
    ) -> Result<CalendarEventSearchCandidates, CalendarError>;

    pub async fn reminder_occurrences(
        &self,
        from_due_at_ms: i64,
        through_due_at_ms: i64,
        limit: u32,
    ) -> Result<Vec<CalendarReminderOccurrence>, CalendarError>;

    pub async fn get_notification_context(
        &self,
        event_id: &str,
        occurrence_id: &str,
    ) -> Result<Option<CalendarNotificationContext>, CalendarError>;

    pub fn export_events_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<Vec<EventBackupRecordV1>, CalendarError>;

    pub fn prepare_event_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        incoming: &[EventBackupRecordV1],
    ) -> Result<PreparedEventMerge, CalendarError>;

    pub fn apply_event_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &PreparedEventMerge,
    ) -> Result<CalendarMaintenanceProjection, CalendarError>;

    pub fn reset_events_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<CalendarMaintenanceProjection, CalendarError>;

    pub fn publish_event_maintenance(
        &self,
        projection: CalendarMaintenanceProjection,
    );
}
```

- `search_for_unified` nhận query đã được BE-010 normalize, `candidateLimit` 1–64, dùng `search_text` để lấy `limit + 1`. Mỗi base event tối đa một record; `matching_description` chỉ có khi description match. Adapter app resolve `project_name` qua public BE-003 query rồi map sang `EventSearchDocument`; `starts_at_ms` là base start timed hoặc instant hợp lệ đầu tiên của ngày all-day trong event timezone. Ranking, highlight và group vẫn do BE-010 sở hữu.
- `reminder_occurrences` là port đọc của BE-019: mỗi item ứng với đúng một reminder definition của một occurrence, khoảng due half-open, tối đa 31 ngày, limit 1–5.000, sort `dueAt`, `eventId`, `occurrenceId`, `reminderId`. Nó chỉ trả definition hiện hành, không ghi delivery state. `get_notification_context` parse và đối chiếu cả instant trong `occurrenceId`; trả `None` khi event/occurrence đã bị xóa, timezone đổi làm identity cũ không còn hợp lệ hoặc occurrence không còn khớp series.
- Backup export sort event theo `id`, reminder theo `minutes_before DESC, id`; không xuất UTC cache, RRULE raw, search projection hoặc revision. Với mỗi source record, adapter `app/data_participants.rs` clone typed `EventBackupRecordV1`, đặt `project_id = source.project_id.as_deref().and_then(|id| project_map.resolve(id)).map(str::to_owned)`, rồi truyền slice bản sao vào `prepare_event_merge_in`; package parse gốc không bị mutate, dangling link trở thành `None`. Calendar không nhận `ProjectImportMap`/`HashMap`, không đọc Projects internals; owner validate target ID canonical cùng toàn bộ UUID/timestamp/time/recurrence/reminder, còn referential existence do map đã validate và Projects được apply trước Events trong cùng transaction bảo đảm. Prepare reject duplicate ID và recompute mọi derived field. Apply chạy trong transaction xuyên domain của BE-012: incoming cùng event ID thắng, local vắng trong incoming được giữ; reminder của event thắng được thay bằng đúng set incoming. Reminder ID chỉ được giữ nếu cặp semantic `(eventId, minutesBefore)` không đổi. Nếu source reminder ID đã tồn tại với cặp khác — gồm trường hợp incoming cùng event thắng nhưng đổi offset — prepare chọn UUID v5 đầu tiên chưa xung đột từ namespace `Uuid::NAMESPACE_OID` và name `xwork:event-reminder-import:{eventId}:{sourceReminderId}:{minutesBefore}:{attempt}`, với `attempt` bắt đầu `0`, rồi ghi mapping vào `reminder_id_remaps`; mọi lần retry trên cùng snapshot cho cùng kết quả. Import v1/v2 không gọi Events participant; v3 bắt buộc `events` array. Apply cấp revision `max(local + 1, 1)` và timestamp giữ từ backup; reset xóa toàn bộ event. Các hàm `_in` không lấy lại Storage transaction hoặc `DataMaintenanceGate`.
- `PreparedEventMerge` chỉ công khai counts/remap; typed row operations và revision/sequence kế tiếp nằm ở field private, không giữ transaction/reference. Apply/reset trả projection hoàn chỉnh không chứa user content. Adapter BE-012 lấy merge counts từ plan, wrap projection vào `OwnedCommittedProjection::Events`, và chỉ sau commit mới chuyển ownership cho `publish_event_maintenance`. Publish swap revision/cache đã chuẩn bị và emit một invalidation aggregate; không query lại database, không trả `Result` và không thể fail. Rollback drop projection nên runtime không đổi.

## Tauri command

Command chỉ authorize exact window label `main`, parse DTO, clone service và chạy SQLite/expansion trong blocking task qua service. Không command nào public hóa source/backup/reminder port.

### `list_calendar_occurrences`

```rust
#[tauri::command]
pub async fn list_calendar_occurrences(
    window: tauri::Window,
    service: tauri::State<'_, CalendarService>,
    input: CalendarRangeInputDto,
) -> Result<CalendarOccurrenceListDto, CalendarError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; date ISO hợp lệ; range half-open không rỗng và ≤62 ngày; timezone là IANA `chrono_tz::Tz`; project ID nếu có là UUID canonical |
| Side effect | Không có; query candidate và expand occurrence bounded |
| Lỗi trả về | `UnauthorizedCaller`, `InvalidDate`, `InvalidTimeZone`, `InvalidRange`, `InvalidProjectId`, `OccurrenceLimitExceeded`, `CorruptStoredData`, `StorageUnavailable` |

### `get_calendar_event`

```rust
#[tauri::command]
pub async fn get_calendar_event(
    window: tauri::Window,
    service: tauri::State<'_, CalendarService>,
    event_id: String,
) -> Result<CalendarEventDto, CalendarError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; event ID UUID canonical |
| Side effect | Không có |
| Lỗi trả về | `UnauthorizedCaller`, `InvalidEventId`, `EventNotFound`, `CorruptStoredData`, `StorageUnavailable` |

### `create_calendar_event`

```rust
#[tauri::command]
pub async fn create_calendar_event(
    window: tauri::Window,
    service: tauri::State<'_, CalendarService>,
    input: EventInputDto,
) -> Result<CalendarEventDto, CalendarError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; toàn bộ rule title/description/project/time/recurrence/reminder ở mục invariant |
| Side effect | Lấy app maintenance gate; sinh event/reminder UUID, insert trong một immediate transaction; commit rồi tăng runtime sequence và phát `calendar://changed` kind `created` |
| Lỗi trả về | Các lỗi validation tương ứng, `ProjectNotFound`, `ProjectChanged`, `StorageUnavailable` |

### `update_calendar_event`

```rust
#[tauri::command]
pub async fn update_calendar_event(
    window: tauri::Window,
    service: tauri::State<'_, CalendarService>,
    input: UpdateCalendarEventInputDto,
) -> Result<CalendarEventDto, CalendarError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; canonical event ID/revision; cùng domain rule create |
| Side effect | Trong maintenance gate + immediate transaction, so revision, replace field/reminder delta, tăng revision, đặt `updated_at_ms = max(now, old + 1)`; commit rồi phát kind `updated` |
| Lỗi trả về | Lỗi validation, `EventNotFound`, `RevisionConflict`, `ProjectNotFound`, `ProjectChanged`, `CorruptStoredData`, `StorageUnavailable` |

### `prepare_delete_calendar_event`

```rust
#[tauri::command]
pub async fn prepare_delete_calendar_event(
    window: tauri::Window,
    service: tauri::State<'_, CalendarService>,
    input: EventRevisionInputDto,
) -> Result<DeleteCalendarEventImpactDto, CalendarError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; canonical ID/revision; event còn tồn tại và revision khớp |
| Side effect | Lưu pending preview trong memory với request ID khác 0, event fingerprint và TTL 60 giây; thay preview cũ cùng caller |
| Lỗi trả về | `UnauthorizedCaller`, `InvalidEventId`, `InvalidRevision`, `EventNotFound`, `RevisionConflict`, `CorruptStoredData`, `StorageUnavailable` |

### `confirm_delete_calendar_event`

```rust
#[tauri::command]
pub async fn confirm_delete_calendar_event(
    window: tauri::Window,
    service: tauri::State<'_, CalendarService>,
    input: ConfirmDeleteCalendarEventInputDto,
) -> Result<DeletedCalendarEventDto, CalendarError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; request ID đúng pending preview và chưa hết TTL; event fingerprint vẫn khớp trong transaction |
| Side effect | Lấy maintenance gate, xóa event và cascade reminder trong immediate transaction; commit rồi xóa pending và phát kind `deleted` |
| Lỗi trả về | `UnauthorizedCaller`, `DeleteConfirmationMissing`, `DeleteConfirmationExpired`, `DeleteImpactChanged`, `EventNotFound`, `CorruptStoredData`, `StorageUnavailable` |

Delete luôn qua prepare/confirm để thỏa dialog xác nhận ở `07-Calendar.html#detail`; không có bypass boolean. Cancel dialog chỉ bỏ pending in-memory ở frontend; pending tự hết hạn, không làm thay đổi dữ liệu.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `calendar://changed` | `CalendarChangedEventDto` | Sau create/update/delete thực sự đã commit; một lần aggregate sau backup import hoặc reset | Chỉ emit tới `main`; sequence decimal tăng đơn điệu trong process; mutation đơn có event ID/revision, bulk có `None`; không phát cho read, failed transaction hoặc rollback |

App composition đồng thời chuyển cùng invalidation sau commit tới consumer sink nội bộ của BE-019. Sink không được gọi trước commit và lỗi emit/sink không rollback dữ liệu đã commit; lỗi được log bằng metadata không chứa title/description.

## Business rule và invariant

1. Title trim hai đầu, dài 1–200 Unicode scalar và không chứa control. Description normalize CRLF/CR thành LF, tối đa 20.000 scalar, cho phép LF/TAB và từ chối control còn lại.
2. ID public phải là UUID canonical lowercase. `revision` là số nguyên thập phân dương trong string; frontend không tự tăng.
3. Date dùng đúng `YYYY-MM-DD`; local datetime đúng `YYYY-MM-DDTHH:mm`, không seconds/offset. Năm nằm 1900–9999. `timeZoneId` parse được bằng `chrono_tz::Tz` và được serialize lại thành tên canonical.
4. Khoảng event half-open, duration >0 và ≤366 ngày. Timed `endLocal > startLocal`, cả hai resolve trong cùng timezone; all-day `endDateExclusive > startDate`.
5. Timed base local `chrono::LocalResult::None` là `NonexistentLocalTime`; `Ambiguous(a,b)` chọn instant nhỏ hơn. End instant phải lớn start instant sau resolve. Update timezone hoặc local time luôn recompute UTC cache.
6. `None` không tạo RRULE. Daily/Monthly/Yearly không có field thừa. Weekly có 1–7 weekday duy nhất, sort Monday→Sunday; DTSTART vẫn là occurrence đầu và weekday set phải chứa weekday của DTSTART để không tạo series có definition mâu thuẫn form.
7. `OnDate.date` bao gồm occurrence hợp lệ của ngày đó và phải ≥ ngày start; `AfterCount.count` 1–10.000 và tính cả DTSTART hợp lệ. Candidate bị loại vì calendar date không tồn tại hoặc vì start/end không resolve trong timezone không tiêu thụ count. Canonical RRULE vẫn serialize đúng một `COUNT`, nhưng expander không để thư viện cắt candidate trước domain validation: nó iterate theo frequency trong bound an toàn, tự tăng `valid_count` sau validation và dừng khi đạt count. Backend canonicalize thành `FREQ`, `INTERVAL=1`, `BYDAY` nếu weekly, và đúng một `UNTIL` hoặc `COUNT`; field serialize theo thứ tự cố định để backup/query deterministic.
8. Expansion luôn dùng API bounded của `rrule`; không gọi `all_unchecked`. Candidate window cộng event duration để giữ occurrence overlap range, rồi filter chính xác half-open.
9. All-day recurrence được dựng trên calendar date và map về date, không qua UTC midnight. Khi cần instant, resolver lấy minimum UTC instant ánh xạ về đúng local date; vì vậy nó chọn nhánh sớm hơn khi mơ hồ, đi qua gap đầu ngày và bỏ occurrence nếu timezone skip cả ngày. Timed recurrence giữ local start và local duration; occurrence bị bỏ nếu start/end generated là local time không tồn tại, ambiguous chọn instant sớm hơn. Cả hai đường dùng cùng resolver cho range/search/reminder/context để `occurrenceId` không lệch giữa consumer.
10. Reminder offsets là 0–525600, tối đa 16, không duplicate. Reminder due instant là occurrence start trừ checked integer minutes; underflow/overflow là `DateOutOfRange`.
11. Create/update có project ID phải xác nhận project tồn tại qua public BE-003 service trước write. Foreign key là kiểm tra race cuối; project unavailable hợp lệ, project bị xóa tự unlink.
12. Occurrence candidate gồm event không lặp giao range và mọi occurrence lặp giao range. Filter project áp sau `ON DELETE SET NULL`; `onlyWithReminders` loại event không có definition.
13. Timed occurrence được nhóm theo local date của start trong viewer timezone; all-day giữ date event. Query không đổi event timezone hay dữ liệu gốc.
14. Runtime calendar revision/sequence bắt đầu lại khi app start, tăng đúng một lần sau mỗi commit hoặc bulk publish và serialize string. Nó chỉ là invalidation token, không thay thế per-event revision.
15. `search_text` là lowercase Unicode + collapse whitespace của title và description; là projection dẫn xuất, luôn recompute khi write/import và không xuất backup.
16. CRUD/import/reset persistent cùng dùng một `DataMaintenanceGate`. Lock order: maintenance gate → Calendar mutation/pending lock → Storage connection/transaction. Không giữ mutex, transaction hoặc borrowed row qua `.await`.
17. Mỗi public read trả snapshot từ một Storage critical section. Event và reminders không thể quan sát ở trạng thái nửa cập nhật.
18. BE-018 không ghi bất kỳ delivery/read/missed/snooze/dismiss state. Việc update/delete definition chỉ phát invalidation để BE-019 tự reconcile job và inbox theo contract của nó.
19. Import adapter clone Event record và resolve optional source project link thành owned target ID trước `prepare_event_merge_in`. Calendar owner không phụ thuộc `ProjectImportMap`, `HashMap` hay Projects repository; parsed backup record gốc giữ nguyên để preview/replan deterministic.

## Lỗi

```rust
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
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedCaller` | Window label khác `main` | Không lộ dữ liệu; hiển thị lỗi chung |
| `InvalidEventId`, `InvalidRevision` | ID/revision không canonical | Lỗi request/form |
| `InvalidTitle`, `DescriptionTooLong` | Text sai rule | Gắn lỗi đúng field |
| `InvalidProjectId`, `ProjectNotFound`, `ProjectChanged` | Project sai, vắng hoặc đổi trong race | Yêu cầu chọn lại/refresh project |
| `InvalidDate`, `InvalidLocalDateTime`, `InvalidTimeZone`, `NonexistentLocalTime`, `InvalidTimeRange`, `DateOutOfRange` | Giá trị calendar không parse/resolve hoặc ngoài giới hạn | Gắn lỗi start/end/timezone |
| `InvalidRecurrence`, `InvalidRecurrenceEnd` | Frequency/weekday/end rule sai | Gắn lỗi Repeat/Ends |
| `TooManyReminders`, `DuplicateReminder`, `InvalidReminderOffset` | Reminder sai rule | Gắn lỗi reminder list |
| `InvalidRange` | Query rỗng, đảo hoặc quá 62 ngày | Sửa request, không retry |
| `OccurrenceLimitExceeded` | Kết quả expansion sẽ vượt 5.000 | Thu hẹp khoảng/filter |
| `EventNotFound` | Event bị xóa/không tồn tại | Đóng detail và refresh |
| `RevisionConflict` | Có write mới hơn | Reload detail và yêu cầu người dùng áp lại edit |
| `DeleteConfirmationMissing`, `DeleteConfirmationExpired`, `DeleteImpactChanged` | Confirm không còn khớp preview | Tạo preview mới và hỏi lại |
| `CorruptStoredData` | Row không thỏa domain invariant | Không đoán/sửa ngầm; chặn thao tác và log metadata |
| `StorageUnavailable` | Lỗi Storage/migration/transaction | Hiển thị lỗi chung và cho retry |

Error serialize theo `{ kind, ...fields }`; không chứa raw SQLite/RRULE parser error, title, description, search query, project path hoặc nội dung backup.

## Luồng chính

### Tạo hoặc sửa event

1. Command authorize caller và validate DTO thuần; project lookup nếu có thực hiện qua public BE-003 service trước khi lấy Calendar mutation lock.
2. Service parse timezone/local time, canonicalize recurrence, normalize text/reminder và tạo derived UTC/search fields.
3. Service lấy `DataMaintenanceGate`, Calendar mutation lock rồi `Storage::with_transaction` immediate. Update so revision trong cùng transaction; project FK bắt race.
4. Repository ghi event và reminder delta nguyên tử; commit trước khi DTO được trả.
5. Service tăng revision/sequence, emit `calendar://changed` và báo internal sink BE-019. Read/search/month/upcoming tự refresh từ invalidation.

### Truy vấn occurrence

1. Service đổi range viewer date thành instant bounded cho candidate timed, đồng thời giữ date range cho all-day.
2. Repository lấy base events/reminders có thể overlap: non-recurring theo index; recurring có DTSTART trước range end và end rule chưa hết trước vùng cần xét.
3. `recurrence.rs` expand từng series bounded bằng `rrule`, loại candidate date/local-time không hợp lệ trước khi tăng `AfterCount`, resolve all-day bằng instant hợp lệ đầu tiên trong ngày, rồi áp overlap và project/reminder filter.
4. Nếu tổng >5.000 trả `OccurrenceLimitExceeded`; nếu không, sort ổn định và trả một snapshot revision.

### Backup/import/reset

1. BE-012 lấy app-wide maintenance gate và transaction xuyên domain, gọi Events participant cuối apply order sau project/notes theo contract hiện có.
2. App adapter clone toàn bộ v3 event, remap optional project ID bằng `ProjectImportMap::resolve`; Calendar prepare chỉ nhận bản sao đã remap, validate canonical target ID cùng domain field và dựng immutable plan, không mutation ở prepare. Projects apply trước Events bảo đảm FK khi ghi.
3. Apply/reset dùng `_in` API trong transaction đang có và trả `CalendarMaintenanceProjection`; rollback chỉ drop projection, không thay runtime state và không phát event.
4. Sau commit, BE-012 chuyển đúng projection vào `publish_event_maintenance` một lần để FE, BE-010 và BE-019 reload. Publish là no-fail, không query database. Import v1/v2 bỏ qua Calendar và giữ nguyên event local.

## Ràng buộc kỹ thuật

- Blocking: Mọi rusqlite, normalization trên tập candidate, RRULE expansion và backup operation chạy trong `tauri::async_runtime::spawn_blocking`. Không giữ `State`, gate/mutex, connection/transaction hoặc borrowed row qua `.await`.
- Bảo mật: Chỉ caller `main`; mọi SQL bound parameter; không filesystem/network; không log title/description/query/raw backup; reject unknown input fields, payload text/array/range có cap; không nhận raw RRULE từ IPC.
- Hiệu năng: Range UI ≤62 ngày, Upcoming chuẩn 14 ngày, ≤5.000 occurrence/query, ≤64 search candidate, ≤5.000 reminder occurrence/read và ≤16 reminders/event. Không materialize occurrence table; index non-recurring fast path trước khi expand recurring candidates.
- Concurrency: Một Calendar mutation mutex serialize revision/write/event sequence. Reads serialize theo Storage hiện có. App-wide maintenance gate đứng ngoài Calendar lock; dependency lookup không giữ lock qua await.
- Nền tảng: Test phát triển chạy Windows. Timezone/recurrence dùng database crate cố định để kết quả không phụ thuộc Windows timezone registry; macOS defer tới release preparation.

## Tiêu chí hoàn thành

- [ ] Migration `0008_create_calendar_events.sql` chạy đúng sau `0007`, rollback transaction khi lỗi và giữ FK/index/CHECK như contract.
- [ ] CRUD timed/all-day round-trip đúng, reminder IDs ổn định theo offset, project delete tự unlink và stale revision không ghi đè.
- [ ] Form rule title/description/date/timezone/DST/duration/recurrence/end/reminder đều được backend từ chối bằng typed error tương ứng.
- [ ] Month/upcoming/project/home query trả occurrence overlap đúng, sort deterministic, giữ wall time qua DST và báo lỗi khi quá range/result cap.
- [ ] Monthly ngày 29–31, yearly 29/02, weekly multi-day, inclusive end date/count, invalid candidate không tiêu thụ count và ambiguous/nonexistent/skipped-day timezone có golden tests.
- [ ] Search adapter trả tối đa một result/base event đúng `EventSearchSource`, resolve optional project name và không materialize recurrence.
- [ ] Public BE-019 ports trả due occurrence/context read-only, occurrence identity chứa resolved instant, reconcile timezone hủy identity cũ và không tạo delivery state.
- [ ] Backup v3 export/import/reset giữ reminder ID khi semantic không đổi, remap UUID v5 deterministic khi incoming-wins đổi offset; app adapter clone/remap project bằng `ProjectImportMap::resolve` trước owner; recompute derived fields, v1/v2 giữ Events và rollback không emit.
- [ ] Generated `src/bindings/calendar.ts` khớp Rust DTO, không có sửa tay; command chỉ register một lần và chỉ `main` gọi được.
- [ ] `calendar://changed` chỉ phát sau commit, đúng một event/mutation hoặc một aggregate event/bulk; failed transaction/read không phát.
- [ ] `cargo fmt --check`, Clippy không warning, Rust unit/integration tests, frontend formatter/linter/typecheck/test liên quan và Windows Tauri build đều pass.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/calendar/recurrence.rs` (`#[cfg(test)]`) | Unit | Canonical RRULE, weekly sort, count/until sau validation, monthly/yearly skip, DST ambiguous/nonexistent, all-day first-valid-instant/skipped date và expansion cap |
| `src-tauri/src/calendar/models.rs` (`#[cfg(test)]`) | Unit | Text/UUID/revision/date/time/reminder validation, serde deny unknown và backup round-trip |
| `src-tauri/tests/calendar_commands.rs` | Integration | Caller, CRUD, transaction, reminder ID delta, project link/delete race, optimistic conflict và confirm-delete TTL/fingerprint |
| `src-tauri/tests/calendar_occurrences.rs` | Integration | Non-recurring overlap, repeated occurrence, invalid DST/date candidate không tiêu thụ count, viewer timezone, all-day first-valid-instant/skipped date, filters/sort/revision và 62-day/5.000 cap |
| `src-tauri/tests/calendar_consumers.rs` | Contract | Event search một base result; BE-019 due/context port; all-day key chứa instant và đổi theo timezone; sink/event chỉ sau commit và không có delivery write |
| `src-tauri/tests/data_management_contract.rs` | Integration | Golden v3, required events array, v1/v2 preservation, source/local/dangling project resolve, parsed record bất biến, Calendar không nhận map, reminder UUID v5 remap, semantic unchanged giữ ID, incoming-wins, typed projection/reset và rollback/event |
| `src-tauri/tests/app_builder.rs` | Integration | Shared maintenance gate, managed Calendar, command/search/data adapter đăng ký đúng một lần |
| `src-tauri/tests/export_bindings.rs` | Contract | Sinh toàn bộ DTO/event/error BE-018 và fail khi `src/bindings/calendar.ts` lệch Rust source |

## Câu hỏi mở

- Không có.
