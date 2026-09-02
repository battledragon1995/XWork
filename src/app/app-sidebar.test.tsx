// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppProviders } from "./app-providers";
import { createAppRouter } from "./app-router";
import {
  COLLAPSED_SIDEBAR_WIDTH_PX,
  MAX_SIDEBAR_WIDTH_PX,
  MIN_SIDEBAR_WIDTH_PX,
  resetShellStore,
  useShellStore,
} from "./shell-store";

// Start every case from the documented defaults and remove the previous render.
beforeEach(() => {
  resetShellStore();
});

afterEach(() => {
  cleanup();
});

// Render the real shell at one entry so the sidebar is exercised through the router.
function renderShellAt(path = "/") {
  return render(
    <AppProviders>
      <RouterProvider router={createAppRouter([path])} />
    </AppProviders>,
  );
}

// Read the resize separator the sidebar publishes.
function getResizeHandle() {
  return screen.getByRole("separator", { name: "Resize sidebar" });
}

describe("AppSidebar navigation", () => {
  // Verify every sidebar entry reaches the route the router owns for that area.
  it.each([
    ["Projects", "Projects"],
    ["Notes", "Notes"],
    ["Calendar", "Calendar"],
    ["Settings", "Settings"],
  ])("navigates to the %s area", async (linkName, heading) => {
    const user = userEvent.setup();
    renderShellAt("/");

    await user.click(screen.getByRole("link", { name: linkName }));

    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  // Verify only the active area is marked as the current page.
  it("marks exactly the active area as the current page", async () => {
    const user = userEvent.setup();
    renderShellAt("/");

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("link", { name: "Notes" }));

    expect(screen.getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });
});

describe("AppSidebar Projects block", () => {
  // Verify the Phase 1 empty state uses the exact wireframe copy.
  it("shows the empty projects copy", () => {
    renderShellAt();

    expect(
      screen.getByText("No projects yet. Add a folder to start a session."),
    ).toBeInTheDocument();
  });

  // Verify no add affordance is offered, because Add Project belongs to FE-004.
  it("offers no add-project control", () => {
    renderShellAt();

    expect(screen.queryByRole("button", { name: /add project/i })).not.toBeInTheDocument();
  });
});

describe("AppSidebar collapse", () => {
  // Verify the collapse control switches the sidebar to icon width and renames itself.
  it("collapses to the icon width and renames the control", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(useShellStore.getState().isSidebarCollapsed).toBe(true);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
  });

  // Verify icon mode hides the project block but keeps every area reachable by name.
  it("hides the projects block while keeping accessible names", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(
      screen.queryByText("No projects yet. Add a folder to start a session."),
    ).not.toBeInTheDocument();
    for (const name of ["Home", "Projects", "Notes", "Calendar", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  // Verify the wordmark shrinks to the single brand letter in icon mode.
  it("shrinks the wordmark to X", async () => {
    const user = userEvent.setup();
    renderShellAt();

    expect(screen.getByTestId("wordmark")).toHaveTextContent("XWork");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.getByTestId("wordmark")).toHaveTextContent("X");
    expect(screen.getByTestId("wordmark")).not.toHaveTextContent("XWork");
  });

  // Verify an icon-only entry carries its label as a tooltip while collapsed.
  it("carries the area label in a tooltip while collapsed", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await user.hover(screen.getByRole("link", { name: "Calendar" }));

    expect(await screen.findByRole("tooltip", { name: "Calendar" })).toBeInTheDocument();
  });

  // Verify the resize separator disappears while there is no width to change.
  it("hides the resize separator while collapsed", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).not.toBeInTheDocument();
  });
});

describe("SidebarResizeHandle", () => {
  // Verify the separator publishes the current width and both documented bounds.
  it("publishes the width and the bounds", () => {
    renderShellAt();

    const handle = getResizeHandle();

    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "232");
    expect(handle).toHaveAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH_PX));
    expect(handle).toHaveAttribute("aria-valuemax", String(MAX_SIDEBAR_WIDTH_PX));
  });

  // Verify the arrow keys are the keyboard equivalent of dragging, in 16px steps.
  it("moves the width by 16px per arrow key", async () => {
    const user = userEvent.setup();
    renderShellAt();

    getResizeHandle().focus();
    await user.keyboard("{ArrowRight}");

    expect(useShellStore.getState().sidebarWidthPx).toBe(248);
    expect(getResizeHandle()).toHaveAttribute("aria-valuenow", "248");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");

    expect(useShellStore.getState().sidebarWidthPx).toBe(216);
  });

  // Verify Home and End jump to the documented bounds.
  it("jumps to the bounds with Home and End", async () => {
    const user = userEvent.setup();
    renderShellAt();

    getResizeHandle().focus();
    await user.keyboard("{End}");

    expect(useShellStore.getState().sidebarWidthPx).toBe(MAX_SIDEBAR_WIDTH_PX);

    await user.keyboard("{Home}");

    expect(useShellStore.getState().sidebarWidthPx).toBe(MIN_SIDEBAR_WIDTH_PX);
  });

  // Verify repeated arrow presses stop at the bound instead of running past it.
  it("stops at the bound instead of running past it", async () => {
    const user = userEvent.setup();
    renderShellAt();

    getResizeHandle().focus();
    await user.keyboard("{Home}{ArrowLeft}{ArrowLeft}");

    expect(useShellStore.getState().sidebarWidthPx).toBe(MIN_SIDEBAR_WIDTH_PX);

    await user.keyboard("{End}{ArrowRight}{ArrowRight}");

    expect(useShellStore.getState().sidebarWidthPx).toBe(MAX_SIDEBAR_WIDTH_PX);
  });

  // Verify a pointer drag follows the cursor and clamps at both bounds.
  it("follows a pointer drag and clamps it", () => {
    renderShellAt();

    const handle = getResizeHandle();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 232 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });

    expect(useShellStore.getState().sidebarWidthPx).toBe(300);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10 });

    expect(useShellStore.getState().sidebarWidthPx).toBe(MIN_SIDEBAR_WIDTH_PX);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5000 });

    expect(useShellStore.getState().sidebarWidthPx).toBe(MAX_SIDEBAR_WIDTH_PX);

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 5000 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 250 });

    expect(useShellStore.getState().sidebarWidthPx).toBe(MAX_SIDEBAR_WIDTH_PX);
  });

  // Verify collapsing during a drag ends the drag and keeps the latest expanded width.
  it("ends an active drag when the sidebar collapses", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const handle = getResizeHandle();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 232 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 288 });

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(useShellStore.getState().isSidebarCollapsed).toBe(true);
    expect(useShellStore.getState().sidebarWidthPx).toBe(288);

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(useShellStore.getState().sidebarWidthPx).toBe(288);
    expect(getResizeHandle()).toHaveAttribute("aria-valuenow", "288");
  });
});

describe("AppSidebar layout", () => {
  // Verify the rendered grid uses the width in state, and the icon width while collapsed.
  it("drives the shell grid width from state", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const layout = screen.getByTestId("shell-body");
    expect(layout).toHaveStyle({ gridTemplateColumns: "232px minmax(0, 1fr)" });

    act(() => {
      useShellStore.getState().setSidebarWidthPx(345);
    });
    expect(screen.getByTestId("shell-body")).toHaveStyle({
      gridTemplateColumns: "345px minmax(0, 1fr)",
    });

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(screen.getByTestId("shell-body")).toHaveStyle({
      gridTemplateColumns: `${COLLAPSED_SIDEBAR_WIDTH_PX}px minmax(0, 1fr)`,
    });
  });
});
