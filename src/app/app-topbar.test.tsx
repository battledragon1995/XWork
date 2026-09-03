// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideMainWindow,
  minimizeMainWindow,
  toggleMainWindowMaximized,
} from "@/lib/ipc/app-lifecycle";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { AppProviders } from "./app-providers";
import { createAppRouter } from "./app-router";
import { COLLAPSED_SIDEBAR_WIDTH_PX, resetShellStore, useShellStore } from "./shell-store";

// Replace the lifecycle boundary so no test touches a real operating-system window.
vi.mock("@/lib/ipc/app-lifecycle", () => ({
  hideMainWindow: vi.fn(),
  minimizeMainWindow: vi.fn(),
  toggleMainWindowMaximized: vi.fn(),
  requestQuit: vi.fn(),
  cancelQuit: vi.fn(),
  confirmQuit: vi.fn(),
  onQuitRequested: vi.fn(async () => () => {}),
  onNavigateSession: vi.fn(async () => () => {}),
}));

const hideMock = vi.mocked(hideMainWindow);
const minimizeMock = vi.mocked(minimizeMainWindow);
const toggleMock = vi.mocked(toggleMainWindowMaximized);

beforeEach(() => {
  vi.clearAllMocks();
  resetShellStore();
});

afterEach(() => {
  cleanup();
});

// Render the real shell so the topbar is exercised inside its router and providers.
function renderShellAt(path = "/") {
  return render(
    <AppProviders>
      <RouterProvider router={createAppRouter([path])} />
    </AppProviders>,
  );
}

describe("AppTopbar context", () => {
  // Verify the breadcrumb follows the matched route rather than any stored value.
  it("updates the breadcrumb when the route changes", async () => {
    const user = userEvent.setup();
    renderShellAt("/");

    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Home");

    await user.click(screen.getByRole("link", { name: "Calendar" }));

    expect(screen.getByLabelText("Breadcrumb")).toHaveTextContent("Calendar");
  });
});

describe("AppTopbar reserved entry points", () => {
  // Verify the search entry keeps its wireframe position but cannot be used yet.
  it("renders the search entry disabled with its own tooltip", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const search = screen.getByRole("button", { name: "Search or run a command" });
    expect(search).toHaveAttribute("aria-disabled", "true");

    await user.hover(search);

    expect(
      await screen.findByRole("tooltip", {
        name: "Search and the command palette arrive with FE-009.",
      }),
    ).toBeInTheDocument();
  });

  // Verify the reserved shortcut badge is not advertised while the entry does nothing.
  it("shows no keyboard shortcut badge on the search entry", () => {
    renderShellAt();

    expect(screen.getByRole("button", { name: "Search or run a command" })).not.toHaveTextContent(
      /ctrl/i,
    );
  });

  // Verify the notification bell keeps its position but cannot be used yet.
  it("renders the notification bell disabled with its own tooltip", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell).toHaveAttribute("aria-disabled", "true");

    await user.hover(bell);

    expect(
      await screen.findByRole("tooltip", { name: "Notifications arrive with FE-010." }),
    ).toBeInTheDocument();
  });

  // Verify no unread count is invented while there is no notification source.
  it("shows no unread badge on the notification bell", () => {
    renderShellAt();

    expect(screen.getByRole("button", { name: "Notifications" })).toHaveTextContent("");
  });
});

describe("AppMenu", () => {
  // Verify the menu opens with the pointer.
  it("opens from the wordmark with the mouse", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "XWork menu" }));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  // Verify the menu is fully operable from the keyboard.
  it("opens from the wordmark with the keyboard", async () => {
    const user = userEvent.setup();
    renderShellAt();

    screen.getByRole("button", { name: "XWork menu" }).focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: "Quit XWork" })).toBeInTheDocument();
  });

  // Verify Quit is the final entry and a separator sets it apart, as §18 requires.
  it("places Quit XWork last, after a separator", async () => {
    const user = userEvent.setup();
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "XWork menu" }));
    const menu = await screen.findByRole("menu");
    const rows = [...menu.querySelectorAll("[role='menuitem'], [role='separator']")];

    expect(rows.at(-1)).toHaveAccessibleName("Quit XWork");
    expect(rows.at(-2)).toHaveAttribute("role", "separator");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
  });

  // Verify Escape closes the menu and hands focus back to the wordmark.
  it("closes on Escape and returns focus to the wordmark", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const wordmark = screen.getByRole("button", { name: "XWork menu" });
    await user.click(wordmark);
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    expect(wordmark).toHaveFocus();
  });
});

describe("WindowControls", () => {
  // Verify each control dispatches exactly the command the backend contract defines.
  it.each([
    ["Minimize", () => minimizeMock],
    ["Close (hides to tray)", () => hideMock],
  ])("dispatches the backend command behind %s", async (name, resolveMock) => {
    const user = userEvent.setup();
    const commandMock = resolveMock();
    commandMock.mockResolvedValue(undefined);
    renderShellAt();

    await user.click(screen.getByRole("button", { name }));

    expect(commandMock).toHaveBeenCalledOnce();
  });

  // Verify the maximize control follows the native state the backend reports back.
  it("renames itself from the maximized state the backend returns", async () => {
    const user = userEvent.setup();
    toggleMock.mockResolvedValue(true);
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Maximize" }));

    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(useShellStore.getState().isMaximized).toBe(true);

    toggleMock.mockResolvedValue(false);
    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("button", { name: "Maximize" })).toBeInTheDocument();
  });

  // Verify the drag region offers the same maximize toggle as the button does.
  it("toggles maximize on a double click of the drag region", async () => {
    toggleMock.mockResolvedValue(true);
    renderShellAt();

    fireEvent.doubleClick(screen.getByTestId("shell-topbar"));

    await waitFor(() => {
      expect(toggleMock).toHaveBeenCalledOnce();
    });
  });

  // Verify the drag region is declared where the window may be moved and nowhere else.
  it("marks the topbar background as the drag region and the controls as not draggable", () => {
    renderShellAt();

    expect(screen.getByTestId("shell-topbar")).toHaveAttribute("data-tauri-drag-region");
    expect(screen.getByRole("button", { name: "Minimize" })).not.toHaveAttribute(
      "data-tauri-drag-region",
    );
  });
});

describe("WindowControls failures", () => {
  // Verify a recoverable window failure is announced politely and invites another attempt.
  it("announces a recoverable window failure", async () => {
    const user = userEvent.setup();
    minimizeMock.mockRejectedValue(
      new IpcCallError("minimize_main_window", {
        code: "window_operation_failed",
        operation: "minimize",
      }),
    );
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Minimize" }));

    const status = await screen.findByRole("status");

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Couldn't minimize the window. Try again.");
  });

  // Verify an integration failure is raised to the application level with no retry offered.
  it("raises an integration failure to the application level", async () => {
    const user = userEvent.setup();
    hideMock.mockRejectedValue(new IpcCallError("hide_main_window", { code: "invalid_window" }));
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Close (hides to tray)" }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "XWork ran into a problem it cannot recover from. Restart XWork.",
    );
    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  // Verify a rejection that carries no recognizable code is handled as an integration failure.
  it("treats an unrecognized rejection as an integration failure", async () => {
    const user = userEvent.setup();
    minimizeMock.mockRejectedValue(new IpcCallError("minimize_main_window", null));
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Minimize" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(useShellStore.getState().windowControlFailure).toEqual({
      control: "minimize",
      code: "unknown",
    });
  });

  // Verify the next successful window action clears the previous failure.
  it("clears the failure after the next successful action", async () => {
    const user = userEvent.setup();
    minimizeMock.mockRejectedValueOnce(
      new IpcCallError("minimize_main_window", {
        code: "window_operation_failed",
        operation: "minimize",
      }),
    );
    minimizeMock.mockResolvedValueOnce(undefined);
    renderShellAt();

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await screen.findByRole("status");

    await user.click(screen.getByRole("button", { name: "Minimize" }));

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  // Verify moving to another area clears a stale failure message.
  it("clears the failure on a route change", async () => {
    const user = userEvent.setup();
    minimizeMock.mockRejectedValue(
      new IpcCallError("minimize_main_window", {
        code: "window_operation_failed",
        operation: "minimize",
      }),
    );
    renderShellAt("/");

    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await screen.findByRole("status");

    await user.click(screen.getByRole("link", { name: "Notes" }));

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(useShellStore.getState().windowControlFailure).toBeNull();
  });
});

describe("AppTopbar brand column", () => {
  // Read the column whose width follows the sidebar and carries the wordmark.
  function getBrandColumn() {
    return screen.getByTestId("shell-topbar").firstElementChild as HTMLElement;
  }

  // Verify the wordmark is placed by padding alone. Centring it inside the column resolves
  // against a width that is still animating, so a collapse would put the wordmark in the
  // middle of the still-open column and then carry it back to the left.
  it("places the wordmark by padding rather than against the animating width", async () => {
    const user = userEvent.setup();
    renderShellAt();

    const open = getBrandColumn();
    expect(open.className).toContain("transition-[width]");
    expect(open.className).toContain("px-3");
    expect(open.className).not.toContain("justify-center");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    const closed = getBrandColumn();
    expect(closed.className).toContain("px-3");
    expect(closed.className).not.toContain("justify-center");
    expect(closed.style.width).toBe(`${COLLAPSED_SIDEBAR_WIDTH_PX}px`);
  });

  // Verify the column clips what it is still too narrow for instead of painting the wordmark
  // over the breadcrumb for the length of an expand.
  it("clips the wordmark to the column", () => {
    renderShellAt();

    expect(getBrandColumn().className).toContain("overflow-hidden");
  });

  // Verify the brand column still offers the window drag surface.
  it("keeps the wordmark surround draggable", () => {
    renderShellAt();

    expect(getBrandColumn()).toHaveAttribute("data-tauri-drag-region");
  });
});
