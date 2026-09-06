# FE-009 — Command Palette

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-009` |
| Phase | `1`, giai đoạn 12 — Unified search |
| Khu vực chính | `src/features/search/` |
| Yêu cầu chức năng | §14, §18; điểm vào §5 và phím tắt §17.4 |
| Wireframe | `00-Docs/01-Wireframe/02-AppShell.html#palette`; điểm vào `#shell`, `#shell-collapsed`; cấu hình `#settings-shortcuts` |
| Backend liên quan | `BE-010`, `BE-003`, `BE-005`, `BE-009` |
| Phụ thuộc | `FE-001`, `FE-004`, `FE-005`, `FE-006`, `FE-011`–`FE-014`; BE-010 đã triển khai |

## Mục tiêu

Người dùng mở hộp tìm kiếm từ topbar hoặc phím hiện hành, tìm project/session thật và chạy lệnh có owner hiện hữu bằng bàn phím. Search hiển thị kết quả BE-010; composition root ghép navigation và command execution, không sao chép business state hoặc truy cập implementation feature khác.

### Quyết định đã chốt

- Đây là DESIGN ONLY cho stage 12. Người dùng ủy quyền tự chốt ambiguity; các quyết định bên dưới là contract cho bước PLAN tiếp theo, không phải bằng chứng đã triển khai.
- Binding `src/bindings/search.ts` và implementation BE-010 là contract wire thật: camelCase, ba kind `project`, `session`, `command`, không event search. Thuật ngữ snake_case trong diễn giải BE không phải field frontend.
- Giữ thứ tự/group/ranking/cap từ backend. Không lọc bỏ command chưa có executor sau khi backend đã cap, vì làm sai count/hasMore và che dữ liệu catalog. Các dòng đó có trạng thái disabled và giải thích cụ thể.
- Stage 12 chạy sáu static command và command tạo session theo context. Bảy handler tab/pane hiện có là handler cục bộ workspace với guard/dialog riêng, chưa phải public executor Palette. Không kéo nghiệp vụ đó vào app hay giả lập KeyboardEvent. Bổ sung executor này cần lát cắt owner riêng; không tự mở rộng stage 12.
- Các ví dụ `pty`/project/session trong wireframe là minh họa, không seed hoặc runtime mock. `New Session` không có shortcut trong binding thật; không hiển thị `Ctrl N` giả.

### Ngoài phạm vi

- File, Note, Event, tìm terminal output, mở split, lịch sử query, recent search, pagination, indexing, cache bền vững.
- Handler điều hướng previous/next, focus pane; public executor tab/pane; command tự mở Palette; lệnh tùy ý, script, shell hoặc OS access.
- Thay backend contract, generated bindings, schema, migration, permission, package hoặc historical plan. Không đánh dấu stage 8–12 hoàn tất khi native smoke còn pending.

## File liên quan

Bảng này là phạm vi source/test cho implementation sau, không yêu cầu tạo mọi file scaffold. Các dòng ghi dùng lại chỉ là dependency đọc, không cần sửa.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/search/index.ts` | Public export component và callback types |
| `src/features/search/command-palette.tsx` | Dialog controlled, input, groups, keyboard, status và focus |
| `src/features/search/use-unified-search.ts` | Debounce, generation, query lifecycle và retry |
| `src/features/search/search-result-row.tsx` | Option, Unicode highlight, shortcut, disabled reason |
| `src/features/search/search-error-copy.ts` | Copy typed error và source failures |
| `src/features/search/command-palette.test.tsx` | Component/keyboard/accessibility |
| `src/features/search/use-unified-search.test.ts` | Async ordering/debounce/lifetime |
| `src/features/search/search-result-row.test.tsx` | Highlight/group row/shortcut |
| `src/features/search/search-error-copy.test.ts` | Sanitized copy |
| `src/lib/ipc/search.ts` | Wrapper search_unified |
| `src/lib/ipc/search.test.ts` | Invoke envelope và error contract |
| `src/app/search-entry.tsx` | Điểm vào, shortcut listener, context và executor allowlist |
| `src/app/search-entry.test.tsx` | Composition, route/context, execution/guards/focus |
| `src/app/app-topbar.tsx` | Thay SearchEntry inert bằng entry app |
| `src/app/app-topbar.test.tsx` | Entry thật, tooltip, no-drag, giữ notifications/window controls |
| `src/features/settings/settings-keyboard-shortcuts-route.tsx` | Availability của action mở Palette |
| `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` | Tám action có handler, mười action chưa có |
| `src/app/app-shell.tsx` | Dùng lại provider keyboard đã mount, không mount provider thứ hai |
| `src/app/app-shell.test.tsx` | Lifetime qua route và interaction overlay/Quit |
| `src/app/app-router.tsx` | Dùng lại route thật, không thêm route search |
| `src/app/quit-store.ts` | Dùng lại phase để suspend |
| `src/features/settings/keyboard-shortcuts-provider.tsx` | Public hook snapshot/platform/refresh dùng tại app |
| `src/features/settings/keyboard-shortcuts-state.ts` | Dùng lại state public, không sửa catalog |
| `src/components/ui/dialog.tsx` | Dùng lại dialog/focus trap |
| `src/components/ui/input.tsx` | Dùng lại input |
| `src/components/ui/button.tsx` | Dùng lại action |
| `src/components/ui/tooltip.tsx` | Dùng lại tooltip |
| `src/lib/utils/keyboard-shortcuts.ts` | Dùng lại exact matcher/formatter |
| `src/lib/ipc/ipc-error.ts` | Dùng lại invokeCommand/IpcCallError |
| `src/lib/ipc/projects.ts` | Dùng lại getProject, owner route giữ openProject |
| `src/lib/ipc/sessions.ts` | Dùng lại getSession/createSession |
| `src/bindings/search.ts` | Type sinh từ Rust, chỉ import |
| `src/bindings/projects/projects.ts` | Project DTO/error, chỉ import |
| `src/bindings/sessions/sessions.ts` | Session DTO/error, chỉ import |
| `src/bindings/keyboard-shortcuts.ts` | Shortcut DTO, chỉ import |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| SearchEntry | Pill `Search or run a command`, current accelerator và tooltip; button no-drag | `#shell`, `#shell-collapsed` |
| CommandPalette | Modal phía trên trung tâm viewport, overlay mờ; max-width 640px, lề tối thiểu 16px, cao tối đa 70vh, body cuộn | `#palette` |
| Input | Label `Search or run a command`, icon search, close button `Close search` với tooltip `Close search (Esc)` | `#palette` |
| Groups/rows | Label backend, icon theo kind, title/context, highlight, accelerator hoặc reason disabled | `#palette` |
| Footer | `↑ ↓ move`, `Enter open` hoặc `Enter run`, tổng `{n} results`; disabled row không quảng bá Enter | `#palette` |

Dùng theme tokens, font size hiện hành, focus ring và reduced motion của repo. Không dùng chiều cao cố định làm cắt chữ khi tăng font. Phase 1 không render nhóm Files/Notes/Events hoặc footer Ctrl+Enter. Không parse context để suy ra status icon; context là text backend đã chuẩn hóa.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Mở/query rỗng | Mở mỗi lần hoặc clear | Gọi search với query rỗng, chỉ Commands do backend trả |
| Đang tải | Debounce/request hoặc context đang resolve | `Searching…`, aria-busy; không cho kích hoạt kết quả request cũ |
| Có kết quả | Response hiện hành | Group theo backend: Projects, Sessions, Commands; chọn dòng đầu tiên |
| Rỗng | resultCount=0, không sourceFailure | `No results found. Try another search.`, `Clear search` |
| Partial | Có sourceFailures | Giữ groups thành công; `Some results are unavailable.`, liệt kê `Projects`, `Sessions`, `Commands` cùng `Timed out`/`Unavailable`, `Try again` |
| Partial rỗng | Không kết quả nhưng có failure | `Search could not load all sources.`, Try again; không khẳng định không có dữ liệu |
| Lỗi command | Top-level reject/transport | Copy theo bảng lỗi; query giữ nguyên, cho retry nếu phù hợp |
| Giới hạn | group.hasMore | `More matches available. Refine your search.` trong group; không nút load-more |
| Chưa có executor | Command không thuộc allowlist | aria-disabled, reason `Not available in Command Palette yet.` hoặc `Not available yet.` theo bảng command |
| Đang mở/chạy | Callback pending | `Opening…`/`Running…`, chặn double activation; không tự retry mutation |
| Target mất | Owner query từ chối not-found/mismatch | `This result is no longer available.`, re-query một lần, không mở đối tượng thay thế |

Count là response.resultCount bao gồm disabled rows, không phải số lệnh chạy được. Announce trạng thái và count qua polite live region; lỗi thực thi qua alert. Không render raw error/query trong log.

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Mở | Focus input, query rỗng, request mới | Current chord của search.open_command_palette, mặc định do BE-009 là Primary+K |
| Nhập | Debounce 120ms sau input cuối, không request giữa IME composition | Nhập thông thường |
| Di chuyển | Arrow Up/Down qua mọi option kể cả disabled để đọc reason; wrap đầu/cuối; scroll vào view, giữ focus input | ↑/↓ |
| Chọn bằng chuột | Hover đặt active; click enabled kích hoạt một lần | Click |
| Kích hoạt | Target union dispatch, disabled không chạy | Enter không modifier, không composing/repeat |
| Đóng | Invalidate request, xóa query, trả focus opener còn tồn tại hoặc pill | Escape/close/outside click |
| Retry | Request mới ngay với query/context hiện tại | Enter/Space trên Try again |

Input dùng combobox, aria-expanded, aria-controls trỏ listbox, aria-activedescendant trỏ option active bằng ID ổn định từ key; groups có label, option aria-selected và aria-disabled. Tab/Shift+Tab đi qua input/nút retry/close trong focus trap, không dùng Tab để chọn result. Ctrl+Enter không thực thi hoặc chia pane. Escape khi IME đang composition không đóng. Không dùng HTML từ backend để highlight.

### Danh sách command thực sự khả dụng ở stage 12

| actionId chính xác | Khả dụng và owner execution |
|---|---|
| `navigation.open_home` | Mở `/`, màn hình Home hiện hữu theo phase, không tạo dashboard giả |
| `navigation.open_projects` | Mở `/projects` |
| `settings.open_general` | Mở `/settings/general` |
| `settings.open_appearance` | Mở `/settings/appearance` |
| `settings.open_cli_profiles` | Mở `/settings/terminal-profiles` |
| `settings.open_keyboard_shortcuts` | Mở `/settings/keyboard-shortcuts` |
| `sessions.create_current_project` | Chỉ khi backend trả target.projectId; createSession(projectId) rồi `/sessions/:sessionId`, tool picker thật FE-006; không spawn PTY |
| `tabs.create`, `tabs.close`, `tabs.reopen_closed` | Chưa khả dụng trong Palette; handler FE-007 vẫn chạy tại workspace theo contract hiện có |
| `panes.split_right`, `panes.split_down`, `panes.maximize_toggle`, `panes.close` | Chưa khả dụng trong Palette; không bypass guard/confirmation của workspace |
| `navigation.previous_project`, `navigation.next_project`, `navigation.previous_session`, `navigation.next_session`, `navigation.previous_tab`, `navigation.next_tab` | `Not available yet.`; FE-014 hiện chưa có handler |
| `panes.focus_up`, `panes.focus_down`, `panes.focus_left`, `panes.focus_right` | `Not available yet.`; không triển khai focus hình học trong stage 12 |
| `search.open_command_palette` | Entry shortcut, backend đã loại khỏi kết quả để tránh đệ quy |
| ID chưa biết | Fail closed, disabled `Not available in Command Palette yet.`, không fallback theo title/key |

Shortcut conflict chỉ vô hiệu hóa keyboard dispatch, không phải quyền chạy command qua Enter. Với command enabled, nếu shortcut.isConflicted thì vẫn cho chạy trực tiếp, keycap có cảnh báo `Shortcut conflict`; không hiển thị nó như accelerator hoạt động. Không tự gán shortcut cho static/context command có shortcut=null.

## Luồng chính

1. App đọc context từ route: project overview lấy projectId và xác nhận getProject; session route resolve getSession rồi dùng summary.projectId; route khác null. Chỉ gửi UUID canonical từ DTO đã xác nhận, không chọn project đầu tiên hay lấy breadcrumb title. Khi resolve lỗi dùng null, vẫn cho tìm toàn cục; không chặn sáu static command.
2. Mỗi lần mở, query/input đời mới; resolve context hoàn tất mới bắt đầu search để không nhấp nháy gợi ý sai project. Query có thể nhập trong khi resolve; latest query thắng.
3. Search gọi wrapper, render đúng response hiện hành. Thay query/context lập tức invalidate selection cũ; không chờ timer mới đánh dấu stale. Không client-side ranking/filter.
4. App nhận target bằng callback. Project: getProject xác nhận ID rồi navigate `/projects/:projectId`; route owner tự openProject và cập nhật last-opened/availability. Project unavailable vẫn mở Overview để sửa đường dẫn. Session: getSession xác nhận summary.id/projectId rồi navigate `/sessions/:sessionId`; owner SessionRoute quản lý observed-session, active tab/pane và terminal. Không setObservedSession tại Search.
5. Command điều hướng theo allowlist. New Session gọi createSession một lần; backend kiểm tra project/availability/runtime. Dùng ID từ response, không tạo session optimistic. Không gọi selectSessionTool hoặc terminal start.
6. Kết quả thành công đóng và nhường focus cho route đích; không trả focus về control của route cũ. Khi route giữ nguyên, trả focus về pill. Lỗi giữ Palette và input để sửa/retry; missing target refresh search một lần.

## Contract với backend

### Command sử dụng

| Command | Input tại invoke | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `search_unified` | `{ input: UnifiedSearchInputDto }`, input có query/contextProjectId nullable | UnifiedSearchResponseDto | UnifiedSearchError và transport |
| `get_project` | Qua getProject(projectId) wrapper hiện có | ProjectDto | Not found: stale; unavailable/storage/transport: copy owner đã sanitize |
| `get_session` | Qua getSession(sessionId) wrapper hiện có | SessionDetailDto | sessionNotFound: stale; runtimeShuttingDown/transport: không điều hướng |
| `create_session` | Qua createSession(projectId) wrapper hiện có | SessionDetailDto | projectNotFound/projectUnavailable/runtimeShuttingDown: thông báo, không spawn/retry tự động |

```ts
/** Query the real Phase 1 unified-search boundary. */
export function searchUnified(input: UnifiedSearchInputDto): Promise<UnifiedSearchResponseDto>;
```

Wrapper dùng invokeCommand và IpcCallError<UnifiedSearchError>; DTO import binding, không định nghĩa lại. Backend trim, tối đa 128 Unicode scalar sau trim, từ chối control character còn trong query. Frontend không cắt chuỗi bằng maxLength UTF-16; lỗi `invalid_query` hiện `Use up to 128 characters and remove control characters.` cho sửa input. `invalid_context_project_id`: `Search context is unavailable.`, bỏ context và cho người dùng Try again toàn cục, không lặp request tự động. `unavailable`/transport: `Could not search. Try again.`; `unauthorized_window`: `Search is only available in the main window.`, không retry tự động.

Highlight là range nửa mở [startScalar,endScalar) trên Array.from(displayText), không phải UTF-16 index; render text nodes/mark, không dangerouslySetInnerHTML, không normalize lại title/context. Giữ shortcut.keyCode/primary/alt/shift từ binding và format theo platform của provider; chưa biết platform thì ẩn keycap.

Backend cap 8 result/group, candidate/source 64, total cap 48; frontend không giả định luôn đủ 8 hoặc đủ group. Source deadline 400ms, total 500ms; không tạo timeout FE ngắn hơn khiến bỏ partial hợp lệ.

### Event / Channel đăng ký

Không có event/channel BE-010. Hook chỉ search khi mở/query/context/retry; window focus khi Palette đang mở re-query, snapshot shortcut đã commit thay đổi thì re-query để nhãn current chord cập nhật. Không polling, không đăng ký event tên tự đặt. Đóng, đổi route, hidden document hoặc Quit suspend hủy timer/invalidate response; request Rust đã gửi không được coi là hủy ở backend.

## State frontend

```ts
/** Retain transient query state for one palette lifetime. */
interface UnifiedSearchState {
  query: string;
  response: UnifiedSearchResponseDto | null;
  status: "idle" | "loading" | "ready" | "error";
  activeKey: string | null;
  error: IpcCallError<UnifiedSearchError> | null;
  requestGeneration: number;
  /** Replace the query and invalidate older results immediately. */
  setQuery(query: string): void;
  /** Request a fresh snapshot without retrying any mutation. */
  retry(): void;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Query/activeKey/generation/composition | Search UI | Xóa khi đóng; chỉ latest response publish, kể cả StrictMode/unmount |
| Response/ranking/failures | Backend BE-010 | Snapshot tạm, không localStorage/cache business state |
| Open/opener/context/executing | App entry | Single-flight execution guard đồng bộ trước await; route generation và AbortSignal ngăn navigation muộn |
| Snapshot shortcut/platform | Public Settings provider | App truyền xuống Search; không import Settings trong Search |
| Project/session/terminal state | Owner backend/route | Search không sửa store owner hoặc giả lập event |

## Contract công khai của feature

```ts
/** Describe whether an owner currently exposes a palette executor. */
export type SearchTargetAvailability = { enabled: boolean; reason: string | null };
/** Render the controlled search surface without owning app navigation. */
export function CommandPalette(props: {
  open: boolean;
  contextProjectId: string | null;
  contextReady: boolean;
  platform: "windows" | "macos" | null;
  refreshKey: number;
  busy: boolean;
  executionError: string | null;
  /** Request closing after an explicit user dismissal. */
  onClose(): void;
  /** Delegate focus restoration after the dialog releases its focus scope. */
  onClosed(): void;
  /** Read availability from the composition-owned action allowlist. */
  getTargetAvailability(target: SearchTargetDto): SearchTargetAvailability;
  /** Delegate one enabled target to the composition root. */
  onActivate(target: SearchTargetDto): Promise<void>;
}): React.JSX.Element;
```

Chỉ public entry `src/features/search/index.ts` được app import. App sở hữu executor và lỗi thực thi đã sanitize, Search gọi callback không biết router/feature store. Các public Settings exports hiện có dùng tại app, không xuyên feature. Không thêm global action registry/event bus. App SearchEntry gắn dưới KeyboardShortcutsProvider sẵn có ở topbar; không cần provider Search xuyên app.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Gõ A rồi B, A trả sau | A không đổi rows/error/activeKey hoặc loading của B |
| Đóng rồi mở trước response cũ | Generation mới, query rỗng; response cũ không xuất hiện |
| Context project mất sau search | Owner revalidate, báo stale/re-query; không tạo tại project khác |
| Route đổi trong khi create_session đang chờ | Abort navigation cũ; backend có thể đã tạo session thật, không rollback/xóa hoặc tự gọi create lần nữa; sidebar owner nhận runtime event |
| Transport lỗi create_session | `Could not confirm session creation. Check the project sessions before trying again.`; không tự retry; đóng Palette để kiểm tra danh sách |
| Double Enter/click | Chỉ một activation, busy guard giữ tới callback settle kể cả đóng/mở |
| Modal khác/recorder/Quit đang mở | Không mở Palette từ shortcut; không chiếm Escape/focus. Quit bắt đầu đóng Palette, không trả focus opener |
| Input hoặc terminal focus | Shortcut mở Palette là app-level, exact chord được bắt ở capture khi snapshot ready/dispatchable; preventDefault/stopPropagation chỉ khi chấp nhận, không đưa chord xuống PTY |
| IME/AltGraph/repeat/defaultPrevented | Không dispatch; composition không kích hoạt result |
| Shortcut load/refresh/error/pending | Tạm không dispatch, không fallback Ctrl+K; pill vẫn dùng được khi không suspend, không quảng bá keycap stale |
| Shortcut conflict | Không keyboard dispatch; pill và enabled row Enter vẫn hoạt động |
| Notification popover đang mở | Modal Palette trap/inert nền; dismissal của popover không được lấy lại focus khỏi input. Kiểm tra focus bằng test; không suspend notification subscription |
| Hidden/tray | Đóng Palette/invalidate khi document hidden; không đăng ký global OS hotkey |

## Tiêu chí hoàn thành

- [ ] Entry thật mở Palette và dùng current chord; override/conflict/recorder/terminal/IME đúng guard, không double dispatch.
- [ ] Query rỗng và query có chữ dùng search_unified thật; đúng group/order/highlight/count/caps/hasMore và partial failures, không dữ liệu phase tương lai.
- [ ] Sáu static command và New Session có owner thật; mọi ID khác theo bảng availability, không giả lập phím/PTY/navigation.
- [ ] Project/session dùng ID và revalidation, đúng route owner; stale/race/uncertain mutation không điều hướng hoặc tạo trùng.
- [ ] Bàn phím, live region, modal focus, font lớn/theme/reduced motion và no-drag đúng contract.
- [ ] Frontend format:check, lint, typecheck, unit/component tests và build pass; Rustfmt, Clippy all-targets/all-features warnings denied, Rust tests all-targets/all-features pass; Cargo một job. Tauri Windows build bắt buộc vì nối IPC/keyboard.
- [ ] Native smoke Windows với dữ liệu kiểm thử cô lập: pill/current chord từ terminal, IME, focus/recorder/Quit/tray, session thật và notifications. Không automated desktop E2E; macOS để release.
- [ ] Đo p95 IPC search dưới 150ms theo BE-010 trên Windows không contention: warm-up rồi ít nhất 100 request với project/session dữ liệu tạm, ghi máy/dataset/sample count; đo riêng debounce 120ms và render, không lẫn vào p95 backend. Không ghi query nhạy cảm.

Native smoke các stage 8–12 hiện vẫn pending; thiết kế này không chuyển chúng thành pass. Không chỉnh plan lịch sử để ghi validation mới; evidence thuộc plan execution được giao sau.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/lib/ipc/search.test.ts` | Contract | Tên command, input envelope/null/camelCase, typed và transport errors |
| `src/features/search/use-unified-search.test.ts` | Unit | Fake timer 120ms, IME, reverse response, retry, close/reopen/unmount/StrictMode |
| `src/features/search/command-palette.test.tsx` | Component | Groups/count/empty/loading/error/partial/hasMore, disabled selection, keyboard, focus trap, no future groups |
| `src/features/search/search-result-row.test.tsx` | Component | Scalar emoji/Vietnamese highlight, literal HTML, context/null, shortcut/conflict |
| `src/features/search/search-error-copy.test.ts` | Unit | Mọi typed code, failures và transport không leak raw data |
| `src/app/search-entry.test.tsx` | Component | Toàn bộ allowlist/unknown, route context, getProject/getSession/createSession boundary, busy/abort/stale/uncertain create, keyboard current snapshot |
| `src/app/app-topbar.test.tsx` | Component | No-drag entry, tooltip/current keycap, giữ bell/window actions |
| `src/app/app-shell.test.tsx` | Component | Mount duy nhất, route/Quit/notification interaction và focus |
| `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` | Component | Action search bỏ Not available yet; mười action còn lại không đổi |

Unit/component dùng IPC mocks có kiểm soát, không runtime mock trong app. Dùng Rust integration/contract suite hiện hữu để kiểm chứng boundary, không viết test backend trùng logic FE. Mọi function/callback/helper/test khi implement có comment mục đích bằng English.

### Chốt bổ sung khi lập PLAN stage 12

- `contextReady=false` chặn search trong lúc app resolve context; khi resolve lỗi, app đặt context null và contextReady=true. Prop này phân biệt context toàn cục hợp lệ với context chưa xác định; không dựng request null tạm rồi request project.
- Dialog luôn preventDefault trong onCloseAutoFocus và gọi public onClosed. App quyết định restore opener/pill khi user đóng hoặc target giữ nguyên route; route đổi/Quit/hidden/unmount không restore. Như vậy focus không bị Radix trả về control cũ sau navigation.
- Không cần sửa provider Settings: app tăng refreshKey khi nhận snapshot commit mới, không tăng vì render thông thường; callback/onClose/availability giữ identity ổn định hoặc hook đọc ref để không tự tạo request loop.
- Smoke/p95 native chỉ chạy trong Windows Sandbox, VM hoặc tài khoản Windows kiểm thử riêng đã có sẵn, dùng app-data/profile và folder disposable của môi trường đó. Production không có override app-data công khai cho binary; không giả định biến XWORK_APP_DATA hoặc đổi APPDATA process-global là seam hợp lệ. Nếu chưa có môi trường cô lập hoặc công cụ đo invoke trong WebView dev, ghi pending và điều kiện unblock; không thêm backend harness/permission/debug command vào phạm vi FE009.

## Mở rộng giai đoạn 13 — Data/reset boundary

- `FE-015-settings-data.md` bổ sung maintenance suspension tại app SearchEntry: khi bắt đầu Data modal/apply hoặc nhận aggregate change, đóng Palette, retire AbortController/context generation và không restore focus cũ. Guard activation kiểm tra generation đồng bộ cả trước và sau mỗi await để createSession/getSession/getProject response cũ không điều hướng sau reset.
- Sau import, lần mở kế resolve lại context thật và search bằng snapshot shortcut đã refresh. Sau reset, không giữ selected target/session context cũ; không tự mở Palette hoặc navigate từ response trước commit.
- Public CommandPalette giữ nguyên contract; app có thể dùng refreshKey/close hiện hữu. Không thêm Data/reset/export action vào catalog hoặc mở rộng executor stage 12. Không đăng ký event BE-010 giả; data aggregate do app bridge FE-015 sở hữu.
- Phạm vi FE-009 chỉ `src/app/search-entry.tsx` và `src/app/search-entry.test.tsx` trong inventory hiện hữu; bridge/owner refresh thuộc inventory FE-015. Native smoke/p95 vẫn pending.

## Câu hỏi mở

Không có.
