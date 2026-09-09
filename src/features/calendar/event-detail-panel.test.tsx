import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventDto } from "@/bindings/calendar";
import { EventDetailPanel } from "./event-detail-panel";
import { getCalendarEvent, onCalendarChanged } from "@/lib/ipc/calendar";
import { getProject, onProjectsChanged } from "@/lib/ipc/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
vi.mock(
  "@/lib/ipc/calendar",
  /** Isolate event persistence. */ () => ({
    getCalendarEvent: vi.fn(),
    onCalendarChanged: vi.fn(),
  }),
);
vi.mock(
  "@/lib/ipc/projects",
  /** Isolate project labels. */ () => ({ getProject: vi.fn(), onProjectsChanged: vi.fn() }),
);
const event: CalendarEventDto = {
  id: "e",
  title: "Meeting",
  description: "<script>text</script>",
  projectId: "p",
  time: {
    kind: "all_day",
    startDate: "2026-09-09",
    endDateExclusive: "2026-09-10",
    timeZoneId: "UTC",
  },
  recurrence: { kind: "none" },
  reminders: [],
  revision: "opaque",
  createdAtMs: 0,
  updatedAtMs: 0,
};
const boundary = { suspended: false, epoch: 0 };
const changed = vi.fn();
/** Mount details in a real router and controlled read boundary. */
function panel(id = "e", close = vi.fn(), restore = vi.fn()) {
  return (
    <MemoryRouter>
      <EventDetailPanel
        eventId={id}
        occurrence={null}
        zone="UTC"
        boundary={boundary}
        onClose={close}
        onChanged={changed}
        restoreFocus={restore}
      />
    </MemoryRouter>
  );
}
beforeEach(
  /** Reset each isolated native read lifetime. */ () => {
    vi.resetAllMocks();
    vi.mocked(getCalendarEvent).mockResolvedValue(event);
    vi.mocked(onCalendarChanged).mockResolvedValue(vi.fn());
    vi.mocked(onProjectsChanged).mockResolvedValue(vi.fn());
    vi.mocked(getProject).mockResolvedValue({ id: "p", displayName: "Work" } as Awaited<
      ReturnType<typeof getProject>
    >);
  },
);
describe("Event detail", /** Check read recovery and selection lifetime. */ () => {
  it("renders authoritative safe text and handles Escape", /** Keep the existing modal keyboard contract. */ async () => {
    const close = vi.fn();
    render(panel("e", close));
    expect(await screen.findByRole("heading", { name: "Meeting" })).toBeVisible();
    expect(screen.getByText("<script>text</script>")).toBeVisible();
    expect(await screen.findByRole("link", { name: "Project: Work" })).toHaveAttribute(
      "href",
      "/projects/p",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
  it("shows gone events and retries failures", /** Never display a stale definition after deletion. */ async () => {
    vi.mocked(getCalendarEvent).mockRejectedValue(
      new IpcCallError("get_calendar_event", { kind: "event_not_found" }),
    );
    render(panel());
    expect(await screen.findByText(/This event no longer exists/)).toBeVisible();
    vi.mocked(getCalendarEvent).mockResolvedValue(event);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Meeting" })).toBeVisible();
  });
  it("discards old selection completions", /** Keep late reads from replacing the new event. */ async () => {
    let resolve!: (value: CalendarEventDto) => void;
    const pending = new Promise<CalendarEventDto>(
      /** Control the obsolete native read. */ (done) => {
        resolve = done;
      },
    );
    vi.mocked(getCalendarEvent).mockImplementation(
      /** Hold only the old event lifetime. */ (id) =>
        id === "old" ? pending : Promise.resolve({ ...event, id: "new", title: "New event" }),
    );
    const { rerender } = render(panel("old"));
    rerender(panel("new"));
    expect(await screen.findByRole("heading", { name: "New event" })).toBeVisible();
    await act(
      /** Release the retired response. */ async () => resolve({ ...event, title: "Old event" }),
    );
    expect(screen.queryByRole("heading", { name: "Old event" })).not.toBeInTheDocument();
  });
  it("exposes failed update subscriptions and refreshes on changes", /** Keep event invalidation observable and retryable. */ async () => {
    vi.mocked(onProjectsChanged).mockRejectedValue(new Error("offline"));
    render(panel());
    expect(await screen.findByText("Calendar updates are unavailable")).toBeVisible();
    await waitFor(
      /** Wait until the initial definition is visible. */ () =>
        expect(screen.getByRole("heading", { name: "Meeting" })).toBeVisible(),
    );
    vi.mocked(getCalendarEvent).mockResolvedValue({ ...event, title: "Updated" });
    act(
      /** Deliver an isolated Calendar mutation signal. */ () =>
        vi
          .mocked(onCalendarChanged)
          .mock.calls[0][0]({ sequence: "1", kind: "updated", eventId: "e", revision: "2" }),
    );
    expect(await screen.findByRole("heading", { name: "Updated" })).toBeVisible();
    expect(changed).toHaveBeenCalled();
  });
});

afterEach(/** Release each component lifetime. */ () => cleanup());
