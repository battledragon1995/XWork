import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import { listCalendarOccurrences, onCalendarChanged } from "@/lib/ipc/calendar";
import type { ProjectDto } from "@/bindings/projects/projects";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { HomeCalendarSection, ProjectCalendarSection } from "./calendar-sections";
import type { CalendarBoundary } from "./use-calendar-query";

vi.mock(
  "@/lib/ipc/calendar",
  /** Isolate all Calendar reads and subscriptions. */ () => ({
    listCalendarOccurrences: vi.fn(),
    onCalendarChanged: vi.fn(),
  }),
);
vi.mock(
  "@/lib/ipc/projects",
  /** Isolate project invalidation signals. */ () => ({
    listProjects: vi.fn(),
    onProjectsChanged: vi.fn(),
  }),
);
/** Return one backend-expanded all-day occurrence without frontend recurrence logic. */
function item(index: number): CalendarOccurrenceDto {
  return {
    occurrenceId: `o${index}`,
    eventId: `e/${index}`,
    title: `Event ${index}`,
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
/** Expose exact navigation while keeping the real router active. */
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
/** Render a projection alongside an unrelated successful aggregate. */
function mount(section: React.ReactNode) {
  return render(
    <MemoryRouter>
      <p>Other data</p>
      {section}
      <Location />
    </MemoryRouter>,
  );
}
beforeEach(
  /** Reset isolated IPC and provide six ordered server occurrences. */ () => {
    vi.resetAllMocks();
    vi.mocked(listCalendarOccurrences).mockResolvedValue({
      revision: "opaque",
      items: Array.from(
        { length: 6 },
        /** Build ordered fixture occurrences. */ (_, index) => item(index),
      ),
    });
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(onCalendarChanged).mockResolvedValue(vi.fn());
    vi.mocked(onProjectsChanged).mockResolvedValue(vi.fn());
  },
);
afterEach(
  /** Release section timers and listener lifetimes. */ () => {
    cleanup();
  },
);
/** Home reads exactly fourteen days and shows only the first five server rows. */
it("bounds the Home projection and opens the selected event", async () => {
  mount(<HomeCalendarSection />);
  await screen.findByRole("button", { name: /Event 0/ });
  const input = vi.mocked(listCalendarOccurrences).mock.calls[0]?.[0];
  expect(input).toMatchObject({ projectId: null, onlyWithReminders: false });
  if (!input) throw new Error("Expected a Calendar range read");
  expect(Date.parse(input.endDateExclusive) - Date.parse(input.startDate)).toBe(14 * 86400000);
  expect(screen.getAllByRole("button", { name: /Event / })).toHaveLength(5);
  expect(screen.queryByText("Event 5")).toBeNull();
  expect(screen.getByRole("link", { name: "View calendar" })).toHaveAttribute("href", "/calendar");
  fireEvent.click(screen.getByRole("button", { name: /Event 0/ }));
  expect(screen.getByTestId("location")).toHaveTextContent("/calendar?event=e%2F0");
});
/** The app-authenticated project ID scopes both reads and the Calendar destination. */
it("preserves exact project scope on reads and event navigation", async () => {
  mount(<ProjectCalendarSection projectId="project /1" />);
  await screen.findByRole("button", { name: /Event 0/ });
  expect(listCalendarOccurrences).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: "project /1" }),
  );
  expect(screen.getByRole("link", { name: "View calendar" })).toHaveAttribute(
    "href",
    "/calendar?project=project%20%2F1",
  );
  fireEvent.click(screen.getByRole("button", { name: /Event 0/ }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/calendar?event=e%2F0&project=project%20%2F1",
  );
});
/** A live boundary prevents navigation before its next render arrives. */
it.each(["suspended", "epoch"])("blocks stale section navigation on %s", async (mode) => {
  const live: CalendarBoundary = { suspended: false, epoch: 0 };
  mount(
    <HomeCalendarSection
      boundary={{ ...live }}
      readBoundary={/** Read synchronous owner changes. */ () => live}
    />,
  );
  await screen.findByRole("button", { name: /Event 0/ });
  if (mode === "suspended") live.suspended = true;
  else live.epoch = 1;
  fireEvent.click(screen.getByRole("button", { name: /Event 0/ }));
  fireEvent.click(screen.getByRole("link", { name: "View calendar" }));
  expect(screen.getByTestId("location").textContent).toBe("/");
});
/** A failed projection cannot hide another owner's data or falsely report emptiness. */
it("isolates read failure and retries into a bounded empty state", async () => {
  vi.mocked(listCalendarOccurrences).mockRejectedValueOnce(new Error("private storage path"));
  mount(<HomeCalendarSection />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load calendar events");
  expect(screen.getByText("Other data")).toBeVisible();
  expect(screen.queryByText("No events in the next 14 days")).toBeNull();
  vi.mocked(listCalendarOccurrences).mockResolvedValue({ revision: "next", items: [] });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No events in the next 14 days")).toBeVisible();
  await waitFor(
    /** Verify successful retry clears the read error. */ () =>
      expect(screen.queryByRole("alert")).toBeNull(),
  );
});
/** Suspended mounts issue no reads and retain a disabled Calendar destination. */
it("does not read while maintenance is active", () => {
  mount(<HomeCalendarSection boundary={{ suspended: true, epoch: 1 }} />);
  expect(listCalendarOccurrences).not.toHaveBeenCalled();
  expect(listProjects).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "View calendar" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

/** Produce optional project metadata without touching the developer's projects. */
function project(displayName: string): ProjectDto {
  return {
    id: "p",
    displayName,
    rootPath: "C:/fixtures/p",
    isPinned: false,
    addedAtMs: 0,
    lastOpenedAtMs: 0,
    availability: { status: "unavailable", reason: "missing" },
  };
}
/** Unavailable folders still retain readable metadata, which changes on rename and removal. */
it("refreshes project labels after rename and removal", async () => {
  vi.mocked(listCalendarOccurrences).mockResolvedValue({
    revision: "1",
    items: [{ ...item(0), projectId: "p" }],
  });
  vi.mocked(listProjects).mockResolvedValue([project("Original")]);
  mount(<HomeCalendarSection />);
  expect(await screen.findByText("Project: Original")).toBeVisible();
  vi.mocked(listProjects).mockResolvedValue([project("Renamed")]);
  await act(
    /** Notify both metadata and occurrence listeners. */ async () => {
      for (const [handler] of vi.mocked(onProjectsChanged).mock.calls)
        handler({ change: "updated", projectId: "p" });
    },
  );
  expect(await screen.findByText("Project: Renamed")).toBeVisible();
  vi.mocked(listProjects).mockResolvedValue([]);
  await act(
    /** Remove the label after authoritative project deletion. */ async () => {
      for (const [handler] of vi.mocked(onProjectsChanged).mock.calls)
        handler({ change: "removed", projectId: "p" });
    },
  );
  expect(await screen.findByText("Project: Linked project")).toBeVisible();
});
/** Optional metadata failure never hides event navigation. */
it("keeps occurrences readable when project labels fail", async () => {
  vi.mocked(listProjects).mockRejectedValue(new Error("private metadata error"));
  vi.mocked(listCalendarOccurrences).mockResolvedValue({
    revision: "1",
    items: [{ ...item(0), projectId: "p" }],
  });
  mount(<HomeCalendarSection />);
  expect(await screen.findByText("Project: Linked project")).toBeVisible();
  expect(screen.getByRole("button", { name: /Event 0/ })).toBeEnabled();
  expect(screen.queryByText("private metadata error")).toBeNull();
});
/** A pre-reset label read cannot publish even when React has not observed the new epoch. */
it("rejects late labels across the synchronous boundary", async () => {
  let resolve!: (rows: ProjectDto[]) => void;
  vi.mocked(listProjects).mockReturnValue(
    new Promise(
      /** Defer metadata admission. */ (yes) => {
        resolve = yes;
      },
    ),
  );
  vi.mocked(listCalendarOccurrences).mockResolvedValue({
    revision: "1",
    items: [{ ...item(0), projectId: "p" }],
  });
  const boundary = { suspended: false, epoch: 0 };
  mount(
    <HomeCalendarSection
      boundary={{ ...boundary }}
      readBoundary={/** Read the live epoch. */ () => boundary}
    />,
  );
  await screen.findByText("Project: Linked project");
  boundary.epoch = 1;
  await act(
    /** Complete a stale label read after reset. */ async () => resolve([project("Obsolete")]),
  );
  expect(screen.queryByText("Project: Obsolete")).toBeNull();
});
/** Both projection listeners release registrations arriving after component cleanup. */
it("releases late metadata and query subscriptions", async () => {
  let resolve!: (cleanup: () => void) => void;
  const pending = new Promise<() => void>(
    /** Hold all project registrations open. */ (yes) => {
      resolve = yes;
    },
  );
  vi.mocked(onProjectsChanged).mockReturnValue(pending);
  const unlisten = vi.fn();
  const view = mount(<HomeCalendarSection />);
  const registrations = vi.mocked(onProjectsChanged).mock.calls.length;
  view.unmount();
  await act(/** Return native cleanup functions after unmount. */ async () => resolve(unlisten));
  expect(registrations).toBe(2);
  expect(unlisten).toHaveBeenCalledTimes(registrations);
});
