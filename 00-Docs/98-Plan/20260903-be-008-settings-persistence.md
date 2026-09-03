# BE-008 Settings Persistence Implementation Plan

**Status:** Draft

**Goal:** Implement the complete Phase 1 `BE-008` backend contract so XWork
persists one typed settings singleton (Appearance plus sidebar state) in
SQLite, returns General as read-only constants, applies authorized
main-window-only patches atomically with a single revision increment, exposes
the typed owner seam for the later `BE-012` coordinator, and generates the
TypeScript settings binding from Rust.

**Completion Criteria:**

- A fresh database runs `0002_create_settings.sql`, contains exactly one
  default row, and reopening storage returns the same committed snapshot
  including the persisted revision.
- `get_settings`, `update_settings`, and `restore_appearance_defaults` are
  registered in the composition root; any window created by XWork can read
  settings, while mutations from a label other than `main` are rejected with
  `UnauthorizedWindow` before validation and before any database access.
- A valid multi-section patch commits atomically, increments the revision by
  exactly one, and replaces the in-memory cache only after commit; an invalid
  patch or a SQLite failure leaves the database row, cache, and revision
  unchanged.
- The three color presets, General constants, color normalization, WCAG
  contrast thresholds, font and sidebar bounds, patch-merge semantics, and the
  preset/custom rule are covered by unit tests at their exact boundary values.
- Restoring Appearance defaults keeps General and sidebar unchanged and still
  increments the revision when Appearance is already at its default state.
- After restart, General still returns the fixed constants; Appearance,
  sidebar width/collapsed, and the revision are preserved; `theme_mode =
  system` never persists the current effective OS scheme.
- Every persistent mutation holds one `DataReadPermit` from before the write
  gate until after commit and cache publication; a maintenance write permit
  blocks settings mutations; the typed `_in` owner APIs run only on the
  coordinator-owned transaction, a coordinator rollback publishes nothing, and
  a commit publishes the prepared cache projection.
- Commands return `Unavailable` once shutdown has begun or when the service is
  not yet managed; poisoned service locks also map to `Unavailable`.
- `src/bindings/settings.ts` is generated only by the binding contract test,
  contains the complete Phase 1 DTO contract, and has no handwritten duplicate
  anywhere under `src/`.
- All Rust quality gates with warnings denied, all frontend regression gates,
  and the Windows Tauri build pass. No automated desktop end-to-end test is
  added.

**Architecture:** A new `settings` capability owns the singleton `settings`
row end to end inside one `settings/mod.rs`: typed DTOs, the immutable
`SettingsSnapshot` model, preset constants, validation, the repository SQL,
`SettingsService`, its errors, and three thin Tauri commands. The service uses
one standard-library mutex as its write gate and a separate `RwLock` cache;
the only lock order is `DataMaintenanceGate` read permit -> settings write
gate -> `Storage`, with the cache lock never held across Storage waits. The
composition root hydrates the service during setup before windows are served,
manages it together with the existing gate, and registers the commands; a
`SettingsDataParticipant` adapts the typed `_in` owner APIs for the future
`BE-012` coordinator without re-entering the gate, the write gate, or Storage.

**Tech Stack:** No new dependency is introduced. The slice uses the already
exact-pinned Rust `1.98.0` (Edition `2024`), Cargo `1.98.0`, Tauri `2.11.5`,
Tokio `1.53.1` (the required `sync` feature is already enabled in
`src-tauri/Cargo.toml`), rusqlite `0.40.2` (`bundled`), Serde `1.0.229`, and
ts-rs `12.0.1`. WCAG contrast is computed with in-crate integer/float math.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 6 (Settings nền tảng)
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections
  4.1, 5.2-5.4, 17.1-17.2, 17.5, and 18
- Backend spec: `00-Docs/03-Backend/BE-008-settings-persistence.md`
- Backend prerequisites: `00-Docs/03-Backend/BE-002-storage-foundation.md`,
  `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`, and
  `00-Docs/03-Backend/BE-003-projects.md` (migration ordering only)
- Frontend catalog entries (not yet specified): `FE-011`, `FE-012`,
  `FE-023`, and the existing `FE-001` sidebar state in
  `00-Docs/02-Frontend/00-Overview.md`
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Wireframe: `00-Docs/01-Wireframe/02-AppShell.html`, the
  `#settings-general` and `#settings-appearance` anchors
- Plan rules: `PLANS.md`

`FE-011` and `FE-012` do not yet have feature specifications in the
repository. This is a backend-only plan, following the same pattern as the
`BE-004` plan: it produces the contract and persistence that the Stage 6
frontend plans will consume, but it does not build the Settings UI, wire
`FE-001` sidebar state to the backend, or expose settings in the existing
shell. Stage 6 and the user-visible completion items of `BE-008` remain
incomplete until `FE-011`, `FE-012`, and the `FE-001` extension are specified,
planned, implemented, and verified separately.

## Scope

**In Scope:**

- Adding `src-tauri/migrations/0002_create_settings.sql` with the exact schema
  from `BE-008` and registering migration version 2 in the sequential
  `BE-002` registry.
- The Phase 1 public DTO subset: `InterfaceLanguageDto`, `ThemeModeDto`,
  `ThemePresetDto`, `InterfaceColorsDto`, `InterfaceThemeColorsDto`,
  `TerminalPaletteDto`, `GeneralSettingsDto`, `AppearanceSettingsDto`,
  `SidebarSettingsDto`, `AppSettingsDto` (without `notifications`),
  `AppearanceSettingsPatchDto`, `SidebarSettingsPatchDto`,
  `UpdateSettingsDto` (without `notifications`), and the complete
  `SettingsError` enum.
- The immutable `SettingsSnapshot` model, General constants, the `cream`,
  `ink`, and `paper` preset constants, `#RRGGBB` normalization, WCAG contrast
  validation, font/sidebar bounds, patch merge with the preset/custom rule,
  and revision formatting.
- `SettingsService` hydration from row `id = 1`, cached snapshots, serialized
  mutations through the write gate and `Storage::with_transaction`, restore of
  Appearance defaults, corrupt-row rejection, and shutdown awareness.
- The three Tauri commands with exact-window authorization, `DataReadPermit`
  acquisition after authorization and shape validation, and
  `tauri::async_runtime::spawn_blocking` for all database work.
- Composition-root wiring: shared `DataMaintenanceGate`, managed
  `SettingsService`, command registration, and shutdown notification from the
  two existing quit flows.
- `SettingsDataParticipant` with the typed `_in` export/prepare/apply/reset
  owner APIs and post-commit publication for the future `BE-012` coordinator.
- Generated `src/bindings/settings.ts` through the existing
  `export_bindings.rs` contract-test mechanism.
- Updating existing tests that assert schema version 1 or use version 2 as a
  "database from the future" fixture.

**Out of Scope:**

- The Phase 4 notification extension: `NotificationSettingsDto`,
  `CliOsNotificationStatesDto`, `NotificationSettingsPatchDto`, the
  `notifications` fields, migration `0010_add_notification_settings.sql`,
  `SettingsService::subscribe`, the Tokio watch channel, and all
  `BE-011`/`BE-019` consumption. They are co-implemented with `BE-019`.
- The `BE-012` backup/reset coordinator itself; only the typed settings owner
  seam is produced here.
- Frontend work: `FE-011`, `FE-012`, `FE-023`, the `FE-001` sidebar
  persistence wiring, any IPC wrapper under `src/lib/ipc/`, and any visible
  theme/sidebar behavior in the running UI.
- Keyboard shortcuts (`BE-009`), CLI profiles (`BE-006`), tray/close/quit
  behavior changes (`BE-001`), autostart, and notification delivery.
- macOS validation and release packaging.

## Global Constraints

- Rust owns OS access, persistence, and business rules; the React frontend
  communicates only through narrowly scoped Tauri commands and events
  (`AGENTS.md`, Project Structure).
- Lockfile-locked, exact-pinned versions from `01-TechStack.md`; no new
  dependency may be added by this plan.
- Migration files are only ever added, never modified
  (`02-ProjectStructure.md`).
- Generated bindings under `src/bindings/` are never edited manually
  (`02-ProjectStructure.md`, `BE-008`).
- Tauri commands stay thin: parse/validate DTOs, call the capability, and
  convert results; they contain no business rules and no SQL
  (`02-ProjectStructure.md`).
- A backend capability may use `storage`, `platform`, and `shared` but never
  another capability's internals; the `app` module composes capabilities
  (`02-ProjectStructure.md`).
- Settings store no secrets, terminal output, note content, project source or
  paths; logs contain only command name, revision, changed section, and error
  code (`BE-008` rule 14).
- Validate only on Windows during development; defer macOS to release
  preparation (`AGENTS.md`).
- Code, identifiers, and comments are written in English; every added
  function, method, callback, helper, and test carries a short purpose comment
  (`AGENTS.md`, Project Structure).

Every task implicitly includes these constraints.

## Assumptions, Risks, and Blockers

**Assumptions:**

- The Phase 1 slice is exactly the General-read-only plus Appearance/sidebar
  contract; every Phase 4 notification item listed under Out of Scope stays
  absent, so no half-schema state reaches the frontend
  (`BE-008` decided decisions).
- `BE-003` is already implemented, so registry version 1 exists before
  version 2 is appended; `BE-008` itself never calls the Projects public
  interface.
- The shutdown seam (behavior is specified, the mechanism is not):
  `SettingsService` owns an internal `AtomicBool` exposed through
  `begin_shutdown()`. The flag is read once at entry to each public service
  operation, so an update that already passed the check may finish its commit
  while later callers receive `Unavailable`. The two existing quit commands
  notify the managed service through `AppHandle::try_state`, which is a no-op
  when settings are not managed, keeping lifecycle tests hermetic.
- `spawn_blocking` join failures (cancellation or worker panic) map to
  `PersistenceFailed`, matching the infrastructure-failure bucket used for
  worker failures in the existing Projects commands.
- `SettingsService` and its repository live in a single
  `src-tauri/src/settings/mod.rs`, exactly as the `BE-008` file table and the
  Project Structure "no premature splitting" rule require.
- `reset_settings_in` writes the exact default row, including `revision = 0`,
  because a coordinator reset restores first-run state. This is recorded here
  because `BE-008` fixes the reset semantics only for update/restore commands;
  revisit it when the `BE-012` coordinator is planned.
- `get_settings` performs no label check at the command layer: any webview
  window XWork creates may read the cached snapshot (`BE-008` rule 15).
- Commands are generic over `R: Runtime` (matching every existing command) so
  the MockRuntime integration harness can route them; this does not change the
  documented IPC contract.

**Risks:**

- Bumping the registry to version 2 breaks existing tests that assert version
  1 or use `user_version = 2` as the future-database fixture. Task 1 updates
  exactly those assertions and fixtures in `app_builder.rs`,
  `app_lifecycle.rs`, and `projects_commands.rs`.
- Wiring shutdown notification touches the `BE-001` quit commands. The wiring
  is guarded by `try_state`, adds no new parameter, and is verified by the
  full Rust test suite in Task 6.
- WCAG contrast math is easy to get wrong at exact thresholds. Task 2 tests
  the 4.5:1 and 3:1 boundaries directly with computed fixture pairs.
- Concurrency tests can deadlock if they hold the wrong lock order. They copy
  the existing `data_management_contract.rs` poll/timeout patterns and never
  hold a cache guard across a Storage call.

**Blockers:** None.

## Dependency Order

1. Migration `0002` and registry version 2 -> enable every later settings
   task and the updated schema-version assertions.
2. Typed model, presets, and pure validation -> enable the service, commands,
   participant, and bindings.
3. Service hydration, snapshot cache, and serialized mutations -> enable
   commands and the owner participant.
4. Tauri commands and composition-root registration -> enable shutdown wiring
   and binding export.
5. Typed `_in` owner APIs and `SettingsDataParticipant` -> enable the
   maintenance-contract tests.
6. Shutdown wiring in the quit flows -> complete lifecycle behavior.
7. Generated `settings.ts` binding -> complete the public contract.

---

### Task 1: Register the settings singleton migration

**Outcome:** A fresh XWork database migrates to schema version 2 and contains
exactly one `settings` row whose column layout and defaults match `BE-008`.

**Depends On:** None.

**Files:**

- Create: `src-tauri/migrations/0002_create_settings.sql`
- Modify: `src-tauri/src/storage/migrations.rs`
- Create: `src-tauri/tests/settings_commands.rs`
- Modify: `src-tauri/tests/app_builder.rs`
- Modify: `src-tauri/tests/app_lifecycle.rs`
- Modify: `src-tauri/tests/projects_commands.rs`

**Interfaces:**

- Consumes: `Storage::open`, the existing `MIGRATIONS` registry.
- Produces: `settings` table with the singleton `id = 1` row consumed by every
  later task.

- [ ] **Step 1: Add the failing migration test**

  Create `settings_commands.rs` with a `TempDir`-isolated `Storage::open`
  harness and the test `settings_migration_creates_single_default_row`. It
  asserts `user_version = 2`, exactly one row with `id = 1`, and the full
  default set (`revision = 0`, `system`, `cream`, all 16 typed color columns,
  the exact 16-element ANSI JSON string, fonts `14`/`13`, sidebar `280`/`0`)
  read with raw parameterized SQL, mirroring the migration-style tests in
  `projects_commands.rs`.

- [ ] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands`

  Expected: `settings_migration_creates_single_default_row` fails on
  `assert_eq!` with `left: 1, right: 2` for the schema version (or on the
  first settings query with `no such table: settings`).

- [ ] **Step 3: Add the migration and update stale version expectations**

  Add `0002_create_settings.sql` with SQL byte-equivalent to the `BE-008`
  Phase 1 block (table, checks, defaults, and `INSERT INTO settings (id)
  VALUES (1);`). Append `Migration { version: 2, name: "create_settings", sql:
  include_str!(...) }` to `MIGRATIONS`. Update the version assertions to `2`
  in `app_builder.rs` (`composition_root_builds_and_manages_storage`,
  `projects_composition_manages_storage_project_and_gate`), `app_lifecycle.rs`
  (`isolated_lifecycle_composition_manages_storage`), and
  `projects_commands.rs` (both reopen assertions). Change the two
  future-database fixtures in `app_builder.rs` from `user_version = 2` to
  `user_version = 3`.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands --test app_builder --test app_lifecycle --test
  projects_commands`

  Expected: All tests pass, including the new default-row test and the two
  updated future-database rejections.

### Task 2: Build the typed model, presets, and pure validation

**Outcome:** The settings module compiles with the Phase 1 DTOs, the
immutable snapshot model, General constants, the three presets, and all pure
validation and merge rules proven by unit tests at their boundary values.

**Depends On:** None (may proceed in parallel with Task 1).

**Files:**

- Create: `src-tauri/src/settings/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `#[cfg(test)] mod tests` inside `src-tauri/src/settings/mod.rs`

**Interfaces:**

- Consumes: `serde`, `ts_rs::TS`.
- Produces: every Phase 1 DTO listed in Scope with the exact derives and
  `rename_all` attributes from `BE-008` plus the repository's existing
  `#[ts(export_to = ...)]` convention; `SettingsSnapshot`; General constants;
  preset constants; color normalization, WCAG contrast, bounds, and
  patch-merge helpers; the complete `SettingsError` enum with `Display`,
  `std::error::Error`, and the tagged IPC shape.

- [ ] **Step 1: Add the failing unit tests**

  Add `pub mod settings;` to `lib.rs` and create `settings/mod.rs` containing
  only its documented test module. The tests reference the missing public
  items by name: default snapshot equality, the three preset token tables,
  General constants, uppercase-input/lowercase-stored color normalization,
  rejection of `#FFF`, `#RRGGBBAA`, `red`, and `rgb(...)`, contrast acceptance
  at exactly 4.5:1 and 3:1 plus rejection just below, font bounds
  11/12/20/21 and 9/10/24/25, sidebar bounds 199/200/420/421, missing and
  `null` patch fields being ignored, `EmptyPatch` for empty objects,
  `InvalidPresetCombination` for preset plus colors, custom colors switching
  the preset to `custom`, `custom` without colors keeping the palette, and
  revision-to-decimal-string formatting.

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib settings::`

  Expected: Compilation of the lib test target fails with `cannot find type`
  or `cannot find function` errors naming `SettingsSnapshot`, the DTO types,
  or the validation helpers; the test filter itself must show the settings
  tests as discovered by module path.

- [ ] **Step 3: Implement the model and rules**

  Implement the DTOs and snapshot exactly as specified: enums serialize as
  `snake_case` literals, struct fields as `camelCase`, `Option` patch fields
  are `#[ts(optional)]`, `revision` is a `u64` in the snapshot and a decimal
  string in `AppSettingsDto`. Encode General as constants, the three presets
  as full Light/Dark/terminal token tables, `#rrggbb` case-insensitive
  parsing, WCAG relative-luminance contrast with the exact ratio thresholds,
  the integer bounds, the merge order (patch fields, then preset replacement,
  then normalization, then whole-snapshot validation), and the preset/custom
  rule from `BE-008` rule 10.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib settings::`

  Expected: All settings unit tests pass with no default fallback behavior
  introduced.

### Task 3: Implement hydration, cache, and serialized mutations

**Outcome:** `SettingsService` hydrates and fully validates the singleton row
at construction, serves cached snapshots without database I/O, and applies
update/restore atomically under the documented lock order with exact revision
semantics and error mapping.

**Depends On:** Task 1, Task 2.

**Files:**

- Modify: `src-tauri/src/settings/mod.rs`
- Test: `src-tauri/tests/settings_commands.rs`
- Test: `#[cfg(test)] mod tests` inside `src-tauri/src/settings/mod.rs`

**Interfaces:**

- Consumes: `Storage::with_connection`, `Storage::with_transaction`,
  `DataMaintenanceGate`, `DataReadPermit`.
- Produces: `SettingsService::new(storage: Storage, gate:
  DataMaintenanceGate) -> Result<Self, SettingsError>` (hydrates row `id = 1`);
  `snapshot(&self) -> Result<SettingsSnapshot, SettingsError>`; synchronous
  `update(&self, patch: &UpdateSettingsDto) -> Result<SettingsSnapshot,
  SettingsError>` and `restore_appearance_defaults(&self) -> Result<...>`
  intended to run inside `spawn_blocking`; `begin_shutdown(&self)`; a
  `shares_gate_with` test hook mirroring Projects. Internal state: one
  standard-library mutex write gate plus a separate `RwLock<SettingsSnapshot>`
  cache. `From<StorageError>` maps `LockPoisoned` to `Unavailable` and every
  other storage error to `PersistenceFailed`; rusqlite errors inside
  transactions map to `PersistenceFailed`; decode/validation failures at
  hydration map to `CorruptStoredSettings { field }`.

- [ ] **Step 1: Add the failing service tests**

  Extend `settings_commands.rs` with service-level integration tests:
  `service_hydrates_default_and_survives_restart`; `update_persists_merged_sections_and_revision`;
  `invalid_patch_changes_nothing` (row, cache, revision); `sqlite_failure_maps_to_persistence_failed_and_keeps_cache`
  (drop the `settings` table via `with_connection`, then update);
  `restore_appearance_defaults_keeps_sidebar_and_increments_revision` (also
  from the already-default state); one corrupt-row variant per failure class
  (missing row, bad enum, wrong ANSI JSON length, invalid stored color,
  out-of-range font) asserting `SettingsService::new` returns
  `CorruptStoredSettings` without substituting defaults; `concurrent_disjoint_patches_serialize`
  (two threads through one service handle, both fields present, revision `+2`);
  and `begin_shutdown_rejects_new_operations_with_unavailable`.

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands`

  Expected: The integration target fails to compile with `cannot find type
  SettingsService in crate settings` (or the equivalent unresolved-import
  error), proving the service seam is absent rather than silently passing.

- [ ] **Step 3: Implement the service**

  Hydrate by reading the single row with fixed parameterized SQL, decoding
  into `SettingsSnapshot`, and validating the complete snapshot. For
  mutations: check the shutdown flag at entry, clone the service state needed
  for the caller, then inside the write gate clone the cache, release the
  cache guard, merge/normalize/validate, run one `with_transaction` that
  updates the whole row with `revision + 1` and requires exactly one affected
  row, and replace the cache only after commit. Keep the documented lock
  order; never call back into `SettingsService` from Storage callbacks.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands` and `cargo test --manifest-path src-tauri/Cargo.toml
  --lib settings::`

  Expected: All settings integration and unit tests pass, including restart
  persistence, atomic rollback, serialized concurrency, and corrupt-row
  rejection.

### Task 4: Expose the three Tauri commands and register them

**Outcome:** The real Tauri routing pipeline serves
`get_settings` from any XWork-created window and serves `update_settings` and
`restore_appearance_defaults` only from `main`, with every database mutation
on a blocking worker under a held `DataReadPermit`.

**Depends On:** Task 3.

**Files:**

- Modify: `src-tauri/src/settings/mod.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Test: `src-tauri/tests/settings_commands.rs`
- Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: `SettingsService` from Task 3, the managed
  `DataMaintenanceGate`, the existing `configure_with_app_data_dir` test
  composition.
- Produces: `get_settings` (no label check; `try_state` miss -> `Unavailable`;
  cache-only clone), `update_settings` (authorize exact `main` -> reject empty
  patch shape with `EmptyPatch` -> `gate.read_permit().await` -> clone service
  -> `spawn_blocking` calling `update`; join error -> `PersistenceFailed`),
  and `restore_appearance_defaults` (authorize -> permit -> blocking restore);
  all generic over `R: Runtime` and matching the `BE-008` signatures
  otherwise. Composition: `setup_settings` reads the managed gate created by
  `setup_projects`, constructs and manages `SettingsService` before any window
  is served, and `app_invoke_handler` registers the three commands.

- [ ] **Step 1: Add the failing command tests**

  Add a MockRuntime application harness to `settings_commands.rs` (mock
  builder, isolated app data dir, `run_iteration`, window helper, and the
  `invoke` request builder copied from the existing Projects harness). Tests:
  `get_settings_returns_default_snapshot_from_main_and_quick_note`;
  `update_settings_rejects_non_main_window_before_database` (Quick Note label
  -> `UnauthorizedWindow` error code, row and revision unchanged);
  `update_settings_applies_patch_and_persists`;
  `restore_appearance_defaults_resets_appearance`; and
  `empty_patch_returns_empty_patch_error`.

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands`

  Expected: The three command tests fail with a Tauri routing error that
  names the missing command (for example `settings::get_settings not found`);
  the service-level tests from Task 3 still pass.

- [ ] **Step 3: Implement the commands and composition**

  Add the three thin commands to `settings/mod.rs` with authorization helpers
  mirroring `authorize_main_caller` in Projects, wire `setup_settings` into
  `configure_app` after `setup_projects`, and append the three commands to
  `app_invoke_handler`. Extend the existing `app_builder.rs` composition
  tests: settings state is managed after setup, shares the managed gate, and
  all three commands answer through routing (the two mutations with a typed
  error for an empty payload, `get_settings` with a snapshot).

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands --test app_builder`

  Expected: All command, routing, and composition tests pass; no native
  dialog, tray, or file-manager integration is touched by the settings paths.

### Task 5: Add the typed owner participant for BE-012

**Outcome:** The future backup/reset coordinator can export, validate, apply,
and reset settings through owned `_in` APIs on a coordinator-owned
transaction, with publication only after commit and no gate or Storage
re-entry.

**Depends On:** Task 3, Task 4.

**Files:**

- Modify: `src-tauri/src/settings/mod.rs`
- Modify: `src-tauri/src/app/data_participants.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Test: `src-tauri/tests/data_management_contract.rs`

**Interfaces:**

- Consumes: `Storage::with_transaction` for the coordinator-side test
  transactions, `DataMaintenanceGate::write_permit`.
- Produces: `SettingsBackupSection { appearance, sidebar,
  notification_settings: None }`, owned `Send + 'static`
  `SettingsRestorePlan` and `SettingsCommittedProjection` types;
  `SettingsService::{export_persisted_settings_in, prepare_settings_restore_in,
  apply_settings_restore_in, reset_settings_in, publish_data_change}` taking
  only `&rusqlite::Transaction` and owned inputs; `SettingsDataParticipant`
  adapting those methods plus `publish_after_commit` exactly like
  `ProjectsDataParticipant`; the participant is managed in `setup_settings`.

- [ ] **Step 1: Add the failing contract tests**

  Extend `data_management_contract.rs` with settings fixtures and tests:
  `settings_export_reads_persisted_section_under_shared_transaction`
  (notification section is `None` in Phase 1);
  `settings_owner_apis_work_while_write_permit_is_held` (proves no gate
  re-entry); `settings_restore_prepare_rejects_invalid_section_without_writes`;
  `settings_coordinator_rollback_publishes_nothing`;
  `settings_commit_publishes_prepared_projection` (observable through
  `snapshot()`); `settings_reset_writes_default_row`; and
  `settings_mutation_is_blocked_by_write_permit` (poll/timeout pattern copied
  from the Projects tests, then completion after release).

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  data_management_contract`

  Expected: Compilation fails with unresolved `SettingsDataParticipant` (or
  the `_in` method names), proving the owner seam does not exist.

- [ ] **Step 3: Implement the owner seam**

  Implement the `_in` methods as pure transaction functions: prepare validates
  and builds owned SQL operations plus the committed projection, apply/reset
  execute parameterized SQL and require the singleton row, and
  `publish_data_change` consumes the projection to replace the cache (and,
  from Phase 4 onward, will publish to subscribers). Add the participant
  adapter and manage it in the composition root. Never acquire the
  maintenance gate, the settings write gate, or Storage inside these methods.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  data_management_contract --test app_builder`

  Expected: All maintenance-contract tests pass, including rollback without
  publication, blocked ordinary mutation, and participant management.

### Task 6: Wire shutdown awareness into the quit flows

**Outcome:** Once either quit flow has begun shutdown, new settings commands
observe `Unavailable` while an already-admitted commit may complete.

**Depends On:** Task 4.

**Files:**

- Modify: `src-tauri/src/app/lifecycle.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Test: `src-tauri/tests/settings_commands.rs`

**Interfaces:**

- Consumes: `SettingsService::begin_shutdown`, `AppHandle::try_state`,
  `AppLifecycleState` quit transitions.
- Produces: one `#[doc(hidden)]` composition helper in `app/mod.rs` (for
  example `notify_settings_shutdown<R: Runtime>(app: &AppHandle<R>)`) called
  from `request_quit` in the `QuitFlow::ProceedShutdown` branch and from
  `confirm_quit` immediately after a successful `begin_confirm_quit`.

- [ ] **Step 1: Add the failing wiring test**

  Add `quit_shutdown_notifies_settings_service` to `settings_commands.rs`: it
  builds the mock application, runs setup, calls the new composition helper,
  and asserts `snapshot()` and `update()` return `Unavailable` while the
  database row is unchanged.

- [ ] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands quit_shutdown_notifies_settings_service`

  Expected: Compilation fails with `cannot find function
  notify_settings_shutdown` (or the chosen exact helper name) in
  `xwork_lib::app`.

- [ ] **Step 3: Implement the minimal wiring**

  Add the documented helper that no-ops when `SettingsService` is not managed,
  and call it from the two quit branches named above. Do not change quit
  authorization, dialogs, exit codes, or any lifecycle DTO.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  settings_commands --test app_lifecycle`

  Expected: The new test passes and every existing lifecycle test still
  passes, proving the wiring is inert without managed settings state.

### Task 7: Generate the settings TypeScript binding

**Outcome:** `src/bindings/settings.ts` is the single generated aggregate for
the complete Phase 1 settings contract, and the contract test fails whenever
the committed file drifts from the Rust types.

**Depends On:** Task 4 (final DTO surface), Task 5 (no DTO change expected).

**Files:**

- Modify: `src-tauri/tests/export_bindings.rs`
- Create (generated only): `src/bindings/settings.ts`

**Interfaces:**

- Consumes: the public DTOs and `SettingsError` from `settings/mod.rs`, the
  existing `assert_binding_is_current` helper.
- Produces: `generated_settings_binding()` exporting, in stable order:
  `InterfaceLanguageDto`, `ThemeModeDto`, `ThemePresetDto`,
  `InterfaceColorsDto`, `InterfaceThemeColorsDto`, `TerminalPaletteDto`,
  `GeneralSettingsDto`, `AppearanceSettingsDto`, `SidebarSettingsDto`,
  `AppSettingsDto`, `AppearanceSettingsPatchDto`,
  `SidebarSettingsPatchDto`, `UpdateSettingsDto`, and `SettingsError`, written
  to `binding_path(&["settings.ts"])`.

- [ ] **Step 1: Add the failing binding test**

  Add `settings_binding_matches_rust_contract` with the export list above.

- [ ] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  export_bindings settings_binding_matches_rust_contract`

  Expected: The first run writes `src/bindings/settings.ts` and fails with
  `bindings were regenerated; rerun the test to verify a clean output`.

- [ ] **Step 3: Confirm the generated output**

  Inspect the generated file for camelCase fields, snake_case enum literals,
  optional patch fields, the revision string field, and the absence of every
  notification type. Never edit the file manually; adjust the Rust types and
  regenerate instead.

- [ ] **Step 4: Verify the task**

  Run the Step 2 command a second time, then
  `rg -n "AppSettingsDto|UpdateSettingsDto|SettingsError" src --glob
  "!src/bindings/**"`

  Expected: The rerun passes against the clean generated output, and no
  handwritten duplicate of the settings contract exists outside
  `src/bindings/`.

## Final Verification

Run on Windows after all tasks are complete. Frontend gates are regression
gates because this plan intentionally changes no frontend source.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | Pass with no formatting diff |
| Frontend lint | `pnpm lint` | Pass with no errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Frontend tests | `pnpm test` | All existing unit/component tests pass |
| Frontend build | `pnpm build` | Production build succeeds |
| Rustfmt | `pnpm format:rust` | No formatting diff |
| Clippy | `pnpm lint:rust` | Pass with all warnings denied |
| Rust tests | `pnpm test:rust` | Every target passes, including `settings_commands`, `data_management_contract`, `export_bindings`, `app_builder`, `app_lifecycle`, and `projects_commands` |
| Windows Tauri build | `pnpm tauri build` | Build succeeds with the new commands and migration |
| No Phase 4 scaffolding | `rg -n "NotificationSettings|notifications" src-tauri/src/settings src/bindings/settings.ts` | No matches |
| No handwritten binding | `rg -n "AppSettingsDto|UpdateSettingsDto" src --glob "!src/bindings/**"` | No matches |

### Targeted Windows Verification Notes

The automated integration targets are the primary Windows checks for this
backend-only slice. After `pnpm tauri build`, launch the built application
once from a disposable Windows user profile and confirm normal startup plus
the existing Home/Projects behavior. No Settings UI exists yet, so no theme or
sidebar behavior is claimed; the observable native checks are startup with the
migrated database and unchanged existing windows. This is a targeted manual
smoke check, not an automated desktop end-to-end test.

## Plan Review Gate

- [x] No new dependency is introduced; the plan names the existing exact pins
  and verifies the already-enabled Tokio `sync` feature instead.
- [x] Every named test file is selected explicitly by a focused or final
  command, and every red step fails on a named missing symbol, routing error,
  or assertion rather than passing with zero matching tests.
- [x] Every database-touching test uses its own `TempDir` storage or the
  MockRuntime isolated app data directory; no test reads real app data,
  credentials, or the development checkout.
- [x] Corrupt rows, SQLite failure (dropped table), maintenance write permits,
  coordinator rollback, concurrent patches, unauthorized windows, empty
  patches, and shutdown each have an explicit injection mechanism and an
  observable result.
- [x] Final Rust commands include `--all-targets --all-features` via
  `pnpm lint:rust`, Clippy denies warnings, frontend regression gates run, and
  the Windows Tauri build is required.
- [x] No generated file is hand-edited, no migration is modified after
  release, no frontend source is planned, and no Git commit step is present.
- [x] Phase 4 notification behavior, macOS validation, and all user-visible
  Stage 6 frontend behavior are explicitly deferred rather than claimed
  complete.

## Deviations and Decisions

- The settings capability stays in one `settings/mod.rs` (per the `BE-008`
  file table and the Project Structure no-premature-splitting rule) instead of
  copying the Projects multi-file layout.
- Shutdown `Unavailable` is implemented with an `AtomicBool` flag on the
  service, read at operation entry, and notified from the two existing quit
  commands through `AppHandle::try_state`; the spec fixes the behavior, not
  the mechanism, and this choice keeps lifecycle tests hermetic.
- `spawn_blocking` join failures map to `PersistenceFailed`.
- `reset_settings_in` writes the first-run default row including
  `revision = 0`; revisit together with the `BE-012` coordinator plan.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

Pending implementation.

When complete, summarize the delivered result, verification evidence, and any
remaining limitations.
