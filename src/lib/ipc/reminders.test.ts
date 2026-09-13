import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import * as ipc from "./reminders";

// Isolate all command invocations from the native runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// Keep native listener registrations test-owned.
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
// Prevent command histories leaking between contracts.
beforeEach(() => vi.clearAllMocks());

// Verify every command and opaque version/cursor passthrough.
it("forwards all seven reminder commands without coercing identities", async () => {
  const cursor = { originalDueAtMs: "9007199254740993", id: "opaque" };
  const page = { sequence: "9007199254740994", missedCount: 2, items: [], nextCursor: cursor };
  vi.mocked(invoke).mockResolvedValue(page);
  expect(await ipc.getMissedReminders(cursor)).toBe(page);
  expect(invoke).toHaveBeenLastCalledWith("get_missed_reminders", { cursor, limit: 30 });
  await ipc.getEventReminderDeliveries("e", "o");
  expect(invoke).toHaveBeenLastCalledWith("get_event_reminder_deliveries", {
    eventId: "e",
    occurrenceId: "o",
  });
  await ipc.openReminder("d");
  expect(invoke).toHaveBeenLastCalledWith("open_reminder", { deliveryId: "d" });
  await ipc.snoozeReminder("d", page.sequence, 10);
  expect(invoke).toHaveBeenLastCalledWith("snooze_reminder", {
    deliveryId: "d",
    expectedVersion: page.sequence,
    minutes: 10,
  });
  await ipc.dismissReminder("d", page.sequence);
  expect(invoke).toHaveBeenLastCalledWith("dismiss_reminder", {
    deliveryId: "d",
    expectedVersion: page.sequence,
  });
  await ipc.dismissAllMissedReminders();
  expect(invoke).toHaveBeenLastCalledWith("dismiss_all_missed_reminders", undefined);
  const input = { kind: "show" as const, viewToken: "t", eventId: "e", occurrenceId: null };
  await ipc.setVisibleCalendarEvent(input);
  expect(invoke).toHaveBeenLastCalledWith("set_visible_calendar_event", { input });
  await ipc.setVisibleCalendarEvent({ kind: "hide", viewToken: "t" });
  expect(invoke).toHaveBeenLastCalledWith("set_visible_calendar_event", {
    input: { kind: "hide", viewToken: "t" },
  });
});

// Retain safe typed failures and caller-owned cleanup identity.
it("normalizes errors and unwraps reminder events", async () => {
  vi.mocked(invoke)
    .mockRejectedValueOnce({ code: "delivery_changed" })
    .mockRejectedValueOnce("secret");
  await expect(ipc.dismissReminder("d", "1")).rejects.toMatchObject({
    payload: { code: "delivery_changed" },
  });
  await expect(ipc.openReminder("d")).rejects.toMatchObject({ payload: null });
  const stop = vi.fn();
  vi.mocked(listen).mockResolvedValue(stop);
  const callback = vi.fn();
  expect(await ipc.onRemindersChanged(callback)).toBe(stop);
  expect(listen).toHaveBeenCalledWith("reminders://changed", expect.any(Function));
  const payload = { sequence: "9007199254740994", missedCount: 9 };
  vi.mocked(listen).mock.calls[0]?.[1]({ event: "reminders://changed", id: 1, payload });
  expect(callback).toHaveBeenCalledWith(payload);
});
