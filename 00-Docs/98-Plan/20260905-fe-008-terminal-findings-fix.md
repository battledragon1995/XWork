# FE-008 Terminal Findings Fix Plan

**Status:** Implemented and verified

**Goal:** Correct F-01 through F-07 from the FE-008 functional-test findings so retained terminals remain usable, bounded, and compliant with the Rust clipboard boundary.

**Completion Criteria:**

- Focused regressions prove the empty, retained find, closing, link selection, native paste, clear-screen scrollback, and bounded-layout behaviors.
- Frontend format, lint, type checks, tests, and production build pass.
- Rustfmt, Clippy with warnings denied, Rust tests, and the Windows Tauri build pass.
- The issue report records the exact automated and targeted native evidence without claiming unobserved behavior.

**Architecture:** React continues to own view state while the terminal registry retains per-terminal runtime state across route detachment. WTerm remains the only renderer and receives local display control bytes for Clear Screen; clipboard content still enters through the existing BE-007 Rust command. Sessions constrains terminal content at the resizable-panel boundary so terminal rows cannot widen the desktop layout.

**Tech Stack:** React 19, TypeScript 7, Vitest/jsdom, WTerm/Ghostty 0.3.4, Tauri 2, stable Rust Edition 2024.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`
- Frontend spec: `00-Docs/02-Frontend/FE-008-terminal.md`
- Backend spec: `00-Docs/03-Backend/BE-007-terminal-and-pty.md`
- Findings: `00-Docs/97-Issue/20260905-fe-008-terminal-functional-test-findings.md`
- Wireframe: `00-Docs/01-Wireframe/04-Projects.html#panes-1`

## Scope

**In Scope:**

- F-01 through F-07 and focused regression coverage.
- Terminal pane, retained registry state, WTerm adapter behavior, and Sessions overflow containment required by those findings.
- Existing Rust terminal integration and contract checks because the paste policy crosses the BE-007 boundary.

**Out of Scope:**

- New terminal features, dependency upgrades, generated binding edits, persistence, or changes to historical implementation plans.
- Automated desktop end-to-end tests and macOS validation.

## Global Constraints

- Keep OS access, persistence, terminal processes, and clipboard access in Rust behind narrowly scoped Tauri commands.
- Keep WTerm/Ghostty packages pinned to `0.3.4`.
- Clear Screen applies only to the primary screen, preserves renderable scrollback, and sends no PTY input.
- Native WebView paste must be prevented before WTerm reads browser clipboard event data.
- Every function, method, callback, test, and helper has a short English purpose comment.
- Automated tests use deterministic fixtures and never access user clipboard, app data, credentials, or projects.
- Validate on Windows and do not add or run automated desktop end-to-end tests.

## Assumptions, Risks, and Blockers

**Assumptions:**

- The original F-07 report combines layout widening with a missing-output symptom, so both must pass on the same final QA artifact.
- The resizable panel's nested content overflow explains the multi-thousand-pixel horizontal coordinate; the missing output has separate channel-decoding and resize-delivery causes.

**Risks:**

- A capture-phase paste handler must stop the event before WTerm's target listener while preserving the existing stale-activation guard; a test mounts the real `InputHandler`.
- Pushing viewport rows into Ghostty scrollback can duplicate content if repeated on an empty screen; the adapter test uses the real pinned WASM core and checks repeated clear.
- CSS layout behavior cannot be fully represented by jsdom; component assertions cover the required containment and a targeted Windows smoke remains the final visual check.

**Blockers:** None.

## Dependency Order

1. Add focused regressions for F-01 through F-07 → establishes observable failures.
2. Correct retained state, interaction handling, clear behavior, and layout containment → enables focused verification.
3. Run repository gates and targeted Windows smoke → enables an evidence-based issue update.

---

### Task 1: Add Focused Regressions

**Outcome:** Every reported finding has a durable automated assertion at the closest supported boundary.

**Depends On:** None.

**Files:**

- Modify: `src/features/terminal/terminal-pane.test.tsx`
- Modify: `src/features/terminal/wterm-adapter.test.ts`
- Modify: `src/lib/ipc/terminal.test.ts`
- Modify: `src/features/sessions/session-pane.test.tsx`
- Modify: `src/features/sessions/pane-layout.test.tsx`

**Interfaces:**

- Consumes: `TerminalPane`, real WTerm `InputHandler`, real Ghostty WASM, `SessionPane`, and `PaneLayout`.
- Produces: Named regressions for F-01 through F-07.

- [x] Add the seven focused behavior assertions.
- [x] Run `pnpm exec vitest run src/features/terminal/terminal-pane.test.tsx src/features/terminal/wterm-adapter.test.ts src/features/sessions/session-pane.test.tsx src/features/sessions/pane-layout.test.tsx --reporter=verbose`.
- [x] Confirm failures identify the reported missing behavior rather than setup or import errors.

### Task 2: Correct Terminal Runtime and Layout Behavior

**Outcome:** The terminal shows truthful state, retains find state, gates explicit link activation, routes paste through Rust, preserves clear history in WTerm, and remains within its pane.

**Depends On:** Task 1.

**Files:**

- Modify: `src/features/terminal/terminal-pane.tsx`
- Modify: `src/features/terminal/terminal-registry.ts`
- Modify: `src/features/terminal/wterm-adapter.ts`
- Modify: `src/lib/ipc/terminal.ts`
- Modify: `src/features/terminal/terminal.css`
- Modify: `src/features/sessions/pane-layout.tsx`
- Modify: `src/features/sessions/session-pane.tsx`

**Interfaces:**

- Consumes: Existing BE-007 `read_terminal_clipboard`, WTerm/Ghostty cell APIs, and resizable panel styles.
- Produces: Retained `findQuery`, capture-phase native paste routing, raw `ArrayBuffer` channel decoding, primary-screen viewport archival, deferred resize delivery, and bounded pane layout.

- [x] Implement only the minimum behavior required by the focused assertions.
- [x] Re-run the focused Vitest command and expect all named regressions to pass.

### Task 3: Verify and Record the Fix

**Outcome:** Repository gates and available native checks support an accurate resolved/remaining status for every finding.

**Depends On:** Task 2.

**Files:**

- Modify: `00-Docs/97-Issue/20260905-fe-008-terminal-functional-test-findings.md`
- Modify: `00-Docs/98-Plan/20260905-fe-008-terminal-findings-fix.md`

**Interfaces:**

- Consumes: Product test suites and the separate-identifier Windows QA application.
- Produces: Final verification and limitation record.

- [x] Run every final gate below.
- [x] Perform targeted manual Windows smoke on the separate-identifier QA binary without touching the user's release session.
- [x] Record exact outcomes and leave any unobserved native checks explicit.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | No formatting errors |
| Frontend lint | `pnpm lint` | No lint errors |
| Frontend type check | `pnpm typecheck` | No type errors |
| Frontend tests | `pnpm test` | All tests pass |
| Frontend production | `pnpm build` | Production bundle succeeds with local WASM |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -j 1 -- -D warnings` | No warnings or errors |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml -j 1` | All Rust tests pass |
| Windows desktop | `pnpm tauri build` with `CARGO_BUILD_JOBS=1` | Windows build succeeds |
| Diff | `git diff --check` | No whitespace errors |

## Deviations and Decisions

- This corrective plan is separate from the completed FE-008 and BE-007 historical implementation plans.
- The focused final command also included `terminal-registry.test.ts`, producing 5 files and 31 passing tests, because F-02 requires per-entry isolation and disposal coverage.
- The standard Tauri target could not replace an open `src-tauri/target/release/xwork.exe`. The same Tauri build ran successfully with `CARGO_TARGET_DIR=src-tauri/target-fe008-fix`; the existing app and its session remained untouched. The isolated 1.9 GiB build target was removed afterward with scoped `cargo clean`.
- The native helper exposed the old app's Quit confirmation. It stated that quitting would remove one running session and terminal output, so the dialog was cancelled rather than treating initial implementation authority as approval to delete user data.
- Tauri's raw byte channel delivers `ArrayBuffer` in WebView2. Accepting that runtime shape fixed malformed-frame recovery loops that hid all native terminal output.
- WTerm measurement now runs on the next animation frame rather than inside `ResizeObserver` delivery, avoiding the WebView layout loop seen while Claude's alternate screen initialized.
- Final native smoke used `src-tauri/target/debug/xwork.exe` built with temporary identifier `com.xwork.fe008smoke`, leaving the release process and its data untouched. The same source/config was rebuilt and copied to `src-tauri/target/fe008-qa/XWork-FE008-QA.exe` so a later default debug build cannot replace the retained QA artifact.

## Outcome

F-01 through F-07 are corrected in source. Terminal empty and closing states are truthful; find queries live with their retained entry; double-click selection no longer opens links; native paste is intercepted before WTerm and routed through the existing Rust clipboard command; Clear Screen moves content into Ghostty's renderable scrollback; and Sessions plus WTerm sizing prevent terminal rows from widening the app layout. Raw Tauri channel `ArrayBuffer` frames now reach the renderer, while deferred WTerm measurement avoids the WebView `ResizeObserver` loop during TUI startup.

Verification passed: full Vitest 87 files/1,673 tests, frontend format/lint/type/build, Rustfmt, Clippy with warnings denied, all Rust tests, an isolated-target Windows Tauri release build, the final separate-identifier QA build, and final whitespace checks.

Targeted native smoke on the QA source/config showed the PowerShell prompt plus full Claude and Codex TUIs at 1.282×802, with terminal toolbar, pane controls, scrollbar, and window controls inside the window. No prompt or shell command was entered. The retained artifact was rebuilt from the same source/config after smoke; reopening it was stopped by the user with Escape and is not claimed as another native pass. Native Find/Clear behavior with real output, clipboard/browser interaction, IME, theme/font, close/reopen, and the full 1–4 pane matrix remain outside the observed pass set.
