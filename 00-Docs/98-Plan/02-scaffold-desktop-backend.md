# Phase 2 — Desktop and Backend Scaffold Implementation Plan

**Status:** Implemented — local verification complete; historical red checks
skipped; remote desktop CI remediation pending verification

**Goal:** Wrap the existing frontend SPA in a minimal Tauri 2 desktop runtime,
establish a testable Rust composition root, and make the Windows desktop build
and smoke test reproducible locally and in GitHub Actions.

**Completion Criteria:**

- `pnpm tauri dev` opens the existing route `/` in a native window and renders
  the accessible “XWork” application shell without browser-console, CSP, Vite,
  or Rust startup errors.
- The desktop crate uses Rust 1.98.0 stable with Edition 2024, keeps the binary
  entry point thin, and composes the Tauri application from
  `src-tauri/src/app/`.
- The `main` window has an explicit capability with no product or OS-access
  permissions, and production/development CSPs expose only the sources needed
  by the existing SPA, Tauri IPC bootstrap, WebAssembly, and Vite HMR.
- A Rust integration test proves that the composition root builds with Tauri's
  mock runtime, and a WebdriverIO smoke test proves that the built Windows
  executable renders the existing shell through the real desktop runtime.
- Every direct npm and Cargo dependency is pinned or locked according to the
  project version policy; `pnpm-lock.yaml` and `src-tauri/Cargo.lock` are
  committed.
- Frontend gates, E2E type checking, Rustfmt, Clippy with warnings denied, Rust
  tests, the desktop smoke test, and `pnpm tauri build --no-bundle` all pass on
  Windows locally and in GitHub Actions.

**Architecture:** `src-tauri/src/main.rs` delegates immediately to the library
entry point, while `src-tauri/src/lib.rs` supplies the real Tauri runtime and
`src-tauri/src/app/` owns builder composition. The scaffold registers no
command, event, plugin, managed business state, persistence, or product
capability. The existing React SPA remains presentation-only and is loaded from
Vite in development and `dist/` in a production build.

The desktop smoke test drives the compiled Windows executable through
WebdriverIO's Tauri service and the official external `tauri-driver`. It uses
only standard DOM operations, so the scaffold does not add the WDIO execute,
mocking, logging, or embedded-WebDriver plugins to the application binary.

**Tech Stack:** Rust 1.98.0 stable, Cargo 1.98.0, Rust Edition 2024, Tauri core
2.11.5, Tauri CLI 2.11.x, Node.js 24 LTS, pnpm 11.25.0, Vite 8.2.2,
WebdriverIO 9.31.x, `@wdio/tauri-service`, and `tauri-driver` 2.0.6.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Phase 2 desktop/backend scaffold
  section
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Product scope and platform constraints:
  `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections 1–2
- Plan rules: `PLANS.md`
- Tauri Vite integration: <https://v2.tauri.app/start/frontend/vite/>
- Tauri capabilities: <https://v2.tauri.app/security/capabilities/>
- Tauri CSP: <https://v2.tauri.app/security/csp/>
- Tauri WebDriver testing: <https://v2.tauri.app/develop/tests/webdriver/>

No `FE-NNN` specification, `BE-NNN` specification, or wireframe applies to this
plan because the scaffold does not implement a product feature, backend
capability, or new interface.

## Scope

**In Scope:**

- A stable Rust 1.98.0 toolchain file with Rustfmt and Clippy components.
- A single Tauri desktop crate under `src-tauri/`, with exact direct dependency
  versions, a committed Cargo lockfile, and Rust Edition 2024.
- Tauri CLI and WebdriverIO development dependencies added to the existing root
  npm package with exact versions and a committed pnpm lockfile.
- Root package scripts for Tauri, E2E type checking, Rustfmt, Clippy, Rust tests,
  and the desktop smoke test; existing frontend script semantics remain
  unchanged.
- A thin binary entry point, library entry point, minimal composition root, and
  one Rust integration test through the public library boundary.
- Tauri configuration for product name `XWork`, application identifier
  `com.xwork.app`, version `0.0.0`, the `main` window, Vite development URL,
  production frontend bundle, explicit capabilities, and CSP.
- Vite settings required by Tauri development: fixed port `5173`, strict port
  selection, visible Rust errors, and exclusion of `src-tauri/` from the
  frontend file watcher.
- A `main`-window capability that grants no core, plugin, filesystem, shell,
  dialog, process, persistence, or business permission.
- A Windows-only WebdriverIO configuration and smoke scenario that launches the
  compiled Tauri executable and asserts that the “XWork” main landmark and
  heading are visible.
- A separate Windows GitHub Actions workflow for E2E type checking, Rust gates,
  a non-bundled Tauri production build, and the desktop smoke test. The existing
  `frontend-ci` workflow continues to own frontend gates.
- Ignore and formatter scope updates only for artifacts and source introduced
  by this phase.

**Out of Scope:**

- Any behavior, UI, route, state, or component from `FE-001` through `FE-023`.
- Any command, event, Channel, DTO, generated binding, IPC wrapper, mock IPC
  runtime, or frontend dependency on a Tauri JavaScript API.
- `BE-001`, `BE-002`, or any other backend feature specification.
- Business capability directories, SQLite, migrations, Tokio, Serde, ts-rs,
  logging, tray behavior, single-instance behavior, plugins, or OS adapters.
- `src/features/`, `src/lib/ipc/`, `src/bindings/`, `src-tauri/migrations/`,
  `src-tauri/src/storage/`, `src-tauri/src/platform/`, and
  `src-tauri/src/shared/` without a consumer.
- WDIO command mocking, `browser.tauri.execute()`, backend-log forwarding, the
  embedded WebDriver server, and their Tauri plugins.
- Installer generation, application branding/icon design, code signing,
  updater configuration, release artifacts, GitHub Releases, or deployment.
- macOS configuration validation or E2E execution before release preparation.
- Mobile targets, remote content, a local HTTP backend, telemetry, or cloud
  services.

## Global Constraints

- Use Tauri 2.11.5 and stable Rust 1.98.0 with Edition 2024; pin the toolchain in
  `rust-toolchain.toml` and commit `src-tauri/Cargo.lock`.
- Keep packages in the Tauri 2.11 compatible line, and do not use a version
  override or force installation to hide a peer-dependency mismatch.
- Add dependencies only when this phase has a direct consumer. In particular,
  do not add Tokio, Serde, ts-rs, SQLite, official Tauri product plugins, or any
  later backend capability dependency.
- React owns presentation and temporary UI state. Rust owns OS access,
  persistence, terminal processes, and business rules when those behaviors are
  implemented in later phases.
- The frontend must not directly access the filesystem, database, shell, child
  processes, credential store, or a general-purpose Tauri plugin API.
- `src-tauri/src/app/` is the desktop composition root. The binary entry point
  must not accumulate application setup or business behavior.
- Tauri capabilities are attached to a specific window or webview and grant
  only permissions consumed by that surface. Do not use wildcard windows,
  wildcard permissions, or `core:default` in this scaffold.
- Keep CSP enabled. Production CSP must default to local content, allow Tauri's
  IPC transport, and include `'wasm-unsafe-eval'` in `script-src`; development
  CSP may additionally allow only the local Vite origin, its HMR WebSocket, and
  inline styles injected by the development server.
- Do not disable Tauri's asset CSP modification and do not allow remote scripts,
  remote styles, `unsafe-eval`, arbitrary network origins, `asset:` URLs, or
  blob URLs without a demonstrated consumer.
- Tauri development must use the existing Vite scripts and fixed port `5173`;
  production must load the existing `dist/` output.
- The desktop E2E smoke test must use the real built Tauri executable. Browser
  mode is not sufficient for this phase's completion criteria.
- Every added function, callback, test, and helper must have a short purpose
  comment that does not restate obvious behavior.
- Rust unit tests belong in their module; integration tests through the public
  backend boundary belong in `src-tauri/tests/`; desktop E2E scenarios belong
  in `tests/e2e/`.
- Run normal development and CI verification only on Windows. Defer macOS
  validation until release preparation.

## Assumptions, Risks, and Blockers

**Assumptions:**

- The application identifier is `com.xwork.app`, as confirmed for this plan.
  Treat it as stable because changing it later can change platform application
  identity and data locations.
- The scaffold version remains `0.0.0`, matching the existing root
  `package.json`; release versioning is deferred.
- The single window label is `main` and its title is `XWork`. Window dimensions
  and lifecycle behavior remain Tauri defaults until `FE-001` and `BE-001`
  define consumers.
- The current SPA needs no core or plugin command from JavaScript, so an empty
  permission list is the minimum valid `main` capability.
- Production frontend assets need only local script, style, font, image, and
  Tauri IPC sources. The `'wasm-unsafe-eval'` script source is included now
  because it is an explicit project-wide Tauri CSP requirement for the later
  terminal renderer.
- WebdriverIO 9.31.x support packages and the current compatible
  `@wdio/tauri-service` release are installed with exact versions and locked in
  `pnpm-lock.yaml`. At plan creation, the service is `1.3.0`; its independent
  major version does not need to match WebdriverIO's major version.
- `tauri-driver` 2.0.6 and Microsoft Edge WebDriver can drive the Tauri WebView2
  application on Windows. The service manages the matching EdgeDriver, while
  local setup and CI install the exact `tauri-driver` version with Cargo.
- `pnpm tauri build --no-bundle` is the Phase 2 Windows Tauri build gate. It
  proves the production executable and frontend-backend packaging boundary
  without pulling installer branding and release distribution into this phase.

**Risks:**

- Tauri core, CLI, build crate, and JavaScript CLI have independent patch
  releases. Task 1 pins exact compatible versions, verifies the dependency
  graph, and stops instead of changing the documented Tauri 2.11.5 target if
  compatibility cannot be demonstrated.
- A permissive generated capability or `csp: null` would create an unnecessary
  attack surface. Task 3 replaces generator defaults with an explicit empty
  `main` capability and separate production/development CSPs, then verifies both
  desktop modes without CSP violations.
- An unconstrained Vite port can make Tauri connect to another process or fail
  nondeterministically. Task 3 fixes port `5173` and enables `strictPort`.
- WebDriver infrastructure can accidentally introduce test-only command or HTTP
  surfaces into production. Task 2 uses the official external driver and basic
  DOM operations; no WDIO Tauri plugin is linked into the application.
- Windows E2E can fail when `tauri-driver`, EdgeDriver, or the compiled binary
  is missing. Tasks 1–2 pin the driver prerequisite and binary path, and Task 4
  reproduces the full build-before-test order from a clean Windows checkout.
- The mock runtime APIs are marked unstable by Tauri. Pinning Tauri 2.11.5 and
  keeping the integration test limited to builder construction reduces the
  maintenance surface.
- Running the desktop build twice in CI would add substantial latency. Task 4
  builds one release executable with `--no-bundle` and reuses that exact binary
  for the smoke test.

**Blockers:** None.

Do not begin implementation if the empty capability is rejected by the pinned
Tauri schema, the documented CSP cannot run both Vite and the production
bundle, or the pinned WebdriverIO/Tauri service peer graph does not install
cleanly. Resolve the documented contract first; do not broaden permissions,
disable CSP, or force dependency resolution as a workaround.

## Dependency Order

1. Task 1 pins the Rust, Tauri, and desktop-test toolchains and defines shared
   commands → enables tests and implementation to run reproducibly.
2. Task 2 adds the Rust and desktop smoke contracts and proves they are red for
   the missing composition root and executable → defines the minimum behavior
   Task 3 must implement.
3. Task 3 creates the desktop runtime, security boundary, and Vite integration
   → makes the Rust and real-runtime smoke tests pass.
4. Task 4 runs the same gates from a clean Windows checkout → proves the
   scaffold is reproducible outside the development machine.

---

### Task 1: Pin the Desktop Toolchains and Command Contract

**Outcome:** The repository installs one reproducible Rust/Tauri/WebdriverIO
toolchain and exposes explicit commands for every local desktop gate.

**Depends On:** None

**Files:**

- Create: `rust-toolchain.toml`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/Cargo.lock`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Node.js 24 LTS and pnpm 11.25.0 from the existing frontend;
  Rust/Cargo 1.98.0, Tauri core 2.11.5, Tauri CLI 2.11.x, WebdriverIO 9.31.x,
  and `tauri-driver` 2.0.6 from the tech stack and official test setup.
- Produces: the `tauri`, `typecheck:e2e`, `format:rust`, `lint:rust`,
  `test:rust`, and `test:e2e` package scripts; crate names `xwork` and
  `xwork_lib`; exact npm and Cargo dependency graphs; ignored
  `src-tauri/target/` build output.

- [x] **Step 1: Pin the Rust toolchain**

  Create `rust-toolchain.toml` with stable channel `1.98.0`, the minimal
  profile, and the `rustfmt` and `clippy` components. Do not add cross-platform
  targets or nightly components.

- [x] **Step 2: Define the minimal desktop crate manifest**

  Create a private desktop package named `xwork`, version `0.0.0`, using
  Edition 2024 and `build.rs`. Define the library as `xwork_lib` and the binary
  as `xwork`. Add only exact compatible `tauri` and `tauri-build` dependencies;
  enable Tauri's `test` feature only for test builds.

  Do not add Tokio, Serde, plugins, persistence crates, feature flags for future
  capabilities, workspace crates, or release-profile tuning.

- [x] **Step 3: Install the exact root development dependencies**

  Add `@tauri-apps/cli` from the Tauri 2.11 line and the minimal WebdriverIO
  runner, globals, Mocha framework, spec reporter, types, `webdriverio`, and
  `@wdio/tauri-service` packages with `--save-dev --save-exact`. Keep all
  WebdriverIO packages in the documented 9.31.x line and lock the compatible
  Tauri service release.

  Add the package scripts listed under **Interfaces**. Each Rust script invokes
  Cargo with `--manifest-path src-tauri/Cargo.toml`; Clippy covers all targets
  and features and ends with `-- -D warnings`.

- [x] **Step 4: Generate lockfiles and ignore only new build output**

  Generate `src-tauri/Cargo.lock` and update `pnpm-lock.yaml`. Add
  `src-tauri/target/` to `.gitignore`; preserve all existing patterns and do not
  ignore source, capability schemas intended for review, test files, or
  lockfiles.

- [x] **Step 5: Verify the dependency and command contract**

  Run: `rustc --version && cargo --version && cargo fmt --version && cargo clippy --version`

  Expected: every command reports the Rust 1.98.0 toolchain selected by
  `rust-toolchain.toml`.

  Run: `pnpm install --frozen-lockfile`

  Expected: installation succeeds without changing `pnpm-lock.yaml` and without
  a peer-dependency warning or error.

  Run: `pnpm list --depth 0`

  Expected: Tauri CLI and the required E2E packages appear at exact compatible
  versions, no product dependency was added, and all Phase 1 dependencies remain
  unchanged.

  Run: `cargo metadata --manifest-path src-tauri/Cargo.toml --locked --no-deps`

  Expected: Cargo resolves one package with library `xwork_lib`, binary `xwork`,
  Edition 2024, and no product capability dependency.

---

### Task 2: Define the Missing Desktop Behavior with Focused Tests

**Outcome:** Focused tests define the public Rust composition boundary and the
real desktop rendering requirement, and both fail only because the scaffold
implementation or executable is absent.

**Depends On:** Task 1

**Files:**

- Create: `src-tauri/tests/app_builder.rs`
- Create: `tests/e2e/tsconfig.json`
- Create: `tests/e2e/wdio.conf.ts`
- Create: `tests/e2e/app-smoke.e2e.ts`
- Modify: `biome.json`

**Interfaces:**

- Consumes: crate name `xwork_lib`, the root scripts and dependencies from Task
  1, and the existing accessible “XWork” shell contract at route `/`.
- Produces: public Rust function contract
  `app::configure<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R>`;
  a WebdriverIO configuration targeting
  `src-tauri/target/release/xwork.exe` through the official driver provider; one
  desktop smoke scenario; E2E TypeScript coverage in the frontend formatter and
  linter scope.

- [x] **Step 1: Add the failing Rust composition-root test**

  Create an integration test that passes `tauri::test::mock_builder()` through
  `xwork_lib::app::configure`, builds it with a mock context and no-op assets,
  and asserts that construction succeeds. Add a short purpose comment above the
  test callback.

- [ ] **Step 2: Verify the Rust test fails for the expected reason** _(skipped;
      see Deviations and Decisions)_

  Run: `pnpm test:rust -- app_builder`

  Expected: the test fails because the `xwork_lib` target or public
  `app::configure` composition root does not exist; it must not fail from an
  unavailable Rust component or dependency-resolution error.

- [x] **Step 3: Configure the smallest Windows desktop test runner**

  Create a dedicated strict TypeScript config for `tests/e2e/`. Configure one
  local WebdriverIO worker, the Mocha framework, the spec reporter, the Tauri
  service's official external driver provider, and the fixed release executable
  path. Keep timeouts finite and sufficient for a cold Windows application
  start. Do not enable browser mode, retries that hide deterministic failures,
  multiremote, screenshots, video, cloud services, WDIO mocking, or an embedded
  driver.

  Extend Biome's explicit file scope only enough to format and lint the E2E
  TypeScript/config files plus the hand-written Tauri JSON configuration added
  by Task 3. Do not include generated Tauri schemas or Cargo build output.

- [x] **Step 4: Add the failing real-runtime smoke scenario**

  Add one scenario that waits for the existing `main` landmark and “XWork”
  heading, then asserts both are displayed. Use only standard WebDriver DOM
  operations. Add short purpose comments above every suite/test callback and
  any helper or hook.

- [ ] **Step 5: Verify E2E static checks pass and runtime is red** _(skipped; see
      Deviations and Decisions)_

  Run: `pnpm typecheck:e2e`

  Expected: the WDIO configuration and smoke scenario compile without type
  errors.

  Run: `pnpm format:check && pnpm lint`

  Expected: the new E2E files pass the existing frontend formatter and linter
  without changing existing frontend behavior.

  Run: `pnpm test:e2e`

  Expected: WebdriverIO fails because
  `src-tauri/target/release/xwork.exe` does not exist; it must not fail from a
  TypeScript error, missing WDIO service, or invalid configuration.

---

### Task 3: Implement the Minimal Secure Tauri Runtime

**Outcome:** The existing SPA runs unchanged in development and production
Tauri executables behind an explicit minimal capability and CSP, and the Rust
and desktop smoke tests pass.

**Depends On:** Task 2

**Files:**

- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/main.json`
- Create: `src-tauri/src/app/mod.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/main.rs`
- Modify: `vite.config.ts`
- Modify: `src-tauri/Cargo.lock`
- Test: `src-tauri/tests/app_builder.rs`
- Test: `tests/e2e/app-smoke.e2e.ts`

**Interfaces:**

- Consumes: `pnpm dev`, `pnpm build`, Vite port `5173`, frontend output `dist/`,
  `app::configure` from Task 2, and the existing route `/` shell.
- Produces: `xwork_lib::run()` as the desktop library entry;
  `app::configure<R: tauri::Runtime>(Builder<R>) -> Builder<R>` as the testable
  composition boundary; application identifier `com.xwork.app`; window label
  `main`; a named `main` capability with no granted permissions; development
  and production CSPs; Windows release executable
  `src-tauri/target/release/xwork.exe`.

- [x] **Step 1: Create the build and entry-point skeleton**

  Add a minimal `build.rs` that invokes `tauri_build::build`. Add a thin
  `src-tauri/src/main.rs` that delegates immediately to `xwork_lib::run`.
  `src-tauri/src/lib.rs` supplies `tauri::Builder::default()` and the generated
  context, calls `app::configure`, and runs the application with a specific
  startup-error message.

  Implement `app::configure` as the only composition root. In this phase it
  returns the supplied builder without registering commands, events, plugins,
  managed state, setup callbacks, tray behavior, or product capabilities. Keep
  it generic over `tauri::Runtime` so the integration test uses the same
  composition path as production.

- [x] **Step 2: Configure the desktop application and frontend build**

  Create `tauri.conf.json` using schema version 2 with product name `XWork`,
  version `0.0.0`, identifier `com.xwork.app`, and one `main` window titled
  `XWork`. Use `pnpm dev` as `beforeDevCommand`, `pnpm build` as
  `beforeBuildCommand`, `http://localhost:5173` as `devUrl`, and `../dist` as
  `frontendDist`.

  Modify Vite only to keep output visible, reserve port `5173` with
  `strictPort: true`, and ignore `src-tauri/**` in the dev-server watcher. Do
  not add mobile-host logic, proxy rules, a second entry point, or frontend
  access to Tauri APIs.

- [x] **Step 3: Establish the minimum capability boundary**

  Create one capability file for the `main` window and reference its identifier
  explicitly from `tauri.conf.json`. Its permissions list is empty because the
  current frontend consumes no core, application, or plugin command. Do not use
  `core:default`, a wildcard window, remote URLs, or an OS-access permission.

  Validate the file through the generated Tauri desktop schema/build. If the
  pinned schema rejects an empty permissions array, stop and document the exact
  schema constraint before selecting the smallest individual core permission;
  do not silently fall back to `core:default`.

- [x] **Step 4: Add separate production and development CSPs**

  Configure production `csp` with local-only defaults, explicit Tauri IPC
  transport, local scripts/styles/fonts/images, and
  `script-src 'self' 'wasm-unsafe-eval'`. Configure `devCsp` with the same
  boundary plus only the local Vite origin/HMR WebSocket and the inline styles
  Vite injects during development.

  Keep Tauri's compile-time nonce/hash modification enabled. Do not add remote
  origins, `unsafe-eval`, a general `http:`/`https:`/`ws:` source, asset
  protocol access, or a plugin permission.

- [x] **Step 5: Make the Rust test and gates pass**

  Run: `pnpm format:rust`

  Expected: Rustfmt reports no diff.

  Run: `pnpm lint:rust`

  Expected: every library, binary, build-script, integration-test, and feature
  target passes Clippy with warnings denied.

  Run: `pnpm test:rust`

  Expected: the mock-runtime composition-root integration test passes and no
  test target fails.

- [x] **Step 6: Build once and run the real desktop smoke test**

  Run: `pnpm tauri build --no-bundle`

  Expected: Tauri invokes the existing frontend production build and creates
  `src-tauri/target/release/xwork.exe` without CSP, capability-schema, Cargo, or
  frontend errors; no installer or release artifact is produced.

  Run: `pnpm test:e2e`

  Expected: WebdriverIO launches that release executable, the smoke scenario
  finds the visible “XWork” main landmark and heading, no browser or backend
  startup error is reported, and the runner closes the application and driver
  processes after the test.

- [x] **Step 7: Smoke-test the development runtime on Windows**

  Run: `pnpm tauri dev`

  Expected: Vite binds exactly to port `5173`, a native window titled `XWork`
  renders the existing shell at route `/`, HMR connects, and the frontend and
  Rust consoles contain no CSP or startup errors. Stopping the command closes
  the app, Vite server, and child processes and releases port `5173`.

  Inspect the diff after both smoke tests. It must contain no product feature,
  command, event, DTO, binding, IPC wrapper, plugin, migration, database,
  business capability directory, installer, or release configuration.

---

### Task 4: Add Desktop Quality Gates to Windows CI

**Outcome:** A clean Windows GitHub Actions checkout automatically blocks
desktop changes that fail E2E type checking, Rust quality gates, the Tauri
production build, or the real-runtime smoke scenario.

**Depends On:** Task 3

**Files:**

- Create: `.github/workflows/desktop-ci.yml`

**Interfaces:**

- Consumes: `rust-toolchain.toml`, both lockfiles, the package scripts from Task
  1, `tauri-driver` 2.0.6, and the release binary/test configuration from Tasks
  2–3.
- Produces: the Windows `desktop-ci` workflow and one desktop quality-gate job;
  together with the existing `frontend-ci` workflow, the complete Phase 2 CI
  contract.

- [x] **Step 1: Create the minimal Windows desktop workflow**

  Run on `windows-latest` for `push` and `pull_request` with read-only repository
  permissions. Check out the source, install pnpm 11.25.0 and Node.js 24 with
  pnpm caching, allow `rust-toolchain.toml` to select/install Rust 1.98.0, and
  install dependencies with `pnpm install --frozen-lockfile`.

  Install `tauri-driver` 2.0.6 with Cargo's `--locked` option. Run E2E type
  checking, Rustfmt, Clippy, Rust tests, one
  `pnpm tauri build --no-bundle`, and then the desktop smoke test in dependency
  order. Reuse the built release executable; do not start a second Tauri build.

  Do not add macOS/Linux matrices, signing credentials, write permissions,
  artifact upload, installer generation, deployment, retries, or
  `continue-on-error`.

- [x] **Step 2: Verify the workflow shares local commands and responsibilities**

  Review the YAML to ensure every gate invokes the root package scripts or the
  exact Tauri command already verified locally. The workflow must not duplicate
  the frontend formatter, linter, component tests, type check, or standalone
  Vite build owned by `.github/workflows/frontend-ci.yml`; both workflows are
  required checks for Phase 2.

  Run locally on Windows:

  `pnpm install --frozen-lockfile && pnpm typecheck:e2e && pnpm format:rust && pnpm lint:rust && pnpm test:rust && pnpm tauri build --no-bundle && pnpm test:e2e`

  Expected: the local command sequence corresponding to `desktop-ci` passes,
  reuses one release executable, and leaves no application, driver, or Vite
  process running.

- [ ] **Step 3: Verify both GitHub Actions workflows**

  After the change is available on GitHub, observe `frontend-ci` and
  `desktop-ci` from a clean checkout.

  Expected: `frontend-ci` passes the unchanged frontend gates. `desktop-ci`
  reports Rust 1.98.0, installs exact locked dependencies and driver, passes
  every Rust gate, builds the Windows executable once, launches it through
  WebdriverIO, and completes the desktop smoke scenario without elevated
  permissions or secrets.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Reproducible npm install | `pnpm install --frozen-lockfile` | Installation succeeds, the lockfile stays unchanged, and no peer mismatch appears |
| Frontend format | `pnpm format:check` | Existing frontend, E2E, and hand-written Tauri JSON files require no formatting |
| Frontend lint | `pnpm lint` | Existing frontend and E2E TypeScript pass without diagnostics |
| Frontend type check | `pnpm typecheck` | Existing SPA passes without type errors or emitted files |
| E2E type check | `pnpm typecheck:e2e` | WDIO configuration and smoke scenario pass strict type checking |
| Frontend tests | `pnpm test` | All existing unit/component tests pass |
| Frontend production build | `pnpm build` | Vite creates `dist/` successfully |
| Rustfmt | `pnpm format:rust` | Rustfmt reports no formatting diff |
| Clippy | `pnpm lint:rust` | All Rust targets and features pass with warnings denied |
| Rust tests | `pnpm test:rust` | The composition-root integration test and all Rust tests pass |
| Windows Tauri build | `pnpm tauri build --no-bundle` | One release `xwork.exe` is created from the production SPA without an installer |
| Desktop E2E smoke | `pnpm test:e2e` | The release executable renders the visible “XWork” shell and exits cleanly |
| Desktop development smoke | `pnpm tauri dev` | A native `XWork` window renders route `/`, HMR works, and no CSP/startup error appears |
| Frontend CI | GitHub Actions workflow `frontend-ci` | The existing clean Windows frontend job passes every gate |
| Desktop CI | GitHub Actions workflow `desktop-ci` | The clean Windows job passes E2E type checking, Rust gates, one Tauri build, and the desktop smoke test |

## Deviations and Decisions

- The application identifier is `com.xwork.app`, confirmed before this plan was
  written.
- The E2E scaffold uses WebdriverIO's Tauri service with the official external
  `tauri-driver` on Windows. Test-only Tauri WDIO plugins are deferred until a
  later test needs execute, IPC mocking, log forwarding, or macOS's embedded
  provider.
- Phase 2 verifies `pnpm tauri build --no-bundle`. Windows installers, icons,
  signing, updater configuration, and release artifacts remain in Phase 22.
- The existing `.github/workflows/frontend-ci.yml` remains focused on frontend
  gates. A separate `desktop-ci` workflow adds the Rust and real-runtime gates
  without rewriting completed Phase 1 history.
- The red-state checkpoints from Task 2 were not preserved as separate commits.
  The final Rust and desktop tests exercise the planned boundaries, and their
  passing states were verified after the implementation was present.
- Tauri CLI 2.11.4 is the published JavaScript CLI selected from the required
  2.11.x line. The independently versioned build crate is pinned to 2.6.3 and
  was verified against Tauri core 2.11.5 by Cargo, Clippy, tests, and both
  development and production desktop builds.
- pnpm 11.25.0 requires explicit lifecycle-script approval, so
  `pnpm-workspace.yaml` allows the existing Vite consumer `esbuild` and the
  WebdriverIO transitive packages `edgedriver` and `geckodriver` to run their
  install scripts.
- `@wdio/tauri-service` 1.3.0 declares `@wdio/globals` 9.29.1 even though its
  published runtime and type files do not import it. That unused dependency
  conflicts with the required WDIO 9.31 peer graph, so the locked pnpm config
  removes only that dependency. `pnpm peers check`, E2E type checking, and the
  real-runtime smoke test verify the resulting graph.
- `@wdio/native-core` 1.1.0 starts the external Windows driver through a shell,
  which leaves `tauri-driver` and EdgeDriver descendants behind when the shell
  exits. A locked package patch starts the executable directly; repeated smoke
  tests confirmed that no `xwork`, `tauri-driver`, or `msedgedriver` process
  remains.
- Tauri's Windows resource compiler requires an ICO even for `--no-bundle`.
  `src-tauri/icons/icon.ico` is therefore a neutral technical placeholder, not
  Phase 22 branding or installer work.
- Tauri's default `common-controls-v6` feature imports APIs unavailable without
  a version-6 Windows manifest. `tauri-build` links its resource only to normal
  binaries, so `build.rs` supplies the same manifest dependency to Rust test
  targets to let the mock-runtime integration test start on Windows.
- Tauri warns that the confirmed identifier `com.xwork.app` ends in `.app`.
  The identifier remains unchanged because this plan explicitly treats it as a
  stable product decision; macOS validation remains deferred.
- The local development smoke test ran in a non-interactive automation session.
  It opened a responsive native `XWork` window and Vite on port 5173 without
  startup or CSP errors; the harness required explicit cleanup after its
  non-PTY Ctrl+C did not propagate to the window process.
- The first remote desktop runs exposed two clean-runner differences. pnpm
  required explicit lifecycle approval for WebdriverIO's transitive driver
  packages, and EdgeDriver timed out while creating a session with WebView2's
  default profile. The E2E capability now assigns a unique temporary WebView2
  user-data folder per run to prevent stale profile locks; remote verification
  of that remediation remains pending.

During implementation, append every material deviation and decision instead of
rewriting completed history.

## Outcome

Implemented locally on Windows. The repository now contains the pinned Rust and
desktop JavaScript toolchains, a minimal Tauri composition root, explicit empty
`main` capability, separate production/development CSPs, Rust mock-runtime
coverage, a real-runtime WebdriverIO smoke test, and a dedicated `desktop-ci`
workflow. No product command, event, plugin, persistence layer, DTO, IPC wrapper,
or backend capability was added.

Local verification passed on 2026-09-02 with Node.js 24.19.0, pnpm 11.25.0,
Rust/Cargo 1.98.0, Tauri core 2.11.5, WebView2 151.0.4129.107, and
`tauri-driver` 2.0.6. This included frozen npm installation with no peer issue,
all frontend gates, E2E type checking, Rustfmt, Clippy with warnings denied,
Rust tests, `pnpm tauri build --no-bundle`, the desktop smoke scenario, and a
development-runtime smoke check.

The only remaining verification is Task 4 Step 3. `frontend-ci` passed from a
clean GitHub Actions checkout. `desktop-ci` passed installation, Rust gates, and
the production build, then timed out creating its WebView2 session; it must be
rerun after the isolated-profile remediation is pushed. Completing this scaffold
does not mean that `FE-001`, `BE-001`, or `BE-002` has been implemented.
