import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReminderDeliveryDto } from "@/bindings/reminders";
import * as ipc from "@/lib/ipc/reminders";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { CalendarMissed } from "./calendar-missed";
import { useMissedReminders } from "./use-missed-reminders";
vi.mock(
  "@/lib/ipc/reminders",
  /** Isolate backend-owned reminder actions. */ () => ({
    getMissedReminders: vi.fn(),
    onRemindersChanged: vi.fn(),
    openReminder: vi.fn(),
    dismissReminder: vi.fn(),
    dismissAllMissedReminders: vi.fn(),
  }),
);
vi.mock(
  "@/lib/ipc/calendar",
  /** Keep Calendar invalidation local. */ () => ({
    onCalendarChanged: vi.fn(/** Return an isolated subscription. */ async () => vi.fn()),
  }),
);
const row: ReminderDeliveryDto = {
  id: "d",
  eventId: "e",
  occurrenceId: "opaque",
  projectId: "p",
  title: "Missed meeting",
  startsAtMs: "0",
  originalDueAtMs: "0",
  timeZoneId: "UTC",
  minutesBefore: 5,
  status: "missed",
  snoozedUntilMs: null,
  version: "v",
};
const open = vi.fn();
/** Exercise the panel through its actual owner and public IPC seams. */
function Panel() {
  const reminders = useMissedReminders({ epoch: 0, suspended: false });
  return <CalendarMissed reminders={reminders} projectScoped onOpen={open} />;
}
beforeEach(
  /** Reset each rendering and action lifetime. */ () => {
    vi.resetAllMocks();
    vi.mocked(ipc.onRemindersChanged).mockResolvedValue(vi.fn());
    vi.mocked(ipc.getMissedReminders).mockResolvedValue({
      sequence: "1",
      missedCount: 1,
      items: [row],
      nextCursor: null,
    });
    vi.mocked(ipc.openReminder).mockResolvedValue({
      eventId: "e",
      occurrenceId: "opaque",
      projectId: "p",
    });
  },
);
afterEach(/** Release native subscriptions and browser ownership. */ () => cleanup());
it("shows global scope and opens the validated target without Snooze or dismissal", /** Missed deliveries have no active-only action. */ async () => {
  render(<Panel />);
  expect(await screen.findByText("Missed meeting")).toBeVisible();
  expect(screen.getByText("Missed reminders across all projects")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Snooze/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open event" }));
  await waitFor(
    /** Navigate only the backend acknowledgement. */ () =>
      expect(open).toHaveBeenCalledWith({ eventId: "e", occurrenceId: "opaque", projectId: "p" }),
  );
  expect(ipc.dismissReminder).not.toHaveBeenCalled();
  expect(screen.getByText("Missed meeting")).toBeVisible();
});
it("supports keyboard dismissal and restores focus after the row disappears", /** Refetched backend rows and count own the empty state. */ async () => {
  const user = userEvent.setup();
  render(<Panel />);
  await screen.findByText("Missed meeting");
  vi.mocked(ipc.getMissedReminders).mockResolvedValue({
    sequence: "2",
    missedCount: 0,
    items: [],
    nextCursor: null,
  });
  screen.getByRole("button", { name: "Dismiss" }).focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("No missed reminders")).toBeVisible();
  expect(ipc.dismissReminder).toHaveBeenCalledWith("d", "v");
  expect(screen.getByRole("heading", { name: "Missed reminders" })).toHaveFocus();
});
it("dismisses all globally and exposes loading, catching-up and retry", /** Backend catch-up is recoverable without a polling timer. */ async () => {
  vi.mocked(ipc.getMissedReminders).mockRejectedValue(
    new IpcCallError("get_missed_reminders", { code: "scheduler_catching_up" }),
  );
  render(<Panel />);
  expect(await screen.findByText("Catching up reminders…")).toBeVisible();
  vi.mocked(ipc.getMissedReminders).mockResolvedValue({
    sequence: "1",
    missedCount: 91,
    items: [row],
    nextCursor: { originalDueAtMs: "0", id: "d" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Load more" })).toBeVisible();
  await act(
    /** Dispatch a global operation independently of loaded rows. */ async () =>
      fireEvent.click(screen.getByRole("button", { name: "Dismiss all missed reminders" })),
  );
  expect(ipc.dismissAllMissedReminders).toHaveBeenCalledWith();
});
