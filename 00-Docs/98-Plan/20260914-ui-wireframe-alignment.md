# UI Wireframe Alignment Implementation Plan

**Status:** In progress

**Goal:** Correct the visual mismatches recorded on 2026-09-13 using existing application capabilities, with one commit per audited screen/function.

**Completion Criteria:**

- Each of the 56 audit findings has a verified fix or an explicit limitation where the existing backend does not support the wireframe.
- The 17 screen/function groups each have a separate commit, including their focused verification evidence.
- Frontend formatting, lint, type checking and relevant unit/component tests pass.
- Targeted Windows visual checks cover the changed layouts and controls using the existing debug executable with Vite dev; no build is run, as explicitly requested by the user.

**Architecture:** React presentation and temporary UI state change in their existing feature owners. App composition connects existing public feature slots; Rust remains the owner of persistence, OS access, files, processes and business rules. Existing IPC contracts and generated bindings are preserved.

**Tech Stack:** Existing React, TypeScript, Tailwind, Lucide, Radix, Animate UI, CodeMirror and Vitest versions in package.json. No package dependency change is planned. Wireframe fonts are self-hosted assets with their licenses, keeping runtime offline and CSP unchanged.

**Sources:**

- AGENTS.md and PLANS.md.
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md` (existing implemented capabilities).
- `00-Docs/00-Overview/01-TechStack.md`, `02-ProjectStructure.md`, `03-FunctionalRequirements.md`.
- Frontend contracts FE-001 and FE-003 through FE-023 under `00-Docs/02-Frontend/`; each task reads the applicable layout, behavior and verification sections before implementation.
- Wireframe design: `00-Docs/01-Wireframe/00-Design.md` and `assets/wireframe.css`.
- Wireframe decks: `02-AppShell.html` through `07-Calendar.html` under `00-Docs/01-Wireframe/`.
- Audit: `00-Docs/97-Issue/UI/00-Overview.md` and its 17 linked reports and original screenshots.

## Scope

**In Scope:** Existing screen layout, density, typography, palette, iconography, control states, scrolling, footer visibility and presentation of data already exposed by public APIs. Fix the Markdown rendering blocker if reproducible within the existing frontend file boundary. The user's new visual direction supersedes historical presentation choices where they caused the reported mismatch.

**Out of Scope:** New backend functionality, startup integration, updater/public support links without real destinations, invented diagnostics or fixtures in runtime, source/wireframe redesign, macOS checks, desktop E2E, dependency upgrades and all builds. The user explicitly selected existing functionality only and requested recording missing capabilities. The original audit remains a historical baseline.

## Global Constraints

- React owns presentation and temporary UI state.
- Rust owns OS access, persistence, terminal processes, and business rules.
- Frontend-backend communication uses narrowly scoped Tauri commands and events.
- Generated bindings under `src/bindings/` are not edited manually.
- Write code, identifiers, and code comments in English.
- Use UTF-8 for Markdown files.
- Tests must not read or write the developer's real app data, configuration, credentials, projects, or other user-owned state.
- Do not add or run automated desktop end-to-end tests.

## Assumptions, Risks, and Blockers

- One function means one of the 17 audit groups; shared shell primitives belong to task 1, and settings groups remain separate commits.
- The real app currently uses 15px UI / 16px terminal, while the wireframe is authored at 14px / 13px. Layout must tolerate scaling instead of resetting user settings.
- Custom themes remain supported. Default Cream presentation should match the wireframe; custom-color readability must not regress.
- User authorization covers implementation and local commits, not push or publishing.
- Existing unit/component fixtures and mocked IPC adapters are the test isolation seams. Native smoke uses existing data and read/navigation actions; no destructive commands or production fixtures.
- Existing executable availability may limit native validation. No binary rebuild is allowed in this task; any inability to exercise changed frontend is recorded.

## Dependency Order and Tasks

Task 1 supplies shared tokens and typography. Tasks 2–17 follow audit order; later tasks reuse existing feature slots and shared primitives. Each row is a bounded task, with interfaces, exact established implementation targets and a focused test command. Each task includes reading its matching FE contract and reference frames, adding/updating behavior tests where behavior changes, implementing the smallest correction, checking the rendered result and committing only that function plus its plan entry. CSS-only changes use visual verification rather than implementation-mirroring assertions.

| Task | Outcome / audit group | Implementation files (under src/) | Consumed / produced interfaces | Focused verification |
|---|---|---|---|---|
| 1 | Shell: fonts, Cream selection, primary label, collapsed footer | index.css; app/app-sidebar.tsx; components/animate-ui/primitives/effects/highlight.tsx; features/settings/appearance-theme.ts | buildAppearanceStyle, existing sidebar/highlight props; same theme output contract | `pnpm exec vitest run src/app/app-sidebar.test.tsx src/components/animate-ui/primitives/effects/highlight.test.tsx src/features/settings/appearance-theme.test.ts src/features/settings/appearance-theme-sync.test.tsx` |
| 2 | Home: date header, two columns, composer, compact summary rows | features/home/home-screen.tsx; features/home/home-presentation.ts; app/home-entry.tsx; features/notes/quick-note-composer.tsx; features/notes/note-sections.tsx; features/calendar/calendar-sections.tsx | HomeScreen slots and existing notes/calendar/home query props; presentation only | `pnpm exec vitest run src/features/home src/app/home-entry.test.tsx src/features/notes/quick-note-composer.test.tsx src/features/notes/note-sections.test.tsx src/features/calendar/calendar-sections.test.tsx` |
| 3 | Projects: grid density, existing metadata, overview two columns | features/projects/project-card.tsx; projects-route.tsx; project-overview-route.tsx; project-session-list.tsx; app/project-overview-entry.tsx | Existing project/session/Git reads, composition slots | `pnpm exec vitest run src/features/projects src/app/project-overview-entry.test.tsx` |
| 4 | Sessions/panes: tool marks, responsive picker, dark controls, browse entry | features/sessions/session-tool-picker.tsx; session-tool-card.tsx; session-workspace.tsx; session-pane.tsx; pane-content-picker.tsx; features/terminal/terminal-actions.tsx; app/session-terminal-route.tsx | Existing tool catalog, renderFileExplorer and pane callbacks; no process contract changes | `pnpm exec vitest run src/features/sessions src/features/terminal/terminal-actions.test.tsx src/app/session-terminal-route.test.tsx` |
| 5 | Files: tree icons/chrome, file title, dark editor, Markdown blocker | features/files/file-tree.tsx; file-explorer.tsx; source-view-adapter.ts; markdown-editor-adapter.ts; file-facts.ts; features/sessions/session-tab.tsx | Existing file handles, FileInfo DTO and tab content; no generated binding edits | `pnpm exec vitest run src/features/files src/features/sessions/session-tab.test.tsx src/lib/ipc/files.test.ts` |
| 6 | Notes: compact filters, footer navigation, editor toolbar and archive context | features/notes/notes-route.tsx; note-editor.tsx; note-actions.tsx | Existing notes provider/editor callbacks; temporary selection state only | `pnpm exec vitest run src/features/notes/notes-route.test.tsx src/features/notes/note-editor.test.tsx src/features/notes/note-actions.test.tsx` |
| 7 | Quick Note: visible footer, continuous editor, wordmark chrome | features/notes/quick-note-window.tsx; quick-note-composer.tsx | Existing quick-note save/cancel/close and shortcut state | `pnpm exec vitest run src/features/notes/quick-note-window.test.tsx src/features/notes/quick-note-composer.test.tsx` |
| 8 | Calendar: header/controls, legend, selected date, fixed event footer and grouped form | features/calendar/calendar-route.tsx; calendar-month.tsx; calendar-agenda.tsx; calendar-missed.tsx; event-create-dialog.tsx; event-form.tsx | Existing calendar query and form state/save/reminder DTOs | `pnpm exec vitest run src/features/calendar` |
| 9 | Palette: match highlight, keyboard chips, available commands and meaningful icons | features/search/command-palette.tsx; search-result-row.tsx | Existing search results/availability; rendering and ordering only | `pnpm exec vitest run src/features/search` |
| 10 | Notification panel: concise footer | features/notifications/notification-center.tsx | Existing notification state and settings navigation | `pnpm exec vitest run src/features/notifications/notification-center.test.tsx` |
| 11 | General: ink switches, fixed-state labels, language field | features/settings/settings-general-route.tsx; components/ui/switch.tsx | Existing read-only General snapshot; no autostart | `pnpm exec vitest run src/features/settings/settings-general-route.test.tsx` |
| 12 | Appearance: two-column controls, compact editable swatches, ink selection/slider | features/settings/settings-appearance-route.tsx; appearance-color-field.tsx; appearance-preset-cards.tsx; appearance-terminal-preview.tsx; components/ui/slider.tsx | Existing appearance editor/patch/contrast behavior | `pnpm exec vitest run src/features/settings/settings-appearance-route.test.tsx src/features/settings/appearance-color-field.test.tsx src/features/settings/use-appearance-editor.test.ts` |
| 13 | Profiles: tool marks, lighter table, compact sheet and secondary actions | features/settings/cli-profile-table.tsx; cli-profile-editor.tsx | Existing CLI profile validation/environment/argument model | `pnpm exec vitest run src/features/settings/settings-terminal-profiles-route.test.tsx src/features/settings/cli-profile-editor.test.tsx` |
| 14 | Shortcuts: group order, compact search/table/status | features/settings/settings-keyboard-shortcuts-route.tsx | Existing registry, recorder and restore callbacks | `pnpm exec vitest run src/features/settings/settings-keyboard-shortcuts-route.test.tsx src/features/settings/shortcut-recorder-dialog.test.tsx` |
| 15 | Notifications settings: right-column checklist and fixed switch | features/settings/settings-notifications-route.tsx | Existing settings patch and fixed reminder rules | `pnpm exec vitest run src/features/settings/settings-notifications-route.test.tsx` |
| 16 | Data: path/action row, backup icons, reset facts box | features/settings/settings-data-route.tsx; data-operation-dialog.tsx | Existing backup/reset confirmation boundaries unchanged | `pnpm exec vitest run src/features/settings/settings-data-route.test.tsx src/features/settings/data-operation-dialog.test.tsx` |
| 17 | About: wordmark/metadata layout and explicit missing capability record | features/settings/settings-about-route.tsx | Existing app info only; no fake support links or diagnostic values | `pnpm exec vitest run src/features/settings/settings-about-route.test.tsx` |

Paths abbreviated after a feature prefix in a row remain within that feature directory. Additional existing directly related files may be listed in the corresponding progress entry when inspection establishes them.

## Final Verification

| Scope | Command / method | Expected result |
|---|---|---|
| Frontend format/lint | `pnpm format:check`; `pnpm lint` | No errors |
| TypeScript | `pnpm typecheck` | No errors |
| Tests | Focused commands above, then `pnpm test` | All relevant behavior remains correct; no tests touch real app data |
| Rust formatting | `pnpm format:rust` | No formatting diff |
| Rust source scope | `git diff 0ead337 -- src-tauri` | No changes; Rust behavior checks are unnecessary for presentation-only changes |
| Windows visual smoke | Run `pnpm dev` and the existing debug XWork executable; inspect changed screens against saved references | Main content, selected controls, dark surfaces and fixed footers remain visible at current UI scale |
| Commit scope | `git status --short`; per-commit `git show --stat`; `git diff --check` | One function per commit, no unrelated changes |
| Builds | Omitted by explicit user instruction on 2026-09-14 | No Vite production or Tauri/Rust build command |

## Progress and Verification Evidence

- Planning: original audit and source constraints reviewed. Working tree clean at baseline `0ead337`. User confirmed existing capabilities only and waived builds.
- Task 1 complete: self-hosted the three wireframe font families (Latin/extended Latin/Vietnamese, original OFL licenses); restored Cream selection surfaces and white coral labels while retaining custom-theme contrast choice; clipped the sidebar hover layer to its animated rail. Three theme assertions failed before the correction. All 77 focused tests passed after updating the sync expectation; TypeScript and changed-file Biome checks passed. Windows smoke at existing 15px UI scale confirmed Cream active state and collapsed/expanded rail without footer spill. Existing binary plus Vite dev used; no build.
- Task 2 complete: date-led header; composer/Notes left and live summaries right; continuous labelled composer with conditional Cancel; one Notes empty state; compact session/project rows, relative timestamps with absolute tooltips, and a bounded Git summary for each visible recent project. The shared `src/components/project-git-summary.tsx` and test use the already registered `get_project_git_summary` command through a new wrapper; no backend/DTO change. Query responses are retired across maintenance/unmount and refresh on foreground. Existing aggregate Notes/Calendar sections were restyled at their owning files. All 200 focused tests, changed-file Biome and TypeScript passed. Windows Home at 1280×800/current 15px scale shows Save, Notes, Sessions, Git branch and Upcoming without scrolling. Session empty action remains Open Projects because Home does not own session creation.
- Task 3 complete: three-column grid at the standard scaled window; compact Git and confirmed session counts; Sessions/Changes lead the left column, recent files/Notes/Events occupy the right. Added `use-project-session-counts.ts` and `recent-project-files.tsx` with isolated tests and a wrapper for the existing registered `list_recent_files` command. Recent files are a read-only summary, not a new file-opening/session workflow. The New event link consumes a one-shot Calendar navigation intent only after scope validation. Notes actions moved to their header. The initial 415 project/Calendar tests passed; 30 focused query/composition/intent/IPC tests plus 18 card/recent tests passed after additions. TypeScript passed. Windows smoke verified actual branch/counts, recent AGENTS.md/package.json, two-column overview, and a project-prefilled New Event sheet. No build or backend changes.
- Task 4 complete: three-column tool picker, built-in marks with custom profile colors preserved, compact icon-only terminal actions and readable dark pane controls. Browse files opens the existing Explorer and activates the target pane; container queries keep narrow pane choices readable. All 326 focused tests, changed-file Biome, TypeScript and diff checks passed. Native Windows smoke verified the tool grid, terminal header/toolbar, split-pane layout and Browse files opening Explorer. No terminal command was typed and no build was run.
- Task 5 complete: compact Explorer toolbar/root row, Lucide tree icons and inline selected-entry menu; default file tabs show the active filename while other names remain unchanged. Source and Markdown edit gutters/scrollbars stay readable on terminal surfaces. A failing JSON-number test reproduced the audit's bigint crash; normalization fixes it while preserving exact bigint callers. Newly accessible Markdown Preview exposed dark-on-dark text, corrected to the wireframe's canvas surface, with readable Edit/Preview controls. All 369 Files/tab/IPC tests plus 7 final Markdown tests, TypeScript, Biome and diff checks passed. Windows smoke opened AGENTS.md in Edit and Preview and package.json in source view without writing to disk. No build. The DTO has no custom-name flag: the literal default `New Tab` receives the presentation fallback.
- Tasks 6–17: pending.

## Deviations and Decisions

- Historical plans and the 2026-09-13 audit are not edited.
- The requested wireframe correction replaces the older default font fallback and Cream color derivation choices; custom themes and existing behavior remain supported.
- Missing backend capabilities are listed in the outcome, rather than replaced with nonfunctional controls.

## Outcome

Pending implementation and verification.
