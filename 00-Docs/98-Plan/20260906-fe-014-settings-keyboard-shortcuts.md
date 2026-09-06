# FE-014 Settings Keyboard Shortcuts Implementation Plan

**Status:** Implemented; automated verification passed. Isolated Windows manual smoke remains pending.

**Goal:** Deliver the FE-014 Settings page against the existing BE-009 commands, with persisted assignments/reset, accurate conflict feedback, and immediate configuration updates to the seven existing workspace handlers.

**Completion Criteria:**

- The 18-action Phase 1 catalog is searchable and editable through the real backend; custom/default/conflict states match its committed snapshot.
- Recorder Save/Cancel, per-action reset and confirmed restore-all work with keyboard access and recoverable errors.
- Seven workspace actions consume current chords, suppress conflicts and retain existing runtime guards; eleven actions without handlers remain explicitly unavailable.
- All final checks and isolated Windows manual smoke checks below pass. No source implementation is authorized by creation of this plan.

**Architecture:** A Settings-owned provider retains a temporary BE-009 snapshot across routes and serializes reads/writes. The composition root passes snapshot/platform through the Sessions public entry; Sessions never imports Settings implementation. Rust remains responsible for catalog, validation, conflict projection and persistence; shared frontend utilities only normalize, format and match keyboard events.

**Tech Stack:** Existing pinned React/TypeScript, React Router, Zustand where needed for transient state, local shadcn/ui Dialog, Vitest/React Testing Library, and Tauri typed IPC. Add no dependency and change no manifest or lockfile; retain actual versions in the repository rather than installing target versions from the technology overview.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 10 frontend integration after BE-009.
- Technology: `00-Docs/00-Overview/01-TechStack.md`.
- Architecture: `00-Docs/00-Overview/02-ProjectStructure.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §17.4 and §18, with §5.2 and §9.
- Primary specification: `00-Docs/02-Frontend/FE-014-settings-keyboard-shortcuts.md`.
- Integration specifications: `00-Docs/02-Frontend/FE-007-tabs-and-panes.md`, `00-Docs/02-Frontend/FE-011-settings-frame-general-and-about.md`.
- Backend: `00-Docs/03-Backend/BE-009-keyboard-shortcuts.md`, `00-Docs/03-Backend/BE-005-sessions-runtime.md`.
- Wireframe: `00-Docs/01-Wireframe/02-AppShell.html#settings-shortcuts`.

## Scope

**In Scope:**

- FE-014 route, grouped catalog, label search, recorder, warnings and reset interactions.
- Four narrow IPC wrappers using generated DTOs; one provider/coordinator with mount/focus refresh and uncertain-write recovery.
- Snapshot-based matching and labels for the seven existing FE-007 handlers; public prop plumbing through the composition root.
- Unit/component tests, existing backend contract regressions and targeted Windows smoke verification.

**Out of Scope:**

- New navigation/focus/Command Palette handlers, global registration, Quick Note and File Explorer.
- New schema, DTO, command, event, migration, capability, dependency or generic handler registry.
- Editing FE-014, overview, wireframe or completed historical plans; implementing adjacent Settings sections.
- Desktop automated end-to-end tests, macOS execution, Git commits and unrelated cleanup.

## Global Constraints

The following applicable instructions are copied from `AGENTS.md` and `PLANS.md`:

- Use UTF-8 for Markdown files.
- Write code, identifiers, and code comments in English.
- The initial UI language is English.
- Every function, method, callback, test, and helper must have a short comment describing its purpose.
- Creating a plan does not authorize source-code implementation.
- During development, build and test only on Windows.
- Defer macOS validation until release preparation unless explicitly requested earlier.
- Generated bindings under `src/bindings/` are not edited manually.
- Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state.

Use real IPC in the product. Mock IPC only in tests: the matching backend integration already exists, so no temporary runtime mock stage is needed. Preserve the existing close-impact/confirmation and four-pane rules. No direct OS call from a component: consume the existing app-info wrapper. Match physical `code`, not layout-dependent `key`.

## Assumptions, Risks, and Blockers

**Assumptions:**

- FE-014 has no open questions. The user approved explicit Save/Cancel and configurable but unavailable actions without handlers.
- Source is scaffolded despite the stale introductory sentence in AGENTS.md. Four BE-009 commands are registered in `src-tauri/src/app/mod.rs`; generated types exist in `src/bindings/keyboard-shortcuts.ts`.
- The current workspace owns seven hardcoded Windows handlers; FE-014 replaces their source, not their behavior. Default Split down follows BE-009, not the illustrative wireframe override.
- All paths below are established by the specification or current repository. Existing read-only support files include `src/lib/ipc/ipc-error.ts`, `src/lib/ipc/app-info.ts`, `src/components/ui/dialog.tsx`, and the generated binding.

**Risks:**

- A delayed read overwrites a committed mutation: task 2 uses a per-provider serialized coordinator and lifetime guard.
- Recording triggers navigation or loses keyboard escape: tasks 1 and 3 test capture only on the focused recorder, modifier filtering and dialog guards.
- Labels continue advertising inactive/default chords: task 4 replaces every existing workspace accelerator with the same snapshot source.
- New provider initialization leaks native calls into tests: tasks 2–5 explicitly mock shortcut IPC and app-info for shell/router mounting and reset between tests.
- IPC failure may follow a successful commit: task 2 blocks writes/dispatch until a fresh read reconciles unknown outcomes.

**Blockers:** None. If implementation discovers a material contradiction with FE-014, stop and resolve it rather than widening this plan. Backend ownership and the seven-handler limit remain fixed.

## Dependency Order

1. Typed IPC and keyboard primitives → snapshot coordinator and recorder.
2. Snapshot coordinator/provider → Settings route and composition wiring.
3. Settings route/recorder → complete edit/reset behavior.
4. Workspace matching/labels → observable live effect of persisted configuration.
5. Full regression, real IPC build and isolated Windows smoke → completion evidence.

For red tests, first add discoverable test files and compiling, signature-correct minimal exports inside the listed production files. Run the stated command and confirm an assertion fails for the specified missing behavior; missing-module failures and zero discovered tests do not count. Replace these temporary bodies in the same task. Each task's verification command runs again after implementation with all selected tests passing.

---

### Task 1: Establish typed IPC and keyboard primitives

**Outcome:** Call the existing commands with exact envelopes and normalize/format supported chords without a frontend catalog.

**Depends On:** None.

**Files:**

- Create: `src/lib/ipc/keyboard-shortcuts.ts`, `src/lib/utils/keyboard-shortcuts.ts`.
- Test: `src/lib/ipc/keyboard-shortcuts.test.ts`, `src/lib/utils/keyboard-shortcuts.test.ts`.

**Interfaces:**

- Consumes: generated `KeyboardShortcutsDto`, `ShortcutChordDto`, `SetKeyboardShortcutInputDto`, `KeyboardShortcutsError`; existing `invokeCommand` and `IpcCallError`.
- Produces: the four exact wrapper signatures in FE-014: `getKeyboardShortcuts()`, `setKeyboardShortcut(input)`, `resetKeyboardShortcut(actionId)`, `resetAllKeyboardShortcuts()`, each returning `Promise<KeyboardShortcutsDto>`.
- Produces: pure normalization, display formatting and exact matching utilities consumed by recorder and workspace as specified in FE-014; no new public feature API or business-state ownership.
- Test seam: `vi.mock` the Tauri core `invoke` for wrapper tests. Construct synthetic keyboard events and plain DTOs for utility tests; platform is an explicit Windows/macOS input, never the host environment.

- [x] Add compiling exports and tests for all command names/envelopes, known and unknown rejections, full modifier comparison, IME/AltGraph/repeat handling, key allowlist and platform formatting.
- [x] Run `pnpm exec vitest run src/lib/ipc/keyboard-shortcuts.test.ts src/lib/utils/keyboard-shortcuts.test.ts`. Red assertions: invoke has not received `{ input }`/`{ actionId }`, or a valid Ctrl+KeyT does not normalize to the expected chord.
- [x] Implement wrappers through `invokeCommand`; retain error payload casing from bindings. Implement pure utilities without persistence, event listeners or duplicated action defaults. Mirror BE-009 validation only for immediate presentation feedback; backend remains authoritative.
- [x] Repeat the command and run `pnpm typecheck`. Expect correct envelopes, invalid modifier rejection and passing Windows/macOS data-driven formatting cases on Windows.

### Task 2: Retain and reconcile a committed snapshot

**Outcome:** One provider owns transient shortcut state and ordered IPC across route changes.

**Depends On:** Task 1.

**Files:**

- Create: `src/features/settings/keyboard-shortcuts-state.ts`, `src/features/settings/keyboard-shortcuts-provider.tsx`.
- Test: `src/features/settings/keyboard-shortcuts-state.test.ts`, `src/features/settings/keyboard-shortcuts-provider.test.tsx`.

**Interfaces:**

- Consumes: task 1 wrappers and existing `readAppInfo(): Promise<AppInfo>`.
- Produces: `KeyboardShortcutsState`, `KeyboardShortcutsProvider({ children })`, `useKeyboardShortcuts()` with the exact FE-014 state/action signatures. Keep state instance creation private to the feature; expose only provider/hook to app composition.
- Test seams: module mocks for shortcut wrappers and `readAppInfo`, manually resolved/rejected promises for scheduling, and DOM focus events. Mount/unmount a fresh provider for lifetime isolation; no process-global environment mutation or persistent test singleton.

- [x] Add tests with a mounted consumer that observes status/snapshot and calls public actions. Inject an initial `getKeyboardShortcuts` rejection and a separate app-info rejection; both must keep writes/dispatch unavailable while leaving the shell content renderable and permitting retry.
- [ ] Run `pnpm exec vitest run src/features/settings/keyboard-shortcuts-state.test.ts src/features/settings/keyboard-shortcuts-provider.test.tsx`. Red assertions: committed snapshot is not published after assign, or a second mutation reaches IPC while the first is pending.
- [x] Implement single-flight mutation and serialized/coalesced refresh. Publish only returned committed snapshots; known persistence errors keep the old snapshot, unknown transport errors require reconciliation before another write. Keep a pending focus refresh to run after mutation. Ignore results from disposed provider lifetimes.
- [x] Implement platform mapping from existing app-info, loading/refresh/error states and retry. A supported platform is required to record or dispatch. Preserve candidate outside this shared state; route UI owns draft interaction.
- [x] Repeat the command and `pnpm typecheck`. Expect tests for reads before/after writes, focus coalescing, startup failures/recovery, unknown commit outcome, unmount during mutation, StrictMode lifecycle and stale generations to pass.

### Task 3: Deliver the Settings route and accessible recorder

**Outcome:** Users can search, record/save/cancel, inspect conflicts and restore shortcuts through the real typed boundary.

**Depends On:** Tasks 1–2.

**Files:**

- Create: `src/features/settings/settings-keyboard-shortcuts-route.tsx`, `src/features/settings/shortcut-recorder-dialog.tsx`.
- Modify: `src/app/app-shell.tsx`, `src/app/app-router.tsx`.
- Test: `src/features/settings/settings-keyboard-shortcuts-route.test.tsx`, `src/features/settings/shortcut-recorder-dialog.test.tsx`, `src/app/app-shell.test.tsx`, `src/app/app-router.test.tsx`.

**Interfaces:**

- Consumes: provider/hook, generated DTOs, task 1 utilities and existing Dialog component.
- Produces: `SettingsKeyboardShortcutsRoute(): React.JSX.Element`; recorder remains private to Settings. Route lives at `/settings/keyboard-shortcuts`, with existing breadcrumb/navigation metadata.
- Test seams: mock shortcut IPC and app-info in route/shell tests, return typed catalog fixtures scoped inside the listed test files. Use deferred responses for pending UI and rejected `IpcCallError` instances for failures; never call native APIs from jsdom.

- [x] Add tests for 18 rows, group order, eleven unavailable actions, query/empty states, custom/reset/default, filtered-out conflict labels and restore-all confirmation. Add recorder tests for focused capture, Save-only writes, Escape/Cancel, Tab navigation, IME, modifiers, conflict previews, disabled pending actions and focus restoration.
- [ ] Run `pnpm exec vitest run src/features/settings/settings-keyboard-shortcuts-route.test.tsx src/features/settings/shortcut-recorder-dialog.test.tsx src/app/app-shell.test.tsx src/app/app-router.test.tsx`. Red assertions: route still displays the FE-014 placeholder, or Save fails to submit the recorded candidate while Cancel must submit nothing.
- [x] Mount provider around persistent shell content and replace only the FE-014 route element. Retain existing Settings frame lifecycle. Add explicit mocks to existing shell/router tests for new provider reads.
- [x] Implement the wireframe table using backend order/labels; do not hardcode defaults or derive conflict from visible rows. Define candidate state locally, keep Save enabled for valid conflicting chords, and use backend response after commit. All error copy, reset-all behavior (including no custom rows) and focus rules follow FE-014.
- [x] Repeat the command and `pnpm typecheck`. Expect all selected tests to pass, no IPC before Save, and no runtime mock or placeholder for FE-014.

### Task 4: Feed current chords into workspace handlers and labels

**Outcome:** The seven existing handlers react immediately to committed overrides/reset/conflicts, with no stale accelerators or altered runtime operations.

**Depends On:** Tasks 1–3.

**Files:**

- Modify: `src/app/session-terminal-route.tsx`.
- Modify: `src/features/sessions/session-route.tsx`, `src/features/sessions/session-workspace.tsx`, `src/features/sessions/use-workspace-shortcuts.ts`, `src/features/sessions/workspace-shortcuts.ts`.
- Modify: `src/features/sessions/session-tab-strip.tsx`, `src/features/sessions/pane-layout.tsx`, `src/features/sessions/session-pane.tsx`.
- Test: `src/app/session-terminal-route.test.tsx`, `src/features/sessions/workspace-shortcuts.test.ts`, `src/features/sessions/use-workspace-shortcuts.test.ts`, `src/features/sessions/session-workspace.test.tsx`, `src/features/sessions/session-tab-strip.test.tsx`, `src/features/sessions/session-pane.test.tsx`.

**Interfaces:**

- Consumes: `shortcutSnapshot: KeyboardShortcutsDto | null` and `shortcutPlatform: "windows" | "macos" | null` passed from app composition through Sessions entry to consumers. Null means no dispatchable configuration; direct component callers may omit these props only if omission normalizes to null, never hardcoded defaults.
- Produces: existing workspace callbacks driven by the exact seven-ID mapping in FE-014. Preserve existing callback interfaces and local IDs while mapping to canonical backend IDs; match/label helpers take current snapshot/platform instead of a constant catalog.
- Test seams: rerender components with explicit snapshots, mock existing Sessions IPC and callbacks as current tests do. No PTY starts or project access. Add DTO fixture values in listed tests, not a cross-feature implementation import.

- [x] Update tests to provide a default snapshot explicitly. Add cases overriding New tab, assigning a two/three-action conflict, suppressing absent/unavailable data, and changing all rendered accelerators after rerender.
- [ ] Run `pnpm exec vitest run src/app/session-terminal-route.test.tsx src/features/sessions/workspace-shortcuts.test.ts src/features/sessions/use-workspace-shortcuts.test.ts src/features/sessions/session-workspace.test.tsx src/features/sessions/session-tab-strip.test.tsx src/features/sessions/session-pane.test.tsx`. Red assertions: old Ctrl+T still invokes create after reassignment, or conflict still dispatches; tooltips still show hardcoded default text.
- [x] Read Settings only in app composition, pass props through Sessions and recursive pane layout, replace fixed table/matcher and literal labels. Remove only the obsolete constant and helpers made unused by this change. Do not add a competing window listener or generic registry.
- [x] Keep `defaultPrevented`, dialog, editable/select/editor/terminal, IME/repeat/AltGraph, exact modifier and runtime availability guards. Only prevent default after an available unique dispatchable action matches. Preserve close-impact, reopen and split-limit behavior; no new handler for any of the other eleven catalog entries.
- [x] Repeat the command and `pnpm typecheck`. Expect new chords to invoke the original callbacks, old chords to do nothing, conflicted groups to be suppressed and visible buttons to keep working.

### Task 5: Verify real integration and document evidence

**Outcome:** All specified checks pass and Windows evidence demonstrates the user-visible behavior against BE-009.

**Depends On:** Tasks 1–4.

**Files:**

- Test without modification: `src-tauri/tests/keyboard_shortcuts_contract.rs`, `src-tauri/tests/export_bindings.rs`, `src-tauri/tests/app_builder.rs`.
- Review: all task 1–4 files and this plan's Outcome/Deviations sections during authorized implementation.

**Interfaces:**

- Consumes: real four-command BE-009 boundary and current registered app builder; existing Rust test harness creates a `TempDir` and passes its database path to `Storage::open`.
- Produces: recorded check results and smoke evidence; no new test-only production interface.
- Isolation: existing Rust harnesses use temporary storage rather than default app data. Frontend tests mock native boundaries. For manual smoke, run under a disposable Windows user profile with its own app data and create only a disposable empty project folder there; do not reset/change the developer's real shortcuts or use their projects. No environment-variable override of app-data paths is required.

- [x] Run all final commands below; report actual failures and fix only within the established scope. This is a verification task, not a red-test task.
- [ ] Perform manual smoke below using the disposable profile. Record pass/fail and relevant visible outcomes in this plan; do not claim native focus/IME behavior from jsdom tests.
- [x] Inspect `git diff --name-only` and the focused diff: no backend command/capability/migration/binding/manifest change, no runtime mocks and no cross-feature implementation imports. Existing untracked FE-014 specification is an input, not output to overwrite.
- [x] Record final evidence, deviations and remaining limitations. Completion remains withheld pending the manual smoke checklist below.

## Final Verification

Commands run from the repository root unless a different working directory is stated. No listed test may run zero tests. `pnpm test` runs all frontend test files, including all task-specific files above and existing callers affected by new optional props.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend formatter | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Frontend types | `pnpm typecheck` | No type errors |
| Frontend tests | `pnpm test` | All suites pass; new route/provider/recorder/workspace tests discovered |
| Frontend production build | `pnpm build` | Production bundle succeeds |
| BE-009 integration | `cargo test --manifest-path src-tauri/Cargo.toml --test keyboard_shortcuts_contract` | Persistence, conflict, reset, authorization and rollback tests pass on isolated storage |
| Binding contract | `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings` | Generated DTOs match Rust; no hand-edited binding |
| App registration | `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder` | Existing managed service and command registration tests pass |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | No warnings/errors |
| Rust full regression | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | All targets/features pass, including existing Sessions behavior |
| Windows Tauri build | `pnpm tauri build` | Desktop build/bundle succeeds with actual IPC |
| Whitespace/scope | `git diff --check` and focused diff inspection | No whitespace issues or unauthorized source scope expansion |

### Windows manual smoke checklist

Use `pnpm tauri dev` in the isolated profile for live checks and launch the built application there for a production-path confirmation. Do not automate desktop UI.

- [ ] Open Settings with no custom shortcuts: 18 actions, correct defaults, no global/File Explorer entries; eleven unavailable actions remain configurable and clearly labelled.
- [ ] Change New tab to an unused valid combination via keyboard-only recorder. Cancel once to prove no change, then Save; move to a disposable session and verify the new chord works and Ctrl+T no longer does. Verify tooltip changed.
- [ ] Assign the same chord to another existing handler. Both rows identify the conflict and neither shortcut runs; direct action buttons remain usable. Filter one row out and verify the other's warning still names it.
- [ ] Reset one row, then confirm restore-all while a query is active. All defaults return regardless of filter. Cancel restore-all once to prove no mutation.
- [ ] Test typing Vietnamese IME and terminal input, focus traversal/visible focus in the recorder, Escape cancellation, and a combination the OS intercepts without trapping the user. No input is converted into an application action unexpectedly.
- [ ] Hide to tray, bring the app back, check configuration refresh; Quit/restart and verify the saved override persists while runtime sessions do not. Use only disposable test data.
- [ ] Repeat a save and workspace invocation in the production build. Record outcome and build used; no macOS execution is required.

## Deviations and Decisions

- The plan follows the approved FE-014 limit of seven implemented handlers. It does not claim that the remaining eleven catalog actions work, or that the entire Phase 1 shortcut runtime is complete.
- Existing backend integration is already present; this plan runs its contract tests rather than recreating backend work or changing bindings.
- No dependency additions or exact-version selection is needed.
- Added shortcut/app-info mocks to `src/app/app-sidebar.test.tsx` and `src/app/app-topbar.test.tsx`, beyond the initially named test paths. Full regression showed those suites also mount the persistent shell and otherwise attempted native calls in jsdom. No production scope was added.
- The Task 1 red run failed on the intended Ctrl+KeyT normalization assertion before the implementation replaced the stub. Tasks 2–4 were implemented before their dedicated test runs; their planned pre-implementation red runs were not performed and remain unchecked above. Subsequent component/regression failures (restore-dialog query selection, About read count, missing shell test mocks, and asynchronous Radix focus assertions) were resolved and rerun; they are not presented as the planned red evidence.
- Provider effect lifetimes use separate disposed coordinators so StrictMode replay cannot republish a prior generation. A successfully detected platform is retained even if the subsequent catalog read fails.
- A targeted workspace split availability check uses the existing `countPanes`/`PANE_LIMIT` to avoid consuming a matched shortcut when no split can run; the underlying mutation/close-impact behavior is unchanged.


## Outcome

Implemented the four typed IPC wrappers, physical-key normalization/formatting, a retained provider with serialized reads and writes, the real Settings route and recorder, and snapshot-based dispatch/labels for the seven existing workspace handlers. The other eleven actions remain configurable and labelled unavailable. No backend, generated binding, capability, migration, manifest, or lockfile changed.

Automated verification on Windows (2026-09-06):

- `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`: passed with no diagnostics.
- `pnpm test`: passed; **93 suites, 1,713 tests**, no unhandled errors in the final run. New route/provider/recorder/IPC/utility tests and existing Sessions/App regression targets were discovered.
- `pnpm build`: passed as the unchanged `beforeBuildCommand` of `pnpm tauri build`.
- `cargo test --manifest-path src-tauri/Cargo.toml --test keyboard_shortcuts_contract --test export_bindings --test app_builder`: passed; 15 BE-009, 7 binding, and 13 app-registration tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features`: passed, including isolated Windows ConPTY integration tests. The application binary unit-test target contains zero tests; all named integration targets ran their tests.
- `pnpm tauri build`: passed after the final production-source changes. Built `src-tauri/target/release/xwork.exe`; the existing configuration does not produce an installer bundle. Non-fatal warnings remain for the existing `.app` identifier suffix and the frontend bundle exceeding 500 kB.
- `git diff --check`: passed. Focused source review found no cross-feature Settings import from Sessions, runtime mocks, hardcoded workspace accelerators, or changes to backend contracts/manifests/bindings.

Native smoke status: **not performed**. This agent session has no native desktop UI control, and no disposable interactive Windows profile was used. No developer shortcuts, app data, or projects were changed by a manual smoke attempt. The checklist remains unchecked; jsdom and Rust contract results are not native focus, IME, tray, or production-interaction evidence. Do not mark this plan complete until that isolated manual verification is recorded.
