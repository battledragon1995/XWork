import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuitRequestDto, SessionNavigationDto } from "@/bindings/app-lifecycle";
import {
  cancelQuit,
  confirmQuit,
  hideMainWindow,
  minimizeMainWindow,
  onNavigateSession,
  onQuitRequested,
  requestQuit,
  toggleMainWindowMaximized,
} from "./app-lifecycle";
import { IpcCallError } from "./ipc-error";

// Replace the desktop boundary so no test reaches the real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

// A representative pending request used wherever the exact numbers do not matter.
const REQUEST: QuitRequestDto = {
  requestId: 7,
  summary: { sessionCount: 4, projectCount: 3, runningProcessCount: 3, unsavedFileCount: 1 },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("lifecycle command wrappers", () => {
  // Verify the window commands use the exact backend names and take no arguments.
  it.each([
    [hideMainWindow, "hide_main_window"],
    [minimizeMainWindow, "minimize_main_window"],
  ])("calls %s without arguments", async (wrapper, command) => {
    invokeMock.mockResolvedValue(undefined);

    await wrapper();

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, undefined);
  });

  // Verify the maximize toggle propagates the native state the backend returns.
  it("returns the maximized state reported by the backend", async () => {
    invokeMock.mockResolvedValue(true);

    await expect(toggleMainWindowMaximized()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("toggle_main_window_maximized", undefined);
  });

  // Verify an immediate exit is reported to the caller as a null request.
  it("propagates a null quit request", async () => {
    invokeMock.mockResolvedValue(null);

    await expect(requestQuit()).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("request_quit", undefined);
  });

  // Verify a pending request is propagated unchanged, including its summary.
  it("propagates a pending quit request unchanged", async () => {
    invokeMock.mockResolvedValue(REQUEST);

    await expect(requestQuit()).resolves.toEqual(REQUEST);
  });

  // Verify both request-scoped commands send the identifier as camelCase `requestId`.
  it.each([
    [cancelQuit, "cancel_quit"],
    [confirmQuit, "confirm_quit"],
  ])("sends the request id to %s as camelCase", async (wrapper, command) => {
    invokeMock.mockResolvedValue(undefined);

    await wrapper(7);

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith(command, { requestId: 7 });
  });
});

describe("IPC error normalization", () => {
  // Verify a tagged backend error keeps its discriminated payload for the UI to branch on.
  it("preserves a tagged error payload", async () => {
    invokeMock.mockRejectedValue({ code: "window_operation_failed", operation: "minimize" });

    const error = await minimizeMainWindow().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IpcCallError);
    expect((error as IpcCallError<{ code: string }>).command).toBe("minimize_main_window");
    expect((error as IpcCallError<{ code: string }>).payload).toEqual({
      code: "window_operation_failed",
      operation: "minimize",
    });
  });

  // Verify a rejection that is not shaped like `{ code }` cannot be mistaken for one.
  it.each([
    ["a string rejection", "permission denied"],
    ["a null rejection", null],
    ["an object without a code", { message: "boom" }],
    ["an object whose code is not a string", { code: 42 }],
  ])("normalizes %s to a null payload", async (_label, rejection) => {
    invokeMock.mockRejectedValue(rejection);

    const error = await requestQuit().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IpcCallError);
    expect((error as IpcCallError<{ code: string }>).payload).toBeNull();
    expect((error as IpcCallError<{ code: string }>).command).toBe("request_quit");
  });
});

describe("lifecycle event subscriptions", () => {
  // Verify the quit event is subscribed by its exact name and delivers only the payload.
  it("subscribes to app-quit-requested and unwraps the payload", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();

    const returned = await onQuitRequested(handler);

    expect(listenMock.mock.calls[0]?.[0]).toBe("app-quit-requested");
    expect(returned).toBe(unlisten);

    const forward = listenMock.mock.calls[0]?.[1] as (event: { payload: QuitRequestDto }) => void;
    forward({ payload: REQUEST });

    expect(handler).toHaveBeenCalledExactlyOnceWith(REQUEST);
  });

  // Verify the navigation event is subscribed by its exact name and delivers only the payload.
  it("subscribes to app-navigate-session and unwraps the payload", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const target: SessionNavigationDto = { sessionId: "9f3a-B7 c" };

    const returned = await onNavigateSession(handler);

    expect(listenMock.mock.calls[0]?.[0]).toBe("app-navigate-session");
    expect(returned).toBe(unlisten);

    const forward = listenMock.mock.calls[0]?.[1] as (event: {
      payload: SessionNavigationDto;
    }) => void;
    forward({ payload: target });

    expect(handler).toHaveBeenCalledExactlyOnceWith(target);
  });
});
