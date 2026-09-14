# Kết quả sửa UI theo wireframe — 14/09/2026

Đã xử lý UI của **17 nhóm màn hình/chức năng**, tương ứng **56 điểm đối chiếu** và blocker mở Markdown trong [báo cáo ngày 13/09](00-Overview.md). Mỗi nhóm có một commit riêng. Các phần chưa thể khớp hoàn toàn do giới hạn chức năng hiện có được ghi rõ bên dưới; không coi chúng là đã triển khai.

Phạm vi theo xác nhận của người dùng: sửa UI bằng các chức năng hiện có, ghi rõ phần còn thiếu và **không chạy build**. Không thay backend, binding sinh tự động, dependency, cấu hình theme đang lưu hay nội dung wireframe. Báo cáo audit và ảnh gốc được giữ nguyên.

## Kết quả theo màn hình

| Nhóm | Mã đối chiếu | Kết quả |
|---|---|---|
| [Khung ứng dụng](01-AppShell.md) | UI-SHELL-01–04 | Đúng bộ font serif/sans/mono, nền chọn Cream, nhãn trắng trên nút coral mặc định; highlight sidebar thu gọn không tràn footer. Vẫn giữ lựa chọn tương phản của theme tùy chỉnh. |
| [Home](02-Home.md) | UI-HOME-01–06 | Tiêu đề ngày, hai cột đúng thứ tự, vùng viết liền mạch, empty state gọn, Git và thời gian truy cập tương đối, hàng session/project nhẹ hơn. |
| [Projects](03-Projects.md) | UI-PROJECT-01–04 | Grid ba cột ở cửa sổ chuẩn; branch/Git/số session lấy từ dữ liệu thật; overview hai cột có Recent files, Notes và Events. New event chuyển sang form đã chọn đúng project. |
| [Sessions và panes](04-Sessions-And-Panes.md) | UI-SESSION-01–04 | Bộ chọn công cụ co giãn theo vùng chứa, màu mark mặc định đúng mẫu, điều khiển nền tối dễ đọc; Browse files mở Explorer và kích hoạt pane đích. |
| [Files](05-Files.md) | UI-FILE-01–04 | Icon cây tệp, toolbar gọn, menu của hàng chọn, tab mặc định hiển thị tên file; gutter và scrollbar editor giữ nền tối. |
| [Files — blocker Markdown](05-Files.md) | Blocker ngoài 56 điểm UI | Sửa phép tính kích thước file với giá trị JSON number/bigint. Mở được AGENTS.md trong Edit và Preview; sửa thêm màu chữ/nền Preview sau khi màn hình có thể mở được. |
| [Notes](06-Notes.md) | UI-NOTE-01–04 | Header search/thêm note, chip bộ lọc, Archive/Trash ở footer; toolbar mode/project/actions cùng nhóm. Archive/Trash ẩn draft không liên quan và giữ draft khi quay lại All. |
| [Quick Note](07-Quick-Note.md) | UI-QUICK-01–03 | Vùng viết liền mạch, wordmark và Esc gọn; chiều cao theo UI scale, footer Save/Cancel luôn trong cửa sổ. |
| [Calendar](08-Calendar.md) | UI-CAL-01–06 | Header tháng/breadcrumb, điều hướng và segmented control rõ; tỷ lệ lịch/panel, today/selected/legend đúng hệ thống. Form nhóm lại ngày/giờ, repeat/reminders; header/footer cố định, phần nội dung cuộn riêng. |
| [Command Palette](09-Command-Palette.md) | UI-SEARCH-01–03 | Highlight amber, tắt gạch kiểm tra chính tả, keycap và icon theo loại nội dung. Ưu tiên lệnh khả dụng trong tập kết quả backend trả về; giới hạn ở mục dưới vẫn còn. |
| [Bảng thông báo](10-Notification-Panel.md) | UI-BELL-01 | Bỏ thông điệp empty state lặp ở footer, giữ một liên kết tới Notification settings. |
| [General](11-Settings-General.md) | UI-GENERAL-01–02 | Switch ink, nhãn Always on và trường English có viền; startup vẫn chưa có. |
| [Appearance](12-Settings-Appearance.md) | UI-APPEAR-01–03 | Nhãn trái/điều khiển phải, ba preset một hàng, ANSI hai hàng swatch có popup sửa màu, slider và trạng thái chọn ink. Cả hai thanh cỡ chữ hiện trong khung kiểm tra. |
| [Terminal & CLI Profiles](13-Settings-Terminal-Profiles.md) | UI-PROFILE-01–03 | Mark và bảng nhẹ hơn; sheet hẹp, nhóm Icon & colour, nút thêm phụ gọn, footer cố định. Giữ nguyên mô hình đối số/secret hiện có. |
| [Keyboard Shortcuts](14-Settings-Keyboard-Shortcuts.md) | UI-KEY-01–02 | Global đứng đầu, một hàng tiêu đề cột, search gọn và restore sát phải; Default/Not available yet là thông tin phụ. Recorder và trạng thái phím toàn cục vẫn hoạt động theo contract. |
| [Notifications](15-Settings-Notifications.md) | UI-NOTIFY-01–02 | Checklist ở cột phải, checkbox/switch ink; Missed có switch khóa và Always on. Hướng dẫn bật terminal activity chỉ xuất hiện khi activity đang tắt. |
| [Data](16-Settings-Data.md) | UI-DATA-01–03 | Path/copy/open cùng hàng; icon export/import, copy ngắn hơn nhưng giữ thông tin tác động. Reset có icon cảnh báo và khối thông tin màu kem, giữ bước xác nhận RESET. |
| [About](17-Settings-About.md) | UI-ABOUT-01–02 | Wordmark X coral + Work serif; version/mô tả bên cạnh, bảng thông tin gọn. OS, architecture và default shell lấy từ nguồn hiện có; phần hỗ trợ còn thiếu được liệt kê dưới đây. |

## Phần còn thiếu hoặc khác mẫu có chủ đích

| Màn hình/mã | Giới hạn còn lại |
|---|---|
| General / UI-GENERAL-02 | Chưa có Start XWork when I sign in: contract Settings không có persistence hay tích hợp autostart. Ngôn ngữ chỉ có English; General vẫn là thông tin chỉ đọc theo backend hiện hành. |
| About / UI-ABOUT-02 | Chưa có nguồn dữ liệu runtime cho WebView2, Terminal backend và build metadata; chưa có đường dẫn public được xác định cho Documentation/License/Report an issue, chưa có Copy diagnostics hoặc updater. Không tạo số liệu, URL hoặc nút không hoạt động. Default shell đã được bổ sung từ catalog BE-006 hiện có. |
| Command Palette / UI-SEARCH-02 | Không quảng bá Ctrl+Enter mở split vì callback kích hoạt Palette hiện chưa có thao tác đó. Esc, mũi tên và Enter đã được trình bày thành keycap. |
| Command Palette / UI-SEARCH-03 | Backend giới hạn tám kết quả mỗi nhóm, không nhận tham số mở rộng limit. UI sắp lệnh khả dụng lên trước trong các kết quả đã nhận; chưa thể bổ sung các lệnh bị backend cắt khỏi tập này. |
| Sessions / UI-SESSION-04 | Browse files dùng Explorer hiện có. Không thêm phím Ctrl+B giả khi catalog phím tắt chưa có action Explorer; không tạo danh sách file gần đây giả trong pane picker. |
| Profiles / UI-PROFILE-02 | Giữ một đối số literal cho mỗi hàng, chỉnh icon/hex trực tiếp và quy tắc giữ/thay secret. Không chuyển thành chuỗi lệnh ghép hoặc cho sửa profile dựng sẵn chỉ để giống hình minh họa. |
| Files / UI-FILE-03 | DTO chưa có cờ phân biệt tên tab do người dùng đặt. Chỉ literal mặc định `New Tab` được thay bằng tên file khi hiển thị; tên khác giữ nguyên. |
| Home / UI-HOME-04 | Empty state session dùng Open Projects theo luồng tạo session hiện có; Home không sở hữu một thao tác tạo session độc lập. |
| Projects / UI-PROJECT-04 | Recent files là phần tóm tắt chỉ đọc từ command sẵn có; không bổ sung luồng tạo session/mở file mới tại overview. |

## Kiểm tra

- **174 file test, 2.744 test đều đạt** trong lần chạy toàn bộ frontend cuối cùng.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm format:rust` và `git diff --check` đạt.
- Kiểm tra trực tiếp trên Windows với executable debug có sẵn và Vite dev; cửa sổ chính 1280×800, UI 15px, terminal 16px. Quick Note thực tế khoảng 562×422, thấy đủ Save/Cancel.
- Đã kiểm tra các trang và trạng thái nêu trên, bao gồm Markdown Edit/Preview, Calendar form, popup màu ANSI, recorder và preview Reset. Form được đóng/hủy, không lưu note/event/profile, không thay theme hoặc phím tắt, không áp dụng Reset/Import/Export.
- Mở một session phục vụ kiểm tra Terminal/pane/file; không gõ lệnh terminal hoặc chạy Codex/Claude. Việc mở project/file cập nhật trạng thái phiên và danh sách gần đây của app.
- Không chạy build, Rust compilation/Clippy/Rust tests, kiểm tra macOS hay desktop E2E. Không có thay đổi Rust để cần xác nhận hành vi backend mới.
- Dữ liệu thực tế ít: không tuyên bố đã kiểm tra mọi trạng thái có dữ liệu, mọi kích thước cửa sổ hoặc mọi theme tùy chỉnh. Unit/component tests bao phủ thêm các trạng thái bằng dữ liệu cô lập.

Chi tiết triển khai và bằng chứng theo từng nhóm: [kế hoạch đã hoàn thành](../../98-Plan/20260914-ui-wireframe-alignment.md).
