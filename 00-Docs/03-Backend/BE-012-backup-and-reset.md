# BE-012 — Backup và reset

Tài liệu này đặc tả hợp đồng backend cho Settings Data: xuất/nhập gói sao lưu cục bộ có phiên bản, hiển thị vị trí dữ liệu XWork và reset dữ liệu sau xác nhận rõ ràng.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-012` |
| Phase | `1`; schema backup mở rộng ở Phase 3 và Phase 4 |
| Capability | `src-tauri/src/settings/`, `src-tauri/src/storage/` |
| Yêu cầu chức năng | §17.6, §18 |
| Frontend liên quan | `FE-015`; mở rộng dữ liệu từ `FE-019`–`FE-020` ở Phase 3 và `FE-021`–`FE-023` ở Phase 4 |
| Phụ thuộc | Phase 1: `BE-001`, `BE-002`, `BE-003`, `BE-005`, `BE-006`, `BE-008`, `BE-009`, `BE-011`; reset extension: `BE-014` ở Phase 2; backup/reset extension: `BE-016` ở Phase 3, `BE-018` và `BE-019` ở Phase 4 |

## Mục tiêu

Backend tạo và khôi phục một gói JSON cục bộ từ các public backup participant của domain, không đưa source project hoặc secret thuần văn bản vào gói. Backend cũng cung cấp vị trí app data và một quy trình reset có preview, xác nhận `RESET`, cleanup runtime, transaction nguyên tử và cleanup credential có thể retry.

### Ngoài phạm vi

- Không sao chép, đóng gói, sửa hoặc xóa source project; `root_path` trong project backup chỉ là metadata tham chiếu.
- Không backup/restore phiên runtime, tab, pane, terminal output, CLI history, file đang mở, file gần đây, log, notification inbox hoặc reminder delivery state.
- Không backup plaintext secret, không đọc credential store khi export và không hứa credential reference dùng được trên máy khác.
- Không đồng bộ cloud, mã hóa backup, nén/ZIP, tự động backup, lịch backup, retention hoặc khôi phục từng record qua UI.
- Không xóa file database hoặc migration khi reset; reset dữ liệu nghiệp vụ trong database hiện hành để tránh xử lý file đang mở và vẫn giữ schema hợp lệ.
- Không thiết kế giao diện Settings Data. Native picker, preview/result typed và validation backend là boundary của BE-012; bố cục, progress, dialog và focus thuộc FE-015.

### Quyết định và giả định đã chốt

- Chọn JSON UTF-8, hậu tố `.xwork-backup.json`, không ZIP. Một file JSON đủ cho dữ liệu local hiện tại, dễ kiểm tra/version và không tạo bề mặt archive traversal hoặc decompression bomb.
- Import dùng **merge, không replace toàn bộ**, đúng help text wireframe. Record không có trong backup được giữ; record trùng identity được cập nhật theo quy tắc từng domain. Chỉ singleton settings, default shell và tập shortcut override được thay bằng section có trong backup vì chúng biểu diễn một cấu hình hoàn chỉnh.
- Sau native picker, import luôn hiển thị preview và yêu cầu một lần Confirm import. Wireframe chỉ minh họa nút import, còn preview là mặc định an toàn vì merge vẫn có thể ghi đè record cùng ID/settings dù không xóa record ngoài gói.
- Dùng `schemaVersion` nguyên tăng dần: `1` cho core Phase 1, `2` thêm Notes ở Phase 3, `3` thêm Events và notification settings ở Phase 4. Binary từ chối version mới hơn thay vì bỏ qua dữ liệu không hiểu; binary mới vẫn nhập mọi version cũ và giữ nguyên domain chưa có trong version đó.
- Note/Event backup record do capability sở hữu cung cấp qua public participant. BE-012 sở hữu envelope/version, orchestration và giới hạn; không đọc bảng hoặc invent schema nội bộ của BE-016/018.
- Export lấy snapshot nhất quán trong một SQLite transaction. Import/reset áp toàn bộ thay đổi SQLite trong một transaction và gọi participant-owned SQL; BE-012 không truy cập bảng domain trực tiếp.
- Reset dùng cùng owner lifecycle/order với BE-001 nhưng qua reset-specific pause/resume, không gọi true-Quit; runtime được quiesce trước khi xóa dữ liệu bền vững. Nếu cleanup runtime lỗi, transaction reset chưa mở và dữ liệu bền vững được giữ nguyên.
- Reset không xóa source project hoặc log. Wireframe hiển thị vị trí database và logs để người dùng tự phục vụ hỗ trợ; log không phải dữ liệu người dùng được reset hoặc backup.
- File backup không mã hóa có thể chứa đường dẫn, nội dung note và mô tả event. FE-015 phải nói rõ đây là dữ liệu cục bộ nhạy cảm trước khi export; backend dùng permission file mặc định của OS và không upload file.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo Serde JSON và official dialog/opener/clipboard plugin cần cho native file/location boundary nếu dependency hiện hành chưa có |
| `src-tauri/Cargo.lock` | Khóa dependency do Cargo sinh; không sửa thủ công |
| `src-tauri/src/lib.rs` | Export module `settings`, `storage` và `platform` dùng bởi composition root |
| `src-tauri/src/settings/mod.rs` | Re-export DTO, error, command và service Data Management cạnh BE-008/009 |
| `src-tauri/src/settings/data.rs` | Envelope/version, DTO public, validation, pending operation state, export/import/reset orchestration và Tauri command |
| `src-tauri/src/settings/data_participant.rs` | Consumer-side participant contract, prepared plan và thứ tự apply/refresh dùng xuyên domain |
| `src-tauri/src/storage/backup.rs` | Đọc snapshot và chạy một transaction chung qua callback participant; không chứa SQL nghiệp vụ |
| `src-tauri/src/storage/mod.rs` | Export helper backup transaction dựa trên `Storage::with_transaction` của BE-002 |
| `src-tauri/src/storage/migrations.rs` | Giữ registry tuần tự qua migration bắt buộc `0008`, `0009`, `0010`; BE-012 không tự đăng ký migration |
| `src-tauri/migrations/0008_create_calendar_events.sql` | Migration bắt buộc của Events trước khi bật backup schema v3 |
| `src-tauri/migrations/0009_create_reminder_deliveries.sql` | Migration bắt buộc của reminder/reset-only participant trước notification settings |
| `src-tauri/migrations/0010_add_notification_settings.sql` | Migration bắt buộc của notification settings được backup trong schema v3 |
| `src-tauri/src/platform/mod.rs` | Export adapter native Data file/location |
| `src-tauri/src/platform/data.rs` | Native open/save picker, atomic file replace, mở app-data directory và copy path; không chứa business rule |
| `src-tauri/src/shared/mod.rs` | Re-export primitive maintenance dùng chung, không phụ thuộc capability nghiệp vụ |
| `src-tauri/src/shared/maintenance.rs` | Sở hữu `DataMaintenanceGate`, read/write permit async và lock-order invariant cấp ứng dụng |
| `src-tauri/src/app/mod.rs` | Khởi tạo `DataManagementService`, maintenance gate, participant theo phase, plugin và đăng ký command |
| `src-tauri/src/app/data_participants.rs` | Adapter triển khai consumer-side participant BE-012 bằng public maintenance API BE-003/006/008/009 và extension BE-016/018 |
| `src-tauri/src/app/data_reset_participants.rs` | Adapter reset-only cho Recent Files, Notifications và Reminders, chỉ gọi public owner API theo phase |
| `src-tauri/src/app/data_runtime.rs` | Async adapter `DataRuntimeControl`, dùng cùng owner lifecycle của BE-001 nhưng không gọi true-Quit hoặc `block_on` |
| `src-tauri/src/app/lifecycle.rs` | Chia sẻ owner runtime handle/order giữa true-Quit BE-001 và reset adapter, không đặt business rule BE-012 trong lifecycle |
| `src-tauri/src/projects/mod.rs` | Re-export typed maintenance API/type cho project backup, không import BE-012 |
| `src-tauri/src/projects/models.rs` | Sở hữu backup record, import plan/map, public `ProjectImportMap::resolve` và committed projection typed của Projects |
| `src-tauri/src/projects/repository.rs` | SQL export/merge/reset project nhận transaction của coordinator |
| `src-tauri/src/projects/service.rs` | Validation/path identity và post-commit cache/event owner của Projects |
| `src-tauri/src/sessions/mod.rs` | Re-export public runtime impact/shutdown contract BE-005 cho app adapter |
| `src-tauri/src/sessions/models.rs` | Mở rộng `ShutdownImpact` với unsaved-file count do pane content aggregate |
| `src-tauri/src/sessions/manager.rs` | Async impact/shutdown toàn session và delegate cleanup Terminal/Files |
| `src-tauri/src/terminal/mod.rs` | Re-export typed maintenance contract CLI Profiles |
| `src-tauri/src/terminal/cli_profiles.rs` | Công khai owner maintenance API/type cho profile/default shell, secret-reference merge và cleanup queue, không import BE-012 |
| `src-tauri/src/settings/keyboard_shortcuts.rs` | Công khai owner maintenance API/type tái dùng `export_overrides`/validation của `replace_overrides` BE-009 |
| `src-tauri/src/notifications/mod.rs` | Re-export reset lifecycle và reset-only maintenance API của Notifications |
| `src-tauri/src/notifications/models.rs` | Sở hữu reset plan/projection typed, không đưa inbox vào backup |
| `src-tauri/src/notifications/repository.rs` | Xóa notification rows trong shared reset transaction |
| `src-tauri/src/notifications/service.rs` | Pause/resume runtime source và publish reset sau commit |
| `src-tauri/src/files/mod.rs` | Re-export lifecycle/Recent Files reset-only API cho app adapter |
| `src-tauri/src/files/models.rs` | Sở hữu Recent Files reset plan/projection typed |
| `src-tauri/src/files/repository.rs` | Xóa recent-file rows trong shared reset transaction |
| `src-tauri/src/files/service.rs` | Publish Recent Files reset sau commit; không xóa source file |
| `src-tauri/src/files/handles.rs` | Cleanup file buffer/watcher qua BE-005 `PaneContentRuntime` trong reset runtime |
| `src-tauri/src/notes/mod.rs` | Re-export typed backup/reset contract Notes |
| `src-tauri/src/notes/models.rs` | Sở hữu backup record, import plan và committed projection Notes |
| `src-tauri/src/notes/repository.rs` | SQL export/merge/reset Notes nhận transaction của coordinator |
| `src-tauri/src/notes/service.rs` | Validation và post-commit cache/event owner của Notes |
| `src-tauri/src/calendar/mod.rs` | Re-export typed backup/reset contract Events và reset-only contract Reminders |
| `src-tauri/src/calendar/models.rs` | Sở hữu backup record/plan/projection Events |
| `src-tauri/src/calendar/repository.rs` | SQL export/merge/reset Events nhận transaction của coordinator |
| `src-tauri/src/calendar/service.rs` | Validation và post-commit invalidation owner của Events |
| `src-tauri/src/calendar/backup.rs` | Typed adapter API export/prepare/apply/reset/publish Events |
| `src-tauri/src/calendar/reminder_models.rs` | Sở hữu reset-only plan/projection Reminders |
| `src-tauri/src/calendar/reminder_repository.rs` | Xóa reminder delivery/checkpoint trong shared reset transaction |
| `src-tauri/src/calendar/reminder_scheduler.rs` | Quiesce/resume scheduler quanh reset mà không dùng true-Quit path |
| `src-tauri/src/calendar/reminder_service.rs` | Public reset-only apply/publish và runtime pause/resume Reminders |
| `src-tauri/src/bin/export_bindings.rs` | Đăng ký DTO/error BE-012 với binding generator |
| `src/bindings/data-management.ts` | Binding TypeScript aggregate được sinh từ Rust; không sửa thủ công |
| `src-tauri/tests/data_management_contract.rs` | Integration test envelope, native adapter giả, transaction, merge, reset và redaction |
| `src-tauri/tests/export_bindings.rs` | Contract test binding trên đĩa khớp Rust source |
| `src-tauri/tests/app_builder.rs` | Smoke test composition root đăng ký service/participant/command/plugin và không mở ACL webview mới |

Không tạo migration cho BE-012. Feature dùng schema hiện hành do domain sở hữu; registry Phase 1 kết thúc ở `0005_create_notifications.sql`. Các extension tuân thứ tự bắt buộc đã chốt: BE-014 dùng `0006_create_recent_files.sql`, BE-016 dùng `0007_create_notes.sql`, BE-018 dùng `0008_create_calendar_events.sql`, BE-019 dùng `0009_create_reminder_deliveries.sql`, rồi BE-008 thêm notification settings bằng `0010_add_notification_settings.sql`. App không khởi tạo participant của phase nếu migration bắt buộc tương ứng chưa hoàn tất.

`storage/backup.rs` chỉ điều phối connection/transaction và không import capability. SQL project/profile/settings/shortcut/note/event luôn nằm trong participant owner. `platform/data.rs` là adapter OS dùng chung; webview không nhận filesystem permission tổng quát và không gửi đường dẫn tùy ý.

## Dữ liệu

BE-012 không tạo bảng hoặc migration. Nó đọc/ghi các bảng đã được participant owner đăng ký, qua đúng một transaction của `Storage`. Reset giữ `PRAGMA user_version`, migration registry, database file và `credential_cleanup_queue`; queue phải tồn tại để retry xóa credential sau commit.

### Định dạng file backup

File là một JSON object UTF-8, serialize `camelCase`, không BOM, không comment, không trailing data. Export hiện hành dùng tên gợi ý `xwork-YYYY-MM-DD-HHmmss.xwork-backup.json` theo UTC; người dùng có thể đổi tên trong native save dialog.

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupEnvelope<T> {
    pub format: String,
    pub schema_version: u32,
    pub created_at_ms: i64,
    pub app_version: String,
    pub data: T,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDataV1 {
    pub projects: Vec<ProjectBackupRecordV1>,
    pub cli_profiles: CliProfilesBackupV1,
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
    pub keyboard_shortcut_overrides: Vec<ShortcutOverride>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDataV2 {
    pub projects: Vec<ProjectBackupRecordV1>,
    pub cli_profiles: CliProfilesBackupV1,
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
    pub keyboard_shortcut_overrides: Vec<ShortcutOverride>,
    pub notes: Vec<NoteBackupRecordV1>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDataV3 {
    pub projects: Vec<ProjectBackupRecordV1>,
    pub cli_profiles: CliProfilesBackupV1,
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
    pub keyboard_shortcut_overrides: Vec<ShortcutOverride>,
    pub notes: Vec<NoteBackupRecordV1>,
    pub events: Vec<EventBackupRecordV1>,
    pub notification_settings: NotificationSettingsDto,
}
```

`format` luôn là literal `xwork-backup`; `schemaVersion` là `1`, `2` hoặc `3`, không phụ thuộc migration `user_version`. `createdAtMs` là Unix epoch millisecond UTC không âm; `appVersion` là version package chỉ để chẩn đoán/hiển thị, không dùng quyết định compatibility. Parser đọc header giới hạn trước, chọn đúng struct theo `schemaVersion`, rồi áp `deny_unknown_fields` cho envelope/record do BE-012 sở hữu và cùng policy strict cho record owner.

Parser deserialize lần lượt thành `BackupEnvelope<BackupDataV1>`, `BackupEnvelope<BackupDataV2>` hoặc `BackupEnvelope<BackupDataV3>`. Việc lặp field làm shape JSON phẳng và cho phép `deny_unknown_fields` hoạt động chính xác; không có key wrapper nội bộ ngoài `data`.

### Record Phase 1

`ProjectBackupRecordV1` là public Rust record do BE-003 sở hữu; `CliProfilesBackupV1`, `CliProfileBackupRecordV1` và `CliEnvironmentBackupRecordV1` do BE-006 sở hữu. Chúng không derive `TS` hoặc lộ qua IPC; BE-012 import type công khai này để tạo envelope thay vì đọc model/table nội bộ.

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectBackupRecordV1 {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub is_pinned: bool,
    pub added_at_ms: i64,
    pub last_opened_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliProfilesBackupV1 {
    pub default_shell_id: String,
    pub custom_profiles: Vec<CliProfileBackupRecordV1>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliProfileBackupRecordV1 {
    pub id: String,
    pub name: String,
    pub command: String,
    pub arguments: Vec<String>,
    pub shell_id: Option<String>,
    pub icon: String,
    pub color: String,
    pub environment: Vec<CliEnvironmentBackupRecordV1>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CliEnvironmentBackupRecordV1 {
    Plain {
        name: String,
        value: String,
    },
    SecretReference {
        name: String,
        credential_account: String,
    },
}
```

- Project không xuất `path_key`, availability, branch hoặc Git status. Import dùng canonical/path-key rule BE-003; folder không còn tồn tại vẫn được restore thành project unavailable.
- Chỉ custom CLI profile được xuất; ba built-in là hằng số BE-006. `default_shell_id` được xuất vì là setting bền vững. Availability/command resolved không được xuất.
- `SecretReference` chỉ chứa tên biến và opaque `credential_account`; không chứa value, hash value hoặc dữ liệu credential store. Error/log cũng không được lộ account; test có thể so sánh account trên object đã parse nội bộ.
- `appearance` và `sidebar` là phần bền vững của BE-008, không chứa `revision` hoặc General invariant (`English`, close-to-tray, ask-before-quit, tray icon). Ở v3, `notificationSettings` dùng contract typed sau migration `0010`.
- Shortcut chỉ xuất override theo `KeyboardShortcutsService::export_overrides`, sort theo catalog; default và conflict projection được tính lại khi import. Quick Note global chỉ có trong catalog/override từ Phase 3 của BE-009/017.

### Mở rộng Notes và Events

| Schema | Phase tạo | Field bắt buộc mới | Owner record | Quy tắc compatibility |
|---:|---|---|---|---|
| `1` | Phase 1 | Không có ngoài core | BE-003/006/008/009 | Binary v1 chỉ xuất/nhập v1 |
| `2` | Phase 3 | `notes` | `NoteBackupRecordV1` do BE-016 public contract sở hữu | Binary v2/v3 nhập v1 mà không đổi notes hiện có; export v2 luôn có array, kể cả rỗng |
| `3` | Phase 4 | `events`, `notificationSettings` | `EventBackupRecordV1` do BE-018 và DTO BE-008 sở hữu | Binary v3 nhập v1/v2 mà không đổi events/notification settings hiện có; export v3 luôn có đủ field |

`NoteBackupRecordV1` phải giữ identity, title tùy chọn, Markdown content, optional project link, pin/lifecycle state và timestamp cần để restore đúng BE-016. `EventBackupRecordV1` phải giữ identity, title, description, optional project link, start/end/all-day/timezone, recurrence và reminder definitions cần để restore đúng BE-018. App participant adapter clone từng record, remap optional project link qua public `ProjectImportMap::resolve`, rồi mới chuyển bản sao đã remap cho owner validate domain field và canonical target project ID; referential existence được bảo đảm bởi map cùng thứ tự apply Projects trước Notes/Events. BE-012 không deserialize record thành `serde_json::Value` và không truy cập repository owner.

Notification inbox, notification read state, reminder occurrence/delivery/missed/snooze state không thuộc event definition và không được đưa vào v3. Một thay đổi shape bắt buộc trong tương lai phải tăng `schemaVersion`; không tái định nghĩa version đã phát hành.

## DTO public

Mọi field serialize/export thành `camelCase`; enum serialize thành literal `snake_case`, enum có dữ liệu dùng discriminator `kind`.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DataLocationDto {
    pub directory: String,
    pub database_file_name: String,
    pub logs_directory_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct BackupContentCountsDto {
    pub projects: u32,
    pub custom_cli_profiles: u32,
    pub secret_references: u32,
    pub keyboard_shortcut_overrides: u32,
    pub notes: Option<u32>,
    pub events: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum BackupExportOutcomeDto {
    Cancelled,
    Exported {
        file_name: String,
        schema_version: u32,
        counts: BackupContentCountsDto,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct BackupMergeCountsDto {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
    pub removals: u32,
    pub project_path_matches: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct BackupImportPreviewDto {
    pub request_id: u32,
    pub schema_version: u32,
    pub created_at_ms: i64,
    pub source_app_version: String,
    pub counts: BackupContentCountsDto,
    pub merge: BackupMergeCountsDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum PrepareBackupImportOutcomeDto {
    Cancelled,
    Ready { preview: BackupImportPreviewDto },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct BackupImportResultDto {
    pub schema_version: u32,
    pub applied: BackupMergeCountsDto,
    pub credential_cleanup_pending: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ResetImpactDto {
    pub request_id: u32,
    pub projects: u32,
    pub custom_cli_profiles: u32,
    pub keyboard_shortcut_overrides: u32,
    pub settings_differ_from_default: bool,
    pub notes: u32,
    pub events: u32,
    pub sessions: u32,
    pub running_processes: u32,
    pub unsaved_documents: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ResetResultDto {
    pub projects_removed: u32,
    pub custom_cli_profiles_removed: u32,
    pub keyboard_shortcut_overrides_removed: u32,
    pub settings_reset: bool,
    pub notes_removed: u32,
    pub events_removed: u32,
    pub sessions_stopped: u32,
    pub credential_cleanup_pending: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum DataChangeKindDto {
    BackupImported,
    AppReset,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DataChangedEventDto {
    pub kind: DataChangeKindDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum BackupDomainDto {
    Projects,
    Settings,
    CliProfiles,
    KeyboardShortcuts,
    Notes,
    Events,
}
```

`directory` là app-data absolute path chỉ để hiển thị/copy; frontend không được gửi ngược path này vào command khác. `logsDirectoryName` là relative display label (mặc định `logs`), không phải quyền đọc log. `notes/events = None` nghĩa là schema nguồn chưa có section; `Some(0)` nghĩa là section có nhưng rỗng.

`BackupMergeCountsDto` chỉ đếm record có identity: project, custom profile, shortcut override, note và event. Settings singleton/default shell không làm tăng `inserts/updates/unchanged`; `removals` chỉ đếm local shortcut override bị bỏ khi thay section đầy đủ, còn env bị thay nằm trong một profile `update`. `projectPathMatches` là tập con của `updates`. `settingsDifferFromDefault` bao gồm Appearance/sidebar/default shell và, ở Phase 4, notification settings; General invariant không tham gia. `ResetResultDto.settingsReset` đúng khi ít nhất một giá trị trong nhóm này khác default ngay trước transaction.

## Contract Rust nội bộ

Data Management sở hữu consumer-side port dưới đây. Adapter ở `app/data_participants.rs` và `app/data_reset_participants.rs` triển khai port, chỉ gọi public maintenance API/type của source domain; source domain không import `settings::data` hoặc trait consumer. SQL/validation/cache vẫn do owner kiểm soát. Type backup nội bộ không derive `TS` và không đi qua IPC.

```rust
pub enum OwnedBackupSection {
    Projects(Vec<ProjectBackupRecordV1>),
    Settings(SettingsBackupSection),
    CliProfiles(CliProfilesBackupV1),
    KeyboardShortcuts(Vec<ShortcutOverride>),
    Notes(Vec<NoteBackupRecordV1>),
    Events(Vec<EventBackupRecordV1>),
}

pub struct SettingsBackupSection {
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
    pub notification_settings: Option<NotificationSettingsDto>,
}

pub enum ResetOnlyDomain {
    RecentFiles,
    Notifications,
    Reminders,
}

pub enum OwnedImportPlan {
    Projects(ProjectImportPlan),
    Settings(SettingsRestorePlan),
    CliProfiles(CliProfilesImportPlan),
    KeyboardShortcuts(ShortcutOverridesImportPlan),
    Notes(NotesImportPlan),
    Events(PreparedEventMerge),
}

pub enum OwnedCommittedProjection {
    Projects(ProjectCommittedProjection),
    Settings(SettingsCommittedProjection),
    CliProfiles(CliProfilesCommittedProjection),
    KeyboardShortcuts(KeyboardShortcutsCommittedProjection),
    Notes(NotesCommittedProjection),
    Events(CalendarMaintenanceProjection),
}

pub enum OwnedResetOnlyPlan {
    RecentFiles(RecentFilesResetPlan),
    Notifications(NotificationResetPlan),
    Reminders(ReminderResetPlan),
}

pub enum OwnedResetOnlyProjection {
    RecentFiles(RecentFilesResetProjection),
    Notifications(NotificationResetProjection),
    Reminders(ReminderResetProjection),
}

pub struct DataResetContext {
    pub reminder_baseline_ms: i64,
}

impl ProjectImportMap {
    /// Resolves one source project id to the effective target id in this import snapshot.
    pub fn resolve<'a>(&'a self, source_project_id: &str) -> Option<&'a str>;
}

pub trait DataBackupParticipant: Send + Sync {
    /// Returns the one domain variant owned by this adapter.
    fn domain(&self) -> BackupDomainDto;

    /// Exports this domain from the shared consistent SQLite snapshot.
    fn export(
        &self,
        tx: &rusqlite::Transaction<'_>,
        schema_version: u32,
    ) -> Result<Option<OwnedBackupSection>, DataManagementError>;

    /// Validates and plans a merge against the current transaction snapshot.
    fn prepare_import(
        &self,
        tx: &rusqlite::Transaction<'_>,
        package: &ParsedBackupPackage,
        project_map: Option<&ProjectImportMap>,
    ) -> Result<Option<OwnedImportPlan>, DataManagementError>;

    /// Applies a previously validated plan without opening a nested transaction.
    fn apply_import(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &OwnedImportPlan,
    ) -> Result<OwnedCommittedProjection, DataManagementError>;

    /// Deletes/resets this domain without opening a nested transaction.
    fn apply_reset(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<OwnedCommittedProjection, DataManagementError>;

    /// Publishes exactly one already prepared owner projection after commit.
    fn publish_after_commit(
        &self,
        change: DataChangeKindDto,
        committed: OwnedCommittedProjection,
    );
}

pub trait DataResetOnlyParticipant: Send + Sync {
    /// Returns the one reset-only domain variant owned by this adapter.
    fn domain(&self) -> ResetOnlyDomain;

    /// Builds an owned reset plan without changing durable or cached state.
    fn prepare_reset(
        &self,
        tx: &rusqlite::Transaction<'_>,
        context: &DataResetContext,
    ) -> Result<OwnedResetOnlyPlan, DataManagementError>;

    /// Applies the matching reset-only plan in the coordinator transaction.
    fn apply_reset(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &OwnedResetOnlyPlan,
    ) -> Result<OwnedResetOnlyProjection, DataManagementError>;

    /// Publishes exactly one already prepared owner projection after commit.
    fn publish_after_commit(&self, committed: OwnedResetOnlyProjection);
}
```

`SettingsBackupSection` chứa Appearance/sidebar và `Option<NotificationSettingsDto>` theo schema; `ResetOnlyDomain` có đúng ba variant `RecentFiles`, `Notifications`, `Reminders`. Mỗi tagged plan/projection bọc public owner type được nêu đúng tên ở trên; adapter kiểm tra variant khớp `domain()` và mismatch là lỗi lập trình được test, không deserialize thành type-erased JSON. Projects được gọi với `project_map = None`; plan Projects sở hữu `ProjectImportMap`. Map chứa mapping source import ID sang effective target ID sau ID/path collision và identity mapping cho project local hiện có trong snapshot; `resolve` trả `None` cho ID không thuộc hai tập đó, không lộ `path_key` hay map storage. Mọi participant sau đó bắt buộc nhận `Some(&project_map)`; adapter Notes/Events dùng resolver để tạo bản sao record đã remap trước khi gọi owner, còn adapter không có project link không đọc map. `None` từ export/prepare chỉ hợp lệ khi schema nguồn chưa có domain Notes/Events; section bắt buộc của schema hiện hành không được âm thầm bỏ qua.

Plan/projection là owned, `Send + 'static`, không chứa connection, transaction, row borrow, lock guard, secret value hoặc callback. Prepare thực hiện toàn bộ validation và dựng sẵn cache/revision projection; apply chỉ chạy SQL parameterized và trả projection kèm count đã tính, không thay cache. Nếu bất kỳ apply/commit nào lỗi, coordinator drop toàn bộ projection và không publish. Sau commit, `publish_after_commit` consume đúng variant, swap cache rồi gửi invalidation/subscription không-fail; Tauri emit là best-effort và không biến commit thành typed failure.

Public owner API mà adapter được phép gọi được chốt theo nhóm sau; hậu tố `_in` luôn nghĩa là dùng `&rusqlite::Transaction<'_>` do coordinator truyền vào và tuyệt đối không mở storage call khác:

| Owner | Public maintenance API tối thiểu |
|---|---|
| Projects | `ProjectImportMap::resolve`, `export_backup_records_in`, `prepare_backup_merge_in`, `apply_backup_merge_in`, `reset_projects_in`, `publish_data_change` |
| Settings | `export_persisted_settings_in`, `prepare_settings_restore_in`, `apply_settings_restore_in`, `reset_settings_in`, `publish_data_change` |
| CLI Profiles | `export_cli_profiles_in`, `prepare_cli_profiles_merge_in`, `apply_cli_profiles_merge_in`, `reset_cli_profiles_in`, `publish_data_change`, `retry_credential_cleanup` |
| Keyboard Shortcuts | `export_overrides_in`, `prepare_replace_overrides_in`, `apply_replace_overrides_in`, `reset_overrides_in`, `publish_data_change` |
| Notes | `export_notes_in`, `prepare_notes_merge_in`, `apply_notes_merge_in`, `reset_notes_in`, `publish_data_change` |
| Events | `export_events_in`, `prepare_event_merge_in`, `apply_event_merge_in`, `reset_events_in`, `publish_event_maintenance` |
| Recent Files | `prepare_recent_files_reset_in`, `reset_recent_files_in`, `publish_recent_files_reset` |
| Notifications | `prepare_notification_reset_in`, `reset_notifications_in`, `publish_notification_reset` |
| Reminders | `prepare_reminder_reset_in`, `reset_reminders_in`, `publish_reminder_reset` |

Mỗi `prepare_*` trả owner plan chứa row operation đã validate và committed projection tương ứng; mỗi `apply_*` chỉ nhận đúng plan owner. Method publish không nhận backup JSON, không query lại database và không trả `Result`; ví dụ `CalendarService::publish_event_maintenance` phải consume `CalendarMaintenanceProjection` thay vì query lại rồi có thể fail. API CRUD/IPC hiện hành của owner không đổi và vẫn là boundary cho thao tác thông thường.

App composition inject participant theo thứ tự cố định:

1. Projects (`BE-003`) dựng `ProjectImportMap`.
2. Settings (`BE-008`) cho Appearance/sidebar và notification settings khi v3.
3. CLI Profiles (`BE-006`).
4. Keyboard Shortcuts (`BE-009`).
5. Notes (`BE-016`, chỉ Phase 3+).
6. Events (`BE-018`, chỉ Phase 4+).

Reset apply theo thứ tự child-first cố định: Reminders → Notifications → Recent Files → Events → Notes → Keyboard Shortcuts → CLI Profiles → Settings → Projects. Publish sau commit theo thứ tự dependency-safe Projects → Settings → CLI Profiles → Keyboard Shortcuts → Notes → Events → Recent Files → Notifications → Reminders, rồi runtime mới resume. `storage/backup.rs` gọi tất cả callback bên trong đúng một `Storage::with_transaction`; adapter gọi owner maintenance method nhận transaction hiện hành, không gọi `with_connection`/`with_transaction` lồng nhau.

Composition root tạo đúng một gate trước mọi service, sau migration thành công mới dựng các `Arc<dyn DataBackupParticipant>`/`Arc<dyn DataResetOnlyParticipant>` và inject immutable registry vào `DataManagementService` cho toàn vòng đời app; không hot-register. Registry core luôn có Projects/Settings/CLI Profiles/Keyboard Shortcuts và Notifications reset-only; Phase 2 thêm Recent Files reset-only, Phase 3 thêm Notes, Phase 4 thêm Events và Reminders reset-only. Khi shutdown app thật, BE-001 sở hữu lifecycle; BE-012 không giữ participant hoặc permit qua lúc Storage đóng.

### Shared maintenance gate

Gate nằm ở `shared/maintenance.rs`, không thuộc Settings và không import capability nghiệp vụ:

```rust
#[derive(Clone)]
pub struct DataMaintenanceGate {
    inner: std::sync::Arc<tokio::sync::RwLock<()>>,
}

pub struct DataReadPermit(tokio::sync::OwnedRwLockReadGuard<()>);
pub struct DataWritePermit(tokio::sync::OwnedRwLockWriteGuard<()>);

impl DataMaintenanceGate {
    /// Acquires shared admission for one ordinary persistent mutation.
    pub async fn read_permit(&self) -> DataReadPermit;

    /// Acquires exclusive admission for one backup or reset maintenance snapshot.
    pub async fn write_permit(&self) -> DataWritePermit;
}
```

Mọi ordinary persistent mutation và session creation lấy `DataReadPermit` trước owner mutation lock/Storage, giữ đến sau commit và owner cache publish; read-only query không cần permit. Nhiều read permit được chạy đồng thời, còn owner mutation lock và Storage vẫn serialize phạm vi riêng. Export/prepare-import lấy `DataWritePermit` chỉ đến khi snapshot/plan hoàn tất; serialize, picker và file I/O không giữ permit. Confirm-import giữ write permit qua revalidate → transaction → commit → publish. Confirm-reset giữ write permit qua runtime quiesce async → transaction → commit/rollback → publish/resume để không có session hoặc persistent mutation chen vào.

Thứ tự lock bắt buộc là `DataMaintenanceGate` → owner mutation lock → Storage connection/transaction; không callback `_in` nào lấy lại gate/owner lock/Storage. Read/write permit là owned Tokio guard `Send` và là loại guard duy nhất được giữ trong async task khi await bounded `spawn_blocking` database work hoặc `DataRuntimeControl`; SQLite transaction vẫn sống trọn trong closure blocking. Không giữ `tauri::State` borrow, owner mutex, Storage connection hoặc SQLite transaction qua `.await`. Runtime cleanup path là gate-free để tránh self-deadlock.

### Async runtime control

```rust
pub type DataRuntimeFuture<'a, T> =
    std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send + 'a>>;

pub struct DataRuntimeImpact {
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

pub enum DataResetCompletion {
    Committed,
    Aborted,
}

pub trait DataRuntimeControl: Send + Sync {
    /// Returns a current reset impact through public runtime owners.
    fn impact<'a>(
        &'a self,
    ) -> DataRuntimeFuture<'a, Result<DataRuntimeImpact, DataManagementError>>;

    /// Quiesces workers and closes every current session without exiting XWork.
    fn shutdown_for_reset<'a>(
        &'a self,
    ) -> DataRuntimeFuture<'a, Result<(), DataManagementError>>;

    /// Reopens already prepared worker gates and wakes reconciliation.
    fn resume_after_reset(&self, completion: DataResetCompletion);
}
```

`app/data_runtime.rs` triển khai trait object-safe bằng `Box::pin(async move { ... })`; không dùng `block_on`, runtime lồng hoặc blocking task cho async owner API. `impact` dùng cùng snapshot composer với `AppRuntime::quit_summary`; `SessionManager::shutdown_impact` phải gồm `unsaved_file_count` do `PaneContentRuntime` của BE-014 aggregate. `shutdown_for_reset` lần lượt quiesce Reminder scheduler BE-019, pause worker/intake dispatch BE-011 nhưng vẫn giữ queue, rồi await `SessionManager::shutdown_all`; manager đóng Terminal và delegate file buffer/watcher cleanup sang BE-014, nên adapter không đóng file lần hai. Đây không phải `AppRuntime::shutdown_for_quit`: app/window/Storage vẫn sống.

Owner lifecycle bổ sung đúng các signature sau; `NotificationFuture` và `ReminderFuture` là boxed-future alias hiện hữu của BE-011/019:

```rust
impl NotificationService {
    /// Quiesces database work while retaining the internal source queue.
    pub fn pause_for_reset(
        &self,
    ) -> NotificationFuture<'_, Result<(), NotificationError>>;

    /// Reopens intake and wakes queued source reconciliation without failure.
    pub fn resume_after_reset(&self, committed: bool);
}

impl ReminderService {
    /// Quiesces timers and in-flight delivery work without closing the service.
    pub fn pause_for_reset(
        &self,
    ) -> ReminderFuture<'_, Result<(), ReminderError>>;

    /// Reopens timers and wakes calendar/settings/notification reconciliation.
    pub fn resume_after_reset(&self, committed: bool);
}
```

Pause chuẩn bị sẵn handle resume, đóng admission của worker trước rồi dừng in-flight DB work/timer nhưng giữ hàng đợi invalidation. Worker lấy read permit trong nhánh `select!` cancellation-safe; nếu đang chờ permit vì reset đã giữ write permit, pause signal hủy future chờ thay vì deadlock. Pause/resume không query database và không lấy gate. Nếu cleanup lỗi giữa chừng, adapter tự resume mọi worker đã pause trước khi trả `RuntimeCleanupFailed`. Sau cleanup thành công, coordinator luôn gọi `resume_after_reset`: `Committed` map thành `true` sau publish reset, `Aborted` map thành `false` sau rollback/apply failure; session đã đóng không được dựng lại. Resume mở intake/timer và wake reconcile queued state.

## Tauri command

Mọi command chỉ nhận invocation từ window label `main`. Command native/file/database chạy trong blocking task; command layer không chứa business rule.

### `get_data_location`

Trả vị trí app data đã resolve từ Tauri.

```rust
/// Returns the application data location for display.
#[tauri::command]
pub async fn get_data_location(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DataManagementService>,
) -> Result<DataLocationDto, DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; không có path input |
| Side effect | Bảo đảm app-data directory tồn tại; không đọc nội dung database/log |
| Lỗi trả về | `UnauthorizedWindow`, `DataLocationUnavailable` |

### `open_data_location`

Mở app-data directory bằng file manager mặc định.

```rust
/// Opens the application data directory in the system file manager.
#[tauri::command]
pub async fn open_data_location(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DataManagementService>,
) -> Result<(), DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; directory phải là app-data path backend đã resolve |
| Side effect | Gọi official opener từ Rust; không mở path do frontend cung cấp |
| Lỗi trả về | `UnauthorizedWindow`, `DataLocationUnavailable`, `OpenLocationFailed` |

### `copy_data_location`

Sao chép app-data path vào clipboard hệ điều hành.

```rust
/// Copies the application data directory to the system clipboard.
#[tauri::command]
pub async fn copy_data_location(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DataManagementService>,
) -> Result<(), DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; không nhận text/path từ frontend |
| Side effect | Ghi đúng path đã resolve vào clipboard qua adapter Rust |
| Lỗi trả về | `UnauthorizedWindow`, `DataLocationUnavailable`, `ClipboardWriteFailed` |

### `export_backup`

Mở native save dialog và ghi snapshot backup hiện hành atomically.

```rust
/// Exports a versioned local backup selected through the native dialog.
#[tauri::command]
pub async fn export_backup(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DataManagementService>,
) -> Result<BackupExportOutcomeDto, DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; native filter chỉ gợi ý `.xwork-backup.json`; destination là kết quả picker, không là IPC input |
| Side effect | Đọc consistent snapshot; serialize JSON; ghi temp sibling, flush/sync và atomic replace destination; cleanup temp tốt nhất có thể |
| Lỗi trả về | `UnauthorizedWindow`, `OperationInProgress`, `SnapshotFailed`, `BackupTooLarge`, `SerializeFailed`, `FileWriteFailed` |

Cancel native dialog trả `Cancelled`, không phải lỗi và không tạo file. Picker chịu trách nhiệm hỏi overwrite theo OS. Command không trả absolute destination, chỉ `fileName` an toàn để FE thông báo thành công.

### `prepare_import_backup`

Mở native open dialog, parse/validate file và trả preview merge trước khi commit.

```rust
/// Selects, validates, and prepares one backup import preview.
#[tauri::command]
pub async fn prepare_import_backup(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DataManagementService>,
) -> Result<PrepareBackupImportOutcomeDto, DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; regular file tối đa 128 MiB; valid UTF-8 JSON; format/version/field/domain rules hợp lệ; mọi count fit `u32` |
| Side effect | Đọc file được picker chọn; không đọc credential store; giữ package đã parse/validated và fingerprint DB trong memory tối đa 10 phút |
| Lỗi trả về | `UnauthorizedWindow`, `OperationInProgress`, `FileReadFailed`, `BackupTooLarge`, `InvalidBackup`, `UnsupportedBackupVersion`, `DomainValidationFailed`, `PersistenceFailed` |

Cancel picker trả `Cancelled`. Chỉ một pending import/reset tồn tại. `requestId` là counter `u32` wrap bằng cách bỏ `0` và ID đang active; TTL dùng monotonic clock. Hết hạn xóa plan khỏi memory.

### `confirm_import_backup`

Revalidate preview với state mới nhất và commit merge atomically.

```rust
/// Commits the prepared backup merge when its preview is still current.
#[tauri::command]
pub async fn confirm_import_backup(
    window: tauri::WebviewWindow,
    request_id: u32,
    state: tauri::State<'_, DataManagementService>,
) -> Result<BackupImportResultDto, DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; request khác `0`, đúng pending kind/ID, chưa hết hạn; DB fingerprint và merge summary vẫn khớp preview |
| Side effect | Một transaction merge mọi section; cache swap/subscription sau commit; enqueue credential cũ; phát một `data://changed`; thử cleanup credential ngoài transaction |
| Lỗi trả về | `UnauthorizedWindow`, `NoPendingOperation`, `StaleRequest`, `ImportPreviewChanged`, `DomainValidationFailed`, `PersistenceFailed` |

Nếu dữ liệu đổi sau preview, command không commit, thay pending preview bằng kế hoạch/count mới và trả `ImportPreviewChanged { preview }`; FE hiển thị lại confirmation. Double-confirm/stale ID không chạy transaction hai lần.

### `prepare_reset_xwork`

Chụp impact hiện tại và cấp request xác nhận reset.

```rust
/// Creates a reset confirmation request from current persistent and runtime impact.
#[tauri::command]
pub async fn prepare_reset_xwork(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DataManagementService>,
) -> Result<ResetImpactDto, DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; không có operation khác đang apply |
| Side effect | Đọc count bền vững và runtime; giữ pending request 10 phút; không dừng/xóa gì |
| Lỗi trả về | `UnauthorizedWindow`, `OperationInProgress`, `RuntimeUnavailable`, `PersistenceFailed` |

Phase chưa có Notes/Events trả count `0`. `sessions`, `runningProcesses`, `unsavedDocuments` lấy từ runtime summary hiện hành, không từ SQLite.

### `confirm_reset_xwork`

Dừng runtime và reset dữ liệu sau xác nhận literal.

```rust
/// Stops runtime and resets XWork data after explicit typed confirmation.
#[tauri::command]
pub async fn confirm_reset_xwork(
    window: tauri::WebviewWindow,
    request_id: u32,
    confirmation: String,
    state: tauri::State<'_, DataManagementService>,
) -> Result<ResetResultDto, DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; đúng pending reset ID/chưa hết hạn; `confirmation.trim()` bằng chính xác, phân biệt hoa thường, `RESET` |
| Side effect | Recount current state; dừng toàn bộ runtime; một transaction reset domain; cache về default; phát `data://changed`; retry credential cleanup |
| Lỗi trả về | `UnauthorizedWindow`, `NoPendingOperation`, `StaleRequest`, `InvalidResetConfirmation`, `RuntimeCleanupFailed`, `PersistenceFailed` |

Confirm áp lên state thực tế tại thời điểm chạy, kể cả object tạo sau preview, giống invariant quit của BE-001. Count preview chỉ để cảnh báo; typed `RESET` xác nhận toàn bộ scope nên không yêu cầu dialog thứ hai khi count đổi. Nếu runtime cleanup lỗi, dữ liệu bền vững chưa bị reset; một số runtime đã dừng có thể không khôi phục được và FE phải nói rõ để retry.

### `cancel_data_operation`

Hủy pending import/reset chưa apply.

```rust
/// Cancels one pending data operation without changing user data.
#[tauri::command]
pub async fn cancel_data_operation(
    window: tauri::WebviewWindow,
    request_id: u32,
    state: tauri::State<'_, DataManagementService>,
) -> Result<(), DataManagementError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller là `main`; request đúng pending ID và chưa chuyển sang Applying |
| Side effect | Xóa package/plan/preview khỏi memory; không chạm database/file nguồn |
| Lỗi trả về | `UnauthorizedWindow`, `NoPendingOperation`, `StaleRequest`, `OperationInProgress` |

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `data://changed` | `DataChangedEventDto` | Thử phát một lần sau import/reset đã commit và mọi owner cache được publish | Chỉ window `main`; không phát khi cancel/validation/rollback; event có thể đến trước response. Emit lỗi được log an toàn nhưng không đổi command thành failure vì database đã commit |

Settings/Keyboard Shortcuts không phát Tauri event riêng. Maintenance publish thay cache rồi gọi `watch::Sender::send_replace` để consumer nội bộ nhận qua `SettingsService::subscribe()` (Phase 4) và `KeyboardShortcutsService::subscribe()` (Phase 3), tối đa một snapshot mỗi owner sau commit. Owner có event Tauri thật trong contract riêng như Notes/Events vẫn phát tối đa một aggregate invalidation. FE-015 chỉ dùng `data://changed` để invalidate toàn bộ query màn hình; không suy ra record cụ thể từ event.

## Business rule và invariant

1. Export hiện hành luôn dùng schema cao nhất binary hỗ trợ; schema `1/2/3` bất biến sau phát hành. `schemaVersion` độc lập migration version.
2. Parser từ chối format khác `xwork-backup`, version `0`/mới hơn, JSON trailing data, duplicate key, unknown field, giá trị không đúng type và mọi violation domain trước khi ghi database. `appVersion` dài 1–64 scalar, không chứa control character; `fileName` trả frontend được lấy từ final component, loại control character và cap 255 scalar.
3. File import tối đa 128 MiB; JSON depth dùng giới hạn mặc định an toàn của parser, string/count còn phải qua giới hạn owner. Không allocate theo count không giới hạn từ input.
4. Backup không chứa source project, session/tab/pane, terminal output/history, recent files, file buffer, log, notification inbox hoặc reminder delivery state.
5. Plaintext secret không đi vào backup, SQLite, DTO, event, error, tracing hoặc crash context. Export không gọi credential read; chỉ metadata `credential_account` đã có trong DB được serialize.
6. Project import giữ incoming ID khi không conflict. Nếu incoming `path_key` trùng project local ID khác, dùng project local làm canonical, giữ metadata local và remap note/event link incoming sang ID local; không tạo duplicate folder.
7. Nếu cùng project ID nhưng path khác, incoming metadata thắng sau canonicalization. Trường hợp cùng một incoming record đồng thời match local A theo ID và local B theo path bị từ chối thay vì gộp hai project. Nếu path không tồn tại, owner yêu cầu absolute path không NUL, chuẩn hóa key theo OS từ stored path và restore project unavailable; import không yêu cầu source có mặt.
8. Record domain cùng ID dùng incoming value sau validation; record local không có trong package được giữ. Với từng Note/Event record, app adapter clone record, thay `project_id` bằng `record.project_id.as_deref().and_then(|id| project_map.resolve(id)).map(str::to_owned)`, rồi mới gọi public owner prepare API. Vì vậy owner chỉ nhận target ID đã remap; dangling incoming project ID không có trong package/local trở thành `None`, không tạo FK giả hoặc phụ thuộc Projects internals.
9. Import section settings thay Appearance/sidebar; schema v3 thay notification settings. General invariants và revision không import; revision owner tăng đúng một cho transaction restore.
10. Import CLI section thay default shell và merge custom profile theo ID. Built-in không thể xuất/ghi đè. Tổng custom profile sau dedupe không vượt giới hạn BE-006. Shell ID không tồn tại trên OS đích được map về `system` cho default và `None` cho profile override; command availability được tính lại, không tin trạng thái máy nguồn.
11. Với secret env trùng profile/name, giữ `credential_account` local đang có thay vì ghi đè bằng reference backup. Secret env mới giữ incoming reference; nếu credential không tồn tại, profile vẫn restore nhưng launch trả `SecretNotFound` và yêu cầu nhập lại. Không tự tạo secret rỗng.
12. Một incoming credential reference đã thuộc secret env local khác identity bị từ chối `DomainValidationFailed`; không alias một secret cho hai biến. Reference local bị loại do profile merge/reset được enqueue vào `credential_cleanup_queue` trong cùng transaction.
13. Shortcut section thay toàn bộ override bằng candidate import; action lạ, duplicate action hoặc chord không hợp lệ bị từ chối. Conflict hợp lệ vẫn import và được BE-009 project lại; version cũ không chứa action phase sau nên action local phase sau được giữ bằng default, không bằng override cũ.
14. Import v1 vào binary v2/v3 không thay Notes/Events/notification settings. Import v2 vào binary v3 không thay Events/notification settings. Section hiện diện nhưng rỗng vẫn là dữ liệu hợp lệ và merge không xóa record local.
15. Export snapshot và import/reset database change là nguyên tử. Mọi `_in` API chạy trong đúng transaction coordinator truyền, không lấy permit/owner lock/storage lồng; plan/projection không giữ borrowed state và không cache/event nào đổi trước commit.
16. Ordinary persistent mutation/session creation giữ read permit đến sau owner commit/cache publish. Export/prepare-import/confirm-import/reset giữ write permit đúng phạm vi đã chốt; picker/parse/serialize/file I/O/credential cleanup không giữ permit.
17. Reset yêu cầu pending request và literal `RESET`; Cancel, close dialog, request hết hạn, stale ID hoặc double-confirm không dừng runtime/xóa dữ liệu.
18. Reset pause Reminder/Notification worker, dừng/force-terminate process và đóng toàn bộ session content qua BE-005; BE-014 giải phóng file buffer/watcher qua `PaneContentRuntime`. App không exit, main window và Storage vẫn mở; không gọi true-Quit API.
19. Reset transaction xóa project/custom profile/override/note/event và reset singleton settings/default shell về default. Participant reset-only bắt buộc theo phase xóa Recent Files (Phase 2), Notifications (Phase 1) và Reminder delivery/checkpoint (Phase 4); chúng không được thêm vào backup envelope.
20. Reset không xóa built-in profile, migration, database file, cleanup queue, logs hoặc source project. Database lỗi sau runtime cleanup rollback toàn bộ dữ liệu, publish không chạy, worker resume với `Aborted`; runtime session đã dừng nhưng retry vẫn an toàn.
21. Credential delete chỉ chạy sau commit. Failure không rollback import/reset; queue giữ reference, worker BE-006 retry ở startup/sau mutation và log tối đa account hash.
22. Cache projection được dựng trước/trong apply, giữ owned đến commit rồi swap không-fail theo publish order. Settings/Keyboard Shortcuts notify internal `subscribe()` receiver, Notes/Events dùng owner invalidation thật; cuối cùng worker resume rồi BE-012 thử phát `data://changed`. Poison/panic là lỗi nội bộ fatal làm app restart, không phải typed failure giả rằng transaction chưa commit; không chạy transaction bù mạo hiểm.
23. Native picker là nguồn duy nhất của import/export path. Frontend không nhận API đọc/ghi path tùy ý; open/copy location luôn dùng app-data path backend resolve.
24. Không log backup path, JSON content, project path/name, note/event/profile/env name hoặc credential account. Chỉ log operation kind, schema version, count, duration và error category an toàn.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
pub enum DataManagementError {
    UnauthorizedWindow,
    OperationInProgress,
    NoPendingOperation,
    StaleRequest,
    InvalidResetConfirmation,
    DataLocationUnavailable,
    OpenLocationFailed,
    ClipboardWriteFailed,
    FileReadFailed,
    FileWriteFailed,
    BackupTooLarge,
    InvalidBackup,
    UnsupportedBackupVersion { found: u32, supported: u32 },
    SerializeFailed,
    SnapshotFailed,
    DomainValidationFailed { domain: BackupDomainDto },
    ImportPreviewChanged { preview: BackupImportPreviewDto },
    RuntimeUnavailable,
    RuntimeCleanupFailed,
    PersistenceFailed,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Window khác `main` gọi command | Không retry; sửa caller boundary |
| `OperationInProgress` | Có apply/file operation xung đột hoặc cancel khi đang apply | Disable action song song, chờ operation hiện hành |
| `NoPendingOperation` | Không có preview/pending request | Đóng confirmation và chuẩn bị lại |
| `StaleRequest` | ID/kind sai hoặc TTL 10 phút đã hết | Chuẩn bị lại để có preview mới |
| `InvalidResetConfirmation` | Text sau trim khác chính xác `RESET` | Giữ dialog, chỉ bật Reset khi đúng literal |
| `DataLocationUnavailable` | Không resolve/tạo được app-data directory | Hiển thị lỗi Data location và cho retry |
| `OpenLocationFailed` | File manager không mở được directory | Vẫn cho copy path và retry |
| `ClipboardWriteFailed` | OS clipboard không ghi được | Giữ text selectable và cho copy thủ công |
| `FileReadFailed` | Không mở/đọc được file picker đã chọn | Cho chọn lại; không hiển thị absolute path |
| `FileWriteFailed` | Temp write/sync/replace thất bại | Báo export chưa hoàn thành; destination cũ không bị truncate |
| `BackupTooLarge` | Import >128 MiB hoặc export vượt cap | Không parse/ghi tiếp; giải thích giới hạn |
| `InvalidBackup` | Format/JSON/shape/header/duplicate/unknown field sai | Từ chối toàn bộ file và cho chọn backup khác |
| `UnsupportedBackupVersion` | Version `0` hoặc lớn hơn binary hỗ trợ | Yêu cầu cập nhật XWork; không thử partial import |
| `SerializeFailed` | Internal export record không serialize được | Không thay destination; báo lỗi chung/restart |
| `SnapshotFailed` | Participant không dựng được snapshot nhất quán | Không tạo backup; cho retry |
| `DomainValidationFailed` | Một section vi phạm rule owner hoặc credential collision | Nêu domain lỗi, không import phần còn lại |
| `ImportPreviewChanged` | DB đổi giữa preview và confirm | Hiển thị preview mới và yêu cầu confirm lại |
| `RuntimeUnavailable` | Không lấy được impact runtime | Không mở reset dialog; cho retry |
| `RuntimeCleanupFailed` | Không dừng sạch runtime trước reset | Không reset persistent data; cảnh báo một phần runtime có thể đã dừng |
| `PersistenceFailed` | Storage query/transaction/commit lỗi | Không báo thành công; transaction rollback |

`BackupDomainDto` là enum public `projects`, `settings`, `cli_profiles`, `keyboard_shortcuts`, `notes`, `events`. Public error không chứa raw I/O/SQLite/Serde/keyring error hoặc user content.

## Luồng chính

### Export

1. FE-015 gọi `export_backup`; backend xác thực `main`, bảo đảm không có operation apply và mở native save dialog.
2. Khi có destination, async service await write permit trước, rồi await một blocking task mở `Storage::with_transaction` và gọi participant export đúng phase. Transaction chỉ đọc nhưng dùng boundary hiện hành của BE-002 để có một snapshot; nhả transaction/permit trước serialize/file I/O, không `block_on` để lấy gate.
3. Service validate aggregate count/size, serialize schema cao nhất và ghi vào sibling temp file tạo bằng `create_new` với tên random.
4. Adapter flush/sync file rồi atomic replace destination. Nếu lỗi, destination cũ giữ nguyên và temp được cleanup tốt nhất có thể.
5. Trả file name/schema/count; không phát event vì app data không đổi.

### Import merge

1. FE gọi prepare; picker trả file hoặc Cancelled. Backend kiểm size trước đọc toàn bộ, parse strict theo header/version và validate từng section.
2. Service await write permit ngắn, rồi trong blocking transaction chỉ-đọc gọi Projects với `project_map = None` để tạo identity/path map. Participant adapter khác nhận `Some(&project_map)`; Notes/Events clone typed record, resolve từng optional source project ID sang owned target ID và truyền bản sao đã remap vào owner prepare API, rồi owner dựng immutable plan theo state local. Không đọc credential store trong prepare và nhả permit trước khi trả preview.
3. Service giữ parsed package, plan, DB fingerprint và preview trong memory; FE hiển thị count, overwrite/path-match và cảnh báo rằng secret reference có thể cần nhập lại trên máy đích, rồi yêu cầu Confirm import.
4. Confirm await write permit, recompute plan trong snapshot mới nhất. Nếu fingerprint/summary đổi, không ghi, nhả permit và trả preview mới.
5. Nếu ổn định, cùng `Storage::with_transaction` gọi apply Projects → Settings → CLI Profiles → Shortcuts → Notes → Events. Bất kỳ lỗi nào rollback toàn bộ, không cache/event/credential cleanup.
6. Commit xong, participant consume committed projection theo publish order, cập nhật internal subscription/owner invalidation rồi BE-012 phát `data://changed`. Service nhả write permit, thử cleanup credential queue và trả result dù cleanup còn pending.

### Reset

1. FE gọi prepare và hiển thị count project/note/event/custom profile, theme/shortcut warning cùng sessions/running process/unsaved count; input xác nhận mặc định trống.
2. Confirm chỉ qua khi request hợp lệ và text là `RESET`. Service await write permit, await runtime impact mới nhất rồi await `shutdown_for_reset`; không mở SQLite transaction trước khi cleanup thành công và không dùng `block_on`.
3. Trong một blocking transaction, reset participant đúng child-first order, enqueue credential bị loại, đưa Settings/default shell/shortcuts về default và giữ cleanup queue/schema. Apply lỗi rollback, drop projection và gọi `resume_after_reset(Aborted)` trước khi trả lỗi.
4. Commit xong, publish projection theo dependency-safe order, gọi `resume_after_reset(Committed)`, rồi thử phát một `data://changed { kind: app_reset }`; FE điều hướng về Welcome/Home trống và đóng dialog.
5. Credential cleanup chạy sau gate/commit, có thể retry. Source project, database file và logs không bị xóa.

## Ràng buộc kỹ thuật

- Blocking: Native dialog/file I/O, rusqlite transaction, filesystem sync/opener/clipboard và keyring lookup/cleanup chạy ngoài async worker bằng `tauri::async_runtime::spawn_blocking` hoặc API plugin async thích hợp. Service clone state trước await; read/write permit Tokio có thể được giữ khi await bounded blocking job/runtime control, nhưng không `block_on` và không giữ owner mutex, connection hoặc transaction qua `.await`.
- Bảo mật: Chỉ `main`; không path input từ IPC; strict JSON/cap 128 MiB; no ZIP; no secret plaintext; redacted error/log; không upload/network. Symlink file được picker chọn chỉ được đọc như đúng một regular file, không duyệt directory.
- Hiệu năng: Preview/export database snapshot mục tiêu dưới 500 ms với giới hạn domain; file serialize/write streaming hoặc buffer có cap 128 MiB. Progress UI có thể spinner không phần trăm; không thêm progress channel khi không có đo lường chính xác.
- Concurrency: Một pending import/reset và một apply tại một thời điểm; export không chạy đồng thời apply. Persistent mutation/session creation dùng read permit, maintenance dùng write permit; mọi owner `_in` path và runtime reset path không re-enter gate. Request TTL dùng monotonic clock.
- Atomicity: Temp+sync+replace cho export; một SQLite transaction cho import/reset. OS credential cleanup là outbox sau commit vì không thể chung transaction SQLite.
- Desktop boundary: Official dialog/opener/clipboard chỉ được gọi từ Rust sau command authorization, nên không thêm ACL plugin cho webview và không cấp filesystem/clipboard API trực tiếp. Tauri build Windows bắt buộc do thay command/plugin/desktop boundary.

## Tiêu chí hoàn thành

- [ ] Export v1 tạo đúng một JSON UTF-8 strict/atomic từ consistent snapshot Projects, custom CLI Profiles/default shell, Appearance/sidebar và shortcut overrides; không có source/session/output/history/secret value.
- [ ] Import Cancel không side effect; invalid/oversize/newer version bị từ chối trước write; v1 merge atomically và giữ record local không có trong package.
- [ ] Project duplicate path remap deterministic, unavailable path vẫn restore, path-key không đi trong file; `ProjectImportMap::resolve` trả target snapshot đúng và adapter truyền bản sao Notes/Events đã remap cho owner.
- [ ] Secret collision/preserve/missing-reference và cleanup queue đúng invariant; search toàn file/DTO/error/log test không tìm thấy plaintext fixture.
- [ ] Settings/shortcut section dùng validation/default của BE-008/009, không ghi General invariant/revision/default shortcut/conflict projection vào backup.
- [ ] Reset chỉ chạy với pending request + literal `RESET`, async quiesce BE-019/011 và cleanup BE-005/014 trước transaction, reset đúng domain/default rồi resume worker; không `block_on` và không xóa source/database/migration/log.
- [ ] Shared read/write permit chặn mutation/session chen vào maintenance, không deadlock/re-enter; transaction failure không publish/đổi cache, commit publish đúng order rồi phát tối đa một `data://changed`; stale/double confirm không chạy lần hai.
- [ ] Data location/open/copy chỉ dùng app-data path backend resolve; frontend không có arbitrary path API.
- [ ] Phase 3 bump schema v2 và bắt buộc Notes section; Phase 4 bump v3 và bắt buộc Events/notification settings; compatibility v1/v2 giữ domain không hiện diện.
- [ ] Phase 4 chỉ khởi tạo Events/Reminders/notification-settings participant sau registry đã chạy bắt buộc `0008_create_calendar_events.sql` → `0009_create_reminder_deliveries.sql` → `0010_add_notification_settings.sql`.
- [ ] Binding aggregate sinh từ Rust và contract test phát hiện drift; mọi function/method/callback/helper/test mới có comment ngắn theo AGENTS.md.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features`, formatter/linter/typecheck/test frontend liên quan và `pnpm tauri build` đều pass.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/settings/data.rs` (`#[cfg(test)]`) | Unit | Header/version/strict JSON/duplicate/unknown/trailing; size/count/TTL/request state; preview fingerprint; filename; error redaction |
| `src-tauri/src/settings/data_participant.rs` (`#[cfg(test)]`) | Unit | Tagged variant/domain mismatch, participant apply/publish order, `ProjectImportMap::resolve`, clone/remap Notes/Events trước owner, dangling link, reset-only plan, missing section compatibility và projection ownership |
| `src-tauri/src/shared/maintenance.rs` (`#[cfg(test)]`) | Unit | Read permit đồng thời, write permit độc quyền/fair, lock order và không re-entry/deadlock |
| `src-tauri/src/app/data_runtime.rs` (`#[cfg(test)]`) | Unit | Boxed future chạy async không `block_on`, pause/resume order, partial-cleanup resume và BE-014 cleanup chỉ qua BE-005 router |
| `src-tauri/src/platform/data.rs` (`#[cfg(test)]`) | Unit | Picker cancel, filter, temp create/sync/atomic replace/cleanup, app-data-only open/copy qua fake adapter |
| `src-tauri/tests/data_management_contract.rs` | Integration | V1 round-trip, cross-domain one-transaction rollback, merge collision, credential reference/redaction/outbox, gate với concurrent mutation/session, async runtime cleanup/reset, owner subscribe/publish và `data://changed` |
| `src-tauri/tests/export_bindings.rs` | Contract | Sinh toàn bộ DTO/error BE-012 và fail khi `src/bindings/data-management.ts` lệch Rust source |
| `src-tauri/tests/app_builder.rs` | Integration | Builder manage service/gate, inject đúng participant theo phase, đăng ký command/plugin và xác nhận không mở ACL webview mới |

Integration test dùng temp app-data/database/project và fake dialog/opener/clipboard/keyring/runtime; không đọc/xóa app data, credential hoặc source project thật. File fixture secret dùng canary riêng và test quét bytes backup, serialized DTO, event/error/tracing capture. Test atomic file không dựa vào rename xuyên volume. Phase 3/4 bổ sung golden fixture v2/v3 và compatibility v1→v2/v3, v2→v3 trong lát cắt owner; macOS validation hoãn đến release preparation.

## Câu hỏi mở

- Không có.
