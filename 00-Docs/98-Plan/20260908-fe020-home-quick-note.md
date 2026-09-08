# FE-020 Home Quick Note — Stage 18 Implementation Plan

**Status:** Automated implementation complete; native Windows stage acceptance pending.

**Goal:** Complete the remaining stage 18 product scope by saving or cancelling a Quick Note on Home through existing BE-016 APIs, without duplicate creation or maintenance races.

**Completion Criteria:**

- Home optional-title Markdown/project Save creates one persisted note; Cancel/invalid submission creates none; success clears the composer and opens the acknowledged note on demand.
- Existing Notes CRUD/autosave/pin/project/Archive/Trash and Home/Overview/Search/backup integration remain verified; stage 18 handoff checklist below records baseline and new evidence separately.
- Frontend, Rust and Windows Tauri gates pass. Required native smoke is recorded honestly as passed with isolated-environment evidence or pending; automated completion alone does not prove full stage acceptance.

**Architecture:** Extend the existing NotesProvider with one separate manual quick draft and create flight. App HomeEntry injects the public QuickNoteComposer through the existing Home slot and passes live Data/Quit admission. Rust remains persistence authority; FE-019 projections and public Data boundary are reused without a new owner registry, backend contract or cross-feature implementation import.

**Tech Stack:** Existing locked React/TypeScript, native input/textarea/select and copied Button, Tailwind tokens, React Router, Vitest/Testing Library, Tauri 2 and Rust. No dependency is added or upgraded; manifest and lockfile entries remain unchanged.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 18 and explicit stage 19 boundary
- Architecture/technology: `00-Docs/00-Overview/02-ProjectStructure.md`, `00-Docs/00-Overview/01-TechStack.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §§6, 12.1–12.3, 17.6, 18
- Frontend: `00-Docs/02-Frontend/FE-020-quick-note.md`, `FE-019-notes.md`, `FE-003-home.md` in the same directory
- Backend: `00-Docs/03-Backend/BE-016-notes.md`
- Wireframes: `00-Docs/01-Wireframe/03-Home.html#full`, `#saved`, `#invalid`, `#empty`; `00-Docs/01-Wireframe/06-Notes.html#quick-note` reviewed only to distinguish deferred floating scope
- Historical evidence, read-only: `00-Docs/98-Plan/20260908-be016-notes.md`, `00-Docs/98-Plan/20260908-fe019-notes.md`

## Scope

**In Scope:**

- FE-020 embedded Home form, explicit Save/Cancel, project choices, validation, success link and safe recovery.
- Separate retained manual state in NotesProvider; Data barrier and identity retirement; Home app slot composition; integration regression and stage 18 handoff.

**Out of Scope:**

- Floating Quick Note window, BE-017, stage 19 tray/global shortcut/window entry, FE-014 changes, Calendar and phase 3 full acceptance.
- Backend/DTO/event/capability/migration/manifest changes, persistent draft, preview/editor framework, generic queue or new dependency.
- Rewriting completed plans, Git commit steps, shutdown, macOS work and automated desktop E2E.

## Global Constraints

The following applicable instructions are copied from AGENTS.md and PLANS.md:

- “Use UTF-8 for Markdown files.”
- “Write code, identifiers, and code comments in English.”
- “The initial UI language is English.”
- “Every function, method, callback, test, and helper must have a short comment describing its purpose.”
- “React owns presentation and temporary UI state.”
- “Rust owns OS access, persistence, terminal processes, and business rules.”
- “Frontend features do not import implementation from other features.”
- “Generated bindings under `src/bindings/` are not edited manually.”
- “Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state.”
- “During development, build and test only on Windows.”

Roadmap stage ownership and the FE-020 decision supersede the old PLANS.md mock-development clause: production always uses real existing IPC wrappers; doubles are confined to tests. Do not add or run desktop E2E. Preserve existing manifests/lockfiles and lifecycle guarantees. Use at most two Cargo build jobs and serialize the full Rust test harness as in existing regression gates.

## Assumptions, Risks, and Blockers

**Assumptions:**

- Local creation date is 2026-09-08. BE-016 baseline commit is `e4191e9`; FE-019 baseline is `2a79a90`. Confirm these commits exist before implementation and record the actual starting HEAD without editing historical evidence.
- User authorized resolving material design choices; FE-020 has no open questions for Home scope.
- Home quickNoteSlot, NotesProvider, generated CreateNoteInputDto/createNote, useNoteProjects and useNotesDataBoundary already exist or are explicitly extended by FE-020; production Data bridge does not need a new API.
- Welcome remains authoritative empty-data behavior; no floating entry is implemented there.

**Risks:**

- Reusing autosave draft would overwrite Notes edits or save without intent: Task 1 keeps state/flight separate and tests no automatic create.
- Transport rejection does not prove create failed: uncertain state disables Save, preserves copyable text, requires explicit Cancel before a new intent; no event/text matching or automatic retry.
- Import/reset may race a retained form after Home unmount: Task 1 extends the existing public barrier, Task 3 verifies the real bridge.
- Native crash/force exit/immediate tray Quit can lose unacknowledged drafts under current lifecycle; no backend change is authorized. Record the limitation in smoke/handoff.

**Blockers:** No design or implementation blocker. Native Windows acceptance requires a disposable Windows VM/Sandbox/test account and manual operation; if unavailable, leave those checkboxes pending rather than claiming a pass.

## Dependency Order

1. Completed BE-016/FE-019 → retained quick owner and barrier.
2. Retained owner → composer behavior and public export.
3. Composer/public boundary → Home composition and maintenance/integration regression.
4. Integrated code → full gates and stage 18 handoff.

---

### Task 1: Retain manual Quick Note state and make Data maintenance safe

**Outcome:** Quick draft survives view unmount, never autosaves, serializes one create and cannot cross Data reset/import lifetimes.

**Depends On:** Existing BE-016/FE-019.

**Files:**

- Modify: `src/features/notes/notes-provider.tsx`
- Test: `src/features/notes/notes-provider.test.tsx`
- Modify if fixture extension is needed: `src/features/notes/notes-test-fixture.tsx`

**Interfaces:**

- Consumes: generated CreateNoteInputDto/NoteDto/NotesError, createNote, IpcCallError, noteErrorCopy, NotesOwner.invalidate and existing maintenance methods.
- Produces: QuickNoteState and Snapshot.quickNote; NotesOwner.quickFlight; editQuickNote(patch), saveQuickNote(): Promise<void>, cancelQuickNote(): void as specified in FE-020. Existing public useNotesDataBoundary signatures remain unchanged.
- Test seam: existing vi.mock IPC wrappers and NotesTestHost capture callback; isolated owner per test, deferred create promises, fake timers, mock listeners. No native resources or process-global environment mutation.

- [x] Add discoverable tests to the existing provider target. First establish expectations using a narrow test-only structural capability check of the captured owner so the red assertion is that saveQuickNote/editQuickNote are absent, rather than an undiscovered file. Replace that temporary capability check with direct typed calls once signatures exist. Add cases asserting editing/hidden/advancing 500 ms does not call createNote, Notes draft remains unchanged, duplicate Save produces one invocation and accepted flight settles correctly across barrier admission.
- [x] Run `pnpm exec vitest run src/features/notes/notes-provider.test.tsx`. Expected initial red: captured owner lacks the specified quick actions; after scaffolding, behavior tests fail on unexpected autosave, duplicate call count or barrier admission until implemented. Confirm nonzero tests are collected.
- [x] Implement the minimal state and guarded actions. Freeze edits/Cancel during flight. Submit raw Markdown, use backend ack only for success, retain typed-error text, mark untyped outcome uncertain and never replay. Invalidate after ack and unknown outcome; preserve existing Notes autosave queue. Add comments to every function/callback/helper/test.
- [x] Extend settleBeforeDataChange to claim blocked synchronously, await admitted quick flight, reject remaining nonempty/uncertain draft with Home recovery message, and retain existing Notes flush behavior. Empty quick state/success may pass. Clear/import reconciliation retire identity and success feedback; old callbacks cannot republish. A rejected settle is released by existing bridge, not by an early local unblock.
- [x] Add boundary tests: Save before versus after same-tick claim, pending flight successful/failing, title-only/project-only/whitespace, known/unknown failures, release then Save/Cancel recovery, refresh/reset while old callback is pending, Notes autosave independence, no replay after focus/hidden/listener invalidation.
- [x] Re-run focused provider command and `pnpm typecheck`. Expected all retained-state/race assertions and existing autosave tests pass.

### Task 2: Deliver the accessible Home composer and safe feedback

**Outcome:** Wireframe full/saved/invalid behavior runs on the real Notes owner, using existing API contracts.

**Depends On:** Task 1.

**Files:**

- Create: `src/features/notes/quick-note-composer.tsx`
- Create/Test: `src/features/notes/quick-note-composer.test.tsx`
- Modify: `src/features/notes/index.ts`
- Modify only if loading state is required: `src/features/notes/note-actions.tsx`
- Test: `src/features/notes/note-actions.test.tsx`
- Reuse fixture: `src/features/notes/notes-test-fixture.tsx`

**Interfaces:**

- Consumes: useNotes internal state/actions, useNoteProjects, noteErrorCopy, generated NoteDto/ProjectDto, app-provided suspended boolean and readSuspended(): boolean, existing Router navigation.
- Produces: public QuickNoteComposer({ suspended, readSuspended }): React.JSX.Element via index, no new runtime IPC wrapper.
- Test seam: existing NotesTestHost, generated DTO fixtures and IPC mocks; memory router, deferred project/create promises and simulated composition events.

- [x] Create an importable minimal component returning null with the final public signature and its discoverable test file, then assert labelled Title/Markdown/Project fields and Save/Cancel exist. Run `pnpm exec vitest run src/features/notes/quick-note-composer.test.tsx src/features/notes/note-actions.test.tsx`. Expected red: form labels and Save control are missing; not zero tests or module-resolution failure.
- [x] Implement input/textarea/select and existing Button styling with responsive footer. Reuse useNoteProjects without importing other features. Add loading state to that hook only if needed; preserve its existing consumers and test project removal/unavailable/loading/error semantics. No project remains usable while choices fail.
- [x] Implement manual Save with IME and live suspended guard, field-specific validation/focus, byte/scalar/control limits, Cancel clearing local state only, success status and Open note route, typed-error retry, uncertain read-only/copyable text with Open Notes and explicit Cancel warning. No new shortcut, clipboard API or preview.
- [x] Add cases for title null/whitespace normalization authority, body whitespace, title 255/256 Unicode scalars and C0/C1 controls, body 1 MiB boundary including multibyte text, verbatim Markdown submission, selected missing project, double submit, IME Enter, no focus stealing after navigation, success reset including project and late error recovery. Verify Cancel never invokes delete/create and uncertain cannot retry through Save, edit, focus or duplicate event.
- [x] Re-run focused command and `pnpm typecheck`. Expected all UI and existing project-action tests pass; actual create payload matches generated DTO.

### Task 3: Compose Home and verify maintenance plus aggregate behavior

**Outcome:** Home uses the real provider-backed composer before existing Notes sections, with live guards and no cross-feature imports.

**Depends On:** Tasks 1–2.

**Files:**

- Modify: `src/app/home-entry.tsx`
- Test: `src/app/home-entry.test.tsx`, `src/app/data-management-bridge.test.tsx`
- Test: `src/features/home/home-screen.test.tsx`, `src/features/home/home-route.test.tsx`
- Test: `src/features/notes/note-sections.test.tsx`, `src/app/project-overview-entry.test.tsx`, `src/app/search-entry.test.tsx`

**Interfaces:**

- Consumes: public QuickNoteComposer/HomeNoteSections/useNotesPresence; HomeRouteProps.quickNoteSlot; HomeEntry readBoundary, Data getCurrent, Quit store; existing Notes public Data boundary.
- Produces: app composition only; no Home/Projects implementation import of Notes, no production Data bridge change.
- Test seam: existing real provider/router/bridge fixtures with wrapper mocks; extend HomeEntry tests to mount NotesProvider when mounting actual composer. Deferred create/project/list responses reproduce epoch races; all data and mutation commands mocked, no real app data.

- [x] Add HomeEntry assertion that Quick Note labels appear before Notes section when project/note presence selects Home. Add dirty quick draft test through real DataManagementHost while Home is unmounted. Run the focused command below. Expected red before composition: Quick Note controls are missing from Home; maintenance cannot yet be exercised through that form. After composing, dirty draft must reject confirm without any confirm IPC invocation.
- [x] Inject QuickNoteComposer into the existing slot, deriving suspended/readSuspended from the same live boundary used by Home. Do not change Home production files or add a feature import there. Reuse existing providers and route identity.
- [x] Verify ack triggers Notes/Home/Project query invalidation even if native listen fails; query failure preserves saved feedback and Refresh is read-only. Open note uses returned ID and existing route resolution, preserving an unresolved Notes editor. Preserve Search/Overview aggregate behavior and Welcome for truly empty data.
- [x] Verify Data/Quit same-tick admission and late route completion, barrier on dirty/title-only/uncertain drafts after Home unmount, pending create drain, failure release, reset/import identity retirement and no stale feedback/row resurrection. Add only relevant fixture mocks for new reads; do not mask unrelated regressions or assert counts by omitting required callbacks.
- [x] Run `pnpm exec vitest run src/app/home-entry.test.tsx src/app/data-management-bridge.test.tsx src/features/home/home-screen.test.tsx src/features/home/home-route.test.tsx src/features/notes/note-sections.test.tsx src/app/project-overview-entry.test.tsx src/app/search-entry.test.tsx src/lib/ipc/notes.test.ts` and `pnpm typecheck`. Expected all integration/regression assertions pass, including wrapper contract.

### Task 4: Verify Windows gates and close the stage 18 handoff

**Outcome:** Repeatable automated evidence for final tree and a truthful acceptance checklist, without implementing stage 19.

**Depends On:** Tasks 1–3.

**Files:**

- Update during this implementation only: `00-Docs/98-Plan/20260908-fe020-home-quick-note.md`
- Read-only contracts/gates: `src-tauri/tests/notes_contract.rs`, `src-tauri/tests/unified_search_contract.rs`, `src-tauri/tests/data_management_contract.rs`, `src-tauri/tests/export_bindings.rs`

**Interfaces:**

- Consumes: completed frontend behavior and existing Rust public contract test targets.
- Produces: per-command exit/evidence record and completed/pending handoff items, not a source or backend interface.
- Isolation: existing Rust contract fixture temporary Storage paths and fake platform/project resources; inspect existing fixtures if a gate changes behavior. Native smoke only in an explicitly disposable VM/Sandbox/test account; never use the developer's real profile for import/reset or test notes.

- [x] Run every Final Verification gate; capture command, exit and log location separately. Preserve initial failures and resolved causes; do not report a retry as if first attempt passed.
- [x] Inspect changed files for scope/import/contract drift using the concrete static checks below. Generated-binding test must leave no unexpected diff; do not hand-edit its output.
- [x] Complete the handoff checklist with baseline references and new evidence. Required native checks stay unchecked if tooling/environment is unavailable. Do not claim the whole phase or stage 19 complete.

## Final Verification

Run from repository root in Windows PowerShell. These are future execution requirements, not passes obtained by writing this plan.

| Scope | Command | Expected Result |
|---|---|---|
| Whitespace | `git diff --check` | No whitespace errors |
| Frontend format | `pnpm format:check` | Pass |
| Frontend lint | `pnpm lint` | Pass |
| Frontend types | `pnpm typecheck` | Pass |
| Frontend suite | `pnpm test` | All tests, including every test file in Tasks 1–3, pass |
| Frontend production | `pnpm build` | Pass |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings` | Pass, warnings denied |
| Notes contract | `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test notes_contract` | Persistence/validation/lifecycle pass |
| Search contract | `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test unified_search_contract` | Notes Search source/target pass |
| Data contract | `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test data_management_contract` | Backup v1/v2/reset/rollback pass |
| Generated contract | `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test export_bindings` | Bindings have no drift |
| Full Rust regression | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- --test-threads=1` | All tests pass |
| Windows desktop | Set `$env:CARGO_BUILD_JOBS = '2'`, run `pnpm tauri build`, restore prior environment value in `finally` | Build passes without running app against user data |

Static negative-scope verification: inspect `git diff --name-only` and `git status --short` against FE-020 inventory. `git diff --exit-code -- package.json pnpm-lock.yaml src/bindings src-tauri` must exit 0. Review `rg -n 'features/(notes|projects|home)|@/app' src/features/notes src/features/home` results for prohibited production imports; test imports are evaluated separately. Review `rg -n 'invoke\(|localStorage|sessionStorage|clipboard|setInterval|createWebview|globalShortcut' src/features/notes/quick-note-composer.tsx src/features/notes/notes-provider.tsx src/app/home-entry.tsx`; no newly introduced direct IPC, persistence, clipboard, polling or stage19 native surface. An rg exit 1 means no matches, not a failed quality gate. No runtime assertion is invented to prove absent native registrations: unchanged backend/capabilities/configuration and focused diff provide that evidence.

## Stage 18 Handoff Checklist

Baseline evidence is historical and read-only, not new verification of this tree. BE-016 commit `e4191e9` records CRUD/Search/backup v2 and Windows gates. FE-019 commit `2a79a90` records Notes UI/Home/Overview/Search/Data integration; its plan records final frontend 144 files/2,491 tests and Windows Tauri build, with native smoke entirely pending. The implementer must confirm the baseline references, rerun the final gates above and fill the following items with concrete logs/assertions.

- [x] Notes CRUD and optional-title/body validation: notes_contract plus Notes route/provider/component evidence recorded.
- [x] Notes autosave/debounce/IME/revision/conflict and uncertain-create safety: existing provider/editor tests still pass; quick state independence demonstrated.
- [x] Pin and project link/unlink, unavailable/removed project behavior: Notes action tests plus backend Notes contract evidence recorded.
- [x] Archive/restore and Trash/restore/permanent delete/Empty Trash confirmation: existing UI and Rust contract evidence recorded.
- [x] Home pinned/recent and note-only presence, Project Overview linked notes and Search result opening: aggregate frontend and unified_search_contract evidence recorded.
- [x] Backup export v2/import v1-v2/rollback/reset coverage: data_management_contract and bridge tests pass; no schema change introduced.
- [x] FE-020 Home full/saved/invalid/Cancel, one-flight real wrapper payload, success query invalidation/Open note and project selection: new focused tests recorded.
- [x] FE-020 retained draft, unknown create no replay and Data/Quit/late-response admission: new provider/bridge/Home tests recorded.
- [x] All automated gates pass for the final tree; record exact counts, commands, exits, logs and built artifact path.
- [ ] Native Windows smoke in identified disposable environment: real Save with/without project, restart confirms acknowledged note, Cancel creates none, Home/Overview/Search open same note, route/tray retain unsaved draft, keyboard/IME/focus/theme/font/responsive checks, disposable import/reset. Record operator/environment/results. **Pending at plan creation.**
- [x] Record the existing native limitation: unacknowledged manual/Notes drafts can be lost on crash/force exit/immediate tray Quit; no claimed flush guarantee or persisted draft.
- [x] Stage 18 implementation scope delivered and stage19 deferred; if native smoke remains pending, report “automated implementation complete; native stage acceptance pending” rather than full verified completion. Stop here; coordinator handles any user-authorized final actions.

## Deviations and Decisions

- User delegated decisions within stage18; Home uses a minimal textarea/manual Save, with explicit Cancel added to Home as requested. No form/editor dependency is needed.
- Quick draft is separate from autosave NoteDraft within the same owner; Data maintenance rejects an unresolved manual draft instead of saving it without consent. This is an intentional extension of public Notes barrier semantics, documented in FE-019 and FE-020.
- Unknown create outcome has no idempotency key: no automatic retry or match-by-text inference. Cancel only abandons local text; a persisted note may exist and is not deleted.
- Floating/BE-017/global shortcut/tray remain stage19. Historical plans are not changed.

## Outcome

Home manual Save/Cancel is implemented with a separate retained Quick Note lifetime, one admitted create, typed-error recovery, unknown-outcome no-replay, project choices, acknowledged navigation, and the existing Data boundary. Source scope was frozen before final gates. Windows Tauri build passed; native Windows smoke remains pending. No backend, binding, manifest, capability, or stage19 native surface was changed. No commit or shutdown was performed by the implementer.

## Execution Evidence — 2026-09-08

Starting HEAD `2a79a90` and BE-016 ancestor `e4191e9` were confirmed. Historical plans were read only. Logs below are absolute local artifacts under `C:/Users/ntnha/AppData/Local/Temp/`; `fe020-gates.txt` and `fe020-rust-gates.txt` contain independent command exit records. Tests use mocked public IPC, generated DTO fixtures, temporary Rust storage, and fake PTY/platform collaborators; no production app was launched against user data.

### Red, green, and resolved failures

- Provider red: `pnpm exec vitest run src/features/notes/notes-provider.test.tsx`, exit 1; 13 collected, 12 passed and the new assertion failed because `saveQuickNote` was absent. Log `fe020-provider-red.log`. The temporary structural check was replaced with typed owner access.
- Composer red: `pnpm exec vitest run src/features/notes/quick-note-composer.test.tsx src/features/notes/note-actions.test.tsx`, exit 1; 4 collected, 3 passed and the labelled input assertion failed against an importable null component. Log `fe020-composer-red.log`.
- Integration-first deviation: Home composition preceded its first focused run, so the planned missing-composer red is not claimed. `fe020-integration-1.log` records five failures: one new query during Quit, one fixture subscription count, and three new tests using a nonexistent reset fixture method. The composer project hook now pauses while suspended; the real NotesProvider requires its own project listener; tests now use the existing `prepare("reset")` API. `fe020-integration-2.log` passed 125 tests across eight files.
- New real DataManagementHost interleaving tests live in `src/app/home-entry.test.tsx`, where the actual NotesProvider/router/Home compose together. The existing `data-management-bridge.test.tsx` retains its public-boundary fixture and passes unchanged. This avoids replacing that fixture or duplicating the app host.
- Final focused command selects all eleven frontend files named across Tasks 1–3, including the unchanged aggregate/wrapper targets: exit 0, 179 tests passed (`fe020-focused-final.log`). It proves manual no-autosave/hidden-route retention, independent Notes autosave, raw payload, scalar/UTF-8 limits, missing project recovery, IME, no focus stealing, single flight, admitted-flight drain, dirty/uncertain barrier rejection after Home unmount, same-tick Data/Quit admission, listener-failure command invalidation and retired responses.
- Full Rust initial run exited 101 (`fe020-rust-tests.log`): the existing Notifications test `real_terminal_producer_reaches_notifications_without_frontend_listener` observed the asynchronous output counter before delivery. This is the same pre-existing timing failure recorded by FE-019. No Rust change was made. The explicit Notifications target passed all 16 tests (`fe020-notifications-retry.log`), then the unchanged full Rust command passed after frontend completion (`fe020-rust-tests-retry.log`). Initial failure evidence is retained and not represented as a pass.

### Frozen-tree automated gates

| Exact command | Result | Log basename |
|---|---|---|
| `pnpm format:check` | Exit 0 | `fe020-format.log` |
| `pnpm lint` | Exit 0 | `fe020-lint.log` |
| `pnpm typecheck` | Exit 0 | `fe020-types.log` |
| `pnpm test` | Exit 0; 145 files, 2,535 tests passed | `fe020-frontend-tests.log` |
| `pnpm build` | Exit 0 | `fe020-frontend-build.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Exit 0 | `fe020-rustfmt.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings` | Exit 0 | `fe020-clippy.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test notes_contract` | Exit 0; 11 passed, 1 existing performance benchmark ignored | `fe020-notes-contract.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test unified_search_contract` | Exit 0; 3 passed | `fe020-search-contract.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test data_management_contract` | Exit 0; 36 passed | `fe020-data-contract.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test export_bindings` | Exit 0; 12 passed; bindings unchanged | `fe020-generated-contract.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- --test-threads=1` | Retry exit 0; 546 passed, 1 existing ignored across 25 targets | `fe020-rust-tests-retry.log` |
| `$env:CARGO_BUILD_JOBS = '2'; pnpm tauri build` with previous environment restored in `finally` | Exit 0; release build in 2m 31s | `fe020-tauri-build.log` |

### Stage 18 evidence mapping and acceptance limit

- CRUD/title/body, pin/project, Archive/Trash and backup v2 behavior retain BE-016 evidence (`e4191e9`) and now pass the explicit Notes/Search/Data contracts above. Notes CRUD/autosave/revision/IME/lifecycle confirmation UI retain FE-019 evidence (`2a79a90`) and now pass the complete frontend suite.
- Home pinned/recent/note-only, Overview linked notes and Search opening pass the selected aggregate targets in the focused run and full suite. FE-020 adds the composer before those sections, project identity submission, success reset/Open note, raw Markdown and independent manual state. Query invalidation is driven by the acknowledged command even when native listening fails.
- Data backup v1/v2/reset/rollback has 36 passing Rust contract tests, unchanged schema/bindings, unchanged bridge regressions, and new real-host Home dirty/uncertain/pending-flight admission tests. Reset/import retire quick lifetime through the existing public boundary.
- Native Windows smoke is **pending**: no identified disposable VM/Sandbox/test-account operator or native app-control tool was available. Build/component tests are not native IME, tray, restart, theme/font, responsive or disposable import/reset acceptance. No automated desktop E2E was run.
- Existing limitation remains: unacknowledged manual and Notes drafts can be lost on crash, force exit or immediate tray Quit. This change adds neither persisted drafts nor a guaranteed native flush lifecycle.
- Stage19 floating Quick Note/BE-017/tray/global shortcut/window work and whole Phase3 acceptance remain deferred. The handoff is **automated implementation complete; native stage acceptance pending** with the Windows build recorded above. The coordinator alone handles final user-authorized commit/stop/shutdown.

Final Windows artifact: `F:/Self Projects/XWork/src-tauri/target/release/xwork.exe`. Bundling remains disabled by existing configuration; the executable was built but not launched. Existing CodeMirror chunk/dynamic-import build warnings remain non-fatal.

Final negative-scope verification: `git diff --check` exit 0 (`fe020-diff-check.log`); `git diff --exit-code -- package.json pnpm-lock.yaml src/bindings src-tauri` exit 0 (`fe020-contract-diff.log`). The planned production import/forbidden-API `rg` checks each returned 1 with no matches. `git status --short` contains only the four authorized design/active-plan documents and eight FE-020 frontend implementation/test files. No backend, generated DTO, manifest, native capability or historical plan diff was introduced. Final documentation records do not alter the frozen source verified by the gates.
