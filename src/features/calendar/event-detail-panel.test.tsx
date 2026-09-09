import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventDto } from "@/bindings/calendar";
import { EventDetailPanel } from "./event-detail-panel";
import {
  getCalendarEvent,
  onCalendarChanged,
  updateCalendarEvent,
  prepareDeleteCalendarEvent,
  confirmDeleteCalendarEvent,
} from "@/lib/ipc/calendar";
import { getProject, onProjectsChanged, listProjects } from "@/lib/ipc/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
vi.mock(
  "@/lib/ipc/calendar",
  /** Isolate event persistence. */ () => ({
    getCalendarEvent: vi.fn(),
    onCalendarChanged: vi.fn(),
    updateCalendarEvent: vi.fn(),
    prepareDeleteCalendarEvent: vi.fn(),
    confirmDeleteCalendarEvent: vi.fn(),
  }),
);
vi.mock(
  "@/lib/ipc/projects",
  /** Isolate project labels. */ () => ({
    getProject: vi.fn(),
    onProjectsChanged: vi.fn(),
    listProjects: vi.fn(),
  }),
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
let live = { ...boundary };
/** Read lifecycle state before React receives the next boundary render. */
function readBoundary() {
  return live;
}
/** Mount details in a real router and controlled read boundary. */
function panel(id = "e", close = vi.fn(), restore = vi.fn()) {
  return (
    <MemoryRouter>
      <EventDetailPanel
        eventId={id}
        occurrence={null}
        zone="UTC"
        boundary={boundary}
        readBoundary={readBoundary}
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
    live = { ...boundary };
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(updateCalendarEvent).mockResolvedValue({
      ...event,
      title: "Saved",
      revision: "next",
    });
    vi.mocked(prepareDeleteCalendarEvent).mockResolvedValue({
      requestId: 7,
      eventId: "e",
      title: "Meeting",
      isRecurring: false,
      reminderCount: 0,
    });
    vi.mocked(confirmDeleteCalendarEvent).mockResolvedValue({ eventId: "e" });
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

/** Enter the real editor after authoritative reads settle. */
async function editEvent() {
  await waitFor(
    /** Wait until the base snapshot is editable. */ () =>
      expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
}

it("edits the base schedule and preserves the opaque revision", /** Never derive update input from the selected occurrence. */ async () => {
  vi.mocked(getCalendarEvent).mockResolvedValue({ ...event, revision: "90071992547409930" });
  render(panel());
  await editEvent();
  expect(screen.getByLabelText("Starts")).toHaveValue("2026-09-09");
  expect(screen.getByLabelText("Last day")).toHaveValue("2026-09-09");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Saved" } });
  fireEvent.click(screen.getByRole("button", { name: "Save event" }));
  expect(await screen.findByRole("heading", { name: "Saved" })).toBeVisible();
  expect(updateCalendarEvent).toHaveBeenCalledWith({
    eventId: "e",
    expectedRevision: "90071992547409930",
    event: expect.objectContaining({ title: "Saved", time: event.time }),
  });
  expect(changed).toHaveBeenCalled();
});
it("preserves dirty edits on same revision focus and blocks changed revision until Reload", /** Avoid false conflicts and silent overwrites. */ async () => {
  render(panel());
  await editEvent();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  await act(
    /** Revalidate the same definition after focus. */ async () =>
      window.dispatchEvent(new Event("focus")),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("Draft");
  expect(screen.getByRole("button", { name: "Save event" })).toBeEnabled();
  vi.mocked(getCalendarEvent).mockResolvedValue({ ...event, revision: "new", title: "External" });
  await act(
    /** Deliver an external definition change. */ async () =>
      vi
        .mocked(onCalendarChanged)
        .mock.calls[0][0]({ sequence: "2", kind: "updated", eventId: "e", revision: "new" }),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("Draft");
  expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(screen.getByRole("alertdialog", { name: "Discard changes?" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(await screen.findByRole("heading", { name: "External" })).toBeVisible();
});
it("retains a readable draft after external deletion", /** Prevent writes to a deleted definition. */ async () => {
  render(panel());
  await editEvent();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Copy me" } });
  vi.mocked(getCalendarEvent).mockRejectedValue(
    new IpcCallError("get", { kind: "event_not_found" }),
  );
  await act(
    /** Revalidate a removed event. */ async () => window.dispatchEvent(new Event("focus")),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("Copy me");
  expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
  expect(screen.getByText(/draft is still available to copy/)).toBeVisible();
});
it("keeps pending update locked when invalidation precedes acknowledgement", /** Never treat native invalidation as mutation completion. */ async () => {
  let resolve!: (event: CalendarEventDto) => void;
  vi.mocked(updateCalendarEvent).mockReturnValue(
    new Promise(
      /** Hold update acknowledgement. */ (done) => {
        resolve = done;
      },
    ),
  );
  render(panel());
  await editEvent();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pending draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save event" }));
  await act(
    /** Deliver the committed event before the command result. */ async () =>
      vi
        .mocked(onCalendarChanged)
        .mock.calls[0][0]({ sequence: "2", kind: "updated", eventId: "e", revision: "new" }),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("Pending draft");
  expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
  fireEvent.submit(screen.getByLabelText("Title").closest("form") as HTMLFormElement);
  expect(updateCalendarEvent).toHaveBeenCalledOnce();
  await act(
    /** Publish the authoritative save response. */ async () =>
      resolve({ ...event, title: "Committed", revision: "new" }),
  );
  expect(screen.getByRole("heading", { name: "Committed" })).toBeVisible();
});
it.each([
  new Error("transport"),
  new IpcCallError("update", { kind: "revision_conflict", currentRevision: "other" }),
])(
  "requires reload after uncertain or conflicting updates",
  /** Keep the source revision and draft instead of retrying blindly. */ async (failure) => {
    vi.mocked(updateCalendarEvent).mockRejectedValue(failure);
    render(panel());
    await editEvent();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(await screen.findByRole("button", { name: "Reload" })).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Draft");
    expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
  },
);
it("denies edits ahead of boundary rendering and drops a retired save response", /** Protect command and callback publication across lifecycle transitions. */ async () => {
  const close = vi.fn();
  render(panel("e", close));
  await editEvent();
  live.suspended = true;
  fireEvent.click(screen.getByRole("button", { name: "Save event" }));
  expect(updateCalendarEvent).not.toHaveBeenCalled();
  live.suspended = false;
  let resolve!: (event: CalendarEventDto) => void;
  vi.mocked(updateCalendarEvent).mockReturnValue(
    new Promise(
      /** Hold the admitted response beyond reset. */ (done) => {
        resolve = done;
      },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save event" }));
  live.epoch = 1;
  changed.mockClear();
  await act(
    /** Complete the old-epoch update. */ async () => resolve({ ...event, title: "Retired" }),
  );
  expect(changed).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Retired" })).not.toBeInTheDocument();
});
it("routes dirty deletion through discard and the same confirmed detail owner", /** Do not prepare or delete until the user leaves dirty editing. */ async () => {
  const close = vi.fn();
  render(panel("e", close));
  await editEvent();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
  expect(prepareDeleteCalendarEvent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await screen.findByText("0 reminder definitions will be deleted.");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
  await waitFor(
    /** Close only after committed deletion. */ () => expect(close).toHaveBeenCalledOnce(),
  );
});

afterEach(/** Release each component lifetime. */ () => cleanup());

it("does not publish a read started before a completed update", /** Retire pre-mutation snapshots even when their response arrives after acknowledgement. */ async () => {
  render(panel());
  await editEvent();
  let resolve!: (event: CalendarEventDto) => void;
  vi.mocked(getCalendarEvent).mockReturnValue(
    new Promise(
      /** Hold an older authoritative read in flight. */ (done) => {
        resolve = done;
      },
    ),
  );
  act(/** Start a focus read before saving. */ () => window.dispatchEvent(new Event("focus")));
  fireEvent.click(screen.getByRole("button", { name: "Save event" }));
  expect(await screen.findByRole("heading", { name: "Saved" })).toBeVisible();
  await act(/** Release the obsolete pre-save snapshot. */ async () => resolve(event));
  expect(screen.getByRole("heading", { name: "Saved" })).toBeVisible();
});

it("retries failed subscriptions during editing and releases all cleanup handles", /** Keep the draft while recovering listener setup and cleanup failure. */ async () => {
  const failingCleanup = vi.fn(
    /** Simulate one failing native cleanup. */ () => {
      throw new Error("cleanup");
    },
  );
  const otherCleanup = vi.fn();
  vi.mocked(onCalendarChanged).mockResolvedValue(failingCleanup);
  vi.mocked(onProjectsChanged)
    .mockRejectedValueOnce(new Error("setup"))
    .mockResolvedValue(otherCleanup);
  const view = render(panel());
  await editEvent();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(
    /** Wait for listener recovery. */ () =>
      expect(screen.queryByText("Calendar updates are unavailable")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("Keep draft");
  view.unmount();
  expect(failingCleanup).toHaveBeenCalled();
  expect(otherCleanup).toHaveBeenCalled();
});
