// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RouterProvider } from "react-router";
import { AppProviders } from "./app-providers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "./app-router";

// Replace the Projects boundary the index route depends on. One project keeps `/` on its Home
// branch, so these cases stay about the shell rather than about project data.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(async () => ({ outcome: "cancelled" })),
  getRemoveProjectImpact: vi.fn(),
  locateProjectFolder: vi.fn(async () => ({ outcome: "cancelled" })),
  openProjectFolder: vi.fn(),
  removeProject: vi.fn(),
  renameProject: vi.fn(),
  setProjectPinned: vi.fn(),
  listProjects: vi.fn(async () => [
    {
      id: "3f2a",
      displayName: "xwork",
      rootPath: "D:\\Self\\XWork",
      isPinned: false,
      addedAtMs: 1_700_000_000_000,
      lastOpenedAtMs: 1_700_000_000_000,
      availability: { status: "available" },
    },
  ]),
  onProjectsChanged: vi.fn(async () => () => {}),
}));

// Remove rendered output between tests so each router instance stays isolated.
afterEach(() => {
  cleanup();
});

// Render the production shell at one entry so every case shares the same setup.
function renderShellAt(path: string) {
  return render(
    <AppProviders>
      <RouterProvider router={createAppRouter([path])} />
    </AppProviders>,
  );
}

describe("AppShell", () => {
  // Verify the shell publishes exactly one of each landmark the specification requires.
  it("exposes one banner, one navigation and one main landmark", () => {
    renderShellAt("/");

    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  // Verify the topbar and sidebar survive a route change so only the outlet is swapped.
  it("keeps the same chrome while the content area changes", async () => {
    const user = userEvent.setup();
    renderShellAt("/");

    const banner = screen.getByRole("banner");
    const navigation = screen.getByRole("navigation");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Calendar" }));

    expect(screen.getByRole("banner")).toBe(banner);
    expect(screen.getByRole("navigation")).toBe(navigation);
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Home" })).not.toBeInTheDocument();
  });

  // Verify Tab walks the shell in the documented order and ends on the resize separator,
  // which is the keyboard equivalent of dragging the seam. The breadcrumb is not a stop
  // because it holds no interactive content in this slice. The Projects block sits between
  // the primary areas and the footer, so its Add Project action and its project rows come
  // after `Calendar` and before `Settings`.
  it("tabs through the topbar, the sidebar areas and then the resize separator", async () => {
    const user = userEvent.setup();
    renderShellAt("/");
    // The Projects block is filled by FE-004, so its action and its rows are real tab stops.
    // Wait for the row before reading the order, or the list is still empty.
    await screen.findByRole("link", { name: "xwork" });

    const expected = [
      screen.getByRole("button", { name: "XWork menu" }),
      screen.getByRole("button", { name: "Search or run a command" }),
      screen.getByRole("button", { name: "Notifications" }),
      screen.getByRole("button", { name: "Minimize" }),
      screen.getByRole("button", { name: "Maximize" }),
      screen.getByRole("button", { name: "Close (hides to tray)" }),
      screen.getByRole("link", { name: "Home" }),
      screen.getByRole("link", { name: "Projects" }),
      screen.getByRole("link", { name: "Notes" }),
      screen.getByRole("link", { name: "Calendar" }),
      screen.getByRole("button", { name: "Add Project" }),
      screen.getByRole("link", { name: "xwork" }),
      screen.getByRole("link", { name: "Settings" }),
      screen.getByRole("button", { name: "Collapse sidebar" }),
      screen.getByRole("separator", { name: "Resize sidebar" }),
    ];

    expected[0]?.focus();
    for (const element of expected) {
      expect(element).toHaveFocus();
      await user.tab();
    }
  });
});
