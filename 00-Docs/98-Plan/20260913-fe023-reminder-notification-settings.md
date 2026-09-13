# FE023 — Stage 21 Reminder and Notification Settings Implementation Plan

**Status:** Implementation and automated verification complete; native Windows acceptance pending

**Goal:** Integrate real Notifications settings, reminder actions, Calendar Missed and exact-event visibility into the completed BE019 backend, with reproducible Windows verification of Phase 4 behavior.

**Completion Criteria:**

- Settings Notifications persists the two category switches and three CLI OS states through BE008; route contains no placeholder.
- Bell reminder rows support Open, active-only Snooze 5/10/30 and Dismiss while retaining terminal/read/delete behavior.
- Calendar Missed displays backend-owned pages/count and supports Open, single/all Dismiss; Event detail consumes authoritative delivery states and owns race-safe visibility.
- The minimal nullable-occurrence visibility adjustment is generated from Rust and covered by backend contract/policy tests.
- All final automated gates pass on Windows. Record the manual native smoke result separately; a build, mock or recording OS adapter is not a native toast observation. Do not claim the entire native/Phase 4 acceptance is complete while manual checks remain pending.
- The coordinator commits the completed feature slice as `Implement FE023`, as requested by the user.

**Architecture:** React owns presentation and short-lived snapshots; Rust owns policy, persistence, scheduling and notification delivery. Reuse Settings' existing write queue and Data barrier; use narrow reminder IPC wrappers shared by Calendar and Notifications, without cross-feature implementation imports. App composition continues to own route and lifecycle boundaries.

**Tech Stack:** Existing locked React/TypeScript, Zustand, Radix/shadcn source, Vitest/Testing Library, Tauri 2/Rust/ts-rs stack. No dependency, capability, migration or command addition is planned; use manifest/lockfile versions already present.

**Sources:**

- `AGENTS.md`, `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 21
- Constraints: `00-Docs/00-Overview/01-TechStack.md`, `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §§13, 15, 17.5, 18, 20 Phase 4
- `00-Docs/02-Frontend/FE-023-settings-notifications.md`
- Stage 21 extensions of `00-Docs/02-Frontend/FE-010-notification-center.md`, `FE-021-calendar.md`, `FE-022-event.md`
- `00-Docs/03-Backend/BE-019-reminder-scheduler.md`, `BE-008-settings-persistence.md`, `BE-011-notifications.md`
- Wireframes: `00-Docs/01-Wireframe/02-AppShell.html#settings-notifications`, `#notifications`; `00-Docs/01-Wireframe/07-Calendar.html#month`, `#upcoming`, `#missed`, `#detail`, `#reminder`, `#form`
- Implemented BE019: commit `09498e6` (`Implement BE019`). Its completed plan is historical and must not be edited.

## Scope

**In Scope:** FE023 and the Stage 21 FE010/FE021 reminder extensions, plus the FE022 delivery/visibility integration required for correct OS eligibility. This is one feature slice and one completion commit, not separate reimplementation of earlier features.

**Out of Scope:** Native OS toast action buttons/click routing (not supported by the current notification adapter contract), scheduler redesign, desktop E2E automation, macOS validation, release packaging/signing, new dependencies, unrelated refactoring and changes to completed plans.

## Global Constraints

- React owns presentation and temporary UI state.
- Rust owns OS access, persistence, terminal processes, and business rules.
- Frontend-backend communication uses narrowly scoped Tauri commands and events.
- Frontend features do not import implementation from other features.
- Generated bindings under `src/bindings/` are not edited manually.
- Write code, identifiers, and code comments in English.
- The initial UI language is English.
- Every function, method, callback, test, and helper must have a short comment describing its purpose.
- During development, build and test only on Windows.
- Do not add or run automated desktop end-to-end tests.
- Read/write Markdown as UTF-8. Keep changes surgical; document material integration decisions in the owning design before extending file scope.

## Assumptions, Risks, and Blockers

**Assumptions:**

- The user authorized implementation and commits and delegated all design questions to agents. All source specifications have no unresolved questions.
- BE019's committed settings/reminder bindings and commands are available. Only show-visibility occurrence nullability needs a boundary adjustment.
- Missed is global because the actual backend query has no project filter. Detail Open keeps occurrence IDs opaque and does not need them inside the current month range.
- Bell deletion/read and reminder dismissal remain distinct. Snooze is active-only; Missed has no Snooze. OS toast buttons drawn in the wireframe are explicitly excluded by the existing backend contract.

**Risks:**

- Stale settings reads and mixed Appearance/Notifications writes may overwrite snapshots: preserve one write slot, revision/generation guards and the Data barrier in Task 2.
- Reminder sequence and Notifications revision are separate monotonic domains. Do not compare them; acknowledgement/refetch and per-owner generations prevent stale actions in Tasks 3–5.
- A late visibility show can outlive cleanup: serialize lifecycle IPC and token cleanup, with deferred-promise tests in Task 5.
- Windows linking previously exhausted virtual memory. Run heavy commands sequentially with `-j 2` and frontend tests with `--maxWorkers=2`; do not run Rust linking concurrently with frontend suites/builds.
- Native computer controls are disabled and no safely isolated installed interactive profile has been established. Manual native smoke is currently unexecuted; carry the limitation honestly, rather than substituting automated desktop E2E or claiming OS observation from mocks.

**Blockers:** None for implementation or automated verification. Native smoke requires an available safe interactive Windows test profile; keep that verification item pending if unavailable.

## Dependency Order

1. Task 1 nullable visibility DTO and shared reminder IPC → Tasks 3–5.
2. Task 2 Notifications settings → complete policy controls.
3. Task 3 bell actions → Task 4 Missed shares wrappers/error handling.
4. Task 4 Missed and occurrence route intent → Task 5 delivery/detail visibility.
5. Task 6 complete automated/native evidence matrix → coordinator completion commit.

---

### Task 1: Establish the exact reminder IPC and base-detail visibility contract

**Outcome:** The seven existing commands and reminder event have typed frontend wrappers; base detail can report visibility without fabricating an occurrence.

**Depends On:** None.

**Files:**

- Modify: `src-tauri/src/calendar/reminder_models.rs`, `src-tauri/src/calendar/reminder_service.rs`, `src-tauri/src/calendar/reminder_scheduler.rs`.
- Test: `src-tauri/tests/reminder_actions.rs`, `src-tauri/tests/reminder_notifications.rs`, `src-tauri/tests/export_bindings.rs`.
- Generated: `src/bindings/reminders.ts` (only exporter output).
- Create: `src/lib/ipc/reminders.ts`, `src/lib/ipc/reminders.test.ts`, `src/lib/ipc/reminder-error.ts`, `src/lib/ipc/reminder-error.test.ts`.

**Interfaces:**

- Consumes current seven Reminder commands, ReminderError, typed DTOs and `reminders://changed` from BE019; `invokeCommand`/`IpcCallError` and Tauri `listen` from existing IPC conventions.
- Produces exact wrapper signatures in the FE010 Stage 21 table. `VisibleCalendarEventInputDto.Show.occurrence_id: Option<String>` maps to `occurrenceId: string | null`; all other public fields and command names remain unchanged.
- Test seam: existing temporary Storage and ReminderClock/recording dependency fixtures; frontend mocks invoke/listen at the public IPC boundary. No real app data, OS toast or process-global environment mutation.

- [x] **Step 1: Write focused failing tests.** Add a Rust serde test to deserialize a show payload with valid event/token and null occurrence into the existing enum, expecting success. This target already exists and compiles; current required String causes the null-deserialization assertion to fail. Include existing supplied-occurrence and invalid-ID behavior. Create discoverable IPC test files with minimal wrapper exports if needed so failure observes incorrect command/payload/error behavior, not a missing module or zero test match.
- [x] **Step 2: Capture the red result.** Run `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --test reminder_actions -- --test-threads=1`; expected failure is null show deserialization. Run `pnpm test -- src/lib/ipc/reminders.test.ts src/lib/ipc/reminder-error.test.ts --maxWorkers=2`; expected assertion identifies the missing wrapper command/payload or recovery category. Record actual evidence; do not retroactively claim red for tests first run after implementation.
- [x] **Step 3: Implement minimally.** Validate event ID regardless of occurrence, validate supplied occurrence as before, keep null base detail in runtime projection and exact-event/main-visible policy. Adapt existing Rust fixture constructions to `Some` only where necessary in named test/source files. Add all wrappers and a small shared reminder error classifier/copy helper because Calendar and Notifications both consume it. No scheduling, generated manual edits or OS calls in frontend.
- [x] **Step 4: Verify.** Run `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --test reminder_actions --test reminder_notifications -- --test-threads=1` and the focused IPC command above. Null/supplied occurrence, bad IDs, same-event suppression with bell retained, other-event eligibility, hidden main and stale-token hide must pass. Run `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --test export_bindings`; its existing first run may write drift and fail; rerun until the generated nullable binding is current and the drift assertion passes. Record the generation run separately from passing checks.

### Task 2: Replace Notifications settings with durable policy controls

**Outcome:** Two switches and three CLI OS checkboxes use real settings snapshots and survive mixed settings writes/maintenance without lost updates.

**Depends On:** None; execute after Task 1 in this sequential slice.

**Files:**

- Create: `src/features/settings/settings-notifications-route.tsx`, `src/features/settings/settings-notifications-route.test.tsx`.
- Modify: `src/features/settings/settings-store.ts`, `src/features/settings/settings-test-fixture.ts`, `src/app/app-router.tsx`.
- Test: `src/features/settings/settings-store.test.ts`, `src/features/settings/data-management-provider.test.tsx`, `src/app/app-router.test.tsx`, `src/lib/ipc/settings.test.ts`.
- Reuse: existing SettingsSection, SettingRow, Switch, Button and settings error copy; no component/dependency additions needed for native checkbox controls.

**Interfaces:**

- Consumes `getSettings(): Promise<AppSettingsDto>`, `updateSettings(input: UpdateSettingsDto): Promise<AppSettingsDto>`, generated notifications policy DTOs.
- Produces `SettingsNotificationsRoute()` and store `commitNotifications(patch: NotificationSettingsPatchDto): Promise<void>` within the existing queue/barrier lifecycle; notification pending/error state stays separate from Appearance draft/error state.
- Test seams: resetSettingsStore/settings fixture, mock public settings IPC and deferred promises; DataManagement provider's existing operation fixture, no persistent settings or real user profile.

- [x] **Step 1: Add discoverable failing route/store tests.** First extend the existing router test to expect `Terminal and AI CLI activity` instead of the placeholder; add controlled store cases for Appearance then Notifications writes, reverse order, focus read after write, notification write pending at Data settle and unknown-result recovery. Add route tests for disabled OS checkbox retention, all three false, full three-field OS patch, saving/error and keyboard.
- [x] **Step 2: Capture red.** Run `pnpm test -- src/app/app-router.test.tsx src/features/settings/settings-notifications-route.test.tsx src/features/settings/settings-store.test.ts src/features/settings/data-management-provider.test.tsx src/lib/ipc/settings.test.ts --maxWorkers=2`. Expected missing policy controls/notification patch behavior, not zero matching tests.
- [x] **Step 3: Implement.** Add route branch for the existing notifications section; serialize policy and Appearance writes without dropping a queued operation of another kind. Disable policy controls while its admitted write is pending; display backend-committed values and no synthetic defaults. On mount/focus read safely without allowing stale reads to replace newer snapshots. Extend Data settle/uncertain-write handling to notification writes and retain Appearance behavior. Catch read initialization failure using rejected getSettings fixture → error alert and Retry, never checked defaults. Do not add nonexistent Settings events.
- [x] **Step 4: Verify.** Repeat the same focused command and `pnpm typecheck`; all behaviors and existing Appearance/Data tests pass. Confirm `update_settings` sends only the notification patch and unrelated policy values are retained.

### Task 3: Integrate reminder actions into the existing bell

**Outcome:** Due/Missed rows work with real target/version semantics and terminal behavior remains intact.

**Depends On:** Task 1.

**Files:**

- Modify: `src/features/notifications/notification-center.tsx`, `src/features/notifications/use-notifications.ts`, `src/app/notification-entry.tsx`.
- Test: `src/features/notifications/notification-center.test.tsx`, `src/features/notifications/use-notifications.test.ts`, `src/app/notification-entry.test.tsx`.
- Reuse: `src/components/ui/dropdown-menu.tsx`, existing button/tooltip/popover and IPC wrappers.

**Interfaces:**

- Consumes NotificationDto kinds/target union, `openNotification`, `snoozeReminder`, `dismissReminder`, `onRemindersChanged`, shared reminder errors.
- Produces existing NotificationCenter props unchanged; pending state gains reminder operations, app routes the validated event target with occurrence and optional project.
- Test seam: existing notification fixture/mock IPC and abort/lifecycle controls; deferred command and listener promises, fake timer only for presentation/refetch coalescing.

- [x] **Step 1: Add failing behavior cases** to existing targets: active due has three Snooze choices; missed does not; Dismiss uses delivery ID/version; Open uses notification ID and does not dismiss; Delete/Clear read never call Reminder mutations. Include reminder error copy, stale/unknown outcome, refetch without event, menu keyboard/focus and terminal regression.
- [x] **Step 2: Capture red.** Run `pnpm test -- src/features/notifications/notification-center.test.tsx src/features/notifications/use-notifications.test.ts src/app/notification-entry.test.tsx --maxWorkers=2`; expected missing Snooze/Dismiss or incorrect event target behavior.
- [x] **Step 3: Implement.** Extend row rendering/actions and lock/generation logic; keep read/delete ownership distinct. Reconcile after acknowledged/uncertain mutation rather than relying solely on best-effort events. Update footer/empty/target error copy and link to Notifications settings. Maintain one listener per owner with late cleanup and no cross-domain sequence comparison.
- [x] **Step 4: Verify.** Repeat focused command. Verify exact event/occurrence/project URL and no session activation for event targets. Prior terminal read/paging/navigation/focus cases must continue passing.

### Task 4: Show authoritative Calendar Missed and preserve occurrence navigation

**Outcome:** Calendar has a real global Missed tab/count/page with safe single/all actions and exact event navigation.

**Depends On:** Tasks 1 and 3.

**Files:**

- Create: `src/features/calendar/calendar-missed.tsx`, `src/features/calendar/calendar-missed.test.tsx`, `src/features/calendar/use-missed-reminders.ts`, `src/features/calendar/use-missed-reminders.test.ts`.
- Modify: `src/features/calendar/calendar-route.tsx`, `src/features/calendar/calendar-presentation.ts`, `src/app/calendar-entry.tsx`.
- Test: `src/features/calendar/calendar-route.test.tsx`, `src/features/calendar/calendar-presentation.test.ts`, `src/app/calendar-entry.test.tsx`.

**Interfaces:**

- Consumes MissedReminderPageDto, getMissedReminders/openReminder/dismissReminder/dismissAllMissedReminders, reminder invalidation and existing CalendarBoundary/readBoundary.
- Produces internal Missed panel/hook and optional occurrence URL intent forwarded independently from the current range's CalendarOccurrenceDto. Public CalendarRoute props need no new cross-feature dependency.
- Test seam: mock public reminder IPC with pages of >30 rows, sequences, deferred requests, focus/listener events and controlled Calendar boundary. No real scheduler timer or app data.

- [x] **Step 1: Add failing cases.** Existing CalendarRoute test expects Missed tab and backend count; create hook/component tests with typed pages for empty/catching-up/error, global count despite project scope, load more/reset pages, Open preserving count, Dismiss version/all rows, stale response and boundary retirement. Keep test targets runnable with minimal shells before testing missing behavior.
- [x] **Step 2: Capture red.** Run `pnpm test -- src/features/calendar/calendar-missed.test.tsx src/features/calendar/use-missed-reminders.test.ts src/features/calendar/calendar-route.test.tsx src/features/calendar/calendar-presentation.test.ts src/app/calendar-entry.test.tsx --maxWorkers=2`; expected missing Missed/count/action behavior.
- [x] **Step 3: Implement.** Keep count current in other tabs, load first page with limit 30 and subsequent pages on explicit Load more. State remains global; clarify project scope rather than filtering pages locally. Enforce one read/action with generation/sequence/cursor checks and synchronous boundary admission. Catch getMissedReminders rejection → safe Retry; scheduler_catching_up → loading, retry on change/focus/user Retry with no busy polling. Navigate only openReminder's validated target, retain opaque occurrence URL; clear occurrence when clearing/replacing event selection or creating an event. Format only valid timestamps for presentation.
- [x] **Step 4: Verify.** Repeat focused command. Confirm keyboard focus after Dismiss/all, no Snooze missed, no inference from elapsed event time, and month/day/Upcoming/create/project behavior still passes.

### Task 5: Connect delivery status and exact-event visibility to Event detail

**Outcome:** Event detail shows only authoritative delivery states and accurately reports visible base or occurrence detail through race-safe token lifecycle.

**Depends On:** Tasks 1 and 4.

**Files:**

- Create: `src/features/calendar/use-event-reminders.ts`, `src/features/calendar/use-event-reminders.test.ts`.
- Modify: `src/features/calendar/event-detail-panel.tsx`, `src/features/calendar/calendar-route.tsx`.
- Test: `src/features/calendar/event-detail-panel.test.tsx`, `src/features/calendar/calendar-route.test.tsx`, `src/app/calendar-entry.test.tsx`.

**Interfaces:**

- Consumes `getEventReminderDeliveries(eventId, occurrenceId)`, generated delivery statuses, nullable show input and hide token; current detail mode/epoch/boundary/visibility state.
- Produces internal hook for delivery read and serialized visibility lifecycle. Detail remains the only event view/edit/delete owner; no public cross-feature implementation exports.
- Test seam: mock public IPC and deterministic UUID spy; deferred show/hide/read/listener promises, document visibility and boundary fixtures. Do not mutate OS visibility or desktop state in automated frontend tests.

- [x] **Step 1: Add behavior tests** for base detail show null without delivery query, selected/URL occurrence read, status labels, empty without fabricated Sent, query failure/Retry and stale occurrence. Test A show pending then close, A→B then old cleanup, edit/delete/discard/hidden/maintenance/Quit transitions, subscription setup failure and dirty-draft preservation.
- [x] **Step 2: Record the test-sequencing deviation.** The planned preimplementation red run was not executed for this task. Behavior tests were added alongside implementation and passed in the focused commands and full frontend run recorded under Outcome; this supersedes the planned red step without claiming a missing-behavior failure was observed.
- [x] **Step 3: Implement.** Show only after a successful event read in actual detail view; null is valid for Search/create base detail. Query deliveries only with a real supplied occurrence. Serialize show/hide across retiring and replacement owners; old show cannot overwrite B or survive cleanup, and old hide cannot clear B. Hide when leaving actual detail mode or visibility/boundary. On failed show, display visibility error with Retry while current; cleanup failures do not publish to retired UI. Do not let reminder refresh discard dirty event drafts. Clear stale occurrence after calendar update, retain correct nullable base visibility. Detail shows read-only delivery state; actions remain bell/Missed.
- [x] **Step 4: Verify.** Repeat focused command, then rerun explicit Rust `reminder_actions` and `reminder_notifications` targets from Task 1. Verify base-detail exact-event suppression, bell availability and hidden-main eligibility through recording OS fixtures; record native observation separately.

### Task 6: Demonstrate Stage 21 and Phase 4 acceptance evidence

**Outcome:** Automated checks and an honest native acceptance matrix are recorded, with no unsupported completion claims.

**Depends On:** Tasks 1–5.

**Files:**

- Maintain: this active plan and owning FE023/FE010/FE021/FE022/BE019 designs only for material deviations/completion evidence.
- Read/test: existing backend `src-tauri/tests/calendar_commands.rs`, `src-tauri/tests/calendar_consumers.rs`, `src-tauri/tests/reminder_scheduler.rs`, `src-tauri/tests/reminder_actions.rs`, `src-tauri/tests/reminder_notifications.rs`, `src-tauri/tests/settings_commands.rs`, `src-tauri/tests/notifications_commands.rs`, `src-tauri/tests/notifications_os_windows.rs`, `src-tauri/tests/data_management_contract.rs`, `src-tauri/tests/app_builder.rs`, `src-tauri/tests/export_bindings.rs`.
- Read/test: existing Calendar event form/create/delete/query/aggregate and app Home/Project/Search tests, included by the full frontend command below. Do not edit unrelated tests unless a new scoped contract requires a fixture adjustment documented in its owning design first.

**Interfaces:** Existing Calendar/Reminder public contracts and temporary Storage, CalendarClock/ReminderClock, recording OS and lifecycle fixtures. Frontend deferred IPC tests cover composition and actions, not scheduler correctness.

- [x] Execute the explicit backend acceptance target command in Final Verification, using controlled clocks already implemented. Confirm due/Snooze, Quit/reopen catch-up, no Missed OS burst, recurrence/all-day/timezone and policy/visibility evidence from actual named tests.
- [x] Run every final gate sequentially. Record commands/counts/pass/fail and known warnings. Do not run extra repeated full suites without a new change/failure/unresolved concern.
- [x] Complete the Phase 4 matrix below with test evidence and native status. If no safe native profile/control is available, mark native rows `Not executed` and explain the limitation. Do not create desktop E2E, launch against real developer app data or mutate process-global environment to simulate isolation.
- [x] Record final source/test scope and material decisions in designs; keep previous BE019/FE010/FE021/FE022 plans historical. Hand the finished slice to the coordinator for the authorized `Implement FE023` commit; no extra review stage.

## Final Verification

Run heavy commands sequentially on Windows. Limiting workers does not remove any target/assertion. Tauri build uses process-local `CARGO_BUILD_JOBS=2` only if needed; restore its previous value after the command. This build variable is not a test isolation mechanism.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Frontend types | `pnpm typecheck` | No type errors |
| All frontend tests | `pnpm test -- --maxWorkers=2` | All tests, including every file named in Tasks 1–5, pass |
| Frontend production | `pnpm build` | Production bundle succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings` | All targets/features, warnings denied, pass |
| Explicit acceptance targets | `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --test calendar_commands --test calendar_consumers --test reminder_scheduler --test reminder_actions --test reminder_notifications --test settings_commands --test notifications_commands --test notifications_os_windows --test data_management_contract --test app_builder --test export_bindings -- --test-threads=1` | All named behavior/contract tests pass; no drift |
| Full Rust regression | `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --no-fail-fast -- --test-threads=1` | Every unit/integration/contract target passes; report pre-existing ignored benchmark honestly |
| Windows desktop build | `pnpm tauri build` | Windows release executable builds; current `bundle.active=false` means no installer claim |
| Diff scope | `git diff --check` and `git diff --name-only` | No whitespace issue; only designed files changed, no unexpected command/capability/manifest/migration change |

The diff inspection is a concrete scope/negative-requirement check, not an independent code-review stage. Generated binding diff must be exactly the intended nullable contract and any exporter-required formatting; Rust registration/capability/manifest/migration paths should have no source changes.

### Phase 4 evidence matrix

| Requirement | Automated evidence to record | Targeted native Windows check |
|---|---|---|
| Month/day/Upcoming/Missed | `calendar-month.test.tsx`: roving keyboard dates/overflow; `calendar-route.test.tsx`: separate grid/day/Upcoming and authoritative Missed badge; new `calendar-missed`/`use-missed-reminders` suites cover global count, paging, focus and actions. Rust `calendar_commands`/`calendar_consumers` targets are included below. | **Not executed — native controls unavailable; safe isolated profile not established.** Intended check: all four views and actual WebView2 keyboard/focus. |
| Timed/all-day/project/recurrence/multiple reminders | Calendar form/create/detail/delete suites; `calendar_commands::crud_preserves_identity_and_rejects_stale_revisions`; `calendar_occurrences::recurring_service_retains_valid_count_across_dst_gap`; `reminder_scheduler::real_all_day_dst_and_skipped_date_projections_schedule_each_offset` exercises real all-day daily offsets 60/0 with DST/Apia skipped date. | **Not executed — native controls unavailable; safe isolated profile not established.** Intended check: disposable linked recurring/all-day event CRUD and UI/IME. |
| In-app + OS according to foreground state | `reminder_notifications::live_delivery_syncs_bell_and_attempts_os_once`, `exact_visible_detail_suppresses_os_but_keeps_bell` cover nullable base, same/other occurrence, other event and hidden main; `reminder_actions::visibility_validates_context_and_preserves_newer_token`; `use-event-reminders` serial lifecycle tests; `notifications_os_windows::windows_recording_adapter_eligibility_matrix` is a recording adapter, not a toast observation. | **Not executed — native controls unavailable; safe isolated profile not established.** Intended check: same detail bell without OS, other view and hidden-to-tray eligible informational toast plus bell. |
| Quit-before-due then reopen produces Missed without OS burst | `reminder_notifications::worker_start_is_single_and_quit_cancels_waiting_clock`, `restart_catchup_creates_missed_bell_without_os`; `reminder_scheduler::downtime_is_missed_and_restart_deduplicates`, `resume_live_and_downtime_snooze_missed`. | **Not executed — native controls unavailable; safe isolated profile not established.** Intended check: true Quit before due, reopen after due, Missed and absence of toast burst. |
| Snooze/Dismiss and settings integration | `reminder_actions::snooze_uses_now_and_increments_generation` covers 5/10/30, `open_missed_does_not_dismiss_and_stale_dismiss_conflicts`, `dismiss_all_missed_is_atomic_and_empty_repeat_is_noop`; `settings_commands::notification_policy_watch_and_restart_follow_commits`, `concurrent_notification_patches_keep_both_changes`; frontend bell/Missed exact payload and Notifications keyboard/retention/mixed-queue/Data tests. | **Not executed — native controls unavailable; safe isolated profile not established.** Intended check: actions, policy persistence after reopen, unchanged definitions. |

Use a disposable Windows user/application profile isolated from real project data for manual checks. Do not invent a production app-data override or new feature to obtain a smoke profile. If native controls/profile cannot be established, retain `Not executed — native controls unavailable; safe isolated profile not established` and deliver the implementation/automated evidence with this limitation explicitly outstanding.

## Deviations and Decisions

- 2026-09-13: The user authorized agents to decide design questions and requested only orchestration, with no review stage. Designs were completed before this plan; no source implementation was performed during design/plan work.
- 2026-09-13: Base event detail opened by Search/create lacks occurrence context. Nullable show occurrence is the smallest truthful integration adjustment; no frontend-generated occurrence, new command or recurrence query is introduced. This is part of the FE023 completion commit, not a new BE019 plan/commit.
- 2026-09-13: Missed remains global, no Snooze for missed, Open does not dismiss, notification deletion differs from delivery dismissal, and unsupported native toast buttons are excluded consistently with existing BE019.
- 2026-09-13: Native smoke remains unexecuted at planning time. Existing BE019 evidence is 2,662 frontend tests and 631 Rust tests plus build gates; those prior counts are baseline context, not proof that this FE slice passes.

## Outcome

Tasks 1–6 are delivered as an implementation slice with passing automated gates. Native Windows acceptance remains unexecuted because native controls are disabled and no safe isolated interactive profile has been established; the entire native/Phase 4 acceptance is therefore not claimed complete. The slice is ready for the coordinator to commit as `Implement FE023`.

### Execution evidence — 2026-09-13

- Task 1: nullable serde red observed (6 passed, 1 failed before adjustment); reminder actions/notification policy targets then passed 19 tests. Binding exporter first generated expected drift and failed its drift assertion; rerun passed 15 tests. Shared IPC tests were added after implementation, not reported as red.
- Task 2: router red observed (27 passed, 1 failed for missing Notifications switch); Settings/router/IPC regression then passed 30 files and 659 tests. Queue decisions are recorded in FE023.
- Task 3: event Open red observed (12 passed, 1 failed); focused IPC/bell/hook/app targets then passed 58 tests.
- Tasks 4–5: tests were added alongside implementation rather than using the planned preimplementation red step. Focused Calendar/hook/presentation/app targets passed 41 tests, then additional detail status/dirty-draft checks passed in a 26-test subset. No claim of a red test is made for these additions.
- Integration required the scheduler predicate scope extension recorded in FE022: same-event suppression must not compare occurrence IDs. This preserves the agreed policy for nullable base detail and other occurrences of the same event.
- Full lint initially found one unnecessary dependency diagnostic and two non-null assertion warnings in new Calendar hooks. The epoch is now checked by active ownership and assertions are removed; rerun passed all 398 files.

- Final integration correction: two new Missed tests first failed (5 passed, 2 failed) for absent stale-sequence admission and duplicate continuation rows. Exact BigInt sequence guards, ID deduplication, one first-page recovery for invalid cursor, stale-row action locking and late-listener coverage then passed the focused targets. This source change justified a second full frontend regression run; no Rust source changed after the passing Rust gates.

### Final automated results — 2026-09-13, Windows

| Gate | Observed result |
|---|---|
| `pnpm format:check` | Passed, 398 files |
| `pnpm lint` | Passed, 398 files, no remaining lint diagnostics |
| `pnpm typecheck` | Passed |
| `pnpm test -- --maxWorkers=2` | Final run passed 170 files / 2,715 tests in 157.95 seconds; earlier 2,712-test run preceded the final Missed correction |
| `pnpm build` | Passed standalone and reran successfully through Tauri `beforeBuildCommand` against final source |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Passed |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings` | Passed |
| Explicit acceptance command above | Passed 150 tests across all 11 selected targets, including binding drift |
| Full Rust command above with `--no-fail-fast` | Passed 633 tests, 0 failed; 1 pre-existing ignored `notes_windows_10000_record_benchmark` remains a separate performance measurement |
| `pnpm tauri build` | Passed; final release compile 3m 07s; executable `src-tauri/target/release/xwork.exe`. `bundle.active=false`: no installer was produced or claimed |
| Scope / whitespace | `git diff --check` passed; generated binding diff is only nullable `occurrenceId`. No capability, command registration, dependency manifest/lockfile or migration changes |
| Native Windows checks | **Not executed**, as documented in every Phase 4 matrix row |

Known non-failing diagnostics: existing CodeMirror static/dynamic import overlap, large production chunk and Vite plugin timing warnings; ts-rs reports that it ignores `serde(deny_unknown_fields)` during binding parsing. Git reports existing CRLF-to-LF normalization notices without whitespace errors. These do not substitute for native smoke evidence.

Final scope: FE023 Settings route/queue and Data admission tests; shared Reminder IPC/error adapters; bell actions and existing event-route contract tests; Calendar Missed paging/count/actions and occurrence navigation; detail delivery/visibility lifecycle; minimal Rust nullable visibility plus exact-event eligibility correction and generated binding. Prior completed BE019/FE010/FE021/FE022 plans remain unchanged.
