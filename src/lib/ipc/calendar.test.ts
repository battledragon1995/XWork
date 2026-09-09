import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import { getCalendarEvent, listCalendarOccurrences, onCalendarChanged } from "./calendar";
/** Mock native command transport. */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
/** Mock native subscription transport. */
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
/** Reset isolated transports. */
beforeEach(() => vi.resetAllMocks());
/** Preserve narrow envelopes and opaque IDs. */
it("calls exact Calendar read commands", async () => {
  const input = {
    startDate: "2026-09-01",
    endDateExclusive: "2026-09-15",
    viewerTimeZoneId: "UTC",
    projectId: null,
    onlyWithReminders: false,
  };
  const response = { revision: "90071992547409930", items: [] };
  vi.mocked(invoke).mockResolvedValue(response);
  expect(await listCalendarOccurrences(input)).toBe(response);
  expect(invoke).toHaveBeenCalledWith("list_calendar_occurrences", { input });
  await getCalendarEvent("opaque/event");
  expect(invoke).toHaveBeenCalledWith("get_calendar_event", { eventId: "opaque/event" });
});
/** Preserve the backend's kind-tagged safe failure. */
it("keeps typed errors", async () => {
  vi.mocked(invoke).mockRejectedValue({ kind: "event_not_found" });
  await expect(getCalendarEvent("gone")).rejects.toMatchObject({
    payload: { kind: "event_not_found" },
  });
});
/** Forward payloads and return the real cleanup. */
it("forwards change payload and unlisten", async () => {
  const unlisten = vi.fn();
  vi.mocked(listen).mockResolvedValue(unlisten);
  const handler = vi.fn();
  expect(await onCalendarChanged(handler)).toBe(unlisten);
  expect(listen).toHaveBeenCalledWith("calendar://changed", expect.any(Function));
  const payload = { sequence: "opaque", kind: "reset", eventId: null, revision: null };
  vi.mocked(listen).mock.calls[0][1]({ event: "calendar://changed", id: 1, payload });
  expect(handler).toHaveBeenCalledWith(payload);
});
