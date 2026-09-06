# FE-016 File Explorer — Stage 15 Implementation Plan

**Status:** Stage15 code and automated verification complete — ready for the coordinating task to commit; native smoke/metrics pending.

**Goal:** Deliver the FE016 stage15 session Explorer using the committed BE013 commands for lazy browsing, project-wide basename filtering, refresh, path copying and native reveal, with lifecycle-safe responses and no simulated file opening.

**Completion Criteria:**

- Empty and populated sessions can show/hide Explorer without changing terminal instance identity or creating tabs/panes.
- Lazy pages, real search, refresh, warning/error states, copy/reveal and keyboard interactions satisfy FE016; route changes, project invalidation and maintenance prevent stale publication or follow-on clipboard writes.
- Every scoped frontend test and the Windows gates below pass, including explicit Rust integration targets and all-target/all-feature tests with one build job and one test thread.
- Native behavior is recorded only from an isolated Windows smoke run. Unperformed smoke/metrics remain pending; passing automated gates alone does not establish full stage15 or Phase 2 completion.

**Architecture:** Files owns presentation and bounded route-local snapshots. App composition injects Files through the Sessions-owned Explorer render slot and supplies the current DataManagement/Quit boundary. All filesystem operations use the four existing BE013 wrappers; Projects supplies identity invalidation, while Sessions retains tab/pane/terminal ownership.

**Tech Stack:** Existing React/TypeScript, Tailwind, copied Button/Input/Tooltip/DropdownMenu, Lucide, Vitest/Testing Library, Tauri IPC and Rust test tooling. Reuse the manifests and locks as they stand; no dependency is added, upgraded or repinned by this plan.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`; template: `00-Docs/99-Template/04-Plan.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage15; stage16 owns source viewing/watch/recent files.
- Architecture/toolchain: `00-Docs/00-Overview/01-TechStack.md`, `00-Docs/00-Overview/02-ProjectStructure.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, especially §§4.3, 7.4–7.5, 9.2, 11.1–11.2, 17.4, 18 and 20.
- Primary contract: `00-Docs/02-Frontend/FE-016-file-explorer.md`, all sections, including its exact file inventory and public signatures.
- Stage15 extensions: `00-Docs/02-Frontend/FE-001-application-shell.md`, `00-Docs/02-Frontend/FE-005-project-overview.md`, `00-Docs/02-Frontend/FE-014-settings-keyboard-shortcuts.md`.
- Existing ownership: `00-Docs/02-Frontend/FE-006-session.md`, `00-Docs/02-Frontend/FE-007-tabs-and-panes.md`, `00-Docs/02-Frontend/FE-015-settings-data.md`.
- Backend: `00-Docs/03-Backend/BE-013-file-tree.md`; existing project/session boundaries in `00-Docs/03-Backend/BE-003-projects.md` and `00-Docs/03-Backend/BE-005-sessions-runtime.md`.
- Wireframe: `00-Docs/01-Wireframe/05-Files.html#explorer`; existing design tokens from `00-Docs/01-Wireframe/00-Design.md`. The wireframe's Open actions and Ctrl+B are explicitly deferred by FE016.
- Current evidence: `src/bindings/files/files.ts`, `src-tauri/src/files/commands.rs`, `src-tauri/src/files/service.rs`, `src-tauri/src/files/models.rs`, `src-tauri/tests/files_tree_commands.rs`; `src/app/session-terminal-route.tsx`, `src/app/home-entry.tsx`, `src/features/sessions/session-route.tsx`, `src/features/sessions/session-workspace.tsx`, `src/features/sessions/session-tab-strip.tsx`, `src/features/sessions/use-session-detail.ts`.
- Test/build evidence: `package.json`, `src-tauri/Cargo.toml`, `vite.config.ts`, `src/test-setup.ts`, `src/lib/ipc/projects.test.ts`, `src/app/data-management-bridge.test.tsx` and `src-tauri/tests/export_bindings.rs`.

## Scope

**In Scope:**

- Stage15 FE016 behavior and the minimal Sessions/app composition described by the accepted spec, plus FE005/FE014 regression assertions.
- Production IPC wrappers using generated Files DTOs/errors; no runtime mock data.
- Lazy directory pages, flat project-wide search/filter, manual refresh, copy absolute/relative paths, reveal, typed recovery, warnings/truncation and focus behavior.
- Request scheduling, cleanup and invalidation across collapse, hide/reopen, session/project changes, removal, root relocation, Data busy/epoch and Quit.
- Unit/component/IPC tests, existing isolated Rust integration targets, complete Windows gates and an isolated manual-smoke checklist.

**Out of Scope:**

- Read/watch/source viewer, Markdown, external file open, recent files, Git-file activation, file results in Palette, file panes or filesystem mutations.
- Ctrl+B or any BE009 catalog/default changes, new events/commands/DTOs, generated binding edits, Rust changes, permissions, manifests/locks, router/provider changes and production DataManagementBridge changes.
- Persistence, cross-session caches, panel resizing, virtualization dependencies and background polling.
- Source implementation during this planning turn; commits, subagents, independent review or edits to completed historical plans. Preserve the four uncommitted design documents for the implementation handoff.

## Global Constraints

The following applicable rules are copied from `AGENTS.md` and `PLANS.md`:

- Use UTF-8 for Markdown files.
- Write code, identifiers, and code comments in English.
- The initial UI language is English.
- Every function, method, callback, test, and helper must have a short comment describing its purpose.
- Keep OS access, persistence, terminal processes, and business rules in Rust; the React frontend communicates with them through narrowly scoped Tauri commands and events.
- During development, build and test only on Windows.
- Defer macOS validation until release preparation unless explicitly requested earlier.
- Creating a plan does not authorize source-code implementation.
- Generated bindings under `src/bindings/` are not edited manually.
- Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state.
- Do not rely on process-global environment mutation for test isolation when tests may run concurrently.

Do not add or run automated desktop E2E. Run tasks sequentially. Use frontend mocks only in tests: the roadmap's real-runtime requirement supersedes the older generic mock-development sentence in PLANS for this already implemented backend. User-facing progress remains Vietnamese; this plan and implementation identifiers/copy remain English.

## Assumptions, Risks, and Blockers

**Assumptions:**

- FE016 has no open questions. The user authorized routine decisions without questions; preserve the accepted stage15 behavior rather than expanding scope.
- BE013 is already implemented and committed. The user-reported 498 Rust / 2,000 FE tests and Tauri success are baseline evidence, not FE016 verification results.
- `src/features/files/` and `src/lib/ipc/files.ts` do not yet exist. Public Sessions entry is the existing `session-route.tsx`; do not invent a Sessions barrel.
- DataManagement exposes `busy`, `invalidationEpoch`, `getCurrent()`; HomeEntry demonstrates synchronous boundary reads. SessionRoute already knows the summary's projectId and the two empty/populated branches.
- Existing dependencies suffice. Manifest versions are authoritative for installed code; unrelated tech-stack drift is not an invitation to upgrade packages.

**Risks:**

- BE013 has no cross-command root identity or abort command: Tasks 2–3 guard response identity and Tasks 5–6 test live boundaries. Already-sent reveal cannot be undone; do not report a rollback or replay it.
- A naive refresh can mix cursors/generations or enqueue unlimited scans: Task 2 enforces two in-flight scans including obsolete work, parent-first reload and bounded retained data.
- The SessionRoute branch split can remount terminal content or lose Explorer intent: Task 5 establishes stable siblings and verifies mount identity, not merely visible text.
- WebView2 clipboard activation, native reveal, actual layout/resize and IME cannot be proven by jsdom: Task 7 keeps native evidence separate.
- The production binary resolves real app-data paths. Existing Rust test injection is not a production CLI switch; do not launch the binary under the developer account assuming a temporary project alone isolates app data.

**Blockers:** None for implementation handoff. Native smoke remains an execution prerequisite for full completion if an isolated Windows environment is unavailable; it does not prevent implementing or running isolated automated tests.

## Dependency Order

1. Task 1: generated-contract wrappers/fixtures → enables Files state and UI tests.
2. Task 2: lazy tree and refresh coordinator → enables search and rendering.
3. Task 3: search, invalidation and lifecycle → enables safe UI actions.
4. Task 4: tree/panel/actions/accessibility → enables session composition.
5. Task 5: stable Sessions/app composition → enables cross-owner regression.
6. Task 6: reset/route and deferred-feature regressions → enables final gates.
7. Task 7: Windows verification and evidence → determines completion or pending native work.

Tasks 1–6 use behavioral red/green tests. For new modules, first add the minimal type-correct exported skeleton needed to collect tests; it may return empty UI/initial state or a deliberate unimplemented rejection. Then assert the stated missing behavior. An unresolved module, syntax failure or zero discovered tests is not valid red evidence. Do not leave a skeleton in the completed implementation or wire it into production before it works. Existing regression-only tests may pass immediately; record them as regression evidence without manufacturing failures.

All commands below run from `F:/Self Projects/XWork`, unless the manual environment is explicitly named. Do not use `--passWithNoTests`. Report failed assertions before moving to green.

---

### Task 1: Add the four real Files wrappers and isolated fixtures

**Outcome:** Typed production calls exactly match BE013; tests cannot cross the native boundary.

**Depends On:** None.

**Files:**

- Create: `src/lib/ipc/files.ts`, `src/features/files/files-test-fixture.ts`.
- Test: `src/lib/ipc/files.test.ts`.
- Consume unchanged: `src/bindings/files/files.ts`, `src/lib/ipc/ipc-error.ts`.

**Interfaces:**

- Consume generated `ListFileChildrenRequestDto`, `SearchFileTreeRequestDto`, `FileEntryRequestDto`, `FileTreePageDto`, `FileTreeSearchDto`, `FileEntryPathsDto`, `FilesError` and `invokeCommand<TResult, FilesError>`.
- Produce `listFileChildren(request): Promise<FileTreePageDto>`, `searchFileTree(request): Promise<FileTreeSearchDto>`, `getFileEntryPaths(request): Promise<FileEntryPathsDto>`, `revealFileEntry(request): Promise<void>` with the exact request types in FE016.
- Test-only seam: mock `@tauri-apps/api/core` `invoke` using `vi.fn`; fixtures contain typed DTOs and deferred promises with explicit resolve/reject, never filesystem readers. UUID fixture values must be lowercase hyphenated; root paths are inert strings.

- [ ] Add wrapper tests for exact snake_case command names and `{ request }`, explicit root `directory: ""`/`cursor: null`, opaque non-null cursor, response passthrough, Rust unit and typed/unknown failures. Check error payload retains `project_id`/`relative_path`; do not redefine the union.
- [ ] Run `pnpm exec vitest run src/lib/ipc/files.test.ts`. With callable skeletons, expect the assertion that invoke received `list_file_children` and its exact request to fail; collect at least one test.
- [x] Implement only the four wrappers through existing `invokeCommand`, preserving `IpcCallError` behavior. Build shared fake pages/results/event data/deferred promises in the fixture file, with purpose comments.
- [x] Repeat the command; expect all four command/envelope and rejection assertions to pass. No Rust or binding change is required.

### Task 2: Implement bounded lazy browsing and refresh

**Outcome:** Tree reads are lazy, ordered, bounded and cannot append stale pages after refresh/collapse.

**Depends On:** Task 1.

**Files:**

- Create: `src/features/files/use-file-explorer.ts`, `src/features/files/file-error-copy.ts`.
- Test: `src/features/files/use-file-explorer.test.ts`, `src/features/files/file-error-copy.test.ts`.
- Extend: `src/features/files/files-test-fixture.ts`.

**Interfaces:**

- Consume Files wrappers, `getProject`/`onProjectsChanged` from `src/lib/ipc/projects.ts`, generated Projects DTOs and FE016 state shapes.
- Produce private hook state/actions for `setQuery`, `toggleDirectory`, `loadMore`, `refresh`, `collapseAll` and the panel's selection/action feedback. Keep the coordinator private to Files; no global store or cross-feature registry.
- Test-only seam: `vi.mock` both IPC modules; capture the Projects event callback and return deferred subscription/unlisten. Use deferred command promises and fake timers to control ordering; no real app-data or OS paths are resolved.

- [ ] Add tests for unopened panel issuing no query; root-first bootstrap, single directory expansion, 500-entry pages, opaque cursor use, exact-path dedup and backend order. Reject project read and listener attachment separately: expect explicit Retry status, no root scan with unknown identity, and no claim of a working subscription.
- [ ] Run `pnpm exec vitest run src/features/files/use-file-explorer.test.ts src/features/files/file-error-copy.test.ts`. Expect the assertion that an opened, successfully bootstrapped hook lists only root once to fail against initial-state skeletons.
- [x] Implement subscribe-before-snapshot bootstrap; an event during bootstrap retires the earlier read. Implement at most two list/search calls in flight, including obsolete calls until they settle; one list per directory and no speculative recursion. Drop irrelevant queued work on generation changes.
- [x] Implement root/expanded-directory refresh with fresh metadata and null cursors, parents before visible children. Reload only first pages; defer expansion restoration when its parent page is not loaded. Refresh coalesces one follow-up; failed siblings do not block each other. Invalid cursor or stale entry recovery gets one fresh read, then manual Retry instead of a loop.
- [ ] Test page completion after refresh; collapse while listing; a folder removed, ignored or replaced by a file; root refresh failure with same-generation stale display; invalidCursor repeat; entryNotVisible recovery. At 5,000 retained entries reject an overflowing page whole and retain its prior cursor. Collapse releases descendants; failed limit acceptance must not lose entries.
- [x] Map every generated Files error and all warning/truncation reasons to FE016 English copy. Unknown code/transport is safe generic copy. Preserve stale data only when root/generation remain valid; errors must not render raw absolute path/cursor/OS exception.
- [x] Repeat the command; expect all order, resource-cap, recovery and error-copy cases to pass. Warning counts are page-scoped rather than falsely summed as unique issues.

### Task 3: Add real filter/search and lifecycle invalidation

**Outcome:** Only the latest valid project/query/lifetime can publish; hidden or suspended Explorer schedules no further work.

**Depends On:** Task 2.

**Files:**

- Modify: `src/features/files/use-file-explorer.ts`, `src/features/files/files-test-fixture.ts`.
- Test: `src/features/files/use-file-explorer.test.ts`.

**Interfaces:**

- Consume `searchFileTree`, Projects event DTO and the FE016 `{ epoch, suspended }` boundary plus synchronous `readBoundary()` callback.
- Produce FE016 flat search state and lifecycle behavior without new public backend interfaces.
- Test-only seam: fake timers with explicit advancement, deferred reads/subscriptions, mutable boundary returned by `readBoundary()` without rerender, and captured project event delivery.

- [ ] Add tests for 250ms debounce, composition delay, whitespace clear, 1–128 Unicode scalar validation (including emoji), control-character rejection, backend invalidSearch, stale A response under input B, and at most one latest queued query. Run `pnpm exec vitest run src/features/files/use-file-explorer.test.ts`; expect the valid-query assertion requiring `search_file_tree` behavior to fail before search is implemented.
- [x] Implement one input as project-wide basename search, not loaded-node filtering. Preserve backend ordering and 200-result limit; show each truncation reason and warnings even with zero matches. Invalid input falls back to normal tree with validation; clear restores expansion, or refreshes tree when a search refresh marked it stale.
- [ ] Add lifecycle tests: hide clears snapshots/menu/queue but retains query/expansion intent; reopen re-reads project/root/search; route/session changes discard all intent. Late listener resolution unlistens once; unmount or collapse never resurrects data. Closing while obsolete IPC is running must not release scan capacity prematurely.
- [ ] Test matching project updated/removed/unavailable, unrelated-project event, rootPath change, one `projectRootChanged` recovery then Retry, and removal-in-progress with manual retry instead of polling. Metadata/event invalidation must retire identical relative paths from an old root.
- [ ] Test busy and epoch changes before React effects: old tree/search completions do not publish, queued commands do not start. Quit phases other than `idle`/`snapshot-failed` suspend; resume does fresh reads, not action replay. Epoch retires query/expansion/selection even if route remains mounted.
- [x] Repeat the command; expect bounded dispatch, latest-query, listener disposal and all invalidation cases to pass with no unhandled rejection or timer leak.

### Task 4: Build the accessible Explorer and real path actions

**Outcome:** The panel renders the accepted states and offers functioning copy/reveal without pretending to open file contents.

**Depends On:** Tasks 2–3.

**Files:**

- Create: `src/features/files/index.ts`, `src/features/files/file-explorer.tsx`, `src/features/files/file-tree.tsx`.
- Test: `src/features/files/file-explorer.test.tsx`, `src/features/files/file-tree.test.tsx`.
- Extend as needed within their existing role: `src/features/files/use-file-explorer.ts`, `src/features/files/file-error-copy.ts`, `src/features/files/files-test-fixture.ts` and their tests.
- Reuse unchanged: `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/tooltip.tsx`, `src/components/ui/dropdown-menu.tsx`.

**Interfaces:**

- Produce public `FileExplorer(props: FileExplorerProps): React.JSX.Element`, `FileExplorerProps`, `FileExplorerBoundary` through `src/features/files/index.ts`, exactly as FE016 specifies.
- Consume the hook and wrappers. Copy takes returned absolutePath/relativePath, not a root join; reveal takes the selected DTO identity.
- Test-only seam: mock Files/Projects IPC; replace `navigator.clipboard.writeText` with a controllable promise and restore its property descriptor after each test. Use current jsdom pointer/media stubs, TooltipProvider, and Testing Library events; native reveal is only a spy.

- [ ] Add render/interaction tests and run `pnpm exec vitest run src/features/files/file-tree.test.tsx src/features/files/file-explorer.test.tsx`. Against minimal render skeletons, expect the named `File Explorer` region and lazy root treeitem assertions to fail.
- [ ] Render filter/Refresh/Collapse all/Close, project ignore caption, FE016 loading/empty/error/unavailable/partial/limit states, tree and search-list semantics. All icon controls have tooltip/labels; long paths expose full text safely. Root is implicit; directory alone has aria-expanded. Keep pagination/retry/menu controls outside treeitem/option semantics as specified.
- [ ] Test Up/Down/Home/End, Right expand/child, Left collapse/parent, Space select, directory Enter toggle, search-directory selection without expansion, Shift+F10/right-click/actions button menu, Escape clear/menu close, Tab access and focus repair after collapse/removal. Keep handlers local; IME and keys outside Explorer are not intercepted.
- [x] Implement the stage15 limitation text and announcement. Test file click/double-click/Enter select without Open menu, Ctrl+Enter opening, tab/pane mutation, recent-file mutation or external opener. Links and other entries remain leaves; symbolic-link reveal is disabled with explanation, link copying remains available.
- [x] Implement action single-flight: revalidate paths for every copy, recheck live boundary before clipboard, success only after writeText resolves, and safe retry after clipboard missing/rejection. Test stale path response after route/epoch/project change and pending clipboard completion feedback suppression. Never retain absolute paths in state/logs.
- [ ] Reveal invokes exactly once with current identity; test rejection, manual retry and no auto-replay after resume. Do not attempt to undo already-sent native actions.
- [x] Repeat the command; expect accessible operations, warnings, honest stage15 behavior and action guards to pass. Also rerun `pnpm exec vitest run src/features/files/use-file-explorer.test.ts src/features/files/file-error-copy.test.ts` if those modules changed.

### Task 5: Compose Explorer into both SessionRoute branches

**Outcome:** A session-owned toggle controls a stable Files slot while terminal instances and existing workspace behavior remain intact.

**Depends On:** Task 4.

**Files:**

- Modify: `src/app/session-terminal-route.tsx`, `src/features/sessions/session-route.tsx`, `src/features/sessions/session-workspace.tsx`, `src/features/sessions/session-tab-strip.tsx`.
- Test: `src/app/session-terminal-route.test.tsx`, `src/features/sessions/session-route.test.tsx`, `src/features/sessions/session-workspace.test.tsx`, `src/features/sessions/session-tab-strip.test.tsx`.
- Consume unchanged: `src/app/home-entry.tsx` as boundary pattern, `src/features/settings/data-management-provider.tsx`, `src/app/quit-store.ts`, existing KeyboardShortcuts provider and Terminal public entry.

**Interfaces:**

- Produce `SessionFileExplorerSlotProps`, `SessionFileExplorerRenderer` and optional `renderFileExplorer` on SessionRoute, plus `fileExplorerToggle?: React.ReactNode` through Workspace/TabStrip, exactly as FE016.
- App supplies `platform`, `boundary`, `readBoundary`, `onOpenProject`, `onProjectMissing`; projectId comes from the matching session summary, not a breadcrumb or parsed root.
- Test-only seams: fake renderer with mount/unmount counter and durable DOM identity, mocked Sessions/Projects queries and mutation spies, mutable Data/Quit state, MemoryRouter or the existing navigation spy. No terminal process is launched.

- [ ] Add tests and run `pnpm exec vitest run src/app/session-terminal-route.test.tsx src/features/sessions/session-route.test.tsx src/features/sessions/session-workspace.test.tsx src/features/sessions/session-tab-strip.test.tsx`. Expect missing Show File Explorer control/slot in current SessionRoute to fail; add only the public prop skeleton needed to compile the test first.
- [x] Keep Explorer slot and workspace as stable siblings outside the empty/populated branch switch; invoke render callbacks as callbacks, not newly declared component types. Do not key terminal/workspace by visibility, query, revision, epoch or active tab solely for Explorer refresh.
- [x] Add a default-closed toggle before Tab options and at the empty-session header. Wire aria-controls/expanded and focus ref; absence of renderer means no toggle. Close from panel returns focus only to a still-valid toggle, never over route/Quit focus.
- [x] Respect both route lifecycle and workspace busy/close-dialog guards. Workspace owns its own pending state: disable the supplied toggle at its local boundary (for example through a disabled fieldset) rather than importing its internals into app or changing Files' public signature. Existing modal focus trapping prevents background activation.
- [x] Use CSS container-responsive placement in the scoped route: 240px left panel normally; above workspace below 600px session width, max 40% height with scrolling. Do not add global CSS files, ResizeObserver ownership or panel resize controls. Preserve terminal subtree DOM position; native resize evidence belongs to Task 7.
- [x] Copy HomeEntry's live Data/Quit boundary semantics into app composition. Guard recovery before navigation: removed project replaces `/projects`; explicit Open project navigates to `/projects/{projectId}` for existing recovery. No new router entries or providers.
- [ ] Test empty-to-populated transition, tab change, close/maximize, sessionId switch even when React reuses the route, missing session, unmount, busy/epoch and notification focus regression. Existing renderer mount count and mutation spies prove toggle does not restart/create/split/activate a terminal pane. Reset/route changes must retire data before a reused slot can display prior identity.
- [x] Repeat the command; all composition and prior session tests pass; toggle carries no hardcoded Ctrl+B.

### Task 6: Verify reset/route integration and deferred-feature boundaries

**Outcome:** Cross-owner behavior remains consistent, and stage16 features do not leak into stage15.

**Depends On:** Task 5.

**Files:**

- Test: `src/app/data-management-bridge.test.tsx`, `src/features/projects/project-overview-route.test.tsx`, `src/features/settings/settings-keyboard-shortcuts-route.test.tsx`, `src/app/session-terminal-route.test.tsx`.
- Production corrections, if needed, stay in the Task 2–5 inventory. Do not change production Projects/Settings/bridge files to make regression tests easier.

**Interfaces:**

- Consume the real DataManagementHost public coordinator through its existing Probe seam with mocked data commands/event callback; extend the test's Projects mock with `getProject` only where Files needs it.
- Test-only Files probe uses public `FileExplorer` with boundary props/current reader. Backend reset/import calls are mocks, not native operations. Existing terminal public boundary spies and a durable renderer probe observe reset behavior without adding a production test API.

- [ ] Add reset-before-completion and busy-before-rerender cases. Resolve a queued Files read/path after the public coordinator advances epoch; expect no rows, no follow-on clipboard and no stale route recovery. Failed owner refresh does not restore old Files data. Resume reads afresh; never replay copy/reveal.
- [ ] Run `pnpm exec vitest run src/app/data-management-bridge.test.tsx src/app/session-terminal-route.test.tsx src/features/projects/project-overview-route.test.tsx src/features/settings/settings-keyboard-shortcuts-route.test.tsx`. Any red result must name stale rows/clipboard/navigation surviving the live boundary, not an incomplete mock module. Regression-only assertions may already pass.
- [x] Confirm reset's existing terminal clear/reconcile behavior is not misreported as “no terminal disposal”: the invariant is no whole-app remount or extra terminal restart caused by Explorer. Import/busy and toggle preserve unaffected terminals; committed reset still clears runtime through its owner.
- [x] Assert Project Overview has no Recent files block and Git rows have no newly enabled file activation. Settings keeps the existing 18-action catalog/availability and no Explorer shortcut/keycap. In Files tests, mutation/opener spies remain untouched on file activation.
- [x] Repeat the command. Inspect the focused source diff for unexpected direct invoke, filesystem/opener APIs, cross-feature internal imports, new event strings, absolute-path logs or persistence writes. Verify excluded files with `git diff --name-only` and `git status --short`, including untracked files; do not infer a negative runtime property from an API that does not exist.

### Task 7: Run Windows gates and record native evidence separately

**Outcome:** Automated evidence is complete and native limits are reported truthfully.

**Depends On:** Tasks 1–6.

**Files:**

- Execute unchanged tests: `src-tauri/tests/files_tree_commands.rs`, `src-tauri/tests/export_bindings.rs` and all targets selected by the final commands.
- Record execution evidence only in this active plan's Outcome/Decisions sections; keep prior historical plans and pending records intact.

**Interfaces:**

- Existing backend seam: `configure_with_files_for_tests`, per-test `TempDir` app-data/workspace, fake ProjectPlatform/EventSink, injected reveal callback and Tauri MockRuntime. `with_reveal_failure()` injects `FilesError::RevealFailed`; existing tests assert typed failure and unchanged fixture bytes. No native folder picker/opener is reached.
- Binding target compares generated output to the checked-in binding; never hand-edit generated files or accept unexplained drift.
- Manual-only seam: a disposable Windows VM/Sandbox or an already dedicated test Windows account, with fresh app-data/WebView profile and fixture-only project. This is environment isolation, not a new app argument or production code path.

- [x] Run each final command below sequentially; save result, counts and any actual failing target. `pnpm test:rust` alone is insufficient because its current script lacks the required all-target/all-feature flags.
- [ ] Verify native environment isolation before launching XWork. Do not run `pnpm tauri dev`, the production binary or an installer in the developer's normal profile. If no isolated environment is ready, leave the following checks pending and report that limitation; do not add a production profile override or mutate global environment variables.
- [ ] In the isolated environment, run the built application with a disposable fixture project containing normal/deep/empty folders, more than 500 siblings, basename duplicates, Unicode names, hidden files and nested ignore rules. Test root/branch Load more, search across unloaded folders, external fixture/ignore edits followed by Refresh, copy both paths, reveal file/folder and link reveal refusal when the isolated environment supports creating a link.
- [ ] Check empty/populated session toggle, narrow/wide layout, focus/menu/IME, theme/font scale/reduced motion, and running terminal resize without restart. Use only a shell in the disposable fixture, no personal CLI credentials. Verify unavailable/relocated fixture root recovery and reopen behavior. Reset, if exercised, applies only to this dedicated app profile.
- [ ] Record environment, commands, observed results and any skipped link/IME/layout checks. Native metrics have no invented threshold or inherited pass: unmeasured metrics remain pending. Do not rewrite the old 498/2,000 baseline as new gate results.

## Final Verification

Run from the repository root on Windows, sequentially. The full frontend run covers every named frontend test file; each new file also has a focused command above.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Type check | `pnpm typecheck` | No type errors; generated DTO use and slot signatures agree |
| Full frontend tests | `pnpm test` | All discovered unit/component/IPC tests pass; no zero-test substitutions |
| Production frontend build | `pnpm build` | Vite production bundle succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- -D warnings` | Pass with warnings denied |
| BE013 integration target | `cargo test --manifest-path src-tauri/Cargo.toml --test files_tree_commands --all-features --jobs 1 -- --test-threads=1` | Real mock-IPC Files tests pass with isolated fixture/native seams |
| Binding target | `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings --all-features --jobs 1 -- --test-threads=1` | Checked-in generated contracts match |
| Full Rust gates | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- --test-threads=1` | All targets/features pass with serialized build/tests |
| Windows Tauri build | `pnpm tauri build` | Production desktop build succeeds; do not launch/install under the user profile |
| Patch integrity | `git diff --check` | No whitespace errors |
| Scope/binding integrity | `git diff --name-only` and `git status --short` | Only allowed implementation/test files, preserved design docs and this active plan; no Rust, binding, manifest, capability or historical-plan edits |

Use a process-scoped build setting for Tauri only if needed to keep Cargo at one job: set `CARGO_BUILD_JOBS=1` for that child process, then restore the prior process value. This controls build resources, not test isolation; do not mutate machine/user environment or app-profile paths. All direct Rust test commands must retain both `--jobs 1` and `-- --test-threads=1`.

The existing Rust fixture snapshot comparison and mock assertions demonstrate no project-file mutation for scoped actions. Static diff inspection demonstrates no new production write path/command/capability. Neither is a claim that a native smoke run occurred. No automated desktop E2E or macOS check is included.

## Deviations and Decisions

- Planning date: 2026-09-06; the filename date is not a stage number.
- User-authorized decisions are already recorded in FE016: file activation selects only, no Ctrl+B, single real global basename filter, 240px responsive panel, bounded transient cache, no read/watch or recent files. No specification amendment was needed during planning.
- The design-turn statement “no plan” applied to that earlier turn. The current request explicitly authorizes this plan only; implementation still waits for the implementation request.
- Session workspace busy state stays with its current owner; locally disabling the supplied toggle avoids expanding the public slot contract. CSS determines placement so toggling never needs a terminal remount.
- Native environment isolation is a completion condition, not permission to touch the real profile. No unresolved product/contract question blocks implementation; unavailable native validation stays visible as pending.
- Handoff target: Astra medium, working sequentially in this same checkout after an explicit implementation request. This plan does not dispatch another task, change models or authorize commits/subagents/independent review.
- Preserve `FE-001-application-shell.md`, `FE-005-project-overview.md`, `FE-014-settings-keyboard-shortcuts.md` and `FE-016-file-explorer.md` as uncommitted handoff inputs. Do not discard, stage or commit them during planning.

During implementation, append material deviations and actual evidence here without rewriting completed history. Self-check is performed by the implementer; no independent review stage is scheduled.

## Outcome

### Automated implementation delivery — 2026-09-06

Tasks 1–6 are implemented in the scoped frontend inventory. The execution evidence below supersedes the original skeleton-first checklist sequence; those red-first steps were not retroactively manufactured. Task 7 automated gates are recorded individually; native checks remain separate and pending. No stage16 functionality is implemented, and no commit or staging operation was performed.

| Delivered scope | Verification evidence |
|---|---|
| Typed production IPC | Four wrappers forward generated DTOs through `invokeCommand`; 7 isolated contract tests cover envelopes, null/opaque cursor, returned path fields, void and normalized failures. |
| Lazy controller and lifecycle | 30 hook tests cover subscribe-before-read, late cleanup, hidden/route/epoch identity, obsolete capacity, directory serialization, exact dedup/order, 500-entry pages/5,000 cap, refresh/cursor/root recovery, same-root stale rows, replaced-folder pruning, sibling independence, debounce/IME/scalar validation, latest-only search, search-refresh deferral and action invalidation/single-flight. |
| Safe error/diagnostic copy | 19 tests cover every Files error code, unknown transport, search failures and all warning/truncation variants. Projects bootstrap spellings for unauthorized/removal barriers are mapped without changing either generated contract. |
| Accessible panel and actions | 18 panel + 6 tree tests cover local keyboard/selection/focus, menu entry points, copy/reveal, clipboard rejection/missing API, delayed success, stale action suppression, symlink refusal and empty partial searches. All native action calls and clipboard writes are controlled test seams. |
| Sessions composition | 41 SessionRoute tests include new empty/populated toggle, stable slot/terminal DOM, empty-to-populated transition and reused-session route checks. Workspace/TabStrip tests verify local disabling, placement and preserved terminal DOM. |
| App/reset/deferred boundaries | Real DataManagementHost test retires pending paths through reset even when project refresh fails. App tests verify live Data/Quit guards, overview navigation and removed-project replace. Project Overview retains static Git paths and no Recent files; Settings retains the 18-action catalog and no Explorer shortcut. |

Final automated verification on Windows:

| Command | Result |
|---|---|
| `pnpm format:check` | PASS, 294 files checked, no formatting errors. |
| `pnpm lint` | PASS, 294 files checked, no lint errors. |
| `pnpm typecheck` | PASS. |
| `pnpm test` | PASS, **2,090 tests / 119 files**, 30.88s on the final source tree. This is new FE016 evidence, not the inherited 2,000-test baseline. |
| `pnpm build` | PASS, 2,576 modules; final JS `index-CdeqVsCH.js` 1,072.15 kB (325.43 kB gzip). Vite reports its >500 kB chunk advisory; no code-splitting/dependency expansion was added. |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | PASS. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- -D warnings` | PASS, warnings denied. |
| `cargo test --manifest-path src-tauri/Cargo.toml --test files_tree_commands --all-features --jobs 1 -- --test-threads=1` | PASS, **8 tests** using TempDir/MockRuntime/injected native adapters. |
| `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings --all-features --jobs 1 -- --test-threads=1` | PASS, **11 tests**, including Files binding integrity. |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features --jobs 1 -- --test-threads=1` | PASS, **498 tests** across all selected targets. Count independently confirmed by the same target selection with `--list`; no old baseline was substituted for this run. |
| `pnpm tauri build` with process-local `CARGO_BUILD_JOBS=1` restored in `finally` | PASS on final source (3m52s), embedding `index-CdeqVsCH.js`. Artifact: `F:/Self Projects/XWork/src-tauri/target/release/xwork.exe`. First build (3m54s) is retained only as intermediate evidence; the final build includes the recovery correction. No binary or installer was launched. |
| `git diff --check`, scoped `git diff --name-only`, `git status --short` | PASS after final build. No Rust, binding, manifest/lock, capability, router, production bridge or historical-plan changes. Untracked source inventory consists only of the planned Files feature and two IPC files. HEAD remains `2814fcf`; `git diff --cached --name-only` is empty. |

Additional actual red/green evidence: `pnpm exec vitest run src/features/files/use-file-explorer.test.ts -t 'removes stale search results'` collected the intended test and failed because `state.search` still contained the disappeared entry while recovery was pending. Starting any recovery search now retires interactive results before dispatch; the full 30-test hook suite and final 2,090-test frontend suite pass. Earlier successful gates are retained as intermediate history rather than presented as verification of the later source snapshot.

Native smoke/metrics are **PENDING**. No isolated VM/Sandbox/dedicated Windows account was supplied or verified; no production binary, installer or `tauri dev` was launched. Clipboard/reveal in WebView2, native IME, narrow/wide layout, theme/font scaling and live terminal resize remain unobserved. The build also retains the existing `com.xwork.app` identifier advisory about the macOS `.app` suffix; macOS validation is deferred to release. Automated completion does not establish native smoke, source viewing, or full Phase 2 completion.

### Intermediate execution evidence — 2026-09-06

- Implementation request explicitly authorizes direct workspace edits and automated gates, without commits, subagents or independent review. Verified starting HEAD `2814fcf`; the four design documents and this active plan were the only initial modified/untracked inputs. They are preserved.
- Added the four production BE013 wrappers, private route-local Files coordinator, tree/search/menu UI, and Sessions/app composition. No Rust, generated binding, dependency, capability, router or production DataManagementBridge change is required.
- Focused IPC/error mapping suite: 26 tests passed. Focused Files hook suite now passes 29 tests, including bounded obsolete scans, exact-path paging/cap, IME/latest search, invalid cursor/root recovery, matching project events, live epoch/busy checks, search-refresh deferral, refresh coalescing and action single-flight across hide/reopen.
- Focused Files tree/panel tests pass 24 tests. They cover keyboard/focus semantics, honest file activation, copy field selection, missing/rejected clipboard, pending feedback, stale path suppression, link reveal refusal, single-flight reveal and empty partial search diagnostics. Clipboard descriptors are restored; all IPC/native actions are mocks.
- Sessions route suite passes 40 tests after adding empty/populated toggle identity and empty-to-populated slot continuity checks. Existing runtime events carry summary updates, so the transition test uses the existing mocked tool-selection command to produce the new tab rather than pretending a summary event contains layout.
- Added real DataManagementHost regression with pending Files paths during reset and failed project refresh. The existing terminal owner still clears runtime on committed reset; Explorer adds no app/terminal remount. App composition tests inspect synchronous Data/Quit reads from public props.
- Test-driven corrections during implementation: a directory becoming a file now retires its retained children; pruned branches invalidate their pending tokens; native action capacity remains occupied until actual completion across hidden/reopened generations. Initial failing test-harness assertions (mock cleanup return, restored expansion call count, menu retry while already open) were corrected separately and are not claimed as product red tests.
- Deviation from prescribed skeleton-first sequence: wrappers/controller and their initial focused tests were introduced together. No artificial red run or inherited baseline is claimed. Final full gates and scope integrity checks are still pending at this checkpoint.
- No isolated Windows VM/Sandbox or dedicated test-account context has been supplied/verified. The application, installer and `tauri dev` have not been launched. Native smoke and metrics remain pending, including clipboard/reveal, IME, narrow layout and live terminal resize; automated results do not establish those observations.

Planning-only baseline (preserved): implementation was pending at handoff. No frontend/Rust gate, Tauri build, native smoke or metrics run was performed by that planning turn.

Planning self-check: template structure populated; task order and paths tied to FE016/current code; all named test files selected by focused commands and final suites; generated-binding and native seams identified; Rust flags explicit; no commit step or independent-review task. Native smoke/metrics prior pending remain unchanged.
