# FE-007 Tabs and Panes Implementation Plan

**Status:** Draft

**Goal:** Replace the nonempty-session placeholder with a complete tab strip
and one-to-four-pane workspace backed by the already-implemented BE-005 and
BE-006 contracts, including accessible reordering, split/resize/maximize,
content selection, close confirmation, reopen, local shortcuts, and stale
snapshot protection.

**Completion Criteria:**

- A nonempty `/sessions/:sessionId` renders the backend-owned tab order and
  active tab's pane tree without the FE-006 session header, while an empty
  session still renders the existing `SessionToolPicker` and route-owned
  rename/delete dialogs remain available from `Tab options`.
- Users can create, rename, select, reorder, close, and reopen tabs; split,
  focus, resize, maximize/restore, fill, and close panes; and reach every main
  operation by the keyboard behavior defined by FE-007.
- Close actions always inspect backend impact first, never bypass a newly
  required confirmation, and display the backend-measured process/file facts.
- BE-005 remains authoritative for tabs, layouts, active IDs, maximize state,
  and committed ratios. Only an in-progress resize ratio, interaction state,
  and the existing process-local recent-tools list live in React.
- All 19 named FE-007 test targets, all repository frontend checks, the
  production frontend build, and the Windows Tauri build pass. A targeted
  Windows manual smoke run demonstrates the integrated pointer, keyboard,
  resize, maximize, close/reopen, and WebView2 shortcut behavior.

**Architecture:** Extend the existing typed Sessions adapter, shared error/copy
helpers, fixtures, and route-detail hook, then build pure pane-tree and shortcut
helpers below one workspace mutation coordinator. Compose focused tab and pane
components inside `SessionWorkspace`; the route owns the full backend snapshot
and the two existing session dialogs. React renders returned snapshots rather
than predicting backend state, except that `PaneSplitHandle` owns a temporary
ratio while the user is dragging and commits it once at the end.

**Tech Stack:** React 19.2.8, TypeScript 7.0.2, Tailwind CSS 4.3.3, existing
source-owned shadcn/ui primitives over `radix-ui` 1.6.7, Lucide React 1.39.0,
Tauri API 2.11.1 through `src/lib/ipc/`, Vitest 4.1.11, Testing Library 16.3.3,
`react-resizable-panels` 4.12.3, `@dnd-kit/core` 6.3.1,
`@dnd-kit/sortable` 10.0.0, and `@dnd-kit/utilities` 3.2.2. On 2026-09-04,
`pnpm view` metadata confirmed that `react-resizable-panels@4.12.3` supports
React 18/19 and `@dnd-kit/sortable@10.0.0` accepts
`@dnd-kit/core@^6.3.0` while depending on `@dnd-kit/utilities@^3.2.2`.

**Sources:**

- Project instructions: `AGENTS.md`
- Planning rules: `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md` (Stage 8 — Session, tab and pane)
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md` (§8.1,
  §9.1–9.2, §10.2, §18, §19.3, and applicable Phase 1 criteria in §20)
- Frontend specification: `00-Docs/02-Frontend/FE-007-tabs-and-panes.md`
- Frontend prerequisites:
  `00-Docs/02-Frontend/FE-001-application-shell.md`,
  `00-Docs/02-Frontend/FE-006-session.md`, and
  `00-Docs/02-Frontend/FE-013-settings-terminal-cli-profiles.md`
- Backend specifications: `00-Docs/03-Backend/BE-005-sessions-runtime.md` and
  `00-Docs/03-Backend/BE-006-cli-profiles.md`
- Implemented generated contracts: `src/bindings/sessions/sessions.ts` and
  `src/bindings/terminal/cli-profiles.ts`
- Existing implementation plan and handoff:
  `00-Docs/98-Plan/20260904-fe-006-session.md`
- Wireframes: `00-Docs/01-Wireframe/04-Projects.html#panes-1`, `#panes-2`,
  `#panes-3`, `#panes-4`, `#panes-max`, `#pane-picker`, and
  `#dlg-delete-session`

## Scope

**In Scope:**

- Add the four exact frontend dependencies used for pane resizing and
  pointer/keyboard tab sorting, with the lockfile updated in the isolated
  dependency task.
- Add typed wrappers for all ten BE-005 tab/pane commands listed by FE-007,
  forwarding generated DTOs and camelCase arguments unchanged.
- Add pure pane-tree, ratio-conversion, tab-move, and local-shortcut helpers,
  including exact Phase 1 key combinations based on `KeyboardEvent.code`.
- Coordinate structural mutations, independent active-tab/active-pane
  mutations, per-split ratio queues, retries, close impact/confirmation, and
  backend-specific recovery in one sessions-local hook.
- Implement the tab strip, sortable tab, options menu, rename-tab dialog, and
  close-target dialog with the exact copy, focus, menu fallback, and accessible
  tab behaviors in FE-007.
- Recursively render one-to-four-pane layouts, resizable split handles,
  maximize without unmounting, pane headers/actions, the empty-pane picker,
  and placeholders for content owned by later features.
- Replace `SessionWorkspacePlaceholder` in the nonempty route branch with
  `SessionWorkspace`, move session rename/delete entry points into `Tab
  options`, remove the nonempty-branch header, and protect `applyDetail`
  against older revisions.
- Cover every named behavior with isolated unit/component tests using generated
  contracts, deterministic fixtures, mocked adapter calls, controlled promises,
  and DOM events only.

**Out of Scope:**

- FE-008 terminal rendering; PTY or process creation; terminal input, output,
  search, resize, status dots, or unseen-output dots. `toolSelection`,
  `terminal`, and `file` content render placeholders only.
- FE-014 configurable shortcut settings, conflict detection, macOS Command-key
  mapping, previous/next-tab shortcuts, or directional pane-focus shortcuts.
- FE-016 File Explorer, recent files, `Browse files…`, and the tab-strip File
  Explorer toggle; FE-017 source/file rendering.
- Session creation and empty-session tool selection, session/sidebar/project
  composition, and session rename/delete business flows already delivered by
  FE-006. FE-007 only relocates their nonempty-session triggers.
- Home, search, notification, notes, calendar, new Rust behavior, migrations,
  capabilities, Tauri configuration, generated binding edits, persistent
  browser storage, automated desktop end-to-end tests, macOS validation, and
  Git commits.

## Global Constraints

- Write code, identifiers, UI text, and code comments in English. Keep Markdown
  UTF-8. Every function, method, callback, helper, component, and test added or
  changed has a short purpose comment; reasoning comments cover mutation
  serialization, revision ordering, resize synchronization, and close races.
- React owns presentation and temporary interaction state only. BE-005 owns
  tab order, pane trees, committed ratios, active tab/pane IDs, maximize state,
  close impact, and reopen availability; BE-006 owns tool availability.
- All backend calls go through `src/lib/ipc/`. Components do not import Tauri,
  access the filesystem/database/process environment, or duplicate generated
  DTOs. Nothing under `src/bindings/` is edited manually.
- Add these exact direct dependency entries and no version ranges:
  `"react-resizable-panels": "4.12.3"`,
  `"@dnd-kit/core": "6.3.1"`,
  `"@dnd-kit/sortable": "10.0.0"`, and
  `"@dnd-kit/utilities": "3.2.2"`.
- Each `PaneLayoutNodeDto.kind === "split"` renders exactly one v4 `Group`, two
  `Panel` children, and one `Separator`. The FE-007 specification uses the v3
  names `PanelGroup`, `PanelResizeHandle`, and `direction`; under the pinned
  4.12.3 API these map directly to `Group`, `Separator`, and `orientation`.
  `SplitAxisDto.vertical` maps to `orientation="horizontal"` and
  `SplitAxisDto.horizontal` maps to `orientation="vertical"`. Clamp committed
  ratios to `1000..9000` basis points.
- Never use `useDefaultLayout` with a browser `storage`, or any other library
  persistence hook. Do not add `localStorage`, `sessionStorage`, or
  `indexedDB`; runtime layout persistence belongs to BE-005 and ends on Quit.
- A structural-operation slot serializes `create_tab`, `rename_tab`,
  `move_tab`, `split_pane`, `set_maximized_pane`, `select_pane_tool`, reopen,
  and close. Activation calls remain deduplicated but independent; ratio
  commits are serialized independently per `splitId`.
- Every successful command applies its returned `SessionDetailDto` directly.
  `use-session-detail.ts` compares decimal-string revisions with the existing
  `compareSessionRevisions` behavior and ignores older snapshots. No tab,
  active ID, layout, or reorder result is applied optimistically.
- The only optimistic visual value is the ratio being dragged. One resize
  commits once when pointer interaction ends; keyboard resize commits once
  after settling; `Esc` and `invalidSplitRatio` restore the latest backend
  ratio through the panel-group imperative handle.
- Maximizing a pane must not unmount any pane. The chosen pane overlays the
  layout with `absolute inset-0`; other panes and split handles remain mounted
  but become invisible, ignore pointer input, and leave the natural Tab order.
- Every tab/pane close starts with `get_close_impact`. Send `confirmed: true`
  only after the user activates the destructive dialog action, and render a
  fresh `confirmationRequired.impact` before asking again.
- Use one `useToolCatalog()` instance per `SessionWorkspace`. Reuse
  `recordToolUse`, `readRecentTools`, `formatUsedAt`,
  `isProfileUnavailable`, and `describeToolCommand`; do not import settings
  feature implementation or start a process.
- Local shortcuts use Ctrl on Windows and match `KeyboardEvent.code`, not
  `key`: `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+T`, `Ctrl+Backslash`,
  `Ctrl+Alt+Backslash`, `Ctrl+Shift+M`, and `Ctrl+Shift+W`. Ignore repeats,
  composition/IME, editable targets, open dialogs, disabled actions, and extra
  modifiers; call `preventDefault` only for an available matched action.
- Do not use color as the only state signal. Tabs use `aria-selected`; panes
  use a visible border plus `aria-current`; drag sorting has the menu/keyboard
  equivalent; icon-only controls have accessible names and tooltips; reduced
  motion preserves operation and focus order.
- Tests never access real XWork data, project folders, profiles, credentials,
  processes, browser storage, or OS resources. Mock only the typed adapters and
  use the fixed `D:\Fixtures\alpha` fixture path. Development and verification
  are Windows-only; defer macOS checks to release preparation.

## Assumptions, Risks, and Blockers

**Assumptions:**

- BE-005 and BE-006, their generated TypeScript bindings, FE-001, FE-006, and
  FE-013 are already implemented and remain the source of truth.
- `SessionDetailDto.tabs.length > 0` normally has a valid `activeTabId`; the
  specified defensive fallback renders the first tab and requests one refresh.
- BE-005 does not produce `terminal` or `file` content during this stage, but
  placeholders still handle those generated union members exhaustively.
- `PanelGroup`'s imperative API and callbacks in 4.12.3 are the seam used to
  synchronize/cancel resize state; dnd-kit sensors are tested through their
  public DOM interactions and callbacks rather than private library state.

**Risks:**

- A late activation or resize response can overwrite a newer structural
  snapshot. Task 2 adds explicit older-revision coverage before concurrent
  mutation paths are composed.
- Recursive axis mapping and percent/basis-point conversion are easy to invert.
  Tasks 3 and 6 test all four documented layouts and both axes independently.
- Resize callbacks can issue duplicate commits or snap during an external
  update. Task 6 separates drag-local state, per-split serialization, cancel,
  settle, and backend re-sync cases.
- Pointer-only sorting would violate accessibility requirements. Task 7 uses
  `KeyboardSensor` and tests menu moves, tablist navigation, keyboard sorting,
  cancellation, and unchanged-position drops.
- Close impact may change after inspection. Tasks 4 and 7 test the full
  inspect/commit/refreshed-confirmation sequence and retryable lifecycle errors.
- Hiding panes by conditionally rendering them would destroy future terminal
  measurements. Task 6 asserts that every pane stays mounted while only focus,
  visibility, and pointer behavior change.
- `Ctrl+W` can reach WebView2 and close the window if matching or enablement is
  wrong. Task 8 tests `preventDefault` precisely and the final smoke checklist
  verifies the actual desktop window.

**Blockers:** None. FE-007, BE-005, and BE-006 each report no unresolved
questions for this slice. The resize library's v3/v4 naming mismatch is
resolved mechanically by the official 4.0 migration mapping recorded above;
it does not change UI behavior, state ownership, or backend contracts.

## Dependency Order

1. Task 1 pins the resize/sort packages → enables their components in Tasks 6
   and 7.
2. Task 2 extends IPC, shared copy, fixtures, and revision safety → enables all
   command orchestration and component tests.
3. Task 3 establishes pure layout and shortcut rules → enables Tasks 4, 6, 7,
   and 8 without embedding business decisions in components.
4. Task 4 centralizes mutations and close recovery → enables the tab and pane
   controls to stay presentational.
5. Task 5 builds pane leaves and content states → enables recursive layout in
   Task 6.
6. Tasks 6 and 7 build the pane and tab branches independently → enable final
   workspace composition in Task 8.
7. Task 8 replaces the route placeholder and joins all behavior → enables the
   slice-wide verification and desktop smoke checks in Task 9.

---

### Task 1: Pin the Pane and Sorting Dependencies

**Outcome:** The manifest and lockfile contain exactly the four FE-007 direct
dependencies, and the installed graph resolves the verified React 19/core
compatibility without changing unrelated packages.

**Depends On:** None.

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: pnpm 11.25.0, React 19.2.8, React DOM 19.2.8.
- Produces: imports from `react-resizable-panels@4.12.3`,
  `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, and
  `@dnd-kit/utilities@3.2.2`.

- [ ] **Step 1: Capture the dependency baseline**

  Review the current direct dependencies and preserve every unrelated manifest
  and lockfile entry. This task is the isolated dependency update required by
  `01-TechStack.md`.

- [ ] **Step 2: Install exact direct versions**

  Run:

  ```powershell
  pnpm add --save-exact react-resizable-panels@4.12.3 @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2
  ```

  Expected: `package.json` contains the four exact string values stated in the
  Global Constraints and pnpm updates only the dependency graph needed for
  them.

- [ ] **Step 3: Verify the resolved direct graph**

  Run:

  ```powershell
  pnpm list react-resizable-panels @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities --depth 0
  ```

  Expected: all four packages appear once at versions `4.12.3`, `6.3.1`,
  `10.0.0`, and `3.2.2`, with no peer dependency warning.

### Task 2: Extend the Typed Boundary, Shared Copy, Fixtures, and Revision Guard

**Outcome:** FE-007 can call all required generated BE-005 operations, classify
their UI-visible failures, build target-neutral close facts, construct isolated
tab/pane test snapshots, and reject older mutation responses at the route.

**Depends On:** None.

**Files:**

- Modify/Test: `src/lib/ipc/sessions.ts`
- Modify/Test: `src/lib/ipc/sessions.test.ts`
- Modify/Test: `src/lib/utils/session-copy.ts`
- Modify/Test: `src/lib/utils/session-copy.test.ts`
- Modify/Test: `src/features/sessions/sessions-test-fixture.ts`
- Modify/Test: `src/features/sessions/use-session-detail.ts`
- Modify/Test: `src/features/sessions/use-session-detail.test.ts`

**Interfaces:**

- Consumes: generated `SessionDetailDto`, `SplitDirectionDto`,
  `CloseTargetDto`, `CloseImpactDto`, `CloseResultDto`, and `SessionsError`;
  existing `invokeSessions`, `compareSessionRevisions`,
  `validateSessionName`, `SESSION_NAME_REQUIREMENT`, and FE-006 fixture IDs.
- Produces: `createTab(sessionId)`, `renameTab(sessionId, tabId, name)`,
  `moveTab(sessionId, tabId, beforeTabId)`, `setActiveTab(sessionId, tabId)`,
  `setActivePane(sessionId, tabId, paneId)`,
  `splitPane(sessionId, tabId, paneId, direction)`,
  `setSplitRatio(sessionId, tabId, splitId, ratioBasisPoints)`,
  `setMaximizedPane(sessionId, tabId, paneId)`,
  `selectPaneTool(sessionId, tabId, paneId, profileId)`, and
  `reopenLastClosedTab(sessionId)`; `buildCloseImpactFacts`; FE-007 copy
  constants; updated failure classification; multi-tab/multi-pane/close/catalog
  fixture factories; revision-monotonic `applyDetail`.

- [ ] **Step 1: Add focused failing adapter, copy, fixture-consumer, and stale-response tests**

  Assert every command name and camelCase argument, including explicit `null`
  for `beforeTabId` and `paneId`; typed `IpcCallError` propagation; shared facts
  for session/tab/pane with singular/plural/`+n more`; unchanged FE-006 delete
  facts; exact FE-007 messages and retry policy; and `applyDetail` accepting a
  newer/equal route snapshot while ignoring an older revision.

- [ ] **Step 2: Verify the focused tests fail for named missing behavior**

  Run:

  ```powershell
  pnpm test src/lib/ipc/sessions.test.ts src/lib/utils/session-copy.test.ts src/features/sessions/use-session-detail.test.ts
  ```

  Expected: Vitest discovers all three files; assertions fail on missing wrapper
  exports/close-fact copy and because the current `applyDetail` accepts an older
  revision.

- [ ] **Step 3: Implement the minimum boundary and shared changes**

  Forward DTOs without remapping, factor existing delete facts through
  `buildCloseImpactFacts`, add exact tab/pane copy, classify
  `paneLimitReached`, `invalidMove`, and `invalidSplitRatio` as FE-007 requires,
  expand deterministic fixtures, and compare before publishing a detail
  snapshot. Keep same-revision application valid so the direct response can
  replace an event-updated summary at that revision.

- [ ] **Step 4: Verify the boundary and revision behavior**

  Run the Step 2 command.

  Expected: all three files pass; their mocks observe the exact command payloads
  and the route remains on the greatest applied decimal revision.

### Task 3: Implement Pure Pane-Tree, Ratio, Tab-Move, and Shortcut Rules

**Outcome:** Framework-independent helpers define every structural calculation
and all seven Phase 1 shortcut matches/labels used by later components.

**Depends On:** Task 2.

**Files:**

- Create/Test: `src/features/sessions/session-layout.ts`
- Create/Test: `src/features/sessions/session-layout.test.ts`
- Create/Test: `src/features/sessions/workspace-shortcuts.ts`
- Create/Test: `src/features/sessions/workspace-shortcuts.test.ts`

**Interfaces:**

- Consumes: generated `PaneLayoutNodeDto` and `PaneDto`.
- Produces: `PANE_LIMIT`, `MIN_RATIO_BASIS_POINTS`,
  `MAX_RATIO_BASIS_POINTS`, `flattenPanes`, `countPanes`, `findPane`,
  `paneIndex`, `clampRatioBasisPoints`, `ratioToPercent`,
  `percentToRatioBasisPoints`, `resolveMoveBeforeTabId`,
  `WorkspaceShortcutId`, `WorkspaceShortcut`, `WORKSPACE_SHORTCUTS`,
  `matchWorkspaceShortcut`, and `shortcutLabel` with the signatures in FE-007.

- [ ] **Step 1: Add failing pure unit tests**

  Cover first-before-second leaf order, one-to-four-pane trees, missing pane
  index `0`, ratio boundaries and round trips, each drag destination including
  unchanged/end positions, exact `code`/modifier matches, rejection of extra
  modifiers, and all display labels including `Ctrl Alt \`.

- [ ] **Step 2: Verify the modules are discovered and missing**

  Run:

  ```powershell
  pnpm test src/features/sessions/session-layout.test.ts src/features/sessions/workspace-shortcuts.test.ts
  ```

  Expected: both files are discovered and fail because the two modules/exports
  do not exist yet, not because zero tests matched.

- [ ] **Step 3: Implement the pure helpers**

  Traverse the tagged binary tree without mutation; use exact integer basis
  points at the backend boundary; compute `beforeTabId` from the post-removal
  destination so same-position drops produce no operation; and match shortcut
  `code`, Ctrl, Alt, Shift, and absence of extra modifiers exactly.

- [ ] **Step 4: Verify all pure contracts**

  Run the Step 2 command.

  Expected: both files pass, including every edge position and shortcut.

### Task 4: Coordinate Workspace Mutations and Close Recovery

**Outcome:** One hook applies returned snapshots, serializes only operations
that conflict, exposes close dialog state, and converts every specified BE-005
race/error into the correct refresh, message, retry, lock, or silent exit.

**Depends On:** Tasks 2 and 3.

**Files:**

- Create/Test: `src/features/sessions/use-workspace-mutations.ts`
- Create/Test: `src/features/sessions/use-workspace-mutations.test.ts`

**Interfaces:**

- Consumes: Task 2's Sessions wrappers/failure helpers/fixtures; Task 3's
  `PANE_LIMIT`, ratio clamp, and move-target calculation; existing
  `recordToolUse`; `SessionDetailDto`, `CloseTargetDto`, and
  `SplitDirectionDto`; callbacks `onApplyDetail` and `onRefresh`.
- Produces: `WorkspaceOperation`, `PendingClose`, `WorkspaceMutations`, and
  `useWorkspaceMutations` with the exact fields and methods in FE-007.
  Tests inject adapter functions and controlled promises at module boundaries;
  they do not run Tauri or processes.

- [ ] **Step 1: Add failing hook tests for concurrency and every recovery branch**

  Assert one structural slot; independent, deduplicated activation; per-split
  ordered commits; no-op same-position tab moves; successful snapshot apply;
  selection recency only after success; impact-then-close with and without a
  dialog; refreshed `confirmationRequired`; cancellation; and the specified
  handling of `paneLimitReached`, `noClosedTab`, `invalidMove`, `paneNotEmpty`,
  missing targets, `closeInProgress`, `contentLifecycleFailed`,
  `runtimeShuttingDown`, and `unauthorizedWindow`.

- [ ] **Step 2: Verify the hook target fails on the missing module**

  Run:

  ```powershell
  pnpm test src/features/sessions/use-workspace-mutations.test.ts
  ```

  Expected: Vitest discovers the file and fails because
  `useWorkspaceMutations` and its public state/actions do not exist.

- [ ] **Step 3: Implement the coordinator with operation-specific recovery**

  Keep one structural promise slot, a latest-target dedupe for each activation
  kind, and one chained queue per split. Derive no backend-owned state locally.
  On stale-target errors refresh and stop; on `paneLimitReached`/`invalidMove`
  refresh and show exact copy; on `paneNotEmpty` refresh silently; on
  `closeInProgress` lock the workspace until a new snapshot; and on
  `runtimeShuttingDown` clear dialogs/failures silently.

- [ ] **Step 4: Verify orchestration and retry semantics**

  Run the Step 2 command.

  Expected: all hook tests pass, including rapid double actions, interleaved
  response order, refreshed confirmation, and per-split commit ordering.

### Task 5: Build Pane Leaves, Content Picker, and Deferred Content States

**Outcome:** Each pane has an accessible header and actions, derives its visual
identity from the shared catalog without depending on it for content truth, and
renders either the complete empty-pane picker or a precise later-feature
placeholder.

**Depends On:** Tasks 2–4.

**Files:**

- Create/Test: `src/features/sessions/session-pane.tsx`
- Create/Test: `src/features/sessions/session-pane.test.tsx`
- Create/Test: `src/features/sessions/pane-content-picker.tsx`
- Create/Test: `src/features/sessions/pane-content-picker.test.tsx`
- Create/Test: `src/features/sessions/pane-content-placeholder.tsx`
- Create/Test: `src/features/sessions/pane-content-placeholder.test.tsx`

**Interfaces:**

- Consumes: generated `PaneDto`, `PaneContentDto`, `CliProfileDto`, Task 3's
  pane-count/index/shortcut-label helpers, callbacks for activate/split/
  maximize/close/select, `rootPath`, the shared `ToolCatalogData`, existing
  recent-tools functions, and existing tool-card availability/copy helpers.
- Produces: `SessionPane`, `PaneContentPicker`, and `PaneContentPlaceholder`
  props internal to `src/features/sessions/`; no app-level export.

- [ ] **Step 1: Add failing pane/content component tests**

  Assert all four content-union identities, missing-profile neutral fallback,
  root-path/null behavior, active border plus `aria-current`, focus activation,
  four-pane split disabling and limit tooltip, maximize/restore labels, exact
  shortcut tooltips, recent-tool ordering, catalog order/loading/error/retry,
  unavailable/check/settings behavior, the inert FE-016 File column, and exact
  `toolSelection`/`terminal`/`file` placeholder copy.

- [ ] **Step 2: Verify all three targets fail on missing components**

  Run:

  ```powershell
  pnpm test src/features/sessions/session-pane.test.tsx src/features/sessions/pane-content-picker.test.tsx src/features/sessions/pane-content-placeholder.test.tsx
  ```

  Expected: all three files are discovered and fail because their component
  modules are absent.

- [ ] **Step 3: Implement presentational pane and content branches**

  Keep control decisions in props, use semantic disabled states and tooltip
  copy, render `Recent` only when populated, reuse the one workspace catalog,
  and call selection only for available profiles. Exhaustively switch on
  `PaneContentDto.kind`; do not create a terminal, file reader, or storage.

- [ ] **Step 4: Verify pane leaves and picker states**

  Run the Step 2 command.

  Expected: all component tests pass with no process, filesystem, settings
  implementation, or real profile access.

### Task 6: Render Recursive Resizable Layouts and Non-Destructive Maximize

**Outcome:** Every backend pane tree renders with the correct physical axis and
initial ratio, split handles commit exactly once, and maximizing hides but does
not unmount the rest of the tree.

**Depends On:** Tasks 1, 3–5.

**Files:**

- Create/Test: `src/features/sessions/pane-layout.tsx`
- Create/Test: `src/features/sessions/pane-layout.test.tsx`
- Create/Test: `src/features/sessions/pane-split-handle.tsx`
- Create/Test: `src/features/sessions/pane-split-handle.test.tsx`

**Interfaces:**

- Consumes: `PanelGroup`, `Panel`, `PanelResizeHandle`, and supported imperative
  group API from `react-resizable-panels@4.12.3`; generated
  `PaneLayoutNodeDto`; Task 3's ratio helpers; Task 5's `SessionPane`; mutation
  callbacks for activation, split, ratio commit, maximize, selection, and close.
- Produces: `PaneLayout` and `PaneSplitHandle` sessions-local props; one
  temporary ratio per active handle; labeled focusable separators.

- [ ] **Step 1: Add failing layout and resize tests**

  Render the one-, two-, three-, and four-pane fixture trees; assert
  `vertical` means left/right and `horizontal` means up/down, `first` precedes
  `second`, initial percent matches basis points, pointer completion commits
  one clamped integer, keyboard settling commits once, `Esc` commits nothing
  and restores, backend updates re-sync while idle/after drag, and
  `invalidSplitRatio` restores. In maximize state assert every pane remains in
  the DOM while other panes/separators become inert and leave the Tab order.

- [ ] **Step 2: Verify both component targets fail on missing modules**

  Run:

  ```powershell
  pnpm test src/features/sessions/pane-layout.test.tsx src/features/sessions/pane-split-handle.test.tsx
  ```

  Expected: both files are discovered and fail because the recursive renderer
  and split handle do not exist.

- [ ] **Step 3: Implement recursive rendering and resize synchronization**

  Give every split its own two-panel `Group` and 8px `Separator`; do not use
  `useDefaultLayout` or browser-backed storage. Pass v4 percentage strings for
  panel sizes (the first panel starts at `ratioBasisPoints / 100%`, the second
  at its complement, with the documented 10%/90% limits). Preserve local drag
  state across external snapshots until completion, then let the newest backend
  ratio win. Implement maximize entirely with positioning/visibility/pointer/
  focus attributes, including the exact pane-index badge.

- [ ] **Step 4: Verify axes, commits, cancellation, and mounting**

  Run the Step 2 command.

  Expected: both files pass; tests observe one commit per completed interaction,
  correct physical axes, backend restoration, and unchanged pane mount counts.

### Task 7: Build Accessible Sortable Tabs and Target Dialogs

**Outcome:** The tab strip supports pointer and keyboard selection/reordering,
menu equivalents, create/rename/close/reopen actions, focus restoration, and
automatic active-tab scrolling without predicting the backend order.

**Depends On:** Tasks 1–4.

**Files:**

- Create/Test: `src/features/sessions/session-tab.tsx`
- Create/Test: `src/features/sessions/session-tab.test.tsx`
- Create/Test: `src/features/sessions/session-tab-strip.tsx`
- Create/Test: `src/features/sessions/session-tab-strip.test.tsx`
- Create/Test: `src/features/sessions/tab-options-menu.tsx`
- Create/Test: `src/features/sessions/tab-options-menu.test.tsx`
- Create/Test: `src/features/sessions/rename-tab-dialog.tsx`
- Create/Test: `src/features/sessions/rename-tab-dialog.test.tsx`
- Create/Test: `src/features/sessions/close-target-dialog.tsx`
- Create/Test: `src/features/sessions/close-target-dialog.test.tsx`

**Interfaces:**

- Consumes: dnd-kit `DndContext`, pointer/keyboard sensors, sortable context,
  horizontal strategy, keyboard coordinates, and CSS transform utilities;
  generated tabs/content/close impact; Task 2 copy/validation; Task 3 move and
  shortcut helpers; Task 4 mutation state/actions; route callbacks
  `onRenameSession`/`onDeleteSession`.
- Produces: `SessionTab`, `SessionTabStrip`, `TabOptionsMenu`,
  `RenameTabDialog`, and `CloseTargetDialog` internal props/events.

- [ ] **Step 1: Add failing tab/menu/dialog tests**

  Assert content icons, full-name titles, close labels, selected and roving
  tabindex state; Arrow/Home/End focus movement and Enter/Space selection;
  one create/select call, no call for the current tab, pointer and keyboard
  reorder payloads, cancellation/no-op drops, reduced-motion behavior, active
  tab `scrollIntoView`; menu grouping/disabled endpoints/destructive styling;
  rename prefill/select/Unicode validation/backend error/focus return; and both
  close target wordings, singular/plural/bounded facts, cancel, second
  confirmation, retry, pending, and focus return.

- [ ] **Step 2: Verify all five targets fail on missing components**

  Run:

  ```powershell
  pnpm test src/features/sessions/session-tab.test.tsx src/features/sessions/session-tab-strip.test.tsx src/features/sessions/tab-options-menu.test.tsx src/features/sessions/rename-tab-dialog.test.tsx src/features/sessions/close-target-dialog.test.tsx
  ```

  Expected: Vitest discovers all five files and fails on their missing modules,
  not on an undiscovered test glob.

- [ ] **Step 3: Implement the strip, tabs, menus, and dialogs**

  Render a horizontal non-wrapping `role="tablist"`; separate sortable drag
  handles from tab close buttons; calculate but do not display an optimistic
  order; make menu moves call the same target calculation; and scroll on
  returned active-ID/order changes. Reuse Radix dialog/menu focus hooks and the
  existing FE-006 visual patterns. Keep `Tab options` scoped to the active tab
  and expose session intents only to the route.

- [ ] **Step 4: Verify all tab and dialog behaviors**

  Run the Step 2 command.

  Expected: all five files pass for pointer, keyboard, menu, validation,
  confirmation, accessibility, focus, and no-op cases.

### Task 8: Compose Workspace Shortcuts and Replace the Route Placeholder

**Outcome:** The nonempty session branch is the full-height FE-007 workspace,
all child actions share one catalog and mutation coordinator, local shortcuts
obey enablement/dialog/editing rules, and the existing empty-session and
session-lifecycle branches remain intact.

**Depends On:** Tasks 2–7.

**Files:**

- Create/Test: `src/features/sessions/use-workspace-shortcuts.ts`
- Create/Test: `src/features/sessions/use-workspace-shortcuts.test.ts`
- Create/Test: `src/features/sessions/session-workspace.tsx`
- Create/Test: `src/features/sessions/session-workspace.test.tsx`
- Modify/Test: `src/features/sessions/session-route.tsx`
- Modify/Test: `src/features/sessions/session-route.test.tsx`
- Delete: `src/features/sessions/session-workspace-placeholder.tsx`

**Interfaces:**

- Consumes: Task 3 shortcut matcher; Task 4 `WorkspaceMutations`; Tasks 5–7
  components; one existing `useToolCatalog`; `SessionDetailDto`; the route's
  `detail.applyDetail`, `detail.refresh`, loaded project root, and existing
  session dialog state.
- Produces: `WorkspaceShortcutHandlers`, `useWorkspaceShortcuts`, and the exact
  public `SessionWorkspace({ detail, rootPath, onApplyDetail, onRefresh,
  onRenameSession, onDeleteSession })` boundary from FE-007. No `src/app/` or
  cross-feature export is added.

- [ ] **Step 1: Add failing shortcut, workspace, and route regression tests**

  Assert all seven handlers; ignored input/textarea/contenteditable,
  `isComposing`, repeat, extra modifiers, disabled action, and open-dialog
  cases; exact `preventDefault`; one catalog mount; active-tab fallback plus
  one refresh; structural busy/error/try-again/closing state; emitted session
  intents; and route branches where nonempty content loses the header/padding
  while empty content retains the FE-006 picker/header/dialog behavior.

- [ ] **Step 2: Verify the integration tests fail on the placeholder**

  Run:

  ```powershell
  pnpm test src/features/sessions/use-workspace-shortcuts.test.ts src/features/sessions/session-workspace.test.tsx src/features/sessions/session-route.test.tsx
  ```

  Expected: all three files are discovered; the new shortcut/workspace modules
  are missing and the route still renders `SessionWorkspacePlaceholder` plus
  the nonempty-branch session header.

- [ ] **Step 3: Compose without adding another backend state owner**

  Build the active tab/pane defensively from `detail`, wire all actions through
  one mutation hook, mount one catalog, open feature dialogs in the workspace,
  and enable shortcuts only when their target/action exists and no dialog or
  session-close lock is active. Refactor the route into separate empty and
  nonempty wrappers: keep its existing loading/error/missing/navigation and
  lifecycle dialog ownership, pass rename/delete intents into the workspace,
  and delete the old placeholder.

- [ ] **Step 4: Verify workspace integration and FE-006 regression behavior**

  Run the Step 2 command.

  Expected: all three files pass; a nonempty route renders tabs/panes with no
  header, an empty route remains unchanged, shortcuts never leak through a
  dialog/editable control, and only returned backend snapshots update layout.

### Task 9: Run Slice-Wide Verification and Windows Smoke Checks

**Outcome:** Every FE-007 test and repository gate passes, prohibited state and
boundary changes are absent, the packaged desktop builds, and the real Windows
workflow is manually demonstrated without adding desktop end-to-end tests.

**Depends On:** Tasks 1–8.

**Files:**

- Modify only if verification exposes a defect: files already listed in Tasks
  1–8 and their colocated tests.
- Update during authorized implementation: this plan's checklist, Deviations
  and Decisions, and Outcome only; do not rewrite completed task history.

**Interfaces:**

- Consumes: all FE-007 internal interfaces, existing BE-005/BE-006 runtime,
  generated bindings, repository quality scripts, `pnpm tauri build`, and
  `pnpm tauri dev`.
- Produces: passing automated evidence and a recorded targeted Windows smoke
  result. It produces no automated desktop test and touches no real user data.

- [ ] **Step 1: Run every focused FE-007 target together**

  Run:

  ```powershell
  pnpm test src/lib/ipc/sessions.test.ts src/lib/utils/session-copy.test.ts src/features/sessions/use-session-detail.test.ts src/features/sessions/session-layout.test.ts src/features/sessions/workspace-shortcuts.test.ts src/features/sessions/use-workspace-mutations.test.ts src/features/sessions/session-pane.test.tsx src/features/sessions/pane-content-picker.test.tsx src/features/sessions/pane-content-placeholder.test.tsx src/features/sessions/pane-layout.test.tsx src/features/sessions/pane-split-handle.test.tsx src/features/sessions/session-tab.test.tsx src/features/sessions/session-tab-strip.test.tsx src/features/sessions/tab-options-menu.test.tsx src/features/sessions/rename-tab-dialog.test.tsx src/features/sessions/close-target-dialog.test.tsx src/features/sessions/use-workspace-shortcuts.test.ts src/features/sessions/session-workspace.test.tsx src/features/sessions/session-route.test.tsx
  ```

  Expected: Vitest discovers all 19 FE-007-listed files, including the extended
  FE-006 `use-session-detail` regression target, and every assertion passes.

- [ ] **Step 2: Run all automated and negative-scope checks**

  Run every command in Final Verification.

  Expected: formatter, linter, type checker, full test suite, frontend build,
  negative boundary/storage searches, and Windows Tauri build all pass.

- [ ] **Step 3: Perform the targeted Windows smoke checklist**

  Use one disposable project/session with no valuable unsaved work. Follow the
  Manual Windows Smoke Check with `pnpm tauri dev`; do not improvise process or
  file blockers that BE-007/FE-008/FE-017 have not implemented yet.

- [ ] **Step 4: Record evidence without rewriting history**

  Mark tasks accurately, append material deviations/decisions, and change
  Status only when required automated checks and the required manual smoke run
  are complete. Record exact commands/results and remaining FE-008/FE-016/
  FE-017 placeholder limitations under Outcome.

## Final Verification

Run on Windows after all implementation tasks are complete.

| Scope | Command | Expected Result |
|---|---|---|
| Dependency graph | `pnpm list react-resizable-panels @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities --depth 0` | Direct versions are exactly `4.12.3`, `6.3.1`, `10.0.0`, and `3.2.2`; no peer warning |
| Frontend format | `pnpm format:check` | Pass with no formatting diff |
| Frontend lint | `pnpm lint` | Pass with no errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| FE-007 focused tests | Task 9 Step 1 command | All 19 named files are discovered and pass |
| All frontend tests | `pnpm test` | Every repository unit/component test passes |
| Frontend production build | `pnpm build` | Vite production build succeeds |
| No browser/panel persistence | `$hits = @(rg -n 'localStorage|sessionStorage|indexedDB|useDefaultLayout|autoSaveId' src); if ($hits.Count -gt 0) { $hits; exit 1 }` | Exit code 0; no forbidden browser or resize-library persistence API occurs in `src/` |
| No handwritten Sessions DTO | `$hits = @(rg -n 'type (PaneContentDto|PaneDto|PaneLayoutNodeDto|TabDto|SessionDetailDto|CloseTargetDto|CloseImpactDto|SessionsError)|interface (PaneContentDto|PaneDto|PaneLayoutNodeDto|TabDto|SessionDetailDto|CloseTargetDto|CloseImpactDto|SessionsError)' src --glob '!src/bindings/**'); if ($hits.Count -gt 0) { $hits; exit 1 }` | Exit code 0; generated bindings remain the only DTO definitions |
| No direct Tauri access in session UI | `$hits = @(rg -n '@tauri-apps|\binvoke\s*\(|\blisten\s*\(' src/features/sessions); if ($hits.Count -gt 0) { $hits; exit 1 }` | Exit code 0; session components/hooks use `src/lib/ipc/` only |
| No forbidden cross-feature import | `$hits = @(rg -n '@/features/settings' src/features/sessions); if ($hits.Count -gt 0) { $hits; exit 1 }` | Exit code 0; tool catalog is consumed through sessions-local/shared contracts |
| Correct resize-library v4 API | `$bad = @(rg -n 'PanelGroup|PanelResizeHandle|\bdirection=' src/features/sessions); if ($bad.Count -gt 0) { $bad; exit 1 }; rg -n 'Group|Panel|Separator|\borientation=' src/features/sessions/pane-layout.tsx src/features/sessions/pane-split-handle.tsx` | Exit code 0; implementation uses the pinned v4 names and shows their expected imports/props |
| Windows Tauri build | `pnpm tauri build` | Desktop bundle succeeds with the new packaged frontend dependencies |

Before implementation, record the baseline output of
`git status --short -- src-tauri src/bindings src/app`. After implementation,
compare the same paths and verify FE-007 introduced no Rust, generated binding,
app-composition, capability, or Tauri configuration change. Preserve and
report any pre-existing user change rather than treating it as FE-007 output.

## Manual Windows Smoke Check

Run `pnpm tauri dev` with one disposable available project. Use existing Stage
8 tool-selection state only; do not use a real project with unsaved work.

1. Open an empty session and a session with a selected tool. Expected: the empty
   route still shows its FE-006 header and tool picker; the nonempty route has
   no session header and shows a 38px tab strip plus one pane, while the
   breadcrumb still carries the project/session names.
2. Create three tabs with the button and `Ctrl+T`; rename one to a long Unicode
   name, cancel once, then submit. Expected: each action happens once, focus
   returns correctly, names clip with the full `title`, and a new empty pane
   shows `What goes here?`.
3. Navigate the tablist with ArrowLeft/ArrowRight/Home/End and select with
   Enter/Space. Reorder by pointer, dnd-kit keyboard controls, and `Move tab
   left/right`; cancel one keyboard drag with `Esc`. Expected: focus and active
   selection remain distinct, equivalent moves agree, and cancel/no-op never
   changes backend order.
4. Split right and down until the active tab has four panes. Expected: the
   visible geometry matches `#panes-2` through `#panes-4`, each new pane is
   active, both split buttons become disabled with the limit tooltip, and a
   split shortcut at the limit shows `A tab can hold up to 4 panes.` without a
   fifth pane.
5. Drag at least two split handles, resize one by keyboard, and cancel another
   with `Esc`; switch tabs and return. Expected: completed ratios remain at the
   backend values, canceled resize restores, separators have the correct
   cursor/accessible label, and no layout snaps to an old response.
6. Maximize a pane with its button and `Ctrl+Shift+M`, Tab through controls,
   then restore. Expected: the exact `Maximized · n of 4 panes · Ctrl Shift M
   to restore` badge appears, hidden panes keep their layout/mount state, hidden
   separators cannot receive focus, and restore returns the previous ratios.
7. In an empty pane, inspect recent tools, catalog ordering, and the disabled
   File column. Select an available profile and recheck one disposable
   unavailable custom profile if available. Expected: no process starts,
   selection becomes the FE-008 placeholder, recency updates for this run, and
   `Files arrive with FE-016.` cannot be activated.
8. Close a pane and a tab with buttons/menu/shortcuts. Expected: Stage 8's
   zero-blocker targets close without a dialog; the last pane becomes Empty;
   the last tab returns the route to FE-006's picker. If a backend fixture can
   safely expose blockers, additionally verify exact facts and the refreshed
   `confirmationRequired` second confirmation.
9. Close a tab, inspect `Reopen closed tab`, then reopen with the menu and
   `Ctrl+Shift+T`. Expected: it is enabled only while BE-005 says so, restores
   the tab at the backend-selected position, makes it active, and never starts
   a stopped process.
10. Open each FE-007 or session lifecycle dialog and try all seven shortcuts;
    repeat while typing in rename input and with Vietnamese IME composition.
    Expected: no workspace shortcut fires and no browser default is suppressed
    inside editing/composition. Outside dialogs, `Ctrl+W` closes only the active
    tab and never the WebView2 window.
11. Hide the window to tray, restore it, and switch tabs. Expected: focus
    refresh converges to the latest backend snapshot, tab/pane state survives
    hide/restore, and no browser persistence is involved. Quit and relaunch;
    expected: the runtime sessions, layouts, reopen history, and recent tools
    are gone as designed.

## Plan Review Gate

- [x] Every direct dependency has a complete exact manifest value. Registry
  metadata verification and the pinned toolchain compatibility are recorded.
- [x] Every named test file is selected by a focused task command and the
  slice-wide command; each red step creates/discovers its test before expecting
  a specific missing export, module, or behavior.
- [x] Adapter, catalog, timing, focus, drag, resize, and concurrency tests use
  explicit local seams and controlled values; no test touches real app data,
  project folders, profiles, credentials, processes, storage, or OS resources.
- [x] The plan names concrete initialization/error scenarios: catalog failure,
  missing/stale targets, older detail responses, ratio rejection, changing
  close impact, lifecycle failure, runtime close, and shutdown, with an
  observable UI/recovery result for each.
- [x] Final verification includes format, lint, type check, every focused test,
  the full suite, production build, dependency inspection, concrete negative
  boundary/storage checks, and a Windows Tauri build plus manual smoke run.
- [x] No backend, generated binding, migration, capability, Tauri config,
  persistent state, terminal/file implementation, automated desktop
  end-to-end test, macOS validation, or Git commit step is authorized.

## Deviations and Decisions

- The FE-007 source describes the pre-v4 `react-resizable-panels` names
  `PanelGroup`, `PanelResizeHandle`, `direction`, `autoSaveId`, and imperative
  ref terminology while pinning version 4.12.3. The official v4 migration guide
  renames these to `Group`, `Separator`, `orientation`, explicit
  `groupRef`/`useGroupRef`, and optional `useDefaultLayout`. This plan uses the
  actual pinned v4 API and prohibits `useDefaultLayout`/browser storage. This is
  a naming/API correction only; the specified axes, ratios, interaction, and
  backend ownership remain unchanged. Synchronizing that terminology back into
  FE-007 is a separate documentation correction and is not authorized here.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

Pending implementation.

When complete, summarize delivered behavior, exact automated and manual
verification evidence, and remaining FE-008/FE-016/FE-017 limitations.
