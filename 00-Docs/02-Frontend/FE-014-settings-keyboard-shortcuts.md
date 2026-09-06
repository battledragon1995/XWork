# FE-014 — Settings Keyboard Shortcuts

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-014` |
| Phase | `1`; catalog mở rộng theo phase của backend |
| Khu vực chính | `src/features/settings/` |
| Yêu cầu chức năng | §17.4, §18; liên quan §5.2, §9 và §14 của `00-Docs/00-Overview/03-FunctionalRequirements.md` |
| Wireframe | `00-Docs/01-Wireframe/02-AppShell.html#settings-shortcuts` |
| Backend liên quan | `BE-009`; `BE-005` qua handler workspace hiện có; `BE-008` sở hữu settings khác |
| Phụ thuộc | `FE-001`, `FE-011`, `FE-007`, backend `BE-009` |

## Mục tiêu

Người dùng xem, tìm, đổi và khôi phục phím tắt trong Settings. Thay đổi được lưu bởi Rust, cập nhật ngay các handler hiện có và mô tả rõ mọi xung đột, kể cả khi thao tác liên quan bị ẩn bởi bộ lọc.

### Quyết định đã chốt

- Chọn tổ hợp hiện tại mở hộp ghi nhận phím; chỉ `Save` mới lưu. `Cancel` hoặc `Escape` hủy bản nháp.
- Hiển thị mọi action backend trả về. Action chưa có handler vẫn cho cấu hình trước nhưng có nhãn `Not available yet`; không tuyên bố phím đó đang hoạt động.
- Lát cắt này nối bảy handler tab/pane đã có. Không bổ sung handler điều hướng project/session/tab, focus pane hoặc nội dung Command Palette. Đây là giới hạn triển khai đã được người dùng chấp thuận; yêu cầu phím tắt của những action đó hoàn tất cùng feature sở hữu handler.
- Backend là nguồn duy nhất cho catalog, mặc định, `isCustom`, `conflictsWith` và `isDispatchable`. Assignment trùng vẫn lưu; toàn nhóm xung đột tạm ngừng. Không tự chọn action thắng.
- Wireframe là trạng thái sản phẩm cuối: Phase 1 có 18 action của BE-009, chưa có Quick Note hoặc File Explorer. Các dòng previous/next được tách theo action ID của backend. `Split down` mặc định là `Primary+Alt+Backslash`; ví dụ `Ctrl+Shift+Backslash` trong wireframe là override. Thay copy “One of them will not fire” bằng `These shortcuts are inactive until the conflict is resolved.`

### Mở rộng giai đoạn 12 — Phím mở Command Palette

- Theo `FE-009-command-palette.md`, thêm `search.open_command_palette` vào availability của Settings: tám action có handler thay vì bảy, mười action chưa có handler thay vì mười một. Quy định số lượng trong lát cắt ban đầu được thay thế bởi phần mở rộng này.
- Chỉ cập nhật `src/features/settings/settings-keyboard-shortcuts-route.tsx` và `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` trong owner Settings. Catalog 18 action, schema, mutation, defaults và conflict backend giữ nguyên.
- App SearchEntry đọc public useKeyboardShortcuts; chỉ dispatch khi status ready, pending null, platform hợp lệ và action.isDispatchable. Exact chord hiện hành thay default ngay sau commit; loading/refresh/error/conflict không fallback. Tooltip/keycap không quảng bá accelerator stale.
- Handler app-level được phép mở từ input/terminal khi không có modal khác; bỏ IME, AltGraph, repeat và event đã xử lý. Recorder giữ quyền nhận phím; không mở Palette trong recorder. Conflict vẫn ngừng cả nhóm dù action còn lại chưa có handler.
- Bảy action tab/pane đã có handler workspace vẫn được ghi là khả dụng trong Settings, nhưng chưa có public executor trong Palette; FE-009 hiển thị rõ giới hạn riêng này. Không thêm handler previous/next hoặc focus pane trong stage 12.
- Test Settings xác nhận nhãn availability; test app/Search xác nhận override/reset/conflict/focus/terminal. Native Windows smoke stage 8–12 vẫn pending, không cập nhật historical plan.

### Ngoài phạm vi

- Không thêm action, multi-stroke shortcut, nhiều tổ hợp cho một action, thao tác bỏ gán phím hoặc nút giải quyết xung đột tự động.
- Không triển khai FE-009, File Explorer, Quick Note hoặc đăng ký phím toàn cục. BE-017 sở hữu đăng ký global ở Phase 3.
- Không thay schema, DTO, command, migration, permission hay settings General/Appearance. Không ghi localStorage hoặc truy cập OS/database từ component.
- Không thay logic đóng tab/pane, xác nhận mất dữ liệu hoặc giới hạn bốn pane của FE-007/BE-005.

## File liên quan

Các file dưới đây là phạm vi implementation được phép. Binding, wrapper hạ tầng và component nền tảng được ghi rõ khi chỉ dùng lại; không sửa tay generated binding.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/settings/settings-keyboard-shortcuts-route.tsx` | Route, tìm kiếm, bảng nhóm, reset một/toàn bộ và trạng thái tải/lỗi |
| `src/features/settings/shortcut-recorder-dialog.tsx` | Dialog ghi nhận, bản nháp, Save/Cancel và validation copy |
| `src/features/settings/keyboard-shortcuts-state.ts` | Snapshot tạm thời, load/mutation tuần tự và export provider/hook public |
| `src/features/settings/keyboard-shortcuts-provider.tsx` | Context bao shell; mount/focus refresh và cung cấp snapshot cho composition root |
| `src/lib/ipc/keyboard-shortcuts.ts` | Bốn wrapper typed BE-009 |
| `src/lib/ipc/ipc-error.ts` | Dùng lại `invokeCommand` và `IpcCallError` |
| `src/lib/ipc/app-info.ts` | Dùng lại `readAppInfo` để lấy nền tảng qua boundary có sẵn |
| `src/lib/utils/keyboard-shortcuts.ts` | Format chord và normalize/so khớp event dùng chung bởi recorder và workspace; không chứa catalog |
| `src/bindings/keyboard-shortcuts.ts` | DTO/error sinh sẵn từ BE-009, chỉ import |
| `src/components/ui/dialog.tsx` | Dùng lại dialog, focus trap và focus restoration |
| `src/app/app-router.tsx` | Thay placeholder tại `/settings/keyboard-shortcuts` |
| `src/app/app-shell.tsx` | Bao nội dung shell bằng provider |
| `src/app/session-terminal-route.tsx` | Đọc public snapshot settings, truyền props qua entry sessions |
| `src/features/sessions/session-route.tsx` | Nhận và chuyển props shortcut xuống workspace |
| `src/features/sessions/session-workspace.tsx` | Truyền snapshot tới hook và bề mặt hiển thị accelerator |
| `src/features/sessions/use-workspace-shortcuts.ts` | Match cấu hình đã commit; giữ nguyên handler và availability guard |
| `src/features/sessions/workspace-shortcuts.ts` | Thay bảng default bằng adapter ID tới catalog BE-009 |
| `src/features/sessions/session-tab-strip.tsx` | Nhãn phím New tab lấy từ snapshot |
| `src/features/sessions/pane-layout.tsx` | Chuyển props phím qua cây pane |
| `src/features/sessions/session-pane.tsx` | Nhãn chia/đóng/phóng to và hướng dẫn restore lấy từ snapshot |
| `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` | Component test bảng/tìm kiếm/reset |
| `src/features/settings/shortcut-recorder-dialog.test.tsx` | Component test recorder và bàn phím |
| `src/features/settings/keyboard-shortcuts-state.test.ts` | Unit test thứ tự request và commit |
| `src/features/settings/keyboard-shortcuts-provider.test.tsx` | Mount/focus, lifetime và context |
| `src/lib/ipc/keyboard-shortcuts.test.ts` | Contract wrapper |
| `src/lib/utils/keyboard-shortcuts.test.ts` | Chuẩn hóa/format/so khớp chord |
| `src/app/app-router.test.tsx` | Route thật thay placeholder |
| `src/app/app-shell.test.tsx` | Provider và trạng thái load không chặn shell |
| `src/app/session-terminal-route.test.tsx` | Props snapshot qua composition root |
| `src/features/sessions/workspace-shortcuts.test.ts` | Adapter ID và bỏ default cứng |
| `src/features/sessions/use-workspace-shortcuts.test.ts` | Dispatch cấu hình, conflict và guards |
| `src/features/sessions/session-workspace.test.tsx` | Giữ handler, close-impact và cập nhật cấu hình |
| `src/features/sessions/session-tab-strip.test.tsx` | Accelerator hiện hành |
| `src/features/sessions/session-pane.test.tsx` | Accelerator và trạng thái conflict |

Không thêm backend implementation trong FE-014: bốn command đã đăng ký ở composition root Rust và có integration/contract test của BE-009. Không cần generator input hoặc migration mới.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `SettingsKeyboardShortcutsRoute` | Tiêu đề `Keyboard Shortcuts`, mô tả như wireframe, ô `Search actions`, `Restore all defaults`, bảng Action/Shortcut/trạng thái | `#settings-shortcuts` |
| Bảng nhóm | Nhóm category theo thứ tự xuất hiện trong snapshot; giữ thứ tự action, bỏ nhóm không có kết quả; mỗi tổ hợp là button có các keycap | `#settings-shortcuts` |
| `ShortcutRecorderDialog` | Tiêu đề `Change shortcut`, tên action, current/default, vùng `Press a shortcut`, bản nháp, lỗi/cảnh báo và Save/Cancel | Bổ sung tương tác cho tổ hợp có thể bấm trong wireframe |
| Dialog reset all | `Restore all keyboard shortcuts?`, giải thích mọi tùy chỉnh sẽ về mặc định; nút `Cancel` và `Restore all defaults` | Bổ sung bước xác nhận cho nút restore-all |

Nhãn action dùng nguyên `label` từ backend. Category hiển thị `Global`, `Navigation`, `Tabs`, `Panes`, `Files`. `Default` xuất hiện nếu `isCustom=false`; ngược lại có nút `Reset` với accessible name `Reset shortcut for {label}`. Không gộp hai action vào một dòng.

Action đã có handler là bảy action trong bảng tích hợp bên dưới, dù handler tạm không khả dụng vì chưa mở workspace. Mười một action Phase 1 còn lại có `Not available yet` và giải thích `You can customize this shortcut now. Its action is not available in this version.` Nhãn này độc lập với conflict và không thay `isDispatchable` backend.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang tải lần đầu | Chưa có snapshot/nền tảng | `Loading keyboard shortcuts…`, khóa ghi, không render phím mặc định giả |
| Đang refresh | Có snapshot, đọc lại khi mount/focus | Giữ bảng, chỉ báo `Refreshing…`; khóa ghi và tạm ngừng dispatch đến khi xác nhận snapshot |
| Sẵn sàng | Snapshot/nền tảng hợp lệ | Bảng đầy đủ, hành động theo dữ liệu commit |
| Không khớp tìm kiếm | Bộ lọc không khớp label | `No actions found. Try another search.`, nút `Clear search` |
| Catalog rỗng | Backend trả actions rỗng | `No keyboard shortcuts are available.`, `Try again`; khóa reset; đây là dữ liệu bất thường vì Phase 1 phải có 18 action |
| Lỗi tải/refresh | Read hoặc lấy nền tảng thất bại | `Could not load keyboard shortcuts.`, `Try again`; giữ bảng cũ chỉ để tham khảo nếu có, khóa ghi/dispatch |
| Đang ghi | Set/reset đang chờ | `Saving…` hoặc `Restoring…`, khóa mọi mutation; snapshot cũ giữ nguyên |
| Xung đột | `conflictsWith` không rỗng | Nền cảnh báo, icon, tên mọi action cùng tổ hợp, thông báo cả nhóm tạm ngừng; không chỉ biểu đạt bằng màu |
| Lỗi ghi | Command bị từ chối | Giữ bản nháp/snapshot cũ; lỗi tại dialog hoặc vùng action reset và hành động khắc phục theo bảng lỗi |
| Thành công | Command trả snapshot | Thay toàn snapshot; thông báo `Shortcut saved.` hoặc `Defaults restored.` qua polite live region; conflict có thể vẫn còn sau reset một dòng |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Nhập tìm kiếm | Trim và so khớp substring label không phân biệt hoa/thường, lọc tại frontend; không IPC, không debounce cần thiết với catalog nhỏ | Nhập thông thường |
| Chọn tổ hợp | Mở recorder, focus vùng ghi nhận; candidate ban đầu null | Enter/Space trên button |
| Ghi nhận | Thay candidate bằng một chord; không tự lưu hoặc chạy action tương ứng | Tổ hợp hợp lệ |
| Save | Gọi set với actionId và candidate; đóng chỉ sau thành công, trả focus về button mở | Enter/Space khi focus Save |
| Cancel | Bỏ candidate, đóng và trả focus | Escape không modifier hoặc nút Cancel |
| Reset một dòng | Gọi reset ngay, không cần confirmation riêng; giữ query và cập nhật toàn bộ conflict | Enter/Space trên Reset |
| Restore all defaults | Mở confirmation; focus Cancel; xác nhận gọi reset all, không giới hạn theo query | Enter/Space trên nút tương ứng |

Reset all được phép khi snapshot không có custom để backend có thể xóa override orphan; chỉ khóa khi chưa sẵn sàng/đang ghi. Không tự xóa query sau set/reset. Nếu nút Reset biến mất sau thành công, chuyển focus sang button tổ hợp cùng dòng; nếu dòng không còn, focus ô tìm kiếm.

### Ghi nhận và khả năng truy cập

- Recorder chỉ bắt phím khi vùng ghi nhận đang focus. `Tab`/`Shift+Tab` không modifier khác luôn di chuyển focus giữa vùng ghi nhận, Save và Cancel; không bị giữ thành candidate. `Enter`/`Space` trên các nút kích hoạt nút, không ghi nhận.
- `Escape` không modifier luôn hủy; Escape có Primary/Alt được ghi nhận khi vùng ghi nhận có focus. Primary/Alt+Tab được xử lý nếu WebView thực sự nhận event; không hứa ghi nhận tổ hợp bị OS giữ lại.
- Dùng `KeyboardEvent.code`. Bỏ qua repeat, IME composition, keyCode 229, `AltGraph` và modifier-only. Không làm mất candidate hiện tại khi gặp event bị bỏ qua.
- Windows: primary=Ctrl, Alt=Alt, Shift=Shift; có Meta thì không ghi nhận. macOS: primary=Meta, Alt=Option, Shift=Shift; có Control thì không ghi nhận vì DTO không biểu diễn modifier đó. Không suy đoán nền tảng từ user-agent; lấy qua wrapper app-info hiện có.
- Code allowlist và rule Primary/Alt trừ F1–F12 theo BE-009. Frontend phản hồi sớm nhưng backend vẫn là validation cuối. Không thêm restriction khác; tổ hợp OS không chuyển tới WebView không tạo candidate, người dùng vẫn thoát bằng Cancel.
- Vùng ghi nhận có tên/mô tả accessible, focus ring và text `Press a shortcut, then choose Save. Press Escape to cancel.` Chỉ chặn default của event thực sự được vùng này tiêu thụ; không bắt bàn phím trên toàn trang Settings.
- Preview conflict so candidate với current chord của action khác chỉ để cảnh báo; cho Save và không sửa snapshot trước commit. Sau commit dùng conflict backend. Luôn lấy tên conflict từ snapshot đầy đủ, kể cả row bị lọc.
- Format modifier theo Windows `Ctrl`, `Alt`, `Shift`; macOS `Command`, `Option`, `Shift`. KeyA–Z thành A–Z, Digit0–9 thành 0–9; F-key giữ tên, Arrow thành mũi tên kèm accessible name; code dấu câu thành ký hiệu US tương ứng, các code khác thành tên đọc được (`Page Up`, `Space`, `Escape`…). Không parse ngược keycap thành DTO.
- Dialog giữ focus trap; overlay không đóng vì click ngoài. Trong lúc ghi, Save/Cancel/Escape không đóng dialog; sau response mới cho thao tác tiếp. Unmount vẫn cleanup listener và không hủy một command backend đã gửi.
- Dùng component UI đã có, tôn trọng reduced motion, màu theme/cỡ chữ hiện tại. Bảng cho nội dung wrap ở màn hình hẹp; conflict không bị cắt mất phần giải thích. Icon không nhãn phải có tooltip.

## Luồng chính

1. Provider mount cùng shell: đọc nền tảng và snapshot. Route Settings đăng ký refresh khi mount; coalesce nếu read đang chạy. Không có I/O ở từng row.
2. Người dùng mở recorder, nhập candidate. Trong dialog không application shortcut nào được dispatch, kể cả Command Palette tương lai.
3. Save gửi đúng một mutation; không optimistic update. Mutation thành công trả toàn snapshot đã commit, mọi consumer thay dữ liệu cùng lần publish rồi đóng dialog.
4. Workspace đang dùng snapshot nhận ngay override/conflict/reset; không phải restart ứng dụng. Nếu conflict còn, UI chỉ báo và toàn group không dispatch.
5. Window focus trở lại hoặc route Settings mount lại phải refresh. Mọi operation qua cùng coordinator tuần tự; đọc trước mutation không thể ghi đè kết quả mutation sau đó. Focus trong lúc mutation được gộp thành một read sau mutation.

### Tích hợp handler hiện có

| ID trong adapter FE-007 | Action ID BE-009 | Handler giữ nguyên |
|---|---|---|
| `tabs.create` | `tabs.create` | Tạo tab |
| `tabs.close` | `tabs.close` | Close-impact và luồng đóng tab |
| `tabs.reopenClosed` | `tabs.reopen_closed` | Mở lại tab vừa đóng |
| `panes.splitRight` | `panes.split_right` | Split right |
| `panes.splitDown` | `panes.split_down` | Split down |
| `panes.maximizeToggle` | `panes.maximize_toggle` | Maximize/restore |
| `panes.close` | `panes.close` | Close-impact và luồng đóng pane |

Không import nội bộ settings từ sessions. Composition root đọc public context rồi truyền `shortcutSnapshot: KeyboardShortcutsDto | null` và `shortcutPlatform: "windows" | "macos" | null` qua public entry sessions. Snapshot truyền là null khi chưa sẵn sàng hoặc read lỗi. Handler chỉ xét đúng bảy ID; adapter không còn fallback về bảng phím cứng.

Match toàn bộ code/modifier chính xác và yêu cầu `scope=application`, `isDispatchable=true`, handler runtime available. Bỏ qua event đã có `defaultPrevented` để không double dispatch. Không gọi `preventDefault` nếu không match hoặc action không khả dụng. Giữ chặn khi workspace busy/closing/dialog mở; bỏ qua editable target gồm input/textarea/select/contenteditable, editor và terminal, cùng repeat/IME/AltGraph. Không có handler Command Palette trong lát cắt này; ngoại lệ editable của BE-009 chỉ áp dụng khi FE-009 có handler thật.

Tooltip và hướng dẫn restore lấy current chord cùng snapshot, không giữ `Ctrl T` hoặc `Ctrl Shift M` cứng. Khi conflict, thay accelerator bằng thông báo `Shortcut conflict — change it in Settings`; nút thao tác trực quan vẫn hoạt động. Khi snapshot chưa sẵn sàng chỉ hiển thị tên thao tác, không quảng bá phím mặc định.

## Contract với backend

### Command sử dụng

Import các DTO/error từ binding BE-009, không khai báo lại shape. Struct camelCase, nhưng field bổ sung của error union dùng `action_id`/`key_code` đúng binding.

| Command | Input tại invoke | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_keyboard_shortcuts` | Không có | `KeyboardShortcutsDto` | `unavailable` |
| `set_keyboard_shortcut` | `{ input: SetKeyboardShortcutInputDto }` | `KeyboardShortcutsDto` | `unauthorized_window`, `action_not_found`, `invalid_key_code`, `modifier_required`, `reserved_shortcut`, `persistence_failed`, `unavailable` |
| `reset_keyboard_shortcut` | `{ actionId: string }` | `KeyboardShortcutsDto` | `unauthorized_window`, `action_not_found`, `persistence_failed`, `unavailable` |
| `reset_all_keyboard_shortcuts` | Không có | `KeyboardShortcutsDto` | `unauthorized_window`, `persistence_failed`, `unavailable` |

```ts
/** Read the committed shortcut catalog. */
export function getKeyboardShortcuts(): Promise<KeyboardShortcutsDto>;
/** Save one assignment and return the complete committed catalog. */
export function setKeyboardShortcut(input: SetKeyboardShortcutInputDto): Promise<KeyboardShortcutsDto>;
/** Restore one action to its backend default. */
export function resetKeyboardShortcut(actionId: string): Promise<KeyboardShortcutsDto>;
/** Restore every default, including removal of orphan overrides. */
export function resetAllKeyboardShortcuts(): Promise<KeyboardShortcutsDto>;
```

Wrapper dùng `invokeCommand` và `IpcCallError<KeyboardShortcutsError>`. Không gọi `update_settings` cho phím tắt. Mutation chỉ từ window main. Backend quyết định persistence/no-op; không tự bỏ qua request reset all vì frontend không thấy orphan.

| Lỗi | Phản hồi |
|---|---|
| `invalid_key_code` | `This key is not supported.`; giữ recorder cho chọn phím khác |
| `modifier_required` | `Use Ctrl or Alt, or a function key.` trên Windows; đổi thành Command/Option trên macOS |
| `reserved_shortcut` | `This shortcut is reserved by the operating system.`; chọn tổ hợp khác |
| `action_not_found` | `This action is no longer available.`; đóng recorder, refresh, không gửi lại action tự động |
| `persistence_failed` | `Could not save keyboard shortcuts. Try again.`; giữ snapshot cũ và candidate, cho retry thủ công |
| `unavailable` | `Keyboard shortcuts are temporarily unavailable.`; cho Try again để đọc lại trước khi ghi tiếp |
| `unauthorized_window` | `Keyboard shortcuts can only be changed in the main window.`; không retry mutation tự động |
| `corrupt_stored_shortcut` | Lỗi khởi tạo dữ liệu theo BE-009; không tự reset, hướng dẫn restart/liên hệ hỗ trợ nếu được trả bất ngờ |
| Transport/error không nhận diện | `Could not confirm the shortcut change. Reload shortcuts before trying again.`; khóa ghi/dispatch đến khi re-query thành công vì mutation có thể đã commit |

Không render raw error hoặc SQL. Conflict không phải exception. Nếu `unavailable` xảy ra khi ghi, đọc lại để xác nhận trạng thái trước retry; không tạo vòng retry tự động.

### Event / Channel đăng ký

Không có Tauri event/channel BE-009. Provider dùng DOM window focus để re-query; cleanup khi unmount. Không polling, không phát event tự đặt tên và không subscribe watch Rust nội bộ. Nền tảng chỉ đọc một lần trong lifetime provider; failure cho phép retry cùng nút tải lại.

## State frontend

```ts
/** Keep only the retained backend snapshot and transient request state. */
interface KeyboardShortcutsState {
  snapshot: KeyboardShortcutsDto | null;
  platform: "windows" | "macos" | null;
  status: "idle" | "loading" | "ready" | "refreshing" | "error";
  pending: "set" | "resetOne" | "resetAll" | null;
  error: IpcCallError<KeyboardShortcutsError> | null;
  /** Refresh without allowing an older read to overwrite a later mutation. */
  refresh(): Promise<void>;
  /** Apply one assignment through the serialized IPC coordinator. */
  assign(input: SetKeyboardShortcutInputDto): Promise<boolean>;
  /** Restore one assignment through the same coordinator. */
  resetOne(actionId: string): Promise<boolean>;
  /** Restore the whole backend catalog through the same coordinator. */
  resetAll(): Promise<boolean>;
}

/** Keep draft interaction state local to the Settings route/dialog. */
interface KeyboardShortcutsEditorState {
  query: string;
  editingActionId: string | null;
  candidate: ShortcutChordDto | null;
  isResetAllOpen: boolean;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Snapshot | Backend qua command | Một bản giữ tạm trong provider; không persist frontend, không nhập default từ constant FE |
| Platform | Wrapper app-info | Map `windows`/`macos`; nền tảng khác là không hỗ trợ, không fallback Ctrl |
| Query/candidate/dialog | UI tạm thời | Xóa khi route unmount; không gửi IPC trước Save |
| Pending/error | Coordinator UI | Single-flight mutation; command đã gửi phải được reconcile dù dialog unmount |
| Conflict và custom | Backend | Preview candidate chỉ là derived warning, không ghi vào snapshot |

Các action async trả false khi thất bại đã được ghi vào state; không để unhandled rejection trong callback UI. Provider sống xuyên route, giải phóng snapshot khi shell unmount; dùng generation guard để response từ lifetime cũ không publish vào lifetime mới. Không cho bắt đầu mutation thứ hai khi pending, kể cả double click; refresh coalesce và chạy theo thứ tự đã mô tả.

## Contract công khai của feature

```ts
/** Render the keyboard shortcut Settings page. */
export function SettingsKeyboardShortcutsRoute(): React.JSX.Element;
/** Retain one shortcut snapshot for the application lifetime. */
export function KeyboardShortcutsProvider(props: { children: React.ReactNode }): React.JSX.Element;
/** Read the provider-owned snapshot and narrow mutation actions. */
export function useKeyboardShortcuts(): KeyboardShortcutsState;
```

Route entry chỉ dành cho router; provider và hook là public entry dành cho composition root. Feature khác không import recorder/state implementation, không có global handler registry mới. Utility chung chỉ normalize, format và match DTO; không phụ thuộc app/settings/sessions.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Ba action cùng chord | Cả ba liệt kê hai action còn lại và không dispatch; resolve một vẫn giữ conflict nếu hai còn trùng |
| Reset một action tạo conflict khác | Chấp nhận snapshot backend và cảnh báo; không hứa Reset luôn giải quyết conflict |
| Default cũng xung đột với override của action khác | Dòng Default vẫn có cảnh báo, cho đổi chord; không thêm Reset nếu `isCustom=false` |
| Conflict với action chưa có handler | Vẫn tôn trọng backend: handler đã có cũng ngừng; không loại action chưa có handler khỏi group |
| Candidate bằng current/default | Cho Save; backend xử lý no-op hoặc xóa override; UI không tự suy diễn persistence |
| Focus trở lại khi recorder có candidate | Refresh snapshot nhưng giữ candidate; tính lại preview conflict, chỉ Save sau refresh xong |
| Action biến mất sau refresh | Đóng recorder, thông báo action không còn; không tự chọn action khác |
| Blur giữa tổ hợp | Không gom chuỗi keydown/keyup; mỗi keydown dùng modifier đầy đủ nên không giữ modifier kẹt |
| Settings bị unmount lúc mutation | Bỏ bản nháp UI nhưng provider nhận kết quả commit; không có rollback giả |
| Restart | Backend trả override đã lưu; không restore query/dialog hoặc session runtime |
| Giới hạn pane hoặc close-impact | Handler và lỗi runtime FE-007/BE-005 giữ nguyên; đổi phím không vượt guard |

## Tiêu chí hoàn thành

- [ ] Route hiển thị đúng catalog 18 action Phase 1, thứ tự/group backend, không thêm Quick Note/File Explorer và phân biệt action chưa có handler.
- [ ] Search theo label hoạt động, clear search khôi phục bảng; conflict vẫn ghi đủ tên action bị lọc.
- [ ] Recorder dùng code và modifier chuẩn, Save/Cancel rõ ràng, thao tác đầy đủ bằng bàn phím; không chiếm Tab/Escape/IME hoặc chạy shortcut trong dialog.
- [ ] Set/reset trả snapshot commit; lỗi giữ dữ liệu phù hợp, transport lỗi bắt buộc re-query; double click và response cũ không làm đảo state.
- [ ] Reset all có xác nhận, tác động toàn catalog bất kể query; reset một chỉ tác động action đã chọn.
- [ ] Bảy handler hiện có dùng override mới ngay, default cũ không còn kích hoạt, conflict ngừng cả nhóm; tooltip/hướng dẫn không giữ accelerator cứng.
- [ ] Mười một action chưa có handler được cấu hình và persist nhưng không dispatch; Command Palette vẫn thuộc FE-009.
- [ ] Props qua composition root, không import chéo implementation settings/sessions; không đổi backend contract hoặc sửa generated binding.
- [ ] Component/unit/IPC tests dưới đây pass. Mọi function, method, callback, helper và test có comment mục đích bằng English theo AGENTS.md.
- [ ] Khi triển khai trên Windows: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`; trong `src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features`; cuối cùng `pnpm tauri build` pass vì nối IPC và desktop keyboard.
- [ ] Smoke thủ công Windows WebView2: đổi New tab rồi mở workspace dùng phím mới; tạo conflict hai handler, xác nhận cả hai ngừng; reset khôi phục; thử focus/tray, restart persistence, Ctrl/Alt/Shift, Vietnamese IME, terminal đang focus và recorder bằng bàn phím. Không chạy desktop end-to-end tự động; macOS hoãn đến chuẩn bị release.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` | Component | Group/order, Default/Reset, unavailable, search/empty/loading/error, conflict ngoài bộ lọc, reset one/all và focus |
| `src/features/settings/shortcut-recorder-dialog.test.tsx` | Component | Candidate/Save/Cancel, Tab/Escape, IME/AltGraph/repeat, preview conflict vẫn Save, validation, pending và focus trap |
| `src/features/settings/keyboard-shortcuts-state.test.ts` | Unit | Commit-only, no-op, single-flight, read/mutation order, transport uncertainty, giữ snapshot cũ và refresh sau failure |
| `src/features/settings/keyboard-shortcuts-provider.test.tsx` | Component | Mount/focus coalesce, platform failure/retry, cleanup, stale lifetime, route unmount không mất mutation |
| `src/lib/ipc/keyboard-shortcuts.test.ts` | Contract | Tên command, input envelope camelCase và error union đúng binding; không gọi update_settings |
| `src/lib/utils/keyboard-shortcuts.test.ts` | Unit | Code/modifier exact, formatting Windows/macOS bằng dữ liệu giả, unsupported modifier, IME/AltGraph, F-key và allowlist |
| `src/app/app-router.test.tsx` | Component | Route FE-014 thật và breadcrumb giữ nguyên |
| `src/app/app-shell.test.tsx` | Component | Shell vẫn điều hướng được khi shortcut load lỗi |
| `src/app/session-terminal-route.test.tsx` | Component | Snapshot/platform mới đi qua public props và null khi chưa sẵn sàng |
| `src/features/sessions/workspace-shortcuts.test.ts` | Unit | Bảy ID map đúng, chỉ match snapshot, không default fallback |
| `src/features/sessions/use-workspace-shortcuts.test.ts` | Unit | Override thay default, conflict group bị chặn, guards, defaultPrevented, editable/select/terminal/dialog và không double dispatch |
| `src/features/sessions/session-workspace.test.tsx` | Component | Override kích hoạt handler cũ; close-impact/confirmation, split limit và trạng thái busy giữ nguyên |
| `src/features/sessions/session-tab-strip.test.tsx` | Component | Nhãn New tab cập nhật theo snapshot, không quảng bá phím khi lỗi/conflict |
| `src/features/sessions/session-pane.test.tsx` | Component | Nhãn split/maximize/close và hướng dẫn restore theo snapshot |

Mock IPC ở frontend, không dùng app data thật. Chạy lại bộ Rust BE-009 hiện có để kiểm tra contract/persistence; không tạo test backend trùng implementation khi contract không đổi.

## Câu hỏi mở

Không có.
