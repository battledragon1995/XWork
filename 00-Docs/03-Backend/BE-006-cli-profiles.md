# BE-006 — CLI profiles

Tài liệu này đặc tả hợp đồng backend cho profile CLI dựng sẵn và tùy chỉnh, lựa chọn shell, kiểm tra khả dụng và lưu biến môi trường nhạy cảm.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-006` |
| Phase | `1` |
| Capability | `src-tauri/src/terminal/` |
| Yêu cầu chức năng | §10.2–10.3, §17.3 |
| Frontend liên quan | `FE-006`, `FE-013` |
| Phụ thuộc | `BE-002`, `BE-003`, `BE-008` |

## Mục tiêu

Backend cung cấp ba profile dựng sẵn Codex, Claude và Terminal; CRUD profile tùy chỉnh; shell mặc định chung và shell riêng theo profile; trạng thái khả dụng dựa trên việc tìm thấy command và shell. Cấu hình profile được lưu trong SQLite, còn giá trị environment variable được đánh dấu nhạy cảm chỉ được lưu trong OS credential store.

### Ngoài phạm vi

- Không tạo PTY, không khởi chạy command và không quản lý vòng đời tiến trình; `BE-007` nhận launch spec có cấu trúc rồi thực hiện các việc đó.
- Không chọn working directory. `BE-003` sở hữu project root và `BE-007` luôn dùng root đó khi launch.
- Không sở hữu trạng thái session, danh sách “Recently used” hoặc tool selection; `BE-005` sở hữu các trạng thái này và chỉ tra cứu profile qua public interface của BE-006.
- Không cho sửa hoặc xóa ba profile dựng sẵn; chỉ profile tùy chỉnh có CRUD.
- Không cho frontend đọc trực tiếp database, credential store, `PATH` hoặc filesystem.
- Không điều phối file/envelope/preview backup trong feature này. BE-006 sở hữu typed record/plan/projection và `_in` API để `BE-012` xuất/merge/reset metadata; tuyệt đối không xuất giá trị secret.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo `keyring`, `uuid` và `zeroize` theo phiên bản tương thích lockfile. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust được Cargo sinh; không sửa tay. |
| `src-tauri/src/lib.rs` | Export module `platform` và `terminal` để app composition sử dụng. |
| `src-tauri/src/app/mod.rs` | Khởi tạo `CliProfilesService`, đăng ký managed state, command, startup availability check và cleanup credential tồn đọng. |
| `src-tauri/src/app/data_participants.rs` | Adapter typed CLI Profiles participant của BE-012, không đọc table/cache nội bộ. |
| `src-tauri/src/terminal/mod.rs` | Export DTO, command và public query/launch contract thuộc capability terminal. |
| `src-tauri/src/terminal/cli_profiles.rs` | Profile dựng sẵn, CRUD, validation, persistence, availability cache, event revision và launch-spec resolution. |
| `src-tauri/src/platform/mod.rs` | Export các OS adapter cho command, shell và credential store. |
| `src-tauri/src/platform/command.rs` | Tìm executable theo absolute path hoặc `PATH`/`PATHEXT` mà không chạy command. |
| `src-tauri/src/platform/shell.rs` | Catalog shell theo hệ điều hành, quy tắc resolve `system` và dữ liệu shell có cấu trúc cho BE-007. |
| `src-tauri/src/platform/credential.rs` | Adapter `keyring`, service name, thao tác ghi/đọc/xóa secret và fake port cho test. |
| `src-tauri/src/storage/migrations.rs` | Đăng ký migration version 3 sau version 1 của BE-003 và version 2 của BE-008. |
| `src-tauri/migrations/0003_create_cli_profiles.sql` | Tạo schema settings, custom profile, environment metadata và hàng đợi dọn credential. |
| `src-tauri/tests/export_bindings.rs` | Đăng ký và kiểm tra DTO/event/error BE-006 trong luồng sinh TypeScript binding chung. |
| `src/bindings/terminal/` | Binding TypeScript được sinh từ Rust cho capability terminal; không sửa tay. |
| `src-tauri/tests/cli_profiles_contract.rs` | Integration test migration, command boundary, persistence, event và redaction của secret. |
| `src-tauri/tests/data_management_contract.rs` | Contract test maintenance permit, typed plan/projection, shared transaction và cleanup outbox. |
| `src-tauri/tests/cli_profiles_windows.rs` | Windows integration test cho `PATH`/`PATHEXT`, shell discovery và Windows Credential Manager với credential tạm. |
| `src-tauri/tests/app_builder.rs` | Smoke test app builder đăng ký đủ command và managed state BE-006. |
| `tests/e2e/settings-cli-profiles.e2e.ts` | E2E mocked-IPC cho Settings Terminal & CLI Profiles và trạng thái tool unavailable. |

## Dữ liệu

Ba profile dựng sẵn là hằng số trong Rust và không có row trong SQLite:

| ID ổn định | Tên | Command | Icon | Màu | Hành vi shell |
|---|---|---|---|---|---|
| `builtin:codex` | `Codex` | `codex` | `Cx` | `#10a37f` | Dùng shell mặc định chung. |
| `builtin:claude` | `Claude` | `claude` | `Cl` | `#d97757` | Dùng shell mặc định chung. |
| `builtin:terminal` | `Terminal` | Không có command CLI riêng | `>_` | `#64748b` | Mở shell mặc định chung ở chế độ interactive. |

ID profile là opaque đối với consumer. Profile tùy chỉnh dùng `profile-` nối UUID v4 dạng lowercase có dấu gạch ngang; toàn ID dài 44 ký tự, backend tự sinh và frontend không được cung cấp ID.

Catalog shell tối thiểu theo platform:

| OS | Shell ID | Tên hiển thị | Command candidate | Ghi chú |
|---|---|---|---|---|
| Windows | `system` | `System default` | Candidate đầu tiên resolve được theo policy fallback | Chỉ dùng làm default chung, không dùng làm profile override. |
| Windows | `pwsh` | `PowerShell 7` | `pwsh.exe` | Lựa chọn ưu tiên của `system`. |
| Windows | `windows-powershell` | `Windows PowerShell` | `powershell.exe` | Fallback thứ hai. |
| Windows | `cmd` | `Command Prompt` | `%COMSPEC%` hợp lệ, nếu không thì `cmd.exe` | Fallback cuối. |
| macOS | `system` | `System default` | Login shell hợp lệ, rồi catalog fallback | Chỉ dùng làm default chung. |
| macOS | `login-shell` | `Login shell` | Giá trị absolute hợp lệ của `SHELL` | Chỉ có trong catalog khi resolve được. |
| macOS | `zsh` | `Zsh` | `/bin/zsh` | Fallback thứ hai sau login shell. |
| macOS | `bash` | `Bash` | `/bin/bash` | Fallback cuối. |

`system` là sentinel persisted; `effective_default_shell_id` và `effective_shell_id` luôn là một ID concrete khác `system`. Command candidate chỉ là dữ liệu cho resolver, không được execute trong availability check.

### Bảng `cli_profile_settings`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` | Singleton row. |
| `default_shell_id` | `TEXT` | `NOT NULL`, `DEFAULT 'system'`, độ dài 1–64 | Shell chung; `system` là lựa chọn tự resolve theo OS. |

- Index: Không có ngoài primary key.
- Migration: `src-tauri/migrations/0003_create_cli_profiles.sql`

### Bảng `cli_profiles`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `TEXT` | `PRIMARY KEY`, `NOT NULL`, dài 44, ID `profile-` + UUID v4 lowercase | ID ổn định của custom profile. |
| `name` | `TEXT` | `NOT NULL`, sau trim dài 1–80 Unicode scalar | Tên hiển thị. |
| `command` | `TEXT` | `NOT NULL`, dài 1–1024 byte UTF-8 | Bare executable name hoặc absolute path; không chứa argument. |
| `arguments_json` | `TEXT` | `NOT NULL`, `DEFAULT '[]'`, `json_valid = 1`, root là JSON array | Mảng argument có thứ tự; mỗi phần tử là JSON string. |
| `shell_id` | `TEXT` | `NULL` hoặc dài 1–64 | `NULL` nghĩa là kế thừa shell mặc định chung; giá trị khác là shell ID trong catalog platform. |
| `icon` | `TEXT` | `NOT NULL`, dài 1–16 Unicode scalar | Nhãn icon ngắn do UI chọn, ví dụ `Ai` hoặc `>_`. |
| `color` | `TEXT` | `NOT NULL`, đúng dạng `#rrggbb` lowercase | Màu nhận diện profile. |
| `created_at_ms` | `INTEGER` | `NOT NULL`, `>= 0` | Unix epoch milliseconds khi tạo. |
| `updated_at_ms` | `INTEGER` | `NOT NULL`, `>= created_at_ms` | Unix epoch milliseconds lần thay đổi gần nhất. |

- Index: Không có; danh sách tối đa 100 custom profile, sort bằng `created_at_ms ASC, id ASC`.
- Migration: `src-tauri/migrations/0003_create_cli_profiles.sql`

### Bảng `cli_profile_environment`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `profile_id` | `TEXT` | `NOT NULL`, FK `cli_profiles(id) ON DELETE CASCADE` | Custom profile sở hữu biến. |
| `position` | `INTEGER` | `NOT NULL`, `>= 0`, `UNIQUE (profile_id, position)` | Thứ tự ổn định trong form và launch spec. |
| `name` | `TEXT COLLATE NOCASE` | `NOT NULL`, `PRIMARY KEY (profile_id, name)` | Tên biến, unique không phân biệt hoa thường để nhất quán với Windows. |
| `value` | `TEXT` | Chỉ `NOT NULL` khi `is_secret = 0` | Giá trị không nhạy cảm. Giá trị nhạy cảm không bao giờ vào cột này. |
| `is_secret` | `INTEGER` | `NOT NULL`, `CHECK (is_secret IN (0, 1))` | Cờ phân loại secret. |
| `credential_account` | `TEXT` | Chỉ `NOT NULL` khi `is_secret = 1`, `UNIQUE` | Account ID opaque dùng tra secret trong OS credential store. |

Constraint bắt buộc:

```sql
CHECK (
  (is_secret = 0 AND value IS NOT NULL AND credential_account IS NULL)
  OR
  (is_secret = 1 AND value IS NULL AND credential_account IS NOT NULL)
)
```

- Index: primary key, unique constraint theo `position` và `credential_account` là đủ.
- Migration: `src-tauri/migrations/0003_create_cli_profiles.sql`

### Bảng `credential_cleanup_queue`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `credential_account` | `TEXT` | `PRIMARY KEY`, `NOT NULL` | Credential cũ phải xóa sau khi database commit. |
| `queued_at_ms` | `INTEGER` | `NOT NULL`, `>= 0` | Thời điểm đưa vào hàng đợi để chẩn đoán và retry. |

- Index: Không có ngoài primary key.
- Migration: `src-tauri/migrations/0003_create_cli_profiles.sql`

Migration phải tạo bảng theo thứ tự settings → profiles → environment → cleanup queue, chèn singleton settings một lần, và được registry chạy atomically qua `Storage` của BE-002. `0003_create_cli_profiles.sql` không sửa hoặc tạo lại domain schema của migration 1 và 2.

Schema chính xác:

```sql
CREATE TABLE cli_profile_settings (
    id INTEGER PRIMARY KEY NOT NULL CHECK(id = 1),
    default_shell_id TEXT NOT NULL DEFAULT 'system'
        CHECK(length(default_shell_id) BETWEEN 1 AND 64)
) STRICT;

INSERT INTO cli_profile_settings (id, default_shell_id)
VALUES (1, 'system');

CREATE TABLE cli_profiles (
    id TEXT PRIMARY KEY NOT NULL
        CHECK(length(id) = 44 AND substr(id, 1, 8) = 'profile-'),
    name TEXT NOT NULL
        CHECK(length(trim(name)) BETWEEN 1 AND 80),
    command TEXT NOT NULL
        CHECK(length(command) BETWEEN 1 AND 1024),
    arguments_json TEXT NOT NULL DEFAULT '[]'
        CHECK(json_valid(arguments_json) AND json_type(arguments_json) = 'array'),
    shell_id TEXT
        CHECK(shell_id IS NULL OR length(shell_id) BETWEEN 1 AND 64),
    icon TEXT NOT NULL
        CHECK(length(icon) BETWEEN 1 AND 16),
    color TEXT NOT NULL
        CHECK(
            length(color) = 7
            AND substr(color, 1, 1) = '#'
            AND substr(color, 2) NOT GLOB '*[^0-9a-f]*'
        ),
    created_at_ms INTEGER NOT NULL
        CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL
        CHECK(updated_at_ms >= created_at_ms)
) STRICT;

CREATE TABLE cli_profile_environment (
    profile_id TEXT NOT NULL
        REFERENCES cli_profiles(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    name TEXT COLLATE NOCASE NOT NULL,
    value TEXT,
    is_secret INTEGER NOT NULL CHECK(is_secret IN (0, 1)),
    credential_account TEXT UNIQUE,
    PRIMARY KEY (profile_id, name),
    UNIQUE (profile_id, position),
    CHECK (
        (is_secret = 0 AND value IS NOT NULL AND credential_account IS NULL)
        OR
        (is_secret = 1 AND value IS NULL AND credential_account IS NOT NULL)
    )
) STRICT;

CREATE TABLE credential_cleanup_queue (
    credential_account TEXT PRIMARY KEY NOT NULL,
    queued_at_ms INTEGER NOT NULL CHECK(queued_at_ms >= 0)
) STRICT;
```

Registry thêm đúng entry version `3`, name `create_cli_profiles`, SQL từ `include_str!("../../migrations/0003_create_cli_profiles.sql")`. Migration runner của BE-002 sở hữu transaction và `PRAGMA user_version`; file SQL không tự `BEGIN`, `COMMIT` hoặc ghi pragma. Validation Rust phải parse toàn bộ JSON array và UUID v4 vì CHECK của SQLite chỉ bảo vệ shape lưu trữ tối thiểu.

## DTO public

Mọi struct field và enum variant public serialize theo `camelCase`, nhất quán binding các capability hiện có. Input DTO có thể derive `Deserialize` và `TS` nhưng không derive `Debug`, `Clone` hoặc `Serialize` vì có thể chứa plaintext secret. Output DTO derive `Serialize`, `Deserialize` và `TS`.

```rust
#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CliProfileKindDto {
    BuiltIn,
    Custom,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CliProfileAvailabilityStatusDto {
    Unchecked,
    Available,
    CommandNotFound,
    ShellNotFound,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileAvailabilityDto {
    pub status: CliProfileAvailabilityStatusDto,
    pub checked_at_unix_ms: Option<String>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileEnvironmentDto {
    pub name: String,
    pub value: Option<String>,
    pub is_secret: bool,
    pub has_stored_value: bool,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileEnvironmentInputDto {
    pub name: String,
    pub value: Option<String>,
    pub is_secret: bool,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileInputDto {
    pub name: String,
    pub command: String,
    pub arguments: Vec<String>,
    pub shell_id: Option<String>,
    pub icon: String,
    pub color: String,
    pub environment: Vec<CliProfileEnvironmentInputDto>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliShellDto {
    pub id: String,
    pub display_name: String,
    pub command: String,
    pub is_available: bool,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliProfileDto {
    pub id: String,
    pub name: String,
    pub kind: CliProfileKindDto,
    pub command: Option<String>,
    pub arguments: Vec<String>,
    pub shell_id: Option<String>,
    pub effective_shell_id: String,
    pub icon: String,
    pub color: String,
    pub environment: Vec<CliProfileEnvironmentDto>,
    pub availability: CliProfileAvailabilityDto,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliProfilesSnapshotDto {
    pub revision: String,
    pub default_shell_id: String,
    pub effective_default_shell_id: String,
    pub shells: Vec<CliShellDto>,
    pub profiles: Vec<CliProfileDto>,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CliProfilesChangeKindDto {
    Created,
    Updated,
    Deleted,
    DefaultShellChanged,
    AvailabilityChanged,
}

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CliProfilesChangedDto {
    pub revision: String,
    pub kind: CliProfilesChangeKindDto,
    pub profile_id: Option<String>,
}
```

Quy ước field:

- Với environment không secret: `value = Some(...)`, `has_stored_value = true`.
- Với environment secret: `value = None` trong mọi output/event, `has_stored_value = true` khi metadata có `credential_account`; backend không đọc credential chỉ để dựng danh sách.
- Khi update secret đã tồn tại và vẫn giữ nguyên tên/cờ secret, `value = None` nghĩa là giữ credential hiện tại; secret mới hoặc secret đổi tên bắt buộc có `Some(value)`.
- `revision` là bộ đếm `u64` trong process, serialize thành decimal string để an toàn với JavaScript. Nó bắt đầu từ `0` sau startup và tăng đúng một lần cho mỗi thay đổi snapshot quan sát được; frontend không lưu qua lần chạy app.
- `shell_id = None` của custom profile nghĩa là “Use default shell”. `effective_shell_id` luôn là shell ID cụ thể đã resolve ở thời điểm tạo DTO.
- `default_shell_id` là giá trị persisted; `effective_default_shell_id` là ID concrete hiện tại. Khi persisted value là `system`, FE-013 hiển thị tên/command của shell concrete nhưng vẫn giữ lựa chọn auto.
- `command` của Terminal DTO là command của effective shell để FE-006/FE-013 hiển thị như wireframe; `resolve_for_launch` vẫn trả `InteractiveShell`, không coi giá trị hiển thị này là CLI command.
- Thứ tự `profiles`: Codex, Claude, Terminal, rồi custom theo thời gian tạo. FE-006 tự đưa “Recently used” lên trước bằng dữ liệu session của BE-005, không thay đổi thứ tự nguồn.

Binding sinh vào `src/bindings/terminal/`; không sửa file binding bằng tay.

## Tauri command

Tất cả command chỉ chấp nhận invocation từ window label `main`. Command mỏng: xác thực caller và DTO, gọi `CliProfilesService`, rồi map typed error. Database, command discovery và credential I/O không chạy trên async worker.

Create/update/delete/default-shell là persistent mutation: service lấy `DataReadPermit` sau authorization/validation thuần input nhưng trước mutation mutex, credential side effect hoặc Storage access, giữ đến sau SQLite commit và cache/event publish. Permit là dependency Rust được inject, không xuất hiện trong command hoặc DTO. `check_cli_profile` chỉ đổi cache runtime nên không lấy permit.

### `get_cli_profiles`

Đọc snapshot profile, catalog shell và availability cache hiện tại; không đọc plaintext secret.

```rust
/// Returns the current CLI profiles and shell catalog snapshot.
#[tauri::command]
pub async fn get_cli_profiles(
    window: tauri::Window,
    state: tauri::State<'_, CliProfilesService>,
) -> Result<CliProfilesSnapshotDto, CliProfilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller phải là `main`. |
| Side effect | Không có; có thể hydrate cache từ SQLite lần đầu. |
| Lỗi trả về | `UnauthorizedWindow`, `PersistenceFailed`. |

### `create_cli_profile`

Tạo một custom profile và trả snapshot sau commit.

```rust
/// Creates one custom CLI profile.
#[tauri::command]
pub async fn create_cli_profile(
    window: tauri::Window,
    state: tauri::State<'_, CliProfilesService>,
    input: CliProfileInputDto,
) -> Result<CliProfilesSnapshotDto, CliProfilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Áp dụng toàn bộ giới hạn input ở mục Business rule; custom profile hiện có phải ít hơn 100; mọi secret entry bắt buộc có `value`. |
| Side effect | Ghi secret mới vào credential store; transaction chèn profile/environment metadata; cập nhật cache/revision; phát `cli-profiles://changed` với `created`. |
| Lỗi trả về | Các lỗi validation, `TooManyProfiles`, `CredentialStoreUnavailable`, `SecretWriteFailed`, `PersistenceFailed`. |

### `update_cli_profile`

Thay thế toàn bộ cấu hình một custom profile và trả snapshot sau commit.

```rust
/// Replaces the configuration of one custom CLI profile.
#[tauri::command]
pub async fn update_cli_profile(
    window: tauri::Window,
    state: tauri::State<'_, CliProfilesService>,
    profile_id: String,
    input: CliProfileInputDto,
) -> Result<CliProfilesSnapshotDto, CliProfilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | `profile_id` phải là custom profile hiện có; áp dụng toàn bộ giới hạn input; secret `None` chỉ được giữ lại khi cùng tên và trước đó cũng là secret. |
| Side effect | Ghi credential mới trước; transaction thay profile/environment metadata và enqueue credential bị thay; commit; cập nhật cache/revision; phát event `updated`; retry cleanup không chặn kết quả đã commit. |
| Lỗi trả về | `ProfileNotFound`, `BuiltInProfileReadOnly`, các lỗi validation, credential write error, `SecretValueRequired`, `PersistenceFailed`. |

### `delete_cli_profile`

Xóa một custom profile; session đang giữ tool selection cũ không bị sửa ngược lại và sẽ nhận `ProfileNotFound` nếu cố launch về sau.

```rust
/// Deletes one custom CLI profile and schedules credential cleanup.
#[tauri::command]
pub async fn delete_cli_profile(
    window: tauri::Window,
    state: tauri::State<'_, CliProfilesService>,
    profile_id: String,
) -> Result<CliProfilesSnapshotDto, CliProfilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | ID phải là custom profile hiện có; không chấp nhận ID dựng sẵn. |
| Side effect | Transaction enqueue mọi credential account rồi xóa row profile; commit; cập nhật cache/revision; phát event `deleted`; dọn credential sau commit và retry khi cần. |
| Lỗi trả về | `ProfileNotFound`, `BuiltInProfileReadOnly`, `PersistenceFailed`. Lỗi xóa credential sau commit không biến kết quả đã xóa thành failure. |

### `set_default_cli_shell`

Đổi shell chung cho Terminal và profile không có override.

```rust
/// Selects the global default shell.
#[tauri::command]
pub async fn set_default_cli_shell(
    window: tauri::Window,
    state: tauri::State<'_, CliProfilesService>,
    shell_id: String,
) -> Result<CliProfilesSnapshotDto, CliProfilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | `shell_id` phải là `system` hoặc concrete ID có trong platform catalog và đang resolve được; không nhận command/path tùy ý qua field này. |
| Side effect | Update singleton settings trong transaction; invalidate availability của Terminal và mọi profile kế thừa; tăng revision; phát event `default_shell_changed`; xếp recheck nền. |
| Lỗi trả về | `InvalidShell`, `ShellNotFound`, `PersistenceFailed`. |

### `check_cli_profile`

Kiểm tra lại command và effective shell của một profile mà không chạy command.

```rust
/// Rechecks one profile without executing its command.
#[tauri::command]
pub async fn check_cli_profile(
    window: tauri::Window,
    state: tauri::State<'_, CliProfilesService>,
    profile_id: String,
) -> Result<CliProfileDto, CliProfilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | ID dựng sẵn hoặc custom phải tồn tại. |
| Side effect | Chỉ đọc filesystem/`PATH`/`PATHEXT`; ghi kết quả vào memory cache; tăng revision và phát event `availability_changed`. Không chạy executable và không đọc credential value. |
| Lỗi trả về | `ProfileNotFound`, `CommandResolutionFailed`. Không tìm thấy command/shell là trạng thái DTO thành công, không phải lỗi IPC. |

## Public interface nội bộ cho consumer backend

BE-005 và BE-007 không gọi Tauri command và không đọc repository của BE-006. App composition truyền một adapter dùng các method sau:

```rust
pub struct CliProfileLaunchability {
    pub id: String,
    pub display_name: String,
    pub is_available: bool,
}

pub enum ResolvedCliLaunchKind {
    InteractiveShell {
        shell: ResolvedShell,
    },
    Command {
        shell: ResolvedShell,
        executable: String,
        arguments: Vec<String>,
    },
}

pub struct ResolvedCliProfile {
    pub profile_id: String,
    pub display_name: String,
    pub launch_kind: ResolvedCliLaunchKind,
    pub environment: Vec<(String, zeroize::Zeroizing<String>)>,
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
    Plain { name: String, value: String },
    SecretReference {
        name: String,
        credential_account: String,
    },
}

pub struct CliProfilesImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
}

pub struct CliProfilesImportPlan {
    pub counts: CliProfilesImportCounts,
    // Private owned row operations, cleanup outbox changes, and projection.
}

pub struct CliProfilesCommittedProjection {
    // Private committed cache/revision snapshot; never contains a secret value.
}

impl CliProfilesService {
    /// Resolves current display name and launch availability for Sessions.
    pub async fn launchability(
        &self,
        profile_id: &str,
    ) -> Result<CliProfileLaunchability, CliProfilesError>;

    /// Resolves a structured profile and secrets immediately before PTY launch.
    pub async fn resolve_for_launch(
        &self,
        profile_id: &str,
    ) -> Result<ResolvedCliProfile, CliProfilesError>;

    /// Exports profile metadata in the coordinator snapshot.
    pub fn export_cli_profiles_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<CliProfilesBackupV1, CliProfilesError>;

    /// Validates and prepares one metadata-only profile merge.
    pub fn prepare_cli_profiles_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        incoming: &CliProfilesBackupV1,
    ) -> Result<CliProfilesImportPlan, CliProfilesError>;

    /// Applies a prepared profile merge inside the coordinator transaction.
    pub fn apply_cli_profiles_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &CliProfilesImportPlan,
    ) -> Result<CliProfilesCommittedProjection, CliProfilesError>;

    /// Resets custom profiles and default shell in the shared reset transaction.
    pub fn reset_cli_profiles_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<CliProfilesCommittedProjection, CliProfilesError>;

    /// Publishes a prepared cache/subscription projection after commit.
    pub fn publish_data_change(&self, projection: CliProfilesCommittedProjection);

    /// Retries durable credential cleanup after maintenance or a normal mutation.
    pub async fn retry_credential_cleanup(&self) -> Result<(), CliProfilesError>;
}
```

- `launchability` re-resolve command/shell thay vì tin tuyệt đối vào cache. Missing command/shell trả thành công với `is_available = false`; adapter app map giá trị này sang `sessions::LaunchableProfile` do BE-005 sở hữu để BE-005 trả `ProfileUnavailable`. `ProfileNotFound` map thành lỗi cùng tên; lỗi resolver/persistence map thành `ProfileLookupFailed`.
- `resolve_for_launch` chỉ được BE-007 gọi ngay trước khi spawn. Method recheck command/shell, đọc secret từ credential store, và trả command, argument, environment, shell ở các field riêng biệt. Type trả về không derive `Serialize`, `Debug` hoặc `Clone`.
- BE-007 gọi `ProjectService::available_root` của BE-003 rồi gắn canonical `PathBuf` trả về làm `cwd`. BE-006 không nhận hoặc suy diễn working directory.
- `ResolvedShell` là type nội bộ từ `platform::shell`, chứa executable và shell mode có cấu trúc. Nếu OS adapter cần encoding riêng để yêu cầu shell chạy command, chỉ adapter BE-007 được làm ở bước cuối và phải dùng encoder theo từng shell; frontend, IPC, SQLite, log và BE-006 không được nối command/arguments thành shell string.
- `CliProfileBackupRecordV1`, `CliEnvironmentBackupRecordV1` và `CliProfilesImportCounts` dùng đúng typed shape/cap của BE-012; chúng cùng plan/projection không derive `TS` và không chứa plaintext secret. Plan/projection là owned, `Send + 'static`, không giữ connection/transaction/row borrow/lock guard/secret hoặc callback.
- Mọi API `_in` dùng transaction coordinator truyền, không lấy `DataReadPermit`, service mutation mutex hoặc mở Storage call lồng. Prepare validate và dựng sẵn operations/projection; apply chỉ chạy SQL/enqueue cleanup reference. `publish_data_change` consume projection sau commit, swap cache/revision rồi notify internal subscriber no-fail, không query DB và không trả `Result`; Tauri event là best-effort. `retry_credential_cleanup` chạy sau commit/permit của operation chính.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `cli-profiles://changed` | `CliProfilesChangedDto` | Sau database commit thành công hoặc sau mỗi explicit availability check hoàn tất. | Phát từ một service tuần tự; `revision` tăng đúng một và event theo thứ tự revision. Payload chỉ báo invalidation, không chứa cấu hình/env. Frontend nhận event phải gọi `get_cli_profiles`; event emit thất bại không rollback commit. |

Startup check có thể hoàn tất trước khi frontend gắn listener; snapshot luôn là source of truth. Không dùng Channel vì đây là thay đổi tần suất thấp, không phải terminal output.

## Business rule và invariant

1. Luôn có đúng ba profile dựng sẵn với ID, thứ tự và tên đã nêu. Chúng được tổng hợp trong memory, không ghi vào `cli_profiles`, không update và không delete.
2. Custom profile tối đa 100. `name` được trim, không rỗng, tối đa 80 Unicode scalar; tên trùng được phép vì ID mới là định danh.
3. `command` được trim và phải là một bare executable name không có separator hoặc một absolute path. Cấm NUL, ký tự điều khiển, relative path có separator, `~`, biến môi trường và chuỗi kèm argument. Backend không shell-expand input.
4. `arguments` là mảng literal riêng biệt, tối đa 128 phần tử, mỗi phần tử tối đa 4096 byte UTF-8, tổng tối đa 32 KiB và không chứa NUL. Khoảng trắng trong một phần tử không làm tách thêm argument.
5. `environment` tối đa 64 phần tử. Tên phải khớp `[A-Za-z_][A-Za-z0-9_]{0,127}`, unique ASCII case-insensitive; giá trị tối đa 32 KiB và không chứa NUL. Cho phép giá trị rỗng và không cấm `PATH`, vì đây là cấu hình chủ động của người dùng.
6. `icon` sau trim dài 1–16 Unicode scalar, không có control character. `color` phải lowercase và khớp `#[0-9a-f]{6}`.
7. Profile custom không có `shell_id` kế thừa singleton default. Profile override chỉ nhận concrete stable ID khác `system`; default chung nhận `system` hoặc concrete ID. Không field nào nhận executable shell tùy ý.
8. `system` resolve theo chính sách: Windows ưu tiên `pwsh`, rồi `powershell`, rồi `COMSPEC`/`cmd`; macOS ưu tiên login shell hợp lệ, rồi `zsh`, rồi `bash`. Ở build/dev Windows phải kiểm thử đầy đủ; macOS chỉ là contract để xác nhận khi release preparation.
9. Profile CLI khả dụng khi cả command và effective shell resolve được. Terminal khả dụng khi effective shell resolve được. Resolver chỉ kiểm tra executable và không bao giờ chạy lệnh.
10. Command discovery dùng environment của backend process. Bare command tra `PATH`; trên Windows thử extension theo `PATHEXT` không phân biệt hoa thường. Absolute path phải trỏ tới file; path đã resolve không xuất qua DTO hoặc log.
11. `checked_at_unix_ms` chỉ thay đổi sau một check hoàn tất. Thay profile hoặc default shell đưa status bị ảnh hưởng về `unchecked` trước khi recheck nền.
12. Plaintext secret chỉ đi từ input DTO vào buffer `Zeroizing<String>`, từ đó vào credential store, hoặc từ credential store vào `ResolvedCliProfile` ngay trước launch. Không có plaintext secret trong SQLite, output DTO, event, tracing, error, crash context hoặc backup.
13. Credential dùng keyring service `com.xwork.app.cli-profile`; account là UUID opaque, không chứa profile name, env name hoặc secret. Metadata account nằm trong SQLite để backup có thể giữ reference mà không chứa value.
14. Create/update ghi credential mới trước database commit. Transaction DB sau đó trỏ metadata tới credential mới và enqueue credential cũ. Nếu DB rollback, backend xóa credential mới; cleanup không thành công phải được enqueue bằng transaction bù tốt nhất có thể và ghi log chỉ với account hash.
15. Delete/update đã commit không rollback vì việc xóa credential cũ thất bại. `credential_cleanup_queue` giữ reference; worker retry khi startup và sau mỗi mutation. Mỗi background retry lấy `DataReadPermit` trước khi đọc/xóa credential reference và giữ qua transaction xóa queue row; row chỉ bị xóa sau khi credential đã xóa hoặc adapter xác nhận “not found”.
16. Mọi persistent mutation lấy `DataReadPermit` trước service mutation mutex; explicit availability check chỉ dùng mutex. Không giữ SQLite/service mutex trong khi chờ credential I/O; read permit là guard duy nhất được phép sống qua await đó và DB transaction chỉ bao trùm thay đổi SQLite.
17. `get_cli_profiles` không đọc credential store và không xác nhận secret còn tồn tại. `resolve_for_launch` thiếu credential trả `SecretNotFound`/`CredentialStoreUnavailable` và tuyệt đối không launch một phần.
18. Update/delete profile không thay đổi tiến trình đã chạy. Tool selection cũ của BE-005 giữ ID/title snapshot; lần launch mới phải tra lại và thất bại rõ nếu profile đã bị xóa hoặc không còn khả dụng.
19. Thay default shell không thay `shell_id` của profile kế thừa; `effective_shell_id` và availability được tính lại. Profile có override không bị ảnh hưởng.
20. Mọi function, method, callback, helper và test được thêm cho feature phải có comment ngắn đúng quy tắc repository; logic compensation credential cần inline comment về invariant commit/cleanup.
21. Lock order là `DataMaintenanceGate` → CLI Profiles mutation mutex → Storage. Owner `_in` API không lấy lại permit/mutex/Storage; credential cleanup sau maintenance chạy ngoài write permit và tự lấy read permit.

## Lỗi

Error public serialize dưới dạng object có `code` ổn định camelCase, `message` an toàn và `field` tùy chọn. Không đưa command path đã resolve, argument, env value, credential account hoặc lỗi nguyên văn từ keyring/OS vào payload.

```rust
pub enum CliProfilesError {
    UnauthorizedWindow,
    ProfileNotFound,
    BuiltInProfileReadOnly,
    TooManyProfiles,
    InvalidName,
    InvalidCommand,
    InvalidArguments,
    InvalidShell,
    InvalidIcon,
    InvalidColor,
    InvalidEnvironmentName,
    DuplicateEnvironmentName,
    TooManyEnvironmentVariables,
    InvalidEnvironmentValue,
    SecretValueRequired,
    CommandNotFound,
    ShellNotFound,
    CredentialStoreUnavailable,
    SecretWriteFailed,
    SecretReadFailed,
    SecretNotFound,
    CommandResolutionFailed,
    PersistenceFailed,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Caller không phải `main`. | Từ chối và ghi security diagnostic an toàn. |
| `ProfileNotFound` | ID không tồn tại hoặc custom profile đã bị xóa. | Đóng editor hoặc refresh picker. |
| `BuiltInProfileReadOnly` | Update/delete ID `builtin:*`. | Ẩn CRUD và hiển thị profile dựng sẵn là read-only. |
| `TooManyProfiles` | Đã có 100 custom profile. | Chặn tạo và yêu cầu xóa profile không dùng. |
| `InvalidName` | Tên vi phạm giới hạn. | Gắn lỗi vào Name. |
| `InvalidCommand` | Command rỗng, có NUL/control, chứa argument hoặc relative path có separator. | Gắn lỗi vào Command. |
| `InvalidArguments` | Mảng argument vượt giới hạn hoặc chứa NUL. | Gắn lỗi vào Arguments. |
| `InvalidShell` | Shell ID không thuộc catalog. | Refresh danh sách shell và gắn lỗi vào Shell. |
| `InvalidIcon` | Icon vi phạm giới hạn. | Gắn lỗi vào Icon. |
| `InvalidColor` | Màu không đúng hex lowercase. | Gắn lỗi vào Colour. |
| `InvalidEnvironmentName` | Tên env không khớp quy tắc. | Gắn lỗi vào env row tương ứng. |
| `DuplicateEnvironmentName` | Tên env trùng không phân biệt hoa thường. | Đánh dấu các env row xung đột. |
| `TooManyEnvironmentVariables` | Quá 64 env row. | Chặn thêm/lưu. |
| `InvalidEnvironmentValue` | Value vượt giới hạn hoặc có NUL. | Gắn lỗi vào env row; không lặp value trong message. |
| `SecretValueRequired` | Secret mới/đổi tên không có value. | Yêu cầu nhập secret; không xóa profile hiện tại. |
| `CommandNotFound` | `resolve_for_launch` không resolve được executable; `check_cli_profile` và `launchability` biểu diễn trường hợp này bằng status/boolean thay vì error. | FE-006 hiển thị “Command not found”, disable lựa chọn và cho Check again. |
| `ShellNotFound` | `resolve_for_launch` không resolve được effective shell; các API chỉ đọc biểu diễn bằng status/boolean. | Disable launch, mở Settings Terminal để chọn shell khác. |
| `CredentialStoreUnavailable` | OS credential backend không dùng được. | Giữ form, giải thích không thể lưu/đọc secret và cho retry. |
| `SecretWriteFailed` | Ghi secret thất bại trước commit. | Không coi save thành công; dữ liệu cũ còn hiệu lực. |
| `SecretReadFailed` | Đọc secret trước launch lỗi. | Không spawn; cho retry sau khi credential store hoạt động lại. |
| `SecretNotFound` | Metadata còn nhưng credential value không còn. | Mở editor và yêu cầu nhập lại secret. |
| `CommandResolutionFailed` | OS resolver lỗi khác với “not found”. | Hiển thị lỗi kiểm tra chung và cho retry. |
| `PersistenceFailed` | Migration/query/transaction SQLite thất bại. | Không cập nhật UI như đã commit; hiển thị lỗi chung. |

## Luồng chính

### Startup và đọc danh sách

1. App composition mở `Storage` của BE-002; registry đã chạy tuần tự migration 1, 2 rồi `0003_create_cli_profiles.sql` trong transaction.
2. `CliProfilesService` đọc singleton settings và custom profile/environment metadata bằng blocking task; dựng ba profile built-in và catalog shell platform.
3. Snapshot ban đầu có availability `unchecked`. App có thể manage state ngay, sau đó chạy availability check nền cho từng profile.
4. Mỗi kết quả hợp lệ cập nhật cache/revision và phát invalidation event. FE-013/FE-006 luôn có thể gọi `get_cli_profiles` để lấy trạng thái hiện tại.
5. Cleanup worker lấy `DataReadPermit`, đọc `credential_cleanup_queue`, xóa từng credential ngoài DB lock, rồi xóa queue row trong transaction riêng khi thành công/not-found; nhả permit sau durable queue update.

### Tạo hoặc cập nhật profile có secret

1. Command xác thực window và toàn bộ cấu trúc input trước mọi side effect; chuyển plaintext secret sang `Zeroizing<String>`.
2. Service lấy `DataReadPermit`, rồi serialize mutation/lấy metadata hiện tại, tạo account UUID mới cho secret mới/đã đổi value và ghi từng credential qua blocking adapter.
3. Sau khi mọi credential mới đã ghi thành công, service mở một SQLite transaction: insert/update profile, thay toàn bộ environment rows, enqueue credential cũ bị bỏ/thay, rồi commit.
4. Nếu ghi credential hoặc transaction thất bại, cấu hình cũ vẫn là source of truth; service bù bằng cách xóa credential mới và không phát event.
5. Sau commit, service cập nhật cache, đặt availability profile về `unchecked`, tăng revision, phát event `created` hoặc `updated`, nhả permit của mutation chính, rồi cleanup worker tự lấy permit mới để thử dọn queue và recheck nền.

### Check và chọn tool

1. `check_cli_profile` snapshot cấu hình dưới mutation mutex, resolve effective shell và command qua blocking platform adapter, không chạy executable.
2. Service ghi status/checked time vào memory cache, tăng revision, phát event; missing command/shell trả DTO thành công với trạng thái tương ứng.
3. Khi FE-006 chọn tool, BE-005 gọi adapter `launchability`. Adapter BE-006 recheck; chỉ `is_available = true` mới được BE-005 lưu ToolSelection.
4. Khi BE-007 sắp spawn, nó gọi `resolve_for_launch`; BE-006 recheck lần cuối, đọc toàn bộ secret và trả launch spec có cấu trúc. Bất kỳ lỗi nào chặn spawn hoàn toàn.
5. BE-007 bổ sung project root làm `cwd`, giữ `command`, từng `argument` và từng `environment` riêng biệt qua process boundary.

## Ràng buộc kỹ thuật

- Blocking: Mọi rusqlite query/transaction chạy qua `tokio::task::spawn_blocking` và `Storage::with_connection`/`with_transaction` của BE-002. `keyring`, command/path discovery và cleanup cũng chạy qua `spawn_blocking`. Không gọi blocking API trên Tauri/Tokio async worker.
- Bảo mật: Không log/serialize/backup plaintext secret; input chứa secret không derive `Debug`/`Clone`; buffer secret dùng zeroize best effort. Không chạy command trong check. Không shell-expand input. Không gửi resolved absolute path ra frontend. Chỉ window `main` được gọi public command. Credential service/account tuân invariant nêu trên.
- Hiệu năng: Giới hạn 100 profile, 128 argument/profile và 64 env/profile. Một snapshot phải hoàn thành trong 100 ms ở fixture giới hạn khi cache đã hydrate, không tính cold OS discovery; availability check chạy blocking pool với concurrency tối đa 4 và không giữ DB lock. Event chỉ invalidation, không nhân bản env payload.
- Concurrency: Một mutation/check mutex giữ thứ tự thay đổi và event revision; persistent mutation/background DB write lấy shared read permit trước mutex/Storage, còn `_in` maintenance path gate-free trong write permit coordinator. Availability result nền mang generation và bị bỏ nếu cấu hình đổi trong lúc check.
- Dependency: BE-003 sở hữu `0001_create_projects.sql` và public `ProjectService::available_root`; BE-006 chỉ phụ thuộc thứ tự migration, còn BE-007 mới gọi root query khi launch. BE-008 sở hữu `0002_create_settings.sql` và xác nhận shell/CLI profile ngoài phạm vi settings của nó; BE-006 vì vậy sở hữu singleton default shell và migration version 3.
- Nền tảng: Chỉ build/test Windows trong development theo quy tắc repository. Shell catalog macOS và executable-bit check phải được giữ sau `cfg`, nhưng validation thực tế hoãn tới release preparation.

## Tiêu chí hoàn thành

- [ ] Registry BE-002 áp dụng `0003_create_cli_profiles.sql` đúng sau version 2, idempotent qua `PRAGMA user_version`, tạo đúng bốn bảng/constraint và rollback toàn bộ khi migration lỗi.
- [ ] App luôn trả Codex, Claude, Terminal theo đúng ID/thứ tự; chúng không có row database và update/delete bị từ chối.
- [ ] CRUD custom profile round-trip chính xác tên, command, từng argument, shell, icon, màu và env order qua restart; command và arguments không bị nối thành một chuỗi.
- [ ] Default shell và shell override resolve đúng; Terminal/profile kế thừa đổi effective shell sau `set_default_cli_shell`, profile override không đổi.
- [ ] Windows resolver tìm bare command bằng `PATH`/`PATHEXT`, nhận absolute executable, từ chối relative path có separator và không chạy file trong mọi check.
- [ ] Missing command vẫn có mặt với status `commandNotFound`; FE-006 không thể chọn qua public launchability cho đến khi `check_cli_profile` thành `available`.
- [ ] Secret value không xuất hiện trong SQLite dump, DTO output, generated binding fixture, event, tracing capture, error payload hoặc backup fixture; non-secret env vẫn round-trip.
- [ ] Create/update lỗi credential hoặc DB không làm cấu hình committed bị thay một phần; credential cũ được enqueue và retry sau commit, delete không để plaintext rơi vào SQLite.
- [ ] Persistent command và cleanup worker giữ `DataReadPermit` đúng phạm vi; BE-012 write permit chặn chúng, còn owner `_in` apply/reset không re-enter gate/mutex/Storage.
- [ ] Backup/reset dùng typed `CliProfilesImportPlan`/`CliProfilesCommittedProjection` trong shared transaction; rollback không đổi cache/subscriber, commit publish cache/subscription no-fail rồi mới retry cleanup với permit mới.
- [ ] `resolve_for_launch` trả shell/command/argument/environment ở field tách biệt, dùng zeroizing secret buffer, thiếu credential hoặc command/shell thì chặn toàn bộ launch.
- [ ] Event revision tăng tuần tự; frontend bỏ lỡ event vẫn đồng bộ lại được bằng snapshot; event emit lỗi không rollback database commit.
- [ ] Generated TypeScript binding khớp Rust DTO và không có chỉnh sửa thủ công.
- [ ] Mọi function/method/callback/helper/test mới có comment ngắn; logic credential compensation có inline comment giải thích invariant.
- [ ] `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và `cargo test --all-targets --all-features` pass trên Windows.
- [ ] Formatter, linter, typecheck và E2E liên quan FE-006/FE-013 pass; Tauri build Windows pass vì feature thay command/binding, capability registration và desktop credential integration.
- [ ] Windows credential integration test chỉ dùng account UUID có prefix test, luôn cleanup trong teardown và không đụng credential người dùng.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/terminal/cli_profiles.rs` (`#[cfg(test)]`) | Unit | Validation mọi boundary; built-in synthesis/order; shell inheritance; args/env không bị ghép; availability generation; update secret `None`; read-permit/lock order; typed plan/projection; error redaction; fake credential compensation/cleanup queue. |
| `src-tauri/src/platform/command.rs` (`#[cfg(test)]`) | Unit | Bare/absolute command, NUL/control, `PATH`/`PATHEXT`, file không tồn tại và đảm bảo resolver không chạy executable. |
| `src-tauri/src/platform/shell.rs` (`#[cfg(test)]`) | Unit | Catalog stable ID, `system` fallback Windows/macOS và phân biệt inherited/override. |
| `src-tauri/src/platform/credential.rs` (`#[cfg(test)]`) | Unit | Mapping keyring error an toàn, UUID account opaque, fake read/write/delete/not-found và không log value. |
| `src-tauri/tests/cli_profiles_contract.rs` | Integration | Migration/schema; CRUD/restart; command authorization; event/revision; built-in read-only; SQLite/event/error không chứa secret; rollback và cleanup queue bằng fake adapters. |
| `src-tauri/tests/data_management_contract.rs` | Integration | Write permit chặn command/cleanup worker; shared transaction apply/reset, rollback không publish, commit publish no-fail và cleanup retry sau permit maintenance. |
| `src-tauri/tests/cli_profiles_windows.rs` | Integration Windows | Resolver thật với temp executable/PATHEXT, shell discovery và Windows Credential Manager round-trip bằng test account rồi cleanup. |
| `src-tauri/tests/app_builder.rs` | Smoke | Managed state, startup task và sáu command BE-006 được đăng ký trong builder. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export toàn bộ DTO/event/error BE-006 vào `src/bindings/terminal/` và fail khi output lệch Rust source. |
| `tests/e2e/settings-cli-profiles.e2e.ts` | E2E mocked IPC | FE-013 CRUD/default shell/check status/secret masked; FE-006 profile unavailable, Check again và Open CLI Profiles theo wireframe. |

## Quyết định và giả định đã chốt

- Chọn built-in dưới dạng hằng số thay vì seed row để không phát sinh migration khi default thay đổi và để invariant read-only rõ ràng.
- Khóa icon/màu mặc định `Cx/#10a37f`, `Cl/#d97757`, `>_/#64748b` theo identity của wireframe; chúng là presentation metadata ổn định do backend trả, không phải dữ liệu user-editable.
- §17.3 chỉ yêu cầu CRUD custom profile nên được coi là nguồn có thẩm quyền: icon Edit đặt cạnh built-in trong wireframe `02-AppShell.html#settings-terminal` không cấp quyền sửa Codex/Claude/Terminal và FE-013 phải ẩn hoặc disable affordance đó.
- Chọn `system` làm giá trị mặc định bền vững; policy resolve ưu tiên PowerShell 7 trên Windows phù hợp wireframe nhưng vẫn hoạt động khi máy chưa cài `pwsh`.
- Chọn profile không override phải chạy qua global default shell vì wireframe FE-013 ghi rõ default shell dùng cho Terminal và mọi profile không có shell riêng. Dữ liệu vẫn tách biệt; encoding đặc thù shell là trách nhiệm cuối cùng của platform adapter BE-007.
- Chọn full-replacement DTO cho update để form FE-013 có một nguồn dữ liệu rõ ràng; `None` ở secret hiện hữu là thao tác “giữ nguyên”, không phải xóa ngầm.
- Chọn outbox `credential_cleanup_queue` vì SQLite và OS credential store không có distributed transaction; ưu tiên database commit nhất quán, dọn credential cũ có thể retry an toàn.
- Chọn availability là runtime cache, không lưu SQLite, vì `PATH`, shell và executable có thể thay đổi ngoài ứng dụng. “Check again” luôn re-resolve thực tế.
- Chọn event invalidation thay vì gửi full profile để không lộ/env payload và để FE-006, FE-013 cùng tái đồng bộ từ snapshot.
- Không thêm dependency runtime vào BE-005: BE-005 là consumer phía sau và app composition map public BE-006 contract sang port do sessions sở hữu.

## Câu hỏi mở

- Không có.
