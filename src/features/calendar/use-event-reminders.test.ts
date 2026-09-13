import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "@/lib/ipc/reminders";
import type { EventReminderDeliveriesDto } from "@/bindings/reminders";
import { useEventReminders } from "./use-event-reminders";
vi.mock(
  "@/lib/ipc/reminders",
  /** Isolate delivery reads and the native projection. */ () => ({
    getEventReminderDeliveries: vi.fn(),
    onRemindersChanged: vi.fn(),
    setVisibleCalendarEvent: vi.fn(),
  }),
);
const boundary = { epoch: 0, suspended: false };
beforeEach(
  /** Reset each isolated token lifecycle. */ () => {
    vi.resetAllMocks();
    vi.mocked(ipc.setVisibleCalendarEvent).mockResolvedValue(undefined);
    vi.mocked(ipc.onRemindersChanged).mockResolvedValue(vi.fn());
    vi.mocked(ipc.getEventReminderDeliveries).mockImplementation(
      /** Return the requested opaque context. */ async (eventId, occurrenceId) => ({
        eventId,
        occurrenceId,
        sequence: "1",
        items: [],
      }),
    );
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  },
);
afterEach(
  /** Settle serialized cleanup before another test resets native mocks. */ async () => {
    cleanup();
    await act(/** Drain all queued hides. */ async () => {});
    vi.restoreAllMocks();
  },
);
it("shows base detail with nullable occurrence and never fabricates a delivery query", /** Search/create have only an event identity. */ async () => {
  const view = renderHook(
    /** Mount a visible base definition. */ () => useEventReminders("e", null, true, boundary),
  );
  await waitFor(
    /** Observe the nullable contract. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledWith({
        kind: "show",
        eventId: "e",
        occurrenceId: null,
        viewToken: expect.any(String),
      }),
  );
  expect(ipc.getEventReminderDeliveries).not.toHaveBeenCalled();
  const input = vi.mocked(ipc.setVisibleCalendarEvent).mock.calls[0][0];
  view.unmount();
  await waitFor(
    /** Hide the same owned token. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenLastCalledWith({
        kind: "hide",
        viewToken: input.viewToken,
      }),
  );
});
it("waits for old show then hide before replacement owner show", /** A late A show cannot overwrite B or survive cleanup. */ async () => {
  let release!: () => void;
  vi.mocked(ipc.setVisibleCalendarEvent).mockReturnValueOnce(
    new Promise(
      /** Hold the first native show. */ (resolve) => {
        release = resolve;
      },
    ),
  );
  const first = renderHook(
    /** Mount owner A. */ () => useEventReminders("a", null, true, boundary),
  );
  await waitFor(
    /** Ensure A entered the native command. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledTimes(1),
  );
  first.unmount();
  renderHook(
    /** Mount owner B while A is pending. */ () => useEventReminders("b", "opaque", true, boundary),
  );
  expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledTimes(1);
  await act(/** Let retirement commands proceed in order. */ async () => release());
  await waitFor(
    /** B can show only after A cleanup. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledTimes(3),
  );
  const calls = vi
    .mocked(ipc.setVisibleCalendarEvent)
    .mock.calls.map(/** Extract serialized command inputs. */ ([input]) => input);
  expect(calls[1]).toEqual({ kind: "hide", viewToken: calls[0].viewToken });
  expect(calls[2]).toMatchObject({ kind: "show", eventId: "b", occurrenceId: "opaque" });
});
it("hides on mode, document and maintenance transitions", /** Editor/delete/discard share the visible flag without losing backend main state. */ async () => {
  const view = renderHook(
    /** Drive detail view ownership from its current mode. */ ({ visible, suspended }) =>
      useEventReminders("e", null, visible, { ...boundary, suspended }),
    { initialProps: { visible: true, suspended: false } },
  );
  await waitFor(
    /** Wait for the initial visible projection. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledTimes(1),
  );
  view.rerender({ visible: false, suspended: false });
  await waitFor(
    /** Leaving actual detail hides its token. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenLastCalledWith({
        kind: "hide",
        viewToken: expect.any(String),
      }),
  );
  view.rerender({ visible: true, suspended: false });
  await waitFor(
    /** Returning to view gets a new token. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledTimes(3),
  );
  await act(
    /** Background the document without native automation. */ async () => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    },
  );
  await waitFor(
    /** A hidden WebView retires its projection. */ () =>
      expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledTimes(4),
  );
  view.rerender({ visible: true, suspended: true });
  expect(ipc.setVisibleCalendarEvent).toHaveBeenCalledTimes(4);
});
it("rejects an old occurrence response and exposes recoverable read/listener failures", /** Delivery refresh cannot manufacture a different context. */ async () => {
  let release!: (value: EventReminderDeliveriesDto) => void;
  vi.mocked(ipc.getEventReminderDeliveries).mockReturnValueOnce(
    new Promise(
      /** Hold obsolete occurrence data. */ (resolve) => {
        release = resolve;
      },
    ),
  );
  const view = renderHook(
    /** Replace occurrence while retaining base event identity. */ ({ occurrence }) =>
      useEventReminders("e", occurrence, false, boundary),
    { initialProps: { occurrence: "old" } },
  );
  view.rerender({ occurrence: "new" });
  await waitFor(
    /** Publish the new identity only. */ () =>
      expect(view.result.current.snapshot?.occurrenceId).toBe("new"),
  );
  await act(
    /** Complete the retired response. */ async () =>
      release({ eventId: "e", occurrenceId: "old", sequence: "0", items: [] }),
  );
  expect(view.result.current.snapshot?.occurrenceId).toBe("new");
  vi.mocked(ipc.getEventReminderDeliveries).mockRejectedValue(new Error("read"));
  vi.mocked(ipc.onRemindersChanged).mockRejectedValue(new Error("listen"));
  await act(/** Retry both ownership seams. */ async () => view.result.current.retry());
  await waitFor(
    /** Expose both failures without changing the event draft owner. */ () => {
      expect(view.result.current.error).toBeInstanceOf(Error);
      expect(view.result.current.listenerError).toBe(true);
    },
  );
});
it("retries a failed show and does not publish cleanup failures after retirement", /** A broken visibility command leaves the current user an explicit recovery action. */ async () => {
  vi.mocked(ipc.setVisibleCalendarEvent).mockRejectedValueOnce(new Error("show failed"));
  const { result } = renderHook(
    /** Mount a current visible detail. */ () => useEventReminders("e", null, true, boundary),
  );
  await waitFor(
    /** Report failure for this owner. */ () => expect(result.current.visibilityError).toBe(true),
  );
  await act(/** Re-register using a fresh token. */ async () => result.current.retry());
  await waitFor(
    /** Clear error after successful retry. */ () =>
      expect(result.current.visibilityError).toBe(false),
  );
  expect(ipc.setVisibleCalendarEvent).toHaveBeenLastCalledWith({
    kind: "show",
    eventId: "e",
    occurrenceId: null,
    viewToken: expect.any(String),
  });
});
