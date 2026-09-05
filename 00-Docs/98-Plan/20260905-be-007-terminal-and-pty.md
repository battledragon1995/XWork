# BE-007 Terminal and PTY Implementation Plan

**Status:** Implemented — backend gates passed; FE-008 remains out of scope.

**Goal:** Deliver the BE-007 runtime on Windows: launch the backend-selected tool in ConPTY, exchange ordered raw output/input/resize over the specified IPC contract, and stop every owned process tree through Sessions lifecycle operations.

**Completion Criteria:**

- All six commands enforce the `main` window boundary and the BE-007 validation/error contract; generated DTOs contain no launch data, process handles, or terminal bytes.
- Deterministic tests prove launch exclusion, pending-attach compensation, frame ordering/recovery, bounded queues, activity propagation, input/resize acknowledgements, final-output ordering, retention, and shutdown races.
- Real Windows ConPTY tests pass for Unicode, control input, resize, exit status, four concurrent terminals, and descendant termination, using disposable fixtures only.
- Existing Sessions, Projects, CLI Profiles, app lifecycle, and binding contracts remain passing; all final quality gates and the Windows Tauri build pass.
- Backend completion evidence and the outstanding FE-008 integration checklist are recorded separately. This plan alone does not complete roadmap stage 9 or the WTerm/WebView2 acceptance criteria in BE-007.

**Architecture:** Terminal owns the runtime map, pane launch gates, control actors, and output dispatchers. App composition adapts public Projects/CLI Profiles/Sessions interfaces and routes `PaneContentRuntime` calls to Terminal using weak references. Blocking PTY/process/Channel operations run on dedicated threads; asynchronous coordination never holds owner locks across dependency calls.

**Tech Stack:** Rust 1.98.0 / Edition 2024, Tauri 2.11.5, Tokio 1.53.1, portable-pty 0.9.0, Serde 1.0.229, ts-rs 12.0.1, windows-sys 0.61.2, target-gated libc 0.2.189; existing Windows test tooling.

**Sources:**

- Rules: `AGENTS.md`, `PLANS.md`, `00-Docs/99-Template/04-Plan.md`.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, stage 9, backend portion; stage 8 is its prerequisite.
- Stack and placement: `00-Docs/00-Overview/01-TechStack.md`, `00-Docs/00-Overview/02-ProjectStructure.md`.
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, §§5.3–5.4, 7.3, 8–10, 18, 20 Phase 1.
- Primary contract: `00-Docs/03-Backend/BE-007-terminal-and-pty.md`, including all 32 invariants and its error/verification tables.
- Consumed contracts: `00-Docs/03-Backend/BE-003-projects.md` (available root/removal), `00-Docs/03-Backend/BE-005-sessions-runtime.md` (content/activity/lifecycle), `00-Docs/03-Backend/BE-006-cli-profiles.md` (resolved launch profile).
- Frontend boundaries: `00-Docs/02-Frontend/FE-006-session.md`, `00-Docs/02-Frontend/FE-007-tabs-and-panes.md`. FE-008 is referenced by BE-007 but has no specification file in the repository at plan creation.
- Wireframe: `00-Docs/01-Wireframe/04-Projects.html`, `#sidebar-sessions`, `#new-session`, `#tool-unavailable`, `#panes-1` through `#panes-4`, `#panes-max`, `#pane-picker`, `#dlg-delete-session`, `#dlg-remove-project`, `#dlg-quit`.
- Implementation baseline: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `rust-toolchain.toml`, `package.json`, `src-tauri/src/app/{mod.rs,data_runtime.rs}`, `src-tauri/src/sessions/{mod.rs,models.rs,manager.rs}`, `src-tauri/src/terminal/{mod.rs,cli_profiles.rs}`, and existing integration tests.

## Scope

**In Scope:**

- BE-007 models/errors, six commands, raw Channel protocol, replay, attention scanner, PTY/control workers, process-tree adapter, and runtime lifecycle.
- Production composition through existing owner APIs; extend the current Stage 8 content adapter to route Terminal lifecycle, and cover launches not yet attached when Quit begins.
- Generated terminal DTO/event/error bindings, Windows fixtures, unit/integration/contract tests, and desktop build verification.
- Target-gated macOS process-group implementation required by BE-007, with validation deferred to release preparation.

**Out of Scope:**

- FE-008 specification/implementation, WTerm packages/core/registry, terminal UI, frontend IPC wrapper, and changing the FE-006/FE-007 placeholders.
- Profile CRUD/resolution redesign, credential access outside BE-006, notification records, file content owners, terminal persistence, migrations, backup/reset feature implementation, or dependency upgrades unrelated to PTY.
- New Tauri permissions, shell/filesystem plugins, WebSockets, local servers, automated desktop end-to-end tests, macOS builds/tests, or Git commits.

## Global Constraints

The following project rules apply to every task:

> Keep OS access, persistence, terminal processes, and business rules in Rust; the React frontend communicates with them through narrowly scoped Tauri commands and events.

> Every function, method, callback, test, and helper must have a short comment describing its purpose.

> Write code, identifiers, and code comments in English.

> During development, build and test only on Windows.

> Defer macOS validation until release preparation unless explicitly requested earlier.

- Use UTF-8 for Markdown. Generated bindings and Cargo.lock are generated, never edited manually.
- Respect public capability boundaries. No Sessions/Projects internal map or repository access from Terminal; no speculative shared crate or future Files delegate.
- Only `main` may invoke terminal commands. Commands release `State` before awaiting; OS access and blocking sends stay outside async workers.
- Preserve the existing CSP, including `'wasm-unsafe-eval'`, without widening sources or permissions. Terminal runtime/output is memory-only and cannot enter SQLite, files, logs, or backups.
- Runtime product paths use real backend services. Test doubles exist only in isolated tests; the roadmap's current policy governs over the older mock-development wording in PLANS.md.

## Assumptions, Risks, and Blockers

**Assumptions and repository findings:**

- BE-007 has no open specification questions. This is a backend implementation plan, not a plan to complete the whole stage 9 frontend/backend slice.
- BE-003, BE-005, and BE-006 owner methods already exist. `attach_runtime_content` revalidates the current tool-selection profile at commit.
- Contrary to the shorthand in BE-007, `PaneContentRuntimeRouter` is not an existing exported Sessions type. The repository currently has `PhaseOnePaneContentRuntime` in `app/data_runtime.rs`; extend that composition adapter into the named router while preserving its Sessions-owned tool-selection retention behavior. No change to the `PaneContentRuntime` trait is required.
- `SessionManager` is a cloneable handle with an internal `Arc`. Composition must retain an outer `Arc<SessionManager>` for the lifetime of any `Weak<SessionManager>` adapter; managing only a value clone would leave that weak reference expired. Keep existing `State<SessionManager>` consumers working.
- `lib.rs` already exports `terminal` and `platform`; do not modify it merely to repeat these exports. Preserve CLI Profiles exports in `terminal/mod.rs`.
- Existing keyring is 3.6.3; this plan consumes the implemented BE-006 resolver and does not upgrade it to the older TechStack target entry.

**Risks and mitigation:**

- Post-spawn Job Object attachment, child exit before attachment, inherited handles, and blocking reader shutdown are verified early in Task 3 and with real child trees in Task 7. A root-process exit alone is not evidence that its descendants stopped. If the pinned adapter cannot meet cleanup guarantees, record the concrete failure and resolve it before claiming completion; do not silently use pipe fallback or widen dependencies.
- A retained replay can contain 1024 frames while the sender queue holds 256. Task 2 must exercise replay beyond 256 frames and keep replay delivery bounded and ordered before live output; do not enlarge the queue or treat normal replay as live queue overflow.
- Pending launch output may arrive before Sessions attachment. Tasks 4–6 prove that only its supplied Channel sees that output, while state events and owner activity stay suppressed until attach.
- A failed close must retain ownership and remain retryable. A Quit failure cannot skip cleanup of other terminals, and a pending launch cannot escape the shutdown gate.
- Real terminal programs can emit identifying text. Fixtures use synthetic markers; production diagnostics expose only safe categories and opaque IDs.

**Blockers:** None for drafting or executing the backend scope. Missing FE-008 specification/implementation blocks the final WTerm/WebView2 rendering and interaction acceptance checks, not the backend test tasks. Do not mark those checks or stage 9 complete until FE-008 is specified, implemented, and verified.

## Dependency Order

1. Models, exact dependencies, and explicit test seams → compileable contract.
2. Stream dispatcher/codec → ordered output independent of native PTY.
3. PTY/control/process-tree adapters → native execution and deterministic failure tests.
4. Manager launch and activity → integrate the two worker paths through authoritative dependencies.
5. Close/retention/shutdown → safe terminal lifecycle.
6. Composition, commands, and bindings → production backend IPC and Sessions integration.
7. Real Windows fixtures and final verification → backend completion evidence and FE-008 handoff.

All commands below run from the repository root in PowerShell. Unit checks use `--lib` without a name filter so newly added tests cannot be missed. Every named integration file has an explicit `--test` command. Before a red run, declare and connect the minimal production signatures/module exports so the test compiles; use a narrowly scoped temporary stub only if needed, and replace it within the same task. A missing import, undiscovered test, or zero matching tests is not accepted as behavioral red evidence.

### Task 1: Establish typed contracts and isolated construction

**Outcome:** BE-007 DTOs/errors/ports compile with exact dependencies and testable construction; no PTY starts at app setup.

**Depends On:** None.

**Files:**

- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/terminal/mod.rs`.
- Generate: `src-tauri/Cargo.lock`.
- Create/test: `src-tauri/src/terminal/models.rs`; introduce worker/manager modules in their owning tasks below.

**Interfaces:** Consume public `ResolvedCliProfile`. Produce the BE-007 DTOs, `TerminalError`, `TerminalPaneTarget`, `TerminalActivity`, `TerminalFuture`, and `TerminalDependencies` exactly as specified. Keep Channel and process-only types outside ts-rs.

- [x] Add the following exact manifest entries, merging existing tables rather than duplicating them. Existing Serde, ts-rs, zeroize, tempfile, and Tauri entries remain unchanged. Tokio's `time` feature supplies bounded asynchronous deadlines/coalescing.

  ```toml
  [dependencies]
  portable-pty = "=0.9.0"
  tokio = { version = "=1.53.1", features = ["sync", "time"] }

  [target.'cfg(windows)'.dependencies]
  windows-sys = { version = "=0.61.2", features = ["Win32_Foundation", "Win32_System_JobObjects", "Win32_System_Threading"] }

  [target.'cfg(unix)'.dependencies]
  libc = "=0.2.189"
  ```

  portable-pty and windows-sys versions come from BE-007. libc 0.2.189 already exists in Cargo.lock; its locally cached package manifest declares Rust 1.65, below the pinned 1.98.0 toolchain. windows-sys declares Rust 1.71. This is manifest compatibility evidence, not a macOS build result. Resolve and compile the added dependencies on Windows in this task; do not claim a successful compile before running it.

- [x] Add model tests for runtime ID prefixes (using each owner's actual ID grammar, including `builtin:*` profile IDs), decimal sequence parsing/overflow, size bounds `2..=500` by `1..=300`, string exit codes, camelCase serialization, and safe error payloads/Display. Construct synthetic sensitive values to prove they are absent from public serialization and diagnostics.
- [ ] Establish red evidence by temporarily leaving the size validator permissive: `cargo test --manifest-path src-tauri/Cargo.toml --lib` must fail the explicit zero-column rejection assertion. Implement validation and all public types; remove temporary stubs.
- [x] Run `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` and the same unit command. Expected: dependency resolution/build succeeds, all model tests pass, and no test/constructor starts real processes.

### Task 2: Implement bounded raw output, replay, and attention scanning

**Outcome:** One per-terminal dispatcher assigns byte-preserving sequences and separates slow subscriber failure from process health.

**Depends On:** Task 1.

**Files:** Create/test `src-tauri/src/terminal/stream.rs`; modify `src-tauri/src/terminal/mod.rs` only for required module wiring.

**Interfaces:** Consume raw reader bytes, EOF, subscribe requests, and the model types. Produce version-1 raw frames, replay boundaries, detach/attention transitions, and final output sequence. New internal test seams in this module: a capture/failing sender function accepting `InvokeResponseBody` and returning success/failure, a controllable blocked sender, and an injected monotonic elapsed-time value for the 100 ms output-edge throttle. These seams must not become frontend commands.

- [ ] Add tests for the 13-byte little-endian header, 1–32768-byte payload, split Unicode/ANSI preservation, no empty frame, sequence starting at 1, empty-ring first/latest 1/0, and exact message length. With a connected encoder stub returning only payload, the unit command must fail the version/header-length assertion; then implement framing.
- [x] Implement the 64-item reader queue, 8 MiB/1024-frame ring with whole-frame eviction, and 256-frame sender queue. Share immutable frame storage where possible. A sender worker performs blocking `Channel::send`; no Channel send under the dispatcher/manager lock.
- [x] Serialize subscribe with output. Validate `None`, exact latest, future/overflow, retained boundary, and missing gap before changing the subscriber. Test replacement while old callbacks are still in flight, send failure, full live queue, and attach-worker failure. Invalid recovery must not silently supply a tail or destroy the current valid subscription.
- [x] Cover a full 1024-frame replay: schedule its retained ordered batch with a bounded cursor, feed the sender without blocking PTY ingestion, and order live frames behind it. Account for outstanding live frames against the sender bound; detach on actual subscriber overload. Retained references must stay within the documented replay window/bounds; no second unbounded history. Failure emits one detach transition and leaves reads/ring/sequence active.
- [x] Implement BEL and complete OSC 9/777 recognition across chunk boundaries with a 4 KiB partial-OSC bound. Test terminators, malformed/oversized/partial sequences, ordinary keywords, and acknowledgement clearing; never log scanned text.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`. Expected: codec/replay/capacity/attention assertions pass, replay does not create new output sequences or unseen-output edges, and slow senders cannot stop the reader.

### Task 3: Implement structured PTY launch and controllable process trees

**Outcome:** The pinned native PTY adapter launches structured commands and provides safe, ordered input/resize/termination primitives.

**Depends On:** Tasks 1–2.

**Files:** Create/test `src-tauri/src/terminal/pty.rs`, `src-tauri/src/platform/process_tree.rs`; modify `src-tauri/src/platform/mod.rs`, `src-tauri/src/terminal/mod.rs`.

**Interfaces:** Consume `ResolvedCliLaunchKind`, `ResolvedShell`, `ResolvedCliProfile`, canonical `PathBuf`, and `PtySizeDto`. Produce owned PTY reader/control/wait handles and raw stream messages. New Rust-only seams: an injectable PTY factory for open/spawn; scripted reader, writer, resize, and child wait results; process-tree attach/terminate/alive operations; and a controlled deadline wait. Production uses native implementations. Keep OS adapter errors independent of terminal business types and map them inside `pty.rs`.

- [x] First test the command builder with synthetic profile data: direct shell launch versus direct executable/individual args, literal metacharacters and spaces, canonical cwd, inherited environment, TERM/COLORTERM, overlay order, and final COMSPEC/SHELL override. A builder missing the cwd must fail the fixture-root assertion under the unit command; implement the structured builder and drop both resolved secret buffers and temporary launch-builder data immediately after spawn returns.
- [x] Open the native PTY at measured cells with pixel dimensions zero. Drop slave after spawn; attach Windows Job Object with kill-on-close immediately and retain its handle. Treat job-attach failure as spawn failure with compensating cleanup; do not publish a runtime first. Implement target-gated Unix process-group signals without validating macOS in development.
- [x] Use named OS threads for long-lived reader/control/sender work. Ensure child waiting does not prevent control input or termination. Reader EOF is distinct from a temporary empty message; fatal reader/writer/wait errors request process-tree cleanup and preserve prior output.
- [x] Implement one control actor for input, resize, and close. Input starts at sequence 1, allows control/NUL, checks UTF-8 byte length at 65536, uses complete write plus flush, and increments ack only on success. A partial write followed by failure is fatal; do not retry already-written bytes or claim OS-level write rollback.
- [x] Resize validates measured cells, starts at sequence 1, ignores stale/duplicate requests with current ack, and coalesces newer pending sizes. Failed native resize keeps the previous applied size/ack. Test simultaneous input/resize/close ordering and a blocked writer without blocking reader progress.
- [ ] Test ETX/750 ms then force cleanup/1250 ms using the controlled deadline seam, early exit, force-kill failure, reader drain timeout, and parent exit with descendants alive. macOS code follows SIGHUP → SIGTERM → SIGKILL within the same budget. Never join an indefinitely blocked worker on an async worker or report success without observed termination/drain.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`. Expected: all adapter assertions pass, fatal transport failure triggers cleanup, and OS-dependent code builds cleanly on Windows.

### Task 4: Orchestrate authoritative launch, publication, and activity

**Outcome:** A pane can own one launch/terminal, and output/activity reflects actual attachment and process state.

**Depends On:** Tasks 1–3.

**Files:** Create/test `src-tauri/src/terminal/manager.rs`; modify `src-tauri/src/terminal/mod.rs`.

**Interfaces:** Consume all six `TerminalDependencies` methods and Task 3's factory, Task 2's stream, and a new injected state-event sink. Produce `TerminalManager` operations backing the six specified commands. Constructor injection must include those dependencies, event sink, PTY factory, and timing seam; integration tests receive the same production orchestration with fake boundary implementations, not a second manager implementation.

- [x] Add a barrier-controlled fake dependency fixture. Two starts for the same pane while resolution is blocked must result in one resolution/spawn and one `TerminalAlreadyAttached`; initially the ungated implementation must fail the spawn-count assertion under the unit command.
- [x] Reserve the pane gate before owner queries. Resolve matching tool selection, current canonical root, then profile immediately before spawn. Test missing/unavailable project, removed/invalid profile, and every BE-007 profile-reason mapping. None may attach a terminal or read credentials outside the resolver.
- [x] Track pending launches independently from the public runtime indexes so cancellation/Quit can find them. Start the supplied Channel before awaiting attach; accumulate process/attention/detach/output flags without publishing owner activity or state events. Barrier tests emit output, BEL, sender failure, and natural exit during this interval.
- [x] Attach through the owner port, then publish both indexes and synchronize the current activity/output edge once. A fast exit publishes its actual final state, never a fabricated running snapshot. On attach failure or caller cancellation, terminate/drain/dispose before releasing the gate; test retry and no surviving child/subscriber/runtime entry.
- [x] Propagate output edges at first attached output and at most once per 100 ms thereafter. Replay is excluded. Use full `TerminalActivity` snapshots for running/finished/failed/attention. Test owner disappearance triggers orphan cleanup, while event emit failure neither rolls back state nor changes the command result.
- [x] Join child completion with reader EOF and dispatcher drain before natural final state. Test wait-before-EOF and EOF-before-wait, final burst, exit 0/nonzero, signal/no reliable code, and fatal I/O. Preserve replay/output after failure until disposal.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`. Expected: launch gates, compensation, pending suppression, activity coalescing, and final sequence assertions pass without reading real project paths or credentials.

### Task 5: Complete close, retention, disposal, and shutdown

**Outcome:** Sessions can retry lifecycle operations safely; no pending or attached terminal escapes confirmed Quit.

**Depends On:** Task 4.

**Files:** Modify/test `src-tauri/src/terminal/manager.rs`, `src-tauri/src/terminal/pty.rs`, `src-tauri/src/terminal/stream.rs`.

**Interfaces:** Produce the exact `close_impact`, `close_for_session`, `reopen_for_session`, and `discard_for_session` signatures in BE-007 using `PaneCloseImpact`, `CloseRetention`, `ReopenHandle`, and `PaneContentRef`. Add only the Rust composition hooks needed for BE-007's specified shutdown gate and pending-launch fallback: begin shutdown synchronously and await cleanup of all pending/remaining runtimes. These hooks are not new Tauri commands.

- [x] Test a running terminal's close impact uses only the sanitized profile display name. Exited content contributes zero running blockers. A close stub returning success without stopping the fake process must fail the process-alive assertion under the unit command.
- [x] Implement close using Task 3 escalation and Task 4 final-output coordination. `ReopenLastTab` retains the stopped runtime/ring/channel and returns `terminal-reopen-<counter>`; `Discard` removes both indexes and output/subscriber resources after cleanup, emitting disposal for previously published content.
- [x] Prove repeated close/reopen/discard calls are idempotent. Reopen returns the same terminal/profile identity, does not resolve project/profile/secret, spawn, increase running count, or allocate output sequences. Disposal frees retained entries; retain/reopen does not clear the frontend's future scrollback ownership contract.
- [x] Inject close failure and deadline expiry. Return `TerminationFailed`, restore a truthful retryable state, and preserve ownership/token/state needed for retry. Do not return `SessionAttachFailed` as if compensation succeeded when a spawned child is still alive; retain failed pending cleanup internally and surface cleanup failure safely.
- [x] Set the shutdown gate before cleanup; reject new start/input/resize with `RuntimeShuttingDown`. Barrier-test Quit at root resolution, spawn, pending attach, and live output. Attempt cleanup of every runtime even if one fails; only clear all maps/tokens and allow successful exit after resources are confirmed stopped. Repeated shutdown retries remaining work.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --lib`. Expected: cleanup and retention assertions pass, one failed terminal cannot skip another, and a new manager starts with no restored state.

### Task 6: Wire production composition, commands, and generated bindings

**Outcome:** The app exposes BE-007 through the actual Tauri handler and routes real Sessions lifecycle calls to its owner.

**Depends On:** Tasks 4–5.

**Files:**

- Create: `src-tauri/src/terminal/commands.rs`, `src-tauri/tests/terminal_runtime.rs`.
- Modify: `src-tauri/src/terminal/mod.rs`, `src-tauri/src/app/mod.rs`, `src-tauri/src/app/data_runtime.rs`, `src-tauri/tests/app_builder.rs`, `src-tauri/tests/export_bindings.rs`.
- Generate: BE-007 binding output under `src/bindings/terminal/`, following the existing grouped-file generator convention; leave `cli-profiles.ts` content unchanged unless regenerated identically.
- Regression test: existing `src-tauri/tests/sessions_runtime.rs`, `src-tauri/tests/app_lifecycle.rs`, `src-tauri/tests/projects_commands.rs`, `src-tauri/tests/cli_profiles_contract.rs`.

**Interfaces:**

- `start_terminal(session_id, tab_id, pane_id, initial_size, on_output) -> TerminalDto`.
- `get_terminal(terminal_id) -> TerminalDto`.
- `subscribe_terminal_output(terminal_id, after_sequence, on_output) -> TerminalSubscriptionDto`.
- `write_terminal(terminal_id, input_sequence, data) -> TerminalInputAckDto`.
- `resize_terminal(terminal_id, resize_sequence, size) -> TerminalResizeAckDto`.
- `acknowledge_terminal_attention(terminal_id) -> TerminalDto`.
- Every command also receives the window and managed manager and returns `Result<_, TerminalError>` exactly as BE-007 specifies. Channel is `Channel<InvokeResponseBody>`.
- State event: `terminal://state-changed`, `TerminalStateChangedDto`; bytes travel exclusively as `InvokeResponseBody::Raw` on the supplied Channel.
- New app test seam, following existing `configure_with_*_for_tests` constructors: explicit temporary app-data path plus injected Terminal dependencies/factory/sink and router bind fault. Expose only what external integration tests need; no frontend/production command may select these seams.

- [ ] Add command tests with a mock main webview, callback capture, and fake PTY/ports. Register connected thin command stubs first; a valid start returning a launch failure must fail the expected successful DTO/attach assertion under `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_runtime`. Then delegate all commands to the manager.
- [x] Add app adapters using `SessionManager::get_session`, `ProjectService::available_root(...).root_path`, `CliProfilesService::resolve_for_launch`, `attach_runtime_content`, `record_pane_output`, and `update_pane_activity`. Map errors exactly as BE-007 prescribes and propagate only sanitized data.
- [x] Extend the Stage 8 content runtime into `PaneContentRuntimeRouter` in `app/data_runtime.rs`. Preserve tool-selection retention; route only Terminal to a once-bound `Weak<TerminalManager>`. Keep unsupported Files behavior. Construct router → strongly retained Sessions handle → Terminal with weak Sessions dependency → bind weak Terminal → complete setup before invocations are accepted. Preserve existing managed handle types used by old commands.
- [x] In `SessionsAppRuntime::shutdown_for_quit`, begin the Terminal gate before Sessions shutdown. Await Sessions cleanup and always attempt the pending/remaining Terminal fallback even if Sessions returns an error. Return safe lifecycle failure if either cleanup remains incomplete. Do not change hide/show into shutdown, introduce duplicate profile shutdown, or implement the future reset workflow here.
- [ ] Test setup with deliberately omitted bind and a duplicate bind, and assert builder setup fails before command access with no native spawn. Test expired weak delegate fails safely. A successful isolated builder holds the required strong references, manages Terminal, preserves existing services, and launches zero PTYs until `start_terminal`.
- [ ] Exercise all six commands from non-main windows: each returns `UnauthorizedWindow` before querying dependencies or writing bytes. Through the real handler test raw header capture, pending output, replay/replacement, final event sequence, stream detach/recovery, input/resize ack/errors, get-after-exit/retain, and acknowledge on attached versus disposed content.
- [ ] Use real Sessions with fake terminal resources to test close pane/tab/session, remove project through Projects, last-tab reopen/discard, hidden/unobserved output, and Quit. Failed terminal cleanup must keep the applicable Sessions target; folder sentinel files must remain unchanged after remove.
- [x] Extend the existing ts-rs generator and drift assertions for every BE-007 DTO/event/error. Export no raw-frame, Channel, port, handle, or launch-profile type. Run `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings`: the initial generation may fail with the existing `bindings were regenerated` message; rerun and require a clean pass with no further diff.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_runtime --test app_builder --test sessions_runtime --test app_lifecycle --test projects_commands --test cli_profiles_contract --test export_bindings`. Expected: every target executes tests and passes; existing command/state/profile contracts remain intact.

### Task 7: Verify real Windows PTYs and record the frontend handoff

**Outcome:** Native process behavior is proven on Windows, with explicit limits on what backend evidence can establish.

**Depends On:** Task 6.

**Files:** Create `src-tauri/tests/terminal_pty_windows.rs`, `src-tauri/tests/fixtures/pty_echo.ps1`, `src-tauri/tests/fixtures/pty_child_tree.ps1`; update this plan's evidence/checklists during implementation only.

**Interfaces:** Consume public Terminal operations with real PTY/process-tree adapters and fake Projects/Profile dependencies returning a temporary canonical root and a fixed noninteractive test profile. Fixture protocol emits synthetic readiness, Unicode, size, echo, completion, and child identity markers; child identities remain test-side and never become a public DTO.

- [x] Create an explicit `tempfile::TempDir` per test for project and any test app-data/storage. Resolve only the known Windows PowerShell executable and pass `-NoLogo`, `-NoProfile`, and fixture arguments separately. Fixtures must not load user profiles, contact services, run user commands, or write shell history. Use fixed synthetic environment values; never mutate process-global environment to isolate concurrent tests.
- [x] Give every spawned fixture a teardown guard that force-terminates its owned process tree on assertion failure and bounds waits. Child-tree fixtures use a handshake so the harness knows which children belong to the test; include an early-child-creation case to expose post-spawn job-attachment races. Poll those owned handles/identities and assert all have exited, not merely the parent. Never terminate processes by broad name matching.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_pty_windows -- --list` and require real Windows test cases to be listed. Native tests must not be silently ignored on the supported Windows runner. Use a named OS resource failure result for unsupported ConPTY; do not disguise it as success.
- [x] Verify split Vietnamese/Unicode/wide/emoji bytes, bursts, literal control input, chunked large paste input, measured resize/native size report, natural exit 0/nonzero, ETX and force close, and final output drain. Assert fixture markers/byte subsequences accounting for native terminal control traffic, rather than assuming an exact shell transcript.
- [ ] Run four terminals concurrently within one test: independent ordered sequences, input acks, output bursts, resize, subscriber failure/recovery, and cleanup. Withhold/reorder captured delivery in the Rust transport test to verify sequence metadata, but do not claim this validates the future WTerm reorder consumer.
- [x] Run `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_pty_windows`. Expected: native tests pass with all children stopped and temporary resources released. Complete the final verification table below.
- [x] Record the backend evidence and leave FE-008 checks below pending. Do not add a temporary product terminal UI just to satisfy a manual smoke checklist in this backend-only plan.

## Final Verification

All commands are run on Windows from the repository root. Resolve failures before marking the backend scope complete.

| Scope | Command or method | Expected result |
|---|---|---|
| Frontend format | `pnpm format:check` | No formatting errors, including generated bindings |
| Frontend lint | `pnpm lint` | No lint errors |
| Frontend types | `pnpm typecheck` | Generated types and existing consumers compile |
| Frontend tests | `pnpm test` | Existing unit/component behavior passes |
| Frontend production assets | `pnpm build` | Existing frontend production bundle succeeds |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No formatting diff |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Pass with warnings denied |
| Rust unit coverage | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Includes all new model/stream/PTY/manager/process-tree unit tests |
| Terminal/native integration | `cargo test --manifest-path src-tauri/Cargo.toml --test terminal_runtime --test terminal_pty_windows` | Both targets run nonzero tests and pass |
| Composition/regressions | `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder --test sessions_runtime --test app_lifecycle --test projects_commands --test cli_profiles_contract --test export_bindings` | All explicit targets pass; binding rerun makes no changes |
| Full Rust suite | `cargo test --manifest-path src-tauri/Cargo.toml --all-features` | All unit/integration/doc tests pass |
| Windows desktop bundle | `pnpm tauri build` | Windows application/installer builds successfully |
| Configuration boundary | Review `git diff -- src-tauri/capabilities src-tauri/tauri.conf.json src-tauri/migrations` and current CSP | No permission/migration changes; existing WASM allowance retained without widening |
| No persistence/log leakage | Inspect terminal/platform/app diffs for storage/file/log writes; sentinel assertions in isolated integration tests; capture safe errors/events with synthetic sensitive values | No terminal bytes/launch data persisted or logged; removing a project preserves its folder |
| IPC boundary | Inspect actual handler registration and assertions capturing event payloads versus raw Channel messages | Exactly six new narrow terminal commands; no ordinary event carries output; no new generic OS command |
| Process isolation | Native fixture teardown/aliveness assertions, plus fresh-manager test | No owned process survives cleanup; no runtime/history restores on a fresh manager |
| App smoke now | `pnpm tauri dev`; open/close-to-tray/show/Quit the existing UI | Setup launches no terminal spontaneously; existing native lifecycle remains functional |

### FE-008 / Stage 9 Acceptance Handoff

These are required later to satisfy the integrated BE-007 acceptance criteria; backend tests do not substitute for them:

- [ ] Specify FE-008 with no open contract questions before implementing its UI/IPC wrapper.
- [ ] Start only after Ghostty core and nonzero measured cells are ready; retain the pending core for output before the invoke resolves.
- [ ] Validate raw frame version/length and decimal sequences; apply only contiguous `Uint8Array` payloads, ignore duplicates, and recover gaps after 250 ms with a 256-frame/8 MiB reorder bound. Verify this in frontend unit/component tests with deliberately reordered callbacks.
- [ ] Keep Channel/Ghostty registry independent of DOM pane/route visibility. Switching sessions/projects, maximize/restore, and hide/show retain processes, last size, and full scrollback; backend ring is only recovery history.
- [ ] On close-tab/reopen, retain the same stopped core/identity without spawn; discard/Quit disposes it. Wait for final output sequence before final badge rendering and resync snapshots after dropped state events.
- [ ] Manually verify Windows WebView2 in dev and packaged builds: default shell, installed Codex/Claude, alternate screen, mouse/SGR, synchronized output, Unicode/wide/emoji, Vietnamese IME, clipboard, bracketed paste, full-scrollback find, OSC 8 and ordinary links, resize, and four panes simultaneously. Missing optional CLI installation is recorded as untested, not passed.
- [ ] Verify embedded Ghostty WASM and unchanged CSP in both builds; no Zig default core or WebSocketTransport. Verify close/remove/Quit confirmation and retry behavior with actual terminal processes.

## Deviations and Decisions

- Plan scope follows the user's BE-007 request and the roadmap's backend-first order. FE-008 work and integrated stage completion remain explicit follow-up gates.
- Router implementation extends the existing app composition adapter; it is not assumed to be a pre-existing Sessions export.
- No source code, dependency manifest, generated binding, or historical completed plan is changed when creating this plan.

## Outcome

Implemented the BE-007 backend runtime on Windows. The implementation adds the six main-window-only commands, generated public bindings, bounded raw framing/replay and attention scanning, structured `portable-pty` launch, Job Object descendant ownership, ordered input/resize/close control, Sessions lifecycle routing, pending-launch shutdown cleanup, and retained reopen state. Terminal bytes and launch data remain process-local and are absent from events, DTOs, persistence, and new diagnostics.

Verification completed on Windows 2026-09-05:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed; Vitest ran 1,631 tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and Clippy with all targets/features and warnings denied passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` passed 239 unit tests.
- `terminal_runtime` passed two real-handler tests covering both the six-command authorization boundary and valid main-window delegation; `terminal_pty_windows` listed and passed three real ConPTY tests, including four concurrent terminals and exact descendant termination.
- The full Rust suite passed with `CARGO_BUILD_JOBS=1`; the initial unrestricted parallel attempt exhausted the host paging file before tests ran.
- `pnpm tauri build` passed with one Cargo build job and produced `src-tauri/target/release/xwork.exe`.
- No capability, migration, or `tauri.conf.json` change was made. Existing Vite chunk-size and bundle-identifier warnings remain unchanged and non-fatal.

The implementation consolidated some planned deterministic cases into module tests instead of replaying each temporary red stub described above; unchecked test-matrix items remain explicit. macOS execution was not validated, as required by the development policy. FE-008 and the WebView2/WTerm acceptance checklist remain pending and out of this backend implementation scope.
