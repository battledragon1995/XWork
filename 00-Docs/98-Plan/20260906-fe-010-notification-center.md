# Stage 11 — FE-010 Notification Center Implementation Plan

**Status:** Implementation complete; all required automated gates passed. Ready for coordinator commit `Implement FE010`. Native Windows smoke remains pending, so full native validation is not claimed.

**Goal:** Connect the main-window notification bell to BE-011 so users can page through terminal notifications, read/delete them, and open their exact live session/tab/pane with correct badge and keyboard focus.

**Completion Criteria:**

- All three generated terminal notification kinds render with English copy, authoritative read/unread state, global unread count, paging, loading/empty/error states, and keyboard actions.
- Open uses the backend-validated target, activates its tab/pane, restores a conflicting maximized pane, navigates the existing session route, and focuses the target once without late navigation after dismissal.
- Deterministic IPC, hook, component, and composition tests demonstrate revision ordering, lost-event recovery, lifecycle cleanup, failures, and existing shell/session behavior.
- Windows frontend gates, Rust regression gates with one Cargo build job, and a Windows Tauri executable build pass. Targeted manual smoke results are recorded separately; pending native checks prevent claiming full native validation.

**Architecture:** A single persistent Notifications entry owns temporary memory state and the bell/popover. Its IPC wrapper consumes the generated BE-011 contract; Rust remains the authority for persistence, notification eligibility, read state, cleanup, and OS delivery. App composition calls public Sessions IPC and the existing memory router, while a neutral SessionRoute focus prop avoids imports between feature implementations.

**Tech Stack:** Existing React/TypeScript, React Router, Radix Popover, copied shadcn primitives, Animate UI Highlight, Tailwind tokens, Vitest/React Testing Library, Tauri commands/events, and generated ts-rs DTOs. No manifest, lockfile, or dependency changes are planned. Reuse the installed `radix-ui` package; do not install a separate popover package.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`; template: `00-Docs/99-Template/04-Plan.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 11 after stage 9; stage 21 owns reminders.
- Architecture: `00-Docs/00-Overview/01-TechStack.md`, `00-Docs/00-Overview/02-ProjectStructure.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §§4.2, 15, 18; §13.3 establishes deferred reminder scope.
- Primary design: `00-Docs/02-Frontend/FE-010-notification-center.md` including its planning decisions; `Câu hỏi mở` is `Không có`.
- Shell extension: `00-Docs/02-Frontend/FE-001-application-shell.md`, stage 11 section.
- Existing navigation/layout/terminal: `00-Docs/02-Frontend/FE-006-session.md`, `00-Docs/02-Frontend/FE-007-tabs-and-panes.md`, `00-Docs/02-Frontend/FE-008-terminal.md`.
- Backend: `00-Docs/03-Backend/BE-011-notifications.md` and commit `23b74b2`; public dependencies `00-Docs/03-Backend/BE-005-sessions-runtime.md`, `00-Docs/03-Backend/BE-007-terminal-and-pty.md`, `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`.
- Wireframes: `00-Docs/01-Wireframe/02-AppShell.html#notifications`, `.notif-panel` in `00-Docs/01-Wireframe/assets/wireframe.css`; `00-Docs/01-Wireframe/07-Calendar.html#reminder` for deferred scope only.
- Public code evidence: `src/bindings/notifications/notifications.ts`, `src/bindings/sessions/sessions.ts`, `src-tauri/src/notifications/commands.rs`, `src/lib/ipc/sessions.ts`, `src/lib/ipc/ipc-error.ts`.
- Existing composition/test configuration: `src/app/app-topbar.tsx`, `src/app/app-router.tsx`, `src/app/quit-store.ts`, `src/features/sessions/use-session-detail.ts`, `src/features/sessions/session-route.tsx`, `src/features/sessions/session-pane.tsx`, `package.json`, `vite.config.ts`, `src/test-setup.ts`, `src-tauri/tauri.conf.json`.

## Scope

**In Scope:**

- Six typed Notifications command wrappers and one event listener; one feature-local hook/cache, one bell/panel component, and a public entry.
- A copied local popover primitive using the existing dependency; no shared notification framework or persistence store.
- FE-001 bell integration, app-owned target activation/navigation, and the neutral SessionRoute focus request needed by this entry.
- Focused tests, local IPC mocks in existing shell-rendering test suites, required regression/build checks, and a manual Windows smoke checklist.
- Preserve the uncommitted FE-010 and FE-001 designs for the later `Implement FE010` commit. This plan is also part of that future implementation handoff.

**Out of Scope:**

- Implementation or commits during this PLAN ONLY turn. The later implementer/coordinator owns execution and committing.
- Reminder, Missed, Event navigation, Snooze/Dismiss, FE-023 settings, stage 13 reset, native toast click/actions, and new notification producers.
- Rust source changes, DTO generation changes, SQL/migrations, capabilities, manifests, lockfiles, native app-data overrides, runtime mocks, or macOS validation.
- Independent code review, automated native desktop E2E, or revisions to completed historical plans and roadmap status.

## Global Constraints

The following requirements are copied from `AGENTS.md` and `PLANS.md` and apply to every task:

- "Use UTF-8 for Markdown files."
- "Write code, identifiers, and code comments in English."
- "The initial UI language is English."
- "Every function, method, callback, test, and helper must have a short comment describing its purpose."
- "Prefer `///` documentation comments immediately above functions."
- "React owns presentation and temporary UI state."
- "Rust owns OS access, persistence, terminal processes, and business rules."
- "Frontend features do not import implementation from other features."
- "Generated bindings under `src/bindings/` are not edited manually."
- "Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state."
- "Do not rely on process-global environment mutation for test isolation when tests may run concurrently."
- "During development, build and test only on Windows."
- "Defer macOS validation until release preparation unless explicitly requested earlier."

Additional execution constraints: use `$env:CARGO_BUILD_JOBS = '1'` in every shell launching Rust or Tauri, and explicit `-j 1` for Cargo test/Clippy commands. This setting limits compilation resources; it is not a test-isolation mechanism. Do not run native desktop E2E. Do not claim a manual smoke check passed without performing it. Keep all changes within the FE-010 design file inventory; add a justified design decision before expanding it.

## Assumptions, Risks, and Blockers

**Assumptions:**

- BE-011 is implemented at `23b74b2`; its automated success is handoff evidence, not a fresh result from this planning turn.
- Stages 8–10 have code but pending native smoke. That does not block independent frontend implementation/automated testing; it does limit claims of stage completion.
- Wireframe example commands, project labels, changed-file counts, and test counts are not available in the generated DTO. Render backend title/context literally as escaped text, plus nullable exit code; do not derive missing information.
- The exact route is `/sessions/:sessionId`. `setActivePane` already selects its containing tab. No new route or observer is required.
- Six Notifications commands authorize the main window. The existing capability is sufficient; the frontend never calls the native notification plugin.

**Risks:**

- Event loss, stale query results, and page invalidation can corrupt count/list state: Task 2 keeps independent latest/page revisions, request generations, and refresh recovery.
- A late Open can steal navigation after closing the panel: Tasks 2 and 4 pass an AbortSignal and check it between awaits and before navigation.
- Same-route navigation can retain a stale Sessions snapshot: Task 4 refreshes on each focus request and waits for a replacement detail object, including equal-revision results.
- Existing shell tests mount the real topbar: Task 5 mocks Notifications IPC locally in all four affected suites, without changing global setup.
- JSDOM cannot validate physical positioning, native drag, or WebView focus: Task 6 records manual smoke separately.

**Blockers:** No unresolved design or backend-contract blocker for implementation. Native smoke requires an isolated Windows test account/environment and manual access; until available, those checks remain pending. This planning session exposes no subagent-dispatch tool, so the plan provides a handoff for the parent/coordinator rather than claiming Astra medium was launched.

## Dependency Order

1. Completed BE-011 and generated bindings → Task 1 IPC boundary.
2. Task 1 → Task 2 state/lifecycle behavior → Task 3 bell/panel.
3. Tasks 1–3 → Task 4 app navigation and SessionRoute focus integration.
4. Tasks 3–4 → Task 5 persistent shell integration and regressions.
5. Tasks 1–5 → Task 6 final gates, manual smoke accounting, and implementation handoff evidence.

Every red step below requires a discoverable, importable test target. For a new module, introduce only a typed, inert export scaffold alongside the test before running the red check. That scaffold belongs to future implementation, not this PLAN ONLY deliverable. A module-resolution error, zero tests, or a type error is not the intended red result; record the named behavioral assertion instead.

---

### Task 1: Expose the generated Notifications IPC boundary

**Outcome:** Frontend code invokes exactly the existing commands with correct argument casing and receives typed payloads/errors.

**Depends On:** Completed BE-011.

**Files:**

- Create: `src/lib/ipc/notifications.ts`.
- Test: `src/lib/ipc/notifications.test.ts`.
- Read only: generated Notifications binding and existing `ipc-error.ts`.

**Interfaces:**

- Consumes: `invokeCommand<TResult, NotificationError>`, `IpcCallError`, Tauri `listen`/`UnlistenFn`, and all generated Notifications DTOs.
- Produces: `getNotifications(cursor: NotificationCursorDto | null, limit: number): Promise<NotificationPageDto>`; `markNotificationRead(notificationId: string)`, `markAllNotificationsRead()`, `deleteNotification(notificationId: string)`, `clearReadNotifications()` returning `Promise<NotificationCenterStateDto>`; `openNotification(notificationId: string): Promise<OpenNotificationDto>`.
- Produces: `onNotificationsChanged(callback: (payload: NotificationCenterChangedDto) => void): Promise<UnlistenFn>` for `notifications://changed`.
- Test-only seam: module-local `vi.mock` of `@tauri-apps/api/core` and event API; capture the listener callback and return a spy unlisten. No native calls or real storage.

- [x] **Step 1: Add focused tests and importable wrapper scaffolds.** Assert all six names, `{ notificationId }` casing, `{ cursor, limit: 30 }`, argument-free bulk calls, unchanged string timestamps/revisions, typed rejection normalization, and event payload/unlisten forwarding.
- **Skipped in execution; see deviation below.** **Step 2: Demonstrate red.** Run `pnpm exec vitest run src/lib/ipc/notifications.test.ts`. Expected: the `invoke` spy has not received `get_notifications` with the documented cursor/limit from the inert wrapper; the discovered test fails on that call assertion.
- [x] **Step 3: Implement only wrappers and event adaptation.** Use shared normalization, preserve DTOs, and pass `event.payload` to the consumer. Keep command names and direct Tauri imports here.
- [x] **Step 4: Verify.** Repeat the command. Expected: all wrappers, errors, and listener assertions pass with no actual invoke reaching Tauri.

### Task 2: Synchronize notification state without stale responses

**Outcome:** One hook reconciles global unread count and paginated rows across commands, events, focus recovery, and dismissal.

**Depends On:** Task 1.

**Files:**

- Create: `src/features/notifications/use-notifications.ts`.
- Test: `src/features/notifications/use-notifications.test.ts`.

**Interfaces:**

- Consumes: Task 1 wrappers and generated types.
- Produces: feature-private `useNotifications` behavior implementing the FE-010 `NotificationsState` contract; the public component delegates its `onOpenTarget`, `dismissKey`, and `suspended` inputs to this lifecycle owner. No public store export.
- Test-only seams: mock the Notifications IPC module; deferred promises for listener registration, list, mutation, and Open callback; manually deliver event payloads; fake timers/system time; test-local focus/visibility properties restored after each test. No test-only production command or OS resource access.

- [x] **Step 1: Add a rendered-hook test and inert hook scaffold.** Cover subscribe-before-query and a known initial page with nonzero unread count.
- **Skipped in execution; see deviation below.** **Step 2: Demonstrate red.** Run `pnpm exec vitest run src/features/notifications/use-notifications.test.ts`. Expected: state remains unknown/empty instead of adopting the returned unreadCount and page after listener registration.
- [x] **Step 3: Implement the minimum state machine.** Register once per mounted owner before the initial query; allow the query even if registration fails, while exposing listener failure. Use page size 30, memory-only state, decimal-safe revision comparisons, at most one page query plus one queued refresh, and 100ms event coalescing. Apply event count immediately; dirty closed panels without fetching on every event. Refresh on open/focus/visible and reconcile mutations even without events or after uncertain transport errors.
- [x] **Step 4: Extend deterministic tests.** Exercise revisions above `9007199254740991`, out-of-order/duplicate events, stale initial query, changes during Load more, duplicate IDs, exhausted cursor, invalid cursor recovery once, equal-revision mutation no-op, and global bulk actions affecting unloaded rows. Simulate listener rejection and initial `getNotifications` persistence failure explicitly: the hook reports an actionable error, retains unknown count until a real snapshot, and Retry recovers. Verify refresh errors preserve stale rows but disable actions, and listener retry does not duplicate a live subscription.
- [x] **Step 5: Implement cancellation and cleanup.** Abort each Open attempt when dismissed, suspended, unmounted, or navigated away. Abort does not cancel Rust work; reconcile committed count/read state but prevent subsequent UI steps. Late listener registrations unlisten immediately; stale promises cannot republish across owners; timers/listeners are removed. Do not retry mutations automatically.
- [x] **Step 6: Verify.** Repeat the focused command. Expected: all synchronization/failure/cleanup assertions pass under StrictMode and deferred responses; no zero-test result is accepted.

### Task 3: Build the accessible bell and notification panel

**Outcome:** The notification wireframe becomes an English, keyboard-operable view of real hook state.

**Depends On:** Tasks 1–2.

**Files:**

- Create: `src/features/notifications/notification-center.tsx`, `src/features/notifications/index.ts`, `src/components/ui/popover.tsx`.
- Test: `src/features/notifications/notification-center.test.tsx`.

**Interfaces:**

- Consumes: the private hook, existing Button/Tooltip, existing HighlightItem, and Radix Popover from the installed package.
- Produces: `NotificationCenter({ onOpenTarget, dismissKey, suspended }): React.JSX.Element`, where `onOpenTarget(target: NotificationTargetDto, signal: AbortSignal): Promise<void>` matches the design.
- Produces: copied UI primitive exports `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor` as needed by the actual component; use source style consistent with the existing Radix wrappers.
- Test-only seams: local Notifications IPC mock and fake clock/timers; exercise the real hook and public component together. Reuse existing JSDOM setup. Physical placement is not asserted from nonexistent browser layout.

- [x] **Step 1: Add an importable inert component and focused interaction test.** Open the bell using keyboard and return a known generated-contract page.
- **Skipped in execution; see deviation below.** **Step 2: Demonstrate red.** Run `pnpm exec vitest run src/features/notifications/notification-center.test.tsx`. Expected: no dialog named `Notifications` or `Open session` action appears after bell activation.
- [x] **Step 3: Implement panel and actions.** Use a nonmodal, portalled, right-aligned 400px popover constrained to the viewport, scrollable body, and existing tokens. Implement exact loading/empty/error/stale/pending states, 0/unknown/99+ badge rules, global count in the accessible name, `Mark all read`, `Clear read`, per-row Open/Mark/Delete, and Load more. Clear read stays available after a successful page even when no read row is visible. Render text, not HTML, and do not add unavailable Settings links or reminder actions.
- [x] **Step 4: Implement focus/time semantics.** Heading receives initial focus; Escape/close return focus to the bell, outside clicks retain their target, and navigation/Quit suppress focus restoration. Retain row action focus after refresh, or use next/previous/heading fallback after removal. Use the design's relative-time and invalid-date rules, a single 60-second timer only while open, and reduced-motion styling.
- [x] **Step 5: Verify.** Repeat the focused command. Expected: all three kinds, every action/state, unread accessibility, time boundaries, keyboard traversal, focus fallback, and dismissal cancellation pass. Count is never computed from the loaded rows, and opening alone never marks items read.

### Task 4: Navigate to the exact terminal target and focus once

**Outcome:** Validated notification targets open the correct existing tab/pane and cannot redirect the user after cancellation.

**Depends On:** Tasks 1–3.

**Files:**

- Create: `src/app/notification-entry.tsx`.
- Modify: `src/app/session-terminal-route.tsx`, `src/features/sessions/session-route.tsx`.
- Test: `src/app/notification-entry.test.tsx`, `src/app/session-terminal-route.test.tsx`, `src/features/sessions/session-route.test.tsx`.
- Read only: `src/lib/ipc/sessions.ts`, `src/features/sessions/use-session-detail.ts`, `src/app/quit-store.ts`.

**Interfaces:**

- Consumes: public `NotificationCenter`, `setActivePane(sessionId, tabId, paneId)`, `setMaximizedPane(sessionId, tabId, null)`, existing router navigate/location, generated `SessionDetailDto`, and `useQuitStore` phase.
- Produces: app `NotificationEntry` with the callback supplied to Task 3; navigation state `{ notificationFocus: { tabId, paneId, requestId } }`.
- Produces: optional neutral `SessionRoute` prop `focusRequest?: { tabId: string; paneId: string; requestId: string }`, without Notifications imports in Sessions.
- Test-only seams: mock Notifications public entry to expose the app callback, mock Sessions IPC to return deferred detail snapshots/errors, memory-router destinations to observe navigation, test-local session-detail mock for focus stages, and local quit-store reset. No PTY or native window.

- [x] **Step 1: Add tests and inert composition/prop scaffolds.** Make the callback callable and focusRequest accepted without behavior; keep existing props and terminal slot intact.
- **Skipped in execution; see deviation below.** **Step 2: Demonstrate red.** Run `pnpm exec vitest run src/app/notification-entry.test.tsx src/app/session-terminal-route.test.tsx src/features/sessions/session-route.test.tsx`. Expected: `setActivePane` is not called for the callback target and the designated pane does not acquire focus for a new focusRequest. Existing route assertions should still run.
- [x] **Step 3: Implement navigation.** Use only the target returned by `open_notification` through the feature callback. Check AbortSignal before subsequent operations; call setActivePane, verify returned project membership, and restore maximize only when another pane covers the target. Navigate to `/sessions/${encodeURIComponent(sessionId)}` with a new local requestId. Missing/mismatched targets or restore failure do not navigate; do not roll back committed read state. Do not call setActiveTab or setObservedSession here.
- [x] **Step 4: Implement route focus.** Validate app navigation state shape and pass it to SessionRoute. On each new requestId call the existing void `detail.refresh()` once, retaining the pre-refresh detail object reference. Wait for a replacement ready detail object and matching active IDs before focusing the pane section through the route's own ref. Equal revision with a new snapshot still completes focus; a status-only render with the same object does not. Do not remount Terminal, poll, or focus again on unrelated events. Preserve the existing missing-session redirect to the known project or Projects; other query failures retain Retry.
- [x] **Step 5: Implement suspension and failure tests.** Suspend for `requesting`, `awaiting-confirmation`, `confirming`, `integration-failed`; permit retry at `idle`/`snapshot-failed`. Test dismissal/route/Quit between each await, no-op activation, same-route equal-revision refresh, other-pane maximize, project mismatch, session/pane loss, and an Open that marks read but fails activation. Verify post-navigation missing behavior is the existing FE-006 behavior, not a fabricated successful target.
- [x] **Step 6: Verify.** Repeat the focused command. Expected: exact activation/navigation/focus and all existing session-route/terminal-slot regressions pass with no late navigation or focus stealing.

### Task 5: Replace the shell placeholder and isolate shell regressions

**Outcome:** One notification owner survives route changes, with the original topbar layout and window-control interaction preserved.

**Depends On:** Tasks 3–4.

**Files:**

- Modify: `src/app/app-topbar.tsx`.
- Test: `src/app/app-topbar.test.tsx`, `src/app/app-shell.test.tsx`, `src/app/app-router.test.tsx`, `src/app/app-sidebar.test.tsx`.

**Interfaces:**

- Consumes: app `NotificationEntry`, existing topbar Highlight parent, router context, and window-control drag exclusion.
- Produces: no new public shell API; replaces the local NotificationBell placeholder.
- Test-only seams: each listed test suite mocks `src/lib/ipc/notifications.ts` locally with generated-shape fixtures. Capture listener lifecycle where tested. Keep existing Projects/Sessions/settings/window mocks. Do not add global mock behavior to `src/test-setup.ts`.

- [x] **Step 1: Add/update tests for interactive bell and lifetime.** Preserve assertions for Search, breadcrumb, window controls, hover, and sidebar.
- **Skipped in execution; see deviation below.** **Step 2: Demonstrate red before replacement.** Run `pnpm exec vitest run src/app/app-topbar.test.tsx src/app/app-shell.test.tsx src/app/app-router.test.tsx src/app/app-sidebar.test.tsx`. Expected: the old aria-disabled bell cannot open the notification dialog or display the supplied nonzero count; the feature lifetime listener assertion has no call.
- [x] **Step 3: Replace only the reserved bell.** Render NotificationEntry in the existing 44×40 control slot, remove orphaned bell imports/helper, and retain a single shared hover highlight. Portalled content must not bubble into titlebar double-click/drag handlers: stop the relevant portal pointer/double-click propagation within the feature if needed, verified through the real topbar test. Preserve Search as-is and do not modify AppShell production code.
- [x] **Step 4: Verify.** Repeat the command. Expected: all four suites pass, one active listener remains across route changes, unmount releases it, Quit focus takes precedence, and bell/panel interactions never invoke maximize/window dragging. The global test setup remains unchanged.

### Task 6: Verify the implementation and record an honest handoff

**Outcome:** The implementation has traceable automated evidence and explicit native limitations for the coordinator.

**Depends On:** Tasks 1–5.

**Files:**

- Update active execution record: `00-Docs/98-Plan/20260906-fe-010-notification-center.md`.
- Record any material contract changes only in `00-Docs/02-Frontend/FE-010-notification-center.md` and the relevant stage 11 section of `00-Docs/02-Frontend/FE-001-application-shell.md`.
- No additional production source files are authorized by this task.

**Interfaces:** Consumes all completed task behaviors and the checks below; produces verification results and remaining limitations, not a new API. Existing Rust tests use their existing isolated collaborators; do not add test infrastructure for this UI slice.

- [x] **Step 1: Run final verification below.** Record command, exit/result, and the meaningful failure if a check cannot pass. Fix regressions within scope and rerun the affected checks; do not rewrite past plan history.
- [x] **Step 2: Check changed paths.** Use `git diff --name-only` and `git status --short`, including untracked files. Verify no production Rust/bindings/capabilities/configuration/dependency changes; investigate generator drift rather than accepting it. Use `rg` on the affected frontend files to confirm direct Tauri calls stay in IPC and Notifications has no imports of another feature's implementation, persistence API, runtime fixture, or reminder command. This is implementer self-verification, not an independent review pass.
- [ ] **Step 3: Perform available manual smoke in isolation.** Use a separate Windows test account or disposable Windows environment, an empty app profile, and a throwaway project. The executable has no assumed environment-variable app-data override. If this environment/native access is unavailable, record each item as pending and do not run against the developer's real data.
- [x] **Step 4: Record outcome and return to the coordinator.** List changed paths, exact gate results, native pending checks, and any remaining blocker. Keep designs with source changes for the coordinator's later `Implement FE010` commit; do not commit merely because PLAN is ready or while only planning. No independent reviewer/subagent is part of this plan.

## Final Verification

Run from the repository root in PowerShell. Execute Rust-heavy commands sequentially. Set `$env:CARGO_BUILD_JOBS = '1'` in the same shell for every Rust/Tauri invocation; if each tool call starts a fresh shell, repeat the setting in each call.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend formatting | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Frontend types | `pnpm typecheck` | No type errors; imports use generated contracts |
| Frontend full suite | `pnpm test` | All unit/component tests pass, including every test path selected in Tasks 1–5 |
| Frontend production | `pnpm build` | Production assets build successfully |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features -- -D warnings` | No warnings/errors |
| Existing notification contracts | `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --test notifications_commands --test notifications_os_windows --test export_bindings` | Exact existing integration targets pass; bindings unchanged; OS tests use recording adapters |
| Full Rust regression | `cargo test --manifest-path src-tauri/Cargo.toml -j 1` | All existing unit/integration tests pass |
| Windows desktop build | `pnpm tauri build` | Release executable builds with existing `bundle.active = false`; no installer or native-smoke claim |
| Whitespace | `git diff --check` | No whitespace errors; separately check untracked Markdown with `git diff --no-index --check -- /dev/null PATH` before staging |
| Scope/boundaries | `git diff --name-only`, `git status --short`, focused `rg` searches as Task 6 | Only approved feature/app/test/docs files change; no generated/public Rust contract or permission changes |

The selected Rust integration files are `src-tauri/tests/notifications_commands.rs`, `src-tauri/tests/notifications_os_windows.rs`, and `src-tauri/tests/export_bindings.rs`. They are read-only regression inputs, not planned edits. Notifications fixtures already use `TempDir`, fake owner dependencies, deterministic clock/IDs, and recording OS adapters in `src-tauri/tests/support/notifications.rs`; app builder tests use existing `configure_with_app_data_dir`/test collaborators. Frontend tests mock IPC before rendering; they must not resolve real app data or spawn PTYs. Do not use environment mutation as a replacement for these seams.

Manual Windows checklist, all **pending** at planning time:

| Check | Observable result |
|---|---|
| Bell, popover and native chrome | Bell opens without dragging/maximizing; panel fits at normal and larger font sizes; scrolling/actions are not clipped; double-clicking panel content does not maximize main |
| Keyboard/focus | Tab reaches actions, Escape returns to bell, deletion has stable fallback, Open focuses exact pane, Quit retains its dialog focus |
| Real terminal activity | In an isolated throwaway session/project, background shell finish/failure creates corresponding bell items; observed-session activity follows BE-011 policy without frontend-created items |
| Open and cleanup | Correct tab/pane activates, conflicting maximize restores, session close removes items, no stale target is recreated |
| Hide/show | Badge/list reconcile after restoring main; opening panel does not mark everything read |
| Quit and cancel | Quit dismisses panel; cancellation permits reopening; completed Quit relies on existing backend cleanup |

Needs-input toast and installed-identifier OS delivery remain the separate pending BE-011 native checks unless actually exercised in the required native environment. A release executable build or recording-adapter test is not that evidence. Do not change `bundle.active`, historical stages 8–10 plans, or macOS status to satisfy this checklist.

## Deviations and Decisions

- 2026-09-06: User authorized autonomous design decisions during PLAN ONLY. Added planning decisions to FE-010 rather than asking questions.
- Same-route focus requires a refreshed object even when revision is unchanged; `useSessionDetail.refresh()` is void and retains the previous object while loading. The route waits for a replacement snapshot without changing the hook contract.
- Preserved FE-006 missing-session redirect after navigation. Before navigation, stale notification targets stay in the panel with an error; no arbitrary session/pane fallback is introduced.
- Mapped suspension to actual quit-store phases and added local Notifications mocks to router/sidebar tests because both mount the real shell.
- Native smoke isolation uses a separate Windows account/environment, not an invented executable app-data override. Unavailable smoke remains pending.
- No dependency additions, source implementation, test execution, native smoke, or commit occurred while authoring this plan.
- Handoff assignment: **Astra medium**, implementation of Tasks 1–6 only when the parent/coordinator dispatches the implementation turn. Follow this plan and FE-010/FE-001 stage 11 contracts, keep the current uncommitted designs, use one Cargo job, and report automated/native results separately. Do not introduce an independent reviewer or extra subagent.

## Outcome

FE-010 and the FE-001 stage 11 extension are implemented in the authorized workspace. Typed IPC, revision-safe synchronization, global read/delete actions, exact-target navigation, same-route pane focus, keyboard/focus behavior, and shell/Quit lifetime have passing automated coverage. The final Windows release executable build passed with the last activation-error copy adjustment embedded. No source implementation or automated gate remains pending.

Native Windows smoke is still pending because no isolated disposable account/environment was available. This limits native validation, not the completed independent implementation and automated checks. No commit, independent review, extra subagent, desktop E2E, historical plan revision, or Rust/bindings/capability/dependency edit was performed. The coordinator owns the subsequent combined `Implement FE010` commit.

## Execution Evidence — 2026-09-06

- Implemented typed Notifications IPC, private lifecycle state, accessible bell/panel, app activation composition, neutral route focus, and local shell IPC isolation. No Rust/bindings/dependency changes or commits.
- `pnpm exec vitest run src/lib/ipc/notifications.test.ts`: 1 file, 3 tests passed.
- `pnpm exec vitest run src/features/notifications/use-notifications.test.ts src/features/notifications/notification-center.test.tsx src/app/app-topbar.test.tsx src/app/app-shell.test.tsx src/app/app-router.test.tsx src/app/app-sidebar.test.tsx`: 6 files, 128 tests passed.
- `pnpm exec vitest run src/app/notification-entry.test.tsx src/app/session-terminal-route.test.tsx`: 2 files, 20 tests passed; `pnpm typecheck` passed.
- `pnpm exec vitest run src/features/sessions/session-route.test.tsx src/app/app-shell.test.tsx`: 2 files, 42 tests passed, including equal-revision same-route focus and single-listener route/Quit lifetime.
- Execution deviation: wrappers/components were implemented with their tests rather than temporary inert scaffolds. The planned scaffold-specific red steps were not performed and are not claimed. The first hook run found 1 failure among 16 tests: React 19 did not double-invoke a nested-only StrictMode wrapper. Setting Testing Library `reactStrictMode: true` exercised root StrictMode and the complete hook suite passed. Focus/paging regression fixes are tested against real hooks with deferred responses.
- Current native limitation: no disposable Windows account/environment with an isolated app profile has been established for this turn. Every native checklist item remains pending; no real developer profile or PTY is used by these frontend tests.
### Gate milestone

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: exit 0, 248 frontend files checked; lint has no warnings after removing newly introduced non-null test assertions.
- Initial complete `pnpm test`: 97 files / 1,764 tests passed. Additional deterministic tests subsequently cover repeated refresh invalidation, late query/timer cleanup, last-row heading focus, the single 60-second interval, and read-committed activation failure copy. The latest focused Notifications run has 30 passing tests; final full frontend run follows these additions.
- `pnpm build`: exit 0; existing Vite chunk-size warning remains (main JS approximately 998 kB). No dependency/configuration changes were made to suppress the warning.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: exit 0.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -j 1 --all-targets --all-features -- -D warnings`: exit 0.
- Selected Rust contracts: first run failed only `real_terminal_producer_reaches_notifications_without_frontend_listener` at `notifications_commands.rs:124`, `output.load(Ordering::SeqCst) > 0`. The test awaits attention publication/notification flush, then checks an independently delivered output callback. This is evidence of an intermittent timing-sensitive existing assertion, not a frontend regression diagnosis. The exact same full selected-target command passed on rerun: 8 export-bindings + 16 notifications-commands + 4 Windows recording-adapter tests. No Rust test/source was changed.
- `cargo test --manifest-path src-tauri/Cargo.toml -j 1`: exit 0, all existing unit/integration/doc-test targets passed, including the previously failing notification test and real isolated Windows ConPTY tests.
- All Cargo/Tauri invocations used `CARGO_BUILD_JOBS=1`; Cargo tests/Clippy also used `-j 1` explicitly.
- `git diff --check`: exit 0. Boundary search confirms direct Tauri calls occur only in the Notifications IPC wrapper, and notification production has no feature-implementation imports, web persistence, reminder command or runtime fixture.
- Test harness correction: the timer test now observes the exact Notifications 60-second interval and its matching clear, rather than counting unrelated Radix dismissal timeouts. The scenario passes and does not alter production timer behavior.
### Final frontend verification

- After the final production change, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: all exit 0, no lint warnings.
- Final full `pnpm test`: **97 files, 1,770 tests passed**, exit 0.
- The shell lifetime case was subsequently strengthened to mount the real Quit dialog and assert that it retains focus after the Notifications portal closes. `pnpm exec vitest run src/app/app-shell.test.tsx`: **5 tests passed**, exit 0. No production change followed the full frontend run.
- First `pnpm tauri build`: exit 0, release executable produced after 3m 24s. Final rebuild is required because the last activation-error copy change was made after the first build's frontend-assets step.
- Every untracked file was checked with `git diff --no-index --check -- /dev/null PATH`: no whitespace diagnostics. For a newly added file Git returns 1 for the content difference even with no whitespace violation; no output/whitespace diagnostic is the relevant result here. Strict UTF-8 decoding passed for FE-001, FE-010 and this plan.
- Checked steps that originally mention inert scaffolds record their completed tests/production equivalents; inert scaffolds and all scaffold-specific red steps were skipped as explicitly recorded above. Manual smoke remains the sole unperformed validation class.

### Final changed-file inventory

- `00-Docs/02-Frontend/FE-001-application-shell.md`
- `00-Docs/02-Frontend/FE-010-notification-center.md`
- `00-Docs/98-Plan/20260906-fe-010-notification-center.md`
- `src/app/app-router.test.tsx`
- `src/app/app-shell.test.tsx`
- `src/app/app-sidebar.test.tsx`
- `src/app/app-topbar.test.tsx`
- `src/app/app-topbar.tsx`
- `src/app/notification-entry.test.tsx`
- `src/app/notification-entry.tsx`
- `src/app/session-terminal-route.test.tsx`
- `src/app/session-terminal-route.tsx`
- `src/components/ui/popover.tsx`
- `src/features/notifications/index.ts`
- `src/features/notifications/notification-center.test.tsx`
- `src/features/notifications/notification-center.tsx`
- `src/features/notifications/use-notifications.test.ts`
- `src/features/notifications/use-notifications.ts`
- `src/features/sessions/session-route.test.tsx`
- `src/features/sessions/session-route.tsx`
- `src/lib/ipc/notifications.test.ts`
- `src/lib/ipc/notifications.ts`

### Final handoff

- Final `pnpm tauri build` with `CARGO_BUILD_JOBS=1`: **exit 0**, optimized build completed in **3m 31s**. Output: `F:/Self Projects/XWork/src-tauri/target/release/xwork.exe`. Its `beforeBuildCommand` rebuilt the final frontend assets successfully. `bundle.active = false` remains unchanged, so this is an executable and not an installer.
- Existing build warnings: Vite's >500 kB chunk advisory and the `.app` suffix advisory for `com.xwork.app`. Neither is a build failure; neither was hidden by changing configuration.
- Following the final shell-test enhancement, `pnpm format:check` initially requested a method-chain formatting change; `pnpm exec biome format --write src/app/app-shell.test.tsx` applied it. The final guarded formatter/lint/typecheck sequence all exited 0 with no warnings. This was formatting only and did not alter production assets.
- All 22 changed paths are listed above. Rust source, generated bindings, capabilities, configuration, manifests and lockfiles are unchanged. Both pre-existing authorized design inputs are preserved with the feature. Nothing is staged or committed by this implementer.
- **Ready for the coordinator's `Implement FE010` commit.** No implementation blocker remains. The existing BE-011 intermittent test observation remains documented for follow-up; the selected rerun and full Rust suite passed.
- **Native Windows checklist: all six rows remain pending.** No disposable Windows account/environment with an isolated application profile was established. No native smoke pass, installed-identifier toast pass, installer validation, or macOS validation is claimed. This plan records completed implementation/automated evidence while retaining that explicit validation limitation.