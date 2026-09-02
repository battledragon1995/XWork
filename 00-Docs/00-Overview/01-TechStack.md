# Tech Stack

Tài liệu này ghi lại các công nghệ XWork sử dụng, vai trò của chúng và những giới hạn cần tuân theo.

Các phiên bản dưới đây là phiên bản mục tiêu tại thời điểm scaffold source. Phiên bản thực tế phải được khóa trong các file manifest và lockfile tương ứng. Không đặt hướng dẫn cài đặt, cấu trúc thư mục hoặc mô tả kiến trúc trong file này.

## Tổng quan

| Nội dung | Giá trị |
|---|---|
| Loại project | Ứng dụng desktop local-first, một người dùng, không cần tài khoản hoặc dịch vụ cloud |
| Nền tảng chạy | Windows và macOS |
| Ngôn ngữ chính | Rust 1.98.0, Edition 2024; TypeScript 7.0.2 |
| Công cụ quản lý thư viện | Cargo 1.98.0; pnpm 11.25.0 trên Node.js 24 LTS |

## Công nghệ chính

| Nhóm | Công nghệ | Phiên bản | Vai trò | Ghi chú |
|---|---|---:|---|---|
| Nền tảng desktop | Tauri | 2.11.5 | Quản lý cửa sổ, vòng đời ứng dụng, system tray, IPC và đóng gói desktop | Chỉ cấp capability tối thiểu cho từng cửa sổ; không đưa API hệ thống tổng quát ra frontend |
| Ngôn ngữ backend | Rust | 1.98.0, Edition 2024 | Xử lý nghiệp vụ, tiến trình, hệ điều hành, persistence và desktop integration | Toolchain được khóa bằng `rust-toolchain.toml`; chỉ dùng stable |
| Runtime bất đồng bộ | Tokio | 1.53.1 | Điều phối PTY, tiến trình nền, channel và reminder scheduler | Không chạy tác vụ blocking trên async worker; chuyển tác vụ blocking sang thread phù hợp |
| Ngôn ngữ frontend | TypeScript | 7.0.2 | Type-check giao diện và hợp đồng IPC | TypeScript 7.0 chưa cung cấp compiler API; dùng Biome thay cho type-aware ESLint ở giai đoạn đầu |
| Giao diện | React | 19.2.8 | Xây dựng application shell và các màn hình chức năng | Chạy dạng client-only SPA, không dùng SSR hoặc React Server Components |
| Build frontend | Vite | 8.2.2 | Dev server và bundle frontend/WASM | TypeScript chỉ type-check; Vite chịu trách nhiệm transpile và bundle |
| CSS | Tailwind CSS | 4.3.3 | Utility CSS và design token | Dùng cấu hình CSS-first; không thêm CSS preprocessor |
| Component UI | shadcn/ui | Source snapshot | Component nền tảng có thể chỉnh sửa tại repo | Component được thêm dưới dạng source; không tự động đồng bộ thay đổi upstream |
| Component chuyển động | Animate UI | Source snapshot | Component tương tác và animation có thể chỉnh sửa tại repo | Chỉ thêm component thực sự được dùng; thay đổi riêng giữ cục bộ |
| Animation và icon | Motion; Lucide React | 13.1.1; 1.39.0 | Animation và icon giao diện | Không dùng animation làm ảnh hưởng thao tác bàn phím hoặc `prefers-reduced-motion` |
| Điều hướng | React Router | 8.3.1 | Điều hướng giữa các khu vực trong một cửa sổ | Dùng memory router; không phụ thuộc browser history hoặc server route |
| State frontend | Zustand | 5.0.15 | State giao diện tạm thời và lựa chọn hiện tại | Rust hoặc SQLite là nguồn dữ liệu chính; không sao chép business state lâu dài vào store frontend |
| Form frontend | React Hook Form; Zod | 7.87.0; 4.5.4 | Quản lý form và phản hồi validation tức thời | Backend phải kiểm tra lại mọi dữ liệu nhận qua IPC |
| Bố cục pane | react-resizable-panels; dnd-kit | 4.12.3; 6.3.1 | Resize pane và kéo thả tab | Một tab có tối đa bốn pane; luôn có thao tác tương đương bằng menu hoặc bàn phím |
| Terminal frontend | `@wterm/react`; `@wterm/dom`; `@wterm/ghostty` | 0.3.4 | Render terminal bằng DOM và dùng Ghostty core qua WASM | Khóa chính xác cùng một phiên bản; không dùng core Zig mặc định; không dùng `WebSocketTransport` |
| PTY | portable-pty | 0.9.0 | Tạo, resize và quản lý PTY đa nền tảng | PTY chỉ tồn tại trong Rust; Windows dùng ConPTY và macOS dùng PTY hệ thống |
| IPC | Tauri commands và Channel | 2.11.5 | Gọi thao tác có phạm vi hẹp và stream terminal output có thứ tự | Không dùng event thường cho terminal output có thông lượng cao |
| Persistence | SQLite; rusqlite `bundled` | 3.x; 0.40.2 | Lưu project metadata, profile, settings, note, event và notification | Chỉ backend truy cập database; không dùng Tauri SQL hoặc Store plugin từ frontend |
| Serialization | Serde; ts-rs | 1.0.229; 12.0.1 | Serialize IPC và sinh TypeScript DTO từ Rust | Generated binding không được sửa thủ công |
| Git read-only | gix | 0.87.1 | Đọc repository, branch và trạng thái file | Không cung cấp commit, checkout, pull, push hoặc thao tác làm thay đổi repository |
| Duyệt và theo dõi file | ignore; notify | 0.4.33; 8.2.0 | Duyệt cây file theo ignore rule và phát hiện thay đổi ngoài ứng dụng | Không theo symbolic link mặc định; mọi đường dẫn phải nằm trong project đã đăng ký |
| Editor và Markdown | CodeMirror; react-markdown; remark-gfm | 6.x; 10.1.0; 4.0.1 | View source, sửa Markdown và render preview | Source chỉ đọc; không render raw HTML trong Markdown |
| Calendar | chrono; chrono-tz; rrule | 0.4.45; 0.10.4; 0.14.0 | Xử lý thời gian, timezone và recurrence | Business rule và reminder scheduling nằm trong Rust |
| Secret cục bộ | keyring | 4.2.0 | Lưu giá trị environment variable nhạy cảm của CLI profile | Backup chỉ chứa metadata tham chiếu, không chứa secret thuần văn bản |
| Logging | tracing | 0.1.44 | Structured log cục bộ cho backend | Không ghi terminal output, nội dung note, secret hoặc nội dung file project vào log |
| Desktop integration | Tauri core và official plugins | 2.x | Dialog, global shortcut, notification, opener, single instance và updater | Gọi từ Rust; không dùng shell hoặc filesystem plugin tổng quát từ frontend |

Dependency chỉ được thêm khi phase chứa chức năng tương ứng bắt đầu. Việc một công nghệ xuất hiện trong bảng không cho phép scaffold trước chức năng của phase đó.

## Phát triển và kiểm tra chất lượng

| Mục đích | Công cụ | Phiên bản | Cấu hình chính |
|---|---|---:|---|
| Chạy môi trường phát triển | Node.js; pnpm; Tauri CLI; Vite | 24 LTS; 11.25.0; 2.11.x; 8.2.2 | `pnpm tauri dev` |
| Định dạng frontend | Biome | 2.5.11 | `biome.json` |
| Định dạng Rust | Rustfmt | 1.98.0 | `cargo fmt --check` |
| Kiểm tra frontend | TypeScript; Biome | 7.0.2; 2.5.11 | `tsc --noEmit` và `biome check` |
| Kiểm tra Rust | Clippy | 1.98.0 | `cargo clippy --all-targets --all-features -- -D warnings` |
| Unit/component test frontend | Vitest; React Testing Library | 4.1.11; 16.3.3 | Test colocated với source |
| Unit/integration test backend | Rust test harness | 1.98.0 | Unit test trong module và integration test trong crate desktop |
| Kiểm tra desktop | Tauri build; smoke test thủ công có mục tiêu | 2.11.x | Không dùng desktop end-to-end tự động; chỉ kiểm tra thủ công hành vi bắt buộc phải quan sát qua cửa sổ hệ điều hành trên Windows |
| Đóng gói | Tauri CLI và Bundler | 2.11.x | Windows installer trong development/release; macOS app và DMG khi chuẩn bị phát hành |

## Hạ tầng và triển khai

| Thành phần | Công nghệ / dịch vụ | Mục đích |
|---|---|---|
| Môi trường chạy | Máy Windows hoặc macOS của người dùng | Chạy toàn bộ ứng dụng và tiến trình CLI cục bộ |
| Lưu trữ dữ liệu | SQLite trong app data; OS credential store; folder project gốc | Lưu dữ liệu XWork, secret và source đúng phạm vi |
| Theo dõi lỗi / hoạt động | Structured log cục bộ | Chẩn đoán lỗi; không có telemetry hoặc gửi dữ liệu ra ngoài ở bản đầu |
| CI | GitHub Actions | Chạy kiểm tra trên Windows; macOS chỉ chạy trong workflow chuẩn bị phát hành |
| Phát hành | GitHub Releases và Tauri signed updater | Phân phối installer và bản cập nhật khi project được phát hành public source |

## Ràng buộc kỹ thuật

- Hệ điều hành / môi trường hỗ trợ: Windows 10 version 1809 trở lên với WebView2, ưu tiên Windows 11; macOS 13.3 trở lên khi chuẩn bị phát hành.
- Phiên bản tối thiểu: Windows phải có ConPTY; frontend yêu cầu WebView tương thích các CSS feature của Tailwind CSS 4.
- Giới hạn tài nguyên hoặc hiệu năng: một tab có tối đa bốn pane; bốn terminal đồng thời phải giữ input, resize và output ổn định trước khi Phase 1 được coi là hoàn thành.
- Yêu cầu tương thích terminal: phải kiểm thử Codex, Claude, shell mặc định, alternate screen, mouse mode, synchronized output, Unicode, emoji, Vietnamese IME, clipboard và resize trên Windows WebView2.
- Yêu cầu riêng của WTerm: browser find chỉ nhìn thấy phần scrollback đang được mount; XWork phải cung cấp tìm kiếm toàn bộ terminal output theo phạm vi yêu cầu. Link không phải OSC 8 cần được kiểm tra và bổ sung nhận diện nếu cần.
- Yêu cầu WASM: CSP của Tauri phải cho phép `'wasm-unsafe-eval'`; WASM asset phải được kiểm tra trong cả dev build và production build.
- Yêu cầu bảo mật: frontend không được truy cập trực tiếp shell, filesystem, database hoặc credential store. Command, argument và environment variable của CLI profile phải được truyền dưới dạng dữ liệu tách biệt, không ghép thành shell string.
- Yêu cầu dữ liệu: source project không được sao chép vào app data; session, terminal buffer và tiến trình không được khôi phục sau khi Quit.

## Quản lý phiên bản

- Nguồn xác định phiên bản đang dùng: `package.json`, `pnpm-lock.yaml`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` và `tauri.conf.json`.
- Cách khóa phiên bản thư viện: commit `pnpm-lock.yaml` và `Cargo.lock`; khóa exact version cho toàn bộ package WTerm và các dependency frontend trực tiếp; giữ các package Tauri cùng dòng tương thích.
- Node.js và pnpm được khóa bằng `engines` và trường `packageManager`; Rust được khóa bằng `rust-toolchain.toml`.
- Component shadcn/ui và Animate UI là source của repo. Chỉ cập nhật component cụ thể, review diff và giữ thay đổi riêng cục bộ.
- Nâng WTerm chỉ sau khi chạy lại bộ kiểm thử terminal trên Windows, đặc biệt với IME, wide character, scrollback, màu, alternate screen và bốn pane đồng thời.
- Mỗi lần cập nhật dependency phải ở một thay đổi riêng, đọc breaking change và chạy formatter, lint, type-check, test cùng desktop build liên quan.
- Công nghệ không còn sử dụng phải được xóa khỏi tài liệu này cùng lúc với code và cấu hình liên quan.
