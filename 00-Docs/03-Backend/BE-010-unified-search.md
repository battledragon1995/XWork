# BE-010 — Unified search

Tài liệu này đặc tả hợp đồng backend cho tìm kiếm hợp nhất và command catalog của Command Palette, gồm kết quả Phase 1 và các điểm mở rộng theo phase.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-010` |
| Phase | `1`; mở rộng Files ở Phase 2, Notes ở Phase 3 và Events ở Phase 4 |
| Capability | `src-tauri/src/search/` |
| Yêu cầu chức năng | §14, §18 |
| Frontend liên quan | `FE-009`; điểm vào thuộc `FE-001`; kết quả mở đối tượng của `FE-004`, `FE-006`, `FE-016`–`FE-017`, `FE-019`, `FE-021`–`FE-022` theo phase |
| Phụ thuộc | Phase 1: `BE-003`, `BE-005`, `BE-009`; mở rộng: `BE-014` ở Phase 2, `BE-016` ở Phase 3, `BE-018` ở Phase 4 |

## Mục tiêu

Backend tổng hợp project, session và command từ public query của capability sở hữu, chuẩn hóa matching/ranking thành một response typed và không truy cập repository hoặc state nội bộ của nguồn. Khi File, Note và Event được triển khai, capability Search nhận thêm public source adapter đúng phase mà không thay đổi semantics của nhóm đã có.

### Ngoài phạm vi

- Không tạo bảng, migration, chỉ mục tìm kiếm bền vững hoặc cache nội dung. Source capability vẫn là nguồn dữ liệu chính và chịu trách nhiệm query dữ liệu của mình.
- Không đọc trực tiếp SQLite của Projects/Notes/Calendar, map runtime của Sessions, cây file, keyboard override table hoặc filesystem.
- Không thực thi kết quả, điều hướng route, mở file, tạo session hoặc chạy action. FE-009 chuyển `target` typed sang handler của feature sở hữu; mọi validation/mutation cuối vẫn đi qua command gốc.
- Không tìm trong terminal output, source-file content, secret CLI profile, environment variable hoặc dữ liệu trong Trash.
- Không thiết kế UI Command Palette. Focus trap, combobox semantics, keyboard selection, loading/empty/error và highlight render thuộc FE-009; backend chỉ cung cấp dữ liệu đủ để thực hiện.
- Không thêm source Files/Notes/Events giả hoặc group rỗng trước phase sở hữu. Một source chỉ được activate sau khi public query và luồng mở đối tượng thật đã sẵn sàng.

### Quyết định và giả định đã chốt

- Search sở hữu consumer-side ports và ranking, còn adapter trong composition root chỉ gọi public query tương ứng với `list_projects(None)`, `list_sessions(None)` và `KeyboardShortcutsService::snapshot()`. Đây là dependency vào contract công khai, không phải quyền truy cập repository/lock nội bộ.
- Query chạy theo yêu cầu, không duy trì index sao chép. Project/session/command có quy mô nhỏ ở Phase 1; Files/Notes/Events bắt buộc lọc và cap candidate tại source để không tải toàn bộ domain vào Search.
- Lỗi hoặc timeout một source trả response partial cùng `source_failures`; không làm mất Commands và các nhóm đã trả được. Cách này giữ Command Palette dùng được để điều hướng/khắc phục lỗi mà không giả kết quả từ source hỏng.
- Query rỗng trả command suggestions khả dụng, không trả toàn bộ project/session. Query khác rỗng áp dụng cùng token matching cho mọi group. Không thêm cú pháp đặc biệt như prefix `>` vì yêu cầu chưa nêu.
- Thứ tự group cố định là Projects, Sessions, Files, Notes, Events, Commands; chỉ group active có kết quả mới xuất hiện. Trong group, relevance thắng trước rồi mới dùng thứ tự ổn định của source.
- Command Palette dùng catalog rộng hơn Keyboard Shortcuts. Mọi action hiện hành của BE-009, trừ action tự mở palette, tự trở thành command; Search bổ sung một tập route/context command tối thiểu không có shortcut. Shortcut conflict chỉ ngăn key dispatch, không ngăn người dùng chạy cùng action bằng Palette.
- Wireframe với query `pty` vẫn hiển thị `New Session in xwork` và `Open Settings › Terminal & CLI Profiles`. Hai command này có keyword ẩn `terminal`, `shell`, `pty`, nên là kết quả matching hợp lệ thay vì suggestion không liên quan.
- Highlight được trả bằng offset Unicode scalar trên chuỗi hiển thị gốc, không dùng byte offset Rust hay UTF-16 offset JavaScript. FE-009 chuyển qua `Array.from(text)` để cắt đúng Unicode.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Bảo đảm dependency Tokio hiện hành bật feature `time`; test target bật `test-util` nếu lockfile chưa có |
| `src-tauri/Cargo.lock` | Khóa dependency sau thay đổi manifest nếu cần; không sửa thủ công |
| `src-tauri/src/lib.rs` | Export module `search` cho composition root |
| `src-tauri/src/search/mod.rs` | Public DTO, error, source port và Tauri command của capability |
| `src-tauri/src/search/ranking.rs` | Chuẩn hóa token, score, deterministic ordering và Unicode highlight range thuần |
| `src-tauri/src/search/service.rs` | Command catalog, orchestration source song song, timeout, projection và phase registration |
| `src-tauri/src/app/mod.rs` | Khởi tạo `SearchService`, inject source adapters, manage state và đăng ký command |
| `src-tauri/src/app/search_sources.rs` | Adapter từ consumer-side ports sang public query BE-003/005/009 và các source phase sau |
| `src-tauri/src/bin/export_bindings.rs` | Đăng ký DTO/error BE-010 với binding generator |
| `src/bindings/search.ts` | Binding TypeScript aggregate được sinh từ Rust; không sửa thủ công |
| `src-tauri/tests/unified_search_contract.rs` | Integration test command, adapters, partial failure, timeout và phase source |
| `src-tauri/tests/export_bindings.rs` | Contract test binding trên đĩa khớp Rust source |
| `src-tauri/tests/app_builder.rs` | Smoke test composition root đăng ký state/source/command đúng phase |

Việc tách `ranking.rs` và `service.rs` có lý do thực tế: ranking là thuật toán thuần cần unit test dày, trong khi service giữ async ports/deadline và catalog. Không tách repository vì Search không sở hữu persistence. Binding chỉ được sinh từ Rust.

## Dữ liệu

BE-010 không có bảng hoặc migration. Kết quả là snapshot tạm thời được dựng từ source tại thời điểm command chạy; không ghi query, lịch sử tìm, recent result hoặc bản sao nội dung. Registry migration giữ nguyên version hiện hành của giai đoạn trước.

## DTO public

Mọi struct field serialize/export thành `camelCase`; enum serialize thành literal `snake_case` và enum có dữ liệu dùng discriminator `kind`.

```rust
#[derive(Clone, Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct UnifiedSearchInputDto {
    pub query: String,
    pub context_project_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SearchTextRangeDto {
    pub start_scalar: u32,
    pub end_scalar: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SearchResultKindDto {
    Project,
    Session,
    File,
    Note,
    Event,
    Command,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SearchShortcutDto {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub key_code: String,
    pub is_conflicted: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum SearchTargetDto {
    Project {
        project_id: String,
    },
    Session {
        project_id: String,
        session_id: String,
    },
    File {
        project_id: String,
        relative_path: String,
    },
    Note {
        note_id: String,
    },
    Event {
        event_id: String,
    },
    Command {
        action_id: String,
        project_id: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SearchResultDto {
    pub key: String,
    pub kind: SearchResultKindDto,
    pub title: String,
    pub context: Option<String>,
    pub title_highlights: Vec<SearchTextRangeDto>,
    pub context_highlights: Vec<SearchTextRangeDto>,
    pub target: SearchTargetDto,
    pub shortcut: Option<SearchShortcutDto>,
    pub supports_open_in_split: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SearchGroupDto {
    pub kind: SearchResultKindDto,
    pub label: String,
    pub results: Vec<SearchResultDto>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SearchSourceDto {
    Projects,
    Sessions,
    Files,
    Notes,
    Events,
    Commands,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum SearchSourceFailureReasonDto {
    Timeout,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct SearchSourceFailureDto {
    pub source: SearchSourceDto,
    pub reason: SearchSourceFailureReasonDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct UnifiedSearchResponseDto {
    pub query: String,
    pub groups: Vec<SearchGroupDto>,
    pub result_count: u32,
    pub source_failures: Vec<SearchSourceFailureDto>,
}
```

`query` trong response là input đã trim hai đầu nhưng giữ nguyên casing/khoảng trắng bên trong để UI không nhảy text. `key` chỉ dùng làm identity render, có prefix kind và opaque source identity; frontend không parse nó. Group label cố định bằng English: `Projects`, `Sessions`, `Files`, `Notes`, `Events`, `Commands`.

Mỗi range là half-open `[start_scalar, end_scalar)`, nằm trong độ dài Unicode scalar của đúng field, `start < end`, sort tăng, không overlap. `context_highlights` rỗng khi `context = None`. Mỗi group trả tối đa `8` result; `has_more = true` nếu source có thêm candidate matching sau giới hạn. `result_count` là tổng số result thực sự có trong response, không phải tổng count chưa tải.

`key` được tạo lần lượt là `project:{projectId}`, `session:{sessionId}`, `file:{projectId}:{relativePath}`, `note:{noteId}`, `event:{eventId}` hoặc `command:{actionId}`. Dấu phân cách bên trong identity không ảnh hưởng vì key không bao giờ được parse; uniqueness được kiểm tra trên chuỗi đầy đủ.

`supports_open_in_split` chỉ đúng cho File sau khi BE-014 hỗ trợ mở vào pane/split. Footer FE-009 chỉ hiển thị `Ctrl+Enter open in split` khi row đang chọn có cờ này; mọi target khác dùng Enter mặc định và bỏ qua Ctrl+Enter.

## Public source contract

Search sở hữu các document tối thiểu và port consumer-side. Chúng không derive `TS`, không lộ qua IPC và không chứa implementation type của capability nguồn:

```rust
pub type SearchFuture<'a, T> =
    Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub struct ProjectSearchDocument {
    pub project_id: String,
    pub display_name: String,
    pub root_path: String,
    pub is_available: bool,
    pub source_order: u32,
}

pub struct SessionSearchDocument {
    pub session_id: String,
    pub project_id: String,
    pub name: String,
    pub status: SearchSessionStatus,
    pub source_order: u32,
}

pub struct ShortcutActionSearchDocument {
    pub action_id: String,
    pub label: String,
    pub current_chord: SearchShortcutChord,
    pub shortcut_conflicted: bool,
    pub source_order: u32,
}

pub struct FileSearchDocument {
    pub project_id: String,
    pub relative_path: String,
    pub file_name: String,
    pub project_name: String,
    pub supports_open_in_split: bool,
    pub source_order: u32,
}

pub struct NoteSearchDocument {
    pub note_id: String,
    pub title: Option<String>,
    pub matching_snippet: Option<String>,
    pub project_name: Option<String>,
    pub updated_at_ms: i64,
}

pub struct EventSearchDocument {
    pub event_id: String,
    pub title: String,
    pub matching_description: Option<String>,
    pub starts_at_ms: i64,
    pub time_zone_id: String,
    pub project_name: Option<String>,
}

pub struct SearchCandidates<T> {
    pub items: Vec<T>,
    pub has_more: bool,
}

pub enum SearchSourceError {
    Unavailable,
}

pub trait ProjectSearchSource: Send + Sync {
    /// Lists project metadata in the source-owned stable order.
    fn list_projects<'a>(
        &'a self,
    ) -> SearchFuture<'a, Result<Vec<ProjectSearchDocument>, SearchSourceError>>;
}

pub trait SessionSearchSource: Send + Sync {
    /// Lists runtime sessions in project-then-creation order.
    fn list_sessions<'a>(
        &'a self,
    ) -> SearchFuture<'a, Result<Vec<SessionSearchDocument>, SearchSourceError>>;
}

pub trait ShortcutCatalogSource: Send + Sync {
    /// Reads the current action and shortcut catalog from memory.
    fn shortcut_actions(
        &self,
    ) -> Result<Vec<ShortcutActionSearchDocument>, SearchSourceError>;
}

pub trait FileSearchSource: Send + Sync {
    /// Searches openable files without exposing absolute paths.
    fn search_files<'a>(
        &'a self,
        query: &'a str,
        candidate_limit: u32,
    ) -> SearchFuture<'a, Result<SearchCandidates<FileSearchDocument>, SearchSourceError>>;
}

pub trait NoteSearchSource: Send + Sync {
    /// Searches active and archived notes while excluding Trash.
    fn search_notes<'a>(
        &'a self,
        query: &'a str,
        candidate_limit: u32,
    ) -> SearchFuture<'a, Result<SearchCandidates<NoteSearchDocument>, SearchSourceError>>;
}

pub trait EventSearchSource: Send + Sync {
    /// Searches event definitions and returns the base event identity.
    fn search_events<'a>(
        &'a self,
        query: &'a str,
        candidate_limit: u32,
    ) -> SearchFuture<'a, Result<SearchCandidates<EventSearchDocument>, SearchSourceError>>;
}
```

`SearchSessionStatus` và `SearchShortcutChord` là internal value type do Search sở hữu; adapter map từ enum/chord public của BE-005/009. `source_order` được adapter gán theo index từ public query, không tự sort lại domain. Candidate limit cho Files/Notes/Events luôn là `64`; source phải set `has_more` nếu còn match và không được trả quá giới hạn.

Composition rules theo phase:

| Giai đoạn | Source active | Public contract adapter phải dùng |
|---|---|---|
| 12 / Phase 1 | Projects | Kết quả public tương đương `list_projects(None)` của BE-003; giữ pinned-then-insertion order và availability |
| 12 / Phase 1 | Sessions | Kết quả public tương đương `list_sessions(None)` của BE-005; chỉ summary runtime, không clone layout/buffer |
| 12 / Phase 1 | Commands | `KeyboardShortcutsService::snapshot()` của BE-009 cộng static command catalog BE-010 |
| 16 / Phase 2 | Files | Public query của capability file chỉ sau khi BE-014 có luồng mở file; tuân ignore/symlink/path boundary của owner |
| 18 / Phase 3 | Notes | Public query BE-016 theo title/content, gồm active và archived, loại Trash |
| 20 / Phase 4 | Events | Public query BE-018 theo title/description, trả base `event_id`, không materialize mọi recurrence |

Adapter map mọi source error chi tiết sang `SearchSourceError::Unavailable`, không log nội dung user. Search không được downcast adapter, import repository module hoặc nhận `Storage`, `Connection`, session lock hay filesystem root.

## Command catalog

Phase 1 tự project tất cả action từ BE-009 thành command với cùng `action_id`, label, current chord và thứ tự, ngoại trừ `search.open_command_palette` để không tạo action đệ quy. Các action vẫn xuất hiện nếu shortcut đang conflict; `SearchShortcutDto.is_conflicted = true`, nhưng Enter vẫn chạy action qua dispatcher bình thường.

Static command không có shortcut được chốt như sau:

| Thứ tự | `action_id` | Label | Keyword bổ sung | Điều kiện |
|---:|---|---|---|---|
| 1 | `navigation.open_home` | `Open Home` | `dashboard` | Luôn có |
| 2 | `navigation.open_projects` | `Open Projects` | `folders workspace` | Luôn có |
| 3 | `sessions.create_current_project` | `New Session in {projectName}` | `terminal shell pty cli` cùng project name/path | `context_project_id` trỏ tới project available |
| 4 | `settings.open_general` | `Open Settings › General` | `language tray window` | Luôn có |
| 5 | `settings.open_appearance` | `Open Settings › Appearance` | `theme colors font` | Luôn có |
| 6 | `settings.open_cli_profiles` | `Open Settings › Terminal & CLI Profiles` | `terminal shell pty codex claude cli` | Luôn có |
| 7 | `settings.open_keyboard_shortcuts` | `Open Settings › Keyboard Shortcuts` | `keys hotkey keybinding` | Luôn có |

Static catalog không chứa destructive command. Route/action của Files, Notes và Calendar chỉ được thêm cùng phase sở hữu; action mới do BE-009 cung cấp tự xuất hiện nếu handler thật đã được ghép. ID static và BE-009 phải unique; trùng ID làm unit test/composition startup fail thay vì chọn bản ghi ngầm.

## Matching, ranking và projection

Query được trim, lowercase Unicode bằng `char::to_lowercase` và tách theo Unicode whitespace. Mọi token phải match ít nhất một trong title, context hoặc keyword của document; thứ tự token không bắt buộc. Không bỏ dấu hoặc fuzzy edit-distance vì yêu cầu chưa cần và tránh dependency/behavior khó đoán.

Score nội bộ cho từng token lấy mức tốt nhất duy nhất:

| Match tốt nhất của token | Điểm |
|---|---:|
| Bằng toàn bộ title token | `120` |
| Prefix của một title token | `100` |
| Substring trong title | `80` |
| Prefix của một context token | `50` |
| Substring trong context | `30` |
| Prefix keyword | `20` |
| Substring keyword | `10` |

Tổng điểm token cộng bonus `1000` nếu toàn query bằng title đã chuẩn hóa, hoặc `500` nếu title bắt đầu bằng toàn query. Sort trong từng group theo score giảm dần; tie-break lần lượt:

- Projects, Sessions và Files: `source_order ASC`, rồi identity ASC.
- Notes: `updated_at_ms DESC`, rồi `note_id ASC`.
- Events: `starts_at_ms ASC`, rồi `event_id ASC`.
- Commands: static command trước theo bảng, sau đó action BE-009 theo `source_order`; cuối cùng `action_id ASC`.

Project match trên display name và root path; unavailable vẫn xuất hiện và selection mở Project Overview. Session match trên name, project name và status label. File match trên file name/relative path/project name. Note match trên title/body snippet/project name; title trống hiển thị `Untitled note`. Event match trên title/description/project name và context hiển thị thời gian đã format ở frontend từ source timestamp/timezone. Command match trên label, keyword, project context và action ID tách theo dấu chấm/gạch dưới.

Source content được collapse whitespace và cắt context ở `160` Unicode scalar với ellipsis trước khi tính highlight. Title cắt ở `256` scalar. Lowercase-expansion giữ map từ mỗi scalar normalized về scalar gốc để highlight đúng các ký tự Unicode; range chạm/overlap được merge. Không cắt target identity hoặc relative path dùng để mở đối tượng.

## Tauri command

### `search_unified`

Tìm song song mọi source active và trả grouped response có thể partial.

```rust
/// Searches active domain sources and the command catalog.
#[tauri::command]
pub async fn search_unified(
    window: tauri::WebviewWindow,
    input: UnifiedSearchInputDto,
    state: tauri::State<'_, SearchService>,
) -> Result<UnifiedSearchResponseDto, UnifiedSearchError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller label là `main`; query sau trim tối đa `128` Unicode scalar và không chứa control character; `context_project_id` nếu có là UUID hyphenated lowercase hợp lệ |
| Side effect | Không có; query source active song song, deadline riêng, dựng response trong bộ nhớ; không ghi database/filesystem hoặc phát event |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidQuery`, `InvalidContextProjectId`, `Unavailable` |

`context_project_id` hợp lệ về format nhưng đã bị remove/unavailable không làm cả search lỗi: command contextual New Session bị bỏ; kết quả khác vẫn trả. Query rỗng không gọi session/file/note/event source; nó đọc shortcut catalog và chỉ gọi project source khi có `context_project_id` để resolve command contextual, nhưng không trả group Project. Kết quả gồm tối đa 8 static/action command suggestions theo catalog, không highlight. Query chỉ có whitespace được xem là rỗng.

Với query khác rỗng, các source active được await song song với deadline `400 ms` mỗi source và deadline tổng `500 ms`. Timeout/error được đưa vào `source_failures` theo thứ tự group; group nguồn đó bị bỏ. Commands local vẫn được dựng kể cả domain source lỗi; nếu riêng BE-009 snapshot lỗi, static commands vẫn trả và failures có `commands/unavailable`.

## Event / Channel phát ra

Không có. Search là request/response; source domain tự sở hữu event invalidation của chúng. FE-009 debounce input, bỏ response cũ theo sequence cục bộ và query lại khi Palette mở/focus hoặc source event liên quan xảy ra, không dựa vào Search event/cache.

## Business rule và invariant

1. Phase 1 chỉ activate Projects, Sessions và Commands. Files chỉ xuất hiện ở giai đoạn 16, Notes ở giai đoạn 18 và Events ở giai đoạn 20; source chưa active không tạo group hoặc failure.
2. Search không giữ `Storage`, DB connection, repository, filesystem handle hoặc runtime lock của capability nguồn. Mọi dữ liệu đi qua consumer-side port và adapter public trong composition root.
3. Query rỗng chỉ trả Commands; query khác rỗng yêu cầu mọi token match. Không có query history/persistence/telemetry.
4. Group luôn theo thứ tự Projects → Sessions → Files → Notes → Events → Commands sau khi bỏ group rỗng. Result không được trộn xuyên group dù score khác nhau.
5. Mỗi group tối đa 8 result, mỗi future source tối đa 64 candidate, response tối đa 48 result khi đủ sáu source. `has_more` đúng nếu source báo còn candidate hoặc số match sau ranking vượt 8; `result_count` bằng tổng `results.len()` và fit `u32`.
6. Matching/ranking/highlight dùng cùng normalized token stream. Score không public; tie-break làm output deterministic cho cùng source snapshot.
7. Mọi `SearchResultDto.kind` phải khớp variant `target`, prefix của `key` và group chứa nó. `key` unique trong response; source trả duplicate identity làm cả source thất bại contract, không silently dedupe.
8. Project unavailable vẫn searchable; session runtime vẫn searchable nếu còn tồn tại. Session result không chứa tab layout, terminal output, process label hoặc file buffer.
9. File target chỉ chứa `project_id` và relative path đã được source owner validate; không trả absolute path. Selection vẫn gọi public open command để revalidate path/symlink/availability tại thời điểm mở.
10. Notes active và archived được tìm; Trash luôn bị loại. Snippet tối đa 160 scalar, collapse whitespace và không chứa raw Markdown HTML; selection gọi Notes query để xử lý note bị đổi/xóa sau search.
11. Event search trả một result trên base event, không một result cho mỗi recurrence occurrence. Selection mở detail và capability Calendar tính occurrence hiện hành.
12. Search action không tự thực thi. Project selection gọi flow open Project, Session selection điều hướng rồi gọi observation public, File/Note/Event selection gọi owner public command; Command selection đi qua action dispatcher FE hiện hành.
13. `supports_open_in_split` không cấp quyền bỏ qua giới hạn pane hoặc close impact. Owner command revalidate target và BE-005 vẫn áp dụng giới hạn bốn pane.
14. Action BE-009 có shortcut conflict vẫn chạy được từ Palette vì xung đột chỉ làm key matcher không dispatch. Shortcut trong result phải phản ánh current chord của cùng snapshot, không default cũ.
15. Source error/timeout không làm giả empty state. FE hiển thị failure message/retry cho source tương ứng và vẫn cho chọn kết quả từ source thành công.
16. Response đến sau query mới được FE bỏ qua; backend không mutate state nên response stale không được phép đổi domain. Không thêm cancellation dependency chỉ để tối ưu workload nhỏ Phase 1.
17. Không log query, project/session/note/event/file title, path, snippet, result hoặc target. Log chỉ duration, số result theo source, timeout/error category và phase source active.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
pub enum UnifiedSearchError {
    UnauthorizedWindow,
    InvalidQuery,
    InvalidContextProjectId,
    Unavailable,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Window khác `main` gọi command | Không retry; sửa caller boundary |
| `InvalidQuery` | Query quá 128 scalar hoặc chứa control character | Giữ Palette mở, giới hạn/chỉnh input |
| `InvalidContextProjectId` | Context ID không đúng UUID canonical của BE-003 | Bỏ context phía caller rồi retry |
| `Unavailable` | Search service/composition/ranking invariant bị hỏng hoặc task panic | Hiển thị lỗi Palette chung và cho retry/restart |

Lỗi domain source không dùng variant top-level; chúng được làm sạch thành `source_failures` để response partial. Empty result hợp lệ và không phải lỗi.

## Luồng chính

### Query Phase 1

1. FE-001 mở FE-009 từ search pill hoặc action `search.open_command_palette` hiện hành của BE-009, focus combobox và debounce input `120 ms`.
2. FE gọi `search_unified` với text cùng project context hiện tại. Command validate window/input trước khi gọi source.
3. Với query khác rỗng, service đồng thời lấy project list, session summaries và shortcut snapshot; static catalog được dựng đồng bộ. Không lock Search qua `.await`.
4. Adapter chỉ map public DTO sang document. Service nối project display name vào session context bằng `project_id`, match/rank từng group, cap 8, tạo highlight/target.
5. Response trả group thành công cùng failure typed. FE giữ active row đầu tiên, Arrow Up/Down di chuyển, Enter kích hoạt target; Escape đóng và trả focus về điểm mở.

### Kích hoạt kết quả

1. FE kiểm tra target union thay vì parse `key`, title hoặc context.
2. Project/Session mở đúng route/ID; session đã biến mất được owner command trả lỗi và FE re-query.
3. Command target chuyển `action_id` cùng optional `project_id` vào dispatcher. `sessions.create_current_project` tạo session qua BE-005 rồi mở tool picker, không spawn tool trực tiếp trong Search.
4. File Enter mở tab mới; Ctrl+Enter chỉ dùng khi `supports_open_in_split = true`. Note/Event mở màn hình/detail owner.

### Mở rộng source theo phase

1. Capability owner hoàn thành public query và luồng open target trước.
2. Lát cắt phase thêm adapter vào composition, activate source và mở rộng contract test/FE-009; không sửa ranking/group semantics của source cũ.
3. Search truyền query đã validate cùng candidate limit 64; owner áp domain filter/security rồi trả document tối thiểu.
4. Test regression xác nhận source mới failure/timeout không làm mất group cũ và source chưa active vẫn vắng hoàn toàn ở binary phase trước.

## Ràng buộc kỹ thuật

- Blocking: Search/ranking là CPU nhỏ. Public adapter nào dùng SQLite/filesystem phải tự thực hiện blocking work theo contract owner trước khi resolve future; Search không gọi `spawn_blocking` quanh future hoặc giữ lock qua `.await`.
- Bảo mật: Chỉ window `main` được query. Không nhận path/SQL/action payload tùy ý, không trả absolute file path, terminal output hoặc secret. Target phải được owner revalidate khi kích hoạt; không log query/kết quả.
- Hiệu năng: FE debounce 120 ms; source deadline 400 ms, total deadline 500 ms; max 64 candidate/source, 8 result/group, 48 result/response. Phase 1 p95 dưới `150 ms` trên máy Windows hỗ trợ khi source không contention.
- Concurrency: Mỗi request độc lập, immutable và không có cache/write lock. Source futures chạy song song; response có thể về khác thứ tự request và frontend sequence quyết định response mới nhất.
- Desktop boundary: Một custom Tauri command, không thêm capability permission/plugin. Generated binding là nguồn type frontend; `pnpm tauri build` bắt buộc sau khi nối FE-009 vì thay đổi invoke boundary.
- Khả năng truy cập: Backend trả group label, source failure và highlight range bằng text/typed state; FE không được dùng màu highlight làm tín hiệu duy nhất và phải công bố số result/loading/error qua live region phù hợp. Footer `Ctrl+Enter` tĩnh trong wireframe phải chuyển thành hướng dẫn theo row, chỉ hiện khi File đang chọn hỗ trợ split.

## Tiêu chí hoàn thành

- [ ] `search_unified` được đăng ký với managed service, chỉ nhận `main`, validate query/context và không tạo schema/migration/permission.
- [ ] Phase 1 chỉ dùng public query BE-003/005/009 qua adapter; test fail nếu Search nhận repository, Storage, session map/lock hoặc filesystem handle.
- [ ] Query rỗng chỉ trả Commands; query có token trả group/order/score/tie-break/highlight deterministic và cap đúng 8/64/48.
- [ ] Project search theo name/path, session theo name/project/status, command theo label/keyword/action ID; wireframe query `pty` có đúng hai command minh họa đã giải thích.
- [ ] Error/timeout một source tạo partial response/failure đúng thứ tự; source thành công và static commands vẫn usable.
- [ ] Target union mở đúng project/session/command mà không parse display text; shortcut conflict không chặn Palette execution.
- [ ] Phase 2/3/4 chỉ activate File/Note/Event sau public query và open flow owner; Trash/absolute path/recurrence expansion không lọt vào response.
- [ ] Unicode lowercase expansion, scalar highlight range, whitespace collapse/truncation và control-character validation có test biên.
- [ ] Binding aggregate được sinh từ Rust và contract test phát hiện drift; mọi function, method, callback, helper và test có comment ngắn theo quy tắc project.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features` trong `src-tauri/` cùng formatter/linter/typecheck/test frontend liên quan đều pass; `pnpm tauri build` pass sau khi FE-009 nối IPC.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/search/ranking.rs` (`#[cfg(test)]`) | Unit | Trim/token/all-token match; score/bonus/tie; Unicode lowercase expansion và scalar range; merge highlight; truncate; group/result caps |
| `src-tauri/src/search/service.rs` (`#[cfg(test)]`) | Unit | Static/action catalog merge; recursive action exclusion; context command; duplicate identity/ID; group order; empty query; phase activation; source error/timeout partial |
| `src-tauri/tests/unified_search_contract.rs` | Integration | Command window/input boundary; fake source concurrency/deadline; adapter DTO projection; response serialization; stale domain target; file/note/event extension fixtures |
| `src-tauri/tests/export_bindings.rs` | Contract | Sinh toàn bộ public DTO/error BE-010 và fail khi `src/bindings/search.ts` lệch Rust source |
| `src-tauri/tests/app_builder.rs` | Integration | Phase 1 builder inject đúng ba source, manage Search và đăng ký đúng một command, không có permission/plugin mới |

Fixture source dùng dữ liệu tạm/giả xác định được, không đọc project/app-data thật. Test deadline dùng paused/controlled Tokio time, không sleep wall-clock. Component regression cho File/Note/Event được bổ sung trong lát cắt phase tương ứng; macOS validation hoãn đến release preparation theo quy tắc repository.

## Câu hỏi mở

- Không có.
