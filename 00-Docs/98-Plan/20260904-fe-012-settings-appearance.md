# FE-012 Settings Appearance Implementation Plan

**Status:** Implemented (manual Windows smoke check outstanding)

**Goal:** Deliver the real `/settings/appearance` page so every supported mode,
preset, interface color, terminal color, and text-size change previews across the
whole application, persists through the existing BE-008 commands, survives an
application restart, and can be restored to Appearance defaults.

**Completion Criteria:**

- `/settings/appearance` replaces the FE-012 placeholder with the six specified
  rows, accessible keyboard controls, exact loading/save/error behavior, live
  whole-window preview, serialized persistence, and Appearance-only restore.
- The saved or drafted Appearance snapshot is the only source used to apply the
  effective theme, document zoom, derived interface tokens, terminal tokens,
  and native control color scheme; system theme changes update the window
  without a backend write.
- All focused tests and repository-wide frontend/Rust gates pass on Windows,
  `pnpm tauri build` succeeds, and the targeted manual Windows smoke checklist
  proves persistence, system-theme response, live preview, and layout behavior
  at both interface-size bounds.

**Architecture:** Extend the retained FE-011 Zustand store with an Appearance
draft and a single-flight mutation queue. React owns draft, editor, validation,
and presentation state; every durable change still crosses the existing narrow
BE-008 Tauri command boundary and replaces the frontend snapshot with the full
backend response. A single `AppearanceThemeSync` mounted at the application
composition root converts `appearanceDraft ?? snapshot.appearance` into root
attributes and CSS variables, keeping preview and committed rendering on one
path without webview persistence or backend changes.

**Tech Stack:** React 19.2.8, TypeScript 7.0.2, Zustand 5.0.15, React Router
8.3.1, Tailwind CSS 4.3.3, source-owned shadcn/ui components over the existing
`radix-ui` 1.6.7 package, Vitest 4.1.11, Testing Library, Tauri 2.11.x, and the
existing generated BE-008 TypeScript contract.

**Sources:**

- Project instructions: `AGENTS.md`
- Planning rules: `PLANS.md`
- Roadmap: `00-Docs/98-Plan/00-Roadmap.md` (Stage 6 — Settings foundation)
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md` (§17.2 and §18)
- Frontend prerequisite: `00-Docs/02-Frontend/FE-011-settings-frame-general-and-about.md`
- Frontend spec: `00-Docs/02-Frontend/FE-012-settings-appearance.md`
- Backend contract: `00-Docs/03-Backend/BE-008-settings-persistence.md`
- Wireframe: `00-Docs/01-Wireframe/02-AppShell.html#settings-appearance`

## Scope

**In Scope:**

- Replace only the Appearance child placeholder in the existing Settings frame;
  retain its `/settings/appearance` path and `Settings / Appearance` breadcrumb.
- Render the exact page header, restore action, six rows, three mode choices,
  three preset cards, separate Light/Dark interface-color editor, terminal
  background/foreground plus 16 ANSI colors, static terminal preview, and the
  two integer size sliders specified by FE-012.
- Extend the existing settings IPC adapter and store for `update_settings`,
  `restore_appearance_defaults`, preview drafts, classified save failures,
  retry, single-flight writes, pending-patch coalescing, and startup bootstrap.
- Validate strict `#rrggbb` input and the four BE-008 contrast rules locally so
  invalid drafts can preview but never reach the backend; continue treating the
  backend as the final authority.
- Apply committed and previewed Appearance values across the one main window by
  synchronizing `data-theme`, `color-scheme`, `zoom`, interface CSS variables,
  terminal CSS variables, and the complete static Dark token table.
- Add focused unit/component coverage, repository regression coverage, one
  Windows Tauri build, and targeted manual Windows smoke checks.

**Out of Scope:**

- Sidebar `widthPx`/`collapsed` persistence, which is a separate FE-001
  extension in Roadmap Stage 6.
- General and About behavior from FE-011, or implementation of FE-013, FE-014,
  FE-015, and FE-023 Settings sections.
- A real terminal, WTerm integration, or a terminal consumer of the published
  `--terminal-*` variables; FE-008 owns those behaviors.
- Additional or named custom presets, a fourth built-in preset, a third-party
  color picker, or a custom HSV panel.
- Global text-size shortcuts, `Ctrl` + mouse-wheel scaling, conversion of
  existing fixed-pixel typography to `rem`, or Quick Note window theme sync.
- Any Rust, migration, Tauri command/DTO/event, generated binding, capability,
  bundling configuration, dependency, or automated desktop end-to-end change.
- macOS validation before release preparation.

## Global Constraints

- Write code, identifiers, and code comments in English; keep Markdown UTF-8
  and the initial user interface in English.
- Every function, method, callback, test, and helper added or changed has a
  short purpose comment; add concise reasoning comments only where queueing,
  validation, cleanup, or lifecycle behavior is not obvious.
- React owns presentation and temporary draft state. Durable settings and
  validation authority remain in Rust, reached only through wrappers under
  `src/lib/ipc/`; frontend code does not access the database, filesystem, OS
  persistence, or Tauri `invoke` directly.
- Use the generated types in `src/bindings/settings.ts` verbatim and never edit
  that file manually. Snapshot results from every successful command replace
  the whole store snapshot rather than being patched locally.
- FE-012 adds no npm or Cargo dependency. The source-owned Slider uses the
  already pinned `radix-ui` 1.6.7 package; the native color input is
  `<input type="color">`.
- Feature-specific controls and helpers stay under `src/features/settings/`.
  Only the reusable shadcn/ui Slider belongs under `src/components/ui/`.
- Do not send `sidebar`; do not send an empty top-level or Appearance patch;
  do not combine a built-in `themePreset` with `interfaceColors` or
  `terminalPalette`; color patches include their complete backend-owned value.
- Use `document.documentElement.style.zoom = interfaceFontSizePx / 14` and do
  not compensate `--terminal-font-size` for that scale. Round `--ui-scale` to
  four decimal places as specified.
- Interface font size is an integer in `12..=20`; terminal font size is an
  integer in `10..=24`; both sliders use step `1` and support Arrow, Home, and
  End keyboard behavior.
- Debounce valid color and size commits for 300 ms, flush a valid pending commit
  on unmount, discard an unpersistable invalid draft on unmount, and allow at
  most one `update_settings` request in flight.
- Do not add or run automated desktop end-to-end tests. Use unit/component
  tests, existing Rust tests, a Windows Tauri build, and targeted manual Windows
  smoke checks. Defer macOS validation until release preparation.
- Tests mock IPC and `matchMedia`, use controlled promises/fake timers for
  concurrency and debounce, restore document-root mutations after each case,
  and never read or write real XWork app data or other user-owned state.

## Assumptions, Risks, and Blockers

**Assumptions:**

- FE-011 and BE-008 are implemented: the Settings frame, retained read store,
  `get_settings`, generated `src/bindings/settings.ts`, and the main-window
  mutation authorization already exist.
- `AppearanceSettingsDto` is complete whenever a snapshot exists, so the ready
  page has exactly six rows and requires no empty-state branch.
- The current Light token table is the Cream-compatible fallback while a
  snapshot loads. The new static Dark table is likewise a safe fallback; after
  load, backend-returned colors override both tables through inline variables.
- `SETTINGS_SECTIONS` remains the single route/navigation label table. FE-012
  changes only the element chosen for slug `appearance`.
- Built-in preset colors remain backend-owned. Frontend `PRESET_CARDS` contains
  only the fixed two-swatch illustrations from the wireframe and is never used
  to calculate or preview the actual theme.

**Risks:**

- A delayed older write could overwrite a newer preview. Task 3 serializes
  calls, retains the latest draft while saving, and proves ordering with held
  promises before any editor is composed.
- Coalescing a built-in preset with a custom-color patch could create the
  forbidden BE-008 combination. Task 3 tests field-level queue replacement and
  explicitly drops conflicting queued fields while retaining compatible fields
  such as `themeMode` and font sizes.
- Global inline root styles can leak across tests or survive unmount. Tasks 2
  and 4 define one complete output shape, record every property written, and
  verify deterministic cleanup against a controlled document root.
- `system` mode and React development remounts can duplicate listeners or
  startup reads. Tasks 1 and 4 test listener cleanup, a missing-`matchMedia`
  fallback, and idempotent bootstrap behavior.
- Invalid text, low-contrast colors, rapid native-picker input, and delayed
  persistence can diverge. Tasks 2, 3, 5, and 6 separate raw field text from a
  valid Appearance draft and cover local rejection plus defensive backend
  errors.
- Root `zoom` can expose clipping or unwanted document scrolling that jsdom
  cannot prove. Task 8 checks the real Windows webview at `12 px` and `20 px`
  and at a narrow window size.
- Incomplete Dark tokens could leave Light-colored regions in the shell. Task 4
  adds the full specified token table and combines source inspection, component
  assertions, a production build, and real-window smoke coverage.

**Blockers:** None.

## Dependency Order

1. Task 1 establishes effective Light/Dark resolution and the test seam for OS
   preference changes → enables Tasks 4 and 6.
2. Task 2 establishes strict color/contrast validation and deterministic theme
   output → enables Tasks 4 and 6.
3. Task 3 establishes the typed mutation wrappers and serialized global state
   machine → enables Tasks 4, 6, and 7.
4. Task 4 installs whole-window theme synchronization and startup bootstrap →
   enables live preview integration in Task 7.
5. Task 5 adds independently testable input controls → enables the composed
   editor page in Task 7.
6. Task 6 adds the editor orchestration over Tasks 1–3 → enables Task 7.
7. Task 7 composes the final page and route → enables slice-wide verification
   in Task 8.

---

### Task 1: Resolve the Effective Color Scheme

**Outcome:** One feature-local hook resolves fixed and system modes to
`"light" | "dark"`, responds to OS preference changes only in system mode,
and cleans up its exact media-query listener.

**Depends On:** None

**Files:**

- Create: `src/features/settings/use-effective-color-scheme.ts`
- Create/Test: `src/features/settings/use-effective-color-scheme.test.ts`
- Modify: `src/test-setup.ts`

**Interfaces:**

- Consumes: generated `ThemeModeDto`; browser
  `window.matchMedia("(prefers-color-scheme: dark)")` when available.
- Produces: internal `EffectiveColorScheme = "light" | "dark"` and
  `useEffectiveColorScheme(themeMode: ThemeModeDto): EffectiveColorScheme`.
- Test seam: a reusable jsdom `matchMedia` stub with controllable `matches`,
  `addEventListener`, `removeEventListener`, and dispatched `change` events;
  focused tests may temporarily remove `window.matchMedia` and restore it.

- [x] **Step 1: Add the effective-scheme tests and shared jsdom stub**

  Cover fixed `light` and `dark` without backend calls; initial system
  resolution for both OS values; an OS change updating system mode; fixed mode
  ignoring OS changes; mode changes while mounted; exact listener removal on
  mode change and unmount; no duplicate listener after remount; and Light as
  the fallback when `matchMedia` is absent.

- [x] **Step 2: Verify the target fails because the hook is missing**

  Run:
  `pnpm exec vitest run src/features/settings/use-effective-color-scheme.test.ts`

  Expected: Vitest discovers the named target and fails to resolve
  `./use-effective-color-scheme`; it must not pass with zero tests.

- [x] **Step 3: Implement the minimum listener lifecycle**

  Resolve fixed modes directly. For system mode, read one media query, subscribe
  through `change`, and return its exact cleanup callback. Avoid backend writes,
  webview storage, polling, and a second global theme store.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/use-effective-color-scheme.test.ts`

  Expected: all fixed, system, change, cleanup, remount, and missing-browser-API
  assertions pass with no settings command call.

### Task 2: Build Color Validation and Theme Output

**Outcome:** Pure helpers validate FE-012 color input, reproduce BE-008 contrast
thresholds, and convert one Appearance snapshot plus effective scheme into the
complete deterministic document-style contract.

**Depends On:** None

**Files:**

- Create: `src/features/settings/appearance-contrast.ts`
- Create/Test: `src/features/settings/appearance-contrast.test.ts`
- Create: `src/features/settings/appearance-theme.ts`
- Create/Test: `src/features/settings/appearance-theme.test.ts`

**Interfaces:**

- Consumes: generated `AppearanceSettingsDto`, `InterfaceColorsDto`, and
  `TerminalPaletteDto`; `EffectiveColorScheme` from Task 1 only as a type if it
  is placed with the hook, without importing hook behavior.
- Produces: internal `ContrastViolation` with `foregroundField`,
  `backgroundField`, `required`, and `actual`; strict full-hex normalization;
  `contrastRatio(foreground, background)`; violation collection for both
  interface schemes and terminal foreground/background; internal
  `AppearanceDocumentStyle` with `dataTheme`, `colorScheme`, `zoom`, and a
  read-only variable record; and
  `buildAppearanceStyle(appearance, scheme): AppearanceDocumentStyle`.
- Field paths: emit the backend spelling
  `interfaceColors.<light|dark>.<accent|canvas|sidebar|text>`,
  `terminalPalette.background`, and `terminalPalette.foreground` so UI and
  backend failures share one mapping.

- [x] **Step 1: Add focused contrast and style tests**

  For contrast, cover strict six-digit hex, uppercase normalization, rejected
  shorthand/name/`rgb(...)`, sRGB conversion, exact passing boundaries at
  `4.5:1` and `3:1`, all three interface pairs, terminal foreground/background,
  both schemes, stable field paths, and multiple simultaneous violations.
  For theme output, assert all four direct interface overrides, every specified
  `color-mix()` formula and source color, higher-contrast selection for
  `--color-on-primary`, terminal background/foreground/elevated variables,
  all 16 indexed ANSI variables, both font variables, and scale/zoom outputs at
  interface sizes 12, 14, and 20.

- [x] **Step 2: Verify both targets fail for their missing modules**

  Run:
  `pnpm exec vitest run src/features/settings/appearance-contrast.test.ts src/features/settings/appearance-theme.test.ts`

  Expected: Vitest discovers both named targets and reports unresolved imports
  for `./appearance-contrast` and `./appearance-theme`.

- [x] **Step 3: Implement the pure helpers**

  Follow WCAG sRGB relative luminance for comparison, retain enough precision
  for threshold tests, and return violations rather than throwing. Emit CSS
  `color-mix()` as exact strings because the browser, not TypeScript, resolves
  them. Do not mutate the DTO or read DOM/OS state in either module.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/appearance-contrast.test.ts src/features/settings/appearance-theme.test.ts`

  Expected: all format, threshold, field-path, token, ANSI, on-primary, and
  scaling assertions pass using pure inputs only.

### Task 3: Add Typed Appearance Mutations and Serialized Store State

**Outcome:** The existing settings boundary can preview locally, persist or
restore Appearance through generated DTOs, retry the exact failed operation,
serialize writes, and always reconcile to a full backend snapshot.

**Depends On:** None

**Files:**

- Modify: `src/lib/ipc/settings.ts`
- Modify/Test: `src/lib/ipc/settings.test.ts`
- Modify: `src/features/settings/settings-store.ts`
- Modify/Test: `src/features/settings/settings-store.test.ts`
- Modify: `src/features/settings/settings-error-copy.ts`
- Modify: `src/features/settings/settings-test-fixture.ts`

**Interfaces:**

- Consumes: generated `AppSettingsDto`, `AppearanceSettingsDto`,
  `AppearanceSettingsPatchDto`, `UpdateSettingsDto`, and `SettingsError`;
  existing `invokeCommand`, `getSettings`, `useSettingsStore`,
  `retainSettingsArea`, and `resetSettingsStore`.
- Produces: `updateSettings(input: UpdateSettingsDto): Promise<AppSettingsDto>`
  invoking `update_settings` with `{ input }`;
  `restoreAppearanceDefaults(): Promise<AppSettingsDto>` invoking
  `restore_appearance_defaults` without arguments; `SettingsSaveStatus =
  "idle" | "saving" | "error"`; store fields `appearanceDraft`, `saveStatus`,
  `saveErrorCode`, and `lastFailedPatch`; actions
  `previewAppearance(next)`, `commitAppearance(patch)`, `restoreAppearance()`,
  and `discardAppearanceDraft()`; and public
  `bootstrapAppSettings(): void`.
- Save error classification: retain draft for `invalid_color`,
  `contrast_too_low`, `persistence_failed`, and `unavailable`; discard it for
  `value_out_of_range`, `invalid_preset_combination`, `empty_patch`,
  `unauthorized_window`, `corrupt_stored_settings`, and unknown rejection.
  Expose retry only for `persistence_failed` and `unavailable`, and retain
  backend details needed for field/pair/range copy in an implementation-local
  save-failure value instead of reducing every failure to its code before the
  UI can render them; the specified public `saveErrorCode` remains the stable
  code-level state.
- Queue semantics: one in-flight update; one coalesced pending Appearance patch
  holding the latest value for each compatible field; a new built-in preset
  drops pending custom-color fields, and a new custom-color field drops a
  pending built-in preset. A successful response replaces `snapshot`; draft is
  cleared only when it no longer represents values newer than that response.
- Test seam: mocked `invokeCommand`/adapter functions, controlled deferred
  promises, and store reset between tests. No Tauri runtime, SQLite, real app
  data, process-global environment mutation, or wall-clock delay.

- [x] **Step 1: Extend the IPC adapter tests first**

  Assert exact command names and input shape; no `sidebar`; no arguments for
  restore; full snapshot passthrough; and typed `IpcCallError` preservation for
  representative update and restore rejections.

- [x] **Step 2: Verify the adapter tests fail on the missing exports**

  Run: `pnpm exec vitest run src/lib/ipc/settings.test.ts`

  Expected: the existing target is discovered and its new cases fail because
  `updateSettings` and `restoreAppearanceDefaults` are not exported.

- [x] **Step 3: Add the minimum typed wrappers and verify them**

  Add only the two BE-008 wrappers; do not handwrite DTOs, call `invoke`
  directly, or expose generic command names to the feature.

  Run: `pnpm exec vitest run src/lib/ipc/settings.test.ts`

  Expected: get, update, restore, payload, passthrough, and typed rejection
  assertions all pass.

- [x] **Step 4: Extend store, fixture, and error-copy tests**

  Add Appearance overrides to `createSettingsSnapshot` without breaking its
  existing General-call shape, and align its baseline Appearance with the exact
  BE-008 Cream defaults, including terminal `13 px` and the documented Dark and
  ANSI values. Cover preview without IPC; one update payload;
  full snapshot replacement and normalized backend values; success cleanup;
  each retain/discard failure code; unknown/malformed rejection; backend error
  details; exact failed-patch retry; retry-button classification; controlled
  first request proving there is never a second in flight; coalescing multiple
  font/color/mode changes; preset/color conflict removal; preserving the newest
  preview while an older result arrives; continuing the queue after failure;
  restore success and restore retry; restore disabled/serialized while saving;
  and complete reset of all new module/store state.

  Cover bootstrap separately: the first call retains the area and starts one
  load, later calls do neither again, an existing in-flight/readied load is
  reused, and test reset restores bootstrappability. Preserve all FE-011 load,
  retained-frame, stale completion, retry, and unmount cases.

- [x] **Step 5: Verify store tests fail for named missing behavior**

  Run: `pnpm exec vitest run src/features/settings/settings-store.test.ts`

  Expected: the target is discovered; new assertions fail because Appearance
  state/actions and `bootstrapAppSettings` are absent, while existing FE-011
  read-state assertions remain passing.

- [x] **Step 6: Implement the state machine and verify it**

  Keep queue module state resettable, validate non-empty/conflict-free patches
  defensively before the adapter, and let every caller receive a promise that
  settles after its submitted or coalesced work is processed. Do not cancel an
  accepted backend write when the page unmounts; its result still updates the
  application-level store.

  Run:
  `pnpm exec vitest run src/lib/ipc/settings.test.ts src/features/settings/settings-store.test.ts`

  Expected: both targets pass; exactly one command is in flight, the latest
  compatible patch is eventually sent, failures follow the retain/discard/retry
  matrix, restore updates only through the returned snapshot, and all FE-011
  read behavior remains green.

### Task 4: Synchronize Appearance Across the Whole Window

**Outcome:** The application applies the fallback or current Appearance before
normal route interaction, previews through the same root-style path, reacts to
system scheme changes, and removes every property it owns on cleanup.

**Depends On:** Tasks 1–3

**Files:**

- Create: `src/features/settings/appearance-theme-sync.tsx`
- Create/Test: `src/features/settings/appearance-theme-sync.test.tsx`
- Modify: `src/index.css`
- Modify: `src/app/app-providers.tsx`
- Modify: `src/main.tsx`

**Interfaces:**

- Consumes: `useSettingsStore`, `useEffectiveColorScheme`,
  `buildAppearanceStyle`, and `bootstrapAppSettings`.
- Produces: public `AppearanceThemeSync(): null`; one mount in `AppProviders`;
  one bootstrap call before `createRoot(...).render(...)`; Light and Dark static
  root-token tables; root `data-theme`, `style.colorScheme`, `style.zoom`, and
  all FE-012-owned inline variables.
- Loading fallback: without a snapshot, resolve the OS scheme, set only
  `data-theme` and `color-scheme`, and write no custom color, terminal, font, or
  zoom variables.
- Cleanup contract: remove only the attribute/properties written by the
  component, including every indexed ANSI variable, and restore no stale value
  from a previous snapshot or draft.
- Test seam: direct controlled Zustand state, Task 1's `matchMedia` stub, and a
  jsdom root whose initial attributes/style are captured and restored after
  every test. No settings IPC is triggered merely by rendering `AppProviders`.

- [x] **Step 1: Add the theme-sync component tests**

  Cover no-snapshot Light/Dark fallback with no color variables; snapshot
  application; effective fixed/system mode; draft precedence; reactive draft,
  snapshot, and OS changes; exact `data-theme`, `color-scheme`, zoom, direct and
  derived tokens, fonts, terminal colors, and ANSI values; one mount through
  `AppProviders`; cleanup after unmount; and the guarantee that existing shell,
  router, and provider tests do not acquire a new IPC call.

- [x] **Step 2: Verify the target fails because the sync component is missing**

  Run:
  `pnpm exec vitest run src/features/settings/appearance-theme-sync.test.tsx`

  Expected: Vitest discovers the target and fails to resolve
  `./appearance-theme-sync`.

- [x] **Step 3: Implement root synchronization and static CSS tables**

  Add `AppearanceThemeSync`, mount it exactly once, and call bootstrap before
  the initial render. Expand `index.css` with all FE-012 Light/Dark tokens,
  terminal defaults, `--ui-font-size`, `--terminal-font-size`, `--ui-scale`,
  and scheme selection. Keep fixed semantic Dark values such as success,
  warning, error, overlay, and shadows in CSS rather than deriving them from
  the four user colors.

- [x] **Step 4: Verify theme sync and provider regressions**

  Run:
  `pnpm exec vitest run src/features/settings/appearance-theme.test.ts src/features/settings/appearance-theme-sync.test.tsx src/app/app-shell.test.tsx src/app/app-sidebar.test.tsx src/app/app-topbar.test.tsx src/app/app-router.test.tsx src/features/projects/projects-route.test.tsx`

  Expected: all seven named targets pass; fallback writes no custom variables,
  snapshot/draft styles are complete and cleaned up, system changes are
  reactive, and mounting application providers introduces no additional IPC
  read in existing component tests.

### Task 5: Add the Reusable Slider and Appearance Input Controls

**Outcome:** The source-owned Slider and feature-local color field provide the
specified pointer, text-entry, and keyboard behavior without persistence logic
or a new dependency.

**Depends On:** Task 2

**Files:**

- Create: `src/components/ui/slider.tsx`
- Create: `src/features/settings/appearance-color-field.tsx`
- Create/Test: `src/features/settings/appearance-color-field.test.tsx`
- Create: `src/features/settings/appearance-segmented.tsx`
- Create: `src/features/settings/appearance-preset-cards.tsx`
- Create: `src/features/settings/appearance-terminal-preview.tsx`

**Interfaces:**

- Consumes: existing `radix-ui` Slider primitive; Task 2 full-hex helpers;
  generated theme DTO unions; current Button/Input styling conventions.
- Produces: source-owned shadcn/ui `Slider`; internal controlled
  `AppearanceColorField` supporting label, committed color, raw text,
  field-level error, valid preview, immediate commit, and revert callbacks;
  internal `AppearanceSegmented` radiogroup; internal
  `AppearancePresetCards`; fixed presentation-only `PRESET_CARDS`; and internal
  `AppearanceTerminalPreview` consuming the selected palette/font size.
- Accessibility contract: segmented/preset controls use labelled
  `radiogroup`/radio semantics and roving keyboard behavior; Slider exposes its
  accessible name, value bounds, and current value; field errors are associated
  with their input; the native color input has an accessible label.

- [x] **Step 1: Add focused color-field tests**

  Cover synchronized native color and text controls; uppercase normalization;
  valid typing preview; incomplete text retained without preview; rejected
  shorthand, named, and `rgb(...)` values; blur error disclosure; native picker
  input and change/close callbacks; Enter immediate commit; Escape reverting to
  the current valid color; field-error association; and updated committed props
  replacing stale raw text after backend reconciliation.

- [x] **Step 2: Verify the target fails because the field is missing**

  Run:
  `pnpm exec vitest run src/features/settings/appearance-color-field.test.tsx`

  Expected: Vitest discovers the named target and fails to resolve
  `./appearance-color-field`.

- [x] **Step 3: Implement the controls and presentation constants**

  Copy the standard shadcn/ui Slider source against existing `radix-ui`; do not
  run a command that upgrades dependencies. Keep segmented/preset/preview
  components controlled and free of store or IPC imports. Render the exact
  three-line terminal sample and specified color mapping, with overflow
  contained inside its own 96 px preview frame.

- [x] **Step 4: Verify the focused control behavior**

  Run:
  `pnpm exec vitest run src/features/settings/appearance-color-field.test.tsx`

  Expected: all native-color, raw-hex, validation, synchronization, keyboard,
  reconciliation, and accessible-error assertions pass.

### Task 6: Orchestrate Live Preview and Debounced Commits

**Outcome:** One page hook turns user intent into immediate valid/invalid
preview, correct full-value patches, local validation, immediate or 300 ms
commits, and safe navigation cleanup.

**Depends On:** Tasks 1–3

**Files:**

- Create: `src/features/settings/use-appearance-editor.ts`
- Create/Test: `src/features/settings/use-appearance-editor.test.ts`

**Interfaces:**

- Consumes: `AppearanceSettingsDto` and generated mode/preset/color types;
  `useSettingsStore` preview/commit/discard actions; effective scheme and
  contrast helpers.
- Produces: internal `AppearanceEditor` exactly as specified by FE-012:
  `appearance`, `editedScheme`, `violations`, `invalidHexFields`,
  `setEditedScheme`, `setThemeMode`, `setPreset`, `setInterfaceColor`,
  `setTerminalColor`, `setInterfaceFontSizePx`,
  `setTerminalFontSizePx`, and `flushPendingCommit`.
- Commit mapping: mode and built-in preset commit immediately and separately;
  interface-color commits send both complete Light/Dark sets with no preset;
  terminal commits send background, foreground, and all 16 ANSI colors with no
  preset; each font control sends only its field. Valid colors/sizes debounce
  for 300 ms; Enter/native-picker close may flush immediately.
- Local-state contract: `editedScheme` initially follows the effective scheme
  and continues following it until the user explicitly chooses Light or Dark;
  afterward OS/mode changes do not overwrite that choice. Raw invalid field
  text remains inside the field component, while `invalidHexFields` and
  contrast errors describe why no commit is allowed.
- Test seam: controlled store actions, Vitest fake timers, a controlled
  `matchMedia`, and hook unmount. No real IPC, DOM color dialog, or elapsed
  300 ms wait.

- [x] **Step 1: Add hook tests before implementation**

  Cover every setter's exact preview and patch; both complete interface schemes;
  complete terminal palette and indexed ANSI update; immediate mode/preset
  commits; no frontend preset-color substitution; valid color/size preview
  before persistence; reset of one 300 ms timer by rapid edits; independent
  later field values coalescing through the store; explicit flush; unmount
  flush of the last valid commit; invalid-hex and all contrast-rule blocks;
  invalid draft discard on unmount; integer bounds; effective-scheme default;
  automatic following before manual selection; and stable manual
  `editedScheme` afterward.

- [x] **Step 2: Verify the target fails because the editor hook is missing**

  Run:
  `pnpm exec vitest run src/features/settings/use-appearance-editor.test.ts`

  Expected: Vitest discovers the named target and fails to resolve
  `./use-appearance-editor`.

- [x] **Step 3: Implement the smallest editor orchestration**

  Clone nested tuples/objects rather than mutating the generated snapshot,
  calculate violations from the drafted value on every change, and schedule
  only valid patches. Cleanup must distinguish a valid pending value that needs
  flushing from an invalid preview that must be discarded.

- [x] **Step 4: Verify the task**

  Run:
  `pnpm exec vitest run src/features/settings/use-appearance-editor.test.ts src/features/settings/appearance-contrast.test.ts`

  Expected: all preview, full-patch, debounce, flush, invalid-block,
  edited-scheme, and immutable-update assertions pass under fake time.

### Task 7: Compose the Appearance Page and Replace Its Route Placeholder

**Outcome:** Users receive the complete Appearance page inside the retained
Settings frame, with exact state/error copy, responsive layout, accessible
controls, and route/breadcrumb integration.

**Depends On:** Tasks 3–6

**Files:**

- Create: `src/features/settings/settings-appearance-route.tsx`
- Create/Test: `src/features/settings/settings-appearance-route.test.tsx`
- Modify: `src/features/settings/settings-section.tsx`
- Modify: `src/features/settings/settings-error-copy.ts`
- Modify: `src/app/app-router.tsx`
- Modify/Test: `src/app/app-router.test.tsx`

**Interfaces:**

- Consumes: existing `SettingsSection`, `SettingRow`, read-failure
  classification, Settings store, Task 5 controls, Task 6 editor, generated
  save-error details, and `SETTINGS_SECTIONS` route metadata.
- Produces: public `SettingsAppearanceRoute(): JSX.Element`; a backward-
  compatible vertical/aligned-top `SettingRow` variant for full-width color
  editors; complete Appearance save-error copy and field/group mapping; and the
  real element selected when `section.slug === "appearance"`.
- Page state contract: header/description/restore remain visible in loading and
  read-error states; loading shows `Loading settings…` with `aria-busy`; read
  failure reuses FE-011 retry behavior; ready renders exactly six rows from
  `appearanceDraft ?? snapshot.appearance`; saving shows `Saving…` through a
  polite live region and disables restore without disabling editing; save
  failure renders one page alert plus field/group details and only the allowed
  retry action.
- Exact copy and terminal sample come from FE-012/wireframe. No placeholder,
  fake empty state, confirmation dialog, frontend persistence, or Settings-local
  wildcard is introduced.
- Test seam: controlled settings store, mocked adapter results/deferred
  promises, fake timers, and `matchMedia`; route tests retain their memory-router
  harness. No real backend or native color dialog.

- [x] **Step 1: Add the page component tests**

  Assert the exact title, description, restore label, six ordered row labels and
  descriptions, four interface color labels, two terminal labels, ANSI 0–15,
  exact three-line preview/color mapping, three modes, three preset cards,
  Custom state, separate Light/Dark editing, both slider ranges/current values,
  keyboard radio/slider behavior, narrow wrapping/contained terminal overflow,
  and accessible names/errors.

  Cover loading with no controls; every read-error group and retry; ready state;
  saving while controls remain usable; restore disabled while saving; restore
  success; restore retryable failure; no confirmation dialog; exact mode,
  preset, complete interface-color, complete terminal-palette, and font patches;
  local invalid hex/contrast without IPC; backend `invalid_color` and
  `contrast_too_low` mapped to the correct group; every retain/discard save code;
  range details; unknown field fallback; retry using the exact failed patch;
  rapid edits while a promise is held; and unmount flush/discard behavior.

- [x] **Step 2: Verify the page target fails because the route is missing**

  Run:
  `pnpm exec vitest run src/features/settings/settings-appearance-route.test.tsx`

  Expected: Vitest discovers the named target and fails to resolve
  `./settings-appearance-route`.

- [x] **Step 3: Implement the page and vertical row variant**

  Compose the controlled pieces without moving persistence or validation into
  JSX. Keep the fixed 220 px Settings navigation behavior from FE-011; allow
  preset cards and ANSI fields to wrap inside the content column. Map backend
  field paths defensively: recognized paths get local group copy, unrecognized
  paths retain the page-level error only.

- [x] **Step 4: Extend router tests before changing route composition**

  Replace the FE-012 placeholder assertion with the real page at
  `/settings/appearance`; retain Settings navigation highlight,
  `Settings / Appearance` breadcrumb, one shell `main`, unrelated Settings
  placeholders, General/About behavior, unknown-route handling, and unrelated
  application routes.

- [x] **Step 5: Verify the router fails on the remaining placeholder**

  Run: `pnpm exec vitest run src/app/app-router.test.tsx`

  Expected: the target is discovered and its new Appearance assertion fails
  because `settingsSectionElement` still returns the FE-012 placeholder; all
  unrelated route assertions remain passing.

- [x] **Step 6: Replace only the Appearance route element and verify composition**

  Add the `appearance` branch beside existing General/About branches. Do not
  change the path, label table, redirect, parent frame, or other placeholders.

  Run:
  `pnpm exec vitest run src/features/settings/settings-appearance-route.test.tsx src/features/settings/appearance-color-field.test.tsx src/features/settings/use-appearance-editor.test.ts src/features/settings/settings-store.test.ts src/app/app-router.test.tsx`

  Expected: all five targets pass; the real page, exact persistence mapping,
  validation, queue behavior, route, breadcrumb, and Settings/shell regressions
  agree.

### Task 8: Run Slice-Wide Verification and Windows Smoke Checks

**Outcome:** FE-012 passes every applicable automated gate and its real Windows
theme behavior is demonstrated without touching a developer's normal XWork
data.

**Depends On:** Tasks 1–7

**Files:**

- Modify: `00-Docs/98-Plan/20260904-fe-012-settings-appearance.md`
  (checklists, deviations, verification evidence, and outcome only)

**Interfaces:**

- Consumes: every interface and artifact from Tasks 1–7 plus the existing real
  BE-008 implementation.
- Produces: recorded automated results, targeted manual Windows observations,
  material deviations, and final implementation outcome.
- Isolation: use a disposable Windows account/profile or an explicitly isolated
  app-data directory that contains no real XWork settings/projects. Do not use
  process-global environment mutation inside automated tests; the manual run
  may select its isolated profile before launch.

- [x] **Step 1: Run focused and repository-wide command gates**

  Execute every row in Final Verification and record the actual result. Fix
  genuine failures without weakening tests, generated-contract checks,
  capabilities, lint, warnings, or type safety.

- [ ] **Step 2: Run the targeted manual Windows smoke checklist**

  Launch `pnpm tauri dev` from the isolated profile and complete every numbered
  item below. Do not add or run an automated desktop end-to-end test.

- [x] **Step 3: Record deviations and outcome**

  Append material decisions or deviations without rewriting completed history.
  Fill Outcome with delivered behavior, exact automated evidence, manual smoke
  results, and any remaining deferred FE-001/FE-008/FE-014/FE-020 limitations.

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Focused FE-012 tests | `pnpm exec vitest run src/lib/ipc/settings.test.ts src/features/settings/settings-store.test.ts src/features/settings/use-effective-color-scheme.test.ts src/features/settings/appearance-contrast.test.ts src/features/settings/appearance-theme.test.ts src/features/settings/appearance-theme-sync.test.tsx src/features/settings/appearance-color-field.test.tsx src/features/settings/use-appearance-editor.test.ts src/features/settings/settings-appearance-route.test.tsx src/app/app-router.test.tsx` | All ten named targets are discovered and every adapter, store, scheme, validation, token, root-sync, control, editor, page, route, breadcrumb, and shell-regression assertion passes |
| Frontend format | `pnpm format:check` | No formatting differences |
| Frontend lint | `pnpm lint` | Pass with no lint errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Full frontend tests | `pnpm test` | All unit/component tests pass; no automated desktop end-to-end test is added |
| Frontend production build | `pnpm build` | The SPA bundle succeeds with the real Appearance route and whole-window theme sync |
| Rustfmt | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | No Rust formatting difference |
| Clippy | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Every Rust target/feature passes with warnings denied |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` | All existing Rust unit, integration, contract, and composition tests pass unchanged |
| Windows desktop build | `pnpm tauri build` | Tauri produces a Windows build with the frontend-backend boundary and desktop integration intact |
| No new dependency | `git diff --exit-code -- package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock` | No npm or Cargo manifest/lockfile change exists in this slice |
| No generated/backend drift | `git diff --exit-code -- src/bindings src-tauri/src src-tauri/tests src-tauri/migrations` | No generated binding, Rust source/test, or migration change exists in this slice |
| No capability/config drift | `git diff --exit-code -- src-tauri/capabilities src-tauri/tauri.conf.json` | No capability or Tauri configuration change exists in this slice |
| Narrow frontend boundary | `rg -n -F -e 'updateSettings({' -e 'restoreAppearanceDefaults(' src/features/settings` | Matches occur only in `settings-store.ts` and its tests; page/components/hooks do not call persistence adapters directly |
| No direct Tauri access in feature | `rg -n '@tauri-apps/|invoke\\(' src/features/settings` | No match is returned; all Tauri access remains under `src/lib/ipc/` |
| No webview persistence | `rg -n 'localStorage|sessionStorage|indexedDB|document\\.cookie' src/features/settings src/lib/ipc/settings.ts` | No match is returned |
| Appearance-only update payload | `rg -n 'sidebar' src/features/settings/use-appearance-editor.ts src/features/settings/settings-appearance-route.tsx` | No match is returned; FE-012 does not submit sidebar settings |
| Complete Dark fallback tokens | `rg -n -F -e ':root[data-theme="dark"]' -e '--color-success:' -e '--color-warning:' -e '--color-error:' -e '--color-overlay:' -e '--shadow-sm:' -e '--shadow-pop:' src/index.css` | The Dark root selector and every required fixed semantic/shadow token are present; component/style tests prove the remaining dynamic tokens |

## Manual Windows Smoke Check

Use `pnpm tauri dev` from a disposable Windows account/profile or an explicitly
isolated XWork app-data location. The isolated state may be reset between runs;
do not point the checklist at a developer's normal settings or project data.

1. Open Settings → Appearance. Expected: the existing Settings navigation stays
   at 220 px, Appearance is highlighted, the breadcrumb reads
   `Settings / Appearance`, and the page shows the exact six rows and restore
   action with no FE-012 placeholder.
2. Select Light, Dark, and System. Expected: the whole window changes
   immediately, including shell/sidebar/control/scrollbar surfaces; System
   follows a live Windows light/dark change without a save indicator or new
   settings revision caused by the OS change.
3. Select Cream, Ink, and Paper. Expected: each click waits for the real backend
   response before applying the preset colors, the chosen card follows the
   returned snapshot, and no locally invented preset palette flashes first.
4. Edit the inactive interface scheme, then switch modes. Expected: editing the
   Light/Dark toggle does not change Theme by itself; after switching Theme, the
   saved edited colors appear. Native picker and hex input stay synchronized,
   and pasted uppercase hex returns normalized lowercase after save.
5. Enter `#abc`, a color name, and a valid but low-contrast pair. Expected:
   malformed text receives a field error and no preview/commit; the low-contrast
   value previews with a clear pair/threshold warning but does not save. Leaving
   the page discards the invalid preview and restores the last saved theme.
6. Rapidly drag a valid color and each size slider. Expected: preview is smooth,
   `Saving…` is announced without disabling editing, only the latest settled
   values persist, Arrow/Home/End work at the stated bounds, and leaving the
   page immediately after a final drag still saves that value.
7. Inspect the static terminal preview while changing background, foreground,
   ANSI 1/2/3/8/12, and terminal size. Expected: the specified sample segments,
   cursor, foreground, background, and font size update correctly; at a narrow
   window the ANSI grid wraps and only the preview frame scrolls horizontally.
8. While one save is visibly pending, inspect Restore. Expected: Restore is
   disabled until the write settles. Then activate it: there is no confirmation
   dialog, only Appearance resets to `system`, `cream`, `14 px` interface, and
   `13 px` terminal while unrelated settings remain unchanged.
9. Set a non-default mode, custom colors, and both sizes; close XWork fully and
   reopen it. Expected: the first usable frame reflects the stored theme and
   scale without a visible wrong-theme flash, and the page values match the
   backend snapshot.
10. At interface sizes `12 px` and `20 px`, resize the main window down to the
    supported minimum. Expected: the shell still fills the window, focus remains
    visible, the Settings content handles its own wrapping/overflow, and the
    document gains no unintended horizontal or vertical scrollbar.

## Plan Review Gate

- [x] Every named source and current file path exists, and every new path is
  explicitly established by FE-012 or the project structure.
- [x] Every named test file is selected by a focused or final command; every red
  command discovers its target and fails for the named missing module/export or
  placeholder behavior rather than passing with zero tests.
- [x] All generated DTOs, exact command names, `{ input }` payload shape,
  Appearance-only patch rules, error groups, field paths, thresholds, bounds,
  token formulas, and debounce timing match FE-012 and BE-008.
- [x] The single-flight queue is tested with held promises, including newer
  preview preservation and built-in-preset/custom-color conflict removal.
- [x] Every DOM, OS, timer, IPC, and persistence integration has an explicit
  isolated test seam; no automated test reads/writes user settings or mutates a
  process-global environment variable.
- [x] Startup/read/save/restore failure scenarios name their injection and
  observable result, and every generated Settings error code plus unknown
  rejection has a planned UI assertion.
- [x] Final frontend, Rustfmt, Clippy (`--all-targets --all-features` with
  warnings denied), Rust tests, production build, and Windows Tauri build meet
  the repository and FE-012 requirements.
- [x] Negative requirements have concrete checks for dependencies, generated
  bindings, backend/migrations, capabilities/config, direct Tauri calls,
  webview persistence, sidebar payloads, and the Dark fallback token table.
- [x] No backend implementation, migration, generated binding, dependency,
  automated desktop end-to-end test, macOS validation, or Git commit step is
  included.

## Deviations and Decisions

- Task 2 implemented `appearance-contrast.ts` and `appearance-theme.ts` before
  their focused tests, so the named red run for those two modules was never
  observed. Every other task followed the planned red/green order, and both
  modules are fully covered by the tests that were added immediately after.
- `SettingsSection` gained an optional `action` slot so `Restore default theme`
  can sit on the title row as the wireframe shows, and `SettingRow.description`
  became optional for the two size rows, which have no sub-line. Both changes
  are additive and leave the FE-011 General and About pages untouched.
- The stacked `SettingRow` variant places its control on a full-width row under
  the label instead of inside the fixed `340 px` right column. Sixteen ANSI
  colour fields plus the terminal preview cannot be used in a `340 px` column;
  the row still aligns to the top exactly as the plan requires.
- The source-owned `Slider` forwards `aria-label` to the Radix thumb. Radix
  names the thumb rather than the root, so without this the two size sliders
  would have had no accessible name.
- `--color-on-primary` follows the specified higher-contrast rule literally. On
  the Cream Light accent that selects the interface text colour (`#141413`)
  rather than the previous static white, so primary buttons read darker once a
  snapshot is applied.
- The store keeps an implementation-local `saveError` holding the complete
  generated payload, and `SettingsSaveFailure` gained a `field`. Both exist so
  the page can render field, pair and range copy; the specified public
  `saveErrorCode` remains the stable code-level state.
- `AppearanceSegmented`, `AppearancePresetCards` and `AppearanceTerminalPreview`
  carry `biome-ignore lint/a11y/useSemanticElements` suppressions. A native
  `<input type="radio">` cannot carry the joined-segment or card visual, and the
  preview is a labelled static sample rather than a form section.
- `createSettingsSnapshot` now reports the documented BE-008 sidebar default of
  `280 px` instead of the previous `248 px`, alongside the exact Cream
  Appearance defaults the plan asked for.
- The `rg -n 'sidebar' ...` negative check matches the `sidebar` interface colour
  label and key, not a sidebar settings payload. The underlying requirement
  holds: every write goes through `updateSettings({ appearance })`, so no
  `sidebar` section is ever submitted.
- The targeted manual Windows smoke checklist was not executed. This session has
  no interactive desktop, so items 1-10 remain outstanding and must be run
  before FE-012 is considered finished.

During implementation, append material deviations and decisions without
rewriting completed history.

## Outcome

**Delivered:** `/settings/appearance` renders the real page inside the retained
Settings frame with the exact header, restore action, and six specified rows.
Mode, preset, interface colours for both schemes, the terminal palette with all
sixteen ANSI slots, and both integer size sliders each send their documented
patch through `update_settings`; `restore_appearance_defaults` resets Appearance
alone. `AppearanceThemeSync`, mounted once in `AppProviders`, converts
`appearanceDraft ?? snapshot.appearance` into `data-theme`, `color-scheme`,
`zoom` and the complete inline variable table, so preview and committed
rendering share one path. `bootstrapAppSettings()` in `src/main.tsx` takes the
one startup read. `index.css` gained the full static Dark table plus the
terminal and scale defaults. Local strict `#rrggbb` and the four BE-008 contrast
rules block a write while still previewing the problem, writes are serialized
one at a time with field-level coalescing and preset/custom conflict removal,
and failures follow the retain/discard/retry matrix.

**Automated evidence (Windows):**

- Ten focused FE-012 targets: 244 passed, 0 failed.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm test`: 41 files, 807 tests passed.
- `pnpm build`: succeeded.
- `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo test`: all clean, Rust sources unchanged.
- `pnpm tauri build`: produced `src-tauri/target/release/xwork.exe`.
- Negative checks: no dependency, generated-binding, backend, migration,
  capability or Tauri configuration change; no direct Tauri access or webview
  persistence under `src/features/settings/`; the Dark root selector and every
  required fixed semantic and shadow token are present in `src/index.css`.

**Manual Windows smoke result:** Not run. Items 1-10 of the checklist above are
outstanding and still need a real Windows session from an isolated profile.

**Remaining limitations:** `sidebar.widthPx`/`collapsed` persistence stays with
the FE-001 extension; the published `--terminal-*` variables have no consumer
until FE-008; global text-size shortcuts belong to FE-014; Quick Note window
theme sync belongs to FE-020. macOS validation is deferred to release
preparation.
