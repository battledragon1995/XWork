import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto, ProjectUnavailableReasonDto } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listProjects } from "@/lib/ipc/projects";
import {
  classifyActionFailure,
  classifyAddFailure,
  classifyListFailure,
  unavailableReasonMessage,
} from "./project-error-copy";
import type { ProjectsSnapshot } from "./use-projects";
import { sanitizeSearch, useProjectSearch } from "./use-project-search";

// Replace the backend boundary so no case reaches Tauri or the real project store.
vi.mock("@/lib/ipc/projects", () => ({
  listProjects: vi.fn(),
}));

const listProjectsMock = vi.mocked(listProjects);

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

/** A second project so a filtered result differs visibly from the unfiltered list. */
const OTHER: ProjectDto = { ...PROJECT, id: "9b1c", displayName: "recipe-api" };

/** Copy the integration group shares, repeated here so a silent rewording fails a test. */
const INTEGRATION = "XWork ran into a problem it cannot recover from. Restart XWork.";

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

// Build one stand-in for the shared store snapshot the route hands the hook.
function snapshot(overrides: Partial<ProjectsSnapshot> = {}): ProjectsSnapshot {
  return {
    status: "ready",
    projects: [PROJECT, OTHER],
    failure: null,
    isAdding: false,
    addFailure: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

// Render the hook with a snapshot the case can replace, mirroring how the route re-renders it.
function renderSearch(initial: ProjectsSnapshot = snapshot()) {
  return renderHook((source: ProjectsSnapshot) => useProjectSearch(source), {
    initialProps: initial,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  listProjectsMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sanitizeSearch", () => {
  // Verify control characters never reach the backend, which is what makes `invalidSearch`
  // unreachable from the search box.
  it("removes control characters", () => {
    expect(sanitizeSearch("xw\u0000o\u001frk\u007f")).toBe("xwork");
  });

  // Verify both ends are trimmed, matching how the backend normalizes the filter.
  it("trims both ends", () => {
    expect(sanitizeSearch("   xwork \t ")).toBe("xwork");
  });

  // Verify the cap counts Unicode scalar values, so one astral emoji is one unit exactly as
  // the backend's `chars().count()` measures it.
  it("truncates to 256 scalar values and counts an emoji once", () => {
    const long = "😀".repeat(300);

    const sanitized = sanitizeSearch(long);

    expect(Array.from(sanitized)).toHaveLength(256);
    expect(sanitized.length).toBe(512);
  });

  // Verify a filter that is only whitespace is the same as no filter at all.
  it("reduces a whitespace-only query to nothing", () => {
    expect(sanitizeSearch("  \t \n ")).toBe("");
  });
});

describe("useProjectSearch input handling", () => {
  // Verify the visible field is never rewritten under the user's cursor.
  it("shows the raw text immediately and sends the sanitized text", async () => {
    const view = renderSearch();

    act(() => {
      view.result.current.setQuery("  xw\u0000ork  ");
    });

    expect(view.result.current.query).toBe("  xw\u0000ork  ");
    expect(listProjectsMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(listProjectsMock).toHaveBeenCalledExactlyOnceWith("xwork");
  });

  // Verify a burst of keystrokes inside the quiet interval collapses into one query.
  it("issues one query for rapid typing", async () => {
    const view = renderSearch();

    act(() => {
      view.result.current.setQuery("x");
    });
    act(() => {
      vi.advanceTimersByTime(120);
      view.result.current.setQuery("xw");
    });
    act(() => {
      vi.advanceTimersByTime(120);
      view.result.current.setQuery("xwo");
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(listProjectsMock).toHaveBeenCalledExactlyOnceWith("xwo");
  });

  // Verify an emptied field cancels the pending query and falls back to the shared snapshot.
  it("cancels pending work and uses the unfiltered list for an empty query", async () => {
    const source = snapshot();
    const view = renderSearch(source);

    act(() => {
      view.result.current.setQuery("xw");
    });
    act(() => {
      view.result.current.setQuery("   ");
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(listProjectsMock).not.toHaveBeenCalled();
    expect(view.result.current.projects).toEqual(source.projects);
    expect(view.result.current.status).toBe("ready");
  });

  // Verify `clear` empties the query and hands the grid back to the unfiltered snapshot.
  it("clears the query and returns the unfiltered list", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);
    const source = snapshot();
    const view = renderSearch(source);

    act(() => {
      view.result.current.setQuery("xwork");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(view.result.current.projects).toEqual([PROJECT]);

    act(() => {
      view.result.current.clear();
    });

    expect(view.result.current.query).toBe("");
    expect(view.result.current.projects).toEqual(source.projects);
  });

  // Verify the grid keeps its current content while a new query is in flight.
  it("keeps the previous content while a query runs", async () => {
    const source = snapshot();
    const pending = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);
    const view = renderSearch(source);

    act(() => {
      view.result.current.setQuery("xw");
    });

    expect(view.result.current.status).toBe("loading");
    expect(view.result.current.projects).toEqual(source.projects);

    await act(async () => {
      vi.advanceTimersByTime(200);
      pending.resolve([PROJECT]);
      await pending.promise;
    });

    expect(view.result.current.status).toBe("ready");
    expect(view.result.current.projects).toEqual([PROJECT]);
  });
});

describe("useProjectSearch request ordering", () => {
  // Verify an older answer cannot overwrite a newer one.
  it("publishes only the newest query result", async () => {
    const first = deferred<ProjectDto[]>();
    const second = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = renderSearch();

    act(() => {
      view.result.current.setQuery("xw");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    act(() => {
      view.result.current.setQuery("xwo");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await act(async () => {
      second.resolve([OTHER]);
      await second.promise;
    });
    await act(async () => {
      first.resolve([PROJECT]);
      await first.promise;
    });

    expect(view.result.current.projects).toEqual([OTHER]);
  });

  // Verify a query that answers after the route unmounted publishes nothing, which is what
  // keeps navigating away mid-search from warning about an update on an unmounted component.
  it("ignores a result that arrives after unmount", async () => {
    const source = snapshot();
    const pending = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);
    const view = renderSearch(source);

    act(() => {
      view.result.current.setQuery("xw");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(view.result.current.status).toBe("loading");

    view.unmount();

    await act(async () => {
      pending.resolve([PROJECT]);
      await pending.promise;
    });

    // The last rendered value is the unfiltered fallback: the late answer published nothing,
    // so neither the result list nor the status moved on after unmount.
    expect(view.result.current.projects).toEqual(source.projects);
    expect(view.result.current.status).toBe("loading");
  });

  // Verify a pending debounce is dropped on unmount rather than firing into a dead hook.
  it("drops a pending debounce on unmount", async () => {
    const view = renderSearch();

    act(() => {
      view.result.current.setQuery("xw");
    });
    view.unmount();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(listProjectsMock).not.toHaveBeenCalled();
  });
});

describe("useProjectSearch invalidation", () => {
  // Verify a store refresh — which is how `projects://changed` and window focus arrive — reruns
  // the active query so the filtered grid catches the same change the sidebar just got.
  it("reruns the active query when the shared snapshot changes", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);
    const view = renderSearch();

    act(() => {
      view.result.current.setQuery("xw");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(listProjectsMock).toHaveBeenCalledOnce();

    listProjectsMock.mockResolvedValue([PROJECT, OTHER]);
    await act(async () => {
      view.rerender(snapshot({ projects: [PROJECT, OTHER] }));
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    expect(listProjectsMock).toHaveBeenLastCalledWith("xw");
    expect(view.result.current.projects).toEqual([PROJECT, OTHER]);
  });

  // Verify a snapshot change with no active query starts no search query at all.
  it("starts no query when the snapshot changes without an active query", async () => {
    const view = renderSearch();

    await act(async () => {
      view.rerender(snapshot({ projects: [PROJECT] }));
    });

    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  // Verify `refresh` reruns the active query immediately, without waiting out the debounce.
  it("reruns the active query on refresh", async () => {
    const view = renderSearch();

    act(() => {
      view.result.current.setQuery("xw");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    await act(async () => {
      view.result.current.refresh();
    });

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    expect(listProjectsMock).toHaveBeenLastCalledWith("xw");
  });

  // Verify `refresh` delegates to the shared store when no query is active, so one retry
  // control works for both the filtered and the unfiltered grid.
  it("delegates refresh to the shared store without an active query", async () => {
    const source = snapshot();
    const view = renderSearch(source);

    await act(async () => {
      view.result.current.refresh();
    });

    expect(source.refresh).toHaveBeenCalledOnce();
    expect(listProjectsMock).not.toHaveBeenCalled();
  });
});

describe("useProjectSearch failures", () => {
  // Verify a failed search offers the same two recovery paths as a failed list.
  it.each([
    [
      "persistenceFailed",
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
      { kind: "retryable", message: "XWork couldn't load your projects." },
    ],
    [
      "invalidSearch",
      new IpcCallError("list_projects", { code: "invalidSearch" }),
      { kind: "integration", message: INTEGRATION },
    ],
  ])("classifies a %s search failure", async (_label, rejection, expected) => {
    listProjectsMock.mockRejectedValue(rejection);
    const view = renderSearch();

    act(() => {
      view.result.current.setQuery("xw");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(view.result.current.status).toBe("failed");
    expect(view.result.current.failure).toEqual(expected);
  });
});

describe("classifyListFailure", () => {
  // Verify the list classifier is the shared source for both surfaces' load errors.
  it.each([
    [
      "persistenceFailed",
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
      { kind: "retryable", message: "XWork couldn't load your projects." },
    ],
    [
      "unauthorizedWindow",
      new IpcCallError("list_projects", { code: "unauthorizedWindow" }),
      { kind: "integration", message: INTEGRATION },
    ],
    [
      "an unreadable payload",
      new IpcCallError("list_projects", null),
      { kind: "integration", message: INTEGRATION },
    ],
  ])("maps %s", (_label, rejection, expected) => {
    expect(classifyListFailure(rejection)).toEqual(expected);
  });
});

describe("classifyAddFailure", () => {
  // Verify every documented Add Project code produces the exact FE-002 copy, so both entry
  // points and the Welcome screen say the same thing about the same failure.
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
      { code: "projectAlreadyExists", project_id: "9b1c" },
      {
        kind: "duplicate",
        message: "That folder is already a project in XWork.",
        projectId: "9b1c",
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
    [{ code: "somethingNewer" }, { kind: "integration", message: INTEGRATION }],
  ])("maps %o", (payload, expected) => {
    expect(classifyAddFailure(new IpcCallError("add_project", payload))).toEqual(expected);
  });

  // Verify a rejection that never carried a tagged payload is terminal, not retryable.
  it("maps an unreadable rejection to the integration group", () => {
    expect(classifyAddFailure(new Error("boom"))).toEqual({
      kind: "integration",
      message: INTEGRATION,
    });
  });
});

describe("classifyActionFailure", () => {
  // Verify each documented action code produces the exact message, group and retry the table
  // in FE-004 assigns it, including the generated snake_case payload fields.
  it.each([
    [
      "invalidProjectId",
      { code: "invalidProjectId" },
      "rename" as const,
      { kind: "integration", message: INTEGRATION },
    ],
    [
      "projectNotFound",
      { code: "projectNotFound", project_id: "3f2a" },
      "pin" as const,
      { kind: "gone", message: "xwork is no longer in XWork." },
    ],
    [
      "invalidDisplayName",
      { code: "invalidDisplayName" },
      "rename" as const,
      {
        kind: "retryable",
        message: "Enter a name between 1 and 255 characters, without control characters.",
        retry: null,
      },
    ],
    [
      "removalInProgress",
      { code: "removalInProgress", project_id: "3f2a" },
      "pin" as const,
      {
        kind: "retryable",
        message: "xwork is being removed. Wait for that to finish.",
        retry: null,
      },
    ],
    [
      "projectUnavailable",
      { code: "projectUnavailable", reason: "missing" },
      "openFolder" as const,
      {
        kind: "retryable",
        message: "XWork can't open that folder any more.",
        retry: "locate",
      },
    ],
    [
      "openFolderFailed",
      { code: "openFolderFailed" },
      "openFolder" as const,
      {
        kind: "retryable",
        message: "XWork couldn't open the folder for xwork. Try again.",
        retry: "openFolder",
      },
    ],
    [
      "folderPickerFailed",
      { code: "folderPickerFailed" },
      "locate" as const,
      {
        kind: "retryable",
        message: "XWork couldn't open the folder picker. Try again.",
        retry: "locate",
      },
    ],
    [
      "projectAlreadyExists",
      { code: "projectAlreadyExists", project_id: "9b1c" },
      "locate" as const,
      {
        kind: "duplicate",
        message: "That folder is already another project in XWork.",
        projectId: "9b1c",
      },
    ],
    [
      "runtimeInspectionFailed on impact",
      { code: "runtimeInspectionFailed" },
      "impact" as const,
      {
        kind: "retryable",
        message: "XWork couldn't check what is still running for xwork.",
        retry: "impact",
      },
    ],
    [
      "runtimeInspectionFailed on remove",
      { code: "runtimeInspectionFailed" },
      "remove" as const,
      {
        kind: "retryable",
        message: "XWork couldn't check what is still running for xwork.",
        retry: "remove",
      },
    ],
    [
      "runtimeCleanupFailed",
      { code: "runtimeCleanupFailed" },
      "remove" as const,
      {
        kind: "retryable",
        message: "XWork couldn't stop everything for xwork, so it was not removed.",
        retry: "remove",
      },
    ],
    [
      "clockFailed",
      { code: "clockFailed" },
      "rename" as const,
      {
        kind: "retryable",
        message: "XWork couldn't save that change. Try again.",
        retry: "rename",
      },
    ],
    [
      "persistenceFailed",
      { code: "persistenceFailed" },
      "pin" as const,
      { kind: "retryable", message: "XWork couldn't save that change. Try again.", retry: "pin" },
    ],
    [
      "unauthorizedWindow",
      { code: "unauthorizedWindow" },
      "remove" as const,
      { kind: "integration", message: INTEGRATION },
    ],
    [
      "invalidSearch",
      { code: "invalidSearch" },
      "remove" as const,
      { kind: "integration", message: INTEGRATION },
    ],
    [
      "an unknown code",
      { code: "somethingNewer" },
      "remove" as const,
      { kind: "integration", message: INTEGRATION },
    ],
  ])("maps %s", (_label, payload, operation, expected) => {
    const failure = classifyActionFailure(new IpcCallError("rename_project", payload), {
      name: "xwork",
      operation,
    });

    expect(failure).toEqual(expected);
  });

  // Verify the six invalid-folder reasons reuse the same copy relocation and add agree on.
  it.each([
    ["missing", "That folder no longer exists. Pick another folder."],
    ["notDirectory", "That path is a file, not a folder. Pick a folder."],
    ["fileSystemRoot", "A drive root can't be a project. Pick a folder inside it."],
    ["accessDenied", "XWork can't read that folder. Check its permissions or pick another folder."],
    ["notAbsolute", "XWork can't use that folder's path. Pick another folder."],
    ["notUtf8", "XWork can't use that folder's path. Pick another folder."],
    ["cannotCanonicalize", "XWork can't use that folder's path. Pick another folder."],
  ])("maps an invalid folder with reason %s during relocation", (reason, message) => {
    const failure = classifyActionFailure(
      new IpcCallError("locate_project_folder", { code: "invalidProjectFolder", reason }),
      { name: "xwork", operation: "locate" },
    );

    expect(failure).toEqual({ kind: "retryable", message, retry: "locate" });
  });

  // Verify a rejection with no readable payload is terminal for an action too.
  it("maps an unreadable rejection to the integration group", () => {
    expect(classifyActionFailure("nope", { name: "xwork", operation: "remove" })).toEqual({
      kind: "integration",
      message: INTEGRATION,
    });
  });
});

describe("unavailableReasonMessage", () => {
  // Verify each availability reason maps to the exact card reason line.
  it.each<[ProjectUnavailableReasonDto, string]>([
    ["missing", "Folder not found."],
    ["notDirectory", "That path is no longer a folder."],
    ["accessDenied", "XWork can't read that folder."],
    ["io", "XWork couldn't check that folder."],
  ])("maps %s", (reason, message) => {
    expect(unavailableReasonMessage(reason)).toBe(message);
  });
});
