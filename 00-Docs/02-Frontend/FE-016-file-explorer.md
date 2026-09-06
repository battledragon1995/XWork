# FE-016 — File Explorer

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-016` |
| Phase | `2`, lát cắt stage15 |
| Khu vực chính | `src/features/files/` |
| Yêu cầu chức năng | §11.1–11.2; liên quan §4.3, §7.4–7.5, §9.2, §14, §17.4, §18 và §20 Phase 2 |
| Wireframe | `00-Docs/01-Wireframe/05-Files.html#explorer` |
| Backend liên quan | `BE-013`; `BE-003` cho project invalidation/recovery; `BE-005` cung cấp ngữ cảnh phiên |
| Phụ thuộc | `FE-001`, `FE-004`, `FE-006`, `FE-007`; boundary maintenance của `FE-015` |

## Mục tiêu

Người dùng bật Explorer bên cạnh workspace của phiên, duyệt cây thật theo từng cấp, tìm/lọc basename trên toàn project, refresh, sao chép hai dạng đường dẫn và reveal entry bằng file manager. Stage15 hoàn tất phần duyệt; mở nội dung theo §11.2 chỉ được kích hoạt khi BE-014/FE-017 cung cấp read/watch/source viewer ở stage16.

### Quyết định và giả định đã chốt

- Người dùng ủy quyền tự chốt thiết kế stage15. Wireframe là trạng thái sản phẩm đích, không phải bằng chứng backend đã hỗ trợ mọi hành động vẽ trong menu.
- Một ô `Filter files` vừa tìm vừa lọc bằng `search_file_tree` trên toàn project. Không thêm bộ lọc extension/kind, fuzzy, glob hoặc lọc riêng các node đã tải. Kết quả phẳng có relative path để phân biệt basename trùng.
- Click, double-click hoặc Enter trên file chỉ chọn entry; không tạo tab/pane, không gọi reader, không mở ứng dụng ngoài và không ghi recent files. Explorer luôn có mô tả `File viewing is not available yet. You can copy paths or reveal files.`; chọn file đọc mô tả qua `aria-describedby`, kích hoạt bằng Enter/double-click thông báo lại qua live region. Không render menu `Open`, `Open in new tab`, `Open in empty pane`, `Split right and open` hoặc accelerator Enter/Ctrl+Enter như hành động mở. Đây là giới hạn có chủ đích của stage15, chưa hoàn thành §11.2 hoặc toàn Phase 2.
- Wireframe ghi `Ctrl B`, nhưng catalog BE-009 hiện hành chưa có action Explorer. Stage15 không sửa BE-009/binding, không thêm phím hardcode hoặc dòng Settings giả. Toggle có nút trực quan dùng được bằng Tab rồi Enter/Space. Phím điều hướng cây chỉ có hiệu lực trong Explorer.
- Explorer mặc định đóng mỗi lần vào route phiên. State thuộc lifetime route đang mount: giữ khi đổi tab hoặc bật/tắt Explorer trong cùng route; bỏ khi rời route, đổi session, xóa phiên, reset generation hoặc Quit. Không persist, không cache nhiều phiên/project. Đánh đổi: quay lại phiên phải mở lại Explorer; yêu cầu hiện tại không bắt buộc ghi nhớ Explorer xuyên route.
- Panel cố định 240px như bố cục phụ của wireframe, không thêm resize/persistence. Khi vùng phiên hẹp hơn 600px, panel đặt trên workspace, cao tối đa 40% vùng phiên và tự cuộn; không overlay terminal hoặc tự đóng. Không đổi cấu trúc/key của terminal khi toggle hay đổi bố cục.
- Hidden entries, ignore và link policy do BE-013 quyết định; UI không tự scan hoặc áp thêm ignore. Root caption `Project ignore rules applied`, không chỉ quảng bá `.gitignore` khi backend còn dùng `.ignore` và `.git/info/exclude`.

### Ngoài phạm vi

- Read/watch, source viewer, binary/large-file detection, Markdown edit/save, recent files, file picker trong pane và mở file từ Git/Command Palette. Không đăng ký event file giả hoặc polling filesystem.
- Tạo/đổi tên/di chuyển/xóa file, follow symlink/reparse, Git mutation, thiết kế API BE-014/FE-017 trước stage16.
- Thay schema, Rust, manifest/lockfile, capability, generated binding hoặc dependency. Không tạo plan, triển khai code, commit hay sửa historical plans trong lượt thiết kế này.

## File liên quan

Các file source/test sau là inventory cho implementation stage15; không phải chỉ thị triển khai trong lượt design. File đánh dấu dùng lại/đối chiếu không cần sửa. Không có migration hoặc đăng ký command Rust cần bổ sung.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/files/index.ts` | Export public Explorer và props/boundary |
| `src/features/files/file-explorer.tsx` | Panel, filter, trạng thái, menu entry, clipboard và focus |
| `src/features/files/file-explorer.test.tsx` | Component test UI, menu, bàn phím, clipboard và click không mở file |
| `src/features/files/file-tree.tsx` | Cây lazy, search list, pagination controls và roving focus |
| `src/features/files/file-tree.test.tsx` | Cây/list semantics, loading branch, focus, collapse và load more |
| `src/features/files/use-file-explorer.ts` | Snapshot, scheduler, invalidation, request generation và actions |
| `src/features/files/use-file-explorer.test.ts` | Async races, refresh/pagination/search/boundary và lifecycle |
| `src/features/files/file-error-copy.ts` | Mapping lỗi/warning sang English copy an toàn |
| `src/features/files/file-error-copy.test.ts` | Mọi code public, unknown transport và partial/truncation |
| `src/features/files/files-test-fixture.ts` | DTO thuần, deferred promises và identity giả; không tạo file thật |
| `src/lib/ipc/files.ts` | Bốn wrapper command BE-013 |
| `src/lib/ipc/files.test.ts` | Tên command, envelope, DTO/error, null cursor và void |
| `src/app/session-terminal-route.tsx` | Ghép public Files vào render slot Sessions, boundary Settings/Quit và recovery navigation |
| `src/app/session-terminal-route.test.tsx` | Composition, boundary tức thời và route recovery |
| `src/features/sessions/session-route.tsx` | Public render slot Explorer, toggle state, ghép cả phiên rỗng và có tab |
| `src/features/sessions/session-route.test.tsx` | Lifetime slot, toggle, phiên rỗng, đổi session và focus |
| `src/features/sessions/session-workspace.tsx` | Truyền toggle control vào tab strip, giữ terminal subtree ổn định |
| `src/features/sessions/session-workspace.test.tsx` | Toggle không gọi mutation/khởi động lại terminal; tab/maximize vẫn hoạt động |
| `src/features/sessions/session-tab-strip.tsx` | Nút Explorer trước Tab options |
| `src/features/sessions/session-tab-strip.test.tsx` | Nhãn, aria-expanded/controls, disable và không accelerator giả |
| `src/app/data-management-bridge.test.tsx` | Regression epoch/busy không remount app/terminal; response Files cũ bị loại |
| `src/features/projects/project-overview-route.test.tsx` | Regression không thêm Recent files/open Git trong stage15 |
| `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` | Regression catalog giữ nguyên, không quảng bá Ctrl+B |
| `src/lib/ipc/ipc-error.ts` | Dùng lại `invokeCommand` và `IpcCallError` |
| `src/lib/ipc/projects.ts` | Dùng lại `getProject`, `onProjectsChanged` |
| `src/bindings/files/files.ts` | DTO/error public đã sinh; chỉ import |
| `src/bindings/projects/projects.ts` | Project metadata và event public; chỉ import |
| `src/features/settings/data-management-provider.tsx` | Public `useDataManagement` cho app composition; dùng lại |
| `src/app/quit-store.ts` | App đọc Quit boundary; dùng lại |
| `src/components/ui/button.tsx` | Button source hiện có; dùng lại |
| `src/components/ui/input.tsx` | Filter input hiện có; dùng lại |
| `src/components/ui/tooltip.tsx` | Tooltip hiện có; dùng lại |
| `src/components/ui/dropdown-menu.tsx` | Menu primitive hiện có; dùng lại |
| `src-tauri/tests/files_tree_commands.rs` | Chạy lại integration BE-013 hiện có; không sửa |
| `src-tauri/tests/export_bindings.rs` | Kiểm binding drift hiện có; không sửa |

Tài liệu contract đồng bộ cùng FE016: `00-Docs/02-Frontend/FE-001-application-shell.md`, `00-Docs/02-Frontend/FE-005-project-overview.md`, `00-Docs/02-Frontend/FE-014-settings-keyboard-shortcuts.md`. Không cần sửa source Projects/Settings, router, app provider hoặc bridge production.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| Toggle thuộc Sessions | `Show File Explorer` / `Hide File Explorer`, `aria-expanded`, `aria-controls`; trước Tab options, ở header nếu phiên chưa có tab | `#explorer`, tabbar-right |
| `FileExplorer` | Complementary region tên `File Explorer`, filter, Refresh, Collapse all, Close; project name và ignore caption | `#explorer`, aside |
| `FileTree` | Root ngầm luôn mở, treeitem theo DTO; chỉ directory có chevron; search chuyển sang listbox phẳng | `#explorer`, tree-row |
| Menu entry | `Copy path`, `Copy relative path`, `Reveal in File Explorer` trên Windows; label `Reveal in Finder` trên macOS khi được kiểm chứng ở release | `#explorer`, context menu |
| Status/warning area | Kết quả chưa đầy đủ, lỗi, giới hạn stage15 và feedback clipboard; text wrap | Bổ sung trạng thái thật theo §18 |

App truyền platform từ nguồn app-info/shortcut hiện có, không suy từ user-agent. Khi platform chưa biết, nhãn trung tính `Reveal in file manager`; nút vẫn gọi command hẹp đã có. Dùng theme/cỡ chữ hiện tại, focus ring, tooltip cho icon, reduced-motion; không thêm animation/library. Path dài ellipsis có tooltip đầy đủ, không dùng HTML từ basename.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đóng | Chưa bật/đã ẩn | Không query cây/search; nội dung panel không nằm trong tab order |
| Tải root | Chưa có root page | `Loading files…`, aria-busy; filter/Close vẫn dùng được |
| Tải branch/page | Expand hoặc Load more | Spinner cục bộ `Loading folder…`; không thay toàn workspace bằng skeleton |
| Rỗng | Root hoặc directory không có entry, không còn cursor | `No visible files in this folder.` và Refresh; có warning thì vẫn hiển thị warning |
| Tìm | Query hợp lệ đang debounce/in-flight | `Searching files…`; bỏ kết quả query cũ khỏi vùng tương tác |
| Không match | Response hiện hành có 0 match | `No matching files.` và `Clear filter`; nếu partial không khẳng định toàn project rỗng |
| Partial | warningCount > 0 | `Some entries could not be listed.`; Details liệt kê reason/relative directory của response, root dùng project name |
| Truncated | truncatedReason khác null | `Showing up to 200 matches. Narrow your filter.`, hoặc `Search limit reached. Results may be incomplete.`, hoặc `Some folders are too deep to search.` theo reason |
| Refresh lỗi | Cùng root/generation có snapshot cũ | Giữ snapshot với `Files may be out of date.` và Retry; action path vẫn revalidate qua Rust |
| Project unavailable | Metadata/command xác nhận unavailable | Bỏ dữ liệu cây, `Project folder is unavailable.`; `Open project` đến recovery FE-004/FE-005 và Retry |
| Suspended | Data busy/Quit/removal | Đóng menu, khóa query/action; `File Explorer is temporarily unavailable.` nếu panel còn hiển thị |
| Giới hạn rendering | Đạt cap frontend dưới đây | `Explorer display limit reached. Collapse folders or use Filter files.`; không giả vờ hết entry |

Warning details hiển thị tối đa danh sách backend cung cấp (20), tổng `warningCount` và `warningsTruncated` khi còn issue. Không cộng warningCount của nhiều page như số issue duy nhất vì scan có thể lặp issue; báo theo directory/page gần nhất và ghi rõ phạm vi. Search dùng warning của response search riêng. Mọi feedback đọc qua polite live region, lỗi hành động dùng alert; không spam từng node.

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Show/Hide/Close | Mở tải root nếu cần, focus filter; đóng từ trong panel trả focus toggle nếu còn tồn tại | Tab, Enter/Space trên nút |
| Chọn directory trong cây | Click nhãn/chevron hoặc Enter toggle đúng một lần; mở mới gọi list children, thu gọn bỏ descendants khỏi focus | Right mở/đi con; Left đóng/đi cha |
| Di chuyển cây | Focus không tự gọi IPC trừ Right mở branch; selection tách focus | Up/Down, Home/End; Space chọn |
| Chọn file/link/other | Chọn row; leaf không expand; file không mở nội dung | Enter/Space; không có Ctrl+Enter |
| Nhập Filter files | Debounce 250ms sau compositionend; trim và validate, gọi search toàn project | Escape khi input có text: clear |
| Clear filter | Bỏ search, trở lại cây đã tải và expansion trước tìm kiếm | Escape ở input hoặc nút Clear filter |
| Directory trong search | Chọn như một kết quả phẳng, không expand/clear query ngầm | Enter/Space chọn; muốn duyệt dùng Clear filter |
| Refresh | Tải lại view hiện hành theo quy tắc bên dưới | Tab đến Refresh, Enter/Space; không chiếm F5 |
| Collapse all | Đóng tất cả folder, bỏ cache descendants; root page giữ; disabled trong search | Nút Collapse all |
| Load more | Nối một page của directory bằng cursor opaque; không tự tải hết | Nút `Load more in {directory}` |
| Menu | Right-click chọn row rồi mở menu; cùng menu qua nút `Actions for {name}` | Shift+F10 trên row; Escape đóng/trả focus |
| Copy path/relative path | Lấy path mới rồi clipboard đúng field; báo `Path copied.` / `Relative path copied.` chỉ sau writeText resolve | Menu bằng bàn phím |
| Reveal | Gọi Rust đúng một lần; leaf symbolicLink disabled với `Symbolic links cannot be revealed.` | Menu bằng bàn phím |

Tree có `role=tree`, treeitem với aria-level/selected, aria-expanded chỉ cho directory, group children và một roving tabindex. Pagination/retry là button riêng ngoài treeitem (hoặc trong vùng điều khiển sibling), không giả làm file; Tab tới được tất cả control. Search dùng listbox/option với Up/Down/Home/End và roving focus, menu trigger là control ngoài option của entry được chọn. Nút menu hiển thị khi hover/focus hoặc có selection. Empty tree/list vẫn có focus target và nhãn rõ ràng. Collapse node đang chứa focus đưa focus về cha; sau refresh mất entry đưa focus đến ancestor còn tồn tại hoặc container. Không đưa focus về toggle nếu route đổi, maintenance hoặc Quit đang quản lý focus.

## Luồng chính

1. SessionRoute chỉ cấp slot sau khi summary thật khớp route sessionId. App ghép Files bằng projectId từ summary, không dùng crumb hoặc root string để suy identity. Phiên chưa có tab cũng bật Explorer được, không tạo tab tool-selection để chứa cây.
2. Khi mở, Files subscribe `projects://changed`, đọc `getProject` rồi list root `directory: "", cursor: null`. Listener phải attach trước snapshot; event trong bootstrap đánh dấu snapshot cần đọc lại. Lỗi attach báo không thể theo dõi thay đổi project và Retry, không tuyên bố live invalidation đã sẵn sàng.
3. Expand tải đúng directory, page tối đa 500; giữ thứ tự backend (directory, file, symbolicLink, other rồi sort backend), không locale-sort lại. Append deduplicate bằng exact relativePath, không case-fold identity trên frontend. Nếu entry trùng, dùng DTO từ page mới ở vị trí cũ. Không parse/sửa cursor.
4. Không prefetch đệ quy; một request list cho mỗi directory tại một thời điểm, tối đa hai list/search in-flight cho instance kể cả request đã obsolete. Queue chỉ giữ request còn hữu ích; search giữ tối đa một query mới nhất đang chờ. Không hứa abort IPC đã gửi, nhưng response cũ không publish. Search mới chờ scan cũ hoàn tất thay vì dồn request vào Rust semaphore.
5. Filter trim thành 1–128 Unicode scalar, không control character. Không dùng string.length UTF-16 làm scalar count; backend validation là cuối. Invalid input không gọi search, báo `Use 1–128 characters without control characters.`, bỏ search cũ và hiện cây thường như BE-013; empty/whitespace clear search không báo lỗi. Kết quả giữ thứ tự backend, tối đa 200, không có pagination giả.
6. Refresh trong tree tăng generation, bỏ mọi cursor, chụp expansion đang mở và reload root page đầu rồi branch còn visible theo cha trước con. Chỉ tải page đầu của mỗi branch; nếu folder từng mở nằm ở page root chưa load thì chờ người dùng Load more, không tự scan hết ancestor để phục hồi. Bỏ cache collapsed và subtree không còn visible. Branch lỗi độc lập không chặn siblings. Refresh trong search gọi lại query hợp lệ hiện hành, đồng thời đánh dấu cây cũ cần refresh khi Clear filter. Double-click Refresh coalesce một lần làm mới kế tiếp, không tạo vòng tự retry.
7. Cap frontend 5.000 entry cây retained trên một route; search cache riêng tối đa 200. Collapse giải phóng descendants. Chỉ nhận page nguyên vẹn nếu tổng sau deduplicate không vượt cap; nếu vượt giữ cursor cũ, hiện giới hạn và cho Collapse all/filter thay vì cắt page rồi làm mất entry. Queue generation cũ bị bỏ; cap không thay giới hạn backend và không đòi thư viện virtualization mới.
8. Đóng panel hủy debounce/queue, tăng token, đóng menu, bỏ tree/search snapshots; giữ query/expansion intent trong route. Mở lại luôn đọc project và root mới, chỉ phục hồi branch đã được nhìn thấy như Refresh; query hợp lệ thì search lại. Unmount/đổi session bỏ cả intent, listener late-resolve phải unlisten ngay. Không background scan/poll khi ẩn.
9. Copy/reveal chỉ lấy relativePath từ DTO đã chọn. Single-flight chung cho action để double click không gọi hai lần. Copy dùng `navigator.clipboard.writeText` như Projects hiện hành sau `get_file_entry_paths`; không join root, không cache absolutePath, không plugin clipboard. Recheck boundary sau await và ngay trước writeText; clipboard từ chối/missing báo `Could not copy path. Try again.`. Không báo thành công bằng optimistic toast. Reveal lỗi không auto-replay; call đã gửi có thể mở OS window dù route đóng, UI không thể rollback.

### Invalidation và lifecycle

- Mỗi completion kiểm sessionId, projectId, lifetime, generation, request token và `readBoundary()` đồng bộ trước publish hoặc side effect tiếp theo. Query còn phải khớp normalized query; page phải khớp directory/cursor request. Props chưa render lại không được mở cửa cho callback cũ.
- App boundary dùng `busy`, `invalidationEpoch`, `getCurrent()` của DataManagement và Quit phase giống HomeEntry: suspended khi busy hoặc Quit khác `idle`/`snapshot-failed`. Epoch đổi xóa tất cả snapshot/selection/menu/query/expansion; suspended chặn thao tác tức thời và invalidate in-flight. Resume query mới khi panel mở, không replay copy/reveal. Không remount toàn app hay terminal để clear Files.
- Event Projects đúng projectId invalidate ngay tree/search/selection và pending copy, rồi re-read metadata; vì event `updated` không nêu field đã đổi, dùng invalidation bảo thủ kể cả rename/pin. Removed bỏ panel và gọi recovery tới `/projects`. Unavailable/removal không dùng stale data. Event project khác không ảnh hưởng.
- Refresh và mở lại đọc metadata; rootPath thay đổi làm bỏ intent/cache cũ. RootPath chỉ là tín hiệu UI, không là authority filesystem. Backend không trả root identity xuyên page; không hứa snapshot nguyên tử khi có external rename/locate hay event bị mất. Backend revalidate mỗi call, UI cho Refresh để hội tụ; không bổ sung version DTO giả.
- `projectRootChanged` bỏ toàn bộ data rồi re-read project/root một lần; lỗi lặp dừng ở Retry. `projectRemovalInProgress` chờ event, Retry đọc project thủ công nếu event bị mất; không polling. ProjectNotFound recovery dùng replace; unavailable mở overview bằng hành động người dùng để Locate/Remove qua owner sẵn có.

## Contract với backend

### Command sử dụng

DTO import từ `src/bindings/files/files.ts`. Envelope luôn `{ request }`; struct camelCase nhưng error payload giữ `project_id`/`relative_path` như binding. Wrapper dùng `invokeCommand<TResult, FilesError>`, reject `IpcCallError<FilesError>`; không tự đổi union/code.

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `list_file_children` | `ListFileChildrenRequestDto` | `FileTreePageDto` | Project/window/path, cursor, directory/link/read/limit/root errors bên dưới |
| `search_file_tree` | `SearchFileTreeRequestDto` | `FileTreeSearchDto` | Project/window, invalidSearch, read/root errors |
| `get_file_entry_paths` | `FileEntryRequestDto` | `FileEntryPathsDto` | Project/window/path, entry visibility, read/root errors |
| `reveal_file_entry` | `FileEntryRequestDto` | `void` (Rust unit) | Project/window/path, entry visibility, link/read/root/reveal errors |

```ts
/** Read one page of visible direct children. */
export function listFileChildren(request: ListFileChildrenRequestDto): Promise<FileTreePageDto>;
/** Search visible basenames across the registered project. */
export function searchFileTree(request: SearchFileTreeRequestDto): Promise<FileTreeSearchDto>;
/** Resolve freshly validated copyable paths. */
export function getFileEntryPaths(request: FileEntryRequestDto): Promise<FileEntryPathsDto>;
/** Reveal a validated entry through the backend. */
export function revealFileEntry(request: FileEntryRequestDto): Promise<void>;
```

| Lỗi | Phản hồi và recovery |
|---|---|
| `windowNotAllowed` | `File Explorer is only available in the main window.`; không retry |
| `invalidProjectId` | `Could not identify this project.`; bỏ dữ liệu, Open projects; không gửi lại ID lỗi |
| `projectNotFound` | Retire panel; app replace `/projects` khi boundary còn hợp lệ |
| `projectUnavailable` | Banner unavailable, Open project/Retry |
| `projectRemovalInProgress` | Khóa panel, chờ event hoặc Retry đọc project |
| `projectAccessFailed` | `Could not load this project.`; Retry read |
| `projectRootChanged` | `Project folder changed. Reloading files…`; một recovery read rồi Retry thủ công nếu tiếp tục lỗi |
| `invalidRelativePath` | `This entry cannot be accessed.`; bỏ selection, refresh parent; không replay cùng input |
| `invalidSearch` | Validation cạnh filter, hiện cây thường; giữ text để sửa |
| `invalidCursor` | Bỏ pagination branch, `Folder contents changed. Reloading…`; một read cursor null; không loop |
| `entryNotFound`, `entryNotVisible` | `This entry is no longer available.`; bỏ row/subtree/selection và refresh parent một lần; search thì query lại một lần |
| `notDirectory` | Thu gọn/bỏ descendants, `This entry is no longer a folder.`; refresh parent |
| `linkTraversalDenied` | `Symbolic links cannot be expanded or revealed.`; ngừng expand/reveal, refresh parent để lấy kind thật; không tự đổi DTO kind |
| `traversalLimitExceeded` | `This folder is too large to list. Use Filter files or open the project folder.`; recovery qua Open project, không retry loop |
| `fileSystemReadFailed` | `Could not read this folder.` hoặc `Could not search files.`; Retry; chỉ giữ stale data cùng generation/root |
| `revealFailed` | `Could not reveal this entry. Try again or copy its path.`; giữ selection, retry thủ công |
| Unknown code/transport | `Could not complete this file action. Try again.`; không raw exception/path/cursor, không auto-repeat side effect |

Unknown/failed `getProject` bỏ metadata/cây thay vì đoán root. Warning reasons `unreadableEntry`, `invalidIgnoreRule`, `unsupportedName` lần lượt giải thích không đọc được một số entry, một số ignore rule không hợp lệ, một số tên không được hỗ trợ. Ignored file hợp lệ không tạo warning. Link được copy lexical path, không reveal; `other` là leaf, copy/reveal qua cùng backend validation, không mở nội dung.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `projects://changed` qua `onProjectsChanged` | `ProjectChangedEventDto` từ binding Projects | Trong lifetime Explorer mở | Invalidate đúng project, re-read metadata; removed recovery |
| App boundary props/readBoundary | Epoch/suspended UI, không phải event Rust | Data/Quit đổi | Retire hoặc suspend như trên |

BE-013 không có event/channel. Không subscribe `files://changed`, watch hoặc terminal output. Listener Projects cleanup kể cả đăng ký resolve muộn; app không nhân đôi listener Data/Quit cho Files.

## State frontend

```ts
/** Describe one project-scoped transient directory snapshot. */
interface FileBranchState {
  entries: FileTreeEntryDto[];
  nextCursor: string | null;
  status: "idle" | "loading" | "ready" | "error";
  stale: boolean;
  lastPage: FileTreePageDto | null;
  error: IpcCallError<FilesError> | null;
}
/** Describe transient Explorer data for the mounted route only. */
interface FileExplorerState {
  project: ProjectDto | null;
  generation: number;
  query: string;
  expanded: Set<string>;
  branches: Map<string, FileBranchState>;
  search: FileTreeSearchDto | null;
  searchStatus: "idle" | "loading" | "ready" | "error";
  selectedPath: string | null;
  focusedPath: string | null;
  pendingAction: "copyAbsolute" | "copyRelative" | "reveal" | null;
  /** Replace the draft and schedule only the latest valid query. */
  setQuery(query: string): void;
  /** Toggle one real directory without eagerly traversing descendants. */
  toggleDirectory(relativePath: string): void;
  /** Request one additional page for a visible directory. */
  loadMore(directory: string): void;
  /** Reload the current view with fresh cursors and generation. */
  refresh(): void;
  /** Release descendants and return focus to the root-level view. */
  collapseAll(): void;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Visible/toggle | SessionRoute UI | Một state xuyên nhánh empty/workspace; route lifetime, không settings |
| Entries/pages/search | Backend qua command | Snapshot tạm, cap 5.000/200, không authority/persistence |
| Project metadata | BE-003 query | Không lấy root từ user text hoặc crumb; không dùng openProject để refresh vì có side effect recent project |
| Expansion/query/focus/menu | UI tạm thời | Không gửi expansion vào Rust hoặc giữ absolutePath |
| Generation/tokens/queue | Hook UI | Ref/coordinator nội bộ; request cũ không publish; không cần global store |

`lastPage.entries` tham chiếu page đã nhận, không sao chép thêm cây. Feedback/menu anchor/error search và in-flight token là UI local trong component/hook; không public export state hoặc scheduler. Mọi async callback bắt rejection, luôn nhả pending trong lifetime hiện hành, không để unhandled promise.

## Contract công khai của feature

```ts
/** Identify whether the current application generation accepts work. */
export interface FileExplorerBoundary {
  epoch: number;
  suspended: boolean;
}
/** Supply only route identity and application-owned recovery callbacks. */
export interface FileExplorerProps {
  sessionId: string;
  projectId: string;
  isVisible: boolean;
  regionId: string;
  platform: "windows" | "macos" | null;
  boundary: FileExplorerBoundary;
  /** Read live owners before dispatch and completion. */
  readBoundary(): FileExplorerBoundary;
  /** Close the panel and restore focus through its owning toggle. */
  onClose(): void;
  /** Navigate to the owning project recovery screen. */
  onOpenProject(): void;
  /** Leave a removed project without retaining its session route. */
  onProjectMissing(): void;
}
/** Render a project-scoped Explorer without creating file panes. */
export function FileExplorer(props: FileExplorerProps): React.JSX.Element;
```

Chỉ app import public `src/features/files/index.ts`; Files không import Sessions/Settings/Projects implementation. Slot public bổ sung tại `src/features/sessions/session-route.tsx` theo pattern `renderTerminal` đã có:

```ts
/** Supply the minimal session-owned Explorer placement context. */
export interface SessionFileExplorerSlotProps {
  sessionId: string;
  projectId: string;
  isVisible: boolean;
  regionId: string;
  /** Close through the same toggle owner used by the tab strip. */
  onClose(): void;
}
/** Compose Files at the application boundary without a feature dependency. */
export type SessionFileExplorerRenderer = (props: SessionFileExplorerSlotProps) => React.ReactNode;
```

SessionRoute thêm optional `renderFileExplorer?: SessionFileExplorerRenderer`; không có renderer thì không render toggle. App giữ renderer identity ổn định, cấp boundary/platform/callback ở composition. Slot tồn tại ổn định ở cùng vị trí ngoài nhánh empty/workspace, nhận isVisible=false khi đóng để Files tự giải phóng snapshot; không key theo isVisible, activeTabId, revision hoặc epoch. Khi sessionId/projectId đổi phải retire trước khi render dữ liệu.

Sessions sở hữu một toggle button có ref, dùng ReactNode `fileExplorerToggle?: React.ReactNode` truyền qua SessionWorkspace tới SessionTabStrip và đặt tại header nhánh empty. Disable khi lifecycle/close dialog đang pending theo guard Sessions; Files nhận suspended app boundary riêng. Không thay contract terminal render slot, observed session hoặc mutation tab/pane. Header/tabstrip chuyển nhánh dùng toggle ref hiện còn sống để khôi phục focus.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Search A chậm hơn B, IME gõ liên tục | A không xuất hiện dưới text B; chỉ latest pending query chạy, composition chưa kết thúc không scan |
| Refresh trong khi Load more đang trả về | Page cũ không nối vào root/branch generation mới |
| Collapse trong lúc children đang tải | Không tự mở lại; response bị bỏ, capacity chỉ nhả khi IPC kết thúc |
| Folder biến mất/đổi thành file hoặc bị ignore | Bỏ subtree và selection stale, phục hồi focus; không giữ descendants giả |
| Thay `.gitignore` ngoài ứng dụng | Refresh dựng matcher mới; không hứa tự cập nhật khi chưa có watcher |
| Hai session cùng project | Không chia cache ngầm; route mới bắt đầu đóng, không reuse selection/cursor phiên trước |
| Root thay cùng relativePath | Event/metadata/boundary loại response cũ; action đã gửi vẫn theo current-root validation BE-013, không hứa identity xuyên command |
| Clipboard/reveal đang pending rồi reset/đổi route | Không publish feedback hoặc clipboard bước kế tiếp; reveal đã gửi không thể thu hồi |
| Tab/pane đang chạy hoặc maximized | Toggle không create/split/setActivePane; terminal chỉ nhận resize layout hiện có, không restart |
| Mở filter trả partial 0 match | Vẫn có warning/truncation, không khẳng định project không có file |
| UTF-8, case, emoji, path dài | Dùng DTO exact; render text an toàn; name không lossless đã được backend skip/warn |
| Session/project bị xóa khi Explorer focus | App/Sessions recovery, không restore focus vào DOM đã unmount |

## Tiêu chí hoàn thành

- [ ] Bật/tắt được ở phiên rỗng và có tab; giữ terminal instance, route và close-impact hiện có.
- [ ] Chỉ root và folder đã mở được list; pagination thật 500, cap UI và Load more rõ ràng; không auto-traverse toàn cây.
- [ ] Filter gọi search thật, scalar validation/IME/debounce/latest-query đúng; warning/truncation/empty không bị giấu.
- [ ] Refresh bỏ cursor, cha trước con, thấy thay đổi file/ignore; race không trộn generation và root cũ.
- [ ] Copy hai field đúng từ command mới, clipboard failure không success giả; reveal qua Rust, link bị chặn, không truy cập file trực tiếp từ webview.
- [ ] Click/Enter/double-click file không tạo tab/pane, recent hoặc external open; menu và copy giới hạn stage15 rõ ràng.
- [ ] Không thêm Ctrl+B, action BE-009, file search Palette, Recent files hoặc activation Git trong stage15.
- [ ] Loading/empty/error/partial/unavailable, menu/focus/tree/list keyboard, tooltip, theme/cỡ chữ/reduced-motion được component test.
- [ ] Epoch/busy/Quit, removal/root update, unmount/late listener và obsolete response được test, không remount toàn app/terminal.
- [ ] Khi implementation: Windows chạy `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`; Rustfmt, Clippy all-targets/all-features với warnings denied, Rust tests all-targets/all-features; `pnpm tauri build` vì ghép IPC/native reveal vào UI.
- [ ] Smoke Windows WebView2 trong profile/app-data dành riêng kiểm layout, keyboard/IME, clipboard thật, reveal file/folder và terminal resize khi toggle. Chỉ dùng project fixture/temp folder; không đọc/ghi file hoặc profile người dùng thật. Không desktop E2E tự động; macOS hoãn tới release.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/lib/ipc/files.test.ts` | Contract | Bốn command/envelope, generated code/field casing, cursor null và void/error |
| `src/features/files/use-file-explorer.test.ts` | Unit/hook | Lazy, paging/dedup/cap, queue ≤2, latest-search, refresh/collapse/visibility, project events, epoch và async race |
| `src/features/files/file-tree.test.tsx` | Component | Tree/list semantics, pagination/retry keyboard, selection/focus repair, link leaf |
| `src/features/files/file-explorer.test.tsx` | Component | Filter IME, state/warnings, actions, clipboard failures, no fake open, stale action suppression |
| `src/features/files/file-error-copy.test.ts` | Unit | Toàn bộ union FilesError, unknown safe copy và warning/truncation mapping |
| `src/app/session-terminal-route.test.tsx` | Component | App slot identity, live boundary trước effect, project recovery route và platform |
| `src/features/sessions/session-route.test.tsx` | Component | Empty/nonempty slot, default closed, session switch, focus và disposal |
| `src/features/sessions/session-workspace.test.tsx` | Component | Toggle giữ instance terminal, không mutation tab/pane, close/maximize regression |
| `src/features/sessions/session-tab-strip.test.tsx` | Component | Toggle position, tooltip/aria, disabled guard, không Ctrl+B |
| `src/app/data-management-bridge.test.tsx` | Component | Busy/reset epoch retire Files, không remount app/terminal |
| `src/features/projects/project-overview-route.test.tsx` | Component | Git còn read-only, Recent files chưa xuất hiện |
| `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` | Component | Catalog/availability hiện hành không thêm Explorer shortcut |
| `src-tauri/tests/files_tree_commands.rs` | Integration hiện có | Public tree/search/path/reveal backend trong temp fixture, native adapter giả |
| `src-tauri/tests/export_bindings.rs` | Contract hiện có | Binding public không drift |

Frontend mock IPC, Projects events và clipboard; không real filesystem/profile, không native reveal trong automated test. Tất cả function/callback/helper/test khi implementation có comment mục đích bằng English theo AGENTS.md.

Thiết kế này chưa chạy implementation gates hoặc native smoke. Kết quả BE013 do người dùng cung cấp (498 Rust, 2.000 FE, Tauri passed) là baseline, không được ghi thành kết quả FE016. Mọi native smoke/metrics prior còn pending giữ nguyên; chỉ đánh dấu pass khi có bằng chứng kiểm tra riêng, không sửa historical plans.

## Câu hỏi mở

Không có.
