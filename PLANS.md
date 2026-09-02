# XWork Implementation Plans

This document defines how implementation plans are created, reviewed, and
maintained for XWork. It complements `AGENTS.md` and does not replace feature
specifications or the project roadmap.

## When a Plan Is Required

Create or update an implementation plan when the work:

- Implements a roadmap phase from `00-Docs/98-Plan/00-Roadmap.md`.
- Spans multiple frontend features or backend capabilities.
- Changes the frontend-backend boundary, Tauri commands, DTOs, or events.
- Introduces or changes persistence, OS integration, terminal processes,
  capabilities, bundling, or desktop integration.
- Performs a significant refactor or migration with multiple dependent steps.

A separate implementation plan is not required for:

- Documentation-only corrections.
- A small, isolated change with an obvious implementation and verification path.
- Exploratory investigation that does not authorize implementation.

Creating a plan does not authorize implementation. Do not modify source code
until the user requests implementation.

## Plan Location and Naming

Store implementation plans in `00-Docs/98-Plan/`.

Implementation plans use `yyyyMMdd-name-kebab.md`.

The `yyyyMMdd` prefix records the plan creation date, not a roadmap phase
number or a unique identifier. Multiple plans may share the same date prefix.
Do not rename a plan merely because it is updated later.

A plan's roadmap ownership is determined by its Sources and Scope sections,
not by its filename prefix.

Use `00-Docs/99-Template/04-Plan.md` as the starting template.

Do not place detailed implementation tasks in
`00-Docs/98-Plan/00-Roadmap.md`.

## Required Inputs

Before writing a plan, read the applicable sources:

1. `AGENTS.md`.
2. `00-Docs/98-Plan/00-Roadmap.md`.
3. `00-Docs/00-Overview/01-TechStack.md`.
4. `00-Docs/00-Overview/02-ProjectStructure.md`.
5. `00-Docs/00-Overview/03-FunctionalRequirements.md`.
6. Applicable `FE-NNN` and `BE-NNN` specifications.
7. Applicable wireframes under `00-Docs/01-Wireframe/`.

A feature may enter an implementation plan only when its specification has no
unresolved open questions.

If the sources conflict or leave a decision that materially changes the
implementation, stop and ask for clarification. Do not silently choose an
interpretation.

## Plan Content

Write every implementation plan in English.

Each plan must be self-contained enough for an implementer to execute while
still treating the linked specifications as the source of truth.

Include:

- A measurable goal and completion criteria.
- The specifications and wireframes being implemented.
- Explicit scope and out-of-scope items.
- Applicable project-wide constraints copied from the source documents.
- Architecture and dependency order.
- Tasks small enough to implement and verify independently.
- Exact files to create, modify, or test when they can be known.
- Interfaces produced or consumed by each task.
- Relevant risks, assumptions, and unresolved blockers.
- Commands and expected results used to verify completion.

Do not duplicate full feature requirements in the plan. Link to their source
documents and include only the constraints needed to make implementation
decisions unambiguous.

Do not invent source paths, interfaces, dependencies, or line numbers that have
not been established by the repository or specifications.

An exact-pinned dependency must include its complete manifest entry and exact
version in the plan. Do not leave version selection to the implementer.

When a dependency version is not already established by a source document,
record how compatibility with the pinned toolchain was verified.

## Task Rules

Order tasks by real dependency.

Each task must state:

- Its intended outcome.
- Files affected.
- Interfaces consumed and produced.
- The smallest implementation steps.
- Tests written for new behavior or bug fixes.
- The verification command and expected result.

Prefer a failing test before implementation when the behavior can be tested at
that level.

A failing-test step must make the intended test target discoverable and compile
it far enough to fail on the missing behavior. An undiscovered test file or a
command that runs zero matching tests is not a valid red test.

When a task names an integration test file, its verification command must
select that test target explicitly, such as `cargo test --test <target>`. A
test-name filter may be used only when the plan identifies the exact test names
or module paths it selects.

Expected results must name the behavior, assertion, or symbol that causes the
failure. Do not use a generic "compilation or assertions fail" expectation when
a more specific failure can be planned.

Do not add speculative abstractions, dependencies, directories, or future
features.

Do not include Git commit steps unless the user explicitly requests commits.

## Test Isolation and Seams

Tests must not read or write the developer's real app data, configuration,
credentials, projects, or other user-owned state.

When production code resolves a path, service, clock, process, or OS resource,
the plan must state the exact test seam used to substitute an isolated value.
List any test-only interface in the task's Interfaces section.

Do not rely on process-global environment mutation for test isolation when
tests may run concurrently.

Every planned startup or initialization failure must include at least one
explicit failure scenario, its injection mechanism, and the expected
observable result.

## XWork Architecture Boundaries

Plans must preserve these boundaries:

- React owns presentation and temporary UI state.
- Rust owns OS access, persistence, terminal processes, and business rules.
- Frontend-backend communication uses narrowly scoped Tauri commands and events.
- Frontend features do not import implementation from other features.
- Backend capabilities do not access another capability's internal
  implementation.
- Frontend development uses mock IPC until the matching backend integration
  phase.
- Mock IPC and temporary DTOs must follow the documented backend contract.
- Generated bindings under `src/bindings/` are not edited manually.
- Feature directories and dependencies are created only when the corresponding
  implementation begins.

## Verification

Plan verification must match the affected scope.

For frontend changes, include the relevant:

- Formatter and linter.
- Type check.
- Unit and component tests.
- Production build when applicable.

For Rust changes, include:

- Rustfmt.
- Clippy with warnings denied.
- Rust tests.

Include a Windows Tauri build when work affects:

- The frontend-backend boundary.
- Tauri commands, events, or capabilities.
- Desktop integration, bundling, or application configuration.

Validate only on Windows during normal development. Defer macOS validation to
the release-preparation phase unless explicitly requested earlier.

Final verification commands must be equivalent to or stronger than the
commands required by the applicable specifications.

A package-manager wrapper may replace a required command only when its current
script expands to the same flags and targets. Otherwise, use the required
command directly or include the wrapper-script change in the plan scope.

Negative requirements such as "adds no command" or "does not modify user data"
must state a concrete verification method. Do not prescribe a runtime assertion
unless the framework exposes an API that can observe it.

A plan is complete only when all required checks pass and its completion
criteria are demonstrated.

## Maintaining a Plan

Treat an active implementation plan as a living document.

During implementation:

- Mark completed steps accurately.
- Record material deviations from the planned approach.
- Record decisions that affect later tasks.
- Update interfaces when implementation changes an agreed contract.
- Keep unfinished work and blockers explicit.
- Do not rewrite completed history to make execution appear linear.

When implementation finishes, summarize the outcome, verification evidence,
and any remaining limitations.

## Plan Review Gate

Before approving a plan, verify that:

- Every exact dependency includes an exact version.
- Every listed test file is executed by at least one stated command.
- Every red-test command compiles the intended test target and fails for the
  stated reason rather than passing with zero matching tests.
- Every OS or user-data integration test has an explicit isolation seam.
- Final commands satisfy all flags required by the source specifications.
- The plan contains no Git commit step unless the user requested commits.
