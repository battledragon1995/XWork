import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ProjectDto, RemoveProjectImpactDto } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import { resetProjectsStore, useProjectsStore } from "./projects-store";
import { useProjectActions } from "./use-project-actions";

// Replace the backend boundary so no case reaches Tauri, the filesystem or a native picker.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(),
  getRemoveProjectImpact: vi.fn(),
  listProjects: vi.fn(async () => []),
  locateProjectFolder: vi.fn(),
  onProjectsChanged: vi.fn(async () => () => {}),
  openProjectFolder: vi.fn(),
  removeProject: vi.fn(),
  renameProject: vi.fn(),
  setProjectPinned: vi.fn(),
}));

const renameProjectMock = vi.mocked(projectsIpc.renameProject);
const setProjectPinnedMock = vi.mocked(projectsIpc.setProjectPinned);
const openProjectFolderMock = vi.mocked(projectsIpc.openProjectFolder);
const locateProjectFolderMock = vi.mocked(projectsIpc.locateProjectFolder);
const getRemoveProjectImpactMock = vi.mocked(projectsIpc.getRemoveProjectImpact);
const removeProjectMock = vi.mocked(projectsIpc.removeProject);

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

/** A second project, so a locked card is visibly independent of the rest of the grid. */
const OTHER: ProjectDto = { ...PROJECT, id: "9b1c", displayName: "recipe-api" };

/** Impact with no runtime facts, which is what Stage 4 actually returns. */
const EMPTY_IMPACT: RemoveProjectImpactDto = {
  projectId: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  sessionCount: 0,
  runningProcessCount: 0,
  unsavedFileCount: 0,
};

/** Store refresh spy, so an explicit refresh after a success is observable. */
let refreshSpy: Mock<() => void>;

/** Removal callback the route uses to move focus off the destroyed card. */
let onRemovedSpy: Mock<() => void>;

// Build one promise a case can settle by hand, which is how pending state is observed.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

// Render the hook with the seeded store, mirroring how the route mounts it.
function renderActions() {
  return renderHook(() => useProjectActions({ onRemoved: onRemovedSpy }));
}

beforeEach(() => {
  resetProjectsStore();
  vi.clearAllMocks();
  refreshSpy = vi.fn<() => void>();
  onRemovedSpy = vi.fn<() => void>();
  useProjectsStore.setState({ projects: [PROJECT, OTHER], status: "ready", refresh: refreshSpy });
  renameProjectMock.mockResolvedValue(PROJECT);
  setProjectPinnedMock.mockResolvedValue(PROJECT);
  openProjectFolderMock.mockResolvedValue(undefined);
  locateProjectFolderMock.mockResolvedValue({ outcome: "cancelled" });
  getRemoveProjectImpactMock.mockResolvedValue(EMPTY_IMPACT);
  removeProjectMock.mockResolvedValue({ projectId: "3f2a" });
});

describe("rename", () => {
  // Verify opening the dialog snapshots the project the menu was on.
  it("snapshots the rename target", () => {
    const view = renderActions();

    act(() => {
      view.result.current.openRename(PROJECT);
    });

    expect(view.result.current.renameTarget).toEqual(PROJECT);
  });

  // Verify a successful rename sends the exact arguments, closes the dialog and asks the
  // store for fresh data rather than editing the list in place.
  it("renames, closes the dialog and refreshes", async () => {
    const view = renderActions();
    act(() => {
      view.result.current.openRename(PROJECT);
    });

    await act(async () => {
      await view.result.current.rename("3f2a", "XWork");
    });

    expect(renameProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a", "XWork");
    expect(view.result.current.renameTarget).toBeNull();
    expect(view.result.current.failure).toBeNull();
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect(useProjectsStore.getState().projects).toEqual([PROJECT, OTHER]);
  });

  // Verify a rejected name keeps the dialog open so the user can correct it in place.
  it("keeps the dialog open for invalidDisplayName", async () => {
    renameProjectMock.mockRejectedValue(
      new IpcCallError("rename_project", { code: "invalidDisplayName" }),
    );
    const view = renderActions();
    act(() => {
      view.result.current.openRename(PROJECT);
    });

    await act(async () => {
      await view.result.current.rename("3f2a", "  ");
    });

    expect(view.result.current.renameTarget).toEqual(PROJECT);
    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "Enter a name between 1 and 255 characters, without control characters.",
      retry: null,
    });
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  // Verify a project that disappeared closes the dialog, because confirming a rename for a
  // row that no longer exists is meaningless, and moves the message to the page line.
  it("closes the dialog and refreshes for projectNotFound", async () => {
    renameProjectMock.mockRejectedValue(
      new IpcCallError("rename_project", { code: "projectNotFound", project_id: "3f2a" }),
    );
    const view = renderActions();
    act(() => {
      view.result.current.openRename(PROJECT);
    });

    await act(async () => {
      await view.result.current.rename("3f2a", "XWork");
    });

    expect(view.result.current.renameTarget).toBeNull();
    expect(view.result.current.failure).toEqual({
      kind: "gone",
      message: "xwork is no longer in XWork.",
    });
    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  // Verify cancelling calls no command and clears nothing else.
  it("closes the dialog without calling a command", () => {
    const view = renderActions();
    act(() => {
      view.result.current.openRename(PROJECT);
    });

    act(() => {
      view.result.current.closeRename();
    });

    expect(view.result.current.renameTarget).toBeNull();
    expect(renameProjectMock).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });
});

describe("pin", () => {
  // Verify the pin command always receives the inverted value of the snapshot it was given.
  it.each([
    ["pins an unpinned project", false, true],
    ["unpins a pinned project", true, false],
  ])("%s", async (_label, isPinned, expected) => {
    const view = renderActions();

    await act(async () => {
      await view.result.current.togglePinned({ ...PROJECT, isPinned });
    });

    expect(setProjectPinnedMock).toHaveBeenCalledExactlyOnceWith("3f2a", expected);
    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  // Verify a failed write keeps the exact operation available for another attempt.
  it("offers the same operation again after persistenceFailed", async () => {
    setProjectPinnedMock.mockRejectedValue(
      new IpcCallError("set_project_pinned", { code: "persistenceFailed" }),
    );
    const view = renderActions();

    await act(async () => {
      await view.result.current.togglePinned(PROJECT);
    });

    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "XWork couldn't save that change. Try again.",
      retry: "pin",
    });

    setProjectPinnedMock.mockResolvedValue(PROJECT);
    await act(async () => {
      await view.result.current.retryFailure();
    });

    expect(setProjectPinnedMock).toHaveBeenCalledTimes(2);
    expect(view.result.current.failure).toBeNull();
  });
});

describe("openFolder", () => {
  // Verify the opener is asked for the exact project and nothing is written locally.
  it("opens the registered root", async () => {
    const view = renderActions();

    await act(async () => {
      await view.result.current.openFolder(PROJECT);
    });

    expect(openProjectFolderMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(view.result.current.failure).toBeNull();
  });

  // Verify a path that became unusable offers relocation instead of a pointless retry, and
  // refreshes so the card can flip to `Unavailable`.
  it("offers relocation for projectUnavailable", async () => {
    openProjectFolderMock.mockRejectedValue(
      new IpcCallError("open_project_folder", { code: "projectUnavailable", reason: "missing" }),
    );
    const view = renderActions();

    await act(async () => {
      await view.result.current.openFolder(PROJECT);
    });

    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "XWork can't open that folder any more.",
      retry: "locate",
    });
    expect(refreshSpy).toHaveBeenCalledOnce();

    await act(async () => {
      await view.result.current.retryFailure();
    });

    expect(locateProjectFolderMock).toHaveBeenCalledExactlyOnceWith("3f2a");
  });

  // Verify a failed opener offers the same operation again.
  it("offers another attempt for openFolderFailed", async () => {
    openProjectFolderMock.mockRejectedValue(
      new IpcCallError("open_project_folder", { code: "openFolderFailed" }),
    );
    const view = renderActions();

    await act(async () => {
      await view.result.current.openFolder(PROJECT);
    });

    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "XWork couldn't open the folder for xwork. Try again.",
      retry: "openFolder",
    });
  });
});

describe("locateFolder", () => {
  // Verify a selected folder refreshes the list so the card returns to `Available`.
  it("refreshes after a selected folder", async () => {
    locateProjectFolderMock.mockResolvedValue({ outcome: "selected", project: PROJECT });
    const view = renderActions();

    await act(async () => {
      await view.result.current.locateFolder(PROJECT);
    });

    expect(locateProjectFolderMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect(view.result.current.failure).toBeNull();
  });

  // Verify cancelling the picker changes nothing at all and shows no message.
  it("changes nothing when the picker is cancelled", async () => {
    const view = renderActions();

    await act(async () => {
      await view.result.current.locateFolder(PROJECT);
    });

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(view.result.current.failure).toBeNull();
  });

  // Verify a folder that is already registered keeps the generated id for its recovery.
  it("keeps the duplicate project id", async () => {
    locateProjectFolderMock.mockRejectedValue(
      new IpcCallError("locate_project_folder", {
        code: "projectAlreadyExists",
        project_id: "9b1c",
      }),
    );
    const view = renderActions();

    await act(async () => {
      await view.result.current.locateFolder(PROJECT);
    });

    expect(view.result.current.failure).toEqual({
      kind: "duplicate",
      message: "That folder is already another project in XWork.",
      projectId: "9b1c",
    });
  });
});

describe("remove", () => {
  // Verify the confirmation is always preceded by a real impact read.
  it("reads the impact before opening the dialog", async () => {
    const view = renderActions();

    await act(async () => {
      await view.result.current.requestRemove(PROJECT);
    });

    expect(getRemoveProjectImpactMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(view.result.current.removeTarget).toEqual({ project: PROJECT, impact: EMPTY_IMPACT });
  });

  // Verify a failed inspection never opens a dialog, because confirming with missing facts
  // would ask the user to accept consequences XWork could not measure.
  it("opens no dialog when the impact read fails", async () => {
    getRemoveProjectImpactMock.mockRejectedValue(
      new IpcCallError("get_remove_project_impact", { code: "runtimeInspectionFailed" }),
    );
    const view = renderActions();

    await act(async () => {
      await view.result.current.requestRemove(PROJECT);
    });

    expect(view.result.current.removeTarget).toBeNull();
    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "XWork couldn't check what is still running for xwork.",
      retry: "impact",
    });

    getRemoveProjectImpactMock.mockResolvedValue(EMPTY_IMPACT);
    await act(async () => {
      await view.result.current.retryFailure();
    });

    expect(view.result.current.removeTarget).not.toBeNull();
  });

  // Verify the only removal call the feature ever makes is an explicitly confirmed one, and
  // that success closes the dialog, refreshes and tells the caller to move focus.
  it("removes with confirmed set to true and reports the removal", async () => {
    const view = renderActions();
    await act(async () => {
      await view.result.current.requestRemove(PROJECT);
    });

    await act(async () => {
      await view.result.current.confirmRemove("3f2a");
    });

    expect(removeProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a", true);
    expect(view.result.current.removeTarget).toBeNull();
    expect(refreshSpy).toHaveBeenCalledOnce();
    expect(onRemovedSpy).toHaveBeenCalledOnce();
  });

  // Verify a re-confirmation request rebuilds the facts from the payload instead of keeping
  // the stale ones the dialog was opened with.
  it("rebuilds the facts from confirmationRequired", async () => {
    const refreshed: RemoveProjectImpactDto = { ...EMPTY_IMPACT, sessionCount: 2 };
    removeProjectMock.mockRejectedValue(
      new IpcCallError("remove_project", { code: "confirmationRequired", impact: refreshed }),
    );
    const view = renderActions();
    await act(async () => {
      await view.result.current.requestRemove(PROJECT);
    });

    await act(async () => {
      await view.result.current.confirmRemove("3f2a");
    });

    expect(view.result.current.removeTarget).toEqual({ project: PROJECT, impact: refreshed });
    expect(view.result.current.failure).toBeNull();
    expect(onRemovedSpy).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  // Verify a cleanup failure keeps the project and the dialog, with the removal retryable.
  it("keeps the dialog open after runtimeCleanupFailed", async () => {
    removeProjectMock.mockRejectedValue(
      new IpcCallError("remove_project", { code: "runtimeCleanupFailed" }),
    );
    const view = renderActions();
    await act(async () => {
      await view.result.current.requestRemove(PROJECT);
    });

    await act(async () => {
      await view.result.current.confirmRemove("3f2a");
    });

    expect(view.result.current.removeTarget).not.toBeNull();
    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "XWork couldn't stop everything for xwork, so it was not removed.",
      retry: "remove",
    });
    expect(onRemovedSpy).not.toHaveBeenCalled();
  });

  // Verify a project removed elsewhere closes the dialog rather than confirming into a void.
  it("closes the dialog for projectNotFound", async () => {
    removeProjectMock.mockRejectedValue(
      new IpcCallError("remove_project", { code: "projectNotFound", project_id: "3f2a" }),
    );
    const view = renderActions();
    await act(async () => {
      await view.result.current.requestRemove(PROJECT);
    });

    await act(async () => {
      await view.result.current.confirmRemove("3f2a");
    });

    expect(view.result.current.removeTarget).toBeNull();
    expect(view.result.current.failure).toEqual({
      kind: "gone",
      message: "xwork is no longer in XWork.",
    });
    expect(refreshSpy).toHaveBeenCalledOnce();
  });

  // Verify closing the confirmation calls no command.
  it("closes the confirmation without calling a command", async () => {
    const view = renderActions();
    await act(async () => {
      await view.result.current.requestRemove(PROJECT);
    });

    act(() => {
      view.result.current.closeRemove();
    });

    expect(view.result.current.removeTarget).toBeNull();
    expect(removeProjectMock).not.toHaveBeenCalled();
  });
});

describe("pending operations", () => {
  // Verify exactly the target project is marked pending, so the route locks that one card and
  // leaves every other card usable.
  it("marks only the target project pending", async () => {
    const pending = deferred<void>();
    openProjectFolderMock.mockReturnValue(pending.promise);
    const view = renderActions();

    await act(async () => {
      void view.result.current.openFolder(PROJECT);
    });

    expect(view.result.current.pendingProjectId).toBe("3f2a");
    expect(view.result.current.pendingOperation).toBe("openFolder");

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });

    expect(view.result.current.pendingProjectId).toBeNull();
    expect(view.result.current.pendingOperation).toBeNull();
  });

  // Verify a second operation while one is still running is dropped, which is what keeps a
  // fast double pin from sending two writes whose order nobody controls.
  it("drops a second operation while one is pending", async () => {
    const pending = deferred<ProjectDto>();
    setProjectPinnedMock.mockReturnValue(pending.promise);
    const view = renderActions();

    await act(async () => {
      void view.result.current.togglePinned(PROJECT);
    });
    await act(async () => {
      void view.result.current.togglePinned(PROJECT);
    });

    expect(setProjectPinnedMock).toHaveBeenCalledOnce();

    await act(async () => {
      pending.resolve(PROJECT);
      await pending.promise;
    });
  });

  // Verify each operation publishes its own marker, which is what picks the pending label.
  it.each([
    [
      "rename",
      async (actions: ReturnType<typeof renderActions>["result"]["current"]) => {
        actions.openRename(PROJECT);
        void actions.rename("3f2a", "XWork");
      },
    ],
    [
      "pin",
      (actions: ReturnType<typeof renderActions>["result"]["current"]) => {
        void actions.togglePinned(PROJECT);
      },
    ],
    [
      "locate",
      (actions: ReturnType<typeof renderActions>["result"]["current"]) => {
        void actions.locateFolder(PROJECT);
      },
    ],
    [
      "impact",
      (actions: ReturnType<typeof renderActions>["result"]["current"]) => {
        void actions.requestRemove(PROJECT);
      },
    ],
  ])("publishes %s as the pending operation", async (operation, start) => {
    const never = deferred<never>();
    renameProjectMock.mockReturnValue(never.promise);
    setProjectPinnedMock.mockReturnValue(never.promise);
    locateProjectFolderMock.mockReturnValue(never.promise);
    getRemoveProjectImpactMock.mockReturnValue(never.promise);
    const view = renderActions();

    await act(async () => {
      await start(view.result.current);
    });

    expect(view.result.current.pendingOperation).toBe(operation);
    expect(view.result.current.pendingProjectId).toBe("3f2a");
  });

  // Verify a command that answers after the route unmounted publishes nothing at all.
  it("ignores a result that arrives after unmount", async () => {
    const pending = deferred<ProjectDto>();
    setProjectPinnedMock.mockReturnValue(pending.promise);
    const view = renderActions();

    await act(async () => {
      void view.result.current.togglePinned(PROJECT);
    });
    view.unmount();

    await act(async () => {
      pending.resolve(PROJECT);
      await pending.promise;
    });

    expect(refreshSpy).not.toHaveBeenCalled();
  });
});

describe("failure dismissal", () => {
  // Verify the page error line can be closed by the user.
  it("clears the failure on demand", async () => {
    setProjectPinnedMock.mockRejectedValue(
      new IpcCallError("set_project_pinned", { code: "persistenceFailed" }),
    );
    const view = renderActions();
    await act(async () => {
      await view.result.current.togglePinned(PROJECT);
    });

    act(() => {
      view.result.current.dismissFailure();
    });

    expect(view.result.current.failure).toBeNull();
  });

  // Verify starting the next operation clears the previous message on its own.
  it("clears the previous failure when the next operation starts", async () => {
    setProjectPinnedMock.mockRejectedValue(
      new IpcCallError("set_project_pinned", { code: "persistenceFailed" }),
    );
    const view = renderActions();
    await act(async () => {
      await view.result.current.togglePinned(PROJECT);
    });
    expect(view.result.current.failure).not.toBeNull();

    await act(async () => {
      await view.result.current.openFolder(PROJECT);
    });

    expect(view.result.current.failure).toBeNull();
  });

  // Verify a failure with no retry target cannot be repeated by the retry action.
  it("does nothing when retrying a failure that has no retry target", async () => {
    setProjectPinnedMock.mockRejectedValue(
      new IpcCallError("set_project_pinned", { code: "removalInProgress", project_id: "3f2a" }),
    );
    const view = renderActions();
    await act(async () => {
      await view.result.current.togglePinned(PROJECT);
    });

    await act(async () => {
      await view.result.current.retryFailure();
    });

    expect(setProjectPinnedMock).toHaveBeenCalledOnce();
    expect(view.result.current.failure).toEqual({
      kind: "retryable",
      message: "xwork is being removed. Wait for that to finish.",
      retry: null,
    });
  });
});
