# BE-014 File Read and Watch — Stage16 Implementation Plan

**Status:** Planning complete; ready for Sol medium implementation. No implementation or commit performed.

**Goal:** Deliver the stage16 Rust file read/watch capability, isolated persistence and lifecycle integration, and public Recent Files/Unified Search contracts without writing project source files.

**Completion Criteria:**

- Six main-window commands open/query/reload/resolve/open-externally/list-recent through BE-014; text, binary, oversized, missing, unreadable and root-changed states are observable through real owner APIs and mock IPC.
- Native hints, fallback, focus reconciliation, pending attach, close/reopen and reset preserve bounded runtime ownership and never resurrect discarded handles or edits.
- Migration 6 persists at most 50 recent entries per project; search uses owner-filtered regular files with bounded candidates and existing source deadlines.
- Generated Files/Search bindings and minimal existing-consumer compatibility pass frontend gates; Windows Rustfmt, Clippy, sequential tests and Tauri build pass for the final implementation snapshot.
- Native smoke and metrics have actual isolated Windows evidence or remain explicitly pending. Backend automated completion does not establish FE-017, stage16 UI acceptance, stage17 or Phase 2 completion.

**Architecture:** Extend the existing Files capability and reuse BE-013 path policy, ignore walker and two-worker admission semaphore. Projects and Sessions remain authoritative through public queries and a Files-owned dependency port; app composition adapts them and weakly binds the existing pane-content router. Files owns runtime buffers/watchers and recent SQL; Search and reset consume public typed contracts only.

**Tech Stack:** Existing Rust 1.98.0/Edition 2024, Tauri 2.11.5, Tokio 1.53.1, rusqlite 0.40.2, ts-rs 12.0.1, ignore 0.4.33, official opener 2.5.5; add only the three exact entries below. Existing TypeScript/React/Vitest/Biome tools validate generated-contract compatibility.

**Sources:**

- `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`.
- `00-Docs/98-Plan/00-Roadmap.md`, stages 15–17 and backend-before-frontend ordering.
- `00-Docs/00-Overview/01-TechStack.md`, `02-ProjectStructure.md`, `03-FunctionalRequirements.md` in that same directory; especially requirements §2, §7.5, §8–9, §11.2–11.3, §14, §18, §20.
- `00-Docs/03-Backend/BE-014-file-read-and-watch.md` is the behavior/DTO authority, including its stage16 integration note.
- `00-Docs/03-Backend/BE-013-file-tree.md`, `BE-002-storage-foundation.md`, `BE-003-projects.md`, `BE-005-sessions-runtime.md`, `BE-010-unified-search.md`, `BE-012-backup-and-reset.md`, and `BE-015-markdown-save.md` in the same backend directory.
- `00-Docs/02-Frontend/00-Overview.md`, `FE-005-project-overview.md`, `FE-009-command-palette.md`, `FE-016-file-explorer.md` in that frontend directory. FE-017/FE-018 detailed designs do not yet exist; their overview rows and wireframes establish downstream scope, not permission to create them in this task.
- `00-Docs/01-Wireframe/05-Files.html#source`, `#unsupported`, `#md-conflict`; `04-Projects.html#overview`; `02-AppShell.html#palette` in the same wireframe directory. Markdown editor anchors describe later consumers of the runtime hook, not stage16 editing UI.
- Current `src-tauri/src/files/`, `src-tauri/src/app/{mod,data_runtime,search_sources}.rs`, `src-tauri/src/search/`, `src-tauri/src/settings/{data,data_participant}.rs`, migration registry, manifests, binding exporter and existing integration fixtures.
- Historical context only: `00-Docs/98-Plan/20260906-be-013-file-tree.md` and `20260906-fe-016-file-explorer.md`; never update them for this implementation.

## Scope

**In Scope:**

- Reader/classification/fingerprint, bounded handle manager, watcher worker, clean reload and read-only external-change states.
- The existing BE-014 in-memory Markdown editor snapshot hook, dirty/conflict and close semantics, tested through Rust only; six documented commands including conflict resolution, with no edit transport.
- Recent Files migration/query/upsert/prune/reset-only integration; Files search owner query and BE-010 adapter/source/DTO activation.
- Existing app lifecycle/router/focus integration, generated bindings, regression tests and only the TypeScript union compatibility necessary before the next FE task.

**Out of Scope:**

- FE-017 design/plan/implementation, FE-005 recent block and FE-009 file activation/new-tab/split UI; these follow the coordinating task's backend commit.
- BE-015 filesystem writes, Markdown edit/save commands, save/preview/CodeMirror, content index, tree watching, generalized filesystem permissions, unrelated refactors and dependency upgrades.
- Desktop E2E, macOS validation, real user profile/app-data/project access, subagents, independent review, staging or commits in this task.

## Global Constraints

- "Write code, identifiers, and code comments in English."
- "The initial UI language is English."
- "Every function, method, callback, test, and helper must have a short comment describing its purpose."
- "Generated bindings under `src/bindings/` are not edited manually."
- "Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state."
- "Do not rely on process-global environment mutation for test isolation when tests may run concurrently."
- "During development, build and test only on Windows."
- "Do not add or run automated desktop end-to-end tests."
- OS/filesystem/SQL/hash work runs outside async workers. Never hold a handle-map, watcher, Sessions or Storage lock over I/O or await. Handle operations serialize with a revision/operation guard; all Files scans/reads share the existing two-worker semaphore.
- Source content, raw errors, queries, hashes and absolute paths never enter logs. Custom commands stay main-window-only; webview capabilities gain no filesystem/opener permission.

## Assumptions, Risks, and Blockers

**Assumptions:**

- The user's stage15 committed/code-gates-complete baseline is accepted; prior native smoke/metrics remain pending. Initial working tree was clean. Do not manufacture new test counts from earlier records.
- The user authorizes resolving planning questions without another question. The BE-014 note records the scope decisions; its open-question section remains empty of unresolved decisions.
- Markdown mode is metadata, not authorization to edit. Stage16 renders all text read-only; the Rust-only hook remains necessary for BE-014 conflict/lifecycle tests and the later BE-015 owner.

**Current-code differences to implement explicitly:**

- Files currently has only tree operations and `FilesService::new(projects, reveal)`. Its path intents already include `OpenVisibleFile`/`ExistingHandleFile`; extend this implementation rather than adding a parallel policy.
- `PaneContentRuntimeRouter` is in `app/data_runtime.rs`, not a new router module. It currently weak-binds Terminal only. Setup currently constructs Files before Sessions; reorder dependency assembly before Search/Data setup and bind Files once.
- Search currently has Projects/Sessions/Commands only in `search/mod.rs` and `search/service.rs`; the Files port and candidate types in BE-010 are future contracts, not existing symbols.
- Reset currently uses concrete `DataParticipants`/`ResetCommittedProjections` and a single transaction in `settings/data.rs`. Add the Recent Files typed reset-only participant there. Keep existing Notifications behavior and apply/publish order; do not replace the entire backup coordinator with a future-phase registry.
- Adding Search union variants requires an explicit File branch in `src/app/search-entry.tsx` and a Files label in `search-error-copy.ts`. File activation is disabled with explanatory copy until the next FE task; do not route File through the Command branch.

**Risks:** Read/replace races, growth during bounded read, watcher loss, attach/close/reset interleaving and recent-lock deadlocks are covered by deterministic seams plus temporary filesystem integration below. Search's tree API includes directories and a different result cap: do not obtain candidates by truncating tree results then filtering directories.

**Blockers:** None for Sol medium implementation. Missing FE-017 design and unperformed isolated native validation block later UI/native acceptance only. The plan does not authorize running a production binary in the normal Windows account.

### Exact dependencies and compatibility evidence

Add these complete entries to `[dependencies]` of `src-tauri/Cargo.toml` and update only the necessary resolution in `src-tauri/Cargo.lock`:

```toml
notify = "=8.2.0"
mime_guess = "=2.0.5"
blake3 = "=1.8.7"
```

Keep default features as shown; do not add a debouncer crate, polling crate, hash wrapper, Tokio upgrade or JS dependency. Reuse existing `windows-sys` FileSystem features and `tempfile = "=3.27.0"` dev dependency.

On 2026-09-06, `cargo info` verified all three exact published versions. [notify 8.2.0](https://docs.rs/crate/notify/8.2.0) declares Rust 1.77 and Windows ReadDirectoryChangesW; [mime_guess 2.0.5](https://docs.rs/crate/mime_guess/2.0.5) provides extension hints. `cargo info blake3@1.8.7` resolved the published [BLAKE3 release](https://crates.io/crates/blake3/1.8.7); mime_guess and blake3 did not declare an MSRV in that output, so none is invented here.

All three exact entries compiled together with `cargo +1.98.0 check --manifest-path C:/Users/ntnha/AppData/Local/Temp/xwork-be014-deps-a3b46ae219cc457da046a7c17d313a0c/Cargo.toml --all-targets --all-features --jobs 1` on this Windows host, exit 0. The probe was an empty library with only these dependencies; 38 packages resolved. This verifies dependency/toolchain compatibility, not application integration or a Tauri build. The real application lockfile and complete gates remain implementation work.

## Dependency Order

1. DTO/error and migration/repository foundation → reader and durable recent operations.
2. Validated reader/fingerprint → runtime handle state and watcher reconciliation.
3. Runtime/service/lifecycle → actual open/close and six commands.
4. Recent/reset transaction integration → reliable maintenance behavior.
5. Public search adapter and generated-contract compatibility → downstream FE handoff.
6. Final Windows gates and evidence → coordinating task can commit the backend before FE design/plan.

Run tasks and all cargo invocations sequentially. Do not spawn a separate reviewer or implementation subtask from this plan.

---

### Task 1: Establish DTOs, migration 6 and the Recent Files repository

**Outcome:** Typed contract and bounded durable storage exist without runtime or source writes.

**Depends On:** None.

**Files:**

- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/files/models.rs`, `error.rs`, `mod.rs` in the same Files directory; `src-tauri/src/storage/migrations.rs`.
- Create: `src-tauri/migrations/0006_create_recent_files.sql`, `src-tauri/src/files/repository.rs`.
- Test: unit modules in models/repository/migrations; modify `src-tauri/tests/storage_foundation.rs`; create `src-tauri/tests/files_read_watch_commands.rs` for the later public flow.

**Interfaces:** BE-014 DTOs/errors, `RecentFilesResetPlan`/`RecentFilesResetProjection`, existing `Storage::with_connection`/`with_transaction`. Test-only repository fixtures inject an in-memory connection with real migrations and a supplied `now_ms`; no system clock or app path resolution.

- [ ] Add exact dependencies and DTO declarations with executable serialization assertions. Add a discovered integration test for migration 6 using existing Storage initialization; initially assert `PRAGMA user_version = 6` and table/index/FK existence against the current version-5 registry.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml --test files_read_watch_commands --jobs 1 -- --test-threads=1`. Expected initial red: observed user_version is 5 instead of 6, not a missing test target or unresolved import. Add callable minimal skeletons before any later red test that needs new symbols.
- [ ] Copy the exact BE-014 SQL and registry name `create_recent_files`; preserve versions 1–5. Implement bound upsert/prune, key normalization, sorted query and checked timestamp `max(now, max + 1)` in one transaction.
- [ ] Test 51 opens prune to 50, tie/backward clock monotonicity, default/list limit validation, casing updates, FK cascade, negative/overflow timestamps and no persisted content. Inject invalid SQL into a test-only migration registry: failure leaves user_version 5 and no partially created table; production migration SQL stays immutable.
- [ ] Run the focused integration target again, then `cargo test --manifest-path src-tauri/Cargo.toml --lib --jobs 1 -- --test-threads=1` and `cargo test --manifest-path src-tauri/Cargo.toml --test storage_foundation --jobs 1 -- --test-threads=1`. Expected: actual schema/FK/index/order/rollback assertions pass; update only assertions that legitimately assumed latest schema 5.

### Task 2: Read validated files into consistent bounded snapshots

**Outcome:** Classification and fingerprints obey path security and one-retry consistency without source writes.

**Depends On:** Task 1.

**Files:** Create `src-tauri/src/files/reader.rs`; modify `src-tauri/src/files/path_policy.rs`, `walker.rs`, `service.rs`, `mod.rs`; test reader/path-policy unit modules and `src-tauri/tests/files_read_watch_commands.rs`.

**Interfaces:** Existing `FilePathPolicy::{resolve,revalidate,identify_root}`, `ProjectRootIdentity`, `ValidatedProjectPath`, `FilePathIntent::{OpenVisibleFile,ExistingHandleFile}` and `FileTreeReader::is_visible`. Produce reader-owned `PlatformFileIdentity`/`DiskFingerprint` and BE-014 content/disk snapshots. Test-only reader interleave callback runs at stat/open/read boundaries; injected read/stat failures and bounded-read byte counters remain private to reader tests.

- [ ] Add a callable reader skeleton and a test expecting a 5,242,880-byte valid UTF-8 fixture to return Text, then test 5,242,881 bytes returns TooLarge. Run the `--lib` command from Task 1; the red assertion must report the wrong classification/reader error, not an undiscovered function test.
- [ ] Resolve fresh opens with visibility and handle operations with captured identity. Revalidate components before/after open and inspect opened-file metadata/identity with Windows no-follow/reparse handling; never construct raw joined action paths in service code.
- [ ] Bound viewer reads at limit + 1, inspect TooLarge before Binary before Text, reject NUL/invalid UTF-8 losslessly, preserve newline bytes, strip only UTF-8 BOM from text, derive exact logical line count and MIME/syntax hints. Only `.md`/`.markdown` case-insensitively receive Markdown mode.
- [ ] Hash raw bytes including BOM using blocking streaming. Oversized files never allocate content-sized buffers; a streaming digest, when needed by the snapshot, uses fixed-size chunks and must still obey before/after consistency checks. Detect size growth/replacement and retry once; a second injected change returns `FileChangedDuringRead` and no mixed text.
- [ ] Test empty, BOM-only, LF/CRLF/mixed/trailing break, NUL at the last byte, invalid UTF-8, unknown extensions, extension spoofing, replacement identity and same-size content changes. Include traversal/absolute/UNC request rejection, real temporary junction/link when permitted and mandatory reparse-unit coverage when creation is unavailable.
- [ ] Run `--lib` and `--test files_read_watch_commands` sequentially with `--jobs 1 -- --test-threads=1`. Expected: exact classification/fingerprint/security assertions pass, fixed buffer bounds are observed and two concurrent Files workers remain the global maximum.

### Task 3: Attach runtime handles, reconcile watchers and route lifecycle

**Outcome:** Six commands expose authoritative file state; watcher, pane and buffer ownership are bounded and race-safe.

**Depends On:** Tasks 1–2.

**Files:** Create `src-tauri/src/files/handles.rs`, `watcher.rs`; modify `src-tauri/src/files/{service,platform,commands,models,error,mod}.rs`, `src-tauri/src/app/mod.rs`, `src-tauri/src/app/data_runtime.rs`; tests in handles/watcher/service and `src-tauri/tests/{files_read_watch_commands,app_builder,files_tree_commands}.rs`.

**Interfaces:** Implement BE-014 `FileDependencies::{resolve_empty_pane,available_project_root,ordered_project_ids,attach_file}` via `SessionManager::{get_session,attach_runtime_content}` and `ProjectService::{available_root,ordered_project_ids}`. Produce `FileHandleManager` lifecycle methods `close_impact`, `close_for_session`, `reopen_for_session`, `discard_for_session`; `FilesService::reconcile_open_files` and `replace_editor_snapshot(file_handle_id, FileEditorSnapshot)`; six commands `open_file_in_pane`, `get_open_file`, `reload_open_file`, `resolve_external_file_change`, `open_file_with_default_app`, `list_recent_files`. Events are exactly `files://handle-changed` and `files://recent-changed` with BE-014 payloads.

**Test-only interfaces:** Extend `configure_with_files_for_tests` with injected Files collaborators, keeping its explicit temporary app-data path and fake Projects platform. Supply a clock returning epoch Result, a recording event sink, a recording/failing opener, a fake parent-watch factory (watch/unwatch/failure counters), controlled hint sender and fake scheduler/clock. Native watcher tests opt in to a real watcher only for TempDir parents. A dependency fake blocks attach at a channel barrier or returns `SessionAttachFailed`; read barriers and worker-drain acknowledgements expose pending races without sleeps. No generic global environment override is introduced.

- [ ] Add discovered main-window invocation tests against registered command skeletons. Initial red: valid empty-pane open returns the skeleton error instead of an attached File; non-main invocation must already reject before collaborator counters increment. Use explicit `--test files_read_watch_commands`.
- [ ] Compose Storage/gate/Projects, Sessions/router, then Files and the weak Files bind before Search/Data setup. Keep Terminal delegation intact. Test absent/double Files bind returns setup failure and a dropped manager cannot be upgraded; do not create a strong Files↔Sessions cycle.
- [ ] Validate clock before pending attach; reserve the 64 attached+retained handles/64 MiB text budget atomically. Pending state is visible only to internal lifecycle coordination, not normal snapshot queries. Sessions attach is the final authority; on failure release buffer/watch/reservation with no event/recent row. Preserve pending hints and reconcile after publication. Handle close between attach/publication must retire the pending entry, never leak or resurrect it.
- [ ] Watch each parent NonRecursive with follow-symlinks false; ref-count across handles, queue capacity 1,024, debounce 100 ms, overflow reconcile-all, metadata fallback every 2 s after watch installation failure. Native callback only queues hints. Main-window focus dispatches full reconciliation through managed Files; use the app window-event composition hook, not webview filesystem access.
- [ ] Reconcile outside map locks, commit under a same-handle guard and emit only after a real revision change. Duplicate fingerprints are no-ops. Clean text→binary/too-large/missing/unreadable transitions are explicit. Root relocation sets ProjectRootChanged, releases old watch and stops old-root reads. Restore events are tested after missing files reappear.
- [ ] Implement the BE-014 Rust-only Markdown hook and one previous-clean watcher revision race aid exactly as specified: derived dirty timestamp/edit count, identical retry no-op, return-to-base clean, watcher-first edit preserved as conflict, other stale tokens rejected. Source/Binary/TooLarge cannot become dirty. KeepMine changes only memory/base; ReloadFromDisk discards only after a successful current disk read; a second disk change updates conflict and returns FileChangedAgain.
- [ ] Include every live/retained/recovery text allocation in budget accounting. A reconciliation that cannot reserve its new buffer must retain the last valid snapshot and report `FileMemoryLimitReached` through the operation; the worker logs only the safe category and retries on a later hint/focus. Never silently exceed budget or evict dirty content.
- [ ] Close releases parent watch at zero refs, discards confirmed local edits, retains only clean reopen identity/snapshot when requested. Reopen revalidates and reads current disk, never restores discarded edits. Dispose retained tokens on project removal/Quit. Reset drains current handles/watch work through Sessions; the reusable Files service must accept fresh opens after reset resumes, while final application shutdown terminates workers.
- [ ] Test attach failure, watch factory failure→PollingFallback, clock failure→no pending handle, event sink failure→committed queryable state, opener failure→OpenExternalFailed, startup fatal bind failure→no leftover worker. Fake time covers debounce/2-second schedule/overflow and multi-handle fanout; barrier tests cover close/read/reset races, checked revision overflow and memory cap admission.
- [ ] Run `--lib`, `--test files_read_watch_commands`, `--test app_builder`, `--test files_tree_commands` sequentially, each with `--jobs 1 -- --test-threads=1`. Expected: six new commands and four old tree commands behave correctly; no binding/setup/cycle leaks or real OS launch. Native temporary watch tests use event conditions with bounded deadlines and record unsupported delivery separately, never hide deterministic failures as skips.

### Task 4: Commit recent metadata and integrate reset without duplicate cleanup

**Outcome:** Open attaches independently of recent persistence; reset deletes recent metadata atomically with other domains.

**Depends On:** Task 3.

**Files:** Modify `src-tauri/src/files/{repository,service,models,mod}.rs`, `src-tauri/src/app/mod.rs`, `src-tauri/src/settings/data.rs`, `src-tauri/src/settings/data_participant.rs`; create `src-tauri/src/app/data_reset_participants.rs`; modify `src-tauri/tests/data_management_contract.rs`, `src-tauri/tests/files_read_watch_commands.rs` and affected construction fixtures in `src-tauri/tests/app_builder.rs`.

**Interfaces:** `list_recent_files(project_id, limit)`; `prepare_recent_files_reset_in(tx)`, `reset_recent_files_in(tx, plan)`, `publish_recent_files_reset(projection)` per BE-014. Add the BE-012 typed RecentFiles arm and `DataResetOnlyParticipant` adapter with `domain`, `prepare_reset`, `apply_reset`, `publish_after_commit`; add only current-phase types to the existing concrete participant collection. `DataResetContext` carries the already-owned reset facts defined by BE-012. Keep Notifications on its working concrete path; no Reminders/Notes/Events stub. Reuse the existing shared `DataMaintenanceGate` without recreating or modifying it unnecessarily.

**Test seams:** Existing isolated DataManagement fixtures inject Storage/clock/runtime. Extend their participant construction with a real Files service on temporary roots and fake watchers; use a transaction-local SQLite trigger to abort recent upsert/delete, and fake runtime cleanup returning failure. Channels observe permit acquisition/commit/publish order; no production DB corruption or process-global clock changes.

- [ ] Add tests that a successful pane attachment records recent and reset removes that row. Run `--test files_read_watch_commands`/`--test data_management_contract` sequentially; initial red is the missing recent row or remaining row after reset while the established open/reset path otherwise succeeds.
- [ ] After attach/publish, await maintenance read permit, then recent mutation gate, then Storage transaction; release no earlier than commit/event enqueue. SQLite failure returns `RecentFileNotRecorded` while the pane remains attached; failed attach has no SQL. Binary and TooLarge opens count as recent.
- [ ] Recent query defaults to 10, accepts 1–50, validates row availability outside DB lock, retains missing/ignored/link rows and returns stable sort. Merge `is_open` and `has_unsaved_changes` from attached runtime handles; read/search never update timestamps or acquire the mutation permit.
- [ ] Prepare count and sorted affected project IDs inside the coordinator transaction; apply one DELETE and require exact count; owned plans/projections hold no guard/connection/callback. Reset write-permit code never calls normal gated repository APIs or nested Storage. Preserve Notifications→Recent Files→existing core reset order and core→Recent Files→Notifications publish order.
- [ ] Test transaction rollback from the injected failure preserves all domain rows and emits no recent event. Test count mismatch, zero-row reset, sorted per-project postcommit invalidations, emit failure not reversing success, maintenance interleaving, exactly-once Sessions cleanup and failed runtime cleanup leaving durable data unchanged. Verify backup shape excludes recent rows and source content before/after this extension.
- [ ] Run `--lib`, `--test data_management_contract`, `--test files_read_watch_commands`, `--test app_builder` sequentially with the standard jobs/thread flags. Expected: rollback/ordering/no-duplicate-cleanup assertions pass and a new session/file can open after successful reset.

### Task 5: Publish bounded Files search and compatible generated contracts

**Outcome:** Search can query real openable file identities; current frontend remains compilable and refuses unsupported activation until FE implementation.

**Depends On:** Tasks 3–4.

**Files:** Modify `src-tauri/src/files/{walker,service,models,mod}.rs`, `src-tauri/src/app/{search_sources,mod}.rs`, `src-tauri/src/search/{mod,service,ranking}.rs`, `src-tauri/tests/unified_search_contract.rs`, `src-tauri/tests/export_bindings.rs`; generated `src/bindings/files/files.ts` and `src/bindings/search.ts`; modify `src/app/search-entry.tsx`, `src/app/search-entry.test.tsx`, `src/features/search/search-error-copy.ts`, `src/features/search/search-error-copy.test.ts` only for the declared compatibility bridge.

**Interfaces:** `FilesService::search_openable_files(query, candidate_limit) -> Result<OpenableFileSearchSlice, FilesError>` and public BE-010 `FileSearchSource::search_files`, `FileSearchDocument`, `SearchCandidates<T>`, File target/kind and Files source variants. App adapter enriches project name via `ProjectService::list_projects(None)`; it does not inspect repositories, roots or Files internals.

- [ ] Add a callable Files search source and fake-source tests asserting a Files group and 8-result cap. Run `cargo test --manifest-path src-tauri/Cargo.toml --test unified_search_contract --jobs 1 -- --test-threads=1`; initial red is absent Files results from a source fixture containing matching documents, not an import error.
- [ ] Extend owner walker with a regular-file candidate slice under the same project-local ignore/no-link/scan policy. Validate limit 1–64; match names before candidate cap, preserve Projects order then relative path sort, set has_more honestly. Skip unavailable projects; unexpected walker/registry failure maps to safe source Unavailable. Do not read file contents or use recent SQL as an index.
- [ ] Adapter propagates candidate has_more and maps all details to `SearchSourceError::Unavailable`. Search ranks returned file candidates with the BE-010 Unicode/highlight rules, emits only relative-path File targets and supports_open_in_split metadata, caps each group at 8, and retains 400 ms per-source/500 ms total deadline behavior and successful groups when Files fails. With four active groups the actual maximum is 32, not 48; Notes/Events remain absent.
- [ ] Test >64 matching regular files, many matching directories before regular files, ignore/link exclusions, unavailable projects, deterministic equal ranks, escaping/Unicode highlights, errors and timeouts. Test the documented name-discovery limitation: a project-name-only match does not enumerate every project file. Fakes cover timeouts with controlled time and never sleep through wall-clock deadlines.
- [ ] Extend the existing binding exporter with every BE-014 DTO/error/event plus Search variants. Run `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings --jobs 1 -- --test-threads=1`; the existing generator writes changed output and intentionally fails with `bindings were regenerated; rerun the test to verify a clean output`. Rerun once to verify equality. Do not hand-edit output or treat this expected generation failure as a product red test.
- [ ] Add explicit disabled File availability/activation guard to SearchEntry and Files timeout/unavailable copy. No open invocation, navigation, pane creation, recent UI, icon redesign or split behavior in this bridge. Test File never falls through into command dispatch and source labels never become undefined.
- [ ] Run `--lib`, `--test unified_search_contract`, `--test export_bindings` sequentially with jobs/thread flags; then `pnpm exec vitest run src/app/search-entry.test.tsx src/features/search/search-error-copy.test.ts` and `pnpm typecheck`. Expected: real public adapter returns safe bounded targets; old three sources and the current frontend remain valid.

### Task 6: Verify final Windows behavior and report the sequential handoff

**Outcome:** Implementation evidence is current, reproducible and separated from pending native work.

**Depends On:** Tasks 1–5.

**Files:** Tests listed above and this active plan's checkboxes/Outcome; no historical plan edits. No additional source file is presumed necessary.

**Interfaces:** Real public commands in Tauri MockRuntime, explicit temporary Storage paths, fake OS collaborators, event channels and bounded native watcher tests. Manual validation uses an isolated VM/Sandbox/dedicated Windows test account with disposable project files.

- [ ] Complete temporary native watcher coverage for create/modify/atomic rename-replace/delete/recreate and locked-file behavior with bounded observable conditions. Snapshot fixture paths and bytes before/after read/query/reload/resolve/opener-fake operations; exclude only external mutations deliberately made by the fixture. Assert no content writes from XWork and no access outside the fixture through collaborator observations.
- [x] Execute every final gate below sequentially. Record command, exit status, real collected counts and skip reasons; do not reuse stage15 counts. Fix failures in scope, rerun affected gates and then verify the final snapshot. Full suites must not introduce user-profile access through the extended composition constructor.
- [x] Self-check the focused diff and actual handler registration: exactly six new BE-014 commands, no BE-015 write transport, no filesystem/opener capability expansion, no content logging and no historical edits. This is implementer verification, not an independent review task.
- [ ] If an isolated native environment exists, manually verify main-window focus recovery, background change while hidden, default-app action, close/reopen/Quit and post-reset fresh open using only disposable files. FE source/recent/search activation smoke follows FE-017; no production binary or installer is launched in the developer's normal profile. Record unperformed checks as pending.
- [x] Carry previous Phase 1/stage15 clipboard/reveal, IME, layout/theme/font, terminal resize and native performance metrics forward as pending unless actually measured. Record environment/workload for new read/watch timings and buffer/watch counts; no invented threshold or inherited pass.
- [x] Return paths, decisions, gate evidence and remaining native limitations to the coordinating task. The coordinator performs its authorized backend commit, then stops as directed. This implementer does not commit, launch FE work or request an independent review.

## Final Verification

All commands run from `F:/Self Projects/XWork` on Windows, one at a time. The jobs flag is explicit because the current package wrappers omit it. Never run separate Rust suites concurrently.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Types | `pnpm typecheck` | New generated unions accepted |
| Frontend unit/component | `pnpm test` | All collected tests pass |
| Frontend build | `pnpm build` | Production bundle succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- -D warnings` | No warnings |
| Rust all targets/features | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- --test-threads=1` | All collected tests pass; explicit skip reasons recorded |
| Rust documentation tests | `cargo test --manifest-path src-tauri/Cargo.toml --doc --all-features --jobs 1 -- --test-threads=1` | Pass; report zero doctests honestly if none exist |
| Binding equality | `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings --jobs 1 -- --test-threads=1` | No regeneration on final run |
| Windows desktop build | `$env:CARGO_BUILD_JOBS = '1'` then `pnpm tauri build` | Real production Tauri build succeeds; restore the prior shell value afterward |
| Diff integrity | `git diff --check` and focused `git diff --stat` / `git status --short` | No whitespace errors or unrelated changes |
| Native acceptance | Task 6 isolated manual checklist | Actual observations or explicit pending status |

`CARGO_BUILD_JOBS` is only a temporary build-resource setting, never a test-isolation mechanism. Do not substitute app-data/profile environment variables. The final Tauri build does not authorize installing or launching the app. No desktop E2E runner or macOS build is included.

Every integration test file named in tasks has an explicit `--test` command; unit modules run through `--lib` and the all-target suite. Expected generation failures are distinct from behavior red tests. If a new test initially cannot compile because its intended API is absent, first provide the smallest callable skeleton and collect a behavior assertion failure; never count zero matching tests as evidence.

## Deviations and Decisions

- 2026-09-06: Planning only; authorized self-resolution recorded in BE-014 with `work-dd`. Backend specification updated only for stage16 scope/current integration paths and consumer compatibility; historical plans left untouched.
- Keep the concrete reset coordinator and extend only Recent Files with the typed BE-012 port. Preserve Notifications' working concrete integration and ordered transaction/publish behavior; future owner variants and a whole-registry rewrite are deferred.
- Public Files search uses BE-013 filename discovery; path/project-name ranking enriches returned candidates only. This is explicitly documented rather than claiming exhaustive project-name file search.
- Implement the in-memory dirty/conflict owner hook now because BE-014 specifies it; editing transport/save stays stage17. Test-only callers do not authorize exposing an editor.
- All filesystem fixtures, storage and watchers are isolated; dependency compatibility was checked in a temporary empty Cargo package. No application test/build/native gate was run by the planning turn.
- No independent review, subagent, implementation, staging or commit was performed. Follow the user's sequential model workflow; planning completion is a handoff to Sol medium only.

## Outcome

BE-014 stage16 implementation and all required automated/build gates are complete in the parent workspace. The remaining isolated native acceptance/profile metrics are explicitly pending; no app, installer, external opener, user project file or user-profile fixture was launched or used by this implementation turn. The workspace is ready for the coordinating parent to commit `Implement BE014` and stop.

### Execution Evidence

- 2026-09-06 code milestone: added migration 6 and exact dependencies; implemented Files DTO/errors, bounded reader/classification/fingerprint, recent repository, runtime handles, parent watches, six command handlers, Sessions lifecycle routing, and the Files Unified Search source. `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1` exited 0. This is compile evidence only; reset integration, generated bindings, focused tests, final gates, and native acceptance remain unfinished.
- 2026-09-06 automated-test milestone: `cargo test --manifest-path src-tauri/Cargo.toml --lib --jobs 1 -- --test-threads=1` passed 286 tests; `--test files_read_watch_commands` passed 4 tests after one assertion exposed and fixed enum field casing; `--test files_tree_commands` passed 8, `--test storage_foundation` passed 4, `--test unified_search_contract` passed 2, and `--test data_management_contract` passed 36. The first binding run intentionally regenerated Files/Search outputs and failed 2 of 11 equality tests as planned; a clean rerun remains pending. One `app_builder` expectation still assumed schema 6 was newer than the registry; its fixture was corrected to 7 and the target rerun remains pending.
- 2026-09-06 integration milestone: the expanded `files_read_watch_commands` target passed 5 tests, including real native watcher convergence in a temporary parent, read-only byte checks, binary/oversize classification, main-window authorization, Files search activation, recent listing, typed opener failure, and transaction-owned recent reset. Binding equality then passed all 11 tests, `pnpm typecheck` exited 0, and the focused Search/Files compatibility run passed 102 tests across 3 files. Current work is the final memory-budget/root-change invariant audit and the corrected `app_builder` rerun. Remaining gates are frontend format/lint/full tests/build, Rustfmt, Clippy with warnings denied, Rust all-target/all-feature and doc tests, final binding equality, Windows Tauri build, and diff integrity; native profile smoke/metrics remain pending unless an isolated native environment is available.
- 2026-09-06 watcher/budget milestone: completed the 1,024-entry nonblocking hint queue, 100 ms path coalescing, overflow reconcile-all, 2 s targeted polling fallback, reference-counted shutdown, dirty root-change recovery allocation, and atomic reload/conflict budget checks. Added bounded worker tests and fixed retained-handle reopen at the 64-handle boundary plus idempotent discard. The first final Clippy attempt reached compilation but could not replace `target/debug/xwork.exe` because an existing user-owned `cargo run` process held that file; gates are continuing in the isolated workspace target `.codex-target-be014` without stopping or using that process. Remaining gates are the corrected `app_builder`, frontend full suite/build, Rust all-target/all-feature tests and docs, final bindings, Tauri build, and diff integrity.
- 2026-09-06 frontend gate milestone: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, full `pnpm test` (119 files, 2,109 tests), and `pnpm build` all exited 0. Biome identified and fixed one formatting-only Search source-label layout before the clean format rerun. Vite retained its existing advisory for the 1,073.30 kB main chunk; it did not fail the build. Remaining gates are isolated-target Rust Clippy/tests/docs, corrected `app_builder`, final binding equality, Windows Tauri build, and diff integrity.
- 2026-09-06 running Rust gate: isolated-target Rustfmt check and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- -D warnings` exited 0. `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- --test-threads=1` is currently compiling/linking integration targets under `.codex-target-be014`; no test result is claimed until that command exits.
- 2026-09-06 Rust gate milestone: the isolated-target `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- --test-threads=1` rerun exited 0, including 289 library tests, `app_builder` 15/15, `app_lifecycle` 10/10, BE014 `files_read_watch_commands` 5/5, binding equality 11/11, and every other integration target. The gate first exposed three historical exact-schema fixtures: one schema version and the migration 6 table/index names; each was corrected and its focused target passed before the clean full rerun. Remaining gates are doctests, Windows Tauri build, and final diff/status integrity.
- 2026-09-06 Rust completion milestone: documentation tests exited 0 with 0 doctests collected, and the required final `export_bindings` equality run passed 11/11 without regeneration. All automated Rust tests, Rustfmt and Clippy gates are now complete. Remaining gates are the production Windows Tauri build and final diff/status integrity.
- 2026-09-06 Windows build milestone: with `CARGO_BUILD_JOBS=1` temporarily set and the prior shell value restored by `finally`, `pnpm tauri build` exited 0 and produced the release application in the isolated `.codex-target-be014` target. Its nested frontend build also passed. The command retained non-failing advisories for the existing `.app` identifier suffix and 1,073.30 kB frontend chunk; no app or installer was launched. Only final diff/status integrity remains.
- 2026-09-06 final integrity milestone: removed the generated isolated target after the successful build; `git diff --check` exited 0. Final status contains 35 tracked modified paths and 7 intended untracked BE014 paths, with no staging or commit. Composition registers exactly `open_file_in_pane`, `get_open_file`, `reload_open_file`, `resolve_external_file_change`, `open_file_with_default_app`, and `list_recent_files`; no BE015 update/save command or new webview filesystem/opener capability is present. Isolated manual native acceptance and native performance/profile metrics remain pending rather than reported as passes.

Implementation complete with the evidence above. FE-017 and all unobserved native smoke/metrics remain outside this task; no claim of Phase 2 completion is made.
