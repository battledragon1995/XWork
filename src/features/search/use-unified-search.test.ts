import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UnifiedSearchResponseDto } from "@/bindings/search";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { searchUnified } from "@/lib/ipc/search";
import { useUnifiedSearch } from "./use-unified-search";

/** Isolate reads with controllable promise completion. */
vi.mock("@/lib/ipc/search", () => ({ searchUnified: vi.fn() }));
const initial = {
  open: true,
  contextReady: true,
  contextProjectId: null as string | null,
  refreshKey: 0,
};
/** Build minimal wire responses without UI-owned ranking. */
function response(query = ""): UnifiedSearchResponseDto {
  return { query, groups: [], resultCount: 0, sourceFailures: [] };
}
/** Hold one read for explicit out-of-order settlement. */
function deferred() {
  let resolve!: (value: UnifiedSearchResponseDto) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<UnifiedSearchResponseDto>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Use isolated fake time for the documented debounce. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.mocked(searchUnified).mockResolvedValue(response());
});
/** Retire hooks before restoring timers. */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
/** Open immediately, then invalidate and debounce typing for exactly 120ms. */
it("debounces typing and clears stale selection immediately", async () => {
  const { result } = renderHook(() => useUnifiedSearch(initial));
  await act(async () => {});
  expect(searchUnified).toHaveBeenCalledTimes(1);
  act(() => result.current.setQuery("Việt"));
  expect(result.current.response).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(119));
  expect(searchUnified).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(searchUnified).toHaveBeenLastCalledWith({ query: "Việt", contextProjectId: null });
});
/** Do not query a not-yet-resolved route or a closed palette. */
it("waits for context readiness and clears query across reopen", async () => {
  const { result, rerender } = renderHook(useUnifiedSearch, {
    initialProps: { ...initial, contextReady: false },
  });
  act(() => result.current.setQuery("latest"));
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(searchUnified).not.toHaveBeenCalled();
  rerender({ ...initial, contextReady: true, contextProjectId: "p" });
  await act(async () => {});
  expect(searchUnified).toHaveBeenLastCalledWith({ query: "latest", contextProjectId: "p" });
  rerender({ ...initial, open: false });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(result.current.query).toBe("");
  rerender(initial);
  await act(async () => {});
  expect(searchUnified).toHaveBeenLastCalledWith({ query: "", contextProjectId: null });
});
/** Ignore both success and error from superseded requests. */
it.each([false, true])("ignores old completion (reject=%s)", async (reject) => {
  const old = deferred();
  vi.mocked(searchUnified).mockReturnValueOnce(old.promise);
  const { result } = renderHook(() => useUnifiedSearch(initial));
  act(() => result.current.setQuery("new"));
  vi.mocked(searchUnified).mockResolvedValue(response("new"));
  await act(() => vi.advanceTimersByTimeAsync(120));
  await act(async () => {
    if (reject) old.reject(new Error("old"));
    else old.resolve(response("old"));
  });
  expect(result.current.response?.query).toBe("new");
  expect(result.current.error).toBeNull();
});
/** Suspend intermediate IME values and debounce the committed input. */
it("suspends IME", async () => {
  const { result } = renderHook(() => useUnifiedSearch(initial));
  await act(async () => {});
  act(() => {
    result.current.setComposing(true);
    result.current.setQuery("Vie");
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(searchUnified).toHaveBeenCalledTimes(1);
  act(() => {
    result.current.setQuery("Việt");
    result.current.setComposing(false);
  });
  await act(() => vi.advanceTimersByTimeAsync(120));
  expect(searchUnified).toHaveBeenCalledTimes(2);
});
/** A context failure retries globally only after explicit user input. */
it("keeps errors and retries invalid context globally", async () => {
  vi.mocked(searchUnified).mockRejectedValueOnce(
    new IpcCallError("search_unified", { code: "invalid_context_project_id" }),
  );
  const { result } = renderHook(() => useUnifiedSearch({ ...initial, contextProjectId: "bad" }));
  await act(async () => {});
  expect(result.current.status).toBe("error");
  expect(searchUnified).toHaveBeenCalledTimes(1);
  act(() => result.current.retry());
  await act(async () => {});
  expect(searchUnified).toHaveBeenLastCalledWith({ query: "", contextProjectId: null });
});
/** Refresh for native focus and snapshot replacement, without ordinary-render loops. */
it("refreshes focus and committed shortcut identity only", async () => {
  const { rerender } = renderHook(useUnifiedSearch, { initialProps: initial });
  await act(async () => {});
  rerender({ ...initial });
  expect(searchUnified).toHaveBeenCalledTimes(1);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(searchUnified).toHaveBeenCalledTimes(2);
  rerender({ ...initial, refreshKey: 1 });
  await act(async () => {});
  expect(searchUnified).toHaveBeenCalledTimes(3);
});
/** Replay mounts and late completions cannot overwrite the active snapshot. */
it("survives StrictMode and unmount", async () => {
  const old = deferred();
  vi.mocked(searchUnified).mockReturnValueOnce(old.promise);
  const { result, unmount } = renderHook(() => useUnifiedSearch(initial), {
    reactStrictMode: true,
  });
  await act(async () => {});
  expect(searchUnified).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe("ready");
  unmount();
  await act(async () => old.resolve(response("old")));
});
