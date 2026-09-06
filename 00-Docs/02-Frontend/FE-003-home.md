# FE-003 — Home

Tài liệu đặc tả Home của Phase 1, giai đoạn 14 roadmap, ở mức contract để lập Plan. Backend và SQLite tiếp tục sở hữu dữ liệu; Home chỉ trình bày snapshot từ public query đã có.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-003` |
| Phase | `1`, giai đoạn `14` |
| Khu vực chính | `src/features/home/` |
| Yêu cầu chức năng | §6, đặc biệt §6.2; liên quan §5.1–5.2, §7.5, §8, §18 và §20 Phase 1 |
| Wireframe | `00-Docs/01-Wireframe/03-Home.html#empty`, `#full` |
| Backend liên quan | `BE-003` Projects, `BE-005` Sessions; nhận maintenance boundary của `BE-012` qua app |
| Phụ thuộc | `FE-001`, `FE-002`, `FE-004`, `FE-005`, `FE-006`, `FE-007`; giữ tích hợp `FE-008`, `FE-009`, `FE-014`, `FE-015` hiện có |

## Mục tiêu

Người dùng trở về Home để xem session runtime trên mọi project, nhận ra session cần chú ý và mở lại project gần đây. Mỗi hàng mở đúng màn hình thật, không tạo session hay process ngầm. Khi chưa có project, `/` tiếp tục hiển thị Welcome của FE-002.

### Quyết định đã chốt và đối chiếu nguồn

- Nguồn phạm vi: overview FE-003, §6/§18, roadmap stage 14; cấu trúc và công nghệ theo `02-ProjectStructure.md` và `01-TechStack.md`. Thiết kế này thay contract placeholder giai đoạn 4 của FE-002 tại nhánh có project, không thay hành vi Welcome.
- `#empty` có một project, nên đó là Home có session rỗng, không phải trạng thái chưa đăng ký project. Không có project vẫn là Welcome, kể cả query session đang tải/lỗi.
- `#full` nói rõ liệt kê mọi runtime session và có hàng finished/error. Chốt khối `Sessions` gồm **mọi session còn tồn tại trong runtime**, kể cả `noToolYet`, `finished`, `exitedWithError`; ưu tiên attention. Cụm “đang chạy” của roadmap không đồng nghĩa chỉ lọc `status === "running"` hoặc giả rằng mọi session đều có process sống. Không phục hồi session của lần chạy trước.
- Dùng `listProjects()` và `listSessions()` không bộ lọc. `ProjectDto` có `lastOpenedAtMs`; thứ tự list Projects hiện có là pinned/insertion, nên Home sắp xếp bản sao để trình bày recent, không thay thứ tự owner hoặc sidebar.
- `SessionSummaryDto` chỉ có `id`, `projectId`, `name`, `status`, `runningProcessCount`, `tabCount`. Không có tool label, thời lượng hay exit code. Bỏ các dòng “Claude · thinking · 12s” và exit code mẫu trong wireframe; chỉ hiển thị dữ liệu DTO thật. Không query detail cho từng hàng.
- `ProjectDto` không có branch. Home không thêm Git query theo từng project; hàng chỉ hiển thị tên, đường dẫn, thời điểm gần đây và availability. Branch vẫn thuộc Project Overview. Đây là giản lược wireframe có chủ ý để giữ scope hai public query.
- Không giữ cột trống dành cho Notes. Phase 1 trình bày hai khối Sessions và Recent projects; dưới ngưỡng content `720px` xếp một cột, từ ngưỡng này dùng hai cột bằng nhau, Sessions trước trong DOM. Padding dùng token/style hiện có, vùng nội dung cuộn dọc; không cuộn ngang khi sidebar rộng hoặc tăng cỡ chữ.
- Hành động session rỗng là `Open Projects` tới `/projects`. Không tự chọn project gần đây để tạo session từ Home: wireframe “New Session in xwork” được thay bằng đường dẫn đến owner để người dùng chọn project rồi dùng `New Session` hiện hữu.
- User đã ủy quyền tự quyết định thiết kế, không cần vòng hỏi đáp. Các lựa chọn và lệch wireframe được ghi tại đây.

### Ngoài phạm vi

- Quick Note, note ghim/gần đây, event/reminder/upcoming và cả placeholder, nút disabled, counter hoặc gợi ý phím tắt của các khối đó. Notes/Quick Note đến phase owner 3, Calendar đến phase owner 4.
- Backend/endpoint tổng hợp Home, DTO/binding mới, migration, permission, dependency hoặc cấu hình mới.
- CRUD project/session, tạo terminal, subscribe output PTY, đánh dấu đã đọc notification, chọn tab/pane hoặc tự phân tích output để suy ra trạng thái.
- Triển khai shortcut Home mới, bật các action chưa có executor, thay đổi catalog BE-009/BE-010.
- Plan, source implementation, commit và sửa historical plans trong lượt thiết kế này.

## File liên quan

Bảng là phạm vi implementation dự kiến được phép chạm. Các nguồn backend/binding bên dưới chỉ đọc; không sửa generated file. Nếu Plan phát hiện cần file khác, phải chốt bổ sung inventory thiết kế trước khi triển khai.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/home/home-route.tsx` | Public entry, chọn Welcome/Home/error và nhận maintenance props từ app |
| `src/features/home/use-project-presence.ts` | Giữ query/presence owner hiện có; bổ sung snapshot project dùng chung trong chính Home |
| `src/features/home/home-placeholder.tsx` | Loại bỏ placeholder khi không còn consumer sau khi thay bằng HomeScreen |
| `src/features/home/home-screen.tsx` | Ngày hiện tại, hai khối, trạng thái độc lập, row navigation và accessibility |
| `src/features/home/use-home-sessions.ts` | Snapshot session cục bộ, invalidate/query, single-flight, teardown |
| `src/features/home/home-presentation.ts` | Projection thuần: recent order/limit, session priority, nhãn và thời gian |
| `src/app/home-entry.tsx` | Composition adapter maintenance/Quit sang public Home props |
| `src/app/app-router.tsx` | Index element dùng HomeEntry bọc HomeRoute, giữ nguyên `/` và breadcrumb |
| `src/features/home/welcome-screen.test.tsx` | Giữ regression Welcome; bỏ test placeholder đã được dashboard thay thế |
| `src/features/home/home-route.test.tsx` | Presence, Welcome transition, dashboard thay placeholder, reset race |
| `src/features/home/use-project-presence.test.ts` | Snapshot/presence cùng response, events, stale query và maintenance |
| `src/features/home/home-screen.test.tsx` | Hai khối, trạng thái, keyboard, links, focus, ngày và dữ liệu thiếu |
| `src/features/home/use-home-sessions.test.ts` | Query thật qua mock wrapper tại test, event/race/coalesce/cleanup |
| `src/features/home/home-presentation.test.ts` | Recent limit/tie-break, mọi status, counts và format thời gian |
| `src/app/home-entry.test.tsx` | Busy/epoch/live guard đi qua composition, không lộ state owner |
| `src/app/app-shell.test.tsx` | Scope link Projects vào navigation trong test thứ tự Tab của shell |
| `src/app/app-sidebar.test.tsx` | Giới hạn assertion sidebar trong landmark/sidebar khi Home cũng hiển thị link Projects và session |
| `src/app/app-router.test.tsx` | Default `/`, breadcrumb và điều hướng đúng owner |
| `src/app/search-entry.test.tsx` | `navigation.open_home` mở dashboard/Welcome, không sinh executor khác |
| `src/app/data-management-bridge.test.tsx` | Reset khi Home đã mount và khi từ Settings về Home; import/reconcile |

Nguồn contract chỉ đọc để dùng/test, không mở rộng implementation scope:

| Đường dẫn | Vai trò |
|---|---|
| `src/lib/ipc/projects.ts` | `listProjects`, `onProjectsChanged`; owner đích đã dùng `openProject` |
| `src/lib/ipc/sessions.ts` | `listSessions`, `onSessionsRuntimeChanged` |
| `src/lib/ipc/ipc-error.ts` | `IpcCallError` và typed failure |
| `src/bindings/projects/projects.ts` | `ProjectDto`, `ProjectChangedEventDto`, `ProjectsError` sinh từ BE-003 |
| `src/bindings/sessions/sessions.ts` | `SessionSummaryDto`, `SessionStatusDto`, `SessionRuntimeEventDto`, `SessionsError` |
| `src/features/settings/data-management-provider.tsx` | Public `useDataManagement` chỉ do app adapter tiêu thụ |
| `src/features/settings/data-management-state.ts` | `busy`, `invalidationEpoch`, `getCurrent()` |
| `src/app/quit-store.ts` | Trạng thái suspend navigation của Quit |
| `src/app/data-management-bridge.tsx` | Owner xử lý `data://changed`, confirm/reconcile và reset navigation |
| `src/features/projects/use-project-overview.ts` | Đích project gọi `open_project` một lần theo lifecycle hiện hữu |
| `src/app/session-terminal-route.tsx` | Composition đích session, giữ terminal owner và selection hiện hữu |
| `src/features/home/welcome-screen.tsx` | Welcome giữ owner/luồng Add Project của FE-002 |
| `src-tauri/src/projects/commands.rs` | Public command thật BE-003 |
| `src-tauri/src/projects/service.rs` | Semantics query, availability, timestamps |
| `src-tauri/src/projects/repository.rs` | Thứ tự list gốc và persistence timestamps |
| `src-tauri/src/sessions/commands.rs` | Public command thật BE-005 |
| `src-tauri/src/sessions/manager.rs` | Snapshot runtime và project order |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `HomeRoute` | Chọn nhánh theo một project snapshot authoritative | `#empty`, kết hợp Welcome FE-002 |
| `HomeScreen` header | `h1` Home, dòng ngày local bằng English (`Sunday, 6 September`), tóm tắt `N sessions running · M need attention` khi session query đã thành công | `#empty`, `#full` |
| Sessions section | `h2` Sessions, link `Projects`, danh sách session; không cắt bớt session | `#empty`, `#full` |
| Recent projects section | `h2` Recent projects, link `All projects`, tối đa 5 hàng | `#empty`, `#full` |

- Session order: `needsAttention`, `exitedWithError`, `unseenOutput`, `running`, `noToolYet`, `finished`; trong cùng nhóm giữ thứ tự backend. Đây chỉ là thứ tự trình bày, không ghi lại status. Nhãn tương ứng: `Needs attention`, `Exited with error`, `Unseen output`, `Running`, `No tool yet`, `Finished`.
- Header đếm session có `runningProcessCount > 0`; attention đếm `status === "needsAttention"`. Không cộng hai nhóm để tính tổng, vì chúng có thể giao nhau. Khi không có process: `No sessions running`; vẫn hiển thị session finished/error nếu còn tồn tại. Khi query lỗi/loading không hiển thị số 0 giả.
- Hàng session: tên, tên project đối chiếu từ **toàn bộ** snapshot project (không chỉ 5 recent), nhãn status, số tab và số process. Có một link `Open session {name}` với icon trang trí hoặc tooltip nếu icon đứng riêng; không thêm nút tương tác lồng trong link.
- Recent order: `lastOpenedAtMs` giảm dần, rồi `addedAtMs` giảm dần, rồi `id` tăng dần; lấy 5 đầu. Không ưu tiên pinned. Backend khởi tạo last-opened bằng added nên project mới vẫn xuất hiện. Nếu hai timestamp bằng nhau ghi `Added {date}`, còn lại `Opened {date}`; không suy luận chắc chắn project chưa từng mở. Hiển thị ngày giờ local tuyệt đối bằng English, tooltip có đầy đủ ngày/giờ để tránh timer theo từng hàng.
- Availability unavailable không ẩn hàng, không disable mở overview; hiển thị `Unavailable` cùng reason English (folder missing/not a folder/access denied/could not check folder). Overview sở hữu locate/remove. Không tự gọi OS từ Home.
- Header ngày cập nhật khi mount, window focus, visibility trở lại visible và qua ngày local bằng một timer; cleanup khi unmount. Không đồng hồ đếm thời gian CLI giả.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang xác định presence | Chưa có project response hợp lệ hoặc snapshot bị retire bởi maintenance | `Checking your projects…`, `role=status`, `aria-busy`; chưa đoán Welcome/Home |
| Chưa có project | Query thành công trả mảng rỗng | Welcome FE-002; không render dashboard hoặc chạy session query không cần thiết |
| Project query lỗi ban đầu | Không có snapshot đáng tin | `XWork couldn't load your projects.` + `Try again` nếu persistence lỗi; lỗi integration yêu cầu restart |
| Home có project, session loading | Session chưa có response | Recent projects dùng được; skeleton/status `Loading sessions…`, không hiện empty |
| Session rỗng | Query thành công trả `[]` | `No sessions running`, giải thích mở project và chọn công cụ; `Open Projects` |
| Có dữ liệu | Hai query thành công | Rows theo thứ tự/limit đã chốt, không dữ liệu mẫu |
| Refresh bình thường | Event/focus/retry đang chạy | Giữ snapshot trước và focus, `aria-busy` tại khối liên quan; không remount cả Home |
| Refresh project lỗi | Đã có snapshot cùng generation | Giữ rows kèm `Projects may be out of date.` và `Try again`; không chuyển Welcome do lỗi |
| Session query lỗi | List lỗi | `XWork couldn't load your sessions.` + retry khi recoverable; giữ last-good snapshot cùng generation với nhãn out of date |
| Thiếu project label | Session snapshot chưa khớp project snapshot | `Project unavailable` thay tên; không lộ opaque ID làm label, vẫn mở session cho route owner xác minh |
| Đang maintenance/Quit | App truyền suspended | Không cho điều hướng dashboard, không query tiếp; clear snapshot khi epoch đổi, không hiện rows cũ sau reset |
| Listener lỗi | Đăng ký invalidation thất bại | Cảnh báo `Live updates are unavailable. Refresh to update.` và `Refresh`; focus/manual query vẫn dùng được; không giả live subscription thành công |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Mở Home từ sidebar/palette | `/` với dashboard hoặc Welcome; không giữ project context cũ | Dùng palette hiện có, không thêm shortcut |
| Activate project row | Navigate `/projects/${encodeURIComponent(id)}`; owner đích gọi `open_project`, Home không gọi thêm | Tab tới link, Enter |
| Activate session row | Navigate `/sessions/${encodeURIComponent(id)}`; owner đích đọc detail và giữ active tab/pane | Tab tới link, Enter |
| `Projects`, `All projects`, `Open Projects` | `/projects` | Tab, Enter |
| Retry/Refresh | Query khối lỗi; một request đang chạy không bị nhân đôi vì click lặp | Tab, Enter/Space |

Đủ tooltip cho icon không nhãn, focus ring theo token, status có chữ đi cùng màu, contrast và cỡ chữ theo theme/settings. Dùng section/heading/list/link native, không `role=grid` hoặc keyboard handler toàn cục. Không chiếm Ctrl+K, IME, Tab hoặc phím terminal. Khi dữ liệu reorder, giữ DOM key ID và focus đúng hàng; nếu hàng đang focus bị xóa, focus heading của khối (`tabIndex=-1`), không focus theo index mới. Nếu toàn Home đổi sang Welcome, chuyển focus tới heading Welcome chỉ khi focus trước nằm trong nội dung bị loại bỏ. Không giành focus từ sidebar/palette/dialog.

## Luồng chính

1. App adapter đọc maintenance/Quit, truyền boundary thuần vào HomeRoute. Hook presence lấy `listProjects()` một lần; chính snapshot này quyết định Welcome và cấp rows Home, không thêm project query song song riêng cho recent.
2. Nếu có project và không suspended, HomeScreen tải `listSessions()` toàn ứng dụng. Hai nguồn giữ trạng thái lỗi độc lập; không đợi session để hiển thị projects.
3. Listener projects và sessions được đăng ký trước query tương ứng; query sau registration bù khoảng trống lúc mount. Registration thất bại vẫn thực hiện query, hiển thị degradation và cho retry đăng ký có cleanup.
4. Project event invalidate project snapshot và session list (đổi order hoặc remove owner); session event invalidate session list. Home coi event là tín hiệu đọc lại, không áp payload như snapshot tổng hợp.
5. Mỗi nguồn tối đa một query in-flight; event trong flight tăng token/dirty, loại response đã bị invalidate và gom thành một query tiếp theo. Bỏ response của generation cũ, không publish sau unmount. Không polling, không query mỗi byte output terminal. Focus/visible coalesce theo cùng cơ chế.
6. Navigation chỉ kiểm tra boundary hiện tại rồi giao route owner. Home không mark session observed, không ack unseen output, không gọi open_project khi chỉ render. Đích bị xóa giữa click và load được owner route xử lý theo contract hiện hữu.
7. Khi maintenance epoch đổi, retire token và clear cả snapshots/presence ngay; khi busy kết thúc, query lại. Không tái sử dụng rows cũ ngay cả khi query mới thất bại. Import cũng clear snapshot để tránh metadata cũ; terminal runtime do FE-015/FE-008 quản lý, không remount toàn app.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `list_projects` qua `listProjects()` | Không truyền `search` | `Promise<ProjectDto[]>` | `persistenceFailed`: Retry; `unauthorizedWindow`, `invalidSearch`, payload/transport không nhận diện: thông báo integration `Restart XWork`, không loop retry tự động |
| `list_sessions` qua `listSessions()` | Không truyền `projectId` | `Promise<SessionSummaryDto[]>` | `projectLookupFailed`: Retry; `projectNotFound`: refresh cả projects/sessions một lần để reconcile removal race, còn lỗi thì Retry rõ ràng; `unauthorizedWindow`/lỗi không nhận diện: restart |

DTO dùng trực tiếp generated bindings trong inventory, không định nghĩa lại. Hai query read-only không thay timestamps/status. Không IPC aggregate, không N+1 detail/Git calls. Các command ở route đích là trách nhiệm FE-005/FE-006/FE-008, không duplicate trong Home.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `projects://changed` qua `onProjectsChanged` | `ProjectChangedEventDto` | HomeRoute mount | Invalidate list projects, báo session hook reload khi Home đang hiện; `removed` loại ngay row ID đã xóa khỏi last-good snapshot |
| `sessions://runtime-changed` qua `onSessionsRuntimeChanged` | `SessionRuntimeEventDto` | Dashboard mount | Invalidate list; `deleted` loại ngay row; không dùng revision event để tuyên bố query đã đồng bộ vì list không trả revision |
| App maintenance boundary | `HomeBoundarySnapshot` bên dưới | Epoch/busy thay đổi | Retire toàn bộ snapshot và query đúng lúc; không đăng ký `data://changed` trùng owner FE-015 |
| Window focus / document visibility | DOM event | Focus/visible | Refresh queries và ngày, coalesce; cleanup listener khi unmount |

Không Channel hoặc terminal output subscription. Không cập nhật UI từ event cũ sau teardown. Event/session stream dồn dập chỉ đặt dirty flag, không tạo hàng đợi query vô hạn; sau khi stream lắng phải có một query authoritative hoàn tất.

## State frontend

```ts
// View-only boundary supplied by the application composition root.
export interface HomeBoundarySnapshot {
  suspended: boolean;
  epoch: number;
}

// Public inputs keep Home independent of Settings and app store implementations.
export interface HomeRouteProps {
  boundary?: HomeBoundarySnapshot;
  readBoundary?(): HomeBoundarySnapshot;
}

// A temporary query view; DTO types come from generated bindings.
interface HomeQueryState<T> {
  snapshot: T[] | null;
  loading: boolean;
  refreshing: boolean;
  failure: "retryable" | "integration" | null;
  subscriptionFailed: boolean;
}

// Session query hook contract local to the Home feature.
interface HomeSessionsState extends HomeQueryState<SessionSummaryDto> {
  refresh(): void;
}
```

`useProjectPresence` giữ public nội bộ `presence`/`refresh()` hiện hữu và bổ sung `projects: ProjectDto[] | null`, refreshing/failure/subscription state; response duy nhất cập nhật presence và projects cùng lượt. Sau refresh lỗi giữ presence cũ chỉ khi snapshot thuộc cùng epoch. Token, dirty, disposed và unlisten ở ref, không persistence. Dashboard nhận toàn bộ project snapshot và chỉ derive recent khi render/projection.

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Project metadata/availability | BE-003 qua query | Không cache bền, không localStorage, không import Projects store |
| Session status/count/order | BE-005 qua query | Không suy ra trạng thái process hoặc mutate owner |
| Loading/error/focus/date | UI tạm thời | Dọn khi unmount, ngày local dùng clock có thể kiểm soát trong test |
| Busy/epoch | App composition từ FE-015/Quit | Không import Settings/Session/Terminal implementation trong Home |

`HomeEntry` trong app đọc `useDataManagement`, `useQuitStore`; suspended khi data busy hoặc Quit phase khác `idle`/`snapshot-failed`. Epoch là `invalidationEpoch` của data owner. `readBoundary()` đọc `getCurrent()` và store hiện tại ở thời điểm click/response, không closure snapshot cũ. Props render làm retire snapshot; trước publish hoặc navigation phải đối chiếu live epoch/suspended để chặn khoảng race trước effect. Khi render thấy epoch khác, không render snapshot cũ chờ effect cleanup. Production luôn cấp cả hai props; mặc định `{ suspended: false, epoch: 0 }` chỉ hỗ trợ isolated component/route embedding.

## Contract công khai của feature

```ts
// Render the existing root route using the current phase's Home/Welcome branch.
export function HomeRoute(props: HomeRouteProps): React.JSX.Element;
```

HomeRoute và hai type props/boundary là public entry; hook, HomeScreen và projection không export sang feature khác. App router đổi index element thành HomeEntry để ghép boundary; path, default entry, breadcrumb `Home` và sidebar active không đổi. Đây là ngoại lệ có chủ ý đối với dự kiến FE-002 “không đụng bảng route”: chỉ bọc element để nhận boundary stage 13, không thay routing contract.

FE-009 đã có `navigation.open_home → /`, nên không cần đổi executor hoặc thiết kế FE-009. FE-014 không được cấp handler mới chỉ vì dashboard xuất hiện; không đổi thiết kế FE-014. Regression palette trong inventory xác nhận hành vi hiện hữu.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Hơn 5 project, project pinned cũ | Recent vẫn chỉ 5 theo timestamp; All projects mở owner đầy đủ |
| Session thuộc project ngoài recent | Tra tên từ full projects list, không hiện thiếu label giả |
| Project unavailable nhưng process sống | Giữ cả project/session, mở session bình thường; không restart/kill process |
| Finished/error/no-tool còn runtime | Giữ hàng, count running dựa process count; có thể mở để xem output hoặc chọn tool tại owner |
| Rename/remove khi Home đang mở | Re-query, giữ identity focus, removed không được response cũ khôi phục |
| Hai nguồn query không cùng transaction | Không giả snapshot nguyên tử; missing label fallback và refresh, không xóa session chỉ vì join thiếu |
| Reset khi đã ở `/` | Epoch vẫn clear rows dù navigation replace không làm unmount; query lỗi không phục hồi data trước reset |
| Import khi terminal chạy | Chỉ refresh projection Home; không đụng PTY, buffer hoặc selection |
| Reset không chắc chắn/không commit | Boundary busy kết thúc thì query runtime sống lại; không tự tuyên bố mọi session đã dừng |
| Trở về từ tray hoặc qua nửa đêm | Query latest và ngày local đúng; Home không tạo thêm process |
| Listener resolve sau unmount/StrictMode | Unlisten ngay; promise/timer cũ không ghi state hoặc focus |
| Query/event lỗi liên tục | Không retry tự động vô hạn; lỗi có nhãn và thao tác phù hợp, snapshot cũ có nhãn out of date |

## Tiêu chí hoàn thành

- [x] Home thật thay placeholder khi có project; không có project vẫn Welcome, lỗi không bị coi như empty.
- [x] Chỉ hai query public có sẵn phục vụ dashboard; không backend/DTO/binding/permission hoặc dependency mới, không mock runtime.
- [x] Recent sort/limit/tie-break đúng và không thay order owner; mọi session runtime với status/count thật được trình bày đúng, không dữ liệu tool/branch/time giả.
- [x] Links điều hướng đúng owner; Home không tạo process, đổi observed session hoặc ghi last-opened riêng. Palette Home vẫn hoạt động, không cấp shortcut executor mới.
- [x] Loading/error/empty/partial failure/unavailable và live subscription failure kiểm chứng được; event/focus, unmount, stale response và maintenance race có test.
- [x] Reset/import clear snapshot đúng epoch kể cả Home không unmount; response trước reset không tái hiện metadata cũ. Chưa có Quick Note/note/event trong DOM, copy hoặc query của Home.
- [ ] Keyboard, tooltip, focus sau reorder/removal, theme, cỡ chữ và reduced motion đáp ứng §18. Không lấy focus khỏi dialog/terminal/sidebar.
- [x] Implementation chạy Windows gates: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; trong crate desktop: `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features -- --test-threads=1`; cuối cùng `pnpm tauri build` vì tích hợp IPC/navigation/maintenance desktop. Cargo dùng một job; không sửa test lân cận để che lỗi timing.
- [ ] Native smoke Windows và toàn bộ §20 Phase 1 được ghi evidence riêng trước khi claim stage 14/Phase 1 complete; automated pass không thay native smoke.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/home/home-route.test.tsx` | Component | Loading/Welcome/Home, one project query source, last project removal, failed read và maintenance generation |
| `src/features/home/use-project-presence.test.ts` | Unit/hook | Snapshot cùng presence, add/rename/remove, listener failure/retry, focus, in-flight invalidation, cleanup |
| `src/features/home/home-screen.test.tsx` | Component | Toàn bộ UI states, unknown project, unavailable, links, tab/enter/focus, ngày rollover, không khối phase sau |
| `src/features/home/use-home-sessions.test.ts` | Unit/hook | Global query không projectId, mọi status, event coalescing, failed query, remove tombstone, stale response, unlisten late |
| `src/features/home/home-presentation.test.ts` | Unit | 0/1/6 projects, pin không thắng recency, ties, backend order trong nhóm session, count không nhầm process/session |
| `src/app/home-entry.test.tsx` | Component | Props live guard, busy/epoch, Quit suspension, không stale publish/navigation trước effect |
| `src/app/app-router.test.tsx` | Component | Default `/`, Home breadcrumb, destinations và owner handling target biến mất |
| `src/app/search-entry.test.tsx` | Component | Existing Home command tới dashboard hoặc Welcome; Home không cấp project context giả |
| `src/app/data-management-bridge.test.tsx` | Component | Home đang mount khi reset/import, response cũ settle muộn, refresh lỗi không hồi sinh rows; reset uncertain |

Test double chỉ bên trong frontend unit/component test tại IPC wrapper boundary, bám generated DTO. Reset mocks, stores, router, listener, timers và pending promise giữa test; dùng deferred promise/fake clock để tái hiện race, không sleep phụ thuộc timing thật. Không gọi filesystem, profile app thật, credential store hoặc reset thật từ component test. Backend contract không đổi: chạy gates hiện có, không tạo backend tests trùng query implementation. Mọi function/callback/helper/test implementation có comment mục đích bằng English.

Smoke thủ công Windows phải xác minh môi trường/profile disposable và project folders tạm trước khi chạy: Home với project thật available/unavailable, tạo session ở owner rồi trở Home, status attention/output/error, mở đúng session mà process tiếp tục; rename/remove và recent order; tray/focus; keyboard/WebView2/theme/font; import/reset trên dữ liệu disposable rồi xác nhận không hiện row cũ. Checklist §20 Phase 1 còn bao gồm bốn pane, CLI profiles, PTY/IME và Quit không restore runtime; thực hiện theo owner hiện hữu, không desktop E2E tự động. macOS hoãn đến chuẩn bị phát hành.

Tại thời điểm DESIGN ONLY: stage 13 BE-012/FE-015 code và automated gates đã commit (`92328af Implement FE015` là HEAD quan sát được), nhưng native smoke/accessibility và metrics còn **pending**. FE-003 chưa implement, mọi checkbox trên chưa được xác nhận. Smoke/p95 các stage trước và metric `<500 ms` của Data vẫn pending theo owner; không suy ra pass từ build/test, không claim stage 13, stage 14 hoặc toàn Phase 1 hoàn tất. Thiếu môi trường Windows cô lập là điều kiện còn thiếu cho native verification, không phải blocker lập Plan FE-003.

## Quyết định trong implementation

- Full suite phát hiện ba selector sidebar và một selector shell tìm trên toàn màn hình nên trùng link Projects/session mới của Home. Bổ sung inventory `src/app/app-sidebar.test.tsx` và `src/app/app-shell.test.tsx`; chỉ scope các assertion liên quan vào sidebar, không sửa production sidebar hoặc bỏ kiểm tra collapsed state.
- Bổ sung inventory test Welcome vì file này import trực tiếp placeholder bị xóa; chỉ bỏ case placeholder lỗi thời, hành vi Welcome giữ nguyên.
- Hai hook Projects/Sessions dùng chung helper lifecycle nội bộ trong `src/features/home/use-project-presence.ts` để giữ cùng quy tắc subscription, single-flight và epoch; không mở rộng public entry của feature hoặc IPC.

## Kết quả implementation

FE-003 và extension FE-001 stage 14 đã triển khai; frontend 2.000 test / 114 file, full Rust 478 test và Tauri Windows build đạt. Evidence chi tiết và inventory bàn giao nằm trong plan hiện hành `20260906-fe-003-home.md` dưới `00-Docs/98-Plan/`. Keyboard/focus/date đã có component test; layout, theme/font/contrast và native smoke/metrics vẫn pending. Chưa claim stage 14 hoặc toàn Phase 1 hoàn tất. Parent sở hữu commit `Implement FE003` rồi dừng; không bắt đầu stage 15.

## Câu hỏi mở

Không có.
