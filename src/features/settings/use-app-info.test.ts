import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAppInfo } from "@/lib/ipc/app-info";
import { useAppInfo } from "./use-app-info";

vi.mock("@/lib/ipc/app-info", () => ({ readAppInfo: vi.fn() }));

const readAppInfoMock = vi.mocked(readAppInfo);
const APP_INFO = {
  appVersion: "0.0.0",
  osPlatform: "windows",
  osVersion: "11",
  osArch: "x86_64",
};

/** Create one promise controlled by a hook lifecycle test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useAppInfo", () => {
  // Clear adapter behavior before each isolated hook render.
  beforeEach(() => {
    readAppInfoMock.mockReset();
  });

  // Unmount any hook still active after its assertion.
  afterEach(() => {
    cleanup();
  });

  // Verify the hook starts loading immediately and publishes one atomic result.
  it("loads one complete app-info value", async () => {
    const pending = deferred<typeof APP_INFO>();
    readAppInfoMock.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAppInfo());

    expect(result.current).toMatchObject({ status: "loading", info: null });
    expect(readAppInfoMock).toHaveBeenCalledOnce();

    await act(async () => pending.resolve(APP_INFO));
    expect(result.current).toMatchObject({ status: "ready", info: APP_INFO });
  });

  // Verify a failed source produces no partial app information.
  it("publishes an all-or-nothing error", async () => {
    readAppInfoMock.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useAppInfo());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.info).toBeNull();
  });

  // Verify reload returns to loading, starts once, and ignores repeats while pending.
  it("deduplicates repeated reloads", async () => {
    readAppInfoMock.mockRejectedValueOnce(new Error("denied"));
    const pending = deferred<typeof APP_INFO>();
    readAppInfoMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useAppInfo());
    await waitFor(() => expect(result.current.status).toBe("error"));

    act(() => {
      result.current.reload();
      result.current.reload();
    });
    expect(result.current.status).toBe("loading");
    expect(readAppInfoMock).toHaveBeenCalledTimes(2);

    await act(async () => pending.resolve(APP_INFO));
    expect(result.current.status).toBe("ready");
  });

  // Verify a response from an obsolete mount cannot affect the newly mounted reader.
  it("ignores a stale completion after a remount", async () => {
    const stale = deferred<typeof APP_INFO>();
    const current = deferred<typeof APP_INFO>();
    readAppInfoMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);
    const first = renderHook(() => useAppInfo());
    first.unmount();
    const second = renderHook(() => useAppInfo());

    expect(readAppInfoMock).toHaveBeenCalledTimes(2);
    await act(async () => stale.resolve({ ...APP_INFO, appVersion: "stale" }));
    expect(second.result.current.status).toBe("loading");

    await act(async () => current.resolve(APP_INFO));
    expect(second.result.current).toMatchObject({ status: "ready", info: APP_INFO });
  });

  // Verify a successful late completion is ignored after unmount.
  it("ignores success after unmount", async () => {
    const pending = deferred<typeof APP_INFO>();
    readAppInfoMock.mockReturnValue(pending.promise);
    const { unmount } = renderHook(() => useAppInfo());

    unmount();
    await act(async () => pending.resolve(APP_INFO));
    expect(readAppInfoMock).toHaveBeenCalledOnce();
  });

  // Verify a rejected late completion is also consumed safely after unmount.
  it("ignores rejection after unmount", async () => {
    const pending = deferred<typeof APP_INFO>();
    readAppInfoMock.mockReturnValue(pending.promise);
    const { unmount } = renderHook(() => useAppInfo());

    unmount();
    await act(async () => pending.reject(new Error("late")));
    expect(readAppInfoMock).toHaveBeenCalledOnce();
  });
});
