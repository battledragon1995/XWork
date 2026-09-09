import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuickNoteGlobalShortcutStatusDto } from "@/bindings/quick-note-window";
import * as ipc from "@/lib/ipc/quick-note-window";
import { useQuickNoteShortcutStatus } from "./use-quick-note-shortcut-status";

/** Isolate native status and event registration from the test process. */
vi.mock("@/lib/ipc/quick-note-window", () => ({
  getQuickNoteGlobalShortcutStatus: vi.fn(),
  onQuickNoteGlobalShortcutStatusChanged: vi.fn(),
}));
const chord = { primary: true, alt: true, shift: false, keyCode: "KeyN" };
let handler: (value: QuickNoteGlobalShortcutStatusDto) => void;
const unlisten = vi.fn();

/** Construct a native snapshot with an exact decimal generation. */
function status(sequence: string, state: QuickNoteGlobalShortcutStatusDto["state"] = "active") {
  return { sequence, state, actionId: "quick_note.open_global", chord, conflictsWith: [] };
}

/** Control response ordering without timers or OS state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>(
    // Expose explicit completion for races and late lifecycle responses.
    (accept, fail) => {
      resolve = accept;
      reject = fail;
    },
  );
  return { promise, resolve, reject };
}

/** Restore an isolated event channel for every hook lifetime. */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.getQuickNoteGlobalShortcutStatus).mockResolvedValue(status("1"));
  vi.mocked(ipc.onQuickNoteGlobalShortcutStatusChanged).mockImplementation(
    // Retain the listener so tests can deliver real ordering inversions.
    async (callback) => {
      handler = callback;
      return unlisten;
    },
  );
});
afterEach(cleanup);

/** A pending subscription must precede the first snapshot read. */
it("subscribes before reading and ignores older snapshots and duplicate events", async () => {
  const subscription = deferred<() => void>();
  const snapshot = deferred<QuickNoteGlobalShortcutStatusDto>();
  vi.mocked(ipc.onQuickNoteGlobalShortcutStatusChanged).mockImplementation(
    // Delay native registration acknowledgment while keeping event delivery observable.
    (callback) => {
      handler = callback;
      return subscription.promise;
    },
  );
  vi.mocked(ipc.getQuickNoteGlobalShortcutStatus).mockReturnValue(snapshot.promise);
  const { result } = renderHook(
    // Read the committed catalog chord through the hook under test.
    () => useQuickNoteShortcutStatus(chord),
  );
  expect(ipc.getQuickNoteGlobalShortcutStatus).not.toHaveBeenCalled();
  await act(
    // Complete subscription and allow the initial read to begin.
    async () => subscription.resolve(unlisten),
  );
  expect(ipc.getQuickNoteGlobalShortcutStatus).toHaveBeenCalledOnce();
  await act(
    // Deliver a generation beyond Number precision before an older read completes.
    async () => {
      handler(status("9007199254740993"));
      snapshot.resolve(status("9007199254740992", "unavailable"));
    },
  );
  expect(result.current.status).toBe("active");
  act(
    // Duplicate, older, invalid and unrelated events cannot overwrite accepted state.
    () => {
      handler(status("9007199254740993", "unavailable"));
      handler(status("9", "unavailable"));
      handler(status("1e30", "unavailable"));
      handler(status("-1", "unavailable"));
      handler({ ...status("9007199254740994", "unavailable"), actionId: "other" });
    },
  );
  expect(result.current.status).toBe("active");
});

/** Registration reconciliation can recover from startup or snapshot failures. */
it("recovers an initial failed read and unavailable status from later events", async () => {
  vi.mocked(ipc.getQuickNoteGlobalShortcutStatus).mockRejectedValueOnce(new Error("starting"));
  const { result } = renderHook(
    // Mount against a catalog whose native owner is still starting.
    () => useQuickNoteShortcutStatus(chord),
  );
  await waitFor(
    // A failed status query must never infer active from the catalog.
    () => expect(result.current.status).toBe("unknown"),
  );
  act(
    // An initial unavailable registration is a recoverable native state.
    () => handler(status("1", "unavailable")),
  );
  expect(result.current.status).toBe("unavailable");
  expect(result.current.error).toBeNull();
  act(
    // Successful native reconciliation clears the temporary unavailable state.
    () => handler(status("2")),
  );
  expect(result.current.status).toBe("active");
});

/** Listener failure is explicit and Retry reestablishes subscription before reading. */
it("retries failed subscription and refreshes on focus", async () => {
  vi.mocked(ipc.onQuickNoteGlobalShortcutStatusChanged).mockRejectedValueOnce(
    new Error("listener"),
  );
  const { result } = renderHook(
    // Mount with a transient native event registration failure.
    () => useQuickNoteShortcutStatus(chord),
  );
  await waitFor(
    // Surface the failed native subscription as unknown.
    () => expect(result.current.status).toBe("unknown"),
  );
  expect(ipc.getQuickNoteGlobalShortcutStatus).not.toHaveBeenCalled();
  await act(
    // Explicit Retry repairs the listener and reads its first snapshot.
    async () => result.current.refresh(),
  );
  expect(result.current.status).toBe("active");
  vi.mocked(ipc.getQuickNoteGlobalShortcutStatus).mockResolvedValue(
    status("2", "disabled_by_conflict"),
  );
  await act(
    // Returning to the main window obtains current native registration.
    async () => {
      fireEvent.focus(window);
    },
  );
  expect(result.current.status).toBe("disabled_by_conflict");
  expect(ipc.onQuickNoteGlobalShortcutStatusChanged).toHaveBeenCalledTimes(2);
});

/** A saved chord remains pending until native status refers to that same assignment. */
it("shows pending for a mismatched chord and accepts its later native state", async () => {
  const { result, rerender } = renderHook(
    // Feed catalog changes independently from native status events.
    (currentChord) => useQuickNoteShortcutStatus(currentChord),
    { initialProps: chord },
  );
  await waitFor(
    // Establish initial native readiness before committing a different chord.
    () => expect(result.current.status).toBe("active"),
  );
  const changed = { ...chord, keyCode: "KeyY" };
  rerender(changed);
  expect(result.current.status).toBe("pending");
  act(
    // Publish the OS result corresponding to the newly saved assignment.
    () => handler({ ...status("2", "unavailable"), chord: changed }),
  );
  expect(result.current.status).toBe("unavailable");
});

/** Invalid snapshot generations require a safe retry and do not poison the high-water mark. */
it("rejects invalid snapshot sequences and accepts a subsequent valid retry", async () => {
  vi.mocked(ipc.getQuickNoteGlobalShortcutStatus).mockResolvedValueOnce(status(""));
  const { result } = renderHook(
    // Exercise malformed data without constructing an unsafe BigInt.
    () => useQuickNoteShortcutStatus(chord),
  );
  await waitFor(
    // Invalid snapshots must leave native availability unknown.
    () => expect(result.current.status).toBe("unknown"),
  );
  await act(
    // A valid fresh snapshot restores the normal status channel.
    async () => result.current.refresh(),
  );
  expect(result.current.status).toBe("active");
});

/** A query begun before a newer event cannot replace that event with an error. */
it("retains a newer event when a pending query fails", async () => {
  const snapshot = deferred<QuickNoteGlobalShortcutStatusDto>();
  vi.mocked(ipc.getQuickNoteGlobalShortcutStatus).mockReturnValue(snapshot.promise);
  const { result } = renderHook(
    // Start one delayed initial read under the subscribed native channel.
    () => useQuickNoteShortcutStatus(chord),
  );
  await waitFor(
    // Ensure the delayed read has started before delivering the newer event.
    () => expect(ipc.getQuickNoteGlobalShortcutStatus).toHaveBeenCalledOnce(),
  );
  await act(
    // Fail the obsolete read after native state has already been reconciled.
    async () => {
      handler(status("2"));
      snapshot.reject(new Error("obsolete"));
    },
  );
  expect(result.current.status).toBe("active");
  expect(result.current.error).toBeNull();
});

/** A late subscription cannot leak a listener or issue IPC after unmount. */
it("releases a subscription resolved after unmount", async () => {
  const subscription = deferred<() => void>();
  vi.mocked(ipc.onQuickNoteGlobalShortcutStatusChanged).mockReturnValue(subscription.promise);
  const { unmount } = renderHook(
    // Leave listener registration pending while its route disappears.
    () => useQuickNoteShortcutStatus(chord),
  );
  unmount();
  await act(
    // Resolve the native registration after its owner has been disposed.
    async () => subscription.resolve(unlisten),
  );
  fireEvent.focus(window);
  expect(unlisten).toHaveBeenCalledOnce();
  expect(ipc.getQuickNoteGlobalShortcutStatus).not.toHaveBeenCalled();
});

/** Unmounted hooks release listeners and ignore outstanding snapshot results. */
it("cleans up an active listener while a snapshot is pending", async () => {
  const snapshot = deferred<QuickNoteGlobalShortcutStatusDto>();
  vi.mocked(ipc.getQuickNoteGlobalShortcutStatus).mockReturnValue(snapshot.promise);
  const { unmount } = renderHook(
    // Dispose the owner after subscription but before snapshot acknowledgment.
    () => useQuickNoteShortcutStatus(chord),
  );
  await waitFor(
    // Confirm the snapshot is pending before unmounting its owner.
    () => expect(ipc.getQuickNoteGlobalShortcutStatus).toHaveBeenCalledOnce(),
  );
  unmount();
  await act(
    // Late snapshot and event completions must remain harmless.
    async () => {
      snapshot.resolve(status("1"));
      handler(status("2"));
    },
  );
  fireEvent.focus(window);
  expect(unlisten).toHaveBeenCalledOnce();
  expect(ipc.getQuickNoteGlobalShortcutStatus).toHaveBeenCalledOnce();
});
