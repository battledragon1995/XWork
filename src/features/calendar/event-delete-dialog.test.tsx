import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarEventDto, DeleteCalendarEventImpactDto } from "@/bindings/calendar";
import {
  confirmDeleteCalendarEvent,
  onCalendarChanged,
  prepareDeleteCalendarEvent,
} from "@/lib/ipc/calendar";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { EventDeleteDialog } from "./event-delete-dialog";
vi.mock(
  "@/lib/ipc/calendar",
  /** Isolate backend-issued confirmation tokens. */ () => ({
    confirmDeleteCalendarEvent: vi.fn(),
    prepareDeleteCalendarEvent: vi.fn(),
    onCalendarChanged: vi.fn(),
  }),
);
const event = {
  id: "e",
  title: "Meeting",
  revision: "90071992547409930",
  recurrence: { kind: "daily", end: { kind: "never" } },
} as CalendarEventDto;
const impact: DeleteCalendarEventImpactDto = {
  requestId: 7,
  eventId: "e",
  title: "Meeting",
  isRecurring: true,
  reminderCount: 2,
};
let live = true;
const deleted = vi.fn();
const cancel = vi.fn();
const reload = vi.fn();
const pending = vi.fn();
/** Read admission independently of React rendering. */
function admitted() {
  return live;
}
/** Mount confirmation content in an isolated owner lifetime. */
function mount() {
  return render(
    <EventDeleteDialog
      event={event}
      admitted={admitted}
      onDeleted={deleted}
      onCancel={cancel}
      onReload={reload}
      onPending={pending}
    />,
  );
}
beforeEach(
  /** Reset token, subscription and boundary fixtures. */ () => {
    vi.resetAllMocks();
    live = true;
    vi.mocked(onCalendarChanged).mockResolvedValue(vi.fn());
    vi.mocked(prepareDeleteCalendarEvent).mockResolvedValue(impact);
    vi.mocked(confirmDeleteCalendarEvent).mockResolvedValue({ eventId: "e" });
  },
);
afterEach(
  /** Release confirmation timers and listeners. */ () => {
    cleanup();
    vi.useRealTimers();
  },
);
it("prepares opaque revision, displays impact and cancels without confirming", /** Require an explicit destructive click after review. */ async () => {
  mount();
  expect(await screen.findByText("2 reminder definitions will be deleted.")).toBeVisible();
  expect(prepareDeleteCalendarEvent).toHaveBeenCalledExactlyOnceWith({
    eventId: "e",
    expectedRevision: "90071992547409930",
  });
  expect(screen.getByText("This deletes the entire series.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirmDeleteCalendarEvent).not.toHaveBeenCalled();
});
it("confirms once and accepts acknowledgement after native invalidation", /** Keep committed response ownership distinct from preview revocation. */ async () => {
  let resolve!: (result: { eventId: string }) => void;
  vi.mocked(confirmDeleteCalendarEvent).mockReturnValue(
    new Promise(
      /** Hold the destructive acknowledgement. */ (done) => {
        resolve = done;
      },
    ),
  );
  mount();
  await screen.findByText("2 reminder definitions will be deleted.");
  fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
  expect(confirmDeleteCalendarEvent).toHaveBeenCalledExactlyOnceWith({ requestId: 7 });
  act(
    /** Deliver the committed native signal before the command response. */ () =>
      vi
        .mocked(onCalendarChanged)
        .mock.calls[0][0]({ sequence: "2", eventId: "e", kind: "deleted", revision: null }),
  );
  await act(/** Finish the already-admitted deletion. */ async () => resolve({ eventId: "e" }));
  expect(deleted).toHaveBeenCalledOnce();
});
it.each(["delete_confirmation_missing", "delete_confirmation_expired", "delete_impact_changed"])(
  "requires a new review and click after %s",
  /** Never auto-confirm a refreshed backend token. */ async (kind) => {
    vi.mocked(confirmDeleteCalendarEvent).mockRejectedValueOnce(
      new IpcCallError("confirm", { kind }),
    );
    mount();
    await screen.findByText("2 reminder definitions will be deleted.");
    fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review deletion again" }));
    await waitFor(
      /** Wait for the replacement preview. */ () =>
        expect(prepareDeleteCalendarEvent).toHaveBeenCalledTimes(2),
    );
    expect(confirmDeleteCalendarEvent).toHaveBeenCalledOnce();
    await waitFor(
      /** Wait until review is ready for a new explicit click. */ () =>
        expect(screen.getByRole("button", { name: "Delete Event" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
    await waitFor(
      /** Observe the newly confirmed request. */ () => expect(deleted).toHaveBeenCalledOnce(),
    );
  },
);
it("expires the local preview and requires explicit renewal", /** Match backend TTL without constructing authorization. */ async () => {
  vi.useFakeTimers();
  mount();
  await act(
    /** Resolve initial listener and preview microtasks. */ async () => {
      await Promise.resolve();
      await Promise.resolve();
    },
  );
  expect(screen.getByText("2 reminder definitions will be deleted.")).toBeVisible();
  act(/** Move beyond the visible confirmation TTL. */ () => vi.advanceTimersByTime(60_001));
  expect(screen.getByRole("button", { name: "Delete Event" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review deletion again" })).toBeVisible();
  expect(prepareDeleteCalendarEvent).toHaveBeenCalledOnce();
  expect(confirmDeleteCalendarEvent).not.toHaveBeenCalled();
});
it("locks unknown confirmation results until authoritative reload", /** Do not replay a possibly committed delete. */ async () => {
  vi.mocked(confirmDeleteCalendarEvent).mockRejectedValue(new Error("transport"));
  mount();
  await screen.findByText("2 reminder definitions will be deleted.");
  fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
  expect(await screen.findByText(/result is unknown/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review deletion again" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(reload).toHaveBeenCalledOnce();
});
it("denies live-boundary dispatch and retires pending prepare after unmount", /** Drop obsolete impact and cleanup late subscriptions. */ async () => {
  mount();
  await screen.findByText("2 reminder definitions will be deleted.");
  live = false;
  fireEvent.click(screen.getByRole("button", { name: "Delete Event" }));
  expect(confirmDeleteCalendarEvent).not.toHaveBeenCalled();
  cleanup();
  live = true;
  let resolve!: (value: DeleteCalendarEventImpactDto) => void;
  vi.mocked(prepareDeleteCalendarEvent).mockReturnValue(
    new Promise(
      /** Hold a retired impact response. */ (done) => {
        resolve = done;
      },
    ),
  );
  const view = mount();
  await waitFor(
    /** Wait for the new preview request. */ () =>
      expect(prepareDeleteCalendarEvent).toHaveBeenCalledTimes(2),
  );
  view.unmount();
  pending.mockClear();
  await act(/** Complete after the confirmation owner is gone. */ async () => resolve(impact));
  expect(pending).not.toHaveBeenCalled();
  expect(deleted).not.toHaveBeenCalled();
});
