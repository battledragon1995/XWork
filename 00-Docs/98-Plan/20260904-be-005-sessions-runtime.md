# BE-005 Sessions Runtime Implementation Plan

**Status:** Implemented — automated verification complete; targeted Windows smoke pending

**Goal:** Implement the complete backend-owned `BE-005` runtime so XWork can
create and manage process-local sessions, tabs, and pane trees; expose stable
Tauri commands, generated TypeScript bindings, and Rust-only consumer
snapshots; and integrate session cleanup and visibility with Projects, CLI
Profiles, lifecycle, tray, and the shared data-maintenance gate without adding
persistence or starting a terminal process.

**Completion Criteria:**

- A newly constructed `SessionManager` is empty, allocates opaque monotonic
  `session-`, `tab-`, `pane-`, and `split-` identifiers, and never restores
  runtime state from SQLite, backup data, or a previous process.
- Session creation is admitted only for an available project, holds the shared
  `DataReadPermit` through the committed state and event publication, creates
  `New Session` with no tabs and `NoToolYet`, and is excluded by project-close
  and shutdown gates at commit time.
- All session/tab/pane mutations preserve the exact naming, ordering, active,
  split-tree, ratio, maximize, four-pane, no-op revision, and status invariants
  in `BE-005`.
- Tool selection rechecks the current BE-006 launchability contract, records
  `ToolSelection` only for an available profile, and neither resolves secrets
  nor creates a process.
- Output, activity, route, and main-window visibility updates produce the
  documented aggregate status and unread behavior. The Rust-only attention
  snapshot records the revision of the latest transition into
  `NeedsAttention` and gives the tray a reliable newest-first ordering without
  relying on best-effort Tauri event delivery.
- Close impact is recalculated at commit, session deletion always requires
  confirmation, tab/pane confirmation follows live process and unsaved-file
  blockers, and close/reopen handles partial failure, retry, tree collapse,
  active selection, one retained tab, and idempotent content operations without
  holding the Sessions state lock across an await.
- Project removal, true Quit, and future Reset use the public Sessions owner
  methods. Project cleanup is scoped and retryable; shutdown clears state only
  after all content cleanup succeeds; Reset resume reopens admission without
  restoring cleared sessions.
- Every Sessions command authorizes the exact `main` window before validation,
  dependency lookup, or state access and is registered without adding a
  capability permission. Backend consumers call Rust methods directly without
  webview authorization.
- `src/bindings/sessions/sessions.ts` is generated from the Rust contract,
  includes every public DTO/error, excludes `SessionNotificationContext` and
  `SessionAttentionSnapshot`, and has no handwritten duplicate.
- Focused unit/integration/contract tests, all Rust and frontend regression
  gates, and the Windows Tauri build pass. No automated desktop end-to-end test
  is added.

**Architecture:** `sessions::models` owns the public DTOs and the private
runtime tree/state rules; `sessions::manager` owns the process-local state,
revision and ID counters, mutation/close gates, dependency ports, content
lifecycle, and Rust-only consumer snapshots; `sessions::commands` contains only
exact-window authorization and thin calls into the manager. A short-held Tokio
`RwLock` protects committed state. A short global commit/event mutex preserves
revision publication order after the state lock is released. Potentially slow
project/profile/content work runs outside both locks, while operation markers
force every commit to revalidate the affected identifiers and reject competing
mutations.

The app composition layer supplies adapters over the existing public
`ProjectService` and `CliProfilesService`, a Phase 1 content runtime for
`Empty`/`ToolSelection`, the existing `ProjectRuntimeGuard`, and the existing
`AppRuntime`. A deferred project runtime guard breaks the construction cycle:
Projects receives the guard first, Sessions is then created from the completed
Projects/CLI services, and the guard is bound before setup publishes a usable
application. The same app adapter maps session events to the Tauri event and a
ticketed tray refresh. Session event failure remains best effort; committed
state and owner queries remain the recovery source.

**Tech Stack:** Rust `1.98.0` stable, Cargo `1.98.0`, Rust Edition `2024`,
Tauri `2.11.5`, Tokio `1.53.1` with the already enabled `sync` feature, Serde
`1.0.229` with `derive`, and ts-rs `12.0.1`. All required entries already exist
exact-pinned in `src-tauri/Cargo.toml`; this plan adds no dependency and does
not modify `Cargo.lock`.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 8 (Session, tab, and pane)
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections
  4.1, 5.2-5.4, 6.2, 7.5, 8, 9, 14-16, 18, and 20 Phase 1
- Backend spec: `00-Docs/03-Backend/BE-005-sessions-runtime.md`
- Backend prerequisites and integration contracts:
  `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`,
  `00-Docs/03-Backend/BE-003-projects.md`, and
  `00-Docs/03-Backend/BE-006-cli-profiles.md`
- Future consumer contracts:
  `00-Docs/03-Backend/BE-007-terminal-and-pty.md`,
  `00-Docs/03-Backend/BE-011-notifications.md`, and
  `00-Docs/03-Backend/BE-012-backup-and-reset.md`
- Frontend specifications:
  `00-Docs/02-Frontend/FE-001-application-shell.md` and
  `00-Docs/02-Frontend/FE-005-project-overview.md`
- Frontend catalog entries: `FE-003`, `FE-006`, `FE-007`, `FE-009`, and
  `FE-010` in `00-Docs/02-Frontend/00-Overview.md`
- Wireframes: `00-Docs/01-Wireframe/02-AppShell.html#shell`,
  `00-Docs/01-Wireframe/02-AppShell.html#tray`,
  `00-Docs/01-Wireframe/04-Projects.html#sidebar-sessions`,
  `#new-session`, `#tool-unavailable`, `#panes-1`, `#panes-2`, `#panes-3`,
  `#panes-4`, `#panes-max`, `#pane-picker`, `#dlg-delete-session`, and
  `#dlg-remove-project`
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Plan rules: `PLANS.md`

`FE-003`, `FE-006`, `FE-007`, `FE-009`, and `FE-010` do not yet have
standalone specifications. This is therefore a backend-only Stage 8 plan. It
produces the real contract and binding consumed by later frontend plans and
enables the already specified `FE-005` session query/create boundary, but does
not build the Session or Tab/Pane interface. Stage 8's user-visible completion
and its resize/maximize/reopen desktop smoke checks remain pending until
`FE-006` and `FE-007` are specified, planned, implemented, and verified.

## Scope

**In Scope:**

- Public Sessions DTOs, `SessionsError`, exact serialization/ts-rs metadata,
  opaque runtime identifiers, validation, layout helpers, aggregate status,
  and generated TypeScript output.
- One process-local `SessionManager`, strict revisions, project-group order,
  tab order, active/maximized state, pane/split trees, one closed-tab snapshot,
  close/project/shutdown gates, and deterministic test seams.
- Public owner methods `list_sessions`, `get_session`,
  `attach_runtime_content`, `record_pane_output`, `update_pane_activity`,
  `notification_context`, `attention_sessions`,
  `set_main_window_visible`, `shutdown_impact`,
  `project_removal_impact`, `close_project_sessions`, `shutdown_all`, and
  `resume_after_reset`.
- Consumer-side ports `ProjectSessionAccess`, `CliProfileLookup`, and
  `PaneContentRuntime`, plus the exact structs/enums/future alias documented by
  `BE-005`.
- All 18 Tauri commands in `BE-005`, exact-`main` authorization, command
  registration, managed state, event publication, and binding generation.
- App adapters over public Projects and CLI Profiles methods, replacement of
  `NoProjectRuntimeGuard`, replacement of `EmptyAppRuntime` in normal
  composition, current-window visibility reporting, attention tray refresh,
  Quit summary/cleanup, and the future Reset-ready public manager path.
- Focused tests for invariants, authorization order, races, partial failures,
  lifecycle integration, generated contracts, no persistence, and restart
  emptiness using only test-owned state and fake content resources.

**Out of Scope:**

- Frontend source, IPC wrappers, routing, sidebar/session UI, tool pickers,
  drag/resize presentation, dialogs, or optimistic state; these belong to the
  later `FE-005`, `FE-006`, and `FE-007` implementation work.
- PTY creation, command/shell resolution for launch, secret reads, process
  spawn/input/resize/output streaming, terminal buffers, or four live terminal
  panes; these belong to `BE-007`.
- File handles, watcher/buffer ownership, file reads/writes, or unsaved state
  beyond consuming fake/current `PaneContentRuntime` facts; file owners extend
  the port in their own slices.
- Notifications, operating-system notification policy, notification storage,
  target navigation, or unified-search ranking. This plan only supplies the
  documented Rust-only snapshots and domain event.
- BE-012 commands, backup envelope, coordinator, transaction, or
  `DataRuntimeControl` trait implementation. This plan makes the Sessions
  shutdown/resume owner methods and gate contract ready for that future
  adapter and tests them directly.
- Any SQLite table, migration, backup record, capability permission, UUID
  dependency, cross-process restore, or webview persistence for session state.
- macOS validation during normal development and automated desktop end-to-end
  tests.

## Global Constraints

- React owns presentation and temporary drag/resize state. Rust owns session,
  tab and pane runtime state, OS/resource lifecycle, and business rules.
- Session state is process-local only. Hide, minimize, route changes, and
  project changes do not destroy it; true Quit destroys all of it; startup
  never restores it.
- Runtime IDs are opaque strings with `session-`, `tab-`, `pane-`, or `split-`
  prefixes and a monotonically increasing process-local `u64` counter. No new
  UUID dependency is allowed and no `u64` runtime ID crosses JavaScript.
- Public structs use `camelCase`; data-bearing enums use `kind`; simple enums
  serialize as `camelCase`; revision crosses IPC as a decimal string.
- `src/bindings/` is generated from Rust and is never edited manually.
- All Sessions commands are async, receive `WebviewWindow` and
  `State<'_, SessionManager>`, authorize exact `main` first, and contain no
  business rule.
- Each tab has one to four pane leaves in a full binary tree. Ratios are integer
  basis points in `1000..=9000`; a new split is `5000`; the old pane is first
  and the new pane is second.
- Frontend never sends a filesystem path, command line, environment, process
  handle, terminal buffer, or secret through a Sessions command.
- Do not log session/tab names, file labels, terminal output, command arguments,
  environment data, reopen buffers, or raw dependency errors. Public failures
  contain only stable operations and opaque identifiers.
- Do not hold the Sessions state lock while awaiting a project/profile/content
  port. Content close/reopen/discard operations must be idempotent.
- Creation lock order is `DataMaintenanceGate` -> project/session operation
  gate -> Sessions commit/event mutex -> Sessions state. The state lock is
  released before synchronous event publication, but the commit/event mutex is
  retained so a later revision cannot publish first. Shutdown/impact/reset-ready
  methods do not reacquire the maintenance gate.
- Every function, method, callback, test, and helper receives a short purpose
  comment; complex race and invariant code receives concise reasoning comments.
- Tests use manager-owned memory, explicit fake ports, barriers/channels, and
  temporary app-data directories. They do not mutate process-global
  environment or touch real projects, profiles, credentials, app data, files,
  or processes.
- Development verification runs on Windows. macOS validation is deferred to
  release preparation.

## Assumptions, Risks, and Blockers

**Assumptions:**

- BE-003 and BE-006 are implemented and their current public
  `ProjectService::session_availability`, `ordered_project_ids`, and
  `CliProfilesService::launchability` methods are the only allowed adapters for
  Sessions project/profile lookup.
- `SessionAttentionSnapshot` uses the committed manager revision as the
  attention transition sequence. It is Rust-only and contains the matching
  `SessionSummaryDto`, so the tray never joins summary and sequence from two
  different Sessions snapshots.
- In Stage 8, the production content runtime owns only `Empty` and
  `ToolSelection`; all process/file counts are zero. Fake ports prove the full
  close/activity contract now, while BE-007 and file slices later provide real
  `Terminal` and `File` ownership without changing public DTOs.
- The existing `AppRuntime` `status_label` remains `None` for Stage 8 attention
  entries. The native group heading already supplies `Needs attention`; later
  terminal/notification work may provide a richer label through its own
  documented extension.
- The existing best-effort `sessions://runtime-changed` event is not a source
  of truth. App-triggered tray refresh may run after any committed runtime
  event; the tray's current-model comparison prevents unnecessary native menu
  replacement.
- Production construction reads the configured `main` window's initial native
  visibility and passes it into the manager. Tests pass this value explicitly;
  the manager does not guess that every host starts visible or depend on a
  background task winning a race before the first command.

**Risks:**

- A global state lock plus asynchronous content calls can produce stale commits
  or deadlocks. Tasks 2, 4, and 5 use operation markers, snapshot/revalidation,
  no-await lock discipline, and deterministic parked-port tests.
- Projects needs Sessions for removal while Sessions needs Projects for
  availability and ordering. Task 7 uses a one-time deferred guard bound during
  setup and tests unbound failure plus fully bound startup; neither capability
  imports the other's implementation.
- Close/reopen can partially change real content before a later pane fails.
  Task 4 tests attempt-all cleanup, structure retention, compensating close,
  retryability, and exact error redaction.
- A late project removal or Reset can race a session creation that already
  passed its dependency lookup. Task 5 coordinates both races and proves the
  commit-time project-close check plus shared read/write permit ordering.
- Tauri emit or native tray replacement may fail after a state commit. Tasks 3
  and 7 prove command success/state query recovery and ensure logs contain no
  payload or user text.
- The absent FE-006/FE-007 specifications prevent this backend plan from
  claiming the user-visible Stage 8 slice. The Scope and final Windows notes
  keep those checks explicitly deferred instead of faking UI coverage.

**Blockers:** None.

## Dependency Order

1. Task 1 defines the typed model/error/tree contract used by every later task.
2. Task 2 builds query and structural mutation state on Task 1.
3. Task 3 adds dependency-backed tool/activity/attention behavior to Task 2.
4. Task 4 adds close/reopen lifecycle after layout and content state exist.
5. Task 5 adds project-wide and application-wide coordination over the close
   path from Task 4.
6. Task 6 exposes the completed owner through commands, events, and bindings.
7. Task 7 composes BE-003/006/001 and native visibility/tray integration over
   Tasks 3-6.
8. Task 8 proves the complete public boundary and negative persistence/process
   guarantees after composition exists.

---

### Task 1: Establish the Sessions Types, Errors, and Pure Invariants

**Outcome:** The Sessions module exposes the exact BE-005 DTO/error/port
contract, while pure helpers enforce names, tree identity, pane limits, split
collapse, stable tab moves, active/maximize references, count conversion, and
status precedence without any Tauri state or dependency call.

**Depends On:** None

**Files:**

- Create: `src-tauri/src/sessions/mod.rs`
- Create: `src-tauri/src/sessions/models.rs`
- Create: `src-tauri/src/sessions/error.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/sessions/models.rs` (`#[cfg(test)]`)
- Test: `src-tauri/src/sessions/error.rs` (`#[cfg(test)]`)

**Interfaces:**

- Consumes: existing `serde::{Serialize, Deserialize}`, `ts_rs::TS`, standard
  `Future`/`Pin`, and no capability implementation.
- Produces: all DTOs and `SessionsError` exactly named in `BE-005`;
  `ProjectSessionAvailability`, `LaunchableProfile`, `PaneContentRef`,
  `PaneCloseImpact`, `CloseRetention`, `PaneContentOwner`, `ReopenHandle`,
  `PaneActivitySnapshot`, `ShutdownImpact`, `ProjectSessionsImpact`,
  `SessionNotificationContext`, `SessionAttentionSnapshot`,
  `PaneRuntimeFuture`, `ProjectSessionAccess`, `CliProfileLookup`, and
  `PaneContentRuntime`; crate-private validated names, IDs, layout/state, close
  snapshots, and pure transformation helpers used by `SessionManager`.

- [x] **Step 1: Add focused model and error tests**

  Register `pub mod sessions` and add unit tests for empty/trimmed/control/81-
  scalar names; prefix/counter formatting; all status precedence combinations;
  right/down split orientation; fifth-pane rejection; ratio endpoints and
  out-of-range values; duplicate/missing pane and split IDs; active/maximized
  references; stable tab movement; collapse to the sibling subtree; checked
  `usize`/count conversion; and safe `Display` output for every error variant.
  Serialization tests must assert exact `camelCase`, `kind`, and error `code`
  shapes, including nested `ConfirmationRequired` impact.

- [x] **Step 2: Verify the pure contract tests fail for named missing symbols**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::models::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::error::tests`

  Expected: both intended test modules are discovered and compilation fails on
  named missing validation/layout/status helpers or DTO/error implementations;
  neither command reports a successful zero-test run.

- [x] **Step 3: Implement the minimum typed model and pure operations**

  Add the exact derives and ts-rs export target
  `sessions/sessions.ts`. Keep `SessionNotificationContext` and
  `SessionAttentionSnapshot` free of `Serialize`, `Deserialize`, and `TS`.
  Model the layout as an owned binary tree with unique opaque IDs and pure
  traversal/replacement/collapse helpers. Validate names by Unicode scalar
  count after trim, not bytes or grapheme count. Derive summary status from
  activity and unseen state in the documented priority order.

- [x] **Step 4: Verify the contract and invariants**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::models::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::error::tests`

  Expected: all exact serialization, validation, tree, ordering, count, status,
  and redacted-display cases pass without filesystem, process, profile,
  project, or Tauri runtime access.

### Task 2: Build Runtime Ownership, Queries, and Structural Mutations

**Outcome:** `SessionManager` owns empty process-local state and implements
project-ordered list/get plus session, tab, active selection, move, split,
ratio, and maximize behavior with exact revision/event and no-op semantics.

**Depends On:** Task 1

**Files:**

- Create: `src-tauri/src/sessions/manager.rs`
- Modify: `src-tauri/src/sessions/mod.rs`
- Test: `src-tauri/src/sessions/manager.rs` (`#[cfg(test)]`, exact nested module
  `sessions::manager::tests::structure_tests`)

**Interfaces:**

- Consumes: Task 1 model/error/ports, existing `DataMaintenanceGate`, injected
  project/profile/content ports, a short commit/event mutex, and an injected
  `SessionEventSink` whose publication is synchronous and best effort after
  commit.
- Produces: cloneable `SessionManager`; `SessionManager::new` and a
  test-focused `with_seams`; owner `list_sessions`/`get_session`; create/rename
  session; create/rename/move/activate tab; activate/split/resize/maximize pane;
  monotonic runtime ID and revision allocation; `SessionEventSink` and
  `SESSION_RUNTIME_CHANGED_EVENT`.
- Test seams: deterministic manager instances with fake project ordering and
  availability, fake profile/content ports that record forbidden calls, a
  recording/failing event sink, and a manager-local monotonic allocator. No
  global environment, clock, filesystem, or sleep is used.

- [x] **Step 1: Add focused owner-state and mutation tests**

  Cover empty restart state; prefixed non-reused IDs across all object kinds;
  available/not-found/unavailable/project-lookup creation; `DataReadPermit`
  held through event publication; project order then session creation order;
  unavailable projects remaining readable; orphan project IDs failing closed;
  immutable list/get snapshots; name rules; new-tab defaults; stable/no-op tab
  moves; active tab/pane behavior; exact split direction and `5000` ratio;
  four-pane cap; ratio endpoints; maximize without content changes; and parent-
  child ID validation. Assert one revision/event for each observable commit and
  none for validation errors or no-ops.

- [x] **Step 2: Verify focused manager tests fail on the absent owner**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::structure_tests`

  Expected: Cargo discovers the exact nested module and fails on missing
  `SessionManager` constructors/methods or commit helpers, not on zero matched
  tests.

- [x] **Step 3: Implement short-held state commits and revalidation**

  Accept initial main-window visibility explicitly in the constructor. Store
  session maps, per-project session order, observed/visibility state,
  close/project-close/shutdown markers, counters, and revision under one Tokio
  `RwLock`. Await the read permit and project port before the state lock for
  creation, then recheck shutdown/project-close markers in the same critical
  section as insert. Serialize the short commit and its synchronous event with
  a separate mutex: build the event from valid post-commit state, release the
  state lock, publish while retaining the commit/event mutex, then release it.
  This keeps revision delivery strict without holding the state lock in the
  event adapter. Creation retains its read permit through publication.
  Swallow/log only a stable event category on sink failure and still return the
  committed snapshot.

- [x] **Step 4: Verify structural state behavior**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::structure_tests`

  Expected: every structural case passes; fake project failures map to the
  exact Sessions variants; no-op mutations preserve revision; failed events do
  not roll back valid state; a fresh manager contains no prior sessions.

### Task 3: Add Tool Selection, Activity, Observation, and Consumer Snapshots

**Outcome:** Sessions rechecks CLI profiles without spawning, accepts future
content/activity owner updates, derives unread/aggregate status, and exposes
linearizable notification and attention snapshots for BE-011 and AppRuntime.

**Depends On:** Task 2

**Files:**

- Modify: `src-tauri/src/sessions/manager.rs`
- Modify: `src-tauri/src/sessions/mod.rs`
- Test: `src-tauri/src/sessions/manager.rs` (`#[cfg(test)]`, exact nested module
  `sessions::manager::tests::activity_tests`)

**Interfaces:**

- Consumes: `CliProfileLookup::launchable_profile`, Task 2 state/revision/event
  path, `PaneContentRef`, and `PaneActivitySnapshot`.
- Produces: manager methods for `select_session_tool`, `select_pane_tool`,
  `attach_runtime_content`, `record_pane_output`, `update_pane_activity`,
  `set_observed_session`, `set_main_window_visible`, `notification_context`, and
  `attention_sessions` with the exact BE-005 signatures and error behavior.

- [x] **Step 1: Add deterministic profile/activity/visibility tests**

  Cover profile found/removed/unavailable/lookup-failed races; session-not-empty
  and pane-not-empty revalidation after a parked lookup; no secret/launch call;
  `ToolSelection` titles from the current profile snapshot; valid/invalid
  future `Terminal`/`File` attachment; every aggregate status priority; checked
  process counts; output while observed+visible versus hidden/other route;
  route changes that clear unread only when visible; no output-chunk event after
  unread is already true; and activity events only when summary changes.

  For attention ordering, assert entry into `NeedsAttention` stores that commit
  revision, updates while still attention keep the sequence, leaving removes
  it, re-entry gets a larger sequence, and `attention_sessions` returns summary
  plus sequence from one read snapshot. Cover notification context for every
  route/visibility combination, missing-after-delete, and a barrier-controlled
  read-versus-delete race.

- [x] **Step 2: Verify activity tests fail on missing owner methods**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::activity_tests`

  Expected: the exact module is discovered and fails on named missing tool,
  activity, visibility, attention, or notification methods; it cannot pass by
  selecting zero tests.

- [x] **Step 3: Implement dependency-backed commits and snapshot rules**

  Snapshot target identity, release the lock, await the profile port, reacquire
  the lock, and revalidate session/tab/pane emptiness and operation markers
  before committing. Keep external content attachment Rust-only. Compute old
  and new summaries around activity/output changes, allocate one revision only
  for an observable summary transition, and set/clear attention sequence from
  that committed revision. Clone notification and attention results entirely
  under one read lock; neither query awaits a dependency, changes revision, or
  emits an event.

- [x] **Step 4: Verify activity and consumer contracts**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::activity_tests`

  Expected: all lookup races, status priorities, visibility matrices, event
  edges, transition sequences, and linearization assertions pass; selecting a
  tool records only `ToolSelection` and no fake process/secret path is entered.

### Task 4: Implement Live Close Impact, Destructive Close, and Reopen

**Outcome:** Session/tab/pane close is confirmation-safe and retryable, and one
last-closed tab can be restored at its clamped position without restarting
content or corrupting the pane tree.

**Depends On:** Task 3

**Files:**

- Modify: `src-tauri/src/sessions/manager.rs`
- Modify: `src-tauri/src/sessions/models.rs`
- Test: `src-tauri/src/sessions/manager.rs` (`#[cfg(test)]`, exact nested module
  `sessions::manager::tests::close_tests`)

**Interfaces:**

- Consumes: `PaneContentRuntime::{close_impact, close, reopen, discard}`,
  `CloseRetention::{Discard, ReopenLastTab}`, close targets, Task 1 tree
  collapse helpers, and Task 2 operation markers/event commits.
- Produces: `SessionManager::get_close_impact`,
  `SessionManager::close_runtime_target`, and
  `SessionManager::reopen_last_closed_tab`; private retained-tab snapshots with
  original index/layout/active/maximized state and per-pane reopen handles.

- [x] **Step 1: Add a scripted content-lifecycle matrix**

  Test read-only impact aggregation and stable labels; checked count overflow;
  unconditional session confirmation; conditional tab/pane confirmation; a
  blocker appearing between preview and commit; exact retention mode by target;
  attempt-all close after one pane fails; structure retained after failure;
  retry idempotency; competing mutation/close/reopen receiving
  `CloseInProgress`; and no Sessions lock held while a fake port is parked.

  Cover multi-pane collapse, nearest active pane in the sibling subtree,
  maximize clearing, one-pane close becoming `Empty`, active-tab right/left
  fallback, last-tab behavior, old retained snapshot discard before replacement,
  eviction failure, original-index clamp, successful reopen, no process restart,
  partial reopen compensation, retryable snapshot, and snapshot destruction on
  session delete. Coordinate races with channels/barriers rather than sleeps.

- [x] **Step 2: Verify close tests fail on missing lifecycle behavior**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::close_tests`

  Expected: Cargo discovers the close module and fails on the missing impact,
  close, reopen, or retained-snapshot behavior with the scripted port recording
  the named unmet operation; it does not report zero matching tests.

- [x] **Step 3: Implement snapshot/mark/await/revalidate/commit close flow**

  Validate the exact parent-child target, mark its session closing, snapshot
  current content, release the lock, recalculate impact, enforce confirmation,
  then attempt every required content operation. Commit one structural revision
  only after all required close calls succeed. On failure, retain the target,
  clear the operation marker, keep successful external close facts real, and
  return one sanitized `ContentLifecycleFailed`. For tab close, discard the old
  retained snapshot before publishing the new slot. For reopen, reserve the
  slot, restore all handles outside the lock, compensate restored content if a
  later handle fails, and consume/discard retained handles only after the whole
  tab commits.

- [x] **Step 4: Verify close/reopen invariants and retries**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::close_tests`

  Expected: the full impact/confirmation/tree/selection/retention/failure/race
  matrix passes; every fake content call uses the documented retention; no
  structure disappears on partial failure; retry and discard are idempotent.

### Task 5: Add Project Cleanup, Quit, and Reset-Ready Coordination

**Outcome:** Sessions supplies scoped removal impact/cleanup and gate-free
application shutdown/resume behavior that closes all content safely and cannot
race a newly committed session.

**Depends On:** Task 4

**Files:**

- Modify: `src-tauri/src/sessions/manager.rs`
- Modify: `src-tauri/src/sessions/mod.rs`
- Modify: `src-tauri/tests/data_management_contract.rs`
- Test: `src-tauri/src/sessions/manager.rs` (`#[cfg(test)]`, exact nested module
  `sessions::manager::tests::shutdown_tests`)
- Test: `src-tauri/tests/data_management_contract.rs`

**Interfaces:**

- Consumes: Task 4 confirmed session-close path, shared
  `DataMaintenanceGate`, project-scoped close markers, and current
  `PaneContentRuntime` facts.
- Produces: `shutdown_impact`, `project_removal_impact`,
  `close_project_sessions`, `shutdown_all`, and `resume_after_reset`; focused
  test `sessions_create_and_reset_share_maintenance_gate` in the existing data
  management integration target.

- [x] **Step 1: Add focused shutdown/removal/gate tests**

  Cover exact project/session/process/unsaved counts; project with no session;
  no cross-project close; per-project close serialization; guard-before-
  snapshot; a create that passed availability but loses at commit; attempt-all
  project cleanup; one `Deleted` event per successful session; partial failure
  retained for retry; and idempotent repeated cleanup.

  Cover shutdown marker set before content awaits; all content and retained
  handles attempted; all mutations rejected with `RuntimeShuttingDown`;
  state/observed route cleared only on complete success; failure leaves
  retryable state; successful true-Quit never resumes. In
  `data_management_contract`, hold a write permit and prove a create is parked,
  call gate-free impact/shutdown without deadlock, then call
  `resume_after_reset(true)` and prove admission reopens with no restored
  session. Repeat aborted resume after injected shutdown failure.

- [x] **Step 2: Verify focused tests fail on missing coordination**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::shutdown_tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test data_management_contract sessions_create_and_reset_share_maintenance_gate`

  Expected: both targets discover their named tests and fail on missing
  project/shutdown/resume methods or because create is not yet ordered by the
  shared write permit; neither passes with zero tests.

- [x] **Step 3: Implement scoped guards and gate-free shutdown**

  Place a project-close marker under the state lock before taking the ordered
  session-ID snapshot and keep it until the operation finishes. Reuse confirmed
  close-session behavior for each ID, skip concurrently absent IDs, try the
  entire original snapshot, and return the first sanitized error after all
  attempts. For shutdown, set the global marker first, snapshot resources,
  release the lock for all close/discard calls, and clear state only when none
  remain live. Keep impact/shutdown/resume free of maintenance-gate acquisition;
  resume changes only admission flags and never recreates state.

- [x] **Step 4: Verify coordination and deadlock prevention**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::shutdown_tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test data_management_contract sessions_create_and_reset_share_maintenance_gate`

  Expected: all scoped cleanup, partial retry, event, create-close race,
  shutdown failure/success, write-permit exclusion, gate-free cleanup, and
  no-restore assertions pass deterministically.

### Task 6: Expose Authorized Commands, Events, and Generated Bindings

**Outcome:** All BE-005 commands route through one exact-`main` authorization
boundary, public events retain committed revision order, and the generated
TypeScript file exactly matches the Rust contract.

**Depends On:** Tasks 3-5

**Files:**

- Create: `src-tauri/src/sessions/commands.rs`
- Modify: `src-tauri/src/sessions/mod.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Modify: `src-tauri/tests/export_bindings.rs`
- Create/generated by test: `src/bindings/sessions/sessions.ts`
- Test: `src-tauri/src/sessions/commands.rs` (`#[cfg(test)]`)
- Test: `src-tauri/tests/export_bindings.rs`

**Interfaces:**

- Consumes: all Task 2-5 manager methods and exact command signatures from
  `BE-005`.
- Produces: `list_sessions`, `get_session`, `create_session`,
  `rename_session`, `create_tab`, `rename_tab`, `move_tab`, `set_active_tab`,
  `set_active_pane`, `split_pane`, `set_split_ratio`, `set_maximized_pane`,
  `select_session_tool`, `select_pane_tool`, `get_close_impact`,
  `close_runtime_target`, `reopen_last_closed_tab`, and
  `set_observed_session`; invoke-handler routes; generated Sessions binding.

- [x] **Step 1: Add authorization-order, route, and binding tests**

  Add command unit tests proving `main` reaches the manager while `quick-note`,
  empty, and arbitrary labels return `UnauthorizedWindow` before malformed
  IDs/names, project/profile/content ports, event sink, or state probes. Extend
  the binding generator in stable dependency order and assert exact output,
  nested unions, all error payloads, and absence of both Rust-only snapshot
  names. Add compile-time route references for every command while preserving
  all existing lifecycle, Projects, Settings, and CLI Profile commands.

- [x] **Step 2: Verify command and binding tests fail for absent exposure**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::commands::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings sessions_binding_matches_rust_contract`

  Expected: the command target fails on named missing command symbols or the
  authorization-first path. The contract target is discovered and regenerates
  or fails because `src/bindings/sessions/sessions.ts` is absent/stale; it does
  not silently pass with zero tests.

- [x] **Step 3: Implement thin commands and one generated output**

  Clone the manager handle from `State`, convert owned strings to borrowed
  inputs, and await owner methods only after exact-label authorization. Add all
  routes to the single application invoke handler. Extend the existing ts-rs
  test generator; do not hand-edit generated output. Do not add a Tauri
  permission because custom commands are constrained by registration and
  in-command authorization.

- [x] **Step 4: Generate once, then verify clean output**

  Run twice:

  `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings sessions_binding_matches_rust_contract`

  Expected: the first run creates/updates the generated Sessions file and
  intentionally reports regeneration; the second passes without rewriting it.
  Then run:

  `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::commands::tests`

  Expected: all commands accept only exact `main`; rejected callers cause zero
  manager/dependency side effects; every route compiles.

### Task 7: Compose Projects, CLI Profiles, Lifecycle, Visibility, and Tray

**Outcome:** Normal and mock Tauri builders manage one fully bound
`SessionManager`; project removal and app Quit use it; window visibility drives
unread policy; attention transitions refresh the existing tray model; and all
startup failure paths publish no half-bound runtime.

**Depends On:** Task 6

**Files:**

- Create: `src-tauri/src/app/data_runtime.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Modify: `src-tauri/src/app/lifecycle.rs`
- Modify: `src-tauri/src/app/tray.rs`
- Modify: `src-tauri/tests/app_builder.rs`
- Modify: `src-tauri/tests/app_lifecycle.rs`
- Test: `src-tauri/src/app/data_runtime.rs` (`#[cfg(test)]`)
- Test: `src-tauri/tests/app_builder.rs`
- Test: `src-tauri/tests/app_lifecycle.rs`

**Interfaces:**

- Consumes: public `ProjectService::{session_availability,
  ordered_project_ids, list_projects}`, `CliProfilesService::launchability`,
  `ProjectRuntimeGuard`, `AppRuntime`, `SessionManager` owner methods,
  `refresh_attention_menu`, Tauri emitter/window hooks, and one shared
  `DataMaintenanceGate`.
- Produces: app-owned `ProjectSessionAccess` and `CliProfileLookup` adapters;
  a one-time deferred `ProjectRuntimeGuard`; Phase 1 `PaneContentRuntime` for
  `ToolSelection` retention; a Sessions event sink that emits
  `sessions://runtime-changed` and schedules tray refresh; an `AppRuntime`
  adapter for Quit/attention; visibility notifications after successful main
  hide/show; and fully bound managed composition.
- Test seams: one-time adapter cells with explicit unbound errors, fake
  Projects/CLI services already supported by builder helpers, fake event and
  content ports, and lifecycle runtime override retained for existing focused
  tests.

- [x] **Step 1: Add adapter, startup, lifecycle, and tray regression tests**

  Test Projects not-found/unavailable/internal mapping; CLI profile not-found,
  unavailable, and internal mapping; stage-8 content close/reopen/discard; the
  deferred project guard failing closed before bind, binding exactly once, and
  mapping removal impact/cleanup after bind. Test AppRuntime Quit counts,
  shutdown delegation, attention snapshot plus project-name join, missing
  project failure, sequence preservation, and no direct Sessions lock/map use.

  Extend app-builder tests to assert one shared gate, one manager, every old/new
  command route, non-placeholder runtime and project guard, binding before
  setup completion, and no managed partial state after startup failure. Extend
  lifecycle tests so custom/native close sets visibility false only after hide
  success, tray open/session navigation/single-instance activation sets it true
  only after successful show, hidden output becomes unseen, and true Quit
  awaits Sessions cleanup before exit. Prove an event emit failure does not
  prevent the tray refresh task or committed query recovery.

- [x] **Step 2: Verify composition tests fail on placeholder adapters**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib app::data_runtime::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder sessions_composition_binds_runtime_and_routes_commands`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_lifecycle sessions_visibility_attention_and_quit_are_composed`

  Expected: all exact targets are discovered and fail because
  `NoProjectRuntimeGuard`/`EmptyAppRuntime` are still active, Sessions state and
  routes are absent, or hide/show does not update visibility. None passes with
  zero selected tests.

- [x] **Step 3: Implement adapter mapping and cycle-safe setup**

  Create the shared gate first; construct Projects with a deferred runtime
  guard; construct Settings and CLI Profiles with the same gate; construct
  Sessions from public Projects/CLI adapters, Phase 1 content runtime, app
  event sink, and the synchronously queried initial visibility of the exact
  `main` window; bind the deferred guard exactly once; then manage state and
  create `AppLifecycleState` with either the explicit lifecycle-test override
  or the real Sessions adapter. Fail setup before publication if the main
  window visibility cannot be read or any required bind fails. Do not expose
  adapter types through IPC or move capability business rules into `app`.

  Map project/profile source errors only to the stable BE-005 categories. Build
  Quit summary from Sessions impact plus public project count; build attention
  entries from the one-lock `SessionAttentionSnapshot` and public project
  snapshots. Keep Stage 8 `status_label = None`. Always schedule ticketed tray
  refresh after a committed Sessions event while native replacement remains
  conditional on model inequality.

- [x] **Step 4: Wire visibility at every existing native path**

  After successful `hide_main_window` and native close-to-tray, asynchronously
  call `set_main_window_visible(false)`. After successful tray open, tray
  session navigation, and single-instance bring-to-front, asynchronously call
  `set_main_window_visible(true)`. Do not mark visible on a failed window
  operation and do not treat minimize/maximize as session destruction. Preserve
  the existing lifecycle lock rule: no lock is held across Sessions awaits.

- [x] **Step 5: Verify complete composition and lifecycle behavior**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib app::data_runtime::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_lifecycle`

  Expected: adapters map exact categories, the construction cycle is bound
  before use, one manager/gate/runtime is managed, all legacy routes remain,
  hide/show visibility controls unread behavior, attention ordering reaches the
  tray, and Quit cleanup completes before the tested exit signal.

### Task 8: Prove the Full Public Runtime Contract and Negative Boundaries

**Outcome:** A dedicated integration target demonstrates all Sessions commands,
events, Rust-only consumer methods, error shapes, restart behavior, and
forbidden persistence/process paths through public boundaries.

**Depends On:** Task 7

**Files:**

- Create: `src-tauri/tests/sessions_runtime.rs`
- Modify: `src-tauri/tests/export_bindings.rs`
- Verify unchanged: `src-tauri/Cargo.toml`
- Verify unchanged: `src-tauri/Cargo.lock`
- Verify unchanged: `src-tauri/migrations/`
- Verify unchanged: `src-tauri/capabilities/main.json`
- Test: `src-tauri/tests/sessions_runtime.rs`
- Test: `src-tauri/tests/export_bindings.rs`

**Interfaces:**

- Consumes: all public commands, generated Sessions contract, public
  `SessionManager` consumer methods, app adapters, and isolated fake
  project/profile/content/event resources.
- Produces: integration target `sessions_runtime`; test-only harnesses with
  deterministic IDs/revisions, dependency call counters, parked futures,
  scripted content handles, event capture, and fresh-manager restart. No real
  project directory, CLI command, credential, PTY, file buffer, database row,
  or process is used.

- [x] **Step 1: Add the public command success/error matrix**

  Invoke all 18 documented command functions from exact `main`, covering
  create/list/get/rename, tab creation/reorder/active state, pane split/ratio/
  maximize, tool selection, impact/confirmation/close/reopen, observation,
  event payload/order, and query resync after an injected event failure. Assert
  every typed error variant and serialized payload used by these flows.

  Invoke every command from `quick-note`, empty, and arbitrary labels with
  otherwise valid and invalid inputs; assert `UnauthorizedWindow` wins before
  all project/profile/content/event/state counters. Compare command list/get
  results with direct owner snapshots. Exercise direct attention/notification
  queries without IPC authorization and prove both Rust-only types are absent
  from generated output.

- [x] **Step 2: Add lifecycle, race, restart, and no-persistence cases**

  Cover project removal impact/cleanup and create-close race; shutdown impact,
  partial failure/retry, reset resume, and true-Quit clearing; one retained tab
  and discard on delete/Quit; event revision gaps; and a brand-new manager using
  the same fake dependencies returning empty state. Snapshot the isolated
  SQLite database before/after the full runtime matrix and assert no session
  table/row or backup representation appears. Record that no fake process,
  secret-resolution, filesystem, or blocking worker path was called.

- [x] **Step 3: Run the dedicated integration target**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test sessions_runtime`

  Expected: the named target is discovered and all command, authorization,
  adapter, event, race, retry, restart, redaction, and no-persistence assertions
  pass from test-owned memory only.

- [x] **Step 4: Recheck generated and forbidden boundaries**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings sessions_binding_matches_rust_contract`
  - `rg -n "^(export )?(type|interface) (SessionSummaryDto|SessionDetailDto|TabDto|PaneLayoutNodeDto|PaneDto|PaneContentDto|SessionStatusDto|SplitAxisDto|SplitDirectionDto|CloseTargetDto|CloseImpactDto|CloseResultDto|SessionRuntimeEventDto|SessionChangeKindDto|SessionsError|SessionNotificationContext|SessionAttentionSnapshot)" src --glob '!src/bindings/**'`
  - `rg -n "std::process|Command::new|portable_pty|CreatePseudoConsole|ConPTY" src-tauri/src/sessions`
  - `git diff --exit-code -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/migrations src-tauri/capabilities/main.json`

  Expected: the binding is current; no handwritten frontend Sessions contract
  exists; Sessions production code contains no process/PTY creation path; and
  this slice changes no manifest, lockfile, migration, or webview capability.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Pure Sessions contract | Run separately: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::models::tests`; `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::error::tests` | Exact DTO/error shapes, names, trees, ratios, ordering, counts, and status rules pass |
| Manager structure/activity/close/shutdown | Run separately: `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::structure_tests`; `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::activity_tests`; `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::close_tests`; `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::manager::tests::shutdown_tests` | Every exact test module is discovered; mutation, lookup, activity, attention, close/reopen, project cleanup, and shutdown races pass |
| Command authorization | `cargo test --manifest-path src-tauri/Cargo.toml --lib sessions::commands::tests` | All 18 commands authorize exact `main` first and rejected callers perform no protected work |
| Sessions public integration | `cargo test --manifest-path src-tauri/Cargo.toml --test sessions_runtime` | Full public command/event/Rust-consumer/error/restart/no-persistence matrix passes |
| Data maintenance contract | `cargo test --manifest-path src-tauri/Cargo.toml --test data_management_contract sessions_create_and_reset_share_maintenance_gate` | Write permit blocks create; impact/shutdown/resume remain gate-free and restore no session |
| App adapters | `cargo test --manifest-path src-tauri/Cargo.toml --lib app::data_runtime::tests` | Projects/CLI/content/runtime adapters and deferred binding pass with sanitized mappings |
| Composition integration | `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder` | One shared gate/manager and real runtime/guard are managed; every old/new route builds; startup failure publishes no half-bound state |
| Lifecycle/tray integration | `cargo test --manifest-path src-tauri/Cargo.toml --test app_lifecycle` | Hide/show visibility, attention ordering/refresh, Quit counts, and awaited cleanup preserve existing lifecycle behavior |
| Generated contract | `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings` | All existing bindings and `sessions/sessions.ts` are current on the first verification run |
| Frontend format | `pnpm format:check` | No formatting differences, including generated TypeScript |
| Frontend lint | `pnpm lint` | Pass with no lint errors |
| Frontend type check | `pnpm typecheck` | Existing frontend compiles against the additional unused generated binding |
| Frontend regression tests | `pnpm test` | All existing unit/component tests pass; no desktop end-to-end test is added |
| Frontend production build | `pnpm build` | Existing SPA bundle succeeds with the new generated contract |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No Rust formatting difference |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Every target/feature passes with warnings denied |
| Complete Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | All unit, integration, composition, lifecycle, storage, Projects, CLI Profiles, Settings, binding, and Sessions tests pass |
| Windows desktop integration | `pnpm tauri build` | Windows build succeeds with managed Sessions state, all commands/events, adapters, and generated binding |
| No dependency/schema/capability change | `git diff --exit-code -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/migrations src-tauri/capabilities/main.json` | Sessions adds no dependency, persistence schema, or webview permission |
| No production process launch | `rg -n "std::process|Command::new|portable_pty|CreatePseudoConsole|ConPTY" src-tauri/src/sessions` | No match exists in Sessions production code; any test/comment match is reviewed and cannot execute a process |
| No handwritten contract | `rg -n "^(export )?(type|interface) (SessionSummaryDto|SessionDetailDto|TabDto|PaneLayoutNodeDto|PaneDto|PaneContentDto|SessionStatusDto|SplitAxisDto|SplitDirectionDto|CloseTargetDto|CloseImpactDto|CloseResultDto|SessionRuntimeEventDto|SessionChangeKindDto|SessionsError|SessionNotificationContext|SessionAttentionSnapshot)" src --glob '!src/bindings/**'` | No duplicate handwritten frontend DTO/error or leaked Rust-only snapshot is found |

### Targeted Windows Verification Notes

After `pnpm tauri build`, launch the built application once with a disposable
Windows app-data directory. Confirm normal startup, existing Projects and
Settings pages, custom and native Close hiding to tray, tray Open restoring the
same process, and Quit closing it cleanly. Use integration-test fixtures—not
real CLI tools or user projects—to prove session counts and cleanup in this
backend-only slice.

Do not claim the wireframed Session page, split gutter, pane maximize, tool
picker, close dialog, or reopen interaction from this smoke check: FE-006 and
FE-007 do not exist yet. Their later plans must perform the targeted desktop
smoke checks for resize commit, maximize/restore, close confirmation, and
reopen against these real commands. No automated desktop end-to-end test is
added here.

## Plan Review Gate

- [x] No dependency is added; exact existing Serde, ts-rs, Tokio, Tauri, Rust,
  and Cargo versions are recorded, and the manifest/lockfile are verified
  unchanged.
- [x] Every named unit/integration test target is selected by a focused or
  final command. Every red step adds a discoverable target/module/test first
  and fails on a named missing symbol, route, method, or behavior rather than
  passing with zero tests.
- [x] Project/profile/content/event/visibility failure cases have explicit fake
  injection and observable error/call-count results. Races use barriers or
  channels, never sleeps.
- [x] All state, app data, SQLite snapshots, project/profile facts, content
  handles, and event records are test-owned. No test reads credentials, process
  environment, real projects, terminal processes, or user app data.
- [x] The project-construction cycle, create-versus-remove/reset races,
  close/reopen partial failures, event delivery failure, and shutdown failure
  each have an explicit mechanism and retry/observable-state assertion.
- [x] Negative requirements have concrete checks: no manifest/lock/migration/
  capability diff, no production process API in Sessions, fresh-manager empty
  restart, database before/after comparison, and no handwritten DTO.
- [x] Rust final commands include `--all-targets --all-features`; Clippy denies
  warnings; frontend regressions and production build run because the generated
  binding changes; Windows Tauri build is mandatory.
- [x] `SessionNotificationContext` and `SessionAttentionSnapshot` remain
  Rust-only; the tray obtains reliable transition order from the owner query,
  not event reconstruction or private map access.
- [x] No Git commit step, frontend implementation, PTY/process launch, file
  owner, notification storage, BE-012 coordinator, macOS validation, or
  automated desktop end-to-end test is included.

## Deviations and Decisions

- The BE-005 detailed design was clarified before this plan: the new Rust-only
  `SessionAttentionSnapshot` and `SessionManager::attention_sessions` query
  provide a summary plus the revision of the latest transition into
  `NeedsAttention`. This resolves the prior mismatch with BE-001 tray ordering
  without exposing internal ordering fields to TypeScript or relying on a
  best-effort event history.
- `src-tauri/src/app/data_runtime.rs` contains the Stage 8 app/runtime adapters,
  but this plan does not invent or implement BE-012's absent
  `DataRuntimeControl` trait. The public manager impact/shutdown/resume methods
  and the maintenance-gate contract are implemented and tested now; BE-012
  later wires its own coordinator trait to them.

Appended during implementation:

- Mock Tauri setup supplies `main_window_visible = true` explicitly because its
  setup hook does not expose a configured native `main` window. Production
  composition still reads the real window visibility synchronously and fails
  setup if that snapshot is unavailable.
- The Stage 8 `PhaseOnePaneContentRuntime` owns only `ToolSelection` retention.
  `Terminal` and `File` values fail closed until their future capability owners
  replace the adapter; Sessions does not pretend to own a process or file.
- Retained-tab replacement closes the new target successfully before evicting
  the previous reopen handle. This keeps the previous snapshot usable when the
  replacement close fails, while still discarding it before the new snapshot
  becomes current.
- Focused manager module names remain independently selectable, while the
  cross-cutting structure, activity, close/retry, project cleanup, shutdown,
  event-failure, restart, and persistence assertions are consolidated in
  `src-tauri/tests/sessions_runtime.rs` to exercise the public owner boundary.
- The repository's default debug executable was locked by an already running
  process during verification. Rust and Tauri commands therefore used the
  isolated target directory
  `C:\Users\nhannt\AppData\Local\Temp\xwork-sessions-target`; no existing
  process was terminated.
- The frontend Session/Tab/Pane screens do not exist yet, so the targeted
  interactive Windows smoke checklist remains deferred to FE-006/FE-007. The
  Windows release build itself completed successfully.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

BE-005 is implemented as a process-local Rust runtime. `SessionManager` now
owns project-ordered sessions, tabs, binary pane layouts, activity/unread and
attention state, close/reopen snapshots, project cleanup, Quit cleanup, Reset
resume, monotonic opaque IDs, and ordered revision events. All 18 exact-`main`
Tauri commands are registered, and Projects, CLI Profiles, lifecycle,
visibility, and the native tray use narrow owner adapters instead of private
state.

The generated frontend contract is
`src/bindings/sessions/sessions.ts`. It contains every public DTO and
`SessionsError` with exact camel-case fields while keeping
`SessionNotificationContext` and `SessionAttentionSnapshot` Rust-only. No
dependency, lockfile, migration, capability permission, persistence path, or
process-launch path was added.

Automated verification completed on Windows:

- The complete Rust suite passed 340 tests across all targets and features.
- The dedicated Sessions integration target passed 6 broad public-owner tests,
  including structure limits, no-op revisions, visibility, attention,
  confirmation, partial close failure, retained-tab replacement, project and
  shutdown retry, event-delivery failure, restart emptiness, and SQLite
  non-persistence.
- Rustfmt and Clippy with warnings denied passed; generated bindings were
  regenerated once and then passed the clean contract check.
- Frontend format, lint, TypeScript checks, and the production build passed.
  The isolated rerun of the frontend suite passed all 47 files and 1,121 tests.
- `pnpm tauri build` completed and produced
  `C:\Users\nhannt\AppData\Local\Temp\xwork-sessions-target\release\xwork.exe`.
- Source and diff checks found no handwritten duplicate contract, production
  process API, dependency, schema, or capability change.

The remaining limitation is presentation only: FE-006 and FE-007 have not been
implemented, so this work does not claim the wireframed Session page, pane
gutter/maximize controls, tool picker, close dialog, or reopen interaction.
Their later implementation must complete the targeted interactive Windows
smoke checks against these commands.
