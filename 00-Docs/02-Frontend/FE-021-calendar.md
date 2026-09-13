# FE-021 — Calendar

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-021` |
| Phase | 4; Giai đoạn 20, mở rộng Missed tại Giai đoạn 21 |
| Khu vực chính | `src/features/calendar/` |
| Yêu cầu chức năng | §13.1, §6.2, §7.5, §14, §18 của `00-Docs/00-Overview/03-FunctionalRequirements.md` |
| Wireframe | `00-Docs/01-Wireframe/07-Calendar.html#month`, `#upcoming`, `#missed`; phần đọc `#detail`; `03-Home.html#full`, `04-Projects.html#overview`, `02-AppShell.html#palette` |
| Backend liên quan | BE-018; BE-010 Search; BE-019 chỉ khi mở rộng Giai đoạn 21 |
| Phụ thuộc | FE-001, FE-003, FE-005, FE-009; BE-018 đã tích hợp |

## Mục tiêu

Người dùng xem lịch tháng, lịch trình ngày và Upcoming 14 ngày từ occurrence thật do Rust tính. Home, Project Overview và Command Palette mở đúng event tại Calendar.

### Ngoài phạm vi

- FE-022 sở hữu form tạo/sửa, xác nhận xóa và mở rộng panel event trong cùng thư mục Calendar. FE-021 chỉ cung cấp panel đọc tối thiểu để navigation đã hoạt động thật.
- Scheduler, trạng thái sent, snooze/dismiss, Missed và notification visibility thuộc BE-019/Giai đoạn 21. Không suy diễn Missed từ event quá khứ hoặc hiển thị số giả.
- Không mở rộng command, schema, backup, dependency hoặc tính recurrence trong JavaScript.

### Quyết định theo ủy quyền

User cho phép agent tự quyết các câu hỏi thiết kế, ghi quyết định và triển khai BE → FE tuần tự. Ngày 2026-09-09 chốt:

1. FE-021 triển khai phần đọc `EventDetailPanel`; FE-022 mở rộng chính panel này, không tạo owner/detail cạnh tranh. Search event được bật trong FE-021 vì đã có đích đọc thật.
2. Calendar nhận callback tạo event có ngày điền sẵn. Nút `New Event` và `New event this day` chỉ xuất hiện khi callback thật được cung cấp bởi FE-022; FE021 không tạo form giả hoặc nút không có tác dụng. Giai đoạn 20 chỉ hoàn tất sau FE022 bật hai nút này.
3. `Missed` chưa render trong lát cắt này; Giai đoạn 21 bổ sung tab, badge và hành động theo BE019, không coi danh sách rỗng là đã tích hợp.
4. Upcoming dùng 14 ngày lịch bắt đầu hôm nay trong viewer timezone, giữ cả event đang diễn ra hôm nay. Home/Project hiển thị tối đa 5 occurrence đầu của cùng khoảng và liên kết `View calendar`. Không gọi toàn bộ lịch sử để kiểm tra event tồn tại.
5. Home không được suy ra “chưa có dữ liệu” từ range 14 ngày rỗng. Giữ logic chọn Welcome hiện có, nhưng cho phép render khối Upcoming bên dưới Welcome khi dự án/note rỗng; event riêng lẻ vẫn có đường mở Calendar. Không thêm API presence hoặc đổi nghĩa BE018 range.
6. Viewer timezone lấy `Intl.DateTimeFormat().resolvedOptions().timeZone`, fallback `UTC` khi thiếu; hiển thị timezone cạnh lịch. Backend từ chối timezone thì hiện lỗi và cho chọn `Use UTC`, không âm thầm đổi ngày.

## File liên quan

Bảng là phạm vi source/test được phép tác động; thêm file phát sinh phải ghi vào thiết kế trước khi dùng. Generated contract chỉ đọc.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/bindings/calendar.ts`, `src/bindings/search.ts` | DTO được sinh từ Rust, chỉ đọc |
| `src/lib/ipc/calendar.ts`, `src/lib/ipc/calendar.test.ts` | Wrapper query/detail và invalidation |
| `src/features/calendar/index.ts` | Public exports |
| `src/features/calendar/calendar-route.tsx`, `src/features/calendar/calendar-route.test.tsx` | Route, URL intent, chọn ngày/panel/detail |
| `src/features/calendar/calendar-month.tsx`, `src/features/calendar/calendar-month.test.tsx` | Grid tháng và bàn phím |
| `src/features/calendar/calendar-agenda.tsx`, `src/features/calendar/calendar-agenda.test.tsx` | Day/Upcoming và occurrence rows |
| `src/features/calendar/calendar-presentation.ts`, `src/features/calendar/calendar-presentation.test.ts` | Date-only arithmetic, nhóm/format occurrence, summary |
| `src/features/calendar/use-calendar-query.ts`, `src/features/calendar/use-calendar-query.test.ts` | Snapshot bounded, listener, generation và cleanup |
| `src/features/calendar/event-detail-panel.tsx`, `src/features/calendar/event-detail-panel.test.tsx` | Detail đọc thật, owner tiếp tục tại FE022 |
| `src/features/calendar/calendar-sections.tsx`, `src/features/calendar/calendar-sections.test.tsx` | Public Home/Project projections |
| `src/features/calendar/calendar-error-copy.ts`, `src/features/calendar/calendar-error-copy.test.ts` | Typed error → English recovery |
| `src/app/calendar-entry.tsx`, `src/app/calendar-entry.test.tsx` | Composition maintenance/Quit với Calendar |
| `src/app/app-router.tsx`, `src/app/app-router.test.tsx` | Thay Calendar placeholder |
| `src/app/home-entry.tsx`, `src/app/home-entry.test.tsx` | Inject HomeCalendarSection |
| `src/features/home/home-route.tsx`, `src/features/home/home-route.test.tsx` | Slot calendar cho dashboard/Welcome |
| `src/features/home/home-screen.tsx`, `src/features/home/home-screen.test.tsx` | Render event slot |
| `src/app/project-overview-entry.tsx`, `src/app/project-overview-entry.test.tsx` | Inject ProjectCalendarSection |
| `src/features/projects/project-overview-route.tsx`, `src/features/projects/project-overview-route.test.tsx` | Slot linked events khi project được xác thực |
| `src/app/search-entry.tsx`, `src/app/search-entry.test.tsx` | Revalidate event và navigate |
| `src/features/search/command-palette.test.tsx` | Regression nhóm event/keyboard nếu fixture cần cập nhật |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| CalendarRoute | Header Calendar, tháng, Previous month/Today/Next month; timezone; grid và panel 360px, xếp dọc khi hẹp | `#month` |
| CalendarMonth | Tuần Monday–Sunday, 35 hoặc 42 ô đủ tuần tùy tháng, ngày ngoài tháng giảm nhấn; today và selected phân biệt bằng nhãn/aria | `#month` |
| CalendarAgenda | Day/Upcoming tabs; title ngày, rows có giờ/all-day, title, project badge, recurrence/reminder summary | `#month`, `#upcoming` |
| EventDetailPanel | Dialog có tên event, giờ occurrence được chọn (nếu có), base schedule/timezone, mô tả plain text, recurrence, reminder definitions, linked project và Close | Phần đọc `#detail` |
| HomeCalendarSection / ProjectCalendarSection | Upcoming 14 ngày tối đa 5 rows và View calendar; lỗi độc lập không che khối khác | Home full, Project overview |

Month cell hiển thị tối đa 3 chips và `+N more` mở Day của ngày đó; không cắt mất đường truy cập occurrence. All-day có chip nền riêng; linked project có badge hoặc dot kèm accessible label. Không dùng màu làm dấu hiệu duy nhất. Không dựng nội dung HTML từ description.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang tải | Chưa có snapshot cho query hiện tại | `Loading calendar…`, aria-busy; không hiển thị dữ liệu tháng trước như tháng mới |
| Rỗng tháng | Snapshot hợp lệ không có occurrence | Grid chọn ngày vẫn hoạt động, `No events this month`; Today/Upcoming vẫn dùng được |
| Rỗng ngày | Ngày chọn không có occurrence | `No events this day`; hành động tạo khi FE022 tích hợp |
| Rỗng Upcoming | Range không có occurrence | `No events in the next 14 days`, View calendar trên aggregate |
| Refresh | Cùng query đang lấy lại | Giữ snapshot có nhãn đang refresh; không giả dữ liệu mới |
| Lỗi đọc | IPC/read thất bại | `Could not load calendar events`, Retry; nếu có snapshot ghi rõ có thể cũ |
| Listener lỗi | Đăng ký invalidation thất bại | Banner `Calendar updates are unavailable`, Retry đăng ký và refresh; focus refresh vẫn dùng được |
| Quá nhiều occurrence | `occurrence_limit_exceeded` | Không render kết quả cắt im lặng; khuyên chọn Day (query 1 ngày) hoặc khoảng khác |
| Detail bị xóa | `event_not_found` | `This event no longer exists`, Close và refresh list; không render detail cũ |
| Maintenance/Quit | Busy hoặc Quit không idle/snapshot-failed | Chặn navigation mới, clear/retire response theo epoch; reload sau import/reset |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Chọn ngày | Chọn ngày, chuyển panel Day; chọn ngày ngoài tháng chuyển tháng để ngày vẫn thấy | Enter/Space trên nút ngày |
| Đi trong grid | Roving tab index cho nút ngày; focus ngày không tự mở event | Arrow ±1/±7; Home/End đầu/cuối tuần; PageUp/PageDown tháng trước/sau giữ ngày clamp |
| Previous/Next/Today | Chuyển tháng; Today chọn hôm nay và Day | Tab + Enter |
| Chọn Upcoming | Range hôm nay tới hôm nay +14 exclusive, nhóm ngày và giữ server order trong nhóm | Tabs Arrow/Enter theo component dùng |
| Chọn chip/row | Mở detail theo eventId, giữ occurrence context opaque | Tab + Enter/Space |
| Đóng detail | Restore focus về opener nếu còn tồn tại, nếu mất thì heading Calendar | Escape hoặc Close |
| Tạo theo ngày | Gọi onCreateEvent với date-only ngày chọn và project filter hiện tại | Tab + Enter; bật tại FE022 |

Không lồng button event bên trong button ngày. Mỗi icon action có tooltip và accessible name. Focus ring theo token hiện có; UI English, hỗ trợ tăng font và reduced motion.

## Luồng chính

1. CalendarEntry truyền boundary snapshot và synchronous reader từ app data management/Quit; route tự giữ state UI.
2. Query đăng ký listener rồi lấy snapshot (hoặc refresh lại ngay sau khi listener đăng ký nếu đã khởi động read), không bỏ lỡ mutation trong khoảng setup. Cleanup xử lý cả listener promise resolve muộn.
3. Month query phủ toàn bộ grid date range <=42 ngày; Day query riêng 1 ngày để lấy event overlap ngày, kể cả event bắt đầu trước range; Upcoming query 14 ngày. Không mở query không đang hiển thị nếu không cần.
4. FE chỉ nhóm occurrence backend đã expand. Timed hiển thị ngày bắt đầu theo viewer timezone như BE018; Day dùng query 1 ngày để không mất event qua đêm; all-day hiển thị trên các ngày trong khoảng date half-open. Không parse date-only qua UTC rồi đổi local.
5. `calendar://changed`, project changes, focus/visibility về visible và maintenance epoch thay đổi kích hoạt reload. Mỗi query key/generation loại response cũ; coalesce invalidation đang pending và chạy thêm read sau flight nếu cần. Opaque revision chỉ so equality, không ép Number.
6. Route `/calendar?event=<encoded eventId>` đọc event độc lập với month range. Optional `date=YYYY-MM-DD` chỉ định ngày UI; `project=<encoded projectId>` scope aggregate dùng projectId được xác thực qua public Projects read. URL không hợp lệ trả thông điệp và cho về Today, không throw toàn route.
7. SearchEntry revalidate bằng getCalendarEvent, áp cancellation/epoch/route guard đang có rồi navigate cùng event route. Không dùng snapshot search như detail authoritative. Event mất thì palette báo lỗi, không điều hướng sai.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `list_calendar_occurrences` | `{ input: CalendarRangeInputDto }` | `CalendarOccurrenceListDto` | invalid_range/date/timezone → sửa selection/Use UTC; occurrence_limit_exceeded → Day; storage_unavailable → Retry; corrupt_stored_data/unauthorized_caller → thông điệp lỗi an toàn |
| `get_calendar_event` | `{ eventId: string }` | `CalendarEventDto` | event_not_found → đóng/refresh; invalid_event_id → URL lỗi; storage_unavailable → Retry; lỗi khác → an toàn |

Wrappers `listCalendarOccurrences(input)`, `getCalendarEvent(eventId)` dùng `invokeCommand` và generated DTO/CalendarError. Query mặc định projectId null, onlyWithReminders false; Project section dùng ID owner xác thực. FE021 không gọi command mutation. Project badge dùng public Projects IPC hiện có, không import feature projects nội bộ; lỗi lookup không chặn event đọc.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `calendar://changed` | `CalendarChangedEventDto` | Commit create/update/delete hoặc import/reset, chỉ main | Invalidate query và detail liên quan; bulk clear/refresh |
| Public Projects changed listener | DTO hiện có từ `src/lib/ipc/projects.ts` | Rename/delete/import | Refresh labels và project-scoped query vì unlink không được giả định có calendar mutation event |

Không cần Channel. Wrapper `onCalendarChanged(handler): Promise<UnlistenFn>` forward payload.

## State frontend

```ts
interface CalendarBoundary {
  suspended: boolean;
  epoch: number;
}
interface CalendarUiState {
  visibleMonth: string;
  selectedDate: string;
  panel: "day" | "upcoming";
  viewerTimeZoneId: string;
  selectedEventId: string | null;
  selectedOccurrence: CalendarOccurrenceDto | null;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Month/date/panel/timezone | UI tạm thời | Không persist vào SQLite/localStorage |
| Query snapshot và detail | Backend | Bounded lifetime, retire theo query/generation/epoch/unmount |
| occurrenceId/revision | Backend | Opaque; không split, tự tạo hoặc tăng |
| Today | Clock hiển thị FE | Recompute khi focus/visible và ngày đổi; tests dùng fake clock, không làm scheduler |

## Contract công khai của feature

```ts
export interface CalendarBoundary { suspended: boolean; epoch: number; }
export interface CalendarRouteProps {
  boundary?: CalendarBoundary;
  readBoundary?(): CalendarBoundary;
  onCreateEvent?(input: { date: string; projectId: string | null }): void;
}
export function CalendarRoute(props: CalendarRouteProps): React.JSX.Element;
export function HomeCalendarSection(props: CalendarRouteProps): React.JSX.Element;
export function ProjectCalendarSection(props: CalendarRouteProps & { projectId: string }): React.JSX.Element;
```

`src/app` compose các exports qua `index.ts`; Home/Projects nhận ReactNode/render prop, không import Calendar. `CalendarRoute` sở hữu read detail và URL selection, FE022 mở rộng bên trong owner này để gắn mutation form. Callback create là contract chuyển tiếp; FE022 có thể nối owner nội bộ nhưng phải giữ date/project prefill và regression test. Không export store nghiệp vụ hoặc giả lập mutation service.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Năm/tháng ở giới hạn 1900–9999 | Clamp navigation/query date hợp lệ, disable nút vượt giới hạn; không tạo ngày năm 10000 |
| Leap day/month 31 | Date arithmetic giữ lịch Gregorian, không roll vào tháng ngoài ý muốn |
| DST và all-day | Timed format từ epoch + viewer zone; all-day chỉ từ date strings; backend sở hữu resolve/recurrence |
| Multi-day/qua nửa đêm | Day query overlap giữ event; label có ngày bắt đầu/kết thúc khi không cùng ngày; không duplicate cùng occurrence trong Day |
| Search event ngoài tháng/series kết thúc | Detail vẫn mở được qua get, date base hiển thị rõ; không đòi occurrence hiện tại |
| Response cũ sau route/filter/reset | Không ghi snapshot hoặc mở lại detail |
| Component StrictMode/unmount trước listen resolve | Late unlisten gọi đúng, không setState muộn |
| Event thay đổi khi detail mở | Reload clean detail, xóa context occurrence stale khi không còn xác minh được; FE022 sẽ bảo vệ draft riêng |
| Project unavailable/deleted | Unavailable vẫn link metadata; deleted → unlink/không link hỏng sau refresh; event global vẫn đọc |
| Nội dung quá dài | Wrap title/description, không phá layout/focus; không log nội dung |

## Tiêu chí hoàn thành

- [x] Month/Day/Upcoming đọc IPC thật, không còn Calendar placeholder hoặc mock production.
- [x] Keyboard grid, event detail focus, loading/empty/error/Retry và limits kiểm chứng bằng unit/component test.
- [x] Home/Project sections và Search event navigation dùng dữ liệu thật, không import chéo implementation feature.
- [x] Invalidation, event xóa, late response, listener failure và maintenance/Quit có regression tests.
- [x] FE022 handoff giữ cùng detail owner, date-prefill callback; Missed/scheduler không bị triển khai sớm.
- [x] Windows frontend formatter/linter/typecheck/tests/build, Rustfmt/Clippy/Rust tests và Tauri build pass; native smoke ghi kết quả hoặc pending trung thực.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/lib/ipc/calendar.test.ts` | Contract | Exact command args, typed errors và event envelope/unlisten |
| `src/features/calendar/calendar-presentation.test.ts` | Unit | Leap/year boundary, Monday grid, date-only, viewer timezone, all-day, summary |
| `src/features/calendar/use-calendar-query.test.ts` | Hook | Bounds, deferred response race, listener setup/failure/late cleanup, invalidation, focus, epoch/suspension |
| `src/features/calendar/calendar-month.test.tsx` | Component | Roving keyboard, Today/selection, overflow chip, font-safe structure |
| `src/features/calendar/calendar-agenda.test.tsx` | Component | Day/Upcoming groups, overlap, all-day, empty/error/Retry |
| `src/features/calendar/event-detail-panel.test.tsx` | Component | Read detail, gone/error, project link, escape/focus restore, stale selection |
| `src/features/calendar/calendar-route.test.tsx` | Component | Query switching, URL event/date/project, deep link outside range, optional create date contract |
| `src/features/calendar/calendar-sections.test.tsx` | Component | 14 days/5 rows, project filter, error isolation and route links |
| `src/features/calendar/calendar-error-copy.test.ts` | Unit | Safe typed copy and recovery |
| `src/app/calendar-entry.test.tsx`, `src/app/app-router.test.tsx` | Integration UI | Composition boundary, real route, no placeholder |
| `src/app/home-entry.test.tsx`, `src/features/home/home-route.test.tsx`, `src/features/home/home-screen.test.tsx` | Integration UI | Calendar slot, event reachable with no project/note, existing Quick Note/session regression |
| `src/app/project-overview-entry.test.tsx`, `src/features/projects/project-overview-route.test.tsx` | Integration UI | Validated project event injection, unavailable project behavior |
| `src/app/search-entry.test.tsx`, `src/features/search/command-palette.test.tsx` | Integration UI | Enabled event target, revalidation, gone event, late navigation blocked, keyboard selection |

Test dùng Vitest mocked narrow IPC/listener, controlled promises và fake Date/Intl seam; không truy cập app data thật. Không desktop E2E. Native Windows smoke khi có khả năng: Calendar keyboard ở WebView2, font scale, focus khi đóng panel, Home/Search navigation với dữ liệu thử cô lập; native tools disabled thì ghi pending, không giả pass.

## Câu hỏi mở

Không có. Phân chia FE021/FE022/Giai đoạn 21 đã được quyết theo ủy quyền; bản này đặc tả phần Calendar Giai đoạn 20, phần Missed được bổ sung sau contract BE019.


### Phát sinh khi triển khai
- Shared IPC hiện chỉ nhận discriminator code, trong khi Calendar dùng kind. Bổ sung src/lib/ipc/ipc-error.ts và src/lib/ipc/ipc-error.test.ts vào phạm vi để giữ nguyên payload Calendar và tương thích các owner code hiện có.

- Phạm vi regression phát sinh: src/app/app-shell.test.tsx và src/app/app-topbar.test.tsx cần Calendar IPC fixture sau khi Home/Calendar sử dụng dữ liệu thật, tránh alert transport giả che assertions shell.

- Rìa năm 9999: grid bỏ ô ngoài miền ngày; BE018 dùng end exclusive nên ngày 9999-12-31 không có upper bound hợp lệ. UI giữ lỗi range có phục hồi, không tạo ngày năm 10000 hoặc nới backend contract.
- Điểm dừng user cập nhật: hoàn tất Giai đoạn 20, Giai đoạn 21 để lần sau. FE022 tiếp tục cùng EventDetailPanel/CalendarRoute.


### Kết quả FE021
Đã triển khai và kiểm chứng 160 file / 2624 FE tests, 590 Rust tests đạt (1 ignored có sẵn), format/lint/typecheck/build/Rustfmt/Clippy/Tauri build đạt. Native smoke còn pending vì native tools disabled; không có desktop E2E hoặc macOS test. Chi tiết command/log tại plan 20260909-fe021-calendar.md. FE022 mở rộng cùng owner để hoàn tất CRUD/Giai đoạn 20.


## Mở rộng Giai đoạn 21 — Missed — 2026-09-13

Theo ủy quyền user, extension này thay giới hạn GĐ20 chưa có Missed; không sửa plan lịch sử. Nguồn §13.1/13.3/18/20, `07-Calendar.html#missed`, BE019 đã triển khai. Không có câu hỏi mở.

### File liên quan bổ sung

| Đường dẫn | Vai trò |
|---|---|
| `src/features/calendar/calendar-missed.tsx`, `src/features/calendar/calendar-missed.test.tsx` | Panel Missed, actions, focus và paging |
| `src/features/calendar/use-missed-reminders.ts`, `src/features/calendar/use-missed-reminders.test.ts` | Query/count/sequence/listener/action lifecycle |
| `src/lib/ipc/reminders.ts`, `src/lib/ipc/reminders.test.ts` | Public wrappers theo extension FE010 |
| `src/lib/ipc/reminder-error.ts`, `src/lib/ipc/reminder-error.test.ts` | Shared typed reminder error |
| `src/bindings/reminders.ts` | Generated DTO, chỉ đọc |

`calendar-route.tsx`/tests, `calendar-presentation.ts`/tests, `event-detail-panel.tsx`/tests, `calendar-entry.tsx`/tests và index đã thuộc bảng chính. Không mở rộng Home/Projects UI sang Missed.

### UI và quyết định

- Thêm tab `Missed` cạnh Day/Upcoming, badge `missedCount` toàn backend, giữ số thật trong accessible name và clamp hiển thị 99+ nếu cần. Unknown/loading không giả count 0. Tab keyboard tương đương hai tab hiện có.
- Missed là toàn ứng dụng, độc lập tháng/ngày/project filter vì BE019 không có filter. Copy `Missed reminders across all projects` khi project đang scope; không tự lọc page gây sai count/paging. Grid tháng giữ filter bình thường, không suy Missed từ event quá khứ hoặc tô tất cả ngày quá khứ.
- `getMissedReminders(null, 30)` lấy count/page; giữ listener/count khi Day/Upcoming để badge cập nhật. Chỉ load thêm khi Missed đang mở. Rows theo server order, title, original due, startsAt, reminder offset, optional project marker. Time decimal kiểm Date domain trước format bằng timezone delivery, fallback `Time unavailable`; không tính recurrence/scheduler trong JS.
- Rows có `Open event` và `Dismiss`. `Dismiss all` ghi rõ `Dismiss all missed reminders` trong accessible name và mô tả áp dụng cả rows chưa tải, toàn project; không cần confirmation vì không xóa event, theo wireframe. Không Snooze missed. Open gọi openReminder, navigate target đã revalidate với event/occurrence/project và không đổi count/delivery.
- Empty `No missed reminders`, giải thích reminder khi app đã Quit xuất hiện tại đây, cho chọn Upcoming. Loading `Loading missed reminders…`; catching-up giữ loading, không render empty. Lỗi `Could not load missed reminders.` + Retry; stale snapshot có nhãn và khóa actions. Listener error banner + Retry, focus recovery vẫn read.
- Single/all dismiss chỉ publish acknowledgement của current epoch, refetch page đầu và count; outbox bell xóa eventual. Không decrement count theo rows loaded. Double-click và load-more/mutation được khóa đồng bộ; mutation lỗi không tự retry. Row mất restore focus row kế/trước hoặc heading Missed; banner/status không cướp focus.

### State, boundary và IPC

Dùng MissedReminderPageDto/ReminderDeliveryDto/ReminderCursorDto generated, wrapper và error mapping FE010. Hook nội bộ giữ page, nextCursor, sequence, loading/refreshing/pending/error và request generation. Public CalendarRoute/CalendarBoundary không đổi. `reminders://changed` invalidates count và page; `calendar://changed`, focus, Data epoch cũng refresh. Không persist state localStorage.

Một request và tối đa một refresh pending; sequence decimal so BigInt, reject page cũ so latest invalidation. Append chỉ khi cùng page sequence/cursor/epoch, dedupe id, giữ server order; sequence đổi thì page đầu thay tất cả. Listener setup race được cover bằng second read; late listener cleanup, unmount/suspended/epoch retire mọi response và navigation. `readBoundary()` được kiểm tra trước mọi await-dependent publish; timer UI chỉ format giờ, không schedule reminder.

### Tiêu chí và kiểm thử bổ sung

- [x] Missed/count từ backend, >30 rows load-more đúng, Dismiss all áp dụng toàn backend kể cả filter và rows chưa tải.
- [x] Component/hook tests có catch-up/loading/empty/error, sequence race/duplicate events, cursor invalidation, listener setup failure/late cleanup, transport unknown và Data/Quit retirement.
- [x] Open trả đúng occurrence URL không dismiss; stale target không route; Dismiss lấy đúng version; không Snooze missed.
- [x] CalendarRoute tests bảo đảm Day/Upcoming/month/project/create không regression và badge không hardcoded.
- [x] Date presentation unit test cho malformed/out-of-range timestamps, timezone hợp lệ; native toast/restart không suy từ FE fake timers.

Kết quả tích hợp FE023: automated gates Windows đạt (2.715 frontend tests, 633 Rust tests; 1 benchmark có sẵn ignored, Clippy/Rustfmt/build đạt). Native smoke chưa thực hiện; bằng chứng và giới hạn nằm trong `../98-Plan/20260913-fe023-reminder-notification-settings.md`. Không tuyên bố toàn bộ native/Phase 4 acceptance đã hoàn tất.
