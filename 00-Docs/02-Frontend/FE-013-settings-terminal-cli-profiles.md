# FE-013 — Settings Terminal & CLI Profiles

Tài liệu này đặc tả contract frontend cho mục `Terminal & CLI Profiles` của Settings: chọn shell mặc định, xem và kiểm tra trạng thái profile dựng sẵn, cùng việc tạo, sửa, xóa và kiểm tra profile CLI tùy chỉnh mà không làm lộ giá trị bí mật.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-013` |
| Phase | `1` |
| Khu vực chính | `src/features/settings/` |
| Yêu cầu chức năng | `§17.3`, `§10.2`; trạng thái không khả dụng theo `§10.3`; yêu cầu tương tác chung `§18` |
| Wireframe | `01-Wireframe/02-AppShell.html#settings-terminal` |
| Backend liên quan | `BE-006` |
| Phụ thuộc | `FE-011` phải hoàn thành trước; `BE-006` đã triển khai và đã sinh `src/bindings/terminal/cli-profiles.ts` |

## Mục tiêu

Người dùng mở `Settings › Terminal & CLI Profiles`, chọn shell mặc định, xem Codex/Claude/Terminal có dùng được hay không và chủ động kiểm tra lại từng profile. Người dùng tạo, sửa và xóa profile tùy chỉnh với command, từng argument, shell, icon, màu và biến môi trường; giá trị được đánh dấu bí mật không bao giờ được frontend đọc lại hoặc hiển thị sau khi lưu.

### Quyết định và giả định đã chốt

- Route `/settings/terminal-profiles` thay placeholder `FE-013` bằng `SettingsTerminalProfilesRoute`; khung, sub-nav, breadcrumb và đường dẫn do `FE-011` giữ nguyên.
- Ba profile `Codex`, `Claude`, `Terminal` luôn chỉ đọc. Nút Edit cạnh profile dựng sẵn trong wireframe bị bỏ vì `§17.3`, `BE-006` và backend hiện có chỉ cho CRUD profile tùy chỉnh. Mỗi profile dựng sẵn chỉ có hành động `Check command`.
- `Arguments` là danh sách nhiều dòng, mỗi dòng là đúng một phần tử của `CliProfileInputDto.arguments`. Frontend không tách một chuỗi theo khoảng trắng, không phân tích dấu nháy và không nối các phần tử thành shell string. Một dòng rỗng là một empty argument hợp lệ; người dùng muốn bỏ argument phải xóa cả dòng.
- Mỗi biến môi trường có switch `Secret`. Secret đã lưu hiển thị `Stored securely`, không hiện giá trị giả có thể bị hiểu nhầm là dữ liệu thật. `Replace value` mở một ô password rỗng; hủy replace quay lại trạng thái giữ nguyên. Chuyển một secret đã lưu thành non-secret bắt buộc nhập giá trị mới vì backend và frontend không thể đọc lại giá trị cũ.
- Editor icon dùng một ô text theo giới hạn backend `1–16` Unicode scalar; colour dùng `<input type="color">` đồng bộ với ô hex `#rrggbb`. Giá trị hex được chuẩn hóa lowercase trước khi gửi.
- Xóa profile luôn qua hộp thoại xác nhận có nút `Delete Profile`. Hộp thoại nói rõ terminal đã chạy không bị dừng, nhưng profile sẽ biến mất khỏi lần chọn hoặc launch tiếp theo.
- Editor là modal sheet ở mép phải như wireframe, dùng primitive `Dialog` hiện có với class vị trí riêng của feature. Sheet giữ focus bên trong, focus Name khi tạo mới, focus control đầu tiên khi sửa và trả focus về nút đã mở nó khi đóng.
- Đóng editor có thay đổi chưa lưu bằng nút Close, `Esc` hoặc bấm ngoài sheet đều mở xác nhận `Discard profile changes?`; hành động phá hủy mang nhãn `Discard Profile Changes`. Editor sạch đóng ngay.
- `Save profile` không yêu cầu command đang khả dụng. Backend cho phép lưu cấu hình rồi kiểm tra nền; profile có command hoặc shell không tìm thấy vẫn được lưu và xuất hiện với trạng thái `Command not found` hoặc `Shell not found`.
- `Check command` trong sheet chỉ bật khi đang sửa một profile đã lưu và form không có thay đổi. `check_cli_profile` chỉ nhận `profileId`, không nhận draft; khi tạo mới hoặc đã sửa form, nút bị khóa với lời giải thích `Save changes before checking.` để không kiểm tra nhầm cấu hình cũ. Hành động check ở mỗi hàng luôn kiểm tra cấu hình đã lưu.
- Store của FE-013 giữ snapshot trong memory, gắn đúng một listener `cli-profiles://changed` khi route có consumer và gọi lại `get_cli_profiles` sau invalidation. Payload event không được dùng để vá dữ liệu; snapshot backend là nguồn duy nhất.
- Snapshot chỉ được thay khi `revision` mới không cũ hơn revision đang có. So sánh chuỗi decimal bằng độ dài rồi theo thứ tự từ điển, không đổi sang `number`, để không mất chính xác của bộ đếm `u64`.
- Chỉ một mutation bền vững (`create`, `update`, `delete`, `set default shell`) được gửi tại một thời điểm. Check có trạng thái riêng theo profile; bấm lặp cùng profile bị chặn, còn các check khác được phép xếp qua backend.
- `BE-006-cli-profiles.md` có một câu mô tả error chứa `message` và `field`, nhưng enum Rust hiện có cùng binding sinh tự động chỉ xuất union `{ code }`. FE-013 dùng contract thực tế này, tự kiểm tra cục bộ để đặt lỗi cạnh field và chỉ dùng `code` cho lỗi backend; không đọc `message` hoặc `field` không tồn tại. Đây là sai lệch tài liệu backend cần được sửa ở một yêu cầu riêng, không mở rộng FE-013 sang sửa `BE-006`.
- Không thêm dependency npm hoặc crate. Feature dùng `Dialog`, `Button`, `Input`, `Switch` và `Tooltip` đã có; select, color input và các field lặp là control HTML có style cục bộ trong feature.

### Ngoài phạm vi

- Màn hình chọn tool, tạo session và trạng thái profile trong New Session; thuộc `FE-006`.
- Khởi chạy process, terminal renderer, PTY và working directory; thuộc `FE-008`, `BE-007` và backend session.
- Sửa tên, command, icon hoặc màu của Codex, Claude và Terminal dựng sẵn.
- Cho người dùng nhập executable shell tùy ý; UI chỉ chọn stable shell ID backend trả trong catalog.
- Đọc, sao chép, hiện lại hoặc xuất plaintext secret đã lưu.
- Quản lý thứ tự profile, profile dùng gần đây hoặc kéo thả profile.
- Sửa binding TypeScript bằng tay, thay schema/migration, command backend hoặc credential store.
- Nội dung các mục Settings khác và việc About hiển thị backend terminal/default shell.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/settings/settings-terminal-profiles-route.tsx` | Route entry của mục Settings; ghép header, default shell, hai bảng profile, trạng thái tải/rỗng/lỗi và các modal. |
| `src/features/settings/cli-profile-table.tsx` | Bảng profile dựng sẵn hoặc tùy chỉnh; badge availability, thời điểm check và các hành động check/edit/delete. |
| `src/features/settings/cli-profile-editor.tsx` | Modal sheet tạo/sửa profile; argument rows, icon/colour, shell, environment rows, save/check và xác nhận bỏ thay đổi. |
| `src/features/settings/cli-profile-form.ts` | Kiểu draft, chuyển DTO thành draft, validation cục bộ và dựng `CliProfileInputDto` mà không nối command/argument hoặc làm lộ secret. |
| `src/features/settings/delete-cli-profile-dialog.tsx` | Hộp xác nhận xóa profile tùy chỉnh và trạng thái đang xóa/lỗi xóa. |
| `src/features/settings/cli-profiles-store.ts` | Zustand store cho snapshot, revision, listener invalidation, refresh, mutation tuần tự, check theo profile và lỗi gần nhất. |
| `src/features/settings/cli-profile-error-copy.ts` | Ánh xạ từng `CliProfilesError.code` và lỗi transport thành nội dung English, vị trí hiển thị và khả năng retry. |
| `src/features/settings/cli-profiles-test-fixture.ts` | Fixture snapshot/profile/shell nhất quán với binding BE-006 cho test frontend của feature. |
| `src/lib/ipc/cli-profiles.ts` | Wrapper typed cho sáu command BE-006 và listener `cli-profiles://changed`; là nơi duy nhất FE-013 chạm API Tauri. |
| `src/bindings/terminal/cli-profiles.ts` | DTO/error sinh từ Rust được các wrapper và state import; không sửa tay. |
| `src/app/app-router.tsx` | Trỏ route `terminal-profiles` sang `SettingsTerminalProfilesRoute` thay cho placeholder. |
| `src/features/settings/settings-terminal-profiles-route.test.tsx` | Test trang, bảng, default shell, trạng thái tải/rỗng/lỗi và kết nối các flow. |
| `src/features/settings/cli-profile-editor.test.tsx` | Test form tạo/sửa, argument, secret, validation, save/check và cảnh báo bỏ thay đổi. |
| `src/features/settings/delete-cli-profile-dialog.test.tsx` | Test xác nhận xóa, nhãn phá hủy, lỗi, retry và focus. |
| `src/features/settings/cli-profile-form.test.ts` | Test hàm chuyển đổi/validation, đặc biệt argument literal và quy tắc giữ/thay secret. |
| `src/features/settings/cli-profiles-store.test.ts` | Test load, subscription, revision, mutation tuần tự, check và xử lý race khi unmount. |
| `src/lib/ipc/cli-profiles.test.ts` | Test tên command, payload camelCase, kết quả typed, error wrapper và listener/unlisten. |
| `src/app/app-router.test.tsx` | Bổ sung test route thật, breadcrumb và việc bỏ placeholder `FE-013`. |

Feature không sửa `src/features/settings/settings-nav.tsx`, `src/features/settings/settings-route.tsx`, `src/features/settings/settings-store.ts`, `src/components/ui/`, `src-tauri/`, migration, capability, `package.json`, lockfile hoặc file sinh trong `src/bindings/`.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `SettingsTerminalProfilesRoute` | Trang trong `Outlet` của Settings, tiêu đề `Terminal & CLI Profiles`, mô tả, hàng default shell, bảng built-in và bảng custom. | `#settings-terminal` |
| `DefaultShellField` | Native select có nhãn `Default shell`; lựa chọn đầu là `System default` nếu catalog có `system`, sau đó là các shell concrete theo đúng thứ tự backend. | `#settings-terminal` |
| `CliProfileTable` | Bảng bốn cột `Profile`, `Command`, `Status`, actions; bảng built-in và custom dùng cùng cách render nhưng quyền thao tác khác nhau. | `#settings-terminal` |
| `ProfileMark` | Ô nhận diện dùng `icon` và `color` backend trả; có đường viền đủ tương phản, không dùng màu làm dấu hiệu trạng thái duy nhất. | `#settings-terminal` |
| `AvailabilityBadge` | Hiển thị `Not checked`, `Checking…`, `Available`, `Command not found` hoặc `Shell not found`, kèm thời điểm check khi có. | `#settings-terminal` |
| `CliProfileEditor` | Modal sheet bên phải cho `New profile` hoặc `Edit profile`; chứa toàn bộ field và footer `Cancel`/`Save profile`. | `#settings-terminal` |
| `ArgumentRows` | Danh sách input có thứ tự; mỗi row là một argument literal, có nút Remove và nút `Add argument`. | Phát triển từ field `Arguments` tại `#settings-terminal` |
| `EnvironmentRows` | Danh sách Name/Value/Secret; secret đã lưu có trạng thái giữ nguyên hoặc replace mà không bao giờ nhận lại plaintext. | `#settings-terminal` |
| `DeleteCliProfileDialog` | Xác nhận trước khi xóa custom profile, hiển thị đúng tên profile và ảnh hưởng tới lần launch sau. | Không có dialog riêng trong wireframe; bắt buộc bởi hành vi phá hủy và `§18` |
| `DiscardChangesDialog` | Chặn đóng sheet khi draft khác dữ liệu ban đầu. | Không có |

Nội dung chính dùng nguyên văn wireframe:

- Mô tả trang: `Which shell opens by default and which tools appear on the New Session screen.`
- Default shell: `Used by the Terminal profile and by any profile without its own shell.`
- Nhóm: `Built-in profiles`, `Custom profiles`; hành động tạo: `New Profile`.
- Form: `Name`, `Icon`, `Colour`, `Command`, `Arguments`, `Shell (optional)`, `Environment variables`, `Check command`, `Cancel`, `Save profile`.
- Hint Arguments: `Each row is passed as one argument. Values are never joined into a shell string.`
- Hint secret: `Secret values are stored in the operating system credential store and are never shown or exported in backups.`

`Command` của Terminal lấy nguyên giá trị backend trả, tức command của effective default shell. `arguments` chỉ được trình bày ở bảng custom bằng cách nối để đọc với khoảng trắng và escape dành riêng cho display; chuỗi display này tuyệt đối không được dùng lại làm input khi save hoặc launch. Nếu command là `null`, ô Command hiển thị `—`.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| `Đang tải` | Store chưa có snapshot và `status` là `idle` hoặc `loading`. | Header giữ nguyên; phần nội dung hiện `Loading CLI profiles…` với `aria-busy="true"`; `New Profile` và default shell bị khóa. |
| `Sẵn sàng` | Có snapshot hợp lệ. | Default shell và hai nhóm profile hiển thị từ snapshot; không hardcode availability hoặc command vào UI. |
| `Lỗi tải` | `get_cli_profiles` thất bại khi chưa có snapshot. | `XWork couldn't load CLI profiles.` trong `role="alert"`; `Try again` cho `persistenceFailed` hoặc lỗi transport, không retry với `unauthorizedWindow`. |
| `Đang refresh` | Đã có snapshot và invalidation hoặc retry đang gọi lại backend. | Giữ nguyên nội dung cũ, hiện `Refreshing…` bằng `aria-live="polite"`; không thay bảng bằng loading placeholder. |
| `Listener lỗi` | Đăng ký `cli-profiles://changed` thất bại. | Banner không chặn: `CLI profile status won't update automatically.` kèm `Refresh`; command trả snapshot vẫn tiếp tục dùng được. |
| `Không có custom profile` | `profiles` chỉ có ba built-in. | Giữ tiêu đề `Custom profiles`; thay table body bằng `No custom profiles yet.` và hành động `New Profile`. |
| `Đạt giới hạn profile` | Có 100 custom profile. | `New Profile` bị khóa; dòng `Delete a custom profile before creating another.` hiển thị cạnh nút. |
| `Không có shell khả dụng` | Catalog không có lựa chọn khả dụng hoặc effective default shell không resolve được. | Default shell giữ lựa chọn persisted nếu còn trong DTO nhưng bị khóa; hiện `No available shell was found. Install a supported shell, then refresh.` Các profile phụ thuộc shell có badge `Shell not found`. |
| `Đang đổi shell` | `set_default_cli_shell` đang chạy. | Select bị khóa và giữ lựa chọn vừa chọn; `Saving…` được công bố bằng `aria-live`. Mọi mutation khác bị khóa. |
| `Đổi shell lỗi` | Command đổi shell thất bại. | Select quay lại `snapshot.defaultShellId`; lỗi hiện cạnh field. `invalidShell` refresh catalog, `shellNotFound` yêu cầu chọn shell khác, lỗi lưu/transport có `Try again`. |
| `Chưa kiểm tra` | `availability.status === "unchecked"`. | Badge trung tính `Not checked`, không có thời điểm; `Check command` khả dụng. |
| `Đang kiểm tra` | ID nằm trong `checkingProfileIds`. | Badge `Checking…`, action cùng ID bị khóa; các row khác không bị khóa nếu không có persistent mutation. |
| `Khả dụng` | `availability.status === "available"`. | Badge success `Available`; nếu có timestamp, dòng phụ `Checked HH:mm` theo giờ máy. |
| `Không tìm thấy command` | `availability.status === "commandNotFound"`. | Badge warning `Command not found`; row vẫn có Check và custom profile vẫn có Edit/Delete. |
| `Không tìm thấy shell` | `availability.status === "shellNotFound"`. | Badge warning `Shell not found`; custom profile có thể Edit để đổi shell, built-in hướng người dùng tới default shell. |
| `Check lỗi` | `check_cli_profile` reject thay vì trả status. | Giữ status cũ; lỗi inline tại row `XWork couldn't check this command.` cùng `Try again` khi phù hợp. |
| `Editor tạo mới` | Người dùng bấm `New Profile`. | Form rỗng, chưa có argument hoặc environment row; shell mặc định là `Use default shell`, icon `>_`, colour `#64748b`. |
| `Editor sửa` | Người dùng bấm Edit ở custom profile. | Dữ liệu lấy từ DTO; secret đã lưu không có plaintext và hiện `Stored securely`. Built-in không có điểm vào trạng thái này. |
| `Editor đang lưu` | Create/update đang chạy. | Toàn form và Close/Cancel bị khóa, nút chính hiện `Saving…`; không cho gửi lần hai. |
| `Editor lỗi validation` | Validation cục bộ hoặc backend trả mã input không hợp lệ. | Lỗi cạnh field/nhóm tương ứng, focus field lỗi đầu tiên; draft giữ nguyên. Backend error không xác định được row hiển thị ở đầu nhóm liên quan. |
| `Editor lỗi lưu` | Credential, persistence hoặc transport lỗi. | Draft và secret mới còn trong state của sheet cho retry nhưng không log/persist; banner nêu lỗi an toàn. Đóng sheet sẽ xóa state chứa plaintext. |
| `Profile thay đổi khi đang sửa` | Snapshot mới đổi editable fields của profile đang mở. | Form sạch tự đồng bộ. Form dirty giữ draft, khóa Save và hiện `This profile changed in XWork. Reload it before saving.` với nút `Reload Profile`. |
| `Profile biến mất khi đang sửa/xóa` | Snapshot mới không còn ID. | Đóng editor/dialog, xóa plaintext draft và hiện alert trang `This profile no longer exists.` |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Chọn default shell | Gọi `set_default_cli_shell(shellId)`; áp snapshot trả về nếu revision không cũ; profile kế thừa chuyển về `Not checked` rồi cập nhật qua event. | Native select: `↑`/`↓`, ký tự đầu, `Enter` |
| Bấm Check ở một row | Gọi `check_cli_profile(profileId)`, sau khi xong yêu cầu refresh snapshot; không chạy executable. | `Enter`/`Space` trên button |
| Bấm `New Profile` | Mở sheet tạo mới và focus Name. | Không có phím tắt riêng |
| Bấm Edit ở custom profile | Mở sheet với dữ liệu đã lưu; built-in không render nút này. | `Enter`/`Space` |
| Thêm/xóa argument | Thay đúng vị trí trong mảng draft; xóa row cuối được phép để `arguments` thành mảng rỗng. | `Tab` tới action, `Enter`/`Space` |
| Đổi thứ tự argument | Nút `Move up`/`Move down` thay vị trí trong mảng; không có drag-only interaction. | `Enter`/`Space` |
| Bật `Secret` cho env | Giữ giá trị người dùng đang nhập nhưng đổi input sang password; payload gửi `isSecret: true`. | `Space` trên Switch |
| Replace secret đã lưu | Hiện input password rỗng; save yêu cầu giá trị mới, Cancel replace quay về giữ credential hiện tại. | `Enter`/`Space` |
| Tắt `Secret` của secret đã lưu | Không đọc giá trị cũ; chuyển sang ô text rỗng và yêu cầu nhập giá trị non-secret mới. | `Space` |
| Bấm `Save profile` | Validate cục bộ; create/update bằng full replacement DTO; thành công đóng sheet, xóa plaintext draft và thay snapshot. | Không có; Enter trong field không tự save |
| Bấm Check trong sheet | Chỉ với editor sạch của profile đã lưu; gọi cùng flow check của row. | `Enter`/`Space` |
| Đóng sheet sạch | Đóng ngay và trả focus về trigger. | `Esc` hoặc button Close |
| Đóng sheet dirty | Mở `Discard profile changes?`; không mất draft cho tới khi chọn `Discard Profile Changes`. | `Esc` đi vào xác nhận; `Esc` lần nữa đóng xác nhận và quay lại editor |
| Bấm Delete ở custom profile | Mở xác nhận, focus `Cancel`; không gọi backend ngay. | `Enter`/`Space` |
| Xác nhận `Delete Profile` | Gọi `delete_cli_profile`; thành công đóng dialog, thay snapshot và thông báo `Profile deleted.` | `Enter`/`Space` |
| Bấm `Refresh` | Gọi `get_cli_profiles`; giữ snapshot cũ trong lúc chờ. | `Enter`/`Space` |
| Di chuyển trong trang/sheet | Thứ tự focus theo thứ tự nhìn thấy; icon-only button có tooltip và accessible name; focus ring luôn rõ. | `Tab`/`Shift+Tab` |

## Luồng chính

1. Router mount `SettingsTerminalProfilesRoute`; route gọi `acquire()` của store.
2. Store đăng ký listener `cli-profiles://changed`, sau đó gọi `get_cli_profiles` dù listener thành công hay thất bại. Cách này bảo đảm startup check hoàn tất trước listener vẫn được phản ánh trong snapshot đầu.
3. Store nhận snapshot, kiểm tra revision decimal, thay toàn bộ state và render default shell cùng hai nhóm profile.
4. Mỗi event chỉ đánh dấu cần refresh. Nếu đang có refresh, store gộp thành một lần chạy tiếp theo thay vì tạo request không giới hạn.
5. Khi tạo/sửa, `CliProfileEditor` dựng draft riêng. `buildCliProfileInput` giữ từng argument và environment row riêng, dùng `undefined` để giữ secret đã lưu, rồi gọi create/update.
6. Backend trả snapshot sau commit. Store áp snapshot theo revision, đóng sheet và xóa draft chứa plaintext. Event cùng mutation có thể tới trước hoặc sau response nhưng revision guard ngăn snapshot cũ ghi đè snapshot mới.
7. Khi check, UI đánh dấu đúng profile đang kiểm tra. Kết quả command chỉ xác nhận hoàn tất; store gọi/coalesce `get_cli_profiles` để lấy snapshot có revision và trạng thái mới.
8. Khi route unmount và consumer cuối release, store hủy listener, vô hiệu request đang bay và xóa mọi error tạm; snapshot không chứa plaintext có thể giữ để lần mở sau render ngay rồi refresh.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `get_cli_profiles` | Không có | `CliProfilesSnapshotDto` | `persistenceFailed`: lỗi tải/refresh có `Try again`. `unauthorizedWindow`: lỗi tích hợp không retry. Rejection không có `code`: lỗi transport có retry. |
| `create_cli_profile` | `{ input: CliProfileInputDto }` | `CliProfilesSnapshotDto` | Validation map theo bảng lỗi bên dưới; `tooManyProfiles` khóa New; credential/persistence/transport giữ draft và cho retry; `unauthorizedWindow` không retry. |
| `update_cli_profile` | `{ profileId: string, input: CliProfileInputDto }` | `CliProfilesSnapshotDto` | Như create; thêm `profileNotFound` đóng sheet và refresh, `builtInProfileReadOnly` là lỗi tích hợp vì UI không cho edit built-in, `secretValueRequired` đặt lỗi vào secret row cần value. |
| `delete_cli_profile` | `{ profileId: string }` | `CliProfilesSnapshotDto` | `profileNotFound` đóng dialog và refresh; `persistenceFailed`/transport giữ dialog và cho retry; `builtInProfileReadOnly`/`unauthorizedWindow` là lỗi tích hợp không retry. |
| `set_default_cli_shell` | `{ shellId: string }` | `CliProfilesSnapshotDto` | `invalidShell`: refresh catalog và yêu cầu chọn lại. `shellNotFound`: giữ snapshot cũ, nêu shell không khả dụng. `persistenceFailed`/transport cho retry. `unauthorizedWindow` không retry. |
| `check_cli_profile` | `{ profileId: string }` | `CliProfileDto` | `profileNotFound`: bỏ row/editor stale và refresh. `commandResolutionFailed`: lỗi check có retry. Các mã khác và transport được xử lý phòng thủ bằng lỗi check chung; `commandNotFound`/`shellNotFound` bình thường nằm trong output status, không phải rejection. |

Wrapper public trong `src/lib/ipc/cli-profiles.ts`:

```ts
export function getCliProfiles(): Promise<CliProfilesSnapshotDto>
export function createCliProfile(input: CliProfileInputDto): Promise<CliProfilesSnapshotDto>
export function updateCliProfile(
  profileId: string,
  input: CliProfileInputDto,
): Promise<CliProfilesSnapshotDto>
export function deleteCliProfile(profileId: string): Promise<CliProfilesSnapshotDto>
export function setDefaultCliShell(shellId: string): Promise<CliProfilesSnapshotDto>
export function checkCliProfile(profileId: string): Promise<CliProfileDto>
export function onCliProfilesChanged(
  handler: (event: CliProfilesChangedDto) => void,
): Promise<UnlistenFn>
```

Mọi wrapper command dùng `invokeCommand<TResult, CliProfilesError>`. Tên argument JavaScript là `profileId`/`shellId` đúng cách Tauri map sang Rust `profile_id`/`shell_id`. `UnlistenFn` được re-export từ IPC wrapper để feature không import Tauri trực tiếp.

Ánh xạ lỗi input:

| `code` | Vị trí/ứng xử |
|---|---|
| `invalidName` | Field Name. |
| `invalidCommand` | Field Command. |
| `invalidArguments` | Đầu nhóm Arguments; validation cục bộ đánh dấu row cụ thể khi biết được. |
| `invalidShell` | Field Shell và refresh catalog. |
| `invalidIcon` | Field Icon. |
| `invalidColor` | Field Colour. |
| `invalidEnvironmentName` | Đầu nhóm Environment; validation cục bộ đánh dấu row cụ thể. |
| `duplicateEnvironmentName` | Mọi row trùng không phân biệt ASCII hoa/thường. |
| `tooManyEnvironmentVariables` | Đầu nhóm Environment và khóa Add variable. |
| `invalidEnvironmentValue` | Đầu nhóm Environment; không lặp lại value trong thông điệp. |
| `secretValueRequired` | Secret row mới/đổi tên/đang replace mà thiếu value; nếu backend không chỉ ra row thì focus secret row đầu tiên thuộc trường hợp này. |
| `tooManyProfiles` | Đầu trang; đóng editor chỉ sau khi người dùng xác nhận lỗi, khóa New cho tới snapshot tiếp theo. |
| `credentialStoreUnavailable`, `secretWriteFailed` | Banner sheet an toàn, không ghi tên/value secret; giữ draft để retry. |
| `persistenceFailed` | Banner theo operation, giữ dữ liệu đã commit trước đó và cho retry. |
| `unauthorizedWindow`, `builtInProfileReadOnly`, code không mong đợi | Lỗi tích hợp không retry; không giả vờ mutation thành công. |

Các error `commandNotFound`, `shellNotFound`, `secretReadFailed`, `secretNotFound` thuộc launch path hoặc output availability theo `BE-006`; nếu bất ngờ xuất hiện ở command FE-013 thì hiển thị lỗi chung an toàn và refresh, không suy diễn hoặc làm lộ dữ liệu.

Validation cục bộ trước khi gọi backend:

| Field | Quy tắc frontend |
|---|---|
| Name | Trim trước khi gửi; bắt buộc `1–80` Unicode scalar. Tên trùng được phép. |
| Command | Trim trước khi gửi; bắt buộc, tối đa `1024` byte UTF-8, không NUL/control. Việc xác nhận bare executable hay absolute path hợp lệ theo từng hệ điều hành vẫn do backend quyết định. |
| Arguments | Tối đa `128` row; mỗi value tối đa `4096` byte UTF-8, tổng tối đa `32 KiB`, không NUL. Không trim; empty string hợp lệ. |
| Shell | `undefined` để kế thừa hoặc một concrete ID khác `system`, có trong snapshot và `isAvailable === true`. |
| Icon | Trim trước khi gửi; bắt buộc `1–16` Unicode scalar, không control. |
| Colour | Khớp `#[0-9a-f]{6}` sau khi chuẩn hóa lowercase. |
| Environment | Tối đa `64` row; name khớp `[A-Za-z_][A-Za-z0-9_]{0,127}` và unique ASCII case-insensitive; value tối đa `32 KiB`, không NUL. Empty value hợp lệ cho cả plain và secret. |

Frontend tính giới hạn byte bằng `TextEncoder`, không dùng `string.length`; giới hạn Unicode scalar dùng `Array.from(value).length`. Backend vẫn kiểm tra lại toàn bộ và là nơi quyết định cuối cùng.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `cli-profiles://changed` | `CliProfilesChangedDto` | Sau mutation commit, explicit check hoặc startup/background availability check của BE-006. | Không vá profile từ payload; coalesce một `get_cli_profiles`. `revision` chỉ giúp bỏ qua invalidation chắc chắn không mới hơn snapshot hiện tại. |

Không dùng Channel. Listener được tạo khi consumer đầu tiên mount và hủy khi consumer cuối release. Registration hoàn tất muộn sau release phải gọi ngay unlisten thay vì để listener mồ côi.

## State frontend

```ts
type CliProfilesStatus = "idle" | "loading" | "ready" | "error";
type CliProfilesMutationKind = "create" | "update" | "delete" | "setDefaultShell";

interface CliProfilesFailure {
  code: CliProfilesError["code"] | "unknown";
  operation: "load" | "refresh" | "check" | CliProfilesMutationKind;
  profileId: string | null;
  retryable: boolean;
  message: string;
}

interface CliProfilesState {
  status: CliProfilesStatus;
  snapshot: CliProfilesSnapshotDto | null;
  failure: CliProfilesFailure | null;
  listenerFailed: boolean;
  consumerCount: number;
  mutation: { kind: CliProfilesMutationKind; profileId: string | null } | null;
  checkingProfileIds: ReadonlySet<string>;
  acquire(): void;
  release(): void;
  refresh(): void;
  create(input: CliProfileInputDto): Promise<boolean>;
  update(profileId: string, input: CliProfileInputDto): Promise<boolean>;
  remove(profileId: string): Promise<boolean>;
  setDefaultShell(shellId: string): Promise<boolean>;
  check(profileId: string): Promise<boolean>;
  clearFailure(): void;
}

interface CliProfileDraft {
  mode: "create" | "edit";
  profileId: string | null;
  name: string;
  command: string;
  arguments: Array<{ key: string; value: string }>;
  shellId: string | null;
  icon: string;
  color: string;
  environment: CliEnvironmentDraft[];
}

interface CliEnvironmentDraft {
  key: string;
  name: string;
  value: string;
  isSecret: boolean;
  hasStoredValue: boolean;
  replaceStoredValue: boolean;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `snapshot` | Backend qua command | Thay toàn bộ theo revision; không ghi localStorage và không cache business state ngoài memory. |
| `status`, `failure`, `listenerFailed` | UI tạm thời | Mô tả lần đọc/operation gần nhất; lỗi được xóa khi retry thành công hoặc người dùng bắt đầu thao tác sửa liên quan. |
| `mutation` | UI tạm thời | Chặn hai persistent mutation bay cùng lúc; không chặn refresh do event. |
| `checkingProfileIds` | UI tạm thời | Set bất biến theo ID để chặn check lặp cùng row và render `Checking…`. |
| `CliProfileDraft` | UI tạm thời trong sheet | Không đưa vào Zustand/global store, localStorage, URL, log hoặc test snapshot chứa secret thật; xóa khi sheet đóng/unmount. |
| `hasStoredValue` | Backend metadata | Chỉ nói credential reference tồn tại; không chứng minh credential value còn đọc được. |
| `revision` | Backend runtime | Chỉ dùng trong lần chạy hiện tại; không persist. |

`buildCliProfileInput(draft)` áp dụng các quy tắc:

- Trim `name`, `command`, `icon`; lowercase `color`; không trim hoặc tách `arguments`.
- `shellId === null` được omit thành `shellId: undefined` theo generated binding.
- Non-secret luôn gửi `value`, kể cả chuỗi rỗng.
- Secret mới hoặc replace gửi plaintext `value`, kể cả empty string; secret đã lưu, không replace, cùng tên gửi `value: undefined` để backend giữ credential hiện tại.
- Không clone, stringify hoặc log payload sau khi dựng. Reference payload được thả sau promise settle; đóng sheet xóa draft value khỏi state theo best effort của JavaScript.

## Contract công khai của feature

```ts
// Nội dung mục Terminal & CLI Profiles, gắn vào `/settings/terminal-profiles`.
export function SettingsTerminalProfilesRoute(): JSX.Element
```

`src/app/` chỉ import route entry trên. Store, form helper, bảng, editor, dialog, fixture và error copy là nội bộ `src/features/settings/`. Feature khác không import chúng; `FE-006` gọi BE-006 qua wrapper/backend contract của chính nó thay vì dùng store nội bộ FE-013.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Startup check hoàn tất trước listener đăng ký | Lần `get_cli_profiles` sau registration lấy trạng thái mới nhất; không kẹt vĩnh viễn ở `Not checked`. |
| Event và mutation response tới ngược thứ tự | Revision guard chỉ cho snapshot bằng hoặc mới hơn thay state; response cũ không ghi đè dữ liệu mới. |
| Nhiều event tới khi refresh đang bay | Gộp thành tối đa một refresh tiếp theo; không tạo bão request. |
| Listener đăng ký xong sau khi route unmount | Gọi unlisten ngay; không giữ callback mồ côi. |
| `defaultShellId === "system"` | Select giữ `System default`; dòng phụ hiển thị tên và command của `effectiveDefaultShellId`, không tự đổi selected value sang shell concrete. |
| Shell persisted không còn trong catalog | Hiển thị lựa chọn read-only theo dạng `Unavailable: unknown-shell` để không nói dối state, yêu cầu người dùng chọn shell khả dụng; không tự ghi default mới. |
| Profile custom có `shellId === null` | Form chọn `Use default shell`; dòng phụ có thể hiện effective shell nhưng save vẫn omit `shellId`. |
| Command có khoảng trắng vì là absolute path | Hiển thị nguyên văn; không tách thành command + arguments. Validation chỉ từ chối chuỗi không phải bare name hoặc absolute path theo BE-006. |
| Argument chứa khoảng trắng, quote hoặc chuỗi rỗng | Giữ nguyên trong đúng một row và gửi đúng một mảng phần tử; không escape cho payload. |
| Người dùng nhập argument thứ 129 hoặc env thứ 65 | Nút Add bị khóa tại giới hạn; lỗi cục bộ nêu giới hạn, không gọi backend. |
| Hai env name chỉ khác hoa/thường | Đánh dấu cả hai row, chặn save và nêu tên phải unique không phân biệt hoa/thường. |
| Secret mới có empty value | Gửi `value: ""`; empty value hợp lệ theo BE-006. Chỉ trạng thái giữ secret cũ mới dùng `value: undefined`. |
| Secret đã lưu bị đổi tên | Coi là secret mới, bật replace và gửi value hiện tại kể cả empty string; không gửi `undefined` cho tên mới. |
| Người dùng tắt Secret rồi bật lại trước khi save | Giá trị đang nhập ở draft được giữ trong sheet; nếu quay về đúng tên secret đã lưu và chưa chọn replace, người dùng có thể chọn `Keep stored value` để xóa plaintext draft. |
| Credential đã bị xóa ngoài XWork | Danh sách vẫn có thể nói stored metadata; FE-013 không thử đọc. Lần launch của BE-007 báo lỗi; người dùng vào Edit, chọn Replace value và lưu secret mới. |
| Save profile có command không tồn tại | Save vẫn thành công; row chuyển `Not checked`, rồi thành `Command not found` sau background/event hoặc explicit Check. |
| Xóa profile được chọn ở session nhưng chưa launch | FE-013 không sửa session. BE-005/BE-006 trả lỗi rõ ở lần launch sau theo contract backend. |
| Xóa profile đang có terminal chạy | Terminal đang chạy không bị dừng; danh sách profile cập nhật sau commit. |
| Profile bị reset/import khi sheet dirty | Không silent overwrite; Save bị khóa và yêu cầu Reload. Nếu profile biến mất, sheet đóng và xóa secret draft. |
| Màu profile không đủ tương phản với nền hiện hành | Mark có border/fallback text và tên profile riêng; trạng thái và identity không dựa chỉ vào màu. |
| Timestamp không parse được | Bỏ dòng thời gian, vẫn hiển thị availability; không làm hỏng row. |
| Cửa sổ hẹp hoặc UI scale lớn | Bảng cuộn ngang trong vùng riêng; sheet chiếm `min(520px, 100vw)` và body cuộn dọc; trang không sinh thanh cuộn ngang toàn shell. |

## Tiêu chí hoàn thành

- [ ] `/settings/terminal-profiles` render `SettingsTerminalProfilesRoute` thay placeholder `FE-013`; breadcrumb vẫn là `Settings` / `Terminal & CLI Profiles` và sub-nav giữ đúng mục active.
- [ ] Trang hiển thị đúng default shell, ba built-in đúng thứ tự backend và custom profile đúng thứ tự snapshot; built-in không có Edit/Delete.
- [ ] Default shell giữ lựa chọn `system` trong khi hiện effective shell concrete, chỉ cho chọn catalog hợp lệ và rollback giao diện khi command lỗi.
- [ ] Mọi availability state `unchecked`, `available`, `commandNotFound`, `shellNotFound` cùng trạng thái đang check được render bằng chữ, không chỉ bằng màu, và có check lại bằng bàn phím.
- [ ] Tạo/sửa gửi command và từng argument ở field tách biệt; test chứng minh argument có space/quote/empty không bị tách, trim hoặc nối lại.
- [ ] Form thực thi toàn bộ giới hạn frontend tương ứng BE-006: name, command, 128 arguments/32 KiB, icon, lowercase color, 64 env rows, env name/value và duplicate case-insensitive.
- [ ] Shell override chỉ dùng ID concrete khả dụng; `Use default shell` omit `shellId` và không gửi command/path shell tự do.
- [ ] Secret đã lưu không xuất hiện trong DOM, log, error, state global hoặc output test; giữ secret gửi `value: undefined`, replace gửi value mới, đổi tên/tắt Secret bắt buộc value phù hợp.
- [ ] Save không bị chặn chỉ vì command chưa tìm thấy; status cập nhật qua snapshot/event sau save.
- [ ] Đóng editor dirty luôn qua `Discard profile changes?`; đóng sạch không hỏi; focus trap, restore focus và `Esc` hoạt động đúng.
- [ ] Xóa custom profile luôn qua xác nhận có nhãn `Delete Profile`, nêu đúng ảnh hưởng và không cho built-in đi vào flow.
- [ ] Store có đúng một listener cho consumer đầu, hủy ở consumer cuối, xử lý registration race, coalesce invalidation và không để revision cũ ghi đè snapshot mới.
- [ ] Mỗi backend code được phân loại đúng theo operation; validation đặt lỗi cạnh field khi có thể, lỗi credential không nhắc secret value, lỗi retry được giữ draft/snapshot committed.
- [ ] Mọi icon-only action có tooltip và accessible name; mọi field có label; lỗi dùng `aria-describedby`; status dùng `aria-live`; focus ring và độ tương phản đáp ứng `§18`.
- [ ] Mọi function, component, hook/helper, callback và test mới có comment ngắn; logic revision race và secret preservation có inline comment giải thích invariant.
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` và `pnpm build` pass trên Windows.
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` và `cargo test --manifest-path src-tauri/Cargo.toml` vẫn pass trên Windows.
- [ ] `pnpm tauri build` pass trên Windows; smoke thủ công xác nhận shell catalog thật, check Codex/Claude/Terminal, lưu/reload custom profile và secret round-trip qua Windows Credential Manager mà không hiện lại plaintext.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/settings/settings-terminal-profiles-route.test.tsx` | Component | Route content, default shell, built-in/custom order, empty/limit/loading/error/refresh, mọi availability state, row actions và accessibility. |
| `src/features/settings/cli-profile-editor.test.tsx` | Component | Create/edit sheet, focus, dirty-close confirmation, argument rows/order, shell/icon/color, environment Secret/Replace/Keep, save/check enablement và field errors. |
| `src/features/settings/delete-cli-profile-dialog.test.tsx` | Component | Nội dung ảnh hưởng, focus Cancel, nhãn `Delete Profile`, pending state, success, retryable failure, profile biến mất và restore focus. |
| `src/features/settings/cli-profile-form.test.ts` | Unit | DTO-to-draft, trim có chọn lọc, lowercase color, literal argument array, mọi giới hạn, duplicate env, giữ/replace/rename/tắt secret và payload không có plaintext cũ. |
| `src/features/settings/cli-profiles-store.test.ts` | Unit | Acquire/release, listener registration race, initial read, coalesced event refresh, decimal revision compare, stale response, mutation serialization, check set, error classification và reset test state. |
| `src/lib/ipc/cli-profiles.test.ts` | Unit | Sáu command dùng đúng tên/argument, `IpcCallError` giữ `CliProfilesError`, event trả payload typed và unlisten callback hoạt động. |
| `src/app/app-router.test.tsx` | Component | `/settings/terminal-profiles` render route thật, placeholder `FE-013` biến mất, breadcrumb/sub-nav vẫn đúng và error boundary route còn nguyên. |

Ngoài test tự động, smoke Windows dùng dữ liệu test riêng để xác nhận:

1. `System default`, PowerShell 7, Windows PowerShell và Command Prompt hiển thị đúng theo máy.
2. Check không chạy executable, profile thiếu command hiện `Command not found` và cài command xong có thể `Check command` thành `Available`.
3. Custom profile có argument chứa space vẫn giữ đúng từng phần sau khi đóng/mở ứng dụng.
4. Secret lưu được, reload chỉ hiện `Stored securely`, replace hoạt động và plaintext không xuất hiện trong DevTools/network console hoặc backup.
5. Xóa profile không dừng terminal đã chạy và profile biến mất khỏi lần chọn tiếp theo.

## Câu hỏi mở

Không có.
