import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDetailDto } from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as sessionsIpc from "@/lib/ipc/sessions";
import {
  createCloseImpact,
  createSessionDetail,
  FIXTURE_SESSION_ID,
} from "./sessions-test-fixture";
import { useSessionLifecycle } from "./use-session-lifecycle";

// Replace the mutating boundary so no case reaches Tauri.
vi.mock("@/lib/ipc/sessions", () => ({
  closeRuntimeTarget: vi.fn(),
  getCloseImpact: vi.fn(),
  renameSession: vi.fn(),
}));

const renameSessionMock = vi.mocked(sessionsIpc.renameSession);
const getCloseImpactMock = vi.mocked(sessionsIpc.getCloseImpact);
const closeRuntimeTargetMock = vi.mocked(sessionsIpc.closeRuntimeTarget);

/** The only close target the route ever builds. */
const TARGET = { kind: "session", sessionId: FIXTURE_SESSION_ID } as const;

/** Build one promise a case settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  renameSessionMock.mockResolvedValue(createSessionDetail());
  getCloseImpactMock.mockResolvedValue(createCloseImpact());
  closeRuntimeTargetMock.mockResolvedValue({ target: TARGET, session: null });
});

afterEach(() => {
  cleanup();
});

describe("useSessionLifecycle rename", () => {
  // Verify a successful rename sends the name and asks the dialog to close.
  it("renames and asks the dialog to close", async () => {
    const view = renderHook(() => useSessionLifecycle());

    let closed = false;
    await act(async () => {
      closed = await view.result.current.rename(FIXTURE_SESSION_ID, "Renamed");
    });

    expect(renameSessionMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_SESSION_ID, "Renamed");
    expect(closed).toBe(true);
    expect(view.result.current.pending).toBeNull();
    expect(view.result.current.failure).toBeNull();
  });

  // Verify the pending marker is published while the command is in flight, which is what
  // locks the dialog's own controls.
  it("publishes its pending operation", async () => {
    const pending = deferred<SessionDetailDto>();
    renameSessionMock.mockReturnValue(pending.promise);
    const view = renderHook(() => useSessionLifecycle());

    act(() => {
      void view.result.current.rename(FIXTURE_SESSION_ID, "Renamed");
    });

    await vi.waitFor(() => expect(view.result.current.pending).toBe("rename"));

    await act(async () => {
      pending.resolve(createSessionDetail());
      await pending.promise;
    });
    expect(view.result.current.pending).toBeNull();
  });

  // Verify a refused name keeps the dialog open with the exact rule to fix it.
  it("keeps the dialog open for an invalid name", async () => {
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", { code: "invalidName" }),
    );
    const view = renderHook(() => useSessionLifecycle());

    let closed = true;
    await act(async () => {
      closed = await view.result.current.rename(FIXTURE_SESSION_ID, "x");
    });

    expect(closed).toBe(false);
    expect(view.result.current.failure).toMatchObject({
      kind: "invalidName",
      message: "Use 1 to 80 characters without control characters.",
    });
  });

  // Verify a closing session reports that fact rather than a generic failure.
  it("reports a closing session", async () => {
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", {
        code: "closeInProgress",
        sessionId: FIXTURE_SESSION_ID,
      }),
    );
    const view = renderHook(() => useSessionLifecycle());

    await act(async () => {
      await view.result.current.rename(FIXTURE_SESSION_ID, "Renamed");
    });

    expect(view.result.current.failure?.message).toBe("This session is closing.");
  });

  // Verify both moot outcomes close the dialog with no error of their own.
  it.each([
    ["a gone session", { code: "sessionNotFound", sessionId: FIXTURE_SESSION_ID }],
    ["a shutting-down runtime", { code: "runtimeShuttingDown" }],
  ])("closes the dialog silently for %s", async (_label, payload) => {
    renameSessionMock.mockRejectedValue(new IpcCallError("rename_session", payload as never));
    const view = renderHook(() => useSessionLifecycle());

    let closed = false;
    await act(async () => {
      closed = await view.result.current.rename(FIXTURE_SESSION_ID, "Renamed");
    });

    expect(closed).toBe(true);
    expect(view.result.current.failure).toBeNull();
  });
});

describe("useSessionLifecycle inspect", () => {
  // Verify the confirmation is always preceded by one impact read of the exact target.
  it("reads the impact for the session target", async () => {
    const view = renderHook(() => useSessionLifecycle());

    let canOpen = false;
    await act(async () => {
      canOpen = await view.result.current.inspect(FIXTURE_SESSION_ID);
    });

    expect(getCloseImpactMock).toHaveBeenCalledExactlyOnceWith(TARGET);
    expect(canOpen).toBe(true);
    expect(view.result.current.impact).not.toBeNull();
  });

  // Verify a session that vanished abandons the flow instead of opening a confirmation.
  it("abandons the flow when the session is gone", async () => {
    getCloseImpactMock.mockRejectedValue(
      new IpcCallError("get_close_impact", {
        code: "sessionNotFound",
        sessionId: FIXTURE_SESSION_ID,
      }),
    );
    const view = renderHook(() => useSessionLifecycle());

    let canOpen = true;
    await act(async () => {
      canOpen = await view.result.current.inspect(FIXTURE_SESSION_ID);
    });

    expect(canOpen).toBe(false);
    expect(view.result.current.impact).toBeNull();
  });

  // Verify a failed impact read still opens the confirmation, with its own retryable copy.
  it("opens the confirmation with a retryable impact failure", async () => {
    getCloseImpactMock.mockRejectedValue(
      new IpcCallError("get_close_impact", {
        code: "contentLifecycleFailed",
        operation: "inspect",
        targetId: FIXTURE_SESSION_ID,
      }),
    );
    const view = renderHook(() => useSessionLifecycle());

    let canOpen = false;
    await act(async () => {
      canOpen = await view.result.current.inspect(FIXTURE_SESSION_ID);
    });

    expect(canOpen).toBe(true);
    expect(view.result.current.impact).toBeNull();
    expect(view.result.current.failure?.message).toBe(
      "XWork couldn't check what this session is running.",
    );
  });

  // Verify a confirmation with no blocker at all still opens: deleting a session always asks.
  it("opens the confirmation for an impact with no blocker", async () => {
    getCloseImpactMock.mockResolvedValue(createCloseImpact({ requiresConfirmation: false }));
    const view = renderHook(() => useSessionLifecycle());

    let canOpen = false;
    await act(async () => {
      canOpen = await view.result.current.inspect(FIXTURE_SESSION_ID);
    });

    expect(canOpen).toBe(true);
  });
});

describe("useSessionLifecycle delete", () => {
  // Verify the confirmed close is sent with the flag the backend requires.
  it("closes the session with an explicit confirmation", async () => {
    const view = renderHook(() => useSessionLifecycle());

    let closed = false;
    await act(async () => {
      closed = await view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    });

    expect(closeRuntimeTargetMock).toHaveBeenCalledExactlyOnceWith(TARGET, true);
    expect(closed).toBe(true);
  });

  // Verify a blocker that appeared at commit time replaces the facts and demands another
  // explicit confirmation rather than closing anything.
  it("re-asks with the refreshed impact after confirmationRequired", async () => {
    const refreshed = createCloseImpact({
      runningProcessCount: 2,
      runningProcessLabels: ["claude", "pnpm test"],
    });
    closeRuntimeTargetMock.mockRejectedValueOnce(
      new IpcCallError("close_runtime_target", {
        code: "confirmationRequired",
        impact: refreshed,
      }),
    );
    const view = renderHook(() => useSessionLifecycle());

    let closed = true;
    await act(async () => {
      closed = await view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    });

    expect(closed).toBe(false);
    expect(view.result.current.impact).toEqual(refreshed);
    expect(view.result.current.failure?.code).toBe("confirmationRequired");

    await act(async () => {
      closed = await view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    });

    expect(closed).toBe(true);
    expect(closeRuntimeTargetMock).toHaveBeenCalledTimes(2);
  });

  // Verify a cleanup failure keeps the dialog open with the facts the user already agreed to,
  // which is safe because BE-005 guarantees the close is idempotent.
  it("keeps the dialog and its facts after a cleanup failure", async () => {
    const view = renderHook(() => useSessionLifecycle());
    await act(async () => {
      await view.result.current.inspect(FIXTURE_SESSION_ID);
    });

    closeRuntimeTargetMock.mockRejectedValue(
      new IpcCallError("close_runtime_target", {
        code: "contentLifecycleFailed",
        operation: "close",
        targetId: FIXTURE_SESSION_ID,
      }),
    );

    let closed = true;
    await act(async () => {
      closed = await view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    });

    expect(closed).toBe(false);
    expect(view.result.current.impact).not.toBeNull();
    expect(view.result.current.failure).toMatchObject({
      message: "XWork couldn't stop everything in this session.",
      canRetry: true,
    });
  });

  // Verify both moot outcomes are treated as the deletion the user asked for.
  it.each([
    ["an already deleted session", { code: "sessionNotFound", sessionId: FIXTURE_SESSION_ID }],
    ["a shutting-down runtime", { code: "runtimeShuttingDown" }],
  ])("treats %s as deleted", async (_label, payload) => {
    closeRuntimeTargetMock.mockRejectedValue(
      new IpcCallError("close_runtime_target", payload as never),
    );
    const view = renderHook(() => useSessionLifecycle());

    let closed = false;
    await act(async () => {
      closed = await view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    });

    expect(closed).toBe(true);
    expect(view.result.current.failure).toBeNull();
  });

  // Verify a close already running is reported without a second command.
  it("reports a close already in progress", async () => {
    closeRuntimeTargetMock.mockRejectedValue(
      new IpcCallError("close_runtime_target", {
        code: "closeInProgress",
        sessionId: FIXTURE_SESSION_ID,
      }),
    );
    const view = renderHook(() => useSessionLifecycle());

    await act(async () => {
      await view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    });

    expect(view.result.current.failure?.code).toBe("closeInProgress");
  });
});

describe("useSessionLifecycle single slot", () => {
  // Verify a second mutation cannot start while one is in flight, so no duplicate command is
  // ever sent by two rapid activations.
  it.each<["rename" | "inspect" | "delete", () => void]>([
    ["rename", () => {}],
    ["inspect", () => {}],
    ["delete", () => {}],
  ])("suppresses a second %s", async (operation) => {
    const pending = deferred<never>();
    renameSessionMock.mockReturnValue(pending.promise);
    getCloseImpactMock.mockReturnValue(pending.promise);
    closeRuntimeTargetMock.mockReturnValue(pending.promise);
    const view = renderHook(() => useSessionLifecycle());

    /** Start whichever mutation this case is about. */
    const start = (): Promise<boolean> => {
      if (operation === "rename") {
        return view.result.current.rename(FIXTURE_SESSION_ID, "Renamed");
      }
      if (operation === "inspect") {
        return view.result.current.inspect(FIXTURE_SESSION_ID);
      }
      return view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    };

    act(() => {
      void start();
    });
    await vi.waitFor(() => expect(view.result.current.pending).toBe(operation));

    let second = true;
    await act(async () => {
      second = await start();
    });

    expect(second).toBe(false);
    expect(
      renameSessionMock.mock.calls.length +
        getCloseImpactMock.mock.calls.length +
        closeRuntimeTargetMock.mock.calls.length,
    ).toBe(1);
  });

  // Verify two activations in the same tick still send exactly one command, which the state
  // update alone could not guarantee.
  it("suppresses a duplicate started in the same tick", async () => {
    const pending = deferred<never>();
    closeRuntimeTargetMock.mockReturnValue(pending.promise);
    const view = renderHook(() => useSessionLifecycle());

    await act(async () => {
      void view.result.current.confirmDelete(FIXTURE_SESSION_ID);
      void view.result.current.confirmDelete(FIXTURE_SESSION_ID);
    });

    expect(closeRuntimeTargetMock).toHaveBeenCalledOnce();
  });

  // Verify resetting drops every transient value the dialogs read.
  it("resets its state", async () => {
    const view = renderHook(() => useSessionLifecycle());
    await act(async () => {
      await view.result.current.inspect(FIXTURE_SESSION_ID);
    });

    act(() => view.result.current.reset());

    expect(view.result.current).toMatchObject({
      pending: null,
      impact: null,
      failure: null,
    });
  });
});
