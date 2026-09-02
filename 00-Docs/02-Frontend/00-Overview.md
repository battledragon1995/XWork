# Danh sách chức năng Frontend

Tài liệu này liệt kê toàn bộ chức năng frontend của XWork với mã `FE-NNN` và mô tả khái quát, dựa trên `00-Docs/00-Overview/03-FunctionalRequirements.md`.

Không đặt contract chi tiết ở đây. Mỗi mã có một tài liệu chi tiết riêng tại `00-Docs/02-Frontend/FE-NNN-<ten-kebab>.md`, viết theo template `00-Docs/99-Template/02-Frontend.md`.

Quy ước:

- Mã đã cấp không thay đổi và không dùng lại. Chức năng bị loại bỏ được ghi chú thay vì xóa dòng.
- Chức năng được xếp vào phase mà nó bắt đầu xuất hiện; phần mở rộng ở phase sau ghi trong mô tả.
- Cột `Wireframe` trỏ đến các màn hình hoặc trạng thái giao diện tương ứng trong `00-Docs/01-Wireframe/`.
- Cột `Tham chiếu` trỏ đến mục tương ứng trong `03-FunctionalRequirements.md`.
- Yêu cầu tương tác chung (§18) áp dụng cho mọi chức năng: tooltip, chỉ báo focus, thao tác bàn phím, độ tương phản, trạng thái rỗng/lỗi và nhãn hành động phá hủy cụ thể.

## Phase 1 — Project và Terminal

| Mã | Chức năng | Khu vực | Mô tả khái quát | Wireframe | Tham chiếu |
|---|---|---|---|---|---|
| `FE-001` | Application shell | `src/app/` | Khung ứng dụng: sidebar (khu vực chính, danh sách project và phiên, ghim, kéo đổi độ rộng, thu gọn dạng icon), thanh trên cùng (ngữ cảnh, chuông thông báo, điểm vào tìm kiếm), vùng nội dung theo điều hướng; hộp thoại xác nhận Quit. | [Shell](../01-Wireframe/02-AppShell.html#shell), [sidebar thu gọn](../01-Wireframe/02-AppShell.html#shell-collapsed), [system tray](../01-Wireframe/02-AppShell.html#tray), [Quit](../01-Wireframe/04-Projects.html#dlg-quit) | §4, §5.3–5.4 |
| `FE-002` | Welcome | `src/features/home/` | Màn hình lần đầu khi chưa có dữ liệu: giới thiệu ngắn, `Add Project`, mở Quick Note, liên kết xem phím tắt chính; không tạo dữ liệu mẫu. | [Welcome](../01-Wireframe/02-AppShell.html#welcome) | §5.1 |
| `FE-003` | Home | `src/features/home/` | Dashboard mở mặc định: editor Quick Note, note ghim và gần đây, phiên đang chạy, project mở gần đây, event sắp tới; chỉ hiển thị khối thuộc phase đã triển khai. | [Trạng thái rỗng](../01-Wireframe/03-Home.html#empty), [đầy đủ](../01-Wireframe/03-Home.html#full) | §6 |
| `FE-004` | Projects | `src/features/projects/` | Trang lưới card project: tìm kiếm theo tên/đường dẫn, `Add Project` qua folder picker, đổi tên, ghim, mở folder bằng hệ điều hành, chọn lại đường dẫn, gỡ project và trạng thái `Unavailable`. | [Lưới project](../01-Wireframe/04-Projects.html#grid), [thêm project](../01-Wireframe/04-Projects.html#add), [không khả dụng](../01-Wireframe/04-Projects.html#unavailable), [gỡ project](../01-Wireframe/04-Projects.html#dlg-remove-project) | §7.1–7.4 |
| `FE-005` | Project Overview | `src/features/projects/` | Trang tổng quan một project: header với branch và Git status chỉ đọc, `New Session`, danh sách phiên hiện có; file mở gần đây (Phase 2), note và event liên kết (Phase 3–4). | [Project Overview](../01-Wireframe/04-Projects.html#overview) | §7.5 |
| `FE-006` | Session | `src/features/sessions/` | Vòng đời phiên trên giao diện: tạo phiên với màn hình chọn công cụ (gồm trạng thái công cụ `Unavailable` và kiểm tra lại), đổi tên, xóa có cảnh báo; hiển thị trạng thái phiên trên sidebar. | [Trạng thái sidebar](../01-Wireframe/04-Projects.html#sidebar-sessions), [tạo phiên](../01-Wireframe/04-Projects.html#new-session), [công cụ không khả dụng](../01-Wireframe/04-Projects.html#tool-unavailable), [xóa phiên](../01-Wireframe/04-Projects.html#dlg-delete-session) | §8, §10.3 |
| `FE-007` | Tab và Pane | `src/features/sessions/` | Thanh tab (tạo, đổi tên, kéo thả, đóng, mở lại tab vừa đóng) và bố cục pane: chia ngang/dọc tối đa 4, phóng to tạm thời, màn hình chọn nội dung cho pane mới, cảnh báo khi đóng còn tiến trình hoặc nội dung chưa lưu. | [Một pane](../01-Wireframe/04-Projects.html#panes-1), [hai pane](../01-Wireframe/04-Projects.html#panes-2), [ba pane](../01-Wireframe/04-Projects.html#panes-3), [bốn pane](../01-Wireframe/04-Projects.html#panes-4), [phóng to](../01-Wireframe/04-Projects.html#panes-max), [chọn nội dung](../01-Wireframe/04-Projects.html#pane-picker) | §9 |
| `FE-008` | Terminal | `src/features/terminal/` | Pane terminal render bằng WTerm: nhập liệu và tương tác CLI, chọn/sao chép/dán, cuộn lịch sử, tìm trong toàn bộ output, xóa màn hình, mở liên kết, tự điều chỉnh kích thước theo pane; nhận output stream từ backend. | [Terminal trong pane](../01-Wireframe/04-Projects.html#panes-1) | §10.1 |
| `FE-009` | Command Palette | `src/features/search/` | Hộp tìm kiếm hợp nhất và chạy lệnh dùng hoàn toàn bằng bàn phím; kết quả nhóm theo loại và mở đúng màn hình/đối tượng; phạm vi tìm mở rộng theo phase (project, phiên, thao tác → file, note, event). | [Command Palette](../01-Wireframe/02-AppShell.html#palette) | §14 |
| `FE-010` | Notification center | `src/features/notifications/` | Panel thông báo từ biểu tượng chuông: trạng thái đọc/chưa đọc, đánh dấu đã đọc, xóa, mở đúng project/phiên/event; bắt đầu với terminal và tiến trình nền, mở rộng reminder với hành động mở/hoãn/bỏ qua ở Phase 4. | [Notification panel](../01-Wireframe/02-AppShell.html#notifications), [reminder](../01-Wireframe/07-Calendar.html#reminder) | §15, §13.3 |
| `FE-011` | Settings khung, General và About | `src/features/settings/` | Khung điều hướng Settings; khu vực General (ngôn ngữ, hành vi cửa sổ và tray) và About (tên, phiên bản, hệ điều hành, liên kết). | [General](../01-Wireframe/02-AppShell.html#settings-general), [About](../01-Wireframe/02-AppShell.html#settings-about) | §17.1, §17.7 |
| `FE-012` | Settings Appearance | `src/features/settings/` | Theme `Light`/`Dark`/theo hệ điều hành, theme dựng sẵn, tùy chỉnh màu giao diện và bảng màu terminal, xem trước trực tiếp, khôi phục mặc định, cỡ chữ giao diện và terminal. | [Appearance](../01-Wireframe/02-AppShell.html#settings-appearance) | §17.2 |
| `FE-013` | Settings Terminal & CLI Profiles | `src/features/settings/` | Chọn shell mặc định, xem trạng thái profile Codex/Claude/Terminal, tạo/sửa/xóa profile tùy chỉnh (lệnh, tham số, shell, icon, màu, biến môi trường), kiểm tra lại lệnh của profile. | [Terminal & CLI Profiles](../01-Wireframe/02-AppShell.html#settings-terminal) | §17.3, §10.2 |
| `FE-014` | Settings Keyboard Shortcuts | `src/features/settings/` | Xem và tìm thao tác, đổi phím tắt, cảnh báo xung đột phím, khôi phục một phím hoặc toàn bộ phím mặc định. | [Keyboard Shortcuts](../01-Wireframe/02-AppShell.html#settings-shortcuts) | §17.4 |
| `FE-015` | Settings Data | `src/features/settings/` | Xuất và nhập gói sao lưu cục bộ, hiển thị vị trí dữ liệu XWork, reset ứng dụng sau xác nhận rõ ràng. | [Data](../01-Wireframe/02-AppShell.html#settings-data) | §17.6 |

## Phase 2 — File

| Mã | Chức năng | Khu vực | Mô tả khái quát | Wireframe | Tham chiếu |
|---|---|---|---|---|---|
| `FE-016` | File Explorer | `src/features/files/` | Cây file phụ bật/tắt trong phiên: mở/thu gọn folder, tìm và lọc theo tên, refresh, sao chép đường dẫn, mở vị trí bằng hệ điều hành, mở file vào tab mới hoặc pane. | [File Explorer](../01-Wireframe/05-Files.html#explorer) | §11.1–11.2 |
| `FE-017` | Source viewer | `src/features/files/` | Xem file source/text chỉ đọc với syntax highlighting; trạng thái file binary hoặc quá lớn kèm hành động mở bằng ứng dụng ngoài. | [Source viewer](../01-Wireframe/05-Files.html#source), [file không hỗ trợ](../01-Wireframe/05-Files.html#unsupported) | §11.2 |
| `FE-018` | Markdown editor | `src/features/files/` | Sửa file Markdown với hai chế độ `Edit`/`Preview` (nhớ chế độ gần nhất), lưu thủ công bằng nút và phím tắt, chỉ báo chưa lưu, cảnh báo khi đóng và hộp thoại chọn khi file thay đổi từ bên ngoài. | [Edit](../01-Wireframe/05-Files.html#md-edit), [Preview](../01-Wireframe/05-Files.html#md-preview), [chưa lưu](../01-Wireframe/05-Files.html#md-unsaved), [xung đột](../01-Wireframe/05-Files.html#md-conflict) | §11.3 |

## Phase 3 — Note

| Mã | Chức năng | Khu vực | Mô tả khái quát | Wireframe | Tham chiếu |
|---|---|---|---|---|---|
| `FE-019` | Notes | `src/features/notes/` | Trang hai vùng: danh sách với tìm kiếm, bộ lọc project, note ghim, Archive và Trash; editor/preview với autosave; thao tác ghim, liên kết project, lưu trữ, thùng rác (khôi phục, xóa vĩnh viễn, dọn toàn bộ). | [Editor](../01-Wireframe/06-Notes.html#edit), [Preview](../01-Wireframe/06-Notes.html#preview), [tìm kiếm](../01-Wireframe/06-Notes.html#search), [Archive](../01-Wireframe/06-Notes.html#archive), [Trash](../01-Wireframe/06-Notes.html#trash) | §12.1–12.2 |
| `FE-020` | Quick Note | `src/features/notes/` | Ghi chú nhanh từ editor trên Home và cửa sổ nổi (tiêu đề tùy chọn, nội dung Markdown, project liên kết, `Save`/`Cancel`); lưu xong đóng cửa sổ nổi. | [Trên Home](../01-Wireframe/03-Home.html#full), [lưu thành công](../01-Wireframe/03-Home.html#saved), [không hợp lệ](../01-Wireframe/03-Home.html#invalid), [cửa sổ nổi](../01-Wireframe/06-Notes.html#quick-note) | §12.3 |

## Phase 4 — Calendar

| Mã | Chức năng | Khu vực | Mô tả khái quát | Wireframe | Tham chiếu |
|---|---|---|---|---|---|
| `FE-021` | Calendar | `src/features/calendar/` | Lịch tháng với panel lịch trình của ngày đang chọn, danh sách `Upcoming` và `Missed`, chọn ngày để tạo event với ngày điền sẵn. | [Lịch tháng](../01-Wireframe/07-Calendar.html#month), [Upcoming](../01-Wireframe/07-Calendar.html#upcoming), [Missed](../01-Wireframe/07-Calendar.html#missed) | §13.1 |
| `FE-022` | Event | `src/features/calendar/` | Form tạo/sửa event (thời gian bắt đầu–kết thúc hoặc cả ngày, mô tả, project liên kết, quy tắc lặp, nhiều reminder) và panel chi tiết để xem, sửa, xóa. | [Form Event](../01-Wireframe/07-Calendar.html#form), [chi tiết Event](../01-Wireframe/07-Calendar.html#detail) | §13.2 |
| `FE-023` | Settings Notifications | `src/features/settings/` | Bật/tắt thông báo terminal/AI CLI và event/reminder; chọn loại trạng thái CLI đủ điều kiện gửi thông báo hệ điều hành. | [Notifications](../01-Wireframe/02-AppShell.html#settings-notifications) | §17.5 |
