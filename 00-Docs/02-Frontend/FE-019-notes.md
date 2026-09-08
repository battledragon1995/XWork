# FE-019 — Notes

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `FE-019` |
| Phase | `3`, phần Notes của giai đoạn 18 |
| Khu vực chính | `src/features/notes/` |
| Yêu cầu chức năng | §12.1–12.2; mở rộng §6, §7.5, §14; §17.6, §18 |
| Wireframe | `06-Notes.html#edit`, `#preview`, `#search`, `#archive`, `#trash`; `03-Home.html#empty`, `#full`; `04-Projects.html#overview`; `02-AppShell.html#palette`, trong `00-Docs/01-Wireframe/` |
| Backend liên quan | `BE-016`; public Projects, Search, Data và Lifecycle hiện hữu |
| Phụ thuộc | `FE-003`, `FE-005`, `FE-009`, `FE-018`; BE-016 đã tích hợp thật |

## Mục tiêu

Người dùng tạo, sửa Markdown có autosave, tìm kiếm, ghim, liên kết project và quản lý Archive/Trash bằng persistence BE-016 thật. Cùng phần này, Home hiển thị note ghim/gần đây, Project Overview hiển thị note liên kết và Search mở đúng note.

### Ngoài phạm vi

- Quick Note nhúng Home thuộc thiết kế/plan FE-020 riêng trong cùng giai đoạn 18; chỉ giữ slot composition. FE-019 hoàn thành chưa đồng nghĩa toàn giai đoạn 18 hoàn thành.
- Cửa sổ Quick Note, tray/shortcut mới, Calendar, attachment, tag, sync, lịch sử phiên bản, persistence draft hoặc editor mode, sửa file Markdown trên đĩa.
- Không thêm dependency, command, DTO, migration, permission hoặc sửa plan đã hoàn thành.

### Quyết định đã chốt

- Người dùng ủy quyền chốt ambiguity. BE-016 quyết định title nullable cho mọi note, draft chỉ tạo record khi body trim khác rỗng, revision decimal string, Archive/Trash read-only và restore Trash về lifecycle trước đó. Không suy ra rule khác từ hình minh họa.
- Roadmap yêu cầu IPC thật và tích hợp màn hình tổng hợp ở owner stage; quy tắc mock runtime cũ trong PLANS.md không áp dụng cho lát cắt này.
- Autosave sau 500 ms không nhập; tìm kiếm sau 150 ms; IME chỉ bắt đầu timer khi composition kết thúc. Một draft đang sửa được giữ trong provider xuyên route; chuyển note phải settle hoặc giải quyết lỗi trước khi thay draft.
- Chỉ tách phần render GFM thuần của Files sang component dùng chung vì Files và Notes có cùng chính sách HTML/link/image. Editor CodeMirror Notes riêng, không import Files implementation hoặc chuyển file byte-preservation/workspace lifecycle sang Notes.
- Wireframe có `Copy as Markdown` nhưng BE-016 không có clipboard OS contract. Đợt này thay mục này bằng vùng `Copy Markdown` read-only cho người dùng chọn/sao chép bằng thao tác hệ điều hành; không thêm clipboard plugin/API OS frontend.
- Dữ liệu chỉ bền khi backend xác nhận. Provider không bị unmount khi chuyển route/ẩn cửa sổ; flush best-effort khi hidden. Crash/force exit và tray Quit không phiên có thể kết thúc trước autosave chưa xác nhận theo lifecycle hiện hữu; không hứa khôi phục draft sau restart. Native smoke giới hạn này phải ghi trung thực, không tự mở rộng BE-001.

## File liên quan

Các file binding/backend dưới đây là nguồn contract và verification, không chỉnh nếu contract hiện hữu đáp ứng. Mọi source/test implementation được phép chạm nằm trong bảng.

| Đường dẫn | Vai trò trong feature |
|---|---|
| `src/features/notes/index.ts` | Public exports cho composition |
| `src/features/notes/notes-provider.tsx` | Một owner draft, mutation queue và invalidation xuyên route |
| `src/features/notes/notes-provider.test.tsx` | Autosave, race, barrier, lifecycle draft |
| `src/features/notes/notes-route.tsx` | List/editor và route query selection |
| `src/features/notes/notes-route.test.tsx` | Query/filter/pagination/selection/loading/keyboard |
| `src/features/notes/note-editor.tsx` | Title, CodeMirror, toolbar, preview, conflict/recovery |
| `src/features/notes/note-editor.test.tsx` | Mode, IME, validation, focus và read-only |
| `src/features/notes/note-editor-adapter.ts` | CodeMirror Notes state/view lifecycle |
| `src/features/notes/note-editor-adapter.test.ts` | Transaction, history, composition, size admission |
| `src/features/notes/note-actions.tsx` | Project selector, lifecycle actions, Empty Trash, copy text |
| `src/features/notes/note-actions.test.tsx` | Revision/action serialization và destructive confirmation |
| `src/features/notes/note-sections.tsx` | Public Home/Project projections |
| `src/features/notes/note-sections.test.tsx` | Query caps, invalidation, errors và navigation |
| `src/features/notes/note-error-copy.ts` | Copy English theo typed error |
| `src/features/notes/note-error-copy.test.ts` | Exhaustive error/transport coverage |
| `src/lib/ipc/notes.ts` | Narrow invoke/listen wrappers |
| `src/lib/ipc/notes.test.ts` | Command/envelope/event/error contract |
| `src/components/markdown-content.tsx` | Render GFM thuần với chính sách tài nguyên dùng chung |
| `src/components/markdown-content.test.tsx` | HTML/protocol/image/task-list regression |
| `src/features/files/markdown-preview.tsx` | Dùng shared renderer, giữ Files empty/scroll UI |
| `src/features/files/markdown-preview.test.tsx` | Regression Files preview |
| `src/app/app-providers.tsx` | Mount NotesProvider một lần |
| `src/app/app-shell.test.tsx` | Provider lifetime/route regression |
| `src/app/app-router.tsx` | Thay Notes placeholder và Project composition entry |
| `src/app/app-router.test.tsx` | Notes route/crumbs và project entry |
| `src/app/home-entry.tsx` | Compose Notes sections và presence |
| `src/app/home-entry.test.tsx` | Home Notes với/không project, boundary |
| `src/features/home/home-route.tsx` | Nhận slot/presence qua props |
| `src/features/home/home-route.test.tsx` | Welcome khi thực sự rỗng |
| `src/features/home/home-screen.tsx` | Note column, slot Quick Note tùy chọn |
| `src/features/home/home-screen.test.tsx` | Responsive layout và phase regression |
| `src/app/project-overview-entry.tsx` | Compose Notes tại project route |
| `src/app/project-overview-entry.test.tsx` | Project identity/section composition |
| `src/features/projects/project-overview-route.tsx` | Nhận linkedNotes slot theo project đã load |
| `src/features/projects/project-overview-route.test.tsx` | Slot không hiện trước project hợp lệ |
| `src/app/search-entry.tsx` | Enable Note target, getNote rồi route thật |
| `src/app/search-entry.test.tsx` | Stale/archived/trash target và late navigation |
| `src/app/data-management-bridge.tsx` | Notes barrier và post-commit reconciliation |
| `src/app/data-management-bridge.test.tsx` | Import/reset không resurrect draft |
| `src/bindings/notes.ts`, `src/bindings/search.ts`, `src/bindings/projects/projects.ts` | DTO sinh từ Rust, không sửa tay |
| `src-tauri/src/notes/commands.rs`, `src-tauri/src/notes/models.rs`, `src-tauri/src/notes/service.rs` | Contract command, limits, revision/event |
| `src-tauri/tests/notes_contract.rs`, `src-tauri/tests/unified_search_contract.rs`, `src-tauri/tests/data_management_contract.rs`, `src-tauri/tests/export_bindings.rs` | Gates backend/IPC đã có |

## UI và hành vi

### Thành phần giao diện

| Thành phần | Vai trò | Wireframe |
|---|---|---|
| NotesRoute | Hai vùng cuộn độc lập, list khoảng 300 px; khi hẹp xếp list trên editor, không tràn ngang | edit/search |
| NoteEditor | Title serif, body nền canvas ở cả hai mode, toolbar Edit/Preview, status, project, pin, more-menu | edit/preview |
| NoteActions | Archive, Move to Trash; read-only banner/Restore; dialog Empty Trash | archive/trash |
| HomeNoteSections | Pinned tối đa 2, Recent unpinned tối đa 3, Open Notes/All notes | Home empty/full |
| ProjectNotesSection | Active liên kết project, tối đa 5 theo backend order, New note/All notes | overview |

### Trạng thái hiển thị

| Trạng thái | Điều kiện | Giao diện thể hiện |
|---|---|---|
| Loading | Query chưa có snapshot | `Loading notes…`, aria-busy; không giả empty |
| Empty | Active không có note | `No notes yet`, `New note` |
| No matches | Query/filter không có match | `No matching notes`, `Clear filters` |
| Archive/Trash empty | Lifecycle không có note | `Archive is empty` / `Trash is empty`; Empty Trash disabled |
| No selection | Không có noteId | `Select a note or create a new one` |
| Draft | Chưa có ID | `Draft`, `Add some content to save this note` khi body chỉ whitespace |
| Dirty / saving / saved | Generation chưa ack / flight / ack đúng generation | `Unsaved changes` / `Saving…` / `Saved just now`; status polite, không announce mỗi phím |
| Error | Query hoặc write lỗi | Alert cục bộ và Retry phù hợp; giữ draft/snapshot với nhãn stale |
| Conflict | revision_conflict | Giữ local text, hiện `This note changed elsewhere`; `Use latest version` hoặc `Save my changes` explicit |
| Read-only | Archived/Trash | Preview mặc định; có thể xem raw text read-only; banner đúng wireframe, không pin/link/autosave |
| Missing | note_not_found | `This note is no longer available`, giữ local text để copy nếu dirty; không tạo lại tự động |
| Subscription failed | Listen lỗi | `Live updates unavailable`, Refresh; vẫn dùng command response thật |

### Tương tác

| Thao tác | Kết quả | Phím tắt |
|---|---|---|
| New note | Settle draft cũ, mở draft local, focus title; không invoke create khi body rỗng | Enter/Space trên nút |
| All/Pinned/Project | Pinned any/only; project all/unlinked/project; có thể kết hợp Pinned+Project | Native button/select keyboard |
| Nhập search | Title/body search backend trong lifecycle hiện tại, 150 ms, không client ranking | IME-aware |
| Clear | Xóa search/project/pin filter của lifecycle hiện tại | Enter/Space |
| Load more | Offset tăng bằng items đã nhận; 50 rows/page, append de-duplicate ID; query mới reset offset | Enter/Space |
| Chọn row | Flush current draft rồi getNote; lỗi flush giữ draft cũ và selection cũ | Tab, Enter |
| Edit/Preview | Giữ caret/history và scroll từng mode trong draft lifetime | Tab, Enter/Space |
| Sửa title/body | 500 ms autosave, title nullable; body không quá 1 MiB UTF-8, title ≤255 scalar không control | Không đăng ký shortcut app mới |
| Pin/link/archive/trash | Flush text trước, một flight, revision mới nhất; publish kết quả backend | Menu keyboard |
| Restore | Dùng command phù hợp lifecycle; chọn đúng view theo response | Enter/Space |
| Delete permanently | Explicit row/button, single flight, không dialog thứ hai | Enter/Space, không Delete global |
| Empty Trash | Prepare impact rồi confirm toàn Trash; danh sách tối đa 10 tên và count tổng | Dialog focus trap, Escape=Cancel |

Icon có tooltip + accessible name, focus ring rõ; không nested interactive button trong row. Search dùng input có label; danh sách dùng danh sách link/button thông thường, không giả combobox. Focus không bị query reorder chiếm; nếu row bị xóa, focus về heading list; dialog cancel trả opener còn tồn tại. Không tự chuyển note chỉ vì filter không còn chứa note đang mở. Mode không lưu backend/localStorage.

## Luồng chính

1. `/notes` là route duy nhất; query `noteId`, `view=active|archived|trash`, `projectId`, `new=1` biểu diễn selection/entry. `new=1` không kèm noteId; input route sai không tạo mutation. `getNote` quyết định lifecycle thật và replace view khi khác hint. Filter/search thông thường là UI state; entry projectId khởi tạo filter hoặc project của draft.
2. Provider giữ một editable draft xuyên route, snapshot acknowledged và generation; note selection mới chờ flush. Navigation ra route khác không hủy mutation/draft, autosave vẫn chạy. Notes trở lại mở draft chưa giải quyết trước khi thay bằng requested note; giải quyết xong mới thực hiện selection đang chờ. Draft body rỗng chưa tạo có thể giữ hoặc `Discard draft` explicit.
3. Autosave chụp title/body/generation/revision, chỉ một create/autosave/mutation đang chạy. User vẫn gõ trong flight; ack chỉ cập nhật base/revision, không thay text mới hơn; queue gửi generation mới nhất sau ack. Create ack gắn ID đúng một lần, replace URL chỉ nếu route vẫn thuộc draft đó. Revision là string opaque, không parse Number.
4. Conflict không tự merge/overwrite. `Use latest version` xác nhận bỏ local edit rồi dùng current. `Save my changes` chỉ cho active current, dùng revision của current để gửi local text; conflict lần nữa quay lại cùng state. Metadata/lifecycle conflict re-read và yêu cầu thao tác explicit lại, không replay archive/delete.
5. Typed failure bảo đảm chưa commit cho retry explicit; transport create không có idempotency nên không tự retry. Hiện `Could not confirm creation. Check Notes before creating another note.`, giữ/copy draft, refresh list để người dùng kiểm tra; chỉ người dùng chọn `Create another note` sau cảnh báo có thể trùng mới gọi create nữa. Unknown autosave/mutation outcome getNote trước, không suy rằng backend đã hủy; so sánh snapshot với submitted text/revision để reconcile, vẫn không đè generation mới.
6. Notes event chỉ invalidation: listen trước query; mỗi invalidation tăng request generation/reset pagination. Mutation result cũng invalidates nên không phụ thuộc event đến. Detail dirty không bị refresh overwrite; response/event cũ không đổi state mới. `projects://changed` Removed re-query list/detail vì FK unlink không tăng revision và không phát Notes event. Window focus/visibility visible refresh; không polling. Cleanup unlisten cả registration resolve muộn/StrictMode.
7. Data bridge dùng public Notes barrier: claim admission đồng bộ, đợi flight + flush hợp lệ; failure/conflict/unknown create chặn confirm và giữ draft. Initial invalid draft chỉ title không được persist, chặn confirm với hướng dẫn discard trước. Commit reset retire draft và invalidate trước navigation; import reload clean snapshot, không autosave nội dung cũ lên imported revision. Unknown maintenance outcome giữ barrier tới reconciliation; không replay import/reset.

## Contract với backend

### Command sử dụng

Wrapper camelCase tương ứng tên command; `invokeCommand<Result, NotesError>`, DTO import nguyên từ `src/bindings/notes.ts`. Không handwritten DTO hoặc direct invoke trong feature.

| Command | Input invoke | Output | UI lỗi |
|---|---|---|---|
| `list_notes` | `{ input: ListNotesInputDto }` | `NoteListPageDto` | Query/filter/pagination validation, query Retry |
| `get_note` | `{ noteId: string }` | `NoteDto` | Missing/stale, query Retry |
| `create_note` | `{ input: CreateNoteInputDto }` | `NoteDto` | Validation, unknown create |
| `autosave_note` | `{ input: AutosaveNoteInputDto }` | `NoteDto` | Conflict/validation/read-only |
| `set_note_pinned` | `{ input: SetNotePinnedInputDto }` | `NoteDto` | Conflict/read-only |
| `set_note_project` | `{ input: SetNoteProjectInputDto }` | `NoteDto` | Missing project/conflict/read-only |
| `archive_note`, `restore_archived_note`, `move_note_to_trash`, `restore_note_from_trash` | `{ input: NoteRevisionInputDto }` | `NoteDto` | Conflict/invalid transition |
| `delete_note_permanently` | `{ input: NoteRevisionInputDto }` | `DeletedNoteDto` | Conflict/missing/invalid transition |
| `prepare_empty_notes_trash` | Không args | `EmptyNotesTrashImpactDto` | trash_empty: refresh/close |
| `confirm_empty_notes_trash` | `{ requestId: number }` | `EmptyNotesTrashResultDto` | trash_changed: thay preview, cần confirm mới |
| `cancel_empty_notes_trash` | `{ requestId: number }` | `void` | Stale/expired cancel không xóa gì |
| `list_projects` | Public `listProjects()` wrapper hiện hữu | Generated Project DTO | Selector/query lỗi độc lập; không lấy path từ filesystem |

Error copy bao phủ mọi NotesError: `invalid_title`, `empty_initial_content`, `content_too_large` đặt cạnh field; `invalid_search` hướng dẫn ≤128 scalar/8 tokens và bỏ control; `invalid_project_id`/`project_not_found` refresh lựa chọn, không tự link project khác; `invalid_note_id`/`note_not_found` target unavailable; `note_not_editable`/`invalid_transition` refresh read-only; `revision_conflict` theo luồng trên. `trash_changed` thay impact/count/requestId và không tự confirm; `no_pending_trash_operation`/`stale_trash_request` prepare lại chỉ qua Retry. `trash_empty` đóng/refresh. `invalid_revision`/`invalid_filter`/`invalid_pagination`/`unauthorized_window`/`revision_exhausted` lỗi tích hợp, không loop retry; `clock_failed`/`persistence_failed` cho Retry explicit. Transport/unknown không render raw payload/query/content hoặc ghi log.

Backend order/counts là authority. Active group Pinned trước Recent theo response; search highlight `[startScalar,endScalar)` trên `Array.from(text)`, không UTF-16 slice, không innerHTML. No project là `null`; unavailable project vẫn selectable. Page count/totalMatches không suy từ số row đang render.

### Event / Channel đăng ký

| Nguồn | Payload | Khi nhận | UI phản ứng |
|---|---|---|---|
| `notes://changed` qua `onNotesChanged(handler): Promise<UnlistenFn>` | `NoteChangedEventDto` | Commit thường/import/reset | Invalidate list/detail/projections; sequence decimal so sánh bằng BigInt trong process |
| `projects://changed` qua wrapper hiện hữu | Generated `ProjectChangedEventDto` | Rename/remove | Refresh label/filter và Notes FK snapshot |

Không channel hoặc event Search giả. Palette đang mở có thể tăng refreshKey sau Notes invalidation tại app; SearchTargetDto Note được enable, `getNote(target.noteId)` revalidate, Trash/missing trả stale thay vì mở, Active/Archived navigate `/notes?noteId=...&view=...`. Guard epoch/abort/Quit hiện hữu vẫn áp dụng trước/sau await.

## State frontend

```ts
/** Retain one unfinished edit without copying backend business authority. */
interface NoteDraftState {
  base: NoteDto | null;
  title: string;
  contentMarkdown: string;
  projectId: string | null;
  generation: number;
  acknowledgedGeneration: number;
  mode: "edit" | "preview";
  phase: "draft" | "dirty" | "saving" | "saved" | "error" | "conflict" | "uncertain";
  conflict: NoteDto | null;
  /** Flush the latest admissible generation or reject without discarding it. */
  flush(): Promise<void>;
}
```

| Dữ liệu | Nguồn sở hữu | Ghi chú |
|---|---|---|
| Record, revisions, counts, order | Rust | Snapshot tạm, re-query invalidation |
| Draft, generation, history, mode, caret/scroll | NotesProvider UI | Một draft; không persist qua restart |
| List query/filter/page/request generation | Mounted Notes surface | Latest request thắng; không share mutable list state giữa Home/Project |
| Navigation, maintenance composition | App | Qua public props/API, feature không import app/feature khác |

## Contract công khai của feature

```ts
/** Keep draft and Notes invalidation alive across routes. */
export function NotesProvider(props: { children: React.ReactNode }): React.JSX.Element;
/** Render the real Notes route. */
export function NotesRoute(): React.JSX.Element;
/** Render independent pinned and recent Home projections. */
export function HomeNoteSections(): React.JSX.Element;
/** Render notes linked to a verified project identity. */
export function ProjectNotesSection(props: { projectId: string }): React.JSX.Element;
/** Expose only a small existence query for Home versus Welcome composition. */
export function useNotesPresence(): { status: "loading" | "present" | "empty" | "error"; retry(): void };
/** Compose the Notes maintenance owner without exposing its draft implementation. */
export function useNotesDataBoundary(): {
  settleBeforeDataChange(): Promise<void>;
  releaseDataChangeBarrier(): void;
  clearAfterReset(): void;
  refreshAfterDataChange(): Promise<void>;
  reconcileAfterResetFailure(): Promise<void>;
};
```

Public exports chỉ từ `src/features/notes/index.ts`. App thêm `notesSection?: React.ReactNode`, `quickNoteSlot?: React.ReactNode`, `notesPresence?: "loading" | "present" | "empty" | "error"`, `onRetryNotesPresence?(): void` vào HomeRouteProps; HomeScreen đặt Quick Note slot trước note sections ở cột viết. FE-019 không cung cấp composer placeholder. Khi không project, chỉ Welcome nếu Notes counts cả ba lifecycle đều bằng 0; note archived/trash vẫn là dữ liệu. Presence lỗi hiện Retry, không kết luận empty. HomeNoteSections tự query Active Only limit 2 và Exclude limit 3, offset 0; notesPresence dùng list limit 1 và counts. Khi có project, Notes query lỗi không che Sessions/Projects.

App ProjectOverviewEntry truyền `renderLinkedNotes?(projectId: string): React.ReactNode` vào ProjectOverviewRoute; route gọi chỉ sau project load thành công, kể cả unavailable. Notes section có New note tới `/notes?new=1&projectId=...`, All notes tới `/notes?projectId=...`. Project và Home không import Notes. Shared `MarkdownContent({ text: string }): React.JSX.Element` ở components chỉ render GFM: skipHtml, ảnh thành alt text, link thành text+destination, task checkbox disabled; không resource fetch/protocol navigation. Host sở hữu empty state/scroll/style; Files regression giữ nguyên.

## Edge case

| Tình huống | Hành vi mong đợi |
|---|---|
| Gõ trong flight rồi đổi route | Ack không thay text mới, queue tiếp tục xuyên route |
| Project bị remove khi draft chưa create | Refresh selector, giữ draft, yêu cầu chọn No project hoặc project khác trước retry |
| Event tự mutation đến trước response | Invalidate query nhưng không giả revision/ack; response settle queue |
| Autosave bị Archive/Trash ngoài UI | Giữ text recovery, stop autosave, read-only; không restore tự động |
| Empty Trash đổi trong lúc dialog mở | Backend trả impact mới, người dùng xem/confirm lại; cancel/hidden unmount hủy request best-effort |
| Chuyển mode nhiều lần | Một CodeMirror view khi Edit; destroy view giữ EditorState/caret/history; read-only không phát onChange |
| Nội dung sát 1 MiB, Unicode/IME | Byte-size tính TextEncoder; không cắt giữa Unicode/composition; báo lỗi và giữ text hợp lệ trước đó |
| Query trả sau reset/unmount | Epoch/request generation từ chối publish; không khôi phục row/draft cũ |
| Home không project nhưng có note | Dashboard Notes vẫn truy cập được; không bị Welcome che |

## Tiêu chí hoàn thành

- [ ] Năm wireframe Notes chạy bằng wrappers BE-016 thật; keyboard/focus/theme/font lớn không mất thao tác.
- [ ] Autosave single-flight, dirty generation, conflict, unknown create, IME và maintenance có kiểm thử quan sát được; không silent overwrite hoặc auto-retry create.
- [ ] Home pinned/recent, Project linked/New note, Search Active/Archived/stale được tích hợp và regression phần cũ pass.
- [ ] Shared renderer không tải ảnh/raw HTML/navigate protocol, Files preview không đổi hành vi.
- [ ] Frontend formatter/linter/typecheck/tests/build, Rustfmt, Clippy all-targets/all-features -D warnings, Rust tests all-targets/all-features, Windows Tauri build pass; Cargo `-j 2`.
- [ ] Manual Windows smoke ghi môi trường cô lập, kết quả thực và pending cho mọi bước chưa chạy; không automated desktop E2E/native automation, không macOS trước release.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src/lib/ipc/notes.test.ts` | Contract | Mọi command args/result/error, canonical event |
| `src/features/notes/notes-provider.test.tsx` | Component | Fake timer 500ms, deferred promise ordering/create exactly once/conflict, event registration failure/late cleanup, data barriers |
| `src/features/notes/notes-route.test.tsx` | Component | 150ms search/IME, filters/50-row pages, counts, stale responses, empty/loading/error, selection |
| `src/features/notes/note-editor.test.tsx`, `src/features/notes/note-editor-adapter.test.ts` | Component/unit | Real CodeMirror state transactions, injected view factory cho jsdom; Unicode, history, mode/read-only |
| `src/features/notes/note-actions.test.tsx`, `src/features/notes/note-error-copy.test.ts` | Component/unit | Explicit destructive actions, refreshed impact, typed errors |
| `src/features/notes/note-sections.test.tsx` | Component | Home caps/project filter, all lifecycle presence, event/remove refresh |
| `src/components/markdown-content.test.tsx`, `src/features/files/markdown-preview.test.tsx` | Component | Không HTML/resource-bearing link/image; Files regression |
| `src/app/home-entry.test.tsx`, `src/features/home/home-route.test.tsx`, `src/features/home/home-screen.test.tsx` | Component | Composition/Welcome/presence errors và responsive DOM |
| `src/app/project-overview-entry.test.tsx`, `src/features/projects/project-overview-route.test.tsx` | Component | Verified project slot, unavailable/gone |
| `src/app/search-entry.test.tsx`, `src/app/app-router.test.tsx`, `src/app/app-shell.test.tsx`, `src/app/data-management-bridge.test.tsx` | Component | Real route/executor composition, retained owner, maintenance epochs |

Tests dùng vi mock wrapper/listen, fake timers và deferred promises, DTO fixtures vô hại; không runtime mock, developer app-data, filesystem hoặc OS credential. Các Rust contract targets hiện hữu dùng temp Storage và injected service seams của BE-016; không thêm test backend trùng FE. Manual smoke chạy Windows VM/Sandbox/account test riêng với project disposable, không đổi APPDATA toàn cục. Hiện native tool chưa khả dụng nên smoke pending; build không thay thế bằng chứng native.

## Câu hỏi mở

Không có. Các quyết định giới hạn autosave trước backend ack và tách FE-020 ở trên đã được ghi rõ theo ủy quyền người dùng.


## Ghi nhận triển khai 2026-09-08

- Bổ sung file test `src/features/notes/notes-test-fixture.tsx` cho DTO/probe cô lập và cập nhật fixture `src/app/app-topbar.test.tsx` để lỗi query Notes không xen vào kiểm thử window controls. Không có runtime fixture.
- Trong lúc Empty Trash đang confirm, Data confirmation đồng thời bị chặn và có thể thử lại sau khi Trash settle; autosave và mutation theo note đang chạy được đợi. Đây là lựa chọn bảo thủ để không chồng destructive operation, không replay command.
- Native smoke còn pending; build/test tự động không thay cho vận hành Windows trên dữ liệu dùng một lần. Giới hạn tray Quit trước autosave acknowledgement giữ nguyên như quyết định thiết kế.
