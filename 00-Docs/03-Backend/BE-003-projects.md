# BE-003 — Projects

Tài liệu này đặc tả metadata project, kiểm tra folder gốc và các thao tác quản lý project ở mức contract. Backend là nguồn dữ liệu chính cho project đã đăng ký; frontend không trực tiếp mở dialog hệ điều hành, truy cập filesystem hay tự dựng DTO.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-003` |
| Phase | `1` |
| Capability | `src-tauri/src/projects/` |
| Yêu cầu chức năng | §7.1–7.4; liên quan §2, §4.1, §5.1–5.2, §6.2, §7.5, §8.1, §11, §12–14, §18 và §20 Phase 1 |
| Frontend liên quan | `FE-001`, `FE-002`, `FE-003`, `FE-004`, `FE-005`, `FE-006`, `FE-009` |
| Phụ thuộc | `BE-002` |

## Mục tiêu

Backend cho phép người dùng đăng ký một folder có sẵn làm project, đọc danh sách theo thứ tự ổn định, đổi tên hiển thị, ghim, mở bằng file manager, cập nhật lần mở gần nhất, chọn lại folder và gỡ metadata mà không thay đổi dữ liệu project trên ổ đĩa. Capability cung cấp public Rust query tối thiểu để Sessions và các capability tổng hợp kiểm tra project tồn tại, thứ tự project và khả năng tạo session.

### Quyết định và giả định đã chốt

- Migration đầu tiên của ứng dụng là `0001_create_projects.sql`, đúng contract registry của `BE-002`; migration tạo duy nhất bảng/index thuộc Projects.
- Project dùng UUID v4 dạng chuỗi làm ID bền vững vì ID sẽ được tham chiếu bởi session runtime, note, event và backup; không dùng rowid làm contract public.
- Database lưu `root_path` để hiển thị và `path_key` để chống đăng ký trùng. `path_key` được tạo từ canonical absolute path: Windows chuẩn hóa separator và so sánh không phân biệt hoa thường; macOS giữ kết quả canonical theo đúng case filesystem trả về.
- `Available/Unavailable` là trạng thái dẫn xuất khi query, không persist vì trạng thái folder có thể đổi bên ngoài XWork bất kỳ lúc nào. Không thêm watcher riêng: app query lại khi khởi động, khi cửa sổ lấy focus và trước mọi thao tác cần folder.
- `Add Project` và `Locate folder…` mở native folder picker từ Rust. Cancel là kết quả bình thường, không phải lỗi; frontend không được truyền path tùy ý vào Tauri command.
- Xóa project luôn cần xác nhận vì metadata bị loại bỏ. Backend tính lại impact lúc commit, chặn session mới trong lúc remove và chỉ xóa row sau khi session runtime đã đóng thành công.
- Khi `BE-005` chưa được ghép ở giai đoạn 4, production dùng `NoProjectRuntimeGuard` vì session runtime chưa tồn tại. Từ giai đoạn 8, composition root thay bằng adapter gọi public SessionManager; contract command của Projects không đổi.
- Chọn lại folder giữ nguyên project ID, display name, pin, added time và quan hệ note/event. Session/process đang có không bị restart hoặc đổi working directory; chỉ thao tác filesystem và session tạo sau đó dùng root mới.

### Ngoài phạm vi

- Nhận diện Git repository, branch hoặc changed files; các field và query đó thuộc `BE-004` dù wireframe cuối có hiển thị chung trên project card/overview.
- Tạo folder, clone repository, commit, checkout, pull, push hoặc sửa file trong folder project.
- Session/tab/pane/process lifecycle; Projects chỉ gọi runtime guard công khai khi remove.
- Recent files, file tree/read/save, note, event, unified search ranking, backup/import/reset và UI state sidebar mở rộng.
- Theo dõi liên tục filesystem để phát event ngay thời điểm folder bị đổi bên ngoài; availability được refresh theo query có chủ đích.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo `serde`, `ts-rs`, `uuid`, Tokio cần cho command, cùng official dialog/opener plugin gọi từ Rust. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi cập nhật manifest. |
| `src-tauri/migrations/0001_create_projects.sql` | Tạo bảng `projects` và index thứ tự project. |
| `src-tauri/src/storage/migrations.rs` | Đăng ký version `1` bằng `include_str!` theo contract `BE-002`. |
| `src-tauri/src/lib.rs` | Export module `projects` và shared maintenance primitive. |
| `src-tauri/src/shared/mod.rs` | Export primitive maintenance dùng chung từ lát cắt BE-003. |
| `src-tauri/src/shared/maintenance.rs` | Định nghĩa app-wide `DataMaintenanceGate`, owned read/write permit và lock-order contract dùng chung. |
| `src-tauri/src/app/mod.rs` | Tạo đúng một `DataMaintenanceGate`, inject vào project service, khởi tạo platform/runtime guard, manage state, đăng ký plugin và toàn bộ command. |
| `src-tauri/src/app/data_participants.rs` | Adapter typed Projects participant của BE-012, chỉ gọi public owner maintenance API. |
| `src-tauri/src/projects/mod.rs` | Public entry, re-export DTO, error và Rust query/port được capability khác dùng. |
| `src-tauri/src/projects/models.rs` | Model persisted, DTO public, availability, change event và remove impact. |
| `src-tauri/src/projects/repository.rs` | SQL có bind parameter, mapping row, thứ tự query và transaction ghi qua `Storage`. |
| `src-tauri/src/projects/service.rs` | Validation, canonical path/key, availability, clock/ID, orchestration add/locate/remove và event. |
| `src-tauri/src/projects/platform.rs` | Adapter native folder picker và mở folder bằng official Tauri plugin; seam giả cho unit test. |
| `src-tauri/src/projects/commands.rs` | Tauri command mỏng authorize exact caller allowlist, gọi service và chuyển kết quả thành DTO/error typed. |
| `src-tauri/src/projects/error.rs` | `ProjectsError`, reason enum và mapping lỗi storage/platform không lộ path nhạy cảm. |
| `src-tauri/tests/app_builder.rs` | Xác nhận composition root tạo đúng một shared maintenance gate, inject cùng instance và đăng ký managed state/plugin/command bằng mock runtime. |
| `src-tauri/tests/projects_commands.rs` | Integration test migration, persistence, command boundary, event và filesystem bằng thư mục tạm. |
| `src-tauri/tests/data_management_contract.rs` | Contract test read/write permit, typed project plan/projection và shared-transaction import/reset. |
| `src-tauri/tests/export_bindings.rs` | Sinh và kiểm tra binding từ DTO/error public của Projects. |
| `src/bindings/projects/` | Output TypeScript do `ts-rs` sinh; không chỉnh tay. |

Không cần thay đổi capability permission: dialog/opener được gọi trong Rust qua API hẹp, không cấp plugin API hay filesystem permission cho webview.

BE-003 là lát cắt đầu tiên tạo `shared/maintenance.rs`: composition root dựng đúng một `DataMaintenanceGate` rồi inject cùng instance vào `ProjectService`; BE-005 session creation và BE-012 maintenance tiếp tục dùng chính instance đó khi các lát cắt tương ứng được ghép. Primitive chỉ chứa admission/permit và không chứa model, SQL hoặc rule Projects.

## Dữ liệu

### Bảng `projects`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `TEXT` | `PRIMARY KEY`, `NOT NULL`, `CHECK(length(id) = 36)` | UUID v4 dạng hyphenated lowercase, không đổi trong vòng đời project. |
| `display_name` | `TEXT` | `NOT NULL`, `CHECK(length(trim(display_name)) BETWEEN 1 AND 255)` | Tên người dùng thấy; tên trùng được phép. |
| `root_path` | `TEXT` | `NOT NULL`, `CHECK(length(root_path) > 0)` | Canonical absolute path dùng hiển thị và làm project root. |
| `path_key` | `TEXT` | `NOT NULL`, `UNIQUE`, `CHECK(length(path_key) > 0)` | Khóa so sánh theo OS để cùng một folder không được đăng ký hai lần. |
| `is_pinned` | `INTEGER` | `NOT NULL`, `DEFAULT 0`, `CHECK(is_pinned IN (0, 1))` | `1` nếu project được ghim. |
| `added_at_ms` | `INTEGER` | `NOT NULL`, `CHECK(added_at_ms >= 0)` | Unix epoch millisecond UTC khi add thành công. |
| `last_opened_at_ms` | `INTEGER` | `NOT NULL`, `CHECK(last_opened_at_ms >= added_at_ms)` | Unix epoch millisecond UTC gần nhất project được mở; bằng `added_at_ms` ngay sau add. |

- Index: `CREATE INDEX idx_projects_list_order ON projects(is_pinned DESC, added_at_ms ASC, id ASC);`
- Migration: `src-tauri/migrations/0001_create_projects.sql`

Schema chính xác:

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
    display_name TEXT NOT NULL
        CHECK(length(trim(display_name)) BETWEEN 1 AND 255),
    root_path TEXT NOT NULL CHECK(length(root_path) > 0),
    path_key TEXT NOT NULL UNIQUE CHECK(length(path_key) > 0),
    is_pinned INTEGER NOT NULL DEFAULT 0
        CHECK(is_pinned IN (0, 1)),
    added_at_ms INTEGER NOT NULL CHECK(added_at_ms >= 0),
    last_opened_at_ms INTEGER NOT NULL
        CHECK(last_opened_at_ms >= added_at_ms)
) STRICT;

CREATE INDEX idx_projects_list_order
    ON projects(is_pinned DESC, added_at_ms ASC, id ASC);
```

Registry `BE-002` thêm đúng entry version `1`, name `create_projects`, SQL từ `include_str!("../../migrations/0001_create_projects.sql")`. Migration chạy atomically và đặt `PRAGMA user_version = 1` qua runner; file migration không tự ghi pragma.

`ProjectService` giữ clone `Storage`, `Arc<dyn ProjectPlatform>`, `Arc<dyn ProjectRuntimeGuard>`, clock/UUID provider và event sink. Tauri implementation của platform/event sink giữ `AppHandle` clone được inject trong setup; command không nhận hoặc giữ raw OS handle ngoài service.

## DTO public

Mọi DTO derive `Clone`, `Debug`, `Serialize`, `Deserialize` và `TS`; struct/field dùng `camelCase`, enum có dữ liệu dùng discriminator ghi rõ bên dưới. Timestamp millisecond hiện tại nằm an toàn trong JavaScript integer và sinh thành `number`.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub is_pinned: bool,
    pub added_at_ms: i64,
    pub last_opened_at_ms: i64,
    pub availability: ProjectAvailabilityDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "status", content = "reason", rename_all = "camelCase")]
pub enum ProjectAvailabilityDto {
    Available,
    Unavailable(ProjectUnavailableReasonDto),
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ProjectUnavailableReasonDto {
    Missing,
    NotDirectory,
    AccessDenied,
    Io,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum ProjectFolderSelectionDto {
    Cancelled,
    Selected { project: ProjectDto },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectImpactDto {
    pub project_id: String,
    pub display_name: String,
    pub root_path: String,
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectResultDto {
    pub project_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChangedEventDto {
    pub change: ProjectChangeKindDto,
    pub project_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ProjectChangeKindDto {
    Added,
    Updated,
    Removed,
}
```

`ProjectDto` không có field Git, session, recent file, note hoặc event. Màn hình tổng hợp lấy các phần đó từ public query của capability sở hữu rồi ghép tại frontend/app composition; không mở rộng repository Projects thành query tổng hợp.

## Tauri command

Mọi command là `pub async fn`, nhận invoking `tauri::WebviewWindow`, được đăng ký rõ trong `app::configure`, có comment tiếng Anh ngắn theo quy tắc project. Command authorize exact caller trước input validation, clone service/handle cần thiết rồi chuyển database và filesystem blocking sang worker; không giữ `tauri::State` qua `.await`. `list_projects` cho phép exact `main` hoặc `quick-note` để project picker BE-017 dùng; tất cả command Projects còn lại chỉ cho exact `main`. Label khác trả `UnauthorizedWindow` trước database, filesystem, picker, opener hoặc runtime port.

Mọi command có persistent mutation lấy `DataReadPermit` sau picker/path validation thuần nhưng trước project mutation/removal gate, giữ permit qua transaction commit và `publish_data_change`; permit là hạ tầng Rust nội bộ, không thêm field vào command/DTO. Read-only list/get/open-folder/impact không lấy permit.

### `list_projects`

Trả danh sách project ghim trước, sau đó project không ghim theo thời điểm add; có thể lọc theo tên hoặc path.

```rust
/// Lists projects in stable display order with current availability.
#[tauri::command]
pub async fn list_projects(
    window: tauri::WebviewWindow,
    search: Option<String>,
    state: tauri::State<'_, ProjectService>,
) -> Result<Vec<ProjectDto>, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main` hoặc `quick-note`; search trim hai đầu, chuỗi rỗng thành `None`, tối đa `256` Unicode scalar value và cấm control character. |
| Side effect | Đọc database rồi kiểm tra metadata từng root path ngoài storage lock; không sửa row. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidSearch`, `PersistenceFailed`. |

Filter là Unicode case-insensitive theo `to_lowercase()` trong Rust trên `display_name` và `root_path`; không dùng SQLite `NOCASE` vì chỉ bảo đảm ASCII. Filter giữ nguyên thứ tự danh sách gốc.

### `get_project`

Trả một project cùng availability hiện tại.

```rust
/// Returns one project with current folder availability.
#[tauri::command]
pub async fn get_project(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; `project_id` phải là UUID hyphenated hợp lệ và tồn tại. |
| Side effect | Đọc database và filesystem; không cập nhật `last_opened_at_ms`. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `PersistenceFailed`. |

### `add_project`

Mở folder picker, đăng ký folder được chọn và trả project; cancel không tạo dữ liệu.

```rust
/// Selects and registers an existing project folder.
#[tauri::command]
pub async fn add_project(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectFolderSelectionDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; chỉ chọn một directory; path phải absolute, tồn tại, truy cập được, không phải filesystem root, biểu diễn UTF-8 lossless và canonicalize được; canonical target vẫn là directory. |
| Side effect | Native dialog; insert row trong transaction với `display_name` là final component, timestamps bằng clock service; phát `Added` sau commit. Không tạo/copy/clone folder. |
| Lỗi trả về | `UnauthorizedWindow`, `FolderPickerFailed`, `InvalidProjectFolder`, `InvalidDisplayName`, `ProjectAlreadyExists`, `ClockFailed`, `PersistenceFailed`. |

### `rename_project`

Đổi tên hiển thị; không đổi tên folder.

```rust
/// Renames a project without changing its folder.
#[tauri::command]
pub async fn rename_project(
    window: tauri::WebviewWindow,
    project_id: String,
    display_name: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; ID hợp lệ/tồn tại; tên trim dài `1..=255` Unicode scalar value, không control character; tên trùng được phép. |
| Side effect | Update đúng một row; phát `Updated` sau commit. Không chạm filesystem. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `InvalidDisplayName`, `RemovalInProgress`, `PersistenceFailed`. |

### `set_project_pinned`

Ghim hoặc bỏ ghim một project mà không đổi insertion order ban đầu.

```rust
/// Sets the pinned state of a project.
#[tauri::command]
pub async fn set_project_pinned(
    window: tauri::WebviewWindow,
    project_id: String,
    is_pinned: bool,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; ID hợp lệ/tồn tại. |
| Side effect | Update khi giá trị đổi; phát `Updated` sau commit. Không đổi `added_at_ms` hoặc `last_opened_at_ms`. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `RemovalInProgress`, `PersistenceFailed`. |

### `open_project`

Ghi nhận người dùng mở project overview và trả snapshot mới; project `Unavailable` vẫn mở được để locate/remove.

```rust
/// Records a project overview opening and returns current metadata.
#[tauri::command]
pub async fn open_project(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; ID hợp lệ/tồn tại. |
| Side effect | Đặt `last_opened_at_ms = max(now, added_at_ms, previous_last_opened_at_ms)`; phát `Updated` sau commit; sau đó kiểm availability. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `RemovalInProgress`, `ClockFailed`, `PersistenceFailed`. |

### `locate_project_folder`

Mở folder picker để thay root path cho project đang tồn tại; cancel giữ nguyên project.

```rust
/// Replaces a project's missing or relocated root folder.
#[tauri::command]
pub async fn locate_project_folder(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectFolderSelectionDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; project tồn tại; folder mới theo toàn bộ validation của `add_project`; `path_key` không thuộc project khác. Lệnh được phép cả khi root cũ còn available vì menu project có hành động relocate. |
| Side effect | Native dialog; update `root_path`/`path_key` trong transaction; giữ nguyên ID/name/pin/timestamps; phát `Updated` sau commit. Không restart session/process hiện có. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `FolderPickerFailed`, `InvalidProjectFolder`, `ProjectAlreadyExists`, `RemovalInProgress`, `PersistenceFailed`. |

### `open_project_folder`

Mở root hiện tại bằng file manager hệ điều hành.

```rust
/// Opens an available project root in the operating-system file manager.
#[tauri::command]
pub async fn open_project_folder(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<(), ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; project tồn tại; availability được kiểm lại ngay trước opener. Path chỉ lấy từ database, không nhận từ frontend. |
| Side effect | Gọi official opener plugin cho directory; không cập nhật `last_opened_at_ms`. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `ProjectUnavailable`, `OpenFolderFailed`, `PersistenceFailed`. |

### `get_remove_project_impact`

Tạo dữ liệu facts box cho dialog remove mà không thay đổi project/session.

```rust
/// Inspects sessions and unsaved work affected by removing a project.
#[tauri::command]
pub async fn get_remove_project_impact(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<RemoveProjectImpactDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; project tồn tại. |
| Side effect | Đọc metadata và gọi `ProjectRuntimeGuard::removal_impact`; không mutate. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `RuntimeInspectionFailed`, `PersistenceFailed`. |

### `remove_project`

Dừng runtime liên quan rồi xóa metadata sau xác nhận; không xóa folder/file.

```rust
/// Removes project metadata after explicit confirmation and runtime cleanup.
#[tauri::command]
pub async fn remove_project(
    window: tauri::WebviewWindow,
    project_id: String,
    confirmed: bool,
    state: tauri::State<'_, ProjectService>,
) -> Result<RemoveProjectResultDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; project tồn tại; `confirmed` phải `true` trong mọi trường hợp. Impact được tính lại sau khi đặt removal gate. |
| Side effect | Chặn create/mutation project; đóng toàn bộ runtime của project; delete row trong transaction; foreign key tương lai tự unlink note/event bằng `ON DELETE SET NULL`; phát `Removed` sau commit. Không gọi bất kỳ filesystem delete nào. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `ConfirmationRequired`, `RemovalInProgress`, `RuntimeInspectionFailed`, `RuntimeCleanupFailed`, `PersistenceFailed`. |

## Contract Rust nội bộ

Projects cung cấp query hẹp để composition root adapter sang consumer contract `ProjectSessionAccess` của `BE-005`, không để Sessions đọc repository hoặc database nội bộ:

```rust
pub struct ProjectAvailabilitySnapshot {
    pub project_id: String,
    pub is_available: bool,
}

pub struct AvailableProjectRoot {
    pub project_id: String,
    pub root_path: PathBuf,
}

pub struct ProjectRuntimeImpact {
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

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

pub struct ProjectImportMap {
    // Private validated source-ID to committed target-ID mapping.
}

pub struct ProjectImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
    pub path_matches: u32,
}

pub struct ProjectImportPlan {
    pub counts: ProjectImportCounts,
    pub import_map: ProjectImportMap,
    // Private owned row operations and post-commit projection.
}

pub struct ProjectCommittedProjection {
    // Private owned change payloads; no transaction, lock, path key, or callback.
}

impl ProjectImportMap {
    /// Resolves one validated source project ID to its committed target ID.
    pub fn resolve<'a>(&'a self, source_project_id: &str) -> Option<&'a str>;
}

pub type ProjectFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub(crate) trait ProjectPlatform: Send + Sync {
    /// Opens a native single-directory picker.
    fn select_folder<'a>(
        &'a self,
    ) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>>;

    /// Opens a validated directory in the operating-system file manager.
    fn open_folder<'a>(
        &'a self,
        path: &'a Path,
    ) -> ProjectFuture<'a, Result<(), ProjectsError>>;
}

pub trait ProjectRuntimeGuard: Send + Sync {
    /// Reports runtime work that a project removal would close.
    fn removal_impact<'a>(
        &'a self,
        project_id: &'a str,
    ) -> ProjectFuture<'a, Result<ProjectRuntimeImpact, ProjectsError>>;

    /// Closes every runtime session owned by a project.
    fn close_project<'a>(
        &'a self,
        project_id: &'a str,
    ) -> ProjectFuture<'a, Result<(), ProjectsError>>;
}

impl ProjectService {
    /// Lists one owner-produced project snapshot for commands and consumers.
    pub async fn list_projects(
        &self,
        search: Option<&str>,
    ) -> Result<Vec<ProjectDto>, ProjectsError>;

    /// Returns current availability for the Sessions consumer adapter.
    pub async fn session_availability(
        &self,
        project_id: &str,
    ) -> Result<ProjectAvailabilitySnapshot, ProjectsError>;

    /// Returns project identifiers in pinned-then-insertion order.
    pub async fn ordered_project_ids(&self) -> Result<Vec<String>, ProjectsError>;

    /// Returns a validated canonical root for backend filesystem consumers.
    pub async fn available_root(
        &self,
        project_id: &str,
    ) -> Result<AvailableProjectRoot, ProjectsError>;

    /// Exports deterministic project records in the coordinator snapshot.
    pub fn export_backup_records_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<Vec<ProjectBackupRecordV1>, ProjectsError>;

    /// Validates incoming projects and builds the project remap and merge plan.
    pub fn prepare_backup_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        records: &[ProjectBackupRecordV1],
    ) -> Result<ProjectImportPlan, ProjectsError>;

    /// Applies a prepared project merge inside the coordinator transaction.
    pub fn apply_backup_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &ProjectImportPlan,
    ) -> Result<ProjectCommittedProjection, ProjectsError>;

    /// Deletes project metadata inside the shared reset transaction.
    pub fn reset_projects_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<ProjectCommittedProjection, ProjectsError>;

    /// Publishes a prepared projection after the coordinator commit.
    pub fn publish_data_change(&self, projection: ProjectCommittedProjection);
}
```

- Tauri command `list_projects` clone `ProjectService` khỏi `State`, rồi chỉ chuyển `search.as_deref()` vào `ProjectService::list_projects`; AppRuntime/tray và consumer backend gọi cùng owner method, thường với `None`. Method validate/normalize search, đọc row, kiểm availability và trả đúng snapshot/order đã mô tả cho command; không có bản query song song đọc repository trực tiếp.
- `session_availability` trả not found riêng và `is_available = false` nếu folder unavailable hoặc project đang trong removal gate; đây là nguồn để `BE-005` chặn tạo session.
- `ordered_project_ids` dùng cùng `ORDER BY is_pinned DESC, added_at_ms ASC, id ASC` với `list_projects` và không kiểm filesystem.
- `available_root` kiểm lại availability và removal gate rồi trả `PathBuf` canonical cho `BE-004`, `BE-007` và capability file; không capability nào tự đọc `root_path` từ repository hoặc nhận path tương đương từ frontend.
- `ProjectImportMap` giữ representation opaque. Chỉ adapter composition `app/data_participants.rs` gọi `ProjectImportMap::resolve` để clone target ID vào backup record Notes/Events trước khi gọi owner prepare; source ID không có mapping trả `None` để adapter áp nullable unlink semantics. Notes, Calendar và Data Management không đọc field, iterator hoặc implementation nội bộ của map.
- Implementation giai đoạn 4 của `ProjectRuntimeGuard` trả zero impact/`Ok(())` vì chưa tồn tại session runtime. Khi `BE-005` được ghép, composition adapter triển khai `ProjectRuntimeGuard::removal_impact` bằng đúng `SessionManager::project_removal_impact` và `ProjectRuntimeGuard::close_project` bằng đúng `SessionManager::close_project_sessions`, rồi map owner error/type đã làm sạch; Projects không import implementation nội bộ của Sessions.
- Runtime guard phải idempotent: project không có session trả thành công; session đã đóng trong lần retry không làm cả operation thất bại.
- `ProjectBackupRecordV1`, plan, import map và committed projection là typed owner contract, không derive `TS` hoặc đi qua IPC. Prepare canonicalize/path-key, validate và dựng owned operations/map cùng committed cache projection; apply chỉ chạy SQL từ plan trong transaction coordinator. Plan/projection là owned, `Send + 'static`, không giữ connection/transaction/row borrow/lock guard/secret hoặc callback.
- Mọi API hậu tố `_in` dùng đúng `&rusqlite::Transaction<'_>` BE-012 truyền; không lấy `DataReadPermit`, project mutation/removal lock hoặc mở `with_connection`/`with_transaction` lồng. `publish_data_change` consume projection sau commit, không query lại database, không trả `Result`; cache/subscription swap nếu có là no-fail, còn Tauri invalidation chỉ best-effort.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `projects://changed` | `ProjectChangedEventDto` | Sau transaction add/rename/pin/open/locate/remove commit thành công. | Một lần emit cho mỗi mutation thực sự; không cam kết thứ tự giữa command chạy đồng thời; payload chỉ là invalidation key, consumer phải query lại và không áp trực tiếp như snapshot. Không phát khi picker cancel, validation lỗi hoặc update no-op. |

Availability đổi ngoài ứng dụng không tự phát event. Frontend phải re-query `list_projects` khi startup/main-window focus và `get_project`/`open_project` khi vào overview. Emit thất bại sau commit không đảo transaction hoặc biến command thành lỗi; command vẫn trả result chính xác, log chỉ event name/project ID và frontend re-query ở lifecycle tiếp theo.

## Business rule và invariant

1. Một project là metadata trỏ tới đúng một folder có sẵn; XWork không tạo, clone, copy, đổi tên, di chuyển hoặc xóa nội dung folder.
2. `path_key` duy nhất ngăn cùng canonical folder được add/relocate cho hai project; display name có thể trùng.
3. Folder picker chỉ cho chọn directory. Canonical target phải absolute, UTF-8 lossless, không phải filesystem root và vẫn là directory sau khi resolve symlink/junction.
4. Windows `path_key` dùng canonical path đã bỏ verbatim prefix an toàn, separator thống nhất và Unicode lowercase; macOS dùng canonical UTF-8 path với separator chuẩn và giữ case. `root_path` là canonical path thân thiện để hiển thị, không có trailing separator.
5. Project ID là UUID v4 hyphenated lowercase sinh ở backend; frontend không cấp ID, timestamp hoặc path.
6. Pinned project luôn đứng trước unpinned. Trong mỗi nhóm, `added_at_ms ASC, id ASC`; mở/rename/pin không đổi insertion order, unpin trả project về vị trí theo lúc add.
7. `last_opened_at_ms` không giảm dù system clock lùi; add đặt `added_at_ms = last_opened_at_ms` vì flow mở overview ngay sau insert.
8. Availability không persist và không dựa vào lần kiểm tra cũ: list/get/open-folder/create-session kiểm lại từ root hiện tại. `Missing`, `NotDirectory`, `AccessDenied` và `Io` đều map thành `Unavailable` nhưng giữ reason cho UI.
9. Project unavailable vẫn list được, mở overview được, rename/pin/remove/locate được; chỉ open folder và create session bị chặn.
10. Locate giữ mọi metadata ngoài `root_path`/`path_key`. Runtime cũ tiếp tục theo CWD ban đầu; session/process không được restart ngầm.
11. Remove luôn cần xác nhận, kể cả không có session. Dialog phải nêu folder/file vẫn nguyên và hiển thị count session/process/unsaved hiện tại.
12. Removal gate được đặt trước lần inspect cuối; `session_availability` trả unavailable trong gate để không session mới nào xuất hiện sau impact.
13. Row chỉ bị delete sau khi runtime guard đóng thành công. Nếu cleanup lỗi, giữ row/gate được gỡ; nếu database delete lỗi sau cleanup, row vẫn còn nhưng session đã dừng và retry remove an toàn.
14. Project remove không gọi filesystem delete. Bảng future có `project_id` cho note/event phải dùng nullable FK `ON DELETE SET NULL` để giữ dữ liệu và unlink trong cùng database transaction.
15. Nếu project được remove sau khi query nhưng trước mutation khác, mutation trả `ProjectNotFound`; không tự tạo lại row.
16. Mọi ordinary write lấy `DataReadPermit`, rồi project mutation/removal gate, rồi dùng `Storage::with_transaction`; giữ permit đến sau commit/cache-event publish. Read dùng `with_connection` và không cần permit; toàn callback SQLite chạy trong `spawn_blocking`, không giữ owner/storage lock qua `.await`.
17. Project DTO không chứa Git/session/file/note/event aggregate. Mỗi capability tổng hợp chỉ dùng public query và frontend/app ghép kết quả.
18. Mọi event phát sau commit và chỉ dùng để invalidate query. Picker cancel, no-op pin/locate cùng canonical path và validation failure không ghi database hay phát event.
19. Capability backend cần đọc project root phải gọi `available_root`; project missing/unavailable/removing bị từ chối trước khi caller chạm filesystem hoặc spawn process.
20. Lock order bắt buộc là `DataMaintenanceGate` → project mutation/removal gate → Storage. Owner `_in` maintenance API không re-enter gate, owner lock hoặc Storage; plan/projection là owned và chỉ publish sau coordinator commit.
21. Authorization dựa exact invoking window, không nhận label trong payload. `list_projects` cho `main` và `quick-note` vì BE-017 chỉ cần project picker read-only; chín command còn lại chỉ cho `main`, và unauthorized request bị từ chối trước input/service/platform side effect.
22. `ProjectImportMap` không lộ storage/map collection. Public `resolve` chỉ lookup một source ID đã validate, không query database, không mutate map và không cấp quyền cho domain khác phụ thuộc Projects internals.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum ProjectsError {
    UnauthorizedWindow,
    InvalidProjectId,
    ProjectNotFound { project_id: String },
    InvalidSearch,
    InvalidDisplayName,
    FolderPickerFailed,
    InvalidProjectFolder { reason: InvalidProjectFolderReasonDto },
    ProjectAlreadyExists { project_id: String },
    ProjectUnavailable { reason: ProjectUnavailableReasonDto },
    RemovalInProgress { project_id: String },
    ConfirmationRequired { impact: RemoveProjectImpactDto },
    RuntimeInspectionFailed,
    RuntimeCleanupFailed,
    OpenFolderFailed,
    ClockFailed,
    PersistenceFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum InvalidProjectFolderReasonDto {
    NotAbsolute,
    Missing,
    NotDirectory,
    FileSystemRoot,
    NotUtf8,
    AccessDenied,
    CannotCanonicalize,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Command Projects được invoke từ caller ngoài allowlist; `list_projects` cho `main`/`quick-note`, command khác chỉ cho `main`. | Không retry; sửa caller boundary và không chạm dữ liệu/platform. |
| `InvalidProjectId` | Input không parse được UUID hyphenated. | Không retry; refresh nguồn ID. |
| `ProjectNotFound` | Row không tồn tại hoặc vừa bị remove. | Đóng menu/overview stale và về Projects. |
| `InvalidSearch` | Query quá dài hoặc có control character. | Giữ danh sách cũ và báo validation. |
| `InvalidDisplayName` | Tên sau trim rỗng, quá 255 scalar hoặc có control character; gồm basename add không hợp lệ. | Giữ editor mở; add giữ nguyên folder. |
| `FolderPickerFailed` | Native dialog không mở/không trả kết quả hợp lệ. | Giữ màn hình và cho thử lại. |
| `InvalidProjectFolder` | Path chọn không thỏa validation theo reason. | Hiển thị thông điệp cụ thể và cho chọn folder khác. |
| `ProjectAlreadyExists` | `path_key` đã thuộc project hiện có. | Điều hướng tới `project_id` hiện có thay vì tạo bản sao. |
| `ProjectUnavailable` | Root persisted không còn dùng được khi open folder/create session. | Hiển thị banner `Unavailable`, `Locate folder…`, `Remove Project`. |
| `RemovalInProgress` | Mutation/query tạo session cạnh tranh với remove. | Disable thao tác và chờ event/query. |
| `ConfirmationRequired` | `remove_project` được gọi với `confirmed = false`. | Dựng dialog từ impact mới nhất và gọi lại với `true`. |
| `RuntimeInspectionFailed` | Không lấy được impact session/process an toàn. | Không cho confirm bằng dữ liệu thiếu; cho retry. |
| `RuntimeCleanupFailed` | Một hoặc nhiều session/process không đóng được. | Giữ project, báo cleanup thất bại và cho retry. |
| `OpenFolderFailed` | OS file manager không mở được root đã kiểm tra. | Hiển thị lỗi riêng và cho retry/locate. |
| `ClockFailed` | System clock trước Unix epoch hoặc không đọc được timestamp hợp lệ. | Không cập nhật/add; hiển thị lỗi chung có retry. |
| `PersistenceFailed` | Query/transaction/constraint/commit của storage thất bại. | Không optimistic commit; hiển thị lỗi lưu/tải và cho retry. |

Lỗi nội bộ giữ `StorageError`, OS error và source chain để chẩn đoán, nhưng payload/`Display` public không chứa path ngoài field `root_path` người dùng đã thấy, SQL, bind value hoặc chi tiết hệ thống nhạy cảm.

## Luồng chính

### Add Project

1. `add_project` gọi native directory picker từ Rust; cancel trả `Cancelled` và dừng.
2. Worker blocking kiểm tra path, canonicalize, tạo `root_path`/`path_key`, derive/validate basename; không giữ storage lock.
3. Service sinh UUID v4 và timestamp, insert row trong transaction. Unique `path_key` được map thành `ProjectAlreadyExists` với ID row hiện có qua query an toàn.
4. Sau commit, service kiểm availability, emit `Added` và trả `Selected { project }`; frontend đưa project vào sidebar rồi điều hướng overview.
5. Git detection không chạy trong luồng này cho tới khi `BE-004` tích hợp bằng public query riêng.

### Refresh và locate folder

1. `list_projects`/`get_project` đọc row trong một storage callback ngắn rồi nhả mutex.
2. Worker filesystem kiểm từng `root_path`; lỗi expected map thành `Unavailable`, không sửa database.
3. `locate_project_folder` mở picker và validate canonical path mới ngoài transaction.
4. Transaction kiểm project vẫn tồn tại, removal gate không active và `path_key` không thuộc row khác rồi update đúng hai path field.
5. Sau commit emit `Updated`; session cũ tiếp tục, session mới lấy root mới qua public project query.

### Remove Project

1. `get_remove_project_impact` đọc metadata rồi gọi runtime guard để frontend dựng dialog nói rõ folder/file không bị xóa và số runtime bị ảnh hưởng.
2. `remove_project(..., false)` luôn tính impact hiện tại và trả `ConfirmationRequired`; không side effect.
3. Với `confirmed = true`, service đặt removal gate theo project ID, tính lại impact và gọi runtime guard đóng mọi session; create session/mutation cạnh tranh bị chặn.
4. Khi cleanup thành công, transaction delete đúng row. FK future tự unlink dữ liệu liên kết; không có filesystem delete.
5. Commit xong mới emit `Removed` và trả ID. Mọi exit path bỏ gate; cleanup hoặc persistence lỗi trả typed error theo invariant partial failure đã nêu.

## Ràng buộc kỹ thuật

- Blocking: SQLite, `metadata`, `canonicalize` và path checks chạy qua `tauri::async_runtime::spawn_blocking`; native dialog/opener dùng async API/plugin phù hợp. Không giữ `Storage` mutex, project removal gate guard hoặc `tauri::State` qua `.await`.
- Bảo mật: Add/locate không nhận path từ frontend; open-folder chỉ dùng root đã lưu. Reject filesystem root, non-directory và UTF-8 lossy path. Dùng SQL bind parameters; không log path, display name, SQL/bind value hay filesystem error chi tiết.
- Hiệu năng: query database một lần, nhả lock, filter metadata trong Rust rồi chỉ kiểm availability cho các row được trả; filter giữ order. Không scan cây folder, không chạy Git và không đọc nội dung file. Workload Phase 1 không cần pool/cache/watcher riêng.
- Concurrency: unique constraint là authority chống add/locate trùng; removal gate tuần tự mutation cùng project; timestamp update monotonic bằng `max`. Ordinary write giữ shared read permit theo lock order; BE-012 giữ write permit và gọi `_in` gate-free nên không deadlock/re-entry.
- Platform: Windows development kiểm path drive/UNC, separator, case-insensitive duplicate, missing folder và opener. macOS validation để release preparation theo quy tắc project.
- Generated contract: binding chỉ sinh từ Rust vào `src/bindings/projects/`; test fail nếu drift, không sửa tay.

## Tiêu chí hoàn thành

- [ ] Migration `0001_create_projects.sql` được registry version `1` chạy đúng một lần, tạo schema/index chính xác và rollback nguyên version khi lỗi.
- [ ] Add qua native picker chỉ nhận folder có sẵn, derive tên, UUID/timestamp/path key đúng; cancel/no-op không ghi dữ liệu hoặc emit event.
- [ ] Cùng canonical folder bị chặn cả add và locate, gồm khác separator/case trên Windows; folder khác có cùng display name vẫn được phép.
- [ ] List ghim trước rồi insertion order ổn định; search Unicode theo name/path không đổi order.
- [ ] Rename chỉ đổi display name; pin/unpin không đổi added/opened time và unpin trở về insertion order.
- [ ] `open_project` cập nhật last-opened không giảm; unavailable project vẫn mở overview được.
- [ ] Missing/not-directory/access-denied/I/O map đúng availability; query không persist trạng thái stale; open-folder/create-session bị chặn khi unavailable.
- [ ] Locate giữ ID/name/pin/timestamps/links, không restart runtime cũ và session mới dùng root mới.
- [ ] Remove luôn yêu cầu xác nhận, facts box có count hiện tại, impact được tính lại sau removal gate và session mới không chen vào.
- [ ] Cleanup lỗi giữ project; delete lỗi sau cleanup giữ metadata và retry an toàn; thành công xóa metadata nhưng folder/file không đổi.
- [ ] Mọi persistent mutation giữ `DataReadPermit` qua commit/publish; BE-012 write permit chặn mutation và owner `_in` apply/reset chạy trong một shared transaction không re-enter gate/Storage.
- [ ] Lát cắt BE-003 tạo `shared/mod.rs` và `shared/maintenance.rs`; composition root chỉ tạo một `DataMaintenanceGate` và project service nhận đúng shared instance mà BE-005/BE-012 tiếp tục dùng.
- [ ] Backup/reset dùng typed `ProjectImportPlan`/`ProjectCommittedProjection`; commit mới publish no-fail projection, rollback không đổi cache/subscription hoặc phát owner invalidation.
- [ ] Public `ProjectService::list_projects` tạo cùng snapshot/order cho Tauri command và backend consumers; `session_availability`/`ordered_project_ids` đáp ứng chính xác consumer contract `BE-005` mà không lộ repository.
- [ ] Mọi command nhận invoking `WebviewWindow`: `list_projects` chỉ cho exact `main`/`quick-note`, chín command còn lại chỉ cho exact `main`; caller khác nhận `UnauthorizedWindow` trước mọi query, picker, opener, runtime hoặc mutation.
- [ ] `ProjectImportMap::resolve` cho adapter app lookup đúng source→target/dangling `None` mà vẫn giữ representation opaque; Notes/Events không phụ thuộc Projects internals.
- [ ] Public `available_root` chỉ trả canonical `PathBuf` cho project available và chặn missing/unavailable/removing cho Git, Terminal và Files consumer.
- [ ] `projects://changed` chỉ phát sau commit thực, consumer re-query theo project ID và không bị stale khi event đồng thời đến lệch thứ tự; emit lỗi không đổi command result.
- [ ] DTO/error TypeScript sinh từ Rust, không có contract viết tay hoặc field aggregate của capability khác.
- [ ] Mọi function/method/callback/test/helper có comment ngắn; path normalization và partial remove có inline comment giải thích invariant.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và `cargo test --all-targets --all-features` pass.
- [ ] Frontend formatter/lint/type-check/unit/component test và build liên quan pass với database/folder fixture tạm; smoke thủ công Windows xác nhận folder picker và opener native.
- [ ] `pnpm tauri build` pass vì có migration, managed state, plugin, invoke handler và generated binding mới.
- [ ] Native folder picker và opener được smoke test thủ công trên Windows vì WebDriver chỉ điều khiển webview, không giả lập dialog/file manager hệ điều hành.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/projects/models.rs` (`#[cfg(test)]`) | Unit | UUID/name/search validation, row mapping, ordering key, availability/error DTO serialization. |
| `src-tauri/src/projects/service.rs` (`#[cfg(test)]`) | Unit | Windows/macOS path-key fixture, basename/root rejection, list owner snapshot dùng chung với command/consumer, opaque `ProjectImportMap::resolve` found/missing, read-permit/lock order, typed maintenance plan/projection, clock monotonic, runtime guard gate, remove partial failure và event timing. |
| `src-tauri/src/projects/repository.rs` (`#[cfg(test)]`) | Unit | SQL bind/mapping, unique path, stable order, transaction rollback và not-found race bằng in-memory SQLite. |
| `src-tauri/src/projects/platform.rs` (`#[cfg(test)]`) | Unit | Picker cancel/failure và opener call qua fake adapter; không mở native UI trong test tự động. |
| `src-tauri/tests/projects_commands.rs` | Integration | Migration thật trên temp database; `list_projects` thành công từ `main`/`quick-note`, command khác chỉ từ `main`, caller sai nhận `UnauthorizedWindow` trước side effect; add/locate bằng temp directory qua service seam, command list khớp owner query, persistence, typed errors/event, remove không xóa folder và adapter gọi đúng hai owner method BE-005. |
| `src-tauri/tests/data_management_contract.rs` | Integration | Write permit chặn project mutation; export/prepare/apply/reset dùng shared transaction, opaque project map chỉ được app adapter gọi `resolve` cho linked/dangling IDs, rollback không publish và commit publish projection no-fail. |
| `src-tauri/tests/app_builder.rs` | Integration | Composition root tạo đúng một shared gate, inject cùng identity vào ProjectService và đăng ký storage/project state, plugins, commands với Tauri mock runtime. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export toàn bộ DTO/error Projects gồm `UnauthorizedWindow` và fail khi generated TypeScript lệch Rust source. |

Fixture filesystem/database chỉ dùng temporary directory, không dùng project đang phát triển hoặc app data thật. Test remove guard dùng fake xác định được cho zero runtime, blocker, cleanup failure và race; integration với process thật thuộc `BE-005`/`BE-007`.

## Câu hỏi mở

Không có.
