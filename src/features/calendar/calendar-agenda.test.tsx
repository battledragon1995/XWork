import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import { CalendarAgenda } from "./calendar-agenda";
describe("Calendar agenda", /** Verify server occurrences and empty states. */ () => {
  it("renders all-day recurrence and project metadata safely", /** Render text and preserve opaque occurrence identity. */ () => {
    const item: CalendarOccurrenceDto = {
      occurrenceId: "opaque",
      eventId: "event",
      title: "<b>Meeting</b>",
      projectId: "p",
      time: {
        kind: "all_day",
        startDate: "2026-09-09",
        endDateExclusive: "2026-09-11",
        timeZoneId: "UTC",
      },
      recurrence: { kind: "daily", end: { kind: "never" } },
      reminders: [{ id: "r", minutesBefore: 10 }],
    };
    const open = vi.fn();
    render(
      <CalendarAgenda
        items={[item]}
        zone="UTC"
        upcoming
        onOpen={open}
        projectNames={{ p: "Work" }}
      />,
    );
    expect(screen.getByText("<b>Meeting</b>")).toBeVisible();
    expect(screen.getByText("Project: Work")).toBeVisible();
    fireEvent.click(screen.getByRole("button"));
    expect(open).toHaveBeenCalledWith(item);
  });
  it("distinguishes day and Upcoming empty states", /** Avoid implying global event absence. */ () => {
    const { rerender } = render(<CalendarAgenda items={[]} zone="UTC" onOpen={vi.fn()} />);
    expect(screen.getByText("No events this day")).toBeVisible();
    rerender(<CalendarAgenda items={[]} zone="UTC" onOpen={vi.fn()} upcoming />);
    expect(screen.getByText("No events in the next 14 days")).toBeVisible();
  });
});

afterEach(/** Release each component lifetime. */ () => cleanup());
