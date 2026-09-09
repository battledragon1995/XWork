import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import { CalendarMonth } from "./calendar-month";
/** Build server-owned occurrence fixtures without recurrence expansion. */
function occurrence(id: string): CalendarOccurrenceDto {
  return {
    occurrenceId: id,
    eventId: id,
    title: `Event ${id}`,
    projectId: null,
    time: {
      kind: "all_day",
      startDate: "2026-09-09",
      endDateExclusive: "2026-09-10",
      timeZoneId: "UTC",
    },
    recurrence: { kind: "none" },
    reminders: [],
  };
}
describe("Calendar month", /** Verify accessible date and occurrence navigation. */ () => {
  it("offers roving keyboard dates and independent overflow controls", /** Keep every event reachable without nested buttons. */ () => {
    const select = vi.fn();
    const open = vi.fn();
    render(
      <CalendarMonth
        month="2026-09-09"
        selectedDate="2026-09-09"
        today="2026-09-09"
        zone="UTC"
        items={[occurrence("1"), occurrence("2"), occurrence("3"), occurrence("4")]}
        onSelect={select}
        onOpen={open}
      />,
    );
    const day = screen.getByRole("button", { name: "2026-09-09, today" });
    expect(day).toHaveAttribute("tabindex", "0");
    expect(day).toHaveAttribute("aria-current", "date");
    for (const [key, date] of [
      ["ArrowLeft", "2026-09-08"],
      ["ArrowRight", "2026-09-10"],
      ["ArrowUp", "2026-09-02"],
      ["ArrowDown", "2026-09-16"],
      ["Home", "2026-09-07"],
      ["End", "2026-09-13"],
      ["PageUp", "2026-08-09"],
      ["PageDown", "2026-10-09"],
    ]) {
      fireEvent.keyDown(day, { key });
      expect(select).toHaveBeenLastCalledWith(date);
    }
    fireEvent.click(screen.getByRole("button", { name: "+1 more" }));
    expect(select).toHaveBeenLastCalledWith("2026-09-09");
    fireEvent.click(screen.getByRole("button", { name: "All day · Event 1" }));
    expect(open).toHaveBeenCalledWith(occurrence("1"));
    expect(day.querySelector("button")).toBeNull();
  });
  it("blocks calendar controls while suspended", /** Leave navigation admission to the operation owner. */ () => {
    const select = vi.fn();
    render(
      <CalendarMonth
        month="2026-09-09"
        selectedDate="2026-09-09"
        today="2026-09-09"
        zone="UTC"
        items={[]}
        onSelect={select}
        onOpen={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "2026-09-09, today" })).toBeDisabled();
  });
});

afterEach(/** Release each component lifetime. */ () => cleanup());
