import { expect, it } from "vitest";
import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import {
  addDays,
  calendarRange,
  isValidDate,
  monthGrid,
  occurrenceLabel,
  occurrencesForDate,
  shiftMonth,
  reminderTime,
} from "./calendar-presentation";
/** Reject malformed, out-of-domain and invalid-zone reminder display metadata. */
it("formats only safe reminder timestamps", () => {
  expect(reminderTime("0", "UTC")).toContain("1970");
  for (const value of ["", "1.2", "Infinity", "9007199254740993", "8640000000000001"])
    expect(reminderTime(value, "UTC")).toBe("Time unavailable");
  expect(reminderTime("0", "invalid/zone")).toBe("Time unavailable");
});
/** Check leap dates and supported Gregorian bounds. */
it("validates and clamps date arithmetic", () => {
  expect(isValidDate("2024-02-29")).toBe(true);
  expect(isValidDate("2025-02-29")).toBe(false);
  expect(isValidDate("1899-12-31")).toBe(false);
  expect(shiftMonth("2024-01-31", 1)).toBe("2024-02-29");
  expect(addDays("9999-12-31", 1)).toBe("9999-12-31");
  expect(shiftMonth("1900-01-01", -1)).toBe("1900-01-01");
});
/** Keep full Monday weeks and bounded half-open Upcoming reads. */
it("builds Monday grids and fourteen-day ranges", () => {
  expect(monthGrid("2026-09-09")).toHaveLength(35);
  expect(monthGrid("2026-09-09")[0]).toBe("2026-08-31");
  expect(monthGrid("2026-08-01")).toHaveLength(42);
  expect(calendarRange("2026-12-25", 14, "UTC")).toEqual({
    startDate: "2026-12-25",
    endDateExclusive: "2027-01-08",
    viewerTimeZoneId: "UTC",
    projectId: null,
    onlyWithReminders: false,
  });
  expect(monthGrid("9999-12-01").at(-1)).toBe("9999-12-31");
});
const item: CalendarOccurrenceDto = {
  occurrenceId: "opaque",
  eventId: "event",
  title: "Trip",
  projectId: null,
  time: {
    kind: "all_day",
    startDate: "2026-09-01",
    endDateExclusive: "2026-09-03",
    timeZoneId: "Pacific/Honolulu",
  },
  recurrence: { kind: "daily", end: { kind: "never" } },
  reminders: [],
};
/** Preserve all-day strings and use only supplied occurrences. */
it("shows included all-day dates without recurrence expansion", () => {
  expect(occurrencesForDate([item], "2026-09-02", "Asia/Tokyo")).toEqual([item]);
  expect(occurrencesForDate([item], "2026-09-03", "Asia/Tokyo")).toEqual([]);
  expect(occurrenceLabel(item, "Asia/Tokyo")).toBe("All day · 2026-09-01 – 2026-09-02");
});
/** Label both dates when a timed occurrence crosses midnight in the viewer zone. */
it("labels timed overlap using occurrence epochs", () => {
  const timed: CalendarOccurrenceDto = {
    ...item,
    time: {
      kind: "timed",
      startLocal: "unused",
      endLocal: "unused",
      timeZoneId: "UTC",
      startAtMs: Date.parse("2026-09-01T23:00:00Z"),
      endAtMs: Date.parse("2026-09-02T02:00:00Z"),
    },
  };
  expect(occurrenceLabel(timed, "UTC")).toContain("Sep 1");
  expect(occurrenceLabel(timed, "UTC")).toContain("Sep 2");
});
