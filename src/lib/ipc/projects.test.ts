import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectChangedEventDto,
  ProjectDto,
  ProjectFolderSelectionDto,
  RemoveProjectImpactDto,
  RemoveProjectResultDto,
} from "@/bindings/projects/projects";
import { IpcCallError } from "./ipc-error";
import {
  addProject,
  getRemoveProjectImpact,
  listProjects,
  locateProjectFolder,
  onProjectsChanged,
  openProjectFolder,
  removeProject,
  renameProject,
  setProjectPinned,
} from "./projects";

// Replace the desktop boundary so no test reaches the real Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("listProjects", () => {
  // Verify the list command uses the exact backend name and omits `search` when unused.
  it("calls list_projects without arguments when no search is supplied", async () => {
    invokeMock.mockResolvedValue([PROJECT]);

    await expect(listProjects()).resolves.toEqual([PROJECT]);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("list_projects", undefined);
  });

  // Verify a later caller's search term reaches Tauri as the camelCase argument object.
  it("sends a supplied search term as camelCase", async () => {
    invokeMock.mockResolvedValue([]);

    await expect(listProjects("xw")).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("list_projects", { search: "xw" });
  });
});

describe("addProject", () => {
  // Verify the add command uses the exact backend name and takes no argument object.
  it("calls add_project without arguments", async () => {
    const selection: ProjectFolderSelectionDto = { outcome: "selected", project: PROJECT };
    invokeMock.mockResolvedValue(selection);

    await expect(addProject()).resolves.toEqual(selection);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("add_project", undefined);
  });

  // Verify a cancelled picker is propagated unchanged rather than turned into an error.
  it("propagates a cancelled selection unchanged", async () => {
    invokeMock.mockResolvedValue({ outcome: "cancelled" });

    await expect(addProject()).resolves.toEqual({ outcome: "cancelled" });
  });
});

describe("renameProject", () => {
  // Verify the rename command uses the exact backend name and camelCase argument object.
  it("calls rename_project with the project id and the new display name", async () => {
    const renamed: ProjectDto = { ...PROJECT, displayName: "XWork" };
    invokeMock.mockResolvedValue(renamed);

    await expect(renameProject("3f2a", "XWork")).resolves.toEqual(renamed);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("rename_project", {
      projectId: "3f2a",
      displayName: "XWork",
    });
  });
});

describe("setProjectPinned", () => {
  // Verify both pin states reach the backend as the exact boolean the caller asked for.
  it.each([
    ["pins", true],
    ["unpins", false],
  ])("%s a project through set_project_pinned", async (_label, isPinned) => {
    const updated: ProjectDto = { ...PROJECT, isPinned };
    invokeMock.mockResolvedValue(updated);

    await expect(setProjectPinned("3f2a", isPinned)).resolves.toEqual(updated);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("set_project_pinned", {
      projectId: "3f2a",
      isPinned,
    });
  });
});

describe("openProjectFolder", () => {
  // Verify the opener command is named exactly and resolves without a payload.
  it("calls open_project_folder with the project id", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(openProjectFolder("3f2a")).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("open_project_folder", {
      projectId: "3f2a",
    });
  });
});

describe("locateProjectFolder", () => {
  // Verify relocation uses the exact command name and returns the selection unchanged.
  it("calls locate_project_folder and returns the selection", async () => {
    const selection: ProjectFolderSelectionDto = { outcome: "selected", project: PROJECT };
    invokeMock.mockResolvedValue(selection);

    await expect(locateProjectFolder("3f2a")).resolves.toEqual(selection);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("locate_project_folder", {
      projectId: "3f2a",
    });
  });

  // Verify a cancelled relocation stays a result, so callers do not need a catch block.
  it("propagates a cancelled relocation unchanged", async () => {
    invokeMock.mockResolvedValue({ outcome: "cancelled" });

    await expect(locateProjectFolder("3f2a")).resolves.toEqual({ outcome: "cancelled" });
  });
});

describe("getRemoveProjectImpact", () => {
  // Verify impact inspection is a separate command and returns the generated DTO untouched.
  it("calls get_remove_project_impact with the project id", async () => {
    const impact: RemoveProjectImpactDto = {
      projectId: "3f2a",
      displayName: "xwork",
      rootPath: "D:\\Self\\XWork",
      sessionCount: 2,
      runningProcessCount: 1,
      unsavedFileCount: 0,
    };
    invokeMock.mockResolvedValue(impact);

    await expect(getRemoveProjectImpact("3f2a")).resolves.toEqual(impact);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("get_remove_project_impact", {
      projectId: "3f2a",
    });
  });
});

describe("removeProject", () => {
  // Verify the only call shape the feature ever makes: an explicitly confirmed removal.
  it("calls remove_project with confirmed set to true", async () => {
    const result: RemoveProjectResultDto = { projectId: "3f2a" };
    invokeMock.mockResolvedValue(result);

    await expect(removeProject("3f2a", true)).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("remove_project", {
      projectId: "3f2a",
      confirmed: true,
    });
  });

  // Verify the wrapper forwards the flag it is given rather than hard-coding one, so the
  // "always confirmed" rule stays a feature decision the feature tests can observe.
  it("forwards the confirmation flag it was given", async () => {
    invokeMock.mockResolvedValue({ projectId: "3f2a" });

    await removeProject("3f2a", false);

    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("remove_project", {
      projectId: "3f2a",
      confirmed: false,
    });
  });
});

describe("Projects error normalization", () => {
  // Verify a tagged backend error keeps its payload, including the snake_case `project_id`
  // the generated binding declares. Guessing a camelCase name here would break navigation.
  it("preserves a tagged error payload with its generated field names", async () => {
    invokeMock.mockRejectedValue({ code: "projectAlreadyExists", project_id: "3f2a" });

    const error = await addProject().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IpcCallError);
    expect((error as IpcCallError<{ code: string }>).command).toBe("add_project");
    expect((error as IpcCallError<{ code: string }>).payload).toEqual({
      code: "projectAlreadyExists",
      project_id: "3f2a",
    });
  });

  // Verify the nested `reason` of an invalid folder survives normalization untouched.
  it("preserves the invalid-folder reason", async () => {
    invokeMock.mockRejectedValue({ code: "invalidProjectFolder", reason: "fileSystemRoot" });

    const error = await addProject().catch((thrown: unknown) => thrown);

    expect((error as IpcCallError<{ code: string }>).payload).toEqual({
      code: "invalidProjectFolder",
      reason: "fileSystemRoot",
    });
  });

  // Verify the nested `impact` of a re-confirmation request survives normalization, because
  // the remove dialog rebuilds its facts from exactly that payload.
  it("preserves the impact carried by confirmationRequired", async () => {
    const impact: RemoveProjectImpactDto = {
      projectId: "3f2a",
      displayName: "xwork",
      rootPath: "D:\\Self\\XWork",
      sessionCount: 1,
      runningProcessCount: 0,
      unsavedFileCount: 0,
    };
    invokeMock.mockRejectedValue({ code: "confirmationRequired", impact });

    const error = await removeProject("3f2a", true).catch((thrown: unknown) => thrown);

    expect((error as IpcCallError<{ code: string }>).command).toBe("remove_project");
    expect((error as IpcCallError<{ code: string }>).payload).toEqual({
      code: "confirmationRequired",
      impact,
    });
  });

  // Verify every action wrapper names its own command on failure and keeps the generated
  // snake_case fields, which is what the recovery actions of the feature navigate with.
  it.each([
    ["rename_project", () => renameProject("3f2a", "XWork")],
    ["set_project_pinned", () => setProjectPinned("3f2a", true)],
    ["open_project_folder", () => openProjectFolder("3f2a")],
    ["locate_project_folder", () => locateProjectFolder("3f2a")],
    ["get_remove_project_impact", () => getRemoveProjectImpact("3f2a")],
    ["remove_project", () => removeProject("3f2a", true)],
  ])("names %s and keeps its tagged payload", async (command, call) => {
    invokeMock.mockRejectedValue({ code: "projectNotFound", project_id: "3f2a" });

    const error = await call().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IpcCallError);
    expect((error as IpcCallError<{ code: string }>).command).toBe(command);
    expect((error as IpcCallError<{ code: string }>).payload).toEqual({
      code: "projectNotFound",
      project_id: "3f2a",
    });
  });

  // Verify an unrecognized rejection stays `null` for an action command too, so the feature
  // classifies it as an integration failure instead of guessing a code.
  it("leaves an unrecognized action rejection with a null payload", async () => {
    invokeMock.mockRejectedValue("permission denied");

    const error = await openProjectFolder("3f2a").catch((thrown: unknown) => thrown);

    expect((error as IpcCallError<{ code: string }>).payload).toBeNull();
    expect((error as IpcCallError<{ code: string }>).command).toBe("open_project_folder");
  });

  // Verify a rejection that is not shaped like `{ code }` cannot be mistaken for one.
  it.each([
    ["a string rejection", "permission denied"],
    ["a null rejection", null],
    ["an object without a code", { message: "boom" }],
    ["an object whose code is not a string", { code: 42 }],
  ])("normalizes %s to a null payload", async (_label, rejection) => {
    invokeMock.mockRejectedValue(rejection);

    const error = await listProjects().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(IpcCallError);
    expect((error as IpcCallError<{ code: string }>).payload).toBeNull();
    expect((error as IpcCallError<{ code: string }>).command).toBe("list_projects");
  });
});

describe("onProjectsChanged", () => {
  // Verify the invalidation event is subscribed by its exact name, delivers only the payload,
  // and hands the caller back the unlisten function Tauri produced.
  it("subscribes to projects://changed and unwraps the payload", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const changed: ProjectChangedEventDto = { change: "added", projectId: "3f2a" };

    const returned = await onProjectsChanged(handler);

    expect(listenMock.mock.calls[0]?.[0]).toBe("projects://changed");
    expect(returned).toBe(unlisten);

    const forward = listenMock.mock.calls[0]?.[1] as (event: {
      payload: ProjectChangedEventDto;
    }) => void;
    forward({ payload: changed });

    expect(handler).toHaveBeenCalledExactlyOnceWith(changed);
  });
});
