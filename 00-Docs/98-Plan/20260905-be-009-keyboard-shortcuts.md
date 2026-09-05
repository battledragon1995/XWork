# BE-009 Keyboard Shortcuts Implementation Plan

**Status:** Draft

**Goal:** Implement the Phase 1 `BE-009` backend contract: append migration
version 4, provide the typed 18-action shortcut catalog with per-OS defaults,
persist only user overrides, project conflicts from an in-memory snapshot,
expose four narrowly scoped Tauri commands plus the typed `_in` owner seam for
`BE-012`, and generate the TypeScript binding from Rust.

**Completion Criteria:**

- A fresh database migrates to schema version 4 with the exact
  `keyboard_shortcut_overrides` layout, contains no default rows, and
  overrides survive a restart while orphan rows of unknown actions are
  preserved but never returned in a snapshot.
- The snapshot contains exactly the 18 Phase 1 actions in catalog order with
  the documented labels/defaults, no duplicate action IDs, no duplicate
  defaults, and neither `quick_note.open_global` nor `files.toggle_explorer`.
- `set_keyboard_shortcut` validates the action ID, key-code allowlist,
  modifier rule, and OS-reserved combos before touching the database; it
  upserts a real change, deletes the row when the chord returns to its
  default, and treats an identical current chord as a no-op that writes
  nothing and publishes nothing.
- Every member of a fingerprint group of two or more actions lists all other
  member IDs in `conflicts_with` (catalog order) and has
  `is_dispatchable = false`; conflicting assignments still commit and survive
  restart; resolving the group by changing or resetting one action re-enables
  the rest.
- `reset_keyboard_shortcut` deletes only its target row;
  `reset_all_keyboard_shortcuts` deletes every row including orphans and
  returns the conflict-free default snapshot; both are successful no-ops on
  empty state without writing the database.
- Only the `main` window may mutate; reads come from the cache without SQLite
  I/O; a commit failure leaves the database, cache, and returned snapshot
  unchanged; every persistent mutation holds one `DataReadPermit` from before
  the write gate until after commit and cache publication.
- The typed `_in` APIs run only on a coordinator-owned transaction without
  re-entering the gate, write gate, or `Storage`; a coordinator rollback
  publishes nothing; a commit publishes the prepared projection; a held
  maintenance write permit blocks ordinary mutations.
- A corrupt row of a known action fails startup with
  `CorruptStoredShortcut` instead of silently resetting; commands return
  `Unavailable` after shutdown begins or when a service lock is poisoned.
- `src/bindings/keyboard-shortcuts.ts` is generated only by the binding
  contract test and has no handwritten duplicate under `src/`.
- All Rust quality gates with warnings denied, the frontend regression gates,
  and the Windows Tauri build pass. No automated desktop end-to-end test is
  added.

**Architecture:** A new `settings/keyboard_shortcuts.rs` module owns the
catalog constants, DTOs, validation, repository SQL, conflict projection,
`KeyboardShortcutsService`, and four thin commands, re-exported from
`settings/mod.rs` next to the `BE-008` settings contract. The catalog and its
defaults are compile-time typed constants; SQLite stores only overrides, so
future catalog additions need no migration or seed rows. The service mirrors
the established `BE-008` locking shape: one standard-library write gate, one
`RwLock` cache, and the fixed order `DataMaintenanceGate` read permit →
shortcut write gate → `Storage`; blocking SQLite work runs inside
`tauri::async_runtime::spawn_blocking`, and only the owned permit crosses an
`.await`. A `KeyboardShortcutsDataParticipant` adapts the typed `_in` owner
APIs for the future `BE-012` coordinator without exposing the table.

**Tech Stack:** No new dependency. Rust `1.98.0` (Edition `2024`), Tauri
`2.11.5`, Tokio `1.53.1` (`sync` already enabled), rusqlite `=0.40.2`
(`bundled`), Serde `1.0.229`, ts-rs `12.0.1`; windows-sys `0.61.2` remains
the only Windows-targeted native crate and is not needed for shortcut logic.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 10 (backend portion);
  stage 6 is the completed settings prerequisite.
- Stack and placement: `00-Docs/00-Overview/01-TechStack.md`,
  `00-Docs/00-Overview/02-ProjectStructure.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §§5.2,
  9.1–9.2, 12.3, and 17.4.
- Primary contract: `00-Docs/03-Backend/BE-009-keyboard-shortcuts.md`
  (catalog table, DTOs, commands, invariants 1–17, error table, test table).
- Consumed contracts: `00-Docs/03-Backend/BE-002-storage-foundation.md`
  (`Storage::with_connection`/`with_transaction`, migration registry);
  `00-Docs/03-Backend/BE-008-settings-persistence.md` (settings capability
  placement, maintenance-gate pattern, shutdown pattern; migration ordering
  only); `00-Docs/03-Backend/BE-012-backup-and-reset.md` (typed participant
  expectations: `export_overrides_in`, `prepare_replace_overrides_in`,
  `apply_replace_overrides_in`, `reset_overrides_in`, `publish_data_change`).
- Migration ordering only: `BE-003` and `BE-006` (versions 1 and 3 precede
  version 4); `BE-009` never calls their capabilities.
- Frontend boundary: `00-Docs/02-Frontend/00-Overview.md`, the `FE-014`
  entry. `FE-014` has no specification file in the repository at plan
  creation; this is a backend-only plan.
- Wireframe (final-product reference only):
  `00-Docs/01-Wireframe/02-AppShell.html`, `#settings-shortcuts`.
- Implementation baseline: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
  `rust-toolchain.toml`, `package.json`,
  `src-tauri/src/{lib.rs,storage/migrations.rs,settings/mod.rs,app/mod.rs,app/lifecycle.rs,app/data_participants.rs,shared/maintenance.rs}`,
  `src-tauri/tests/{app_builder.rs,settings_commands.rs,cli_profiles_contract.rs,projects_commands.rs,data_management_contract.rs,export_bindings.rs}`,
  and `src/bindings/`.

## Scope

**In Scope:**

- Migration `0004_create_keyboard_shortcuts.sql` and registry version 4, plus
  updating the existing schema-version assertions and future-database
  fixtures.
- The typed Phase 1 catalog (18 actions, English labels, categories, defaults,
  scope `application`), `KeyboardEvent.code` allowlist, modifier rule, and
  Windows/macOS reserved-combo rejection.
- Public DTOs and `KeyboardShortcutsError` with the exact serde/ts-rs shapes
  from `BE-009`.
- `KeyboardShortcutsService`: startup hydration and validation, in-memory
  conflict-projected snapshot cache, serialized ordinary mutations, no-op
  semantics, reset one/all, shutdown flag, and poison-to-`Unavailable`
  mapping.
- Typed `_in` owner APIs (`export_overrides_in`,
  `prepare_replace_overrides_in`, `apply_replace_overrides_in`,
  `reset_overrides_in`, `publish_data_change`) and
  `KeyboardShortcutsDataParticipant` in `app/data_participants.rs`.
- Four Tauri commands (`get_keyboard_shortcuts`, `set_keyboard_shortcut`,
  `reset_keyboard_shortcut`, `reset_all_keyboard_shortcuts`),
  composition-root registration, managed state, shared `DataMaintenanceGate`,
  and shutdown notification from the two existing quit flows.
- Generated `src/bindings/keyboard-shortcuts.ts` through the existing
  `export_bindings.rs` contract-test mechanism.
- Unit, integration, maintenance-contract, composition, and binding-contract
  tests listed in the `BE-009` test table.

**Out of Scope:**

- All frontend work: the `FE-014` specification and implementation, key
  capture, action dispatch, recorder UI, conflict copy, glyph rendering, and
  any `src/lib/ipc/keyboard-shortcuts.ts` wrapper. Application-shell and
  feature-owned dispatch wiring is also deferred to the frontend slice.
- Phase 3 Quick Note behavior: `quick_note.open_global`,
  `KeyboardShortcutsService::subscribe`, the internal Tokio watch channel,
  OS registration, and all `BE-017`/`BE-001` integration.
- The future `files.toggle_explorer` catalog entry and anything owned by
  `BE-013`.
- The `BE-012` coordinator itself; only the typed owner seam is produced.
- New Tauri plugins or capability permissions (notably any global-shortcut
  plugin), tray changes, Quick Note window work, dependency changes, macOS
  validation, release packaging, and Git commits.

## Global Constraints

The following project rules apply to every task:

> Keep OS access, persistence, terminal processes, and business rules in
> Rust; the React frontend communicates with them through narrowly scoped
> Tauri commands and events.

> Every function, method, callback, test, and helper must have a short
> comment describing its purpose. Write code, identifiers, and code comments
> in English.

> During development, build and test only on Windows. Defer macOS validation
> until release preparation.

- Lockfile-locked, exact-pinned versions from `01-TechStack.md`; this plan
  adds no dependency.
- Migration files are only ever added, never modified
  (`02-ProjectStructure.md`).
- Generated bindings under `src/bindings/` are never edited manually
  (`02-ProjectStructure.md`, `BE-009`).
- Tauri commands stay thin: authorize, parse, and call the capability; no SQL
  or business rules in commands (`02-ProjectStructure.md`).
- Backend capabilities never read another capability's internals; the `app`
  module composes them (`02-ProjectStructure.md`).
- Accept no path, script, command string, or display-format key sequence from
  the frontend; every SQL statement uses bind parameters; mutations come only
  from the `main` window (`BE-009` security constraint).
- Lock order is fixed: `DataMaintenanceGate` read permit → Keyboard Shortcuts
  write gate → `Storage`; owner `_in` callbacks never re-enter the gate, the
  write gate, or `Storage` (`BE-009` invariant 17).
- Log only the operation, stable `action_id`, conflict count, and error code;
  never log labels, full snapshots, user chords, or raw persistence errors
  (`BE-009` invariant 16).
- Snapshot and conflict projection must be O(n) via a fingerprint hash map;
  `get_keyboard_shortcuts` performs no SQLite I/O (`BE-009` performance
  constraint).
- Phase 1 adds no plugin, permission, window, or tray item (`BE-009` desktop
  boundary).

## Assumptions, Risks, and Blockers

**Assumptions and repository findings:**

- `BE-009` has no open specification questions, so this plan may be written
  now. Writing it does not authorize implementation; source changes start
  only when the user requests them.
- The `BE-009` file table names `src-tauri/src/bin/export_bindings.rs`, but
  the repository generates bindings through
  `src-tauri/tests/export_bindings.rs` (`export_to_string` plus a
  regenerate-once contract test). This plan follows the implemented
  mechanism, as the `BE-008` plan did, and creates no new binary target.
- Commands are generic over `R: Runtime` (matching every existing command) so
  the `MockRuntime` harness can route them; the documented IPC contract is
  unchanged. `get_keyboard_shortcuts` takes no window parameter, so any
  XWork-created window can read the cached snapshot; only the three mutation
  commands authorize the `main` label.
- Service-level operation names are not fixed by the specification. This plan
  mirrors `BE-008`: `KeyboardShortcutsService::new(storage, gate)`,
  `snapshot`, `set_shortcut`, `reset_shortcut`, `reset_all` (each acquiring
  its own read permit for service-level tests), `*_admitted` variants called
  by commands under a command-owned permit, `begin_shutdown`, and
  `shares_gate_with` for composition tests.
- Startup decode/validate for a stored row of a known action means: boolean
  columns decode to `0`/`1`, `key_code` is on the canonical allowlist, and
  the modifier rule holds. OS-reserved combos do not fail startup: the
  `primary` modifier is deliberately cross-OS per `BE-009`, and a persisted
  override that is reserved on another OS must not poison this startup. A
  failed decode returns `CorruptStoredShortcut { action_id }` and fails
  composition before the service is managed.
- `spawn_blocking` join failures (cancellation or worker panic) map to
  `PersistenceFailed`, matching the decision recorded for `BE-008`.
- The reserved-combo check is implemented per-OS with
  `#[cfg(windows)]`/`#[cfg(target_os = "macos")]` branches, both compiled for
  their target; only the Windows branch is executed during development, per
  the repository's Windows-only validation rule.
- `BE-012` is not implemented yet. As with Settings and CLI Profiles, the
  participant is constructed and managed now, and the maintenance tests drive
  the typed `_in` APIs directly through `Storage::with_transaction`, which is
  the coordinator-shaped seam the future service will use.
- Conflict semantics follow the fixed decision: conflicting assignments
  commit; no action silently wins; every group member becomes
  non-dispatchable until the user changes or resets it.
- The catalog is a `const` slice in declaration order; snapshot order equals
  catalog order and `conflicts_with` order follows it, which satisfies the
  ordering rules without a runtime sort.

**Risks and mitigation:**

- Bumping the registry to version 4 breaks version assertions and
  future-database fixtures. Task 1 updates exactly the verified occurrences:
  `app_builder.rs` (two `schema_version == 3` assertions at lines 158/247 and
  two `user_version = 4` future fixtures at lines 187/521, which become 5),
  `cli_profiles_contract.rs` (lines 179/422/476), `projects_commands.rs`
  (lines 183/223), and `settings_commands.rs` (line 80).
- Holding the wrong lock across a blocking call can deadlock. Tasks 3–5 copy
  the proven `BE-008` shape: clone the service and gate before awaiting,
  never hold a `State` borrow, cache guard, or SQLite transaction across
  `.await`, and keep only the owned permit alive across the blocking task.
- Conflict projection can drift from the persistence rules. Task 2 proves the
  pure projection for groups of two and three actions and Task 3 proves the
  same groups round-trip through SQLite and restart.
- Validation-before-database and rollback claims can be false positives if
  tested only on the happy path. Task 3 uses a dropped-table fixture to prove
  invalid chords fail with their typed validation error while valid chords
  fail with `PersistenceFailed`, and that the cache and returned snapshot
  stay unchanged after the failure.
- Concurrent mutations could interleave candidate snapshots. The write gate
  serializes mutations; Task 3 exercises two concurrent writers and asserts
  both commit and the final snapshot contains both overrides.

**Blockers:** None for drafting or executing the backend scope. The missing
`FE-014` specification and implementation block the frontend integration
checks of stage 10 (IPC wrapper, recorder, dispatcher, and the final build
against real frontend integration), not the backend tasks in this plan.

## Dependency Order

1. Migration `0004` and registry version 4 → enable every shortcut task and
   the updated schema-version assertions.
2. Catalog, DTOs, and pure validation/projection → enable the service,
   commands, participant, and bindings.
3. Repository, service hydration, and serialized mutations → enable commands
   and the owner seam.
4. Typed `_in` owner APIs and `KeyboardShortcutsDataParticipant` → enable the
   maintenance-contract tests and composition wiring.
5. Commands, composition-root registration, and shutdown wiring → enable the
   command-level integration and composition tests.
6. Generated `keyboard-shortcuts.ts` binding → complete the public contract
   and final verification.

---

### Task 1: Register the keyboard-shortcut override migration

**Outcome:** A fresh XWork database migrates to schema version 4 and contains
an empty `keyboard_shortcut_overrides` table whose columns and checks match
`BE-009` exactly.

**Depends On:** None.

**Files:**

- Create: `src-tauri/migrations/0004_create_keyboard_shortcuts.sql`
- Modify: `src-tauri/src/storage/migrations.rs`
- Create: `src-tauri/tests/keyboard_shortcuts_contract.rs`
- Modify: `src-tauri/tests/app_builder.rs`
- Modify: `src-tauri/tests/cli_profiles_contract.rs`
- Modify: `src-tauri/tests/projects_commands.rs`
- Modify: `src-tauri/tests/settings_commands.rs`

**Interfaces:**

- Consumes: `Storage::open`, the existing `MIGRATIONS` registry and
  `run_migrations` validation.
- Produces: the `keyboard_shortcut_overrides` table consumed by every later
  task; schema version 4.

- [ ] **Step 1: Add the failing migration test**

  Create `keyboard_shortcuts_contract.rs` with a `TempDir`-isolated
  `Storage::open` harness (mirroring `settings_commands.rs`) and the test
  `keyboard_shortcuts_migration_creates_empty_override_table`. It asserts
  `user_version = 4`, reads the column list with `PRAGMA table_info`, asserts
  the five columns with their types and the `action_id` primary key, proves
  the checks by inserting `alt_modifier = 2` (fails), `key_code = ''` (fails),
  a 65-character `action_id` (fails), and one valid row then deleting it, and
  finally asserts the fresh table holds zero rows (no default seed).

- [ ] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  keyboard_shortcuts_contract`

  Expected: `keyboard_shortcuts_migration_creates_empty_override_table` fails
  on the schema-version assertion with `left: 3, right: 4` (or on the first
  table read with `no such table: keyboard_shortcut_overrides`).

- [ ] **Step 3: Add the migration and update stale version expectations**

  Add `0004_create_keyboard_shortcuts.sql` byte-equivalent to the `BE-009`
  SQL block (`CREATE TABLE keyboard_shortcut_overrides (...)` with the four
  `CHECK` constraints and no seed rows). Append `Migration { version: 4,
  name: "create_keyboard_shortcuts", sql: include_str!(...) }` to
  `MIGRATIONS`. Change the nine version assertions listed under Risks from 3
  to 4, and change the two future-database fixtures in `app_builder.rs` from
  `user_version = 4` to `user_version = 5` so they remain newer than the
  supported ceiling.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  keyboard_shortcuts_contract --test app_builder --test
  cli_profiles_contract --test projects_commands --test settings_commands`

  Expected: all five targets pass, including the new migration test and the
  two updated future-database rejections.

### Task 2: Build the catalog, DTOs, and pure validation/projection

**Outcome:** `settings/keyboard_shortcuts.rs` compiles with the complete
Phase 1 DTO contract, the 18-action catalog, the key-code allowlist, the
modifier and reserved-combo rules, and the merge/fingerprint projection, all
proven by unit tests before any service or SQL exists.

**Depends On:** None (may proceed in parallel with Task 1).

**Files:**

- Create: `src-tauri/src/settings/keyboard_shortcuts.rs` (with a
  `#[cfg(test)] mod tests`)
- Modify: `src-tauri/src/settings/mod.rs` (declare
  `pub mod keyboard_shortcuts;` and re-export the types created by this
  task; extend the re-exports in Tasks 3 and 5)

**Interfaces:**

- Consumes: `serde`, `ts_rs::TS`.
- Produces: `ShortcutChordDto`, `ShortcutCategoryDto`, `ShortcutScopeDto`,
  `KeyboardShortcutActionDto`, `KeyboardShortcutsDto`,
  `SetKeyboardShortcutInputDto` (`deny_unknown_fields`) with the exact
  derives/renames from `BE-009` and `#[ts(export_to =
  "keyboard-shortcuts.ts")]`; the `KeyboardShortcutsError` enum with
  `Display`, `std::error::Error`, `From<StorageError>`, and
  `From<rusqlite::Error>`; the `const` catalog; pure helpers for the key-code
  allowlist, modifier rule, per-OS reserved combos, candidate merge, and O(n)
  fingerprint conflict projection.

- [ ] **Step 1: Add the failing unit tests**

  In the new module's test module, add tests referencing the missing items by
  name: `catalog_lists_eighteen_actions_in_contract_order` (exact IDs, labels,
  categories, defaults, and `application` scope for all 18 rows from the
  `BE-009` table, including `panes.split_down` = `Primary+Alt+Backslash`),
  `catalog_ids_and_defaults_are_unique`,
  `phase_one_catalog_omits_future_actions` (no `quick_note.open_global`, no
  `files.toggle_explorer`),
  `key_code_allowlist_accepts_canonical_codes_and_rejects_typos` (`KeyA`/
  `KeyZ`, `Digit0`/`Digit9`, `F1`/`F12`, and the named codes accepted;
  `keya`, `Keya`, `F13`, `Digit10`, the empty string, and a 33-character code
  rejected with `InvalidKeyCode`),
  `modifier_rules_require_primary_or_alt_except_function_keys` (`KeyA` with
  no modifier → `ModifierRequired`; `F5` alone is valid; `Backslash` with
  only `shift` → `ModifierRequired`),
  `windows_reserved_combos_are_rejected` (`Alt+F4` and `Primary+Alt+Delete`
  → `ReservedShortcut`; `Shift+Alt+F4` and `Primary+Alt+Backspace` are not
  reserved), `merge_overrides_project_conflict_groups` (override maps
  producing a two-action and a three-action group: mutual `conflicts_with` in
  catalog order, `is_dispatchable = false` for every member, `is_custom`
  reflecting `current != default`, and a singleton group with an empty list
  and `is_dispatchable = true`), `unknown_action_is_rejected`
  (`ActionNotFound { action_id }`), and
  `identical_current_chord_is_a_noop` (the pure planner returns "no database
  operation" for a candidate equal to the current chord).

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib
  settings::keyboard_shortcuts`

  Expected: compilation fails with unresolved-name errors for the missing
  catalog constants, DTO types, and helpers named by the tests (the module is
  discovered because `mod.rs` already declares it), not a zero-test run.

- [ ] **Step 3: Implement the minimum typed surface**

  Define the DTOs and error with the specified derives, the `const` catalog
  slice in contract order, the allowlist (generated `KeyA`–`KeyZ` and
  `Digit0`–`Digit9` plus the named-code list), the modifier rule with the
  F1–F12 exception, cfg-gated reserved-combo predicates for Windows and
  macOS, and pure merge/projection helpers that build
  `KeyboardShortcutActionDto` values and group them with a hash map keyed by
  `(primary, alt, shift, key_code)`. Add a short purpose comment to every
  item.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib
  settings::keyboard_shortcuts`

  Expected: the new unit tests pass; the module compiles with no dead code
  beyond items consumed by later tasks (gate them with `#[allow(dead_code)]`
  only if Clippy requires it before Task 3 lands, and remove the allowance in
  Task 3).

### Task 3: Add the repository, service hydration, and serialized mutations

**Outcome:** `KeyboardShortcutsService` hydrates and validates persisted
overrides once, serves snapshots from cache, and executes set/reset/reset-all
atomically under the fixed lock order with the documented no-op, conflict,
restart, and failure semantics.

**Depends On:** Tasks 1 and 2.

**Files:**

- Modify: `src-tauri/src/settings/keyboard_shortcuts.rs`
- Test: `src-tauri/tests/keyboard_shortcuts_contract.rs`

**Interfaces:**

- Consumes: `Storage::with_connection`/`with_transaction`,
  `DataMaintenanceGate::read_permit`, `DataReadPermit`, the Task 2 types.
- Produces: `KeyboardShortcutsService::{new, snapshot, set_shortcut,
  set_shortcut_admitted, reset_shortcut, reset_shortcut_admitted, reset_all,
  reset_all_admitted, begin_shutdown, shares_gate_with}`; internal repository
  functions using bind parameters only; owned cache/projection state.

- [ ] **Step 1: Add the failing service-level integration tests**

  Extend `keyboard_shortcuts_contract.rs` with a `TempDir`-isolated `Storage`
  + `DataMaintenanceGate` harness and tests:
  `startup_returns_the_default_snapshot_from_an_empty_table`;
  `set_persists_override_and_survives_restart` (override present,
  `is_custom` true, a second `KeyboardShortcutsService::new` on the same
  directory returns it); `set_to_the_default_chord_deletes_the_row` (row
  count returns to zero); `setting_the_current_chord_is_a_database_noop`
  (row count and snapshot unchanged);
  `conflicting_assignments_commit_and_round_trip` (two then three actions on
  one fingerprint; all members mutually listed and non-dispatchable; survives
  restart); `reset_one_removes_only_its_target_and_releases_the_group` (the
  remaining member becomes dispatchable);
  `reset_all_removes_orphans_and_returns_conflict_free_defaults` (insert an
  orphan row with raw SQL first); `corrupt_known_row_fails_startup`
  (raw-update a known row to `key_code = 'Nope'`; `new` returns
  `Err(CorruptStoredShortcut { action_id })`);
  `unknown_action_rows_are_preserved_but_hidden` (snapshot stays at 18
  actions and the row survives later set/reset operations);
  `validation_rejects_before_database_access` (drop the table with raw SQL;
  an invalid chord still returns `InvalidKeyCode`/`ModifierRequired`/
  `ReservedShortcut`, while a valid chord returns `PersistenceFailed`);
  `commit_failure_keeps_cache_and_snapshot_unchanged` (dropped-table
  fixture; the returned error is `PersistenceFailed` and `snapshot()` still
  returns the previous state);
  `concurrent_writers_serialize_through_the_write_gate` (two threads set
  different actions; both succeed and the final snapshot contains both
  overrides). Add the `Unavailable` poison test inside the module's
  `#[cfg(test)]` (poison the cache and the write gate with `catch_unwind`
  exactly as the settings module does).

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  keyboard_shortcuts_contract`

  Expected: compilation fails on the missing `KeyboardShortcutsService`
  methods named by the harness (for example `no function or associated item
  named 'new' found`), while the Task 1 migration test still compiles and
  passes.

- [ ] **Step 3: Implement the service and repository**

  Implement `KeyboardShortcutsServiceInner { storage, gate, write_gate:
  Mutex<()>, cache: RwLock<...>, shutting_down: AtomicBool }` mirroring
  `BE-008`. `new` reads all rows once via `with_connection`, decodes booleans
  and codes, keeps unknown-action rows out of the cache, and fails on a
  corrupt known row before returning. Admitted mutations take the write gate,
  clone the override map, run candidate validation/projection, then execute
  the single upsert/delete (or full delete) inside `with_transaction`, and
  replace the cache only after commit. `set` computes delete-on-default and
  identical-current no-ops before opening a transaction. All SQL uses bind
  parameters; errors map through the `From` impls; poison maps to
  `Unavailable`.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  keyboard_shortcuts_contract`

  Expected: every test in the target passes, including restart, conflict
  round-trip, no-op, orphan, corrupt-row, rollback, and concurrency cases.

### Task 4: Add the typed owner seam and data participant

**Outcome:** The five `BE-012`-facing owner APIs run entirely on a
coordinator-owned transaction, produce owned `Send + 'static` plans and
projections, publish only after commit, and are adapted by a managed
`KeyboardShortcutsDataParticipant`; a held write permit blocks ordinary
mutations.

**Depends On:** Task 3.

**Files:**

- Modify: `src-tauri/src/settings/keyboard_shortcuts.rs`
- Modify: `src-tauri/src/app/data_participants.rs`
- Test: `src-tauri/tests/data_management_contract.rs`

**Interfaces:**

- Consumes: `rusqlite::Transaction`, `Storage::with_transaction`,
  `DataMaintenanceGate::write_permit`, the Task 3 service.
- Produces: `ShortcutOverride`, `ShortcutOverridesImportPlan`,
  `KeyboardShortcutsCommittedProjection`;
  `KeyboardShortcutsService::{export_overrides_in,
  prepare_replace_overrides_in, apply_replace_overrides_in,
  reset_overrides_in, publish_data_change}`;
  `KeyboardShortcutsDataParticipant::{new, export, prepare_replace,
  apply_replace, apply_reset, publish_after_commit}`.

- [ ] **Step 1: Add the failing maintenance-contract tests**

  Extend `data_management_contract.rs` following the existing Settings/CLI
  Profiles patterns:
  `shortcuts_owner_apis_work_while_write_permit_is_held` (hold
  `write_permit()`; export/prepare/apply/reset still run on a caller-owned
  transaction because they never touch the gate);
  `shortcuts_prepare_rejects_unknown_duplicate_and_invalid_overrides`
  (unknown action → `ActionNotFound`; duplicate `action_id` and an invalid
  chord → typed errors, with no writes applied);
  `shortcuts_coordinator_rollback_publishes_nothing` (prepare + apply inside
  a transaction that rolls back; `publish_data_change` is never called and
  `snapshot()` is unchanged);
  `shortcuts_commit_publishes_prepared_projection` (commit, then publish
  once; the cache returns the replaced overrides and their conflict
  projection); `shortcuts_reset_clears_all_rows_including_orphans` (orphan
  row inserted; `reset_overrides_in` + commit + publish returns the default
  conflict-free snapshot and an empty table);
  `shortcuts_mutation_is_blocked_by_write_permit` (hold the write permit,
  start `set_shortcut`, observe it pending with the existing poll-once
  helper, release the permit, and observe completion); and
  `assert_owned_and_sendable` instantiations for `ShortcutOverride`,
  `ShortcutOverridesImportPlan`, and `KeyboardShortcutsCommittedProjection`.

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  data_management_contract shortcuts_`

  Expected: compilation fails on the missing `ShortcutOverride`,
  `ShortcutOverridesImportPlan`, `KeyboardShortcutsCommittedProjection`,
  owner methods, and participant type named by the new tests; after the types
  exist, the filter selects the six new `shortcuts_*` tests.

- [ ] **Step 3: Implement the owner seam and participant**

  Implement the five owner APIs exactly as specified: associated functions
  taking `&Transaction<'_>`; `prepare_replace_overrides_in` rejects unknown
  actions, duplicate IDs, and invalid chords, then builds the complete owned
  row-operation list and committed projection; `apply_replace_overrides_in`
  deletes and inserts the planned rows atomically; `reset_overrides_in`
  deletes every row; `export_overrides_in` returns only persisted non-default
  overrides in catalog order; `publish_data_change` consumes the projection
  into the cache with no failure path. No `_in` path acquires a permit, the
  write gate, or `Storage`. Add the thin `KeyboardShortcutsDataParticipant`
  in `app/data_participants.rs` calling only these public owner APIs.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  data_management_contract`

  Expected: the whole target passes, including the existing Projects,
  Settings, CLI Profiles, and Sessions maintenance tests.

### Task 5: Add commands, composition wiring, and shutdown notification

**Outcome:** The four commands are registered in the shared invoke handler,
enforce the `main`-only mutation boundary and the validation order, hydrate
from the migrated database during setup, share the process gate, return
`Unavailable` after shutdown begins, and the composition exposes managed
service and participant state without any new plugin.

**Depends On:** Tasks 3 and 4.

**Files:**

- Modify: `src-tauri/src/settings/keyboard_shortcuts.rs` (commands and
  `pub(crate)` visibility for the handler)
- Modify: `src-tauri/src/settings/mod.rs` (complete the re-exports)
- Modify: `src-tauri/src/app/mod.rs` (import, `setup_keyboard_shortcuts`,
  managed state, invoke-handler entries, and
  `notify_keyboard_shortcuts_shutdown`)
- Modify: `src-tauri/src/app/lifecycle.rs` (call the notification beside the
  two existing `notify_settings_shutdown` call sites)
- Test: `src-tauri/tests/keyboard_shortcuts_contract.rs`
- Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: the Task 3 service and Task 4 participant; `app_invoke_handler`;
  `tauri::test` routing helpers; the managed `DataMaintenanceGate`.
- Produces: IPC commands `get_keyboard_shortcuts`,
  `set_keyboard_shortcut(actionId, chord) -> KeyboardShortcutsDto`,
  `reset_keyboard_shortcut(actionId) -> KeyboardShortcutsDto`,
  `reset_all_keyboard_shortcuts() -> KeyboardShortcutsDto`; managed
  `KeyboardShortcutsService` and `KeyboardShortcutsDataParticipant`;
  `notify_keyboard_shortcuts_shutdown`.

- [ ] **Step 1: Add the failing command and composition tests**

  In `keyboard_shortcuts_contract.rs`, add a `MockRuntime` app harness
  (mirroring the settings command tests) with a `main` window and a second
  labeled window: `get_returns_the_cached_snapshot_from_any_window` (18
  actions from both windows);
  `mutations_from_a_non_main_window_are_unauthorized_before_database`
  (dropped-table fixture still yields `UnauthorizedWindow`);
  `set_validates_before_persistence` (`ActionNotFound`, `InvalidKeyCode`,
  `ModifierRequired`, and `ReservedShortcut` each returned before database
  access); `set_reset_and_reset_all_round_trip_through_commands` (set two
  conflicting actions, reset one, reset all; persisted row counts verified
  through the managed `Storage`); and
  `commands_return_unavailable_after_shutdown_begins`
  (`notify_keyboard_shortcuts_shutdown`, then the three mutations return
  `Unavailable`). In `app_builder.rs`, extend the command-routing test to
  route `get_keyboard_shortcuts` (success) and the three mutations with an
  empty payload (typed failures, not routing errors), and add
  `keyboard_shortcuts_composition_manages_state_and_participant` (managed
  service and participant exist, `shares_gate_with` the managed
  `DataMaintenanceGate`, and the schema version is 4).

- [ ] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  keyboard_shortcuts_contract --test app_builder`

  Expected: the contract target fails compilation on the missing command
  functions, and the `app_builder` routing assertions fail with the routing
  error for `get_keyboard_shortcuts` (command not registered) before any
  state assertion runs.

- [ ] **Step 3: Implement commands and composition**

  Add the four thin async commands generic over `R: Runtime`. `get` clones
  the managed service and returns `snapshot()`. Each mutation authorizes the
  window label first, clones the service and gate before awaiting, acquires
  the read permit, then runs the matching `*_admitted` call inside
  `spawn_blocking` and maps join failures to `PersistenceFailed`. Register
  the four commands in `app_invoke_handler`. Add `setup_keyboard_shortcuts`
  after `setup_settings` in every `configure_app` path: hydrate from the
  shared storage and gate, manage the participant and service, and fail setup
  on `CorruptStoredShortcut`. Add `notify_keyboard_shortcuts_shutdown` and
  call it beside the two existing settings notifications in `lifecycle.rs`.

- [ ] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  keyboard_shortcuts_contract --test app_builder --test app_lifecycle`

  Expected: all three targets pass, proving command routing, window
  authorization, validation order, shutdown, composition state, and unchanged
  lifecycle behavior.

### Task 6: Generate the TypeScript binding and run final verification

**Outcome:** `src/bindings/keyboard-shortcuts.ts` is generated from the Rust
contract in a stable order, drift fails the contract test, and all project
quality gates plus the Windows Tauri build pass.

**Depends On:** Tasks 2 and 5.

**Files:**

- Modify: `src-tauri/tests/export_bindings.rs`
- Create: `src/bindings/keyboard-shortcuts.ts` (generated only by the test;
  never hand-edited)

**Interfaces:**

- Consumes: the Task 2 DTO/error definitions with `#[ts(export_to =
  "keyboard-shortcuts.ts")]`.
- Produces: `src/bindings/keyboard-shortcuts.ts` for the later `FE-014`
  wrapper; the stable export order `ShortcutChordDto`,
  `ShortcutCategoryDto`, `ShortcutScopeDto`, `KeyboardShortcutActionDto`,
  `KeyboardShortcutsDto`, `SetKeyboardShortcutInputDto`,
  `KeyboardShortcutsError`.

- [ ] **Step 1: Add the failing binding-contract test**

  Add `generated_keyboard_shortcuts_binding()` and
  `keyboard_shortcuts_binding_matches_rust_contract` to
  `export_bindings.rs` using the existing `assert_binding_is_current` helper,
  exporting the seven types in the order above.

- [ ] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  export_bindings keyboard_shortcuts`

  Expected: the test fails once with `bindings were regenerated; rerun the
  test to verify a clean output` after writing the missing
  `src/bindings/keyboard-shortcuts.ts`.

- [ ] **Step 3: Confirm the generated output**

  Inspect the generated file for the exact camelCase fields, snake_case enum
  literals, the tagged `KeyboardShortcutsError` shape, and
  `SetKeyboardShortcutInputDto`; make no manual edits. Rerun the same command
  and expect a pass.

- [ ] **Step 4: Run final verification**

  Execute the full table under Final Verification. Record any material
  deviation below as it happens.

## Final Verification

Run on Windows after all tasks. Frontend gates are regression gates because
this plan intentionally changes no frontend source.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | Pass with no formatting diff |
| Frontend lint | `pnpm lint` | Pass with no errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Frontend tests | `pnpm test` | All existing unit/component tests pass |
| Frontend build | `pnpm build` | Production build succeeds |
| Rustfmt | `pnpm format:rust` | No formatting diff |
| Clippy | `pnpm lint:rust` | Pass with all warnings denied |
| Rust tests | `pnpm test:rust` | Every target passes, including `keyboard_shortcuts_contract`, `data_management_contract`, `export_bindings`, `app_builder`, `app_lifecycle`, `settings_commands`, `cli_profiles_contract`, and `projects_commands` |
| Windows Tauri build | `pnpm tauri build` | Build succeeds with migration 0004 and the four new commands |
| No future actions | `rg -n "quick_note\.open_global\|files\.toggle_explorer" src-tauri/src src/bindings` | No matches |
| No global-shortcut plugin | `rg -ni "global.?shortcut" src-tauri/Cargo.toml src-tauri/capabilities src-tauri/src src-tauri/tauri.conf.json` | No matches |
| No handwritten binding | `rg -n "KeyboardShortcutsDto\|SetKeyboardShortcutInputDto" src --glob "!src/bindings/**"` | No matches |

The `rg` patterns use PowerShell quoting (`\|` for alternation). In POSIX
shells, use a plain `|` instead.

### Targeted Windows Verification Notes

The automated integration targets are the primary Windows checks for this
backend-only slice. After `pnpm tauri build`, launch the built application
once from a disposable Windows user profile and confirm normal startup with
the migrated database and unchanged Home/Projects/Terminal behavior. No
shortcuts UI or dispatcher exists yet, so no keystroke behavior is claimed;
the launch check is a targeted manual smoke check, not an automated desktop
end-to-end test.

## Plan Review Gate

- [x] No new dependency is introduced; the plan names the existing exact pins
  and reuses the already-enabled Tokio `sync` feature.
- [x] Every named test file is selected explicitly by a focused or final
  command, and every red step fails on a named missing symbol, routing error,
  schema-version assertion, regeneration message, or typed assertion rather
  than passing with zero matching tests.
- [x] Every database-touching test uses its own `TempDir` storage or the
  MockRuntime isolated app data directory; no test reads real app data,
  credentials, or the development checkout.
- [x] Corrupt rows, unknown rows, dropped-table SQLite failures, maintenance
  write permits, coordinator rollback, concurrent writes, unauthorized
  windows, invalid chords, reserved combos, no-op writes, and shutdown each
  have an explicit injection mechanism and an observable result.
- [x] Final Rust commands include `--all-targets --all-features` via
  `pnpm lint:rust`, Clippy denies warnings, frontend regression gates run,
  and the Windows Tauri build is required because the plan adds commands and
  a migration.
- [x] No generated file is hand-edited, no migration is modified, no frontend
  source is planned, and no Git commit step is present.
- [x] Phase 3 Quick Note, `files.toggle_explorer`, macOS validation, and all
  user-visible stage 10 frontend behavior are explicitly deferred rather than
  claimed complete.

## Deviations and Decisions

- None.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

Pending implementation.

When complete, summarize the delivered result, verification evidence, and any
remaining limitations.
