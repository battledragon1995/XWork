import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationDto, NotificationPageDto } from "@/bindings/notifications/notifications";
import { Highlight } from "@/components/animate-ui/primitives/effects/highlight";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as ipc from "@/lib/ipc/notifications";
import { NotificationCenter, notificationTime } from "./notification-center";

// Render real hook/UI behavior while isolating all native operations.
vi.mock("@/lib/ipc/notifications", () => ({
  getNotifications: vi.fn(),
  onNotificationsChanged: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  deleteNotification: vi.fn(),
  clearReadNotifications: vi.fn(),
  openNotification: vi.fn(),
}));
const target = {
  kind: "session" as const,
  projectId: "p",
  sessionId: "s",
  tabId: "t",
  paneId: "pane",
};
const row: NotificationDto = {
  id: "n1",
  kind: "terminalNeedsInput",
  title: "Input needed",
  context: "<script>alert('x')</script> Unicode 日本語",
  target,
  statusCode: null,
  createdAtMs: "1700000000000",
  readAtMs: null,
};
let snapshot: NotificationPageDto;
/** Requires an existing first action instead of masking missing UI with a type assertion. */
function firstButton(name: string): HTMLElement {
  const button = screen.getAllByRole("button", { name })[0];
  if (!button) throw new Error(`Expected action ${name}.`);
  return button;
}
// Reset snapshots and native spies for each component scenario.
beforeEach(() => {
  vi.resetAllMocks();
  snapshot = {
    revision: "1",
    unreadCount: 105,
    items: [
      row,
      {
        ...row,
        id: "n2",
        kind: "terminalProcessFinished",
        title: "Finished",
        statusCode: "0",
        readAtMs: "2",
      },
      { ...row, id: "n3", kind: "terminalProcessFailed", title: "Failed", statusCode: "1" },
    ],
    nextCursor: null,
  };
  // Always return the test's current authoritative page.
  vi.mocked(ipc.getNotifications).mockImplementation(async () => snapshot);
  vi.mocked(ipc.onNotificationsChanged).mockResolvedValue(vi.fn());
});
// Dispose the portal and timers after each scenario.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
/** Renders the feature with its existing shell providers and an outside focus target. */
function mount() {
  const onOpenTarget = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <TooltipProvider>
      <Highlight mode="parent" controlledItems enabled={false}>
        <NotificationCenter onOpenTarget={onOpenTarget} dismissKey="one" suspended={false} />
      </Highlight>
      <button type="button">Outside</button>
    </TooltipProvider>,
  );
  return { ...view, onOpenTarget, user: userEvent.setup() };
}
/** Opens the real popover once the initial global count has arrived. */
async function open(view: ReturnType<typeof mount>) {
  const bell = await screen.findByRole("button", { name: "Notifications, 105 unread" });
  await view.user.click(bell);
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Open session" })[0]).toBeEnabled(),
  );
  return screen.getByRole("dialog", { name: "Notifications" });
}
// Three generated kinds, escaped content and full unread accessibility share one keyboard dialog.
it("opens with keyboard, shows all kinds and restores Escape focus", async () => {
  const view = mount();
  const bell = await screen.findByRole("button", { name: "Notifications, 105 unread" });
  expect(bell).toHaveTextContent("99+");
  bell.focus();
  await view.user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "Notifications" });
  expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus();
  expect(within(dialog).getByText("Input needed")).toBeInTheDocument();
  expect(within(dialog).getByText("Finished")).toBeInTheDocument();
  expect(within(dialog).getByText("Failed")).toBeInTheDocument();
  expect(within(dialog).getAllByText(row.context)).toHaveLength(3);
  expect(dialog.querySelector("script")).toBeNull();
  expect(within(dialog).getByText("Exit code: 1")).toBeInTheDocument();
  await view.user.tab();
  expect(screen.getByRole("button", { name: "Mark all read" })).toHaveFocus();
  expect(ipc.markAllNotificationsRead).not.toHaveBeenCalled();
  expect(ipc.markNotificationRead).not.toHaveBeenCalled();
  await view.user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(bell).toHaveFocus();
});
// Global read/delete actions use server results and preserve a useful nearby focus target.
it("marks one read and deletes with next-row focus fallback", async () => {
  const view = mount();
  const dialog = await open(view);
  // Commit the modified read state in the fixture, including its authoritative count.
  vi.mocked(ipc.markNotificationRead).mockImplementation(async () => {
    snapshot = {
      ...snapshot,
      revision: "2",
      unreadCount: 104,
      items: snapshot.items.map((item) => (item.id === "n1" ? { ...item, readAtMs: "2" } : item)),
    };
    return { revision: "2", unreadCount: 104, affectedCount: 1 };
  });
  await view.user.click(firstButton("Mark read"));
  await waitFor(() =>
    expect(within(dialog).getAllByRole("button", { name: "Open session" })[0]).toHaveFocus(),
  );
  expect(ipc.markNotificationRead).toHaveBeenCalledWith("n1");
  // Remove exactly the first row while retaining all other rows in backend order.
  vi.mocked(ipc.deleteNotification).mockImplementation(async () => {
    snapshot = { ...snapshot, revision: "3", items: snapshot.items.slice(1) };
    return { revision: "3", unreadCount: 104, affectedCount: 1 };
  });
  await view.user.click(firstButton("Delete notification"));
  await waitFor(() => expect(within(dialog).queryByText("Input needed")).not.toBeInTheDocument());
  expect(within(dialog).getAllByRole("button", { name: "Delete notification" })[0]).toHaveFocus();
});
// Bulk actions must include unloaded read records even when no read row is visible.
it("keeps Clear read available for all-unread pages and invokes global bulk actions", async () => {
  snapshot.items = [row];
  const view = mount();
  await open(view);
  const clear = screen.getByRole("button", { name: "Clear read" });
  expect(clear).toBeEnabled();
  vi.mocked(ipc.clearReadNotifications).mockResolvedValue({
    revision: "1",
    unreadCount: 105,
    affectedCount: 0,
  });
  await view.user.click(clear);
  await waitFor(() => expect(clear).toBeEnabled());
  expect(ipc.clearReadNotifications).toHaveBeenCalledWith();
  // Simulate all 105 records becoming read, including unloaded rows.
  vi.mocked(ipc.markAllNotificationsRead).mockImplementation(async () => {
    snapshot = { ...snapshot, revision: "2", unreadCount: 0, items: [{ ...row, readAtMs: "2" }] };
    return { revision: "2", unreadCount: 0, affectedCount: 105 };
  });
  await view.user.click(screen.getByRole("button", { name: "Mark all read" }));
  const bell = await screen.findByRole("button", { name: "Notifications, 0 unread" });
  expect(bell).toHaveTextContent("");
  expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
});
// A successful Open uses only the freshly validated target and closes the surface.
it("opens only the target returned by the backend", async () => {
  const validated = { ...target, paneId: "validated-pane" };
  vi.mocked(ipc.openNotification).mockResolvedValue({
    target: validated,
    state: { revision: "1", unreadCount: 105, affectedCount: 0 },
  });
  const view = mount();
  await open(view);
  await view.user.click(firstButton("Open session"));
  expect(view.onOpenTarget).toHaveBeenCalledWith(validated, expect.any(AbortSignal));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

/** Activation failures preserve committed read state and keep the panel actionable. */
it.each(["paneNotFound", "projectUnavailable"])(
  "reports %s after a committed Open without rolling back read",
  async (code) => {
    // Commit read independently of the later app-owned navigation result.
    vi.mocked(ipc.openNotification).mockImplementation(async () => {
      snapshot = { ...snapshot, revision: "2", unreadCount: 0, items: [{ ...row, readAtMs: "2" }] };
      return { target, state: { revision: "2", unreadCount: 0, affectedCount: 1 } };
    });
    const view = mount();
    await open(view);
    view.onOpenTarget.mockRejectedValue(new IpcCallError("set_active_pane", { code }));
    await view.user.click(firstButton("Open session"));
    expect(
      await screen.findByText(
        code === "paneNotFound"
          ? "This session is no longer available."
          : "Couldn't open this session. Try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications, 0 unread" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete notification" })).toBeEnabled(),
    );
  },
);
// Outside pointer dismissal keeps its clicked target, and pending work leaves Close usable.
it("retains outside focus and allows close while a mutation is pending", async () => {
  const view = mount();
  await open(view);
  await view.user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
  await open(view);
  let finish!: (value: Awaited<ReturnType<typeof ipc.deleteNotification>>) => void;
  // Hold a mutation to inspect pending action gating without sleeps.
  vi.mocked(ipc.deleteNotification).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await view.user.click(firstButton("Delete notification"));
  expect(screen.getByText("Working…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear read" })).toBeDisabled();
  await view.user.click(screen.getByRole("button", { name: "Close notifications" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => finish({ revision: "1", unreadCount: 105, affectedCount: 0 }));
});
// Empty/loading/query failure states never fabricate a count or hide stale data silently.
it("renders unknown loading, retry failure and an empty recovered snapshot", async () => {
  let fail!: (error: unknown) => void;
  // Hold startup until the panel is visible.
  vi.mocked(ipc.getNotifications).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const view = mount();
  await view.user.click(screen.getByRole("button", { name: "Notifications" }));
  expect(screen.getByText("Loading notifications…")).toBeInTheDocument();
  snapshot = { revision: "1", unreadCount: 0, items: [], nextCursor: null };
  vi.mocked(ipc.getNotifications).mockRejectedValue(new Error("offline"));
  await act(async () => fail(new Error("offline")));
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  vi.mocked(ipc.getNotifications).mockResolvedValue(snapshot);
  await view.user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Notifications, 0 unread" })).toBeInTheDocument();
});
// Cursor actions append and disable after exhaustion without replacing prior rows.
it("loads more and preserves stale rows on a later refresh failure", async () => {
  snapshot = {
    ...snapshot,
    items: [row],
    nextCursor: { id: row.id, createdAtMs: row.createdAtMs },
  };
  const view = mount();
  await open(view);
  vi.mocked(ipc.getNotifications).mockResolvedValueOnce({
    ...snapshot,
    items: [{ ...row, id: "more", title: "Older" }],
    nextCursor: null,
  });
  await view.user.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Older")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  vi.mocked(ipc.getNotifications).mockRejectedValue(new Error("offline"));
  act(() => fireEvent.focus(window));
  expect(await screen.findByText("Notifications may be out of date.")).toBeInTheDocument();
  expect(screen.getByText("Older")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Open session" })[0]).toBeDisabled();
});
// Decimal domain checks, future dates and relative-time boundaries remain deterministic.
it("formats English relative time without invalid Date crashes", () => {
  const now = 1700000000000;
  for (const [age, label] of [
    [0, "now"],
    [59999, "now"],
    [60000, "1m"],
    [3600000, "1h"],
    [86400000, "1d"],
    [-60000, "now"],
  ] as const)
    expect(notificationTime(String(now - age), now).label).toBe(label);
  expect(notificationTime("9007199254740993", now).label).toBe("Time unavailable");
  expect(notificationTime("bad", now).label).toBe("Time unavailable");
  expect(notificationTime(String(now), now).title).toMatch(/2023/);
});

/** Relative-time ticking exists only for an open panel and updates all rows together. */
it("updates time once per minute only while open", async () => {
  const view = mount();
  await open(view);
  await view.user.click(screen.getByRole("button", { name: "Close notifications" }));
  vi.useFakeTimers();
  vi.setSystemTime(1700000000000);
  const interval = vi.spyOn(globalThis, "setInterval");
  const clear = vi.spyOn(globalThis, "clearInterval");
  fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getAllByText("now")).toHaveLength(3);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(screen.getAllByText("1m")).toHaveLength(3);
  expect(interval).toHaveBeenCalledTimes(1);
  expect(interval).toHaveBeenCalledWith(expect.any(Function), 60000);
  fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(clear).toHaveBeenCalledWith(interval.mock.results[0]?.value);
  view.unmount();
  interval.mockRestore();
  clear.mockRestore();
});

/** Deleting the final row has a stable heading focus target rather than focusing the body. */
it("focuses the heading after deleting the final row", async () => {
  snapshot.items = [row];
  const view = mount();
  await open(view);
  // Return a successful empty inbox after removal.
  vi.mocked(ipc.deleteNotification).mockImplementation(async () => {
    snapshot = { revision: "2", unreadCount: 0, items: [], nextCursor: null };
    return { revision: "2", unreadCount: 0, affectedCount: 1 };
  });
  await view.user.click(screen.getByRole("button", { name: "Delete notification" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus());
  expect(screen.getByText("No notifications yet")).toBeInTheDocument();
});
