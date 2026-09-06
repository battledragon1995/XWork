import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ProjectChangedEventDto, ProjectDto } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { useProjectPresence } from "./use-project-presence";

// Replace the shared Projects adapter so no test reaches Tauri, the database or a picker.
vi.mock("@/lib/ipc/projects", () => ({
  listProjects: vi.fn(),
  onProjectsChanged: vi.fn(),
}));

const listProjectsMock = vi.mocked(listProjects);
const onProjectsChangedMock = vi.mocked(onProjectsChanged);

/** One registered project used wherever only "the list is not empty" matters. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

/** A promise whose settlement the test controls, so request ordering is deterministic. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });

  return { promise, resolve, reject };
}

/** Read the handler the hook registered for the project invalidation event. */
function projectsChangedHandler(): (event: ProjectChangedEventDto) => void {
  const handler = onProjectsChangedMock.mock.calls[0]?.[0];
  if (handler === undefined) {
    throw new Error("The hook never subscribed to project changes.");
  }

  return handler;
}

let unlisten: Mock<() => void>;

beforeEach(() => {
  vi.resetAllMocks();
  unlisten = vi.fn<() => void>();
  listProjectsMock.mockResolvedValue([]);
  onProjectsChangedMock.mockResolvedValue(unlisten);
});

// Unmount every hook this file mounted. Without it the shared jsdom window keeps the focus
// listeners of earlier cases, and one dispatched focus event would fan out into every mount.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useProjectPresence", () => {
  // Verify the very first render reports loading and asks the backend exactly once.
  it("queries once on mount and starts in the first-load state", async () => {
    const pending = createDeferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useProjectPresence());

    expect(result.current.presence).toEqual({ status: "loading" });
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalledExactlyOnceWith());

    await act(async () => {
      pending.resolve([]);
    });

    expect(result.current.presence).toEqual({ status: "empty" });
  });

  // Verify a non-empty list is reduced to presence only, never to a stored project list.
  it("reports present when at least one project exists", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);

    const { result } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "present" });
    });
    expect((result.current as unknown as { projects: ProjectDto[] }).projects).toEqual([PROJECT]);
  });

  // Verify the one documented recoverable load failure keeps a retry path open.
  it("classifies persistenceFailed as retryable", async () => {
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );

    const { result } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "failed", kind: "retryable" });
    });
  });

  // Verify every other failure, including an unrecognized rejection, is terminal.
  it.each([
    ["unauthorizedWindow", new IpcCallError("list_projects", { code: "unauthorizedWindow" })],
    ["invalidSearch", new IpcCallError("list_projects", { code: "invalidSearch" })],
    ["an unrecognized payload", new IpcCallError("list_projects", null)],
    ["a plain error", new Error("boom")],
  ])("classifies %s as an integration failure", async (_label, rejection) => {
    listProjectsMock.mockRejectedValue(rejection);

    const { result } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "failed", kind: "integration" });
    });
  });

  // Verify the caller-driven retry path issues exactly one further query.
  it("queries again on refresh", async () => {
    const { result } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "empty" });
    });

    listProjectsMock.mockResolvedValue([PROJECT]);
    await act(async () => {
      result.current.refresh();
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    expect(result.current.presence).toEqual({ status: "present" });
  });

  // Verify both refresh signals are registered exactly once, whatever the render count.
  it("registers one project subscription and one window focus listener", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");

    const { result, rerender } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "empty" });
    });
    rerender();

    expect(onProjectsChangedMock).toHaveBeenCalledTimes(1);
    expect(addEventListener.mock.calls.filter(([type]) => type === "focus")).toHaveLength(1);
  });

  // Verify each invalidation signal produces exactly one new query. The event payload is a
  // cache key only, so presence still comes from a fresh backend result.
  it("re-queries once per invalidation signal", async () => {
    const { result } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "empty" });
    });

    listProjectsMock.mockResolvedValue([PROJECT]);
    await act(async () => {
      projectsChangedHandler()({ change: "added", projectId: "3f2a" });
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    expect(result.current.presence).toEqual({ status: "present" });

    listProjectsMock.mockResolvedValue([]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(3);
    expect(result.current.presence).toEqual({ status: "empty" });
  });

  // Verify a background refresh never falls back to the first-load state, so the route can
  // keep the branch it already rendered mounted without flashing.
  it("keeps the last successful branch while a refresh is in flight", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);
    const { result } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "present" });
    });

    const pending = createDeferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);
    act(() => {
      result.current.refresh();
    });

    expect(result.current.presence).toEqual({ status: "present" });

    await act(async () => {
      pending.resolve([]);
    });

    expect(result.current.presence).toEqual({ status: "empty" });
  });

  // Discard invalidated flights before starting one trailing authoritative read.
  it.each([false, true])("coalesces stale flight (rejection: %s)", async (reject) => {
    const first = createDeferred<ProjectDto[]>();
    const second = createDeferred<ProjectDto[]>();
    listProjectsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useProjectPresence());
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalledTimes(1));
    act(() => {
      projectsChangedHandler()({ change: "added", projectId: "new" });
      window.dispatchEvent(new Event("focus"));
    });
    expect(listProjectsMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (reject) first.reject(new Error("old"));
      else first.resolve([PROJECT]);
    });
    expect(result.current.projects).toBeNull();
    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve([]));
    expect(result.current.presence).toEqual({ status: "empty" });
  });
  // Verify a query that settles after unmount cannot update React state.
  it("drops a result that arrives after unmount", async () => {
    const pending = createDeferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);

    const { result, unmount } = renderHook(() => useProjectPresence());
    unmount();

    await act(async () => {
      pending.resolve([PROJECT]);
    });

    expect(result.current.presence).toEqual({ status: "loading" });
  });

  // Verify ordinary teardown removes both refresh subscriptions.
  it("removes both subscriptions on unmount", async () => {
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useProjectPresence());

    await waitFor(() => {
      expect(result.current.presence).toEqual({ status: "empty" });
    });

    unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(removeEventListener.mock.calls.filter(([type]) => type === "focus")).toHaveLength(1);
  });

  // Verify a subscription that finishes registering after unmount is removed immediately,
  // because the backend subscription resolves asynchronously and can lose the teardown race.
  it("removes a subscription that registers after unmount", async () => {
    const registration = createDeferred<() => void>();
    onProjectsChangedMock.mockReturnValue(registration.promise);

    const { unmount } = renderHook(() => useProjectPresence());
    unmount();

    await act(async () => {
      registration.resolve(unlisten);
    });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

// Keep the last authoritative snapshot when a same-generation refresh fails.
it("retains presence and rows on refresh rejection", async () => {
  listProjectsMock.mockResolvedValue([PROJECT]);
  const { result } = renderHook(() => useProjectPresence());
  await waitFor(() => expect(result.current.projects).toEqual([PROJECT]));
  listProjectsMock.mockRejectedValue(
    new IpcCallError("list_projects", { code: "persistenceFailed" }),
  );
  await act(async () => result.current.refresh());
  expect(result.current.presence).toEqual({ status: "present" });
  expect(result.current.projects).toEqual([PROJECT]);
  expect(result.current.failure).toBe("retryable");
});

// A listener failure must not prevent an initial read or leak a retry registration.
it("reads after registration failure and recovers the listener explicitly", async () => {
  onProjectsChangedMock.mockRejectedValueOnce(new Error("listen"));
  const { result, unmount } = renderHook(() => useProjectPresence());
  await waitFor(() => expect(result.current.subscriptionFailed).toBe(true));
  expect(result.current.projects).toEqual([]);
  await act(async () => result.current.refresh());
  expect(result.current.subscriptionFailed).toBe(false);
  expect(onProjectsChangedMock).toHaveBeenCalledTimes(2);
  unmount();
  expect(unlisten).toHaveBeenCalledTimes(1);
});

// A committed reset retires rows synchronously and a failed replacement cannot restore them.
it("retires a live epoch before effects and rejects late pre-reset rows", async () => {
  let boundary = { epoch: 0, suspended: false };
  listProjectsMock.mockResolvedValue([PROJECT]);
  const { result, rerender } = renderHook(() =>
    useProjectPresence({ boundary, readBoundary: () => boundary }),
  );
  await waitFor(() => expect(result.current.projects).toEqual([PROJECT]));
  const old = createDeferred<ProjectDto[]>();
  listProjectsMock.mockReturnValueOnce(old.promise);
  act(() => result.current.refresh());
  boundary = { epoch: 1, suspended: true };
  await act(async () => old.resolve([PROJECT]));
  rerender();
  expect(result.current.projects).toBeNull();
  listProjectsMock.mockRejectedValue(
    new IpcCallError("list_projects", { code: "persistenceFailed" }),
  );
  boundary = { epoch: 1, suspended: false };
  rerender();
  await waitFor(() => expect(result.current.failure).toBe("retryable"));
  expect(result.current.projects).toBeNull();
});

// Remove a known identity immediately and prevent an invalidated response from reviving it.
it("removes a row before its trailing query completes", async () => {
  listProjectsMock.mockResolvedValue([PROJECT]);
  const { result } = renderHook(() => useProjectPresence());
  await waitFor(() => expect(result.current.projects).toEqual([PROJECT]));
  const old = createDeferred<ProjectDto[]>();
  const trailing = createDeferred<ProjectDto[]>();
  listProjectsMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(trailing.promise);
  act(() => result.current.refresh());
  act(() => projectsChangedHandler()({ change: "removed", projectId: PROJECT.id }));
  expect(result.current.projects).toEqual([]);
  await act(async () => old.resolve([PROJECT]));
  expect(result.current.projects).toEqual([]);
  await act(async () => trailing.resolve([]));
});
