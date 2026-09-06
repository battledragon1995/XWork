import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionRuntimeEventDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listSessions, onSessionsRuntimeChanged } from "@/lib/ipc/sessions";
import { useHomeSessions } from "./use-home-sessions";

// Replace the public query/event boundary; no runtime or PTY is used.
vi.mock("@/lib/ipc/sessions", () => ({ listSessions: vi.fn(), onSessionsRuntimeChanged: vi.fn() }));
const ROW: SessionSummaryDto = {
  id: "s",
  projectId: "p",
  name: "Session",
  status: "needsAttention",
  tabCount: 2,
  runningProcessCount: 1,
};
const list = vi.mocked(listSessions);
const listen = vi.mocked(onSessionsRuntimeChanged);
const refreshProjects = vi.fn();
const unlisten = vi.fn();
/** Control completion ordering without wall-clock delays. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Emit one aggregate invalidation from the public event stream. */
function emit(change: SessionRuntimeEventDto["change"] = "updated") {
  listen.mock.calls.at(-1)?.[0]({
    change,
    revision: "2",
    projectId: "p",
    sessionId: "s",
    summary: null,
  });
}
// Start with one isolated summary and clean listener ownership.
beforeEach(() => {
  vi.resetAllMocks();
  list.mockResolvedValue([ROW]);
  listen.mockResolvedValue(unlisten);
});
// Retire all hooks before restoring mocked boundaries.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The global list omits projectId and starts only after subscription registration.
it("subscribes before the global read and performs no work while disabled", async () => {
  const registration = deferred<() => void>();
  listen.mockReturnValue(registration.promise);
  const { result, rerender } = renderHook(
    ({ enabled }) => useHomeSessions({}, 0, refreshProjects, enabled),
    { initialProps: { enabled: false } },
  );
  expect(list).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
  rerender({ enabled: true });
  expect(list).not.toHaveBeenCalled();
  await act(async () => registration.resolve(unlisten));
  expect(list).toHaveBeenCalledExactlyOnceWith();
  expect(result.current.snapshot).toEqual([ROW]);
});
// Event bursts retire a result and queue one trailing read, not concurrent requests.
it("coalesces event bursts and drops deleted rows before stale completion", async () => {
  const { result } = renderHook(() => useHomeSessions({}, 0, refreshProjects));
  await waitFor(() => expect(result.current.snapshot).toEqual([ROW]));
  const old = deferred<SessionSummaryDto[]>();
  const next = deferred<SessionSummaryDto[]>();
  list.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  act(() => result.current.refresh());
  act(() => {
    emit("deleted");
    emit();
    emit();
  });
  expect(result.current.snapshot).toEqual([]);
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve([ROW]));
  expect(result.current.snapshot).toEqual([]);
  expect(list).toHaveBeenCalledTimes(3);
  await act(async () => next.resolve([]));
  expect(result.current.refreshing).toBe(false);
});
// Repeated projectNotFound reconciles only once until an explicit retry.
it("bounds missing-project reconciliation and allows explicit retry", async () => {
  list.mockRejectedValue(new IpcCallError("list_sessions", { code: "projectNotFound" }));
  const { result } = renderHook(() => useHomeSessions({}, 0, refreshProjects));
  await waitFor(() => expect(result.current.failure).toBe("retryable"));
  expect(refreshProjects).toHaveBeenCalledTimes(1);
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => result.current.refresh());
  expect(refreshProjects).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(4);
});
// Integration errors do not invent an empty runtime and transient errors retain a snapshot.
it.each(["projectLookupFailed", "unauthorizedWindow"])(
  "classifies %s without false empty",
  async (code) => {
    list.mockRejectedValue(new IpcCallError("list_sessions", { code }));
    const { result } = renderHook(() => useHomeSessions({}, 0, refreshProjects));
    await waitFor(() =>
      expect(result.current.failure).toBe(
        code === "projectLookupFailed" ? "retryable" : "integration",
      ),
    );
    expect(result.current.snapshot).toBeNull();
  },
);
// Listener recovery must not prevent querying or keep an orphan after unmount.
it("recovers a failed subscription and cleans a late registration", async () => {
  listen.mockRejectedValueOnce(new Error("listen"));
  const { result, unmount } = renderHook(() => useHomeSessions({}, 0, refreshProjects));
  await waitFor(() => expect(result.current.subscriptionFailed).toBe(true));
  expect(result.current.snapshot).toEqual([ROW]);
  const late = deferred<() => void>();
  listen.mockReturnValueOnce(late.promise);
  act(() => result.current.refresh());
  unmount();
  await act(async () => late.resolve(unlisten));
  expect(unlisten).toHaveBeenCalledTimes(1);
});
// Project invalidation, focus and visibility share the source's single-flight lifetime.
it("refreshes on project invalidation and foreground visibility", async () => {
  const { result, rerender } = renderHook(
    ({ signal }) => useHomeSessions({}, signal, refreshProjects),
    { initialProps: { signal: 0 } },
  );
  await waitFor(() => expect(result.current.snapshot).toEqual([ROW]));
  rerender({ signal: 1 });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(list).toHaveBeenCalledTimes(4);
});
// Live epoch checks retire promises before the component receives new boundary props.
it("drops a pre-reset flight and clears prior rows on epoch render", async () => {
  let boundary = { suspended: false, epoch: 0 };
  const { result, rerender } = renderHook(() =>
    useHomeSessions({ boundary, readBoundary: () => boundary }, 0, refreshProjects),
  );
  await waitFor(() => expect(result.current.snapshot).toEqual([ROW]));
  const old = deferred<SessionSummaryDto[]>();
  list.mockReturnValueOnce(old.promise);
  act(() => result.current.refresh());
  boundary = { suspended: true, epoch: 1 };
  await act(async () => old.resolve([{ ...ROW, name: "Stale" }]));
  rerender();
  expect(result.current.snapshot).toBeNull();
  list.mockRejectedValue(new IpcCallError("list_sessions", { code: "projectLookupFailed" }));
  boundary = { suspended: false, epoch: 1 };
  rerender();
  await waitFor(() => expect(result.current.failure).toBe("retryable"));
  expect(result.current.snapshot).toBeNull();
});

// StrictMode replay must dispose the first registration before its late promise resolves.
it("cleans both StrictMode registrations and only queries the live lifetime", async () => {
  const first = deferred<() => void>();
  const oldUnlisten = vi.fn();
  listen.mockReturnValueOnce(first.promise);
  const { result, unmount } = renderHook(() => useHomeSessions({}, 0, refreshProjects), {
    reactStrictMode: true,
    wrapper: /** Replay effects using React's actual development lifecycle. */ ({ children }) =>
      createElement(StrictMode, null, children),
  });
  await waitFor(() => expect(result.current.snapshot).toEqual([ROW]));
  expect(listen).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(oldUnlisten));
  expect(oldUnlisten).toHaveBeenCalledOnce();
  unmount();
  expect(unlisten).toHaveBeenCalledOnce();
});

// A failed refresh keeps the last good session list and repeated retry clicks cannot fan out.
it("retains stale sessions and locks repeated retry requests", async () => {
  const { result } = renderHook(() => useHomeSessions({}, 0, refreshProjects));
  await waitFor(() => expect(result.current.snapshot).toEqual([ROW]));
  const pending = deferred<SessionSummaryDto[]>();
  list.mockReturnValueOnce(pending.promise);
  act(() => {
    result.current.refresh();
    result.current.refresh();
    result.current.refresh();
  });
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () =>
    pending.reject(new IpcCallError("list_sessions", { code: "projectLookupFailed" })),
  );
  expect(result.current.snapshot).toEqual([ROW]);
  expect(result.current.failure).toBe("retryable");
});
