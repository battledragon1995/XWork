# FE-002 — Welcome

Tài liệu này đặc tả contract frontend cho màn hình Welcome lần đầu sử dụng: điều kiện hiển thị, ba hành động của `§5.1`, luồng `Add Project` thật qua `BE-003` và cách route `/` chọn giữa Welcome và Home. Feature không sở hữu dữ liệu project; mọi thao tác đi qua command và event của `BE-003`.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-002` |
| Phase | `1` |
| Khu vực chính | `src/features/home/` |
| Yêu cầu chức năng | `§5.1`, `§5.2`, `§7.2`; áp dụng yêu cầu tương tác chung tại `§18` |
| Wireframe | `01-Wireframe/02-AppShell.html#welcome` |
| Backend liên quan | `BE-003` |
| Phụ thuộc | `FE-001` |

## Mục tiêu

Người dùng mở XWork lần đầu và thấy màn hình Welcome tối giản trong vùng nội dung của shell: một câu giới thiệu ngắn, hành động chính `Add Project` mở folder picker thật và đăng ký project, cùng hai điểm vào phụ `Open Quick Note` và `See keyboard shortcuts`. Ngay khi có project đầu tiên, route `/` tự chuyển sang khu vực Home mà không cần thao tác thêm; gỡ hết project đưa Welcome trở lại.

### Quyết định và giả định đã chốt

- FE-002 sở hữu `element` của index route `/`. `app-router.tsx` trỏ route này sang `HomeRoute`, public entry của `src/features/home/`. `HomeRoute` quyết định nhánh hiển thị theo dữ liệu; `FE-003` ở giai đoạn 14 chỉ thay nhánh "đã có dữ liệu" bên trong feature và không đụng bảng route.
- Nhánh "đã có dữ liệu" ở lát cắt này là `HomePlaceholder` nằm trong `src/features/home/`, không dùng `AreaPlaceholder` của `src/app/`: quy tắc phụ thuộc cấm feature import từ `src/app/`. Nội dung chữ giữ nguyên như placeholder cũ (`Home`, `This area arrives with FE-003.`) để hành vi quan sát được không đổi khi có project.
- Điều kiện Welcome ở giai đoạn 4 là `list_projects` trả về danh sách rỗng. Đây là toàn bộ dữ liệu tồn tại ở Phase 1. `FE-019` và `FE-021` phải bổ sung điều kiện note và event vào cùng một predicate khi tới phase của mình; không được thêm màn hình Welcome thứ hai.
- Welcome không phải một route riêng. `§5.2` yêu cầu ứng dụng luôn mở tại `Home`, và `#welcome` cho thấy nav item `Home` đang active, nên Welcome là một trạng thái của `/`.
- Breadcrumb giữ nhãn `Home` do bảng route của `FE-001` cấp, kể cả khi nội dung là Welcome. Đây là điểm lệch có chủ ý so với `#welcome` (wireframe vẽ crumb `Welcome`); đổi crumb theo dữ liệu sẽ buộc `AppTopbar` subscribe state của một feature và tạo phụ thuộc ngược `src/app/` → `src/features/`.
- `Open Quick Note` (`BE-017`, giai đoạn 19) và `See keyboard shortcuts` (`BE-009`/`FE-014`, giai đoạn 10) chưa có backend nên hiển thị ở trạng thái chưa khả dụng, giữ đúng vị trí và nhãn wireframe, kèm tooltip nói rõ chức năng đến ở lát cắt nào. `§5.1` liệt kê đủ ba hành động nên không được ẩn chúng.
- Hai control chưa khả dụng dùng `aria-disabled="true"` và vẫn nhận focus, thay vì thuộc tính `disabled`. Đây là control có nhãn chữ nằm giữa vùng nội dung chính: người dùng bàn phím phải tới được chúng để đọc tooltip giải thích, mà phần tử `disabled` thì không nhận focus và không mở tooltip. Handler bấm thoát sớm và không gọi command nào. Điểm này khác `FE-001`, nơi pill tìm kiếm và chuông là control chỉ có icon nằm trên thanh chrome.
- Dòng gợi ý `Ctrl K opens search, Ctrl Shift N opens Quick Note anywhere` của wireframe bị ẩn ở lát cắt này. Hai tổ hợp đó chưa hoạt động: `Ctrl K` thuộc `FE-009` (giai đoạn 12) và phím tắt toàn cục cho Quick Note thuộc giai đoạn 19. `FE-014` bổ sung lại dòng này khi shortcut đọc được từ `BE-009`.
- Hình minh họa 300×200 bên phải `#welcome` được dựng lại thành SVG inline trang trí, `aria-hidden="true"`, không có nhãn và không nhận focus. Màu lấy từ token trong `src/index.css` chứ không hardcode hex, để `FE-012` đổi theme không phải sửa hình.
- Welcome không tự focus `Add Project` khi mount. Nút là phần tử focus được đầu tiên trong landmark `main` nên một lần `Tab` từ vùng nội dung là tới; tự chiếm focus khi màn hình xuất hiện lại làm gián đoạn người dùng bàn phím đang ở sidebar.
- Không tạo store dùng chung cho danh sách project ở lát cắt này. FE-002 chỉ cần biết "có hay không có project", nên hook `use-project-presence` nằm trong feature. Phần dùng chung thật sự là wrapper `src/lib/ipc/projects.ts`, và `FE-004` được phép dùng chính wrapper đó.
- Sau khi `add_project` trả `selected`, feature điều hướng tới `/projects/:projectId` theo bước 6 của `§7.2`. Feature không gọi `open_project`; `last_opened_at_ms` là việc của trang Project Overview (`FE-005`), và `BE-003` đã đặt `last_opened_at_ms = added_at_ms` ngay khi add.
- Không cần đổi `src-tauri/capabilities/main.json`. `projects://changed` là event thường nên `core:event:allow-listen` đã cấp là đủ, còn folder picker do `BE-003` mở từ Rust nên frontend không cần permission của dialog plugin.

### Ngoài phạm vi

- Dashboard Home thật với Quick Note editor, note ghim, phiên đang chạy và event sắp tới: thuộc `FE-003`.
- Trang `Projects`, card project, tìm kiếm, đổi tên, ghim, mở folder, chọn lại đường dẫn và gỡ project: thuộc `FE-004`. FE-002 chỉ dùng `list_projects` và `add_project`.
- Danh sách project thật trong sidebar: thuộc `FE-004`; khối `Projects` của shell giữ nguyên trạng thái rỗng do `FE-001` dựng.
- Cửa sổ nổi Quick Note và command mở nó: thuộc `BE-017` và `FE-020`.
- Trang Keyboard Shortcuts và việc đọc phím tắt thật: thuộc `BE-009` và `FE-014`.
- Trạng thái `Unavailable` của project, vì Welcome chỉ quan tâm số lượng project chứ không hiển thị project nào.
- Theme tối và cỡ chữ giao diện: thuộc `FE-012`.

### Contract backend còn thiếu hoặc lệch

- `BE-003` yêu cầu frontend re-query `list_projects` khi startup và khi main window được focus, nhưng `BE-001` không phát event nào báo cửa sổ chính vừa được show từ tray. FE-002 dùng sự kiện `focus` của `window` trong webview; nếu hệ điều hành không gửi focus cho webview khi show từ tray thì dữ liệu chỉ được làm mới ở lần `projects://changed` kế tiếp hoặc lần điều hướng kế tiếp. Nếu sản phẩm cần chắc chắn hơn, `BE-001` phải bổ sung một event "main window shown".
- `#welcome` vẽ breadcrumb `Welcome` còn bảng route của `FE-001` cấp nhãn `Home`. Đây là lệch đã chốt ở trên, không phải lỗi contract.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/home/home-route.tsx` | Public entry của route `/`: gọi hook presence và chọn giữa trạng thái đang tải, Welcome, Home và lỗi tải. |
| `src/features/home/welcome-screen.tsx` | Bố cục hai cột của `#welcome`: eyebrow, tiêu đề, đoạn giới thiệu, hai nút hành động, liên kết phím tắt, vùng lỗi của `Add Project` và hình minh họa. |
| `src/features/home/welcome-art.tsx` | SVG trang trí 300×200 bên phải Welcome, dùng token màu của repo và `aria-hidden="true"`. |
| `src/features/home/home-placeholder.tsx` | Nhánh "đã có project" ở lát cắt này; `FE-003` thay nội dung file này bằng dashboard thật. |
| `src/features/home/use-project-presence.ts` | Truy vấn `list_projects`, suy ra có hay không có project, đăng ký `projects://changed` và `focus` của cửa sổ, bỏ qua kết quả cũ và hủy đăng ký khi unmount. |
| `src/features/home/use-add-project.ts` | Máy trạng thái của luồng `Add Project`: chặn gọi trùng, phân loại `ProjectsError`, dựng thông điệp lỗi và điều hướng khi thành công. |
| `src/lib/ipc/projects.ts` | Wrapper cho `list_projects`, `add_project` và đăng ký event `projects://changed` của `BE-003`. |
| `src/app/app-router.tsx` | Trỏ `element` của index route `/` sang `HomeRoute`; các route khác giữ nguyên. |
| `src/bindings/projects/projects.ts` | DTO và `ProjectsError` dùng cho toàn bộ contract IPC của feature; file sinh tự động, không chỉnh tay. |
| `src/components/ui/button.tsx` | Nút nền tảng cho biến thể primary và secondary cỡ lớn của Welcome. |
| `src/components/ui/tooltip.tsx` | Tooltip nền tảng cho hai control chưa khả dụng. |
| `src/index.css` | Nguồn token màu, font và bán kính mà Welcome sử dụng; feature không thêm token mới. |
| `src/features/home/home-route.test.tsx` | Test bốn nhánh hiển thị của route `/` và việc chuyển nhánh theo event. |
| `src/features/home/welcome-screen.test.tsx` | Test nội dung, thứ tự focus, hai control chưa khả dụng và toàn bộ nhánh kết quả của `Add Project`. |
| `src/features/home/use-project-presence.test.ts` | Test đăng ký/hủy đăng ký, bỏ qua kết quả cũ và làm mới theo event và focus. |
| `src/lib/ipc/projects.test.ts` | Test tên command, hình dạng tham số, tên event và ánh xạ lỗi typed. |
| `src/app/app-router.test.tsx` | Test index route render `HomeRoute` thay vì `AreaPlaceholder`; các route còn lại không đổi. |

Feature không thêm dependency mới và không sửa `src-tauri/capabilities/main.json`, `src-tauri/tauri.conf.json` hay bất kỳ file Rust nào.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `HomeRoute` | Điểm vào route `/`; không có giao diện riêng ngoài bốn nhánh trạng thái. | `Không có` |
| `WelcomeScreen` | Lưới hai cột `minmax(0, 1.25fr) minmax(0, 1fr)`, khoảng cách `48px`, padding ngang `96px`, căn giữa theo chiều dọc; cột trái là nội dung, cột phải là hình minh họa. | `02-AppShell.html#welcome` |
| `WelcomeArt` | Hình minh họa cửa sổ XWork thu nhỏ, chỉ trang trí. | `02-AppShell.html#welcome` |
| `HomePlaceholder` | Thông báo khu vực Home sẽ đến cùng `FE-003`. | `Không có` |

Nội dung chữ lấy nguyên từ `#welcome`:

- Eyebrow: `First run`.
- Tiêu đề `h1`: `Every project, every CLI, one window.`, font `display`, cỡ `44px`, `max-width: 540px`.
- Đoạn giới thiệu: `XWork keeps Codex, Claude and your terminal side by side, one workspace per project, without leaving the keyboard. Everything stays on this machine.`, cỡ `15px`, `max-width: 440px`.
- Nút chính: `Add Project`, biến thể primary, cao `40px`, padding ngang `20px`, cỡ chữ `14px`, icon folder bên trái.
- Nút phụ: `Open Quick Note`, biến thể secondary cùng kích thước, icon bút bên trái.
- Liên kết: `See keyboard shortcuts`, cỡ `13px`, màu `brand`, render bằng `button` tạo dáng liên kết để trạng thái chưa khả dụng nhất quán với nút.

Khi bề rộng vùng nội dung nhỏ hơn `900px`, lưới thu về một cột, `WelcomeArt` bị ẩn bằng CSS và padding ngang giảm còn `48px`. Cột nội dung không bao giờ bị cắt chữ.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `Đang tải lần đầu` | `presence.status === "loading"` và chưa có kết quả nào trước đó. | Một vùng chiếm hết chiều cao mang `role="status"` và `aria-busy="true"`, chỉ chứa dòng chữ ẩn thị giác `Checking your projects…`. Không render Welcome và cũng không render Home, để không nháy giữa hai nhánh. |
| `Đang làm mới` | Có kết quả cũ và một truy vấn mới đang chạy. | Giữ nguyên nhánh đang hiển thị, không có spinner và không đổi focus. Chỉ thay nội dung khi kết quả mới về. |
| `Rỗng — chưa có project` | Truy vấn gần nhất trả về `0` project. | `WelcomeScreen` theo `#welcome`. Khối `Projects` của sidebar do `FE-001` dựng vẫn hiển thị câu rỗng của nó. |
| `Đã có project` | Truy vấn gần nhất trả về ít nhất `1` project. | `HomePlaceholder` với `h1` là `Home` và câu `This area arrives with FE-003.`. |
| `Lỗi — không tải được danh sách project` | `list_projects` trả `persistenceFailed`. | Vùng `role="alert"` chiếm hết chiều cao: `XWork couldn't load your projects.` cùng nút `Try again` gọi lại truy vấn. Không đoán nhánh Welcome hay Home. |
| `Lỗi — tích hợp khi tải` | `list_projects` trả `unauthorizedWindow`, `invalidSearch` hoặc một lỗi không nhận dạng được. | Cùng vùng `role="alert"` nhưng thông điệp là `XWork ran into a problem it cannot recover from. Restart XWork.` và không có nút thử lại. |
| `Đang chọn folder` | `addProject.status === "pending"`. | Nút chính `disabled`, nhãn đổi thành `Selecting folder…`; nút phụ và liên kết giữ nguyên; không mở picker thứ hai. |
| `Lỗi — thêm project thất bại` | `add_project` trả lỗi có thể thử lại. | Dòng `role="alert"` ngay dưới hàng nút, nêu đúng nguyên nhân theo bảng ở `Contract với backend`; nút chính trở lại `Add Project` và bấm được ngay. Bố cục không đổi. |
| `Lỗi — folder đã là project` | `add_project` trả `projectAlreadyExists`. | Dòng lỗi `That folder is already a project in XWork.` kèm nút `Open project` điều hướng tới `/projects/:projectId` bằng đúng `project_id` trong payload lỗi. |
| `Chưa khả dụng — Quick Note` | Luôn đúng ở lát cắt này. | Nút `Open Quick Note` giữ nguyên nhãn và icon, mang `aria-disabled="true"`, màu chữ mờ; tooltip `Quick Note arrives with FE-020.` hiện cả khi hover và khi focus. |
| `Chưa khả dụng — phím tắt` | Luôn đúng ở lát cắt này. | `See keyboard shortcuts` mang `aria-disabled="true"`, tooltip `Keyboard shortcuts arrive with FE-014.`; dòng gợi ý phím của wireframe không được render. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Mở XWork khi chưa có project | Route `/` chạy `list_projects` một lần rồi hiển thị `WelcomeScreen`. | `Không có` |
| Bấm `Add Project` | Gọi `add_project`, nút chuyển sang `Selecting folder…` và bị khóa cho tới khi backend trả kết quả. | `Không có` |
| Chọn một folder trong picker | Điều hướng tới `/projects/:projectId` của project vừa tạo. | `Không có` |
| Hủy picker | Trở về Welcome nguyên trạng, không có thông điệp nào, focus quay lại `Add Project`. | `Esc` trong hộp thoại hệ điều hành |
| Bấm `Try again` sau lỗi tải | Gọi lại `list_projects` một lần; trong lúc chờ nút bị khóa. | `Không có` |
| Bấm `Open project` sau lỗi trùng folder | Điều hướng tới `/projects/:projectId` lấy từ payload lỗi. | `Không có` |
| Bấm `Open Quick Note` hoặc `See keyboard shortcuts` | Không có tác dụng và không gọi command nào; tooltip giải thích lát cắt sở hữu. | `Không có` |
| Di chuyển focus bằng `Tab` trong vùng nội dung | Thứ tự là `Add Project` → `Open Quick Note` → `See keyboard shortcuts`; nếu đang có dòng lỗi kèm hành động thì nút của dòng lỗi đứng ngay sau `Add Project`. Mọi thành phần focus có viền focus rõ ràng. | `Tab` / `Shift+Tab` |
| Thêm hoặc gỡ project ở nơi khác trong ứng dụng | `projects://changed` làm route `/` truy vấn lại và đổi nhánh nếu số lượng project vượt qua mốc `0`. | `Không có` |
| Đưa cửa sổ chính trở lại foreground | Sự kiện `focus` của cửa sổ làm route `/` truy vấn lại, bắt kịp thay đổi availability và thay đổi dữ liệu xảy ra ngoài ứng dụng. | `Không có` |

## Luồng chính

### Quyết định nhánh của route `/`

1. `HomeRoute` mount và gọi `use-project-presence`; hook chạy `list_projects` không kèm `search`.
2. Trong lúc chờ, route render trạng thái `Đang tải lần đầu`.
3. Kết quả rỗng cho `WelcomeScreen`; kết quả có phần tử cho `HomePlaceholder`; lỗi cho vùng `role="alert"` tương ứng.
4. Hook đăng ký `projects://changed` và `focus` của cửa sổ. Mỗi lần nhận tín hiệu, hook chạy lại `list_projects` và chỉ áp dụng kết quả của lần gọi mới nhất.
5. Khi `HomeRoute` unmount, hook hủy cả hai đăng ký và bỏ qua mọi kết quả còn đang bay.

### Thêm project đầu tiên

1. Người dùng bấm `Add Project`; trạng thái chuyển sang `pending` và gọi `add_project`.
2. `BE-003` mở folder picker native. Không có bước giao diện nào trong lúc picker mở, ngoài nhãn nút đã đổi.
3. Kết quả `{ outcome: "cancelled" }` đưa trạng thái về `idle` và trả focus cho `Add Project`.
4. Kết quả `{ outcome: "selected", project }` điều hướng tới `/projects/:projectId`. `BE-003` phát `projects://changed` với `change: "added"` sau commit; nếu người dùng quay lại `/`, nhánh đã là Home.
5. Lỗi được phân loại theo bảng ở mục sau: nhóm thử lại được hiển thị dòng lỗi và mở khóa nút; nhóm tích hợp hiển thị thông điệp không khắc phục được và không cho thử lại.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `list_projects` | `{ search?: string }`; FE-002 luôn bỏ trống | `ProjectDto[]` | `persistenceFailed` → vùng lỗi có `Try again`. `unauthorizedWindow`, `invalidSearch` và lỗi không nhận dạng được → lỗi tích hợp, không thử lại. |
| `add_project` | `Không có` | `ProjectFolderSelectionDto` | Xem bảng phân loại bên dưới. |

Phân loại `ProjectsError` cho `add_project`:

| Mã lỗi | Thông điệp hiển thị | Hành động khắc phục |
|---|---|---|
| `folderPickerFailed` | `XWork couldn't open the folder picker. Try again.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "missing"` | `That folder no longer exists. Pick another folder.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "notDirectory"` | `That path is a file, not a folder. Pick a folder.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "fileSystemRoot"` | `A drive root can't be a project. Pick a folder inside it.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason: "accessDenied"` | `XWork can't read that folder. Check its permissions or pick another folder.` | Bấm lại `Add Project`. |
| `invalidProjectFolder` với `reason` là `notAbsolute`, `notUtf8` hoặc `cannotCanonicalize` | `XWork can't use that folder's path. Pick another folder.` | Bấm lại `Add Project`. |
| `invalidDisplayName` | `XWork couldn't use that folder's name. Pick a different folder.` | Bấm lại `Add Project`. |
| `projectAlreadyExists` | `That folder is already a project in XWork.` | Nút `Open project` dùng `project_id` trong payload; `Add Project` vẫn bấm lại được. |
| `clockFailed`, `persistenceFailed` | `XWork couldn't save the project. Try again.` | Bấm lại `Add Project`. |
| `unauthorizedWindow` và mọi payload không nhận dạng được | `XWork ran into a problem it cannot recover from. Restart XWork.` | Không có; không thử lại. |

`ProjectsError` là union phân biệt bằng trường `code`; các variant có dữ liệu kèm theo dùng tên trường đúng như binding, cụ thể `project_id` cho `projectAlreadyExists` và `reason` cho `invalidProjectFolder`. Không viết lại kiểu này bằng tay.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `projects://changed` | `ProjectChangedEventDto` | Sau mỗi mutation project commit thành công, gồm add, rename, pin, open, locate và remove. | Coi payload là khóa vô hiệu hóa cache, không áp trực tiếp: gọi lại `list_projects` và đổi nhánh nếu số lượng project vượt qua mốc `0`. Không đọc `change` hay `projectId` để suy ra trạng thái. |

Kiểu DTO và `ProjectsError` lấy từ `src/bindings/projects/projects.ts`. Listener được hủy đăng ký khi `HomeRoute` unmount.

## State frontend

```ts
// Chỉ ghi hình dạng state và chữ ký action, không ghi implementation.
type ProjectPresence =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "present" }
  | { status: "failed"; kind: "retryable" | "integration" };

interface ProjectPresenceResult {
  presence: ProjectPresence;
  refresh(): void;
}

type AddProjectFailure =
  | { kind: "retryable"; message: string }
  | { kind: "duplicate"; message: string; projectId: string }
  | { kind: "integration"; message: string };

interface AddProjectResult {
  status: "idle" | "pending";
  failure: AddProjectFailure | null;
  addProject(): Promise<void>;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `presence` | Backend qua `list_projects` | Chỉ giữ trong bộ nhớ của route đang mount, không cache và không lưu ra ngoài. Lấy lại khi mount, khi nhận `projects://changed` và khi cửa sổ được focus. Chỉ suy ra từ số lượng phần tử, không giữ bản sao danh sách project. |
| `status`, `failure` của `Add Project` | UI tạm thời | Suy ra từ kết quả `add_project`; `failure` bị xóa ngay khi lần gọi kế tiếp bắt đầu. Không bao giờ suy ra từ nội dung DOM. |
| Nhãn breadcrumb | Bảng route của `FE-001` | Luôn là `Home`; feature không ghi vào state của shell. |

Cả hai hook đều dùng một token tăng dần cho mỗi lần gọi và bỏ qua kết quả không thuộc lần gọi mới nhất, nên một truy vấn chậm không ghi đè kết quả mới hơn.

## Contract công khai của feature

```ts
// src/features/home/home-route.tsx
export function HomeRoute(): JSX.Element;

// src/lib/ipc/projects.ts
export function listProjects(search?: string): Promise<ProjectDto[]>;
export function addProject(): Promise<ProjectFolderSelectionDto>;
export function onProjectsChanged(
  handler: (event: ProjectChangedEventDto) => void,
): Promise<UnlistenFn>;
```

`HomeRoute` là export duy nhất mà `src/app/` được phép dùng từ feature này; `WelcomeScreen`, `HomePlaceholder` và hai hook là implementation nội bộ. Các wrapper trong `src/lib/ipc/projects.ts` là hạ tầng dùng chung của repo: `FE-004` được phép dùng và mở rộng chúng cho các command Projects còn lại, nhưng không import bất cứ thứ gì trong `src/features/home/`.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Bấm `Add Project` hai lần rất nhanh | Lần đầu khóa nút, nên chỉ đúng một `add_project` được gửi và chỉ một folder picker được mở. |
| `projects://changed` đến trong lúc `add_project` còn chạy | Hook presence truy vấn lại bình thường; luồng add vẫn điều hướng theo kết quả trả về của chính nó, không theo event. |
| Người dùng gỡ project cuối cùng ở trang Projects rồi quay lại `/` | Event làm presence trở về `empty` và Welcome hiện lại; không có cờ "đã qua onboarding" nào chặn điều này. |
| Emit `projects://changed` thất bại sau khi commit | `BE-003` không đảo transaction và không báo lỗi. Welcome có thể hiển thị trễ cho tới lần focus cửa sổ hoặc lần điều hướng kế tiếp. |
| Truy vấn cũ trả về sau truy vấn mới | Kết quả cũ bị bỏ qua nhờ token; nhánh hiển thị luôn khớp lần gọi mới nhất. |
| `HomeRoute` unmount trong lúc truy vấn đang chạy | Kết quả bị bỏ qua, không có setState sau unmount, cả hai listener đã hủy. |
| Webview reload | Không có persistence nào; presence được truy vấn lại từ đầu và Welcome hiện đúng theo dữ liệu thật. |
| Người dùng chọn đúng folder đã là project | Nhận `projectAlreadyExists`, hiện dòng lỗi kèm `Open project`; không tạo row mới và không phát event. |
| Cửa sổ được thu hẹp dưới `900px` | Lưới về một cột và hình minh họa bị ẩn; tiêu đề, đoạn giới thiệu, hai nút và liên kết vẫn đầy đủ và không bị cắt. |
| Người dùng bật `prefers-reduced-motion` | Welcome không có chuyển động nào để tắt; màn hình hiển thị y hệt. |
| `invoke` bị từ chối vì thiếu quyền hoặc phản hồi không đúng dạng `{ code }` | Wrapper ném `IpcCallError` với `payload` bằng `null`; giao diện xử lý như lỗi tích hợp và không thử lại thành vòng lặp. |
| Bấm `Open Quick Note` hoặc `See keyboard shortcuts` bằng `Enter` hoặc `Space` | Không có gì xảy ra, không có command nào được gọi, focus giữ nguyên trên control đó. |

## Tiêu chí hoàn thành

- [ ] Với database sạch, `pnpm tauri dev` mở XWork tại `/` và hiển thị đúng `#welcome`: eyebrow `First run`, tiêu đề `Every project, every CLI, one window.`, đoạn giới thiệu, nút `Add Project`, nút `Open Quick Note`, liên kết `See keyboard shortcuts` và hình minh họa bên phải.
- [ ] Breadcrumb hiển thị `Home` và nav item `Home` mang `aria-current="page"` trong khi nội dung là Welcome.
- [ ] Bấm `Add Project` mở folder picker thật của Windows; chọn một folder có sẵn tạo project và đưa ứng dụng tới `/projects/:projectId`; hủy picker trả về Welcome nguyên trạng, không tạo dữ liệu và không hiện thông điệp nào.
- [ ] Sau khi có project đầu tiên, quay lại `/` hiển thị `HomePlaceholder`; gỡ hết project rồi quay lại `/` hiển thị lại Welcome mà không cần khởi động lại ứng dụng.
- [ ] Chọn lại đúng folder đã là project hiển thị `That folder is already a project in XWork.` kèm nút `Open project`, và nút này mở đúng project cũ.
- [ ] `Open Quick Note` và `See keyboard shortcuts` nhận được focus bằng `Tab`, hiện tooltip cả khi hover lẫn khi focus, và bấm hay nhấn `Enter` đều không gọi command nào.
- [ ] Dòng gợi ý phím tắt của wireframe không xuất hiện; tìm trong `src/features/home/` không có chuỗi `Ctrl K` hay `Ctrl Shift N`.
- [ ] Component test dựng `HomeRoute` với `list_projects` trả mảng rỗng cho Welcome, trả một phần tử cho `HomePlaceholder`, trả `persistenceFailed` cho vùng lỗi có `Try again`, và trả `unauthorizedWindow` cho thông điệp không khắc phục được.
- [ ] Component test xác nhận `Add Project` gọi `add_project` đúng một lần dù bấm nhanh hai lần, và nhãn nút đổi thành `Selecting folder…` trong lúc chờ.
- [ ] Component test xác nhận từng nhánh lỗi của `add_project` hiển thị đúng thông điệp trong bảng phân loại, gồm cả sáu `reason` của `invalidProjectFolder`.
- [ ] Test hook xác nhận `projects://changed` và sự kiện `focus` của cửa sổ đều kích hoạt một truy vấn mới, kết quả của truy vấn cũ bị bỏ qua, và listener được hủy khi unmount.
- [ ] Test wrapper IPC xác nhận đúng tên command `list_projects` và `add_project`, đúng tên event `projects://changed`, lỗi dạng `{ code }` trở thành `IpcCallError` có `payload`, lỗi lạ trở thành `IpcCallError` với `payload` bằng `null`.
- [ ] `src/app/app-router.test.tsx` được cập nhật: index route render `HomeRoute`, sáu route còn lại vẫn render đúng `AreaPlaceholder` như trước.
- [ ] Không có DTO hoặc error type viết tay cho Projects; toàn bộ kiểu đến từ `src/bindings/projects/projects.ts` và file này không bị sửa tay.
- [ ] Không có persistence nào trong webview: tìm trong `src/features/home/` không có `localStorage`, `sessionStorage`, `indexedDB` hoặc `document.cookie`.
- [ ] `src-tauri/` không thay đổi trong lát cắt này, gồm cả `capabilities/main.json` và `tauri.conf.json`.
- [ ] Mọi function, component, hook, callback và test mới có comment ngắn nêu mục đích; chỗ có invariant như bỏ qua kết quả cũ và chặn gọi `add_project` trùng có comment giải thích.
- [ ] Trên Windows, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint:rust`, `pnpm test:rust` và `pnpm tauri build` đều pass.
- [ ] Smoke test thủ công trên Windows xác nhận folder picker mở đúng, hủy picker không tạo dữ liệu, thêm folder thật điều hướng đúng, và ẩn cửa sổ xuống tray rồi mở lại vẫn giữ đúng nhánh Welcome hoặc Home; kiểm tra macOS hoãn tới bước chuẩn bị phát hành theo quy tắc project.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/home/home-route.test.tsx` | Component | Bốn nhánh hiển thị theo kết quả `list_projects`; trạng thái đang tải lần đầu không render Welcome lẫn Home; `Try again` gọi lại truy vấn đúng một lần; `projects://changed` chuyển nhánh từ Welcome sang Home và ngược lại; làm mới không xóa focus đang có. |
| `src/features/home/welcome-screen.test.tsx` | Component | Đủ eyebrow, tiêu đề, đoạn giới thiệu, hai nút và liên kết theo `#welcome`; hình minh họa mang `aria-hidden`; thứ tự focus theo `Tab`; hai control chưa khả dụng có `aria-disabled`, có tooltip khi hover và khi focus, và không gọi command; `Add Project` khóa khi đang chờ và chỉ gửi một lần; `cancelled` không hiện thông điệp và trả focus; `selected` điều hướng tới `/projects/:projectId`; từng nhánh lỗi hiển thị đúng thông điệp và `Open project` dùng đúng `project_id`. |
| `src/features/home/use-project-presence.test.ts` | Unit | Truy vấn một lần khi mount; đăng ký đúng một listener `projects://changed` và một listener `focus`; mỗi tín hiệu kích hoạt đúng một truy vấn; kết quả của lần gọi cũ bị bỏ qua; hủy cả hai đăng ký khi unmount và không setState sau unmount. |
| `src/lib/ipc/projects.test.ts` | Unit | Gọi đúng tên hai command; `list_projects` bỏ trống `search` khi không truyền và gửi `search` dạng camelCase khi có; đăng ký đúng tên event `projects://changed`; lỗi dạng `{ code }` giữ nguyên payload, lỗi lạ cho `payload` bằng `null`. |
| `src/app/app-router.test.tsx` | Component | Index route render `HomeRoute` với `list_projects` được mock; sáu route còn lại và route không khớp giữ nguyên hành vi của `FE-001`. |

Hành vi của folder picker native và của việc show lại cửa sổ từ tray được xác nhận bằng smoke test thủ công trên Windows với bản build thật; automated test không thay thế bước này.

## Câu hỏi mở

Không có.
