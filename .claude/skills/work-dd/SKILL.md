---
name: work-dd
description: Create or update one implementation-ready detailed design contract for a specified XWork frontend (FE-NNN) or backend (BE-NNN) feature. Use for feature-level design documentation, not source-code implementation or broad product architecture.
---

# XWork Detailed Design

Create one detailed design document for the XWork feature named by the user. The input must identify exactly one frontend or backend feature, preferably by its `FE-NNN` or `BE-NNN` code.

## Resolve the feature

1. Work from the repository root.
2. Determine whether the input is frontend or backend from its code. For a name-only input, search the feature-name rows in both overview files just far enough to resolve the match, then read only the selected overview in full.
3. If the input is missing, matches multiple entries, or spans more than one feature, stop and ask the user to select one feature. Do not silently split or broaden the request.
4. Locate the exact overview row and use its assigned code, phase, area or capability, requirement references, and feature name as authoritative metadata.

## Gather evidence

Read Markdown as UTF-8. Read these sources before designing:

- `00-Docs/00-Overview/02-ProjectStructure.md`
- `00-Docs/00-Overview/03-FunctionalRequirements.md`, especially every section referenced by the selected overview row and any shared interaction requirements that apply
- For frontend input: `00-Docs/02-Frontend/00-Overview.md`
- For backend input: `00-Docs/03-Backend/00-Overview.md`
- The applicable template:
  - Frontend: `00-Docs/99-Template/02-Frontend.md`
  - Backend: `00-Docs/99-Template/03-Backend.md`

Inspect all wireframe files and anchors listed for a frontend feature in its overview row. For a backend feature with user-visible behavior, use the requirement references and domain to find the related frontend overview entries, then inspect their listed wireframe anchors. Do not infer backend behavior from visual layout alone. If no frontend feature meaningfully represents the backend capability, state that no wireframe applies instead of inventing one.

Inspect the current codebase after reading the product documents:

- Use `rg --files` to discover the current `src/`, `src-tauri/`, `tests/`, and detailed-design files without assuming the planned tree has already been scaffolded.
- Read only source, tests, migrations, configuration, generated public contracts, and existing detailed designs relevant to the selected feature and its dependencies.
- Treat implemented behavior and existing public contracts as evidence, but surface any conflict with the overview, requirements, structure rules, or wireframe instead of silently choosing one source.
- Read `00-Docs/00-Overview/01-TechStack.md` or another directly referenced project document when its constraints affect a design decision.

## Resolve ambiguity before writing

Finish the document and codebase research first. Then identify unresolved choices that would materially change any of the following:

- user-visible behavior, destructive actions, or accessibility behavior;
- public DTO, command, event, channel, error, or feature export contracts;
- persistence schema, migration, ownership, lifecycle, concurrency, or security boundaries;
- file scope, dependencies, performance limits, or verification criteria;
- conflicts between authoritative documents, wireframes, and current code.

Do not ask about facts already established by the repository. Group the remaining questions concisely, include the evidence that makes each choice ambiguous, and offer a recommended default when possible. Stop and wait for the user's answers before writing the design. Do not hide an unresolved decision in implementation detail.

If the target detailed-design file already exists and the user did not explicitly request an update, report that fact and ask whether it should be updated. Never overwrite it silently.

## Write the design

Use the applicable template as the document structure and follow every instruction embedded in it.

- Write the project document in Vietnamese, matching the repository documentation; keep paths, identifiers, signatures, types, and code snippets in English.
- Save frontend output to `00-Docs/02-Frontend/FE-NNN-<english-kebab-name>.md`.
- Save backend output to `00-Docs/03-Backend/BE-NNN-<english-kebab-name>.md`.
- Derive a concise English kebab-case name from the authoritative feature name. Ask only if more than one filename would be materially plausible.
- Fill every applicable template field with concrete, implementation-ready contracts. Remove instructional blockquotes and optional sections only where the template explicitly permits removal.
- Keep the document at contract level. Specify signatures, data shapes, behavior, invariants, ownership, errors, edge cases, and observable verification without pasting full implementation.
- List every source, registration, migration, configuration, generated-contract input, and test file that implementation may touch. Do not label files as new or modified.
- Preserve the frontend/backend boundary and dependency rules from the project structure. Do not hand-author generated bindings.
- For frontend designs, cover the exact wireframe states and interactions, keyboard access, loading, empty, error, and feature-specific states. Use existing backend detailed designs for IPC contracts when available; flag missing or conflicting backend contracts explicitly.
- For backend designs, make schema, DTOs, command signatures, validation, side effects, typed errors, event or channel guarantees, business invariants, security limits, blocking work, and tests precise enough to implement directly.
- Make completion criteria independently verifiable. Include tests for new behavior and relevant Windows-only development checks; include a Tauri build criterion when the documented boundary or desktop integration requires it.
- Do not implement source code, edit the overview, alter the template, or design adjacent features unless the user separately requests it.
- Set `Câu hỏi mở` to `Không có` only when all material decisions have actually been resolved. Otherwise retain the unresolved questions and state that implementation must wait.

## Verify the result

Before finishing:

1. Compare the design against the selected overview row, every cited requirement section, each relevant wireframe anchor, current code, and existing counterpart contracts.
2. Confirm the code, phase, target path, requirement references, dependencies, and FE/BE relationships are consistent.
3. Search the output for template placeholders such as `NNN`, `<...>`, and instructional text; none may remain except literal syntax that is intentionally part of a contract.
4. Confirm every implementation path mentioned by the design appears in `File liên quan`, including tests and registration or migration files.
5. Run `git diff --check` and inspect the focused diff. Do not change unrelated files.

Report the saved path, the main resolved design decisions, any remaining open questions, and the verification performed.
