# Roadmap triển khai

Tài liệu này mô tả trình tự triển khai toàn repo theo từng giai đoạn: mục tiêu, phạm vi, điều kiện bắt đầu và điều kiện hoàn thành của mỗi giai đoạn.

Không đặt task chi tiết hoặc ước lượng thời gian ở đây. Mỗi giai đoạn có plan chi tiết riêng tại `00-Docs/98-Plan/NN-<ten-kebab>.md`, viết khi giai đoạn đó chuẩn bị bắt đầu. Mã `FE-NNN`/`BE-NNN` tham chiếu danh mục trong `00-Docs/02-Frontend/00-Overview.md` và `00-Docs/03-Backend/00-Overview.md`.

## Hướng tiếp cận

- Frontend được phát triển trước và hoàn thiện toàn bộ giao diện qua bốn phase, chạy dưới dạng SPA thuần bằng Vite, chưa cần Tauri.
- Trong giai đoạn frontend, mọi lời gọi backend đi qua mock IPC (lớp giả lập trả dữ liệu mẫu) đặt sau `src/lib/ipc/`; khi backend sẵn sàng, chỉ thay implementation phía sau wrapper, không sửa component.
- Contract được chốt trước khi code: tài liệu `BE-NNN` (command, DTO, event) của một tính năng phải được viết cùng lúc với tài liệu `FE-NNN`, ngay cả khi code Rust triển khai sau. Mock phải bám đúng contract đó.
- Scaffold là giai đoạn riêng, có điều kiện hoàn thành riêng, không gộp vào giai đoạn phát triển tính năng. Scaffold frontend và scaffold backend tách đôi vì backend bắt đầu muộn hơn nhiều.
- Backend triển khai và tích hợp theo đúng thứ tự phase 1 → 4 của `03-FunctionalRequirements.md`; tích hợp đến đâu xóa mock đến đó.

## Tổng quan trình tự

| Giai đoạn | Tên | Phạm vi chính | Bắt đầu sau |
|---|---|---|---|
| 0 | Nền tài liệu | Wireframe theo §19; tài liệu `FE-NNN`/`BE-NNN` viết dần theo giai đoạn | — |
| 1 | Scaffold frontend | Khung SPA chạy được, chưa có tính năng | 0 (một phần) |
| 2 | Frontend Phase 1 | `FE-001` → `FE-015` trên mock IPC | 1 |
| 3 | Frontend Phase 2 | `FE-016` → `FE-018` trên mock IPC | 2 |
| 4 | Frontend Phase 3 | `FE-019` → `FE-020` trên mock IPC | 3 |
| 5 | Frontend Phase 4 | `FE-021` → `FE-023` trên mock IPC | 4 |
| 6 | Scaffold backend | Tauri 2 bọc SPA hiện có, chưa có nghiệp vụ | 5 |
| 7 | Backend + tích hợp Phase 1 | `BE-001` → `BE-012`, thay mock tương ứng | 6 |
| 8 | Backend + tích hợp Phase 2 | `BE-013` → `BE-015`, thay mock tương ứng | 7 |
| 9 | Backend + tích hợp Phase 3 | `BE-016` → `BE-017`, thay mock tương ứng | 8 |
| 10 | Backend + tích hợp Phase 4 | `BE-018` → `BE-019`, thay mock tương ứng | 9 |
| 11 | Chuẩn bị phát hành | macOS, đóng gói, updater | 10 |

Một giai đoạn chỉ bắt đầu khi giai đoạn trước nó đạt điều kiện hoàn thành. Tài liệu chi tiết của tính năng thuộc giai đoạn nào được viết ngay trước giai đoạn đó (giai đoạn 0 chạy song song, không phải viết hết một lần).

## Giai đoạn 0 — Nền tài liệu

Mục tiêu: đủ dữ kiện thiết kế trước khi code, viết dần theo nhu cầu của giai đoạn kế tiếp.

- Hoàn thiện wireframe theo danh sách §19 của `03-FunctionalRequirements.md`, tối thiểu phần Phase 1 trước giai đoạn 2.
- Viết tài liệu `FE-NNN` theo template `99-Template/02-Frontend.md` và `BE-NNN` theo `99-Template/03-Backend.md` cho các tính năng của giai đoạn sắp bắt đầu.
- Một tính năng chỉ được triển khai khi tài liệu của nó có mục `Câu hỏi mở` là `Không có`.

## Giai đoạn 1 — Scaffold frontend

Mục tiêu: SPA trống chạy được với đầy đủ công cụ kiểm tra chất lượng, đúng cấu trúc `02-ProjectStructure.md`.

Phạm vi:

- Khởi tạo Vite + React + TypeScript + Tailwind CSS 4 + React Router (memory router) + Zustand theo phiên bản trong `01-TechStack.md`.
- Cấu trúc thư mục `src/app/`, `src/features/`, `src/components/`, `src/lib/`, `src/assets/`; thiết lập hạ tầng shadcn/ui và Animate UI (chỉ thêm component khi bắt đầu dùng).
- Biome, `tsc --noEmit`, Vitest + React Testing Library; CI GitHub Actions chạy các kiểm tra frontend trên Windows.
- Không cài dependency của tính năng chưa làm; không tạo trước thư mục feature.

Hoàn thành khi: `pnpm dev` mở application shell trống có router hoạt động; formatter, lint, type-check, test đều pass trên máy local và CI.

## Giai đoạn 2 — Frontend Phase 1 (`FE-001` → `FE-015`)

Mục tiêu: toàn bộ giao diện Project và Terminal chạy trên mock IPC.

- Thứ tự gợi ý: `FE-001` shell → `FE-002` Welcome → `FE-004`/`FE-005` Projects → `FE-006` Session → `FE-007` Tab/Pane → `FE-008` Terminal → `FE-003` Home → `FE-009` Palette → `FE-010` Notification → `FE-011`–`FE-015` Settings.
- Quy tắc mock: wrapper trong `src/lib/ipc/` giữ đúng chữ ký command theo tài liệu `BE-NNN`; dữ liệu mẫu và giả lập (folder picker, output stream terminal) đặt trong `src/lib/ipc/mock/`. Kiểu DTO tạm viết tay trong `src/lib/ipc/` theo đúng tài liệu; khi có binding sinh từ Rust sẽ đổi import sang `src/bindings/` và xóa kiểu tạm.
- `FE-008` dùng WTerm render một output feed giả để kiểm tra pipeline hiển thị; hành vi PTY thật chỉ xác nhận được ở giai đoạn 7.

Hoàn thành khi: mọi màn hình khớp wireframe với đủ trạng thái rỗng/đang tải/lỗi; test component pass; các kiểm tra chất lượng pass.

## Giai đoạn 3 — Frontend Phase 2 (`FE-016` → `FE-018`)

File Explorer, Source viewer và Markdown editor trên mock IPC, gồm cả các trạng thái file binary, file quá lớn, chưa lưu và thay đổi từ bên ngoài (mock phát tình huống xung đột để dựng đủ UI).

## Giai đoạn 4 — Frontend Phase 3 (`FE-019` → `FE-020`)

Trang Notes đầy đủ (danh sách, editor autosave, Archive, Trash) và form Quick Note. Cửa sổ Quick Note nổi và phím tắt toàn cục cần Tauri nên chỉ dựng component form; phần cửa sổ hoàn thiện ở giai đoạn 9. Bổ sung khối Note vào Home và Project Overview.

## Giai đoạn 5 — Frontend Phase 4 (`FE-021` → `FE-023`)

Calendar, form Event với quy tắc lặp và reminder, Settings Notifications; mở rộng Notification center với hành động reminder và bổ sung khối Event vào Home, Project Overview, Palette.

Hoàn thành giai đoạn 2–5 đồng nghĩa toàn bộ UI của bốn phase chạy được trên mock, đủ trạng thái, đủ test.

## Giai đoạn 6 — Scaffold backend

Mục tiêu: Tauri 2 bọc đúng SPA hiện có, chưa có nghiệp vụ.

Phạm vi:

- Khởi tạo `src-tauri/` với Tauri 2, `rust-toolchain.toml`, cấu trúc module theo `02-ProjectStructure.md` (chỉ `app/`, chưa tạo capability).
- `tauri.conf.json`, capabilities tối thiểu, CSP cho phép `'wasm-unsafe-eval'` và xác nhận WASM của WTerm chạy trong cả dev build lẫn production build.
- Rustfmt, Clippy (`-D warnings`), Rust test; CI mở rộng thêm kiểm tra Rust và Tauri build Windows.

Hoàn thành khi: `pnpm tauri dev` mở cửa sổ desktop chạy SPA (vẫn trên mock); mọi kiểm tra Rust và Tauri build Windows pass trên CI.

## Giai đoạn 7 — Backend + tích hợp Phase 1 (`BE-001` → `BE-012`)

Mục tiêu: nghiệp vụ Project và Terminal chạy thật, xóa mock tương ứng, đạt tiêu chí Phase 1 của §20.

- Thứ tự gợi ý theo phụ thuộc: `BE-002` storage → `BE-001` lifecycle/tray → `BE-003` projects → `BE-004` git status → `BE-006` CLI profiles → `BE-005` sessions → `BE-007` terminal/PTY → `BE-008` settings → `BE-009` shortcuts → `BE-011` notifications → `BE-010` search → `BE-012` backup.
- Mỗi capability hoàn thành thì sinh binding ts-rs vào `src/bindings/`, chuyển wrapper trong `src/lib/ipc/` sang gọi command thật và xóa mock cùng kiểu tạm của phần đó.
- Thiết lập e2e WebdriverIO trên Windows cho các luồng chính; chạy bộ kiểm thử tương thích terminal theo `01-TechStack.md` (Codex, Claude, alternate screen, IME tiếng Việt, Unicode, resize, bốn pane đồng thời).

Hoàn thành khi: toàn bộ tiêu chí Phase 1 trong §20 đạt trên Windows; không còn mock cho các tính năng Phase 1.

## Giai đoạn 8 — Backend + tích hợp Phase 2 (`BE-013` → `BE-015`)

File tree, đọc/watch file và lưu Markdown chạy thật; xác nhận xung đột thay đổi từ bên ngoài bằng file thật; đạt tiêu chí Phase 2 của §20.

## Giai đoạn 9 — Backend + tích hợp Phase 3 (`BE-016` → `BE-017`)

Notes persistence và cửa sổ Quick Note nổi với phím tắt toàn cục, tray; đạt tiêu chí Phase 3 của §20.

## Giai đoạn 10 — Backend + tích hợp Phase 4 (`BE-018` → `BE-019`)

Calendar, recurrence, reminder scheduler và luồng `Missed`; thông báo hệ điều hành theo settings; đạt tiêu chí Phase 4 của §20. Sau giai đoạn này không còn mock trong repo.

## Giai đoạn 11 — Chuẩn bị phát hành

- Kiểm tra và sửa lỗi trên macOS 13.3+ (PTY hệ thống, phím tắt, tray, cửa sổ nổi, IME) — theo `AGENTS.md`, macOS chỉ làm ở bước này.
- Đóng gói installer Windows và app/DMG macOS; ký và cấu hình Tauri signed updater; workflow phát hành GitHub Releases.
- Rà soát log không chứa dữ liệu nhạy cảm, backup không chứa secret thuần văn bản.

## Rủi ro cần theo dõi

- UI bốn phase xây xong trước khi có backend nên contract dễ lệch: giảm rủi ro bằng quy tắc viết tài liệu `BE-NNN` trước khi code FE và mock bám đúng tài liệu; mọi thay đổi contract phải sửa tài liệu trước, sửa mock sau.
- Terminal là phần rủi ro kỹ thuật cao nhất (WTerm + ConPTY + WebView2) nhưng chỉ kiểm chứng thật được ở giai đoạn 7: nếu muốn giảm rủi ro sớm, có thể làm một spike nhỏ tách riêng (PTY echo qua channel vào WTerm) ngay sau giai đoạn 6, trước khi làm đủ `BE-007`.
- Quick Note nổi, tray và folder picker phụ thuộc Tauri: các phần UI này ở giai đoạn 2–4 chỉ dừng ở component, tránh giả lập quá sâu hành vi cửa sổ.
