# FE-006 — Session

Tài liệu này đặc tả vòng đời phiên trên giao diện ở mức contract: tạo phiên và màn hình chọn công cụ (kể cả công cụ `Unavailable` và kiểm tra lại), đổi tên phiên, xóa phiên có cảnh báo, và hiển thị trạng thái từng phiên trên sidebar cùng trang tổng quan project.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-006` |
| Phase | `1` |
| Khu vực chính | `src/features/sessions/` |
| Yêu cầu chức năng | §8, §10.3; liên quan §4.1, §7.5, §10.2 và §18 |
| Wireframe | `04-Projects.html#sidebar-sessions`, `#new-session`, `#tool-unavailable`, `#dlg-delete-session`, `#overview` |
| Backend liên quan | `BE-005`, `BE-006`, `BE-003` |
| Phụ thuộc | `FE-001`, `FE-004`, `FE-005`, `FE-013` |

## Mục tiêu

Người dùng tạo phiên cho một project, chọn công cụ ở màn hình `New Session` để phiên bắt đầu làm việc, đổi tên và xóa phiên với cảnh báo nêu rõ tiến trình sẽ bị dừng cùng file chưa lưu. Mọi phiên của lần chạy hiện tại hiện trên sidebar dưới đúng project của nó kèm trạng thái phân biệt được, và mở được chỉ bằng một lần bấm.

### Quyết định và giả định đã chốt

- Khối `Recently used` của màn hình chọn công cụ là state trong bộ nhớ của frontend. `BE-006` ghi rõ không sở hữu danh sách này, còn `BE-005` không có field nào về profile đã dùng hay thời điểm dùng, nên feature tự ghi `profileId` cùng mốc thời gian mỗi lần chọn công cụ thành công trong lần chạy hiện tại. Danh sách không được ghi `localStorage`, `sessionStorage` hay database và mất khi thoát ứng dụng, đúng với việc phiên chỉ sống trong một lần chạy.
- `FE-006` sở hữu `element` của route `/sessions/:sessionId`. Route render màn hình chọn công cụ khi `tabs` rỗng và render `SessionWorkspacePlaceholder` khi phiên đã có tab; `FE-007` thay đúng chỗ trống đó bằng thanh tab và bố cục pane mà không đụng phần còn lại của route. `set_observed_session` cũng thuộc route này, không thuộc trang tổng quan project.
- Header phiên (tên phiên, nút `Rename session`, menu `More actions`) do `FE-006` dựng và hiện ở cả hai nhánh của route tại lát cắt này, để đổi tên và xóa luôn có đường vào ngay cả khi phiên đã có tab. Wireframe `#panes-1` không vẽ header vì `FE-007` sẽ chuyển hai thao tác này vào thanh tab; khi đó `FE-007` được phép bỏ header ở nhánh có tab.
- Hàng phiên con trên sidebar do feature `sessions` sở hữu và được ghép tại `src/app/app-sidebar.tsx` qua một slot của `SidebarProjectList`. Feature `projects` không import feature `sessions`, đúng quy tắc "màn hình tổng hợp được ghép tại `src/app/`".
- Khối `Sessions in this run` và nút `New Session` trên trang tổng quan project thuộc lát cắt này. Theo dự kiến của `FE-005`, hai file `project-session-list.tsx` và `use-project-sessions.ts` nằm trong `src/features/projects/` và gọi thẳng wrapper IPC dùng chung, không import feature `sessions`.
- Hệ quả của ranh giới trên: hộp thoại đổi tên và hộp thoại xóa tồn tại hai bản, một trong `sessions` và một trong `projects`. Để phần khác nhau chỉ còn là lớp vỏ JSX, toàn bộ phần thuần — kiểm tra tên, phân loại `SessionsError`, dựng câu chữ hộp thoại, ánh xạ trạng thái phiên — được đặt tại `src/lib/utils/` và cả hai feature dùng chung.
- Danh sách công cụ đọc thẳng `get_cli_profiles` của `BE-006` qua `src/lib/ipc/cli-profiles.ts` và đăng ký `cli-profiles://changed`; feature `sessions` không dùng `cli-profiles-store.ts` của feature `settings`. Thứ tự nguồn giữ nguyên (Codex, Claude, Terminal, rồi custom); chỉ khối `Recently used` được đưa lên trước.
- Sidebar và trang tổng quan là hai người đọc độc lập của cùng dữ liệu backend: cả hai gọi `list_sessions` và nghe `sessions://runtime-changed`, nên luôn hội tụ về cùng snapshot. Không có state phiên nào được chia sẻ giữa hai feature bằng import.
- Điều hướng sau khi xóa phiên đang mở là `/projects/{projectId}` lấy từ snapshot ngay trước khi xóa. Khi mount mà `get_session` trả `sessionNotFound`, route điều hướng về `/projects` vì lúc đó frontend không biết project nào.
- Breadcrumb của route phiên là `Projects / {tên project} / {tên phiên}` theo wireframe `#new-session`. Bảng route đọc nhãn qua `readSessionCrumb(sessionId)` do feature `sessions` export và `readProjectCrumbLabel(projectId)` đã có của feature `projects`; `AppTopbar` subscribe thêm snapshot phiên để nhãn đổi ngay sau khi đổi tên.
- Phím số `1`–`9` trong màn hình chọn công cụ theo thứ tự thẻ đang hiển thị (`Recently used` trước, `All tools` sau, bỏ qua thẻ `Add a CLI profile`). Phím trỏ vào thẻ khả dụng thì chọn ngay; phím trỏ vào thẻ `Unavailable` chỉ đưa focus tới thẻ đó để người dùng đọc được lý do và bấm `Check again`. Đây là phím cục bộ của màn hình, không phải shortcut cấu hình được của `FE-014`.
- Màu không bao giờ là kênh thông tin duy nhất: mỗi chấm trạng thái luôn đi kèm nhãn chữ, ở sidebar là chữ ẩn thị giác vì hàng chỉ đủ chỗ cho chấm và tên.

### Ngoài phạm vi

- Thanh tab, bố cục pane, màn hình chọn nội dung cho pane mới, chia/phóng to/đóng pane, đóng tab và mở lại tab vừa đóng (`FE-007`); mọi command tab/pane của `BE-005` không được gọi ở đây.
- Render terminal, stream output, gửi input và vòng đời tiến trình (`FE-008`, `BE-007`). Chọn công cụ ở lát cắt này chỉ tạo pane `ToolSelection`, chưa có process.
- Tạo, sửa, xóa CLI profile và đổi shell mặc định (`FE-013`); màn hình chọn công cụ chỉ đọc catalog và gọi `check_cli_profile`.
- Ghim, đổi tên, gỡ project và Git status (`FE-004`, `FE-005`).
- Notification, tìm kiếm hợp nhất và khối phiên trên Home (`FE-010`, `FE-009`, `FE-003`).
- Lưu `Recently used`, tên phiên hay bố cục qua lần thoát ứng dụng; toàn bộ dữ liệu phiên là runtime.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/sessions/session-route.tsx` | Điểm vào route `/sessions/:sessionId`: tải snapshot phiên và project, dựng header phiên, chọn giữa màn hình công cụ và chỗ trống của `FE-007`, ghép hai hộp thoại, xử lý điều hướng khi phiên biến mất. |
| `src/features/sessions/session-workspace-placeholder.tsx` | Chỗ trống cho phiên đã có tab: nêu rõ thanh tab và pane đến cùng `FE-007`, kèm số tab hiện có lấy từ snapshot. |
| `src/features/sessions/session-tool-picker.tsx` | Màn hình `New Session`: khối `Recently used`, khối `All tools`, thẻ `Add a CLI profile`, xử lý phím số và trạng thái đang chọn. |
| `src/features/sessions/session-tool-card.tsx` | Một thẻ công cụ: dấu nhận diện, tên, dòng lệnh phụ, nhãn `Used …`, nhánh `Unavailable` với lý do, `Check again` và liên kết `Open CLI Profiles`. |
| `src/features/sessions/use-tool-catalog.ts` | Hook catalog công cụ: `get_cli_profiles`, đăng ký `cli-profiles://changed`, `check_cli_profile` theo từng profile, đánh dấu profile vừa bị backend báo không khả dụng. |
| `src/features/sessions/recent-tools-store.ts` | Danh sách công cụ dùng gần đây trong bộ nhớ: ghi nhận lần chọn thành công, đọc tối đa bốn mục mới nhất, định dạng nhãn `Used …`. |
| `src/features/sessions/sessions-store.ts` | Snapshot summary phiên theo project cho sidebar và breadcrumb: `list_sessions`, đăng ký `sessions://runtime-changed`, đếm consumer, phát hiện khoảng trống `revision`, `readSessionCrumb` và `readSessionProjectId`. |
| `src/features/sessions/sidebar-session-rows.tsx` | Hàng phiên con của một project trên sidebar: chấm trạng thái kèm chữ ẩn thị giác, tên phiên, điều hướng tới route phiên, trạng thái rỗng và lỗi rút gọn. |
| `src/features/sessions/use-session-detail.ts` | Hook của route phiên: `get_session`, `get_project` cho `rootPath`, đồng bộ theo `sessions://runtime-changed`, làm mới khi cửa sổ focus, gọi `set_observed_session` khi vào và khi rời. |
| `src/features/sessions/use-session-lifecycle.ts` | Hook thao tác vòng đời: `rename_session`, `get_close_impact`, `close_runtime_target`, khóa chống gọi trùng và phân loại lỗi cho hai hộp thoại của feature. |
| `src/features/sessions/rename-session-dialog.tsx` | Hộp thoại đổi tên phiên: input, quy tắc tên, thông điệp lỗi, `Cancel` và `Rename`. |
| `src/features/sessions/delete-session-dialog.tsx` | Hộp thoại xóa phiên: câu cảnh báo, hộp facts dựng từ `CloseImpactDto`, `Cancel` và `Delete Session`, xử lý `confirmationRequired` lần hai. |
| `src/features/sessions/session-actions-menu.tsx` | Menu hai item `Rename session…` và `Delete Session` dùng cho header phiên. |
| `src/features/sessions/sessions-test-fixture.ts` | Fixture DTO phiên, profile và impact dùng chung cho test của feature. |
| `src/features/projects/project-session-list.tsx` | Khối `Sessions in this run` trên trang tổng quan: hàng phiên với chấm trạng thái, tên, dòng meta, nút `Open` và menu hai thao tác; trạng thái rỗng, đang tải và lỗi. |
| `src/features/projects/use-project-sessions.ts` | Hook dữ liệu và thao tác phiên của trang tổng quan: `list_sessions(projectId)`, `sessions://runtime-changed`, `create_session`, `rename_session`, luồng impact và xóa, khóa chống gọi trùng. |
| `src/features/projects/rename-session-dialog.tsx` | Bản hộp thoại đổi tên của trang tổng quan, dùng chung phần kiểm tra tên và câu chữ tại `src/lib/utils/session-copy.ts`. |
| `src/features/projects/delete-session-dialog.tsx` | Bản hộp thoại xóa của trang tổng quan, dùng chung phần dựng facts và câu chữ tại `src/lib/utils/session-copy.ts`. |
| `src/features/projects/project-overview-route.tsx` | Render `ProjectSessionList` ở đầu cột trái và nối hai nút `New Session` vào `use-project-sessions`. |
| `src/features/projects/project-overview-header.tsx` | Bỏ trạng thái chờ của nút `New Session`: nút hoạt động thật, khóa khi project `Unavailable` hoặc khi đang tạo phiên, giữ tooltip giải thích cho từng lý do. |
| `src/features/projects/sidebar-project-list.tsx` | Nhận slot render hàng con và `activeProjectId`; thêm chevron mở/thu gọn cho từng project row. |
| `src/lib/ipc/sessions.ts` | Wrapper command và event của `BE-005` mà lát cắt này dùng: `listSessions`, `getSession`, `createSession`, `renameSession`, `selectSessionTool`, `getCloseImpact`, `closeRuntimeTarget`, `setObservedSession`, `onSessionsRuntimeChanged`. |
| `src/lib/ipc/cli-profiles.ts` | Dùng lại nguyên trạng cho `get_cli_profiles`, `check_cli_profile` và `cli-profiles://changed`; không thêm wrapper mới. |
| `src/lib/ipc/projects.ts` | Dùng lại nguyên trạng `getProject` cho `rootPath` và nhãn project của route phiên. |
| `src/features/projects/projects-store.ts` | Dùng lại nguyên trạng `readProjectCrumbLabel` cho cấp thứ hai của breadcrumb route phiên. |
| `src/lib/utils/session-status.ts` | Hàm thuần ánh xạ `SessionStatusDto` sang tone chấm và nhãn chữ, và dựng dòng meta từ `SessionSummaryDto`. |
| `src/lib/utils/session-copy.ts` | Hàm thuần dùng chung: kiểm tra tên phiên, phân loại `SessionsError` thành thông điệp và khả năng thử lại, dựng câu chữ cùng facts cho hộp thoại xóa. |
| `src/app/app-router.tsx` | Route `/sessions/:sessionId` trỏ `element` sang `SessionRoute`; breadcrumb ghép `readProjectCrumbLabel` với `readSessionCrumb`. |
| `src/app/app-sidebar.tsx` | Truyền slot hàng phiên (`SidebarSessionRows`) và `activeProjectId` cho `SidebarProjectList`. |
| `src/app/app-topbar.tsx` | Subscribe thêm snapshot phiên để nhãn breadcrumb đổi ngay sau khi đổi tên phiên. |
| `src/features/sessions/session-route.test.tsx` | Test route: hai nhánh render, header, điều hướng khi phiên bị xóa, `set_observed_session` khi vào và khi rời. |
| `src/features/sessions/session-tool-picker.test.tsx` | Test picker: hai khối, thứ tự thẻ, phím số, khóa khi đang chọn, ánh xạ lỗi chọn công cụ. |
| `src/features/sessions/session-tool-card.test.tsx` | Test thẻ: dòng lệnh phụ, hậu tố `default shell`, nhánh `Unavailable`, `Check again`, liên kết Settings. |
| `src/features/sessions/use-tool-catalog.test.ts` | Test hook catalog: đọc snapshot, làm mới theo event, `check_cli_profile`, đánh dấu profile không khả dụng theo lỗi chọn. |
| `src/features/sessions/recent-tools-store.test.ts` | Test danh sách gần đây: khử trùng lặp, giới hạn, thứ tự, nhãn thời gian. |
| `src/features/sessions/sessions-store.test.ts` | Test store: nhóm theo project, áp event, bỏ event cũ, đọc lại khi `revision` nhảy bậc, giải phóng listener. |
| `src/features/sessions/sidebar-session-rows.test.tsx` | Test hàng sidebar: chấm và chữ ẩn thị giác, điều hướng, trạng thái rỗng và lỗi. |
| `src/features/sessions/use-session-detail.test.ts` | Test hook route: token chống kết quả cũ, đồng bộ theo event, làm mới khi focus, thứ tự gọi `set_observed_session`. |
| `src/features/sessions/use-session-lifecycle.test.ts` | Test hook thao tác: đổi tên, luồng impact–xác nhận–xóa, `confirmationRequired` lần hai, chống gọi trùng. |
| `src/features/sessions/rename-session-dialog.test.tsx` | Test hộp thoại đổi tên: tiền điền, quy tắc tên, lỗi backend, focus trả về. |
| `src/features/sessions/delete-session-dialog.test.tsx` | Test hộp thoại xóa: nhãn phá hủy, facts số ít và số nhiều, hủy, lỗi lifecycle. |
| `src/features/projects/project-session-list.test.tsx` | Test khối phiên trên overview: ánh xạ trạng thái, rỗng, đang tải, lỗi, mở phiên, menu hai thao tác. |
| `src/features/projects/use-project-sessions.test.ts` | Test hook overview: query theo project, lọc event, tạo phiên và điều hướng, đổi tên, xóa, chống gọi trùng. |
| `src/features/projects/project-overview-header.test.tsx` | Bổ sung: nút `New Session` hoạt động, khóa khi `Unavailable` và khi đang tạo. |
| `src/features/projects/project-overview-route.test.tsx` | Bổ sung: khối phiên được dựng, nút ở trạng thái rỗng và nút header dùng chung một luồng. |
| `src/features/projects/sidebar-project-list.test.tsx` | Bổ sung: chevron mở/thu gọn, slot hàng con nhận đúng project, project của route hiện tại tự mở. |
| `src/lib/ipc/sessions.test.ts` | Test wrapper: tên command, hình dạng tham số camelCase, tên event, ánh xạ lỗi typed. |
| `src/lib/utils/session-status.test.ts` | Test ánh xạ trạng thái và dòng meta cho cả sáu giá trị, số ít và số nhiều. |
| `src/lib/utils/session-copy.test.ts` | Test kiểm tra tên, phân loại lỗi và câu chữ hộp thoại xóa. |
| `src/app/app-router.test.tsx` | Bổ sung: route phiên render `SessionRoute`; breadcrumb ba cấp. |
| `src/app/app-sidebar.test.tsx` | Bổ sung: slot hàng phiên được truyền và `activeProjectId` đúng theo route. |
| `src/app/app-topbar.test.tsx` | Bổ sung: nhãn breadcrumb phiên đổi khi snapshot phiên đổi. |

Feature không thêm dependency mới, không sửa file Rust, migration, `src-tauri/capabilities/main.json`, `src-tauri/tauri.conf.json` hay bất kỳ file nào trong `src/bindings/`. Binding `src/bindings/sessions/sessions.ts` và `src/bindings/terminal/cli-profiles.ts` đã được sinh sẵn bởi `BE-005` và `BE-006`.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `SessionRoute` | Điểm vào route `/sessions/:sessionId`. Vùng nội dung padding `28px 32px`, cuộn dọc, không cuộn ngang. Dựng header phiên rồi một trong hai nhánh nội dung theo `tabs.length`. | `04-Projects.html#new-session` |
| `SessionHeader` trong `session-route.tsx` | Hàng trên cùng: trái là tên phiên `display-sm` cắt ellipsis kèm `title`, nút icon `Rename session` và nút icon `More actions`; phải là dòng `Starts in {rootPath}` dạng mono `12px`, ẩn khi chưa đọc được project. | `#new-session` |
| `SessionToolPicker` | Nhánh nội dung khi `tabs` rỗng: nhãn khối `Recently used` với lưới hai cột, nhãn khối `All tools` với lưới ba cột, dòng gợi ý phím ở cuối. | `#new-session`, `#tool-unavailable` |
| `SessionToolCard` | Một thẻ công cụ: dấu nhận diện vuông bo góc dùng `icon` và `color` của profile, tên `13px` weight `500`, dòng phụ là lệnh và tham số, cột phải là nhãn `Used …` hoặc cụm `Unavailable`. | `#new-session`, `#tool-unavailable` |
| `SessionWorkspacePlaceholder` | Nhánh nội dung khi phiên đã có tab: câu `This session has {n} tab|tabs.` và câu `Tabs and panes arrive with FE-007.` | Không có |
| `SidebarSessionRows` | Hàng phiên con dưới một project row trên sidebar: chấm trạng thái, chữ ẩn thị giác là nhãn trạng thái, tên phiên cắt ellipsis; hàng của route hiện tại có nền `cream-strong` như hàng project đang chọn. | `#sidebar-sessions` |
| `ProjectSessionList` | Khối đầu cột trái của trang tổng quan: nhãn `Sessions in this run` kèm chú thích `Not restored after Quit`; mỗi hàng gồm chấm trạng thái, tên weight `500`, dòng meta `12px` muted, nút `Open` secondary nhỏ và nút icon `More actions`. | `#overview` |
| `RenameSessionDialog` | Hộp thoại một input: nhãn `Session name`, giá trị tiền điền là tên hiện tại và được chọn sẵn, nút `Cancel` và `Rename`. | Không có |
| `DeleteSessionDialog` | Hộp thoại phá hủy: tiêu đề nêu tên phiên, đoạn giải thích, hộp facts liệt kê tiến trình sẽ dừng và file chưa lưu, nút `Cancel` và nút destructive `Delete Session`. | `#dlg-delete-session` |
| `SessionActionsMenu` | Menu hai item `Rename session…` và `Delete Session`; item xóa dùng kiểu destructive. | `#overview` |

Nội dung chữ cố định:

- Khối picker: `Recently used`, `All tools`; dòng gợi ý `Press 1–9 to pick, Enter to start. The tool runs in a new tab at the project root.`
- Thẻ cuối của `All tools`: tiêu đề `Add a CLI profile`, dòng phụ `Settings › Terminal & CLI Profiles`.
- Thẻ không khả dụng: badge `Unavailable`, nút `Check again`, liên kết `Open CLI Profiles`, thông điệp `Command not found: {command}` hoặc `Shell not found`.
- Header phiên: `Starts in {rootPath}`, tooltip `Rename session`, tooltip `More actions`.
- Khối overview: `Sessions in this run`, `Not restored after Quit`, `No sessions in this run yet.`, `Start one to work in this project.`, nút `New Session`, nút `Open`.
- Hộp thoại đổi tên: tiêu đề `Rename session`, nhãn input `Session name`, nút `Rename`, lỗi tên `Use 1 to 80 characters without control characters.`
- Hộp thoại xóa: tiêu đề `Delete session “{name}”?`, đoạn `Everything in this session is stopped and removed: its tabs, panes and terminal output. This cannot be undone.`, nút `Delete Session`.
- Facts của hộp thoại xóa: `{n} running process|processes will be stopped: {labels}` và `{n} file|files with unsaved changes: {labels}`; dòng có số `0` không render, và khi không còn dòng nào thì hộp facts không render.

Ánh xạ trạng thái phiên trong `src/lib/utils/session-status.ts`:

| `SessionStatusDto` | Tone chấm | Nhãn chữ |
|---|---|---|
| `noToolYet` | `idle` | `No tool chosen` |
| `running` | `running` | `Running` |
| `unseenOutput` | `unread` | `New output` |
| `needsAttention` | `attention` | `Needs attention` |
| `finished` | `done` | `Finished` |
| `exitedWithError` | `error` | `Exited with an error` |

Dòng meta của một hàng phiên: `{nhãn trạng thái} · {tabCount} tab|tabs`, nối thêm ` · {runningProcessCount} process|processes` khi `runningProcessCount > 0`.

Ánh xạ dòng phụ của thẻ công cụ từ `CliProfileDto`:

| Dữ liệu | Hiển thị |
|---|---|
| `command` khác `null` và `arguments` rỗng | `{command}` |
| `command` khác `null` và có `arguments` | `{command} {arguments nối bằng dấu cách}` |
| `id === "builtin:terminal"` và `shellId === null` | `{command} · default shell` |
| `command === null` | `Shell not resolved`, và thẻ ở trạng thái không khả dụng |
| `availability.status === "commandNotFound"` | Dòng phụ thay bằng `Command not found: {command}` màu lỗi |
| `availability.status === "shellNotFound"` | Dòng phụ thay bằng `Shell not found` màu lỗi |
| `availability.status === "unchecked"` | Thẻ vẫn chọn được; backend kiểm lại ngay khi chọn |

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Route đang tải | `get_session` chưa trả kết quả cho `sessionId` hiện tại. | Skeleton: một khối chữ ở vị trí tên phiên và bốn ô mờ ở vị trí lưới công cụ; không render nút hành động. |
| Route sẵn sàng, chưa có tab | `tabs.length === 0`. | Header phiên và `SessionToolPicker`. |
| Route sẵn sàng, đã có tab | `tabs.length > 0`. | Header phiên và `SessionWorkspacePlaceholder`. |
| Phiên không còn tồn tại | `get_session` trả `sessionNotFound`, hoặc event `deleted` cho phiên đang mở. | Không hiển thị lỗi: điều hướng về `/projects/{projectId}` khi đã biết project, ngược lại về `/projects`. |
| Route lỗi tải | `get_session` trả lỗi khác, gồm `unauthorizedWindow` và lỗi không nhận dạng được. | Thay nội dung bằng dòng `XWork couldn't open this session.` kèm nút `Try again` gọi lại đúng `get_session`. |
| Catalog đang tải | `get_cli_profiles` chưa trả kết quả. | Sáu ô mờ trong khối `All tools`; khối `Recently used` chưa render. |
| Catalog lỗi | `get_cli_profiles` bị từ chối. | Dòng `XWork couldn't load your CLI profiles.` kèm nút `Try again`; header phiên vẫn hiển thị đầy đủ. |
| Công cụ không khả dụng | `availability.status` là `commandNotFound` hoặc `shellNotFound`, hoặc lần chọn vừa rồi trả `profileUnavailable`. | Thẻ mờ, dấu nhận diện xám, dòng phụ nêu lý do, badge `Unavailable`, nút `Check again` và liên kết `Open CLI Profiles`; thẻ vẫn nhận focus nhưng không chọn được. |
| Đang kiểm tra lại | `check_cli_profile` đang chạy cho profile đó. | Nút `Check again` khóa và badge đổi thành `Checking…`; các thẻ khác không đổi. |
| Đang chọn công cụ | `select_session_tool` đang chạy. | Toàn bộ thẻ khóa; thẻ được chọn hiện `Starting…` ở vị trí nhãn phải; phím số bị bỏ qua. |
| Chọn công cụ lỗi | `select_session_tool` trả lỗi. | Dòng lỗi ngay dưới nhãn `All tools` theo bảng lỗi ở phần contract; toàn bộ thẻ mở khóa lại. |
| Khối phiên overview đang tải | `list_sessions(projectId)` chưa trả kết quả. | Hai hàng skeleton trong khối. |
| Khối phiên overview rỗng | Danh sách rỗng sau khi tải xong. | `No sessions in this run yet.`, `Start one to work in this project.` và nút secondary `New Session`. |
| Khối phiên overview lỗi | `list_sessions` bị từ chối. | `XWork couldn't load sessions for this project.` kèm `Try again`; phần còn lại của trang không bị ảnh hưởng. |
| Đang tạo phiên | `create_session` đang chạy. | Cả hai nút `New Session` khóa và giữ nguyên nhãn. |
| Hàng sidebar rỗng | Project không có phiên nào. | Không render hàng con nào; chevron vẫn bấm được và mở ra vùng rỗng. |
| Hàng sidebar lỗi | `list_sessions` bị từ chối. | Một dòng muted `Couldn't load sessions.` kèm nút chữ `Try again` dưới project row đang mở. |
| Đang xóa phiên | `close_runtime_target` đang chạy. | Nút `Delete Session` khóa và giữ nhãn; `Cancel` dùng lại được sau khi lệnh trả kết quả. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Bấm `New Session` trên trang tổng quan, ở header hoặc ở trạng thái rỗng | Gọi `create_session(projectId)` đúng một lần rồi điều hướng tới `/sessions/{summary.id}`; sidebar và khối phiên tự cập nhật qua `sessions://runtime-changed`. | `Enter` / `Space` |
| Bấm một thẻ công cụ khả dụng | Gọi `select_session_tool(sessionId, profileId)`; thành công thì ghi công cụ vào danh sách gần đây và route chuyển sang nhánh đã có tab. | `Enter` / `Space` |
| Bấm phím số `1`–`9` trong picker | Thẻ khả dụng: chọn ngay như bấm chuột. Thẻ không khả dụng: chỉ đưa focus tới thẻ đó. Phím ngoài phạm vi thẻ đang hiển thị: bỏ qua. | `1`–`9` |
| Bấm `Check again` trên thẻ không khả dụng | Gọi `check_cli_profile(profileId)` rồi đọc lại snapshot catalog; thẻ trở lại bình thường khi backend báo `available`. | `Enter` / `Space` |
| Bấm `Open CLI Profiles` hoặc thẻ `Add a CLI profile` | Điều hướng tới `/settings/terminal-profiles`; không gọi command nào. | `Enter` / `Space` |
| Bấm `Rename session` ở header, hoặc `Rename session…` trong menu | Mở `RenameSessionDialog` với tên hiện tại được chọn sẵn; đóng hộp thoại trả focus về đúng nút đã mở nó. | `Enter` / `Space` mở, `Esc` đóng |
| Xác nhận đổi tên | Gọi `rename_session(sessionId, name)`; thành công đóng hộp thoại, tên đổi trên header, sidebar, breadcrumb và khối overview sau khi snapshot làm mới. | `Enter` trong input |
| Chọn `Delete Session` trong menu | Gọi `get_close_impact({ kind: "session", sessionId })` rồi mở `DeleteSessionDialog` với facts vừa đọc. | `Enter` / `Space` |
| Xác nhận xóa | Gọi `close_runtime_target(target, true)`; thành công đóng hộp thoại, và nếu đang ở route của phiên đó thì điều hướng về `/projects/{projectId}`. | `Enter` trên nút `Delete Session` |
| Bấm hàng phiên trên sidebar | Điều hướng tới `/sessions/{sessionId}`; không gọi command nào ngoài `set_observed_session` của route đích. | `Enter` / `Space` |
| Bấm chevron của một project row | Mở hoặc thu gọn danh sách phiên của project đó, không điều hướng; `aria-expanded` phản ánh trạng thái. | `Enter` / `Space` |
| Bấm tên project trên sidebar | Điều hướng tới `/projects/{projectId}` và mở danh sách phiên của project đó, theo §7.5. | `Enter` / `Space` |
| Bấm hàng phiên hoặc nút `Open` trong khối overview | Điều hướng tới `/sessions/{sessionId}`. | `Enter` / `Space` |
| Đưa cửa sổ chính trở lại foreground | Route phiên chạy lại `get_session`, store sidebar chạy lại `list_sessions`, khối overview chạy lại `list_sessions(projectId)`. | Không có |
| Di chuyển focus bằng `Tab` trong picker | Thứ tự: `Rename session` → `More actions` → từng thẻ `Recently used` → từng thẻ `All tools`, trong thẻ không khả dụng là `Check again` rồi `Open CLI Profiles` → thẻ `Add a CLI profile`. Mọi thành phần focus có viền focus rõ ràng. | `Tab` / `Shift+Tab` |

## Luồng chính

### Tạo phiên và chọn công cụ

1. Người dùng bấm `New Session` trên trang tổng quan project. Hook overview đặt cờ đang tạo để lần bấm thứ hai không tạo hai phiên.
2. `create_session(projectId)` trả `SessionDetailDto`; frontend chỉ giữ `summary.id` và điều hướng tới `/sessions/{id}`.
3. `SessionRoute` mount: gọi `get_session(sessionId)`, gọi `get_project(projectId)` để có `rootPath`, và gọi `set_observed_session(sessionId)`.
4. Vì `tabs` rỗng, route render `SessionToolPicker`; picker đọc catalog qua `get_cli_profiles` và dựng hai khối thẻ.
5. Người dùng chọn một công cụ khả dụng; picker khóa toàn bộ thẻ và gọi `select_session_tool(sessionId, profileId)`.
6. Thành công: frontend ghi `profileId` vào danh sách gần đây, dùng `SessionDetailDto` trả về làm snapshot mới, và route chuyển sang nhánh đã có tab. Backend không tạo process ở lát cắt này.
7. Sidebar và khối overview nhận `sessions://runtime-changed` rồi cập nhật trạng thái phiên mà không cần điều hướng.

### Công cụ không khả dụng và kiểm tra lại

1. Catalog trả một profile có `availability.status` là `commandNotFound` hoặc `shellNotFound`; thẻ hiển thị lý do, badge `Unavailable`, `Check again` và `Open CLI Profiles`, và không chọn được.
2. Người dùng cài CLI hoặc sửa profile ở Settings rồi bấm `Check again`. Frontend gọi `check_cli_profile(profileId)` và đọc lại snapshot vì kết quả của command không mang `revision`.
3. Backend báo `available` thì thẻ trở lại bình thường và chọn được ngay; vẫn không tìm thấy thì thẻ giữ nguyên trạng thái và cập nhật mốc kiểm tra.
4. Nếu thẻ đang là `unchecked` mà `select_session_tool` trả `profileUnavailable`, frontend đánh dấu profile đó không khả dụng tại chỗ, hiển thị đúng khối giải thích, và gọi `check_cli_profile` để snapshot bắt kịp.

### Xóa phiên có cảnh báo

1. Người dùng chọn `Delete Session` từ menu của header phiên hoặc của hàng phiên trên trang tổng quan.
2. Frontend gọi `get_close_impact({ kind: "session", sessionId })` và mở hộp thoại với đúng số tiến trình, số file chưa lưu và nhãn do backend cung cấp.
3. Người dùng bấm `Delete Session`; frontend gọi `close_runtime_target(target, true)`.
4. Nếu backend trả `confirmationRequired` vì blocker mới xuất hiện, hộp thoại render lại facts từ `error.impact` và yêu cầu bấm xác nhận thêm một lần.
5. Thành công: hộp thoại đóng, sidebar và khối overview bỏ phiên đó qua event `deleted`; nếu người dùng đang ở route của phiên vừa xóa thì điều hướng về `/projects/{projectId}`.
6. `contentLifecycleFailed`: hộp thoại giữ nguyên, hiển thị `XWork couldn't stop everything in this session.` và cho bấm lại; lần gọi lại an toàn vì backend bảo đảm thao tác idempotent (chạy lại nhiều lần vẫn ra cùng kết quả).

### Đồng bộ snapshot theo event

1. Store sidebar và hook overview đọc `list_sessions` một lần khi có consumer đầu tiên, rồi đăng ký `sessions://runtime-changed`.
2. Event có `revision` nhỏ hơn hoặc bằng revision đã áp dụng bị bỏ qua.
3. Event `created`, `updated` và `activityChanged` ghi đè summary theo `sessionId`; event `deleted` xóa summary khỏi nhóm project.
4. Nếu `revision` nhảy quá một bậc so với revision đã áp dụng, người đọc gọi lại `list_sessions` thay vì vá state, theo hướng dẫn của `BE-005`.
5. Consumer cuối cùng rời màn hình thì listener bị hủy; đăng ký hoàn tất muộn sau khi rời cũng bị hủy ngay để không còn callback mồ côi.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `list_sessions` | `{ projectId?: string }` | `SessionSummaryDto[]` | `projectNotFound` → làm mới danh sách project và bỏ nhóm phiên đó; `projectLookupFailed` → trạng thái lỗi kèm `Try again`; `unauthorizedWindow` → lỗi tích hợp, không tự thử lại. |
| `get_session` | `{ sessionId: string }` | `SessionDetailDto` | `sessionNotFound` → rời route, không hiển thị lỗi; `unauthorizedWindow` và lỗi lạ → dòng lỗi tải kèm `Try again`. |
| `create_session` | `{ projectId: string }` | `SessionDetailDto` | `projectNotFound` → điều hướng về `/projects`; `projectUnavailable` → chạy lại `get_project` để dựng banner `Unavailable` và giữ câu `Sessions cannot start until the path is valid again.`; `projectLookupFailed` → `XWork couldn't start a session for this project.` kèm `Try again`; `runtimeShuttingDown` → dừng luồng, không thử lại. |
| `rename_session` | `{ sessionId: string, name: string }` | `SessionDetailDto` | `invalidName` → giữ hộp thoại mở và hiện quy tắc tên; `sessionNotFound` → đóng hộp thoại, rời route nếu đang mở phiên đó; `closeInProgress` → `This session is closing.` và khóa nút; `runtimeShuttingDown` → đóng hộp thoại im lặng. |
| `select_session_tool` | `{ sessionId: string, profileId: string }` | `SessionDetailDto` | `profileNotFound` → làm mới catalog và hiện `That tool no longer exists.`; `profileUnavailable` → chuyển thẻ sang trạng thái không khả dụng kèm `Check again`; `profileLookupFailed` → `XWork couldn't check that tool.` kèm `Try again`; `sessionNotEmpty` → đọc lại `get_session` và chuyển sang nhánh đã có tab; `sessionNotFound` → rời route; `closeInProgress` → khóa picker; `runtimeShuttingDown` → dừng luồng. |
| `get_close_impact` | `{ target: CloseTargetDto }` | `CloseImpactDto` | `sessionNotFound` → bỏ luồng xóa và làm mới danh sách; `contentLifecycleFailed` → mở hộp thoại với câu `XWork couldn't check what this session is running.` kèm `Try again`; `unauthorizedWindow` → lỗi tích hợp. |
| `close_runtime_target` | `{ target: CloseTargetDto, confirmed: boolean }` | `CloseResultDto` | `confirmationRequired` → render lại facts từ `impact` và yêu cầu xác nhận lại; `sessionNotFound` → coi như đã xóa, đóng hộp thoại và điều hướng; `closeInProgress` → khóa nút và chờ event; `contentLifecycleFailed` → giữ hộp thoại kèm `Try again`; `runtimeShuttingDown` → đóng hộp thoại im lặng. |
| `set_observed_session` | `{ sessionId: string \| null }` | `SessionSummaryDto \| null` | `sessionNotFound` và `runtimeShuttingDown` → bỏ qua im lặng; mọi lỗi khác cũng không được chặn việc render hoặc điều hướng. |
| `get_cli_profiles` | Không có | `CliProfilesSnapshotDto` | Mọi lỗi → trạng thái catalog lỗi kèm `Try again`. |
| `check_cli_profile` | `{ profileId: string }` | `CliProfileDto` | `profileNotFound` → bỏ thẻ và làm mới catalog; `commandNotFound` và `shellNotFound` → giữ thẻ ở trạng thái không khả dụng với đúng lý do; lỗi khác → giữ thẻ và hiện `XWork couldn't check that tool.` |
| `get_project` | `{ projectId: string }` | `ProjectDto` | `projectNotFound` → điều hướng về `/projects`; lỗi khác → ẩn dòng `Starts in …` thay vì hiển thị đường dẫn sai. |

Mọi command trên chỉ được gọi từ cửa sổ `main`. Cửa sổ `quick-note` của `FE-020` không được dùng bất kỳ wrapper nào trong `src/lib/ipc/sessions.ts`.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `sessions://runtime-changed` | `SessionRuntimeEventDto` | Sau mỗi mutation runtime đã commit và mỗi khi trạng thái tổng hợp của một phiên thực sự đổi. | Sidebar, khối overview và route phiên cập nhật summary theo `sessionId`; `deleted` gỡ hàng và điều hướng nếu đang mở phiên đó; `revision` nhảy bậc thì đọc lại `list_sessions`. |
| `cli-profiles://changed` | `CliProfilesChangedDto` | Khi catalog profile hoặc shell mặc định đổi, kể cả sau khi check nền hoàn tất. | Picker đọc lại `get_cli_profiles`; payload chỉ là tín hiệu vô hiệu hóa, không dùng để vá state. |
| `projects://changed` | `ProjectChangedEventDto` | Khi project được thêm, đổi, hoặc gỡ. | Trang tổng quan và sidebar giữ nguyên hành vi của `FE-004`/`FE-005`; route phiên chỉ dùng event này để làm mới `rootPath` và nhãn project trên breadcrumb. |

Kiểu DTO lấy từ `src/bindings/sessions/sessions.ts`, `src/bindings/terminal/cli-profiles.ts` và `src/bindings/projects/projects.ts`; không định nghĩa lại thủ công.

## State frontend

```ts
// src/features/sessions/sessions-store.ts
export type SessionsStatus = "idle" | "loading" | "ready" | "error";

export interface SessionsState {
  status: SessionsStatus;
  // Summary theo project, giữ đúng thứ tự backend trả về.
  sessionsByProject: Readonly<Record<string, readonly SessionSummaryDto[]>>;
  appliedRevision: string | null;
  failure: SessionsFailure | null;
  consumerCount: number;
  acquire(): void;
  release(): void;
  refresh(): void;
  applyEvent(event: SessionRuntimeEventDto): void;
}

export function readSessionCrumb(
  sessionId: string | undefined,
): { projectId: string; name: string } | null;
export function readSessionProjectId(sessionId: string | undefined): string | null;

// src/features/sessions/use-session-detail.ts
export interface SessionDetailData {
  status: "loading" | "ready" | "missing" | "error";
  detail: SessionDetailDto | null;
  project: ProjectDto | null;
  failure: SessionsFailure | null;
  refresh(): void;
  applyDetail(detail: SessionDetailDto): void;
}

// src/features/sessions/use-tool-catalog.ts
export interface ToolCatalogData {
  status: "loading" | "ready" | "error";
  snapshot: CliProfilesSnapshotDto | null;
  checkingProfileIds: ReadonlySet<string>;
  unavailableProfileIds: ReadonlySet<string>;
  failure: CliProfilesFailure | null;
  refresh(): void;
  check(profileId: string): Promise<void>;
  markUnavailable(profileId: string): void;
}

// src/features/sessions/use-session-lifecycle.ts
export type SessionLifecycleOperation = "rename" | "inspect" | "delete";

export interface SessionLifecycle {
  pending: SessionLifecycleOperation | null;
  impact: CloseImpactDto | null;
  failure: SessionsFailure | null;
  rename(sessionId: string, name: string): Promise<boolean>;
  inspect(sessionId: string): Promise<boolean>;
  confirmDelete(sessionId: string): Promise<boolean>;
  reset(): void;
}

// src/features/sessions/recent-tools-store.ts
export interface RecentToolUse {
  profileId: string;
  usedAtMs: number;
}

export function recordToolUse(profileId: string, atMs: number): void;
export function readRecentTools(limit: number): readonly RecentToolUse[];
export function formatUsedAt(usedAtMs: number, nowMs: number): string;

// src/lib/utils/session-status.ts
export type SessionStatusTone = "idle" | "running" | "unread" | "attention" | "done" | "error";
export function describeSessionStatus(
  status: SessionStatusDto,
): { tone: SessionStatusTone; label: string };
export function describeSessionMeta(summary: SessionSummaryDto): string;

// src/lib/utils/session-copy.ts
export type SessionsFailureKind = "missing" | "invalidName" | "busy" | "integration" | "unknown";
export interface SessionsFailure {
  kind: SessionsFailureKind;
  code: SessionsError["code"] | "unknown";
  message: string;
  canRetry: boolean;
}
export function classifySessionsFailure(rejection: unknown): SessionsFailure;
export function validateSessionName(raw: string): { isValid: boolean; value: string };
export function buildDeleteSessionFacts(impact: CloseImpactDto): readonly string[];
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `sessionsByProject`, `appliedRevision` | Backend qua `list_sessions` và `sessions://runtime-changed` | Không cache lâu dài: đọc lại khi cửa sổ focus, khi `revision` nhảy bậc và khi consumer đầu tiên quay lại. |
| `detail` của route | Backend qua `get_session` và kết quả trả về của mutation | Chỉ giữ cho `sessionId` hiện tại; token vô hiệu hóa mọi kết quả đến muộn sau khi đổi route. |
| `project` của route | Backend qua `get_project` | Chỉ dùng cho `rootPath` và nhãn breadcrumb; không đụng `last_opened_at_ms`. |
| `snapshot` catalog | Backend qua `get_cli_profiles` | Đọc lại toàn bộ khi có `cli-profiles://changed`; không vá theo payload. |
| `unavailableProfileIds` | UI tạm thời | Chỉ sống đến lần đọc snapshot kế tiếp; dùng để hiển thị ngay khi `select_session_tool` trả `profileUnavailable`. |
| `recentTools` | UI tạm thời | Trong bộ nhớ, tối đa bốn mục, khử trùng lặp theo `profileId`, mất khi thoát ứng dụng. |
| `pending`, `impact`, `failure` | UI tạm thời | Reset khi hộp thoại đóng; `impact` luôn lấy lại từ backend, không suy ra từ summary. |
| `expandedProjectIds` của sidebar | UI tạm thời | Thuộc `SidebarProjectList`; project của route hiện tại luôn được mở. |

## Contract công khai của feature

```ts
// src/features/sessions/session-route.tsx
export function SessionRoute(): JSX.Element;

// src/features/sessions/sidebar-session-rows.tsx
export function SidebarSessionRows(props: { projectId: string }): JSX.Element;

// src/features/sessions/sessions-store.ts
export const useSessionsStore: UseBoundStore<StoreApi<SessionsState>>;
export function readSessionCrumb(
  sessionId: string | undefined,
): { projectId: string; name: string } | null;
export function readSessionProjectId(sessionId: string | undefined): string | null;

// src/features/projects/sidebar-project-list.tsx
export function SidebarProjectList(props: {
  activeProjectId?: string | null;
  renderSessionRows?: (project: ProjectDto) => ReactNode;
}): JSX.Element;

// src/features/projects/project-session-list.tsx
export function ProjectSessionList(props: {
  projectId: string;
  isProjectUnavailable: boolean;
  onCreateSession(): void;
}): JSX.Element;
```

Chỉ `src/app/` được dùng bốn export đầu. Feature `projects` và feature `sessions` không import lẫn nhau; `ProjectSessionList` là export nội bộ của feature `projects` dành cho `ProjectOverviewRoute`.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Phiên đang mở bị xóa từ trang tổng quan hoặc bị gỡ theo project | Event `deleted` tới route; route đóng mọi hộp thoại đang mở và điều hướng về `/projects/{projectId}`, không hiển thị thông điệp lỗi riêng. |
| Project của phiên bị gỡ trong lúc đang xem phiên | `BE-003` đóng toàn bộ phiên của project; route nhận `deleted` và điều hướng về `/projects`. |
| Bấm `New Session` hai lần rất nhanh | Cờ đang tạo chặn lần thứ hai; đúng một phiên được tạo và đúng một lần điều hướng xảy ra. |
| Bấm hai thẻ công cụ gần như cùng lúc | Picker khóa toàn bộ thẻ ngay khi lệnh đầu tiên bắt đầu; lần bấm thứ hai không gọi command. |
| `select_session_tool` trả `sessionNotEmpty` vì phiên đã có tab từ nơi khác | Route đọc lại `get_session` và chuyển sang nhánh đã có tab; không hiện lỗi cho người dùng. |
| Đăng ký `sessions://runtime-changed` thất bại | Ghi nhận cờ listener lỗi; dữ liệu vẫn đúng nhờ đọc lại khi cửa sổ focus và sau mỗi mutation; giao diện không hiển thị lỗi kỹ thuật. |
| `revision` của event nhảy bậc do một event bị mất | Người đọc gọi lại `list_sessions` thay vì vá state, nên danh sách không kẹt ở snapshot cũ. |
| Tên phiên rất dài hoặc chứa ký tự Unicode rộng | Mọi nơi hiển thị đều cắt ellipsis một dòng và đặt `title` là tên đầy đủ; đếm độ dài theo Unicode scalar value, không theo `String.length`. |
| Người dùng nhập tên chỉ gồm khoảng trắng | Nút `Rename` bị khóa trước khi gọi command; nếu backend vẫn trả `invalidName`, hộp thoại hiện đúng quy tắc tên. |
| `get_close_impact` trả `requiresConfirmation: false` cho một phiên | Hộp thoại vẫn mở vì xóa phiên luôn cần xác nhận; hộp facts khi đó không render dòng nào. |
| Impact có rất nhiều nhãn tiến trình hoặc file | Hộp facts liệt kê tối đa năm nhãn mỗi dòng rồi thêm `+{n} more`; số đếm luôn lấy từ `runningProcessCount` và `unsavedFileCount`. |
| `check_cli_profile` chạy trong lúc `cli-profiles://changed` tới | Kết quả check chỉ dùng để bỏ cờ đang kiểm tra; nguồn hiển thị vẫn là snapshot vừa đọc lại. |
| Profile bị xóa ở Settings trong lúc picker đang mở | Event catalog làm thẻ biến mất; nếu người dùng vừa kịp chọn, `profileNotFound` làm picker đọc lại catalog và hiện `That tool no longer exists.` |
| Sidebar bị thu gọn thành dạng icon | Khối `Projects` không render nên hàng phiên cũng không render; store được giải phóng theo consumer nên không rò listener. |
| Cửa sổ bị ẩn xuống tray rồi mở lại | Không gọi `set_observed_session` thêm lần nào; backend tự theo dõi visibility, frontend chỉ đọc lại snapshot khi focus. |
| Rời route phiên sang Home hoặc Settings | Gọi `set_observed_session(null)` đúng một lần; lỗi của lệnh này không chặn việc điều hướng. |
| Backend trả `unauthorizedWindow` | Hiển thị dòng lỗi tích hợp và không tự thử lại; đây là lỗi ở ranh giới cửa sổ, không phải lỗi người dùng. |

## Tiêu chí hoàn thành

- [ ] Bấm `New Session` trên trang tổng quan tạo đúng một phiên, điều hướng tới `/sessions/{id}`, và phiên xuất hiện ngay trên sidebar dưới đúng project với trạng thái `No tool chosen`.
- [ ] Route `/sessions/:sessionId` render màn hình chọn công cụ khi phiên chưa có tab và render chỗ trống của `FE-007` khi phiên đã có tab; breadcrumb là `Projects / {tên project} / {tên phiên}`.
- [ ] Màn hình chọn công cụ chỉ hiển thị `Recently used` khi lần chạy hiện tại đã dùng ít nhất một công cụ, và `All tools` theo đúng thứ tự Codex, Claude, Terminal rồi custom.
- [ ] Thẻ `builtin:terminal` hiển thị lệnh của shell hiệu lực kèm hậu tố `default shell` khi profile không có shell riêng.
- [ ] Chọn một công cụ khả dụng gọi `select_session_tool` đúng một lần, ghi công cụ vào danh sách gần đây và chuyển route sang nhánh đã có tab mà không tạo process nào.
- [ ] Profile có `commandNotFound` hiển thị `Command not found: {command}`, badge `Unavailable`, `Check again` và `Open CLI Profiles`; bấm thẻ đó không gọi `select_session_tool`.
- [ ] `Check again` gọi `check_cli_profile` rồi đọc lại snapshot; profile trở lại `available` thì chọn được ngay trong cùng lần chạy.
- [ ] Phím `1`–`9` chọn đúng thẻ khả dụng theo thứ tự hiển thị và chỉ đưa focus khi thẻ đó không khả dụng.
- [ ] Đổi tên phiên áp dụng quy tắc `1`–`80` Unicode scalar value, không ký tự điều khiển, cho phép tên trùng; tên mới xuất hiện trên header, sidebar, breadcrumb và khối overview.
- [ ] Xóa phiên luôn mở hộp thoại xác nhận với nhãn `Delete Session`, hộp facts đúng số tiến trình và số file chưa lưu do `get_close_impact` trả về.
- [ ] `confirmationRequired` trả về lúc commit làm hộp thoại render lại facts mới và yêu cầu xác nhận thêm một lần trước khi xóa.
- [ ] Xóa thành công phiên đang mở điều hướng về `/projects/{projectId}`; xóa từ trang tổng quan chỉ gỡ hàng mà không điều hướng.
- [ ] Sidebar hiển thị đủ sáu trạng thái phiên, mỗi chấm kèm nhãn chữ đọc được bằng trình đọc màn hình, và hàng của route hiện tại có nền được chọn.
- [ ] Chevron của project row mở và thu gọn danh sách phiên bằng chuột lẫn bàn phím với `aria-expanded` đúng; bấm tên project vừa điều hướng vừa mở danh sách.
- [ ] Khối `Sessions in this run` có đủ trạng thái rỗng, đang tải và lỗi kèm `Try again`, và mỗi hàng mở được phiên tương ứng.
- [ ] `set_observed_session` được gọi với `sessionId` khi vào route phiên và với `null` khi rời; không gọi thêm khi ẩn cửa sổ xuống tray.
- [ ] Sidebar, khối overview và route phiên cùng cập nhật theo `sessions://runtime-changed` và đọc lại `list_sessions` khi `revision` nhảy bậc.
- [ ] Không có `localStorage`, `sessionStorage` hoặc `indexedDB` nào được thêm; tìm trong `src/` không ra kết quả mới.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` và `pnpm test` pass trên Windows.
- [ ] Smoke thủ công trên Windows bằng `pnpm tauri dev`: tạo hai phiên cho hai project khác nhau, đổi tên một phiên, xóa một phiên, và xác nhận sidebar cùng trang tổng quan hiển thị đúng trạng thái sau mỗi thao tác.
- [ ] Không cần `pnpm tauri build` cho lát cắt này vì không có thay đổi ở capability, invoke handler, bundling hay tích hợp desktop; nếu quá trình triển khai buộc phải đụng những phần đó thì phải chạy `pnpm tauri build` trước khi kết thúc.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/sessions/session-route.test.tsx` | Component | Hai nhánh nội dung theo `tabs.length`; skeleton; lỗi tải kèm `Try again`; điều hướng khi `sessionNotFound` và khi nhận event `deleted`; `set_observed_session` gọi đúng khi vào và khi rời route. |
| `src/features/sessions/session-tool-picker.test.tsx` | Component | Ẩn và hiện khối `Recently used`; thứ tự thẻ; phím số chọn và phím số chỉ đưa focus; khóa thẻ khi đang chọn; ánh xạ từng lỗi của `select_session_tool`. |
| `src/features/sessions/session-tool-card.test.tsx` | Component | Dòng phụ cho lệnh có và không có tham số; hậu tố `default shell`; nhánh `commandNotFound` và `shellNotFound`; `Check again` và liên kết Settings. |
| `src/features/sessions/use-tool-catalog.test.ts` | Unit | Đọc snapshot; đọc lại theo `cli-profiles://changed`; cờ đang kiểm tra; `markUnavailable` bị xóa sau lần đọc snapshot kế tiếp; hủy listener. |
| `src/features/sessions/recent-tools-store.test.ts` | Unit | Khử trùng lặp theo `profileId`; giới hạn bốn mục; thứ tự mới nhất trước; nhãn `just now`, `{n}m ago`, `{n}h ago`. |
| `src/features/sessions/sessions-store.test.ts` | Unit | Nhóm theo project; áp `created`, `updated`, `activityChanged`, `deleted`; bỏ event có revision cũ; đọc lại khi revision nhảy bậc; `acquire`/`release` hủy listener. |
| `src/features/sessions/sidebar-session-rows.test.tsx` | Component | Chấm kèm chữ ẩn thị giác cho sáu trạng thái; điều hướng đúng `sessionId`; trạng thái rỗng không render hàng; trạng thái lỗi có `Try again`. |
| `src/features/sessions/use-session-detail.test.ts` | Unit | Token chống kết quả cũ khi đổi `sessionId`; đồng bộ theo event; làm mới khi focus; nuốt lỗi của `set_observed_session`. |
| `src/features/sessions/use-session-lifecycle.test.ts` | Unit | Đổi tên thành công và `invalidName`; luồng impact rồi xóa; `confirmationRequired` lần hai; `contentLifecycleFailed` cho retry; chống gọi trùng. |
| `src/features/sessions/rename-session-dialog.test.tsx` | Component | Giá trị tiền điền; khóa nút khi tên không hợp lệ; thông điệp lỗi backend; trả focus khi đóng. |
| `src/features/sessions/delete-session-dialog.test.tsx` | Component | Tiêu đề chứa tên phiên; facts số ít và số nhiều; ẩn dòng facts khi số bằng `0`; `+{n} more`; hủy không gọi command. |
| `src/features/projects/project-session-list.test.tsx` | Component | Ánh xạ trạng thái và dòng meta; rỗng, đang tải, lỗi; nút `Open`; menu mở đúng hai hộp thoại. |
| `src/features/projects/use-project-sessions.test.ts` | Unit | `list_sessions(projectId)`; chỉ áp event của project đó; `create_session` chống gọi trùng và điều hướng; đổi tên; xóa; phân loại lỗi. |
| `src/features/projects/project-overview-header.test.tsx` | Component | Nút `New Session` hoạt động; khóa khi project `Unavailable` với đúng tooltip; khóa khi đang tạo. |
| `src/features/projects/project-overview-route.test.tsx` | Component | Khối phiên được dựng đúng vị trí; hai điểm vào `New Session` dùng chung một luồng. |
| `src/features/projects/sidebar-project-list.test.tsx` | Component | Chevron mở và thu gọn cùng `aria-expanded`; slot hàng con nhận đúng project; project của route hiện tại tự mở; không truyền slot thì hành vi cũ không đổi. |
| `src/lib/ipc/sessions.test.ts` | Unit | Tên tám command và một event; tham số camelCase; ánh xạ rejection thành `IpcCallError` có payload typed. |
| `src/lib/utils/session-status.test.ts` | Unit | Sáu trạng thái ra đúng tone và nhãn; dòng meta số ít, số nhiều và nhánh có tiến trình đang chạy. |
| `src/lib/utils/session-copy.test.ts` | Unit | Kiểm tra tên theo Unicode scalar value và ký tự điều khiển; phân loại từng mã lỗi `SessionsError`; câu chữ và facts của hộp thoại xóa. |
| `src/app/app-router.test.tsx` | Component | Route phiên render `SessionRoute`; breadcrumb ba cấp dùng tên project và tên phiên. |
| `src/app/app-sidebar.test.tsx` | Component | Slot hàng phiên được truyền xuống; `activeProjectId` đúng cho cả route project và route phiên. |
| `src/app/app-topbar.test.tsx` | Component | Nhãn breadcrumb phiên đổi khi snapshot phiên đổi mà route không đổi. |

## Câu hỏi mở

- Không có.
