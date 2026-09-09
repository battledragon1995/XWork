# FE020 Floating Quick Note — Stage 19 Implementation Plan

**Status:** Implemented; automated Windows gates passed, native acceptance pending

**Goal:** Deliver the BE017-backed floating Quick Note form, working Home/Welcome entry points, and truthful global shortcut status in Settings.

**Completion Criteria:**

- Save acknowledges one real NoteDto before closing; failed close retries never create a duplicate.
- Floating bootstrap mounts no main-only owners; Home and Welcome open the singleton, and FE014 renders reconciled OS shortcut status.
- Automated Windows gates pass. Record native acceptance separately and honestly if native tooling remains unavailable.

**Architecture:** App composition selects the literal quick-note query before creating the main router. Notes owns a local capture form using existing Notes/Projects IPC; Settings owns global status presentation while Rust retains native window, shortcut and persistence ownership.

**Tech Stack:** Existing pinned React, TypeScript, Tauri, Vitest and Biome dependencies in package.json; no dependencies added.

**Sources:**

- AGENTS.md and PLANS.md
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 19
- Stack/structure: `00-Docs/00-Overview/01-TechStack.md`, `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §§5.1, 12.3, 17.4, 18, 20 Phase3
- Specs: `00-Docs/02-Frontend/FE-020-quick-note.md`, `FE-001-application-shell.md`, `FE-014-settings-keyboard-shortcuts.md` in the same directory
- Backend: `00-Docs/03-Backend/BE-017-quick-note-window.md`, `BE-016-notes.md` in the same directory
- Wireframes: `00-Docs/01-Wireframe/06-Notes.html#quick-note`, `03-Home.html#full`, `#saved`, `#invalid`, `02-AppShell.html#welcome`, `#settings-shortcuts` in the same directory
- Backend handoff: `00-Docs/98-Plan/20260909-be017-quick-note-window.md`; commit 54a8e34

## Scope

**In Scope:** Floating capture; bootstrap; main Home/Welcome opening; FE014 global status; regression and Windows verification.

**Out of Scope:** Backend changes, new permissions/dependencies, draft persistence, autosave, main navigation from floating, cross-window theme protocol, Calendar and reminders.

## Global Constraints

- React owns presentation and temporary UI state.
- Rust owns OS access, persistence, terminal processes, and business rules.
- Generated bindings under `src/bindings/` are not edited manually.
- Frontend features do not import implementation from other features.
- Write code, identifiers, and code comments in English.
- The initial UI language is English.
- Write tests for new behavior and bug fixes.
- During development, build and test only on Windows.
- Do not add or run automated desktop end-to-end tests.
- Every function, callback, helper and test gets a concise English purpose comment. Markdown is UTF-8.

## Assumptions, Risks, and Blockers

**Assumptions:** User authorized design decisions and implementation without another approval. Existing Home capture is retained. Read-only get_settings accepts AppHandle and is available to floating; mutations are main-only.

**Risks:** Create acknowledgment and close failure can duplicate notes unless synchronous committed identity is retained. Main providers issue unauthorized IPC in floating. Status reconciliation is asynchronous after shortcut mutation and initial setup. Tasks below cover each risk.

**Blockers:** No design blocker. Native control is disabled; manual Windows smoke/p95 remains pending and must not be reported as passed. Continue independent automated implementation.

## Dependency Order

1. Typed IPC wrappers → isolated form and status hook.
2. Floating form → bootstrap and Home/Welcome composition.
3. Status hook → FE014 route integration.
4. All tasks → regression gates and coordinator commit.

### Task 1: Provide the existing BE017 IPC boundary

**Outcome:** Exact typed wrappers for the four commands and one status event.

**Depends On:** None.

**Files:** Create `src/lib/ipc/quick-note-window.ts`; test `src/lib/ipc/quick-note-window.test.ts`. Read generated `src/bindings/quick-note-window.ts`.

**Interfaces:** Produce openQuickNoteWindow(), closeQuickNoteWindow(), startQuickNoteWindowDrag(): Promise<void>; getQuickNoteGlobalShortcutStatus(): Promise<QuickNoteGlobalShortcutStatusDto>; onQuickNoteGlobalShortcutStatusChanged(handler): Promise<UnlistenFn>. Consume invokeCommand and Tauri listen through established wrapper conventions.

- [x] Add discoverable IPC tests with mocked invoke/listen; implement signatures first so failure is assertion on missing exact invoke/event forwarding rather than undiscovered target.
- [ ] Run `pnpm exec vitest run src/lib/ipc/quick-note-window.test.ts`; observe missing command invocation/event forwarding.
- [x] Implement exact no-argument commands, safe typed errors and payload forwarding; do not edit generated contracts.
- [x] Repeat focused command: all tests pass including unsubscribe and typed rejection.

### Task 2: Implement isolated floating capture

**Outcome:** Manual Save, explicit Cancel and safe close recovery without main providers.

**Depends On:** Task 1.

**Files:** Create/test `src/features/notes/quick-note-window.tsx`, `src/features/notes/quick-note-window.test.tsx`; modify `src/features/notes/index.ts`. Optional proven shared validation extraction: `src/features/notes/quick-note-validation.ts`, `src/features/notes/quick-note-validation.test.ts`, and existing `quick-note-composer.tsx`/`.test.tsx`.

**Interfaces:** Export QuickNoteWindow(): React.JSX.Element. Consume createNote(CreateNoteInputDto), listProjects, noteErrorCopy and close/drag wrappers. Local state/ref retains committedNote, in-flight admission and mounted lifetime. Tests mock all IPC and control deferred promises; no actual app data.

- [x] Add component skeleton and tests for body-required validation, raw Markdown/project payload, Save-before-close and rejected close followed by Retry Close.
- [ ] Run `pnpm exec vitest run src/features/notes/quick-note-window.test.tsx`; expect missing input/Save or absent acknowledged create/close order.
- [x] Implement design UI and state transitions, one synchronous flight, committed NoteDto set before close, unknown outcome read-only, typed recovery, project loading/error/removed choice, IME guards, Escape, primary titlebar drag, focus and unmount cleanup.
- [x] Add races: double Save, Cancel during Save, unmount before response, drag error preserving text, failed Cancel close preserving draft. Verify only createNote acknowledgment authorizes save-close and Retry Close cannot call createNote.
- [x] Run `pnpm exec vitest run src/features/notes/quick-note-window.test.tsx src/features/notes/quick-note-composer.test.tsx`; all pass. If helper extracted, also run `pnpm exec vitest run src/features/notes/quick-note-validation.test.ts`.

### Task 3: Compose the right window and activate Home/Welcome

**Outcome:** Literal query opens floating presentation; main routes and embedded capture retain behavior.

**Depends On:** Task 2.

**Files:** Modify `src/main.tsx`, `src/app/home-entry.tsx`, `src/features/home/home-route.tsx`, `src/features/home/welcome-screen.tsx`; create `src/app/window-entry.tsx`. Test `src/app/window-entry.test.tsx`, `src/app/home-entry.test.tsx`, `src/features/home/home-route.test.tsx`, `src/features/home/welcome-screen.test.tsx`.

**Interfaces:** App window entry selects main/floating from search string; main retains createAppRouter/AppProviders, floating composes TooltipProvider/AppearanceThemeSync/QuickNoteWindow. Extend HomeRoute and WelcomeScreen props with app-owned opening callback/pending/error presentation as required by FE020; main live readBoundary controls admission. bootstrapAppSettings remains read-only startup for both.

- [x] Add testable entry selector/composition and Home/Welcome tests. Test mocks main providers/router and asserts they never mount for exact quick-note query; unrelated/missing query uses main.
- [ ] Run `pnpm exec vitest run src/app/window-entry.test.tsx src/app/home-entry.test.tsx src/features/home/welcome-screen.test.tsx`; expected missing floating branch or Quick Note action still unavailable.
- [x] Implement minimal app composition and callbacks; opening does not transfer Home draft or navigate main. Preserve current Home Save and existing unavailable controls unrelated to Quick Note.
- [x] Test opening error/retry, synchronous double click and live Data/Quit guard. Failure injection is rejected openQuickNoteWindow promise; expected alert and retained route/draft.
- [x] Run `pnpm exec vitest run src/app/window-entry.test.tsx src/app/home-entry.test.tsx src/features/home/home-route.test.tsx src/features/home/welcome-screen.test.tsx`; all pass.

### Task 4: Show truthful global shortcut registration status

**Outcome:** FE014 distinguishes active, conflict, unavailable and pending reconciliation.

**Depends On:** Task 1.

**Files:** Create `src/features/settings/use-quick-note-shortcut-status.ts`; test `src/features/settings/use-quick-note-shortcut-status.test.tsx`; modify/test `src/features/settings/settings-keyboard-shortcuts-route.tsx`/`.test.tsx`.

**Interfaces:** Hook consumes BE017 snapshot/status listener, browser focus, and current BE009 action chord; exposes status/error/refresh. Route consumes existing BE009 mutation coordinator unchanged. All tests mock snapshot/listen and browser focus; no OS registrations.

- [x] Add a hook skeleton and route tests for global action availability and actual OS status instead of catalog inference.
- [x] Run `pnpm exec vitest run src/features/settings/use-quick-note-shortcut-status.test.tsx src/features/settings/settings-keyboard-shortcuts-route.test.tsx`; expect missing active/unavailable status and stale unavailable action label.
- [x] Implement subscribe-before-snapshot, decimal sequence comparison, older/duplicate suppression, chord mismatch pending state, mount/focus/explicit Retry reads, mutation-success refresh, and late-unlisten cleanup. Initial unavailable snapshot error is recoverable by subsequent event.
- [x] Cover snapshot/event inversion, subscription failure, invalid sequences, unmount pending subscription, unavailable→active and catalog mutation retained despite OS failure.
- [x] Repeat focused command; all tests pass.

## Final Verification

- [x] Run each focused target above, then these gates once changes settle.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | Pass |
| Frontend lint | `pnpm lint` | Pass |
| Frontend types | `pnpm typecheck` | Pass |
| Frontend tests | `pnpm test` | All pass, including every new target |
| Frontend build | `pnpm build` | Pass |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Pass |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings` | Pass |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- --test-threads=1` | Pass; report existing ignored test |
| Explicit desktop contracts | `cargo test --manifest-path src-tauri/Cargo.toml --test quick_note_window --test keyboard_shortcuts_contract --test app_lifecycle --test window_configuration -j 2 -- --test-threads=1` | All selected targets pass |
| Windows Tauri | `pnpm tauri build` | Executable builds; scope CARGO_BUILD_JOBS=2 and restore it if used |
| Whitespace | `git diff --check` | Pass |

- [x] Verify no dependency/generated/backend/capability mutation using scoped git diff; inspect production import paths for guest window/global-shortcut usage and floating bootstrap owners.
- [ ] Native Windows acceptance in isolated account/VM: Home/Welcome/tray/global singleton, keep draft on repeated trigger, main hidden independence, on-top/drag/resize, Save reflected in Notes/project, validation/IME, Cancel/Escape/native close/reopen, shortcut rebind/conflict/reset, Quit release. Carry BE017 native timing checklist and stage18 Phase3 Notes/Search/backup evidence forward. Mark pending if not executable; do not add desktop E2E.
- [x] Update active plan with automated evidence and native limitations. Coordinator commits authorized result as `Implement FE020`; implementer does not commit.

## Deviations and Decisions

- 2026-09-09: User delegated all design questions. Floating uses independent local state because main NotesProvider has broader IPC rights; pure validation reuse is permitted only if actually shared.
- Read-only get_settings is allowed in floating by existing Rust signature; theme snapshot can therefore be applied without backend changes. No settings mutation or main global-status request is sent from floating.
- Native acceptance is separate from automated completion and does not block independent next-stage work.

## Outcome

Floating capture, isolated window composition, Home/Welcome opening and FE014 registration status are implemented. Focused verification: 127 tests across all nine planned targets pass. All automated Windows gates passed; detailed evidence is recorded below. Native acceptance remains pending.


### Implementation evidence and decisions — 2026-09-09

- Floating validation stays local; no shared helper was needed and the existing Home composer remains unchanged.
- HomeScreen and its test are included in Task 3 because that existing component owns the actual Home header entry. Welcome and HomeScreen historical unavailable assertions were updated for the shipped action.
- Test-first deviation: IPC, floating and window bootstrap were implemented before their focused tests; no artificial red run is claimed. FE014 route tests produced two intended failures before implementation, and the old Welcome/Home assertions exposed the newly available actions before their expectations were updated.
- The first full frontend run passed 2565/2567 tests. Failures: the obsolete HomeScreen unavailable assertion (updated) and the unrelated Markdown editor preview timing assertion during concurrent Rust compilation. The two focused targets then passed 21/21 without editing Markdown editor source/tests. Final full rerun limits Vitest workers to two, preserving all test targets/assertions.
- Source-boundary verification: scoped `git diff --name-only -- src-tauri src/bindings package.json pnpm-lock.yaml` is empty; production capture and IPC imports contain no guest window/global-shortcut API. The quick-note branch returns before `createAppRouter()` and mounts only TooltipProvider, AppearanceThemeSync and QuickNoteWindow.


### Final automated evidence

- Focused nine targets: 127/127 passed (`%TEMP%/xwork-fe020-focused.log`). HomeScreen/Markdown editor focused regression rerun: 21/21 passed (`xwork-fe020-regression-retry.log`).
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`: passed (corresponding `xwork-fe020-format`, `-lint`, `-types`, `-build.log` files under `%TEMP%`).
- Final full suite `pnpm test --maxWorkers=2`: 149 files / 2567 tests passed; all targets and assertions retained (`%TEMP%/xwork-fe020-tests-final.log`).
- Rustfmt, Clippy with all targets/features and warnings denied: passed. Full Rust tests: 561 passed, one existing ignored `notes_windows_10000_record_benchmark` (`xwork-fe020-rustfmt`, `-clippy`, `-rust-tests.log`).
- Explicit app_lifecycle, keyboard_shortcuts_contract, quick_note_window and window_configuration targets: passed (`%TEMP%/xwork-fe020-contracts.log`).
- Native Windows smoke/p95 and Phase 3 native acceptance remain pending because native computer control is disabled. No desktop E2E was added or run; macOS validation is deferred.
- Windows `pnpm tauri build` passed with scoped CARGO_BUILD_JOBS=2 restored afterward; executable: `src-tauri/target/release/xwork.exe` (`%TEMP%/xwork-fe020-tauri.log`). Existing CodeMirror chunk warnings remain non-blocking.
- Final format/lint/types rerun and `git diff --check` passed. No source changes followed the successful full suite. Coordinator may commit the authorized result as `Implement FE020`.
