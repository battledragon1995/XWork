# FE-017 Source Viewer Implementation Plan

**Status:** Implemented (native checklist pending)

**Goal:** Open project files from File Explorer into backend-owned tabs and panes, display authoritative read-only source snapshots or actionable unsupported states, and reflect external changes without losing pane identity or scroll position.

**Completion Criteria:**

- All FE-017 completion criteria are demonstrated, including first-tab creation, four placements, duplicate-activation prevention, read-only Markdown, every handle state, event recovery, and reset maintenance.
- Header and body share one handle query; remounting a cached tab reuses its snapshot and scroll position. Distinct handles for the same path remain independent.
- Production uses the existing BE-014 commands. No Rust, generated binding, capability, persistence, or global shortcut change is introduced.
- All final automated gates pass on Windows, and the targeted native checklist has recorded observations. Unperformed manual checks remain explicitly pending.

**Architecture:** Sessions owns target preparation and its existing structural mutation slot. Files owns Explorer opening and an application-level handle registry; CodeMirror renders read-only text through a Files-local adapter. `src/app/` connects the public render slots, providers, navigation, and reset maintenance without direct Files-to-Sessions imports.

**Tech Stack:** Existing React 19.2.8, TypeScript 7.0.2, Vite 8.2.2, Vitest 4.1.11, React Testing Library, Tauri 2, and generated Files/Sessions DTOs (data transfer objects); CodeMirror 6 packages pinned below. Node.js 24 and pnpm 11.25.0 remain unchanged.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`, and `00-Docs/99-Template/04-Plan.md`.
- Roadmap: [Stage 16](00-Roadmap.md), Phase 2; this plan covers FE-017, not the separate FE-005 recent-files extension or all of stage16.
- [Tech Stack](../00-Overview/01-TechStack.md), [Project Structure](../00-Overview/02-ProjectStructure.md), and [Functional Requirements](../00-Overview/03-FunctionalRequirements.md), sections 9.1–9.2, 11.1–11.2, 17.2, 18, and Phase 2.
- Primary contract: [FE-017](../02-Frontend/FE-017-source-viewer.md).
- Existing presentation contracts: [FE-001](../02-Frontend/FE-001-application-shell.md), [FE-006](../02-Frontend/FE-006-session.md), [FE-007](../02-Frontend/FE-007-tabs-and-panes.md), [FE-012](../02-Frontend/FE-012-settings-appearance.md), [FE-016](../02-Frontend/FE-016-file-explorer.md).
- Backend contracts: [BE-014](../03-Backend/BE-014-file-read-and-watch.md), [BE-005](../03-Backend/BE-005-sessions-runtime.md), [BE-013](../03-Backend/BE-013-file-tree.md), [BE-003](../03-Backend/BE-003-projects.md), [BE-008](../03-Backend/BE-008-settings-persistence.md).
- Wireframes: [source](../01-Wireframe/05-Files.html#source), [unsupported](../01-Wireframe/05-Files.html#unsupported), [Explorer](../01-Wireframe/05-Files.html#explorer), [one pane](../01-Wireframe/04-Projects.html#panes-1), [two panes](../01-Wireframe/04-Projects.html#panes-2), and [pane picker](../01-Wireframe/04-Projects.html#pane-picker).

## Scope

**In Scope:**

- File click/Enter opens a new tab; Space selects only. Four file-only context-menu placements are enabled according to Sessions' current snapshot and pending operations.
- Lift `useWorkspaceMutations` to route ownership; add file header/body rendering slots and retain terminal behavior.
- Add four BE-014 wrappers and one handle-change listener; reuse BE-013 path resolution and the existing clipboard mechanism.
- Implement handle snapshots, bounded cache eviction, external invalidation, focus recovery, reload/open-external/copy actions, and reset reconciliation.
- Implement CodeMirror read-only source, all specified dynamic languages, status facts, unsupported and recovery states, accessibility, and Appearance tokens.
- Replace only the obsolete Explorer, file-placeholder, and pane-picker copy identified by FE-017.

**Out of Scope:**

- Markdown editing, saving, preview, dirty-state management, and `resolve_external_file_change`.
- Recent-files UI or subscriptions, FE-005 implementation, Command Palette file activation, and a functional File column in the pane picker.
- Find, go-to-line, folding, minimap, diff, language servers, file mutations, ignore-policy changes, and additional global shortcuts.
- Rust changes, migrations, generated bindings, desktop permissions/configuration, additional libraries beyond the manifest below, macOS checks, automated desktop end-to-end tests, and Git commits.

## Global Constraints

The following project rules apply to every task:

- "Write code, identifiers, and code comments in English."
- "The initial UI language is English."
- "Keep OS access, persistence, terminal processes, and business rules in Rust; the React frontend communicates with them through narrowly scoped Tauri commands and events."
- "Frontend features do not import implementation from other features."
- "Generated bindings under `src/bindings/` are not edited manually."
- "Every function, method, callback, test, and helper must have a short comment describing its purpose."
- "Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state."
- "During development, build and test only on Windows."
- "Do not add or run automated desktop end-to-end tests."

Use English copy from FE-017, the existing copied UI components, and UTF-8 Markdown. No project source content is persisted or logged by this feature. Runtime IPC (inter-process communication) is real: the matching BE-014 integration already exists, so the pre-backend mock phase described in PLANS.md does not apply. Test doubles remain confined to tests.

## Assumptions, Risks, and Blockers

**Assumptions:**

- FE-017 has no open questions. Its explicit stage16 decisions supersede FE-016's temporary viewing limitation without requiring historical plans to be rewritten.
- Repository inspection confirms BE-014 command registration and `src/bindings/files/files.ts` already exist. `src/lib/ipc/files.ts` currently contains only the four Explorer wrappers.
- `SessionWorkspace` currently creates `useWorkspaceMutations` and owns its tool-catalog callbacks. Moving the hook requires preserving those callbacks and handling the route's initial absence of `SessionDetailDto` without fabricated data or conditional hooks.
- The BE-014 historical plan records successful automated gates but leaves native smoke observations pending. This plan supplies viewer-level Windows observations; it does not retroactively mark unrelated backend performance work complete.

**Risks and mitigations:**

- Two consumers, React remounts, or event bursts can duplicate requests. Task 3 tests a shared in-flight read, decimal revision ordering, and stale-result rejection.
- A newer event can arrive after an in-flight query captured an older snapshot. Keep the greatest requested revision; perform one follow-up read only if the completed snapshot is still behind it. A burst already covered by that snapshot must cause no additional read.
- Preparing a pane and attaching a file are separate backend calls. Task 2 serializes target preparation using the existing slot; Task 6 retains the Explorer guard through attachment and handles a target becoming stale between calls. Never claim the two commands are an atomic backend transaction.
- An already-sent native command cannot be cancelled by retiring frontend intent. After route/boundary changes, suppress publication and further commands; never clean up a possibly created pane automatically.
- Native editor behavior cannot be proven by a mocked view. Task 4 tests configuration and update wiring; Task 8 verifies typing, paste, copy, focus, scrolling, and external reload in Windows WebView2.
- Large language bundles or long lines can harm responsiveness. Dynamic loaders, the exact syntax threshold, constrained pane overflow, and a production build address this risk.

**Blockers:** None identified for writing or executing this frontend plan. Installation/build compatibility and native acceptance remain execution gates, not claimed results.

## Exact Dependencies

Merge these complete entries into `package.json` under `dependencies`; keep all existing entries unchanged:

```json
{
  "@codemirror/state": "6.7.4",
  "@codemirror/view": "6.43.11",
  "@codemirror/language": "6.12.4",
  "@lezer/highlight": "1.2.3",
  "@codemirror/legacy-modes": "6.5.4",
  "@codemirror/lang-rust": "6.0.2",
  "@codemirror/lang-javascript": "6.2.5",
  "@codemirror/lang-json": "6.0.2",
  "@codemirror/lang-html": "6.4.12",
  "@codemirror/lang-css": "6.3.1",
  "@codemirror/lang-markdown": "6.5.2",
  "@codemirror/lang-python": "6.2.1",
  "@codemirror/lang-yaml": "6.1.3",
  "@codemirror/lang-xml": "6.1.0",
  "@codemirror/lang-sql": "6.10.0",
  "@codemirror/lang-java": "6.0.2",
  "@codemirror/lang-cpp": "6.0.3",
  "@codemirror/lang-php": "6.0.2",
  "@codemirror/lang-go": "6.0.1"
}
```

Compatibility evidence collected on 2026-09-07: the npm registry package manifests were read for all 19 entries. The selected versions expose JavaScript module imports and have no declared Node engine or React peer restriction. Their declared CodeMirror state/view/language ranges accept the pinned versions above; legacy modes expose `./mode/*` imports. The local runtime reported Node.js `v24.15.0` and pnpm `11.25.0`, matching `package.json`. Representative versioned manifests: [state](https://registry.npmjs.org/@codemirror/state/6.7.4), [view](https://registry.npmjs.org/@codemirror/view/6.43.11), [language](https://registry.npmjs.org/@codemirror/language/6.12.4), [legacy modes](https://registry.npmjs.org/@codemirror/legacy-modes/6.5.4). The same versioned registry URL pattern applies to every entry above.

This is manifest-level compatibility evidence, not a claim that the new packages were installed or compiled during planning. Task 1 resolves the dependency tree; Tasks 4 and 8 verify TypeScript 7, Vite, and Windows WebView2 compatibility. Do not substitute newer versions silently if a gate fails; record and resolve the concrete incompatibility.

## Dependency Order

1. Task 1 establishes package pins, transport wrappers, and typed test fixtures.
2. Task 2 establishes Sessions target preparation and file render slots.
3. Task 3 builds the registry on Task 1; Task 4 builds the renderer on Task 1.
4. Task 5 composes the viewer states from Tasks 3–4.
5. Task 6 enables Explorer opening after Tasks 1–2.
6. Task 7 connects Tasks 2, 3, 5, and 6 to application lifecycle.
7. Task 8 verifies the complete integrated result.

### Task 1: Establish dependencies and the existing Files transport contract

**Outcome:** Frontend code can invoke the four viewer commands and receive handle invalidations using generated types.

**Depends On:** None.

**Files:** Modify `package.json`, `pnpm-lock.yaml`, `src/lib/ipc/files.ts`, `src/lib/ipc/files.test.ts`, and `src/features/files/files-test-fixture.ts`. Consume `src/bindings/files/files.ts` and `src/lib/ipc/ipc-error.ts` without changing them.

**Interfaces:** Add `openFileInPane(request: OpenFileInPaneRequestDto): Promise<OpenFileResultDto>`, `getOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto>`, `reloadOpenFile(request: FileHandleRequestDto): Promise<FileHandleDto>`, `openFileWithDefaultApp(request: FileHandleRequestDto): Promise<void>`, and `onFileHandleChanged(listener: (event: FileHandleChangedEventDto) => void): Promise<() => void>` to the existing wrapper module. These are frontend names for the existing BE-014 commands/event, not new native interfaces. Test seams are mocks of Tauri invoke/listen; fixtures produce generated DTO values including `bigint` byte counts and string revisions.

- [x] Merge the exact dependency entries, run `pnpm install`, then `pnpm install --frozen-lockfile`. Expect a synchronized lockfile with the stated direct versions and no engine or dependency-resolution failure. Keep this dependency change separately reviewable; do not upgrade other direct packages.
- [x] Extend the existing IPC test target with command-name/envelope assertions, typed success, normalized `FilesError`, unknown transport rejection, void success, event payload forwarding, and unlisten cleanup. Add the named wrapper exports with compilable signatures before running the red test; a temporary explicit rejection may establish missing behavior.
- [x] Run `pnpm exec vitest run src/lib/ipc/files.test.ts`. The new tests must be collected and fail because the expected native command or event subscription was not called, not because a file/export cannot be resolved.
- [x] Implement each wrapper through `invokeCommand` with `{ request }`, and the listener using the existing Tauri event convention. Do not add recent-file or conflict wrappers.
- [x] Extend the existing Files fixture with text, binary, too-large, missing/local, unreadable/local, root-change, conflict, open-warning, and handle-event factories. Keep all contents in memory.
- [x] Rerun the focused command and `pnpm typecheck`; expect correct transport assertions and no type errors. Later fixture-consuming suites validate the fixture variants.

### Task 2: Give the route one mutation owner and two file render regions

**Outcome:** Explorer can prepare a real empty target even in a session with zero tabs, and Sessions can render file headers/bodies without importing Files.

**Depends On:** Task 1.

**Files:** Modify `src/features/sessions/session-route.tsx`, `session-workspace.tsx`, `session-tool-picker.tsx`, `use-workspace-mutations.ts`, `session-layout.ts`, `pane-layout.tsx`, `session-pane.tsx`, and their same-basename `.test.ts`/`.test.tsx` files. All paths in this task are under `src/features/sessions/`. The existing `session-tool-picker.tsx` is an additional repository-confirmed integration point needed by the catalog ownership move.

**Interfaces:** Consume `SessionDetailDto`, existing `createTab`, `splitPane`, `setActivePane`, `flattenPanes`, `ToolCatalogData`, and `WorkspaceMutations`. Produce the exact FE-017 `SessionFilePlacement`, `SessionFileTarget`, `SessionPaneRegion`, `SessionFilePaneSlotProps`, and `SessionFilePaneRenderer` contracts; extend `SessionFileExplorerSlotProps` with placements, `prepareFileTarget`, and `onFileAttached`. `SessionWorkspace` receives the route-owned `mutations`, `catalog: ToolCatalogData`, and `renderFilePane`; `SessionToolPickerProps` receives the same `catalog: ToolCatalogData`. Tests mock `src/lib/ipc/sessions.ts`, not native runtime.

- [x] Add a failing route test for preparing the first file tab with `tabs: []`, and a pane test showing the file renderer is called for both `header` and `body`. Introduce compilable optional render props first; the red assertions are missing target preparation and missing renderer regions.
- [x] Move mutation ownership out of `SessionWorkspace`. In `session-route.tsx`, use a Sessions-local ready-state component in the same file, keyed by session identity, to own the hook only when a real detail exists. Keep it mounted across the empty/nonempty tab branches. Pass its one mutation object to the workspace.
- [x] Preserve `useToolCatalog` callbacks used by mutations by lifting the catalog owner into that same ready-state composition and passing it to both `SessionWorkspace` and `SessionToolPicker`. Remove their local catalog-hook calls and update picker tests to supply isolated `ToolCatalogData`. Do not create a second catalog subscription or lose profile-unavailable/check/retry handling. Preserve close dialogs, shortcuts, and terminal subtree identity.
- [x] Add the first-empty-pane lookup using the existing first-then-second layout traversal. Derive availability from the current active tab: new tab is available for an idle valid session, empty pane requires an empty leaf, and splits require a valid active pane and fewer than four leaves. All unavailable/busy/closing cases return `null` without creating a target.
- [x] Implement `prepareFileTarget(placement)` through the existing structural guard. Apply the returned authoritative detail before returning the target. New-tab/split targets come from the command result, never guessed identifiers; empty placement activates the first empty pane through `setActivePane` if necessary. Do not recursively enter the guard through another guarded action.
- [x] Recheck identity after awaited work. Retire the owner on session changes; a late result must not update the new route or initiate another command. Keep preparation errors visible through Sessions, including the zero-tab branch. Do not silently retry target creation after its opening intent has expired.
- [x] Thread `renderFilePane` through workspace/layout to each file leaf. File header uses the header region, body uses the body region; missing renderer retains root-path header and `PaneContentPlaceholder`. Other content retains existing rendering and pane controls.
- [x] Test all four placements, first-empty order on 1–4 panes, no-empty/limit/closing/busy refusals, command failures, route identity changes, first-tab errors, and regression tab/split/maximize/close/profile behavior.

**Verification:** Run:

```powershell
pnpm exec vitest run src/features/sessions/use-workspace-mutations.test.ts src/features/sessions/session-layout.test.ts src/features/sessions/session-route.test.tsx src/features/sessions/session-workspace.test.tsx src/features/sessions/pane-layout.test.tsx src/features/sessions/session-pane.test.tsx
pnpm exec vitest run src/features/sessions/session-tool-picker.test.tsx
pnpm typecheck
```

Expected: every named suite is collected, one preparation owns the structural slot, returned targets identify authoritative empty panes, and terminal/workspace regressions pass.

### Task 3: Retain authoritative snapshots outside pane lifetime

**Outcome:** One application registry provides shared, recoverable snapshots and actions for each handle.

**Depends On:** Task 1.

**Files:** Create `src/features/files/file-handle-registry.ts`, `file-handle-context.ts`, `file-handle-provider.tsx`, `file-handle-registry.test.ts`, and `file-handle-provider.test.tsx`. Modify `src/features/files/index.ts` to export the provider and maintenance hook. Extend the existing Files fixture as needed.

**Interfaces:** Implement the exact FE-017 `FileHandleEntryState`, `FileHandleEntry`, `FileHandleRegistry`, `FileHandleProvider`, `useFileHandleRegistry`, and `useFileDataBoundary` contracts. Consume Task 1 wrappers and `getFileEntryPaths`. The registry's constructor accepts a Files-local dependency object containing the four handle read/action/listener functions, `getFileEntryPaths`, and `writeText(text: string): Promise<void>`. Production uses real wrappers and clipboard; tests substitute fresh per-test fakes. Provider focus tests dispatch a synthetic window focus event; no native window is opened.

- [x] Create compilable registry/context/provider shells and fixture-backed tests before behavior. Initial red assertion: retaining header and body fails to issue exactly one `getOpenFile` and publish the same snapshot to both. Use the explicit command below and ensure both targets are collected.
- [x] Implement stable `getSnapshot` and `subscribe` for `useSyncExternalStore`, one entry per handle, one first-load request, and balanced retain/release. Do not issue requests during React render. Retain cached entries on zero references; evict only unused entries when the map exceeds 64. Never evict a retained entry to enforce the bound.
- [x] Store scroll position by handle, not path. Releasing and re-retaining a cached ready entry must not query. Invalid-handle errors retire/remove the entry while existing subscribers can still render its terminal nonretryable failure; stale callbacks must not recreate it.
- [x] Monitor `files://handle-changed` once. Compare decimal revisions with `BigInt`, including values beyond safe JavaScript integers and `9` to `10`. Ignore unknown handles and non-new revisions; read snapshots rather than patching from event `change`. Coalesce bursts and implement the high-water revision rule in Risks; never replace a newer snapshot with an older read response.
- [x] Focus refreshes retained entries only and coalesces with pending reads. No frontend polling timer is added. Native `pollingFallback` is a displayed backend fact, not a scheduler instruction.
- [x] Implement reload and open-external pending guards, fresh path lookup followed by awaited clipboard writing, and post-success messages. Recheck entry lifetime between awaits. A clipboard rejection never announces success. Requery after opener path/root errors. Preserve old content on recoverable reload errors.
- [x] Implement reset epochs: committed reset retires pending work, entries, and scroll state; uncertain reset queries retained entries without deleting them. Late reads, clipboard results, opener results, or listener registration cannot publish into a retired lifetime.
- [x] Inject listener-registration rejection: provider remains mounted, initial query and focus refresh work, and UI does not claim live subscription readiness. Inject delayed registration followed by unmount: the late unsubscribe is called exactly once. Stop/start and React development remounts must not leave duplicate listeners.
- [x] Test burst coalescing including a newer event behind an older pending result; missing/invalid IDs; read rejection/retry; reload/opener/copy failures; retained versus unused eviction; independent handles sharing a path; reset success/uncertainty; focus recovery; and all late-result suppression. Use bounded deferred promises; no real files or unbounded waits.

**Verification:** `pnpm exec vitest run src/features/files/file-handle-registry.test.ts src/features/files/file-handle-provider.test.tsx`. Expected: shared reads, revision convergence, lifecycle cleanup, and every injected failure behave as above with no surviving subscriptions.

### Task 4: Render source through a read-only, dynamically highlighted adapter

**Outcome:** Text is selectable and copyable, remains uneditable, and follows Appearance without rebuilding the view.

**Depends On:** Task 1.

**Files:** Create `src/features/files/source-language.ts`, `source-view-adapter.ts`, `source-view.tsx`, `file-facts.ts`, and their same-basename tests. Read `src/features/settings/appearance-theme.ts` and `src/index.css`; change `src/index.css` only if a demonstrated layout need cannot be handled locally with existing tokens.

**Interfaces:** Consume backend `TextFileDto`, `FileWatchModeDto`, and registry scroll callbacks. Keep adapter/language/facts APIs local to Files. Test seam: `source-view.test.tsx` mocks the adapter module and dynamic language loaders; adapter tests mock `EditorView` construction/update/destruction while inspecting real state facets and extension configuration. No real CodeMirror view is mounted in jsdom. Tests may create an in-memory `EditorState` to inspect configuration.

- [x] Create compilable modules and tests. Initial red assertions: read-only facet is not enabled, no line-number gutter is configured, and over-threshold text still invokes a language loader. Run the focused command below; module discovery failure is not accepted as evidence.
- [x] Implement the exact FE-017 extension-to-language table, including TypeScript/JSX options, C/C++, and Shell/PowerShell/TOML legacy modes via `StreamLanguage`. Use dynamic imports with static package paths. `null` and unknown hints are plain text; do not infer from names or content. Test every alias in the spec.
- [x] Enforce `SYNTAX_LIMIT` before loading: `byteSize > 2_097_152n` or `lineCount > 20_000`. Equality remains eligible. The viewer's backend limit is separate: text at 5,242,880 bytes still displays, without highlighting. Handle loader rejection once with plain text and the specified note; ignore late loaders for superseded content/unmounted views.
- [x] Configure CodeMirror state read-only and view noneditable while keeping the source surface focusable and selectable. Add line numbers; omit editing, indent-on-Tab, history, search, folding, and completion UI. Backend text updates still use controlled adapter updates.
- [x] Map background, foreground, font size, gutter, and every token group to the exact FE-017 CSS variables. Use language compartment reconfiguration and content updates on the existing view; no view recreation for theme changes or file reloads. Keep horizontal/vertical overflow inside a `min-width: 0`/`min-height: 0` pane surface and do not wrap a long source line.
- [x] Save scroll on changes/unmount and restore it after mount/content update; clamp to the remaining scroll range after a shorter reload. Hidden panes must not overwrite a valid saved position with an unmeasured zero. Destroy the view and callbacks on unmount.
- [x] Render facts from DTOs: exact line count even when it differs from editor line counting, UTF-8/BOM, LF/CRLF/mixed, omit `none`, native versus polling note, Markdown deferral, and syntax-limit/failure note. Format byte counts safely as `bigint` with friendly KB/MB labels and test values beyond `Number.MAX_SAFE_INTEGER`; do not coerce the full value to an unsafe number.
- [x] Test empty text, backend-provided line counts, singular/plural facts, thresholds on both dimensions, late/failing loaders, update without construction, cleanup, and scroll restoration. Use adapter observations for component tests; native input assertions belong to Task 8.

**Verification:**

```powershell
pnpm exec vitest run src/features/files/source-language.test.ts src/features/files/source-view-adapter.test.ts src/features/files/source-view.test.tsx src/features/files/file-facts.test.ts
pnpm typecheck
pnpm build
```

Expected: all aliases and limits are covered, adapter configuration is read-only, DTO facts remain authoritative, and dynamic language chunks compile under the pinned toolchain.

### Task 5: Cover every file pane state and recovery action

**Outcome:** Header and body explain the current backend state and expose only valid recovery actions.

**Depends On:** Tasks 3–4.

**Files:** Create `src/features/files/file-pane.tsx`, `file-pane.test.tsx`, `unsupported-file.tsx`, and `unsupported-file.test.tsx`. Modify `file-error-copy.ts`, `file-error-copy.test.ts`, and `index.ts` in the same directory. Keep `SourceStatusBar` and `FileStateBlock` local to their owning source-view/file-pane files rather than creating unlisted directories.

**Interfaces:** Implement/export FE-017 `FilePane(props: FilePaneProps)` exactly, including `region`, `fileHandleId`, `paneTitle`, `isVisible`, `onRefreshSession`, and `onOpenProject`. Consume the shared registry entry, SourceView, generated discriminated state unions, and existing UI buttons/tooltips. Tests supply an isolated registry dependency object and mock the source adapter.

- [x] Introduce compilable components and table-driven render tests. Initial red assertion: ready text header lacks the path/Read-only badge, or binary/too-large lacks its two required buttons. Execute the focused suites below.
- [x] Render loading with `aria-busy`; ready text/empty with the source surface; binary/too-large with actual MIME, byte size, and limit. Header path uses truncation and a full `title`. Only text presentation receives the Read-only badge; binary and too-large do not.
- [x] Render missing/unreadable with retained local text when present and an explicit stale-content explanation. Missing gets Retry; unreadable gets Retry and open-external. Root-changed gets Open project. Defensive conflict gets Reload without a conflict-resolution command; `unsavedChangesWouldBeLost` removes that action.
- [x] Map every public Files error through safe copy, including unknown transport failures. Query/reload failures remain retryable except `windowNotAllowed`, `invalidFileHandleId`, and `fileHandleNotFound`; the latter two release the entry and invite pane closure. Handle errors may request a session refresh, but do not auto-close a pane.
- [x] Unsupported actions invoke registry methods and disable while pending. Copy resolves a fresh path and announces only after writing. External-open failure offers a retry of opening, not an unrelated reload. Keep recovery content and errors visible on failure.
- [x] Label the code region `Source view of {name}`; preserve focus indication, tooltip labels, decorative icon `aria-hidden`, and polite announcements. Only body owns action announcements so two render regions do not duplicate them. Markdown stays source-only with no Edit/Preview controls.
- [x] Test every FE-017 state-table row, all nonretryable errors, lost-listener fallback, reclassification from text to binary/too-large, all button pending/failure behavior, and shared header/body subscription counts.

**Verification:** `pnpm exec vitest run src/features/files/file-pane.test.tsx src/features/files/unsupported-file.test.tsx src/features/files/file-error-copy.test.ts`. Expected: exact state copy, backend facts, action routing, and accessibility semantics pass without native IPC or a real CodeMirror view.

### Task 6: Open Explorer files without duplicate or stale intent

**Outcome:** File activation and menu placements attach once to the target prepared by Sessions.

**Depends On:** Tasks 1–2 and Task 5's shared error copy.

**Files:** Modify `src/features/files/file-explorer.tsx`, `file-tree.tsx`, `use-file-explorer.ts`, `file-error-copy.ts`, `index.ts`, and their existing tests where present.

**Interfaces:** Extend `FileExplorerProps` with FE-017 `FilePlacement`, `FileTarget`, `placements`, `prepareTarget`, and `onFileOpened`; add `ExplorerOpenState` and `open(entry, placement)`. Consume existing `readBoundary`, session/project identity, generation retirement, and `openFileInPane`. Tests substitute `prepareTarget`, IPC wrappers, and deferred responses with generated fixtures.

- [x] Replace the stage15 no-open assertions only where FE-017 supersedes them. Add failing tests asserting one `prepareTarget("newTab")` on a file click or Enter and zero calls on Space, directory, symbolic link, or other entries.
- [x] Separate selection from activation in tree and search results; stop the Actions button/menu events from bubbling into file activation. Keep arrow navigation, roving focus, pagination, selection, copy/reveal, and filter behavior.
- [x] Add four menu actions above Copy path. Read availability exclusively from props; explain the four-pane split limit with `A tab can hold up to 4 panes.`. Keep Explorer focus after a successful attachment.
- [x] Claim the opening guard synchronously before any await, check live boundary/identity/generation, prepare the target, recheck, attach, and recheck before feedback or callbacks. `null` stops silently because Sessions owns that failure. Prevent repeated Enter and the click/click/dblclick sequence from dispatching twice; test a fast-resolving first open as well as a pending one. Ignore subsequent click-count events belonging to the same double-click gesture rather than relying only on an unresolved promise.
- [x] Call `onFileOpened()` after success even if Sessions' event listener failed. Show placement-specific success and the `recentFileNotRecorded` warning without treating it as failure. Do not use the open result as `SessionDetailDto`.
- [x] Follow the FE-017 command-error table: stale pane/session targets refresh the session; unavailable entries refresh the tree; invalid/link/not-regular paths do not retry old input; memory-limit and retryable read failures use the specified recovery; project errors use existing recovery. Keep any prepared pane and never invoke close as rollback.
- [x] Remove `VIEWING_LIMITATION` and its descriptions. Lock activation/menu while opening and clear transient intent on session/project/boundary changes. A result from an old intent cannot create follow-up tabs, attach, navigate, announce success, or unlock a newer action.
- [x] Test all error groups, two fast activations, two different entries while pending, preparation returning null, attachment failure preserving the empty target, and retirement before/after each awaited boundary.

**Verification:** `pnpm exec vitest run src/features/files/file-explorer.test.tsx src/features/files/file-tree.test.tsx src/features/files/use-file-explorer.test.ts src/features/files/file-error-copy.test.ts`. Expected: all four placements route correctly, each accepted intent attaches once, Space never opens, and existing Explorer behavior passes.

### Task 7: Compose file viewing with app navigation and reset maintenance

**Outcome:** Real session routes display file panes and safely retire or reconcile them through existing application lifecycle.

**Depends On:** Tasks 2–6.

**Files:** Modify `src/app/session-terminal-route.tsx`, `src/app/session-terminal-route.test.tsx`, `src/app/app-providers.tsx`, `src/app/data-management-bridge.tsx`, `src/app/data-management-bridge.test.tsx`, `src/features/sessions/pane-content-placeholder.tsx`, `src/features/sessions/pane-content-placeholder.test.tsx`, `src/features/sessions/pane-content-picker.tsx`, and `src/features/sessions/pane-content-picker.test.tsx`.

**Interfaces:** Map `prepareFileTarget` to `prepareTarget`, `onFileAttached` to `onFileOpened`, and file renderer regions to `FilePane`; source `paneTitle` from the existing file content title. Use the public Files provider/maintenance exports and existing `DataManagementHost` committed/uncertain/refresh callbacks. Tests mock public owners and IPC, use in-memory routing, and never invoke reset against a running native app.

- [x] Add red composition assertions for file rendering and reset maintenance calls. Existing components compile; failures must identify the absent FilePane slot or absent `clearAfterReset`/reconcile callback.
- [x] Mount `FileHandleProvider` once beside `TerminalProvider`, above router consumers and `DataManagementHost`. Wire the file renderer and Explorer slots in app composition. Keep terminal slots, notification focus, and tool handling intact.
- [x] Preserve synchronous Settings/DataManagement/Quit boundary checks around Explorer preparation, close/recovery callbacks, and project navigation. Pane recovery navigates through app callbacks; Files never imports Projects or Settings implementations.
- [x] On committed `app_reset`, clear Files before navigation to Home. On uncertain reset and the existing unknown-outcome refresh path, call Files reconciliation alongside Terminal reconciliation without clearing. Import success does not clear live handles. Do not replay reset to retry a failed query.
- [x] Update the file placeholder to neutral unavailable-content copy and the pane picker to direct users to File Explorer. The File column remains noninteractive; do not enable recent-file browsing or change Search activation.
- [x] Test composition with an empty session, both pane regions, unavailable project recovery, blocked/stale Settings and Quit boundaries, committed/uncertain reset, late results after reset, and preserved terminal rendering. Exercise the real AppProviders composition from the app tests to establish one Files provider lifetime.

**Verification:**

```powershell
pnpm exec vitest run src/app/session-terminal-route.test.tsx src/app/data-management-bridge.test.tsx src/features/sessions/pane-content-placeholder.test.tsx src/features/sessions/pane-content-picker.test.tsx
pnpm typecheck
```

Expected: all app-to-feature mappings and reset branches pass, obsolete copy is absent, and the File picker remains disabled.

### Task 8: Verify the integrated Windows viewer and record evidence

**Outcome:** The complete behavior is proven at the appropriate automated and native levels.

**Depends On:** Tasks 1–7.

**Files:** All source/test changes above; update this plan's execution checkboxes, Deviations and Decisions, and Outcome while implementation is active. No new test harness, backend test file, or desktop automation is introduced.

**Interfaces:** Production Tauri commands and application UI. Automated tests use the seams specified in Tasks 1–7. Manual verification uses a disposable Windows account/profile and a dedicated temporary fixture project; do not open/reset the developer's real application data. If no isolated native profile is available, record the native checklist as pending rather than exercising destructive recovery against user data.

- [x] Run the Final Verification commands. Every test file listed by this plan must be collected by its focused command and the full suite. Diagnose failures; do not weaken assertions or use zero-test success.
- [x] Inspect the production output: source code renders with language chunks available in the packaged app; oversized/plain-text inputs skip language loading. Record existing build advisories separately from newly introduced failures.
- [x] Review the complete diff and untracked-file inventory for the negative-scope checks below. Preserve pre-existing user changes, including the FE-017 specification, which was untracked at planning time.
- [ ] Perform the manual checklist in the isolated native profile; record observation, result, and any limitation for each row. **Pending:** no disposable Windows profile or temporary fixture project was available in this session, and the checklist must not be exercised against the developer's real application data.
- [ ] Only then mark implementation complete. **Pending:** blocked by the manual checklist above and by the deferred `pnpm tauri build` recorded in Deviations.

## Final Verification

Run from the repository root on Windows. The Rust checks are regression gates required by AGENTS.md and the roadmap; they do not authorize Rust changes. The stronger explicit commands avoid relying on package scripts that omit all-target/all-feature flags.

| Scope | Command | Expected result |
|---|---|---|
| Dependency lock | `pnpm install --frozen-lockfile` | Manifest and lock agree; all 19 direct versions match this plan |
| Frontend formatting | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Type check | `pnpm typecheck` | No type errors |
| Frontend suite | `pnpm test` | All new and existing tests pass; every named suite is collected |
| Frontend bundle | `pnpm build` | Successful production bundle including dynamic languages |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | No warnings or errors |
| Rust regression | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | All unit/integration/contract targets pass with their existing isolated fixtures |
| Rust documentation | `cargo test --manifest-path src-tauri/Cargo.toml --doc --all-features` | Documentation checks pass; report actual collected count |
| Windows desktop bundle | `pnpm tauri build` | Successful Windows Tauri build with the real viewer dependencies |
| Diff integrity | `git diff --check` | No whitespace errors |
| Scope inventory | `git status --short` and `git diff --name-only` | Only planned implementation changes beyond the recorded starting state |

If a running user-owned application locks the default Rust output, use a separate task-specific Cargo target directory and record it; do not stop that application. Do not change the pinned toolchain to pass a check.

### Concrete negative-scope checks

- Review `git diff -- src-tauri src/bindings src/app/search-entry.tsx src/features/settings/appearance-theme.ts`: no feature-driven changes. Include untracked paths from `git status --short` so new files cannot escape the check.
- Run `rg -n 'VIEWING_LIMITATION|File viewing is not available yet|Files arrive with FE-016|File panes arrive with FE-017' src`; expect no obsolete source or test expectations. Do not search historical documentation as a completion assertion.
- Review new Files imports and calls: native invoke/listen only in `src/lib/ipc/`, no Files/Sessions implementation imports across features, no frontend filesystem/opener plugin, no browser persistence or content logging.
- Review command call sites and tests: no `resolve_external_file_change`, `list_recent_files`, file-write command, file-close rollback, or `files://recent-changed` subscription added by this feature. Existing backend registrations are not evidence of new frontend usage.
- Verify the shortcut catalog and shortcut-binding files have no diff; component tests show only widget-local activation. No Explorer global accelerator is added or advertised.
- Registry tests establish no frontend polling by advancing controlled test timers without events/focus and observing no extra read; inspect the implementation for interval/poll loops. Native polling remains backend-owned.
- Clipboard tests replace `writeText`, IPC tests replace native adapters, and manual checks use the isolated profile/project described above. Do not infer isolation solely from successful assertions.

### Targeted manual Windows checklist

| Scenario in the isolated fixture project | Required observation |
|---|---|
| Source file click, Enter, Space, fast double-click | Click/Enter open one tab, double-click creates one tab even on fast completion, Space only selects, tree retains focus |
| Empty session and four placements | First tab opens; empty-pane target is correct; split directions are correct; four-pane limit disables splits with explanation |
| Source and Markdown panes | Matching header/body, line numbers and status facts, Markdown remains read-only with its deferral note |
| Typing, paste, cut, undo, drag/drop, selection and copy | No user input changes source; select/copy works; Tab and Shift+Tab leave the viewer without a focus trap |
| Long line, narrow window, split/maximize, Appearance change | Overflow stays in the pane; text/font/colors update; terminal pane still works; no source view reset |
| External editor save and atomic replacement | Viewer reloads automatically with announcement, preserves usable scroll, and clamps after shortening |
| Two panes opening the same path and switching tabs | Both handles update independently; each keeps its own scroll; returning to a cached tab displays its existing snapshot |
| Delete an open file, then recreate and Retry | Missing state identifies retained content; Retry restores the authoritative state |
| Root folder relocation through existing project recovery | Old pane explains root change; Open project navigates correctly; reopening uses the current root |
| Safe binary fixture and an oversized text fixture | Correct MIME/size/limit; default app opens the binary fixture; copy path reports success only after completion |
| Text at 5,242,880 bytes; above limit; above syntax thresholds | Exact-limit text displays without highlight; larger input shows unsupported size; syntax threshold does not truncate content |
| Switch away and focus XWork after an external change | Current snapshot recovers without adding frontend polling |
| Committed reset in disposable profile, then open again | Old panes/queries do not revive; new-session file viewing still works after reset |

Listener rejection, uncertain reset, transport failures, and nonretryable error codes are deliberately injected in component/unit tests rather than manufactured against real user state. Native clipboard/opener behavior and actual CodeMirror input handling require the observations above.

## Deviations and Decisions

- 2026-09-07: Plan created from FE-017 and the current repository. The existing backend integration is reused. FE-005 recent UI remains a separate stage16 deliverable.
- 2026-09-07: Exact package versions were selected using registry manifest checks; installation and build proof remain implementation gates.
- 2026-09-07: The registry compares revision strings numerically and retains a requested-revision high-water mark to avoid losing invalidation during an in-flight query. This implements the specification's coalescing requirement without polling.
- 2026-09-07: Route-ready mutation ownership stays in `session-route.tsx`, preserving hook ordering and zero-tab support without inventing a placeholder session snapshot.
- 2026-09-07: Repository inspection found `SessionToolPicker` also owns `useToolCatalog`. Task 2 includes its existing source/test files and passes the lifted catalog to both tab branches to avoid duplicate subscriptions.
- 2026-09-07: Implementation ran Tasks 1–7 in order, with Tasks 3 and 4 executed in parallel because both depend only on Task 1 and touch disjoint files.
- 2026-09-07: All 19 pinned CodeMirror packages installed and locked exactly as specified; `pnpm install --frozen-lockfile` agrees with the manifest.
- 2026-09-07: `useWorkspaceMutations` exposes `filePlacements` alongside `prepareFileTarget`. Availability is derived inside the hook because only it knows the pending operation, the closing state, and the unconfirmed close dialog. `runStructural` gained a `canRetryLater` flag so a failed preparation is never replayed into an orphan tab or split.
- 2026-09-07: `SessionFilePlacement` and `SessionFileTarget` are declared in `session-layout.ts` and re-exported from `session-route.tsx`. The public names match FE-017 exactly while keeping the hook free of a route import cycle.
- 2026-09-07: The ready-state owner is `SessionRouteReady`, a Sessions-local component in `session-route.tsx`, keyed by session identity and mounted across both tab branches. The empty branch renders preparation failures itself, since a first-tab opening can fail before a workspace exists.
- 2026-09-07: `FileHandleProvider` accepts an optional `createRegistry` factory. Production composition uses the documented `{ children }` signature; the seam exists so provider, pane, and app tests can inject an isolated transport instead of reaching native IPC.
- 2026-09-07: `FilePane` adds one copy string FE-017 describes but does not spell: `You are reading the last version XWork loaded.` for missing and unreadable states that still carry retained content.
- 2026-09-07: `vite.config.ts` raises `testTimeout` to 15 s. The viewer suites transform several megabytes of grammar packages, which starved the parallel jsdom workers and made three pre-existing `userEvent` suites (`rename-project-dialog`, `settings-terminal-profiles-route`, `app-shell`) exceed the 5 s default. No assertion was weakened; the full suite passes repeatedly at the new ceiling.
- 2026-09-07: `cargo test --all-targets --all-features` must be run with `-j 2` on this machine. At full parallelism rustc aborts with `STATUS_STACK_BUFFER_OVERRUN` and reports missing rlib metadata while linking roughly twenty test binaries; `-j 2` compiles and runs every target normally.
- 2026-09-07: `terminal_pty_windows::conpty_round_trips_unicode_input_resize_and_exit` fails in this environment: the real ConPTY fixture emits its ASCII `BURST:*` output but never the Unicode marker, so the console code page, not this slice, is the cause. `git status -- src-tauri` is empty; no Rust file was touched. Recorded as a pre-existing environment failure, not a regression.
- 2026-09-07: `pnpm tauri build` was deferred at the user's explicit request after the Rust regression run had already occupied the shared Cargo target directory for over thirty minutes. The frontend bundle gate (`pnpm build`) passed and emitted the language chunks; the desktop bundle remains an open gate.

## Outcome

Implemented, with two gates explicitly pending.

**Delivered.** File Explorer opens files through the four FE-017 placements into panes Sessions prepares in its one mutation slot; an application-level handle registry keeps authoritative snapshots and scroll positions outside pane lifetime; the CodeMirror surface renders read-only source with dynamic language packs, the exact Appearance tokens and the full status-fact row; every handle state, recovery action and reset branch is wired through app composition. No Rust, generated binding, capability, persistence, or global shortcut changed.

**Automated results on Windows (2026-09-07).**

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Lock and manifest agree; all 19 pinned viewer versions present |
| `pnpm format:check` | Clean |
| `pnpm lint` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm test` | 2390 passed across 129 files, twice in a row; every suite this plan names is collected |
| `pnpm build` | Successful; 20 chunks including `shell`, `powershell`, `toml` and 16 async grammar chunks kept out of the entry bundle |
| `cargo fmt --check` | No diff |
| `cargo clippy --all-targets --all-features -- -D warnings` | No warnings |
| `cargo test --all-targets --all-features -j 2` | Every target compiles and runs; one pre-existing environment failure in `terminal_pty_windows` (see Deviations) |
| `cargo test --doc --all-features` | 0 doc tests collected, matching the repository's current state |
| `git diff --check` | No whitespace errors |
| Scope inventory | Only planned implementation files; `src-tauri`, `src/bindings`, `search-entry.tsx`, `appearance-theme.ts` and `src/index.css` are untouched |

**Negative-scope checks.** No `VIEWING_LIMITATION`, `File viewing is not available yet.`, `Files arrive with FE-016.` or `File panes arrive with FE-017.` remains in source or expectations. No `resolve_external_file_change`, `list_recent_files`, file-write command, close rollback or `files://recent-changed` subscription was added. Native `invoke`/`listen` stays inside `src/lib/ipc/`; Files imports no Sessions, Projects or Settings implementation and Sessions imports no Files implementation. No filesystem or opener plugin, no browser persistence, no content logging, and no timer of any kind in the registry or provider.

**Pending.** The targeted manual Windows checklist was not performed: this session had no disposable Windows profile or temporary fixture project, and the plan forbids exercising destructive recovery against the developer's real data. `pnpm tauri build` was deferred at the user's request. Both remain required before this slice is called complete.
