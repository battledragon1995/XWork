# BE-001 — App lifecycle và system tray

Tài liệu này đặc tả contract backend cho khởi động một instance, vòng đời cửa sổ chính, system tray và luồng Quit có xác nhận. Backend sở hữu mọi thao tác cửa sổ/hệ điều hành; frontend chỉ gọi command hẹp và phản hồi các event được định nghĩa tại đây.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-001` |
| Phase | `1` |
| Capability | `src-tauri/src/app/`, `src-tauri/src/platform/` |
| Yêu cầu chức năng | `§5`, `§16`; áp dụng yêu cầu tương tác chung tại `§18` |
| Frontend liên quan | `FE-001`, `FE-006`; `FE-020` khi `BE-017` được triển khai |
| Phụ thuộc | `BE-002` |

## Mục tiêu

XWork chỉ chạy một instance, đóng cửa sổ chính thì ẩn xuống tray, và có thể đưa cửa sổ hiện có ra trước từ lần mở thứ hai, tray hoặc một session cần chú ý. `Quit XWork` lấy snapshot runtime, yêu cầu xác nhận khi còn session, dọn runtime theo thứ tự rồi mới kết thúc process mà không khôi phục session ở lần chạy sau.

### Quyết định và giả định đã chốt

- Fresh launch mở route `Home`; lần gọi executable thứ hai chỉ đưa instance hiện có ra trước và giữ nguyên route/session hiện tại. Cách này phân biệt “các lần mở sau” tại §5.2 với việc cố khởi chạy thêm một instance.
- Đóng cửa sổ `main` luôn ẩn xuống tray theo §5.3. `BE-008` không được đổi mặc định này nếu chưa có yêu cầu sản phẩm mới rõ hơn cho “hành vi cửa sổ và system tray” tại §17.1.
- Nhóm tray `Needs attention` chứa tối đa `5` session, đủ là “danh sách ngắn” tại §16 mà không làm menu native quá dài. Thứ tự là thời điểm chuyển sang trạng thái cần chú ý mới nhất trước, rồi `session_id` tăng dần để kết quả ổn định.
- Phase 1 không hiển thị mục `Quick Note` chưa hoạt động. `BE-017` mở rộng menu bằng mục này đúng vị trí đã định nghĩa và chỉ bật nó sau khi cửa sổ/handler Quick Note sẵn sàng; không dùng menu item chết hoặc mock.
- Khi BE-017 và phần global shortcut của BE-009 cùng sẵn sàng, mục `Quick Note` hiển thị accelerator hiện hành, mặc định `Ctrl+Shift+N` trên Windows như wireframe; đổi shortcut phải refresh accelerator mà không đổi menu ID.
- Hộp thoại Quit xuất hiện khi `session_count > 0`, đúng §5.4. Snapshot vẫn chứa `project_count`, `running_process_count` và `unsaved_file_count` để FE-001 dựng đủ các dòng trong wireframe; các giá trị chưa có provider ở lát cắt hiện tại bằng `0`.
- Không có setting `ask before quit`: điều kiện xác nhận cố định theo session runtime và không được BE-008 bật/tắt. Launch-at-login cũng ngoài phạm vi bản đầu tiên vì không có trong yêu cầu chức năng.
- Nếu dọn runtime thất bại, XWork không gọi `exit`; dialog giữ nguyên để frontend hiển thị lỗi và cho thử lại. Quyết định fail-closed này tránh để lại child process không được kiểm soát.
- `Open XWork` và chọn session trong tray không thay đổi trạng thái runtime. Chọn session đưa window ra trước, phát navigation event, còn FE-006 chịu trách nhiệm focus pane/terminal sau khi điều hướng hoàn tất.
- Tray dùng menu native của Tauri. Vì API menu native không bảo đảm tô đỏ item trên mọi hệ điều hành, phần màu đỏ của `Quit XWork` trong wireframe không phải contract backend; mức nguy hiểm được thể hiện bằng nhãn cụ thể, separator và vị trí cuối menu theo §18.

### Ngoài phạm vi

- Bố cục sidebar, top bar, dialog và routing React thuộc `FE-001`/`FE-006`.
- Vòng đời session/tab/pane và dữ liệu trạng thái cần chú ý thuộc `BE-005`; PTY/process cleanup thuộc `BE-007`.
- Nội dung, validation, persistence và cửa sổ Quick Note thuộc `BE-016`/`BE-017`; các trạng thái Home `saved`/`invalid` của FE-020 không do BE-001 xử lý.
- Settings về khởi động cùng hệ điều hành, notification, updater, installer và code signing.
- Khôi phục session, tab, pane, terminal buffer hoặc process sau khi process XWork kết thúc.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Bật feature tray của Tauri và khai báo official single-instance plugin, Serde cùng `ts-rs`. |
| `src-tauri/Cargo.lock` | Khóa các dependency Rust của lifecycle và tray. |
| `src-tauri/src/lib.rs` | Công khai module `platform`, giữ `app::configure` là composition root duy nhất và chuyển run event cần thiết cho lifecycle. |
| `src-tauri/src/app/mod.rs` | Ghép single-instance plugin trước các plugin khác, storage setup của BE-002, managed lifecycle state, tray, window event và invoke handler. |
| `src-tauri/src/app/lifecycle.rs` | DTO, error public, exact-window authorization, state machine Quit, command cửa sổ/Quit và adapter runtime theo từng lát cắt. |
| `src-tauri/src/app/tray.rs` | ID/menu model, tạo tray icon, cập nhật session cần chú ý và xử lý click menu. |
| `src-tauri/src/platform/mod.rs` | Export adapter window dùng chung cho desktop integration. |
| `src-tauri/src/platform/window.rs` | Tìm, hiện, bỏ minimize, focus, hide/minimize và toggle maximize cửa sổ `main`. |
| `src-tauri/tauri.conf.json` | Giữ application identifier `com.xwork.app`, window label `main` và title `XWork` làm identity/window contract của lifecycle. |
| `src-tauri/capabilities/main.json` | Giữ permission list tối thiểu; xác nhận BE-001 không cấp OS API trực tiếp cho frontend. |
| `src-tauri/icons/icon.ico` | Icon hiện có được tái sử dụng cho system tray trên Windows; không tạo asset khác trong feature này. |
| `src-tauri/tests/app_builder.rs` | Xác nhận composition root với mock runtime vẫn build khi đăng ký state, command, plugin và setup. |
| `src-tauri/tests/app_lifecycle.rs` | Integration test command/state transition và event qua public backend boundary với runtime/window test double. |
| `src-tauri/tests/export_bindings.rs` | Sinh và kiểm tra binding TypeScript từ DTO/error public của BE-001. |
| `src/bindings/app-lifecycle.ts` | Output sinh tự động cho contract lifecycle; không chỉnh tay. |

`src-tauri/tauri.conf.json` tiếp tục dùng application identifier `com.xwork.app`, window label `main` và title `XWork` hiện có. `src-tauri/capabilities/main.json` không cấp thêm core/plugin permission vì toàn bộ OS integration của BE-001 chạy trong Rust.

## Dữ liệu

BE-001 không tạo bảng hoặc migration. Pending quit request, trạng thái `quitting`, tray menu model và session attention đều là runtime state, bị loại bỏ khi process kết thúc. Dữ liệu bền vững tiếp tục đi qua `Storage` của BE-002 nhưng BE-001 không ghi bản ghi nào.

## DTO public

```rust
#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QuitSummaryDto {
    pub session_count: u32,
    pub project_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QuitRequestDto {
    pub request_id: u32,
    pub summary: QuitSummaryDto,
}

#[derive(Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SessionNavigationDto {
    pub session_id: String,
}
```

- Tất cả count là tổng tại thời điểm tạo request, không âm và dùng `0` khi không có đối tượng tương ứng.
- `project_count` chỉ đếm project khác nhau đang sở hữu các session runtime; không đếm toàn bộ project đã lưu.
- `running_process_count` chỉ đếm child process còn sống; một session có thể chứa nhiều process.
- `unsaved_file_count` đếm file Markdown đang mở có thay đổi chưa lưu khi BE-015 đã nối provider; source chỉ đọc và Quick Note draft không được tính.
- `request_id` là số tăng đơn điệu trong một process, dùng để loại bỏ phản hồi từ dialog cũ; khi chạm `u32::MAX`, allocator quay về `1` và bỏ qua ID đang pending. ID không bền vững qua lần chạy.
- `session_id` là ID opaque do BE-005 cấp; frontend không phân tích hoặc tự tạo ID này.

Binding generator phải sinh đúng một output `src/bindings/app-lifecycle.ts`; test thất bại nếu output trên đĩa khác kết quả sinh từ Rust.

## Tauri command

### `hide_main_window`

Ẩn cửa sổ chính xuống tray từ nút Close tùy biến của FE-001.

```rust
#[tauri::command]
fn hide_main_window(
    window: WebviewWindow,
) -> Result<(), AppLifecycleError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Invoking window phải có label `main`; không nhận label từ frontend. |
| Side effect | Hide `main`; session/process và pending quit request tiếp tục tồn tại. Khi mở lại, dialog pending vẫn là dialog hiện hành. |
| Lỗi trả về | `InvalidWindow`, `WindowOperationFailed`. |

### `minimize_main_window`

Minimize cửa sổ chính nhưng không hide hoặc thay đổi runtime.

```rust
#[tauri::command]
fn minimize_main_window(window: WebviewWindow) -> Result<(), AppLifecycleError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Invoking window phải có label `main`. |
| Side effect | Gọi minimize đúng một lần. |
| Lỗi trả về | `InvalidWindow`, `WindowOperationFailed`. |

### `toggle_main_window_maximized`

Chuyển cửa sổ chính giữa trạng thái maximized và restored.

```rust
#[tauri::command]
fn toggle_main_window_maximized(window: WebviewWindow) -> Result<bool, AppLifecycleError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Invoking window phải có label `main`. |
| Side effect | Đọc trạng thái hiện tại rồi maximize/unmaximize; trả về trạng thái maximized sau thao tác. |
| Lỗi trả về | `InvalidWindow`, `WindowOperationFailed`. |

### `request_quit`

Bắt đầu một yêu cầu Quit từ FE-001 và trả snapshot nếu cần dialog xác nhận.

```rust
#[tauri::command]
async fn request_quit(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppLifecycleState>,
) -> Result<Option<QuitRequestDto>, AppLifecycleError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Invoking window phải có exact label `main`; không nhận label từ frontend. Snapshot phải thỏa các invariant count. Nếu đã có request pending, trả lại cùng request thay vì tạo ID mới. |
| Side effect | Await `AppRuntime::quit_summary`; nếu có session, lưu request pending và trả `Some`; nếu không có session, chuyển thẳng sang async shutdown/exit và không mở dialog. |
| Lỗi trả về | `UnauthorizedWindow`, `RuntimeSnapshotFailed`, `RuntimeShutdownFailed`, `QuitAlreadyInProgress`. |

### `cancel_quit`

Hủy dialog Quit hiện tại mà không thay đổi session/process.

```rust
#[tauri::command]
fn cancel_quit(
    window: WebviewWindow,
    request_id: u32,
    state: State<'_, AppLifecycleState>,
) -> Result<(), AppLifecycleError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Invoking window phải có exact label `main`; sau đó `request_id` phải khác `0` và khớp request pending. |
| Side effect | Xóa request pending; không phát event vì chính frontend khởi tạo hành động Cancel. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRequestId`, `StaleQuitRequest`, `QuitAlreadyInProgress`. |

### `confirm_quit`

Dọn runtime của request đã xác nhận rồi kết thúc XWork.

```rust
#[tauri::command]
async fn confirm_quit(
    window: WebviewWindow,
    request_id: u32,
    app: AppHandle,
    state: State<'_, AppLifecycleState>,
) -> Result<(), AppLifecycleError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Invoking window phải có exact label `main`; sau đó `request_id` phải khác `0`, khớp request pending và state chưa ở `ShuttingDown`. |
| Side effect | Atomically chuyển sang `ShuttingDown`, nhả lifecycle lock, await toàn bộ runtime shutdown, xóa pending state và gọi `app.exit(0)` chỉ sau khi cleanup thành công. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRequestId`, `StaleQuitRequest`, `QuitAlreadyInProgress`, `RuntimeShutdownFailed`. |

Command phải được đăng ký đúng một lần trong `app::configure`. Error được serialize theo tagged shape `{ code, operation? }`; không gửi source OS/runtime thô sang frontend.

## Contract Rust nội bộ

```rust
pub(crate) type AppRuntimeFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub(crate) trait AppRuntime: Send + Sync {
    fn quit_summary<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>>;

    fn attention_sessions<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>>;

    fn shutdown_for_quit<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>>;
}

pub(crate) struct AttentionSession {
    pub session_id: String,
    pub project_name: String,
    pub session_name: String,
    pub status_label: Option<String>,
    pub attention_sequence: u64,
}
```

- BE-001 dùng implementation rỗng trả count/list `0` và cleanup thành công ở lát cắt Phase 1 hiện tại. Đây là adapter staging trong `app`, không phải mock IPC.
- Khi BE-005/BE-007/BE-011/BE-015 được triển khai, composition root thay adapter rỗng bằng adapter await public query/cleanup của các capability đó; capability không import `app` và public command/event ở tài liệu này không đổi.
- `quit_summary` await `SessionManager::shutdown_impact` cùng các owner snapshot cần để tính project/file count; `attention_sessions` await `SessionManager::list_sessions(None)` và `ProjectService::list_projects(None)` để ghép nhãn. Command và tray adapter dùng cùng public contract, không đọc state nội bộ.
- `shutdown_for_quit` đặt shutdown intake gate của BE-011 trước, await `SessionManager::shutdown_all` để BE-007/BE-015 dừng/force-terminate và giải phóng PTY/channel/watcher, rồi await `NotificationService::shutdown_runtime_sources`. Chỉ sau đó composition root mới đóng Storage và cho exit; dữ liệu bền vững không bị xóa.
- `AppRuntimeFuture` làm adapter object-safe mà không thêm `async-trait`. Không đường gọi nào dùng `block_on`, và không bọc future của BE-005/BE-011 trong `spawn_blocking`.
- Tray controller nhận snapshot mới từ adapter khi tập session cần chú ý thay đổi; output terminal thông thường không làm rebuild menu.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `app-quit-requested` | `QuitRequestDto` | Người dùng chọn `Quit XWork` từ tray và snapshot có ít nhất một session. | Chỉ emit đến `main` sau khi window đã được show; một menu activation phát tối đa một event. Nếu request đang pending, có thể phát lại cùng `request_id` để đưa dialog hiện có ra trước; frontend deduplicate theo ID. |
| `app-navigate-session` | `SessionNavigationDto` | Người dùng chọn một session còn hợp lệ trong nhóm tray `Needs attention`. | Show/unminimize main trước, best-effort focus native window, rồi emit đúng một lần đến `main`; không gộp dồn. FE-006 focus pane sau navigation. |

BE-001 không dùng Channel. Lỗi emit từ tray được log bằng event name/error category; không log session name hay payload đầy đủ.

## Business rule và invariant

1. Official single-instance plugin được đăng ký đầu tiên. Instance thứ hai không mở storage/window/tray riêng; callback của instance đang chạy chỉ show, unminimize và focus `main`, đồng thời bỏ qua argv/cwd.
2. `Storage::open` và migration của BE-002 hoàn tất trước khi lifecycle state/tray được công bố cho capability khác; lỗi storage làm startup dừng.
3. Chỉ `CloseRequested` của window label `main` bị `prevent_close` và chuyển thành hide. Window Quick Note tương lai có lifecycle riêng và không bị handler này giữ sống.
4. Close/hide, minimize, chuyển session và mất focus không dừng terminal, CLI, reminder hoặc Quick Note.
5. Chỉ đường `confirm_quit` hợp lệ hoặc tray Quit khi `session_count == 0` được đặt cờ `ShuttingDown` và gọi `app.exit(0)`.
6. Khi còn ít nhất một session, mọi điểm vào Quit phải dùng cùng state machine và cùng `QuitSummaryDto`; không điểm vào nào được bỏ qua dialog.
7. Confirm luôn cleanup snapshot runtime hiện tại, không chỉ các object có trong snapshot lúc mở dialog. Session/process tạo hoặc kết thúc sau snapshot vẫn được xử lý theo trạng thái thực tế khi confirm.
8. Cancel xóa request pending; đóng dialog hoặc đóng main window chỉ hide và giữ request pending. Không trường hợp nào trong ba hành động này dọn runtime.
9. Tray menu cuối cùng có thứ tự: `Open XWork`, `Quick Note` khi BE-017 sẵn sàng, separator, nhãn `Needs attention` cùng tối đa năm session khi danh sách không rỗng, separator, `Quit XWork`. Khi không có session attention, cả nhãn và separator của nhóm bị bỏ.
10. `Quit XWork` là item nguy hiểm duy nhất về ngữ nghĩa và luôn ở cuối sau separator; màu item theo khả năng render của menu native. Menu ID là hằng nội bộ hoặc ID session opaque, không suy ra hành động từ label hiển thị.
11. Label session tray chuẩn hóa newline/tab thành space, collapse whitespace và cắt ở `80` Unicode scalar; ID và routing payload không bị cắt. Không log argv của second instance, tên session/project hoặc nội dung runtime.
12. Fresh process không đọc/khôi phục session runtime từ SQLite. Project, note, event, profile và settings bền vững không bị cleanup của BE-001 xóa.
13. Ba command Quit từ frontend chỉ authorize exact invoking window `main` lấy từ `WebviewWindow`; `quick-note` và mọi label khác nhận `UnauthorizedWindow` trước khi đọc/tạo/xóa pending request, lấy runtime snapshot hoặc bắt đầu shutdown. Tray Quit đi qua controller Rust nội bộ cùng state machine, không giả mạo một Tauri invocation.

## Lỗi

```rust
#[derive(Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
pub enum AppLifecycleError {
    InvalidWindow,
    UnauthorizedWindow,
    MainWindowUnavailable,
    WindowOperationFailed { operation: WindowOperation },
    TrayOperationFailed { operation: TrayOperation },
    EventDeliveryFailed { event: LifecycleEvent },
    RuntimeSnapshotFailed,
    RuntimeShutdownFailed,
    InvalidRequestId,
    StaleQuitRequest,
    QuitAlreadyInProgress,
    StateLockPoisoned,
}
```

Các enum supporting public có contract chính xác sau và đều derive `Serialize`/`TS`, serialize `snake_case`:

```rust
pub enum WindowOperation {
    Show,
    Hide,
    Unminimize,
    Focus,
    Minimize,
    ReadMaximized,
    Maximize,
    Unmaximize,
}

pub enum TrayOperation {
    CreateIcon,
    BuildMenu,
    ReplaceMenu,
}

pub enum LifecycleEvent {
    QuitRequested,
    NavigateSession,
}
```

Các enum này không chứa thông báo OS tự do.

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `InvalidWindow` | Command cửa sổ được gọi từ window không phải `main`. | Không retry; báo lỗi integration. |
| `UnauthorizedWindow` | `request_quit`, `cancel_quit` hoặc `confirm_quit` được invoke từ window khác exact `main`. | Không retry; đóng bề mặt Quit ngoài main và báo lỗi integration. |
| `MainWindowUnavailable` | Không tìm thấy window label `main`. | Hiển thị lỗi không thể mở XWork; cho retry từ tray/lần mở sau. |
| `WindowOperationFailed` | Show, hide, minimize, maximize, unmaximize hoặc focus native thất bại. | Giữ UI hiện tại và cho retry thao tác. |
| `TrayOperationFailed` | Không tạo icon/menu hoặc không cập nhật menu native. | Startup dừng nếu khởi tạo; refresh sau startup giữ menu gần nhất và log lỗi. |
| `EventDeliveryFailed` | Không emit được event lifecycle đến main window. | Với command thì hiển thị lỗi; với tray giữ pending request để lần click sau retry. |
| `RuntimeSnapshotFailed` | Adapter runtime không lấy được count/list nhất quán. | Không cho Quit không xác nhận; hiển thị lỗi và cho retry. |
| `RuntimeShutdownFailed` | Không xác nhận được toàn bộ runtime/process đã dừng. | Giữ ứng dụng mở, hiển thị lỗi trong dialog và cho retry. |
| `InvalidRequestId` | `request_id == 0`. | Không đóng dialog; báo lỗi request không hợp lệ. |
| `StaleQuitRequest` | ID không khớp request pending hoặc không còn request. | Đóng dialog cũ và gọi lại `request_quit` nếu người dùng vẫn muốn thoát. |
| `QuitAlreadyInProgress` | Một confirm khác đã chuyển state sang `ShuttingDown`. | Disable hành động lặp, không hiển thị dialog thứ hai. |
| `StateLockPoisoned` | Callback trước đó panic khi giữ lifecycle mutex. | Không tiếp tục Quit âm thầm; báo lỗi chung và yêu cầu khởi động lại. |

Source error nội bộ được giữ trong log chain nhưng payload/`Display` gửi frontend chỉ chứa error code và operation enum an toàn.

## Luồng chính

### Khởi động và single instance

1. `app::configure` đăng ký single-instance plugin trước mọi plugin/setup khác, command handler và close handler.
2. Primary instance resolve app data, mở/migrate Storage theo BE-002, tạo lifecycle state và system tray; bất kỳ bước bắt buộc nào lỗi thì startup thất bại.
3. Fresh primary instance để FE-001 khởi tạo memory router tại `Home`; không load session runtime.
4. Lần chạy executable tiếp theo được plugin chuyển tới primary instance rồi kết thúc trước khi tạo app state riêng. Primary instance bỏ qua argv/cwd, show → unminimize → focus `main` và giữ route hiện tại.

### Đóng và mở lại cửa sổ

1. Close command hoặc native `CloseRequested` kiểm tra đúng label `main`; nếu không ở `ShuttingDown`, backend prevent close.
2. Backend hide main window; process, storage, tray, runtime capability và pending quit request tiếp tục sống.
3. `Open XWork` gọi show → unminimize → focus. Lỗi focus không được đổi thành Quit hoặc tạo window thứ hai; dialog pending xuất hiện lại cùng window nếu có.

### Quit từ tray hoặc frontend

1. Backend await một snapshot nhất quán từ `AppRuntime` ngoài lifecycle lock. Nếu snapshot lỗi, không thoát.
2. Nếu `session_count == 0`, backend atomically chuyển sang `ShuttingDown`, nhả lock, await cleanup pipeline và gọi `app.exit(0)` khi thành công.
3. Nếu còn session, backend cấp/lưu `request_id`. Frontend command nhận `Some(request)`; tray action show main rồi emit `app-quit-requested` với cùng shape.
4. FE-001 hiển thị dialog có số session/project, process đang chạy, file chưa lưu, cảnh báo không khôi phục và gợi ý đóng window để tiếp tục background; `Cancel` gọi `cancel_quit`, `Quit` gọi `confirm_quit`.
5. Confirm hợp lệ chuyển state sang `ShuttingDown`, nhả lock rồi await cleanup runtime hiện tại. Lỗi cleanup đưa state trở lại pending và không exit; thành công xóa runtime/pending rồi gọi `app.exit(0)`.

### Chọn session từ tray

1. Backend rebuild menu chỉ khi tập attention thay đổi, chuẩn hóa label và lấy tối đa năm mục theo thứ tự đã chốt.
2. Khi click, backend resolve menu ID trong snapshot menu hiện tại. ID không còn tồn tại thì refresh menu và không điều hướng.
3. Với ID hợp lệ, backend show/unminimize main, best-effort focus native window rồi emit `app-navigate-session`.
4. FE-001/FE-006 điều hướng bằng `session_id` và focus pane phù hợp sau render; backend không tự đổi router state.

## Ràng buộc kỹ thuật

- Blocking: Callback single-instance, window event và tray event không được tự chờ cleanup hoặc I/O; callback native chỉ schedule async task rồi trả. Tauri command và task đó await `AppRuntimeFuture`; từng capability owner tự chuyển đúng SQLite/PTY/filesystem blocking work sang worker của nó. Không dùng `block_on`, không chạy async adapter trong `spawn_blocking` và không giữ lifecycle mutex qua `.await`.
- Bảo mật: Không nhận window label, menu ID, argv, cwd hoặc session label do frontend cung cấp. Command chỉ hoạt động với invoking window `main`; session menu ID được backend tạo và kiểm tra lại với snapshot hiện tại. Không log argv/cwd, tên project/session, terminal output, path hoặc source error có dữ liệu người dùng.
- Hiệu năng: Tray chỉ rebuild khi model hiển thị thay đổi, không theo từng terminal output; tối đa năm session attention. Show/hide/focus phải được dispatch trên main thread theo API Tauri và không tạo window/tray mới cho mỗi lần gọi.

## Tiêu chí hoàn thành

- [ ] Chạy executable thứ hai trên Windows không tạo process ứng dụng hoạt động thứ hai và đưa window `main` của instance đầu ra trước mà không reset route/session.
- [ ] Nút Close tùy biến và native Close đều hide main window xuống tray; minimize/maximize hoạt động đúng và không ảnh hưởng runtime.
- [ ] Tray Phase 1 có `Open XWork` và `Quit XWork`; không có group attention rỗng hoặc `Quick Note` chưa hoạt động. Contract cho phép BE-005 và BE-017 bổ sung đúng vị trí mà không đổi command/event public.
- [ ] Tray có dữ liệu fixture chỉ hiển thị tối đa năm session, đúng thứ tự, label đã chuẩn hóa; click session hợp lệ show main rồi phát đúng payload điều hướng.
- [ ] Quit với `0` session cleanup rồi exit không mở dialog; Quit với ít nhất `1` session luôn tạo đúng một pending request và đủ bốn count cho dialog FE-001.
- [ ] Cancel và Close khi dialog mở không dọn runtime; Cancel làm confirm ID cũ bị từ chối, còn Close giữ request để mở lại đúng dialog; double-confirm không chạy cleanup hai lần.
- [ ] `request_quit`, `cancel_quit` và `confirm_quit` nhận invoking `WebviewWindow`, chỉ exact `main` được phép; `quick-note`/label khác nhận `UnauthorizedWindow` trước mọi runtime snapshot hoặc state transition.
- [ ] Confirm thành công dừng process trước khi loại bỏ session rồi exit; cleanup lỗi giữ XWork mở và không báo thành công.
- [ ] `request_quit`, tray Quit và `confirm_quit` await `AppRuntimeFuture` ngoài lifecycle lock; fake future có yield vẫn hoàn tất, không `block_on` hoặc `spawn_blocking` một async cleanup.
- [ ] Shutdown đặt BE-011 intake gate trước BE-005/BE-007 cleanup, await `shutdown_runtime_sources` sau runtime cleanup và chỉ đóng Storage/exit khi toàn bộ chuỗi thành công.
- [ ] Fresh process mở Home và không khôi phục session/tab/pane/output; dữ liệu bền vững của BE-002 và capability khác không bị Quit xóa.
- [ ] Binding được sinh từ Rust, không sửa tay; custom command không làm rộng `src-tauri/capabilities/main.json`.
- [ ] Mọi function, method, callback, test và helper mới có comment ngắn; state transition/race có inline comment giải thích invariant.
- [ ] Trên Windows, formatter/linter/type-check/test frontend liên quan, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features` và Tauri build đều pass.
- [ ] Smoke test desktop thật xác nhận close-to-tray, restore/focus, single instance, menu native và Quit; hành vi macOS được hoãn đến chuẩn bị release theo quy tắc project.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/app/lifecycle.rs` (`#[cfg(test)]`) | Unit | Exact-label authorization cho ba command Quit, cấp/wrap request ID, reuse pending request, condition cần xác nhận, Cancel/stale ID, double-confirm, async snapshot/cleanup success/failure, future có yield và state không giữ lock qua await. |
| `src-tauri/src/app/tray.rs` (`#[cfg(test)]`) | Unit | Thứ tự/menu ID cố định, bỏ group rỗng, giới hạn năm session, sort ổn định, chuẩn hóa/cắt Unicode label và không suy action từ label. |
| `src-tauri/src/platform/window.rs` (`#[cfg(test)]`) | Unit | Thứ tự show → unminimize → focus và mapping từng lỗi operation qua window adapter test double. |
| `src-tauri/tests/app_lifecycle.rs` | Integration | Invoke command từ exact `main` thành công; `quick-note`/label khác nhận `UnauthorizedWindow` và không chạm pending/runtime; payload camelCase, event target `main`, close-to-hide, request/cancel/confirm, session navigation và thứ tự BE-011 gate → BE-005 cleanup → BE-011 drain → Storage close/exit với async runtime double. |
| `src-tauri/tests/app_builder.rs` | Integration | Composition root đăng ký command/state/setup đúng một lần, khởi tạo Storage trước tray và build được với mock runtime cô lập. |
| `src-tauri/tests/export_bindings.rs` | Contract | Generated `app-lifecycle.ts` khớp DTO/error Rust, gồm `UnauthorizedWindow`, và không có diff sau generate. |

Các API native khó mô phỏng trung thực — single-instance IPC hệ điều hành, tray context menu, focus và process exit — phải có smoke scenario thủ công trên Windows với executable thật; unit/integration test không được tuyên bố thay thế kiểm tra này.

## Câu hỏi mở

Không có.
