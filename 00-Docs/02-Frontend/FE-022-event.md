# FE-022 — Event

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-022` |
| Trạng thái | Đã triển khai, GĐ20 đạt kiểm chứng tự động Windows; native smoke pending |
| Phase | 4, Giai đoạn 20 |
| Khu vực chính | `src/features/calendar/` |
| Yêu cầu chức năng | §13.2; tương tác §13.1, §18; tổng hợp §6.2, §7.5, §14; tiêu chí §20 |
| Wireframe | `00-Docs/01-Wireframe/07-Calendar.html#form`, `#detail` |
| Backend liên quan | BE-018, BE-003 (project picker), BE-010 (Search), BE-012 (invalidation import/reset) |
| Phụ thuộc | FE-021 đã tích hợp; FE-001, FE-003, FE-005, FE-009 |

## Mục tiêu

Người dùng tạo, xem, sửa và xóa event thật từ Calendar; event có thời gian hoặc cả ngày, project tùy chọn, recurrence và nhiều định nghĩa reminder. Mutation cập nhật lịch tháng/ngày/Upcoming và các đường mở Home, Project Overview, Search qua BE018 đã triển khai.

### Ngoài phạm vi

- Giai đoạn 21: scheduler, notification settings, sent/due delivery status, snooze/dismiss, Missed và thông báo hệ điều hành. Không render trạng thái `sent` giả từ wireframe detail.
- Không sửa một occurrence riêng lẻ, exception date, raw RRULE, drag-reschedule, autosave, lưu bản nháp xuống disk, API/schema/dependency mới.
- Không thay đổi plan FE021 đã hoàn tất; không coi toàn bộ Phase 4 đã hoàn thành ở Giai đoạn 20.

### Quyết định theo ủy quyền

Ngày 2026-09-09, theo ủy quyền tự quyết của user: dùng cùng EventDetailPanel của FE021 làm owner đọc/sửa/xóa; form create do CalendarEntry ghép thông qua callback thật `onCreateEvent({ date, projectId })`. Edit/delete luôn áp dụng toàn bộ event/chuỗi; phải ghi rõ `Changes apply to the entire series` và xác nhận xóa cả chuỗi.

Tech Stack liệt kê React Hook Form/Zod ở mức mục tiêu nhưng manifest hiện tại chưa cài; chốt dùng controlled React như form hiện có để không thêm dependency cho lát cắt này.

Form mặc định timed 09:00–10:00 ngày chọn, timezone viewer (fallback UTC như FE021), project đã xác thực từ callback, không lặp, một reminder 10 phút. BE018 cho phép 0–16 reminder: chốt cho phép bỏ hết, hiển thị `No reminders` để hỗ trợ event chỉ dùng để ghi lịch; giới hạn này thay cho “any number” trong wireframe. Backend vẫn là nguồn validation cuối.

All-day dùng `Starts` và `Last day` bao gồm ngày cuối trên UI, chuyển date-only sang `endDateExclusive = lastDay + 1`; không chuyển qua UTC. Timed giữ datetime-local trong timezone event. Chuyển toggle giữ ngày và các giờ timed trong bộ nhớ; từ event all-day sang timed mặc định 09:00 ngày đầu và 10:00 ngày cuối. Đổi timezone giữ wall time, hiển thị giải thích trước Save; không tự đổi thành timezone máy lúc edit.

Bản nháp là form lưu thủ công: Cancel/Close/Escape khi dirty hỏi `Discard changes?` với `Keep editing`/`Discard changes`; không save lúc đóng. Maintenance/Quit được quyền retire toàn bộ form và phản hồi pending như FE021; không thêm participant vào lifecycle Notes/Files. Quit hủy thì đọc lại dữ liệu, không khôi phục bản nháp đã retire. Điều này được ghi bằng hint `Unsaved event changes are discarded when quitting or replacing app data.` trong form.

## File liên quan

Bảng là phạm vi được phép chỉnh source/test. Các contract/backend/config được ghi chỉ đọc để kiểm chứng; không sửa binding bằng tay.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/bindings/calendar.ts`, `src/bindings/projects/projects.ts` | DTO generated, chỉ đọc |
| `src/lib/ipc/calendar.ts`, `src/lib/ipc/calendar.test.ts` | Thêm bốn wrapper mutation, typed error |
| `src/lib/ipc/projects.ts` | `listProjects`, `getProject`, `onProjectsChanged`, chỉ đọc |
| `src/features/calendar/event-form.tsx`, `src/features/calendar/event-form.test.tsx` | Form controlled, validation hiển thị, project picker, thao tác bàn phím |
| `src/features/calendar/event-form-state.ts`, `src/features/calendar/event-form-state.test.ts` | Draft, mapping DTO, date-only/time/recurrence/reminder presentation validation |
| `src/features/calendar/event-create-dialog.tsx`, `src/features/calendar/event-create-dialog.test.tsx` | Create owner, admission, submit, discard |
| `src/features/calendar/event-delete-dialog.tsx`, `src/features/calendar/event-delete-dialog.test.tsx` | Prepare/confirm, preview, TTL/error recovery |
| `src/features/calendar/event-detail-panel.tsx`, `src/features/calendar/event-detail-panel.test.tsx` | Mở rộng owner đọc bằng edit/delete, dirty/stale/epoch |
| `src/features/calendar/calendar-route.tsx`, `src/features/calendar/calendar-route.test.tsx` | Creation callback, URL, focus, refresh |
| `src/features/calendar/calendar-error-copy.ts`, `src/features/calendar/calendar-error-copy.test.ts` | Copy riêng mutation/field, đọc lỗi theo kind |
| `src/features/calendar/calendar-presentation.ts`, `src/features/calendar/calendar-presentation.test.ts` | Date-only helper hiện có; detail all-day inclusive |
| `src/features/calendar/index.ts` | Export create entry và giữ public exports FE021 |
| `src/features/calendar/use-calendar-query.ts`, `src/features/calendar/use-calendar-query.test.ts` | Regression invalidation và response retirement; chỉnh khi cần để local mutation refresh |
| `src/features/calendar/calendar-sections.tsx`, `src/features/calendar/calendar-sections.test.tsx` | Regression Home/Project projection sau mutation |
| `src/app/calendar-entry.tsx`, `src/app/calendar-entry.test.tsx` | Ghép create dialog, boundary/readBoundary, success URL |
| `src/app/home-entry.test.tsx`, `src/app/project-overview-entry.test.tsx`, `src/app/search-entry.test.tsx` | Regression mở đúng detail thật từ aggregate/Search |
| `src/components/ui/dialog.tsx`, `src/components/ui/button.tsx` | Primitive hiện có, chỉ đọc |
| `src/app/quit-store.ts`, `src/features/settings/data-management-provider.tsx` | Boundary hiện có, chỉ đọc |
| `src-tauri/tests/calendar_commands.rs`, `src-tauri/tests/calendar_occurrences.rs`, `src-tauri/tests/calendar_consumers.rs`, `src-tauri/tests/calendar_support/mod.rs` | Regression backend thật và isolated fixture, chỉ đọc |
| `src-tauri/tests/data_management_contract.rs`, `src-tauri/tests/app_builder.rs`, `src-tauri/tests/export_bindings.rs` | Backup/registration/binding regression, chỉ đọc |
| `package.json`, `pnpm-lock.yaml`, `src-tauri/Cargo.toml`, `src-tauri/src/app/mod.rs`, `src-tauri/capabilities/main.json` | Kiểm tra dependency/command/capability không đổi, chỉ đọc |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| EventCreateDialog / EventForm | Sheet ở cạnh phải, rộng tối đa khoảng 560px, full width khi hẹp; nội dung scroll, footer Save event/Cancel | `#form` |
| EventDetailPanel | Giữ detail dialog accessible hiện có; title/description, base time, selected occurrence, timezone, project link, recurrence/reminder summary; Edit và Delete Event | `#detail` |
| EventDeleteDialog | Dialog xác nhận với title, số reminder definitions, thông báo xóa toàn bộ chuỗi, Cancel và Delete Event | `#detail` |

Mọi input có label, lỗi `aria-invalid`/`aria-describedby`, group weekday/recurrence có legend; lỗi submit focus field đầu tiên, lỗi chung `role=alert`, loading/saving `role=status` và `aria-busy`. Không dùng icon không nhãn thiếu tooltip. Focus trap/restore dùng Dialog hiện có; không có hai modal editor cùng hoạt động. Description luôn plain text. Create không có Delete; edit có Delete tách bên trái footer.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Form rỗng | Create vừa mở | Prefill lịch; title bắt buộc; nhập rồi Save event |
| Đang tải | Detail/project list chưa về | Loading event/projects; không edit DTO chưa có; None project vẫn dùng được nếu list lỗi |
| Không có project/reminder | List rỗng / bỏ hết reminder | `No projects available` / `No reminders`, Add reminder còn dùng được |
| Đang ghi | Mutation đã được admit | Khóa input, Save/Delete/Cancel và đóng dialog để tránh submit lặp; `Saving event…`/`Deleting event…` |
| Lỗi field | Client rule hoặc typed backend validation | Giữ draft, gắn lỗi field, sửa và Save lại |
| Lỗi read/storage | Read thất bại / backend trả lỗi xác định | Giữ form và Retry đọc hoặc Save lại thủ công; không retry mutation tự động |
| Kết quả không rõ | Transport rejection không có typed CalendarError sau mutation | Giữ draft nhưng khóa resubmit; hướng dẫn đóng và kiểm tra Calendar trước khi tạo lại; update/delete có Reload để kiểm tra server; không tự phát lại create |
| Stale edit | Event invalidation khác revision, external delete, focus re-read khác revision | Giữ nguyên draft; chặn Save/Delete, `This event changed. Reload to edit the latest version.`; Reload cần xác nhận bỏ draft |
| Preview hết hiệu lực | TTL hết hoặc impact/revision đổi | Xóa requestId phía UI; `Review deletion again`, prepare mới và cần bấm Delete Event lần nữa |
| Maintenance/Quit | Live boundary suspended/epoch đổi | Retire form/preview và mọi response; không mutation/navigation/focus từ callback cũ |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| New Event / New event this day | Callback có date/project đã xác thực mở create thật, focus Title; scope lỗi/chưa xác thực chặn tạo | Tab + Enter |
| Save event | Validate, admit đồng bộ, gọi đúng create/update một lần; IME composing không submit | Enter theo form ngoài textarea/composition; không đăng ký shortcut toàn cục |
| All day | Đổi nhánh DTO, giữ timezone và quy tắc date-only nêu trên | Space |
| Repeat | None/Daily/Weekly/Monthly/Yearly; Weekly checkbox Monday–Sunday; Ends Never/On date/After count | Tab, Space, select native |
| Add/Remove reminder | Row offset integer minutes 0–525600; presets 0/5/10/30/60/1440 và Custom; tối đa 16, không trùng; bỏ hết hợp lệ | Nút có nhãn đầy đủ |
| Edit | Tạo draft từ base CalendarEventDto, không từ selected occurrence | Tab + Enter |
| Delete Event | Nếu dirty hỏi bỏ edit trước, rồi prepare bằng revision mới nhất đã đọc; xem impact, confirm | Tab + Enter |
| Cancel/Close/Escape | Clean đóng ngay; dirty hỏi discard; đang ghi không đóng bằng người dùng | Escape |
| Linked project | Mở project từ detail sạch; không giữ editor dirty trong navigation | Tab + Enter |

## Luồng chính

1. CalendarEntry dùng useCalendarBoundary, lưu create intent tạm và truyền callback cho CalendarRoute. Intent được nhận chỉ khi live epoch khớp và không suspended. Không mở create chồng detail (đóng event URL trước); focus opener được lưu.
2. Form tạo EventInputDto: không giữ reminder IDs, UTC cache hoặc revision trong draft payload. Title 1–200 Unicode scalar không control; description tối đa 20.000 scalar (LF/TAB hợp lệ), normalize để backend xác quyết. Không dùng maxlength UTF-16 thay scalar rule.
3. Time validation UI kiểm tra dạng date/datetime-local, năm 1900–9999, end > start và date-only conversion không overflow. Duration ≤366 ngày, timezone/DST resolution do Rust quyết định; `nonexistent_local_time` yêu cầu sửa giờ; ambiguous time dùng nhánh sớm theo BE018, không tự chọn offset JS.
4. Weekly mặc định weekday của start, yêu cầu gồm weekday start. Khi đổi start không âm thầm sửa danh sách đã chọn: hiển thị lỗi nếu thiếu. OnDate ≥ start date (bao gồm); count integer 1–10000. Đổi kind không gửi field thừa. Giải thích monthly/yearly bỏ ngày không tồn tại và count chỉ tính occurrence hợp lệ; không tự expand recurrence.
5. Project picker dùng public IPC, có None; unavailable folder vẫn có thể liên kết. List lỗi không tự unlink project cũ; refresh metadata không ghi đè draft. Project bị xóa/đổi trong race hiển thị lỗi, yêu cầu chọn None hoặc project còn tồn tại trước retry.
6. Create success dùng DTO trả về, đóng create, mở `/calendar?event=...` giữ date/project scope hợp lệ. Không đổi query range để giả event xuất hiện; detail đọc trực tiếp id kể cả event ngoài range. Update success trở lại detail authoritative, xóa occurrence context cũ và refresh query. Delete success đóng detail, bỏ chỉ `event` URL, giữ ngày/scope và restore focus opener hoặc heading.
7. Mutation thành công gọi refresh local owner kể cả event native bị mất; `calendar://changed` tiếp tục refresh Home/Project/Search theo FE021. Không optimistic insert/update/delete occurrence và không coi invalidation là mutation acknowledgement.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_calendar_event` | `{ eventId }` | `CalendarEventDto` | Not found đóng đường edit, Retry read lỗi storage |
| `create_calendar_event` | `{ input: EventInputDto }` | `CalendarEventDto` | Field errors; project race; storage; unknown outcome |
| `update_calendar_event` | `{ input: UpdateCalendarEventInputDto }` | `CalendarEventDto` | Như create; revision_conflict reload; not found |
| `prepare_delete_calendar_event` | `{ input: EventRevisionInputDto }` | `DeleteCalendarEventImpactDto` | revision_conflict reload; not found; storage |
| `confirm_delete_calendar_event` | `{ input: ConfirmDeleteCalendarEventInputDto }` | `DeletedCalendarEventDto` | missing/expired/impact_changed prepare lại; not found; storage |
| `list_projects`, `get_project` | Optional search / projectId, theo BE003 | ProjectDto list/detail | Picker Retry; không xóa link ngầm |

Bốn wrapper thêm: `createCalendarEvent(input: EventInputDto): Promise<CalendarEventDto>`, `updateCalendarEvent(input: UpdateCalendarEventInputDto): Promise<CalendarEventDto>`, `prepareDeleteCalendarEvent(input: EventRevisionInputDto): Promise<DeleteCalendarEventImpactDto>`, `confirmDeleteCalendarEvent(input: ConfirmDeleteCalendarEventInputDto): Promise<DeletedCalendarEventDto>`. Dùng invokeCommand, CalendarError generated; phân nhánh `IpcCallError.payload.kind`, không `code`, không hiển thị raw transport.

Revision là opaque string lấy từ snapshot lúc bắt đầu edit; không parse/increment/đổi sang currentRevision để retry. RequestId delete là number từ preview, TTL 60 giây do backend clock; frontend không tự dựng token, không tự confirm sau refresh. Prepare lại thay preview cũ cùng caller. Cancel chỉ bỏ state UI, không cần command cancel.

Lỗi field: invalid_title → Title; description_too_long → Description; invalid_project_id/project_not_found/project_changed → Project; invalid_date/invalid_local_date_time/invalid_time_range/date_out_of_range → Starts/Ends; invalid_time_zone → Time zone; nonexistent_local_time → Starts/Ends với giải thích DST; invalid_recurrence/invalid_recurrence_end → Repeat/Ends; too_many_reminders/duplicate_reminder/invalid_reminder_offset → Reminders. Invalid id/revision, unauthorized, corrupt storage hiển thị lỗi an toàn, chặn destructive retry cho tới reload hợp lệ. `revision_conflict` giữ draft, Reload rõ ràng; không blind overwrite.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `calendar://changed` | `CalendarChangedEventDto` | Sau commit create/update/delete/import/reset | Clean detail reload; dirty edit revalidate revision mà không overwrite draft; delete preview invalidated khi event liên quan hoặc bulk |
| `projects://changed` | `ProjectChangedEventDto` | Metadata thay đổi | Refresh picker/label và revalidate link; không đổi lựa chọn draft ngầm |
| Window focus | Browser focus event | Quay lại app | Re-read authoritative detail/labels; giữ draft; phát hiện revision mới |

Listener setup có second read chống race, late subscription phải cleanup, failure banner có Retry. Sequence chỉ invalidation token, không dùng làm event revision. Bulk/epoch retire draft/preview; asynchronous success/error/listener/focus đều kiểm tra owner identity, operation ticket và live boundary trước publish.

## State frontend

```ts
interface EventFormDraft {
  title: string;
  description: string;
  projectId: string | null;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timeZoneId: string;
  recurrence: EventRecurrenceDto;
  reminderMinutes: string[];
}
interface EventEditorState {
  source: CalendarEventDto | null;
  draft: EventFormDraft;
  phase: 'editing' | 'saving' | 'stale' | 'uncertain';
  dirty: boolean;
  fieldErrors: Partial<Record<keyof EventFormDraft, string>>;
  error: unknown;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| source/revision/impact | Rust qua generated DTO | Snapshot, không business cache lâu dài |
| draft/errors/dirty | UI tạm thời | Không autosave, không localStorage, không persist Zustand |
| epoch/ticket/in-flight lock | UI operation owner | Ref đồng bộ trước await, retire trên unmount/selection/boundary; chặn double-click trước React render |
| project labels/occurrence | IPC read | Label phụ, occurrence không dùng edit definition |

## Contract công khai của feature

```ts
/** Compose creation within the application-owned Calendar boundary. */
export function EventCreateDialog(props: {
  date: string;
  projectId: string | null;
  boundary: CalendarBoundary;
  readBoundary(): CalendarBoundary;
  onCreated(event: CalendarEventDto): void;
  onClose(): void;
  restoreFocus(): void;
}): React.JSX.Element;
```

Giữ CalendarRouteProps của FE021; CalendarEntry là composition root import public index. EventForm, draft helper và EventDeleteDialog là nội bộ Calendar. Không feature nào import implementation của Calendar để tạo link; dùng navigation đã có của FE021.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Invalidation đến trước mutation response | Không clear draft/pending hay submit lần hai; response đúng ticket quyết định success; subsequent read revalidate |
| Response A về sau khi chọn B/đóng/import/reset/Quit | Không setState, navigate, refresh sai lifetime hay chuyển focus |
| Focus/read refresh cùng revision khi dirty | Giữ draft và status, không báo conflict giả |
| Event bị xóa khi edit | Giữ draft để đọc/copy, khóa Save/Delete; báo không còn tồn tại, Close có discard |
| TTL expiry hoặc impact đổi | Không confirm lại token cũ; preview mới cần explicit confirmation |
| Cancel delete | Giữ event; nếu đã discard draft trước prepare thì về clean detail |
| All-day last day 9999-12-31 | Báo không thể biểu diễn end exclusive; không wrap sang 1900 hoặc gửi malformed date |
| Reminder input rỗng/thập phân/trùng | Field error; không ép NaN thành 0 hoặc loại trùng âm thầm |
| Project selector tải lỗi | Retry; None vẫn tạo được; project đang chọn giữ nguyên và không giả đã được revalidate |
| Native event emit thất bại sau commit | Command success vẫn là success, local query refresh; aggregate refresh on focus như FE021 |
| Create outcome không rõ | Không auto retry/idempotency giả; yêu cầu kiểm tra Calendar trước khi đóng và tạo lại |

## Tiêu chí hoàn thành

- [x] New Event và New event this day mở form thật với đúng ngày/project; tạo timed/all-day và mọi recurrence/end mode, nhiều reminder, None project round-trip.
- [x] Edit từ month/day/Upcoming/Home/Project/Search dùng base event, revision và giữ timezone; không edit occurrence riêng.
- [x] Delete prepare/confirm có title, reminder count, toàn chuỗi, TTL/revision recovery; Cancel không write.
- [x] Validation, error.kind, keyboard/focus, dirty/stale, unknown outcome, duplicate submit, listener/setup race, maintenance/Quit và response retirement có tests.
- [x] Calendar/Home/Project/Search refetch thật sau mutation; event ngoài range vẫn mở bằng id; không hardcode sample events.
- [x] Frontend format/lint/typecheck/test/build, Rustfmt/Clippy toàn target/features warnings denied, Rust tests và Windows Tauri build pass theo plan.
- [x] GĐ20 có bằng chứng tự động Calendar CRUD/aggregate và backup v3 từ BE018. §20 Phase4: phần month/day/Upcoming và event definition kiểm chứng ở đây; Missed/delivery/reopen thuộc GĐ21, chưa hoàn tất.
- [x] Native Windows smoke ghi riêng trạng thái thực tế. Khi native API disabled, ghi pending; không giả có smoke pass và không thêm desktop E2E. Không gọi toàn bộ native/Phase4 gate hoàn tất nếu còn pending.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/lib/ipc/calendar.test.ts` | Contract | Bốn command/payload/DTO/error kind đúng generated |
| `src/features/calendar/event-form-state.test.ts` | Unit | Scalar text, date-only inclusive/exclusive, toggle, timezone giữ nguyên, recurrence discriminants/count/weekdays, reminder limits/duplicates |
| `src/features/calendar/event-form.test.tsx` | Component | Fields/modes/project loading/error, no projects/reminders, validation/focus, IME, accessible keyboard |
| `src/features/calendar/event-create-dialog.test.tsx` | Component | Prefill/save/cancel/discard, duplicate admission, unknown outcome, boundary ahead of render, late response |
| `src/features/calendar/event-detail-panel.test.tsx` | Component | Edit base/opaque revision, stale without losing draft, same revision refresh, external deletion, event-before-response, read failure/cleanup |
| `src/features/calendar/event-delete-dialog.test.tsx` | Component | Prepare/confirm/Cancel, TTL and impact recovery, no automatic reconfirm, pending retirement |
| `src/features/calendar/calendar-route.test.tsx`, `src/app/calendar-entry.test.tsx` | Component | Creation wired, valid scope, URL/focus, maintenance/Quit live admission |
| `src/features/calendar/calendar-error-copy.test.ts`, `src/features/calendar/calendar-presentation.test.ts` | Unit | Typed errors và all-day inclusive detail |
| `src/features/calendar/use-calendar-query.test.ts`, `src/features/calendar/calendar-sections.test.tsx` | Component/Unit | Mutation invalidation và aggregate refresh |
| `src/app/home-entry.test.tsx`, `src/app/project-overview-entry.test.tsx`, `src/app/search-entry.test.tsx` | Component | Open event rồi edit/delete route thật không regression |
| Backend tests liệt kê trong File liên quan | Integration/Contract | Existing real CRUD, recurrence, search, backup, caller/generated regression; không thêm Rust behavior |

FE tests mock tại public IPC, dùng deferred promises/controlled boundary/fake timer để inject setup, read và mutation failure; không gọi Tauri thật hay app data. Backend tests dùng fixture Storage/temp directories và CalendarClock hiện có; không mutation environment toàn process. Frontend test maxWorkers=2; Rust -j1, test-threads=1; không chạy FE tests cùng Rust heavy linking.

## Câu hỏi mở

- Không có.

## Kết quả triển khai — 2026-09-09

Đã nối Event CRUD thật: CalendarEntry mở form từ cả hai callback ngày/project đã xác thực; EventDetailPanel tiếp tục là owner duy nhất cho xem/sửa/xóa. Form dùng base event, revision opaque, all-day inclusive/exclusive, recurrence/end modes và 0–16 reminder definitions. Có khóa mutation đồng bộ, giữ dirty draft khi cùng revision, Reload khi stale/unknown, preview delete có TTL và luôn cần xác nhận mới. Command acknowledgement refresh local reads; invalidation/focus giữ đường Home/Project/Search hiện có.

GĐ20 đã hoàn tất phần triển khai và kiểm chứng tự động: focused 17 files / 173 tests; toàn frontend 164 files / 2.661 tests; Rust 590 tests đạt, 1 benchmark hiệu năng Notes có sẵn ignored. Sáu backend contract targets chạy đích danh đạt 76 tests. Format/lint/typecheck/frontend build/Rustfmt/Clippy với đủ flags/Windows Tauri build đều đạt. Executable: `src-tauri/target/release/xwork.exe`; release build 4 phút 33 giây. `bundle.active=false` có sẵn nên không sinh installer. Vite còn notices CodeMirror/chunk size và ts-rs còn notices parse `deny_unknown_fields` có sẵn; không sửa dependency hoặc tắt cảnh báo.

Chi tiết commands, counts, log ngoài repo và deviation về thứ tự red-test nằm trong [implementation plan](../98-Plan/20260909-fe022-event.md). Không thay đổi generated binding, Rust/schema/command/capability, manifest, lockfile hoặc plan FE021 lịch sử.

Native Windows smoke vẫn **pending** vì native controls bị tắt; chưa quan sát thao tác WebView2/focus/IME thật và không dùng desktop E2E thay thế. GĐ21 (Missed, scheduler, delivery/restart, notification settings) để lần sau; không tuyên bố toàn bộ native gate hoặc Phase 4 hoàn tất.
## Mở rộng Giai đoạn 21 — Delivery detail và visibility — 2026-09-13

Theo ủy quyền user, extension tích hợp cần thiết của lát cắt FE023 thay giới hạn GĐ20 chưa có delivery/visibility. Dựa §13.3, §18, wireframe `07-Calendar.html#detail`/`#reminder`, BE019. Không có câu hỏi mở; không sửa plan FE022 lịch sử.

### File liên quan bổ sung

| Đường dẫn | Vai trò |
|---|---|
| `src/features/calendar/use-event-reminders.ts`, `src/features/calendar/use-event-reminders.test.ts` | Delivery read và runtime visibility lifecycle |
| `src/lib/ipc/reminders.ts`, `src/lib/ipc/reminders.test.ts` | Wrapper typed theo extension FE010 |
| `src/lib/ipc/reminder-error.ts`, `src/lib/ipc/reminder-error.test.ts` | Shared error copy |
| `src/bindings/reminders.ts` | Regenerate duy nhất từ Rust khi nullable visibility contract thay đổi |
| `src-tauri/src/calendar/reminder_models.rs` | Nullable occurrence visibility input |
| `src-tauri/src/calendar/reminder_service.rs` | Validate event-only visibility và giữ policy exact event |
| `src-tauri/src/calendar/reminder_scheduler.rs` | Eligibility so đúng event ID, kể cả base detail và occurrence khác của cùng event |
| `src-tauri/tests/reminder_actions.rs`, `src-tauri/tests/reminder_notifications.rs` | Null/supplied occurrence, invalid IDs và visibility token/policy regression |
| `src-tauri/tests/export_bindings.rs` | Generator/drift verification |
| `00-Docs/03-Backend/BE-019-reminder-scheduler.md` | Ghi contract adjustment và quyết định tích hợp |

`calendar-route.tsx`/tests, `event-detail-panel.tsx`/tests, `src/app/calendar-entry.tsx`/tests và `src/app/notification-entry.tsx`/tests thuộc scope integration; các bảng chính của FE021/FE010 đã chứa đường dẫn. Không thay capabilities, commands registry, migration, manifest hoặc scheduler.

### Quyết định contract visibility tối thiểu

BE019 hiện bắt occurrenceId cho show nhưng Search/create thành công mở base detail chỉ có eventId; OS policy thật so exact eventId. Không dựng occurrence giả và không expand recurrence trong frontend. Điều chỉnh `VisibleCalendarEventInputDto` nhánh show thành `{ kind: 'show'; viewToken: string; eventId: string; occurrenceId: string | null }`; hide giữ nguyên `{ kind: 'hide'; viewToken: string }`. Rust dùng Option<String>, validate eventId luôn, validate shape và event association của occurrence khi Some như trước; null hợp lệ để báo base detail. Runtime lưu nullable occurrence nếu còn field, policy vẫn main-visible && exact eventId. Không đổi delivery query yêu cầu occurrenceId thực. Bindings phải regenerate bằng exporter, không sửa tay.

### UI, route và vòng đời

- CalendarRoute đọc optional `occurrence` URL và truyền opaque ID tách khỏi CalendarOccurrenceDto local; không cần occurrence nằm trong tháng hiện tại. Query getEventReminderDeliveries(eventId, occurrenceId) xác thực context; không parse occurrence để tạo thời gian/event giả. Khi chọn chip/row, lưu occurrence đúng; khi đóng/chọn event khác/create, bỏ occurrence cũ. Open từ bell/Missed giữ ID do backend trả.
- Detail luôn hiển thị reminder definitions từ Calendar. Chỉ khi có occurrence cụ thể, đọc delivery và hiện `Active`, `Missed`, `Snoozed until …`, `Dismissed`, `Suppressed` đúng DTO. Không dịch active thành `Sent` hoặc tuyên bố OS đã nhận; không có delivery không có nghĩa future scheduled. Base detail không có occurrence chỉ hiện definitions, không query delivery bằng ID tự dựng.
- Loading delivery `Loading reminder status…`; rỗng `No delivered reminders for this occurrence`; read lỗi/target stale báo an toàn + Retry, vẫn cho xem base event. Không tự đổi thành occurrence khác. Có thể hiển thị action Dismiss cho active/missed/snoozed, Snooze chỉ active theo đúng wrappers/version; nếu không cần action lặp trong detail, giữ actions tại bell/Missed và detail chỉ đọc status (quyết định tối giản: detail chỉ đọc).
- Chỉ show visibility sau event read thành công và view detail đang thật sự hiển thị; khi editor/delete/discard mở, loading/error không có event, suspended, route đổi, unmount hoặc document hidden thì hide cùng token. View lại tạo token UUID v4 mới. Main hide-to-tray OS visibility vẫn do BE001 quyết định, không suy từ route. Edit/delete không tính detail đang hiển thị vì dialog nội dung đã thay.
- IPC show/hide phải xếp đúng thứ tự trong một owner: hide cleanup chờ show tương ứng settle để show muộn không để projection mồ côi; selection mới không bị old show overwrite (serialize lifecycle commands trước show token mới). Token backend ngăn old hide xóa view mới. Late failures không setState sau retirement; failure đang view có banner `Reminder visibility could not be updated.` và Retry; không gọi OS từ React.
- Invalidation reload delivery không overwrite dirty event draft. Sau Calendar update thành công, clear occurrence URL/context vì identity có thể đổi; visibility base event vẫn show nullable. Listener reminders setup + refresh/focus/cleanup có cùng epoch guard với event owner. Không dựa vào notification/OS event để chứng minh delivery state.

### Quyết định triển khai bổ sung — 2026-09-13

- Predicate BE019 trước tích hợp vẫn so cả event và occurrence; nullable DTO đơn thuần chưa đủ để thực thi policy đã chốt. Lát cắt FE023 sửa tối thiểu predicate scheduler thành cùng event ID và thêm regression same-event/different-occurrence. Không thêm command, capability hay migration.
- Visibility queue dùng chung trong module của hook vì selection mới có thể là component instance mới; queue chờ show/hide cũ settle trước show mới, token vẫn do từng view sở hữu. Show chưa tới lượt và đã bị retire không được gửi.
- Calendar invalidation thực tế hoặc update thành công xóa occurrence URL/context; focus và reminder-only refresh không sửa URL hoặc draft đang edit.

### Tiêu chí và kiểm thử bổ sung

- [x] Event detail từ month/day/Upcoming/bell/Missed có occurrence đúng; Search/create base detail show nullable, không query delivery giả.
- [x] Hook/component deferred tests chứng minh show muộn → hide cuối cùng, A→B không old hide/show làm sai projection, edit/delete/hidden/close/Data/Quit retire, failure Retry không loop.
- [x] Status đúng backend, empty không được ghi Sent; event/reminder changes refresh, stale context vẫn có base detail an toàn.
- [x] Rust integration target `reminder_actions` kiểm null accepted, invalid event/supplied occurrence rejected, old-token hide không clear mới. Target `reminder_notifications` kiểm event-only visibility suppress OS cho cùng event nhưng bell vẫn có, event khác vẫn eligible, hidden main vẫn eligible.
- [x] Exporter sinh nullable TS và drift test pass; full Rustfmt/Clippy/tests và Windows Tauri build theo plan FE023.

Kết quả tích hợp FE023: automated gates Windows đạt (2.715 frontend tests, 633 Rust tests; 1 benchmark có sẵn ignored, Clippy/Rustfmt/build đạt). Native smoke chưa thực hiện; bằng chứng và giới hạn nằm trong `../98-Plan/20260913-fe023-reminder-notification-settings.md`. Không tuyên bố toàn bộ native/Phase 4 acceptance đã hoàn tất.
