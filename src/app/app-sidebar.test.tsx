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

/** The real `matchMedia`, restored after a case that chose a reduced-motion preference. */
const originalMatchMedia = window.matchMedia;

// Start every case from the documented defaults and remove the previous render.
beforeEach(() => {
  resetShellStore();
});

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

// Answer the reduced-motion query with a chosen value for the duration of one case.
function stubReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion") ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

// Read the single moving highlight, which only exists while the effect is enabled.
function queryHighlight() {
  return document.querySelector('[data-slot="motion-highlight"]');
}

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

// Read the wrapper of the copied Animate UI sidebar, which carries its layout state.
function getSidebar() {
  const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar"]');
  if (sidebar === null) {
    throw new Error("The sidebar is not rendered.");
  }
  return sidebar;
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

  // Verify the same tooltip is reachable without a pointer, which is what §18 asks for.
  it("carries the area label in a tooltip on keyboard focus while collapsed", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    act(() => {
      screen.getByRole("link", { name: "Notes" }).focus();
    });

    expect(await screen.findByRole("tooltip", { name: "Notes" })).toBeInTheDocument();
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

  // Verify a pointer drag suppresses the width transition and only a pointer drag does.
  it("marks the sidebar as resizing for the duration of a pointer drag", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const handle = getResizeHandle();
    expect(getSidebar()).toHaveAttribute("data-resizing", "false");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 232 });

    expect(getSidebar()).toHaveAttribute("data-resizing", "true");

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300 });

    expect(getSidebar()).toHaveAttribute("data-resizing", "false");

    getResizeHandle().focus();
    await user.keyboard("{ArrowRight}");

    expect(useShellStore.getState().sidebarWidthPx).toBe(316);
    expect(getSidebar()).toHaveAttribute("data-resizing", "false");
  });

  // Verify a cancelled pointer also ends the drag, so the transition cannot stay suppressed.
  it("ends the drag when the pointer is cancelled", () => {
    renderShellAt();

    const handle = getResizeHandle();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 232 });
    fireEvent.pointerCancel(handle, { pointerId: 1, clientX: 260 });

    expect(useShellStore.getState().isSidebarResizing).toBe(false);
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
    expect(useShellStore.getState().isSidebarResizing).toBe(false);
    expect(useShellStore.getState().sidebarWidthPx).toBe(288);

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(useShellStore.getState().sidebarWidthPx).toBe(288);
    expect(getResizeHandle()).toHaveAttribute("aria-valuenow", "288");
  });
});

describe("AppSidebar hover highlight", () => {
  // Verify collapsing under the pointer keeps one highlight attached to the renamed control.
  // Its live size is checked in the manual animation smoke test because JSDOM has no layout.
  it("keeps the hover highlight attached while collapsing", async () => {
    stubReducedMotion(false);
    const user = userEvent.setup();
    renderShellAt();

    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    await user.hover(collapse);
    expect(queryHighlight()).not.toBeNull();

    await user.click(collapse);

    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="motion-highlight"]')).toHaveLength(1);
  });

  // Verify hovering an area entry hands the moving highlight to that entry.
  it("moves a highlight to the hovered area", async () => {
    stubReducedMotion(false);
    const user = userEvent.setup();
    renderShellAt();

    expect(queryHighlight()).toBeNull();

    await user.hover(screen.getByRole("link", { name: "Notes" }));

    expect(queryHighlight()).not.toBeNull();
  });

  // Verify the effect is absent, not merely instant, when less motion is requested.
  it("renders no animated element when reduced motion is requested", async () => {
    stubReducedMotion(true);
    const user = userEvent.setup();
    renderShellAt();

    await user.hover(screen.getByRole("link", { name: "Notes" }));

    expect(queryHighlight()).toBeNull();
    expect(getSidebar().querySelector("[data-highlight]")).toBeNull();
    expect(screen.getByRole("link", { name: "Notes" })).toBeInTheDocument();
  });
});

describe("AppSidebar negative guarantees", () => {
  // Guard the FE-001 rule that the shell writes no persistence inside the webview.
  it("writes no cookie while the sidebar is used", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const before = document.cookie;

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(document.cookie).toBe(before);
  });

  // Guard the decision not to let a component claim a global shortcut of its own.
  it("ignores Ctrl+B", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.keyboard("{Control>}b{/Control}");

    expect(useShellStore.getState().isSidebarCollapsed).toBe(false);
  });
});

describe("AppSidebar layout", () => {
  // Verify the width in state reaches the sidebar through the two custom properties it reads.
  it("publishes the sidebar widths from state", () => {
    renderShellAt();

    const layout = screen.getByTestId("shell-body");
    expect(layout.style.getPropertyValue("--sidebar-width")).toBe("232px");
    expect(layout.style.getPropertyValue("--sidebar-width-icon")).toBe(
      `${COLLAPSED_SIDEBAR_WIDTH_PX}px`,
    );

    act(() => {
      useShellStore.getState().setSidebarWidthPx(345);
    });

    expect(screen.getByTestId("shell-body").style.getPropertyValue("--sidebar-width")).toBe(
      "345px",
    );
  });

  // Verify the collapsed state of the store is what switches the sidebar to its icon layout.
  it("drives the sidebar layout state from the store", async () => {
    const user = userEvent.setup();
    renderShellAt();

    expect(getSidebar()).toHaveAttribute("data-state", "expanded");
    expect(getSidebar()).toHaveAttribute("data-collapsible", "");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(getSidebar()).toHaveAttribute("data-state", "collapsed");
    expect(getSidebar()).toHaveAttribute("data-collapsible", "icon");
  });
});

describe("AppSidebar overflow", () => {
  // Verify the sidebar column never offers a horizontal scrollbar. The expand animation
  // clears `data-collapsible` on the first frame, so the Projects block is already mounted
  // at its full width while the column is still icon-narrow. A scrollable horizontal axis
  // would draw a bar along the bottom of the scroll box, right above the Settings entry.
  it("never scrolls the sidebar column horizontally", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const content = document.querySelector('[data-slot="sidebar-content"]');
    expect(content).toHaveClass("overflow-x-hidden");
    expect(content?.className.split(/\s+/)).not.toContain("overflow-auto");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    const afterToggle = document.querySelector('[data-slot="sidebar-content"]');
    expect(afterToggle).toHaveClass("overflow-x-hidden");
    expect(afterToggle?.className.split(/\s+/)).not.toContain("overflow-auto");
  });
});

describe("AppSidebar collapsed alignment", () => {
  // Verify the icon rail positions its entries with a fixed offset. That offset makes up for
  // the padding an entry trades away in icon mode, so its glyph does not move at all. Centring
  // the entries inside their list instead resolves against the width of that list, which is
  // still animating while the sidebar closes: they would land in the middle of the still-open
  // sidebar and travel back to the left, which reads as a swing right.
  it("offsets collapsed entries by a fixed length instead of centring them in the list", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    for (const list of document.querySelectorAll('[data-slot="sidebar-menu"]')) {
      expect(list.className).not.toContain("items-center");
    }

    const entries = [
      screen.getByRole("link", { name: "Home" }),
      screen.getByRole("link", { name: "Settings" }),
      screen.getByRole("button", { name: "Expand sidebar" }),
    ];
    for (const entry of entries) {
      expect(entry.className).toContain("group-data-[collapsible=icon]:ml-0.5");
    }
  });
});
