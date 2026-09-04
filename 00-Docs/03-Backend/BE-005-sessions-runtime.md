# BE-005 — Sessions runtime

Tài liệu này đặc tả trạng thái runtime của phiên, tab và pane trong một lần chạy XWork. Contract đủ dữ kiện để triển khai backend và sinh binding mà không phải quyết định lại về vòng đời, bố cục, xác nhận hành động phá hủy hoặc trạng thái hiển thị trên sidebar.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-005` |
| Phase | `1` |
| Capability | `src-tauri/src/sessions/` |
| Yêu cầu chức năng | §8, §9; liên quan §4.1, §5.2–5.4, §6.2, §7.5, §14–16, §18 và §20 Phase 1 |
| Frontend liên quan | `FE-001`, `FE-003`, `FE-005`, `FE-006`, `FE-007`, `FE-009`, `FE-010` |
| Phụ thuộc | `BE-003`, `BE-006` |

## Mục tiêu

Backend giữ nguồn dữ liệu chính trong bộ nhớ cho toàn bộ phiên, thứ tự tab và cây split pane trong lần chạy hiện tại; cung cấp command hẹp để frontend tạo, đổi tên, điều hướng, đóng và mở lại cấu trúc này. Backend đồng thời tổng hợp trạng thái hoạt động của từng phiên, điều phối cảnh báo trước khi đóng tài nguyên, cung cấp snapshot quan sát read-only cho `BE-011` và cung cấp điểm tích hợp để `BE-007` cùng các capability file gắn vòng đời nội dung vào pane.

### Quyết định và giả định đã chốt

- Session runtime không có bảng SQLite, migration hoặc restore. Ẩn cửa sổ và chuyển project chỉ đổi trạng thái quan sát; `Quit XWork` hủy toàn bộ state.
- Backend sở hữu thứ tự tab, cây split, tỉ lệ split, tab/pane active và pane đang maximize. Frontend chỉ giữ state kéo thả/resize đang diễn ra và commit kết quả cuối về backend.
- ID runtime là chuỗi opaque có tiền tố (`session-`, `tab-`, `pane-`, `split-`) cùng bộ đếm `u64` tăng đơn điệu trong tiến trình. Chúng chỉ cần duy nhất trong một lần chạy, tránh thêm dependency sinh UUID và tránh đưa số nguyên 64-bit qua JavaScript.
- Mỗi session chỉ giữ một tab vừa đóng. Đóng tab dừng tiến trình nhưng giữ snapshot nội dung trong bộ nhớ qua content lifecycle port để có thể mở lại; đóng tab tiếp theo, xóa session hoặc Quit sẽ hủy snapshot cũ.
- Xóa session luôn cần xác nhận vì không thể hoàn tác. Đóng tab hoặc pane chỉ cần xác nhận khi có tiến trình đang chạy hay file chưa lưu.
- Tỉ lệ split truyền bằng basis point nguyên từ `1000` đến `9000`, không dùng số thực qua IPC. Resize liên tục là state cục bộ của frontend; backend chỉ nhận giá trị khi kết thúc thao tác.
- Giai đoạn 8 cho phép chọn CLI profile thành `ToolSelection` thật trong pane nhưng chưa tạo process. `BE-007` thay nội dung này bằng `Terminal` qua Rust API nội bộ ở giai đoạn 9; public contract cấu trúc không phải thay đổi.
- `notification_context` là public Rust query hẹp cho `BE-011`, không phải Tauri command hoặc DTO frontend. Query trả project, tên session và trạng thái observed trong cùng một snapshot; BE-011 dùng snapshot `get_session` công khai hiện có để kiểm tra exact tab/pane/terminal target khi mở notification, không đọc map/lock nội bộ.
- `attention_sessions` là public Rust query hẹp cho `AppRuntime`/tray, không phải Tauri command hoặc DTO frontend. Query chỉ trả session đang có status `NeedsAttention`, kèm summary và sequence của lần chuyển vào trạng thái đó gần nhất trong cùng một snapshot để tray sắp xếp ổn định mà không phải dựng lịch sử từ Tauri event có thể bị lỡ.

### Ngoài phạm vi

- Tạo PTY, stream terminal output, gửi input, resize terminal hoặc quản lý child process; các việc này thuộc `BE-007`.
- CRUD CLI profile và kiểm tra command có trên máy; `BE-005` chỉ gọi public query của `BE-006`.
- Đọc, watch hoặc lưu file; các capability file sở hữu nội dung và trạng thái chưa lưu.
- Lưu session, tab, pane, terminal buffer hay tab vừa đóng qua lần Quit.
- Thông báo hệ điều hành, notification persistence và unified search ranking; các capability tương ứng chỉ tiêu thụ public query/domain event của Sessions.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo `serde`, `ts-rs` và feature `sync` của Tokio dùng cho DTO, binding và managed state bất đồng bộ. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi cập nhật manifest. |
| `src-tauri/src/lib.rs` | Export module `sessions` cho composition root và integration test. |
| `src-tauri/src/app/mod.rs` | Khởi tạo `SessionManager`, inject project/profile/content ports, manage state, gắn lifecycle hook và đăng ký command. |
| `src-tauri/src/app/data_runtime.rs` | Adapter async reset dùng public impact/shutdown/resume của Sessions mà không gọi true-Quit hoặc re-enter maintenance gate. |
| `src-tauri/src/sessions/mod.rs` | Public entry của capability, re-export command, DTO, error và các Rust port mà capability khác được phép dùng. |
| `src-tauri/src/sessions/models.rs` | ID runtime, DTO public, `SessionNotificationContext`, cây layout, state nội bộ, close target và quy tắc aggregate status. |
| `src-tauri/src/sessions/manager.rs` | Ownership state trong bộ nhớ, invariant, mutation tuần tự theo session, close/reopen, notification context query và Rust API tích hợp nội dung pane. |
| `src-tauri/src/sessions/commands.rs` | Tauri command mỏng: authorize exact invoking window `main`, validate DTO, gọi `SessionManager` và trả DTO/error typed. |
| `src-tauri/src/sessions/error.rs` | `SessionsError` có payload ổn định qua IPC và mapping lỗi nội bộ không làm lộ dữ liệu. |
| `src-tauri/tests/app_builder.rs` | Xác nhận composition root có managed state và toàn bộ command vẫn build bằng mock runtime. |
| `src-tauri/tests/sessions_runtime.rs` | Integration test public command/event boundary với project, profile và pane-content ports giả. |
| `src-tauri/tests/data_management_contract.rs` | Contract test read permit của create session và async quiesce/resume quanh Reset. |
| `src-tauri/tests/export_bindings.rs` | Điểm sinh và kiểm tra binding từ toàn bộ DTO public của Sessions. |
| `src/bindings/sessions/` | Output TypeScript sinh bởi `ts-rs`; không chỉnh tay. |

Không có migration hoặc thay đổi capability permission: đây là state trong bộ nhớ và custom Tauri command đã được giới hạn bằng danh sách đăng ký trong composition root.

## Dữ liệu

`SessionManager` là Tauri managed state duy nhất của capability và có vòng đời bằng tiến trình ứng dụng:

```rust
pub struct SessionManager {
    // Internal state, ports, and event emitter; never serialized.
}
```

- State dùng `tokio::sync::RwLock`; map session theo `SessionId`, giữ `Vec<SessionId>` theo từng project để bảo toàn thứ tự tạo và giữ tập project đang commit close để chặn create chen vào snapshot removal.
- Mỗi mutation của một session được tuần tự hóa; không giữ write lock trong lúc chờ content lifecycle port dừng/khôi phục tài nguyên.
- `revision` là bộ đếm `u64` toàn manager, serialize thành chuỗi thập phân. Mỗi thay đổi quan sát được tăng đúng một lần.
- Mỗi session giữ `attention_sequence: Option<u64>` nội bộ. Khi aggregate status chuyển từ giá trị khác sang `NeedsAttention`, field nhận đúng revision của mutation đó; khi rời `NeedsAttention`, field về `None`; cập nhật khác trong lúc vẫn `NeedsAttention` không đổi sequence.
- `observed_session_id` phản ánh route session hiện tại nhưng không thay thế navigation state của frontend. `main_window_visible` do lifecycle hook của `BE-001` cập nhật; chỉ session thuộc route hiện tại khi cửa sổ đang hiển thị mới được xem là đang được quan sát.
- `notification_context` clone `project_id`, tên session và hai input visibility dưới cùng read lock, rồi nhả lock trước khi trả; do đó existence và `is_observed` thuộc cùng một snapshot tuyến tính.
- Snapshot tab vừa đóng nằm trong session sở hữu nó và không được ghi database, file, backup hoặc log.

## DTO public

Mọi DTO dưới đây derive `Clone`, `Debug`, `Serialize`, `Deserialize` và `TS`; struct dùng `camelCase`, enum có dữ liệu dùng discriminator `kind`, còn enum đơn serialize thành chuỗi `camelCase`. Binding được sinh vào `src/bindings/sessions/` từ test generator, không viết tay.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub status: SessionStatusDto,
    pub running_process_count: u32,
    pub tab_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailDto {
    pub summary: SessionSummaryDto,
    pub tabs: Vec<TabDto>,
    pub active_tab_id: Option<String>,
    pub can_reopen_last_closed_tab: bool,
    pub revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TabDto {
    pub id: String,
    pub name: String,
    pub layout: PaneLayoutNodeDto,
    pub active_pane_id: String,
    pub maximized_pane_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PaneLayoutNodeDto {
    Pane { pane: PaneDto },
    Split {
        split_id: String,
        axis: SplitAxisDto,
        ratio_basis_points: u16,
        first: Box<PaneLayoutNodeDto>,
        second: Box<PaneLayoutNodeDto>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SplitAxisDto {
    Horizontal,
    Vertical,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PaneDto {
    pub id: String,
    pub content: PaneContentDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PaneContentDto {
    Empty,
    ToolSelection { profile_id: String, title: String },
    Terminal { terminal_id: String, profile_id: String, title: String },
    File { file_handle_id: String, title: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatusDto {
    NoToolYet,
    Running,
    UnseenOutput,
    NeedsAttention,
    Finished,
    ExitedWithError,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SplitDirectionDto {
    Right,
    Down,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CloseTargetDto {
    Session { session_id: String },
    Tab { session_id: String, tab_id: String },
    Pane { session_id: String, tab_id: String, pane_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CloseImpactDto {
    pub target: CloseTargetDto,
    pub requires_confirmation: bool,
    pub running_process_count: u32,
    pub running_process_labels: Vec<String>,
    pub unsaved_file_count: u32,
    pub unsaved_file_labels: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CloseResultDto {
    pub target: CloseTargetDto,
    pub session: Option<SessionDetailDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionRuntimeEventDto {
    pub revision: String,
    pub change: SessionChangeKindDto,
    pub project_id: String,
    pub session_id: String,
    pub summary: Option<SessionSummaryDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SessionChangeKindDto {
    Created,
    Updated,
    ActivityChanged,
    Deleted,
}
```

Quy ước DTO:

- `SplitAxisDto::Vertical` đặt `first` bên trái, `second` bên phải; `Horizontal` đặt `first` phía trên, `second` phía dưới.
- `SplitDirectionDto::Right` tạo split `Vertical`; `Down` tạo split `Horizontal`. Pane hiện tại luôn là `first`, pane mới luôn là `second`.
- `PaneContentDto::Terminal` và `File` là contract dành cho content owner; command của `BE-005` không tự tạo terminal/file handle.
- `summary` của event là snapshot sau mutation; riêng `Deleted` đặt `None`. Frontend dùng `revision` để bỏ event cũ và gọi lại query nếu phát hiện khoảng trống.
- Nhãn process/file trong `CloseImpactDto` là chuỗi hiển thị đã làm sạch do content owner cung cấp; không chứa command arguments, environment variables hoặc đường dẫn tuyệt đối ngoài nội dung người dùng đã chọn hiển thị.

## Tauri command

Mọi command là `async`, nhận invoking `tauri::WebviewWindow` cùng `tauri::State<'_, SessionManager>` và không chứa business rule. Command authorize exact caller `main` trước input/owner-port lookup hoặc mutation; `quick-note` và mọi label khác nhận `UnauthorizedWindow` mà không chạm runtime. Tên, ID và enum luôn được backend kiểm tra lại. Public Rust methods cho backend consumers không phải command và không áp IPC window authorization.

### `list_sessions`

Trả danh sách summary theo thứ tự project của `BE-003`, rồi theo thứ tự tạo session trong từng project.

```rust
/// Lists runtime sessions, optionally restricted to one project.
#[tauri::command]
pub async fn list_sessions(
    window: tauri::WebviewWindow,
    project_id: Option<String>,
    state: tauri::State<'_, SessionManager>,
) -> Result<Vec<SessionSummaryDto>, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; nếu có `project_id`, project phải tồn tại; trạng thái `Unavailable` không ngăn đọc session đã có. |
| Side effect | Không có. |
| Lỗi trả về | `UnauthorizedWindow`, `ProjectNotFound`, `ProjectLookupFailed`. |

### `get_session`

Trả snapshot đầy đủ của một session.

```rust
/// Returns one runtime session and its complete tab layout.
#[tauri::command]
pub async fn get_session(
    window: tauri::WebviewWindow,
    session_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; `session_id` phải thuộc runtime hiện tại. |
| Side effect | Không có. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`. |

### `create_session`

Tạo session rỗng và append ngay dưới project với tên `New Session`.

```rust
/// Creates an empty runtime session for an available project.
#[tauri::command]
pub async fn create_session(
    window: tauri::WebviewWindow,
    project_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; project phải tồn tại và khả dụng theo public query của `BE-003`; ngay trước commit, project không được nằm trong project-scoped close guard của manager. |
| Side effect | Await `DataReadPermit`, tạo session chưa có tab, tăng revision và phát event `Created` trước khi nhả permit. Permit không đi qua DTO hoặc IPC. |
| Lỗi trả về | `UnauthorizedWindow`, `ProjectNotFound`, `ProjectUnavailable`, `ProjectLookupFailed`, `RuntimeShuttingDown`. |

### `rename_session`

Đổi tên hiển thị của session; tên trùng được phép.

```rust
/// Renames a runtime session.
#[tauri::command]
pub async fn rename_session(
    window: tauri::WebviewWindow,
    session_id: String,
    name: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; trim hai đầu; từ `1` đến `80` Unicode scalar value; không chứa ký tự điều khiển. |
| Side effect | Cập nhật state; tăng revision; phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `InvalidName`, `CloseInProgress`. |

### `create_tab`

Tạo tab `New Tab` ở cuối session với đúng một pane `Empty`, rồi active tab và pane mới.

```rust
/// Appends an empty tab and makes it active.
#[tauri::command]
pub async fn create_tab(
    window: tauri::WebviewWindow,
    session_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; session tồn tại và không trong close operation. |
| Side effect | Tạo tab/pane; tăng revision; phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `CloseInProgress`. |

### `rename_tab`

Đổi tên một tab; tên trùng được phép.

```rust
/// Renames one tab in a session.
#[tauri::command]
pub async fn rename_tab(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    name: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; session/tab tồn tại; quy tắc tên giống `rename_session`. |
| Side effect | Cập nhật state; tăng revision; phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `InvalidName`, `CloseInProgress`. |

### `move_tab`

Di chuyển tab trước một tab đích; `before_tab_id = None` nghĩa là đưa xuống cuối.

```rust
/// Reorders a tab relative to a stable tab identifier.
#[tauri::command]
pub async fn move_tab(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    before_tab_id: Option<String>,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; các ID thuộc cùng session; `before_tab_id` khác `tab_id`. |
| Side effect | Đổi thứ tự nếu vị trí thực sự thay đổi; chỉ khi đổi mới tăng revision và phát event. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `InvalidMove`, `CloseInProgress`. |

### `set_active_tab`

Chọn tab đang hiển thị trong session.

```rust
/// Selects the active tab in a session.
#[tauri::command]
pub async fn set_active_tab(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; tab thuộc session. |
| Side effect | Cập nhật active tab nếu khác; tăng revision và phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `CloseInProgress`. |

### `set_active_pane`

Chọn pane active trong một tab.

```rust
/// Selects the active pane in a tab.
#[tauri::command]
pub async fn set_active_pane(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    pane_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; tab và pane có quan hệ cha-con đúng. |
| Side effect | Cập nhật active tab/pane nếu khác; tăng revision và phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `PaneNotFound`, `CloseInProgress`. |

### `split_pane`

Thay leaf pane hiện tại bằng split `50/50` và một pane `Empty` mới.

```rust
/// Splits a pane to the right or downward.
#[tauri::command]
pub async fn split_pane(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    pane_id: String,
    direction: SplitDirectionDto,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; tab/pane tồn tại; tab hiện có ít hơn `4` pane. |
| Side effect | Tạo split và pane; pane mới trở thành active; bỏ maximize nếu có; tăng revision; phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `PaneNotFound`, `PaneLimitReached`, `CloseInProgress`. |

### `set_split_ratio`

Commit tỉ lệ cuối của một resize handle.

```rust
/// Commits the final ratio for one split node.
#[tauri::command]
pub async fn set_split_ratio(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    split_id: String,
    ratio_basis_points: u16,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; split thuộc tab; ratio từ `1000` đến `9000`. |
| Side effect | Cập nhật khi giá trị khác; tăng revision; phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `SplitNotFound`, `InvalidSplitRatio`, `CloseInProgress`. |

### `set_maximized_pane`

Maximize một pane hoặc restore layout bằng `pane_id = None` mà không đổi cây split.

```rust
/// Maximizes one pane or restores the tab layout.
#[tauri::command]
pub async fn set_maximized_pane(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    pane_id: Option<String>,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; nếu có, pane phải thuộc tab. |
| Side effect | Chỉ đổi `maximized_pane_id`; pane khác tiếp tục tồn tại/chạy; tăng revision và phát event `Updated`. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `PaneNotFound`, `CloseInProgress`. |

### `select_session_tool`

Chọn CLI profile ở màn hình `New Session`; command tạo tab đầu tiên và một pane `ToolSelection`.

```rust
/// Creates the first tool-selection tab in an empty session.
#[tauri::command]
pub async fn select_session_tool(
    window: tauri::WebviewWindow,
    session_id: String,
    profile_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; session chưa có tab; profile tồn tại và `Available` qua public query của `BE-006`. |
| Side effect | Tạo tab có tên profile, một pane `ToolSelection`, active cả hai; tăng revision; phát event `Updated`. Không tạo process. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `SessionNotEmpty`, `ProfileNotFound`, `ProfileUnavailable`, `ProfileLookupFailed`, `CloseInProgress`. |

### `select_pane_tool`

Gắn CLI profile vào pane `Empty` vừa tạo bằng thao tác split/tab mới.

```rust
/// Stores a tool selection in an empty pane.
#[tauri::command]
pub async fn select_pane_tool(
    window: tauri::WebviewWindow,
    session_id: String,
    tab_id: String,
    pane_id: String,
    profile_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; quan hệ session/tab/pane đúng; pane đang `Empty`; profile tồn tại và khả dụng. |
| Side effect | Đổi content thành `ToolSelection`, dùng tên profile làm title; tăng revision; phát event `Updated`. Không tạo process. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `PaneNotFound`, `PaneNotEmpty`, `ProfileNotFound`, `ProfileUnavailable`, `ProfileLookupFailed`, `CloseInProgress`. |

### `get_close_impact`

Tạo dữ liệu cảnh báo hiện thời cho session, tab hoặc pane.

```rust
/// Inspects the destructive impact of closing a runtime target.
#[tauri::command]
pub async fn get_close_impact(
    window: tauri::WebviewWindow,
    target: CloseTargetDto,
    state: tauri::State<'_, SessionManager>,
) -> Result<CloseImpactDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; target và quan hệ cha-con tồn tại. |
| Side effect | Gọi content lifecycle port ở chế độ chỉ đọc; không đổi state. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `PaneNotFound`, `ContentLifecycleFailed`. |

### `close_runtime_target`

Đóng/xóa target sau khi kiểm tra lại impact ngay tại thời điểm commit.

```rust
/// Closes a session, tab, or pane with explicit confirmation when required.
#[tauri::command]
pub async fn close_runtime_target(
    window: tauri::WebviewWindow,
    target: CloseTargetDto,
    confirmed: bool,
    state: tauri::State<'_, SessionManager>,
) -> Result<CloseResultDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; target còn tồn tại; nếu target là session hoặc impact có blocker thì `confirmed` phải là `true`. |
| Side effect | Đánh dấu target đang đóng; dừng/discard content qua lifecycle port; cập nhật/collapse layout hoặc xóa session; tăng revision; phát `Updated` hoặc `Deleted`. Tab đóng được giữ làm snapshot reopenable. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `TabNotFound`, `PaneNotFound`, `ConfirmationRequired`, `CloseInProgress`, `ContentLifecycleFailed`. |

### `reopen_last_closed_tab`

Khôi phục tab vừa đóng gần nhất trong session, gồm layout, terminal buffer đã kết thúc và buffer file còn trong snapshot runtime.

```rust
/// Reopens the most recently closed tab in a session.
#[tauri::command]
pub async fn reopen_last_closed_tab(
    window: tauri::WebviewWindow,
    session_id: String,
    state: tauri::State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; session có snapshot tab vừa đóng; snapshot chưa bị discard. |
| Side effect | Content lifecycle port restore snapshot; chèn tab về vị trí cũ đã clamp theo số tab hiện tại; active tab/pane đó; xóa slot reopen; tăng revision; phát event `Updated`. Không khởi chạy lại process đã dừng. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `NoClosedTab`, `CloseInProgress`, `ContentLifecycleFailed`. |

### `set_observed_session`

Ghi nhận route session hiện tại để xác định output đã được nhìn thấy; `None` khi người dùng rời màn hình session. Trạng thái session được chọn để tô nền sidebar vẫn do router/frontend sở hữu.

```rust
/// Updates the session currently observed by the main application route.
#[tauri::command]
pub async fn set_observed_session(
    window: tauri::WebviewWindow,
    session_id: Option<String>,
    state: tauri::State<'_, SessionManager>,
) -> Result<Option<SessionSummaryDto>, SessionsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; nếu có, session phải tồn tại. |
| Side effect | Đổi session đang được quan sát; nếu cửa sổ chính đang hiển thị thì clear `unseen_output` của session mới. Chỉ tăng revision và phát `ActivityChanged` khi summary thực sự đổi. |
| Lỗi trả về | `UnauthorizedWindow`, `SessionNotFound`, `RuntimeShuttingDown`. |

## Contract Rust nội bộ cho capability liên quan

Các API này được re-export từ `sessions/mod.rs`, không phải Tauri command và không được frontend gọi trực tiếp:

```rust
pub enum ProjectSessionAvailability {
    Available,
    Unavailable,
}

pub struct LaunchableProfile {
    pub id: String,
    pub display_name: String,
    pub is_available: bool,
}

pub enum PaneContentRef {
    ToolSelection { profile_id: String, title: String },
    Terminal { terminal_id: String, profile_id: String, title: String },
    File { file_handle_id: String, title: String },
}

pub struct PaneCloseImpact {
    pub running_process_labels: Vec<String>,
    pub unsaved_file_labels: Vec<String>,
}

pub enum CloseRetention {
    Discard,
    ReopenLastTab,
}

pub enum PaneContentOwner {
    Sessions,
    Terminal,
    Files,
}

pub struct ReopenHandle {
    pub owner: PaneContentOwner,
    pub token: String,
}

pub struct PaneActivitySnapshot {
    pub running_process_count: u32,
    pub needs_attention: bool,
    pub finished_process_count: u32,
    pub failed_process_count: u32,
}

pub struct ShutdownImpact {
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

pub struct ProjectSessionsImpact {
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

pub struct SessionNotificationContext {
    pub project_id: String,
    pub session_name: String,
    pub is_observed: bool,
}

pub struct SessionAttentionSnapshot {
    pub summary: SessionSummaryDto,
    pub attention_sequence: u64,
}

pub type PaneRuntimeFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait ProjectSessionAccess: Send + Sync {
    /// Resolves whether a project may receive a new session.
    fn session_availability<'a>(
        &'a self,
        project_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<ProjectSessionAvailability, SessionsError>>;

    /// Returns project identifiers in the ordering owned by Projects.
    fn ordered_project_ids<'a>(
        &'a self,
    ) -> PaneRuntimeFuture<'a, Result<Vec<String>, SessionsError>>;
}

pub trait CliProfileLookup: Send + Sync {
    /// Resolves the current display name and availability of one profile.
    fn launchable_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<LaunchableProfile, SessionsError>>;
}

pub trait PaneContentRuntime: Send + Sync {
    /// Inspects process and unsaved-file blockers for pane content.
    fn close_impact<'a>(
        &'a self,
        content: &'a PaneContentRef,
    ) -> PaneRuntimeFuture<'a, Result<PaneCloseImpact, SessionsError>>;

    /// Closes pane content and optionally returns a runtime-only reopen handle.
    fn close<'a>(
        &'a self,
        content: &'a PaneContentRef,
        retention: CloseRetention,
    ) -> PaneRuntimeFuture<'a, Result<Option<ReopenHandle>, SessionsError>>;

    /// Restores content retained for the last closed tab without restarting a process.
    fn reopen<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<PaneContentRef, SessionsError>>;

    /// Permanently releases an evicted runtime-only reopen handle.
    fn discard<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<(), SessionsError>>;
}

impl SessionManager {
    /// Lists one owner-produced runtime snapshot for commands and consumers.
    pub async fn list_sessions(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<SessionSummaryDto>, SessionsError>;

    /// Returns one owner-produced session snapshot for commands and consumers.
    pub async fn get_session(
        &self,
        session_id: &str,
    ) -> Result<SessionDetailDto, SessionsError>;

    /// Replaces a tool selection with content owned by another capability.
    pub async fn attach_runtime_content(
        &self,
        pane_id: &str,
        content: PaneContentRef,
    ) -> Result<SessionDetailDto, SessionsError>;

    /// Records an output edge so unseen output can be derived from visibility.
    pub async fn record_pane_output(&self, pane_id: &str) -> Result<(), SessionsError>;

    /// Replaces the current process/attention snapshot for one pane.
    pub async fn update_pane_activity(
        &self,
        pane_id: &str,
        activity: PaneActivitySnapshot,
    ) -> Result<(), SessionsError>;

    /// Returns the current display and visibility context for notification policy.
    pub async fn notification_context(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionNotificationContext>, SessionsError>;

    /// Returns current attention sessions with their latest transition sequence.
    pub async fn attention_sessions(
        &self,
    ) -> Result<Vec<SessionAttentionSnapshot>, SessionsError>;

    /// Updates whether the main window is visible without changing selected route.
    pub async fn set_main_window_visible(&self, visible: bool);

    /// Returns counts used by the application-level Quit confirmation.
    pub async fn shutdown_impact(&self) -> Result<ShutdownImpact, SessionsError>;

    /// Returns close impact for every runtime session owned by one project.
    pub async fn project_removal_impact(
        &self,
        project_id: &str,
    ) -> Result<ProjectSessionsImpact, SessionsError>;

    /// Closes every runtime session owned by one project after project removal is confirmed.
    pub async fn close_project_sessions(
        &self,
        project_id: &str,
    ) -> Result<(), SessionsError>;

    /// Stops all pane content and clears every session after Quit is confirmed.
    pub async fn shutdown_all(&self) -> Result<(), SessionsError>;

    /// Reopens session admission after a reset attempt without restoring sessions.
    pub fn resume_after_reset(&self, committed: bool);
}
```

Ràng buộc của port:

- Tauri commands `list_sessions`/`get_session` clone manager handle khỏi `State`, đổi owned input thành borrowed input rồi await `SessionManager::list_sessions`/`SessionManager::get_session`. Search, Home, Project Overview, tray, BE-007 và BE-011 dùng đúng hai owner methods này; không có command-only helper hoặc consumer query đọc map nội bộ. Mỗi method clone DTO hoàn chỉnh dưới một read lock rồi nhả lock trước mọi dependency await.
- `ProjectSessionAccess` và `CliProfileLookup` là consumer-side port hẹp do Sessions sở hữu; adapter trong composition root chỉ gọi public interface của `BE-003`/`BE-006`, không truy cập repository hay state nội bộ của capability đó.
- `ordered_project_ids` quyết định thứ tự nhóm của `list_sessions`; project ID có session nhưng không còn trong kết quả là conflict vòng đời và được map thành `ProjectNotFound`, không tự tạo nhóm mồ côi.
- Giai đoạn 8 inject implementation chỉ quản lý `Empty`/`ToolSelection`. `BE-007` mở rộng implementation cho `Terminal`; capability file mở rộng cho `File`. Sessions không import repository/state nội bộ của các capability đó.
- `close`, `reopen` và `discard` phải idempotent theo handle/content ID. Raw process error, command line, environment và file content được map thành `ContentLifecycleFailed` đã làm sạch.
- `CloseRetention::ReopenLastTab` chỉ dùng khi đóng tab. Đóng pane, xóa session và Quit dùng `Discard`.
- `record_pane_output` chỉ giữ `unseen_output = false` khi session vừa là route đang quan sát vừa có cửa sổ chính hiển thị; ở mọi trường hợp khác nó chuyển cờ từ `false` sang `true`. Hàm không được gọi theo event UI, chỉ theo output edge do content owner báo.
- `update_pane_activity` chỉ phát domain/Tauri event khi aggregate summary thực sự đổi; terminal bytes vẫn đi bằng Channel của `BE-007`.
- `notification_context` tính `is_observed = observed_session_id == Some(session_id) && main_window_visible`. Query trả `Ok(None)` khi session không còn trong runtime, kể cả event BE-011 chạy đua với delete; không trả `SessionNotFound`, không tăng revision và không phát event. Snapshot tại read lock là linearization point nếu route/visibility/delete cạnh tranh.
- `SessionNotificationContext` là type Rust nội bộ giữa capability, không derive `Serialize`, `Deserialize` hoặc `TS` và không xuất vào `src/bindings/sessions/`. Adapter BE-011 map query này vào `NotificationDependencies::session_context` mà không khiến Sessions phụ thuộc Notifications.
- `attention_sessions` clone `SessionSummaryDto` và `attention_sequence` của đúng các session đang có status `NeedsAttention` dưới cùng một read lock. Query không await project/profile/content port, không tăng revision và không phát event; thứ tự trả về không phải contract vì `AppRuntime`/tray sắp xếp theo `attention_sequence` giảm dần rồi `session_id` tăng dần như `BE-001`.
- `SessionAttentionSnapshot` là type Rust nội bộ giữa Sessions và app composition, không derive `Serialize`, `Deserialize` hoặc `TS` và không xuất vào `src/bindings/sessions/`. `AppRuntime::attention_sessions` dùng snapshot này, ghép `project_name` qua public `ProjectService::list_projects(None)` và không tự tái dựng sequence từ `sessions://runtime-changed`.
- Khi mở notification, adapter BE-011 gọi public read-only snapshot `SessionManager::get_session` mà command cùng tên đã dùng, rồi xác nhận đồng thời `project_id`, `session_id`, `tab_id`, `pane_id` và `PaneContentDto::Terminal { terminal_id, .. }`. Snapshot không khớp hoặc session vừa mất được map thành target không còn tồn tại; BE-011 không được đọc state map, giữ lock Sessions hoặc yêu cầu BE-005 tự điều hướng.
- Adapter `ProjectRuntimeGuard` của `BE-003` gọi `project_removal_impact` và map `ProjectSessionsImpact` sang type do Projects sở hữu. Method không gọi ngược project repository/availability, nên không tạo dependency vòng; project không có session trả toàn bộ count bằng `0`. Lỗi inspect đã làm sạch được adapter map thành `RuntimeInspectionFailed`.
- `close_project_sessions` là commit cleanup sau khi dialog Remove Project đã được xác nhận và removal gate của `BE-003` đã chặn session mới. Manager tuần tự các lần close cùng project, đặt project-scoped close guard dưới state lock rồi mới lấy snapshot session ID theo thứ tự tạo; `create_session` kiểm guard này lúc commit và trả `ProjectUnavailable` nếu đã đóng gate nội bộ. Manager không giữ state lock trong lúc await content port, dùng cùng close-session path với `confirmed = true`, bỏ qua ID đã được đóng bởi operation cùng lúc và phát một event `Deleted` cho mỗi session thực sự bị xóa.
- Nếu project-scoped cleanup lỗi giữa chừng, các session đã đóng vẫn bị xóa, session chưa đóng được giữ để retry và method trả lỗi đầu tiên sau khi đã thử toàn bộ snapshot. Lần gọi lại idempotent; adapter Projects map lỗi đã làm sạch thành `RuntimeCleanupFailed`.
- `shutdown_impact` gọi `PaneContentRuntime::close_impact` trên snapshot content hiện hành và cộng checked `unsaved_file_count` cùng process count; không mutate. Đây là cùng snapshot owner mà BE-001 và `DataRuntimeControl::impact` dùng.
- `shutdown_all` đặt cờ `RuntimeShuttingDown` trước khi đóng content để command tạo/mutation mới bị từ chối. Hàm async, không lấy `DataReadPermit`, thử đóng mọi content và chỉ trả thành công/clear state khi không còn tài nguyên sống; vì vậy reset đang giữ `DataWritePermit` có thể gọi nó mà không self-deadlock.
- Với true-Quit, app không gọi `resume_after_reset`. Với Reset, `DataRuntimeControl::resume_after_reset` map `DataResetCompletion::Committed`/`Aborted` thành `committed = true`/`false` rồi gọi method no-fail này sau publish hoặc rollback/apply failure để mở lại admission; flag chỉ phục vụ reconcile runtime, method không lấy permit, không query database và không dựng lại session đã đóng.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `sessions://runtime-changed` | `SessionRuntimeEventDto` | Sau mỗi mutation đã commit và khi aggregate activity summary thực sự đổi. | Event trong một manager có `revision` tăng nghiêm ngặt; không gộp mutation cấu trúc; output chỉ phát ở cạnh `unseen_output false → true`, không phát theo chunk. Payload là state sau mutation. |

Event delivery không phải nguồn dữ liệu duy nhất. Nếu emit thất bại sau khi mutation đã commit, command vẫn trả thành công, backend ghi log không chứa user content và frontend re-query khi window focus/route mount hoặc revision bị nhảy. Không có Channel thuộc `BE-005`; terminal output dùng Channel của `BE-007`.

## Business rule và invariant

1. Một session thuộc đúng một project, chỉ tồn tại trong một lần chạy và xuất hiện theo thứ tự tạo dưới project đó.
2. Session mới có tên `New Session`, không có tab và có status `NoToolYet`; UI vì vậy hiển thị màn hình chọn công cụ ngay sau create.
3. Mỗi tab luôn có từ `1` đến `4` pane. Cây layout là cây nhị phân đầy đủ: mỗi leaf chứa đúng một pane ID; pane/split ID không lặp trong tab.
4. `active_tab_id` là `None` khi session chưa có tab; nếu có tab thì phải trỏ tới một tab trong session. `active_pane_id` và `maximized_pane_id` phải trỏ tới leaf trong tab tương ứng.
5. Split pane thứ năm bị từ chối bằng `PaneLimitReached`; cả toolbar lẫn phím tắt dùng cùng command nên không có đường vòng qua UI.
6. Đóng pane trong layout nhiều pane xóa leaf và node split cha rồi đưa sibling lên thay. Pane gần nhất trong sibling subtree trở thành active nếu pane đóng đang active; maximize bị clear nếu trỏ tới pane đóng.
7. Đóng pane duy nhất không xóa tab: content bị đóng/discard và leaf được giữ dưới dạng `Empty` để màn hình chọn nội dung xuất hiện. Quyết định này tránh biến thao tác `Close Pane` thành `Close Tab` ngầm.
8. Đóng active tab chọn tab bên phải ở index cũ nếu có, nếu không chọn tab bên trái; đóng tab cuối đưa session về trạng thái không tab.
9. `move_tab` không đổi active tab; reopen chèn tab tại index cũ được clamp và làm tab đó active.
10. Chỉ tab đóng gần nhất reopenable. Snapshot cũ bị discard trước khi snapshot mới trở thành current; không thể reopen tab sau khi xóa session hoặc Quit.
11. Đóng tab có process đang chạy phải dừng process. Reopen chỉ khôi phục terminal ở trạng thái đã kết thúc và buffer runtime còn giữ, không tự chạy lại lệnh.
12. Xóa session luôn trả `ConfirmationRequired` nếu `confirmed = false`. Với tab/pane, điều này chỉ xảy ra khi impact mới nhất có `running_process_count > 0` hoặc `unsaved_file_count > 0`.
13. Backend tính lại impact sau khi người dùng bấm xác nhận. Confirmation áp dụng cho toàn target tại thời điểm commit, kể cả blocker xuất hiện sau lần preview.
14. Nếu một content close thất bại, manager thử đóng các content còn lại, không xóa cấu trúc target, bỏ cờ closing và trả `ContentLifecycleFailed`. Những content đã đóng vẫn ở trạng thái thực tế mới; lần retry phải an toàn.
15. Status session là đúng một giá trị theo ưu tiên: `NeedsAttention` > `ExitedWithError` > `UnseenOutput` > `Running` > `Finished` > `NoToolYet`. `ToolSelection` không process được xem là `NoToolYet` cho tới khi content owner attach runtime.
16. `set_observed_session` chỉ clear unseen output khi main window đang hiển thị. Ẩn xuống tray, chuyển project/tab khác hoặc quan sát session khác không dừng content; nền chọn trên sidebar là navigation state của frontend.
17. Session/tab name sau trim dài tối đa `80` Unicode scalar value, không có control character; tên trùng được phép vì ID mới là định danh.
18. Event chỉ được phát sau khi state hợp lệ đã commit. Revision serialize dạng chuỗi thập phân và không được reset trước khi process kết thúc.
19. `notification_context` trả existence, project/name và observed flag từ một snapshot: chỉ session đúng `observed_session_id` khi `main_window_visible = true` mới observed; tab/pane active, maximize hoặc viewport không thay đổi kết quả này.
20. Search, Home và Project Overview chỉ dùng owner methods `SessionManager::list_sessions`, `SessionManager::get_session` hoặc domain event public; tray dùng thêm `attention_sessions`, còn Notifications dùng thêm `notification_context` và exact `get_session` snapshot. Không consumer nào đọc map/lock nội bộ hoặc dựng attention order từ event delivery best-effort.
21. `attention_sequence` nhận revision của đúng lần gần nhất session chuyển từ status khác sang `NeedsAttention`; sequence không đổi khi activity khác cập nhật nhưng status vẫn `NeedsAttention`, bị xóa khi session rời trạng thái đó và được cấp lại nếu session chuyển vào `NeedsAttention` lần nữa.
22. Không session ID, tên, layout, snapshot, terminal buffer hoặc process state nào được đưa vào SQLite, backup hay restore.
23. Project removal impact aggregate mọi session thuộc đúng `project_id` và tính lại blocker hiện tại qua content lifecycle port; session count gồm cả session không có process.
24. Project-scoped close chỉ được adapter `BE-003` gọi sau xác nhận. Guard nội bộ phải được đặt trước snapshot và giữ đến khi method kết thúc để create đã pass availability trước removal gate cũng không thể commit chen vào; method đóng mỗi session theo invariant close hiện có, không tự xóa project metadata và không biến failure một session thành rollback giả cho session đã đóng.
25. `create_session` là runtime mutation duy nhất bắt buộc giữ `DataReadPermit`: lấy permit trước project/session mutation guard và giữ qua state commit cùng event publish. Reset giữ write permit nên không session mới chen vào giữa impact, quiesce và transaction; các command session không tạo mới không lấy maintenance permit.
26. Lock order của create là `DataMaintenanceGate` → project/session mutation guard → Sessions state lock; không re-enter gate. `shutdown_impact`, `shutdown_all` và `resume_after_reset` là gate-free vì reset gọi chúng trong khi đang giữ `DataWritePermit`; không giữ state/content lock qua `.await`.
27. Mọi Tauri command Sessions authorize exact invoking window `main` từ `WebviewWindow` trước validation, owner-port query hoặc state lock. Window `quick-note` không được đọc session snapshot hay dispatch runtime action; backend consumers tiếp tục dùng public `SessionManager` methods trực tiếp qua composition adapter.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum SessionsError {
    UnauthorizedWindow,
    ProjectNotFound { project_id: String },
    ProjectUnavailable { project_id: String },
    ProjectLookupFailed,
    ProfileNotFound { profile_id: String },
    ProfileUnavailable { profile_id: String },
    ProfileLookupFailed,
    SessionNotFound { session_id: String },
    TabNotFound { tab_id: String },
    PaneNotFound { pane_id: String },
    SplitNotFound { split_id: String },
    InvalidName,
    InvalidMove,
    InvalidSplitRatio,
    PaneLimitReached,
    SessionNotEmpty,
    PaneNotEmpty,
    NoClosedTab { session_id: String },
    ConfirmationRequired { impact: CloseImpactDto },
    CloseInProgress { session_id: String },
    ContentLifecycleFailed { operation: String, target_id: String },
    RuntimeShuttingDown,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Bất kỳ Sessions command nào được invoke từ caller khác exact `main`. | Không retry; sửa caller boundary, không đọc hoặc đổi runtime. |
| `ProjectNotFound` | Project ID không tồn tại. | Refresh project/session list và điều hướng về Projects. |
| `ProjectUnavailable` | Tạo session khi folder project không khả dụng. | Hiển thị `Unavailable` và hành động locate folder. |
| `ProjectLookupFailed` | Public query Projects thất bại do lỗi nội bộ đã làm sạch. | Hiển thị lỗi tải dữ liệu và cho retry. |
| `ProfileNotFound` | Profile đã bị xóa giữa lúc render và chọn. | Refresh tool picker. |
| `ProfileUnavailable` | Command của profile không khả dụng. | Giữ card disabled, hiển thị `Command not found`, `Check again` và link CLI Profiles. |
| `ProfileLookupFailed` | Public query CLI Profiles thất bại do lỗi nội bộ đã làm sạch. | Giữ picker, hiển thị lỗi tải và cho retry. |
| `SessionNotFound` | ID không thuộc runtime hiện tại hoặc session vừa bị xóa. | Đóng view stale và refresh. |
| `TabNotFound`, `PaneNotFound`, `SplitNotFound` | Target không còn thuộc parent đã truyền. | Refresh `get_session`; không retry mutation mù. |
| `InvalidName` | Tên rỗng, quá dài hoặc có control character. | Giữ editor mở và thông báo quy tắc tên. |
| `InvalidMove` | Tab đích trùng tab nguồn hoặc khác session. | Hủy optimistic reorder và refresh. |
| `InvalidSplitRatio` | Ratio ngoài `1000..=9000`. | Khôi phục tỉ lệ backend gần nhất. |
| `PaneLimitReached` | Tab đã có bốn pane. | Disable cả hai split action và thông báo giới hạn khi gọi bằng shortcut. |
| `SessionNotEmpty` | Chọn tool từ màn hình session rỗng nhưng session đã có tab. | Dùng picker của pane/tab hiện tại thay vì tạo tab đầu tiên lần nữa. |
| `PaneNotEmpty` | Gắn tool vào pane đã có content. | Refresh layout; không ghi đè content. |
| `NoClosedTab` | Không còn snapshot reopenable. | Disable/hide `Reopen Closed Tab`. |
| `ConfirmationRequired` | Target phá hủy cần xác nhận ở impact hiện tại. | Dựng dialog từ payload và gọi lại với `confirmed = true`. |
| `CloseInProgress` | Mutation khác nhắm vào session đang đóng/restore. | Disable thao tác và chờ event/query mới. |
| `ContentLifecycleFailed` | Inspect, close, reopen hoặc discard của content owner thất bại. | Nêu đối tượng không đóng được, giữ view và cho retry; không hiển thị raw OS error. |
| `RuntimeShuttingDown` | Command mutation tới sau khi Quit bắt đầu. | Không retry; tiếp tục luồng Quit. |

## Luồng chính

### Tạo session và chọn tool

1. `create_session` lấy `DataReadPermit` rồi hỏi `BE-003` qua public project port; project phải tồn tại và khả dụng, và mọi Storage read trong adapter vì vậy tuân đúng gate order.
2. Manager append session rỗng, commit revision, emit `Created` rồi mới nhả permit; frontend mở session và thấy tool picker.
3. Frontend lấy tool từ `BE-006`; tool `Unavailable` vẫn hiển thị nhưng không gọi select hoặc nhận `ProfileUnavailable` nếu trạng thái vừa thay đổi.
4. `select_session_tool` kiểm tra profile lại, tạo tab/pane `ToolSelection`, commit và emit `Updated`.
5. Ở giai đoạn 9, `BE-007` dùng `attach_runtime_content` để đổi pane sang `Terminal`; việc spawn/stream nằm hoàn toàn trong `BE-007`.

### Split, resize và maximize

1. Frontend gọi `split_pane`; manager kiểm invariant bốn pane, thay leaf bằng split `5000/5000`, active pane mới và emit snapshot.
2. Frontend hiển thị picker trên pane `Empty`; chọn tool gọi `select_pane_tool`.
3. Trong lúc kéo gutter, frontend render ratio cục bộ; lúc pointer/keyboard resize kết thúc mới gọi `set_split_ratio`.
4. Maximize chỉ đặt `maximized_pane_id`; cây và content các pane khác không đổi. Restore đặt `None`.

### Đóng/xóa có xác nhận

1. Frontend gọi `get_close_impact` để dựng facts box bằng số process và file chưa lưu hiện tại.
2. Nếu người dùng hủy, không command mutation nào được gọi.
3. Khi xác nhận, frontend gọi `close_runtime_target(..., true)`; manager kiểm target, khóa operation của session rồi tính impact lại.
4. Content lifecycle port dừng/discard hoặc giữ reopen handle theo loại target. Không giữ state write lock trong lúc await.
5. Nếu mọi content đóng thành công, manager mutate/collapse/remove cấu trúc, commit một revision rồi emit `Updated`/`Deleted`.
6. Nếu có lỗi, manager giữ target để retry, bỏ operation lock, phản ánh activity thực tế của content đã đóng và trả lỗi typed.

### Mở lại tab vừa đóng

1. Manager evict/discard snapshot cũ trước khi lưu tab vừa đóng mới; snapshot gồm layout, vị trí, active/maximized state và reopen handle từng pane.
2. `reopen_last_closed_tab` lấy độc quyền snapshot, gọi content port restore tất cả handle và không restart process.
3. Nếu restore toàn bộ thành công, manager chèn tab, clear slot, commit revision và emit `Updated`.
4. Nếu restore thất bại, các handle đã restore được đóng lại idempotently, snapshot vẫn khả dụng để retry nếu content port xác nhận chưa bị discard.

### Quit XWork và Reset quiesce

1. `BE-001` hoặc BE-012 reset adapter gọi `shutdown_impact` để lấy số session, running process và unsaved file cho dialog tương ứng.
2. Sau xác nhận, caller await `shutdown_all`; manager chặn mutation mới, discard snapshot và đóng mọi content mà không lấy maintenance permit.
3. Chỉ khi toàn bộ close thành công manager clear session map/order/observed state. True-Quit tiếp tục thoát và không resume manager.
4. Reset giữ `DataWritePermit` xuyên cleanup/transaction/publish; sau commit hoặc rollback, `DataRuntimeControl::resume_after_reset` gọi `SessionManager::resume_after_reset(true|false)` tương ứng để mở admission nhưng không khôi phục session đã đóng.
5. Lần khởi động kế tiếp luôn tạo manager rỗng; không đọc session từ database hay backup.

### Gỡ project qua BE-003

1. Adapter `ProjectRuntimeGuard::removal_impact` gọi `project_removal_impact`; manager snapshot các session của project và aggregate process/file blocker mà không mutate.
2. Sau khi người dùng xác nhận, `BE-003` đặt removal gate rồi adapter gọi `close_project_sessions`; manager đặt project-scoped close guard trước khi snapshot lại ID để bao gồm mọi session đã commit và chặn create đang bay chen vào.
3. Manager đóng từng session theo thứ tự tạo bằng close path đã xác nhận, thử toàn bộ snapshot và emit `Deleted` cho từng commit thành công.
4. Thành công chỉ khi query lại không còn session thuộc project. Lỗi giữ các session chưa đóng để `BE-003` không delete metadata và có thể retry; project row do Projects sở hữu.

## Ràng buộc kỹ thuật

- Blocking: `BE-005` không tự thực hiện blocking I/O. Content port phải chuyển process wait/kill hoặc file cleanup blocking sang worker phù hợp; manager không giữ Tokio lock trong khi await port.
- Bảo mật: frontend không được truyền path, command string, environment hay process handle qua Sessions command. Không log session/tab name, file label, terminal output, command arguments, environment hoặc reopen buffer. Error public chỉ chứa ID opaque và operation ổn định.
- Hiệu năng: split/reorder/rename là mutation bộ nhớ tuyến tính theo số tab/pane của một session; mỗi tab tối đa bốn pane. Event activity chỉ phát khi summary đổi, không theo terminal byte/chunk. `list_sessions` không clone terminal/file buffer; `notification_context` chỉ lookup một session và clone ba field nhỏ.
- Concurrency: command cùng session tuần tự; session khác có thể mutate độc lập. Close/reopen dùng operation flag để từ chối mutation cạnh tranh và content operation phải idempotent. Project-scoped close tuần tự theo project, giữ một cờ state chứ không giữ state lock qua `.await`; `create_session` lấy shared read permit trước guard và kiểm cờ này trong cùng critical section với insert. Reset runtime API không lấy lại gate. `notification_context` chỉ giữ read lock trong lúc lookup/clone và lấy chính snapshot đó làm linearization point cho policy BE-011.
- Desktop boundary: custom commands chỉ đăng ký trong `app::configure`; không cấp shell/filesystem/plugin permission cho main window vì chức năng này.
- Generated contract: test binding phải fail nếu output lệch DTO Rust; không sửa `src/bindings/sessions/` bằng tay.

## Tiêu chí hoàn thành

- [ ] Session tạo cho project khả dụng xuất hiện ngay với `New Session`, không tab, `NoToolYet`; project không tồn tại/không khả dụng trả đúng error.
- [ ] Rename session/tab áp dụng đầy đủ quy tắc Unicode, cho phép tên trùng và không mutate khi invalid.
- [ ] Tạo, active và reorder tab giữ đúng thứ tự/invariant; tab mới có một pane `Empty`.
- [ ] Split right/down tạo đúng cây, pane thứ năm luôn bị chặn, resize chỉ nhận `1000..=9000`, maximize không làm dừng pane khác.
- [ ] Chọn profile kiểm lại `BE-006`, phân biệt not found/unavailable và không spawn process trong `BE-005`.
- [ ] Status aggregate đúng toàn bộ thứ tự ưu tiên; output của session đang quan sát không thành unread, output khi ẩn/tray hoặc ở session khác thì có.
- [ ] Dialog impact nhận đúng process/file labels; xóa session luôn cần xác nhận, tab/pane chỉ cần khi có blocker; impact được tính lại khi commit.
- [ ] Close pane collapse cây đúng; close pane cuối giữ một leaf `Empty`; close active tab chọn sibling đúng quy tắc.
- [ ] Close tab dừng process, chỉ giữ một snapshot, reopen không restart process; snapshot mất hoàn toàn sau session delete/Quit.
- [ ] Close failure không làm mất target và retry idempotent; mutation cạnh tranh nhận `CloseInProgress`.
- [ ] `sessions://runtime-changed` có revision tăng nghiêm ngặt, snapshot sau mutation, không phát theo output chunk; query resync cho kết quả nhất quán.
- [ ] `SessionManager::list_sessions`/`get_session` là owner snapshots dùng chung cho commands/consumers và clone nhất quán dưới read lock; `notification_context` trả đúng project/name và `is_observed` cho mọi tổ hợp route + main-window visibility, trả `None` sau delete/Quit, đồng thời không mutate revision/event; adapter BE-011 kiểm exact live tab/pane/terminal qua public `get_session` snapshot.
- [ ] `attention_sessions` trả cùng snapshot summary + sequence cho đúng các session `NeedsAttention`; sequence nhận revision khi chuyển vào, giữ nguyên khi vẫn attention, bị xóa khi rời trạng thái và tăng khi vào lại; query không mutate và `SessionAttentionSnapshot` không đi vào binding TypeScript.
- [ ] `shutdown_impact` trả đúng session/process/unsaved counts cho BE-001/BE-012; async `shutdown_all` gate-free chặn mutation mới và clear toàn state chỉ sau cleanup thành công, còn `resume_after_reset` no-fail mở admission mà không restore session.
- [ ] `create_session` giữ `DataReadPermit` từ trước mutation guard qua state commit/event publish; reset giữ write permit chặn create và runtime quiesce không re-enter gate.
- [ ] `project_removal_impact` aggregate đúng session/process/unsaved counts; `close_project_sessions` đóng đúng project, chặn create chen vào snapshot, không chạm project khác, thử hết snapshot, emit từng deletion và retry idempotent sau partial failure.
- [ ] Mọi Sessions command nhận invoking `WebviewWindow` và chỉ exact `main` thành công; `quick-note`/label khác nhận `UnauthorizedWindow` trước project/profile/content port hoặc state access, trong khi public Rust consumer methods không bị áp IPC authorization.
- [ ] Binding TypeScript được sinh từ Rust và test xác nhận không có drift hay DTO viết tay.
- [ ] `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và `cargo test --all-targets --all-features` pass trên Windows.
- [ ] Frontend formatter, lint, type-check, unit/component test và build liên quan pass sau khi nối generated binding; smoke thủ công Windows xác nhận resize, maximize và reopen ở desktop runtime.
- [ ] `pnpm tauri build` pass vì thay đổi managed state, invoke handler, public IPC và desktop integration.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/sessions/models.rs` (`#[cfg(test)]`) | Unit | Validate name; status precedence; split/collapse tree; giới hạn bốn pane; active/maximize invariant; ratio; stable tab move. |
| `src-tauri/src/sessions/manager.rs` (`#[cfg(test)]`) | Unit | Exact-label command authorization tách khỏi owner methods; project/profile port fake; shared list/get owner snapshots; create/read-permit ordering; event revision; visibility/unread; attention transition sequence và read-only snapshot; notification context route/visible matrix, missing-after-delete và read-vs-delete linearization; exact target snapshot; close impact gồm unsaved file; partial close failure; project-scoped impact/cleanup/create-close race/retry; single reopen snapshot; async shutdown/reset resume gate. |
| `src-tauri/tests/sessions_runtime.rs` | Integration | Toàn bộ command thành công từ exact `main`; `quick-note`/label khác nhận `UnauthorizedWindow` trước mọi port/state side effect; command list/get bằng đúng owner snapshot; public Rust `attention_sessions` cho `AppRuntime`/tray và `notification_context` + `get_session` cho BE-011 không có command mới; typed error serialization; event payload/order; adapter removal đúng và no persistence sau manager restart. |
| `src-tauri/tests/data_management_contract.rs` | Integration | Write permit chặn create session, impact gồm unsaved file và reset await gate-free shutdown rồi resume admission không restore session. |
| `src-tauri/tests/app_builder.rs` | Integration | Composition root đăng ký state/command và build được bằng Tauri mock runtime. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export tất cả DTO/error Sessions gồm `UnauthorizedWindow` và fail khi generated TypeScript khác Rust source; xác nhận `SessionNotificationContext` và `SessionAttentionSnapshot` không đi vào binding. |

Test manager dùng revision/ID allocator và content port xác định được, không sleep và không tạo process thật. Test process/PTY thật, terminal buffer, input/resize và bốn terminal đồng thời thuộc `BE-007`.

## Câu hỏi mở

Không có.
