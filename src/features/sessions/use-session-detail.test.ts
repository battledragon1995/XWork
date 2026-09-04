import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectChangedEventDto } from "@/bindings/projects/projects";
import type { SessionDetailDto, SessionRuntimeEventDto } from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import * as sessionsIpc from "@/lib/ipc/sessions";
import {
  createProjectDto,
  createRuntimeEvent,
  createSessionDetail,
  createSessionSummary,
  FIXTURE_PROJECT_ID,
  FIXTURE_ROOT_PATH,
  FIXTURE_SESSION_ID,
} from "./sessions-test-fixture";
import { useSessionDetail } from "./use-session-detail";

// Replace both boundaries so no case reaches Tauri or registers a real listener.
vi.mock("@/lib/ipc/sessions", () => ({
  getSession: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(),
  setObservedSession: vi.fn(),
}));
vi.mock("@/lib/ipc/projects", () => ({
  getProject: vi.fn(),
  onProjectsChanged: vi.fn(),
}));

const getSessionMock = vi.mocked(sessionsIpc.getSession);
const onRuntimeChangedMock = vi.mocked(sessionsIpc.onSessionsRuntimeChanged);
const setObservedSessionMock = vi.mocked(sessionsIpc.setObservedSession);
const getProjectMock = vi.mocked(projectsIpc.getProject);
const onProjectsChangedMock = vi.mocked(projectsIpc.onProjectsChanged);

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

/** Deliver one runtime event exactly as the adapter would. */
function emitRuntime(event: SessionRuntimeEventDto): void {
  const handler = onRuntimeChangedMock.mock.calls.at(-1)?.[0];
  if (handler === undefined) {
    throw new Error("The hook should have registered a runtime-changed handler.");
  }
  act(() => handler(event));
}

/** Deliver one project invalidation exactly as the adapter would. */
function emitProjects(): void {
  const handler = onProjectsChangedMock.mock.calls.at(-1)?.[0];
  if (handler === undefined) {
    throw new Error("The hook should have registered a projects-changed handler.");
  }
  act(() =>
    handler({ change: "updated", projectId: FIXTURE_PROJECT_ID } as ProjectChangedEventDto),
  );
}

/** Mount the hook and wait for its first read to settle. */
async function mountReady(sessionId = FIXTURE_SESSION_ID) {
  const view = renderHook(({ id }: { id: string }) => useSessionDetail(id), {
    initialProps: { id: sessionId },
  });
  await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(createSessionDetail());
  getProjectMock.mockResolvedValue(createProjectDto());
  onRuntimeChangedMock.mockResolvedValue(() => {});
  onProjectsChangedMock.mockResolvedValue(() => {});
  setObservedSessionMock.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe("useSessionDetail reads", () => {
  // Verify the route reads the session and then the project it needs the root path from.
  it("reads the session and its project", async () => {
    const view = await mountReady();

    expect(getSessionMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_SESSION_ID);
    expect(getProjectMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_PROJECT_ID);
    expect(view.result.current.project?.rootPath).toBe(FIXTURE_ROOT_PATH);
  });

  // Verify a session that is gone is reported as missing rather than as a failure.
  it("reports a missing session without a failure", async () => {
    getSessionMock.mockRejectedValue(
      new IpcCallError("get_session", { code: "sessionNotFound", sessionId: FIXTURE_SESSION_ID }),
    );

    const view = renderHook(() => useSessionDetail(FIXTURE_SESSION_ID));

    await vi.waitFor(() => expect(view.result.current.status).toBe("missing"));
    expect(view.result.current.failure).toBeNull();
  });

  // Verify every other rejection is a retryable route failure.
  it.each([
    ["unauthorizedWindow", { code: "unauthorizedWindow" }],
    ["an unrecognized rejection", { message: "boom" }],
  ])("reports %s as a route failure", async (_label, payload) => {
    getSessionMock.mockRejectedValue(new IpcCallError("get_session", payload as never));

    const view = renderHook(() => useSessionDetail(FIXTURE_SESSION_ID));

    await vi.waitFor(() => expect(view.result.current.status).toBe("error"));
    expect(view.result.current.failure).not.toBeNull();
  });

  // Verify the retry reads the same session again.
  it("retries the same session", async () => {
    getSessionMock.mockRejectedValueOnce(
      new IpcCallError("get_session", { code: "unauthorizedWindow" }),
    );
    const view = renderHook(() => useSessionDetail(FIXTURE_SESSION_ID));
    await vi.waitFor(() => expect(view.result.current.status).toBe("error"));

    act(() => view.result.current.refresh());

    await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));
    expect(getSessionMock).toHaveBeenLastCalledWith(FIXTURE_SESSION_ID);
  });

  // Verify a read for the previous session id can never publish over the new one.
  it("discards a read that answers after the session id changed", async () => {
    const slow = deferred<SessionDetailDto>();
    getSessionMock.mockReturnValueOnce(slow.promise);
    const view = renderHook(({ id }: { id: string }) => useSessionDetail(id), {
      initialProps: { id: "session-old" },
    });

    getSessionMock.mockResolvedValue(
      createSessionDetail({ summary: createSessionSummary({ id: "session-new", name: "New" }) }),
    );
    view.rerender({ id: "session-new" });
    await vi.waitFor(() => expect(view.result.current.status).toBe("ready"));

    await act(async () => {
      slow.resolve(
        createSessionDetail({ summary: createSessionSummary({ id: "session-old", name: "Old" }) }),
      );
      await slow.promise;
    });

    expect(view.result.current.detail?.summary.id).toBe("session-new");
  });

  // Verify a project read that fails for any reason other than removal only hides the path.
  it("hides the root path when the project cannot be read", async () => {
    getProjectMock.mockRejectedValue(
      new IpcCallError("get_project", { code: "projectLookupFailed" }),
    );

    const view = await mountReady();

    expect(view.result.current.project).toBeNull();
    expect(view.result.current.status).toBe("ready");
  });

  // Verify a removed project makes the route leave, because BE-003 closes its sessions too.
  it("reports missing when the project is gone", async () => {
    getProjectMock.mockRejectedValue(
      new IpcCallError("get_project", { code: "projectNotFound", projectId: FIXTURE_PROJECT_ID }),
    );

    const view = renderHook(() => useSessionDetail(FIXTURE_SESSION_ID));

    await vi.waitFor(() => expect(view.result.current.status).toBe("missing"));
  });

  // Verify a project invalidation refreshes only the project, not the whole session.
  it("re-reads only the project after a project change", async () => {
    const view = await mountReady();
    getProjectMock.mockResolvedValue(createProjectDto({ displayName: "renamed" }));

    emitProjects();

    await vi.waitFor(() => expect(view.result.current.project?.displayName).toBe("renamed"));
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  // Verify returning to the foreground re-reads both the session and its project.
  it("re-reads both snapshots when the window regains focus", async () => {
    await mountReady();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => expect(getSessionMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getProjectMock).toHaveBeenCalledTimes(2));
  });

  // Verify a refresh keeps the visible snapshot instead of flashing the skeleton again.
  it("keeps the visible snapshot while refreshing", async () => {
    const view = await mountReady();
    const slow = deferred<SessionDetailDto>();
    getSessionMock.mockReturnValue(slow.promise);

    act(() => view.result.current.refresh());

    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.detail).not.toBeNull();

    await act(async () => {
      slow.resolve(createSessionDetail());
      await slow.promise;
    });
  });

  // Verify a refused registration is silent and leaves the snapshot correct.
  it("keeps reading data when a registration is refused", async () => {
    onRuntimeChangedMock.mockRejectedValue(new Error("registration refused"));
    onProjectsChangedMock.mockRejectedValue(new Error("registration refused"));

    const view = await mountReady();

    expect(view.result.current.failure).toBeNull();
    expect(view.result.current.detail).not.toBeNull();
  });

  // Verify unmounting removes every listener the route registered.
  it("releases its listeners on unmount", async () => {
    const unlistenRuntime = vi.fn<() => void>();
    const unlistenProjects = vi.fn<() => void>();
    onRuntimeChangedMock.mockResolvedValue(unlistenRuntime);
    onProjectsChangedMock.mockResolvedValue(unlistenProjects);
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const view = await mountReady();

    view.unmount();

    expect(unlistenRuntime).toHaveBeenCalledOnce();
    expect(unlistenProjects).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
    removeSpy.mockRestore();
  });

  // Verify a registration finishing after unmount disposes itself instead of surviving.
  it("disposes a listener that resolves after unmount", async () => {
    const unlisten = vi.fn<() => void>();
    const registration = deferred<() => void>();
    onRuntimeChangedMock.mockReturnValue(registration.promise as never);
    const view = renderHook(() => useSessionDetail(FIXTURE_SESSION_ID));

    view.unmount();
    registration.resolve(unlisten);

    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
  });
});

describe("useSessionDetail runtime events", () => {
  // Verify a matching event replaces the summary without a second read.
  it("applies a matching summary in place", async () => {
    const view = await mountReady();

    emitRuntime(
      createRuntimeEvent({
        revision: "11",
        change: "updated",
        summary: createSessionSummary({ name: "Renamed", status: "running" }),
      }),
    );

    expect(view.result.current.detail?.summary.name).toBe("Renamed");
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  // Verify a stale or duplicate delivery cannot roll the snapshot back.
  it("ignores an event at or below the applied revision", async () => {
    const view = await mountReady();

    emitRuntime(
      createRuntimeEvent({
        revision: "10",
        change: "updated",
        summary: createSessionSummary({ name: "Stale" }),
      }),
    );

    expect(view.result.current.detail?.summary.name).toBe("New Session");
  });

  // Verify an event about another session only advances the revision baseline, so the next
  // event about this session is still recognized as contiguous.
  it("keeps the revision sequence contiguous across sessions", async () => {
    const view = await mountReady();

    emitRuntime(
      createRuntimeEvent({ revision: "11", change: "created", sessionId: "other", summary: null }),
    );
    emitRuntime(
      createRuntimeEvent({
        revision: "12",
        change: "updated",
        summary: createSessionSummary({ name: "Renamed" }),
      }),
    );

    expect(view.result.current.detail?.summary.name).toBe("Renamed");
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  // Verify a gap re-reads the whole session instead of patching it.
  it("re-reads the session after a revision gap", async () => {
    const view = await mountReady();
    getSessionMock.mockResolvedValue(
      createSessionDetail({
        summary: createSessionSummary({ name: "Reloaded" }),
        revision: "20",
      }),
    );

    emitRuntime(createRuntimeEvent({ revision: "15", change: "updated" }));

    await vi.waitFor(() => expect(getSessionMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(view.result.current.detail?.summary.name).toBe("Reloaded"));
  });

  // Verify a delete of the open session is reported as missing so the route can leave.
  it("reports missing after a matching deleted event", async () => {
    const view = await mountReady();

    emitRuntime(
      createRuntimeEvent({
        revision: "11",
        change: "deleted",
        sessionId: FIXTURE_SESSION_ID,
        summary: null,
      }),
    );

    expect(view.result.current.status).toBe("missing");
  });

  // Verify a delete of another session leaves this route alone.
  it("ignores a deleted event for another session", async () => {
    const view = await mountReady();

    emitRuntime(
      createRuntimeEvent({ revision: "11", change: "deleted", sessionId: "other", summary: null }),
    );

    expect(view.result.current.status).toBe("ready");
  });
});

describe("useSessionDetail mutation snapshots", () => {
  // Verify a mutation's own snapshot updates the route immediately, with no extra read.
  it("adopts a returned snapshot without a second read", async () => {
    const view = await mountReady();
    const next = createSessionDetail({
      summary: createSessionSummary({ name: "From mutation" }),
      revision: "14",
    });

    act(() => view.result.current.applyDetail(next));

    expect(view.result.current.detail?.summary.name).toBe("From mutation");
    expect(getSessionMock).toHaveBeenCalledOnce();
  });

  // Verify a snapshot of another session cannot replace this route's own.
  it("rejects a snapshot for another session", async () => {
    const view = await mountReady();

    act(() =>
      view.result.current.applyDetail(
        createSessionDetail({ summary: createSessionSummary({ id: "other", name: "Wrong" }) }),
      ),
    );

    expect(view.result.current.detail?.summary.name).toBe("New Session");
  });

  // Verify an adopted snapshot also becomes the new revision baseline, so a contiguous event
  // after it is applied rather than treated as a gap.
  it("adopts the returned revision as its baseline", async () => {
    const view = await mountReady();
    act(() => view.result.current.applyDetail(createSessionDetail({ revision: "30" })));

    emitRuntime(
      createRuntimeEvent({
        revision: "31",
        change: "updated",
        summary: createSessionSummary({ name: "Next" }),
      }),
    );

    expect(view.result.current.detail?.summary.name).toBe("Next");
    expect(getSessionMock).toHaveBeenCalledOnce();
  });
});

describe("useSessionDetail observation", () => {
  // Verify the route records exactly the session it is showing.
  it("observes the session on entry", async () => {
    await mountReady();

    expect(setObservedSessionMock).toHaveBeenCalledExactlyOnceWith(FIXTURE_SESSION_ID);
  });

  // Verify leaving the route clears the observation exactly once.
  it("clears the observation exactly once on exit", async () => {
    const view = await mountReady();

    view.unmount();

    expect(setObservedSessionMock).toHaveBeenCalledTimes(2);
    expect(setObservedSessionMock).toHaveBeenLastCalledWith(null);
  });

  // Verify replacing the session id clears the old observation before recording the new one,
  // so the backend can never be left observing the session the user just left.
  it("clears before observing a replacement session", async () => {
    const view = await mountReady();

    getSessionMock.mockResolvedValue(
      createSessionDetail({ summary: createSessionSummary({ id: "session-2" }) }),
    );
    await act(async () => {
      view.rerender({ id: "session-2" });
    });

    expect(setObservedSessionMock.mock.calls.map(([id]) => id)).toEqual([
      FIXTURE_SESSION_ID,
      null,
      "session-2",
    ]);
  });

  // Verify a refused observation never stops the route from rendering its session, because
  // recording what the user looks at is best effort by design.
  it("renders the session even when the observation is refused", async () => {
    setObservedSessionMock.mockRejectedValue(
      new IpcCallError("set_observed_session", { code: "runtimeShuttingDown" }),
    );

    const view = await mountReady();

    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.failure).toBeNull();
  });
});
