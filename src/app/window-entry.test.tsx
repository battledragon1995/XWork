import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createAppRouter } from "./app-router";
import { createWindowEntry } from "./window-entry";

/** Replace native capture with a mount marker. */
vi.mock("@/features/notes/quick-note-window", () => ({
  QuickNoteWindow: /** Mark isolated capture. */ () => <div>Floating capture</div>,
}));
/** Keep settings synchronization read-only in this composition test. */
vi.mock("@/features/settings/appearance-theme-sync", () => ({
  AppearanceThemeSync: /** Mark theme composition. */ () => <div>Theme</div>,
}));
/** Observe main owner mounting. */
vi.mock("./app-providers", () => ({
  AppProviders: /** Mark main providers. */ ({ children }: { children: ReactNode }) => (
    <div>Main owners{children}</div>
  ),
}));
/** Observe router construction before mounting. */
vi.mock("./app-router", () => ({ createAppRouter: vi.fn() }));
/** Avoid constructing a real router in this branch test. */
vi.mock("react-router", () => ({
  RouterProvider: /** Mark the main router. */ () => <div>Main router</div>,
}));
/** Reset mount and construction history. */
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
/** Exact query selects capture without creating the router or main owners. */
it("isolates the quick-note window", () => {
  render(createWindowEntry("?window=quick-note"));
  expect(screen.getByText("Floating capture")).toBeInTheDocument();
  expect(screen.getByText("Theme")).toBeInTheDocument();
  expect(createAppRouter).not.toHaveBeenCalled();
  expect(screen.queryByText("Main owners")).toBeNull();
});
/** Missing or other window values retain main composition. */
it.each(["", "?window=other", "?window=quick-note-extra", "?quick-note=true"])(
  "uses main for %s",
  (search) => {
    render(createWindowEntry(search));
    expect(createAppRouter).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Main router")).toBeInTheDocument();
    expect(screen.queryByText("Floating capture")).toBeNull();
  },
);
