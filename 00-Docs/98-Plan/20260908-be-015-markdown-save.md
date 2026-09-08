# BE-015 Markdown Save Implementation Plan

**Status:** Complete — backend implemented and required Windows automated gates passed

**Goal:** Expose acknowledged Markdown buffer updates and manual atomic save through the existing Files service, preserving drafts across disk conflicts and concurrent edits.

**Completion Criteria:**

- Exactly two new commands follow BE-015 and generated bindings; a real temporary Markdown file round-trips exact bytes through update/save.
- Tests demonstrate no write on update, clean save, conflict or pre-commit failure; snapshot save, newer edits, multi-handle reconciliation and lifecycle serialization work.
- Required Windows gates pass with evidence. FE-018 controls and interactive Phase 2 smoke remain the subsequent frontend feature, and are not claimed by this backend deliverable.

**Architecture:** Extend the single Files runtime established by BE-014. Keep its weak FileHandleManager lifecycle delegate and existing state authority; manager operations may delegate to service internals rather than introduce a second state map. A private writer stages validated sibling files and commits using the native atomic operation; blocking work uses the existing two-worker semaphore.

**Tech Stack:** Existing Rust 1.98.0 / Edition 2024, Tauri 2.11.5, Tokio, Serde, ts-rs, BLAKE3 and UUID. No new dependency is required: the existing Windows manifest already supplies the exact dependency and required features:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "=0.61.2", features = ["Win32_Foundation", "Win32_System_JobObjects", "Win32_System_Threading", "Win32_Storage_FileSystem"] }
```

**Sources:**

- `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`
- `00-Docs/98-Plan/00-Roadmap.md`, stage 17
- `00-Docs/00-Overview/01-TechStack.md`, `02-ProjectStructure.md`, `03-FunctionalRequirements.md` (§11.3, §20)
- `00-Docs/03-Backend/BE-015-markdown-save.md`
- `00-Docs/03-Backend/BE-013-file-tree.md`, `BE-014-file-read-and-watch.md`, `BE-005-sessions-runtime.md`
- `00-Docs/02-Frontend/00-Overview.md`, FE-018 entry (detailed frontend specification does not exist yet; it is the next user-requested design step)
- `00-Docs/01-Wireframe/05-Files.html`

## Scope

**In Scope:** BE-015 public commands/types/errors/events, byte-derived edit state, atomic writer, leases/path gate, watcher and lifecycle integration, generated bindings and isolated tests.

**Out of Scope:** FE-018 implementation/design, preview, shortcuts, autosave, new files/Save As, Notes, persistence/migration, dependency upgrades and completed historical plans.

## Global Constraints

- Rust owns OS access, persistence, terminal processes, and business rules.
- Generated bindings under `src/bindings/` are not edited manually.
- Every function, method, callback, test, and helper must have a short comment describing its purpose.
- Do not add or run automated desktop end-to-end tests.
- During development, build and test only on Windows.
- Use actual IPC in runtime; roadmap supersedes the older mock-runtime sentence in PLANS.md.
- Save accepts handle/revision only; paths and BOM come from backend authority. No filesystem permission is added to the webview.

## Assumptions, Risks, and Blockers

**Assumptions:** BE-014 implementation is present (latest observed commit `869b7e4`, following `01a0881 FE-017`). Its reserved `replace_editor_snapshot` needs BE-015 validation, exact-byte metadata and event semantics; it is not already a complete BE-015 implementation. The user authorizes implementation and feature commits separately through the coordinator.

**Risks:** Disk changes can race the final fingerprint without an external-program lock; honor the documented observable-change guarantee, never claim stronger compare-and-swap semantics. Save leases must finish on all failure and shutdown paths. Do not hold state locks during hashing, OS operations, awaits or event emission.

Stage 16 historical outcome has outstanding Tauri build and manual native smoke, plus a reported `terminal_pty_windows` Unicode failure. Run current gates and record actual results; a previous environment attribution is not passing evidence. Do not edit the historical plan. Limit Cargo parallelism to `-j 2` for resource stability.

**Blockers:** No unresolved backend contract question. FE-018 detailed design is absent; the user explicitly orders BE plan/implementation before FE design/plan/implementation, so backend scope uses BE-015 plus the existing FE catalog/wireframe rather than inventing an FE specification. Native manual UI smoke requires FE-018 and available interactive Windows facilities; track it explicitly if unavailable and do not mark the whole stage 17 complete.

## Dependency Order

1. Typed edit state → snapshot authority and close impact.
2. Atomic writer → deterministic commit and failure observations.
3. Save orchestration → concurrency and watcher/lifecycle safety.
4. Commands/bindings → backend ready for FE-018.
5. Gates/evidence → feature handoff and coordinator commit.

### Task 1: Complete acknowledged editor state

**Outcome:** Exact UTF-8/BOM-derived buffer state implements every stale-token and recovery rule in BE-015.

**Depends On:** None.

**Files:** Modify `src-tauri/src/files/models.rs`, `error.rs`, `handles.rs`, `service.rs`, `mod.rs`; unit tests in those modules.

**Interfaces:** Consume existing `FileEditorSnapshot`, handle records, clock and BE-014 fingerprint. Produce BE-015 request/result/outcome DTOs, error variants, `EditorUpdated`/`Saved` kinds, `PreparedMarkdownText`, `MarkdownEditIntent` and manager `apply_markdown_edit`; retain `FilesService::replace_editor_snapshot` as the single public edit hook.

- [x] Added discoverable IPC-target red tests for the existing edit hook before refactoring (BOM byte-size derivation), then expanded unit/IPC coverage for: rejected >5 MiB including BOM, byte-size/line-ending derivation, compatible identical retry, exact one-revision watcher-first-edit acceptance, arbitrary stale rejection, current revision with old disk token conflict, convergence, missing/unreadable/root-changed recovery, memory budget and checked revision overflow.
- [x] The red run used the explicitly discovered `--test files_markdown_save_commands` target rather than the planned unit filter: BOM-excluded size and missing command assertions both failed. Subsequent `--lib files::` runs executed nonzero tests.
- [x] Prepare encode/hash/metadata in blocking admission before locking. Keep only bounded token/digest comparisons and state swap inside lock. Preserve external facts during edits, clear watcher marker on explicit mutations and emit only on actual revision changes after unlock. Count all retained text allocations in the 64 MiB budget.
- [x] Repeat focused command; all Files unit tests pass. Verify update uses no filesystem or recent-write call through recording seams and unchanged fixture bytes.

### Task 2: Implement validated atomic writer

**Outcome:** Complete bytes replace an existing writable target or produce an accurately classified failure.

**Depends On:** Task 1 types.

**Files:** Create `src-tauri/src/files/writer.rs`; modify `mod.rs`; extend `path_policy.rs` and `reader.rs` only for existing validated-target/fingerprint APIs required by the writer. Unit tests in writer/path/reader modules.

**Interfaces:** Consume `ProjectRootIdentity`, `ValidatedFileWriteTarget`, `resolve_writer_target` and `DiskFingerprint`. Produce BE-015 `FileMetadataSnapshot`, `StagedAtomicWrite`, `AtomicCommitObservation`, `AtomicFileWriter` and native implementation. Keep writer private to Files; no public raw-path API.

- [x] Added writer unit tests that inspect complete sibling bytes through the real private platform seam. Deviation: no separate incomplete writer stub/red run was created; staged fault and native Windows assertions were run against implementation.
- [x] Use temporary roots only. Define a private test platform adapter for create/write/flush/sync/inspect plus the service writer seam for commit outcomes; cleanup uses the actual owned temporary files; inject failures at each named step, a three-collision sequence, and an inspection counter. Native adapter uses real filesystem operations. This seam is test infrastructure, not a new IPC interface.
- [x] Stage using UUID sibling `create_new`, exact optional BOM bytes, write-all/flush/sync; preserve supported attributes/permissions and reject read-only before replacement. Cleanup owns only the exact temp created by this operation.
- [x] Windows commit uses `ReplaceFileW` without ignore flags; implement cfg-gated Unix rename as specified but defer native macOS execution. On API failure inspect once: staged digest success, base digest failure, missing/third digest unknown; never retry replacement. Directory sync is best effort after success.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --lib files::`; assert every injected pre-commit failure preserves old bytes and cleans temp, failure classification matches contract, and real reader-loop atomicity yields only complete old/new buffers. Test link/read-only denial on owned fixtures; explicitly record unsupported native link/UNC cases.

### Task 3: Orchestrate save, watcher and lifecycle

**Outcome:** Save persists the acknowledged snapshot while edits can continue and close cannot invalidate a live writer.

**Depends On:** Tasks 1–2.

**Files:** Modify `src-tauri/src/files/handles.rs`, `service.rs`, `watcher.rs`, `reader.rs` as necessary; unit tests in handles/service/writer. Existing Sessions adapter remains authoritative; modify `src-tauri/src/app/mod.rs` only if composition needs writer injection.

**Interfaces:** Produce `SaveLease`, `MarkdownSaveSnapshot`, manager begin/commit/abort operations and service save operation. Consume current project-root adapter, shared semaphore, existing lifecycle delegate and `files://handle-changed` sink.

- [x] Added deterministic tests with per-service writer injection and bounded channels at stage-complete/pre-commit, injected root source, fixed clock and recording event sink; no process-global environment changes. Deviation: save behavior red was the missing real IPC command; service barriers were added after the implementation.
- [x] Validate attached Markdown/revision/state before clean no-op. Clean save performs zero root/writer/event operations. Reserve one handle lease and path-scoped gate; permit edits, serialize save/resolve/reload/close/discard. Recheck lease, current available root/identity, no-link regular writable path and full raw fingerprint after staging immediately before commit.
- [x] On mismatch publish external conflict (or missing/unreadable/root-changed) without losing latest draft, discard temp and return the specified typed error. Ensure permit/gate/lease release on cancellation, spawn failure, writer failure and shutdown. Shutdown stops admission and awaits any commit already entered.
- [x] Publish new base atomically for initiating and sibling handles. Return `SavedWithNewerEdits` for a later local digest; clean sibling reloads, dirty sibling conflicts. Emit initiating ID first then lexical sibling IDs outside lock. Defer watcher hints during save and drain after; fingerprint equality, not a timer, recognizes self-write.
- [x] Test edit during staging; second save; close/discard/resolve/shutdown during stage; stale worker rejection; watcher arrival before/after commit; two handles same path; KeepMine followed by another disk change; staged/unknown commit results; root relocation and target disappearance. Save/close tests invoke existing Files lifecycle methods and close-impact authority; the real Sessions command suite supplies regression coverage, and the FE-018 save-and-close UI remains the subsequent frontend task.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --lib files::`; all assertions pass, no unbounded sleeps/deadlocks, test teardown joins workers.

### Task 4: Register commands and verify real IPC contract

**Outcome:** FE-018 can call real backend through generated types.

**Depends On:** Task 3.

**Files:** Modify `src/features/files/file-error-copy.ts` for exhaustive generated-error compatibility; modify `src-tauri/src/files/commands.rs`, `mod.rs`, `src-tauri/src/app/mod.rs`, `src-tauri/tests/app_builder.rs`, `src-tauri/tests/export_bindings.rs`; create `src-tauri/tests/files_markdown_save_commands.rs`; generate `src/bindings/files/`.

**Interfaces:** `update_markdown_buffer(request, window, state) -> FileHandleDto`; `save_markdown_file(request, window, state) -> SaveMarkdownFileResultDto`; existing invalidation event with new kinds. Both commands are main-window-only and thin.

- [x] Build a test harness patterned on `files_read_watch_commands.rs`: `configure_with_files_for_tests`, `TempDir` app data and project, fake picker/opener, real storage/service, mock Tauri invoke. No actual developer config or repository files.
- [x] Add real invoke tests before registration. Run `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --test files_markdown_save_commands`; expected red is unknown new command from mock invoke, with target discovered and compiled.
- [x] Register exactly the two commands, map DTO validation and safe errors, export types through the existing binding generator. No webview capability or migration change.
- [x] Covered non-main window, malformed revision/base tokens, non-Markdown, exact-size boundary, Unicode/BOM/line-endings, manual-only writes, conflict/KeepMine, read-only/missing and sibling behavior through IPC; deterministic service/native tests cover locked targets, root changes and concurrent snapshot behavior. Existing BE-013 path-policy tests cover link rejection; native symlink/UNC fixtures remain explicitly unvalidated in this environment. Assert safe event/error serialization contains no content, digest, raw OS error or temp path; no recent timestamp change.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --test files_markdown_save_commands --test files_read_watch_commands --test app_builder --test export_bindings`; all pass. Generate bindings only through Rust export and format generated output using repository tooling if needed.

## Final Verification

All commands run from repository root on Windows. Record command, actual result and any limitation in Outcome; do not substitute an environment explanation for success.

| Scope | Command | Expected Result |
|---|---|---|
| Format | `pnpm format:check` | No format errors |
| Lint | `pnpm lint` | No lint errors |
| Types | `pnpm typecheck` | Existing consumers accept expanded generated types |
| Frontend regression | `pnpm test` | All tests pass |
| Frontend build | `pnpm build` | Production assets build |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features -- -D warnings` | No warnings |
| Rust full suite | `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features` | All pass; record actual PTY Unicode result |
| Desktop build | Set task-local `$env:CARGO_BUILD_JOBS = '2'` for `pnpm tauri build`, restore previous value afterwards | Windows desktop target builds successfully; the existing bundle.active=false configuration produces no installer |
| Scope | `git diff --stat` and `git diff -- src-tauri/capabilities src-tauri/migrations` | No new permissions/schema; only authorized files |

Targeted native filesystem verification uses test-owned NTFS files, including locked/read-only replacement and external atomic rename; record volume/fixture support. Interactive Save button/Ctrl+S, Edit/Preview, conflict dialog and Save-and-close manual Windows checks are explicitly handed to FE-018, not automated desktop E2E. Outstanding stage 16 manual smoke remains visible in handoff.

After successful BE verification, hand coordinator the files and evidence for the user-requested `Implement BE015` commit. This plan does not authorize the planning agent to implement or commit.

## Deviations and Decisions

- 2026-09-08: Existing Windows dependency already includes the exact writer features; no manifest/lock churn is planned.
- 2026-09-08: Preserve BE-014's single service-owned runtime and weak lifecycle manager; implement manager primitives by delegation when needed, without a second state owner. This implementation-placement decision is recorded in BE-015.
- 2026-09-08: Backend completion and frontend/native Phase 2 completion are separate; stage 16 verification debt is not silently treated as passed.

- 2026-09-08 implementation: Split deterministic service tests into private `src-tauri/src/files/save_tests.rs` to keep the orchestration module readable. Inject writer through a private per-runtime mutex; no extra public API or dependency.
- 2026-09-08 implementation: Red coverage for edit and IPC preceded implementation; writer/service fault tests were added against the implemented private seam rather than separate intentionally incomplete writer stubs. Actual assertions, not uncompiled test scaffolds, provide the verification evidence.
- 2026-09-08 implementation: Native reader-loop exposed transient Win32 errors 2 and 32 during `ReplaceFileW`; the design now states the observed complete-successful-read guarantee precisely. The test permits these explicit native transient-open failures and rejects partial successful reads.
- 2026-09-08 implementation: Save reserves working/publication text memory before commit; existing error-copy consumers needed eleven safe strings for the expanded generated error union. No FE-018 editor control is implemented here.

- 2026-09-08 final-gate finding: The concurrent `data_management_contract` target reproduced `DomainValidationFailed { domain: CliProfiles }` while the exact same test passed alone and in the previous full run. Its mock composition starts CLI hydration asynchronously, but the import participant synchronously reads the hydrated cache. The isolated test now explicitly awaits the existing public `CliProfilesService::initialize()` before constructing its import participant. No production CLI/data-management behavior changed; `src-tauri/tests/data_management_contract.rs` is the sole added gate-stabilization file.

- 2026-09-08 final-gate finding: A later full run completed 305 library tests but hung in the unchanged `terminal::manager::tests::pane_launch_gate_precedes_owner_queries`. Its single-waiter fixture used `notify_waiters()` before waiter registration, losing the barrier signal. The exact owned unit-test process was stopped after the >60s diagnostic; only the test fixture signal/release uses `notify_one()` now, with bounded five-second waits in that test. No production terminal logic changed. `src-tauri/src/terminal/manager.rs` test-only lines are included to make the required full gate deterministic.

## Outcome

BE-015 is implemented and verified. Exactly two real commands, generated DTOs, manual snapshot save, native atomic replacement, optimistic conflict checks, watcher/lifecycle serialization and recovery behavior are ready for the coordinator's `Implement BE015` commit. No FE-018 UI work was started. The user subsequently requested stopping after this current feature; handoff therefore ends at BE-015.

| Final gate | Actual result |
|---|---|
| `pnpm format:check` | Pass, 313 files |
| `pnpm lint` | Pass, 313 files |
| `pnpm typecheck` | Pass |
| `pnpm test` | Pass, 129 files / 2,391 tests |
| `pnpm build` | Pass; large-chunk advisory only |
| Rustfmt `--check` | Pass |
| Clippy `-j 2 --all-targets --all-features -- -D warnings` | Pass |
| Rust `-j 2 --all-targets --all-features --no-fail-fast` | Pass, 24 targets / 531 tests, including 306 library tests and ConPTY 3/3 |
| `pnpm tauri build` with `CARGO_BUILD_JOBS=2` | Pass, standalone command exit 0; release executable at `src-tauri/target/release/xwork.exe` |
| Scope and whitespace | `git diff --check` passed; no capabilities, migrations, manifest or lockfile changes |

The release target first built in 3m15s. The enclosing shell retained the intentionally stopped earlier test-process error, so a separate Tauri invocation verified exit 0 (2m28s; regenerating embedded frontend assets caused recompilation). Both outputs produced the Windows executable. Existing `bundle.active=false` means no installer was produced. The existing `.app` identifier warning is deferred with macOS release preparation.

Remaining limitations are explicit: interactive native Save/shortcut/Save-and-close smoke requires FE-018 and native control facilities; UNC/network-share and native macOS cases were not executed. NTFS temporary fixtures, locked/read-only paths, native replacement, IPC and lifecycle tests are verified. Native transient open errors during `ReplaceFileW` are documented above. No stage-17 UI completion is claimed.

Verification chronology (final outcomes are the table above):

- Red: `files_markdown_save_commands` discovered and ran 2 tests. The existing edit hook returned byte size 12 instead of BOM-inclusive 15; real IPC reported `Command update_markdown_buffer not found`.
- Green: combined command targets passed 15 app-builder, 11 binding, 5 BE-015 IPC and 5 BE-014 IPC tests. Binding generation deliberately failed its first run after writing new output, then passed the clean rerun.
- Frontend format, lint, typecheck passed after adding the eleven newly generated error variants to the existing exhaustive error-copy table. Frontend test passed 129 files / 2,391 tests; production build passed with the existing large-chunk advisory.
- Clippy with all targets/features and warnings denied passed before the final edge assertions; the final rerun remains required after those changes.
- Real NTFS writer tests cover create/write/flush/sync failures, three name collisions without deleting the unrelated collision file, inspect-once base/staged/third/missing classification, locked target and complete-reader snapshots. C: temporary fixtures and F: workspace both report healthy NTFS.
- Deterministic service barriers cover newer edits, second save and discard serialization, preflight external write, relocated root, shutdown before commit, watcher-first-edit stale token, clean no-op, revision overflow, caller cancellation, invalidated lease, unknown-commit reconciliation and text-budget rejection.
- Manual interactive native smoke belongs to FE-018. This environment exposes no native computer-control API; no desktop E2E automation was added or run. UNC/network-share and native macOS validation remain deferred; no user-owned filesystem data is used by tests.


Final-source verification:

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features -- -D warnings`: passed in 12.68 seconds.
- First full Rust run: passed all targets, including 300 library tests and all 3 native ConPTY tests. Its compile/link phase took 3m59s. This first run preceded the final service edge assertions; the verified final run is recorded below.
- `pnpm tauri build`: completed successfully as recorded above. `src-tauri/tauri.conf.json` already has `bundle.active=false`, so success means the Windows desktop executable, not an installer package.
- Scope inspection: capability/migration diffs are empty; manifest and lockfiles are unchanged.

- First final-source full run: 305 library tests passed, then the 36-test data-management target stopped with one hydration-race failure; the exact test rerun passed 1/1, and the concurrent target reproduced the same failure. An explicit fixture hydration barrier was added before the next full gate.

- Verified final-source full Rust command: `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features --no-fail-fast` passed all 24 test targets / 531 tests, including 306 library tests, both stabilized fixtures and ConPTY 3/3. Compile/link took 1m44s. Log: `%TEMP%/xwork-be015-rust-verified.log`.
- Final Rustfmt and Clippy with all targets/features and warnings denied passed again after the test-only barrier change (Clippy 8.39s).

- Standalone final Tauri verification: exit 0, release optimized profile completed in 2m28s. Log: `%TEMP%/xwork-be015-tauri-verified.log`. No source changed after the verified Rust suite; subsequent edits only finalize this active plan.
