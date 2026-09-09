import { expect, it } from "vitest";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { calendarErrorCopy, calendarErrorKind } from "./calendar-error-copy";
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
