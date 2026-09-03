# FE-005 Project Overview — Stage 5 Implementation Plan

**Status:** Draft

**Goal:** Replace the `/projects/:projectId` placeholder with the real Project
Overview experience for the Stage 5 slice: load one project through
`open_project`/`get_project`, render the read-only branch and Git status from
`get_project_git_status`, keep the `New Session` entry point visible but
unavailable, and show the project display name in the breadcrumb — without
changing Rust, generated bindings, capabilities, or dependencies.

**Completion Criteria:**

- `/projects/:projectId` renders `ProjectOverviewRoute` with every specified
  project state (loading skeleton, full-page load failure, silent navigation
  after gone, ready, and `Unavailable`), the header actions cluster, the
  read-only `Changes on {head}` block, and the focusable `aria-disabled`
  `New Session` button with its tooltip.
- Mounting the route calls `open_project` exactly once and shows
  `opened just now`; subsequent window focus and `projects://changed`
  refreshes use `get_project` and re-query Git without advancing
  `last_opened_at_ms`.
- Every documented `ProjectsError` branch maps to its specified UI outcome:
  the full-page `XWork couldn't open this project.` failure with `Try again`,
  silent navigation to `/projects` for gone projects, the `Unavailable`
  banner with its two direct actions, Git retry and integration failures, and
  `projectUnavailable` triggering an immediate metadata refresh.
- The breadcrumb reads `Projects / {displayName}` from the project store and
  updates after an in-place rename without navigation; crumbs of every other
  route are unchanged.
- The focused tests, all repository quality gates, the production frontend
  build, and the Windows Tauri build pass, and the targeted manual Windows
  smoke checks confirm the real clipboard, file manager, and window-focus
  behavior that automated tests cannot cover.

**Architecture:** `src/lib/ipc/projects.ts` stays the only frontend adapter to
the existing `BE-003`/`BE-004` commands and event. A route-local hook owns the
single-project snapshot, the Git snapshot, one `projects://changed`
subscription, one window `focus` listener, and a request token that invalidates
stale results on remount. The header, unavailable banner, and Git changes block
are presentational components inside `src/features/projects/` that reuse the
FE-004 actions menu, dialogs, action hook, and error-copy tables. `src/app/`
imports only the feature's public entries: `ProjectOverviewRoute`,
`readProjectCrumbLabel`, and the already-exported `useProjectsStore`; Rust
remains the sole owner of persistence, Git reads, filesystem checks, and the
operating-system folder opener.

**Tech Stack:** React 19.2.8, TypeScript 7.0.2, React Router 8.3.1, Zustand
5.0.15, Tauri API 2.11.1 (consumed only through `src/lib/ipc/`), Tailwind CSS
4.3.3, the repository's copied shadcn/ui source components, Lucide React
1.39.0, Vitest 4.1.11, and Testing Library.

**Sources:**

- Planning rules: `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md` (Stage 5)
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md` (`§7.2`–
  `§7.5`, `§8.1`–`§8.3`, and `§18`)
- Frontend spec: `00-Docs/02-Frontend/FE-005-project-overview.md`
- Frontend dependencies: `00-Docs/02-Frontend/FE-001-application-shell.md`,
  `00-Docs/02-Frontend/FE-004-projects.md`
- Backend specs: `00-Docs/03-Backend/BE-003-projects.md`,
  `00-Docs/03-Backend/BE-004-git-status-read-only.md`
- Wireframes: `00-Docs/01-Wireframe/04-Projects.html#overview` and
  `#unavailable`

## Scope

**In Scope:**

- The `ProjectOverviewRoute` element for `/projects/:projectId`: single-column
  page layout, project loading/failed/gone/ready states, and composition of
  the header, Git area, reused menu, and both reused dialogs.
- The overview header: display name with pinned indicator and `Unavailable`
  badge, mono root path with full-path `title`, `Copy path` through
  `navigator.clipboard.writeText` with live-region feedback, `Open folder`,
  the branch/summary line with `added`/`opened` timestamps, the primary
  `New Session` entry point, and `More actions`.
- The `ProjectUnavailableBanner` with one of the four FE-004 reason messages,
  the fixed explanation sentence, and direct `Locate folder…` /
  `Remove Project` actions wired to the same flows as the menu.
- The read-only `ProjectGitChanges` block for `worktree` repositories with
  badge mapping, previous paths, the clean state, and the permanent
  read-only note.
- The data hook: `open_project` once per mount, `get_project` +
  `get_project_git_status` on focus and `projects://changed`, stale-result
  tokens, listener cleanup, the documented error branches, and metadata
  refresh after any `projectUnavailable` signal.
- The `useProjectActions` extension with an optional `onUnavailable` callback,
  plus the overview's `onRemoved` navigation wiring.
- IPC wrappers `openProject`, `getProject`, and `getProjectGitStatus`, and the
  Git/overview failure classification in `project-error-copy.ts`.
- The `readProjectCrumbLabel` store selector, the topbar store subscription,
  and the route table swap from `AreaPlaceholder` to `ProjectOverviewRoute`.
- Accessibility and keyboard behavior: the documented content Tab order,
  focus rings, icon-button tooltips, visually hidden badge names, and the
  `aria-live` copy-path feedback region.

**Out of Scope:**

- The `Sessions in this run` block, `use-project-sessions`,
  `src/lib/ipc/sessions.ts`, `list_sessions`, `create_session`,
  `sessions://runtime-changed`, and every session-state mapping. They activate
  at Stage 8 with `BE-005` and its generated `src/bindings/sessions/`.
- The session row menu (`Rename or delete session`), the session screen, tool
  selection, tabs/panes, and `set_observed_session` (`FE-006`, `FE-007`).
- The right wireframe column and the `7fr 5fr` split layout (`Recent files`,
  linked notes, linked events arrive at Stages 16, 18, and 20).
- All Git write operations, diffs, history, remotes, ahead/behind, and opening
  changed files from the list.
- Sidebar session rows, unified search, notifications, and any Rust,
  migration, generated-binding, capability, `tauri.conf.json`, package
  manifest, or dependency change.
- Automated desktop end-to-end tests and macOS validation before release
  preparation.

## Global Constraints

- Write code, identifiers, and code comments in English; initial UI copy is
  English and matches `FE-005` exactly. Read and write Markdown as UTF-8.
- React owns presentation and temporary UI state only. Rust owns persistence,
  Git reads, filesystem inspection, and the operating-system folder opener;
  the frontend reaches them only through the wrappers in `src/lib/ipc/`.
- Never edit generated bindings under `src/bindings/`. Never declare
  handwritten mirrors of backend DTOs; import the generated types.
- `src/app/` may import only public feature entries. Feature code may not
  import another feature's implementation; the reused components stay inside
  `src/features/projects/`.
- Add no dependency, manifest, lockfile, Rust, migration, capability, or
  Tauri configuration change. `Copy path` is a webview web API and needs no
  new capability.
- At Stage 5 the `New Session` button renders with `aria-disabled="true"`,
  stays focusable, and explains itself through the tooltip
  `Session creation isn't available yet.` (or
  `The project folder is unavailable.` while the root is unavailable). The
  sessions block, session copy beyond that tooltip, and
  `src/lib/ipc/sessions.ts` must not appear in this slice.
- Git is read-only on this screen: no command beyond
  `get_project_git_status` is called, and the read-only note always renders
  under the change list.
- Every new function, component, hook, callback, helper, and test carries a
  short purpose comment; complex logic (tokens, availability races,
  clipboard/timer cleanup) gets concise reasoning comments.
- Tests replace the IPC wrappers, event registration, navigation, clipboard,
  and timers with local doubles. They must not touch real app data, projects,
  folders, native dialogs, or operating-system resources.
- Develop and verify on Windows only. Do not add or run automated desktop
  end-to-end tests; cover native-window behavior with the targeted manual
  smoke checklist.

## Assumptions, Risks, and Blockers

**Assumptions:**

- `BE-003` and `BE-004` are implemented and current: `open_project`,
  `get_project`, and `get_project_git_status` are registered in
  `src-tauri/src/app/mod.rs`, and `src/bindings/projects/projects.ts` exports
  the used DTOs and the full `ProjectsError` union. This plan consumes that
  contract without changing it.
- `FE-001`, `FE-002`, and `FE-004` are implemented as present in the
  repository: the route still hosts an `AreaPlaceholder`, the Projects IPC
  adapter lacks the three read wrappers, `ProjectActionsMenu` already accepts
  route-owned callbacks, and `useProjectActions` accepts only `onRemoved`.
- Existing `Button`, `Tooltip`, `DropdownMenu`, `Dialog`, and `Input` source
  components, the FE-004 warning tokens, and Lucide icons express the feature
  without a new component or dependency.
- The topbar breadcrumb subscribes to the project store snapshot without
  acquiring a consumer. That is sufficient because the memory router starts
  at `/`, every navigation source for this route first mounts a store
  consumer (sidebar list or Projects page), a released store retains its last
  snapshot, and `useProjectActions` explicitly refreshes the store after
  every committed mutation — so the label exists and tracks renames even
  while the sidebar is collapsed.
- `navigator.clipboard` is available in the Tauri webview; the specified
  failure branch still exists and is tested through a stub.

**Risks:**

- Fast navigation between two overviews, or between an overview and another
  route, can let late answers overwrite newer state. Task 2 guards every
  query with one monotonically increasing token, invalidates it on unmount,
  and tests deferred-promise races explicitly.
- `open_project` itself emits `projects://changed`, so the mount sequence can
  produce one harmless extra refresh. Task 2 keeps the event as an
  invalidation key only and tests that the extra refresh cannot advance
  `last_opened_at_ms` or duplicate the Git query path.
- A project can become unavailable between the metadata snapshot and a Git,
  open-folder, or later command. Tasks 2 and 3 route every
  `projectUnavailable` rejection to one metadata refresh, keep the failed
  operation's own message, and test the transition to the `Unavailable`
  state.
- Clipboard permission can be refused and the 2-second `Copied` revert timer
  can outlive unmount. Task 4 stubs the clipboard with deferred promises,
  uses fake timers, and clears the timer in cleanup.
- Timestamp formatting could become time-zone or clock dependent. Task 4
  implements the two `Intl.DateTimeFormat("en", …)` helpers as pure functions
  of `(timestamp, now)` and pins `vi.setSystemTime` in tests.
- The `useProjectActions` change could alter FE-004 behavior. Task 3 adds the
  callback as optional, invokes it only for `open_project_folder`
  rejections classified as `projectUnavailable`, and asserts the existing
  no-callback behavior is unchanged.
- Wiring the real route could regress other routes' crumbs and the shell.
  Task 7 updates the router tests to assert the other placeholder routes are
  untouched and re-runs the full frontend suite.

**Blockers:** None.

## Dependency Order

1. Task 1 typed read wrappers and error copy → enables all feature state.
2. Task 2 project + Git data hook → enables the header, Git block, and route.
3. Task 3 availability callback in reused actions → enables the
   open-folder-to-banner flow.
4. Tasks 1–3 → enable Task 4 header and unavailable banner.
5. Task 1 → enables Task 5 Git changes block.
6. Tasks 2–5 → enable Task 6 route composition.
7. Task 6 → enables Task 7 breadcrumb selector, topbar subscription, and the
   real route swap.
8. Tasks 1–7 → enable Task 8 slice-wide verification and the manual smoke
   check.

---

### Task 1: Complete the Projects Read Boundary and Git Error Copy

**Outcome:** Frontend code has typed wrappers for `open_project`,
`get_project`, and `get_project_git_status`, plus overview/Git failure
classification that follows the existing `project-error-copy.ts` conventions.

**Depends On:** None

**Files:**

- Modify: `src/lib/ipc/projects.ts`
- Modify: `src/lib/ipc/projects.test.ts`
- Modify: `src/features/projects/project-error-copy.ts`
- Consume unchanged: `src/lib/ipc/ipc-error.ts`,
  `src/bindings/projects/projects.ts`

**Interfaces:**

- Consumes: the established `invokeProjects` helper, Tauri `listen`, the
  existing `onProjectsChanged`, and the generated `ProjectDto`,
  `ProjectGitStatusDto`, and `ProjectsError` types.
- Produces:
  - `openProject(projectId: string): Promise<ProjectDto>`
  - `getProject(projectId: string): Promise<ProjectDto>`
  - `getProjectGitStatus(projectId: string): Promise<ProjectGitStatusDto>`
  - `OVERVIEW_OPEN_FAILED_MESSAGE = "XWork couldn't open this project."`
  - `OVERVIEW_REFRESH_FAILED_MESSAGE = "XWork couldn't refresh this project."`
  - `gitStatusFailedMessage(name: string): string` returning
    `XWork couldn't read Git status for {name}.`
  - `ProjectReadFailure = { kind: "retryable"; message: string } |
    { kind: "gone" } | { kind: "integration"; message: string }`
  - `ProjectGitFailure = { kind: "retryable"; message: string } |
    { kind: "unavailable" } | { kind: "gone" } |
    { kind: "integration"; message: string }`
  - `classifyProjectReadFailure(rejection: unknown, mode: "open" |
    "refresh"): ProjectReadFailure` — `open` maps `clockFailed` and
    `persistenceFailed` to the open-failure message; `refresh` maps
    `persistenceFailed` to the refresh-failure message; both map
    `projectNotFound` and `removalInProgress` to `gone`; everything else,
    including `invalidProjectId` and `unauthorizedWindow`, is `integration`.
  - `classifyGitFailure(rejection: unknown, name: string):
    ProjectGitFailure` — `gitInspectionFailed` is `retryable` with
    `gitStatusFailedMessage(name)`; `projectNotFound` and
    `removalInProgress` are `gone`; `projectUnavailable` is `unavailable`;
    everything else is `integration`.

- [ ] **Step 1: Extend the focused IPC contract tests**

  Add assertions for the three new wrappers: exact command names
  (`open_project`, `get_project`, `get_project_git_status`), camelCase
  `{ projectId }` argument objects, typed return values, and preservation of
  typed error payloads (including `gitInspectionFailed` with its snake_case
  `project_id` field and unknown rejections keeping `payload === null`).
  Preserve all existing wrapper and event coverage.

- [ ] **Step 2: Verify the adapter tests fail for missing exports**

  Run: `pnpm exec vitest run src/lib/ipc/projects.test.ts`

  Expected: Vitest discovers the target and fails because `openProject`,
  `getProject`, and `getProjectGitStatus` are not exported by
  `src/lib/ipc/projects.ts`.

- [ ] **Step 3: Add the minimum wrappers and copy tables**

  Extend `invokeProjects` usage for the three commands without mirror types.
  Add the two message constants, `gitStatusFailedMessage`, and the two
  classifiers to `project-error-copy.ts` using the existing
  `projectsErrorOf` reader and exhaustive-switch style. The classifiers are
  exercised through the Task 2 hook tests; do not add a separate copy-table
  test file.

- [ ] **Step 4: Verify the boundary constraints**

  Run:

  - `pnpm exec vitest run src/lib/ipc/projects.test.ts`
  - `pnpm typecheck`
  - `git diff --exit-code -- package.json pnpm-lock.yaml src/bindings src-tauri`

  Expected: every adapter assertion passes, the new signatures type-check,
  and no manifest, lockfile, generated binding, or backend file has changed.

### Task 2: Build the Race-Safe Project and Git Overview Hook

**Outcome:** One route-local hook loads the project with `open_project`
exactly once per mount, refreshes metadata and Git through the read-only
commands on focus and `projects://changed`, classifies every documented error
branch, and never lets a stale result land.

**Depends On:** Task 1

**Files:**

- Create: `src/features/projects/use-project-overview.ts`
- Test: `src/features/projects/use-project-overview.test.ts`

**Interfaces:**

- Consumes: `openProject`, `getProject`, `getProjectGitStatus`,
  `onProjectsChanged`, `classifyProjectReadFailure`,
  `classifyGitFailure`, `ProjectReadFailure`, `ProjectGitFailure`, generated
  `ProjectDto`/`ProjectGitStatusDto`/`ProjectChangedEventDto`, and the
  browser `focus` event.
- Produces:

  ```ts
  interface UseProjectOverviewOptions {
    projectId: string;
    onGone(): void;
  }

  type GitSnapshotState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; snapshot: ProjectGitStatusDto }
    | { status: "failed"; message: string };

  interface ProjectOverviewData {
    status: "loading" | "ready" | "failed";
    project: ProjectDto | null;
    failure: ProjectReadFailure | null; // inline refresh failure only
    git: GitSnapshotState;
    load(): void;
    refreshProject(): void;
    retryGit(): void;
  }

  export function useProjectOverview(
    options: UseProjectOverviewOptions,
  ): ProjectOverviewData;
  ```

- Behavior contract: `load()` runs `openProject` (full-page loading → ready →
  failed for retryable/integration open failures; `onGone()` for gone).
  After a ready snapshot, Git is queried only while availability is
  `available`; `unavailable` sets Git to `idle`. `refreshProject()` uses only
  `get_project`, keeps the previous project on failure, and records the inline
  `failure`. Focus and `projects://changed` call `refreshProject()` and then
  re-query Git; a `removed` event for the current project calls `onGone()`.
  The event payload is never applied to state — it is only an invalidation
  key, which makes the `Updated` event emitted by `open_project` a harmless
  extra refresh. A Git `unavailable` classification resets Git to `idle` and
  calls `refreshProject()`; a Git `gone` classification calls `onGone()`.
  Every query records the current token and publishes only while it still
  matches; unmount bumps the token and removes both listeners.
- Test seams: `vi.mock("@/lib/ipc/projects")` with deferred promises for the
  three wrappers and `onProjectsChanged`; spied
  `window.addEventListener`/`removeEventListener`; `renderHook` from
  Testing Library; no real timers, files, or Tauri runtime.

- [ ] **Step 1: Add the hook contract tests**

  Cover: `openProject` called exactly once on mount with the route's
  `projectId`; the ready-available → Git query order; unavailable projects
  never querying Git; focus and `projects://changed` using `getProject` and
  re-querying Git; the `removed` event and every `gone` classification
  invoking `onGone()`; the extra `Updated` event causing only a refresh;
  `refreshProject` keeping old data on failure; open failures producing the
  full-page state with the exact message; the Git `retryable`,
  `unavailable`, and `integration` branches; `retryGit()` re-invoking only
  `getProjectGitStatus`; a deferred older result being dropped after a newer
  refresh; and unmount removing listeners and invalidating in-flight results.

- [ ] **Step 2: Verify the hook target fails because it does not exist**

  Run: `pnpm exec vitest run src/features/projects/use-project-overview.test.ts`

  Expected: Vitest discovers the named target and fails to resolve
  `./use-project-overview`.

- [ ] **Step 3: Implement the minimum hook**

  Keep all project and Git state inside the hook; do not write into the
  shared projects store. Use one `useRef` token, register the event listener
  and focus listener once per mount, and clean both up on unmount. Route all
  rejections through the Task 1 classifiers.

- [ ] **Step 4: Verify the task**

  Run: `pnpm exec vitest run src/features/projects/use-project-overview.test.ts`

  Expected: every listed case passes, including both deferred-race cases.

### Task 3: Add the Availability Callback to the Reused Action Hook

**Outcome:** `useProjectActions` reports an `open_project_folder`
`projectUnavailable` rejection to the overview while keeping FE-004 behavior
identical when no callback is supplied.

**Depends On:** None

**Files:**

- Modify: `src/features/projects/use-project-actions.ts`
- Test: `src/features/projects/use-project-actions.test.ts`

**Interfaces:**

- Consumes: the existing `ProjectActionsOptions`, `openFolder` flow, and
  `projectsErrorOf`.
- Produces: `ProjectActionsOptions.onUnavailable?(): void`, invoked after a
  settled `open_project_folder` rejection whose typed code is
  `projectUnavailable`, immediately before the existing
  `publishFailure(rejection, project, "openFolder")` path runs unchanged.

- [ ] **Step 1: Add the callback tests**

  Extend the existing target: an `open_project_folder` rejection of
  `{ code: "projectUnavailable", reason: "missing" }` invokes `onUnavailable`
  exactly once while still publishing the existing open-folder failure; a
  consumer that passes no callback keeps the current failure behavior with no
  throw; non-availability rejections never invoke the callback.

- [ ] **Step 2: Verify the new tests fail for the missing option**

  Run: `pnpm exec vitest run src/features/projects/use-project-actions.test.ts`

  Expected: the target is discovered and the new cases fail because
  `ProjectActionsOptions` has no `onUnavailable` member, so the callback is
  never invoked.

- [ ] **Step 3: Implement the minimum extension**

  Destructure the optional callback beside `onRemoved`, and inside the
  `openFolder` catch — after the token check succeeds — read the typed error
  and invoke `onUnavailable` only for `projectUnavailable`. Change nothing
  else in the hook.

- [ ] **Step 4: Verify the task**

  Run: `pnpm exec vitest run src/features/projects/use-project-actions.test.ts`

  Expected: the new cases and every pre-existing FE-004 action case pass.

### Task 4: Build the Overview Header, Timestamps, Copy Path, and Unavailable Banner

**Outcome:** The header renders the display name with pinned/unavailable
indicators, the mono path with `Copy path` and `Open folder`, every branch of
the Git summary line with formatted timestamps, the locked `New Session`
entry point, `More actions`, and — for unavailable roots — the reason banner
with its two direct actions.

**Depends On:** Tasks 1, 2, 3

**Files:**

- Create: `src/features/projects/project-overview-header.tsx`
- Test: `src/features/projects/project-overview-header.test.tsx`
- Consume unchanged: `src/features/projects/project-actions-menu.tsx`,
  `src/components/ui/button.tsx`, `src/components/ui/tooltip.tsx`

**Interfaces:**

- Consumes: generated `ProjectDto` and `ProjectGitSummaryDto`, the Git
  snapshot state from Task 2, `ProjectActionsMenuProps`-style callbacks from
  the reused menu, `unavailableReasonMessage`, `Button`, `Tooltip`, and
  Lucide icons.
- Produces:
  - `ProjectOverviewHeader` with props for the project, the Git summary
    (or `null` while Git is loading/failed/not applicable), an
    `isActionsBusy` flag, and the five menu intents
    (`onOpenRename`, `onTogglePinned`, `onOpenFolder`, `onLocateFolder`,
    `onRequestRemove`).
  - `ProjectUnavailableBanner` (same file) with the project,
    `onLocateFolder`, and `onRequestRemove`.
  - `formatAddedAt(addedAtMs: number, nowMs: number): string` and
    `formatOpenedAt(lastOpenedAtMs: number, nowMs: number): string`
    implementing the exact FE-005 relative/absolute formats with
    `Intl.DateTimeFormat("en", …)`.
- Behavior contract: the path element carries the full root in `title` and
  ellipsizes; `Copy path` writes `project.rootPath` through
  `navigator.clipboard.writeText`, swaps its tooltip/label to `Copied` for
  two seconds, announces `Path copied` (or
  `XWork couldn't copy the path.`) in one polite live region, and stays
  retryable after failure. `Open folder` is disabled while unavailable.
  `New Session` is always `aria-disabled="true"` at Stage 5, focusable, with
  tooltip `Session creation isn't available yet.` — or
  `The project folder is unavailable.` while the root is unavailable. The
  Git line renders `Not a Git repository` (no badge), `Bare repository`
  (badge only when `head` exists), or the badge plus
  `clean` / `{n} changed` / ` · {u} untracked` summary, followed by
  `· added … · opened …`. The banner shows the exact reason message, the
  sentence `Sessions cannot start until the path is valid again.`, and the
  two direct buttons running the same menu flows.
- Test seams: `vi.setSystemTime` for the formatters and the two-second
  revert; a stubbed `navigator.clipboard` with deferred promises; render
  helpers that pass mock DTOs directly; no IPC at all in this target.

- [ ] **Step 1: Add the header component tests**

  Cover: name with visually hidden `Pinned` and the `Unavailable` badge; the
  path `title`; copy-path success, live-region text, the two-second revert,
  the failure branch, and retry; `Open folder` disabled exactly when
  unavailable; `New Session` focusable with `aria-disabled` and both tooltip
  variants; the Git line branches `notRepository`, `bare` with and without
  `head`, `branch`, `unborn` (`no commits yet`), `detached` (`({shortOid})`),
  `clean`, `changed`, and `changed · untracked` with `untrackedCount === 0`
  omitted; the added/opened formats across the minute, hour, day, yesterday,
  same-year, and other-year boundaries; each of the four banner reasons with
  the fixed sentence and both buttons forwarding intent; and the header-local
  Tab order `Copy path` → `Open folder` → `New Session` → `More actions`.

- [ ] **Step 2: Verify the header target fails because it does not exist**

  Run:
  `pnpm exec vitest run src/features/projects/project-overview-header.test.tsx`

  Expected: Vitest discovers the named target and fails to resolve
  `./project-overview-header`.

- [ ] **Step 3: Implement the minimum header and banner**

  Keep the header presentational: all commands stay with the route. Match the
  existing FE-004 card/header styling conventions, reuse the warning tokens
  for the banner, and clear the copy-path timer on unmount. Embed
  `ProjectActionsMenu` unchanged for the `More actions` cluster.

- [ ] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/projects/project-overview-header.test.tsx`

  Expected: every listed case passes with the controlled clock and clipboard.

### Task 5: Build the Read-Only Git Changes Block

**Outcome:** The `Changes on {head} ({changedCount})` block renders every
generated change kind with its letter badge and visually hidden full name,
renames/copies with `previousPath`, untracked directories verbatim, the clean
state, and the permanent read-only note.

**Depends On:** Task 1

**Files:**

- Create: `src/features/projects/project-git-changes.tsx`
- Test: `src/features/projects/project-git-changes.test.tsx`

**Interfaces:**

- Consumes: generated `ProjectGitStatusDto` (summary + changes).
- Produces: `ProjectGitChanges` accepting one `ProjectGitStatusDto` and
  rendering only the `worktree` shape (the route gates other repository
  kinds). The block label uses the branch name, unborn name, or detached
  `shortOid`, followed by `({changedCount})`. The fixed footer line is
  `Read-only. Commit, checkout and push happen in your terminal.` and the
  clean line is `Working tree is clean.`
- Badge map (letter → hidden name): `A`→`Added`, `M`→`Modified`,
  `D`→`Deleted`, `R`→`Renamed`, `C`→`Copied`, `T`→`Type changed`,
  `??`→`Untracked`, `U`→`Conflicted`. Rows with `previousPath` render
  `{previousPath} → {path}`. `isDirectory` rows render `path` verbatim
  (the backend already guarantees the trailing `/`); the frontend never
  appends a separator.
- Test seams: plain mock DTOs; no IPC, filesystem, or Git access.

- [ ] **Step 1: Add the change-list tests**

  Cover: all eight badges with their hidden names; the previous-path arrow;
  an untracked directory keeping its trailing `/` verbatim; the three head
  label variants; `changedCount` in the label for zero and non-zero; the
  clean line; the exact read-only footer; and long lists rendering every row
  without pagination.

- [ ] **Step 2: Verify the block target fails because it does not exist**

  Run: `pnpm exec vitest run src/features/projects/project-git-changes.test.tsx`

  Expected: Vitest discovers the named target and fails to resolve
  `./project-git-changes`.

- [ ] **Step 3: Implement the minimum block**

  Use a fixed-width badge, mono row styling, and accessible hidden names; add
  no interaction to the rows (file opening arrives in Phase 2).

- [ ] **Step 4: Verify the task**

  Run: `pnpm exec vitest run src/features/projects/project-git-changes.test.tsx`

  Expected: every listed case passes.

### Task 6: Compose the Project Overview Route

**Outcome:** `ProjectOverviewRoute` owns the page layout and state mapping:
skeleton while loading, the full-page open failure, silent navigation for
gone projects, the ready header with actions/banner, the Git area states, the
reused dialogs, the inline refresh failure, and the Stage 5 absence of the
sessions block.

**Depends On:** Tasks 2, 3, 4, 5

**Files:**

- Create: `src/features/projects/project-overview-route.tsx`
- Test: `src/features/projects/project-overview-route.test.tsx`
- Consume unchanged: `src/features/projects/rename-project-dialog.tsx`,
  `src/features/projects/remove-project-dialog.tsx`

**Interfaces:**

- Consumes: `useProjectOverview`, `useProjectActions`,
  `ProjectOverviewHeader`, `ProjectGitChanges`, `RenameProjectDialog`,
  `RemoveProjectDialog`, React Router's `useParams`/`useNavigate`, and the
  Task 1 failure types.
- Produces: `export function ProjectOverviewRoute(): JSX.Element` — the
  feature's public route entry.
- Behavior contract: `onGone` closes any open rename/remove dialog and
  navigates to `/projects` with no error message. `useProjectActions`
  receives `onRemoved` (navigate to `/projects`) and `onUnavailable`
  (`overview.refreshProject()`). Loading renders the header skeleton (name
  block, path line, Git line; no action buttons). Open failure replaces the
  page with `XWork couldn't open this project.` and a `Try again` button
  calling `load()`. Ready renders the header; when unavailable, the banner
  replaces the Git area and `ProjectGitChanges` is not rendered. The Git area
  renders a horizontal skeleton while loading, the failed message with one
  `Try again` calling `retryGit()`, the changes block for `worktree`, and
  nothing extra for `notRepository`/`bare` (their line already lives in the
  header). An inline refresh failure keeps the old data and offers `Try
  again` via `refreshProject()`. Action failures render below the header with
  dismiss and retry semantics identical to FE-004. The page container uses
  `28px 32px` padding, scrolls vertically only, and stays single-column. The
  sessions block is not rendered and no session query is made.
- Test seams: `vi.mock("@/lib/ipc/projects")` (deferred wrappers plus the
  event), `vi.mock` for nothing else — header and block run for real;
  `MemoryRouter`/`renderWithRouter`-style navigation capture; fake timers
  where timestamps matter.

- [ ] **Step 1: Add the route tests**

  Cover: the loading skeleton; the full-page failure and its retry; gone
  classifications navigating to `/projects` and closing an open dialog; the
  ready layout with header, Git area, and menu trigger; the unavailable
  banner suppressing the Git block; Git loading/failed/worktree states with
  `Try again` invoking `get_project_git_status` exactly once per click; the
  inline refresh failure keeping stale-but-visible data; rename/pin/locate
  flows refreshing the header without a full reload; confirmed removal
  navigating to `/projects`; the `removed` event navigating away; the
  content Tab order including banner buttons and every visible `Try again`;
  and an explicit assertion that no element matches
  `Sessions in this run`.

- [ ] **Step 2: Verify the route target fails because it does not exist**

  Run:
  `pnpm exec vitest run src/features/projects/project-overview-route.test.tsx`

  Expected: Vitest discovers the named target and fails to resolve
  `./project-overview-route`.

- [ ] **Step 3: Implement the minimum route**

  Compose the Task 2–5 pieces and the FE-004 dialog/menu wiring. Keep the
  route free of direct IPC imports; everything goes through the two hooks.

- [ ] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/projects/project-overview-route.test.tsx`

  Expected: every listed case passes.

### Task 7: Wire the Breadcrumb Label and the Real Route

**Outcome:** The route table mounts `ProjectOverviewRoute`, the second crumb
reads the display name through `readProjectCrumbLabel`, and the topbar
re-renders the label from the store snapshot after in-place renames — with
every other route unchanged.

**Depends On:** Task 6

**Files:**

- Modify: `src/features/projects/projects-store.ts`
- Test: `src/features/projects/projects-store.test.ts`
- Modify: `src/app/app-topbar.tsx`
- Test: `src/app/app-topbar.test.tsx`
- Modify: `src/app/app-router.tsx`
- Test: `src/app/app-router.test.tsx`

**Interfaces:**

- Consumes: the existing `useProjectsStore` and its retained snapshot; the
  Task 6 `ProjectOverviewRoute`; the existing `RouteCrumbHandle` contract.
- Produces:
  - `export function readProjectCrumbLabel(projectId: string | undefined):
    string` reading the current store snapshot and returning `""` when the
    project is absent.
  - The `/projects/:projectId` route entry with
    `element: <ProjectOverviewRoute />` and
    `handle: crumbs((params) => ["Projects", readProjectCrumbLabel(params.projectId)])`.
  - A `Breadcrumb` subscription in `app-topbar.tsx` selecting the store's
    `projects` array so label changes re-render without navigation. The
    subscription acquires no consumer and writes no shell state.

- [ ] **Step 1: Add the selector, topbar, and router tests**

  Store: `readProjectCrumbLabel` returns the display name for a present id,
  `""` for an absent id, and `""` for `undefined`. Topbar: the crumb label
  follows the store snapshot and changes after a rename while the route
  stays put; non-project routes keep their existing labels. Router: the
  project route renders the real overview (not `AreaPlaceholder`), the crumb
  shows the display name, and the notes/calendar/settings/session placeholder
  routes are unchanged (the session crumb still echoes the opaque id). Extend
  the router test's existing `@/lib/ipc/projects` mock with the three new
  wrappers so the real route can mount.

- [ ] **Step 2: Verify the new tests fail for the missing wiring**

  Run:

  - `pnpm exec vitest run src/features/projects/projects-store.test.ts`
  - `pnpm exec vitest run src/app/app-topbar.test.tsx src/app/app-router.test.tsx`

  Expected: the store target fails because `readProjectCrumbLabel` is not
  exported; the app targets fail because the project route still renders the
  `AreaPlaceholder` and the topbar does not subscribe to the store.

- [ ] **Step 3: Implement the selector, subscription, and route swap**

  Read the label from `useProjectsStore.getState().projects` inside the
  selector, subscribe with a Zustand selector in `Breadcrumb`, and swap only
  the project route's `element` and crumb. Keep the `AreaPlaceholder` import
  for the remaining routes.

- [ ] **Step 4: Verify the task**

  Run:

  - `pnpm exec vitest run src/features/projects/projects-store.test.ts src/app/app-topbar.test.tsx src/app/app-router.test.tsx`

  Expected: the new cases and every pre-existing shell/sidebar/router case
  pass.

### Task 8: Slice-Wide Verification and Manual Windows Smoke Check

**Outcome:** All quality gates, boundary checks, and the targeted manual
Windows smoke checklist pass for the Stage 5 slice, and the outcome is
recorded.

**Depends On:** Tasks 1–7

**Files:**

- Modify: `00-Docs/98-Plan/20260903-fe-005-project-overview.md` (checklists,
  deviations, and outcome only)

**Interfaces:**

- Consumes: every interface produced by Tasks 1–7.
- Produces: verification evidence recorded in this plan.

- [ ] **Step 1: Run the full command gates**

  Execute the Final Verification table below and record each result.

- [ ] **Step 2: Run the targeted manual Windows smoke check**

  Execute the checklist below on a disposable Windows profile with throwaway
  Git repositories, using `pnpm tauri dev`, and record the observed result
  for each numbered item.

- [ ] **Step 3: Record deviations and outcome**

  Append any material deviation or decision to “Deviations and Decisions”,
  then complete the “Outcome” section with the delivered result, the
  verification evidence, and the known Stage 8/16 limitations.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Focused FE-005 tests | `pnpm exec vitest run src/lib/ipc/projects.test.ts src/features/projects/use-project-overview.test.ts src/features/projects/use-project-actions.test.ts src/features/projects/project-overview-header.test.tsx src/features/projects/project-git-changes.test.tsx src/features/projects/project-overview-route.test.tsx src/features/projects/projects-store.test.ts src/app/app-topbar.test.tsx src/app/app-router.test.tsx` | All nine named targets are discovered and every FE-005 contract assertion plus the FE-004/FE-001 regression assertions passes |
| Frontend format | `pnpm format:check` | No formatting differences |
| Frontend lint | `pnpm lint` | Pass with no lint errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Full frontend tests | `pnpm test` | All unit and component tests pass; no automated desktop end-to-end test is added |
| Frontend production build | `pnpm build` | The SPA bundle succeeds with the real overview route |
| Rustfmt regression | `pnpm format:rust` | No Rust formatting difference |
| Clippy regression | `pnpm lint:rust` | All Rust targets/features pass with warnings denied |
| Rust test regression | `pnpm test:rust` | All Rust unit, integration, and contract tests pass |
| Windows desktop build | `pnpm tauri build` | The Windows Tauri build succeeds with the unchanged backend commands and the real overview wired into the route |
| No deferred session content | `rg -n -F -e "Sessions in this run" -e "list_sessions" -e "create_session" -e "sessions://runtime-changed" src` | No match is returned; the sessions block and sessions IPC belong to Stage 8 |
| No direct platform access | `rg -n "@tauri-apps/api|invoke\(|listen\(" src/features/projects` | No match is returned; all backend access remains in `src/lib/ipc/projects.ts` (`navigator.clipboard` is the documented webview exception) |
| No webview persistence | `rg -n "localStorage|sessionStorage|indexedDB|document\.cookie" src/features/projects src/app` | No match is returned |
| No handwritten backend DTO | `rg -n "^(export )?(type|interface) (ProjectDto|ProjectGitStatusDto|ProjectGitSummaryDto|GitFileChangeDto|GitFileChangeKindDto|GitHeadDto|GitRepositoryKindDto|ProjectChangedEventDto|ProjectsError)" src --glob "!src/bindings/**"` | No handwritten backend-contract declaration is found |
| Generated/backend/config boundary | `git diff --exit-code -- src/bindings src-tauri package.json pnpm-lock.yaml` | No generated binding, backend, capability, Tauri configuration, dependency, or lockfile change exists in this slice |

## Manual Windows Smoke Check

Run on a disposable Windows account or virtual machine whose XWork app-data
directory has never contained user data, with throwaway project folders that
include a clean Git repository, a repository with modified, renamed, and
untracked-directory entries, a detached-HEAD repository, and a plain non-Git
folder. Use `pnpm tauri dev`. Do not point any check at real work.

1. Open a project from the sidebar row, from a card's `Open` button, and
   right after Add Project. Expected: the overview mounts for each entry,
   shows `opened just now`, and the breadcrumb reads
   `Projects / {displayName}`.
2. Edit or add a file in the project folder externally, wait at least one
   minute, and bring the window back to the foreground. Expected: the Git
   summary and change list refresh, while the opened stamp reads
   `opened 1m ago` (not `opened just now`), proving focus used `get_project`
   rather than `open_project`.
3. Click `Copy path` and paste into Notepad. Expected: the full root path is
   pasted, the control shows `Copied` for two seconds, and a screen-reader
   pass hears `Path copied` once.
4. Click `Open folder`. Expected: Windows Explorer opens the project root.
5. Rename the project from `More actions`, then pin and unpin it. Expected:
   the header, pin indicator, and breadcrumb update without navigation, and
   the rename dialog opens with the current name.
6. Rename the project folder on disk, then focus the window. Expected: the
   header gains the `Unavailable` badge, the banner shows `Folder not found.`
   with the fixed sentence, `New Session` and `Open folder` are locked, and
   `Locate folder…` through the native picker restores the Available state
   and re-queries Git.
7. While unavailable, confirm `Remove Project` from the banner. Expected: the
   impact dialog reuses the FE-004 flow and confirmation navigates to
   `/projects`.
8. Inspect the Git states: clean repository (`clean` and
   `Working tree is clean.`), the dirty repository (letter badges, the
   previous-path arrow, the untracked directory's trailing `/`), detached
   HEAD (`({shortOid})`), and the non-Git folder (`Not a Git repository`
   with no change block). Confirm the read-only footer is always present.
9. Tab through the ready page and the unavailable page. Expected: the
   documented order, visible focus rings, and a focusable `New Session`
   button with `aria-disabled` and the tooltip
   `Session creation isn't available yet.`
10. Remove the currently open project from the Projects page in another
    navigation path (or observe the `removed` event). Expected: the overview
    closes any open menu/dialog and navigates to `/projects` without its own
    error message.

## Deviations and Decisions

- None.

## Outcome

Pending implementation.
