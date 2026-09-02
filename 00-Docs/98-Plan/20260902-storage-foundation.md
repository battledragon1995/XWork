# BE-002 Storage Foundation Implementation Plan

**Status:** Draft

**Goal:** Implement the shared SQLite storage foundation exactly as specified
by `BE-002`, so every later backend capability persists data through one
managed, migrated, serialized connection in the resolved app data directory.

**Completion Criteria:**

- `Storage::open` creates `xwork.sqlite3` directly in the app data directory
  passed to it, and reopening the same directory preserves committed data.
- The opened connection reports `foreign_keys = 1`, `journal_mode = wal`,
  `synchronous = 1`, and `busy_timeout = 5000` when read back.
- The migration runner applies only missing versions in ascending order, never
  re-applies an applied version, rolls back a failed version atomically,
  blocks later versions, and rejects a database newer than the registry
  without modifying the file.
- `with_transaction` commits when its callback returns `Ok`, rolls back when
  it returns `Err`, and every `Storage` clone shares the same connection and
  mutex.
- The Tauri composition root registers `Storage` as managed state only after
  opening, PRAGMA configuration, and migrations succeed, and adds no command,
  event, Channel, DTO, generated binding, or frontend capability.
- Every new function, method, callback, test, and helper has a short purpose
  comment, and migration logic has inline comments for non-obvious
  invariants.
- On Windows, `pnpm format:rust`, `pnpm lint:rust`,
  `cargo test --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features`, and `pnpm tauri build --no-bundle` pass.

**Architecture:** The storage capability owns exactly one `rusqlite`
connection behind an `Arc<Mutex<Connection>>` and exposes read access through
`with_connection` plus write access through `with_transaction`. Migrations are
embedded SQL files registered in a compile-time, contiguous-version array and
applied by `PRAGMA user_version` before `Storage::open` returns. The Tauri
setup hook resolves the app data directory, opens the database, and only then
registers `Storage` as managed state; BE-002 exposes no IPC surface.

**Tech Stack:** Rust 1.98.0 stable, Cargo 1.98.0, Rust Edition 2024,
SQLite 3.x through `rusqlite` 0.40.2 with the `bundled` feature, Tauri 2.11.5,
and `tempfile` 3.27.0 as a dev-only dependency for temporary test directories.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 3 (Lifecycle and
  application shell)
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, section 2
- Backend spec: `00-Docs/03-Backend/BE-002-storage-foundation.md`
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Plan rules: `PLANS.md`

No frontend specification or wireframe applies to this plan: `BE-002` is an
internal Rust persistence foundation with no user-visible behavior.

## Scope

**In Scope:**

- `rusqlite` 0.40.2 with the `bundled` feature as a runtime dependency and
  exact-pinned `tempfile` 3.27.0 as a dev-dependency for temporary test
  directories.
- The `Storage` internal contract: `Storage::open`, `with_connection`,
  `with_transaction`, `DATABASE_FILE_NAME`, and `StorageError`.
- The compile-time migration registry, registry validation, and the sequential
  migration runner based on `PRAGMA user_version`.
- Composition-root setup that resolves the app data directory, opens and
  migrates the database, and registers `Storage` as managed state.
- Unit tests inside `src-tauri/src/storage/` and integration tests in
  `src-tauri/tests/` that use only temporary directories.

**Out of Scope:**

- `BE-001` lifecycle, single instance, tray, and Quit flow, plus `FE-001`; the
  remainder of roadmap Stage 3 is planned separately once its specifications
  are ready.
- Business tables, queries, repositories, and migrations such as
  `0001_create_projects.sql`, which belong to the feature owning that schema
  (first: `BE-003`).
- Backup, restore, and reset behavior owned by `BE-012`.
- Database encryption, connection pooling, and any frontend, IPC, plugin, or
  generated-binding surface.

## Global Constraints

- "Keep OS access, persistence, terminal processes, and business rules in
  Rust; the React frontend communicates with them through narrowly scoped
  Tauri commands and events." (`AGENTS.md`)
- "Chỉ backend truy cập database; không dùng Tauri SQL hoặc Store plugin từ
  frontend." (`00-Docs/00-Overview/01-TechStack.md`)
- "`storage` và `platform` không phụ thuộc vào capability nghiệp vụ."
  (`00-Docs/00-Overview/02-ProjectStructure.md`)
- "Migration đặt tại `src-tauri/migrations/`, chỉ được thêm file mới và không
  sửa migration đã phát hành." (`00-Docs/00-Overview/02-ProjectStructure.md`)
- BE-002 adds no command, event, Channel, DTO, generated binding, or frontend
  capability; the production migration registry stays empty because BE-002
  owns no business table. (`00-Docs/03-Backend/BE-002-storage-foundation.md`)
- Storage initialization runs synchronously in Tauri setup before IPC is
  served; no `State`, mutex guard, `Connection`, or `Transaction` is held
  across an `.await`. (`00-Docs/03-Backend/BE-002-storage-foundation.md`)
- "Every function, method, callback, test, and helper must have a short
  comment describing its purpose." (`AGENTS.md`)
- "During development, build and test only on Windows." (`AGENTS.md`)

## Assumptions, Risks, and Blockers

**Assumptions:**

- `BE-002-storage-foundation.md` is the authoritative contract and reports no
  open questions, so implementation may start without further specification
  work.
- `app.path().app_data_dir()` resolves a writable directory for identifier
  `com.xwork.app`; `Storage::open` receives only that resolved absolute path
  and never builds paths from frontend input.

**Risks:**

- The exact `rusqlite` 0.40.2 API for pragma access and transaction control
  may differ from assumed names. Mitigation: tests read back actual PRAGMA
  values and `user_version` instead of trusting configuration calls to have
  taken effect.
- The mock runtime used by `src-tauri/tests/app_builder.rs` resolves app data
  through the host environment. Mitigation: a doc-hidden Rust test entry point
  accepts an explicit app data directory and delegates to the same private
  setup implementation as the production resolver, so integration tests use
  only temporary paths and never touch the developer's real app data.
- A failed migration could leave schema, data, or version half-applied.
  Mitigation: each migration version, including its `PRAGMA user_version`
  update, runs inside its own `TransactionBehavior::Immediate` transaction.
- The single serialized connection is an intentional Phase 1 limit. Mitigation
  for later contention: a connection pool requires a separate design change,
  not a silent contract modification.

**Blockers:** None.

## Dependency Order

1. Task 1 (migration contract and runner) → enables Task 2, because
   `Storage::open` runs migrations before returning.
2. Task 2 (`Storage` handle and access API) → enables Task 3, because the
   composition root manages a fully initialized `Storage`.
3. Task 3 (composition-root setup) → enables final verification, because it is
   the task that affects desktop startup and therefore requires the Windows
   Tauri build check.

---

### Task 1: Migration Contract and Sequential Runner

**Outcome:** `run_migrations` validates the compile-time registry before
touching the database, applies only missing versions in ascending order inside
independent immediate transactions, skips already applied versions, rolls back
a failed version completely, blocks later versions after a failure, and
rejects a database whose `user_version` is newer than the registry.

**Depends On:** None

**Files:**

- Create: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/storage/migrations.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/storage/migrations.rs` (`#[cfg(test)]`)

**Interfaces:**

- Consumes: None
- Produces: `pub enum StorageError` as specified by `BE-002`;
  `pub(crate) struct Migration { version: u32, name: &'static str,
  sql: &'static str }`; `pub(crate) const MIGRATIONS: &[Migration] = &[]`;
  `pub(crate) fn run_migrations(connection: &mut Connection, migrations:
  &[Migration]) -> Result<(), StorageError>`; `pub mod storage` in
  `src-tauri/src/lib.rs`.

- [ ] **Step 1: Add the dependencies**

  Add `rusqlite = { version = "=0.40.2", features = ["bundled"] }` to
  `[dependencies]` and `tempfile = "=3.27.0"` to `[dev-dependencies]`, then
  update `src-tauri/Cargo.lock`.

- [ ] **Step 2: Add the failing migration tests**

  Create the storage module files and declare them from `lib.rs` so the test
  module is compiled. In `#[cfg(test)]` inside `migrations.rs`, cover: an empty
  registry is valid; registries that do not start at `1`, contain a gap, a
  duplicate version, an empty name, or an out-of-range version are rejected as
  `InvalidMigrationSet` before any SQL runs; fixture migrations apply in
  ascending order; the current `user_version` is skipped; a failing migration
  rolls back that version's schema, data, and `user_version` and blocks later
  versions; a database newer than the registry is rejected as
  `DatabaseVersionTooNew` without file changes. Keep every migration fixture
  inside the test module or a temporary database.

- [ ] **Step 3: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::migrations`

  Expected: compilation fails on the migration contract referenced by the new
  tests because its implementation does not exist yet.

- [ ] **Step 4: Implement the migration contract**

  Implement `StorageError` exactly as specified (including safe `Display` text
  without SQL or data), keep the migrations module internal to `storage`, and
  implement `Migration`, the empty production `MIGRATIONS` array, registry
  validation, the `DatabaseVersionTooNew` check, and the per-version
  immediate-transaction runner that writes `PRAGMA user_version` in the same
  transaction as the migration SQL.

- [ ] **Step 5: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::migrations`

  Expected: all migration unit tests pass.

### Task 2: Storage Handle, Connection Configuration, and Access API

**Outcome:** `Storage::open` creates the app data directory when missing,
opens `xwork.sqlite3` directly inside it with read-write/create flags,
configures and verifies `busy_timeout`, `foreign_keys`, `journal_mode`, and
`synchronous`, runs migrations, and returns a clone-cheap handle whose
`with_connection` serializes access and whose `with_transaction` commits on
`Ok` and rolls back on `Err`.

**Depends On:** Task 1

**Files:**

- Modify: `src-tauri/src/storage/mod.rs`
- Test: `src-tauri/src/storage/mod.rs` (`#[cfg(test)]`)
- Test: `src-tauri/tests/storage_foundation.rs`

**Interfaces:**

- Consumes: `run_migrations`, `MIGRATIONS`, and `StorageError` from Task 1.
- Produces: `pub const DATABASE_FILE_NAME: &'static str = "xwork.sqlite3"`;
  `pub fn open(app_data_dir: &Path) -> Result<Self, StorageError>`;
  `pub fn with_connection<T, E>(&self, operation: impl FnOnce(&Connection)
  -> Result<T, E>) -> Result<T, E> where E: From<StorageError>`;
  `pub fn with_transaction<T, E>(&self, operation: impl FnOnce(&Transaction<'_>)
  -> Result<T, E>) -> Result<T, E> where E: From<StorageError>`.

- [ ] **Step 1: Add the failing storage tests**

  Add unit tests in `mod.rs` for the fixed database file name, mapping of
  mutex, begin, and commit failures to `StorageError`, and that a callback
  returning `Err` does not commit. Add `storage_foundation.rs` integration
  tests using `tempfile::TempDir`: first open creates the file at the exact
  expected path; the live connection reports `foreign_keys = 1`,
  `journal_mode = wal`, `synchronous = 1`, and `busy_timeout = 5000`;
  committed data survives a close-and-reopen; `with_transaction` commits on
  `Ok` and rolls back on `Err`; clones share one underlying connection.

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib storage`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`

  Expected: compilation or assertions fail because `Storage::open`,
  `with_connection`, and `with_transaction` are not implemented yet.

- [ ] **Step 3: Implement the minimum storage handle**

  Implement `Storage` with a single `Arc<Mutex<Connection>>`, `open` with
  directory creation, the exact database file name, pragma configuration with
  read-back verification, and migration execution; implement
  `with_connection` holding the mutex across the callback and
  `with_transaction` always beginning with `TransactionBehavior::Immediate`
  and committing only on `Ok`, mapping storage failures through
  `From<StorageError>` while returning callback errors unchanged.

- [ ] **Step 4: Verify the task**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib storage`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation`

  Expected: all storage unit and integration tests pass.

### Task 3: Composition-Root Storage Setup

**Outcome:** The Tauri composition root resolves the app data directory,
opens and migrates the database during synchronous setup, registers `Storage`
as managed state only after success, fails startup clearly when storage setup
fails, and adds no public IPC surface.

**Depends On:** Task 2

**Files:**

- Modify: `src-tauri/src/app/mod.rs`
- Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: `Storage::open` from Task 2; Tauri `Builder::setup`,
  `AppHandle::manage`, and `Manager::path().app_data_dir()`.
- Produces: `Storage` available as Tauri managed state for later backend
  capabilities; a doc-hidden
  `pub fn configure_with_app_data_dir<R: Runtime>(builder: Builder<R>,
  app_data_dir: PathBuf) -> Builder<R>` used only by integration tests; no
  command, event, Channel, DTO, or binding.

- [ ] **Step 1: Extend the composition test first**

  In `app_builder.rs`, route every build through
  `configure_with_app_data_dir` and a `tempfile::TempDir`. Cover: successful
  setup exposes `Storage` as managed state; an app data path that is a regular
  file makes the build fail; and a temporary database whose `user_version` is
  newer than the empty production registry makes the build fail. Keep the
  existing mock-runtime build assertion inside the successful case.

- [ ] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder`

  Expected: compilation fails because the test-only composition entry point
  and managed `Storage` state do not exist yet.

- [ ] **Step 3: Implement the setup hook**

  In `app/mod.rs`, make `configure` resolve the production app data directory
  and add the doc-hidden `configure_with_app_data_dir` test entry point. Both
  delegate to one private setup implementation that calls `Storage::open` and
  manages the handle only after success, returning setup errors to stop
  startup. Do not add an invoke handler or modify commands, events,
  capabilities, DTOs, bindings, or frontend files.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder`

  Expected: all three composition-root cases pass without reading or writing
  the developer's real app data directory.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Rustfmt | `pnpm format:rust` | No formatting diff |
| Clippy | `pnpm lint:rust` | Pass with warnings denied |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | All unit, integration, and enabled-feature tests pass |
| Windows Tauri build | `pnpm tauri build --no-bundle` | Build succeeds with storage setup in the desktop runtime |

## Deviations and Decisions

- None.

## Outcome

Pending implementation.
