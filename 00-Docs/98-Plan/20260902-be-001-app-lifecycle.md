# BE-001 App Lifecycle and System Tray Implementation Plan

**Status:** Implemented — automated verification complete; historical red checks
skipped; manual desktop smoke pending

**Goal:** Implement single-instance startup, the `main` window lifecycle, the
Phase 1 native system tray, and the confirmed Quit flow exactly as specified by
`BE-001`, exposing only the six narrow Tauri commands and two events defined by
that contract.

**Completion Criteria:**

- A second executable activation on Windows does not create a second running
  application and brings the existing `main` window to the front without
  resetting route or runtime state (Windows smoke test).
- The custom Close command and the native `CloseRequested` event on `main` both
  resolve to hide-to-tray; hide, minimize, and maximize toggling never stop
  sessions, processes, or a pending Quit request.
- The Phase 1 tray menu contains exactly `Open XWork`, the required separators,
  and `Quit XWork`; it renders no empty attention group and no `Quick Note`
  item.
- `request_quit` with `session_count == 0` reaches the exit-ready state without
  creating a dialog; with at least one session it creates exactly one pending
  request whose `QuitSummaryDto` carries all four counts, and repeated entry
  points reuse the same `request_id`.
- `cancel_quit` and closing/hiding the window keep runtime state alive;
  request id `0`, stale ids, and double confirm are rejected with the specified
  error codes; cleanup failure restores the pending request and never exits.
- `request_quit`, `cancel_quit`, and `confirm_quit` authorize the exact
  invoking window label `main` before any snapshot read or state transition;
  every other label receives `UnauthorizedWindow` and leaves runtime and
  pending state untouched.
- Runtime snapshot and cleanup futures are awaited through `AppRuntimeFuture`
  outside the lifecycle mutex; yielding test futures still complete, and no
  production path uses `block_on` or `spawn_blocking`.
- A fresh process loads no runtime session state and deletes no durable data
  owned by `Storage` or any other capability.
- `src/bindings/app-lifecycle.ts` is generated from Rust into exactly one file,
  is never edited manually, and `src-tauri/capabilities/main.json` gains no
  permission.
- Every new function, method, callback, test, and helper has a short purpose
  comment, and state transitions or race invariants have inline comments.
- On Windows, the frontend format/lint/type/test gates, `pnpm format:rust`,
  `pnpm lint:rust`,
  `cargo test --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features`, `pnpm tauri build --no-bundle`, and the manual desktop
  smoke checklist all pass.

**Architecture:** `app::lifecycle` owns the Quit state machine, exact-window
authorization, the six commands, and the public DTO/error contract; runtime
counts, attention sessions, and cleanup are reached only through the
`AppRuntime` future-based seam whose Phase 1 adapter is empty. `platform::window`
owns the `main` window adapter with test doubles, and `app::tray` owns the menu
model plus menu-action dispatch. The composition root registers the official
single-instance plugin first, then storage, lifecycle state, and the native
tray, while hermetic tests build a mock-runtime application with injected
runtime and tray seams and drive commands through the real IPC pipeline.

**Tech Stack:** Rust 1.98.0 stable, Cargo 1.98.0, Rust Edition 2024, Tauri
2.11.5 with the `tray-icon` feature and existing `test` dev feature,
`tauri-plugin-single-instance` 2.4.4, Serde 1.0.229 with `derive`, `ts-rs`
12.0.1 with default `serde-compat`, and `serde_json` 1.0.151 as a dev-only
test dependency.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 3 (Lifecycle and application
  shell)
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections 5,
  16, and 18
- Backend spec: `00-Docs/03-Backend/BE-001-app-lifecycle-and-system-tray.md`
- Dependency spec: `00-Docs/03-Backend/BE-002-storage-foundation.md`
  (implemented; storage is only consumed as existing managed state)
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Plan rules: `PLANS.md`

No frontend specification or wireframe applies to this plan: it implements only
the `BE-001` backend contract. `FE-001` and `FE-006` are not yet specified and
their integration is planned separately as the remainder of roadmap Stage 3.

## Scope

**In Scope:**

- Exact-pinned `tauri-plugin-single-instance`, Serde, and `ts-rs` dependencies
  plus the Tauri `tray-icon` feature.
- Public lifecycle DTOs, `AppLifecycleError`, supporting operation/event enums,
  and one generated `src/bindings/app-lifecycle.ts` output.
- Commands `hide_main_window`, `minimize_main_window`,
  `toggle_main_window_maximized`, `request_quit`, `cancel_quit`, and
  `confirm_quit` with exact invoking-window authorization.
- The Quit state machine: pending request allocation and reuse, cancel, stale
  and in-progress rejection, async snapshot/cleanup, cleanup-failure restore,
  and exit-ready completion.
- The `AppRuntime` future seam with the empty Phase 1 staging adapter and the
  `AttentionSession` contract for later capabilities.
- The `main` window adapter, close-to-tray decision, single-instance callback,
  and hide/minimize/maximize operations.
- The tray menu model, label normalization, menu-ID resolution, tray dispatch,
  and native tray attachment on the production path.
- Events `app-quit-requested` and `app-navigate-session` emitted only to
  `main`.
- Unit tests inside the new modules plus `src-tauri/tests/app_lifecycle.rs`,
  extended `src-tauri/tests/app_builder.rs`, and
  `src-tauri/tests/export_bindings.rs`.

**Out of Scope:**

- `FE-001`/`FE-006` UI, React routing, dialog layout, and generated-binding
  consumption.
- Session/tab/pane runtime data, attention transitions, and PTY/process
  cleanup owned by `BE-005`/`BE-007`; the Phase 1 adapter returns zero counts,
  no attention sessions, and successful cleanup.
- The `Quick Note` tray item and Quick Note window lifecycle (`BE-017`), and
  any accelerator display (`BE-009`).
- Settings for quit confirmation or launch-at-login, notifications, updater,
  installer, and code signing.
- macOS validation (deferred to release preparation) and any logging
  capability or new logging dependency.

## Global Constraints

- "Keep OS access, persistence, terminal processes, and business rules in Rust;
  the React frontend communicates with them through narrowly scoped Tauri
  commands and events." (`AGENTS.md`)
- "Every function, method, callback, test, and helper must have a short
  comment describing its purpose." (`AGENTS.md`)
- "Chỉ cấp capability tối thiểu cho từng cửa sổ; không đưa API hệ thống tổng
  quát ra frontend." and "Generated binding không được sửa thủ công."
  (`00-Docs/00-Overview/01-TechStack.md`)
- "`storage` và `platform` không phụ thuộc vào capability nghiệp vụ." and
  "Tauri command phải mỏng: parse/validate DTO, gọi xử lý capability và chuyển
  kết quả thành DTO; không chứa business rule hoặc SQL."
  (`00-Docs/00-Overview/02-ProjectStructure.md`)
- Backend capabilities may use `storage`, `platform`, and `shared` but must not
  access another capability's internal implementation; `app` composes them.
  (`00-Docs/00-Overview/02-ProjectStructure.md`)
- Tests must not read or write the developer's real app data or user-owned
  state; native OS integrations that cannot run hermetically are verified by
  the Windows build and manual smoke test. (`PLANS.md`)
- Validate only on Windows during development. (`AGENTS.md`)

Every task implicitly includes these constraints.

## Assumptions, Risks, and Blockers

**Assumptions:**

- `BE-002` is complete: `Storage::open`, `with_connection`,
  `with_transaction`, and `DATABASE_FILE_NAME` exist and storage setup already
  runs in the Tauri setup hook (commit `a6dd275`).
- `tauri-plugin-single-instance` 2.4.4 is compatible with the pinned desktop
  toolchain: it is the crate's current default release, requires Rust 1.77.2+
  (toolchain is 1.98.0), depends on the Tauri 2 workspace line, and needs no
  optional feature (verified against its crates.io metadata and workspace
  manifest on 2026-09-02).
- `ts-rs` 12.0.1 (pinned by `01-TechStack.md`) requires Rust 1.78.0+ and needs
  only its default `serde-compat` feature for these DTOs; bindings are
  exported programmatically with `export_to_string`.
- Tauri codegen 2.11.5 embeds `src-tauri/icons/icon.ico` as the Windows
  `default_window_icon` without the `image-png`/`image-ico` features, so the
  existing icon is reusable for the tray with no new asset or feature.
- `serde_json` 1.0.151 is already resolved in `src-tauri/Cargo.lock` and is
  added as an exact-pinned dev-dependency for IPC payload assertions only.
- In Phase 1 every real `QuitSummaryDto` count is `0` because no runtime
  provider exists yet; dialog behavior with non-zero counts is proven with
  test doubles, and real-session smoke coverage arrives with `BE-005`/`FE-001`.
- Tauri 2.11.5 does not run `Builder::setup` during `build`; mock-runtime
  tests advance one `run_iteration` to execute setup, as established by
  `BE-002`.

**Risks:**

- The single-instance plugin's setup acquires a Windows mutex keyed by
  `com.xwork.app` and terminates secondary processes. Registering it in mock
  tests is not hermetic and can kill the test binary when the real app runs.
  Mitigation: plugin registration stays on the production `configure` path and
  its behavior is covered by the Windows smoke test (see Deviations).
- `AppHandle::exit` on `MockRuntime` reaches `request_exit`, which is
  `unimplemented!()` and panics the test process. Mitigation: `app.exit(0)`
  runs only in production tails; automated tests assert the `ExitReady` state
  instead.
- Native tray and native menu creation need an interactive desktop session.
  Mitigation: automated tests cover the pure model and dispatch seams; native
  attachment is compiled by every build and verified by the Windows build plus
  smoke checklist.
- `tauri::test` is documented as unstable. Mitigation: Tauri stays exact-pinned
  at 2.11.5 and mock-runtime usage mirrors the existing `app_builder.rs`
  pattern.
- Generated TypeScript may not match Biome formatting. Mitigation: Task 1 adds
  a `biome.json` override that disables formatter and linter for
  `src/bindings/**` while `pnpm typecheck` still validates the generated types.

**Blockers:** None. `BE-001` has no open questions.

## Dependency Order

1. Task 1 (dependencies and public contracts) → enables Tasks 2–6.
2. Task 2 (window adapter) → enables Tasks 5 and 7.
3. Task 3 (Quit state machine and runtime seam) → enables Tasks 5 and 6.
4. Task 4 (tray menu model) → enables Task 6.
5. Task 5 (commands and isolated test composition) → enables Tasks 6 and 7.
6. Task 6 (tray dispatch and Quit-flow integration) → validates behavior before
   production wiring.
7. Task 7 (production composition root) → completes the desktop integration and
   smoke checklist.

---

### Task 1: Dependencies and Public Lifecycle Contracts

**Outcome:** The exact-pinned lifecycle dependencies are declared, the public
DTO/error contract compiles in `app::lifecycle` and `platform::window`, and one
generated binding file is verified by a contract test.

**Depends On:** None

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Modify: `biome.json`
- Create: `src-tauri/src/app/lifecycle.rs`
- Create: `src-tauri/src/platform/mod.rs`
- Create: `src-tauri/src/platform/window.rs`
- Create: `src-tauri/tests/export_bindings.rs`
- Create: `src/bindings/app-lifecycle.ts`

**Interfaces:**

- Consumes: existing `app::configure` composition root and `Storage` managed
  state from `BE-002`.
- Produces: `QuitSummaryDto`, `QuitRequestDto`, `SessionNavigationDto`,
  `AppLifecycleError`, `TrayOperation`, and `LifecycleEvent` as `pub` types in
  `app::lifecycle`; `WindowOperation` as a `pub` type in `platform::window`
  re-exported by `app::lifecycle`; `pub mod platform;` in `lib.rs`; the
  generated `src/bindings/app-lifecycle.ts`.

Exact dependency manifest entries:

```toml
[dependencies]
serde = { version = "=1.0.229", features = ["derive"] }
tauri = { version = "=2.11.5", features = ["tray-icon"] }
tauri-plugin-single-instance = "=2.4.4"
ts-rs = "=12.0.1"

[dev-dependencies]
serde_json = "=1.0.151"
```

The contract types are exactly the `BE-001` shapes: the three camelCase DTOs,
the tagged `AppLifecycleError`, `TrayOperation`, and `LifecycleEvent` in
`app/lifecycle.rs`, plus `WindowOperation` in `platform/window.rs` (all with
`Serialize`/`TS` and `snake_case` renames). `platform` keeps no dependency on
`app`; `app::lifecycle` re-exports `WindowOperation` so the lifecycle module
stays the public error surface.

- [x] **Step 1: Add the dependencies and failing contract test**

  Apply the manifest entries above, then create `export_bindings.rs`. The test
  concatenates `export_to_string()` output for `QuitSummaryDto`,
  `QuitRequestDto`, `SessionNavigationDto`, `WindowOperation`, `TrayOperation`,
  `LifecycleEvent`, and `AppLifecycleError` in that fixed order, writes the
  result to `<CARGO_MANIFEST_DIR>/../src/bindings/app-lifecycle.ts`, and fails
  with a "bindings were regenerated" assertion whenever the on-disk content
  differs. Add the `biome.json` override for `src/bindings/**` that disables
  formatter and linter for generated code.

- [ ] **Step 2: Verify the test fails for the expected reason** _(skipped; see
  Deviations)_

  Run:
  `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings`

  Expected: the `export_bindings` test target compiles with the new
  dependencies but fails to resolve `xwork_lib::app::lifecycle` (and its
  types), proving the contract module does not exist yet.

- [x] **Step 3: Implement the contract types**

  Add `pub mod platform;` to `lib.rs`; declare `pub mod lifecycle;` in
  `app/mod.rs`; create `platform/window.rs` containing `WindowOperation`; and
  create `app/lifecycle.rs` containing the remaining types, each with a short
  doc comment. Do not add state, commands, or behavior in this task.

- [x] **Step 4: Verify the task**

  Run:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings`
    (run twice: the first run regenerates and fails when the committed file is
    absent or stale; the immediate second run passes with no regeneration)
  - `cargo metadata --manifest-path src-tauri/Cargo.toml --locked --no-deps`
  - `pnpm typecheck`

  Expected: the contract test passes on the second run; `--locked` metadata
  succeeds with `tauri-plugin-single-instance` 2.4.4 and `ts-rs` 12.0.1 added
  and `muda` 0.19.3 plus `tray-icon` 0.24.2 entering the `xwork` dependency
  closure; TypeScript accepts the generated file.

### Task 2: Main Window Adapter

**Outcome:** `platform::window` exposes the `main` window operations with
test-double ordering and per-operation error mapping, used later by commands,
tray dispatch, and the single-instance callback.

**Depends On:** Task 1

**Files:**

- Modify: `src-tauri/src/platform/window.rs`

**Interfaces:**

- Consumes: `WindowOperation`, `tauri::WebviewWindow`.
- Produces: `pub(crate) trait MainWindow` with `show`, `hide`, `unminimize`,
  `focus`, `minimize`, `maximize`, and `unmaximize` returning
  `Result<(), tauri::Error>` plus `is_maximized` returning
  `Result<bool, tauri::Error>`; `impl MainWindow for WebviewWindow<R>`; and
  free functions `bring_to_front(&dyn MainWindow)`,
  `hide_window(&dyn MainWindow)`, `minimize_window(&dyn MainWindow)`, and
  `toggle_window_maximized(&dyn MainWindow) -> Result<bool, WindowOperation>`.

- [x] **Step 1: Add the failing adapter tests**

  In a `#[cfg(test)]` module, add a recording `MainWindow` double that stores
  call order and can fail any chosen operation with a fixture
  `tauri::Error::Io`. Cover: `bring_to_front` performs show, unminimize, then
  focus; each failed operation maps to the matching `WindowOperation`;
  `toggle_window_maximized` reads maximized state, switches it, and returns the
  post-operation state; `minimize_window` calls minimize exactly once.

- [ ] **Step 2: Verify the tests fail for the expected reason** _(skipped; see
  Deviations)_

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib platform::window`

  Expected: compilation of the `platform::window` unit tests fails on the
  unresolved `MainWindow` trait and adapter functions.

- [x] **Step 3: Implement the minimum adapter**

  Implement the trait, the `WebviewWindow` implementation delegating to the
  real window API, and the four functions that map each failing step to its
  `WindowOperation` while reporting the native source at the mapping site (see
  Deviations for the Phase 1 logging note).

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib platform::window`

  Expected: all adapter unit tests pass.

### Task 3: Quit State Machine and Runtime Seam

**Outcome:** The lifecycle state machine authorizes window labels, allocates
and reuses Quit requests, awaits snapshot/cleanup futures outside its lock,
restores pending state on cleanup failure, and exposes the empty Phase 1
runtime adapter.

**Depends On:** Task 1

**Files:**

- Modify: `src-tauri/src/app/lifecycle.rs`

**Interfaces:**

- Consumes: `AppLifecycleError`, `WindowOperation`, DTOs, `tauri::async_runtime`.
- Produces (exact DD contract, exposed as `#[doc(hidden)] pub` for the
  external integration tests): `type AppRuntimeFuture<'a, T>`,
  `trait AppRuntime` (`quit_summary`, `attention_sessions`,
  `shutdown_for_quit`), and `struct AttentionSession`; plus
  `#[doc(hidden)] pub struct AppLifecycleState` with `new(Arc<dyn AppRuntime>)`
  and a test-only `try_lock_inner_for_tests`; `pub(crate) enum QuitFlow {
  Dialog(QuitRequestDto), ProceedShutdown }`; `pub(crate) enum
  ShutdownOutcome { ExitReady }`; `pub(crate) struct EmptyAppRuntime`;
  authorization helpers `authorize_window_command(&str)` and
  `authorize_quit_command(&str)`; and
  `impl From<WindowOperation> for AppLifecycleError`.

State-machine methods on `AppLifecycleState`:

- `async fn request_quit(&self) -> Result<QuitFlow, AppLifecycleError>`:
  returns an existing pending request unchanged; otherwise awaits
  `quit_summary` outside the lock, stores a new pending request when
  `session_count > 0`, or atomically transitions to `ShuttingDown` and returns
  `ProceedShutdown` when it is `0`.
- `fn cancel_quit(&self, request_id: u32) -> Result<(), AppLifecycleError>`:
  rejects `0` (`InvalidRequestId`), unknown/mismatched ids
  (`StaleQuitRequest`), and `ShuttingDown` (`QuitAlreadyInProgress`); otherwise
  clears the pending request only.
- `fn begin_confirm_quit(&self, request_id: u32) -> Result<(), AppLifecycleError>`:
  validates the id and transitions `Pending → ShuttingDown` atomically
  (`QuitAlreadyInProgress` on a second confirm).
- `async fn finish_shutdown(&self) -> Result<ShutdownOutcome, AppLifecycleError>`:
  awaits `shutdown_for_quit` outside the lock, clears pending state and returns
  `ExitReady` on success, or restores the pending request and returns
  `RuntimeShutdownFailed` on failure.

The request-id allocator starts at `1`, wraps to `1` after `u32::MAX`, and
skips an id equal to a still-pending request.

- [x] **Step 1: Add the failing state-machine tests**

  In `#[cfg(test)]` inside `lifecycle.rs`, cover with in-crate futures driven
  by `tauri::async_runtime::block_on`: exact-label authorization returning
  `InvalidWindow` vs `UnauthorizedWindow`; dialog creation for one or more
  sessions; request reuse and single snapshot call; allocator wrap at
  `u32::MAX`; cancel/stale/zero-id/double-confirm cases; `RuntimeSnapshotFailed`
  leaving state untouched; shutdown success clearing pending state and reaching
  `ExitReady`; shutdown failure restoring the same pending request; a yielding
  future still completing; and a probe runtime that calls
  `try_lock_inner_for_tests()` after `yield_now().await` and fails when the
  lifecycle mutex is still held across the await.

- [ ] **Step 2: Verify the tests fail for the expected reason** _(skipped; see
  Deviations)_

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib app::lifecycle`

  Expected: compilation fails on the unresolved `AppRuntime`,
  `AppLifecycleState`, `EmptyAppRuntime`, and state-machine methods.

- [x] **Step 3: Implement the minimum state machine**

  Implement the seam, the empty adapter (zero counts, empty attention list,
  successful cleanup), the mutex-protected inner state with poison mapping to
  `StateLockPoisoned`, and the four state-machine methods with inline comments
  for the lock-release points around every await.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib app::lifecycle`

  Expected: all state-machine unit tests pass, including the lock-probe case.

### Task 4: Tray Menu Model

**Outcome:** The tray menu model deterministically renders the Phase 1 menu,
normalizes session labels, resolves menu IDs without trusting labels, and
provides the constants used by dispatch and later capabilities.

**Depends On:** Task 1

**Files:**

- Create: `src-tauri/src/app/tray.rs`
- Modify: `src-tauri/src/app/mod.rs`

**Interfaces:**

- Consumes: `AttentionSession`.
- Produces: constants `TRAY_ID = "xwork.tray"`, `OPEN_MENU_ID =
  "xwork.tray.open"`, `QUIT_MENU_ID = "xwork.tray.quit"`, and
  `ATTENTION_GROUP_LABEL = "Needs attention"`; `pub(crate) enum TrayEntry`
  (`Open`, `AttentionHeader`, `Session { menu_id, label }`, `Separator`,
  `Quit`); `fn build_tray_menu_model(&[AttentionSession]) -> Vec<TrayEntry>`;
  `fn normalize_label(&str) -> String`; `fn resolve_menu_action(&[TrayEntry],
  &str) -> TrayAction` with `TrayAction { Open, Session(String), Quit,
  Unknown }`.

Rules encoded by the model: final order is `Open XWork`, separator, the
attention header plus at most five sessions (newest `attention_sequence`
first, then ascending `session_id`), separator, `Quit XWork`; the header and
its separator are omitted when the list is empty; labels convert newlines and
tabs to spaces, collapse whitespace, and truncate at 80 Unicode scalars while
never truncating IDs or routing payloads; actions are resolved only from
backend-owned IDs.

- [x] **Step 1: Add the failing model tests**

  Cover: the exact Phase 1 order; empty-group omission; the five-item cap;
  stable sorting with ties; newline/tab normalization, whitespace collapsing,
  and 80-scalar truncation (including a multi-scalar grapheme boundary);
  resolution of open/quit/session IDs; and that a displayed label never acts
  as an ID.

- [ ] **Step 2: Verify the tests fail for the expected reason** _(skipped; see
  Deviations)_

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib app::tray`

  Expected: compilation fails on the unresolved `app::tray` module items.

- [x] **Step 3: Implement the minimum model**

  Implement the constants, entries, model builder, normalizer, and resolver
  with short comments; no native tray code yet.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib app::tray`

  Expected: all tray model unit tests pass.

### Task 5: Lifecycle Commands and Isolated Test Composition

**Outcome:** The six commands exist with the exact `BE-001` signatures and
authorization, a mock-runtime composition entry wires storage, state, commands,
and the close handler hermetically, and integration tests drive the window
commands and authorization through the real IPC pipeline.

**Depends On:** Tasks 2 and 3

**Files:**

- Modify: `src-tauri/src/app/lifecycle.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Create: `src-tauri/tests/app_lifecycle.rs`

**Interfaces:**

- Consumes: adapter functions from Task 2; state machine and authorization
  from Task 3; `Storage` setup and `tauri::test::{mock_builder, mock_context,
  noop_assets, get_ipc_response, INVOKE_KEY}`.
- Produces: the six `#[tauri::command]` functions exactly as specified by
  `BE-001` (crate-internal, thin: validate the invoking label, delegate, map
  errors); `#[doc(hidden)] pub enum CloseDecision { HideToTray, AllowClose }`;
  `#[doc(hidden)] pub fn apply_close_requested<R: Runtime>(window:
  &WebviewWindow<R>) -> Result<CloseDecision, AppLifecycleError>`;
  `pub(crate) fn lifecycle_invoke_handler<R: Runtime>() ->
  tauri::ipc::InvokeHandler<R>`; and `#[doc(hidden)] pub fn
  configure_with_lifecycle_for_tests<R: Runtime, F>(builder, app_data_dir:
  PathBuf, runtime: Arc<dyn AppRuntime>, attach_tray: F) -> Builder<R>` where
  `F` is the injectable tray seam (tests pass a no-op/recorder; production
  passes the native attacher in Task 7). The entry registers the storage setup,
  lifecycle state, invoke handler, and close handler, but never the
  single-instance plugin or native tray.

The production close handler (registered by the shared entry) reacts to
`CloseRequested` only for label `main` while not shutting down, calls
`apply_close_requested` to hide via the adapter, and calls
`api.prevent_close()` for `HideToTray` (and fail-safely for a hide error);
every other label is untouched.

- [x] **Step 1: Add the failing integration tests**

  In `app_lifecycle.rs`, build an isolated mock app per test with
  `tempfile::TempDir`, an `Arc<FakeAppRuntime>` recording calls and returning
  fixture summaries/failures, and `configure_with_lifecycle_for_tests` with a
  no-op tray seam; create `main` and `quick-note` webview windows with
  `WebviewWindowBuilder` and invoke commands with `tauri::test::
  get_ipc_response` using `INVOKE_KEY`. Cover: the three window commands from
  `main` succeed (`toggle` returns a bool); the same commands from `quick-note`
  return `{"code":"invalid_window"}`; `request_quit`, `cancel_quit`, and
  `confirm_quit` from `quick-note` return `{"code":"unauthorized_window"}`,
  record zero runtime calls, and create no pending request; `request_quit` from
  `main` with a `2/1/3/0` summary returns a camelCase
  `{ requestId, summary: { sessionCount, projectCount, runningProcessCount,
  unsavedFileCount } }`; a repeated `request_quit` reuses the id and performs
  no second snapshot; `apply_close_requested` on `main` returns `HideToTray`
  while preserving the pending id and on `quick-note` returns `AllowClose`;
  `cancel_quit` rejects id `0` and stale ids and clears a valid request.

- [ ] **Step 2: Verify the tests fail for the expected reason** _(skipped; see
  Deviations)_

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_lifecycle`

  Expected: compilation fails on the unresolved commands,
  `CloseDecision`, `apply_close_requested`, and
  `configure_with_lifecycle_for_tests`.

- [x] **Step 3: Implement the commands and test composition**

  Implement the six thin commands (async where specified), the shared close
  decision, the invoke-handler factory, and the isolated composition entry.
  `confirm_quit` must call `begin_confirm_quit`, await `finish_shutdown`, and
  only then call `app.exit(0)` on the success tail (never reached by
  mock-runtime tests; see Deviations).

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_lifecycle`

  Expected: all command, authorization, payload, and close-decision cases pass
  without touching real app data and without reaching `app.exit`.

### Task 6: Tray Dispatch and Quit-Flow Integration

**Outcome:** Tray dispatch implements open/session/quit actions without
blocking native callbacks, and integration tests cover event payloads, targets,
menu resolution, and the confirm failure path through the public seams.

**Depends On:** Tasks 3, 4, and 5

**Files:**

- Modify: `src-tauri/src/app/tray.rs`
- Modify: `src-tauri/tests/app_lifecycle.rs`

**Interfaces:**

- Consumes: `AppLifecycleState` (via `Manager::state`), `AppRuntime`,
  `platform::window` adapter, tray model, and event names `app-quit-requested`
  and `app-navigate-session`.
- Produces: `#[doc(hidden)] pub fn tray_open<R: Runtime>(app: &AppHandle<R>) ->
  Result<(), AppLifecycleError>`; `#[doc(hidden)] pub async fn tray_quit<R:
  Runtime>(app: &AppHandle<R>) -> Result<TrayQuitOutcome, AppLifecycleError>`
  with `TrayQuitOutcome { DialogShown(QuitRequestDto), ReadyToExit }`;
  `#[doc(hidden)] pub async fn tray_select_session<R: Runtime>(app:
  &AppHandle<R>, menu_id: &str) -> Result<bool, AppLifecycleError>` (false
  means the id was stale and the menu was refreshed without navigation).

Dispatch behavior: `tray_open` shows/unminimizes/focuses `main`
(`MainWindowUnavailable` when absent); `tray_quit` with sessions shows `main`
 first and emits one `app-quit-requested` payload (reusing the pending id), or
runs the shutdown state machine and reports `ReadyToExit` for zero sessions —
the native caller performs the exit; `tray_select_session` re-queries the
adapter's attention list, shows/unminimizes `main` with best-effort focus, and
emits `app-navigate-session` exactly once for a valid id. Native menu/tray
callbacks only schedule these async tasks.

- [x] **Step 1: Add the failing dispatch and quit-flow tests**

  In `app_lifecycle.rs` with fixture attention sessions (including six entries
  to exercise the cap): a listener on the `main` webview receives exactly one
  `app-quit-requested` with the pending payload after `tray_quit`, and the
  `quick-note` webview receives nothing; zero-session `tray_quit` reaches
  `ReadyToExit` without emitting; a valid session id emits
  `{ sessionId }` once and returns true; an unknown id returns false and emits
  nothing; `tray_open` without a `main` window returns `MainWindowUnavailable`;
  and `confirm_quit` with a failing shutdown double returns
  `{"code":"runtime_shutdown_failed"}`, restores the same pending id, and keeps
  the process running.

- [ ] **Step 2: Verify the tests fail for the expected reason** _(skipped; see
  Deviations)_

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_lifecycle`

  Expected: compilation fails on the unresolved `tray_open`, `tray_quit`,
  `TrayQuitOutcome`, and `tray_select_session`.

- [x] **Step 3: Implement the minimum dispatch**

  Implement the three dispatch functions against the state machine and adapter,
  mapping event failures to `EventDeliveryFailed` and keeping the pending
  request when emission fails so a later activation can retry. Add the native
  task-scheduling helper used by Task 7's menu callbacks.

- [x] **Step 4: Verify the task**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_lifecycle`

  Expected: all dispatch, event, and confirm-failure cases pass.

### Task 7: Production Composition Root and Windows Verification

**Outcome:** The production `configure` registers the single-instance plugin
first, initializes storage before lifecycle state and tray, attaches the native
tray, wires commands and the close handler, and the desktop build plus manual
smoke checklist verify the native behaviors.

**Depends On:** Tasks 5 and 6

**Files:**

- Modify: `src-tauri/src/app/mod.rs`
- Modify: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: `tauri_plugin_single_instance::init`, `tray::attach_native_tray`,
  the shared setup pipeline from Task 5, `TrayIconBuilder`, and Tauri menu APIs.
- Produces: the production `app::configure` composition (plugin-first, then
  storage → lifecycle state → native tray, invoke handler, close handler);
  `pub(crate) fn attach_native_tray<R: Runtime>(app: &AppHandle<R>) ->
  Result<(), AppLifecycleError>` in `app/tray.rs` using the existing
  `icons/icon.ico` through `default_window_icon` and mapping icon/menu failures
  to `TrayOperationFailed`; no new command, event, permission, or config field.

The single-instance callback ignores argv/cwd, never logs them, and brings
`main` to front with show → unminimize → focus, keeping the current route. The
native menu is built from the tray model, uses backend-owned menu IDs, handles
open/quit/session by scheduling the Task 6 dispatch tasks (no blocking or
awaiting inside callbacks), and tray startup failure stops application startup.

- [x] **Step 1: Extend the composition tests first**

  In `app_builder.rs`, route lifecycle assertions through
  `configure_with_lifecycle_for_tests` with a recording tray seam whose closure
  asserts `Storage` and `AppLifecycleState` are already managed before tray
  attachment, proving the storage → state → tray order; keep the existing
  storage failure tests unchanged; and add one mock-runtime case that invokes
  `minimize_main_window` through `tauri::test::get_ipc_response` to prove the
  invoke handler is registered and routable.

- [ ] **Step 2: Verify the tests fail for the expected reason** _(skipped; see
  Deviations)_

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder`

  Expected: the new tests fail because `attach_native_tray` and the
  production plugin-first/tray composition do not exist yet.

- [x] **Step 3: Implement the production composition**

  Implement `attach_native_tray` and update `configure` to register the plugin
  first and delegate to the shared setup pipeline with
  `attach_native_tray` and `EmptyAppRuntime`. Keep
  `configure_with_app_data_dir` behavior unchanged for the existing storage
  tests, and do not modify `tauri.conf.json` or
  `src-tauri/capabilities/main.json`.

- [x] **Step 4: Verify the task**

  Run:
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder`
  - `git diff --exit-code -- src-tauri/capabilities/main.json
    src-tauri/tauri.conf.json`
  - `pnpm tauri build --no-bundle`

  Expected: composition tests pass; the capability and config files are
  unchanged; the Windows Tauri build succeeds (the pre-existing
  `com.xwork.app` identifier warning may remain).

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format/lint | `pnpm format:check && pnpm lint` | Pass with no diagnostics; generated bindings excluded by the `biome.json` override |
| Frontend type check | `pnpm typecheck` | No type errors, including `src/bindings/app-lifecycle.ts` |
| Frontend tests | `pnpm test` | All existing frontend tests still pass |
| Rustfmt | `pnpm format:rust` | No formatting diff |
| Clippy | `pnpm lint:rust` | Pass with warnings denied |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | All lifecycle unit, integration, composition, and binding tests pass |
| Windows Tauri build | `pnpm tauri build --no-bundle` | Build succeeds (runs the frontend production build via `beforeBuildCommand`); only the known identifier warning may appear |
| Capability/config | `git diff --exit-code -- src-tauri/capabilities/main.json src-tauri/tauri.conf.json` | No changes |
| Manual desktop smoke | Checklist below | Every item passes on Windows with the real executable |

Manual Windows smoke checklist (run the built `xwork.exe`):

1. Launch XWork; close the window with the native close control and confirm it
   hides to tray while the process keeps running.
2. Use tray `Open XWork` to restore the window (show, unminimize, focus).
3. Launch the executable a second time while the first instance runs; confirm
   no second application starts and the existing window comes to the front
   without resetting route.
4. Confirm the Phase 1 tray menu shows only `Open XWork` and `Quit XWork` with
   the expected separators and native icon.
5. Choose `Quit XWork` with no sessions; confirm it exits without a dialog and
   the next launch starts fresh at Home without restoring sessions.

The quit-confirmation dialog with non-zero sessions cannot be exercised with
real runtime sessions until `BE-005`/`FE-001`; its behavior is covered by the
automated double-based tests above and must be revisited in the Stage 3
frontend slice.

## Deviations and Decisions

The following deviations from a literal reading of `BE-001` are required by
Tauri 2.11.5 realities or the mock-runtime test boundary and are recorded here
before implementation:

- **`AppRuntime` visibility:** `BE-001` marks the internal contract
  `pub(crate)`, but `src-tauri/tests/` binaries are separate crates that must
  implement runtime doubles and name the injected state. The contract
  (`AppRuntimeFuture`, `AppRuntime`, `AttentionSession`, `AppLifecycleState`)
  and the doc-hidden test seams (`CloseDecision`, `apply_close_requested`,
  tray dispatch functions, `configure_with_lifecycle_for_tests`) are therefore
  `#[doc(hidden)] pub`. Commands stay crate-internal and no serialized
  contract changes.
- **Single-instance plugin in tests:** the plugin's Windows setup acquires an
  OS mutex keyed by `com.xwork.app` and terminates secondary processes, so it
  cannot run hermetically under `cargo test` (and would kill the test binary
  whenever the real app is running). It is registered first only on the
  production `configure` path and verified by the smoke checklist.
- **`app.exit(0)` in tests:** `AppHandle::exit` on `MockRuntime` panics inside
  `request_exit`, so successful-confirm and `ReadyToExit` outcomes stop at the
  exit-ready state in automated tests; only production tails call `app.exit`.
- **Native tray in tests:** tray icon/menu creation needs an interactive
  desktop. Automated tests assert storage-before-tray ordering with a recording
  tray seam and cover the model/dispatch logic; native behavior is verified by
  the Windows build and smoke checklist.
- **Storage close:** `BE-002` defines no close API, so Phase 1 relies on the
  existing connection drop semantics at process exit; no `Storage` method is
  added.
- **`WindowOperation` location:** the enum is defined in `platform::window`
  (where per-operation mapping is tested) and re-exported by `app::lifecycle`,
  keeping `platform` free of `app` dependencies while `lifecycle` remains the
  public error surface.
- **Logging:** no logging dependency exists yet. Native adapter/tray failure
  sites report only an error category through `eprintln!` and never log argv,
  cwd, project/session names, or payloads; the future logging capability
  replaces these sites.
- **Concurrent snapshots:** the implementation uses a transient internal
  `Snapshotting` phase while the lifecycle mutex is released for
  `quit_summary().await`. A competing Quit entry receives
  `QuitAlreadyInProgress`; once the snapshot completes, later entry points
  reuse the resulting pending request as specified.
- **Targeted events:** lifecycle tray events use `AppHandle::emit_to("main",
  ...)`. Tauri's general `emit` is broadcast-oriented even when called through
  a window handle; the integration test proved that `emit_to` is required to
  keep `quick-note` from observing main-only lifecycle events.
- **`ts-rs` export configuration:** `ts-rs` 12.0.1 requires a `&Config`
  argument for `export_to_string`. The binding test therefore supplies
  `Config::default()` and assigns every lifecycle contract type the same
  `app-lifecycle.ts` export path so concatenation produces no invalid
  cross-file imports.
- **Historical red checks:** implementation began from the approved contract
  in one dependency-coherent pass before each task's planned red command was
  isolated. The binding generator did produce its intended stale-output red
  result, and a targeted-event test caught and drove the `emit_to` correction,
  but the remaining exact missing-symbol red states were not recreated after
  implementation. They are left unchecked above; all focused and final green
  commands were run.

During implementation, append material deviations and decisions here without
rewriting completed history.

## Outcome

Implemented the six lifecycle commands, exact-window authorization, async Quit
state machine, empty Phase 1 runtime adapter, native main-window adapter,
single-instance activation, close-to-tray handling, deterministic tray model,
native tray dispatch, and the two main-only lifecycle events. Generated the
single TypeScript contract file from Rust and kept the capability/config files
unchanged.

Automated verification completed successfully on Windows:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (1
  frontend test).
- `pnpm format:rust` and `pnpm lint:rust` with warnings denied.
- `cargo test --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features` (48 Rust tests across unit, integration, composition,
  storage, and binding targets).
- `cargo metadata --manifest-path src-tauri/Cargo.toml --locked --no-deps`.
- `git diff --exit-code -- src-tauri/capabilities/main.json
  src-tauri/tauri.conf.json`.
- `pnpm tauri build --no-bundle`, producing
  `src-tauri/target/release/xwork.exe`. The pre-existing warning about the
  `.app` identifier suffix remains.

Remaining limitation: the five-item manual Windows desktop smoke checklist
requires visual interaction with the real tray/window and remains pending. The
non-zero-session dialog still depends on the later `BE-005`/`FE-001` slice, as
already documented; its backend behavior is covered by runtime doubles here.
