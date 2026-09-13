# FE-023 — Settings Notifications

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-023` |
| Phase | 4, Giai đoạn 21 |
| Khu vực chính | `src/features/settings/` |
| Yêu cầu chức năng | §17.5, §13.3, §15, §18, §20 Phase 4 |
| Wireframe | `00-Docs/01-Wireframe/02-AppShell.html#settings-notifications` |
| Backend liên quan | BE-008, BE-011, BE-019 |
| Phụ thuộc | FE-011; BE-019 đã tích hợp tại `09498e6` |

## Mục tiêu

Người dùng chỉnh riêng chính sách terminal/AI CLI và event/reminder, chọn ba trạng thái terminal được phép gửi thông báo OS. Settings lưu bền qua Rust và hiển thị đúng giá trị đã commit sau khi mở lại.

### Ngoài phạm vi

- Không thêm permission picker, nút test notification, âm thanh, lịch quiet hours, cloud hoặc reset defaults riêng.
- Scheduler, eligibility, toast và Missed thuộc backend; các UI reminder thuộc extensions FE-010/021/022.

### Quyết định theo ủy quyền — 2026-09-13

- User ủy quyền tự quyết bước hỏi thiết kế. Tái sử dụng Settings frame/store và bộ ghi tuần tự hiện có; không thêm dependency hoặc settings store cạnh tranh.
- Hai switch lưu ngay bằng patch sau một thao tác. Trong một lần ghi notification, khóa các control notification và báo `Saving notification settings…`; không optimistic thông báo đã lưu. Lỗi giữ snapshot đã commit, cho `Retry` sau reconcile; lỗi transport không rõ kết quả phải đọc lại trước một lần ghi mới.
- Nhóm OS gồm `Needs input`, `Process finished`, `Process exited with an error`. Khi terminal activity tắt, disable ba checkbox nhưng giữ lựa chọn đã lưu. Cả ba false hợp lệ. Patch `terminalOsStates` luôn chứa đủ ba boolean lấy từ snapshot mới nhất.
- `Missed reminders on launch` là thông tin `Always on`, không phải switch. Tắt event/reminder không xóa inbox hiện có hoặc Missed, không dừng catch-up; bật lại chỉ tác động generation/due tương lai, không phát bù hàng loạt.
- Không có settings event frontend trong contract hiện tại. Đồng bộ qua response `update_settings`, read lúc vào Notifications/focus và refresh sau Data import/reset; dùng revision/generation để response cũ không đè snapshot mới.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/settings/settings-notifications-route.tsx` | Route thật và control |
| `src/features/settings/settings-notifications-route.test.tsx` | Component/keyboard/read/write/error |
| `src/features/settings/settings-store.ts`, `src/features/settings/settings-store.test.ts` | Notification mutation trong write queue/barrier hiện có |
| `src/features/settings/settings-test-fixture.ts` | Snapshot typed dùng test |
| `src/features/settings/settings-error-copy.ts` | Dùng lại thông điệp Settings typed |
| `src/features/settings/settings-section.tsx` | Dùng lại layout |
| `src/features/settings/data-management-provider.test.tsx` | Ghi settings settle trước import/reset |
| `src/app/app-router.tsx`, `src/app/app-router.test.tsx` | Thay Notifications placeholder |
| `src/lib/ipc/settings.ts`, `src/lib/ipc/settings.test.ts` | Existing get/update wrappers và notification patch contract |
| `src/bindings/settings.ts` | DTO generated, chỉ đọc |
| `src/components/ui/switch.tsx`, `src/components/ui/button.tsx` | Component hiện hữu, chỉ dùng lại |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| SettingsNotificationsRoute | Title `Notifications`, mô tả bell/OS, hai switch và nhóm checkbox | `#settings-notifications` |
| Terminal and AI CLI activity | Switch; nhóm `Send to the operating system when` với ba checkbox | Cùng anchor |
| Events and reminders | Switch; giải thích OS chỉ khi event không hiện | Cùng anchor |
| Missed reminders on launch | Mô tả catch-up và `Always on` | Cùng anchor |

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Loading | Chưa có snapshot | `Loading notification settings…`, controls disabled, aria-busy |
| Ready | Snapshot hợp lệ | Giá trị backend, không fallback defaults |
| Rỗng | Settings không có snapshot do read fail | Không coi là mặc định; lỗi và Retry |
| Saving | Ghi đang chạy | Status và khóa control; không báo thành công trước response |
| Error | Read/write thất bại | `Could not load/save notification settings.` và Retry an toàn; không raw error |
| Terminal off | terminalActivityEnabled false | Checkbox OS disabled, giá trị giữ nguyên |
| Maintenance | Barrier Data đang giữ | Không admit write; refresh snapshot sau kết thúc |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Bật/tắt switch | Gọi update patch một lần, nhận toàn snapshot | Tab, Space |
| Đổi checkbox | Gửi đủ ba OS states, giữ field khác | Tab, Space |
| Retry | Đọc lại dữ liệu xác thực; retry ý định ghi chỉ sau đọc thành công và người dùng xác nhận thao tác | Tab, Enter |

Labels liên kết input, fieldset/legend cho OS states, giải thích disabled qua text; không chỉ dùng màu. Status polite và error alert; focus ở control còn tồn tại sau response. Không thêm shortcut global.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_settings` | Không args | `AppSettingsDto` | unavailable/persistence_failed: Retry; corrupt/unauthorized: lỗi an toàn, không sửa dữ liệu |
| `update_settings` | `{ input: { notifications: NotificationSettingsPatchDto } }` | `AppSettingsDto` | Typed SettingsError qua IpcCallError; unknown transport đọc lại trước retry |

DTO `NotificationSettingsDto`, `NotificationSettingsPatchDto`, `CliOsNotificationStatesDto` lấy từ generated bindings. Không gửi whole stale AppSettingsDto hoặc field Appearance trong notification patch.

### Event / Channel đăng ký

Không có backend Settings event cho FE. Focus và mount chỉ kích hoạt read; cleanup/epoch loại response cũ.

## State frontend

```ts
interface NotificationSettingsUiState {
  pending: boolean;
  error: SettingsError | null;
  uncertain: boolean;
  /** Persist one admitted policy update within the shared settings queue. */
  commitNotifications(patch: NotificationSettingsPatchDto): Promise<void>;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| snapshot.notifications/revision | Rust | Giữ trong SettingsState hiện có |
| pending/error/uncertain | UI | Notification riêng, không ghi đè Appearance draft/error |
| queue/barrier/generation | Settings store hiện có | Một write slot cho Appearance và Notifications; không coalesce khác loại làm mất intent; Data settle đợi cả hai |

## Contract công khai của feature

```ts
/** Render the Notifications settings child route. */
export function SettingsNotificationsRoute(): React.JSX.Element;
```

App router import route theo convention Settings hiện tại; feature khác không import store để quyết định notification eligibility.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Appearance response về sau notification edit | Queue tuần tự, không ghi snapshot revision cũ; draft Appearance còn giữ đúng |
| Focus read đang chờ khi ghi thành công | Read cũ bị retire/revision guard |
| Import/reset trong write | Barrier synchronous chặn thao tác mới, đợi write settle; unknown outcome ngăn destructive maintenance tới khi reconcile |
| Rời route khi ghi | Durable write vẫn settle trong store; không focus/set local state sau unmount |
| Event disabled rồi enabled | Chỉ đổi policy; frontend không tạo reminder hoặc xóa Missed |

## Tiêu chí hoàn thành

- [x] Route Notifications không còn placeholder, đúng wireframe và đầy đủ keyboard/loading/error.
- [x] Hai switch và ba checkbox round-trip qua backend DTO, giữ lựa chọn OS khi master off.
- [x] Không lost update với Appearance/focus/Data; unknown response không blind retry.
- [x] Frontend format/lint/typecheck/tests/build, Rustfmt/Clippy toàn target/features warnings denied, Rust tests và Windows Tauri build pass theo plan Giai đoạn 21.
- [x] Native Windows smoke ghi riêng trạng thái thực tế; không coi build/mock test là quan sát toast thật.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/settings/settings-notifications-route.test.tsx` | Component | Labels, keyboard, defaults từ DTO, loading/error, disabled-retain, tất cả OS states off |
| `src/features/settings/settings-store.test.ts` | Unit | Queue khác loại, revision/read race, transport reconcile, barrier |
| `src/lib/ipc/settings.test.ts` | Contract | Patch camelCase đúng, DTO/error passthrough |
| `src/features/settings/data-management-provider.test.tsx` | Component | Settle notifications trước import/reset và unknown outcome |
| `src/app/app-router.test.tsx` | Component | Route thật |

Mock public IPC với deferred promises, không dùng app-data thật, không mutation environment global. Không thêm desktop E2E.

## Câu hỏi mở

- Không có.

## Quyết định triển khai — 2026-09-13

- Settings queue giữ FIFO giữa Appearance và Notifications; chỉ coalesce Appearance operation liền kề để không làm mất intent khác loại.
- Focus read đợi toàn queue đang gửi settle. Kết quả không rõ của bất kỳ Settings write nào khóa ghi chung tới khi read reconcile thành công; Retry Notifications chỉ đọc lại, không tự gửi lại mutation.
- Missed, bell actions và detail visibility được triển khai cùng lát cắt này theo extensions FE010/FE021/FE022; trạng thái native smoke vẫn được ghi riêng, không dùng test mock thay cho quan sát Windows.

## Kết quả triển khai — 2026-09-13

Đã tích hợp Settings Notifications và extensions reminder của FE010/FE021/FE022. Format/lint/typecheck, 2.715 frontend tests, 633 Rust tests, Rustfmt/Clippy và Windows Tauri build đều đạt; 1 benchmark Rust có sẵn ignored. Executable tại `src-tauri/target/release/xwork.exe`, không có installer vì `bundle.active=false`. Native smoke chưa thực hiện do native controls bị tắt và chưa có profile tương tác cô lập an toàn; không tuyên bố toàn bộ Phase 4 acceptance đã hoàn tất. Chi tiết matrix và các bước test thực tế nằm trong plan `../98-Plan/20260913-fe023-reminder-notification-settings.md`.
