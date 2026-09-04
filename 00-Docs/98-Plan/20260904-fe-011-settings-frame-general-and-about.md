# FE-011 Settings Frame, General, and About Implementation Plan

**Status:** Implemented — Manual Windows Smoke Pending

**Goal:** Deliver the routed Settings frame with seven sections, a read-only
General page backed by the existing `get_settings` command, and an About page
that reports the real application version and operating-system details.

**Completion Criteria:**

- `/settings` replaces itself with `/settings/general`; all seven child routes,
  selected navigation states, and two-level breadcrumbs agree with the current
  URL.
- General renders the five specified read-only rows from the generated
  `AppSettingsDto`, performs no settings mutation, and handles loading,
  retryable failure, non-retryable failure, and retry without duplicate calls.
- About renders the real app version, operating-system label/version, and CPU
  architecture through the minimum Tauri permissions, with isolated loading,
  failure, and retry behavior.
- The five deferred sections render their owning feature identifiers inside the
  same Settings frame, while the shell still exposes exactly one `banner`, one
  `navigation`, and one `main` landmark.
- All focused tests, repository-wide frontend and Rust gates, the Windows Tauri
  build, and the targeted manual Windows smoke checklist pass.

**Architecture:** `src/app/app-router.tsx` owns route composition and mounts one
Settings feature layout around child routes. The Settings feature owns its
navigation, presentation, transient Zustand state, and app-info hook; backend
settings data enters only through `src/lib/ipc/settings.ts`, while Tauri app/OS
calls are isolated in `src/lib/ipc/app-info.ts`. Rust only initializes the
official OS plugin and capabilities; no new backend command, DTO, persistence,
event, or business rule is introduced.

**Tech Stack:** React 19.2.8, TypeScript 7.0.2, React Router 8.3.1, Zustand
5.0.15, Tailwind CSS 4.3.3, shadcn/ui source components, Radix through existing
`radix-ui` 1.6.7, Vitest 4.1.11, Tauri 2.11.x,
`@tauri-apps/plugin-os` 2.3.2, and `tauri-plugin-os` 2.3.2.

**Sources:**

- Project rules: `AGENTS.md`
- Plan rules: `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md` (Stage 6)
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md` (`§4.1`,
  `§17.1`, `§17.7`, `§18`)
- Frontend spec:
  `00-Docs/02-Frontend/FE-011-settings-frame-general-and-about.md`
- Backend spec: `00-Docs/03-Backend/BE-008-settings-persistence.md`
- Wireframes: `00-Docs/01-Wireframe/02-AppShell.html#settings-general` and
  `00-Docs/01-Wireframe/02-AppShell.html#settings-about`
- Completed backend plan:
  `00-Docs/98-Plan/20260903-be-008-settings-persistence.md`

## Scope

**In Scope:**

- A persistent Settings layout with a `220px` sub-navigation column and a
  child-route content region matching the FE-011 spacing and narrow-window
  behavior.
- Seven section links in wireframe order, with one source of truth for labels,
  paths, icons, and deferred feature ownership.
- Nested routes for General, Appearance, Terminal & CLI Profiles, Keyboard
  Shortcuts, Notifications, Data, and About, including replace-navigation from
  the Settings index and two-level breadcrumb metadata.
- Placeholder pages for Appearance (`FE-012`), Terminal & CLI Profiles
  (`FE-013`), Keyboard Shortcuts (`FE-014`), Notifications (`FE-023`), and Data
  (`FE-015`).
- A typed `get_settings` adapter, one retained Settings snapshot store, error
  classification, read-only General rows, and retry behavior.
- A repository-owned shadcn/ui `Switch` source component used only in the
  disabled state by FE-011.
- A typed frontend-owned `AppInfo` adapter and hook using Tauri core app plus
  the official OS plugin.
- Exact frontend and Rust plugin dependency pins, OS plugin initialization,
  minimum capabilities, generated schema refresh, tests, Windows build, and
  targeted manual smoke verification.

**Out of Scope:**

- Appearance editing, theme preview, colors, font sizes, settings mutation,
  and restore defaults (`FE-012`).
- Terminal/CLI profile, keyboard-shortcut, notification, and data-management
  implementations (`FE-013`, `FE-014`, `FE-023`, `FE-015`).
- Wiring sidebar width or collapsed state to settings persistence; that is a
  separate FE-001 extension in Stage 6.
- `update_settings`, `restore_appearance_defaults`, settings events, or any new
  Rust command/DTO/migration.
- Autostart and the wireframe row `Start XWork when I sign in`.
- Documentation, license, issue-reporting, diagnostics, update controls,
  WebView2 details, terminal backend details, and default-shell details on
  About.
- `localStorage`, `sessionStorage`, IndexedDB, cookies, or any other webview
  persistence.
- Changes to `src/bindings/`, `src-tauri/tauri.conf.json`, or
  `src/app/shell-store.ts`.
- Automated desktop end-to-end tests and macOS validation.

## Global Constraints

- Write implementation code, identifiers, comments, and initial UI copy in
  English; keep Markdown UTF-8.
- Every function, method, callback, helper, component, hook, and test added or
  changed by this slice has a short purpose comment. Use concise inline
  comments only where reasoning or an edge case is not obvious.
- React owns presentation and temporary UI state. Rust owns OS integration,
  persistence, and business rules. Frontend feature code never invokes a
  backend command directly.
- All `get_settings` access goes through `src/lib/ipc/settings.ts` and the
  shared `invokeCommand`; all Tauri app/OS access goes through
  `src/lib/ipc/app-info.ts`. Components and hooks do not import Tauri APIs.
- `AppSettingsDto` and `SettingsError` come from generated
  `src/bindings/settings.ts`. `AppInfo` is frontend-owned and must not be added
  to `src/bindings/`.
- FE-011 is read-only: it never invokes `update_settings` or
  `restore_appearance_defaults`, never synthesizes General values, and never
  substitutes defaults after a failed settings read.
- The Settings sub-navigation is a labeled list of links inside `main`, not a
  second `navigation` landmark. Existing shell landmark assertions must remain
  unchanged.
- The `Switch` is copied into `src/components/ui/` as repository source and may
  use the already-pinned `radix-ui` 1.6.7 package. No separate Radix dependency
  is added.
- Add these exact direct dependency entries:
  `"@tauri-apps/plugin-os": "2.3.2"` in `package.json` and
  `tauri-plugin-os = "=2.3.2"` in `src-tauri/Cargo.toml`; update both lockfiles.
- Compatibility was checked on 2026-09-04 from the package registries:
  `@tauri-apps/plugin-os@2.3.2` requires `@tauri-apps/api ^2.8.0`, which admits
  the pinned 2.11.1; `tauri-plugin-os@2.3.2` depends on Tauri 2.8.2-compatible
  APIs and requires Rust 1.77.2, both satisfied by Tauri 2.11.5 and Rust 1.98.0.
- Initialize `tauri_plugin_os` at the shared composition root so production and
  composition tests use the same builder. Grant `main` only
  `core:app:allow-version`, `os:allow-platform`, `os:allow-version`, and
  `os:allow-arch`; do not grant `os:default`, `hostname`, or `locale` access.
- Do not hand-edit `src-tauri/gen/schemas/`; regenerate and commit the tooling
  output after plugin/capability changes. Do not modify generated
  `src/bindings/` at all.
- Test doubles must replace IPC and Tauri app/OS module calls. Tests must not
  read real app data or real OS details, change process-global environment
  variables, or write browser persistence.
- Build and validate on Windows only. Run a Tauri build because this slice
  changes the frontend/backend boundary, capabilities, and desktop plugin
  composition.

## Assumptions, Risks, and Blockers

**Assumptions:**

- FE-001 and BE-008 are complete, and the committed
  `src/bindings/settings.ts` remains the source of the settings contract.
- The seven child paths use stable kebab-case slugs derived from their labels:
  `/settings/general`, `/settings/appearance`, `/settings/terminal-profiles`,
  `/settings/keyboard-shortcuts`, `/settings/notifications`, `/settings/data`,
  and `/settings/about`. This naming decision does not change feature scope;
  later owner features replace only their route elements.
- A successfully loaded snapshot remains in the process-local Zustand store
  after leaving Settings and is reused on return. A completed error also
  remains until the user explicitly retries; no route transition silently
  retries it.
- The current CSP already permits Tauri IPC, so no
  `src-tauri/tauri.conf.json` change is needed.

**Risks:**

- Plugin permissions can accidentally become broader than About needs. Task 1
  pins both plugin halves, grants four identifiers explicitly, inspects the
  generated schema, and adds positive and negative capability checks.
- A nested Settings navigation can create a second landmark or desynchronize
  selected links and breadcrumbs. Tasks 4 and 7 test all paths against the
  current memory-router shell and retain the existing landmark count.
- A global store can issue duplicate reads or accept a result after the
  Settings frame has unmounted. Task 3 uses one shared in-flight promise, an
  internal active-frame count, and a request generation; it tests duplicate
  calls, real unmount, React development remount, and stale completion.
- About combines four asynchronous sources and could show partial or stale
  information. Tasks 2 and 6 treat the adapter as all-or-nothing and make the
  hook ignore completions from an obsolete mount/reload generation.
- Disabled switches can accidentally become focusable or imply editability.
  Task 5 asserts the native disabled state, values from both `true` and `false`
  snapshots, explanatory copy, and absence of mutation calls.
- Long labels and narrow windows can push the whole application into horizontal
  scrolling. Tasks 4 and 6 keep the nav width fixed, allow the content column
  to shrink, and confine About-table overflow to its own wrapper.

**Blockers:** None.

## Dependency Order

1. Task 1 pins and initializes the OS plugin and permissions → enables the real
   About API imports and final desktop build.
2. Task 2 creates the two isolated data adapters → enables the Settings store
   and About hook without direct Tauri imports in feature code.
3. Task 3 creates settings state/error behavior and Task 4 creates the routed
   frame primitives → together enable the two real pages.
4. Task 5 builds General on the settings adapter/store and shared section UI.
5. Task 6 builds About on the app-info adapter/hook and shared section UI.
6. Task 7 composes all seven children in the app router → enables slice-wide
   route, breadcrumb, sidebar, and landmark verification.
7. Task 8 runs all automated gates and the targeted Windows smoke check.

---

### Task 1: Add the Minimum Tauri OS Integration

**Outcome:** Both halves of the official OS plugin are exact-pinned, the shared
desktop composition initializes it, the main window receives exactly the four
About permissions, and generated capability schemas reflect the change.

**Depends On:** None

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/app/mod.rs`
- Modify: `src-tauri/capabilities/main.json`
- Regenerate: `src-tauri/gen/schemas/`
- Modify/Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: the existing `configure_app` composition path and Tauri 2
  capability schema generation.
- Produces: installed `@tauri-apps/plugin-os@2.3.2`, installed
  `tauri-plugin-os@2.3.2`, `.plugin(tauri_plugin_os::init())` on the shared
  builder, and the four explicit capability identifiers used by Task 2.
- Test seam: Tauri `MockRuntime` through the existing isolated
  `configure_with_app_data_dir` builder; no real OS query or user app-data path.

- [x] **Step 1: Pin the frontend and Rust dependencies**

  Add the exact manifest entries stated in Global Constraints and update the
  lockfiles through pnpm/Cargo resolution. Do not upgrade unrelated packages.

- [x] **Step 2: Register the plugin and minimum permissions**

  Register `tauri_plugin_os::init()` in `configure_app`, alongside the existing
  official plugins so every production/test composition receives it. Add only
  the four explicit permissions to `main.json`; preserve the existing event,
  window-dragging, description, and window label entries.

- [x] **Step 3: Add the composition regression and regenerate schemas**

  Extend `app_builder.rs` with a focused test documenting that the isolated
  composition still builds and completes setup after OS plugin registration.
  This is a compile/composition regression rather than a red test: the plugin
  exposes commands rather than a safe mock-runtime state probe, and native OS
  calls do not belong in an integration test. Regenerate Tauri schemas through
  the normal build tooling and inspect the diff instead of editing it.

- [x] **Step 4: Verify the task**

  Run:

  - `pnpm install --frozen-lockfile`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder`
  - `pnpm tauri build`

  Expected: dependency resolution uses exactly 2.3.2 for both plugin halves;
  every `app_builder` test passes with isolated app data; the Windows desktop
  build succeeds and refreshes schemas containing the three required OS
  operations. No native OS query runs in the test process.

### Task 2: Build the Typed Settings and App-Info Adapters

**Outcome:** Frontend callers receive the generated settings snapshot through
one normalized command wrapper and receive all-or-nothing application/OS facts
through one frontend-owned adapter.

**Depends On:** Task 1

**Files:**

- Create: `src/lib/ipc/settings.ts`
- Create: `src/lib/ipc/settings.test.ts`
- Create: `src/lib/ipc/app-info.ts`
- Create: `src/lib/ipc/app-info.test.ts`

**Interfaces:**

- Consumes: `invokeCommand`, generated `AppSettingsDto` and `SettingsError`,
  `getVersion()` from `@tauri-apps/api/app`, and `platform()`, `version()`,
  `arch()` from `@tauri-apps/plugin-os`.
- Produces: `getSettings(): Promise<AppSettingsDto>` and frontend-owned
  `AppInfo { appVersion: string; osPlatform: string; osVersion: string;
  osArch: string }` plus `readAppInfo(): Promise<AppInfo>`.
- Test seams: `vi.mock("@tauri-apps/api/core")`,
  `vi.mock("@tauri-apps/api/app")`, and
  `vi.mock("@tauri-apps/plugin-os")`; no Tauri runtime or real OS access.

- [x] **Step 1: Add the focused adapter tests**

  Settings cases: exact command name `get_settings`, omitted arguments, typed
  DTO passthrough, recognized `SettingsError` preserved in `IpcCallError`, and
  unrecognized rejection normalized to a null payload. App-info cases: all
  four source functions called once; exact `AppInfo` shape; Windows, macOS, and
  unknown platform strings preserved for later presentation mapping; and an
  error from any one source rejects the whole adapter without returning partial
  data. Include a permission-denied rejection from an OS function.

- [ ] **Step 2: Verify the targets fail because the adapters do not exist**

  Run:
  `pnpm exec vitest run src/lib/ipc/settings.test.ts src/lib/ipc/app-info.test.ts`

  Expected: Vitest discovers both named targets and fails to resolve
  `./settings` and `./app-info`.

- [x] **Step 3: Implement the minimum adapters**

  Keep `getSettings` as a typed one-line boundary over `invokeCommand` and do
  not expose mutation wrappers yet. Read all four app-info values as one
  operation and reject on any failure; do not map display labels or format
  version strings in the IPC layer.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/lib/ipc/settings.test.ts src/lib/ipc/app-info.test.ts`

  Expected: every adapter contract passes, including permission failure and
  all-or-nothing app-info behavior.

### Task 3: Implement the Retained Settings Store and Failure Mapping

**Outcome:** One Zustand store owns the settings read lifecycle, retained
snapshot, typed failure classification, retry rules, duplicate-call guard, and
test isolation required by General and the later FE-012 slice.

**Depends On:** Task 2

**Files:**

- Create: `src/features/settings/settings-store.ts`
- Create: `src/features/settings/settings-store.test.ts`
- Create: `src/features/settings/settings-error-copy.ts`

**Interfaces:**

- Consumes: `getSettings`, `IpcCallError<SettingsError>`, generated
  `AppSettingsDto`, and `SettingsError["code"]`.
- Produces: `SettingsStatus = "idle" | "loading" | "ready" | "error"`,
  `SettingsErrorCode = SettingsError["code"] | "unknown"`, the specified
  `SettingsState`, `useSettingsStore`, `resetSettingsStore()`, and internal
  `SettingsFailure { kind: "retryable" | "integration"; message: string }`
  mapping consumed by General. The feature-internal
  `retainSettingsArea(): () => void` registers an active frame and returns an
  idempotent release callback for `SettingsRoute` cleanup; it is not exported
  outside `src/features/settings/`.
- Internal lifecycle seam: `load()` shares one in-flight promise. A completion
  may update the store only when at least one retained Settings frame is active
  and its monotonically increasing request generation is still current. If the
  last frame unmounts before settlement, the result is discarded and the
  loading state returns to `idle`; an immediate React development remount can
  retain the same in-flight promise without a duplicate command.
  `resetSettingsStore()` invalidates the active generation, clears frame count
  and in-flight bookkeeping, and restores state so tests never inherit work.
- Test seam: a mocked deferred `getSettings`; no Tauri runtime, database, real
  settings, timer, or process-global environment mutation.

- [x] **Step 1: Add the focused store tests**

  Cover `idle → loading → ready`, complete snapshot replacement, successful
  error clearing, `idle → loading → error`, all generated error codes,
  unrecognized rejection as `unknown`, retryable classification for
  `unavailable` and `persistence_failed`, non-retryable classification for
  corrupt/integration-only codes and `unknown`, one in-flight call despite
  repeated `load()`, retained ready/error state, retry only after an explicit
  `load()`, reset to defaults, a deferred success/rejection ignored after the
  last frame releases, immediate release/re-retain sharing the pending call,
  and an old deferred completion ignored after a reset.

- [ ] **Step 2: Verify the target fails because the store does not exist**

  Run:
  `pnpm exec vitest run src/features/settings/settings-store.test.ts`

  Expected: Vitest discovers the target and fails to resolve
  `./settings-store`.

- [x] **Step 3: Implement the minimum store and mapping**

  Use the generated snapshot as-is. Never manufacture defaults, write webview
  persistence, call a mutation command, or automatically retry a completed
  error. Keep the error-copy table exhaustive over the generated union so a
  future backend error forces an intentional frontend decision.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/settings-store.test.ts`

  Expected: every transition, classification, duplicate-call, retention, and
  stale-completion case passes.

### Task 4: Build the Settings Frame, Navigation, and Deferred Sections

**Outcome:** The feature supplies a two-column routed frame, seven accessible
links in the specified order, reusable section/row presentation, and the five
honest placeholder pages without creating another navigation landmark.

**Depends On:** Task 3

**Files:**

- Create: `src/features/settings/settings-route.tsx`
- Create: `src/features/settings/settings-nav.tsx`
- Create: `src/features/settings/settings-section.tsx`
- Create: `src/features/settings/settings-section-placeholder.tsx`
- Create/Test: `src/features/settings/settings-route.test.tsx`

**Interfaces:**

- Consumes: React Router `NavLink` and `Outlet`, `useSettingsStore`, and Lucide
  icons already available through `lucide-react`.
- Produces: public `SettingsRoute`, public `SettingsSectionPlaceholder`,
  internal `SettingsNav`, `SettingsSection`, `SettingRow`, and
  `SETTINGS_SECTIONS` as the only label/path/icon/owner table. The section table
  uses the seven paths listed in Assumptions and owner codes from Scope.
- Behavior: `SettingsRoute` calls `load()` only while the retained store is
  `idle`, retains the active Settings area on mount, and releases it on cleanup;
  link selection derives from the router; the sub-navigation is a labeled list
  inside `main` and does not use `<nav>` or `role="navigation"`.
- Test seam: `MemoryRouter` with a small nested test route tree, a mocked
  deferred `getSettings`, and `resetSettingsStore()` in test cleanup.

- [x] **Step 1: Add the focused frame tests**

  Cover the seven labels and links in exact wireframe order; active state for
  every child path; keyboard link activation and visible focus styling; a
  labeled list that is not a `navigation` landmark; one `load()` at idle;
  child-route changes that retain the same frame and do not re-read settings;
  remount with a ready snapshot that does not re-read; completed error retained
  without an automatic retry; unmount-before-settlement discarding the result
  without a component-state warning; development-style immediate remount not
  duplicating the call; the fixed `220px` navigation column and shrinkable
  content; and each placeholder's exact section name/owner code.

- [ ] **Step 2: Verify the target fails because the frame does not exist**

  Run:
  `pnpm exec vitest run src/features/settings/settings-route.test.tsx`

  Expected: Vitest discovers the target and fails to resolve
  `./settings-route`.

- [x] **Step 3: Implement the minimum frame primitives**

  Match FE-011 layout tokens and spacing without copying unrelated wireframe
  content. Keep all Settings-specific presentation inside the feature, and
  render placeholders through `SettingsSection` so later slices replace only
  their route element instead of rebuilding the frame.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/settings-route.test.tsx`

  Expected: all frame, navigation, retention, placeholder, keyboard, and
  no-second-landmark assertions pass.

### Task 5: Implement the Read-Only General Page

**Outcome:** General presents the backend-owned language and four lifecycle
booleans exactly as a non-editable settings page, including loading, failure,
and explicit retry states.

**Depends On:** Tasks 3 and 4

**Files:**

- Create: `src/components/ui/switch.tsx`
- Create: `src/features/settings/settings-general-route.tsx`
- Create/Test: `src/features/settings/settings-general-route.test.tsx`

**Interfaces:**

- Consumes: `useSettingsStore`, the Settings failure mapping,
  `SettingsSection`, `SettingRow`, generated `GeneralSettingsDto`, and the
  repository-owned shadcn/ui `Switch` using existing `radix-ui`.
- Produces: public `SettingsGeneralRoute(): JSX.Element` and the shared
  `Switch` source component. General produces no action interface and sends no
  settings mutation.
- UI contract: title `General`; description
  `Language, window and tray behaviour.`; the five exact labels/descriptions
  from FE-011; language value `English`; and four disabled switches bound to
  `closeToTray`, `showTrayIcon`, `askBeforeQuitting`, and
  `openAtHomeOnLaunch`.
- Test seam: direct store state setup plus a mocked `getSettings`; no Tauri
  runtime or real application settings.

- [x] **Step 1: Add the focused General tests**

  Cover loading text with `aria-busy`; all five exact rows/descriptions;
  absence of `Start XWork when I sign in`; `English` derived from the generated
  language value; each boolean represented correctly for both `true` and
  `false`; every switch disabled and absent from Tab order; no mutation wrapper
  import/call; retryable `unavailable`/`persistence_failed` failures with one
  enabled `Try again`; disabled retry while loading; non-retryable
  `corrupt_stored_settings`, impossible read-command codes, and `unknown`
  without a retry button; repeated retry clicks producing one in-flight call;
  and no fake rows after any failure.

- [ ] **Step 2: Verify the target fails because General does not exist**

  Run:
  `pnpm exec vitest run src/features/settings/settings-general-route.test.tsx`

  Expected: Vitest discovers the target and fails to resolve
  `./settings-general-route`.

- [x] **Step 3: Implement the minimum General page and Switch**

  Add the standard source-owned shadcn/ui Switch using the existing Radix
  package, then compose the exact read-only rows. Preserve the title and
  description during loading/error; render no controls until a real snapshot
  exists, and let the store own retry/deduplication.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/settings-general-route.test.tsx`

  Expected: all row, boolean, disabled-state, loading, error, and retry
  assertions pass without a settings mutation call.

### Task 6: Implement the About Hook and Page

**Outcome:** About shows stable branding immediately and atomically loads,
formats, retries, or rejects the real version and OS facts without affecting
General state.

**Depends On:** Tasks 2 and 4

**Files:**

- Create: `src/features/settings/use-app-info.ts`
- Create: `src/features/settings/use-app-info.test.ts`
- Create: `src/features/settings/settings-about-route.tsx`
- Create/Test: `src/features/settings/settings-about-route.test.tsx`

**Interfaces:**

- Consumes: `readAppInfo`, frontend-owned `AppInfo`, and `SettingsSection`.
- Produces: internal `useAppInfo()` with
  `{ status: "loading" | "ready" | "error"; info: AppInfo | null;
  reload(): void }` and public `SettingsAboutRoute(): JSX.Element`.
- Presentation mapping: `windows → Windows`, `macos → macOS`, any other
  platform string unchanged; `Operating system` is
  `{mapped platform} {osVersion}` without inventing build metadata;
  `Architecture` is `osArch`; app version is rendered unchanged after
  `Version`.
- Hook seam: mocked deferred `readAppInfo` plus a per-request generation/active
  flag; cleanup and a later reload invalidate obsolete completions without
  mutating component state.

- [x] **Step 1: Add the focused hook tests**

  Cover the initial loading state; one adapter read; ready state with all four
  values; all-or-nothing error state; `reload()` returning to loading and
  starting exactly one new read; repeated reload while loading not overlapping;
  a stale earlier result ignored after reload; and both success and rejection
  ignored after unmount.

- [ ] **Step 2: Verify the hook target fails because it does not exist**

  Run:
  `pnpm exec vitest run src/features/settings/use-app-info.test.ts`

  Expected: Vitest discovers the target and fails to resolve
  `./use-app-info`.

- [x] **Step 3: Implement and verify the hook**

  Implement the smallest generation-safe hook over `readAppInfo`; do not read
  OS values independently in React and do not share state with General.

  Run:
  `pnpm exec vitest run src/features/settings/use-app-info.test.ts`

  Expected: all lifecycle, retry, overlap, stale-result, and unmount cases pass.

- [x] **Step 4: Add the page test, implement the page, and verify it**

  First add cases for branding during every state; loading text with
  `aria-busy`; unchanged app version; Windows/macOS/unknown platform mapping;
  two table rows; error copy and `Try again`; repeated-click deduplication;
  local horizontal table overflow; and explicit absence of Documentation,
  License, Report an issue, Copy diagnostics, update notes, WebView2, Terminal
  backend, and Default shell. Verify the red state:
  `pnpm exec vitest run src/features/settings/settings-about-route.test.tsx`
  must fail to resolve `./settings-about-route`. Then implement the page and
  rerun the same command; every listed case must pass.

### Task 7: Compose the Nested Settings Routes and Breadcrumbs

**Outcome:** The application router replaces the old Settings placeholder with
the real frame, redirects its index, mounts all seven child elements, and
publishes matching two-level breadcrumbs while preserving the shell and every
unrelated route.

**Depends On:** Tasks 4, 5, and 6

**Files:**

- Modify: `src/app/app-router.tsx`
- Modify/Test: `src/app/app-router.test.tsx`

**Interfaces:**

- Consumes: public `SettingsRoute`, `SettingsGeneralRoute`,
  `SettingsAboutRoute`, `SettingsSectionPlaceholder`, React Router `Navigate`,
  and existing `RouteCrumbHandle`/`crumbs` composition.
- Produces: parent path `settings`; index element
  `<Navigate to="general" replace />`; seven child paths from Assumptions;
  public page elements for General/About; owner-coded placeholder elements for
  the other five sections; and `crumbs(() => ["Settings", sectionLabel])` on
  each child. The parent/children retain the shell's existing error boundary.
- Test seams: the existing `createMemoryRouter` test harness; mocked settings
  and app-info adapters so no Tauri runtime, database, or OS access occurs.

- [x] **Step 1: Extend the router tests first**

  Replace the old `/settings` placeholder case with: replace-redirect to
  `/settings/general`; browser-back behavior returning to the route before
  Settings rather than the intermediate index; the real General and About
  pages; all five owner-coded placeholders; matching sidebar highlight,
  sub-navigation highlight, and `Settings / {section}` breadcrumb for every
  child; unknown `/settings/...` falling through to the existing Not Found
  route; one `banner`, one `navigation`, and one `main`; child transitions not
  re-reading settings; General failure not blocking About; About failure not
  blocking General; and unchanged Home, Projects, Notes, Calendar, Session,
  and top-level Not Found routes.

- [ ] **Step 2: Verify the router target fails for the missing composition**

  Run: `pnpm exec vitest run src/app/app-router.test.tsx`

  Expected: the named target is discovered; new assertions fail because
  `/settings` still renders `AreaPlaceholder` and no Settings child routes or
  two-level crumbs exist. Existing unrelated-route assertions still pass.

- [x] **Step 3: Implement the minimum route-tree replacement**

  Replace only the Settings route entry. Keep `AreaPlaceholder` imported for
  Notes, Calendar, and Session. Use relative child paths and one explicit index
  redirect; do not add a Settings-local wildcard that would mask the shell's
  current Not Found handling.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/settings-route.test.tsx src/features/settings/settings-general-route.test.tsx src/features/settings/settings-about-route.test.tsx src/app/app-router.test.tsx`

  Expected: all four targets pass, every child path and breadcrumb agrees, the
  replace redirect works, and all shell regressions remain green.

### Task 8: Run Slice-Wide Verification and Windows Smoke Checks

**Outcome:** FE-011 passes every applicable automated gate and its real Windows
About/settings flow is verified without touching user-owned data.

**Depends On:** Tasks 1-7

**Files:**

- Modify: `00-Docs/98-Plan/20260904-fe-011-settings-frame-general-and-about.md`
  (checklists, deviations, verification evidence, and outcome only)

**Interfaces:**

- Consumes: every interface and artifact from Tasks 1-7.
- Produces: recorded automated results, targeted manual Windows observations,
  deviations, and final implementation outcome.
- Isolation: use a disposable Windows account/profile whose XWork app-data is
  not real user data. The smoke check reads only app version and OS facts and
  does not mutate settings.

- [x] **Step 1: Run the focused and repository-wide command gates**

  Execute every row in Final Verification and record the result. Resolve real
  failures; do not weaken existing tests, capability checks, warnings, or type
  checks to make the slice pass.

- [ ] **Step 2: Run the targeted manual Windows smoke checklist**

  Run `pnpm tauri dev` from the disposable profile and execute every numbered
  item below. Do not add or run an automated desktop end-to-end test.

- [x] **Step 3: Record deviations and outcome**

  Append material implementation decisions or deviations without rewriting
  completed history. Fill Outcome with delivered behavior, exact verification
  evidence, the Windows smoke result, and any remaining deferred FE-012/013/014/
  015/023 limitations.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Focused FE-011 tests | `pnpm exec vitest run src/lib/ipc/settings.test.ts src/lib/ipc/app-info.test.ts src/features/settings/settings-store.test.ts src/features/settings/settings-route.test.tsx src/features/settings/settings-general-route.test.tsx src/features/settings/use-app-info.test.ts src/features/settings/settings-about-route.test.tsx src/app/app-router.test.tsx` | All eight named targets are discovered and every FE-011 adapter, state, page, route, breadcrumb, accessibility, and shell-regression assertion passes |
| Frontend format | `pnpm format:check` | No formatting differences |
| Frontend lint | `pnpm lint` | Pass with no lint errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Full frontend tests | `pnpm test` | All unit/component tests pass; no automated desktop end-to-end test is added |
| Frontend production build | `pnpm build` | The SPA bundle succeeds with the real nested Settings routes and OS plugin import |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No Rust formatting difference |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Every Rust target/feature passes with warnings denied |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` | All Rust unit, integration, contract, and composition tests pass |
| Composition target | `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder` | The isolated shared builder initializes and completes setup with the OS plugin |
| Windows desktop build | `pnpm tauri build` | Tauri produces a Windows build with the plugin, capability, frontend import, and refreshed schemas |
| Exact direct dependency pins | `pnpm list @tauri-apps/plugin-os --depth 0 --json` and `cargo tree --manifest-path src-tauri/Cargo.toml -p tauri-plugin-os --depth 0` | The direct frontend and Rust packages both resolve to exactly 2.3.2 |
| Minimum capability set | `rg -n -F -e "core:app:allow-version" -e "os:allow-platform" -e "os:allow-version" -e "os:allow-arch" src-tauri/capabilities/main.json` | Exactly the four required new permission entries are found |
| No broad OS capability | `rg -n -F -e "os:default" -e "os:allow-hostname" -e "os:allow-locale" src-tauri/capabilities` | No match is returned |
| Read-only settings boundary | `rg -n -F -e "update_settings" -e "restore_appearance_defaults" src/features/settings src/lib/ipc/settings.ts` | No match is returned |
| No direct Tauri access in feature | `rg -n "@tauri-apps/|invoke\\(" src/features/settings` | No match is returned; all Tauri calls remain under `src/lib/ipc/` |
| No webview persistence | `rg -n "localStorage|sessionStorage|indexedDB|document\\.cookie" src/features/settings src/lib/ipc/settings.ts src/lib/ipc/app-info.ts` | No match is returned |
| No generated/manual contract drift | `git diff --exit-code -- src/bindings` | No generated TypeScript binding was modified by FE-011 |
| No excluded config/state change | `git diff --exit-code -- src-tauri/tauri.conf.json src/app/shell-store.ts` | No CSP/application-config or shell-store change exists in this slice |

## Manual Windows Smoke Check

Use `pnpm tauri dev` from a disposable Windows account/profile. This checklist
does not require project folders, credentials, settings edits, or any other
real user-owned data.

1. Open Settings from the bottom of the sidebar. Expected: the URL state lands
   on General, sidebar Settings and sub-navigation General are highlighted,
   and the breadcrumb reads `Settings / General` without a visible intermediate
   page.
2. Inspect General. Expected: the five specified rows appear, the four switches
   reflect the real BE-008 snapshot but are disabled, the autostart row is
   absent, and Tab skips the switches.
3. Tab through and activate all seven section links with Enter. Expected: focus
   is visible, the order matches the wireframe, the right pane and second
   breadcrumb update together, and the sub-navigation does not remount or jump.
4. Visit the five deferred sections. Expected: each stays inside the Settings
   frame and names its owner (`FE-012`, `FE-013`, `FE-014`, `FE-023`, or
   `FE-015`) rather than showing fake controls.
5. Visit About. Expected: it shows `Version 0.0.0` if the current
   `tauri.conf.json` version remains unchanged, the actual Windows label and
   version, and actual CPU architecture. It does not show links, diagnostics,
   update text, WebView2, terminal backend, or default shell.
6. Resize the window narrowly. Expected: the sub-navigation remains `220px`,
   the content column shrinks, any About table overflow stays inside its table
   wrapper, and the whole application body does not scroll horizontally.
7. Leave Settings after it is ready and return. Expected: General reuses the
   retained snapshot without a visible reload; About reads its own details when
   mounted and neither page failure/state affects the other.
8. Inspect the accessibility tree with the existing browser/devtools support.
   Expected: the shell still has exactly one `banner`, one `navigation`, and
   one `main`; the Settings section list is labeled but is not a second
   navigation landmark.

## Plan Review Gate

- [x] Both new direct dependencies have complete exact manifest entries and
  compatibility evidence against the pinned Tauri/API/Rust versions.
- [ ] Every named test file is selected by a focused or final command; every
  planned red command discovers its target and fails for a named missing module
  or missing route behavior, never by running zero tests.
- [ ] The one non-red-testable native plugin-registration step is explicitly
  identified and covered by mock composition, capability inspection, Windows
  Tauri build, and a real manual smoke check.
- [x] All tests replace IPC/Tauri/OS sources or use an isolated app-data
  directory; none reads or writes real settings, app data, project data,
  credentials, or process-global environment state.
- [x] General covers retryable, corrupt, impossible typed, and unknown errors;
  About covers permission denial, partial-source failure, duplicate retry,
  stale completion, and unmount.
- [x] Final frontend, Rustfmt, Clippy (`--all-targets --all-features` with
  warnings denied), Rust test, production build, and Windows Tauri build gates
  match or exceed FE-011 and repository requirements.
- [x] Negative requirements have concrete source/diff checks for broad
  permissions, mutations, direct feature-level Tauri access, webview
  persistence, generated bindings, Tauri config, and shell store.
- [x] No migration, backend command/DTO/event, automated desktop end-to-end
  test, macOS validation, speculative settings content, or Git commit step is
  included.

## Deviations and Decisions

- The seven route slugs are normalized from the section labels as documented in
  Assumptions because FE-011 fixes separate routes but explicitly names only
  `/settings/general`.
- Plugin registration is validated as a composition/build regression instead
  of inventing a production helper solely for tests; real OS values remain a
  targeted manual Windows check.
- `SETTINGS_SECTIONS` is exported from the Settings feature to the application
  composition root. This is the smallest way for navigation and nested routes
  to share one label/path/owner table; no other feature consumes it.
- `src/features/settings/settings-test-fixture.ts` was added so component,
  store, and shell tests share one complete generated-contract fixture instead
  of copying a large snapshot into each target.
- The planned red commands were not captured separately because tests and
  implementation were applied in the same working batch. Every named target
  was discovered and passed in the focused and full verification runs.
- Browser smoke validation covered route navigation, keyboard activation,
  breadcrumbs, placeholders, landmark counts, the fixed `220px` column, and
  document overflow at `960x640`. Real Settings and OS values cannot be read
  outside the Tauri webview, so the native Windows checklist remains pending.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

FE-011 is implemented. `/settings` replace-redirects to General; the persistent
frame owns all seven child routes and matching breadcrumbs; General renders the
five backend-owned read-only values with retained, deduplicated loading and
classified retry behavior; About atomically reads and formats the application
version and three OS facts; and deferred sections name their owning features.

Automated verification completed on Windows:

- Focused FE-011 suite: 8 files, 80 tests passed.
- Full frontend suite: 34 files, 606 tests passed.
- Biome format/lint, TypeScript type check, and Vite production build passed.
- Rustfmt, Clippy with warnings denied, and all Rust tests passed; the focused
  composition target passed 9 tests.
- `pnpm tauri build` completed the release build and produced
  `src-tauri/target/release/xwork.exe`.
- Exact dependency, minimum-capability, read-only boundary, direct-Tauri,
  webview-persistence, generated-binding, and excluded-file checks passed.

The five deferred owners remain intentionally limited to placeholders. The
targeted native Windows smoke checklist must still be run from a disposable
profile to confirm real OS values and desktop-only focus/window behavior.
