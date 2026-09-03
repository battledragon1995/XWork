import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectChangedEventDto,
  ProjectDto,
  ProjectGitStatusDto,
} from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import {
  getProject,
  getProjectGitStatus,
  onProjectsChanged,
  openProject,
  type UnlistenFn,
} from "@/lib/ipc/projects";
import { useProjectOverview } from "./use-project-overview";

// Replace every desktop read and event subscription with an isolated local double.
vi.mock("@/lib/ipc/projects", () => ({
  getProject: vi.fn(),
  getProjectGitStatus: vi.fn(),
  onProjectsChanged: vi.fn(),
  openProject: vi.fn(),
}));

const openProjectMock = vi.mocked(openProject);
const getProjectMock = vi.mocked(getProject);
const getProjectGitStatusMock = vi.mocked(getProjectGitStatus);
const onProjectsChangedMock = vi.mocked(onProjectsChanged);

/** One available project returned by the metadata commands. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

/** One clean worktree snapshot returned after available metadata. */
const GIT_STATUS: ProjectGitStatusDto = {
  summary: {
    projectId: "3f2a",
    repositoryKind: "worktree",
    head: { kind: "branch", name: "main" },
    changedCount: 0,
    untrackedCount: 0,
  },
  changes: [],
};

/** Project snapshot whose root may no longer be queried for Git. */
const UNAVAILABLE: ProjectDto = {
  ...PROJECT,
  availability: { status: "unavailable", reason: "missing" },
};

/** Last registered project event callback for direct invalidation tests. */
let projectEvent: ((event: ProjectChangedEventDto) => void) | null;

/** Listener cleanup returned by the event double. */
let unlisten: ReturnType<typeof vi.fn>;

/** Create a promise whose settlement order a race test controls explicitly. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Render the route-local hook with an observable gone callback. */
function renderOverview(onGone = vi.fn()) {
  return {
    onGone,
    view: renderHook(() => useProjectOverview({ projectId: "3f2a", onGone })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  projectEvent = null;
  unlisten = vi.fn();
  openProjectMock.mockResolvedValue(PROJECT);
  getProjectMock.mockResolvedValue(PROJECT);
  getProjectGitStatusMock.mockResolvedValue(GIT_STATUS);
  onProjectsChangedMock.mockImplementation(async (handler) => {
    projectEvent = handler;
    return unlisten as unknown as UnlistenFn;
  });
});

afterEach(() => {
  cleanup();
});

describe("useProjectOverview loading", () => {
  // Verify mount records one explicit open, then queries Git from its returned availability.
  it("opens exactly once and loads Git for an available project", async () => {
    const { view } = renderOverview();

    await act(async () => {});

    expect(openProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(getProjectMock).not.toHaveBeenCalled();
    expect(getProjectGitStatusMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.git).toEqual({ status: "ready", snapshot: GIT_STATUS });
  });

  // Verify an unavailable root reaches ready metadata without making an invalid Git call.
  it("skips Git for an unavailable project", async () => {
    openProjectMock.mockResolvedValue(UNAVAILABLE);

    const { view } = renderOverview();
    await act(async () => {});

    expect(view.result.current.project).toEqual(UNAVAILABLE);
    expect(view.result.current.git).toEqual({ status: "idle" });
    expect(getProjectGitStatusMock).not.toHaveBeenCalled();
  });

  // Verify retryable open failures replace the page and `load` repeats the explicit open.
  it("publishes and retries the full-page open failure", async () => {
    openProjectMock.mockRejectedValueOnce(
      new IpcCallError("open_project", { code: "persistenceFailed" }),
    );
    const { view } = renderOverview();
    await act(async () => {});

    expect(view.result.current.status).toBe("failed");
    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "XWork couldn't open this project.",
    });

    await act(async () => {
      view.result.current.load();
    });
    expect(openProjectMock).toHaveBeenCalledTimes(2);
    expect(view.result.current.status).toBe("ready");
  });

  // Verify both metadata gone variants navigate silently instead of becoming failures.
  it.each(["projectNotFound", "removalInProgress"] as const)("reports %s as gone", async (code) => {
    openProjectMock.mockRejectedValue(
      new IpcCallError("open_project", { code, project_id: "3f2a" }),
    );
    const { onGone } = renderOverview();

    await act(async () => {});

    expect(onGone).toHaveBeenCalledOnce();
  });
});

describe("useProjectOverview invalidation", () => {
  // Verify focus uses the read-only metadata command and refreshes Git without reopening.
  it("refreshes metadata and Git on window focus", async () => {
    renderOverview();
    await act(async () => {});
    vi.clearAllMocks();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(openProjectMock).not.toHaveBeenCalled();
    expect(getProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(getProjectGitStatusMock).toHaveBeenCalledExactlyOnceWith("3f2a");
  });

  // Verify an update payload is only an invalidation key and never applied as state.
  it("re-queries on projects changed and navigates on current removal", async () => {
    const { onGone } = renderOverview();
    await act(async () => {});
    vi.clearAllMocks();

    await act(async () => {
      projectEvent?.({ change: "updated", projectId: "3f2a" });
    });
    expect(getProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(getProjectGitStatusMock).toHaveBeenCalledExactlyOnceWith("3f2a");

    act(() => {
      projectEvent?.({ change: "removed", projectId: "3f2a" });
    });
    expect(onGone).toHaveBeenCalledOnce();
  });

  // Verify an inline refresh failure keeps the previous project and Git snapshot visible.
  it("keeps stale data through a retryable refresh failure", async () => {
    const { view } = renderOverview();
    await act(async () => {});
    getProjectMock.mockRejectedValue(
      new IpcCallError("get_project", { code: "persistenceFailed" }),
    );

    await act(async () => {
      view.result.current.refreshProject();
    });

    expect(view.result.current.project).toEqual(PROJECT);
    expect(view.result.current.git).toEqual({ status: "ready", snapshot: GIT_STATUS });
    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "XWork couldn't refresh this project.",
    });
  });

  // Verify a later refresh wins even if an older metadata request settles last.
  it("drops an older refresh result", async () => {
    const { view } = renderOverview();
    await act(async () => {});
    const older = deferred<ProjectDto>();
    const newer = deferred<ProjectDto>();
    getProjectMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    act(() => view.result.current.refreshProject());
    act(() => projectEvent?.({ change: "updated", projectId: "3f2a" }));

    const renamed = { ...PROJECT, displayName: "XWork" };
    await act(async () => {
      newer.resolve(renamed);
      await newer.promise;
    });
    await act(async () => {
      older.resolve(PROJECT);
      await older.promise;
    });

    expect(view.result.current.project?.displayName).toBe("XWork");
  });
});

describe("useProjectOverview Git failures", () => {
  // Verify Git inspection failures carry project-specific copy and retry only the Git command.
  it("publishes and retries a Git inspection failure", async () => {
    getProjectGitStatusMock.mockRejectedValueOnce(
      new IpcCallError("get_project_git_status", {
        code: "gitInspectionFailed",
        project_id: "3f2a",
      }),
    );
    const { view } = renderOverview();
    await act(async () => {});

    expect(view.result.current.git).toEqual({
      status: "failed",
      message: "XWork couldn't read Git status for xwork.",
    });

    await act(async () => view.result.current.retryGit());
    expect(getProjectGitStatusMock).toHaveBeenCalledTimes(2);
    expect(getProjectMock).not.toHaveBeenCalled();
    expect(view.result.current.git.status).toBe("ready");
  });

  // Verify a stale available snapshot is corrected immediately when Git reports unavailable.
  it("refreshes metadata after projectUnavailable from Git", async () => {
    getProjectGitStatusMock.mockRejectedValue(
      new IpcCallError("get_project_git_status", {
        code: "projectUnavailable",
        reason: "missing",
      }),
    );
    getProjectMock.mockResolvedValue(UNAVAILABLE);
    const { view } = renderOverview();

    await act(async () => {});

    expect(getProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(view.result.current.project).toEqual(UNAVAILABLE);
    expect(view.result.current.git).toEqual({ status: "idle" });
  });
});

describe("useProjectOverview cleanup", () => {
  // Verify unmount removes both listeners and prevents a deferred open from publishing.
  it("cleans up listeners and invalidates in-flight work", async () => {
    const pending = deferred<ProjectDto>();
    openProjectMock.mockReturnValue(pending.promise);
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { view } = renderOverview();
    await act(async () => {});

    view.unmount();
    await act(async () => {
      pending.resolve(PROJECT);
      await pending.promise;
    });

    expect(unlisten).toHaveBeenCalledOnce();
    expect(removeSpy.mock.calls.some((call) => call[0] === "focus")).toBe(true);
    expect(getProjectGitStatusMock).not.toHaveBeenCalled();
    removeSpy.mockRestore();
  });
});
