// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getKeyboardShortcuts } from "@/lib/ipc/keyboard-shortcuts";
import * as notifications from "@/lib/ipc/notifications";
import { searchUnified } from "@/lib/ipc/search";
import { AppProviders } from "./app-providers";
import { createAppRouter } from "./app-router";
import { resetQuitStore, useQuitStore } from "./quit-store";

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

// Replace the Sessions boundary the sidebar block now reads, so these cases stay about the
// shell and never observe a runtime session.
vi.mock("@/lib/ipc/sessions", () => ({
  listSessions: vi.fn(async () => []),
  onSessionsRuntimeChanged: vi.fn(async () => () => {}),
  setObservedSession: vi.fn(async () => null),
}));

// Remove rendered output between tests so each router instance stays isolated.
afterEach(() => {
  cleanup();
  resetQuitStore();
  vi.mocked(getKeyboardShortcuts).mockResolvedValue({ actions: [] });
});

/** A modal palette takes focus above notifications and yields cleanly to Quit. */
it("composes palette focus with notifications, route changes and Quit", async () => {
  const chord = { primary: true, alt: false, shift: false, keyCode: "KeyK" };
  vi.mocked(getKeyboardShortcuts).mockResolvedValue({
    actions: [
      {
        actionId: "search.open_command_palette",
        label: "Search",
        category: "global",
        scope: "application",
        currentChord: chord,
        defaultChord: chord,
        isCustom: false,
        conflictsWith: [],
        isDispatchable: true,
      },
    ],
  });
  const user = userEvent.setup();
  const router = createAppRouter(["/"]);
  const view = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Search or run a command" })).toHaveTextContent(
      "Ctrl K",
    ),
  );
  await user.click(screen.getByRole("button", { name: /^Notifications/ }));
  await screen.findByRole("dialog", { name: "Notifications" });
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "k",
    code: "KeyK",
    ctrlKey: true,
  });
  const input = await screen.findByRole("combobox");
  await waitFor(() => expect(input).toHaveFocus());
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  // An external route change dismisses the search lifetime without restoring old focus.
  await act(async () => router.navigate("/calendar"));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Search or run a command" }));
  await screen.findByRole("combobox");
  act(() =>
    useQuitStore.getState().receiveTrayRequest({
      requestId: 9,
      summary: { sessionCount: 1, projectCount: 1, runningProcessCount: 1, unsavedFileCount: 0 },
    }),
  );
  const quit = await screen.findByRole("dialog", { name: "Quit XWork?" });
  await waitFor(() => expect(quit.contains(document.activeElement)).toBe(true));
  expect(screen.queryByRole("combobox")).toBeNull();
  const calls = vi.mocked(searchUnified).mock.calls.length;
  view.unmount();
  fireEvent.focus(window);
  expect(searchUnified).toHaveBeenCalledTimes(calls);
});

/** One mounted notification listener survives route changes and releases on shell unmount. */
it("keeps one notification owner across routes and dismisses for Quit", async () => {
  vi.mocked(notifications.onNotificationsChanged).mockClear();
  const stop = vi.fn();
  vi.mocked(notifications.onNotificationsChanged).mockResolvedValueOnce(stop);
  const user = userEvent.setup();
  const view = renderShellAt("/");
  await screen.findByRole("button", { name: "Notifications, 0 unread" });
  await user.click(screen.getByRole("button", { name: /^Notifications/ }));
  expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Calendar" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument(),
  );
  expect(notifications.onNotificationsChanged).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /^Notifications/ }));
  act(() => useQuitStore.setState({ phase: "requesting" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: /^Notifications/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /^Notifications/ })).not.toHaveFocus();
  // The real Quit dialog must keep its autofocus after the notification portal unmounts.
  act(() =>
    useQuitStore.getState().receiveTrayRequest({
      requestId: 7,
      summary: { sessionCount: 1, projectCount: 1, runningProcessCount: 1, unsavedFileCount: 0 },
    }),
  );
  const quit = await screen.findByRole("dialog", { name: "Quit XWork?" });
  await waitFor(() => expect(quit.contains(document.activeElement)).toBe(true));
  act(() => useQuitStore.setState({ phase: "idle", request: null }));
  await user.click(screen.getByRole("button", { name: /^Notifications/ }));
  expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
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
  // Keep the outer grid's intrinsic column from expanding with terminal rows.
  it("bounds the shell grid and sidebar body to the window", () => {
    renderShellAt("/");
    const body = screen.getByTestId("shell-body");
    expect(body).toHaveClass("min-w-0");
    expect(body.parentElement).toHaveClass("grid-cols-[minmax(0,1fr)]");
  });

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
      screen.getByRole("button", { name: /^Notifications/ }),
      screen.getByRole("button", { name: "Minimize" }),
      screen.getByRole("button", { name: "Maximize" }),
      screen.getByRole("button", { name: "Close (hides to tray)" }),
      screen.getByRole("link", { name: "Home" }),
      screen.getByRole("link", { name: "Projects" }),
      screen.getByRole("link", { name: "Notes" }),
      screen.getByRole("link", { name: "Calendar" }),
      screen.getByRole("button", { name: "Add Project" }),
      // The expander of a project row precedes its name, which is the order the row is
      // painted in and therefore the order Tab follows.
      screen.getByRole("button", { name: "Sessions for xwork" }),
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

/** Isolate provider reads from the native backend. */
vi.mock("@/lib/ipc/keyboard-shortcuts", () => ({
  getKeyboardShortcuts: vi.fn(async () => ({ actions: [] })),
  setKeyboardShortcut: vi.fn(),
  resetKeyboardShortcut: vi.fn(),
  resetAllKeyboardShortcuts: vi.fn(),
}));

/** Isolate only palette IPC while keeping the real shell and dialog composition. */
vi.mock("@/lib/ipc/search", () => ({
  searchUnified: vi.fn(async () => ({ query: "", groups: [], resultCount: 0, sourceFailures: [] })),
}));
/** Isolate platform detection for shell-only tests. */
vi.mock("@/lib/ipc/app-info", () => ({
  readAppInfo: vi.fn(async () => ({ osPlatform: "windows" })),
}));

// Isolate the persistent notification owner from native IPC in shell regressions.
vi.mock("@/lib/ipc/notifications", () => ({
  // Provide an authoritative empty snapshot without any real app data.
  getNotifications: vi.fn(async () => ({
    revision: "1",
    unreadCount: 0,
    items: [],
    nextCursor: null,
  })),
  // Return an observable cleanup for the shell lifetime.
  onNotificationsChanged: vi.fn(async () => vi.fn()),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  deleteNotification: vi.fn(),
  clearReadNotifications: vi.fn(),
  openNotification: vi.fn(),
}));
