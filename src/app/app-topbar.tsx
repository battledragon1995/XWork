import { Bell, Search } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useMatches } from "react-router";
import { Highlight, HighlightItem } from "@/components/animate-ui/primitives/effects/highlight";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import { AppMenu } from "./app-menu";
import type { RouteCrumbHandle } from "./app-router";
import { COLLAPSED_SIDEBAR_WIDTH_PX, useShellStore } from "./shell-store";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import { toggleMaximized, WindowControls } from "./window-controls";

/** Elements that must never start a window drag or trigger the maximize double click. */
const INTERACTIVE_SELECTOR = "button, a, input, [role='menuitem'], [role='separator']";

// Read the breadcrumb labels of the deepest match that declares them.
function useRouteCrumbs(): string[] {
  const matches = useMatches();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const handle = match?.handle as RouteCrumbHandle | undefined;
    const crumbs = handle?.crumbs(match?.params ?? {});

    if (crumbs && crumbs.length > 0) {
      return crumbs;
    }
  }

  return [];
}

// Render the current route context as a labelled list. It is deliberately not a `nav`
// landmark so the sidebar stays the single navigation landmark of the shell.
function Breadcrumb() {
  const crumbs = useRouteCrumbs();

  return (
    <ol
      aria-label="Breadcrumb"
      data-tauri-drag-region
      className="flex min-w-0 items-center gap-1.5 overflow-hidden pl-3 text-[13px] whitespace-nowrap text-muted"
    >
      {crumbs.map((crumb, index) => (
        <li
          // The accumulated path is unique per crumb and stable across renders.
          key={crumbs.slice(0, index + 1).join("/")}
          data-tauri-drag-region
          className="truncate not-first:before:mr-1.5 not-first:before:text-muted-soft not-first:before:content-['/'] last:font-medium last:text-ink"
        >
          {crumb}
        </li>
      ))}
    </ol>
  );
}

// Drop a stale window-control message once the user moves to another area.
function useClearWindowFailureOnRouteChange(): void {
  const pathname = useLocation().pathname;
  const setWindowControlFailure = useShellStore((state) => state.setWindowControlFailure);

  // The effect exists precisely to run on every route change, so `pathname` is its trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is a trigger, not a read.
  useEffect(() => {
    setWindowControlFailure(null);
  }, [pathname, setWindowControlFailure]);
}

// Render the frameless window chrome: drag surface, brand menu, route context, the two
// reserved entry points and the three custom window actions.
export function AppTopbar(props: { onQuit: () => void; isCheckingQuit: boolean }) {
  const isCollapsed = useShellStore((state) => state.isSidebarCollapsed);
  const isResizing = useShellStore((state) => state.isSidebarResizing);
  const sidebarWidthPx = useShellStore((state) => state.sidebarWidthPx);
  const brandColumnPx = isCollapsed ? COLLAPSED_SIDEBAR_WIDTH_PX : sidebarWidthPx;
  const prefersReducedMotion = usePrefersReducedMotion();

  useClearWindowFailureOnRouteChange();

  // Only inert background may toggle the window. Tauri blocks its own double-click handling
  // because the capability grants dragging alone, so this is the single maximize path.
  function handleDoubleClick(event: React.MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR) !== null) {
      return;
    }

    void toggleMaximized();
  }

  // Native window dragging can take over before the webview performs its usual focus change.
  // Clear the previously clicked control first so its focus tooltip cannot reopen mid-drag.
  function handleDragRegionPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest(INTERACTIVE_SELECTOR) !== null
    ) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  return (
    // The double click only duplicates the Maximize button that sits inside this surface.
    // biome-ignore lint/a11y/noStaticElementInteractions: native window drag surface.
    <header
      data-testid="shell-topbar"
      data-tauri-drag-region
      onPointerDownCapture={handleDragRegionPointerDown}
      onDoubleClick={handleDoubleClick}
      className="grid items-center border-b border-hairline bg-canvas"
      style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto" }}
    >
      {/* The brand column is an `auto` track sized by this element, so its width can follow
          the same transition as the sidebar it must stay aligned with. A track list mixing
          `minmax()` and `auto` is not reliably interpolable, which is why the width lives
          here instead of on the grid. */}
      {/* The wordmark is placed by padding alone, never by centring it in this column: the
          width here is still animating, so centring would put the wordmark in the middle of
          the still-open column on a collapse and only then carry it back to the left. The
          `px-3` plus the `px-1.5` the menu trigger carries put the glyph on the same `18px`
          rail inset as the sidebar icons underneath it, in both widths. Anything the column
          is still too narrow for is clipped rather than painted over the breadcrumb. */}
      <div
        data-tauri-drag-region
        style={{ width: brandColumnPx }}
        className={cn(
          "flex h-10 items-center overflow-hidden px-3 transition-[width] duration-400 ease-[cubic-bezier(0.7,-0.15,0.25,1.15)] motion-reduce:transition-none",
          isResizing && "transition-none",
        )}
      >
        <AppMenu onQuit={props.onQuit} isCheckingQuit={props.isCheckingQuit} />
      </div>
      <div
        data-tauri-drag-region
        className="grid min-w-0 items-center gap-4 pr-4"
        style={{ gridTemplateColumns: "minmax(0, 1.6fr) auto minmax(0, 1fr)" }}
      >
        <Breadcrumb />
        <SearchEntry />
        <div data-tauri-drag-region />
      </div>
      <Highlight
        mode="parent"
        controlledItems
        hover
        enabled={!prefersReducedMotion}
        containerClassName="h-10"
        className="pointer-events-none bg-surface-card"
      >
        <div className="flex h-10 items-center gap-1">
          <NotificationBell />
          <WindowControls />
        </div>
      </Highlight>
    </header>
  );
}

// Reserve the search and command entry point. It stays inert, and `aria-disabled` rather than
// `disabled` keeps it in the documented focus order and keeps its tooltip reachable.
function SearchEntry() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-disabled="true"
          className="flex h-7 w-[320px] cursor-default items-center gap-2 rounded-md border border-hairline bg-surface-soft pr-2 pl-2.5 text-[13px] text-muted-soft outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <span>Search or run a command</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Search and the command palette arrive with FE-009.
      </TooltipContent>
    </Tooltip>
  );
}

// Reserve the notification entry point. No unread indicator is rendered while no source exists.
function NotificationBell() {
  return (
    <Tooltip>
      <HighlightItem asChild activeClassName="bg-surface-card">
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-disabled="true"
            aria-label="Notifications"
            className="relative z-[1] flex h-10 w-11 cursor-default items-center justify-center text-body outline-none [&:not([data-highlight])]:hover:bg-surface-card active:bg-cream-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
      </HighlightItem>
      <TooltipContent side="bottom">Notifications arrive with FE-010.</TooltipContent>
    </Tooltip>
  );
}
