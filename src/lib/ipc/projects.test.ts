import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectChangedEventDto,
  ProjectDto,
  ProjectFolderSelectionDto,
} from "@/bindings/projects/projects";
import { IpcCallError } from "./ipc-error";
import { addProject, listProjects, onProjectsChanged } from "./projects";

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
