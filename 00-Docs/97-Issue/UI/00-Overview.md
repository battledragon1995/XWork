# Đối chiếu UI XWork với wireframe — 13/09/2026

Đã mở và kiểm tra trực tiếp bản Windows của XWork. Ghi nhận **56 điểm chưa khớp trong 17 báo cáo theo màn hình/chức năng**: **6 P1, 47 P2, 3 P3**. Có thêm **1 blocker khi mở Markdown**, được tách khỏi số điểm thẩm mỹ để không suy đoán về màn hình chưa quan sát được.

Phạm vi hoàn thành là khảo sát và lập danh sách issue. Không sửa mã nguồn, wireframe, cấu hình theme hoặc dữ liệu nội dung. Không tạo kế hoạch triển khai hoặc thực hiện các đề xuất sửa.

## Các điểm ảnh hưởng lớn nhất

| Mã | Vấn đề đã nhìn thấy | Báo cáo |
|---|---|---|
| UI-HOME-01 | Composer bị đẩy xuống; Home sai thứ tự và tỷ lệ hai cột | [Home](02-Home.md) |
| UI-PROJECT-03 | Overview mất hai cột; Notes/Events đẩy Sessions xuống thấp | [Projects](03-Projects.md) |
| UI-SESSION-03 | Nút pane và toolbar Terminal gần như chìm vào nền tối | [Sessions và panes](04-Sessions-And-Panes.md) |
| UI-QUICK-01 | Quick Note khuất Save/Cancel, cuộn cuối vẫn thấy nút bị cắt | [Quick Note](07-Quick-Note.md) |
| UI-CAL-01 | Điều hướng lịch và Day/Upcoming/Missed trông như chữ thường | [Calendar](08-Calendar.md) |
| UI-CAL-04 | Sheet sự kiện không giữ footer trong vùng nhìn, nút cuối bị cắt | [Calendar](08-Calendar.md) |

P1 nghĩa là cần ưu tiên trong một lượt sửa UI sau này vì che hành động quan trọng, làm khó thao tác hoặc phá bố cục cốt lõi. P2 là chênh lệch rõ về bố cục, thành phần, màu, chữ hoặc nội dung hiển thị. P3 là mức hoàn thiện nhỏ. Đây là ưu tiên đánh giá UI, không thay thế mức độ bug chức năng.

## Danh sách báo cáo

| Màn hình/chức năng | Số điểm | Mức cao nhất |
|---|---:|---|
| [Khung ứng dụng và phong cách chung](01-AppShell.md) | 4 | P2 |
| [Home](02-Home.md) | 6 | P1 |
| [Danh sách và tổng quan Projects](03-Projects.md) | 4 | P1 |
| [Sessions, chọn công cụ và chia pane](04-Sessions-And-Panes.md) | 4 | P1 |
| [File Explorer, source viewer và giới hạn Markdown](05-Files.md) | 4 | P2 |
| [Notes, Archive và Trash](06-Notes.md) | 4 | P2 |
| [Cửa sổ nổi Quick Note](07-Quick-Note.md) | 3 | P1 |
| [Calendar và biểu mẫu sự kiện](08-Calendar.md) | 6 | P1 |
| [Command Palette](09-Command-Palette.md) | 3 | P2 |
| [Bảng thông báo ở biểu tượng chuông](10-Notification-Panel.md) | 1 | P3 |
| [Settings — General](11-Settings-General.md) | 2 | P2 |
| [Settings — Appearance](12-Settings-Appearance.md) | 3 | P2 |
| [Settings — Terminal & CLI Profiles](13-Settings-Terminal-Profiles.md) | 3 | P2 |
| [Settings — Keyboard Shortcuts](14-Settings-Keyboard-Shortcuts.md) | 2 | P2 |
| [Settings — Notifications](15-Settings-Notifications.md) | 2 | P2 |
| [Settings — Data và hộp thoại Reset](16-Settings-Data.md) | 3 | P2 |
| [Settings — About](17-Settings-About.md) | 2 | P2 |

## Điều kiện và cách đối chiếu

- Ngày: 13/09/2026, múi giờ Asia/Bangkok.
- Mã nguồn lúc bắt đầu: commit 0194f59, “Implement FE023”; working tree sạch trước audit.
- Khởi động từ workspace bằng pnpm tauri dev để dùng mã nguồn hiện tại, không dựa vào screenshot cũ hoặc chỉ đọc JSX.
- Cửa sổ chính theo tauri.conf.json: 1280 × 800; ảnh capture bao cả viền khoảng 1282 × 802. About báo Windows build 26200.
- Theme có sẵn: Light / Cream; chữ giao diện **15 px**, Terminal **16 px**. Wireframe dùng body 14 px, code 13 px. App áp dụng UI scale nên không quy trực tiếp mọi chênh pixel thành lỗi.
- Màu cấu hình chính quan sát được: Accent #cc785c, Canvas #faf9f5, Sidebar #f5f0e8, Text #141413.
- Wireframe là HTML/CSS trong [01-Wireframe](../../01-Wireframe/01-Index.html), mở bằng trình duyệt tích hợp. Giữ phần chú thích frame ngoài khung để truy xuất được trạng thái tham chiếu.
- Dữ liệu ban đầu: một dự án XWork, chưa có note/event, chưa có session đang chạy. Tạo một session tạm để quan sát Terminal, chia pane và mở file; không nhập lệnh Terminal và không chạy Codex/Claude.
- Các form Note, Quick Note, New Event, New Profile chỉ mở ở trạng thái rỗng; không lưu nội dung. Hộp Reset chỉ mở để quan sát rồi Cancel. Sidebar được mở rộng trở lại sau khi thử Collapse.
- Việc mở dự án/file làm thay đổi trạng thái phiên, danh sách gần đây và thời điểm truy cập của app; đó là tác động của thao tác kiểm tra, không phải sửa sản phẩm.

Các vấn đề về cấu trúc, nút bị cắt, ký hiệu và màu được đánh giá trực tiếp từ ảnh. Một số chênh lệch “thiếu thành phần” có thể do tính năng được hoãn hoặc đặc tả thay đổi; báo cáo ghi đúng khác biệt với wireframe, không tự quyết định triển khai thêm.

Không dùng khác biệt về tên, ngày tháng, số lượng dữ liệu mẫu hoặc version để tạo issue. Các khu vực chỉ có dữ liệu rỗng được ghi rõ; không khẳng định đã kiểm tra trạng thái có dữ liệu.

## Luồng đã đi qua

1. Home → cuộn composer/notes.
2. Projects → XWork overview → New Session → Terminal → Split right.
3. File Explorer → package.json → mở AGENTS.md gặp màn hình lỗi.
4. Notes → New note rỗng → Archive → Trash.
5. Calendar → New Event → cuộn form → hủy → Upcoming → Missed.
6. Settings → General → Appearance → Terminal & CLI Profiles → form New Profile → Keyboard Shortcuts → Notifications → Data → dialog Reset/hủy → About.
7. Command Palette → truy vấn xwork → bảng Notifications → Collapse/Expand sidebar.
8. Home → Quick Note → cuộn → đóng; bổ sung ảnh Home có session và phần cuối trang.

## Phạm vi từng frame

“Đã xem” là đã có UI thực tế và ảnh của trạng thái được mô tả. “Một phần” nghĩa là chỉ xem cấu trúc/empty state hoặc có khác biệt dữ liệu. “Chưa kiểm tra” không được hiểu là đạt hay lỗi.

| Deck/frame | Mức bao phủ và giới hạn |
|---|---|
| AppShell #welcome | Chưa kiểm tra: app đã có dự án, không reset dữ liệu để về lần chạy đầu |
| AppShell #shell | Đã xem khung đầy đủ qua Home, Projects, Settings và session |
| AppShell #shell-collapsed | Đã xem sidebar biểu tượng, có ảnh lỗi nút mở rộng |
| AppShell #palette | Đã xem bảng mặc định và kết quả Projects/Sessions; chưa xem mọi nhóm |
| AppShell #notifications | Một phần: panel rỗng, chưa có mục unread |
| AppShell #tray | Chưa kiểm tra system tray; công cụ capture hiện chọn cửa sổ app, chưa thu được bằng chứng tray |
| AppShell #settings-general | Đã xem toàn trang |
| AppShell #settings-appearance | Đã xem đầu/cuối trang, không đổi theme |
| AppShell #settings-terminal | Đã xem danh sách và form New Profile; chưa có custom profile để so Edit có dữ liệu |
| AppShell #settings-shortcuts | Một phần: danh sách; chưa có recorder/conflict |
| AppShell #settings-notifications | Đã xem trang, không đổi thiết lập |
| AppShell #settings-data | Đã xem Data và dialog Reset, hủy trước mọi thao tác ghi/xóa |
| AppShell #settings-about | Đã xem toàn trang |
| Home #empty | Đã xem với một dự án và chưa có note/event/session |
| Home #full | Một phần: có session sau audit; chưa có note/event để so card dữ liệu |
| Home #saved, #invalid | Chưa kiểm tra toast/validation; không lưu note |
| Projects #grid | Một phần: một card dự án Git |
| Projects #add | Chưa mở folder picker vì dự án hiện tại đủ cho audit |
| Projects #overview | Đã xem overview; danh sách liên kết còn rỗng |
| Projects #unavailable | Chưa có dự án mất thư mục, không di chuyển/xóa thư mục để tạo trạng thái |
| Projects #sidebar-sessions | Một phần: một session, chưa có toàn bộ màu trạng thái |
| Projects #new-session | Đã xem All tools; ban đầu chưa có Recently used |
| Projects #tool-unavailable | Chưa có công cụ unavailable, không sửa PATH/profile để tạo lỗi |
| Projects #panes-1 | Đã xem Terminal khởi động ổn định; không nhập lệnh |
| Projects #panes-2 | Một phần: Terminal bên trái, pane trống bên phải |
| Projects #panes-3, #panes-4, #panes-max | Chưa kiểm tra bố cục 3/4 pane và maximize |
| Projects #pane-picker | Đã xem pane trống và tình huống bật Explorer |
| Projects #dlg-delete-session, #dlg-remove-project, #dlg-quit | Chưa kiểm tra các cảnh báo hủy phiên/dự án/quit |
| Files #explorer | Đã xem cây tệp, filter/toolbar; chưa mở toàn bộ context menu |
| Files #source | Đã xem package.json trên source viewer |
| Files #md-edit | Bị chặn: mở AGENTS.md dẫn tới Something went wrong |
| Files #md-preview, #md-unsaved, #md-conflict | Chưa kiểm tra vì Markdown bị chặn; không chỉnh file để ép trạng thái |
| Files #unsupported | Chưa mở binary/too-large |
| Notes #edit | Một phần: editor của bản nháp rỗng |
| Notes #preview | Chưa kiểm tra vì không có note đã lưu |
| Notes #search | Một phần: bộ lọc/search rỗng, chưa có kết quả |
| Notes #archive, #trash | Một phần: danh sách rỗng; không có banner/restore/delete của một note cụ thể |
| Notes #quick-note | Đã xem cửa sổ rỗng và cuộn, không lưu |
| Calendar #month | Đã xem tháng hiện tại và Day rỗng |
| Calendar #upcoming, #missed | Một phần: chưa có mục dữ liệu |
| Calendar #form | Đã xem form New Event, đầu/giữa/cuối, không lưu |
| Calendar #detail, #reminder | Chưa có sự kiện/nhắc lịch để mở; không tạo dữ liệu hoặc thông báo OS |

## Bằng chứng và giới hạn kết luận

- Ảnh nằm trong [assets/2026-09-13](assets/2026-09-13/). Tên chứa app là ảnh cửa sổ native; tên chứa ref là ảnh wireframe đã render.
- Ảnh được giữ nguyên, không vẽ lại UI. Vầng màu quanh con trỏ là lớp hiển thị của công cụ điều khiển; **không được tính là lỗi UI**.
- File .txt cùng tên ảnh app lưu cây accessibility tại lúc capture để xác minh label/control và trạng thái disabled.
- Blocker Markdown: [10-app-markdown-blocker.jpg](assets/2026-09-13/10-app-markdown-blocker.jpg). Chưa xác định nguyên nhân và chưa sửa.
- Không đánh giá toàn bộ khả năng truy cập chỉ từ screenshot. Chỗ chữ/nút chìm vào nền là rủi ro thị giác; chưa đo contrast ratio, thử screen reader hoặc mọi trạng thái focus.
- Chỉ kiểm tra Windows, một kích thước cửa sổ chính và cấu hình font đang có; chưa kiểm tra macOS, dark theme, DPI khác, animation hoặc mọi breakpoint.
- Không thêm/chạy automated desktop E2E. Không sửa source nên không chạy lại bộ frontend/Rust test, formatter/linter/build kiểm thử toàn bộ. Bản dev đã build và mở được để kiểm tra trực tiếp.
- Tiêu chí kiểm tra tài liệu: UTF-8 hợp lệ, mã issue duy nhất, đủ 56 issue, link/ảnh tồn tại, anchor wireframe đúng, file ảnh JPEG giải mã được và git chỉ có thư mục issue UI mới. Kết quả máy kiểm tra được ghi trong manifest.json cùng thư mục ảnh.

Các báo cáo này là danh sách chênh lệch để người đọc xem xét. Chưa issue nào được đánh dấu đã sửa.
