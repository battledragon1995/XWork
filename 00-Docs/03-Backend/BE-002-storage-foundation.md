# BE-002 — Storage foundation

Tài liệu này đặc tả nền lưu trữ SQLite dùng chung của backend: vị trí database, vòng đời kết nối, transaction và cách chạy migration tuần tự. Đây là contract nội bộ của Rust; BE-002 không mở IPC trực tiếp cho frontend.

## Thông tin chung

| Nội dung | Giá trị |
|---|---|
| Mã | `BE-002` |
| Phase | `1` |
| Capability | `src-tauri/src/storage/` |
| Yêu cầu chức năng | `§2` |
| Frontend liên quan | `Không có`; đây là nền persistence cho các capability backend. Không có wireframe áp dụng. |
| Phụ thuộc | `Không có` |

## Mục tiêu

Backend mở đúng một database SQLite trong app data của XWork, cấu hình kết nối nhất quán và chạy toàn bộ migration còn thiếu theo thứ tự trước khi capability khác sử dụng dữ liệu. Các capability có một API nội bộ duy nhất để thực hiện thao tác đọc hoặc transaction ghi mà không tự quản lý connection.

### Ngoài phạm vi

- Bảng, query, repository và business rule của project, settings, CLI profile, note, event, notification hoặc capability khác.
- Backup, restore và reset dữ liệu thuộc `BE-012`.
- Mã hóa toàn bộ database; secret của CLI profile phải nằm trong OS credential store, không nằm trong SQLite.
- Connection pool, truy cập database từ frontend hoặc Tauri SQL/Store plugin.

## File liên quan

| Đường dẫn | Vai trò trong chức năng |
|---|---|
| `src-tauri/Cargo.toml` | Khai báo `rusqlite` với feature `bundled` và dependency test tạo thư mục tạm. |
| `src-tauri/Cargo.lock` | Khóa dependency Rust sau khi thêm `rusqlite`. |
| `src-tauri/src/lib.rs` | Công khai module `storage` cho các capability backend và composition root sử dụng. |
| `src-tauri/src/storage/mod.rs` | Định nghĩa `Storage`, API đọc/transaction, mở và cấu hình connection, lỗi storage. |
| `src-tauri/src/storage/migrations.rs` | Định nghĩa migration, registry nhúng SQL, kiểm tra registry và runner tuần tự dựa trên `PRAGMA user_version`. |
| `src-tauri/src/app/mod.rs` | Mở database trong Tauri setup, chạy migration và đăng ký `Storage` làm managed state trước khi ứng dụng phục vụ request. |
| `src-tauri/tests/app_builder.rs` | Xác nhận composition root có thể build cùng setup storage bằng mock runtime mà không làm suy giảm smoke test hiện có. |
| `src-tauri/tests/storage_foundation.rs` | Integration test database trên thư mục tạm, cấu hình connection, tính bền vững và rollback transaction. |

Mỗi migration nghiệp vụ trong tương lai phải thêm một file dưới `src-tauri/migrations/`, đặt tên bằng version bốn chữ số và mô tả `snake_case`, cùng một entry `include_str!` tương ứng trong `src-tauri/src/storage/migrations.rs`; migration đầu tiên dự kiến là `0001_create_projects.sql`. BE-002 không sở hữu bảng nghiệp vụ nên không tạo migration SQL rỗng hoặc bảng metadata riêng.

## Dữ liệu

BE-002 không tạo bảng. Phiên bản schema hiện tại được lưu bằng `PRAGMA user_version`; giá trị `0` nghĩa là chưa có migration nghiệp vụ nào được áp dụng. Mỗi migration tương lai sở hữu và mô tả schema trong tài liệu feature tương ứng.

## DTO public

Không có. `Storage`, `Migration` và `StorageError` là contract Rust nội bộ, không derive `TS` và không sinh file trong `src/bindings/`.

## Tauri command

Không có. Capability nghiệp vụ sở hữu command của nó và gọi `Storage` qua managed state.

## Contract Rust nội bộ

```rust
#[derive(Clone)]
pub struct Storage {
    connection: Arc<Mutex<Connection>>,
}

impl Storage {
    pub const DATABASE_FILE_NAME: &'static str = "xwork.sqlite3";

    pub fn open(app_data_dir: &Path) -> Result<Self, StorageError>;

    pub fn with_connection<T, E>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, E>,
    ) -> Result<T, E>
    where
        E: From<StorageError>;

    pub fn with_transaction<T, E>(
        &self,
        operation: impl FnOnce(&Transaction<'_>) -> Result<T, E>,
    ) -> Result<T, E>
    where
        E: From<StorageError>;
}
```

- `Storage::open` nhận thư mục app data đã được Tauri resolve, tạo thư mục nếu chưa tồn tại, mở file `xwork.sqlite3` trực tiếp trong thư mục đó, cấu hình connection rồi chạy migration trước khi trả về handle.
- `Storage` clone chỉ clone `Arc`; toàn bộ clone dùng chung đúng một `rusqlite::Connection` và một mutex. Không capability nào được tự mở connection tới file này.
- `with_connection` giữ mutex trong toàn bộ callback và chỉ dành cho thao tác đọc hoặc câu lệnh đơn không cần transaction nhiều bước.
- `with_transaction` luôn mở `TransactionBehavior::Immediate`, giữ mutex đến khi commit/rollback, commit chỉ khi callback trả `Ok`, và trả nguyên lỗi callback khi callback trả `Err`. Không gọi lồng `with_connection` hoặc `with_transaction` từ bên trong callback vì cùng một mutex không re-entrant.
- Lỗi lấy mutex, bắt đầu transaction hoặc commit được chuyển thành `StorageError` rồi sang kiểu lỗi của capability bằng `From<StorageError>`.
- Callback không được trả về reference mượn từ `Connection` hoặc `Transaction`; lifetime trong chữ ký phải khiến compiler ngăn reference thoát khỏi critical section.

Contract migration nội bộ:

```rust
pub(crate) struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub(crate) const MIGRATIONS: &[Migration] = &[];

pub(crate) fn run_migrations(
    connection: &mut Connection,
    migrations: &[Migration],
) -> Result<(), StorageError>;
```

- Registry production ban đầu rỗng; migration nghiệp vụ đầu tiên dùng version `1` và tên file `0001_create_projects.sql` theo thứ tự roadmap hiện tại.
- Mỗi entry sau này nhúng nội dung bằng `include_str!` với đường dẫn tĩnh, chẳng hạn `include_str!("../../migrations/0001_create_projects.sql")`; runner không đọc hoặc sắp xếp file từ filesystem lúc runtime.
- `run_migrations` kiểm tra toàn bộ registry trước khi thay đổi database: version bắt đầu từ `1`, tăng liên tiếp đúng một đơn vị, không trùng version, tên không rỗng và mỗi version nằm trong miền số nguyên có thể ghi vào `PRAGMA user_version`.
- Runner đọc `PRAGMA user_version`. Nếu database có version lớn hơn version cao nhất binary hỗ trợ, trả `DatabaseVersionTooNew` và không chạy migration nào.
- Runner bỏ qua version đã áp dụng và chạy từng version còn thiếu theo thứ tự tăng dần. Mỗi migration có một `TransactionBehavior::Immediate` riêng; SQL của migration và cập nhật `PRAGMA user_version` nằm trong cùng transaction.
- Một migration lỗi phải rollback toàn bộ version đó, giữ `user_version` ở version hoàn thành gần nhất và không thử các version sau. Lần khởi động tiếp theo có thể chạy lại chính version bị lỗi.
- Migration đã phát hành là bất biến. Đổi nội dung migration cũ, đổi số, chèn version vào giữa hoặc dùng migration giảm version đều bị cấm; sửa schema bằng migration mới.

## Event / Channel phát ra

Không có. Khởi tạo storage hoàn tất trước khi frontend có thể gọi command; lỗi khởi tạo làm ứng dụng không khởi động thay vì phát event.

## Business rule và invariant

1. Database duy nhất của XWork là file `xwork.sqlite3` nằm trực tiếp trong app data directory do Tauri resolve; source project không bao giờ được sao chép vào app data.
2. `Storage` chỉ được đăng ký vào Tauri managed state sau khi mở connection, cấu hình PRAGMA và chạy mọi migration còn thiếu thành công.
3. Mọi connection phải bật `foreign_keys = ON`, đặt `busy_timeout` là `5` giây, dùng `journal_mode = WAL` và `synchronous = NORMAL`; giá trị thực tế được đọc lại và xác nhận trong lúc mở.
4. Trong một process chỉ có một connection được chia sẻ và mọi truy cập qua `Storage` được tuần tự hóa bằng mutex; không giữ mutex qua điểm `.await`.
5. Mọi thao tác ghi gồm nhiều câu lệnh phải đi qua `with_transaction`; transaction ghi dùng chế độ `Immediate` để phát hiện contention trước khi thay đổi một phần dữ liệu.
6. Migration chạy trước mọi query nghiệp vụ và theo thứ tự version tăng dần, mỗi version là atomic.
7. Không tự xóa, đổi tên, thay thế hoặc tạo lại database khi file hỏng, bị khóa, có version mới hơn binary hoặc migration thất bại.
8. Không ghi SQL, bind parameter, nội dung row, note, file project, terminal output hoặc secret vào log. Log storage chỉ chứa operation code, migration version/name và phân loại lỗi an toàn.
9. BE-002 không cung cấp command, event, Channel, DTO hoặc generated binding công khai.

## Lỗi

```rust
pub enum StorageError {
    CreateAppDataDirectory { source: std::io::Error },
    OpenDatabase { source: rusqlite::Error },
    ConfigureConnection { pragma: &'static str, source: rusqlite::Error },
    UnexpectedPragmaValue { pragma: &'static str, expected: &'static str, actual: String },
    InvalidMigrationSet { version: Option<u32>, reason: &'static str },
    ReadSchemaVersion { source: rusqlite::Error },
    DatabaseVersionTooNew { found: u32, supported: u32 },
    MigrationFailed { version: u32, name: &'static str, source: rusqlite::Error },
    LockPoisoned,
    BeginTransaction { source: rusqlite::Error },
    CommitTransaction { source: rusqlite::Error },
}
```

| Variant | Khi nào xảy ra | Frontend cần phân biệt để làm gì |
|---|---|---|
| `CreateAppDataDirectory` | Không thể tạo hoặc truy cập thư mục app data. | Không public qua IPC; startup dừng và log mã lỗi an toàn. |
| `OpenDatabase` | SQLite không thể mở file database. | Không public qua IPC; startup dừng, không tự tạo lại dữ liệu. |
| `ConfigureConnection` | Không đặt hoặc xác nhận được một PRAGMA bắt buộc. | Không public qua IPC; startup dừng vì invariant connection chưa được bảo đảm. |
| `UnexpectedPragmaValue` | SQLite đọc lại một PRAGMA bắt buộc với giá trị khác contract. | Không public qua IPC; startup dừng và log tên PRAGMA cùng giá trị an toàn. |
| `InvalidMigrationSet` | Registry compile-time không liên tiếp, trùng version, tên rỗng hoặc version ngoài miền hỗ trợ. | Không public qua IPC; lỗi lập trình làm startup/test thất bại. |
| `ReadSchemaVersion` | Không đọc được `PRAGMA user_version`. | Không public qua IPC; startup dừng. |
| `DatabaseVersionTooNew` | Database đã được binary mới hơn nâng schema. | Không public qua IPC; startup dừng để tránh binary cũ làm hỏng dữ liệu. |
| `MigrationFailed` | Không bắt đầu, chạy, cập nhật version hoặc commit được migration xác định. | Không public qua IPC; startup dừng và log version/name, không log SQL. |
| `LockPoisoned` | Callback trước đó panic khi đang giữ mutex. | Capability bao bọc lỗi này và cung cấp retry/khởi động lại phù hợp; storage không tiếp tục dùng connection âm thầm. |
| `BeginTransaction` | Không mở được transaction ghi `Immediate`. | Capability phân biệt lỗi persistence và không thực hiện side effect phụ thuộc database. |
| `CommitTransaction` | Callback thành công nhưng commit thất bại. | Capability coi thao tác là thất bại, không báo thành công cho frontend. |

`StorageError` phải giữ source error cho chuỗi lỗi nội bộ nhưng phần `Display` và log không được chứa SQL, bind value hoặc nội dung dữ liệu. Lỗi query trong callback do capability sở hữu và được bọc trong error enum của capability đó.

## Luồng chính

1. Tauri setup resolve app data bằng `app.path().app_data_dir()` và truyền thư mục tuyệt đối vào `Storage::open`.
2. `Storage::open` tạo app data directory nếu cần, mở file `xwork.sqlite3` bằng cờ read-write/create và không follow bất kỳ đường dẫn do frontend cung cấp.
3. Storage đặt `busy_timeout`, `foreign_keys`, `journal_mode` và `synchronous`, sau đó đọc lại từng giá trị bắt buộc để xác nhận.
4. Storage kiểm tra registry migration, đọc schema version và chạy từng migration còn thiếu trong transaction riêng.
5. Chỉ sau khi bước 2–4 thành công, setup gọi `app.manage(storage)`; nếu bất kỳ bước nào lỗi, setup trả lỗi và quá trình khởi động dừng.
6. Capability clone handle `Storage`, chuyển công việc database sang blocking thread, rồi gọi `with_connection` hoặc `with_transaction`. Kết quả chỉ được trả về async command sau khi callback đã nhả mutex.

## Ràng buộc kỹ thuật

- Blocking: `rusqlite`, migration và filesystem directory creation là blocking. Khởi tạo chạy đồng bộ trong Tauri setup trước khi nhận IPC; mọi truy cập phát sinh từ async command phải clone `Storage` và chạy toàn bộ callback bằng `tauri::async_runtime::spawn_blocking`. Không giữ `State`, mutex guard, `Connection` hoặc `Transaction` qua `.await`.
- Bảo mật: Database path chỉ được tạo từ app data directory do Tauri resolve và hằng tên file; không nhận path hay SQL từ frontend. Dùng parameter binding cho mọi giá trị nghiệp vụ. Không lưu secret credential, không log SQL/data và không tự khôi phục bằng cách phá hủy file lỗi.
- Hiệu năng: Một connection WAL được tuần tự hóa là giới hạn có chủ ý cho workload local-first một người dùng ở Phase 1. Mỗi callback phải ngắn, không thực hiện filesystem/network/PTY và không chờ async khi giữ lock. Nếu đo đạc sau này chứng minh contention, connection pool phải là một thiết kế riêng thay vì thay đổi ngầm contract này.

## Tiêu chí hoàn thành

- [ ] Lần mở đầu tạo file `xwork.sqlite3` trực tiếp trong app data directory được truyền vào; mở lại cùng thư mục giữ nguyên dữ liệu đã commit.
- [ ] Connection thực tế báo `foreign_keys = 1`, `journal_mode = wal`, `synchronous = 1` (`NORMAL`) và `busy_timeout = 5000`.
- [ ] Registry hợp lệ chạy migration thử nghiệm đúng thứ tự, chỉ chạy version lớn hơn `user_version` và không chạy lại migration đã áp dụng.
- [ ] Migration lỗi rollback cả schema/data và `user_version` của version đó; migration sau nó không chạy.
- [ ] Database có version mới hơn registry bị từ chối mà không thay đổi file.
- [ ] `with_transaction` commit khi callback thành công và rollback khi callback trả lỗi.
- [ ] Tauri composition chỉ expose `Storage` sau khi setup thành công; lỗi mở database hoặc migration làm build/startup mock tương ứng thất bại rõ ràng.
- [ ] Không có command, event, Channel, DTO, binding hoặc quyền capability frontend mới.
- [ ] Mọi function, method, callback, test và helper mới có comment ngắn đúng quy tắc project; logic migration có inline comment cho invariant không hiển nhiên.
- [ ] Trên Windows, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets --all-features` và Tauri build đều pass.

## Kiểm thử

| File test | Loại | Hành vi kiểm tra |
|---|---|---|
| `src-tauri/src/storage/migrations.rs` (`#[cfg(test)]`) | Unit | Registry rỗng hợp lệ; fixture không bắt đầu ở `1`, có gap, trùng version, tên rỗng hoặc version ngoài miền bị từ chối trước khi chạy SQL; migration fixture chạy theo thứ tự; version hiện tại được bỏ qua; lỗi giữa chuỗi rollback và chặn version sau; database mới hơn bị từ chối. |
| `src-tauri/src/storage/mod.rs` (`#[cfg(test)]`) | Unit | Tên file cố định, mapping lỗi mutex/transaction và callback lỗi không commit. |
| `src-tauri/tests/storage_foundation.rs` | Integration | Mở database trong `tempfile::TempDir`, xác nhận path và PRAGMA, ghi/đọc lại qua hai lần mở, commit/rollback và chia sẻ cùng connection giữa các clone. |
| `src-tauri/tests/app_builder.rs` | Integration | Composition root với mock runtime vẫn build khi storage setup thành công và không đăng ký IPC public ngoài phạm vi. |

Test tuyệt đối không dùng app data thật của người phát triển. Fixture migration chỉ tồn tại trong module test hoặc database tạm, không thêm migration nghiệp vụ giả vào registry production.

## Câu hỏi mở

Không có.
