# FE-020 — Quick Note

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-020` |
| Phase | `3`; tài liệu này chốt biến thể nhúng Home của giai đoạn 18 |
| Khu vực chính | `src/features/notes/` |
| Yêu cầu chức năng | §12.3; §6, §12.1, §17.6, §18 |
| Wireframe | `00-Docs/01-Wireframe/03-Home.html#full`, `#saved`, `#invalid`, tham chiếu thêm `#empty`; `00-Docs/01-Wireframe/06-Notes.html#quick-note` chỉ để phân ranh giai đoạn 19 |
| Backend liên quan | `BE-016`, public Projects; Data/Lifecycle hiện hữu |
| Phụ thuộc | `FE-003`, `FE-019` đã tích hợp BE-016 thật |

## Mục tiêu

Người dùng nhập title tùy chọn, nội dung Markdown và project tùy chọn ngay trên Home, chọn Save để tạo một note thật hoặc Cancel để bỏ bản nháp. Thành công làm trống composer, cung cấp Open note và cập nhật Notes/Home/Project qua cơ chế invalidation hiện hữu.

### Ngoài phạm vi

- Cửa sổ nổi, mở cửa sổ từ Home, global shortcut, tray và BE-017 thuộc giai đoạn 19; không thiết kế implementation hoặc đăng ký điểm vào của phần đó trong tài liệu này. FE-020 mới hoàn thành biến thể Home sau giai đoạn 18, chưa hoàn thành toàn FE-020 hoặc §20 Phase 3.
- Autosave Quick Note, preview/toolbar Markdown, attachment, persist draft, clipboard API, thay lifecycle native, dependency/DTO/command/event/migration/capability mới.
- Welcome vẫn theo FE-019 khi thực sự không có project/note. Không bổ sung điểm vào floating Quick Note cho Welcome; người dùng có thể tạo note ở Notes rồi dùng Home. Không thay thuật toán Search, backup hoặc danh sách Notes đã triển khai.

### Quyết định đã chốt

Người dùng ủy quyền chốt ambiguity trong scope. Save thủ công của wireframe được ưu tiên cho draft Quick Note; autosave §12.1 vẫn áp dụng editor Notes sau khi tạo. Cancel trên Home được bổ sung theo yêu cầu người dùng dù wireframe Home chỉ minh họa Save. Composer dùng input title và textarea Markdown có label; không cần CodeMirror/preview cho form capture đơn giản. Palette/font/token và bố cục bám Home hiện hữu; không cài form/editor dependency được liệt kê định hướng trong Tech Stack nhưng chưa cần ở đây.

Quick draft được giữ riêng trong NotesProvider hiện hữu, không dùng draft autosave của NotesRoute và không gọi select/install/edit/flush để tạo Quick Note. Nhờ vậy người dùng không làm mất note đang sửa khi trở Home. Quick draft chỉ là bộ nhớ trong lần chạy; không hứa sống qua crash, force exit hoặc Quit. Ẩn xuống tray và đổi route giữ draft, tuyệt đối không tự Save.

## File liên quan

Đường dẫn source/test được phép chạm chỉ gồm các hàng implementation dưới đây. Các hàng contract/gate chỉ đọc hoặc chạy kiểm tra; không sửa backend/binding để phục vụ form đã có API đủ dùng.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/notes/quick-note-composer.tsx` | Form nhúng và feedback, public component |
| `src/features/notes/quick-note-composer.test.tsx` | Component validation, Save/Cancel, keyboard, project và recovery |
| `src/features/notes/notes-provider.tsx` | Retain quick draft, single flight, maintenance barrier và invalidation |
| `src/features/notes/notes-provider.test.tsx` | Quick draft lifetime, races và không ảnh hưởng autosave |
| `src/features/notes/index.ts` | Export QuickNoteComposer |
| `src/features/notes/note-actions.tsx` | Reuse useNoteProjects nội bộ; bổ sung loading nếu cần để báo đúng query state |
| `src/features/notes/note-actions.test.tsx` | Project choices regression nếu hook được mở rộng |
| `src/features/notes/notes-test-fixture.tsx` | Fixture IPC/provider cô lập |
| `src/app/home-entry.tsx` | Inject composer vào quickNoteSlot và live admission guard |
| `src/app/home-entry.test.tsx` | Composition thật, navigation, maintenance/Quit race |
| `src/app/data-management-bridge.test.tsx` | Public Notes barrier bao gồm quick draft khi Home unmount |
| `src/features/home/home-screen.test.tsx` | Slot trước Notes, responsive/regression |
| `src/features/home/home-route.test.tsx` | Welcome/presence regression |
| `src/features/notes/note-sections.test.tsx` | Command result invalidates Home/Project projections |
| `src/app/search-entry.test.tsx` | Regression mở note tạo từ Home |
| `src/app/project-overview-entry.test.tsx` | Regression linked note integration |
| `src/lib/ipc/notes.ts`, `src/lib/ipc/notes.test.ts`, `src/lib/ipc/projects.ts` | Public wrapper và contract tests hiện hữu |
| `src/bindings/notes.ts`, `src/bindings/projects/projects.ts` | Generated DTO authority |
| `src/features/home/home-route.tsx`, `src/features/home/home-screen.tsx` | Slot/presence contract sẵn có, chỉ đọc |
| `src/app/data-management-bridge.tsx` | Public maintenance composition sẵn có, chỉ đọc |
| `src-tauri/src/notes/commands.rs`, `src-tauri/src/notes/models.rs`, `src-tauri/src/notes/service.rs` | Public backend contract/validation, chỉ đọc |
| `src-tauri/tests/notes_contract.rs`, `src-tauri/tests/unified_search_contract.rs`, `src-tauri/tests/data_management_contract.rs`, `src-tauri/tests/export_bindings.rs` | Regression gates hiện hữu |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| QuickNoteComposer | Đầu cột viết trước Pinned/Recent; title optional, multiline body, Project select, Save/Cancel | Home full/empty |
| Feedback trong composer | Alert field lỗi; success màu theo token với Open note, không chiếm focus | Home invalid/saved |

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Empty | Title/body rỗng, project null | Placeholder `Title (optional)`, `Write a note… Markdown works here.`; Save vẫn có thể submit để chỉ lỗi body; Cancel disabled |
| Editing | Có bất kỳ input hoặc project | Không autosave; helper `Saved notes appear in Notes and on the linked project.` |
| Project loading/error/empty | Public project query đang tải/lỗi/không row | Status hoặc `Could not load projects` + Refresh; `No project` luôn dùng được; không chặn tạo unlinked |
| Invalid | Body whitespace, title control/quá dài hoặc body quá lớn | Alert cạnh field, aria-invalid/describedby, focus field lỗi đầu tiên; không create khi validation frontend xác định lỗi |
| Saving | Một create đã được nhận | `Saving…`, aria-busy, freeze fields/Save/Cancel; không timeout/retry tự động |
| Saved | NoteDto acknowledged | Reset title/body/project, `Note saved` và `Open note`; không tự navigate; feedback giữ đến edit/Cancel/lần Save mới hoặc maintenance |
| Known error | Typed failure bảo đảm chưa commit | Giữ mọi input, English copy từ noteErrorCopy; sửa rồi Save hoặc Retry Save explicit |
| Uncertain | Transport/rejection không có typed NotesError | `Could not confirm creation. Check Notes before creating another note.`; giữ text read-only để copy thủ công, Save disabled, Open Notes và Cancel; không tự tạo lại |
| Suspended | Data barrier hoặc app Data/Quit suspended | Disable mọi mutation, giữ text/feedback; query lỗi không giả empty |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| Nhập title/body | Chỉ quick draft; newline Markdown được giữ nguyên | Tab theo thứ tự title → body → project → Cancel → Save; textarea Enter xuống dòng |
| Chọn project | ID opaque hoặc null; unavailable registered project vẫn hợp lệ | Native select keyboard |
| Save | Validate, claim flight đồng bộ rồi gọi createNote đúng một lần | Enter/Space tại Save; không đăng ký Ctrl+S/global shortcut, Enter title không submit ngoài ý muốn |
| Cancel | Bỏ quick draft và feedback, reset project, focus body nếu composer còn mount | Enter/Space tại Cancel; không Escape global hoặc dialog thứ hai |
| Cancel khi uncertain | Nhãn Cancel kèm giải thích `This only discards the local draft; a saved note may already exist.`; không xóa record backend | Native button keyboard |
| Open note | Navigate `/notes?noteId=...&view=active`; FE-019 getNote xác thực lifecycle thực | Link keyboard; không replace draft Notes chưa giải quyết |
| Open Notes khi uncertain | `/notes`, giữ quick draft trong provider để người dùng kiểm tra | Link keyboard |
| Refresh projects | owner.invalidate re-query, giữ selection/text; không replay create | Button keyboard |

Success/Cancel focus body chỉ khi focus còn thuộc composer tại lúc hoàn tất; không lấy focus khỏi sidebar/dialog/route khác. Không autofocus khi Home mount. Feedback success role=status polite, error role=alert; icon có accessible name/tooltip nếu dùng. Footer wrap khi hẹp; textarea min-width:0/width:100%, font/theme token và focus visible; không dùng màu làm dấu hiệu lỗi duy nhất. Không cần animation mới.

## Luồng chính

1. HomeEntry compose public QuickNoteComposer dưới NotesProvider qua slot sẵn có; Home không import Notes. Truyền suspended và callback đọc Data/Quit đồng bộ giống readBoundary hiện tại, kiểm tra trước Save/Cancel để tránh stale render admission. Owner kiểm tra blocked/quickFlight đồng bộ trước mutate.
2. Capture title/body/project khi Save hợp lệ; disable edit suốt flight nên không có generation text mới bị acknowledgment xóa. Chỉ quick flight bị serialize với chính nó; draft autosave Notes là note khác và giữ queue riêng. Maintenance phải đợi cả hai; không tạo generic queue/registry mới.
3. Gọi createNote với generated CreateNoteInputDto. Body trim chỉ dùng kiểm tra ban đầu, gửi nguyên text. Title rỗng gửi null; backend trim/normalize title là authority. Frontend kiểm tra title trimmed ≤255 Unicode scalar, control U+0000–001F/U+007F–009F và body ≤1.048.576 byte UTF-8; backend quyết định cuối cùng cho Unicode whitespace/validation. Không dùng maxlength UTF-16 để thay scalar rule.
4. Chỉ NoteDto thành công làm sạch quick draft và đặt savedNote. owner.invalidate ngay sau ack, kể cả notes event đăng ký lỗi; Home/Project/Notes re-query thật, không chèn row optimistic hoặc thay backend order. Lỗi query sau ack không biến save thành failure; hiển thị lỗi section và cho Refresh, không create lại. Open note dùng ID acknowledged, không đoán ID từ event/search/text match.
5. Typed invalid_project_id/project_not_found giữ selected ID và yêu cầu chọn lại hoặc No project; danh sách thiếu selected ID hiện `Project unavailable`, không tự unlink/swap. Project removed giữa query và Save do backend xác nhận; refresh choices không xóa draft. Lỗi clock/persistence cho Save explicit; lỗi integration unauthorized/unexpected typed error hiển thị safe copy, không auto-loop. Unknown outcome invalidate để kiểm tra list nhưng không coi event/list match là acknowledgment; muốn viết note mới phải Cancel rõ ràng trước rồi nhập/Save bằng ý định mới.
6. Data settleBeforeDataChange claim blocked đồng bộ, đợi quickFlight đã nhận, rồi từ chối nếu quick draft còn bất kỳ title/body/project hoặc uncertain/known-error state cần giải quyết. Message `Save or cancel the Quick Note on Home before changing app data.` được giữ để Home hiển thị; public promise reject khiến bridge không confirm và release barrier theo cơ chế hiện có. Không tự Save Quick Note trong flush/hidden/maintenance. Draft rỗng cho qua; Save đã ack cho qua. Không deadlock khi blocked được claim trong flight: acknowledgment của flight đã nhận vẫn được settle.
7. clearAfterReset và refreshAfterDataChange retire quick lifetime, clear saved feedback trước navigation/re-query; callback cũ không hồi sinh draft/success sau epoch reset. Unknown maintenance outcome chỉ đọc lại và không replay create; barrier không được mở sớm. Hook public useNotesDataBoundary giữ chữ ký hiện hữu; bridge production không cần owner mới. Navigation/hidden chỉ unmount view, quick state tồn tại provider; query/listener cleanup sẵn có không bị nhân đôi.

## Contract với backend

### Command sử dụng

| Command | Input | Output | Lỗi cần xử lý trên UI |
|---|---|---|---|
| create_note qua createNote | `{ input: CreateNoteInputDto }` | NoteDto | invalid_title, empty_initial_content, content_too_large; invalid_project_id/project_not_found; clock_failed/persistence_failed; unauthorized_window; transport unknown |
| list_projects qua listProjects | Không input | ProjectDto[] | Query failure: Refresh, vẫn cho No project |
| list_notes/get_note | Do FE-019 projections/route hiện hữu gọi sau invalidation/navigation | Generated Notes DTO | Query failure/missing/lifecycle do FE-019 xử lý |

Toàn bộ DTO lấy từ bindings, wrapper invokeCommand hiện hữu; không direct invoke/mock runtime, log nội dung hoặc browser persistence. Các NotesError không dự kiến cho create được trình bày qua noteErrorCopy như lỗi tích hợp, giữ text, không retry tự động.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nào nhận | UI phản ứng |
|---|---|---|---|
| notes://changed | NoteChangedEventDto | NotesProvider subscription hiện hữu | Invalidate projections, không acknowledge unknown create bằng event |
| projects://changed | ProjectChangedEventDto | NotesProvider subscription hiện hữu | Refresh choices, không thay input tự động |

Composer không đăng ký native listener hoặc channel riêng; duplicate/out-of-order sequence và late unlisten theo FE-019.

## State frontend

```ts
/** Retain one manually submitted Home draft independently of the Notes editor. */
interface QuickNoteState {
  title: string;
  contentMarkdown: string;
  projectId: string | null;
  phase: "empty" | "editing" | "saving" | "error" | "uncertain" | "saved";
  message: string | null;
  savedNote: NoteDto | null;
  identity: number;
}
```

NotesOwner Snapshot thêm `quickNote: QuickNoteState`; owner giữ `quickFlight: Promise<void> | null`. Internal methods: `editQuickNote(patch: Partial<Pick<QuickNoteState, "title" | "contentMarkdown" | "projectId">>): void`, `saveQuickNote(): Promise<void>`, `cancelQuickNote(): void`. Các method không export qua index; component cùng feature dùng useNotes. Lifetime identity retire khi Cancel/maintenance; captured flight phải kiểm tra identity trước publish. Validation alert theo field thuộc component hoặc state tối thiểu; không tạo business DTO riêng.

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Quick text/phase/identity/flight | NotesProvider UI memory | Độc lập NoteDraft và autosave timer |
| Saved note/choices | Backend acknowledgment/query | Snapshot tạm; ID và project authority Rust |
| Data/Quit admission | App composition + Notes blocked | Read live trước mutation, không import app/settings trong Notes |

## Contract công khai của feature

```ts
/** Render the manually saved Quick Note form in an app-owned Home slot. */
export function QuickNoteComposer(props: {
  suspended: boolean;
  readSuspended(): boolean;
}): React.JSX.Element;
```

Chỉ index export component thêm vào public API. HomeEntry truyền `quickNoteSlot` đã có; không thay Home public shape. useNotesDataBoundary vẫn giữ settleBeforeDataChange, releaseDataChangeBarrier, clearAfterReset, refreshAfterDataChange và reconcileAfterResetFailure cùng chữ ký FE-019; semantics được mở rộng để bao gồm quick draft.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Double click/Enter liên tiếp | Lock đồng bộ, một create; event không tạo lần thứ hai |
| IME đang composition | Save bị chặn đến compositionend; không dùng key Enter IME để submit |
| Cancel/edit trong flight | Disabled và owner no-op; ack không xóa input lifetime khác |
| Notes autosave draft đang dirty khi viết Quick Note | Hai draft độc lập; quick success không install/select Notes draft |
| Ra route khác trước ack | Giữ quick flight/provider, invalidate sau ack, không focus/navigate route cũ |
| Data claim cùng tick Save | Thứ tự admission quyết định: accepted flight được đợi, Save sau claim không invoke |
| Title-only/project-only/whitespace draft khi import/reset | Chặn confirm, hướng dẫn Save/Cancel; không autosave invalid draft |
| Query/event lỗi sau create ack | Saved vẫn đúng; section Refresh không tạo lại note |
| Crash/force exit/immediate tray Quit | Chỉ dữ liệu đã ack được bảo đảm lưu; native lifecycle hiện hữu, không thêm flush bảo đảm hoặc native hook |

## Tiêu chí hoàn thành

- [x] Save optional-title Markdown/project tạo đúng một note thật; invalid/Cancel không create, success reset và Open note đúng ID.
- [x] Notes/Home/Project projections cập nhật từ command result và event; Search mở note đúng qua public FE-019/BE-016.
- [x] Draft tồn tại qua route/hidden, không autosave; Notes draft độc lập; unknown create không replay; maintenance barrier và late response không hồi sinh dữ liệu.
- [x] Keyboard/IME/focus/loading/error/responsive có component coverage và checklist Windows native riêng.
- [x] Frontend format/lint/typecheck/test/build; Rustfmt, Clippy all-targets/all-features warnings denied, Rust all-targets/all-features tests và explicit contract targets; Windows Tauri build pass. Cargo build/test/Clippy dùng `-j 2`, full Rust tests `-- --test-threads=1` theo regression hiện hữu.
- [x] Diff kiểm tra không có backend/manifest/generated binding/capability/registration mới; không import chéo feature hoặc mock runtime.
- [x] Bàn giao stage18 ghi evidence BE-016 + FE-019 + FE-020 và native smoke còn pending nếu chưa thực hiện; không dùng build thay smoke hay claim giai đoạn 19/Phase 3 hoàn tất.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| src/features/notes/quick-note-composer.test.tsx | Component | Empty/full/saved/invalid, limits Unicode/bytes, IME, project load/error/remove, Cancel, typed/unknown recovery, keyboard/focus |
| src/features/notes/notes-provider.test.tsx | Unit/provider | No autosave, independent draft, single flight, route lifetime, identity, barrier/uncertain |
| src/features/notes/note-actions.test.tsx | Component | Reused project hook không đổi link behavior |
| src/app/home-entry.test.tsx | Integration component | Slot dưới provider, result invalidation, live Data/Quit, route changes |
| src/app/data-management-bridge.test.tsx | Integration component | Home unmounted vẫn chặn dirty quick draft, rejected settle release, accepted flight drain, import/reset retire |
| src/features/home/home-screen.test.tsx, src/features/home/home-route.test.tsx | Component | Slot order, Welcome distinction, Sessions/Projects regression |
| src/features/notes/note-sections.test.tsx, src/app/project-overview-entry.test.tsx, src/app/search-entry.test.tsx | Component | Aggregate/open-note regression |
| src/lib/ipc/notes.test.ts | Contract | Wrapper envelopes thật đúng generated contract |
| src-tauri/tests/notes_contract.rs, src-tauri/tests/unified_search_contract.rs, src-tauri/tests/data_management_contract.rs, src-tauri/tests/export_bindings.rs | Rust contract | Persistence/Search/backup v1-v2/reset/bindings không đổi |

Test IPC doubles chỉ ở wrapper boundary, generated DTO fixture, fake timers/deferred promises để inject race và reject; reset mocks/listeners/stores/router giữa test. Không gọi app data/project/credential thật hoặc mutation process-global environment. Native smoke chỉ trong Windows VM/Sandbox/test account disposable xác định trước; kiểm tra Save/restart thấy record, Cancel không có record, link project/Search/Home, IME/theme/font/focus, route/tray retain, Data import/reset và unknown-result UI bằng test component. Không desktop E2E; không hứa tạo lỗi transport native có thể tái hiện nếu không có seam. Nếu native tooling/môi trường không khả dụng ghi pending, không đánh dấu pass. macOS hoãn giai đoạn phát hành.

## Câu hỏi mở

Không có trong phạm vi Home giai đoạn 18. Phần floating giai đoạn 19 được deferred có chủ đích và không phải blocker implementation phạm vi này.

## Kết quả triển khai ngày 2026-09-08

Phần Quick Note nhúng Home đã hoàn thành kiểm chứng tự động: 179 tests focused; frontend 145 files/2.535 tests; Rust 546 pass, 1 benchmark hiện hữu ignored; Rustfmt/Clippy/contract và Windows Tauri build pass. Artifact: `src-tauri/target/release/xwork.exe`. Evidence, log từng command và failure/retry của test Notifications có sẵn được ghi trong `00-Docs/98-Plan/20260908-fe020-home-quick-note.md`; không sửa backend/DTO/manifest.

Hook project choices nhận cờ suspended tùy chọn để composer dừng query khi Data/Quit đang chặn thao tác; consumer Notes hiện hữu giữ mặc định. Test maintenance dùng HomeEntry với NotesProvider/DataManagementHost thật để kiểm tra draft sau Home unmount; public Data bridge không đổi.

Các checkbox trên ghi phạm vi implementation và automated verification. Native Windows smoke vẫn **pending** vì chưa có môi trường disposable/operator; build không thay thế kiểm tra restart/tray/IME/theme/font/responsive/import-reset native. Stage18 được bàn giao dưới trạng thái **automated implementation complete; native stage acceptance pending**. Stage19/floating/BE-017/tray/global shortcut và nghiệm thu toàn Phase3 vẫn deferred. Draft chưa được backend xác nhận vẫn có thể mất khi crash/force exit/immediate tray Quit.

## Mở rộng giai đoạn 19 — Cửa sổ nổi

Phần này chốt đầy đủ phần floating của FE-020 và có hiệu lực thay các câu defer giai đoạn 19 ở phần Home phía trên. Contract Home đã triển khai giữ nguyên, chỉ bổ sung điểm mở. Người dùng ủy quyền tự quyết các câu hỏi thiết kế; không còn câu hỏi cần chờ.

### Quyết định và phạm vi

- `index.html?window=quick-note` chọn entry riêng trước khi tạo router. Không mount AppProviders, NotesProvider, TerminalProvider, FileHandleProvider, QuitDialog, shell hoặc keyboard executor của main. Query chỉ chọn presentation; caller authorization vẫn do Rust.
- Entry chỉ compose TooltipProvider, AppearanceThemeSync và public QuickNoteWindow. `bootstrapAppSettings()` vẫn được gọi vì `get_settings` hiện hữu là read-only AppHandle command, không khóa main. Không gọi mutation settings hoặc status global từ floating. Theme lấy snapshot khi mở; lỗi đọc dùng system/static tokens hiện hữu, không chặn capture. Không tạo cross-window theme protocol.
- Form floating dùng local state và public createNote/listProjects, không reuse NotesProvider vì provider có các command/listener main-only. Có thể chia sẻ helper validation thuần giữa hai composer; không đổi luồng Home. Title input, textarea Markdown, native select và button hiện hữu là đủ; không thêm dependency.
- Home có `Open Quick Note window` ngoài composer; Welcome kích hoạt `Open Quick Note`. App sở hữu command callback và lỗi mở, truyền qua props/slot, Home không import Notes hoặc Settings. Không chuyển draft Home sang floating. Open pending khóa lặp đồng bộ; lỗi giữ vị trí và có Retry. Data/Quit guard main hiện hữu chặn activation mới từ UI.
- BE017 đã sở hữu tray/global/singleton/on-top/geometry. FE không dùng guest window/global-shortcut API hay tự register chord. Không mở rộng capability/backend.

### File liên quan bổ sung

| Đường dẫn | Vai trò |
|---|---|
| `src/main.tsx` | Chọn bootstrap theo query trước router |
| `src/app/window-entry.tsx`, `src/app/window-entry.test.tsx` | Composition main/floating và test không mount main owners |
| `src/features/notes/quick-note-window.tsx`, `src/features/notes/quick-note-window.test.tsx` | Floating capture và lifecycle local |
| `src/features/notes/quick-note-validation.ts`, `src/features/notes/quick-note-validation.test.ts` | Helper validation thuần chia sẻ nếu tách từ Home |
| `src/lib/ipc/quick-note-window.ts`, `src/lib/ipc/quick-note-window.test.ts` | Bốn command và status listener BE017 |
| `src/features/home/home-route.tsx`, `src/features/home/welcome-screen.tsx`, `src/features/home/welcome-screen.test.tsx` | Inject điểm mở thật và feedback |
| `src/features/settings/use-quick-note-shortcut-status.ts`, `src/features/settings/use-quick-note-shortcut-status.test.tsx` | Snapshot/event main-only, reconcile trên mount/focus |
| `src/features/settings/settings-keyboard-shortcuts-route.tsx`, `src/features/settings/settings-keyboard-shortcuts-route.test.tsx` | Hàng global active/conflict/unavailable |
| `src/features/settings/appearance-theme-sync.tsx`, `src/features/settings/settings-store.ts` | Public app composition reuse, chỉ đọc |
| `src/bindings/quick-note-window.ts` | Generated DTO authority, chỉ đọc |
| `src-tauri/tests/quick_note_window.rs`, `src-tauri/tests/keyboard_shortcuts_contract.rs`, `src-tauri/tests/app_lifecycle.rs`, `src-tauri/tests/window_configuration.rs` | Regression gates, chỉ đọc |

Các đường dẫn HomeEntry, HomeRoute tests, Notes index/composer/tests, bindings/notes và wrapper Projects đã nằm trong bảng Home phía trên và được phép sửa đúng phần integration này.

### UI, state và tương tác floating

Bám `06-Notes.html#quick-note`: titlebar XWork / Quick Note, helper `Esc cancel`, nút `Close Quick Note`, vùng nội dung padding 16–20px, title/body, project, Markdown hint, Cancel/Save. Body co giãn, footer wrap và nội dung cuộn ở minimum geometry BE017. Titlebar drag chỉ primary pointer trên vùng trống; controls không kích hoạt drag. Drag failure có alert an toàn, không ảnh hưởng draft.

| Trạng thái | Biểu hiện và recovery |
|---|---|
| Empty/editing | Title optional, autofocus body một lần khi mount, project mặc định No project; Enter textarea xuống dòng |
| Projects loading/error/empty | Báo loading / lỗi + Refresh / No project; unlinked vẫn Save được, không tự thay selected ID |
| Invalid | Cùng Unicode scalar/title control/UTF-8 body limits và raw Markdown contract Home; alert/aria-invalid, focus field lỗi |
| Saving | Lock đồng bộ trước await; fields/Save/Cancel/Close disabled, Escape bị chặn; không timeout/retry tự động |
| Typed create error | Giữ mọi input, noteErrorCopy; cho sửa/Save explicit, không close |
| Uncertain create | Text read-only để copy; `Could not confirm creation. Check Notes in the main window before creating another note.`; Save disabled, Cancel/Close cho bỏ local draft, không gọi main navigation command bị cấm |
| Closing | Giữ committed NoteDto nếu đã Save; freeze form, một close flight |
| Saved close error | `Note saved, but the window could not close.`; chỉ `Retry Close`, tuyệt đối không create lần hai |
| Cancel close error | Giữ draft và báo không đóng được; cho Retry Close; không giả đã hủy khi cửa sổ còn tồn tại |

Cancel, Escape ngoài IME, custom Close bỏ draft bằng close command không hỏi lại. Khi IME composing không Save bằng activation/Enter và không Escape cancel. Không thêm Ctrl+S ngoài yêu cầu; Save/Cancel native button keyboard. Error role=alert, progress/success role=status, tooltip/name cho icon, focus visible. Không dùng link Open Notes trong floating vì không có command navigate-main. Native CloseRequested/Quit vẫn có thể thắng create flight; ack cũ sau unmount không set state, create đã nhận có thể commit theo BE017.

```ts
/** Render one isolated manually saved native Quick Note instance. */
export function QuickNoteWindow(): React.JSX.Element;
/** Retain capture and commit identity for the lifetime of one renderer. */
interface FloatingQuickNoteState {
  title: string;
  contentMarkdown: string;
  projectId: string | null;
  phase: "editing" | "saving" | "error" | "uncertain" | "closing" | "close-error";
  committedNote: NoteDto | null;
  message: string | null;
}
```

Synchronous ref guards serialize create/close and retain acknowledged NoteDto **trước** close call; React render batching không được cho phép Save lại. Không autosave, persist/localStorage, log draft hoặc nhận event làm acknowledgment. Mở lại sau destroy luôn rỗng. Project removed giữ ID + unavailable option, yêu cầu Refresh/chọn lại hoặc No project; backend quyết định race cuối.

### IPC bổ sung

| Wrapper / command | Input → output | Hành vi |
|---|---|---|
| openQuickNoteWindow / open_quick_note_window | Không → void | main Home/Welcome only |
| closeQuickNoteWindow / close_quick_note_window | Không → void | floating Cancel/Close hoặc sau ack |
| startQuickNoteWindowDrag / start_quick_note_window_drag | Không → void | floating titlebar only |
| getQuickNoteGlobalShortcutStatus / get_quick_note_global_shortcut_status | Không → QuickNoteGlobalShortcutStatusDto | main Settings only |
| onQuickNoteGlobalShortcutStatusChanged | handler(payload) → Promise<UnlistenFn> | `quick-note://global-shortcut-status-changed`, main only |

Wrappers dùng invokeCommand và generated QuickNoteWindowError. unauthorized_window/stale_window/app_shutting_down: safe copy, không auto-loop; window_operation_failed/unavailable/transport: Retry đúng operation. create_note/list_projects giữ generated contracts BE016/Projects. Floating không subscribe notes/projects vì capability event rỗng; project Refresh query trực tiếp đủ cho form ngắn. Notes event phía main hiện hữu invalidate các projection sau commit.

### FE001 và FE014 integration

FE001 bootstrap tách main/floating như trên; main close-to-tray/Quit giữ nguyên. FE014 thêm `quick_note.open_global` vào availability catalog presentation, giữ BE009 set/reset/recorder/conflict. Không hardcode chord mặc định vào executor JavaScript.

Hook status subscribe trước snapshot; compare decimal sequence bằng BigInt sau validation digits, bỏ older/duplicate. Cleanup late subscription phải unlisten; request sau unmount không set state. Snapshot unavailable trước initial reconcile là trạng thái chưa sẵn sàng, không fatal. Event hợp lệ sau đó tự recover; mount/focus/Retry gọi snapshot lại. Query/listener lỗi có status unknown + Retry, không nói active từ catalog. Hiển thị `Global shortcut active`, `Disabled by shortcut conflict`, hoặc `Global shortcut unavailable. Change or reset the shortcut, or restart XWork.`. Nếu status chord chưa khớp currentChord của catalog, hiện `Applying global shortcut…` cho đến reconciliation; không rollback override đã commit. Conflict names từ catalog, không đoán tên ứng dụng chiếm chord. Mutation success trigger status refresh; event quyết định trạng thái OS sau đó.

### Kiểm thử và hoàn thành giai đoạn 19

- [x] window-entry test kiểm tra literal query chọn floating và không tạo router/main owners; main đường cũ vẫn mount. get_settings read-only được phép, không command main-only trong floating.
- [x] quick-note-window component test cover empty/invalid/IME/projects failures/removed selection, single-flight create, typed/unknown failure, cancel/Escape/drag, ack trước close và retry close không tạo duplicate; mocked IPC promises điều khiển race và unmount.
- [x] HomeEntry/HomeRoute/Welcome tests chứng minh cả hai điểm mở thật, error/retry và live Data/Quit guard; Home Save vẫn reset tại chỗ.
- [x] FE014 hook/route tests cover catalog action, mount/focus/error retry, status initial unavailable→active, conflict/unavailable/chord mismatch, out-of-order snapshot/event, late unlisten và mutation không rollback.
- [x] IPC tests khẳng định exact names/no-argument commands/payload forwarding và typed errors; no raw invoke hoặc guest window/global shortcut registration bằng kiểm tra diff và source imports.
- [x] Chạy toàn bộ gates frontend/Rust theo tiêu chí phía trên và Windows `pnpm tauri build`; explicit Rust targets quick_note_window/keyboard_shortcuts_contract/app_lifecycle/window_configuration.
- [ ] Windows smoke trên tài khoản/VM dữ liệu riêng: Home/Welcome/tray/global mở cùng window; repeated trigger giữ draft/main hidden; on-top/drag/resize; Save xuất hiện Notes/project; Cancel/Escape/native close mở lại rỗng; IME; đổi/reset/conflict shortcut; Quit. Tổng hợp §20 Phase3 với evidence Notes/Search/backup đã có ở giai đoạn18.

Native smoke/p95 hiện pending vì công cụ native disabled. Không claim build thay smoke hoặc Phase3 native acceptance đã pass; ghi limitation khi bàn giao và tiếp tục công việc độc lập.

### Ghi nhận triển khai giai đoạn 19 — 2026-09-09

- Floating giữ validation và draft cục bộ; không tách helper dùng chung khi chưa cần và không thay composer Home.
- Nút mở Home được đặt ở header của HomeScreen hiện hữu; callback/pending/error do HomeEntry sở hữu. Welcome nhận cùng callback qua HomeRoute.
- Cancel đóng lỗi vẫn giữ nguyên draft và cung cấp Retry Close; Save đóng lỗi giữ NoteDto đã xác nhận trước IPC close, nên Retry Close không thể tạo note trùng.
- Lần chạy toàn bộ frontend đầu có một assertion Home cũ được cập nhật và một lỗi timing Markdown editor ngoài scope khi chạy đồng thời Rust. Hai target đã pass khi chạy riêng; không sửa Markdown editor. Giới hạn hai Vitest workers cho lượt full cuối giữ nguyên toàn bộ test targets.
- Native Windows smoke, global shortcut thực trên OS và p95 vẫn pending do công cụ native disabled; build không thay thế bằng chứng này.
