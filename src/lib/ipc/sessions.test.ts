import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloseImpactDto,
  CloseResultDto,
  CloseTargetDto,
  SessionDetailDto,
  SessionRuntimeEventDto,
  SessionSummaryDto,
  SessionsError,
} from "@/bindings/sessions/sessions";
import { IpcCallError } from "./ipc-error";
import {
  closeRuntimeTarget,
  createSession,
  getCloseImpact,
  getSession,
  listSessions,
  onSessionsRuntimeChanged,
  renameSession,
  selectSessionTool,
  setObservedSession,
} from "./sessions";

// Replace the desktop boundary so no adapter case reaches the real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

/** One summary used wherever the exact session contents do not matter. */
const SUMMARY: SessionSummaryDto = {
  id: "s1",
  projectId: "p1",
  name: "New Session",
  status: "noToolYet",
  runningProcessCount: 0,
  tabCount: 0,
};

/** One detail snapshot, which every mutation command answers with. */
const DETAIL: SessionDetailDto = {
  summary: SUMMARY,
  tabs: [],
  activeTabId: null,
  canReopenLastClosedTab: false,
  revision: "12",
};

/** The only close target FE-006 ever sends. */
const TARGET: CloseTargetDto = { kind: "session", sessionId: "s1" };

/** One impact snapshot with both blocker families present. */
const IMPACT: CloseImpactDto = {
  target: TARGET,
  requiresConfirmation: true,
  runningProcessCount: 1,
  runningProcessLabels: ["claude"],
  unsavedFileCount: 0,
  unsavedFileLabels: [],
};

/** One close result, which reports the surviving snapshot or `null` for a whole session. */
const CLOSE_RESULT: CloseResultDto = { target: TARGET, session: null };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Sessions command wrappers", () => {
  // Verify the unfiltered list omits the optional argument object entirely, so the backend
  // applies its own default instead of receiving an explicit `undefined` project filter.
  it("calls list_sessions without arguments when no project is given", async () => {
    invokeMock.mockResolvedValue([SUMMARY]);

    await expect(listSessions()).resolves.toEqual([SUMMARY]);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("list_sessions", undefined);
  });

  // Verify a project-scoped list sends the camelCase name Tauri maps to `project_id`.
  it("calls list_sessions with a project id", async () => {
    invokeMock.mockResolvedValue([]);

    await expect(listSessions("p1")).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("list_sessions", { projectId: "p1" });
  });

  // Verify the detail read uses its exact command name and returns the DTO unchanged.
  it("calls get_session with a session id", async () => {
    invokeMock.mockResolvedValue(DETAIL);

    await expect(getSession("s1")).resolves.toBe(DETAIL);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("get_session", { sessionId: "s1" });
  });

  // Verify creation sends only the project id and answers with a full snapshot.
  it("calls create_session with a project id", async () => {
    invokeMock.mockResolvedValue(DETAIL);

    await expect(createSession("p1")).resolves.toBe(DETAIL);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("create_session", { projectId: "p1" });
  });

  // Verify rename forwards the typed name verbatim, without trimming it a second time.
  it("calls rename_session with a session id and the name as given", async () => {
    invokeMock.mockResolvedValue(DETAIL);

    await expect(renameSession("s1", "  Padded name  ")).resolves.toBe(DETAIL);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("rename_session", {
      sessionId: "s1",
      name: "  Padded name  ",
    });
  });

  // Verify tool selection sends both identifiers as separate camelCase fields.
  it("calls select_session_tool with a session id and a profile id", async () => {
    invokeMock.mockResolvedValue(DETAIL);

    await expect(selectSessionTool("s1", "builtin:codex")).resolves.toBe(DETAIL);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("select_session_tool", {
      sessionId: "s1",
      profileId: "builtin:codex",
    });
  });

  // Verify the impact read wraps the whole target in the single `target` field.
  it("calls get_close_impact with a close target", async () => {
    invokeMock.mockResolvedValue(IMPACT);

    await expect(getCloseImpact(TARGET)).resolves.toBe(IMPACT);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("get_close_impact", { target: TARGET });
  });

  // Verify the destructive command forwards the confirmation flag as given.
  it("calls close_runtime_target with a target and the confirmation flag", async () => {
    invokeMock.mockResolvedValue(CLOSE_RESULT);

    await expect(closeRuntimeTarget(TARGET, true)).resolves.toBe(CLOSE_RESULT);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("close_runtime_target", {
      target: TARGET,
      confirmed: true,
    });
  });

  // Verify observing a session sends the identifier under its camelCase name.
  it("calls set_observed_session with a session id", async () => {
    invokeMock.mockResolvedValue(SUMMARY);

    await expect(setObservedSession("s1")).resolves.toBe(SUMMARY);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("set_observed_session", {
      sessionId: "s1",
    });
  });

  // Verify clearing observation sends an explicit `null`, not an omitted field: the backend
  // has to be told that nothing is observed rather than being left with its previous value.
  it("calls set_observed_session with an explicit null", async () => {
    invokeMock.mockResolvedValue(null);

    await expect(setObservedSession(null)).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("set_observed_session", {
      sessionId: null,
    });
  });
});

describe("Sessions error normalization", () => {
  // Verify every generated code survives the boundary for feature-level classification.
  it.each<SessionsError["code"]>([
    "unauthorizedWindow",
    "projectNotFound",
    "projectUnavailable",
    "projectLookupFailed",
    "profileNotFound",
    "profileUnavailable",
    "profileLookupFailed",
    "sessionNotFound",
    "tabNotFound",
    "paneNotFound",
    "splitNotFound",
    "invalidName",
    "invalidMove",
    "invalidSplitRatio",
    "paneLimitReached",
    "sessionNotEmpty",
    "paneNotEmpty",
    "noClosedTab",
    "confirmationRequired",
    "closeInProgress",
    "contentLifecycleFailed",
    "runtimeShuttingDown",
  ])("preserves the tagged %s error", async (code) => {
    invokeMock.mockRejectedValue({ code });

    await expect(getSession("s1")).rejects.toMatchObject({
      command: "get_session",
      payload: { code },
    });
  });

  // Verify a payload-carrying error keeps the fields the dialogs read back.
  it("preserves the impact carried by confirmationRequired", async () => {
    invokeMock.mockRejectedValue({ code: "confirmationRequired", impact: IMPACT });

    const error = await closeRuntimeTarget(TARGET, true).catch((thrown: unknown) => thrown);

    expect((error as IpcCallError<SessionsError>).payload).toEqual({
      code: "confirmationRequired",
      impact: IMPACT,
    });
  });

  // Verify a rejection that is not shaped like `{ code }` can never be mistaken for one.
  it.each([
    ["a string rejection", "denied"],
    ["a null rejection", null],
    ["an object without a code", { message: "boom" }],
    ["an object whose code is not a string", { code: 7 }],
  ])("normalizes %s to a null payload", async (_label, rejection) => {
    invokeMock.mockRejectedValue(rejection);

    const error = await createSession("p1").catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IpcCallError);
    expect((error as IpcCallError<SessionsError>).payload).toBeNull();
    expect((error as IpcCallError<SessionsError>).command).toBe("create_session");
  });

  // Verify every command name reaches the shared error boundary, so no wrapper hides its source.
  it.each([
    ["list_sessions", () => listSessions("p1")],
    ["rename_session", () => renameSession("s1", "Name")],
    ["select_session_tool", () => selectSessionTool("s1", "builtin:codex")],
    ["get_close_impact", () => getCloseImpact(TARGET)],
    ["close_runtime_target", () => closeRuntimeTarget(TARGET, false)],
    ["set_observed_session", () => setObservedSession(null)],
  ])("names %s on its rejection", async (command, call) => {
    invokeMock.mockRejectedValue({ code: "runtimeShuttingDown" });

    await expect(call()).rejects.toMatchObject({
      command,
      payload: { code: "runtimeShuttingDown" },
    });
  });
});

describe("Sessions runtime event", () => {
  // Verify the subscription uses the exact event name and hands the caller only the payload.
  it("subscribes to sessions://runtime-changed and unwraps the payload", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const payload: SessionRuntimeEventDto = {
      revision: "13",
      change: "created",
      projectId: "p1",
      sessionId: "s1",
      summary: SUMMARY,
    };

    const returned = await onSessionsRuntimeChanged(handler);

    expect(listenMock.mock.calls[0]?.[0]).toBe("sessions://runtime-changed");
    expect(returned).toBe(unlisten);

    const forward = listenMock.mock.calls[0]?.[1] as (event: {
      payload: SessionRuntimeEventDto;
    }) => void;
    forward({ payload });

    expect(handler).toHaveBeenCalledExactlyOnceWith(payload);
  });

  // Verify a refused registration reaches the caller instead of being swallowed here.
  it("propagates a failed listener registration", async () => {
    listenMock.mockRejectedValue(new Error("registration refused"));

    await expect(onSessionsRuntimeChanged(vi.fn())).rejects.toThrow("registration refused");
  });
});
