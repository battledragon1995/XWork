# FE-001 Application Shell Implementation Plan

> **Superseded verification decision (2026-09-02):**
> `00-Docs/98-Plan/20260902-remove-desktop-e2e.md` removes the automated desktop
> E2E stack repository-wide. References below are retained only as completed
> implementation history and are not current requirements.

**Status:** Implemented

**Goal:** Replace the scaffold shell with the complete Phase 1 application
shell specified by `FE-001`, including accessible navigation, resizable and
collapsible sidebar behavior, custom window controls, lifecycle event handling,
and the confirmed Quit flow backed by the implemented `BE-001` contract.

**Completion Criteria:**

- The real Windows desktop application opens with the frameless topbar,
  sidebar, route-driven content area, disabled future entry points, and empty
  project state defined by the applicable wireframes.
- All five primary area routes, the two reserved detail routes, the not-found
  route, and the route error boundary render the specified context without
  introducing feature-owned business data.
- Sidebar collapse and resize behavior works by pointer and keyboard, including
  the `200px`/`420px` bounds, `232px` default, `56px` collapsed width, labels,
  tooltips, focus treatment, and `aria-valuenow` synchronization.
- The six lifecycle commands and two lifecycle events use only generated
  `BE-001` DTOs and errors through `src/lib/ipc/`; window and Quit errors produce
  the exact recoverable or integration states specified by `FE-001`.
- The Quit dialog covers the full DTO-driven flow in component tests, including
  pluralization, deduplication, cancellation, double-confirm prevention,
  snapshot/shutdown failures, and one retry for a stale request.
- `main` is frameless and receives exactly the three permissions approved by
  `FE-001`; no filesystem, shell, broad window, or persistence permission is
  added.
- Automated frontend, Rust, binding, desktop build, and isolated desktop smoke
  checks pass on Windows, followed by the documented manual native-window and
  tray checklist. macOS validation remains deferred to release preparation.

**Architecture:** `src/app/` remains the composition root and owns the route
table, shell chrome, providers, temporary shell state, and Quit presentation.
Shared Tauri calls live behind typed wrappers in `src/lib/ipc/`, and their DTOs
come only from the generated `src/bindings/app-lifecycle.ts`; React never owns
OS operations, persistence, runtime cleanup, or lifecycle business rules.
Copied shadcn/ui primitives remain source-owned in `src/components/ui/`, while
future feature slices replace only their route elements and do not import shell
implementation.

**Tech Stack:** TypeScript 7.0.2, React 19.2.8, React Router 8.3.1, Zustand
5.0.15, Tailwind CSS 4.3.3, Vitest 4.1.11, React Testing Library 16.3.3,
Tauri JavaScript API 2.11.1, Lucide React 1.39.0, shadcn/ui source snapshot via
CLI 4.20.0, Radix UI 1.6.7, class-variance-authority 0.7.1, clsx 2.1.1, and
tailwind-merge 3.6.0. The desktop boundary remains Tauri 2.11.5 with the
existing Rust 1.98.0 Edition 2024 backend.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 3 (Lifecycle and application
  shell)
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections
  4, 5.3-5.4, and 18
- Frontend spec: `00-Docs/02-Frontend/FE-001-application-shell.md`
- Backend contract: `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`
- Startup dependency: `00-Docs/03-Backend/BE-002-storage-foundation.md`
- Design system: `00-Docs/01-Wireframe/00-Design.md`
- Wireframes: `00-Docs/01-Wireframe/02-AppShell.html#shell`,
  `#shell-collapsed`, `#tray`, and `#welcome`;
  `00-Docs/01-Wireframe/04-Projects.html#dlg-quit`
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Plan rules: `PLANS.md`

## Scope

**In Scope:**

- Synchronizing the stale capability/config notes in `BE-001` with the later,
  explicit `FE-001` integration decision before implementation begins.
- The application route table, area metadata, placeholders, route-level error
  UI, topbar, sidebar, resize handle, wordmark menu, custom window controls,
  providers, lifecycle listeners, temporary shell store, and Quit store/dialog.
- Exact source snapshots of the four required shadcn/ui primitives and the
  shared `cn` helper, locally adjusted to use project tokens and no animation.
- Typed wrappers for all six `BE-001` commands and both events, including
  normalization of tagged and malformed IPC failures.
- The frameless `main` window and exactly the three capability permissions
  needed for lifecycle events and native drag initiation.
- Focused unit/component tests, expansion of the real desktop smoke scenario,
  isolated Windows test data, final quality gates, and manual Windows checks.

**Out of Scope:**

- Welcome, Home, Projects, Project Overview, Notes, Calendar, Settings, session,
  tab, pane, terminal, file, Command Palette, and notification-panel content.
- Real project/session lists, unread badges, `Ctrl K`, or working Search and
  Notification actions; their reserved controls remain disabled with tooltips.
- Any change to the six lifecycle command signatures, two event payloads,
  generated lifecycle DTOs, native tray implementation, single-instance logic,
  runtime cleanup, or lifecycle state machine.
- Sidebar persistence, browser storage, dark theme, configurable color/font
  settings, self-hosted fonts, Motion, Animate UI, and macOS validation.
- Runtime reconstruction of a pending Quit dialog after webview reload and a
  query for native maximized state; both are accepted `FE-001` limitations.

## Global Constraints

- All implementation, identifiers, code comments, and user-visible initial UI
  strings are English; Markdown and source files use UTF-8.
- Every function, component, hook, callback, helper, and test receives a short
  purpose comment. Inline comments explain clamp, event deduplication,
  cancellation, and repeated-confirm invariants without restating obvious code.
- React owns presentation and temporary UI state. Rust owns OS operations,
  storage, runtime cleanup, and lifecycle rules.
- Frontend calls backend commands/events only through `src/lib/ipc/`; UI
  components do not import `@tauri-apps/api` directly.
- `src/bindings/app-lifecycle.ts` is generated from Rust and must not be edited
  manually or replaced by handwritten DTO/error types.
- `src/app/` may consume shared UI, IPC wrappers, and generated bindings, but
  `src/components/` and `src/lib/` must not depend on `src/app/`.
- Later features integrate by replacing their own `element` in
  `app-router.tsx`; they do not import `AppShell`, `AppSidebar`, `ShellState`, or
  `QuitState`.
- Sidebar state remains memory-only in this slice. No `localStorage`,
  `sessionStorage`, `indexedDB`, filesystem, or database access is added to the
  webview.
- The main window keeps label `main`, title `XWork`, identifier
  `com.xwork.app`, and `resizable: true`; only `decorations` changes to `false`.
- `src-tauri/capabilities/main.json` contains exactly
  `core:event:allow-listen`, `core:event:allow-unlisten`, and
  `core:window:allow-start-dragging`; no wildcard or other core/plugin
  permission is added.
- The shell has a light color scheme, uses the documented local fallback font
  stacks, and introduces no font asset or remote font source.
- Icon-only controls have accessible names and tooltips, focus is visible,
  destructive actions use the exact `Quit` wording, and pointer-only resize has
  the documented keyboard equivalent.
- No animation dependency or Animate UI component is added. Animation classes
  from copied primitives are removed so `prefers-reduced-motion` users receive
  identical behavior.
- All direct frontend dependencies use exact manifest versions and the lockfile
  is updated by pnpm 11.25.0. The required additions are exactly:

  ```json
  {
    "@tauri-apps/api": "2.11.1",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "lucide-react": "1.39.0",
    "radix-ui": "1.6.7",
    "tailwind-merge": "3.6.0"
  }
  ```

  Registry metadata checked on 2026-09-02 confirms that Tauri API 2.11.1 is in
  the required 2.11 line, Lucide 1.39.0 and Radix UI 1.6.7 accept React 19, and
  the shadcn/ui 4.20.0 `new-york-v4` registry entries for `button`, `dialog`,
  `dropdown-menu`, and `tooltip` consume the unified `radix-ui` package.

## Assumptions, Risks, and Blockers

**Assumptions:**

- `BE-002` and `BE-001` are implemented prerequisites. Their current automated
  suites and generated `src/bindings/app-lifecycle.ts` remain the backend source
  of truth for this frontend slice.
- The empty Phase 1 runtime reports zero sessions in production, so selecting
  `Quit XWork` exits without a real dialog today. Non-zero dialog behavior is
  implemented and proven with typed frontend fixtures until `BE-005` supplies
  live sessions.
- `isMaximized` starts as `false` and follows the latest result returned by
  `toggle_main_window_maximized`; external maximize changes may leave the icon
  stale until the next shell action, as accepted by `FE-001`.
- Existing E2E infrastructure remains Windows-only and single-instance. A
  Tauri build-config overlay can give its child application the dedicated
  identifier `com.xwork.e2e`, while WDIO keeps its WebView2 profile under
  `RUNNER_TEMP`/`tmpdir`.

**Risks:**

- `BE-001` currently says the capability file gains no permission, while
  `FE-001` requires exactly three. Task 1 updates the older backend document
  before any config change, preserving one unambiguous contract.
- A frameless Windows window can regress dragging, border resize, Snap behavior,
  or close interception. Tasks 5 and 7 split testable command dispatch from the
  native behaviors that require a built application and a manual smoke pass.
- Strict Mode and hot reload can duplicate event handlers. Task 6 asserts one
  registration per mounted provider and calls both returned unlisten callbacks
  during cleanup.
- Quit has race-prone transitions. Task 6 makes phase transitions explicit,
  disables both dialog actions before awaiting confirm, deduplicates incoming
  request IDs, and limits stale-request recovery to one new `request_quit` call.
- Desktop E2E startup currently resolves the normal Tauri app-data directory.
  Task 8 builds the test executable with the dedicated `com.xwork.e2e`
  identifier and keeps the WebView2 profile under a per-run temporary root, so
  it never opens the developer's `com.xwork.app` database or browser profile.
- Copied shadcn/ui source can introduce undocumented animation or color tokens.
  Task 2 reviews the generated diff, removes animation classes, and maps every
  used semantic class to a local token before shell components consume it.

**Blockers:** None. `FE-001` explicitly resolves the known documentation drift;
Task 1 records that decision in the older source before implementation.

## Dependency Order

1. Task 1 (contract alignment) -> makes the desktop permission boundary
   unambiguous for all implementation and review.
2. Task 2 (dependencies and UI foundation) -> enables every shell component.
3. Task 3 (route/layout composition) -> provides the stable shell regions used
   by sidebar, topbar, providers, and future feature routes.
4. Tasks 4 (sidebar) and 5 (typed lifecycle IPC) can proceed independently
   after Task 3; both are required by Task 6.
5. Task 6 (topbar/window controls) -> supplies the wordmark Quit entry point and
   window-control presentation consumed by the complete flow.
6. Task 7 (Quit state, dialog, and events) -> completes provider composition and
   all frontend lifecycle behavior.
7. Task 8 (desktop configuration and verification) -> validates the completed
   shell against the real Windows runtime.

---

### Task 1: Align the Lifecycle Permission Documentation

**Outcome:** The older backend specification records that the later `FE-001`
integration slice, rather than `BE-001` itself, makes `main` frameless and adds
the three narrowly scoped frontend permissions.

**Depends On:** None

**Files:**

- Modify: `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`

**Interfaces:**

- Consumes: the finalized decisions in `FE-001` under “Quyết định và giả định
  đã chốt” and “Contract backend còn thiếu hoặc lệch”
- Produces: one consistent documented boundary for
  `src-tauri/tauri.conf.json` and `src-tauri/capabilities/main.json`

- [ ] **Step 1: Update only the stale integration notes**

  Preserve the fact that `BE-001` itself introduced no permissions. Add that
  the `FE-001` integration slice later sets `decorations: false` and adds only
  the two event-listener permissions plus native drag initiation. Do not change
  lifecycle command/event contracts or claim that general window APIs are
  exposed.

- [ ] **Step 2: Verify the documents agree**

  Run:

  ```powershell
  rg -n "decorations|core:event:allow-listen|core:event:allow-unlisten|core:window:allow-start-dragging" 00-Docs/02-Frontend/FE-001-application-shell.md 00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md
  ```

  Expected: both specifications describe the same three-permission FE-001
  change, and neither authorizes any additional window, filesystem, or shell
  permission.

### Task 2: Pin Dependencies and Add the Local UI Foundation

**Outcome:** The exact dependency graph, shared `cn` helper, four source-owned
shadcn/ui primitives, and application design tokens are ready for shell code
without animation or remote assets.

**Depends On:** Task 1

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `components.json`
- Modify: `src/index.css`
- Create: `src/lib/utils/cn.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/tooltip.tsx`

**Interfaces:**

- Consumes: `@/` alias, Tailwind CSS 4, the `new-york` shadcn configuration,
  and design tokens from `00-Design.md`
- Produces: `cn(...inputs: ClassValue[]): string` and local `Button`, `Dialog`,
  `DropdownMenu`, and `Tooltip` primitive exports used by `src/app/`

- [ ] **Step 1: Install the exact direct dependencies**

  Add the six exact entries listed under Global Constraints with pnpm 11.25.0.
  Use shadcn CLI 4.20.0 only to obtain the `new-york-v4` source snapshot for
  `button`, `dialog`, `dropdown-menu`, and `tooltip`; review the files before
  keeping them. Point `components.json` alias `utils` to `@/lib/utils/cn`.

- [ ] **Step 2: Localize the copied source and tokens**

  Keep the primitives generic, replace unsupported animation classes with
  static state styling, and define the light application tokens, documented
  fallback font stacks, focus ring, error, border, surface, text, radius, and
  shadow aliases in `src/index.css`. Do not add `tw-animate-css`, Motion, remote
  fonts, or app-specific workflow state to shared components.

- [ ] **Step 3: Verify the foundation**

  Run:

  ```powershell
  pnpm install --frozen-lockfile
  pnpm format:check
  pnpm lint
  pnpm typecheck
  ```

  Expected: the lockfile resolves exactly the six new direct versions, copied
  source compiles against React 19, and format/lint/type checks pass without an
  animation or missing-token import.

### Task 3: Establish Route-Driven Shell Composition

**Outcome:** The application renders one persistent topbar/sidebar/content
layout around the complete route table, placeholders, breadcrumb metadata, and
recoverable route error UI.

**Depends On:** Task 2

**Files:**

- Modify: `src/app/app-router.tsx`
- Modify: `src/app/app-shell.tsx`
- Create: `src/app/area-placeholder.tsx`
- Create: `src/app/app-error-boundary.tsx`
- Modify: `src/app/app-router.test.tsx`
- Create: `src/app/app-shell.test.tsx`

**Interfaces:**

- Consumes: React Router `createMemoryRouter`, nested routes, `Outlet`, and the
  shared UI/token foundation from Task 2
- Produces:
  `createAppRouter(initialEntries?: string[]): ReturnType<typeof createMemoryRouter>`,
  `AreaPlaceholder({ area, arrivesWith })`, route metadata for breadcrumb
  labels, and the persistent `AppShell` layout

- [ ] **Step 1: Expand the focused route and layout tests**

  Cover `/`, `/projects`, `/notes`, `/calendar`, `/settings`,
  `/projects/:projectId`, `/sessions/:sessionId`, an unmatched route, and a
  deliberately failing child route. Assert exact area/arrival text, route-level
  recovery to Home, one `banner`, one `navigation`, one `main`, and a persistent
  shell around the child outlet.

- [ ] **Step 2: Verify the tests fail for the missing shell behavior**

  Run:

  ```powershell
  pnpm test -- src/app/app-router.test.tsx src/app/app-shell.test.tsx
  ```

  Expected: Vitest discovers both files; assertions fail because the scaffold
  exposes only `/` and lacks nested area placeholders, shell landmarks, and the
  route error boundary.

- [ ] **Step 3: Implement the minimum route/layout structure**

  Keep route labels in the matched route table rather than a store. Render the
  five primary placeholders with their owning feature IDs, reserve project and
  session detail routes, preserve raw `sessionId` in the session breadcrumb,
  and keep the shell usable when a child route errors.

- [ ] **Step 4: Verify the task**

  Run:

  ```powershell
  pnpm test -- src/app/app-router.test.tsx src/app/app-shell.test.tsx
  ```

  Expected: both files pass with all routes, landmarks, placeholders, not-found
  output, and error recovery proven.

### Task 4: Implement Sidebar State, Navigation, Collapse, and Resize

**Outcome:** The sidebar presents the Phase 1 empty/navigation state and changes
width accessibly by pointer or keyboard while retaining its last expanded width
in memory.

**Depends On:** Task 3

**Files:**

- Create: `src/app/shell-store.ts`
- Create: `src/app/app-sidebar.tsx`
- Create: `src/app/sidebar-resize-handle.tsx`
- Modify: `src/app/app-shell.tsx`
- Create: `src/app/shell-store.test.ts`
- Create: `src/app/app-sidebar.test.tsx`
- Modify: `src/app/app-shell.test.tsx`

**Interfaces:**

- Consumes: router navigation/location and shared Button/Tooltip primitives
- Produces: the exact `ShellState` shape from `FE-001`, a `232px` default,
  `200px`-`420px` clamp, `56px` collapsed layout, route-aware navigation, and a
  separator with pointer and keyboard resize handlers

- [ ] **Step 1: Add focused store and sidebar tests**

  Assert clamping, `16px` arrow steps, `Home`/`End`, preservation of the latest
  expanded width, `aria-valuenow`, all navigation targets and `aria-current`,
  the exact empty Projects copy with no add button, collapsed labels/tooltips,
  and the specified focus order through the shell.

- [ ] **Step 2: Verify the tests fail for the missing state and controls**

  Run:

  ```powershell
  pnpm test -- src/app/shell-store.test.ts src/app/app-sidebar.test.tsx src/app/app-shell.test.tsx
  ```

  Expected: Vitest discovers all three targets and reports the missing
  `shell-store`, sidebar/resize modules, and absent layout behavior rather than
  running zero tests.

- [ ] **Step 3: Implement the tested sidebar behavior**

  Keep all values in Zustand memory state. Clamp before publication, end an
  active pointer resize before collapsing, use CSS grid width from state, hide
  project/session content in icon mode, and preserve labels through accessible
  names and tooltips.

- [ ] **Step 4: Verify the task**

  Run the same focused command from Step 2.

  Expected: store, sidebar, resize, navigation, grid-width, landmarks, and focus
  assertions all pass.

### Task 5: Add the Typed Lifecycle IPC Boundary

**Outcome:** Frontend code can call the six lifecycle commands and subscribe to
the two lifecycle events through one tested wrapper without handwritten DTOs or
raw Tauri calls in components.

**Depends On:** Task 3

**Files:**

- Create: `src/lib/ipc/ipc-error.ts`
- Create: `src/lib/ipc/app-lifecycle.ts`
- Create: `src/lib/ipc/app-lifecycle.test.ts`

**Interfaces:**

- Consumes: `AppLifecycleError`, `QuitRequestDto`, and
  `SessionNavigationDto` from generated `src/bindings/app-lifecycle.ts`;
  `invoke` and `listen` from `@tauri-apps/api`
- Produces: `TaggedIpcError`, `IpcCallError<TError>`,
  `invokeCommand<TResult, TError>(command, args?)`, the six exact wrapper
  functions, `onQuitRequested(handler)`, and `onNavigateSession(handler)` from
  the public `FE-001` contract
- Test seam: Vitest mocks `@tauri-apps/api/core.invoke` and
  `@tauri-apps/api/event.listen`; no test invokes the real desktop runtime

- [ ] **Step 1: Add focused IPC contract tests**

  Assert all six snake_case command names, camelCase `requestId` arguments,
  exact return propagation, both event names/payloads, returned unlisten
  callbacks, tagged `{ code }` error preservation, and malformed/unknown errors
  normalized to `IpcCallError.payload === null`.

- [ ] **Step 2: Verify the tests fail for the missing wrappers**

  Run:

  ```powershell
  pnpm test -- src/lib/ipc/app-lifecycle.test.ts
  ```

  Expected: Vitest discovers the target and fails because
  `src/lib/ipc/app-lifecycle.ts` and `ipc-error.ts` do not yet exist.

- [ ] **Step 3: Implement the minimum wrappers**

  Import DTO/error types only from the generated binding, keep command/event
  strings inside the adapter, and avoid interpreting IDs or lifecycle business
  rules in this layer.

- [ ] **Step 4: Verify the task**

  Run the focused command from Step 2.

  Expected: every command, argument, event, unlisten, and error-normalization
  assertion passes.

### Task 6: Build the Topbar, Wordmark Menu, and Window Controls

**Outcome:** The shell topbar renders route context, disabled future entry
points, keyboard-operable wordmark menu, native drag region, and the three
custom window actions with recoverable errors.

**Depends On:** Tasks 4 and 5

**Files:**

- Create: `src/app/app-topbar.tsx`
- Create: `src/app/app-menu.tsx`
- Create: `src/app/window-controls.tsx`
- Modify: `src/app/app-shell.tsx`
- Create: `src/app/app-topbar.test.tsx`
- Modify: `src/app/app-shell.test.tsx`

**Interfaces:**

- Consumes: route metadata, `ShellState`, shared UI primitives,
  `hideMainWindow`, `minimizeMainWindow`, and
  `toggleMainWindowMaximized`
- Produces: wordmark-menu Quit callback entry point, `data-tauri-drag-region`,
  disabled `SearchEntry`/`NotificationBell`, maximize/restore presentation, and
  `aria-live="polite"` window-control failures
- Test seam: Vitest mocks the lifecycle IPC module and resolves/rejects each
  command deterministically; no real OS window is touched

- [ ] **Step 1: Add the focused topbar tests**

  Cover breadcrumb updates, disabled future buttons and tooltips, no shortcut or
  unread badge, mouse/keyboard menu opening, separator/final Quit placement,
  Escape focus return, three command calls, double-click maximize, latest
  maximize result, exact `window_operation_failed` recovery text, integration
  failure handling, and clearing a prior window error on success or route change.

- [ ] **Step 2: Verify the test fails for the missing topbar behavior**

  Run:

  ```powershell
  pnpm test -- src/app/app-topbar.test.tsx src/app/app-shell.test.tsx
  ```

  Expected: both targets are discovered and fail on missing topbar/menu/window
  controls and their accessible behavior.

- [ ] **Step 3: Implement the tested topbar behavior**

  Mark only inert topbar background as draggable, keep interactive descendants
  outside the drag hit area, route both maximize entry points through the same
  wrapper, and update `isMaximized` only from its returned native state. The
  wordmark menu calls the Quit action supplied by the provider; it does not own
  lifecycle state.

- [ ] **Step 4: Verify the task**

  Run the focused command from Step 2.

  Expected: all breadcrumb, menu, disabled-entry, drag-region, window command,
  error, focus, and layout assertions pass.

### Task 7: Complete the Quit State Machine, Dialog, Events, and Providers

**Outcome:** All frontend lifecycle state is composed once at application level;
frontend and tray Quit requests share one accessible dialog, and tray navigation
uses the opaque session ID unchanged.

**Depends On:** Tasks 5 and 6

**Files:**

- Create: `src/app/quit-store.ts`
- Create: `src/app/quit-dialog.tsx`
- Create: `src/app/use-lifecycle-events.ts`
- Create: `src/app/app-providers.tsx`
- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/app-topbar.tsx`
- Modify: `src/main.tsx`
- Create: `src/app/quit-store.test.ts`
- Create: `src/app/quit-dialog.test.tsx`
- Create: `src/app/use-lifecycle-events.test.ts`
- Modify: `src/app/app-router.test.tsx`

**Interfaces:**

- Consumes: the exact `QuitState`, `QuitPhase`, and `QuitFailure` behavior from
  `FE-001`; typed lifecycle wrappers; router navigation; shared Dialog/Tooltip
  primitives
- Produces: `AppProviders({ children })`, one global Quit dialog host, lifecycle
  listener registration/cleanup, request-ID deduplication, and the complete
  `startQuit`, `receiveTrayRequest`, `cancelQuit`, and `confirmQuit` actions
- Test seams: Vitest mocks all lifecycle wrappers; tests supply typed
  `QuitRequestDto` fixtures, controllable promises for rapid-click races, event
  handler captures, and independent unlisten spies. Zustand state is reset
  before each test, so no case observes another case's pending request.

- [ ] **Step 1: Add focused state, dialog, and event tests**

  Test the `null` immediate-exit path, pending request path, same/new request ID
  events, all specified error codes and integration grouping, one stale retry,
  confirm locking before await, and state after retry success/failure. Test the
  exact dialog copy, all singular/plural forms, zero unsaved-file omission,
  focus trap and initial Cancel focus, Cancel/Escape/outside-click equivalence,
  focus return to wordmark, `Quitting...`, and retry labels. Capture both event
  handlers to assert raw `/sessions/:sessionId` navigation and both cleanup
  callbacks on unmount.

- [ ] **Step 2: Verify the tests fail for the missing lifecycle UI**

  Run:

  ```powershell
  pnpm test -- src/app/quit-store.test.ts src/app/quit-dialog.test.tsx src/app/use-lifecycle-events.test.ts src/app/app-router.test.tsx
  ```

  Expected: Vitest discovers all four targets and fails on missing Quit store,
  dialog, provider, listener behavior, and provider composition.

- [ ] **Step 3: Implement the minimum lifecycle UI**

  Drive rendering from state rather than DOM contents. Do not generate or alter
  request IDs. Treat Escape and outside interaction as Cancel only while cancel
  is allowed; keep the dialog locked during confirm. On `stale_quit_request`,
  clear the old dialog and call `requestQuit` exactly once. Unknown, unauthorized,
  invalid-request, poisoned-state, unavailable-main, tray-operation, and
  event-delivery failures become the non-retrying integration state specified by
  `FE-001`.

- [ ] **Step 4: Compose providers and verify the task**

  Wrap `RouterProvider` with `AppProviders` for Tooltip/Quit state and hosts.
  Mount `useLifecycleEvents` once in the persistent `AppShell`, where React
  Router navigation context is available, and clean both lifecycle
  subscriptions when that bridge unmounts. This avoids a hidden global router
  or adding a router parameter to the fixed public `AppProviders` contract.

  Run the focused command from Step 2.

  Expected: all Quit content, transition, race, retry, event, navigation,
  listener-cleanup, and application composition assertions pass.

### Task 8: Apply the Desktop Boundary and Verify the Real Windows Shell

**Outcome:** The finished shell runs inside the least-privileged frameless Tauri
window, the desktop smoke scenario covers stable webview behavior without
touching real user data, and all automated/manual completion evidence is
recorded.

**Depends On:** Task 7

**Files:**

- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/main.json`
- Create: `src-tauri/tauri.e2e.conf.json`
- Modify: `tests/e2e/wdio.conf.ts`
- Modify: `tests/e2e/app-smoke.e2e.ts`

**Interfaces:**

- Consumes: existing `main` window, implemented `BE-001` commands/events,
  production storage startup, and the complete shell DOM
- Produces: `decorations: false`, the exact three capability permissions, an
  E2E-only application identifier, and desktop assertions for landmarks,
  navigation, breadcrumbs, and sidebar collapse
- Test seam: `src-tauri/tauri.e2e.conf.json` overrides only the identifier to
  `com.xwork.e2e`, separating the test database from production identifier
  `com.xwork.app`; `wdio.conf.ts` keeps its unique
  `webviewOptions.userDataFolder` under `RUNNER_TEMP` or `tmpdir` and retains
  `maxInstances: 1`

- [ ] **Step 1: Add the desktop smoke assertions**

  Expand `app-smoke.e2e.ts` to assert the shell landmarks and wordmark, navigate
  Home/Projects/Notes/Calendar/Settings, verify each heading/breadcrumb and
  `aria-current`, then collapse/expand the sidebar and assert its width and
  accessible label. Keep native tray/window interaction out of this browser
  scenario.

- [ ] **Step 2: Verify the E2E source compiles before desktop changes**

  Run:

  ```powershell
  pnpm typecheck:e2e
  ```

  Expected: the expanded WebdriverIO scenario and temporary-directory setup
  compile with no type errors. Runtime assertions are still expected to fail
  against the scaffold/config state if run before Steps 3-4.

- [ ] **Step 3: Apply the exact desktop configuration**

  Set only `decorations: false` on `main`. Add the exact three ordered
  permissions from Global Constraints and keep every other production
  window/config value unchanged. Add the E2E config overlay containing only the
  schema and `identifier: "com.xwork.e2e"`; do not add a runtime environment
  switch or change the production identifier.

- [ ] **Step 4: Run focused automated desktop verification**

  Run:

  ```powershell
  pnpm test
  pnpm typecheck:e2e
  pnpm test:rust
  pnpm tauri build --no-bundle --config src-tauri/tauri.e2e.conf.json
  pnpm test:e2e
  pnpm tauri build
  ```

  Expected: every frontend test passes; Rust lifecycle/storage/binding tests
  remain green; the E2E executable uses `com.xwork.e2e`; the isolated desktop
  scenario passes all route, landmark, breadcrumb, and collapse assertions; no
  database/profile is created under the normal `com.xwork.app` location; and
  the final production build restores the normal identifier.

- [ ] **Step 5: Prove the negative boundaries mechanically**

  Run:

  ```powershell
  rg -n "localStorage|sessionStorage|indexedDB" src
  rg -n "@tauri-apps/api" src/app src/components
  git diff --exit-code -- src/bindings/app-lifecycle.ts
  ```

  Expected: the first two searches return no matches, and the generated binding
  has no diff. Inspect `src-tauri/capabilities/main.json` directly and confirm
  its permissions array contains three entries exactly, with no filesystem,
  shell, wildcard, or additional window permission.

- [ ] **Step 6: Perform the manual Windows smoke checklist**

  Run `pnpm tauri dev`, then verify border resizing still works; topbar empty
  space drags the frameless window; Minimize works; Maximize/Restore and topbar
  double-click agree; Close and `Alt+F4` hide without losing the current route;
  tray Open restores that route; wordmark menu keyboard behavior works; and
  `Quit XWork` with zero sessions exits without a dialog or remaining process.
  Record the accepted loss of Windows 11 hover Snap Layouts. Do not claim macOS
  coverage.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Locked install | `pnpm install --frozen-lockfile` | Exact manifest and lockfile install succeeds |
| Frontend format | `pnpm format:check` | No formatting differences |
| Frontend lint | `pnpm lint` | No lint errors or warnings |
| Frontend type check | `pnpm typecheck` | No TypeScript errors |
| Frontend unit/component tests | `pnpm test` | All shell, router, store, dialog, event, and IPC tests pass |
| Frontend production build | `pnpm build` | Vite emits the production frontend bundle successfully |
| E2E type check | `pnpm typecheck:e2e` | WebdriverIO config and scenario compile |
| Rustfmt | `pnpm format:rust` | No Rust formatting diff |
| Clippy | `pnpm lint:rust` | All targets/features pass with warnings denied |
| Rust tests and binding guard | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | Lifecycle, storage, composition, and generated-binding tests pass |
| Isolated desktop E2E build | `pnpm tauri build --no-bundle --config src-tauri/tauri.e2e.conf.json` | Test executable builds with identifier `com.xwork.e2e` and never resolves production app data |
| Isolated desktop E2E | `pnpm test:e2e` | Shell navigation/collapse smoke passes against the E2E build and temporary WebView2 profile |
| Windows production Tauri build | `pnpm tauri build` | Frameless release executable builds successfully with identifier `com.xwork.app` |
| Browser persistence exclusion | `rg -n "localStorage|sessionStorage|indexedDB" src` | No matches |
| Direct Tauri import exclusion | `rg -n "@tauri-apps/api" src/app src/components` | No matches; imports exist only under `src/lib/ipc/` |
| Generated binding integrity | `git diff --exit-code -- src/bindings/app-lifecycle.ts` | No handwritten binding change |
| Native Windows smoke | Manual checklist from Task 8 | Drag, resize, minimize, maximize, hide/show, route preservation, and zero-session Quit all behave as specified |

## Deviations and Decisions

- `@testing-library/user-event` `14.6.6` was added as a dev dependency beyond the
  six direct dependencies fixed in Global Constraints. The plan requires proving
  Tab order, menu keyboard operation, Escape handling and focus return, which
  `fireEvent` cannot simulate faithfully.
- `biome.json` gained `css.parser.tailwindDirectives: true`. Biome rejects the
  Tailwind 4 `@theme` block that `src/index.css` needs, so the lint gate could
  not pass without it.
- `src/test-setup.ts` was created and registered in `vite.config.ts`. jsdom
  implements neither `ResizeObserver` nor pointer capture, both of which the
  copied Radix primitives call.
- `pnpm-workspace.yaml` gained a `minimumReleaseAgeExclude` entry for
  `lucide-react@1.39.0`, written by pnpm itself because the pinned version is
  newer than the configured minimum release age.
- `WindowControlFailure.code` and `QuitFailure.code` accept `"unknown"` in
  addition to `AppLifecycleError["code"]`. `FE-001` requires a rejection without
  a recognizable `{ code }` to be handled as an integration failure, which its
  declared type cannot express.
- `SearchEntry` and `NotificationBell` use `aria-disabled="true"` instead of the
  `disabled` attribute. A truly disabled button leaves the documented focus order
  and stops emitting the hover and focus events its tooltip needs, so `FE-001`
  could not satisfy both its focus-order and its tooltip requirement otherwise.
- `AppProviders` was created during Task 4 rather than Task 7, because the
  sidebar tooltips need a `TooltipProvider` from the moment they exist. Task 7
  completed it with the Quit dialog host.
- The breadcrumb is an `ol[aria-label="Breadcrumb"]`, not a `nav`, so the sidebar
  stays the single `navigation` landmark the plan asserts. It contributes no
  focus stop in this slice because it holds no interactive content.
- `mochaOpts.timeout` in `tests/e2e/wdio.conf.ts` was raised from `60s` to `240s`
  and the read-only desktop assertions were batched into one `browser.execute`
  per checkpoint. Measured on this Windows machine, a single WebDriver command
  relayed through `tauri-driver` to WebView2 costs roughly six seconds and one
  `toBeDisplayed` roughly fifteen, so the original scenario exceeded the Mocha
  default before finishing. The batched script still runs inside the built
  application's own WebView2.
- `src/lib/ipc/app-lifecycle.ts` re-exports `UnlistenFn` so `src/app/` can type a
  subscription without importing `@tauri-apps/api`, keeping the documented
  boundary search clean.
- Running the desktop suite required installing `tauri-driver 2.0.6` on the
  machine; it is a developer prerequisite, not a repository change.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

**Delivered:** The scaffold shell is replaced by the complete `FE-001` shell.
`src/app/` owns the route table with five area routes, two reserved detail
routes, a not-found route and a per-route error boundary; the persistent
topbar/sidebar/content layout; the resizable and collapsible sidebar; the
wordmark menu, drag region and three custom window controls; and the full Quit
state machine, dialog and lifecycle event bridge. `src/lib/ipc/` is the single
Tauri boundary, typed only by the generated `src/bindings/app-lifecycle.ts`.
`main` is frameless and holds exactly the three approved permissions.

**Automated results on Windows:**

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm format:check` | Pass, 40 files |
| `pnpm lint` | Pass, 40 files |
| `pnpm typecheck` | Pass |
| `pnpm test` | Pass, 124 tests in 9 files |
| `pnpm build` | Pass |
| `pnpm typecheck:e2e` | Pass |
| `pnpm format:rust` | Pass |
| `pnpm lint:rust` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | Pass, including the generated-binding guard |
| `pnpm tauri build --no-bundle --config src-tauri/tauri.e2e.conf.json` | Pass, identifier `com.xwork.e2e` |
| `pnpm test:e2e` | Pass, 3 scenarios in 5m 16s |
| `pnpm tauri build` | Pass, identifier `com.xwork.app` |
| `rg "localStorage|sessionStorage|indexedDB" src` | No matches |
| `rg "@tauri-apps/api" src/app src/components` | No matches |
| `git diff --exit-code -- src/bindings/app-lifecycle.ts` | No diff |
| `src-tauri/capabilities/main.json` | Exactly the three approved permissions |

The isolated desktop run created only `%APPDATA%/com.xwork.e2e`; no
`%APPDATA%/com.xwork.app` directory or database was touched.

**Accepted limitations:** A frameless window loses the Windows 11 hover Snap
Layouts. `isMaximized` follows only the value the last
`toggle_main_window_maximized` returned, so an external maximize can leave the
icon stale. A pending Quit dialog is not reconstructed after a webview reload.
Sidebar width and collapse state stay in memory until `BE-008`. With zero
sessions the Quit dialog never appears at runtime, so its behavior is proven by
component tests against typed `QuitRequestDto` fixtures until `BE-005` lands.

**Not done:** The manual Windows smoke checklist of Task 8 Step 6 — border
resize, topbar drag, Minimize, Maximize/Restore agreement with the topbar double
click, Close and `Alt+F4` hiding to tray with the route preserved, tray Open
restoring that route, wordmark menu keyboard behavior, and `Quit XWork` exiting
with no leftover process — has not been performed and remains open. macOS
validation stays deferred to release preparation.
