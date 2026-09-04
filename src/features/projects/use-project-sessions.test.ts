import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionDetailDto,
  SessionRuntimeEventDto,
  SessionSummaryDto,
} from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as sessionsIpc from "@/lib/ipc/sessions";
import { resetProjectSessions, useProjectSessions } from "./use-project-sessions";

// Replace the whole Sessions boundary so no case reaches Tauri or a real listener.
vi.mock("@/lib/ipc/sessions", () => ({
  closeRuntimeTarget: vi.fn(),
  createSession: vi.fn(),
  getCloseImpact: vi.fn(),
  listSessions: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(),
  renameSession: vi.fn(),
}));

const listSessionsMock = vi.mocked(sessionsIpc.listSessions);
const createSessionMock = vi.mocked(sessionsIpc.createSession);
const renameSessionMock = vi.mocked(sessionsIpc.renameSession);
const getCloseImpactMock = vi.mocked(sessionsIpc.getCloseImpact);
const closeRuntimeTargetMock = vi.mocked(sessionsIpc.closeRuntimeTarget);
const onRuntimeChangedMock = vi.mocked(sessionsIpc.onSessionsRuntimeChanged);

/** The project every case reads, plus one it must never mix in. */
const PROJECT_ID = "p1";
const OTHER_PROJECT_ID = "p2";

/** Build one summary of the project under test. */
function summary(overrides: Partial<SessionSummaryDto> = {}): SessionSummaryDto {
  return {
    id: "s1",
    projectId: PROJECT_ID,
    name: "New Session",
    status: "noToolYet",
    runningProcessCount: 0,
    tabCount: 0,
    ...overrides,
  };
}

/** Build one detail snapshot, of which the create flow keeps only the identifier. */
function detail(id = "s9"): SessionDetailDto {
  return {
    summary: summary({ id }),
    tabs: [],
    activeTabId: null,
    canReopenLastClosedTab: false,
    revision: "3",
  };
}

/** Build one committed runtime event. */
function event(overrides: Partial<SessionRuntimeEventDto>): SessionRuntimeEventDto {
  return {
    revision: "1",
    change: "created",
    projectId: PROJECT_ID,
    sessionId: "s1",
    summary: summary(),
    ...overrides,
  };
}

/** Build one promise a case settles by hand, so a race can be observed deterministically. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

/** Deliver one event exactly as the adapter would. */
function emit(runtimeEvent: SessionRuntimeEventDto): void {
  const handler = onRuntimeChangedMock.mock.calls.at(-1)?.[0];
  if (handler === undefined) {
    throw new Error("The hook should have registered a runtime-changed handler.");
  }
  act(() => handler(runtimeEvent));
}

/** Callbacks the route supplies, recorded per case. */
let onCreated: ReturnType<typeof vi.fn<(sessionId: string) => void>>;
let onProjectGone: ReturnType<typeof vi.fn<() => void>>;
let onProjectUnavailable: ReturnType<typeof vi.fn<() => void>>;

/** Mount the hook for one project with the route's callbacks attached. */
function mount(projectId = PROJECT_ID) {
  return renderHook(() =>
    useProjectSessions({ projectId, onCreated, onProjectGone, onProjectUnavailable }),
  );
}

/** Mount the hook and wait for its first read to settle. */
async function mountReady(projectId = PROJECT_ID) {
  const view = mount(projectId);
  await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectSessions();
  onCreated = vi.fn<(sessionId: string) => void>();
  onProjectGone = vi.fn<() => void>();
  onProjectUnavailable = vi.fn<() => void>();
  listSessionsMock.mockResolvedValue([]);
  onRuntimeChangedMock.mockResolvedValue(() => {});
  createSessionMock.mockResolvedValue(detail());
  renameSessionMock.mockResolvedValue(detail("s1"));
  closeRuntimeTargetMock.mockResolvedValue({
    target: { kind: "session", sessionId: "s1" },
    session: null,
  });
  getCloseImpactMock.mockResolvedValue({
    target: { kind: "session", sessionId: "s1" },
    requiresConfirmation: true,
    runningProcessCount: 0,
    runningProcessLabels: [],
    unsavedFileCount: 0,
    unsavedFileLabels: [],
  });
});

afterEach(() => {
  cleanup();
  resetProjectSessions();
});

describe("useProjectSessions reads", () => {
  // Verify the read is scoped to one project rather than filtered on the frontend.
  it("reads only this project's sessions", async () => {
    listSessionsMock.mockResolvedValue([summary()]);

    const view = await mountReady();

    expect(listSessionsMock).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(view.result.current.sessions).toHaveLength(1);
  });

  // Verify a failed first read reports the project-scoped copy with one more attempt.
  it("reports a failed first read with the list copy", async () => {
    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "projectLookupFailed" }),
    );

    const view = mount();

    await vi.waitFor(() => expect(view.result.current.status).toBe("error"));
    expect(view.result.current.failure).toMatchObject({
      message: "XWork couldn't load sessions for this project.",
      canRetry: true,
    });
  });

  // Verify a boundary failure is stated without a retry, so no loop can form.
  it("reports an unauthorized window without a retry", async () => {
    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "unauthorizedWindow" }),
    );

    const view = mount();

    await vi.waitFor(() => expect(view.result.current.status).toBe("error"));
    expect(view.result.current.failure?.canRetry).toBe(false);
  });

  // Verify the previous rows survive a later failed read.
  it("keeps its rows when a later read fails", async () => {
    listSessionsMock.mockResolvedValue([summary()]);
    const view = await mountReady();

    listSessionsMock.mockRejectedValue(
      new IpcCallError("list_sessions", { code: "projectLookupFailed" }),
    );
    act(() => view.result.current.refresh());

    await vi.waitFor(() => expect(view.result.current.failure).not.toBeNull());
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.sessions).toHaveLength(1);
  });

  // Verify a read that lost its race cannot roll the list back.
  it("drops a stale read in favour of the newer one", async () => {
    const slow = deferred<SessionSummaryDto[]>();
    listSessionsMock.mockReturnValueOnce(slow.promise);
    const view = mount();

    listSessionsMock.mockResolvedValue([summary({ id: "s2", name: "Newer" })]);
    act(() => view.result.current.refresh());
    await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));

    await act(async () => {
      slow.resolve([summary({ id: "s1", name: "Older" })]);
      await slow.promise;
    });

    expect(view.result.current.sessions.map((session) => session.id)).toEqual(["s2"]);
  });

  // Verify returning to the foreground re-reads the project-scoped list.
  it("re-reads the list when the window regains focus", async () => {
    await mountReady();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2));
  });

  // Verify a refused registration is silent and leaves the data correct.
  it("keeps reading data when the registration is refused", async () => {
    onRuntimeChangedMock.mockRejectedValue(new Error("registration refused"));
    listSessionsMock.mockResolvedValue([summary()]);

    const view = await mountReady();

    expect(view.result.current.failure).toBeNull();
    expect(view.result.current.sessions).toHaveLength(1);
  });

  // Verify unmounting removes both listeners, so nothing survives the page.
  it("releases its listeners on unmount", async () => {
    const unlisten = vi.fn<() => void>();
    onRuntimeChangedMock.mockResolvedValue(unlisten);
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const view = await mountReady();

    view.unmount();

    expect(unlisten).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
    removeSpy.mockRestore();
  });

  // Verify a registration finishing after unmount disposes itself instead of surviving.
  it("disposes a listener that resolves after unmount", async () => {
    const unlisten = vi.fn<() => void>();
    const registration = deferred<() => void>();
    onRuntimeChangedMock.mockReturnValue(registration.promise as never);
    const view = mount();

    view.unmount();
    registration.resolve(unlisten);

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
  });
});

describe("useProjectSessions event synchronization", () => {
  // Verify a created session of this project appears without a re-read.
  it("adds a created session of this project", async () => {
    const view = await mountReady();

    emit(event({ revision: "1", summary: summary({ id: "s5", name: "Fresh" }) }));

    expect(view.result.current.sessions.map((session) => session.id)).toEqual(["s5"]);
    expect(listSessionsMock).toHaveBeenCalledOnce();
  });

  // Verify an event for another project changes nothing in this list.
  it("ignores a session of another project", async () => {
    listSessionsMock.mockResolvedValue([summary()]);
    const view = await mountReady();

    emit(
      event({
        revision: "1",
        projectId: OTHER_PROJECT_ID,
        sessionId: "s9",
        summary: summary({ id: "s9", projectId: OTHER_PROJECT_ID }),
      }),
    );

    expect(view.result.current.sessions.map((session) => session.id)).toEqual(["s1"]);
  });

  // Verify a revision consumed by another project still counts, so a change elsewhere is
  // never mistaken for a dropped event about this project.
  it("keeps the revision sequence contiguous across projects", async () => {
    listSessionsMock.mockResolvedValue([summary()]);
    const view = await mountReady();

    emit(event({ revision: "1", projectId: OTHER_PROJECT_ID, sessionId: "s9", summary: null }));
    emit(event({ revision: "2", change: "updated", summary: summary({ name: "Renamed" }) }));

    expect(view.result.current.sessions[0]?.name).toBe("Renamed");
    expect(listSessionsMock).toHaveBeenCalledOnce();
  });

  // Verify an updated summary replaces the row in place.
  it("replaces a summary in place", async () => {
    listSessionsMock.mockResolvedValue([summary(), summary({ id: "s2", name: "Second" })]);
    const view = await mountReady();

    emit(event({ revision: "1", change: "updated", summary: summary({ status: "running" }) }));

    expect(view.result.current.sessions.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(view.result.current.sessions[0]?.status).toBe("running");
  });

  // Verify a deleted session is removed from the list.
  it("removes a deleted session", async () => {
    listSessionsMock.mockResolvedValue([summary()]);
    const view = await mountReady();

    emit(event({ revision: "1", change: "deleted", sessionId: "s1", summary: null }));

    expect(view.result.current.sessions).toHaveLength(0);
  });

  // Verify a duplicate or reordered delivery is dropped.
  it("ignores an event at or below the applied revision", async () => {
    const view = await mountReady();
    emit(event({ revision: "4", summary: summary({ id: "s4" }) }));

    emit(event({ revision: "4", summary: summary({ id: "s5" }) }));
    emit(event({ revision: "3", summary: summary({ id: "s6" }) }));

    expect(view.result.current.sessions.map((session) => session.id)).toEqual(["s4"]);
  });

  // Verify a gap re-reads the list instead of patching an inconsistent one.
  it("re-reads the list after a revision gap", async () => {
    const view = await mountReady();
    emit(event({ revision: "4", summary: summary({ id: "s4" }) }));
    listSessionsMock.mockResolvedValue([summary({ id: "s7", name: "Reloaded" })]);

    emit(event({ revision: "9", summary: summary({ id: "s9" }) }));

    await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(view.result.current.sessions.map((session) => session.id)).toEqual(["s7"]),
    );
  });
});

describe("useProjectSessions create", () => {
  // Verify a successful create hands the new identifier to the route exactly once.
  it("creates one session and reports its id", async () => {
    const view = await mountReady();

    await act(async () => {
      await view.result.current.create();
    });

    expect(createSessionMock).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(onCreated).toHaveBeenCalledExactlyOnceWith("s9");
  });

  // Verify the lock stops a second call while the first is still in flight, which is the one
  // guard against a double activation creating two sessions.
  it("suppresses a duplicate create", async () => {
    const pending = deferred<SessionDetailDto>();
    createSessionMock.mockReturnValue(pending.promise);
    const view = await mountReady();

    act(() => {
      void view.result.current.create();
    });
    await vi.waitFor(() => expect(view.result.current.isCreating).toBe(true));

    await act(async () => {
      await view.result.current.create();
    });

    expect(createSessionMock).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve(detail());
      await pending.promise;
    });
    expect(onCreated).toHaveBeenCalledOnce();
  });

  // Verify a vanished project leaves the page instead of explaining itself.
  it("reports a gone project to the route", async () => {
    createSessionMock.mockRejectedValue(
      new IpcCallError("create_session", { code: "projectNotFound", projectId: PROJECT_ID }),
    );
    const view = await mountReady();

    await act(async () => {
      await view.result.current.create();
    });

    expect(onProjectGone).toHaveBeenCalledOnce();
    expect(view.result.current.createFailure).toBeNull();
  });

  // Verify an unusable root asks the route to re-read metadata and leaves the explanation to
  // the banner that read produces, rather than stating the same sentence twice.
  it("asks for a metadata refresh when the root is unusable", async () => {
    createSessionMock.mockRejectedValue(
      new IpcCallError("create_session", { code: "projectUnavailable", projectId: PROJECT_ID }),
    );
    const view = await mountReady();

    await act(async () => {
      await view.result.current.create();
    });

    expect(onProjectUnavailable).toHaveBeenCalledOnce();
    expect(view.result.current.createFailure).toBeNull();
  });

  // Verify a transient failure is retryable and can be dismissed.
  it("offers a retry after a transient failure", async () => {
    createSessionMock.mockRejectedValue(
      new IpcCallError("create_session", { code: "projectLookupFailed" }),
    );
    const view = await mountReady();

    await act(async () => {
      await view.result.current.create();
    });

    expect(view.result.current.createFailure).toMatchObject({
      message: "XWork couldn't start a session for this project.",
      canRetry: true,
    });

    act(() => view.result.current.dismissCreateFailure());
    expect(view.result.current.createFailure).toBeNull();
  });

  // Verify a shutdown stops the flow without offering another attempt.
  it("stops the flow while the runtime is shutting down", async () => {
    createSessionMock.mockRejectedValue(
      new IpcCallError("create_session", { code: "runtimeShuttingDown" }),
    );
    const view = await mountReady();

    await act(async () => {
      await view.result.current.create();
    });

    expect(view.result.current.createFailure?.canRetry).toBe(false);
    expect(view.result.current.isCreating).toBe(false);
  });
});

describe("useProjectSessions rename", () => {
  // Verify a successful rename closes the dialog.
  it("renames and asks the dialog to close", async () => {
    const view = await mountReady();

    let closed = false;
    await act(async () => {
      closed = await view.result.current.rename("s1", "Renamed");
    });

    expect(renameSessionMock).toHaveBeenCalledExactlyOnceWith("s1", "Renamed");
    expect(closed).toBe(true);
    expect(view.result.current.lifecycle.pending).toBeNull();
  });

  // Verify a refused name keeps the dialog open with the exact rule.
  it("keeps the dialog open for an invalid name", async () => {
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", { code: "invalidName" }),
    );
    const view = await mountReady();

    let closed = true;
    await act(async () => {
      closed = await view.result.current.rename("s1", "x");
    });

    expect(closed).toBe(false);
    expect(view.result.current.lifecycle.failure).toMatchObject({
      kind: "invalidName",
      message: "Use 1 to 80 characters without control characters.",
    });
  });

  // Verify a session that vanished closes the dialog and re-reads the list.
  it("closes the dialog when the session is gone", async () => {
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", { code: "sessionNotFound", sessionId: "s1" }),
    );
    const view = await mountReady();

    let closed = false;
    await act(async () => {
      closed = await view.result.current.rename("s1", "Renamed");
    });

    expect(closed).toBe(true);
    expect(listSessionsMock).toHaveBeenCalledTimes(2);
  });

  // Verify a closing session reports that fact and keeps the dialog open.
  it("reports a closing session", async () => {
    renameSessionMock.mockRejectedValue(
      new IpcCallError("rename_session", { code: "closeInProgress", sessionId: "s1" }),
    );
    const view = await mountReady();

    await act(async () => {
      await view.result.current.rename("s1", "Renamed");
    });

    expect(view.result.current.lifecycle.failure?.message).toBe("This session is closing.");
  });

  // Verify only one lifecycle mutation can run at a time.
  it("suppresses a second lifecycle mutation", async () => {
    const pending = deferred<SessionDetailDto>();
    renameSessionMock.mockReturnValue(pending.promise);
    const view = await mountReady();

    act(() => {
      void view.result.current.rename("s1", "First");
    });
    await vi.waitFor(() => expect(view.result.current.lifecycle.pending).toBe("rename"));

    let second = true;
    await act(async () => {
      second = await view.result.current.rename("s1", "Second");
    });

    expect(second).toBe(false);
    expect(renameSessionMock).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve(detail("s1"));
      await pending.promise;
    });
  });
});

describe("useProjectSessions delete", () => {
  // Verify the confirmation is always preceded by one impact read for that exact target.
  it("reads the impact before the confirmation opens", async () => {
    const view = await mountReady();

    let canOpen = false;
    await act(async () => {
      canOpen = await view.result.current.inspect("s1");
    });

    expect(getCloseImpactMock).toHaveBeenCalledExactlyOnceWith({
      kind: "session",
      sessionId: "s1",
    });
    expect(canOpen).toBe(true);
    expect(view.result.current.lifecycle.impact).not.toBeNull();
  });

  // Verify a vanished session abandons the flow and re-reads the list.
  it("abandons the flow when the session is gone", async () => {
    getCloseImpactMock.mockRejectedValue(
      new IpcCallError("get_close_impact", { code: "sessionNotFound", sessionId: "s1" }),
    );
    const view = await mountReady();

    let canOpen = true;
    await act(async () => {
      canOpen = await view.result.current.inspect("s1");
    });

    expect(canOpen).toBe(false);
    expect(listSessionsMock).toHaveBeenCalledTimes(2);
  });

  // Verify a failed impact read still opens the confirmation, with its own retryable copy.
  it("opens the confirmation with a retryable impact failure", async () => {
    getCloseImpactMock.mockRejectedValue(
      new IpcCallError("get_close_impact", {
        code: "contentLifecycleFailed",
        operation: "inspect",
        targetId: "s1",
      }),
    );
    const view = await mountReady();

    let canOpen = false;
    await act(async () => {
      canOpen = await view.result.current.inspect("s1");
    });

    expect(canOpen).toBe(true);
    expect(view.result.current.lifecycle.impact).toBeNull();
    expect(view.result.current.lifecycle.failure?.message).toBe(
      "XWork couldn't check what this session is running.",
    );
  });

  // Verify a confirmed delete sends the confirmation flag and closes the dialog.
  it("closes the session and asks the dialog to close", async () => {
    const view = await mountReady();

    let closed = false;
    await act(async () => {
      closed = await view.result.current.confirmDelete("s1");
    });

    expect(closeRuntimeTargetMock).toHaveBeenCalledExactlyOnceWith(
      { kind: "session", sessionId: "s1" },
      true,
    );
    expect(closed).toBe(true);
  });

  // Verify a blocker that appeared since the facts were read demands another explicit click
  // and shows the refreshed impact rather than the one already displayed.
  it("re-asks with the refreshed impact after confirmationRequired", async () => {
    const refreshed = {
      target: { kind: "session" as const, sessionId: "s1" },
      requiresConfirmation: true,
      runningProcessCount: 2,
      runningProcessLabels: ["claude", "pnpm test"],
      unsavedFileCount: 0,
      unsavedFileLabels: [],
    };
    closeRuntimeTargetMock.mockRejectedValueOnce(
      new IpcCallError("close_runtime_target", {
        code: "confirmationRequired",
        impact: refreshed,
      }),
    );
    const view = await mountReady();

    let closed = true;
    await act(async () => {
      closed = await view.result.current.confirmDelete("s1");
    });

    expect(closed).toBe(false);
    expect(view.result.current.lifecycle.impact).toEqual(refreshed);

    await act(async () => {
      closed = await view.result.current.confirmDelete("s1");
    });

    expect(closed).toBe(true);
    expect(closeRuntimeTargetMock).toHaveBeenCalledTimes(2);
  });

  // Verify an already deleted session is treated as success, because the outcome the user
  // asked for has happened either way.
  it("treats a missing session as deleted", async () => {
    closeRuntimeTargetMock.mockRejectedValue(
      new IpcCallError("close_runtime_target", { code: "sessionNotFound", sessionId: "s1" }),
    );
    const view = await mountReady();

    let closed = false;
    await act(async () => {
      closed = await view.result.current.confirmDelete("s1");
    });

    expect(closed).toBe(true);
    expect(listSessionsMock).toHaveBeenCalledTimes(2);
  });

  // Verify a cleanup failure keeps the dialog open with one more attempt, which is safe
  // because BE-005 guarantees the close is idempotent.
  it("keeps the dialog open after a cleanup failure", async () => {
    closeRuntimeTargetMock.mockRejectedValue(
      new IpcCallError("close_runtime_target", {
        code: "contentLifecycleFailed",
        operation: "close",
        targetId: "s1",
      }),
    );
    const view = await mountReady();

    let closed = true;
    await act(async () => {
      closed = await view.result.current.confirmDelete("s1");
    });

    expect(closed).toBe(false);
    expect(view.result.current.lifecycle.failure).toMatchObject({
      message: "XWork couldn't stop everything in this session.",
      canRetry: true,
    });
  });

  // Verify resetting drops every transient value the dialogs read.
  it("resets its lifecycle state", async () => {
    const view = await mountReady();
    await act(async () => {
      await view.result.current.inspect("s1");
    });

    act(() => view.result.current.resetLifecycle());

    expect(view.result.current.lifecycle).toEqual({
      pending: null,
      impact: null,
      failure: null,
    });
  });
});
