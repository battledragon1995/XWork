# FE-008 — Bảy lỗi ghi nhận qua kiểm thử Terminal và smoke app Windows

| Thuộc tính | Giá trị |
|---|---|
| Trạng thái | F-01 đến F-06 có regression xanh; F-07 đạt targeted native trên dev thật và executable release cuối — ma trận và giới hạn ở mục xác minh lại |
| Ngày kiểm thử | 2026-09-05: probe khoảng 17:53–17:58; targeted native cuối lúc 19:38, UTC+07:00 |
| Phiên bản mã | Git HEAD `ca9e8a7`; working tree sạch trước lượt kiểm thử |
| Phạm vi | FE-008 Terminal, clipboard/link BE-007, tích hợp lifecycle của pane |
| Môi trường | Windows; Vitest 4.1.11 + jsdom; WTerm/Ghostty 0.3.4; ConPTY thật trong Rust integration test; app Tauri release cũ và bản QA riêng |
| Đặc tả | [FE-008](../02-Frontend/FE-008-terminal.md), [BE-007](../03-Backend/BE-007-terminal-and-pty.md) |
| Người nhận xử lý | Frontend Terminal; phối hợp kiểm tra ranh giới IPC clipboard |

## Xác minh lại dev/release và sửa bổ sung — 2026-09-05, 20:55–21:31 UTC+07:00

Các kết luận QA lúc 19:38 bên dưới là lịch sử, không đại diện cho executable release cuối. Lượt tiếp tục đã xác minh thêm các nguyên nhân sau:

- **Windows shell context:** Gán `COMSPEC=pwsh.exe` khiến hook `.cmd` của Claude lặp qua PowerShell. Giữ `COMSPEC` kế thừa; Terminal vẫn spawn selected shell trực tiếp. Hai unit test cấu trúc lệnh xác nhận giá trị kế thừa. Không sửa cấu hình hook cá nhân để né lỗi.
- **Startup/HMR:** Giữ các protocol reply và resize phát sinh trong lúc `start_terminal` chưa trả terminal ID, rồi xả queue khi start hoàn tất. Context/hook và helper được tách khỏi module chỉ export component để React Refresh không thay toàn bộ registry khi sửa component.
- **Production CSP:** Read-only WebView diagnostics trên bản release trước sửa ghi hơn 94.000 log bị lược, với lỗi `Applying inline style violates ... style-src 'self'` tại WTerm `_buildRowContent`. WTerm dựng cell bằng HTML chứa style attributes. Production bổ sung riêng `style-src-attr 'unsafe-inline'`; script policy và `style-src 'self'` giữ nguyên. Release sau sửa không còn lỗi CSP này.
- **Outer grid:** Dù các pane có `min-width: 0`, cột grid ngầm ở `AppShell` vẫn dùng kích thước nội tại. Đã đo `SidebarProvider/main` rộng tới 1.299,234375 trong viewport 1.280. Đặt cột `minmax(0,1fr)` và `min-w-0` trên body; sau sửa `main.right = 1280`, surface.right = 1271 ở viewport 1280.
- **Chiều cao WTerm:** WTerm làm tròn dòng 17,55 thành 18 px và khóa height lúc init. Phép đo cũ cho 37 dòng làm surface cao 686 trong pane 672. Khi phóng to, height vẫn 668 dù pane đã cao 1264, khiến phần đầu nội dung bị cuộn khuất. Phép đo hiện dùng cùng quy tắc làm tròn và adapter trả height về `100%` sau init. Dev sau sửa đo surface cao đúng 672/1264 theo cửa sổ thường/phóng to.

**Artifact release cuối:** `src-tauri/target/fe008-release/XWork-FE008-Release.exe`, 20.691.456 byte, build 21:20:30, SHA-256 `AD1E77FC0410602D6A9DDCC64F8C6B8926E9A6E533FCC23E9AB72F1AA13220F4`. Đây là Rust **release optimized**, PE subsystem **2 (Windows GUI)**, frontend production nhúng; không phải Rust debug QA. Config tạm chỉ đổi productName/identifier (`com.xwork.fe008smoke`) để cách ly app data. Binary không được thay đổi sau khi copy và smoke. `src-tauri/target/release/xwork.exe` chứa cùng build.

**Kiểm tra tự động:** Full Vitest 87 file/1.678 test đạt với `--maxWorkers=2`; formatter, lint, typecheck đạt. Sau thay đổi height cuối, adapter 11/11 đạt và chạy lại formatter/lint/typecheck. Rustfmt và Clippy `--all-targets --all-features -j 1 -- -D warnings` đạt. Toàn bộ Rust tests đạt với `--test-threads=1`, gồm ConPTY Windows integration. Lượt Rust parallel trước đó treo ở `shutdown_during_attach_prevents_runtime_republication`; đã dừng đúng process test của lượt QA. Lượt Vitest mặc định khi build đồng thời có timeout ở test Rename Project, kéo theo hai assertion; lượt giới hạn worker đạt toàn bộ. Không sửa các test ngoài phạm vi này để che kết quả. Windows Tauri release build và `git diff --check` đạt.

**Quan sát native có giới hạn:** Chỉ dùng UI XWork để chọn profile, đổi tab, chia pane và thay đổi kích thước cửa sổ; không nhập lệnh/prompt vào CLI, không chạy automated desktop E2E. Read-only WebView diagnostics bổ sung số đo layout và lỗi runtime. Cảnh báo WTerm textarea `aria-hidden` vẫn còn; dev có favicon 404. Các cảnh báo này không được tính là lỗi output đã sửa.

| Ma trận | Dev thật (`pnpm tauri dev`, localhost:5173) | Release cuối (SHA ở trên) |
|---|---|---|
| Claude | Hiện banner, prompt, status; giữ nội dung qua 1280×800 → 2560×1392 → 1280×800 và chia hai pane | Hiện banner, prompt, status ở một pane và khi chia đôi |
| Terminal | Hiện PowerShell 7.6.5 và prompt trong pane cạnh Claude | Hiện PowerShell 7.6.5 và prompt trong pane cạnh Claude |
| Codex | Hiện OpenAI Codex v0.153.3, thông báo update, prompt, status | Hiện cùng TUI v0.153.3, thông báo update, prompt và status |
| Flicker/layout | Không quan sát lặp blank/nhấp nháy trong các snapshot sau startup; bố cục nằm trong khung | Không quan sát lặp blank/nhấp nháy sau startup; Claude + PowerShell giữ output khi chuyển sang Codex rồi quay lại; main.right = 1280, surface.right ≤ 1271 |
| Console ngoài app | Debug không dùng để kết luận release | PE subsystem 2; lúc mở artifact không xuất hiện console đen riêng |

Chưa khẳng định tương tác nhập prompt, clipboard/browser thật, IME, toàn bộ 1–4 pane hoặc mọi trạng thái TUI. Các lượt trước có nội dung accessibility nhưng ảnh đen không đủ để kết luận một lỗi paint riêng; không giữ bản vá ép GPU/paint dựa trên giả thuyết đó.

## Điều tra nguyên nhân và re-smoke — 2026-09-05, 19:13–19:38 UTC+07:00

Hai nguyên nhân khiến cả Terminal, Claude và Codex báo Running nhưng vùng output trống đã được xác định và sửa:

- Tauri 2.11.5 chuyển payload byte của raw `Channel<InvokeResponseBody>` sang JavaScript dưới dạng `ArrayBuffer`, trong khi `decodeTerminalFrame` chỉ nhận `Uint8Array` hoặc `number[]`. Mọi frame thật vì thế bị coi là malformed, kích hoạt recovery lặp lại và không đến renderer. Decoder hiện nhận trực tiếp `ArrayBuffer`; regression channel dùng đúng shape runtime này.
- `TerminalPane` đo và resize WTerm đồng bộ ngay trong callback `ResizeObserver`. Khi TUI alternate screen thay đổi layout, WTerm resize tiếp tục thay đổi phần tử trong cùng chu kỳ quan sát và WebView báo `ResizeObserver loop completed with undelivered notifications.` Callback hiện được gom qua một `requestAnimationFrame`, hủy frame cũ khi có delivery mới hoặc unmount. Regression xác nhận hai delivery liên tiếp chỉ gây một phép đo ở frame kế tiếp.

Re-smoke dùng `F:\Self Projects\XWork\src-tauri\target\debug\xwork.exe` được build lúc 19:35:02. Sau smoke, target debug bị một build khác ghi đè; cùng source/config QA đã được build lại và giữ riêng tại `F:\Self Projects\XWork\src-tauri\target\fe008-qa\XWork-FE008-QA.exe` (31.924.224 byte, sửa lúc 19:43:31, SHA-256 `4916BF1736C565BDC9797034AFBF7893BD2AA747917A9AE24A713F15B6D0EDB8`). Chuỗi nhúng xác nhận `identifier` `com.xwork.fe008smoke`. Bản QA có frontend production nhúng sẵn, Rust debug profile và dữ liệu riêng tại `%APPDATA%/com.xwork.fe008smoke`; executable release cũ 17:33:40 không được thay thế hoặc dừng.

| Kiểm tra targeted native | Kết quả |
|---|---|
| Terminal `pwsh.exe` | Pass — hiện `PowerShell 7.6.5` và prompt `PS F:\Self Projects\XWork>` |
| Claude | Pass — hiện đầy đủ TUI `Claude Code v2.1.261`, prompt và status line; đường kẻ dài nằm trong mép phải pane |
| Codex | Pass — hiện đầy đủ TUI `OpenAI Codex (v0.153.2)`, model/directory, prompt và status line sau khoảng 6 giây |
| Bố cục 1.282×802 | Pass trong ba lượt trên — tab, pane header, toolbar, scrollbar và nút cửa sổ đều nằm trong cửa sổ; dòng dài wrap trong pane, không làm rộng layout ngoài cửa sổ |
| Tương tác CLI | Không gửi prompt/lệnh và không kích hoạt reset; đây chỉ là kiểm tra output/render/bố cục |

Kết quả này chỉ ghi nhận lượt QA lúc 19:38; các lần kiểm tra dev/release sau đó còn xuất hiện output trống nên chưa đủ đóng F-07. Lần mở lại artifact được giữ riêng bị người dùng dừng Computer Use bằng phím Escape nên không được tính là một lượt native smoke bổ sung. Báo cáo tràn ngang của người dùng có thể đến từ executable release cũ chưa chứa sửa đổi, nhưng không có đủ bằng chứng để khẳng định executable nào đã được quan sát. Các mục Find native, clipboard hệ điều hành, link/browser, Clear với output thật và toàn bộ ma trận tương thích vẫn giữ trạng thái chưa xác minh ở cuối ticket.

## Bổ sung Claude/Codex — 2026-09-05, 19:12 UTC+07:00

- Người dùng báo mở Claude hoặc Codex vẫn tràn ngang. Chưa xác định executable/cấu hình cửa sổ của lần người dùng quan sát; giữ đây là báo cáo cần tái hiện, không phủ nhận bằng kết quả Terminal mặc định.
- Kiểm tra file trên máy: `target/release/xwork.exe` vẫn có thời điểm sửa 17:33:40, còn `target/debug/xwork.exe` bản QA là 19:00:55. Trước khi mở QA lại, process đang chạy là executable release cũ. Vì vậy không coi bản release hiện tại đã chứa bản sửa.
- Đã mở lại bản QA, tạo New Session, chọn Claude, rồi New tab → Codex qua giao diện XWork. Ở 1.282×802, cả hai pane đang nằm trong chiều rộng cửa sổ, toolbar và nút cửa sổ còn trong khung. Chưa tái hiện được tràn ngang trong kịch bản QA này.
- Cả Claude và Codex đều báo Running nhưng vùng output trống/có con trỏ. Chỉ quan sát vùng chứa của XWork, không nhập prompt/lệnh hoặc tương tác với CLI bên trong.
- F-07 tiếp tục Open: cần kiểm tra cả Terminal, Claude, Codex trên executable chứa sửa đổi; gồm có output thật, đổi tab và resize/split. Kết luận bố cục của Terminal mặc định không đại diện cho toàn bộ CLI.

## Re-smoke sau sửa — 2026-09-05, 19:00–19:08 UTC+07:00

**Bản chạy:** `src-tauri/target/debug/xwork.exe`, tạo mới bằng `pnpm tauri build --debug --config <temp-config>` trong lượt này. Frontend được build production và nhúng vào executable; Rust dùng debug profile. Config tạm chỉ đổi `identifier` thành `com.xwork.fe008smoke` và `productName` thành `XWork QA`, không sửa config repository. Đây không phải lần kiểm chứng executable release mà subagent đã build rồi dọn.

**Dữ liệu kiểm thử:** App release cũ còn mở với các tab Codex/Claude, được giữ nguyên. Bản QA dùng database riêng trong `%APPDATA%/com.xwork.fe008smoke`. Do công cụ điều khiển hộp chọn thư mục trả lỗi geometry không nhất quán (bounds 16×16), đã dừng bản QA chưa có session, tạo một project fixture `FE-008 QA` trỏ tới repository trong database QA rồi mở lại. Không coi luồng Add Project qua hộp thoại là đã pass trong lượt này. New Session và chọn Terminal được thực hiện qua UI thật.

| Kiểm tra lại | Kết quả |
|---|---|
| Build bản QA | Pass, frontend production build và Tauri debug build |
| Vitest tập trung Terminal/Session | 5 file, 31/31 pass lúc 19:00:44 |
| Một pane tại cửa sổ 1.282×802 | Không còn tràn ngang; toolbar và nút cửa sổ nằm trong cửa sổ |
| History | Mở/đóng được; nội dung đang trống |
| Find | Mở được; hai lần nhập `QA-retained` qua công cụ không thấy chuỗi xuất hiện, vẫn `No query`; chưa phân biệt lỗi focus/input của công cụ với app, nên chưa xác minh F-02 native |
| Split right | Tạo hai vùng pane vừa cửa sổ; History của terminal bên trái vẫn mở được |
| Prompt/output | Fail: Running nhưng nền tối và con trỏ, không có prompt trong suốt vài phút quan sát |
| Trạng thái kết nối | Có lúc xuất hiện `Reconnecting output…` rồi biến mất; chưa xác định nguyên nhân |
| Home → quay lại session | Bố cục hai pane còn nguyên; terminal vẫn không hiện prompt |

**Kết luận F-07:** Chỉ xác nhận phần tràn ngang đã cải thiện trong kịch bản một pane và chia thêm một pane rỗng. Triệu chứng không hiện prompt vẫn tái hiện trên executable mới; giữ F-07 Open. Cần điều tra tiếp đường output/kết nối/render, không suy ra lỗi đã sửa hết từ regression xanh.

**Giới hạn:** Không gửi lệnh shell hoặc clipboard qua UI; chưa xác minh native selection/link, closing và Clear với output có sẵn. Không đánh dấu F-01 đến F-06 native pass. Bản QA được để mở ở session kiểm thử. Lượt này chỉ kiểm tra và cập nhật ticket, không sửa source sản phẩm.

## Kết quả kiểm thử

| Lệnh / phép thử | Kết quả |
|---|---|
| `pnpm test` trước khi thêm probe | 87 file, 1.663 test pass |
| `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test terminal_runtime --test terminal_pty_windows --test terminal_interactions` | 9/9 pass: runtime 2, ConPTY Windows 3, interaction 4 |
| Hai probe bổ sung ở phụ lục | 14 test: 8 test đối chứng có sẵn pass, 6 assertion hành vi yêu cầu fail |
| `git diff --check` | Pass |

F-01 đến F-06 được xác nhận bằng component/unit test, không phải suy luận chỉ từ đọc code. IPC clipboard/opener được mock để không đọc clipboard hay mở browser thật. Riêng F-05 dùng `InputHandler` thật của `@wterm/dom@0.3.4`; F-06 nạp Ghostty WASM thật đi kèm package. F-07 được quan sát trực tiếp trên app Windows. Không sửa source sản phẩm, không chạy bộ desktop E2E tự động, không sửa plan lịch sử.

**Cập nhật native:** Lượt trước bị chặn do hai lần `sky.list_windows()` trả `Computer Use native pipe is unavailable ... os error 2`. Sau khi người dùng chuyển ứng dụng chat và yêu cầu chạy lại, native control đã hoạt động. Đã khởi chạy `src-tauri/target/release/xwork.exe` (20.692.480 byte, sửa lần cuối 2026-09-05 17:33:40), mở project XWork, tạo New Session và chọn Terminal (`pwsh.exe`). Phát hiện F-07 bên dưới. Không coi sáu probe trước là sáu lỗi đã tái hiện native.

## Danh sách ưu tiên

| ID | Ưu tiên | Lỗi |
|---|---|---|
| F-07 | P1 | App thật: Terminal tràn ngang, toolbar ngoài cửa sổ; pane running không hiện prompt |
| F-05 | P1 | Native Paste đi vào WTerm qua clipboard của WebView, bỏ qua Rust |
| F-06 | P1 | Clear Screen không giữ viewport cũ trong scrollback render được |
| F-04 | P2 | Double-click để chọn text có thể tự mở URL |
| F-03 | P2 | Terminal đang closing bị hiển thị là đã dừng vì lỗi |
| F-02 | P2 | Query Find mất sau khi view của cùng terminal được mount lại |
| F-01 | P3 | Terminal running chưa có output thiếu hướng dẫn trạng thái rỗng |

P1: cản trở sử dụng terminal, sai ranh giới tích hợp hoặc mất khả năng truy cập lịch sử đã cam kết. P2: sai hành vi thao tác/trạng thái người dùng. P3: thiếu phản hồi hướng dẫn.

## F-07 — Terminal tràn ngang và không hiển thị prompt trên app Windows thật

**Mức xác nhận:** Smoke trực tiếp trên cửa sổ XWork release, kích thước 1.282 × 802 px. Chưa xác định nguyên nhân; hai triệu chứng được ghi chung trong một lỗi để tránh khẳng định chúng độc lập.

**Tái hiện:**

1. Mở executable release nêu trên, chọn project XWork tại `F:\Self Projects\XWork`.
2. Chọn New Session, sau đó chọn công cụ Terminal với default shell `pwsh.exe`.
3. Quan sát sau khi sidebar báo Running; tiếp tục quan sát nhiều lần trong hơn 20 giây.
4. Thử mở History bằng nút của ứng dụng.
5. Chuyển sang Home rồi chọn lại New Session đang Running.

**Mong đợi:** Pane vừa vùng nội dung, các nút thao tác và nút cửa sổ nhìn thấy/bấm được; shell hiển thị prompt hoặc trạng thái chờ/lỗi rõ ràng. Điều hướng ra/vào không làm mất khả năng sử dụng terminal.

**Thực tế:**

- Sidebar báo Running nhưng vùng terminal chỉ có nền tối và con trỏ; không thấy prompt hoặc nội dung output. Cây accessibility có các dòng text rỗng. Không có thông báo giải thích trong pane.
- Toolbar Terminal actions và các nút bên phải header bị đẩy ra ngoài chiều rộng cửa sổ. Cây accessibility vẫn liệt kê Copy, Paste, Find, History, Latest, Clear.
- Bấm History thất bại với bằng chứng tọa độ: `point (3638, 138) is outside window bounds { originX: 0, originY: 0, width: 1282, height: 802 }`. Ảnh cửa sổ thực tế cũng không thấy toolbar.
- Chuyển sang Home: ô tìm kiếm và các nút cửa sổ hiển thị bình thường. Quay lại session: nền tối không có prompt và tràn ngang tái diễn.

**Giới hạn kết luận:** Chưa xác định shell không phát output hay output không được render; Running chỉ là trạng thái UI quan sát được. Không nhập lệnh vào shell, không kiểm chứng đường nhập PTY trong lượt native này. Không đồng nhất triệu chứng trống này với điều kiện zero-output của F-01.

**Tiêu chí sửa:** Terminal vừa cửa sổ ở kích thước trên; toolbar, điều khiển pane và cửa sổ truy cập được; prompt/output thực hiển thị hoặc có trạng thái lỗi đúng; chuyển Home rồi quay lại vẫn dùng được. Sau sửa cần chạy lại smoke Find/History/Clear, selection/clipboard và resize nhiều pane đang bị lỗi này cản trở.

### Kết quả smoke native

| Thao tác | Kết quả |
|---|---|
| Khởi chạy executable release, mở project | Pass |
| New Session → chọn Terminal | Tab/pane được tạo, sidebar báo Running |
| Render prompt và bố cục Terminal | Fail — F-07 |
| Truy cập toolbar History | Fail — nút nằm ngoài cửa sổ |
| Home → quay lại session | Điều hướng hoạt động; lỗi F-07 vẫn tái diễn |
| Find/History/Clear qua toolbar, clipboard, nhập lệnh shell | Chưa kiểm chứng native; không đánh dấu pass |

App được để mở ở session kiểm thử để người dùng quan sát. Không sửa hoặc xóa project có sẵn.

## Kết quả xử lý ngày 2026-09-05

| ID | Thay đổi | Bằng chứng sau sửa |
|---|---|---|
| F-01 | Thêm status `Waiting for output. You can type a command below.` chỉ khi renderer ready, process running và chưa có frame output. | Component regression pass; input/Paste vẫn enabled theo trạng thái running. |
| F-02 | Chuyển query Find sang entry runtime được giữ riêng theo pane/terminal; xóa query khi entry dispose. | Component remount regression và registry isolation/disposal regression pass. |
| F-03 | Tách nhánh `closing` thành `Stopping {title}…`; trạng thái cuối phân biệt exit tự nhiên, stop theo yêu cầu và failure. | Component regression pass; `closing` không còn render failure. |
| F-04 | Bỏ kích hoạt link bằng double-click; context-menu selection chỉ nhận text nằm trong surface tương ứng. Ctrl+click và action Open Link vẫn dùng Rust opener hiện có. | Component regression pass; double-click URL selection tạo zero opener call. |
| F-05 | Chặn paste ở capture phase trước listener đích của WTerm, sau đó đọc Rust clipboard và dùng cùng normalization/bracketed-paste/stale-activation guard như nút Paste. | Regression gắn `InputHandler` thật pass: byte sentinel từ `clipboardData` không tới `onData`; Rust read được gọi đúng terminal. Backend interaction contract 4/4 pass. |
| F-06 | Khi primary viewport có nội dung, Clear đưa từng row qua scroll operation cục bộ của Ghostty rồi đưa cursor về home; history không còn nằm trong snapshot riêng mà renderer không đọc. Clear viewport đã rỗng không archive lại; alternate screen vẫn bị chặn và không có PTY input. | Regression với Ghostty WASM 0.3.4 thật pass: sentinel còn trong `readCoreRows`, chỉ xuất hiện một lần sau clear lặp. |
| F-07 | Khóa overflow ở nested resizable-panel content và Sessions content wrapper; terminal root/host có width constraint; toolbar được giới hạn và wrap; phép đo grid trừ padding/border của surface. Decoder nhận raw Tauri `ArrayBuffer`; resize WTerm được chuyển ra khỏi delivery của `ResizeObserver` qua frame kế tiếp. | Regression layout, raw-channel decode, alternate-screen render và deferred-resize pass. Targeted native trên artifact QA cuối pass với prompt/output thật của Terminal, Claude và Codex trong cửa sổ 1.282×802. |

### Kết quả kiểm tra sau sửa

| Lệnh / phép thử | Kết quả |
|---|---|
| Focused Vitest: TerminalPane, registry, WTerm adapter, SessionPane, PaneLayout | Pass — 5 file, 31 test |
| `pnpm test` | Pass — 87 file, 1.673 test |
| `pnpm format:check`; `pnpm lint`; `pnpm typecheck` | Pass |
| `pnpm build` | Pass; bundle chứa WASM local `ghostty-vt-B_NOYtiM.wasm` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Pass |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 1 -- -D warnings` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml -j 1` | Pass — 240 unit test thư viện và toàn bộ integration/contract target |
| `pnpm tauri build` với `CARGO_BUILD_JOBS=1` | Release build tách biệt trước đó pass. Build QA cuối bằng `pnpm tauri build --debug --config <temp-config>` cũng pass; bản sao có identifier QA được giữ tại `src-tauri/target/fe008-qa/XWork-FE008-QA.exe`. |
| `git diff --check` | Pass sau cập nhật source và tài liệu kết quả |

### Giới hạn re-smoke native sau sửa

Bản QA dùng identifier và database riêng nên đã được quan sát trực tiếp mà không tác động app release đang giữ session của người dùng. Targeted smoke xác nhận output/render/bố cục của Terminal, Claude và Codex; không gửi lệnh hoặc prompt vào CLI. Các mục IME, clipboard hệ điều hành, browser thật, thao tác Find/Clear với output thật, 1–4 pane, theme/font và close/reopen chưa được đánh dấu pass.

## F-05 — Native Paste bỏ qua Rust

**Tiền điều kiện:** Pane running, WTerm input đã được mount.

**Tái hiện bằng probe:**

1. Render `TerminalPane` với entry running và gắn element của adapter vào host thật trong jsdom.
2. Tạo `InputHandler` thật của WTerm trên element, dùng spy `onData`.
3. Phát sự kiện `paste` vào textarea, `clipboardData.getData()` trả sentinel `BROWSER_CLIPBOARD_BYPASS`. Rust clipboard mock trả sentinel khác `RUST_CLIPBOARD`.
4. Kiểm tra payload nào đến `onData` và đường gọi Rust.

**Mong đợi:** Chặn native event trước listener WTerm; đọc qua `read_terminal_clipboard`, rồi áp paste normalization/bracketing theo adapter/registry. Byte từ `clipboardData` không được chuyển thẳng vào input.

**Thực tế:** `onData("BROWSER_CLIPBOARD_BYPASS")` được gọi một lần. Assertion không gửi sentinel browser fail. `onPaste` của React ở parent xử lý sau native listener tại textarea, nên `preventDefault()` tại đó quá muộn để ngăn listener đã gửi dữ liệu.

**Bằng chứng:** Test `ISSUE-05 native paste reads Rust before WTerm sees browser clipboard text`. Không kết luận clipboard hệ điều hành đã bị truy cập: sự kiện và payload là fixture kiểm thử.

**Vị trí:** [terminal-pane.tsx](../../src/features/terminal/terminal-pane.tsx), [wterm-adapter.ts](../../src/features/terminal/wterm-adapter.ts); listener dependency `InputHandler`.

**Tiêu chí sửa:** Test dùng listener WTerm thật không thấy sentinel browser ở `onData`; Rust read gọi đúng một lần, stale activation không dán nhầm pane; nút Paste và native Paste có cùng chính sách.

## F-06 — Clear Screen giữ snapshot tìm kiếm nhưng làm mất nội dung khỏi scrollback để cuộn

**Tiền điều kiện:** Core primary screen, grid 40×4, sentinel nằm trên viewport và chưa bị cuộn lên history.

**Tái hiện:**

1. Nạp Ghostty 0.3.4 WASM thật với budget `0xffffffff`; adapter dùng core này.
2. Ghi `BEFORE_CLEAR_SENTINEL`; xác nhận cell API đọc được sentinel.
3. Gọi `adapter.clearScreen()`.
4. So sánh `adapter.readHistoryRows()` với toàn bộ scrollback + viewport của core qua `readCoreRows(core)`.

**Mong đợi:** Theo FE-008, grid cũ được đẩy vào scrollback trước khi xóa viewport, để người dùng vẫn cuộn và tìm được; không gửi lệnh vào PTY.

**Thực tế:** Snapshot History/Find còn sentinel nhưng `readCoreRows(core)` chỉ trả `["", "", "", ""]`. Adapter ghi local `CSI 2 J` + cursor-home và lưu bản sao riêng, không đưa viewport cũ vào scrollback của core. WTerm renderer không đọc bản sao `archivedRows`, nên người dùng không thể cuộn lại nội dung đó trên terminal.

**Bằng chứng:** Test `ISSUE-06 Clear Screen keeps the old viewport in renderable scrollback`; assertion snapshot còn sentinel pass, assertion core còn sentinel fail. Phép thử không dùng fake parser; chỉ thay surface để chuyển đúng byte vào WASM và tránh cần native layout.

**Vị trí:** [wterm-adapter.ts](../../src/features/terminal/wterm-adapter.ts), phương thức `clearScreen` và `readHistoryRows`.

**Tiêu chí sửa:** Nội dung viewport cũ còn truy cập được trong vùng cuộn terminal sau clear, Find nhảy đúng vào vị trí render được, clear lặp không nhân đôi history, alternate screen vẫn được bảo vệ và không phát PTY input.

## F-04 — Double-click selection có thể mở liên kết ngoài ý định

**Tái hiện:** Render pane running; selection chứa `https://example.com/qa`; phát double-click trong vùng terminal mà không giữ Ctrl và không chọn Open Link.

**Mong đợi:** Double-click dùng chọn văn bản; chỉ Ctrl+click, Open Link hoặc Enter trên link đã focus mới gọi opener theo bảng tương tác FE-008.

**Thực tế:** `openTerminalLink("terminal-1", "https://example.com/qa")` được gọi một lần từ handler `onDoubleClick`. Handler kiểm selection toàn cửa sổ, không yêu cầu target là link hoặc selection thuộc terminal.

**Bằng chứng:** Test `ISSUE-04 double-click text selection does not open URL`; spy opener ghi một call khi mong đợi zero. Selection do fixture cung cấp; không khẳng định mọi double-click native đều chọn trọn URL và không có browser thật nào được mở.

**Vị trí:** [terminal-pane.tsx](../../src/features/terminal/terminal-pane.tsx), `onDoubleClick`.

**Tiêu chí sửa:** Chọn text không gọi opener; các đường kích hoạt link được đặc tả vẫn hoạt động và target/selection phải thuộc terminal tương ứng.

## F-03 — Closing bị báo thành lỗi đã kết thúc

**Tái hiện:** Render pane, publish snapshot `TerminalDto.state = "closing"`, `finalSequence = null`.

**Mong đợi:** Hiển thị `Stopping Terminal…`, khóa input/Paste; chỉ chốt trạng thái kết thúc sau thông tin backend/final output phù hợp.

**Thực tế:** UI hiển thị `Process stopped with an error` ngay khi backend còn closing.

**Bằng chứng:** Test `ISSUE-03 closing terminal reports stopping instead of failure`; phần tử status lỗi vẫn nằm trong DOM.

**Vị trí:** [terminal-pane.tsx](../../src/features/terminal/terminal-pane.tsx), nhánh `terminal-exit-status`.

**Tiêu chí sửa:** Có nhánh closing riêng; không coi mọi state khác running/exited là lỗi; phân biệt failed, exited tự nhiên và stopped theo yêu cầu người dùng.

## F-02 — Mất query Find khi chuyển khỏi rồi quay lại terminal

**Tái hiện:**

1. Mount pane của `terminal-1`, mở Find và nhập `retained`.
2. Unmount view như khi chuyển session/route, nhưng giữ nguyên registry entry.
3. Mount lại cùng terminal, mở Find.

**Mong đợi:** Query vẫn là `retained`, theo yêu cầu giữ query riêng mỗi terminal trong runtime.

**Thực tế:** Input có giá trị chuỗi rỗng. Core/entry vẫn là cùng đối tượng; chỉ state cục bộ của view bị mất.

**Bằng chứng:** Test `ISSUE-02 find query survives remount of the same retained terminal`; expected `retained`, received empty string.

**Vị trí:** [terminal-pane.tsx](../../src/features/terminal/terminal-pane.tsx), local query state và [terminal-registry.ts](../../src/features/terminal/terminal-registry.ts).

**Tiêu chí sửa:** Query theo terminal sống qua detach/remount; hai terminal không dùng chung query; chỉ giải phóng khi terminal bị dispose.

## F-01 — Thiếu trạng thái rỗng khi terminal đã chạy nhưng chưa xuất output

**Tái hiện:** Render pane ready/running, `lastApplied = 0`, `latestOutputSequence = "0"`.

**Mong đợi:** Status ngoài grid hiển thị `Waiting for output. You can type a command below.`; input vẫn truy cập được, gợi ý biến mất khi có output.

**Thực tế:** Không có hướng dẫn trạng thái rỗng; chỉ còn toolbar và host rỗng.

**Bằng chứng:** Test `ISSUE-01 running empty terminal explains how to continue`; không tìm thấy thông điệp trong DOM.

**Vị trí:** [terminal-pane.tsx](../../src/features/terminal/terminal-pane.tsx).

**Tiêu chí sửa:** Có empty-state đúng điều kiện, không đè prompt và không coi preparing/starting là trạng thái running rỗng.

## Các phần chưa được xác minh native

- Tương tác nhập lệnh/prompt trong Terminal, Claude và Codex; output khởi động trong WebView2 production đã được kiểm chứng trên bản QA.
- IME tiếng Việt, selection bằng chuột, clipboard hệ điều hành và browser thật.
- Alternate screen/mouse/synchronized output trực quan, theme/font, resize 1–4 pane.
- Tray/background và close/reopen qua cửa sổ thật.

ConPTY integration pass chứng minh transport/process ở mức fixture, không thay thế các mục native trên.

## Phụ lục — Chạy lại probe

Probe chỉ tồn tại tạm trong lượt kiểm thử rồi được dọn; source sản phẩm và bộ test hiện có được giữ nguyên. Script dưới tái tạo chính hai probe từ fixture có sẵn ở commit đã ghi, sau đó chạy lệnh Vitest. Không đưa các test đang fail vào suite chính trước khi xử lý ticket.

Chạy script Python ở repository root. Nó từ chối ghi đè nếu file probe đã tồn tại. Hai file có thể xóa sau khi thu bằng chứng; không sửa file test nguồn được dùng làm fixture.

```python
from pathlib import Path

pane_path = Path("src/features/terminal/terminal-qa-probe.test.tsx")
core_path = Path("src/features/terminal/wterm-qa-probe.test.ts")
assert not pane_path.exists() and not core_path.exists()
pane = Path("src/features/terminal/terminal-pane.test.tsx").read_text(encoding="utf-8")
pane = pane.replace("import { act, render, screen }", "import { act, fireEvent, render, screen }")
pane = pane.replace('import { TerminalPane } from "./terminal-pane";', r'''
vi.mock("@/lib/ipc/terminal", () => ({
  readTerminalClipboard: vi.fn(async () => "RUST_CLIPBOARD"),
  writeTerminalClipboard: vi.fn(async () => undefined),
  openTerminalLink: vi.fn(async () => undefined),
}));
import { openTerminalLink, readTerminalClipboard } from "@/lib/ipc/terminal";
import { InputHandler } from "@wterm/dom";
import { TerminalPane } from "./terminal-pane";
''')
pane += r'''
/** Publishes a live terminal snapshot without any output. */
async function readyForProbe(state: TerminalDto["state"] = "running") {
  await act(async () => fixture.publish({terminal: {...terminal(state), latestOutputSequence: "0"}, phase: "ready", lastApplied: 0n, finalSequence: null, failure: null, inputBusy: false}));
}

/** Checks the required guidance for a running terminal awaiting its first output. */
it("ISSUE-01 running empty terminal explains how to continue", async () => {
  renderPane();
  await readyForProbe();
  expect(screen.getByText("Waiting for output. You can type a command below.")).toBeInTheDocument();
});

/** Checks per-terminal query retention after a route detaches and remounts its view. */
it("ISSUE-02 find query survives remount of the same retained terminal", async () => {
  const user = userEvent.setup();
  const view = renderPane();
  await readyForProbe();
  await user.click(screen.getByRole("button", {name: "Find", exact: true}));
  await user.type(screen.getByRole("textbox", {name: "Find in terminal history"}), "retained");
  view.unmount();
  renderPane();
  await user.click(screen.getByRole("button", {name: "Find", exact: true}));
  expect(screen.getByRole("textbox", {name: "Find in terminal history"})).toHaveValue("retained");
});

/** Checks that an in-progress close is not presented as a process failure. */
it("ISSUE-03 closing terminal reports stopping instead of failure", async () => {
  renderPane();
  await readyForProbe("closing");
  expect(screen.queryByText("Process stopped with an error")).not.toBeInTheDocument();
});

/** Checks that selecting URL text does not open a browser without link activation. */
it("ISSUE-04 double-click text selection does not open URL", async () => {
  const view = renderPane();
  await readyForProbe();
  vi.spyOn(window, "getSelection").mockReturnValue({toString: () => "https://example.com/qa"} as Selection);
  await act(async () => fireEvent.doubleClick(view.container.querySelector("[data-terminal-root]")!));
  expect(openTerminalLink).not.toHaveBeenCalled();
});

/** Exercises the actual WTerm paste listener beneath React's terminal event boundary. */
it("ISSUE-05 native paste reads Rust before WTerm sees browser clipboard text", async () => {
  fixture.entry.attach.mockImplementation((host: HTMLElement) => {host.appendChild(fixture.adapter.element); return () => fixture.adapter.element.remove();});
  const view = renderPane();
  await readyForProbe();
  const onData = vi.fn();
  const handler = new InputHandler(fixture.adapter.element, onData, () => null);
  try {
    const input = fixture.adapter.element.querySelector("textarea")!;
    fireEvent.paste(input, {clipboardData: {getData: () => "BROWSER_CLIPBOARD_BYPASS"}});
    expect(onData).not.toHaveBeenCalledWith("BROWSER_CLIPBOARD_BYPASS");
    expect(readTerminalClipboard).toHaveBeenCalledWith("terminal-1");
  } finally {
    handler.destroy();
    view.unmount();
    fixture.entry.attach.mockImplementation(() => () => undefined);
  }
});
'''
pane_path.write_text(pane, encoding="utf-8")
core = Path("src/features/terminal/wterm-adapter.test.ts").read_text(encoding="utf-8")
core += r'''
/** Checks that Clear Screen preserves the old visible row in WTerm's scrollable core. */
it("ISSUE-06 Clear Screen keeps the old viewport in renderable scrollback", async () => {
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(wasm, {status: 200}));
  let adapter: WTermAdapter | null = null;
  try {
    const core = await GhosttyCore.load({wasmPath: "/fixture/ghostty-vt.wasm", scrollbackLimit: RETAINED_SCROLLBACK_BYTES});
    const surface: WTermSurface = {
      bridge: core, cols: 40, rows: 4,
      /** Initializes the real pinned WASM core. */
      init: async () => {core.init(40, 4); return surface;},
      /** Applies the exact bytes that the adapter passes to WTerm. */
      write: (data) => {if (typeof data === "string") core.writeString(data); else core.writeRaw(data);},
      resize: vi.fn(), focus: vi.fn(), destroy: vi.fn(),
    };
    adapter = new WTermAdapter({onData: vi.fn(), onResize: vi.fn()}, {
      loadCore: async () => core,
      createSurface: () => surface,
      measure: () => ({columns: 40, rows: 4}),
    });
    await adapter.initialize(document.createElement("div"));
    adapter.write(new TextEncoder().encode("BEFORE_CLEAR_SENTINEL"));
    expect(readCoreRows(core)).toContain("BEFORE_CLEAR_SENTINEL");
    adapter.clearScreen();
    expect(adapter.readHistoryRows()).toContain("BEFORE_CLEAR_SENTINEL");
    expect(readCoreRows(core)).toContain("BEFORE_CLEAR_SENTINEL");
  } finally {adapter?.destroy(); fetch.mockRestore();}
});
'''
core_path.write_text(core, encoding="utf-8")
```

```powershell
pnpm exec vitest run src/features/terminal/terminal-qa-probe.test.tsx src/features/terminal/wterm-qa-probe.test.ts --reporter=verbose
```

Kết quả xác nhận tại commit trên: **14 test, 8 pass, 6 fail**. Mỗi test tên `ISSUE-01` đến `ISSUE-06` tương ứng F-01 đến F-06; failure phải là assertion hành vi được ghi ở ticket, không phải lỗi import hoặc setup.
