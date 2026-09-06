# FE-010 — Notification center

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-010` |
| Phase | `1`; reminder mở rộng ở Phase 4, giai đoạn 21 |
| Khu vực chính | `src/features/notifications/` |
| Yêu cầu chức năng | §15; §4.2, §18; §13.3 chỉ là ranh giới mở rộng Phase 4 |
| Wireframe | `00-Docs/01-Wireframe/02-AppShell.html#notifications`; `00-Docs/01-Wireframe/07-Calendar.html#reminder` chỉ tham chiếu ngoài phạm vi |
| Backend liên quan | `BE-011`, public Sessions `BE-005`; nguồn terminal `BE-007`, lifecycle `BE-001` gián tiếp |
| Phụ thuộc | `FE-001`, `FE-006`, `FE-007`, `FE-008`; giai đoạn 11 phụ thuộc giai đoạn 9 theo roadmap |

Nguồn contract triển khai: BE-011 tại commit `23b74b2`, generated binding Notifications, sáu command Rust, public IPC Sessions và route session hiện có. Tài liệu tuân theo ProjectStructure, FunctionalRequirements và TechStack; không thay đổi roadmap hoặc plan lịch sử.

## Mục tiêu

Người dùng mở chuông từ mọi màn hình trong cửa sổ chính, xem hoạt động terminal chưa đọc, đánh dấu đã đọc hoặc xóa và mở chính xác session/tab/pane liên quan. Badge cập nhật ngay từ tổng chưa đọc do backend trả, kể cả khi panel đóng.

### Quyết định đã chốt cho giai đoạn 11

- Theo ủy quyền của user, các lựa chọn dưới đây đã được tự quyết định; không cần phiên hỏi đáp trước bước PLAN.
- Chỉ render `terminalNeedsInput`, `terminalProcessFinished`, `terminalProcessFailed`. Không tự suy luận notification từ stream terminal, không tạo dữ liệu mẫu hoặc nguồn tiến trình nền độc lập chưa có BE contract.
- Wireframe có context tên project, command, số file đổi và số test pass nhưng DTO thật không có các dữ liệu đó. Hiển thị nguyên `title` và `context` đã làm sạch của backend dưới dạng text; không tra thêm project để làm giàu snapshot, không parse output. `statusCode` nullable được hiển thị riêng dưới nhãn `Exit code` khi có, không thay thế title.
- Mọi item, kể cả finished/đã đọc vốn thiếu nút trong wireframe, có `Open session` và `Delete notification`; item chưa đọc có thêm `Mark read`. Đây là phần hoàn thiện yêu cầu §15. Không hỗ trợ đánh dấu chưa đọc.
- Footer dùng `Only unseen terminal activity appears here.`; bỏ lời mời chỉnh Settings Notifications vì FE-023 thuộc Phase 4.
- `Delete notification` và `Clear read` thực hiện ngay, không confirmation hoặc Undo: chỉ xóa bản ghi thông báo, không xóa session hay dừng process. Tooltip Clear read giải thích `Delete all read notifications. Sessions keep running.`
- Backend sở hữu unread/read, thứ tự, cleanup, dedupe, eligibility và OS toast. Panel mở không tự mark read; chỉ explicit Mark/Open hoặc thay đổi từ backend làm item thành đã đọc.
- FE-001 chỉ ghép public entry của Notifications; điều hướng và public IPC Sessions được ghép ở app. Notifications không import Sessions hoặc Terminal implementation.

### Ngoài phạm vi

- Reminder/Event/Missed, Snooze 5/10/30 phút, Dismiss, notification settings, native toast action/click routing và reset integration giai đoạn 13.
- Thêm Rust command, DTO, migration, capability, thư viện hoặc sửa generated binding; backend giai đoạn 11 đã cung cấp đủ contract.
- PLAN, implementation, commit và review độc lập trong lần bàn giao thiết kế này.

## File liên quan

Các file implementation được phép chạm cho lát cắt này nằm trong bảng; file nguồn tham chiếu chỉ đọc được đánh dấu bằng vai trò, không cho phép sửa backend hoặc generated contract.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/notifications/index.ts` | Public export entry và props |
| `src/features/notifications/notification-center.tsx` | Bell, panel neo chuông, row, actions, status, relative time và focus khi thao tác danh sách |
| `src/features/notifications/notification-center.test.tsx` | Component test giao diện và bàn phím |
| `src/features/notifications/use-notifications.ts` | State/cache theo vòng đời entry, subscription, query, mutation và chống response cũ |
| `src/features/notifications/use-notifications.test.ts` | Unit/hook test race, paging, cleanup và failure |
| `src/lib/ipc/notifications.ts` | Sáu wrapper command và một listener typed |
| `src/lib/ipc/notifications.test.ts` | Command args, DTO passthrough, lỗi và unlisten |
| `src/components/ui/popover.tsx` | Source component shadcn theo style repo, dùng Popover của `radix-ui` đã có; portal, anchor, dismiss/focus |
| `src/app/app-topbar.tsx` | Thay bell placeholder bằng public entry, giữ vị trí, hover và no-drag |
| `src/app/app-topbar.test.tsx` | Bell thật, badge, keyboard, window-control regression |
| `src/app/notification-entry.tsx` | Composition Notifications với navigation/IPC Sessions, đóng panel theo route/Quit |
| `src/app/notification-entry.test.tsx` | Open chính xác target, lỗi giữa các command và route cancellation |
| `src/app/session-terminal-route.tsx` | Đọc navigation state, truyền yêu cầu focus tạm thời vào public SessionRoute |
| `src/app/session-terminal-route.test.tsx` | Truyền đúng focus request, giữ terminal slot/shortcut props |
| `src/features/sessions/session-route.tsx` | Public prop bổ sung cho focus đúng pane sau khi detail render; không nhận dependency Notifications |
| `src/features/sessions/session-route.test.tsx` | Focus sau tải, cùng route, pane mất và request cũ |
| `src/app/app-shell.test.tsx` | Regression composition, một listener Notifications, route/Quit |
| `src/app/app-router.test.tsx` | Mock Notifications IPC cục bộ khi router regression mount shell |
| `src/app/app-sidebar.test.tsx` | Mock Notifications IPC cục bộ vì sidebar test mount router thật |
| `src/bindings/notifications/notifications.ts` | Nguồn DTO đã sinh, chỉ đọc |
| `src/bindings/sessions/sessions.ts` | Nguồn SessionDetailDto/TabDto/SessionsError, chỉ đọc |
| `src/lib/ipc/sessions.ts` | Public getSession/setActivePane/setMaximizedPane đã có, chỉ dùng lại |
| `src/lib/ipc/ipc-error.ts` | `invokeCommand` và `IpcCallError`, chỉ dùng lại |
| `src-tauri/src/notifications/commands.rs` | Nguồn tên command/input/authorization, chỉ đọc |
| `00-Docs/02-Frontend/FE-010-notification-center.md` | Contract lát cắt này |
| `00-Docs/02-Frontend/FE-001-application-shell.md` | Bell/badge và composition giai đoạn 11 |

Tái sử dụng Button, Tooltip, theme token và Highlight hiện có mà không sửa các source đó. Popover không cần dependency mới; không tạo shared store hoặc chỉnh package/lock/config. Mọi function, callback, helper và test implementation phải có comment tiếng Anh mô tả mục đích theo AGENTS.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `NotificationCenter` bell | Nút `Notifications`, tooltip cùng nhãn; badge 1–99 hoặc `99+`, không hiển thị khi count 0 hoặc chưa biết | `02-AppShell.html#notifications` |
| Panel | Popover không modal, neo dưới chuông, canh phải, offset 4px, rộng 400px và tối đa viewport trừ 16px; portal ngoài vùng kéo/overflow; không dim nền | `#notifications`, CSS `.notif-panel` |
| Header | `Notifications`, `Mark all read`, `Clear read`, nút đóng có tooltip `Close notifications` | `#notifications`; nút đóng bổ sung cho keyboard/viewport nhỏ |
| Danh sách | Một danh sách theo thứ tự backend, mỗi item icon theo kind, title/context, timestamp, read state và action riêng; không dùng button lồng button | `#notifications` |
| Footer | Copy scope đã chốt, `Load more` khi nextCursor khác null | `#notifications`; paging bổ sung theo BE-011 |

Panel cao tối đa `min(600px, viewport height - 64px)`; header/footer giữ thấy, danh sách cuộn riêng, action wrap khi chữ lớn. Dùng token theme, nền mềm và chấm cho unread kèm nhãn screen reader `Unread`/`Read`; màu không phải tín hiệu duy nhất. Bell có `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`; accessible name `Notifications, N unread` khi count đã biết, giữ số đầy đủ khi badge là `99+`.

Thời gian dùng `createdAtMs` decimal string: chỉ convert sang Number khi nằm trong miền Date hợp lệ; hiển thị `now` dưới một phút, `Nm`, `Nh`, `Nd`, clamp khoảng cách âm về 0. Tooltip bằng English locale với ngày giờ đầy đủ theo timezone OS. Nếu timestamp ngoài miền Date, hiển thị `Time unavailable`, không làm crash panel. Timer 60 giây chỉ tồn tại khi panel mở, dùng clock giả trong test. Không dùng timestamp để phân trang hoặc so revision.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang tải đầu | Chưa có page | `Loading notifications…`, `aria-busy`; bell vẫn mở/đóng được, không giả badge 0 |
| Rỗng | Page thành công có items rỗng | `No notifications yet`, `Unseen terminal activity will appear here.`, nút `Close notifications` |
| Có dữ liệu | Page đã đồng bộ | Render read/unread đúng `readAtMs === null`, badge từ global unreadCount |
| Refresh | Có page cũ và đang tải lại | Giữ item và focus cũ, `Updating notifications…`; khóa mutation/load more cho đến page mới |
| Tải thêm | Đang query cursor | Giữ danh sách, nút `Loading more…` disabled; không gửi thêm request lặp |
| Lỗi query | Không có page hoặc refresh/load more fail | `Couldn't load notifications.` + `Retry`; page cũ nếu có được ghi `Notifications may be out of date.` và khóa action cho đến refresh thành công |
| Lỗi listener | Không đăng ký được event | `Live updates are unavailable.` + `Retry`; vẫn cho xem snapshot từ query; retry đăng ký trước refetch |
| Mutation pending | Một command/open đang chạy | Khóa toàn bộ mutation và load more trong center; giữ close khả dụng; action tương ứng `Working…` |
| Mutation lỗi | Command thất bại | Message theo mapping dưới, không giả thành công; giữ panel và cho retry sau khi reconcile |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Mở chuông | Refetch trang đầu, focus heading có tabindex -1, không mark read | Enter/Space trên bell |
| Đóng | Escape, nút đóng hoặc bấm ngoài; Escape/nút đóng trả focus bell, bấm ngoài giữ focus nơi bấm | Escape |
| Đi trong panel | Tab qua header, từng action theo DOM và Load more; không ép arrow-key/listbox, không chặn terminal khi panel đóng | Tab/Shift+Tab, Enter/Space |
| `Mark read` | Gọi mark một item; chỉ cập nhật từ result rồi refetch, không điều hướng | Enter/Space |
| `Mark all read` | Đánh dấu toàn bộ inbox backend, kể cả item chưa load; disabled nếu chưa biết count hoặc count 0 | Enter/Space |
| `Delete notification` | Xóa riêng item; focus action của item kế tiếp, nếu không có thì item trước hoặc heading | Enter/Space |
| `Clear read` | Xóa toàn bộ item đã đọc kể cả ngoài page; sau page thành công vẫn enabled dù page hiện tại không có read vì DTO không có tổng read; affectedCount 0 là thành công no-op | Enter/Space |
| `Load more` | Cursor nguyên từ backend, thêm tối đa 30 item | Enter/Space |
| `Open session` | Luồng exact target bên dưới; đóng chỉ sau navigation thành công | Enter/Space |

Không tạo global shortcut Notifications. Đóng khi route chuyển hoặc Quit bắt đầu để không cạnh tranh focus với Quit dialog. Không animation khi reduced motion. Panel dùng role dialog có accessible title; status mutation dùng vùng polite riêng, lỗi dùng role alert; không đọc lại toàn bộ danh sách trên mỗi event.

## Luồng chính

1. Entry mount một lần trong topbar của main: đăng ký listener rồi query trang đầu với `cursor: null, limit: 30`. StrictMode/unmount phải hủy cả listener resolve muộn và response cũ.
2. Bell count theo snapshot/event mới nhất. Mỗi lần mở hoặc window/document lấy lại focus/visibility, query trang đầu để hồi phục event bị mất; gộp các trigger đồng thời. Không polling khi cửa sổ ẩn.
3. `Open session` gọi `open_notification` với ID duy nhất, không dùng target snapshot trong row để điều hướng. Nhận result là đã mark read ở backend; áp dụng state và invalidation kể cả bước navigation tiếp theo lỗi.
4. App callback gọi `setActivePane(sessionId, tabId, paneId)` bằng target trả về; command chọn cả tab và pane, không cần setActiveTab. Kiểm tra `summary.projectId` từ detail trả về khớp target. Nếu tab có `maximizedPaneId` khác pane đích và khác null, gọi `setMaximizedPane(sessionId, tabId, null)` để pane đích hiện ra; giữ maximize nếu chính pane đích đang maximize.
5. App navigate `/sessions/${encodeURIComponent(sessionId)}` với state `{ notificationFocus: { tabId, paneId, requestId } }`. `requestId` chỉ là UI token riêng cho mỗi lần Open. Không tạo route project/session lồng nhau hoặc đổi observer trực tiếp; SessionRoute/useSessionDetail hiện có sở hữu observed session.
6. SessionTerminalRoute truyền focus request vào public SessionRoute; effect chỉ focus section pane sau khi detail hiện tại chứa đúng active tab/pane và pane không bị che. Dùng ref trong route, không query DOM toàn ứng dụng. Focus một lần theo requestId, kể cả Open cùng session/pane; hủy request khi route đổi/unmount, không retry vô hạn nếu target mất. Không remount workspace/terminal để ép focus. Sau focus pane, Enter theo hành vi terminal hiện có cho phép nhập liệu.
7. Nếu target biến mất giữa Open, activation và render, không chọn pane gần nhất, không tạo lại session; hiện lỗi target tại panel nếu chưa navigate. Sau navigation, giữ contract FE-006: session missing quay về project đã biết hoặc `/projects`, lỗi query khác hiện lỗi và Retry; không coi route Projects này là mở target thành công. Không rollback trạng thái read backend đã commit. Route đổi/Quit khi Open còn pending làm UI token hết hiệu lực, response muộn không được kéo người dùng về route cũ.

## Contract với backend

DTO import trực tiếp từ `src/bindings/notifications/notifications.ts`, không khai báo lại. Các timestamp và revision là **string**, `unreadCount`/`affectedCount` là number. `NotificationTargetDto` giai đoạn 11 chỉ có variant `kind: "session"` với `projectId`, `sessionId`, `tabId`, `paneId` camelCase. Không scaffold event variant.

### Command sử dụng

| Command | Input IPC | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_notifications` | `{ cursor: NotificationCursorDto \| null, limit: 30 }` | `NotificationPageDto` | Mapping query bên dưới |
| `mark_notification_read` | `{ notificationId: string }` | `NotificationCenterStateDto` | Mapping mutation bên dưới |
| `mark_all_notifications_read` | Không args | `NotificationCenterStateDto` | Mapping mutation bên dưới |
| `delete_notification` | `{ notificationId: string }` | `NotificationCenterStateDto` | Mapping mutation bên dưới |
| `clear_read_notifications` | Không args | `NotificationCenterStateDto` | Mapping mutation bên dưới |
| `open_notification` | `{ notificationId: string }` | `OpenNotificationDto` | Mapping Open bên dưới |
| `set_active_pane` | `{ sessionId, tabId, paneId }` từ target validated | `SessionDetailDto` | Sessions typed missing → target unavailable; lỗi khác → `Couldn't open this session. Try again.` |
| `set_maximized_pane` | `{ sessionId, tabId, paneId: null }` khi cần restore | `SessionDetailDto` | Như activation; không navigate khi restore thất bại |

IPC wrapper dùng `invokeCommand<TResult, NotificationError>` và `IpcCallError<NotificationError>` sẵn có. Sáu hàm public tương ứng là `getNotifications(cursor, limit)`, `markNotificationRead(notificationId)`, `markAllNotificationsRead()`, `deleteNotification(notificationId)`, `clearReadNotifications()`, `openNotification(notificationId)`; Promise output đúng bảng. Không truyền tên nguồn, content hoặc target từ frontend vào Notifications command.

| Error code | Hành vi |
|---|---|
| `notification_not_found` | `This notification is no longer available.`; refetch, không navigate hoặc recreate |
| `target_unavailable` | `This session is no longer available.`; refetch, cho Delete nếu row còn; không fallback route |
| `invalid_cursor` | Bỏ chuỗi page/cursor, tải trang đầu một lần; nếu vẫn lỗi hiển thị Retry, không loop |
| `dependency_unavailable`, `persistence_failed`, `unavailable` | `Notifications are temporarily unavailable. Try again.`; giữ dữ liệu cũ dạng stale, Retry query; retry mutation phải do người dùng |
| `unauthorized_window`, `invalid_notification_id`, `invalid_limit`, `corrupt_stored_notification` | `Notifications couldn't be loaded. Restart XWork.`; không hiển thị raw field/error/ID hoặc tự sửa DB |
| Transport/lỗi shape không biết | `Couldn't update notifications. Try again.` cho mutation, query dùng copy lỗi tải; reconcile trước retry, không suy đoán command chưa commit |

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `notifications://changed` | `NotificationCenterChangedDto` = generated revision/unreadCount | Sau mutation backend commit; event best-effort | Count theo revision, invalidate page; panel mở refresh gộp 100ms, panel đóng chỉ dirty |

Wrapper `onNotificationsChanged(callback: (payload: NotificationCenterChangedDto) => void): Promise<UnlistenFn>` giữ API Tauri event trong IPC. Không Channel hoặc listener trực tiếp Terminal; frontend không gọi notification plugin/native permission API.

## State frontend

```ts
interface NotificationsState {
  isOpen: boolean;
  status: "loading" | "ready" | "error";
  items: NotificationDto[];
  nextCursor: NotificationCursorDto | null;
  revision: string | null;
  pageRevision: string | null;
  unreadCount: number | null;
  dirty: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  listening: boolean;
  pending: "read" | "readAll" | "delete" | "clearRead" | "open" | null;
  errorMessage: string | null;
  /** Open or dismiss the transient panel. */
  setOpen(open: boolean): void;
  /** Reload the first page and restore subscription if needed. */
  refresh(): Promise<void>;
  /** Append the next authoritative page. */
  loadMore(): Promise<void>;
  /** Apply an explicit user action through IPC. */
  mutate(action: "read" | "readAll" | "delete" | "clearRead" | "open", id?: string): Promise<void>;
}
```

State contract không bắt buộc store Zustand: hook cục bộ có một owner đủ cho bell/panel. Action có id bắt buộc về ngữ nghĩa cho read/delete/open; readAll/clearRead không gửi id.

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Items/read/count/cursor/revision | Backend qua command/event | Cache trong memory của main, không persist hoặc tự decrement count |
| Open, focus token, busy/error, timers/request generation | UI tạm thời | Clear theo mount/route lifecycle, không gửi request token xuống Rust |
| Target | BE-011 Open result | App chỉ dùng để gọi public Sessions và navigate |

Quy tắc đồng bộ:

- So revision decimal bằng BigInt hoặc so decimal không mất độ chính xác; không Number/lexicographic. Chấp nhận event/result khi revision không thấp hơn đã biết; duplicate event cùng revision không gây refetch lặp. Revision scope là process, entry không persist baseline qua restart.
- Page mới chỉ được áp dụng khi request generation còn hiện hành và revision không thấp hơn latest event/mutation. Response thấp hơn bị bỏ, gộp một refresh tiếp theo; không chạy nhiều page request đồng thời.
- Mọi thay đổi revision làm chuỗi page cũ dirty. Khi refresh thành công thay bằng trang đầu, bỏ nextCursor cũ. `Load more` chỉ append nếu pageRevision, generation, cursor và revision trả về còn cùng snapshot; nếu khác, reset trang đầu. Dedupe item theo ID, giữ thứ tự backend `(createdAtMs DESC, id DESC)`, không tự sort theo unread.
- Mutation result luôn áp dụng global count/revision mới nhất rồi invalidate/refetch, cả affectedCount 0; không phụ thuộc event sẽ tới. Response lỗi vận chuyển cũng refetch vì backend có thể đã commit. Không tự retry mutation.
- Focus theo ID được giữ qua refresh nếu control còn tồn tại; nếu không, chọn item kế tiếp/trước hoặc heading. Reset trang đầu có thể bỏ page sâu; thông báo polite `Notifications updated.` và giữ focus theo fallback đã chốt, không tự gọi Load more để giữ cache vô hạn.
- Listener/timer/promise phải có lifecycle token và cleanup; sự kiện burst tối đa một refresh đang chạy và một refresh chờ. Refresh khi focus chỉ query, không re-register listener còn sống.

## Contract công khai của feature

```ts
/** Render the persistent bell and its transient notification panel. */
export function NotificationCenter(props: {
  onOpenTarget(target: NotificationTargetDto, signal: AbortSignal): Promise<void>;
  dismissKey: string;
  suspended: boolean;
}): React.JSX.Element;
```

`dismissKey` do app lấy từ location.key: thay đổi đóng panel và hủy navigation token cũ. `suspended` đúng từ lúc Quit bắt đầu, đóng panel và chặn Open mới; trở lại false sau Cancel/failure cho phép mở lại. Hook tạo AbortController cho từng Open, abort khi đóng panel, route đổi, Quit hoặc unmount. App kiểm tra signal trước mỗi command tiếp theo và trước navigate; abort chỉ chặn bước UI tiếp theo, không hủy Rust command đã gửi. Không hiển thị lỗi cho thao tác đã abort. Entry không nhận business store hoặc route string từ feature khác. Popover CloseAutoFocus phải tránh trả focus chuông khi đã chuyển route hoặc Quit dialog đang lấy focus; callback navigation hoàn tất mới đóng panel.

Public extension của `SessionRoute` giữ toàn bộ props hiện có, thêm `focusRequest?: { tabId: string; paneId: string; requestId: string }`. Đây là dữ liệu UI trung tính do app truyền; Sessions không import NotificationTargetDto. Thực hiện focus khi detail và DOM đã sẵn sàng, chỉ khi active IDs khớp, không cướp focus do event refresh sau khi request đã được dùng. App chỉ nhận state do navigation nội bộ đã kiểm tra shape; state lỗi bị bỏ.

## Edge case

### Quyết định bổ sung khi lập PLAN — 2026-09-06

- Mỗi focusRequest mới gọi `detail.refresh()` đúng một lần, kể cả cùng session và kể cả event Sessions đã thất lạc. API refresh hiện trả void: lưu reference detail trước refresh, chờ snapshot detail khác reference với status ready và active IDs khớp rồi mới focus; không await API void hoặc chỉ so revision. Không thay implementation useSessionDetail hoặc thêm observer thứ hai. Effect không phụ thuộc identity callback refresh để tránh refetch lặp; dùng requestId và lifecycle ref. Nếu query trả cùng revision vì pane đã active, snapshot object mới vẫn hoàn tất focus request. Refresh lỗi/missing xử lý theo route hiện có, không polling.
- App truyền `suspended` khi Quit phase là `requesting`, `awaiting-confirmation`, `confirming` hoặc `integration-failed`; `idle`/`snapshot-failed` cho phép mở lại panel. Đây là mapping UI của quit-store hiện có, không thay lifecycle backend.
- Mỗi test render shell/router phải mock Notifications IPC cục bộ, kể cả router và sidebar regression có shell. Bổ sung `src/app/app-router.test.tsx` và `src/app/app-sidebar.test.tsx` vào inventory để tránh gọi invoke thật khi bell mount; không sửa global test setup hoặc tạo runtime mock.
- Smoke native chỉ chạy trong tài khoản Windows thử nghiệm riêng hoặc môi trường Windows dùng một lần với app data/project thử nghiệm; không giả định có environment override app-data cho executable. Nếu môi trường đó chưa có, ghi pending và bàn giao phần automated độc lập. Không tạo hook app-data production chỉ để làm smoke.

### Quyết định khi triển khai — 2026-09-06

- Popover portal vẫn truyền sự kiện theo cây React. Nội dung chặn bubbling double-click/pointer; capture handler kéo của topbar bỏ qua target không thuộc DOM topbar. Test dùng panel thật xác nhận heading không mất focus và double-click không gọi maximize.
- Query mất hiệu lực do revision/epoch mới tiếp tục gộp một refresh trang đầu, kể cả khi refresh trước đó cũng bị event mới vượt qua. Giới hạn phục hồi đúng một lần chỉ áp dụng lỗi `invalid_cursor`; không để page stale khóa action vĩnh viễn khi một chuỗi event đến trong lúc query.
- Focus request chờ object snapshot mới có đúng active tab/pane; render chỉ thay trạng thái với object cũ không hoàn tất request. Sau focus thành công, event activity hoặc refresh khác không focus lần nữa. Mọi so khớp ID trong DOM dùng equality trong ref của route/panel, không nội suy ID vào CSS selector.

| Tình huống | Hành vi mong đợi |
|---|---|
| Count >99, inbox có nhiều trang | Badge `99+`, accessible count thật; mark all/clear read áp dụng toàn inbox |
| Page đầu toàn unread nhưng read ở page sau | Clear read vẫn dùng được; không suy tổng read từ page |
| Terminal/session cleanup trong lúc panel mở | Event invalidate; row biến mất, count không âm, focus có fallback |
| Mark read do backend attention clear | Item đổi trạng thái sau refetch, không tự clear terminal attention từ FE-010 |
| Open đích đã đọc | Vẫn validate/activate/focus; no-op read không cần có event |
| Open khi session đã hiển thị hoặc pane khác maximize | Cùng route vẫn focus một lần; restore pane khác trước navigation |
| User đổi route/đóng panel khi Open pending | Không navigate muộn; backend read/activation đã commit không rollback; reconcile badge vẫn chạy |
| Window hidden rồi trở lại | Lấy lại snapshot; FE không tự thay đổi BE visibility hoặc phát OS toast |
| Title/context dài, HTML, Unicode | Render escaped text, wrap không tràn panel; không HTML/Markdown renderer |
| Tauri listener fail hoặc event bị mất | Retry listener khi fail; mở panel/focus luôn query; không tuyên bố realtime khi listener lỗi |
| Startup/Quit | Terminal items được Rust cleanup; FE không restore cache từ storage, không gọi clear inbox thay Rust |

## Tiêu chí hoàn thành

- [ ] Panel và bell English khớp phạm vi wireframe; unread/read, 0/99+, loading/empty/error, pagination, actions đều có kiểm chứng component.
- [ ] Sáu command và listener dùng đúng binding/tên args; không hand-author DTO hoặc thêm backend/native permission.
- [ ] Read/delete/open và cleanup cập nhật count từ backend, không dựa số item hiện có hoặc event delivery thành công.
- [ ] Event/request race, revision vượt Number safe integer, duplicate, StrictMode và listener resolve muộn được test xác định.
- [ ] Open chọn đúng project/session/tab/pane qua contract thật; restore maximize, cùng-route focus, missing target và navigation cancellation được test.
- [ ] Keyboard, focus fallback, no-drag, window controls, reduced motion và theme/font scale được kiểm tra; không tự mở notification panel khi item tới.
- [ ] Chạy Windows `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:rust`, `pnpm lint:rust`, `pnpm test:rust`; Rust dùng một Cargo job theo môi trường đã chốt.
- [ ] `pnpm tauri build` Windows pass vì nối IPC/desktop navigation; giữ `bundle.active = false`, kết quả build là executable release, không phải installer.
- [ ] Smoke thủ công Windows: chuông không kéo/maximize cửa sổ, popover không bị clip, Esc/focus/window controls, Open đúng pane, hide/show đồng bộ badge, Quit không bị panel chặn. Không desktop E2E tự động; macOS để release preparation.

Trạng thái lúc viết thiết kế: BE-011 automated đã pass theo bàn giao; chưa thực hiện native toast smoke. Native smoke giai đoạn 8–10 vẫn pending; thiết kế này không chuyển các mục đó thành pass hoặc sửa plan lịch sử. Các checkbox trên là yêu cầu kiểm chứng ở implementation, chưa được chạy trong DESIGN ONLY. Toast thật trên installed identifier là kiểm chứng BE-011 còn pending, không thể suy ra từ component test hoặc build.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/lib/ipc/notifications.test.ts` | Unit | Sáu command args camelCase, cursor string passthrough, errors, event payload/unlisten |
| `src/features/notifications/use-notifications.test.ts` | Hook | Subscribe-before-query, count global, mutation không event, revision/paging races, dropped event recovery, listener cleanup và timer |
| `src/features/notifications/notification-center.test.tsx` | Component | Ba kind, copy, English time/fake clock, badge, paging, actions, empty/error, focus/read/delete và Escape |
| `src/app/notification-entry.test.tsx` | Component | Open result → setActivePane → optional restore → exact route; stale target, mismatch project, lỗi giữa bước, dismiss/Quit cancellation |
| `src/app/app-topbar.test.tsx` | Component | Bell interactive, số unread, tooltip, hover chung và vùng không kéo |
| `src/app/session-terminal-route.test.tsx` | Component | State hợp lệ truyền focusRequest, state sai bị bỏ, giữ composition Terminal |
| `src/features/sessions/session-route.test.tsx` | Component | Chờ đúng detail/DOM, cùng-route focus một lần, không steal focus khi refresh, missing target |
| `src/app/app-shell.test.tsx` | Component | Một entry/listener qua route, Quit precedence, shell regression |
| `src/app/app-router.test.tsx` | Component | Route regression dùng Notifications IPC mock riêng, không invoke native |
| `src/app/app-sidebar.test.tsx` | Component | Sidebar regression mount router có Notifications IPC mock riêng |

Test frontend mock IPC boundary, không chạy CLI/OS toast thật. Dùng deferred promise/fake timer cho race, không sleep tùy ý. Rust suite hiện có chạy regression, không tạo Rust test mới cho UI-only behavior.

## Câu hỏi mở

Không có.
