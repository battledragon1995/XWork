import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import { IpcCallError } from "./ipc-error";
import * as ipc from "./notifications";

// Isolate native command and listener entry points.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// Capture event envelopes without opening a native window.
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
// Reset each contract test independently.
beforeEach(() => vi.clearAllMocks());
// Verify all six contracts and exact decimal passthrough.
it("forwards every command and preserves generated DTO values", async () => {
  const cursor = { createdAtMs: "9007199254740993", id: "n" };
  const page = { revision: "9007199254740994", unreadCount: 105, items: [], nextCursor: cursor };
  vi.mocked(invoke).mockResolvedValue(page);
  expect(await ipc.getNotifications(cursor, 30)).toBe(page);
  expect(invoke).toHaveBeenLastCalledWith("get_notifications", { cursor, limit: 30 });
  await ipc.markNotificationRead("n");
  expect(invoke).toHaveBeenLastCalledWith("mark_notification_read", { notificationId: "n" });
  await ipc.markAllNotificationsRead();
  expect(invoke).toHaveBeenLastCalledWith("mark_all_notifications_read", undefined);
  await ipc.deleteNotification("n");
  expect(invoke).toHaveBeenLastCalledWith("delete_notification", { notificationId: "n" });
  await ipc.clearReadNotifications();
  expect(invoke).toHaveBeenLastCalledWith("clear_read_notifications", undefined);
  await ipc.openNotification("n");
  expect(invoke).toHaveBeenLastCalledWith("open_notification", { notificationId: "n" });
});
// Verify safe rejection normalization for typed and unknown failures.
it("normalizes typed and transport failures", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce({ code: "persistence_failed" })
    .mockRejectedValueOnce("secret");
  await expect(ipc.getNotifications(null, 30)).rejects.toMatchObject({
    payload: { code: "persistence_failed" },
  });
  await expect(ipc.openNotification("n")).rejects.toMatchObject({ payload: null });
  vi.mocked(invoke).mockRejectedValue("secret");
  await expect(ipc.deleteNotification("n")).rejects.toBeInstanceOf(IpcCallError);
});
// Verify event payload and cleanup identity across the adapter.
it("forwards changed payload and unlisten", async () => {
  const unlisten = vi.fn();
  vi.mocked(listen).mockResolvedValue(unlisten);
  const callback = vi.fn();
  expect(await ipc.onNotificationsChanged(callback)).toBe(unlisten);
  expect(listen).toHaveBeenCalledWith("notifications://changed", expect.any(Function));
  const payload = { revision: "9", unreadCount: 3 };
  vi.mocked(listen).mock.calls[0]?.[1]({ event: "notifications://changed", id: 1, payload });
  expect(callback).toHaveBeenCalledWith(payload);
});
