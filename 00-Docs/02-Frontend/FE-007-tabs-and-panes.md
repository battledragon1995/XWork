# FE-007 — Tab và Pane

Tài liệu này đặc tả thanh tab và bố cục pane của một phiên ở mức contract: tạo/đổi tên/kéo thả/đóng tab và mở lại tab vừa đóng, chia ngang–dọc tối đa bốn pane, resize, phóng to tạm thời, màn hình chọn nội dung cho pane mới, và cảnh báo khi đóng tab hoặc pane còn tiến trình chạy hay file chưa lưu.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-007` |
| Phase | `1` |
| Khu vực chính | `src/features/sessions/` |
| Yêu cầu chức năng | §9.1–9.2; liên quan §8.1, §10.2, §18 và §20 Phase 1 |
| Wireframe | `04-Projects.html#panes-1`, `#panes-2`, `#panes-3`, `#panes-4`, `#panes-max`, `#pane-picker`; tham chiếu `#dlg-delete-session` cho khuôn hộp thoại phá hủy |
| Backend liên quan | `BE-005`, `BE-006` |
| Phụ thuộc | `FE-006`, `FE-001`, `FE-013` |

## Mục tiêu

Người dùng làm việc trong một phiên bằng nhiều tab, mỗi tab có bố cục pane riêng: tạo tab, đổi tên, sắp xếp lại bằng kéo thả hoặc bằng menu, đóng tab và mở lại tab vừa đóng trong cùng lần chạy. Trong một tab, người dùng chia pane sang phải hoặc xuống dưới tối đa bốn pane, kéo đường phân cách để đổi tỉ lệ, phóng to tạm thời một pane rồi quay lại bố cục cũ, và chọn nội dung cho pane vừa tạo. Mọi thao tác đóng tab hoặc pane có tiến trình đang chạy hay file chưa lưu đều hiển thị cảnh báo nêu đúng số lượng và nhãn do backend đo được.

### Quyết định và giả định đã chốt

- `FE-007` chỉ thay nhánh nội dung "phiên đã có tab" của route `/sessions/:sessionId`. Nhánh phiên chưa có tab (`SessionToolPicker`), hai hộp thoại vòng đời phiên và toàn bộ phần sidebar/breadcrumb của `FE-006` giữ nguyên.
- Header phiên bị bỏ ở nhánh đã có tab, đúng như `FE-006` đã dự kiến và đúng wireframe `#panes-1` (không vẽ header). Tên phiên vẫn đọc được ở breadcrumb `Projects / {project} / {phiên}`; hai thao tác `Rename session…` và `Delete Session` chuyển vào menu `Tab options` của thanh tab. `session-route.tsx` vẫn sở hữu hai hộp thoại đó, `SessionWorkspace` chỉ phát ý định lên qua prop.
- Backend là nguồn dữ liệu duy nhất của thứ tự tab, cây split, tỉ lệ split, tab/pane active và pane đang maximize. Frontend không optimistic cho tab/pane active: mỗi command trả `SessionDetailDto` và snapshot đó là thứ được render. Ngoại lệ duy nhất là tỉ lệ split trong lúc kéo, vì `BE-005` yêu cầu frontend render tỉ lệ cục bộ và chỉ commit khi thao tác kết thúc.
- Đóng tab và đóng pane luôn đọc `get_close_impact` trước, đúng luồng `BE-005` §"Đóng/xóa có xác nhận" và đúng ràng buộc của `BE-009` là shortcut không được bỏ qua cảnh báo. Khi `requiresConfirmation` là `false`, frontend gọi ngay `close_runtime_target(target, false)` mà không mở hộp thoại; nếu backend phát hiện blocker mới ở thời điểm commit và trả `confirmationRequired`, hộp thoại mở với impact mới. `confirmed = true` chỉ được gửi sau khi người dùng bấm nút phá hủy.
- Phím tắt của lát cắt này là phím cục bộ của workspace, khớp đúng default Phase 1 trong catalog `BE-009`: `tabs.create` `Ctrl+T`, `tabs.close` `Ctrl+W`, `tabs.reopen_closed` `Ctrl+Shift+T`, `panes.split_right` `Ctrl+\`, `panes.split_down` `Ctrl+Alt+\`, `panes.maximize_toggle` `Ctrl+Shift+M`, `panes.close` `Ctrl+Shift+W`. Giai đoạn 10 (`BE-009` + `FE-014`) thay nguồn của bảng này bằng snapshot cấu hình được; đến lúc đó `FE-007` chỉ phải đổi nơi đọc, không đổi handler.
- Wireframe ghi tooltip `Split down (Ctrl Shift \)`, nhưng `BE-009` đã chốt default thật của `panes.split_down` là `Primary+Alt+Backslash` và nói rõ trạng thái trong wireframe là ví dụ override. `FE-007` theo `BE-009`: `Ctrl+Alt+\`.
- Modifier `primary` ở lát cắt này được ánh xạ cứng thành `event.ctrlKey` và nhãn `Ctrl`. Phát triển và kiểm chứng chỉ trên Windows theo `AGENTS.md`; phần ánh xạ `Command` của macOS thuộc snapshot có nhận biết nền tảng của `BE-009`/`FE-014`, nên `FE-007` không tự thêm phát hiện nền tảng để rồi bị thay.
- So khớp phím dùng `KeyboardEvent.code` (`KeyT`, `KeyW`, `KeyM`, `Backslash`), không dùng `event.key`, để override sau này của `BE-009` và bàn phím không phải US đều nhất quán.
- `navigation.previous_tab`/`next_tab` và bốn action `panes.focus_*` của `BE-009` không thuộc lát cắt này. Truy cập bàn phím tới pane được bảo đảm bằng thứ tự `Tab` tự nhiên: mỗi pane là một vùng nhận focus, và focus vào pane sẽ đặt pane đó thành active.
- Kéo thả tab dùng dnd-kit. Bảng `01-TechStack.md` ghi `dnd-kit 6.3.1`, tức version của `@dnd-kit/core`; lát cắt này thêm cả `@dnd-kit/sortable` và `@dnd-kit/utilities` cùng họ, vì `SortableContext` + `horizontalListSortingStrategy` + `KeyboardSensor` cho sẵn phương án bàn phím mà §18 bắt buộc. Việc đồng bộ lại bảng tech stack cho ba package là một thay đổi tài liệu riêng, không thuộc tài liệu thiết kế này.
- Resize pane dùng `react-resizable-panels`. Mỗi node `split` là một `PanelGroup` hai `Panel`. Tuyệt đối không đặt `autoSaveId` hoặc `storage`: bố cục thuộc backend runtime, và `FE-006` đã chốt lát cắt phiên không được thêm bất kỳ browser storage nào.
- Ánh xạ trục dễ nhầm nên phải ghi rõ: `SplitAxisDto.vertical` (trái–phải) tương ứng `PanelGroup direction="horizontal"`; `SplitAxisDto.horizontal` (trên–dưới) tương ứng `direction="vertical"`.
- Phóng to không unmount pane nào. Cả cây vẫn được render; pane đang maximize được đưa ra khỏi luồng (`absolute inset-0`) phủ toàn vùng tab, còn các pane khác cùng mọi đường phân cách chỉ bị `invisible` + `pointer-events-none` và rời khỏi thứ tự `Tab`. Cách này giữ nguyên kích thước đo được của các pane còn lại, nên `FE-008` không phải phá lại bố cục khi terminal thật xuất hiện.
- Cột `File` của màn hình chọn nội dung được render ở dạng tiêu đề cột kèm đúng một dòng chờ `Files arrive with FE-016.`, không bấm được. Bố cục hai cột của wireframe giữ nguyên và người dùng biết phần còn thiếu, đúng tiền lệ `SessionWorkspacePlaceholder` của `FE-006`. Khối `Recent` ở lát cắt này chỉ chứa công cụ.
- Đổi tên tab dùng hộp thoại `RenameTabDialog` theo đúng khuôn `RenameSessionDialog`, không sửa trực tiếp trên tab: tab chỉ cao `28px` và quy tắc tên của `rename_tab` trùng hoàn toàn `rename_session` theo invariant 17 của `BE-005`, nên `validateSessionName` và `SESSION_NAME_REQUIREMENT` được dùng lại nguyên trạng.
- Không có menu chuột phải trên từng tab ở lát cắt này. Menu `Tab options` tác động lên tab đang active, và bấm một tab là đã active nó, nên mọi thao tác vẫn tới được mà không phải thêm component `context-menu` mới vào `src/components/ui/`.
- Danh sách công cụ của màn hình chọn nội dung và dấu nhận diện trên đầu pane dùng chung một `useToolCatalog()` do `SessionWorkspace` mount, không mount lại theo từng pane.
- `use-session-detail.ts` được sửa để `applyDetail` bỏ qua snapshot có `revision` cũ hơn snapshot đã áp dụng. `FE-006` chỉ gọi một mutation tại một thời điểm nên chưa cần; `FE-007` cho phép resize commit và activate chạy song song với mutation cấu trúc, nên thứ tự trả về không còn được bảo đảm.
- Màu không bao giờ là kênh thông tin duy nhất: pane đang active có cả viền nhận diện và `aria-current`; tab đang chọn có cả nền và `aria-selected`.

### Ngoài phạm vi

- Render terminal, stream output, gửi input, resize PTY và vòng đời tiến trình (`FE-008`, `BE-007`). Pane có nội dung `toolSelection` chỉ hiển thị khối chờ; `terminal` và `file` chưa được tạo ra ở giai đoạn này và nếu xuất hiện cũng chỉ hiển thị khối chờ.
- Chấm trạng thái trên đầu pane và chấm chưa xem trên tab mà wireframe có vẽ. `BE-005` không có trạng thái theo pane hay theo tab trong DTO public; hai chỉ báo này thuộc `FE-008` và các capability file.
- Nút bật/tắt File Explorer trong thanh tab, cột file gần đây và `Browse files…` (`FE-016`, `BE-013`).
- Trang Settings Keyboard Shortcuts, phát hiện xung đột phím và phím tắt cấu hình được (`FE-014`, `BE-009`).
- Tạo phiên, chọn công cụ cho phiên rỗng, đổi tên và xóa phiên (`FE-006`); `FE-007` chỉ mở lại hai hộp thoại đó qua prop.
- Hàng phiên trên sidebar, trang tổng quan project, Home, tìm kiếm hợp nhất và notification (`FE-006`, `FE-005`, `FE-003`, `FE-009`, `FE-010`).
- Lưu tab, bố cục pane, tỉ lệ split hay tab vừa đóng qua lần thoát ứng dụng; toàn bộ là state runtime của `BE-005`.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `package.json` | Khai báo `react-resizable-panels@4.12.3`, `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable` và `@dnd-kit/utilities` ở exact version. |
| `pnpm-lock.yaml` | Khóa bốn dependency mới sau khi cập nhật manifest. |
| `src/features/sessions/session-workspace.tsx` | Nhánh nội dung của phiên đã có tab: mount catalog công cụ, hook mutation và hook phím tắt; dựng thanh tab, dòng thông báo, vùng pane của tab active và hai hộp thoại của feature. |
| `src/features/sessions/session-tab-strip.tsx` | Thanh tab: `DndContext` + `SortableContext` cho kéo thả, danh sách tab, nút `New tab`, cụm bên phải với menu `Tab options`, cuộn ngang và tự đưa tab active vào tầm nhìn. |
| `src/features/sessions/session-tab.tsx` | Một tab sortable: icon theo loại nội dung của pane active, tên cắt ellipsis, nút đóng, double-click để đổi tên, roving tabindex và điều hướng bằng mũi tên. |
| `src/features/sessions/tab-options-menu.tsx` | Menu hai nhóm: nhóm tab (`Rename tab…`, `Move tab left`, `Move tab right`, `Close tab`, `Reopen closed tab`) và nhóm phiên (`Rename session…`, `Delete Session`); vô hiệu hóa từng item theo state thật. |
| `src/features/sessions/rename-tab-dialog.tsx` | Hộp thoại đổi tên tab: input, quy tắc tên dùng chung, thông điệp lỗi backend, `Cancel` và `Rename`. |
| `src/features/sessions/close-target-dialog.tsx` | Hộp thoại xác nhận đóng tab hoặc pane: câu chữ theo loại target, hộp facts dựng từ `CloseImpactDto`, nhãn phá hủy `Close Tab`/`Close Pane`, xử lý `confirmationRequired` lần hai và retry sau `contentLifecycleFailed`. |
| `src/features/sessions/pane-layout.tsx` | Render đệ quy `PaneLayoutNodeDto`: leaf thành `SessionPane`, node split thành `PanelGroup` hai `Panel` với đúng ánh xạ trục, và trạng thái phóng to bằng CSS mà không unmount pane nào. |
| `src/features/sessions/pane-split-handle.tsx` | Đường phân cách giữa hai pane: vùng kéo `8px`, nhãn cho trình đọc màn hình, giữ tỉ lệ cục bộ trong lúc kéo và commit `set_split_ratio` khi thao tác kết thúc hoặc khi resize bằng bàn phím đứng yên. |
| `src/features/sessions/session-pane.tsx` | Khung một pane: đầu pane với dấu nhận diện, tiêu đề, đường dẫn gốc project và bốn hành động; vùng nội dung; nhận focus để trở thành pane active; badge khi đang phóng to. |
| `src/features/sessions/pane-content-picker.tsx` | Màn hình `What goes here?` của pane `Empty`: khối `Recent`, cột `Terminal / CLI`, cột `File` ở trạng thái chờ, trạng thái đang tải và lỗi catalog. |
| `src/features/sessions/pane-content-placeholder.tsx` | Khối chờ cho nội dung pane chưa có renderer thật: `toolSelection`, `terminal` và `file`. |
| `src/features/sessions/use-workspace-mutations.ts` | Toàn bộ command tab/pane của `BE-005`: khóa một mutation cấu trúc tại một thời điểm, đường không chặn cho activate và commit tỉ lệ, luồng impact–xác nhận–đóng, phân loại lỗi và cờ phiên đang đóng. |
| `src/features/sessions/use-workspace-shortcuts.ts` | Handler phím cục bộ của workspace: bỏ qua khi đang nhập liệu hoặc khi có hộp thoại mở, so khớp theo `KeyboardEvent.code`, `preventDefault` chỉ khi đã khớp một action còn khả dụng. |
| `src/features/sessions/workspace-shortcuts.ts` | Định nghĩa thuần bảy phím tắt cục bộ, so khớp một `KeyboardEvent` và dựng nhãn hiển thị cho tooltip cùng badge. |
| `src/features/sessions/session-layout.ts` | Hàm thuần về cây pane và thứ tự tab: liệt kê leaf, đếm pane, tìm pane, chỉ số pane, kẹp tỉ lệ, đổi giữa basis point và phần trăm, và suy ra `beforeTabId` từ chỉ số đích của lần kéo thả. |
| `src/features/sessions/session-route.tsx` | Nhánh đã có tab render `SessionWorkspace` trong khung cao toàn phần không padding và bỏ header phiên; nhánh chưa có tab giữ nguyên khung cuộn có padding; hai hộp thoại phiên nhận ý định từ workspace. |
| `src/features/sessions/use-session-detail.ts` | `applyDetail` so `revision` và bỏ qua snapshot cũ hơn snapshot đã áp dụng. |
| `src/features/sessions/session-workspace-placeholder.tsx` | Khối chờ của `FE-006` không còn người dùng sau lát cắt này và được xóa cùng phần assert tương ứng trong test của route. |
| `src/features/sessions/recent-tools-store.ts` | Dùng lại nguyên trạng: `recordToolUse` cũng được gọi sau mỗi `select_pane_tool` thành công, `readRecentTools` và `formatUsedAt` phục vụ khối `Recent` của pane picker. |
| `src/features/sessions/use-tool-catalog.ts` | Dùng lại nguyên trạng cho `get_cli_profiles`, `cli-profiles://changed` và `check_cli_profile`; `SessionWorkspace` là consumer thứ hai của hook này. |
| `src/features/sessions/session-tool-card.tsx` | Dùng lại `isProfileUnavailable` và `describeToolCommand` cho thẻ công cụ của pane picker; không sửa component thẻ của `FE-006`. |
| `src/features/sessions/sessions-test-fixture.ts` | Bổ sung factory bố cục nhiều pane, tab thứ hai, close target tab/pane, impact có blocker, cùng `CliProfileDto` và `CliProfilesSnapshotDto` dùng chung cho test của lát cắt này. |
| `src/lib/ipc/sessions.ts` | Bổ sung wrapper cho `create_tab`, `rename_tab`, `move_tab`, `set_active_tab`, `set_active_pane`, `split_pane`, `set_split_ratio`, `set_maximized_pane`, `select_pane_tool` và `reopen_last_closed_tab`. |
| `src/lib/ipc/cli-profiles.ts` | Dùng lại nguyên trạng `getCliProfiles`, `checkCliProfile` và `onCliProfilesChanged`. |
| `src/lib/utils/session-copy.ts` | Thêm `buildCloseImpactFacts` làm hàm dựng facts dùng chung cho cả ba loại target, cho `buildDeleteSessionFacts` gọi lại nó; thêm câu chữ hộp thoại đóng tab và pane; chỉnh lại kind, thông điệp và khả năng thử lại của `paneLimitReached`, `invalidMove` và `invalidSplitRatio`. |
| `src/features/sessions/session-workspace.test.tsx` | Test nhánh workspace: dựng đúng thanh tab và tab active, dòng thông báo lỗi, khóa hành động khi phiên đang đóng, phát ý định đổi tên và xóa phiên lên route. |
| `src/features/sessions/session-tab-strip.test.tsx` | Test thanh tab: `role="tablist"`, chọn tab, tạo tab, kéo thả đổi thứ tự, phương án bàn phím tương đương, cuộn tab active vào tầm nhìn. |
| `src/features/sessions/session-tab.test.tsx` | Test một tab: icon theo loại nội dung, `aria-selected`, roving tabindex, nút đóng có nhãn nêu tên tab, double-click mở hộp thoại đổi tên. |
| `src/features/sessions/tab-options-menu.test.tsx` | Test menu: hai nhóm item, `Reopen closed tab` bị khóa khi `canReopenLastClosedTab` là `false`, `Move tab left/right` bị khóa ở hai đầu danh sách, item phá hủy dùng kiểu destructive. |
| `src/features/sessions/rename-tab-dialog.test.tsx` | Test hộp thoại đổi tên tab: tiền điền và chọn sẵn, khóa nút khi tên không hợp lệ, thông điệp `invalidName`, trả focus khi đóng. |
| `src/features/sessions/close-target-dialog.test.tsx` | Test hộp thoại đóng: câu chữ và nhãn cho tab và cho pane, pane cuối cùng dùng câu riêng, facts số ít và số nhiều, `+{n} more`, `confirmationRequired` lần hai, retry sau `contentLifecycleFailed`, hủy không gọi command. |
| `src/features/sessions/pane-layout.test.tsx` | Test bố cục: một tới bốn pane dựng đúng cây, ánh xạ trục, tỉ lệ ban đầu theo `ratioBasisPoints`, trạng thái phóng to giữ mọi pane được mount và loại đường phân cách khỏi thứ tự `Tab`. |
| `src/features/sessions/pane-split-handle.test.tsx` | Test đường phân cách: nhãn theo trục, commit đúng một lần khi kết thúc kéo, commit sau khi resize bằng bàn phím đứng yên, hủy bằng `Esc` khôi phục tỉ lệ backend. |
| `src/features/sessions/session-pane.test.tsx` | Test pane: dấu nhận diện và tiêu đề theo từng loại nội dung, đường dẫn gốc project, khóa hai nút chia khi đã đủ bốn pane kèm tooltip giới hạn, đổi `Maximize pane` thành `Restore layout`, focus vào pane gọi `set_active_pane`. |
| `src/features/sessions/pane-content-picker.test.tsx` | Test picker của pane: khối `Recent` ẩn khi chưa dùng công cụ nào, thứ tự thẻ theo catalog, cột `File` ở trạng thái chờ và không bấm được, thẻ không khả dụng không gọi command, trạng thái đang tải và lỗi catalog. |
| `src/features/sessions/pane-content-placeholder.test.tsx` | Test khối chờ: câu chữ cho `toolSelection`, `terminal` và `file`. |
| `src/features/sessions/use-workspace-mutations.test.ts` | Test hook mutation: khóa một mutation cấu trúc, activate và commit tỉ lệ không bị khóa, luồng impact rồi đóng, bỏ hộp thoại khi không có blocker, `confirmationRequired`, `paneLimitReached`, `noClosedTab`, `invalidMove`, `closeInProgress` và `runtimeShuttingDown`. |
| `src/features/sessions/use-workspace-shortcuts.test.ts` | Test phím tắt: bảy tổ hợp gọi đúng hành động, bỏ qua khi focus trong ô nhập liệu, bỏ qua khi hộp thoại đang mở, bỏ qua `event.repeat` và IME, `preventDefault` chỉ khi đã khớp. |
| `src/features/sessions/workspace-shortcuts.test.ts` | Test bảng phím: so khớp theo `code` và modifier chính xác, không khớp khi thừa modifier, nhãn hiển thị đúng từng action. |
| `src/features/sessions/session-layout.test.ts` | Test hàm thuần: thứ tự leaf, đếm và tìm pane, chỉ số pane, kẹp tỉ lệ ở hai biên, đổi qua lại basis point và phần trăm, `beforeTabId` cho mọi vị trí đích kể cả cuối danh sách. |
| `src/features/sessions/session-route.test.tsx` | Bổ sung: nhánh đã có tab render `SessionWorkspace` và không còn header phiên, nhánh chưa có tab không đổi, hai hộp thoại phiên mở được từ menu của thanh tab. |
| `src/features/sessions/use-session-detail.test.ts` | Bổ sung: `applyDetail` bỏ qua snapshot có revision cũ hơn. |
| `src/lib/ipc/sessions.test.ts` | Bổ sung: tên và hình dạng tham số camelCase của mười wrapper mới, ánh xạ rejection thành `IpcCallError` có payload typed. |
| `src/lib/utils/session-copy.test.ts` | Bổ sung: `buildCloseImpactFacts` cho ba loại target, câu chữ hộp thoại đóng tab và pane, phân loại mới của `paneLimitReached`, `invalidMove` và `invalidSplitRatio`. |

Feature không sửa file Rust, migration, `src-tauri/capabilities/main.json`, `src-tauri/tauri.conf.json`, `src/app/` hay bất kỳ file nào trong `src/bindings/`. Binding `src/bindings/sessions/sessions.ts` và `src/bindings/terminal/cli-profiles.ts` đã có sẵn đủ DTO cho lát cắt này.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `SessionWorkspace` | Cột cao toàn phần, không padding, không cuộn: thanh tab `38px` ở trên, dòng thông báo khi có lỗi, vùng pane chiếm phần còn lại. Ghép cả hai hộp thoại của feature. | `#panes-1` |
| `SessionTabStrip` | Hàng `38px` có `border-bottom` hairline, padding ngang `8px`, khoảng cách giữa tab `2px`; `role="tablist"`, cuộn ngang khi thiếu chỗ. Bên phải là nút icon `Tab options`. | `#panes-1`, `#panes-4` |
| `SessionTab` | Tab cao `28px`, bo `radius-sm`, chữ `13px`; tab đang chọn có nền `surface-card`, chữ `ink`, weight `500`. Gồm icon loại nội dung, tên cắt ellipsis kèm `title`, nút `×`. | `#panes-1` |
| Nút `New tab` | Nút icon dấu cộng ngay sau tab cuối, tooltip `New tab (Ctrl T)`. | `#panes-1` |
| `TabOptionsMenu` | Menu từ nút icon ba chấm ở cụm bên phải thanh tab; nhóm tab ở trên, separator, nhóm phiên ở dưới với item phá hủy kiểu destructive. | `#panes-1` |
| `PaneLayout` | Vùng pane: padding `8px`, khoảng cách `8px` bằng chính đường phân cách, `position: relative` để pane phóng to phủ đúng vùng này. Node split render `PanelGroup`, leaf render `SessionPane`. | `#panes-1`–`#panes-4` |
| `PaneSplitHandle` | Dải `8px` màu `canvas` giữa hai pane; con trỏ đổi theo trục, có viền focus rõ ràng khi nhận focus bằng bàn phím. | `#panes-2`, `#panes-3` |
| `SessionPane` | Khung bo `radius-md`, nền `dark`, tràn ẩn. Pane active có viền nhận diện `1.5px` màu `body`. Pane `Empty` dùng nền `canvas` với viền hairline. | `#panes-1`, `#pane-picker` |
| Đầu pane trong `session-pane.tsx` | Hàng `32px` nền `dark-elevated`, chữ `12px`: dấu nhận diện `24px` bo `6px` dùng `icon`/`color` của profile, tiêu đề weight `500`, đường dẫn gốc project dạng mono `12px` cắt ellipsis, và bốn nút icon dồn phải. Pane `Empty` dùng biến thể sáng nền `surface-soft`. | `#panes-1`, `#panes-4`, `#pane-picker` |
| Badge phóng to trong `session-pane.tsx` | Badge tối nằm giữa, cách đáy pane `10px`, chỉ hiện trên pane đang maximize. | `#panes-max` |
| `PaneContentPicker` | Nội dung pane `Empty`, padding `28px 32px`: tiêu đề, dòng phụ, khối `Recent` một cột, rồi lưới hai cột `Terminal / CLI` và `File`. | `#pane-picker` |
| `PaneContentPlaceholder` | Khối giữa pane cho nội dung chưa có renderer thật: một dòng nêu nội dung, một dòng nêu lát cắt sẽ mang nó tới. | Không có |
| `RenameTabDialog` | Hộp thoại một input: nhãn `Tab name`, giá trị tiền điền được chọn sẵn, `Cancel` và `Rename`. | Không có |
| `CloseTargetDialog` | Hộp thoại phá hủy: tiêu đề theo target, đoạn giải thích, hộp facts, `Cancel` và nút destructive `Close Tab` hoặc `Close Pane`. | `#dlg-delete-session` (khuôn) |

Nội dung chữ cố định:

- Thanh tab: tooltip `New tab (Ctrl T)`, tooltip `Tab options`, nhãn nút đóng từng tab `Close tab “{tên tab}”`.
- Menu `Tab options`, nhóm tab: `Rename tab…`, `Move tab left`, `Move tab right`, `Close tab`, `Reopen closed tab`. Nhóm phiên: `Rename session…`, `Delete Session`.
- Đầu pane: nhãn và tooltip `Split right (Ctrl \)`, `Split down (Ctrl Alt \)`, `Maximize pane (Ctrl Shift M)`, `Restore layout (Ctrl Shift M)`, `Close pane (Ctrl Shift W)`. Khi tab đã đủ bốn pane, hai nút chia giữ nguyên `aria-label` nhưng tooltip đổi thành `A tab can hold up to 4 panes.`
- Tiêu đề pane `Empty`: `New pane`.
- Đường phân cách: `aria-label` là `Resize panes left and right` cho trục trái–phải và `Resize panes up and down` cho trục trên–dưới.
- Badge phóng to: `Maximized · {chỉ số} of {tổng} panes · Ctrl Shift M to restore`.
- Pane picker: `What goes here?`, `Pick a tool or a file for this pane.`, nhãn khối `Recent`, `Terminal / CLI`, `File`; dòng chờ của cột file `Files arrive with FE-016.`; nhãn thẻ gần đây `Used {nhãn thời gian}`.
- Khối chờ nội dung pane: `toolSelection` hiển thị `{tên profile} is ready to run.` và `Terminals arrive with FE-008.`; `terminal` hiển thị `Terminals arrive with FE-008.`; `file` hiển thị `File panes arrive with FE-017.`
- Hộp thoại đổi tên tab: tiêu đề `Rename tab`, nhãn input `Tab name`, nút `Rename`, lỗi tên dùng `SESSION_NAME_REQUIREMENT`.
- Hộp thoại đóng tab: tiêu đề `Close tab “{tên tab}”?`, đoạn `The processes in this tab are stopped. You can reopen it later in this run, but a stopped process does not start again.`, nút `Close Tab`.
- Hộp thoại đóng pane khi tab còn pane khác: tiêu đề `Close this pane?`, đoạn `The processes in this pane are stopped and the pane is removed. This cannot be undone.`, nút `Close Pane`.
- Hộp thoại đóng pane khi đó là pane duy nhất của tab: tiêu đề `Close this pane?`, đoạn `The processes in this pane are stopped and the pane goes back to choosing content. This cannot be undone.`, nút `Close Pane`.
- Dòng thông báo của workspace: dùng thông điệp của `classifySessionsFailure`, với ba giá trị được chỉnh lại tại `session-copy.ts` là `A tab can hold up to 4 panes.` cho `paneLimitReached`, `XWork couldn't move that tab.` cho `invalidMove` và `XWork couldn't resize that split.` cho `invalidSplitRatio`.

Ánh xạ icon và tiêu đề theo `PaneContentDto`:

| `PaneContentDto.kind` | Icon tab | Dấu nhận diện đầu pane | Tiêu đề pane |
|---|---|---|---|
| `empty` | Icon bố cục pane, màu `muted` | Icon bố cục pane trên nền `cream-strong` | `New pane` |
| `toolSelection` | Icon terminal | Dấu vuông dùng `icon` và `color` của profile theo `profileId` | `title` của content |
| `terminal` | Icon terminal | Dấu vuông dùng `icon` và `color` của profile theo `profileId` | `title` của content |
| `file` | Icon file | Icon file trên nền `cream-strong` | `title` của content |

Icon của tab lấy theo nội dung của pane `activePaneId` của tab đó. Khi catalog công cụ chưa đọc được hoặc `profileId` không còn trong catalog, dấu nhận diện dùng biến thể trung tính và tiêu đề vẫn là `title` của content, không suy đoán màu.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Sẵn sàng | `tabs.length > 0` và `activeTabId` trỏ tới một tab có thật. | Thanh tab đầy đủ và bố cục pane của tab active. |
| Đang tải | Không có trạng thái riêng: route của `FE-006` sở hữu lần đọc `get_session` đầu tiên, nên `SessionWorkspace` chỉ được render khi đã có snapshot. | Không có. |
| Lỗi | Một command tab/pane bị từ chối và lỗi còn ý nghĩa cho người dùng. | Một dòng `role="alert"` ngay dưới thanh tab với thông điệp đã phân loại, kèm nút chữ `Try again` khi `canRetry` là `true`. Dòng này biến mất khi mutation kế tiếp thành công hoặc khi người dùng bấm `Try again`. |
| Rỗng của một tab | Pane duy nhất của tab có content `empty`. | `PaneContentPicker` chiếm toàn pane: nêu ngắn phải chọn gì và đưa ra danh sách công cụ để chọn ngay. |
| Catalog công cụ đang tải | `get_cli_profiles` chưa trả kết quả. | Pane picker hiện sáu ô mờ trong cột `Terminal / CLI`; khối `Recent` chưa render. Đầu pane dùng dấu nhận diện trung tính. |
| Catalog công cụ lỗi | `get_cli_profiles` bị từ chối và chưa có snapshot nào. | Pane picker hiện `XWork couldn't load your CLI profiles.` kèm `Try again`; thanh tab và các pane khác không bị ảnh hưởng. |
| Công cụ không khả dụng trong pane picker | `isProfileUnavailable(profile)` là `true`, hoặc `select_pane_tool` vừa trả `profileUnavailable`. | Thẻ mờ, dấu nhận diện xám, dòng phụ nêu lý do, badge `Unavailable`, `Check again` và `Open CLI Profiles`; thẻ nhận được focus nhưng không chọn được. |
| Đang chọn nội dung cho pane | `select_pane_tool` đang chạy cho pane đó. | Toàn bộ thẻ trong pane đó khóa; thẻ được chọn hiện `Starting…` ở vị trí nhãn phải. |
| Đã đủ bốn pane | `countPanes(tab.layout) === 4`. | Hai nút chia của mọi đầu pane trong tab đó ở trạng thái disabled với tooltip giới hạn; phím tắt chia hiển thị dòng thông báo giới hạn thay vì gọi command. |
| Đang phóng to | `tab.maximizedPaneId !== null`. | Pane đó phủ toàn vùng pane và hiện badge; các pane khác cùng mọi đường phân cách bị `invisible`, `pointer-events-none` và rời thứ tự `Tab`; nút maximize của pane đó đổi thành `Restore layout` và ở trạng thái nhấn. |
| Không có tab để mở lại | `canReopenLastClosedTab === false`. | Item `Reopen closed tab` disabled; phím `Ctrl+Shift+T` không gọi command và không hiện thông báo. |
| Tab ở biên danh sách | Tab active là tab đầu hoặc tab cuối. | `Move tab left` hoặc `Move tab right` tương ứng disabled. |
| Đang kéo một tab | Sensor của dnd-kit đang hoạt động. | Tab được kéo giảm độ đục và các tab khác dịch chỗ; hiệu ứng dịch chỗ bị tắt khi hệ điều hành yêu cầu giảm chuyển động. |
| Đang kéo đường phân cách | Người dùng đang kéo hoặc đang resize bằng bàn phím. | Tỉ lệ đổi theo thao tác ngay lập tức bằng state cục bộ; chưa command nào được gọi. |
| Đang đóng target | `close_runtime_target` đang chạy. | Nút phá hủy của hộp thoại khóa và đổi nhãn thành `Closing…`; `Cancel` dùng lại được sau khi lệnh trả kết quả. |
| Phiên đang đóng | Một command trả `closeInProgress`. | Dòng thông báo hiện `This session is closing.`; nút `New tab`, menu, hành động pane và phím tắt đều khóa cho tới khi route rời đi hoặc snapshot mới tới. |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Bấm một tab không phải tab active | Gọi `set_active_tab(sessionId, tabId)` và render snapshot trả về; bấm lại tab đang active không gọi command nào. | `Enter` / `Space` |
| Di chuyển giữa các tab bằng bàn phím | `ArrowLeft`/`ArrowRight` đổi focus trong thanh tab theo roving tabindex mà không chọn; `Home`/`End` tới tab đầu và tab cuối; `Enter` hoặc `Space` mới chọn. | `ArrowLeft` / `ArrowRight` / `Home` / `End` |
| Bấm `New tab` | Gọi `create_tab(sessionId)`; tab mới thành active và pane `Empty` của nó hiện `PaneContentPicker`. | `Ctrl+T` |
| Double-click một tab, hoặc chọn `Rename tab…` | Mở `RenameTabDialog` với tên hiện tại được chọn sẵn; đóng hộp thoại trả focus về đúng control đã mở nó. | `Enter` / `Space` mở menu, `Esc` đóng |
| Xác nhận đổi tên tab | Gọi `rename_tab(sessionId, tabId, name)`; thành công đóng hộp thoại và tên đổi ngay trên thanh tab. | `Enter` trong input |
| Kéo một tab sang vị trí khác | Khi thả, tính `beforeTabId` từ chỉ số đích rồi gọi `move_tab(sessionId, tabId, beforeTabId)`; thứ tự hiển thị lấy từ snapshot trả về, không giữ thứ tự optimistic. Thả về đúng chỗ cũ không gọi command. | `Space` nhấc, `ArrowLeft`/`ArrowRight` di chuyển, `Space` thả, `Esc` hủy |
| Chọn `Move tab left` / `Move tab right` | Gọi `move_tab` cho tab active với chỉ số đích lệch một bậc; đây là phương án tương đương bằng menu cho thao tác kéo thả theo §18. | `Enter` / `Space` |
| Bấm `×` trên một tab, hoặc chọn `Close tab` | Đọc `get_close_impact({ kind: "tab", … })`; không có blocker thì đóng luôn, có blocker thì mở `CloseTargetDialog` với đúng facts. | `Ctrl+W` cho tab active |
| Chọn `Reopen closed tab` | Gọi `reopen_last_closed_tab(sessionId)`; tab quay lại đúng vị trí cũ đã kẹp và thành active. Item khóa khi `canReopenLastClosedTab` là `false`. | `Ctrl+Shift+T` |
| Bấm hoặc focus vào một pane | Gọi `set_active_pane(sessionId, tabId, paneId)` khi pane đó chưa active; bấm vào một nút trong đầu pane vẫn kích hoạt pane trước rồi mới chạy hành động của nút. | `Tab` / `Shift+Tab` |
| Bấm `Split right` hoặc `Split down` | Gọi `split_pane(sessionId, tabId, paneId, direction)` cho pane active; pane mới thành active với content `Empty` và hiện picker; nếu đang phóng to thì backend bỏ maximize. | `Ctrl+\` và `Ctrl+Alt+\` |
| Kéo một đường phân cách | Tỉ lệ đổi cục bộ trong lúc kéo; khi nhả gọi `set_split_ratio(sessionId, tabId, splitId, ratioBasisPoints)` đúng một lần với giá trị đã kẹp trong `1000`–`9000`. | Không có |
| Resize bằng bàn phím trên đường phân cách | Mũi tên theo trục đổi tỉ lệ theo bước `200` basis point, `Home`/`End` về `1000`/`9000`; `Enter` commit ngay, mất focus commit ngay, và commit tự chạy sau `400 ms` không có thao tác nào nữa. `Esc` khôi phục tỉ lệ backend gần nhất mà không commit. | `ArrowLeft`/`ArrowRight` hoặc `ArrowUp`/`ArrowDown`, `Home`, `End`, `Enter`, `Esc` |
| Bấm `Maximize pane` | Gọi `set_maximized_pane(sessionId, tabId, paneId)`; nút đổi thành `Restore layout` và badge xuất hiện. | `Ctrl+Shift+M` |
| Bấm `Restore layout`, hoặc bấm lại phím tắt | Gọi `set_maximized_pane(sessionId, tabId, null)`; bố cục cũ và mọi đường phân cách trở lại đúng tỉ lệ trước đó. | `Ctrl+Shift+M` |
| Bấm `Close pane` | Đọc `get_close_impact({ kind: "pane", … })`; không có blocker thì đóng luôn, có blocker thì mở hộp thoại. Pane duy nhất của tab không bị xóa mà trở lại `Empty` với picker. | `Ctrl+Shift+W` |
| Bấm một thẻ công cụ khả dụng trong pane picker | Gọi `select_pane_tool(sessionId, tabId, paneId, profileId)`; thành công ghi công cụ vào danh sách gần đây và pane hiện khối chờ nội dung. | `Enter` / `Space` |
| Bấm `Check again` trên thẻ không khả dụng | Gọi `check_cli_profile(profileId)` rồi đọc lại snapshot catalog. | `Enter` / `Space` |
| Bấm `Open CLI Profiles` | Điều hướng tới `/settings/terminal-profiles`; không gọi command nào. | `Enter` / `Space` |
| Chọn `Rename session…` hoặc `Delete Session` | Phát ý định lên `SessionRoute`; hai hộp thoại của `FE-006` xử lý phần còn lại không đổi. | `Enter` / `Space` |
| Bấm một phím tắt trong lúc con trỏ đang ở ô nhập liệu hoặc khi một hộp thoại đang mở | Không hành động nào chạy và `preventDefault` không được gọi, để phím thuộc về đúng nơi đang nhận nhập liệu. | Không có |

Thứ tự focus trong workspace: từng tab theo roving tabindex → nút `New tab` → nút `Tab options` → dòng thông báo khi có → theo thứ tự leaf của cây pane, trong mỗi pane là vùng pane rồi bốn nút của đầu pane, và các đường phân cách nằm đúng vị trí của chúng trong cây. Mọi thành phần nhận focus đều có viền focus rõ ràng.

## Luồng chính

### Tạo tab và chọn nội dung cho pane

1. Người dùng bấm `New tab` hoặc `Ctrl+T`. Hook mutation chiếm khe mutation cấu trúc để lần bấm thứ hai không tạo hai tab.
2. `create_tab(sessionId)` trả `SessionDetailDto`; route áp snapshot đó, tab mới là `activeTabId` và pane duy nhất của nó có content `empty`.
3. `PaneContentPicker` render trong pane đó, đọc catalog qua `useToolCatalog` của workspace và đưa `Recent` lên trước `Terminal / CLI`.
4. Người dùng chọn một công cụ khả dụng; picker khóa toàn bộ thẻ của pane đó và gọi `select_pane_tool(sessionId, tabId, paneId, profileId)`.
5. Thành công: frontend ghi `profileId` vào danh sách gần đây, áp snapshot trả về, pane đổi sang khối chờ nội dung với tiêu đề là tên profile. Backend không tạo process ở lát cắt này.

### Chia, resize và phóng to

1. Người dùng bấm `Split right`, `Split down` hoặc phím tắt tương ứng trên pane active. Khi `countPanes(tab.layout)` đã bằng `4`, hai nút disabled và phím tắt chỉ hiển thị dòng `A tab can hold up to 4 panes.`; không command nào được gọi.
2. `split_pane` trả snapshot có node split mới ở tỉ lệ `5000/5000`, pane mới là `activePaneId` và `maximizedPaneId` về `null`.
3. `PaneLayout` render node split thành `PanelGroup` với `direction` suy từ `axis` và `defaultSize` suy từ `ratioBasisPoints`.
4. Trong lúc kéo đường phân cách, `PaneSplitHandle` giữ tỉ lệ cục bộ và không gọi command. Khi kết thúc kéo, hoặc khi resize bằng bàn phím đứng yên, handle gọi `set_split_ratio` một lần với giá trị đã kẹp.
5. Phóng to gọi `set_maximized_pane` với `paneId`; `PaneLayout` giữ nguyên cây đã render và chỉ đổi cách trình bày, nên không pane nào bị unmount và không tiến trình nào bị ảnh hưởng. Bấm lại gửi `null` và bố cục cũ trở lại nguyên tỉ lệ.

### Sắp xếp lại tab

1. Người dùng nhấc một tab bằng chuột hoặc bằng `Space` rồi di chuyển tới vị trí mong muốn.
2. Khi thả, `resolveMoveBeforeTabId(tabIds, tabId, toIndex)` suy ra `beforeTabId`: tab đang đứng ở vị trí đích sau khi đã bỏ tab được kéo ra khỏi danh sách, hoặc `null` khi đích là cuối danh sách.
3. Nếu vị trí không thực sự đổi, không command nào được gọi.
4. `move_tab` trả snapshot mới và thanh tab render theo đúng thứ tự đó. `invalidMove` làm frontend đọc lại `get_session` và hiển thị `XWork couldn't move that tab.`
5. `move_tab` không đổi tab active, nên tab đang mở vẫn là tab đang mở sau khi sắp xếp.

### Đóng tab hoặc pane có cảnh báo

1. Người dùng bấm `×` của tab, `Close pane` của pane, hoặc phím tắt tương ứng. Frontend gọi `get_close_impact` với đúng target.
2. `requiresConfirmation === false`: frontend gọi ngay `close_runtime_target(target, false)` và không mở hộp thoại. Nếu backend phát hiện blocker mới ở thời điểm commit và trả `confirmationRequired`, hộp thoại mở với `error.impact`.
3. `requiresConfirmation === true`: `CloseTargetDialog` mở với hộp facts dựng từ impact vừa đọc; hủy thì không command mutation nào được gọi.
4. Người dùng bấm `Close Tab` hoặc `Close Pane`; frontend gọi `close_runtime_target(target, true)`.
5. Thành công: `CloseResultDto.session` là snapshot mới và được áp trực tiếp. Đóng tab active làm backend chọn tab bên phải ở index cũ, nếu không có thì tab bên trái. Đóng pane cuối của một tab giữ tab lại với một leaf `Empty`. Đóng tab cuối cùng làm `tabs` rỗng, và route tự chuyển về nhánh chọn công cụ của `FE-006`.
6. `contentLifecycleFailed`: hộp thoại giữ nguyên với thông điệp đã phân loại và cho bấm lại; lần gọi lại an toàn vì backend bảo đảm thao tác idempotent (chạy lại nhiều lần vẫn ra cùng kết quả).

### Mở lại tab vừa đóng

1. `canReopenLastClosedTab` của snapshot quyết định item `Reopen closed tab` bật hay tắt; không có state frontend nào suy đoán thay.
2. Người dùng chọn item đó hoặc bấm `Ctrl+Shift+T`; frontend gọi `reopen_last_closed_tab(sessionId)`.
3. Thành công: snapshot trả về có tab ở vị trí cũ đã kẹp và tab đó là active; `canReopenLastClosedTab` trở thành `false`.
4. `noClosedTab` chỉ có thể xảy ra khi snapshot đã cũ: frontend đọc lại `get_session` và không hiển thị lỗi vì item đơn giản trở lại trạng thái tắt.

### Đồng bộ snapshot khi có mutation song song

1. Mutation cấu trúc dùng một khe duy nhất, nên tại một thời điểm chỉ có một trong số `create_tab`, `rename_tab`, `move_tab`, `split_pane`, `set_maximized_pane`, `select_pane_tool`, `reopen_last_closed_tab` và luồng đóng đang chạy.
2. `set_active_tab`, `set_active_pane` và `set_split_ratio` không chiếm khe đó, vì khóa cả workspace trong lúc người dùng bấm hoặc kéo sẽ làm mất thao tác. `set_active_tab` và `set_active_pane` bị bỏ qua khi target đã đúng; `set_split_ratio` được tuần tự hóa theo từng `splitId`.
3. Vì hai nhóm trên chạy song song được, `applyDetail` của route so `revision` bằng `compareSessionRevisions` và bỏ qua mọi snapshot cũ hơn snapshot đã áp dụng.
4. `sessions://runtime-changed` vẫn do `use-session-detail.ts` xử lý không đổi: event chỉ mang `SessionSummaryDto`, nên nó cập nhật phần summary; khi `revision` nhảy bậc, route đọc lại `get_session` và cây pane theo đó.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `create_tab` | `{ sessionId: string }` | `SessionDetailDto` | `sessionNotFound` → đọc lại `get_session` để route rời đi; `closeInProgress` → khóa workspace và hiện `This session is closing.`; `unauthorizedWindow` → dòng lỗi tích hợp, không tự thử lại. |
| `rename_tab` | `{ sessionId: string, tabId: string, name: string }` | `SessionDetailDto` | `invalidName` → giữ hộp thoại mở và hiện quy tắc tên; `tabNotFound` → đóng hộp thoại và đọc lại snapshot; `sessionNotFound` → đóng hộp thoại, route rời đi; `closeInProgress` → khóa nút. |
| `move_tab` | `{ sessionId: string, tabId: string, beforeTabId: string \| null }` | `SessionDetailDto` | `invalidMove` → đọc lại snapshot và hiện `XWork couldn't move that tab.`; `tabNotFound` → đọc lại snapshot im lặng; `closeInProgress` → khóa thao tác. |
| `set_active_tab` | `{ sessionId: string, tabId: string }` | `SessionDetailDto` | `tabNotFound` → đọc lại snapshot vì thanh tab đang cũ; `sessionNotFound` → route rời đi; `closeInProgress` → khóa thao tác. |
| `set_active_pane` | `{ sessionId: string, tabId: string, paneId: string }` | `SessionDetailDto` | `tabNotFound` và `paneNotFound` → đọc lại snapshot, không thử lại mù; các lỗi còn lại xử lý như `set_active_tab`. |
| `split_pane` | `{ sessionId: string, tabId: string, paneId: string, direction: SplitDirectionDto }` | `SessionDetailDto` | `paneLimitReached` → hiện `A tab can hold up to 4 panes.` và đọc lại snapshot để hai nút chia về trạng thái disabled; `paneNotFound` → đọc lại snapshot; `closeInProgress` → khóa thao tác. |
| `set_split_ratio` | `{ sessionId: string, tabId: string, splitId: string, ratioBasisPoints: number }` | `SessionDetailDto` | `invalidSplitRatio` → khôi phục tỉ lệ backend gần nhất và hiện `XWork couldn't resize that split.`; `splitNotFound` → đọc lại snapshot; `closeInProgress` → bỏ commit im lặng. |
| `set_maximized_pane` | `{ sessionId: string, tabId: string, paneId: string \| null }` | `SessionDetailDto` | `paneNotFound` → đọc lại snapshot; `tabNotFound` → đọc lại snapshot; `closeInProgress` → khóa thao tác. |
| `select_pane_tool` | `{ sessionId: string, tabId: string, paneId: string, profileId: string }` | `SessionDetailDto` | `profileNotFound` → làm mới catalog và hiện `That tool no longer exists.`; `profileUnavailable` → chuyển thẻ sang trạng thái không khả dụng kèm `Check again` rồi gọi `check_cli_profile`; `profileLookupFailed` → `XWork couldn't check that tool.` kèm `Try again`; `paneNotEmpty` → đọc lại snapshot và không ghi đè content; `paneNotFound` → đọc lại snapshot. |
| `reopen_last_closed_tab` | `{ sessionId: string }` | `SessionDetailDto` | `noClosedTab` → đọc lại snapshot để item về trạng thái tắt, không hiện lỗi; `contentLifecycleFailed` → hiện `XWork couldn't stop everything in this session.` kèm `Try again`; `closeInProgress` → khóa thao tác. |
| `get_close_impact` | `{ target: CloseTargetDto }` | `CloseImpactDto` | `tabNotFound` và `paneNotFound` → bỏ luồng đóng và đọc lại snapshot; `contentLifecycleFailed` → mở hộp thoại với thông điệp đã phân loại kèm `Try again`; `unauthorizedWindow` → lỗi tích hợp. |
| `close_runtime_target` | `{ target: CloseTargetDto, confirmed: boolean }` | `CloseResultDto` | `confirmationRequired` → mở hoặc render lại hộp thoại từ `error.impact` và yêu cầu xác nhận; `tabNotFound` và `paneNotFound` → coi như đã đóng, đóng hộp thoại và đọc lại snapshot; `closeInProgress` → khóa nút và chờ snapshot mới; `contentLifecycleFailed` → giữ hộp thoại kèm `Try again`; `runtimeShuttingDown` → đóng hộp thoại im lặng. |
| `get_cli_profiles` | Không có | `CliProfilesSnapshotDto` | Mọi lỗi → pane picker vào trạng thái catalog lỗi kèm `Try again`; đầu pane dùng dấu nhận diện trung tính. |
| `check_cli_profile` | `{ profileId: string }` | `CliProfileDto` | `profileNotFound` → bỏ thẻ và làm mới catalog; `commandNotFound` và `shellNotFound` → giữ thẻ ở trạng thái không khả dụng với đúng lý do; lỗi khác → giữ thẻ và hiện `XWork couldn't check that tool.` |

Mọi command trên chỉ được gọi từ cửa sổ `main`, đúng ràng buộc `UnauthorizedWindow` của `BE-005`.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `sessions://runtime-changed` | `SessionRuntimeEventDto` | Sau mỗi mutation runtime đã commit và mỗi khi trạng thái tổng hợp của một phiên thực sự đổi. | `FE-007` không đăng ký thêm listener nào. `use-session-detail.ts` của `FE-006` đã sở hữu đăng ký này: nó cập nhật summary theo `sessionId`, đọc lại `get_session` khi `revision` nhảy bậc, và cây tab/pane đi theo snapshot đó. |
| `cli-profiles://changed` | `CliProfilesChangedDto` | Khi catalog profile hoặc shell mặc định đổi, kể cả sau khi check nền hoàn tất. | `useToolCatalog` đọc lại `get_cli_profiles`; pane picker và dấu nhận diện đầu pane cập nhật theo snapshot mới. Payload chỉ là tín hiệu vô hiệu hóa, không dùng để vá state. |

Kiểu DTO lấy từ `src/bindings/sessions/sessions.ts` và `src/bindings/terminal/cli-profiles.ts`; không định nghĩa lại thủ công.

## State frontend

```ts
// src/features/sessions/session-layout.ts
export const PANE_LIMIT = 4;
export const MIN_RATIO_BASIS_POINTS = 1000;
export const MAX_RATIO_BASIS_POINTS = 9000;

export function flattenPanes(layout: PaneLayoutNodeDto): readonly PaneDto[];
export function countPanes(layout: PaneLayoutNodeDto): number;
export function findPane(layout: PaneLayoutNodeDto, paneId: string): PaneDto | null;
/** 1-based position of one pane in leaf order, or `0` when it is not in the tree. */
export function paneIndex(layout: PaneLayoutNodeDto, paneId: string): number;
export function clampRatioBasisPoints(value: number): number;
export function ratioToPercent(basisPoints: number): number;
export function percentToRatioBasisPoints(percent: number): number;
export function resolveMoveBeforeTabId(
  tabIds: readonly string[],
  tabId: string,
  toIndex: number,
): string | null;

// src/features/sessions/workspace-shortcuts.ts
export type WorkspaceShortcutId =
  | "tabs.create"
  | "tabs.close"
  | "tabs.reopenClosed"
  | "panes.splitRight"
  | "panes.splitDown"
  | "panes.maximizeToggle"
  | "panes.close";

export interface WorkspaceShortcut {
  id: WorkspaceShortcutId;
  /** Canonical `KeyboardEvent.code`, never a layout-dependent `key`. */
  code: string;
  alt: boolean;
  shift: boolean;
  /** Display label of this slice, e.g. `Ctrl Alt \`. */
  label: string;
}

export const WORKSPACE_SHORTCUTS: readonly WorkspaceShortcut[];
export function matchWorkspaceShortcut(event: KeyboardEvent): WorkspaceShortcutId | null;
export function shortcutLabel(id: WorkspaceShortcutId): string;

// src/features/sessions/use-workspace-mutations.ts
export type WorkspaceOperation =
  | "createTab"
  | "renameTab"
  | "moveTab"
  | "splitPane"
  | "maximizePane"
  | "selectPaneTool"
  | "reopenTab"
  | "inspectClose"
  | "close";

/** One close target whose impact has been read and is waiting for the user. */
export interface PendingClose {
  target: CloseTargetDto;
  impact: CloseImpactDto;
  /** True when the target is the only pane of its tab, which changes the wording. */
  isLastPaneOfTab: boolean;
}

export interface WorkspaceMutations {
  pending: WorkspaceOperation | null;
  failure: SessionsFailure | null;
  isSessionClosing: boolean;
  pendingClose: PendingClose | null;
  createTab(): Promise<void>;
  /** Resolves `true` when the rename dialog should close. */
  renameTab(tabId: string, name: string): Promise<boolean>;
  moveTab(tabId: string, toIndex: number): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  activatePane(tabId: string, paneId: string): Promise<void>;
  splitPane(tabId: string, paneId: string, direction: SplitDirectionDto): Promise<void>;
  commitSplitRatio(tabId: string, splitId: string, ratioBasisPoints: number): Promise<void>;
  toggleMaximizedPane(tabId: string, paneId: string): Promise<void>;
  selectPaneTool(tabId: string, paneId: string, profileId: string): Promise<void>;
  reopenLastClosedTab(): Promise<void>;
  /** Reads the impact and either closes at once or publishes `pendingClose`. */
  requestClose(target: CloseTargetDto): Promise<void>;
  confirmClose(): Promise<void>;
  cancelClose(): void;
  clearFailure(): void;
}

// src/features/sessions/use-workspace-shortcuts.ts
export interface WorkspaceShortcutHandlers {
  isEnabled: boolean;
  onCreateTab(): void;
  onCloseTab(): void;
  onReopenTab(): void;
  onSplit(direction: SplitDirectionDto): void;
  onToggleMaximize(): void;
  onClosePane(): void;
}

export function useWorkspaceShortcuts(handlers: WorkspaceShortcutHandlers): void;

// src/lib/utils/session-copy.ts
/** Fact rows of any close target, shared by the session, tab and pane confirmations. */
export function buildCloseImpactFacts(impact: CloseImpactDto): readonly string[];
export const CLOSE_TAB_DESCRIPTION: string;
export const CLOSE_PANE_DESCRIPTION: string;
export const CLOSE_LAST_PANE_DESCRIPTION: string;
export const PANE_LIMIT_MESSAGE: string;
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `tabs`, `activeTabId`, `layout`, `activePaneId`, `maximizedPaneId`, `canReopenLastClosedTab` | Backend qua `get_session` và snapshot trả về của mọi mutation | Không có bản sao nào trong store frontend; `SessionWorkspace` chỉ đọc `SessionDetailDto` mà route đưa xuống. |
| `ratioBasisPoints` khi đang kéo | UI tạm thời | Chỉ sống trong `PaneSplitHandle` từ lúc bắt đầu tới lúc kết thúc thao tác; commit xong thì snapshot backend lại là nguồn duy nhất. |
| `pending`, `failure`, `pendingClose` | UI tạm thời | Reset khi hộp thoại đóng hoặc khi mutation kế tiếp thành công; `impact` luôn lấy lại từ backend, không suy ra từ summary. |
| `isSessionClosing` | UI tạm thời | Bật khi một command trả `closeInProgress`; tắt khi snapshot mới tới hoặc khi route rời phiên. |
| Trạng thái đang kéo tab | UI tạm thời | Thuộc dnd-kit; thứ tự hiển thị không bao giờ được vá optimistic, chỉ đổi theo snapshot của `move_tab`. |
| `snapshot` catalog công cụ | Backend qua `get_cli_profiles` | Một instance `useToolCatalog` cho cả workspace; đọc lại toàn bộ khi có `cli-profiles://changed`. |
| `recentTools` | UI tạm thời | Dùng lại store trong bộ nhớ của `FE-006`; `select_pane_tool` thành công cũng ghi vào đây; mất khi thoát ứng dụng. |

## Contract công khai của feature

`FE-007` không thêm export nào cho `src/app/` hoặc cho feature khác. Toàn bộ thành phần của lát cắt này là nội bộ của feature `sessions`, và ranh giới duy nhất cần cố định là giữa `session-route.tsx` và `session-workspace.tsx`:

```ts
// src/features/sessions/session-workspace.tsx
export function SessionWorkspace(props: {
  detail: SessionDetailDto;
  /** Project root every pane header shows; `null` while it is not readable. */
  rootPath: string | null;
  onApplyDetail(detail: SessionDetailDto): void;
  onRefresh(): void;
  onRenameSession(): void;
  onDeleteSession(): void;
}): JSX.Element;
```

Route tiếp tục sở hữu `RenameSessionDialog` và `DeleteSessionDialog` của `FE-006`; workspace chỉ phát ý định qua `onRenameSession` và `onDeleteSession`.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Snapshot có `tabs.length > 0` nhưng `activeTabId` là `null` hoặc trỏ tới tab không tồn tại | Render tab đầu danh sách và gọi `get_session` lại một lần; không hiển thị lỗi cho người dùng vì đây là vi phạm invariant của backend chứ không phải lỗi thao tác. |
| Đóng tab cuối cùng của phiên | `CloseResultDto.session` có `tabs` rỗng; route tự chuyển sang nhánh chọn công cụ của `FE-006` và workspace unmount, không có trạng thái trung gian nào hiển thị. |
| Đóng pane duy nhất của một tab | Tab vẫn còn với một leaf `Empty` và `PaneContentPicker` xuất hiện; thao tác `Close Pane` không bao giờ trở thành `Close Tab` ngầm. |
| Bấm `Split right` hai lần rất nhanh ở pane thứ ba | Khe mutation cấu trúc chặn lần thứ hai; đúng một pane thứ tư được tạo, và lần bấm sau đó nhận trạng thái disabled từ snapshot mới. |
| Gọi phím tắt chia khi tab đã có bốn pane | Không command nào được gọi; dòng thông báo hiện `A tab can hold up to 4 panes.` Đây là đường duy nhất còn lại vì hai nút đã disabled. |
| `split_pane` trả `paneLimitReached` dù nút còn bật vì snapshot cũ | Hiện đúng thông điệp giới hạn, đọc lại `get_session` để hai nút về trạng thái disabled. |
| Kéo một tab rồi thả về đúng chỗ cũ | `resolveMoveBeforeTabId` cho ra vị trí không đổi nên không command nào được gọi. |
| Kéo tab bằng bàn phím rồi bấm `Esc` | dnd-kit hủy thao tác; thứ tự hiển thị không đổi và không command nào được gọi. |
| Nhả đường phân cách ở vị trí vượt biên | Tỉ lệ được kẹp về `1000` hoặc `9000` trước khi gửi, nên `invalidSplitRatio` chỉ có thể là lỗi tích hợp. |
| Kéo đường phân cách trong lúc snapshot mới tới từ nơi khác | Tỉ lệ cục bộ tiếp tục thắng cho tới khi thao tác kết thúc; sau khi commit, tỉ lệ backend gần nhất được đồng bộ lại vào group qua handle imperative. |
| Đang phóng to rồi bấm `Split right` | Backend bỏ maximize và tạo pane mới; badge biến mất, cây hiện lại đầy đủ và pane mới là active. |
| Pane đang phóng to bị đóng | Backend xóa `maximizedPaneId` cùng leaf đó; snapshot trả về đã hết trạng thái phóng to nên không cần bước dọn nào ở frontend. |
| `profileId` của một pane không còn trong catalog | Đầu pane dùng dấu nhận diện trung tính và giữ `title` của content; pane vẫn hoạt động vì content thuộc backend, không thuộc catalog. |
| Catalog công cụ lỗi trong lúc pane picker đang mở | Picker hiện thông điệp lỗi kèm `Try again`; thanh tab, các pane khác và mọi phím tắt vẫn dùng được. |
| `select_pane_tool` trả `paneNotEmpty` vì pane đã được gán từ nơi khác | Đọc lại `get_session` và render content thật; không hiện lỗi cho người dùng. |
| Phiên bị xóa trong lúc đang mở một hộp thoại đóng tab | Route nhận `deleted`, đóng mọi hộp thoại và điều hướng về `/projects/{projectId}` theo đúng hành vi của `FE-006`. |
| Một command trả `closeInProgress` | Toàn bộ hành động của workspace và bảy phím tắt bị khóa, dòng thông báo hiện `This session is closing.`; khóa được mở khi snapshot mới tới. |
| `runtimeShuttingDown` khi đang thoát ứng dụng | Bỏ luồng im lặng, không thử lại và không hiện lỗi kỹ thuật giữa lúc Quit. |
| Tên tab rất dài hoặc chứa ký tự Unicode rộng | Tab cắt ellipsis một dòng và đặt `title` là tên đầy đủ; độ dài đếm theo Unicode scalar value đúng như `validateSessionName`. |
| Rất nhiều tab so với chiều rộng cửa sổ | Thanh tab cuộn ngang, không xuống dòng và không co tab dưới mức đọc được; tab active luôn được cuộn vào tầm nhìn sau mỗi lần snapshot đổi. |
| Đóng tab active ở giữa danh sách | Backend chọn tab bên phải ở index cũ, không có thì tab bên trái; frontend không tự chọn tab nào. |
| `reopen_last_closed_tab` thành công khi số tab đã thay đổi | Vị trí chèn do backend kẹp; frontend chỉ render snapshot trả về. |
| Hệ điều hành yêu cầu giảm chuyển động | Hiệu ứng dịch chỗ khi kéo tab bị tắt bằng biến thể `motion-reduce` của CSS; thao tác và thứ tự focus không đổi. |
| Cửa sổ bị ẩn xuống tray rồi mở lại | Route đọc lại `get_session` khi cửa sổ focus, đúng hành vi của `FE-006`; workspace render lại theo snapshot đó và không gọi thêm command nào. |
| Backend trả `unauthorizedWindow` | Hiển thị dòng lỗi tích hợp và không tự thử lại; đây là lỗi ở ranh giới cửa sổ, không phải lỗi người dùng. |

## Tiêu chí hoàn thành

- [ ] Route `/sessions/:sessionId` của một phiên đã có tab render thanh tab và bố cục pane, không còn header phiên; nhánh phiên chưa có tab vẫn render `SessionToolPicker` như trước.
- [ ] `New tab` và `Ctrl+T` tạo đúng một tab, tab đó thành active, và pane `Empty` của nó hiển thị `PaneContentPicker`.
- [ ] Đổi tên tab áp dụng quy tắc `1`–`80` Unicode scalar value không ký tự điều khiển, cho phép tên trùng, và tên mới xuất hiện ngay trên thanh tab.
- [ ] Kéo thả đổi được thứ tự tab bằng chuột và bằng bàn phím; `Move tab left`/`Move tab right` cho ra cùng kết quả; thả về đúng chỗ cũ không gọi command nào; tab active không đổi sau khi sắp xếp.
- [ ] Bấm một tab gọi `set_active_tab` đúng một lần và bấm lại tab đang active không gọi command nào.
- [ ] Chia phải và chia xuống dựng đúng cây theo wireframe cho cả bốn bố cục `#panes-1` tới `#panes-4`; pane thứ năm luôn bị chặn, hai nút chia disabled kèm tooltip giới hạn, và phím tắt ở giới hạn hiển thị `A tab can hold up to 4 panes.`
- [ ] `SplitAxisDto.vertical` render thành hai pane trái–phải và `horizontal` thành hai pane trên–dưới, đúng quy ước `first`/`second` của `BE-005`.
- [ ] Kéo đường phân cách chỉ gọi `set_split_ratio` đúng một lần khi kết thúc thao tác, với giá trị nằm trong `1000`–`9000`; resize bằng bàn phím cũng commit đúng một lần sau khi đứng yên, và `Esc` khôi phục tỉ lệ backend mà không commit.
- [ ] Phóng to một pane phủ toàn vùng tab, hiện badge `Maximized · {chỉ số} of {tổng} panes · Ctrl Shift M to restore`, không unmount pane nào, và `Restore layout` đưa bố cục cùng tỉ lệ cũ trở lại.
- [ ] Màn hình chọn nội dung của pane mới có khối `Recent` trước, cột `Terminal / CLI` theo đúng thứ tự catalog, và cột `File` ở trạng thái chờ không bấm được với dòng `Files arrive with FE-016.`
- [ ] Chọn một công cụ khả dụng trong pane gọi `select_pane_tool` đúng một lần, ghi công cụ vào danh sách gần đây, và pane chuyển sang khối chờ nội dung mà không tạo process nào.
- [ ] Thẻ công cụ không khả dụng trong pane picker hiển thị đúng lý do, badge `Unavailable`, `Check again` và `Open CLI Profiles`; bấm thẻ đó không gọi `select_pane_tool`.
- [ ] Đóng tab hoặc pane không có blocker đóng ngay mà không mở hộp thoại; có blocker thì hộp thoại mở với nhãn `Close Tab` hoặc `Close Pane` và hộp facts đúng số tiến trình cùng số file chưa lưu do `get_close_impact` trả về.
- [ ] `confirmationRequired` trả về lúc commit làm hộp thoại mở hoặc render lại facts mới và yêu cầu xác nhận thêm một lần trước khi đóng.
- [ ] Đóng pane duy nhất của một tab giữ tab lại với một leaf `Empty`; đóng tab cuối cùng của phiên đưa route về màn hình chọn công cụ.
- [ ] `Reopen closed tab` chỉ bật khi `canReopenLastClosedTab` là `true`, gọi `reopen_last_closed_tab` và không khởi chạy lại tiến trình nào.
- [ ] Bảy phím tắt cục bộ khớp đúng default Phase 1 của `BE-009`, so khớp theo `KeyboardEvent.code`, không chạy khi focus đang ở ô nhập liệu hoặc khi có hộp thoại mở, và chỉ `preventDefault` sau khi đã khớp một action còn khả dụng.
- [ ] Thanh tab dùng `role="tablist"` với `aria-selected` đúng, roving tabindex, `ArrowLeft`/`ArrowRight`/`Home`/`End` đổi focus và `Enter`/`Space` mới chọn; mọi nút icon không nhãn đều có tooltip.
- [ ] Đường phân cách nhận focus được, có nhãn nêu rõ trục, và bị loại khỏi thứ tự `Tab` khi một pane đang phóng to.
- [ ] Mọi lỗi tab/pane hiển thị bằng một dòng nêu rõ đối tượng gặp lỗi, kèm `Try again` khi lỗi cho phép thử lại; `closeInProgress` khóa toàn bộ hành động của workspace.
- [ ] `applyDetail` bỏ qua snapshot có `revision` cũ hơn snapshot đã áp dụng, nên activate và commit tỉ lệ chạy song song không làm mất kết quả của một mutation cấu trúc.
- [ ] Không có `localStorage`, `sessionStorage` hoặc `indexedDB` nào được thêm; `autoSaveId` và `storage` của `react-resizable-panels` không xuất hiện trong `src/`.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck` và `pnpm test` pass trên Windows.
- [ ] `pnpm tauri build` pass, vì lát cắt này đổi tập dependency của frontend được đóng gói vào ứng dụng desktop.
- [ ] Smoke thủ công trên Windows bằng `pnpm tauri dev`: tạo ba tab trong một phiên, đổi tên một tab, kéo đổi thứ tự, chia lên bốn pane, kéo hai đường phân cách rồi kiểm tra tỉ lệ giữ nguyên sau khi chuyển tab và quay lại, phóng to rồi khôi phục, đóng một pane, đóng một tab rồi mở lại nó, và xác nhận `Ctrl+W` không đóng cửa sổ WebView2.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/sessions/session-workspace.test.tsx` | Component | Dựng thanh tab và bố cục của tab active; dòng thông báo lỗi và `Try again`; khóa toàn bộ hành động khi `closeInProgress`; `onRenameSession` và `onDeleteSession` được phát lên đúng một lần; fallback khi `activeTabId` không hợp lệ. |
| `src/features/sessions/session-tab-strip.test.tsx` | Component | `role="tablist"` và `aria-selected`; bấm tab gọi `set_active_tab` một lần và bấm tab đang active thì không; `New tab`; kéo thả gọi `move_tab` với `beforeTabId` đúng; đường bàn phím tương đương; thả về chỗ cũ không gọi command; tab active được cuộn vào tầm nhìn. |
| `src/features/sessions/session-tab.test.tsx` | Component | Icon cho `empty`, `toolSelection`, `terminal` và `file`; roving tabindex; nhãn nút đóng nêu tên tab; double-click mở hộp thoại đổi tên; tên dài có `title` đầy đủ. |
| `src/features/sessions/tab-options-menu.test.tsx` | Component | Hai nhóm item và separator; `Reopen closed tab` disabled khi `canReopenLastClosedTab` là `false`; `Move tab left`/`Move tab right` disabled ở hai đầu; item `Delete Session` dùng kiểu destructive. |
| `src/features/sessions/rename-tab-dialog.test.tsx` | Component | Giá trị tiền điền và được chọn sẵn; khóa nút khi tên chỉ gồm khoảng trắng hoặc quá dài; thông điệp `invalidName` từ backend; trả focus về control đã mở hộp thoại. |
| `src/features/sessions/close-target-dialog.test.tsx` | Component | Tiêu đề và nhãn phá hủy cho tab và cho pane; câu riêng của pane cuối cùng; facts số ít, số nhiều, `+{n} more` và ẩn hoàn toàn khi không có blocker; `confirmationRequired` lần hai; retry sau `contentLifecycleFailed`; hủy không gọi command. |
| `src/features/sessions/pane-layout.test.tsx` | Component | Bốn bố cục `#panes-1` tới `#panes-4` dựng đúng cây; `vertical` ra trục trái–phải và `horizontal` ra trục trên–dưới; `defaultSize` khớp `ratioBasisPoints`; khi phóng to thì mọi pane vẫn được mount, các pane khác bị ẩn và đường phân cách rời thứ tự `Tab`. |
| `src/features/sessions/pane-split-handle.test.tsx` | Component | Nhãn theo trục; commit `set_split_ratio` đúng một lần khi kết thúc kéo với giá trị đã kẹp; commit sau khi resize bằng bàn phím đứng yên; `Esc` khôi phục tỉ lệ backend và không commit; `invalidSplitRatio` khôi phục tỉ lệ backend. |
| `src/features/sessions/session-pane.test.tsx` | Component | Dấu nhận diện và tiêu đề cho từng loại content kể cả khi `profileId` không còn trong catalog; đường dẫn gốc project và trường hợp `rootPath` là `null`; hai nút chia disabled kèm tooltip giới hạn ở bốn pane; `Maximize pane` đổi thành `Restore layout`; focus vào pane gọi `set_active_pane` một lần. |
| `src/features/sessions/pane-content-picker.test.tsx` | Component | Ẩn và hiện khối `Recent`; thứ tự thẻ theo catalog; cột `File` hiện dòng chờ và không bấm được; thẻ không khả dụng không gọi command và có `Check again`; trạng thái đang tải và lỗi catalog kèm `Try again`. |
| `src/features/sessions/pane-content-placeholder.test.tsx` | Component | Câu chữ cho `toolSelection` kèm tên profile, cho `terminal` và cho `file`. |
| `src/features/sessions/use-workspace-mutations.test.ts` | Unit | Khe mutation cấu trúc chặn lần gọi thứ hai; activate và commit tỉ lệ không bị khe đó chặn; dedupe activate khi target đã đúng; tuần tự commit theo `splitId`; luồng impact rồi đóng; bỏ hộp thoại khi không có blocker; `confirmationRequired`; `paneLimitReached`; `noClosedTab`; `invalidMove`; `paneNotEmpty`; `closeInProgress`; `runtimeShuttingDown`. |
| `src/features/sessions/use-workspace-shortcuts.test.ts` | Unit | Bảy tổ hợp gọi đúng handler; bỏ qua khi focus trong `input`, `textarea` và `contenteditable`; bỏ qua khi `isEnabled` là `false`; bỏ qua `event.repeat` và `isComposing`; `preventDefault` chỉ khi đã khớp. |
| `src/features/sessions/workspace-shortcuts.test.ts` | Unit | So khớp theo `code` và tổ hợp modifier chính xác; không khớp khi có modifier thừa; nhãn hiển thị của từng action, gồm `Ctrl Alt \` cho `panes.splitDown`. |
| `src/features/sessions/session-layout.test.ts` | Unit | Thứ tự leaf `first` rồi `second`; đếm và tìm pane trong cây bốn pane; `paneIndex` cho pane không tồn tại; kẹp tỉ lệ ở hai biên và giá trị ngoài khoảng; đổi qua lại basis point và phần trăm; `resolveMoveBeforeTabId` cho vị trí đầu, giữa, cuối và cho lần thả không đổi vị trí. |
| `src/features/sessions/session-route.test.tsx` | Component | Bổ sung: nhánh đã có tab render `SessionWorkspace` và không còn header phiên; nhánh chưa có tab không đổi; hai hộp thoại phiên mở được từ menu `Tab options`. |
| `src/features/sessions/use-session-detail.test.ts` | Unit | Bổ sung: `applyDetail` áp snapshot mới hơn và bỏ qua snapshot có revision cũ hơn. |
| `src/lib/ipc/sessions.test.ts` | Unit | Bổ sung: tên mười command mới và hình dạng tham số camelCase, gồm `beforeTabId` là `null` và `paneId` là `null`; ánh xạ rejection thành `IpcCallError` có payload typed. |
| `src/lib/utils/session-copy.test.ts` | Unit | Bổ sung: `buildCloseImpactFacts` cho ba loại target; `buildDeleteSessionFacts` giữ nguyên kết quả sau khi gọi lại hàm dùng chung; câu chữ hộp thoại đóng tab và pane; phân loại mới của `paneLimitReached`, `invalidMove` và `invalidSplitRatio`. |

Test dùng `sessions-test-fixture.ts` cho mọi DTO, không dựng snapshot bằng tay trong từng file. Test không tạo process thật và không mock runtime Tauri ở mức khác ngoài wrapper trong `src/lib/ipc/`.

## Câu hỏi mở

- Không có.
