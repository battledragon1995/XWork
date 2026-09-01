---
name: xwork-detailed-design
description: Create or revise XWork FE-NNN or BE-NNN detailed-design documents that follow 00-Docs/99-Template. Use only when the requested deliverable itself is a detailed-design document. Do not use when the requested deliverable is a plan, implementation plan, roadmap, task breakdown, source implementation, or general design discussion; mentioning FE-NNN, BE-NNN, or detailed design inside such a request does not qualify.
---

# XWork Detailed Design

Create a detailed feature contract that an implementer can follow without inventing product behavior, ownership, public APIs, or failure handling. The skill instructions are English; write XWork project documentation in Vietnamese and keep code identifiers and Rust declarations in English.

## Invocation Gate

Apply this workflow only when the requested deliverable itself is an XWork detailed-design document. A request to create or revise a plan, including a plan for writing or implementing a detailed design, does not qualify. If this skill was selected for a plan-only request, do not use its workflow or templates; handle the request without this skill.

## Boundaries

- Work only in the XWork repository that contains `AGENTS.md`, `00-Docs/99-Template/`, and the Cargo workspace. Ask for the repository root if it cannot be located reliably.
- Produce or revise design documentation. Do not implement source code, modify templates, or broaden the feature unless the user explicitly asks.
- Preserve unrelated and uncommitted changes. Inspect `git status` before editing and keep the final diff limited to the requested design files.
- Treat the current repository as evidence, including partially implemented code. Do not assume that a target tree in documentation already exists on disk.

## Establish the Deliverable

Before drafting:

1. Read every applicable `AGENTS.md` file as UTF-8.
2. Identify whether the request covers Frontend, Backend, or both; identify the `FE-NNN` or `BE-NNN` ID, feature name, phase, and requested output file.
3. Check the relevant overview and existing detailed designs before assigning an ID or path. If the ID or output path is not uniquely established, ask the user instead of silently creating a convention.
4. For a new feature outside the existing overview, do not allocate a new ID or update overview lists unless that work is explicitly in scope.

Use `00-Docs/99-Template/02-Frontend.md` for Frontend and `00-Docs/99-Template/03-Backend.md` for Backend. Use the tech-stack or project-structure templates only when the requested deliverable specifically changes those project-wide documents.

## Inspect the Repository

Complete reconnaissance before asking design questions. Use `rg` or `rg --files` to find related IDs, types, actions, modules, tests, and documents.

Always inspect:

- The selected template in `00-Docs/99-Template/`.
- Relevant sections of `00-Docs/00-Overview/`, especially functional requirements and `02-ProjectStructure.md`.
- The relevant master-plan and phase-plan sections in `00-Docs/98-Plan/`.
- Current Cargo manifests, source modules, public exports, tests, fixtures, and mock scenarios related to the feature.
- Any existing detailed design being revised and any document that references its public contract.

For Frontend work, also inspect:

- `00-Docs/02-Frontend/00-Overview.md` and `01-UIContract.md`.
- The relevant wireframe HTML, shared CSS, and `00-Docs/01-Wireframe/00-Overview.md`; render the wireframe when visual or interaction details cannot be established from source alone.
- Existing view models, actions, state ownership, components, focus handling, and UI tests.

For Backend work, also inspect:

- `00-Docs/03-Backend/00-Overview.md`.
- Relevant feature, storage, application-composition, and platform code, including migrations and repository traits when persistence is involved.
- Existing public models, operations, errors, events, lifecycle behavior, concurrency rules, and tests.

Apply each source to its own domain rather than using a general “newest wins” rule:

- Applicable `AGENTS.md` files govern the work process and repository conventions.
- The selected template governs document shape and required coverage.
- `00-Docs/00-Overview/02-ProjectStructure.md` governs crate responsibility and dependency direction.
- Functional requirements, the UI contract, and wireframes govern intended user-visible behavior.
- Current source, tests, and manifests establish what is implemented now.
- Plans govern sequencing and phase scope.

Record exact evidence paths and relevant symbols. If authoritative sources disagree, treat the disagreement as an ambiguity; do not reconcile it silently.

## Clarification Gate

After reconnaissance, identify decisions that the repository cannot answer. Ask the user before drafting when an unresolved choice could change any of these:

- feature scope, ID, phase, deliverable set, or output path;
- user-visible behavior, state transitions, navigation, focus, confirmation, or acceptance criteria;
- ownership, dependency direction, public types, operation names, or FE–BE boundary;
- validation, invariants, errors, persistence, migrations, transactions, events, background work, cancellation, or concurrency;
- whether the design describes the current implementation or a deliberate target that changes it.

Ask the smallest useful batch of decision-oriented questions. For each question, cite the evidence or conflict, explain what the answer changes, and recommend a resolution only when repository evidence supports one. Do not ask questions whose answers can be discovered from the repository.

Wait for the user's response before writing when an ambiguity blocks a coherent contract. A non-blocking unknown may remain only in the template's open-questions section, with its impact and decision deadline stated precisely. If reconnaissance finds no consequential ambiguity, state that and continue without manufacturing questions.

Never fill a template placeholder with an unsupported assumption. Keep minor, evidence-backed inferences explicit in the working update and ensure they do not conflict with a user decision.

## Write the Design

Reload the selected template immediately before editing so the current repository template, not memory, controls the output.

- Write Markdown as UTF-8 and in Vietnamese, matching existing XWork documentation. Keep identifiers, paths, Rust declarations, and API names in English.
- Preserve the template's heading order and intent. Replace all placeholder rows and values; remove template guidance and sections that the template explicitly permits omitting when they do not apply.
- Do not edit the template itself. Create or update only the agreed detailed-design file or files.
- Trace claims to existing requirements, wireframe plates, plans, paths, symbols, or explicit user decisions. Distinguish current paths/APIs from planned ones.
- Keep the document at contract level. Rust blocks may contain public type declarations and signatures, never function bodies or implementation pseudocode.
- State exclusions and ownership explicitly so the design does not move business rules into UI, persistence into feature crates, or orchestration out of `xwork-app`.
- Make completion criteria observable and implementation-neutral.

For a Frontend design, make inputs, emitted actions, single ownership of state, reset rules, loading/error/empty/disabled/dirty states, data sources, keyboard/focus behavior, confirmations, wireframe mapping, and visual-token references concrete. A data source or business action must reference an operation already defined by the corresponding Backend design; do not invent a Backend operation only inside the Frontend document.

For a Backend design, make public data models, operation signatures, invariants, distinct errors, caller recovery, events, storage boundaries, transactions, upgrade guarantees, resource lifecycle, cancellation, concurrent-call behavior, dependencies, and test cases concrete. Each business rule and documented error must map to at least one test case.

When the request covers both sides, draft the Backend contract first, then the Frontend contract. Cross-check that operation names, input/output types, errors, events, timing, and ownership agree in both documents.

## Verify Before Completion

Re-read the finished files and inspect the focused diff. Verify that:

- no scaffold placeholder or template instruction remains;
- IDs, phases, requirement references, wireframe plates, paths, and symbols exist or are clearly labeled as planned;
- responsibilities and dependencies follow the project-structure matrix;
- current behavior and target changes are not conflated;
- Frontend actions and data sources match Backend operations, or are explicitly UI-only;
- every state has one owner and destructive or data-loss paths have explicit confirmation behavior;
- every Backend rule and error has test coverage in the design;
- completion criteria can be verified without prescribing hidden implementation details;
- unresolved items appear only in the template's open-questions section and are genuinely non-blocking;
- Markdown remains UTF-8 and only intended files changed.

Run repository-provided Markdown checks when they exist. Do not run Cargo quality gates for a documentation-only change unless validation of a Rust declaration requires them or the user requests it.

Report the created or revised file paths, the evidence areas inspected, the decisions supplied by the user, remaining open questions, and the verification performed. Do not claim the feature itself is implemented.
