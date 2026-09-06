# FE-015 — Settings Data

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-015` |
| Phase | `1`, giai đoạn 13 — Backup và reset |
| Khu vực chính | `src/features/settings/` |
| Yêu cầu chức năng | §17.6, §18; lifecycle §5.1, §5.3–5.4, §8.1 |
| Wireframe | `00-Docs/01-Wireframe/02-AppShell.html#settings-data`, gồm trang Data và dialog Reset |
| Backend liên quan | `BE-012`; public owners `BE-003`, `BE-005`–`BE-009`, `BE-011`; Quit `BE-001` |
| Phụ thuộc | `FE-011`, `FE-012`, `FE-013`, `FE-014`; tích hợp shell `FE-001`, Search `FE-009`, Notifications `FE-010` và runtime `FE-006`–`FE-008` |

## Mục tiêu

Người dùng xuất/nhập backup cục bộ, xem/copy/mở vị trí dữ liệu và reset XWork với xác nhận rõ ràng. UI dùng chín command thật của BE-012, giữ shell và mọi projection phù hợp với kết quả đã commit, không truy cập file hoặc credential trực tiếp.

### Quyết định và nguồn đối chiếu

- Thiết kế theo overview FE, §17.6/§18 của FunctionalRequirements, ProjectStructure, TechStack, template Frontend và wireframe `#settings-data`. Roadmap stage 13 chỉ Phase 1; Home đầy đủ là stage 14, Notes stage 18–19 và Calendar stage 20–21.
- Đối chiếu BE-012, Rust command/service hiện hành và generated `src/bindings/data-management.ts` tại HEAD `452017f` (`Implement BE012`). Đây là DESIGN ONLY, không phải bằng chứng implementation FE hoặc native validation.
- Người dùng ủy quyền tự chốt ambiguity thay bước hỏi của work-dd. Giữ layout wireframe nhưng bỏ Notes/Events khỏi copy/count Phase 1; backup v1 trả `notes/events: null`, reset trả `0`. Không mô tả `null` là dữ liệu rỗng đã được hỗ trợ.
- Backup là JSON UTF-8 `.xwork-backup.json`, schema 1, tối đa 128 MiB. Native picker và mọi I/O thuộc Rust. UI không giữ path backup hoặc nội dung gói.
- Import merge metadata; không thay toàn bộ danh sách project/profile. Settings/Appearance/sidebar, default shell và toàn bộ shortcut overrides được thay theo section nhập. Dòng wireframe “merged, not replaced” phải được bổ sung giải thích này để không hứa giữ toàn bộ cấu hình cũ.
- Reset xóa metadata project, custom profiles, shortcut overrides, inbox notification và đưa settings/default shell về mặc định; dừng tất cả session/process. Built-in profiles, database/schema, logs và source project giữ nguyên. Không hứa xóa mọi file trên đĩa hoặc xóa credential tức thì.
- Backend không có progress channel, operation-status query, reset-preview-changed error hoặc event revision. UI dùng spinner không phần trăm, không invent endpoint, không suy luận transaction từ count. Reset impact là snapshot; xác nhận chấp nhận reset toàn bộ dữ liệu/runtime tại thời điểm thực thi, số thực tế có thể thay đổi.
- Backend hiện publish owner state và resume trước aggregate event, nhưng credential cleanup được thử trước event/result. FE không phụ thuộc một thứ tự event/result cụ thể, không coi chờ event là điều kiện duy nhất để hoàn thành. Đây là chi tiết code cụ thể hơn trình tự mô tả khái quát của BE-012.

### Ngoài phạm vi

- PLAN, triển khai, commit, review độc lập, sửa plan lịch sử hoặc mở rộng backend/binding/capability/migration/dependency.
- Cloud, ZIP, mã hóa, backup tự động, chọn record để restore, xem JSON, drag/drop file hoặc nhập đường dẫn tùy ý.
- Notes/Calendar/reminder, file editor/unsaved-document UI Phase 2 và Home stage 14. Không scaffold owner tương lai.
- Không thêm command Palette cho Data/reset/export: catalog BE-010 hiện không có executor tương ứng.

## File liên quan

Các đường dẫn dưới đây là phạm vi được phép chạm khi triển khai; file contract/UI primitive ghi “tham chiếu” chỉ đọc. Nếu cần thêm file, cập nhật thiết kế có lý do trước khi triển khai, không mở rộng im lặng.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/settings/settings-data-route.tsx` | Route Data, các hàng, kết quả và lỗi |
| `src/features/settings/data-operation-dialog.tsx` | Preview import/reset, xác nhận, busy và focus |
| `src/features/settings/data-management-state.ts` | Coordinator UI sống theo shell, single-flight, pending request và result |
| `src/features/settings/data-management-provider.tsx` | Public provider/hook của Settings cho route và composition |
| `src/features/settings/data-error-copy.ts` | Mapping lỗi an toàn và khả năng retry |
| `src/lib/ipc/data-management.ts` | Chín wrapper và typed listener aggregate |
| `src/bindings/data-management.ts` | Generated DTO/error, tham chiếu không sửa tay |
| `src/lib/ipc/ipc-error.ts` | Tham chiếu invokeCommand/IpcCallError hiện có |
| `src/features/settings/settings-section.tsx` | Tham chiếu layout SettingsSection/SettingRow |
| `src/features/settings/settings-nav.tsx` | Tham chiếu slug `data` đã có |
| `src/components/ui/button.tsx` | Tham chiếu nút đã có |
| `src/components/ui/input.tsx` | Tham chiếu input đã có |
| `src/components/ui/dialog.tsx` | Tham chiếu modal Radix đã có |
| `src/components/ui/tooltip.tsx` | Tham chiếu tooltip đã có |
| `src/app/app-router.tsx` | Thay đúng route `/settings/data` |
| `src/app/app-shell.tsx` | Ghép provider/bridge dưới KeyboardShortcutsProvider, host status/busy |
| `src/app/data-management-bridge.tsx` | Aggregate subscription, refresh owners, route và maintenance generation |
| `src/app/shell-store.ts` | Tham chiếu public chrome state để áp sidebar sau maintenance |
| `src/app/search-entry.tsx` | Suspend và invalidate navigation/query cũ |
| `src/app/notification-entry.tsx` | Suspend target activation, reset lifetime inbox sau reset |
| `src/app/use-lifecycle-events.ts` | Chặn tray session navigation cũ qua maintenance boundary |
| `src/features/settings/settings-store.ts` | Public refresh sau maintenance bảo toàn retain/bootstrap |
| `src/features/settings/cli-profiles-store.ts` | Public invalidation generation và refresh profile snapshot |
| `src/features/settings/keyboard-shortcuts-state.ts` | Public refresh retirement cho response cũ |
| `src/features/projects/projects-store.ts` | Refresh snapshot/clear stale projection sau reset, giữ subscription |
| `src/features/sessions/sessions-store.ts` | Invalidate snapshot cũ và reconcile runtime sau reset/lỗi cleanup |
| `src/features/terminal/index.ts` | Public reset/reconcile bridge export |
| `src/features/terminal/terminal-context.ts` | Public hook hẹp gọi cleanup/reconcile UI registry |
| `src/features/terminal/terminal-registry.ts` | Dispose entry sau reset commit; reconcile sau reset thất bại |
| `src/features/settings/settings-data-route.test.tsx` | Component route và copy Phase 1 |
| `src/features/settings/data-operation-dialog.test.tsx` | Preview/RESET/a11y/focus |
| `src/features/settings/data-management-state.test.ts` | State machine, request lifetime, double submit, uncertainty |
| `src/features/settings/data-management-provider.test.tsx` | StrictMode/lifetime và cleanup pending |
| `src/features/settings/data-error-copy.test.ts` | Mọi typed code, malformed payload và redaction |
| `src/lib/ipc/data-management.test.ts` | Chín command, args, DTO/date và event cleanup |
| `src/app/data-management-bridge.test.tsx` | Refresh/routing/event-result race, partial failures |
| `src/app/app-router.test.tsx` | Route thật, breadcrumb và regression placeholders |
| `src/app/app-shell.test.tsx` | Host/provider, busy, Quit và maintenance |
| `src/app/search-entry.test.tsx` | Stale activation/context sau reset/import |
| `src/app/notification-entry.test.tsx` | Target navigation cũ và inbox refresh |
| `src/app/use-lifecycle-events.test.ts` | Tray/Quit ordering trong maintenance |
| `src/features/settings/settings-store.test.ts` | Refresh không làm mất bootstrap hoặc phát lại draft cũ |
| `src/features/settings/cli-profiles-store.test.ts` | Response cũ không ghi đè imported profile |
| `src/features/settings/shortcut-recorder-dialog.test.tsx` | Bổ sung mock API maintenance cho public shortcut state hiện hữu |
| `src/features/settings/keyboard-shortcuts-state.test.ts` | Không dispatch shortcut cũ khi đang refresh |
| `src/features/projects/projects-store.test.ts` | Refresh/reset giữ listener, không hồi sinh row |
| `src/features/sessions/sessions-store.test.ts` | Reset/lỗi cleanup không hồi sinh session |
| `src/features/terminal/terminal-registry.test.ts` | Dispose/reconcile idempotent, không start/stop process từ reset UI |

Không cần sửa Rust, generator, CSS toàn cục, package hay quyền desktop. Backend nguồn đối chiếu là `src-tauri/src/settings/data.rs`, `src-tauri/src/app/data_runtime.rs`, `src-tauri/src/app/data_participants.rs`, `src-tauri/src/platform/data.rs` và tests BE-012; chúng không thuộc phạm vi sửa FE.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `SettingsDataRoute` | Tiêu đề `Data`, lead `Everything XWork stores lives on this machine. Project source is never copied.`; giữ khung Settings và semantic tokens hiện có | `#settings-data` |
| Backup rows | `Export a backup` / `Export backup…`; `Import a backup` / `Import backup…` | `#settings-data` |
| Location row | `Data location`, read-only selectable input đầy đủ `directory`; tên DB/logs từ DTO; tooltip/aria-label `Copy path`, `Open folder` | `#settings-data` |
| Danger zone | `Danger zone`, `Reset XWork…`; màu error và mô tả bằng chữ | `#settings-data` |
| `DataOperationDialog` import | `Import backup?`, source version/date, counts, merge summary, cảnh báo overwrite/secret và `Cancel` / `Import backup` | Bổ sung interaction cho nút import của cùng frame |
| `DataOperationDialog` reset | `Reset XWork?`, impact, input nhãn `Type RESET to confirm`, `Cancel` / `Reset XWork` | Overlay `#settings-data` |

Export help: `Project metadata, custom CLI profiles, theme, shortcuts and settings. Secrets are included as references only. This unencrypted backup may contain private paths and configuration.` Footer: `Backups never include project source, running sessions, terminal output, CLI history, logs or notifications.`

Import help: `Project and profile records are merged. Included settings, default shell and shortcut overrides replace their current configuration.` Preview nói rõ project trùng path có thể giữ identity local; không tự tính lại merge. Secret warning: `Secret values are not included. You may need to re-enter them on this machine.` Không liệt kê tên env/credential/account.

Reset help: `Removes project metadata, custom profiles and notifications, and restores settings and shortcuts to defaults. Running sessions are stopped. Project files and logs are kept.` Impact hiển thị projects, customCliProfiles, keyboardShortcutOverrides, settingsDifferFromDefault, sessions, runningProcesses. `unsavedDocuments > 0` phải cảnh báo mất thay đổi với số thật nếu backend trả; không dựng editor Phase 2. Notes/Events không xuất hiện ở Phase 1.

Giữ layout FE-011: sub-nav 220px, nội dung cuộn độc lập, SettingRow hiện có; text dài wrap, path input có thể chọn/cuộn ngang, không cắt mất accessible value. Dialog giới hạn chiều cao theo viewport và cuộn nội dung; actions luôn dùng được ở cỡ chữ UI lớn. Không hardcode path/count mẫu của wireframe.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Loading location | Route mount/retry | `Loading data location…`, aria-busy; chỉ khóa Copy/Open, backup/reset độc lập |
| Ready / dữ liệu rỗng | Location đọc được / backup hoặc reset có count 0 | Giữ cả bốn hàng; count 0 là hợp lệ, vẫn export/import/reset cấu hình được |
| Location error | Query/open/copy lỗi | Lỗi ngay hàng; giữ path đã đọc nếu có; `Try again`, copy thủ công khi clipboard lỗi |
| Native picker / preparing | Một command đang chờ | `Choosing backup…`, `Preparing import…` hoặc `Preparing reset…`; khóa action Data xung đột |
| Picker cancelled | Outcome `cancelled` | Trở về idle, không alert lỗi/success, không gọi cancel_data_operation vì chưa có requestId |
| Import preview | Outcome ready | Counts projects/custom profiles/secret references/overrides, version/date, merge inserts/updates/unchanged/removals/path matches |
| Preview changed | `import_preview_changed` | Thay toàn bộ preview bằng payload mới, `Data changed. Review the updated preview before importing.`; focus summary, yêu cầu click/Enter xác nhận mới |
| Reset preview | prepare thành công | Input trống, Reset disabled đến khi trim bằng `RESET` phân biệt hoa thường; initial focus Cancel |
| Applying | Confirm đã gửi | `Importing backup…` / `Resetting XWork…`; dialog aria-busy, không Escape/outside/Cancel và không submit thêm |
| Success | Command result hoặc aggregate xác nhận commit | Import giữ Data, thông báo `Backup imported.`; export `Backup exported: {fileName}`; reset chuyển `/` và status `XWork has been reset.` |
| Cleanup pending | Result credentialCleanupPending > 0 | Success kèm `Some saved credentials are still being removed. XWork will retry cleanup.`; không cung cấp nút reset lại |
| Refresh failed sau commit | Một owner query lỗi | `Changes were saved, but some views could not be refreshed.` + `Refresh views`; không biến thành import/reset failure |
| Unknown outcome | Confirm transport/rejection không nhận dạng, chưa thấy event | `Could not confirm the result. Refresh views before starting another operation.`; không tự confirm/reset lại |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Mở mục Data | `/settings/data`, breadcrumb `Settings / Data` | Tab/Enter qua sub-nav |
| Export / Import | Một native save/open picker do Rust quản lý | Enter/Space trên nút |
| Copy/Open location | Command không truyền path; trạng thái copy có aria-live | Enter/Space |
| Confirm import | Gửi requestId đang hiển thị; không auto-confirm preview mới | Enter trên nút, bỏ qua IME composition |
| Reset | Prepare trước, sau đó xác nhận literal bằng nút phá hủy | Không global shortcut; Enter trong input không tự submit |
| Cancel / Escape / outside preview | Gọi cancel matching request, đóng sau xử lý; trả focus opener khi còn hợp lệ | Escape trước apply |
| Chuyển route / hidden khi chưa apply | Đóng preview, cancel pending; late ready cũng phải cancel bằng ID nó trả | Không có |
| Hidden khi apply | Thao tác vẫn chạy, host giữ single-flight/result; không ép hiện cửa sổ | Không có |
| Retry | Chỉ retry query/location hoặc prepare theo hành động người dùng; không replay confirm | Enter/Space |

Modal có title/description liên kết, trap focus, nền inert, lỗi role=alert và status role=status; icon tooltip cả hover/focus, focus ring rõ, không chỉ dùng màu. Cancel mặc định là hành động an toàn; focus sau reset về heading Welcome/Home khi main visible, không về nút Data đã unmount. Nếu main hidden, giữ yêu cầu focus đến khi visible. Spinner tôn trọng reduced motion.

## Luồng chính

### Export và location

1. Route đọc location độc lập, không lấy settings snapshot làm điều kiện mở Data. Không tự mở file manager khi mount.
2. Export chỉ sau user action; hiển thị cảnh báo dữ liệu riêng tư ngay trên trang trước picker. Outcome exported hiển thị fileName/schema/count đã trả; không có link mở backup vì backend không có command đó.
3. Copy/Open luôn gọi backend-resolved directory; `directory` chỉ được render text, không log, không gửi lại IPC. Copy thất bại vẫn cho chọn input và copy thủ công.

### Import

1. Coordinator claim single-flight đồng bộ trước await prepare. Native cancel không thay state owner.
2. Ready giữ preview/requestId trong memory, không persist. Người dùng đọc các thay đổi và cảnh báo section replacement/secret rồi xác nhận.
3. Confirm chỉ một lần mỗi thao tác. `import_preview_changed` không ghi dữ liệu, trở lại preview mới, không tự gửi lại. `stale_request`/`no_pending_operation` hủy preview cũ và cho `Choose backup again`.
4. Commit trigger reconciliation từ result và/hoặc aggregate event. Không dừng session/terminal khi import; profile mới chỉ ảnh hưởng lần launch sau, không khởi chạy command trong backup.
5. Result summary dùng `applied`, không lấy preview làm số đã áp dụng. Refresh lỗi chỉ retry reads; import đã thành công vẫn giữ trạng thái thành công.

### Reset và shell lifecycle

1. Prepare đọc durable/runtime impact; input mặc định rỗng. Copy bổ sung `Counts may change. Reset stops all sessions and removes all current XWork data in the categories above.` Không giả định BE có reconfirm nếu count đổi.
2. Confirm với requestId và confirmation đã nhập. UI không tự stop session, true-Quit hoặc xóa file; BE-012 sở hữu cleanup → transaction → publish/resume.
3. Khi commit được xác nhận, retire generation UI cũ, đóng Search/Notifications/preview và navigate `/` với replace. Dọn renderer/session selection đã bị reset; Home hiện hữu tự query và hiển thị Welcome khi projects rỗng. Không tạo Home stage 14 hoặc dữ liệu mẫu.
4. Runtime cleanup/persistence lỗi có thể đã dừng session. Reconcile sessions và terminal với public query, giữ metadata chưa được commit xóa; không báo “nothing changed”, không xóa toàn bộ UI runtime theo suy đoán. Retry reset phải prepare lại.
5. Main vẫn mở hoặc hidden theo trạng thái hiện tại, app không restart/exit. Quit trong preview retire/cancel Data preview rồi nhường dialog; Quit khi apply được BE serialize, UI không mở hai modal. Giữ Quit request hợp lệ và chỉ trình bày khi Data settle; kiểm tra lại impact qua luồng Quit hiện có trước xác nhận, không dùng count trước reset. Tray session navigation bị bỏ qua khi Data busy; event cũ sau reset phải được getSession kiểm tra trước navigate.

### Reconciliation và ownership

- App composition trong data-management-bridge.tsx có thể tách hai component cùng file: host tạo callback reconcile và bọc DataManagementProvider, child bridge đọc public context để đăng ký event/điều phối suspension; tránh callback vòng hoặc feature import app. Một `DataManagementProvider` sống trong shell, không theo route Data; một `DataManagementBridge` dưới router và KeyboardShortcutsProvider đăng ký `data://changed` trước khi cho mutation. Đăng ký lỗi hiện thông báo có retry; command result vẫn là fallback. Late subscription sau unmount phải unlisten ngay; không polling.
- Settings sở hữu UI operation state; app bridge sở hữu composition/routing và truyền callback hẹp qua provider. Feature Settings không import app, Projects, Sessions, Search hoặc Terminal internals.
- App bridge refresh qua public owner API. Settings phải thêm `refreshAfterDataChange(): Promise<void>` để retire read/mutation generation, bỏ draft/queued patch cũ, đọc settings mới và bảo toàn startup retain/bootstrap; không gọi helper `resetSettingsStore()` dành cho test trong production. Các mutation đã gửi phải settle trước confirm; queued edits không được gửi lại sau import/reset. AppearanceThemeSync hiện hữu áp theme. Code shell hiện giữ width/collapse riêng, chưa có subscriber settings tự đồng bộ: app bridge áp snapshot.sidebar.widthPx qua setSidebarWidthPx và snapshot.sidebar.collapsed qua useShellStore.setState, đồng thời kết thúc resizing. Chỉ áp sau refresh thành công, không reset isMaximized/window errors hoặc persist ngược snapshot vừa nhập; không mở rộng thành sửa persistence sidebar tổng quát.
- CLI Profiles thêm public `refreshAfterDataChange(): Promise<void>` retire in-flight generation/queued editor state rồi đọc snapshot khi có consumer; inactive store đánh dấu cần load khi mount. KeyboardShortcutsState thêm cùng action, retire request cũ và suspend dispatch đến snapshot mới; không lấy shortcut cũ làm fallback. Không remount cả AppShell/TerminalProvider khi import.
- Projects/Sessions thêm public `refreshAfterDataChange(clearSnapshot: boolean): Promise<void>`: tăng token trước read, giữ consumer/subscription hiện hành. Reset commit dùng true để bỏ target cũ ngay; import dùng false, refresh để sidebar/Home/crumb nhận metadata. Error không phục hồi snapshot đã bị xóa. Response trước maintenance không được publish sau token mới; những public action này reject khi refresh lỗi để bridge tổng hợp status.
- Terminal public hook `useTerminalDataBoundary()` cung cấp `clearAfterReset(): void` (dispose mọi renderer entry/queued input/output, giữ registry monitoring) và `reconcileAfterResetFailure(): Promise<void>` (query entry hiện hữu, chỉ dispose khi backend xác nhận mất). App chỉ import từ public index. Không gửi start/kill process trong clearAfterReset; thao tác gọi lặp an toàn.
- Notifications dùng prop suspended hiện có trong Data modal/apply; app tăng React key riêng của NotificationCenter sau reset commit để bỏ cursor/rows/badge cũ và đọc trang đầu thật. Không cần sửa inbox internals; import không xóa inbox. Badge chưa đọc mới là unknown/loading đến query thành công, không giả 0 trước khi backend xác nhận.
- SearchEntry retire AbortController/context/generation khi Data operation bắt đầu hoặc aggregate invalidation; không restore focus cũ hoặc tiếp tục create-session navigation sau reset. Tăng refreshKey hoặc đóng Palette; mở lại resolve context thật. Không thay command catalog.
- Event chỉ có kind, không dedupe toàn đời theo kind hoặc thời gian. Event/result cùng operation được coalesce trong lifetime local; event không correlate được vẫn được reconcile idempotent. Event app_reset rồi result error phải giữ “reset đã commit”, không đảo về thất bại. Event sau result không gọi reset/import lần hai, không chuyển route lần nữa nếu đã ở `/`; không được nuốt reset kế tiếp.
- Trước confirm chặn thao tác UI xung đột bằng modal/maintenance flag; app shell trì hoãn startQuit, lifecycle bridge trì hoãn receiveTrayRequest đến Data settle để QuitDialog hiện hữu không mount chồng modal; không chặn native hide. Sau local event nhưng command chưa settle vẫn giữ lock. Aggregate refresh dùng allSettled, không để một owner lỗi bỏ qua owner khác; retry chỉ owner/read chưa đạt. Với transport unknown, refresh không chứng minh transaction đã rollback: giữ cảnh báo kết quả chưa rõ, chỉ cho thao tác mới sau người dùng đã xem/reconcile state; không cung cấp nút “Retry reset” với ID cũ.

## Contract với backend

### Command sử dụng

Input dưới đây là object tại invoke; các command không input gọi không args. Chỉ window `main`.

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_data_location` | Không có | `DataLocationDto` | data_location_unavailable, unauthorized_window, transport |
| `open_data_location` | Không có | void | data_location_unavailable, open_location_failed |
| `copy_data_location` | Không có | void | data_location_unavailable, clipboard_write_failed |
| `export_backup` | Không có | `BackupExportOutcomeDto` | operation_in_progress, snapshot_failed, serialize_failed, backup_too_large, file_write_failed |
| `prepare_import_backup` | Không có | `PrepareBackupImportOutcomeDto` | operation_in_progress, file_read_failed, invalid_backup, backup_too_large, unsupported_backup_version, domain_validation_failed, persistence_failed |
| `confirm_import_backup` | `{ requestId: number }` | `BackupImportResultDto` | import_preview_changed, stale_request, no_pending_operation, operation_in_progress, domain_validation_failed, persistence_failed |
| `prepare_reset_xwork` | Không có | `ResetImpactDto` | runtime_unavailable, operation_in_progress, persistence_failed |
| `confirm_reset_xwork` | `{ requestId: number, confirmation: string }` | `ResetResultDto` | invalid_reset_confirmation, stale_request, no_pending_operation, operation_in_progress, runtime_unavailable, runtime_cleanup_failed, persistence_failed |
| `cancel_data_operation` | `{ requestId: number }` | void | stale_request, no_pending_operation, operation_in_progress, persistence_failed |

Wrapper exports lần lượt `getDataLocation`, `openDataLocation`, `copyDataLocation`, `exportBackup`, `prepareImportBackup`, `confirmImportBackup(requestId)`, `prepareResetXwork`, `confirmResetXwork(requestId, confirmation)`, `cancelDataOperation(requestId)`, tất cả Promise theo output ở bảng. Dùng invokeCommand với DataManagementError; không định nghĩa lại DTO/union bằng tay.

`createdAtMs` được generated khai báo bigint trong khi serde i64 qua JSON có thể là number. Wrapper normalize riêng field này từ safe integer number hoặc bigint hợp lệ sang bigint, kể cả preview trong lỗi; không sửa binding, không JSON.stringify bigint. UI chuyển sang Date chỉ trong giới hạn ±8640000000000000 ms và format en-US local timezone, ngoài giới hạn hiện `Date unavailable`. Không đổi requestId u32 thành bigint. Shape bất thường của nested error preview phải thành lỗi unknown, không mở confirm từ dữ liệu malformed.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `data://changed` | `DataChangedEventDto` = kind `backup_imported` hoặc `app_reset` | Sau committed owner publication/resume; best effort | App bridge invalidate/refresh; reset route và clear runtime theo contract trên |

`onDataChanged(callback): Promise<UnlistenFn>` unwrap Tauri event tại IPC wrapper. Không progress channel. Export/cancel không phát aggregate; không tự dispatch event giả để mô phỏng backend.

### Mapping lỗi

| Code / nhóm | Copy và hành động |
|---|---|
| unauthorized_window | `Data management is only available in the main window.`; không retry mutation |
| operation_in_progress | `Another data operation is still running.`; giữ lock operation đang biết, không tạo vòng retry |
| stale_request / no_pending_operation | `This confirmation has expired. Prepare the operation again.`; xóa preview/RESET; cancel gặp các code này coi pending đã hết |
| invalid_reset_confirmation | `Type RESET to confirm.`; giữ dialog, không auto-correct hoặc tự gửi lại |
| data_location_unavailable | `Could not read the data location.` + Try again |
| open_location_failed / clipboard_write_failed | `Could not open the data folder.` / `Could not copy the path.`; cho retry, path vẫn selectable |
| file_read_failed / file_write_failed | `Could not read this backup. Choose another file.` / `The backup could not be saved. Try exporting again.` |
| backup_too_large | `Backups must be 128 MiB or smaller.`; không thử import một phần |
| invalid_backup | `This is not a valid XWork backup.`; chọn file khác |
| unsupported_backup_version | Hiện found/supported hợp lệ; version mới yêu cầu bản XWork hỗ trợ, version 0 yêu cầu backup hợp lệ, không hứa cập nhật giải quyết version 0 |
| domain_validation_failed | `The backup contains invalid {domainLabel} data.`; map sáu domain bằng label cố định, không raw contents |
| snapshot_failed / serialize_failed | `Could not create the backup.`; retry export theo user, không báo file đã lưu |
| import_preview_changed | Preview mới và explicit reconfirm như trên |
| runtime_unavailable | `Could not check running sessions. Try again.`; không mở reset confirm |
| runtime_cleanup_failed | `Some sessions may have stopped, but XWork data was not reset.`; reconcile runtime, prepare mới |
| persistence_failed | `Could not complete the data operation.`; nếu reset sau confirm bổ sung sessions có thể đã dừng; không kết luận rollback nếu đã nhận commit event |
| Unknown/transport/malformed | Query báo lỗi đọc có retry; confirm dùng unknown outcome; không hiển thị raw rejection, path, backup JSON hoặc credential |

Cancel transport lỗi đóng preview và giữ status `Could not confirm cancellation.`; không reuse ID. Backend TTL 10 phút là quyền quyết định, UI không giả deadline chính xác bằng createdAtMs của backup. Không auto apply khi hết thời gian.

## State frontend

```ts
/** Retain only transient operation state for the main shell lifetime. */
interface DataManagementState {
  phase: "idle" | "preparing" | "preview" | "applying" | "cancelling" | "uncertain";
  operation: "export" | "import" | "reset" | null;
  preview: BackupImportPreviewDto | ResetImpactDto | null;
  confirmation: string;
  result: BackupExportOutcomeDto | BackupImportResultDto | ResetResultDto | null;
  failure: IpcCallError<DataManagementError> | null;
  generation: number;
  /** Prepare exactly one operation after explicit user activation. */
  prepare(operation: "export" | "import" | "reset"): Promise<void>;
  /** Update transient destructive confirmation text. */
  setConfirmation(value: string): void;
  /** Confirm only the currently displayed request once. */
  confirm(): Promise<void>;
  /** Cancel a pending preview without cancelling committed backend work. */
  cancel(): Promise<void>;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Location | Backend qua command; cache theo route | Không filesystem API hoặc persistence frontend |
| Preview/requestId/result | Backend, giữ tạm ở Settings coordinator | Không persist hoặc gửi lại sau unmount/reload |
| Confirmation/phase/generation/focus | UI | Clear RESET khi dismiss/reprepare/commit; single-flight đồng bộ |
| Maintenance epoch/refresh failures/route | App bridge | UI-only monotonic generation, không phải revision backend |
| Business snapshots và runtime | Owners backend, qua public feature query | Không suy diễn state từ preview counts |

## Contract công khai của feature

```ts
/** Host one Data coordinator and delegate committed changes to app composition. */
export function DataManagementProvider(props: {
  children: React.ReactNode;
  /** Settle prior writes and return an idempotent barrier release callback. */
  beforeConfirm(): Promise<() => void>;
  /** Reconcile committed owner state without replaying the mutation. */
  onCommitted(kind: DataChangeKindDto): Promise<void>;
  /** Reconcile runtime after a reset attempt with no confirmed commit. */
  onResetUncertain(): Promise<void>;
}): React.JSX.Element;
/** Read the public transient Data coordinator inside the main shell. */
export function useDataManagement(): DataManagementState;
/** Render only the Data settings page inside the existing settings frame. */
export function SettingsDataRoute(): React.JSX.Element;
```

App được import public provider/hook và route entry; không import state internals. Bridge chuyển aggregate và command completion vào cùng reconciliation path. Settings public refresh APIs thuộc owner hiện hữu; không global event bus hoặc generic action registry mới.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Double-click/Enter, StrictMode replay | Một picker/confirm; không initiate operation trong effect mount |
| Route/visibility đổi trước prepare trả | Late ready cancel đúng requestId, không hiện dialog hoặc navigate muộn |
| Route unmount trong apply | Coordinator shell giữ promise/lock, commit vẫn refresh; không cancel backend mutation |
| Import preview thay đổi nhưng count giống | BE fingerprint là nguồn quyết định; luôn hiện preview mới khi typed error |
| File bị sửa sau preview | Confirm dùng package memory BE; FE không đọc lại file |
| Backup trống hoặc source path không tồn tại | Preview count 0 hợp lệ, project unavailable theo owner; không tự mở/chạy project |
| Session tạo trong lúc reset preview | Cảnh báo all-current-state áp dụng; BE quyết định runtime actual, FE không tự suy luận count |
| Reset transaction lỗi sau runtime stop | Metadata giữ theo query, session mất theo query; không gọi restore runtime |
| Event/result đến ngược thứ tự hoặc event mất | Reconcile lặp an toàn; success result đủ trigger; event không có result vẫn không giả cleanupPending = 0 |
| Response trước reset trả muộn | Generation chặn snapshot/route/focus cũ; không clear lock của operation mới |
| Refresh lỗi sau commit | Dữ liệu đã lưu, retry reads; terminal/sidebar không được hồi sinh từ cache cũ |
| Unknown confirm outcome rồi người dùng rời trang | Banner ở shell giữ uncertainty; không reset lần hai tự động |
| Webview reload mất pending ID | Không reconstruct/confirm ID; prepare mới theo backend hoặc chờ TTL; không invent status query |
| Reset trong main hidden | Hoàn thành vẫn reconcile route trong memory, không show/focus cửa sổ trái ý người dùng |
| Cancel khi đang apply | UI không cung cấp Cancel; nếu rejection operation_in_progress giữ lock, không nói đã hủy |

## Tiêu chí hoàn thành

- [ ] `/settings/data` thay đúng placeholder, breadcrumb/sub-nav giữ semantics FE-011; copy/preview/reset chỉ Phase 1.
- [ ] Chín wrapper dùng đúng tên/args camelCase và DTO generated, chuẩn hóa timestamp có test; không thêm path input, filesystem/clipboard plugin frontend hoặc quyền mới.
- [ ] Export cancellation/success/failure, import preview/merge/reconfirmation và reset literal `RESET` được test độc lập, không double-submit hoặc auto mutation retry.
- [ ] Commit import refresh settings/theme/sidebar, CLI profiles, shortcuts, projects/search mà không dừng runtime; commit reset xóa projection cũ, dispose renderer, refresh inbox, về Welcome/Home hiện hữu.
- [ ] Pending reads/mutations/navigation/focus từ đời trước không ghi đè state mới; lỗi cleanup/transaction reconcile runtime thật, giữ uncertainty khi không xác nhận được commit.
- [ ] Event/result race, event mất, đăng ký/unlisten muộn, route/hidden/Quit/tray và refresh partial failure có component/unit test; không dùng test-only reset helper cho production.
- [ ] Keyboard/focus/modal/tooltip/aria-live, long path, zero counts và cỡ chữ lớn có kiểm tra cụ thể.
- [ ] Khi triển khai trên Windows: frontend format/lint/typecheck/unit-component tests/build, Rustfmt, Clippy all-targets/all-features với warnings denied, Rust all-targets/all-features và generated-binding contract đạt; Tauri Windows build bắt buộc vì nối IPC desktop thật. Cargo một job, Rust tests tuần tự theo evidence stage 13; không thêm desktop E2E.
- [ ] Native smoke picker/cancel/export/import/location/reset/tray/Quit và đo snapshot/preview `<500 ms` chỉ thực hiện trong Windows Sandbox/VM/tài khoản thử riêng đã xác minh, dùng disposable app-data/project/credentials. Chưa có môi trường hoặc công cụ đo thì ghi pending, không ghi pass. Không suy luận metrics backend từ thời gian picker/người dùng.

Native smoke/metrics các stage trước và stage 13 vẫn pending; thiết kế này không chuyển trạng thái validation. Không chạy reset trên profile thật, không đổi APPDATA toàn process hoặc giả định có app-data override chưa tồn tại. macOS hoãn đến release.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/settings/settings-data-route.test.tsx` | Component | Wireframe rows/copy Phase 1, empty/location error/retry, no raw path leak ngoài location |
| `src/features/settings/data-operation-dialog.test.tsx` | Component | Impact thật, RESET case/trim, IME, Cancel/Escape/outside, busy/focus/reconfirmation |
| `src/features/settings/data-management-state.test.ts` | Unit | Nine-operation flow, single-flight, expiry, late ready cancel, event-result commit precedence, unknown outcome |
| `src/features/settings/data-management-provider.test.tsx` | Component | Shell lifetime, route detach, StrictMode, disposal và không auto operation |
| `src/features/settings/data-error-copy.test.ts` | Unit | Exhaustive typed codes, redaction, malformed nested preview |
| `src/lib/ipc/data-management.test.ts` | Contract unit | Command names/args, bigint normalization, rejected payload, listener unsubscribe |
| `src/app/data-management-bridge.test.tsx` | Component | Real public owner seams, allSettled refresh, import không dispose terminal, reset clear/navigate, lost/duplicate event |
| `src/app/app-router.test.tsx`, `src/app/app-shell.test.tsx` | Component | Route/breadcrumb, provider nesting, committed result banner sau reset, pending Quit |
| `src/app/search-entry.test.tsx`, `src/app/notification-entry.test.tsx`, `src/app/use-lifecycle-events.test.ts` | Component | Không stale target navigation/focus, inbox đời mới, tray validation |
| `src/features/settings/settings-store.test.ts`, `src/features/settings/cli-profiles-store.test.ts`, `src/features/settings/keyboard-shortcuts-state.test.ts` | Unit | Retire request/queued write, giữ retain/listener, load snapshot thật, fail-closed shortcuts |
| `src/features/projects/projects-store.test.ts`, `src/features/sessions/sessions-store.test.ts` | Unit | Token ordering, reset projection không hồi sinh, subscription còn hoạt động |
| `src/features/terminal/terminal-registry.test.ts` | Unit | Idempotent clear/reconcile, không phát kill/start, callback output cũ vô hiệu |

Frontend dùng mocked IPC, deferred promises/barriers và fixture không chứa secret/profile thật. BE contract regression chỉ dùng test harness cô lập sẵn có với temp database/folder, fake dialog/opener/clipboard/credential/command/shell/runtime; không đổi test sang system adapter, không dùng working directories của user. Native checklist và metrics được ghi evidence trong execution plan được giao sau, không sửa plan lịch sử và không chạy chúng ở DESIGN ONLY.

### Chốt bổ sung khi lập PLAN stage 13

- State public bổ sung `acceptCommitted(kind: DataChangeKindDto): Promise<void>` cho bridge đưa event vào cùng pipeline command result; `retirePreview(): Promise<void>` cho route/hidden/Quit (không hủy apply); `refreshViews(): Promise<void>` chỉ retry reads; `acknowledgeUncertain(): void` chỉ bỏ cảnh báo sau refresh đã settle, không xác nhận transaction. Snapshot public có `busy: boolean`, `invalidationEpoch: number`, `resetEpoch: number`, `refreshFailures: readonly string[]`, `listenerStatus: "registering" | "ready" | "error"`. Không gọi prepare trong effect.
- Provider nhận thêm `beforeConfirm(): Promise<() => void>` do app composition cung cấp. Settings store, CLI Profiles store và KeyboardShortcutsState bổ sung `settleBeforeDataChange(): Promise<void>`: claim barrier đồng bộ để không nhận write mới, bỏ queued edit chưa gửi và resolve các waiter bị bỏ, chờ lệnh đã gửi settle. Public `releaseDataChangeBarrier(): void` luôn được gọi trong finally sau confirm/reconciliation hoặc trước quay lại preview_changed; không biến lỗi commit owner đã biết thành lỗi hủy Data. Transport owner chưa rõ phải chặn confirm và hiện lỗi, refresh owner trước một lần confirm mới. Không chờ bằng polling state hoặc timeout cố định. App gọi các barrier cùng lượt; nếu có lỗi thì chờ mọi acquisition settle và release tất cả. Nếu thành công, beforeConfirm trả callback release idempotent; provider giữ callback đến finally của confirm/reconciliation, không release ngay khi beforeConfirm return.
- Những method trên chỉ bảo vệ producer frontend hiện hữu của ba owner; backend maintenance gate/fingerprint vẫn là nguồn serialize cuối cùng cho mutation khác. Không giữ barrier xuyên thời gian người dùng đọc preview; trước confirm mới claim. Reconfirmation sau preview_changed phải claim lại.
- Bridge host truyền children, callback và trạng thái listener vào provider; một child dưới provider đăng ký event và render status. Listener registration phải settle trước mutation: thất bại hiện cảnh báo và cho người dùng tiếp tục bằng command-result fallback, kèm retry đăng ký; không khóa vĩnh viễn Data vì mất event. `acceptCommitted` không suy đoán credentialCleanupPending khi chỉ nhận kind.
- Khi đang có local confirm, chỉ coalesce event cùng kind trong lifetime đó; event khác kind vẫn reconcile riêng. Sau result/event trùng, clear/reset lặp phải an toàn. Không dùng cửa sổ thời gian để bỏ event muộn vì có thể mất reset tiếp theo.
- Quit nhận trong apply được ghi là ý định chờ tại app, không gọi receiveTrayRequest ngay. Khi Data settle, nếu giữ request tray thì cancel_quit ID cũ qua wrapper hiện hữu (stale_quit_request coi đã hết), sau đó startQuit để lấy impact mới. Không tự confirmQuit. Unknown cancellation phải hiện lỗi theo lifecycle, không tự exit. Kiểm tra trường hợp request_quit trả null: backend tự thoát theo ý định Quit đã có, không dựng dialog giả.
- `invalidationEpoch`/`resetEpoch` là epoch frontend, không backend revision; Search/Notifications/lifecycle consumers kiểm tra snapshot hiện hành trước và sau await. Chỉ remount NotificationCenter theo resetEpoch; provider Data, Terminal và KeyboardShortcuts giữ identity.

### Quyết định khi triển khai stage 13

- Bổ sung ba method maintenance vào mock `shortcut-recorder-dialog.test.tsx`; không sửa recorder production. Đây là cập nhật contract mock bắt buộc khi mở rộng public state.
- Data provider giữ cùng coordinator qua StrictMode effect replay; cleanup retire preview nhưng apply đã gửi tiếp tục đến finally và giải phóng barrier. `getCurrent()` đọc epoch đồng bộ cho callback async trước khi React render.
- `refreshViews()` callback của host lưu riêng các query thất bại để Retry không phát lại mutation. Unknown outcome giữ cảnh báo đến khi refresh thành công và người dùng acknowledge.
- Search/Notification dùng hook optional trong các composition độc lập hiện hữu; shell production luôn có Data provider. Provider Terminal/Shortcut không remount; chỉ NotificationCenter thay key sau reset.
- Các bước red-shell trước code chưa được thực hiện; execution plan ghi trung thực test thực chạy và lỗi/fix, không coi lỗi compile là test đỏ hành vi.

- Sau reset aggregate không có runtime revision để phân biệt event session cũ. Store Sessions giữ listener nhưng dùng các event về sau làm invalidation để đọc snapshot thật, thay vì áp payload có thể hồi sinh session đã xóa. Không sửa contract backend hoặc thêm revision giả.
- Event commit bên ngoài retire cả preview đang hiển thị và prepare chưa trả; ID trả muộn được cancel chính xác. Trạng thái confirm chưa rõ chỉ được bỏ khi có commit event hoặc refresh thành công rồi acknowledge.

- Public snapshot thêm `canAcknowledgeUncertain` để nút acknowledge bị khóa đến khi read reconciliation thành công; không cho nút đang enabled nhưng không có tác dụng. Result banner hiển thị số liệu export/reset thật từ result, không lấy từ preview.

- Write barrier của CLI/Shortcut coi cả lỗi tagged không nhận diện là uncertainty. Marker này độc lập với lỗi đang hiển thị và chỉ bỏ khi query reconciliation thành công; bắt đầu query hoặc query thất bại không đủ mở khóa confirm.

## Câu hỏi mở

Không có.
