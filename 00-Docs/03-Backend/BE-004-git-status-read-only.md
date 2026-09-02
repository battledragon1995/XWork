# BE-004 — Git status read-only

Tài liệu này đặc tả contract đọc Git của một project đã đăng ký. Backend nhận diện repository, đọc HEAD và tổng hợp thay đổi bằng `gix` mà không ghi index, ref, config, object hoặc bất kỳ file nào trong project.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-004` |
| Phase | `1` |
| Capability | `src-tauri/src/projects/` |
| Yêu cầu chức năng | §7.3, §7.5; liên quan §7.1–7.2, §18 và §20 Phase 1 |
| Frontend liên quan | `FE-004`, `FE-005` |
| Phụ thuộc | `BE-003` |

## Mục tiêu

Backend cung cấp snapshot Git mới theo yêu cầu cho card project và Project Overview: project có phải Git repository hay không, HEAD hiện tại, tổng số thay đổi và danh sách đường dẫn thay đổi. Mọi đường dẫn xuất phát từ public contract `ProjectService::available_root` của `BE-003`; frontend không truyền filesystem path và capability không cung cấp thao tác Git ghi.

### Quyết định và giả định đã chốt

- Repository chỉ được nhận diện khi folder project chính là worktree root hoặc bare repository root mà `gix` mở trực tiếp được. Không dùng repository discovery đi ngược lên thư mục cha; mặc định này tránh hiển thị thay đổi ngoài folder người dùng đã đăng ký.
- Card `FE-004` gọi query summary; Project Overview `FE-005` gọi query detail và dùng luôn summary trong kết quả. Tách hai command để card không nhận danh sách path lớn không cần thiết, nhưng cả hai dùng chung một pipeline phân loại.
- Snapshot luôn đọc mới, không persist và không cache. Không thêm watcher Git ở Phase 1; frontend re-query khi route mount, cửa sổ lấy focus, nhận `projects://changed` cho add/locate, hoặc người dùng retry lỗi.
- `changed_count` là số entry hiển thị sau khi gộp status index/worktree theo path; `untracked_count` là tập con của số đó. Untracked dùng chế độ collapsed giống `git status`, nên cả directory chưa track có thể là một entry với dấu `/`; lựa chọn này khớp wireframe và tránh payload phình theo toàn bộ cây build output.
- HEAD phân biệt branch bình thường, branch chưa có commit và detached HEAD. Bare repository vẫn được nhận diện nhưng không có worktree status; UI không được hiển thị bare repository là `clean`.
- Dependency dùng `gix = 0.87.1` với `default-features = false` và chỉ bật `status`, `parallel`, `sha1`, `sha256`. Không bật `command`, network/credentials hoặc `worktree-mutation`; status vẫn được sắp xếp lại sau scan vì iterator song song không cam kết thứ tự.
- Mọi gix handle chỉ sống trong blocking worker của một lần query. Repository mở bằng isolated + strict config để không nhận path/command override từ environment hoặc global include; chỉ repository-local config/ignore/attributes được dùng. Không gọi `Outcome::write_changes`, không refresh index xuống đĩa và không giữ repository handle trong managed state.

### Ngoài phạm vi

- Commit, add/stage, reset, checkout, switch, restore, merge, rebase, stash, fetch, pull, push, clone, init, sửa ref/index/config hoặc tạo branch/tag.
- Hiển thị diff, nội dung file, lịch sử commit, remote, ahead/behind, author, blame hoặc Git graph.
- Theo dõi filesystem/Git liên tục, background polling hoặc phát notification khi status đổi.
- Nhận diện repository nằm trong ancestor của project root hoặc quét repository con lồng bên trong project.
- Thay đổi schema Projects, đưa field Git vào `ProjectDto`, hoặc trộn session/recent file/note/event vào DTO Git.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo `gix` đúng phiên bản và feature đọc status tối thiểu. |
| `src-tauri/Cargo.lock` | Khóa cây dependency của `gix`. |
| `src-tauri/src/app/mod.rs` | Inject Git reader/semaphore vào `ProjectService` và đăng ký hai command Git. |
| `src-tauri/src/projects/mod.rs` | Re-export command, DTO và error extension thuộc Git status. |
| `src-tauri/src/projects/models.rs` | Chứa DTO summary/detail, HEAD và change kind public. |
| `src-tauri/src/projects/git_status.rs` | Mở repository bằng `gix`, đọc HEAD/status, gộp, phân loại và sắp xếp entry mà không ghi. |
| `src-tauri/src/projects/service.rs` | Gọi `available_root`, điều phối blocking worker, giới hạn concurrency và xử lý locate/remove race. |
| `src-tauri/src/projects/commands.rs` | Hai Tauri command mỏng authorize exact invoking window `main` rồi trả summary/detail. |
| `src-tauri/src/projects/error.rs` | Bổ sung lỗi Git đã làm sạch vào `ProjectsError`. |
| `src-tauri/tests/app_builder.rs` | Xác nhận composition root đăng ký command và state bằng mock runtime. |
| `src-tauri/tests/projects_git_status.rs` | Integration test public command với database/project và repository fixture tạm. |
| `src-tauri/tests/export_bindings.rs` | Sinh và kiểm tra binding cho DTO/error Git trong capability Projects. |
| `src/bindings/projects/` | Output TypeScript sinh từ Rust; không chỉnh tay. |

Không có migration hoặc capability permission mới. `gix` chỉ chạy trong Rust và không có filesystem/shell API tổng quát nào được cấp cho webview.

Dependency manifest chính xác:

```toml
gix = { version = "=0.87.1", default-features = false, features = ["status", "parallel", "sha1", "sha256"] }
```

## Dữ liệu

Chức năng không thêm bảng, migration hoặc dữ liệu persist. `ProjectService` giữ `Arc<dyn GitStatusReader>` và một semaphore chỉ cho tối đa `2` scan Git đồng thời; semaphore và reader là runtime infrastructure, không được serialize hoặc backup.

Mỗi scan tạo repository handle cục bộ trong `spawn_blocking`, consume toàn bộ iterator, chuyển thành `GitReadSnapshot` sở hữu dữ liệu rồi drop handle trước khi trả về async context. Service mới gắn project ID và tạo DTO public; không giữ path, HEAD hoặc status giữa hai lần gọi.

## DTO public

Mọi DTO derive `Clone`, `Debug`, `Serialize`, `Deserialize` và `TS`; struct dùng `camelCase`, enum đơn dùng `camelCase`, enum có dữ liệu dùng discriminator `kind`. Binding được sinh vào `src/bindings/projects/` cùng DTO của `BE-003`.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitSummaryDto {
    pub project_id: String,
    pub repository_kind: GitRepositoryKindDto,
    pub head: Option<GitHeadDto>,
    pub changed_count: u32,
    pub untracked_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGitStatusDto {
    pub summary: ProjectGitSummaryDto,
    pub changes: Vec<GitFileChangeDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum GitRepositoryKindDto {
    NotRepository,
    Worktree,
    Bare,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GitHeadDto {
    Branch { name: String },
    Unborn { name: String },
    Detached { short_oid: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChangeDto {
    pub path: String,
    pub previous_path: Option<String>,
    pub change: GitFileChangeKindDto,
    pub is_directory: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum GitFileChangeKindDto {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}
```

Invariant theo `repository_kind`:

| Kind | `head` | Count | `changes` |
|---|---|---|---|
| `NotRepository` | `None` | Cả hai bằng `0` | Rỗng. |
| `Bare` | HEAD hiện tại nếu đọc được; gồm unborn/detached | Cả hai bằng `0` | Rỗng vì không có worktree. |
| `Worktree` | Luôn `Some`; repository hỏng/mất HEAD trả lỗi thay vì tạo tổ hợp thiếu | `untracked_count <= changed_count`; detail có `changed_count == changes.len()` sau checked conversion | Summary command không trả field này; detail chứa đủ entry. |

`GitHeadDto::Branch.name` và `Unborn.name` là tên ref rút gọn, không có `refs/heads/`; byte tên không phải UTF-8 dùng cùng quy tắc escape `\xNN` như path. Detached dùng tám ký tự hex lowercase đầu của object ID chỉ để hiển thị, không dùng làm định danh hay input cho command.

Path trong DTO luôn tương đối với project root, dùng `/` kể cả trên Windows và không bắt đầu bằng `/`, drive prefix hoặc `..`. Byte path không phải UTF-8 được biểu diễn ổn định bằng cách giữ đoạn UTF-8 hợp lệ và escape từng byte còn lại thành `\xNN`; không dùng replacement character vì có thể làm hai path khác nhau trùng nhãn.

`previous_path` chỉ có cho `Renamed`/`Copied`. `is_directory = true` chỉ cho entry `Untracked` bị collapsed; tracked file, symlink và gitlink đều là `false`. Frontend map badge ngắn lần lượt thành `A`, `M`, `D`, `R`, `C`, `T`, `??`, `U`; đây chỉ là presentation của enum typed, không parse porcelain text.

## Tauri command

Hai command là `pub async fn`, nhận invoking `tauri::WebviewWindow` và `project_id` chứ không nhận path. Command authorize exact caller `main` trước validation/service; `quick-note` hoặc label khác nhận `UnauthorizedWindow` trước khi resolve project root hay acquire scan permit. Command chỉ clone service, gọi method và trả DTO/error; không chứa gix mapping hoặc business rule.

### `get_project_git_summary`

Trả HEAD và count hiện tại cho một card project mà không materialize danh sách path public.

```rust
/// Returns the current read-only Git summary for one project.
#[tauri::command]
pub async fn get_project_git_summary(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectGitSummaryDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; `project_id` phải là UUID hyphenated hợp lệ, tồn tại, không trong removal gate và folder hiện available theo `available_root`. |
| Side effect | Đọc HEAD, index và metadata/worktree bằng blocking worker; không ghi database, repository hoặc filesystem và không phát event. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `ProjectUnavailable`, `RemovalInProgress`, `GitInspectionFailed`. |

### `get_project_git_status`

Trả snapshot chi tiết để Project Overview hiển thị branch, summary và toàn bộ change entry.

```rust
/// Returns the current read-only Git status and change list for one project.
#[tauri::command]
pub async fn get_project_git_status(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, ProjectService>,
) -> Result<ProjectGitStatusDto, ProjectsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`, sau đó giống `get_project_git_summary`; backend không nhận pathspec, revision, Git option hoặc include-ignored flag từ frontend. |
| Side effect | Đọc HEAD, index và worktree; gộp và sort danh sách trong blocking worker. Không ghi hoặc phát event. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidProjectId`, `ProjectNotFound`, `ProjectUnavailable`, `RemovalInProgress`, `GitInspectionFailed`. |

`NotRepository` và `Bare` là kết quả thành công để frontend render trạng thái riêng, không phải lỗi. Root có `.git` nhưng metadata hỏng, object/index không đọc được, cấu hình bắt buộc không an toàn hoặc status iteration lỗi trả `GitInspectionFailed`; không hạ thành `NotRepository` vì sẽ che repository bị lỗi.

## Contract Rust nội bộ

`GitStatusReader` là seam đồng bộ hẹp để test service; type gix không đi qua ranh giới này:

```rust
pub(crate) enum GitInspectionMode {
    Summary,
    Detail,
}

pub(crate) struct GitReadSnapshot {
    pub repository_kind: GitRepositoryKindDto,
    pub head: Option<GitHeadDto>,
    pub changed_count: u32,
    pub untracked_count: u32,
    pub changes: Vec<GitFileChangeDto>,
}

pub(crate) trait GitStatusReader: Send + Sync {
    /// Reads one Git snapshot without modifying the repository or worktree.
    fn inspect(
        &self,
        root: &Path,
        mode: GitInspectionMode,
    ) -> Result<GitReadSnapshot, GitReadError>;
}

impl ProjectService {
    /// Resolves a project root and returns its current Git summary.
    pub async fn git_summary(
        &self,
        project_id: &str,
    ) -> Result<ProjectGitSummaryDto, ProjectsError>;

    /// Resolves a project root and returns its current detailed Git status.
    pub async fn git_status(
        &self,
        project_id: &str,
    ) -> Result<ProjectGitStatusDto, ProjectsError>;
}
```

- Service bắt buộc gọi `available_root(project_id)` trước khi acquire scan permit; không đọc `root_path` trực tiếp từ repository Projects.
- Root được clone vào blocking closure. `gix::Repository`, status platform/iterator và raw path bytes được tạo, consume và drop hoàn toàn trong closure vì các type đó không phải managed state.
- Reader không nhận `project_id`, project repository hoặc storage handle. Sau worker thành công, service mới gắn `project_id` vào `ProjectGitSummaryDto` và bọc detail thành `ProjectGitStatusDto`.
- Sau scan, service gọi lại `available_root`. Nếu project đã bị remove/removing/unavailable thì trả lỗi mới nhất. Nếu canonical root đổi do locate, service bỏ snapshot cũ và scan lại đúng một lần; root đổi lần thứ hai trả `GitInspectionFailed` để tránh vòng retry vô hạn.
- `Summary` và `Detail` có cùng detection, HEAD và classification. `Summary` chỉ giữ map tối thiểu để deduplicate/count; `Detail` materialize DTO path. Không được tạo khác biệt count giữa hai mode trên cùng repository snapshot.
- Fake reader trong test không được nhận project repository/storage handle; dependency vẫn một chiều từ Git service sang public project-root contract.

## Event / Channel phát ra

Không có.

Git thay đổi bên ngoài XWork không phát `projects://changed`; event đó vẫn chỉ phản ánh mutation metadata do `BE-003` sở hữu. Frontend lấy freshness bằng query lifecycle đã nêu, không suy diễn status từ event cũ.

## Business rule và invariant

1. Mọi scan bắt đầu từ canonical `PathBuf` do `available_root` trả; command không nhận path hoặc Git revision từ frontend.
2. Chỉ mở repository tại đúng root. Folder con của repository cha là `NotRepository`; linked worktree có `.git` file tại root vẫn là `Worktree`.
3. `NotRepository` chỉ áp dụng khi root không có repository hợp lệ tại chính nó. Permission/corruption/unsupported metadata sau khi đã nhận ra Git trả `GitInspectionFailed`.
4. Query không thay đổi SQLite, `last_opened_at_ms`, HEAD, refs, object database, config, index, file worktree, timestamp nội dung hoặc ignore file.
5. Không gọi bất kỳ gix API init/add/write/checkout/ref edit nào và không gọi `Outcome::write_changes`; status outcome chỉ dùng để đọc thống kê rồi drop.
6. Không spawn `git`, hook, fsmonitor helper, credential helper, textconv, external diff hoặc clean/process filter. Cấu hình đòi external execution bị từ chối thành lỗi inspection đã làm sạch.
7. Status gồm thay đổi `HEAD ↔ index` và `index ↔ worktree`, cùng untracked không bị ignore. Ignored entry không xuất hiện.
8. Cùng current path xuất hiện ở cả staged và unstaged được gộp thành một entry. `changed_count` đếm entry sau gộp, không cộng hai lần.
9. Khi nhiều trạng thái cùng path, kind hiển thị theo ưu tiên: `Conflicted` > `Renamed` > `Copied` > `Deleted` > `Added` > `TypeChanged` > `Modified`; `Untracked` không trùng tracked path hợp lệ.
10. Rename/copy dùng path đích làm `path`, path nguồn làm `previous_path`; staged rename tracking dùng gix tree-index config chuẩn. Rename chưa stage có thể xuất hiện như deleted + untracked, phù hợp hành vi Git status mặc định.
11. Untracked dùng `gix::status::UntrackedFiles::Collapsed`. Một directory collapsed là một entry `Untracked` có path kết thúc `/` và `is_directory = true`; count vì vậy khớp danh sách người dùng thấy.
12. Symlink được stat/hash như Git entry và không được backend follow để đọc target ngoài root. Submodule là một gitlink entry; kiểm ref/worktree ở mức entry nhưng không đệ quy trả file bên trong submodule.
13. HEAD branch trả tên rút gọn; unborn vẫn giữ branch dự kiến; detached trả short OID. Không đọc remote hoặc suy ra upstream/ahead/behind.
14. Entry detail được sort tăng dần theo raw Git path byte của `path`, sau đó `previous_path`, rồi kind. Kết quả vì vậy ổn định dù gix iterator chạy song song không có thứ tự.
15. Scan là snapshot best-effort của filesystem đang thay đổi. Lỗi index/object trong lúc process ngoài ghi Git trả `GitInspectionFailed`; lần query kế tiếp đọc lại từ đầu, không trả partial DTO.
16. `changed_count` chuyển sang `u32` bằng checked conversion. Số entry vượt `u32::MAX` trả `GitInspectionFailed`, không wrap/saturate.
17. Bare repository trả `repository_kind = Bare`, HEAD nếu hợp lệ, count bằng `0` và list rỗng; frontend hiển thị `Bare repository`, không `clean`.
18. Không persist/cache Git snapshot. Quit/restart, route switch hoặc project rename không có cleanup Git riêng.
19. Cả hai Tauri command chỉ authorize exact invoking window `main` từ `WebviewWindow`; label không đến từ payload. Caller sai trả `UnauthorizedWindow` trước project lookup, semaphore hoặc gix/filesystem work; public Rust methods `git_summary`/`git_status` cho adapter backend không áp IPC authorization.

## Lỗi

`BE-004` dùng lại `ProjectsError` của capability và bổ sung đúng một variant public:

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum ProjectsError {
    // UnauthorizedWindow and other variants defined by BE-003 remain unchanged.
    GitInspectionFailed { project_id: String },
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Một trong hai command Git được invoke từ caller khác exact `main`. | Không retry; sửa caller boundary, không bắt đầu scan. |
| `InvalidProjectId` | ID không parse được theo contract `BE-003`. | Không retry input cũ; refresh nguồn project. |
| `ProjectNotFound` | Project không tồn tại hoặc bị remove trong lúc scan. | Bỏ card/đóng overview stale và query lại Projects. |
| `ProjectUnavailable` | Root missing, không phải directory, access denied hoặc I/O availability thất bại. | Giữ project, hiển thị `Unavailable` và hành động locate. |
| `RemovalInProgress` | Project đã vào removal gate trước hoặc trong scan. | Dừng retry Git và chờ project event/query mới. |
| `GitInspectionFailed` | Repository đã nhận diện nhưng HEAD/index/object/config/status không đọc an toàn, external execution bị yêu cầu, root đổi liên tiếp, worker join lỗi hoặc count overflow. | Card/overview hiển thị `Git status unavailable` với `Retry`; không gọi Git write để tự sửa. |

`GitInspectionFailed` chỉ serialize `project_id`. Source chain nội bộ giữ loại gix/I/O/join lỗi cho tracing nhưng public `Display`, IPC và log không chứa absolute path, branch, filename, config value, object ID đầy đủ hoặc nội dung file.

## Luồng chính

### Card project

1. `FE-004` lấy `ProjectDto` từ `BE-003`; chỉ card `Available` mới gọi `get_project_git_summary(project_id)`.
2. Service validate ID và lấy canonical root bằng `available_root`, acquire một trong hai permit rồi chạy reader trong `spawn_blocking`.
3. Reader mở đúng root bằng `gix::open::Options::isolated().strict_config(true)`, không discover ancestor; không phải repo trả `NotRepository`.
4. Với repo, reader đọc HEAD và consume status để deduplicate/count; bare repo bỏ bước status worktree.
5. Service kiểm lại root. Snapshot được trả nếu root không đổi; locate race làm scan lại một lần.
6. Card hiển thị branch/detached label và `clean` hoặc `{changed_count} changed`; `untracked_count` là chi tiết phụ nếu khác `0`. `NotRepository`, `Bare` và lỗi có label riêng.

### Project Overview

1. `FE-005` gọi `get_project_git_status(project_id)` khi overview mount/focus hoặc người dùng retry.
2. Pipeline resolve/open giống summary, nhưng materialize toàn bộ entry sau gộp.
3. Reader sort raw path ổn định, escape path cho DTO, checked-convert count và drop toàn bộ gix handle.
4. Header dùng `summary`; khối `Changes on {head}` dùng `changes`. Khi count bằng `0`, frontend hiển thị trạng thái clean và không dựng action Git.
5. Copy dưới danh sách luôn nêu read-only; commit, checkout và push chỉ có thể được người dùng tự chạy trong terminal, không có command backend tương ứng.

### Add và locate project

1. `BE-003` add/locate chỉ commit metadata và phát `projects://changed`; không nhúng Git vào `ProjectDto` hoặc transaction.
2. Sau event/navigation, frontend gọi summary/detail mới. Git failure không rollback add/locate và không biến project thành unavailable.
3. Nếu locate xảy ra giữa scan, revalidation root loại snapshot cũ theo contract retry một lần.

## Ràng buộc kỹ thuật

- Blocking: mọi thao tác `gix` và filesystem status chạy trọn trong `tauri::async_runtime::spawn_blocking`; không giữ `tauri::State`, storage mutex, removal gate lock hoặc Tokio lock qua worker. Semaphore async giới hạn tối đa hai scan đang chạy; gix `parallel` được phép dùng thread nội bộ.
- Bảo mật: mở repository bằng `gix::open::Options::isolated().strict_config(true)` và trust tự phát hiện, không ép `Trust::Full`; không đọc environment/global include. Preflight repository-local config/attributes và từ chối mọi executable filter/helper trước khi status; không bật feature command/network/credential/mutation, không chạy external process/hook. Chỉ trả path tương đối đã escape và log project ID + operation ổn định.
- Read-only: không gọi Git CLI hoặc API ghi, không tạo `.git/index.lock`, không ghi index refresh từ status outcome, không sửa access-visible metadata có chủ đích. Integration test hash HEAD/ref/index/config cùng nội dung worktree trước/sau cả hai command.
- Hiệu năng: summary không serialize path; detail trả đầy đủ entry collapsed. Sort sau iterator vì gix parallel không có order. Không đọc blob content để trả về UI, không tính diff/ahead-behind và không scan submodule đệ quy.
- Concurrency: tối đa hai scan toàn app; query cùng project không chia sẻ cache. Mỗi scan có thể phản ánh process ngoài thay đổi worktree đồng thời nhưng không trả partial DTO khi iterator lỗi. Root được revalidate và chỉ retry locate một lần.
- Platform: test phát triển trên Windows gồm drive path, linked worktree, symlink/junction không-follow và file đang bị lock. macOS validation được hoãn tới release preparation; path DTO vẫn luôn dùng Git separator `/`.
- Generated contract: DTO/error chỉ sinh từ Rust vào `src/bindings/projects/`; không viết TypeScript binding bằng tay.

## Tiêu chí hoàn thành

- [ ] `gix = 0.87.1` được khóa với đúng feature `status`, `parallel`, `sha1`, `sha256`; feature command/network/credentials/worktree mutation không xuất hiện trong dependency direct.
- [ ] Root plain folder trả `NotRepository`; repository ở parent không bị discover; normal worktree, linked worktree và bare được phân loại đúng.
- [ ] Branch, unborn và detached HEAD serialize đúng; detached label có tám hex lowercase và không được dùng làm input.
- [ ] Clean repo có count `0`; staged, unstaged, added, deleted, type-change, rename/copy, conflict và untracked/ignored map đúng enum và count.
- [ ] Cùng path staged + unstaged chỉ đếm một; untracked directory collapse đúng, ignored không xuất hiện, submodule không bị scan đệ quy.
- [ ] Detail path tương đối, `/`-separated, escape non-UTF-8 ổn định, không có absolute prefix hoặc `..`; ordering ổn định qua nhiều lần chạy song song.
- [ ] Summary và detail cho cùng snapshot có head/count giống nhau; summary không materialize/serialize danh sách path public.
- [ ] Missing/unavailable/removing map đúng lỗi `BE-003`; corrupt/permission/index/config/gix failure map `GitInspectionFailed` và không bị giả thành `NotRepository`.
- [ ] Locate race bỏ snapshot root cũ và retry đúng một lần; remove race không trả thành công cho project đã vào gate hoặc bị xóa.
- [ ] Hai scan tối đa chạy đồng thời; mọi gix handle sống trong blocking worker và không có blocking work trên async worker.
- [ ] Snapshot trước/sau chứng minh cả summary/detail không đổi HEAD, ref, index, config, object, worktree content hoặc tạo lock/temp file trong repository.
- [ ] Không có Tauri command/event/channel cho Git write; card và overview chỉ render dữ liệu typed và nhãn read-only.
- [ ] Hai command nhận invoking `WebviewWindow`, chỉ exact `main` thành công; `quick-note`/label khác nhận `UnauthorizedWindow` trước project lookup hoặc scan và không làm đổi semaphore/repository.
- [ ] Binding TypeScript sinh từ Rust và contract test fail khi output lệch hoặc có DTO viết tay.
- [ ] Mọi function/method/callback/test/helper có comment ngắn; mapping precedence/path escape có inline comment giải thích invariant.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và `cargo test --all-targets --all-features` pass.
- [ ] Frontend formatter, lint, type-check, component test/build liên quan pass và xác nhận card summary cùng overview change list/error/clean states.
- [ ] `pnpm tauri build` pass vì thay đổi dependency, invoke handler và generated IPC contract.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/projects/git_status.rs` (`#[cfg(test)]`) | Unit | Detection exact-root; HEAD branch/unborn/detached/bare; status mapper/precedence/dedup; rename/copy/conflict; collapsed untracked/ignored; raw-byte path escape/sort; checked count. |
| `src-tauri/src/projects/service.rs` (`#[cfg(test)]`) | Unit | Fake `available_root`/reader; unavailable/removal mapping; semaphore hai permit; locate retry một lần; no partial result và error sanitization. |
| `src-tauri/tests/projects_git_status.rs` | Integration | Exact `main` gọi summary/detail thành công; `quick-note`/label khác nhận `UnauthorizedWindow` trước resolver/reader; project/database và Git fixtures trong temp directory; plain/parent/linked/bare/corrupt repo; staged/unstaged/untracked/submodule; repository tree bất biến trước/sau query. |
| `src-tauri/tests/app_builder.rs` | Integration | Mock runtime build với ProjectService/Git reader và hai invoke command đã đăng ký. |
| `src-tauri/tests/export_bindings.rs` | Contract | Sinh DTO/error Projects có Git cùng `UnauthorizedWindow` và fail khi binding khác Rust source. |

Fixture Git chỉ được tạo trong temporary directory dành riêng cho test và bị hủy sau test; không dùng repository đang phát triển, app data thật hoặc Git credential/network. Test setup có thể xây repository fixture bằng test-only plumbing, nhưng production command path phải được kiểm bằng seam/read-only snapshot để không gọi API ghi.

## Câu hỏi mở

Không có.
