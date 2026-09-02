# FE-001 — Application shell

Tài liệu này đặc tả contract frontend cho khung ứng dụng XWork: sidebar chính, thanh trên cùng, vùng nội dung theo điều hướng, các điều khiển cửa sổ tùy biến và hộp thoại xác nhận `Quit`. Shell không sở hữu dữ liệu nghiệp vụ; mọi thao tác cửa sổ và vòng đời đi qua command/event của `BE-001`.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-001` |
| Phase | `1` |
| Khu vực chính | `src/app/` |
| Yêu cầu chức năng | `§4`, `§5.3–5.4`; áp dụng yêu cầu tương tác chung tại `§18` |
| Wireframe | `01-Wireframe/02-AppShell.html#shell`, `#shell-collapsed`, `#tray`; `01-Wireframe/04-Projects.html#dlg-quit`; trạng thái sidebar rỗng lấy tại `02-AppShell.html#welcome` |
| Backend liên quan | `BE-001`; `BE-002` chỉ gián tiếp qua thứ tự khởi động |
| Phụ thuộc | `Không có` |

`#tray` là menu native do `BE-001` dựng trong Rust, không phải giao diện web. FE-001 chỉ tham chiếu frame này để biết tray phát ra hành động gì và shell phải phản ứng thế nào.

## Mục tiêu

Người dùng mở XWork và thấy một khung ứng dụng hoàn chỉnh: sidebar bốn khu vực có thể kéo đổi độ rộng và thu gọn thành thanh icon, thanh trên cùng có ngữ cảnh hiện tại cùng điểm vào tìm kiếm và thông báo, vùng nội dung đổi theo điều hướng, và các nút cửa sổ tùy biến trong đó Close chỉ ẩn xuống tray. Người dùng thoát ứng dụng qua menu ở wordmark và nhận đúng hộp thoại xác nhận `Quit XWork` khi còn phiên đang chạy.

### Quyết định và giả định đã chốt

- Cửa sổ `main` chuyển sang `"decorations": false` để dùng thanh trên cùng và ba nút cửa sổ tùy biến theo `#shell`. `src-tauri/capabilities/main.json` được mở đúng ba quyền: `core:event:allow-listen`, `core:event:allow-unlisten` cho hai event của `BE-001`, và `core:window:allow-start-dragging` cho vùng kéo cửa sổ. Không mở thêm quyền cửa sổ nào khác; minimize, maximize và hide vẫn đi qua command của `BE-001`.
- Đánh đổi đã chấp nhận: cửa sổ không viền làm mất Snap Layouts khi hover nút Maximize trên Windows 11. Kéo đổi kích thước theo viền vẫn hoạt động vì cửa sổ giữ `resizable`.
- Vì chỉ mở `core:window:allow-start-dragging`, hành vi double-click vùng kéo do runtime Tauri cung cấp bị chặn và không có tác dụng. Shell tự xử lý double-click trên vùng kéo bằng cách gọi `toggle_main_window_maximized`, nên chỉ có một đường đổi trạng thái maximize.
- Độ rộng và trạng thái thu gọn sidebar chỉ giữ trong bộ nhớ tại lát cắt này và reset khi mở lại ứng dụng. Yêu cầu "ghi nhớ" của `§4.1` chỉ hoàn thành đủ khi `BE-008` cung cấp settings persistence ở giai đoạn 6 của roadmap. FE-001 không ghi `localStorage`, `sessionStorage` hoặc bất kỳ persistence nào trong webview.
- FE-001 sở hữu bảng route của ứng dụng. Mỗi khu vực chưa có feature tương ứng render `AreaPlaceholder` dùng chung, nói rõ khu vực sẽ xuất hiện cùng feature nào; lát cắt sau chỉ thay `element` của route thuộc feature mình và không sửa layout shell.
- Điểm gọi `Quit` từ frontend là menu ở wordmark `XWork` trên thanh trên cùng, mục `Quit XWork` nằm cuối menu sau một separator theo `§18`. Không gán phím tắt cho `Quit` vì `§17.4` không liệt kê thao tác này trong danh mục phím tắt đổi được.
- `Esc` và click ra ngoài hộp thoại Quit đều được ánh xạ thành `Cancel` và gọi `cancel_quit`. Cách này tránh để lại một pending request mà không có hộp thoại nào đang hiển thị, đồng thời vẫn đúng invariant 8 của `BE-001`: chỉ `Cancel` xóa pending request, còn ẩn cửa sổ thì giữ request.
- Ở lát cắt hiện tại `session_count` luôn bằng `0` vì `BE-005` chưa có, nên `request_quit` thoát ngay và hộp thoại Quit không xuất hiện khi chạy thật. Hộp thoại vẫn được triển khai đầy đủ và kiểm chứng bằng component test với fixture đúng `QuitRequestDto`; nó chỉ xuất hiện trong runtime thật từ giai đoạn 8 trở đi.
- Bảng màu chỉ có biến thể sáng theo `00-Docs/01-Wireframe/00-Design.md`. Tài liệu design không định nghĩa bảng màu tối cho bề mặt ứng dụng, nên FE-001 khai báo `color-scheme: light` và để `FE-012` bổ sung `Dark` cùng chế độ theo hệ điều hành.
- Không thêm file font vào repo. `--font-display` và `--font-body` dùng đúng fallback stack đã ghi trong `00-Design.md`; CSP `font-src 'self'` chặn Google Fonts nên webfont tự host được xử lý cùng `FE-012`.

### Ngoài phạm vi

- Nội dung của từng khu vực: Welcome (`FE-002`), Home (`FE-003`), Projects (`FE-004`), Project Overview (`FE-005`), Notes (`FE-019`), Calendar (`FE-021`) và các trang Settings (`FE-011`–`FE-015`, `FE-023`).
- Command Palette (`FE-009`) và notification panel (`FE-010`). Shell chỉ dựng hai điểm vào ở trạng thái chưa khả dụng.
- Danh sách project và phiên thật trong sidebar, gồm ghim, mở rộng/thu gọn project và chỉ báo trạng thái phiên. Dữ liệu đến từ `BE-003` ở giai đoạn 4 và `BE-005` ở giai đoạn 8.
- Thanh tab, bố cục pane, terminal (`FE-006`–`FE-008`) và File Explorer phụ của vùng nội dung.
- Menu native của system tray, single instance, dọn runtime khi Quit và mọi thao tác cửa sổ ở tầng hệ điều hành: thuộc `BE-001`.
- Persistence độ rộng/thu gọn sidebar, theme tối, tùy chỉnh màu và cỡ chữ: thuộc `BE-008`, `FE-011` và `FE-012`.
- Font tự host và asset font.

### Contract backend còn thiếu hoặc lệch

- `BE-001` không có query chỉ đọc để lấy pending quit request. Sau khi webview reload, shell không dựng lại được hộp thoại đang mở. Đây là tình huống chỉ xảy ra trong dev; xem `Edge case`. Nếu sản phẩm cần khôi phục hộp thoại, `BE-001` phải bổ sung một query chỉ đọc.
- `BE-001` không có query trạng thái maximized. Icon nút Maximize chỉ phản ánh giá trị trả về gần nhất của `toggle_main_window_maximized`; xem `Edge case`.
- `File liên quan` của `BE-001` giữ `src-tauri/tauri.conf.json` và `src-tauri/capabilities/main.json` nhưng chưa nêu `decorations: false` và ba quyền frontend cần cho event và kéo cửa sổ. Lát cắt FE-001 thay đổi hai file này; tài liệu `BE-001` cần được cập nhật trong một thay đổi riêng.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/app/app-router.tsx` | Bảng route memory router, nhãn khu vực cho breadcrumb, `errorElement` cấp ứng dụng và điểm để lát cắt sau thay `element` của route thuộc feature mình. |
| `src/app/app-providers.tsx` | Ghép provider cấp ứng dụng: tooltip provider, đăng ký event lifecycle và host của hộp thoại Quit. |
| `src/app/app-shell.tsx` | Layout ba vùng topbar / sidebar / content, đặt landmark và điều khiển độ rộng grid theo state sidebar. |
| `src/app/app-topbar.tsx` | Vùng kéo cửa sổ, brand button, breadcrumb ngữ cảnh, điểm vào tìm kiếm, biểu tượng chuông và cụm điều khiển cửa sổ. |
| `src/app/app-menu.tsx` | Menu mở từ wordmark, chứa mục `Quit XWork` ở cuối sau separator. |
| `src/app/window-controls.tsx` | Ba nút Minimize / Maximize / Close cùng vùng thông báo lỗi thao tác cửa sổ. |
| `src/app/app-sidebar.tsx` | Bốn nav item khu vực, khối `Projects` ở trạng thái rỗng, footer `Settings` và nút thu gọn. |
| `src/app/sidebar-resize-handle.tsx` | Kéo đổi độ rộng bằng con trỏ và thao tác tương đương bằng bàn phím. |
| `src/app/area-placeholder.tsx` | Trạng thái "khu vực chưa khả dụng" dùng chung cho các route chưa có feature. |
| `src/app/app-error-boundary.tsx` | `errorElement` cấp ứng dụng khi render route thất bại. |
| `src/app/quit-dialog.tsx` | Hộp thoại xác nhận `Quit XWork`, các dòng số liệu, trạng thái đang xử lý và lỗi. |
| `src/app/shell-store.ts` | State chrome của shell: độ rộng sidebar, thu gọn, trạng thái maximized gần nhất, lỗi thao tác cửa sổ. |
| `src/app/quit-store.ts` | State máy trạng thái của luồng Quit trên giao diện. |
| `src/app/use-lifecycle-events.ts` | Đăng ký `app-quit-requested` và `app-navigate-session`, dedupe theo `requestId`, hủy đăng ký khi unmount. |
| `src/lib/ipc/ipc-error.ts` | Bọc `invoke`, nhận diện lỗi dạng `{ code }` và chuẩn hóa lỗi không xác định. |
| `src/lib/ipc/app-lifecycle.ts` | Wrapper cho sáu command và hai event của `BE-001`. |
| `src/lib/utils/cn.ts` | Helper ghép class dùng bởi component trong `src/components/ui/`. |
| `src/components/ui/button.tsx` | Component nút nền tảng cho các biến thể primary, secondary, danger và icon. |
| `src/components/ui/dialog.tsx` | Component hộp thoại modal nền tảng cho hộp thoại Quit. |
| `src/components/ui/dropdown-menu.tsx` | Component menu nền tảng cho menu ở wordmark. |
| `src/components/ui/tooltip.tsx` | Component tooltip nền tảng cho các nút chỉ có icon. |
| `src/index.css` | Khai báo token màu, font, bán kính và bóng theo `00-Design.md`, cùng các alias semantic mà component trong `src/components/ui/` dùng. |
| `src/main.tsx` | Bọc `RouterProvider` bằng `AppProviders`. |
| `components.json` | Trỏ alias `utils` sang `@/lib/utils/cn` để đúng quy tắc đặt file của project structure. |
| `package.json` | Thêm `@tauri-apps/api`, `lucide-react` và các dependency mà component nền tảng được sao chép yêu cầu. |
| `pnpm-lock.yaml` | Khóa exact version các dependency vừa thêm. |
| `src-tauri/tauri.conf.json` | Đặt `"decorations": false` cho window `main`; không đổi label, title hay identifier. |
| `src-tauri/capabilities/main.json` | Thêm đúng ba quyền `core:event:allow-listen`, `core:event:allow-unlisten`, `core:window:allow-start-dragging`. |
| `src/bindings/app-lifecycle.ts` | DTO và error type dùng cho toàn bộ contract IPC của feature; file sinh tự động, không chỉnh tay. |
| `src/app/app-router.test.tsx` | Test bảng route và placeholder khu vực. |
| `src/app/app-shell.test.tsx` | Test layout, landmark và phản ứng theo state sidebar. |
| `src/app/app-topbar.test.tsx` | Test breadcrumb, điểm vào tìm kiếm và chuông, menu wordmark, điều khiển cửa sổ. |
| `src/app/app-sidebar.test.tsx` | Test điều hướng, trạng thái rỗng của khối `Projects`, thu gọn, tooltip và vạch kéo. |
| `src/app/quit-dialog.test.tsx` | Test nội dung số liệu, Cancel, Quit, trạng thái đang xử lý và các nhánh lỗi. |
| `src/app/shell-store.test.ts` | Test clamp độ rộng, toggle thu gọn và lỗi thao tác cửa sổ. |
| `src/app/quit-store.test.ts` | Test chuyển trạng thái luồng Quit và xử lý từng error code. |
| `src/app/use-lifecycle-events.test.ts` | Test dedupe event, điều hướng theo `sessionId` và hủy đăng ký. |
| `src/lib/ipc/app-lifecycle.test.ts` | Test tên command, hình dạng tham số và ánh xạ lỗi typed. |
| `tests/e2e/app-smoke.e2e.ts` | Scenario desktop cho shell thật: landmark, điều hướng khu vực và thu gọn sidebar. |

Dependency mới được khóa exact version: `@tauri-apps/api` cùng dòng `2.11` với Tauri, `lucide-react` `1.39.0` theo `01-TechStack.md`, cùng `clsx`, `tailwind-merge`, `class-variance-authority` và các primitive Radix mà `dialog`, `dropdown-menu`, `tooltip` được sao chép cần. Không thêm `motion` hoặc component Animate UI ở lát cắt này vì shell chưa dùng animation nào.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `AppShell` | Grid gồm `topbar` trên cùng, `sidebar` bên trái theo độ rộng hiện tại, `main` chứa `Outlet`. | `02-AppShell.html#shell` |
| `AppTopbar` | Cột brand rộng bằng sidebar, giữa là breadcrumb và điểm vào tìm kiếm, phải là chuông và điều khiển cửa sổ. Toàn bộ nền là vùng kéo cửa sổ. | `02-AppShell.html#shell` |
| `AppMenu` | Menu mở từ wordmark `XWork`, chỉ có mục `Quit XWork` ở cuối sau separator tại lát cắt này. | `04-Projects.html#dlg-quit` là điểm vào tương ứng của tray `02-AppShell.html#tray` |
| `SearchEntry` | Pill `Search or run a command`, ở trạng thái chưa khả dụng. | `02-AppShell.html#shell` |
| `NotificationBell` | Nút chuông, ở trạng thái chưa khả dụng và không có badge. | `02-AppShell.html#shell`, `#welcome` |
| `WindowControls` | Ba nút Minimize, Maximize, Close với nhãn `Close (hides to tray)`. | `02-AppShell.html#shell` |
| `AppSidebar` | `Home`, `Projects`, `Notes`, `Calendar`; khối `Projects`; footer `Settings` và nút thu gọn. | `02-AppShell.html#shell`, `#shell-collapsed` |
| `SidebarResizeHandle` | Vạch kéo giữa sidebar và vùng nội dung, có thao tác bàn phím tương đương. | `02-AppShell.html#shell` |
| `AreaPlaceholder` | Tiêu đề khu vực cùng câu giải thích khu vực sẽ có ở lát cắt nào. | `Không có` |
| `QuitDialog` | Hộp thoại modal xác nhận thoát, khối số liệu và hai hành động `Cancel` / `Quit`. | `04-Projects.html#dlg-quit` |
| `AppErrorBoundary` | Thông báo lỗi render cấp ứng dụng kèm hành động quay về `Home`. | `Không có` |

Kích thước lấy từ wireframe: topbar cao `40px`; sidebar mặc định `232px`, thu gọn `56px`; nav item cao `32px`; hộp thoại rộng `460px`. Độ rộng sidebar kéo được trong khoảng `200px`–`420px`.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `Sidebar đầy đủ` | `isSidebarCollapsed === false`. | Nav item có nhãn, khối `Projects` hiển thị, footer có `Settings` và `Collapse`. |
| `Sidebar thu gọn` | `isSidebarCollapsed === true`. | Chỉ còn icon rộng `56px`; wordmark thu về chữ `X`; khối `Projects` và danh sách phiên bị ẩn; mọi icon có tooltip mang nhãn; nút cuối đổi thành `Expand sidebar`. |
| `Rỗng — chưa có project` | Luôn đúng ở lát cắt này. | Khối `Projects` hiển thị `No projects yet. Add a folder to start a session.`; không hiển thị nút `+` vì `Add Project` thuộc `FE-004`, giống `#welcome`. |
| `Khu vực chưa khả dụng` | Route trỏ tới khu vực mà feature sở hữu chưa được triển khai. | `AreaPlaceholder` với `h1` là tên khu vực và một câu nêu khu vực sẽ xuất hiện cùng feature nào; không có nút không hoạt động. |
| `Điểm vào chưa khả dụng` | Luôn đúng cho `SearchEntry` và `NotificationBell` ở lát cắt này. | Nút `disabled` giữ đúng vị trí và nhãn wireframe, tooltip nói rõ chức năng đến ở lát cắt sau. Không hiển thị badge `Ctrl K` và không hiển thị số chưa đọc. |
| `Đang tải — kiểm tra trước khi thoát` | `phase === "requesting"`. | Mục `Quit XWork` chuyển sang `disabled` với nhãn `Checking running work…`; không mở hộp thoại nào khác. |
| `Chờ xác nhận thoát` | `phase === "awaiting-confirmation"`. | `QuitDialog` mở, focus vào `Cancel`, hiển thị đủ các dòng số liệu. |
| `Đang thoát` | `phase === "confirming"`. | Cả hai nút hộp thoại `disabled`, nút chính đổi nhãn `Quitting…`; hộp thoại không đóng được. |
| `Lỗi — không lấy được số liệu` | `request_quit` trả `runtime_snapshot_failed`. | `QuitDialog` mở ở chế độ chỉ có lỗi: `Couldn't check what is still running. XWork stays open.` cùng hai nút `Cancel` và `Try again`. |
| `Lỗi — dọn runtime thất bại` | `confirm_quit` trả `runtime_shutdown_failed`. | Hộp thoại giữ nguyên, thêm dòng lỗi `XWork couldn't stop everything, so nothing was closed.`; nút chính đổi thành `Try again`; ứng dụng vẫn mở. |
| `Lỗi — thao tác cửa sổ thất bại` | `hide_main_window`, `minimize_main_window` hoặc `toggle_main_window_maximized` trả `window_operation_failed`. | Dòng lỗi `aria-live="polite"` ngay dưới cụm điều khiển cửa sổ, nêu đúng thao tác và mời bấm lại; không đổi layout. |
| `Lỗi — tích hợp` | Nhận `invalid_window`, `unauthorized_window`, `invalid_request_id`, `state_lock_poisoned` hoặc một error code không xác định. | Đóng hộp thoại Quit nếu đang mở, hiển thị thông báo lỗi cấp ứng dụng nêu cần khởi động lại XWork; không có nút thử lại. |
| `Lỗi render` | Route ném lỗi khi render. | `AppErrorBoundary` hiển thị khu vực nào lỗi và nút quay về `Home`; topbar và sidebar vẫn dùng được. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Bấm một nav item khu vực | Điều hướng tới route tương ứng, nav item nhận `aria-current="page"`, breadcrumb đổi theo nhãn khu vực. | `Không có` |
| Di chuyển focus bằng `Tab` | Thứ tự brand → breadcrumb → tìm kiếm → chuông → điều khiển cửa sổ → nav sidebar → vạch kéo → nội dung; mọi thành phần focus có viền focus rõ ràng. | `Tab` / `Shift+Tab` |
| Bấm nút cuối sidebar | Đổi giữa thu gọn và mở rộng; nhãn và tooltip đổi giữa `Collapse sidebar` và `Expand sidebar`. | `Không có` |
| Kéo vạch giữa sidebar và nội dung | Đổi độ rộng sidebar theo con trỏ, clamp trong `200px`–`420px`. | `Không có` |
| Focus vạch kéo rồi bấm mũi tên | `ArrowLeft` và `ArrowRight` đổi `16px` mỗi lần, `Home` và `End` về cận dưới và cận trên; đây là thao tác bàn phím tương đương của kéo thả theo `§18`. | `←` `→` `Home` `End` |
| Bấm wordmark `XWork` | Mở `AppMenu`; menu điều khiển được hoàn toàn bằng bàn phím, `Esc` đóng và trả focus về wordmark. | `Không có` |
| Chọn `Quit XWork` trong menu | Gọi `request_quit`; nếu còn phiên thì mở `QuitDialog`, nếu không còn phiên thì backend dọn runtime rồi thoát. | `Không có` |
| Bấm `Minimize` | Gọi `minimize_main_window`; runtime không đổi. | `Không có` |
| Bấm `Maximize` | Gọi `toggle_main_window_maximized`; icon và nhãn đổi giữa `Maximize` và `Restore` theo giá trị trả về. | `Không có` |
| Double-click vùng kéo của topbar | Gọi `toggle_main_window_maximized`, giống bấm nút Maximize. | `Không có` |
| Kéo vùng trống của topbar | Di chuyển cửa sổ qua vùng `data-tauri-drag-region`; các nút con không nằm trong vùng kéo. | `Không có` |
| Bấm `Close (hides to tray)` | Gọi `hide_main_window`; phiên, tiến trình và pending quit request tiếp tục tồn tại. | `Không có` |
| Bấm `Cancel` trong `QuitDialog` | Gọi `cancel_quit` với `requestId` hiện tại, đóng hộp thoại, trả focus về wordmark. | `Esc` |
| Click ra ngoài `QuitDialog` | Xử lý như `Cancel`. | `Không có` |
| Bấm `Quit` trong `QuitDialog` | Gọi `confirm_quit`; hộp thoại chuyển sang trạng thái `Đang thoát` cho tới khi backend thoát hoặc trả lỗi. | `Không có` |
| Di chuyển focus trong `QuitDialog` | Focus bị giữ trong hộp thoại; thứ tự là `Cancel` rồi `Quit`. | `Tab` / `Shift+Tab` |

Mọi nút chỉ có icon đều có `aria-label` và tooltip cùng nội dung. Ở trạng thái thu gọn, tooltip của nav item mang nhãn khu vực đúng như `#shell-collapsed`.

## Luồng chính

### Khởi động và điều hướng

1. `main.tsx` render `AppProviders` bọc `RouterProvider` với memory router tại `/`, tức khu vực `Home` theo `§5.2`.
2. `AppProviders` đăng ký hai listener lifecycle đúng một lần và mount host của `QuitDialog`. Shell không gọi command nào khi mount, nên không có trạng thái tải ở lần render đầu.
3. Bấm nav item đổi route; `AppTopbar` dựng breadcrumb từ nhãn của các route đã match, `AppSidebar` đánh dấu nav item đang hoạt động.
4. Route chưa có feature sở hữu render `AreaPlaceholder`; route không khớp render placeholder `Not found` kèm hành động về `Home`.

### Thoát ứng dụng từ menu wordmark

1. Người dùng chọn `Quit XWork`; store chuyển sang `requesting` và gọi `request_quit`.
2. Kết quả `null` nghĩa là backend đã dọn runtime và thoát; giao diện không cần làm gì thêm.
3. Kết quả `QuitRequestDto` chuyển store sang `awaiting-confirmation` và mở `QuitDialog` với `requestId` cùng bốn số liệu.
4. `Cancel`, `Esc` hoặc click ra ngoài gọi `cancel_quit` với đúng `requestId`, xóa request và đóng hộp thoại.
5. `Quit` chuyển sang `confirming` và gọi `confirm_quit`. Thành công thì backend thoát process nên không có bước giao diện tiếp theo. `runtime_shutdown_failed` giữ hộp thoại mở kèm dòng lỗi và cho thử lại. `stale_quit_request` đóng hộp thoại rồi gọi lại `request_quit` đúng một lần để lấy trạng thái hiện hành. `quit_already_in_progress` giữ hộp thoại ở trạng thái `Đang thoát` và không mở hộp thoại thứ hai.

### Thoát ứng dụng từ tray

1. Backend show cửa sổ `main` rồi emit `app-quit-requested` với `QuitRequestDto`.
2. `use-lifecycle-events` nhận event, bỏ qua nếu `requestId` trùng request đang hiển thị, ngược lại đặt request mới và mở `QuitDialog`.
3. Từ đây luồng giống bước 4 và 5 của mục trên; hộp thoại dùng chung một store nên tray và menu wordmark không tạo được hai hộp thoại.

### Điều hướng tới phiên từ tray

1. Backend show cửa sổ rồi emit `app-navigate-session` với `sessionId`.
2. Shell điều hướng tới `/sessions/:sessionId`. Ở lát cắt này route đó render `AreaPlaceholder` vì `FE-006` chưa có; `BE-001` cũng chưa có phiên nào nên event không phát trong runtime thật.
3. Khi `FE-006` được triển khai, feature đó thay `element` của route và tự focus pane sau khi điều hướng; shell không thay đổi.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `hide_main_window` | `Không có` | `void` | `window_operation_failed` → dòng lỗi thao tác cửa sổ, cho bấm lại. `invalid_window` → lỗi tích hợp. |
| `minimize_main_window` | `Không có` | `void` | `window_operation_failed` → dòng lỗi thao tác cửa sổ. `invalid_window` → lỗi tích hợp. |
| `toggle_main_window_maximized` | `Không có` | `boolean` | `window_operation_failed` → dòng lỗi thao tác cửa sổ, giữ icon cũ. `invalid_window` → lỗi tích hợp. |
| `request_quit` | `Không có` | `QuitRequestDto \| null` | `runtime_snapshot_failed` → hộp thoại chỉ có lỗi kèm `Try again`. `quit_already_in_progress` → giữ trạng thái `Đang thoát`, không mở hộp thoại mới. `unauthorized_window` → lỗi tích hợp. |
| `cancel_quit` | `{ requestId: number }` | `void` | `stale_quit_request` → đóng hộp thoại, không báo lỗi vì kết quả người dùng muốn đã đạt. `invalid_request_id`, `unauthorized_window`, `state_lock_poisoned` → lỗi tích hợp. `quit_already_in_progress` → giữ trạng thái `Đang thoát`. |
| `confirm_quit` | `{ requestId: number }` | `void` | `runtime_shutdown_failed` → giữ hộp thoại, hiện dòng lỗi, cho `Try again`. `stale_quit_request` → đóng hộp thoại rồi gọi lại `request_quit` một lần. `quit_already_in_progress` → giữ trạng thái `Đang thoát`. `invalid_request_id`, `unauthorized_window`, `state_lock_poisoned` → lỗi tích hợp. |

`main_window_unavailable`, `tray_operation_failed` và `event_delivery_failed` không tới được frontend qua sáu command này. Wrapper vẫn xử lý chúng như lỗi tích hợp để không có nhánh nào bị bỏ sót khi `AppLifecycleError` mở rộng.

Tham số gửi theo camelCase (`requestId`) và được Tauri map sang `request_id`. Shell không bao giờ gửi `requestId` bằng `0` và không tự sinh ID.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `app-quit-requested` | `QuitRequestDto` | Người dùng chọn `Quit XWork` trong tray và snapshot còn ít nhất một phiên. | Nếu `requestId` trùng request đang hiển thị thì bỏ qua; ngược lại đặt request và mở `QuitDialog`. |
| `app-navigate-session` | `SessionNavigationDto` | Người dùng chọn một phiên trong nhóm `Needs attention` của tray. | Điều hướng tới `/sessions/:sessionId` bằng đúng `sessionId` nhận được, không phân tích hay biến đổi ID. |

Kiểu DTO và `AppLifecycleError` lấy từ `src/bindings/app-lifecycle.ts`; không định nghĩa lại thủ công. Cả hai listener được hủy đăng ký khi provider unmount để không giữ handler trùng sau hot reload.

## State frontend

```ts
// Chỉ ghi hình dạng state và chữ ký action, không ghi implementation.
type WindowControl = "minimize" | "maximize" | "close";

interface WindowControlFailure {
  control: WindowControl;
  code: AppLifecycleError["code"];
}

interface ShellState {
  sidebarWidthPx: number;
  isSidebarCollapsed: boolean;
  isMaximized: boolean;
  windowControlFailure: WindowControlFailure | null;
  setSidebarWidthPx(next: number): void;
  toggleSidebarCollapsed(): void;
  setMaximized(next: boolean): void;
  setWindowControlFailure(next: WindowControlFailure | null): void;
}

type QuitPhase =
  | "idle"
  | "requesting"
  | "awaiting-confirmation"
  | "confirming"
  | "snapshot-failed"
  | "integration-failed";

interface QuitFailure {
  stage: "snapshot" | "shutdown" | "integration";
  code: AppLifecycleError["code"];
}

interface QuitState {
  phase: QuitPhase;
  request: QuitRequestDto | null;
  failure: QuitFailure | null;
  startQuit(): Promise<void>;
  receiveTrayRequest(request: QuitRequestDto): void;
  cancelQuit(): Promise<void>;
  confirmQuit(): Promise<void>;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `sidebarWidthPx`, `isSidebarCollapsed` | UI tạm thời | Chỉ trong bộ nhớ ở lát cắt này; chuyển sang settings persistence của `BE-008` ở giai đoạn 6. `setSidebarWidthPx` clamp vào `200`–`420`. |
| `isMaximized` | UI tạm thời, cập nhật từ giá trị trả về của `toggle_main_window_maximized` | Không có query đọc trạng thái; mặc định `false` khi mount. |
| `windowControlFailure` | UI tạm thời | Xóa khi thao tác cửa sổ kế tiếp thành công hoặc khi đổi route. |
| `phase`, `failure` | UI tạm thời | Suy ra từ kết quả command và event; không bao giờ suy ra `phase` từ nội dung DOM. |
| `request` | Backend qua `request_quit` hoặc event `app-quit-requested` | Không lưu, không cache; mọi số liệu hiển thị lấy nguyên từ `QuitSummaryDto` của lần nhận gần nhất. |
| Nhãn khu vực và breadcrumb | Bảng route | Suy ra từ route đã match, không giữ trong store. |

## Contract công khai của feature

```ts
// src/app/app-router.tsx
export function createAppRouter(initialEntries?: string[]): ReturnType<typeof createMemoryRouter>;

// src/app/app-providers.tsx
export function AppProviders(props: { children: ReactNode }): JSX.Element;

// src/app/area-placeholder.tsx
export function AreaPlaceholder(props: { area: string; arrivesWith: string }): JSX.Element;

// src/lib/ipc/app-lifecycle.ts
export function hideMainWindow(): Promise<void>;
export function minimizeMainWindow(): Promise<void>;
export function toggleMainWindowMaximized(): Promise<boolean>;
export function requestQuit(): Promise<QuitRequestDto | null>;
export function cancelQuit(requestId: number): Promise<void>;
export function confirmQuit(requestId: number): Promise<void>;
export function onQuitRequested(handler: (request: QuitRequestDto) => void): Promise<UnlistenFn>;
export function onNavigateSession(handler: (target: SessionNavigationDto) => void): Promise<UnlistenFn>;

// src/lib/ipc/ipc-error.ts
export interface TaggedIpcError {
  code: string;
}
export class IpcCallError<TError extends TaggedIpcError> extends Error {
  readonly command: string;
  readonly payload: TError | null;
}
export function invokeCommand<TResult, TError extends TaggedIpcError>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult>;
```

`src/app/` là composition root: feature khác không import từ `src/app/` theo quy tắc phụ thuộc. Lát cắt sau đưa màn hình của mình vào ứng dụng bằng cách thay `element` của route thuộc feature đó trong `app-router.tsx`, không import `AppShell`, `AppSidebar` hay hai store của shell. Phần dùng chung thật sự cho feature khác là các export trong `src/lib/ipc/`.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Backend đã có pending request rồi frontend gọi `request_quit` lần nữa | `BE-001` trả lại đúng request cũ; shell nhận cùng `requestId` và không mở hộp thoại thứ hai. |
| Tray emit `app-quit-requested` khi hộp thoại đang mở với cùng `requestId` | Bỏ qua event, giữ nguyên hộp thoại và focus hiện tại. |
| Tray emit `app-quit-requested` với `requestId` khác request đang mở | Thay bằng request mới và render lại số liệu; không gọi `cancel_quit` cho ID cũ vì backend chỉ giữ một request tại một thời điểm. |
| Người dùng bấm `Close` khi hộp thoại Quit đang mở | Cửa sổ ẩn xuống tray, request vẫn pending, hộp thoại vẫn mở và xuất hiện lại nguyên trạng khi cửa sổ được show. |
| Bấm `Quit` hai lần rất nhanh | Lần đầu chuyển sang `confirming` và khóa cả hai nút, nên chỉ có đúng một `confirm_quit` được gửi. |
| `confirm_quit` trả `stale_quit_request` | Đóng hộp thoại, gọi lại `request_quit` đúng một lần; nếu kết quả là `null` thì ứng dụng thoát, nếu là request mới thì mở hộp thoại với số liệu mới. |
| `unsavedFileCount` bằng `0` | Ẩn dòng file chưa lưu. Dòng số phiên và dòng số tiến trình luôn hiển thị vì `§5.4` yêu cầu nêu cả hai. |
| Số liệu là số ít hoặc số nhiều | Nhãn đổi theo số: `1 session` và `4 sessions`, `1 project` và `3 projects`, `1 running process` và `3 running processes`, `1 file with unsaved changes` và `2 files with unsaved changes`. |
| Cửa sổ bị maximize bằng phím tắt hệ điều hành | Icon nút Maximize có thể lệch cho tới lần bấm kế tiếp; bấm nút vẫn toggle đúng vì backend đọc trạng thái thực tế. Chấp nhận cho tới khi `BE-001` có query đọc trạng thái. |
| Webview reload trong khi có pending request | Hộp thoại không được dựng lại vì `BE-001` không có query chỉ đọc; chọn `Quit XWork` lần nữa trả về đúng request cũ và mở lại hộp thoại. Chỉ xảy ra trong dev. |
| `Alt+F4` hoặc close ở tầng hệ điều hành | `BE-001` chặn và chuyển thành hide; frontend không cần xử lý và không mất state. |
| Kéo vạch sidebar ra ngoài khoảng cho phép | Độ rộng dừng ở cận `200px` hoặc `420px`; `aria-valuenow` của vạch kéo phản ánh giá trị đã clamp. |
| Thu gọn sidebar khi đang kéo | Kết thúc kéo, giữ độ rộng gần nhất để lần mở rộng sau trả về đúng độ rộng đó. |
| Breadcrumb của route phiên khi chưa có `FE-006` | Hiển thị nhãn khu vực cùng `sessionId` thô; `FE-006` thay bằng tên project và tên phiên. |
| `invoke` bị từ chối vì thiếu quyền hoặc phản hồi không đúng dạng `{ code }` | Wrapper ném `IpcCallError` với `payload` bằng `null`; giao diện xử lý như lỗi tích hợp và không thử lại thành vòng lặp. |
| Người dùng bật `prefers-reduced-motion` | Shell không dùng animation nào ở lát cắt này, nên hành vi không đổi. |

## Tiêu chí hoàn thành

- [ ] `pnpm tauri dev` mở cửa sổ không viền hệ điều hành, hiển thị topbar và sidebar đúng `#shell`: brand, breadcrumb, pill tìm kiếm, chuông, ba nút cửa sổ, bốn nav item, khối `Projects` rỗng, footer `Settings` và nút thu gọn.
- [ ] Bấm bốn nav item và `Settings` điều hướng đúng năm route, nav item đang mở có `aria-current="page"` và breadcrumb đổi theo tên khu vực; mỗi khu vực chưa có feature render `AreaPlaceholder` nêu rõ feature sở hữu.
- [ ] Nút thu gọn chuyển sidebar giữa `232px` và `56px` đúng `#shell-collapsed`: ẩn nhãn, ẩn khối `Projects`, wordmark còn chữ `X`, mọi icon có tooltip mang nhãn, nút cuối đổi thành `Expand sidebar`.
- [ ] Kéo vạch sidebar đổi độ rộng và clamp ở `200px` và `420px`; focus vạch kéo rồi bấm `←`, `→`, `Home`, `End` cho kết quả tương đương và `aria-valuenow` khớp độ rộng thực tế.
- [ ] Trên desktop thật, `Minimize` minimize cửa sổ, `Maximize` đổi qua lại giữa maximize và restore kèm đổi icon và nhãn, double-click vùng trống topbar cho kết quả giống nút `Maximize`, kéo vùng trống topbar di chuyển được cửa sổ.
- [ ] `Close (hides to tray)` và `Alt+F4` đều chỉ ẩn cửa sổ; mở lại từ tray trả về đúng route đang xem trước đó.
- [ ] Menu wordmark mở được bằng chuột và bàn phím, có `Quit XWork` ở cuối sau separator, `Esc` đóng menu và trả focus về wordmark.
- [ ] Với `sessionCount` bằng `0`, chọn `Quit XWork` làm XWork thoát mà không mở hộp thoại và không để lại process.
- [ ] Component test dựng `QuitDialog` từ `QuitRequestDto` fixture xác nhận: tiêu đề `Quit XWork?`, câu cảnh báo không khôi phục, dòng số phiên và số project, dòng số tiến trình đang chạy, dòng file chưa lưu chỉ xuất hiện khi lớn hơn `0`, câu gợi ý đóng cửa sổ để chạy nền, và hai nút `Cancel` cùng `Quit`.
- [ ] Component test xác nhận `Cancel`, `Esc` và click ra ngoài đều gọi `cancel_quit` đúng một lần với đúng `requestId`; `Quit` gọi `confirm_quit` đúng một lần dù bấm nhanh hai lần.
- [ ] Component test xác nhận từng nhánh lỗi hiển thị đúng: `runtime_snapshot_failed`, `runtime_shutdown_failed`, `stale_quit_request`, `quit_already_in_progress`, `window_operation_failed` và nhóm lỗi tích hợp.
- [ ] Test event xác nhận `app-quit-requested` trùng `requestId` bị bỏ qua, `requestId` mới thay số liệu, `app-navigate-session` điều hướng tới `/sessions/:sessionId` bằng đúng ID, và cả hai listener được hủy khi unmount.
- [ ] `src-tauri/capabilities/main.json` chỉ thêm đúng ba quyền đã chốt; không có quyền cửa sổ, filesystem hoặc shell nào khác.
- [ ] Không có DTO hoặc error type viết tay cho lifecycle; toàn bộ kiểu đến từ `src/bindings/app-lifecycle.ts` và file này không bị sửa tay.
- [ ] Không có persistence nào trong webview: tìm trong `src/` không có `localStorage`, `sessionStorage` hoặc `indexedDB`.
- [ ] Mọi function, component, hook, callback và test mới có comment ngắn nêu mục đích; chỗ có invariant như clamp độ rộng, dedupe event và khóa nút khi đang thoát có comment giải thích.
- [ ] Trên Windows, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm typecheck:e2e`, `pnpm test:rust` và `pnpm tauri build` đều pass; sau khi có binary release, `pnpm test:e2e` cũng pass.
- [ ] Smoke test thủ công trên Windows xác nhận cửa sổ không viền vẫn kéo đổi kích thước theo viền được, hide và show từ tray, minimize, maximize cùng `Quit XWork` hoạt động; kiểm tra macOS hoãn tới bước chuẩn bị phát hành theo quy tắc project.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/app/app-router.test.tsx` | Component | Năm route khu vực cùng hai route dành trước render `AreaPlaceholder` đúng tên khu vực; route không khớp render placeholder `Not found`; `errorElement` nhận lỗi render. |
| `src/app/app-shell.test.tsx` | Component | Landmark `banner`, `navigation` và `main` tồn tại đúng một lần; độ rộng grid theo `sidebarWidthPx`; trạng thái thu gọn ẩn đúng các phần; thứ tự focus theo `Tab`. |
| `src/app/app-topbar.test.tsx` | Component | Breadcrumb dựng từ route đã match; `SearchEntry` và `NotificationBell` là nút `disabled` có tooltip và không có badge; ba nút cửa sổ gọi đúng command; double-click vùng kéo gọi `toggle_main_window_maximized`; `window_operation_failed` hiện dòng lỗi `aria-live`; menu wordmark mở và đóng bằng bàn phím và có `Quit XWork` ở cuối. |
| `src/app/app-sidebar.test.tsx` | Component | Bốn nav item và `Settings` điều hướng đúng route và đặt `aria-current`; khối `Projects` hiện đúng câu trạng thái rỗng và không có nút `+`; nút thu gọn đổi nhãn; tooltip mang nhãn khi thu gọn; vạch kéo phản hồi `←`, `→`, `Home`, `End` và cập nhật `aria-valuenow`. |
| `src/app/quit-dialog.test.tsx` | Component | Nội dung và số liệu theo `#dlg-quit`; số ít và số nhiều; ẩn dòng file chưa lưu khi bằng `0`; focus bị giữ trong hộp thoại; `Cancel`, `Esc`, click ngoài, `Quit`, trạng thái `Quitting…` và từng nhánh lỗi. |
| `src/app/shell-store.test.ts` | Unit | Clamp độ rộng ở hai cận, giữ độ rộng gần nhất qua một vòng thu gọn và mở rộng, cập nhật `isMaximized`, xóa `windowControlFailure` khi thao tác sau thành công. |
| `src/app/quit-store.test.ts` | Unit | Chuyển trạng thái cho kết quả `null` và kết quả có request; chặn `confirm_quit` lặp; ánh xạ `runtime_snapshot_failed`, `runtime_shutdown_failed`, `quit_already_in_progress` và nhóm lỗi tích hợp; `stale_quit_request` gọi lại `request_quit` đúng một lần. |
| `src/app/use-lifecycle-events.test.ts` | Unit | Đăng ký đúng hai event một lần; dedupe theo `requestId`; điều hướng bằng `sessionId` nguyên vẹn; hủy đăng ký khi unmount. |
| `src/lib/ipc/app-lifecycle.test.ts` | Unit | Gọi đúng tên sáu command; `requestId` gửi dạng camelCase; lỗi dạng `{ code }` trở thành `IpcCallError` có `payload`; lỗi lạ trở thành `IpcCallError` với `payload` bằng `null`. |
| `tests/e2e/app-smoke.e2e.ts` | End-to-end | Trên desktop thật: shell render đủ landmark và wordmark; điều hướng qua bốn khu vực và `Settings` đổi breadcrumb cùng tiêu đề khu vực; nút thu gọn đổi độ rộng sidebar. |

Các hành vi phụ thuộc cửa sổ native — kéo cửa sổ, minimize, maximize, hide xuống tray, mở lại từ tray và thoát process — được xác nhận bằng smoke test thủ công trên Windows với bản build thật; component test và end-to-end test không được coi là thay thế cho bước này.

## Câu hỏi mở

Không có.
