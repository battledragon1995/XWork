# BE-015 — Markdown save

Tài liệu này đặc tả backend nhận buffer Markdown từ editor và lưu thủ công vào đúng file project đang mở. Save dùng optimistic concurrency trên disk fingerprint của BE-014, ghi qua file tạm cùng thư mục rồi thay thế nguyên tử; mọi xung đột đã biết đều giữ nguyên buffer trong XWork và không ghi đè disk nếu người dùng chưa chọn rõ.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-015` |
| Phase | `2` |
| Capability | `src-tauri/src/files/` |
| Yêu cầu chức năng | §11.3; liên quan §8.1, §9, §18 và §20 Phase 2 |
| Frontend liên quan | `FE-018`; close/save-and-close tích hợp `FE-007` |
| Phụ thuộc | `BE-003`, `BE-005`, `BE-013`, `BE-014` |

## Mục tiêu

Backend giữ buffer Markdown runtime đồng bộ với editor, xác định chính xác dirty state và chỉ ghi file khi người dùng gọi Save. Ngay trước atomic replace, backend kiểm lại project root, path/no-link policy và toàn bộ disk fingerprint; thay đổi bên ngoài chưa được người dùng chấp nhận chuyển handle sang conflict thay vì bị ghi đè.

### Quyết định và giả định đã chốt

- Có đúng hai command mới: `update_markdown_buffer` cập nhật runtime buffer và `save_markdown_file` thực hiện Save thủ công. Không có autosave, save timer hoặc ghi khi đổi Edit/Preview.
- `Ctrl+S` trên Windows và `Command+S` trên macOS là shortcut cố định, editor-scoped của FE-018. Nó không được thêm vào catalog tùy chỉnh BE-009 vì §17.4 không liệt kê Save và shortcut chỉ có nghĩa khi pane Markdown active.
- Update gửi snapshot text đầy đủ, không gửi patch/operation tùy ý. FE-018 gửi ngay transaction đầu làm file dirty, sau đó giữ tối đa một invoke in-flight và coalesce transaction đang chờ; trước Save hoặc close-impact flow phải flush snapshot mới nhất.
- Request update mang cả `expected_revision` và `base_disk_revision`. Cặp token này xử lý an toàn race “người dùng vừa gõ trong lúc watcher auto-reload”: backend giữ draft local và tạo conflict với disk mới thay vì làm mất draft hoặc ghi đè ngầm.
- Dirty được tính theo bytes sẽ ghi: UTF-8 text cộng UTF-8 BOM nếu file mở ban đầu có BOM. Quay nội dung về đúng bytes của base disk tự clear dirty; backend không dựa vào một cờ dirty do frontend gửi.
- Giới hạn bytes sau encode, gồm BOM nếu có, là `5_242_880` byte như viewer BE-014. Save không được biến một Markdown handle thành file vượt viewer limit.
- Save giữ nguyên text người dùng gửi, UTF-8 BOM flag của handle, line ending và trailing newline; không normalize CRLF/LF, format Markdown hoặc tự thêm newline.
- Atomic writer dùng file tạm `create_new` trong cùng parent. Trên Windows, commit dùng `ReplaceFileW` để thay target và giữ metadata/ACL mà API hỗ trợ; trên macOS dùng same-directory atomic `rename`. Temp được `sync_all` trước commit; parent directory sync sau commit là best effort vì không có cùng guarantee trên mọi filesystem.
- Optimistic check không khóa chương trình ngoài. Guarantee là mọi disk change quan sát được trước điểm commit đều chặn Save; thay đổi xảy ra sau lần fingerprint cuối cạnh tranh với atomic replace và sẽ được watcher/post-commit reconcile thành một version hoàn chỉnh, không có file ghi dở.
- Atomic replace thay inode/file identity nên hard link khác không được cập nhật. Đây là tradeoff có chủ ý để không truncate file gốc; BE-015 chỉ hứa lưu path được mở, không bảo toàn quan hệ hard-link.
- Handle có thể nhận edit mới trong khi một Save đang stage. Save ghi đúng snapshot của revision được yêu cầu; nếu editor đã tiến thêm sau commit, disk base cập nhật nhưng handle vẫn dirty và outcome là `SavedWithNewerEdits`.
- `KeepMine` của BE-014 là xác nhận explicit cho disk version đang conflict: nó chỉ cập nhật base và vẫn không ghi. Save tiếp theo được phép thay version đó nếu fingerprint preflight vẫn khớp; `ReloadFromDisk` bỏ local draft và làm Save trở thành no-op sạch.

### Ngoài phạm vi

- Tạo file mới, Save As, đổi tên, xóa, di chuyển hoặc sửa source không phải Markdown.
- Autosave, format-on-save, lint, Markdown preview/render/raw HTML, editor history, undo/redo hoặc persist buffer qua Quit.
- Merge ba chiều, diff UI, recovery file do người dùng quản lý hoặc lưu nhiều version file.
- Thay đổi mode Edit/Preview; mode chỉ là state frontend trong thời gian file còn mở.
- Ghi database hoặc migration. Recent files đã do BE-014 cập nhật lúc attach pane, không cập nhật lại khi Save.
- Bảo đảm durability qua mất điện trên mọi network/filesystem lạ. Contract bắt buộc atomic visibility và sync dữ liệu temp trên local filesystem được hỗ trợ.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo target-specific exact dependency `windows-sys = "=0.61.2"` với `Win32_Foundation`, `Win32_Storage_FileSystem`; dùng Serde/ts-rs/BLAKE3/UUID/Tokio đã có. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi cập nhật manifest. |
| `src-tauri/src/lib.rs` | Giữ export public module `files` sau khi capability được mở rộng. |
| `src-tauri/src/app/mod.rs` | Đăng ký hai command Save mới trong Files managed service hiện có. |
| `src-tauri/src/files/mod.rs` | Re-export DTO/error/command BE-015 và writer contract cần cho test/composition. |
| `src-tauri/src/files/models.rs` | DTO update/save/outcome và mở rộng handle-change kind. |
| `src-tauri/src/files/path_policy.rs` | Tái sử dụng `ProjectRootIdentity` và `ValidatedFileWriteTarget` do BE-013 sở hữu; writer không nhận raw IPC path. |
| `src-tauri/src/files/reader.rs` | Tái sử dụng `DiskFingerprint` do BE-014 sở hữu, bounded read và post-commit classification. |
| `src-tauri/src/files/writer.rs` | Sở hữu `FileMetadataSnapshot`/`StagedAtomicWrite`; stage/sync/atomic replace theo platform, temp cleanup và phân loại kết quả commit mơ hồ. |
| `src-tauri/src/files/watcher.rs` | Defer/coalesce hint của target đang save và reconcile self-write/other handle sau commit. |
| `src-tauri/src/files/handles.rs` | Apply editor snapshot, dirty/base/edit count, save lease, conflict transition, publish saved snapshot và lifecycle serialization. |
| `src-tauri/src/files/service.rs` | Orchestrate update/save, available root, preflight fingerprint, blocking writer và fanout handle cùng path. |
| `src-tauri/src/files/commands.rs` | Tauri command mỏng, main-window/input validation và mapping DTO/error. |
| `src-tauri/src/files/error.rs` | Mở rộng `FilesError` cho Markdown size/edit/save/conflict/atomic-write failure đã làm sạch. |
| `src-tauri/tests/app_builder.rs` | Xác nhận composition đăng ký thêm đúng hai command mà không thêm webview permission. |
| `src-tauri/tests/files_markdown_save_commands.rs` | Integration test buffer, manual/atomic save, optimistic conflict, watcher fanout và close flow trên temp project. |
| `src-tauri/tests/export_bindings.rs` | Sinh và kiểm tra binding DTO/error/event BE-015. |
| `src/bindings/files/` | Output TypeScript do `ts-rs` sinh; không chỉnh tay. |

Không sửa capability permission: frontend không nhận API filesystem. Windows API chỉ được gọi trong Rust dưới `cfg(windows)`; macOS writer chỉ nhận path đã resolve từ handle/root authority.

## Dữ liệu

BE-015 không tạo schema, migration hoặc dữ liệu persisted. File content, base fingerprint, editor buffer và save lease chỉ sống trong `FileHandleManager` của BE-014 và bị bỏ theo lifecycle pane/session/Quit.

Internal snapshot chuyển từ manager sang blocking writer có shape cố định:

```rust
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum FileMetadataSnapshot {
    Windows { file_attributes: u32 },
    Unix { mode: u32 },
}

pub(crate) struct StagedAtomicWrite {
    target: ValidatedFileWriteTarget,
    temporary_path: PathBuf,
    staged_byte_size: u64,
    staged_digest: blake3::Hash,
}

impl StagedAtomicWrite {
    /// Returns the exact validated target captured when staging began.
    pub(crate) fn target(&self) -> &ValidatedFileWriteTarget;

    /// Returns the digest of the complete synced staged bytes.
    pub(crate) fn staged_digest(&self) -> &blake3::Hash;
}

pub(crate) struct MarkdownSaveSnapshot {
    pub file_handle_id: String,
    pub handle_revision: u64,
    pub project_id: String,
    pub root_identity: ProjectRootIdentity,
    pub relative_path: String,
    pub text: String,
    pub has_utf8_bom: bool,
    pub base_disk: DiskFingerprint,
    pub encoded_digest: blake3::Hash,
}

pub(crate) enum AtomicCommitObservation {
    Replaced,
    OriginalStillPresent,
    StagedContentPresent,
    Unknown,
}
```

- `ProjectRootIdentity` và `ValidatedFileWriteTarget` thuộc `path_policy.rs` theo BE-013; `DiskFingerprint` thuộc `reader.rs` theo BE-014. `writer.rs` chỉ sở hữu hai type atomic-write mới ở trên, không nhân bản root/path/fingerprint authority.
- `FileMetadataSnapshot` capture đúng metadata cần kiểm/giữ: Windows file attributes để chặn read-only và làm preflight cho `ReplaceFileW`; macOS/Unix permission mode để áp lên temp trước sync/rename. Không type nào serialize, persist hoặc log.
- `StagedAtomicWrite` chỉ được dựng sau khi sibling temp đã nhận đủ bytes, `flush` và `sync_all` thành công. Nó sở hữu validated target BE-013 cùng temp path/digest/size; path policy revalidate `target()` trước commit, còn writer dùng digest để phân loại post-failure. Temp path và digest không rời Rust memory.
- `MarkdownSaveSnapshot` không chứa absolute path; service resolve root/path fresh sau khi lấy snapshot.
- `encoded_digest` hash đúng bytes staged, gồm BOM. Nó giúp nhận diện kết quả sau lỗi commit mà không expose hash qua IPC/log.
- Save lease là token opaque nội bộ theo `file_handle_id` + monotonically increasing operation ID. Lease không persist và không được frontend cấp.

## DTO public

Các DTO derive `Clone`, `Debug`, `Serialize`, `Deserialize`, `TS`; struct dùng `camelCase`, enum serialize chuỗi `camelCase`. `FileHandleDto`, `FileDiskVersionDto` và `FileHandleChangedEventDto` giữ contract BE-014.

```rust
pub struct UpdateMarkdownBufferRequestDto {
    pub file_handle_id: String,
    pub expected_revision: String,
    pub base_disk_revision: String,
    pub text: String,
}

pub struct SaveMarkdownFileRequestDto {
    pub file_handle_id: String,
    pub expected_revision: String,
}

pub enum MarkdownSaveOutcomeDto {
    AlreadyClean,
    Saved,
    SavedWithNewerEdits,
}

pub struct SaveMarkdownFileResultDto {
    pub outcome: MarkdownSaveOutcomeDto,
    pub saved_disk: Option<FileDiskVersionDto>,
    pub file: FileHandleDto,
}
```

- `base_disk_revision` lấy từ disk version mà editor đã render. Đây là opaque token dài `1..=128` byte, không có control character; frontend không được tạo, normalize hoặc parse nó.
- `expected_revision` là handle revision decimal string từ snapshot cuối editor đã áp. Backend parse checked `u64`; token sai shape trả `InvalidRevision`.
- `saved_disk = None` chỉ với `AlreadyClean`; hai outcome có ghi đều trả disk version vừa commit.
- `Saved` nghĩa buffer hiện tại bằng bytes vừa ghi và handle sạch. `SavedWithNewerEdits` nghĩa đúng snapshot yêu cầu đã ghi nhưng local buffer nhận edit mới trong lúc save, do đó vẫn dirty.

BE-015 mở rộng enum `FileHandleChangeKindDto` của BE-014:

```rust
pub enum FileHandleChangeKindDto {
    Reloaded,
    ConflictDetected,
    Missing,
    Unreadable,
    ProjectRootChanged,
    WatchModeChanged,
    EditorUpdated,
    Saved,
}
```

`EditorUpdated` không mang content; consumer khác cần snapshot thì gọi `get_open_file`. `Saved` cũng được dùng khi initiating handle còn newer edits; `FileHandleDto.is_dirty` trong query/command result là authority.

## Tauri command

Hai command chỉ nhận `WebviewWindow::label() == "main"`. Window khác nhận `WindowNotAllowed` trước khi clone text, lấy handle lock, resolve project hoặc chạm filesystem.

### `update_markdown_buffer`

Đưa snapshot CodeMirror mới nhất vào runtime handle và cập nhật dirty/conflict state, không ghi disk.

```rust
/// Applies one editor text snapshot to an open Markdown handle.
#[tauri::command]
async fn update_markdown_buffer(
    request: UpdateMarkdownBufferRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Main window; handle UUID/revision hợp lệ và attached; handle mode là `Markdown`; text encode UTF-8 cộng BOM không vượt `5_242_880`; `base_disk_revision` khớp base editor hoặc tạo được watcher-race conflict theo rule dưới. |
| Side effect | Thay buffer runtime nếu text khác, derive line/count/ending/size, cập nhật dirty timestamp/edit count/revision và phát handle invalidation sau commit. Không đọc hoặc ghi filesystem/database. |
| Lỗi trả về | `InvalidFileHandleId`, `FileHandleNotFound`, `InvalidRevision`, `InvalidDiskRevision`, `RevisionConflict`, `MarkdownNotEditable`, `MarkdownSizeLimitExceeded`, `FileMemoryLimitReached`, `FileOperationUnavailable`. |

Update atomic dưới handle state lock, nhưng không giữ lock qua event emit. Quy tắc stale:

1. Nếu `expected_revision` đúng current revision và base token khớp disk/base của state hiện tại, áp update bình thường.
2. Nếu revision stale nhưng text bằng current local text và base token tương thích, coi là retry idempotent và trả snapshot hiện tại, không tăng revision/edit count/event.
3. Nếu expected revision đúng nhưng `base_disk_revision` khác disk hiện hành, nhận draft làm local dirty và chuyển `ExternalConflict`; token handle hiện hành không được biến disk token cũ thành quyền Save.
4. Nếu revision stale đúng một bước, manager ghi nhận mutation gần nhất là watcher auto-reload trên handle trước đó sạch, và request base token bằng disk version ngay trước reload, nhận draft rồi chuyển `ExternalConflict`.
5. Mọi stale khác trả `RevisionConflict`; local text hiện hành không bị thay. FE giữ draft chưa được acknowledge và query lại trước khi retry intent.

Manager chỉ giữ một `previous_clean_disk_revision` kèm cause `WatcherReload` để áp rule 4; explicit `ReloadFromDisk`, `KeepMine`, Save, close/reopen hoặc editor mutation xóa marker này. Marker là race aid runtime, không phải revision history hay dữ liệu persisted.

Trong state `ExternalConflict`, update hợp lệ chỉ thay `local`, giữ `external`. Trong `Missing`/`Unreadable` có local draft, update hợp lệ thay `local`; Save vẫn bị chặn. `ProjectRootChanged` cho phép update recovery buffer đang có nhưng không cho Save vào root mới. Nếu bytes local bằng disk external/base hiện hành, manager tự trở về `Ready`, clear dirty/conflict vì hai version đã hội tụ.

### `save_markdown_file`

Lưu thủ công snapshot Markdown được chỉ định bằng optimistic disk check và atomic replace.

```rust
/// Saves one acknowledged Markdown snapshot with optimistic disk validation.
#[tauri::command]
async fn save_markdown_file(
    request: SaveMarkdownFileRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<SaveMarkdownFileResultDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Main window; handle/revision attached và Markdown; state không conflict/missing/unreadable/root-changed; expected revision là snapshot local cần ghi. Với handle dirty, root hiện tại phải đúng identity lúc mở và target vẫn regular, writable, không symlink/junction/reparse/mount. |
| Side effect | Stage/sync file temp cùng parent; revalidate full target fingerprint; atomic replace khi bằng base; publish disk version mới, fanout các handle cùng path và phát event sau state commit. Không ghi DB/recent. |
| Lỗi trả về | Lỗi handle/revision/project/path tương ứng; `ExternalChangeDetected`, `MarkdownNotEditable`, `MarkdownSizeLimitExceeded`, `FileNotWritable`, `FileWriteFailed`, `FileSyncFailed`, `AtomicReplaceFailed`, `AtomicCommitStateUnknown`, `FileOperationUnavailable`. |

Handle sạch trả `AlreadyClean` ngay sau validation revision/mode, không resolve path, ghi temp hoặc phát event. Handle conflict không được coi sạch ngay cả khi UI bấm Save; người dùng phải dùng `KeepMine` hoặc `ReloadFromDisk` của BE-014 trước.

Nếu preflight thấy disk khác base, writer discard temp và không commit; manager giữ local, cập nhật `ExternalConflict` với disk version mới, tăng revision/phát `ConflictDetected`, rồi command trả `ExternalChangeDetected { current_revision }`. Nếu target missing/unreadable, manager chuyển state tương ứng với `local = Some`, phát event tương ứng và trả typed path/read error.

## Contract Rust nội bộ và tích hợp capability

BE-015 hoàn thiện editor/save operations trên manager BE-014; không tạo capability hoặc state thứ hai:

```rust
pub(crate) struct MarkdownEditIntent {
    pub file_handle_id: String,
    pub expected_revision: u64,
    pub base_disk_revision: String,
    pub prepared: PreparedMarkdownText,
}

pub(crate) struct PreparedMarkdownText {
    pub text: String,
    pub encoded_byte_size: u64,
    pub encoded_digest: blake3::Hash,
    pub line_count: u32,
    pub line_ending: LineEndingDto,
}

pub struct FileEditorSnapshot {
    pub text: String,
    pub expected_handle_revision: String,
    pub base_disk_revision: String,
}

pub(crate) struct SaveLease {
    pub operation_id: u64,
    pub snapshot: MarkdownSaveSnapshot,
}

impl FilesService {
    /// Validates and applies one editor snapshot through the Files manager.
    pub async fn replace_editor_snapshot(
        &self,
        file_handle_id: &str,
        snapshot: FileEditorSnapshot,
    ) -> Result<FileHandleDto, FilesError>;
}

impl FileHandleManager {
    /// Atomically applies an acknowledged editor snapshot without filesystem I/O.
    pub(crate) fn apply_markdown_edit(
        &self,
        intent: MarkdownEditIntent,
    ) -> Result<FileHandleDto, FilesError>;

    /// Reserves one save snapshot while allowing later local edits to continue.
    pub(crate) fn begin_markdown_save(
        &self,
        file_handle_id: &str,
        expected_revision: u64,
    ) -> Result<SaveLease, FilesError>;

    /// Publishes a committed disk version and reconciles every handle of the path.
    pub(crate) fn commit_markdown_save(
        &self,
        lease: SaveLease,
        saved_text: TextFileDto,
        saved_disk: FileDiskVersionDto,
    ) -> Result<SaveMarkdownFileResultDto, FilesError>;

    /// Releases a failed lease while preserving the latest local buffer.
    pub(crate) fn abort_markdown_save(
        &self,
        lease: SaveLease,
    ) -> Result<(), FilesError>;
}

pub(crate) trait AtomicFileWriter: Send + Sync {
    /// Stages complete bytes in the target parent without changing the target.
    fn stage(
        &self,
        target: ValidatedFileWriteTarget,
        bytes: &[u8],
        metadata: FileMetadataSnapshot,
    ) -> Result<StagedAtomicWrite, FilesError>;

    /// Atomically replaces the target or reports the observed post-failure state.
    fn commit(
        &self,
        staged: StagedAtomicWrite,
        expected: &DiskFingerprint,
    ) -> Result<AtomicCommitObservation, FilesError>;

    /// Explicitly removes a staged temporary file after an aborted operation.
    fn discard(&self, staged: StagedAtomicWrite) -> Result<(), FilesError>;
}
```

- Đây là contract cuối của hook `replace_editor_snapshot` đã reserve ở BE-014 và giữ nguyên input `base_disk_revision`: frontend không cấp `edit_count`; count phải do manager derive, còn base token là dữ liệu bắt buộc để không mất draft trong race watcher-first-edit. Command map DTO sang hook này; hook dùng `apply_markdown_edit` làm primitive duy nhất, không giữ hai đường cập nhật buffer có semantics khác nhau.
- `replace_editor_snapshot` encode/hash/derive line metadata trong blocking worker trước khi tạo `PreparedMarkdownText`; manager chỉ so token/digest và swap state dưới lock, không scan chuỗi 5 MiB trong critical section.
- `begin_markdown_save` kiểm expected revision và tạo lease dưới manager lock rồi nhả lock. Lease chặn save/close/discard khác cùng handle nhưng không chặn `apply_markdown_edit`; operation ID checked ngăn worker cũ commit vào handle đã reopen/reuse.
- Files service lấy `ProjectService::available_root` qua adapter BE-014, so root identity, rồi dùng `FilePathIntent::WriteExistingFile` qua `resolve_writer_target` của BE-013. Nó không nhận project ID/relative path từ Save request.
- Blocking `stage`, raw fingerprint và `commit` chạy trong `spawn_blocking` sau global Files semaphore. Save không giữ manager map lock, watcher lock, project lock hoặc Tauri `State` guard qua `.await`.
- Trước commit, service hỏi manager lease còn live và base fingerprint chưa bị watcher/resolve thay; sau đó fingerprint target lại. Hint watcher của đúng path được defer trong save gate, không bị bỏ.
- `commit_markdown_save` dùng bytes/disk version đã commit làm base cho initiating handle. Nếu current local digest bằng staged digest thì clear dirty/edit count; nếu khác thì giữ current local, giữ dirty metadata và trả `SavedWithNewerEdits`.
- Mọi handle khác cùng project/root/path được reconcile như external change: clean handle nhận content vừa save, dirty handle chuyển conflict. Initiating handle không tự conflict với self-write.
- Close/reopen/discard BE-014 tuần tự với save lease. Close do `Discard changes` chờ lease kết thúc rồi discard current buffer; không được xóa handle trong khi worker còn có quyền commit. Shutdown chờ/cancel trước điểm commit; operation đã vào atomic commit được await đến trạng thái xác định.

### Atomic writer contract

1. Encode bytes một lần: prepend `EF BB BF` khi `has_utf8_bom`, sau đó UTF-8 bytes của `text`. Digest/size dùng đúng buffer này.
2. Resolve target parent từ root/path policy; target phải tồn tại và là regular non-link file. BE-015 không recreate file missing.
3. Tạo sibling temp bằng random UUID và `create_new`; macOS tạo mode `0600` trong lúc stage, Windows kế thừa DACL của parent như file mới bình thường. Collision retry tối đa 3 tên rồi fail; tên temp không được log/event.
4. `write_all`, `flush`, `sync_all`; short write hoặc sync failure explicit discard temp và giữ target/base/local nguyên.
5. Kiểm lease/base còn live, available root/root identity/path metadata và full BLAKE3 fingerprint target ngay sau staging. Mismatch abort temp và đi conflict.
6. Windows gọi `ReplaceFileW(target, temp, NULL, 0, NULL, NULL)`. Không bật cờ ignore ACL/merge error; temp/target cùng volume vì cùng parent. macOS áp permission bits gốc lên temp, sync lại rồi `rename(temp, target)`.
7. Commit success tạo fingerprint mới từ staged digest + post-commit identity/size/mtime. Directory sync được thử sau atomic visibility; failure được log theo category không path/content và không đảo một commit đã thành công.
8. Commit API trả lỗi thì reader inspect target đúng một lần: staged digest hiện tại là success; base digest hiện tại là failure không commit; missing/third digest là `AtomicCommitStateUnknown`. Không tự retry replace.
9. Normal error/drop phải xóa temp. Process bị kill có thể để sibling temp; BE-015 không quét/xóa file khớp pattern ở lần sau vì không thể chứng minh đó không phải file người dùng.

## Event / Channel phát ra

BE-015 dùng event `files://handle-changed` của BE-014, không tạo channel/event name mới.

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `files://handle-changed` | `FileHandleChangedEventDto` | Sau accepted editor update đổi state (`EditorUpdated`), save publish (`Saved`) hoặc pre-save phát hiện conflict/missing/unreadable. | Một event cho mỗi handle revision thực sự đổi; payload không có text/path/hash. Initiating command response là snapshot authority cho caller; consumer khác query lại theo ID/revision. |

- Update retry/no-op, `AlreadyClean`, validation/stage/sync failure trước state change không emit.
- Save fanout phát event theo từng handle sau khi toàn bộ map mutation đã commit; thứ tự xác định là initiating handle trước, rồi handle ID lexical. Không cam kết thứ tự với path khác.
- Emit failure không biến disk commit thành error. Handle state vẫn authority và được chữa bằng query lúc view mount/window focus/recent list refresh.
- Event update có tần suất theo command editor đã coalesce, không dùng cho từng CodeMirror keystroke thô. Backend vẫn áp giới hạn payload/size cho mọi invoke.

## Business rule và invariant

1. Save request chỉ mang handle ID/revision; project/root/path/encoding/BOM không được frontend chọn lại. Target derive hoàn toàn từ attached handle.
2. Chỉ `TextFileModeDto::Markdown` của `.md`/`.markdown` được update/save. SourceReadOnly, binary và too-large luôn trả `MarkdownNotEditable`.
3. Text DTO là UTF-8 Rust `String`; raw write là optional original BOM + exact UTF-8 encode. Không normalize Unicode, newline, whitespace, trailing newline hoặc Markdown syntax.
4. Encoded size inclusive BOM phải `<= 5_242_880`. Rejected update không mutate buffer/revision/dirty state và frontend phải giữ draft cục bộ để sửa/thu nhỏ.
5. Backend derive `line_count`, `line_ending`, byte size, MIME và syntax hint lại; frontend không cấp metadata hoặc dirty/edit count.
6. First accepted distinct edit đặt `dirty_since_ms` theo clock nếu có và `edit_count = 1`. Mỗi accepted distinct snapshot tăng count saturating tại `u32::MAX`; identical retry/no-op không tăng.
7. Local bytes bằng base disk bytes làm handle sạch, clear `dirty_since_ms` và `edit_count = 0`. Trong conflict, local bằng external disk cũng hội tụ và clear conflict an toàn.
8. Handle revision tăng checked cho editor/state/save mutation. Overflow làm capability chuyển internal unavailable và không wrap token.
9. Save snapshot revision phải đã được `update_markdown_buffer` acknowledge. Save không nhận text để tránh bypass dirty/conflict/close authority.
10. Một handle có tối đa một save lease. Save khác, close/discard và conflict resolution serialize với lease; edit mới vẫn được nhận và có thể dẫn đến `SavedWithNewerEdits`.
11. Pre-save luôn gọi available root BE-003. Root identity khác root handle chuyển `ProjectRootChanged`; không ghi path tương đối tương ứng trong root mới.
12. Writer-bound path phải qua grammar và no-link policy BE-013 cho mọi component/target, regular-file check và root bound trước stage lẫn trước commit. Ignore rule đổi sau open không thu hồi quyền handle theo BE-014.
13. Target missing không được tạo lại; target directory/other/link không được thay. Local buffer giữ nguyên để copy hoặc Save sau khi file trở lại và conflict được resolve.
14. Read-only attribute/permission làm `FileNotWritable` kể cả parent có thể replace target; Save không lách ý định read-only bằng rename.
15. Disk correctness authority là full raw fingerprint ngay trước commit, không metadata timestamp, MIME hoặc notify delivery. Watcher/focus polling chỉ giúp phát hiện sớm.
16. Disk fingerprint mismatch không tự retry và không ghi. State external facts được cập nhật trước khi trả `ExternalChangeDetected` để conflict dialog có current timestamp/size.
17. `KeepMine` là user authorization cho đúng external disk fingerprint đã hiển thị. Disk đổi tiếp trước Save vẫn conflict lại; authorization không áp cho version tương lai.
18. Atomic staging không làm target có partial bytes. Trước successful commit, target cũ còn observable; sau commit, target mới đầy đủ observable.
19. Self-write watcher hint cùng saved fingerprint là no-op. Event ngoài xảy ra sau commit được reconcile bình thường; không suppress theo thời gian hoặc chỉ theo path.
20. Khi nhiều handle cùng path, Save một handle không đồng bộ local dirty buffer của handle khác. Handle khác sạch reload; handle khác dirty conflict với saved disk.
21. Save không thay recent timestamp, project last-opened timestamp, session/tab name hoặc Edit/Preview mode. Nó chỉ cập nhật runtime handle/disk file.
22. Save-and-close là orchestration: flush update → save → chỉ khi returned `file.is_dirty == false` mới gọi close command BE-005. Backend không gộp filesystem write và Sessions mutation trong một command.
23. `SavedWithNewerEdits` là success của disk write nhưng không cho close. UI tiếp tục `Unsaved changes`, Save enabled và không báo “Saved” như trạng thái cuối.
24. Mọi stage/commit failure giữ latest local buffer dirty. `AtomicCommitStateUnknown` bắt buộc reconcile/query và disable retry một chạm cho đến khi disk state rõ.
25. Không log Markdown text, bytes, absolute/relative path, BLAKE3 digest, temp name hoặc OS error raw. Log chỉ operation/handle/project opaque ID, duration, byte bucket, platform stage và error category.
26. BE-015 không persist editor buffer. Close với Discard, remove project hoặc Quit sau xác nhận bỏ buffer; hide to tray/chuyển route không đóng handle và không save.

## Lỗi

BE-015 mở rộng `FilesError` hiện hành; enum final sau Phase 2 có thêm các variant từ `InvalidRevision` trở xuống:

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
    InvalidRevision,
    InvalidDiskRevision,
    MarkdownNotEditable,
    MarkdownSizeLimitExceeded { byte_size: u64, limit_bytes: u64 },
    ExternalChangeDetected { current_revision: String },
    FileNotWritable,
    FileWriteFailed,
    FileSyncFailed,
    AtomicReplaceFailed,
    AtomicCommitStateUnknown,
    FileOperationUnavailable,
}
```

Enum canonical này giữ nguyên toàn bộ variant BE-013/014; BE-015 chỉ bổ sung nhóm từ `InvalidRevision` trở xuống.

| Variant BE-015 | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `InvalidRevision` | Revision rỗng, không phải decimal `u64`, có dấu/space hoặc overflow. | Không retry token cũ; query handle và sửa caller. |
| `InvalidDiskRevision` | Base disk token rỗng, quá 128 byte hoặc có control character. | Không retry token tự tạo; lấy nguyên token từ handle snapshot. |
| `RevisionConflict` | Edit/save dựa trên handle mutation không thuộc watcher-race được phép nhận draft. | Giữ draft local, query handle rồi reconcile trước intent mới. |
| `MarkdownNotEditable` | Handle không phải Markdown text editable. | Disable editor/Save; render source/unsupported state từ handle. |
| `MarkdownSizeLimitExceeded` | Bytes UTF-8 + BOM vượt 5 MiB. | Giữ draft, báo actual/limit và cho undo/thu nhỏ/copy. |
| `ExternalChangeDetected` | Full preflight fingerprint khác base đã chấp nhận. | Query handle, mở conflict dialog; tuyệt đối không retry Save tự động. |
| `EntryNotFound` | Target biến mất trước stage/commit. | Giữ local recovery, hiển thị Missing và chờ file trở lại. |
| `NotRegularFile` / `LinkTraversalDenied` | Target bị đổi thành directory/other/link hoặc component không còn an toàn. | Chặn Save, refresh explorer; giữ buffer. |
| `ProjectUnavailable` / `ProjectRootChanged` | Project root mất hoặc được locate sang root khác. | Giữ recovery buffer; không save vào root mới, mở lại file đúng root. |
| `FileNotWritable` | Read-only bit/permission hoặc probe metadata cho biết target không được ghi. | Báo file read-only, cho retry sau khi quyền thay đổi hoặc copy draft. |
| `FileWriteFailed` | Tạo temp/write/flush/cleanup normal path thất bại. | Giữ dirty, cho retry; không hiện raw temp/path/OS error. |
| `FileSyncFailed` | `sync_all` temp thất bại trước commit. | Giữ dirty; không khẳng định dữ liệu đã lưu, cho retry. |
| `AtomicReplaceFailed` | Atomic replace chắc chắn không commit và target vẫn là base. | Giữ dirty, cho retry sau khi giải phóng file/quyền. |
| `AtomicCommitStateUnknown` | Sau OS error target missing hoặc khác cả base lẫn staged digest. | Disable blind retry; reconcile/show recovery guidance và giữ draft. |
| `FileOperationUnavailable` | Save lease/worker/manager shutdown hoặc internal operation state không thể tiếp tục an toàn. | Giữ draft, query/retry sau; không đóng pane tự động. |

Các variant BE-014 khác giữ nguyên mapping. Internal source chain giữ OS code/path để chẩn đoán tại memory nhưng serializer, `Display` public và tracing fields không chứa path/content/temp/digest.

## Luồng chính

### Edit và dirty state

1. FE-018 mở Markdown từ `FileHandleDto`, lưu `base_disk_revision` và handle revision đã render.
2. CodeMirror transaction đầu gửi snapshot ngay. Command validate size/mode rồi manager apply atomically; accepted response là revision mới.
3. FE giữ tối đa một request in-flight, coalesce pending text và gửi tiếp với revision response mới nhất. Không đánh dấu backend-acknowledged cho snapshot lỗi.
4. Manager derive metadata, dirty/edit count và emit `EditorUpdated`; Sessions close impact/Project recent query đọc state này.
5. Nếu watcher đã reload disk trước update đầu, manager nhận local draft thành conflict và trả snapshot conflict; frontend giữ text, mở dialog theo facts BE-014.

### Save thành công

1. Nút/shortcut flush pending update, lấy revision acknowledged cuối rồi gọi `save_markdown_file`.
2. Manager tạo save lease/snapshot. Service encode/hash, resolve available root/path writer intent và stage/sync temp ngoài async worker.
3. Service kiểm lease/base, root/path và full current disk fingerprint lần cuối. Mọi mismatch abort temp và đi conflict, không commit.
4. Writer atomic replace. Service dựng saved disk version và manager publish initiating/other handle cùng path trong một state mutation.
5. Event phát sau mutation. Command trả `Saved` nếu local không đổi, hoặc `SavedWithNewerEdits` nếu user tiếp tục gõ trong lúc worker lưu snapshot cũ.
6. Watcher nhận self-event, hash bằng saved fingerprint và no-op; temp-path event không map tới open target.

### External change trước hoặc trong Save

1. Watcher có thể đã tạo conflict trước Save; command chặn ngay bằng state/revision hiện tại.
2. Nếu watcher chưa giao event nhưng preflight hash khác, service abort temp, re-read external facts và manager tạo conflict trước khi trả `ExternalChangeDetected`.
3. Nếu OS commit báo lỗi, writer inspect target một lần. Base còn nguyên trả `AtomicReplaceFailed`; staged content đã hiện được finalize như success; trạng thái thứ ba trả unknown và giữ dirty.
4. FE không auto retry. User query snapshot, chọn `KeepMine` hoặc `ReloadFromDisk`; Save mới chỉ hợp lệ với revision/base sau lựa chọn.

### Save and close

1. Close dialog từ FE-007 hiển thị `Cancel`, `Discard changes`, `Save and close` theo wireframe; impact lấy từ BE-005/014.
2. `Save and close` flush update rồi gọi Save. Error/conflict/unknown giữ dialog và pane mở.
3. Chỉ `AlreadyClean` hoặc `Saved` với response `is_dirty = false` mới tiếp tục `close_runtime_target`; `SavedWithNewerEdits` quay lại dirty dialog/state.
4. Close command BE-005 tính impact lại. Edit chen sau Save có thể làm impact dirty và ngăn close, nên không có cửa sổ làm mất nội dung.
5. `Discard changes` không gọi BE-015; lifecycle BE-014 bỏ buffer sau xác nhận cụ thể.

## Ràng buộc kỹ thuật

- Blocking: UTF-8 encode/hash lớn, metadata/no-link checks, temp create/write/flush/sync, full disk fingerprint, atomic replace và cleanup chạy trong `tauri::async_runtime::spawn_blocking` sau Files semaphore. Không giữ Tauri State hoặc manager/watcher/project lock qua blocking/await.
- Bảo mật: Main window only; target chỉ từ handle + current available root; no-follow/reparse policy trước stage/commit; temp create-new cùng parent; không cấp filesystem plugin, không shell và không log user content/path/hash.
- Hiệu năng: Max 5 MiB/request/save, tổng handle text budget 64 MiB và tối đa hai Files blocking operation như BE-014. Một handle một save lease; editor coalesce at most one in-flight invoke, backend không clone text quá một working copy ngoài staged bytes.
- Concurrency: Handle revision/base token và operation lease ngăn stale state commit. Path-scoped save gate serialize disk commits cùng path; watcher hint defer/reconcile, editor update vẫn tiến và outcome biểu diễn newer edits.
- Atomicity: Temp cùng directory/volume, complete sync trước replace, no in-place truncate. Windows `ReplaceFileW`, macOS atomic rename; failure được inspect, không auto retry trạng thái mơ hồ.
- Metadata: Windows không bỏ qua lỗi merge ACL/attribute; macOS giữ POSIX permission bits. Modification time/file identity đổi theo save; hard links, xattr/resource fork/metadata ngoài guarantee không phải contract bảo toàn.
- Desktop boundary: Hai command/DTO/error/event kind sinh binding từ Rust; không sửa binding tay. `pnpm tauri build` bắt buộc vì invoke registration và Windows API target dependency thay đổi.
- Platform: Development test Windows gồm NTFS, file locked/read-only, rename replacement, long/UNC path và antivirus-style transient denial. macOS atomic rename/symlink/mount/permission validation hoãn đến release preparation.

## Tiêu chí hoàn thành

- [ ] Chỉ Markdown handle attached được update/save; source/binary/too-large, foreign/stale handle và non-main window bị từ chối trước side effect.
- [ ] Update full snapshot derive metadata/dirty/edit count, identical retry no-op, quay về base clear dirty và watcher-first-edit race giữ draft thành conflict.
- [ ] Bytes UTF-8 cộng BOM đúng boundary `5_242_880`; vượt một byte bị từ chối không mutate. BOM, LF/CRLF/mixed và trailing newline round-trip byte-exact.
- [ ] Save không nhận project/path/text, không autosave và `AlreadyClean` không chạm filesystem/event.
- [ ] Pre-save gọi available root, so root identity, revalidate regular no-link target và full BLAKE3 fingerprint sau staging ngay trước commit.
- [ ] Disk khác base tạo conflict/facts/event rồi trả typed error; không temp nào được commit và local buffer không mất.
- [ ] Stage dùng sibling create-new, complete write/flush/sync; mọi pre-commit failure giữ target bytes cũ và cleanup temp trên normal path.
- [ ] Windows replace giữ atomic complete target và không ignore ACL merge; macOS rename cùng directory atomic và giữ permission bits.
- [ ] Commit error phân biệt base/staged/unknown bằng inspect một lần; không auto retry replace hoặc báo clean khi state chưa xác định.
- [ ] Edit trong khi save dẫn đúng `SavedWithNewerEdits`; disk chứa snapshot đã yêu cầu, local mới hơn vẫn dirty và close bị chặn.
- [ ] Self-watch không conflict initiating handle; handle cùng path sạch reload, handle khác dirty conflict; event revision/order đúng contract.
- [ ] KeepMine cho phép Save đúng disk version đã chọn; disk đổi lần nữa conflict lại. ReloadFromDisk làm buffer sạch và Save no-op.
- [ ] Missing/read-only/link/root-locate/locked file giữ recovery buffer và map đúng typed error; BE-015 không recreate/move/delete target.
- [ ] Save-and-close flush→save→recheck close impact; lỗi, conflict hoặc newer edit không bao giờ đóng pane/tab/session.
- [ ] Không schema/migration/recent timestamp/mode persistence và không webview permission mới; content/path/temp/digest/raw OS error không vào log/event.
- [ ] Generated TypeScript binding chứa hai request, outcome/result, error/event kind mới và contract test phát hiện drift.
- [ ] Mọi function/method/callback/test/helper có comment ngắn; optimistic race, atomic replace ambiguity, save lease và watcher self-event có inline comment giải thích invariant.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và `cargo test --all-targets --all-features` pass.
- [ ] Frontend formatter/lint/type-check/component test pass và xác nhận button cùng Ctrl+S, dirty indicators, conflict và Save and close.
- [ ] `pnpm tauri build` pass trên Windows với binding/invoke/target-specific writer; smoke test NTFS xác nhận editor ngoài atomic-save không bị overwrite âm thầm.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/files/handles.rs` (`#[cfg(test)]`) | Unit | Snapshot idempotency/stale race, dirty/base convergence, edit count/revision, lease, newer edit, multi-handle fanout và close serialization. |
| `src-tauri/src/files/writer.rs` (`#[cfg(test)]`) | Unit | Metadata snapshot theo platform, validated target ownership, encode BOM, sibling temp/collision/cleanup, short write/sync fail, staged digest/size, commit observations và platform adapter fake. |
| `src-tauri/src/files/service.rs` (`#[cfg(test)]`) | Unit | Root/path/fingerprint preflight, stage-before-final-check order, external conflict, self-watch suppression và error mapping. |
| `src-tauri/src/files/models.rs` (`#[cfg(test)]`) | Unit | DTO/outcome/event/error serialization, revision token, actual/limit size và saved-with-newer-edits payload. |
| `src-tauri/tests/files_markdown_save_commands.rs` | Integration | Temp project và managed service: update/save boundary, byte round-trip, manual-only, external modify/delete/replace, read-only/locked/link/root locate, concurrent edit/save/close và two-handle conflict. |
| `src-tauri/tests/app_builder.rs` | Integration | Mock runtime đăng ký thêm đúng hai command, Files state/writer inject được và không capability permission mới. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export DTO/error/event final của Files và fail khi generated `src/bindings/files/` lệch Rust source. |

Integration filesystem chỉ dùng temporary directory, không chạm repository hoặc app data thật. Atomicity test có reader loop và chỉ chấp nhận toàn bộ old hoặc new bytes, không partial; watcher test dùng channel/deadline hữu hạn thay vì sleep mù. Windows native test chạy trên NTFS khi có thể và ghi rõ skip cho môi trường không tạo được symlink/UNC fixture; fake writer vẫn bắt buộc cover mọi failure branch. macOS native suite chạy ở release preparation.

## Câu hỏi mở

Không có.
