# BE-019 — Reminder scheduler

Tài liệu này đặc tả contract backend cho việc phát reminder theo thời gian, ghi nhận reminder bị lỡ khi XWork đã thoát, Snooze `5/10/30` phút, Dismiss và tích hợp Notification Center/OS notification. Contract dùng occurrence do BE-018 chiếu, không đọc bảng Calendar nội bộ và vẫn hội tụ đúng sau crash, sleep, thay đổi event, import hoặc reset.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-019` |
| Phase | `4` |
| Capability | `src-tauri/src/calendar/` |
| Yêu cầu chức năng | §13.3; liên quan §5.3–5.4, §13.1–13.2, §15, §17.5 và §18 |
| Frontend liên quan | `FE-010`, `FE-021`, `FE-022`, `FE-023` |
| Phụ thuộc | `BE-001`, `BE-002`, `BE-008`, `BE-011`, `BE-012`, `BE-018` |

## Mục tiêu

Backend theo dõi các reminder occurrence hiện hành, đánh thức đúng hạn khi process XWork còn chạy, tạo bell item và OS notification theo settings/visibility, đồng thời lưu trạng thái delivery đủ để không phát trùng sau restart. Reminder đến hạn trong khoảng XWork đã thoát được đưa vào Calendar › Missed và có thể Open/Dismiss nhưng tuyệt đối không tạo hàng loạt OS notification.

### Ngoài phạm vi

- Không tạo reminder độc lập, không sửa recurrence/reminder definition và không tự materialize occurrence tương lai; BE-018 là authority của event, timezone, recurrence và reminder offset.
- Không chạy daemon/service hệ điều hành khi process XWork đã thoát. Close main window chỉ hide to tray nên scheduler vẫn chạy; Quit thật dừng scheduler.
- Không backup notification inbox, delivery, Missed hoặc Snooze state. BE-012 schema v3 chỉ backup event/reminder definition.
- Không hứa action button/click callback trong toast desktop. `tauri-plugin-notification = 2.3.3` chỉ công bố Actions API cho mobile; trên Windows/macOS toast là informational. `Open event`, `Snooze` và `Dismiss` được bảo đảm trong bell/Missed UI qua custom command của XWork.
- Không thêm custom snooze duration, per-occurrence edit, retry OS toast hoặc retention tự động ngoài state cleanup do event/reset sở hữu.

### Quyết định và giả định đã chốt

1. Registry Phase 4 chạy đúng chuỗi `0008_create_calendar_events.sql` → `0009_create_reminder_deliveries.sql` → `0010_add_notification_settings.sql`. `0009` sở hữu delivery/checkpoint và rebuild shape `notifications` cho event target đã được BE-011 dành sẵn; `0010` do BE-008 sở hữu và thêm notification settings. App chỉ khởi tạo Calendar/Reminder/notification-settings participant sau khi toàn registry qua version `10`, rồi mới cho backup schema v3 hoạt động.
2. Không materialize lịch tương lai. Scheduler giữ checkpoint “mọi due instant nhỏ hơn mốc này đã được phân loại”, query public `CalendarService::reminder_occurrences` theo cửa sổ tối đa 31 ngày và persist một row khi reminder thực sự đến hạn hoặc bị lỡ.
3. Identity delivery là unique `(reminder_id, occurrence_id)`. Cùng một delivery được tái dùng qua nhiều lần Snooze; `generation` tăng mỗi lần phát lại. Notification Center upsert theo source key cố định `event-reminder:{delivery_id}`, vì vậy crash/retry không tạo item trùng.
4. Lần chạy đầu sau migration đặt checkpoint bằng thời điểm khởi tạo và không biến toàn bộ reminder lịch sử trước khi feature tồn tại thành Missed. Các lần chạy sau phân loại khoảng `[checkpoint, startupBoundary)` là Missed trước khi scheduler live bắt đầu.
5. Reminder đến hạn khi process đang chạy là `active`, kể cả main window đang ẩn hoặc máy vừa resume. Chỉ khoảng downtime giữa hai process mới là `missed`; cách phân loại này kiểm chứng được và không dựa vào độ trễ timer không ổn định.
6. `event_reminders_enabled = false` không tắt scheduler. Due live được ghi `suppressed`; due trong downtime vẫn được ghi `missed` để tab Missed luôn hoạt động, nhưng BE-011 không tạo bell item và không có OS toast. Bật lại không backfill notification đã bị chặn.
7. In-app item được tạo khi setting bật, bất kể event đang trên màn hình. OS toast chỉ được thử cho delivery `active` khi setting bật và exact event detail không đang hiển thị trong main window. Month/day chip đơn thuần không được coi là exact event detail.
8. `Open event` không đồng nghĩa Dismiss. Nó chỉ xác nhận target hiện còn hợp lệ và trả route typed; người dùng phải chọn Dismiss riêng nếu muốn bỏ item/Missed, đúng với hai action tách biệt trong wireframe.
9. Snooze chỉ hợp lệ với delivery `active`, dùng `now + 5/10/30 phút`, không dùng thời điểm due cũ. Missed UI theo wireframe chỉ có Open/Dismiss nên không cho Snooze một reminder đã Missed.
10. OS dispatch là at-most-once theo delivery generation: service persist quyết định `attempted` trước khi gọi plugin. Crash ở khe giữa hai bước có thể làm mất toast nhưng không được phép gửi trùng sau restart; bell item bền vững vẫn là nguồn đáng tin cậy.
11. Wireframe minh họa recurrence/end time trong notification context, nhưng public context BE-018 hiện chỉ có title, project, start, timezone và reminder definitions. BE-019 dùng đúng các field đó để dựng title/context; không truy cập recurrence hoặc repository nội bộ chỉ để khớp copy minh họa.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/src/lib.rs` | Export module `calendar`, `notifications` và giữ `app::configure` làm composition root. |
| `src-tauri/src/app/mod.rs` | Khởi tạo service sau migrations 1–10, inject Calendar/Settings/Notifications/lifecycle adapters, đăng ký command và nối startup/Quit/reset. |
| `src-tauri/src/app/lifecycle.rs` | Fan-out main-window visibility và gọi Reminder shutdown trước khi Storage đóng trong true Quit. |
| `src-tauri/src/app/reminder_dependencies.rs` | Adapter consumer-side của Reminder gọi public contract BE-001/008/011/018 mà không đọc state/repository nội bộ. |
| `src-tauri/src/app/notification_dependencies.rs` | Hiện thực `NotificationDependencies::event_target` của BE-011 bằng public context BE-018 rồi map sang type consumer-owned. |
| `src-tauri/src/app/data_runtime.rs` | Quiesce/resume Reminder và Notifications quanh transaction reset theo BE-012; không dùng true-Quit path. |
| `src-tauri/src/calendar/mod.rs` | Re-export DTO, error, service, scheduler và maintenance contract reminder. |
| `src-tauri/src/calendar/reminder_models.rs` | Row model, DTO, cursor, state machine, validation và redaction. |
| `src-tauri/src/calendar/reminder_repository.rs` | SQL checkpoint/delivery, keyset Missed, optimistic action và cleanup/reconcile qua Storage. |
| `src-tauri/src/calendar/reminder_scheduler.rs` | Startup catch-up, live scan, timer có clock inject được, retry notification sync và shutdown gate. |
| `src-tauri/src/calendar/reminder_service.rs` | Command orchestration, sequence/event, settings/visibility snapshot, Snooze/Dismiss/Open và reset publish. |
| `src-tauri/src/calendar/reminder_commands.rs` | Bảy Tauri command mỏng, chỉ cho window `main`. |
| `src-tauri/src/calendar/service.rs` | Giữ nguyên public due/context query BE-018 và fan-out invalidation đã commit tới scheduler. |
| `src-tauri/src/notifications/models.rs` | Mở rộng kind/target DTO cho event reminder và strict row decoder Phase 4. |
| `src-tauri/src/notifications/repository.rs` | Upsert/delete reminder item idempotent theo source key, không gửi OS. |
| `src-tauri/src/notifications/service.rs` | Public reminder intake port, revision/event sau upsert/delete và event-target validation khi Open. |
| `src-tauri/src/notifications/commands.rs` | Cho `open_notification` trả target event typed; sáu command BE-011 hiện hữu không tăng số lượng. |
| `src-tauri/src/notifications/mod.rs` | Re-export intake type và consumer-owned `NotificationDependencies`/`NotificationEventTarget` mở rộng ở Phase 4. |
| `src-tauri/src/platform/notification.rs` | Adapter OS notification informational dùng chung, recording fake và permission/error categorization. |
| `src-tauri/src/settings/mod.rs` | Cung cấp `SettingsService::snapshot`/`subscribe` notification settings theo contract BE-008 Phase 4. |
| `src-tauri/src/settings/data.rs` | Giữ backup schema v3 không chứa delivery; không thêm section BE-019. |
| `src-tauri/src/app/data_reset_participants.rs` | Đăng ký typed reset-only participant Reminder/Notifications theo BE-012 và publish projection sau commit. |
| `src-tauri/src/storage/migrations.rs` | Đăng ký version `9` rồi version `10` liên tiếp. |
| `src-tauri/migrations/0009_create_reminder_deliveries.sql` | Tạo delivery/checkpoint và rebuild `notifications` giữ dữ liệu Phase 1, thêm target event. |
| `src-tauri/migrations/0010_add_notification_settings.sql` | BE-008 thêm năm field notification settings, gồm `event_reminder_notifications_enabled`. |
| `src-tauri/src/bin/export_bindings.rs` | Đăng ký DTO/event/error reminder và extension Notifications. |
| `src/bindings/reminders.ts` | Binding sinh từ Rust cho command/event BE-019; không sửa tay. |
| `src/bindings/notifications/` | Binding BE-011 được sinh lại với reminder kind/target; không sửa tay. |
| `src/bindings/settings.ts` | Binding BE-008 được sinh lại với notification settings; không sửa tay. |
| `src-tauri/tests/reminder_scheduler.rs` | Integration với controlled clock cho due, catch-up, restart, sleep và recurrence. |
| `src-tauri/tests/reminder_actions.rs` | Integration command Missed/Open/Snooze/Dismiss/visibility và optimistic concurrency. |
| `src-tauri/tests/reminder_notifications.rs` | Contract BE-011 upsert/delete, OS eligibility/at-most-once và failure recovery. |
| `src-tauri/tests/data_management_contract.rs` | Xác nhận backup loại delivery và reset xóa reminder/notification state nguyên tử. |
| `src-tauri/tests/app_builder.rs` | Smoke startup/migration/service/sink/command/Quit order đúng một lần. |
| `src-tauri/tests/settings_commands.rs` | Xác nhận migration `0010`, snapshot/subscription và năm notification settings sau `0009`. |
| `src-tauri/tests/export_bindings.rs` | Contract test binding Rust/TypeScript và enum target Phase 4. |
| `tests/e2e/calendar-reminders.e2e.ts` | Desktop E2E Windows cho bell, Missed, Open/Snooze/Dismiss, tray và fake OS adapter. |
| `tests/e2e/settings-notifications.e2e.ts` | Desktop E2E Windows cho event reminder toggle và không backfill. |

Không thêm permission notification cho webview: chỉ adapter Rust gọi plugin. Các action reminder đi qua custom command đã authorize, không qua plugin notification JS.

## Dữ liệu

### Migration `0009_create_reminder_deliveries.sql`

Migration tạo hai bảng dưới đây rồi rebuild `notifications` trong cùng transaction do runner BE-002 quản lý. File SQL không tự `BEGIN`, `COMMIT`, đổi `PRAGMA foreign_keys` hoặc đặt `user_version`.

```sql
CREATE TABLE reminder_scheduler_state (
    singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
    scan_through_ms INTEGER NULL CHECK (scan_through_ms IS NULL OR scan_through_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

INSERT INTO reminder_scheduler_state(singleton_id, scan_through_ms, updated_at_ms)
VALUES (1, NULL, 0);

CREATE TABLE reminder_deliveries (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 54),
    reminder_id TEXT NOT NULL CHECK (length(reminder_id) = 36),
    event_id TEXT NOT NULL CHECK (length(event_id) = 36),
    occurrence_id TEXT NOT NULL CHECK (length(occurrence_id) BETWEEN 1 AND 80),
    project_id TEXT NULL CHECK (project_id IS NULL OR length(project_id) = 36),
    title_snapshot TEXT NOT NULL CHECK (length(trim(title_snapshot)) BETWEEN 1 AND 200),
    starts_at_ms INTEGER NOT NULL,
    original_due_at_ms INTEGER NOT NULL,
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) BETWEEN 1 AND 64),
    minutes_before INTEGER NOT NULL CHECK (minutes_before BETWEEN 0 AND 525600),
    status TEXT NOT NULL CHECK (
        status IN ('active', 'missed', 'snoozed', 'dismissed', 'suppressed', 'cancelled')
    ),
    next_fire_at_ms INTEGER NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    version INTEGER NOT NULL CHECK (version >= 1),
    notification_sync TEXT NOT NULL CHECK (
        notification_sync IN ('none', 'upsert_pending', 'synced', 'delete_pending')
    ),
    notification_retry_at_ms INTEGER NULL,
    notification_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (notification_retry_count >= 0),
    os_state TEXT NOT NULL CHECK (
        os_state IN ('none', 'pending', 'suppressed_visible', 'attempted')
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms),
    UNIQUE (reminder_id, occurrence_id),
    CHECK (
        (status = 'snoozed' AND next_fire_at_ms IS NOT NULL)
        OR (status <> 'snoozed' AND next_fire_at_ms IS NULL)
    ),
    CHECK (
        (notification_sync IN ('upsert_pending', 'delete_pending')
            AND notification_retry_at_ms IS NOT NULL)
        OR (notification_sync IN ('none', 'synced')
            AND notification_retry_at_ms IS NULL)
    ),
    CHECK (status = 'active' OR os_state = 'none')
) STRICT;

CREATE INDEX idx_reminder_deliveries_missed
    ON reminder_deliveries(original_due_at_ms DESC, id DESC)
    WHERE status = 'missed';
CREATE INDEX idx_reminder_deliveries_snoozed
    ON reminder_deliveries(next_fire_at_ms, id)
    WHERE status = 'snoozed';
CREATE INDEX idx_reminder_deliveries_notification_sync
    ON reminder_deliveries(notification_retry_at_ms, id)
    WHERE notification_sync IN ('upsert_pending', 'delete_pending');
CREATE INDEX idx_reminder_deliveries_event
    ON reminder_deliveries(event_id, occurrence_id, reminder_id);
```

`notifications` được rename tạm, tạo lại và copy toàn bộ row Phase 1 trước khi drop bảng tạm. Phần còn lại của migration phải tương đương chính xác với:

```sql
ALTER TABLE notifications RENAME TO notifications_v5;

CREATE TABLE notifications (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 49),
    source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 40),
    source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 255),
    source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 1 AND 320),
    kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    context TEXT NOT NULL CHECK (length(context) BETWEEN 1 AND 240),
    target_kind TEXT NOT NULL CHECK (target_kind IN ('session', 'event')),
    project_id TEXT NULL CHECK (project_id IS NULL OR length(project_id) = 36),
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 255),
    tab_id TEXT NULL CHECK (tab_id IS NULL OR length(tab_id) BETWEEN 1 AND 255),
    pane_id TEXT NULL CHECK (pane_id IS NULL OR length(pane_id) BETWEEN 1 AND 255),
    status_code TEXT NULL CHECK (
        status_code IS NULL OR length(status_code) BETWEEN 1 AND 20
    ),
    occurrence_id TEXT NULL CHECK (
        occurrence_id IS NULL OR length(occurrence_id) BETWEEN 1 AND 80
    ),
    reminder_delivery_id TEXT NULL CHECK (
        reminder_delivery_id IS NULL OR length(reminder_delivery_id) = 54
    ),
    delivery_version INTEGER NULL CHECK (
        delivery_version IS NULL OR delivery_version >= 1
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    read_at_ms INTEGER NULL CHECK (
        read_at_ms IS NULL OR read_at_ms >= created_at_ms
    ),
    CHECK (
        (target_kind = 'session'
            AND project_id IS NOT NULL
            AND tab_id IS NOT NULL
            AND pane_id IS NOT NULL
            AND occurrence_id IS NULL
            AND reminder_delivery_id IS NULL
            AND delivery_version IS NULL)
        OR
        (target_kind = 'event'
            AND length(target_id) = 36
            AND tab_id IS NULL
            AND pane_id IS NULL
            AND status_code IS NULL
            AND occurrence_id IS NOT NULL
            AND reminder_delivery_id IS NOT NULL
            AND delivery_version IS NOT NULL)
    )
);

INSERT INTO notifications (
    id, source_kind, source_id, source_key, kind, title, context,
    target_kind, project_id, target_id, tab_id, pane_id, status_code,
    occurrence_id, reminder_delivery_id, delivery_version,
    created_at_ms, read_at_ms
)
SELECT
    id, source_kind, source_id, source_key, kind, title, context,
    target_kind, project_id, target_id, tab_id, pane_id, status_code,
    NULL, NULL, NULL, created_at_ms, read_at_ms
FROM notifications_v5;

DROP TABLE notifications_v5;

CREATE INDEX idx_notifications_order
    ON notifications(created_at_ms DESC, id DESC);
CREATE INDEX idx_notifications_unread
    ON notifications(created_at_ms DESC, id DESC)
    WHERE read_at_ms IS NULL;
CREATE INDEX idx_notifications_source
    ON notifications(source_kind, source_id, kind);
CREATE INDEX idx_notifications_target
    ON notifications(target_kind, target_id);
```

Shape Phase 4 có các quy ước bổ sung sau:

- `project_id` thành nullable với `CHECK(project_id IS NULL OR length(project_id) = 36)`.
- `tab_id`, `pane_id` và `status_code` thành nullable.
- Thêm `occurrence_id TEXT NULL`, `reminder_delivery_id TEXT NULL`, `delivery_version INTEGER NULL`.
- Target `session` bắt buộc `project_id/target_id/tab_id/pane_id`, cấm ba field reminder và cho `status_code` theo BE-011.
- Target `event` bắt buộc `target_id` là event UUID, `occurrence_id` dài 1–80, `reminder_delivery_id` dài 54, `delivery_version >= 1`; `project_id` có thể null; `tab_id/pane_id/status_code` phải null.
- Rust strict-decode chỉ nhận ba kind terminal hiện hữu và hai kind mới `event_reminder_due`, `event_reminder_missed`; source reminder dùng `source_kind = event_reminder`, `source_id = delivery_id`, `source_key = event-reminder:{delivery_id}`.
- Unique `source_key` được giữ nên copy hoặc rebuild lỗi sẽ rollback toàn migration.

Migration version `9` không đọc cột settings version `10`. Sau version `10`, service mới map `event_reminders_enabled` sang policy runtime.

### Bảng `reminder_scheduler_state`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `singleton_id` | `INTEGER` | PK, luôn `1` | Bảo đảm đúng một checkpoint. |
| `scan_through_ms` | `INTEGER` | Nullable, không âm | Mọi due instant `< value` đã được phân loại; `NULL` chỉ tồn tại trước lần khởi tạo đầu. |
| `updated_at_ms` | `INTEGER` | Không âm | Thời điểm checkpoint được commit, phục vụ chẩn đoán không chứa user data. |

### Bảng `reminder_deliveries`

| Cột | Ý nghĩa |
|---|---|
| `id` | `reminder-delivery-` + UUID v4 canonical lowercase do backend sinh. |
| `reminder_id`, `event_id`, `occurrence_id` | Identity từ public BE-018 occurrence; unique reminder + occurrence chống duplicate restart. |
| `project_id`, `title_snapshot`, `starts_at_ms`, `time_zone_id`, `minutes_before` | Snapshot tối thiểu cho Missed/bell; không chứa description. |
| `original_due_at_ms` | Due instant do BE-018 tính, không đổi qua Snooze. |
| `status` | `active`, `missed`, `snoozed` hoặc terminal `dismissed/suppressed/cancelled`. |
| `next_fire_at_ms` | Chỉ có ở `snoozed`; scheduler dùng index để đánh thức. |
| `generation` | Tăng khi Snooze phát lại; OS at-most-once và notification upsert thuộc generation hiện hành. |
| `version` | Optimistic concurrency public cho action; tăng sau mọi thay đổi user-visible/reconcile. |
| `notification_sync`, retry fields | Outbox nhỏ để hội tụ upsert/delete BE-011 sau crash/dependency failure. |
| `os_state` | `pending` trước policy decision, `suppressed_visible` hoặc `attempted`; chỉ áp dụng `active`. |
| `created_at_ms`, `updated_at_ms` | Unix milliseconds UTC; update được clamp không nhỏ hơn created/current row time khi clock lùi. |

Không đặt FK sang `event_reminders` hoặc `notifications`: delivery phải sống đủ lâu để biểu diễn Missed sau khi process restart, còn thay đổi/xóa event được reconcile qua public context và post-commit invalidation. Không có retention tự động; reset hoặc explicit event invalidation mới xóa/cancel theo rule dưới đây.

## DTO public

Mọi DTO derive `Clone`, `Debug`, `Serialize`, `Deserialize`, `TS`; struct dùng `camelCase`, enum đơn dùng `snake_case`. Timestamp/version/sequence là decimal `u64` string để không mất chính xác ở JavaScript.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ReminderDeliveryStatusDto {
    Active,
    Missed,
    Snoozed,
    Dismissed,
    Suppressed,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
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

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReminderCursorDto {
    pub original_due_at_ms: String,
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MissedReminderPageDto {
    pub sequence: String,
    pub missed_count: u32,
    pub items: Vec<ReminderDeliveryDto>,
    pub next_cursor: Option<ReminderCursorDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EventReminderDeliveriesDto {
    pub sequence: String,
    pub event_id: String,
    pub occurrence_id: String,
    pub items: Vec<ReminderDeliveryDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReminderTargetDto {
    pub event_id: String,
    pub occurrence_id: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReminderActionResultDto {
    pub sequence: String,
    pub missed_count: u32,
    pub delivery: ReminderDeliveryDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum VisibleCalendarEventInputDto {
    Show {
        view_token: String,
        event_id: String,
        occurrence_id: String,
    },
    Hide { view_token: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReminderChangedDto {
    pub sequence: String,
    pub missed_count: u32,
}
```

`cancelled` là cleanup nội bộ và không trả như item. `EventReminderDeliveriesDto` chỉ trả delivery đã materialize; FE-022 merge với reminder definitions BE-018, coi definition chưa có delivery là pending. Missed page sort `original_due_at_ms DESC, id DESC`, mặc định 30, tối đa 100.

BE-011 mở rộng DTO thuộc owner của nó:

```rust
pub enum NotificationKindDto {
    TerminalNeedsInput,
    TerminalProcessFinished,
    TerminalProcessFailed,
    EventReminderDue,
    EventReminderMissed,
}

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotificationTargetDto {
    Session {
        project_id: String,
        session_id: String,
        tab_id: String,
        pane_id: String,
    },
    EventReminder {
        project_id: Option<String>,
        event_id: String,
        occurrence_id: String,
        reminder_delivery_id: String,
        delivery_version: String,
    },
}
```

BE-011 giữ `NotificationDto`/page/command hiện hữu. Reminder upsert làm item unread trở lại và cập nhật `created_at_ms`, target version, title/context cho generation mới; notification ID/source key vẫn ổn định.

Chuỗi notification được dựng ở backend, bằng English cố định và từ snapshot đã chuẩn hóa:

- Due title là `{event title} starts now` khi offset `0`; nếu offset chia hết cho 1.440 hoặc 60 thì dùng `{N} day/days` hoặc `{N} hour/hours`, còn lại dùng `{N} minute/minutes`.
- Missed title là `{event title} reminder was missed`.
- Context là `{YYYY-MM-DD HH:mm} ({IANA time zone}) · reminder {offset label}`; date/time được tính từ `starts_at_ms` trong `time_zone_id`, không dùng timezone/locale OS và không dùng relative `Today` trong dữ liệu bền vững.
- Title/context tiếp tục qua bộ lọc control/whitespace và cap 120/240 scalar của BE-011 trước khi ghi bell hoặc gửi OS.

## Public Rust contract và scheduler

BE-019 chỉ tiêu thụ public BE-018 query hiện hữu:

```rust
impl CalendarService {
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
}
```

Scheduler gọi và `.await` hai dependency này bên ngoài mọi Reminder lock và maintenance transaction; kết quả owned mới được đưa vào bước phân loại hoặc reconcile tiếp theo.

Khoảng luôn half-open, mỗi query tối đa 31 ngày và 5.000 item. Catch-up dài hơn chia thành cửa sổ ≤31 ngày. Nếu query chạm đúng 5.000 item, scheduler chia đôi cửa sổ và query lại trước khi tăng checkpoint; nếu cửa sổ 1 ms vẫn bão hòa, giữ nguyên checkpoint, báo diagnostic `occurrence_batch_saturated` và retry thay vì âm thầm bỏ reminder.

BE-011 bổ sung public intake port không đi qua IPC và không gửi OS:

```rust
pub struct ReminderNotificationInput {
    pub delivery_id: String,
    pub delivery_version: u64,
    pub kind: ReminderNotificationKind,
    pub title: String,
    pub context: String,
    pub project_id: Option<String>,
    pub event_id: String,
    pub occurrence_id: String,
    pub created_at_ms: i64,
}

impl NotificationService {
    /// Inserts or refreshes one reminder bell item by its stable source key.
    pub async fn upsert_reminder(
        &self,
        input: ReminderNotificationInput,
    ) -> Result<(), NotificationError>;

    /// Removes the bell item owned by one reminder delivery idempotently.
    pub async fn remove_reminder(
        &self,
        delivery_id: &str,
    ) -> Result<(), NotificationError>;
}
```

`open_notification` không gọi `CalendarService` trực tiếp. Nó dùng phần Phase 4 dưới đây trong consumer-owned trait đã chốt tại BE-011; snippet là phần trích của trait hiện hữu, không khai báo trait thứ hai:

```rust
pub struct NotificationEventTarget {
    pub event_id: String,
    pub occurrence_id: String,
    pub project_id: Option<String>,
}

pub trait NotificationDependencies: Send + Sync {
    /// Resolves one current Calendar occurrence for an event notification target.
    fn event_target<'a>(
        &'a self,
        event_id: &'a str,
        occurrence_id: &'a str,
    ) -> NotificationFuture<'a, Result<Option<NotificationEventTarget>, NotificationError>>;
}
```

Adapter `app/notification_dependencies.rs` gọi `CalendarService::get_notification_context`, chỉ map `event_id`, `occurrence_id`, `project_id` sang `NotificationEventTarget`; `None` làm target stale, còn `CalendarError` được làm sạch thành `NotificationError::DependencyUnavailable`. Nhờ vậy Notifications không import Calendar service/repository implementation và route dùng project hiện hành thay vì `project_id` snapshot trong row delivery.

`upsert_reminder` chuẩn hóa title/context theo giới hạn BE-011, dùng `ON CONFLICT(source_key) DO UPDATE`, đặt `read_at_ms = NULL`, tăng Notifications revision/event đúng một lần khi row thay đổi. `remove_reminder` no-op khi row không còn. BE-019 không giữ delivery/storage lock qua hai call; outbox row cho phép retry với exponential backoff `1s, 2s, 4s, ...`, cap 5 phút.

Clock và lifecycle là dependency inject được:

```rust
pub type ReminderFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait ReminderClock: Send + Sync {
    /// Returns the current UTC Unix epoch in milliseconds.
    fn now_ms(&self) -> i64;

    /// Completes at the requested UTC instant or when a controlled test advances time.
    fn sleep_until<'a>(&'a self, instant_ms: i64) -> ReminderFuture<'a, ()>;
}

pub struct ReminderResetPlan {
    pub baseline_ms: i64,
    pub delivery_count: u32,
    next_sequence: u64,
}

pub struct ReminderResetProjection {
    pub baseline_ms: i64,
    pub removed_delivery_count: u32,
    next_sequence: u64,
}

impl ReminderService {
    /// Wakes and reconciles the scheduler after one committed Calendar change.
    pub fn observe_calendar_change(&self, event: CalendarChangedEventDto);

    /// Updates main-window visibility from the committed BE-001 lifecycle state.
    pub fn observe_main_window_visibility(&self, visible: bool);

    /// Stops intake/timers before Storage closes during true Quit.
    pub async fn shutdown_for_quit(&self) -> Result<(), ReminderError>;

    /// Quiesces timers and in-flight delivery work without closing the service.
    pub fn pause_for_reset(
        &self,
    ) -> ReminderFuture<'_, Result<(), ReminderError>>;

    /// Reopens timers and wakes reconciliation after commit or rollback.
    pub fn resume_after_reset(&self, committed: bool);

    /// Builds an owned reset plan from the coordinator's captured baseline.
    pub fn prepare_reminder_reset_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        baseline_ms: i64,
    ) -> Result<ReminderResetPlan, ReminderError>;

    /// Deletes reminder state inside the transaction owned by BE-012 reset.
    pub fn reset_reminders_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &ReminderResetPlan,
    ) -> Result<ReminderResetProjection, ReminderError>;

    /// Clears runtime projections and emits one aggregate invalidation after reset commit.
    pub fn publish_reminder_reset(&self, projection: ReminderResetProjection);
}
```

Production clock map UTC wall clock sang Tokio sleep; controlled clock giữ `now` và explicit wake handle để test không `sleep` theo thời gian thật. Scheduler `select!` giữa timer gần nhất, Calendar invalidation, Settings subscription, notification retry và shutdown. Khi không có due trong horizon 31 ngày, nó wake kiểm lại tối đa sau 6 giờ; create/update event luôn wake ngay.

Adapter reset-only của BE-012 lấy `DataResetContext.reminder_baseline_ms` đã capture đúng một lần rồi truyền scalar đó vào `prepare_reminder_reset_in`; Reminder không import type coordinator. Prepare là read-only, strict-decode checkpoint, đếm delivery và dựng owned plan/projection metadata mà không giữ transaction/reference. Apply chỉ nhận plan, xóa delivery rồi đặt singleton checkpoint đúng `baseline_ms` trong transaction hiện hành; nó không publish runtime. Sau commit, adapter wrap/unwrap đúng `ReminderResetProjection` và gọi `publish_reminder_reset` no-fail; method consume projection, swap sequence/projection đã chuẩn bị và emit aggregate best-effort mà không query database. Rollback drop plan/projection và gọi `resume_after_reset(false)`; commit publish đủ participant rồi mới gọi `resume_after_reset(true)` theo BE-012.

`ReminderService` giữ runtime-only `sequence: u64`, bắt đầu `0` mỗi process. Mỗi transaction làm thay đổi ít nhất một delivery user-visible tăng sequence đúng một lần; reset projection luôn mang sequence kế tiếp và publish tăng một lần sau commit. Query lấy cùng mutation gate để trả sequence/missed count tuyến tính; outbox-only retry không đổi delivery/version/sequence.

## Tauri command

Tất cả command chỉ chấp nhận exact window label `main`, clone service rồi nhả `tauri::State` trước `.await`.

### `get_missed_reminders`

```rust
/// Lists one keyset page of reminders missed while XWork was not running.
#[tauri::command]
pub async fn get_missed_reminders(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ReminderService>,
    cursor: Option<ReminderCursorDto>,
    limit: Option<u16>,
) -> Result<MissedReminderPageDto, ReminderError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; limit mặc định 30, `1..=100`; cursor timestamp decimal canonical, ID đúng prefix/UUID. |
| Side effect | Không có; query `limit + 1`, count toàn bộ `status = missed`. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidCursor`, `InvalidLimit`, `SchedulerCatchingUp`, `CorruptStoredDelivery`, `PersistenceFailed`, `Unavailable`. |

### `get_event_reminder_deliveries`

```rust
/// Returns materialized delivery states for one exact event occurrence.
#[tauri::command]
pub async fn get_event_reminder_deliveries(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ReminderService>,
    event_id: String,
    occurrence_id: String,
) -> Result<EventReminderDeliveriesDto, ReminderError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; UUID/occurrence ID canonical và BE-018 context hiện tồn tại. |
| Side effect | Không có; sort `minutes_before DESC, id ASC`. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidEventId`, `InvalidOccurrenceId`, `TargetUnavailable`, `SchedulerCatchingUp`, `DependencyUnavailable`, `CorruptStoredDelivery`, `PersistenceFailed`, `Unavailable`. |

### `open_reminder`

```rust
/// Resolves the currently valid event target without dismissing the reminder.
#[tauri::command]
pub async fn open_reminder(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ReminderService>,
    delivery_id: String,
) -> Result<ReminderTargetDto, ReminderError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; delivery tồn tại, chưa `cancelled`; `get_notification_context` vẫn trả đúng occurrence/reminder definition. |
| Side effect | Không đổi delivery/Missed. FE điều hướng rồi có thể mark notification read qua BE-011. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidDeliveryId`, `DeliveryNotFound`, `TargetUnavailable`, `DependencyUnavailable`, `CorruptStoredDelivery`, `PersistenceFailed`, `Unavailable`. |

### `snooze_reminder`

```rust
/// Reschedules one active reminder by an allowed number of minutes.
#[tauri::command]
pub async fn snooze_reminder(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ReminderService>,
    delivery_id: String,
    expected_version: String,
    minutes: u16,
) -> Result<ReminderActionResultDto, ReminderError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/version canonical; `minutes ∈ {5,10,30}`; status đúng `active`; current context/reminder còn tồn tại. |
| Side effect | Transaction đặt `snoozed`, `next_fire_at_ms = now + minutes`, tăng version, enqueue delete bell; commit rồi event/wake scheduler. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidDeliveryId`, `InvalidVersion`, `InvalidSnoozeMinutes`, `DeliveryNotFound`, `ActionNotAllowed`, `DeliveryChanged`, `TargetUnavailable`, `ClockOutOfRange`, `DependencyUnavailable`, `CorruptStoredDelivery`, `PersistenceFailed`, `Unavailable`. |

### `dismiss_reminder`

```rust
/// Dismisses one active, missed, or snoozed reminder idempotently by version.
#[tauri::command]
pub async fn dismiss_reminder(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ReminderService>,
    delivery_id: String,
    expected_version: String,
) -> Result<ReminderActionResultDto, ReminderError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/version canonical; delivery không `cancelled/suppressed`; version phải khớp. |
| Side effect | Transaction đặt `dismissed`, clear snooze/OS, tăng version, enqueue delete bell; commit rồi event. Dismissed cùng version cũ trả `DeliveryChanged`, không phát event lần hai. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidDeliveryId`, `InvalidVersion`, `DeliveryNotFound`, `ActionNotAllowed`, `DeliveryChanged`, `CorruptStoredDelivery`, `PersistenceFailed`, `Unavailable`. |

### `dismiss_all_missed_reminders`

```rust
/// Dismisses every reminder that is missed at one transaction boundary.
#[tauri::command]
pub async fn dismiss_all_missed_reminders(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ReminderService>,
) -> Result<ReminderChangedDto, ReminderError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`. |
| Side effect | Một transaction đổi toàn bộ `missed` thành `dismissed`, tăng từng row version và enqueue cleanup bell; một reminder event sau commit. No-op không tăng sequence/event. |
| Lỗi trả về | `UnauthorizedWindow`, `PersistenceFailed`, `Unavailable`. |

### `set_visible_calendar_event`

```rust
/// Reports the exact event detail currently rendered for OS-notification policy.
#[tauri::command]
pub async fn set_visible_calendar_event(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ReminderService>,
    input: VisibleCalendarEventInputDto,
) -> Result<(), ReminderError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; `view_token` UUID v4; Show có valid event/occurrence ID. Hide chỉ xóa khi token khớp projection hiện tại. |
| Side effect | Runtime-only visibility projection; không DB/event. Show mới atomically thay token cũ; Hide stale là no-op. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidViewToken`, `InvalidEventId`, `InvalidOccurrenceId`, `Unavailable`. |

BE-011 `open_notification` được mở rộng: target reminder gọi `NotificationDependencies::event_target`; app adapter hỏi BE-018 context hiện hành, rồi Notifications mark item read sau validation và trả `NotificationTargetDto::EventReminder`. FE-010 dùng `reminderDeliveryId/deliveryVersion` trong target cho Snooze/Dismiss; FE-021 dùng các command BE-019 trực tiếp.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `reminders://changed` | `ReminderChangedDto` | Sau transaction insert due/Missed, Snooze/Dismiss, reconcile/cancel hoặc reset làm đổi ít nhất một row user-visible | Chỉ emit `main`; sequence tăng nghiêm ngặt trong process; một transaction một event; payload chỉ có sequence/missed count, consumer refetch. |
| `notifications://changed` | `NotificationCenterChangedDto` của BE-011 | Khi reminder upsert/delete thực sự đổi bell row | BE-011 sở hữu revision/order; không gộp với reminder event và emit failure không rollback state. |

Không có Channel. Timer/invalidation/settings dùng channel Rust nội bộ; không stream ra webview.

## Business rule và invariant

1. Scheduler chỉ dùng public occurrence/context BE-018; không query `calendar_events` hoặc `event_reminders` trực tiếp.
2. Khoảng scan là half-open. `scan_through_ms = T` chỉ được commit sau khi mọi occurrence có `due_at_ms < T` trong cửa sổ đã insert/no-op theo unique key; notification/OS side effect có thể retry sau mà không giữ checkpoint.
3. Startup đầu tiên atomically đổi checkpoint `NULL → startupBoundary` và không backfill. Startup sau snapshot boundary một lần, phân loại `[checkpoint, boundary)` thành `missed`, rồi mới bật live loop từ boundary.
4. Catch-up dài chia cửa sổ ≤31 ngày; batch bão hòa bị chia nhỏ. Không tăng checkpoint qua một query lỗi/saturated 1 ms, không drop phần cuối do limit 5.000.
5. Live loop dùng boundary `now + 1 ms` checked để bao gồm due `<= now`; clock lùi không giảm checkpoint hoặc kéo Snooze lùi. Scheduler chờ clock bắt kịp và vẫn phản hồi invalidation/shutdown.
6. Unique `(reminder_id, occurrence_id)` là tuyến phòng thủ cuối cho duplicate timer, Calendar event, crash replay và nhiều wake cùng lúc. Conflict chỉ là no-op nếu identity cùng snapshot semantic khớp. BE-018 giữ reminder ID khi `(eventId, minutesBefore)` không đổi và remap UUID deterministic khi import incoming-wins đổi offset; vì vậy mismatch còn lại là corruption, không overwrite im lặng.
7. Delivery snapshot không chứa description. Title collapse whitespace, bỏ control nhưng giữ tối đa 200 scalar; notification title/context tiếp tục qua normalize 120/240 scalar của BE-011.
8. Due live với setting bật insert `active`, generation `1`, notification `upsert_pending`, OS `pending`. Bell upsert thành công không phụ thuộc OS. Lỗi bell giữ retry outbox; không đổi Calendar event. Trước retry side effect phải đọc policy mới nhất: nếu setting đã tắt, active chưa sync chuyển thành `suppressed`; active đã sync giữ bell cũ nhưng OS pending chuyển `none`.
9. Due live với setting tắt insert terminal `suppressed`, không bell/OS. Bật lại không chuyển row này thành active.
10. Due downtime luôn insert `missed`; setting bật tạo `event_reminder_missed` bell item, setting tắt vẫn giữ Calendar › Missed nhưng không bell. Nếu setting tắt trước retry của một Missed upsert, service bỏ pending sync nhưng giữ Missed; bật lại không backfill. Không trường hợp nào gọi OS adapter cho `missed`.
11. Khi Snooze fire, scheduler validate current context chứa đúng reminder ID. Hợp lệ thì đổi `snoozed → active`, tăng generation/version, refresh snapshot, upsert lại cùng bell item unread và đánh giá OS mới. Context mất thì `cancelled` và cleanup bell.
12. Snooze lấy clock tại linearization transaction, checked-add đúng `minutes * 60_000`; chỉ `5/10/30`. Hai action cùng expected version: đúng một action commit, action còn lại nhận `DeliveryChanged`.
13. Dismiss không xóa row ngay; terminal row giữ dedupe. Dismiss all chỉ tác động `missed`, không dismiss reminder active/snoozed.
14. Generic `delete_notification`/`clear_read_notifications` của BE-011 chỉ tác động bell item, không ngầm Dismiss delivery. Scheduler không recreate item đã synced chỉ vì người dùng xóa bell; generation Snooze mới có thể upsert lại.
15. Calendar create/update/delete/import/reset invalidation chỉ đến sau commit. Với từng event, scheduler reconcile mọi active/missed/snoozed delivery: context/definition mất thì cancel + delete bell; context còn thì refresh snapshot. All-day `occurrenceId` chứa `startAtMs`: đổi timezone làm instant đổi khiến identity cũ mất, nên delivery cũ bị cancel và identity mới chỉ được schedule nếu `dueAtMs >= scan_through_ms`; ngày bị timezone skip không sinh occurrence/delivery. Chỉ active/missed có bell hiện hữu hoặc đủ policy mới upsert; snoozed giữ bell đã xóa đến lần fire. Terminal dismissed/suppressed không phát lại.
16. Event/reminder được tạo hoặc dời sao cho due đã nằm trước live checkpoint không backfill ngay; chỉ occurrence due từ checkpoint trở đi được lịch. Quy tắc này tránh bất ngờ khi user nhập event quá khứ hoặc import dữ liệu cũ.
17. Exact event được xem là đang hiển thị chỉ khi BE-001 báo main visible và runtime projection có cùng `event_id` từ Event detail. Token ngăn unmount cũ xóa projection của detail mới.
18. Với active generation, service persist `os_state = suppressed_visible` hoặc `attempted` trước khi gọi plugin. `attempted` không có nghĩa OS đã hiển thị; plugin error chỉ log category và không retry.
19. Main hide-to-tray không dừng worker; projection main visible chuyển false trước policy decision tiếp theo. True Quit đặt shutdown gate, wake/join worker rồi Storage mới đóng. Reminder chưa claim giữ sau checkpoint và thành Missed ở lần mở kế.
20. Settings subscriber nhận snapshot hiện tại, wake scheduler khi đổi. Consumer chậm có thể bỏ revision giữa và luôn reconcile từ snapshot mới nhất; Settings unavailable fail-closed cho bell/OS, không tự dùng default trái dữ liệu commit.
21. Notification sync retry không giữ Calendar/Reminder/Storage lock qua await. Upsert cố định source key nên crash sau BE-011 commit nhưng trước delivery sync commit vẫn hội tụ một item.
22. Missed page keyset ổn định theo due + ID. Action/update không đổi `original_due_at_ms`; page cũ có thể stale và optimistic version ngăn thao tác nhầm.
23. Backup v3 loại toàn bộ hai bảng BE-019 và reminder notification rows. Import event definitions chỉ phát Calendar invalidation sau commit; BE-018 reminder-ID remap khiến semantic offset cũ cancel thay vì tái dùng delivery, còn event import có due quá khứ không được backfill.
24. Reset giữ app-wide `DataMaintenanceGate`, capture `DataResetContext.reminder_baseline_ms` một lần, pause Reminder/Notifications, rồi gọi reset-only Reminder trước Events parent và xóa reminder notification qua participant Notifications trong cùng transaction. Reminder prepare/apply trả typed `ReminderResetPlan`/`ReminderResetProjection`; participant xóa delivery và đặt checkpoint bằng baseline. Sau commit publish projection no-fail theo order BE-012, rồi mới resume live từ baseline; rollback drop projection và resume state cũ.
25. Không log event title, project/event/reminder/occurrence/delivery ID thô, timezone, notification body hoặc database/plugin raw error. Diagnostic chỉ có category, count, duration, hashed correlation ID và checkpoint range.
26. Mọi function, method, callback, helper và test mới có comment ngắn; checkpoint, dedupe, commit-before-side-effect, at-most-once OS và shutdown race có inline comment giải thích invariant.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
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
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Window khác `main` gọi command. | Không retry; sửa integration boundary. |
| `InvalidDeliveryId` | Sai prefix/length/UUID canonical. | Bỏ ID tự dựng và refresh. |
| `InvalidEventId`, `InvalidOccurrenceId` | Target không đúng canonical shape BE-018. | Đóng detail stale/refresh Calendar. |
| `InvalidViewToken` | Token không phải UUID v4 canonical. | Tạo token mới ở mount detail. |
| `InvalidVersion` | Version không phải decimal dương canonical. | Refresh item. |
| `InvalidCursor` | Cursor timestamp/ID sai hoặc overflow. | Bỏ cursor, tải page đầu. |
| `InvalidLimit` | Ngoài `1..=100`. | Dùng 30 hoặc clamp UI. |
| `InvalidSnoozeMinutes` | Không thuộc `5/10/30`. | Chỉ render ba lựa chọn contract. |
| `DeliveryNotFound` | Row bị reset/cleanup hoặc ID không tồn tại. | Bỏ item stale, refresh bell/Missed. |
| `DeliveryChanged` | Expected version không còn khớp. | Refetch và không lặp action cũ. |
| `ActionNotAllowed` | Snooze/Dismiss không hợp lệ với status hiện tại. | Disable action theo DTO mới nhất. |
| `TargetUnavailable` | Event/occurrence/reminder definition đã mất. | Không route; refresh, item sẽ được reconcile. |
| `ClockOutOfRange` | `now + snooze` hoặc boundary overflow. | Báo lỗi thời gian hệ thống, không mutate. |
| `SchedulerCatchingUp` | Startup catch-up chưa hoàn tất cho snapshot yêu cầu. | Hiển thị loading và retry sau `reminders://changed`. |
| `DependencyUnavailable` | Calendar/Settings/Notifications/lifecycle adapter không sẵn sàng. | Giữ UI hiện tại và cho retry; scheduler tự retry nền. |
| `CorruptStoredDelivery` | Row/tag/checkpoint vi phạm strict decoder. | Hiển thị app-level data error; không tự xóa. |
| `PersistenceFailed` | SQLite query/transaction/commit lỗi. | Không báo action thành công; cho retry. |
| `Unavailable` | Service chưa ready hoặc đang Quit/reset. | Không retry trong Quit; startup/reset thì chờ ready. |

Lỗi scheduler nền không chứa user data và không phát trực tiếp qua IPC. `occurrence_batch_saturated`, notification sync hoặc OS permission/platform/show được ghi category an toàn; worker giữ checkpoint/outbox để retry nơi contract cho phép.

## Luồng chính

### Startup, catch-up và live scheduling

1. BE-002 chạy migrations `0001..0010`; trong Phase 4, version 8 tạo Calendar, version 9 tạo delivery/notification target và version 10 thêm settings. Chỉ sau `0008 → 0009 → 0010` thành công app mới khởi tạo Calendar, Settings, Notifications rồi Reminder service và bật backup schema v3.
2. Service capture `startupBoundary = clock.now_ms()`. Nếu checkpoint NULL, transaction đặt bằng boundary và đánh dấu catch-up complete; nếu có, worker query `[checkpoint, boundary)` theo chunk, insert Missed idempotent và tăng checkpoint sau từng chunk hoàn tất.
3. Mỗi Missed row setting-on enqueue bell upsert; tất cả đều `os_state = none`. Notification sync có thể tiếp tục sau khi catch-up state đã durable.
4. Live worker scan từ boundary tới `now + 1`, đồng thời query delivery Snoozed/retry đã tới hạn. Nó query horizon tương lai để sleep tới due gần nhất, cap sleep 6 giờ và wake ngay bởi change/settings/shutdown.
5. Due candidate được insert idempotent, checkpoint advance, rồi worker upsert bell. Sau bell sync, active OS policy được persist trước khi adapter show.

### Snooze, Dismiss và Open

1. FE lấy delivery ID/version từ bell target hoặc Missed/detail DTO.
2. Open revalidate BE-018 context, trả event route và không đổi delivery. BE-011 open additionally mark bell read; FE thực hiện navigation.
3. Snooze transaction đổi active row sang snoozed, đặt next fire, version+1 và delete-pending bell. Worker wake; đến hạn nó revalidate context, generation/version+1 và phát lại.
4. Dismiss one/all commit terminal state trước, emit `reminders://changed`, rồi outbox xóa bell qua BE-011. Retry/delete duplicate là no-op.

### Calendar/settings/visibility thay đổi

1. BE-018 commit mutation rồi fan-out `CalendarChangedEventDto`. Scheduler wake; event ID cụ thể reconcile rows event đó, bulk import/reset reconcile theo batch. Đổi timezone all-day làm key chứa instant cũ stale; scheduler cancel key cũ trước khi xét key mới theo checkpoint.
2. Setting off chặn presentation mới nhưng không dừng scan/xóa Missed; setting on chỉ áp dụng due/generation tương lai.
3. FE-022 Show/Hide detail cập nhật token runtime; BE-001 show/hide main cập nhật visibility. Policy snapshot tại thời điểm OS decision là linearization point.

### Quit, crash, import và reset

1. True Quit đặt Reminder shutdown gate trước, wake/join worker và không dispatch side effect mới; checkpoint không được advance qua candidate chưa claim. BE-001 chỉ đóng Storage sau join thành công.
2. Crash có thể để notification outbox pending hoặc checkpoint cũ. Unique delivery/source key và retry khôi phục mà không duplicate bell; OS dùng at-most-once decision.
3. Import v3 không import delivery. Calendar bulk invalidation sau commit reconcile row cũ và chỉ schedule due tương lai theo live checkpoint.
4. Reset giữ maintenance gate, capture một `DataResetContext`, pause worker, prepare/apply typed Reminder plan/projection, xóa reminder state cùng reminder inbox và đặt checkpoint baseline trong transaction BE-012 trước Events. Commit xong mới publish projection no-fail theo order rồi resume; rollback drop projection và resume aborted mà không exit app.

## Ràng buộc kỹ thuật

- Blocking: Mọi rusqlite query/transaction, due expansion BE-018 và startup reconciliation chạy qua `tauri::async_runtime::spawn_blocking`/Storage. Không giữ `State`, transaction, maintenance/service lock qua `.await`; plugin show chạy sau DB commit và ngoài lock.
- Bảo mật: Chỉ `main` gọi command; SQL parameterized; frontend không cấp title/time/source key/checkpoint. Không filesystem/network; OS payload chỉ title/context đã chuẩn hóa; không log nội dung/ID/path/raw error.
- Hiệu năng: Cửa sổ BE-018 ≤31 ngày/5.000; split khi saturated; Missed page ≤100 keyset; scheduler không polling nhanh hơn 6 giờ khi rỗng và wake bằng signal; retry cap 5 phút; một delivery một row/bell item.
- Concurrency: Một Reminder mutation gate serialize checkpoint/state/version/sequence; app-wide maintenance gate đứng ngoài. Dependency await và OS call không nằm trong gate. Calendar invalidation, timer và action race hội tụ bằng unique key + expected version + current context.
- Desktop: Windows validation trong development; macOS defer release preparation. Notification action buttons trong OS toast không thuộc desktop contract của plugin 2.3.3; fake adapter kiểm title/body/eligibility mà không hiện toast thật trong CI.
- Failure policy: Calendar/terminal không lỗi theo scheduler. Persistence corruption/checkpoint saturation không được bỏ data; bell dependency retry bằng outbox; OS failure không retry và không đổi state in-app.

## Tiêu chí hoàn thành

- [ ] Registry Phase 4 chạy đúng `0008 → 0009 → 0010`; `0009` tạo exact tables/index/check và rebuild notification table không mất row Phase 1, `0010` thêm settings; rollback giữ schema/data cũ nếu bất kỳ bước lỗi.
- [ ] First-run baseline không tạo Missed lịch sử; restart catch-up phân loại đúng `[checkpoint, startupBoundary)` thành Missed, không OS, không duplicate qua crash/replay.
- [ ] Live due và Snooze fire dùng controlled clock, đúng occurrence/timezone/DST từ BE-018; all-day dùng first valid instant, ambiguous chọn sớm, skipped date không delivery và đổi timezone không tái dùng key; worker tiếp tục khi main hidden to tray và dừng trước Storage ở true Quit.
- [ ] Catch-up >31 ngày chia chunk; 5.000 saturation chia nhỏ; saturation 1 ms không advance checkpoint hoặc drop reminder.
- [ ] Setting on tạo bell ở mọi route và OS chỉ khi exact event detail không visible; setting off vẫn scan/Missed nhưng không bell/OS và bật lại không backfill.
- [ ] BE-011 upsert cố định source key giữ một reminder item, refresh unread/version sau Snooze và delete idempotent; terminal notifications/mutation/page hiện hữu không regression.
- [ ] Snooze chỉ active và đúng `5/10/30`, tính từ controlled now; Open không dismiss; Dismiss one/all cập nhật Missed count; stale expected version không mutate.
- [ ] Event update/delete/import invalidation refresh hoặc cancel active/missed/snoozed delivery bằng public context, không đọc Calendar repository; reminder semantic đổi có UUID remap và due quá khứ mới import không phát bất ngờ.
- [ ] OS attempt được persist trước plugin call, tối đa một request/generation; plugin error giữ bell và không retry/báo thành command failure.
- [ ] Backup v3 không có delivery/inbox; reset typed prepare/apply/publish xóa reminder + reminder notification trước Events trong một transaction, publish no-fail và đặt live baseline mới sau commit.
- [ ] Missed pagination/count/order ổn định, event detail trả materialized state, target validation chống route stale và visibility token chống unmount race.
- [ ] DTO/error/event bindings sinh đúng, command chỉ `main`, capability ACL không mở rộng và mọi log/error được redaction.
- [ ] Mọi function/method/callback/helper/test có comment; checkpoint/dedupe/OS/shutdown race có inline invariant comment.
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, Clippy `-D warnings`, Rust tests, frontend formatter/lint/typecheck/test liên quan và `pnpm tauri build` pass trên Windows.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/calendar/reminder_models.rs` (`#[cfg(test)]`) | Unit | ID/cursor/version/status serde, title normalize, state/check constraint và redaction. |
| `src-tauri/src/calendar/reminder_scheduler.rs` (`#[cfg(test)]`) | Unit | Controlled clock, half-open boundary, first baseline, restart catch-up, clock rollback/resume, chunk split/saturation, retry backoff và shutdown wake. |
| `src-tauri/src/calendar/reminder_repository.rs` (`#[cfg(test)]`) | Unit | Unique delivery, checkpoint atomicity, keyset/count, optimistic action, indexes/outbox và strict row decode. |
| `src-tauri/tests/reminder_scheduler.rs` | Integration | Public BE-018 ports với one-off/recurring/all-day first-valid/ambiguous/skipped date, timezone-key reconciliation, invalid candidate count, multiple offsets, hidden-to-tray, restart/crash và no bulk OS Missed. |
| `src-tauri/tests/reminder_actions.rs` | Integration | Bảy command, caller/input, Open/Snooze/Dismiss/all, stale race, event detail state và visibility token. |
| `src-tauri/tests/reminder_notifications.rs` | Integration Windows | BE-011 migration/upsert/delete; `NotificationDependencies::event_target` qua app adapter; stale/current project target/open, setting/visibility matrix, fixed source key, crash gaps và recording OS at-most-once. |
| `src-tauri/tests/data_management_contract.rs` | Integration | Golden backup v3 loại state; event reminder UUID remap reconcile; typed reset plan/projection, child-before-parent, rollback/baseline và no-fail publish. |
| `src-tauri/tests/app_builder.rs` | Smoke | Migration `0008→0009→0010`, dependency wiring, Calendar/lifecycle/settings sinks, seven commands và Quit join đăng ký một lần. |
| `src-tauri/tests/export_bindings.rs` | Contract | `reminders.ts`, binding Notifications và Settings khớp Rust, không export internal clock/checkpoint/source key. |
| `tests/e2e/calendar-reminders.e2e.ts` | Desktop E2E Windows | Reminder bell/Missed/detail, Open, Snooze 5/10/30, Dismiss, tray và fake OS policy. |
| `tests/e2e/settings-notifications.e2e.ts` | Desktop E2E Windows | Toggle event reminders, Missed always-on và không backfill khi bật lại. |

## Câu hỏi mở

- Không có.
