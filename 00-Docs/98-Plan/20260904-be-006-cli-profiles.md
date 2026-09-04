# BE-006 CLI Profiles Implementation Plan

**Status:** Implemented

**Goal:** Implement the complete backend-owned `BE-006` contract so XWork can
persist custom CLI profiles and a default shell, synthesize the three immutable
built-in profiles, check command and shell availability without executing
anything, keep secret environment values only in the operating-system
credential store, and expose safe typed contracts to Tauri, Sessions,
Terminal/PTY, and the later Data Management coordinator.

**Completion Criteria:**

- A fresh or existing schema-version-2 database applies
  `0003_create_cli_profiles.sql` atomically, creates exactly the four specified
  tables and singleton default-shell row, and reopens at schema version 3
  without rerunning prior migrations.
- Every snapshot contains `builtin:codex`, `builtin:claude`, and
  `builtin:terminal` first and in that order; the built-ins have no database
  rows and cannot be updated or deleted.
- Custom-profile create, full-replacement update, delete, default-shell
  selection, validation, ordering, persistence, and restart behavior match
  `BE-006`, including literal separation of command, arguments, and
  environment entries.
- A warm cached snapshot at the maximum documented fixture size completes
  within 100 ms on the Windows test host, excluding cold OS discovery.
- Windows command discovery handles absolute paths and an explicitly supplied
  `PATH`/`PATHEXT` snapshot, shell discovery follows the documented fallback
  order, and no availability path executes or shell-expands a candidate.
- Plaintext secret canaries never appear in SQLite, snapshots, generated
  bindings, events, errors, diagnostics, or backup records. Secret reads occur
  only in `resolve_for_launch`, immediately before the future PTY launch, and
  are returned in `Zeroizing<String>` buffers.
- Credential writes happen before the SQLite commit; a failed credential write
  or database transaction leaves the prior committed profile intact, while a
  failed post-commit delete remains durably queued and is retried without
  changing an already successful command result.
- Ordinary persistent mutations and cleanup hold `DataReadPermit` for the
  documented lifetime. A maintenance write permit blocks them, while owner
  `_in` methods use only the coordinator-provided transaction and do not
  reacquire the gate, the service mutation lock, or `Storage`.
- Availability checks use a maximum concurrency of four, discard stale results
  by generation, update only the runtime cache, and publish strictly increasing
  revisions. Missed or failed `cli-profiles://changed` events remain recoverable
  through `get_cli_profiles`.
- `launchability` rechecks the selected profile for `BE-005`, and
  `resolve_for_launch` rechecks command and shell plus reads every required
  secret for `BE-007`; either method fails closed without returning a partial
  launch description.
- Backup export/merge/reset uses the typed BE-006 records, plans, and committed
  projections in one shared transaction; it never reads secret values, handles
  credential-reference collisions, and only publishes cache/subscription state
  after commit.
- All six Tauri commands authorize the exact `main` window before protected
  work, are registered through the existing composition root, and perform
  SQLite, keyring, and command-discovery work on blocking workers.
- `src/bindings/terminal/cli-profiles.ts` is generated from Rust, contains the
  complete public DTO/error/event contract, and has no handwritten duplicate.
- Focused tests, all Rust and frontend regression gates, and the Windows Tauri
  build pass. The native Windows credential test uses only unique test accounts
  and always attempts cleanup; no automated desktop end-to-end test is added.

**Architecture:** `terminal::cli_profiles` owns the BE-006 domain model,
validation, SQL, cache, revision/generation state, credential compensation,
cleanup outbox, internal consumer contracts, event publication, and thin Tauri
commands. `platform::command`, `platform::shell`, and `platform::credential`
own reusable operating-system access and expose injectable ports so tests use
explicit environment snapshots and fake credentials rather than process-global
environment changes or user-owned state. The composition root constructs one
`CliProfilesService` with the existing `Storage` and `DataMaintenanceGate`,
manages it, then starts hydration, cleanup, and bounded availability checks.

Persistent changes follow the lock order `DataMaintenanceGate` read permit ->
CLI Profiles mutation lock -> `Storage`. Secret writes are staged outside the
service lock; once staged, the mutation lock serializes the definitive metadata
read, SQLite commit, cache swap, revision increment, and event ordering. The
lock is not held while waiting for credential I/O or command/shell discovery.
Availability work snapshots a generation, resolves on the blocking pool, then
re-enters the lock and drops stale results. The BE-012 owner path accepts only a
borrowed coordinator transaction and owned plans/projections, so it cannot
silently open a second transaction or publish before commit.

**Tech Stack:** Rust `1.98.0` stable, Cargo `1.98.0`, Rust Edition `2024`,
Tauri `2.11.5`, Tokio `1.53.1` with the existing `sync` feature, rusqlite
`0.40.2` with `bundled`, Serde `1.0.229`, ts-rs `12.0.1`, the existing
`uuid = { version = "=1.26.0", features = ["v4"] }`, and `tempfile =
"=3.27.0"` for isolated tests. Promote the already locked
`serde_json = "=1.0.151"` from dev-only to runtime use for persisted argument
arrays, and add these exact runtime dependencies:

```toml
keyring = { version = "=3.6.3", default-features = false, features = ["apple-native", "windows-native"] }
zeroize = "=1.9.0"
```

The versions and feature sets were checked on 2026-09-04 with `cargo info`.
`keyring 3.6.3` declares Rust `1.75` and provides the synchronous native
Windows/macOS backends used by this contract; disabling defaults avoids pulling
an unrelated Linux secret-service backend. `zeroize 1.9.0` declares Rust
`1.85`. Both are below the pinned Rust `1.98.0`; Task 1 verifies actual Cargo
resolution with the repository manifest and Final Verification proves the
Windows build. macOS runtime validation remains deferred to release
preparation.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 7 (CLI profiles)
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections
  4.1, 5.2-5.4, 8, 10.2-10.3, 17.3, 18, and 20 Phase 1
- Backend spec: `00-Docs/03-Backend/BE-006-cli-profiles.md`
- Backend prerequisites: `00-Docs/03-Backend/BE-002-storage-foundation.md`,
  `00-Docs/03-Backend/BE-003-projects.md` (migration order and future working
  directory owner only), and
  `00-Docs/03-Backend/BE-008-settings-persistence.md` (migration order only)
- Future consumer contracts:
  `00-Docs/03-Backend/BE-005-sessions-runtime.md`,
  `00-Docs/03-Backend/BE-007-terminal-and-pty.md`, and
  `00-Docs/03-Backend/BE-012-backup-and-reset.md`
- Frontend catalog entries: `FE-006` and `FE-013` in
  `00-Docs/02-Frontend/00-Overview.md`
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Wireframes: `00-Docs/01-Wireframe/02-AppShell.html#settings-terminal`,
  `00-Docs/01-Wireframe/04-Projects.html#new-session`, and
  `00-Docs/01-Wireframe/04-Projects.html#tool-unavailable`
- Plan rules: `PLANS.md`

`FE-006` and `FE-013` do not yet have standalone feature specifications in the
repository. This is therefore a backend-only Stage 7 plan: it produces the
contract and generated binding that their later plans consume, but it does not
build the CLI Profiles settings page or session tool picker. Stage 7's
user-visible completion remains pending until `FE-013` is specified, planned,
implemented, and verified; `FE-006` remains in Stage 8.

## Scope

**In Scope:**

- Exact-pinning `keyring` and `zeroize` and updating `Cargo.lock` only through
  Cargo resolution.
- Promoting the existing exact `serde_json 1.0.151` entry to runtime
  dependencies so production code can validate and encode `arguments_json`.
- Adding and registering immutable migration version 3 with the exact BE-006
  schema, including the credential cleanup queue.
- The Windows/macOS shell catalog contract, the `system` fallback policy, bare
  and absolute executable discovery, and explicit environment-snapshot seams
  that keep tests independent of process-global environment mutation.
- The OS credential adapter for service `com.xwork.app.cli-profile`, opaque
  UUID accounts, safe error mapping, and a fake in-memory adapter for tests.
- All public DTOs, `CliProfilesError`, backup records, internal launch types,
  built-in constants, custom-profile validation, and generated TypeScript
  bindings specified by BE-006.
- Asynchronous service hydration, cached snapshots, revision/generation state,
  full custom-profile CRUD, default-shell persistence, availability checks,
  event invalidation, secret compensation, and cleanup retries.
- `launchability` for the future Sessions adapter and `resolve_for_launch` for
  the future Terminal adapter. This plan does not add either future adapter.
- All six exact-`main` Tauri commands and composition-root wiring, including
  startup hydration, bounded background availability checks, and queued
  credential cleanup.
- `CliProfilesDataParticipant` and the typed export/prepare/apply/reset/publish
  owner seam used later by BE-012.
- Focused unit, integration, contract, composition, Windows-native, security,
  concurrency, rollback, and regression tests.

**Out of Scope:**

- Any frontend source, IPC wrapper, settings form, session tool picker, or
  handling of `cli-profiles://changed`; those belong to later FE plans.
- Session, tab, pane, recently-used ordering, or tool-selection state
  (`BE-005`).
- PTY creation, process launch/lifecycle, shell command-line encoding, working
  directory selection, or attaching terminal content (`BE-007`).
- The BE-012 envelope, native backup file picker, preview/confirmation flow,
  coordinator, or whole-app reset. Only BE-006-owned typed participant methods
  are included.
- Arbitrary shell paths from the frontend, command execution during checks,
  shell expansion, command/argument string joining, or resolved absolute paths
  in public output.
- A Linux runtime/backend, any webview credential or filesystem permission,
  automated desktop end-to-end tests, macOS runtime testing, signing, or
  release packaging.

## Global Constraints

- Rust owns OS access, persistence, terminal-process preparation, secrets, and
  business rules. The frontend communicates only through narrowly scoped Tauri
  commands and events (`AGENTS.md`, Project Structure).
- Backend capabilities may use `storage`, `platform`, and `shared`, but may not
  access another capability's internal implementation. `app` composes public
  owner/consumer contracts (`02-ProjectStructure.md`).
- Tauri commands stay thin: authorize, parse/validate the DTO shape, call the
  service, and map typed output/error; no SQL or OS work lives in a command
  body (`02-ProjectStructure.md`, `BE-006`).
- Every SQLite, keyring, command-discovery, shell-discovery, and cleanup call
  runs on a blocking worker. No blocking API runs on a Tauri/Tokio async worker
  (`BE-006`).
- The only lock order is `DataMaintenanceGate` -> CLI Profiles mutation lock ->
  `Storage`. No service/SQLite lock is held while waiting for credential I/O;
  owner `_in` APIs never reacquire the gate, service lock, or `Storage`
  (`BE-006`).
- Plaintext secrets never enter SQLite, output DTOs, bindings, events,
  diagnostics, errors, crash context, or backup. Secret-bearing input types and
  resolved launch types do not derive `Debug`, `Clone`, or `Serialize`
  (`BE-006`).
- Migration files are append-only; generated bindings under `src/bindings/`
  are never edited manually (`02-ProjectStructure.md`).
- Availability checks never execute a candidate and use a maximum concurrency
  of four. Runtime availability is not persisted (`BE-006`).
- Validate and build only on Windows during normal development. macOS behavior
  stays behind target configuration and is validated during release
  preparation (`AGENTS.md`, `BE-006`).
- Code, identifiers, and comments are English. Every added function, method,
  callback, helper, and test has a short purpose comment; credential
  compensation has an inline invariant comment (`AGENTS.md`, `BE-006`).

Every task implicitly includes these constraints.

## Assumptions, Risks, and Blockers

**Assumptions:**

- BE-002, BE-003, and BE-008 are already implemented; the current migration
  registry ends at version 2, `Storage::{with_connection, with_transaction}`
  exists, and one managed `DataMaintenanceGate` is shared by Projects and
  Settings.
- The exact public DTO, command, event, launch, backup, and owner-method shapes
  in BE-006 are authoritative. Built-ins remain Rust constants and never become
  seeded rows.
- `keyring 3.6.3` is intentionally used instead of the newer major version: its
  stable synchronous `Entry` API and explicit native feature names match the
  adapter contract while keeping the dependency surface narrow.
- The `system` shell value is persisted, but every effective shell returned to
  a consumer is a currently resolved concrete ID. A custom profile override can
  never be `system`.
- BE-005 and BE-007 will implement their own consumer-side ports later. This
  plan exposes only the BE-006 owner methods and types they need and creates no
  dependency on either future capability.

**Risks:**

- SQLite and the OS credential store cannot share one transaction. Task 5
  stages new credentials, compensates pre-commit failures, durably queues old
  references inside the metadata transaction, and tests every failure edge.
- Concurrent update/check/startup work can otherwise publish stale availability
  or misorder revisions. Tasks 4-6 use one mutation/publication lock plus
  generation tokens, with blocking discovery outside the lock.
- Tests that mutate `PATH`, `PATHEXT`, `COMSPEC`, or `SHELL` would race other
  tests. Task 2 injects an immutable process-environment snapshot and never
  changes process-global variables.
- A native credential test can pollute the user's Credential Manager if cleanup
  is sloppy. Task 3 uses a unique `test-<uuid>` account, an explicit teardown,
  and a drop guard that performs a second best-effort delete.
- A secret may leak through convenient derives or assertion output. Tasks 3-6
  prohibit unsafe derives, use fixed canaries, capture output surfaces, and scan
  serialized bytes, SQLite text, events, errors, and generated binding output.
- Startup hydration, discovery, or cleanup may fail. Task 7 proves hydration
  failure is returned as `PersistenceFailed` with no fallback state, while
  discovery/cleanup failures keep the app usable, leave status `unchecked` or
  the cleanup row durable, and emit only safe diagnostics.
- Importing a backup from another machine may leave a valid secret reference
  whose credential is absent locally. Task 8 preserves the metadata by
  contract; Task 6 proves launch fails with `SecretNotFound` rather than using
  an empty value.

**Blockers:** None. BE-006 has no open questions. Missing FE-006/FE-013 feature
specifications block later user-interface work, not this backend-only plan.

## Dependency Order

1. Task 1 pins dependencies and schema version 3; all persisted behavior
   depends on it.
2. Task 2 establishes non-executing command and shell discovery; Task 4 uses it
   to construct effective shell data and Task 6 uses it for availability.
3. Task 3 establishes the native/fake credential boundary; Task 5 uses it for
   atomic secret mutations and cleanup, and Task 6 uses it for launch.
4. Task 4 establishes typed models, validation, hydration, and the cache; all
   service behavior and commands depend on it.
5. Task 5 adds durable CRUD and cleanup semantics on the hydrated service.
6. Task 6 adds runtime availability, events, and backend-consumer resolution on
   top of the stable service state.
7. Task 7 exposes the completed command surface and starts background work from
   the composition root.
8. Task 8 adds the owner-only maintenance participant after normal mutation and
   publication semantics are established.
9. Task 9 generates the final TypeScript contract after all public DTO/error
   shapes are stable.

---

### Task 1: Pin native secret dependencies and register schema version 3

**Outcome:** Cargo resolves the exact credential/zeroization dependencies and
every new or existing database advances atomically to the exact BE-006 schema
without changing migration 1 or 2.

**Depends On:** None.

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify (Cargo-generated): `src-tauri/Cargo.lock`
- Create: `src-tauri/migrations/0003_create_cli_profiles.sql`
- Modify: `src-tauri/src/storage/migrations.rs`
- Create/Test: `src-tauri/tests/cli_profiles_contract.rs`
- Modify/Test: `src-tauri/tests/projects_commands.rs`
- Modify/Test: `src-tauri/tests/settings_commands.rs`
- Modify/Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: the ordered `MIGRATIONS` registry and atomic migration runner from
  BE-002.
- Produces: migration `{ version: 3, name: "create_cli_profiles" }`; tables
  `cli_profile_settings`, `cli_profiles`, `cli_profile_environment`, and
  `credential_cleanup_queue`; exact manifest entries shown in Tech Stack,
  including runtime `serde_json = "=1.0.151"`.

- [x] **Step 1: Add the failing migration contract tests**

  Create `cli_profiles_contract.rs` with
  `migration_v3_creates_exact_schema_and_default`,
  `migration_v3_preserves_versions_one_and_two`, and
  `migration_v3_reopens_without_reapplying`. Assert table SQL/columns,
  foreign-key and uniqueness rules, the singleton `system` row, empty custom
  tables, and `PRAGMA user_version = 3`. Update existing tests whose legitimate
  post-open expectation moves from version 2 to 3 and whose “future database”
  fixture must move from version 3 to 4.

- [x] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract migration_v3_creates_exact_schema_and_default --
  --exact`

  Expected: The discovered test fails because storage still reports schema
  version 2 and `cli_profile_settings` does not exist.

- [x] **Step 3: Add the dependency pins and migration**

  Move the existing exact `serde_json` entry from dev-only to runtime, add the
  exact `keyring`/`zeroize` entries, let Cargo regenerate the lockfile, copy the
  exact SQL from BE-006 into the new append-only migration, and append the
  version-3 registry entry. Do not add transaction statements or
  `PRAGMA user_version` to the SQL file. Update only version/table-list
  assertions made obsolete by the new migration; keep all prior domain
  behavior assertions intact.

- [x] **Step 4: Verify the task**

  Run: `cargo check --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract --test projects_commands --test settings_commands
  --test app_builder`

  Expected: Cargo resolves `keyring 3.6.3` and `zeroize 1.9.0`; all four test
  targets pass, prior Projects/Settings data remains intact, and every fresh or
  reopened database ends at schema version 3.

### Task 2: Implement non-executing executable and shell discovery

**Outcome:** Platform adapters resolve valid command candidates and the stable
Windows/macOS shell catalog from an immutable environment snapshot without
executing, expanding, or publicly exposing resolved paths.

**Depends On:** Task 1.

**Files:**

- Modify: `src-tauri/src/platform/mod.rs`
- Create/Test: `src-tauri/src/platform/command.rs`
- Create/Test: `src-tauri/src/platform/shell.rs`
- Create/Test: `src-tauri/tests/cli_profiles_windows.rs`

**Interfaces:**

- Consumes: the backend process environment and filesystem metadata only.
- Produces: `ProcessEnvironmentSnapshot`, a cloneable native executable
  resolver constructed either from the real process snapshot or explicit test
  values, the stable platform shell catalog/resolver, and `ResolvedShell` with
  a concrete shell ID, executable, and structured shell mode. Resolver errors
  distinguish not-found from an OS inspection failure without including the
  path in their display text.

- [x] **Step 1: Add the failing resolver and catalog tests**

  Add unit cases for bare and absolute candidates, NUL/control input, relative
  paths with separators, `~`/environment syntax, missing/non-file paths,
  Windows case-insensitive `PATHEXT`, macOS executable-bit checks behind
  `cfg(target_os = "macos")`, and every `system` fallback. Add Windows tests
  `resolver_uses_explicit_path_and_pathext_without_execution` and
  `windows_system_shell_fallback_is_stable`, using a `TempDir`, an inert
  candidate plus a sentinel file, and explicit environment snapshots rather
  than global `set_var` calls.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_windows resolver_uses_explicit_path_and_pathext_without_execution
  -- --exact`

  Expected: The test target fails to compile because the platform command and
  shell resolver interfaces do not exist yet.

- [x] **Step 3: Implement the platform adapters**

  Capture `PATH`, `PATHEXT`, `COMSPEC`, and `SHELL` into owned values at adapter
  construction. Resolve a bare name by directory/extension rules and an
  absolute name by metadata only. Build the exact catalog and fallback order
  from BE-006, keep `system` as a sentinel only, and return only concrete
  `ResolvedShell` values. Never spawn a process, canonicalize into a public DTO,
  or join arguments to a shell string.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib
  platform::command::tests`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib
  platform::shell::tests`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_windows`

  Expected: All command/shell boundary and Windows integration cases pass, and
  the sentinel proves no candidate was executed.

### Task 3: Implement the credential-store adapter and isolated native test

**Outcome:** BE-006 can synchronously read, write, and delete opaque credential
accounts through a fakeable port, while production uses only the native
Windows/macOS keyring backend and returns sanitized error categories.

**Depends On:** Task 1.

**Files:**

- Modify: `src-tauri/src/platform/mod.rs`
- Create/Test: `src-tauri/src/platform/credential.rs`
- Modify/Test: `src-tauri/tests/cli_profiles_windows.rs`

**Interfaces:**

- Consumes: `keyring::Entry` with service name
  `com.xwork.app.cli-profile`.
- Produces: an object-safe `CredentialStore` port with synchronous
  `write_secret`, `read_secret`, and `delete_secret` operations; a
  `KeyringCredentialStore` production adapter; sanitized unavailable,
  write-failed, read-failed, and not-found outcomes; and an in-memory fake that
  can inject each operation failure without touching a real credential store.

- [x] **Step 1: Add the failing adapter tests**

  Add unit tests for fake round-trip/delete/not-found, each injected error,
  service/account validation, and error formatting that excludes account and
  value. Add Windows test
  `windows_credential_manager_round_trip_uses_isolated_account`; generate one
  `test-<uuid>` account, register an explicit cleanup guard before the write,
  use a canary value, assert round-trip/delete, and run a final best-effort
  delete even after an assertion failure.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_windows windows_credential_manager_round_trip_uses_isolated_account
  -- --exact`

  Expected: The discovered Windows test fails to compile because
  `KeyringCredentialStore` and the credential port are missing.

- [x] **Step 3: Implement the credential boundary**

  Wrap `keyring` without logging raw backend errors, secret values, or account
  IDs. Keep the adapter synchronous so callers must explicitly move it to a
  blocking worker. Production accounts are lowercase UUID v4 values with no
  user/profile/env text; only the Windows integration test uses the `test-`
  prefix required for safe identification.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib
  platform::credential::tests`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_windows windows_credential_manager_round_trip_uses_isolated_account
  -- --exact`

  Expected: Fake/error tests pass and the real Windows credential is written,
  read, deleted, and absent after teardown. The test output contains neither
  the secret canary nor the raw account identifier.

### Task 4: Build the typed contract, validation, hydration, and snapshot cache

**Outcome:** `CliProfilesService` can asynchronously hydrate trusted typed
state from SQLite, synthesize built-ins and shells, return secret-redacted
snapshots, and reject corrupt storage rather than silently substituting
defaults.

**Depends On:** Tasks 1-3.

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/terminal/mod.rs`
- Create/Test: `src-tauri/src/terminal/cli_profiles.rs`
- Modify/Test: `src-tauri/tests/cli_profiles_contract.rs`

**Interfaces:**

- Consumes: `Storage`, `DataMaintenanceGate`, the three platform adapters, and
  injected clock/UUID/event seams for deterministic tests.
- Produces: every public DTO, backup record, launch type, and
  `CliProfilesError` named in BE-006; `CliProfilesService` with asynchronous
  one-time initialization and cached snapshot access; exact built-in
  constants; private persisted models; full input/stored-row validation; and a
  runtime revision beginning at `0`.

- [x] **Step 1: Add the failing model and hydration tests**

  Add unit tests for every documented boundary: Unicode scalar/byte limits,
  command shape, 128 arguments/32-KiB total, 64 environment rows, ASCII
  case-insensitive duplicate names, secret `None` rules, icon/control/color,
  UUID v4 IDs, shell override rules, built-in synthesis/order, environment
  order, and DTO redaction. Add integration cases
  `service_hydrates_defaults_and_custom_profiles_after_restart`,
  `snapshot_never_reads_the_credential_store`, and
  `corrupt_profile_row_fails_initialization_without_fallback`; inject malformed
  `arguments_json` directly into an isolated TempDir database for the failure
  case. Add `warm_snapshot_at_documented_limits_completes_within_100_ms` using
  100 custom profiles at the argument/environment caps after hydration; time
  only the cache-to-DTO snapshot path, not fixture setup or OS discovery.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract service_hydrates_defaults_and_custom_profiles_after_restart
  -- --exact`

  Expected: The integration target fails to compile because
  `xwork_lib::terminal::CliProfilesService` and its DTOs are not exported.

- [x] **Step 3: Implement the typed service foundation**

  Define DTO serialization exactly as BE-006, with decimal-string timestamps
  and revisions. Secret-bearing inputs do not derive `Debug`, `Clone`, or
  `Serialize`; convert secret input values to `Zeroizing<String>` as soon as
  validation consumes the DTO. Hydration runs through `spawn_blocking`, parses
  and revalidates every persisted row, initializes availability as `unchecked`,
  and publishes one immutable cache only after the whole read succeeds. A
  corrupt row yields `PersistenceFailed`, leaves initialization failed, and
  prevents startup checks/cleanup from pretending the service is ready.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib
  terminal::cli_profiles::tests`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract`

  Expected: Validation boundaries, deterministic built-in/custom order,
  restart hydration, secret-redacted snapshots, and explicit corrupt-storage
  failure all pass.

### Task 5: Implement atomic profile mutations and durable credential cleanup

**Outcome:** Custom-profile CRUD and default-shell changes commit as one
observable service change, compensate uncommitted secret writes, and retry
post-commit credential deletion from a durable queue.

**Depends On:** Task 4.

**Files:**

- Modify/Test: `src-tauri/src/terminal/cli_profiles.rs`
- Modify/Test: `src-tauri/tests/cli_profiles_contract.rs`
- Modify/Test: `src-tauri/tests/data_management_contract.rs`

**Interfaces:**

- Consumes: initialized service state, `DataMaintenanceGate::read_permit`,
  `Storage::with_transaction`, `CredentialStore`, injected clock and UUID
  source.
- Produces: service operations used by the six Tauri commands; private staged
  credential operations; durable `credential_cleanup_queue` retry; cache
  invalidation to `unchecked`; one revision/event publication per committed
  mutation; and no publication on failure.

- [x] **Step 1: Add the failing mutation and compensation tests**

  Add exact integration cases for create/full update/delete/default shell,
  100-profile rejection, built-in read-only behavior, restart persistence,
  secret `None` preservation, changed/renamed secret replacement, and inherited
  versus override shell invalidation. Add injected failures:
  `secret_write_failure_changes_nothing`,
  `database_failure_compensates_staged_credentials`,
  `compensation_failure_is_durably_queued`,
  `post_commit_delete_failure_keeps_success_and_queue`, and
  `cleanup_deletes_queue_row_only_after_deleted_or_not_found`. Capture the old
  database rows, cache, revision, fake-store contents, and events before each
  failure.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract secret_write_failure_changes_nothing -- --exact`

  Expected: The discovered test fails because the service mutation entry point
  is absent; the migration/hydration tests from Tasks 1 and 4 still compile.

- [x] **Step 3: Implement commit, compensation, and cleanup**

  Validate the full input before any side effect. Stage every supplied secret
  to a fresh UUID account on a blocking worker without the service lock, then
  acquire the mutation lock and re-read definitive metadata. Preserve a `None`
  secret only when the current same-name row is secret; otherwise compensate
  staged accounts and return `SecretValueRequired`. In one SQLite transaction,
  write profile/environment metadata and enqueue every replaced reference.
  After commit, replace cache, bump revision once, publish best-effort, release
  the main read permit, and invoke cleanup under a newly acquired permit.
  Rollback deletes staged accounts; failed compensation records their accounts
  with a best-effort transaction and logs only an account hash.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  data_management_contract cli_profiles_ordinary_mutation_is_blocked_by_write_permit
  -- --exact`

  Expected: CRUD/default-shell/restart and every injected failure pass;
  committed state never becomes partial, cleanup is retryable, and a held
  maintenance write permit prevents an ordinary mutation from reaching the
  mutation lock, credential store, or database.

### Task 6: Add availability, ordered events, and backend launch resolution

**Outcome:** Explicit/background checks safely maintain runtime availability,
while Sessions and Terminal receive fresh, fail-closed profile resolution
without access to BE-006 persistence internals.

**Depends On:** Tasks 2-5.

**Files:**

- Modify/Test: `src-tauri/src/terminal/cli_profiles.rs`
- Modify/Test: `src-tauri/tests/cli_profiles_contract.rs`
- Modify/Test: `src-tauri/tests/cli_profiles_windows.rs`

**Interfaces:**

- Consumes: command/shell resolvers, credential store, cache generation, and a
  four-permit Tokio semaphore.
- Produces: `check_cli_profile` service behavior;
  `CliProfilesService::launchability(&str) ->
  Result<CliProfileLaunchability, CliProfilesError>`;
  `CliProfilesService::resolve_for_launch(&str) ->
  Result<ResolvedCliProfile, CliProfilesError>`; `ResolvedCliLaunchKind` and
  `ResolvedCliProfile`; strictly ordered `cli-profiles://changed` invalidations;
  and a no-fail internal subscription publication after each cache revision.

- [x] **Step 1: Add the failing availability and launch tests**

  Add cases for built-in/custom/Terminal availability, command-not-found,
  shell-not-found, resolver error, `checked_at_unix_ms`, explicit check without
  a maintenance permit, four-check concurrency, generation-stale result
  discard, exact revision/event order, and event-sink failure after a successful
  state change. Add consumer cases proving `launchability` rechecks and returns
  false for missing command/shell, while `resolve_for_launch` returns structured
  shell/command/argument/environment fields, reads all secrets only there, and
  returns `SecretNotFound`, `SecretReadFailed`, or
  `CredentialStoreUnavailable` without a partial result. Use a fixed canary and
  verify drop-time zeroization through the test credential buffer seam rather
  than logging/debugging it.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract stale_availability_result_is_discarded -- --exact`

  Expected: The test fails because the availability generation/check operation
  is not implemented; existing mutation tests still pass.

- [x] **Step 3: Implement checks, publication, and consumer resolution**

  Snapshot config plus generation under the mutation lock, release it, resolve
  on the blocking pool, then reacquire it and commit only a matching generation.
  Use a shared semaphore capped at four for startup/background checks. Explicit
  not-found is a successful DTO state; OS inspection failure remains a typed
  error and preserves the prior status. Increment revision and publish exactly
  once per accepted result. Recheck in both consumer methods; only
  `resolve_for_launch` reads credentials, collects every value into zeroizing
  buffers, and returns after all required values succeed.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib
  terminal::cli_profiles::tests`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract`

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_windows`

  Expected: Availability, stale-result, concurrency, event/revision,
  launchability, resolved-launch, redaction, and Windows resolver/credential
  cases all pass without executing a CLI.

### Task 7: Register commands, managed state, and startup background work

**Outcome:** The real Tauri routing pipeline serves all six BE-006 commands
only to `main`, and application startup initializes one service before running
safe background availability and credential-cleanup work.

**Depends On:** Task 6.

**Files:**

- Modify: `src-tauri/src/app/mod.rs`
- Modify: `src-tauri/src/terminal/mod.rs`
- Modify/Test: `src-tauri/tests/cli_profiles_contract.rs`
- Modify/Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: the managed `Storage` and `DataMaintenanceGate`, native platform
  adapters, existing test composition helpers, and all Task 4-6 service
  operations.
- Produces: exact command functions `get_cli_profiles`,
  `create_cli_profile`, `update_cli_profile`, `delete_cli_profile`,
  `set_default_cli_shell`, and `check_cli_profile`; managed
  `CliProfilesService`; a test composition path that injects fake platform,
  clock, UUID, and event collaborators; and startup tasks for initialize ->
  cleanup -> bounded availability checks.

- [x] **Step 1: Add the failing routing and startup tests**

  Add MockRuntime command tests for all six routes, exact-main authorization,
  built-in read-only errors, successful snapshots, not-found-as-status, and
  event invalidation. Prove unauthorized create/update/delete/default/check
  requests are rejected before validation, permit acquisition, database,
  credential, or resolver calls. Extend `app_builder.rs` with managed-service,
  shared-gate, collaborator-injection, and registered-command checks. Add
  `startup_hydration_failure_is_observable_without_fallback`,
  `startup_cleanup_failure_keeps_queue_and_app_available`, and
  `startup_resolver_failure_keeps_status_unchecked`; inject respectively a
  malformed stored row, fake credential-store failure, and fake resolver
  failure, then drive `run_iteration` deterministically.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract get_cli_profiles_routes_only_from_main -- --exact`

  Expected: The command test fails with the Tauri routing error naming the
  missing `get_cli_profiles` command.

- [x] **Step 3: Implement thin commands and composition**

  Authorize first, clone owned state/input needed across awaits, and delegate
  all work to the service. Extend the single invoke handler. Construct and
  manage the service from the already managed gate/storage, then spawn
  initialization; only successful hydration starts cleanup and availability.
  A cleanup or discovery failure emits a sanitized diagnostic but does not
  fail app startup. Never add a webview capability or expose a general
  filesystem/credential API.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  cli_profiles_contract --test app_builder`

  Expected: Every command routes correctly, unauthorized calls have zero
  protected side effects, one service shares the app gate, hydration failure is
  observable, and recoverable background failures leave their retryable state
  intact.

### Task 8: Add the typed BE-012 owner participant

**Outcome:** The future Data Management coordinator can export, validate,
merge, reset, and publish CLI Profiles through typed owner APIs without reading
BE-006 tables/cache directly or exposing secret values.

**Depends On:** Tasks 5-7.

**Files:**

- Modify/Test: `src-tauri/src/terminal/cli_profiles.rs`
- Modify: `src-tauri/src/terminal/mod.rs`
- Modify: `src-tauri/src/app/data_participants.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Modify/Test: `src-tauri/tests/data_management_contract.rs`
- Modify/Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: the exact `CliProfilesBackupV1`, profile/environment backup records,
  and merge semantics from BE-006/BE-012 plus a coordinator-owned
  `rusqlite::Transaction`.
- Produces: owned `CliProfilesImportCounts`, `CliProfilesImportPlan`, and
  `CliProfilesCommittedProjection`; the five exact
  `CliProfilesService::{export_cli_profiles_in,
  prepare_cli_profiles_merge_in, apply_cli_profiles_merge_in,
  reset_cli_profiles_in, publish_data_change}` methods;
  `CliProfilesDataParticipant`; and post-maintenance cleanup invoked only after
  commit and after release of the coordinator write permit.

- [x] **Step 1: Add the failing maintenance contract tests**

  Extend `data_management_contract.rs` with
  `cli_profiles_export_contains_metadata_and_secret_references_only`,
  `cli_profiles_prepare_is_gate_and_storage_reentry_free`,
  `cli_profiles_merge_preserves_local_matching_secret_reference`,
  `cli_profiles_merge_rejects_cross_identity_credential_alias`,
  `cli_profiles_rollback_publishes_nothing`,
  `cli_profiles_commit_publishes_owned_projection`, and
  `cli_profiles_reset_keeps_cleanup_queue_and_builtins`. Verify foreign-machine
  secret references remain metadata and later launch reports
  `SecretNotFound`; local records not in the backup remain; default shell is
  replaced; invalid target-platform shell IDs map to `system`/`None`; removed
  local references are queued. Hold the maintenance write permit while calling
  every `_in` method to prove no gate re-entry, and inject transaction rollback
  before publication.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  data_management_contract cli_profiles_export_contains_metadata_and_secret_references_only
  -- --exact`

  Expected: Compilation fails with unresolved `CliProfilesDataParticipant` or
  the exact owner method names, proving the typed participant seam is absent.

- [x] **Step 3: Implement owner plans, projections, and adapter**

  Export only persisted metadata from the supplied transaction. Prepare must
  fully validate/dedupe/collision-check and create owned SQL/outbox operations
  plus an owned post-commit projection; apply/reset execute only those
  operations on the supplied transaction. `publish_data_change` consumes the
  projection, swaps cache/revision, and notifies internal subscribers without
  querying or returning `Result`; publish one bulk invalidation as `updated`
  with `profile_id = None`, and keep Tauri event failure best-effort.
  Register the adapter in app state. The later coordinator, not this adapter,
  decides transaction and publish order.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  data_management_contract --test app_builder`

  Expected: Export/merge/reset, secret redaction/collision, rollback, owned
  post-commit publication, write-permit behavior, participant management, and
  deferred cleanup tests all pass.

### Task 9: Generate the CLI Profiles TypeScript binding

**Outcome:** One generated terminal binding is the frontend source of truth for
the complete BE-006 IPC/event contract and contract tests detect any drift.

**Depends On:** Tasks 7-8.

**Files:**

- Modify: `src-tauri/tests/export_bindings.rs`
- Create (generated only): `src/bindings/terminal/cli-profiles.ts`

**Interfaces:**

- Consumes: `CliProfileKindDto`, `CliProfileAvailabilityStatusDto`,
  `CliProfileAvailabilityDto`, `CliProfileEnvironmentDto`,
  `CliProfileEnvironmentInputDto`, `CliProfileInputDto`, `CliShellDto`,
  `CliProfileDto`, `CliProfilesSnapshotDto`, `CliProfilesChangeKindDto`,
  `CliProfilesChangedDto`, and `CliProfilesError`.
- Produces: stable-order generated TypeScript declarations at
  `src/bindings/terminal/cli-profiles.ts`. Backup/import plans and resolved
  launch types are intentionally absent because they are Rust-only contracts.

- [x] **Step 1: Add the failing binding contract**

  Extend the existing generator with `generated_cli_profiles_binding()` and
  `cli_profiles_binding_matches_rust_contract`, using the established
  `assert_binding_is_current` behavior and the exact ordered export list above.

- [x] **Step 2: Verify the test fails for the expected reason**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test
  export_bindings cli_profiles_binding_matches_rust_contract -- --exact`

  Expected: The first discovered run writes the generated file and fails with
  `bindings were regenerated; rerun the test to verify a clean output`.

- [x] **Step 3: Inspect generated output without hand-editing it**

  Confirm camelCase fields/variants, decimal-string revision/timestamp fields,
  the optional secret input value, the complete error/event types, and no
  backup, resolved path, credential account, or secret output field. If output
  is wrong, change the Rust source and regenerate; never edit the TypeScript
  file.

- [x] **Step 4: Verify the task**

  Run the Step 2 command a second time.

  Run: `rg -n "CliProfilesSnapshotDto|CliProfileInputDto|CliProfilesError"
  src --glob "!src/bindings/**"`

  Expected: The binding test passes cleanly and the search finds no handwritten
  duplicate contract outside generated bindings.

## Final Verification

Run on Windows after all tasks are complete. Frontend checks are regression
gates because this backend-only plan intentionally changes no frontend source.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | Pass with no formatting diff |
| Frontend lint | `pnpm lint` | Pass with no errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Frontend tests | `pnpm test` | All existing unit/component tests pass |
| Frontend build | `pnpm build` | Production build succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Pass with all warnings denied |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | Every unit/integration/contract target passes, including `cli_profiles_contract`, `cli_profiles_windows`, `data_management_contract`, `export_bindings`, `app_builder`, `projects_commands`, and `settings_commands` |
| Windows Tauri build | `pnpm tauri build` | Build succeeds with migration 3, six commands, native keyring backend, and generated binding |
| No secret in persisted/generated artifacts | `rg -n "BE006_SECRET_CANARY" src-tauri/src src-tauri/migrations src/bindings` | No matches; SQLite/event/error byte assertions also pass |
| No handwritten frontend contract | `rg -n "CliProfilesSnapshotDto|CliProfileInputDto|CliProfilesError" src --glob "!src/bindings/**"` | No matches |
| No new webview OS permission | `git diff -- src-tauri/capabilities` | No diff |

### Targeted Windows Verification Notes

The automated Windows integration target is the primary native check for this
backend-only slice. It must use a temporary executable directory and explicit
environment snapshot, verify PowerShell/cmd discovery without running a
candidate, and perform one Windows Credential Manager round-trip under a unique
test account that is deleted in normal teardown and by a best-effort guard.
After `pnpm tauri build`, launch the built application once from a disposable
Windows user profile, confirm existing Home/Projects/Settings pages still open,
and confirm startup does not create a visible console, credential prompt, or
error. No CLI Profiles UI is claimed yet, and no automated desktop end-to-end
test is added or run.

## Plan Review Gate

- [x] `keyring = 3.6.3` and `zeroize = 1.9.0` are exact-pinned with explicit
  native features and documented Rust-version compatibility; the already
  exact-pinned `serde_json = 1.0.151` is promoted to runtime without changing
  its version, and all other direct dependencies remain exact-pinned.
- [x] Every named integration test file is selected explicitly by a focused or
  final command; unit-test modules are selected through their exact module
  paths.
- [x] Every red command discovers a real integration target/test and fails on a
  named missing schema, symbol, route, behavior, or one-time regeneration—not
  by matching zero tests.
- [x] Database tests use a fresh `TempDir`; command/shell tests inject immutable
  environment snapshots; fake credentials cover normal/error paths; the only
  real Credential Manager test uses a unique `test-<uuid>` account and layered
  cleanup.
- [x] Startup hydration, resolver, and cleanup failures each name their
  injection and observable result. Credential write/read/delete, SQLite commit,
  compensation, event emission, stale generation, and maintenance rollback
  failures are also explicit.
- [x] Final Rust commands include all targets/features and warnings denied;
  frontend regression gates and the Windows Tauri build are required.
- [x] Secret redaction, command non-execution, absence of handwritten bindings,
  and absence of new webview permissions each have a concrete verification
  method.
- [x] No source implementation, frontend work, migration rewrite, macOS
  validation, automated desktop end-to-end test, or Git commit step is
  authorized by this plan.

## Deviations and Decisions

- Pin `keyring 3.6.3` with only `apple-native` and `windows-native`; do not use
  the newer major-version all-in-one defaults because BE-006 needs the stable
  synchronous native adapter surface and no Linux backend.
- Use an immutable injected process-environment snapshot for command/shell
  tests. Process-global environment mutation is forbidden because Rust tests
  run concurrently and such mutation would make isolation fake as hell.
- Initialize CLI Profiles asynchronously and make commands await the same
  one-time result. A corrupt row is an observable `PersistenceFailed`; there is
  no silent default cache. Recoverable startup discovery/cleanup failures leave
  retryable status/queue state and do not prevent the desktop shell from
  opening.
- Stage supplied secret values before entering the mutation lock, then resolve
  `None` preservation against the definitive current metadata under the lock.
  This avoids holding the service lock across credential I/O without allowing
  stale metadata to choose which credential survives.
- Represent a BE-012 bulk merge/reset publication with the existing `updated`
  event kind and `profile_id = None`. Every frontend consumer treats the event
  as invalidation and reloads the snapshot, so no new public enum variant is
  needed for a future coordinator operation.
- Keep `terminal::cli_profiles` in one file initially, as established by BE-006
  and the no-premature-splitting rule. Split repository/commands/service files
  only if implementation reveals multiple real responsibilities and record the
  deviation here.

Appended during implementation:

- `CliProfilesError` serializes as `{ "code": ... }` only, matching the exact Rust
  enum in `BE-006` and the existing Projects/Settings bindings. The safe message
  stays a Rust-side `Display` value and the frontend derives the affected form
  field from the stable code, so no extra payload shape was invented.
- The six commands take `WebviewWindow<R>` with a generic runtime instead of
  `tauri::Window`, matching every existing capability command and allowing
  MockRuntime routing tests to assert the exact-`main` rule.
- Validation additionally rejects control characters in `name`, which rule 2
  leaves unspecified, and requires a bare executable name to contain no
  whitespace. The whitespace rule is how "a command string carrying arguments"
  is actually rejected; an absolute path may still contain spaces.
- `effective_default_shell_id` is never the `system` sentinel. When nothing
  resolves it falls back to the persisted concrete identifier, otherwise to the
  first concrete catalog entry, while availability reports `shellNotFound`.
- Startup work is one awaitable `CliProfilesService::run_startup`, which the
  composition root spawns. The test composition path skips spawning so command
  tests stay deterministic, and the three startup failure cases drive
  `run_startup` directly instead of relying on `run_iteration` to complete a
  spawned Tokio task.
- `launchability` re-resolves command and shell without publishing a revision,
  because it is a read-only lookup for the future Sessions adapter.
- An accepted availability result increments the revision but not the check
  generation, so checking one profile never discards a concurrent check of
  another. Only a configuration change advances the generation.
- A cross-identity credential alias, a duplicate incoming credential reference,
  and a duplicate incoming profile identifier in a `BE-012` merge all map to
  `PersistenceFailed`, because the `BE-006` error enum has no dedicated
  data-integrity variant and the merge must fail before any write.
- A shell `Inspection` failure maps to `ShellNotFound` in `set_default_cli_shell`
  because the documented error set for that command has no inspection variant.
- `resolve_for_launch` returns `CommandNotFound` when a resolved executable path
  is not valid Unicode instead of lossily converting it into the `String` field
  the contract specifies, so a corrupted path can never be spawned.
- `ProcessEnvironmentSnapshot` lives in its own small `platform::environment`
  module because both `platform::command` and `platform::shell` capture it.
- `CliProfilesService::check_concurrency_limit` is a `#[doc(hidden)]` accessor so
  the four-permit cap is asserted directly instead of through timing.
- The warm-snapshot fixture uses the documented count caps — 100 profiles, 128
  arguments totalling 32 KiB, 64 environment entries — with 512-byte values
  instead of 32 KiB per variable, which would need roughly 200 MB of fixture
  data without measuring anything additional.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

**Status:** Implemented on Windows.

**Delivered:**

- Migration version 3 (`0003_create_cli_profiles.sql`) creates the exact four
  BE-006 tables plus the singleton `system` default-shell row, applies after
  versions 1 and 2 without touching their data, and reopens at version 3.
- `platform::environment`, `platform::command`, and `platform::shell` resolve
  bare and absolute commands plus the Windows/macOS shell catalog from an
  injected environment snapshot, never executing or shell-expanding a candidate.
- `platform::credential` wraps `keyring 3.6.3` for service
  `com.xwork.app.cli-profile` with sanitized error categories and an in-memory
  fake that can inject every operation failure.
- `terminal::cli_profiles` owns the complete public DTO/error/event contract,
  the three immutable built-ins, full input and stored-row validation,
  asynchronous one-time hydration, the cached snapshot, custom-profile CRUD,
  default-shell selection, staged credential writes with compensation, the
  durable `credential_cleanup_queue`, bounded availability checks with
  generation-based staleness, `launchability`, `resolve_for_launch`, and the
  typed BE-012 owner methods.
- All six exact-`main` Tauri commands are registered through the existing
  composition root, which manages one `CliProfilesService` and one
  `CliProfilesDataParticipant` on the shared `DataMaintenanceGate` and spawns
  hydration, cleanup, then bounded availability checks.
- `src/bindings/terminal/cli-profiles.ts` is generated from Rust and covered by
  a drift-detecting contract test.

**Verification evidence (Windows):**

| Scope | Command | Result |
|---|---|---|
| Frontend format | `pnpm format:check` | Pass, 121 files, no diff |
| Frontend lint | `pnpm lint` | Pass, 121 files, no findings |
| Frontend type check | `pnpm typecheck` | Pass |
| Frontend tests | `pnpm test` | 41 files, 808 tests pass |
| Frontend build | `pnpm build` | Succeeds |
| Rustfmt | `cargo fmt --check` | No diff |
| Clippy | `cargo clippy --all-targets --all-features -- -D warnings` | Pass |
| Rust tests | `cargo test --all-targets --all-features` | 13 targets pass, 0 failures |
| Windows Tauri build | `pnpm tauri build` | Succeeds with migration 3, six commands, and the native keyring backend |
| No secret in artifacts | `rg BE006_SECRET_CANARY src-tauri/src src-tauri/migrations src/bindings` | No matches |
| No handwritten contract | `rg CliProfilesSnapshotDto\|CliProfileInputDto\|CliProfilesError src --glob '!src/bindings/**'` | No matches |
| No new webview permission | `git diff -- src-tauri/capabilities` | No diff |

Focused coverage includes `cli_profiles_contract` (migration, hydration, CRUD,
compensation, cleanup, availability, events, launch, command routing, startup
failures), `cli_profiles_windows` (real `PATH`/`PATHEXT` discovery, the stable
`system` fallback, one Windows Credential Manager round trip under a unique
`test-<uuid>` account with a drop-guard teardown, and a native check that proves
no candidate is executed), `data_management_contract` (write-permit blocking and
every typed owner path), `app_builder`, and `export_bindings`.

**Native Windows smoke status:** the automated Windows integration target is the
primary native check and passes, including the real Credential Manager round
trip. Launching the bundled application from a disposable Windows user profile
is still an open manual step for whoever performs release-style validation.

**Remaining limitations:**

- Backend only. `FE-006` and `FE-013` are unspecified, so no CLI Profiles
  settings page or session tool picker exists and Stage 7 is not user-visible
  yet. Nothing consumes `cli-profiles://changed` in the frontend.
- `launchability` and `resolve_for_launch` are exposed but unused; `BE-005` and
  `BE-007` will add their own consumer adapters later.
- The BE-012 coordinator, envelope, and preview flow remain out of scope; only
  the owner-side participant methods exist.
- macOS behaviour stays behind target configuration and is unvalidated until
  release preparation.
