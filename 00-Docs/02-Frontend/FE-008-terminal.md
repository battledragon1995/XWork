# FE-008 — Terminal

Tài liệu đặc tả pane terminal dùng WTerm/Ghostty, vòng đời renderer và giao tiếp với PTY. Các quyết định về giữ toàn bộ lịch sử trong RAM, `Clear Screen` giữ lịch sử, clipboard qua Rust và chỉ mở HTTP/HTTPS đã được người dùng chốt ngày 2026-09-05.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-008` |
| Phase | `1` |
| Khu vực chính | `src/features/terminal/` |
| Yêu cầu chức năng | `§10.1`, `§18`; liên quan `§8.1–8.3`, `§9`, `§10.3`, `§17.2`, `§5.3–5.4` |
| Wireframe | [Terminal trong pane](../01-Wireframe/04-Projects.html#panes-1) |
| Backend liên quan | `BE-007`; `BE-005` sở hữu session/tab/pane, `BE-006` sở hữu profile; `BE-008` cung cấp Appearance qua FE-012 |
| Phụ thuộc | `FE-001`, `FE-006`, `FE-007`, `FE-012`; dùng điểm điều hướng Settings của `FE-013` khi profile lỗi |

## Mục tiêu

Người dùng chạy và tương tác với Terminal/Codex/Claude/custom CLI ngay trong pane, cuộn và tìm lịch sử, sao chép/dán, xóa màn hình và mở liên kết. Terminal tiếp tục nhận output khi chuyển tab/phiên, phóng to pane khác hoặc ẩn cửa sổ; mở lại tab vừa đóng chỉ hiện terminal đã dừng cùng lịch sử cũ.

### Ngoài phạm vi

- CRUD profile, chọn công cụ, cấu trúc tab/pane, close confirmation và khởi động lại tiến trình đã kết thúc.
- Lưu output ra ổ đĩa, khôi phục sau Quit/webview reload, tìm xuyên nhiều terminal, regex và tìm trong byte ANSI thô.
- Mở file/path, `file:`, `mailto:` hoặc custom URL scheme từ terminal; tự mở URL hay tự đọc/ghi clipboard từ escape sequence.
- Settings phím tắt, notification heuristic, tính năng đồ họa terminal bổ sung hoặc nâng phiên bản thư viện không liên quan.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/terminal/index.ts` | Public entry của terminal. |
| `src/features/terminal/terminal-provider.tsx` | Sở hữu registry và listener suốt đời main webview. |
| `src/features/terminal/terminal-pane.tsx` | Gắn vùng terminal được registry giữ vào pane đang hiển thị; status, menu, find bar. |
| `src/features/terminal/terminal-registry.ts` | Pending launch, ownership theo ID, ordering, reconnect, retained/disposed và input queue. |
| `src/features/terminal/wterm-adapter.ts` | WTerm/Ghostty, đo cell, theme, input/IME, selection, viewport và clear screen. |
| `src/features/terminal/terminal-search.ts` | Tìm trên scrollback và grid, ánh xạ grapheme/cell, hủy lượt tìm cũ. |
| `src/features/terminal/terminal-actions.tsx` | Menu có nhãn cho copy/paste/find/clear/link và truy cập lịch sử bằng bàn phím. |
| `src/features/terminal/terminal-find-bar.tsx` | Query, kết quả hiện tại/tổng, trước/sau, đóng. |
| `src/features/terminal/terminal-error-copy.ts` | Mapping lỗi typed sang thông điệp và hành động tiếng Anh. |
| `src/features/terminal/terminal.css` | Ánh xạ token Appearance sang WTerm; focus, selection, viewport và find highlight. |
| `src/lib/ipc/terminal.ts` | Chín command BE-007 và listener state; tạo raw Channel, kiểm frame. |
| `src/app/session-terminal-route.tsx` | Ghép public entry Terminal vào render slot của Sessions và callback điều hướng. |
| `src/app/app-router.tsx` | Route session dùng composition wrapper. |
| `src/app/app-providers.tsx` | Mount TerminalProvider một lần bên ngoài route. |
| `src/features/sessions/session-route.tsx` | Nhận và truyền render slot; cung cấp session ID và refresh callback. |
| `src/features/sessions/session-workspace.tsx` | Truyền render slot cùng target/tab active. |
| `src/features/sessions/pane-layout.tsx` | Truyền render slot đến leaf, giữ thông tin hidden/active. |
| `src/features/sessions/session-pane.tsx` | Render slot cho `toolSelection`/`terminal`; FE-007 tiếp tục sở hữu header. |
| `src/features/sessions/pane-content-placeholder.tsx` | Giữ fallback file; bỏ thông báo terminal trì hoãn ở đường tích hợp thật. |
| `src/features/sessions/use-workspace-shortcuts.ts` | Bỏ qua toàn bộ subtree terminal, cả khi target không phải textarea. |
| `src/bindings/terminal/terminal.ts` | DTO và lỗi BE-007 sinh từ Rust, không sửa tay. |
| `src/bindings/sessions/sessions.ts` | Dùng union content có sẵn; không đổi DTO Sessions. |
| `package.json` | Thêm exact `@wterm/react`, `@wterm/dom`, `@wterm/ghostty` cùng `0.3.4`. |
| `pnpm-lock.yaml` | Lockfile do pnpm sinh. |
| `src/vite-env.d.ts` | Kiểu import WASM URL nếu kiểu Vite hiện tại chưa bao phủ. |
| `src/features/terminal/terminal-pane.test.tsx` | Component: trạng thái, focus, menu, find, read-only. |
| `src/features/terminal/terminal-registry.test.ts` | Unit: lifecycle, stream, input, resize, race và recovery. |
| `src/features/terminal/wterm-adapter.test.ts` | Unit: cấu hình core, theme, clear, clipboard routing, teardown. |
| `src/features/terminal/terminal-search.test.ts` | Unit: toàn history, Unicode, wrap, tìm hủy được. |
| `src/features/terminal/terminal-actions.test.tsx` | Component: keyboard, clipboard/link và lỗi. |
| `src/features/terminal/terminal-find-bar.test.tsx` | Component: query, kết quả rỗng, navigation và trả focus. |
| `src/lib/ipc/terminal.test.ts` | Unit/contract: tên command, payload, framing, errors và listener cleanup. |
| `src/app/session-terminal-route.test.tsx` | Component: composition, launch và route switch. |
| `src/app/app-router.test.tsx` | Regression route/breadcrumb session. |
| `src/features/sessions/session-route.test.tsx` | Regression render slot và nhánh picker. |
| `src/features/sessions/session-workspace.test.tsx` | Regression tab switch, callback refresh và close. |
| `src/features/sessions/pane-layout.test.tsx` | Regression target và visibility 1–4 pane. |
| `src/features/sessions/session-pane.test.tsx` | Regression header và terminal slot. |
| `src/features/sessions/pane-content-placeholder.test.tsx` | Regression fallback phù hợp phạm vi. |
| `src/features/sessions/use-workspace-shortcuts.test.ts` | Không chiếm input terminal/IME. |
| `src-tauri/Cargo.toml` | Dependency clipboard Rust và URL parser theo phần bổ sung BE-007. |
| `src-tauri/Cargo.lock` | Lockfile Rust do Cargo sinh. |
| `src-tauri/src/app/mod.rs` | Khởi tạo clipboard adapter, đăng ký ba command tương tác. |
| `src-tauri/src/terminal/mod.rs` | Export contract tương tác. |
| `src-tauri/src/terminal/models.rs` | `TerminalInteractionError` được sinh binding. |
| `src-tauri/src/terminal/commands.rs` | Ba entry point clipboard/link mỏng. |
| `src-tauri/src/terminal/interactions.rs` | Validate URL/text/target, clipboard và opener Rust qua adapter test được. |
| `src-tauri/src/terminal/manager.rs` | Cho interaction service đọc shutdown gate qua method cùng capability, không truy cập runtime map. |
| `src-tauri/tests/terminal_interactions.rs` | Contract/integration ba command; không truy cập clipboard thật trong test tự động. |
| `src-tauri/tests/export_bindings.rs` | Sinh và xác minh interaction error. |
| `src-tauri/tests/app_builder.rs` | Registration và adapter composition. |
| `src-tauri/tests/terminal_runtime.rs` | Regression stream/PTY boundary hiện có. |
| `src-tauri/tests/terminal_pty_windows.rs` | Regression ConPTY với input/resize/burst. |

Không có migration. CSP cho phép `'wasm-unsafe-eval'` và production cần `style-src-attr 'unsafe-inline'` để WTerm áp dụng màu/kiểu chữ động cho từng ô; `style-src 'self'` và chính sách script giữ nguyên. Capability custom command main-only không đổi; không thêm quyền clipboard/opener cho JavaScript. Kiểm chứng WASM và style ô trên cả dev lẫn production.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `TerminalPane` | Lấp phần nội dung dưới header FE-007; nền tối/màu Appearance, monospace, không padding khiến grid bị cắt. | `#panes-1`: Claude, output màu và prompt chờ `y/n`. |
| `TerminalActions` | Nút `Terminal actions` luôn nhìn thấy trong góc vùng nội dung, cùng menu ngữ cảnh. Menu có Copy, Paste, Find, Clear Screen, Browse History, Jump to Latest; thêm Open Link/Copy Link khi có target. | Bổ sung tương tác §10.1/§18; wireframe không vẽ menu. |
| `TerminalFindBar` | Thanh tìm trong pane, không làm đổi kích thước PTY; có label `Find in terminal`, Previous, Next, Close và bộ đếm. | Không có trạng thái riêng trong wireframe. |
| Vùng trạng thái | Loading/error/process ended, thông điệp có tên terminal, hành động retry hoặc đến Settings/Project. | Bổ sung trạng thái §18. |

Header icon/title/path/attention và các nút Split/Maximize/Close tiếp tục thuộc FE-007. Output từ PTY không được đổi tên tab/session hoặc tự suy luận attention từ từ khóa. Không đưa nội dung mẫu của wireframe vào terminal thật.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang chuẩn bị | WASM/font/grid chưa sẵn sàng | `Preparing terminal…`, `aria-busy`; chưa start và chưa nhận input. |
| Đang khởi chạy | `ToolSelection`, đã đo grid, start đang bay | `Starting {title}…`; một request theo pane, menu input bị khóa. |
| Rỗng | Running nhưng chưa có output | `Waiting for output. You can type a command below.` trong status ngoài grid; vùng input vẫn focus được. Gỡ gợi ý sau output đầu. |
| Running | Core và stream hợp lệ | Output, cursor, input; không hiện badge thành công cho từng command người dùng gõ. |
| Không tìm thấy | Query khác rỗng, lượt tìm hoàn tất có zero match | `No matches`; Previous/Next disabled, vẫn sửa query được. |
| Đang tìm | History scan chưa xong | `Searching…`; query/Close vẫn đáp ứng. |
| Đang nối lại | Gap/detach có thể replay | `Reconnecting output…`; giữ nội dung, khóa input người dùng tới khi stream liên tục. |
| Mất đoạn output | `outputReplayUnavailable` hoặc core mất sau reload | `Output history is incomplete. This terminal cannot be recovered.`; giữ phần cũ read-only, cho Close Pane qua owner. Không ghép tail hoặc auto-spawn. |
| Lỗi chuẩn bị/launch | Core/WASM/font/start lỗi | `Couldn't start {title}.` và Try again khi retry an toàn; lỗi project/profile có hành động riêng dưới đây. |
| Closing | Snapshot backend đang đóng | `Stopping {title}…`; input/Paste disabled, copy/find vẫn dùng. |
| Exited/Failed | Backend kết thúc | Ngừng input ngay; chờ final output tới đủ trước dòng `Process exited (code {code}).` hoặc `Process stopped.`/`Terminal failed.`; không tự restart. |
| Lỗi thao tác | Clipboard/link/resize/input lỗi | Alert cục bộ nêu hành động thất bại; không xóa history. Input có kết quả không chắc chắn bị khóa, không tự gửi lại. |

### Tương tác

Phím dưới đây là phím cục bộ Windows khi focus thuộc terminal, không thêm action vào catalog BE-009. `Ctrl+C`, `Ctrl+V`, `Ctrl+F`, `Ctrl+L`, Tab và Escape không có hành động UI đang mở vẫn được chuyển cho CLI. Command Palette đã đăng ký là ngoại lệ toàn ứng dụng theo BE-009; FE-008 không tự triển khai nó.

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Gõ/IME/paste hợp lệ | WTerm phát input, registry gửi tuần tự theo ack; không local echo. | Phím CLI qua WTerm; không xử lý trong composition. |
| Copy selection | Chụp selection thuộc terminal, gọi Rust ghi clipboard văn bản thuần; giữ selection. Disabled khi không chọn. | `Ctrl+Shift+C` |
| Paste | Gọi Rust đọc clipboard theo hành động chủ động, đưa qua chế độ paste của adapter. Không tự thêm Enter. | `Ctrl+Shift+V` |
| Chọn văn bản | Mouse selection bình thường; khi CLI mouse mode, giữ Shift để chọn thay vì gửi mouse event. | Browse History cho chọn bằng bàn phím. |
| Browse History | Mở vùng văn bản chỉ đọc trong pane từ history/grid hiện tại; focus vào vùng, hỗ trợ Shift+mũi tên, Ctrl+A, Copy. Snapshot chỉ tạo khi mở; đóng thì giải phóng. | Menu; `Escape` đóng và trả focus terminal. |
| Cuộn | Giữ vị trí khi output mới đến nếu đang xem lịch sử; ở đáy thì theo output. | Trong Browse History: PageUp/PageDown/Home/End. |
| Jump to Latest | Về đáy và focus input. | Menu; không chiếm phím CLI. |
| Find | Focus query, giữ query riêng mỗi terminal trong runtime. | `Ctrl+Shift+F` |
| Next/Previous | Cuộn tới và đánh dấu match; quay vòng đầu/cuối, bộ đếm `i / n`. | Enter/Shift+Enter trong find bar. |
| Đóng find | Gỡ highlight, trả focus input nếu pane còn tồn tại. | Escape trong find bar. |
| Clear Screen | Đẩy grid chính hiện tại vào history rồi làm trống màn hình/cursor về đầu; không xóa history hoặc gửi input PTY. | Menu; không chiếm `Ctrl+L`. |
| Open Link | Mở URL HTTP/HTTPS bằng Rust opener sau click chủ động; không điều hướng main webview. | Ctrl+click; menu Open Link, Enter trên link đang focus. |
| Copy Link | Ghi URL target qua cùng clipboard command, không mở. | Menu. |
| Focus terminal | FE-007 activate pane; chỉ acknowledge attention khi pane visible và main window thực sự focus. | Qua Tab tới vùng nhập; `Ctrl+Alt+F6` chuyển từ input lên nút Terminal actions. |

Copy/Paste native của WebView bên trong terminal cũng phải đi qua adapter/IPC, không rơi vào clipboard mặc định của WTerm. Chặn default trước khi chờ IPC. Paste xong focus input chỉ nếu cùng pane còn active; không giật focus từ dialog/route khác.

Mỗi icon có tooltip và accessible name; menu dùng arrow keys/Enter/Escape, focus ring nhìn thấy trên nền terminal. Không đặt `aria-live` lên toàn output có thông lượng cao. Status dùng `polite`, lỗi thao tác dùng alert. Browse History cung cấp đường đọc/chọn text bằng bàn phím và screen reader, không bẫy Tab trong chế độ CLI; phím thoát focus được mô tả bằng `aria-describedby`.

### History, find và Clear Screen

- History là văn bản/cell đã được terminal diễn giải ở primary screen cùng grid đang hiển thị; không phải log byte thô hay bản ghi mọi lần cursor ghi đè. Alternate screen hoạt động theo VT, không tự thêm từng frame TUI vào primary history; khi đang ở alternate screen, find bao gồm primary history có sẵn và grid alternate hiện tại.
- Không đặt giới hạn số dòng hoặc TTL ở XWork, không evict vì pane hidden. Cấu hình `GhosttyCore.load({ scrollbackLimit: 4294967295 })` dùng mức `u32` tối đa thay mặc định của 0.3.4, nhằm tránh eviction theo budget trước giới hạn bộ nhớ WASM. Đây là budget byte của engine, không phải bảo đảm RAM vô hạn. Không dùng `Infinity`, số âm hoặc `0` như một sentinel chưa được API công bố.
- Kiểm thử phải xác nhận history không bị loại bỏ trong fixture vượt nhiều lần budget mặc định, cả khi resize/ẩn/reopen. Nếu core không thỏa giữ history hoặc hết khả năng cấp phát, báo lỗi renderer/history và dừng nhận input; không tự giảm budget, drop dòng hay báo history đầy đủ. Không thêm patch dependency ngầm; nếu cần patch/nâng core để đạt contract, phải giải quyết thay đổi dependency riêng trước khi đánh dấu triển khai hoàn thành.
- `Clear Screen` chỉ áp dụng primary screen. Adapter thực hiện thao tác hiển thị cục bộ tuần tự giữa hai frame output: chuyển các row hiện có vào scrollback, xóa viewport và đưa cursor về đầu; không reset mode, palette hoặc input sequence. Không dùng RIS hay `CSI 3 J`. Trong alternate screen, action disabled với tooltip `Clear Screen is unavailable while an application controls the screen.` để không phá TUI. Thao tác không gọi `write_terminal` và không tự phản hồi protocol vào PTY.
- Find literal, phân biệt hoa/thường, không regex, không chuẩn hóa Unicode ngầm. Query rỗng không tạo match. WTerm 0.3.4 không công bố marker hard/soft wrap trong cell API: tìm trong từng visual row, hiển thị `Search matches text within each displayed line.` ngay trong find bar. Không suy đoán hard/soft wrap từ khoảng trắng; toàn bộ row lịch sử vẫn thuộc phạm vi tìm.
- Dùng `getScrollbackCount`, `getScrollbackLineLen`, `getScrollbackCell` và `getCell`; ưu tiên `CellData.chars` cho combining/ZWJ, bỏ continuation cell của wide glyph. Tọa độ kết quả ánh xạ về cell, không lấy UTF-16 index làm cột. Kết quả bao gồm cả phần DOM chưa mount; không dùng browser find.
- Scan theo lát tối đa 8 ms rồi yield, không giữ chuỗi sao chép toàn history trong mỗi lần gõ. Mỗi query có generation; đổi query, resize/reflow hoặc clear vô hiệu kết quả cũ. Output mới đánh dấu cần cập nhật nhưng không hủy liên tục lượt đang chạy; hoàn thành lượt trên snapshot revision hiện tại rồi quét phần đổi. Không công bố tổng chính xác trước khi scan hoàn tất.
- Không ghi history/query/selection/clipboard vào localStorage, SQLite, log, backup hoặc thông báo. Browse History là bản sao tạm có chủ đích để tiếp cận nội dung, được bỏ khi đóng.

### WTerm, theme và kích thước

- Khóa ba package WTerm `0.3.4`. Dùng WTerm DOM imperative trong React wrapper để giữ nguyên instance/element khi route unmount; không tạo lại `<Terminal>` rồi vô tình gọi `core.init` trên core đang giữ history. Không dùng core Zig hoặc `WebSocketTransport`.
- `GhosttyCore.load` tải WASM asset đi kèm package qua URL do Vite bundle; không CDN. Truyền `onData` từ đầu, kể cả khi chưa start thì handler chỉ khóa input; không để WTerm local echo mặc định. Response từ core như terminal query reply cũng đi qua hàng input tuần tự, không bị mất chỉ vì DOM đang hidden.
- Registry giữ WTerm, Ghostty core và element riêng từng terminal. Pane chỉ gắn/tháo element; ẩn thì giữ trong container không tương tác do provider sở hữu. Không gọi `destroy/init` khi đổi route. Khi dispose: destroy WTerm, hủy timer/observer/listener và bỏ mọi tham chiếu tới core/WASM/element để GC thu hồi; không gọi API `dispose()` chưa tồn tại trong Ghostty 0.3.4.
- Đọc token FE-012: `--terminal-background`, `--terminal-foreground`, `--terminal-ansi-0` đến `--terminal-ansi-15`, `--terminal-font-size`. Theme cập nhật instance hiện có; không reset history. Đổi font/theme bằng Settings khi terminal ở nền phải có hiệu lực khi hiện lại.
- Tắt autoResize nội bộ nếu nó không tính đúng zoom; adapter là owner đo và resize. Đợi font ready và viewport khác zero. Lấy số cell từ kích thước nội dung thực chia kích thước cell đo trong cùng hệ tọa độ; tránh nhân `--ui-scale` hai lần. Kẹp columns `2..500`, rows `1..300`, không gửi zero khi hidden.
- Đo lại sau layout/font/zoom đổi; gộp resize trong khoảng lặng 50 ms, gửi size cuối, bỏ trùng. Core resize và PTY resize là hai bước được theo dõi bằng ack; lỗi giữ `lastAckSize`, hiện lỗi và thử lại ở lần đo hợp lệ kế tiếp hoặc Try again, không loop vô hạn. Khi hiện lại pane phải đo trước khi cho gõ.

## Luồng chính

1. App mount TerminalProvider trước các route; đăng ký state listener trước khi cho phép start. App ghép TerminalPane vào render slot Sessions khi content là `toolSelection` hoặc `terminal`.
2. Với ToolSelection, tạo pending entry theo `(sessionId, tabId, paneId)`, load core, init WTerm một lần, đo viewport rồi tạo Channel trước `start_terminal`. Output có thể đến trước command result và được ghi đúng thứ tự vào pending core.
3. Start thành công đổi khóa entry sang `terminal.id`, refresh Sessions để nhận content authoritative. Không tạo WTerm thứ hai khi `toolSelection` đổi thành `terminal`. Start thất bại cleanup pending entry; retry chỉ khi target còn launchable. Route unmount trong lúc start không hủy ownership hay tự spawn lại.
4. Registry kiểm frame/reorder, đưa byte liên tục qua `WTerm.write(Uint8Array)`. Input chỉ gửi khi running, stream lành và target còn hợp lệ. Process reply vẫn được xử lý khi terminal chạy nền.
5. Route switch/maximize/hide chỉ tháo view. Existing `terminal` dùng lại registry và query snapshot; nếu registry thiếu thì subscribe từ `null`, chỉ phục hồi khi backend còn frame từ sequence 1, đồng thời khôi phục input sequence như quy tắc bên dưới. Không coi replay ring 8 MiB là toàn history.
6. Close do Sessions xác nhận và thực hiện. Registry giữ exited core của tab được retain. `disposed` mới giải phóng; nếu event mất, query entry không còn trong layout khi window focus/reconcile, chỉ xóa sau `terminalNotFound`. Reopen gắn lại cùng ID/core, không start.

## Contract với backend

Nguồn DTO là `src/bindings/terminal/terminal.ts`; [BE-007](../03-Backend/BE-007-terminal-and-pty.md) là authority, gồm phần bổ sung interaction. Sáu command PTY đã có trong code; ba command clipboard/link chưa có implementation tại thời điểm viết tài liệu.

### Command sử dụng

Tên field dưới đây là payload JavaScript camelCase; ID và sequence không chuyển qua `Number`.

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `start_terminal` | `sessionId`, `tabId`, `paneId`, `initialSize: PtySizeDto`, `onOutput: Channel<ArrayBuffer>` | `TerminalDto` | Target stale: refresh Sessions; already attached: dùng ID authoritative; project/profile lỗi: điều hướng/kiểm tra lại; PTY/spawn/attach: lỗi launch, retry chỉ sau reconcile; shutting down: không retry. |
| `get_terminal` | `terminalId` | `TerminalDto` | Not found: dispose/reconcile; unauthorized/invalid ID: lỗi tích hợp, không loop. |
| `subscribe_terminal_output` | `terminalId`, `afterSequence: string \| null`, `onOutput` | `TerminalSubscriptionDto` | Replay unavailable: giữ phần cũ read-only; attach failed: Retry connection; invalid sequence: reconcile, không nhảy qua gap. |
| `write_terminal` | `terminalId`, `inputSequence`, `data` | `TerminalInputAckDto` | Out of order: đối chiếu expected; too large: lỗi chunker; not running: read-only; I/O/unknown outcome: khóa queue, không resend tự động. |
| `resize_terminal` | `terminalId`, `resizeSequence`, `size` | `TerminalResizeAckDto` | Invalid size: đo lại; resize failed: giữ ack cũ; not running: bỏ resize PTY, vẫn cho đọc view. |
| `acknowledge_terminal_attention` | `terminalId` | `TerminalDto` | Not found: reconcile; unauthorized: không retry; không đổi Sessions summary optimistic. |
| `read_terminal_clipboard` | `terminalId` | `string \| null` | Interaction error; clipboard không có text: thông báo `Clipboard has no text.`; không gửi input. |
| `write_terminal_clipboard` | `terminalId`, `text` | `null` | Clipboard unavailable/unsupported: `Couldn't copy text. Try again.`; giữ selection. |
| `open_terminal_link` | `terminalId`, `url` | `null` | Invalid URL: `Only HTTP and HTTPS links can be opened.`; open failed: cho Try again/Copy Link. |

`profileUnavailable` phân biệt commandNotFound → Check again qua callback đến profile catalog, shellNotFound → Terminal Settings, credentialMissing → profile editor, credentialStoreUnavailable → Try again. ProjectUnavailable → Open Project để Locate folder qua FE-004. Callback đi qua app, terminal không import settings/projects/sessions implementation. `profileNotFound` quay về picker bằng refresh; không khởi chạy profile khác thay thế.

Lỗi không nhận diện được không hiển thị raw rejection. Thông điệp chung nêu thao tác/terminal; chỉ cho retry với query/read/copy/open hoặc launch đã xác minh chưa attach. Không log input/output, URL, clipboard hoặc native error.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| Channel riêng của start/subscribe | Raw v1: byte version tại 0, `u64` LE sequence tại 1, `u32` LE length tại 9, payload tại 13 | Suốt đời entry, cả hidden/retained đang drain | Kiểm length `1..32768`, header tổng chính xác, version 1; reorder trước write. |
| `terminal://state-changed` | `TerminalStateChangedDto` | Provider listener main-only | Process/attention/detach/disposed; chờ final sequence để chốt thông báo kết thúc. |

- Sequence xử lý bằng `bigint`, serialize decimal string khi invoke. Frame `<= lastApplied` bỏ; buffer frame tương lai tối đa 256 frame hoặc 8 MiB, gap chờ tối đa 250 ms rồi resubscribe từ lastApplied. Frame lỗi cũng vào recovery, không decode/re-encode PTY bằng TextDecoder.
- `lastApplied` chỉ tăng sau write thành công. Subscribe một request mỗi entry, callback generation ngăn subscriber cũ làm sống lại entry đã dispose. Không bỏ frame hợp lệ của subscriber cũ trước khi subscriber mới attach thành công; duplicate được loại theo sequence. Nếu backend replay không còn đủ, không mở lại stream từ tail.
- Event và invoke result không có total order: final/disposed đã quan sát không được snapshot cũ đưa về running. Khi mâu thuẫn query lại; tombstone disposed thắng callback đang bay. Chốt final sau khi lastApplied đạt `finalOutputSequence`; nếu thiếu frame, chạy recovery thay vì bỏ output cuối.
- Provider query khi entry attach view/window focus và mỗi 5 giây cho entry đang chạy/closing hoặc detached để phát hiện state event mất. Không poll output payload. Retained/unreferenced entry được query ở reconcile để thu hồi event disposed bị mất.

### Input, clipboard và link

- Input sequence bắt đầu `1`, một invoke đang bay mỗi terminal, tăng sau ack. Chunk UTF-8 tối đa 65536 byte, cắt ở Unicode scalar boundary. Queue chưa gửi tối đa 1 MiB; paste lớn được giữ dưới dạng một nguồn text và bơm từng chunk sau ack, không enqueue hàng nghìn invoke. Khi queue đầy, chặn input thêm và thông báo `Terminal input is busy.`; không âm thầm drop phím đã nhận.
- Nếu nhận `inputOutOfOrder.expectedSequence = sentSequence + 1`, backend đã nhận chunk trước đó: bỏ chunk đó và tiếp tục ở expected. Nếu expected bằng sentSequence sau lỗi validation an toàn, sửa payload/chunk rồi mới retry theo hành động người dùng. Mọi chênh lệch khác khóa input/reconcile; không tự phát lại command có kết quả không biết chắc.
- Snapshot BE-007 hiện không chứa input/resize ack cursor. Khi registry bị mất nhưng terminal vẫn tồn tại, khôi phục input cursor bằng một `write_terminal` với `data: ""`, `inputSequence: "1"`: ack nghĩa cursor tiếp theo 2; `inputOutOfOrder` cung cấp expected mà không ghi byte. Không probe bằng dữ liệu người dùng. Resize cursor phục hồi bằng ack từ một resize cùng size hiện tại, sequence `1`, sau đó dùng acceptedSequence + 1.
- Đọc clipboard chỉ khi người dùng yêu cầu Paste và terminal running. Sau await phải kiểm tra entry/activation generation; nếu pane đã đổi/đóng thì bỏ kết quả, không dán vào terminal khác. Chuyển CRLF và LF thành CR theo input terminal; giữ nguyên các ký tự khác. Nếu bracketed paste bật, bọc toàn bộ thao tác bằng `ESC[200~`/`ESC[201~` một lần, không bọc riêng từng chunk; chặn delimiter kết thúc bracketed paste nhúng trong clipboard bằng loại byte ESC khỏi nội dung paste. Không lọc ESC của input CLI hay output PTY.
- Không dùng `navigator.clipboard`, clipboardData từ native paste hoặc clipboard behavior mặc định của dependency. Intercept event trong subtree trước WTerm; Rust trả text, adapter áp paste mode. Không gửi clipboard vào CLI chỉ vì core nhận OSC 52; OSC 52 không gọi IPC và không trả clipboard response.
- Nhận diện URL OSC 8 và URL text thường trong output đã render; target có scheme HTTP/HTTPS, parser backend kiểm tra lại. Hiển thị URL thực trong tooltip/menu để phân biệt OSC 8 label với target. Text URL kết thúc ở whitespace/control, bỏ punctuation cuối `. , ; ! ?` và dấu đóng ngoặc không có dấu mở tương ứng; không đoán path thành URL.
- Chặn navigation mặc định của anchor/WebView. Link không trở thành HTML do output cung cấp; render text escaped. Thao tác Open Link luôn từ click/menu/keyboard của người dùng; protocol sequence, hover, find và replay không mở link.

## State frontend

```ts
interface TerminalViewState {
  terminal: TerminalDto | null;
  phase: "preparing" | "starting" | "ready" | "recovering" | "unrecoverable" | "error";
  lastApplied: bigint;
  finalSequence: bigint | null;
  lastAckSize: PtySizeDto | null;
  query: string;
  searchGeneration: number;
  searchStatus: "idle" | "searching" | "complete";
  matchCount: number;
  activeMatch: number | null;
  failure: string | null;
  /** Changes the local query and invalidates the previous scan. */
  setQuery(query: string): void;
  /** Moves focus and the viewport to an adjacent match. */
  moveMatch(direction: "next" | "previous"): void;
  /** Reattaches output from the last successfully applied sequence. */
  reconnect(): Promise<void>;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Session/tab/pane/profile/process state | Backend | Không sao chép business state thành persistence frontend; TerminalDto là snapshot có reconcile. |
| WTerm/core/history/element/Channel | Registry trong provider | Không đưa vào React state hoặc serialize Zustand; sống độc lập DOM pane, giữ qua reopen slot. |
| Pending launch, input/resize/output sequence, queue, callback generation | Registry theo target/terminal ID | Không reset do rerender/StrictMode; dispose bỏ tất cả. |
| Find, selection, scroll position, menu/Browse History | UI theo terminal | Không qua backend; Browse History snapshot chỉ tồn tại khi mở. |
| Palette/font | CSS token FE-012 | Terminal chỉ tiêu thụ; không ghi Settings hoặc import store của Settings. |

## Contract công khai của feature

Public entry Terminal chỉ được app sử dụng. Sessions nhận render callback từ app; không import Terminal. FE-008 mở rộng điểm ghép của FE-006/FE-007 bằng prop tùy chọn `renderTerminal`, truyền xuyên route/workspace/layout/pane; đây là integration slot, không thay ownership header/layout hoặc DTO backend.

```ts
export interface TerminalPaneProps {
  sessionId: string;
  tabId: string;
  paneId: string;
  content: Extract<PaneContentDto, { kind: "toolSelection" | "terminal" }>;
  isActive: boolean;
  isVisible: boolean;
  /** Activates the owning pane through the Sessions owner. */
  onActivate(): void;
  /** Reconciles backend content after launch or a stale target. */
  onRefreshSession(): void;
  /** Opens the project owning the current session. */
  onOpenProject(): void;
  /** Opens terminal settings, optionally targeting the profile editor. */
  onOpenTerminalSettings(profileId?: string): void;
  /** Rechecks availability through the owning tool catalog. */
  onCheckProfile(profileId: string): void;
}

/** Owns all terminal resources independently of mounted routes. */
export function TerminalProvider(props: { children: React.ReactNode }): React.JSX.Element;

/** Attaches the retained terminal surface to one Sessions pane. */
export function TerminalPane(props: TerminalPaneProps): React.JSX.Element;
```

Sessions định nghĩa shape slot ngay trong `session-route.tsx`, chỉ gồm sessionId/tabId/paneId/content/isActive/isVisible và các callback activate/refresh/check của owner; không import kiểu `TerminalPaneProps`. App wrapper bổ sung callback điều hướng Project/Settings. Slot trả `React.ReactNode`, không nhận process handle hoặc command string. Nhánh session chưa có tab và pane `empty` tiếp tục dùng picker; file tiếp tục fallback hiện tại.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| StrictMode effect mount/unmount, rerender khi start đang bay | Registry gate và pending core vẫn duy nhất; không spawn hai lần hoặc echo input vào core pending. |
| Start thành công sau khi route rời pane | Adopt entry bằng ID, tiếp tục output nền; không giật focus hoặc tự điều hướng lại. |
| Pane bị đóng trong lúc start | Backend attach compensation là authority; reconcile và bỏ pending core, không tạo terminal thay thế. |
| Chuyển tab/phiên/maximize rồi quay lại | Cùng core/history/scroll position, đo lại size, không replay từ 0 hoặc reset input sequence. |
| Mở lại tab đã đóng | Cùng terminal ID đã stopped, read-only; history và find còn dùng, Paste disabled. |
| Profile đổi tên/xóa hoặc project được Locate sau launch | Giữ terminal hiện tại; không đổi cwd, không spawn lại. |
| Event exited đến trước output cuối | Khóa input ngay, vẫn drain; final label đợi sequence; gap phục hồi theo protocol. |
| Clipboard thay đổi khi Paste đang chờ | Dùng text của lần Rust đọc đó, không đọc lại tự động; pane generation không còn đúng thì bỏ. |
| Copy/link trên terminal stopped | Được phép nếu runtime còn tồn tại; không yêu cầu process running. |
| Paste lỗi sau một số chunk đã ack | Không rollback hoặc gửi lại phần đã ack; thông báo `Only part of the text was sent.`; bỏ phần chưa gửi sau xác nhận đóng lỗi, không tiếp tục âm thầm. |
| Window focus nhưng terminal nằm dưới dialog hoặc pane hidden | Không acknowledge attention, không autofocus input. |
| Callback từ generation cũ sau disposal | Bỏ; không tái tạo registry, menu hoặc notification. |
| UTF-8/ANSI/grapheme chia giữa frame | Giữ byte và thứ tự; core parser xử lý phần tiếp theo, không tự thêm replacement character ở frontend. |
| Resize/theme khi đang tìm | Hủy tọa độ kết quả cũ, scan lại; không highlight nhầm cột hoặc reset query. |
| Core lỗi/cạn bộ nhớ | Giữ thông báo lỗi và phần view còn đọc được; không hứa phục hồi full history từ ring; người dùng đóng qua FE-007. |

## Tiêu chí hoàn thành

- [ ] Chọn tool tạo đúng một terminal tại root backend xác định, chỉ spawn sau measured grid; không còn dòng `Terminals arrive with FE-008.` trong luồng thật.
- [ ] WTerm 0.3.4 dùng Ghostty, asset WASM cục bộ tải được trong dev/prod; không WebSocket/local echo/log nội dung.
- [ ] Test frame đảo thứ tự, duplicate, malformed, gap, replay unavailable, output trước start result và final event trước output đều cho kết quả đúng; không áp byte sau gap.
- [ ] Chuyển tab/session/route, ẩn tray, maximize và reopen không tạo lại core hoặc mất history; disposed giải phóng listener/timer/element/core references.
- [ ] Input đúng thứ tự theo ack, control keys/IME không bị shortcut tab/pane chiếm; paste vượt 64 KiB không lặp/dính chunk hoặc tự thêm Enter.
- [ ] Copy/Paste chỉ qua Rust, OSC 52 không truy cập clipboard; clipboard lỗi hoặc target đổi không làm gửi nhầm terminal.
- [ ] Find thấy dòng đầu và dòng ngoài DOM sau output vượt nhiều lần budget mặc định, hỗ trợ wide/combining/emoji và không treo UI khi query đổi liên tục.
- [ ] Clear Screen không gọi write_terminal, không mất lịch sử tìm được, không reset modes; disabled trong alternate screen.
- [ ] URL text thường/OSC 8 mở qua Rust sau tương tác; HTTP/HTTPS hợp lệ được mở, các scheme khác không bao giờ đến opener; không navigation main webview.
- [ ] Theme/font thay đổi từ FE-012 giữ history, resize đúng khi UI zoom; một đến bốn pane output đồng thời vẫn nhập và kéo resize được.
- [ ] Mọi action có đường vào trực quan và bàn phím, focus không bị kẹt trong terminal, Browse History cho đọc/chọn bằng bàn phím/screen reader; status không đọc từng chunk output.
- [ ] Generated DTO/error khớp Rust; ba command interaction pass contract test main-only và target validation.
- [ ] Trên Windows: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:rust`, `pnpm lint:rust`, `pnpm test:rust` và `pnpm tauri build` pass.
- [ ] Smoke thủ công Windows WebView2: shell/Codex/Claude nếu đã cài, alternate screen, mouse SGR, synchronized output, Unicode/wide/emoji/Vietnamese IME, clipboard, find, links, clear, resize 1–4 pane, tray và close/reopen. Không desktop E2E tự động; macOS hoãn tới release.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/terminal/terminal-pane.test.tsx` | Component | Loading/empty/error/exited, focus, visibility, không launch lại khi đổi content. |
| `src/features/terminal/terminal-registry.test.ts` | Unit | Start gate, raw ordering/recovery, final drain, ack queue, unknown outcome, polling/reconcile, retain/dispose. |
| `src/features/terminal/wterm-adapter.test.ts` | Unit | Core config/ownership, no local echo, resize/zoom/theme, clear giữ history, OSC 52 và clipboard interception. |
| `src/features/terminal/terminal-search.test.ts` | Unit | History ngoài DOM, Unicode cell offsets, boundary row, no match, cancellation và output trong lúc tìm. |
| `src/features/terminal/terminal-actions.test.tsx` | Component | Copy/Paste/link activation, stale clipboard reply, bracketed paste và keyboard history. |
| `src/features/terminal/terminal-find-bar.test.tsx` | Component | Query rỗng/loading/count/wrap navigation/Escape/focus. |
| `src/lib/ipc/terminal.test.ts` | Unit/contract | Chín payload, error union, frame endian/length/sequence, listener cleanup. |
| `src/app/session-terminal-route.test.tsx` | Component | Slot composition, navigation callback, background terminal và một launch. |
| `src/app/app-router.test.tsx` | Component | Session route/breadcrumb giữ contract. |
| `src/features/sessions/session-route.test.tsx` | Component | Truyền slot, picker vẫn đúng. |
| `src/features/sessions/session-workspace.test.tsx` | Component | Tab switch/close/reopen và refresh. |
| `src/features/sessions/pane-layout.test.tsx` | Component | Target/visible/active chính xác cho 1–4 pane/maximize. |
| `src/features/sessions/session-pane.test.tsx` | Component | Slot không lặp header/action, empty/file fallback. |
| `src/features/sessions/pane-content-placeholder.test.tsx` | Component | Fallback không hứa terminal chưa triển khai trong luồng thật. |
| `src/features/sessions/use-workspace-shortcuts.test.ts` | Unit | Editable/subtree terminal/IME được bỏ qua. |
| `src-tauri/tests/terminal_interactions.rs` | Integration/contract | Main-only, terminal tồn tại, read-only/running, clipboard text/null/error, URL validation và không gọi OS adapter khi reject. |
| `src-tauri/tests/export_bindings.rs` | Contract | Interaction error sinh đúng camelCase. |
| `src-tauri/tests/app_builder.rs` | Integration | Registration/plugin/adapter production và mock không chạm OS clipboard. |
| `src-tauri/tests/terminal_runtime.rs` | Integration | Không regression sáu command/Channel. |
| `src-tauri/tests/terminal_pty_windows.rs` | Windows integration | ConPTY burst/Unicode/input/resize/close với fixture. |

## Câu hỏi mở

Không có.

Những giới hạn core/WASM và khác biệt phiên bản phải vượt qua các tiêu chí tương thích nêu trên; không được tự đổi phạm vi history hoặc fallback renderer để đánh dấu hoàn thành.

### Căn cứ đối chiếu

- Overview FE-008, FunctionalRequirements §10.1/§18, wireframe `#panes-1`, ProjectStructure, TechStack; các hợp đồng BE-005/BE-007/BE-009 và FE-006/FE-007/FE-012.
- Mã hiện tại có PTY, binding và session placeholder nhưng chưa cài WTerm/terminal frontend. BE-007 mô tả generic window khác chi tiết `WebviewWindow<R>` hiện có; public payload không đổi, implementation giữ chữ ký generic hiện tại.
- Đã kiểm tra type/source của npm `@wterm/ghostty@0.3.4` và `@wterm/dom@0.3.4`: core có budget scrollback, cell APIs; WTerm init gọi core.init và có fallback local echo. Không suy API từ phiên bản mới. [Mã nguồn WTerm](https://github.com/vercel-labs/wterm) và [tài liệu Ghostty adapter](https://wterm.dev/ghostty) là nguồn đối chiếu upstream; quyết định retention của XWork được ghi riêng ở trên.
