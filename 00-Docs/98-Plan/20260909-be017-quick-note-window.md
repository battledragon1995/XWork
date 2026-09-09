# BE-017 Quick Note Window Implementation Plan

**Status:** Implemented; automated gates passed; native acceptance pending

**Goal:** Deliver the stage 19 Rust singleton Quick Note window, tray entry and global shortcut with real Notes persistence and generated IPC contracts ready for FE-020 integration.

**Completion Criteria:**

- Four caller-scoped window/status commands, lazy singleton window, tray item and active global shortcut satisfy BE-017.
- Shortcut mutations/import/reset reconcile only committed snapshots; conflicts and OS failures remain fail-soft and observable.
- Rust unit/integration/contract tests, frontend regression gates and Windows Tauri build pass. Native smoke results are recorded separately; pending native checks never count as passed.

**Architecture:** App composition owns window orchestration and consumes public Settings/Notes interfaces. Platform owns native hotkey conversion/registration. Notes remains the sole persistence authority; React implementation follows in a separate FE design/plan.

**Tech Stack:** Existing pinned Rust 1.98.0 Edition 2024, Tauri 2.11.5, Tokio 1.53.1, ts-rs 12.0.1 and SQLite. Add only the complete Rust manifest entry `tauri-plugin-global-shortcut = "=2.3.2"`, selected by BE-017. No guest package. Cargo resolution/build verifies compatibility before implementation completion.

**Sources:**

- `AGENTS.md`, `PLANS.md`
- `00-Docs/98-Plan/00-Roadmap.md` stage 19
- `00-Docs/00-Overview/01-TechStack.md`
- `00-Docs/00-Overview/02-ProjectStructure.md`
- `00-Docs/00-Overview/03-FunctionalRequirements.md` §§5, 12.3, 16, 17.4, 20 Phase 3
- `00-Docs/03-Backend/BE-017-quick-note-window.md`
- `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`
- `00-Docs/03-Backend/BE-009-keyboard-shortcuts.md`
- `00-Docs/03-Backend/BE-016-notes.md`
- `00-Docs/02-Frontend/FE-020-quick-note.md` (Home stage 18 baseline; floating UI is the next deliverable)
- `00-Docs/01-Wireframe/06-Notes.html#quick-note`, `00-Docs/01-Wireframe/03-Home.html`

## Scope

**In Scope:** BE-017, necessary BE-001 tray/lifecycle and BE-009 catalog/watch extensions, capability/configuration, generated binding and backend contract coverage.

**Out of Scope:** Floating React UI and Home/Welcome/settings affordances, calendar/reminders, migration, Notes CRUD redesign, persisted drafts, macOS acceptance. Existing Home composer remains intact. This backend commit does not declare the entire stage 19 accepted.

## Global Constraints

- Rust owns OS access, persistence and business rules. Commands authorize the actual invoking window.
- Generated bindings under `src/bindings/` are not edited manually.
- Every function, method, callback, test and helper has a short purpose comment; explain race invariants inline.
- Tests never touch real app data, credentials or projects and do not mutate process-global environment for isolation.
- Do not add or run automated desktop end-to-end tests. Windows only; macOS is deferred to release preparation.
- No runtime mock IPC. Test doubles are confined to tests.

## Assumptions, Risks, and Blockers

**Baseline:** HEAD `c953458 Implement FE020` implements only the embedded Home composer; `2a79a90 Implement FE019` and `e4191e9 Implement BE016` provide Notes. There is no `app/quick_note.rs`, platform hotkey adapter or global-shortcut dependency. Stage 19 must precede stages 20–21.

**Decisions:** Existing `KeyboardShortcutsService::subscribe()` returns revision `watch::Receiver<u64>`; retain it and add `subscribe_snapshot() -> watch::Receiver<KeyboardShortcutsDto>` for BE-017. Existing binding generation lives in `src-tauri/tests/export_bindings.rs`, not the nonexistent `src/bin/export_bindings.rs`; extend the current generator test. These source-informed corrections are recorded in BE-009/BE-017.

**Risks:** Native callbacks must not block or hold mutexes across main-thread dispatch; generation checks reject stale operations. An app-data maintenance transaction must publish the same committed shortcut snapshot as ordinary edits. Native UI control is unavailable in the current agent environment; retain an honest pending checklist and continue independent implementation work.

**Blockers:** None for backend implementation. Native stage acceptance requires an isolated Windows operator/environment; FE integration belongs to the next plan.

## Dependency Order

1. Committed shortcut snapshot/catalog → controller reconciliation.
2. Platform/controller → composition, caller commands and tray.
3. Contract generation and regression checks → FE handoff.

### Task 1: Publish the stage 19 shortcut catalog and snapshots

**Outcome:** A default global `quick_note.open_global` action participates in existing conflict rules and committed watch publication.

**Depends On:** None.

**Files:** Modify `src-tauri/src/settings/keyboard_shortcuts.rs`, `src-tauri/src/settings/mod.rs` if exports require it. Test `src-tauri/tests/keyboard_shortcuts_contract.rs`, `src-tauri/tests/data_management_contract.rs` and colocated unit tests.

**Interfaces:** Retain revision `subscribe()`. Add `subscribe_snapshot() -> tokio::sync::watch::Receiver<KeyboardShortcutsDto>`. Consume current transaction projection/publication APIs; produce exact global action/default `Primary+Shift+KeyN` and category/scope `global`.

- [x] Add discoverable tests to existing targets: default includes global action, internal conflict disables every member, set/reset/import publishes the committed snapshot, no-op does not publish, failed transaction preserves snapshot, late subscription receives current state.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test keyboard_shortcuts_contract --test data_management_contract`. Before adding the new interface use the existing public snapshot assertion as the behavioral red test: missing `quick_note.open_global` must fail, not zero matched tests. Add new-interface tests alongside its compilable implementation.
- [x] Add the catalog entry and snapshot sender initialized from current projection; use retained-value publication so updates before a subscriber are not lost. Publish after commit/cache replacement for mutation and BE-012 paths. Preserve revision subscribers and existing lock order.
- [x] Re-run both exact targets; assert no migration or new default override rows.

### Task 2: Implement window policy and native shortcut reconciliation

**Outcome:** Deterministic singleton and registration state machines, with safe native adapters and typed errors.

**Depends On:** Task 1.

**Files:** Create `src-tauri/src/app/quick_note.rs`, `src-tauri/src/platform/global_shortcut.rs`; modify `src-tauri/src/platform/mod.rs`, `src-tauri/src/app/mod.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`. Unit tests colocate in new modules.

**Interfaces:** BE-017 `QuickNoteController`, status/state/error/operation DTOs and `GlobalShortcutPlatform`/`PlatformShortcut` types. Add an injectable app-owned window operations adapter for create/show/unminimize/focus/close/drag, lifecycle guard, and event sink; native implementation uses literal BE-017 policy, fake records operations and injectable failures. Expose test collaborators through the existing doc-hidden composition approach only where integration tests need them.

- [x] Implement a compilable minimal state seam and tests before native wiring. Run `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --lib`; the singleton test must fail when a burst creates more than one instance and registration tests fail when stale/released handlers open a window.
- [x] Implement absent/opening/open/closing generation logic with short locks and asynchronous main-thread dispatch. Repeated triggers focus existing renderer; native destroyed events clear only matching generation. Fixed app URL/geometry/flags follow BE-017 exactly.
- [x] Add the exact plugin manifest entry. Convert every BE-009 allowed key exhaustively; Primary maps by platform. Serialize reconciliation; invalidate old handler before unregister/register, fail-soft `Unavailable`, conflict clears accelerator, unchanged status emits nothing. Status sequence is a decimal string.
- [x] Cover create/show/focus/close failures, 20 simultaneous triggers, stale close, sequence/no-op, register/unregister failures, missing catalog startup error and shutdown admission. Inject window-create failure: typed create error, no orphan opening state, later retry succeeds. Inject OS registration failure: startup succeeds with Unavailable status; tray open remains usable.
- [x] Run the full library target; real global hotkeys must never be registered by automated tests.

### Task 3: Wire narrow commands, tray and shutdown

**Outcome:** Production Rust entry points invoke the controller and preserve existing main-window/session behavior.

**Depends On:** Task 2.

**Files:** Modify `src-tauri/src/app/mod.rs`, `src-tauri/src/app/lifecycle.rs`, `src-tauri/src/app/tray.rs`, `src-tauri/src/notes/commands.rs` only if existing create authorization requires adjustment, `src-tauri/tauri.conf.json`; create `src-tauri/capabilities/quick-note.json`. Test/create `src-tauri/tests/quick_note_window.rs`; extend `src-tauri/tests/app_lifecycle.rs`, `src-tauri/tests/app_builder.rs`, `src-tauri/tests/window_configuration.rs`, `src-tauri/tests/notes_contract.rs` as needed.

**Interfaces:** `open_quick_note_window` and `get_quick_note_global_shortcut_status` authorize exact main; `close_quick_note_window` and `start_quick_note_window_drag` authorize exact quick-note. Event `quick-note://global-shortcut-status-changed` targets main only. Consume BE-016 `create_note` and Projects public list authorization unchanged; no Notes persistence from app.

- [x] Register a compilable `quick_note_window` test target and fixture using tempfile app data, mock runtime, fake window/shortcut/event adapters. Assert unauthorized invocation before side effects; before implementation its response must be missing-handler/wrong authorization rather than the expected typed error.
- [x] Keep single-instance first, install plugin/controller once and make tray Quick Note visible only after handler readiness. Preserve tray ID/order and attention entries. Only Active status supplies its accelerator. Native callbacks schedule work and return.
- [x] Add empty quick-note capability scoped to exact label; security capability list becomes main/quick-note while static windows retain main only. No broad core/window/plugin permission additions.
- [x] Close-to-tray remains exact main. Quit gate rejects new opens, invalidates callbacks and unregisters best-effort; preserve lifecycle retry behavior if runtime cleanup fails. Notes draft does not affect Quit summary.
- [x] Integration tests exercise singleton reuse, caller matrix, Notes create ack then close, typed save failure leaves window, committed note remains exactly one after failed close/retry, native close separation and shutdown races. Save-close test orchestration models the future FE caller and never invents a combined backend save command.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test quick_note_window --test app_lifecycle --test app_builder --test window_configuration --test notes_contract`. Each selected target must execute tests and pass.

### Task 4: Generate contracts and hand off verified backend

**Outcome:** FE implementer can consume real public contract with regression evidence.

**Depends On:** Task 3.

**Files:** Modify `src-tauri/tests/export_bindings.rs`; generate `src/bindings/quick-note-window.ts` and affected keyboard-shortcut binding through Rust generator only. Update this active plan and BE design decision/evidence sections.

**Interfaces:** Exact BE-017 serialized DTO/error enums with imported existing ShortcutChordDto; no manually copied DTO definitions.

- [x] Extend generator/contract tests using existing aggregate pattern. Run `cargo test --manifest-path src-tauri/Cargo.toml --all-features -j 2 --test export_bindings`: first stale-output failure is expected to regenerate the file; rerun must pass with stable output.
- [x] Run final gates below. Fix regressions caused by the new catalog action minimally, including frontend exhaustive categories/test fixtures if required for this backend boundary; do not build the FE feature here.
- [x] Record commands/counts/failures/retries, generated outputs and native limitations. Coordinator commits the authorized backend change as `Implement BE017`; agent does not commit.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Frontend formatter | `pnpm format:check` | Pass |
| Frontend lint | `pnpm lint` | Pass |
| Frontend types | `pnpm typecheck` | Pass including new generated contracts |
| Frontend tests | `pnpm test` | Existing application behavior passes |
| Frontend build | `pnpm build` | Production bundle succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings` | No warnings |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- --test-threads=1` | Full suite passes; existing ignored tests reported |
| Windows Tauri | `pnpm tauri build` | Real executable builds; optionally scope CARGO_BUILD_JOBS=2 and restore previous value |
| Diff integrity | `git diff --check` | No whitespace errors |

Negative requirements: compare `git diff -- src-tauri/migrations package.json src-tauri/capabilities/main.json` to verify no migration, guest package or permission expansion. Inspect generated capability JSON and configured static labels in window_configuration tests. Test app data always comes from tempfile via explicit configure seam; fake credentials/platform objects prevent native side effects.

Manual Windows checklist, in a disposable VM/Sandbox/test account: launch executable; open from tray and registered chord while another application has focus; verify always-on-top, taskbar omission, drag/resize, 20 triggers preserving one renderer, main hide independence, native close and reopen, conflicting external registration held by a separate helper process, and Quit releases registration. After FE-020 integration, additionally check Home/Welcome, save/validation/cancel/IME and settings rebind/status. Measure cold/warm p95 against BE-017 with repeated native observations; record machine/sample count. The current native-control limitation leaves this checklist pending, not passed, and does not block independent FE/next-stage implementation.

## Deviations and Decisions

- 2026-09-09: Existing revision watch remains backward compatible; a separately named snapshot watch fulfills BE-017. Binding generation extends the existing test generator.
- Native acceptance is explicitly separate from automated completion; no desktop E2E is introduced to work around missing native tooling.

## Outcome

BE-017 implementation and automated verification are complete. Native Windows acceptance and p95 measurements remain pending, and FE-020 floating UI is the following deliverable. The coordinator may commit these changes as `Implement BE017`; this does not declare stage 19 native acceptance complete.

### Execution evidence

- Red catalog target: three assertions observed 18 actions rather than required 19; `.be017-red.log`.
- Task 1: keyboard shortcut contract 16 passed and data management contract 36 passed. Complete snapshot tests cover no-op, late subscription, conflict, failed mutation, coordinator rollback/import/reset publication.
- Initial library run: 311 passed; binding generator created `src/bindings/quick-note-window.ts` and failed its expected stale-output assertion. Subsequent generator target passed all 13 tests.
- Frontend lint/types passed; 145 test files / 2535 tests passed; production build passed. Initial formatter found newline formatting in two changed JSON files; formatting fixed and retry passed.
- Initial Clippy found three unnecessary Copy clones and helper placement after a test module; both were corrected before final retry.
- Initial controller target passed four tests and failed three because test fixtures called synchronous Settings mutation inside an async runtime. Fixtures were corrected to use `spawn_blocking`; the exact target then passed 8/8, including show/unminimize/focus retry coverage. This was a test-harness failure, not an OS registration failure.
- Execution-order deviation: the catalog had an observed behavioral red run; controller/IPC tests were introduced with their implementation, so no pre-implementation singleton or missing-handler red run is claimed. Positive controller and IPC behavior is covered by the eight passing isolated integration tests.
- Per-registration Rust callbacks and post-setup initial reconcile follow the implementation decisions recorded in BE-017. Native identity is checked together with captured generation before close.
- Native smoke/p95 checklist remains pending; no automated desktop E2E was added or run.



### Final automated gates (2026-09-09)

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`: passed; frontend tests 145 files / 2535 tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`: passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- -D warnings`: passed after fixes; final rerun also passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 2 -- --test-threads=1`: passed across 26 targets, 560 tests passed, one existing ignored Notes performance test. This includes the explicit window configuration target (2 tests).
- A final library rerun after the new tray readiness test and catalog test rename passed 312/312. No production behavior changed after the full suite.
- Exact `quick_note_window` target: 8/8 passed, using temporary app data and fake native collaborators.
- Negative requirement diff over migrations, `package.json`, and `capabilities/main.json` is empty. Generated Tauri schemas reflect only the newly installed Rust plugin/capability configuration.
- `pnpm tauri build`: passed with `CARGO_BUILD_JOBS=2` restored afterward; optimized Windows executable built at `src-tauri/target/release/xwork.exe` in 3m 14s. Existing `.app` bundle identifier warning remains unrelated and unchanged. Native smoke/p95 remain pending.
- `git diff --check`: passed. Execution logs were moved outside the repository to `C:\Users\ntnha\AppData\Local\Temp\xwork-be017-logs-d78bb2d162a248c8a4048c700ba37c1f`; the `.be017-*.log` names elsewhere in this plan resolve inside that directory and are not part of the implementation commit.
