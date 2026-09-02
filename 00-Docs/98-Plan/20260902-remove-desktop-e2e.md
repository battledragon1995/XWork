# Remove Automated Desktop E2E Implementation Plan

**Status:** Implemented

**Goal:** Remove the slow automated desktop end-to-end test stack and make fast
unit, component, Rust integration, Tauri build, and targeted manual Windows
checks the repository-wide verification strategy.

**Completion Criteria:**

- The repository has no `test:e2e` or `typecheck:e2e` script, WebdriverIO
  dependency, `tests/e2e/` tree, E2E-only Tauri configuration, driver patch, or
  CI driver setup.
- Active architecture, roadmap, and feature contracts no longer require
  automated desktop E2E tests and assign native-only behavior to focused manual
  Windows smoke checks.
- The remaining formatter, linter, TypeScript, frontend tests/build, Rustfmt,
  Clippy, Rust tests, and Windows Tauri build pass.

**Architecture:** Fast automated coverage remains at the narrowest reliable
layer: React behavior in unit/component tests and Rust behavior, IPC contracts,
OS adapters, persistence, and process handling in Rust tests. A production
Tauri build remains mandatory for desktop integration changes; behavior that
can only be observed through a real operating-system window is covered by a
small manual Windows checklist during the relevant feature slice and release
preparation.

**Tech Stack:** Vitest 4.1.11, Testing Library, Rust 1.98.0, Cargo 1.98.0,
Tauri 2.11.5, GitHub Actions on Windows.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md`
- Frontend and backend contracts under `00-Docs/02-Frontend/` and
  `00-Docs/03-Backend/`

## Scope

**In Scope:**

- Remove the current WebdriverIO/Tauri E2E implementation and dependencies.
- Remove E2E-only CI, formatting, workspace, patch, and Tauri configuration.
- Update active repository rules, roadmap, architecture documents, and feature
  contracts so future slices do not recreate automated desktop E2E tests.
- Preserve completed implementation plans as historical records while marking
  their E2E strategy as superseded by this plan.

**Out of Scope:**

- Product behavior changes.
- Removing unit, component, Rust integration, contract, or manual smoke tests.
- macOS validation before release preparation.

## Global Constraints

- Use UTF-8 for Markdown files.
- Write code, identifiers, and code comments in English.
- During development, build and test only on Windows.
- Do not mark work complete without a clear verification method.
- Completed implementation-plan history must not be rewritten.

## Assumptions, Risks, and Blockers

**Assumptions:**

- The owner accepts the reduced automated coverage of real WebView2 window
  interaction in exchange for much faster feedback in this personal project.
- Existing and future component/Rust tests remain responsible for all behavior
  that does not strictly require a real operating-system window.

**Risks:**

- Desktop-only regressions can escape automation; targeted manual smoke checks
  and the Windows Tauri build remain mandatory where desktop integration is
  affected.
- Stale feature contracts could recreate E2E infrastructure; a repository-wide
  reference audit mitigates this.

**Blockers:** None.

## Dependency Order

1. Establish the repository-wide verification policy → enables consistent
   feature-contract updates.
2. Remove runtime tooling and CI wiring → enables dependency-lock cleanup.
3. Audit active and historical documentation → prevents accidental revival.
4. Run all remaining automated gates and the Tauri build → proves the reduced
   workflow is healthy.

---

### Task 1: Replace the Desktop E2E Policy

**Outcome:** Active project rules and feature contracts use fast automated
tests plus targeted manual Windows checks instead of desktop E2E.

**Depends On:** None

**Files:**

- Modify: `AGENTS.md`
- Modify: `00-Docs/00-Overview/01-TechStack.md`
- Modify: `00-Docs/00-Overview/02-ProjectStructure.md`
- Modify: `00-Docs/98-Plan/00-Roadmap.md`
- Modify: applicable contracts under `00-Docs/02-Frontend/` and
  `00-Docs/03-Backend/`

**Interfaces:**

- Consumes: existing repository verification rules
- Produces: one repository-wide no-desktop-E2E verification policy

- [x] Replace active desktop E2E requirements with unit/component, Rust
      integration/contract, Tauri build, and native-only manual smoke coverage.
- [x] Verify no active overview, roadmap, or feature contract refers to
      `tests/e2e/`, WebdriverIO, or desktop E2E.

### Task 2: Remove Desktop E2E Tooling

**Outcome:** No executable E2E script, dependency, test tree, driver setup, or
E2E-only configuration remains.

**Depends On:** Task 1

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `biome.json`
- Modify: `.github/workflows/desktop-ci.yml`
- Delete: `tests/e2e/`
- Delete: `src-tauri/tauri.e2e.conf.json`
- Delete: `patches/@wdio__native-core@1.1.0.patch`

**Interfaces:**

- Consumes: current pnpm scripts and CI workflow
- Produces: reduced fast verification command set

- [x] Remove all direct WebdriverIO dependencies through pnpm so the lockfile is
      regenerated consistently.
- [x] Delete E2E-only files and remove their workspace, formatter, and CI hooks.
- [x] Run `pnpm install --frozen-lockfile` and expect an exact clean install.

### Task 3: Verify the Reduced Workflow

**Outcome:** Every remaining automated quality gate passes without desktop E2E.

**Depends On:** Tasks 1 and 2

**Files:**

- Modify: `src/test-setup.ts`
- Modify: `00-Docs/98-Plan/20260902-remove-desktop-e2e.md`

**Interfaces:**

- Consumes: reduced repository scripts
- Produces: recorded verification evidence

- [x] Run the final verification commands below.
- [x] Search executable configuration and active contracts for stale E2E
      references; historical plans may retain references only with an explicit
      supersession note.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Locked install | `pnpm install --frozen-lockfile` | Exact dependency graph installs |
| Frontend format | `pnpm format:check` | No formatting differences |
| Frontend lint | `pnpm lint` | No diagnostics |
| Frontend type check | `pnpm typecheck` | No TypeScript errors |
| Frontend tests | `pnpm test` | All unit/component tests pass |
| Frontend build | `pnpm build` | Production frontend bundle succeeds |
| Rustfmt | `pnpm format:rust` | No formatting differences |
| Clippy | `pnpm lint:rust` | All targets and features pass with warnings denied |
| Rust tests | `pnpm test:rust` | All Rust tests pass |
| Windows Tauri build | `pnpm tauri build` | Production desktop build succeeds |
| Removal audit | `rg -n "test:e2e|typecheck:e2e|tests/e2e|WebdriverIO|@wdio|tauri-driver|msedgedriver" package.json pnpm-workspace.yaml biome.json .github 00-Docs/02-Frontend 00-Docs/03-Backend 00-Docs/98-Plan/00-Roadmap.md` | No executable or active-contract matches |

## Deviations and Decisions

- The first frontend test run exposed 35 unhandled native event-subscription
  errors even though all 124 assertions passed. `src/test-setup.ts` now replaces
  `@tauri-apps/api/event` subscriptions with an inert test implementation, so
  full-shell component tests use an explicit desktop boundary instead of
  reaching for a missing Tauri runtime.
- `pnpm-lock.yaml` still contains the string `@vitest/browser-webdriverio` in
  Vitest's optional peer metadata. That package and WebdriverIO are not
  installed; `pnpm list --depth 0` confirms the root graph contains neither.

## Outcome

The automated desktop E2E stack, scripts, dependencies, test files, patch,
Tauri test configuration, and CI setup were removed. Active project and feature
contracts now use fast frontend tests, Rust tests, Windows Tauri builds, and
targeted manual smoke checks. The locked install, all remaining frontend and
Rust gates, and the production Windows Tauri build pass.
