# FE-001 Animate UI Sidebar Migration Implementation Plan

**Status:** Complete

**Goal:** Rebuild the FE-001 application-shell sidebar on the vendored Animate UI
sidebar component, keeping every behavior FE-001 already guarantees and adding
the hover highlight with a `prefers-reduced-motion` opt-out.

**Completion Criteria:**

- The sidebar renders through `src/components/animate-ui/components/radix/sidebar.tsx`
  with `variant="sidebar"` and `collapsible="icon"`, driven by `shell-store`.
- Sidebar width still comes from `shell-store`, clamps to `200px`–`420px`, and is
  published through `--sidebar-width`; the collapsed column is `56px` through
  `--sidebar-width-icon`.
- Hovering the area entries moves a highlight between them; with
  `prefers-reduced-motion` set, no animated element is rendered and hover falls
  back to a static background.
- Width transitions are suppressed while a pointer drag is in progress.
- No cookie, `localStorage`, `sessionStorage`, or `indexedDB` write exists in
  `src/`, and no component registers `Ctrl+B`.
- All commands in Final Verification pass on Windows, and the manual smoke
  checks listed there are performed.

**Architecture:** `AppShell` keeps its two-row grid; the lower row becomes
`SidebarProvider`, which receives the collapsed state and both width variables
from `shell-store` and hosts `AppSidebar`, `SidebarResizeHandle`, and
`SidebarInset`. `AppSidebar` composes the vendored Animate UI parts and owns the
project-specific decisions: active-item colour, nav-item tooltips, and whether
the hover highlight animates. The vendored files stay presentation-only; no OS
access, IPC, or business rule moves into `src/components/`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Radix UI, Motion `13.1.1`,
Animate UI source snapshot, Zustand, Vitest with Testing Library, Biome.

**Sources:**

- Roadmap: `00-Docs/98-Plan/00-Roadmap.md`
- Requirements: `00-Docs/00-Overview/03-FunctionalRequirements.md` (`§4.1`, `§17.4`, `§18`)
- Frontend spec: `00-Docs/02-Frontend/FE-001-application-shell.md`
- Tech stack: `00-Docs/00-Overview/01-TechStack.md`
- Project structure: `00-Docs/00-Overview/02-ProjectStructure.md`
- Wireframe: `00-Docs/01-Wireframe/02-AppShell.html#shell`, `#shell-collapsed`
- Design tokens: `00-Docs/01-Wireframe/00-Design.md`
- Upstream registry: `https://animate-ui.com/r/components-radix-sidebar.json`,
  `https://animate-ui.com/r/primitives-effects-highlight.json`,
  `https://animate-ui.com/r/lib-get-strict-context.json`

## Scope

**In Scope:**

- Vendoring the Animate UI sidebar, the `highlight` effect primitive, and the
  `get-strict-context` helper, with the local changes fixed by FE-001.
- Pinning `motion` at `13.1.1`.
- Sidebar colour tokens in `src/index.css`.
- Rewiring `AppShell` and `AppSidebar` onto the vendored components.
- `isSidebarResizing` in `shell-store` and its use by `SidebarResizeHandle`.
- Hover highlight with a `prefers-reduced-motion` opt-out.
- Updating and extending the frontend tests FE-001 lists.

**Out of Scope:**

- The project and session lists in the sidebar (`FE-004`, `FE-006`) and the
  `SidebarMenuSub`, `SidebarMenuBadge`, `SidebarMenuAction` usage they need.
- Persisting sidebar width and collapsed state (`BE-008`).
- Dark theme and font-size settings (`FE-011`, `FE-012`).
- `SidebarRail`, the `offcanvas` collapsible mode, and the `floating` and
  `inset` variants.
- The mobile `Sheet` presentation, `SidebarInput`, `SidebarMenuSkeleton`, and
  `SidebarSeparator`, none of which are vendored.
- Any change to the topbar, the Quit flow, IPC wrappers, Tauri capabilities, or
  Rust code.

## Global Constraints

- Write code, identifiers, and code comments in English; Markdown stays UTF-8.
- Every function, method, callback, test, and helper carries a short comment
  stating its purpose; prefer `///`-style doc comments above functions where the
  language supports them, and add inline comments only for non-obvious logic.
- shadcn/ui and Animate UI components live in the repository as source; keep
  project-specific changes local to the copied component files.
- Exact dependency versions only. `motion` is `13.1.1`, matching
  `01-TechStack.md`.
- No animation may break keyboard operation or ignore `prefers-reduced-motion`.
- No persistence in the webview at this slice: no cookie, `localStorage`,
  `sessionStorage`, or `indexedDB`.
- `src/components/animate-ui/` holds shared motion components only: no business
  state, no OS access, no IPC.
- Do not hand-edit `src/bindings/`.
- Build and test on Windows only; defer macOS validation.

Every task implicitly includes these constraints.

## Assumptions, Risks, and Blockers

**Assumptions:**

- `motion@13.1.1` is the version named by `01-TechStack.md` and declares
  `react`/`react-dom` `^18 || ^19` as peers, so it fits React `19.2.8`.
- The registry payloads above are the upstream source of the three vendored
  files; their targets map to `src/components/animate-ui/components/radix/sidebar.tsx`,
  `src/components/animate-ui/primitives/effects/highlight.tsx`, and
  `src/components/animate-ui/lib/get-strict-context.tsx`.
- `src/components/animate-ui/lib/` is the correct home for the Animate UI
  helper: `02-ProjectStructure.md` excludes single-consumer helpers from
  `src/lib/utils/`, and the helper belongs to the vendored component set.
- Radix `Tooltip` in `src/components/ui/tooltip.tsx` and the single
  `TooltipProvider` in `app-providers.tsx` stay the only tooltip implementation.

**Risks:**

- In `jsdom` every `getBoundingClientRect()` returns zeros, so highlight
  geometry cannot be asserted. Mitigated by Task 6, which asserts only whether
  the animated element exists, and by the manual smoke checks.
- `HighlightItem` runs a `requestAnimationFrame` loop while an item is hovered
  and `forceUpdateBounds` is on, which can keep a component test busy. Task 6
  runs the affected file on its own to confirm it terminates.
- The upstream width transition would lag a pointer drag. Mitigated by Tasks 5
  and 7 (`data-resizing`).
- The upstream `Sidebar` container is `fixed inset-y-0 h-svh` and would cover
  the `40px` topbar. Mitigated in Task 4 by overriding the container to
  `absolute h-full` inside the positioned provider row.
- `HighlightItem` injects `aria-selected` into its child, which is invalid on a
  navigation link. Mitigated in Task 2 by removing that injection from the
  vendored primitive.

**Blockers:** None.

## Dependency Order

1. Task 1 (pin `motion`) → enables Task 2.
2. Task 2 (vendor the three files with local changes) → enables Tasks 4–7.
3. Task 3 (sidebar colour tokens) → enables Task 4.
4. Task 4 (`AppShell` and `AppSidebar` on the vendored sidebar) → enables
   Tasks 5–7.
5. Task 5 (`isSidebarResizing` in `shell-store`) → enables Task 7.
6. Task 6 (reduced-motion behavior) → independent of Task 7.
7. Task 7 (suppress the width transition while dragging) → last behavioral task.
8. Task 8 (negative guards) → after Tasks 2 and 4.

---

### Task 1: Pin the Motion Dependency

**Outcome:** `motion` is installed at exactly `13.1.1` and resolvable from
frontend source.

**Depends On:** None

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: None
- Produces: `motion/react` exports `motion`, `AnimatePresence`, `Transition`,
  `useReducedMotion` for later tasks.

- [x] **Step 1: Add the exact dependency**

  Add `"motion": "13.1.1"` to `dependencies` in `package.json`, keeping the
  existing alphabetical order and the exact-version style used by every other
  entry.

- [x] **Step 2: Install and lock**

  Run: `pnpm install`

  Expected: `pnpm-lock.yaml` records `motion@13.1.1` and the install completes
  with no peer-dependency warning about `react` or `react-dom`.

- [x] **Step 3: Verify the task**

  Run: `pnpm exec node -e "console.log(require('motion/package.json').version)"`

  Expected: prints `13.1.1`.

---

### Task 2: Vendor the Animate UI Sidebar With the Agreed Local Changes

**Outcome:** The three Animate UI files exist under `src/components/animate-ui/`,
compile against this repository's aliases, and contain exactly the local changes
FE-001 fixed.

**Depends On:** Task 1

**Files:**

- Create: `src/components/animate-ui/components/radix/sidebar.tsx`
- Create: `src/components/animate-ui/primitives/effects/highlight.tsx`
- Create: `src/components/animate-ui/lib/get-strict-context.tsx`

**Interfaces:**

- Consumes: `cn` from `@/lib/utils/cn`; `Button` from `@/components/ui/button`;
  `motion/react`.
- Produces:
  - `SidebarProvider(props: React.ComponentProps<'div'> & { defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void })`
  - `Sidebar(props: React.ComponentProps<'div'> & { side?: 'left' | 'right'; variant?: 'sidebar' | 'floating' | 'inset'; collapsible?: 'icon' | 'none'; containerClassName?: string; animateOnHover?: boolean; isResizing?: boolean; transition?: Transition })`
  - `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`,
    `SidebarGroupLabel`, `SidebarGroupAction`, `SidebarGroupContent`,
    `SidebarMenu`, `SidebarMenuItem`,
    `SidebarMenuButton(props: React.ComponentProps<'button'> & { asChild?: boolean; isActive?: boolean; variant?: 'default' | 'outline'; size?: 'default' | 'sm' | 'lg' })`,
    `SidebarMenuAction`, `SidebarMenuBadge`, `SidebarMenuSub`,
    `SidebarMenuSubItem`, `SidebarMenuSubButton`, `SidebarInset`, `useSidebar`
  - `Highlight`, `HighlightItem`, `useHighlight`
  - `getStrictContext<T>(name?: string)`

- [x] **Step 1: Copy the upstream files to their targets**

  Take the single file from each registry payload and write it to the target
  path listed under Files. Do not reformat beyond what Biome requires.

- [x] **Step 2: Apply the local changes to `sidebar.tsx`**

  - Rewrite the imports to this repository: `cn` from `@/lib/utils/cn`,
    `Button` from `@/components/ui/button`, `Highlight` and `HighlightItem`
    from `@/components/animate-ui/primitives/effects/highlight`,
    `getStrictContext` from `@/components/animate-ui/lib/get-strict-context`.
  - Remove the mobile presentation: the `useIsMobile` hook, the `Sheet` branch
    of `Sidebar`, `isMobile` and `openMobile` from the context type and value,
    the `SIDEBAR_WIDTH_MOBILE` constant, and the `hidden md:block` / `md:flex`
    classes so the sidebar is never hidden by a breakpoint.
  - Remove the `document.cookie` write in `setOpen` and the
    `SIDEBAR_COOKIE_NAME` / `SIDEBAR_COOKIE_MAX_AGE` constants.
  - Remove the `keydown` listener and `SIDEBAR_KEYBOARD_SHORTCUT`.
  - Remove `SidebarInput`, `SidebarMenuSkeleton`, and `SidebarSeparator`, plus
    their `Input`, `Skeleton`, and `Separator` imports, from the file and the
    export list. `SidebarRail` and `SidebarTrigger` go with them: both duplicate
    a control the shell already owns, and keeping them would leave dead code
    behind classes this file no longer defines.
  - Remove the `TooltipProvider` wrapper from `SidebarProvider` and the
    `tooltip` prop, tooltip imports, and tooltip branch from
    `SidebarMenuButton`; the call site owns nav-item tooltips so the trigger
    sits on the link itself and the tooltip also opens on keyboard focus.
  - Set `SIDEBAR_WIDTH_ICON` to `3.5rem` so the icon column matches the `56px`
    in `#shell-collapsed` when a caller does not override
    `--sidebar-width-icon`.
  - Restrict `collapsible` to `'icon' | 'none'` and default it to `'icon'`;
    drop the `offcanvas` classes from the gap and container.
  - Add an `isResizing?: boolean` prop that renders `data-resizing` on the
    wrapper element, and add `group-data-[resizing=true]:transition-none` plus
    `motion-reduce:transition-none` to the gap and container class lists.

- [x] **Step 3: Apply the local changes to `highlight.tsx`**

  Import `cn` from `@/lib/utils/cn`, and remove `'aria-selected'` from the
  `dataAttributes` object so the effect never claims a selection state on a
  navigation link.

- [x] **Step 4: Verify the task**

  Run: `pnpm format:check && pnpm lint && pnpm typecheck`

  Expected: all three pass. In particular `pnpm typecheck` reports no
  unresolved import for `@/hooks/use-mobile`, `@/components/ui/input`,
  `@/components/ui/skeleton`, `@/components/ui/separator`, or any
  `@/components/animate-ui/components/radix/sheet` path, because none of those
  modules exists in this repository.

---

### Task 3: Add the Sidebar Colour Tokens

**Outcome:** The classes the vendored sidebar uses resolve to the XWork palette.

**Depends On:** None

**Files:**

- Modify: `src/index.css`

**Interfaces:**

- Consumes: existing `@theme` tokens `--color-surface-soft`,
  `--color-surface-card`, `--color-body`, `--color-ink`, `--color-hairline`,
  `--color-brand`.
- Produces: `--color-sidebar`, `--color-sidebar-foreground`,
  `--color-sidebar-accent`, `--color-sidebar-accent-foreground`,
  `--color-sidebar-border`, `--color-sidebar-ring`.

- [x] **Step 1: Declare the tokens**

  In the semantic-alias block of `@theme`, add the six tokens:
  `--color-sidebar: var(--color-surface-soft)`,
  `--color-sidebar-foreground: var(--color-body)`,
  `--color-sidebar-accent: var(--color-surface-card)`,
  `--color-sidebar-accent-foreground: var(--color-ink)`,
  `--color-sidebar-border: var(--color-hairline)`,
  `--color-sidebar-ring: var(--color-brand)`. Note in a comment that
  `--color-sidebar-accent` is the hover-highlight surface and that the active
  area entry keeps `cream-strong` at the call site so the two stay
  distinguishable.

- [x] **Step 2: Verify the task**

  Run: `pnpm build && grep -c "^  --color-sidebar" src/index.css`

  Expected: the build succeeds and the count is `6`.

---

### Task 4: Compose the Shell and Sidebar on the Vendored Component

**Outcome:** The running shell renders the Animate UI sidebar, driven entirely
by `shell-store`, with the same landmarks, routes, empty state, collapse
behavior, and tooltips FE-001 already requires.

**Depends On:** Tasks 2, 3

**Files:**

- Modify: `src/app/app-shell.tsx`
- Modify: `src/app/app-sidebar.tsx`
- Test: `src/app/app-sidebar.test.tsx`
- Test: `src/app/app-shell.test.tsx`

**Interfaces:**

- Consumes: `SidebarProvider`, `Sidebar`, `SidebarContent`, `SidebarGroup`,
  `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`,
  `SidebarMenuItem`, `SidebarMenuButton`, `SidebarFooter`, `SidebarInset` from
  `@/components/animate-ui/components/radix/sidebar`; `Tooltip`,
  `TooltipTrigger`, `TooltipContent` from `@/components/ui/tooltip`;
  `useShellStore`, `COLLAPSED_SIDEBAR_WIDTH_PX`.
- Produces: `AppShell()` and `AppSidebar()` keep their current signatures.

- [x] **Step 1: Update the focused tests**

  In `app-sidebar.test.tsx`, replace the `drives the shell grid width from
  state` case with one that reads the provider element by its `shell-body` test
  id and asserts `--sidebar-width` is `232px` at the default, becomes `345px`
  after `setSidebarWidthPx(345)`, and that `--sidebar-width-icon` is `56px`
  throughout; then assert the sidebar element carries `data-state="collapsed"`
  and `data-collapsible="icon"` after the collapse control is used, and
  `data-state="expanded"` before it. Add a case asserting the collapsed
  nav-item tooltip also opens on keyboard focus, using `Tab` to reach an area
  entry. In `app-shell.test.tsx`, keep the landmark and focus-order cases as
  the contract the new composition must satisfy.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `pnpm exec vitest run src/app/app-sidebar.test.tsx`

  Expected: the width case fails because `shell-body` exposes
  `grid-template-columns` and no `--sidebar-width` custom property, and the
  `data-state` assertions fail because no element with `data-slot="sidebar"`
  exists yet.

- [x] **Step 3: Implement the composition**

  - `app-shell.tsx`: keep `grid-rows-[40px_minmax(0,1fr)]`. Render
    `SidebarProvider` as the lower row with `data-testid="shell-body"`,
    `open={!isSidebarCollapsed}`,
    `onOpenChange={() => toggleSidebarCollapsed()}`, a `style` carrying
    `--sidebar-width: ${sidebarWidthPx}px` and
    `--sidebar-width-icon: ${COLLAPSED_SIDEBAR_WIDTH_PX}px`, and a `className`
    that overrides the upstream `min-h-svh` with `relative min-h-0 h-full` so
    the absolute sidebar container and the resize handle anchor to this row.
    Inside it render `AppSidebar`, the resize handle when not collapsed, and
    `SidebarInset` carrying the existing integration-failure alert and
    `Outlet`.
  - `app-sidebar.tsx`: render
    `<Sidebar collapsible="icon" role="navigation" aria-label="Main" className="absolute h-full border-hairline">`
    so it stays the single `navigation` landmark and sits below the topbar
    instead of over it; a `biome-ignore` comment records why the role is set on
    a vendored `div`. Inside, use `SidebarContent` with one `SidebarGroup` for
    the four areas and one for the `Projects` block, and `SidebarFooter` for
    `Settings` and the collapse control. Each area entry is a
    `SidebarMenuButton asChild` wrapping the existing `NavLink`, wrapped in a
    `Tooltip` whose `TooltipTrigger asChild` targets the menu button so the
    trigger lands on the link; the tooltip is rendered only while collapsed.
    Keep the active entry on `cream-strong` with call-site classes
    (`data-[current=page]` styling stays as it is today), keep the `Projects`
    group hidden while collapsed, and centre the icon-mode entries inside the
    `56px` column.

- [x] **Step 4: Verify the task**

  Run: `pnpm exec vitest run src/app/app-sidebar.test.tsx src/app/app-shell.test.tsx src/app/app-router.test.tsx`

  Expected: every case passes, including exactly one `banner`, one
  `navigation`, and one `main` landmark, the four area routes plus `Settings`,
  the empty `Projects` copy, and the documented `Tab` order.

---

### Task 5: Track the Drag in Shell State

**Outcome:** `shell-store` publishes whether a pointer drag of the sidebar seam
is in progress.

**Depends On:** None

**Files:**

- Modify: `src/app/shell-store.ts`
- Test: `src/app/shell-store.test.ts`

**Interfaces:**

- Consumes: None
- Produces: `ShellState.isSidebarResizing: boolean`,
  `ShellState.setSidebarResizing(next: boolean): void`, and
  `resetShellStore()` restoring `isSidebarResizing` to `false`.

- [x] **Step 1: Add the focused test**

  Add a case asserting `isSidebarResizing` defaults to `false`, becomes `true`
  after `setSidebarResizing(true)`, returns to `false` after
  `setSidebarResizing(false)`, and is `false` again after `resetShellStore()`
  while `sidebarWidthPx` keeps its clamped value.

- [x] **Step 2: Verify the test fails for the expected reason**

  Run: `pnpm exec vitest run src/app/shell-store.test.ts`

  Expected: fails to compile the test target because `setSidebarResizing` is
  not a property of `ShellState`.

- [x] **Step 3: Implement the minimum change**

  Add the field, its setter, and its default to `ShellState`, the store
  factory, and `resetShellStore`.

- [x] **Step 4: Verify the task**

  Run: `pnpm exec vitest run src/app/shell-store.test.ts`

  Expected: all cases pass, including the existing clamp and collapse cases.

---

### Task 6: Honor Reduced Motion

**Outcome:** The hover highlight animates by default and is not rendered at all
when the user asks for reduced motion.

**Depends On:** Task 4

**Files:**

- Modify: `src/app/app-sidebar.tsx`
- Test: `src/app/app-sidebar.test.tsx`

**Interfaces:**

- Consumes: `useReducedMotion` from `motion/react`; `Sidebar`'s
  `animateOnHover` prop.
- Produces: None

- [x] **Step 1: Add the focused tests**

  Add two cases that stub `window.matchMedia` for
  `(prefers-reduced-motion: reduce)` before render and restore it afterwards.
  With the query not matching, hovering an area entry renders an element with
  `data-slot="motion-highlight"` inside the sidebar. With the query matching,
  hovering renders no such element and no element carries `data-highlight`,
  while the area entry is still reachable by its accessible name.

- [x] **Step 2: Verify the tests fail for the expected reason**

  Run: `pnpm exec vitest run src/app/app-sidebar.test.tsx -t "reduced motion"`

  Expected: the matching-query case fails because the highlight element is
  still rendered; `AppSidebar` does not read the media query yet.

- [x] **Step 3: Implement the minimum change**

  Read `useReducedMotion()` in `AppSidebar` and pass
  `animateOnHover={!prefersReducedMotion}` to `Sidebar`. Add a comment stating
  that the disabled path is not a downgrade: the vendored component keeps a
  static hover background for items that carry no `data-highlight`.

- [x] **Step 4: Verify the task**

  Run: `pnpm exec vitest run src/app/app-sidebar.test.tsx`

  Expected: every case in the file passes and the run terminates, which also
  confirms the `requestAnimationFrame` loop in `HighlightItem` does not keep
  the test alive.

---

### Task 7: Suppress the Width Transition While Dragging

**Outcome:** The sidebar edge follows the pointer exactly during a drag, and the
transition returns for collapse, expand, and keyboard resizing.

**Depends On:** Tasks 2, 4, 5

**Files:**

- Modify: `src/app/sidebar-resize-handle.tsx`
- Modify: `src/app/app-sidebar.tsx`
- Test: `src/app/app-sidebar.test.tsx`

**Interfaces:**

- Consumes: `useShellStore` selectors `isSidebarResizing` and
  `setSidebarResizing`; `Sidebar`'s `isResizing` prop.
- Produces: `data-resizing="true"` on the sidebar wrapper while a drag is
  active.

- [x] **Step 1: Add the focused test**

  Add a case that presses the pointer on the resize separator and asserts the
  sidebar element gains `data-resizing="true"`, loses it on `pointerUp`, and
  that a keyboard `ArrowRight` never sets it. Extend the existing
  `ends an active drag when the sidebar collapses` case to assert
  `isSidebarResizing` is `false` after the collapse.

- [x] **Step 2: Verify the test fails for the expected reason**

  Run: `pnpm exec vitest run src/app/app-sidebar.test.tsx -t "data-resizing"`

  Expected: fails because the sidebar element has no `data-resizing` attribute
  after `pointerDown`.

- [x] **Step 3: Implement the minimum change**

  In `sidebar-resize-handle.tsx`, call `setSidebarResizing(true)` on a primary
  `pointerDown` and `setSidebarResizing(false)` from the single
  `releasePointer` path, which already covers `pointerUp`, `pointerCancel`, and
  the collapse effect. In `app-sidebar.tsx`, pass
  `isResizing={isSidebarResizing}` to `Sidebar`.

- [x] **Step 4: Verify the task**

  Run: `pnpm exec vitest run src/app/app-sidebar.test.tsx src/app/shell-store.test.ts`

  Expected: all cases pass, including the six existing resize-separator cases.

---

### Task 8: Guard the Negative Requirements

**Outcome:** The behaviors FE-001 forbids are pinned by tests and a repository
search, so a later component update cannot reintroduce them silently.

**Depends On:** Tasks 2, 4

**Files:**

- Test: `src/app/app-sidebar.test.tsx`

**Interfaces:**

- Consumes: None
- Produces: None

- [x] **Step 1: Add the guard tests**

  These are regression guards, not red tests: they pass as soon as Task 2 has
  removed the upstream behavior, and their value is failing if it returns. Add
  a case asserting `document.cookie` is unchanged after a full collapse and
  expand cycle, and a case asserting `Ctrl+B` on `document.body` leaves
  `isSidebarCollapsed` untouched.

- [x] **Step 2: Verify the task**

  Run: `pnpm exec vitest run src/app/app-sidebar.test.tsx`

  Expected: both new cases pass.

- [x] **Step 3: Verify by repository search**

  Run: `grep -rnE "document.cookie|localStorage|sessionStorage|indexedDB|SIDEBAR_KEYBOARD_SHORTCUT|use-mobile" src --include=*.ts --include=*.tsx`

  Expected: the only matches are the two lines of the guard test that read
  `document.cookie`; no production source matches.

---

## Final Verification

| Scope | Command | Expected Result |
|---|---|---|
| Frontend format | `pnpm format:check` | Pass with no errors |
| Frontend lint | `pnpm lint` | Pass with no errors |
| Frontend type check | `pnpm typecheck` | Pass with no type errors |
| Frontend tests | `pnpm test` | All tests pass |
| Frontend build | `pnpm build` | Build succeeds |
| Rustfmt | `pnpm format:rust` | No formatting diff |
| Clippy | `pnpm lint:rust` | Pass with warnings denied |
| Rust tests | `pnpm test:rust` | All tests pass |
| Windows Tauri build | `pnpm tauri build` | Build succeeds |

Manual Windows smoke checks on the real build, none of which an automated test
replaces:

- The sidebar sits below the `40px` topbar, the collapse control animates the
  width between `232px` and `56px`, and the brand column of the topbar stays
  aligned with the sidebar in both widths.
- Moving the pointer down the four area entries slides the highlight between
  them, and it disappears when the pointer leaves the sidebar.
- Dragging the seam keeps the sidebar edge under the pointer with no lag, and
  the width still stops at `200px` and `420px`.
- With `prefers-reduced-motion` enabled in Windows, the highlight is gone,
  hovering still changes the background, and the width changes with no
  animation.
- `Ctrl+B` does nothing.
- Narrowing the window as far as it goes never hides the sidebar.

## Deviations and Decisions

- Task 6 does not use `useReducedMotion` from `motion/react`. That hook stores
  the answer in a module-level singleton on first use and, by its own comment,
  never updates it again, so it can neither follow a change made while the
  application runs nor be exercised per test case. `AppSidebar` reads the media
  query itself through `useSyncExternalStore`, which fixes both. The hook stays
  local to `app-sidebar.tsx` because it has a single consumer and
  `02-ProjectStructure.md` excludes single-consumer helpers from
  `src/lib/utils/`.
- Task 7 moved the "collapsing during a drag ends the drag" invariant from an
  effect watching `isSidebarCollapsed` to a cleanup that runs on unmount. The
  shell removes the seam the moment the sidebar collapses, so the component is
  already gone before such an effect could run; the pre-existing effect was
  unreachable, which the new drag flag exposed as a test failure. The
  `isSidebarCollapsed` selector was removed from
  `sidebar-resize-handle.tsx` with it.
- Task 5 was implemented before Task 4, and its focused test was written
  alongside the implementation rather than ahead of it. Tasks 4, 6, 7, and 8
  followed the planned red-then-green order. The `isResizing` wiring named by
  Task 7 landed in the same edit as Task 6 to avoid rewriting the same JSX
  attribute list twice.
- `SidebarRail` and `SidebarTrigger` were dropped from the vendored file rather
  than kept unused, and the `offcanvas` classes went with them.
- `pnpm exec rg` is not available in this environment; the two search-based
  verification steps use `grep` instead. Same targets, same expectations.
- `src/app/app-topbar.tsx` was changed after all, against the Out of Scope entry
  that excluded the topbar. Reason: with the width transition in place, the
  brand column snapped to its new width while the sidebar edge was still
  travelling, so the two were visibly misaligned for the length of the
  transition. The brand column became an `auto` track whose child element owns
  the width and the same transition, since a track list mixing `minmax()` and
  `auto` is not reliably interpolable. The transition is suppressed while
  dragging and under reduced motion, exactly like the sidebar's. No test
  asserts a transition because `jsdom` cannot observe one; the alignment is a
  manual smoke check.
- Adding `motion` grows the frontend bundle from `433 kB` to `571 kB`
  unminified-gzip-excluded, which crosses Vite's `500 kB` chunk-size warning.
  Accepted: this is a local desktop application, the file is loaded from disk,
  and no code-splitting requirement exists at this slice.

## Outcome

Delivered. The sidebar renders through the vendored Animate UI component with
the hover highlight, the reduced-motion opt-out, the drag-suppressed width
transition, and the six sidebar colour tokens. `shell-store` gained
`isSidebarResizing`; `AppShell` publishes `--sidebar-width` and
`--sidebar-width-icon` and hosts `SidebarInset`; `AppSidebar` is the single
`navigation` landmark.

Verification evidence on Windows:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: pass, no findings.
- `pnpm test`: 9 files, 133 tests, all pass, including 27 in
  `src/app/app-sidebar.test.tsx`. Re-run after the topbar change: still 133.
- `pnpm build`: succeeds, with the accepted chunk-size warning above.
- `pnpm format:rust`, `pnpm lint:rust`, `pnpm test:rust`: pass, 4 tests.
- `pnpm tauri build`: succeeds.
- Negative search over `src`: no `document.cookie`, `localStorage`,
  `sessionStorage`, `indexedDB`, `SIDEBAR_KEYBOARD_SHORTCUT`, or `use-mobile`
  in production source.

Remaining limitations: the highlight geometry and the smoothness of both the
highlight and the width transition are not covered by automated tests, because
`jsdom` reports zero-sized rectangles. The manual Windows smoke checks listed
above remain the only verification of the visual result.
