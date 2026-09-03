# BE-004 Git Status Read-Only Implementation Plan

**Status:** Implemented

**Goal:** Implement the complete backend-owned `BE-004` contract so an
authorized `main` webview can request a fresh, typed Git summary or detailed
status for one registered, available project without XWork modifying the
project, repository, database, or invoking an external Git-related process.

**Completion Criteria:**

- `gix = 0.87.1` is exact-pinned with only the documented direct features, and
  Cargo resolves it against the repository's pinned Rust and Tauri toolchain.
- Exact-root repository detection distinguishes plain folders, normal
  worktrees, linked worktrees, and bare repositories without discovering an
  ancestor repository.
- Branch, unborn, and detached HEAD states plus every documented change kind,
  precedence, deduplication, count, untracked collapse, path escape, and stable
  ordering rule match `BE-004`.
- `ProjectService::git_summary` and `ProjectService::git_status` resolve roots
  only through `available_root`, run all Git work on blocking workers, limit the
  application to two simultaneous scans, revalidate after a scan, and handle
  locate/remove races exactly as specified.
- Both Tauri commands authorize the exact invoking window `main` before project
  lookup, permit acquisition, or filesystem work and return only generated,
  typed DTOs and sanitized `ProjectsError` variants.
- Automated tests prove that summary and detail do not change SQLite project
  metadata, HEAD, refs, index, config, objects, worktree content, or create Git
  lock/temporary files; configured external helpers are rejected and never run.
- Rust-generated TypeScript bindings include the complete Git contract and no
  handwritten duplicate DTO is introduced.
- All frontend regression gates, Rust gates with all targets/features, and the
  Windows Tauri build pass. No automated desktop end-to-end test is added.

**Architecture:** The existing `projects` capability remains the sole owner of
project metadata and gains a private `git_status` reader behind the synchronous
`GitStatusReader` seam. `ProjectService` obtains an `AvailableProjectRoot`,
acquires one of two shared scan permits, moves the root and reader into
`spawn_blocking`, then revalidates the root before attaching the project ID and
returning a public DTO. Commands remain thin authorization adapters; `gix`
handles and raw path data never enter Tauri managed state or another capability.

**Tech Stack:** Rust `1.98.0` stable, Cargo `1.98.0`, Rust Edition `2024`, Tauri
`2.11.5`, Tokio `1.53.1` with the existing `sync` feature, Serde `1.0.229`,
`ts-rs = 12.0.1`, and the new exact dependency:

```toml
gix = { version = "=0.87.1", default-features = false, features = ["status", "parallel", "sha1", "sha256"] }
```

The version and feature set are established by `BE-004`; Task 1 verifies actual
resolution against the pinned toolchain and records the resulting lockfile.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`, Stage 5 (Git status and Project
  Overview)
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`, sections
  7.1-7.5, 18, 19.3, and 20 Phase 1
- Backend spec: `00-Docs/03-Backend/BE-004-git-status-read-only.md`
- Backend prerequisite: `00-Docs/03-Backend/BE-003-projects.md`
- Existing frontend contract: `00-Docs/02-Frontend/FE-004-projects.md`, deferred
  Git summary extension only
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Wireframe: `00-Docs/01-Wireframe/04-Projects.html`, `#grid`, `#overview`, and
  `#unavailable`
- Plan rules: `PLANS.md`

`FE-005` does not yet have a feature specification in the repository. This is a
backend-only plan: it produces the contract consumed by the later Stage 5
frontend plan but does not implement Project Overview or expose the Git summary
on existing project cards. Stage 5 and the user-visible completion item in
`BE-004` remain incomplete until `FE-005` and the `FE-004` extension are
specified, planned, implemented, and verified separately.

## Scope

**In Scope:**

- Exact-pinning `gix` with the minimal documented read-status feature set and
  updating `src-tauri/Cargo.lock` through Cargo resolution.
- Public Git repository, HEAD, summary, status, file-change DTOs and the single
  `GitInspectionFailed` extension to `ProjectsError`.
- A private `gix` reader that opens only the supplied root with isolated, strict
  configuration; reads HEAD/index/worktree status; rejects external execution;
  deduplicates, classifies, counts, escapes, and sorts entries; and drops all
  `gix` state inside its blocking worker.
- `ProjectService` summary/detail orchestration, the application-wide two-scan
  semaphore, injected reader test seam, post-scan root revalidation, one locate
  retry, and removal/unavailability race handling.
- `get_project_git_summary` and `get_project_git_status`, exact-`main`
  authorization, invoke-handler registration, and composition-root injection.
- Generated Projects bindings and focused unit, integration, contract,
  composition, immutability, concurrency, and Windows-specific tests.
- Full existing frontend/Rust regression gates and the Windows Tauri build.

**Out of Scope:**

- Any frontend implementation, including the `FE-004` card summary extension,
  `FE-005` Project Overview, error copy, retry controls, focus refresh, or route
  changes.
- Git write operations: init, clone, add/stage, commit, reset, restore,
  checkout/switch, merge, rebase, stash, branch/tag/ref edits, or index refresh.
- Diff content, history, remotes, credentials, ahead/behind, author, blame,
  graph, or user-supplied revisions/pathspec/options.
- Repository discovery in ancestor folders, nested-repository scanning,
  recursive submodule scanning, Git watchers, background polling, caching,
  persistence, migrations, or Git events/channels.
- Adding Git fields to `ProjectDto`, changing Projects schema, or combining
  session/file/note/event data with a Git DTO.
- Any capability permission, general webview filesystem access, Git CLI runtime
  dependency, automated desktop end-to-end test, or macOS validation.

## Global Constraints

- "Keep OS access, persistence, terminal processes, and business rules in Rust;
  the React frontend communicates with them through narrowly scoped Tauri
  commands and events." (`AGENTS.md`)
- "Every function, method, callback, test, and helper must have a short comment
  describing its purpose." (`AGENTS.md`)
- "Frontend không import trực tiếp API hệ điều hành, filesystem, database hoặc
  PTY." (`00-Docs/00-Overview/02-ProjectStructure.md`)
- A backend capability may use `shared`, `storage`, and platform ports but must
  not access another capability's internal implementation.
  (`00-Docs/00-Overview/02-ProjectStructure.md`)
- All roots must come from the public `ProjectService::available_root` contract;
  neither command accepts a path, revision, pathspec, or Git option.
  (`00-Docs/03-Backend/BE-004-git-status-read-only.md`)
- Every `gix` operation and status iteration runs completely inside
  `tauri::async_runtime::spawn_blocking`; no `tauri::State`, storage guard,
  removal lock, Tokio lock, or `gix` handle crosses that worker boundary.
  (`00-Docs/03-Backend/BE-004-git-status-read-only.md`)
- Repository opening uses isolated and strict configuration, performs no
  ancestor discovery, accepts repository-local ignore/attributes only, and
  refuses any helper/filter execution.
  (`00-Docs/03-Backend/BE-004-git-status-read-only.md`)
- Status outcomes are read and dropped. Implementation must not call
  `Outcome::write_changes`, refresh the index, invoke Git, follow symlink
  targets, or recurse into submodules.
  (`00-Docs/03-Backend/BE-004-git-status-read-only.md`)
- Generated files under `src/bindings/` are produced from Rust and never edited
  manually. (`PLANS.md`)
- Tests use only temporary databases and repositories and never inspect the
  development repository, real app data, credentials, or network.
  (`PLANS.md`)
- Normal development and validation run only on Windows; macOS validation is
  deferred to release preparation. (`AGENTS.md`)

Every task implicitly includes these constraints.

## Assumptions, Risks, and Blockers

**Assumptions:**

- `BE-003` is implemented in the current tree. Its public
  `ProjectService::available_root`, removal gate, availability mapping,
  temporary-storage test harnesses, `ProjectsError`, app composition seam, and
  binding generator remain the stable prerequisite.
- `BE-004` has no open questions and owns enough backend detail to implement
  this plan without a completed `FE-005` specification.
- `NotRepository` and `Bare` are successful results. Only a recognized but
  unreadable/unsafe repository becomes `GitInspectionFailed`.
- Repository snapshots are best-effort views of changing filesystems; two
  sequential calls need not match when another process changes the repository.
- No migration or Tauri capability permission change is required because the
  result is not persisted and all filesystem access remains inside Rust.

**Risks:**

- `gix` status exposes staged/worktree information separately and may emit
  entries concurrently. Task 2 centralizes merge precedence, checked counting,
  and raw-byte ordering in pure helpers before converting to public DTOs.
- Git config, attributes, filters, fsmonitor, textconv, or helpers could trigger
  external execution if accepted carelessly. Tasks 2 and 5 use hostile local
  fixture configuration with a marker-producing helper and assert the query
  fails safely without creating the marker.
- Windows path and repository forms differ from Unix, especially linked
  worktrees, drive roots, separators, junctions/symlinks, and locked files.
  Task 5 keeps all fixtures below a dedicated temporary root and includes
  Windows-specific coverage without following targets outside that root.
- A locate/remove can race a long scan. Task 3 parks an injected reader with
  test-owned channels, changes metadata through the real Projects service, and
  observes retry/error behavior without timing sleeps.
- Parallel scans can exhaust CPU or accidentally hold a permit during root
  validation. Task 3 injects a recording reader and coordinated barriers to
  prove exactly two scans enter while a third waits, and that validation occurs
  before permit acquisition.
- Read-only regressions are easy to miss because a status library may refresh
  index metadata. Task 5 snapshots repository bytes, relevant modification
  times, tree contents, and lock/temp names before and after both commands.
- Binding generation currently rewrites stale output and fails once by design.
  Task 1 treats that first failure as generation, reviews the diff, and requires
  a second clean pass; no generated file is edited by hand.

**Blockers:** None for this backend-only plan. The missing `FE-005` specification
blocks only the later user-visible Stage 5 frontend plan.

## Test Isolation and Seams

- Every service/integration test creates a `tempfile::TempDir`, opens an
  isolated `Storage` beneath it, and creates repository fixtures only under a
  separate child directory. No test resolves or scans the XWork checkout.
- Reader unit tests use owned byte/path/status inputs and test-local repository
  fixtures. They do not mutate process-global environment variables.
- Service tests inject an `Arc<dyn GitStatusReader>` and one test-owned
  `Arc<tokio::sync::Semaphore>` through
  `ProjectService::with_git_seams`. Recording/parking readers use channels and
  barriers to control entry, completion, success, and failure deterministically;
  no sleep is used to infer concurrency.
- The fake reader receives only `&Path` and `GitInspectionMode`; it receives no
  project repository, `Storage`, removal set, or Tauri state.
- Locate races use the existing fake `ProjectPlatform` to return a second
  temporary canonical folder. Remove races use the existing service removal
  gate/runtime guard seams. The observable results are a single rescan for one
  root change and the latest `ProjectNotFound`, `ProjectUnavailable`,
  `RemovalInProgress`, or `GitInspectionFailed` result after revalidation.
- Authorization tests inject a recording reader/resolver path and compare
  reader entry counts plus available semaphore permits before/after a
  `quick-note` or other non-`main` invocation.
- Hostile external-helper fixtures point at a test-only marker path. A safe
  implementation returns `GitInspectionFailed`; the marker remains absent and
  no child process is started by production code.
- Repository immutability snapshots hash/control HEAD, loose and packed refs,
  index, repository config, object files, tracked/untracked worktree contents,
  ignore/attributes, relevant modification times, and the set of lock/temp
  files. Project-row snapshots prove both commands leave SQLite and
  `last_opened_at_ms` unchanged.
- The Tauri composition test uses the existing mock runtime and isolated app
  data. It observes managed state and command routing only; it opens no native
  UI and performs no desktop end-to-end automation.

## Dependency Order

1. Task 1 (dependency and public contract) → enables typed reader/service output
   and generated binding verification.
2. Task 2 (Git reader and pure mapping) → enables repository snapshots without
   exposing `gix` outside the blocking boundary.
3. Task 3 (service orchestration) → enables safe project-root resolution,
   concurrency limits, and race handling around the reader.
4. Task 4 (commands and composition) → exposes the completed service through
   the authorized Tauri boundary.
5. Task 5 (real repository acceptance and immutability) → verifies the complete
   backend slice across public commands before final quality gates.

---

### Task 1: Pin `gix` and Define the Public Git Contract

**Outcome:** Cargo resolves the exact read-only Git dependency, Rust owns every
public Git DTO/error shape, and the Projects binding generator produces one
stable TypeScript contract including `BE-003` and `BE-004` types.

**Depends On:** None

**Files:**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/projects/models.rs`
- Modify: `src-tauri/src/projects/error.rs`
- Modify: `src-tauri/src/projects/mod.rs`
- Modify: `src-tauri/tests/export_bindings.rs`
- Generated: `src/bindings/projects/projects.ts`
- Test: `src-tauri/src/projects/models.rs` (`#[cfg(test)]`)
- Test: `src-tauri/src/projects/error.rs` (`#[cfg(test)]`)
- Test: `src-tauri/tests/export_bindings.rs`

**Interfaces:**

- Consumes: existing Serde/`ts-rs` conventions, `ProjectsError`, and the stable
  Projects binding order.
- Produces: `ProjectGitSummaryDto`, `ProjectGitStatusDto`,
  `GitRepositoryKindDto`, `GitHeadDto`, `GitFileChangeDto`,
  `GitFileChangeKindDto`, and `ProjectsError::GitInspectionFailed {
  project_id: String }`, with the exact derives and naming rules from `BE-004`.

- [x] **Step 1: Add contract tests and exact dependency declaration**

  Add the exact `gix` manifest entry. Extend model/error tests with every enum
  variant, tagged `GitHeadDto` shape, camel-case fields, repository-kind
  invariants, safe `Display`, and sanitized error JSON. Extend the binding test's
  stable order with all six Git DTO types before `ProjectsError`.

- [x] **Step 2: Verify the contract tests fail for missing Rust types**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::models`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::error`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings projects_binding_matches_rust_contract`

  Expected: Cargo discovers each target and compilation fails on the named
  missing Git DTO exports or `ProjectsError::GitInspectionFailed`; it does not
  pass by selecting zero tests.

- [x] **Step 3: Implement the public Rust definitions and generate the binding**

  Add the exact DTO/error definitions, `ts-rs` output metadata, re-exports, and
  sanitized display branch. Resolve the lockfile through Cargo. Run the binding
  test once to regenerate the file, inspect that only the intended Projects
  contract changed, then rerun it without manually editing generated output.

- [x] **Step 4: Verify dependency features and public contract**

  Run:

  - `cargo tree --manifest-path src-tauri/Cargo.toml -e features -p gix`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::models`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::error`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings projects_binding_matches_rust_contract`

  Expected: the root `gix v0.87.1` entry is selected with only direct features
  `status`, `parallel`, `sha1`, and `sha256`; all DTO/error serialization tests
  pass; and the second binding run leaves
  `src/bindings/projects/projects.ts` unchanged.

### Task 2: Implement the Exact-Root Read-Only Git Reader

**Outcome:** One synchronous reader returns an owned summary/detail snapshot
with safe HEAD and status information while every `gix` handle, iterator, and
raw byte path remains local to the calling blocking worker.

**Depends On:** Task 1

**Files:**

- Create: `src-tauri/src/projects/git_status.rs`
- Modify: `src-tauri/src/projects/mod.rs`
- Test: `src-tauri/src/projects/git_status.rs` (`#[cfg(test)]`)

**Interfaces:**

- Consumes: Task 1 DTOs, `gix::open::Options`, `gix` HEAD/status APIs, and a
  canonical root supplied by Projects.
- Produces: crate-private `GitInspectionMode::{Summary, Detail}`,
  `GitReadSnapshot`, `GitReadError`, `GitStatusReader::inspect(&Path,
  GitInspectionMode)`, and the production `GixGitStatusReader` implementation.
  No `gix` type appears in any produced interface.

- [x] **Step 1: Add discoverable reader and pure-mapping tests**

  Declare the module and add tests for exact-root detection, normal/linked/bare
  repositories, branch/unborn/detached HEAD, not-repository success, corrupt
  repository failure, summary/detail modes, all change kinds, merge precedence,
  staged-plus-unstaged deduplication, rename/copy paths, collapsed untracked
  directories, ignored entries, gitlinks, checked `u32` conversion, path safety,
  non-UTF-8 byte escaping, and raw-byte stable sort.

- [x] **Step 2: Verify the focused reader target fails on missing behavior**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::git_status::tests`

  Expected: the test module is discovered and compilation fails on the named
  missing reader/mapping helpers and `GitStatusReader` implementation, rather
  than running zero tests.

- [x] **Step 3: Implement the minimum safe reader pipeline**

  Open only the supplied root with isolated, strict configuration and detected
  trust. Distinguish absence from recognized corruption; read branch/unborn or
  eight-lowercase-hex detached HEAD; skip worktree status for bare repositories;
  preflight local config/attributes for executable helpers; and configure
  collapsed untracked, ignored exclusion, non-recursive submodule handling, and
  standard staged rename tracking.

  Consume the complete status iterator before returning. Merge index/worktree
  observations by current raw path with the documented precedence, retain
  `previous_path` only for rename/copy, count after deduplication with checked
  conversion, sort by raw current path then previous path then kind, and only
  then escape path/branch bytes for DTO output. In summary mode retain only the
  minimum internal keys/counts and return no public `changes` entries. Never
  call a write/refresh API or spawn a process.

- [x] **Step 4: Verify reader behavior and forbidden production APIs**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::git_status::tests`
  - `rg -n "std::process|Command::new|Outcome::write_changes|write_changes|discover|init|checkout|worktree_mut" src-tauri/src/projects/git_status.rs`

  Expected: all focused detection, HEAD, mapping, count, path, and sort tests
  pass. The search finds no process spawn, outcome write, ancestor discovery,
  repository initialization, checkout, or worktree mutation call; any match in
  a test/helper name is reviewed and cannot occur in production code.

### Task 3: Add Project Service Orchestration, Limits, and Race Handling

**Outcome:** `ProjectService` provides fresh summary/detail queries through the
existing project-root contract, admits at most two concurrent scans, and never
returns a snapshot for a root or project that became stale during the scan.

**Depends On:** Task 2

**Files:**

- Modify: `src-tauri/src/projects/service.rs`
- Test: `src-tauri/src/projects/service.rs` (`#[cfg(test)]`)

**Interfaces:**

- Consumes: `ProjectService::available_root`, crate-private
  `GitStatusReader`, `GitInspectionMode`, `GitReadSnapshot`,
  `tauri::async_runtime::spawn_blocking`, and `tokio::sync::Semaphore`.
- Produces: `pub async fn ProjectService::git_summary(&self, project_id: &str)
  -> Result<ProjectGitSummaryDto, ProjectsError>` and `pub async fn
  ProjectService::git_status(&self, project_id: &str) ->
  Result<ProjectGitStatusDto, ProjectsError>`.
- Test seam: crate-private `ProjectService::with_git_seams` extends the existing
  constructor chain with `Arc<dyn GitStatusReader>` and a test-owned
  `Arc<Semaphore>` while preserving existing public `ProjectService::new` and
  `with_seams` callers.

- [x] **Step 1: Add focused service tests with deterministic fake readers**

  Cover invalid/missing/unavailable/removing roots before reader entry; summary
  versus detail mode; attaching only the requested project ID; reader, worker
  join, inconsistent snapshot, and count failures mapping to sanitized
  `GitInspectionFailed`; two simultaneous entries and a parked third; permits
  released on success/error/cancellation; no partial DTO; and no storage/removal
  lock held while the reader is parked.

  Place these cases in an exact nested module
  `projects::service::tests::git_tests`. Add locate-race tests for unchanged
  root, one root change causing exactly one
  rescan, a second root change causing `GitInspectionFailed`, and remove or
  unavailable state winning after a scan. Coordinate every race with channels
  or barriers and assert the exact sequence of roots passed to the fake reader.

- [x] **Step 2: Verify service tests fail on missing methods and seams**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::service::tests::git_tests`

  Expected: Cargo compiles the intended service test module and fails on the
  absent `git_summary`, `git_status`, or injected-reader/semaphore path; it does
  not report a successful zero-test run.

- [x] **Step 3: Implement shared orchestration once for both public methods**

  Validate and resolve with `available_root` before acquiring a permit. Clone
  the owned `PathBuf` and reader into `spawn_blocking`, consume/drop the reader
  result there, and map internal sources to `GitInspectionFailed { project_id }`
  without logging sensitive details. Re-run `available_root` after success:
  return when canonical roots match, propagate the newest project state when it
  no longer resolves, or discard and rescan once when locate changed the root.
  A second root change returns `GitInspectionFailed`. Build the summary and
  detail DTOs only after successful revalidation.

- [x] **Step 4: Verify service behavior and concurrency invariants**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::service::tests::git_tests`

  Expected: all focused service tests pass; exactly two parked scans enter, the
  third enters only after a permit is released, validation failures consume no
  permit/reader call, locate retries at most once, and removal/unavailability
  prevents stale success.

### Task 4: Register Authorized Commands and Production Composition

**Outcome:** The production and mock app builders manage a Git-capable
`ProjectService`, route both commands, preserve every existing command, and
reject non-`main` callers before any Git or project work.

**Depends On:** Task 3

**Files:**

- Modify: `src-tauri/src/projects/commands.rs`
- Modify: `src-tauri/src/projects/mod.rs`
- Modify: `src-tauri/src/app/mod.rs`
- Modify: `src-tauri/tests/app_builder.rs`
- Test: `src-tauri/src/projects/commands.rs` (`#[cfg(test)]`)
- Test: `src-tauri/tests/app_builder.rs`

**Interfaces:**

- Consumes: existing `authorize_main_caller`, managed `ProjectService`, Task 3
  service methods, production `GixGitStatusReader`, and the shared two-permit
  semaphore.
- Produces: `pub async fn get_project_git_summary(WebviewWindow, String,
  State<'_, ProjectService>) -> Result<ProjectGitSummaryDto, ProjectsError>` and
  `pub async fn get_project_git_status(WebviewWindow, String,
  State<'_, ProjectService>) -> Result<ProjectGitStatusDto, ProjectsError>` with
  Tauri argument name `projectId` after command deserialization; both routes in
  the single application invoke handler.

- [x] **Step 1: Add command-order and app-composition regression tests**

  Add unit tests proving `main` reaches the service while `quick-note`, empty,
  and arbitrary labels return `UnauthorizedWindow`. Record resolver/reader call
  counts and permit availability to prove authorization runs first. Extend the
  app-builder test to assert both new command names are routed, all lifecycle
  and prior Projects commands remain routed, one Git reader/two-permit limit is
  installed in the managed service, and failed startup publishes no service.

- [x] **Step 2: Verify tests fail for absent commands/routes**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::commands::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder projects_composition_routes_lifecycle_and_projects_commands`

  Expected: the command target fails on the missing Git command symbols or
  authorization path, and the composition test reports that
  `get_project_git_summary` / `get_project_git_status` are not routed; existing
  route assertions continue compiling.

- [x] **Step 3: Add thin commands and wire the production reader/limit**

  Reuse exact-`main` authorization before cloning/calling service state. Keep
  commands free of path handling, `gix` mapping, retry logic, or business rules.
  Extend the existing composition setup and test configuration without creating
  a second `ProjectService`, reader cache, or semaphore per command. Add both
  functions to the existing invoke handler; do not add an event or permission.

- [x] **Step 4: Verify composition and authorization order**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::commands::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder`

  Expected: only exact `main` is authorized for both Git commands; rejected
  callers cause zero resolver/reader entries and no permit change; mock startup
  manages one service and routes every old/new command; startup failure still
  publishes no partial managed state.

### Task 5: Prove Real Repository Semantics and Read-Only Operation

**Outcome:** Public command integration against isolated real repository
fixtures proves the complete repository matrix, stable contract, race-safe
errors, and absence of writes or external execution.

**Depends On:** Task 4

**Files:**

- Create: `src-tauri/tests/projects_git_status.rs`
- Modify: `src-tauri/tests/export_bindings.rs`
- Verify unchanged: `src-tauri/migrations/`
- Verify unchanged: `src-tauri/capabilities/main.json`
- Test: `src-tauri/tests/projects_git_status.rs`
- Test: `src-tauri/tests/export_bindings.rs`

**Interfaces:**

- Consumes: public Tauri commands, generated Projects DTO/error contract,
  `ProjectService`/`BE-003` registration behavior, temporary `Storage`, and
  test-only repository-fixture plumbing.
- Produces: integration target `projects_git_status`; test-only fixture helpers
  for repositories, index/worktree states, hostile helper configuration,
  immutable snapshots, and mock-webview invocation. Repository arrangement may
  invoke the Windows test runner's local `git.exe` only from this integration
  target, with a cleared child environment, fixture-local user/config, no
  credential helper, and no network operation. A missing `git.exe` is a clear
  test prerequisite failure, never a silent skip. These helpers are compiled
  only for tests and never enter the production command path.

- [x] **Step 1: Build the isolated public-command acceptance matrix**

  Register every fixture as a project through the existing Projects boundary,
  then invoke summary/detail from mock `main`. Cover plain folder, repository in
  parent only, normal worktree, linked worktree, bare repository, branch,
  unborn, detached HEAD, clean status, staged/unstaged/add/delete/type-change,
  staged rename/copy, conflict, staged-plus-unstaged same path, collapsed
  untracked directory, ignored entries, symlink/junction non-follow, gitlink
  without recursion, corrupt/missing/locked index or object/config failure, and
  repeated stable ordering.

  Assert all paths are project-relative, `/`-separated, escaped without the
  replacement character, and contain no absolute/drive/`..` prefix. Assert
  detail count equals list length and matches a summary from the unchanged
  fixture. Assert bare is never clean and not-repository is never an error.

- [x] **Step 2: Add authorization, immutability, and hostile-config cases**

  Invoke both commands from `quick-note` and another label using valid and
  invalid project IDs; assert `UnauthorizedWindow` wins and fixture snapshots
  remain untouched. Snapshot SQLite and repository state before/after successful
  summary/detail and inspection failures. Configure every external execution
  path identified by the reader preflight to create a marker if run; assert
  `GitInspectionFailed`, absent markers, sanitized JSON/display/log capture, no
  `.git/index.lock`, and no repository/worktree/database change.

- [x] **Step 3: Run and complete the real-fixture matrix**

  Run: `cargo test --manifest-path src-tauri/Cargo.toml --test projects_git_status -- --test-threads=1`

  Expected: the named integration target is discovered and all repository,
  path, status, command, authorization, immutability, external-execution, and
  Windows-specific assertions pass using only its temporary fixture root. The
  serial flag isolates filesystem fixtures; production concurrency remains
  covered deterministically by Task 3.

- [x] **Step 4: Recheck generated and negative boundaries**

  Run:

  - `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings projects_binding_matches_rust_contract`
  - `rg -n "^(export )?(type|interface) (ProjectGitSummaryDto|ProjectGitStatusDto|GitRepositoryKindDto|GitHeadDto|GitFileChangeDto|GitFileChangeKindDto)" src --glob '!src/bindings/**'`
  - `git diff --exit-code -- src-tauri/migrations src-tauri/capabilities/main.json`

  Expected: binding drift test passes cleanly; no handwritten TypeScript Git DTO
  exists; and this backend slice changes no migration or webview capability.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Focused Git reader/service/command tests | Run separately: `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::git_status::tests`; `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::service::tests::git_tests`; `cargo test --manifest-path src-tauri/Cargo.toml --lib projects::commands::tests` | Every exact unit-test module is discovered; detection, mapping, path safety, concurrency, races, and authorization pass |
| Real repository command integration | `cargo test --manifest-path src-tauri/Cargo.toml --test projects_git_status -- --test-threads=1` | Full temporary-repository matrix passes with no write or helper execution |
| Composition integration | `cargo test --manifest-path src-tauri/Cargo.toml --test app_builder` | Startup state and all old/new invoke routes pass |
| Generated contract | `cargo test --manifest-path src-tauri/Cargo.toml --test export_bindings` | Rust-generated lifecycle and Projects bindings are current on the first verification run |
| Exact dependency | `cargo tree --manifest-path src-tauri/Cargo.toml -e features -p gix` plus review of `src-tauri/Cargo.toml` | Root resolves to `gix v0.87.1`; the direct manifest has `default-features = false` and only `status`, `parallel`, `sha1`, `sha256` |
| Frontend format | `pnpm format:check` | No formatting differences, including generated TypeScript |
| Frontend lint | `pnpm lint` | Pass with no lint errors |
| Frontend type check | `pnpm typecheck` | Existing frontend compiles against the extended generated binding with no type errors |
| Frontend regression tests | `pnpm test` | All existing unit/component tests pass; no Git UI or automated desktop end-to-end test is added |
| Frontend production build | `pnpm build` | Existing SPA bundle succeeds with the extended unused backend binding |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No Rust formatting difference |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Every target and feature passes with warnings denied |
| Complete Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | All unit, integration, composition, storage, lifecycle, Projects, and binding tests pass |
| Windows desktop integration | `pnpm tauri build` | Windows desktop build succeeds with `gix`, the managed reader/limit, both commands, and generated contract |
| No production Git process/write path | `rg -n "std::process|Command::new|Outcome::write_changes|write_changes|git2|libgit2" src-tauri/src` | No new production process spawn, status write-back, or second Git implementation is present; unrelated existing matches are reviewed |
| No persistence/event/schema expansion | `git diff --exit-code -- src-tauri/migrations src-tauri/capabilities/main.json` and `rg -n "git://|GIT_.*EVENT|emit.*git|ProjectGit" src-tauri/src/projects src-tauri/migrations` | No migration/capability change or Git event exists; `ProjectGit` matches are confined to DTO/query code rather than persisted `ProjectDto` fields |
| No handwritten contract | `rg -n "^(export )?(type|interface) (ProjectGitSummaryDto|ProjectGitStatusDto|GitRepositoryKindDto|GitHeadDto|GitFileChangeDto|GitFileChangeKindDto)" src --glob '!src/bindings/**'` | No duplicate frontend DTO is found |

### Targeted Windows Verification Notes

The automated integration target is the primary Windows check because this
slice has no user-visible frontend yet. Run it on an NTFS temporary directory
where the test can create linked worktree and link fixtures. It must explicitly
report the Windows drive-path, linked-worktree, symlink/junction non-follow, and
locked-file cases as executed rather than silently skipping them. If the
current Windows account cannot create the required link fixture, record that
environment limitation and rerun only that fixture under a disposable Windows
account or virtual machine with link creation enabled; do not weaken the
assertion and do not point it at user-owned folders.

After `pnpm tauri build`, launch the built application once using a disposable
Windows profile and confirm normal startup plus the existing Projects page.
No Git result is expected in the UI in this backend-only plan. This is a native
startup smoke check, not an automated desktop end-to-end test, and it must not
be reported as proof of the deferred `FE-004`/`FE-005` behavior.

## Plan Review Gate

- [x] The only new dependency is exact-pinned with its complete manifest entry;
  its version/features come directly from `BE-004`, and Cargo resolution plus
  the Windows Tauri build verify compatibility with the pinned toolchain.
- [x] Every named test file is selected explicitly by a focused or final
  command; every red step fails on a named missing symbol/route and cannot pass
  by matching zero tests.
- [x] Real storage, repository, project, link, lock, and helper fixtures live
  only under test-owned temporary directories; no test reads app data,
  credentials, network, or the development checkout.
- [x] Reader failure, worker failure, hostile config, one/two locate races,
  removal/unavailability races, and semaphore saturation each have an explicit
  injection mechanism and observable result.
- [x] Read-only behavior has concrete before/after repository, worktree, and
  SQLite snapshots plus lock/temp-file detection; authorization order has
  concrete resolver/reader/permit counters.
- [x] Final Rust commands include `--all-targets --all-features`, Clippy denies
  warnings, frontend regressions run, and the Windows Tauri build is required.
- [x] No generated file is hand-edited, no Git event/write command, migration,
  capability, cache, or watcher is planned, and no Git commit step is present.
- [x] macOS validation and all user-visible Stage 5 behavior are explicitly
  deferred rather than falsely claimed complete.

## Deviations and Decisions

- Git acceptance coverage is split between focused reader/service unit tests,
  the existing `projects_commands` integration target, and the new
  `projects_git_status` target. This keeps the public-command checks close to
  the existing Projects harness while preserving the planned dedicated target.
- The SQLite read-only assertion compares the complete public project row
  before and after both Git commands. Byte-for-byte comparison of SQLite WAL
  and SHM files was rejected because SQLite legitimately updates transient
  reader-lock bookkeeping during a read. Repository metadata, refs, objects,
  index, and worktree files are still compared byte-for-byte.
- The generated TypeScript field for detached HEAD is explicitly renamed to
  `shortOid`; enum payload fields are not covered by Serde's variant-level
  `rename_all` setting.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

Implemented the backend-owned Git summary/detail contract with exact-root
opening, isolated strict configuration, helper rejection, typed classification,
stable raw-path ordering and escaping, two-scan admission, blocking workers,
post-scan root revalidation, exact-main command authorization, production
composition, and generated TypeScript bindings.

Automated Windows verification passed for reader/service/command tests, the
dedicated real-repository target, all Rust targets/features, Rustfmt, Clippy
with warnings denied, frontend format/lint/type-check/tests/build, and the Tauri
release build. Fixtures cover plain folders, parent-only repositories, normal
and linked worktrees, bare repositories, branch/unborn/detached HEAD, staged
and unstaged changes, add/delete/rename/copy/type-change/conflict/untracked,
deduplication, ignored files, missing/corrupt metadata, helper rejection,
repository immutability, authorization, and the two-worker limit.

No macOS validation or user-visible Git UI was added. The `FE-004` card
extension and `FE-005` Project Overview remain separate future work.
