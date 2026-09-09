import { expect, it } from "vitest";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import {
  calendarErrorCopy,
  calendarErrorKind,
  eventFieldErrors,
  eventMutationCopy,
  eventNeedsReload,
} from "./calendar-error-copy";
/** Distinguish safe field recovery from uncertain or stale writes. */
it("maps mutation failures without leaking raw details", () => {
  expect(eventFieldErrors(new IpcCallError("create", { kind: "project_changed" }))).toHaveProperty(
    "projectId",
  );
  expect(
    eventFieldErrors(new IpcCallError("create", { kind: "nonexistent_local_time" })).startTime,
  ).toContain("daylight saving");
  expect(eventMutationCopy(new Error("secret path"))).toContain("result is unknown");
  expect(eventNeedsReload(new Error("secret path"))).toBe(true);
  expect(eventNeedsReload(new IpcCallError("update", { kind: "revision_conflict" }))).toBe(true);
  expect(eventNeedsReload(new IpcCallError("create", { kind: "invalid_title" }))).toBe(false);
  expect(
    eventMutationCopy(new IpcCallError("delete", { kind: "delete_impact_changed" })),
  ).toContain("Review deletion again");
});
/** Keep transport diagnostics out of the product. */
it("uses safe fallback text", () => {
  expect(calendarErrorCopy(new Error("private path"))).toBe("Could not load calendar events");
  expect(calendarErrorKind({ kind: "event_not_found" })).toBeNull();
});
/** Offer typed recovery for gone events, timezones and oversized reads. */
it.each([
  ["event_not_found", "no longer exists"],
  ["invalid_time_zone", "Use UTC"],
  ["occurrence_limit_exceeded", "Choose Day"],
  ["invalid_range", "valid calendar date"],
])("maps %s safely", (kind, copy) => {
  expect(calendarErrorCopy(new IpcCallError("list_calendar_occurrences", { kind }))).toContain(
    copy,
  );
});
