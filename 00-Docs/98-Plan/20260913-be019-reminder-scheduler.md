# Stage 21 / BE-019 Reminder Scheduler Implementation Plan

**Status:** Complete — backend implementation and automated Windows verification passed; native manual checklist explicitly unexecuted

**Goal:** Deliver durable, deterministic reminder scheduling and notification policy through real Rust services and generated IPC contracts, ready for FE-023 and the FE-010/FE-021 extensions.

**Completion Criteria:**

- Controlled-clock integration tests prove first-run baseline, live delivery, downtime Missed, restart dedupe, Snooze, Dismiss, settings and visibility policy.
- Migration 9 preserves existing inbox rows; migration 10 preserves settings and adds notification policy. Backup v3 remains compatible with stage-20 files, and reset is atomic across reminders, inbox and events.
- Seven main-window reminder commands and reminder/event notification DTOs are generated from Rust; existing terminal behavior remains covered.
- Windows quality gates and Tauri build pass. Native-only observations are reported separately with actual evidence; unperformed smoke checks are never claimed as passed.

**Architecture:** Reminder models, repository, service and scheduler belong to Calendar. App adapters connect public Calendar, Settings, Notifications and lifecycle contracts without capability-private access. SQLite commits precede events and OS dispatch; controlled clocks and recording collaborators substitute every external resource in tests.

**Tech Stack:** Existing stable Rust Edition 2024, Tauri, Tokio, rusqlite, chrono/chrono-tz/rrule, ts-rs and notification plugin from the committed manifest/lockfile. No new dependency or version change is required. Use the existing binding-generating integration test rather than adding a generator binary.

**Sources:**

- `AGENTS.md`, `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 21
- `00-Docs/00-Overview/01-TechStack.md`, `02-ProjectStructure.md`, `03-FunctionalRequirements.md` §§13.3, 15, 17.5, 20
- `00-Docs/03-Backend/BE-019-reminder-scheduler.md`
- `00-Docs/03-Backend/BE-008-settings-persistence.md`
- `00-Docs/03-Backend/BE-011-notifications.md`
- `00-Docs/03-Backend/BE-018-calendar-events.md`
- `00-Docs/03-Backend/BE-012-backup-and-reset.md`, especially stage-20/21 backup compatibility
- `00-Docs/02-Frontend/FE-010-notification-center.md`, `FE-021-calendar.md`
- `00-Docs/01-Wireframe/07-Calendar.html` (Missed, detail, reminder actions), `02-AppShell.html` (bell and notification settings)

## Scope

**In Scope:** BE-019 and required BE-008/BE-011 extensions; migrations 9–10; runtime wiring, reset/backup compatibility, generated bindings and minimal compatibility adjustments to existing TypeScript consumers/fixtures required by expanded unions.

**Out of Scope:** FE-023 design or implementation, new Calendar/bell UI, stage 22, macOS validation, OS toast actions, daemon scheduling while Quit, independent reminders, dependency upgrades, automated desktop E2E.

## Global Constraints

- Use UTF-8 for Markdown files.
- Write code, identifiers, and code comments in English.
- The initial UI language is English.
- Generated bindings under `src/bindings/` are not edited manually.
- During development, build and test only on Windows.
- Do not add or run automated desktop end-to-end tests.
- Every function, method, callback, test, and helper must have a short comment describing its purpose.
- Runtime IPC is real, as required by the current roadmap; the earlier generic mock-IPC rule does not apply to this integrated stage. Fakes are test-only.

## Assumptions, Risks, and Blockers

**Assumptions:** Git history ends with `724d2fb Implement FE022`, preceded by FE021 and BE018. The user explicitly authorized Plan → Implement and feature commits, and delegated design decisions to agents. The coordinator does not perform a review gate.

**Risks:** Timer/catch-up races, notification crash gaps and maintenance deadlocks require deterministic barriers, not real-time sleeps. Existing app test builders must not start native side effects inadvertently. Newly widened TypeScript unions may require compatibility changes before FE implementation. Native Windows toast display cannot be proved by a recording adapter.

**Blockers:** None for implementation. Native smoke availability is an evidence limitation to record, not permission to fabricate verification.

## Dependency Order

1. Migrations/settings → durable policy and schema.
2. Notifications intake → stable bell outbox destination.
3. Reminder state/actions → durable identity and mutation semantics.
4. Scheduler → controlled live/catch-up behavior.
5. Composition/reset/backup → lifecycle correctness.
6. Generated contracts and Windows gates → backend handoff and commit.

---

### Task 1: Persist and publish notification settings with safe migrations

**Outcome:** Existing databases upgrade through 9 and 10 and consumers read committed notification settings.

**Depends On:** None.

**Files:** Create `src-tauri/migrations/0009_create_reminder_deliveries.sql`, `0010_add_notification_settings.sql`; modify `src-tauri/src/storage/migrations.rs`, `src-tauri/src/settings/mod.rs`; test `src-tauri/tests/settings_commands.rs` and storage/settings unit tests.

**Interfaces:** Consume Storage transactions and `DataMaintenanceGate`; produce BE-008 `NotificationSettingsDto`, patch fields, extended snapshot and `SettingsService::subscribe` watch receiver. Defaults: terminal activity true; OS needs-input true, finished false, error true; event reminders true.

- [x] Add an executable test in existing `settings_commands` asserting upgraded `PRAGMA user_version = 10`, five defaults, preserved appearance and terminal notification rows. Run `cargo test --manifest-path src-tauri/Cargo.toml --test settings_commands`; before implementation the version assertion reports 8 instead of 10.
- [x] Implement the exact SQL/checks/indexes in BE-019/BE-008 without altering migrations 1–8. Keep the existing runner's per-migration transactional semantics: failure in 10 leaves successfully committed 9, never a partially applied 10.
- [x] Extend strict decoding, patch merge, cache and owned maintenance projection. Cache replacement precedes one watch `send_replace` after commit. Restore Appearance preserves policy; no failed write publishes.
- [x] Test disjoint concurrent patches, invalid/null input, SQLite write failure injected with an aborting trigger in an isolated database, restart persistence, subscriber latest revision, and migration rollback using the runner's local migration fixtures. Run the same integration target plus `cargo test --manifest-path src-tauri/Cargo.toml --lib`; all pass.

### Task 2: Extend Notifications with an idempotent reminder intake

**Outcome:** Event reminder rows can be safely created, updated, opened and removed without changing terminal behavior.

**Depends On:** Task 1.

**Files:** Modify `src-tauri/src/notifications/{models,repository,service,commands,mod}.rs`, `src-tauri/src/app/notification_dependencies.rs`; tests `src-tauri/tests/notifications_commands.rs`, `notifications_os_windows.rs`, `calendar_consumers.rs`; extend `src-tauri/tests/support/notifications.rs` where shared fixtures require new collaborators.

**Interfaces:** Produce BE-011 `ReminderNotificationInput`, `ReminderNotificationKind`, `upsert_reminder`, `remove_reminder`, event target variants and `NotificationDependencies::event_target`. Consume public `CalendarService::get_notification_context` and committed Settings snapshot via app adapter. Intake never calls OS.

- [x] Added executable event-row decode/restart tests. A behavioral red result was not collected because parallel module introduction prevented compilation before the decoder extension; these failures are not counted as red evidence.
- [x] Implement stable source key `event-reminder:{delivery_id}`; repeated same delivery/version input is a no-op including read state and revision. A new generation refreshes unread/time/version while retaining ID. This is required for retry after a successful inbox commit.
- [x] Resolve Open through the app-owned Calendar adapter before mark-read, mapping missing/error/current project correctly. Switch terminal policy from hardcoded defaults to Settings snapshot; no backfill or deletion when disabled.
- [x] Prove generic inbox delete does not dismiss or recreate a synced delivery, stale target does not mark-read, startup/Quit remove terminal rows only, normalization/redaction, and existing terminal matrix. Run `cargo test --manifest-path src-tauri/Cargo.toml --test notifications_commands --test notifications_os_windows --test calendar_consumers`; all pass.

### Task 3: Implement durable reminder queries and actions

**Outcome:** Reminder identities, versions, Missed pages and actions obey the documented state machine.

**Depends On:** Tasks 1–2.

**Files:** Create `src-tauri/src/calendar/reminder_models.rs`, `reminder_repository.rs`, `reminder_service.rs`, `reminder_commands.rs`; modify `src-tauri/src/calendar/mod.rs`; create `src-tauri/tests/reminder_actions.rs`.

**Interfaces:** Produce the seven BE-019 commands, exact DTO/error types, `ReminderClock` seam, event sink and reminder service collaborator ports. Queries return decimal-string sequence/version/timestamps as specified; command authorization allows exact label `main` only. Test-only collaborators inject controlled now, recording event sink, public Calendar context and Notifications intake.

- [x] Created the discoverable `reminder_actions` integration target covering real Missed/action behavior. Temporary API shells were omitted; no pre-implementation behavioral red is claimed.
- [x] Implement strict model decoding, keyset page/count, context validation, optimistic action transaction and aggregate post-commit sequence/event. Use parameterized SQL only; cancelled rows remain internal.
- [x] Test Open leaves status/count unchanged; Snooze only active at now + 5/10/30 minutes; invalid duration/overflow does not write; simultaneous same-version actions commit exactly once; Dismiss all changes Missed only and no-op emits nothing. Test show/new-token/stale-hide and hidden-main eligibility separately.
- [x] Run the action target and library unit tests; all assertions pass. Repository transactions never retain connection/transaction references across await, and dependency calls occur outside mutation/Storage locks.

### Task 4: Schedule live reminders and recover downtime deterministically

**Outcome:** A single signal-driven worker maintains a durable half-open checkpoint and outbox, including Snooze/reconciliation.

**Depends On:** Tasks 1–3.

**Files:** Create `src-tauri/src/calendar/reminder_scheduler.rs`, `src-tauri/src/app/reminder_dependencies.rs`, `src-tauri/tests/reminder_scheduler.rs`, `src-tauri/tests/reminder_notifications.rs`; modify reminder service and Calendar module exports from Task 3.

**Interfaces:** Consume public BE-018 `reminder_occurrences`/`get_notification_context`, notification intake, Settings watch, `ReminderClock::now_ms/sleep_until`, recording `OsNotification` adapter and lifecycle visibility; produce worker wake/join and documented reset/Quit methods.

- [x] Created controlled-clock scheduler tests exercising baseline, live/downtime boundaries and durable worker behavior. The temporary no-op worker/red step was omitted during parallel integration; passing executable assertions provide the delivered verification.
- [x] Implement NULL first-run baseline; restart `[checkpoint,startupBoundary)` as Missed; live scan through checked `now + 1`; 31-day chunking and saturation split (5,000 items, 1-ms saturation preserves checkpoint). Future horizon wakes at earliest due or at most six hours when empty.
- [x] Implement outbox retry 1s exponential to 5min, stable idempotency, suppression on current policy, and durable OS attempted/suppressed-visible decision before adapter invocation. Never send OS for Missed and never retry OS after attempted. Make same-process resume active, clock rollback nondecreasing, and Snooze use current time.
- [x] Implement invalidation reconciliation and cancellation via public context, multiple offsets/recurrence/all-day DST/skipped dates, and no past-event/import backfill. Keep dismissed/suppressed identities for dedupe.
- [x] Test duplicate wake, restart/crash around both inbox commit and OS attempt, adapter failure, settings-off before retry, exact detail visible vs other route, stale tokens, Calendar dependency failure, invalid candidate, saturation, and worker shutdown while waiting. Use explicit ack/barrier or bounded timeout solely as hang protection, never real sleeps to drive due behavior.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test reminder_scheduler --test reminder_notifications --test reminder_actions`; all pass. Test each startup failure: corrupt checkpoint via isolated SQL must return sanitized corruption error without readiness; fake Calendar failure during catch-up preserves checkpoint and readiness remains catching-up until successful retry.

### Task 5: Integrate lifecycle, import and atomic reset

**Outcome:** Hide-to-tray keeps scheduling; true Quit joins before Storage closes; reset/import reconcile without leaked timers or data loss.

**Depends On:** Tasks 1–4.

**Files:** Modify `src-tauri/src/app/mod.rs`, `lifecycle.rs`, `data_runtime.rs`, `data_participants.rs`, `notification_dependencies.rs`; `src-tauri/src/calendar/service.rs`; `src-tauri/src/settings/data.rs`, `data_participant.rs`, `mod.rs`; tests `src-tauri/tests/app_builder.rs`, `data_management_contract.rs`, `calendar_consumers.rs`. Use the existing app participant file unless the documented reset-only contracts justify `app/data_reset_participants.rs`.

**Interfaces:** Calendar committed event fan-out; Reminder pause/resume/shutdown/reset plan/projection; coordinator `DataResetContext.reminder_baseline_ms` captured once; optional typed v3 `notificationSettings`; existing isolated builder configuration with injected collaborators.

- [x] Extended `data_management_contract` with real Reminder/inbox reset commit and injected rollback, typed policy import and v3 compatibility assertions. No pre-implementation red reset result was collected.
- [x] Wire production after migrations 1–10 and before dependent readiness, without blocking Tauri callbacks. Calendar sink fans out only committed invalidation. Main visibility reaches Reminder in committed lifecycle order. Quit failure remains fail-closed.
- [x] Pause Reminder before Notifications while maintenance write ownership blocks normal admission; cancellation-safe permit waits must not deadlock. Reset deletes Reminder child state and inbox before Events, sets checkpoint from one captured baseline, and publishes owned projections only after commit before resume. Inject aborting transaction trigger to prove rollback retains rows/cache/sequence and resumes the old scheduler.
- [x] Preserve stage-20 v3 compatibility: missing notificationSettings keeps local policy, present valid object imports atomically, null/invalid rejects before write. v1/v2 keep events/policy. New v3 exports include policy but exclude deliveries/checkpoint/inbox. Test golden old v3, new round trip, invalid/null, rollback and byte-level prohibited-state exclusion.
- [x] Mock builder performs bootstrap without a background timer and uses temporary app data plus existing native fakes. Dedicated Reminder tests use an explicit controlled clock. Broken migration SQL is injected in the local runner fixture; corrupt Reminder checkpoint is injected through isolated Storage into the same service constructor used by app setup. No global environment mutation or actual OS dispatch is used.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder --test data_management_contract --test calendar_consumers`; all pass, including repeated hide/show, shutdown order and reset rollback/commit.

### Task 6: Generate contracts and hand off the verified backend

**Outcome:** FE implementer consumes concrete generated contracts from the completed backend.

**Depends On:** Tasks 1–5.

**Files:** Modify `src-tauri/tests/export_bindings.rs`; generate `src/bindings/reminders.ts`, `settings.ts`, `notifications/notifications.ts` and affected data-management binding. Minimal existing TypeScript consumer/test changes are limited to compilation/runtime-safe handling of new generated fields/union branches; leave feature UI to the FE task.

**Interfaces:** Seven commands: `get_missed_reminders`, `get_event_reminder_deliveries`, `open_reminder`, `snooze_reminder`, `dismiss_reminder`, `dismiss_all_missed_reminders`, `set_visible_calendar_event`; `reminders://changed` supplies sequence/missedCount. BE-011 retains six commands, adding typed event target with delivery ID/version. Settings uses existing get/update commands; no public settings event or JS plugin permission.

- [x] Extend the existing exporter test list; run `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings`. Its established first run writes stale output and fails the drift assertion; rerun to verify current output. Never edit generated output manually.
- [x] Verify custom command registration and main-window-only authorization in reminder action/app-builder tests. Inspect capability diff to prove no new notification plugin permission or broad filesystem/OS permission.
- [x] Run all Final Verification commands once after targeted checks pass. Correct regressions within scope; record commands/results and any material deviations.
- [x] Record native Windows smoke evidence separately. If native UI control is unavailable, provide the exact unperformed checklist and carry the limitation into handoff; do not represent a mock builder or build as native observation.
- [x] Hand off to coordinator for the explicitly requested `Implement BE019` commit, including plan and related design decisions. No source implementation or commit occurs during plan creation.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Frontend formatter | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No errors |
| Frontend types | `pnpm typecheck` | Expanded generated DTOs compile |
| Frontend regression tests | `pnpm test` | Existing behavior passes |
| Frontend production | `pnpm build` | Build succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | No warnings |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` | All unit/integration/contract targets pass |
| Binding contract | `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings` | No drift after generation |
| Windows desktop | `pnpm tauri build` | Build/bundle succeeds |

Native manual Windows checklist (installed identifier `com.xwork.app`, disposable test profile/app-data): confirm a future event reminder produces informational OS toast and bell when main hidden; same event detail visible suppresses OS but keeps bell; Quit before due then reopen yields Missed without OS burst; Snooze/Dismiss UI checks belong to following FE implementation. Do not use real developer data or run automated desktop E2E. When a safe isolated installed profile cannot be obtained, leave this checklist explicitly unexecuted. macOS remains stage 22.

## Deviations and Decisions

- 2026-09-13: Apply BE-012's existing stage-20/21 v3 staging rule over older BE-008/BE-019 prose that deferred all v3 until migration 10. New export includes typed settings; old v3 absence preserves local policy.
- 2026-09-13: Use `tests/export_bindings.rs`, the existing write-and-drift-test generator, rather than the nonexistent `src/bin/export_bindings.rs` listed in BE-019.
- 2026-09-13: Existing `app/data_participants.rs` owns concrete adapters. Add a separate reset-only file only for a real responsibility split, not to match a stale anticipated path.
- 2026-09-13: Migration rollback follows existing per-version atomicity; previously committed migrations are not rolled back because a later version fails.

## Outcome

Implementation now includes migrations 9–10, notification settings/watch and optional v3 backup policy, reminder repository/service/worker/actions, real Notifications intake, lifecycle/reset composition and generated Rust/TypeScript contracts. All native adapters remain behind Rust; the capability, manifest and lockfile diff is empty.

Targeted verification has passed: Settings commands 20, settings unit tests 18, Notifications commands 24, Notifications OS 4, Calendar consumers 1, Reminder actions 6, Reminder notification/worker 11, Data Management 36, app builder 17 and binding exporter 15. Additional real Calendar projection tests cover all-day DST and the skipped Apia date. Final full Rust verification passed **631 tests across 33 targets**, with one pre-existing explicitly ignored Notes performance benchmark.

Frontend formatter, lint, typecheck, production build and all 164 test files / 2,662 tests have passed. A newly added navigation test initially failed because its location fixture omitted the query string; the fixture was corrected and the full suite then passed. Existing Vite chunk-size/dynamic-import diagnostics remain informational.

The initial unrestricted full Rust build exceeded Windows virtual-memory capacity (`os error 1455`, metadata mmap/allocation failures). No assertion conclusion was drawn from that infrastructure failure. The full Rust suite then passed with `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --no-fail-fast`, preserving all targets and assertions while limiting compiler concurrency. Old global-schema assertions in lifecycle, Calendar, Projects, CLI Profiles, Notes, Shortcuts and Files fixtures were updated to migration 10 and the added tables/indexes. Final Clippy (`--all-targets --all-features -j 2 -- -D warnings`), Rustfmt and diff checks also passed. Tauri build runs sequentially with process-local `CARGO_BUILD_JOBS=2`.

Manual native Windows smoke is **not executed**: this backend-only handoff has no safely isolated installed interactive application profile. The informational toast, exact-detail suppression and Quit/reopen observations remain the explicit native checklist above; recording OS tests and bundle compilation do not establish visible toast delivery. macOS validation remains deferred.


## Execution Decisions

- The Settings migration behavior produced a real red assertion (`left: 8`, `right: 10`) before schema implementation. Compile failures during parallel Reminder/Notifications module introduction were not counted as behavioral red tests. The planned temporary service shells were skipped; executable regression targets cover the implemented behavior.
- Use cancellation-safe `poll_fn` signal selection with the existing Tokio feature set. Pause/Quit cancels dependency waits, including a Calendar call blocked by the maintenance writer, before awaiting worker quiescence. An explicit blocked-query barrier test proves reset does not depend on that query resuming.
- Existing mock app composition performs one bootstrap scheduling cycle without a background timer; the dedicated worker tests use controlled time and timer-registration/oneshot acknowledgement. No real sleep drives reminder deadlines and no desktop E2E is added.
- The aggregate v3/reset contract test checks rollback after the last import owner fails, old v1/v2/v3 absence compatibility, policy null rejection, prohibited-state byte exclusion, reset child-state rollback and exact committed baseline/sequence.
- Snooze samples time after maintenance admission and the mutation gate. Duplicate delivery identities are accepted only when event/start/due/offset semantics agree; metadata and timezone refresh reconcile through public Calendar context.


## Final Gate Evidence

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: passed on the final frontend changes.
- `pnpm test`: 164 files and 2,662 tests passed; `pnpm build`: passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --no-fail-fast`: 631 passed, zero failed, one intentionally ignored existing `notes_windows_10000_record_benchmark`; all 33 targets completed. The 15-test binding exporter is included and reports no drift.
- `git diff --check`: passed. `git diff -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities src-tauri/tauri.conf.json`: empty.
- `pnpm tauri build` with process-local `CARGO_BUILD_JOBS=2`: passed, release compilation 3m17s; produced `src-tauri/target/release/xwork.exe`. The repository configuration disables installer bundling, so no MSI/NSIS artifact is claimed.
- Verification logs: `%TEMP%/xwork-be019-rust-tests.log`, `xwork-be019-clippy.log`, `xwork-be019-fe-tests.log`, `xwork-be019-tauri-build.log`.


## Handoff

BE-019 is ready for the coordinator's requested `Implement BE019` commit. Include the active plan, BE-008/BE-019 decision notes, migration 9/10, all Reminder/Notifications/Settings/app composition changes, generated bindings, minimal TypeScript union compatibility and schema-version fixture updates. No commit was created by the implementation agents.

FE handoff: consume `src/bindings/reminders.ts`, the widened Notification target and `AppSettingsDto.notifications`. Seven Reminder commands are registered; `reminders://changed` is emitted to `main`. Existing Notification entry sends `event` and `occurrence` query parameters into Calendar; the following FE extension owns exact occurrence restoration, visible-detail tokens and Missed/Snooze/Dismiss controls. Native toast visibility and installed-profile Quit/reopen smoke remain unperformed and must not be inferred from the passing build or recording collaborators.
