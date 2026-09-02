import { create } from "zustand";
import type { AppLifecycleError } from "@/bindings/app-lifecycle";

/** Width the sidebar opens at, taken from the wireframe. */
export const DEFAULT_SIDEBAR_WIDTH_PX = 232;
/** Narrowest width a pointer drag or key press may reach. */
export const MIN_SIDEBAR_WIDTH_PX = 200;
/** Widest width a pointer drag or key press may reach. */
export const MAX_SIDEBAR_WIDTH_PX = 420;
/** Fixed width of the icon-only sidebar. It is a layout constant, never stored state. */
export const COLLAPSED_SIDEBAR_WIDTH_PX = 56;

/** The three window actions the shell renders its own controls for. */
export type WindowControl = "minimize" | "maximize" | "close";

/**
 * One failed window action, kept until the next successful action or route change.
 * `"unknown"` covers a rejection that did not carry a recognizable `{ code }`, which
 * `FE-001` requires the shell to handle as an integration failure.
 */
export interface WindowControlFailure {
  control: WindowControl;
  code: AppLifecycleError["code"] | "unknown";
}

/** Temporary chrome state of the shell. Nothing here is persisted in this slice. */
export interface ShellState {
  sidebarWidthPx: number;
  isSidebarCollapsed: boolean;
  isMaximized: boolean;
  windowControlFailure: WindowControlFailure | null;
  setSidebarWidthPx(next: number): void;
  toggleSidebarCollapsed(): void;
  setMaximized(next: boolean): void;
  setWindowControlFailure(next: WindowControlFailure | null): void;
}

// Keep every published width inside the documented bounds and on a whole pixel, so the
// layout, the separator value and the restored width after a collapse always agree.
function clampSidebarWidth(next: number): number {
  if (!Number.isFinite(next)) {
    return DEFAULT_SIDEBAR_WIDTH_PX;
  }

  return Math.min(MAX_SIDEBAR_WIDTH_PX, Math.max(MIN_SIDEBAR_WIDTH_PX, Math.round(next)));
}

export const useShellStore = create<ShellState>((set) => ({
  sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX,
  isSidebarCollapsed: false,
  isMaximized: false,
  windowControlFailure: null,

  // Publish a clamped sidebar width.
  setSidebarWidthPx(next) {
    set({ sidebarWidthPx: clampSidebarWidth(next) });
  },

  // Switch between the icon sidebar and the expanded one. The expanded width is deliberately
  // left untouched so expanding restores exactly the width the user last chose.
  toggleSidebarCollapsed() {
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed }));
  },

  // Record the maximized state the backend reported for the last toggle.
  setMaximized(next) {
    set({ isMaximized: next });
  },

  // Record or clear the currently displayed window-control failure.
  setWindowControlFailure(next) {
    set({ windowControlFailure: next });
  },
}));

// Restore the documented defaults. Tests call this so no case observes another case's state.
export function resetShellStore(): void {
  useShellStore.setState({
    sidebarWidthPx: DEFAULT_SIDEBAR_WIDTH_PX,
    isSidebarCollapsed: false,
    isMaximized: false,
    windowControlFailure: null,
  });
}
