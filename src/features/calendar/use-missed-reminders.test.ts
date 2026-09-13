import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  MissedReminderPageDto,
  ReminderChangedDto,
  ReminderDeliveryDto,
} from "@/bindings/reminders";
import * as ipc from "@/lib/ipc/reminders";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { useMissedReminders } from "./use-missed-reminders";
vi.mock(
  "@/lib/ipc/reminders",
  /** Isolate reminder persistence and invalidation. */ () => ({
    getMissedReminders: vi.fn(),
    onRemindersChanged: vi.fn(),
    openReminder: vi.fn(),
    dismissReminder: vi.fn(),
    dismissAllMissedReminders: vi.fn(),
  }),
);
vi.mock(
  "@/lib/ipc/calendar",
  /** Isolate Calendar invalidation. */ () => ({
    onCalendarChanged: vi.fn(/** Resolve an inert calendar registration. */ async () => vi.fn()),
  }),
);
const boundary = { suspended: false, epoch: 0 };
const row: ReminderDeliveryDto = {
  id: "d",
  eventId: "e",
  occurrenceId: "opaque",
  projectId: null,
  title: "Meeting",
  startsAtMs: "1000",
  originalDueAtMs: "0",
  timeZoneId: "UTC",
  minutesBefore: 5,
  status: "missed",
  snoozedUntilMs: null,
  version: "v",
};
let changed: (event: ReminderChangedDto) => void;
/** Build an authoritative page independent of the visible Calendar scope. */
function page(sequence = "1"): MissedReminderPageDto {
  return {
    sequence,
    missedCount: 31,
    items: Array.from(
      { length: 30 },
      /** Give every row its stable server identity. */ (_, index) => ({ ...row, id: `d${index}` }),
    ),
    nextCursor: { originalDueAtMs: "0", id: "d29" },
  };
}
beforeEach(
  /** Reset public IPC seams per test. */ () => {
    vi.resetAllMocks();
    vi.mocked(ipc.getMissedReminders).mockResolvedValue(page());
    vi.mocked(ipc.onRemindersChanged).mockImplementation(
      /** Capture the backend invalidation. */ async (handler) => {
        changed = handler;
        return vi.fn<() => void>();
      },
    );
    vi.mocked(ipc.openReminder).mockResolvedValue({
      eventId: "e",
      occurrenceId: "opaque",
      projectId: "p",
    });
  },
);
afterEach(/** Retire hook owners before resetting IPC. */ () => cleanup());
it("loads thirty global rows then follows only the explicit cursor", /** Never derive count from loaded rows. */ async () => {
  const { result } = renderHook(
    /** Mount one live global owner. */ () => useMissedReminders(boundary),
  );
  await waitFor(
    /** Await the authoritative first page. */ () =>
      expect(result.current.page?.items).toHaveLength(30),
  );
  expect(ipc.getMissedReminders).toHaveBeenLastCalledWith(null, 30);
  vi.mocked(ipc.getMissedReminders).mockResolvedValue({
    sequence: "1",
    missedCount: 31,
    items: [{ ...row, id: "last" }],
    nextCursor: null,
  });
  await act(
    /** Load the one remaining delivery. */ async () => {
      await result.current.loadMore();
    },
  );
  expect(ipc.getMissedReminders).toHaveBeenLastCalledWith({ originalDueAtMs: "0", id: "d29" }, 30);
  expect(result.current.page?.items).toHaveLength(31);
  expect(result.current.page?.missedCount).toBe(31);
});
it("opens without dismissing and reconciles single/all writes without an event", /** Use opaque version and authoritative count. */ async () => {
  const { result } = renderHook(
    /** Mount actions on a loaded snapshot. */ () => useMissedReminders(boundary),
  );
  await waitFor(
    /** Wait until reads release admission. */ () => expect(result.current.loading).toBe(false),
  );
  await act(
    /** Open through backend validation. */ async () =>
      expect(await result.current.action("open", row)).toEqual({
        eventId: "e",
        occurrenceId: "opaque",
        projectId: "p",
      }),
  );
  expect(ipc.dismissReminder).not.toHaveBeenCalled();
  vi.mocked(ipc.getMissedReminders).mockResolvedValue({
    sequence: "2",
    missedCount: 0,
    items: [],
    nextCursor: null,
  });
  await act(
    /** Dismiss the exact displayed delivery revision. */ async () => {
      await result.current.action("dismiss", row);
    },
  );
  expect(ipc.dismissReminder).toHaveBeenCalledWith("d", "v");
  await waitFor(
    /** Trust the reconciliation response. */ () =>
      expect(result.current.page?.missedCount).toBe(0),
  );
  await act(
    /** Dismiss all without passing loaded row IDs. */ async () => {
      await result.current.action("all");
    },
  );
  expect(ipc.dismissAllMissedReminders).toHaveBeenCalledWith();
});
it("retires stale reads on invalidation and rejects actions at a synchronous boundary", /** No old response may cross maintenance ownership. */ async () => {
  let resolve!: (value: MissedReminderPageDto) => void;
  vi.mocked(ipc.getMissedReminders).mockReturnValueOnce(
    new Promise(
      /** Hold the initial read. */ (done) => {
        resolve = done;
      },
    ),
  );
  let live = { ...boundary };
  const { result } = renderHook(
    /** Read live admission before React rerenders. */ () =>
      useMissedReminders(boundary, /** Observe the synchronous maintenance owner. */ () => live),
  );
  vi.mocked(ipc.getMissedReminders).mockResolvedValue(page("2"));
  await act(
    /** Retire the pending response and return a newer page. */ async () => {
      changed({ sequence: "2", missedCount: 31 });
      resolve(page("0"));
    },
  );
  await waitFor(
    /** Only the post-invalidation page may publish. */ () =>
      expect(result.current.page?.sequence).toBe("2"),
  );
  live = { suspended: true, epoch: 0 };
  await act(
    /** Try a now-retired action. */ async () => {
      await result.current.action("dismiss", row);
    },
  );
  expect(ipc.dismissReminder).not.toHaveBeenCalled();
});
it("retains uncertain mutation errors while refreshing and recovers catching-up on retry", /** No timer retries a failed mutation or catching-up read. */ async () => {
  const failure = new IpcCallError("dismiss_reminder", null);
  vi.mocked(ipc.dismissReminder).mockRejectedValue(failure);
  const { result } = renderHook(
    /** Mount a loaded action owner. */ () => useMissedReminders(boundary),
  );
  await waitFor(/** Wait for the current rows. */ () => expect(result.current.page).not.toBeNull());
  await act(
    /** Surface an unknown write result. */ async () => {
      await result.current.action("dismiss", row);
    },
  );
  expect(result.current.error).toBe(failure);
  vi.mocked(ipc.getMissedReminders).mockRejectedValue(
    new IpcCallError("get_missed_reminders", { code: "scheduler_catching_up" }),
  );
  await act(
    /** Explicitly retry read and subscription ownership. */ async () => result.current.retry(),
  );
  await waitFor(
    /** Keep the documented recoverable error. */ () =>
      expect(result.current.error).toMatchObject({ payload: { code: "scheduler_catching_up" } }),
  );
  expect(ipc.dismissReminder).toHaveBeenCalledTimes(1);
});
it("resets continuation when its sequence changes", /** Never append a cursor page from a different snapshot. */ async () => {
  const { result } = renderHook(
    /** Mount the first paging snapshot. */ () => useMissedReminders(boundary),
  );
  await waitFor(
    /** Wait for stable paging admission. */ () =>
      expect(result.current.page?.items).toHaveLength(30),
  );
  vi.mocked(ipc.getMissedReminders).mockResolvedValue({
    sequence: "2",
    missedCount: 1,
    items: [row],
    nextCursor: null,
  });
  await act(
    /** Read a changed continuation and reconcile the first page. */ async () => {
      await result.current.loadMore();
    },
  );
  await waitFor(
    /** Publish a reset page instead of duplicate history. */ () =>
      expect(result.current.page?.items).toEqual([row]),
  );
  expect(ipc.getMissedReminders).toHaveBeenLastCalledWith(null, 30);
});

it("rejects old sequences and locks a stale snapshot after a failed read", /** Backend event sequence outranks an older page even above safe integer range. */ async () => {
  vi.mocked(ipc.getMissedReminders).mockResolvedValue(page("9007199254740993"));
  const { result } = renderHook(
    /** Mount one stable high-sequence snapshot. */ () => useMissedReminders(boundary),
  );
  await waitFor(
    /** Await the first authoritative page. */ () =>
      expect(result.current.page?.sequence).toBe("9007199254740993"),
  );
  await act(
    /** Invalidate with a newer committed sequence. */ async () =>
      changed({ sequence: "9007199254740994", missedCount: 30 }),
  );
  expect(result.current.stale).toBe(true);
  await act(
    /** Deny mutation against the retained stale rows. */ async () => {
      await result.current.action("dismiss", row);
    },
  );
  expect(ipc.dismissReminder).not.toHaveBeenCalled();
});

it("deduplicates continuation identities and resets one invalid cursor", /** A malformed continuation must not duplicate rows or keep retrying the cursor. */ async () => {
  const { result } = renderHook(
    /** Mount the paginated snapshot. */ () => useMissedReminders(boundary),
  );
  await waitFor(
    /** Wait for initial paging admission. */ () =>
      expect(result.current.page?.items).toHaveLength(30),
  );
  vi.mocked(ipc.getMissedReminders).mockResolvedValueOnce({
    sequence: "1",
    missedCount: 31,
    items: [
      { ...row, id: "d29" },
      { ...row, id: "last" },
    ],
    nextCursor: { originalDueAtMs: "0", id: "last" },
  });
  await act(
    /** Append a page containing one repeated identity. */ async () => {
      await result.current.loadMore();
    },
  );
  expect(result.current.page?.items).toHaveLength(31);
  vi.mocked(ipc.getMissedReminders)
    .mockRejectedValueOnce(new IpcCallError("get_missed_reminders", { code: "invalid_cursor" }))
    .mockResolvedValueOnce(page("2"));
  await act(
    /** Recover an invalid continuation through the first page once. */ async () => {
      await result.current.loadMore();
    },
  );
  await waitFor(
    /** Publish the replacement first page. */ () =>
      expect(result.current.page?.sequence).toBe("2"),
  );
  expect(ipc.getMissedReminders).toHaveBeenLastCalledWith(null, 30);
});

it("ignores duplicate events and releases late or failed listener registrations", /** An obsolete subscription cannot keep a retired Calendar owner active. */ async () => {
  const view = renderHook(/** Mount the current owner. */ () => useMissedReminders(boundary));
  await waitFor(
    /** Wait for setup-race reconciliation. */ () =>
      expect(view.result.current.loading).toBe(false),
  );
  const reads = vi.mocked(ipc.getMissedReminders).mock.calls.length;
  await act(
    /** Repeat the same committed sequence. */ async () =>
      changed({ sequence: "1", missedCount: 31 }),
  );
  expect(ipc.getMissedReminders).toHaveBeenCalledTimes(reads);
  view.unmount();
  let resolve!: (cleanup: () => void) => void;
  const unlisten = vi.fn<() => void>();
  vi.mocked(ipc.onRemindersChanged).mockReturnValueOnce(
    new Promise(
      /** Delay a registration beyond unmount. */ (done) => {
        resolve = done;
      },
    ),
  );
  const retired = renderHook(
    /** Mount a soon-retired registration. */ () => useMissedReminders(boundary),
  );
  retired.unmount();
  await act(/** Deliver the late cleanup handle. */ async () => resolve(unlisten));
  expect(unlisten).toHaveBeenCalledOnce();
  vi.mocked(ipc.onRemindersChanged).mockRejectedValueOnce(new Error("subscription unavailable"));
  const failed = renderHook(
    /** Keep ordinary reads available after subscription failure. */ () =>
      useMissedReminders(boundary),
  );
  await waitFor(
    /** Publish an explicit recoverable listener error. */ () =>
      expect(failed.result.current.listenerError).toBe(true),
  );
  expect(failed.result.current.page?.missedCount).toBe(31);
});
