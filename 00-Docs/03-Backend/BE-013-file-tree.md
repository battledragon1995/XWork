# BE-013 — File tree

Tài liệu này đặc tả backend duyệt và tìm cây file của một project ở mức contract. Backend là ranh giới duy nhất chạm filesystem: mọi request bắt đầu từ project ID đã đăng ký, lấy root khả dụng qua Projects, áp dụng ignore rule cục bộ và không đi theo symbolic link hoặc Windows reparse point.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-013` |
| Phase | `2` |
| Capability | `src-tauri/src/files/` |
| Yêu cầu chức năng | §11.1; liên quan §1–2, §4.3, §9.2, §11.2, §14, §18 và §20 Phase 2 |
| Frontend liên quan | `FE-016`; cung cấp path đã kiểm tra để `FE-017`, `FE-018` dùng qua `BE-014` |
| Phụ thuộc | `BE-003` |

## Mục tiêu

Backend cho phép File Explorer tải lười từng cấp của cây file, tìm entry theo tên trên toàn project, refresh từ filesystem thật, lấy path để sao chép và reveal entry trong file manager hệ điều hành. Kết quả ổn định, có giới hạn tài nguyên, tuân ignore rule và không cho frontend dùng path tùy ý để thoát khỏi project đã đăng ký.

### Quyết định và giả định đã chốt

- Cây dùng lazy loading theo direct children, không trả một snapshot đệ quy khổng lồ. Đây là mặc định phù hợp thao tác mở/thu gọn folder và giữ payload IPC hữu hạn.
- Refresh không có command mutation riêng: frontend gọi lại `list_file_children` cho root và các folder đang mở, hoặc gọi lại `search_file_tree`. Mỗi call dựng matcher/walker mới nên thay đổi file và ignore rule được thấy ngay; backend không cache cây.
- Ignore policy chỉ lấy nguồn nằm trong project: `.ignore`, `.gitignore` lồng nhau và `.git/info/exclude`. Không đọc ignore file ở parent của project hoặc global Git config vì chúng nằm ngoài sandbox và làm cây thay đổi theo cấu hình máy khó quan sát.
- Hidden entry không tự bị loại chỉ vì tên bắt đầu bằng dấu chấm hoặc có hidden attribute; developer cần thấy các file như `.env` và `.gitignore`. Riêng metadata directory `.git`, `.hg`, `.svn` luôn bị prune để không lộ internals VCS và tránh scan tốn kém.
- Symbolic link, junction, mount point và Windows reparse point được hiển thị như entry lá `SymbolicLink`, nhưng không bao giờ được mở rộng hoặc dùng làm thành phần trung gian. Đây là cách hiểu an toàn nhất của yêu cầu “không theo symbolic link mặc định” khi chưa có setting cho phép follow link.
- Path IPC dùng UTF-8, separator `/`, tương đối từ project root. Entry có tên không biểu diễn lossless bằng UTF-8 bị bỏ khỏi kết quả và tạo warning; không dùng lossy string làm identity hoặc path có thể thao tác.
- Tìm kiếm là substring không phân biệt hoa thường trên basename của file/folder, trả danh sách phẳng. Không tìm nội dung file và không dùng fuzzy ranking ở capability này.
- `Copy path` dùng response path hẹp do backend đã revalidate; frontend sao chép chuỗi vào clipboard. Không thêm filesystem/clipboard plugin tổng quát cho webview.

### Ngoài phạm vi

- Tạo, đổi tên, di chuyển, xóa file/folder hoặc bất kỳ filesystem mutation nào.
- Đọc nội dung, nhận diện binary/kích thước, syntax highlighting, sửa/lưu Markdown, recent files và file watcher; các hành vi này thuộc `BE-014` và frontend tương ứng.
- Quản lý tab/pane/session hoặc quyết định file sẽ mở ở tab mới, pane trống hay split; Files chỉ trả identity tương đối đã kiểm tra.
- Tìm nội dung file, indexing lâu dài hoặc ranking hợp nhất của Command Palette; `BE-010` chỉ dùng public query của Files khi flow mở file thật đã sẵn sàng.
- Cho phép follow symlink/reparse point, custom ignore setting, file exclude do người dùng cấu hình hoặc hiển thị VCS metadata.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo exact dependency `ignore = "=0.4.33"`; dùng official opener plugin đã được Projects ghép để reveal từ Rust. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi cập nhật manifest. |
| `src-tauri/src/lib.rs` | Export module `files`. |
| `src-tauri/src/app/mod.rs` | Khởi tạo `FilesService` từ public `ProjectService`, semaphore và platform adapter; manage state và đăng ký command Files. |
| `src-tauri/src/files/mod.rs` | Public entry của capability và re-export DTO/error/service cần cho composition cùng consumer tương lai. |
| `src-tauri/src/files/models.rs` | Request/response DTO, entry kind, warning và hằng số giới hạn public. |
| `src-tauri/src/files/path_policy.rs` | Sở hữu root identity, relative-path grammar, intent resolver, component/symlink/reparse validation và writer-target newtype dùng lại ở BE-014/015. |
| `src-tauri/src/files/walker.rs` | Adapter `ignore` cho direct-child page và recursive name search với ignore policy cố định. |
| `src-tauri/src/files/service.rs` | Orchestration `available_root`, blocking scan, giới hạn concurrency, retry root race và reveal/path action. |
| `src-tauri/src/files/platform.rs` | Port hẹp gọi `reveal_item_in_dir` từ Rust và fake adapter cho test. |
| `src-tauri/src/files/commands.rs` | Tauri command mỏng, kiểm window/input, gọi service và trả DTO/error typed. |
| `src-tauri/src/files/error.rs` | `FilesError`, mapping `ProjectsError`, filesystem/ignore/opener error không lộ path tuyệt đối. |
| `src-tauri/tests/app_builder.rs` | Xác nhận Files state, opener adapter và command được ghép trong mock runtime. |
| `src-tauri/tests/files_tree_commands.rs` | Integration test public boundary với project/temp tree, ignore, symlink/reparse, pagination và reveal fake. |
| `src-tauri/tests/export_bindings.rs` | Sinh và kiểm tra TypeScript binding cho DTO/error public của Files. |
| `src/bindings/files/` | Output TypeScript do `ts-rs` sinh; không chỉnh tay. |

Không cần migration hoặc capability filesystem/opener cho webview. Frontend chỉ invoke command XWork; official opener được gọi từ Rust qua adapter hẹp.

## Dữ liệu

BE-013 không tạo schema, bảng hoặc migration. Mỗi page cây file, kết quả tìm kiếm, cursor và path action là snapshot runtime được dựng trực tiếp từ filesystem hiện hành dưới project root đã validate; chúng không được persist, index lâu dài hoặc dùng làm authority sau response. Source project vẫn nằm nguyên tại folder gốc và mọi thay đổi bên ngoài chỉ xuất hiện ở lần query/refresh kế tiếp.

## DTO public

```rust
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ListFileChildrenRequestDto {
    pub project_id: String,
    pub directory: String,
    pub cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileTreeRequestDto {
    pub project_id: String,
    pub query: String,
}

#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileEntryRequestDto {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FileTreeEntryKindDto {
    Directory,
    File,
    SymbolicLink,
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeEntryDto {
    pub name: String,
    pub relative_path: String,
    pub kind: FileTreeEntryKindDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FileTreeWarningReasonDto {
    UnreadableEntry,
    InvalidIgnoreRule,
    UnsupportedName,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeWarningDto {
    pub relative_directory: String,
    pub reason: FileTreeWarningReasonDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileTreePageDto {
    pub project_id: String,
    pub directory: String,
    pub entries: Vec<FileTreeEntryDto>,
    pub next_cursor: Option<String>,
    pub warning_count: u32,
    pub warnings_truncated: bool,
    pub warnings: Vec<FileTreeWarningDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FileSearchTruncatedReasonDto {
    ResultLimit,
    ScanLimit,
    DepthLimit,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeSearchDto {
    pub project_id: String,
    pub query: String,
    pub matches: Vec<FileTreeEntryDto>,
    pub truncated_reason: Option<FileSearchTruncatedReasonDto>,
    pub warning_count: u32,
    pub warnings_truncated: bool,
    pub warnings: Vec<FileTreeWarningDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileEntryPathsDto {
    pub relative_path: String,
    pub absolute_path: String,
}
```

- `directory = ""` biểu diễn project root; mọi path khác không có leading/trailing `/`.
- `Directory` là loại duy nhất có thể gọi `list_file_children`. `SymbolicLink` gồm symlink file/directory, junction, mount point và Windows reparse point; `Other` gồm filesystem object không phải regular file/directory/link và luôn là leaf.
- `warnings` chứa tối đa 20 cặp directory/reason duy nhất theo thứ tự gặp; `warning_count` đếm toàn bộ issue và `warnings_truncated` cho biết còn warning không được serialize. Ignore match hợp lệ vẫn được áp dụng khi cùng ignore file có rule lỗi.
- `absolute_path` chỉ xuất hiện trong response riêng theo hành động `Copy path`, dùng separator native của OS và không được persist. Tree/search DTO không mang absolute path.
- Tất cả DTO public derive `ts-rs`; binding chỉ được sinh từ Rust.

## Tauri command

Mọi command dưới đây chỉ chấp nhận `WebviewWindow::label() == "main"`. Quick Note hoặc window khác nhận `WindowNotAllowed` trước khi Files truy cập project/filesystem.

### `list_file_children`

Trả một page direct children hiện đang hiển thị được của root hoặc một directory đã mở.

```rust
#[tauri::command]
async fn list_file_children(
    request: ListFileChildrenRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<FileTreePageDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Window `main`; project ID là UUID hyphenated lowercase; `directory` là relative path hợp lệ hoặc chuỗi rỗng; cursor tối đa 8 KiB, đúng version/directory và decode được. Target phải tồn tại, là real directory, không bị ignore và không có link/reparse component. |
| Side effect | Không có; đọc metadata/direct children và ignore file, không mở file content, ghi filesystem/database hay phát event. |
| Lỗi trả về | `WindowNotAllowed`, `InvalidProjectId`, `ProjectNotFound`, `ProjectUnavailable`, `ProjectRemovalInProgress`, `ProjectAccessFailed`, `InvalidRelativePath`, `InvalidCursor`, `EntryNotFound`, `EntryNotVisible`, `NotDirectory`, `LinkTraversalDenied`, `TraversalLimitExceeded`, `FileSystemReadFailed`, `ProjectRootChanged`. |

Page có tối đa 500 entry; `next_cursor` chỉ có khi còn entry visible sau page hiện tại. Cursor là opaque base64url JSON chứa version, directory và sort key của entry cuối; không chứa absolute path và không phải authority. Backend decode, validate lại rồi trả các entry có sort key lớn hơn. Filesystem đổi giữa hai page có thể làm entry mới bị lỡ hoặc xuất hiện ở page sau; refresh phải bỏ cursor và tải lại từ đầu, không có cam kết snapshot xuyên page.

### `search_file_tree`

Tìm entry hiển thị được theo basename trong toàn project và trả kết quả phẳng.

```rust
#[tauri::command]
async fn search_file_tree(
    request: SearchFileTreeRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<FileTreeSearchDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Window/project như trên; query trim hai đầu phải có 1–128 Unicode scalar và không chứa control character. |
| Side effect | Không có; recursive scan read-only bằng ignore policy cố định. |
| Lỗi trả về | Các lỗi project/window tương ứng, `InvalidSearch`, `FileSystemReadFailed`, `ProjectRootChanged`. Lỗi subtree/ignore file riêng lẻ trở thành warning và kết quả partial. |

Response giữ query đã trim nhưng không đổi casing. Match dùng Unicode lowercase đơn giản trên `name`, substring literal, không glob/regex/fuzzy và không đọc content. Trả tối đa 200 match; khi còn match, chạm giới hạn 100.000 entry đã xét hoặc gặp nhánh sâu hơn 128 component, set `truncated_reason` tương ứng để UI yêu cầu người dùng thu hẹp filter.

### `get_file_entry_paths`

Revalidate một entry rồi trả relative/native absolute path cho hai hành động sao chép của context menu.

```rust
#[tauri::command]
async fn get_file_entry_paths(
    request: FileEntryRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<FileEntryPathsDto, FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Window/project/path như trên; path không rỗng, entry tồn tại, đang hiển thị theo ignore policy và mọi ancestor là real directory. Target link/reparse được phép vì command chỉ trả path lexical của chính link, không resolve target. |
| Side effect | Không có; frontend chọn field rồi dùng clipboard API hiện hành. |
| Lỗi trả về | Lỗi window/project/path tương ứng, `EntryNotFound`, `EntryNotVisible`, `FileSystemReadFailed`, `ProjectRootChanged`. |

### `reveal_file_entry`

Reveal một entry thật trong file manager mặc định của hệ điều hành.

```rust
#[tauri::command]
async fn reveal_file_entry(
    request: FileEntryRequestDto,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, FilesService>,
) -> Result<(), FilesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Giống `get_file_entry_paths`, nhưng cả target và mọi ancestor phải không phải symlink/reparse point; kiểm target/root lại ngay trước platform call. |
| Side effect | Gọi `tauri_plugin_opener::reveal_item_in_dir` từ Rust; không ghi file/database và không mở shell command. |
| Lỗi trả về | Lỗi window/project/path tương ứng, `LinkTraversalDenied`, `RevealFailed`, `ProjectRootChanged`. |

## Contract Rust nội bộ

```rust
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectRootIdentity {
    pub canonical_key: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FilePathIntent {
    ListDirectory,
    ReadVisibleEntry,
    RevealVisibleEntry,
    OpenVisibleFile,
    ExistingHandleFile,
    WriteExistingFile,
}

pub(crate) struct ValidatedProjectPath {
    pub root_identity: ProjectRootIdentity,
    pub root: PathBuf,
    pub relative_path: String,
    pub absolute_path: PathBuf,
    pub intent: FilePathIntent,
}

pub(crate) struct ValidatedFileWriteTarget(ValidatedProjectPath);

pub(crate) struct FilePathPolicy;

impl FilePathPolicy {
    /// Derives a stable comparison key from a canonical available project root.
    pub(crate) fn identify_root(
        &self,
        canonical_root: &Path,
    ) -> Result<ProjectRootIdentity, FilesError>;

    /// Resolves and validates a read/reveal/open path for one explicit intent.
    pub(crate) fn resolve(
        &self,
        canonical_root: &Path,
        relative_path: &str,
        expected_root: Option<&ProjectRootIdentity>,
        intent: FilePathIntent,
    ) -> Result<ValidatedProjectPath, FilesError>;

    /// Resolves an existing handle-bound regular file into a write-only target.
    pub(crate) fn resolve_writer_target(
        &self,
        canonical_root: &Path,
        relative_path: &str,
        expected_root: &ProjectRootIdentity,
    ) -> Result<ValidatedFileWriteTarget, FilesError>;

    /// Rechecks a previously validated target immediately before its side effect.
    pub(crate) fn revalidate(
        &self,
        target: &ValidatedProjectPath,
    ) -> Result<(), FilesError>;

    /// Rechecks root, containment, regular-file and no-link writer invariants.
    pub(crate) fn revalidate_writer_target(
        &self,
        target: &ValidatedFileWriteTarget,
    ) -> Result<(), FilesError>;
}

impl ValidatedFileWriteTarget {
    /// Returns the validated absolute target to the platform writer only.
    pub(crate) fn absolute_path(&self) -> &Path;

    /// Returns the root identity captured by the path policy.
    pub(crate) fn root_identity(&self) -> &ProjectRootIdentity;
}

pub(crate) trait FileTreeReader: Send + Sync {
    /// Lists one page of visible direct children under a validated directory.
    fn list_children(
        &self,
        root: &Path,
        directory: &Path,
        cursor: Option<&str>,
    ) -> Result<FileTreePage, FileTreeReadError>;

    /// Searches visible entries recursively without reading file contents.
    fn search(
        &self,
        root: &Path,
        query: &str,
    ) -> Result<FileTreeSearch, FileTreeReadError>;
}

pub(crate) trait FilePlatform: Send + Sync {
    /// Reveals one validated non-link path in the native file manager.
    fn reveal_item(&self, path: &Path) -> Result<(), FilesError>;
}

impl FilesService {
    /// Lists direct children after resolving the current registered project root.
    pub async fn list_children(
        &self,
        request: ListFileChildrenRequestDto,
    ) -> Result<FileTreePageDto, FilesError>;

    /// Searches names under the current registered project root.
    pub async fn search_tree(
        &self,
        request: SearchFileTreeRequestDto,
    ) -> Result<FileTreeSearchDto, FilesError>;

    /// Returns copyable paths after revalidating a visible entry.
    pub async fn entry_paths(
        &self,
        request: FileEntryRequestDto,
    ) -> Result<FileEntryPathsDto, FilesError>;

    /// Reveals a validated non-link entry through the platform adapter.
    pub async fn reveal_entry(
        &self,
        request: FileEntryRequestDto,
    ) -> Result<(), FilesError>;
}
```

- `FilesService` gọi public `ProjectService::available_root`; không đọc Projects repository/database hoặc nhận root từ frontend.
- `canonical_key` được derive từ canonical root theo cùng OS comparison rule của BE-003: Windows case-fold path key, macOS giữ exact UTF-8. Nó chỉ dùng so sánh runtime, không serialize/persist/log; locate sang canonical root khác luôn tạo identity khác.
- `resolve` chỉ nhận `expected_root = Some` với `ExistingHandleFile`; các intent visible còn lại dùng current root và `None`. `OpenVisibleFile` bắt buộc visible regular file; `ExistingHandleFile` vẫn kiểm root/containment/regular/no-link nhưng không áp ignore như quyền truy cập cho handle đã mở.
- `WriteExistingFile` không được gọi qua `resolve`; `resolve_writer_target` là entry point duy nhất áp intent này và constructor duy nhất của newtype writer. Nó yêu cầu root identity khớp, target đang tồn tại và là regular file, kiểm mọi component không symlink/junction/reparse/mount; không create target và không dùng ignore rule để thu hồi handle.
- `revalidate` lặp lại rule theo intent ngay trước reveal/open/read; `revalidate_writer_target` lặp lại writer rule trước stage và trước commit. `ValidatedFileWriteTarget` không thể được dựng từ `PathBuf` ngoài `path_policy`, nên BE-015 không nhận raw IPC path làm write authority.
- `path_policy` là contract nội bộ được `BE-014`/`BE-015` tái sử dụng trong cùng capability Files. Nó không được chuyển vào `shared` và không được export thành command filesystem tổng quát.
- `FileTreeReader` chạy đồng bộ trong blocking task. `FilePlatform` chỉ nhận path đã validate; adapter không tự resolve path từ input IPC.

## Event / Channel phát ra

Không có. File tree được refresh theo query có chủ đích; realtime watcher và invalidation event thuộc `BE-014`.

## Business rule và invariant

1. Mọi filesystem operation bắt đầu bằng `ProjectService::available_root(project_id)` tại thời điểm command; project missing, unavailable hoặc removal-in-progress bị chặn trước khi spawn scan.
2. Frontend không truyền absolute path. Relative path dùng `/`, tối đa 4.096 byte UTF-8, không có leading/trailing separator, empty segment, `.`, `..`, `\\`, NUL hoặc control character; chuỗi rỗng chỉ hợp lệ cho root của `list_file_children`.
3. Path được join theo component đã parse, không normalize input xấu thành input khác. `symlink_metadata` kiểm từng component từ root; mọi ancestor symlink/reparse bị từ chối trước khi đọc directory hay gọi platform.
4. Windows coi mọi entry có `FILE_ATTRIBUTE_REPARSE_POINT`, gồm junction/mount point, là `SymbolicLink` dù crate traversal báo loại khác. macOS/Unix dùng `symlink_metadata`; directory có device ID khác project root được coi là link-like `SymbolicLink`. Không platform nào descend qua link hoặc filesystem mount boundary.
5. Tree có thể hiển thị link như leaf nhưng không expand. `get_file_entry_paths` trả path tới link nằm trong root; `reveal_file_entry` từ chối link để platform adapter không canonicalize/follow tới target ngoài root.
6. Ignore policy cố định là `.ignore(true)`, `.git_ignore(true)`, `.git_exclude(true)`, `.require_git(false)`, `.parents(false)`, `.git_global(false)`, `.hidden(false)`, `.follow_links(false)`; `.git`, `.hg`, `.svn` bị prune ở mọi depth trước descent.
7. Direct-child listing dùng matcher mới rooted tại project và `read_dir` đúng một directory; recursive search dùng walker mới rooted tại project. Không giữ matcher giữa command vì matcher cache không tự thấy ignore file đã đổi.
8. Ignore rule hợp lệ vẫn có hiệu lực nếu cùng file có rule lỗi; lỗi parse/I/O ignore riêng lẻ tạo `InvalidIgnoreRule` warning. Entry ignored không tạo warning và không xuất hiện trong list/search.
9. Entry name/path không UTF-8 lossless không được serialize hoặc thao tác; entry đó bị bỏ và tạo `UnsupportedName` warning tại relative parent. Không dùng `to_string_lossy` cho identity/path.
10. Sort key cố định: `Directory`, `File`, `SymbolicLink`, `Other`; trong mỗi nhóm sort theo Unicode lowercase của basename, rồi UTF-8 byte của basename, rồi relative path byte. Page và search dùng cùng key; kết quả không phụ thuộc OS enumeration order.
11. Search chỉ xét basename của mọi visible entry ngoài root. Query matching trên lowercase nhưng response giữ nguyên name/path; không đọc content, metadata dung lượng hay Git status.
12. Tối đa 500 entry/page, 200 search result, 100.000 entry xét/search, 128 path component, 20 warning serialize/response và 8 KiB/cursor. Arithmetic/count dùng checked conversion; vượt `u32` được cap chứ không wrap. Search gặp nhánh sâu hơn giới hạn trả prefix cùng `DepthLimit`; path request vượt giới hạn trả `InvalidRelativePath`.
13. Cả app có tối đa hai Files scan blocking chạy đồng thời. Acquire semaphore trước `spawn_blocking`; request dư chờ bất đồng bộ, không tạo thread/walker trước khi có permit.
14. `list_file_children` có thể scan tối đa 100.000 direct child để sort/page; vượt giới hạn trả `TraversalLimitExceeded`, không trả page mà thứ tự có thể sai. Search chạm scan cap có thể trả prefix xác định với `ScanLimit` vì UI có thể thu hẹp query.
15. Lỗi đọc root/requested directory là fatal. Lỗi entry/subtree riêng lẻ được tổng hợp thành warning và phần còn đọc được vẫn trả; không trả raw OS error, ignore glob hoặc absolute path.
16. Sau blocking work, service gọi lại `available_root`. Nếu project root khác snapshot đầu, bỏ kết quả và retry toàn bộ đúng một lần; đổi tiếp trả `ProjectRootChanged`. Project bị remove/unavailable ở lần kiểm tra sau trả lỗi project tương ứng.
17. Cursor chỉ điều khiển vị trí phân trang sau sort, không cấp quyền và không đảm bảo snapshot. Cursor giả vẫn phải qua size/decode/version/directory/path validation; không bao giờ được dùng trực tiếp làm filesystem path.
18. Không command nào tạo, sửa, đổi tên, di chuyển hoặc xóa entry; không ghi cache/database, không chạy shell, không dùng Tauri filesystem plugin và không log nội dung/path người dùng.
19. `Copy path` chỉ trả absolute path theo yêu cầu explicit trên window chính. Tree/search và public search adapter tương lai chỉ dùng `project_id` + relative path; absolute path không được persist hoặc đưa vào unified search target.
20. UI refresh giữ danh sách cũ trong lúc tải; response thành công thay đúng branch được query. Warning hiển thị thông báo partial có `Retry`; fatal error nêu project/folder gặp lỗi và hành động `Refresh` hoặc quay về Projects theo §18.
21. Directory không có child visible trả `entries = []`, `next_cursor = None`; search không có match trả `matches = []`, `truncated_reason = None`. Hai trường hợp là empty state thành công, không phải `FileSystemReadFailed`.

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
    LinkTraversalDenied { relative_path: String },
    TraversalLimitExceeded,
    FileSystemReadFailed,
    ProjectRootChanged { project_id: String },
    RevealFailed,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `WindowNotAllowed` | Invoke không đến từ main window. | Không retry; chặn capability ngoài đúng window. |
| `InvalidProjectId` | Project ID không phải UUID hyphenated lowercase. | Không retry; refresh identity từ nguồn. |
| `ProjectNotFound` | Project không tồn tại hoặc bị remove trong lúc query. | Đóng Explorer stale và về Projects. |
| `ProjectUnavailable` | Root hiện tại mất, không phải directory hoặc không truy cập được. | Hiển thị `Unavailable` và hành động locate/remove của FE-004. |
| `ProjectRemovalInProgress` | Removal gate của BE-003 đang active. | Disable Explorer và chờ project refresh. |
| `ProjectAccessFailed` | Projects storage/query lỗi không map an toàn sang trạng thái trên. | Hiển thị lỗi tải chung có retry. |
| `InvalidRelativePath` | Path vi phạm grammar/length hoặc root rỗng dùng sai command. | Bỏ selection stale; không gửi lại cùng input. |
| `InvalidSearch` | Query rỗng sau trim, quá dài hoặc có control character. | Giữ cây thường và báo validation cạnh filter. |
| `InvalidCursor` | Cursor quá dài, sai version/directory/shape hoặc sort key không hợp lệ. | Bỏ page đang nối và refresh directory từ đầu. |
| `EntryNotFound` | Entry biến mất giữa render và action/query. | Bỏ row stale rồi refresh parent. |
| `EntryNotVisible` | Entry hiện bị ignore/VCS-prune. | Bỏ row stale rồi refresh parent. |
| `NotDirectory` | Expand target không phải real directory. | Bỏ trạng thái expanded và refresh row. |
| `LinkTraversalDenied` | Path có ancestor hoặc target bị cấm là link/reparse. | Hiển thị entry là leaf; không retry expand/reveal. |
| `TraversalLimitExceeded` | Direct directory vượt 100.000 child hoặc scan không thể cho kết quả hữu hạn đúng contract. | Nêu folder quá lớn và đề nghị dùng filter/OS explorer. |
| `FileSystemReadFailed` | Root/requested directory không đọc được hoặc blocking task lỗi. | Giữ dữ liệu cũ và cho `Refresh`; không hiện raw OS path/error. |
| `ProjectRootChanged` | Root đổi hai lần trong một command dù đã retry. | Reload Project/Explorer từ root mới. |
| `RevealFailed` | Official opener không reveal được path đã kiểm tra. | Giữ selection và cho retry/copy path. |

`Display`, payload và log không chứa absolute path, raw filesystem/ignore/opener error, ignore rule text hoặc cursor. Các field `relative_path` là dữ liệu người dùng đã nhìn thấy trong Explorer.

## Luồng chính

### Expand hoặc refresh directory

1. Command kiểm window, parse DTO và validation cú pháp; service gọi `available_root` trước mọi filesystem work.
2. Service acquire global Files semaphore rồi chạy path validation, matcher và direct-child enumeration trong `spawn_blocking`.
3. Worker bỏ ignored/VCS entry, không descend link, tổng hợp warning, sort toàn bộ direct child trong giới hạn rồi cắt page theo cursor.
4. Worker nhả; service query `available_root` lần nữa. Root đổi thì bỏ page và retry từ bước 1 đúng một lần.
5. Service trả page. Frontend thay branch tương ứng; nút Refresh bỏ cursor và tải lại root/các branch đang expanded theo thứ tự cha trước con.

### Filter/search

1. Query hợp lệ làm frontend chuyển Explorer sang kết quả phẳng; service lấy root mới và acquire semaphore.
2. Blocking walker scan theo thứ tự xác định, áp dụng ignore/VCS/link policy, so khớp basename và dừng khi đủ 201 match hoặc 100.000 entry.
3. Response giữ 200 match đầu, set truncation/warning tương ứng và qua cùng bước kiểm root sau scan.
4. Xóa filter làm frontend bỏ search result và hiển thị lại cây đã load; backend không lưu search state.

### Copy path và reveal

1. Context action gửi project ID cùng relative path từ DTO tree/search; service lấy root và validate lại existence, visibility, component/link policy.
2. Copy trả hai chuỗi sau lần kiểm root cuối; frontend sao chép field absolute hoặc relative theo action đã chọn.
3. Reveal từ chối target link/reparse, kiểm root lần cuối rồi gọi `FilePlatform`; failure không thay đổi Explorer và không có filesystem write.

## Ràng buộc kỹ thuật

- Blocking: `read_dir`, metadata/reparse checks, ignore matcher/walker, sort và path existence checks đều chạy trong `tauri::async_runtime::spawn_blocking` sau semaphore. Không giữ `tauri::State`, project/storage lock hoặc async mutex guard trong closure.
- Bảo mật: Chỉ main window; root chỉ từ BE-003; input chỉ relative path grammar chặt; kiểm từng component không follow link/reparse; không cấp filesystem/opener plugin API cho frontend; không log path/query/cursor/ignore content.
- Hiệu năng: Lazy children page 500, search result 200, scan cap 100.000, depth 128, hai scan song song. Không cache/index/watch; refresh dựng matcher mới. Sequential deterministic order được ưu tiên hơn parallel walk không đảm bảo order.
- Concurrency: Filesystem có thể đổi trong scan; entry-level race thành warning/not-found, root relocation dùng one-retry contract. Không khóa folder project hoặc chặn chương trình ngoài sửa file.
- Platform: Windows test drive/UNC root, hidden file, case behavior, long path, symlink và junction/reparse. macOS symlink/mount validation hoãn đến release preparation theo quy tắc repository.
- Generated contract: Binding sinh từ Rust vào `src/bindings/files/`; test fail khi drift, không sửa tay.

## Tiêu chí hoàn thành

- [ ] `list_file_children` tải đúng root/direct children, directory-first deterministic order, page/cursor 500 entry và root dùng chuỗi rỗng.
- [ ] Expand/collapse/refresh của FE-016 không cần full-tree snapshot; refresh thấy file và ignore-rule thay đổi vì matcher mới được dựng.
- [ ] `.ignore`, `.gitignore` lồng nhau và `.git/info/exclude` hoạt động; parent/global ignore không ảnh hưởng; hidden file hiện được còn `.git`/`.hg`/`.svn` không hiện.
- [ ] Symlink, Windows junction/reparse và mount point hiện như leaf, không thể expand/reveal hoặc làm traversal thoát project.
- [ ] Absolute, drive/UNC, `..`, `.`, empty component, backslash, control/NUL và path quá dài bị từ chối; mọi action revalidate path từ `available_root`.
- [ ] Search trim/validate và match basename case-insensitive, trả tối đa 200 kết quả phẳng cùng truncation/warning rõ ràng, không đọc file content.
- [ ] Entry non-UTF8, subtree unreadable và invalid ignore rule không tạo path lossy; response partial giữ phần hợp lệ và warning được cap.
- [ ] Copy path trả native absolute/normalized relative path chỉ sau validation; tree/search không lộ absolute path và reveal chỉ gọi official opener từ Rust.
- [ ] Project missing/unavailable/removing và root relocation race map đúng typed error; retry root tối đa một lần, không trả snapshot từ root cũ.
- [ ] Root identity và intent resolver phân biệt visible-open với existing-handle access; writer target chỉ được tạo bởi path policy và fail khi root/link/type đổi lúc revalidate.
- [ ] Hai scan blocking tối đa chạy đồng thời, mọi giới hạn page/search/depth/scan/cursor được test tại boundary và không overflow count.
- [ ] Không test/command nào tạo, sửa, đổi tên, di chuyển hoặc xóa fixture entry; snapshot filesystem trước/sau list/search/path/reveal bằng fake platform giống nhau.
- [ ] DTO/error TypeScript được sinh từ Rust, command chỉ đăng ký cho composition XWork và Quick Note window bị chặn.
- [ ] Mọi function/method/callback/test/helper có comment ngắn; path containment, reparse detection và partial-result logic có inline comment giải thích invariant.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và `cargo test --all-targets --all-features` pass.
- [ ] Frontend formatter/lint/type-check/unit/component test File Explorer pass; `pnpm tauri build` pass vì command/state/dependency/generated binding mới.
- [ ] Smoke test Windows xác nhận `reveal_item_in_dir`, Copy path/relative path và junction không thoát sandbox; macOS validation để release preparation.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/files/path_policy.rs` (`#[cfg(test)]`) | Unit | Relative grammar, root identity, từng read/open/reveal/handle intent, writer-target construction/revalidation, component walk, UTF-8, lexical join, symlink và Windows reparse fixture. |
| `src-tauri/src/files/walker.rs` (`#[cfg(test)]`) | Unit | Nested ignore precedence, sources enabled/disabled, VCS prune, hidden entry, sorting, cursor, warning aggregation và scan/depth/result cap. |
| `src-tauri/src/files/service.rs` (`#[cfg(test)]`) | Unit | Projects error mapping, semaphore bằng controlled blocking reader, root one-retry race, copy/reveal revalidation và fake platform failure. |
| `src-tauri/src/files/models.rs` (`#[cfg(test)]`) | Unit | DTO/error serialization, cursor round-trip/version/size và checked count conversion. |
| `src-tauri/tests/files_tree_commands.rs` | Integration | Project/temp tree thật qua public service/command: list/search/refresh, `.ignore`/`.gitignore`/exclude, pagination, unavailable/remove race, symlink/junction, non-UTF8 theo platform và filesystem snapshot read-only. |
| `src-tauri/tests/app_builder.rs` | Integration | Composition root manage Files state, ghép Projects/opener adapter và đăng ký bốn command trong mock runtime. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export request/response/entry/warning/error Files và fail khi TypeScript lệch Rust source. |

Filesystem fixture luôn nằm trong temporary directory, không dùng repository đang phát triển hoặc project/app-data thật. Test reveal dùng fake adapter; hành vi mở File Explorer thật được smoke test thủ công. Test symlink/junction skip có điều kiện rõ nếu runner không có quyền tạo link, nhưng Windows reparse policy vẫn phải có unit fixture bắt buộc.

## Câu hỏi mở

Không có.
