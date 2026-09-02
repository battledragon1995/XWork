# BE-017 — Quick Note window

Tài liệu này đặc tả contract backend cho cửa sổ Quick Note nổi, các điểm mở từ cửa sổ chính, system tray và phím tắt toàn cục, cùng trình tự lưu note thật rồi đóng cửa sổ.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-017` |
| Phase | `3` |
| Capability | `src-tauri/src/app/`, `src-tauri/src/platform/`; dùng public Notes contract tại `src-tauri/src/notes/` |
| Yêu cầu chức năng | §5.1, §5.3, §12.3, §16, §17.4, §18, §20 Phase 3 |
| Frontend liên quan | `FE-001`, `FE-002`, `FE-003`, `FE-014`, `FE-020` |
| Phụ thuộc | `BE-001`, `BE-009`, `BE-016`; project picker dùng public `list_projects` đã có qua dependency bắc cầu của BE-016, BE-017 không đọc Projects internals |

## Mục tiêu

XWork có đúng một cửa sổ `quick-note` tạo lười, đưa ra trước ứng dụng đang dùng khi người dùng gọi từ main window, tray hoặc global shortcut. Cửa sổ chỉ có quyền IPC tối thiểu, dùng `create_note` của BE-016 để persist dữ liệu và chỉ đóng sau khi create thành công.

### Ngoài phạm vi

- Không tạo editor/persistence Notes thứ hai, không đọc hoặc ghi bảng `notes` từ `app`/`platform`, và không thay đổi validation `CreateNoteInputDto` của BE-016.
- Không persist draft, vị trí, kích thước hoặc trạng thái focus của cửa sổ. Quick Note draft là state tạm của FE-020 và bị bỏ khi Cancel, Close hoặc Quit XWork.
- Không mở nhiều Quick Note độc lập, không đưa Quick Note vào tab/pane và không biến XWork thành ứng dụng nhiều cửa sổ làm việc.
- Không cấp global-shortcut, filesystem, shell, opener, dialog hoặc window plugin API cho WebView. Đăng ký shortcut và mọi thao tác native window chạy trong Rust qua command hẹp.
- Không làm global shortcut hoạt động sau khi người dùng chọn `Quit XWork`; shortcut chỉ tồn tại khi process XWork còn chạy, kể cả khi `main` đang ẩn xuống tray.
- Không thay thế Quick Note composer nhúng trên Home. Composer đó gọi `create_note` từ `main`; BE-017 chỉ bổ sung hành động mở biến thể floating theo roadmap giai đoạn 19.

### Quyết định và giả định đã chốt

- Label cửa sổ cố định là `quick-note`; một process có tối đa một instance. Trigger lặp chỉ show, unminimize và focus instance hiện có, giữ nguyên draft đang nhập.
- Cửa sổ được tạo lười thay vì khai báo một WebView ẩn lúc startup. Điều này tránh giữ renderer thứ hai khi không dùng và vẫn cho mọi trigger dùng cùng controller.
- Cửa sổ mặc định `560 × 420` logical pixel, min `420 × 300`, resizable, không maximize/minimize, không decoration, có shadow, luôn trên cùng và không tạo taskbar item riêng. Kích thước đủ cho Markdown/project picker, còn resize giữ khả năng tiếp cận khi UI font lớn.
- Cancel, `Escape`, custom Close và native `CloseRequested` đều là hành động bỏ draft ngay, không hỏi lại. Đây là quyết định có chủ ý vì wireframe gọi rõ `Esc cancel`; draft chưa persist và nút dùng nhãn cụ thể. Khi Save đang gửi, FE disable Cancel/Save; nếu native close vẫn thắng race thì create đã bắt đầu được phép hoàn tất.
- Save không có command BE-017 riêng. FE-020 gọi đúng `create_note` của BE-016 từ caller `quick-note`, nhận `NoteDto`, đánh dấu draft đã commit rồi mới gọi `close_quick_note_window`. Cách này giữ một owner cho validation/persistence và ngăn app coordinator gọi repository Notes.
- Nếu note đã commit nhưng close lỗi, FE giữ `NoteDto`, disable Save để không tạo duplicate, hiển thị `Note saved, but the window could not close.` và chỉ cho Retry Close. Không retry `create_note`.
- BE-009 thêm đúng action `quick_note.open_global` và publish snapshot qua `watch`. BE-017 là consumer duy nhất đăng ký OS chord; WebView không dùng guest JavaScript global-shortcut package.
- Conflict trong catalog BE-009 vô hiệu hóa đăng ký toàn cục nhưng không vô hiệu hóa tray/Home/Welcome. Lỗi OS vì chord bị ứng dụng khác chiếm là trạng thái fail-soft: app vẫn startup, tray item vẫn hoạt động và FE-014 nhận status typed để người dùng đổi shortcut.
- Tray chỉ hiển thị accelerator khi chord thực sự đang được BE-017 đăng ký. Nếu conflict hoặc OS registration không khả dụng, item `Quick Note` vẫn enabled nhưng không hiển thị accelerator gây hiểu nhầm.
- FR §12.3 và wireframe Home chỉ thể hiện composer nhúng, trong khi roadmap giai đoạn 19 và yêu cầu hiện tại nói cửa sổ phải mở từ Home. Chốt bổ sung một affordance `Open Quick Note window` thuộc FE-003/020, không xóa hoặc đổi hành vi Save của composer nhúng. Welcome action `Open Quick Note` dùng cùng command.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo exact Rust dependency `tauri-plugin-global-shortcut = "=2.3.2"` cho desktop; không thêm guest JavaScript package |
| `src-tauri/Cargo.lock` | Khóa dependency/plugin transitive của global shortcut |
| `src-tauri/src/lib.rs` | Export platform cần thiết và giữ `app::configure` là composition root duy nhất |
| `src-tauri/src/app/mod.rs` | Đăng ký plugin handler, khởi tạo `QuickNoteController`, spawn shortcut watcher, manage state và đăng ký command |
| `src-tauri/src/app/quick_note.rs` | Window policy/state machine, DTO/error, command, status reconciliation và open/close orchestration |
| `src-tauri/src/app/tray.rs` | Thêm stable menu ID `quick_note`, accelerator active và dispatch mở cửa sổ đúng vị trí contract BE-001 |
| `src-tauri/src/app/lifecycle.rs` | Giữ close-to-tray chỉ áp dụng `main`, công khai shutdown guard nội bộ để Quick Note từ chối open khi đang Quit |
| `src-tauri/src/platform/mod.rs` | Export adapter global shortcut dùng bởi app composition |
| `src-tauri/src/platform/global_shortcut.rs` | Chuyển `ShortcutChordDto` sang OS shortcut, register/unregister và seam test không chứa rule Quick Note |
| `src-tauri/src/settings/mod.rs` | Re-export public snapshot/watch của Keyboard Shortcuts cho app composition |
| `src-tauri/src/settings/keyboard_shortcuts.rs` | Thêm catalog action Phase 3 `quick_note.open_global` và `subscribe()` đúng contract BE-009; không đổi schema |
| `src-tauri/src/notes/commands.rs` | Giữ authorization `create_note` cho đúng caller `main` hoặc `quick-note`; mọi command Notes khác vẫn từ chối window này |
| `src-tauri/tauri.conf.json` | Giữ static window duy nhất là `main`, thêm capability identifier `quick-note` vào security list |
| `src-tauri/capabilities/main.json` | Giữ permission list hiện hành, không cấp global-shortcut hoặc window plugin API cho main WebView |
| `src-tauri/capabilities/quick-note.json` | Capability rỗng, scope đúng window label `quick-note`; custom commands vẫn tự authorize caller |
| `package.json` | Giữ frontend dependency không có guest package global-shortcut vì plugin chỉ được gọi từ Rust |
| `src-tauri/src/bin/export_bindings.rs` | Đăng ký status/error DTO BE-017 với binding generator |
| `src/bindings/quick-note-window.ts` | Binding TypeScript aggregate sinh từ Rust; không sửa thủ công |
| `src-tauri/tests/quick_note_window.rs` | Integration test window command, singleton, caller boundary, status/event và Notes save-close bằng test runtime |
| `src-tauri/tests/keyboard_shortcuts_contract.rs` | Mở rộng Phase 3 cho catalog/watch `quick_note.open_global` và conflict projection |
| `src-tauri/tests/app_lifecycle.rs` | Regression close `main` không đóng Quick Note, close Quick Note không hide-to-tray và Quit chặn open mới |
| `src-tauri/tests/app_builder.rs` | Smoke test plugin/controller/tray/command/capability được ghép đúng một lần và đúng thứ tự |
| `src-tauri/tests/export_bindings.rs` | Contract test binding trên đĩa khớp Rust source |
| `tests/e2e/quick-note.e2e.ts` | Desktop E2E Windows cho open/reuse/focus, Cancel, invalid, project link, save-close và mở lại draft rỗng |
| `tests/e2e/home.e2e.ts` | Regression composer nhúng và điểm mở floating window trên Home/Welcome |
| `tests/e2e/settings-keyboard-shortcuts.e2e.ts` | Regression action Global, conflict, đổi/reset chord và status unavailable |

Không tạo migration và không thêm dependency vào `package.json`: plugin chỉ được gọi từ Rust nên WebView không cần `@tauri-apps/plugin-global-shortcut`. `src-tauri/capabilities/main.json` tiếp tục không có global-shortcut permission.

## Dữ liệu

BE-017 không tạo bảng hoặc migration. Runtime state gồm:

- lifecycle cửa sổ `Absent | Opening | Open | Closing`;
- handle/generation của operation mở gần nhất để coalesce trigger đồng thời;
- chord OS đang đăng ký, nếu có;
- `QuickNoteGlobalShortcutStatusDto` hiện hành và sequence trong process;
- task subscription snapshot BE-009.

Toàn bộ state bị loại khi process kết thúc. Draft title/content/project chỉ nằm trong React state của window và không được chuyển vào controller, log hoặc event.

### Window contract

| Thuộc tính | Giá trị bắt buộc |
|---|---|
| Label | `quick-note` |
| URL app | `index.html?window=quick-note`; FE bootstrap chọn `QuickNoteWindow` bằng query literal, không nhận URL từ IPC |
| Title | `XWork Quick Note` |
| Initial / minimum size | `560 × 420` / `420 × 300` logical pixel |
| Visibility / focus | Tạo visible, center, show và focus từ explicit trigger |
| Z-order | `always_on_top = true` khi window tồn tại |
| Chrome | `decorations = false`, `shadow = true`, `resizable = true`, `maximizable = false`, `minimizable = false` |
| Taskbar | `skip_taskbar = true`; tray/main là entry ứng dụng |
| Instance policy | Tối đa một window cho exact label; không thêm suffix hoặc random label |
| Close policy | Destroy window và draft; không hide, không áp handler close-to-tray của `main` |

Window được tạo bằng `WebviewWindowBuilder` từ app-owned URL literal. Không nhận label, URL, kích thước, position, title hoặc flags từ frontend.

### Capability contract

`src-tauri/capabilities/quick-note.json` phải tương đương:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "quick-note",
  "description": "Keeps the Quick Note window on custom, caller-authorized commands only.",
  "windows": ["quick-note"],
  "permissions": []
}
```

`tauri.conf.json` giữ `app.windows` chỉ có `main` và đổi `app.security.capabilities` thành `["main", "quick-note"]`. Không thêm `global-shortcut:allow-*` vì register/unregister chạy bằng Rust API; không thêm core window permission vì drag/close dùng custom command đã khóa caller.

## DTO public

`ShortcutChordDto` được tái sử dụng nguyên contract BE-009. Các type dưới đây thuộc BE-017, struct serialize `camelCase`, enum serialize `snake_case`; sequence là decimal string để an toàn với JavaScript.

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum QuickNoteGlobalShortcutStateDto {
    Active,
    DisabledByConflict,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct QuickNoteGlobalShortcutStatusDto {
    pub sequence: String,
    pub action_id: String,
    pub chord: ShortcutChordDto,
    pub state: QuickNoteGlobalShortcutStateDto,
    pub conflicts_with: Vec<String>,
}
```

`actionId` luôn là `quick_note.open_global`. `Active` yêu cầu `conflictsWith` rỗng và chord hiện được process này đăng ký. `DisabledByConflict` yêu cầu danh sách khác rỗng, sort theo catalog BE-009. `Unavailable` yêu cầu danh sách rỗng nhưng conversion/plugin/OS registration thất bại; payload không chứa tên process khác hoặc raw OS error.

Sequence là `u64` trong controller, bắt đầu `0`, tăng trước mỗi status thực sự đổi và serialize decimal string; không persist qua restart. Cùng chord/state/conflicts là no-op, không tăng sequence hoặc phát event.

## Contract Rust nội bộ

Platform adapter không import `app`, `settings` hoặc `notes`:

```rust
pub(crate) struct PlatformShortcut {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub key_code: PlatformShortcutCode,
}

pub(crate) trait GlobalShortcutPlatform: Send + Sync {
    /// Registers one process-owned shortcut with the plugin handler already installed.
    fn register(&self, shortcut: &PlatformShortcut) -> Result<(), GlobalShortcutPlatformError>;

    /// Unregisters one shortcut previously requested by this process.
    fn unregister(&self, shortcut: &PlatformShortcut) -> Result<(), GlobalShortcutPlatformError>;
}
```

`PlatformShortcutCode` bao phủ chính xác allowlist `key_code` của BE-009; conversion là exhaustive và phân biệt casing. `primary` map sang `CONTROL` trên Windows, `SUPER` trên macOS; `alt`/`shift` map trực tiếp. Adapter thật dùng `tauri_plugin_global_shortcut::GlobalShortcutExt`; handler builder nhận `ShortcutEvent` và chỉ chuyển trạng thái `Pressed` đến controller.

BE-009 `subscribe()` trả ngay snapshot hiện hành rồi dùng `tokio::sync::watch`. App composition chỉ tìm exact action ID `quick_note.open_global`; thiếu action ở binary Phase 3 là lỗi cấu hình startup, không âm thầm dựng default khác trong BE-017.

Reconcile được serialize và có thứ tự:

1. Đọc latest action từ snapshot; bỏ snapshot trung gian nếu watch đã có bản mới hơn.
2. Nếu action conflict/`is_dispatchable = false`, unregister chord active, cập nhật `DisabledByConflict` và bỏ accelerator tray.
3. Nếu desired chord giống chord active và status `Active`, no-op.
4. Nếu chord đổi, vô hiệu hóa generation handler cũ trước, unregister chord cũ rồi mới register chord mới. Nếu unregister lỗi, không register mới; event từ chord cũ bị handler bỏ vì generation không active.
5. Register thành công đặt status `Active` và cập nhật tray accelerator. Register/conversion lỗi đặt `Unavailable`, không accelerator và không làm startup/shortcut mutation BE-009 thất bại ngược.
6. Sau status commit trong memory, rebuild tray nếu model đổi và emit status event đến `main`. Event/tray lỗi được log theo category nhưng không đổi registration đã thành công.

Controller chỉ mở window khi shortcut event có state `Pressed`, chord/generation đúng status `Active` và app chưa `ShuttingDown`. `Released`, key repeat/coalesced Pressed hoặc callback stale không tạo thêm window.

## Tauri command

Command nhận invoking `WebviewWindow` thay vì label từ frontend. Window operation được điều phối trên main thread; command clone handle/state cần thiết trước mọi `.await` và không giữ mutex guard qua main-thread dispatch.

### `open_quick_note_window`

Mở hoặc đưa singleton Quick Note hiện có ra trước từ Welcome/Home.

```rust
/// Opens or focuses the singleton Quick Note window.
#[tauri::command]
pub async fn open_quick_note_window(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, QuickNoteController>,
) -> Result<(), QuickNoteWindowError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; lifecycle app chưa `ShuttingDown`; không nhận window option từ frontend |
| Side effect | Nếu absent, create singleton theo Window contract; nếu tồn tại, show → unminimize → focus; không show hoặc đổi route `main` |
| Lỗi trả về | `UnauthorizedWindow`, `AppShuttingDown`, `WindowOperationFailed`, `Unavailable` |

Welcome `Open Quick Note` và affordance floating trên Home gọi command này. Composer Home hiện hữu không gọi command: Save tại chỗ vẫn dùng `create_note` caller `main` và clear form theo FE-020.

### `close_quick_note_window`

Đóng Quick Note sau Cancel/Close hoặc sau khi `create_note` trả thành công.

```rust
/// Closes the invoking Quick Note window and discards its renderer state.
#[tauri::command]
pub async fn close_quick_note_window(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, QuickNoteController>,
) -> Result<(), QuickNoteWindowError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `quick-note`; controller handle/generation khớp window hiện hành |
| Side effect | Transition `Open → Closing`, close/destroy native window, rồi `Absent`; không hide `main`, không ghi Notes |
| Lỗi trả về | `UnauthorizedWindow`, `StaleWindow`, `WindowOperationFailed`, `Unavailable` |

Cancel button và `Escape` gọi command trực tiếp. Sau Save, FE phải giữ cờ `committed` trước khi gọi; close lỗi chỉ retry command này.

### `start_quick_note_window_drag`

Bắt đầu native drag từ vùng titlebar custom mà không cấp core window API cho WebView.

```rust
/// Starts dragging the invoking Quick Note window from its custom title bar.
#[tauri::command]
pub fn start_quick_note_window_drag(
    window: tauri::WebviewWindow,
) -> Result<(), QuickNoteWindowError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `quick-note`; chỉ gọi từ primary pointer press trên drag region, FE không gọi từ button/control |
| Side effect | Gọi native start-dragging cho invoking window; không đổi persisted state |
| Lỗi trả về | `UnauthorizedWindow`, `WindowOperationFailed` |

### `get_quick_note_global_shortcut_status`

Trả trạng thái reconcile hiện hành cho FE-014.

```rust
/// Returns the current Quick Note global-shortcut registration status.
#[tauri::command]
pub fn get_quick_note_global_shortcut_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, QuickNoteController>,
) -> Result<QuickNoteGlobalShortcutStatusDto, QuickNoteWindowError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller exact `main`; controller đã hoàn tất initial reconcile |
| Side effect | Không có; clone snapshot memory, không query SQLite hoặc OS |
| Lỗi trả về | `UnauthorizedWindow`, `Unavailable` |

Quick Note WebView không được gọi command status hoặc ba command mutation shortcut của BE-009.

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `quick-note://global-shortcut-status-changed` | `QuickNoteGlobalShortcutStatusDto` | Sau initial reconcile nếu main đã tồn tại và sau mỗi status thực sự đổi | Chỉ emit đến `main`, theo thứ tự sequence của reconciler; không phát cho snapshot/no-op trùng; consumer re-query command khi mount/focus |

Không phát event opened/closed/saved và không dùng Channel. `notes://changed` với `NoteChangeKindDto::Created` của BE-016 là nguồn invalidation duy nhất sau Save; FE-003/005/019 re-query theo contract Notes.

## Business rule và invariant

1. Chỉ label exact `quick-note` được tạo; lookup label trước build và state machine serialize mọi trigger để race global/tray/main không tạo hai WebView.
2. Trigger khi window `Opening` được coalesce thành một yêu cầu focus sau create; trigger khi `Open` không clear title/content/project; trigger khi `Closing` chạy lại sau transition và chỉ tạo instance mới nếu close đã hoàn tất.
3. Trigger từ tray/global không show, focus hoặc điều hướng `main`. Đóng/hide `main` không đóng Quick Note; đóng Quick Note không hide/exit XWork.
4. Quick Note luôn on-top khi tồn tại, nhưng chỉ explicit trigger được phép lấy focus. Không timer hoặc background event tự focus window.
5. Cancel/Escape/Close destroy renderer và draft. Mở lại luôn có title/content rỗng và project unlinked; không khôi phục draft sau crash/restart.
6. FE Save phải gọi `create_note(CreateNoteInputDto)` trước close. Empty body/title-only, title/content limit và project race dùng đúng typed `NotesError`; lỗi giữ window/draft mở.
7. Chỉ response create thành công mới cho phép close-by-save. `notes://changed` đã phát sau commit trước khi FE gọi close; note xuất hiện ở Notes/Home/project dù close sau đó lỗi.
8. Khi save response thành công, cùng renderer không được gọi create lần hai. Retry chỉ gọi close; E2E phải chứng minh close failure giả không tạo duplicate.
9. Project dropdown dùng `list_projects(None)` public và gửi optional project ID vào BE-016. Project unavailable vẫn được chọn theo Notes contract; project bị remove trong race trả `ProjectNotFound`, clear/reload option theo FE.
10. Action global duy nhất là `quick_note.open_global`, default `Primary+Shift+KeyN`: `Ctrl+Shift+N` Windows, `Command+Shift+N` macOS. Không đăng ký shortcut application-scope nào bằng plugin.
11. Mọi action trong conflict group BE-009 không dispatchable. BE-017 unregister chord trước đó và không chọn action thắng; tray/Welcome/Home vẫn mở được window.
12. Chỉ một chord OS active tại một thời điểm. Handler kiểm exact chord và generation trước open, nên unregister failure không làm chord cấu hình cũ tiếp tục hoạt động về mặt nghiệp vụ.
13. Register error do chord bị ứng dụng khác chiếm hoặc platform failure không rollback override BE-009 và không fail startup. Status `Unavailable` không tự nêu tên ứng dụng khác; FE yêu cầu đổi/reset chord hoặc restart để retry.
14. Subscription bắt đầu sau plugin handler, NotesService, KeyboardShortcutsService và tray controller đã sẵn sàng. Tray item `Quick Note` chỉ được công bố sau controller có thể xử lý click.
15. Tray order giữ nguyên BE-001: `Open XWork`, `Quick Note`, separator, optional `Needs attention`, separator, `Quit XWork`. Menu ID không đổi khi accelerator đổi.
16. `CloseRequested` handler BE-001 chỉ prevent/hide `main`. Với `quick-note`, event được phép destroy và controller nhận `Destroyed` để về `Absent`; không có close-to-tray cho window phụ.
17. Khi BE-001 chuyển `ShuttingDown`, mọi trigger mới bị từ chối/ignore; active chord được unregister best-effort và process exit đóng Quick Note. Draft không tham gia `QuitSummaryDto`, đúng contract BE-001.
18. Capability `quick-note` không có permission plugin/core. Caller authorization nằm trong từng custom command; mọi Notes command ngoài `create_note` vẫn trả `UnauthorizedWindow`.
19. Không log title, content, project ID/name, chord raw do người dùng đặt, draft state hoặc raw OS/plugin error. Log chỉ source trigger, operation, status category, duration và error code.
20. Không có network/filesystem/clipboard/shell side effect; CSP hiện hành áp dụng và URL window là app-local literal.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
pub enum QuickNoteWindowError {
    UnauthorizedWindow,
    AppShuttingDown,
    StaleWindow,
    WindowOperationFailed { operation: QuickNoteWindowOperation },
    Unavailable,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum QuickNoteWindowOperation {
    Create,
    Show,
    Unminimize,
    Focus,
    Close,
    StartDragging,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | `main`/`quick-note` gọi command không đúng allowlist | Không retry; sửa boundary integration |
| `AppShuttingDown` | Main gọi open sau khi Quit đã bắt đầu | Không tạo window; để flow Quit tiếp tục |
| `StaleWindow` | Close từ renderer/handle không còn là instance controller hiện hành | Bỏ response cũ; không chạm instance mới |
| `WindowOperationFailed` | Create/show/unminimize/focus/close/drag native lỗi | Giữ state có thể quan sát; cho retry đúng operation, không retry Save đã commit |
| `Unavailable` | Controller lock/task/status chưa sẵn sàng hoặc bị poison | Báo Quick Note tạm không khả dụng; cho retry/restart |

Lỗi register/unregister global shortcut không đi qua command error: nó được chiếu vào `QuickNoteGlobalShortcutStatusDto` và log category an toàn. `NotesError` từ Save giữ nguyên contract BE-016, không wrap hoặc đổi code trong BE-017.

## Luồng chính

### Khởi tạo và shortcut reconcile

1. Composition đăng ký single-instance plugin của BE-001 trước, sau đó global-shortcut plugin với Rust handler; WebView không nhận plugin permission.
2. Storage/migration, NotesService và KeyboardShortcutsService khởi tạo. Catalog Phase 3 phải có `quick_note.open_global` trước khi controller được công bố.
3. App tạo controller, nối tray callback rồi subscribe snapshot BE-009. Initial snapshot được reconcile theo conflict/OS availability.
4. Sau khi handler mở window sẵn sàng, tray thêm item `Quick Note`. Accelerator chỉ lấy từ status `Active`; conflict/unavailable giữ item không accelerator.
5. Watch update sau set/reset/import chạy cùng reconciler serialize. Status memory cập nhật trước tray/event; mutation BE-009 đã commit không bị rollback nếu OS reconcile lỗi.

### Mở từ main, tray hoặc global shortcut

1. Welcome/Home gọi `open_quick_note_window`; tray dispatch stable ID; plugin handler chỉ dispatch `Pressed` của chord/generation active.
2. Controller kiểm app chưa shutdown và khóa lifecycle ngắn để quyết định create/reuse; callback native không chờ I/O hoặc giữ lock qua main-thread operation.
3. Absent tạo window theo contract app-local. Existing window chạy show → unminimize → focus. Main hidden vẫn giữ nguyên hidden.
4. FE-020 mount composer, query project list và focus body/title theo accessibility contract. Trigger lặp chỉ focus lại cùng renderer/draft.

### Save rồi đóng

1. FE-020 giữ draft local, validate sớm để hiển thị lỗi nhưng backend vẫn validate lại.
2. Save disable Save/Cancel, gọi BE-016 `create_note` từ invoking label `quick-note` với title/content/project hiện hành.
3. Validation/persistence lỗi giữ draft và window mở, enable retry phù hợp. Không gọi close.
4. Commit thành công trả `NoteDto` và BE-016 đã phát `notes://changed`. FE đánh dấu committed, không cho create lại, rồi gọi `close_quick_note_window`.
5. Close thành công destroy renderer. Close lỗi hiển thị trạng thái saved và chỉ cho Retry Close; note không bị xóa hoặc tạo lại.

### Cancel, close và Quit

1. Cancel/Escape/custom Close gọi close command; native `CloseRequested` cũng được phép destroy mà không qua main hide handler.
2. Controller nhận close/destroy, chỉ clear generation tương ứng và chuyển `Absent`. Trigger sau đó tạo draft rỗng.
3. Đóng main chỉ hide main; Quick Note vẫn hoạt động. `Open XWork` không đóng hoặc lấy draft từ Quick Note.
4. Quit chuyển app sang `ShuttingDown`, chặn trigger, unregister active shortcut best-effort và exit theo BE-001. Quick draft không persist/khôi phục.

## Ràng buộc kỹ thuật

- Blocking: Không có I/O riêng BE-017. Plugin register/unregister và window create/show/focus/close chạy theo main-thread contract Tauri; callback native chỉ schedule rồi trả. SQLite của `create_note`/BE-009 tiếp tục chạy trong blocking worker theo owner contract.
- Bảo mật: Window label, URL, geometry và shortcut action ID là constant backend. Capability Quick Note rỗng; không guest global-shortcut/window API; caller exact; app-local CSP; no draft/chord/user content log.
- Hiệu năng: Cold open đến focused window p95 dưới `300 ms`, warm trigger p95 dưới `100 ms` trên Windows test machine. Trigger burst 20 lần tạo đúng một window; reconcile O(1) vì chỉ một global action.
- Concurrency: Một lifecycle gate cho create/close và một reconcile gate cho shortcut; không giữ gate qua `.await`/main-thread callback. Generation làm callback/window cũ vô hiệu; shortcut reconcile không gọi ngược BE-009 mutation.
- Platform: Windows 10/11 smoke test global registration, always-on-top, focus, drag, resize, skip-taskbar và tray. macOS dùng Command mapping nhưng kiểm tra native được hoãn đến release preparation.
- Desktop boundary: Thêm official Rust plugin, dynamic WebView, capability, custom commands/event và generated binding nên bắt buộc chạy `pnpm tauri build`.

## Tiêu chí hoàn thành

- [ ] `quick-note` được tạo lười đúng geometry/security contract, singleton qua burst trigger, luôn on-top, resizable/drag được và không tạo taskbar/main route phụ.
- [ ] Welcome, Home affordance, tray và `quick_note.open_global` đều mở/focus cùng instance; trigger lặp giữ draft và main hidden không bị show.
- [ ] Cancel/Escape/custom/native Close destroy draft không hide main; mở lại rỗng; close main không đóng Quick Note.
- [ ] Save gọi đúng BE-016 `create_note`, error giữ draft, success commit/event trước close; close failure không tạo duplicate khi retry.
- [ ] Project list/link dùng public contract; unavailable project hợp lệ, removed race trả `ProjectNotFound`, không truy cập Projects repository/path.
- [ ] Default global chord map `Ctrl+Shift+N` Windows/`Command+Shift+N` macOS; đổi/reset/import snapshot reconcile sau commit mà không cần migration mới.
- [ ] Conflict nội bộ unregister và vô hiệu hóa toàn group; OS registration failure fail-soft/status typed; tray accelerator chỉ xuất hiện khi status Active.
- [ ] Shortcut handler bỏ Released/stale generation, burst không tạo duplicate và chặn mọi open khi app `ShuttingDown`.
- [ ] Tray giữ menu ID/thứ tự BE-001 và chỉ xuất hiện sau handler sẵn sàng; Quick Note không làm thay đổi session/Quit behavior.
- [ ] `quick-note.json` có permission rỗng, `main.json` không có global-shortcut permission, không có guest plugin package hoặc arbitrary window API.
- [ ] Binding sinh từ Rust và contract test phát hiện drift; mọi function/method/callback/helper/test có comment ngắn, race/generation có inline comment invariant.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features`, frontend formatter/linter/typecheck/test và `pnpm tauri build` pass.
- [ ] Desktop E2E pass cho floating/Home/settings boundary; manual smoke xác nhận real global shortcut từ ứng dụng khác, tray native, focus/always-on-top và chord bị process khác chiếm.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/app/quick_note.rs` (`#[cfg(test)]`) | Unit | Lifecycle transition/generation, coalesce burst, operation order, stale close, status sequence, conflict/unavailable và safe logging |
| `src-tauri/src/platform/global_shortcut.rs` (`#[cfg(test)]`) | Unit | Exhaustive key mapping, Primary theo OS, register/unregister failure và stale handler fake |
| `src-tauri/src/app/tray.rs` (`#[cfg(test)]`) | Unit | Stable ID/order, active accelerator, conflict/unavailable bỏ accelerator và click dispatch không show main |
| `src-tauri/tests/quick_note_window.rs` | Integration | Command caller, builder contract, singleton/reuse/focus/destroy, Notes create then close, close-failure no duplicate và status event |
| `src-tauri/tests/keyboard_shortcuts_contract.rs` | Integration | Phase 3 action/default/watch, conflict all-disabled, set/reset/import publish và no migration mới |
| `src-tauri/tests/app_lifecycle.rs` | Integration | Main close độc lập, Quick close không hide, shutdown rejects trigger và draft không vào Quit summary |
| `src-tauri/tests/app_builder.rs` | Integration | Single-instance trước global plugin, services/controller/tray readiness, invoke handler và capabilities register đúng một lần |
| `src-tauri/tests/export_bindings.rs` | Contract | `quick-note-window.ts` khớp DTO/error Rust và tái sử dụng `ShortcutChordDto` đúng binding |
| `tests/e2e/quick-note.e2e.ts` | Desktop E2E Windows | Main/Welcome/Home open, multi-window switch, repeated trigger draft retention, Escape/Cancel, invalid body, linked project, save-close/reopen |
| `tests/e2e/home.e2e.ts` | Desktop E2E Windows | Composer nhúng không bị thay thế; Home floating affordance và saved note refresh đúng |
| `tests/e2e/settings-keyboard-shortcuts.e2e.ts` | Desktop E2E Windows | Global row/default, conflict status text, change/reset chord, unavailable recovery copy |

Window/plugin/platform test dùng adapter và mock runtime deterministic, không đăng ký hotkey thật trong test song song. E2E không tuyên bố mô phỏng được tray context menu hoặc global input ngoài WebView; các hành vi đó có checklist manual Windows với executable thật và một helper process giữ chord. Test không log/fixture nội dung note cá nhân.

## Câu hỏi mở

- Không có.
