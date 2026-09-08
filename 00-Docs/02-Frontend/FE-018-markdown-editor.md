# FE-018 — Markdown editor

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-018` |
| Phase | `2`, roadmap giai đoạn `17` |
| Khu vực chính | `src/features/files/` |
| Yêu cầu chức năng | §11.3, §18; liên quan §8.1, §9, §17.6, §20 Phase 2 |
| Wireframe | `00-Docs/01-Wireframe/05-Files.html#md-edit`, `#md-preview`, `#md-unsaved`, `#md-conflict` |
| Backend liên quan | `BE-015`, `BE-014`, lifecycle `BE-005`, `BE-003`, `BE-001`, data `BE-012` |
| Phụ thuộc | `FE-017`, `FE-007`, `FE-001`, `FE-015`; BE-015 đã cung cấp IPC thật |

## Mục tiêu

Người dùng sửa file Markdown thật trong pane, chuyển riêng giữa Edit và Preview, lưu thủ công và xử lý thay đổi ngoài mà không mất draft. Backend tiếp tục sở hữu dirty state, disk token, ghi file và quyết định lifecycle; frontend giữ snapshot chưa được acknowledge để bảo vệ thao tác đang nhập.

### Quyết định đã chốt

- Theo quyền tự quyết định người dùng giao ngày 2026-09-08, các lựa chọn dưới đây đã được giải quyết, không cần vòng hỏi bổ sung. Roadmap giai đoạn 17 và BE-015 thật thay cho hướng dẫn mock IPC cũ trong PLANS.md. Không mock runtime, không viết lại DTO.
- Mở lần đầu ở `Edit`; nhớ mode theo **handle ID** trong registry suốt thời gian handle mở, kể cả đổi route, tab, Settings hoặc remount. Mở lại tab đã đóng tạo handle mới và mặc định Edit; hai handle cùng path có mode và draft riêng.
- Source không phải Markdown vẫn dùng FE-017 read-only. Phân loại theo `TextFileDto.mode`, không suy đoán từ filename ở React.
- Preview dùng `react-markdown` + `remark-gfm`, `skipHtml`, không `rehype-raw`. Không nạp ảnh remote/local và không điều hướng URL từ nội dung: ảnh hiện alt text, link hiện label và URL dạng văn bản có thể chọn/copy, task checkbox disabled. Đây là quyết định phạm vi: BE-014 chỉ có opener cho file đang mở, chưa có contract mở URL tùy ý hoặc resolve asset project. Không thêm backend chỉ để mở link trong FE-018.
- Bổ sung dependency exact `"react-markdown": "10.1.0"`, `"remark-gfm": "4.0.1"`, `"@codemirror/commands": "6.11.0"` trong dependencies; giữ các package CodeMirror hiện có. Commands cung cấp undo/redo và keymap chuẩn, không thêm search/completion/format toolbar. Registry npm được đọc ngày 2026-09-08: commands yêu cầu state `^6.7.0`, view `^6.27.0`, language `^6.0.0`, phù hợp pins hiện tại 6.7.4/6.43.11/6.12.4; react-markdown yêu cầu React và types >=18, phù hợp 19.2.x. Build/typecheck sau install vẫn là gate bắt buộc, metadata không thay bằng bằng chứng runtime.
- Không normalize line ending. Adapter giữ raw string lossless riêng và ánh xạ CodeMirror change offsets sang raw offsets (CRLF là một line break trong editor nhưng hai code unit raw); phần không bị sửa giữ nguyên CRLF/LF/mixed, newline mới theo CRLF nếu file thuần CRLF, còn lại LF. Undo/redo phục hồi raw text và delimiter của transaction, không serialize toàn bộ document bằng `doc.toString()` rồi vô tình đổi line ending. BOM không chèn vào text; backend giữ flag. Không tự thêm trailing newline.
- Save shortcut cố định `Ctrl+S` Windows / `Cmd+S` macOS, chỉ active visible Markdown pane khi focus nằm trong pane (editor, preview hoặc header). Không chiếm shortcut của terminal, dialog, Settings hoặc input ngoài pane; không thêm vào catalog BE-009. Phím Tab rời editor, không giữ focus bằng indent keymap.
- Close tab/pane có ba hành động theo wireframe: `Cancel`, `Discard changes`, `Save and close`. Session/project/Quit giữ dialog cụ thể hiện có với số file chưa lưu; người dùng có thể Cancel và Save từng pane, không thêm bulk-save cho các dialog này. Remove Project không xóa file nguồn. Chuyển project/Settings và hide-to-tray không phải close và không tự lưu.
- Không thêm command/event, không thay Rust DTO, migration, capability hoặc CSP. Không làm Notes/Quick Note trong giai đoạn này.

### Ngoài phạm vi

Autosave, Save As, tạo file, sửa source code, merge/diff UI, phục hồi draft qua Quit, preview song song, rich-text editor, HTML, tải asset/network, Notes và cửa sổ Quick Note.

## File liên quan

Các path dưới đây là phạm vi implementation được phép; binding/backend test là đầu vào hoặc gate chỉ đọc, không chỉnh tay binding.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `package.json`, `pnpm-lock.yaml` | Ba dependency exact nêu trên |
| `src/features/files/markdown-editor.tsx` | Host editor, status, Preview và adapter seam |
| `src/features/files/markdown-editor.test.tsx` | Component states, mode, Save, accessibility |
| `src/features/files/markdown-editor-adapter.ts` | CodeMirror editable, raw line endings, history, selection và disposal |
| `src/features/files/markdown-editor-adapter.test.ts` | Adapter/transaction tests thực qua EditorState và view factory giả |
| `src/features/files/markdown-preview.tsx`, `src/features/files/markdown-preview.test.tsx` | Render Markdown/GFM an toàn và trạng thái rỗng |
| `src/features/files/markdown-conflict-dialog.tsx`, `src/features/files/markdown-conflict-dialog.test.tsx` | Hai lựa chọn explicit, revision và focus |
| `src/features/files/file-handle-registry.ts`, `src/features/files/file-handle-registry.test.ts` | Một owner draft/mode/queue/save/conflict xuyên remount |
| `src/features/files/file-handle-provider.tsx`, `src/features/files/file-handle-provider.test.tsx` | Đăng ký bridge producer và cleanup |
| `src/features/files/file-handle-context.ts`, `src/features/files/index.ts` | Public Files boundary |
| `src/features/files/file-pane.tsx`, `src/features/files/file-pane.test.tsx` | Header/body Markdown, retained recovery draft |
| `src/features/files/file-error-copy.ts`, `src/features/files/file-error-copy.test.ts` | Copy cho lỗi update/save/resolve |
| `src/lib/ipc/files.ts`, `src/lib/ipc/files.test.ts` | Ba wrapper thật update/save/resolve |
| `src/lib/ipc/file-edit-boundary.ts`, `src/lib/ipc/file-edit-boundary.test.ts` | Đăng ký callback producer; preflight tại các wrapper lifecycle, không lưu draft/business state |
| `src/lib/ipc/sessions.ts`, `src/lib/ipc/sessions.test.ts` | Flush trước impact/close và Save-and-close frontend orchestration |
| `src/lib/ipc/projects.ts`, `src/lib/ipc/projects.test.ts` | Flush trước remove impact/remove và locate folder |
| `src/lib/ipc/app-lifecycle.ts`, `src/lib/ipc/app-lifecycle.test.ts` | Flush trước request/confirm Quit |
| `src/lib/ipc/data-management.ts`, `src/lib/ipc/data-management.test.ts` | Flush trước reset preview |
| `src/features/sessions/use-workspace-mutations.ts`, `src/features/sessions/use-workspace-mutations.test.ts` | Save-and-close intent, không close khi save chưa hoàn tất |
| `src/features/sessions/close-target-dialog.tsx`, `src/features/sessions/close-target-dialog.test.tsx` | Ba nút và failure trong dialog |
| `src/features/sessions/session-workspace.tsx`, `src/features/sessions/session-workspace.test.tsx` | Nối callback Save-and-close |
| `src/features/sessions/session-tab.tsx`, `src/features/sessions/session-tab.test.tsx` | Render dot có accessible label qua prop riêng, không sửa generated TabDto |
| `src/features/sessions/session-tab-strip.tsx`, `src/features/sessions/session-tab-strip.test.tsx` | Chỉ báo dirty cả khi snapshot buffer đang pending |
| `src/app/session-terminal-route.tsx`, `src/app/session-terminal-route.test.tsx` | Truyền isActive/onActivate/platform/boundary cho FilePane |
| `src/app/app-shell.test.tsx` | Cô lập số lần refresh Quit giữa các scenario shell sau khi tray luôn reconcile Files |
| `src/app/quit-store.ts`, `src/app/quit-store.test.ts` | Reconcile tray request sau flush, giữ dialog khi producer thất bại |
| `src/app/data-management-bridge.tsx`, `src/app/data-management-bridge.test.tsx` | Settle Files trong beforeConfirm, clear chỉ sau reset commit |
| `src/bindings/files/files.ts`, `src/bindings/sessions/sessions.ts`, `src/bindings/app-lifecycle.ts` | DTO generated chỉ đọc |
| `src/features/files/source-view-adapter.ts`, `src/features/files/source-language.ts`, `src/features/files/file-facts.ts` | Tái dùng theme/highlight, language threshold và facts; chỉ đọc |
| `src-tauri/tests/files_markdown_save_commands.rs`, `src-tauri/tests/export_bindings.rs`, `src-tauri/tests/app_builder.rs` | Gate public backend hiện có, chỉ đọc |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| FilePane header | Path, segmented Edit/Preview, Save, amber Unsaved changes; flex wrap ở pane hẹp để không che nút close | `#md-edit`, `#md-unsaved` |
| MarkdownEditor | CodeMirror có line number, syntax, selection, undo/redo; English accessible name `Markdown editor: {name}` | `#md-edit` |
| MarkdownPreview | Heading, list, quote, code, table, strikethrough, task list; nội dung mới nhất kể cả chưa acknowledge | `#md-preview` |
| Status bar | Facts UTF-8/BOM/line endings/lines từ backend cho snapshot ack, `Unsaved changes` cho draft; chỉ hiện thời điểm Save thật khi có kết quả Save | `#md-unsaved` |
| MarkdownConflictDialog | Tên file, external modified time/size (null time: `Unknown`), editCount/dirtySinceMs có thật | `#md-conflict` |
| CloseTargetDialog | Tên tab/pane, backend impact và ba nút; multi-file liệt kê labels, không giả edits count | `#md-unsaved` |

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Đang tải | Chưa có snapshot/adapter hoặc preview chunk | `Opening file…` / `Loading editor…`, aria-busy, Save disabled; lỗi chunk có Retry |
| Rỗng | Text rỗng | Editor nhập được; Preview `This file is empty. Switch to Edit to add Markdown.` và nút Edit |
| Sạch | Ack clean và không local pending | Save disabled; không dot |
| Chưa lưu | Backend isDirty hoặc local text chưa ack | Dot tab + label header + status, Save có thể flush rồi lưu |
| Đồng bộ | Một update in-flight | Vẫn nhập và Preview; dirty optimistic không biến mất vì response cũ |
| Đang lưu | Save đang chạy | `Saving…`, chống double submit; vẫn nhận edit mới, giữ dirty nếu còn newer edits |
| Xung đột | externalConflict | Giữ draft, Save disabled, banner `This file changed on disk.` + `Resolve conflict`; dialog khi pane active, không cướp focus từ dialog khác |
| Missing/unreadable | Có local | Giữ editor/preview local, thông báo path/name, Retry query/reload không discard, Save disabled |
| Root changed | state không chứa local | Giữ recovery draft đã render trong registry, cho chọn/copy và tiếp tục sửa runtime nếu backend chấp nhận, Save disabled; Open project để mở lại qua Explorer |
| Lỗi update/save | Typed error/transport | Giữ toàn bộ draft; thông báo tên file, Retry thích hợp; không tự close hoặc clear dirty |
| Retired | fileHandleNotFound xác thực | Không Save; close pane/reopen. Không xóa draft chưa ack chỉ do transport failure |
| Boundary bận | Close/data/Quit admission lease | Không nhận transaction mới/Save/resolve; vẫn hiển thị và copy được; hủy/failure mở lại editor |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Edit/Preview | Mode registry đổi, không đọc disk/ghi file; giữ raw draft/selection/edit scroll và preview scroll riêng | Tab, Enter/Space; segmented có aria-pressed |
| Nhập/undo/redo | Draft local cập nhật ngay; first change invoke ngay, coalesce tối đa một pending snapshot | Ctrl/Cmd+Z, redo platform |
| Save | Flush latest draft; chỉ save ack revision; no-op khi sạch | Ctrl/Cmd+S scoped như quyết định |
| Resolve → Keep my version | Flush rồi resolve keepMine tại revision mới nhất; giữ dirty, không Save | Bàn phím dialog |
| Resolve → Reload from disk | Giữ admission lock, resolve reloadFromDisk; chỉ thay draft/history sau success | Bàn phím dialog |
| Escape/outside conflict | Đóng dialog nhưng giữ conflict/banner, không ngầm chọn KeepMine | Escape |
| Close tab/pane | Flush, backend impact, nếu dirty thì dialog ba nút | Existing close shortcuts |
| Discard changes | Explicit confirmed close, chỉ bỏ draft sau backend close success | Enter trên nút |
| Save and close | Lưu các Markdown handle thuộc target tuần tự, re-query impact, close chỉ khi mọi file sạch | Enter trên nút |

Focus ring rõ, tooltip cho icon không nhãn, thông báo lỗi role alert, Save thành công aria-live polite duy nhất body; màu theo Appearance variables hiện có. Preview có contrast theo UI theme, không hardcode dark-only palette.

## Luồng chính

1. Header/body retain cùng registry entry. Khi nhận ready text mode markdown, dựng UI state từ ack. Giữ EditorState/history/selection ở entry khi rời Edit, không giữ DOM EditorView đã unmount.
2. Transaction cập nhật raw draft và local generation đồng bộ. Entry gọi update snapshot đầu ngay, giữ một request in-flight; các transaction sau chỉ thay queued text. Không debounce first edit. Trước request capture cả expectedRevision và **baseDiskRevision của text đã render**, không thay base theo event mới trước khi draft được giải quyết.
3. Response/event/query apply theo revision decimal bằng BigInt, không Number. Ack chỉ clear local pending nếu generation/text tương ứng; snapshot cũ không thay draft mới. Event là invalidation không content; query không được ghi đè draft chưa ack. Remote auto-reload clean thay editor/history; khi có local draft, giữ draft và để update BE-015 tạo conflict.
4. RevisionConflict: query latest, giữ draft; retry một lần chỉ sau reconcile token và khi base gốc vẫn hợp lệ; không retoken draft qua external/explicit resolution để biến stale intent thành quyền ghi. Nếu vẫn không xác định được, báo Retry/Resolve và giữ draft. Transport error có thể đã apply: query trước retry, so sánh ack text, không lặp vô hạn.
5. Save flush tới generation hiện tại rồi gọi save_markdown_file. SavedWithNewerEdits hoặc generation mới sau request không được báo sạch; cập nhật base cho edits hậu Save nhưng không thay draft. AtomicCommitStateUnknown query/reconcile trước Save khác, không auto replay write. Thành công chỉ thông báo `Saved` khi sạch, còn newer edits: `Saved. Newer changes are not saved yet.`
6. Conflict giữ draft local. Flush trước resolve; khóa transaction trong resolve. fileChangedAgain/revisionConflict re-query và yêu cầu người dùng chọn lại, không retry lựa chọn destructive tự động. Reload success thay text, base, reset history; KeepMine success giữ text/history, cập nhật base theo snapshot ready, không gọi save.
7. Lifecycle qua bridge ở dưới bảo đảm editor transaction đang pending không bị backend impact bỏ sót. Chỉ retire entry sau backend xác nhận close/reset hoặc query not-found, không khi route unmount. Registry không evict handle Markdown còn mở, mode/history hoặc pending draft theo giới hạn LRU viewer cũ; cleanup theo lifecycle và backend bounded handle count.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| `update_markdown_buffer` | `UpdateMarkdownBufferRequestDto` | `FileHandleDto` | revisionConflict → reconcile; size/memory → giữ draft, giảm nội dung/đóng file khác; operationUnavailable → Retry |
| `save_markdown_file` | `SaveMarkdownFileRequestDto` | `SaveMarkdownFileResultDto` | externalChangeDetected → query conflict; write/sync/replace/notWritable → giữ draft và Retry; atomicCommitStateUnknown → reconcile trước retry |
| `resolve_external_file_change` | `ResolveExternalFileChangeRequestDto` | `FileHandleDto` | fileChangedAgain/revisionConflict/noExternalConflict → query và render state thật |
| `get_open_file`, `reload_open_file` | `FileHandleRequestDto` | `FileHandleDto` | Existing FE-017; unsavedChangesWouldBeLost không được bypass bằng reload |
| `get_close_impact`, `close_runtime_target` | Existing generated target/confirmed | `CloseImpactDto`, `CloseResultDto` | Existing lifecycle copy; error không làm mất draft |
| Các command project/Quit/reset đã có | Existing wrappers/DTO, giữ envelope | Existing result | Chạy preflight producer trước effect; không tự map lỗi Files thành thành công lifecycle |

Ba wrapper mới trong files.ts: `updateMarkdownBuffer(request): Promise<FileHandleDto>`, `saveMarkdownFile(request): Promise<SaveMarkdownFileResultDto>`, `resolveExternalFileChange(request): Promise<FileHandleDto>`; request types import đúng generated types có cùng tên. Giới hạn backend 5_242_880 bytes gồm BOM; FE chặn transaction vượt giới hạn trước khi nhận vào draft bằng UTF-8 byte count, giải thích giới hạn, không cắt nội dung. Backend vẫn validate authority. Không log text/file content.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| `files://handle-changed` | `FileHandleChangedEventDto` | Sau backend mutation | Registry listener hiện có query/coalesce; xử lý editorUpdated/saved cùng watcher kinds |
| `quit_requested` | `QuitRequestDto` | Tray/native quit | Chặn editor, flush trước hiển thị facts cuối, refresh request nếu summary cũ; không confirm tự động |
| Data reset/import | Existing data event | Commit/uncertain | Clear draft chỉ reset committed; import và uncertain giữ draft/reconcile |

Không thêm listener per editor, không polling timer FE. Native Quit vẫn yêu cầu confirmation khi sessionCount > 0; Markdown có pane tức có session, nên tray request không bypass dialog vì first-update đang pending.

## State frontend

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| handle/revision/isDirty/disk | Backend snapshot | Không parse disk token; revision so bằng BigInt |
| draft, rendered base token, local generation, ack generation | UI tạm thời tại registry entry | Không persistence, không log; không xóa bởi query/event stale |
| mode, EditorState/history/selection, hai scroll offsets | UI tạm thời theo handle | Sống qua unmount và đổi Settings |
| update promise/queued snapshot, save/resolve pending | UI transport state | Một update in-flight; lifecycle đợi settle |
| boundary lease count/retired generation | UI admission | Chặn transaction trong thao tác destructive; release idempotent |
| dirty tab projection | UI optimistic + backend | Đọc entries thuộc tab qua callback bridge; OR với backend dirty, không viết DTO giả |

## Contract công khai của feature

- `FilePaneProps` giữ contract FE-017 và bổ sung `isActive: boolean`, `onActivate(): void`, `platform: ShortcutPlatform`, `boundary: FileExplorerBoundary`, `readBoundary(): FileExplorerBoundary`. App truyền từ SessionFilePaneSlotProps và data/Quit owner hiện có.
- Registry mở rộng actions `setMarkdownText(text: string): void`, `setMarkdownMode(mode: "edit" | "preview"): void`, `flushMarkdown(): Promise<void>`, `saveMarkdown(): Promise<void>`, `resolveMarkdown(resolution: ExternalFileResolutionDto): Promise<void>` trên entry. Mỗi method implementation phải có purpose comment English.
- `useFileDataBoundary()` bổ sung `settleBeforeDataChange(): Promise<void>` và `releaseDataChangeBarrier(): void`; beforeConfirm của DataManagementHost claim Files cùng settings owners, release khi thành công/failure theo lifecycle hiện có.
- `src/lib/ipc/file-edit-boundary.ts` chỉ có callback bridge nhiều consumer (Sessions, Projects, Quit, Data), không chứa Files implementation/draft. `FileEditScope` là UI union `CloseTargetDto | { kind: "project"; projectId: string } | { kind: "all" }`, không phải DTO.
- Bridge `registerFileEditBoundary(callbacks): () => void` nhận `settle(scope): Promise<() => void>`, `save(scope): Promise<void>`, `hasPendingEdits(scope): boolean`, `subscribe(listener): () => void`, và callback tùy chọn `retire(scope): void` để thông báo close/remove đã commit. Callback retire không chạy sau lỗi hoặc chỉ preview impact. `settle` claim synchronously trước await, khóa transaction rồi flush; release callback idempotent. Không có provider khi tests wrapper độc lập thì no-op; app provider luôn đăng ký trước editor nhận input. Không dùng process environment/global mutable fixture để cô lập test; test tạo bridge instance riêng qua factory.
- Wrapper `getCloseImpact`, `closeRuntimeTarget`, `getRemoveProjectImpact`, `removeProject`, `locateProjectFolder`, `requestQuit`, `confirmQuit`, `prepareResetXwork` dùng bridge settle scope đúng, release finally. Preflight failure không invoke operation đích. Close mutation giữ lock qua response; impact release sau query, confirm settle lại. Chỉ Files producer callback cần biết entries; wrappers không import feature.
- `saveFilesBeforeClose(target: CloseTargetDto): Promise<void>` trong sessions IPC module là orchestration frontend qua bridge save, không thêm Tauri command. Hook Save-and-close giữ target lease xuyên save → impact → close (nested settle refcount được phép), re-query cả handles/impact sau Save, không close khi còn dirty hoặc conflict. Nếu target có handle chưa từng được registry load, lấy IDs từ SessionDetailDto qua getSession đã có, không dùng impact labels làm ID. Save tuần tự các handles; partial save thất bại giữ target mở, file đã save vẫn saved.
- Tab strip subscribe bridge theo scope tab để hiển thị optimistic dot ngay transaction đầu; dùng public bridge, không import Files. Callback trả true khi có local pending **hoặc** handle.isDirty trong registry; SessionTab nhận prop `hasUnsavedChanges: boolean`, không suy từ active pane duy nhất. Dot có nhãn `Unsaved changes`; query backend session facts tiếp tục là authority khi không có pending local edits.
- `quit-store` nhận tray request khóa producer, flush rồi gọi requestQuit để có summary mới trước confirmation. Nếu flush thất bại giữ dialog/failure và không confirm; Cancel release. Settings reset/import claim Files trong beforeConfirm và giữ đến reconciliation; reset preview flush qua wrapper để impact đúng.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| External edit đúng lúc gõ first char | Preserve raw draft/base cũ, BE-015 watcher-race conflict, không auto replace editor |
| Nhiều handle cùng path | Không share draft/mode theo path; Save một handle gây query watcher cho handle khác |
| Save với edit mới trong flight | Không rollback hoặc clear dirty; close chưa được phép |
| Không ack do transport/size/memory | Không close bypass; UI cho sửa giảm text rồi Retry, hoặc Cancel flow; explicit discard chỉ khi latest accepted draft đã được impact phản ánh |
| Reset uncertain | Không clear cache/draft; refresh backend, giữ generation chống response cũ |
| Project root đổi | Không lấy external token/root mới để Save draft cũ; giữ recovery snapshot |
| Missing file xuất hiện lại | Retry qua BE-014, dirty luôn tôn trọng unsavedChangesWouldBeLost/conflict |
| Mixed CRLF/LF, emoji, IME | Giữ bytes ngoài range sửa, UTF-16 offset ↔ raw mapping đúng, không save giữa composition chưa hoàn thành; Save chờ compositionend |
| Preview lớn | Lazy render theo mode; syntax dùng threshold FE-017; không chuyển 5 MiB editor thành giới hạn preview nhỏ hơn im lặng |
| Mode reload từ disk | Giữ mode; history clear chỉ explicit/clean authoritative replacement để Undo không khôi phục version đã discard |
| Save-and-close conflict | Giữ close dialog, nêu file cần resolve; Cancel quay lại pane để Resolve, không stack hai modal |

## Tiêu chí hoàn thành

- [ ] Bốn anchor wireframe có state tương ứng; chỉ một mode hiện, mode sống qua Settings/tab/route.
- [ ] File thật chỉ thay đổi sau Save; revert bytes sạch, BOM/line ending/trailing newline được giữ.
- [ ] First-edit close, tray Quit, project removal, reset và Save-and-close không mất pending draft; failure không invoke close/confirm.
- [ ] External conflict chỉ resolve bằng lựa chọn explicit; KeepMine không write, Reload chỉ discard sau success; stale choice không replay.
- [ ] Unit/component dùng dependency injection, deferred promise, EditorState thật và view factory giả; không desktop E2E.
- [ ] Frontend format/lint/typecheck/tests/build; Rustfmt, Clippy all-targets/all-features warnings denied, Rust tests và Windows Tauri build pass, Cargo `-j 2`.
- [ ] Manual Windows smoke ghi bằng chứng khi có native control; nếu không khả dụng ghi `Blocked`, không báo pass. macOS hoãn release.

## Kiểm thử

Mọi test file trong File liên quan chạy bằng `pnpm test`; focused groups ghi trong plan. Các case bắt buộc: queue coalescing/stale response, query vượt update, watcher-race, mode/remount, line endings/undo/IME, safe GFM, conflict revision, first-edit impact, partial multi-file Save-and-close, restore focus, active shortcut, producer registration failure/cleanup, data/Quit flush failure. Listener registration reject bằng dependency `onFileHandleChanged` promise reject: pane vẫn query/retry/focus recover được, draft không mất.

Backend gate giữ nguyên test temp-root/isolated service trong files_markdown_save_commands; frontend chỉ fake invoke/adapter trong test, không chạm app data/project thật. Native smoke dùng project tạm do người chạy tạo, không dùng repo hoặc file cá nhân: Edit→Preview→Save, BOM/CRLF, hai handle, external conflict Keep/Reload, đóng tab/pane/session/remove project, Settings/reset Cancel, tray Quit Cancel. Không reset dữ liệu thật để smoke.

## Ghi nhận triển khai ngày 2026-09-08

- App truyền active pane, platform, callback activation và boundary hiện hành vào Files; các prop bổ sung để optional nhằm giữ tương thích fixture/source viewer cũ. Runtime không dùng mock.
- Preview tải bằng dynamic import có loading/error/Retry; raw editor history dùng CodeMirror StateField và inverted effects. Giữ syntax threshold FE-017 là 2 MiB hoặc 20.000 dòng, không thêm giới hạn preview nhỏ hơn.
- Sau close/remove thành công, wrapper báo retire đúng scope để registry giải phóng cả Markdown đã unmount; trước impact, registry đợi query đầu của handle chưa rõ identity. Dialog conflict trả focus explicit về control đã mở nó.
- Tray luôn settle producer đã đăng ký, kể cả composition chưa tạo dirty flag. Native smoke đang **Blocked** vì API điều khiển native bị tắt; không suy diễn từ build thành pass.
- Automated Windows gates pass, gồm 134 module / 2.428 frontend tests và Tauri release build. Chi tiết bằng chứng, các lần fail trước khi sửa và deviation red-first được ghi trong plan đang triển khai.

## Câu hỏi mở

Không có.
