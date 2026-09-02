# AGENTS.md

## Overview

XWork is a local-first desktop application for Windows and macOS, built with Tauri 2, stable Rust (Edition 2024), and a React + TypeScript frontend using shadcn/ui and Animate UI. The repository is currently in the documentation and planning stage; source code has not been scaffolded yet.

## Current Structure

- `00-Docs/00-Overview/`: product idea, tech stack, structure, and requirements.
- `00-Docs/00-Overview/02-ProjectStructure.md`: source of truth for frontend areas, Rust crate responsibilities, dependency rules, and code placement.
- `00-Docs/01-Wireframe/`: HTML/CSS wireframes for the application screens.
- `00-Docs/02-Frontend/`: Frontend feature list (`FE-NNN`).
- `00-Docs/03-Backend/`: Backend feature list (`BE-NNN`).
- `00-Docs/98-Plan/`: implementation plans.
- `00-Docs/99-Template/`: documentation templates.

## Working Rules

- Use UTF-8 for Markdown files.
- Write code, identifiers, and code comments in English.
- The initial UI language is English.
- Keep OS access, persistence, terminal processes, and business rules in Rust; the React frontend communicates with them through narrowly scoped Tauri commands and events.
- Add shadcn/ui and Animate UI components to the repository as source code and keep project-specific changes local to those copied components.

## Comment Rules

- Every function, method, callback, test, and helper must have a short comment describing its purpose.
- Prefer `///` documentation comments immediately above functions.
- Add concise inline comments for complex logic to explain its reasoning, invariants, or important edge cases.
- Do not restate obvious code behavior. Keep comments synchronized with code changes.

## Implementation Plans

- For work that meets the criteria in `PLANS.md`, read and follow `PLANS.md`.
- Store implementation plans under `00-Docs/98-Plan/`.
- Implementation plans are execution-time guides, not living documentation. Once a plan's implementation is complete, treat the plan as a historical record and do not update it for later feature development or user-requested changes unless the user explicitly asks to revise that plan.
- Creating a plan does not authorize source-code implementation.

## Verification

- Write tests for new behavior and bug fixes.
- Do not add or run automated desktop end-to-end tests. Cover frontend behavior
  with unit/component tests, backend and IPC behavior with Rust integration and
  contract tests, and native-window behavior with targeted manual Windows smoke
  checks.
- During development, build and test only on Windows.
- Defer macOS validation until release preparation unless explicitly requested earlier.
- Run the relevant frontend formatter, linter, type checks, and tests, plus Rustfmt, Clippy, and Rust tests before completion.
- Run a Tauri build when changes affect the frontend-backend boundary, capabilities, bundling, or desktop integration.
- Do not mark work complete without a clear verification method.
