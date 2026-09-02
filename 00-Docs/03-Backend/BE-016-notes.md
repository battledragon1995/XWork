# BE-016 — Notes

Tài liệu này đặc tả contract backend cho note Markdown bền vững: CRUD, autosave, ghim, liên kết project, Archive, Trash, tìm kiếm và public source/maintenance API cho các capability tổng hợp.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-016` |
| Phase | `3` |
| Capability | `src-tauri/src/notes/` |
| Yêu cầu chức năng | §6, §7.5, §12.1–12.2, §14, §17.6, §18, §20 Phase 3 |
| Frontend liên quan | `FE-003`, `FE-005`, `FE-009`, `FE-019`, `FE-020` |
| Phụ thuộc | `BE-002`, `BE-003`, `BE-010`, `BE-012`; `BE-014` chỉ là prerequisite của migration version 6, không phải dependency nghiệp vụ |

## Mục tiêu

Backend lưu note Markdown local trong SQLite, cung cấp query/mutation typed cho Notes, Home và Project Overview, đồng thời bảo vệ autosave khỏi ghi đè revision mới hơn. Notes công khai đúng các record/query cần thiết để Unified Search và Backup/Reset tích hợp qua adapter composition mà không truy cập repository nội bộ.

### Ngoài phạm vi

- Không lưu note thành file trong source project, không đọc/ghi file Markdown của BE-015 và không đồng bộ cloud.
- Không render hoặc thay đổi/sanitize nội dung Markdown đã lưu; backend lưu nguyên văn text. Riêng projection snippet tìm kiếm phải loại raw HTML để không đưa markup vào DTO; FE-019/020 vẫn chịu trách nhiệm render Markdown với raw HTML bị vô hiệu hóa theo tech stack.
- Không lưu Edit/Preview mode, caret, selection, scroll hoặc draft note chưa đủ điều kiện tạo; đây là state frontend tạm thời.
- Không thiết kế cửa sổ nổi, global shortcut hoặc tray Quick Note; lifecycle cửa sổ thuộc BE-017. BE-016 chỉ cho window `quick-note` gọi command tạo note ở lát cắt đó.
- Không có tag, folder note, attachment, version history, undo sau permanent delete, collaboration hoặc full-text engine/plugin mới.
- Không tìm note trong Trash từ Unified Search; Trash chỉ được query trong màn hình Trash rõ ràng.

### Quyết định và giả định đã chốt

- Tiêu đề nullable cho mọi note, không chỉ Quick Note. Frontend hiển thị literal English `Untitled note`; backend không persist label giả này.
- Tạo note yêu cầu `contentMarkdown.trim()` khác rỗng, đúng trạng thái invalid của Home Quick Note. Nút New Note của FE-019 tạo draft cục bộ; record chỉ được tạo ở autosave đầu tiên có body hợp lệ. Sau khi đã tạo, autosave được phép lưu body rỗng để người dùng có thể xóa nội dung mà không tạo record rác mới.
- Chọn optimistic revision bền vững thay vì timestamp làm precondition. Mọi mutation thực tăng `revision` đúng một; autosave cũ trả conflict cùng snapshot hiện tại và không ghi đè backup import hoặc mutation mới hơn.
- Archive và Trash là lifecycle state của cùng row. Note trong hai khu vực là read-only. Khi vào Trash, backend nhớ `trashedFrom`; Restore trả note về đúng Active hoặc Archived và giữ trạng thái pin trước đó.
- `Delete permanently` trên từng row là một hành động explicit với đúng nhãn phá hủy trong wireframe nên không mở dialog thứ hai; command vẫn yêu cầu revision hiện hành. `Empty Trash` là bulk destructive action, có prepare/confirm request, preview tên note và phát hiện Trash đổi trước confirm.
- Search dùng hai cột normalized dẫn xuất `search_title`/`search_content` và `instr` parameterized, không bật FTS5 hoặc thêm dependency. Cách này cho Unicode lowercase đồng nhất với BE-010, giữ migration đơn giản và đủ cho workload local; benchmark sẽ quyết định một migration/index chuyên biệt trong tương lai nếu cần.
- `updatedAtMs` chỉ thay đổi khi title hoặc content thực sự đổi; pin, project link và lifecycle có timestamp riêng hoặc revision nhưng không giả thành “edited”. Điều này giữ nhóm Recently edited đúng ý nghĩa wireframe.
- List dùng offset/limit thay vì cursor opaque. Mọi event mutation làm frontend reset offset về `0`; giới hạn trang nhỏ và single-user local giúp contract dễ triển khai, còn revision ngăn mất update.
- Project unavailable vẫn là link hợp lệ; chỉ project đã bị remove không còn link do nullable FK `ON DELETE SET NULL`. Notes không kiểm tra filesystem/project availability.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/src/lib.rs` | Export module `notes` và shared maintenance primitive |
| `src-tauri/src/notes/mod.rs` | Public entry re-export DTO, command, error, search và backup contract |
| `src-tauri/src/notes/models.rs` | Persisted model, DTO, input, event, backup/search record và validation constants |
| `src-tauri/src/notes/repository.rs` | SQL parameterized cho CRUD/list/search/lifecycle và transaction-scoped maintenance API |
| `src-tauri/src/notes/search.rs` | Unicode lowercase/token matching, snippet và scalar highlight ranges |
| `src-tauri/src/notes/service.rs` | Business rule, revision/clock, mutation serialization, Empty Trash request và public source API |
| `src-tauri/src/notes/commands.rs` | Tauri command mỏng, caller authorization và mapping error typed |
| `src-tauri/src/notes/error.rs` | `NotesError`, internal source chain và public redaction |
| `src-tauri/src/shared/mod.rs` | Export shared maintenance primitive đã có ít nhất BE-012 và Notes sử dụng |
| `src-tauri/src/shared/maintenance.rs` | App-wide `DataMaintenanceGate` và permit/lock order không phụ thuộc capability nghiệp vụ |
| `src-tauri/migrations/0007_create_notes.sql` | Tạo bảng/index Notes sau migration version 6 |
| `src-tauri/src/storage/migrations.rs` | Đăng ký version 7 `create_notes` bằng `include_str!` |
| `src-tauri/src/app/mod.rs` | Khởi tạo NotesService, inject gate/clock/event sink, manage state và đăng ký command |
| `src-tauri/src/app/search_sources.rs` | Adapter public Notes search record sang `NoteSearchSource` của BE-010 và activate source Phase 3 |
| `src-tauri/src/search/service.rs` | Activate Notes group ở Phase 3 mà không đổi ranking/group semantics BE-010 |
| `src-tauri/src/app/data_participants.rs` | Adapter clone Note backup record, remap link bằng public `ProjectImportMap::resolve`, rồi gọi Notes maintenance API |
| `src-tauri/src/settings/data.rs` | Bump backup envelope lên schema v2 bắt buộc có `notes` |
| `src-tauri/src/settings/data_participant.rs` | Thêm tagged Notes section/plan/projection vào orchestration BE-012 |
| `src-tauri/src/bin/export_bindings.rs` | Đăng ký DTO/event/error BE-016 với binding generator |
| `src/bindings/notes.ts` | Binding TypeScript aggregate được sinh từ Rust; không sửa thủ công |
| `src-tauri/tests/notes_contract.rs` | Integration test migration, command, persistence, concurrency và lifecycle |
| `src-tauri/tests/unified_search_contract.rs` | Mở rộng contract test BE-010 bằng Notes source thật/fake |
| `src-tauri/tests/data_management_contract.rs` | Golden backup v2, compatibility v1/v2, merge/reset Notes và rollback xuyên domain |
| `src-tauri/tests/export_bindings.rs` | Contract test binding trên đĩa khớp Rust source |
| `src-tauri/tests/app_builder.rs` | Smoke test composition register Notes, search source và data participant |

Không thêm crate tìm kiếm hoặc capability permission. `shared/maintenance.rs` là primitive thực sự dùng chung: app composition tạo đúng một gate và inject cùng instance vào BE-012 cùng mọi service persistence; file không chứa model hay rule Notes.

## Dữ liệu

### Bảng `notes`

| Cột | Kiểu | Ràng buộc | Ý nghĩa |
|---|---|---|---|
| `id` | `TEXT` | `PRIMARY KEY`, `NOT NULL`, length 36 | UUID v4 hyphenated lowercase do backend sinh |
| `title` | `TEXT` | nullable; khi có length 1–255 | Tiêu đề đã trim; chuỗi rỗng được lưu thành `NULL` |
| `content_markdown` | `TEXT` | `NOT NULL`, UTF-8 bytes ≤ 1,048,576 | Markdown gốc, giữ whitespace/newline người dùng |
| `search_title` | `TEXT` | `NOT NULL` | Title lowercase dẫn xuất, rỗng khi title null; không backup/public |
| `search_content` | `TEXT` | `NOT NULL` | Content lowercase dẫn xuất; không backup/public |
| `project_id` | `TEXT` | nullable FK `projects(id) ON DELETE SET NULL` | Project metadata liên kết, không yêu cầu folder available |
| `is_pinned` | `INTEGER` | `NOT NULL DEFAULT 0`, boolean check | Trạng thái pin được giữ khi archive/trash |
| `status` | `TEXT` | `NOT NULL`, enum check | `active`, `archived` hoặc `trash` |
| `trashed_from` | `TEXT` | nullable, enum check | Chỉ có khi Trash; `active` hoặc `archived` để restore |
| `created_at_ms` | `INTEGER` | `NOT NULL`, ≥ 0 | Unix epoch millisecond UTC lúc tạo |
| `updated_at_ms` | `INTEGER` | `NOT NULL`, ≥ created | Lần title/content đổi gần nhất |
| `archived_at_ms` | `INTEGER` | nullable, ≥ created | Lần vào Archive; giữ khi Archived chuyển qua Trash |
| `trashed_at_ms` | `INTEGER` | nullable, ≥ created | Lần vào Trash |
| `revision` | `INTEGER` | `NOT NULL DEFAULT 1`, 1…`i64::MAX` | Optimistic revision tăng trên mọi mutation thực |

- Index active: `idx_notes_active_order(status, is_pinned DESC, updated_at_ms DESC, id ASC)`.
- Index project: `idx_notes_project_order(project_id, status, is_pinned DESC, updated_at_ms DESC, id ASC)`.
- Index Archive: `idx_notes_archive_order(status, archived_at_ms DESC, id ASC)`.
- Index Trash: `idx_notes_trash_order(status, trashed_at_ms DESC, id ASC)`.
- Migration: `src-tauri/migrations/0007_create_notes.sql`.

Migration phải tương đương chính xác với:

```sql
CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 36),
    title TEXT CHECK(
        title IS NULL OR length(title) BETWEEN 1 AND 255
    ),
    content_markdown TEXT NOT NULL CHECK(
        length(CAST(content_markdown AS BLOB)) <= 1048576
    ),
    search_title TEXT NOT NULL,
    search_content TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    is_pinned INTEGER NOT NULL DEFAULT 0
        CHECK(is_pinned IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'archived', 'trash')),
    trashed_from TEXT CHECK(
        trashed_from IS NULL OR trashed_from IN ('active', 'archived')
    ),
    created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
    updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
    archived_at_ms INTEGER CHECK(
        archived_at_ms IS NULL OR archived_at_ms >= created_at_ms
    ),
    trashed_at_ms INTEGER CHECK(
        trashed_at_ms IS NULL OR trashed_at_ms >= created_at_ms
    ),
    revision INTEGER NOT NULL DEFAULT 1
        CHECK(revision BETWEEN 1 AND 9223372036854775807),
    CHECK(
        (
            status = 'active'
            AND archived_at_ms IS NULL
            AND trashed_at_ms IS NULL
            AND trashed_from IS NULL
        ) OR (
            status = 'archived'
            AND archived_at_ms IS NOT NULL
            AND trashed_at_ms IS NULL
            AND trashed_from IS NULL
        ) OR (
            status = 'trash'
            AND trashed_at_ms IS NOT NULL
            AND trashed_from = 'active'
            AND archived_at_ms IS NULL
        ) OR (
            status = 'trash'
            AND trashed_at_ms IS NOT NULL
            AND trashed_from = 'archived'
            AND archived_at_ms IS NOT NULL
        )
    )
) STRICT;

CREATE INDEX idx_notes_active_order
    ON notes(status, is_pinned DESC, updated_at_ms DESC, id ASC);

CREATE INDEX idx_notes_project_order
    ON notes(project_id, status, is_pinned DESC, updated_at_ms DESC, id ASC);

CREATE INDEX idx_notes_archive_order
    ON notes(status, archived_at_ms DESC, id ASC);

CREATE INDEX idx_notes_trash_order
    ON notes(status, trashed_at_ms DESC, id ASC);
```

Registry thêm đúng version `7`, name `create_notes`, SQL từ `include_str!("../../migrations/0007_create_notes.sql")`. Version 6 phải là `0006_create_recent_files.sql` của BE-014 theo trình tự roadmap; BE-016 không sửa migration 1–6.

`search_title`/`search_content` được tính bằng `char::to_lowercase` trên Unicode scalar, không collapse whitespace và không bỏ dấu. Query được lowercase/tách token tương tự; mọi token phải xuất hiện trong title hoặc content. Repository dựng số clause bằng số token đã cap, còn mọi token/value vẫn là bind parameter.

## DTO public

Mọi struct field serialize thành `camelCase`; enum serialize thành `snake_case`, enum có dữ liệu dùng discriminator `kind`. Revision là decimal string vì SQLite `i64` vượt safe integer JavaScript; timestamp millisecond hiện hành vẫn là `number`.

```rust
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum NoteStatusDto {
    Active,
    Archived,
    Trash,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum NotePreviousStatusDto {
    Active,
    Archived,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum NotePinnedFilterDto {
    Any,
    Only,
    Exclude,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum NoteProjectFilterDto {
    All,
    Unlinked,
    Project { project_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct ListNotesInputDto {
    pub status: NoteStatusDto,
    pub query: Option<String>,
    pub project_filter: NoteProjectFilterDto,
    pub pinned_filter: NotePinnedFilterDto,
    pub offset: u32,
    pub limit: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NoteTextRangeDto {
    pub start_scalar: u32,
    pub end_scalar: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NoteSummaryDto {
    pub id: String,
    pub title: Option<String>,
    pub snippet: String,
    pub project_id: Option<String>,
    pub is_pinned: bool,
    pub status: NoteStatusDto,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub archived_at_ms: Option<i64>,
    pub trashed_at_ms: Option<i64>,
    pub revision: String,
    pub title_highlights: Vec<NoteTextRangeDto>,
    pub snippet_highlights: Vec<NoteTextRangeDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NoteDto {
    pub id: String,
    pub title: Option<String>,
    pub content_markdown: String,
    pub project_id: Option<String>,
    pub is_pinned: bool,
    pub status: NoteStatusDto,
    pub trashed_from: Option<NotePreviousStatusDto>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub archived_at_ms: Option<i64>,
    pub trashed_at_ms: Option<i64>,
    pub revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NoteCountsDto {
    pub active: u32,
    pub archived: u32,
    pub trash: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NoteListPageDto {
    pub items: Vec<NoteSummaryDto>,
    pub offset: u32,
    pub total_matches: u32,
    pub has_more: bool,
    pub counts: NoteCountsDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct CreateNoteInputDto {
    pub title: Option<String>,
    pub content_markdown: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct AutosaveNoteInputDto {
    pub note_id: String,
    pub expected_revision: String,
    pub title: Option<String>,
    pub content_markdown: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SetNotePinnedInputDto {
    pub note_id: String,
    pub expected_revision: String,
    pub pinned: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct SetNoteProjectInputDto {
    pub note_id: String,
    pub expected_revision: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase")]
pub struct NoteRevisionInputDto {
    pub note_id: String,
    pub expected_revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DeletedNoteDto {
    pub note_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TrashNoteLabelDto {
    pub note_id: String,
    pub display_title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct EmptyNotesTrashImpactDto {
    pub request_id: u32,
    pub note_count: u32,
    pub notes: Vec<TrashNoteLabelDto>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct EmptyNotesTrashResultDto {
    pub deleted_count: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum NoteChangeKindDto {
    Created,
    Autosaved,
    PinnedChanged,
    ProjectChanged,
    Archived,
    Restored,
    Trashed,
    PermanentlyDeleted,
    TrashEmptied,
    BackupImported,
    Reset,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct NoteChangedEventDto {
    pub sequence: String,
    pub kind: NoteChangeKindDto,
    pub note_id: Option<String>,
    pub revision: Option<String>,
}
```

`trashedFrom` chỉ có giá trị `active` hoặc `archived` khi `status = trash`; không bao giờ là `trash`. `titleHighlights`/`snippetHighlights` là half-open Unicode scalar ranges, sort tăng, không overlap và rỗng khi query rỗng. FE dùng `Array.from(text)` để cắt đúng scalar như BE-010.

`counts` luôn là count toàn domain theo status, không bị project/query/pin filter làm thay đổi. `totalMatches` là count sau mọi filter của request. `hasMore = offset + items.len() < totalMatches`, tính bằng số học checked. `notes` trong Empty Trash preview tối đa 10 row mới bị trash gần nhất; `hasMore` cho biết còn tên không hiển thị.

## Public source và maintenance contract

Các type dưới đây là Rust public contract, không derive `TS` và không lộ qua IPC.

```rust
pub struct NoteSearchRecord {
    pub note_id: String,
    pub title: Option<String>,
    pub matching_snippet: Option<String>,
    pub project_id: Option<String>,
    pub updated_at_ms: i64,
}

pub struct NoteSearchCandidates {
    pub items: Vec<NoteSearchRecord>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteBackupRecordV1 {
    pub id: String,
    pub title: Option<String>,
    pub content_markdown: String,
    pub project_id: Option<String>,
    pub is_pinned: bool,
    pub status: NoteStatusDto,
    pub trashed_from: Option<NotePreviousStatusDto>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub archived_at_ms: Option<i64>,
    pub trashed_at_ms: Option<i64>,
}

pub struct NotesImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
}

pub struct NotesImportPlan {
    pub counts: NotesImportCounts,
}

pub enum NotesMaintenanceChange {
    BackupImported,
    Reset,
}

pub struct NotesCommittedProjection {
    pub change: NotesMaintenanceChange,
    pub affected_count: u32,
}

impl NotesService {
    /// Searches active and archived notes for the BE-010 adapter.
    pub async fn search_for_unified(
        &self,
        query: &str,
        candidate_limit: u32,
    ) -> Result<NoteSearchCandidates, NotesError>;

    /// Exports deterministic note records inside the BE-012 snapshot.
    pub fn export_notes_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<Vec<NoteBackupRecordV1>, NotesError>;

    /// Validates remapped backup records and prepares a merge projection.
    pub fn prepare_notes_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        records: &[NoteBackupRecordV1],
    ) -> Result<NotesImportPlan, NotesError>;

    /// Applies one prepared plan without opening a nested transaction.
    pub fn apply_notes_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &NotesImportPlan,
    ) -> Result<NotesCommittedProjection, NotesError>;

    /// Deletes every note as part of the shared reset transaction.
    pub fn reset_notes_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<NotesCommittedProjection, NotesError>;

    /// Publishes one post-commit invalidation for import or reset.
    pub fn publish_data_change(
        &self,
        projection: NotesCommittedProjection,
    );

}
```

`search_for_unified` chỉ nhận `candidateLimit` 1–64, tìm Active + Archived, loại Trash và trả `has_more` nếu còn candidate. Candidate source ưu tiên exact title → title prefix → mọi token trong title → updated desc → ID; BE-010 vẫn là owner của final score/highlight/group order. Adapter `app/search_sources.rs` join `project_id` với public project list để tạo `project_name`; Notes không import Projects repository hoặc persist project name.

Backup schema v2 của BE-012 luôn có array `notes`, kể cả rỗng. Export sort `id ASC`, không xuất `revision`, `search_title` hoặc `search_content`. Với mỗi source record, adapter `app/data_participants.rs` clone typed `NoteBackupRecordV1`, đặt `project_id = source.project_id.as_deref().and_then(|id| project_map.resolve(id)).map(str::to_owned)`, rồi truyền slice bản sao vào `prepare_notes_merge_in`; package parse gốc không bị mutate, dangling link trở thành `None`. Notes không nhận `ProjectImportMap`, không đọc mapping/path key; owner validate target ID canonical, còn referential existence do map đã validate và Projects được apply trước Notes trong cùng transaction bảo đảm. Với ID trùng, incoming record thắng nội dung/lifecycle/timestamp, revision local tăng một; record mới bắt đầu revision 1; local ID không có trong backup được giữ. Search fields luôn recompute từ incoming title/content.

Snippet chỉ liệt kê field public của `NotesImportPlan`; implementation giữ typed row operations và committed cache/internal-subscription projection ở field private. Plan/projection phải owned, `Send + 'static`, không giữ connection/transaction/row borrow/lock guard/secret/callback và không serialize. Mọi API `_in` chỉ dùng shared transaction do coordinator truyền, không lấy `DataReadPermit`, Notes mutation/pending mutex hoặc gọi Storage lồng; prepare validate/dựng operations-projection, apply chỉ chạy SQL và trả projection. Adapter chỉ đọc `counts`. Sau commit, `publish_data_change` consume projection, cập nhật cache/internal subscriber no-fail rồi best-effort phát `BackupImported` hoặc `Reset` với `noteId/revision = None`; không query lại DB, không trả `Result` và emit failure không thể đổi kết quả commit.

## Tauri command

Command chỉ parse/authorize DTO, clone service và chạy SQLite work trong blocking task. Mọi command ngoài `create_note` chỉ nhận caller `main`; `create_note` nhận `main` và, sau BE-017, đúng label `quick-note`. Mọi command persistent mutation lấy owned `DataReadPermit` sau authorization/validation cơ bản nhưng trước Notes mutation/pending mutex và Storage, giữ qua commit cùng cache/internal publish và Tauri event attempt. Permit là dependency Rust nội bộ, không xuất hiện trong command hoặc DTO. List/get/search, prepare/cancel Empty Trash chỉ đọc DB hoặc đổi pending state nên không lấy permit.

### `list_notes`

Trả một trang summary theo lifecycle, search, project và pin filter.

```rust
/// Lists one filtered page of note summaries.
#[tauri::command]
pub async fn list_notes(
    window: tauri::WebviewWindow,
    input: ListNotesInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteListPageDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; query trim ≤128 scalar, không control, tối đa 8 token; project filter ID nếu có phải canonical; limit 1–100; offset dùng toàn miền `u32`; Archive/Trash bắt buộc `pinnedFilter = any` |
| Side effect | Không có; query rows/count trong một storage callback và dựng snippet/highlight trong blocking worker |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidSearch`, `InvalidProjectId`, `InvalidPagination`, `InvalidFilter`, `PersistenceFailed` |

Active sort `is_pinned DESC, updated_at_ms DESC, id ASC`; Archive sort `archived_at_ms DESC, id ASC`; Trash sort `trashed_at_ms DESC, id ASC`. Search vẫn giữ sort của scope sau khi lọc. Query `None`, rỗng hoặc whitespace là không search. `pinnedFilter=only/exclude` cho Home pinned/recent; Project Overview dùng `project` + `any`; FE-019 All dùng Active + Any.

### `get_note`

Đọc đầy đủ một note ở bất kỳ lifecycle state.

```rust
/// Gets one complete note by identity.
#[tauri::command]
pub async fn get_note(
    window: tauri::WebviewWindow,
    note_id: String,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID UUID canonical |
| Side effect | Không có; không đổi recent/updated timestamp |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `NoteNotFound`, `PersistenceFailed` |

### `create_note`

Tạo note Active từ Notes/Home/Quick Note.

```rust
/// Creates one active note with meaningful Markdown content.
#[tauri::command]
pub async fn create_note(
    window: tauri::WebviewWindow,
    input: CreateNoteInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main` hoặc `quick-note`; title normalize hợp lệ; content ≤1 MiB và sau trim khác rỗng; project ID nếu có canonical và tồn tại |
| Side effect | Lấy `DataReadPermit`; sinh UUID/timestamp; insert Active revision 1; sau commit publish cache/internal state, phát event canonical `notes://changed` với `NoteChangedEventDto`: `kind = NoteChangeKindDto::Created`, `note_id = Some(id)`, `revision = Some("1")` và sequence mới, rồi nhả permit |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidTitle`, `EmptyInitialContent`, `ContentTooLarge`, `InvalidProjectId`, `ProjectNotFound`, `ClockFailed`, `PersistenceFailed` |

BE-017 đóng floating window chỉ sau response thành công; BE-016 không thao tác window. Home reset form/toast và đưa note vào Recent từ result/event.

### `autosave_note`

Lưu title/content đầy đủ với optimistic revision.

```rust
/// Autosaves editable note text when the expected revision is current.
#[tauri::command]
pub async fn autosave_note(
    window: tauri::WebviewWindow,
    input: AutosaveNoteInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; note/revision canonical; title hợp lệ; content ≤1 MiB, được phép rỗng; note Active |
| Side effect | Nếu title/content đổi: update derived search fields, monotonic `updated_at_ms`, revision +1 trong transaction và phát `Autosaved`; no-op chỉ trả snapshot |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `InvalidTitle`, `ContentTooLarge`, `NoteNotFound`, `NoteNotEditable`, `RevisionConflict`, `RevisionExhausted`, `ClockFailed`, `PersistenceFailed` |

FE-019 debounce 500 ms sau lần gõ cuối, chỉ giữ một request in-flight và coalesce draft mới nhất. `Saved just now` chỉ hiện sau response thành công. Conflict giữ draft local, hiển thị lựa chọn reload snapshot hoặc retry có chủ ý với revision mới; không tự retry ghi đè.

### `set_note_pinned`

Ghim/bỏ ghim một note Active.

```rust
/// Changes the pinned state of one active note.
#[tauri::command]
pub async fn set_note_pinned(
    window: tauri::WebviewWindow,
    input: SetNotePinnedInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/revision hợp lệ; note Active |
| Side effect | No-op nếu không đổi; nếu đổi tăng revision, giữ `updated_at_ms`, commit rồi phát `PinnedChanged` |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `NoteNotFound`, `NoteNotEditable`, `RevisionConflict`, `RevisionExhausted`, `PersistenceFailed` |

### `set_note_project`

Thêm, đổi hoặc bỏ project liên kết của note Active.

```rust
/// Changes the optional project link of one active note.
#[tauri::command]
pub async fn set_note_project(
    window: tauri::WebviewWindow,
    input: SetNoteProjectInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; note/revision hợp lệ; project nếu có canonical và tồn tại; note Active |
| Side effect | No-op nếu không đổi; nếu đổi tăng revision, giữ `updated_at_ms`, commit rồi phát `ProjectChanged` |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `InvalidProjectId`, `ProjectNotFound`, `NoteNotFound`, `NoteNotEditable`, `RevisionConflict`, `RevisionExhausted`, `PersistenceFailed` |

Project unavailable vẫn được chấp nhận. Create/set link không query Projects repository: FK là authority tồn tại và violation của đúng field này map thành `ProjectNotFound`. List với project ID canonical đã bị remove trả trang rỗng; race project remove tạo `ProjectNotFound` hoặc kết quả link `None`, không tạo dangling ID.

### `archive_note`

Chuyển Active sang Archive.

```rust
/// Archives one active note.
#[tauri::command]
pub async fn archive_note(
    window: tauri::WebviewWindow,
    input: NoteRevisionInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/revision hợp lệ; status Active |
| Side effect | Set Archived/`archived_at_ms`, tăng revision, giữ pin/updated timestamp, commit rồi phát `Archived` |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `NoteNotFound`, `InvalidTransition`, `RevisionConflict`, `RevisionExhausted`, `ClockFailed`, `PersistenceFailed` |

### `restore_archived_note`

Đưa Archived về Active.

```rust
/// Restores one archived note to the active list.
#[tauri::command]
pub async fn restore_archived_note(
    window: tauri::WebviewWindow,
    input: NoteRevisionInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/revision hợp lệ; status Archived |
| Side effect | Set Active, clear archive timestamp, tăng revision, giữ pin/updated timestamp, commit rồi phát `Restored` |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `NoteNotFound`, `InvalidTransition`, `RevisionConflict`, `RevisionExhausted`, `PersistenceFailed` |

### `move_note_to_trash`

Đưa Active hoặc Archived vào Trash và nhớ nguồn.

```rust
/// Moves one active or archived note to Trash.
#[tauri::command]
pub async fn move_note_to_trash(
    window: tauri::WebviewWindow,
    input: NoteRevisionInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/revision hợp lệ; status Active hoặc Archived |
| Side effect | Set Trash/`trashed_from`/`trashed_at_ms`, tăng revision, giữ pin/updated/archive timestamp phù hợp, commit rồi phát `Trashed` |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `NoteNotFound`, `InvalidTransition`, `RevisionConflict`, `RevisionExhausted`, `ClockFailed`, `PersistenceFailed` |

### `restore_note_from_trash`

Khôi phục Trash về lifecycle trước đó.

```rust
/// Restores one trashed note to its previous lifecycle state.
#[tauri::command]
pub async fn restore_note_from_trash(
    window: tauri::WebviewWindow,
    input: NoteRevisionInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<NoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/revision hợp lệ; status Trash; `trashed_from` hợp lệ |
| Side effect | Restore Active/Archived, clear trash fields, tăng revision, giữ pin/updated/archive timestamp, commit rồi phát `Restored` |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `NoteNotFound`, `InvalidTransition`, `RevisionConflict`, `RevisionExhausted`, `PersistenceFailed` |

### `delete_note_permanently`

Xóa một row đang ở Trash bằng hành động có nhãn explicit.

```rust
/// Permanently deletes one currently trashed note.
#[tauri::command]
pub async fn delete_note_permanently(
    window: tauri::WebviewWindow,
    input: NoteRevisionInputDto,
    state: tauri::State<'_, NotesService>,
) -> Result<DeletedNoteDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; ID/revision hợp lệ; status Trash |
| Side effect | Delete đúng row/revision trong transaction; commit rồi phát `PermanentlyDeleted`; không undo |
| Lỗi trả về | `UnauthorizedWindow`, `InvalidNoteId`, `InvalidRevision`, `NoteNotFound`, `InvalidTransition`, `RevisionConflict`, `PersistenceFailed` |

### `prepare_empty_notes_trash`

Tạo preview cho bulk permanent delete.

```rust
/// Creates a confirmation request for emptying Notes Trash.
#[tauri::command]
pub async fn prepare_empty_notes_trash(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NotesService>,
) -> Result<EmptyNotesTrashImpactDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main` |
| Side effect | Đọc Trash, tạo fingerprint ID+revision và pending request TTL 5 phút; không xóa dữ liệu |
| Lỗi trả về | `UnauthorizedWindow`, `TrashEmpty`, `PersistenceFailed` |

Prepare mới thay pending request cũ. ID là counter u32 bỏ `0`; preview label dùng title hoặc `Untitled note`, không đưa content/snippet vào dialog.

### `confirm_empty_notes_trash`

Xóa toàn bộ Trash nếu preview vẫn hiện hành.

```rust
/// Permanently deletes all notes from an unchanged Trash preview.
#[tauri::command]
pub async fn confirm_empty_notes_trash(
    window: tauri::WebviewWindow,
    request_id: u32,
    state: tauri::State<'_, NotesService>,
) -> Result<EmptyNotesTrashResultDto, NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; request khác 0, đúng ID, chưa hết TTL; fingerprint Trash khớp trong transaction |
| Side effect | Delete mọi row Trash atomically; clear pending; commit rồi phát một `TrashEmptied` |
| Lỗi trả về | `UnauthorizedWindow`, `NoPendingTrashOperation`, `StaleTrashRequest`, `TrashChanged`, `PersistenceFailed` |

Nếu Trash đổi, command không xóa, thay pending request bằng impact mới và trả `TrashChanged { impact }` để FE hiển thị lại dialog. Double-confirm không xóa lần hai.

### `cancel_empty_notes_trash`

Hủy pending request mà không đổi note.

```rust
/// Cancels the current Empty Trash confirmation request.
#[tauri::command]
pub async fn cancel_empty_notes_trash(
    window: tauri::WebviewWindow,
    request_id: u32,
    state: tauri::State<'_, NotesService>,
) -> Result<(), NotesError>
```

| Nội dung | Giá trị |
|---|---|
| Validation | Caller `main`; đúng pending ID, chưa bắt đầu confirm |
| Side effect | Clear pending request; không chạm database |
| Lỗi trả về | `UnauthorizedWindow`, `NoPendingTrashOperation`, `StaleTrashRequest` |

## Event / Channel phát ra

| Tên | Payload | Khi phát | Đảm bảo |
|---|---|---|---|
| `notes://changed` | `NoteChangedEventDto` | Sau mỗi mutation thực đã commit; một lần aggregate sau backup import/reset | Chỉ emit tới `main`; sequence tăng trong process; note mutation có ID/revision, bulk/import/reset để `None`; không phát cho read/no-op/rollback |

Event chỉ là invalidation. FE reset pagination/re-query summary/detail liên quan; không áp payload như row đầy đủ. Emit lỗi sau commit được log an toàn nhưng không rollback hoặc đổi command thành failure. Không có channel riêng theo change kind; mọi kind dùng duy nhất `notes://changed`.

Khi nhận event canonical `projects://changed` với `ProjectChangedEventDto.change = ProjectChangeKindDto::Removed`, FE-019/003/005 phải re-query mọi list/detail Notes đang hiển thị hoặc phụ thuộc `projectId` của payload. Transaction BE-003 đã áp FK `ON DELETE SET NULL`, nên snapshot mới trả `projectId = None` và note vẫn tồn tại; BE-016 không phát thêm `notes://changed`, không tăng note revision/`updatedAtMs` và consumer không được patch cache chỉ từ project event.

`sequence` là `u64` trong process serialize thành decimal string, bắt đầu `0` khi service khởi tạo và tăng trước mỗi event Notes thực; không persist qua restart. Consumer chỉ dùng nó để bỏ event cũ trong cùng process, không suy ra revision của một note.

## Business rule và invariant

1. ID note là UUID v4 lowercase hyphenated do backend sinh; frontend/backup không tạo ID cho CRUD thường.
2. Title được trim; empty thành `None`; tối đa 255 Unicode scalar, không control character. Content giữ nguyên, tối đa 1 MiB UTF-8 bytes. Timestamp input từ backup nằm trong `0..=8_640_000_000_000_000` để serialize thành JavaScript Date an toàn.
3. `create_note` yêu cầu content trim khác rỗng. Note đã tồn tại được autosave content rỗng; record mới draft-only không nằm trong SQLite/search/backup.
4. Chỉ Active được autosave/pin/link project/archive. Archived/Trash read-only; Preview mode không đổi quyền này.
5. Mọi mutation nhận expected revision, so sánh và update trong cùng transaction. Revision mismatch không ghi; no-op không tăng revision/timestamp/event.
6. Revision tăng đúng một trên autosave, pin, link, archive, restore, trash và backup merge update; overflow bị từ chối trước write.
7. `updated_at_ms` monotonic chỉ khi title/content đổi: `max(now, previous + 1)`. Pin/link/lifecycle giữ timestamp này để Recently edited không bị nhiễu.
8. Active order pinned trước rồi updated desc/ID; Home dùng Only cap 2 và Exclude cap 3; Project Overview dùng project filter; không có endpoint aggregate Home/Project riêng.
9. Archive/Trash order theo timestamp vào state desc/ID. Pin được giữ nhưng không ảnh hưởng order/read-only view ngoài Active.
10. Archive chỉ từ Active; restore archived chỉ về Active. Trash nhận Active/Archived; restore Trash về `trashed_from`; permanent delete chỉ từ Trash.
11. Note trong Trash tồn tại vô hạn. Không timer/purge startup/background; chỉ explicit Delete permanently, confirmed Empty Trash hoặc Reset XWork xóa.
12. Empty Trash preview tối đa 10 tên, fingerprint toàn bộ ID+revision; Trash đổi yêu cầu confirm lại. Cancel/stale/expired/double confirm không xóa.
13. Project link chỉ cần project row tồn tại, không cần folder available. Project remove tự set `NULL`; source project không bao giờ bị Notes chạm.
14. Search query max 128 scalar/8 token, lowercase như BE-010, mọi token match title/content. Không query history, FTS ranking hoặc telemetry.
15. Summary snippet bỏ raw HTML tag/block bằng scanner Markdown an toàn, collapse Unicode whitespace, cap 160 scalar và đặt ellipsis quanh vùng match; highlight dùng plain display text/scalar offsets. Frontend luôn render snippet như text, không inner HTML.
16. Unified Search nhận tối đa 64 Active/Archived candidate và loại Trash. Note archived selection mở Archive read-only; stale/deleted target được `get_note` revalidate.
17. Notes không import Search/Projects/Settings repository hoặc state nội bộ. Composition adapter map public record/DTO, join project name và dùng duy nhất public `ProjectImportMap::resolve` khi remap backup link.
18. Backup v2 xuất mọi lifecycle state, deterministic ID order và không xuất derived search/revision. Import same ID incoming wins; local absent được giữ. App adapter clone record và remap source project link thành owned target ID trước owner prepare; owner không nhận map abstraction hoặc Projects internal type.
19. Mọi persistent CRUD/bulk delete lấy `DataReadPermit` trước Notes mutation/pending mutex và giữ qua Storage commit cùng cache/internal/event publish. Lock order luôn `DataMaintenanceGate` → Notes mutation/pending → Storage; owner `_in` API chạy dưới write permit của BE-012 nên không re-enter permit, mutex hoặc Storage. Owned read permit có thể sống qua await của blocking task, nhưng không lock guard/connection/transaction/borrow nào được giữ qua await.
20. Project FK unlink có thể xảy ra trong shared transaction BE-003 đã giữ permit/owner lock theo contract Projects, không re-enter Notes gate/mutex và không tăng Notes revision. Expected revision vẫn bảo vệ note fields; response tiếp theo luôn đọc project ID thực tế.
21. Mọi SQL dùng bind parameter. Dynamic search chỉ sinh clause cố định theo token count đã cap, không nội suy query text.
22. Không log title, content, snippet, search query, project ID/name hoặc backup record. Log chỉ operation, status/count/duration và error category.

## Lỗi

```rust
#[derive(Clone, Debug, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
pub enum NotesError {
    UnauthorizedWindow,
    InvalidNoteId,
    InvalidRevision,
    InvalidTitle,
    EmptyInitialContent,
    ContentTooLarge,
    InvalidSearch,
    InvalidPagination,
    InvalidFilter,
    InvalidProjectId,
    ProjectNotFound,
    NoteNotFound,
    NoteNotEditable { status: NoteStatusDto },
    InvalidTransition { status: NoteStatusDto },
    RevisionConflict { current: NoteDto },
    RevisionExhausted,
    TrashEmpty,
    NoPendingTrashOperation,
    StaleTrashRequest,
    TrashChanged { impact: EmptyNotesTrashImpactDto },
    ClockFailed,
    PersistenceFailed,
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `UnauthorizedWindow` | Caller không được phép; `quick-note` gọi command ngoài create | Không retry; sửa boundary/capability |
| `InvalidNoteId` | Note ID không phải UUID canonical | Bỏ stale target và re-query |
| `InvalidRevision` | Revision không phải decimal canonical 1…i64 max | Re-fetch note; không retry input cũ |
| `InvalidTitle` | Title quá 255 scalar hoặc có control character | Giữ draft và báo field title |
| `EmptyInitialContent` | Create có body chỉ whitespace | Đánh dấu composer body như Home invalid wireframe |
| `ContentTooLarge` | UTF-8 content vượt 1 MiB | Giữ draft, báo giới hạn và không autosave |
| `InvalidSearch` | Query quá dài, control hoặc >8 token | Giữ list cũ và sửa query |
| `InvalidPagination` | Limit/offset ngoài boundary | Reset trang về input hợp lệ |
| `InvalidFilter` | Pin filter dùng ngoài Active hoặc enum combination không hợp lệ | Reset filter theo scope |
| `InvalidProjectId` | Project filter/link ID không canonical | Refresh project source |
| `ProjectNotFound` | Project link của create/set không còn tồn tại theo FK | Clear link và re-query project source |
| `NoteNotFound` | Note không còn tồn tại | Đóng editor/row và re-query |
| `NoteNotEditable` | Autosave/pin/link trên Archived/Trash | Mở read-only banner/action Restore |
| `InvalidTransition` | Lifecycle command không hợp lệ với status hiện tại | Re-query detail và hiển thị action đúng |
| `RevisionConflict` | Record đã đổi sau expected revision | Giữ draft; cho Reload hoặc Keep draft/retry có chủ ý |
| `RevisionExhausted` | Revision đã ở i64 max | Chặn write và yêu cầu export/restart/support |
| `TrashEmpty` | Prepare khi không có note Trash | Refresh empty state, không mở dialog |
| `NoPendingTrashOperation` | Confirm/cancel không có request | Đóng dialog và prepare lại nếu cần |
| `StaleTrashRequest` | ID sai/hết TTL/đã confirm-cancel | Đóng dialog và prepare lại |
| `TrashChanged` | Fingerprint khác preview | Thay dialog bằng impact mới, yêu cầu confirm lại |
| `ClockFailed` | Không lấy được Unix time hợp lệ | Giữ state, cho retry |
| `PersistenceFailed` | Query/transaction/constraint/commit lỗi | Không optimistic commit; báo tải/lưu thất bại |

Public error không chứa raw SQLite, content/title/query hoặc project details. `RevisionConflict.current` chỉ trả cho caller `main` đã được authorize và là dữ liệu note người dùng đang mở.

## Luồng chính

### Tạo và autosave

1. FE-019 tạo draft cục bộ khi bấm New Note; FE-020 Home/Quick Note đã có composer local. Title có thể nhập trước nhưng chưa persist khi body chưa meaningful.
2. Khi Save Quick Note hoặc autosave đầu tiên có body hợp lệ, `create_note` validate project/title/content, lấy `DataReadPermit`, rồi Notes mutation mutex và insert revision 1 trong transaction.
3. Commit xong service cập nhật cache/internal state, tăng event sequence, emit `notes://changed` với `kind = NoteChangeKindDto::Created`, `noteId`/`revision` của row mới rồi nhả permit và trả NoteDto. Home clear form/toast; floating window BE-017 đóng; Notes chọn record mới.
4. Với record hiện hữu, FE debounce/serialize `autosave_note`. Service lock, đọc row, kiểm Active/revision, normalize title và compare fields trong cùng transaction.
5. No-op trả row hiện tại. Mutation update content/search/timestamp/revision atomically, commit rồi emit; response mới nhất mới được FE dùng cho Saved state.

### List, search và màn hình tổng hợp

1. FE-019 gọi list Active offset 0; backend query count/global counts và summary theo order. Click row gọi get full content.
2. Query/project/pin/scope đổi làm FE reset offset. Search SQL lọc all-token trên derived fields; Rust dựng snippet/highlight chỉ cho page trả về.
3. Home gọi hai list query Active (`only`, `exclude`) với cap nhỏ. Project Overview dùng `Project { id }`; không capability nào nhận Notes repository.
4. Unified Search adapter gọi `search_for_unified(query, 64)`, join project name qua public Projects query và map sang `NoteSearchDocument`; BE-010 rank/highlight/cap 8.
5. `notes://changed`, `projects://changed` hoặc `data://changed` làm consumer liên quan re-query từ offset 0; event không được patch thẳng vào cache list.

### Archive và Trash

1. More menu gọi archive/trash với revision row đang mở. Service revalidate status/revision dưới mutation gate rồi ghi state/timestamp/revision atomically.
2. Archive/Trash detail vẫn đọc bằng get nhưng FE khóa editor. Restore gọi command tương ứng; Trash restore dựa `trashed_from` persisted.
3. Delete permanently xóa đúng Trash row/revision. Empty Trash prepare chụp fingerprint/tên, dialog nêu không undo; confirm recheck trong transaction trước delete.
4. Commit xong mới emit. Lỗi/rollback giữ row/state/pending phù hợp; permanent delete thành công không có undo/history.

### Backup, restore và reset

1. BE-012 export giữ `DataWritePermit` và shared transaction, gọi `export_notes_in`; Notes trả record ID-sorted không derived/revision mà không re-enter gate/mutex/Storage.
2. Import parser v2 strict; app adapter clone từng typed record, gọi `ProjectImportMap::resolve` cho optional source project ID và gọi `prepare_notes_merge_in` với bản sao đã remap. Owner validate toàn bộ lifecycle/timestamp/content/target project ID và dựng search/revision projection trước apply.
3. BE-012 apply plan trong transaction xuyên domain; rollback chỉ drop projection và không đổi cache/subscriber/event. Commit xong Notes consume projection, cập nhật cache/internal subscriber no-fail rồi best-effort publish một BackupImported invalidation.
4. Reset gọi `reset_notes_in` trong shared reset transaction; commit xong consume projection/publish một Reset theo cùng contract. Empty Trash pending bị clear trong publish no-fail.

## Ràng buộc kỹ thuật

- Blocking: Mọi rusqlite/list/search/snippet/backup operation chạy trong `tauri::async_runtime::spawn_blocking`. Command persistent mutation có thể giữ owned `DataReadPermit` qua await join handle, nhưng không giữ `State`, mutation mutex, connection/transaction hoặc borrowed row qua `.await`.
- Bảo mật: Chỉ `main`, ngoại lệ create từ exact `quick-note`; không filesystem/network; SQL bound; no raw HTML; content/query/title không log; IPC cap 1 MiB/128 scalar/100 rows.
- Hiệu năng: List max 100 summary, unified search max 64 candidate, snippet 160 scalar. Benchmark Windows với 10.000 note trung bình 4 KiB: list không search p95 <50 ms, search p95 <200 ms; nếu không đạt phải profile trước khi thêm FTS migration.
- Concurrency: Một Notes mutation mutex serialize revision check/write/event sequence. Persistent path tuân theo `DataMaintenanceGate` read permit → Notes mutation/pending mutex → Storage → cache/internal/event publish; maintenance `_in` path dùng transaction của coordinator và không lấy lại permit/mutex/Storage. Reads chỉ serialize qua Storage. FE autosave một in-flight để tránh conflict tự tạo.
- Persistence: Mọi mutation nhiều câu lệnh qua `Storage::with_transaction(Immediate)`; read qua `with_connection`; owner `_in` methods không mở nested storage call.
- Desktop boundary: Custom Tauri commands/event/binding và migration mới, không plugin/permission mới. `pnpm tauri build` bắt buộc sau khi nối FE vì boundary/schema thay đổi.

## Tiêu chí hoàn thành

- [ ] Migration `0007_create_notes.sql` registry đúng sau version 6, tạo STRICT table/FK/check/index chính xác và rollback nguyên version khi lỗi.
- [ ] Create UUID/timestamp/title/content/project validation đúng; Home title-only/blank-body bị từ chối, draft New Note chưa meaningful không tạo row.
- [ ] Autosave debounce consumer + backend expected revision không mất update; no-op không bump; content rỗng sau create hợp lệ; search fields/timestamp cập nhật đúng.
- [ ] Active pinned/recent, project filter, Archive và Trash order/count/page/snippet/highlight deterministic; empty/loading/error do FE có dữ liệu typed để hiển thị.
- [ ] Pin/link/archive/restore/trash transition và timestamp/revision đúng; Archived/Trash không editable; Trash restore về đúng previous status.
- [ ] Individual permanent delete chỉ nhận Trash; Empty Trash preview tên/cap/fingerprint/TTL/cancel/stale/double-confirm và no-undo đúng wireframe.
- [ ] Project unavailable vẫn link; project remove `ON DELETE SET NULL`, source folder không đổi; event canonical `projects://changed` với `change = ProjectChangeKindDto::Removed` làm frontend aggregate re-query và không tạo event Notes giả.
- [ ] Unified Search dùng public source, gồm Active/Archived, loại Trash, cap 64 và không lộ repository; BE-010 ranking/group cũ không đổi.
- [ ] Backup schema v2 luôn có typed Notes array; v1 import giữ notes; v2 adapter clone/remap bằng `ProjectImportMap::resolve` trước owner, merge/recompute/revision đúng; reset/import rollback/event xuyên domain đúng BE-012.
- [ ] Persistent mutation giữ `DataReadPermit` qua commit/publish; write permit BE-012 chặn mutation, còn owner `_in` merge/reset dùng shared transaction, rollback không publish và commit cập nhật cache/internal subscriber no-fail trước event best-effort.
- [ ] Chỉ event canonical `notes://changed` được phát sau commit mutation thực, đúng `NoteChangeKindDto`/ID/revision/sequence; không có channel suffix theo kind, payload bulk an toàn và emit failure không đổi command result.
- [ ] Generated binding sinh từ Rust và contract test phát hiện drift; mọi function/method/callback/helper/test có comment ngắn, logic lifecycle/revision có inline comment invariant.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features`, frontend formatter/linter/typecheck/test và `pnpm tauri build` pass.
- [ ] Unit/component test pass cho FE-019/020 và regression Home/Project Overview/Command Palette/Settings Data; macOS hoãn đến release preparation.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/notes/models.rs` (`#[cfg(test)]`) | Unit | UUID/revision/title/content/status/timestamp validation; DTO/error/event/backup serialization |
| `src-tauri/src/notes/search.rs` (`#[cfg(test)]`) | Unit | Unicode lowercase, token cap/all-token match, scalar range, whitespace snippet, ellipsis và deterministic candidate tier |
| `src-tauri/src/notes/repository.rs` (`#[cfg(test)]`) | Unit | CRUD/filter/order/count/FK, status checks, search bind clauses, optimistic update/delete và transaction rollback |
| `src-tauri/src/notes/service.rs` (`#[cfg(test)]`) | Unit | Clock/revision/no-op, transition matrix, mutation lock/event timing, Empty Trash request/fingerprint/TTL, import projection |
| `src-tauri/tests/notes_contract.rs` | Integration | Migration/reopen, command caller/input, create/autosave/conflict, lifecycle/project unlink qua canonical `projects://changed`, search/page và duy nhất canonical `notes://changed` qua public boundary |
| `src-tauri/tests/unified_search_contract.rs` | Integration | Note adapter/project-name join, Active/Archive/Trash filter, cap/has-more/source failure và target stale |
| `src-tauri/tests/data_management_contract.rs` | Integration | Golden v2 strict/round-trip, v1 compatibility, write permit chặn mutation, source/local/dangling project resolve, parsed record bất biến, owner chỉ nhận bản sao đã remap, typed `_in` same-ID merge/reset trong shared transaction, rollback không publish và commit publish no-fail |
| `src-tauri/tests/export_bindings.rs` | Contract | Sinh DTO/event/error BE-016 và fail khi `src/bindings/notes.ts` lệch Rust source |
| `src-tauri/tests/app_builder.rs` | Integration | Builder inject cùng maintenance gate, manage Notes và register command/search/data adapters đúng một lần |

Database/project/clock/event fixtures dùng temp/fake, không chạm app data hoặc source project thật. Search benchmark tách khỏi correctness test và dùng dữ liệu deterministic; không sleep wall-clock cho debounce/TTL. Backup golden JSON và test component chỉ dùng nội dung Markdown vô hại; database test luôn được cleanup.

## Câu hỏi mở

- Không có.
