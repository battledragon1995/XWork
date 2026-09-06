# BE-011 Notifications Implementation Plan

**Status:** Backend implementation and automated verification complete; ready for parent code commit. Native smoke remains pending.

**Goal:** Deliver the roadmap stage 11 backend for Phase 1 terminal notifications using real BE-007 state transitions, durable read/delete state, exact live session targets, and selective Rust-owned Windows notifications.

**Completion Criteria:**

- Six main-window commands and generated notification bindings match BE-011; pagination, unread counts, mutation revisions, and target validation pass contract tests.
- Real application Terminal/Sessions sinks feed Notifications independently of frontend event delivery. Ordinary output, observed sessions, explicit close, and duplicate occurrences never produce extra items or OS requests.
- Migration 5, startup purge, serialized post-commit events, default OS policy, and fail-closed retryable Quit cleanup pass isolated tests.
- Required automated checks and Windows Tauri build pass. Native smoke has separate recorded evidence; unavailable native tooling means pending verification, never a passing result.
- This backend handoff does not claim FE-010 or roadmap stage 11 as a whole complete.

**Architecture:** Notifications owns its SQLite queries and one sequential state-transition worker. Application adapters consume public Sessions queries, fan out existing Terminal/Sessions DTOs, and connect lifecycle; Terminal never imports Notifications. Rust owns policy, persistence, and OS calls; future FE-010 consumes generated command/event contracts.

**Tech Stack:** Existing Rust 1.98.0 Edition 2024, Tauri 2.11.5, Tokio, rusqlite/SQLite, Serde, ts-rs, UUID, and tempfile. Add only the BE-011-pinned Rust notification plugin.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`; template: `00-Docs/99-Template/04-Plan.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 11, product Phase 1; prerequisites stages 8–10 have implementation but outstanding native smoke.
- Architecture/toolchain: `00-Docs/00-Overview/01-TechStack.md`, `00-Docs/00-Overview/02-ProjectStructure.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections 4.2, 5.3–5.4, 8.2, 10.1, 15, 16, 17.5, 18.
- Backend: `00-Docs/03-Backend/BE-011-notifications.md`, including the 2026-09-06 stage 11 decisions.
- Dependencies: `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`, `BE-002-storage-foundation.md`, `BE-005-sessions-runtime.md`, `BE-007-terminal-and-pty.md` in the same backend directory.
- Extension boundaries: `00-Docs/03-Backend/BE-008-settings-persistence.md`, `00-Docs/03-Backend/BE-012-backup-and-reset.md`.
- Frontend: `00-Docs/02-Frontend/00-Overview.md` rows FE-010/FE-023; `00-Docs/02-Frontend/FE-001-application-shell.md`. FE-010 detailed design does not yet exist and is the next FE deliverable after this backend implementation, not an input invented by this plan.
- Wireframes: `00-Docs/01-Wireframe/02-AppShell.html#notifications`, `#shell`, `#tray`, `#settings-notifications`. The settings anchor establishes defaults only; illustrative command/output/file-count text is explicitly excluded by BE-011.
- Repository evidence: `src-tauri/src/app/mod.rs`, `app/data_runtime.rs`, `app/lifecycle.rs`, `sessions/manager.rs`, `terminal/models.rs`, `terminal/manager.rs`, `storage/mod.rs`, `storage/migrations.rs`, `shared/maintenance.rs` under the same source root; `src-tauri/tests/app_builder.rs`, `sessions_runtime.rs`, `export_bindings.rs`; `src-tauri/Cargo.toml`, `rust-toolchain.toml`, `package.json`.

## Scope

**In Scope:**

- Needs input, natural successful exit, and natural failed exit from unobserved live sessions; default policy `true/true/false/true` for activity/OS-input/OS-finished/OS-failed.
- Migration `0005_create_notifications.sql`; strict models, keyset repository, startup purge, service, six commands, typed event, platform adapter, generated TypeScript.
- Reuse `SessionManager::notification_context` and `get_session`; app-owned real source fan-out, visibility ordering, and Quit coordination.
- Existing maintenance read permit for all normal writes. No duplicate shared gate.
- Focused regression coverage of app composition, Sessions context, Terminal source integration, generated contracts, and current schema-version fixtures.

**Out of Scope:**

- FE panel, badge, routing/focus implementation, IPC wrapper, and FE detailed design; no product runtime mocks.
- Reminder/Event/Missed/Snooze/Dismiss, native actions/click navigation, notification settings persistence/subscription, calendar implementation.
- Stage 13 reset pause/resume and transaction participant implementation, backup/import changes, or speculative reset scaffolding. Preserve the documented future contract.
- Parsing terminal output, command names, file counts, generic prompt detection, PTY behavior changes, telemetry, retention caps, macOS validation, desktop automated E2E, and Git commits.
- Rewriting historical plans or marking stages 8–10 complete.

## Global Constraints

- "Keep OS access, persistence, terminal processes, and business rules in Rust; the React frontend communicates with them through narrowly scoped Tauri commands and events."
- "Generated bindings under `src/bindings/` are not edited manually."
- "Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state."
- "Do not add or run automated desktop end-to-end tests."
- "During development, build and test only on Windows."
- "Every function, method, callback, test, and helper must have a short comment describing its purpose."
- The roadmap's real-backend development rule applies; fakes belong only in isolated tests. The older generic mock-IPC guidance does not authorize a mock product runtime.
- Run Rust compilation sequentially with one Cargo job because FE-008 previously exhausted the Windows paging file. In each PowerShell verification session set `$env:CARGO_BUILD_JOBS = '1'`; explicit Cargo build/test/Clippy commands also use `-j 1`. Do not run separate Cargo jobs concurrently.

## Assumptions, Risks, and Blockers

**Assumptions:**

- Planning baseline was clean HEAD `2ddedac`. The subsequent user instruction authorized direct implementation and automated verification, without subagents or commits.
- The source spec has no open product/contract questions after the recorded stage 11 decisions. The user authorized autonomous decisions instead of clarification questions.
- Sessions already exports its notification context; implementer should not recreate that API. Schema registry currently ends at version 4.

**Risks:**

- The current source sinks emit only to Tauri. Merely testing direct notification ingestion would miss the production integration; Task 4 must exercise app fan-out driven by the real Terminal manager with a fake PTY.
- Current visibility reporting schedules asynchronous work. Task 4 must order pending native visibility updates before notification context reads without blocking window callbacks.
- A deleted database row no longer protects its unique source key. Task 2 must retain processed runtime occurrence state so redelivery after user deletion does not resurrect items.
- The current production builder registers clipboard before single-instance, unlike BE-001/BE-011's stated invariant. Task 4 minimally restores single-instance first when inserting the notification plugin.
- App-builder tests expect schema 4 and use 5 as a future-version fixture. Task 4 updates those exact expectations to 5 and 6; do not change old migration SQL.
- Installed Windows toast visibility cannot be established by mock-runtime tests. Native smoke and prior-stage smoke remain explicitly pending until performed.

**Blockers:** No blocker to backend implementation or independent automated checks. Native smoke availability is a verification limitation, and full stage 11 completion additionally awaits FE-010 design/plan/implementation.

## Dependency Order

1. Models, migration, and repository establish storage and public types.
2. Service and deterministic seams establish ingestion, mutation, lifecycle, and ordered effects.
3. Platform adapter and commands expose the backend safely.
4. App adapters integrate real sources, visibility, startup, and Quit.
5. Binding export and complete verification establish a concrete FE handoff.

All commands below run from the repository root on Windows. Test modules use normal `#[test]` registration; each integration file is a top-level Cargo test target. Red steps first add compilable declarations/minimal stubs where a new symbol is needed, then assert missing behavior. Missing imports or zero discovered tests are not accepted as red evidence.

### Task 1: Establish strict contracts and migration-backed repository

**Outcome:** Migration 5 and typed keyset persistence support exactly the Phase 1 rows and public DTOs in BE-011.

**Depends On:** None.

**Files:**

- Create: `src-tauri/src/notifications/mod.rs`, `models.rs`, `repository.rs` in that capability directory.
- Create: `src-tauri/migrations/0005_create_notifications.sql`.
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/storage/migrations.rs`.
- Test: `src-tauri/tests/notifications_commands.rs` for migration, model, repository, and public service coverage; private-module duplication was omitted as recorded in Execution Evidence.

**Interfaces:**

- Consumes: `Storage::open`, `with_connection`, `with_transaction`; BE-011 SQL and nine public DTO/error types.
- Produces: `NotificationKindDto`, `NotificationTargetDto`, `NotificationDto`, `NotificationCursorDto`, `NotificationPageDto`, `NotificationCenterStateDto`, `OpenNotificationDto`, `NotificationCenterChangedDto`, `NotificationError`; repository operations remain Notifications-owned.
- Test seam: `Storage::open(tempfile::TempDir::path())`; timestamps, IDs, and rows supplied explicitly to repository operations. Execute SQL fault fixtures only against this temporary database.

- [x] Add discovery-ready tests for migration version/table/indexes, strict tag/UUID/cursor/timestamp/status decoding, canonical wire casing, Unicode normalization and redaction; compile the module declarations before evaluating behavior.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_commands`. Before registry implementation, the migration assertion expects 5 and observes 4. The library suite also passed. A separate decoder-stub red run was not performed; model rejection behavior is covered at the public boundary.
- [x] Embed the exact spec SQL at version 5 without modifying 0001–0004. Parameterize queries; use `(created_at_ms, id)` DESC, `limit + 1`, and no OFFSET. Strict-decode all returned fields; do not silently discard corrupt rows.
- [x] Cover equal timestamps, deletion/insertion between pages, default 30/max 100 limits, all-table unread counts, conflict source insert, no-op read/clear, read-time clamp, and transaction rollback. A version-4 temporary database with a pre-existing conflicting `notifications` table must fail migration 5 and retain `user_version = 4` without partially creating indexes.
- [x] Re-run both commands; all discovered assertions pass. No production data path is resolved.

### Task 2: Implement the serialized notification service

**Outcome:** Candidate transitions create eligible rows once, mutations produce consistent revisions, and failures never affect Terminal execution.

**Depends On:** Task 1.

**Files:**

- Create: `src-tauri/src/notifications/service.rs`.
- Modify: `src-tauri/src/notifications/mod.rs`, `models.rs`, `repository.rs`.
- Test: `src-tauri/tests/notifications_commands.rs` and shared fixtures in `src-tauri/tests/support/notifications.rs`; behavioral coverage is consolidated at the public service boundary rather than duplicated in private modules.

**Interfaces:**

- Consumes: BE-011 `NotificationDependencies`, `TerminalNotificationPolicy`, `NotificationFuture`, `NotificationEventTarget`; existing `TerminalStateChangedDto`, `SessionRuntimeEventDto`, `DataMaintenanceGate::read_permit`.
- Produces: `NotificationService` query/mutation methods backing the six commands, `observe_terminal_state`, `observe_session_runtime`, `begin_shutdown`, `shutdown_runtime_sources`; `notifications://changed` with `NotificationCenterChangedDto`.
- Determinism seams, injected through service construction: clock closure `Arc<dyn Fn() -> u64 + Send + Sync>` returning epoch milliseconds; ID closure `Arc<dyn Fn() -> String + Send + Sync>` returning valid notification IDs; event callback accepting `NotificationCenterChangedDto`; OS callback accepting only normalized title/body. Production supplies system time/UUID, app emitter, and platform adapter. These are Rust-only collaborators, not IPC or generated DTOs.
- Tests substitute controlled clock/ID sequences, recording/failing event and OS callbacks, and fake `NotificationDependencies`. Use an internal worker acknowledgement/barrier in unit tests to wait for processing; integration tests observe explicit recording callbacks, not arbitrary sleeps. Keep test-only worker control out of generated bindings.

- [x] Add tests alongside the service implementation (deviation from the proposed stub-first approach). Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_commands` and `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --lib`. The hidden needs-input assertion passes with one unread row; no separate no-op intake red run is claimed.
- [x] Implement startup cleanup through bounded blocking Storage work before readiness, with runtime revision 0. A temporary trigger aborting terminal-row deletion must make initialization fail with `PersistenceFailed` and publish no ready service. An unknown nonterminal source row surviving the purge must fail strict startup validation; never silently reset it.
- [x] Implement the single unbounded low-frequency transition queue and per-runtime dedupe described in the spec. Validate current session context and exact live target before candidate insert. No raw output frames enter this queue.
- [x] Cover false-to-true attention, attention clear, natural finished/failed, final prompt read in the same transaction, duplicate final/attention before and after Delete/Clear read, observed/hidden/missing sessions, late disposed events, session deletion, and ignored Running/Closing/StreamDetached/XWork-terminated sources. Closing/Disposed/terminated states clean up instead of inserting.
- [x] Keep dependency awaits outside locks. Acquire shared read permit, then service gate, then bounded blocking SQL. Preflight revision overflow before commit; commit changed rows before publishing runtime revision and enqueueing one FIFO event. No-op operations preserve revision; emitter failure preserves committed data. Release locks/permit before OS dispatch.
- [x] Cover event-time label snapshots, control/whitespace removal and scalar truncation, sanitized errors, rollback, concurrent mutations, revision order, and OS failure without rollback/retry. Use a temporary `RAISE(ABORT, ...)` trigger for write failure; expected rows/count/revision/events remain unchanged. Barrier-controlled dependency futures exercise target deletion between lookup and mutation.
- [x] Implement synchronous shutdown admission plus retryable asynchronous cleanup. Queue work admitted before shutdown must finish or be suppressed before successful cleanup; no post-shutdown OS/event dispatch. Inject a temporary delete-abort trigger: cleanup fails, rows remain, removing the trigger permits retry, intake stays shut.
- [x] Re-run both commands; service and repository tests pass with no terminal/process/OS access. Do not implement stage 13 reset methods in this task.

### Task 3: Expose narrow commands and Rust-only OS delivery

**Outcome:** Exact-main callers can query and mutate the center; OS delivery receives only approved title/body fields.

**Depends On:** Task 2.

**Files:**

- Create: `src-tauri/src/notifications/commands.rs`, `src-tauri/src/platform/notification.rs`, `src-tauri/tests/notifications_os_windows.rs`.
- Modify: `src-tauri/src/notifications/mod.rs`, `src-tauri/src/platform/mod.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
- Test: `src-tauri/tests/notifications_commands.rs`, `notifications_os_windows.rs`, and unit tests in `platform/notification.rs`.

**Interfaces:**

- Commands: `get_notifications(cursor, limit) -> NotificationPageDto`; `mark_notification_read(notification_id)`, `mark_all_notifications_read()`, `delete_notification(notification_id)`, `clear_read_notifications() -> NotificationCenterStateDto`; `open_notification(notification_id) -> OpenNotificationDto`. Every result uses `NotificationError` and signatures include the invoking window and managed service exactly as BE-011 specifies.
- Adapter: Rust plugin title/body builder; caller-independent recording adapter for tests. No notification JS package, plugin frontend permissions, or extra custom commands.
- New manifest entry in `[dependencies]`: `tauri-plugin-notification = "=2.3.3"`. Version and Tauri 2.11.5 compatibility are prescribed by BE-011, not selected by this plan. Retain all existing exact entries/features; Cargo generates the lockfile. Compiler/Clippy/Tauri build validate the pinned combination during implementation; compatibility has not been tested in this planning task.

- [x] Add a mock-Tauri invoke harness using temporary app data and injected fake dependencies/OS adapter. Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_commands`; authorized get and mutation requests pass through all six connected handlers; no separate missing-handler red run was performed. Unauthorized-window tests must assert `UnauthorizedWindow` before any dependency callback or database write.
- [x] Implement thin command wrappers, clone state before await, validate IDs/limit/cursor, and map errors without SQLite/OS details. Test all six handlers from `main` and a non-main label, missing IDs, invalid cursors/limits, mark-all/clear behavior and no-op revisions.
- [x] Open validates exact project/session/tab/pane/terminal using stored source identity and public dependency queries, then marks read. Missing/changed target returns `TargetUnavailable`; dependency failure returns `DependencyUnavailable`; neither marks read or invokes router/terminal actions.
- [x] Add the pinned plugin and OS adapter. Cover the default matrix: observed blocks all; hidden or other route enables bell for all three kinds but OS only input/error. Test adapter denial/show failure, duplicate delivery, and normalized Unicode title/body. Diagnostics contain category only, not raw errors or content.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_os_windows` and the commands target; OS tests must execute on Windows with a recording adapter and never show a real toast. Run the library test suite for platform payload mapping.

### Task 4: Integrate real application sources and lifecycle

**Outcome:** Normal terminal use feeds Notifications even with no frontend listener, and startup/visibility/Quit ordering is enforced in the production composition path.

**Depends On:** Tasks 2–3.

**Files:**

- Create: `src-tauri/src/app/notification_dependencies.rs`.
- Modify: `src-tauri/src/app/mod.rs`, `src-tauri/src/app/data_runtime.rs`.
- Test: `src-tauri/tests/app_builder.rs`, `src-tauri/tests/notifications_commands.rs`; app adapter unit tests in `app/data_runtime.rs` and `app/notification_dependencies.rs`.
- Reuse without modification: Sessions public context/detail queries and existing shared maintenance gate.

**Interfaces:**

- `NotificationDependencies::session_context` maps `SessionManager::notification_context`; `session_target_exists` traverses public `SessionDetailDto` layout and `PaneContentDto::Terminal`; `terminal_policy` is the fixed Phase 1 policy; `event_target` returns `Ok(None)` without importing Calendar.
- Existing `TauriTerminalEventSink::publish` and `TauriSessionEventSink::publish` fan out cloned committed DTOs before attempting frontend emit. Preserve tray refresh and existing terminal events.
- `SessionsAppRuntime::shutdown_for_quit` calls notification admission gate before terminal shutdown, then notification cleanup before returning success to the lifecycle owner.
- App test seam: extend composition with notification collaborators and temporary app-data override, equivalent to existing `configure_with_*_for_tests` helpers. Use a recording/failing OS adapter; no native tray, credential lookup, process environment mutation, or user project lookup. For Terminal source tests inject its existing `PtyFactory`/`PtyCallbacks` and fake profile/project collaborators into the real manager path.

- [x] Add a focused composition test that drives a fake PTY callback through real `TerminalManager` state publication into the app-owned sink. Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_commands`; the implemented fan-out produces the expected row even when the injected frontend emission fails. The initial fake-process cleanup failure and its correction are recorded below; no separate pre-fan-out red run is claimed.
- [x] Restore single-instance as the first production plugin; initialize notification plugin before native adapter use. Initialize service after storage migrations and Sessions/Terminal setup, before requests can be served. Bind observers before terminal launch admission; avoid strong ownership cycles using existing app managed state or a narrow deferred binding.
- [x] Manage exactly one NotificationService, reuse the existing maintenance gate, and register exactly six handlers in the existing shared invoke handler. Mock composition must select injected OS behavior rather than instantiate a live notification sender.
- [x] Track pending visibility updates in app-owned ordering state; context lookup waits for earlier scheduled native visibility updates, then queries BE-005. Barrier tests cover hide-before-input, show-before-input, and concurrent route updates. Never hold Notifications/Storage locks while waiting or block native callbacks.
- [x] Test session-deletion DTO cleanup, terminal Closing/Disposed cleanup through the composed producer path, four independent synthetic terminal state bursts, and exact targeting through real Sessions public state. The real Terminal producer test also proves output delivery remains active with frontend state-event failure. Existing Sessions/ConPTY regression tests cover owner deletion and four native processes; no frontend listener is required for row persistence.
- [x] Extend the app runtime in the order gate -> Sessions/Terminal cleanup -> notification purge -> lifecycle result. The notification service test injects a delete-abort trigger and proves `PersistenceFailed`, admission closed, and successful retry; existing lifecycle tests prove fail-closed exit authorization. These are separate backend checks, not a native Quit smoke result.
- [x] Update app-builder schema assertions 4 -> 5 and unsupported-version fixtures 5 -> 6. A trigger-induced startup purge error must make builder setup fail rather than publish a ready center.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test app_builder`, `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_commands`, and the library suite. Re-run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test app_lifecycle` and `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test sessions_runtime`; existing lifecycle/owner behavior remains covered.

### Task 5: Generate the FE contract and verify the backend handoff

**Outcome:** Generated types are ready for subsequent FE design and all executed checks have recorded evidence.

**Depends On:** Tasks 1–4.

**Files:**

- Modify: `src-tauri/tests/export_bindings.rs`.
- Generated by Tauri: `src-tauri/gen/schemas/acl-manifests.json`, `src-tauri/gen/schemas/desktop-schema.json`, `src-tauri/gen/schemas/windows-schema.json`.
- Regression schema-marker and inventory updates only: `src-tauri/tests/app_lifecycle.rs`, `src-tauri/tests/cli_profiles_contract.rs`, `src-tauri/tests/projects_commands.rs`, `src-tauri/tests/settings_commands.rs`, `src-tauri/tests/keyboard_shortcuts_contract.rs`.
- Generate: `src/bindings/notifications/notifications.ts`, following the repository's aggregate ts-rs export convention within BE-011's specified output directory.
- Update during implementation only: this active plan's checkboxes/evidence; do not edit historical plans or roadmap completion claims.

**Interfaces:**

- Export all nine DTO/error types from Task 1. JSON timestamps/revisions remain decimal strings; target fields and DTO fields are camelCase; error `code` values are snake_case.
- Export no internal source keys/IDs, dependency/policy/reset/event-target Rust types, terminal output, reminder action variants, or hand-written placeholder DTOs.

- [x] Extend `assert_binding_is_current` through a new notification export test. Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test export_bindings`. The first missing/stale output run must generate the file and fail with the existing regeneration message; rerun must pass without rewriting output.
- [x] Include actual serialization assertions for target field names and enum tags, plus absence assertions for internal and future-phase types. Typecheck the generated output using the existing frontend commands.
- [x] Finish the Windows Tauri build; all final automated gates passed as recorded below.
- [ ] Perform the Windows smoke checklist when native access is available. If unavailable, record the exact unavailable tool/environment and leave the checklist pending while handing off completed code/automated evidence.
- [x] Hand the parent the six commands, event, generated binding path, remaining limitations, and changed files. Parent schedules FE-010 detailed design -> plan -> implementation separately. No commit in this task.

## Final Verification

Set `$env:CARGO_BUILD_JOBS = '1'` in PowerShell before these commands, including `pnpm tauri build`, so child Cargo processes inherit the limit.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No formatting drift |
| Frontend lint | `pnpm lint` | No lint errors |
| Type check | `pnpm typecheck` | Generated contract is valid TypeScript |
| Frontend regression | `pnpm test` | Existing unit/component tests pass |
| Frontend build | `pnpm build` | Production bundle succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features -- -D warnings` | No warnings or errors |
| Rust suite | `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features` | All discovered tests pass, including prior capability regressions |
| Notification integration | `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_commands` | Six-command, persistence, source, and race assertions pass |
| OS policy | `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_os_windows` | Windows recording-adapter matrix passes, no live toast |
| Binding export | `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test export_bindings` | No regeneration on the final run |
| Desktop bundle | `pnpm tauri build` | Windows release executable builds with inherited single Cargo job; existing configuration disables installer bundling |
| Patch hygiene | `git diff --check` | No whitespace errors |
| Permission boundary | `git diff -- src-tauri/capabilities/main.json` | Empty diff; no frontend plugin permissions added |
| Scope boundary | Inspect focused source and generated-contract diff | Exactly six new invoke entries; no reminder commands/DTOs, output ingestion, future settings/reset scaffolding, or historical plan edits |

The diff inspection is implementer verification of the change's scope, not a separate code-review assignment. Every integration test file named above has an explicit target command; library unit tests are covered by the library and full-suite commands.

### Manual Windows smoke — initially not performed

- [ ] Use an installed build with identifier `com.xwork.app` in an isolated Windows test account/profile and a disposable project; do not reset or mutate the developer's normal XWork data.
- [ ] Launch a real shell terminal. Trigger the BE-007-supported BEL/OSC attention signal, natural success, and natural failure outside the observed session. Input/error request an OS toast; success does not. A CLI prompt that emits no supported signal is not evidence of a notification failure.
- [ ] Repeat with the target session visible and with the main window hidden to tray; verify the session-level eligibility policy and visibility ordering.
- [ ] Verify title/body contain only normalized safe labels, no terminal output, paths, commands, arguments, or environment. Record Windows notification suppression/permission settings if the OS does not show a requested toast; adapter acceptance is not proof of visible delivery.
- [ ] Close terminal/session and Quit/restart. Check target cleanup through the backend contract; FE bell/open/focus smoke awaits the FE-010 implementation and is not claimed here.
- [ ] Record installed artifact, Windows version, steps, observed result, and date. Keep all unperformed checks pending; do not relabel prior-stage native smoke as complete.

## Deviations and Decisions

- 2026-09-06: User authorized autonomous contract decisions and a PLAN ONLY deliverable, no implementation/commit/subagents. BE-011 received the stage 11 integration decisions; no adjacent specification or historical plan was rewritten.
- Stage 13 reset APIs are documented future contracts, not work in this stage. Runtime dedupe survives user row deletion; no extra persistent tombstone schema is added.
- Session target fields explicitly use camelCase. App integration includes the existing source-sink, native-visibility, and shutdown boundaries instead of a disconnected notification service.
- Cargo compilation uses one job throughout; native checks remain independent from automated completion.

## Plan Self-Check

- [x] Required source/template/rules read; current public paths and interfaces inspected to establish implementation scope, without an independent code review.
- [x] New exact dependency has its complete manifest entry; existing pinned dependencies remain untouched.
- [x] Every named integration test target has an explicit command; red steps identify a discovered, compilable failing assertion or deliberate binding-regeneration failure.
- [x] Temporary storage, clock/ID, dependency, PTY, event/OS, worker/visibility barrier, and startup/write/Quit failure injection seams are stated.
- [x] Final Rust flags are at least as strong as applicable specs and every compilation path uses one Cargo job.
- [x] Native smoke, later FE integration, and historical stage limitations are explicit; no commit step or implementation authorization is inferred.

## Outcome

Implemented the six-command Phase 1 backend, migration, real Terminal/Sessions fan-out, visibility/Quit coordination, and generated binding. All required automated gates passed, including the Windows Tauri release build. Code is ready for the parent to commit as `Implement BE011`; this task made no commit. Native toast/installed-build smoke remains pending, and this does not complete the FE portion or all acceptance criteria of stage 11.


## Execution Evidence — 2026-09-06

- Authorization: implement directly in the shared workspace, no subagent or independent review, no commit. All Cargo commands use `CARGO_BUILD_JOBS=1` and `-j 1`; the Tauri build inherits the environment limit.
- Red evidence: `notification_schema_is_version_five` was discovered and failed with actual `4` versus expected `5`, then passed after migration registration. Binding export deliberately failed when generating the initial file and again after adding the aggregate ts-rs `export_to` attributes; generated output was never edited by hand. Other behavior tests were added alongside implementation, so no separate red-first execution is claimed for them.
- Implementation decisions: test fixtures live in `src-tauri/tests/support/notifications.rs`; service-level coverage is consolidated into integration targets instead of duplicating private repository/service tests. `flush` provides deterministic source/effect queue acknowledgement; the app-owned emission seam injects downstream failure at the production fan-out boundary. All seams remain Rust-only.
- Migration regression: current-schema assertions in five existing capability/lifecycle integration targets were updated from 4 to 5, and Projects/CLI schema inventory fixtures now include the notification table/indexes; future-version app-builder fixtures changed from 5 to 6. No historical migration or implementation plan was edited.
- Intermediate verification: 247 library tests and the then-current 13 app-builder tests passed; the real-PTY fixture correctly exposed its own always-alive cleanup error and was corrected to report terminated state. The later app-lifecycle run exposed its stale schema-4 expectation, which was corrected. These failures are not reported as final passes.
- Frontend final checks: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed. Vitest: **93 files, 1713 tests passed**. Vite reports its non-failing chunk-size warning for chunks above 500 kB.
- Final Rust suite: `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features` passed **446 tests, 0 failed, 0 ignored** across the library and integration targets. This includes 16 `notifications_commands`, 4 `notifications_os_windows`, 8 binding exports, 14 app-builder, 10 lifecycle, 6 Sessions, and 3 native ConPTY tests. The 247 library tests include the new real-Sessions visibility/target adapter test. Final `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `cargo clippy --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features -- -D warnings` passed.
- Windows Tauri build: `pnpm tauri build` passed with `CARGO_BUILD_JOBS=1`, finishing the release build in **7m 17s**. Output: `src-tauri/target/release/xwork.exe` (**21,886,976 bytes**). The existing `src-tauri/tauri.conf.json` has `bundle.active = false`, so the command does **not** create an installer. The earlier plan wording expecting an installer was broader than the current configuration; no bundling/configuration change was made. Installed-build packaging and toast smoke remain a later verification step, not a claimed success.
- Patch checks: `git diff --check` passed; `src-tauri/capabilities/main.json` has no diff; the staging area is empty. No historical implementation plan was changed.
- Native verification: **not performed**. This execution environment exposes no native Windows UI-control surface; browser control cannot validate installed Windows notification toasts. Installed toast/visibility smoke remains pending; earlier stage 8–10 native smoke is unchanged. This limitation does not block independent implementation and automated checks.

## Changed Files at Handoff

This manifest includes the pre-existing uncommitted BE-011 design/plan work and all implementation changes; no source change is staged or committed by this task.

- `00-Docs/03-Backend/BE-011-notifications.md`
- `00-Docs/98-Plan/20260906-be-011-notifications.md`
- `src-tauri/Cargo.lock`
- `src-tauri/Cargo.toml`
- `src-tauri/gen/schemas/acl-manifests.json`
- `src-tauri/gen/schemas/desktop-schema.json`
- `src-tauri/gen/schemas/windows-schema.json`
- `src-tauri/migrations/0005_create_notifications.sql`
- `src-tauri/src/app/data_runtime.rs`
- `src-tauri/src/app/mod.rs`
- `src-tauri/src/app/notification_dependencies.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/notifications/commands.rs`
- `src-tauri/src/notifications/mod.rs`
- `src-tauri/src/notifications/models.rs`
- `src-tauri/src/notifications/repository.rs`
- `src-tauri/src/notifications/service.rs`
- `src-tauri/src/platform/mod.rs`
- `src-tauri/src/platform/notification.rs`
- `src-tauri/src/storage/migrations.rs`
- `src-tauri/tests/app_builder.rs`
- `src-tauri/tests/app_lifecycle.rs`
- `src-tauri/tests/cli_profiles_contract.rs`
- `src-tauri/tests/export_bindings.rs`
- `src-tauri/tests/keyboard_shortcuts_contract.rs`
- `src-tauri/tests/notifications_commands.rs`
- `src-tauri/tests/notifications_os_windows.rs`
- `src-tauri/tests/projects_commands.rs`
- `src-tauri/tests/settings_commands.rs`
- `src-tauri/tests/support/notifications.rs`
- `src/bindings/notifications/notifications.ts`
