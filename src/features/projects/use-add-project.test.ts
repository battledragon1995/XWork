import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto, ProjectFolderSelectionDto } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import { resetProjectsStore, useProjectsStore } from "./projects-store";
import { useAddProject } from "./use-add-project";

/** Navigation spy shared by every case, so a selected folder's target is observable. */
const navigateMock = vi.fn();

// Replace the backend boundary so no case opens a real folder picker.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(),
  listProjects: vi.fn(async () => []),
  onProjectsChanged: vi.fn(async () => () => {}),
}));

// Keep the real router except for navigation, which is asserted instead of performed.
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return { ...actual, useNavigate: () => navigateMock };
});

const addProjectMock = vi.mocked(projectsIpc.addProject);

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

/** Copy the integration group shares, repeated here so a silent rewording fails a test. */
const INTEGRATION = "XWork ran into a problem it cannot recover from. Restart XWork.";

// Build one promise a case can settle by hand, standing in for the open native picker.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

// Report which adapter functions this case actually used, which is how the "never call
// `open_project`" rule is checked rather than assumed.
function calledAdapterFunctions(): string[] {
  return Object.entries(projectsIpc)
    .filter(([, value]) => vi.isMockFunction(value) && value.mock.calls.length > 0)
    .map(([name]) => name);
}

beforeEach(() => {
  resetProjectsStore();
  vi.clearAllMocks();
  addProjectMock.mockResolvedValue({ outcome: "cancelled" });
});

describe("useAddProject sharing", () => {
  // Verify the store's lock, not component state, is what stops a second native picker: two
  // separately mounted entry points pressed in the same tick send exactly one command.
  it("sends one add_project for two near-simultaneous entry points", async () => {
    const picker = deferred<ProjectFolderSelectionDto>();
    addProjectMock.mockReturnValue(picker.promise);
    const page = renderHook(() => useAddProject());
    const sidebar = renderHook(() => useAddProject());

    await act(async () => {
      void page.result.current.startAdd();
      void sidebar.result.current.startAdd();
    });

    expect(addProjectMock).toHaveBeenCalledOnce();
    expect(page.result.current.isAdding).toBe(true);
    expect(sidebar.result.current.isAdding).toBe(true);

    await act(async () => {
      picker.resolve({ outcome: "cancelled" });
      await picker.promise;
    });

    expect(page.result.current.isAdding).toBe(false);
    expect(sidebar.result.current.isAdding).toBe(false);
  });

  // Verify a start while a flow already runs is dropped rather than queued.
  it("ignores a start while a flow is already running", async () => {
    const picker = deferred<ProjectFolderSelectionDto>();
    addProjectMock.mockReturnValue(picker.promise);
    const view = renderHook(() => useAddProject());

    await act(async () => {
      void view.result.current.startAdd();
    });
    await act(async () => {
      void view.result.current.startAdd();
    });

    expect(addProjectMock).toHaveBeenCalledOnce();

    await act(async () => {
      picker.resolve({ outcome: "cancelled" });
      await picker.promise;
    });
  });
});

describe("useAddProject outcomes", () => {
  // Verify a cancelled picker is a no-op that hands focus back to the exact control that
  // opened it, because the native dialog took focus out of the webview entirely.
  it("shows no failure and restores the initiating focus on cancellation", async () => {
    const pageFocus = vi.fn();
    const sidebarFocus = vi.fn();
    const view = renderHook(() => useAddProject());

    await act(async () => {
      await view.result.current.startAdd(pageFocus);
    });

    expect(view.result.current.failure).toBeNull();
    expect(pageFocus).toHaveBeenCalledOnce();
    expect(sidebarFocus).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();

    await act(async () => {
      await view.result.current.startAdd(sidebarFocus);
    });

    expect(sidebarFocus).toHaveBeenCalledOnce();
    expect(pageFocus).toHaveBeenCalledOnce();
  });

  // Verify a selected folder navigates to its own overview and never calls `open_project`.
  it("navigates to the created project after a selection", async () => {
    addProjectMock.mockResolvedValue({ outcome: "selected", project: PROJECT });
    const restoreFocus = vi.fn();
    const view = renderHook(() => useAddProject());

    await act(async () => {
      await view.result.current.startAdd(restoreFocus);
    });

    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/projects/3f2a");
    expect(view.result.current.failure).toBeNull();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(calledAdapterFunctions()).toEqual(["addProject"]);
  });

  // Verify a duplicate folder keeps the generated `project_id` so its recovery reaches the
  // project that already owns the folder rather than an `undefined` route.
  it("keeps the duplicate project id and navigates to it on demand", async () => {
    addProjectMock.mockRejectedValue(
      new IpcCallError("add_project", { code: "projectAlreadyExists", project_id: "9b1c" }),
    );
    const view = renderHook(() => useAddProject());

    await act(async () => {
      await view.result.current.startAdd();
    });

    expect(view.result.current.failure).toEqual({
      kind: "duplicate",
      message: "That folder is already a project in XWork.",
      projectId: "9b1c",
    });

    act(() => {
      view.result.current.openDuplicate("9b1c");
    });

    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/projects/9b1c");
    expect(calledAdapterFunctions()).toEqual(["addProject"]);
  });
});

describe("useAddProject failures", () => {
  // Verify every documented Add Project code reaches both entry points as the exact copy and
  // recovery group, including all seven invalid-folder reasons.
  it.each([
    [
      { code: "folderPickerFailed" },
      { kind: "retryable", message: "XWork couldn't open the folder picker. Try again." },
    ],
    [
      { code: "invalidProjectFolder", reason: "missing" },
      { kind: "retryable", message: "That folder no longer exists. Pick another folder." },
    ],
    [
      { code: "invalidProjectFolder", reason: "notDirectory" },
      { kind: "retryable", message: "That path is a file, not a folder. Pick a folder." },
    ],
    [
      { code: "invalidProjectFolder", reason: "fileSystemRoot" },
      { kind: "retryable", message: "A drive root can't be a project. Pick a folder inside it." },
    ],
    [
      { code: "invalidProjectFolder", reason: "accessDenied" },
      {
        kind: "retryable",
        message: "XWork can't read that folder. Check its permissions or pick another folder.",
      },
    ],
    [
      { code: "invalidProjectFolder", reason: "notAbsolute" },
      { kind: "retryable", message: "XWork can't use that folder's path. Pick another folder." },
    ],
    [
      { code: "invalidProjectFolder", reason: "notUtf8" },
      { kind: "retryable", message: "XWork can't use that folder's path. Pick another folder." },
    ],
    [
      { code: "invalidProjectFolder", reason: "cannotCanonicalize" },
      { kind: "retryable", message: "XWork can't use that folder's path. Pick another folder." },
    ],
    [
      { code: "invalidDisplayName" },
      {
        kind: "retryable",
        message: "XWork couldn't use that folder's name. Pick a different folder.",
      },
    ],
    [
      { code: "clockFailed" },
      { kind: "retryable", message: "XWork couldn't save the project. Try again." },
    ],
    [
      { code: "persistenceFailed" },
      { kind: "retryable", message: "XWork couldn't save the project. Try again." },
    ],
    [{ code: "unauthorizedWindow" }, { kind: "integration", message: INTEGRATION }],
    [{ code: "aCodeThisBuildDoesNotKnow" }, { kind: "integration", message: INTEGRATION }],
  ])("publishes the failure for %o", async (payload, expected) => {
    addProjectMock.mockRejectedValue(new IpcCallError("add_project", payload));
    const view = renderHook(() => useAddProject());

    await act(async () => {
      await view.result.current.startAdd();
    });

    expect(view.result.current.failure).toEqual(expected);
    expect(view.result.current.isAdding).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // Verify a rejection with no readable payload cannot be mistaken for a retryable one.
  it("treats an unreadable rejection as an integration failure", async () => {
    addProjectMock.mockRejectedValue("permission denied");
    const view = renderHook(() => useAddProject());

    await act(async () => {
      await view.result.current.startAdd();
    });

    expect(view.result.current.failure).toEqual({ kind: "integration", message: INTEGRATION });
  });

  // Verify the failure is shared, so pressing the sidebar action clears the message the page
  // is showing rather than leaving two surfaces disagreeing.
  it("clears the previous failure when a new attempt starts", async () => {
    addProjectMock.mockRejectedValue(new IpcCallError("add_project", { code: "clockFailed" }));
    const page = renderHook(() => useAddProject());
    const sidebar = renderHook(() => useAddProject());

    await act(async () => {
      await page.result.current.startAdd();
    });
    expect(sidebar.result.current.failure).not.toBeNull();

    const picker = deferred<ProjectFolderSelectionDto>();
    addProjectMock.mockReturnValue(picker.promise);
    await act(async () => {
      void sidebar.result.current.startAdd();
    });

    expect(page.result.current.failure).toBeNull();

    await act(async () => {
      picker.resolve({ outcome: "cancelled" });
      await picker.promise;
    });
  });

  // Verify the user can dismiss the message without starting another attempt.
  it("dismisses the failure on demand", async () => {
    addProjectMock.mockRejectedValue(new IpcCallError("add_project", { code: "clockFailed" }));
    const view = renderHook(() => useAddProject());

    await act(async () => {
      await view.result.current.startAdd();
    });

    act(() => {
      view.result.current.dismissFailure();
    });

    expect(view.result.current.failure).toBeNull();
    expect(useProjectsStore.getState().isAdding).toBe(false);
  });

  // Verify retrying after a failure is one more `startAdd`, and that it can then succeed.
  it("allows a retry after a failure", async () => {
    addProjectMock.mockRejectedValueOnce(
      new IpcCallError("add_project", { code: "folderPickerFailed" }),
    );
    const view = renderHook(() => useAddProject());

    await act(async () => {
      await view.result.current.startAdd();
    });

    addProjectMock.mockResolvedValue({ outcome: "selected", project: PROJECT });
    await act(async () => {
      await view.result.current.startAdd();
    });

    expect(addProjectMock).toHaveBeenCalledTimes(2);
    expect(view.result.current.failure).toBeNull();
    expect(navigateMock).toHaveBeenCalledExactlyOnceWith("/projects/3f2a");
  });
});
