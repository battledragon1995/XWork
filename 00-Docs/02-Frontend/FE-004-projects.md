# FE-004 — Projects

Tài liệu này đặc tả contract frontend cho trang `Projects` dạng lưới card và danh sách project thật trong sidebar: hiển thị, tìm kiếm, thêm project, đổi tên, ghim, mở folder bằng hệ điều hành, chọn lại đường dẫn, gỡ project và trạng thái `Unavailable`. Feature không sở hữu dữ liệu project; mọi thao tác đi qua command và event của `BE-003`.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-004` |
| Phase | `1` |
| Khu vực chính | `src/features/projects/` |
| Yêu cầu chức năng | `§7.1`, `§7.2`, `§7.3`, `§7.4`; áp dụng yêu cầu tương tác chung tại `§18` |
| Wireframe | `01-Wireframe/04-Projects.html#grid`, `#add`, `#unavailable`, `#dlg-remove-project` |
| Backend liên quan | `BE-003`; `BE-004` và `BE-005` chỉ mở rộng card ở giai đoạn sau |
| Phụ thuộc | `FE-001` |

## Mục tiêu

Người dùng mở khu vực `Projects` và thấy toàn bộ project đã đăng ký dưới dạng lưới card: tên hiển thị, đường dẫn gốc, trạng thái ghim và trạng thái khả dụng của folder. Từ đây người dùng thêm folder có sẵn qua folder picker thật, tìm theo tên hoặc đường dẫn, đổi tên hiển thị, ghim/bỏ ghim, mở folder bằng trình quản lý file của hệ điều hành, chọn lại folder khi đường dẫn không còn hợp lệ và gỡ project sau xác nhận rõ ràng. Cùng lát cắt này, khối `Projects` trên sidebar của `FE-001` chuyển từ trạng thái rỗng sang danh sách project thật.

### Quyết định và giả định đã chốt

- FE-004 sở hữu `element` của route `/projects`. `app-router.tsx` trỏ route này sang `ProjectsRoute`, public entry của `src/features/projects/`; nhãn breadcrumb `Projects` do bảng route của `FE-001` cấp và feature không ghi vào state của shell.
- FE-004 cũng sở hữu danh sách project thật trong sidebar. `FE-001` đã chủ động nhường phần này (`SidebarMenuSub`, `SidebarMenuBadge`, `SidebarMenuAction` được để dành cho `FE-004`/`FE-006`) và roadmap giai đoạn 4 ghi rõ "danh sách project thật được nối vào sidebar của `FE-001`". Feature export `SidebarProjectList` và `src/app/app-sidebar.tsx` ghép component này vào đúng chỗ đoạn chữ rỗng đang đứng; đây là quan hệ `src/app/` dùng public entry của feature, đúng quy tắc phụ thuộc.
- Sidebar ở lát cắt này chỉ có hàng project. Không có hàng session con và không có chevron mở rộng: dữ liệu session đến từ `BE-005` ở giai đoạn 8, và `§7.5` gắn hành vi "bấm tên project vừa mở rộng danh sách phiên vừa mở trang tổng quan" với Project Overview của `FE-005`. Bấm một hàng project ở lát cắt này chỉ điều hướng tới `/projects/:projectId`.
- Dòng Git của card (`main · 3 changed`, `clean`, `Not a Git repository`) và dòng số session (`2 sessions`, `No sessions`) trong `#grid` bị ẩn hẳn ở lát cắt này. `get_project_git_summary` thuộc `BE-004` (giai đoạn 5) và số session thuộc `BE-005` (giai đoạn 8); cả hai chưa tồn tại. Không dựng placeholder mờ vì đó là chữ người dùng không làm gì được. Contract để nối lại được ghi đầy đủ ở mục `Contract với backend`.
- Card không hiển thị `addedAtMs` và `lastOpenedAtMs`. `#grid` không vẽ hai giá trị này trên card; `#dlg-remove-project` có vẽ chúng nhưng đó là header của Project Overview, thuộc `FE-005`.
- Đổi tên dùng một hộp thoại nhỏ `Rename project` dựng từ `src/components/ui/dialog.tsx`, không sửa trực tiếp trên card. Card cao `150px` và rộng một phần ba lưới nên không có chỗ đặt dòng lỗi validation; hộp thoại cũng là thứ `FE-005` dùng lại được từ menu ở header Project Overview. Wireframe không vẽ màn hình đổi tên nên đây là quyết định của tài liệu này.
- Tìm kiếm gọi backend: `list_projects(search)` với debounce `200ms`. Frontend không tự lọc để không nhân đôi quy tắc so khớp Unicode case-insensitive mà `BE-003` đã đặc tả. Frontend chỉ làm sạch input trước khi gửi — bỏ control character, cắt còn `256` Unicode scalar value, trim hai đầu — nên `invalidSearch` không bao giờ xảy ra trong luồng bình thường mà vẫn được xử lý như lỗi tích hợp nếu xuất hiện.
- Danh sách project được giữ trong một store cấp feature (`projects-store.ts`) thay vì hai lần truy vấn độc lập. Sidebar luôn mount còn trang `Projects` mount theo route; nếu mỗi bên tự truy vấn thì có hai listener `projects://changed`, hai listener `focus` và hai lần đọc filesystem cho cùng dữ liệu. Store đếm số consumer đang mount và chỉ giữ đúng một đăng ký cho mỗi loại.
- Store chỉ giữ danh sách **không lọc**, lấy bằng `list_projects()` không tham số. Sidebar luôn hiển thị đầy đủ project bất kể người dùng đang tìm gì trên trang. Kết quả tìm kiếm là state riêng của trang: khi query rỗng, trang dùng thẳng danh sách của store; khi query khác rỗng, trang dùng kết quả của `list_projects(search)`.
- Trạng thái luồng `Add Project` cũng nằm trong store, không nằm trong component. Có hai điểm vào cùng lúc — nút `Add Project` ở đầu trang và nút `+` ở header khối `Projects` trên sidebar — và `add_project` mở một hộp thoại native của hệ điều hành, nên hai lời gọi đồng thời sẽ mở hai picker. Một cờ dùng chung trong store là chỗ duy nhất chặn được việc đó.
- FE-004 có bản `use-add-project.ts` riêng trong feature của mình, không dùng lại `src/features/home/use-add-project.ts` của `FE-002`: quy tắc phụ thuộc cấm một feature import implementation của feature khác. Chuỗi thông điệp lỗi phải giống hệt bảng của `FE-002`. Chỉ nâng phần này thành module dùng chung khi có consumer thứ ba; khi đó nó là một hàm thuần map `ProjectsError` sang chuỗi và thuộc `src/lib/utils/`.
- Feature không gọi `open_project`. `§7.2` bước 6 chỉ yêu cầu mở trang tổng quan của project vừa thêm, còn `last_opened_at_ms` là việc của Project Overview (`FE-005`), đúng như `FE-002` đã chốt. Bấm `Open` trên card chỉ điều hướng tới `/projects/:projectId`.
- Thứ tự card và thứ tự hàng sidebar lấy nguyên từ backend. `BE-003` đã bảo đảm ghim trước, trong mỗi nhóm theo `added_at_ms ASC, id ASC`; frontend không sắp xếp lại và không tự chèn dải phân cách "Pinned".
- Card và hàng sidebar được key bằng `project.id`. Ghim/bỏ ghim làm card đổi vị trí trong lưới; key ổn định giữ nguyên phần tử DOM nên focus đang ở nút `More actions` của card đó không bị mất.
- Icon ghim trên card và trên hàng sidebar là glyph trạng thái, không phải control, nên không dùng tooltip mà dùng chữ ẩn thị giác (`Pinned`, `Folder unavailable`) ngay trong phần tử chứa. `§18` yêu cầu tooltip cho icon **không có nhãn** trên các control; một icon không nhận focus thì tooltip chỉ hiện khi hover và người dùng bàn phím không bao giờ đọc được, đúng lý do `FE-001` đã bỏ prop `tooltip` của `SidebarMenuButton`.
- Nhãn menu mở folder là `Open folder`, không phải `Open in File Explorer` như tooltip của wireframe. Chuỗi có tên File Explorer sẽ sai trên macOS, và `BE-003` gọi opener của hệ điều hành chứ không cam kết ứng dụng nào.
- Hai token màu cảnh báo được thêm vào `src/index.css` (`--color-warn-surface`, `--color-warn-ink`) thay vì hardcode hex của `wireframe.css`. `#grid` dùng `badge-warn` với nền `rgba(232, 165, 90, .22)` và chữ `#7a4a12`; bảng token hiện tại chỉ có `--color-amber` nên nếu không thêm token thì `FE-012` đổi theme sẽ không đổi được phần này.
- `src/components/ui/input.tsx` được thêm vào repo bằng component CLI theo quy tắc của `AGENTS.md`. Đây là component nền tảng đầu tiên mà repo cần cho ô nhập liệu; cả ô tìm kiếm và ô đổi tên dùng nó.
- Không cần đổi `src-tauri/capabilities/main.json`. Folder picker và opener đều do `BE-003` gọi từ Rust, còn `projects://changed` là event thường nên `core:event:allow-listen` đã cấp là đủ.
- Không thêm phím tắt toàn ứng dụng nào. Danh mục phím tắt thuộc `§17.4` và `BE-009`; feature chỉ dùng phím tắt cục bộ trong phần tử đang focus (`Esc` xóa ô tìm kiếm, `Enter` xác nhận hộp thoại).

### Contract backend còn thiếu hoặc lệch

- `#unavailable` được vẽ trên trang Project Overview (header, banner cảnh báo, danh sách session, khối file/note/event), không phải trên lưới card. FE-004 chỉ sở hữu phần `Unavailable` xuất hiện trong `#grid` — card nền mờ, badge `Unavailable`, dòng lý do, nút `Locate folder…` — cùng chỉ báo tương ứng trên hàng sidebar. Banner và header của `#unavailable` thuộc `FE-005`.
- `#dlg-remove-project` cũng được vẽ phủ trên Project Overview, nhưng hộp thoại là của FE-004 vì `§7.3` xếp gỡ project vào nhóm thao tác project. `FE-005` dùng lại đúng component này từ menu ở header; hai màn hình không được có hai hộp thoại remove khác nhau.
- `#grid` vẽ ba dòng dữ liệu mà `BE-003` không sở hữu: branch, số file thay đổi và số session. `BE-003` nói rõ `ProjectDto` không có field Git/session và màn hình tổng hợp phải tự ghép từ public query của capability sở hữu. Đây là lệch đã được `BE-004` xác nhận là cố ý ("card `FE-004` gọi query summary"), không phải lỗi contract.
- `BE-003` yêu cầu frontend re-query khi startup và khi cửa sổ chính được focus, nhưng `BE-001` không phát event nào báo cửa sổ chính vừa được show từ tray. FE-004 dùng sự kiện `focus` của `window` trong webview, giống `FE-002`. Nếu hệ điều hành không gửi focus cho webview khi show từ tray, dữ liệu chỉ được làm mới ở lần `projects://changed` kế tiếp hoặc lần điều hướng kế tiếp; muốn chắc chắn hơn thì `BE-001` phải bổ sung một event "main window shown".
- Ở giai đoạn 4, `BE-003` dùng `NoProjectRuntimeGuard` nên `get_remove_project_impact` luôn trả ba count bằng `0`. Hộp thoại remove vì vậy chưa bao giờ hiển thị khối facts trong thực tế; component vẫn phải render đúng khối đó khi count khác `0` để giai đoạn 8 không phải sửa lại.

### Ngoài phạm vi

- Trang tổng quan project: header với branch và Git status, `New Session`, danh sách session, recent file, note và event liên kết — thuộc `FE-005`. Route `/projects/:projectId` vẫn là `AreaPlaceholder` của `src/app/` sau lát cắt này.
- Branch, số file thay đổi và trạng thái `clean`/`Not a Git repository` trên card: thuộc `BE-004` và phần mở rộng FE-004 ở giai đoạn 5.
- Số session và chỉ báo trạng thái session trên card cùng hàng session con trên sidebar: thuộc `BE-005`, `FE-006` và phần mở rộng FE-004 ở giai đoạn 8.
- Tạo folder mới, clone repository và bất kỳ thao tác Git nào: ngoài phạm vi sản phẩm theo `§1`.
- Tìm kiếm hợp nhất `Ctrl K` và mục project trong kết quả: thuộc `FE-009`.
- Ghi nhớ query tìm kiếm, độ rộng lưới hoặc bất kỳ trạng thái nào qua các lần mở ứng dụng: thuộc `BE-008` và `FE-011`.
- Kéo thả để đổi thứ tự project: `§7.1` cố định thứ tự là ghim trước rồi theo thời điểm thêm, không có thứ tự tùy người dùng.
- Chọn nhiều project để gỡ hàng loạt: `§7.3` chỉ định nghĩa thao tác trên một project.
- Theme tối và cỡ chữ giao diện: thuộc `FE-012`.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/projects/projects-route.tsx` | Public entry của route `/projects`: đầu trang với tiêu đề, dòng đếm, ô tìm kiếm và `Add Project`; lưới card; các trạng thái tải/rỗng/lỗi; nơi host hộp thoại đổi tên và hộp thoại gỡ project; dòng thông báo lỗi thao tác. |
| `src/features/projects/project-card.tsx` | Một card project theo `#grid`: tên, đường dẫn, chỉ báo ghim, badge và dòng lý do `Unavailable`, nút `Open` hoặc `Locate folder…`, nút `More actions`. |
| `src/features/projects/project-actions-menu.tsx` | Menu thao tác của card dựng từ `dropdown-menu`: `Rename project…`, `Pin project`/`Unpin project`, `Open folder`, `Locate folder…`, `Remove Project`; phát ý định lên chỗ gọi, không tự gọi command. |
| `src/features/projects/rename-project-dialog.tsx` | Hộp thoại đổi tên hiển thị: input đặt sẵn tên hiện tại, validation phía frontend, dòng lỗi từ backend, nút `Cancel` và `Rename`. |
| `src/features/projects/remove-project-dialog.tsx` | Hộp thoại xác nhận gỡ project theo `#dlg-remove-project`: nội dung nói rõ folder và file được giữ nguyên, khối facts từ `RemoveProjectImpactDto`, nút `Cancel` và `Remove Project`. |
| `src/features/projects/sidebar-project-list.tsx` | Public entry cho sidebar: nhãn khối `Projects`, nút `+` mở `Add Project`, các hàng project với chỉ báo ghim và `Unavailable`, trạng thái rỗng, trạng thái đang tải và trạng thái lỗi. |
| `src/features/projects/projects-store.ts` | State dùng chung của feature: danh sách project không lọc, trạng thái tải, lỗi tải, trạng thái luồng `Add Project`; đếm consumer để giữ đúng một đăng ký `projects://changed` và một đăng ký `focus`; bỏ qua kết quả của truy vấn cũ. |
| `src/features/projects/use-projects.ts` | Hook đăng ký/hủy đăng ký consumer của store và trả về danh sách không lọc cùng trạng thái tải và hành động làm mới. |
| `src/features/projects/use-project-search.ts` | Ô tìm kiếm của trang: làm sạch input, debounce `200ms`, gọi `list_projects(search)`, bỏ qua kết quả cũ, chạy lại khi nhận `projects://changed` hoặc khi người dùng làm mới, và trả về danh sách của store khi query rỗng. |
| `src/features/projects/use-add-project.ts` | Máy trạng thái của luồng `Add Project` dựa trên cờ dùng chung trong store: chặn gọi trùng, phân loại `ProjectsError`, dựng thông điệp lỗi và điều hướng tới project vừa thêm. |
| `src/features/projects/use-project-actions.ts` | Điều phối đổi tên, ghim, mở folder, chọn lại folder, đọc impact và gỡ project: giữ project đang là mục tiêu của từng hộp thoại, chặn thao tác trùng trên cùng project, phân loại lỗi và yêu cầu làm mới sau khi thành công. |
| `src/features/projects/project-error-copy.ts` | Hàm thuần map `ProjectsError` của từng command sang thông điệp hiển thị và nhóm khắc phục; nơi duy nhất giữ chuỗi lỗi của feature. |
| `src/lib/ipc/projects.ts` | Wrapper cho `list_projects`, `add_project`, `rename_project`, `set_project_pinned`, `open_project_folder`, `locate_project_folder`, `get_remove_project_impact`, `remove_project` và đăng ký event `projects://changed`. |
| `src/app/app-router.tsx` | Trỏ `element` của route `/projects` sang `ProjectsRoute`; các route khác giữ nguyên, gồm cả `/projects/:projectId` vẫn là placeholder của `FE-005`. |
| `src/app/app-sidebar.tsx` | Thay đoạn chữ rỗng của khối `Projects` bằng `SidebarProjectList`; giữ nguyên hành vi ẩn cả khối khi sidebar thu gọn. |
| `src/components/ui/input.tsx` | Component input nền tảng cho ô tìm kiếm và ô đổi tên. |
| `src/components/ui/dialog.tsx` | Component hộp thoại nền tảng cho hộp thoại đổi tên và hộp thoại gỡ project. |
| `src/components/ui/dropdown-menu.tsx` | Component menu nền tảng cho menu thao tác của card. |
| `src/components/ui/button.tsx` | Nút nền tảng cho `Add Project`, `Open`, `Locate folder…`, các nút trong hộp thoại và nút chỉ có icon. |
| `src/components/ui/tooltip.tsx` | Tooltip nền tảng cho các nút chỉ có icon: `More actions`, `+` trên sidebar, `Clear search`. |
| `src/components/animate-ui/components/radix/sidebar.tsx` | Cung cấp `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupAction`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` và `SidebarMenuBadge` mà danh sách project trong sidebar dùng. |
| `src/bindings/projects/projects.ts` | DTO và `ProjectsError` cho toàn bộ contract IPC của feature; file sinh tự động, không chỉnh tay. |
| `src/index.css` | Nguồn token màu, font và bán kính; feature bổ sung `--color-warn-surface` và `--color-warn-ink` cho badge và dòng lý do `Unavailable`. |
| `src/features/projects/projects-route.test.tsx` | Test đầu trang, lưới, các trạng thái hiển thị, luồng tìm kiếm và việc mở/đóng hai hộp thoại. |
| `src/features/projects/project-card.test.tsx` | Test nội dung card, nhánh `Available`/`Unavailable`, chỉ báo ghim và các nút hành động. |
| `src/features/projects/project-actions-menu.test.tsx` | Test danh mục item, nhãn ghim theo trạng thái, item bị vô hiệu hóa và thao tác bằng bàn phím. |
| `src/features/projects/rename-project-dialog.test.tsx` | Test giá trị đặt sẵn, validation phía frontend, nhánh lỗi backend và việc trả focus khi đóng. |
| `src/features/projects/remove-project-dialog.test.tsx` | Test nội dung xác nhận, khối facts theo impact, nhánh lỗi và việc chỉ gọi `remove_project` với `confirmed = true`. |
| `src/features/projects/sidebar-project-list.test.tsx` | Test danh sách hàng, chỉ báo ghim và `Unavailable`, trạng thái rỗng, nút `+` và điều hướng. |
| `src/features/projects/projects-store.test.ts` | Test đếm consumer, số lượng đăng ký, bỏ qua kết quả cũ, cờ chặn `Add Project` trùng và việc reset state. |
| `src/features/projects/use-project-search.test.ts` | Test làm sạch input, debounce, bỏ qua kết quả cũ và nhánh query rỗng. |
| `src/features/projects/use-add-project.test.ts` | Test chặn gọi trùng từ hai điểm vào, phân loại từng `ProjectsError` và điều hướng khi thành công. |
| `src/features/projects/use-project-actions.test.ts` | Test từng nhánh thành công và lỗi của năm thao tác, việc chặn thao tác trùng và việc làm mới sau khi thành công. |
| `src/lib/ipc/projects.test.ts` | Test tên command, hình dạng tham số, tên event và ánh xạ lỗi typed cho tám command. |
| `src/app/app-router.test.tsx` | Test route `/projects` render `ProjectsRoute` thay vì `AreaPlaceholder`; các route còn lại không đổi. |
| `src/app/app-sidebar.test.tsx` | Test khối `Projects` render `SidebarProjectList`; hành vi thu gọn và các phần khác của sidebar không đổi. |

Feature không thêm dependency mới và không sửa `src-tauri/capabilities/main.json`, `src-tauri/tauri.conf.json` hay bất kỳ file Rust nào.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `ProjectsRoute` | Điểm vào route `/projects`. Vùng `page` padding `28px 32px`, không cuộn ngang; đầu trang và lưới xếp dọc, lưới cuộn dọc trong vùng nội dung. | `04-Projects.html#grid` |
| Đầu trang | Bên trái: `h2` `Projects` font `display` cỡ `28px`, dưới là dòng đếm cỡ `13px` màu `muted`. Bên phải: ô tìm kiếm cao `32px` rộng `260px` với icon kính lúp và placeholder `Search by name or path`, rồi nút `Add Project` biến thể primary. Hai cụm cách nhau `24px`, căn theo mép dưới. | `04-Projects.html#grid` |
| `ProjectCard` | Card nền `canvas`, viền `hairline`, bán kính `12px`, padding `14px 16px`, khoảng cách trong `10px`, cao tối thiểu `150px`. Từ trên xuống: hàng tiêu đề (icon folder, tên cỡ `15px` weight `500`, chỉ báo ghim), đường dẫn dạng mono cỡ `12px` cắt bằng ellipsis kèm `title` là đường dẫn đầy đủ, dòng trạng thái khả dụng, và hàng đáy đẩy xuống cuối chứa badge trạng thái bên trái cùng cụm hành động bên phải. | `04-Projects.html#grid` |
| `ProjectActionsMenu` | Nút chỉ có icon `More actions` mở menu năm item; item `Remove Project` nằm dưới một dải phân cách và mang màu `destructive`. | `04-Projects.html#grid` |
| `RenameProjectDialog` | Hộp thoại rộng `460px`: tiêu đề `Rename project`, mô tả `This changes the name in XWork only. The folder keeps its own name.`, một `label` + `input`, dòng lỗi, footer `Cancel` và `Rename`. | `Không có` |
| `RemoveProjectDialog` | Hộp thoại rộng `460px`: tiêu đề `Remove {displayName} from XWork?`, đoạn mô tả có đường dẫn dạng mono, khối facts nền `surface-card` bán kính `8px`, footer `Cancel` và `Remove Project` biến thể destructive. | `04-Projects.html#dlg-remove-project` |
| `SidebarProjectList` | Khối `Projects` trong sidebar: nhãn khối cỡ `11px` in hoa tracking `1.2px` màu `muted-soft`, nút `+` `22px` ở góc phải nhãn, danh sách hàng cao `28px` gồm icon folder cỡ `14px`, tên cỡ `13px` cắt ellipsis và một badge phải cho chỉ báo ghim hoặc `Unavailable`. | `04-Projects.html#grid`, `#unavailable` |

Nội dung chữ cố định:

- Tiêu đề trang: `Projects`.
- Dòng đếm: `{n} projects` với `1 project` ở dạng số ít; nối thêm `· {n} pinned` khi có project ghim và `· {n} unavailable` khi có project không khả dụng; nối thêm `· {n} matching` khi ô tìm kiếm đang có query. Mọi count lấy từ danh sách không lọc của store, riêng `matching` lấy từ kết quả tìm kiếm.
- Nút chính: `Add Project`, biến thể primary, cao `32px`, icon folder-plus bên trái.
- Nhãn ô tìm kiếm: `aria-label` là `Search projects by name or path`, placeholder là `Search by name or path`.
- Nút hành động chính của card: `Open` khi `Available`, `Locate folder…` khi `Unavailable`; cả hai biến thể secondary cỡ `sm`.
- Item menu: `Rename project…`, `Pin project` hoặc `Unpin project`, `Open folder`, `Locate folder…`, `Remove Project`.
- Badge trạng thái: `Unavailable` trên nền `--color-warn-surface` với chữ `--color-warn-ink`. Card `Available` không có badge trạng thái ở lát cắt này.

Lưới dùng `repeat(3, minmax(0, 1fr))` với khoảng cách `16px` theo `#grid`. Khi bề rộng vùng nội dung nhỏ hơn `1100px` lưới còn hai cột, nhỏ hơn `760px` còn một cột. Khi nhỏ hơn `760px`, đầu trang cũng xếp dọc và ô tìm kiếm giãn hết chiều rộng. Tên và đường dẫn luôn cắt bằng ellipsis, không bao giờ làm card giãn ngang.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `Đang tải lần đầu — trang` | Store chưa có kết quả nào và một truy vấn đang chạy. | Vùng chiếm hết chiều cao lưới mang `role="status"` và `aria-busy="true"`, chỉ chứa chữ ẩn thị giác `Loading your projects…`. Đầu trang đã hiển thị với tiêu đề, ô tìm kiếm và `Add Project`; dòng đếm chưa render. Không dựng card giả. |
| `Đang làm mới` | Đã có kết quả cũ và một truy vấn mới đang chạy. | Giữ nguyên lưới đang hiển thị, không spinner, không đổi focus. Chỉ thay nội dung khi kết quả mới về. |
| `Rỗng — chưa có project nào` | Truy vấn gần nhất trả về `0` project và ô tìm kiếm rỗng. | Khối rỗng căn giữa, viền nét đứt `hairline`, bán kính `12px`: tiêu đề `No projects yet`, câu `Add a folder that already exists on this machine. XWork never creates, copies or clones anything.` và nút `Add Project`. Dòng đếm hiển thị `0 projects`. |
| `Rỗng — không khớp tìm kiếm` | Ô tìm kiếm có query và kết quả trả về `0` project. | Cùng khối rỗng: tiêu đề `No match`, câu `No project name or path contains "{query}".` và nút `Clear search`. Lưới trống nhưng đầu trang và dòng đếm vẫn hiển thị tổng số project. |
| `Có dữ liệu` | Kết quả gần nhất có ít nhất một project. | Lưới card theo đúng thứ tự backend trả về. |
| `Card — Available` | `availability.status === "available"`. | Card nền `canvas`. Hàng đáy có nút `Open` và nút `More actions`; không có badge trạng thái. |
| `Card — Unavailable` | `availability.status === "unavailable"`. | Card nền `surface-soft`, tên chuyển màu `muted`, icon folder chuyển màu `--color-warn-ink`. Dòng lý do màu `--color-warn-ink` theo `reason`. Hàng đáy có badge `Unavailable`, nút `Locate folder…` và nút `More actions`. |
| `Card — Pinned` | `isPinned === true`. | Icon pin màu `muted-soft` ở cuối hàng tiêu đề, kèm chữ ẩn thị giác `Pinned`. Card vẫn nằm đúng vị trí backend trả về. |
| `Đang chọn folder` | Luồng `Add Project` đang chạy. | Cả nút `Add Project` ở đầu trang và nút `+` trên sidebar bị khóa; nhãn nút chính đổi thành `Selecting folder…`. Không mở picker thứ hai. |
| `Đang xử lý thao tác trên một project` | Một command đang chạy cho project đó. | Nút hành động chính và nút `More actions` của đúng card đó bị khóa; các card khác không đổi. Nút xác nhận trong hộp thoại đang mở đổi nhãn thành `Renaming…` hoặc `Removing…` và hộp thoại không đóng được cho tới khi backend trả lời. |
| `Lỗi — không tải được danh sách` | `list_projects` trả `persistenceFailed`. | Vùng `role="alert"` thay cho lưới: `XWork couldn't load your projects.` cùng nút `Try again` gọi lại truy vấn. Đầu trang vẫn hiển thị. |
| `Lỗi — tích hợp khi tải` | `list_projects` trả `unauthorizedWindow`, `invalidSearch` hoặc lỗi không nhận dạng được. | Cùng vùng `role="alert"` nhưng thông điệp là `XWork ran into a problem it cannot recover from. Restart XWork.` và không có nút thử lại. |
| `Lỗi — thao tác thất bại` | Một command thao tác trả lỗi có thể thử lại. | Dòng `role="alert"` ngay dưới đầu trang, nêu tên project và nguyên nhân theo bảng ở `Contract với backend`, kèm nút khắc phục khi có. Dòng này bị xóa khi thao tác kế tiếp bắt đầu, khi danh sách được làm mới thành công hoặc khi người dùng đóng nó. |
| `Lỗi — trong hộp thoại` | `rename_project` hoặc `remove_project` trả lỗi trong lúc hộp thoại đang mở. | Hộp thoại vẫn mở, dòng `role="alert"` màu `error` phía trên footer, nút xác nhận trở lại nhãn thường và bấm được ngay. Lỗi khiến hộp thoại vô nghĩa — `projectNotFound` — thì đóng hộp thoại và chuyển thông điệp ra dòng lỗi của trang. |
| `Sidebar — đang tải lần đầu` | Store chưa có kết quả nào. | Khối `Projects` giữ nhãn và nút `+`, phần danh sách là một vùng `role="status"` chứa chữ ẩn thị giác `Loading your projects…`. |
| `Sidebar — rỗng` | Truy vấn gần nhất trả về `0` project. | Giữ nguyên câu của `FE-001`: `No projects yet. Add a folder to start a session.` |
| `Sidebar — lỗi tải` | Truy vấn gần nhất thất bại. | Câu `Couldn't load projects.` cỡ `12px` màu `muted-soft` cùng nút dạng liên kết `Try again`. Không hiển thị chi tiết kỹ thuật. |
| `Sidebar — hàng Unavailable` | `availability.status === "unavailable"`. | Tên chuyển màu `muted`, badge phải là icon cảnh báo màu `--color-warn-ink` kèm chữ ẩn thị giác `Folder unavailable`. Hàng vẫn bấm được và vẫn điều hướng. |
| `Sidebar — hàng đang mở` | Route hiện tại là `/projects/:projectId` của đúng project đó. | `NavLink` đặt `aria-current="page"`; hàng dùng nền `cream-strong` giống nav item đang mở của `FE-001`. |
| `Sidebar thu gọn` | `isSidebarCollapsed === true`. | Cả khối `Projects` bị ẩn, đúng hành vi `FE-001` đã dựng theo `#shell-collapsed`. Không thêm biến thể icon cho danh sách project. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Điều hướng tới `Projects` | Store truy vấn `list_projects` nếu chưa có dữ liệu; trang hiển thị đúng một trong các trạng thái ở trên. | `Không có` |
| Gõ vào ô tìm kiếm | Giá trị hiển thị đổi ngay; sau `200ms` không gõ thêm, `list_projects(search)` được gọi với chuỗi đã làm sạch. Lưới đổi theo kết quả; sidebar không đổi. | `Không có` |
| Bấm `Clear search` hoặc nhấn `Esc` trong ô tìm kiếm | Xóa query, hủy debounce đang chờ, lưới trở về danh sách đầy đủ của store, focus giữ trong ô tìm kiếm. | `Esc` |
| Bấm `Add Project` ở đầu trang hoặc `+` trên sidebar | Gọi `add_project`; cả hai điểm vào bị khóa cho tới khi backend trả kết quả. | `Không có` |
| Chọn một folder trong picker | Điều hướng tới `/projects/:projectId` của project vừa tạo. Danh sách được làm mới nhờ `projects://changed`. | `Không có` |
| Hủy picker | Trở về nguyên trạng, không thông điệp, focus quay lại đúng nút đã mở picker. | `Esc` trong hộp thoại hệ điều hành |
| Bấm `Open` trên card | Điều hướng tới `/projects/:projectId`. Không gọi command nào. | `Enter` / `Space` khi nút đang focus |
| Bấm `More actions` | Mở menu thao tác; mũi tên lên/xuống di chuyển giữa item, `Enter` chọn, `Esc` đóng và trả focus về nút. | `Enter` / `Space` mở, `Esc` đóng |
| Chọn `Rename project…` | Menu đóng, hộp thoại đổi tên mở với input đặt sẵn tên hiện tại và toàn bộ văn bản được chọn. | `Không có` |
| Xác nhận đổi tên | Gọi `rename_project`; thành công thì đóng hộp thoại, làm mới danh sách và trả focus về nút `More actions` của card đó. | `Enter` trong input |
| Chọn `Pin project` / `Unpin project` | Gọi `set_project_pinned` với giá trị đảo. Thành công thì danh sách được làm mới và card đổi vị trí; focus vẫn ở nút `More actions` của card đó. | `Không có` |
| Chọn `Open folder` | Gọi `open_project_folder`; hệ điều hành mở folder. Item này bị vô hiệu hóa khi project đang `Unavailable`. | `Không có` |
| Chọn `Locate folder…` từ menu hoặc bấm `Locate folder…` trên card | Gọi `locate_project_folder`; picker mở để chọn folder mới. Thành công thì danh sách được làm mới và card trở về `Available`. Hủy picker không đổi gì. | `Không có` |
| Chọn `Remove Project` | Menu đóng, `get_remove_project_impact` được gọi, hộp thoại xác nhận mở khi có kết quả. Trong lúc chờ, nút `More actions` của card bị khóa. | `Không có` |
| Xác nhận `Remove Project` trong hộp thoại | Gọi `remove_project(projectId, true)`; thành công thì đóng hộp thoại, làm mới danh sách và đưa focus về ô tìm kiếm vì card gốc đã biến mất. | `Không có` |
| Bấm `Cancel` hoặc `Esc` trong một hộp thoại | Đóng hộp thoại, không gọi command, trả focus về nút `More actions` của card đã mở nó. Trong lúc một command đang chạy thì `Esc` và bấm ra ngoài không đóng được. | `Esc` |
| Bấm một hàng project trên sidebar | Điều hướng tới `/projects/:projectId`. Không mở rộng gì và không gọi command. | `Enter` / `Space` khi hàng đang focus |
| Di chuyển focus bằng `Tab` trong vùng nội dung | Thứ tự là ô tìm kiếm → `Clear search` khi có → `Add Project` → dòng lỗi thao tác khi có → từng card theo thứ tự lưới, trong mỗi card là nút hành động chính rồi nút `More actions`. Mọi thành phần focus có viền focus rõ ràng. | `Tab` / `Shift+Tab` |
| Thêm, đổi tên, ghim, gỡ hoặc chọn lại folder ở nơi khác trong ứng dụng | `projects://changed` làm store truy vấn lại và, nếu ô tìm kiếm đang có query, làm trang chạy lại truy vấn tìm kiếm. | `Không có` |
| Đưa cửa sổ chính trở lại foreground | Sự kiện `focus` của cửa sổ làm store truy vấn lại, bắt kịp thay đổi availability xảy ra ngoài ứng dụng. | `Không có` |

## Luồng chính

### Tải và làm mới danh sách

1. `SidebarProjectList` mount cùng shell và đăng ký consumer đầu tiên của store; store gọi `list_projects()` không tham số.
2. Store đăng ký đúng một listener `projects://changed` và một listener `focus` của cửa sổ khi số consumer chuyển từ `0` lên `1`.
3. `ProjectsRoute` mount khi người dùng vào `/projects` và đăng ký consumer thứ hai. Store không truy vấn lại nếu đã có dữ liệu; trang dùng ngay danh sách đang có.
4. Mỗi tín hiệu `projects://changed` hoặc `focus` làm store gọi lại `list_projects()`. Store dùng một token tăng dần và chỉ áp dụng kết quả của lần gọi mới nhất.
5. Khi số consumer trở về `0`, store hủy cả hai listener và bỏ qua mọi kết quả còn đang bay. Dữ liệu đã tải được giữ lại để lần mount sau không nháy trạng thái rỗng.

### Tìm kiếm

1. Người dùng gõ vào ô tìm kiếm; giá trị hiển thị đổi ngay lập tức.
2. Hook làm sạch chuỗi: bỏ mọi control character, cắt còn `256` Unicode scalar value, trim hai đầu.
3. Nếu chuỗi sau khi làm sạch rỗng, hook hủy debounce đang chờ và trả về danh sách của store; không gọi command.
4. Nếu khác rỗng, sau `200ms` im lặng hook gọi `list_projects(search)` và chỉ áp dụng kết quả của lần gọi mới nhất.
5. `projects://changed` và nút `Try again` làm hook chạy lại truy vấn với query hiện tại.

### Thêm project

1. Người dùng bấm `Add Project` hoặc `+`; cờ dùng chung trong store bật và cả hai điểm vào bị khóa.
2. `BE-003` mở folder picker native. Không có bước giao diện nào trong lúc picker mở, ngoài nhãn nút đã đổi.
3. Kết quả `{ outcome: "cancelled" }` tắt cờ và trả focus cho đúng nút đã mở picker.
4. Kết quả `{ outcome: "selected", project }` điều hướng tới `/projects/:projectId`. `BE-003` phát `projects://changed` với `change: "added"` sau commit nên danh sách tự làm mới.
5. Lỗi được phân loại theo bảng ở mục sau: nhóm thử lại được hiển thị ở dòng lỗi thao tác và mở khóa nút; nhóm tích hợp hiển thị thông điệp không khắc phục được.

### Đổi tên

1. Chọn `Rename project…` đóng menu và mở hộp thoại với input đặt sẵn `displayName` hiện tại, toàn bộ văn bản được chọn.
2. Frontend validate ngay khi gõ: trim hai đầu, độ dài `1..=255` Unicode scalar value, không có control character. Nút `Rename` bị khóa khi không hợp lệ hoặc khi giá trị sau trim không đổi.
3. Xác nhận gọi `rename_project(projectId, displayName)`. Nút đổi nhãn thành `Renaming…` và hộp thoại không đóng được trong lúc chờ.
4. Thành công thì hộp thoại đóng, store làm mới nhờ `projects://changed`, focus trả về nút `More actions` của card.
5. `invalidDisplayName` giữ hộp thoại mở kèm dòng lỗi; `projectNotFound` đóng hộp thoại và đưa thông điệp ra dòng lỗi của trang.

### Chọn lại folder

1. `Locate folder…` gọi `locate_project_folder(projectId)`; nút hành động của card bị khóa trong lúc chờ.
2. `BE-003` mở picker. `{ outcome: "cancelled" }` giữ nguyên project và không hiển thị thông điệp nào.
3. `{ outcome: "selected", project }` giữ nguyên ID, tên, ghim và timestamp; chỉ đường dẫn đổi. Card trở về `Available` sau khi danh sách làm mới.
4. `projectAlreadyExists` hiển thị `That folder is already another project in XWork.` kèm nút `Open project` điều hướng tới `project_id` trong payload lỗi.
5. Feature không điều hướng đi đâu sau khi chọn lại folder thành công; người dùng ở lại trang `Projects`.

### Gỡ project

1. Chọn `Remove Project` đóng menu và gọi `get_remove_project_impact(projectId)`.
2. Thất bại ở bước này không mở hộp thoại: `runtimeInspectionFailed` hiển thị `XWork couldn't check what is still running for {name}.` kèm nút `Try again` ở dòng lỗi thao tác. Không cho xác nhận bằng dữ liệu thiếu.
3. Thành công thì hộp thoại mở với nội dung `#dlg-remove-project`: tiêu đề `Remove {displayName} from XWork?`, đoạn `The folder {rootPath} and every file in it stay exactly where they are. XWork only forgets the project. Notes and events linked to it stay, unlinked.`
4. Khối facts chỉ render khi có count khác `0`: `{n} sessions will be stopped first.`, `{n} running processes will be stopped.`, `{n} files with unsaved changes will lose them.` Khi cả ba count bằng `0`, hộp thoại chỉ có đoạn mô tả.
5. Xác nhận gọi `remove_project(projectId, true)`. Feature không bao giờ gọi với `confirmed = false`; nếu vẫn nhận `confirmationRequired`, hộp thoại dựng lại khối facts từ `impact` trong payload lỗi và yêu cầu người dùng xác nhận lại.
6. Thành công thì hộp thoại đóng, `projects://changed` với `change: "removed"` làm danh sách làm mới, focus về ô tìm kiếm. `runtimeCleanupFailed` giữ project và hộp thoại mở kèm dòng lỗi cho thử lại.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `list_projects` | `{ search?: string }`; chỉ gửi `search` khi query sau khi làm sạch khác rỗng | `ProjectDto[]` | `persistenceFailed` → vùng lỗi có `Try again`. `unauthorizedWindow`, `invalidSearch` và lỗi không nhận dạng được → lỗi tích hợp, không thử lại. |
| `add_project` | `Không có` | `ProjectFolderSelectionDto` | Xem bảng phân loại `Add Project`. |
| `rename_project` | `{ projectId: string, displayName: string }` | `ProjectDto` | Xem bảng phân loại thao tác. |
| `set_project_pinned` | `{ projectId: string, isPinned: boolean }` | `ProjectDto` | Xem bảng phân loại thao tác. |
| `open_project_folder` | `{ projectId: string }` | `void` | Xem bảng phân loại thao tác. |
| `locate_project_folder` | `{ projectId: string }` | `ProjectFolderSelectionDto` | Xem bảng phân loại thao tác. |
| `get_remove_project_impact` | `{ projectId: string }` | `RemoveProjectImpactDto` | Xem bảng phân loại thao tác. |
| `remove_project` | `{ projectId: string, confirmed: boolean }`; feature luôn gửi `true` | `RemoveProjectResultDto` | Xem bảng phân loại thao tác. |

Feature không gọi `get_project` và `open_project`; hai command đó thuộc `FE-005`.

Phân loại `ProjectsError` cho `add_project` — giống hệt bảng của `FE-002` để hai điểm vào cùng nói một chuyện:

| Mã lỗi | Thông điệp hiển thị | Hành động khắc phục |
|---|---|---|
| `folderPickerFailed` | `XWork couldn't open the folder picker. Try again.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "missing"` | `That folder no longer exists. Pick another folder.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "notDirectory"` | `That path is a file, not a folder. Pick a folder.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "fileSystemRoot"` | `A drive root can't be a project. Pick a folder inside it.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "accessDenied"` | `XWork can't read that folder. Check its permissions or pick another folder.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason` là `notAbsolute`, `notUtf8` hoặc `cannotCanonicalize` | `XWork can't use that folder's path. Pick another folder.` | Bấm lại `Add Project`. |
| `invalidDisplayName` | `XWork couldn't use that folder's name. Pick a different folder.` | Bấm lại `Add Project`. |
| `projectAlreadyExists` | `That folder is already a project in XWork.` | Nút `Open project` dùng `project_id` trong payload. |
| `clockFailed`, `persistenceFailed` | `XWork couldn't save the project. Try again.` | Bấm lại `Add Project`. |
| `unauthorizedWindow` và mọi payload không nhận dạng được | `XWork ran into a problem it cannot recover from. Restart XWork.` | Không có; không thử lại. |

Phân loại `ProjectsError` cho sáu command thao tác. `{name}` là `displayName` của project mục tiêu:

| Mã lỗi | Command phát sinh | Thông điệp hiển thị | Hành động khắc phục |
|---|---|---|---|
| `invalidProjectId` | Mọi command thao tác | `XWork ran into a problem it cannot recover from. Restart XWork.` | Không có. ID chỉ đến từ `ProjectDto` nên lỗi này là sai boundary, không phải input người dùng. |
| `projectNotFound` | Mọi command thao tác | `{name} is no longer in XWork.` | Đóng menu và hộp thoại đang mở, làm mới danh sách. Không có nút thử lại. |
| `invalidDisplayName` | `rename_project` | `Enter a name between 1 and 255 characters, without control characters.` | Giữ hộp thoại mở và cho sửa lại. |
| `removalInProgress` | Mọi command thao tác | `{name} is being removed. Wait for that to finish.` | Không thử lại; chờ lần làm mới kế tiếp. |
| `projectUnavailable` | `open_project_folder` | `XWork can't open that folder any more.` cùng nút `Locate folder…`. | Làm mới danh sách để card chuyển sang `Unavailable`. |
| `openFolderFailed` | `open_project_folder` | `XWork couldn't open the folder for {name}. Try again.` | Chọn lại `Open folder`. |
| `folderPickerFailed` | `locate_project_folder` | `XWork couldn't open the folder picker. Try again.` | Bấm lại `Locate folder…`. |
| `invalidProjectFolder` | `locate_project_folder` | Cùng sáu thông điệp theo `reason` như bảng `Add Project`. | Bấm lại `Locate folder…`. |
| `projectAlreadyExists` | `locate_project_folder` | `That folder is already another project in XWork.` | Nút `Open project` dùng `project_id` trong payload. |
| `confirmationRequired` | `remove_project` | Không có thông điệp riêng. | Dựng lại khối facts từ `impact` trong payload và yêu cầu xác nhận lại. |
| `runtimeInspectionFailed` | `get_remove_project_impact`, `remove_project` | `XWork couldn't check what is still running for {name}.` | Nút `Try again`; không mở hộp thoại xác nhận bằng dữ liệu thiếu. |
| `runtimeCleanupFailed` | `remove_project` | `XWork couldn't stop everything for {name}, so it was not removed.` | Giữ hộp thoại mở; nút xác nhận đổi thành `Try again`. |
| `clockFailed`, `persistenceFailed` | Mọi command thao tác | `XWork couldn't save that change. Try again.` | Thử lại đúng thao tác đó. |
| `unauthorizedWindow`, `invalidSearch` và mọi payload không nhận dạng được | Mọi command thao tác | `XWork ran into a problem it cannot recover from. Restart XWork.` | Không có; không thử lại. |

`ProjectsError` là union phân biệt bằng trường `code`. Tên trường dữ liệu kèm theo lấy đúng như binding sinh ra, cụ thể `project_id` cho `projectNotFound`, `projectAlreadyExists` và `removalInProgress`, `reason` cho `invalidProjectFolder` và `projectUnavailable`, `impact` cho `confirmationRequired`. Không viết lại kiểu này bằng tay.

Ánh xạ `ProjectUnavailableReasonDto` sang dòng lý do trên card:

| `reason` | Dòng lý do trên card |
|---|---|
| `missing` | `Folder not found.` |
| `notDirectory` | `That path is no longer a folder.` |
| `accessDenied` | `XWork can't read that folder.` |
| `io` | `XWork couldn't check that folder.` |

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `projects://changed` | `ProjectChangedEventDto` | Sau mỗi mutation project commit thành công, gồm add, rename, pin, open, locate và remove. | Coi payload là khóa vô hiệu hóa cache, không áp trực tiếp: store gọi lại `list_projects()` và trang gọi lại truy vấn tìm kiếm nếu đang có query. Không đọc `change` hay `projectId` để tự sửa danh sách trong bộ nhớ. |

### Contract sẽ nối thêm ở giai đoạn sau

Ghi ở đây để lát cắt sau không phải suy đoán; ở lát cắt này không có dòng nào trong bảng được gọi.

| Command | Nguồn | Card hiển thị gì khi nối | Điều kiện gọi |
|---|---|---|---|
| `get_project_git_summary` | `BE-004`, giai đoạn 5 | Dòng thứ ba của card: badge branch từ `head`, rồi `clean` khi `changed_count` bằng `0` hoặc `{changed_count} changed` khi khác `0`; `Not a Git repository` cho `repositoryKind: "notRepository"`; `Bare repository` cho `bare`; `Git status unavailable` kèm `Retry` cho `GitInspectionFailed`. | Chỉ gọi cho card `Available`, mỗi project một lần khi route mount, khi cửa sổ lấy focus và khi nhận `projects://changed`. |
| Public query session của `BE-005` | `BE-005`, giai đoạn 8 | Hàng đáy bên trái: `No sessions`, `1 session` hoặc `{n} sessions` kèm chỉ báo trạng thái; hàng session con trên sidebar thuộc `FE-006`. | Theo contract `BE-005` khi capability đó tồn tại. |

## State frontend

```ts
// Chỉ ghi hình dạng state và chữ ký action, không ghi implementation.
type ProjectListStatus = "idle" | "loading" | "ready" | "failed";

type ProjectListFailure = { kind: "retryable" | "integration"; message: string };

type AddProjectFailure =
  | { kind: "retryable"; message: string }
  | { kind: "duplicate"; message: string; projectId: string }
  | { kind: "integration"; message: string };

interface ProjectsState {
  status: ProjectListStatus;
  projects: ProjectDto[];
  failure: ProjectListFailure | null;
  isAdding: boolean;
  addFailure: AddProjectFailure | null;
  consumerCount: number;
  acquire(): void;
  release(): void;
  refresh(): void;
  beginAdd(): boolean;
  endAdd(failure: AddProjectFailure | null): void;
}

type ProjectOperation = "rename" | "pin" | "openFolder" | "locate" | "impact" | "remove";

type ProjectActionFailure =
  | { kind: "retryable"; message: string; retry: ProjectOperation | null }
  | { kind: "duplicate"; message: string; projectId: string }
  | { kind: "gone"; message: string }
  | { kind: "integration"; message: string };

interface ProjectActions {
  pendingProjectId: string | null;
  pendingOperation: ProjectOperation | null;
  failure: ProjectActionFailure | null;
  renameTarget: ProjectDto | null;
  removeTarget: { project: ProjectDto; impact: RemoveProjectImpactDto } | null;
  openRename(project: ProjectDto): void;
  closeRename(): void;
  rename(projectId: string, displayName: string): Promise<void>;
  togglePinned(project: ProjectDto): Promise<void>;
  openFolder(project: ProjectDto): Promise<void>;
  locateFolder(project: ProjectDto): Promise<void>;
  requestRemove(project: ProjectDto): Promise<void>;
  closeRemove(): void;
  confirmRemove(projectId: string): Promise<void>;
  dismissFailure(): void;
}

interface ProjectSearchResult {
  query: string;
  projects: ProjectDto[];
  status: ProjectListStatus;
  failure: ProjectListFailure | null;
  setQuery(next: string): void;
  clear(): void;
  refresh(): void;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `projects`, `status`, `failure` | Backend qua `list_projects` | Danh sách không lọc, chỉ giữ trong bộ nhớ, không persist trong webview. Lấy lại khi consumer đầu tiên mount, khi nhận `projects://changed` và khi cửa sổ được focus. Không suy diễn từ payload event và không tự sửa phần tử trong danh sách sau một mutation. |
| `consumerCount` | UI tạm thời | Quyết định số lượng đăng ký event. Chuyển `0 → 1` thì đăng ký, `1 → 0` thì hủy. Dữ liệu đã tải được giữ để lần mount sau không nháy. |
| `isAdding`, `addFailure` | UI tạm thời | Dùng chung cho hai điểm vào `Add Project`. `beginAdd` trả `false` khi đã có luồng đang chạy, và đó là chỗ duy nhất chặn picker thứ hai. |
| `pendingProjectId`, `pendingOperation` | UI tạm thời | Chỉ một thao tác chạy tại một thời điểm cho mỗi project; card đó bị khóa và menu của nó không mở được. |
| `renameTarget`, `removeTarget` | UI tạm thời cùng dữ liệu backend | `renameTarget` là bản chụp `ProjectDto` lúc mở hộp thoại. `removeTarget.impact` luôn là kết quả mới nhất của `get_remove_project_impact` hoặc `impact` trong `confirmationRequired`; không bao giờ là dữ liệu tự dựng. |
| `query`, kết quả tìm kiếm | UI tạm thời cùng dữ liệu backend | Query chỉ sống trong lúc trang mount và không được lưu lại. Kết quả luôn đến từ `list_projects(search)`, không lọc thêm ở frontend. |
| Nhãn breadcrumb | Bảng route của `FE-001` | Luôn là `Projects`; feature không ghi vào state của shell. |

Store và cả ba hook dùng một token tăng dần cho mỗi lần gọi và bỏ qua kết quả không thuộc lần gọi mới nhất, nên một truy vấn chậm không ghi đè kết quả mới hơn. Store export một hàm reset để mỗi test không quan sát state của test khác, giống `resetShellStore` của `FE-001`.

## Contract công khai của feature

```ts
// src/features/projects/projects-route.tsx
export function ProjectsRoute(): JSX.Element;

// src/features/projects/sidebar-project-list.tsx
export function SidebarProjectList(): JSX.Element;

// src/lib/ipc/projects.ts
export function listProjects(search?: string): Promise<ProjectDto[]>;
export function addProject(): Promise<ProjectFolderSelectionDto>;
export function renameProject(projectId: string, displayName: string): Promise<ProjectDto>;
export function setProjectPinned(projectId: string, isPinned: boolean): Promise<ProjectDto>;
export function openProjectFolder(projectId: string): Promise<void>;
export function locateProjectFolder(projectId: string): Promise<ProjectFolderSelectionDto>;
export function getRemoveProjectImpact(projectId: string): Promise<RemoveProjectImpactDto>;
export function removeProject(projectId: string, confirmed: boolean): Promise<RemoveProjectResultDto>;
export function onProjectsChanged(
  handler: (event: ProjectChangedEventDto) => void,
): Promise<UnlistenFn>;
```

`ProjectsRoute` và `SidebarProjectList` là hai export duy nhất mà `src/app/` được phép dùng từ feature này. `ProjectCard`, `ProjectActionsMenu`, hai hộp thoại, store và bốn hook là implementation nội bộ. `FE-005` nằm cùng feature `src/features/projects/` nên được dùng lại `RenameProjectDialog`, `RemoveProjectDialog`, store và `use-project-actions.ts`; các feature khác không được import bất cứ thứ gì trong `src/features/projects/`.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Bấm `Add Project` ở đầu trang và `+` trên sidebar gần như đồng thời | Cờ dùng chung trong store chỉ cho một luồng chạy, nên đúng một `add_project` được gửi và đúng một folder picker mở. |
| Người dùng chọn đúng folder đã là project | Nhận `projectAlreadyExists`; dòng lỗi kèm nút `Open project` điều hướng tới project cũ. Không tạo row mới và không phát event. |
| Project bị gỡ ở nơi khác trong lúc menu của nó đang mở | Command tiếp theo trả `projectNotFound`; menu và hộp thoại đóng, dòng lỗi hiển thị `{name} is no longer in XWork.`, danh sách được làm mới. |
| Folder bị xóa bên ngoài trong lúc trang đang mở | Không có event nào phát. Card chỉ chuyển sang `Unavailable` ở lần làm mới kế tiếp: khi cửa sổ lấy focus, khi nhận `projects://changed`, hoặc ngay lập tức nếu người dùng chọn `Open folder` và nhận `projectUnavailable`. |
| Hủy picker của `Locate folder…` | Project giữ nguyên đường dẫn cũ, card vẫn `Unavailable`, không hiển thị thông điệp nào. |
| Chọn lại folder cho project mà đường dẫn cũ vẫn hợp lệ | `BE-003` cho phép; card đổi đường dẫn và giữ nguyên tên, ghim và timestamp. Không có cảnh báo riêng. |
| Chọn lại đúng folder hiện tại | `BE-003` coi là no-op, không ghi database và không phát event. Giao diện không đổi và không hiển thị lỗi. |
| Ghim rồi bỏ ghim liên tiếp rất nhanh | Card bị khóa trong lúc mỗi lời gọi chạy, nên hai lời gọi không chồng nhau; thứ tự cuối cùng luôn khớp kết quả làm mới gần nhất. |
| Ghim làm card đổi vị trí trong lưới | Card được key bằng `project.id` nên phần tử DOM được giữ và focus vẫn ở nút `More actions` của card đó. |
| Đổi tên thành đúng tên đang có | Nút `Rename` bị khóa vì giá trị sau trim không đổi; không gọi command. |
| Đổi tên trùng tên project khác | `BE-003` cho phép tên trùng; đổi tên thành công và không có cảnh báo. |
| Đổi tên bằng chuỗi chỉ có khoảng trắng | Validation frontend chặn trước khi gọi command; nút `Rename` bị khóa và dòng nhắc nêu yêu cầu độ dài. |
| Dán chuỗi rất dài vào ô tìm kiếm | Hook cắt còn `256` Unicode scalar value trước khi gửi nên `invalidSearch` không xảy ra; ô nhập vẫn giữ nguyên chữ người dùng thấy. |
| Dán chuỗi có control character hoặc ký tự ngoài BMP vào ô tìm kiếm | Control character bị bỏ; ký tự ngoài BMP được đếm theo scalar value nên một emoji là một đơn vị, khớp cách `BE-003` đếm. |
| `get_remove_project_impact` thất bại | Hộp thoại không mở. Dòng lỗi hiển thị `XWork couldn't check what is still running for {name}.` kèm `Try again`. |
| `remove_project` trả `runtimeCleanupFailed` | Project vẫn còn, hộp thoại vẫn mở, dòng lỗi nêu rõ chưa gỡ được và nút xác nhận đổi thành `Try again`. |
| `remove_project` thành công nhưng emit event thất bại | `BE-003` không đảo transaction và không báo lỗi. Feature vẫn gọi làm mới ngay sau khi command thành công nên lưới không giữ card đã bị gỡ. |
| Gỡ project cuối cùng | Lưới chuyển sang trạng thái `No projects yet`; sidebar trở về câu rỗng; route `/` của `FE-002` hiển thị lại Welcome nhờ cùng event. |
| Người dùng điều hướng khỏi `/projects` trong lúc một command đang chạy | Kết quả bị bỏ qua, không setState sau unmount; store vẫn còn consumer là sidebar nên listener không bị hủy. |
| Truy vấn cũ trả về sau truy vấn mới | Kết quả cũ bị bỏ qua nhờ token; lưới và sidebar luôn khớp lần gọi mới nhất. |
| Webview reload | Không có persistence nào; store truy vấn lại từ đầu và query tìm kiếm trở về rỗng. |
| Sidebar bị thu gọn trong lúc trang `Projects` đang mở | Khối `Projects` bị ẩn theo hành vi `FE-001`; consumer của store bị hủy đăng ký nếu component unmount, nhưng trang vẫn là consumer nên listener không bị hủy. |
| Người dùng bật `prefers-reduced-motion` | Feature không có chuyển động riêng nào để tắt; hộp thoại và menu dùng đúng hành vi component nền tảng mà `FE-001` đã cắt bỏ animation. |
| `invoke` bị từ chối vì thiếu quyền hoặc phản hồi không đúng dạng `{ code }` | Wrapper ném `IpcCallError` với `payload` bằng `null`; giao diện xử lý như lỗi tích hợp và không thử lại thành vòng lặp. |
| Có rất nhiều project | Lưới và danh sách sidebar cuộn dọc trong vùng của mình; không phân trang và không ảo hóa ở lát cắt này vì `list_projects` trả toàn bộ danh sách một lần. |

## Tiêu chí hoàn thành

- [ ] Với ít nhất ba project thật, `pnpm tauri dev` mở `/projects` và hiển thị đúng `#grid`: tiêu đề `Projects`, dòng đếm, ô tìm kiếm, nút `Add Project` và lưới card có tên, đường dẫn, chỉ báo ghim, nút hành động và nút `More actions`.
- [ ] Card không hiển thị branch, số file thay đổi, `clean`, `Not a Git repository` hay bất kỳ dòng số session nào; tìm trong `src/features/projects/` không có chuỗi nào trong nhóm đó.
- [ ] Thứ tự card và thứ tự hàng sidebar khớp đúng thứ tự `list_projects` trả về; ghim một project đưa nó lên nhóm đầu và bỏ ghim đưa nó về đúng vị trí theo thời điểm thêm, không cần khởi động lại ứng dụng.
- [ ] Ô tìm kiếm lọc theo cả tên hiển thị và đường dẫn, có debounce `200ms`, gửi `search` đã trim và bỏ control character, cắt còn `256` scalar value; `Esc` và nút `Clear search` đều xóa query và trả về danh sách đầy đủ.
- [ ] Query không khớp gì hiển thị khối `No match` với đúng query trong câu và nút `Clear search`; danh sách sidebar không bị lọc theo query.
- [ ] `Add Project` từ đầu trang và `+` trên sidebar đều mở folder picker thật của Windows; bấm cả hai gần như đồng thời chỉ mở một picker; chọn folder tạo project và điều hướng tới `/projects/:projectId`; hủy picker không tạo dữ liệu và không hiển thị thông điệp nào.
- [ ] Chọn một folder đã là project hiển thị `That folder is already a project in XWork.` kèm nút `Open project` mở đúng project cũ.
- [ ] `Rename project…` mở hộp thoại có tên hiện tại được đặt sẵn và chọn sẵn; tên rỗng, chỉ khoảng trắng, quá `255` scalar value hoặc không đổi làm nút `Rename` bị khóa; đổi tên thành công cập nhật card và hàng sidebar sau khi đóng hộp thoại.
- [ ] `Open folder` mở đúng folder bằng trình quản lý file của Windows; item này bị vô hiệu hóa trên card `Unavailable`.
- [ ] Đổi tên folder ngoài XWork rồi đưa cửa sổ trở lại foreground làm card chuyển sang `Unavailable` với badge, dòng lý do và nút `Locate folder…`; hàng sidebar tương ứng cũng có chỉ báo `Folder unavailable`.
- [ ] `Locate folder…` chọn folder mới giữ nguyên ID, tên hiển thị, trạng thái ghim và thời điểm thêm; card trở về `Available`; hủy picker không đổi gì.
- [ ] `Remove Project` gọi `get_remove_project_impact` trước khi mở hộp thoại, hiển thị đúng nội dung `#dlg-remove-project` với đường dẫn thật, và chỉ gọi `remove_project` với `confirmed = true`; sau khi gỡ, folder và toàn bộ file trên ổ đĩa vẫn còn nguyên.
- [ ] Gỡ project cuối cùng đưa lưới về `No projects yet`, sidebar về câu rỗng và route `/` về Welcome, tất cả không cần khởi động lại ứng dụng.
- [ ] Toàn bộ thao tác chính dùng được bằng bàn phím: `Tab` theo đúng thứ tự đã đặc tả, menu điều khiển bằng mũi tên và `Enter`, `Esc` đóng menu và hộp thoại, và focus luôn trả về nút `More actions` của card đã mở hộp thoại đó.
- [ ] Ba nút chỉ có icon — `More actions`, `+` trên sidebar, `Clear search` — có tooltip hiện cả khi hover và khi focus; hai glyph trạng thái ghim và `Unavailable` có chữ ẩn thị giác thay cho tooltip.
- [ ] Component test dựng `ProjectsRoute` cho đủ các trạng thái: đang tải lần đầu, có dữ liệu, rỗng vì chưa có project, rỗng vì không khớp tìm kiếm, lỗi có `Try again` từ `persistenceFailed`, và lỗi tích hợp từ `unauthorizedWindow`.
- [ ] Component test xác nhận card `Unavailable` render đúng bốn thông điệp theo `reason`, đổi nút chính thành `Locate folder…` và vô hiệu hóa `Open folder`.
- [ ] Component test xác nhận từng nhánh lỗi của sáu command thao tác hiển thị đúng thông điệp trong bảng phân loại, gồm cả `confirmationRequired` dựng lại khối facts từ `impact` trong payload.
- [ ] Test store xác nhận đúng một listener `projects://changed` và một listener `focus` dù cả sidebar và trang đang mount; hủy cả hai khi consumer cuối cùng unmount; kết quả của truy vấn cũ bị bỏ qua.
- [ ] `src/app/app-router.test.tsx` và `src/app/app-sidebar.test.tsx` được cập nhật: route `/projects` render `ProjectsRoute`, khối `Projects` render `SidebarProjectList`, các route và phần sidebar còn lại giữ nguyên hành vi của `FE-001`.
- [ ] Không có DTO hoặc error type viết tay cho Projects; toàn bộ kiểu đến từ `src/bindings/projects/projects.ts` và file này không bị sửa tay.
- [ ] Không có persistence nào trong webview: tìm trong `src/features/projects/` không có `localStorage`, `sessionStorage`, `indexedDB` hoặc `document.cookie`.
- [ ] Không có màu hardcode trong feature; badge và dòng lý do `Unavailable` dùng `--color-warn-surface` và `--color-warn-ink` khai báo trong `src/index.css`.
- [ ] `src-tauri/` không thay đổi trong lát cắt này, gồm cả `capabilities/main.json` và `tauri.conf.json`.
- [ ] Mọi function, component, hook, callback và test mới có comment ngắn nêu mục đích; chỗ có invariant như bỏ qua kết quả cũ, đếm consumer và chặn picker thứ hai có comment giải thích.
- [ ] Trên Windows, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint:rust`, `pnpm test:rust` và `pnpm tauri build` đều pass.
- [ ] Smoke test thủ công trên Windows xác nhận folder picker và trình quản lý file mở thật, project không khả dụng phục hồi được bằng `Locate folder…`, gỡ project không xóa file trên ổ đĩa, và ẩn cửa sổ xuống tray rồi mở lại vẫn hiển thị đúng danh sách; kiểm tra macOS hoãn tới bước chuẩn bị phát hành theo quy tắc project.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/projects/projects-route.test.tsx` | Component | Đầu trang và dòng đếm theo dữ liệu; sáu trạng thái hiển thị của lưới; tìm kiếm gọi `list_projects(search)` đúng một lần sau debounce; `Esc` và `Clear search` xóa query; `Try again` gọi lại đúng một lần; mở và đóng hai hộp thoại; dòng lỗi thao tác xuất hiện và bị xóa đúng lúc; thứ tự `Tab` trong vùng nội dung. |
| `src/features/projects/project-card.test.tsx` | Component | Tên, đường dẫn kèm `title` đầy đủ, chỉ báo ghim có chữ ẩn thị giác; nhánh `Available` có `Open`, nhánh `Unavailable` có badge, bốn dòng lý do theo `reason` và nút `Locate folder…`; card bị khóa khi có thao tác đang chạy. |
| `src/features/projects/project-actions-menu.test.tsx` | Component | Đủ năm item theo đúng thứ tự; nhãn ghim đổi theo `isPinned`; `Open folder` bị vô hiệu hóa khi `Unavailable`; điều khiển bằng mũi tên và `Enter`; `Esc` đóng và trả focus về nút mở. |
| `src/features/projects/rename-project-dialog.test.tsx` | Component | Giá trị đặt sẵn và được chọn sẵn; nút `Rename` bị khóa với tên rỗng, chỉ khoảng trắng, quá `255` scalar value và tên không đổi; `invalidDisplayName` giữ hộp thoại mở kèm dòng lỗi; `projectNotFound` đóng hộp thoại; focus trả về nút `More actions`. |
| `src/features/projects/remove-project-dialog.test.tsx` | Component | Tiêu đề và đoạn mô tả có đúng tên và đường dẫn; khối facts chỉ render khi count khác `0` và dùng đúng dạng số ít/số nhiều; chỉ gọi `remove_project` với `confirmed = true`; `confirmationRequired` dựng lại facts từ payload; `runtimeCleanupFailed` giữ hộp thoại mở với nút `Try again`. |
| `src/features/projects/sidebar-project-list.test.tsx` | Component | Danh sách hàng theo đúng thứ tự backend; chỉ báo ghim và `Folder unavailable` có chữ ẩn thị giác; hàng đang mở mang `aria-current="page"`; trạng thái rỗng giữ đúng câu của `FE-001`; trạng thái đang tải và trạng thái lỗi có `Try again`; nút `+` gọi luồng `Add Project`; bấm một hàng điều hướng tới `/projects/:projectId`. |
| `src/features/projects/projects-store.test.ts` | Unit | Bao cả `use-projects.ts` vì hook đó chỉ là lớp mỏng gọi `acquire`/`release`: truy vấn một lần khi consumer đầu tiên mount; đúng một listener mỗi loại dù có hai consumer; hủy cả hai khi consumer cuối cùng unmount; mỗi tín hiệu kích hoạt đúng một truy vấn; kết quả cũ bị bỏ qua; `beginAdd` trả `false` khi đã có luồng đang chạy; hàm reset trả state về mặc định. |
| `src/features/projects/use-project-search.test.ts` | Unit | Bỏ control character và cắt còn `256` scalar value trước khi gửi; debounce gộp nhiều lần gõ thành một lời gọi; query rỗng không gọi command và trả về danh sách của store; kết quả cũ bị bỏ qua; `projects://changed` chạy lại truy vấn với query hiện tại. |
| `src/features/projects/use-add-project.test.ts` | Unit | Hai điểm vào chỉ gửi một `add_project`; từng `ProjectsError` được phân loại đúng nhóm và thông điệp; `cancelled` không tạo thông điệp; `selected` điều hướng tới `/projects/:projectId`; `projectAlreadyExists` giữ đúng `project_id`. |
| `src/features/projects/use-project-actions.test.ts` | Unit | Nhánh thành công của năm thao tác gọi đúng command với đúng tham số và yêu cầu làm mới; thao tác thứ hai trên cùng project bị chặn khi thao tác trước còn chạy; từng lỗi được phân loại đúng nhóm khắc phục; `get_remove_project_impact` thất bại không mở hộp thoại. |
| `src/lib/ipc/projects.test.ts` | Unit | Gọi đúng tên tám command; hình dạng tham số camelCase đúng cho từng command; `list_projects` bỏ trống `search` khi không truyền; `remove_project` truyền đúng `confirmed`; đăng ký đúng tên event `projects://changed`; lỗi dạng `{ code }` giữ nguyên payload, lỗi lạ cho `payload` bằng `null`. |
| `src/app/app-router.test.tsx` | Component | Route `/projects` render `ProjectsRoute` với các command được mock; `/projects/:projectId` và các route còn lại giữ nguyên hành vi của `FE-001`. |
| `src/app/app-sidebar.test.tsx` | Component | Khối `Projects` render `SidebarProjectList`; câu rỗng vẫn xuất hiện khi không có project; khối vẫn bị ẩn khi sidebar thu gọn; điều hướng, tooltip và vạch kéo của `FE-001` không đổi. |

Hành vi của folder picker native, của trình quản lý file hệ điều hành và của việc show lại cửa sổ từ tray được xác nhận bằng smoke test thủ công trên Windows với bản build thật; automated test không thay thế bước này.

## Câu hỏi mở

Không có.
