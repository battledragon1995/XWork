import { IpcCallError } from "@/lib/ipc/ipc-error";
const maintenance = vi.hoisted(() => ({ value: null as DataManagementState | null }));
/** Inject the public Data snapshot to exercise epochs before React rerenders. */
vi.mock("@/features/settings/data-management-provider", () => ({
  useOptionalDataManagement: () => maintenance.value,
}));
import {
  createDataManagementState,
  type DataManagementState,
} from "@/features/settings/data-management-state";
import { getSession } from "@/lib/ipc/sessions";
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuitRequestDto, SessionNavigationDto } from "@/bindings/app-lifecycle";
import {
  cancelQuit,
  requestQuit,
  onNavigateSession,
  onQuitRequested,
} from "@/lib/ipc/app-lifecycle";
import { resetQuitStore, useQuitStore } from "./quit-store";
import { useLifecycleEvents } from "./use-lifecycle-events";

// Replace the lifecycle boundary and the router navigation the bridge depends on.
vi.mock("@/lib/ipc/app-lifecycle", () => ({
  onQuitRequested: vi.fn(),
  onNavigateSession: vi.fn(),
  requestQuit: vi.fn(),
  cancelQuit: vi.fn(),
  confirmQuit: vi.fn(),
}));

vi.mock("@/lib/ipc/sessions", () => ({ getSession: vi.fn() }));
const navigateMock = vi.fn();
vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));

const onQuitRequestedMock = vi.mocked(onQuitRequested);
const onNavigateSessionMock = vi.mocked(onNavigateSession);

const unlistenQuit = vi.fn();
const unlistenNavigate = vi.fn();

// Capture the handler each subscription registered, so tests can emit events directly.
let emitQuitRequested: (request: QuitRequestDto) => void;
let emitNavigateSession: (target: SessionNavigationDto) => void;

beforeEach(() => {
  maintenance.value = null;
  vi.clearAllMocks();
  resetQuitStore();

  onQuitRequestedMock.mockImplementation(async (handler) => {
    emitQuitRequested = handler;
    return unlistenQuit;
  });
  onNavigateSessionMock.mockImplementation(async (handler) => {
    emitNavigateSession = handler;
    return unlistenNavigate;
  });
});

afterEach(() => {
  cleanup();
});

describe("useLifecycleEvents", () => {
  // Verify each lifecycle event is subscribed exactly once per mounted bridge.
  it("registers both listeners exactly once", async () => {
    renderHook(() => {
      useLifecycleEvents();
    });

    await waitFor(() => {
      expect(onQuitRequestedMock).toHaveBeenCalledOnce();
    });
    expect(onNavigateSessionMock).toHaveBeenCalledOnce();
  });

  // Verify a tray quit request opens the shared dialog through the quit store.
  it("hands a tray quit request to the quit store", async () => {
    const request: QuitRequestDto = {
      requestId: 5,
      summary: { sessionCount: 2, projectCount: 1, runningProcessCount: 1, unsavedFileCount: 0 },
    };
    renderHook(() => {
      useLifecycleEvents();
    });
    await waitFor(() => {
      expect(onQuitRequestedMock).toHaveBeenCalledOnce();
    });

    emitQuitRequested(request);

    expect(useQuitStore.getState().request).toEqual(request);
    expect(useQuitStore.getState().phase).toBe("awaiting-confirmation");
  });

  // Verify a repeated identifier is ignored so the open dialog is never rebuilt.
  it("ignores a repeated quit request identifier", async () => {
    const request: QuitRequestDto = {
      requestId: 5,
      summary: { sessionCount: 2, projectCount: 1, runningProcessCount: 1, unsavedFileCount: 0 },
    };
    renderHook(() => {
      useLifecycleEvents();
    });
    await waitFor(() => {
      expect(onQuitRequestedMock).toHaveBeenCalledOnce();
    });

    emitQuitRequested(request);
    emitQuitRequested({ ...request, summary: { ...request.summary, sessionCount: 42 } });

    expect(useQuitStore.getState().request?.summary.sessionCount).toBe(2);
  });

  // Verify the session identifier reaches the route untouched, including reserved characters.
  it("navigates with the session identifier unchanged", async () => {
    renderHook(() => {
      useLifecycleEvents();
    });
    await waitFor(() => {
      expect(onNavigateSessionMock).toHaveBeenCalledOnce();
    });

    vi.mocked(getSession).mockResolvedValue({ summary: { id: "9f3a-B7 c" } } as Awaited<
      ReturnType<typeof getSession>
    >);
    emitNavigateSession({ sessionId: "9f3a-B7 c" });

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/sessions/9f3a-B7%20c"),
    );
  });

  // Verify both subscriptions are removed so a hot reload cannot leave duplicate handlers.
  it("removes both listeners on unmount", async () => {
    const view = renderHook(() => {
      useLifecycleEvents();
    });
    await waitFor(() => {
      expect(onNavigateSessionMock).toHaveBeenCalledOnce();
    });

    view.unmount();

    await waitFor(() => {
      expect(unlistenQuit).toHaveBeenCalledOnce();
    });
    expect(unlistenNavigate).toHaveBeenCalledOnce();
  });
});

/** Build a local maintenance owner with no native initialization. */
function dataOwner() {
  const owner = createDataManagementState({
    beforeConfirm: async () => () => {},
    onCommitted: async () => {},
    onResetUncertain: async () => {},
    refreshViews: async () => {},
  });
  maintenance.value = owner.getSnapshot();
  return owner;
}

/** A missing tray target after reset never navigates to a deleted session. */
it("ignores missing tray targets", async () => {
  dataOwner();
  vi.mocked(getSession).mockRejectedValueOnce(new Error("not found"));
  renderHook(useLifecycleEvents);
  emitNavigateSession({ sessionId: "deleted" });
  await Promise.resolve();
  expect(navigateMock).not.toHaveBeenCalled();
});
/** An epoch checked after getSession prevents stale tray navigation even without a rerender. */
it("retires tray lookups on reset", async () => {
  const owner = dataOwner();
  let resolve!: (value: Awaited<ReturnType<typeof getSession>>) => void;
  vi.mocked(getSession).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  renderHook(useLifecycleEvents);
  emitNavigateSession({ sessionId: "old" });
  await owner.getSnapshot().acceptCommitted("app_reset");
  resolve({ summary: { id: "old" } } as Awaited<ReturnType<typeof getSession>>);
  await Promise.resolve();
  expect(navigateMock).not.toHaveBeenCalled();
});
/** A queued tray request must be cancelled and its impact freshly requested after maintenance. */
it.each(["success", "stale", "unknown"])(
  "refreshes deferred tray Quit with %s cancellation",
  async (outcome) => {
    let finish!: () => void;
    const owner = createDataManagementState({
      beforeConfirm: async () => () => {},
      onCommitted: () =>
        new Promise<void>((yes) => {
          finish = yes;
        }),
      onResetUncertain: async () => {},
      refreshViews: async () => {},
    });
    const changing = owner.getSnapshot().acceptCommitted("app_reset");
    maintenance.value = owner.getSnapshot();
    const view = renderHook(useLifecycleEvents);
    const request = {
      requestId: 88,
      summary: { sessionCount: 3, projectCount: 1, runningProcessCount: 3, unsavedFileCount: 0 },
    };
    if (outcome === "stale")
      vi.mocked(cancelQuit).mockRejectedValueOnce(
        new IpcCallError("cancel_quit", { code: "stale_quit_request" }),
      );
    else if (outcome === "unknown") vi.mocked(cancelQuit).mockRejectedValueOnce(new Error("lost"));
    else vi.mocked(cancelQuit).mockResolvedValueOnce(undefined);
    vi.mocked(requestQuit).mockResolvedValueOnce(null);
    emitQuitRequested(request);
    expect(useQuitStore.getState().phase).toBe("idle");
    expect(cancelQuit).not.toHaveBeenCalled();
    await Promise.resolve();
    await act(async () => {
      finish();
      await changing;
    });
    maintenance.value = owner.getSnapshot();
    view.rerender();
    await waitFor(() => expect(cancelQuit).toHaveBeenCalledWith(88));
    if (outcome === "unknown") {
      expect(requestQuit).not.toHaveBeenCalled();
      expect(useQuitStore.getState().phase).toBe("integration-failed");
    } else {
      await waitFor(() => expect(requestQuit).toHaveBeenCalledOnce());
      expect(useQuitStore.getState().request).toBeNull();
    }
  },
);

/** Preview cancellation completes before the new Quit snapshot can open its dialog. */
it("retires a Data preview before requesting Quit", async () => {
  const owner = dataOwner();
  const preview: DataManagementState = {
    ...owner.getSnapshot(),
    phase: "preview",
    retirePreview: vi.fn(async () => {
      preview.phase = "idle";
    }),
    getCurrent: () => preview,
  };
  maintenance.value = preview;
  vi.mocked(requestQuit).mockClear().mockResolvedValueOnce(null);
  const view = renderHook(useLifecycleEvents);
  await act(() => view.result.current());
  expect(preview.retirePreview).toHaveBeenCalledOnce();
  expect(requestQuit).toHaveBeenCalledOnce();
  expect(vi.mocked(preview.retirePreview).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(requestQuit).mock.invocationCallOrder[0] ?? 0,
  );
});
