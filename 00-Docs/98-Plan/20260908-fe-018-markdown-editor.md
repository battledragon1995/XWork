# FE-018 Markdown Editor Implementation Plan

**Status:** Implemented — automated Windows gates passed; native manual smoke is blocked because native control is unavailable.

**Goal:** Complete roadmap stage 17 by editing, previewing and manually saving real project Markdown through BE-015, preserving drafts across lifecycle and external-change races.

**Completion Criteria:**

- All four FE-018 wireframe states and specification acceptance criteria are demonstrated.
- Runtime uses existing BE-014/BE-015 commands and generated bindings, with no handwritten DTO or runtime mock.
- Save, conflict resolution and close preflight preserve the latest editor transaction; Save-and-close never closes a partially saved or conflicted target.
- Required Windows frontend, Rust and Tauri gates pass. Native manual smoke is separately evidenced or explicitly blocked; missing native control is never reported as a pass.

**Architecture:** The Files registry owns temporary draft, mode and editor state keyed by handle. Rust owns disk access, dirty authority, optimistic concurrency and lifecycle. A narrowly scoped callback bridge connects existing IPC wrappers to the Files producer without cross-feature imports or a second business-state owner.

**Tech Stack:** Existing React 19, TypeScript 7, CodeMirror 6, Tauri 2, Rust Edition 2024; react-markdown and remark-gfm added only for this feature.

**Sources:**

- `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 17 only.
- `00-Docs/00-Overview/01-TechStack.md`, `00-Docs/00-Overview/02-ProjectStructure.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md` §11.3, §18 and related lifecycle sections.
- Frontend specification: `00-Docs/02-Frontend/FE-018-markdown-editor.md`; existing `FE-017-source-viewer.md`, `FE-007-tabs-and-panes.md`.
- Backend specifications: `00-Docs/03-Backend/BE-015-markdown-save.md`, `BE-014-file-read-and-watch.md`, and existing BE-001/003/005/012 public lifecycle contracts.
- Wireframe: `00-Docs/01-Wireframe/05-Files.html#md-edit`, `#md-preview`, `#md-unsaved`, `#md-conflict`.
- Current generated contracts: `src/bindings/files/files.ts`, `src/bindings/sessions/sessions.ts`, `src/bindings/app-lifecycle.ts`.

## Scope

**In Scope:** Editable Markdown, safe GFM Preview, mode/history retention, manual Save, conflict dialog, tab dirty indication, tab/pane Save-and-close and producer settlement before existing close/project/Quit/data operations.

**Out of Scope:** Notes, Quick Note, roadmap stage 18/19, autosave, Save As, source editing, file creation, backend API changes, schema/capabilities/CSP changes, external preview assets or URL launching, commits and deployment.

## Global Constraints

- React owns presentation and temporary UI state.
- Rust owns OS access, persistence, terminal processes, and business rules.
- Frontend features do not import implementation from other features.
- Generated bindings under `src/bindings/` are not edited manually.
- Write code, identifiers, and code comments in English.
- The initial UI language is English.
- Every function, method, callback, test, and helper must have a short comment describing its purpose.
- Read/write Markdown as UTF-8. All planned source changes must appear in the FE-018 file table.
- No automated desktop end-to-end tests. Unit/component and existing Rust integration/contract tests cover automation; native behavior uses targeted manual Windows smoke.
- Validate only Windows during development. Cargo runs use `-j 2`; defer macOS until release preparation.
- Roadmap stage 17 and the user's explicit decision override the old mock-IPC sentence in PLANS.md. Tests may substitute transport; production must invoke the real backend.
- This plan authorizes no implementation by itself; leave historical BE-015 and FE-017 implementation plans unchanged.

## Assumptions, Risks, and Blockers

**Assumptions:** BE-015 commit `31e324c` is the prerequisite. Backend already exports update/save/resolve and serializes optimistic disk writes. Native Quit requires a dialog whenever any session exists, including a Markdown session with a first buffer update still pending.

**Risks:** Stale query responses can erase draft unless local generation is distinct from backend revision (Task 2). CodeMirror normalizes line breaks unless raw offsets/history are explicitly preserved (Task 3). Nested lifecycle operations can deadlock or release early unless leases are refcounted and idempotent (Task 5). Preview content is untrusted and must not fetch resources or activate navigation (Task 4).

**Blockers:** No design blocker. Native manual smoke is an execution gate only when a native-control surface is available; otherwise record the exact unavailable capability and keep that verification outstanding. Do not add an automation workaround.

## Dependency Order

1. Exact dependencies and typed IPC → registry edit/Save controller.
2. Registry controller → lossless editor and preview/conflict UI.
3. Controller and UI → lifecycle bridge, dirty tabs and application boundaries.
4. Integrated feature → full gates and native smoke evidence.

### Task 1: Add exact dependencies and typed Files wrappers

**Outcome:** Production can invoke the three existing backend commands using generated types.

**Depends On:** BE-015.

**Files:** Modify `package.json`, `pnpm-lock.yaml`, `src/lib/ipc/files.ts`; test `src/lib/ipc/files.test.ts`. Read generated Files bindings only.

**Interfaces:** Consume `UpdateMarkdownBufferRequestDto`, `SaveMarkdownFileRequestDto`, `ResolveExternalFileChangeRequestDto`, `FileHandleDto`, `SaveMarkdownFileResultDto`. Produce `updateMarkdownBuffer`, `saveMarkdownFile`, `resolveExternalFileChange` with the FE-018 signatures.

- [x] Add these complete direct dependency entries under `dependencies`:

  ```json
  "@codemirror/commands": "6.11.0",
  "react-markdown": "10.1.0",
  "remark-gfm": "4.0.1"
  ```

  Do not upgrade other direct dependencies. Run `pnpm install` once after editing the manifest. Compatibility evidence collected 2026-09-08 with `pnpm view`: commands requires state `^6.7.0`, view `^6.27.0`, language `^6.0.0`, satisfied by installed 6.7.4/6.43.11/6.12.4; react-markdown peers React/types >=18, satisfied by existing 19.2.x. react-markdown 10.1.0 and remark-gfm 4.0.1 are specified by TechStack. No engines constraint was returned by those metadata queries. Actual typecheck/build remain mandatory.
- [ ] Extend the existing discovered IPC test module with command/envelope/result/error cases. Add signature stubs only as needed so the test target compiles; the red assertion must fail because the correct command invocation is absent, not because no test is discovered. **Execution note:** The red-first sequence was not performed as written; see Deviations.
- [ ] Run `pnpm test src/lib/ipc/files.test.ts`; expected red: invoke spy does not receive `update_markdown_buffer`, `save_markdown_file` or `resolve_external_file_change` with `{ request }`. **Execution note:** The red-first sequence was not performed as written; see Deviations.
- [x] Implement thin wrappers through `invokeCommand`, retaining error codes and generated results unchanged.
- [x] Run the same focused command and `pnpm typecheck`; expected all wrapper assertions and types pass.

### Task 2: Preserve drafts and serialize Markdown intent in the registry

**Outcome:** One handle owns local draft, mode/history, generation, backend tokens and pending work independently of React mounts.

**Depends On:** Task 1.

**Files:** Modify `src/features/files/file-handle-registry.ts`, `src/features/files/file-handle-context.ts`, `src/features/files/index.ts`, `src/features/files/file-error-copy.ts`; test `src/features/files/file-handle-registry.test.ts`, `src/features/files/file-error-copy.test.ts`.

**Interfaces:** Consume generated Files snapshots and the three wrappers. Extend the existing `FileHandleRegistryDependencies` per-instance test seam with update/save/resolve. Produce entry actions and Files data boundary methods exactly as FE-018. Admission locks must be callable synchronously before their flush promise is awaited.

- [ ] Add discoverable deferred-promise tests to existing registry tests. Signature-only action scaffolds make the assertions execute. Red command: `pnpm test src/features/files/file-handle-registry.test.ts src/features/files/file-error-copy.test.ts`; expected first edit never invokes update, mode is absent after remount, or a stale query replaces the unacknowledged draft. **Execution note:** The red-first sequence was not performed as written; see Deviations.
- [x] Implement first-update immediate dispatch; one update in flight and one coalesced snapshot; retain rendered base token, revision and local generation separately. Ignore stale responses by lifecycle generation and BigInt revision. Preserve draft across transport errors and query reconciliation.
- [x] Implement explicit flush/save/resolve with bounded reconciliation, no auto write replay. SavedWithNewerEdits retains dirty; KeepMine never saves; Reload replaces draft/history only after success. Block >5_242_880 UTF-8 bytes including BOM at the transaction boundary without truncation.
- [x] Preserve mode/editor state for open Markdown handles through LRU pressure and route unmount. Retire only after confirmed lifecycle/not-found; reset uncertain does not clear. Add failure copy for every BE-015 code and transport uncertainty without exposing content.
- [x] Exercise listener registration rejection via injected rejected promise: first query and focus recovery continue, no lost draft. Test dirty convergence, watcher-first-edit race, conflict changed twice, save/newer edit, missing/root-changed recovery, same-path independent handles, reset generation and memory refusal.
- [x] Run the focused command above. Expected all specified sequences pass with exact invoke counts and no unbounded retry. Tests instantiate fresh registry/dependencies; they never call native IPC or use real files.

### Task 3: Implement the lossless editable surface

**Outcome:** Editable CodeMirror retains unsaved raw bytes, selection and history across mode changes and remounts.

**Depends On:** Task 2.

**Files:** Create `src/features/files/markdown-editor-adapter.ts`, `src/features/files/markdown-editor.tsx`; test `src/features/files/markdown-editor-adapter.test.ts`, `src/features/files/markdown-editor.test.tsx`. Read FE-017 theme, language and facts utilities without refactoring them.

**Interfaces:** Consume registry state/actions. Adapter exposes controlled mount/dispose, state restoration, programmatic replacement and raw-text transactions. Tests inject an inert EditorView factory while exercising real EditorState changes/history; component tests inject an adapter factory. No real CodeMirror DOM mount is required in jsdom.

- [ ] Create the intended test modules and minimal compilable exports. Run `pnpm test src/features/files/markdown-editor-adapter.test.ts src/features/files/markdown-editor.test.tsx`; expected red: transaction round-trip changes CRLF/mixed bytes, or editable surface has no change callback/retained state. **Execution note:** The red-first sequence was not performed as written; see Deviations.
- [x] Implement UTF-16 editor-to-raw offset mapping and transaction history so unchanged newline bytes remain unchanged. Use CRLF for new line breaks in a pure CRLF document and LF otherwise. Test deletion spanning CRLF, inserted multi-line text, mixed endings, emoji, undo/redo and no final newline. Do not derive save text from normalized `doc.toString()`.
- [x] Install standard editing/history keymaps without Tab indentation; preserve English accessible name and focus outline. Programmatic ack updates that equal draft do not reset cursor/history. Explicit reload clears history. Reuse existing syntax threshold/theme variables.
- [x] Capture current EditorState before destroying DOM; retain independent scroll offsets. During IME composition, Save waits for compositionend; during a destructive boundary, settle composition before denying further input. If composition cannot settle, reject close preflight and keep draft rather than saving a partial composition.
- [x] Implement loading/error Retry and empty editor, status facts and single live announcements. Add no autosave or format action.
- [x] Re-run the focused command and `pnpm typecheck`. Expected byte round-trips and all component accessibility/retention assertions pass.

### Task 4: Wire safe Preview, conflict resolution and scoped Save

**Outcome:** All four wireframe states work in the existing file pane with safe GFM rendering.

**Depends On:** Tasks 2–3.

**Files:** Create `src/features/files/markdown-preview.tsx`, `src/features/files/markdown-conflict-dialog.tsx`; modify `src/features/files/file-pane.tsx`, `src/app/session-terminal-route.tsx`; test `src/features/files/markdown-preview.test.tsx`, `src/features/files/markdown-conflict-dialog.test.tsx`, `src/features/files/file-pane.test.tsx`, `src/app/session-terminal-route.test.tsx`; extend editor component tests from Task 3.

**Interfaces:** FilePane receives isActive/onActivate/platform/boundary/readBoundary as FE-018 specifies, all from existing Sessions slots/app owners. Preview consumes raw current draft; conflict actions consume generated resolution enum and registry actions.

- [ ] Add discovered tests with minimal component exports before implementation. Run `pnpm test src/features/files/markdown-preview.test.tsx src/features/files/markdown-conflict-dialog.test.tsx src/features/files/file-pane.test.tsx src/app/session-terminal-route.test.tsx`; expected red: Markdown still renders the read-only SourceView, or expected Edit/Preview/Save/Resolve controls are absent. **Execution note:** The red-first sequence was not performed as written; see Deviations.
- [x] Route only backend mode markdown into editor; keep FE-017 unsupported/source behavior. Implement responsive segmented controls, Save, three dirty indicators and recovery content. Lazy-load preview/editor as applicable without losing the underlying entry.
- [x] Render react-markdown with remark-gfm and skipHtml. Replace images with alt text; links display selectable label/URL text without href/navigation; task checkboxes disabled. Test raw HTML, javascript/data/file URLs, remote images, GFM table, task list and empty document. Assert no resource-bearing image/iframe or actionable anchor exists.
- [x] Keep my version and Reload from disk are explicit; Escape dismisses without resolution. Lock transaction admission during resolve; fileChangedAgain requires a new choice. Do not stack conflict and close dialogs. Restore focus to the original trigger/editor after dismissal.
- [x] Save key handler applies only inside active visible Markdown pane and outside dialogs/composition; prevent default there, ignore terminal/Settings/other pane. Test both platform modifiers and repeated Save during flight.
- [x] Run the focused tests plus `pnpm test src/features/files/markdown-editor.test.tsx`. Expected all states, focus, scope, safety and failure assertions pass.

### Task 5: Make close, Quit, project and data boundaries draft-aware

**Outcome:** First-edit close cannot outrun update, dirty dots appear immediately and tab/pane Save-and-close completes only after every target file is saved.

**Depends On:** Tasks 2–4.

**Files:** Create `src/lib/ipc/file-edit-boundary.ts`, `src/lib/ipc/file-edit-boundary.test.ts`. Modify `src/features/files/file-handle-provider.tsx`, `src/lib/ipc/sessions.ts`, `src/lib/ipc/projects.ts`, `src/lib/ipc/app-lifecycle.ts`, `src/lib/ipc/data-management.ts`, `src/features/sessions/use-workspace-mutations.ts`, `src/features/sessions/close-target-dialog.tsx`, `src/features/sessions/session-workspace.tsx`, `src/features/sessions/session-tab-strip.tsx`, `src/features/sessions/session-tab.tsx`, `src/app/quit-store.ts`, `src/app/data-management-bridge.tsx`. Test their existing same-basename test files, including `src/features/files/file-handle-provider.test.tsx`, the four IPC `.test.ts` files, the Sessions hook `.test.ts` and four Sessions component `.test.tsx` files, `src/app/quit-store.test.ts`, `src/app/data-management-bridge.test.tsx`, `src/app/app-shell.test.tsx`.

**Interfaces:** Implement FE-018 callback bridge with per-instance factory seam, idempotent registration cleanup and scope leases. No draft or backend business state lives in the bridge. Wrappers retain exact signatures/envelopes. Add frontend-only `saveFilesBeforeClose(target)` and `hasUnsavedChanges` prop on SessionTab. The registry resolves all target pane IDs via existing `getSession(sessionId): Promise<SessionDetailDto>` when saving a target; labels are never used as IDs.

- [x] Add tests to existing modules and create the bridge test module with compilable no-op exports. Run `pnpm test src/lib/ipc src/features/sessions src/features/files/file-handle-provider.test.tsx src/app/quit-store.test.ts src/app/data-management-bridge.test.tsx`. Expected red: close/remove/Quit/reset invoke occurs before a deferred buffer update resolves; tab has no dirty label after local transaction; Save-and-close action is absent.
- [x] Register producer bridge from provider. settle(scope) synchronously claims admission and then flushes; wrappers hold returned release through their invoke and release in finally. Provider cleanup cannot unregister a newer registration. Independent test bridge instances avoid cross-test global state.
- [x] Add exact scope preflight to getCloseImpact/closeRuntimeTarget; getRemoveProjectImpact/removeProject/locateProjectFolder; requestQuit/confirmQuit; prepareResetXwork. Preflight rejection must prevent the destructive invoke and remain visible in the owning dialog. Preserve typed failure context; do not swallow it as a clean impact.
- [x] Hook Save-and-close claims an outer target lease, saves only Markdown handles sequentially, checks latest file cleanliness plus fresh backend impact, then closes with appropriate existing confirmation. Nested leases must not deadlock. Partial save/conflict/error leaves target open; the files saved earlier remain saved. Existing running-process warning remains visible and confirmed explicitly by this dialog.
- [x] For dirty tab/pane use Cancel / Discard changes / Save and close. Non-dirty terminal-only close behavior remains unchanged. Session/project/Quit keep existing explicit destructive labels and dirty counts; no bulk-save expansion. Subscribe tab strip to bridge projection for any pane in the tab and pass a separate boolean prop without mutating TabDto.
- [x] Tray receive path blocks edits, flushes and refreshes requestQuit before facts/confirm. Flush failure keeps confirmation blocked and cancellation usable. Data beforeConfirm settles Files with existing settings owners; reset committed clears entries, import/uncertain preserve and reconcile. Navigation and hide-to-tray preserve state and never Save.
- [x] Test slow update → close, repeated close, pending Save, failure → no invoke, nested release, stale tray summary, reset preview and confirmation, partial multi-file Save, source-only target, unknown handle query, Cancel/focus, unregister ordering and dirty indicator across tab switching. No real OS resources; invoke and provider callbacks are fakes/deferred promises scoped to each test.
- [x] Re-run the same grouped command; expected all assertions pass, including existing Sessions/Projects/Quit/data regressions. Then run `pnpm typecheck`.

### Task 6: Verify the integrated Windows feature

**Outcome:** Automated gates and any available native evidence support the completion criteria without overstating unperformed checks.

**Depends On:** Tasks 1–5.

**Files:** No source additions. Update only this active plan with evidence, checked tasks, deviations and remaining limitations. Read existing Rust test targets without changing backend scope.

**Interfaces:** Real BE-015 commands, generated bindings, existing Windows writer and lifecycle contracts.

- [x] Run every Final Verification command below. If a command fails, identify whether the implementation introduced it before changing any file; do not expand source scope or weaken flags to obtain a pass.
- [x] Inspect diff for no handwritten binding/DTO, no Rust command registration/capability/CSP/schema change, no content logging, no autosave trigger. Compare changed paths against the FE-018 file table. `git diff -- src-tauri src/bindings` must be empty for this frontend implementation; an existing unexpected diff is a blocker to resolve explicitly.
- [ ] When native control is available, use a newly created disposable project and record Windows/WebView2 context and observed outcomes for Edit/Preview/Save, BOM/CRLF/mixed/IME, source read-only, two handles, external Keep/Reload, first-edit close tab/pane, session/project warning, Settings navigation, reset Cancel and tray Quit Cancel. Never reset or remove the user's real app data; do not execute Quit merely to simulate confirmation. No automated desktop E2E. **Blocked:** This session exposes no native-control surface.
- [x] If no native control exists, record that smoke is blocked and which scenarios remain unverified. Automated build/tests passing does not demonstrate native-window behavior.

## Final Verification

Run from repository root in PowerShell. Use the pinned installed toolchain; avoid concurrent Cargo jobs beyond `-j 2`.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Types | `pnpm typecheck` | No type errors |
| All frontend tests | `pnpm test` | Every planned test module executes and all tests pass |
| Production bundle | `pnpm build` | Editor/preview chunks build without errors |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features -- -D warnings` | Warnings denied, pass |
| Rust all targets/features | `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features` | All tests pass |
| Save contract target | `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-features --test files_markdown_save_commands` | Existing real-file save/close/conflict tests pass with isolated temp roots |
| Binding target | `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-features --test export_bindings` | Generated contracts match |
| Composition target | `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-features --test app_builder` | Existing command composition passes |
| Windows desktop | `$env:CARGO_BUILD_JOBS='2'; pnpm tauri build` | Production Tauri build succeeds; restore prior env value afterward |
| Scope/whitespace | `git diff --check`; `git diff --name-only`; `git diff -- src-tauri src/bindings` | No whitespace errors, only FE-018 allowed paths, backend/bindings unchanged |
| Native smoke | Manual Windows scenarios in Task 6 | Evidence recorded or explicitly blocked, never inferred from build |

The all-tests command covers every listed frontend test file; focused groups are regression checks without zero-match filters. Rust target commands explicitly select integration targets and satisfy the BE-015 all-features/all-targets final requirement. No automated tests access real app data; existing Rust tests retain their temp-directory/injected-service seams.

## Deviations and Decisions

- 2026-09-08: User delegated design decisions; FE-018 records all resolved choices and has no open questions.
- Runtime IPC is real per roadmap/user authorization, overriding the stale mock sentence in PLANS.md.
- Safe preview does not load images or launch links because no matching public asset/URL contract is part of this stage.
- Save-and-close is limited to tab/pane, as the wireframe requires. Other destructive contexts retain their existing explicit warning and Cancel-to-save flow.
- Exact commands dependency compatibility was checked against npm package metadata and existing pinned CodeMirror versions; actual build/typecheck is still required.
- This document follows the completed design sequentially. Historical BE-015/FE-017 plans remain untouched.

- Implementation deviation: tests were authored alongside implementation rather than executing every planned signature-only red scaffold. The first focused regression exposed the old FE-017 Markdown deferral assertion; it was replaced with FE-018 routing expectations, then passed. Do not interpret the unchecked red-first steps as executed evidence.
- Preview uses an explicit dynamic import with loading/failure/Retry state instead of React.lazy, allowing a rejected chunk request to be retried without discarding the registry draft. The CodeMirror raw StateField plus inverted history effects preserve delimiter bytes through undo/redo.
- Existing FE-017 transport fixtures may omit new optional dependency callbacks; production supplies every BE-015 callback and defers invocation until the corresponding intent. New tests inject the callbacks they exercise. App composition supplies active pane, platform, activation and current data/Quit boundary; optional additions to FilePane keep old read-only fixture consumers compatible.
- The shell Data/Quit test was added to the allowed file table and now clears its request spy at the beginning of that scenario. Earlier tray tests legitimately invoke fresh impact under FE-018; the Data scenario still asserts exactly one fresh request after reset.
- Final lifecycle correction: the bridge exposes optional `retire(scope)` notification, called only after close/remove command success. The registry settles initially unknown identities before impact and drops only the confirmed scope; transport rejection never retires drafts. Conflict dismissal explicitly restores the opening control because the modal has no DialogTrigger. Focused retirement/focus tests passed before the final full suite.
- Gates were rerun only after source/test changes or an observed failure. Rust gates were not repeated after frontend-only corrections. No commit, native app launch, shutdown, or unrelated feature work was performed by this implementation task.

## Outcome

Implementation is available for the coordinator to commit. Markdown uses real generated BE-015 requests, retains draft/mode/history outside React mounts, renders inert GFM Preview, provides manual Save and explicit conflict choices, and settles pending edits/Save/IME before lifecycle operations. Tab/pane Save-and-close retains its target after any partial save failure and verifies fresh impact before closing.

### Verification evidence — 2026-09-08, Windows

Each process exit was observed directly; failed earlier attempts are not counted as passes.

| Command | Final evidence |
|---|---|
| `pnpm install` | Exit 0; added only direct pins commands 6.11.0, react-markdown 10.1.0, remark-gfm 4.0.1 |
| `pnpm format:check` | Exit 0; 323 files checked |
| `pnpm lint` | Exit 0; 323 files checked |
| `pnpm typecheck` | Exit 0 |
| `pnpm test` | Exit 0; 134 modules, 2,428 tests passed; final run started 21:17:42 local |
| `pnpm build` | Exit 0; Markdown Preview emitted as its own chunk |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Exit 0 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features -- -D warnings` | Exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-targets --all-features` | Exit 0; existing isolated backend tests passed |
| `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-features --test files_markdown_save_commands` | Exit 0; 5 tests passed |
| `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-features --test export_bindings` | Exit 0; 11 tests passed |
| `cargo test --manifest-path src-tauri/Cargo.toml -j 2 --all-features --test app_builder` | Exit 0; 15 tests passed |
| `pnpm tauri build`, `CARGO_BUILD_JOBS=2` | Exit 0; release `src-tauri/target/release/xwork.exe`; previous environment value restored in finally |
| `git diff --check` | Exit 0 |
| `git diff -- src-tauri src/bindings` | Empty; no backend, generated binding, command, capability, CSP or schema changes |
| Native Windows smoke | **Blocked**, not run; native APIs are disabled in the available UI tool |

Component/registry coverage includes raw CRLF/mixed/emoji/no-final-newline undo/redo, GFM safety, Edit/Preview retention, scoped platform Save, header/body IME settlement, first-edit coalescing, watcher revision reconciliation without retokening, memory refusal, nested admission leases, in-flight Save and reset lifetime, bridge cleanup/failure, pending-update impact ordering, partial Save-and-close refusal, and tray refresh/failure. Existing full-suite lifecycle regressions also passed. No automated desktop E2E or real user app-data test was added.

Native scenarios remain unverified: Windows/WebView2 visual layout/focus/scroll, actual IME composition, BOM/CRLF/mixed file editing, two handles and external changes, close tab/pane/session/project, Settings navigation, reset Cancel, tray Quit Cancel. Build success is not evidence for these scenarios. macOS remains deferred until release preparation.

The bundler still reports non-failing chunk-size and static/dynamic language-import warnings; Tauri reports the existing `.app` bundle-identifier warning. No unrelated bundling configuration was changed.
