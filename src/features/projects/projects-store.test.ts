import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listProjects, onProjectsChanged, type UnlistenFn } from "@/lib/ipc/projects";
import { readProjectCrumbLabel, resetProjectsStore, useProjectsStore } from "./projects-store";
import { useProjects } from "./use-projects";

// Replace the backend boundary so no case reaches Tauri, the filesystem or a real event.
vi.mock("@/lib/ipc/projects", () => ({
  listProjects: vi.fn(),
  onProjectsChanged: vi.fn(),
}));

const listProjectsMock = vi.mocked(listProjects);
const onProjectsChangedMock = vi.mocked(onProjectsChanged);

/** One registered project used wherever the exact field values do not matter. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

/** A second project so ordering and replacement are observable. */
const OTHER: ProjectDto = { ...PROJECT, id: "9b1c", displayName: "recipe-api" };

/** Unlisten callback the mocked event registration hands back, spied per case. */
let unlistenSpy: ReturnType<typeof vi.fn>;

// Build one promise a case can settle by hand, which is how request ordering is controlled.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

// Count how many `focus` subscriptions one case added to or removed from the window.
function countFocusListeners(spy: { mock: { calls: ReadonlyArray<readonly unknown[]> } }): number {
  return spy.mock.calls.filter((call) => call[0] === "focus").length;
}

// Read the store without subscribing, which is what a non-component caller needs.
function store() {
  return useProjectsStore.getState();
}

// Start every case from the documented defaults, with no listener left behind.
beforeEach(() => {
  resetProjectsStore();
  vi.clearAllMocks();
  unlistenSpy = vi.fn();
  listProjectsMock.mockResolvedValue([]);
  onProjectsChangedMock.mockResolvedValue(unlistenSpy as unknown as UnlistenFn);
});

describe("projects store lifecycle", () => {
  // Verify the first consumer is what starts the one query and the two subscriptions.
  it("queries once and subscribes once for the first consumer", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    await act(async () => {
      store().acquire();
    });

    expect(listProjectsMock).toHaveBeenCalledExactlyOnceWith();
    expect(onProjectsChangedMock).toHaveBeenCalledOnce();
    expect(countFocusListeners(addSpy)).toBe(1);
    expect(store().consumerCount).toBe(1);
    addSpy.mockRestore();
  });

  // Verify a second consumer shares everything the first one created.
  it("adds no duplicate query or listener for a second consumer", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    listProjectsMock.mockResolvedValue([PROJECT]);

    await act(async () => {
      store().acquire();
    });
    await act(async () => {
      store().acquire();
    });

    expect(listProjectsMock).toHaveBeenCalledOnce();
    expect(onProjectsChangedMock).toHaveBeenCalledOnce();
    expect(countFocusListeners(addSpy)).toBe(1);
    expect(store().consumerCount).toBe(2);
    expect(store().projects).toEqual([PROJECT]);
    addSpy.mockRestore();
  });

  // Verify the last consumer leaving removes both subscriptions but keeps the loaded data,
  // so the next mount renders the previous list instead of flashing an empty state.
  it("removes both listeners for the final consumer and keeps the data", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    listProjectsMock.mockResolvedValue([PROJECT]);

    await act(async () => {
      store().acquire();
    });
    await act(async () => {
      store().acquire();
    });

    act(() => {
      store().release();
    });
    expect(unlistenSpy).not.toHaveBeenCalled();
    expect(countFocusListeners(removeSpy)).toBe(0);

    act(() => {
      store().release();
    });

    expect(unlistenSpy).toHaveBeenCalledOnce();
    expect(countFocusListeners(removeSpy)).toBe(1);
    expect(store().consumerCount).toBe(0);
    expect(store().projects).toEqual([PROJECT]);
    expect(store().status).toBe("ready");
    removeSpy.mockRestore();
  });

  // Verify an event registration that resolves after the last release is removed at once,
  // instead of surviving as an orphan listener nothing can reach.
  it("removes a late event registration immediately", async () => {
    const registration = deferred<UnlistenFn>();
    onProjectsChangedMock.mockReturnValue(registration.promise);

    act(() => {
      store().acquire();
    });
    act(() => {
      store().release();
    });

    await act(async () => {
      registration.resolve(unlistenSpy as unknown as UnlistenFn);
      await registration.promise;
    });

    expect(unlistenSpy).toHaveBeenCalledOnce();
  });

  // Verify a query still in flight when the last consumer leaves publishes nothing.
  it("ignores a query that completes after the last release", async () => {
    const pending = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);

    act(() => {
      store().acquire();
    });
    act(() => {
      store().release();
    });

    await act(async () => {
      pending.resolve([PROJECT]);
      await pending.promise;
    });

    expect(store().projects).toEqual([]);
  });
});

describe("readProjectCrumbLabel", () => {
  // Verify a route id is translated through the retained project snapshot.
  it("returns the display name for a present project", () => {
    useProjectsStore.setState({ projects: [PROJECT, OTHER] });

    expect(readProjectCrumbLabel("9b1c")).toBe("recipe-api");
  });

  // Verify missing and absent route ids produce an inert crumb instead of exposing the id.
  it.each([["missing"], [undefined]])("returns an empty label for %s", (projectId) => {
    useProjectsStore.setState({ projects: [PROJECT] });

    expect(readProjectCrumbLabel(projectId)).toBe("");
  });
});

describe("projects store invalidation", () => {
  // Verify the event is treated as a cache key: the store re-queries instead of applying it.
  it("re-queries on a projects://changed signal without reading its payload", async () => {
    await act(async () => {
      store().acquire();
    });
    const handler = onProjectsChangedMock.mock.calls[0]?.[0];
    if (handler === undefined) {
      throw new Error("The store registered no project-change handler.");
    }
    listProjectsMock.mockResolvedValue([OTHER]);

    await act(async () => {
      handler({ change: "added", projectId: "ignored" });
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    expect(listProjectsMock).toHaveBeenLastCalledWith();
    expect(store().projects).toEqual([OTHER]);
  });

  // Verify returning to the foreground catches availability changes made outside XWork.
  it("re-queries when the window regains focus", async () => {
    await act(async () => {
      store().acquire();
    });
    listProjectsMock.mockResolvedValue([PROJECT]);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    expect(store().projects).toEqual([PROJECT]);
  });

  // Verify a focus signal after the last release changes nothing, which is the observable
  // proof that the listener really was removed rather than merely ignored.
  it("stops reacting to focus once every consumer released", async () => {
    await act(async () => {
      store().acquire();
    });
    act(() => {
      store().release();
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(listProjectsMock).toHaveBeenCalledOnce();
  });

  // Verify the newest request wins even when an older one answers last.
  it("applies only the newest query result", async () => {
    const first = deferred<ProjectDto[]>();
    const second = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    act(() => {
      store().acquire();
    });
    act(() => {
      store().refresh();
    });

    await act(async () => {
      second.resolve([OTHER]);
      await second.promise;
    });
    await act(async () => {
      first.resolve([PROJECT]);
      await first.promise;
    });

    expect(store().projects).toEqual([OTHER]);
    expect(store().status).toBe("ready");
  });

  // Verify a refresh keeps the visible list until its own result arrives.
  it("keeps the previous list while refreshing", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);
    await act(async () => {
      store().acquire();
    });

    const pending = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);
    act(() => {
      store().refresh();
    });

    expect(store().status).toBe("loading");
    expect(store().projects).toEqual([PROJECT]);

    await act(async () => {
      pending.resolve([PROJECT, OTHER]);
      await pending.promise;
    });

    expect(store().projects).toEqual([PROJECT, OTHER]);
  });
});

describe("projects store load failures", () => {
  // Verify only a persistence failure offers another attempt.
  it("classifies persistenceFailed as retryable", async () => {
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );

    await act(async () => {
      store().acquire();
    });

    expect(store().status).toBe("failed");
    expect(store().failure).toEqual({
      kind: "retryable",
      message: "XWork couldn't load your projects.",
    });
  });

  // Verify every other documented code, and every rejection this build cannot read, is
  // terminal so the user is never trapped retrying something that cannot succeed.
  it.each([
    ["unauthorizedWindow", new IpcCallError("list_projects", { code: "unauthorizedWindow" })],
    ["invalidSearch", new IpcCallError("list_projects", { code: "invalidSearch" })],
    ["a malformed payload", new IpcCallError("list_projects", null)],
    ["a non-IpcCallError rejection", new Error("boom")],
  ])("classifies %s as an integration failure", async (_label, rejection) => {
    listProjectsMock.mockRejectedValue(rejection);

    await act(async () => {
      store().acquire();
    });

    expect(store().failure).toEqual({
      kind: "integration",
      message: "XWork ran into a problem it cannot recover from. Restart XWork.",
    });
  });

  // Verify a failed refresh keeps the last good list, and a later success clears the failure.
  it("keeps loaded projects through a failure and recovers on retry", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);
    await act(async () => {
      store().acquire();
    });

    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );
    await act(async () => {
      store().refresh();
    });

    expect(store().projects).toEqual([PROJECT]);
    expect(store().failure?.kind).toBe("retryable");

    listProjectsMock.mockResolvedValue([PROJECT, OTHER]);
    await act(async () => {
      store().refresh();
    });

    expect(store().failure).toBeNull();
    expect(store().status).toBe("ready");
    expect(store().projects).toEqual([PROJECT, OTHER]);
  });
});

describe("shared Add Project lock", () => {
  // Verify the lock is what stops a second native picker from ever being requested.
  it("lets only one flow begin at a time", () => {
    expect(store().beginAdd()).toBe(true);
    expect(store().beginAdd()).toBe(false);
    expect(store().isAdding).toBe(true);
  });

  // Verify ending the flow releases the lock and publishes the failure it was given.
  it("releases the lock and publishes the failure", () => {
    store().beginAdd();

    act(() => {
      store().endAdd({ kind: "retryable", message: "XWork couldn't save the project. Try again." });
    });

    expect(store().isAdding).toBe(false);
    expect(store().addFailure).toEqual({
      kind: "retryable",
      message: "XWork couldn't save the project. Try again.",
    });
    expect(store().beginAdd()).toBe(true);
  });

  // Verify starting a new flow clears the previous failure, so stale copy never lingers.
  it("clears the previous failure when a new flow begins", () => {
    store().beginAdd();
    act(() => {
      store().endAdd({ kind: "integration", message: "nope" });
    });

    act(() => {
      store().beginAdd();
    });

    expect(store().addFailure).toBeNull();
  });
});

describe("resetProjectsStore", () => {
  // Verify the reset helper leaves no state and no listener for the next case to observe.
  it("restores the defaults and removes active listeners", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    listProjectsMock.mockResolvedValue([PROJECT]);
    await act(async () => {
      store().acquire();
    });
    store().beginAdd();

    act(() => {
      resetProjectsStore();
    });

    expect(store().status).toBe("idle");
    expect(store().projects).toEqual([]);
    expect(store().failure).toBeNull();
    expect(store().isAdding).toBe(false);
    expect(store().addFailure).toBeNull();
    expect(store().consumerCount).toBe(0);
    expect(unlistenSpy).toHaveBeenCalledOnce();
    expect(countFocusListeners(removeSpy)).toBe(1);
    removeSpy.mockRestore();
  });
});

describe("useProjects", () => {
  // Verify the hook is the thin consumer wrapper: mounting acquires, unmounting releases.
  it("acquires on mount and releases on unmount", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);

    const view = renderHook(() => useProjects());
    await act(async () => {});

    expect(store().consumerCount).toBe(1);
    expect(view.result.current.projects).toEqual([PROJECT]);
    expect(view.result.current.status).toBe("ready");

    view.unmount();

    expect(store().consumerCount).toBe(0);
    expect(unlistenSpy).toHaveBeenCalledOnce();
  });

  // Verify two mounted consumers still share one query, which is the reason the store exists.
  it("shares one query across two mounted consumers", async () => {
    const first = renderHook(() => useProjects());
    const second = renderHook(() => useProjects());
    await act(async () => {});

    expect(listProjectsMock).toHaveBeenCalledOnce();
    expect(store().consumerCount).toBe(2);

    first.unmount();
    second.unmount();

    expect(store().consumerCount).toBe(0);
  });

  // Verify the hook exposes the refresh action the retry affordances need.
  it("exposes a refresh action that re-queries", async () => {
    const view = renderHook(() => useProjects());
    await act(async () => {});

    await act(async () => {
      view.result.current.refresh();
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
  });
});
