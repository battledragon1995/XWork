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

Roadmap phase plans use `NN-<phase-name-kebab>.md`.

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

Do not add speculative abstractions, dependencies, directories, or future
features.

Do not include Git commit steps unless the user explicitly requests commits.

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
