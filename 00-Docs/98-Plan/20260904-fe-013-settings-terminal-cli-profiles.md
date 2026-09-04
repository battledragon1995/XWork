# FE-013 Settings Terminal & CLI Profiles Implementation Plan

**Status:** Implemented

**Goal:** Replace the `/settings/terminal-profiles` placeholder with the real
FE-013 page so users can select the default shell, inspect and recheck built-in
profiles, and safely create, edit, recheck, and delete custom CLI profiles
through the implemented BE-006 commands without exposing stored secrets.

**Completion Criteria:**

- `/settings/terminal-profiles` renders the specified English UI, preserves the
  existing Settings route/breadcrumb/navigation contracts, supports every
  loading, empty, availability, mutation, conflict, and failure state in
  FE-013, and exposes all primary actions to keyboard and pointer users.
- Commands, arguments, shell IDs, environment names, and environment values
  cross the existing typed IPC boundary as separate data. Stored secret values
  are never read back, rendered, logged, placed in global state, or written to
  webview storage.
- The event-backed store handles listener lifecycle, coalesced invalidation,
  decimal `u64` revision ordering, stale responses, one persistent mutation at
  a time, and per-profile checks without duplicating backend business state.
- Every focused test and repository-wide frontend/Rust gate passes on Windows,
  `pnpm tauri build` succeeds, and the targeted manual Windows checklist proves
  real shell discovery, availability refresh, persistence, secret handling,
  destructive confirmation, and narrow-window accessibility.

**Architecture:** Add one typed CLI Profiles adapter under `src/lib/ipc/`, one
retained Zustand store under the existing Settings feature, pure form mapping
and validation helpers, and feature-local presentation components. React owns
only the current snapshot reference, transient editor draft, pending-operation
state, focus, and error presentation; BE-006 remains the sole owner of shell
discovery, command resolution, persistence, credential access, validation
authority, and committed revisions. Every event is treated as invalidation and
causes a fresh snapshot read; generated bindings are consumed verbatim and no
backend or generated file is changed.

**Tech Stack:** React 19.2.8, TypeScript 7.0.2, Zustand 5.0.15, React Router
8.3.1, Tailwind CSS 4.3.3, existing source-owned shadcn/ui primitives over
`radix-ui` 1.6.7, Lucide React 1.39.0, Tauri API 2.11.1, Vitest 4.1.11,
Testing Library 16.3.3, and the generated BE-006 TypeScript contract. No npm
or Cargo dependency is added; the form uses controlled React state rather than
adding the not-yet-installed React Hook Form or Zod packages.

**Sources:**

- Project instructions: `AGENTS.md`
- Planning rules: `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md` (Stage 7 — CLI profiles)
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md` (§10.2,
  §10.3, §17.3, §18, and the applicable Phase 1 completion criteria in §20)
- Frontend prerequisite:
  `00-Docs/02-Frontend/FE-011-settings-frame-general-and-about.md`
- Frontend specification:
  `00-Docs/02-Frontend/FE-013-settings-terminal-cli-profiles.md`
- Backend specification: `00-Docs/03-Backend/BE-006-cli-profiles.md`
- Implemented generated contract:
  `src/bindings/terminal/cli-profiles.ts`
- Wireframe: `00-Docs/01-Wireframe/02-AppShell.html#settings-terminal`

## Scope

**In Scope:**

- Replace only the existing `terminal-profiles` Settings child placeholder;
  retain `/settings/terminal-profiles`, the seven-item sub-navigation, and the
  `Settings / Terminal & CLI Profiles` breadcrumb.
- Read the complete BE-006 snapshot and render the persisted/effective default
  shell, exactly three read-only built-ins, custom profiles in backend order,
  commands, availability text, checked time, and row actions.
- Select a valid default shell, recheck any saved profile without executing its
  command, and refresh from the backend after every invalidation or explicit
  check.
- Create and edit custom profiles with name, command, ordered literal argument
  rows, inherited or concrete shell, icon text, synchronized native color/hex
  inputs, and ordered environment rows with explicit Secret behavior.
- Preserve a stored secret by omitting `value`, replace it with a newly entered
  value, support valid empty strings, and require a new value path when a
  stored secret is renamed or converted to plain text. Never reconstruct or
  display an old secret.
- Confirm dirty-editor discard and profile deletion with the exact destructive
  labels and impact copy from FE-013. Keep already running terminals untouched.
- Implement local, platform-independent structural validation for quick field
  feedback while leaving OS path semantics and final validation to BE-006.
- Cover adapter, pure form helpers, store concurrency, route, tables, editor,
  dialogs, errors, keyboard behavior, and accessibility with isolated unit and
  component tests.
- Run complete frontend/Rust regression gates, a Windows Tauri build, and a
  targeted manual Windows smoke pass against disposable data.

**Out of Scope:**

- FE-006 New Session/tool selection, recently used tools, session ownership, or
  rewriting stale tool selections after a profile is deleted.
- FE-008 terminal rendering, PTY creation, process launch, working directory,
  shell encoding, terminal output, or process lifecycle.
- Editing/deleting Codex, Claude, or Terminal built-ins; profile reordering;
  importing/exporting/resetting data; or About-page terminal details.
- Arbitrary user-supplied shell executables. The UI selects only stable IDs
  returned by the backend shell catalog.
- Reading a secret from Credential Manager, copying it, revealing it, exporting
  it, or claiming that `hasStoredValue` proves the native credential still
  exists.
- Any Rust source/test, migration, capability, Tauri configuration, generated
  binding, npm/Cargo manifest, or lockfile change.
- Automated desktop end-to-end tests, macOS validation before release
  preparation, speculative shared abstractions, or Git commit steps.

## Global Constraints

- Write code, identifiers, UI text, and code comments in English. Keep Markdown
  UTF-8 and retain Vietnamese only in the repository specifications.
- Every function, method, callback, helper, component, and test added or changed
  has a short purpose comment. Add reasoning comments for revision ordering,
  asynchronous listener teardown, refresh coalescing, and secret preservation.
- React owns presentation and temporary draft state. Rust owns OS access,
  persistence, command discovery, shell resolution, credential access, and all
  final business validation.
- All frontend calls use `src/lib/ipc/cli-profiles.ts`; no Settings component or
  store imports Tauri APIs, accesses the filesystem/database/credential store,
  or invokes a command directly.
- Consume `src/bindings/terminal/cli-profiles.ts` verbatim. Do not duplicate its
  public DTO/error/event types and never edit any generated binding manually.
- The implemented error union is code-only (`{ code }`). Local validation owns
  field placement; backend rejections are classified only by `code`. Do not
  depend on the stale BE-006 prose that mentions nonexistent `message` or
  `field` properties.
- Keep command, every argument, environment name/value, and shell ID in separate
  fields. Never parse a command line, split on whitespace, interpret quotes,
  or join an executable and arguments into a shell string.
- A secret draft stays inside the mounted editor. Do not put it in Zustand,
  URLs, local/session storage, IndexedDB, cookies, logs, error strings, DOM
  snapshots, reusable test fixtures, or serialized debug output. Release draft
  references when the sheet closes; JavaScript cleanup is best effort and must
  not be described as memory zeroization.
- Use a native `<select>`, `<input type="color">`, existing `Input`, `Switch`,
  `Button`, `Tooltip`, and `Dialog`. Keep sheet/table/form behavior local to
  `src/features/settings/`; do not modify shared UI primitives for one feature.
- Compare revision strings as non-negative decimal integers by normalized
  length and lexical order. Do not convert the backend `u64` revision to a
  JavaScript `number`.
- Treat `cli-profiles://changed` as invalidation only. Refresh the complete
  snapshot; never patch configuration from the event payload. Coalesce bursts
  to at most one queued refresh after the current refresh.
- Permit at most one create/update/delete/default-shell request at a time.
  Track checks by profile ID, suppress a duplicate check for the same ID, and
  refresh after a successful check because its result has no revision.
- Local validation uses `TextEncoder` for UTF-8 byte limits and
  `Array.from(value).length` for Unicode scalar limits. It mirrors only the
  platform-independent FE-013 rules; BE-006 remains authoritative for bare vs.
  absolute executable rules and every persisted invariant.
- Built-ins never render Edit/Delete. The editor's `Check command` is enabled
  only for a clean, already persisted custom profile; dirty/new drafts must say
  `Save changes before checking.` rather than checking stale data.
- Do not add or run automated desktop end-to-end tests. Automated tests mock the
  typed IPC wrapper and event listener, use controlled promises for races, and
  never read or write real XWork data, shell state, commands, or credentials.
- Validate only on Windows during development. Defer macOS validation until
  release preparation.

## Assumptions, Risks, and Blockers

**Assumptions:**

- Roadmap prerequisites Stages 4 and 6 are complete. FE-011 already owns the
  Settings frame, `SETTINGS_SECTIONS`, `/settings/terminal-profiles`, its
  breadcrumb, and the current FE-013 placeholder.
- BE-006 is implemented, its six commands are registered for the `main` window,
  `cli-profiles://changed` is emitted, startup checks run, native credential
  behavior is covered by existing Rust tests, and the committed generated
  binding matches the Rust source.
- `CliProfilesSnapshotDto.profiles` is already ordered Codex, Claude, Terminal,
  then custom creation order. FE-013 does not sort or promote recently used
  profiles.
- Successful persistent commands return a complete post-commit snapshot.
  `check_cli_profile` returns only one profile without revision, so the frontend
  always schedules a full refresh afterward.
- `system` is a valid persisted default choice when returned in the catalog;
  `effectiveDefaultShellId` identifies the currently resolved concrete shell.
  A custom profile with absent `shellId` inherits the global default.
- Existing shared UI primitives support focus trapping, Escape handling,
  accessible naming, and class overrides needed to render the right-side sheet;
  no shared component change is required.

**Risks:**

- Startup checks or a rapid mutation can make reads and events arrive out of
  order. Task 2 proves decimal revision comparison, stale-response rejection,
  event coalescing, request invalidation, and late-listener cleanup before any
  screen uses the store.
- React Strict Mode or route churn can duplicate listeners. Task 2 uses a
  consumer count plus subscription generation and verifies one live listener,
  immediate disposal of a late registration, and no state publication from an
  invalidated request.
- A stored secret can leak through convenient fixture reuse, DOM assertions, or
  draft serialization. Task 3 uses only non-sensitive sentinel input in focused
  tests, checks absence from rendered/global state, never snapshot-serializes
  the editor, and tests the exact `undefined`/replacement mapping.
- A dirty editor can silently overwrite an imported/reset profile because the
  update DTO is full replacement and has no optimistic version field. Tasks 3
  and 5 compare editable source fields, refresh clean drafts automatically, and
  block dirty saves until `Reload Profile` resolves the conflict.
- The wireframe's one-line Arguments field invites accidental command-line
  parsing. Tasks 3 and 5 model ordered rows and explicitly cover spaces, quotes,
  backslashes, and empty-string arguments end to end.
- `Dialog` defaults to a centered surface. Task 5 supplies feature-local sheet
  positioning, tests modal focus/close semantics, and avoids changing the
  shared primitive used by existing dialogs.
- Event listener registration can fail while commands still work. Tasks 2 and
  4 preserve the usable snapshot, show a non-blocking live-update warning, and
  provide an explicit Refresh action.
- Real shell discovery, `PATH` changes, Credential Manager, and high UI scaling
  cannot be proven by jsdom. Task 7 uses an isolated disposable Windows profile,
  non-sensitive smoke data, a production Tauri build, and explicit cleanup.

**Blockers:** None. FE-013 has `Câu hỏi mở: Không có`; the implemented binding
resolves the BE-006 error-shape prose discrepancy without a backend change.

## Dependency Order

1. Task 1 establishes the exact typed command/event adapter → enables the store
   in Task 2.
2. Task 2 establishes snapshot ownership, revisions, subscriptions, mutations,
   and error classification → enables every route-level interaction.
3. Task 3 establishes pure draft/validation/secret mapping → enables the editor
   without mixing security rules into presentation.
4. Task 4 establishes the real route, read states, default-shell control, and
   profile tables over Tasks 1–2 → enables modal orchestration.
5. Task 5 adds the accessible editor over Tasks 2–4 and the form contract from
   Task 3 → enables complete create/update/conflict flows.
6. Task 6 adds destructive confirmation and closes all operation/error paths →
   enables slice-wide verification.
7. Task 7 runs all automated/native gates and records the actual outcome.

---

### Task 1: Add the Typed CLI Profiles IPC Boundary

**Outcome:** One frontend adapter exposes all six implemented BE-006 commands
and the invalidation event with generated types, exact camelCase argument
objects, normalized errors, and a returned unlisten callback.

**Depends On:** None

**Files:**

- Create: `src/lib/ipc/cli-profiles.ts`
- Create/Test: `src/lib/ipc/cli-profiles.test.ts`

**Interfaces:**

- Consumes: `CliProfileDto`, `CliProfileInputDto`,
  `CliProfilesChangedDto`, `CliProfilesError`, and
  `CliProfilesSnapshotDto` from
  `src/bindings/terminal/cli-profiles.ts`; shared
  `invokeCommand<TResult, TError>`; Tauri `listen` and `UnlistenFn`.
- Produces:
  `getCliProfiles(): Promise<CliProfilesSnapshotDto>`,
  `createCliProfile(input: CliProfileInputDto): Promise<CliProfilesSnapshotDto>`,
  `updateCliProfile(profileId: string, input: CliProfileInputDto): Promise<CliProfilesSnapshotDto>`,
  `deleteCliProfile(profileId: string): Promise<CliProfilesSnapshotDto>`,
  `setDefaultCliShell(shellId: string): Promise<CliProfilesSnapshotDto>`,
  `checkCliProfile(profileId: string): Promise<CliProfileDto>`, and
  `onCliProfilesChanged(handler): Promise<UnlistenFn>`.
- Test seam: mock `@tauri-apps/api/core.invoke` and
  `@tauri-apps/api/event.listen`; no test starts Tauri or touches native state.

- [x] **Step 1: Add the focused adapter test**

  Create the test first. Assert every exact command name, omitted arguments for
  `get_cli_profiles`, `{ input }`, `{ profileId, input }`, `{ profileId }`, and
  `{ shellId }` payloads, unchanged generated DTO results, preservation of each
  tagged code-only error, normalization of malformed rejection to a null
  payload, exact `cli-profiles://changed` subscription, payload forwarding, and
  return of the Tauri unlisten function.

- [x] **Step 2: Verify the adapter test fails for the expected reason**

  Run:
  `pnpm exec vitest run src/lib/ipc/cli-profiles.test.ts`

  Expected: Vitest discovers the named test file and fails because
  `src/lib/ipc/cli-profiles.ts` or its documented exports do not exist; it must
  not pass with zero tests.

- [x] **Step 3: Implement the minimum typed adapter**

  Add one private `invokeCliProfiles` helper over `invokeCommand`, one wrapper
  per command, the event constant, event payload unwrapping, and an `UnlistenFn`
  type re-export. Do not transform DTOs, inspect secret fields, or expose Tauri
  imports beyond this adapter.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/lib/ipc/cli-profiles.test.ts src/lib/ipc/settings.test.ts src/lib/ipc/projects.test.ts`

  Expected: all three adapter targets pass; CLI Profiles uses the exact BE-006
  names and payloads while the shared error boundary and existing wrappers do
  not regress.

### Task 2: Build the Event-Backed Snapshot Store

**Outcome:** A retained feature store loads the backend snapshot, orders updates
by decimal revision, coalesces invalidation reads, safely owns one event
listener, serializes persistent mutations, tracks checks by profile ID, and
classifies operation-specific failures.

**Depends On:** Task 1

**Files:**

- Create: `src/features/settings/cli-profile-error-copy.ts`
- Create: `src/features/settings/cli-profiles-store.ts`
- Create: `src/features/settings/cli-profiles-test-fixture.ts`
- Create/Test: `src/features/settings/cli-profiles-store.test.ts`

**Interfaces:**

- Consumes: every Task 1 wrapper; generated snapshot/profile/error types; the
  FE-013 state and error tables.
- Produces: `CliProfilesStatus`, `CliProfilesMutationKind`,
  `CliProfilesFailure`, `CliProfilesState`, `useCliProfilesStore`,
  `resetCliProfilesStore()`, and the actions `acquire`, `release`, `refresh`,
  `create`, `update`, `remove`, `setDefaultShell`, `check`, and `clearFailure`
  with the signatures in FE-013.
- Produces internal helpers for normalized decimal revision comparison,
  operation-specific error classification, snapshot acceptance, refresh
  coalescing, and test fixtures that never contain a real secret value.
- Test seam: mock every Task 1 wrapper; use deferred promises, captured event
  callbacks, fake unlisten functions, and deterministic snapshots. No
  process-global environment, timer, filesystem, database, shell, or credential
  state is read or changed.

- [x] **Step 1: Add focused store tests before the store**

  Cover initial loading/success/failure, cached-snapshot refresh, listener
  failure, one listener for the first consumer, final release, a registration
  that resolves after release, request invalidation after unmount, event bursts
  during an in-flight read, `0`/equal/large-`u64` decimal revisions, stale read
  and mutation responses, one persistent mutation at a time, full-snapshot
  replacement, per-ID check suppression, check-followed-by-refresh, and reset
  isolation. Exercise every generated error code in its valid operation plus an
  unknown transport rejection; assert error copy never includes a command,
  environment value, credential account, or raw rejection text.

- [x] **Step 2: Verify the store test fails for the expected reason**

  Run:
  `pnpm exec vitest run src/features/settings/cli-profiles-store.test.ts`

  Expected: the target is discovered and fails because
  `cli-profiles-store.ts`, `cli-profile-error-copy.ts`, or the fixture exports
  are missing.

- [x] **Step 3: Implement the error mapping, fixtures, and store**

  Implement a module-level subscription generation, active unlisten set,
  request token, in-flight refresh marker, one queued-refresh flag, and a
  decimal-string comparator. Register the listener before the first snapshot
  read settles; refresh whether registration succeeds or fails. Treat event
  payloads only as invalidation hints. Keep an accepted snapshot during refresh
  or retryable failure, reject older revisions, and let equal revision replace
  only an equivalent/current response path.

  Implement one mutation claim/release path for create/update/delete/default
  shell. Apply only accepted returned snapshots. For check, track the ID,
  ignore the returned DTO as store authority, and schedule/coalesce a full read
  when the command settles successfully. Clear checking/mutation state in
  `finally`, but do not erase a newer operation's failure.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/cli-profiles-store.test.ts src/lib/ipc/cli-profiles.test.ts`

  Expected: both targets pass; held-promise assertions prove listener teardown,
  coalescing, stale-revision rejection, mutation exclusion, and check refresh
  without native access.

### Task 3: Define Pure Profile Draft, Validation, and Secret Mapping

**Outcome:** Pure helpers create/edit/compare/validate drafts and build the
exact generated input DTO while preserving literal arguments and implementing
stored-secret keep/replace/rename/type-change rules without presentation or IPC.

**Depends On:** Task 2

**Files:**

- Create: `src/features/settings/cli-profile-form.ts`
- Create/Test: `src/features/settings/cli-profile-form.test.ts`
- Modify: `src/features/settings/cli-profiles-test-fixture.ts`

**Interfaces:**

- Consumes: `CliProfileDto`, `CliProfileInputDto`,
  `CliProfileEnvironmentDto`, `CliProfilesSnapshotDto`, and the limits in
  FE-013/BE-006.
- Produces: `CliProfileDraft`, `CliEnvironmentDraft`, stable row-key factories,
  an empty create draft, DTO-to-edit-draft mapping, dirty comparison based only
  on editable source fields, a structured field/group error result, and
  `buildCliProfileInput(draft): CliProfileInputDto`.
- Test seam: pure generated-type fixtures with sentinel names and values. A
  stored-secret fixture has `value: null` plus `hasStoredValue: true`; no real
  credential or developer secret is used.

- [x] **Step 1: Add focused pure-helper tests**

  Cover the empty draft defaults (`>_`, `#64748b`, inherited shell, zero
  argument/environment rows), DTO mapping, clean/dirty comparison that ignores
  availability/effective-shell changes, name/command/icon trim, lowercase
  color, `TextEncoder` byte limits, Unicode scalar limits, exact argument order,
  spaces/quotes/backslashes/empty arguments, 128/129 argument boundaries,
  32-KiB total arguments, 64/65 environment boundaries, environment regex,
  ASCII-case-insensitive duplicates, valid empty plain/secret values, and NUL.

  Test secret payloads separately: new and replacement secrets send `value`
  including `""`; an unchanged stored secret with the same name sends
  `value: undefined`; rename or conversion to plain cannot reuse the old secret;
  toggling back can explicitly choose `Keep stored value` and drops the typed
  replacement from the built payload. Assert input building does not trim,
  split, escape, or join arguments.

- [x] **Step 2: Verify the helper test fails for the expected reason**

  Run:
  `pnpm exec vitest run src/features/settings/cli-profile-form.test.ts`

  Expected: Vitest discovers the target and fails because
  `cli-profile-form.ts` or its draft/validation/mapping exports are missing.

- [x] **Step 3: Implement the pure helpers**

  Keep row keys frontend-only and omit them from DTOs. Use `TextEncoder` and
  `Array.from` for the documented limits. Mirror platform-independent checks;
  map backend `invalidCommand` to Command rather than attempting a second OS
  path parser. Build optional fields with `undefined`, never `null`, exactly as
  the generated input binding declares. Do not stringify or log the built
  payload.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/cli-profile-form.test.ts`

  Expected: every boundary and secret-state case passes, including literal
  argument round-trip and absence of any old stored plaintext value.

### Task 4: Replace the Placeholder with the Read-Only Page and Tables

**Outcome:** The real route loads and refreshes BE-006 data, renders the default
shell and both profile groups, exposes safe check/edit/delete affordances by
profile kind, and preserves the existing Settings shell contract.

**Depends On:** Tasks 1–2

**Files:**

- Create: `src/features/settings/cli-profile-table.tsx`
- Create: `src/features/settings/settings-terminal-profiles-route.tsx`
- Create/Test:
  `src/features/settings/settings-terminal-profiles-route.test.tsx`
- Modify: `src/app/app-router.tsx`
- Modify/Test: `src/app/app-router.test.tsx`

**Interfaces:**

- Consumes: `useCliProfilesStore`, `SettingsSection`, generated profile/shell
  DTOs, existing `Button`/`Tooltip`, and `SETTINGS_SECTIONS` routing metadata.
- Produces: `SettingsTerminalProfilesRoute(): JSX.Element` as the feature's only
  public export; internal `CliProfileTable`, `ProfileMark`,
  `AvailabilityBadge`, and route-owned selection callbacks for later modal
  tasks.
- Test seam: mock `src/lib/ipc/cli-profiles.ts` before importing the route,
  return fixture snapshots, capture event handlers, and reset the store after
  each case. Existing route tests add the same complete mock so they never call
  Tauri or touch real shell/profile data.

- [x] **Step 1: Add the route and page tests first**

  Change the existing router assertion for `/settings/terminal-profiles` from
  the FE-013 placeholder to the real page while keeping other deferred routes
  parameterized. Add the new component target for initial loading, first-read
  failure/retry, retained refresh, listener warning/Refresh, default/effective
  shell display, `system`, unavailable/missing catalog entries, built-in order,
  custom order, custom-empty state, 100-profile limit, every availability
  state, checked-time fallback, local table overflow, icon/color fallback, and
  action visibility by `kind`.

- [x] **Step 2: Verify the page tests fail for the expected reason**

  Run:
  `pnpm exec vitest run src/features/settings/settings-terminal-profiles-route.test.tsx src/app/app-router.test.tsx`

  Expected: both targets are discovered; the new page import/export is missing
  and the existing router still renders `This section arrives with FE-013.`
  instead of a `Default shell` control and real profile groups.

- [x] **Step 3: Implement the read page, tables, and route registration**

  Acquire/release the store in the route. Render the exact header/help copy,
  loading/error/refresh/listener/empty/limit states, a native default-shell
  select, backend-ordered groups, readable command/argument display, textual
  availability, local-time check metadata, and icon-only actions with tooltip
  plus accessible name. Never use joined display arguments as data.

  Wire check and default-shell actions to store methods. Keep Edit/Delete as
  route-owned selection state hooks for Tasks 5–6. Disable incompatible actions
  while a persistent mutation is active, but do not erase the visible committed
  snapshot. Replace only the `terminal-profiles` route element in
  `settingsSectionElement`.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/settings-terminal-profiles-route.test.tsx src/features/settings/cli-profiles-store.test.ts src/app/app-router.test.tsx`

  Expected: all three targets pass; the real route, store-backed read states,
  default-shell/check calls, built-in read-only actions, breadcrumb,
  sub-navigation, and deferred sibling placeholders agree.

### Task 5: Add the Accessible Create/Edit Sheet

**Outcome:** Users can create or edit a custom profile in a right-side modal
sheet with literal argument rows, safe secret controls, local validation,
backend errors, conflict reload, dirty-close confirmation, and deterministic
focus behavior.

**Depends On:** Tasks 2–4

**Files:**

- Create: `src/features/settings/cli-profile-editor.tsx`
- Create/Test: `src/features/settings/cli-profile-editor.test.tsx`
- Modify: `src/features/settings/settings-terminal-profiles-route.tsx`
- Modify/Test:
  `src/features/settings/settings-terminal-profiles-route.test.tsx`

**Interfaces:**

- Consumes: Task 3 draft/validation/build helpers; store `create`, `update`, and
  `check`; current shell/profile snapshot; existing `Dialog`, `Button`, `Input`,
  `Switch`, and `Tooltip` primitives.
- Produces: internal `CliProfileEditor` with controlled `open`, create/edit
  source, close, saved, and check callbacks; feature-local argument/environment
  row controls; `DiscardChangesDialog`; page-level create/edit orchestration.
- Test seam: pass mocked callbacks and fixture DTOs into the editor; hold
  promises to observe pending state. Use only `DUMMY_FE013_SECRET` as a
  non-sensitive value and assert it is absent after close without snapshotting
  the DOM or serializing component state.

- [x] **Step 1: Add focused editor tests**

  Cover sheet position/class contract, title and initial focus, focus trap and
  restoration, create defaults, edit mapping, built-in refusal, label/error
  associations, add/remove/move argument rows, literal values, shell inheritance
  and available concrete choices, icon/color synchronization, environment
  add/remove/order, Secret switch, `Stored securely`, Replace/Cancel replace,
  stored-secret-to-plain, empty values, local validation/focus-first-error,
  create/update payloads, pending lockout, safe retry errors, clean vs. dirty
  Check enablement, clean-source refresh, dirty external conflict, Reload
  Profile, profile disappearance, and dirty close from Close/Escape/outside
  interaction with `Discard Profile Changes`.

- [x] **Step 2: Verify the editor test fails for the expected reason**

  Run:
  `pnpm exec vitest run src/features/settings/cli-profile-editor.test.tsx`

  Expected: the named target is discovered and fails because
  `cli-profile-editor.tsx` and its modal form do not exist.

- [x] **Step 3: Implement the editor and page orchestration**

  Render `DialogContent` as `min(520px, 100vw)` at the right edge with an
  independently scrolling body and fixed header/footer. Keep the draft inside
  the mounted editor. Intercept Escape, outside interaction, Close, and Cancel
  when dirty; disable dismissal while a save is pending. Render zero-row empty
  states plus explicit Add actions, accessible move/remove controls, and
  `aria-describedby` links for field/group errors.

  On save, validate then build one full replacement DTO. Success closes the
  sheet, releases plaintext references, accepts the store snapshot, and
  announces completion. Failure retains the draft only for the active sheet and
  uses code-safe copy. Compare refreshed editable source fields: update a clean
  draft, block a dirty save on conflict, and require Reload. If the source ID
  disappears, close and clear the editor.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/cli-profile-editor.test.tsx src/features/settings/cli-profile-form.test.ts src/features/settings/settings-terminal-profiles-route.test.tsx`

  Expected: all three targets pass; presentation and pure helpers agree on
  every input, secret, validation, conflict, close, focus, and mutation rule.

### Task 6: Add Delete Confirmation and Complete Operation Recovery

**Outcome:** Custom-profile deletion is explicitly confirmed and every page,
row, shell, check, editor, and delete operation has the documented pending,
success, stale-object, retryable, and integration-failure behavior.

**Depends On:** Tasks 2, 4–5

**Files:**

- Create: `src/features/settings/delete-cli-profile-dialog.tsx`
- Create/Test:
  `src/features/settings/delete-cli-profile-dialog.test.tsx`
- Modify: `src/features/settings/cli-profile-table.tsx`
- Modify: `src/features/settings/settings-terminal-profiles-route.tsx`
- Modify/Test:
  `src/features/settings/settings-terminal-profiles-route.test.tsx`
- Modify/Test: `src/features/settings/cli-profiles-store.test.ts`

**Interfaces:**

- Consumes: store `remove`, `clearFailure`, mutation/failure state, custom
  `CliProfileDto`, and existing dialog/button primitives.
- Produces: internal `DeleteCliProfileDialog` with controlled target, cancel,
  confirm, success, and stale-target callbacks; completed route-level alert and
  live-region behavior for all operation classes.
- Test seam: pass a fixture custom profile and mocked remove callback; use held
  promises and injected `profileNotFound`/`persistenceFailed`/unknown failures.
  No test launches or inspects a process and no test touches persisted data.

- [x] **Step 1: Add focused delete and recovery tests**

  Assert built-ins cannot open the dialog; custom Delete opens it with the exact
  profile name, impact copy, initial focus on `Cancel`, and destructive label
  `Delete Profile`. Cover cancel/focus restoration, pending lockout, success
  announcement, running-terminal copy, retryable persistence/transport failure,
  `profileNotFound` auto-close plus refresh, unexpected built-in/unauthorized
  integration failure, and target disappearance after an event.

  Extend the page/store target so every documented error code is exercised in
  an applicable operation, default-shell rollback is observable, duplicate
  row checks are suppressed, stale operation completion cannot close a newer
  dialog/editor, and `aria-live`/`role="alert"` regions announce without moving
  focus unexpectedly.

- [x] **Step 2: Verify the delete test fails for the expected reason**

  Run:
  `pnpm exec vitest run src/features/settings/delete-cli-profile-dialog.test.tsx src/features/settings/settings-terminal-profiles-route.test.tsx`

  Expected: both targets are discovered; the delete target fails because the
  confirmation component is missing, and the page target fails its new
  delete/recovery assertions rather than passing with zero tests.

- [x] **Step 3: Implement deletion and finish page recovery**

  Add the controlled confirmation dialog and route selection state. Call
  `remove` only after explicit confirmation. Keep the dialog open on retryable
  failure, close it on success or stale target, and never synthesize session
  impact counts the backend does not provide. Finish safe status/error copy,
  mutation disablement, announcements, and cleanup across route unmounts.

- [x] **Step 4: Verify the integrated frontend slice**

  Run:
  `pnpm exec vitest run src/lib/ipc/cli-profiles.test.ts src/features/settings/cli-profile-form.test.ts src/features/settings/cli-profiles-store.test.ts src/features/settings/cli-profile-editor.test.tsx src/features/settings/delete-cli-profile-dialog.test.tsx src/features/settings/settings-terminal-profiles-route.test.tsx src/app/app-router.test.tsx`

  Expected: all seven named targets are discovered and pass; adapter, pure
  mapping, store, editor, delete confirmation, page, route, breadcrumb, and
  existing Settings-shell behavior form one consistent FE-013 slice.

### Task 7: Run Slice-Wide Verification and Windows Smoke Checks

**Outcome:** FE-013 passes every applicable automated gate and its real Windows
shell/profile/credential behavior is demonstrated without using a developer's
normal XWork data or credentials.

**Depends On:** Tasks 1–6

**Files:**

- Modify:
  `00-Docs/98-Plan/20260904-fe-013-settings-terminal-cli-profiles.md`
  (checklists, deviations, verification evidence, and outcome only)

**Interfaces:**

- Consumes: every interface and artifact from Tasks 1–6 plus the implemented
  BE-006 commands/event, SQLite persistence, shell resolver, and native
  credential adapter.
- Produces: recorded automated results, manual Windows observations, material
  deviations, and the final implementation outcome.
- Isolation: run automated frontend tests only with mocked IPC. Run manual UI
  smoke from a disposable Windows user profile whose XWork app-data directory
  and Credential Manager contain no developer data. Create only a uniquely
  named `FE013 Smoke yyyyMMdd-HHmmss` custom profile and a non-sensitive
  `XWORK_FE013_SMOKE_SECRET`; delete the profile before discarding the Windows
  profile. Do not redirect or mutate process-global `APPDATA`, `PATH`,
  `PATHEXT`, `COMSPEC`, `HOME`, or `CODEX_HOME`.

- [x] **Step 1: Run focused and repository-wide automated gates**

  Execute every automated row in Final Verification. Record the actual result
  in this plan. Fix genuine failures without weakening assertions, generated
  contracts, capabilities, lint, warnings, type safety, or backend tests.

- [x] **Step 2: Run the targeted manual Windows checklist**

  From the disposable Windows user profile, launch `pnpm tauri dev` and complete
  every numbered item under Manual Windows Smoke Check. Do not add or run an
  automated desktop end-to-end test.

- [x] **Step 3: Record deviations and final outcome**

  Append material decisions/deviations without rewriting completed history.
  Set Status accurately and replace the pending Outcome with delivered
  behavior, exact command results, manual evidence, and any remaining deferred
  FE-006/FE-008 limitations.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Focused FE-013 tests | `pnpm exec vitest run src/lib/ipc/cli-profiles.test.ts src/features/settings/cli-profile-form.test.ts src/features/settings/cli-profiles-store.test.ts src/features/settings/cli-profile-editor.test.tsx src/features/settings/delete-cli-profile-dialog.test.tsx src/features/settings/settings-terminal-profiles-route.test.tsx src/app/app-router.test.tsx` | All seven named targets are discovered and every adapter, form, secret, store, event, revision, editor, dialog, page, route, breadcrumb, and Settings regression assertion passes |
| Frontend format | `pnpm format:check` | No formatting differences |
| Frontend lint | `pnpm lint` | Pass with no lint errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Full frontend tests | `pnpm test` | All unit/component tests pass; no automated desktop end-to-end test is added |
| Frontend production build | `pnpm build` | The SPA bundle succeeds with the real FE-013 route and typed BE-006 adapter |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No Rust formatting difference |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Every Rust target and feature passes with warnings denied |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | All existing Rust unit, integration, contract, binding, Windows resolver, credential, and composition tests pass unchanged |
| Windows desktop build | `pnpm tauri build` | Tauri produces a Windows build whose frontend can invoke all registered BE-006 commands and receive the invalidation event |
| No dependency drift | `git diff --exit-code -- package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock` | No npm or Cargo manifest/lockfile change exists in this slice |
| No generated/backend drift | `git diff --exit-code -- src/bindings src-tauri/src src-tauri/tests src-tauri/migrations` | No generated binding, Rust source/test, or migration change exists in this slice |
| No capability/config drift | `git diff --exit-code -- src-tauri/capabilities src-tauri/tauri.conf.json` | No capability or Tauri configuration change exists in this slice |
| Narrow Tauri boundary | `rg -n '@tauri-apps/|invoke\(' src/features/settings` | No match is returned; all Tauri access remains in `src/lib/ipc/cli-profiles.ts` |
| No webview persistence | `rg -n --glob 'cli-profile-*' --glob '!*.test.*' 'localStorage|sessionStorage|indexedDB|document\.cookie' src/features/settings src/lib/ipc/cli-profiles.ts; rg -n 'localStorage|sessionStorage|indexedDB|document\.cookie' src/features/settings/settings-terminal-profiles-route.tsx` | No production-source match is returned |
| No command-line reconstruction | `rg -n --glob 'cli-profile-*' --glob '!*.test.*' 'arguments\.join|commandLine|shellCommand|split\(' src/features/settings src/lib/ipc/cli-profiles.ts` | No production-source match is returned; literal argument behavior remains covered by tests |
| Built-ins remain read-only | `rg -n 'builtin:|builtIn' src/features/settings/cli-profile-editor.tsx src/features/settings/delete-cli-profile-dialog.tsx` | Matches, if any, are only defensive rejection/guard branches; tests prove no built-in Edit/Delete affordance |

## Manual Windows Smoke Check

Use `pnpm tauri dev` from the disposable Windows user profile described in Task
7. Do not point the checklist at a developer's normal XWork app data or
credentials. Use only non-sensitive dummy values and remove the smoke profile
before deleting the disposable Windows profile.

1. Open Settings → Terminal & CLI Profiles. Expected: the existing Settings
   frame and 220-px sub-navigation remain intact, the route and breadcrumb are
   correct, the FE-013 placeholder is gone, and the page shows Default shell,
   three built-ins, and the custom empty state.
2. Inspect `System default` and every returned concrete shell. Expected: the
   persisted selection stays `System default` while the effective shell name
   and command identify the real resolved shell; unavailable choices cannot be
   selected, and keyboard navigation/focus are visible.
3. Check Codex, Claude, and Terminal. Expected: the app never launches them;
   each row moves through `Checking…` to `Available`, `Command not found`, or
   `Shell not found`, includes a safe checked time, and Check again reflects an
   executable installed after the first result.
4. Create `FE013 Smoke yyyyMMdd-HHmmss` with an absolute or bare command, an
   argument containing spaces, an empty argument, inherited shell, custom icon
   and color, one plain environment variable, and one Secret variable named
   `XWORK_FE013_SMOKE_SECRET` with a dummy value. Expected: fields remain
   separate, save succeeds even if the command is unavailable, and the list
   receives the committed snapshot/status.
5. Close and reopen the editor and then fully Quit/reopen XWork. Expected: name,
   command, exact argument boundaries/order, shell, icon, color, and plain value
   persist; the secret only says `Stored securely` and no plaintext appears in
   the DOM, DevTools console, error UI, or application log.
6. Replace the dummy secret, cancel one replacement, save another replacement,
   convert it to plain with a newly entered value, and convert it back to
   Secret. Expected: cancel keeps the stored value, replace never reveals the
   old value, valid empty strings save, and no operation silently reuses a
   secret after rename/type change.
7. Add/reorder/remove argument and environment rows using only the keyboard.
   Expected: focus indicators and labels remain visible, every row action has a
   textual accessible name/tooltip, and the saved order matches the editor after
   reopening.
8. Dirty the editor and close it via Close, Escape, and outside interaction.
   Expected: each path reaches `Discard profile changes?`; `Discard Profile
   Changes` is the only destructive exit and focus returns to the initiating
   row or button.
9. Force a safe recoverable error, such as saving while the disposable
   profile's credential service is unavailable if the environment permits.
   Expected: committed data stays visible, the draft stays only in the open
   sheet, the message contains no secret/path/account detail, and retry does not
   submit twice. If the failure cannot be induced safely, record it as covered
   by the existing BE-006 native/fake-adapter tests plus frontend mocked tests;
   do not damage Credential Manager to manufacture it.
10. Delete the smoke profile. Expected: the dialog names the profile, says
    running terminals are unaffected and future selections lose it, initially
    focuses Cancel, requires `Delete Profile`, then removes the profile after
    the real backend commit. Built-ins never expose Delete.
11. At a narrow window width and the minimum/maximum interface scales already
    supported by FE-012, inspect both tables and the sheet. Expected: only the
    table container scrolls horizontally, the sheet body scrolls vertically,
    the application shell gains no unintended document overflow, and all focus
    indicators remain visible.
12. Delete any remaining smoke profile, fully Quit XWork, and discard the
    disposable Windows user profile. Expected: no smoke app data or credential
    remains in the developer's normal Windows profile.

## Plan Review Gate

- [x] FE-013 has no open question, Stage 7 prerequisites are implemented, and
  the plan uses the committed Rust-generated contract as the error-shape source
  of truth while explicitly recording the stale BE-006 prose.
- [x] Every exact dependency already exists at an exact manifest version; the
  plan adds no dependency and therefore leaves no version choice to the
  implementer.
- [x] Every new source/test path is established by FE-013 and the project
  structure; every named test file is selected by a focused and final command.
- [x] Every red command discovers its named target and fails for a stated
  missing module/export, real-route expectation, component, or behavior rather
  than passing with zero matching tests.
- [x] Adapter tests mock Tauri, store tests inject callbacks/promises, form tests
  are pure, component tests inject wrapper behavior, and manual native work uses
  a disposable Windows user profile plus non-sensitive unique data.
- [x] Listener registration failure, initial snapshot failure, every mutation
  class, stale responses, dirty conflicts, profile disappearance, and native
  credential failure each name an injection seam and observable result.
- [x] Secret handling, decimal revision ordering, coalesced refresh, persistent
  mutation exclusion, literal arguments, and built-in immutability have focused
  tests before presentation integration.
- [x] Negative requirements have concrete checks for dependencies, generated
  bindings/backend, capabilities/config, direct Tauri access, webview
  persistence, command-line reconstruction, and built-in mutation affordances.
- [x] Final frontend format/lint/typecheck/tests/build, Rustfmt, Clippy with
  warnings denied and all targets/features, Rust tests, and Windows Tauri build
  meet or exceed FE-013, BE-006, PLANS.md, and repository requirements.
- [x] No automated desktop end-to-end test, macOS validation, speculative
  dependency, source implementation, or Git commit step is included.

## Deviations and Decisions

- `CliEnvironmentDraft` carries one extra frontend-only field, `storedName: string | null`,
  beside the fields listed in FE-013. Without the name the credential was saved under, a
  renamed secret row could not be told from an untouched one, so `buildCliProfileInput` could
  not decide between omitting `value` and sending a new one. The field never leaves the sheet
  and never reaches a DTO.
- The store publishes `status: "loading"` for every read, including a refresh over a retained
  snapshot, instead of adding a separate `isRefreshing` flag. `loading` with a snapshot is the
  `Đang refresh` state and `loading` without one is the first read, which is exactly the pair
  FE-013 describes, so no state beyond the documented shape was introduced.
- Focus restoration on close is implemented in `CliProfileEditor` rather than left to the
  Radix focus scope. The opener is captured on the opening render because a child effect
  inside the modal has already moved focus by the time the component's own effects run.
- Row actions use accessible names that include the profile name (`Check command for Codex`,
  `Edit Gemini CLI`, `Delete Gemini CLI`) while their tooltips keep the wireframe wording
  (`Check command`, `Edit`, `Delete profile`), so several rows never share one accessible name.
- The effective default shell is reported as `Resolves to <name> (<command>).` FE-013 requires
  the concrete shell to be named next to a persisted `System default` but fixes no wording.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

**Delivered.** `/settings/terminal-profiles` now renders `SettingsTerminalProfilesRoute`
instead of the FE-013 placeholder. The slice adds one typed adapter
(`src/lib/ipc/cli-profiles.ts`) over the six BE-006 commands and the
`cli-profiles://changed` event, one event-backed store
(`src/features/settings/cli-profiles-store.ts`) with decimal `u64` revision ordering,
coalesced invalidation, a single listener per consumer set, one persistent mutation at a
time and per-profile checks, pure draft/validation/payload helpers
(`cli-profile-form.ts`), safe error copy (`cli-profile-error-copy.ts`), the read page and
tables (`settings-terminal-profiles-route.tsx`, `cli-profile-table.tsx`), the right-side
create/edit sheet (`cli-profile-editor.tsx`) and the destructive confirmation
(`delete-cli-profile-dialog.tsx`). No backend, generated binding, capability, Tauri
configuration, dependency or lockfile was touched.

### Automated verification (Windows, 2026-09-04)

| Scope | Result |
|---|---|
| Focused FE-013 tests (seven named targets) | Pass — 338 tests |
| `pnpm format:check` | Pass — no differences |
| `pnpm lint` | Pass — no errors, no warnings |
| `pnpm typecheck` | Pass — no type errors |
| `pnpm test` | Pass — 47 files, 1121 tests |
| `pnpm build` | Pass |
| `cargo fmt --check` | Pass |
| `cargo clippy --all-targets --all-features -- -D warnings` | Pass |
| `cargo test --all-targets --all-features` | Pass — every existing suite unchanged |
| `pnpm tauri build` | Pass — `src-tauri/target/release/xwork.exe` |
| No dependency drift | Pass — no diff |
| No generated/backend drift | Pass — no diff |
| No capability/config drift | Pass — no diff |
| Narrow Tauri boundary | Pass — no `@tauri-apps/` or `invoke(` under `src/features/settings` |
| No webview persistence | Pass — no match |
| No command-line reconstruction | Pass — no match |
| Built-ins remain read-only | Pass — the only guard is the editor's defensive `kind` check; the delete dialog opens for `kind === "custom"` only, and tests prove built-in rows render no Edit or Delete |

### Manual Windows smoke check

**Not run.** Every numbered item under *Manual Windows Smoke Check* needs a person driving
`pnpm tauri dev` from a disposable Windows user profile with its own XWork app data and
Credential Manager. Real shell discovery, `PATH` changes, credential round-trips and high
interface scaling cannot be proven from jsdom, so this remains open and the slice is not
fully verified until it is done.

### Remaining limitations

- FE-006 (New Session tool selection, recently used tools) and FE-008 (terminal rendering,
  process launch) stay out of scope, so a deleted profile is not rewritten out of a stale
  session tool selection; BE-005/BE-006 report that at the next launch.
- `hasStoredValue` only says a credential reference exists. A credential deleted outside
  XWork still shows `Stored securely`; the failure surfaces at launch time, and the recovery
  is Edit → Replace value → Save.
