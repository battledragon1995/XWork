# BE-007 — Terminal và PTY

Tài liệu này đặc tả hợp đồng backend cho PTY/ConPTY, tiến trình terminal, luồng output có thứ tự, input, resize và tích hợp vòng đời pane/session.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-007` |
| Phase | `1` |
| Capability | `src-tauri/src/terminal/` |
| Yêu cầu chức năng | §10.1, §8.2; liên quan §5.3–5.4, §8.1, §8.3, §9, §10.2–10.3, §15, §18 và §20 Phase 1 |
| Frontend liên quan | `FE-006`, `FE-007`, `FE-008` |
| Phụ thuộc | `BE-003`, `BE-005`, `BE-006` |

## Mục tiêu

Backend tạo một PTY thật cho tool đã chọn, chạy shell hoặc CLI tại canonical project root, stream byte output theo thứ tự qua Tauri Channel, nhận input/resize và giữ tiến trình chạy khi pane không hiển thị hoặc cửa sổ ẩn xuống tray. Vòng đời mỗi terminal được gắn với `PaneContentDto::Terminal` của BE-005 để close pane/tab/session, remove project và Quit đều dừng đúng process tree, còn close tab có thể mở lại buffer đã kết thúc mà không chạy lại command.

### Ngoài phạm vi

- Không CRUD profile, kiểm tra command, đọc secret trực tiếp hoặc quyết định shell mặc định; BE-006 trả `ResolvedCliProfile` đã validate ngay trước launch.
- Không đọc project path từ frontend hoặc database; canonical working directory chỉ đến từ `ProjectService::available_root` của BE-003.
- Không sở hữu cấu trúc session/tab/pane, close confirmation, reopen slot hoặc aggregate sidebar status; BE-005 sở hữu và BE-007 cập nhật qua port hẹp.
- Không persist session, PTY, output, replay buffer hoặc process state vào SQLite/file/backup; toàn bộ bị loại bỏ sau Quit.
- Không triển khai UI WTerm, selection/clipboard, find bar, link interaction hoặc pane layout; FE-008/FE-007 sở hữu các hành vi này.
- Không dùng WebSocket, local server, shell/filesystem plugin hoặc event thường để truyền terminal output.
- Không tạo notification record; BE-011 về sau chỉ tiêu thụ domain state/attention đã làm sạch.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo `portable-pty = "=0.9.0"`, Tokio/Serde/ts-rs cần dùng, `windows-sys` cho Job Object và `libc` cho signal process group theo target. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust do Cargo sinh; không sửa tay. |
| `src-tauri/src/lib.rs` | Export/giữ public module `terminal` và `platform`. |
| `src-tauri/src/app/mod.rs` | Ghép `TerminalManager`, adapter Projects/Profiles/Sessions, router content lifecycle một lần, managed state và sáu command. |
| `src-tauri/src/terminal/mod.rs` | Re-export model, command và Rust integration contract công khai của capability Terminal. |
| `src-tauri/src/terminal/models.rs` | Runtime ID, size, state, DTO/event/error public và consumer-side port của Terminal. |
| `src-tauri/src/terminal/commands.rs` | Sáu Tauri command mỏng cho start/query/subscribe/input/resize/ack attention. |
| `src-tauri/src/terminal/manager.rs` | Ownership terminal map, launch gate theo pane, orchestration dependency, lifecycle/reopen và activity propagation sang Sessions. |
| `src-tauri/src/terminal/pty.rs` | Adapter `portable-pty`, `CommandBuilder`, reader/control worker, spawn/wait/resize/input/terminate. |
| `src-tauri/src/terminal/stream.rs` | Sequence, raw frame codec, bounded replay ring, subscriber replacement, channel sender và attention scanner. |
| `src-tauri/src/platform/mod.rs` | Export process-tree adapter theo OS. |
| `src-tauri/src/platform/process_tree.rs` | Windows Job Object kill-on-close; macOS process-group termination; fake adapter cho test. |
| `src-tauri/tests/app_builder.rs` | Smoke test composition root, one-time router bind, managed state và command registration. |
| `src-tauri/tests/export_bindings.rs` | Sinh/kiểm tra DTO/event/error BE-007 cùng binding terminal hiện có. |
| `src-tauri/tests/terminal_runtime.rs` | Integration test public command, Channel protocol và fake PTY/dependency ports. |
| `src-tauri/tests/terminal_pty_windows.rs` | Integration test ConPTY thật, process tree, Unicode, input, resize và bốn terminal đồng thời. |
| `src-tauri/tests/fixtures/pty_echo.ps1` | Fixture Windows phát chunk/Unicode, echo input, report size và exit code xác định được. |
| `src-tauri/tests/fixtures/pty_child_tree.ps1` | Fixture Windows tạo child process để xác nhận close/Quit không để process mồ côi. |
| `src/bindings/terminal/` | Binding TypeScript do ts-rs sinh; không sửa tay. |
| `tests/e2e/terminal.e2e.ts` | Desktop E2E Windows nối WTerm/Ghostty với PTY thật cho FE-006/007/008. |

Không có migration và không đổi capability permission. Main webview chỉ gọi custom command đã đăng ký; backend tự thực hiện PTY/process access. CSP hiện tại đã có `'wasm-unsafe-eval'`; implementation phải giữ và kiểm chứng, không nới thêm source hoặc wildcard.

Dependency Windows phải dùng `windows-sys = 0.61.2` đã có trong lockfile với features `Win32_Foundation`, `Win32_System_JobObjects` và `Win32_System_Threading`; dependency Unix dùng `libc` chỉ sau `cfg(unix)`. `portable-pty` khóa exact `=0.9.0` theo TechStack, không bật backend PTY thay thế.

## Dữ liệu

BE-007 chỉ giữ runtime state trong `TerminalManager`; không có bảng SQLite, migration hoặc file output tạm.

```rust
pub struct TerminalManager {
    // Runtime map, dependency ports, shutdown gate, ID allocator and event sink.
}

struct TerminalRuntime {
    // PTY/process handles, pane identity, state, control actor and output stream state.
}
```

- Terminal ID là chuỗi opaque `terminal-` + bộ đếm `u64` tăng đơn điệu trong process, giống chiến lược runtime ID của BE-005; không serialize số nguyên 64-bit trực tiếp sang JavaScript.
- Một `pane_id` có tối đa một terminal hoặc một launch đang bay. Runtime map tra theo `terminal_id` và có secondary map `pane_id → terminal_id`.
- Một runtime đang attach giữ `session_id`, `tab_id`, `pane_id`, `profile_id`, display title đã làm sạch, PTY size cuối, process state, activity, input/resize sequence, stream sequence và handle worker. Không giữ project root, command, argument, environment hoặc secret sau khi spawn hoàn tất.
- Output replay ring chỉ ở memory, giữ tối đa `8 MiB` hoặc `1024` frame gần nhất cho mỗi terminal, tùy ngưỡng nào chạm trước; chỉ evict nguyên frame từ đầu. Đây là cửa sổ recovery Channel, không phải terminal history source of truth.
- FE-008 phải giữ Channel và WTerm/Ghostty core trong terminal registry theo `terminal_id`, độc lập vòng đời DOM pane. Vì vậy chuyển session, maximize hoặc ẩn main window không unmount/dispose terminal core và không làm mất full scrollback đang được WTerm giữ.
- Reopen handle của BE-005 chỉ chứa token opaque trỏ tới runtime đã dừng/retained trong manager. Token, ring và WTerm registry đều chỉ tồn tại tới khi reopen slot bị discard hoặc ứng dụng Quit.

## DTO public

Mọi output DTO derive `Clone`, `Debug`, `Serialize`, `Deserialize` và `TS`; struct field và enum variant dùng `camelCase`. `tauri::ipc::Channel` và raw output frame không phải ts-rs DTO.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PtySizeDto {
    pub columns: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TerminalProcessStateDto {
    Running,
    Closing,
    Exited,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TerminalProfileUnavailableReasonDto {
    CommandNotFound,
    ShellNotFound,
    CredentialMissing,
    CredentialStoreUnavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDto {
    pub id: String,
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub profile_id: String,
    pub title: String,
    pub size: PtySizeDto,
    pub state: TerminalProcessStateDto,
    pub exit_code: Option<String>,
    pub was_terminated: bool,
    pub needs_attention: bool,
    pub output_subscribed: bool,
    pub latest_output_sequence: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSubscriptionDto {
    pub terminal: TerminalDto,
    pub first_available_sequence: String,
    pub latest_sequence: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputAckDto {
    pub accepted_sequence: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeAckDto {
    pub accepted_sequence: String,
    pub size: PtySizeDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TerminalStateChangeKindDto {
    ProcessChanged,
    AttentionChanged,
    StreamDetached,
    Disposed,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStateChangedDto {
    pub change: TerminalStateChangeKindDto,
    pub terminal: TerminalDto,
    pub final_output_sequence: Option<String>,
}
```

Quy ước DTO:

- `exit_code` là số nguyên exit status không âm serialize dạng decimal string; `None` khi process còn chạy, bị signal hoặc PTY I/O thất bại không có code tin cậy.
- `was_terminated = true` chỉ khi XWork chủ động close process; natural exit luôn `false`.
- `state = Failed` khi natural exit code khác `0` hoặc transport/process wait lỗi. `Exited` dành cho natural exit code `0` và process bị XWork dừng thành công; field `was_terminated` phân biệt hai trường hợp.
- `output_subscribed` phản ánh manager còn active sender cho terminal hay không; `false` không có nghĩa process đã dừng và là tín hiệu để FE subscribe lại từ last applied sequence.
- `latest_output_sequence`, ack sequence và replay boundary là decimal `u64` string. Output sequence bắt đầu từ `1`; terminal chưa có output dùng latest sequence `0` và first available sequence `1`.
- Không DTO/event/error nào chứa PID/handle, project root, executable path đã resolve, arguments, environment, secret hoặc terminal output.

### Raw output frame version 1

Mỗi lần gửi Channel là đúng một `ArrayBuffer` từ `InvokeResponseBody::Raw`, có layout little-endian sau:

| Offset | Độ dài | Kiểu | Ý nghĩa |
|---:|---:|---|---|
| `0` | `1` | `u8` | Protocol version, luôn bằng `1`. |
| `1` | `8` | `u64` | Output sequence của terminal. |
| `9` | `4` | `u32` | Số byte payload. |
| `13` | Theo header | bytes | Byte PTY nguyên trạng, không decode/re-encode. |

Payload mỗi frame từ `1` đến `32768` byte. Header length phải khớp chính xác Channel message length; FE-008 từ chối frame sai version/length. Callback IPC có thể hoàn tất lệch thứ tự khi raw payload đi qua fetch path của Tauri, nên FE giữ reorder buffer theo sequence và chỉ đưa dải liên tục vào WTerm; duplicate `<= lastApplied` bị bỏ. Một Channel gắn đúng một terminal nên frame không lặp `terminal_id`.

FE-008 truyền payload dưới dạng `Uint8Array` trực tiếp vào WTerm/Ghostty `write`; không dùng `TextDecoder`, vì UTF-8 code point và escape sequence có thể bị chia giữa các PTY read.

## Tauri command

Tất cả command chỉ nhận invocation từ window label `main`. Command clone manager/channel cần thiết rồi nhả `tauri::State` trước `.await`; không chứa spawn, lock hoặc process logic.

### `start_terminal`

Khởi chạy tool đang nằm trong `ToolSelection` của pane và attach terminal runtime vào BE-005.

```rust
/// Starts the selected tool in a measured PTY and attaches it to its pane.
#[tauri::command]
pub async fn start_terminal(
    window: tauri::Window,
    state: tauri::State<'_, TerminalManager>,
    session_id: String,
    tab_id: String,
    pane_id: String,
    initial_size: PtySizeDto,
    on_output: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<TerminalDto, TerminalError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; quan hệ session/tab/pane đúng; pane đang `ToolSelection`; size hợp lệ; không có runtime/launch khác cho pane. Profile/project lấy từ port, không nhận từ frontend. |
| Side effect | Resolve root/profile; mở PTY; spawn process; gắn process tree; tạo workers/subscriber; attach `PaneContentRef::Terminal`; cập nhật Sessions activity; trả state kể cả process đã exit rất nhanh. Channel có thể chuyển output vào pending WTerm core sau spawn và trước khi command trả kết quả. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRuntimeId`, `SessionNotFound`, `TabNotFound`, `PaneNotFound`, `PaneNotLaunchable`, `TerminalAlreadyAttached`, `ProjectNotFound`, `ProjectUnavailable`, `ProjectLookupFailed`, `ProfileNotFound`, `ProfileUnavailable`, `ProfileLookupFailed`, `InvalidPtySize`, `StreamAttachFailed`, `PtyUnavailable`, `PtyOpenFailed`, `ProcessSpawnFailed`, `SessionAttachFailed`, `RuntimeShuttingDown`. |

### `get_terminal`

Trả snapshot an toàn của một terminal đang attach hoặc retained.

```rust
/// Returns the current public state of one terminal runtime.
#[tauri::command]
pub async fn get_terminal(
    window: tauri::Window,
    state: tauri::State<'_, TerminalManager>,
    terminal_id: String,
) -> Result<TerminalDto, TerminalError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; terminal ID thuộc process hiện tại. |
| Side effect | Không có. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRuntimeId`, `TerminalNotFound`. |

### `subscribe_terminal_output`

Gắn lại một Channel cho terminal và replay các frame sau sequence frontend đã áp dụng.

```rust
/// Replaces the output subscriber and replays every retained frame after a sequence.
#[tauri::command]
pub async fn subscribe_terminal_output(
    window: tauri::Window,
    state: tauri::State<'_, TerminalManager>,
    terminal_id: String,
    after_sequence: Option<String>,
    on_output: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> Result<TerminalSubscriptionDto, TerminalError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; sequence parse được `u64` và không lớn hơn latest. Nếu `after < latest` thì `after + 1` không được cũ hơn first retained sequence; `after = latest` luôn không cần replay. `None` nghĩa là chưa áp dụng frame nào và chỉ hợp lệ khi ring vẫn bắt đầu ở sequence 1. |
| Side effect | Dispatcher của đúng terminal enqueue replay theo sequence rồi atomically thay subscriber; live frame luôn đứng sau replay. Subscriber cũ bị drop. Không chạy lại process. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRuntimeId`, `InvalidSequence`, `TerminalNotFound`, `OutputReplayUnavailable`, `StreamAttachFailed`. |

### `write_terminal`

Gửi dữ liệu từ WTerm `onData` vào PTY theo sequence input chính xác.

```rust
/// Writes one ordered UTF-8/control input chunk to a running PTY.
#[tauri::command]
pub async fn write_terminal(
    window: tauri::Window,
    state: tauri::State<'_, TerminalManager>,
    terminal_id: String,
    input_sequence: String,
    data: String,
) -> Result<TerminalInputAckDto, TerminalError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; terminal running; sequence đúng expected tiếp theo; UTF-8 payload tối đa `65536` byte. Control/NUL được phép vì là terminal input hợp lệ. |
| Side effect | Control actor ghi toàn bộ chunk hoặc trả lỗi, flush theo ranh giới chunk; chỉ sau thành công mới tăng sequence. Input thành công clear `needs_attention` và gọi `SessionManager::update_pane_activity` nếu cờ đổi. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRuntimeId`, `InvalidSequence`, `InputOutOfOrder`, `InputTooLarge`, `TerminalNotFound`, `TerminalNotRunning`, `ProcessIoFailed`. |

### `resize_terminal`

Áp dụng kích thước cell mới sau khi FE-008 đo pane.

```rust
/// Resizes a PTY using a monotonic client resize sequence.
#[tauri::command]
pub async fn resize_terminal(
    window: tauri::Window,
    state: tauri::State<'_, TerminalManager>,
    terminal_id: String,
    resize_sequence: String,
    size: PtySizeDto,
) -> Result<TerminalResizeAckDto, TerminalError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; terminal running; sequence parse được; size hợp lệ. |
| Side effect | Sequence mới hơn được coalesce theo last-write-wins rồi gọi `MasterPty::resize`; sequence cũ/duplicate không resize lại và trả current ack. Chỉ ack sequence mới sau khi OS nhận resize thành công. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRuntimeId`, `InvalidSequence`, `InvalidPtySize`, `TerminalNotFound`, `TerminalNotRunning`, `ResizeFailed`. |

### `acknowledge_terminal_attention`

Clear cờ attention khi người dùng đã focus pane/đọc prompt.

```rust
/// Clears a terminal attention marker after the user focuses its pane.
#[tauri::command]
pub async fn acknowledge_terminal_attention(
    window: tauri::Window,
    state: tauri::State<'_, TerminalManager>,
    terminal_id: String,
) -> Result<TerminalDto, TerminalError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; terminal tồn tại và đang attach. |
| Side effect | Nếu cờ đang bật, clear cờ, gọi `update_pane_activity` của BE-005 và phát `attentionChanged`; no-op nếu đã clear. Không gửi byte vào PTY. |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidRuntimeId`, `TerminalNotFound`. |

## Contract Rust nội bộ và tích hợp capability

Terminal sở hữu consumer-side port, app composition hiện thực nó bằng public query/method của BE-003, BE-005 và BE-006:

```rust
pub struct TerminalPaneTarget {
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub project_id: String,
    pub profile_id: String,
    pub title: String,
}

pub struct TerminalActivity {
    pub running_process_count: u32,
    pub needs_attention: bool,
    pub finished_process_count: u32,
    pub failed_process_count: u32,
}

pub type TerminalFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait TerminalDependencies: Send + Sync {
    /// Resolves and validates the current tool-selection pane.
    fn launch_target<'a>(
        &'a self,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<TerminalPaneTarget, TerminalError>>;

    /// Resolves the current canonical project root.
    fn available_project_root<'a>(
        &'a self,
        project_id: &'a str,
    ) -> TerminalFuture<'a, Result<PathBuf, TerminalError>>;

    /// Resolves command, arguments, shell and environment immediately before spawn.
    fn resolve_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> TerminalFuture<'a, Result<ResolvedCliProfile, TerminalError>>;

    /// Replaces ToolSelection with Terminal after spawn succeeds.
    fn attach_terminal<'a>(
        &'a self,
        target: &'a TerminalPaneTarget,
        terminal_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>>;

    /// Records an output edge for unseen-output aggregation.
    fn record_output<'a>(
        &'a self,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>>;

    /// Replaces the current pane activity snapshot.
    fn update_activity<'a>(
        &'a self,
        pane_id: &'a str,
        activity: TerminalActivity,
    ) -> TerminalFuture<'a, Result<(), TerminalError>>;
}
```

Adapter composition:

- `launch_target` lấy snapshot từ public owner query `SessionManager::get_session` dùng chung với command, kiểm đúng tab/pane và `PaneContentDto::ToolSelection`, rồi trả `project_id/profile_id/title`; không đọc map nội bộ Sessions.
- `available_project_root` gọi `ProjectService::available_root` của BE-003 và chỉ trả canonical `PathBuf` khi project còn available/không removal gate.
- `resolve_profile` gọi `CliProfilesService::resolve_for_launch` của BE-006; secret ở `Zeroizing<String>` và bị drop ngay sau `spawn_command` trả về. Adapter map `CommandNotFound`/`ShellNotFound` sang hai reason cùng tên, `SecretNotFound` sang `CredentialMissing`, `CredentialStoreUnavailable`/`SecretReadFailed` sang `CredentialStoreUnavailable`, `ProfileNotFound` giữ nguyên và lỗi resolver khác sang `ProfileLookupFailed`.
- `attach_terminal` gọi `SessionManager::attach_runtime_content` với `PaneContentRef::Terminal`; method Sessions là authority chống pane bị đổi/đóng trong lúc spawn.
- Consumer-port `record_output` và `update_activity` lần lượt gọi owner API `SessionManager::record_pane_output` và `SessionManager::update_pane_activity` của BE-005; adapter map lỗi thành error an toàn, không tạo dependency ngược từ Sessions sang implementation Terminal.

BE-007 cung cấp một terminal lifecycle delegate cho `PaneContentRuntime` của BE-005:

```rust
impl TerminalManager {
    /// Inspects close blockers for one terminal content reference.
    pub async fn close_impact(
        &self,
        terminal_id: &str,
    ) -> Result<PaneCloseImpact, TerminalError>;

    /// Stops a terminal and optionally retains its runtime-only buffer handle.
    pub async fn close_for_session(
        &self,
        terminal_id: &str,
        retention: CloseRetention,
    ) -> Result<Option<ReopenHandle>, TerminalError>;

    /// Restores a retained stopped terminal without spawning a process.
    pub async fn reopen_for_session(
        &self,
        handle: ReopenHandle,
    ) -> Result<PaneContentRef, TerminalError>;

    /// Permanently disposes a retained terminal and its output state.
    pub async fn discard_for_session(
        &self,
        handle: ReopenHandle,
    ) -> Result<(), TerminalError>;
}
```

- Composition root dùng `PaneContentRuntimeRouter` của Sessions để delegate `PaneContentOwner::Terminal` sang các method trên; error được làm sạch thành `SessionsError::ContentLifecycleFailed`.
- Để tránh strong-reference cycle, router được tạo trước với slot bind một lần, SessionManager nhận router, Terminal dependency adapter giữ `Weak<SessionManager>`, rồi router bind `Weak<TerminalManager>` trước khi command được đăng ký. Bind thiếu/lặp làm app setup thất bại.
- `close_impact` chỉ trả profile display name khi process còn running; không đưa command/args/cwd vào label.
- `CloseRetention::ReopenLastTab` dừng process, drain output, giữ terminal entry ở state retained và trả token `terminal-reopen-` + runtime counter. Reopen trả cùng terminal/profile ID ở trạng thái đã exit; không restart và không tạo output sequence mới.
- `Discard` dừng process, drain hoặc timeout theo invariant, drop Channel/ring/handle và xóa cả hai runtime indexes. Các method close/reopen/discard idempotent theo terminal ID/token để BE-005 retry an toàn.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| Per-terminal Tauri Channel | Raw output frame version 1 | Mỗi PTY read có dữ liệu; replay khi subscribe. | Một dispatcher và một sender worker cho mỗi terminal; sequence tăng liên tục và replay được enqueue trước live. FE chỉ apply theo sequence nên end-to-end output có thứ tự dù callback IPC tạm đến lệch. Không dùng event thường. |
| `terminal://state-changed` | `TerminalStateChangedDto` | Process state, attention, stream attachment hoặc disposal thay đổi. | Tần suất thấp, không chứa output. Natural/final state chỉ phát sau reader EOF và mọi byte đã được đánh sequence; `final_output_sequence` cho phép frontend đợi Channel bắt kịp nếu event đến trước. |

Channel guarantee chỉ áp dụng trong từng terminal. Không có total order giữa các terminal. `Channel::send` failure hoặc sender queue đầy không dừng/khóa PTY: manager detach subscriber, giữ đọc vào replay ring và phát một `streamDetached`; FE-008 subscribe lại bằng last applied sequence.

Event state không phải source of truth duy nhất. FE gọi `get_terminal` khi mount/recover; Sessions tiếp tục phát `sessions://runtime-changed` chỉ khi aggregate summary đổi, không theo output chunk.

State/event emit thất bại không rollback state, không dừng process và không đổi command result; manager chỉ ghi diagnostic đã redaction. Frontend resync bằng `get_terminal`/Sessions snapshot khi route mount, window focus hoặc thấy final sequence chưa đủ.

Trong cửa sổ pending giữa spawn và `attach_runtime_content`, chỉ Channel của chính `start_terminal` được phép chuyển output vào pending core. Manager chưa phát `terminal://state-changed` và chưa gọi `SessionManager::record_pane_output`/`SessionManager::update_pane_activity`; nó chỉ tích lũy state, attention, stream-detached và cờ “đã có output”. Attach thành công publish snapshot hiện tại, đồng bộ activity/output edge một lần qua đúng hai owner API này, rồi phát state event hiện tại cho từng process/attention/stream condition đã đổi; attach thất bại dispose runtime và Channel, không phát event cho terminal chưa từng thuộc Sessions.

## Business rule và invariant

1. Start chỉ được phép sau khi WTerm/Ghostty đã ready và FE có grid cell hợp lệ. `columns` trong `2..=500`, `rows` trong `1..=300`; pixel width/height gửi portable-pty luôn bằng `0`.
2. Mỗi pane có tối đa một launch/terminal. Launch gate được đặt trước khi gọi dependency port và chỉ gỡ sau attach hoặc cleanup hoàn tất.
3. Start lấy project/profile từ tool selection backend. Frontend không truyền project ID, profile ID, path, command, args hoặc env nên không thể đổi cwd hay executable của pane.
4. BE-003 được hỏi availability ngay trước profile resolution/spawn; BE-006 recheck command/shell và đọc secret ngay trước spawn. Bất kỳ lỗi nào giữ pane ở `ToolSelection` và không attach terminal nửa vời.
5. `portable_pty::native_pty_system()` là authority: Windows dùng ConPTY, macOS dùng native PTY. Không fallback pipe giả hoặc shell plugin nếu PTY unavailable.
6. `ResolvedCliLaunchKind::InteractiveShell` spawn shell executable trực tiếp. `Command` spawn CLI executable trực tiếp bằng `CommandBuilder::new`, gọi `arg` cho từng argument và `env` cho từng environment; không nối input thành shell string. Selected `ResolvedShell` đặt `COMSPEC` trên Windows hoặc `SHELL` trên macOS để CLI/subprocess dùng đúng shell đã chọn.
7. Environment kế thừa process XWork, sau đó đặt `TERM=xterm-256color`, `COLORTERM=truecolor`, shell hint, cuối cùng overlay environment profile. Riêng `COMSPEC`/`SHELL` effective được đặt lại sau overlay để shell selection không bị env row làm sai. Secret buffer bị drop/zeroize ngay sau spawn call.
8. Working directory luôn là canonical root BE-003 trả ở lần launch. Locate project sau đó không đổi cwd của process đang chạy.
9. Slave PTY bị drop ngay sau spawn; master reader, writer/control và child/process-tree handle chỉ tồn tại trong backend. PID/OS handle không qua IPC.
10. PTY reader không giả định boundary UTF-8/ANSI. Read lớn được chia frame tối đa 32 KiB, empty read không tạo frame; chỉ EOF kết thúc stream.
11. Output sequence được cấp đúng một lần ở dispatcher trước khi vào replay ring/sender queue. Không reuse sequence, kể cả subscriber đổi hoặc frame bị evict khỏi ring.
12. Channel sender có queue tối đa 256 frame. Subscriber của `start_terminal` hoạt động ngay khi workers sẵn sàng, không đợi Sessions attach, để process output sớm không bị giới hạn bởi thời gian attach; FE đã tạo pending WTerm core trước invoke. Khi subscriber chậm đến mức queue đầy, nó bị detach thay vì drop một frame giữa chuỗi; PTY reader tiếp tục, ring giữ cửa sổ recovery gần nhất.
13. Subscribe được serialize trong cùng dispatcher với output: enqueue toàn bộ retained frame lớn hơn `after_sequence`, thay subscriber, rồi mới xử lý live bytes tiếp theo. Callback còn bay từ subscriber cũ có thể đến sau; FE bỏ bằng sequence. Nếu ring đã evict frame cần thiết, trả `OutputReplayUnavailable`; không replay tail như thể đầy đủ.
14. FE reorder buffer tối đa 256 frame hoặc 8 MiB. Frame đến lệch được giữ tối đa 250 ms; hết hạn mà vẫn thiếu sequence thì FE gọi subscribe lại từ `lastApplied`, không tự bỏ qua gap. Chỉ dải contiguous mới được ghi vào Ghostty core.
15. FE terminal registry là owner full parsed scrollback trong runtime. Pane DOM có thể detach nhưng Channel/core không bị dispose khi chuyển route, maximize pane khác hoặc ẩn xuống tray. Chỉ Sessions close/discard/Quit disposal mới giải phóng.
16. Input sequence bắt đầu `1` mỗi terminal. Frontend await ack trước khi gửi chunk tiếp theo; duplicate/gap không được ghi. Write phải all-or-error ở cấp chunk; input payload tối đa 64 KiB để large paste được chunk có backpressure.
17. Resize sequence bắt đầu `1`. Resize duplicate/cũ là idempotent no-op; nhiều resize mới đang chờ được coalesce, nhưng ack chỉ phản ánh size OS đã áp dụng. Resize 0 do pane hidden bị frontend bỏ và backend từ chối.
18. Input, resize và close đi qua một control actor theo thứ tự actor nhận. PTY read/output chạy độc lập nên output không bị chặn bởi pane visibility.
19. Output thực đầu tiên sau khi runtime đã attach gọi `SessionManager::record_pane_output`; nếu output đến lúc pending thì manager gọi một lần ngay sau attach. Sau đó dispatcher coalesce lời gọi tối đa một lần mỗi 100 ms, nhưng BE-005 mới là authority biến nó thành unseen edge theo observed session/window visibility. Replay không gọi owner API này.
20. Attention scanner chỉ nhận BEL (`0x07`) hoặc OSC notification `9`/`777` đã kết thúc hợp lệ; không dùng keyword/AI-output heuristic. Scanner giữ tối đa 4 KiB partial OSC xuyên chunk, không log nội dung. Input hoặc explicit acknowledge clear cờ.
21. Sau spawn/attach, activity có running count `1`. Natural exit `0` chuyển finished count `1`; exit code khác `0` hoặc I/O/wait failure chuyển failed count `1`; process được XWork close không để activity sống trong pane sắp bị remove.
22. Natural exit state/event chỉ commit sau cả child wait và reader EOF, dispatcher đã cấp sequence cho mọi output. Event có thể đến trước Channel delivery nên frontend dùng `final_output_sequence` để render đủ output rồi mới chốt badge.
23. Chuyển session/project, maximize, resize pane khác, hide-to-tray và show window không gọi close, không drop PTY và không đổi process state. Pane không hiển thị giữ size cell cuối cùng.
24. Close process chạy hai bước có deadline: gửi ETX và chờ tối đa 750 ms; nếu còn sống thì đóng input/PTY và force terminate process tree, chờ thêm tối đa 1250 ms. Close thành công chỉ sau child exit và reader drain/EOF; mọi terminal trong shutdown chạy cleanup độc lập để một lỗi không bỏ qua terminal khác.
25. Windows gắn process vào Job Object có `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` ngay sau spawn và giữ handle tới disposal; force close đóng/terminate job để kill descendant. macOS signal process group `SIGHUP`, rồi `SIGTERM`, cuối cùng `SIGKILL` trong deadline.
26. Close/reopen/discard idempotent. Reopen terminal đã dừng không tăng running count, không spawn, không đổi output sequence và không gọi profile/credential/project lại.
27. Nếu spawn thành công nhưng Sessions attach thất bại/race với close, BE-007 bắt buộc terminate/drain/dispose process trước khi trả `SessionAttachFailed`; không để orphan runtime.
28. Nếu Sessions record/update port báo pane không còn tồn tại, manager đặt orphan cleanup và dừng terminal; không tiếp tục process không còn owner.
29. Quit đặt shutdown gate trước mọi cleanup; start/input/resize mới trả `RuntimeShuttingDown`. Runtime map/ring/token chỉ clear sau khi tất cả close đã được thử; không persist/restore ở lần chạy sau.
30. Reader/writer/wait gặp lỗi fatal phải đưa terminal về `Failed` và kích hoạt process-tree termination; không để process tiếp tục chạy khi XWork không còn quan sát/điều khiển PTY. Output/ring đã có vẫn được giữ tới close/discard.
31. Close thất bại đưa runtime khỏi state `Closing` về trạng thái thực tế có thể retry và giữ Sessions target. Không báo close thành công nếu child/process tree chưa được xác nhận dừng.
32. Mọi function, method, callback, helper và test được thêm phải có comment ngắn. Framing, ordering, attach compensation và termination escalation có inline comment giải thích invariant/race.

## Lỗi

Error public serialize object có `code` camelCase và field payload an toàn. Source chain nội bộ có OS/dependency detail để chẩn đoán nhưng `Display`, tracing và IPC không chứa output, input, command, argument, env, secret, cwd, PID hoặc raw OS message.

```rust
pub enum TerminalError {
    UnauthorizedWindow,
    InvalidRuntimeId { field: String },
    SessionNotFound { session_id: String },
    TabNotFound { tab_id: String },
    PaneNotFound { pane_id: String },
    PaneNotLaunchable { pane_id: String },
    TerminalAlreadyAttached { pane_id: String, terminal_id: Option<String> },
    ProjectNotFound { project_id: String },
    ProjectUnavailable { project_id: String },
    ProjectLookupFailed,
    ProfileNotFound { profile_id: String },
    ProfileUnavailable {
        profile_id: String,
        reason: TerminalProfileUnavailableReasonDto,
    },
    ProfileLookupFailed,
    InvalidPtySize,
    InvalidSequence { field: String },
    InputOutOfOrder {
        expected_sequence: String,
        received_sequence: String,
    },
    InputTooLarge { max_bytes: u32 },
    TerminalNotFound { terminal_id: String },
    TerminalNotRunning { terminal_id: String },
    OutputReplayUnavailable {
        first_available_sequence: String,
        latest_sequence: String,
    },
    StreamAttachFailed,
    PtyUnavailable,
    PtyOpenFailed,
    ProcessSpawnFailed,
    ProcessIoFailed,
    ResizeFailed,
    TerminationFailed,
    SessionAttachFailed,
    RuntimeShuttingDown,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Caller không phải main window. | Từ chối thao tác, không retry từ window khác. |
| `InvalidRuntimeId` | Session/tab/pane/terminal/profile ID sai format hoặc prefix. | Refresh state; không tiếp tục thao tác với target không hợp lệ. |
| `SessionNotFound`, `TabNotFound`, `PaneNotFound` | Target đã bị đóng hoặc quan hệ parent-child sai. | Refresh Sessions và dispose pending view. |
| `PaneNotLaunchable` | Pane không còn là matching ToolSelection. | Không spawn; render content mới từ Sessions. |
| `TerminalAlreadyAttached` | Pane đã có terminal hoặc launch gate. | Dùng terminal ID trong session snapshot thay vì start lần hai. |
| `ProjectNotFound` | Project bị remove trước launch. | Điều hướng/refresh project. |
| `ProjectUnavailable` | Root missing/inaccessible/removal gate. | Giữ picker, hiển thị Locate folder. |
| `ProjectLookupFailed` | BE-003/platform query lỗi đã làm sạch. | Lỗi launch chung có retry. |
| `ProfileNotFound` | Profile bị xóa trước launch. | Refresh tool picker. |
| `ProfileUnavailable` | Command, shell hoặc credential không resolve ngay trước launch; `reason` phân biệt command missing, shell missing, credential missing và credential store/read tạm lỗi. | Command: Check again; shell: chọn shell; credential missing: mở editor nhập lại; credential store unavailable: giữ picker và cho retry. |
| `ProfileLookupFailed` | BE-006 lỗi nội bộ đã làm sạch. | Lỗi launch chung có retry. |
| `InvalidPtySize` | Grid ngoài giới hạn hoặc chưa đo. | Chờ WTerm ready/resize hợp lệ rồi start/resize lại. |
| `InvalidSequence` | Sequence không parse, overflow hoặc lớn hơn server state. | Reset client transport từ snapshot/subscription. |
| `InputOutOfOrder` | Input sequence khác expected. | Giữ input queue và nối lại từ ack; không tự tăng sequence. |
| `InputTooLarge` | Chunk trên 64 KiB. | Chia paste thành chunk nhỏ và await từng ack. |
| `TerminalNotFound` | Runtime đã dispose hoặc ID stale. | Dispose WTerm registry entry và refresh session. |
| `TerminalNotRunning` | Input/resize sau exit/close. | Đưa terminal về read-only, giữ scrollback. |
| `OutputReplayUnavailable` | Sequence cần replay đã bị ring evict; payload error chứa first/latest string. | Không áp tail sai trạng thái; giữ core cũ hoặc hiển thị stream recovery error. |
| `StreamAttachFailed` | Không tạo/swap sender worker được. | Giữ process chạy và cho subscribe lại. |
| `PtyUnavailable` | Native PTY/ConPTY không có trên OS hỗ trợ. | Hiển thị yêu cầu hệ điều hành; không fallback pipe. |
| `PtyOpenFailed` | `openpty` thất bại. | Giữ ToolSelection và cho retry. |
| `ProcessSpawnFailed` | `spawn_command` hoặc process-tree attach thất bại. | Giữ ToolSelection, hiển thị launch failure đã làm sạch. |
| `ProcessIoFailed` | Reader/writer/wait lỗi sau spawn. | Terminal read-only/failed; cho close, không tự restart. |
| `ResizeFailed` | Native PTY từ chối resize. | Giữ size ack cũ, debounce rồi retry khi layout ổn định. |
| `TerminationFailed` | Deadline hết nhưng process tree chưa xác nhận dừng. | Không xóa target Sessions; dialog giữ mở và cho retry/diagnostic. |
| `SessionAttachFailed` | Pane đổi/đóng giữa spawn và attach. | Refresh Sessions; backend đã cleanup process vừa spawn. |
| `RuntimeShuttingDown` | Quit đã bắt đầu. | Không retry; tiếp tục luồng Quit. |

## Luồng chính

### Start và attach

1. FE-006/FE-007 đã gọi BE-005 chọn tool, tạo `ToolSelection`, mount FE-008 và đợi Ghostty core cùng first non-zero cell measurement.
2. `start_terminal` đặt pane launch gate, adapter lấy target authoritative từ Sessions, rồi gọi BE-003 lấy current root và BE-006 lấy `ResolvedCliProfile`.
3. Worker mở PTY đúng initial size, dựng `CommandBuilder` bằng executable/args/env/cwd tách biệt, spawn child, drop slave và attach process-tree guard.
4. Manager tạo terminal ID, reader/control/dispatcher/sender và kích hoạt subscriber Channel ngay vào pending WTerm core; runtime chưa được publish vào index command công khai cho tới khi attach thành công.
5. Adapter gọi `attach_runtime_content`. Thành công: manager publish runtime, activity running và trả DTO. Thất bại: terminate/drain/dispose rồi trả `SessionAttachFailed`; pane vẫn theo Sessions authority và FE dispose pending core đã nhận output.

### Output, input và resize

1. Reader thread blocking đọc master PTY vào chunk tối đa 32 KiB và `blocking_send` vào một bounded dispatcher queue; EOF gửi marker riêng.
2. Dispatcher tuần tự cấp output sequence, cập nhật replay ring/attention scanner, enqueue raw frame cho sender và coalesce lời gọi `SessionManager::record_pane_output` sang BE-005.
3. FE global terminal registry nhận ArrayBuffer, kiểm header/sequence rồi gọi WTerm `write(Uint8Array)`; pane DOM có thể không mount nhưng core/channel vẫn sống.
4. WTerm `onData` được FE đánh input sequence; frontend serialize command theo ack. Control actor ghi chunk đúng thứ tự và clear attention khi thành công.
5. ResizeObserver/WTerm `onResize` debounce phía frontend; backend nhận monotonic resize sequence, coalesce size mới và ack sau native resize.

### Process exit và attention

1. Wait/control worker ghi nhận exit status; reader tiếp tục tới EOF để không bỏ output cuối.
2. Dispatcher xử lý EOF, chốt final sequence. Manager chuyển `Exited`/`Failed`, gọi `SessionManager::update_pane_activity` và phát state event kèm final sequence.
3. BEL/OSC notification hợp lệ khi process running bật attention, gọi `SessionManager::update_pane_activity` và phát event. Focus/đọc prompt gọi acknowledge hoặc input thành công tự clear qua cùng owner API.
4. Process đã exit giữ PTY output/WTerm state tới khi pane/tab/session bị close; không tự xóa pane hoặc khởi chạy lại.

### Close, reopen và Quit

1. BE-005 gọi lifecycle router lấy impact. Running terminal góp một process label bằng profile display name; exited terminal góp zero blocker.
2. Sau confirmation, router gọi close. Manager chuyển `Closing`, escalation ETX → close → process-tree force kill theo deadline, chờ reader EOF/final sequence.
3. `ReopenLastTab` giữ stopped entry và token; `Discard` giải phóng ngay. Sessions chỉ commit layout/remove sau delegate thành công.
4. Reopen dùng token trả lại cùng `PaneContentRef::Terminal`; FE registry remount cùng Ghostty core. Không gọi project/profile/spawn.
5. Quit BE-001 → BE-005 `shutdown_all` → lifecycle router đóng mọi terminal. Terminal shutdown gate/fallback cleanup xử lý cả launch chưa attach; chỉ khi không còn process sống app mới thoát.

## Ràng buộc kỹ thuật

- Blocking: `openpty`, `spawn_command`, master read/write/resize, child wait/kill, Job Object/process-group và `Channel::send` chạy trên dedicated worker/`spawn_blocking`, không trên async worker. Long-lived PTY reader/control/sender dùng named OS threads; Tokio task chỉ điều phối bounded queues và dependency futures.
- Bảo mật: Không log terminal input/output, command, args, env, secret, cwd hay PID. Không dùng `CommandBuilder` từ chuỗi shell; mỗi arg/env/cwd gọi API riêng. Chỉ main window gọi command. Channel raw frame chỉ tới callback do same main webview cung cấp; không local socket/WebSocket.
- Hiệu năng: Read/frame tối đa 32 KiB; reader→dispatcher queue 64 item; sender queue 256 frame; replay 8 MiB/1024 frame mỗi terminal. Bốn terminal đồng thời phải nhận input, output burst và resize ổn định; dispatcher không clone buffer ngoài ring + active sender frame.
- Concurrency: Launch gate theo pane; runtime state transition đơn điệu `Running → Closing/Exited/Failed → Retained/Disposed`. Control actor tuần tự input/resize/close; dispatcher tuần tự output. Không giữ manager/session lock qua dependency await, PTY blocking call hoặc Channel send.
- WTerm: FE-008 phải instantiate `GhosttyCore` rõ ràng, không dùng Zig core mặc định và không dùng `WebSocketTransport`; raw bytes đi qua `write(Uint8Array)`. Find toàn scrollback dùng Ghostty core `getScrollbackCount`/cell APIs cùng visible grid, không chỉ browser find trên DOM mounted. Link không phải OSC 8 cần FE nhận diện riêng. CSP `'wasm-unsafe-eval'` và embedded WASM phải pass cả dev/prod build.
- Terminal compatibility: Test Windows WebView2 cho Codex, Claude, default shell, alternate screen, mouse tracking/SGR, synchronized output, Unicode/wide/emoji, Vietnamese IME, clipboard, bracketed paste, full-scrollback find, link và resize. macOS PTY/process-group validation hoãn tới release preparation.
- Failure policy: Không auto-restart CLI/process. Channel disconnect không dừng process; PTY I/O/process failure không xóa output đã có. Error/detail chỉ an toàn, có action retry/close phù hợp.

## Tiêu chí hoàn thành

- [ ] `start_terminal` chỉ spawn từ matching `ToolSelection`, root BE-003 và profile BE-006; race attach cleanup không để process/PTY orphan.
- [ ] Windows 10 1809+ dùng ConPTY qua `portable-pty 0.9.0`; unsupported/open/spawn failures giữ pane picker và trả đúng typed error.
- [ ] Terminal built-in mở interactive shell; Codex/Claude/custom chạy executable/args/env/cwd tách biệt và profile secret không xuất hiện trong log/error/DTO.
- [ ] Raw Channel frame đúng header/version/length; sequence liên tục dưới output burst/split Unicode/ANSI và callback cố ý reorder vẫn chỉ được ghi vào WTerm theo thứ tự; không terminal byte nào đi qua Tauri event thường.
- [ ] Subscriber thay/replay giữ thứ tự replay-before-live; Channel failure không dừng process; gap ngoài 8 MiB/1024-frame window trả `OutputReplayUnavailable` thay vì silently corrupt WTerm.
- [ ] Input sequence/ack ngăn reorder/duplicate, nhận control sequence và large paste chunked; input sau exit không ghi.
- [ ] Resize dùng measured cell grid, reject zero/out-of-range, coalesce last-write-wins và giữ ổn định khi kéo 1–4 pane/maximize/restore.
- [ ] Switching session/project, hiding to tray và maximizing pane không dừng process hoặc dispose WTerm registry; background output cập nhật unseen status BE-005.
- [ ] BEL/OSC notification, input và acknowledge cập nhật attention đúng; output keyword bình thường không tạo false positive.
- [ ] Natural exit chỉ publish sau reader drain, exit `0`/nonzero map finished/failed BE-005 đúng và final sequence giúp frontend chờ output cuối.
- [ ] Close pane/tab/session/remove project/Quit dừng đúng process tree; Windows child fixture không còn sống sau Job Object cleanup; timeout giữ Sessions target để retry.
- [ ] Close tab retain một terminal stopped; reopen giữ cùng ID/output, không spawn; evict/delete/Quit discard token/ring/core state.
- [ ] WTerm 0.3.4 dùng Ghostty core/WASM embedded, không WebSocketTransport; alternate screen, mouse, synchronized output, Unicode/emoji/IME/clipboard/find/link pass Windows WebView2 checklist.
- [ ] Generated binding `src/bindings/terminal/` khớp Rust DTO/error và không được sửa tay; CSP production/dev vẫn chỉ nới `'wasm-unsafe-eval'` cần thiết.
- [ ] Mọi function/method/callback/helper/test mới có comment; framing/attach compensation/termination escalation có inline invariant comment.
- [ ] `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` và toàn bộ Rust test pass trên Windows.
- [ ] Frontend formatter/lint/typecheck/unit test và `tests/e2e/terminal.e2e.ts` pass; `pnpm tauri build` Windows pass vì feature thay IPC Channel, process integration, binding và desktop runtime.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/terminal/models.rs` (`#[cfg(test)]`) | Unit | ID/sequence/size validation, DTO/error camelCase và redaction. |
| `src-tauri/src/terminal/stream.rs` (`#[cfg(test)]`) | Unit | Frame codec, split bytes, monotonic sequence, replay boundary/gap, replay-before-live, slow/dropped subscriber và BEL/OSC scanner xuyên chunk. |
| `src-tauri/src/terminal/pty.rs` (`#[cfg(test)]`) | Unit | `CommandBuilder` executable/arg/env/cwd tách biệt, PTY worker state, input/resize ordering, wait/EOF rendezvous và escalation qua fake. |
| `src-tauri/src/terminal/manager.rs` (`#[cfg(test)]`) | Unit | Launch/attach compensation race, pane gate, dependency mapping, activity, orphan cleanup, retain/reopen/discard idempotence và shutdown gate. |
| `src-tauri/src/platform/process_tree.rs` (`#[cfg(test)]`) | Unit | Job/process-group adapter mapping, deadline/escalation và safe error payload bằng fake handles. |
| `src-tauri/tests/terminal_runtime.rs` | Integration | Sáu commands qua Tauri mock, raw Channel capture/order/replay, pending-attach event suppression, stream detach/resubscribe, input/resize ack, state event/final sequence và fake Sessions/Projects/Profiles contracts. |
| `src-tauri/tests/terminal_pty_windows.rs` | Integration Windows | ConPTY thật với fixture: Unicode/chunk, input/control, resize, exit code, burst/backpressure, four-terminal stability và child-tree kill. |
| `src-tauri/tests/app_builder.rs` | Smoke | Terminal manager/router late bind đúng một lần, state/commands đăng ký và mock builder không tạo PTY lúc setup. |
| `src-tauri/tests/export_bindings.rs` | Contract | Export DTO/event/error BE-007 vào `src/bindings/terminal/`, fail khi drift và không sinh type cho raw Channel frame. |
| `tests/e2e/terminal.e2e.ts` | Desktop E2E Windows | Codex/Claude/shell, 1–4 pane, background/tray, WTerm Ghostty, alternate screen, mouse, synchronized output, Unicode/emoji/IME, clipboard, find/link, resize, close/reopen/Quit. |

Test tự động không dùng project đang phát triển, credential thật hoặc command người dùng. Integration tạo temporary project root/profile fixture; mọi child/process tree có teardown force-kill và assertion không còn sống. Compatibility với Codex/Claude thật là manual smoke có điều kiện khi CLI đã cài, không làm CI thất bại trên runner thiếu CLI.

## Quyết định và giả định đã chốt

- Chọn raw Tauri Channel frame có sequence thay cho DTO chứa `Vec<u8>` để tránh JSON-array overhead và vẫn phát hiện/replay gap; state tần suất thấp dùng event riêng.
- Chọn FE terminal registry sống độc lập DOM pane để thỏa background/reopen/full scrollback; backend ring chỉ là recovery window có giới hạn, tránh giữ output không giới hạn hai lần.
- Chọn spawn sau first measured resize thay vì `80x24` tạm để tránh prompt/reflow thừa và phù hợp hành vi deferred PTY spawn của WTerm.
- Chọn input sequence + ack vì nhiều invoke bất đồng bộ không tự tạo total order; resize dùng sequence last-write-wins vì intermediate size không có giá trị nghiệp vụ.
- Chọn direct `CommandBuilder` cho CLI và shell hint environment: đây là cách duy nhất giữ command/args/env tách biệt xuyên tới OS spawn, tránh quote/injection qua shell string. Shell profile Terminal vẫn spawn interactive trực tiếp.
- Cụm “profile dùng shell mặc định/riêng” trong BE-006 được chốt ở đây theo nghĩa shell context: Terminal spawn shell đó, còn CLI spawn trực tiếp và nhận `COMSPEC`/`SHELL` tương ứng. Không cho selected shell parse command người dùng, vì cách đó sẽ mâu thuẫn yêu cầu TechStack và wireframe rằng arguments không được ghép thành shell string.
- Chọn BEL/OSC 9/777 làm attention signal thay vì đoán keyword hoặc timeout; ưu tiên không báo sai khi chưa có protocol riêng từ từng AI CLI.
- Chọn ETX + deadline + Windows Job Object/macOS process group để vừa cho CLI thoát có kiểm soát vừa bảo đảm close/Quit không treo vô hạn hoặc bỏ child process.
- Chọn một lifecycle router late-bind bằng `Weak` ở composition root để thỏa hai chiều tích hợp Terminal↔Sessions mà không tạo dependency implementation hoặc reference cycle.
- Wireframe `panes-max` có ba pane ẩn vẫn chạy và `sidebar-sessions` có running/unseen/attention/finished/error là observable contract; layout, badge visual và close dialog vẫn do FE-007/BE-005 sở hữu.

## Câu hỏi mở

- Không có.
