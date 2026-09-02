# BE-014 — File read và watch

Tài liệu này đặc tả backend mở file project vào pane, phân loại text/binary/too-large, giữ file handle runtime, theo dõi thay đổi bên ngoài và cung cấp recent files cho Project Overview. Mọi lần mở và reconcile đều dùng project root cùng path policy của Projects/File tree; frontend không nhận quyền filesystem tổng quát.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-014` |
| Phase | `2` |
| Capability | `src-tauri/src/files/` |
| Yêu cầu chức năng | §11.2–11.3, §7.5; liên quan §1–2, §4.3, §9.2, §14, §18 và §20 Phase 2 |
| Frontend liên quan | `FE-005`, `FE-016`, `FE-017`, `FE-018`; mở rộng source Files cho `FE-009` |
| Phụ thuộc | Core Phase 2: `BE-002`, `BE-003`, `BE-005`, `BE-013`; maintenance/reset extension: `BE-012`; migration version `5` của `BE-011` phải đứng trước version `6` |

## Mục tiêu

Backend đọc an toàn file nằm trong project đã đăng ký, trả nội dung/metadata đủ cho source viewer hoặc trạng thái binary/too-large, gắn file handle vào pane runtime và phát invalidation khi file thay đổi ngoài XWork. Capability đồng thời lưu danh sách file mở gần đây theo project, bảo toàn buffer Markdown chưa lưu khi có xung đột và cung cấp public query hẹp cho Unified Search.

### Quyết định và giả định đã chốt

- Viewer limit là `5 * 1024 * 1024 = 5_242_880` byte. UI dùng nhãn thân thiện `5 MB` đúng wireframe; DTO luôn mang số byte thật và limit thật để không phụ thuộc cách format.
- Thứ tự phân loại là `TooLarge` trước, sau đó `Binary`, cuối cùng `Text`. File lớn hơn limit không được đọc vào memory; file trong limit là binary nếu chứa byte NUL hoặc không decode UTF-8 lossless. UTF-8 BOM được chấp nhận, bỏ khỏi `text` nhưng ghi cờ để `BE-015` giữ nguyên khi save.
- Chỉ `.md` và `.markdown` không phân biệt hoa thường là Markdown có thể được `BE-015` chỉnh sửa; text khác luôn `SourceReadOnly`. Không suy đoán editable từ MIME.
- `notify::RecommendedWatcher` theo dõi parent directory của file bằng `NonRecursive`, ref-count giữa các handle. Cách này nhận được atomic-save/rename thay thế target mà không scan toàn project.
- Native watcher chỉ là hint: event được debounce `100 ms`, sau đó backend revalidate và đọc/hash target. Event trùng mà disk fingerprint không đổi không làm tăng revision hoặc phát IPC.
- Nếu native watch không cài được cho một parent, handle chuyển sang targeted polling fallback: kiểm metadata mỗi `2 s`, hash/read khi metadata đổi, và reconcile đầy đủ khi main window focus. `BE-015` vẫn phải so disk fingerprint ngay trước save nên fallback không làm mất bảo vệ xung đột.
- Handle sạch tự reload khi disk đổi. Handle Markdown bẩn giữ nguyên local buffer và chuyển `ExternalConflict`; không content nào bị ghi hoặc thay thế âm thầm.
- Hook editor dành cho BE-015 nhận `base_disk_revision` của disk version đã render, không nhận `edit_count` từ frontend. Manager tự derive dirty transition, `dirty_since_ms` và `edit_count`; base token đồng thời giữ được draft nếu watcher auto-reload chen giữa render và edit đầu tiên.
- `KeepMine` chỉ xác nhận disk version mới làm base, giữ local buffer bẩn và không ghi file. `ReloadFromDisk` đọc lại disk rồi thay local buffer, clear dirty; đây là hành động mất dữ liệu chỉ chạy sau lựa chọn explicit của người dùng.
- Recent files persist tối đa `50` row/project; query mặc định trả `10`, tối đa `50`. Binary/too-large vẫn được ghi recent nếu pane attach thành công vì người dùng đã mở chúng.
- Migration được khóa là `0006_create_recent_files.sql`. BE-014 không phụ thuộc nghiệp vụ Notifications, nhưng registry BE-002 phải có versions `1..=5` liên tiếp trước khi thêm version `6`; version `5` thuộc lát cắt BE-011 theo roadmap.
- MIME chỉ là extension hint từ `mime_guess`, không được dùng để quyết định text/binary hoặc làm kiểm tra bảo mật.
- Khi BE-012 được ghép, mọi upsert/prune Recent Files thông thường lấy shared maintenance read permit. Reset dùng typed reset-only API trong transaction xuyên domain; nó chỉ xóa `recent_files`, không đóng handle, watcher hoặc buffer.
- Cleanup watcher/file buffer trong app reset tiếp tục đi duy nhất qua `SessionManager::shutdown_all` → `PaneContentRuntime` → `FileHandleManager`; reset-only participant không gọi lifecycle API lần hai.

### Ngoài phạm vi

- Duyệt/filter cây, copy path và reveal trong file manager; dùng command/path resolver của `BE-013`.
- Ghi file Markdown, atomic replace, fsync và pre-save conflict commit; các side effect ghi thuộc `BE-015`.
- Editor UI, syntax highlighting, render Markdown/raw HTML policy hoặc lựa chọn tab/pane; frontend chuẩn bị pane `Empty`, Files chỉ attach handle.
- Mở/sửa binary, source edit, LSP, format, diff, merge hoặc theo dõi file chưa mở.
- Persist file content, editor buffer, watcher/handle/tab state hoặc khôi phục chúng sau Quit; recent files chỉ lưu metadata tương đối.
- Index nội dung file. Public Files search chỉ tìm tên theo ignore/path policy BE-013.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo exact dependency `notify = "=8.2.0"`, `mime_guess = "=2.0.5"`, `blake3 = "=1.8.7"`; dùng storage/Serde/UUID/Tokio/opener đã có. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi cập nhật manifest. |
| `src-tauri/migrations/0006_create_recent_files.sql` | Tạo bảng/index recent files thuộc Files. |
| `src-tauri/src/storage/migrations.rs` | Đăng ký migration version `6`, name `create_recent_files` bằng `include_str!`. |
| `src-tauri/src/lib.rs` | Giữ export module `files` sau khi capability được mở rộng. |
| `src-tauri/src/shared/mod.rs` | Re-export app-wide `DataMaintenanceGate` không phụ thuộc capability nghiệp vụ. |
| `src-tauri/src/shared/maintenance.rs` | Shared read/write permit và lock order theo BE-012. |
| `src-tauri/src/app/mod.rs` | Ghép storage, maintenance gate, Files dependencies, handle manager, watcher/event/platform adapter; late-bind lifecycle router, reset adapter và đăng ký command. |
| `src-tauri/src/app/data_reset_participants.rs` | Adapter typed Recent Files reset-only sang `DataResetOnlyParticipant` BE-012. |
| `src-tauri/src/app/search_sources.rs` | Adapter public `FilesService::search_openable_files` sang Files source của BE-010, không đọc repository/path state nội bộ. |
| `src-tauri/src/files/mod.rs` | Re-export DTO/error/service, lifecycle delegate và public search/recent contract cần cho composition/consumer. |
| `src-tauri/src/files/models.rs` | DTO open handle/content/version/conflict/recent/event cùng internal search/editor value type. |
| `src-tauri/src/files/path_policy.rs` | Tái sử dụng `ProjectRootIdentity`, intent resolver, validated path/writer target và revalidation của BE-013 cho open cùng handle đã bind. |
| `src-tauri/src/files/walker.rs` | Cung cấp name-search regular-file slice cho public BE-010 adapter theo cùng ignore/sort policy BE-013. |
| `src-tauri/src/files/reader.rs` | Sở hữu `PlatformFileIdentity`/`DiskFingerprint`; open/read/hash blocking, size/binary/UTF-8/BOM/line-ending/MIME classification và read-race detection. |
| `src-tauri/src/files/watcher.rs` | `notify` parent watch ref-count, bounded hint queue, debounce, overflow/fallback polling và shutdown. |
| `src-tauri/src/files/handles.rs` | Ownership file handle/buffer/revision, editor dirty transition, watcher reconcile, conflict resolution và lifecycle close/reopen/discard. |
| `src-tauri/src/files/repository.rs` | SQL bind/query/upsert/prune recent files qua `Storage`. |
| `src-tauri/src/files/service.rs` | Orchestration pane target, available root, pending attach, recent persistence, reload/open-external và public query. |
| `src-tauri/src/files/platform.rs` | Mở file đã revalidate bằng default app qua official opener; fake adapter cho test. |
| `src-tauri/src/files/commands.rs` | Tauri command mỏng, main-window/input validation và mapping DTO/error. |
| `src-tauri/src/files/error.rs` | Mở rộng `FilesError`/warning và làm sạch lỗi Projects/Sessions/storage/notify/I/O/opener. |
| `src-tauri/src/settings/data_participant.rs` | Tagged reset-only plan/projection consumer contract do BE-012 sở hữu. |
| `src-tauri/tests/app_builder.rs` | Xác nhận storage/Files/Sessions router late-bind, managed state, watcher shutdown và command registration. |
| `src-tauri/tests/files_read_watch_commands.rs` | Integration test migration, public commands, filesystem fixture, watcher/recent/pane lifecycle. |
| `src-tauri/tests/data_management_contract.rs` | Reset Recent Files trong shared transaction, publish invalidation và không duplicate runtime cleanup. |
| `src-tauri/tests/export_bindings.rs` | Sinh và kiểm tra TypeScript binding cho DTO/error/event public mới của Files. |
| `src/bindings/files/` | Output TypeScript do `ts-rs` sinh; không chỉnh tay. |
| `tests/e2e/files.e2e.ts` | Mở rộng desktop E2E Windows cho source, unsupported, recent files và external-change conflict. |

Không cấp Tauri filesystem/opener permission cho webview. Custom command chỉ được đăng ký ở composition root; opener và watcher chỉ được gọi trong Rust.

## Dữ liệu

### Bảng `recent_files`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `project_id` | `TEXT` | `NOT NULL`, FK `projects(id) ON DELETE CASCADE` | Project sở hữu recent entry. |
| `path_key` | `TEXT` | `NOT NULL`, cùng `project_id` là PK | Khóa relative path theo OS để upsert cùng file. |
| `relative_path` | `TEXT` | `NOT NULL` | Relative UTF-8 path chuẩn `/` gần nhất dùng để hiển thị/mở lại. |
| `opened_at_ms` | `INTEGER` | `NOT NULL`, `CHECK(opened_at_ms >= 0)` | Unix epoch millisecond UTC của lần attach pane thành công gần nhất. |

- Primary key: `PRIMARY KEY (project_id, path_key)`; table dùng `WITHOUT ROWID`.
- Index: `CREATE INDEX recent_files_by_project_opened ON recent_files(project_id, opened_at_ms DESC, path_key ASC)`.
- Migration: `src-tauri/migrations/0006_create_recent_files.sql`.

Schema chính xác:

```sql
CREATE TABLE recent_files (
    project_id TEXT NOT NULL,
    path_key TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    opened_at_ms INTEGER NOT NULL CHECK (opened_at_ms >= 0),
    PRIMARY KEY (project_id, path_key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CHECK (length(path_key) BETWEEN 1 AND 4096),
    CHECK (length(relative_path) BETWEEN 1 AND 4096)
) WITHOUT ROWID;

CREATE INDEX recent_files_by_project_opened
    ON recent_files(project_id, opened_at_ms DESC, path_key ASC);
```

Registry thêm đúng `Migration { version: 6, name: "create_recent_files", sql: include_str!("../../migrations/0006_create_recent_files.sql") }`. Runner BE-002 sở hữu transaction và `PRAGMA user_version`; file SQL không chứa `BEGIN`, `COMMIT`, `PRAGMA` hoặc sửa migration versions `1..=5`.

`path_key` dùng relative path đã validate: Windows Unicode lowercase và separator `/`; macOS giữ exact UTF-8 casing, cùng nguyên tắc path identity của BE-003/013. Rust kiểm giới hạn `4.096` byte; SQLite CHECK chỉ bảo vệ shape tối thiểu.

## DTO public

Mọi DTO dưới đây derive `Clone`, `Debug`, `Serialize`, `Deserialize`, `TS`; struct dùng `camelCase`, enum có dữ liệu dùng discriminator `kind`, enum đơn serialize chuỗi `camelCase`.

```rust
pub struct OpenFileInPaneRequestDto {
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub relative_path: String,
}

pub struct FileHandleRequestDto {
    pub file_handle_id: String,
}

pub struct ResolveExternalFileChangeRequestDto {
    pub file_handle_id: String,
    pub expected_revision: String,
    pub resolution: ExternalFileResolutionDto,
}

pub enum ExternalFileResolutionDto {
    KeepMine,
    ReloadFromDisk,
}

pub enum TextFileModeDto {
    SourceReadOnly,
    Markdown,
}

pub enum TextEncodingDto {
    Utf8,
}

pub enum LineEndingDto {
    None,
    Lf,
    Crlf,
    Mixed,
}

pub struct TextFileDto {
    pub text: String,
    pub byte_size: u64,
    pub line_count: u32,
    pub mime_type: String,
    pub syntax_hint: Option<String>,
    pub encoding: TextEncodingDto,
    pub has_utf8_bom: bool,
    pub line_ending: LineEndingDto,
    pub mode: TextFileModeDto,
}

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileContentDto {
    Text { file: TextFileDto },
    Binary { byte_size: u64, mime_type: String },
    TooLarge { byte_size: u64, limit_bytes: u64, mime_type: String },
}

pub struct FileDiskVersionDto {
    pub disk_revision: String,
    pub observed_at_ms: i64,
    pub modified_at_ms: Option<i64>,
    pub byte_size: u64,
    pub mime_type: String,
}

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileHandleStateDto {
    Ready { content: FileContentDto, disk: FileDiskVersionDto },
    ExternalConflict {
        local: TextFileDto,
        external: FileDiskVersionDto,
    },
    Missing {
        last_disk: Option<FileDiskVersionDto>,
        local: Option<TextFileDto>,
    },
    Unreadable {
        last_disk: Option<FileDiskVersionDto>,
        local: Option<TextFileDto>,
    },
    ProjectRootChanged,
}

pub enum FileWatchModeDto {
    Native,
    PollingFallback,
}

pub struct FileHandleDto {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub name: String,
    pub relative_path: String,
    pub revision: String,
    pub watch_mode: FileWatchModeDto,
    pub is_dirty: bool,
    pub dirty_since_ms: Option<i64>,
    pub edit_count: u32,
    pub state: FileHandleStateDto,
}

pub enum OpenFileWarningDto {
    RecentFileNotRecorded,
}

pub struct OpenFileResultDto {
    pub file: FileHandleDto,
    pub warnings: Vec<OpenFileWarningDto>,
}

pub enum RecentFileAvailabilityDto {
    Available,
    Missing,
    NotVisible,
    LinkDenied,
    ProjectUnavailable,
    Unreadable,
}

pub struct RecentFileDto {
    pub project_id: String,
    pub name: String,
    pub parent_path: String,
    pub relative_path: String,
    pub opened_at_ms: i64,
    pub availability: RecentFileAvailabilityDto,
    pub is_open: bool,
    pub has_unsaved_changes: bool,
}

pub struct FileHandleChangedEventDto {
    pub file_handle_id: String,
    pub revision: String,
    pub change: FileHandleChangeKindDto,
}

pub enum FileHandleChangeKindDto {
    Reloaded,
    ConflictDetected,
    Missing,
    Unreadable,
    ProjectRootChanged,
    WatchModeChanged,
}

pub struct RecentFilesChangedEventDto {
    pub project_id: String,
}
```

- `revision` là số nguyên thập phân serialize thành string để không mất precision qua JavaScript; `disk_revision` là token opaque của disk fingerprint và chỉ đổi khi disk snapshot được reconcile.
- `syntax_hint` là extension lowercase lossless không có dấu chấm, hoặc `None`; frontend chọn highlighter và không gửi lại field này làm path.
- `line_count` là `0` cho empty text, nếu không là số newline logic và được tính checked/cap `u32::MAX`.
- `modified_at_ms = None` nếu filesystem không cung cấp timestamp hợp lệ; `observed_at_ms` vẫn cho dialog hiển thị thời điểm XWork phát hiện.
- `ExternalConflict` chỉ tồn tại với local Markdown text dirty. Source read-only, binary và too-large không tạo local dirty state.
- `Missing.local`/`Unreadable.local` là `Some` chỉ khi handle có Markdown buffer bẩn; frontend tiếp tục hiển thị/cho sao chép buffer phục hồi trong khi disk target không dùng được. Handle sạch trả `None`.
- `warnings` không vượt `1`; watcher fallback là trạng thái hoạt động được thể hiện bằng `watch_mode`, không phải open failure.

## Tauri command

Mọi command chỉ chấp nhận `WebviewWindow::label() == "main"`; window khác nhận `WindowNotAllowed` trước khi chạm runtime/storage/filesystem.

### `open_file_in_pane`

Đọc file và attach một handle vào pane `Empty` đã được FE-016/017 chuẩn bị.

```rust
#[tauri::command]
async fn open_file_in_pane(
    request: OpenFileInPaneRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<OpenFileResultDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Window `main`; session/tab/pane tồn tại, quan hệ đúng và pane `Empty`; project ID được derive từ session; relative path tuân BE-013, visible, tồn tại, là regular file, không có symlink/reparse/mount component. |
| Side effect | Đọc/hash file; tạo pending handle/watcher; attach `PaneContentRef::File`; publish handle; lấy maintenance read permit để upsert/prune recent files và phát recent invalidation sau commit. Không ghi project file. |
| Lỗi trả về | Lỗi window/pane/project/path, `NotRegularFile`, `FileChangedDuringRead`, `FileReadFailed`, `FileMemoryLimitReached`, `SessionAttachFailed`, `ClockFailed`. Recent persistence lỗi không đảo handle đã attach mà trả warning. |

File size `> 5_242_880` trả `TooLarge`, không phải error. Binary cũng attach pane và trả `Binary`. Pending handle không phát event; attach thất bại phải unwatch/drop buffer và không ghi recent.

### `get_open_file`

Trả snapshot authority hiện tại của một handle sau event hoặc khi view mount lại.

```rust
#[tauri::command]
async fn get_open_file(
    request: FileHandleRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Window main; handle UUID thuộc runtime hiện tại và đang attached hoặc retained-reopen hợp lệ. |
| Side effect | Không có; clone snapshot bounded trong memory, không đọc disk. |
| Lỗi trả về | `WindowNotAllowed`, `InvalidFileHandleId`, `FileHandleNotFound`. |

### `reload_open_file`

Reconcile thủ công một handle sạch với disk, dùng cho Retry/focus khi watcher bị gián đoạn.

```rust
#[tauri::command]
async fn reload_open_file(
    request: FileHandleRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Handle attached; local buffer không dirty và không ở `ExternalConflict`; current project root/path vẫn hợp lệ và không link. |
| Side effect | Đọc/hash disk, thay snapshot nếu đổi, tăng revision và phát handle event sau update. Không ghi disk/recent. |
| Lỗi trả về | Lỗi handle/project/path/read tương ứng, `UnsavedChangesWouldBeLost`, `ProjectRootChanged`. |

### `resolve_external_file_change`

Áp lựa chọn explicit cho conflict của Markdown dirty.

```rust
#[tauri::command]
async fn resolve_external_file_change(
    request: ResolveExternalFileChangeRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Handle đang `ExternalConflict`; `expected_revision` đúng revision hiện tại; root/path còn hợp lệ. Backend đọc fingerprint disk lại trước commit resolution. |
| Side effect | `KeepMine`: giữ local dirty, thay base disk fingerprint và clear conflict. `ReloadFromDisk`: thay content/classification bằng disk mới, clear dirty/edit count/conflict. Không ghi disk/recent. Cả hai tăng revision và phát event `Reloaded`. |
| Lỗi trả về | `RevisionConflict`, `NoExternalConflict`, `FileChangedAgain`, lỗi root/path/read; lỗi không được xóa local buffer/conflict. |

Nếu disk đã đổi sau snapshot dialog, command cập nhật conflict bằng version mới, tăng revision/phát `ConflictDetected`, rồi trả `FileChangedAgain`; UI phải render lại facts thay vì áp choice lên version cũ.

### `open_file_with_default_app`

Mở file của handle hiện có bằng ứng dụng mặc định, dùng cho binary/too-large state.

```rust
#[tauri::command]
async fn open_file_with_default_app(
    request: FileHandleRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<(), FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Handle attached; root hiện tại vẫn khớp root handle; target tồn tại, regular file, không link/reparse/mount. |
| Side effect | Gọi official opener `open_path` từ Rust; không ghi file/database và không shell command. |
| Lỗi trả về | Lỗi handle/project/path tương ứng, `ProjectRootChanged`, `OpenExternalFailed`. |

### `list_recent_files`

Trả recent files cho Project Overview, kết hợp persistence với trạng thái runtime hiện tại.

```rust
#[tauri::command]
async fn list_recent_files(
    project_id: String,
    limit: Option<u32>,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<Vec<RecentFileDto>, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Window/project ID; `limit` mặc định `10`, hợp lệ `1..=50`. Project tồn tại; unavailable project vẫn trả row với availability tương ứng. |
| Side effect | Đọc SQLite và kiểm tối đa `limit` path hiện tại; không tự xóa row missing/ignored và không cập nhật timestamp. |
| Lỗi trả về | `InvalidProjectId`, `ProjectNotFound`, `InvalidLimit`, `RecentFilesFailed`; availability filesystem từng row nằm trong DTO, không làm fail cả list. |

Sort bắt buộc `opened_at_ms DESC, path_key ASC`. `is_open` đúng nếu có attached handle cho path; `has_unsaved_changes` đúng nếu ít nhất một handle cùng path dirty/conflict.

## Contract Rust nội bộ và tích hợp capability

Files sở hữu consumer-side port; composition adapter chỉ gọi public contract BE-003/005:

```rust
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlatformFileIdentity {
    Windows { volume_serial_number: u64, file_id: u128 },
    Unix { device: u64, inode: u64 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DiskFingerprint {
    pub file_identity: Option<PlatformFileIdentity>,
    pub byte_size: u64,
    pub modified_at: Option<std::time::SystemTime>,
    pub content_digest: blake3::Hash,
}

pub struct FilePaneTarget {
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub project_id: String,
}

pub struct OpenableFileSearchItem {
    pub project_id: String,
    pub relative_path: String,
    pub file_name: String,
    pub source_order: u32,
}

pub struct OpenableFileSearchSlice {
    pub items: Vec<OpenableFileSearchItem>,
    pub has_more: bool,
}

pub struct FileEditorSnapshot {
    pub text: String,
    pub expected_handle_revision: String,
    pub base_disk_revision: String,
}

pub type FilesFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait FileDependencies: Send + Sync {
    /// Resolves one current empty pane and derives its immutable project identity.
    fn resolve_empty_pane<'a>(
        &'a self,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
    ) -> FilesFuture<'a, Result<FilePaneTarget, FilesError>>;

    /// Resolves the current canonical available root through BE-003.
    fn available_project_root<'a>(
        &'a self,
        project_id: &'a str,
    ) -> FilesFuture<'a, Result<PathBuf, FilesError>>;

    /// Returns project IDs in Projects-owned stable order for file search.
    fn ordered_project_ids<'a>(
        &'a self,
    ) -> FilesFuture<'a, Result<Vec<String>, FilesError>>;

    /// Atomically replaces an empty pane with Files-owned content.
    fn attach_file<'a>(
        &'a self,
        target: &'a FilePaneTarget,
        file_handle_id: &'a str,
        title: &'a str,
    ) -> FilesFuture<'a, Result<(), FilesError>>;
}

impl FilesService {
    /// Returns bounded regular-file candidates for the BE-010 adapter.
    pub async fn search_openable_files(
        &self,
        query: &str,
        candidate_limit: u32,
    ) -> Result<OpenableFileSearchSlice, FilesError>;

    /// Replaces the local Markdown buffer state accepted by BE-015.
    pub async fn replace_editor_snapshot(
        &self,
        file_handle_id: &str,
        snapshot: FileEditorSnapshot,
    ) -> Result<FileHandleDto, FilesError>;

    /// Reconciles all attached handles after main-window focus or watcher overflow.
    pub async fn reconcile_open_files(&self) -> Result<(), FilesError>;
}
```

- `reader.rs` sở hữu hai type fingerprint nội bộ trên; BE-015 import trực tiếp thay vì định nghĩa lại. Windows lấy volume serial cùng `FILE_ID_128`; macOS/Unix lấy device cùng inode. Platform không cung cấp identity ổn định thì dùng `None`, nhưng size/mtime và BLAKE3 của toàn bộ raw bytes vẫn bắt buộc.
- `disk_revision` là token public opaque do manager gắn với đúng `DiskFingerprint`; fingerprint đầy đủ chỉ ở memory, không serialize, persist hoặc log. Equality phục vụ read-race, watcher reconcile và pre-save compare của BE-015.
- `resolve_empty_pane` dùng snapshot tương đương `SessionManager::get_session`, kiểm session project, tab/pane relation và `PaneContentDto::Empty`. `attach_file` gọi `SessionManager::attach_runtime_content(PaneContentRef::File)`; Sessions là authority cuối chống pane đổi/đóng trong lúc read.
- Adapter `available_project_root` gọi `ProjectService::available_root`; Files không đọc project repository/path field. `ordered_project_ids` gọi public query cùng tên của BE-003.
- Open mới resolve bằng intent `OpenVisibleFile`; reload/reconcile/open-default của handle dùng `ExistingHandleFile` với `ProjectRootIdentity` đã capture. Mọi path side effect dùng `FilePathPolicy::revalidate`; BE-014 không tự join raw relative path hoặc dựng validated path ngoài BE-013.
- `replace_editor_snapshot` là hook tối thiểu cho BE-015, không phải Tauri command của BE-014. `base_disk_revision` là opaque token của disk version editor đã render; frontend không cấp `edit_count` hay dirty metadata. BE-015 chịu trách nhiệm contract transport/validation, còn manager so exact bytes UTF-8 cộng BOM của handle với base: snapshot distinct đầu tiên làm dirty đặt `dirty_since_ms` và `edit_count = 1`, mỗi snapshot distinct được nhận tiếp theo tăng count saturating, quay về base clear dirty/timestamp/count, identical retry không mutate. Manager commit snapshot trước khi acknowledge để close impact/watcher đọc đúng authority.
- Nếu watcher auto-reload một handle đang sạch ngay trước edit đầu, manager giữ đúng một `previous_clean_disk_revision` gắn cause `WatcherReload`. Snapshot stale đúng một revision với base token bằng version trước reload được nhận làm local dirty và chuyển `ExternalConflict`; current revision với base token cũ cũng được nhận theo cùng conflict semantics. Explicit reload, Keep Mine, Save, close/reopen hoặc editor mutation xóa marker; stale case khác trả `RevisionConflict`, identical retry không mutate. Đây là race aid runtime, không phải revision history/persistence.
- Search chỉ trả regular files visible theo BE-013, không đọc content và không trả absolute path. `candidate_limit` hợp lệ `1..=64`; stable order là Projects order rồi relative path sort key, `has_more` set khi còn candidate. Project unavailable bị bỏ, lỗi project registry/walker không expected làm source trả lỗi sạch cho adapter BE-010.

### Recent Files maintenance contract

```rust
pub struct RecentFilesResetPlan {
    pub removed_count: u32,
    pub affected_project_ids: Vec<String>,
}

pub struct RecentFilesResetProjection {
    pub removed_count: u32,
    pub affected_project_ids: Vec<String>,
}

impl FilesService {
    /// Prepares bounded reset counts and affected projects in the shared transaction.
    pub fn prepare_recent_files_reset_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<RecentFilesResetPlan, FilesError>;

    /// Deletes every recent-file row using the coordinator-owned transaction.
    pub fn reset_recent_files_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &RecentFilesResetPlan,
    ) -> Result<RecentFilesResetProjection, FilesError>;

    /// Publishes prepared per-project recent invalidations after commit without failure.
    pub fn publish_recent_files_reset(
        &self,
        projection: RecentFilesResetProjection,
    );
}
```

Hai type public trong Rust crate, không derive `Serialize`, `Deserialize` hoặc `TS`. Prepare query `COUNT(*)` checked sang `u32` và distinct `project_id` sort ASC; plan là owned, `Send + 'static`, không chứa path, transaction, connection, lock guard, handle hoặc callback. Apply chạy đúng một `DELETE FROM recent_files`, yêu cầu affected count khớp plan và chuyển ownership danh sách project sang projection; mismatch trả `RecentFilesFailed` để transaction xuyên domain rollback. Publish không query hoặc lấy Storage/maintenance/handle lock, consume projection và thử emit một `files://recent-changed` cho mỗi project ID đã chuẩn bị, đúng sort order; emit failure chỉ log category an toàn và không biến commit thành failure.

App adapter triển khai `DataResetOnlyParticipant` bằng đúng ba method trên. `_in` chỉ được gọi khi BE-012 giữ `DataWritePermit`, trong transaction xuyên domain và theo reset order Reminders → Notifications → Recent Files → Events/Notes/...; chúng không gọi `Storage::with_connection`/`with_transaction`, không lấy `DataReadPermit` hoặc Files handle lock. Rollback drop plan/projection và không emit. Recent Files không có backup participant; reset không chạm project source hoặc row ngoài `recent_files`.

Write path Recent Files thông thường await `DataReadPermit` sau khi pane attach thành công và trước transaction upsert/prune, rồi giữ permit qua commit cùng enqueue `files://recent-changed`. Lock order là maintenance read permit → recent mutation gate → Storage; không giữ handle-map/watcher lock khi await permit hoặc chạy SQL. `list_recent_files`/search và Filesystem/handle mutation không ghi SQLite nên không lấy permit này; attach content đi qua concurrency contract của BE-005.

Files cung cấp lifecycle delegate cho `PaneContentRuntime` của BE-005:

```rust
impl FileHandleManager {
    /// Reports one unsaved label when a file handle is dirty or conflicted.
    pub async fn close_impact(
        &self,
        file_handle_id: &str,
    ) -> Result<PaneCloseImpact, FilesError>;

    /// Closes a file handle and optionally retains a clean runtime-only reopen token.
    pub async fn close_for_session(
        &self,
        file_handle_id: &str,
        retention: CloseRetention,
    ) -> Result<Option<ReopenHandle>, FilesError>;

    /// Revalidates and restores a retained file handle without restoring discarded edits.
    pub async fn reopen_for_session(
        &self,
        handle: ReopenHandle,
    ) -> Result<PaneContentRef, FilesError>;

    /// Permanently releases a retained file token and its buffer.
    pub async fn discard_for_session(
        &self,
        handle: ReopenHandle,
    ) -> Result<(), FilesError>;
}
```

- Composition root mở rộng `PaneContentRuntimeRouter` để delegate owner `Files`; dùng late-bind `Weak` cùng pattern BE-007, không tạo strong cycle Files↔Sessions. Bind thiếu/lặp làm setup fail.
- `close_impact` trả basename đã sanitize trong `unsaved_file_labels`, không absolute path/content.
- Khi Sessions gọi close sau confirm, dirty buffer được discard. Với `ReopenLastTab`, token chỉ giữ identity và disk snapshot sạch gần nhất; local edits đã discard không được hồi sinh khi reopen. Sau `Save and close`, BE-015 đã làm handle clean nên token giữ version vừa save.
- Reopen gọi `available_root`, path policy và read lại disk trước khi reattach watcher. Missing/unreadable được restore thành handle state tương ứng; root đã locate sang folder khác không được dùng token cũ để đọc đường dẫn old-root.
- Close/reopen/discard idempotent theo handle/token. Close unwatch khi parent ref-count về `0`; discard drop content; shutdown dừng watcher worker và xóa toàn bộ handles/tokens.
- BE-012 reset runtime chỉ gọi `SessionManager::shutdown_all`; router trên delegate đến Files đúng một lần. `prepare_recent_files_reset_in`/`reset_recent_files_in`/`publish_recent_files_reset` không gọi `close_impact`, `close_for_session`, watcher shutdown hoặc xóa buffer, vì runtime đã được cleanup trước khi transaction reset mở.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `files://handle-changed` | `FileHandleChangedEventDto` | Sau watcher/manual/focus reconciliation hoặc conflict resolution đã commit state handle. | Low-throughput invalidation; một event cho mỗi revision thực sự đổi, duplicate hint cùng fingerprint bị gộp. Payload không có content/path; consumer gọi `get_open_file`. Không cam kết thứ tự giữa handle khác nhau. |
| `files://recent-changed` | `RecentFilesChangedEventDto` | Sau recent upsert/prune transaction commit thành công hoặc post-commit reset publish. | Một event mỗi open attach được ghi recent; reset thử phát một event cho mỗi affected project theo ID sort ASC. Chỉ là invalidation project, FE-005 query lại. Emit lỗi không rollback DB/open/reset result. |

Notify callback không emit Tauri trực tiếp. Nó chỉ gửi hint vào bounded queue; handle worker debounce/reconcile, update state rồi mới emit. Event emit thất bại giữ state authority, được chữa bằng query khi view mount/window focus.

## Business rule và invariant

1. `open_file_in_pane` không nhận project ID/root/absolute path. Project được derive từ session target; root chỉ từ BE-003 và relative path chỉ qua grammar/visibility/no-link policy BE-013.
2. Chỉ regular file được mở. Directory, `Other`, symlink, junction, mount point và Windows reparse point bị từ chối trước `File::open`; mọi lần reload/open-default/save extension phải revalidate path.
3. Handle đã attach giữ root identity lúc mở. Nếu `available_root` trả root khác sau locate, handle chuyển `ProjectRootChanged`, unwatch old parent và không đọc/mở/ghi old path nữa; dirty buffer vẫn giữ trong memory để người dùng sao chép hoặc đóng có cảnh báo.
4. Ignore visibility được kiểm khi tạo handle/recent/search. Ignore rule đổi không tự đóng handle đang mở; handle-bound action vẫn kiểm root/no-link/existence nhưng không dùng ignore như quyền truy cập.
5. Reader stat/open/read/stat và kiểm path component; nếu size/fingerprint/path type đổi trong lần đọc, retry đúng một lần rồi trả `FileChangedDuringRead`. Không trả buffer ghép từ hai version.
6. Size `> 5_242_880` luôn `TooLarge` trước binary detection. Size bằng limit được đọc. Reader không allocate theo metadata chưa tin cậy: dùng bounded read tối đa `limit + 1` cho viewer content.
7. File trong limit có NUL ở bất kỳ byte nào hoặc UTF-8 invalid là `Binary`; không dùng extension/MIME để override. UTF-8 BOM được strip khỏi DTO text nhưng fingerprint gồm raw bytes có BOM.
8. Text giữ nguyên `LF`/`CRLF` trong string; `line_ending` là `Mixed` nếu có cả hai. `line_count = 0` khi empty, ngược lại `1 +` số line break logic.
9. MIME từ extension và không đáng tin; binary unknown dùng `application/octet-stream`, valid text unknown dùng `text/plain`. MIME không quyết định renderer thực thi content.
10. Mỗi pane có một file handle; cùng relative path có thể mở nhiều pane. Mỗi handle có buffer/revision riêng nhưng watcher parent/path được share; một disk change reconcile mọi handle của path.
11. Tối đa `64` attached+retained file handle và tổng text buffer `64 MiB`. Open vượt budget trả `FileMemoryLimitReached` trước attach/recent; binary/too-large không giữ content bytes.
12. `revision` tăng checked một đơn vị cho mọi state mutation. Resolution dùng expected revision; editor hook dùng cả expected revision và `base_disk_revision`: manager tự derive dirty/count, nhận watcher-first-edit race thành conflict theo contract trên và từ chối stale case khác. Overflow làm handle đóng với internal fatal error, không wrap.
13. `disk_revision` là opaque ID gắn fingerprint gồm file identity khi có, byte size, modified time và BLAKE3 raw bytes cho file cần conflict/save. Hash streaming chạy blocking; digest không log/serialize ngoài token opaque.
14. Recommended watcher watch parent `NonRecursive`, config follow symlink `false`, ref-count path; callback queue capacity `1.024`. Queue overflow set reconcile-all flag, không drop im lặng như thể không đổi.
15. Hints cùng target trong `100 ms` được coalesce. Worker không tin `EventKind` là state cuối; create/modify/remove/rename đều dẫn tới stat/read current target.
16. Clean text/source tự thay content; clean target thành binary/too-large cũng tự đổi classification. Clean delete/unreadable chuyển state tương ứng. Dirty Markdown chỉ đổi sang conflict với disk present; delete/unreadable giữ local dirty và state `Missing`/`Unreadable` để không mất buffer.
17. `KeepMine` và `ReloadFromDisk` không áp nếu disk đã đổi lần nữa. Keep Mine clear conflict nhưng vẫn dirty; lần save BE-015 phải compare base fingerprint mới ngay trước write. Reload chỉ clear local sau khi disk read hoàn chỉnh thành công.
18. Fallback polling không phải correctness authority cho save. Nó kiểm metadata `2 s`; main-window focus, explicit reload, conflict resolution và pre-save luôn full revalidate/fingerprint.
19. Pending handle được publish chỉ sau Sessions attach thành công. Pending watcher hint được giữ để reconcile sau publish; attach fail unwatch/drop và không emit/ghi recent.
20. Recent upsert chạy sau publish. Lỗi clock xảy ra trước pending attach; write await maintenance read permit trước recent mutation gate/Storage và giữ qua commit/event enqueue. Lỗi SQLite sau attach trả `RecentFileNotRecorded`, không detach pane hoặc giả rằng open thất bại.
21. Recent timestamp trong transaction là `max(now_ms, project_max_opened_at_ms + 1)` bằng checked arithmetic để giữ MRU khi clock lùi/tie. Upsert cập nhật relative casing/path và prune mọi row sau top `50` cùng transaction.
22. Recent row missing/ignored/link/unreadable không bị tự xóa vì file có thể xuất hiện lại; list trả availability. Project unavailable trả row với `ProjectUnavailable`; project remove xóa row bằng FK cascade.
23. Recent list sort SQL ổn định; `is_open`/`has_unsaved_changes` là aggregate runtime tại lúc query, không persist và có thể đổi sau response.
24. File search dùng BE-013 ignore/no-link/sort/scan limits, chỉ regular file và candidate cap do BE-010 yêu cầu; không dùng recent table làm search index.
25. Không file content, buffer, absolute path, query, hash, raw notify/I/O/storage error được ghi log. Log chỉ operation, handle/project opaque ID, duration, byte-count bucket và error category.
26. Không command BE-014 ghi source project. `ReloadFromDisk` chỉ thay memory; filesystem write duy nhất của Files phase nằm sau contract BE-015.
27. Reset-only prepare/apply chạy dưới write permit và transaction BE-012, chỉ đọc/xóa `recent_files`, không re-enter maintenance/recent/Storage gate. Affected project/count được chuẩn bị trước apply; mismatch rollback, commit mới publish invalidation.
28. Reset app cleanup handle/watcher/buffer qua BE-005 `PaneContentRuntime` trước transaction. Recent reset participant không gọi lifecycle API, nên mỗi handle/watcher được dispose đúng một lần và lỗi runtime không xóa row recent.
29. Recent Files không vào backup. Reset xóa row bền vững nhưng không xóa source file, database/schema/migration hoặc path trên đĩa.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum FilesError {
    WindowNotAllowed,
    InvalidProjectId,
    ProjectNotFound { project_id: String },
    ProjectUnavailable { project_id: String },
    ProjectRemovalInProgress { project_id: String },
    ProjectAccessFailed,
    InvalidRelativePath,
    InvalidSearch,
    InvalidCursor,
    EntryNotFound { relative_path: String },
    EntryNotVisible { relative_path: String },
    NotDirectory { relative_path: String },
    NotRegularFile { relative_path: String },
    LinkTraversalDenied { relative_path: String },
    TraversalLimitExceeded,
    FileSystemReadFailed,
    InvalidSessionTarget,
    PaneNotEmpty { pane_id: String },
    SessionAttachFailed,
    InvalidFileHandleId,
    FileHandleNotFound { file_handle_id: String },
    RevisionConflict { current_revision: String },
    NoExternalConflict,
    FileChangedAgain { current_revision: String },
    UnsavedChangesWouldBeLost,
    FileChangedDuringRead,
    FileReadFailed,
    FileMemoryLimitReached,
    ProjectRootChanged { project_id: String },
    RevealFailed,
    InvalidLimit,
    RecentFilesFailed,
    ClockFailed,
    OpenExternalFailed,
}
```

Các variant BE-013 đã có giữ nguyên semantics; BE-014 chỉ thêm variant cần cho read/runtime/recent.

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `WindowNotAllowed` | Invoke không từ main window. | Không retry ở window đó. |
| `InvalidProjectId` | ID recent/search không đúng UUID contract. | Refresh identity source. |
| `ProjectNotFound` | Project bị remove. | Đóng file/project view stale và về Projects. |
| `ProjectUnavailable` | Root không dùng được. | Hiển thị Unavailable/Locate; giữ dirty buffer đang có. |
| `ProjectRemovalInProgress` | Removal gate đang active. | Disable open/reload và chờ cleanup. |
| `ProjectAccessFailed` | Public Projects query lỗi đã làm sạch. | Giữ view, cho retry. |
| `InvalidRelativePath` | Path vi phạm BE-013 grammar. | Bỏ target stale; không retry input cũ. |
| `InvalidSearch` | Search rỗng/quá dài/có control character theo BE-013. | Sửa query; không retry input cũ. |
| `InvalidCursor` | Cursor list không decode hoặc không khớp directory/page size. | Bỏ cursor và tải lại page đầu. |
| `EntryNotFound` | File biến mất trước open/action. | Refresh tree/recent hoặc chuyển handle Missing. |
| `EntryNotVisible` | File mở mới hiện bị ignore/VCS-prune. | Refresh tree; không mở từ stale result. |
| `NotDirectory` | Target list của BE-013 không phải directory. | Collapse node stale và refresh parent. |
| `NotRegularFile` | Target là directory/other. | Không tạo pane content; refresh entry kind. |
| `LinkTraversalDenied` | Target/component là link/reparse/mount. | Hiển thị leaf không mở được. |
| `TraversalLimitExceeded` | Scan BE-013 vượt depth hoặc inspected-entry cap. | Giữ kết quả cũ, thu hẹp query/cây rồi retry. |
| `FileSystemReadFailed` | List/search metadata hoặc directory read của BE-013 thất bại. | Giữ state cũ và cho retry. |
| `InvalidSessionTarget` | Session/tab/pane relation stale hoặc khác project flow. | Refresh layout rồi chọn target lại. |
| `PaneNotEmpty` | Pane đã có content trước attach. | Giữ content hiện tại; mở vào pane/new tab khác. |
| `SessionAttachFailed` | Sessions lookup/attach lỗi khác đã làm sạch. | File chưa attach; giữ pane authority từ Sessions và retry flow. |
| `InvalidFileHandleId` | Handle ID không đúng UUID runtime. | Không retry; refresh pane snapshot. |
| `FileHandleNotFound` | Handle đã close/discard/Quit. | Đóng view stale hoặc lấy Sessions snapshot. |
| `RevisionConflict` | Resolution/editor operation dùng revision cũ. | Query handle mới rồi áp lại intent nếu còn phù hợp. |
| `NoExternalConflict` | Gửi resolution khi handle không conflict. | Đóng dialog stale, dùng snapshot hiện tại. |
| `FileChangedAgain` | Disk đổi giữa dialog và resolution. | Refresh facts/timestamps, yêu cầu user chọn lại. |
| `UnsavedChangesWouldBeLost` | Manual reload được gọi khi dirty/conflict. | Dùng conflict/discard/save flow explicit. |
| `FileChangedDuringRead` | Hai lần đọc đều gặp target đổi giữa chừng. | Giữ view cũ và Retry. |
| `FileReadFailed` | Open/read/hash/stat lỗi không map thành missing/unreadable state. | Hiển thị lỗi file cụ thể có Retry/Open externally khi phù hợp. |
| `FileMemoryLimitReached` | 64 handles hoặc 64 MiB text budget đã hết. | Đề nghị đóng file/tab khác rồi retry. |
| `ProjectRootChanged` | Project được locate sang root khác trong operation. | Giữ local dirty recovery, mở lại từ tree root mới. |
| `RevealFailed` | Opener BE-013 không reveal được target đã validate. | Giữ selection và cho retry/copy path. |
| `InvalidLimit` | Recent/search candidate limit ngoài range. | Sửa caller; không retry input cũ. |
| `RecentFilesFailed` | Query/upsert/prune SQLite lỗi; open dùng warning riêng. | Overview giữ list cũ và retry; open pane vẫn dùng được. |
| `ClockFailed` | Không lấy được epoch ms an toàn trước open. | Không tạo pending handle; cho retry. |
| `OpenExternalFailed` | Official opener không mở được file revalidated. | Giữ unsupported pane; cho retry/copy path. |

## Luồng chính

### Mở file vào pane

1. Command validate window/request; Files dependency adapter resolve session/tab/pane `Empty` và derive project ID.
2. Adapter gọi `available_root`; blocking reader dùng BE-013 path policy, read/classify/fingerprint với one-retry race rule.
3. Manager kiểm handle/memory budget, tạo UUID/pending state, watch parent hoặc đặt polling fallback; chưa emit.
4. Adapter attach `PaneContentRef::File`. Attach fail cleanup pending; thành công publish handle và reconcile mọi pending hint.
5. Service await maintenance read permit, rồi repository transaction lấy project max timestamp, upsert path, prune sau 50. Commit xong enqueue recent invalidation trước khi nhả permit; lỗi chỉ thêm warning trong open result.
6. Frontend render Text read-only hoặc unsupported pane; Markdown edit command/save được BE-015 nối sau nhưng dùng cùng handle.

### Watch và external change

1. Native callback đưa hint path vào bounded queue; worker coalesce 100 ms. Overflow hoặc main-window focus snapshot danh sách handle rồi reconcile mà không giữ map lock qua I/O.
2. Mỗi reconcile kiểm current project root/path rồi đọc/fingerprint ngoài async worker.
3. Disk fingerprint không đổi: no-op. Handle sạch: replace state/content và emit `Reloaded`, `Missing` hoặc `Unreadable`.
4. Handle dirty + disk present khác: giữ local, set `ExternalConflict`, emit `ConflictDetected`; delete/unreadable giữ local và đổi state tương ứng.
5. Frontend nhận event, gọi `get_open_file`. Conflict dialog hiển thị disk timestamp/size và local dirty timestamp/edit count đúng wireframe.
6. Resolution re-read disk; stale version trả `FileChangedAgain`. Choice hợp lệ commit memory rồi emit; không filesystem write.

### Recent files và Unified Search

1. Project Overview gọi `list_recent_files(project_id, None)` khi mount/focus và sau `files://recent-changed`.
2. Service đọc row sorted trong một storage callback rồi nhả DB lock; blocking path checks tối đa 10/limit row, sau đó merge handle dirty/open snapshot.
3. FE-005 hiển thị basename, parent, relative time hoặc `unsaved`; unavailable row disabled/giải thích rõ.
4. Adapter BE-010 gọi `search_openable_files(query, 64)`; Files dùng ordered projects và walker BE-013, trả regular-file identity tương đối, không content/absolute path.

### Close, reopen và Quit

1. Sessions gọi Files lifecycle `close_impact`; dirty/conflict trả một unsaved label để dialog close/remove/quit tính đủ.
2. Sau save hoặc xác nhận discard, close unwatch/drop local edits; tab close có thể giữ clean reopen token, pane/session/project/Quit dùng discard.
3. Reopen revalidate root/path và read disk current; không phục hồi local edits đã discard. Missing/unreadable vẫn trả File content ref với trạng thái rõ.
4. Quit/project removal dispose mọi handle/token/watcher trước khi Sessions/storage kết thúc; recent rows vẫn persist, trừ project remove cascade.

### Reset ứng dụng

1. BE-012 giữ maintenance write permit và await runtime control; `SessionManager::shutdown_all` delegate Files lifecycle để dispose handle/token/watcher/buffer đúng một lần.
2. Chỉ sau runtime cleanup thành công, Recent Files reset-only adapter prepare/apply typed plan trong shared SQLite transaction; runtime cleanup lỗi không mở transaction và giữ recent rows.
3. Rollback không emit. Commit gọi `publish_recent_files_reset` với owned projection, sau toàn bộ owner publish BE-012 resume worker và phát `data://changed`.

## Ràng buộc kỹ thuật

- Blocking: filesystem stat/open/read/hash/classify, ignore/path checks, watcher watch/unwatch khi backend yêu cầu và mọi rusqlite callback chạy ngoài async worker. Async service await maintenance permit, không `block_on`; permit có thể sống khi await bounded blocking SQL nhưng connection/transaction chỉ sống trong closure. Không giữ Tauri State, handle-map lock, watcher lock, Storage connection hoặc Sessions lock qua `.await`/blocking I/O.
- Bảo mật: Main window only; project/root từ public BE-003; relative/no-link policy BE-013; no-follow/reparse checks trước/sau open; không cấp webview filesystem/opener; Markdown/raw content không log và MIME không được tin làm sandbox.
- Hiệu năng: 5 MiB/file, 64 MiB/64 handles, bounded notify queue 1.024, debounce 100 ms, fallback metadata poll 2 s, max hai blocking read/hash cùng lúc dùng chung Files semaphore BE-013. Không watch recursive project.
- Concurrency: Mutation cùng handle tuần tự bằng operation/revision guard; handle khác song song trong global permit. Recent write lock order là maintenance read permit → recent mutation gate → Storage; reset `_in` không re-enter. Watch/read/resolve/close race phải kết thúc bằng một state hợp lệ hoặc typed stale error, không resurrect handle đã discard.
- Persistence: Recent writes dùng `Storage::with_transaction` dưới read permit, reads dùng `with_connection`, SQL bind-only. Shared reset dùng coordinator transaction dưới write permit; owner method không mở nested Storage call. Không giữ DB lock trong filesystem validation. Migration 6 atomic/immutable theo BE-002.
- Platform: Windows test replace-via-rename, CRLF, locked/deleted file, long/UNC path, symlink/junction/reparse và opener. macOS FSEvents/symlink validation hoãn đến release preparation.
- Generated contract: Binding sinh từ Rust vào `src/bindings/files/`; event/command/type export test fail khi drift, không sửa tay.

## Tiêu chí hoàn thành

- [ ] Migration `0006_create_recent_files.sql` là registry version 6 sau versions 1–5, tạo đúng table/FK/index và rollback nguyên version khi lỗi.
- [ ] Open chỉ attach regular visible no-link file từ session-derived project; attach failure không leak handle/watcher, emit hoặc recent row.
- [ ] `5_242_880` byte được đọc, lớn hơn trả TooLarge với actual/limit; NUL/invalid UTF-8 trả Binary; BOM/line ending/line count/MIME/syntax hint đúng fixture.
- [ ] Source text luôn `SourceReadOnly`; chỉ `.md`/`.markdown` là Markdown; binary/too-large vẫn có pane, actual size/MIME, open-default và copy path flow.
- [ ] Reader retry đúng một lần khi file đổi trong read và không bao giờ trả mixed-version buffer.
- [ ] Native parent watcher không recursive/follow link, share ref-count, debounce duplicate; atomic replace/rename/delete được reconcile theo target state.
- [ ] Watch failure chuyển polling fallback; overflow/focus reconcile tất cả; pre-save contract vẫn compare full fingerprint.
- [ ] Clean handle tự reload; dirty Markdown giữ local và phát conflict; KeepMine/ReloadFromDisk cùng stale-disk race tuân explicit-choice semantics, không ghi disk.
- [ ] Editor hook không nhận `edit_count`; manager derive dirty/count từ snapshot và base bytes, identical retry là no-op, watcher-first-edit giữ draft thành conflict và stale case khác không mutate.
- [ ] Project locate làm handle RootChanged và dừng chạm old root; missing/unreadable không làm mất dirty buffer.
- [ ] Recent upsert chỉ sau attach, per-project MRU monotonic, cùng path không trùng theo OS, cap 50, list default10/max50 ổn định và project remove cascade.
- [ ] Mọi recent upsert/prune giữ maintenance read permit qua commit/invalidation; typed reset plan/apply/projection chạy trong shared transaction, mismatch rollback và commit emit affected project theo deterministic order.
- [ ] Recent runtime flags phản ánh mọi handle cùng path; stale recent row trả availability chứ không bị xóa ngầm.
- [ ] Public name search trả tối đa 64 regular-file candidate theo project/path order, tuân ignore/symlink và không absolute/content; adapter BE-010 map được đúng contract.
- [ ] Files lifecycle trả đúng unsaved impact, discard không ghi disk, reopen không hồi sinh edit đã discard, method idempotent và router late-bind không strong cycle.
- [ ] App reset cleanup Files chỉ qua BE-005 router đúng một lần; Recent Files reset participant không chạm handle/watcher/buffer và runtime cleanup lỗi không xóa recent row.
- [ ] Handle/memory/revision/queue/debounce limits được test tại boundary; raw content/path/hash/error không xuất hiện trong log/event.
- [ ] Mọi command từ window khác main bị chặn trước side effect; generated binding/event payload khớp Rust.
- [ ] Mọi function/method/callback/test/helper có comment ngắn; read race, fingerprint, watcher overflow, conflict và partial open-recent failure có inline comment giải thích invariant.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và `cargo test --all-targets --all-features` pass.
- [ ] Frontend formatter/lint/type-check/test liên quan và `tests/e2e/files.e2e.ts` pass; `pnpm tauri build` pass vì migration/dependency/state/commands/events/generated binding mới.
- [ ] Smoke test Windows xác nhận native opener, watcher khi app ẩn tray, atomic save từ editor ngoài và UNC fallback; macOS validation để release preparation.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/files/reader.rs` (`#[cfg(test)]`) | Unit | Boundary size, growth race, UTF-8/BOM/NUL, binary, line endings/count, MIME fallback, platform identity + size/mtime/BLAKE3 fingerprint equality và no mixed version. |
| `src-tauri/src/files/watcher.rs` (`#[cfg(test)]`) | Unit | Parent ref-count, no-follow config, debounce/coalesce, bounded overflow, fallback scheduling và shutdown bằng fake watcher/time. |
| `src-tauri/src/files/handles.rs` (`#[cfg(test)]`) | Unit | Budget/revision, backend-derived dirty/edit count, identical retry, watcher-first-edit conflict, stale resolution, clean reload, missing/unreadable/root change, multi-handle fanout và lifecycle idempotency. |
| `src-tauri/src/files/repository.rs` (`#[cfg(test)]`) | Unit | Bind/upsert, Windows/macOS key, monotonic timestamp, cap/order, typed reset count/project IDs, mismatch rollback và FK cascade bằng in-memory SQLite. |
| `src-tauri/src/files/service.rs` (`#[cfg(test)]`) | Unit | Dependency fake, pending cleanup, recent warning/read permit order, reset projection/invalidation, blocking semaphore, search/focus và opener revalidation. |
| `src-tauri/src/files/models.rs` (`#[cfg(test)]`) | Unit | Tagged DTO/event/error serialization, editor snapshot với opaque base disk revision, revision strings, checked line/count và unsupported payload. |
| `src-tauri/tests/files_read_watch_commands.rs` | Integration | Migration thật/temp project; command/window boundary; open text/binary/too-large; notify create/modify/rename/delete; recent persistence/reopen; session attach/close/reopen; read-only filesystem snapshot. |
| `src-tauri/tests/data_management_contract.rs` | Integration | Recent Files reset-only dưới shared write permit/transaction, rollback/commit event và runtime cleanup chỉ qua Sessions router. |
| `src-tauri/tests/app_builder.rs` | Integration | Composition storage/gate/Projects/Sessions/Files/reset adapter, router bind một lần, watcher worker shutdown và six command registration trong mock runtime. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export toàn bộ DTO/error/event Files mới và fail khi generated TypeScript lệch source. |
| `tests/e2e/files.e2e.ts` | Desktop E2E Windows | Source read-only/status; binary/too-large actual size/actions; recent files; clean auto-reload; dirty conflict facts/choices; close unsaved flow. |

Filesystem tests chỉ dùng temporary directory, không dùng repository/app data thật. Test watcher dùng condition/event channel có deadline hữu hạn, không sleep mù; backend-specific native delivery có retry bounded và fake watcher giữ deterministic coverage. Test opener dùng fake adapter, native app launch chỉ smoke thủ công.

## Câu hỏi mở

Không có.
