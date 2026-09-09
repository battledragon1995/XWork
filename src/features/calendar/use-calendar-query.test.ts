import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CalendarOccurrenceListDto } from "@/bindings/calendar";
import { listCalendarOccurrences, onCalendarChanged } from "@/lib/ipc/calendar";
import { onProjectsChanged } from "@/lib/ipc/projects";
import { calendarRange } from "./calendar-presentation";
import { type CalendarBoundary, useCalendarQuery } from "./use-calendar-query";
/** Isolate Calendar reads and subscriptions. */
vi.mock("@/lib/ipc/calendar", () => ({
  listCalendarOccurrences: vi.fn(),
  onCalendarChanged: vi.fn(),
}));
/** Isolate project invalidations. */
vi.mock("@/lib/ipc/projects", () => ({ onProjectsChanged: vi.fn() }));
/** Release every mounted hook between test cases. */
afterEach(() => cleanup());
const input = calendarRange("2026-09-01", 14, "UTC");
const snapshot = { revision: "opaque", items: [] };
/** Expose controlled asynchronous completion. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(
    /** Capture the test completion seam. */ (done) => {
      resolve = done;
    },
  );
  return { promise, resolve };
}
/** Reset independent native mocks before every lifetime test. */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(onCalendarChanged).mockResolvedValue(vi.fn());
  vi.mocked(onProjectsChanged).mockResolvedValue(vi.fn());
  vi.mocked(listCalendarOccurrences).mockResolvedValue(snapshot);
});
/** Ensure no mutation can slip between the initial read and subscription setup. */
it("subscribes before reading and closes late listeners", async () => {
  const subscription = deferred<() => void>();
  const cleanup = vi.fn();
  vi.mocked(onCalendarChanged).mockReturnValue(subscription.promise);
  const hook = renderHook(/** Mount the bounded query. */ () => useCalendarQuery(input));
  expect(listCalendarOccurrences).not.toHaveBeenCalled();
  hook.unmount();
  await act(
    /** Complete native setup after unmount. */ async () => {
      subscription.resolve(cleanup);
    },
  );
  expect(cleanup).toHaveBeenCalledOnce();
  expect(listCalendarOccurrences).not.toHaveBeenCalled();
});
/** Discard invalidated flights and perform only one reconciliation read. */
it("coalesces changes during an active read", async () => {
  const first = deferred<CalendarOccurrenceListDto>();
  vi.mocked(listCalendarOccurrences).mockReturnValueOnce(first.promise);
  const hook = renderHook(/** Mount the range owner. */ () => useCalendarQuery(input));
  await waitFor(
    /** Await initial subscription completion. */ () =>
      expect(listCalendarOccurrences).toHaveBeenCalledOnce(),
  );
  act(
    /** Send two mutations while the same read is pending. */ () => {
      const handler = vi.mocked(onCalendarChanged).mock.calls[0][0];
      handler({ kind: "updated", eventId: "event", revision: "x", sequence: "x" });
      handler({ kind: "updated", eventId: "event", revision: "y", sequence: "y" });
    },
  );
  await act(
    /** Complete the obsolete read. */ async () => {
      first.resolve({ revision: "stale", items: [] });
    },
  );
  await waitFor(
    /** Observe only the authoritative reconciliation snapshot. */ () =>
      expect(hook.result.current.snapshot).toBe(snapshot),
  );
  expect(listCalendarOccurrences).toHaveBeenCalledTimes(2);
});
/** Keep previous selection responses from overwriting the latest range. */
it("retires old query responses", async () => {
  const first = deferred<CalendarOccurrenceListDto>();
  vi.mocked(listCalendarOccurrences).mockReturnValueOnce(first.promise);
  const hook = renderHook(
    /** Observe range prop changes. */ ({ date }) =>
      useCalendarQuery(calendarRange(date, 1, "UTC")),
    { initialProps: { date: "2026-09-01" } },
  );
  await waitFor(
    /** Wait for the pending old range. */ () =>
      expect(listCalendarOccurrences).toHaveBeenCalledOnce(),
  );
  hook.rerender({ date: "2026-09-02" });
  expect(hook.result.current.snapshot).toBeNull();
  await waitFor(
    /** Observe the second range. */ () => expect(hook.result.current.snapshot).toBe(snapshot),
  );
  await act(
    /** Complete the retired response last. */ async () => {
      first.resolve({ revision: "old", items: [] });
    },
  );
  expect(hook.result.current.snapshot).toBe(snapshot);
});
/** Report listener startup failure while preserving read access and successful retry. */
it("recovers failed registration through retry", async () => {
  vi.mocked(onCalendarChanged).mockRejectedValueOnce(new Error("private"));
  const hook = renderHook(/** Mount the failure scenario. */ () => useCalendarQuery(input));
  await waitFor(
    /** Read remains available despite listener failure. */ () =>
      expect(hook.result.current.snapshot).toBe(snapshot),
  );
  expect(hook.result.current.listenerError).toBe(true);
  act(/** Restart subscription and read. */ () => hook.result.current.retry());
  await waitFor(
    /** Wait for restored native updates. */ () =>
      expect(hook.result.current.listenerError).toBe(false),
  );
  expect(onCalendarChanged).toHaveBeenCalledTimes(2);
});
/** Avoid an empty-state claim when the first read fails. */
it("recovers a failed initial read", async () => {
  vi.mocked(listCalendarOccurrences).mockRejectedValueOnce(new Error("unavailable"));
  const hook = renderHook(/** Mount the read failure. */ () => useCalendarQuery(input));
  await waitFor(
    /** Expose read failure. */ () => expect(hook.result.current.error).toBeInstanceOf(Error),
  );
  expect(hook.result.current.snapshot).toBeNull();
  act(/** Retry the failed read. */ () => hook.result.current.retry());
  await waitFor(
    /** Verify successful recovery clears the error. */ () =>
      expect(hook.result.current.snapshot).toBe(snapshot),
  );
  expect(hook.result.current.error).toBeNull();
});
/** Reject late responses using the synchronous boundary before its React render. */
it("guards epoch and suspension and reloads on resume", async () => {
  const first = deferred<CalendarOccurrenceListDto>();
  vi.mocked(listCalendarOccurrences).mockReturnValueOnce(first.promise);
  let live: CalendarBoundary = { epoch: 0, suspended: false };
  const hook = renderHook(
    /** Feed the app boundary plus synchronous reader. */ ({ boundary }) =>
      useCalendarQuery(input, boundary, /** Read the current app state. */ () => live),
    { initialProps: { boundary: live } },
  );
  await waitFor(
    /** Await initial read admission. */ () =>
      expect(listCalendarOccurrences).toHaveBeenCalledOnce(),
  );
  live = { epoch: 1, suspended: true };
  await act(
    /** Finish a response after the synchronous boundary retired it. */ async () => {
      first.resolve(snapshot);
    },
  );
  expect(hook.result.current.snapshot).toBeNull();
  hook.rerender({ boundary: live });
  expect(hook.result.current.loading).toBe(false);
  live = { epoch: 1, suspended: false };
  hook.rerender({ boundary: live });
  await waitFor(
    /** Observe the resumed fresh query. */ () =>
      expect(hook.result.current.snapshot).toBe(snapshot),
  );
});
/** Keep StrictMode setup cleanup balanced and refresh on visible focus/project changes. */
it("cleans StrictMode listeners and refreshes external invalidations", async () => {
  const cleanup = vi.fn();
  vi.mocked(onCalendarChanged).mockResolvedValue(cleanup);
  vi.mocked(onProjectsChanged).mockResolvedValue(cleanup);
  const hook = renderHook(/** Mount with replayed effects. */ () => useCalendarQuery(input), {
    reactStrictMode: true,
  });
  await waitFor(
    /** Await the surviving lifetime read. */ () =>
      expect(hook.result.current.snapshot).toBe(snapshot),
  );
  act(/** Refresh when focus returns. */ () => window.dispatchEvent(new Event("focus")));
  await waitFor(
    /** Verify a focus read. */ () => expect(listCalendarOccurrences).toHaveBeenCalledTimes(2),
  );
  act(
    /** Refresh linked labels and ranges after project metadata changes. */ () => {
      vi.mocked(onProjectsChanged).mock.calls.at(-1)?.[0]({
        change: "updated",
        projectId: "project",
      });
    },
  );
  await waitFor(
    /** Verify project invalidation triggers a new snapshot. */ () =>
      expect(listCalendarOccurrences).toHaveBeenCalledTimes(3),
  );
  act(
    /** Reconcile when the document becomes visible. */ () =>
      document.dispatchEvent(new Event("visibilitychange")),
  );
  await waitFor(
    /** Verify visibility invalidation triggers a new snapshot. */ () =>
      expect(listCalendarOccurrences).toHaveBeenCalledTimes(4),
  );
  expect(onCalendarChanged).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(cleanup).toHaveBeenCalledTimes(
    vi.mocked(onCalendarChanged).mock.calls.length + vi.mocked(onProjectsChanged).mock.calls.length,
  );
});
