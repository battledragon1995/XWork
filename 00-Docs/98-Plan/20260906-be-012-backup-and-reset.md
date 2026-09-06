# BE-012 Backup and Reset — Stage 13 Implementation Plan

**Status:** Backend implementation and automated Windows gates complete; ready for parent commit. Native smoke remains pending in an isolated profile.

**Goal:** Deliver the Phase 1 Rust backup/reset service and its real owner integrations so FE-015 can export/import schema v1, inspect/open/copy data location, and explicitly reset XWork without touching project source or exporting secret values.

**Completion Criteria:**

- All nine BE-012 commands are registered, authorize exact `main` before side effects, and use generated Rust DTO contracts.
- Export produces one strict, capped, atomically replaced v1 JSON file from a consistent snapshot; import previews then merges all four core participants in one transaction.
- Confirmed reset stops real Sessions/Terminal runtime, pauses Notifications, clears the Phase 1 owner data in one transaction, publishes committed projections and resumes the application without exiting.
- Failure, concurrency, secret exclusion, path/content validation and isolation assertions below pass against real owner services with temporary persistence and fake OS collaborators.
- Frontend, Rust and Windows Tauri gates pass. Native checks require an isolated Windows profile; record them as pending until actually performed. Backend automated completion is not whole-stage completion: FE-015 and its native smoke remain separate work.

**Architecture:** Settings owns Data Management orchestration; app adapters connect public owner maintenance APIs. Storage owns the transaction, platform owns native I/O, and the existing shared maintenance gate controls admission. SQL and cache publication remain inside domain owners, with no capability accessing another owner's internals.

**Tech Stack:** Existing Rust 1.98.0 / Edition 2024, Tauri 2.11.5, Tokio, rusqlite, Serde/serde_json, ts-rs, official native plugins and Windows APIs; existing pnpm frontend gates.

**Sources:**

- `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`.
- `00-Docs/98-Plan/00-Roadmap.md`, stage 13 and common completion conditions.
- `00-Docs/00-Overview/01-TechStack.md`, `02-ProjectStructure.md`, `03-FunctionalRequirements.md` (§17.6, §18).
- `00-Docs/03-Backend/BE-012-backup-and-reset.md`, including stage 13 integration decisions.
- `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md` and `BE-002-storage-foundation.md`.
- `00-Docs/03-Backend/BE-003-projects.md`, `BE-005-sessions-runtime.md`, `BE-006-cli-profiles.md`, `BE-008-settings-persistence.md`, `BE-009-keyboard-shortcuts.md`, `BE-011-notifications.md`.
- `00-Docs/02-Frontend/00-Overview.md`, FE-015 row; `00-Docs/01-Wireframe/02-AppShell.html#settings-data`, including reset overlay. FE-015 detailed design is a later deliverable, not an input assumed to exist.
- Current `src-tauri/src/app/data_participants.rs`, `app/data_runtime.rs`, `shared/maintenance.rs`, owner `_in` APIs, `storage/mod.rs`, `tests/data_management_contract.rs`, `tests/export_bindings.rs`, `tests/app_builder.rs`, manifests and lockfiles.

## Scope

**In Scope:**

- v1 Projects/custom CLI profiles/default shell/Appearance/sidebar/shortcut overrides; strict parser, preview counts/fingerprint, request state and error mapping.
- Native import/export picker and bounded regular-file I/O; backend-resolved app-data location/open/copy.
- Reset-only Notifications, real Sessions/Terminal cleanup, reset-specific worker resume, post-commit credential cleanup outbox and lifecycle coordination.
- Necessary completion of existing owner maintenance APIs, internal subscriptions, generated aggregate binding and contract tests.

**Out of Scope:**

- FE-015 UI/wrappers, Home, other roadmap stages, independent review, subagents or commits in this PLAN ONLY task.
- Notes, Calendar, Reminders, Recent Files, v2/v3 implementation, future migrations or placeholder owners. Preserve documented future schema contracts without scaffolding them.
- Source copying/deletion, runtime restoration, terminal history/output backup, inbox backup, cloud/network upload, encryption, ZIP, scheduler and retention.
- Dependency upgrades, desktop automated E2E, macOS validation and changes to historical plans.

## Global Constraints

- "Write code, identifiers, and code comments in English."
- "Generated bindings under `src/bindings/` are not edited manually."
- "Backend capabilities do not access another capability's internal implementation."
- "Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state."
- "Do not rely on process-global environment mutation for test isolation when tests may run concurrently."
- "During development, build and test only on Windows."
- Every new/changed function, method, callback, helper and test needs a short purpose comment. Markdown is UTF-8.
- Gate order: maintenance permit → owner lock → Storage. `_in` methods never reacquire any of them; SQLite and owner guards never cross `.await`. Await write admission before dispatching blocking transaction work.
- One SQLite transaction for apply; no post-commit typed failure pretending rollback. Owner projections are owned and published only after commit; event emission and credential deletion cannot undo committed data.
- No new library is needed. Reuse locked manifest entries below; do not update unrelated pins:

```toml
serde = { version = "=1.0.229", features = ["derive"] }
serde_json = "=1.0.151"
rusqlite = { version = "=0.40.2", features = ["bundled"] }
tokio = { version = "=1.53.1", features = ["sync", "time"] }
tauri = { version = "=2.11.5", features = ["tray-icon"] }
tauri-plugin-dialog = "=2.7.3"
tauri-plugin-clipboard-manager = "=2.3.2"
tauri-plugin-opener = "=2.5.5"
ts-rs = "=12.0.1"
uuid = { version = "=1.26.0", features = ["v4"] }
```

For native atomic replacement, extend only the existing Windows entry if required:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "=0.61.2", features = ["Win32_Foundation", "Win32_System_JobObjects", "Win32_System_Threading", "Win32_Storage_FileSystem"] }
```

Keep current dev entries `tempfile = "=3.27.0"` and `tokio = { version = "=1.53.1", features = ["rt", "time", "test-util"] }` in dev-dependencies. This is feature activation on the existing pinned Windows dependency, not a version selection; validate compilation with the pinned toolchain and final Tauri build. Do not add a date library solely for UTC filenames.

## Assumptions, Risks, and Blockers

**Assumptions:**

- HEAD observed during planning: `21872c1 Implement FE009`, following `de1cfe7 Implement BE010`. Stage 12 code/automated checks are reported complete; native smoke/p95 remains pending.
- Existing core participant adapters and gate tests are foundations, not evidence that BE-012 orchestration exists. No `settings/data.rs`, `platform/data.rs` or data binding exists yet.
- Notifications stage 13 pause/reset methods are specified but not yet implemented. Existing true-Quit closes admission permanently and must not be reused for reset.
- User authorizes resolving ambiguity and recording decisions in the spec. Implementer is **Sol medium**; this task does not dispatch it.

**Risks:**

- Reset write gate can deadlock a notification worker already waiting for read admission. Task 4 requires cancellation-safe pause and deterministic barriers.
- Existing Settings/Shortcuts maintenance publishers only swap cache; Task 2 completes internal invalidation and tests rollback silence.
- JSON deserialization through an intermediate map can erase duplicate keys; Task 1 verifies duplicate rejection at every object level.
- File can grow/change after metadata, and Windows replacement can fail while a destination is locked. Task 3 bounds reads on the opened handle and preserves old bytes on every pre-replacement failure.
- Terminal tests previously hung in parallel, and a BE-011 timing failure was reported. Use one Cargo job and serial Rust test harnesses, record failures honestly and fix only regressions caused by this work.
- Native smoke cannot be substituted by a build or a mock. Do not launch reset on the user's active profile.

**Blockers:** None for implementation planning or automated implementation. Isolated native smoke remains an explicit verification prerequisite, not a claimed pass.

## Dependency Order

1. Strict v1 contract and isolated service seams → typed owner integration.
2. Owner plans/projections and subscriptions → consistent snapshots and publication.
3. Native file adapter → export and import prepare.
4. Reset-specific runtime/Notifications lifecycle → safe reset orchestration.
5. Coordinator and transaction failure tests → command registration and generated bindings.
6. Composition/contract checks → full gates and parent handoff.

All commands below run from repository root. Set `$env:CARGO_BUILD_JOBS = '1'` in the task shell (this configures build scheduling, not test profile isolation). Every Cargo test command uses `--all-targets --all-features -- --test-threads=1` for full gates, or explicit `--test`/`--lib` selection with `--all-features -- --test-threads=1` for focused gates. Do not run concurrent Cargo processes.

### Task 1: Define strict Phase 1 contracts and isolated seams

**Outcome:** A discoverable test target exercises v1 serialization/parser and the pending-operation state machine without touching native resources.

**Depends On:** None.

**Files:** Create `src-tauri/src/settings/data.rs`, `src-tauri/src/settings/data_participant.rs`; modify `src-tauri/src/settings/mod.rs`; test the new modules and extend `src-tauri/tests/data_management_contract.rs`.

**Interfaces:** Consume public core owner backup records and `SettingsBackupSection`. Produce `BackupEnvelope<BackupDataV1>`, `ParsedBackupPackage`, all BE-012 DTO/error types, Phase 1 variants of `DataBackupParticipant`/`DataResetOnlyParticipant` and owned plan/projection types. Add Rust-only `DataManagementService::with_seams` with explicit Storage, gate, immutable participants, runtime, platform, clock and event sink injection. Clock provides monotonic TTL and UTC filename time; neither is a process-global override.

- [ ] Add compiling contract skeletons and tests calling those contracts, with a valid v1 fixture made from owner records. Register modules immediately so tests are discovered.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml --test data_management_contract --all-features -- --test-threads=1`. Red expectation: valid fixture is rejected or duplicate input accepted by the initial parser, not an undiscovered target or zero matches. Record the exact failing test name/assertion.
- [ ] Implement strict envelope/header validation, UTF-8/no BOM/no trailing content, positive supported version, timestamp and appVersion constraints, safe filename and bounded counts. Preserve default JSON depth limits.
- [ ] Reject unknown/missing fields, duplicate keys at envelope/data/record/nested settings/env/chord levels, duplicate IDs/action IDs and incorrect value types. Do not first deserialize into a map that drops duplicates. Keep owner DTO's existing IPC behavior; enforce backup-specific strictness at this boundary.
- [ ] Test schema 0 and 2/3 rejection with `supported: 1`; no v2/v3 owner stubs. Counts use absent Notes/Events for v1 and zero reset counts. Test `fileName`/`schemaVersion` camelCase on tagged public variants and existing owner secret-reference shape separately.
- [ ] Implement one pending import/reset, one active operation, nonzero wrapped request IDs, kind/ID checks, TTL exactly at ten minutes, cancellation, apply admission and repeat-confirm rejection. Capture immutable parsed bytes/records, never re-read a path at confirm.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib --all-features -- --test-threads=1` and the explicit contract command. Expected: all parser/state assertions pass and legacy owner tests remain green.

### Task 2: Complete real owner participants and committed publication

**Outcome:** Four core adapters use current owner APIs with a single supplied transaction; owned publication updates caches/subscribers only after commit.

**Depends On:** Task 1.

**Files:** Modify `src-tauri/src/app/data_participants.rs`, `src-tauri/src/settings/data_participant.rs`, `src-tauri/src/settings/mod.rs`, `src-tauri/src/settings/keyboard_shortcuts.rs`; extend existing owners only as required in `src-tauri/src/projects/mod.rs`, `models.rs`, `repository.rs`, `service.rs`, and `src-tauri/src/terminal/mod.rs`, `cli_profiles.rs`. Test `src-tauri/tests/data_management_contract.rs` and colocated owner modules. These are owner-scoped files, not permission for adjacent refactoring.

**Interfaces:** Consume existing export/prepare/apply/reset `_in` methods and `ProjectImportMap::resolve`. Produce trait implementations over `ProjectsDataParticipant`, `SettingsDataParticipant`, `CliProfilesDataParticipant`, `KeyboardShortcutsDataParticipant`; `SettingsService::subscribe()` and `KeyboardShortcutsService::subscribe()` return `tokio::sync::watch::Receiver<u64>`. Any count/fingerprint access needed from an opaque owner plan is exposed by the owner as typed metadata, never by coordinator SQL.

- [ ] Extend the existing transaction tests before adapting code. Red expectation: current Settings/Shortcuts publishers do not advance a subscribed invalidation after maintenance commit.
- [ ] Use `cargo test --manifest-path src-tauri/Cargo.toml --test data_management_contract --all-features -- --test-threads=1` for both red and green; use the full `--lib` command from Task 1 for colocated tests.
- [ ] Preserve public CRUD signatures. Prepare validates candidate state, computes counts and owned projections; apply receives caller transaction, changes SQL only, and publishes nothing. Variant mismatch is a tested programming error.
- [ ] Test project ID collision, canonical duplicate path preserving local metadata, ambiguous ID/path collision rejection, unavailable absolute path restore and deterministic map resolution. Include relative/NUL path rejection and Unicode/spaces through a fake path resolver or temp folder.
- [ ] Test merge retains unrelated local records, full settings/default-shell replacement and shortcut replacement/removal counts. Reuse owner validation, built-in profile invariants and unknown-shell fallback.
- [ ] Test reference preservation for same profile/env, foreign/missing reference restore, cross-identity reference rejection, removed-reference outbox, no credential read during prepare/export, and cleanup retry after commit only. Use recording fake credential store.
- [ ] Swap committed cache then notify internal subscriptions; no query in publish, no silently skipped cache swap on poison, no compensation transaction after commit. A fatal internal poison is not a typed pre-commit failure. Verify owner event invalidations and subscriber wakeup without embedding user content.

### Task 3: Implement bounded native file and location adapters

**Outcome:** Export replacement is atomic on Windows and import reads only the picker-selected regular file; location operations use the injected app-data path.

**Depends On:** Task 1.

**Files:** Create `src-tauri/src/platform/data.rs`; modify `src-tauri/src/platform/mod.rs`, `src-tauri/Cargo.toml` only for the Windows feature above and generated `src-tauri/Cargo.lock` only if Cargo requires it. Test colocated `platform/data.rs` and `src-tauri/tests/data_management_contract.rs`.

**Interfaces:** Produce an OS adapter port for pick-open/pick-save, bounded read, atomic write, ensure/open/copy location, with recording/failing fake implementations. Paths are Rust-only picker outputs. OS adapter errors map to BE-012 error categories without exposing path/content. Clock and UUID provide UTC name and collision-resistant sibling temp name.

- [ ] Add tests using temp destinations with known old bytes. Red expectation: injected sync/replace failure must leave destination bytes unchanged; import growth beyond the limit must return `BackupTooLarge`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib --all-features -- --test-threads=1` and the explicit data contract target from Task 1, before and after implementation.
- [ ] Picker cancel produces Cancelled with zero file/storage effects. Extension filter is advisory: validate JSON content even for matching extension; permit valid content selected under a different name.
- [ ] Open once, inspect handle metadata, reject directory/nonregular/unreadable input, read at most 128 MiB + 1 byte, reject growth and invalid UTF-8 before planning. A selected symlink may resolve to one regular file; never recurse, extract, execute or load referenced project content. Test symlink behavior through adapter seam if creating links needs OS privilege.
- [ ] Write bounded serialized content to `create_new` sibling temp; flush/sync, close as needed, atomically replace existing destination or atomically install new destination. Handle Windows locked destination, temp-name collision and partial write; preserve old destination on failure and best-effort clean only the operation's temp file. Never delete old destination first.
- [ ] Test existing/new target, zero-byte and exact-limit input, over-limit input, growth during read, malformed/deep/trailing/ZIP-like content, read error and selected file removed before open. Hold parsed package across subsequent file changes.
- [ ] Open/copy tests assert the exact injected temp app-data path, no arbitrary frontend input, and typed directory/open/clipboard failures. Fail closed when the app-data path cannot be ensured.

### Task 4: Add reset-specific runtime and Notifications lifecycle

**Outcome:** Reset can quiesce live owners while holding the write permit and resume after either transaction outcome without closing XWork.

**Depends On:** Tasks 1–2.

**Files:** Create `src-tauri/src/app/data_reset_participants.rs`; modify `src-tauri/src/app/data_runtime.rs`, `app/lifecycle.rs`, `notifications/mod.rs`, `notifications/models.rs`, `notifications/repository.rs`, `notifications/service.rs`; modify `sessions/mod.rs`, `sessions/models.rs`, `sessions/manager.rs` only for missing reset contract integration. Extend `src-tauri/tests/data_management_contract.rs`; test colocated runtime/notification modules.

**Interfaces:** Implement `DataRuntimeControl::impact`, `shutdown_for_reset`, `resume_after_reset(DataResetCompletion)`; connect public `SessionManager::shutdown_impact`, `shutdown_all`, `resume_after_reset` and real Terminal delegate. Implement Notifications `pause_for_reset`, `resume_after_reset(bool)`, `prepare_notification_reset_in`, `reset_notifications_in`, `publish_notification_reset`. Phase 1 unsaved-file count is zero; no Files owner is created.

- [ ] Add barrier-driven test with a notification worker waiting for a read permit while reset holds the write permit. Red expectation: pause cannot finish under the old true-Quit/flush path; use a bounded timeout to diagnose a deadlock, not a timing sleep to establish ordering.
- [ ] Run explicit data contract and full `--lib` commands from Task 1 for red/green. Every runtime test injects fake process/content ports; real owner graph tests use only temp project and controlled fixture process resources.
- [ ] Pause notification source/effect admission and await already admitted work, cancelling read-permit waits. Keep queue/service alive. Runtime impact/shutdown/pause/resume must remain gate-free and async; no `block_on` in production reset adapters.
- [ ] On partial runtime failure resume every paused owner, return `RuntimeCleanupFailed`, and open no reset transaction. Test pause failure and Session/Terminal cleanup failure separately; already stopped sessions are not promised to resurrect.
- [ ] Reset Notifications in the shared transaction. Check affected count, preflight revision overflow, hold projection until commit, publish zero unread after commit. Committed resume drops queued pre-reset candidates/dedupe through the pause barrier; aborted resume retains/reconciles them. Late old-session events cannot resurrect inbox rows/toasts.
- [ ] Serialize true-Quit and maintenance admission: active maintenance completes before Storage closure; no new maintenance once Quit is accepted. Test both race orders and ordinary session creation waiting until reset resumes. Do not use true-Quit to implement reset or leave Terminal/Sessions permanently unavailable.

### Task 5: Orchestrate export, previewed import and transactional reset

**Outcome:** Real Phase 1 data round-trips and every failure has a precise durable/runtime outcome.

**Depends On:** Tasks 1–4.

**Files:** Modify `src-tauri/src/settings/data.rs`, `settings/data_participant.rs`; create `src-tauri/src/storage/backup.rs` and export it from `storage/mod.rs` as a thin transaction callback helper with no domain imports; extend `src-tauri/tests/data_management_contract.rs`.

**Interfaces:** Consume immutable participant registry, Storage transaction, shared gate, native/clock/event seams and reset runtime. Produce service operations backing the nine commands in Task 6 and `data://changed { kind: backup_imported | app_reset }`.

- [ ] Create service-level integration fixture using real Projects, Settings, CLI Profiles, Shortcuts and Notifications owners, all on one temp Storage and shared gate. Seed through public APIs/owner fixture helpers, not the production app profile.
- [ ] Add discoverable tests first. Red expectation: reset leaves seeded core rows, or a second participant failure leaves the first participant's rows changed; record the failing behavioral assertion. Run the explicit data contract command from Task 1.
- [ ] Export: picker → await write gate → one consistent snapshot transaction → release gate → cap/serialize → atomic write. No source content/secret access or change event; no permit held during picker/file I/O.
- [ ] Prepare import: bounded read/strict parse → write gate → read snapshot and owner preparation → immutable package/plans/fingerprint → release gate → preview. Canonical fingerprint includes all merge-relevant owner state, not just counts or unstable runtime availability; preserve metadata and revisions required to detect same-count edits.
- [ ] Confirm import: validate request → write gate → recompute in one latest transaction → compare deterministic fingerprint/summary. Changed preview returns `ImportPreviewChanged` and refreshed pending plan without writes, requiring another confirmation. Stable preview applies Projects → Settings → CLI Profiles → Shortcuts in the same transaction.
- [ ] Confirm reset: validate ID/kind/TTL and trimmed case-sensitive `RESET` before side effects → write gate → recount current impact → pause/cleanup runtime → one transaction. Reset order is Notifications → Shortcuts → CLI Profiles → Settings → Projects. Keep DB file, migrations/user_version, built-ins, existing cleanup queue and logs. Source trees stay byte-identical.
- [ ] After commit publish Projects → Settings → CLI Profiles → Shortcuts → Notifications (reset only), resume runtime for reset, then try one aggregate event. Release permit before `retry_credential_cleanup`, which reacquires read admission. Count pending cleanup through a public CLI owner query/projection, never coordinator SQL.
- [ ] Adopt an operation-owned async task once apply begins, so caller cancellation/window loss cannot abandon a committed transaction before publication/resume or reopen admission early. Test dropped awaiting caller at a deterministic apply barrier; task must finish commit/publication or rollback/resume exactly once. No detached transaction with prematurely dropped write permit.
- [ ] Run all matrix cases below and explicit contract target; expected durable state, cache/subscription records, event counts and fake OS call trace must agree.

#### Required failure and isolation matrix

| Scenario | Exact injection / fixture seam | Expected observable result |
|---|---|---|
| Invalid/missing/stale/wrong-kind/expired/double request; wrong RESET case | Deterministic request clock/counter and service calls | No runtime stop, write, event or credential access; typed error; valid cancel clears pending only |
| Picker cancelled or native read/write failed | Fake picker and operation fault adapter | Cancelled or sanitized I/O error; previous destination/state unchanged |
| Snapshot/domain validation failed | Participant decorator fails export/prepare for each core domain | No backup success or DB writes; gate released; subsequent valid operation succeeds |
| Same counts but changed local settings/profile/project | Public owner mutation between prepare and confirm | New preview, no apply; second confirm uses new fingerprint |
| Participant apply fails after previous participant wrote | Test participant decorator delegates real write then returns error, iterate every apply/reset position | All rows and outbox rollback; caches/subscribers/aggregate event unchanged |
| Transaction begin fails | Second isolated SQLite connection holds write transaction with test busy timeout | Persistence error, no publication; reset resumes Aborted if runtime already stopped |
| SQLite commit fails | Test-only transaction callback inserts deferred FK violation in disposable fixture tables on the temp DB | Commit fails rather than apply; all domain changes roll back; no projection publication; no credential delete |
| Runtime impact/pause/cleanup fails | Recording runtime port at each await boundary | RuntimeUnavailable/RuntimeCleanupFailed; no reset transaction; paused workers resume; partial stop limitation explicit |
| Failure after runtime stopped, before commit | Same transaction faults plus runtime trace | Data retained, no success event, runtime resume Aborted; retry remains usable |
| Event emitter or credential delete fails after commit | Failing event sink/fake keyring delete | Success reflects committed state; no rollback; outbox retained and retry eventually clears it |
| Concurrent mutation, worker, session creation and Quit | Barriers/polling plus existing shared gate | No nested gate deadlock, no partial publication, no Storage close during operation, no repeated apply |
| Secret exclusion | Distinct secret canary plus recording credential store; capture serialized DTO/error/event and any new logging sink | Zero canary bytes in backup/SQLite/public output/log; export/prepare make zero credential reads; refs only in backup internal data |
| Source/app-data preservation | Temp source/log canaries and schema/table inventory before/after reset | Source/log bytes and database path/schema retained; only intended rows/defaults/outbox differ |
| Startup failure | Inject app-data path pointing to an existing temp regular file; inject invalid participant registry | Setup fails before Data service becomes usable; no default profile fallback/native call or partial ready state |

All project path inspection uses fake resolver/temporary paths. CLI command/environment/shell lookup and keyring are injected; no inherited secrets and no execution of imported CLI metadata during import. Mock app constructors must replace OS notification, clipboard, dialog and opener as well as app-data. No process-global HOME/APPDATA mutation and no real reset/manual smoke in the user's current profile. Test-only fault hooks are local Rust constructors/decorators, never commands. Deferred-FK fixture tables are disposable test schema, not product migrations.

### Task 6: Wire production composition, commands and generated bindings

**Outcome:** FE-015 receives the exact real command contract through an app-managed BE-012 service.

**Depends On:** Task 5.

**Files:** Modify `src-tauri/src/app/mod.rs`, `src-tauri/src/settings/mod.rs`, `settings/data.rs`, `src-tauri/tests/app_builder.rs`, `src-tauri/tests/export_bindings.rs`, `src-tauri/tests/data_management_contract.rs`; generate `src/bindings/data-management.ts`. Modify `src-tauri/src/lib.rs` only if required for public module exports.

**Interfaces:** Register `get_data_location`, `open_data_location`, `copy_data_location`, `export_backup`, `prepare_import_backup`, `confirm_import_backup(request_id)`, `prepare_reset_xwork`, `confirm_reset_xwork(request_id, confirmation)`, `cancel_data_operation(request_id)`. This is **nine commands**; the numbered feature flow is not a tenth command. Use exact signatures/DTOs from BE-012. Add `configure_with_data_management_for_tests` with full injected OS/runtime collaborators and a temp path; production uses the real existing owners and plugins.

- [ ] Add invoke tests for every command and a non-main window. Red expectation: invoke handler reports missing command before wiring; unauthorized-window tests must later return `UnauthorizedWindow` with zero collaborator side effects.
- [ ] Initialize registry only after existing migrations and owner hydration; share the single gate and runtime graph. Reuse already registered dialog/opener/clipboard plugins; do not register duplicates or add webview plugin ACL permissions. No new migration.
- [ ] Test startup injection cases from the matrix, shared gate identity, real managed participant ownership, isolated composition and Quit coordination. Native plugin registration inspection is not permission to call OS APIs in tests.
- [ ] Extend existing aggregate ts-rs generator in `tests/export_bindings.rs`; do not create a generator binary. Test exact tagged enum field casing and error payloads. First generation intentionally fails with the existing regeneration notice; rerun and record a clean no-diff pass.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder --all-features -- --test-threads=1`, `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings --all-features -- --test-threads=1`, and the explicit data contract target. All tests pass, generated output matches Rust and no arbitrary-path command exists.
- [ ] Compare command registration and capability diff against the nine-command list and current capability files. Confirm no Files/Notes/Calendar module or migration was added. Negative scope assertions use file/registration diff inspection, not fictional Tauri APIs.

## Final Verification

Run sequentially from the root on Windows, with `$env:CARGO_BUILD_JOBS = '1'`. Preserve genuine first-run failures and fixes in execution evidence; do not report reruns as the only history.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No format errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Type check | `pnpm typecheck` | Generated contract and existing consumers compile |
| Frontend tests | `pnpm test` | All tests pass |
| Frontend production | `pnpm build` | Build succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | No warnings |
| Rust full suite | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- --test-threads=1` | All unit/integration/contract targets pass serially |
| Windows desktop | `pnpm tauri build` | Current Windows release executable build succeeds; do not enable bundling just for this feature |
| Whitespace | `git diff --check` | No whitespace errors |

Every new colocated test is covered by `--lib` and the final all-target gate; each named integration test file has its explicit target above. Existing regression targets are covered by the all-target suite. Tests must report actual nonzero counts. All new tests isolate user-owned state even though the Rust harness runs serially.

Native follow-up, only in a verified disposable Windows profile: confirm displayed data location belongs to that profile, picker cancel/overwrite/Unicode filenames, locked-destination error and preserved bytes, open/copy correct folder, export/import real fixture data, start only controlled fixture sessions and reset through FE-015 once available, verify window remains open and new sessions work, and verify fixture source/log preservation. Do not run reset on the current profile. Record profile isolation evidence, observed results and timing. Measure snapshot/preview against the spec's <500 ms target on documented fixture size/hardware; no invented p95 claim. Carry prior native/p95 pending status unchanged.

## Deviations and Decisions

- Implementation is being performed directly in the workspace without an independent review, subagent dispatch or commit, as authorized by the user.
- Stage 13 decisions are recorded in BE-012 using work-dd under the user's delegated decision authority.
- Reuse existing adapters, owner APIs, gate and test-based generator. Complete actual gaps rather than scaffold future capability contracts.
- Only nine public commands exist in the spec; implementation and completion checks must use nine. No extra endpoint is justified.
- Full gates require one Cargo build job and `--test-threads=1`; package `test:rust` alone omits required flags and is not sufficient.
- Parent alone may commit `Implement BE012` after implementation is verified. Sol medium updates this active plan with evidence and returns exact changed paths, passed checks and remaining native limitations; it does not commit.

## Execution Evidence

- 2026-09-06 implementation milestone: added the strict v1 Data Management coordinator, owner participants, native data adapter, reset-specific runtime/Notifications lifecycle, nine Tauri commands and generated `src/bindings/data-management.ts`. Tests use temporary Storage and injected fake runtime/platform/event collaborators; no production profile, credential payload or user project source was opened, imported, exported or reset.
- Focused test development exposed and fixed: generated binding drift; one over-broad secret-text assertion; a nested Tokio runtime in the mock-app fixture; the expected Settings revision after reset; Clippy findings for a unit error type and a large pending-operation enum; and use of `tokio::select!` without the pinned macro feature. The final notification cancellation barrier uses the existing Tokio time feature and adds no dependency.
- Current Rust evidence: `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j1 -- --test-threads=1` passed **478/478** tests on the final strict-parser code. This includes **273** library tests, **36** `data_management_contract` tests, **15** `app_builder` tests and **10** `export_bindings` tests. `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and serial `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j1 -- -D warnings` also passed on the final code.
- Frontend evidence from the implementation run: `pnpm format:check` passed across **261** files; `pnpm lint` passed across **261** files; `pnpm typecheck` passed; `pnpm test` passed **1,861/1,861** tests in **103** files; and `pnpm build` passed with only the pre-existing chunk-size advisory.
- Windows desktop evidence: `pnpm tauri build` passed and produced `src-tauri/target/release/xwork.exe`. The build reported only the existing `.app` bundle-identifier advisory and frontend chunk-size advisory. Final reruns of `pnpm format:check`, `pnpm lint` and `pnpm typecheck` also passed.
- Repository hygiene evidence: `git diff --check` passed. Final status remains based on HEAD `21872c1`; no commit was created, and no FE-015, migration or capability file was changed.
- Native smoke is intentionally not run because no verified disposable Windows profile is available. Data location, picker/clipboard/opener behavior, locked-destination replacement, FE-driven reset and the native <500 ms measurement remain pending; automated mocks/builds are not recorded as substitutes.

## Outcome

Backend implementation and automated behavior coverage are complete and ready for the parent to commit as `Implement BE012`. FE-015 and isolated-profile native smoke remain separate stage work, so this plan does not claim the whole stage complete.
