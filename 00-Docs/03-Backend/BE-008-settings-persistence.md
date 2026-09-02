# BE-008 — Settings persistence

Tài liệu này đặc tả contract đọc settings General và lưu settings Appearance/sidebar của XWork. Đến Phase 4, cùng lát cắt reminder, contract được mở rộng bằng notification settings.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-008` |
| Phase | `1`; mở rộng notification settings ở Phase 4 |
| Capability | `src-tauri/src/settings/` |
| Yêu cầu chức năng | §4.1, §5.2–5.4, §17.1–17.2, §17.5, §18 |
| Frontend liên quan | `FE-001`, `FE-011`, `FE-012`, `FE-023` |
| Phụ thuộc | `BE-002` phải hoàn thành trước; migration version 1 của `BE-003` phải có trong registry trước version 2 của BE-008; hành vi General cố định phải khớp `BE-001`; phần mở rộng Phase 4 được đồng triển khai trong lát cắt `BE-019` và được `BE-011`, `BE-019` tiêu thụ |

## Mục tiêu

Backend cung cấp một snapshot settings typed: General là các invariant chỉ đọc, còn Appearance, trạng thái sidebar và chính sách thông báo Phase 4 được lưu bền vững trong SQLite và cập nhật nguyên tử qua Tauri command.

### Ngoài phạm vi

- Không lưu keyboard shortcut, shell hoặc CLI profile; chúng thuộc `BE-009` và `BE-006`.
- Không triển khai tray, close/quit, autostart hoặc notification delivery. Lifecycle thuộc `BE-001`; `BE-011` và `BE-019` chỉ tiêu thụ phần notification settings khi Phase 4 hoàn thành.
- Không lưu lựa chọn trang Settings đang mở, trạng thái preview chưa commit hoặc system light/dark hiện tại.
- Không thêm ngôn ngữ ngoài English trong bản đầu tiên.
- Không điều phối backup/reset; `BE-012` dùng typed owner API `_in` của capability này trong shared transaction.

### Quyết định và giả định đã chốt

- Theo roadmap, BE-008 triển khai contract General chỉ đọc cùng Appearance/sidebar ở Phase 1; notification settings là phần mở rộng đồng triển khai trong cùng lát cắt BE-019 ở Phase 4, không được scaffold sớm. Vì vậy DTO và binding notification chỉ xuất hiện đồng thời với migration version 10, sau `0009_create_reminder_deliveries.sql` nhưng trước khi `ReminderService` được khởi tạo.
- `BE-003` chỉ là prerequisite về thứ tự migration: registry của BE-002 phải có version 1 trước `0002_create_settings.sql`. BE-008 không gọi hoặc phụ thuộc vào public interface nghiệp vụ Projects.
- Persistence dùng một hàng singleton với cột typed, không dùng key/value. Cách này ưu tiên schema, migration và backup có contract kiểm tra được; mảng 16 màu ANSI là ngoại lệ JSON duy nhất vì mọi phần tử có cùng semantics.
- §5 và contract BE-001 có thẩm quyền hơn affordance trong wireframe: close-to-tray, tray icon, ask-before-quitting khi có session và open-at-Home luôn bật, được trả như General read-only và không có cột/patch. FE-011 phải hiển thị chúng ở trạng thái locked nếu còn giữ các row này.
- `Start XWork when I sign in` chỉ có trong wireframe, không có trong §17.1, overview BE-008 hoặc contract BE-001. Autostart bị loại khỏi v1 thay vì thêm persistence không có consumer; thiết kế FE-011 phải bỏ/ẩn row đó cho đến khi yêu cầu sản phẩm và backend lifecycle được mở rộng rõ ràng.
- `Missed reminders on launch` là invariant sản phẩm, không phải setting có thể ghi, vì wireframe đánh dấu luôn bật và §13.3 không cho phép tắt việc ghi nhận Missed.
- Live preview màu/cỡ chữ là state tạm của frontend. Backend chỉ lưu snapshot đã commit; không thêm draft table hoặc public event cho một consumer main-window duy nhất.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo Serde/ts-rs cho public DTO và, ở Phase 4, feature Tokio `sync` nếu dependency hiện có chưa bật |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi manifest thay đổi |
| `src-tauri/src/lib.rs` | Công khai module `settings` cho composition root và integration test |
| `src-tauri/src/settings/mod.rs` | Chứa model typed, preset mặc định, validation, repository/service, lỗi và Tauri command; thêm snapshot subscription khi mở rộng Phase 4 |
| `src-tauri/src/app/mod.rs` | Khởi tạo `SettingsService`, manage state, đăng ký ba command và, ở Phase 4, nối subscriber với consumer notification/reminder |
| `src-tauri/src/app/data_participants.rs` | Adapter owner typed cho backup/reset BE-012, dùng shared transaction mà không re-enter maintenance gate hoặc Storage |
| `src-tauri/src/storage/migrations.rs` | Đăng ký migration version 2 và, ở Phase 4, version 10 vào registry tuần tự của BE-002 |
| `src-tauri/migrations/0002_create_settings.sql` | Tạo hàng settings singleton cho Appearance và sidebar ở Phase 1 |
| `src-tauri/migrations/0010_add_notification_settings.sql` | Thêm notification settings ở Phase 4, sau `0009_create_reminder_deliveries.sql` và trước `ReminderService` startup |
| `src-tauri/tests/app_builder.rs` | Giữ smoke test composition root khi thêm managed state và command BE-008 |
| `src-tauri/tests/settings_commands.rs` | Kiểm tra migration, command public, tính bền vững, atomicity và subscription qua backend boundary |
| `src-tauri/tests/data_management_contract.rs` | Kiểm tra maintenance permit, typed plan/projection, shared transaction và publish sau commit |
| `src-tauri/tests/export_bindings.rs` | Sinh và kiểm tra TypeScript binding từ các kiểu public của BE-008 |
| `src/bindings/settings.ts` | Một output sinh tự động chứa toàn bộ public DTO của BE-008; được mở rộng thêm type notification ở Phase 4 |

Không sửa thủ công `src/bindings/settings.ts`; binding generator phải sinh đúng một output aggregate và contract test thất bại nếu file trên đĩa khác kết quả sinh từ Rust.

## Dữ liệu

### Bảng `settings`

Hàng `id = 1` là hàng duy nhất. Giá trị boolean dùng `INTEGER` với `0 = false`, `1 = true`. Màu được chuẩn hóa thành `#rrggbb` trước khi ghi.

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` | Khóa cố định của singleton |
| `revision` | `INTEGER` | `NOT NULL`, `DEFAULT 0`, `CHECK (revision >= 0)` | Tăng đúng một sau mỗi update/restore thành công |
| `theme_mode` | `TEXT` | `NOT NULL`, enum check | `light`, `dark` hoặc `system` |
| `theme_preset` | `TEXT` | `NOT NULL`, enum check | `cream`, `ink`, `paper` hoặc `custom` |
| `light_accent_color` | `TEXT` | `NOT NULL` | Màu action chính khi effective mode là Light |
| `light_canvas_color` | `TEXT` | `NOT NULL` | Màu nền nội dung Light |
| `light_sidebar_color` | `TEXT` | `NOT NULL` | Màu nền sidebar Light |
| `light_text_color` | `TEXT` | `NOT NULL` | Màu chữ chính Light |
| `dark_accent_color` | `TEXT` | `NOT NULL` | Màu action chính khi effective mode là Dark |
| `dark_canvas_color` | `TEXT` | `NOT NULL` | Màu nền nội dung Dark |
| `dark_sidebar_color` | `TEXT` | `NOT NULL` | Màu nền sidebar Dark |
| `dark_text_color` | `TEXT` | `NOT NULL` | Màu chữ chính Dark |
| `terminal_background` | `TEXT` | `NOT NULL` | Màu nền terminal |
| `terminal_foreground` | `TEXT` | `NOT NULL` | Màu chữ terminal |
| `terminal_ansi_colors_json` | `TEXT` | `NOT NULL`, `CHECK (json_valid(terminal_ansi_colors_json))` | JSON array đúng 16 màu, theo thứ tự ANSI 0–15 |
| `interface_font_size_px` | `INTEGER` | `NOT NULL`, `CHECK (interface_font_size_px BETWEEN 12 AND 20)` | Cỡ chữ UI, bước 1 px |
| `terminal_font_size_px` | `INTEGER` | `NOT NULL`, `CHECK (terminal_font_size_px BETWEEN 10 AND 24)` | Cỡ chữ terminal, bước 1 px |
| `sidebar_width_px` | `INTEGER` | `NOT NULL`, `CHECK (sidebar_width_px BETWEEN 200 AND 420)` | Độ rộng gần nhất khi sidebar mở rộng |
| `sidebar_collapsed` | `INTEGER` | `NOT NULL`, boolean check | Sidebar đang thu gọn dạng icon |
| `terminal_activity_notifications_enabled` | `INTEGER` | Phase 4: `NOT NULL`, boolean check | Cho phép terminal/AI CLI tạo notification trong app |
| `notify_os_needs_input` | `INTEGER` | Phase 4: `NOT NULL`, boolean check | Cho phép trạng thái cần input đi ra OS khi session không hiển thị |
| `notify_os_process_finished` | `INTEGER` | Phase 4: `NOT NULL`, boolean check | Cho phép trạng thái kết thúc thành công đi ra OS khi session không hiển thị |
| `notify_os_process_exited_with_error` | `INTEGER` | Phase 4: `NOT NULL`, boolean check | Cho phép trạng thái `ExitedWithError` đi ra OS khi session không hiển thị |
| `event_reminder_notifications_enabled` | `INTEGER` | Phase 4: `NOT NULL`, boolean check | Cho phép reminder tạo notification trong app và OS theo điều kiện hiển thị |

- Index: Không có; bảng luôn có đúng một hàng truy cập bằng primary key.
- Migration Phase 1: `src-tauri/migrations/0002_create_settings.sql`
- Migration Phase 4: `src-tauri/migrations/0010_add_notification_settings.sql`

Migration Phase 1 phải tương đương chính xác với schema sau:

```sql
CREATE TABLE settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    theme_mode TEXT NOT NULL DEFAULT 'system' CHECK (theme_mode IN ('light', 'dark', 'system')),
    theme_preset TEXT NOT NULL DEFAULT 'cream' CHECK (theme_preset IN ('cream', 'ink', 'paper', 'custom')),
    light_accent_color TEXT NOT NULL DEFAULT '#cc785c',
    light_canvas_color TEXT NOT NULL DEFAULT '#faf9f5',
    light_sidebar_color TEXT NOT NULL DEFAULT '#f5f0e8',
    light_text_color TEXT NOT NULL DEFAULT '#141413',
    dark_accent_color TEXT NOT NULL DEFAULT '#e08a6c',
    dark_canvas_color TEXT NOT NULL DEFAULT '#1e1b18',
    dark_sidebar_color TEXT NOT NULL DEFAULT '#26211d',
    dark_text_color TEXT NOT NULL DEFAULT '#f7f2ea',
    terminal_background TEXT NOT NULL DEFAULT '#181715',
    terminal_foreground TEXT NOT NULL DEFAULT '#faf9f5',
    terminal_ansi_colors_json TEXT NOT NULL DEFAULT '["#181715","#c64545","#5db872","#e8a55a","#93b4d6","#b48ead","#5db8a6","#a09d96","#3d3d3a","#e08a8a","#8fd19e","#f0c48a","#b4cde6","#d0b0d8","#8ed4c6","#faf9f5"]' CHECK (json_valid(terminal_ansi_colors_json)),
    interface_font_size_px INTEGER NOT NULL DEFAULT 14 CHECK (interface_font_size_px BETWEEN 12 AND 20),
    terminal_font_size_px INTEGER NOT NULL DEFAULT 13 CHECK (terminal_font_size_px BETWEEN 10 AND 24),
    sidebar_width_px INTEGER NOT NULL DEFAULT 280 CHECK (sidebar_width_px BETWEEN 200 AND 420),
    sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (sidebar_collapsed IN (0, 1))
);

INSERT INTO settings (id) VALUES (1);
```

Migration Phase 4 chạy sau `0009_create_reminder_deliveries.sql` nhưng trước `ReminderService` startup và phải tương đương chính xác với:

```sql
ALTER TABLE settings ADD COLUMN terminal_activity_notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (terminal_activity_notifications_enabled IN (0, 1));
ALTER TABLE settings ADD COLUMN notify_os_needs_input INTEGER NOT NULL DEFAULT 1 CHECK (notify_os_needs_input IN (0, 1));
ALTER TABLE settings ADD COLUMN notify_os_process_finished INTEGER NOT NULL DEFAULT 0 CHECK (notify_os_process_finished IN (0, 1));
ALTER TABLE settings ADD COLUMN notify_os_process_exited_with_error INTEGER NOT NULL DEFAULT 1 CHECK (notify_os_process_exited_with_error IN (0, 1));
ALTER TABLE settings ADD COLUMN event_reminder_notifications_enabled INTEGER NOT NULL DEFAULT 1 CHECK (event_reminder_notifications_enabled IN (0, 1));
```

Không dùng bảng key/value hoặc JSON cho toàn snapshot: cột typed giúp migration, validation và backup có contract rõ ràng. Chỉ mảng ANSI cố định dùng JSON để tránh 16 cột có cùng semantics.

## Giá trị mặc định và preset

General snapshot luôn trả English, close-to-tray bật, tray icon bật, ask-before-quitting bật và open-at-Home bật; đây là constant chứ không phải giá trị database. Sidebar mặc định rộng `280 px`, không collapsed. Appearance mặc định là `system`, preset `cream`, UI `14 px`, terminal `13 px`.

Mỗi preset thay thế đồng thời hai bộ interface colors Light/Dark và toàn bộ terminal palette; `theme_mode` và hai cỡ chữ không đổi. `theme_mode = light|dark` chọn trực tiếp bộ tương ứng; `system` chọn theo effective color scheme của OS mà không ghi lại database khi OS đổi. Bảng dưới dùng thứ tự ANSI `black, red, green, yellow, blue, magenta, cyan, white, bright black, bright red, bright green, bright yellow, bright blue, bright magenta, bright cyan, bright white`.

| Preset | Interface Light `accent / canvas / sidebar / text` | Interface Dark `accent / canvas / sidebar / text` | Terminal `background / foreground` | ANSI 0–15 |
|---|---|---|---|---|
| `cream` | `#cc785c / #faf9f5 / #f5f0e8 / #141413` | `#e08a6c / #1e1b18 / #26211d / #f7f2ea` | `#181715 / #faf9f5` | `#181715`, `#c64545`, `#5db872`, `#e8a55a`, `#93b4d6`, `#b48ead`, `#5db8a6`, `#a09d96`, `#3d3d3a`, `#e08a8a`, `#8fd19e`, `#f0c48a`, `#b4cde6`, `#d0b0d8`, `#8ed4c6`, `#faf9f5` |
| `ink` | `#a95f4a / #f6f5f2 / #eceae6 / #171717` | `#cc785c / #181715 / #1f1e1b / #faf9f5` | `#181715 / #faf9f5` | Giống `cream` |
| `paper` | `#3b6ea8 / #ffffff / #f1efe9 / #141413` | `#78a9dd / #1b1d21 / #22252a / #f7f7f5` | `#ffffff / #141413` | `#141413`, `#c64545`, `#327a47`, `#9a6700`, `#3b6ea8`, `#875f8b`, `#2f7f75`, `#a09d96`, `#66635d`, `#a33434`, `#256f3b`, `#7d5700`, `#315f91`, `#704f74`, `#266c64`, `#f5f0e8` |

`custom` không có bộ màu dựng sẵn. Khi người dùng sửa bất kỳ interface color hoặc terminal color nào, backend giữ các màu đã merge và đặt `theme_preset = custom`. Khi restore, toàn bộ Appearance trở về giá trị mặc định `system + cream + 14 px + 13 px`.

## DTO public

Tất cả enum dùng literal `snake_case`; mọi field struct serialize/export thành `camelCase`, thống nhất với contract frontend hiện có.

```rust
#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum InterfaceLanguageDto {
    English,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ThemeModeDto {
    Light,
    Dark,
    System,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ThemePresetDto {
    Cream,
    Ink,
    Paper,
    Custom,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct InterfaceColorsDto {
    pub accent: String,
    pub canvas: String,
    pub sidebar: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct InterfaceThemeColorsDto {
    pub light: InterfaceColorsDto,
    pub dark: InterfaceColorsDto,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TerminalPaletteDto {
    pub background: String,
    pub foreground: String,
    pub ansi_colors: [String; 16],
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GeneralSettingsDto {
    pub interface_language: InterfaceLanguageDto,
    pub close_to_tray: bool,
    pub show_tray_icon: bool,
    pub ask_before_quitting: bool,
    pub open_at_home_on_launch: bool,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AppearanceSettingsDto {
    pub theme_mode: ThemeModeDto,
    pub theme_preset: ThemePresetDto,
    pub interface_colors: InterfaceThemeColorsDto,
    pub terminal_palette: TerminalPaletteDto,
    pub interface_font_size_px: u8,
    pub terminal_font_size_px: u8,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SidebarSettingsDto {
    pub width_px: u16,
    pub collapsed: bool,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CliOsNotificationStatesDto {
    pub needs_input: bool,
    pub process_finished: bool,
    pub process_exited_with_error: bool,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NotificationSettingsDto {
    pub terminal_activity_enabled: bool,
    pub terminal_os_states: CliOsNotificationStatesDto,
    pub event_reminders_enabled: bool,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub revision: String,
    pub general: GeneralSettingsDto,
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
    pub notifications: NotificationSettingsDto,
}
```

Trong implementation Phase 1, `AppSettingsDto` chưa có field `notifications` và các type notification chưa được export. Migration `0010` và field/type này được thêm cùng nhau ở Phase 4; frontend không phải xử lý trạng thái schema nửa vời.

Patch dùng `Option` để phân biệt field bị bỏ qua với field được cập nhật. JSON field bị thiếu hoặc có giá trị `null` đều được hiểu là bỏ qua; binding phải biểu diễn các field này là optional. Các object patch không được rỗng sau khi bỏ qua field thiếu/`null`.

```rust
#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AppearanceSettingsPatchDto {
    #[ts(optional)]
    pub theme_mode: Option<ThemeModeDto>,
    #[ts(optional)]
    pub theme_preset: Option<ThemePresetDto>,
    #[ts(optional)]
    pub interface_colors: Option<InterfaceThemeColorsDto>,
    #[ts(optional)]
    pub terminal_palette: Option<TerminalPaletteDto>,
    #[ts(optional)]
    pub interface_font_size_px: Option<u8>,
    #[ts(optional)]
    pub terminal_font_size_px: Option<u8>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SidebarSettingsPatchDto {
    #[ts(optional)]
    pub width_px: Option<u16>,
    #[ts(optional)]
    pub collapsed: Option<bool>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NotificationSettingsPatchDto {
    #[ts(optional)]
    pub terminal_activity_enabled: Option<bool>,
    #[ts(optional)]
    pub terminal_os_states: Option<CliOsNotificationStatesDto>,
    #[ts(optional)]
    pub event_reminders_enabled: Option<bool>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct UpdateSettingsDto {
    #[ts(optional)]
    pub appearance: Option<AppearanceSettingsPatchDto>,
    #[ts(optional)]
    pub sidebar: Option<SidebarSettingsPatchDto>,
    #[ts(optional)]
    pub notifications: Option<NotificationSettingsPatchDto>,
}
```

Tương tự snapshot, `notifications` chưa có trong `UpdateSettingsDto` ở Phase 1 và chỉ được thêm cùng migration Phase 4.

## Public backend interface

Ngoài Tauri command, capability cung cấp interface Rust chỉ đọc cho consumer và typed owner contract cho coordinator BE-012. Các kiểu backup/plan/projection dưới đây là Rust-internal, không derive `TS` và không làm thay đổi IPC DTO:

```rust
pub struct SettingsBackupSection {
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
    pub notification_settings: Option<NotificationSettingsDto>,
}

pub struct SettingsRestorePlan {
    // Private owned row operations and the complete committed projection.
}

pub struct SettingsCommittedProjection {
    // Private owned snapshot and revision prepared before apply.
}

impl SettingsService {
    /// Returns the latest committed settings snapshot held in memory.
    pub fn snapshot(&self) -> Result<SettingsSnapshot, SettingsError>;

    /// Subscribes to committed snapshots from the Phase 4 extension onward.
    pub fn subscribe(
        &self,
    ) -> Result<tokio::sync::watch::Receiver<SettingsSnapshot>, SettingsError>;

    /// Exports persisted settings from the coordinator-owned transaction.
    pub fn export_persisted_settings_in(
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<SettingsBackupSection, SettingsError>;

    /// Validates incoming settings and builds an owned restore plan.
    pub fn prepare_settings_restore_in(
        tx: &rusqlite::Transaction<'_>,
        incoming: &SettingsBackupSection,
    ) -> Result<SettingsRestorePlan, SettingsError>;

    /// Applies a prepared settings plan in the coordinator-owned transaction.
    pub fn apply_settings_restore_in(
        tx: &rusqlite::Transaction<'_>,
        plan: &SettingsRestorePlan,
    ) -> Result<SettingsCommittedProjection, SettingsError>;

    /// Resets persisted settings in the coordinator-owned transaction.
    pub fn reset_settings_in(
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<SettingsCommittedProjection, SettingsError>;

    /// Publishes a committed projection to cache and internal subscribers.
    pub fn publish_data_change(&self, projection: SettingsCommittedProjection);
}
```

`SettingsSnapshot` là model nội bộ immutable tương ứng một-một với `AppSettingsDto`. `snapshot()` có từ Phase 1; `subscribe()` chỉ được thêm cùng extension Phase 4 để không kéo Tokio vào lát cắt chỉ có persistence/UI. Khi đó `BE-011` và `BE-019` chỉ dùng interface này, không đọc bảng `settings` hoặc gọi repository của BE-008. Subscriber mới luôn nhận snapshot hiện tại. Sau mỗi commit Phase 4, service gọi `watch::Sender::send_replace` đúng một lần sau khi cache in-memory đã được thay thế; consumer chậm có thể bỏ qua revision trung gian và phải reconcile từ snapshot mới nhất. Poisoned cache/write lock hoặc service đang shutdown trả `Unavailable`, không panic hay phục hồi bằng snapshot mặc định.

`SettingsBackupSection` mang notification settings khi schema Phase 4 đã hiện diện; backup v3 chỉ được BE-012 bật sau khi registry chạy thành công liên tiếp `0008`, `0009` và `0010`. Mọi plan/projection phải owned, `Send + 'static`, không giữ connection/transaction/row borrow/lock guard hoặc callback. API `_in` chỉ dùng `&rusqlite::Transaction` do coordinator truyền, không lấy `DataReadPermit`, settings write gate hoặc gọi Storage lồng. Prepare validate và dựng sẵn SQL operations/projection; apply chỉ chạy SQL và trả projection. Sau commit, `publish_data_change` consume projection, thay cache rồi `send_replace` no-fail; Tauri side effect nếu được thêm sau này chỉ best-effort và không thể biến commit thành typed failure.

## Tauri command

Hai command mutation lấy `DataReadPermit` sau authorization/validation không cần database nhưng trước settings write gate và Storage, rồi giữ permit đến sau commit cùng cache/internal-subscription publish. Permit là dependency Rust nội bộ, không xuất hiện trong command signature hoặc DTO. `get_settings` chỉ đọc cache nên không lấy permit.

### `get_settings`

Đọc snapshot đã commit gần nhất.

```rust
/// Returns the latest committed application settings.
#[tauri::command]
async fn get_settings(
    state: tauri::State<'_, SettingsService>,
) -> Result<AppSettingsDto, SettingsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Không có input; service phải được khởi tạo từ hàng `id = 1` trước khi command được phục vụ |
| Side effect | Không có |
| Lỗi trả về | `Unavailable` nếu managed state chưa sẵn sàng; lỗi dữ liệu hỏng được phát hiện khi khởi tạo thay vì âm thầm thay mặc định |

### `update_settings`

Merge các field được cung cấp vào snapshot hiện tại, validate toàn bộ kết quả rồi commit nguyên tử.

```rust
/// Validates and atomically persists a partial settings update.
#[tauri::command]
async fn update_settings(
    input: UpdateSettingsDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SettingsService>,
) -> Result<AppSettingsDto, SettingsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Chỉ window label `main` được cập nhật; patch tổng và mỗi object patch hiện diện phải có ít nhất một field; áp dụng toàn bộ rule trong mục Business rule; enum không biết bị từ chối khi deserialize |
| Side effect | Lấy `DataReadPermit`; một transaction cập nhật toàn hàng `id = 1`, tăng `revision` đúng một, commit rồi thay snapshot cache; từ Phase 4 gọi thêm `send_replace` trên internal watch channel và chỉ sau đó nhả permit |
| Lỗi trả về | `UnauthorizedWindow`, `EmptyPatch`, `InvalidColor`, `ContrastTooLow`, `ValueOutOfRange`, `InvalidPresetCombination`, `PersistenceFailed` hoặc `Unavailable` |

Nếu patch gồm nhiều section và một field không hợp lệ hoặc database write thất bại, không field nào được ghi, `revision`/cache không đổi và ở Phase 4 không snapshot mới được publish. Những update đồng thời được serialize trong `SettingsService`; mỗi patch merge vào snapshot mới nhất tại thời điểm giữ write lock, do đó hai patch ở field khác nhau không ghi đè nhau.

### `restore_appearance_defaults`

Khôi phục riêng Appearance về mặc định; General, sidebar và notification settings không đổi.

```rust
/// Restores all appearance fields to the built-in default theme.
#[tauri::command]
async fn restore_appearance_defaults(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SettingsService>,
) -> Result<AppSettingsDto, SettingsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Chỉ window label `main` được gọi |
| Side effect | Lấy `DataReadPermit`; ghi `system + cream + 14 px + 13 px`, tăng `revision`, commit và thay cache; từ Phase 4 publish theo cùng thứ tự với `update_settings`, rồi nhả permit |
| Lỗi trả về | `UnauthorizedWindow`, `PersistenceFailed` hoặc `Unavailable` |

Restore vẫn tạo một revision mới kể cả khi Appearance đã ở mặc định; đây là một hành động người dùng đã commit và, từ Phase 4, giúp subscriber có tín hiệu xác định để reconcile.

## Event / Channel phát ra

Không có Tauri event hoặc Channel. Command trả snapshot mới trực tiếp cho main window. Từ Phase 4, consumer Rust dùng internal `tokio::sync::watch`; cửa sổ được tạo sau, gồm Quick Note, được phép gọi `get_settings` khi khởi tạo nhưng không được gọi hai command mutation, nên không cần broadcast public chỉ để đồng bộ theme.

## Business rule và invariant

1. Bảng luôn có đúng một hàng `id = 1`; thiếu hàng, có giá trị enum sai, JSON ANSI sai hoặc giá trị ngoài giới hạn là dữ liệu hỏng, không được tự thay bằng default.
2. `revision` khớp giữa database, cache và DTO; SQLite/cache giữ số nguyên không âm, còn DTO serialize thành chuỗi thập phân không dấu/không leading zero để không mất chính xác qua JavaScript. Revision chỉ tăng sau một update/restore được commit, không tăng do migration hoặc đọc.
3. `interface_language` chỉ nhận `english` ở DTO và lưu `en` trong SQLite.
4. Mọi màu input chấp nhận `#RRGGBB` không phân biệt hoa/thường, được lưu/trả về dạng lowercase `#rrggbb`; không chấp nhận alpha, shorthand, tên màu hoặc CSS function.
5. Với cả bộ Light và Dark, tỷ lệ tương phản theo WCAG giữa `text/canvas`, `text/sidebar` phải đạt ít nhất `4.5:1`, còn `accent/canvas` phải đạt ít nhất `3:1`; `terminal foreground/background` phải đạt ít nhất `4.5:1`. Backend tính trên sRGB sau khi merge toàn patch để bảo đảm snapshot cuối hợp lệ.
6. `TerminalPaletteDto.ansi_colors` luôn có đúng 16 phần tử nhờ kiểu mảng và từng phần tử phải là màu hợp lệ. BE-008 không ép contrast từng ANSI color vì người dùng có quyền tùy chỉnh palette terminal; frontend phải preview trước khi commit.
7. UI font chỉ nhận số nguyên `12..=20`; terminal font chỉ nhận `10..=24`; sidebar width chỉ nhận số nguyên `200..=420`.
8. `GeneralSettingsDto` luôn trả `english` cùng bốn boolean `true`. General không có patch và không có cột SQLite; giá trị `ask_before_quitting = true` nghĩa là policy cảnh báo bắt buộc được áp dụng khi BE-001 phát hiện session theo §5.4, không buộc mở dialog khi không có session.
9. `Missed reminders on launch` luôn bật nhưng không nằm trong General DTO hay persistence; backend không nhận field để tắt invariant §13.3 này.
10. Chọn `cream`, `ink` hoặc `paper` không được gửi đồng thời `interface_colors` hoặc `terminal_palette`; backend thay màu bằng constant của preset. Gửi custom colors tự đặt preset thành `custom`. Gửi `custom` mà không kèm màu giữ palette hiện tại và chỉ đánh dấu trạng thái custom.
11. Preview trực tiếp là state tạm ở frontend. Backend chỉ lưu, cập nhật cache và, từ Phase 4, publish snapshot sau khi người dùng/control commit giá trị hợp lệ; dữ liệu preview lỗi không chạm SQLite.
12. Ở Phase 4, tắt `terminal_activity_enabled` làm `BE-011` bỏ cả notification trong app lẫn OS cho terminal/AI CLI; các lựa chọn OS được giữ nhưng không có hiệu lực cho đến khi bật lại.
13. Ở Phase 4, tắt `event_reminders_enabled` không tắt scheduler và không xóa reminder. `BE-019` vẫn ghi nhận reminder đến hạn/Missed nhưng `BE-011` không tạo bell item hoặc OS notification. Missed reminder đến hạn khi app đã thoát không bao giờ gửi hàng loạt OS notification, bất kể setting.
14. Settings không chứa secret, terminal output, note content, project source hoặc path và không được log toàn snapshot. Log chỉ được chứa command name, revision, section thay đổi và error code.
15. `get_settings` là read-only và dùng được từ window do XWork tạo. `update_settings` và `restore_appearance_defaults` phải kiểm tra label `main`; request mutation từ Quick Note hoặc label khác bị từ chối trước validation và trước khi chạm database.
16. Mọi persistent mutation lấy `DataReadPermit` trước settings write gate/Storage và giữ qua commit cùng publish cache/subscription. Lock order duy nhất là `DataMaintenanceGate` → settings write gate → Storage; owner `_in` API chạy dưới write permit của BE-012 nên không re-enter gate, write gate hoặc Storage.
17. Phase 4 chỉ được coi là sẵn sàng khi `0008_create_calendar_events.sql`, `0009_create_reminder_deliveries.sql` và `0010_add_notification_settings.sql` đã chạy theo đúng thứ tự. `ReminderService` chỉ startup sau khi Settings hydrate được notification columns; backup v3 cũng chỉ được enable sau điều kiện này.

## Lỗi

```rust
#[derive(Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
pub enum SettingsError {
    UnauthorizedWindow,
    EmptyPatch,
    InvalidColor { field: String },
    ContrastTooLow { foreground: String, background: String },
    ValueOutOfRange { field: String, min: u16, max: u16 },
    InvalidPresetCombination,
    CorruptStoredSettings { field: String },
    PersistenceFailed,
    Unavailable,
}
```

Error IPC có tagged shape `{ code, ...details }`. `PersistenceFailed` và `Unavailable` không mang source error; chi tiết rusqlite/storage chỉ nằm trong error chain nội bộ an toàn.

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Window khác `main` gọi command mutation | Không retry; đây là vi phạm boundary của caller |
| `EmptyPatch` | Patch tổng hoặc object patch hiện diện không có field | Không gửi request rỗng; giữ form hiện tại |
| `InvalidColor` | Màu không đúng `#RRGGBB` | Đánh dấu đúng color field và giữ preview chưa commit |
| `ContrastTooLow` | Một trong ba cặp bắt buộc dưới `4.5:1` | Hiển thị lỗi contrast cạnh nhóm màu |
| `ValueOutOfRange` | Font size hoặc sidebar width ngoài giới hạn | Khôi phục control về snapshot gần nhất và nêu khoảng hợp lệ |
| `InvalidPresetCombination` | Preset dựng sẵn và custom colors cùng xuất hiện trong một patch | Sửa request; không ghi một phần |
| `CorruptStoredSettings` | Hàng SQLite không giải mã/validate được khi startup | Hiển thị lỗi dữ liệu cấp ứng dụng; không tự reset dữ liệu |
| `PersistenceFailed` | Transaction/SQLite thất bại | Giữ snapshot cũ và cho retry; chi tiết nội bộ chỉ ghi log an toàn |
| `Unavailable` | Service chưa khởi tạo hoặc đang shutdown | Hiển thị lỗi tạm thời cấp ứng dụng |

## Luồng chính

1. Sau khi BE-002 chạy migrations, composition root mở hàng `settings.id = 1`, decode và validate toàn snapshot trước khi phục vụ cửa sổ.
2. `SettingsService` giữ snapshot immutable hiện tại cùng một write lock; extension Phase 4 khởi tạo thêm watch channel bằng snapshot đó.
3. Frontend gọi `get_settings` khi application shell hoặc một cửa sổ mới khởi tạo; command chỉ clone cache, không query SQLite mỗi lần.
4. Khi update, async command lấy `DataReadPermit`, clone `SettingsService` vào `tauri::async_runtime::spawn_blocking`. Bên trong closure, service lấy standard-library write gate, clone cache hiện tại, merge patch, áp dụng preset/normalization rồi validate toàn snapshot.
5. Vẫn bên trong closure và trong lúc giữ write gate, service gọi `Storage::with_transaction`: cập nhật toàn hàng với `revision + 1`, yêu cầu đúng một affected row và commit. Không giữ cache `RwLock` trong lúc chờ Storage mutex/transaction.
6. Chỉ sau commit, service thay cache rồi trả cùng snapshot cho caller. Từ Phase 4, service gọi `send_replace` một lần sau khi thay cache; sau publish mới nhả `DataReadPermit`. Consumer chậm reconcile revision mới nhất thay vì giả định nhận đủ mọi revision trung gian.
7. Ở Phase 4, registry chạy `0008` → `0009` → `0010`, Settings hydrate snapshot notification, rồi composition root mới startup `ReminderService`; BE-012 chỉ sau đó enable backup v3. `BE-011` và `BE-019` reconcile side effect thuộc capability của mình từ snapshot mới. Lỗi notification không rollback dữ liệu đã commit; consumer báo lỗi theo contract của capability sở hữu side effect và retry reconcile khi phù hợp.

## Ràng buộc kỹ thuật

- Blocking: Khi khởi tạo trong Tauri setup, có thể đọc SQLite đồng bộ trước khi phục vụ IPC. Từ async command, phải clone `SettingsService` và chạy toàn bộ write gate → merge/validate → `Storage::with_transaction` → cache/publish trong một `tauri::async_runtime::spawn_blocking`; command chỉ await join handle và không giữ `State`, settings/storage lock hoặc reference database qua `.await`. Validation màu/contrast là CPU nhỏ và chạy đồng bộ trước transaction.
- Bảo mật: Không nhận SQL key, tên cột hoặc JSON tùy ý từ frontend; câu SQL cố định và parameterized. Không log snapshot, màu/palette đầy đủ hoặc lỗi SQLite thô ra frontend.
- Hiệu năng: `get_settings` đọc cache và không I/O; update ghi đúng một hàng trong một transaction. Một update hợp lệ phải hoàn tất trong `100 ms` ở p95 trên máy Windows hỗ trợ khi database không bị contention; không debounce ở backend vì sidebar drag phải được debounce tại frontend trước khi gọi command.
- Concurrency: Một `SettingsService` duy nhất dùng standard-library mutex làm write gate và `RwLock` riêng cho cache. Persistent mutation tuân theo `DataMaintenanceGate` read permit → settings write gate → cache clone rồi nhả cache → Storage → cache replace/publish; code không được gọi ngược vào Settings từ callback Storage. Từ Phase 4, publish diễn ra sau khi nhả cache write guard nên subscriber không thấy state bị rollback và không thể giữ lock của service. Maintenance `_in` dùng shared transaction của coordinator và không lấy lại bất kỳ gate/lock/Storage nào.
- Vòng đời: Service phải sẵn sàng trước khi tạo main window. Khi shutdown đã bắt đầu, command mới trả `Unavailable`; commit đang chạy được phép hoàn tất trước khi storage đóng.

## Tiêu chí hoàn thành

- [ ] Database mới chạy `0002_create_settings.sql`, có đúng một hàng default và mở lại ứng dụng vẫn trả cùng snapshot.
- [ ] `get_settings`, `update_settings` và `restore_appearance_defaults` được đăng ký ở composition root và có generated TypeScript bindings; window bất kỳ do XWork tạo chỉ được đọc, còn mutation từ label khác `main` bị từ chối trước database.
- [ ] Patch nhiều section hợp lệ commit nguyên tử, tăng revision đúng một và cập nhật cache sau commit; từ Phase 4 gọi `send_replace` đúng một lần và subscriber quan sát revision mới nhất đơn điệu dù có thể bỏ qua revision trung gian.
- [ ] Patch lỗi hoặc SQLite failure không đổi database, cache, revision và, ở Phase 4, không publish snapshot.
- [ ] Ba preset với đủ token Light/Dark, custom colors, normalization, contrast, font bounds, sidebar bounds và General constants có unit test theo giá trị biên.
- [ ] Restore Appearance không thay General, sidebar hoặc notification settings và vẫn tăng revision khi state đã mặc định.
- [ ] Sau restart, General vẫn trả đúng constant; Appearance, sidebar width/collapsed và revision được giữ; `theme_mode = system` không ghi effective Light/Dark hiện tại của OS.
- [ ] Ở Phase 4, migration `0010_add_notification_settings.sql` bảo toàn toàn bộ giá trị cũ, thêm đúng default và snapshot/binding được mở rộng cùng lúc.
- [ ] Phase 4 chạy registry `0008` → `0009` → `0010`, hydrate notification settings trước `ReminderService` startup và chỉ enable backup v3 sau cả ba migration thành công.
- [ ] Persistent mutation giữ `DataReadPermit` qua commit/publish; write permit của BE-012 chặn mutation, còn typed `_in` restore/reset dùng shared transaction, rollback không publish và commit publish cache/subscriber no-fail.
- [ ] Ở Phase 4, consumer test chứng minh terminal/reminder toggle và CLI OS-state filter được đọc qua public snapshot, còn Missed reminder vẫn luôn được ghi nhận.
- [ ] Mọi function, method, callback, helper và test được thêm có comment ngắn đúng quy tắc project; không sửa binding sinh tự động bằng tay.
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` và `cargo test --manifest-path src-tauri/Cargo.toml` pass trên Windows.
- [ ] Frontend formatter/lint/type-check/unit/component test và build liên quan pass; Rust integration test chứng minh settings còn sau khi mở lại service, còn smoke thủ công Windows xác nhận theme/sidebar áp dụng sau khi mở lại ứng dụng.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/settings/mod.rs` (`#[cfg(test)]`) | Unit | General/default/preset constants; màu lowercase; format và contrast; font/sidebar bounds; patch merge; preset/custom rule; decode lỗi; notification semantics Phase 4 |
| `src-tauri/tests/settings_commands.rs` | Integration | Migration default; command registration; read/update/restore; atomic rollback; revision; restart persistence; concurrent disjoint patch; ở Phase 4 subscriber nhận snapshot mới nhất với revision đơn điệu và migration bảo toàn dữ liệu |
| `src-tauri/tests/data_management_contract.rs` | Integration | Write permit chặn settings mutation; typed `_in` plan/projection dùng shared transaction; rollback không publish; commit thay cache/subscriber no-fail; backup v3 chỉ sẵn sàng sau `0008..0010` |
| `src-tauri/tests/export_bindings.rs` | Contract | Sinh toàn bộ BE-008 DTO từ Rust và fail khi binding trên đĩa không đồng bộ |

## Câu hỏi mở

Không có.
