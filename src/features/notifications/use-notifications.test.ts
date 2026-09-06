import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  NotificationCenterChangedDto,
  NotificationDto,
  NotificationPageDto,
} from "@/bindings/notifications/notifications";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as ipc from "@/lib/ipc/notifications";
import { useNotifications } from "./use-notifications";

// Substitute all native notification operations with test-owned promises.
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
  projectId: "project",
  sessionId: "session",
  tabId: "tab",
  paneId: "pane",
};
const row: NotificationDto = {
  id: "n1",
  kind: "terminalProcessFinished",
  title: "Finished",
  context: "Terminal",
  target,
  statusCode: "0",
  createdAtMs: "1700000000000",
  readAtMs: null,
};
/** Supplies generated-shape snapshots with a global count independent of visible rows. */
function page(overrides: Partial<NotificationPageDto> = {}): NotificationPageDto {
  return {
    revision: "9007199254740993",
    unreadCount: 105,
    items: [row],
    nextCursor: null,
    ...overrides,
  };
}
/** Holds asynchronous work until a test deliberately completes it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  // Capture both completion paths for deterministic races.
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let listener: (value: NotificationCenterChangedDto) => void;
const stop = vi.fn();
// Restore isolated fixtures for each lifecycle test.
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.getNotifications).mockResolvedValue(page());
  // Retain the current owner's event callback.
  vi.mocked(ipc.onNotificationsChanged).mockImplementation(async (callback) => {
    listener = callback;
    return stop;
  });
  vi.mocked(ipc.markAllNotificationsRead).mockResolvedValue({
    revision: "9007199254740994",
    unreadCount: 0,
    affectedCount: 105,
  });
});
// Dispose subscriptions and restore clocks/properties between cases.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
/** Mounts the real synchronization hook with an observable app callback. */
function mount() {
  const onOpenTarget = vi.fn().mockResolvedValue(undefined);
  // Keep input changes observable through rerender for route/Quit cancellation.
  const view = renderHook((props) => useNotifications(props), {
    initialProps: { onOpenTarget, dismissKey: "route1", suspended: false },
  });
  return { ...view, onOpenTarget };
}
// Require successful initial synchronization before testing actions.
async function ready(view: ReturnType<typeof mount>) {
  await waitFor(() => expect(view.result.current.disabled).toBe(false));
}

// Listener completion precedes any initial snapshot query.
it("subscribes before querying and exposes the authoritative global count", async () => {
  const registration = deferred<() => void>();
  vi.mocked(ipc.onNotificationsChanged).mockReturnValue(registration.promise);
  const view = mount();
  expect(ipc.getNotifications).not.toHaveBeenCalled();
  expect(view.result.current.unreadCount).toBeNull();
  await act(async () => registration.resolve(stop));
  await ready(view);
  expect(ipc.getNotifications).toHaveBeenCalledWith(null, 30);
  expect(view.result.current.unreadCount).toBe(105);
  expect(view.result.current.items).toHaveLength(1);
});
// Large revisions and duplicate events cannot regress count or fetch closed panels.
it("orders decimal revisions and leaves closed pages dirty without querying", async () => {
  const view = mount();
  await ready(view);
  act(() => {
    listener({ revision: "9007199254740994", unreadCount: 106 });
    listener({ revision: "9007199254740993", unreadCount: 1 });
    listener({ revision: "9007199254740994", unreadCount: 2 });
  });
  expect(view.result.current.unreadCount).toBe(106);
  expect(view.result.current.dirty).toBe(true);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(1);
  vi.mocked(ipc.getNotifications).mockResolvedValue(
    page({ revision: "9007199254740994", unreadCount: 106 }),
  );
  act(() => view.result.current.setOpen(true));
  await ready(view);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(2);
});
// A stale initial query cannot erase a newer event count or publish stale rows.
it("discards a stale first query and serializes one replacement", async () => {
  const first = deferred<NotificationPageDto>();
  vi.mocked(ipc.getNotifications)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(page({ revision: "9007199254740994", unreadCount: 8 }));
  const view = mount();
  await waitFor(() => expect(ipc.getNotifications).toHaveBeenCalledTimes(1));
  act(() => listener({ revision: "9007199254740994", unreadCount: 8 }));
  await act(async () => first.resolve(page()));
  await ready(view);
  expect(view.result.current.unreadCount).toBe(8);
  expect(view.result.current.pageRevision).toBe("9007199254740994");
  expect(ipc.getNotifications).toHaveBeenCalledTimes(2);
});

/** Repeated in-flight invalidations still recover instead of leaving actions permanently dirty. */
it("refreshes again when a newer event overtakes the queued refresh", async () => {
  const first = deferred<NotificationPageDto>();
  const second = deferred<NotificationPageDto>();
  vi.mocked(ipc.getNotifications)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockResolvedValue(page({ revision: "9007199254740995", unreadCount: 7 }));
  const view = mount();
  await waitFor(() => expect(ipc.getNotifications).toHaveBeenCalledTimes(1));
  act(() => listener({ revision: "9007199254740994", unreadCount: 6 }));
  await act(async () => first.resolve(page()));
  expect(ipc.getNotifications).toHaveBeenCalledTimes(2);
  act(() => listener({ revision: "9007199254740995", unreadCount: 7 }));
  await act(async () => second.resolve(page({ revision: "9007199254740994", unreadCount: 6 })));
  await ready(view);
  expect(view.result.current.pageRevision).toBe("9007199254740995");
  expect(ipc.getNotifications).toHaveBeenCalledTimes(3);
});

/** Promise completion after unmount cannot update the new owner or start another request. */
it("discards late query responses and clears an outstanding coalescing timer", async () => {
  const response = deferred<NotificationPageDto>();
  const view = mount();
  await ready(view);
  act(() => view.result.current.setOpen(true));
  await ready(view);
  vi.useFakeTimers();
  act(() => listener({ revision: "9007199254740994", unreadCount: 2 }));
  vi.mocked(ipc.getNotifications).mockReturnValue(response.promise);
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(ipc.getNotifications).toHaveBeenCalledTimes(3);
  act(() => listener({ revision: "9007199254740995", unreadCount: 3 }));
  view.unmount();
  await act(async () => {
    response.resolve(page());
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(ipc.getNotifications).toHaveBeenCalledTimes(3);
  expect(stop).toHaveBeenCalledTimes(1);
});
// Bursts collapse into one delayed refresh while count is immediate.
it("coalesces open events at 100ms and recovers on focus and visibility", async () => {
  const view = mount();
  await ready(view);
  act(() => view.result.current.setOpen(true));
  await ready(view);
  vi.useFakeTimers();
  vi.mocked(ipc.getNotifications).mockResolvedValue(page({ revision: "9007199254740996" }));
  act(() => {
    listener({ revision: "9007199254740995", unreadCount: 2 });
    listener({ revision: "9007199254740996", unreadCount: 3 });
  });
  expect(view.result.current.unreadCount).toBe(3);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(ipc.getNotifications).toHaveBeenCalledTimes(3);
  vi.useRealTimers();
  act(() => window.dispatchEvent(new Event("focus")));
  await ready(view);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(4);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(ipc.getNotifications).toHaveBeenCalledTimes(4);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await ready(view);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(5);
});
// Cursor pagination deduplicates IDs and stops once the cursor is exhausted.
it("appends same-revision pages once and stops at the exhausted cursor", async () => {
  const cursor = { createdAtMs: row.createdAtMs, id: row.id };
  vi.mocked(ipc.getNotifications)
    .mockResolvedValueOnce(page({ nextCursor: cursor }))
    .mockResolvedValue(page({ items: [row, { ...row, id: "n2" }] }));
  const view = mount();
  await ready(view);
  act(() => {
    view.result.current.loadMore();
    view.result.current.loadMore();
  });
  await ready(view);
  expect(ipc.getNotifications).toHaveBeenLastCalledWith(cursor, 30);
  expect(view.result.current.items.map((item) => item.id)).toEqual(["n1", "n2"]);
  act(() => view.result.current.loadMore());
  expect(ipc.getNotifications).toHaveBeenCalledTimes(2);
});
// Changed revisions invalidate the entire cursor chain rather than mixing snapshots.
it("replaces paging when the revision changes during load more", async () => {
  const next = deferred<NotificationPageDto>();
  vi.mocked(ipc.getNotifications)
    .mockResolvedValueOnce(page({ nextCursor: { createdAtMs: "1", id: "n1" } }))
    .mockReturnValueOnce(next.promise)
    .mockResolvedValue(page({ revision: "9007199254740994", items: [{ ...row, id: "fresh" }] }));
  const view = mount();
  await ready(view);
  act(() => view.result.current.loadMore());
  act(() => listener({ revision: "9007199254740994", unreadCount: 105 }));
  await act(async () => next.resolve(page({ items: [{ ...row, id: "stale" }] })));
  await ready(view);
  expect(view.result.current.items[0]?.id).toBe("fresh");
  expect(ipc.getNotifications).toHaveBeenLastCalledWith(null, 30);
});
// Invalid cursors get a bounded recovery, then expose Retry rather than looping.
it("recovers invalid cursor once and retains stale rows on repeated failure", async () => {
  const error = new IpcCallError("get_notifications", { code: "invalid_cursor" });
  vi.mocked(ipc.getNotifications)
    .mockResolvedValueOnce(page({ nextCursor: { createdAtMs: "1", id: "n1" } }))
    .mockRejectedValue(error);
  const view = mount();
  await ready(view);
  act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(ipc.getNotifications).toHaveBeenCalledTimes(3);
  expect(view.result.current.items).toHaveLength(1);
  expect(view.result.current.disabled).toBe(true);
});
// Initial listener/query failures preserve unknown count and can be retried independently.
it("recovers registration and persistence failure without duplicating listeners", async () => {
  vi.mocked(ipc.onNotificationsChanged).mockRejectedValueOnce(new Error("denied"));
  vi.mocked(ipc.getNotifications).mockRejectedValueOnce(
    new IpcCallError("get_notifications", { code: "persistence_failed" }),
  );
  const view = mount();
  await waitFor(() => expect(view.result.current.status).toBe("error"));
  expect(view.result.current.unreadCount).toBeNull();
  expect(view.result.current.listenerFailed).toBe(true);
  act(() => view.result.current.retry());
  await ready(view);
  expect(view.result.current.listening).toBe(true);
  act(() => view.result.current.retry());
  await ready(view);
  expect(ipc.onNotificationsChanged).toHaveBeenCalledTimes(2);
});
// Bulk actions and equal-revision no-ops reconcile without relying on changed events.
it("reconciles global mutations and equal revision no-ops without events", async () => {
  const view = mount();
  await ready(view);
  vi.mocked(ipc.getNotifications).mockResolvedValue(
    page({ revision: "9007199254740994", unreadCount: 0, items: [{ ...row, readAtMs: "2" }] }),
  );
  await act(async () => view.result.current.mutate("readAll"));
  await ready(view);
  expect(ipc.markAllNotificationsRead).toHaveBeenCalledTimes(1);
  expect(view.result.current.unreadCount).toBe(0);
  vi.mocked(ipc.clearReadNotifications).mockResolvedValue({
    revision: "9007199254740994",
    unreadCount: 0,
    affectedCount: 0,
  });
  await act(async () => view.result.current.mutate("clearRead"));
  await ready(view);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(3);
});
// An uncertain command may already have committed, so it is queried but never retried.
it("reconciles transport failures and serializes mutations", async () => {
  const mutation = deferred<never>();
  vi.mocked(ipc.deleteNotification).mockReturnValue(mutation.promise);
  const view = mount();
  await ready(view);
  act(() => {
    void view.result.current.mutate("delete", "n1");
    void view.result.current.mutate("readAll");
  });
  expect(ipc.markAllNotificationsRead).not.toHaveBeenCalled();
  await act(async () => mutation.reject(new Error("transport")));
  await ready(view);
  expect(view.result.current.errorMessage).toBe("Couldn't update notifications. Try again.");
  expect(ipc.deleteNotification).toHaveBeenCalledTimes(1);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(2);
});
// Closing, route changes and Quit all cancel late Open navigation while preserving read count.
it.each(["close", "route", "quit", "unmount"])(
  "cancels Open after %s without undoing committed read",
  async (cause) => {
    const opened = deferred<Awaited<ReturnType<typeof ipc.openNotification>>>();
    vi.mocked(ipc.openNotification).mockReturnValue(opened.promise);
    const view = mount();
    await ready(view);
    act(() => view.result.current.setOpen(true));
    await ready(view);
    act(() => void view.result.current.mutate("open", "n1"));
    if (cause === "close") act(() => view.result.current.setOpen(false));
    else if (cause === "unmount") view.unmount();
    else
      view.rerender({
        onOpenTarget: view.onOpenTarget,
        dismissKey: cause === "route" ? "route2" : "route1",
        suspended: cause === "quit",
      });
    vi.mocked(ipc.getNotifications).mockResolvedValue(
      page({ revision: "9007199254740994", unreadCount: 0 }),
    );
    await act(async () =>
      opened.resolve({
        target,
        state: { revision: "9007199254740994", unreadCount: 0, affectedCount: 1 },
      }),
    );
    expect(view.onOpenTarget).not.toHaveBeenCalled();
    if (cause !== "unmount") expect(view.result.current.unreadCount).toBe(0);
  },
);
// Dismissal also invalidates an activation callback already awaiting the session backend.
it("aborts an app callback already in flight and suppresses its late error", async () => {
  vi.mocked(ipc.openNotification).mockResolvedValue({
    target,
    state: { revision: "9007199254740993", unreadCount: 105, affectedCount: 0 },
  });
  const navigation = deferred<void>();
  const view = mount();
  view.onOpenTarget.mockReturnValue(navigation.promise);
  await ready(view);
  act(() => void view.result.current.mutate("open", "n1"));
  await waitFor(() => expect(view.onOpenTarget).toHaveBeenCalled());
  const signal = view.onOpenTarget.mock.calls[0]?.[1] as AbortSignal;
  act(() => view.result.current.setOpen(false));
  expect(signal.aborted).toBe(true);
  await act(async () => navigation.reject(new Error("late")));
  expect(view.result.current.errorMessage).toBeNull();
});
// StrictMode abandons one owner; late listeners are stopped and never start stale queries.
it("cleans up late StrictMode registrations and old query responses", async () => {
  const old = deferred<() => void>();
  const oldStop = vi.fn();
  vi.mocked(ipc.onNotificationsChanged).mockReturnValueOnce(old.promise);
  // Exercise the actual double-mounted effect lifecycle.
  const view = renderHook(
    () => useNotifications({ onOpenTarget: vi.fn(), dismissKey: "one", suspended: false }),
    { reactStrictMode: true, wrapper: ({ children }) => createElement(StrictMode, null, children) },
  );
  await waitFor(() => expect(view.result.current.status).toBe("ready"));
  await act(async () => old.resolve(oldStop));
  expect(oldStop).toHaveBeenCalledTimes(1);
  expect(ipc.getNotifications).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});
