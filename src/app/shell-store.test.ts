import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SIDEBAR_WIDTH_PX,
  MIN_SIDEBAR_WIDTH_PX,
  resetShellStore,
  useShellStore,
} from "./shell-store";

// Start every case from the documented defaults so no case observes another case's state.
beforeEach(() => {
  resetShellStore();
});

describe("useShellStore", () => {
  // Verify the shell opens at the default width in the expanded state.
  it("starts expanded at the default width", () => {
    const state = useShellStore.getState();

    expect(state.sidebarWidthPx).toBe(232);
    expect(state.isSidebarCollapsed).toBe(false);
    expect(state.isMaximized).toBe(false);
    expect(state.windowControlFailure).toBeNull();
  });

  // Verify a width below the lower bound is clamped before it reaches the layout.
  it("clamps a width below the lower bound", () => {
    useShellStore.getState().setSidebarWidthPx(12);

    expect(useShellStore.getState().sidebarWidthPx).toBe(MIN_SIDEBAR_WIDTH_PX);
  });

  // Verify a width above the upper bound is clamped before it reaches the layout.
  it("clamps a width above the upper bound", () => {
    useShellStore.getState().setSidebarWidthPx(9000);

    expect(useShellStore.getState().sidebarWidthPx).toBe(MAX_SIDEBAR_WIDTH_PX);
  });

  // Verify a fractional pointer position becomes a whole pixel width.
  it("rounds a fractional width", () => {
    useShellStore.getState().setSidebarWidthPx(280.6);

    expect(useShellStore.getState().sidebarWidthPx).toBe(281);
  });

  // Verify collapsing never overwrites the expanded width, so expanding restores it exactly.
  it("keeps the latest expanded width across a collapse and expand cycle", () => {
    const store = useShellStore.getState();
    store.setSidebarWidthPx(301);
    store.toggleSidebarCollapsed();

    expect(useShellStore.getState().isSidebarCollapsed).toBe(true);
    expect(useShellStore.getState().sidebarWidthPx).toBe(301);

    useShellStore.getState().toggleSidebarCollapsed();

    expect(useShellStore.getState().isSidebarCollapsed).toBe(false);
    expect(useShellStore.getState().sidebarWidthPx).toBe(301);
  });

  // Verify the drag flag is published and reset without disturbing the width it was set for.
  it("tracks an active sidebar drag", () => {
    expect(useShellStore.getState().isSidebarResizing).toBe(false);

    useShellStore.getState().setSidebarWidthPx(301);
    useShellStore.getState().setSidebarResizing(true);

    expect(useShellStore.getState().isSidebarResizing).toBe(true);
    expect(useShellStore.getState().sidebarWidthPx).toBe(301);

    useShellStore.getState().setSidebarResizing(false);

    expect(useShellStore.getState().isSidebarResizing).toBe(false);
    expect(useShellStore.getState().sidebarWidthPx).toBe(301);

    resetShellStore();

    expect(useShellStore.getState().isSidebarResizing).toBe(false);
  });

  // Verify the maximize icon follows the state the backend last reported.
  it("tracks the last reported maximized state", () => {
    useShellStore.getState().setMaximized(true);

    expect(useShellStore.getState().isMaximized).toBe(true);

    useShellStore.getState().setMaximized(false);

    expect(useShellStore.getState().isMaximized).toBe(false);
  });

  // Verify a window-control failure is recorded and can be cleared by the next success.
  it("records and clears a window control failure", () => {
    useShellStore
      .getState()
      .setWindowControlFailure({ control: "minimize", code: "window_operation_failed" });

    expect(useShellStore.getState().windowControlFailure).toEqual({
      control: "minimize",
      code: "window_operation_failed",
    });

    useShellStore.getState().setWindowControlFailure(null);

    expect(useShellStore.getState().windowControlFailure).toBeNull();
  });
});
