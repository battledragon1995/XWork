import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarRoute } from "./calendar-route";
import { getCalendarEvent, listCalendarOccurrences, onCalendarChanged } from "@/lib/ipc/calendar";
import { getProject, listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
vi.mock(
  "@/lib/ipc/calendar",
  /** Isolate Calendar queries from native state. */ () => ({
    getCalendarEvent: vi.fn(),
    listCalendarOccurrences: vi.fn(),
    onCalendarChanged: vi.fn(),
  }),
);
vi.mock(
  "@/lib/ipc/projects",
  /** Isolate project scope validation. */ () => ({
    getProject: vi.fn(),
    listProjects: vi.fn(),
    onProjectsChanged: vi.fn(),
  }),
);
beforeEach(
  /** Reset the real hook's IPC seams for every route lifetime. */ () => {
    vi.resetAllMocks();
    vi.mocked(listCalendarOccurrences).mockResolvedValue({ revision: "1", items: [] });
    vi.mocked(onCalendarChanged).mockResolvedValue(vi.fn());
    vi.mocked(onProjectsChanged).mockResolvedValue(vi.fn());
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(getProject).mockResolvedValue({ id: "p", displayName: "Work" } as Awaited<
      ReturnType<typeof getProject>
    >);
  },
);
describe("Calendar route", /** Verify navigation against exact backend read contracts. */ () => {
  it("uses separate grid/day and bounded Upcoming reads with date prefill", /** Query overlap days rather than filtering a month response. */ async () => {
    const create = vi.fn();
    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-09-09"]}>
        <CalendarRoute onCreateEvent={create} />
      </MemoryRouter>,
    );
    await screen.findByText("No events this day");
    expect(
      vi
        .mocked(listCalendarOccurrences)
        .mock.calls.some(
          /** Match the one-day half-open query. */ ([input]) =>
            input.startDate === "2026-09-09" && input.endDateExclusive === "2026-09-10",
        ),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "New event this day" }));
    expect(create).toHaveBeenCalledWith({ date: "2026-09-09", projectId: null });
    fireEvent.click(screen.getByRole("button", { name: "Upcoming" }));
    expect(await screen.findByText("No events in the next 14 days")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Missed" })).not.toBeInTheDocument();
  });
  it("opens a direct event outside the visible range", /** Read the event identity independently from occurrence availability. */ async () => {
    vi.mocked(getCalendarEvent).mockResolvedValue({
      id: "old",
      title: "Historical event",
      description: "",
      projectId: null,
      time: {
        kind: "all_day",
        startDate: "2000-01-01",
        endDateExclusive: "2000-01-02",
        timeZoneId: "UTC",
      },
      recurrence: { kind: "none" },
      reminders: [],
      revision: "a",
      createdAtMs: 0,
      updatedAtMs: 0,
    });
    render(
      <MemoryRouter initialEntries={["/calendar?event=old"]}>
        <CalendarRoute />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Historical event" })).toBeVisible();
    expect(getCalendarEvent).toHaveBeenCalledWith("old");
    expect(screen.queryByRole("button", { name: "New Event" })).not.toBeInTheDocument();
  });
  it("rejects invalid dates without sending invalid ranges", /** Give malformed URL input a recoverable Today path. */ async () => {
    render(
      <MemoryRouter initialEntries={["/calendar?date=2026-02-30"]}>
        <CalendarRoute />
      </MemoryRouter>,
    );
    expect(screen.getByText("Invalid calendar date.")).toBeVisible();
    expect(listCalendarOccurrences).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Today" })[0]);
    await waitFor(
      /** Confirm recovery admits a valid backend read. */ () =>
        expect(listCalendarOccurrences).toHaveBeenCalled(),
    );
  });
  it("validates URL project scope and allows explicit UTC recovery", /** Preserve the documented timezone error instead of silently converting. */ async () => {
    vi.mocked(listCalendarOccurrences).mockRejectedValue(
      new IpcCallError("list_calendar_occurrences", { kind: "invalid_time_zone" }),
    );
    render(
      <MemoryRouter initialEntries={["/calendar?project=p"]}>
        <CalendarRoute />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "Use UTC" })).toBeVisible();
    expect(getProject).toHaveBeenCalledWith("p");
    expect(
      vi
        .mocked(listCalendarOccurrences)
        .mock.calls.every(
          /** Ensure only the validated scope is queried. */ ([input]) => input.projectId === "p",
        ),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Use UTC" }));
    expect(screen.getByText("Time zone: UTC")).toBeVisible();
  });
});

afterEach(/** Release each component lifetime. */ () => cleanup());
it("retires deep-link detail across maintenance and does not reopen it", /** Keep late selected-event work outside the reset epoch. */ async () => {
  vi.mocked(getCalendarEvent).mockResolvedValue({
    id: "old",
    title: "Before reset",
    description: "",
    projectId: null,
    time: {
      kind: "all_day",
      startDate: "2000-01-01",
      endDateExclusive: "2000-01-02",
      timeZoneId: "UTC",
    },
    recurrence: { kind: "none" },
    reminders: [],
    revision: "a",
    createdAtMs: 0,
    updatedAtMs: 0,
  });
  const { rerender } = render(
    <MemoryRouter initialEntries={["/calendar?event=old"]}>
      <CalendarRoute boundary={{ suspended: false, epoch: 0 }} />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: "Before reset" })).toBeVisible();
  rerender(
    <MemoryRouter>
      <CalendarRoute boundary={{ suspended: true, epoch: 0 }} />
    </MemoryRouter>,
  );
  await waitFor(
    /** Confirm maintenance releases the detail surface. */ () =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  rerender(
    <MemoryRouter>
      <CalendarRoute boundary={{ suspended: false, epoch: 1 }} />
    </MemoryRouter>,
  );
  await screen.findByText("No events this day");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
