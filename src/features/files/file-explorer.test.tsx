import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as files from "@/lib/ipc/files";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projects from "@/lib/ipc/projects";
import { FileExplorer, type FileExplorerProps } from "./file-explorer";
import { deferred, entry, explorerProps, page, project, searchResult } from "./files-test-fixture";

// Native Files, Projects, and clipboard are replaced for every component test.
vi.mock("@/lib/ipc/files");
vi.mock("@/lib/ipc/projects");
const clipboard = vi.fn();
let clipboardDescriptor: PropertyDescriptor | undefined;
// Install isolated DTO and clipboard seams with no real profile or filesystem access.
beforeEach(() => {
  vi.resetAllMocks();
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  clipboard.mockResolvedValue(undefined);
  vi.mocked(projects.getProject).mockResolvedValue(project);
  vi.mocked(projects.onProjectsChanged).mockResolvedValue(vi.fn());
  vi.mocked(files.listFileChildren).mockResolvedValue(page());
  vi.mocked(files.searchFileTree).mockImplementation(async ({ query }) => searchResult(query));
  vi.mocked(files.getFileEntryPaths).mockResolvedValue({
    relativePath: "backend/readme.md",
    absolutePath: "X:/freshly-validated/readme.md",
  });
  vi.mocked(files.revealFileEntry).mockResolvedValue(undefined);
});
// Restore the original clipboard descriptor and release timers and subscriptions.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});
/** Render through the existing tooltip provider used by the application. */
function tree(props: FileExplorerProps) {
  return (
    <TooltipProvider>
      <FileExplorer {...props} />
    </TooltipProvider>
  );
}
/** Wait for the first real mocked root page before interacting. */
async function open(props = explorerProps()) {
  const view = render(tree(props));
  await screen.findByRole("treeitem", { name: "readme.md" });
  return view;
}
/** Open the shared menu without replacing clipboard as userEvent.setup would. */
function menu(name = "readme.md") {
  fireEvent.contextMenu(screen.getByRole("treeitem", { name }));
}

// Stage15 renders honest affordances and activation never invokes file opening.
it("renders the accessible panel and file activation only selects and announces", async () => {
  await open();
  expect(screen.getByRole("textbox", { name: "Filter files" })).toHaveFocus();
  expect(screen.getByRole("complementary", { name: "File Explorer" })).toBeInTheDocument();
  const row = screen.getByRole("treeitem", { name: "readme.md" });
  fireEvent.click(row);
  fireEvent.doubleClick(row);
  fireEvent.keyDown(row, { key: "Enter" });
  fireEvent.keyDown(row, { key: "Enter", ctrlKey: true });
  expect(row).toHaveAttribute("aria-selected", "true");
  expect(
    screen.getAllByText("File viewing is not available yet. You can copy paths or reveal files.")
      .length,
  ).toBeGreaterThan(0);
  expect(files.getFileEntryPaths).not.toHaveBeenCalled();
  expect(files.revealFileEntry).not.toHaveBeenCalled();
  menu();
  expect(screen.queryByRole("menuitem", { name: /^Open/ })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeInTheDocument();
});
// Copy must use the freshly returned backend field and wait for actual clipboard success.
it.each([
  ["Copy path", "X:/freshly-validated/readme.md", "Path copied."],
  ["Copy relative path", "backend/readme.md", "Relative path copied."],
])("%s waits for clipboard success", async (label, value, success) => {
  const pending = deferred<void>();
  clipboard.mockReturnValue(pending.promise);
  await open();
  menu();
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledWith(value));
  expect(files.getFileEntryPaths).toHaveBeenCalledExactlyOnceWith({
    projectId: project.id,
    relativePath: "readme.md",
  });
  expect(screen.queryByText(success)).not.toBeInTheDocument();
  await act(async () => pending.resolve());
  expect(screen.getByText(success)).toBeInTheDocument();
});
// Missing and rejected clipboard APIs must produce retryable failure without optimistic success.
it.each(["missing", "rejected"])("handles %s clipboard safely", async (kind) => {
  if (kind === "missing")
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  else clipboard.mockRejectedValue(new Error("private"));
  await open();
  menu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
  await screen.findByText("Could not copy path. Try again.");
  expect(screen.queryByText("Path copied.")).not.toBeInTheDocument();
});
// Reset, hide, project invalidation and reused-route changes retire pending path completions.
it.each(["epoch", "busy", "route", "hidden", "project"])(
  "blocks pending copy after %s changes",
  async (kind) => {
    const pending = deferred<{ relativePath: string; absolutePath: string }>();
    vi.mocked(files.getFileEntryPaths).mockReturnValue(pending.promise);
    const boundary = { epoch: 0, suspended: false };
    const props = explorerProps({ boundary, readBoundary: () => boundary });
    const view = await open(props);
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() => expect(files.getFileEntryPaths).toHaveBeenCalledOnce());
    if (kind === "epoch") boundary.epoch++;
    if (kind === "busy") boundary.suspended = true;
    if (kind === "route") view.rerender(tree({ ...props, sessionId: "new-session" }));
    if (kind === "hidden") view.rerender(tree({ ...props, isVisible: false }));
    if (kind === "project")
      act(() =>
        vi
          .mocked(projects.onProjectsChanged)
          .mock.calls.at(-1)?.[0]({ projectId: project.id, change: "updated" }),
      );
    await act(async () => pending.resolve({ relativePath: "old", absolutePath: "X:/old" }));
    expect(clipboard).not.toHaveBeenCalled();
    expect(screen.queryByText("Path copied.")).not.toBeInTheDocument();
  },
);
// A clipboard write already sent cannot be undone, but stale success feedback is suppressed.
it("suppresses clipboard completion feedback after a live reset", async () => {
  const boundary = { epoch: 0, suspended: false };
  const pending = deferred<void>();
  clipboard.mockReturnValue(pending.promise);
  await open(explorerProps({ boundary, readBoundary: () => boundary }));
  menu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
  await waitFor(() => expect(clipboard).toHaveBeenCalledOnce());
  boundary.epoch++;
  await act(async () => pending.resolve());
  expect(screen.queryByText("Path copied.")).not.toBeInTheDocument();
});
// Reveal uses one real wrapper call; double activation is blocked until settlement.
it("makes reveal single-flight and offers manual retry after failure", async () => {
  const pending = deferred<void>();
  vi.mocked(files.revealFileEntry).mockReturnValueOnce(pending.promise);
  await open();
  menu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in File Explorer" }));
  menu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in File Explorer" }));
  expect(files.revealFileEntry).toHaveBeenCalledOnce();
  await act(async () => pending.reject(new IpcCallError("reveal", { code: "revealFailed" })));
  await screen.findByText("Could not reveal this entry. Try again or copy its path.");
  fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in File Explorer" }));
  await waitFor(() => expect(files.revealFileEntry).toHaveBeenCalledTimes(2));
});
// Symbolic links remain leaves with copying enabled and native reveal visibly refused.
it("offers link copying but disables reveal with an explanation", async () => {
  vi.mocked(files.listFileChildren).mockResolvedValue(page("", [entry("link", "symbolicLink")]));
  render(tree(explorerProps()));
  const row = await screen.findByRole("treeitem", { name: "link" });
  expect(row).not.toHaveAttribute("aria-expanded");
  menu("link");
  expect(screen.getByRole("menuitem", { name: "Reveal in File Explorer" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(screen.getByText("Symbolic links cannot be revealed.")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Copy path" })).not.toHaveAttribute("aria-disabled");
});
// Zero-result partial search must keep warnings, counts, and the actual truncation explanation.
it.each(["resultLimit", "scanLimit", "depthLimit"] as const)(
  "shows diagnostics for an empty %s search",
  async (reason) => {
    await open();
    vi.useFakeTimers();
    vi.mocked(files.searchFileTree).mockResolvedValue({
      ...searchResult("none", []),
      warningCount: 3,
      warningsTruncated: true,
      warnings: [{ relativeDirectory: "", reason: "invalidIgnoreRule" }],
      truncatedReason: reason,
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Filter files" }), {
      target: { value: "none" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText("No matching files.")).toBeInTheDocument();
    expect(screen.getByText(/Some entries could not be listed/)).toBeInTheDocument();
    expect(screen.getByText("Additional warnings were omitted.")).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Matching files" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeDisabled();
  },
);
// IME drafts do not scan until composition ends and Escape restores the tree.
it("supports filter IME and Escape without intercepting outside keys", async () => {
  await open();
  vi.useFakeTimers();
  const input = screen.getByRole("textbox", { name: "Filter files" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "name" } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(files.searchFileTree).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(files.searchFileTree).toHaveBeenCalledOnce();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("");
  expect(screen.getByRole("treeitem", { name: "readme.md" })).toBeInTheDocument();
});
// Keyboard menu closure returns focus to the originating row rather than the hidden anchor.
it("opens via Shift+F10 and restores row focus after Escape", async () => {
  const user = userEvent.setup();
  await open();
  const row = screen.getByRole("treeitem", { name: "readme.md" });
  act(() => row.focus());
  fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  await screen.findByRole("menuitem", { name: "Copy path" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(row).toHaveFocus());
});
