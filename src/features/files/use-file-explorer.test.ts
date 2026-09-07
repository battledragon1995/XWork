import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileTreePageDto } from "@/bindings/files/files";
import type { ProjectChangedEventDto } from "@/bindings/projects/projects";
import * as files from "@/lib/ipc/files";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projects from "@/lib/ipc/projects";
import {
  deferred,
  entry,
  explorerProps,
  openResult,
  page,
  project,
  searchResult,
} from "./files-test-fixture";
import { useFileExplorer } from "./use-file-explorer";

// All filesystem, project-event, and native action boundaries are replaced with pure spies.
vi.mock("@/lib/ipc/files");
vi.mock("@/lib/ipc/projects");
let event: (value: ProjectChangedEventDto) => void;
const detach = vi.fn();
// Give each test its own fake subscription and deterministic root page.
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(projects.getProject).mockResolvedValue(project);
  vi.mocked(projects.onProjectsChanged).mockImplementation(async (handler) => {
    event = handler;
    return detach;
  });
  vi.mocked(files.listFileChildren).mockImplementation(async ({ directory }) =>
    page(directory, directory ? [entry(`${directory}/child.ts`)] : undefined),
  );
  vi.mocked(files.searchFileTree).mockImplementation(async ({ query }) => searchResult(query));
});
// Dispose subscriptions before resetting timers so no scheduled scan survives a test.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
/** Wait until listener and metadata bootstrap have published the root. */
async function open(props = explorerProps()) {
  const hook = renderHook(useFileExplorer, { initialProps: props });
  await waitFor(() => expect(hook.result.current.state.branches.get("")?.status).toBe("ready"));
  return hook;
}
// A closed slot must neither subscribe nor read metadata/files.
it("does no work while closed", async () => {
  renderHook(useFileExplorer, { initialProps: explorerProps({ isVisible: false }) });
  expect(projects.onProjectsChanged).not.toHaveBeenCalled();
  expect(projects.getProject).not.toHaveBeenCalled();
  expect(files.listFileChildren).not.toHaveBeenCalled();
});
// Subscription resolves before the first metadata read and directory loading remains lazy.
it("attaches before snapshot and lists only explicitly expanded directories", async () => {
  const subscription = deferred<() => void>();
  vi.mocked(projects.onProjectsChanged).mockReturnValue(subscription.promise);
  const hook = renderHook(useFileExplorer, { initialProps: explorerProps() });
  expect(projects.getProject).not.toHaveBeenCalled();
  await act(async () => subscription.resolve(detach));
  await waitFor(() => expect(files.listFileChildren).toHaveBeenCalledTimes(1));
  expect(files.listFileChildren).toHaveBeenCalledWith({
    projectId: project.id,
    directory: "",
    cursor: null,
  });
  act(() => hook.result.current.owner.toggleDirectory("src"));
  await waitFor(() => expect(hook.result.current.state.branches.get("src")?.status).toBe("ready"));
  expect(files.listFileChildren).toHaveBeenCalledTimes(2);
});
// Late listener resolution must immediately unlisten exactly once after unmount.
it("disposes a late listener", async () => {
  const subscription = deferred<() => void>();
  vi.mocked(projects.onProjectsChanged).mockReturnValue(subscription.promise);
  const hook = renderHook(useFileExplorer, { initialProps: explorerProps() });
  hook.unmount();
  await act(async () => subscription.resolve(detach));
  expect(detach).toHaveBeenCalledTimes(1);
  expect(projects.getProject).not.toHaveBeenCalled();
});
// Explicit bootstrap errors must not guess a root or claim a live listener.
it.each(["listener", "metadata"])("fails safely when %s cannot be read", async (source) => {
  if (source === "listener")
    vi.mocked(projects.onProjectsChanged).mockRejectedValue(new Error("private"));
  else vi.mocked(projects.getProject).mockRejectedValue(new Error("private"));
  const hook = renderHook(useFileExplorer, { initialProps: explorerProps() });
  await waitFor(() => expect(hook.result.current.state.error).not.toBe(""));
  expect(hook.result.current.state.error).not.toContain("private");
  expect(files.listFileChildren).not.toHaveBeenCalled();
});
// Preserve backend order while replacing exact duplicate DTOs in their original positions.
it("appends opaque pages with exact-path deduplication and case-sensitive identity", async () => {
  vi.mocked(files.listFileChildren)
    .mockResolvedValueOnce(page("", [entry("a"), entry("B")], { nextCursor: "opaque==" }))
    .mockResolvedValueOnce(page("", [entry("a", "other"), entry("A")]));
  const hook = await open();
  act(() => hook.result.current.owner.loadMore(""));
  await waitFor(() =>
    expect(hook.result.current.state.branches.get("")?.entries).toEqual([
      entry("a", "other"),
      entry("B"),
      entry("A"),
    ]),
  );
  expect(files.listFileChildren).toHaveBeenLastCalledWith({
    projectId: project.id,
    directory: "",
    cursor: "opaque==",
  });
});
// A collapsed read never resurrects its branch and still occupies capacity until settled.
it("drops collapsed results and limits outstanding scans across hide and reopen", async () => {
  const hook = await open();
  const a = deferred<FileTreePageDto>();
  const b = deferred<FileTreePageDto>();
  vi.mocked(files.listFileChildren).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  act(() => {
    hook.result.current.owner.toggleDirectory("src");
    hook.result.current.owner.toggleDirectory("other");
  });
  expect(files.listFileChildren).toHaveBeenCalledTimes(3);
  hook.rerender(explorerProps({ isVisible: false }));
  hook.rerender(explorerProps());
  await waitFor(() => expect(projects.getProject).toHaveBeenCalledTimes(2));
  expect(files.listFileChildren).toHaveBeenCalledTimes(3);
  await act(async () => a.resolve(page("src", [entry("src/obsolete")])));
  await waitFor(() => expect(files.listFileChildren).toHaveBeenCalledTimes(5));
  expect(hook.result.current.state.branches.get("src")?.entries).not.toContainEqual(
    entry("src/obsolete"),
  );
  await act(async () => b.resolve(page("other", [])));
});
// Collapse/re-expand of an identical path must use a new per-directory token.
it("serializes repeated expansion of the same directory", async () => {
  const hook = await open();
  const pending = deferred<FileTreePageDto>();
  vi.mocked(files.listFileChildren).mockReturnValueOnce(pending.promise);
  act(() => {
    hook.result.current.owner.toggleDirectory("src");
    hook.result.current.owner.toggleDirectory("src");
    hook.result.current.owner.toggleDirectory("src");
  });
  expect(files.listFileChildren).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(page("src", [entry("src/old")])));
  await waitFor(() => expect(files.listFileChildren).toHaveBeenCalledTimes(3));
  expect(hook.result.current.state.branches.get("src")?.entries).toEqual([entry("src/child.ts")]);
});
// Old pagination cannot append after a manual refresh creates a fresh generation.
it("discards an old page after refresh and restores visible expansions parent first", async () => {
  vi.mocked(files.listFileChildren).mockResolvedValueOnce(
    page("", undefined, { nextCursor: "next" }),
  );
  const hook = await open();
  act(() => hook.result.current.owner.toggleDirectory("src"));
  await waitFor(() => expect(hook.result.current.state.branches.get("src")?.status).toBe("ready"));
  const pending = deferred<FileTreePageDto>();
  vi.mocked(files.listFileChildren).mockReturnValueOnce(pending.promise);
  act(() => {
    hook.result.current.owner.loadMore("");
    hook.result.current.owner.refresh();
  });
  await act(async () => pending.resolve(page("", [entry("obsolete")])));
  await waitFor(() => expect(files.listFileChildren).toHaveBeenCalledTimes(5));
  expect(hook.result.current.state.branches.get("")?.entries).not.toContainEqual(entry("obsolete"));
  expect(
    vi
      .mocked(files.listFileChildren)
      .mock.calls.slice(-2)
      .map(([request]) => [request.directory, request.cursor]),
  ).toEqual([
    ["", null],
    ["src", null],
  ]);
});
// At the display cap, reject the complete page and retain its continuation for later retry.
it("keeps all 5000 entries and the old cursor when the next whole page exceeds the cap", async () => {
  vi.mocked(files.listFileChildren).mockImplementation(async ({ cursor }) => {
    const offset = Number(cursor ?? 0);
    return page(
      "",
      Array.from({ length: 500 }, (_, index) => entry(`file-${offset + index}`)),
      { nextCursor: String(offset + 500) },
    );
  });
  const hook = await open();
  for (let count = 2; count <= 10; count++) {
    act(() => hook.result.current.owner.loadMore(""));
    await waitFor(() =>
      expect(hook.result.current.state.branches.get("")?.entries).toHaveLength(count * 500),
    );
  }
  act(() => hook.result.current.owner.loadMore(""));
  await waitFor(() => expect(hook.result.current.state.limited).toBe(true));
  expect(hook.result.current.state.branches.get("")?.entries).toHaveLength(5000);
  expect(hook.result.current.state.branches.get("")?.nextCursor).toBe("5000");
});
// Invalid cursors get one fresh read, never an automatic retry loop.
it("recovers an invalid cursor only once", async () => {
  const hook = await open();
  vi.mocked(files.listFileChildren).mockRejectedValue(
    new IpcCallError("list", { code: "invalidCursor" }),
  );
  act(() => hook.result.current.owner.refresh());
  await waitFor(() => expect(hook.result.current.state.branches.get("")?.status).toBe("error"));
  expect(files.listFileChildren).toHaveBeenCalledTimes(3);
});
// A same-root refresh failure preserves only already validated stale entries.
it("keeps stale rows on same-root read failure and drops them on unknown metadata", async () => {
  const hook = await open();
  vi.mocked(files.listFileChildren).mockRejectedValue(
    new IpcCallError("list", { code: "fileSystemReadFailed" }),
  );
  act(() => hook.result.current.owner.refresh());
  await waitFor(() => expect(hook.result.current.state.branches.get("")?.status).toBe("error"));
  expect(hook.result.current.state.branches.get("")?.stale).toBe(true);
  expect(hook.result.current.state.branches.get("")?.entries).toHaveLength(2);
  vi.mocked(projects.getProject).mockRejectedValue(new Error("private root"));
  act(() => hook.result.current.owner.refresh());
  await waitFor(() => expect(hook.result.current.state.project).toBeNull());
  expect(hook.result.current.state.branches.size).toBe(0);
});
// Debounce and IME must not dispatch drafts, and obsolete searches cannot publish newer input.
it("debounces IME and keeps only the latest queued query behind one running search", async () => {
  const hook = await open();
  vi.useFakeTimers();
  act(() => {
    hook.result.current.owner.setComposing(true);
    hook.result.current.owner.setQuery("A");
  });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(files.searchFileTree).not.toHaveBeenCalled();
  const pending = deferred<ReturnType<typeof searchResult>>();
  vi.mocked(files.searchFileTree).mockReturnValueOnce(pending.promise);
  act(() => hook.result.current.owner.setComposing(false));
  await act(async () => vi.advanceTimersByTimeAsync(249));
  expect(files.searchFileTree).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  act(() => hook.result.current.owner.setQuery("B"));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  act(() => hook.result.current.owner.setQuery("C"));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(files.searchFileTree).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(searchResult("A")));
  expect(files.searchFileTree).toHaveBeenCalledTimes(2);
  expect(files.searchFileTree).toHaveBeenLastCalledWith({ projectId: project.id, query: "C" });
  expect(hook.result.current.state.search?.query).toBe("C");
});
// Unicode scalars and whitespace follow the Rust contract without UTF-16 length mistakes.
it.each([
  ["😀".repeat(128), true],
  ["😀".repeat(129), false],
  ["a\u0001b", false],
  ["   ", false],
])("validates query %s", async (query, valid) => {
  const hook = await open();
  vi.useFakeTimers();
  act(() => hook.result.current.owner.setQuery(query as string));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(files.searchFileTree).toHaveBeenCalledTimes(valid ? 1 : 0);
  expect(hook.result.current.state.searchStatus).toBe(valid ? "ready" : "idle");
});
// Authoritative backend validation must also restore the normal tree.
it("handles backend invalidSearch without hiding the tree snapshot", async () => {
  const hook = await open();
  vi.useFakeTimers();
  vi.mocked(files.searchFileTree).mockRejectedValue(
    new IpcCallError("search", { code: "invalidSearch" }),
  );
  act(() => hook.result.current.owner.setQuery("query"));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(hook.result.current.state.validation).not.toBe("");
  expect(hook.result.current.state.searchStatus).toBe("idle");
  expect(hook.result.current.state.branches.get("")?.entries).toHaveLength(2);
});
// Live owner changes block stale completion and further dispatch before props rerender.
it.each(["busy", "epoch"])(
  "rejects stale reads and queued scans after live %s changes",
  async (kind) => {
    const boundary = { epoch: 0, suspended: false };
    const props = explorerProps({ boundary, readBoundary: () => boundary });
    const hook = await open(props);
    const pending = deferred<FileTreePageDto>();
    vi.mocked(files.listFileChildren).mockReturnValue(pending.promise);
    act(() => {
      hook.result.current.owner.toggleDirectory("src");
      hook.result.current.owner.toggleDirectory("another");
      hook.result.current.owner.toggleDirectory("queued");
    });
    if (kind === "busy") boundary.suspended = true;
    else boundary.epoch++;
    await act(async () => pending.resolve(page("src", [entry("src/obsolete")])));
    expect(files.listFileChildren).toHaveBeenCalledTimes(3);
    expect(hook.result.current.owner.state.branches.get("src")?.entries).toEqual([]);
  },
);
// Matching project updates invalidate identical relative paths; unrelated updates are ignored.
it("retires old-root responses on project events and routes removed projects once", async () => {
  const missing = vi.fn();
  const hook = await open(explorerProps({ onProjectMissing: missing }));
  act(() => event({ projectId: "unrelated", change: "updated" }));
  expect(projects.getProject).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.owner.setQuery("old intent"));
  vi.mocked(projects.getProject).mockResolvedValue({
    ...project,
    rootPath: "X:/relocated-fixture",
  });
  act(() => event({ projectId: project.id, change: "updated" }));
  await waitFor(() =>
    expect(hook.result.current.state.project?.rootPath).toBe("X:/relocated-fixture"),
  );
  expect(hook.result.current.state.query).toBe("");
  act(() => event({ projectId: project.id, change: "removed" }));
  expect(missing).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state.branches.size).toBe(0);
});
// Route identity and reset generation discard intent even when React keeps the hook mounted.
it("clears query and expansion on session and epoch changes", async () => {
  const hook = await open();
  act(() => {
    hook.result.current.owner.setQuery("draft");
    hook.result.current.owner.toggleDirectory("src");
  });
  const boundary = { epoch: 1, suspended: false };
  hook.rerender(explorerProps({ boundary, readBoundary: () => boundary }));
  await waitFor(() => expect(hook.result.current.state.project).not.toBeNull());
  expect(hook.result.current.state.query).toBe("");
  expect(hook.result.current.state.expanded.size).toBe(0);
  act(() => hook.result.current.owner.setQuery("another"));
  hook.rerender(explorerProps({ sessionId: "33333333-3333-4333-8333-333333333333" }));
  expect(hook.result.current.state.query).toBe("");
});
// A repeated root-change error must stop after its single automatic metadata recovery.
it("bounds root-change recovery and removal waits for manual retry", async () => {
  vi.mocked(files.listFileChildren).mockRejectedValue(
    new IpcCallError("list", { code: "projectRootChanged", project_id: project.id }),
  );
  const hook = renderHook(useFileExplorer, { initialProps: explorerProps() });
  await waitFor(() => expect(projects.getProject).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(hook.result.current.state.error).toContain("Project folder changed"));
  expect(files.listFileChildren).toHaveBeenCalledTimes(2);
  vi.mocked(files.listFileChildren).mockRejectedValue(
    new IpcCallError("list", { code: "projectRemovalInProgress", project_id: project.id }),
  );
  act(() => hook.result.current.owner.refresh());
  await waitFor(() => expect(hook.result.current.state.blocked).toBe(true));
  expect(projects.getProject).toHaveBeenCalledTimes(3);
});

// Search Refresh scans only the active query and defers rebuilding the tree until clear.
it("refreshes search and rebuilds fresh tree pages on clear", async () => {
  const hook = await open();
  vi.useFakeTimers();
  act(() => hook.result.current.owner.setQuery("match"));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  act(() => hook.result.current.owner.refresh());
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(files.searchFileTree).toHaveBeenCalledTimes(2);
  expect(files.listFileChildren).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.owner.setQuery(""));
  await act(async () => {});
  expect(files.listFileChildren).toHaveBeenCalledTimes(2);
  expect(hook.result.current.state.branches.get("")?.stale).toBe(false);
});
// Multiple refresh presses during one metadata read create only one trailing refresh.
it("coalesces repeated refresh requests while metadata is pending", async () => {
  const hook = await open();
  const metadata = deferred<typeof project>();
  vi.mocked(projects.getProject).mockReturnValueOnce(metadata.promise);
  act(() => {
    hook.result.current.owner.refresh();
    hook.result.current.owner.refresh();
    hook.result.current.owner.refresh();
  });
  expect(projects.getProject).toHaveBeenCalledTimes(2);
  await act(async () => metadata.resolve(project));
  await waitFor(() => expect(files.listFileChildren).toHaveBeenCalledTimes(3));
  expect(projects.getProject).toHaveBeenCalledTimes(3);
});
// An invalidation event during bootstrap retires the first metadata response before it can scan.
it("ignores obsolete metadata when an event arrives during bootstrap", async () => {
  const metadata = deferred<typeof project>();
  vi.mocked(projects.getProject).mockReturnValueOnce(metadata.promise);
  const hook = renderHook(useFileExplorer, { initialProps: explorerProps() });
  await waitFor(() => expect(projects.getProject).toHaveBeenCalledOnce());
  act(() => event({ projectId: project.id, change: "updated" }));
  await waitFor(() => expect(files.listFileChildren).toHaveBeenCalledOnce());
  await act(async () => metadata.resolve({ ...project, displayName: "obsolete" }));
  expect(hook.result.current.state.project?.displayName).toBe("Fixture");
  expect(files.listFileChildren).toHaveBeenCalledOnce();
});
// Refresh removes missing folders and never waits for a failed sibling before loading another.
it("restores siblings independently and drops removed descendants", async () => {
  vi.mocked(files.listFileChildren).mockImplementation(async ({ directory }) =>
    page(
      directory,
      directory
        ? [entry(`${directory}/child.ts`)]
        : [entry("a", "directory"), entry("b", "directory")],
    ),
  );
  const hook = await open();
  act(() => {
    hook.result.current.owner.toggleDirectory("a");
    hook.result.current.owner.toggleDirectory("b");
  });
  await waitFor(() => expect(hook.result.current.state.branches.get("b")?.status).toBe("ready"));
  vi.mocked(files.listFileChildren).mockImplementation(async ({ directory }) => {
    if (directory === "a") throw new IpcCallError("list", { code: "fileSystemReadFailed" });
    return page(
      directory,
      directory
        ? [entry(`${directory}/fresh.ts`)]
        : [entry("a", "directory"), entry("b", "directory")],
    );
  });
  act(() => hook.result.current.owner.refresh());
  await waitFor(() =>
    expect(hook.result.current.state.branches.get("b")?.entries).toEqual([entry("b/fresh.ts")]),
  );
  expect(hook.result.current.state.branches.get("a")?.status).toBe("error");
  vi.mocked(files.listFileChildren).mockResolvedValue(page("", [entry("a")]));
  act(() => hook.result.current.owner.refresh());
  await waitFor(() => expect(hook.result.current.state.branches.size).toBe(1));
});
// Explicit unavailable metadata has a recovery state and never sends a Files scan.
it("shows unavailable metadata without scanning", async () => {
  vi.mocked(projects.getProject).mockResolvedValue({
    ...project,
    availability: { status: "unavailable", reason: "missing" },
  });
  const hook = renderHook(useFileExplorer, { initialProps: explorerProps() });
  await waitFor(() =>
    expect(hook.result.current.state.error).toBe("Project folder is unavailable."),
  );
  expect(files.listFileChildren).not.toHaveBeenCalled();
});
// A native action remains single-flight across hide/reopen until its actual completion.
it("does not replay or overlap a reveal after hide and reopen", async () => {
  const hook = await open();
  const reveal = deferred<void>();
  vi.mocked(files.revealFileEntry).mockReturnValue(reveal.promise);
  act(() => {
    void hook.result.current.owner.action("reveal", entry("readme.md"));
  });
  hook.rerender(explorerProps({ isVisible: false }));
  hook.rerender(explorerProps());
  await waitFor(() => expect(projects.getProject).toHaveBeenCalledTimes(2));
  act(() => {
    void hook.result.current.owner.action("reveal", entry("readme.md"));
  });
  expect(files.revealFileEntry).toHaveBeenCalledOnce();
  await act(async () => reveal.resolve());
  expect(hook.result.current.state.feedback).toBe("");
  expect(hook.result.current.state.pendingAction).toBe(false);
});

// A missing search entry is retired immediately while one recovery query is pending.
it("removes stale search results before recovering a failed path action", async () => {
  const hook = await open();
  vi.useFakeTimers();
  act(() => hook.result.current.owner.setQuery("match"));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  const recovery = deferred<ReturnType<typeof searchResult>>();
  vi.mocked(files.searchFileTree).mockReturnValueOnce(recovery.promise);
  vi.mocked(files.getFileEntryPaths).mockRejectedValue(
    new IpcCallError("paths", { code: "entryNotVisible", relative_path: "deep/match.ts" }),
  );
  await act(async () => hook.result.current.owner.action("copyRelative", entry("deep/match.ts")));
  expect(hook.result.current.state.search).toBeNull();
  expect(hook.result.current.state.searchStatus).toBe("loading");
  await act(async () => recovery.resolve(searchResult("match", [])));
  expect(hook.result.current.state.search?.matches).toEqual([]);
  expect(files.searchFileTree).toHaveBeenCalledTimes(2);
});

// One accepted activation prepares exactly one target and attaches exactly once.
it("opens one file through the prepared target", async () => {
  const prepareTarget = vi.fn(async () => ({ tabId: "tab-1", paneId: "pane-1" }));
  const onFileOpened = vi.fn();
  vi.mocked(files.openFileInPane).mockResolvedValue(openResult());
  const hook = await open(explorerProps({ prepareTarget, onFileOpened }));

  await act(async () => hook.result.current.owner.open(entry("readme.md"), "newTab"));

  expect(prepareTarget).toHaveBeenCalledExactlyOnceWith("newTab");
  expect(files.openFileInPane).toHaveBeenCalledExactlyOnceWith({
    sessionId: explorerProps().sessionId,
    tabId: "tab-1",
    paneId: "pane-1",
    relativePath: "readme.md",
  });
  expect(onFileOpened).toHaveBeenCalledOnce();
  expect(hook.result.current.state.openFeedback).toBe("Opened readme.md in a new tab.");
  expect(hook.result.current.state.openingPath).toBeNull();
});

// A warning is reported without turning a completed attachment into a failure.
it("reports the recent-files warning as a successful opening", async () => {
  vi.mocked(files.openFileInPane).mockResolvedValue(openResult({}, ["recentFileNotRecorded"]));
  const hook = await open(
    explorerProps({ prepareTarget: async () => ({ tabId: "tab-1", paneId: "pane-1" }) }),
  );

  await act(async () => hook.result.current.owner.open(entry("readme.md"), "newTab"));

  expect(hook.result.current.state.openFeedback).toBe(
    "Opened readme.md. Recent files couldn't be updated.",
  );
  expect(hook.result.current.state.openError).toBe("");
});

// Two rapid activations of the same entry produce exactly one preparation and one attach.
it("drops a second activation while one opening is in flight", async () => {
  const pending = deferred<{ tabId: string; paneId: string } | null>();
  const prepareTarget = vi.fn(() => pending.promise);
  vi.mocked(files.openFileInPane).mockResolvedValue(openResult());
  const hook = await open(explorerProps({ prepareTarget }));

  let first!: Promise<void>;
  await act(async () => {
    first = hook.result.current.owner.open(entry("readme.md"), "newTab");
    await hook.result.current.owner.open(entry("readme.md"), "newTab");
    // A different entry is refused by the same guard while the first is unresolved.
    await hook.result.current.owner.open(entry("src/other.ts"), "splitRight");
  });
  expect(prepareTarget).toHaveBeenCalledOnce();

  await act(async () => {
    pending.resolve({ tabId: "tab-1", paneId: "pane-1" });
    await first;
  });
  expect(files.openFileInPane).toHaveBeenCalledOnce();
});

// A refused preparation stops silently: the host already explained its own refusal.
it("stops without a message when the host refuses", async () => {
  const hook = await open(explorerProps({ prepareTarget: async () => null }));

  await act(async () => hook.result.current.owner.open(entry("readme.md"), "emptyPane"));

  expect(files.openFileInPane).not.toHaveBeenCalled();
  expect(hook.result.current.state.openError).toBe("");
  expect(hook.result.current.state.openFeedback).toBe("");
});

// A disabled placement never reaches the host, so no tab or split can be created.
it("refuses a placement the host reports as unavailable", async () => {
  const prepareTarget = vi.fn(async () => ({ tabId: "tab-1", paneId: "pane-1" }));
  const hook = await open(
    explorerProps({
      prepareTarget,
      placements: { newTab: true, emptyPane: false, splitRight: false, splitDown: false },
    }),
  );

  await act(async () => hook.result.current.owner.open(entry("readme.md"), "splitDown"));

  expect(prepareTarget).not.toHaveBeenCalled();
});

// Only file entries open; directories, symbolic links and other kinds never activate.
it.each(["directory", "symbolicLink", "other"] as const)("never opens a %s entry", async (kind) => {
  const prepareTarget = vi.fn(async () => ({ tabId: "tab-1", paneId: "pane-1" }));
  const hook = await open(explorerProps({ prepareTarget }));

  await act(async () => hook.result.current.owner.open(entry("src", kind), "newTab"));

  expect(prepareTarget).not.toHaveBeenCalled();
});

// Each documented command failure uses exactly the recovery FE-017 assigns to it.
it.each([
  {
    failure: { code: "paneNotEmpty", pane_id: "pane-1" },
    message: "This pane already contains something.",
    refreshesSession: true,
    canRetry: false,
  },
  {
    failure: { code: "sessionAttachFailed" },
    message: "Could not open the file in this pane.",
    refreshesSession: true,
    canRetry: false,
  },
  {
    failure: { code: "notRegularFile", relative_path: "readme.md" },
    message: "This entry is not a regular file.",
    refreshesSession: false,
    canRetry: false,
  },
  {
    failure: { code: "fileMemoryLimitReached" },
    message: "Close another file and try again.",
    refreshesSession: false,
    canRetry: false,
  },
  {
    failure: { code: "fileReadFailed" },
    message: "Could not read this file.",
    refreshesSession: false,
    canRetry: true,
  },
])("recovers from $failure.code", async ({ failure, message, refreshesSession, canRetry }) => {
  const onFileOpened = vi.fn();
  vi.mocked(files.openFileInPane).mockRejectedValue(new IpcCallError("open_file_in_pane", failure));
  const hook = await open(
    explorerProps({
      onFileOpened,
      prepareTarget: async () => ({ tabId: "tab-1", paneId: "pane-1" }),
    }),
  );

  await act(async () => hook.result.current.owner.open(entry("readme.md"), "newTab"));

  expect(hook.result.current.state.openError).toBe(message);
  expect(hook.result.current.state.canRetryOpen).toBe(canRetry);
  expect(onFileOpened).toHaveBeenCalledTimes(refreshesSession ? 1 : 0);
  // The prepared pane is never closed as a rollback; only the host owns that decision.
  expect(hook.result.current.state.blocked).toBe(false);
});

// A vanished entry refreshes the tree instead of retrying the same relative path.
it("refreshes the tree after entryNotFound", async () => {
  vi.mocked(files.openFileInPane).mockRejectedValue(
    new IpcCallError("open_file_in_pane", { code: "entryNotFound", relative_path: "readme.md" }),
  );
  const hook = await open(
    explorerProps({ prepareTarget: async () => ({ tabId: "tab-1", paneId: "pane-1" }) }),
  );
  const listsBefore = vi.mocked(files.listFileChildren).mock.calls.length;

  await act(async () => hook.result.current.owner.open(entry("readme.md"), "newTab"));

  expect(hook.result.current.state.openError).toBe("This entry is no longer available.");
  await waitFor(() =>
    expect(vi.mocked(files.listFileChildren).mock.calls.length).toBeGreaterThan(listsBefore),
  );
});

// A project barrier reuses the existing Explorer recovery instead of an opening-only message.
it("routes project failures into existing recovery", async () => {
  vi.mocked(files.openFileInPane).mockRejectedValue(
    new IpcCallError("open_file_in_pane", { code: "projectUnavailable", project_id: project.id }),
  );
  const hook = await open(
    explorerProps({ prepareTarget: async () => ({ tabId: "tab-1", paneId: "pane-1" }) }),
  );

  await act(async () => hook.result.current.owner.open(entry("readme.md"), "newTab"));

  expect(hook.result.current.state.blocked).toBe(true);
  expect(hook.result.current.state.error).toBe("Project folder is unavailable.");
});

// A result that belongs to a retired intent cannot attach, announce, or refresh a session.
it("suppresses a result whose session changed while it was pending", async () => {
  const pending = deferred<{ tabId: string; paneId: string } | null>();
  const onFileOpened = vi.fn();
  const props = explorerProps({ prepareTarget: () => pending.promise, onFileOpened });
  const hook = await open(props);

  let opening!: Promise<void>;
  act(() => {
    opening = hook.result.current.owner.open(entry("readme.md"), "newTab");
  });
  hook.rerender({ ...props, sessionId: "another-session" });
  await act(async () => {
    pending.resolve({ tabId: "tab-1", paneId: "pane-1" });
    await opening;
  });

  expect(files.openFileInPane).not.toHaveBeenCalled();
  expect(onFileOpened).not.toHaveBeenCalled();
});
