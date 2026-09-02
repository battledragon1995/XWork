import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuitRequestDto } from "@/bindings/app-lifecycle";
import { cancelQuit, confirmQuit, requestQuit } from "@/lib/ipc/app-lifecycle";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { resetQuitStore, useQuitStore } from "./quit-store";

// Replace the lifecycle boundary so no test reaches the real backend.
vi.mock("@/lib/ipc/app-lifecycle", () => ({
  requestQuit: vi.fn(),
  cancelQuit: vi.fn(),
  confirmQuit: vi.fn(),
}));

const requestQuitMock = vi.mocked(requestQuit);
const cancelQuitMock = vi.mocked(cancelQuit);
const confirmQuitMock = vi.mocked(confirmQuit);

// A representative pending request used wherever the exact numbers do not matter.
const REQUEST: QuitRequestDto = {
  requestId: 7,
  summary: { sessionCount: 4, projectCount: 3, runningProcessCount: 3, unsavedFileCount: 1 },
};

// Build a rejection shaped exactly like the wrapper produces for a tagged backend error.
function lifecycleError(command: string, code: string) {
  return new IpcCallError(command, { code });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetQuitStore();
});

describe("startQuit", () => {
  // Verify a runtime with nothing running exits without ever opening a dialog.
  it("returns to idle when the backend exits immediately", async () => {
    requestQuitMock.mockResolvedValue(null);

    await useQuitStore.getState().startQuit();

    expect(useQuitStore.getState().phase).toBe("idle");
    expect(useQuitStore.getState().request).toBeNull();
  });

  // Verify a pending request moves the flow to the confirmation step with its own numbers.
  it("awaits confirmation when the backend returns a pending request", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);

    await useQuitStore.getState().startQuit();

    expect(useQuitStore.getState().phase).toBe("awaiting-confirmation");
    expect(useQuitStore.getState().request).toEqual(REQUEST);
  });

  // Verify a failed snapshot opens the error-only dialog instead of guessing at numbers.
  it("enters the snapshot failure state", async () => {
    requestQuitMock.mockRejectedValue(lifecycleError("request_quit", "runtime_snapshot_failed"));

    await useQuitStore.getState().startQuit();

    expect(useQuitStore.getState().phase).toBe("snapshot-failed");
    expect(useQuitStore.getState().failure).toEqual({
      stage: "snapshot",
      code: "runtime_snapshot_failed",
    });
  });

  // Verify a quit already under way keeps the quitting state rather than opening a second flow.
  it("keeps the quitting state when a quit is already in progress", async () => {
    requestQuitMock.mockRejectedValue(lifecycleError("request_quit", "quit_already_in_progress"));

    await useQuitStore.getState().startQuit();

    expect(useQuitStore.getState().phase).toBe("confirming");
  });

  // Verify every non-recoverable code becomes the same integration state, with no dialog left.
  it.each(["unauthorized_window", "invalid_window", "state_lock_poisoned", "invalid_request_id"])(
    "treats %s as an integration failure",
    async (code) => {
      requestQuitMock.mockRejectedValue(lifecycleError("request_quit", code));

      await useQuitStore.getState().startQuit();

      expect(useQuitStore.getState().phase).toBe("integration-failed");
      expect(useQuitStore.getState().request).toBeNull();
      expect(useQuitStore.getState().failure).toEqual({ stage: "integration", code });
    },
  );

  // Verify a rejection the wrapper could not tag is also handled as an integration failure.
  it("treats an unrecognized rejection as an integration failure", async () => {
    requestQuitMock.mockRejectedValue(new IpcCallError("request_quit", null));

    await useQuitStore.getState().startQuit();

    expect(useQuitStore.getState().phase).toBe("integration-failed");
    expect(useQuitStore.getState().failure).toEqual({ stage: "integration", code: "unknown" });
  });

  // Verify a second start while the first is still running cannot open a second request.
  it("ignores a second start while the first is still running", async () => {
    let release: ((value: QuitRequestDto | null) => void) | undefined;
    requestQuitMock.mockReturnValue(
      new Promise<QuitRequestDto | null>((resolve) => {
        release = resolve;
      }),
    );

    const first = useQuitStore.getState().startQuit();
    const second = useQuitStore.getState().startQuit();
    release?.(REQUEST);
    await Promise.all([first, second]);

    expect(requestQuitMock).toHaveBeenCalledOnce();
  });
});

describe("receiveTrayRequest", () => {
  // Verify a repeated identifier leaves the open dialog and its focus untouched.
  it("ignores a request that repeats the open identifier", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    await useQuitStore.getState().startQuit();

    useQuitStore
      .getState()
      .receiveTrayRequest({ ...REQUEST, summary: { ...REQUEST.summary, sessionCount: 99 } });

    expect(useQuitStore.getState().request?.summary.sessionCount).toBe(4);
  });

  // Verify a different identifier replaces the numbers on display.
  it("replaces the request when the identifier differs", () => {
    const next: QuitRequestDto = {
      requestId: 8,
      summary: { sessionCount: 1, projectCount: 1, runningProcessCount: 0, unsavedFileCount: 0 },
    };

    useQuitStore.getState().receiveTrayRequest(next);

    expect(useQuitStore.getState().phase).toBe("awaiting-confirmation");
    expect(useQuitStore.getState().request).toEqual(next);
  });
});

describe("cancelQuit", () => {
  // Verify Cancel drops the pending request with the identifier the backend handed out.
  it("cancels the open request and returns to idle", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    cancelQuitMock.mockResolvedValue(undefined);
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().cancelQuit();

    expect(cancelQuitMock).toHaveBeenCalledExactlyOnceWith(7);
    expect(useQuitStore.getState().phase).toBe("idle");
    expect(useQuitStore.getState().request).toBeNull();
  });

  // Verify a request the backend already dropped is not reported as an error.
  it("treats a stale request as a completed cancellation", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    cancelQuitMock.mockRejectedValue(lifecycleError("cancel_quit", "stale_quit_request"));
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().cancelQuit();

    expect(useQuitStore.getState().phase).toBe("idle");
    expect(useQuitStore.getState().failure).toBeNull();
  });

  // Verify a cancel that races a confirm keeps the quitting state.
  it("keeps the quitting state when a quit is already in progress", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    cancelQuitMock.mockRejectedValue(lifecycleError("cancel_quit", "quit_already_in_progress"));
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().cancelQuit();

    expect(useQuitStore.getState().phase).toBe("confirming");
  });

  // Verify the snapshot-failure dialog can be dismissed even though it has no request.
  it("closes the snapshot failure dialog without calling the backend", async () => {
    requestQuitMock.mockRejectedValue(lifecycleError("request_quit", "runtime_snapshot_failed"));
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().cancelQuit();

    expect(cancelQuitMock).not.toHaveBeenCalled();
    expect(useQuitStore.getState().phase).toBe("idle");
  });

  // Verify the dialog stays locked once the user confirmed.
  it("does nothing while the quit is being confirmed", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    confirmQuitMock.mockReturnValue(new Promise<void>(() => {}));
    await useQuitStore.getState().startQuit();
    void useQuitStore.getState().confirmQuit();

    await useQuitStore.getState().cancelQuit();

    expect(cancelQuitMock).not.toHaveBeenCalled();
    expect(useQuitStore.getState().phase).toBe("confirming");
  });
});

describe("confirmQuit", () => {
  // Verify the flow locks before awaiting, so a fast double click sends only one confirm.
  it("sends exactly one confirm for two rapid clicks", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    let release: (() => void) | undefined;
    confirmQuitMock.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await useQuitStore.getState().startQuit();

    const first = useQuitStore.getState().confirmQuit();
    const second = useQuitStore.getState().confirmQuit();
    release?.();
    await Promise.all([first, second]);

    expect(confirmQuitMock).toHaveBeenCalledExactlyOnceWith(7);
  });

  // Verify a failed cleanup keeps the dialog and its numbers, and offers another attempt.
  it("keeps the dialog open when the runtime could not be stopped", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    confirmQuitMock.mockRejectedValue(lifecycleError("confirm_quit", "runtime_shutdown_failed"));
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().confirmQuit();

    expect(useQuitStore.getState().phase).toBe("awaiting-confirmation");
    expect(useQuitStore.getState().request).toEqual(REQUEST);
    expect(useQuitStore.getState().failure).toEqual({
      stage: "shutdown",
      code: "runtime_shutdown_failed",
    });
  });

  // Verify a stale request is refreshed with exactly one new request_quit call.
  it("refreshes a stale request exactly once", async () => {
    const refreshed: QuitRequestDto = {
      requestId: 9,
      summary: { sessionCount: 2, projectCount: 1, runningProcessCount: 1, unsavedFileCount: 0 },
    };
    requestQuitMock.mockResolvedValueOnce(REQUEST).mockResolvedValueOnce(refreshed);
    confirmQuitMock.mockRejectedValue(lifecycleError("confirm_quit", "stale_quit_request"));
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().confirmQuit();

    expect(requestQuitMock).toHaveBeenCalledTimes(2);
    expect(useQuitStore.getState().phase).toBe("awaiting-confirmation");
    expect(useQuitStore.getState().request).toEqual(refreshed);
  });

  // Verify a stale request whose refresh reports nothing left simply closes the flow.
  it("closes the flow when the refreshed request is empty", async () => {
    requestQuitMock.mockResolvedValueOnce(REQUEST).mockResolvedValueOnce(null);
    confirmQuitMock.mockRejectedValue(lifecycleError("confirm_quit", "stale_quit_request"));
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().confirmQuit();

    expect(useQuitStore.getState().phase).toBe("idle");
    expect(useQuitStore.getState().request).toBeNull();
  });

  // Verify a confirm that races another quit keeps a single quitting state.
  it("keeps the quitting state when a quit is already in progress", async () => {
    requestQuitMock.mockResolvedValue(REQUEST);
    confirmQuitMock.mockRejectedValue(lifecycleError("confirm_quit", "quit_already_in_progress"));
    await useQuitStore.getState().startQuit();

    await useQuitStore.getState().confirmQuit();

    expect(useQuitStore.getState().phase).toBe("confirming");
  });

  // Verify every non-recoverable code closes the dialog and reports one integration failure.
  it.each(["invalid_request_id", "unauthorized_window", "state_lock_poisoned"])(
    "treats %s as an integration failure",
    async (code) => {
      requestQuitMock.mockResolvedValue(REQUEST);
      confirmQuitMock.mockRejectedValue(lifecycleError("confirm_quit", code));
      await useQuitStore.getState().startQuit();

      await useQuitStore.getState().confirmQuit();

      expect(useQuitStore.getState().phase).toBe("integration-failed");
      expect(useQuitStore.getState().request).toBeNull();
    },
  );

  // Verify confirming is impossible while there is nothing to confirm.
  it("does nothing without a pending request", async () => {
    await useQuitStore.getState().confirmQuit();

    expect(confirmQuitMock).not.toHaveBeenCalled();
    expect(useQuitStore.getState().phase).toBe("idle");
  });
});
