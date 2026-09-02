# Danh sách chức năng Backend

Tài liệu này liệt kê toàn bộ chức năng backend của XWork với mã `BE-NNN` và mô tả khái quát, dựa trên `00-Docs/00-Overview/03-FunctionalRequirements.md`.

Không đặt contract chi tiết ở đây. Mỗi mã có một tài liệu chi tiết riêng tại `00-Docs/03-Backend/BE-NNN-<ten-kebab>.md`, viết theo template `00-Docs/99-Template/03-Backend.md`; command, event và schema public của chức năng được đặc tả trong tài liệu đó.

Quy ước:

- Mã đã cấp không thay đổi và không dùng lại. Chức năng bị loại bỏ được ghi chú thay vì xóa dòng.
- Chức năng được xếp vào phase mà nó bắt đầu xuất hiện; phần mở rộng ở phase sau ghi trong mô tả.
- Cột `Capability` trỏ đến khu vực theo `00-Docs/00-Overview/02-ProjectStructure.md`.
- Cột `Tham chiếu` trỏ đến mục tương ứng trong `03-FunctionalRequirements.md`.

## Phase 1 — Project và Terminal

| Mã | Chức năng | Capability | Mô tả khái quát | Tham chiếu |
|---|---|---|---|---|
| `BE-001` | App lifecycle và system tray | `src-tauri/src/app/`, `platform/` | Khởi động ứng dụng, single instance, đóng cửa sổ chính xuống tray, menu tray (`Open XWork`, `Quick Note`, phiên cần chú ý, `Quit XWork`), luồng Quit với dữ liệu xác nhận (số phiên, tiến trình) và dọn toàn bộ phiên runtime khi thoát. | §5, §16 |
| `BE-002` | Storage foundation | `src-tauri/src/storage/` | Mở database SQLite trong app data, migration runner chạy tuần tự, quản lý connection và transaction; nền cho mọi capability có persistence. | §2 |
| `BE-003` | Projects | `src-tauri/src/projects/` | Metadata project: thêm từ folder có sẵn, đổi tên hiển thị, ghim, gỡ (cảnh báo khi còn phiên hoặc tiến trình), thời điểm thêm và mở gần nhất, phát hiện folder không khả dụng, chọn lại đường dẫn; chặn tạo phiên khi `Unavailable`. | §7.1–7.4 |
| `BE-004` | Git status read-only | `src-tauri/src/projects/` | Nhận diện Git repository, đọc branch hiện tại, số lượng và danh sách file thay đổi bằng `gix`; không có bất kỳ thao tác ghi nào lên repository. | §7.3, §7.5 |
| `BE-005` | Sessions runtime | `src-tauri/src/sessions/` | Trạng thái phiên/tab/pane trong bộ nhớ cho lần chạy hiện tại: tạo, đổi tên, xóa (kết thúc tiến trình bên trong), trạng thái hoạt động cho sidebar (đang chạy, output chưa xem, cần chú ý, kết thúc/lỗi), mở lại tab vừa đóng; không khôi phục sau Quit. | §8, §9 |
| `BE-006` | CLI profiles | `src-tauri/src/terminal/` | Profile Codex/Claude/Terminal có sẵn và profile tùy chỉnh: CRUD, shell mặc định chung và shell riêng theo profile, kiểm tra lệnh tồn tại, biến môi trường với giá trị nhạy cảm lưu trong OS credential store. | §10.2–10.3, §17.3 |
| `BE-007` | Terminal và PTY | `src-tauri/src/terminal/` | Tạo PTY (ConPTY trên Windows), khởi chạy lệnh profile tại folder gốc project, stream output có thứ tự qua Channel, nhận input và resize, vòng đời tiến trình gắn với pane/tab/phiên và tiếp tục chạy nền khi chuyển phiên hoặc ẩn xuống tray. | §10.1, §8.2 |
| `BE-008` | Settings persistence | `src-tauri/src/settings/` | Lưu và đọc settings: general, theme và tùy chỉnh màu, cỡ chữ, hành vi cửa sổ/tray; cấu hình thông báo ở Phase 4. | §17.1–17.2, §17.5 |
| `BE-009` | Keyboard shortcuts | `src-tauri/src/settings/`, `platform/` | Lưu phím tắt tùy chỉnh, phát hiện xung đột, khôi phục một phím hoặc toàn bộ mặc định; đăng ký phím tắt toàn cục cho Quick Note ở Phase 3. | §17.4 |
| `BE-010` | Unified search | `src-tauri/src/search/` | Query tìm kiếm hợp nhất trên project, phiên, note, event và file theo tên, cùng command catalog cho Command Palette; chỉ dùng public query của capability nguồn; phạm vi mở rộng theo phase. | §14 |
| `BE-011` | Notifications | `src-tauri/src/notifications/` | Trung tâm thông báo: ghi nhận từ terminal/AI CLI cần chú ý và tiến trình nền kết thúc/lỗi (reminder ở Phase 4), trạng thái đọc/chưa đọc, xóa; gửi thông báo hệ điều hành có chọn lọc theo trạng thái hiển thị và settings. | §15, §17.5 |
| `BE-012` | Backup và reset | `src-tauri/src/settings/`, `storage/` | Xuất gói sao lưu cục bộ (project metadata, note, event, CLI profile, theme, phím tắt, settings; secret chỉ ở dạng metadata tham chiếu), nhập khôi phục, hiển thị vị trí dữ liệu, reset ứng dụng. | §17.6 |

## Phase 2 — File

| Mã | Chức năng | Capability | Mô tả khái quát | Tham chiếu |
|---|---|---|---|---|
| `BE-013` | File tree | `src-tauri/src/files/` | Duyệt cây file theo ignore rule, tìm và lọc theo tên, refresh; mọi đường dẫn giới hạn trong project đã đăng ký, không theo symbolic link mặc định. | §11.1 |
| `BE-014` | File read và watch | `src-tauri/src/files/` | Đọc nội dung file với phát hiện binary và giới hạn kích thước, theo dõi thay đổi từ bên ngoài bằng file watcher, danh sách file mở gần đây theo project. | §11.2–11.3, §7.5 |
| `BE-015` | Markdown save | `src-tauri/src/files/` | Ghi file Markdown khi người dùng lưu thủ công; phát hiện xung đột với thay đổi từ bên ngoài và không bao giờ tự ghi đè. | §11.3 |

## Phase 3 — Note

| Mã | Chức năng | Capability | Mô tả khái quát | Tham chiếu |
|---|---|---|---|---|
| `BE-016` | Notes | `src-tauri/src/notes/` | CRUD note với autosave nội dung, tiêu đề tùy chọn, ghim, liên kết project, Archive và Trash (khôi phục, xóa vĩnh viễn, dọn toàn bộ); tìm theo tiêu đề và nội dung, lọc theo project. | §12.1–12.2 |
| `BE-017` | Quick Note window | `src-tauri/src/app/`, `notes/` | Cửa sổ Quick Note nổi trên ứng dụng khác, mở từ phím tắt toàn cục, menu tray và Home; lưu thành note rồi đóng cửa sổ. | §12.3, §16 |

## Phase 4 — Calendar

| Mã | Chức năng | Capability | Mô tả khái quát | Tham chiếu |
|---|---|---|---|---|
| `BE-018` | Calendar events | `src-tauri/src/calendar/` | CRUD event: thời gian bắt đầu–kết thúc hoặc cả ngày, mô tả, project liên kết, quy tắc lặp (ngày/tuần/tháng/năm, kết thúc theo ngày hoặc số lần); tính occurrence cho lịch tháng, panel ngày và `Upcoming`. | §13.1–13.2 |
| `BE-019` | Reminder scheduler | `src-tauri/src/calendar/` | Scheduler tính và phát reminder đến hạn, hoãn 5/10/30 phút, bỏ qua; reminder đến hạn khi ứng dụng đã thoát được đưa vào `Missed` ở lần mở sau và không phát hàng loạt thông báo hệ điều hành. | §13.3 |
