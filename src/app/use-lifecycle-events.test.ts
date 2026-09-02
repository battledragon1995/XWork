// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuitRequestDto, SessionNavigationDto } from "@/bindings/app-lifecycle";
import { onNavigateSession, onQuitRequested } from "@/lib/ipc/app-lifecycle";
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

    emitNavigateSession({ sessionId: "9f3a-B7 c" });

    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/sessions/9f3a-B7 c");
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
