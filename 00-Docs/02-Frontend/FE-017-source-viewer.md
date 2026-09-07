# FE-017 — Source viewer

Tài liệu này đặc tả frontend mở file project vào pane và hiển thị nội dung source/text ở chế độ chỉ đọc, kèm trạng thái file binary hoặc vượt giới hạn viewer. Mọi lần đọc, phân loại và theo dõi thay đổi đều do `BE-014` quyết định; frontend chỉ render snapshot handle, gọi command hẹp và không tự chạm filesystem.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-017` |
| Phase | `2`, lát cắt stage16 |
| Khu vực chính | `src/features/files/` |
| Yêu cầu chức năng | §11.2; liên quan §9.1–9.2, §11.1, §17.2, §18 và §20 Phase 2 |
| Wireframe | `00-Docs/01-Wireframe/05-Files.html#source`, `00-Docs/01-Wireframe/05-Files.html#unsupported`; ngữ cảnh `05-Files.html#explorer` và `04-Projects.html#panes-1`, `#panes-2`, `#pane-picker` |
| Backend liên quan | `BE-014`; `BE-005` cho tab/pane runtime, `BE-013` cho path policy và copy path, `BE-003` cho project identity, `BE-008` cho token Appearance |
| Phụ thuộc | `FE-001`, `FE-006`, `FE-007`, `FE-012`, `FE-016` |

## Mục tiêu

Người dùng mở một file trong project từ File Explorer và đọc nội dung ngay trong pane của phiên: source/text hiển thị chỉ đọc, có số dòng, tô màu cú pháp và thanh trạng thái nêu ngôn ngữ, encoding, kiểu xuống dòng, số dòng. File binary hoặc vượt giới hạn viewer vẫn chiếm một pane nhưng nêu rõ lý do kèm hai lối thoát là mở bằng ứng dụng mặc định và sao chép đường dẫn. File bị sửa ngoài XWork được nạp lại tự động vì handle read-only không bao giờ bẩn.

### Quyết định và giả định đã chốt

- Người dùng đã chốt bốn lựa chọn phạm vi cho lát cắt này: FE-017 gồm cả đường mở file từ File Explorer; file `.md`/`.markdown` mở read-only trong cùng viewer; tô màu bằng CodeMirror 6 với bộ ngôn ngữ rộng nạp động; đầu pane dùng slot render hai vùng để khớp wireframe.
- `FE-016` cố ý khóa hành vi mở ở stage15 (`VIEWING_LIMITATION`, click chỉ chọn, không có menu `Open`). Lát cắt này gỡ đúng giới hạn đó theo §11.2, không mở rộng thêm thao tác nào khác của Explorer.
- Bấm chuột hoặc `Enter` trên một entry `file` mở file vào **tab mới**, đúng câu "Bấm file mặc định mở file trong một tab mới" của §11.2. `Space` giữ nguyên nghĩa chỉ chọn để di chuyển bằng bàn phím không tạo tab ngoài ý muốn. Directory, `symbolicLink` và `other` không có hành động mở.
- Menu phụ của entry `file` thêm bốn mục mở: `Open in new tab`, `Open in empty pane`, `Split right and open`, `Split down and open`. Sessions quyết định mục nào khả dụng; Files không tự đọc layout.
- Không đăng ký phím tắt toàn ứng dụng mới. Catalog của `BE-009` không đổi, nên mọi accelerator ở đây là phím cục bộ trong widget (`Enter`, `Space`, `Shift+F10`) đúng tiền lệ `FE-016`.
- `useWorkspaceMutations` được nâng từ `SessionWorkspace` lên `SessionRoute`. Đây là điều kiện bắt buộc: Explorer nằm ngoài `SessionWorkspace` nhưng phải dùng chung đúng một mutation slot với thanh tab, và phiên chưa có tab nào vẫn phải mở được file bằng cách tạo tab đầu tiên.
- `open_file_in_pane` không trả `SessionDetailDto`. Sau khi attach thành công, Files gọi `onFileOpened()` để Sessions đọc lại snapshot; không chỉ dựa vào event `sessions://runtime-changed` vì listener có thể đăng ký hỏng.
- Handle read-only không bao giờ bẩn nên `ExternalConflict`, `resolve_external_file_change` và mọi cảnh báo chưa lưu không thuộc lát cắt này. Nếu snapshot vẫn trả `externalConflict`, viewer render một trạng thái phòng thủ thay vì giả vờ không có gì xảy ra.
- Nội dung `text` với `mode: "markdown"` hiển thị y hệt source read-only. Không có công tắc `Edit`/`Preview`, không render Markdown, chỉ thêm một ghi chú ở thanh trạng thái rằng sửa và xem trước thuộc lượt sau.
- Viewer dùng token `--terminal-background`, `--terminal-foreground`, `--terminal-font-size` và `--terminal-ansi-0..15` mà `appearance-theme.ts` đã ghi. Nhờ vậy bề mặt code khớp wireframe, đổi theo Appearance của `FE-012` và thừa hưởng luôn cảnh báo tương phản sẵn có; không thêm bảng màu riêng.
- `lineCount`, `byteSize`, `lineEnding`, `encoding`, `hasUtf8Bom`, `mimeType`, `syntaxHint` hiển thị nguyên giá trị backend. Frontend không tự đếm dòng, không đoán ngôn ngữ từ nội dung và không đoán text/binary từ MIME. Riêng `lineCount`, phần mô tả DTO và business rule 8 của `BE-014` diễn đạt hơi lệch nhau, nên frontend chỉ in giá trị nhận được và không suy ra công thức nào.
- File không có phần mở rộng (`syntaxHint` là `null`) hiển thị text thuần có số dòng. Không suy ngôn ngữ từ basename như `Makefile` hay `Dockerfile`.
- Snapshot handle được giữ trong một registry cấp ứng dụng giống `TerminalRegistry`, để hai vùng render của cùng một pane đọc chung một snapshot và đổi tab không phải gọi lại backend.

### Ngoài phạm vi

- Sửa, lưu, `Edit`/`Preview` Markdown, chỉ báo chưa lưu và hộp thoại xung đột (`FE-018`, `BE-015`).
- Danh sách file mở gần đây trên Project Overview và command `list_recent_files` (`FE-005`).
- Bật file target trong Command Palette; `search-entry.tsx` giữ nguyên nhánh từ chối hiện có (`FE-009`).
- Cột `File` đầy đủ của pane picker với file gần đây và `Browse files…`; lát cắt này chỉ sửa một dòng chờ đã sai sự thật.
- Tìm trong file, đi tới dòng, gấp code, minimap, blame, diff, LSP và mọi thao tác ghi file.
- Tạo/đổi tên/di chuyển/xóa file, thay đổi ignore rule, và mọi thay đổi Rust, migration, capability hoặc binding sinh tự động.

## File liên quan

| Đường dẫn | Vai trò trong feature |
|---|---|
| `package.json` | Khai báo dependency CodeMirror 6 và language pack; khóa exact version theo quy tắc TechStack |
| `pnpm-lock.yaml` | Khóa cây dependency frontend sau khi cập nhật manifest |
| `src/features/files/index.ts` | Public export của Files: Explorer, `FilePane`, provider registry và boundary maintenance |
| `src/features/files/file-explorer.tsx` | Bốn mục menu mở file, kích hoạt bằng click/`Enter`, trạng thái đang mở và thông báo; bỏ dòng giới hạn stage15 |
| `src/features/files/file-explorer.test.tsx` | Menu mở, disable theo placement, click/`Enter` mở tab mới, `Space` chỉ chọn, lỗi và thông báo |
| `src/features/files/file-tree.tsx` | Tách sự kiện kích hoạt khỏi chọn cho row `file`; giữ nguyên roving focus và pagination |
| `src/features/files/file-tree.test.tsx` | `Enter`/double-click phát kích hoạt, `Space` không phát, directory không có kích hoạt mở |
| `src/features/files/use-file-explorer.ts` | Action `open(entry, placement)`: xin pane, gọi `open_file_in_pane`, single-flight, xử lý lỗi và invalidation |
| `src/features/files/use-file-explorer.test.ts` | Race mở file, boundary sau await, lỗi pane/path, warning recent, không mở hai lần |
| `src/features/files/file-error-copy.ts` | Copy lỗi Files dùng chung, nhãn placement, copy trạng thái viewer; bỏ `VIEWING_LIMITATION` |
| `src/features/files/file-error-copy.test.ts` | Mọi code public, transport lạ, copy viewer và nhãn placement |
| `src/features/files/file-handle-registry.ts` | Sở hữu snapshot handle theo `fileHandleId`: query, event, refcount, reload, mở ngoài, copy path, vị trí cuộn, boundary reset |
| `src/features/files/file-handle-registry.test.ts` | Single-flight query, coalesce event theo revision, refcount/evict, `fileHandleNotFound`, reset và reconcile |
| `src/features/files/file-handle-context.ts` | Context registry, `useFileHandleRegistry`, `useFileDataBoundary` |
| `src/features/files/file-handle-provider.tsx` | Mount registry đúng một lần và bật/tắt subscription `files://handle-changed` |
| `src/features/files/file-handle-provider.test.tsx` | Đăng ký/hủy listener, lỗi đăng ký không làm hỏng pane |
| `src/features/files/file-pane.tsx` | Render vùng `header` và `body` của pane file theo từng trạng thái handle |
| `src/features/files/file-pane.test.tsx` | Loading, text, rỗng, binary, too-large, missing, unreadable, root changed, conflict phòng thủ, polling fallback |
| `src/features/files/source-view.tsx` | Host React của bề mặt code: gắn adapter, nạp ngôn ngữ, giữ vị trí cuộn, thanh trạng thái |
| `src/features/files/source-view.test.tsx` | Adapter giả: doc đúng nội dung, read-only, ngôn ngữ đã nạp, khôi phục cuộn, ngưỡng tắt highlight |
| `src/features/files/source-view-adapter.ts` | Bọc CodeMirror 6: `EditorView`, gutter số dòng, read-only, theme và highlight style từ CSS variable |
| `src/features/files/source-view-adapter.test.ts` | Extension read-only, cấu hình gutter, ánh xạ token sang biến màu, destroy sạch |
| `src/features/files/source-language.ts` | Bảng `syntaxHint` sang nhãn ngôn ngữ và loader động; ngưỡng tắt tô màu cho file lớn |
| `src/features/files/source-language.test.ts` | Ánh xạ từng phần mở rộng, `null` và đuôi lạ, ngưỡng file lớn, loader lỗi |
| `src/features/files/file-facts.ts` | Định dạng kích thước byte, số dòng, encoding, kiểu xuống dòng và chế độ theo dõi |
| `src/features/files/file-facts.test.ts` | Biên `bigint`, đơn vị KB/MB, số ít và số nhiều, BOM, `mixed`, `none` |
| `src/features/files/unsupported-file.tsx` | Khối binary và too-large với hai hành động và thông tin kích thước thật |
| `src/features/files/unsupported-file.test.tsx` | Câu chữ đúng wireframe, hai nút, trạng thái pending và lỗi mở ngoài |
| `src/features/files/files-test-fixture.ts` | Factory `FileHandleDto`, `FileContentDto`, `OpenFileResultDto` và event; không tạo file thật |
| `src/lib/ipc/files.ts` | Wrapper `open_file_in_pane`, `get_open_file`, `reload_open_file`, `open_file_with_default_app` và listener `files://handle-changed` |
| `src/lib/ipc/files.test.ts` | Tên command, envelope tham số, DTO/lỗi, `void` và hủy listener |
| `src/features/sessions/session-route.tsx` | Nâng `useWorkspaceMutations` lên route, thêm slot `renderFilePane`, mở rộng slot Explorer với placement và `prepareFileTarget` |
| `src/features/sessions/session-route.test.tsx` | Slot mới, placement theo snapshot, mở file khi phiên chưa có tab, refresh sau attach |
| `src/features/sessions/session-workspace.tsx` | Nhận `mutations` từ route thay vì tự tạo; truyền `renderFilePane` xuống layout |
| `src/features/sessions/session-workspace.test.tsx` | Regression tab, split, maximize và close sau khi mutations được nâng lên route |
| `src/features/sessions/use-workspace-mutations.ts` | Thêm `prepareFileTarget(placement)` dùng chung mutation slot và tính pane `Empty` khả dụng |
| `src/features/sessions/use-workspace-mutations.test.ts` | Tạo tab/split trả đúng pane `Empty`, từ chối khi bận hoặc đang đóng, lỗi trả `null` |
| `src/features/sessions/session-layout.ts` | Helper tìm pane `Empty` đầu tiên của một tab theo thứ tự layout |
| `src/features/sessions/session-layout.test.ts` | Helper trên bố cục 1–4 pane và tab không có pane trống |
| `src/features/sessions/pane-layout.tsx` | Truyền `renderFilePane` tới từng leaf pane |
| `src/features/sessions/pane-layout.test.tsx` | Slot file tới đúng pane, không ảnh hưởng slot terminal |
| `src/features/sessions/session-pane.tsx` | Pane `file` dùng vùng `header` của renderer thay cho đường dẫn gốc project và vùng `body` cho nội dung |
| `src/features/sessions/session-pane.test.tsx` | Header pane file, fallback khi thiếu renderer, pane khác giữ nguyên đường dẫn gốc |
| `src/features/sessions/pane-content-placeholder.tsx` | Nhánh `file` đổi sang câu trung tính, không gắn mã feature |
| `src/features/sessions/pane-content-placeholder.test.tsx` | Câu chữ mới của nhánh `file`; nhánh khác không đổi |
| `src/features/sessions/pane-content-picker.tsx` | Cột `File` đổi dòng chờ sang hướng dẫn mở file bằng Explorer |
| `src/features/sessions/pane-content-picker.test.tsx` | Cột `File` hiện hướng dẫn mới và vẫn không bấm được |
| `src/app/session-terminal-route.tsx` | Ghép `FilePane` vào slot mới, cấp callback điều hướng, `prepareFileTarget` và placement cho Explorer |
| `src/app/session-terminal-route.test.tsx` | Composition slot file, boundary Settings/Quit, recovery khi project đổi gốc |
| `src/app/app-providers.tsx` | Mount `FileHandleProvider` đúng một lần cạnh `TerminalProvider` |
| `src/app/data-management-bridge.tsx` | Gọi boundary Files khi reset commit và khi reset không chắc chắn |
| `src/app/data-management-bridge.test.tsx` | Reset dọn registry Files; reset uncertain chỉ reconcile |
| `src/bindings/files/files.ts` | DTO và lỗi public đã sinh; chỉ import |
| `src/bindings/sessions/sessions.ts` | `PaneContentDto` biến thể `file`; chỉ import |
| `src/lib/ipc/ipc-error.ts` | Dùng lại `invokeCommand` và `IpcCallError` |
| `src/lib/ipc/sessions.ts` | Dùng lại `createTab`, `splitPane`, `setActivePane`; không đổi |
| `src/components/ui/button.tsx` | Dùng lại cho hành động pane và menu |
| `src/components/ui/dropdown-menu.tsx` | Dùng lại cho menu entry của Explorer |
| `src/components/ui/tooltip.tsx` | Dùng lại cho nút icon không nhãn |
| `src/features/settings/appearance-theme.ts` | Nguồn CSS variable terminal và cỡ chữ; chỉ đọc, không sửa |
| `src/index.css` | Token và lớp nền dùng chung; chỉ bổ sung nếu bề mặt code cần biến mới |

Feature không sửa file Rust, migration, `src-tauri/capabilities/main.json`, `src-tauri/tauri.conf.json` hay bất kỳ file nào trong `src/bindings/`. Sáu command và hai event của `BE-014` đã được đăng ký tại composition root và binding đã sinh đủ DTO cho lát cắt này.

Dependency frontend cần thêm: `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@lezer/highlight`, `@codemirror/legacy-modes`, cùng các language pack `@codemirror/lang-rust`, `@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-markdown`, `@codemirror/lang-python`, `@codemirror/lang-yaml`, `@codemirror/lang-xml`, `@codemirror/lang-sql`, `@codemirror/lang-java`, `@codemirror/lang-cpp`, `@codemirror/lang-php`, `@codemirror/lang-go`. Tất cả thuộc dòng CodeMirror 6 mà `01-TechStack.md` đã ghi, nên bảng công nghệ không cần sửa; phiên bản chính xác được khóa trong `package.json` và `pnpm-lock.yaml` tại thời điểm cài.

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| `FilePane` vùng `header` | Đường dẫn tương đối dạng mono cắt ellipsis kèm `title`, và badge `Read-only` có icon khóa khi nội dung là text | `#source`, `#unsupported` |
| `FilePane` vùng `body` | Bề mặt nội dung: source view, khối không hỗ trợ hoặc khối trạng thái file | `#source`, `#unsupported` |
| `SourceView` | Bề mặt code nền tối: gutter số dòng, nội dung tô màu, cuộn dọc và ngang trong pane | `#source` |
| `SourceStatusBar` | Hàng dưới cùng: ngôn ngữ, encoding, kiểu xuống dòng, số dòng, nhãn `Read-only · edit in your editor` và ghi chú riêng khi có | `#source` |
| `UnsupportedFile` | Icon file gạch chéo, tiêu đề `Can't show {name}`, câu giải thích, dòng dữ kiện kích thước và hai nút hành động | `#unsupported` |
| `FileStateBlock` | Khối dùng chung cho missing, unreadable, root changed và lỗi query, kèm hành động khắc phục | Không có |
| Mục mở trong menu Explorer | Bốn mục mở file đặt trên `Copy path` trong menu entry hiện có | `#explorer` |
| Cột `File` của pane picker | Một dòng hướng dẫn mở file từ Explorer, không bấm được | `#pane-picker` |

Bề mặt code dùng nền `--terminal-background`, chữ `--terminal-foreground`, cỡ chữ `--terminal-font-size` và font mono của repo. Gutter số dòng dùng `--terminal-ansi-8`. Ánh xạ token cố định: comment sang `--terminal-ansi-8`; keyword và operator từ khóa sang `--terminal-ansi-4`; string, ký tự và regexp sang `--terminal-ansi-3`; số, boolean và null sang `--terminal-ansi-5`; tên kiểu, class và namespace sang `--terminal-ansi-6`; tên hàm và macro sang `--terminal-ansi-2`; tên thuộc tính và attribute sang `--terminal-ansi-6`; token không hợp lệ sang `--terminal-ansi-1`; phần còn lại giữ `--terminal-foreground`.

Bảng ngôn ngữ theo `syntaxHint`: `rs` là Rust; `ts`, `mts`, `cts` là TypeScript; `tsx` là TypeScript JSX; `js`, `mjs`, `cjs` là JavaScript; `jsx` là JavaScript JSX; `json`, `jsonc` là JSON; `html`, `htm` là HTML; `css` là CSS; `md`, `markdown` là Markdown; `py`, `pyi` là Python; `yaml`, `yml` là YAML; `xml`, `svg` là XML; `sql` là SQL; `java` là Java; `c`, `h` là C; `cpp`, `cc`, `cxx`, `hpp`, `hh`, `hxx` là C++; `php` là PHP; `go` là Go; `sh`, `bash`, `zsh` là Shell; `ps1`, `psm1` là PowerShell; `toml` là TOML. Shell, PowerShell và TOML dùng `StreamLanguage` với `@codemirror/legacy-modes`. Mọi giá trị khác và `null` là `Plain text`.

Ngưỡng tắt tô màu là `SYNTAX_LIMIT`: `byteSize` lớn hơn `2 * 1024 * 1024` byte hoặc `lineCount` lớn hơn `20_000`. Vượt ngưỡng thì bỏ hẳn bước nạp language pack, chỉ dựng bề mặt code có số dòng.

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang tải | `get_open_file` cho handle chưa trả lần đầu | Vùng `body` hiện `Opening file…` với `aria-busy`; vùng `header` chưa hiện đường dẫn vì chưa có dữ liệu thật |
| Sẵn sàng, text | `state.kind` là `ready` và `content.kind` là `text` | Bề mặt code chỉ đọc có số dòng; header hiện đường dẫn và badge `Read-only`; thanh trạng thái hiện đủ dữ kiện |
| Rỗng | `content.kind` là `text` và `text` là chuỗi rỗng | Bề mặt code trống kèm `This file is empty.`; thanh trạng thái vẫn hiện encoding và `0 lines` |
| Binary | `content.kind` là `binary` | `Can't show {name}` · `This is a binary file. XWork only shows text and source files.` · `{kích thước} · {mimeType}` · `Open with default app` · `Copy path`; header không có badge `Read-only` |
| Quá lớn | `content.kind` là `tooLarge` | `Can't show {name}` · `This file is larger than the {limit} viewer limit.` · `{kích thước} · limit {limit}` · hai nút như trên |
| Không còn trên đĩa | `state.kind` là `missing` | `{name} is no longer on disk.` kèm `Retry`; nếu snapshot còn nội dung cũ thì nói rõ nội dung đang xem là bản đã đọc trước đó |
| Không đọc được | `state.kind` là `unreadable` | `XWork can't read {name}.` kèm `Retry` và `Open with default app` |
| Project đổi thư mục gốc | `state.kind` là `projectRootChanged` | `The project folder changed. Open this file again from the File Explorer.` kèm `Open project` |
| Xung đột ngoài | `state.kind` là `externalConflict` | Không mong đợi với handle read-only. Hiện `This file changed on disk.` kèm `Reload`; nếu `reload_open_file` trả `unsavedChangesWouldBeLost` thì đổi sang câu của lỗi đó và bỏ nút |
| Lỗi truy vấn | `get_open_file` hoặc `reload_open_file` bị từ chối | `fileErrorCopy(error)` kèm `Retry`, trừ `windowNotAllowed`, `invalidFileHandleId` và `fileHandleNotFound` thì không cho retry và mời đóng pane |
| Theo dõi bằng polling | `watchMode` là `pollingFallback` | Thanh trạng thái thêm `Change detection is delayed for this file.` |
| Tô màu tắt vì file lớn | Vượt `SYNTAX_LIMIT` | Thanh trạng thái thêm `Syntax highlighting is off for large files.`; nội dung vẫn hiện đủ và có số dòng |
| Markdown chờ editor | `content.file.mode` là `markdown` | Thanh trạng thái thêm `Editing and preview arrive with the Markdown editor.` |
| Explorer đang mở file | Action mở đang chạy | Menu và kích hoạt của Explorer bị khóa; vùng thông báo hiện `Opening {name}…` |
| Explorer mở thất bại | Command mở bị từ chối | Vùng lỗi của Explorer hiện `fileErrorCopy(error)`; cây và selection giữ nguyên |
| Explorer không ghi được recent | Kết quả mở có warning `recentFileNotRecorded` | Thông báo phụ `Opened {name}. Recent files couldn't be updated.`; không coi là lỗi mở |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Bấm hoặc double-click một entry `file` trong Explorer | Chọn entry rồi mở file vào tab mới | `Enter` |
| Chọn entry `file` mà không mở | Chỉ đổi selection, không gọi command nào | `Space` |
| Mở menu entry `file` | Menu hiện bốn mục mở trên nhóm copy/reveal sẵn có | `Shift+F10`, nút `Actions for {name}` |
| `Open in new tab` | Sessions tạo tab mới có một pane `Empty` rồi Files attach file vào pane đó | `Enter` trong menu |
| `Open in empty pane` | Dùng pane `Empty` đầu tiên của tab đang active; disabled khi tab hiện tại không có pane `Empty` | `Enter` trong menu |
| `Split right and open` | Chia pane đang active sang phải rồi attach vào pane mới; disabled khi tab đã đủ bốn pane hoặc phiên chưa có tab | `Enter` trong menu |
| `Split down and open` | Như trên theo chiều dọc | `Enter` trong menu |
| Cuộn, chọn và sao chép trong bề mặt code | Thao tác chuột và bàn phím mặc định của editor read-only; không sửa được nội dung | `Ctrl/Cmd + A`, `Ctrl/Cmd + C` |
| Rời bề mặt code bằng bàn phím | `Tab` chuyển focus ra khỏi bề mặt code vì không gán keymap thụt đầu dòng | `Tab`, `Shift + Tab` |
| `Retry` trên trạng thái lỗi hoặc missing | Gọi `reload_open_file` cho đúng handle, một lần cho mỗi lần bấm | `Enter` / `Space` |
| `Open with default app` | Gọi `open_file_with_default_app`; nút khóa trong lúc chờ và báo lỗi khi bị từ chối | `Enter` / `Space` |
| `Copy path` trong khối không hỗ trợ | Gọi `get_file_entry_paths` bằng `projectId` và `relativePath` của handle rồi ghi `absolutePath` vào clipboard, báo `Path copied.` sau khi ghi xong | `Enter` / `Space` |
| `Open project` trên trạng thái đổi thư mục gốc | Điều hướng tới trang project qua callback của app; không gọi command Files | `Enter` / `Space` |

Mọi nút icon không nhãn có tooltip; badge `Read-only` là văn bản có icon trang trí `aria-hidden`. Bề mặt code là vùng có nhãn `Source view of {name}` và nhận focus được. Thông báo nạp lại, copy path và mở file dùng live region `polite` sẵn có của từng khu vực. Khối không hỗ trợ và khối trạng thái đều có tiêu đề, câu giải thích và ít nhất một hành động, đúng yêu cầu trạng thái rỗng và lỗi của §18.

## Luồng chính

### Mở file từ Explorer

1. Người dùng kích hoạt một entry `file`, hoặc chọn một mục mở trong menu. Explorer kiểm `readBoundary()` và cờ single-flight trước khi làm gì.
2. Explorer gọi `prepareTarget(placement)` do host Sessions cấp. Sessions chạy `createTab`, `splitPane` hoặc tra pane `Empty` của tab active trong đúng mutation slot của workspace, rồi trả `{ tabId, paneId }`, hoặc trả `null` khi bị từ chối vì đang bận, đang đóng phiên hoặc command lỗi.
3. Nhận `null` thì Explorer dừng và không tự hiện lỗi trùng với lỗi Sessions đã hiển thị; nhận target thì Explorer kiểm boundary lần nữa rồi gọi `open_file_in_pane({ sessionId, tabId, paneId, relativePath })`.
4. Thành công: Explorer gọi `onFileOpened()` để Sessions đọc lại snapshot, thông báo `Opened {name} in a new tab.` hoặc câu tương ứng placement, và giữ focus tại cây thay vì cướp focus sang pane.
5. Thất bại: pane vừa chuẩn bị vẫn là `Empty` và tiếp tục hiện màn hình chọn nội dung; Explorer hiện lỗi và không tự đóng tab hay pane vì đóng có thể chạm luồng xác nhận của `BE-005`.
6. Sau khi snapshot mới về, pane đổi sang `content.kind === "file"`; `SessionPane` gọi renderer hai lần với `region` là `header` và `body`.

### Hiển thị nội dung

1. `FilePane` lấy entry của `fileHandleId` từ registry và giữ một tham chiếu trong suốt vòng đời component.
2. Entry chưa có snapshot thì gọi `get_open_file` đúng một lần dù hai vùng cùng yêu cầu; hai vùng đọc chung một snapshot bằng `useSyncExternalStore`.
3. `content.kind` là `text`: `SourceView` tra `syntaxHint` trong bảng ngôn ngữ, nạp động language pack nếu cần rồi dựng bề mặt code read-only. Vượt `SYNTAX_LIMIT` thì bỏ qua bước nạp và hiển thị text thuần có số dòng.
4. Thanh trạng thái lấy nhãn ngôn ngữ, `encoding` cùng cờ BOM, `lineEnding`, `lineCount` và các ghi chú riêng từ chính snapshot.
5. `binary` và `tooLarge` render `UnsupportedFile` với kích thước thật, limit thật và MIME thật; các state còn lại render `FileStateBlock`.
6. Rời tab rồi quay lại chỉ dựng lại bề mặt code từ snapshot đã giữ và khôi phục vị trí cuộn đã lưu theo `fileHandleId`; không gọi backend lại.

### Theo dõi thay đổi ngoài XWork

1. Registry đăng ký `files://handle-changed` đúng một lần khi provider mount. Đăng ký hỏng không chặn pane; snapshot vẫn đúng nhờ query lúc mount và lúc cửa sổ nhận focus.
2. Event mang `fileHandleId`, `revision` và `change`. Registry bỏ qua ID không quản lý và bỏ qua event có `revision` không lớn hơn revision đang giữ.
3. Event còn hiệu lực thì registry gọi `get_open_file` cho đúng handle đó, gộp các event dồn dập vào một query đang chạy.
4. `reloaded` thay nội dung tại chỗ, giữ vị trí cuộn nếu số dòng mới còn đủ, và thông báo `File reloaded from disk.` qua live region.
5. `missing`, `unreadable`, `projectRootChanged` và `watchModeChanged` chỉ cần snapshot mới; giao diện đổi theo bảng trạng thái.
6. Cửa sổ nhận focus thì registry đọc lại snapshot của các handle đang có người xem. `get_open_file` chỉ đọc bộ nhớ nên thao tác này không chạm đĩa.

### Vòng đời và invalidation

- Entry bị giải phóng khi không còn ai xem và map vượt 64 entry, hoặc khi query trả `fileHandleNotFound` hay `invalidFileHandleId`. Backend đóng handle khi pane, tab, phiên hoặc project đóng, nên frontend không tự gọi lệnh đóng nào.
- `clearAfterReset()` bỏ toàn bộ entry, vị trí cuộn và query đang chờ sau khi reset ứng dụng commit; `reconcileAfterResetFailure()` chỉ đọc lại snapshot của entry còn người xem và không xóa gì.
- Boundary `busy` và `suspended` của DataManagement cùng Quit áp cho Explorer đúng như `FE-016`. Pane file không nhận boundary riêng vì registry đã được dọn theo commit của reset.
- Đổi `sessionId` hoặc `projectId` làm Explorer bỏ intent mở đang chờ; response về sau không được publish và không được tạo tab.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `open_file_in_pane` | `{ request: OpenFileInPaneRequestDto }` | `OpenFileResultDto` | `paneNotEmpty`, `invalidSessionTarget`, `sessionAttachFailed` đọc lại snapshot phiên và hiện copy tương ứng; `entryNotFound`, `entryNotVisible` refresh cây; `notRegularFile`, `linkTraversalDenied`, `invalidRelativePath` bỏ target và không retry input cũ; `fileMemoryLimitReached` hiện `Close another file and try again.`; `fileChangedDuringRead`, `fileReadFailed`, `clockFailed` cho `Retry`; `projectUnavailable`, `projectRootChanged`, `projectRemovalInProgress`, `projectNotFound` dùng recovery project sẵn có của Explorer; `windowNotAllowed` không retry |
| `get_open_file` | `{ request: FileHandleRequestDto }` | `FileHandleDto` | `fileHandleNotFound`, `invalidFileHandleId` giải phóng entry và hiện trạng thái pane không còn hợp lệ, không retry; `windowNotAllowed` không retry; lỗi khác hiện copy kèm `Retry` |
| `reload_open_file` | `{ request: FileHandleRequestDto }` | `FileHandleDto` | `unsavedChangesWouldBeLost` bỏ nút `Reload` và hiện đúng câu của lỗi; `projectRootChanged` chuyển sang trạng thái đổi thư mục gốc; `fileChangedDuringRead`, `fileReadFailed` giữ nội dung cũ và cho `Retry`; lỗi handle xử lý như `get_open_file` |
| `open_file_with_default_app` | `{ request: FileHandleRequestDto }` | `void` | `openExternalFailed` hiện `Could not open this file with the default app.` kèm `Retry`; `entryNotFound`, `linkTraversalDenied`, `projectRootChanged` đọc lại snapshot rồi hiện trạng thái tương ứng; lời gọi đã gửi có thể mở cửa sổ hệ điều hành dù pane đã đóng, giao diện không rollback |
| `get_file_entry_paths` | `{ request: FileEntryRequestDto }` | `FileEntryPathsDto` | `entryNotFound`, `entryNotVisible`, `linkTraversalDenied` hiện `This entry is no longer available.`; lỗi khác hiện `Could not copy path. Try again.`; không cache `absolutePath` |

`open_file_in_pane` không trả lỗi cho file binary hoặc quá lớn; hai trường hợp đó là kết quả thành công với `content.kind` tương ứng. Warning `recentFileNotRecorded` là thông tin phụ, không đảo ngược kết quả mở.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `files://handle-changed` | `FileHandleChangedEventDto` | Sau khi backend commit một thay đổi state của handle: nạp lại, mất file, không đọc được, đổi thư mục gốc hoặc đổi chế độ theo dõi | Registry lọc theo `fileHandleId` và `revision`, gọi `get_open_file` rồi phát snapshot mới cho mọi pane đang xem. Payload không mang nội dung nên không được dùng để vá state |
| `sessions://runtime-changed` | `SessionRuntimeEventDto` | Sau mọi mutation runtime, gồm cả lúc backend attach file vào pane | Dùng lại nguyên hành vi của `FE-006`; lát cắt này không thêm consumer mới |

Không đăng ký `files://recent-changed`; event đó thuộc `FE-005`. Kiểu DTO lấy từ `src/bindings/files/files.ts` và `src/bindings/sessions/sessions.ts`, không định nghĩa lại thủ công.

## State frontend

```ts
// Chỉ ghi hình dạng state và chữ ký action, không ghi implementation.

/** Snapshot mọi pane của cùng một handle cùng đọc. */
interface FileHandleEntryState {
  handle: FileHandleDto | null;
  phase: "loading" | "ready" | "failed";
  failure: string | null;
  failureCode: string | undefined;
  isReloading: boolean;
  externalPending: boolean;
  externalFailure: string | null;
  copyFeedback: string;
  announcement: string;
}

/** Một handle được giữ ngoài vòng đời component của pane. */
interface FileHandleEntry {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FileHandleEntryState;
  retain(): () => void;
  reload(): Promise<void>;
  openWithDefaultApp(): Promise<void>;
  copyPath(): Promise<void>;
  readScrollTop(): number;
  writeScrollTop(value: number): void;
}

/** Sở hữu toàn bộ handle độc lập với route và pane đang mount. */
interface FileHandleRegistry {
  entry(fileHandleId: string): FileHandleEntry;
  startMonitoring(): void;
  stopMonitoring(): void;
  clearAfterReset(): void;
  reconcileAfterResetFailure(): void;
}

/** Phần state mở file thêm vào snapshot Explorer của FE-016. */
interface ExplorerOpenState {
  openingPath: string | null;
  openFeedback: string;
  openError: string;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| `handle` | Backend qua `get_open_file` và `reload_open_file` | Đọc lại khi mount, khi có event đúng handle và khi cửa sổ nhận focus; không tự sửa field nào |
| `phase`, `failure`, `failureCode` | UI tạm thời | Dẫn xuất từ kết quả command gần nhất; xóa khi query mới bắt đầu |
| `isReloading`, `externalPending` | UI tạm thời | Khóa nút tương ứng để một lần bấm chỉ gọi một command |
| `copyFeedback`, `announcement` | UI tạm thời | Chỉ hiển thị sau khi thao tác thật sự hoàn tất, không báo thành công lạc quan |
| Vị trí cuộn theo `fileHandleId` | UI tạm thời trong registry | Chỉ để khôi phục khi remount; không lưu xuống backend hay storage |
| `openingPath`, `openFeedback`, `openError` | UI tạm thời trong Explorer | Bị xóa khi generation, session, project hoặc boundary đổi |
| Bố cục tab và pane | Backend qua `SessionDetailDto` | Files không giữ bản sao; placement khả dụng do Sessions tính từ snapshot của nó |

## Contract công khai của feature

```ts
// Chỉ ghi export mà src/app/ hoặc feature khác được phép dùng, ở mức chữ ký.

/** Vị trí pane mà Explorer nhờ host Sessions chuẩn bị trước khi attach nội dung. */
export type FilePlacement = "newTab" | "emptyPane" | "splitRight" | "splitDown";

/** Một pane Empty đã được chuẩn bị cho nội dung file. */
export interface FileTarget {
  tabId: string;
  paneId: string;
}

/** Bổ sung vào props Explorer của FE-016; các field cũ giữ nguyên. */
export interface FileExplorerProps {
  sessionId: string;
  projectId: string;
  isVisible: boolean;
  regionId: string;
  platform: "windows" | "macos" | null;
  boundary: FileExplorerBoundary;
  placements: Record<FilePlacement, boolean>;
  readBoundary(): FileExplorerBoundary;
  /** Chuẩn bị một pane Empty, hoặc null khi host từ chối. */
  prepareTarget(placement: FilePlacement): Promise<FileTarget | null>;
  /** Báo host đọc lại snapshot phiên sau khi file đã attach. */
  onFileOpened(): void;
  onClose(): void;
  onOpenProject(): void;
  onProjectMissing(): void;
}

/** Render một vùng của pane file từ snapshot handle dùng chung. */
export interface FilePaneProps {
  region: "header" | "body";
  fileHandleId: string;
  paneTitle: string;
  isVisible: boolean;
  onRefreshSession(): void;
  onOpenProject(): void;
}
export function FilePane(props: FilePaneProps): React.JSX.Element;

/** Sở hữu mọi handle đang mở, độc lập với route và pane đang mount. */
export function FileHandleProvider(props: { children: React.ReactNode }): React.JSX.Element;

/** Hành động bảo trì chỉ dành cho boundary dữ liệu của ứng dụng. */
export function useFileDataBoundary(): {
  clearAfterReset(): void;
  reconcileAfterResetFailure(): void;
};
```

Slot công khai bổ sung tại `src/features/sessions/session-route.tsx`, theo đúng pattern `renderTerminal` và `renderFileExplorer` đã có:

```ts
/** Vị trí pane Sessions có thể chuẩn bị cho nội dung file. */
export type SessionFilePlacement = "newTab" | "emptyPane" | "splitRight" | "splitDown";

/** Pane Empty Sessions đã chuẩn bị. */
export interface SessionFileTarget {
  tabId: string;
  paneId: string;
}

/** Bổ sung vào slot Explorer hiện có. */
export interface SessionFileExplorerSlotProps {
  sessionId: string;
  projectId: string;
  isVisible: boolean;
  regionId: string;
  placements: Record<SessionFilePlacement, boolean>;
  onClose(): void;
  prepareFileTarget(placement: SessionFilePlacement): Promise<SessionFileTarget | null>;
  onFileAttached(): void;
}

/** Vùng của pane mà renderer được yêu cầu lấp đầy. */
export type SessionPaneRegion = "header" | "body";

/** Ngữ cảnh tối thiểu Sessions cấp cho nội dung file. */
export interface SessionFilePaneSlotProps {
  region: SessionPaneRegion;
  sessionId: string;
  tabId: string;
  paneId: string;
  content: Extract<PaneContentDto, { kind: "file" }>;
  isActive: boolean;
  isVisible: boolean;
  onActivate(): void;
  onRefreshSession(): void;
}
export type SessionFilePaneRenderer = (props: SessionFilePaneSlotProps) => React.ReactNode;
```

`SessionRoute` thêm optional `renderFilePane?: SessionFilePaneRenderer`. Thiếu renderer thì `SessionPane` giữ đường dẫn gốc project ở header và dùng `PaneContentPlaceholder` cho thân pane, giống cách slot terminal đang xử lý. `useWorkspaceMutations` bổ sung `prepareFileTarget(placement)` trả `SessionFileTarget | null` và chạy trong đúng mutation slot đang có, nên mở file không chạy song song với tạo tab, split hay close. Files không import implementation của Sessions và Sessions không import Files; app ghép hai bên tại `src/app/session-terminal-route.tsx`.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Cùng một file mở ở nhiều pane | Mỗi pane có handle riêng và snapshot riêng; một thay đổi trên đĩa làm cả hai pane cập nhật độc lập, không chia sẻ vị trí cuộn |
| Double-click nhanh hoặc nhấn `Enter` liên tiếp trên một entry | Cờ single-flight chặn lời gọi thứ hai; chỉ một tab được tạo |
| `prepareTarget` thành công nhưng `open_file_in_pane` thất bại | Tab hoặc pane vừa tạo vẫn còn và hiện màn hình chọn nội dung; Explorer báo lỗi và không tự dọn |
| Tab đã có bốn pane | Hai mục split bị disable kèm giải thích `A tab can hold up to 4 panes.`; `Open in new tab` vẫn dùng được |
| Phiên chưa có tab nào | Chỉ `Open in new tab` khả dụng; ba placement còn lại disable cho tới khi có tab |
| File bị xóa khi đang mở | Snapshot chuyển `missing`; nội dung đã đọc vẫn nằm trên màn hình kèm câu nói rõ đây là bản đã đọc trước đó, và có `Retry` |
| File text bị thay bằng file binary | Backend đổi phân loại, pane chuyển sang khối không hỗ trợ, header bỏ badge `Read-only` |
| File vượt limit sau khi bị ghi thêm | Pane chuyển sang trạng thái quá lớn với kích thước và limit thật, giữ nguyên hai hành động |
| Event `files://handle-changed` bị mất | Query lúc cửa sổ nhận focus và `Retry` đưa snapshot về đúng; không polling nền |
| Đăng ký listener thất bại | Pane vẫn hoạt động bằng query mount và focus; không tuyên bố live update đã sẵn sàng |
| `revision` trong event không lớn hơn revision đang giữ | Bỏ qua, không query lại, không nhấp nháy giao diện |
| Language pack nạp lỗi | Hiện text thuần có số dòng và ghi chú `Syntax highlighting is unavailable for this file.`; không thử lại vô hạn |
| File chỉ có một dòng rất dài | Bề mặt code cuộn ngang trong pane; pane và cửa sổ không bị đẩy rộng ra |
| File đúng bằng 5 MB limit | Vẫn được đọc và hiển thị; tô màu tắt theo `SYNTAX_LIMIT` |
| `lineEnding` là `none` | Ẩn hẳn ô kiểu xuống dòng trên thanh trạng thái thay vì hiện giá trị vô nghĩa |
| `hasUtf8Bom` là `true` | Ô encoding hiện `UTF-8 with BOM` |
| `syntaxHint` là `null` hoặc đuôi không có trong bảng | Nhãn ngôn ngữ hiện `Plain text`; không đoán ngôn ngữ từ nội dung hay basename |
| Reset ứng dụng commit khi đang xem file | Registry bị dọn, route về Home theo luồng reset hiện có; không còn query nào cho handle cũ |
| Reset không chắc chắn | Chỉ reconcile snapshot của handle còn người xem; không xóa entry, không giả định pane đã mất |
| Người dùng đổi Appearance khi đang xem file | Bề mặt code đổi màu và cỡ chữ theo CSS variable ngay, không cần dựng lại nội dung |
| Handle trả `externalConflict` | Coi là bất thường: hiện thông báo đổi trên đĩa và `Reload`; không gọi `resolve_external_file_change` vì command đó thuộc `FE-018` |

## Tiêu chí hoàn thành

- [ ] Bấm hoặc `Enter` trên một entry `file` trong File Explorer mở file vào tab mới; `Space` chỉ đổi selection và không gọi command nào.
- [ ] Menu entry `file` có đủ bốn mục mở; `Open in empty pane` disable khi tab active không có pane `Empty`; hai mục split disable khi tab đã đủ bốn pane hoặc phiên chưa có tab.
- [ ] Mở file trên phiên chưa có tab nào tạo được tab đầu tiên và attach nội dung vào pane của tab đó.
- [ ] Một entry được kích hoạt hai lần liên tiếp chỉ tạo một tab và chỉ gọi `open_file_in_pane` một lần.
- [ ] `open_file_in_pane` thất bại thì pane đã chuẩn bị vẫn là `Empty`, Explorer hiện đúng copy theo mã lỗi và không đóng tab hay pane.
- [ ] Pane file hiện đường dẫn tương đối và badge `Read-only` ở hàng header cho nội dung text, và không có badge cho binary hoặc too-large.
- [ ] Nội dung text hiện chỉ đọc với gutter số dòng, và không thao tác bàn phím nào sửa được nội dung.
- [ ] Thanh trạng thái hiện đúng nhãn ngôn ngữ, encoding kèm BOM, kiểu xuống dòng, số dòng lấy nguyên từ DTO, và `Read-only · edit in your editor`.
- [ ] File `.md` mở read-only trong cùng viewer và thanh trạng thái nói rõ sửa và xem trước thuộc lượt sau; không có công tắc `Edit` hay `Preview`.
- [ ] File binary hiện `Can't show {name}`, câu giải thích binary, `{kích thước} · {mimeType}` và hai nút `Open with default app`, `Copy path`.
- [ ] File vượt limit hiện câu giải thích kèm `{kích thước} · limit {limit}` với số liệu lấy từ `byteSize` và `limitBytes`, không hard-code.
- [ ] `Open with default app` gọi đúng `open_file_with_default_app` một lần cho mỗi lần bấm và hiện lỗi khi bị từ chối.
- [ ] `Copy path` lấy path mới qua `get_file_entry_paths` rồi mới ghi clipboard, và chỉ báo `Path copied.` sau khi ghi xong.
- [ ] File bị sửa ngoài XWork làm pane nạp lại nội dung sau `files://handle-changed` mà không cần thao tác nào, và giữ được vị trí cuộn khi số dòng còn đủ.
- [ ] File bị xóa, không đọc được hoặc project đổi thư mục gốc đều có trạng thái riêng kèm hành động khắc phục đúng bảng trạng thái.
- [ ] Event có `revision` không mới hơn bị bỏ qua; nhiều event dồn dập chỉ tạo một lần `get_open_file`.
- [ ] Hai vùng render của cùng một pane chỉ gây đúng một lần `get_open_file`, và quay lại tab cũ không gọi thêm command nào.
- [ ] `fileHandleNotFound` và `invalidFileHandleId` giải phóng entry và hiện trạng thái không cho retry.
- [ ] Reset ứng dụng commit dọn sạch registry Files; reset không chắc chắn chỉ reconcile và không xóa entry.
- [ ] Bề mặt code đổi màu và cỡ chữ theo Appearance mà không dựng lại nội dung, và tô màu tắt kèm ghi chú khi file vượt `SYNTAX_LIMIT`.
- [ ] File Explorer không còn dòng `File viewing is not available yet.`; cột `File` của pane picker không còn câu `Files arrive with FE-016.`; thân pane `file` không còn câu `File panes arrive with FE-017.`
- [ ] Catalog phím tắt của `BE-009` không đổi và không có accelerator toàn ứng dụng mới nào được quảng bá.
- [ ] Mọi function, method, callback, test và helper có comment ngắn; single-flight mở file, lọc event theo revision, khôi phục cuộn và ngưỡng tô màu có comment giải thích lý do.
- [ ] Trên Windows, `pnpm format:check`, `pnpm lint`, `pnpm typecheck` và `pnpm test` pass.
- [ ] `pnpm tauri build` pass vì lát cắt này thêm dependency frontend mới ảnh hưởng bundle.
- [ ] Smoke test thủ công trên Windows xác nhận: mở file source, sửa file bằng editor ngoài rồi thấy pane nạp lại, xóa file đang mở, mở file binary bằng ứng dụng mặc định, và mở file lớn hơn 5 MB. Kiểm tra macOS hoãn tới lúc chuẩn bị phát hành.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/features/files/file-explorer.test.tsx` | Component | Bốn mục menu, disable theo placement, click và `Enter` mở tab mới, `Space` không mở, thông báo mở và warning recent, lỗi giữ nguyên cây |
| `src/features/files/file-tree.test.tsx` | Component | Kích hoạt tách khỏi chọn, directory và symbolic link không có hành động mở, roving focus không đổi |
| `src/features/files/use-file-explorer.test.ts` | Unit | Single-flight, boundary sau await, `prepareTarget` trả `null`, từng nhánh lỗi của `open_file_in_pane`, retire khi đổi session |
| `src/features/files/file-handle-registry.test.ts` | Unit | Query một lần cho nhiều consumer, coalesce event theo revision, focus refresh, refcount và evict, `fileHandleNotFound`, `clearAfterReset`, `reconcileAfterResetFailure` |
| `src/features/files/file-handle-provider.test.tsx` | Component | Đăng ký và hủy listener đúng một lần, lỗi đăng ký không làm hỏng pane |
| `src/features/files/file-pane.test.tsx` | Component | Header và body cho từng state, badge `Read-only` chỉ cho text, ghi chú Markdown, polling fallback, `Retry`, `Open project` |
| `src/features/files/source-view.test.tsx` | Component | Adapter giả nhận đúng nội dung và cờ read-only, nạp ngôn ngữ theo `syntaxHint`, ngưỡng file lớn, khôi phục vị trí cuộn, loader lỗi |
| `src/features/files/source-view-adapter.test.ts` | Unit | Extension read-only và gutter, ánh xạ token sang CSS variable, cập nhật nội dung không tạo view mới, destroy sạch |
| `src/features/files/source-language.test.ts` | Unit | Ánh xạ từng phần mở rộng trong bảng, `null` và đuôi lạ, ngưỡng `SYNTAX_LIMIT` |
| `src/features/files/file-facts.test.ts` | Unit | Kích thước `bigint` theo KB và MB, số dòng số ít và số nhiều, BOM, `mixed`, `none` |
| `src/features/files/unsupported-file.test.tsx` | Component | Câu chữ binary và too-large đúng wireframe, hai nút, pending, lỗi mở ngoài và copy path |
| `src/features/files/file-error-copy.test.ts` | Unit | Mọi code public, transport lạ, nhãn placement, copy viewer, không còn `VIEWING_LIMITATION` |
| `src/lib/ipc/files.test.ts` | Unit | Bốn wrapper mới: tên command, envelope tham số, DTO trả về, lỗi chuẩn hóa, `void`, hủy listener |
| `src/features/sessions/use-workspace-mutations.test.ts` | Unit | `prepareFileTarget` cho từng placement, trả `null` khi bận hoặc đang đóng, không chiếm slot của thao tác khác |
| `src/features/sessions/session-layout.test.ts` | Unit | Tìm pane `Empty` đầu tiên trên bố cục 1–4 pane và tab không có pane trống |
| `src/features/sessions/session-route.test.tsx` | Component | Slot `renderFilePane`, placement theo snapshot, mở file khi phiên chưa có tab, refresh sau `onFileAttached` |
| `src/features/sessions/session-workspace.test.tsx` | Component | Regression tab, split, maximize và close sau khi mutations được nâng lên route |
| `src/features/sessions/pane-layout.test.tsx` | Component | Slot file tới đúng leaf pane và không ảnh hưởng slot terminal |
| `src/features/sessions/session-pane.test.tsx` | Component | Header pane file dùng vùng renderer, pane khác giữ đường dẫn gốc, fallback khi thiếu renderer |
| `src/features/sessions/pane-content-placeholder.test.tsx` | Component | Câu chữ mới của nhánh `file` |
| `src/features/sessions/pane-content-picker.test.tsx` | Component | Cột `File` hiện hướng dẫn mới và vẫn không bấm được |
| `src/app/session-terminal-route.test.tsx` | Component | Ghép `FilePane` và Explorer, boundary Settings và Quit, recovery khi project đổi gốc |
| `src/app/data-management-bridge.test.tsx` | Component | Reset commit dọn registry Files; reset uncertain chỉ reconcile |

Test dùng fixture DTO thuần và adapter giả; không tạo file thật, không mount CodeMirror thật trong jsdom và không gọi IPC thật. Test bất đồng bộ dùng deferred promise có deadline hữu hạn, không sleep mù.

## Câu hỏi mở

Không có.
