import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  getCalendarEvent,
  listCalendarOccurrences,
  onCalendarChanged,
  createCalendarEvent,
  updateCalendarEvent,
  prepareDeleteCalendarEvent,
  confirmDeleteCalendarEvent,
} from "./calendar";
/** Mock native command transport. */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
/** Mock native subscription transport. */
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
/** Reset isolated transports. */
beforeEach(() => vi.resetAllMocks());
/** Preserve exact mutation envelopes and revisions beyond integer precision. */
it("dispatches all four mutations without changing opaque revisions", async () => {
  const input = {
    title: "Meeting",
    description: "",
    projectId: null,
    time: {
      kind: "all_day" as const,
      startDate: "2026-09-09",
      endDateExclusive: "2026-09-10",
      timeZoneId: "UTC",
    },
    recurrence: { kind: "none" as const },
    reminderMinutesBefore: [],
  };
  const revision = { eventId: "e", expectedRevision: "90071992547409930" };
  const result = { id: "authoritative" };
  vi.mocked(invoke).mockResolvedValue(result);
  expect(await createCalendarEvent(input)).toBe(result);
  expect(invoke).toHaveBeenLastCalledWith("create_calendar_event", { input });
  await updateCalendarEvent({ ...revision, event: input });
  expect(invoke).toHaveBeenLastCalledWith("update_calendar_event", {
    input: { ...revision, event: input },
  });
  await prepareDeleteCalendarEvent(revision);
  expect(invoke).toHaveBeenLastCalledWith("prepare_delete_calendar_event", { input: revision });
  await confirmDeleteCalendarEvent({ requestId: 17 });
  expect(invoke).toHaveBeenLastCalledWith("confirm_delete_calendar_event", {
    input: { requestId: 17 },
  });
  vi.mocked(invoke).mockRejectedValue({
    kind: "revision_conflict",
    currentRevision: "90071992547409931",
  });
  await expect(updateCalendarEvent({ ...revision, event: input })).rejects.toMatchObject({
    payload: { kind: "revision_conflict", currentRevision: "90071992547409931" },
  });
});
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
