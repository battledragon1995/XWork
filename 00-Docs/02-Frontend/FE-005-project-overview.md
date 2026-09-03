# FE-005 — Project Overview

Tài liệu này đặc tả trang tổng quan một project ở mức contract: header với branch và Git status chỉ đọc, điểm vào `New Session`, danh sách phiên của lần chạy hiện tại, và cách trang lấy cũng như làm mới dữ liệu từ backend.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-005` |
| Phase | `1` |
| Khu vực chính | `src/features/projects/` |
| Yêu cầu chức năng | §7.5; liên quan §7.2–7.4, §8.1–8.3 và §18 |
| Wireframe | `04-Projects.html#overview` |
| Backend liên quan | `BE-003`, `BE-004`, `BE-005` |
| Phụ thuộc | `FE-001`, `FE-004` |

## Mục tiêu

Sau khi feature hoàn thành, người dùng mở một project từ sidebar, trang Projects hoặc ngay sau khi thêm project và thấy tổng quan của project đó: tên, đường dẫn, branch và Git status chỉ đọc kèm danh sách file thay đổi; từ đây người dùng tạo phiên mới và mở bất kỳ phiên nào đang tồn tại trong lần chạy hiện tại.

### Quyết định và giả định đã chốt

- FE-005 sở hữu `element` của route `/projects/:projectId`; `app-router.tsx` thay `AreaPlaceholder` bằng `ProjectOverviewRoute`. Crumb thứ hai của route đổi từ `projectId` thô sang tên hiển thị: bảng route gọi `readProjectCrumbLabel(projectId)` do feature export, và `AppTopbar` subscribe snapshot project của `useProjectsStore` để nhãn đổi theo rename mà không cần điều hướng. FE-001 đã thiết lập nguyên tắc này ở Edge case của shell — route phiên sẽ do feature sau "thay bằng tên project và tên phiên" thay vì giữ `sessionId` thô — nên việc áp dụng nguyên tắc tương tự cho route project là mở rộng dự kiến, không phải contract mới của shell.
- Trang ghi nhận lần mở bằng `open_project` đúng một lần khi route mount: command cập nhật `last_opened_at_ms`, phát `Updated` và trả `ProjectDto` mới nhất làm dữ liệu header. Mọi lần làm mới sau đó dùng `get_project` đọc thuần để không đẩy `last_opened_at_ms` khi người dùng chỉ quay lại focus cửa sổ.
- Git dùng một query duy nhất `get_project_git_status` của `BE-004`: header render từ `summary`, khối `Changes on {head}` render từ `changes`. Git chỉ có tính chất đọc; trang không có bất kỳ thao tác Git ghi nào và dòng chú thích read-only luôn hiện dưới danh sách thay đổi.
- Khối phiên và nút `New Session` thuộc contract của FE-005 nhưng dữ liệu và command đến từ `BE-005`, theo thiết kế đã chốt ở `BE-005-sessions-runtime.md`. Ở giai đoạn 5, trang render nút `New Session` tại đúng vị trí của wireframe nhưng đặt `aria-disabled="true"`; nút vẫn nhận focus để tooltip `Session creation isn't available yet.` giải thích vì sao chưa thể dùng. Khối `Sessions in this run` chưa render khi chưa có binding `src/bindings/sessions/`. Từ giai đoạn 8, khi `BE-005` và binding đã có, nút được kích hoạt và khối phiên được render bằng dữ liệu thật.
- Hàng phiên trong khối phiên chỉ hiển thị trạng thái, tên, thông tin tóm tắt và hành động mở. Menu `Rename or delete session` vẽ trong wireframe `#overview` thuộc vòng đời phiên của `FE-006` (wireframe `#dlg-delete-session` cũng được gán cho `FE-006`); lát cắt giai đoạn 8 sẽ mở rộng hàng này với menu của riêng nó theo quy tắc "màn hình tổng hợp được mở rộng tại lát cắt sở hữu dữ liệu mới".
- Cột phải của wireframe (`Recent files`, `Notes linked`, `Events linked`) không thuộc tài liệu này: các khối được thêm bởi `BE-014`/`FE-017` (giai đoạn 16), `BE-016`/`FE-019` (giai đoạn 18) và `BE-018`/`FE-022` (giai đoạn 20). Cho đến khối đầu tiên xuất hiện, trang render một cột duy nhất; bố cục `split-7-5` chỉ có hiệu lực khi cột phải có ít nhất một khối.
- `Copy path` dùng `navigator.clipboard.writeText(rootPath)` — web API của webview, không cần capability hay plugin Tauri mới, không đụng boundary backend. `BE-003` không có command copy-path và requirement không yêu cầu gì hơn nút này trong wireframe.
- Nút mở folder trong header dùng nhãn đa nền tảng `Open folder`, thống nhất với FE-004; backend vẫn gọi file manager mặc định của hệ điều hành qua `open_project_folder`.
- Header tái sử dụng các thành phần FE-004 đã có trong cùng feature: `ProjectActionsMenu` (component được viết để dùng lại từ overview), `RenameProjectDialog`, `RemoveProjectDialog`, `use-project-actions` và bảng phân loại lỗi trong `project-error-copy.ts`. `useProjectActions` được mở rộng bằng callback tùy chọn `onUnavailable` để overview chạy lại `get_project` ngay khi `open_project_folder` phát hiện root vừa mất khả dụng; hành vi của FE-004 không đổi khi không truyền callback. Sau khi gỡ project thành công, overview điều hướng về `/projects`; sau khi rename/ghim/locate, header làm mới qua `projects://changed`.
- `projectUnavailable` là tín hiệu availability mới hơn snapshot đang hiển thị, không phải lỗi có thể bỏ qua. Khi Git query, `create_session` hoặc `open_project_folder` trả variant này, overview chạy lại `get_project`; kết quả làm header chuyển sang trạng thái `Unavailable`, khóa hành động phụ thuộc root và giữ thông điệp riêng của thao tác vừa thất bại.
- Thông tin tóm tắt mỗi hàng phiên chỉ render từ `SessionSummaryDto` của `BE-005`: nhãn trạng thái, số tab và số tiến trình đang chạy. Wireframe vẽ thêm tên công cụ và thời gian (`Claude · waiting for input · 2m`) nhưng các field đó không có trong DTO; phần chi tiết đó thuộc màn hình phiên của `FE-006`.

### Ngoài phạm vi

- Mọi thao tác Git ghi: commit, checkout, push, stage, stash; xem diff, lịch sử, remote hay ahead/behind.
- Màn hình phiên, chọn công cụ, tab/pane, đổi tên và xóa phiên có cảnh báo (`FE-006`, `FE-007`); overview chỉ tạo và điều hướng tới phiên.
- Hàng phiên con và chevron mở rộng trên sidebar (`FE-006`, wireframe `#sidebar-sessions`). Bấm hàng project trên sidebar vẫn chỉ điều hướng tới `/projects/:projectId` như FE-004 đã triển khai.
- Gọi `set_observed_session`: việc đánh dấu output đã xem là của route phiên (`FE-006`), không phải của overview.
- Khối file mở gần đây, note liên kết và event liên kết (giai đoạn 16, 18, 20) cùng các hành động `New note`, `New event` trong wireframe.
- Mở file từ danh sách thay đổi Git: hàng thay đổi là văn bản tĩnh; hành vi mở file thuộc Phase 2 (`FE-016`–`FE-018`).
- Terminal render, stream output và vòng đời tiến trình (`FE-008`, `BE-007`).

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/projects/project-overview-route.tsx` | Điểm vào route `/projects/:projectId`: sở hữu layout, dựng header, khối Git, khối phiên, ghép hai hộp thoại dùng lại và xử lý điều hướng. |
| `src/features/projects/project-overview-header.tsx` | Header trang và `ProjectUnavailableBanner`: tên kèm chỉ báo ghim/badge unavailable, đường dẫn với `Copy path` và `Open folder`, dòng branch/Git summary, mốc thời gian, cụm hành động và banner khắc phục khi root không khả dụng. |
| `src/features/projects/project-git-changes.tsx` | Khối `Changes on {head}`: badge phân loại, path/previous path lấy nguyên từ DTO, trạng thái clean và dòng chú thích read-only. |
| `src/features/projects/project-session-list.tsx` | Khối `Sessions in this run`: hàng phiên với dot trạng thái, tên, thông tin tóm tắt và hành động mở; trạng thái rỗng/đang tải/lỗi. |
| `src/features/projects/use-project-overview.ts` | Hook dữ liệu project và Git: `open_project` khi mount, `get_project` + `get_project_git_status` khi focus và khi nhận `projects://changed`; token chống kết quả cũ. |
| `src/features/projects/use-project-sessions.ts` | Hook dữ liệu phiên: `list_sessions(projectId)`, đăng ký `sessions://runtime-changed`, luồng `create_session` kèm chặn gọi trùng và phân loại `SessionsError`. |
| `src/features/projects/projects-store.ts` | Thêm `readProjectCrumbLabel(projectId)` đọc tên hiển thị từ snapshot hiện tại của store cho route crumb; đồng thời đưa `useProjectsStore` thành public entry để topbar subscribe. |
| `src/features/projects/use-project-actions.ts` | Dùng lại năm thao tác của menu header; bổ sung callback tùy chọn `onUnavailable`, overview truyền callback này để refresh metadata và truyền `onRemoved` để điều hướng về `/projects`. |
| `src/features/projects/project-actions-menu.tsx` | Dùng lại nguyên trạng làm menu `More actions` của header. |
| `src/features/projects/rename-project-dialog.tsx` | Dùng lại nguyên trạng cho luồng đổi tên từ menu header. |
| `src/features/projects/remove-project-dialog.tsx` | Dùng lại nguyên trạng cho luồng gỡ project từ menu header. |
| `src/features/projects/project-error-copy.ts` | Dùng lại các bảng phân loại và thông điệp hiện có; bổ sung phân loại lỗi Git của trang này theo cùng quy ước. |
| `src/lib/ipc/projects.ts` | Bổ sung wrapper `getProject`, `openProject` và `getProjectGitStatus` cho command đã có của `BE-003`/`BE-004`. |
| `src/lib/ipc/sessions.ts` | Wrapper `listSessions`, `createSession` và `onSessionsRuntimeChanged` theo contract `BE-005`; chỉ khả dụng khi binding sessions đã sinh. |
| `src/app/app-router.tsx` | Route `/projects/:projectId` trỏ `element` sang `ProjectOverviewRoute`; crumb thứ hai dùng `readProjectCrumbLabel`. |
| `src/app/app-topbar.tsx` | `Breadcrumb` subscribe danh sách project của `useProjectsStore` để nhãn crumb làm mới khi tên project đổi mà route không đổi. |
| `src/features/projects/project-overview-route.test.tsx` | Test route: các trạng thái tải, dựng đủ khối, điều hướng, ghép menu và hộp thoại. |
| `src/features/projects/project-overview-header.test.tsx` | Test header: các nhánh Git, unavailable, copy path, thời gian, khóa nút. |
| `src/features/projects/project-git-changes.test.tsx` | Test khối thay đổi: badge, previous path, directory, clean, lỗi và retry. |
| `src/features/projects/project-session-list.test.tsx` | Test khối phiên: ánh xạ trạng thái, rỗng, đang tải, lỗi, mở phiên. |
| `src/features/projects/use-project-overview.test.ts` | Test hook: thứ tự command, token, focus, event, lỗi. |
| `src/features/projects/use-project-sessions.test.ts` | Test hook: query, event, tạo phiên, chặn trùng, phân loại lỗi. |
| `src/features/projects/use-project-actions.test.ts` | Bổ sung test callback `onUnavailable`; xác nhận FE-004 không đổi hành vi khi callback không được truyền. |
| `src/features/projects/projects-store.test.ts` | Bổ sung test cho `readProjectCrumbLabel` (tìm thấy, không tìm thấy, undefined). |
| `src/lib/ipc/projects.test.ts` | Bổ sung test ba wrapper mới: tên command, tham số camelCase, ánh xạ lỗi typed. |
| `src/lib/ipc/sessions.test.ts` | Test tên command, hình dạng tham số `projectId`, tên event `sessions://runtime-changed` và ánh xạ lỗi typed. |
| `src/app/app-router.test.tsx` | Bổ sung: route `/projects/:projectId` render `ProjectOverviewRoute`; crumb mang tên hiển thị. |
| `src/app/app-topbar.test.tsx` | Bổ sung: nhãn crumb dựa trên store và làm mới khi snapshot project đổi. |

Feature không thêm dependency mới, không sửa file Rust, migration, `src-tauri/capabilities/main.json`, `src-tauri/tauri.conf.json` hay bất kỳ file trong `src/bindings/`. Binding projects đã sinh sẵn từ `BE-004`; binding sessions đến cùng `BE-005`.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `ProjectOverviewRoute` | Điểm vào route. Vùng `page` padding `28px 32px`, không cuộn ngang; nội dung cuộn dọc trong vùng nội dung. Một cột duy nhất cho đến khi cột phải có khối đầu tiên; khi đó dùng lưới `7fr 5fr` cách `24px`. | `04-Projects.html#overview` |
| `ProjectOverviewHeader` | Khối header dạng `page-head`, căn theo mép trên. Trái: hàng tên (`display-sm`) kèm icon ghim có chữ ẩn thị giác `Pinned` khi `isPinned` và badge `Unavailable` khi root không khả dụng; dòng đường dẫn mono `12px` cắt ellipsis kèm `title` là đường dẫn đầy đủ, sau đó hai nút icon `Copy path` và `Open folder`; dòng Git `13px`: icon branch, badge tên branch, summary, rồi `· added {ngày} · opened {thời gian}` màu mềm. Phải: cụm hành động gồm nút primary `New Session` và nút icon `More actions`. | `04-Projects.html#overview`, `#unavailable` |
| `ProjectUnavailableBanner` | Banner cảnh báo ngay dưới header: icon cảnh báo, lý do availability, câu `Sessions cannot start until the path is valid again.`, nút secondary `Locate folder…` và nút destructive `Remove Project`. Hai nút gọi cùng luồng của menu header, không tạo command hoặc dialog thứ hai. | `04-Projects.html#unavailable` |
| `ProjectGitChanges` | Khối dưới sessions trong cột trái: nhãn khối `Changes on {head} ({changedCount})`, danh sách mono dạng dày, mỗi hàng có badge rộng cố định và path; dưới cùng là dòng `Read-only. Commit, checkout and push happen in your terminal.` | `04-Projects.html#overview` |
| `ProjectSessionList` | Khối đầu cột trái: nhãn khối `Sessions in this run` kèm chú thích `Not restored after Quit` ở góc phải; danh sách hàng gồm dot trạng thái, tên weight `500`, dòng meta `12px` màu muted và nút `Open` secondary nhỏ bên phải. | `04-Projects.html#overview` |
| `ProjectActionsMenu` | Menu `More actions` của header với đúng năm item, thứ tự và hành vi như trên card của FE-004. | `04-Projects.html#overview` |
| `RenameProjectDialog`, `RemoveProjectDialog` | Hai hộp thoại dùng lại nguyên trạng từ FE-004; overview là nơi gọi chúng từ menu header. | `04-Projects.html#dlg-remove-project` |

Nội dung chữ cố định:

- Nhãn khối phiên: `Sessions in this run`; chú thích: `Not restored after Quit`.
- Nhãn khối thay đổi: `Changes on {head} ({changedCount})` với `{head}` là nhãn head (xem bảng dưới).
- Chú thích read-only: `Read-only. Commit, checkout and push happen in your terminal.`
- Trạng thái clean: `Working tree is clean.`
- Trạng thái rỗng phiên: `No sessions in this run yet.` kèm câu `Start one to work in this project.` và nút secondary `New Session`.
- Nút: `New Session`, `Open`, `Copy path`, `Open folder`, `More actions`, `Locate folder…`, `Remove Project`, `Try again`.

Ánh xạ hiển thị Git:

| Dữ liệu | Hiển thị |
|---|---|
| `repositoryKind: "notRepository"` | Dòng Git thành `Not a Git repository`; không có badge, không có khối thay đổi, không có mốc `added/opened` bị ẩn (mốc thời gian vẫn hiện). |
| `repositoryKind: "bare"` | Dòng Git thành `Bare repository`; nếu `head` có giá trị thì badge nhãn head vẫn hiện; không có khối thay đổi. |
| `head.kind: "branch"` | Badge tên branch; nhãn khối dùng đúng tên branch. |
| `head.kind: "unborn"` | Badge `{name}` kèm dòng phụ `no commits yet`; nhãn khối dùng `{name}`. |
| `head.kind: "detached"` | Badge `({shortOid})`; nhãn khối dùng `{shortOid}`. |
| `changedCount === 0` | Summary là `clean`; khối thay đổi render nhãn khối với `(0)` và dòng `Working tree is clean.` |
| `changedCount > 0` | Summary là `{changedCount} changed`; nối thêm ` · {untrackedCount} untracked` chỉ khi `untrackedCount > 0`. |
| `GitFileChangeKindDto` | Badge lần lượt `A`, `M`, `D`, `R`, `C`, `T`, `??`, `U`; badge có chữ ẩn thị giác là tên đầy đủ (`Added`, `Modified`, `Deleted`, `Renamed`, `Copied`, `Type changed`, `Untracked`, `Conflicted`). |
| `previousPath` khác `null` | Hàng hiển thị `{previousPath} → {path}`. |
| `isDirectory === true` | Render nguyên `path`; backend đã bảo đảm untracked directory có `/` ở cuối nên frontend không nối thêm ký tự. `isDirectory` chỉ dùng cho semantics và kiểm thử invariant. |

Ánh xạ trạng thái phiên (`SessionStatusDto` → dot + nhãn meta):

| Trạng thái | Dot | Nhãn meta |
|---|---|---|
| `noToolYet` | xám nhạt | `No tool chosen` |
| `running` | xanh | `Running` |
| `unseenOutput` | chấm chưa đọc | `New output` |
| `needsAttention` | cam chú ý | `Needs attention` |
| `finished` | xám trung tính | `Finished` |
| `exitedWithError` | đỏ lỗi | `Exited with an error` |

Dòng meta hoàn chỉnh: `{nhãn trạng thái} · {tabCount} tab|tabs`, thêm ` · {runningProcessCount} process|processes` khi `runningProcessCount > 0`. Dot luôn đi kèm nhãn chữ; màu không là kênh thông tin duy nhất.

Định dạng mốc thời gian bằng `Intl.DateTimeFormat` tiếng Anh, đặt trong header:

- `added`: `added {d} {MMM}` (ví dụ `added 1 Sep`); thêm năm khi khác năm hiện tại.
- `opened`: `opened just now` dưới 1 phút, `opened {n}m ago` dưới 1 giờ, `opened {n}h ago` dưới 24 giờ, `opened yesterday` cho ngày hôm trước, còn lại `opened {d} {MMM}` (thêm năm khi khác năm hiện tại).

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang tải project | Route mount và chưa có `ProjectDto` của lần tải này. | Skeleton header: một khối chữ cao tương đương tên, một dòng mờ cho đường dẫn và một dòng mờ cho Git; không render nút hành động. |
| Tải project lỗi | `open_project` trả `clockFailed` hoặc `persistenceFailed`. | Thay toàn bộ trang bằng dòng lỗi `XWork couldn't open this project.` kèm nút `Try again` chạy lại từ đầu. |
| Project không tồn tại | `open_project`/`get_project` trả `projectNotFound` hoặc `removalInProgress`. | Không hiển thị lỗi: điều hướng về `/projects`; danh sách ở đó đã được `projects://changed` làm mới. |
| Sẵn sàng | Có `ProjectDto` và availability `Available`. | Header đầy đủ; khối Git và phiên chạy theo trạng thái riêng của chúng. |
| Unavailable | `ProjectDto.availability.status === "unavailable"`. | Header có badge `Unavailable`; banner hiển thị một trong bốn lý do của FE-004 (`Folder not found.`, `That path is no longer a folder.`, `XWork can't read that folder.`, `XWork couldn't check that folder.`), câu giải thích và hai nút trực tiếp `Locate folder…`/`Remove Project`; không query Git và không render khối thay đổi; `New Session` bị khóa với tooltip `The project folder is unavailable.`; `Open folder` bị khóa; hai hành động khắc phục vẫn có cả trong menu; khối phiên vẫn tải và hiển thị vì `BE-005` không chặn đọc session của project unavailable. |
| Git đang tải | `get_project_git_status` đang chạy và chưa có snapshot. | Skeleton ngang ở vị trí dòng Git và khối thay đổi. |
| Git lỗi | `gitInspectionFailed`. | Dòng Git: `Git status unavailable`; dưới vị trí khối thay đổi là dòng `XWork couldn't read Git status for {displayName}.` kèm nút `Try again` gọi lại đúng command này. |
| Git sạch | `worktree` và `changedCount === 0`. | Summary `clean`; khối thay đổi hiện `Working tree is clean.` |
| Phiên đang tải | `list_sessions` đang chạy và chưa có danh sách. | Hai hàng skeleton trong khối phiên. |
| Phiên rỗng | Danh sách rỗng sau khi tải xong. | Câu rỗng và nút secondary `New Session` (cùng luồng với nút header). |
| Phiên lỗi | `projectLookupFailed`. | `XWork couldn't load sessions for this project.` kèm `Try again`; phần còn lại của trang không bị ảnh hưởng. |
| Đang tạo phiên | `create_session` đang chạy. | Cả hai nút `New Session` bị khóa và giữ nhãn; không có trạng thái riêng cho hàng phiên. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Vào `/projects/:projectId` từ sidebar, nút `Open` của card, hoặc sau khi thêm project | Route mount, gọi `open_project` một lần, dựng header và các khối; breadcrumb thành `Projects / {displayName}`. | `Enter` / `Space` trên hàng sidebar hoặc nút `Open` |
| Bấm `Copy path` | Ghi `rootPath` vào clipboard bằng `navigator.clipboard.writeText`; tooltip và nhãn ẩn đổi thành `Copied` trong `2s`, một vùng `aria-live="polite"` công bố `Path copied`; thất bại hiện `XWork couldn't copy the path.` trong cùng vùng và cho bấm lại. | `Enter` / `Space` |
| Bấm `Open folder` | Gọi `open_project_folder`; hệ điều hành mở folder gốc. Bị khóa khi `Unavailable`. Nếu command trả `projectUnavailable`, giữ lỗi hành động của FE-004 và gọi lại `get_project` để dựng banner `Unavailable`. | `Enter` / `Space` |
| Bấm `More actions` | Mở đúng menu năm item của FE-004; điều khiển mũi tên, `Enter`, `Esc` và trả focus giữ nguyên hành vi cũ. | `Enter` / `Space` mở, `Esc` đóng |
| Chọn `Rename project…` | Hộp thoại dùng lại mở với tên hiện tại; thành công thì đóng, header và crumb làm mới qua `projects://changed`. | `Enter` trong input |
| Chọn `Pin project` / `Unpin project` | Gọi `set_project_pinned`; icon ghim của header đổi sau khi danh sách làm mới. | Không có |
| Chọn `Open folder` | Như nút `Open folder` ở header; item khóa khi `Unavailable`. | Không có |
| Chọn `Locate folder…` | Gọi `locate_project_folder`; chọn xong project về `Available`, Git được query lại nhờ `projects://changed`; hủy picker không đổi gì. | Không có |
| Chọn `Remove Project` | Luồng impact và hộp thoại xác nhận của FE-004; xác nhận thành công điều hướng về `/projects`. | Không có |
| Bấm `New Session` ở header hoặc trong trạng thái rỗng phiên | Trước khi `BE-005` tồn tại, nút header có `aria-disabled="true"` và chỉ giải thích trạng thái qua tooltip. Khi contract phiên đã kích hoạt, gọi `create_session(projectId)`; thành công điều hướng tới `/sessions/${result.summary.id}` (màn hình phiên của `FE-006`). Cả hai điểm vào bị khóa trong lúc chờ. | Không có |
| Bấm hàng phiên hoặc nút `Open` của hàng | Điều hướng tới `/sessions/{sessionId}`; không gọi command nào. | `Enter` / `Space` khi hàng đang focus |
| Bấm `Try again` của Git | Gọi lại `get_project_git_status(projectId)` đúng một lần. | `Enter` / `Space` |
| Đưa cửa sổ chính trở lại foreground | Hook chạy lại `get_project` + `get_project_git_status` + `list_sessions` cho project hiện tại, bắt kịp thay đổi availability và Git xảy ra ngoài ứng dụng. | Không có |
| Project đổi ở nơi khác trong ứng dụng | `projects://changed`: nếu `Removed` cho project hiện tại thì điều hướng về `/projects`; ngược lại chạy lại `get_project` và Git query. | Không có |
| Di chuyển focus bằng `Tab` trong vùng nội dung | Thứ tự: `Copy path` → `Open folder` → `New Session` → `More actions` → `Locate folder…` và `Remove Project` trong banner khi unavailable → nút `Try again` khi có → từng hàng phiên (hàng trước, nút `Open` sau) → nút `New Session` của trạng thái rỗng khi có. Mọi thành phần focus có viền focus rõ ràng. | `Tab` / `Shift+Tab` |

## Luồng chính

### Tải và làm mới

1. Route mount; hook dữ liệu tạo token mới và gọi `open_project(projectId)`. Kết quả cập nhật `last_opened_at_ms` phía backend và trả `ProjectDto` làm dữ liệu header.
2. Nếu project `Available`, hook gọi `get_project_git_status(projectId)`; khối phiên (khi đã kích hoạt) gọi `list_sessions(projectId)`.
3. Route đăng ký một listener `projects://changed` và một listener `focus` của cửa sổ; cả hai bị hủy khi route unmount và mọi kết quả đang bay bị vô hiệu bởi token.
4. `focus` làm mới metadata bằng `get_project` (không đụng `last_opened_at_ms`), rồi làm mới Git và phiên.
5. `projects://changed` với `change: "removed"` cho project hiện tại điều hướng về `/projects`; các trường hợp khác làm mới metadata và Git. Event phát ra từ chính `open_project` lúc mount được xử lý như một lần làm mới thừa vô hại.

### Tạo phiên

1. Người dùng bấm `New Session`; hook phiên khóa luồng bằng cờ đang chạy.
2. `create_session(projectId)` trả `SessionDetailDto`; frontend lấy ID từ `result.summary.id`, không giữ lại DTO và điều hướng tới `/sessions/${result.summary.id}`.
3. Danh sách phiên trên overview được đồng bộ lại bởi `sessions://runtime-changed` phát từ command; lần quay lại overview sau đó thấy phiên mới với trạng thái `noToolYet`.

### Project không còn tồn tại

1. Một command trả `projectNotFound` hoặc `removalInProgress`, hoặc event `projects://changed` báo `Removed` cho project hiện tại.
2. Route đóng menu và hộp thoại đang mở, điều hướng về `/projects` và không hiển thị thông điệp lỗi riêng vì danh sách đích đã tự làm mới.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `open_project` | `{ projectId: string }` | `ProjectDto` | `projectNotFound`, `removalInProgress` → điều hướng `/projects`; `clockFailed`, `persistenceFailed` → lỗi tải trang kèm `Try again`; `invalidProjectId`, `unauthorizedWindow` → integration (xem bảng dưới). |
| `get_project` | `{ projectId: string }` | `ProjectDto` | Như `open_project` trừ `clockFailed`/`removalInProgress`; khi đã có dữ liệu thì giữ dữ liệu cũ và hiện dòng lỗi kèm `Try again`. |
| `get_project_git_status` | `{ projectId: string }` | `ProjectGitStatusDto` | `gitInspectionFailed` → `XWork couldn't read Git status for {name}.` + `Try again`; `projectNotFound` → điều hướng `/projects`; `projectUnavailable` → gọi lại `get_project` vì lỗi có thể mới hơn snapshot metadata, rồi dựng trạng thái `Unavailable`; `removalInProgress` → điều hướng `/projects`; `invalidProjectId`, `unauthorizedWindow` → integration. |
| `list_sessions` | `{ projectId: string }` | `SessionSummaryDto[]` | `projectNotFound` → điều hướng `/projects`; `projectLookupFailed` → lỗi tải khối phiên + `Try again`; `unauthorizedWindow` → integration. |
| `create_session` | `{ projectId: string }` | `SessionDetailDto` | `projectUnavailable` → `XWork can't start a session while the folder is unavailable.`, gọi lại `get_project` và đưa `Locate folder…` trực tiếp trong banner; `projectNotFound` → điều hướng `/projects`; `runtimeShuttingDown` → `XWork is quitting.` không retry; `projectLookupFailed` → `Try again`; `unauthorizedWindow` → integration. |

Kiểu DTO lấy từ `src/bindings/projects/projects.ts` và `src/bindings/sessions/` (khi đã sinh); không định nghĩa lại thủ công. Ba command đầu đã có backend và binding; hai command phiên theo contract đã đặc tả trong `BE-005-sessions-runtime.md` và chỉ được gọi khi binding tồn tại.

Phân loại lỗi integration: `unauthorizedWindow`, `invalidProjectId`, `invalidSearch` và mọi payload không nhận dạng được hiển thị `XWork ran into a problem it cannot recover from. Restart XWork.` và không có nút retry — cùng quy ước `project-error-copy.ts` của FE-004. `ProjectsError` và `SessionsError` là union phân biệt bằng trường `code`; tên trường dữ liệu kèm theo lấy đúng như binding sinh ra.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `projects://changed` | `ProjectChangedEventDto` | Sau mỗi mutation project commit thành công. | `removed` cho project hiện tại → điều hướng `/projects`; ngược lại coi payload là khóa vô hiệu hóa, chạy lại `get_project` và `get_project_git_status`, không áp trực tiếp payload vào state. |
| `sessions://runtime-changed` | `SessionRuntimeEventDto` | Sau mỗi mutation runtime đã commit của `BE-005`. | Chỉ xử lý khi `projectId` trùng project hiện tại: chạy lại `list_sessions(projectId)`. Không patch danh sách từ `summary` của event; query lại là nguồn đồng bộ duy nhất nên revision lệch không gây stale. |

Không có Channel nào thuộc feature này; terminal output là Channel của `BE-007`.

### Contract kích hoạt theo giai đoạn

| Thành phần | Điều kiện kích hoạt |
|---|---|
| Header, `Copy path`, `Open folder`, menu và hai hộp thoại, banner unavailable, khối Git | Ngay ở giai đoạn 5 cùng `BE-004`; toàn bộ command đã có backend và binding. |
| Nút `New Session` | Render từ giai đoạn 5 dưới dạng `aria-disabled` kèm tooltip giải thích; kích hoạt ở giai đoạn 8 khi `BE-005` và binding sessions tồn tại. |
| Khối `Sessions in this run`, `src/lib/ipc/sessions.ts` | Giai đoạn 8, khi `BE-005` triển khai và `src/bindings/sessions/` được sinh. Trước đó khối không render và file wrapper chưa tồn tại. |
| Cột phải `7fr 5fr` | Giai đoạn 16, khi khối `Recent files` đầu tiên xuất hiện từ `BE-014`. |

## State frontend

```ts
// Chỉ ghi hình dạng state và chữ ký action, không ghi implementation.
type ProjectOverviewStatus = "loading" | "ready" | "failed";

type GitSnapshotState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; snapshot: ProjectGitStatusDto }
  | { status: "failed"; message: string };

interface ProjectOverviewData {
  status: ProjectOverviewStatus;
  project: ProjectDto | null;
  failure: ProjectListFailure | null;
  git: GitSnapshotState;
  load(): void;
  refreshProject(): void;
  retryGit(): void;
}

// Phần mở rộng tối thiểu của hook FE-004 để overview phản ứng với availability mới.
interface ProjectActionsOptions {
  onRemoved?(): void;
  onUnavailable?(): void;
}

type SessionListStatus = "idle" | "loading" | "ready" | "failed";

type SessionListFailure =
  | { kind: "retryable"; message: string }
  | { kind: "integration"; message: string };

type CreateSessionFailure =
  | { kind: "unavailable"; message: string }
  | { kind: "retryable"; message: string }
  | { kind: "shuttingDown"; message: string }
  | { kind: "integration"; message: string };

interface ProjectSessionsState {
  status: SessionListStatus;
  sessions: SessionSummaryDto[];
  failure: SessionListFailure | null;
  isCreating: boolean;
  createFailure: CreateSessionFailure | null;
  refresh(): void;
  createSession(): Promise<void>;
  dismissCreateFailure(): void;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `project`, `status`, `failure` | Backend qua `open_project`/`get_project` | Chỉ giữ trong bộ nhớ của route; lấy lại khi mount, focus, `projects://changed` và khi command phụ thuộc root trả `projectUnavailable`. `load()` dùng `open_project` cho lần vào trang/thử lại lỗi tải ban đầu; `refreshProject()` chỉ dùng `get_project` để không đổi `last_opened_at_ms`. Không suy diễn từ payload event. |
| `git` | Backend qua `get_project_git_status` | Snapshot luôn đọc mới theo contract `BE-004`; không cache dài hạn, không suy diễn từ snapshot cũ. `idle` chỉ tồn tại khi project chưa `ready` hoặc đang `unavailable`. |
| `sessions`, `status`, `failure` | Backend qua `list_sessions` | Chỉ có sau khi binding `BE-005` tồn tại; làm mới khi mount, focus và `sessions://runtime-changed`. |
| `isCreating`, `createFailure` | UI tạm thời | Chặn hai điểm vào `New Session` gọi `create_session` trùng; thất bại không tự biến mất cho tới khi người dùng đóng hoặc thao tác lại thành công. |
| Nhãn breadcrumb | `readProjectCrumbLabel` đọc từ store project | Feature không ghi vào state của shell; topbar chỉ subscribe để tái render. |

Cả hai hook dùng một token tăng dần cho mỗi lần gọi và bỏ qua kết quả không thuộc lần mới nhất; route unmount vô hiệu mọi kết quả đang bay. Thao tác menu dùng `use-project-actions` của FE-004 với một thao tác mỗi lần trên project hiện tại.

## Contract công khai của feature

```ts
// src/features/projects/project-overview-route.tsx
export function ProjectOverviewRoute(): JSX.Element;

// src/features/projects/projects-store.ts
// Đọc tên hiển thị của một project từ snapshot hiện tại; trả "" khi không tìm thấy.
export function readProjectCrumbLabel(projectId: string | undefined): string;
// Store project trở thành public entry để AppTopbar subscribe làm mới nhãn crumb.
export function useProjectsStore(): ProjectsState;

// src/lib/ipc/projects.ts
export function getProject(projectId: string): Promise<ProjectDto>;
export function openProject(projectId: string): Promise<ProjectDto>;
export function getProjectGitStatus(projectId: string): Promise<ProjectGitStatusDto>;

// src/lib/ipc/sessions.ts — kích hoạt cùng BE-005
export function listSessions(projectId: string): Promise<SessionSummaryDto[]>;
export function createSession(projectId: string): Promise<SessionDetailDto>;
export function onSessionsRuntimeChanged(
  handler: (event: SessionRuntimeEventDto) => void,
): Promise<UnlistenFn>;
```

Feature khác không import implementation nội bộ của overview; các thành phần dùng lại nằm trong cùng feature projects theo quy tắc phụ thuộc.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Điều hướng nhanh giữa hai overview khác nhau | Token của route cũ bị vô hiệu; kết quả trễ không ghi đè project mới; listener của route cũ bị hủy khi unmount. |
| Rename project từ chính menu header | `projects://changed` → `get_project` làm mới header; subscription mới trong topbar đổi nhãn crumb mà không cần điều hướng. |
| Project chuyển `Available` → `Unavailable` khi đang mở | `get_project` ở lần focus/event trả `unavailable`; header thêm badge và banner lý do, snapshot Git bị xóa về `idle`, khối thay đổi biến mất, `New Session` và `Open folder` khóa; khối phiên vẫn hiển thị. |
| `Locate folder…` thành công từ overview | Project về `Available`; event làm mới metadata và query Git trên root mới; banner `Unavailable` biến mất; các phiên đang có không đổi theo contract `BE-003`. |
| Gỡ project từ overview | Hộp thoại xác nhận dùng lại; thành công điều hướng `/projects`; thất bại giữ hộp thoại theo phân loại của FE-004. |
| Project bị gỡ ở nơi khác trong ứng dụng | Event `removed` hoặc lỗi `projectNotFound` đóng mọi menu/hộp thoại đang mở và điều hướng `/projects` không kèm thông điệp riêng. |
| `create_session` thi nhau từ hai nút | Cờ `isCreating` chặn lời gọi thứ hai; không có hai phiên sinh cùng một cú bấm. |
| Project vừa chuyển `Unavailable` sau snapshot metadata nhưng trước Git/open-folder/create-session command | Lỗi `projectUnavailable` giữ thông điệp riêng của thao tác, kích hoạt `get_project`, dựng badge + banner `Unavailable`, khóa hành động phụ thuộc root và cho xử lý trực tiếp qua `Locate folder…`. |
| Clipboard bị từ chối hoặc lỗi | Vùng `aria-live` thông báo `XWork couldn't copy the path.`; nút vẫn bấm lại được; không ảnh hưởng phần còn lại của trang. |
| Đường dẫn hoặc branch rất dài | Cắt bằng ellipsis kèm `title` mang giá trị đầy đủ; badge branch không đẩy cụm hành động xuống dòng mới. |
| Danh sách thay đổi rất lớn | Render đầy đủ theo DTO và cuộn cùng trang; không phân trang, không giới hạn ảo hóa trong phạm vi feature này. |
| Untracked directory | Render nguyên `path` đã có `/` cuối từ backend, không nối thêm; badge vẫn là `??`. |
| Renamed/Copied | Hiện `{previousPath} → {path}`; badge `R`/`C`. |
| Sự kiện `sessions://runtime-changed` đến khi route đang unmount | Listener đã hủy nên không query; lần mount sau query mới. |
| Hai event session đến gần như đồng thời | Mỗi event kích hoạt một query có token; chỉ kết quả của lần sau được dùng. |

## Tiêu chí hoàn thành

- [ ] Route `/projects/:projectId` render `ProjectOverviewRoute` thay cho `AreaPlaceholder`; breadcrumb hai cấp thành `Projects / {displayName}` và đổi theo rename mà không cần điều hướng.
- [ ] Vào trang gọi `open_project` đúng một lần; `opened just now` xuất hiện ở dòng mốc; focus cửa sổ sau đó dùng `get_project` và không đổi `last_opened_at_ms`.
- [ ] Header hiển thị đủ: tên kèm chỉ báo ghim, đường dẫn mono có `title` đầy đủ, hai nút icon có tooltip, dòng branch/summary và mốc `added/opened` theo định dạng đã đặc tả.
- [ ] `Copy path` ghi đúng đường dẫn vào clipboard, công bố `Path copied` qua vùng live và tự trả tooltip sau `2s`; smoke thủ công trên Windows xác nhận cả nhánh thành công và nhánh lỗi.
- [ ] `Open folder` mở folder gốc bằng file manager của hệ điều hành; smoke thủ công trên Windows.
- [ ] Khối thay đổi render đủ badge, previous path, dấu `/` của untracked directory, dòng read-only; `clean`, `Not a Git repository`, `Bare repository` và lỗi Git có trạng thái đúng; `untracked` chỉ hiện khi khác `0`.
- [ ] Menu năm thao tác và hai hộp thoại hành xử đúng như FE-004; gỡ thành công điều hướng về `/projects`; rename/ghim/locate làm mới header mà không tải lại toàn trang.
- [ ] Project `Unavailable` hiện badge và banner đúng wireframe với một trong bốn lý do cùng hai hành động trực tiếp; khóa `New Session` và `Open folder`, vẫn cho `Locate folder…`/`Remove Project` và vẫn hiển thị khối phiên.
- [ ] `projectUnavailable` phát sinh sau snapshot metadata từ Git, open-folder hoặc create-session đều kích hoạt `get_project` và chuyển trang sang trạng thái `Unavailable` ngay, không chờ focus cửa sổ.
- [ ] `projects://changed` và focus làm mới đúng các query; event `removed` điều hướng về `/projects`; kết quả trễ bị bỏ qua theo token.
- [ ] Ở giai đoạn 5, `New Session` hiện đúng vị trí, nhận focus bằng `aria-disabled` và giải thích qua tooltip; khi `BE-005` đã triển khai, nút tạo phiên và điều hướng bằng `result.summary.id`, khối phiên hiển thị đủ ánh xạ trạng thái, số ít/số nhiều của tab và process, trạng thái rỗng/đang tải/lỗi, và `sessions://runtime-changed` làm mới danh sách.
- [ ] Thứ tự `Tab`, viền focus và mọi điều khiển bằng bàn phím hoạt động đúng bảng Tương tác.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` và `pnpm tauri build` pass trên Windows vì feature nối các command/binding backend vào route thật.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/projects/project-overview-route.test.tsx` | Component | Route dựng header và các khối theo dữ liệu mock; trạng thái tải/lỗi/not-found; điều hướng sau gỡ và sau event `removed`; ghép menu và hai hộp thoại; thứ tự `Tab`. |
| `src/features/projects/project-overview-header.test.tsx` | Component | Tên, chỉ báo ghim và badge unavailable; đường dẫn kèm `title`; các nhánh `notRepository`/`bare`/`unborn`/`detached`/clean/changed/untracked; bốn lý do và banner unavailable với hai hành động trực tiếp; khóa nút theo unavailable, giai đoạn kích hoạt session và đang tạo phiên; copy path với phản hồi live và nhánh lỗi; định dạng mốc thời gian. |
| `src/features/projects/project-git-changes.test.tsx` | Component | Đủ badge và chữ ẩn; previous path; dấu `/`; nhãn khối theo head; clean; dòng read-only; lỗi kèm `Try again` gọi đúng một lần. |
| `src/features/projects/project-session-list.test.tsx` | Component | Ánh xạ sáu trạng thái; số ít/số nhiều; hàng và nút `Open` điều hướng; rỗng/đang tải/lỗi; hai nút `New Session` dùng chung một luồng. |
| `src/features/projects/use-project-overview.test.ts` | Unit | `open_project` một lần khi mount; focus/event dùng `get_project`; unavailable không query Git; Git trả `projectUnavailable` kích hoạt metadata refresh; token bỏ kết quả cũ; từng nhánh lỗi đúng hành động. |
| `src/features/projects/use-project-sessions.test.ts` | Unit | Query theo projectId; làm mới theo event trùng project và bỏ event khác; chặn tạo trùng; điều hướng bằng `result.summary.id`; từng `SessionsError` đúng failure kind, thông điệp, metadata refresh và điều hướng. |
| `src/features/projects/use-project-actions.test.ts` | Unit | `open_project_folder` trả `projectUnavailable` gọi `onUnavailable`; consumer FE-004 không truyền callback vẫn giữ hành vi cũ. |
| `src/features/projects/projects-store.test.ts` | Unit | Bổ sung `readProjectCrumbLabel`: tìm thấy, không tìm thấy, `undefined`. |
| `src/lib/ipc/projects.test.ts` | Unit | Bổ sung ba wrapper: tên command, tham số camelCase, ánh xạ lỗi typed giữ nguyên payload. |
| `src/lib/ipc/sessions.test.ts` | Unit | Hai command và một event: tên, hình dạng tham số, ánh xạ lỗi typed; chỉ chạy khi binding sessions tồn tại. |
| `src/app/app-router.test.tsx` | Component | Route dùng `ProjectOverviewRoute`; crumb lấy từ `readProjectCrumbLabel`; các route khác không đổi. |
| `src/app/app-topbar.test.tsx` | Component | Bổ sung: nhãn crumb dựa trên store và làm mới khi snapshot đổi mà route không đổi. |

Clipboard thật, file manager hệ điều hành và hành vi focus của cửa sổ native được xác nhận bằng smoke test thủ công trên Windows với `pnpm tauri dev`; automated test không thay thế bước này.

## Câu hỏi mở

Không có.
