# BE-011 — Notifications

Tài liệu này đặc tả contract backend cho trung tâm thông báo Phase 1: ghi nhận hoạt động terminal/AI CLI xảy ra ngoài session đang hiển thị, lưu trạng thái đọc/xóa, điều hướng về đúng terminal và gửi thông báo hệ điều hành có chọn lọc.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-011` |
| Phase | `1`; `BE-019` mở rộng reminder ở Phase 4 |
| Capability | `src-tauri/src/notifications/` |
| Yêu cầu chức năng | §15, §17.5; liên quan §4.2, §5.3–5.4, §8.2, §13.3, §16 và §18 |
| Frontend liên quan | `FE-001`, `FE-010`; `FE-023` và phần reminder của `FE-010` ở Phase 4 |
| Phụ thuộc | Core Phase 1: `BE-002`, `BE-001`, `BE-005`, `BE-007`; maintenance/reset extension: `BE-012`; Phase 4: extension `BE-008`, public event query `BE-018` và reminder producer `BE-019` |

## Mục tiêu

Backend lưu notification terminal có target typed, trả danh sách/unread count cho bell panel, hỗ trợ mark read, clear và mở đúng project/session/tab/pane. Terminal cần input, kết thúc thành công hoặc lỗi chỉ tạo item khi session liên quan không đang được quan sát; thông báo OS còn phải qua policy trạng thái. Việc ghi item không được phụ thuộc vào Tauri event đến frontend và lỗi notification không được ảnh hưởng PTY/process.

### Quyết định và giả định đã chốt

- Phase 1 chỉ có ba loại terminal: cần input, process kết thúc thành công và process kết thúc lỗi. Reminder, Missed, event navigation, Snooze `5/10/30 phút`, Dismiss và action button của OS notification thuộc `BE-019`; BE-011 không scaffold command hoặc DTO giả cho chúng.
- `Terminal and AI CLI activity` mặc định bật. Trước extension BE-008 Phase 4, policy OS cố định đúng default đã chốt trong BE-008: gửi cho `Needs input` và `Process exited with an error`, không gửi cho `Process finished`. Phase 4 đọc cùng ba cờ qua `SettingsService::snapshot`/`subscribe`, không tạo setting trùng.
- “Nội dung liên quan không đang hiển thị” được chốt ở cấp session, đúng wording wireframe Settings. Session được xem là hiển thị khi `BE-005` có cùng `observed_session_id` và `main_window_visible = true`; tab/pane bị maximize hoặc nằm ngoài viewport không làm phát OS notification nếu session vẫn đang được quan sát.
- Cả bell item và OS notification chỉ được tạo cho activity xảy ra ngoài session đang hiển thị. Đây là default ít gây nhiễu, khớp dòng “Only unseen activity notifies” trong wireframe; điều hướng tới item cũ không xóa item mà đánh dấu đã đọc.
- Notification terminal giữ event-time title/session-name snapshot để danh sách không đổi nghĩa sau rename. Nội dung không chứa terminal output, command, argument, environment, secret, working directory hoặc path project.
- Các context minh họa như `2 files changed` hoặc tên command `pnpm test` trong wireframe không có trong event BE-007 và không phải contract Phase 1. BE-011 không parse output để suy ra chúng; `status_code` là process exit code duy nhất ngoài title/session snapshot.
- Notification terminal chỉ có target session runtime. Khi terminal/session bị đóng, item liên quan bị xóa để mọi item còn hiển thị luôn có khả năng điều hướng. Startup và Quit cũng xóa toàn bộ source terminal vì session không được khôi phục; notification reminder bền vững Phase 4 không đi theo cleanup này.
- Dùng keyset pagination, không đặt retention/cap tự động chưa có yêu cầu sản phẩm. Người dùng chỉ mất item qua cleanup target runtime, `delete_notification` hoặc `clear_read_notifications`.
- OS notification Phase 1 là informational title/body. Mở chính xác session thực hiện từ bell panel; action button/click routing native không được hứa vì API desktop Rust của plugin notification hiện dùng không cung cấp contract action thống nhất Windows/macOS. BE-019 phải chốt riêng native reminder actions.
- Khi BE-012 được ghép, mọi write Notifications thông thường lấy shared maintenance read permit; reset dùng transaction-scoped owner API và không tự lấy lại permit. Reset chỉ xóa notification rows, không đưa inbox/read state vào backup.
- Phase 4 kiểm tra target event qua consumer-owned `NotificationDependencies::event_target`; adapter ở `app` gọi public `CalendarService::get_notification_context` của BE-018. Notifications không import Calendar repository/service implementation và BE-018 không phụ thuộc ngược Notifications.

### Ngoài phạm vi

- Không phân tích terminal output hoặc tự đoán prompt; BE-007 là authority phát `needs_attention`, process state và exit code đã làm sạch.
- Không sở hữu trạng thái session, route hoặc visibility; BE-005 sở hữu, BE-001 cập nhật visibility và BE-011 chỉ hỏi qua public query hẹp.
- Không triển khai bell/panel/badge, relative time, focus hoặc React Router; FE-001/FE-010 dùng DTO và target trả về.
- Không CRUD notification settings trong Phase 1 và không đọc trực tiếp bảng `settings`; BE-008 sở hữu persistence/settings subscription ở Phase 4.
- Không gửi notification cho output thông thường, stream detach, process do XWork chủ động close hoặc terminal/session đã mất target.
- Không lưu notification OS vào lịch sử hệ điều hành, không đảm bảo người dùng nhìn thấy toast và không retry OS delivery sau lỗi để tránh gửi trùng.
- Không đưa notification vào backup; BE-012 chỉ được xóa inbox qua reset-only participant trong app reset, không serialize/restore notification row.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo Serde/ts-rs/UUID/Tokio cần dùng và `tauri-plugin-notification = "=2.3.3"` tương thích Tauri 2.11.5. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust do Cargo sinh; không sửa tay. |
| `src-tauri/src/lib.rs` | Công khai module `notifications` và giữ `app::configure` làm composition root. |
| `src-tauri/src/shared/mod.rs` | Re-export app-wide `DataMaintenanceGate` không phụ thuộc capability nghiệp vụ. |
| `src-tauri/src/shared/maintenance.rs` | Shared read/write permit và lock order theo BE-012. |
| `src-tauri/src/app/mod.rs` | Giữ single-instance plugin BE-001 ở vị trí đầu, inject maintenance gate/dependencies, khởi tạo notification plugin/service sau migration, đăng ký managed state/sáu command, fan-out transition và nối Quit/reset. |
| `src-tauri/src/app/notification_dependencies.rs` | Adapter consumer port BE-011 sang public BE-005/008 và, ở Phase 4, BE-018 event-target query. |
| `src-tauri/src/app/data_runtime.rs` | Gọi public pause/resume Notifications trong async reset lifecycle BE-012, không dùng true-Quit path. |
| `src-tauri/src/app/data_reset_participants.rs` | Adapter typed notification reset-only sang `DataResetOnlyParticipant` BE-012. |
| `src-tauri/src/notifications/` | Capability owner của persistence, ingestion, query/mutation và public contract notification. |
| `src-tauri/src/notifications/mod.rs` | Re-export DTO, error, service, command và consumer port công khai của capability. |
| `src-tauri/src/notifications/models.rs` | Model row, policy, source transition, DTO/event/error, ID/cursor validation và redaction. |
| `src-tauri/src/notifications/repository.rs` | Query keyset, count unread, insert idempotent, mark/delete/cleanup bằng SQL parameterized qua Storage. |
| `src-tauri/src/notifications/service.rs` | Orchestration context/settings, source dedupe, revision, lifecycle gate, event emission và OS delivery best-effort. |
| `src-tauri/src/notifications/commands.rs` | Sáu Tauri command mỏng cho list, read, delete, clear và open target. |
| `src-tauri/src/platform/mod.rs` | Export adapter OS notification dùng chung cho BE-011 và BE-019. |
| `src-tauri/src/platform/notification.rs` | Wrapper Rust hẹp quanh official Tauri notification plugin và fake adapter cho test. |
| `src-tauri/src/sessions/mod.rs` | Re-export `SessionNotificationContext` và public query hẹp cho consumer. |
| `src-tauri/src/sessions/models.rs` | Định nghĩa context project/session/visibility không serialize qua IPC. |
| `src-tauri/src/sessions/manager.rs` | Trả snapshot notification context từ authority observed-session/window-visible mà không lộ state map. |
| `src-tauri/src/calendar/mod.rs` | Re-export public `CalendarNotificationContext`/event lookup cho Phase 4 adapter. |
| `src-tauri/src/calendar/service.rs` | Sở hữu `get_notification_context`; Notifications không gọi repository Calendar. |
| `src-tauri/src/settings/data_participant.rs` | Tagged reset-only plan/projection consumer contract do BE-012 sở hữu. |
| `src-tauri/src/storage/migrations.rs` | Đăng ký migration version `5`, name `create_notifications`, bằng `include_str!` theo runner BE-002. |
| `src-tauri/migrations/0005_create_notifications.sql` | Tạo bảng notification cùng index source, unread và keyset order. |
| `src-tauri/capabilities/main.json` | Giữ nguyên; xác nhận không cấp command/plugin notification trực tiếp cho frontend. |
| `src-tauri/tests/app_builder.rs` | Smoke test plugin, service, source fan-out, managed state và command registration đúng một lần. |
| `src-tauri/tests/export_bindings.rs` | Sinh/kiểm tra binding DTO/event/error BE-011. |
| `src-tauri/tests/notifications_commands.rs` | Integration test migration, intake, query/mutation/navigation và event qua public backend boundary. |
| `src-tauri/tests/notifications_os_windows.rs` | Integration Windows với fake/recording OS adapter và eligibility matrix; không hiển thị toast thật trong CI. |
| `src-tauri/tests/calendar_consumers.rs` | Contract test Phase 4 adapter map public Calendar context sang event target Notifications. |
| `src-tauri/tests/data_management_contract.rs` | Reset transaction/pause/resume/projection/event của Notifications qua BE-012. |
| `src/bindings/notifications/` | TypeScript binding do ts-rs sinh; không sửa tay. |
| `tests/e2e/notifications.e2e.ts` | Desktop E2E Windows cho bell badge/panel, activity nền, read/delete/open và OS notification adapter test mode. |

Không sửa `src-tauri/capabilities/main.json`: frontend không gọi command của plugin notification. Plugin được khởi tạo và chỉ adapter Rust sử dụng, còn custom command BE-011 vẫn đi qua invoke handler hiện có của window `main`.

## Dữ liệu

### Bảng `notifications`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `TEXT` | `PRIMARY KEY`, `NOT NULL`, `CHECK(length(id) = 49)` | `notification-` + UUID v4 lowercase hyphenated do backend sinh. |
| `source_kind` | `TEXT` | `NOT NULL`, `CHECK(length(source_kind) BETWEEN 1 AND 40)` | Phase 1 luôn là `terminal_activity`; Rust từ chối tag không biết. |
| `source_id` | `TEXT` | `NOT NULL`, `CHECK(length(source_id) BETWEEN 1 AND 255)` | Terminal runtime ID nội bộ, dùng cleanup/dedupe; không trả frontend. |
| `source_key` | `TEXT` | `NOT NULL`, `UNIQUE`, `CHECK(length(source_key) BETWEEN 1 AND 320)` | Khóa occurrence idempotent do backend dựng, không chứa output/user text. |
| `kind` | `TEXT` | `NOT NULL`, `CHECK(length(kind) BETWEEN 1 AND 64)` | `terminal_needs_input`, `terminal_process_finished` hoặc `terminal_process_failed`; Rust strict-decode. |
| `title` | `TEXT` | `NOT NULL`, `CHECK(length(trim(title)) BETWEEN 1 AND 120)` | Tiêu đề event-time đã chuẩn hóa. |
| `context` | `TEXT` | `NOT NULL`, `CHECK(length(context) BETWEEN 1 AND 240)` | Tên session event-time đã chuẩn hóa; không có output/path. |
| `target_kind` | `TEXT` | `NOT NULL`, `CHECK(length(target_kind) BETWEEN 1 AND 32)` | Phase 1 luôn là `session`; Rust strict-decode. |
| `project_id` | `TEXT` | `NOT NULL`, `CHECK(length(project_id) = 36)` | Project UUID để frontend dựng route. Không dùng FK để cleanup project/session được điều phối rõ ràng. |
| `target_id` | `TEXT` | `NOT NULL`, `CHECK(length(target_id) BETWEEN 1 AND 255)` | Session runtime ID. |
| `tab_id` | `TEXT` | `NOT NULL`, `CHECK(length(tab_id) BETWEEN 1 AND 255)` | Tab runtime ID tại occurrence. |
| `pane_id` | `TEXT` | `NOT NULL`, `CHECK(length(pane_id) BETWEEN 1 AND 255)` | Pane runtime ID tại occurrence. |
| `status_code` | `TEXT` | Nullable, `CHECK(status_code IS NULL OR length(status_code) BETWEEN 1 AND 20)` | Exit code decimal an toàn cho process final; `NULL` với needs-input/I/O failure không có code. |
| `created_at_ms` | `INTEGER` | `NOT NULL`, `CHECK(created_at_ms >= 0)` | Unix epoch milliseconds UTC tại commit insert. |
| `read_at_ms` | `INTEGER` | Nullable, `CHECK(read_at_ms IS NULL OR read_at_ms >= created_at_ms)` | `NULL` là chưa đọc; timestamp monotonic-clamp khi đánh dấu đọc. |

- Index `idx_notifications_order` trên `(created_at_ms DESC, id DESC)` cho keyset page.
- Partial index `idx_notifications_unread` trên `(created_at_ms DESC, id DESC) WHERE read_at_ms IS NULL` cho badge/count.
- Index `idx_notifications_source` trên `(source_kind, source_id, kind)` cho attention clear và cleanup terminal.
- Index `idx_notifications_target` trên `(target_kind, target_id)` cho cleanup session.
- Migration: `src-tauri/migrations/0005_create_notifications.sql`.

Migration phải tương đương chính xác với:

```sql
CREATE TABLE notifications (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 49),
    source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 40),
    source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 255),
    source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 1 AND 320),
    kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    context TEXT NOT NULL CHECK (length(context) BETWEEN 1 AND 240),
    target_kind TEXT NOT NULL CHECK (length(target_kind) BETWEEN 1 AND 32),
    project_id TEXT NOT NULL CHECK (length(project_id) = 36),
    target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 255),
    tab_id TEXT NOT NULL CHECK (length(tab_id) BETWEEN 1 AND 255),
    pane_id TEXT NOT NULL CHECK (length(pane_id) BETWEEN 1 AND 255),
    status_code TEXT CHECK (status_code IS NULL OR length(status_code) BETWEEN 1 AND 20),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    read_at_ms INTEGER CHECK (read_at_ms IS NULL OR read_at_ms >= created_at_ms)
);

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

Registry BE-002 chạy version `5` sau `0004_create_keyboard_shortcuts.sql`; file SQL không tự `BEGIN`, `COMMIT` hoặc đặt `PRAGMA user_version`. `kind`, `source_kind` và `target_kind` cố ý có shape constraint thay vì enum CHECK đóng: BE-019 chỉ được thêm tag sau khi Rust DTO/decoder, migration bổ sung field target cần thiết và tests Phase 4 được triển khai đồng thời.

`NotificationService` còn giữ runtime-only `revision: u64`, shutdown gate, clock/ID source, policy hiện tại, source queue và event-dispatch queue tuần tự. Revision bắt đầu `0` mỗi process, tăng đúng một lần cho mỗi transaction làm thay đổi ít nhất một row và serialize thành decimal string; không persist vì frontend cũng khởi tạo lại sau restart.

## DTO public

Mọi DTO derive `Clone`, `Debug`, `Serialize`, `Deserialize` và `TS`; struct field dùng `camelCase`, enum đơn dùng `camelCase`, enum có data dùng discriminator `kind`. Timestamp/revision là decimal `u64` string.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum NotificationKindDto {
    TerminalNeedsInput,
    TerminalProcessFinished,
    TerminalProcessFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotificationTargetDto {
    Session {
        project_id: String,
        session_id: String,
        tab_id: String,
        pane_id: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
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

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NotificationCursorDto {
    pub created_at_ms: String,
    pub id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPageDto {
    pub revision: String,
    pub unread_count: u32,
    pub items: Vec<NotificationDto>,
    pub next_cursor: Option<NotificationCursorDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NotificationCenterStateDto {
    pub revision: String,
    pub unread_count: u32,
    pub affected_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OpenNotificationDto {
    pub target: NotificationTargetDto,
    pub state: NotificationCenterStateDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct NotificationCenterChangedDto {
    pub revision: String,
    pub unread_count: u32,
}
```

Quy ước DTO:

- `title` là `{profile title} needs input`, `{profile title} finished` hoặc `{profile title} exited with an error`; `context` là session name event-time. Chuỗi được collapse whitespace, bỏ control và cắt theo Unicode scalar, không cắt byte giữa UTF-8.
- `status_code = Some("0")` cho finished, decimal exit code cho process failure khi BE-007 có code, và `None` cho needs-input/I/O failure/signal không có code tin cậy.
- Cursor là key của item cuối page. Query tiếp theo lấy item có `(created_at_ms, id)` nhỏ hơn cursor theo sort DESC; frontend bỏ cursor khi nhận revision mới và muốn refresh từ đầu.
- `affected_count = 0` cho mutation idempotent/no-op; khi đó revision không tăng và không event. `unread_count` luôn là tổng toàn bảng, không chỉ page hiện tại.
- Binding sinh vào `src/bindings/notifications/`; không sửa tay và không export `source_id`/`source_key`.

## Contract Rust nội bộ và tích hợp capability

BE-005 bổ sung read-only query tối thiểu từ state mà nó đã sở hữu:

```rust
pub struct SessionNotificationContext {
    pub project_id: String,
    pub session_name: String,
    pub is_observed: bool,
}

impl SessionManager {
    /// Returns the current display and visibility context for notification policy.
    pub async fn notification_context(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionNotificationContext>, SessionsError>;
}
```

`is_observed = observed_session_id == Some(session_id) && main_window_visible`. Query clone dưới read lock rồi nhả ngay, không phát event, không tăng revision và trả `Ok(None)` nếu session đã biến mất. Đây không phải Tauri command; Notifications không đọc map/lock nội bộ của Sessions.

BE-011 sở hữu consumer port, app composition hiện thực bằng public BE-005/BE-008 contract:

```rust
pub struct TerminalNotificationPolicy {
    pub terminal_activity_enabled: bool,
    pub os_needs_input: bool,
    pub os_process_finished: bool,
    pub os_process_failed: bool,
}

pub struct NotificationEventTarget {
    pub event_id: String,
    pub occurrence_id: String,
    pub project_id: Option<String>,
}

pub type NotificationFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait NotificationDependencies: Send + Sync {
    /// Returns current session context at the notification decision point.
    fn session_context<'a>(
        &'a self,
        session_id: &'a str,
    ) -> NotificationFuture<'a, Result<Option<SessionNotificationContext>, NotificationError>>;

    /// Verifies the persisted session/tab/pane/terminal target before navigation.
    fn session_target_exists<'a>(
        &'a self,
        project_id: &'a str,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
        terminal_id: &'a str,
    ) -> NotificationFuture<'a, Result<bool, NotificationError>>;

    /// Resolves one current Calendar occurrence for an event notification target.
    fn event_target<'a>(
        &'a self,
        event_id: &'a str,
        occurrence_id: &'a str,
    ) -> NotificationFuture<'a, Result<Option<NotificationEventTarget>, NotificationError>>;

    /// Returns the effective terminal notification policy.
    fn terminal_policy(&self) -> Result<TerminalNotificationPolicy, NotificationError>;
}
```

- `session_context` map query BE-005 vừa định nghĩa. Nếu query chạy đồng thời với route/window change, snapshot query là linearization point: state BE-005 nào commit trước read lock quyết định `is_observed`.
- `session_target_exists` gọi public session detail query BE-005 và kiểm quan hệ project/session/tab/pane cùng `PaneContentDto::Terminal { terminal_id, .. }`; không dùng ID frontend làm filesystem/process input.
- `event_target` là consumer-owned port luôn có trong trait để giữ object shape ổn định: adapter Phase 1 trả `Ok(None)` vì chưa có event target; adapter Phase 4 gọi `CalendarService::get_notification_context(event_id, occurrence_id)` rồi map duy nhất `event_id`, `occurrence_id`, `project_id` sang `NotificationEventTarget`. `None` nghĩa là event/occurrence không còn hợp lệ; lỗi Calendar được làm sạch thành `DependencyUnavailable`. Không truyền `CalendarNotificationContext` xuyên Notifications và không import Calendar implementation.
- Phase 1 `terminal_policy` trả constant `true/true/false/true`. Ở Phase 4, adapter đọc `SettingsService::snapshot`; `terminal_activity_enabled` tắt cả item mới và OS, ba OS field map một-một từ `CliOsNotificationStatesDto`. Settings unavailable fail-closed cho intake mới và được retry ở transition sau; không tự bật default trái lựa chọn đã commit.
- Subscriber `SettingsService::subscribe` Phase 4 chỉ cập nhật cache policy mới nhất. Tắt setting không xóa item cũ, bật lại không backfill event đã bỏ và thay đổi policy không tự phát OS notification.

App composition cấu hình một observer nội bộ không phụ thuộc vòng:

```rust
impl NotificationService {
    /// Enqueues one committed terminal state transition for notification processing.
    pub fn observe_terminal_state(&self, event: TerminalStateChangedDto);

    /// Enqueues session deletion so stale runtime targets are removed.
    pub fn observe_session_runtime(&self, event: SessionRuntimeEventDto);

    /// Removes Phase 1 runtime-source rows and stops intake during Quit.
    pub async fn shutdown_runtime_sources(&self) -> Result<(), NotificationError>;

    /// Pauses dequeue and cancels pending maintenance-permit waits for app reset.
    pub fn pause_for_reset(
        &self,
    ) -> NotificationFuture<'_, Result<(), NotificationError>>;

    /// Reopens dequeue and wakes queued source reconciliation without failure.
    pub fn resume_after_reset(&self, committed: bool);
}
```

- Event sink do `app` cấp cho BE-007 fan-out cùng `TerminalStateChangedDto` đã commit vào queue BE-011 và Tauri event; BE-007 không import Notifications. Intake nội bộ không phụ thuộc frontend listener hoặc thành công của Tauri emit.
- Event sink Sessions fan-out `Deleted` vào cùng queue; các `Created/Updated/ActivityChanged` khác bị BE-011 bỏ. Queue nội bộ là unbounded MPSC chỉ chứa state transition tần suất thấp, tuyệt đối không chứa terminal output frame.
- Worker xử lý tuần tự, nhưng mỗi decision hỏi context hiện tại từ BE-005 rồi chạy SQLite qua `spawn_blocking`. Duplicate source event bị unique `source_key` loại bỏ.
- BE-001 cập nhật `main_window_visible` của BE-005 trên show/hide trước khi terminal activity tiếp theo được xét. `AppRuntime::shutdown_for_quit` đặt shutdown gate BE-011, dừng Sessions/Terminal, gọi `shutdown_runtime_sources`, rồi mới cho Storage đóng và app exit.

`pause_for_reset` khác true-Quit: nó đóng admission dequeue và public query/mutation (command nhận `Unavailable`), giữ source queue/dispatcher/service sống và await mọi work đã được admission trước đó. Worker chờ `DataReadPermit` trong nhánh `select!` cancellation-safe, nên pause signal hủy future đang chờ khi BE-012 đã giữ write permit; method không lấy maintenance gate, không query database và không emit. Nếu pause thất bại, adapter BE-012 resume các owner đã pause trước đó và không mở reset transaction. `resume_after_reset(true)` bỏ mọi queued mutation đến hết pause barrier vì Sessions/notification/reminder state đã reset, mở admission rồi wake BE-019 reconcile current state; `false` giữ và xử lý queue để dữ liệu cũ hội tụ sau rollback. Resume chỉ signal handle đã chuẩn bị, không thể fail, không block và không lấy gate.

### Maintenance và reset-only contract

```rust
pub struct NotificationResetPlan {
    pub removed_count: u32,
    pub next_revision: Option<u64>,
}

pub struct NotificationResetProjection {
    pub removed_count: u32,
    pub revision: Option<u64>,
}

impl NotificationService {
    /// Prepares counts and the next revision inside the shared reset transaction.
    pub fn prepare_notification_reset_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<NotificationResetPlan, NotificationError>;

    /// Deletes all notification rows using the coordinator-owned transaction.
    pub fn reset_notifications_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &NotificationResetPlan,
    ) -> Result<NotificationResetProjection, NotificationError>;

    /// Publishes the prepared zero-unread projection after commit without failure.
    pub fn publish_notification_reset(
        &self,
        projection: NotificationResetProjection,
    );
}
```

Ba type trên public trong Rust crate, không derive `Serialize`, `Deserialize` hoặc `TS`. Prepare chạy `COUNT(*)`, load runtime revision và preflight checked `revision + 1` chỉ khi count khác `0`; plan là owned, `Send + 'static`, không giữ transaction/lock/content. Apply chạy đúng một `DELETE FROM notifications`, yêu cầu affected count khớp plan và trả projection; mismatch là `PersistenceFailed` để rollback. Publish không query, không lấy gate/service mutex, consume projection, đặt unread cache `0` và nếu revision có giá trị thì enqueue đúng một `notifications://changed { unread_count: 0 }`; emit sau đó vẫn best-effort.

Các method `_in` chỉ được adapter `app/data_reset_participants.rs` gọi khi BE-012 đang giữ `DataWritePermit`, Notifications đã pause và transaction xuyên domain đang mở. Chúng không gọi `Storage::with_connection`/`with_transaction`, không lấy `DataReadPermit`, không đổi cache/revision/event trước commit. Public query bị admission pause chặn đến sau publish, nên không quan sát row đã reset với revision cũ. Rollback drop plan/projection, không publish; Notifications không có backup participant và inbox/read state không vào backup.

## Tauri command

Tất cả command chỉ chấp nhận invoking window label `main`, clone service rồi nhả `tauri::State` trước `.await`.

### `get_notifications`

Trả một page mới nhất cùng unread count hiện hành.

```rust
/// Lists one keyset page of notifications and the current unread count.
#[tauri::command]
pub async fn get_notifications(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NotificationService>,
    cursor: Option<NotificationCursorDto>,
    limit: Option<u16>,
) -> Result<NotificationPageDto, NotificationError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; `limit` mặc định `30`, hợp lệ `1..=100`; cursor timestamp decimal canonical và ID đúng prefix/UUID v4. |
| Side effect | Không có; query `limit + 1` row để dựng `next_cursor`, sort `created_at_ms DESC, id DESC`. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidCursor`, `InvalidLimit`, `CorruptStoredNotification`, `PersistenceFailed`, `Unavailable`. |

### `mark_notification_read`

Đánh dấu một item đã đọc.

```rust
/// Marks one notification as read without deleting it.
#[tauri::command]
pub async fn mark_notification_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NotificationService>,
    notification_id: String,
) -> Result<NotificationCenterStateDto, NotificationError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; notification ID đúng format và tồn tại. |
| Side effect | Nếu unread, transaction đặt `read_at_ms = max(now, created_at_ms)`, tăng runtime revision, count unread rồi phát event sau commit; item đã đọc là no-op. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNotificationId`, `NotificationNotFound`, `PersistenceFailed`, `Unavailable`. |

### `mark_all_notifications_read`

Đánh dấu toàn bộ item hiện tại đã đọc.

```rust
/// Marks every unread notification as read in one transaction.
#[tauri::command]
pub async fn mark_all_notifications_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NotificationService>,
) -> Result<NotificationCenterStateDto, NotificationError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`. |
| Side effect | Một transaction cập nhật mọi row `read_at_ms IS NULL` bằng timestamp đã clamp theo từng row; revision/event tăng một lần nếu có row đổi. |
| Lỗi trả về | `UnauthorizedWindow`, `PersistenceFailed`, `Unavailable`. |

### `delete_notification`

Xóa một item khỏi center.

```rust
/// Deletes one notification from the in-app center.
#[tauri::command]
pub async fn delete_notification(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NotificationService>,
    notification_id: String,
) -> Result<NotificationCenterStateDto, NotificationError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID đúng format và row tồn tại. |
| Side effect | Delete một row, tăng revision, count unread rồi phát event sau commit. Không tác động process/session. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNotificationId`, `NotificationNotFound`, `PersistenceFailed`, `Unavailable`. |

### `clear_read_notifications`

Xóa toàn bộ item đã đọc, đúng action `Clear read` của wireframe.

```rust
/// Deletes every read notification while preserving unread items.
#[tauri::command]
pub async fn clear_read_notifications(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NotificationService>,
) -> Result<NotificationCenterStateDto, NotificationError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`. |
| Side effect | Một transaction delete mọi row `read_at_ms IS NOT NULL`; revision/event tăng một lần nếu có row bị xóa. |
| Lỗi trả về | `UnauthorizedWindow`, `PersistenceFailed`, `Unavailable`. |

### `open_notification`

Validate target, đánh dấu item đọc và trả route typed cho FE-001/FE-010.

```rust
/// Marks a notification read and returns its currently valid navigation target.
#[tauri::command]
pub async fn open_notification(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NotificationService>,
    notification_id: String,
) -> Result<OpenNotificationDto, NotificationError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/row hợp lệ; target Session được BE-005 xác nhận exact project/session/tab/pane/terminal; target EventReminder Phase 4 được consumer port xác nhận exact event/occurrence hiện hành qua BE-018. |
| Side effect | Chỉ sau target validation mới lấy maintenance read permit và mark read bằng cùng rule/revision/event; trả target, không tự thay memory router, active tab/pane hoặc gọi Snooze/Dismiss. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNotificationId`, `NotificationNotFound`, `TargetUnavailable`, `DependencyUnavailable`, `CorruptStoredNotification`, `PersistenceFailed`, `Unavailable`. |

FE nhận target thì điều hướng project/session, gọi command BE-005 để active tab/pane nếu cần, focus terminal sau render và acknowledge attention qua BE-007. Nếu target biến mất sau command nhưng trước navigation, frontend refresh center; cleanup source sẽ xóa row stale.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `notifications://changed` | `NotificationCenterChangedDto` | Sau transaction insert/read/delete/cleanup/reset làm thay đổi ít nhất một row. | Sau commit, mutation enqueue payload vào một dispatcher tuần tự trước khi nhả service gate/maintenance read permit; reset publish enqueue dưới maintenance write permit. Dispatcher chỉ emit đến `main` theo revision tăng nghiêm ngặt. Một transaction một event, không gộp. Payload nhỏ chỉ đủ cập nhật badge; panel mở refetch page đầu. |

Không có Channel. Terminal output vẫn chỉ đi qua Channel BE-007. Event emit lỗi không rollback database hoặc làm command/source ingestion thất bại; frontend re-query `get_notifications` khi shell mount, window focus, panel mở hoặc revision bị nhảy.

OS notification không phải Tauri event. Adapter gọi plugin Rust đúng một lần sau khi row mới commit và chỉ cho source key vừa insert; duplicate source, read/delete hoặc page query không gửi toast.

## Business rule và invariant

1. Phase 1 chỉ accept `source_kind = terminal_activity`, `target_kind = session` và ba `NotificationKindDto`; tag lạ trong database là `CorruptStoredNotification`, không âm thầm bỏ qua.
2. Notification ID cho insert do backend sinh `notification-` + UUID v4 lowercase. Frontend chỉ gửi lại notification ID/cursor đã nhận cho query hoặc mutation; không cấp timestamp, source key, title, context, target hoặc status của item mới.
3. Source key needs-input là `terminal:{terminal_id}:attention:{latest_output_sequence}`; process final là `terminal:{terminal_id}:process_final`. Chuỗi chỉ dùng ID/decimal sequence backend đã validate, không dùng user text.
4. `AttentionChanged` chỉ insert khi `needs_attention` chuyển `false → true`. Transition về `false` mark read mọi unread needs-input item của terminal trong một transaction; duplicate cùng state không tạo revision.
5. `ProcessChanged` natural `Exited` với `was_terminated = false` tạo `TerminalProcessFinished`; `Failed` với `was_terminated = false` tạo `TerminalProcessFailed`. `Running`, `Closing`, XWork-terminated hoặc `StreamDetached` không tạo item.
6. Trước final insert, unread needs-input item cùng terminal được mark read trong cùng transaction vì prompt không còn chờ. Duplicate final event bị unique source key loại bỏ và không gửi OS lần hai.
7. `Closing`, `Disposed` hoặc `was_terminated = true` xóa mọi row của terminal vì target sắp không còn điều hướng được. Session `Deleted` xóa mọi row target session. Cleanup no-op không tăng revision.
8. Mỗi candidate insert phải lấy `SessionNotificationContext` hiện tại. `None`, dependency error hoặc `is_observed = true` không insert và không gửi OS; dependency error được log/retry ở transition sau, không làm terminal lỗi.
9. New item luôn unread. In-app eligibility chỉ cần terminal activity enabled và unobserved; OS eligibility cần thêm kind được policy cho phép. `Process finished` vẫn vào bell dù default OS false.
10. Tắt terminal activity ở Phase 4 chỉ chặn item mới/OS mới. Item đã lưu, read state và badge không bị xóa; bật lại không backfill transition trong lúc tắt.
11. OS adapter chỉ nhận title/context đã chuẩn hóa: tối đa 120/240 Unicode scalar, không newline/tab/control. Không nhận project name/path, terminal output, command, argument, env, secret, PID hoặc raw error.
12. OS delivery chạy sau database commit. Lỗi đồng bộ trước khi plugin chấp nhận dispatch giữ item in-app, không tăng revision lần hai, không retry tự động và không propagate về BE-007; việc OS thực sự hiển thị toast sau khi plugin nhận request không quan sát được và không được báo là bảo đảm.
13. Mutation database thông thường lấy shared `DataReadPermit`, rồi service gate, rồi Storage. Revision cấp sau affected-row check và chỉ công bố sau commit; payload event được enqueue theo revision trước khi service gate/read permit nhả. Query page/count/revision lấy service gate và đọc DB trước khi lấy revision; reset pause query admission đến sau synchronous publish nên không thấy revision của transaction rollback hoặc rows mới với revision cũ.
14. Mark single/open/delete tới ID đã bị cleanup cạnh tranh trả `NotificationNotFound` hoặc `TargetUnavailable`; không recreate row và không điều hướng target stale.
15. `read_at_ms` không nhỏ hơn `created_at_ms`, kể cả system clock lùi. Page order không đổi khi mark read; keyset dùng created time + ID để ổn định khi timestamp trùng.
16. Startup sau migrations xóa mọi `source_kind = terminal_activity` trước khi service phục vụ query vì BE-005 luôn rỗng sau process restart. Cleanup là một startup transaction nhưng revision vẫn bắt đầu `0` vì chưa có frontend observer.
17. Quit đặt intake shutdown gate trước khi BE-005/BE-007 cleanup. Sau runtime cleanup, BE-011 xóa toàn bộ terminal rows, dừng source worker và không gửi event/OS toast trong shutdown; reminder rows Phase 4 không thuộc filter này.
18. Source worker không giữ notification gate/storage lock qua dependency await hoặc OS call. Sau dependency await, write path await `DataReadPermit`, giữ permit khi await bounded blocking SQL rồi enqueue post-commit payload; không giữ transaction/connection qua await. Event emit và OS delivery chạy sau khi lock/permit đã nhả.
19. Notification title/context là event-time snapshot. Rename session/profile không rewrite history; routing luôn dùng opaque ID, không suy ID từ label.
20. Phase 4 `open_notification` với `EventReminder` gọi consumer port `event_target` trước mark-read. Resolver chỉ dùng public BE-018 context; target mất trả `TargetUnavailable`, dependency lỗi trả `DependencyUnavailable`, không mark read hoặc tự gọi BE-019 action.
21. `pause_for_reset`/`resume_after_reset` không dùng true-Quit gate, không lấy maintenance permit/DB và không đóng channel. Reset `_in` methods chạy dưới write permit/transaction của BE-012; rollback không đổi runtime projection, commit publish zero-unread projection trước resume.
22. Notifications không backup. Reset xóa toàn bộ terminal/reminder rows nhưng không xóa schema/migration; reminder delivery state do BE-019 reset child-first trước Notifications.
23. Mọi function, method, callback, helper và test mới có comment ngắn. Source dedupe, visibility decision, commit-before-delivery, maintenance lock order và Quit/reset cleanup có inline comment giải thích invariant/race.

## Lỗi

Error public dùng tagged object có `code` snake_case; payload không chứa title/context/source key/OS raw error hoặc database detail.

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
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
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Window khác `main` gọi command BE-011. | Không retry; báo lỗi integration boundary. |
| `InvalidNotificationId` | ID sai prefix, length, UUID v4 hoặc canonical lowercase. | Refresh center, không dùng ID tự dựng. |
| `InvalidCursor` | Timestamp/ID cursor sai format hoặc timestamp overflow. | Bỏ cursor và tải page đầu. |
| `InvalidLimit` | Limit ngoài `1..=100`. | Dùng default `30` hoặc clamp UI. |
| `NotificationNotFound` | Item bị xóa/cleanup trước mutation. | Bỏ item stale và refresh badge/page. |
| `TargetUnavailable` | Session/tab/pane/terminal target không còn đúng lúc Open. | Không điều hướng; refresh center và giải thích session đã đóng. |
| `DependencyUnavailable` | BE-005/BE-008 hoặc Phase 4 BE-018 query cần cho Open/policy không sẵn sàng. | Giữ panel và cho retry; source intake fail-closed. |
| `CorruptStoredNotification` | Row có tag/timestamp/ID/target/status không decode theo invariant. | Hiển thị lỗi dữ liệu cấp app; không tự xóa/reset row. |
| `PersistenceFailed` | SQLite/query/transaction lỗi. | Giữ UI snapshot cũ và cho retry. |
| `Unavailable` | Service chưa ready hoặc đang shutdown. | Không retry trong Quit; startup lỗi thì hiển thị app-level error. |

Lỗi OS delivery chỉ là internal diagnostic category `permission`, `platform` hoặc `show`; không có public error vì item đã commit và terminal không phải caller của OS side effect.

## Luồng chính

### Startup và query center

1. BE-002 chạy migrations tuần tự qua version 5. App giữ single-instance plugin BE-001 là plugin đăng ký đầu tiên, sau đó đăng ký notification plugin Rust và khởi tạo Settings/Sessions/Terminal rồi Notification repository/service.
2. Trước khi manage state/command, service lấy maintenance read permit, xóa terminal-source rows cũ, validate strict toàn row còn lại và đặt runtime revision `0`; lỗi corruption/persistence làm startup dừng thay vì mất item âm thầm.
3. FE-001 gọi `get_notifications(None, None)` khi shell mount để lấy badge và page đầu; mở panel gọi lại page đầu nếu dirty, rồi page tiếp bằng cursor.
4. Frontend nghe `notifications://changed`, cập nhật unread badge từ payload và đánh dấu page cache dirty; nếu panel đang mở thì refetch có debounce phía frontend.

### Terminal activity thành notification

1. BE-007 commit terminal state, app-owned sink enqueue cùng DTO vào BE-011 rồi best-effort emit event frontend độc lập.
2. Source worker phân loại transition/dedupe, hỏi BE-005 context. Target mất hoặc session đang observed thì dừng không ghi.
3. Worker lấy policy effective, normalize title/context, await maintenance read permit rồi chạy một transaction insert `ON CONFLICT(source_key) DO NOTHING`, kèm mark-read prompt cũ khi final.
4. Nếu transaction thực sự đổi row, service tăng revision, query unread count và emit `notifications://changed` sau commit.
5. Nếu kind được OS policy cho phép, adapter gửi toast sau commit. Lỗi chỉ log category/notification ID hash; item bell vẫn tồn tại.

### Read, delete và navigation

1. Mark/delete/clear command validate caller và input, await maintenance read permit rồi serialize transaction dưới service mutation gate.
2. Mutation có affected row tăng revision một lần, count unread trong transaction/snapshot nhất quán, commit rồi emit. No-op trả current state không emit.
3. `open_notification` đọc row; target Session gọi BE-005, target EventReminder Phase 4 gọi `NotificationDependencies::event_target` để app adapter hỏi BE-018. Chỉ sau exact live target validation, command lấy read permit, mark read và trả target typed.
4. FE điều hướng/active/focus bằng contract FE-001/BE-005/BE-007. Việc focus/nhập liệu clear terminal attention; observer mark needs-input notification read idempotently nếu Open chưa làm.

### Close, delete session và Quit

1. Terminal Closing/Disposed hoặc Sessions Deleted được enqueue vào cùng source worker; worker xóa row source/target trong một transaction và emit một center change nếu có affected row.
2. Nếu cleanup race với final transition, final intake hỏi `notification_context`; session đã mất trả `None`, còn session đang close dẫn tới terminal cleanup theo queue. Unique/source cleanup giữ kết quả không stale.
3. Khi Quit bắt đầu, BE-001 adapter đặt BE-011 shutdown gate trước; notification intake sau đó không tạo item do process bị XWork dừng.
4. Sau BE-005/BE-007 cleanup, `shutdown_runtime_sources` lấy maintenance read permit, xóa mọi terminal row, drain/stop worker rồi trả. Storage chỉ đóng và app chỉ exit sau khi bước này thành công; failure làm Quit fail-closed theo BE-001.

### Reset ứng dụng

1. BE-012 giữ maintenance write permit rồi app adapter await `pause_for_reset`; dequeue dừng nhưng callback vẫn enqueue, pending read-permit future bị cancel và không deadlock.
2. Sau Sessions cleanup, adapter reset-only gọi prepare/apply Notifications trong cùng transaction sau Reminders và trước Recent Files; không xóa channel/runtime handle.
3. Rollback drop projection rồi `resume_after_reset(false)` để drain queue. Commit gọi `publish_notification_reset` đồng bộ, sau toàn bộ owner publish mới `resume_after_reset(true)` và bỏ transition terminal qua pause barrier.
4. `data://changed` do BE-012 phát sau resume. Notifications chỉ phát `notifications://changed` nếu reset thực sự xóa ít nhất một row; không gửi OS toast trong reset.

## Ràng buộc kỹ thuật

- Blocking: Mọi rusqlite query/transaction, row decode và startup cleanup chạy qua `tauri::async_runtime::spawn_blocking`/Storage BE-002. Async service await maintenance permit, không `block_on`; permit có thể sống khi await bounded blocking job nhưng transaction/connection chỉ sống trong closure. Plugin `show` được gọi ngoài manager/storage lock. Tauri/source callback chỉ enqueue DTO nhỏ rồi trả, không chờ database.
- Bảo mật: SQL cố định và parameterized; frontend không cấp source/target/content. Không log title, context, session/profile/project ID thô, terminal data, path hoặc OS/SQLite raw error; diagnostic dùng error code và hash ID khi cần correlation.
- Hiệu năng: Page mặc định 30, tối đa 100; keyset/index không dùng OFFSET. Một terminal transition không query terminal output và tạo tối đa một insert. Bell event payload nhỏ; bốn terminal burst state phải không làm chậm Channel/output.
- Concurrency: Lock order write thường là `DataMaintenanceGate` read permit → Notifications service gate → Storage; `_in` reset không re-enter ba lớp này. Source transitions tuần tự trong một worker và read-permit wait cancellation-safe với pause. Sau commit, payload vào dispatcher FIFO trước khi service gate/permit nhả; Tauri emit không chạy dưới lock nhưng vẫn giữ revision order. Không giữ service/storage lock qua BE-005/008/018 await hoặc OS delivery. Duplicate event và cleanup race hội tụ bằng source unique key + current context.
- Desktop: Dùng `tauri-plugin-notification 2.3.3` từ Rust, không cấp plugin permission frontend. Windows phải smoke test trên installed identifier `com.xwork.app`; macOS notification validation hoãn tới release preparation.
- Failure policy: Notification persistence/OS/event lỗi không dừng terminal hay đổi Sessions state. Riêng cleanup terminal rows trong explicit Quit là bắt buộc để không để target runtime stale; lỗi bước này làm Quit giữ ứng dụng mở và cho retry.

## Tiêu chí hoàn thành

- [ ] Registry BE-002 chạy `0005_create_notifications.sql` đúng sau version 4, tạo đúng table/index và rollback toàn migration nếu lỗi.
- [ ] Startup strict-decode và xóa terminal rows cũ trước query; fresh process không hiển thị target session của lần chạy trước.
- [ ] Needs-input, natural finish và natural failure ngoài observed session tạo đúng một unread item với target/project/session/tab/pane và event-time labels; output thường/stream detach/XWork close không tạo item.
- [ ] Activity trong session đang observed + main visible không tạo bell/OS; cùng activity khi route khác hoặc main hidden tạo bell theo policy.
- [ ] OS default Phase 1 gửi needs-input/error nhưng không finished; Phase 4 mapping BE-008 tắt cả intake hoặc lọc từng OS state, không xóa/backfill item cũ.
- [ ] Duplicate source event không insert/emit/toast lần hai; attention clear/final mark prompt cũ read; closing/disposed/session delete xóa target stale.
- [ ] List keyset order/cursor/limit/unread count đúng khi timestamp trùng và có insert/delete giữa page; không OFFSET hoặc full-table load.
- [ ] Mark one/all, delete one, clear read idempotent theo affected row; revision/event chỉ tăng sau transaction có thay đổi và event emit failure không rollback.
- [ ] Open chỉ trả exact live terminal target, mark read và không tự route; target race/missing trả typed error, không mở session sai.
- [ ] Phase 4 Open event target chỉ qua `NotificationDependencies::event_target` → public BE-018 `get_notification_context`, map current project/event/occurrence, không tạo vòng dependency hoặc mark read khi target mất.
- [ ] Title/context/OS payload không chứa output, command, argument, environment, secret, path, PID hoặc raw lỗi; log redaction test pass.
- [ ] Quit chặn intake, dọn Sessions/Terminal rồi xóa terminal notification rows trước Storage close; cleanup lỗi không cho app exit.
- [ ] Mọi DB write thông thường giữ maintenance read permit qua commit/enqueue; reset pause cancellation-safe, apply typed plan/projection trong shared transaction, rollback không publish và commit publish zero-unread trước no-fail resume.
- [ ] Reminder/event DTO, Snooze/Dismiss, Missed và OS action buttons không xuất hiện trong Phase 1 implementation/binding; BE-019 là owner extension.
- [ ] Generated binding `src/bindings/notifications/` khớp Rust và không sửa tay; `src-tauri/capabilities/main.json` không cấp notification API cho frontend; single-instance plugin BE-001 vẫn đăng ký đầu tiên.
- [ ] Mọi function/method/callback/helper/test mới có comment; visibility/dedupe/commit-before-delivery/Quit race có inline invariant comment.
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` và `cargo test --manifest-path src-tauri/Cargo.toml` pass trên Windows.
- [ ] Frontend formatter/lint/typecheck/unit test và `tests/e2e/notifications.e2e.ts` pass; `pnpm tauri build` Windows pass vì thêm migration, plugin, command, event và generated binding.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/notifications/models.rs` (`#[cfg(test)]`) | Unit | ID/cursor/timestamp/tag decode, DTO/error casing, title/context normalize, source key và redaction. |
| `src-tauri/src/notifications/repository.rs` (`#[cfg(test)]`) | Unit | SQL row mapping, keyset tie, unread count, unique dedupe, mark/delete/cleanup/reset affected count và rollback. |
| `src-tauri/src/notifications/service.rs` (`#[cfg(test)]`) | Unit | Eligibility, transition, settings, event-target map, read-permit order, reset plan/projection, pause cancellation/no-fail resume, revision/event và OS failure với fakes. |
| `src-tauri/src/platform/notification.rs` (`#[cfg(test)]`) | Unit | Title/body mapping, không truyền field nhạy cảm và mapping plugin error thành diagnostic category. |
| `src-tauri/src/sessions/manager.rs` (`#[cfg(test)]`) | Unit | `notification_context` trả project/name/observed đúng qua route + window visible, `None` sau delete và không mutate revision. |
| `src-tauri/tests/notifications_commands.rs` | Integration | Migration/version, sáu command, window authorization, pagination/mutation, Session/Event Open, source fan-out, event revision, restart purge và SQLite failure. |
| `src-tauri/tests/notifications_os_windows.rs` | Integration Windows | Recording adapter xác nhận hidden/route/state/settings matrix, once-per-source và OS failure vẫn giữ bell item. |
| `src-tauri/tests/calendar_consumers.rs` | Contract | Phase 4 event-target adapter chỉ gọi public Calendar context, map `None`/error/current project đúng và không truy cập repository. |
| `src-tauri/tests/data_management_contract.rs` | Integration | Notifications pause/reset/resume dưới write permit, rollback/commit projection, child order với Reminders và không backup inbox. |
| `src-tauri/tests/app_builder.rs` | Smoke | Plugin trước use, gate/dependency/reset adapters, service/sink/state/sáu command đăng ký một lần, startup/Quit/reset order và mock builder không gửi toast. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export DTO/event/error vào `src/bindings/notifications/`, fail khi drift và không có source key/internal policy/reminder type Phase 4. |
| `tests/e2e/notifications.e2e.ts` | Desktop E2E Windows | Bell unread, panel order, mark/read/clear/delete, background needs-input/finish/error, open exact pane, hide-to-tray và OS adapter test mode. |

Test dùng temporary database, deterministic clock/UUID, fake BE-005/BE-008 context và recording OS adapter; không chạy CLI thật hoặc hiển thị toast hệ điều hành trong CI. Smoke thủ công trên Windows dùng installed build để xác nhận toast thật cho needs-input/error và không lộ terminal output/path. macOS hoãn tới release preparation.

## Câu hỏi mở

- Không có.
