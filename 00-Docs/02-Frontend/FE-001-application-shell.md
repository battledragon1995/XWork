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
- Cửa sổ `main` mở lần đầu ở `1280 × 800`, đúng kích thước artboard của `02-AppShell.html`; người dùng vẫn có thể resize cửa sổ sau khi mở.
- Đánh đổi đã chấp nhận: cửa sổ không viền làm mất Snap Layouts khi hover nút Maximize trên Windows 11. Kéo đổi kích thước theo viền vẫn hoạt động vì cửa sổ giữ `resizable`.
- Vì chỉ mở `core:window:allow-start-dragging`, hành vi double-click vùng kéo do runtime Tauri cung cấp bị chặn và không có tác dụng. Shell tự xử lý double-click trên vùng kéo bằng cách gọi `toggle_main_window_maximized`, nên chỉ có một đường đổi trạng thái maximize.
- Độ rộng và trạng thái thu gọn sidebar chỉ giữ trong bộ nhớ tại lát cắt này và reset khi mở lại ứng dụng. Yêu cầu "ghi nhớ" của `§4.1` chỉ hoàn thành đủ khi `BE-008` cung cấp settings persistence ở giai đoạn 6 của roadmap. FE-001 không ghi `localStorage`, `sessionStorage` hoặc bất kỳ persistence nào trong webview.
- FE-001 sở hữu bảng route của ứng dụng. Mỗi khu vực chưa có feature tương ứng render `AreaPlaceholder` dùng chung, nói rõ khu vực sẽ xuất hiện cùng feature nào; lát cắt sau chỉ thay `element` của route thuộc feature mình và không sửa layout shell.
- Điểm gọi `Quit` từ frontend là menu ở wordmark `XWork` trên thanh trên cùng, mục `Quit XWork` nằm cuối menu sau một separator theo `§18`. Không gán phím tắt cho `Quit` vì `§17.4` không liệt kê thao tác này trong danh mục phím tắt đổi được.
- `Esc` và click ra ngoài hộp thoại Quit đều được ánh xạ thành `Cancel` và gọi `cancel_quit`. Cách này tránh để lại một pending request mà không có hộp thoại nào đang hiển thị, đồng thời vẫn đúng invariant 8 của `BE-001`: chỉ `Cancel` xóa pending request, còn ẩn cửa sổ thì giữ request.
- Ở lát cắt hiện tại `session_count` luôn bằng `0` vì `BE-005` chưa có, nên `request_quit` thoát ngay và hộp thoại Quit không xuất hiện khi chạy thật. Hộp thoại vẫn được triển khai đầy đủ và kiểm chứng bằng component test với fixture đúng `QuitRequestDto`; nó chỉ xuất hiện trong runtime thật từ giai đoạn 8 trở đi.
- Bảng màu chỉ có biến thể sáng theo `00-Docs/01-Wireframe/00-Design.md`. Tài liệu design không định nghĩa bảng màu tối cho bề mặt ứng dụng, nên FE-001 khai báo `color-scheme: light` và để `FE-012` bổ sung `Dark` cùng chế độ theo hệ điều hành.
- Không thêm file font vào repo. `--font-display` và `--font-body` dùng đúng fallback stack đã ghi trong `00-Design.md`; CSP `font-src 'self'` chặn Google Fonts nên webfont tự host được xử lý cùng `FE-012`.
- Sidebar dựng từ component `sidebar` của Animate UI (`https://animate-ui.com/r/components-radix-sidebar.json`) được sao chép vào `src/components/animate-ui/`, kèm primitive `highlight` và helper `get-strict-context` mà nó phụ thuộc. Đây là sidebar của shadcn được Animate UI thêm vệt sáng chạy theo con trỏ, nên `motion` trở thành dependency thật của shell và được khóa đúng `13.1.1` theo `01-TechStack.md`.
- Bản sao chép được cắt gọn cho desktop, mọi thay đổi giữ cục bộ trong file đã sao chép: bỏ nhánh mobile cùng `Sheet` và `useIsMobile`, bỏ luôn `hidden md:block` để sidebar không biến mất khi cửa sổ hẹp hơn `768px`; bỏ ghi cookie `sidebar_state`; bỏ listener `Ctrl+B`; bỏ `SidebarInput`, `SidebarMenuSkeleton` và `SidebarSeparator` vì ba thành phần đó chỉ tồn tại để dùng `input`, `skeleton` và `separator` mà shell không sao chép; bỏ `TooltipProvider` bên trong `SidebarProvider` vì `app-providers.tsx` đã cung cấp đúng một context tooltip.
- `SidebarProvider` không giữ state riêng. Shell truyền `open={!isSidebarCollapsed}` và `onOpenChange` gọi `toggleSidebarCollapsed`, nên `shell-store` vẫn là nguồn duy nhất của trạng thái thu gọn; cùng với việc bỏ ghi cookie, quyết định "không có persistence nào trong webview" ở lát cắt này được giữ nguyên.
- Không gán `Ctrl+B` cho thu gọn sidebar. `§17.4` không liệt kê thao tác này trong danh mục phím tắt và phím tắt là địa hạt của `BE-009`; một component nền tảng không được tự chiếm một tổ hợp phím toàn ứng dụng.
- `SidebarRail` của Animate UI không được dùng. Nó chiếm đúng khe giữa sidebar và vùng nội dung với hành vi bấm-để-toggle, trùng chỗ với `SidebarResizeHandle` mà `§4.1` yêu cầu. Khe đó chỉ có một chủ là vạch kéo đổi độ rộng.
- Độ rộng sidebar đi qua hai biến CSS `--sidebar-width` và `--sidebar-width-icon` do shell đặt trên `SidebarProvider`, thay cho `grid-template-columns` của lát cắt trước; `--sidebar-width-icon` bằng `56px` theo `#shell-collapsed`. Topbar vẫn tự tính cột brand từ cùng hai giá trị trong `shell-store`.
- Cột brand của topbar chạy cùng một transition độ rộng với sidebar, nếu không thì nó nhảy ngay trong khi cạnh sidebar còn đang đi và hai vùng lệch nhau suốt thời gian chuyển động. Cột brand được dựng thành một track `auto` do một phần tử con định độ rộng, vì một track list trộn `minmax()` và `auto` không nội suy được đáng tin cậy. Transition này cũng bị tắt trong lúc kéo vạch và khi `prefers-reduced-motion` được đặt.
- Tooltip của nav item do chỗ gọi sở hữu và prop `tooltip` bị bỏ khỏi `SidebarMenuButton` trong bản sao chép. Lý do: `HighlightItem` chèn thêm một `div` bọc ngoài, nếu để `div` đó làm trigger thì tooltip chỉ hiện khi hover và mất khi focus bằng bàn phím, trái `§18`.
- Bản sao chép của primitive `highlight` bỏ phần tự chèn `aria-selected` vào phần tử con. Vệt sáng là trang trí theo con trỏ chứ không phải trạng thái chọn, và `aria-selected` không hợp lệ trên một link điều hướng.
- Vệt sáng hover bật mặc định cho sidebar và cụm hành động bên phải topbar, rồi tắt khi người dùng đặt `prefers-reduced-motion`. Khi tắt, `Highlight` và `HighlightItem` render thẳng phần tử con, các control quay về hover tĩnh, còn phần đổi độ rộng dùng `motion-reduce:transition-none`. Hook đọc thiết lập này nằm trong `src/app/` vì hiện chỉ `FE-001` sử dụng; không tạo khu vực dùng chung `src/lib/ui/` khi chưa có feature thứ hai cùng phụ thuộc.
- Transition độ rộng bị tắt trong lúc kéo vạch, qua `data-resizing` trên wrapper của sidebar. Nếu để nguyên, sidebar chạy sau con trỏ đúng thời lượng transition. Kéo bằng bàn phím vẫn giữ transition vì mỗi lần nhấn là một bước `16px` rời rạc.
- Vệt sáng sidebar dùng spring cho thay đổi vị trí nhưng cập nhật chiều rộng tức thì. Khi người dùng thu gọn sidebar mà con trỏ vẫn nằm trên nút cuối, vệt sáng giữ nguyên một instance và bám theo chiều rộng sống của nút khi nhãn đổi từ `Collapse sidebar` sang `Expand sidebar`.
- Token màu sidebar được thêm vào `src/index.css` và map vào bảng màu đang có: `--color-sidebar` là `surface-soft`, `--color-sidebar-accent` là `surface-card` dùng cho vệt sáng hover, `--color-sidebar-border` là `hairline`, `--color-sidebar-ring` là `brand`. Nav item đang mở giữ nền `cream-strong` theo `#shell` và được đặt tại chỗ gọi, nhờ vậy vệt sáng hover vẫn phân biệt được khi chạy qua item đang mở.
- `NotificationBell`, Minimize, Maximize/Restore và Close chia sẻ đúng một vệt sáng trong topbar. Ba control đầu dùng nền `surface-card`; Close chuyển vệt sáng sang `error` và icon sang `on-primary`. Khi giảm chuyển động được bật, mỗi control dùng hover tĩnh tương ứng và không render phần tử chuyển động.
- Vùng breadcrumb và từng crumb được đánh dấu là vùng kéo cửa sổ để phần chữ không tạo lỗ hổng trong bề mặt kéo. Khi nhấn chuột trái lên nền kéo không tương tác, shell xóa focus hiện tại trước khi native drag bắt đầu để tooltip của control trước đó không bị treo; nhấn lên button hoặc phần tử tương tác không bị xóa focus và không bắt đầu hành vi này.

### Ngoài phạm vi

- Nội dung của từng khu vực: Welcome (`FE-002`), Home (`FE-003`), Projects (`FE-004`), Project Overview (`FE-005`), Notes (`FE-019`), Calendar (`FE-021`) và các trang Settings (`FE-011`–`FE-015`, `FE-023`).
- Command Palette (`FE-009`) và notification panel (`FE-010`). Shell chỉ dựng hai điểm vào ở trạng thái chưa khả dụng.
- Danh sách project và phiên thật trong sidebar, gồm ghim, mở rộng/thu gọn project và chỉ báo trạng thái phiên. Dữ liệu đến từ `BE-003` ở giai đoạn 4 và `BE-005` ở giai đoạn 8.
- Thanh tab, bố cục pane, terminal (`FE-006`–`FE-008`) và File Explorer phụ của vùng nội dung.
- Menu native của system tray, single instance, dọn runtime khi Quit và mọi thao tác cửa sổ ở tầng hệ điều hành: thuộc `BE-001`.
- Persistence độ rộng/thu gọn sidebar, theme tối, tùy chỉnh màu và cỡ chữ: thuộc `BE-008`, `FE-011` và `FE-012`.
- Font tự host và asset font.
- Các biến thể `floating`, `inset` và chế độ `offcanvas` của sidebar Animate UI. Shell chỉ dùng `variant="sidebar"` với `collapsible="icon"`; các biến thể còn lại giữ trong bản sao chép nhưng không có nơi dùng ở lát cắt này.
- `SidebarMenuSub`, `SidebarMenuBadge` và `SidebarMenuAction`: thuộc danh sách project và chỉ báo phiên của `FE-004` và `FE-006`.

### Contract backend còn thiếu hoặc lệch

- `BE-001` không có query chỉ đọc để lấy pending quit request. Sau khi webview reload, shell không dựng lại được hộp thoại đang mở. Đây là tình huống chỉ xảy ra trong dev; xem `Edge case`. Nếu sản phẩm cần khôi phục hộp thoại, `BE-001` phải bổ sung một query chỉ đọc.
- `BE-001` không có query trạng thái maximized. Icon nút Maximize chỉ phản ánh giá trị trả về gần nhất của `toggle_main_window_maximized`; xem `Edge case`.
- `File liên quan` của `BE-001` giữ `src-tauri/tauri.conf.json` và `src-tauri/capabilities/main.json` nhưng chưa nêu `decorations: false` và ba quyền frontend cần cho event và kéo cửa sổ. Lát cắt FE-001 thay đổi hai file này; tài liệu `BE-001` cần được cập nhật trong một thay đổi riêng.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/app/app-router.tsx` | Bảng route memory router, nhãn khu vực cho breadcrumb, `errorElement` cấp ứng dụng và điểm để lát cắt sau thay `element` của route thuộc feature mình. |
| `src/app/app-providers.tsx` | Ghép provider cấp ứng dụng: tooltip provider, đăng ký event lifecycle và host của hộp thoại Quit. |
| `src/app/app-shell.tsx` | Layout ba vùng topbar / sidebar / content: hàng dưới là `SidebarProvider`, độ rộng công bố qua `--sidebar-width` và `--sidebar-width-icon`, vùng nội dung là `SidebarInset`. |
| `src/app/app-topbar.tsx` | Vùng kéo cửa sổ gồm breadcrumb, brand button, ngữ cảnh, điểm vào tìm kiếm, biểu tượng chuông và cụm điều khiển cửa sổ; xóa focus cũ khi native drag bắt đầu; cột brand chạy cùng transition độ rộng với sidebar; cụm hành động dùng một vệt sáng chung. |
| `src/app/app-menu.tsx` | Menu mở từ wordmark, chứa mục `Quit XWork` ở cuối sau separator. |
| `src/app/window-controls.tsx` | Ba nút Minimize / Maximize / Close, biến thể hover cảnh báo của Close và vùng thông báo lỗi thao tác cửa sổ. |
| `src/app/app-sidebar.tsx` | Ghép sidebar từ các thành phần Animate UI đã sao chép: bốn nav item khu vực, khối `Projects` ở trạng thái rỗng, footer `Settings` và nút thu gọn; quyết định bật/tắt vệt sáng theo `prefers-reduced-motion`, giữ chiều rộng vệt sáng bám theo control trong lúc thu gọn và sở hữu tooltip của nav item. |
| `src/app/use-prefers-reduced-motion.ts` | Theo dõi live media query `prefers-reduced-motion` của hệ điều hành để topbar và sidebar bật vệt sáng động hoặc dùng hover tĩnh; CSS dùng cùng media query để tắt transition độ rộng. |
| `src/app/sidebar-resize-handle.tsx` | Kéo đổi độ rộng bằng con trỏ và thao tác tương đương bằng bàn phím; công bố trạng thái đang kéo để shell tắt transition độ rộng. |
| `src/components/animate-ui/components/radix/sidebar.tsx` | Sidebar Animate UI được sao chép cùng các thay đổi cục bộ đã chốt; cung cấp `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`, `SidebarFooter`, `SidebarInset` và `useSidebar`. |
| `src/components/animate-ui/primitives/effects/highlight.tsx` | Primitive tạo vệt sáng chạy theo con trỏ cho sidebar và cụm hành động topbar; khi `enabled === false`, trả thẳng phần tử con và không gắn wrapper hay thuộc tính trạng thái. |
| `src/components/animate-ui/lib/get-strict-context.tsx` | Helper tạo context bắt buộc có provider, dùng bởi các component Animate UI đã sao chép. |
| `src/app/area-placeholder.tsx` | Trạng thái "khu vực chưa khả dụng" dùng chung cho các route chưa có feature. |
| `src/app/app-error-boundary.tsx` | `errorElement` cấp ứng dụng khi render route thất bại. |
| `src/app/quit-dialog.tsx` | Hộp thoại xác nhận `Quit XWork`, các dòng số liệu, trạng thái đang xử lý và lỗi. |
| `src/app/shell-store.ts` | State chrome của shell: độ rộng sidebar, thu gọn, đang kéo đổi độ rộng, trạng thái maximized gần nhất, lỗi thao tác cửa sổ. |
| `src/app/quit-store.ts` | State máy trạng thái của luồng Quit trên giao diện. |
| `src/app/use-lifecycle-events.ts` | Đăng ký `app-quit-requested` và `app-navigate-session`, dedupe theo `requestId`, hủy đăng ký khi unmount. |
| `src/lib/ipc/ipc-error.ts` | Bọc `invoke`, nhận diện lỗi dạng `{ code }` và chuẩn hóa lỗi không xác định. |
| `src/lib/ipc/app-lifecycle.ts` | Wrapper cho sáu command và hai event của `BE-001`. |
| `src/lib/utils/cn.ts` | Helper ghép class dùng bởi component trong `src/components/ui/`. |
| `src/components/ui/button.tsx` | Component nút nền tảng cho các biến thể primary, secondary, danger và icon. |
| `src/components/ui/dialog.tsx` | Component hộp thoại modal nền tảng cho hộp thoại Quit. |
| `src/components/ui/dropdown-menu.tsx` | Component menu nền tảng cho menu ở wordmark. |
| `src/components/ui/tooltip.tsx` | Component tooltip nền tảng cho các nút chỉ có icon và cho nav item khi sidebar thu gọn. |
| `src/index.css` | Khai báo token màu, font, bán kính và bóng theo `00-Design.md`, cùng các alias semantic mà component trong `src/components/ui/` và `src/components/animate-ui/` dùng, gồm nhóm token `--color-sidebar*`. |
| `src/main.tsx` | Bọc `RouterProvider` bằng `AppProviders`. |
| `components.json` | Trỏ alias `utils` sang `@/lib/utils/cn` để đúng quy tắc đặt file của project structure. |
| `package.json` | Thêm `@tauri-apps/api`, `lucide-react`, `motion` và các dependency mà component nền tảng được sao chép yêu cầu. |
| `pnpm-lock.yaml` | Khóa exact version các dependency vừa thêm. |
| `src-tauri/tauri.conf.json` | Đặt `"decorations": false`, `"width": 1280` và `"height": 800` cho window `main`; không đổi label, title hay identifier. |
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
| `src-tauri/tests/window_configuration.rs` | Đọc cấu hình desktop và xác nhận window `main` mở ở `1280 × 800`. |

Dependency mới được khóa exact version: `@tauri-apps/api` cùng dòng `2.11` với Tauri, `lucide-react` `1.39.0` và `motion` `13.1.1` theo `01-TechStack.md`, cùng `clsx`, `tailwind-merge`, `class-variance-authority` và các primitive Radix mà `dialog`, `dropdown-menu`, `tooltip` được sao chép cần. `motion` là dependency runtime của sidebar Animate UI và primitive `highlight`; bản `13.1.1` khai báo hỗ trợ `react` và `react-dom` `^19`.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `AppShell` | Grid hai hàng: `topbar` trên cùng, hàng dưới là `SidebarProvider` chứa `AppSidebar`, vạch kéo và `SidebarInset` với `Outlet`. | `02-AppShell.html#shell` |
| `AppTopbar` | Cột brand rộng bằng sidebar, giữa là breadcrumb và điểm vào tìm kiếm, phải là chuông và điều khiển cửa sổ. Toàn bộ nền, gồm chữ breadcrumb nhưng không gồm control tương tác, là vùng kéo cửa sổ; cụm hành động bên phải dùng một vệt sáng hover chung. | `02-AppShell.html#shell` |
| `AppMenu` | Menu mở từ wordmark `XWork`, chỉ có mục `Quit XWork` ở cuối sau separator tại lát cắt này. | `04-Projects.html#dlg-quit` là điểm vào tương ứng của tray `02-AppShell.html#tray` |
| `SearchEntry` | Pill `Search or run a command`, ở trạng thái chưa khả dụng. | `02-AppShell.html#shell` |
| `NotificationBell` | Nút chuông, ở trạng thái chưa khả dụng và không có badge. | `02-AppShell.html#shell`, `#welcome` |
| `WindowControls` | Ba nút Minimize, Maximize, Close với nhãn `Close (hides to tray)`; Close dùng màu cảnh báo khi hover/active. | `02-AppShell.html#shell` |
| `AppSidebar` | `Home`, `Projects`, `Notes`, `Calendar`; khối `Projects`; footer `Settings` và nút thu gọn. Là landmark `navigation` duy nhất của shell. | `02-AppShell.html#shell`, `#shell-collapsed` |
| `Sidebar` cùng `SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`, `SidebarFooter` | Bộ khung sidebar của Animate UI mà `AppSidebar` ghép lại; giữ vệt sáng hover, transition độ rộng và ẩn nhãn khi thu gọn. | `02-AppShell.html#shell`, `#shell-collapsed` |
| `SidebarInset` | Vùng nội dung, mang landmark `main` và chứa dòng lỗi cấp ứng dụng cùng `Outlet`. | `02-AppShell.html#shell` |
| `SidebarResizeHandle` | Vạch kéo giữa sidebar và vùng nội dung, có thao tác bàn phím tương đương. | `02-AppShell.html#shell` |
| `AreaPlaceholder` | Tiêu đề khu vực cùng câu giải thích khu vực sẽ có ở lát cắt nào. | `Không có` |
| `QuitDialog` | Hộp thoại modal xác nhận thoát, khối số liệu và hai hành động `Cancel` / `Quit`. | `04-Projects.html#dlg-quit` |
| `AppErrorBoundary` | Thông báo lỗi render cấp ứng dụng kèm hành động quay về `Home`. | `Không có` |

Kích thước lấy từ wireframe: topbar cao `40px`; sidebar mặc định `232px`, thu gọn `56px`; nav item cao `32px`; hộp thoại rộng `460px`. Độ rộng sidebar kéo được trong khoảng `200px`–`420px`. Ở chế độ thu gọn, nav item giữ kích thước `32px` và được căn giữa trong cột `56px`.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `Sidebar đầy đủ` | `isSidebarCollapsed === false`. | Nav item có nhãn, khối `Projects` hiển thị, footer có `Settings` và `Collapse`; sidebar mang `data-state="expanded"`. |
| `Sidebar thu gọn` | `isSidebarCollapsed === true`. | Chỉ còn icon rộng `56px`, sidebar mang `data-state="collapsed"` và `data-collapsible="icon"`; wordmark thu về chữ `X`; nhãn nav item vẫn nằm trong DOM và trong accessibility tree nhưng bị cắt bởi `overflow`; khối `Projects` và danh sách phiên bị ẩn; mọi icon có tooltip mang nhãn; nút cuối đổi thành `Expand sidebar`. |
| `Vệt sáng hover — sidebar` | Con trỏ đang ở trên một nav item và `prefers-reduced-motion` không được đặt. | Một khối nền `--color-sidebar-accent` trượt từ item trước sang item đang hover; item đang mở giữ nền `cream-strong` bên dưới nên vẫn phân biệt được. Chiều rộng vệt sáng cập nhật tức thì khi sidebar đổi độ rộng. |
| `Vệt sáng hover — topbar` | Con trỏ đang ở trên chuông hoặc một window control và `prefers-reduced-motion` không được đặt. | Một vệt sáng duy nhất trượt giữa bốn control; chuông, Minimize và Maximize/Restore dùng `surface-card`, Close dùng `error` với icon `on-primary`. |
| `Hover tĩnh` | Người dùng đặt `prefers-reduced-motion`. | Không có vệt sáng và không có phần tử động nào; nav item cùng control topbar đang hover đổi nền ngay, transition độ rộng bị tắt. |
| `Đang kéo đổi độ rộng` | `isSidebarResizing === true`. | Sidebar mang `data-resizing="true"`, transition độ rộng bị tắt nên cạnh sidebar đi đúng theo con trỏ. |
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
| Bấm nút cuối sidebar | Đổi giữa thu gọn và mở rộng qua `toggleSidebarCollapsed`; độ rộng chuyển động giữa `232px` và `56px`; nhãn và tooltip đổi giữa `Collapse sidebar` và `Expand sidebar`. | `Không có` |
| Đưa con trỏ qua các nav item | Vệt sáng trượt tới item đang hover; khi con trỏ rời sidebar, vệt sáng mờ dần rồi biến mất. Không đổi route và không đổi focus. | `Không có` |
| Đưa con trỏ qua chuông và ba window control | Một vệt sáng trượt giữa bốn control; vệt chuyển sang màu cảnh báo tại Close rồi trở lại màu trung tính ở control khác. Không gọi command cho tới khi người dùng bấm. | `Không có` |
| Kéo vạch giữa sidebar và nội dung | Đổi độ rộng sidebar theo con trỏ, clamp trong `200px`–`420px`; transition độ rộng bị tắt suốt thời gian kéo và bật lại khi nhả. | `Không có` |
| Bấm `Ctrl+B` | Không có tác dụng. Shell không đăng ký tổ hợp này và listener của bản upstream đã bị bỏ. | `Không có` |
| Focus vạch kéo rồi bấm mũi tên | `ArrowLeft` và `ArrowRight` đổi `16px` mỗi lần, `Home` và `End` về cận dưới và cận trên; đây là thao tác bàn phím tương đương của kéo thả theo `§18`. | `←` `→` `Home` `End` |
| Bấm wordmark `XWork` | Mở `AppMenu`; menu điều khiển được hoàn toàn bằng bàn phím, `Esc` đóng và trả focus về wordmark. | `Không có` |
| Chọn `Quit XWork` trong menu | Gọi `request_quit`; nếu còn phiên thì mở `QuitDialog`, nếu không còn phiên thì backend dọn runtime rồi thoát. | `Không có` |
| Bấm `Minimize` | Gọi `minimize_main_window`; runtime không đổi. | `Không có` |
| Bấm `Maximize` | Gọi `toggle_main_window_maximized`; icon và nhãn đổi giữa `Maximize` và `Restore` theo giá trị trả về. | `Không có` |
| Double-click vùng kéo của topbar | Gọi `toggle_main_window_maximized`, giống bấm nút Maximize. | `Không có` |
| Nhấn chuột trái rồi kéo vùng trống của topbar hoặc breadcrumb | Xóa focus khỏi control cũ, đóng tooltip do focus đang mở, rồi di chuyển cửa sổ qua vùng `data-tauri-drag-region`; button và phần tử tương tác không nằm trong vùng kéo và không bị blur bởi handler này. | `Không có` |
| Bấm `Close (hides to tray)` | Gọi `hide_main_window`; phiên, tiến trình và pending quit request tiếp tục tồn tại. | `Không có` |
| Bấm `Cancel` trong `QuitDialog` | Gọi `cancel_quit` với `requestId` hiện tại, đóng hộp thoại, trả focus về wordmark. | `Esc` |
| Click ra ngoài `QuitDialog` | Xử lý như `Cancel`. | `Không có` |
| Bấm `Quit` trong `QuitDialog` | Gọi `confirm_quit`; hộp thoại chuyển sang trạng thái `Đang thoát` cho tới khi backend thoát hoặc trả lỗi. | `Không có` |
| Di chuyển focus trong `QuitDialog` | Focus bị giữ trong hộp thoại; thứ tự là `Cancel` rồi `Quit`. | `Tab` / `Shift+Tab` |

Mọi nút chỉ có icon đều có `aria-label` và tooltip cùng nội dung. Ở trạng thái thu gọn, tooltip của nav item mang nhãn khu vực đúng như `#shell-collapsed`; trigger của tooltip là chính link hoặc button nên tooltip hiện cả khi hover và khi focus bằng bàn phím.

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
  isSidebarResizing: boolean;
  isMaximized: boolean;
  windowControlFailure: WindowControlFailure | null;
  setSidebarWidthPx(next: number): void;
  toggleSidebarCollapsed(): void;
  setSidebarResizing(next: boolean): void;
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
| `sidebarWidthPx`, `isSidebarCollapsed` | UI tạm thời | Chỉ trong bộ nhớ ở lát cắt này; chuyển sang settings persistence của `BE-008` ở giai đoạn 6. `setSidebarWidthPx` clamp vào `200`–`420`. Hai giá trị này là nguồn duy nhất của `--sidebar-width` và trạng thái `open` của `SidebarProvider`. |
| `isSidebarResizing` | UI tạm thời | Chỉ bật trong lúc kéo bằng con trỏ, không bật khi đổi độ rộng bằng bàn phím; luôn tắt khi nhả, khi hủy pointer và khi sidebar thu gọn giữa lúc kéo. |
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

Các thành phần sidebar trong `src/components/animate-ui/` là component dùng chung của repo, không phải contract của feature: `FE-004` và `FE-006` được phép import chúng để dựng danh sách project và phiên, nhưng không import `AppSidebar` hay hai store của shell.

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
| Thu gọn sidebar khi đang kéo | Kết thúc kéo, tắt `isSidebarResizing` và giữ độ rộng gần nhất để lần mở rộng sau trả về đúng độ rộng đó. |
| Con trỏ vẫn nằm trên một nav item khi sidebar đang chuyển độ rộng | Vệt sáng bám theo item đó suốt quá trình chuyển động vì `Highlight` đo lại vùng theo từng frame; khi con trỏ rời sidebar, vệt sáng biến mất. |
| Con trỏ nằm trên nút thu gọn khi nhãn và chiều rộng đổi | Giữ đúng một vệt sáng; chiều rộng vệt cập nhật tức thì theo nút `Expand sidebar`, còn chuyển động vị trí vẫn dùng spring. |
| Cửa sổ bị thu hẹp dưới `768px` | Sidebar vẫn hiển thị đầy đủ. Bản sao chép đã bỏ `hidden md:block` và toàn bộ nhánh mobile, nên không có breakpoint nào ẩn sidebar. |
| Người dùng bật `prefers-reduced-motion` | Vệt sáng hover của sidebar và topbar bị tắt hoàn toàn, không có wrapper hay thuộc tính `data-highlight` nào được render; nav item và control topbar vẫn đổi nền khi hover; transition độ rộng khi thu gọn và mở rộng cũng bị tắt nên độ rộng đổi ngay lập tức. |
| Một nav item thu gọn đang giữ focus rồi người dùng kéo topbar | Pointer down trên nền kéo xóa focus trước khi native drag tiếp quản, nên tooltip của nav item đóng và không xuất hiện lại giữa lúc kéo. |
| Webview reload | Sidebar quay về `232px` và trạng thái mở rộng. Không có cookie, `localStorage` hay bất kỳ persistence nào ghi lại trạng thái sidebar ở lát cắt này. |
| Breadcrumb của route phiên khi chưa có `FE-006` | Hiển thị nhãn khu vực cùng `sessionId` thô; `FE-006` thay bằng tên project và tên phiên. |
| `invoke` bị từ chối vì thiếu quyền hoặc phản hồi không đúng dạng `{ code }` | Wrapper ném `IpcCallError` với `payload` bằng `null`; giao diện xử lý như lỗi tích hợp và không thử lại thành vòng lặp. |

## Tiêu chí hoàn thành

- [ ] `pnpm tauri dev` mở window `main` ở `1280 × 800`, không viền hệ điều hành, hiển thị topbar và sidebar đúng `#shell`: brand, breadcrumb, pill tìm kiếm, chuông, ba nút cửa sổ, bốn nav item, khối `Projects` rỗng, footer `Settings` và nút thu gọn.
- [ ] Bấm bốn nav item và `Settings` điều hướng đúng năm route, nav item đang mở có `aria-current="page"` và breadcrumb đổi theo tên khu vực; mỗi khu vực chưa có feature render `AreaPlaceholder` nêu rõ feature sở hữu.
- [ ] Nút thu gọn chuyển sidebar giữa `232px` và `56px` đúng `#shell-collapsed`: ẩn nhãn, ẩn khối `Projects`, wordmark còn chữ `X`, mọi icon có tooltip mang nhãn, nút cuối đổi thành `Expand sidebar`; độ rộng chuyển động chứ không nhảy bậc, và cột brand của topbar đi cùng nhịp với cạnh sidebar suốt chuyển động.
- [ ] Kéo vạch sidebar đổi độ rộng và clamp ở `200px` và `420px`; focus vạch kéo rồi bấm `←`, `→`, `Home`, `End` cho kết quả tương đương và `aria-valuenow` khớp độ rộng thực tế. Trong lúc kéo, cạnh sidebar đi đúng theo con trỏ, không trễ theo transition.
- [ ] Đưa con trỏ dọc bốn nav item cho vệt sáng trượt giữa các item; thu gọn khi con trỏ còn trên nút cuối giữ đúng một vệt sáng bám theo chiều rộng mới; bật `prefers-reduced-motion` trong hệ điều hành rồi mở lại làm vệt sáng biến mất, hover vẫn đổi nền và độ rộng đổi ngay không chuyển động.
- [ ] Đưa con trỏ qua chuông, Minimize, Maximize/Restore và Close chỉ render một vệt sáng chung; Close chuyển sang nền `error` và icon `on-primary`; với `prefers-reduced-motion`, cả bốn control dùng hover tĩnh và không render phần tử chuyển động.
- [ ] `Ctrl+B` không đổi trạng thái sidebar; tìm trong `src/` không còn listener nào nghe tổ hợp này.
- [ ] Không có cookie nào được ghi: sau khi thu gọn rồi mở rộng sidebar, `document.cookie` vẫn rỗng, và tìm trong `src/` không có `document.cookie`.
- [ ] `package.json` khóa `motion` đúng `13.1.1`; `src/components/animate-ui/` chỉ chứa sidebar, primitive `highlight` và helper `get-strict-context`, không có `sheet`, `input`, `skeleton` hay `separator`.
- [ ] Trên desktop thật, `Minimize` minimize cửa sổ, `Maximize` đổi qua lại giữa maximize và restore kèm đổi icon và nhãn, double-click vùng trống topbar cho kết quả giống nút `Maximize`, kéo vùng trống hoặc breadcrumb của topbar di chuyển được cửa sổ; bắt đầu kéo đóng tooltip đang mở do focus mà không làm button mất hành vi bấm.
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
- [ ] Trên Windows, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:rust` và `pnpm tauri build` đều pass.
- [ ] Smoke test thủ công trên Windows xác nhận cửa sổ không viền vẫn kéo đổi kích thước theo viền được, hide và show từ tray, minimize, maximize cùng `Quit XWork` hoạt động; kiểm tra macOS hoãn tới bước chuẩn bị phát hành theo quy tắc project.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/app/app-router.test.tsx` | Component | Năm route khu vực cùng hai route dành trước render `AreaPlaceholder` đúng tên khu vực; route không khớp render placeholder `Not found`; `errorElement` nhận lỗi render. |
| `src/app/app-shell.test.tsx` | Component | Landmark `banner`, `navigation` và `main` tồn tại đúng một lần; `--sidebar-width` theo `sidebarWidthPx` và `--sidebar-width-icon` bằng `56px`; trạng thái thu gọn ẩn đúng các phần; thứ tự focus theo `Tab`. |
| `src/app/app-topbar.test.tsx` | Component | Breadcrumb dựng từ route đã match và toàn bộ crumb thuộc vùng kéo; `SearchEntry` và `NotificationBell` là nút `disabled` có tooltip và không có badge; một vệt sáng chung chạy giữa chuông và ba window control, Close dùng màu cảnh báo, `prefers-reduced-motion` trả về hover tĩnh; pointer down trên nền kéo xóa focus cùng tooltip cũ; ba nút cửa sổ gọi đúng command; double-click vùng kéo gọi `toggle_main_window_maximized`; `window_operation_failed` hiện dòng lỗi `aria-live`; menu wordmark mở và đóng bằng bàn phím và có `Quit XWork` ở cuối. |
| `src/app/app-sidebar.test.tsx` | Component | Bốn nav item và `Settings` điều hướng đúng route và đặt `aria-current`; khối `Projects` hiện đúng câu trạng thái rỗng và không có nút `+`; nút thu gọn đổi nhãn và đổi `data-state` của sidebar; tooltip mang nhãn khi thu gọn, cả khi hover và khi focus; vạch kéo phản hồi `←`, `→`, `Home`, `End` và cập nhật `aria-valuenow`; kéo bằng con trỏ đặt rồi xóa `data-resizing`; thu gọn dưới con trỏ giữ đúng một vệt sáng; `prefers-reduced-motion` tắt vệt sáng; `Ctrl+B` không đổi trạng thái; `document.cookie` không bị ghi sau một vòng thu gọn và mở rộng. |
| `src/app/quit-dialog.test.tsx` | Component | Nội dung và số liệu theo `#dlg-quit`; số ít và số nhiều; ẩn dòng file chưa lưu khi bằng `0`; focus bị giữ trong hộp thoại; `Cancel`, `Esc`, click ngoài, `Quit`, trạng thái `Quitting…` và từng nhánh lỗi. |
| `src/app/shell-store.test.ts` | Unit | Clamp độ rộng ở hai cận, giữ độ rộng gần nhất qua một vòng thu gọn và mở rộng, bật và tắt `isSidebarResizing`, cập nhật `isMaximized`, xóa `windowControlFailure` khi thao tác sau thành công. |
| `src/app/quit-store.test.ts` | Unit | Chuyển trạng thái cho kết quả `null` và kết quả có request; chặn `confirm_quit` lặp; ánh xạ `runtime_snapshot_failed`, `runtime_shutdown_failed`, `quit_already_in_progress` và nhóm lỗi tích hợp; `stale_quit_request` gọi lại `request_quit` đúng một lần. |
| `src/app/use-lifecycle-events.test.ts` | Unit | Đăng ký đúng hai event một lần; dedupe theo `requestId`; điều hướng bằng `sessionId` nguyên vẹn; hủy đăng ký khi unmount. |
| `src/lib/ipc/app-lifecycle.test.ts` | Unit | Gọi đúng tên sáu command; `requestId` gửi dạng camelCase; lỗi dạng `{ code }` trở thành `IpcCallError` có `payload`; lỗi lạ trở thành `IpcCallError` với `payload` bằng `null`. |
| `src-tauri/tests/window_configuration.rs` | Rust integration | Window có label `main` được cấu hình mở ở `1280 × 800`. |

Các hành vi phụ thuộc cửa sổ native — kéo cửa sổ, minimize, maximize, hide xuống tray, mở lại từ tray và thoát process — được xác nhận bằng smoke test thủ công trên Windows với bản build thật; automated test không được coi là thay thế cho bước này.

Vị trí và độ mượt của vệt sáng sidebar/topbar không kiểm được bằng component test: trong `jsdom`, `getBoundingClientRect()` luôn trả về `0` nên vệt sáng có vùng bằng `0`. Test chỉ xác nhận số lượng, control active, biến thể màu và việc có render vệt sáng hay không theo `prefers-reduced-motion`; phần thị giác thuộc smoke test thủ công trên Windows.

## Câu hỏi mở

Không có.
