# Roadmap triển khai

Tài liệu này mô tả trình tự triển khai toàn repo theo các lát cắt chức năng có thể kiểm thử đầu-cuối. Mỗi lát cắt đi từ backend đến frontend, tích hợp ngay và chỉ được xem là hoàn thành khi hành vi người dùng tương ứng chạy bằng implementation thật.

Không đặt task chi tiết hoặc ước lượng thời gian ở đây. Mỗi lát cắt có plan chi tiết riêng tại `00-Docs/98-Plan/NN-<ten-kebab>.md`, viết khi lát cắt đó chuẩn bị bắt đầu. Mã `FE-NNN`/`BE-NNN` tham chiếu danh mục trong `00-Docs/02-Frontend/00-Overview.md` và `00-Docs/03-Backend/00-Overview.md`.

## Hướng tiếp cận

- `Giai đoạn 1 — Scaffold frontend` đã hoàn thành và được giữ nguyên như lịch sử triển khai.
- Scaffold desktop/backend được thực hiện ngay sau scaffold frontend để mọi tính năng tiếp theo có thể chạy và kiểm thử trong Tauri từ đầu.
- Mỗi lát cắt triển khai theo thứ tự: chốt tài liệu và contract liên quan → viết test backend → triển khai backend và sinh binding → triển khai frontend → kiểm thử unit/component, integration và smoke thủ công Windows khi có hành vi native.
- Mã FE và BE không ghép theo số thứ tự. Một lát cắt nhóm các mã cùng tạo ra một hành vi người dùng hoàn chỉnh; ví dụ `BE-001` kết hợp với `BE-002` trước khi hoàn thiện phần lifecycle của `FE-001`.
- Không dùng mock IPC làm runtime phát triển cho tính năng sản phẩm. Test double chỉ được dùng bên trong unit/component test và phải bám đúng contract public đã sinh từ backend.
- Các giao diện tổng hợp như Application shell, Home, Project Overview, Command Palette và Notification center được mở rộng tại lát cắt sở hữu dữ liệu mới. Mỗi phần mở rộng phải được tích hợp và kiểm thử ngay trong lát cắt đó.
- Thứ tự vẫn giữ ranh giới sản phẩm Phase 1 → 4 của `03-FunctionalRequirements.md`, nhưng trong mỗi phase ưu tiên lát cắt nhỏ nhất có thể xác minh độc lập.

## Điều kiện hoàn thành chung của một lát cắt

Trừ scaffold và chuẩn bị phát hành, một lát cắt chỉ hoàn thành khi:

- Tài liệu `BE-NNN`, `FE-NNN` và wireframe áp dụng đã đủ dữ kiện, không còn câu hỏi mở ảnh hưởng implementation.
- Backend có test cho behavior và business rule mới; command/event/channel dùng phạm vi hẹp và binding TypeScript được sinh từ kiểu public của Rust.
- Frontend gọi backend thật qua wrapper trong `src/lib/ipc/`; không có DTO viết tay hoặc mock runtime cho phạm vi đã hoàn thành.
- Unit/component test frontend cùng unit/integration/contract test Rust chứng minh luồng chính và các trạng thái lỗi quan trọng; hành vi chỉ quan sát được qua cửa sổ hệ điều hành có checklist smoke thủ công Windows.
- Formatter, lint, type-check, frontend test/build, Rustfmt, Clippy với warnings denied, Rust test và Tauri build trên Windows đều pass.

## Tổng quan trình tự

| Giai đoạn | Lát cắt | Backend trước | Frontend sau | Bắt đầu sau |
|---|---|---|---|---|
| 0 | Nền tài liệu | Tài liệu `BE-NNN` theo nhu cầu | Wireframe và tài liệu `FE-NNN` theo nhu cầu | — |
| 1 | Scaffold frontend — **đã hoàn thành** | — | Khung SPA và quality gates | 0 (một phần) |
| 2 | Scaffold desktop/backend — **đã hoàn thành** | Tauri 2, Rust toolchain, CI desktop | Bọc SPA hiện có trong desktop runtime | 1 |
| 3 | Lifecycle và application shell — **đã hoàn thành** | `BE-002`, `BE-001` | `FE-001` | 2 |
| 4 | Projects và Welcome | `BE-003` | `FE-002`, `FE-004`; mở rộng `FE-001` | 3 |
| 5 | Git status và Project Overview | `BE-004` | `FE-005` | 4 |
| 6 | Settings nền tảng | `BE-008` | `FE-011`, `FE-012`; mở rộng `FE-001` | 3 |
| 7 | CLI profiles | `BE-006` | `FE-013` | 4, 6 |
| 8 | Session, tab và pane | `BE-005` | `FE-006`, `FE-007` | 4, 7 |
| 9 | Terminal và PTY | `BE-007` | `FE-008`; hoàn thiện luồng terminal trong `FE-006`, `FE-007` | 8 |
| 10 | Keyboard shortcuts | `BE-009` | `FE-014` | 6 |
| 11 | Notifications | `BE-011` | `FE-010`; mở rộng `FE-001` | 9 |
| 12 | Unified search | `BE-010` | `FE-009`; mở rộng `FE-001` | 4, 8 |
| 13 | Backup và reset | `BE-012` | `FE-015` | 6, 7, 10 |
| 14 | Home của Phase 1 | Dùng public query đã có | `FE-003` với các khối thuộc Phase 1 | 4, 8 |
| 15 | File Explorer | `BE-013` | `FE-016` | 9 |
| 16 | Source viewer và file watch | `BE-014` | `FE-017`; mở rộng `FE-005` | 15 |
| 17 | Markdown editor | `BE-015` | `FE-018` | 16 |
| 18 | Notes | `BE-016` | `FE-019`, Quick Note trên Home của `FE-020`; mở rộng các màn hình tổng hợp | 14 |
| 19 | Cửa sổ Quick Note | `BE-017`; mở rộng `BE-001`, `BE-009` | Hoàn thiện `FE-020`; mở rộng `FE-001`, `FE-014` | 18 |
| 20 | Calendar và Event | `BE-018` | `FE-021`, `FE-022`; mở rộng các màn hình tổng hợp | 18 |
| 21 | Reminder và notification settings | `BE-019`; mở rộng `BE-008`, `BE-011` | `FE-023`; mở rộng `FE-010`, `FE-021` | 11, 20 |
| 22 | Chuẩn bị phát hành | Đóng gói, updater, kiểm tra macOS | Hoàn thiện và xác minh bản phát hành | 21 |

Các quan hệ trong cột `Bắt đầu sau` là phụ thuộc tối thiểu. Mặc định triển khai theo thứ tự số giai đoạn; chỉ chạy song song khi các plan chi tiết chứng minh không có contract, file hoặc hành vi dùng chung chưa được chốt.

## Giai đoạn 0 — Nền tài liệu

Mục tiêu: cung cấp đủ dữ kiện thiết kế cho lát cắt sắp triển khai, không yêu cầu viết toàn bộ tài liệu trước một lần.

- Hoàn thiện wireframe áp dụng theo danh sách §19 của `03-FunctionalRequirements.md`.
- Viết tài liệu `FE-NNN` theo template `99-Template/02-Frontend.md` và `BE-NNN` theo `99-Template/03-Backend.md` cho lát cắt sắp bắt đầu.
- Khi một giao diện tổng hợp được mở rộng ở nhiều lát cắt, tài liệu của lát cắt hiện tại phải nêu rõ phần nào đã hoạt động và phần nào chưa xuất hiện.
- Một lát cắt chỉ được triển khai khi các tài liệu áp dụng có mục `Câu hỏi mở` là `Không có`.

## Giai đoạn 1 — Scaffold frontend — đã hoàn thành

Plan: `00-Docs/98-Plan/01-scaffold-frontend.md`.

Kết quả: SPA tối thiểu chạy bằng Vite với React, TypeScript, Tailwind CSS 4, memory router, hạ tầng shadcn/ui và Animate UI, cùng formatter, lint, type-check, test, build và CI frontend trên Windows.

Giai đoạn này không triển khai hành vi của bất kỳ mã `FE-NNN` nào.

## Giai đoạn 2 — Scaffold desktop/backend

Mục tiêu: tạo desktop runtime tối thiểu để mọi lát cắt sản phẩm sau đó tích hợp backend thật ngay từ đầu.

Phạm vi:

- Khởi tạo `src-tauri/` với Tauri 2, stable Rust Edition 2024, `rust-toolchain.toml` và composition root tối thiểu trong `src-tauri/src/app/`.
- Cấu hình `tauri.conf.json`, capability tối thiểu và CSP cần thiết cho frontend hiện có; chưa tạo capability nghiệp vụ hoặc migration khi chưa có consumer.
- Thêm Rustfmt, Clippy với warnings denied, Rust test và Tauri build Windows vào quality gates/CI.
- Thiết lập Tauri build Windows và checklist smoke thủ công tối thiểu cho hành vi desktop native.

Hoàn thành khi: `pnpm tauri dev` mở SPA hiện có trong cửa sổ desktop; frontend gates, Rust gates, smoke test thủ công Windows và Tauri build đều pass.

## Giai đoạn 3–14 — Phase 1: Project và Terminal

### Giai đoạn 3 — Lifecycle và application shell

Triển khai `BE-002` làm nền SQLite/migration, sau đó `BE-001` cho application lifecycle, single instance, tray và Quit. Tích hợp `FE-001` với shell, điều hướng, sidebar rỗng, top bar và hộp thoại Quit chạy thật.

Các vùng project, session, search và notification trong shell chỉ hiển thị trạng thái chưa có dữ liệu/điểm vào phù hợp ở giai đoạn này; chúng được mở rộng tại giai đoạn sở hữu capability tương ứng.

### Giai đoạn 4 — Projects và Welcome

Triển khai `BE-003`, sau đó `FE-004` và `FE-002`. Người dùng có thể thêm folder thật, xem/đổi tên/ghim/gỡ project, xử lý trạng thái `Unavailable` và chọn lại đường dẫn. Danh sách project thật được nối vào sidebar của `FE-001`; Welcome chuyển đúng giữa trạng thái chưa có và đã có project.

### Giai đoạn 5 — Git status và Project Overview

Triển khai `BE-004`, sau đó `FE-005` với branch và Git status read-only từ repository thật. Project Overview ở giai đoạn này chứa dữ liệu project/Git và điểm vào tạo session; các khối file, note và event chỉ được thêm khi capability tương ứng hoàn thành.

### Giai đoạn 6 — Settings nền tảng

Triển khai `BE-008`, sau đó `FE-011` và `FE-012`. General, About, theme, màu và cỡ chữ được lưu thật; trạng thái chiều rộng/thu gọn sidebar của `FE-001` cũng được nối vào settings persistence.

Cấu hình notification thuộc `FE-023` chưa nằm trong giai đoạn này vì chỉ kiểm thử được cùng reminder ở giai đoạn 21.

### Giai đoạn 7 — CLI profiles

Triển khai `BE-006`, sau đó `FE-013`. Profile dựng sẵn và tùy chỉnh được đọc/ghi thật, kiểm tra command thật và lưu secret trong OS credential store; không khởi chạy PTY cho đến giai đoạn 9.

### Giai đoạn 8 — Session, tab và pane

Triển khai `BE-005`, sau đó `FE-006` và `FE-007`. Người dùng tạo/đổi tên/xóa session runtime, quản lý tab và bố cục tối đa bốn pane. Pane terminal có thể được chọn nhưng chỉ trở thành terminal tương tác thật sau giai đoạn 9.

### Giai đoạn 9 — Terminal và PTY

Triển khai `BE-007`, sau đó `FE-008` và phần terminal còn lại của `FE-006`/`FE-007`. PTY thật phải stream output theo thứ tự, nhận input/resize và tiếp tục chạy khi chuyển session hoặc ẩn cửa sổ xuống tray.

Lát cắt này phải chạy bộ kiểm thử tương thích terminal trên Windows: Codex, Claude, alternate screen, IME tiếng Việt, Unicode, resize và bốn pane đồng thời.

### Giai đoạn 10 — Keyboard shortcuts

Triển khai `BE-009`, sau đó `FE-014`: đọc/ghi shortcut thật, phát hiện xung đột và khôi phục mặc định. Phím tắt toàn cục cho Quick Note chỉ được bổ sung ở giai đoạn 19.

### Giai đoạn 11 — Notifications

Triển khai `BE-011`, sau đó `FE-010` và badge/điểm vào notification trong `FE-001`. Terminal/AI CLI cần chú ý và tiến trình kết thúc/lỗi phải tạo notification thật, điều hướng về đúng project/session và hỗ trợ đọc/xóa.

Reminder và hành động hoãn/bỏ qua được bổ sung ở giai đoạn 21.

### Giai đoạn 12 — Unified search

Triển khai `BE-010`, sau đó `FE-009` và điểm vào search trong `FE-001`. Search/Command Palette dùng dữ liệu thật của project, session và command catalog; file, note và event được thêm tại các phase sau qua public query của capability sở hữu.

### Giai đoạn 13 — Backup và reset

Triển khai `BE-012`, sau đó `FE-015`. Export/import, vị trí dữ liệu và reset phải chạy trên dữ liệu thật; secret không được ghi dạng thuần văn bản vào backup.

Schema backup được mở rộng có chủ đích khi Notes và Calendar được triển khai, kèm test tương thích cho dữ liệu của phase mới.

### Giai đoạn 14 — Home của Phase 1

Triển khai `FE-003` bằng public query thật đã có, gồm project mở gần đây và session đang chạy. Không tạo backend hoặc endpoint tổng hợp chỉ để phục vụ bố cục nếu các public query hiện có đã đủ.

Các khối Quick Note/note/event chưa xuất hiện cho đến phase sở hữu tương ứng. Hoàn thành giai đoạn này đồng thời xác minh toàn bộ tiêu chí Phase 1 tại §20 trên Windows.

## Giai đoạn 15–17 — Phase 2: File

### Giai đoạn 15 — File Explorer

Triển khai `BE-013`, sau đó `FE-016`. Người dùng duyệt, tìm/lọc và refresh cây file thật trong project đã đăng ký; kiểm thử giới hạn đường dẫn và quy tắc symbolic link.

### Giai đoạn 16 — Source viewer và file watch

Triển khai `BE-014`, sau đó `FE-017`. Source/text thật được hiển thị read-only; file binary, file quá lớn và thay đổi từ bên ngoài có trạng thái rõ ràng. Bổ sung file mở gần đây vào `FE-005` và kết quả file vào `FE-009` qua public query.

### Giai đoạn 17 — Markdown editor

Triển khai `BE-015`, sau đó `FE-018`. Edit/Preview, lưu thủ công, trạng thái chưa lưu và xung đột thay đổi bên ngoài phải được kiểm thử bằng file thật.

Hoàn thành giai đoạn này đồng thời xác minh toàn bộ tiêu chí Phase 2 tại §20 trên Windows.

## Giai đoạn 18–19 — Phase 3: Note

### Giai đoạn 18 — Notes

Triển khai `BE-016`, sau đó `FE-019` và biến thể Quick Note nhúng trên Home thuộc `FE-020`. Notes phải dùng persistence thật cho CRUD, autosave, pin, liên kết project, Archive và Trash.

Trong cùng lát cắt, bổ sung note vào `FE-003`, `FE-005`, `FE-009` và schema backup của `BE-012`; mọi phần mở rộng dùng public interface của Notes.

### Giai đoạn 19 — Cửa sổ Quick Note

Triển khai `BE-017` cùng phần mở rộng cần thiết của `BE-001` và `BE-009`, sau đó hoàn thiện `FE-020`. Cửa sổ nổi phải mở từ Home, global shortcut và tray, lưu note thật rồi đóng.

Bổ sung các điểm vào tương ứng cho `FE-001` và `FE-014`. Hoàn thành giai đoạn này đồng thời xác minh toàn bộ tiêu chí Phase 3 tại §20 trên Windows.

## Giai đoạn 20–21 — Phase 4: Calendar

### Giai đoạn 20 — Calendar và Event

Triển khai `BE-018`, sau đó `FE-021` và `FE-022`. Calendar tháng, lịch trình ngày, Upcoming, Event CRUD, all-day, liên kết project và recurrence phải dùng dữ liệu thật.

Trong cùng lát cắt, bổ sung event vào `FE-003`, `FE-005`, `FE-009` và schema backup của `BE-012`.

### Giai đoạn 21 — Reminder và notification settings

Triển khai `BE-019` cùng phần mở rộng cần thiết của `BE-008` và `BE-011`, sau đó `FE-023` và phần reminder/Missed của `FE-010`, `FE-021`. Scheduler, snooze, dismiss, thông báo hệ điều hành theo trạng thái nền và luồng Missed sau khi mở lại ứng dụng phải được kiểm thử bằng thời gian kiểm soát được.

Hoàn thành giai đoạn này đồng thời xác minh toàn bộ tiêu chí Phase 4 tại §20 trên Windows. Sau giai đoạn này, mọi `FE-NNN` và `BE-NNN` trong phạm vi bản đầu tiên đã được tích hợp bằng implementation thật.

## Giai đoạn 22 — Chuẩn bị phát hành

- Kiểm tra và sửa lỗi trên macOS 13.3+ (PTY hệ thống, phím tắt, tray, cửa sổ nổi, IME); theo `AGENTS.md`, macOS chỉ làm ở bước này.
- Đóng gói installer Windows và app/DMG macOS; ký và cấu hình Tauri signed updater; tạo workflow phát hành GitHub Releases.
- Rà soát log không chứa dữ liệu nhạy cảm và backup không chứa secret thuần văn bản.
- Chạy lại toàn bộ quality gates và checklist smoke thủ công trên bản đóng gói phù hợp trước khi phát hành.

## Rủi ro cần theo dõi

- `FE-001`, `FE-003`, `FE-005`, `FE-009` và `FE-010` nhận dữ liệu từ nhiều capability: mỗi lát cắt chỉ sửa phần mở rộng do capability mới tạo ra và phải có regression test cho các phần đã hoàn thành.
- Terminal là phần rủi ro kỹ thuật cao nhất (WTerm + ConPTY + WebView2): scaffold desktop sớm và lát cắt PTY riêng giúp kiểm chứng trên runtime thật trước khi mở rộng sang File, Notes và Calendar.
- Thứ tự backend trước frontend có thể làm contract thiên về implementation: tài liệu FE, wireframe và tiêu chí hành vi quan sát được phải được chốt cùng tài liệu BE trước khi viết code backend.
- Backup, search và các màn hình tổng hợp mở rộng theo phase: chỉ dùng public interface của capability nguồn, không truy cập implementation nội bộ để rút ngắn lát cắt.
- Quick Note, tray, folder picker, global shortcut và notification hệ điều hành phụ thuộc desktop runtime; không giả lập sâu các hành vi này trong SPA.
