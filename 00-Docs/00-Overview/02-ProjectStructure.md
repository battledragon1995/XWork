# Project Structure

Tài liệu này mô tả cách XWork được chia thành các khu vực, trách nhiệm của từng khu vực và quy tắc đặt file mới.

Không đặt danh sách công nghệ, hướng dẫn cài đặt hoặc mô tả chi tiết luồng xử lý trong file này.

## Nguyên tắc tổ chức

- Frontend chia theo feature; backend desktop chia theo capability nghiệp vụ và tích hợp hệ thống.
- OS access, persistence, tiến trình terminal và business rule chỉ nằm trong backend desktop. Frontend giao tiếp qua command và stream có phạm vi hẹp.
- Thành phần dùng chung chỉ được tạo khi có ít nhất hai nơi sử dụng với cùng ngữ nghĩa, không phải chỉ vì code trông giống nhau.
- File thuộc feature nào phải nằm gần feature đó, gồm component, state cục bộ, adapter và test.
- Mỗi khu vực phải có một trách nhiệm rõ ràng và không chứa code không liên quan.
- Không tạo thư mục chỉ để chứa một file. Tách thành các file như `commands.rs`, `service.rs` hoặc `repository.rs` chỉ khi module đã có nhiều trách nhiệm thực tế.
- Không tạo package hoặc crate nội bộ mới cho đến khi một ranh giới độc lập đã xuất hiện và việc tách làm giảm phụ thuộc thật sự.

## Cây thư mục

```text
XWork/
├── 00-Docs/                         # Tài liệu sản phẩm, thiết kế và kế hoạch
│   ├── 00-Overview/
│   ├── 01-Wireframe/
│   ├── 02-Frontend/
│   ├── 03-Backend/
│   ├── 98-Plan/
│   └── 99-Template/
├── src/                             # Frontend desktop
│   ├── app/                         # Composition root, router, provider và application shell
│   ├── features/
│   │   ├── home/
│   │   ├── projects/
│   │   ├── sessions/
│   │   ├── terminal/
│   │   ├── files/
│   │   ├── notes/
│   │   ├── calendar/
│   │   ├── search/
│   │   ├── notifications/
│   │   └── settings/
│   ├── components/
│   │   ├── ui/                      # Component nền tảng được sao chép vào repo
│   │   └── animate-ui/              # Component chuyển động được sao chép vào repo
│   ├── lib/
│   │   ├── ipc/                     # Wrapper command, channel và chuyển đổi lỗi
│   │   └── utils/                   # Helper frontend dùng chung đã được chứng minh cần thiết
│   ├── bindings/                    # TypeScript DTO sinh từ kiểu public của backend
│   ├── assets/                      # Font, icon và tài nguyên tĩnh của ứng dụng
│   ├── main.tsx                     # Frontend entry point
│   └── vite-env.d.ts
├── src-tauri/                       # Backend desktop và cấu hình đóng gói
│   ├── capabilities/                # Quyền tối thiểu theo window/webview
│   ├── migrations/                  # SQLite migration tuần tự
│   ├── src/
│   │   ├── app/                     # Khởi tạo state, command, window, tray và lifecycle
│   │   ├── projects/                # Project metadata và Git status read-only
│   │   ├── sessions/                # Session, tab và pane runtime
│   │   ├── terminal/                # CLI profile, PTY và vòng đời tiến trình
│   │   ├── files/                   # Duyệt, đọc, ghi Markdown và file watcher
│   │   ├── notes/                   # Note và vòng đời archive/trash
│   │   ├── calendar/                # Event, recurrence và reminder
│   │   ├── search/                  # Tìm kiếm hợp nhất và command catalog
│   │   ├── notifications/           # Notification trong app và hệ điều hành
│   │   ├── settings/                # Theme, shortcut, profile và data settings
│   │   ├── storage/                 # Database connection, transaction và migration runner
│   │   ├── platform/                # Adapter hệ điều hành không thuộc riêng một capability
│   │   ├── shared/                  # Kiểu và lỗi backend thực sự dùng chung
│   │   ├── lib.rs                   # Desktop composition entry
│   │   └── main.rs                  # Binary entry point mỏng
│   ├── tests/                       # Integration test qua public backend boundary
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── tests/
│   └── e2e/                         # Desktop end-to-end test
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── biome.json
├── rust-toolchain.toml
└── README.md
```

Chỉ tạo thư mục của feature khi bắt đầu triển khai feature đó. Cây trên là quy tắc đích để đặt code, không yêu cầu scaffold trước toàn bộ thư mục.

## Trách nhiệm

| Đường dẫn | Trách nhiệm | Không chứa |
|---|---|---|
| `00-Docs/` | Yêu cầu, wireframe, feature list, kế hoạch và template | Source code hoặc file build sinh tự động |
| `src/app/` | Ghép application shell, route, provider và error boundary cấp ứng dụng | Business rule, gọi hệ điều hành hoặc implementation riêng của feature |
| `src/features/<feature>/` | UI, hook và state tạm thời chỉ thuộc một feature | Component dùng chung không phụ thuộc feature hoặc truy cập hệ điều hành trực tiếp |
| `src/features/sessions/` | Hiển thị tab, pane layout và thao tác session | PTY handle, child process hoặc terminal parser |
| `src/features/terminal/` | Bao terminal renderer, chuyển input/resize sang IPC và nhận output stream | Khởi chạy process, giữ secret hoặc tự mở local WebSocket server |
| `src/components/ui/` | Component nền tảng và thay đổi cục bộ của chúng | Component gắn với dữ liệu hoặc workflow của một feature |
| `src/components/animate-ui/` | Component chuyển động dùng chung và thay đổi cục bộ | Business state hoặc animation chỉ dùng ở một feature |
| `src/lib/ipc/` | Điểm gọi command/channel dùng chung, mapping DTO và lỗi IPC | Business rule hoặc state giao diện |
| `src/lib/utils/` | Helper frontend nhỏ, thuần và có nhiều nơi dùng | Component, store tổng quát hoặc helper chỉ có một consumer |
| `src/bindings/` | Kiểu TypeScript được sinh từ DTO public của backend | Code viết tay hoặc type chỉ dùng nội bộ frontend |
| `src-tauri/src/app/` | Composition root, managed state, lifecycle, tray, window và đăng ký command | Nghiệp vụ chi tiết của feature hoặc câu lệnh SQL |
| `src-tauri/src/<capability>/` | Model, command và xử lý nghiệp vụ thuộc capability đó | UI, logic của capability không liên quan hoặc API hệ thống tổng quát |
| `src-tauri/src/storage/` | Mở database, transaction và chạy migration | Business query riêng của feature hoặc dữ liệu runtime terminal |
| `src-tauri/src/platform/` | Adapter OS dùng bởi nhiều capability, như credential, opener và notification | Business rule hoặc Tauri command public |
| `src-tauri/src/shared/` | ID, error và primitive có ít nhất hai capability dùng cùng ngữ nghĩa | Helper tùy tiện hoặc model riêng của một capability |
| `src-tauri/migrations/` | Thay đổi schema bất biến và chạy tuần tự | Dữ liệu mẫu hoặc migration được sửa sau khi đã phát hành |
| `src-tauri/capabilities/` | Permission tối thiểu gắn với từng window/webview | Secret, business configuration hoặc quyền wildcard không cần thiết |
| `src-tauri/tests/` | Integration test của database, capability và public backend boundary | End-to-end UI test |
| `tests/e2e/` | Luồng người dùng qua desktop runtime | Unit test hoặc test chi tiết implementation nội bộ |

## Quy tắc đặt file mới

- File chỉ thuộc một feature frontend được đặt tại `src/features/<feature>/`; test và fixture nhỏ đặt cùng feature.
- File chỉ thuộc một capability backend được đặt tại `src-tauri/src/<capability>/`; giữ trong `mod.rs` cho đến khi có lý do thực tế để tách.
- Component frontend dùng chung được đặt tại `src/components/` chỉ khi có ít nhất hai feature sử dụng với cùng hành vi.
- Helper thuần dùng chung được đặt tại `src/lib/utils/`; helper riêng của feature giữ trong feature.
- Tất cả lời gọi backend từ frontend đi qua `src/lib/ipc/`; không gọi API hệ thống trực tiếp trong component.
- DTO public được định nghĩa ở backend gần capability sở hữu nó và sinh binding vào `src/bindings/`.
- Unit/component test frontend dùng hậu tố `.test.ts` hoặc `.test.tsx` và đặt cạnh source.
- Unit test Rust đặt trong cùng module với `#[cfg(test)]`; integration test đặt trong `src-tauri/tests/`.
- Desktop end-to-end test đặt trong `tests/e2e/`.
- Cấu hình frontend cấp project đặt ở root; cấu hình desktop, capability và bundle đặt trong `src-tauri/`.
- Tài nguyên tĩnh dùng toàn ứng dụng đặt tại `src/assets/`; tài nguyên chỉ một feature dùng đặt trong feature đó.
- Migration đặt tại `src-tauri/migrations/`, chỉ được thêm file mới và không sửa migration đã phát hành.
- Không sửa file trong `node_modules/` hoặc Cargo registry. Nếu bắt buộc vá dependency, dùng patch được khóa, ghi rõ lý do và xóa patch khi upstream phát hành bản sửa.

## Quy tắc phụ thuộc

- `src/app/` được phép sử dụng public entry của feature, component dùng chung, IPC wrapper và generated binding.
- `src/features/<feature>/` được phép sử dụng `src/components/`, `src/lib/`, `src/bindings/` và code trong chính feature đó.
- Một frontend feature không import implementation của feature khác. Màn hình tổng hợp lấy dữ liệu qua backend query hoặc được ghép tại `src/app/`.
- `src/components/` và `src/lib/` không được phụ thuộc vào `src/features/` hoặc `src/app/`.
- Backend `app` được phép khởi tạo và ghép các capability, storage, platform cùng shared state.
- Backend capability được phép sử dụng `storage`, `platform` và `shared` khi cần; không truy cập implementation nội bộ của capability khác.
- Capability tổng hợp như `search` hoặc `notifications` chỉ sử dụng public query/interface của capability nguồn, không truy cập repository hoặc state nội bộ của chúng.
- `storage` và `platform` không phụ thuộc vào capability nghiệp vụ.
- Tauri command phải mỏng: parse/validate DTO, gọi xử lý capability và chuyển kết quả thành DTO; không chứa business rule hoặc SQL.
- Frontend không được truy cập trực tiếp filesystem, database, shell, child process hoặc credential store.
- Nếu xuất hiện phụ thuộc vòng, di chuyển contract tối thiểu đến khu vực sở hữu hợp lý; không chuyển toàn bộ module vào `shared` để che vòng phụ thuộc.

## Quy tắc đặt tên

| Đối tượng | Quy tắc | Ví dụ |
|---|---|---|
| Thư mục frontend | `kebab-case`, tên theo feature hoặc trách nhiệm | `cli-profiles/`, `command-palette/` |
| File frontend | `kebab-case`; dùng `.tsx` khi chứa JSX | `project-card.tsx`, `terminal-store.ts` |
| React component | Identifier `PascalCase` | `ProjectCard`, `TerminalPane` |
| Hook frontend | Bắt đầu bằng `use`, file `kebab-case` | `use-terminal-channel.ts` |
| Test frontend | Cùng tên source với hậu tố `.test` | `project-card.test.tsx` |
| Thư mục và file Rust | `snake_case` | `cli_profiles/`, `terminal_manager.rs` |
| Kiểu Rust | `PascalCase`; function và biến `snake_case` | `TerminalSession`, `spawn_terminal` |
| Tauri command | Động từ và đối tượng bằng `snake_case` | `add_project`, `resize_terminal` |
| Integration test Rust | Tên capability hoặc hành vi bằng `snake_case` | `terminal_commands.rs` |
| Migration | Bốn chữ số tăng dần và mô tả `snake_case` | `0001_create_projects.sql` |
| File cấu hình | Theo quy ước chính thức của công cụ | `vite.config.ts`, `tauri.conf.json` |

## Nội dung được sinh tự động

| Đường dẫn | Được tạo bởi | Có được sửa thủ công? |
|---|---|---|
| `src/bindings/` | Binding generator chạy từ test hoặc task backend | Không |
| `src-tauri/gen/schemas/` | Desktop build tooling | Không |
| `src/components/ui/` | Component CLI khi thêm component mới | Có; đây là source thuộc repo sau khi được thêm |
| `src/components/animate-ui/` | Component CLI khi thêm component mới | Có; đây là source thuộc repo sau khi được thêm |
