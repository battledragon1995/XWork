# <Phase / Feature ID and Name> Implementation Plan

**Status:** Draft

**Goal:** [One sentence describing the measurable outcome]

**Completion Criteria:**

- [Observable result that proves the work is complete]
- [Required verification that must pass]

**Architecture:** [Two or three sentences describing the implementation
approach and the important boundaries it preserves]

**Tech Stack:** [Only the technologies and libraries relevant to this plan]

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`
- Requirements: `path/to/requirements.md`
- Frontend spec: `00-Docs/02-Frontend/FE-NNN-<name>.md`
- Backend spec: `00-Docs/03-Backend/BE-NNN-<name>.md`
- Wireframe: `00-Docs/01-Wireframe/<path>`

Remove source entries that do not apply. Do not copy full requirements into
this plan.

## Scope

**In Scope:**

- [Behavior or deliverable included in this plan]

**Out of Scope:**

- [Related behavior intentionally deferred or excluded]

## Global Constraints

- [Applicable version, dependency, naming, platform, or architecture constraint
  copied exactly from its source]

Every task implicitly includes these constraints.

## Assumptions, Risks, and Blockers

**Assumptions:**

- [Assumption supported by the source documents]

**Risks:**

- [Risk and the plan step that mitigates it]

**Blockers:** None.

Do not proceed while a material blocker or unresolved specification question
remains.

## Dependency Order

1. [Task or prerequisite] → enables [dependent task]
2. [Task or prerequisite] → enables [dependent task]

---

### Task N: [Outcome-Oriented Task Name]

**Outcome:** [Observable result produced by this task]

**Depends On:** [Earlier task numbers or `None`]

**Files:**

- Create: `exact/path/to/new-file`
- Modify: `exact/path/to/existing-file`
- Test: `exact/path/to/test-file`

List only files supported by the current repository structure or source
documents. Do not invent line numbers.

**Interfaces:**

- Consumes: [Exact existing interfaces or `None`]
- Produces: [Exact names, parameters, return types, events, or DTOs used by
  later tasks]

- [ ] **Step 1: Add or update the focused test**

  [Describe the behavior the test demonstrates. Prefer a failing test before
  implementation when the behavior is testable at this level.]

- [ ] **Step 2: Verify the test fails for the expected reason**

  Run: `<focused-test-command>`

  Expected: `<specific failure proving the behavior is missing>`

- [ ] **Step 3: Implement the minimum change**

  [Describe the smallest implementation that satisfies the tested behavior.]

- [ ] **Step 4: Verify the task**

  Run: `<focused-test-or-check-command>`

  Expected: `<specific passing result>`

Repeat the task section as needed. Do not include Git commit steps unless the
user explicitly requests commits.

## Final Verification

Include only checks relevant to this plan.

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format/lint | `<command>` | Pass with no errors |
| Frontend type check | `<command>` | Pass with no type errors |
| Frontend tests | `<command>` | All relevant tests pass |
| Rustfmt | `<command>` | No formatting diff |
| Clippy | `<command>` | Pass with warnings denied |
| Rust tests | `<command>` | All relevant tests pass |
| Windows Tauri build | `<command>` | Build succeeds |

## Deviations and Decisions

- None.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

Pending implementation.

When complete, summarize the delivered result, verification evidence, and any
remaining limitations.
