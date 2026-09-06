# FE-015 Settings Data — Stage 13 Implementation Plan

**Status:** Code and automated verification complete; ready for parent-managed `Implement FE015`. No commit created. Native smoke and metrics remain pending.

**Goal:** Integrate the Phase 1 Settings Data page with the nine implemented BE-012 commands, explicit import/reset confirmation, and consistent shell/owner state after committed or uncertain operations.

**Completion Criteria:**

- `/settings/data` implements export, import preview/reconfirmation, location/copy/open and typed RESET confirmation using real production IPC.
- Import refreshes configuration and metadata without stopping terminals; confirmed reset clears stale projections/renderers and routes to the existing Home/Welcome, without restarting XWork.
- Old responses, pending settings writes, navigation and focus cannot overwrite a newer data generation. Event loss, reversed event/result order and post-commit refresh failure have observable, tested behavior.
- All automated gates below pass on Windows. Native smoke and metrics are separately evidenced or explicitly pending; automated success alone does not complete all stage 13 validation.

**Architecture:** Settings owns transient operation state and UI. A persistent app composition host under the router and KeyboardShortcutsProvider connects its public callbacks to public owner refresh/barrier APIs; a child bridge subscribes to the existing aggregate event. Rust exclusively owns file pickers, paths, credentials, process shutdown, merge rules and transactions. No new backend commands or feature-to-feature implementation imports are needed.

**Tech Stack:** Existing React/TypeScript, Zustand, React Router memory routing, copied Radix/shadcn components, Tauri invoke/events, Vitest/RTL and Rust integration contracts. Use installed exact-pinned manifests unchanged; no dependency addition or version selection is part of this plan.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`; template `00-Docs/99-Template/04-Plan.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 13, with stage 14/18–21 explicitly deferred.
- Structure/technology: `00-Docs/00-Overview/02-ProjectStructure.md`, `00-Docs/00-Overview/01-TechStack.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §17.6, §18 and lifecycle §5/§8.
- Primary contract: `00-Docs/02-Frontend/FE-015-settings-data.md`, including planning clarifications.
- Extensions: `00-Docs/02-Frontend/FE-001-application-shell.md`, `00-Docs/02-Frontend/FE-009-command-palette.md`, `00-Docs/02-Frontend/FE-011-settings-frame-general-and-about.md`.
- Backend: `00-Docs/03-Backend/BE-012-backup-and-reset.md`; generated `src/bindings/data-management.ts`; command/service `src-tauri/src/settings/data.rs`, platform adapter `src-tauri/src/platform/data.rs`, app adapters `src-tauri/src/app/data_runtime.rs`, `src-tauri/src/app/data_participants.rs`.
- Wireframe: `00-Docs/01-Wireframe/02-AppShell.html#settings-data`, including its reset overlay. FE overview: `00-Docs/02-Frontend/00-Overview.md`.
- Existing source seams: Settings/CLI/Shortcuts stores, Projects/Sessions stores, TerminalRegistry, SearchEntry, NotificationEntry, useLifecycleEvents, quit-store, app-shell/router; `package.json` and `vite.config.ts` establish verification commands and jsdom discovery.

## Scope

**In Scope:**

- Phase 1 UI, nine wrappers, typed event listener, timestamp normalization and safe error copy.
- Persistent operation coordinator, prepare/apply/cancel lifecycle, uncertain results, listener fallback and explicit user reconfirmation.
- Public owner write barriers and generation-aware refresh, runtime renderer cleanup, shell routing/sidebars/theme/shortcuts, notification lifetime and stale search/tray navigation guards.
- Focus, IME, keyboard accessibility, loading/empty/error states, component and IPC tests using isolated mocks.
- The existing uncommitted FE-015 and FE-001/009/011 documentation belongs to the eventual parent-managed `Implement FE015` changeset; retain it without staging or committing during this assignment.

**Out of Scope:**

- Executing this plan before parent dispatch; subagents, independent review and Git commit commands in this PLAN ONLY task.
- Backend source, commands/events/DTO changes, manually edited bindings, migrations, ACLs, packages, lockfiles or global CSS.
- Notes, Calendar, reminders, file editor, stage 14 Home, additional Palette actions, scheduled/cloud/encrypted backups or arbitrary-path APIs.
- Desktop automated E2E, real profile/credential/project access, macOS validation and edits to historical plans.

## Global Constraints

The following requirements are copied from the applicable project rules:

- "Use UTF-8 for Markdown files."
- "Write code, identifiers, and code comments in English."
- "The initial UI language is English."
- "Every function, method, callback, test, and helper must have a short comment describing its purpose."
- "Creating a plan does not authorize implementation."
- "React owns presentation and temporary UI state."
- "Rust owns OS access, persistence, terminal processes, and business rules."
- "Generated bindings under `src/bindings/` are not edited manually."
- "Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state."

Use Windows only. Before any Cargo or Tauri gate in the same PowerShell session set `$env:CARGO_BUILD_JOBS = '1'`. Every full Rust test run uses `--all-targets --all-features -- --test-threads=1`. Do not use the weaker `pnpm test:rust` script as a replacement. Avoid running builds concurrently. Preserve existing style and touch only the specification inventory.

## Assumptions, Risks, and Blockers

**Assumptions:**

- Baseline HEAD is `452017f` (`Implement BE012`). Recheck status at dispatch; preserve the four uncommitted FE design documents and this plan. BE-012 automated evidence is prior evidence, not a result of this planning task.
- Specifications have `Câu hỏi mở: Không có`. User explicitly delegates new decisions; material implementation clarifications must be recorded in the active FE specification, without asking unavailable users or editing historical plans.
- No new dependency is needed. Manifest versions and available UI primitives have been inspected; do not install another dialog/date/state package.

**Risks:**

- Aggregate event has only kind, no revision/operation ID, and is best effort. Task 2/5 uses lifetime-local coalescing and idempotent reconciliation, never permanent kind/time dedupe.
- Serde i64 timestamps may arrive as JS numbers while ts-rs declares bigint. Task 1 normalizes only valid safe numbers/bigints, including error previews.
- Existing Settings reset helpers are test-only and discard retain/bootstrap; ordinary refresh methods do not all return failure-aware promises. Task 3 adds narrowly scoped production APIs.
- Retiring a response does not cancel an already-sent mutation. Task 3 installs barriers before confirm, discards unsent patches and awaits real in-flight promises; backend gate remains authoritative.
- Sidebar width/collapse currently live separately from settings. Task 5 applies the refreshed sidebar snapshot, without a general persistence refactor.
- Reset errors can follow partial runtime shutdown, and a successful commit can precede a lost response. Task 5 reconciles real owners without optimistic rollback or mutation retry.
- Prior BE-011 timing and terminal-suite contention were observed. Retain failures and rerun only the affected explicit target to diagnose, then run the sequential full gate. Do not mask or rewrite first failures.

**Blockers:** None for implementation dispatch. Native smoke and `<500 ms` measurement require an already verified disposable Windows environment and measurement tooling; unavailable prerequisites remain pending and prevent claiming full native completion, not writing frontend code.

## Dependency Order

1. IPC/error contracts → testable coordinator.
2. Coordinator public lifetime → route/dialog and app consumers.
3. Owner barriers/refresh APIs → safe confirmation and reconciliation.
4. Route/dialog → visible Data flows.
5. Persistent app bridge → event/result, route, owner and Quit integration.
6. Search/Notifications/tray guards → stale target/focus safety.
7. Automated gates and separately tracked native checks → parent handoff.

All paths below are established by the FE-015 inventory. New test targets must be discoverable and compile: introduce the smallest typed export shells together with tests before recording a red assertion. Missing-module/type errors and zero matching tests are not accepted as evidence of missing behavior. A red shell must return a deterministic neutral value that lets the named behavioral assertion fail; remove it as soon as implementation follows.

---

### Task 1: Bind the existing nine commands and safe errors

**Outcome:** UI can consume real BE-012 DTOs through one typed adapter without gaining filesystem access.

**Depends On:** None.

**Files:**

- Create: `src/lib/ipc/data-management.ts`, `src/features/settings/data-error-copy.ts`.
- Test: `src/lib/ipc/data-management.test.ts`, `src/features/settings/data-error-copy.test.ts`.
- Read only: `src/bindings/data-management.ts`, `src/lib/ipc/ipc-error.ts`.

**Interfaces:**

- Consumes invokeCommand/IpcCallError and all generated Data DTO/error unions.
- Produces `getDataLocation`, `openDataLocation`, `copyDataLocation`, `exportBackup`, `prepareImportBackup`, `confirmImportBackup(requestId)`, `prepareResetXwork`, `confirmResetXwork(requestId, confirmation)`, `cancelDataOperation(requestId)` with Promise outputs from the specification table.
- Produces `onDataChanged(callback): Promise<UnlistenFn>` for `data://changed` and safe copy classification local to Settings.
- Test seam: mock `@tauri-apps/api/core` invoke and event listen; capture callbacks and deferred UnlistenFn. No Tauri runtime or native plugin is invoked.

- [ ] **Step 1:** Add discoverable assertions for each exact command, `{ requestId, confirmation }` argument spelling, no path input, both tagged outcomes and all error codes. Exercise normal and error-preview timestamps, unsafe integers, out-of-Date-range values and malformed nested previews.
- [ ] **Step 2:** Run `pnpm exec vitest run src/lib/ipc/data-management.test.ts src/features/settings/data-error-copy.test.ts`. Expected red: exact invoke call/count or normalized bigint/safe-copy assertions fail against typed shells; record actual discovered test counts.
- [x] **Step 3:** Implement thin wrappers, normalize createdAtMs only, preserve generated types, and unwrap the aggregate event. Unknown rejection remains uncertainty, never raw diagnostic text. Test that export cancelled does not call cancel_data_operation.
- [x] **Step 4:** Rerun the command above and `pnpm typecheck`. Expected: all selected tests pass, commands/args match Rust and generated bindings remain unchanged.

### Task 2: Own one Data operation per shell lifetime

**Outcome:** Explicit user actions produce one operation; request expiry, replacement previews and late responses cannot trigger unintended mutations.

**Depends On:** Task 1.

**Files:**

- Create: `src/features/settings/data-management-state.ts`, `src/features/settings/data-management-provider.tsx`.
- Test: `src/features/settings/data-management-state.test.ts`, `src/features/settings/data-management-provider.test.tsx`.

**Interfaces:**

- Consumes Task 1 wrappers; provider callbacks `beforeConfirm(): Promise<() => void>`, `onCommitted(kind)`, `onResetUncertain` from app.
- Produces DataManagementState/public useDataManagement, prepare/setConfirmation/confirm/cancel, acceptCommitted/retirePreview/refreshViews/acknowledgeUncertain, public busy/invalidationEpoch/resetEpoch/refreshFailures/listenerStatus as specified.
- Test seam: mocked IPC module and explicit deferred promises; coordinator factory accepts callback dependencies, with no production fallback in tests. Mount provider with fake callbacks, not AppProviders native initialization.

- [ ] **Step 1:** Test immediate double-click/Enter protection, cancelled picker, ready import/reset, TTL/stale IDs, trimmed case-sensitive RESET, preview_changed and repeated explicit confirmation. Include unmount/hidden/route retirement before prepare settles and exactly one late matching cancellation.
- [ ] **Step 2:** Run `pnpm exec vitest run src/features/settings/data-management-state.test.ts src/features/settings/data-management-provider.test.tsx`. Expected red: two prepares are admitted or late ready remains visible; preview_changed fails to demand a new explicit confirm. Ensure callable shells and actual assertion failures.
- [x] **Step 3:** Implement a synchronous single-flight slot with operation-owned promise lifetime. Never auto-confirm, auto-prepare on mount or automatically replay mutation on transport errors. Apply survives route detach; cancel is unavailable during apply. Keep success known from an event even if command later rejects. Release every owner barrier through callback cleanup, including preview_changed and exceptions.
- [x] **Step 4:** Run the same test command. Expected: exactly one confirm, bounded request state, StrictMode-safe lifecycle and event-result coalescing without swallowing a later distinct reset. Unknown outcome remains explicit after read reconciliation until acknowledged.

### Task 3: Add public barriers and failure-aware owner refresh

**Outcome:** Already-sent settings work settles before Data confirmation, and stale snapshots cannot overwrite restored state.

**Depends On:** Task 2 public lifecycle; Task 1 for adapters only indirectly.

**Files:**

- Modify: `src/features/settings/settings-store.ts`, `src/features/settings/cli-profiles-store.ts`, `src/features/settings/keyboard-shortcuts-state.ts`, `src/features/projects/projects-store.ts`, `src/features/sessions/sessions-store.ts`.
- Modify: `src/features/terminal/terminal-registry.ts`, `src/features/terminal/terminal-context.ts`, `src/features/terminal/index.ts`.
- Test: `src/features/settings/settings-store.test.ts`, `src/features/settings/cli-profiles-store.test.ts`, `src/features/settings/keyboard-shortcuts-state.test.ts`, `src/features/projects/projects-store.test.ts`, `src/features/sessions/sessions-store.test.ts`, `src/features/terminal/terminal-registry.test.ts`.

**Interfaces:**

- Settings/CLI/Shortcuts produce `settleBeforeDataChange(): Promise<void>`, `releaseDataChangeBarrier(): void`, `refreshAfterDataChange(): Promise<void>` on their public state surfaces.
- Projects/Sessions produce `refreshAfterDataChange(clearSnapshot: boolean): Promise<void>`.
- Terminal public index exposes `useTerminalDataBoundary()` returning `clearAfterReset(): void` and `reconcileAfterResetFailure(): Promise<void>` through the existing registry context.
- Consumes existing public IPC wrappers, actual in-flight promise slots, retained consumers and TerminalRegistry entry.dispose/reconcile.
- Test seams: existing store IPC mocks; deferred reads/writes; TerminalRegistryIpc and TerminalAdapterFactory fake adapter; no WTerm native browser/process connection, real keyring or shell.

- [ ] **Step 1:** Add tests where an old read resolves after refresh, an Appearance write is pending with a queued patch, and a shortcut read finishes after imported settings. Keep retained subscriptions active. For reset test clearSnapshot followed by read rejection cannot restore old projects/session rows.
- [ ] **Step 2:** Run `pnpm exec vitest run src/features/settings/settings-store.test.ts src/features/settings/cli-profiles-store.test.ts src/features/settings/keyboard-shortcuts-state.test.ts src/features/projects/projects-store.test.ts src/features/sessions/sessions-store.test.ts src/features/terminal/terminal-registry.test.ts`. Expected red: late old values win, queued patch still sends, or clearAfterReset leaves a renderer entry. Existing tests must remain discovered.
- [x] **Step 3:** Add narrow generation-aware methods without replacing the stores. Claim barriers synchronously; settle in-flight commands, drop unsent patches with resolved waiters, fail closed on unknown write outcomes and release all barriers after Data finishes. Preserve bootstrap/retains/listeners. Failure-aware refresh rejects for bridge aggregation while publishing owner error state. Inactive CLI state invalidates for its next real consumer without creating a hidden permanent subscription.
- [x] **Step 4:** Dispose renderer entries only after confirmed reset, keep registry monitoring, and never issue start/kill IPC from UI cleanup. Failure reconciliation queries live entries and preserves unconfirmed ones. Rerun the command above and `pnpm typecheck`; expect generation isolation, retained subscriptions and no process command calls.

### Task 4: Render Data and its accessible confirmation dialogs

**Outcome:** The wireframe's Phase 1 page is actionable, with explicit preview, reset confirmation and truthful errors.

**Depends On:** Tasks 1–2.

**Files:**

- Create: `src/features/settings/settings-data-route.tsx`, `src/features/settings/data-operation-dialog.tsx`.
- Modify: `src/app/app-router.tsx`.
- Test: `src/features/settings/settings-data-route.test.tsx`, `src/features/settings/data-operation-dialog.test.tsx`, `src/app/app-router.test.tsx`.
- Read only: settings-nav/settings-section and existing button/input/dialog/tooltip source from the FE inventory.

**Interfaces:**

- Consumes public Data provider, Data DTOs and existing SettingsSection/SettingRow primitives.
- Produces `SettingsDataRoute(): React.JSX.Element`; private typed dialog props remain within Settings.
- Test seams: mount the route with fake provider callbacks/IPC and memory router. Inject document visibility and focus with jsdom; no native picker.

- [ ] **Step 1:** Cover location independent of settings failure, Copy/Open errors, cancelled pickers, unencrypted/secret-reference copy, zero counts, fileName text escaping, version/date, merge totals, RESET trim/case and unsavedDocuments warning when nonzero. Verify absence of Notes/Events Phase 1 affordances.
- [ ] **Step 2:** Run `pnpm exec vitest run src/features/settings/settings-data-route.test.tsx src/features/settings/data-operation-dialog.test.tsx src/app/app-router.test.tsx`. Expected red: `/settings/data` still shows placeholder; import preview or correctly gated Reset action is missing. Tests compile using route/dialog export shells.
- [x] **Step 3:** Replace only Data's route element; retain existing sub-nav/breadcrumb. Reuse components and semantic tokens. Trap focus; initially focus Cancel for reset, never submit reset from input Enter/IME, support Escape/outside cancellation only before apply, restore only live opener focus. Use aria-live/status, error alerts and spinner without invented percentages.
- [x] **Step 4:** Rerun selected tests and `pnpm typecheck`. Expected: explicit reconfirmation after preview_changed, no disabled-button bypass, correct copy for cleanup pending, unknown confirmation and refresh failure. Layout checks cover wrapping/scrollable path and dialog scroll structure; actual WebView sizing remains native smoke.

### Task 5: Compose persistent reconciliation and reset routing

**Outcome:** Committed changes refresh all affected projections; reset returns to existing Welcome/Home without losing the operation host.

**Depends On:** Tasks 2–4.

**Files:**

- Create: `src/app/data-management-bridge.tsx`.
- Modify: `src/app/app-shell.tsx`.
- Test: `src/app/data-management-bridge.test.tsx`, `src/app/app-shell.test.tsx`.
- Read only: public shell-store setters/state, existing AppearanceThemeSync, quit-store and owner exports.

**Interfaces:**

- App host under KeyboardShortcutsProvider receives router/shortcut/terminal context, creates callbacks and wraps children with DataManagementProvider; child bridge consumes Data context and subscribes. Keep both host and child in the one specified app file.
- `beforeConfirm` acquires/awaits Task 3 barriers and returns an idempotent release callback retained by the coordinator through its confirm/reconciliation finally; failed acquisition waits for all attempts and releases them all, and never calls backend confirm if a prerequisite is uncertain. Existing source mutations remain Rust-owned.
- `onCommitted` retires navigation generations and calls failure-aware owner refresh with Promise.allSettled; `onResetUncertain` reconciles sessions and terminal without optimistic clear.
- Test seams: fake aggregate listener with deferred registration; real public store APIs backed by mocked IPC; controlled router, terminal boundary, keyboard context and Quit commands. Inject listener rejection and individual query rejection explicitly.

- [ ] **Step 1:** Test reset event before result, result without event, late event, event followed by rejection, repeated resets, listener rejection, refresh partial failures and app host unmount during registration. Verify old rows/renderer callbacks cannot republish after reset; import preserves terminal identity.
- [ ] **Step 2:** Run `pnpm exec vitest run src/app/data-management-bridge.test.tsx src/app/app-shell.test.tsx`. Expected red: reset leaves the previous route/rows or refresh skips owners after the first rejection; subscription cleanup does not invoke late UnlistenFn. Compile host shells first.
- [x] **Step 3:** Connect subscription and result to the one reconciliation pipeline. Listener registering temporarily prevents mutation; rejected registration surfaces Retry and explicit command-result fallback. Do not wait forever for events. Keep local apply lock until its promise settles even if commit event arrives first.
- [x] **Step 4:** On reset commit clear renderer entries and old Projects/Sessions immediately, navigate `/` with replace without waiting for successful metadata queries, then display independent refresh failures. Apply sidebar width/collapse from refreshed settings while preserving maximized/window error state; do not write imported values back. Keep theme writer and providers mounted. Put reset success/cleanup/uncertainty status in the persistent host so leaving Data does not erase it.
- [x] **Step 5:** Retry only failed reads, never replay commands. Do not invent cleanup counts from kind-only events. Rerun Task 5 command and Task 3 focused command; expect all owners attempted, correct import/reset semantics and no test-only reset helpers called from production.

### Task 6: Retire Search/Notification/tray targets and coordinate Quit

**Outcome:** No pre-maintenance response can navigate or restore focus to deleted state; Data and Quit do not show competing dialogs.

**Depends On:** Task 5.

**Files:**

- Modify: `src/app/search-entry.tsx`, `src/app/notification-entry.tsx`, `src/app/use-lifecycle-events.ts`, `src/app/app-shell.tsx`.
- Test: `src/app/search-entry.test.tsx`, `src/app/notification-entry.test.tsx`, `src/app/use-lifecycle-events.test.ts`, `src/app/app-shell.test.tsx`.

**Interfaces:**

- Consumes public Data busy/epochs/retirePreview, Search close/refreshKey, NotificationCenter suspended/dismissKey, getSession, current Quit startQuit/receiveTrayRequest and cancelQuit IPC wrapper.
- Produces only composition guards; no new catalog entry, global event bus or backend lifecycle endpoint.
- Test seams: defer getProject/getSession/createSession/setActivePane, invoke saved tray callbacks, fake Quit request/cancel outcomes and document visibility. No actual Quit/process exit.

- [ ] **Step 1:** Test createSession/getSession resolving after reset; Notification activation awaiting setActivePane when maintenance begins; tray target missing after reset; hidden window commit; Quit during preview and apply, including stale/unknown cancellation and requestQuit null.
- [ ] **Step 2:** Run `pnpm exec vitest run src/app/search-entry.test.tsx src/app/notification-entry.test.tsx src/app/use-lifecycle-events.test.ts src/app/app-shell.test.tsx`. Expected red: stale target still navigates, opener steals focus or QuitDialog appears before Data apply settles.
- [x] **Step 3:** Check current public epochs before and after every asynchronous activation step; abort/close old Search work and remount only NotificationCenter on resetEpoch. Apply suspended to target actions and keep inbox unknown until fresh query. Ignore busy tray navigation; otherwise validate getSession before routing. Never roll back a session creation already committed.
- [x] **Step 4:** Defer frontend Quit intent at app shell and tray request delivery at lifecycle bridge. Preview retirement precedes Quit. After apply settles, cancel old tray request through existing command (stale is benign) and call startQuit for fresh impact; never auto-confirm. Keep failure handling typed, preserve native hide and do not show main automatically.
- [x] **Step 5:** Rerun selected tests. Expected: one dialog focus owner, no stale route/focus, no invented Palette action, no real lifecycle command execution in tests. Include unchanged existing Quit regression tests in the full frontend gate.

### Task 7: Verify, document evidence and hand off

**Outcome:** Parent receives a concrete code/automated result with native limitations separated.

**Depends On:** Tasks 1–6.

**Files:**

- Update only active execution evidence here and material decisions in the FE-015 design; keep FE-001/009/011 extensions consistent if implementation clarifies their boundaries.
- Test every exact frontend file listed in Tasks 1–6 through `pnpm test` and the explicit Rust targets below. No Rust test/source edits are planned.

**Interfaces:** Existing manifest scripts and Rust integration targets; no production interface.

- [x] **Step 1:** Run all final automated gates sequentially. Record command, exit code, discovered test count, first failures/fixes and final result. Never claim a skipped/filtered-zero test passed.
- [x] **Step 2:** Inspect changed-file inventory and generated binding diff; ensure no forbidden backend/config/package/user data changes. This is implementer self-check, not independent review.
- [x] **Step 3:** Perform native checks only if the isolated environment described below exists; otherwise record each pending condition. Do not create a real-profile reset experiment to make a checkbox pass.
- [x] **Step 4:** Leave files uncommitted for parent. Report paths, behavior, gate evidence, limitations and readiness for parent-managed `Implement FE015`; do not dispatch another agent or create a commit yourself.

## Final Verification

Run from repository root in PowerShell, with `$env:CARGO_BUILD_JOBS = '1'` inherited by every Rust/Tauri command.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend formatter | `pnpm format:check` | No formatting changes required |
| Frontend lint | `pnpm lint` | No lint errors |
| Type check | `pnpm typecheck` | No errors, including public provider/mock shapes |
| Frontend tests | `pnpm test` | Every test file in this plan discovered and passing; no zero-target shortcut |
| Frontend build | `pnpm build` | Production bundle succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Warnings denied, all targets/features |
| Data contract | `cargo test --manifest-path src-tauri/Cargo.toml --all-features --test data_management_contract -- --test-threads=1` | Isolated nine-command/transaction contract passes |
| App composition | `cargo test --manifest-path src-tauri/Cargo.toml --all-features --test app_builder -- --test-threads=1` | Existing app builder contract passes |
| Binding contract | `cargo test --manifest-path src-tauri/Cargo.toml --all-features --test export_bindings -- --test-threads=1` | Generated contract passes without unexpected drift |
| Full Rust | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- --test-threads=1` | All Rust tests pass sequentially |
| Windows desktop build | `pnpm tauri build` | Release application/bundle build succeeds; build alone is not smoke |
| Whitespace | `git diff --check` | No whitespace errors; separately include newly untracked files in whitespace self-check |
| Scope/boundary | `git status --short` and `git diff --name-only` | Only specified FE source/tests and active docs; manually compare untracked files against inventory |
| Negative backend change | `git diff -- src-tauri src/bindings package.json pnpm-lock.yaml` | Empty diff; investigate generated drift instead of silently accepting it |

For no-direct-OS and dependency-boundary assertions, inspect production Data files/imports with `rg -n 'invoke|@tauri-apps|localStorage|sessionStorage|navigator.clipboard' src/features/settings/data-management-state.ts src/features/settings/data-management-provider.tsx src/features/settings/settings-data-route.tsx src/features/settings/data-operation-dialog.tsx src/app/data-management-bridge.tsx`. Direct invoke/native imports belong only in the IPC adapter; no webview persistence or clipboard access is allowed. IPC mock assertions prove that no path argument or extra command is sent. Do not treat an empty grep alone as proof that real profile tests are safe: verify all native collaborators remain mocked.

### Native smoke and measurement isolation

- Prerequisite: already available Windows Sandbox, VM or dedicated test account, with verified disposable profile/app-data/credential store and test-only project directories. No real profile, secrets, developer working directories or process-global APPDATA mutation. Production has no assumed test directory override.
- Frontend tests use jsdom and mocked IPC. Existing Rust data_management_contract/app_builder tests use their current injected temporary storage and fake Data/Projects/CLI/Notifications/native collaborators; do not replace these with production defaults. TerminalRegistry tests use its explicit IPC and adapter factory injection.
- Manual smoke: native save/open cancellation; export overwrite; import valid/invalid v1 and explicit merge preview; location copy/open; reset with disposable running sessions; cancellation and RESET; empty Home; new session works after reset; hide/return; Quit during operation. Check project source and log retention against disposable sentinels. Use fake/canary secret only in test-owned credentials.
- Accessibility smoke: keyboard-only flow, IME, focus after cancel/reset, long location, enlarged font, reduced motion and viewport-constrained dialog in actual WebView2.
- Measure backend snapshot/preview target `<500 ms` with isolated data and existing supported instrumentation: report dataset, machine, number of samples and timed boundary. Exclude picker/user wait and separate UI/render elapsed time. If there is no supported boundary measurement tool, mark pending; add no production debug command or ACL for a metric.
- Existing stages' native/p95 pending evidence remains pending. No macOS check or automated desktop E2E is authorized.

## Deviations and Decisions

- User explicitly authorizes self-resolution; the planning additions in FE-015 define previously implicit write barriers, listener fallback, event acceptance/public epochs and deferred Quit refresh. No new Rust API is requested.
- Use actual source and manifest as implementation evidence over stale scaffold statements in AGENTS.md. Preserve architectural rules and pinned dependencies.
- Code's aggregate event may follow credential cleanup; reconciliation cannot rely on the schematic order in BE prose. Result/event duplicates are safe invalidations, not a reason to reapply data.
- No independent review stage, agent dispatch or commit is part of this plan-only delivery. Parent may dispatch Astra medium to implement this plan later; that dispatch, not this document, grants implementation authority.

## Outcome

Original planning handoff (before implementation): planning self-check covers template structure, UTF-8, specification open questions, inventory, test-to-command coverage, flags and isolation. No frontend/Rust tests, build, native smoke, performance measurement or source implementation were executed by the original planning task. See the implementation evidence below for the later authorized execution.

Implementation evidence recorded below: task completion, focused red/green results, final gates, changed-file inventory, material decisions, and separately pending native/metrics. Keep docs uncommitted for the parent-owned final changeset.

### Execution milestone — 2026-09-06, tasks 1–6

- Implemented the nine-command adapter, strict replacement-preview validation and timestamp normalization; safe error mapping; shell-lifetime coordinator/provider; Data route and dialogs; owner barriers/refresh; aggregate bridge; Search/Notification/tray epoch guards and deferred Quit.
- Task 1–2 focused run: `pnpm exec vitest run src/lib/ipc/data-management.test.ts src/features/settings/data-error-copy.test.ts src/features/settings/data-management-state.test.ts`: **49/49**, 3 files, exit 0.
- First full frontend run: **1905 passed / 5 failed**, 106 files, test command exit 1. Failures were the obsolete Data-placeholder assertion, synchronous tray expectations and CLI availability-check timing. Preserved synchronous CLI command admission, kept immediate non-maintenance tray delivery, updated tray target validation/encoded routing assertion and replaced only Data's placeholder assertion.
- Owner/bridge focused run: **230/230**, 7 files, exit 0. Real owner stores used mocked IPC; TerminalRegistry used fake IPC/renderer injection.
- Added race assertions before fixes: coordinator external commit left phase `preview` without a preview; delayed old Sessions event resurrected reset rows. Red run: **50 passed / 2 failed**, 3 files, exit 1; terminal late-reconcile case already passed. Fixed external preview retirement and post-reset runtime event invalidation. Combined race/activation/lifecycle green run: **116/116**, 5 files, exit 0.
- Shell/settings focused run: **62/62**, 2 files, exit 0. Covers actual shell apply surviving Data route departure and deferred tray Quit cancellation/fresh impact before any Quit dialog.
- Typecheck first reported two public shortcut mock shapes, a Search refresh-key type and generic error typing. Corrected; subsequent `pnpm typecheck` exit 0. Added only `shortcut-recorder-dialog.test.tsx` to the design inventory for its required maintenance mock methods.
- Lint initially reported effect dependencies; made load/drain callbacks stable, used an explicitly documented listener retry dependency and removed a redundant fragment. Subsequent `pnpm lint` exit 0.
- Formatter invocation through the local pnpm PowerShell wrapper flattened the file array and processed zero files (not counted as success). Reissued via the installed Biome Node entry with explicit argv, formatting only the 39 changed/new source/test files; `pnpm format:check` then exit 0.
- Deviation: tasks 1–6's initial red-shell steps were not executed before first code. They remain unclaimed. Actual behavioural red/green evidence is recorded above; compile errors never count as behavioural red tests.
- Native smoke, WebView accessibility smoke and `<500 ms` metrics remain **pending**: no verified disposable Windows profile/credential store and supported measurement setup has been established. No real-profile operation or desktop E2E was attempted.

### Execution milestone — final automated checks

| Gate | Actual command/result | Exit |
|---|---|---|
| Format | `pnpm format:check`: 275 files checked, no changes required | 0 |
| Lint | `pnpm lint`: 275 files checked, no errors | 0 |
| TypeScript | `pnpm typecheck` | 0 |
| Frontend full, final code | `pnpm test`: **1,952 tests passed in 110 files**; no failed/zero-target shortcut | 0 |
| Frontend build, final code | `pnpm build`: 2,567 modules; production bundle produced | 0 |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j1 -- -D warnings` | 0 |
| Data Management | `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j1 --test data_management_contract -- --test-threads=1`: **36/36** | 0 |
| App composition | Same flags with `--test app_builder`: **15/15** | 0 |
| Binding contract | Same flags with `--test export_bindings`: **10/10** | 0 |
| Full Rust | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j1 -- --test-threads=1`: **478 passed across 21 result groups**, none failed | 0 |
| Tauri Windows | Final `pnpm tauri build`: latest frontend asset embedded, Windows executable produced; release compilation 3m 41s | 0 |

Every Rust/Tauri command inherited `CARGO_BUILD_JOBS=1`. No backend, generated binding, package, capability or migration file changed. Existing Rust Data/App harnesses use TempDir and injected fake/native-disabled collaborators; they were not changed. The known BE-011 timing and terminal-suite contention failures did not recur in this sequential run.

Final refinement verification: **88/88** tests in five targeted files passed after adding unknown-write barrier persistence, preview Quit ordering, hidden-window preview retirement/focus, explicit acknowledgement availability and true result summaries. Final frontend full run above includes these tests. Build emits the existing Vite-style >500 kB chunk warning; bundle splitting is outside this feature.

Boundary self-check: the planned `rg` check found no direct native invoke/import, localStorage/sessionStorage or web clipboard use in production coordinator/provider/route/dialog/bridge (rg exit 1 means no matches, not a failed gate). IPC tests assert exact command names/args and no caller path. All changed/untracked files decoded as UTF-8 and had no trailing whitespace. `git diff --check` exit 0; forbidden-path diff was empty. No staging, commit, subagent dispatch, independent review, desktop E2E or real-profile reset occurred.

The initial red-shell procedure remains explicitly skipped above. Its unchecked boxes do not mean source implementation is pending; task outcomes were implemented and verified with the actual tests listed here. Native and measurement checkboxes remain pending and are not replaced by automated success.

### Final barrier refinement

- Added behavioural assertions for unrecognized tagged producer failures. CLI and Shortcuts initially allowed the maintenance barrier through: **103 passed / 2 failed** in two files (exit 1). They now classify unknown codes as uncertainty; focused rerun **105/105** (exit 0).
- Shortcut uncertainty is retained independently of the visible error, so starting a refresh cannot unlock confirmation before the read succeeds. The first focused run of this refinement found that the success path did not clear the marker (**12 passed / 1 failed**); fixed it and reran **13/13**, exit 0.
- Intermediate full frontend after the tagged-error fix: **1,951/1,951**, 110 files, exit 0. A final full frontend rerun includes the additional pending-read assertion; completion evidence follows below.
- Tauri was already compiling the earlier embedded assets when this refinement landed. That build is allowed to finish; a new final Tauri build must embed the latest frontend before handoff. No build processes are run concurrently.

### Handoff verification snapshot

- Final unchanged source gate: **1,952 frontend tests / 110 files**, exit 0; format/lint/typecheck all exit 0. This includes the final shortcut pending-read uncertainty regression.
- Final `pnpm build`: exit 0, **2,567 modules**, `dist/assets/index-COMC2iV5.js`. The same >500 kB chunk advisory remains non-blocking.
- First `pnpm tauri build`: exit 0, Windows executable generated after **4m 20s** Rust release compilation. A second build is in progress to embed `index-COMC2iV5.js` rather than the earlier asset. Final completion is recorded separately below.
- Rust gates remain valid: no Rust source/config or generated binding changed during the frontend-only refinements. Full suite **478/478**, Data **36/36**, App **15/15**, Bindings **10/10**, Rustfmt and Clippy all passed.

### Task outcome accounting

1. IPC and error copy: implemented and covered by exact command/argument, timestamp, nested-preview and error-code tests.
2. Coordinator/provider: implemented and covered by single-flight, cancellation, reconfirmation, external event, unknown outcome and StrictMode/unmount tests.
3. Owner barriers/refresh: implemented and covered by sent/queued write, unknown producer outcome, late read/event and renderer disposal/reconciliation tests.
4. Data UI/dialogs: implemented with English Phase 1 copy, native wrappers, real counts, explicit RESET, modal locking, IME guard, reconfirmation and selectable location.
5. Persistent bridge: implemented with result/event reconciliation, per-owner failed-query retry, immediate reset projection clearing, navigation and retained provider identity.
6. Navigation/Quit: implemented with synchronous epoch checks, NotificationCenter reset lifetime, tray validation and deferred fresh Quit impact. Actual shell route-departure/apply and hidden focus regressions pass.
7. Verification/handoff: all automated gates passed, including the final embedded-frontend Tauri rebuild. Native/metrics explicitly pending, files left uncommitted.

### Native validation still pending

- Native file picker cancellation, export overwrite, import/reset on disposable running sessions, folder/clipboard, new session after reset, hide/return and Quit: **pending**, no verified disposable Windows profile/credential store/test project environment.
- Actual WebView2 keyboard/IME/focus, viewport/long path, enlarged font and reduced-motion checks: **pending**, no isolated interactive native session.
- Snapshot/preview `<500 ms` measurement: **pending**, no isolated dataset and supported boundary measurement setup. No production instrumentation/command/capability added.
- Earlier stages' native/p95 pending results remain unchanged. No macOS checks or automated desktop E2E performed.

### Changed-file inventory

44 files total: 5 feature documents/active plan and 39 frontend source/test files. Existing input design changes are retained for the parent-managed feature commit.

- `00-Docs/02-Frontend/FE-001-application-shell.md`
- `00-Docs/02-Frontend/FE-009-command-palette.md`
- `00-Docs/02-Frontend/FE-011-settings-frame-general-and-about.md`
- `00-Docs/02-Frontend/FE-015-settings-data.md`
- `00-Docs/98-Plan/20260906-fe-015-settings-data.md`
- `src/app/app-router.test.tsx`
- `src/app/app-router.tsx`
- `src/app/app-shell.test.tsx`
- `src/app/app-shell.tsx`
- `src/app/data-management-bridge.test.tsx`
- `src/app/data-management-bridge.tsx`
- `src/app/notification-entry.test.tsx`
- `src/app/notification-entry.tsx`
- `src/app/search-entry.test.tsx`
- `src/app/search-entry.tsx`
- `src/app/use-lifecycle-events.test.ts`
- `src/app/use-lifecycle-events.ts`
- `src/features/projects/projects-store.test.ts`
- `src/features/projects/projects-store.ts`
- `src/features/sessions/sessions-store.test.ts`
- `src/features/sessions/sessions-store.ts`
- `src/features/settings/cli-profiles-store.test.ts`
- `src/features/settings/cli-profiles-store.ts`
- `src/features/settings/data-error-copy.test.ts`
- `src/features/settings/data-error-copy.ts`
- `src/features/settings/data-management-provider.test.tsx`
- `src/features/settings/data-management-provider.tsx`
- `src/features/settings/data-management-state.test.ts`
- `src/features/settings/data-management-state.ts`
- `src/features/settings/data-operation-dialog.test.tsx`
- `src/features/settings/data-operation-dialog.tsx`
- `src/features/settings/keyboard-shortcuts-state.test.ts`
- `src/features/settings/keyboard-shortcuts-state.ts`
- `src/features/settings/settings-data-route.test.tsx`
- `src/features/settings/settings-data-route.tsx`
- `src/features/settings/settings-store.test.ts`
- `src/features/settings/settings-store.ts`
- `src/features/settings/shortcut-recorder-dialog.test.tsx`
- `src/features/terminal/index.ts`
- `src/features/terminal/terminal-context.ts`
- `src/features/terminal/terminal-registry.test.ts`
- `src/features/terminal/terminal-registry.ts`
- `src/lib/ipc/data-management.test.ts`
- `src/lib/ipc/data-management.ts`

### Final handoff — complete code and automated gates

- Final `pnpm tauri build` exited **0** after **3m 41s** release compilation and built `F:/Self Projects/XWork/src-tauri/target/release/xwork.exe` with the final `index-COMC2iV5.js` frontend asset. The earlier build is not used as evidence for the final frontend revision.
- **1,952/1,952 frontend tests**, **478/478 full Rust tests**, all listed formatter/linter/type/contract/build gates pass. No automated gate remains outstanding.
- Final inventory remains **44 files**. UTF-8/trailing-whitespace self-check and `git diff --check` pass; backend/binding/package/config diff is empty. Index is untouched; HEAD remains `452017f`.
- FE-015 stage 13 and FE-001/009/011 design extensions are ready for the parent to commit as **`Implement FE015`**. No subagent, independent review, staging or commit was performed; FE-003 stage 14 was not started.
- Native smoke/accessibility and `<500 ms` measurement remain pending under the isolation conditions listed above. This handoff completes code/automated work and does not claim complete native validation of stage 13.
