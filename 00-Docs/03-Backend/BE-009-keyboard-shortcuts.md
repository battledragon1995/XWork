# BE-009 — Keyboard shortcuts

Tài liệu này đặc tả hợp đồng backend cho catalog phím tắt, phần ghi đè bền vững, phát hiện xung đột và khôi phục mặc định.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-009` |
| Phase | `1`; mở rộng đúng một shortcut toàn cục Quick Note ở Phase 3 cùng `BE-017` |
| Capability | `src-tauri/src/settings/`; adapter global shortcut tương lai thuộc `src-tauri/src/platform/` |
| Yêu cầu chức năng | §5.2, §9.1–9.2, §12.3, §17.4 |
| Frontend liên quan | `FE-014`; `FE-001`, `FE-006`, `FE-007`; mở rộng `FE-020` ở Phase 3 |
| Phụ thuộc | `BE-002`, `BE-008`; migration versions 1–3 của `BE-003`, `BE-008`, `BE-006` phải có trước version 4; action runtime dùng contract `BE-005`; phần mở rộng Phase 3 bắt đầu sau `BE-001`, `BE-016`, `BE-017` |

## Mục tiêu

Backend cung cấp catalog action typed cùng shortcut mặc định theo nền tảng, chỉ lưu các giá trị người dùng đã đổi, phát hiện mọi action dùng cùng tổ hợp và cho phép reset một hoặc toàn bộ shortcut. Phase 1 chỉ quản lý shortcut khi cửa sổ XWork có focus; action và đăng ký shortcut toàn cục mở Quick Note chỉ được bổ sung cùng `BE-017` ở Phase 3.

### Ngoài phạm vi

- Không bắt phím trong WebView, tìm action theo chuỗi, render ký hiệu phím hoặc thực thi action UI. `FE-014` ghi nhận `KeyboardEvent.code`; application shell và feature sở hữu action điều phối handler.
- Không gọi trực tiếp command nội bộ của Projects hoặc Sessions. Action tab/pane của frontend dùng public command `BE-005`; project/session navigation dùng state/query public đã có.
- Không triển khai Command Palette hoặc unified search; một action duy nhất mở bề mặt “Search or run a command”, còn nội dung tìm kiếm do feature sở hữu cung cấp.
- Không thêm action `Toggle File Explorer` ở Phase 1. Action này chỉ xuất hiện khi `BE-013`/`FE-016` hoạt động ở giai đoạn 15; wireframe Settings là trạng thái sản phẩm cuối.
- Không thêm action, plugin, permission, window hoặc tray item Quick Note ở Phase 1. `BE-017` sở hữu cửa sổ/handler và OS registration ở giai đoạn 19; `BE-001` chỉ hiển thị tray item sau khi handler sẵn sàng.
- Không điều phối backup hoặc reset toàn ứng dụng. `BE-012` dùng typed owner API `_in` của capability trong shared transaction, không đọc bảng trực tiếp.

### Quyết định và giả định đã chốt

- Catalog action và default là hằng typed trong Rust; SQLite chỉ giữ override. Cách này làm default có version rõ ràng, không seed dữ liệu có thể lỗi thời và cho phép action mới nhận default mà không cần migration.
- Shortcut dùng `KeyboardEvent.code` canonical, không dùng ký tự theo layout. Modifier `primary` hiển thị/thực thi là `Ctrl` trên Windows và `Command` trên macOS; vì vậy cùng một override giữ ý nghĩa khi code chạy trên từng hệ điều hành.
- Assignment gây xung đột vẫn được lưu để đáp ứng luồng “flagged until resolved”. Không chọn action thắng ngầm: tất cả action trong cùng nhóm xung đột có `is_dispatchable = false` cho đến khi người dùng đổi hoặc reset. FE-014 phải sửa copy minh họa “One of them will not fire” thành thông báo xác định rằng các action xung đột đều tạm ngừng.
- Default Phase 1 không xung đột. Trong wireframe, `Split down` có nút `Reset` và đang trùng default tương lai của `Toggle File Explorer`, nên đó là trạng thái override minh họa; default thật của `Split down` được chốt là `Primary+Alt+Backslash`.
- `Open Quick Note (works outside XWork)` trong wireframe là trạng thái Phase 3. Action này không có trong snapshot/binding Phase 1; khi `BE-017` sẵn sàng, catalog thêm `quick_note.open_global` với default `Primary+Shift+KeyN`, tương ứng `Ctrl+Shift+N` trên Windows và `Command+Shift+N` trên macOS, không thêm migration.
- Giai đoạn 10 mặc định triển khai sau các giai đoạn trước theo roadmap. `BE-003` và `BE-006` chỉ là prerequisite thứ tự migration; BE-009 không gọi capability nghiệp vụ của chúng.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/src/settings/mod.rs` | Re-export DTO, error, command và service Keyboard Shortcuts bên cạnh settings của BE-008 |
| `src-tauri/src/settings/keyboard_shortcuts.rs` | Catalog/default, validation, repository, cache, conflict projection, command và public Rust interface |
| `src-tauri/src/app/mod.rs` | Khởi tạo `KeyboardShortcutsService`, manage state và đăng ký bốn command sau khi migration hoàn tất |
| `src-tauri/src/app/data_participants.rs` | Adapter owner typed cho backup/reset BE-012, dùng shared transaction mà không re-enter maintenance gate hoặc Storage |
| `src-tauri/src/storage/migrations.rs` | Đăng ký migration version 4 sau ba version đã phát hành |
| `src-tauri/migrations/0004_create_keyboard_shortcuts.sql` | Tạo bảng override shortcut |
| `src-tauri/src/bin/export_bindings.rs` | Đăng ký toàn bộ DTO và error public BE-009 với binding generator |
| `src/bindings/keyboard-shortcuts.ts` | Một binding aggregate được sinh từ Rust; không sửa thủ công |
| `src-tauri/tests/keyboard_shortcuts_contract.rs` | Integration test migration, command, persistence, conflict và reset |
| `src-tauri/tests/data_management_contract.rs` | Contract test maintenance permit, typed plan/projection, shared transaction và publish sau commit |
| `src-tauri/tests/export_bindings.rs` | Contract test binding TypeScript khớp Rust source |
| `src-tauri/tests/app_builder.rs` | Smoke test composition root có managed state và bốn command |
| `tests/e2e/settings-keyboard-shortcuts.e2e.ts` | Desktop E2E Windows cho record, conflict, reset one/all sau khi FE-014 hoàn thành |

`settings/keyboard_shortcuts.rs` là file riêng vì `settings/mod.rs` đã sở hữu contract Appearance/General của BE-008 và Keyboard Shortcuts có schema, catalog cùng vòng đời riêng. Không sửa tay binding; generator phải tạo đúng một output aggregate và contract test phải fail nếu file trên đĩa lệch kết quả sinh.

Các file plugin global shortcut, capability của window Quick Note và adapter OS không nằm trong lát cắt Phase 1 này. Chúng phải được liệt kê và sở hữu bởi detailed design `BE-017`; phần Phase 3 của BE-009 chỉ mở rộng catalog/service và binding nêu trên.

## Dữ liệu

### Bảng `keyboard_shortcut_overrides`

Mỗi hàng là một giá trị khác default. Boolean dùng `INTEGER`, với `0 = false`, `1 = true`. Không đặt unique constraint trên tổ hợp phím vì conflict là trạng thái hợp lệ cần persist và hiển thị cho người dùng giải quyết.

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `action_id` | `TEXT` | `PRIMARY KEY`, `NOT NULL`, độ dài 1–64 | ID catalog ổn định của action được ghi đè |
| `primary_modifier` | `INTEGER` | `NOT NULL`, boolean check | `Ctrl` trên Windows hoặc `Command` trên macOS |
| `alt_modifier` | `INTEGER` | `NOT NULL`, boolean check | `Alt` trên Windows hoặc `Option` trên macOS |
| `shift_modifier` | `INTEGER` | `NOT NULL`, boolean check | Modifier Shift |
| `key_code` | `TEXT` | `NOT NULL`, độ dài 1–32 | `KeyboardEvent.code` canonical thuộc allowlist |

- Index: Không có ngoài primary key; số action nhỏ và conflict được tính từ snapshot trong bộ nhớ.
- Migration: `src-tauri/migrations/0004_create_keyboard_shortcuts.sql`

Migration phải tương đương chính xác với:

```sql
CREATE TABLE keyboard_shortcut_overrides (
    action_id TEXT PRIMARY KEY NOT NULL CHECK (length(action_id) BETWEEN 1 AND 64),
    primary_modifier INTEGER NOT NULL CHECK (primary_modifier IN (0, 1)),
    alt_modifier INTEGER NOT NULL CHECK (alt_modifier IN (0, 1)),
    shift_modifier INTEGER NOT NULL CHECK (shift_modifier IN (0, 1)),
    key_code TEXT NOT NULL CHECK (length(key_code) BETWEEN 1 AND 32)
);
```

Không có row default. `set_keyboard_shortcut` upsert đúng một row khi current khác default và xóa row khi current trở về default. `reset_keyboard_shortcut` xóa một row; `reset_all_keyboard_shortcuts` xóa toàn bảng trong một transaction.

Registry migration có thứ tự cố định:

1. `0001_create_projects.sql` — `BE-003`.
2. `0002_create_settings.sql` — `BE-008`.
3. `0003_create_cli_profiles.sql` — `BE-006`.
4. `0004_create_keyboard_shortcuts.sql` — `BE-009`.

## Catalog action và default

Thứ tự trong bảng dưới là thứ tự trả về và là nguồn duy nhất để FE-014 group/render. `Primary` là abstraction theo OS đã mô tả; tất cả action Phase 1 có scope `application`.

| Thứ tự | `action_id` | Label English | Category | Default |
|---:|---|---|---|---|
| 1 | `search.open_command_palette` | `Search or run a command` | `navigation` | `Primary+KeyK` |
| 2 | `navigation.previous_project` | `Previous project` | `navigation` | `Primary+Alt+ArrowLeft` |
| 3 | `navigation.next_project` | `Next project` | `navigation` | `Primary+Alt+ArrowRight` |
| 4 | `navigation.previous_session` | `Previous session` | `navigation` | `Primary+Alt+ArrowUp` |
| 5 | `navigation.next_session` | `Next session` | `navigation` | `Primary+Alt+ArrowDown` |
| 6 | `navigation.previous_tab` | `Previous tab` | `navigation` | `Primary+PageUp` |
| 7 | `navigation.next_tab` | `Next tab` | `navigation` | `Primary+PageDown` |
| 8 | `tabs.create` | `New tab` | `tabs` | `Primary+KeyT` |
| 9 | `tabs.close` | `Close tab` | `tabs` | `Primary+KeyW` |
| 10 | `tabs.reopen_closed` | `Reopen closed tab` | `tabs` | `Primary+Shift+KeyT` |
| 11 | `panes.split_right` | `Split right` | `panes` | `Primary+Backslash` |
| 12 | `panes.split_down` | `Split down` | `panes` | `Primary+Alt+Backslash` |
| 13 | `panes.maximize_toggle` | `Maximize or restore pane` | `panes` | `Primary+Shift+KeyM` |
| 14 | `panes.close` | `Close pane` | `panes` | `Primary+Shift+KeyW` |
| 15 | `panes.focus_up` | `Focus pane above` | `panes` | `Primary+Alt+Shift+ArrowUp` |
| 16 | `panes.focus_down` | `Focus pane below` | `panes` | `Primary+Alt+Shift+ArrowDown` |
| 17 | `panes.focus_left` | `Focus pane left` | `panes` | `Primary+Alt+Shift+ArrowLeft` |
| 18 | `panes.focus_right` | `Focus pane right` | `panes` | `Primary+Alt+Shift+ArrowRight` |

Action catalog dùng label tiếng Anh cố định theo ngôn ngữ ban đầu. `Search or run a command` là một action, không tạo hai default trùng nhau cho Search và Command Palette. Runtime availability như không có session/tab, tab không thể reopen hoặc đã đủ bốn pane không thuộc snapshot BE-009; frontend lấy state feature hiện tại và không dispatch action bị disable. Khi dispatch:

- `navigation.previous_tab`/`next_tab` resolve tab kế tiếp từ snapshot rồi gọi `set_active_tab`; pane focus resolve leaf kề nhau từ layout rồi gọi `set_active_pane`.
- `tabs.create`, `panes.split_right` và `panes.split_down` lần lượt gọi `create_tab` hoặc `split_pane` của BE-005 với direction typed.
- Close tab/pane luôn đi qua `get_close_impact` và luồng xác nhận trước `close_runtime_target`; shortcut không được bỏ qua cảnh báo.
- `tabs.reopen_closed` gọi `reopen_last_closed_tab`; maximize/restore gọi `set_maximized_pane` với active pane hoặc `None` theo trạng thái hiện tại.

Khi giai đoạn 15 hoàn thành, catalog được mở rộng bằng `files.toggle_explorer`, label `Toggle File Explorer`, category `files`, scope `application`, default `Primary+Shift+Backslash`. Khi giai đoạn 19 hoàn thành, catalog được mở rộng bằng `quick_note.open_global`, label `Open Quick Note (works outside XWork)`, category `global`, scope `global`, default `Primary+Shift+KeyN`. Hai lần mở rộng chỉ thay compile-time catalog/binding; schema `0004` không đổi và không thêm row đến khi người dùng customize.

## DTO public

Tất cả enum serialize thành literal `snake_case`; field struct serialize/export thành `camelCase`.

```rust
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct ShortcutChordDto {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub key_code: String,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ShortcutCategoryDto {
    Global,
    Navigation,
    Tabs,
    Panes,
    Files,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ShortcutScopeDto {
    Application,
    Global,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct KeyboardShortcutActionDto {
    pub action_id: String,
    pub label: String,
    pub category: ShortcutCategoryDto,
    pub scope: ShortcutScopeDto,
    pub default_chord: ShortcutChordDto,
    pub current_chord: ShortcutChordDto,
    pub is_custom: bool,
    pub conflicts_with: Vec<String>,
    pub is_dispatchable: bool,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct KeyboardShortcutsDto {
    pub actions: Vec<KeyboardShortcutActionDto>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SetKeyboardShortcutInputDto {
    pub action_id: String,
    pub chord: ShortcutChordDto,
}
```

`conflicts_with` chứa ID các action khác có cùng fingerprint, theo thứ tự catalog. `is_dispatchable` đúng khi và chỉ khi danh sách đó rỗng. Frontend tự format `Primary`, key glyph và thứ tự modifier theo OS; không parse label hiển thị để tạo request.

`key_code` hợp lệ là một trong: `KeyA`–`KeyZ`, `Digit0`–`Digit9`, `F1`–`F12`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `PageUp`, `PageDown`, `Home`, `End`, `Insert`, `Delete`, `Backspace`, `Enter`, `Escape`, `Space`, `Tab`, `Backslash`, `BracketLeft`, `BracketRight`, `Minus`, `Equal`, `Comma`, `Period`, `Slash`, `Semicolon`, `Quote`, `Backquote`. So sánh code phân biệt hoa/thường và backend không tự sửa typo.

## Public backend interface

Capability cung cấp interface Rust để BE-012 và extension BE-017 không đọc repository/bảng nội bộ. Các kiểu override/plan/projection là Rust-internal, không derive `TS` và không làm thay đổi IPC DTO:

```rust
pub struct ShortcutOverride {
    pub action_id: String,
    pub chord: ShortcutChordDto,
}

pub struct ShortcutOverridesImportPlan {
    // Private owned row operations and the complete committed projection.
}

pub struct KeyboardShortcutsCommittedProjection {
    // Private owned override map, conflict projection, and revision.
}

impl KeyboardShortcutsService {
    /// Returns the current conflict-projected shortcut snapshot from memory.
    pub fn snapshot(&self) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError>;

    /// Exports only persisted overrides from the coordinator-owned transaction.
    pub fn export_overrides_in(
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<Vec<ShortcutOverride>, KeyboardShortcutsError>;

    /// Validates overrides and builds an owned replacement plan.
    pub fn prepare_replace_overrides_in(
        tx: &rusqlite::Transaction<'_>,
        overrides: &[ShortcutOverride],
    ) -> Result<ShortcutOverridesImportPlan, KeyboardShortcutsError>;

    /// Applies a prepared replacement in the coordinator-owned transaction.
    pub fn apply_replace_overrides_in(
        tx: &rusqlite::Transaction<'_>,
        plan: &ShortcutOverridesImportPlan,
    ) -> Result<KeyboardShortcutsCommittedProjection, KeyboardShortcutsError>;

    /// Resets every override in the coordinator-owned transaction.
    pub fn reset_overrides_in(
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<KeyboardShortcutsCommittedProjection, KeyboardShortcutsError>;

    /// Publishes a committed projection to cache and internal subscribers.
    pub fn publish_data_change(&self, projection: KeyboardShortcutsCommittedProjection);
}
```

`prepare_replace_overrides_in` từ chối action lạ, duplicate `action_id` hoặc chord không hợp lệ và dựng sẵn toàn bộ operations/conflict projection; apply sau đó xóa và insert candidate atomically. `export_overrides_in` sort theo thứ tự catalog và không xuất default; reset dùng `reset_overrides_in`. Mọi plan/projection phải owned, `Send + 'static`, không giữ connection/transaction/row borrow/lock guard hoặc callback. API `_in` chỉ dùng transaction do coordinator truyền, không lấy `DataReadPermit`, service write gate hoặc gọi Storage lồng. Sau commit, `publish_data_change` consume projection, thay cache rồi publish internal watch no-fail; Tauri side effect nếu có chỉ best-effort và không biến commit thành typed failure. Đây là Rust API, không phải Tauri command.

Ở Phase 3, service bổ sung `subscribe() -> tokio::sync::watch::Receiver<KeyboardShortcutsDto>`. BE-017 nhận snapshot hiện tại ngay khi subscribe và reconcile duy nhất `quick_note.open_global`; publish diễn ra sau commit/cache replace. Scope/application shortcut vẫn do frontend dispatch, và không có consumer nào được đọc bảng trực tiếp. Chi tiết đăng ký/unregister OS, lỗi chord bị ứng dụng khác chiếm và vòng đời cửa sổ thuộc contract BE-017.

## Tauri command

Mọi command là `async`, command mỏng và nhận managed `KeyboardShortcutsService`. Công việc SQLite từ command phải chạy trọn trong `tauri::async_runtime::spawn_blocking`. Ba command persistent mutation lấy `DataReadPermit` sau authorization/validation cơ bản nhưng trước service write gate/Storage, giữ qua commit cùng cache/internal-subscription publish; permit là dependency Rust nội bộ, không xuất hiện trong command hoặc DTO. Command đọc không lấy permit.

### `get_keyboard_shortcuts`

Trả catalog đã merge override và chiếu conflict từ cache.

```rust
#[tauri::command]
pub async fn get_keyboard_shortcuts(
    state: tauri::State<'_, KeyboardShortcutsService>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Không có input; service phải khởi tạo thành công trước khi command được đăng ký |
| Side effect | Không có; không query SQLite mỗi lần đọc |
| Lỗi trả về | `Unavailable` nếu service đang shutdown hoặc cache bị poison |

### `set_keyboard_shortcut`

Đặt current chord cho đúng một action và trả toàn snapshot sau mutation.

```rust
#[tauri::command]
pub async fn set_keyboard_shortcut(
    window: tauri::WebviewWindow,
    input: SetKeyboardShortcutInputDto,
    state: tauri::State<'_, KeyboardShortcutsService>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller label là `main`; `action_id` khớp đúng catalog hiện hành; chord dùng code allowlist, có `primary` hoặc `alt` trừ F1–F12; không phải tổ hợp OS reserved |
| Side effect | Lấy `DataReadPermit`; upsert một override hoặc xóa nếu bằng default; commit trước cache replace/publish rồi nhả permit; conflict vẫn commit; no-op không ghi database |
| Lỗi trả về | `UnauthorizedWindow`, `ActionNotFound`, `InvalidKeyCode`, `ModifierRequired`, `ReservedShortcut`, `PersistenceFailed`, `Unavailable` |

### `reset_keyboard_shortcut`

Khôi phục default của một action.

```rust
#[tauri::command]
pub async fn reset_keyboard_shortcut(
    window: tauri::WebviewWindow,
    action_id: String,
    state: tauri::State<'_, KeyboardShortcutsService>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller label là `main`; ID dài 1–64 và có trong catalog hiện hành |
| Side effect | Lấy `DataReadPermit`; xóa override nếu có; commit/cache publish rồi nhả permit; không có row là no-op thành công; trả snapshot conflict mới |
| Lỗi trả về | `UnauthorizedWindow`, `ActionNotFound`, `PersistenceFailed`, `Unavailable` |

### `reset_all_keyboard_shortcuts`

Khôi phục toàn bộ default hiện hành và xóa cả row orphan từ catalog phiên bản khác.

```rust
#[tauri::command]
pub async fn reset_all_keyboard_shortcuts(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, KeyboardShortcutsService>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller label là `main` |
| Side effect | Lấy `DataReadPermit`; `DELETE` toàn bảng trong một transaction; commit/cache publish rồi nhả permit; bảng rỗng là no-op thành công; trả catalog default conflict-free |
| Lỗi trả về | `UnauthorizedWindow`, `PersistenceFailed`, `Unavailable` |

Chỉ window `main` được mutation. Window do XWork tạo có thể đọc snapshot nếu sau này cần hiển thị accelerator, nhưng Quick Note window không có lý do gọi ba command ghi.

## Event / Channel phát ra

Không có Tauri event hoặc Channel. FE-014 nhận snapshot mới trực tiếp từ command và re-query khi mount/focus. Phase 3 chỉ thêm `tokio::sync::watch` nội bộ cho BE-017; đây không phải IPC và consumer chậm được phép bỏ qua snapshot trung gian để reconcile từ giá trị mới nhất.

## Business rule và invariant

1. `action_id` là identifier ổn định, không lấy từ label và không được đổi khi sửa copy. Mỗi catalog build không có ID trùng hoặc default trùng.
2. Snapshot luôn có đúng một phần tử cho mỗi action hiện hành, theo thứ tự catalog; Phase 1 có đúng 18 action trong bảng default.
3. Current chord bằng override nếu có, ngược lại bằng default. `is_custom` tương đương `current_chord != default_chord`.
4. Fingerprint conflict là tuple `(primary, alt, shift, key_code)` so sánh chính xác. Category và scope không làm hai tổ hợp giống nhau hết conflict vì application/global cùng hoạt động khi XWork có focus.
5. Mọi thành viên của group có từ hai action trở lên chứa toàn bộ ID còn lại trong `conflicts_with` và có `is_dispatchable = false`. Group một action có danh sách rỗng và được dispatch.
6. Xung đột không phải lỗi validation và không rollback mutation. FE-014 highlight tất cả row liên quan, nêu label action còn lại và cho đổi/reset.
7. Shortcut chữ/số/ký hiệu phải có `primary` hoặc `alt`; F1–F12 được phép không modifier. Rule này ngăn override bằng phím gõ văn bản thông thường nhưng vẫn cho function key độc lập.
8. Backend từ chối modifier-only, code ngoài allowlist, `Alt+F4` và `Primary+Alt+Delete` trên Windows; trên macOS từ chối `Primary+KeyQ`, `Primary+KeyH`, `Primary+KeyM` và `Primary+Alt+Escape`. Frontend cũng không record event đang IME composition, `AltGraph`, key repeat hoặc modifier-only.
9. Dispatch application shortcut dùng `KeyboardEvent.code`, `preventDefault` chỉ sau khi match đúng một action dispatchable và handler runtime đang available. Event từ `input`, `textarea`, `select`, `contenteditable`, editor Markdown hoặc terminal được bỏ qua, ngoại trừ `search.open_command_palette`; rule ngoại lệ này phải có test để không phá nhập liệu/IME.
10. Shortcut gọi close tab/pane không bỏ qua `CloseImpact` hoặc confirmation của BE-005. Shortcut split vẫn chịu giới hạn bốn pane; shortcut reopen vẫn chịu `NoClosedTab`.
11. Cùng input với current chord là no-op: không ghi, không publish và không thay snapshot. Reset một action không custom và reset all khi bảng rỗng cũng là no-op.
12. Write thành công có thứ tự transaction commit → cache replace → Phase 3 publish. Commit lỗi giữ database/cache/subscriber cũ; không trả snapshot chưa commit.
13. Startup merge toàn bộ override của action đã biết rồi validate full snapshot. Row của action lạ được bảo toàn nhưng không trả trong snapshot để binary cũ không phá dữ liệu mới; row action đã biết nhưng chord hỏng làm startup fail, không tự reset.
14. `reset_all_keyboard_shortcuts` là ngoại lệ có chủ ý: nó xóa cả row lạ vì người dùng đã yêu cầu khôi phục toàn bộ default. Reset một action không chạm row khác.
15. Phase 1 tuyệt đối không chứa `quick_note.open_global`; Phase 3 chỉ thêm action đó sau khi BE-017 handler/window và BE-001 tray integration đã sẵn sàng. Không có menu/action chết.
16. Không ghi label, toàn snapshot hoặc raw persistence error vào log. Log chỉ chứa operation, `action_id` ổn định, số conflict và error code; không log chord người dùng nếu không cần chẩn đoán.
17. Mọi persistent mutation lấy `DataReadPermit` trước service write gate/Storage và giữ qua commit cùng cache/subscription publish. Lock order duy nhất là `DataMaintenanceGate` → Keyboard Shortcuts write gate → Storage; owner `_in` API chạy dưới write permit của BE-012 nên không re-enter gate, write gate hoặc Storage.

## Lỗi

```rust
#[derive(Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
pub enum KeyboardShortcutsError {
    UnauthorizedWindow,
    ActionNotFound { action_id: String },
    InvalidKeyCode { key_code: String },
    ModifierRequired,
    ReservedShortcut,
    CorruptStoredShortcut { action_id: String },
    PersistenceFailed,
    Unavailable,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Window khác `main` gọi mutation | Không retry; sửa caller boundary |
| `ActionNotFound` | ID không có trong catalog hiện hành | Refresh snapshot; không tạo row lạ |
| `InvalidKeyCode` | Code ngoài allowlist hoặc sai canonical casing | Giữ recorder mở và yêu cầu tổ hợp khác |
| `ModifierRequired` | Key không phải F1–F12 nhưng thiếu cả Primary và Alt | Giải thích shortcut không được là phím gõ thường |
| `ReservedShortcut` | Tổ hợp bị hệ điều hành/lifecycle giữ lại | Yêu cầu chọn tổ hợp khác |
| `CorruptStoredShortcut` | Row của action đã biết không decode/validate được khi startup | Lỗi dữ liệu cấp ứng dụng; không tự reset |
| `PersistenceFailed` | Query, transaction hoặc commit SQLite thất bại | Giữ snapshot cũ, cho retry, không hiển thị raw DB error |
| `Unavailable` | Lock/cache poison, blocking task fail hoặc service shutdown | Hiển thị lỗi tạm thời và cho retry/restart |

Conflict không có variant lỗi. Lỗi plugin global/chord bị ứng dụng bên ngoài chiếm chỉ xuất hiện trong contract BE-017 ở Phase 3, không được map sai thành conflict nội bộ BE-009.

## Luồng chính

### Khởi tạo và đọc

1. BE-002 chạy registry đến version 4 trước khi app khởi tạo service.
2. Service đọc toàn bộ override một lần qua `Storage::with_connection`, parse boolean/code, giữ row lạ riêng và validate row action hiện hành.
3. Service merge catalog/default với override, group fingerprint, tạo `conflicts_with`/`is_dispatchable` và lưu snapshot immutable trong cache.
4. Chỉ sau khi bước 2–3 thành công, composition root manage service và đăng ký command; startup fail nếu dữ liệu của action đã biết bị hỏng.

### Đổi shortcut và xử lý conflict

1. FE-014 record một `KeyboardEvent.code`, normalize modifier thành `primary/alt/shift` theo OS rồi gọi `set_keyboard_shortcut`.
2. Command xác nhận window `main`, lấy `DataReadPermit`, rồi service lấy write gate, validate ID/chord và clone override map hiện hành.
3. Candidate bằng default thì xóa override; khác default thì upsert. Service dựng toàn candidate snapshot và conflict projection trước khi chạm database.
4. Trong `spawn_blocking`, service dùng `Storage::with_transaction` để thực hiện đúng mutation. Conflict không chặn commit.
5. Sau commit, service thay cache, publish internal watch nếu Phase 3 rồi nhả `DataReadPermit`; command trả snapshot. FE cập nhật mọi row liên quan và dispatcher ngừng toàn group conflict.

### Reset

1. Reset one validate action rồi xóa đúng row; snapshot được dựng lại để các action còn lại tự thoát conflict nếu group chỉ còn một.
2. Reset all xóa toàn bảng, kể cả orphan; snapshot trở về toàn bộ default và phải conflict-free.
3. Nếu transaction thất bại, cả cache và UI response giữ trạng thái trước reset.

### Mở rộng Quick Note ở Phase 3

1. BE-017 hoàn thành handler/window Quick Note và cung cấp OS registration adapter trước khi catalog expose action.
2. BE-009 thêm đúng catalog entry `quick_note.open_global`, mở rộng binding/category/scope nếu cần và bật internal watch; không đổi migration `0004`.
3. BE-017 subscribe snapshot, chỉ đăng ký current chord khi `conflicts_with` rỗng; update/reset thành công làm adapter reconcile chord sau publish.
4. BE-001 tray hiển thị `Quick Note` và accelerator hiện hành chỉ sau khi handler hoạt động. FE-014 lúc đó mới render group Global/action mới.

## Ràng buộc kỹ thuật

- Blocking: Startup được đọc SQLite đồng bộ trước khi phục vụ IPC. Từ async command, clone service vào `tauri::async_runtime::spawn_blocking` và chạy trọn write gate → candidate/validation → `Storage::with_transaction` → cache replace; ngoài owned `DataReadPermit`, không giữ `State`, DB connection, transaction hoặc lock guard qua `.await`.
- Bảo mật: Không nhận path, script, command string hoặc key sequence text từ frontend. Mọi SQL dùng bind parameter; mutation chỉ từ `main`. Shortcut không cấp quyền filesystem/shell/OS cho WebView.
- Hiệu năng: Catalog tối đa vài chục action; dựng snapshot và conflict phải O(n) bằng hash map fingerprint. `get` chỉ clone cache, không I/O. Một mutation p95 dưới `100 ms` trên máy Windows hỗ trợ khi database không contention.
- Concurrency: Một standard-library write gate tuần tự mọi normal mutation và một `RwLock` cho cache. Thứ tự cố định: `DataMaintenanceGate` read permit → write gate → clone cache rồi nhả cache read → Storage → cache write/publish; không gọi ngược service trong callback Storage. Maintenance `_in` path dùng shared transaction của coordinator và không lấy lại permit/write gate/Storage.
- Desktop boundary: Phase 1 không thêm plugin/capability permission. Global shortcut Phase 3 dùng official Tauri plugin từ Rust do BE-017 sở hữu, không cấp API global-shortcut cho frontend.
- Khả năng truy cập: Recorder FE phải có thao tác keyboard hoàn chỉnh, mô tả conflict bằng text ngoài màu và cho Escape hủy; backend trả label/ID typed đủ để làm việc này.

## Tiêu chí hoàn thành

- [ ] Migration registry có version 4 liên tiếp và schema đúng contract; default không tạo row, override sống qua restart.
- [ ] Snapshot Phase 1 có đúng 18 action, ID/order/label/default đúng bảng và không có `quick_note.open_global` hoặc `files.toggle_explorer`.
- [ ] `set_keyboard_shortcut` lưu override, xóa override khi bằng default và từ chối code/modifier/reserved combo không hợp lệ trước database.
- [ ] Hai hoặc nhiều action cùng fingerprint đều liệt kê nhau, đều không dispatchable và vẫn round-trip qua restart.
- [ ] Reset one chỉ xóa target và cập nhật conflict; reset all xóa cả orphan, trả default conflict-free; mọi no-op không ghi database.
- [ ] Chỉ `main` mutation được; command đọc dùng cache; lỗi commit không thay cache hoặc publish.
- [ ] Persistent mutation giữ `DataReadPermit` qua commit/publish; write permit BE-012 chặn mutation, còn typed `_in` replace/reset dùng shared transaction, rollback không publish và commit publish cache/subscriber no-fail.
- [ ] Shortcut tab/pane đi qua đúng command, limit và close-impact contract BE-005; typing target, terminal và IME không bị handler ứng dụng chiếm ngoài ngoại lệ Command Palette.
- [ ] Binding aggregate được sinh từ Rust và contract test phát hiện drift; mọi function, method, callback, helper và test có comment ngắn theo quy tắc project.
- [ ] Ở Phase 3, chỉ khi BE-017 sẵn sàng mới có `quick_note.open_global`; default hiển thị `Ctrl+Shift+N` Windows, conflict nội bộ ngăn đăng ký và đổi/reset được publish cho consumer Rust.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features` trong `src-tauri/` và các check frontend liên quan đều pass; sau khi FE-014 nối IPC, `pnpm tauri build` pass với binding/command boundary thật.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/settings/keyboard_shortcuts.rs` (`#[cfg(test)]`) | Unit | Catalog uniqueness/order/default; allowlist/reserved theo OS; merge override; fingerprint/group 2–3 action; all-conflicted suppression; unknown row; default/no-op |
| `src-tauri/tests/keyboard_shortcuts_contract.rs` | Integration | Migration v4; get/set/reset one/all qua managed state; window authorization; restart persistence; concurrent writes; rollback/cache consistency |
| `src-tauri/tests/data_management_contract.rs` | Integration | Write permit chặn mutation; typed `_in` replacement/reset dùng shared transaction; rollback không publish; commit publish cache/subscriber no-fail |
| `src-tauri/tests/export_bindings.rs` | Contract | Sinh toàn bộ DTO/error BE-009 và fail khi `src/bindings/keyboard-shortcuts.ts` lệch Rust source |
| `src-tauri/tests/app_builder.rs` | Integration | App builder manage service, đăng ký đúng bốn command và không thêm global plugin Phase 1 |
| `tests/e2e/settings-keyboard-shortcuts.e2e.ts` | Desktop E2E Windows | Search action, record bằng `code`, conflict text/không dispatch, reset row/all, focus/IME/terminal guard; Phase 3 mở Quick Note từ global chord |

Test database dùng temporary directory/file riêng, không chạm app data thật. Test global shortcut hệ điều hành chỉ chạy trong lát cắt BE-017 trên Windows; unit test BE-009 Phase 1 không đăng ký phím toàn cục thật và macOS được hoãn đến release preparation theo quy tắc repository.

## Câu hỏi mở

- Không có.
