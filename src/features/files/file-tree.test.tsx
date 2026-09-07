import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FileTree } from "./file-tree";
import { entry, page } from "./files-test-fixture";
import type { FileBranchState } from "./use-file-explorer";

afterEach(cleanup);
/** Build ready branches entirely from inert relative DTOs. */
function branch(
  path = "",
  entries = [entry("src", "directory"), entry("z.ts")],
  overrides: Partial<FileBranchState> = {},
): FileBranchState {
  return {
    entries,
    nextCursor: null,
    status: "ready",
    stale: false,
    lastPage: page(path, entries),
    error: null,
    ...overrides,
  };
}
/** Supply independent spies for each navigation and action intent. */
function props() {
  return {
    branches: new Map([
      ["", branch()],
      ["src", branch("src", [entry("src/a.ts"), entry("src/link", "symbolicLink")])],
    ]),
    expanded: new Set(["src"]),
    matches: null,
    selectedPath: null,
    openingPath: null,
    disabled: false,
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onLoadMore: vi.fn(),
    onRetry: vi.fn(),
    onMenu: vi.fn(),
    onActivate: vi.fn(),
  };
}
// Arrow navigation changes focus separately from selection and Right enters loaded children.
it("supports roving arrows, Home, End, parent navigation and Space selection", () => {
  const options = props();
  render(<FileTree {...options} />);
  const src = screen.getByRole("treeitem", { name: "src" });
  const child = screen.getByRole("treeitem", { name: "a.ts" });
  const last = screen.getByRole("treeitem", { name: "z.ts" });
  act(() => src.focus());
  fireEvent.keyDown(src, { key: "ArrowRight" });
  expect(child).toHaveFocus();
  expect(options.onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(child, { key: " " });
  expect(options.onSelect).toHaveBeenCalledWith("src/a.ts");
  fireEvent.keyDown(child, { key: "ArrowLeft" });
  expect(src).toHaveFocus();
  fireEvent.keyDown(src, { key: "End" });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Home" });
  expect(src).toHaveFocus();
  fireEvent.keyDown(src, { key: "ArrowDown" });
  expect(child).toHaveFocus();
  fireEvent.keyDown(child, { key: "ArrowUp" });
  expect(src).toHaveFocus();
  expect(screen.getByRole("treeitem", { name: "link" })).not.toHaveAttribute("aria-expanded");
});
// Each explicit directory activation toggles exactly once and modified Enter does nothing.
it("toggles directories locally and ignores IME and Ctrl+Enter", () => {
  const options = props();
  render(<FileTree {...options} />);
  const row = screen.getByRole("treeitem", { name: "src" });
  fireEvent.keyDown(row, { key: "Enter" });
  expect(options.onToggle).toHaveBeenCalledExactlyOnceWith("src");
  fireEvent.keyDown(row, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(row, { key: "Enter", isComposing: true });
  expect(options.onToggle).toHaveBeenCalledOnce();
});
// Search directories are flat selectable options, never implicit tree expansion.
it("keeps search directories flat with independent actions controls", () => {
  const options = props();
  render(
    <FileTree
      {...options}
      matches={[entry("nested/src", "directory")]}
      selectedPath="nested/src"
    />,
  );
  const row = screen.getByRole("option", { name: "nested/src" });
  expect(row).not.toHaveAttribute("aria-expanded");
  fireEvent.keyDown(row, { key: "Enter" });
  expect(options.onSelect).toHaveBeenCalledWith("nested/src");
  expect(options.onToggle).not.toHaveBeenCalled();
  const actions = screen.getByRole("button", { name: "Actions for src" });
  expect(row.contains(actions)).toBe(false);
});
// Pagination and retry stay tab-accessible outside treeitem and listbox semantics.
it("renders branch-local loading, retry and pagination controls outside the tree", () => {
  const options = props();
  options.branches.set("", branch("", undefined, { nextCursor: "opaque" }));
  options.branches.set(
    "src",
    branch("src", [], { status: "error", error: "Could not read this folder.", stale: true }),
  );
  render(<FileTree {...options} />);
  const tree = screen.getByRole("tree");
  const more = screen.getByRole("button", { name: "Load more in project" });
  const retry = screen.getByRole("button", { name: "Retry folder src" });
  expect(tree.contains(more)).toBe(false);
  expect(tree.contains(retry)).toBe(false);
  fireEvent.click(more);
  fireEvent.click(retry);
  expect(options.onLoadMore).toHaveBeenCalledWith("");
  expect(options.onRetry).toHaveBeenCalledWith("src");
  expect(screen.getByText("Files may be out of date.")).toBeInTheDocument();
});
// Removing a focused descendant returns focus to its surviving ancestor; deleting all rows uses the container.
it("repairs focus after collapse and refresh removal", () => {
  const options = props();
  const view = render(<FileTree {...options} />);
  act(() => screen.getByRole("treeitem", { name: "a.ts" }).focus());
  view.rerender(<FileTree {...options} expanded={new Set()} />);
  expect(screen.getByRole("treeitem", { name: "src" })).toHaveFocus();
  view.rerender(<FileTree {...options} branches={new Map()} expanded={new Set()} />);
  expect(screen.getByRole("tree")).toHaveFocus();
});
// Context menus share one handler and never activate the entry they were opened on.
it("offers right-click and Shift+F10 menus without leaf expansion", () => {
  const options = props();
  render(<FileTree {...options} />);
  const row = screen.getByRole("treeitem", { name: "z.ts" });
  fireEvent.contextMenu(row);
  fireEvent.keyDown(row, { key: "F10", shiftKey: true });
  expect(options.onMenu).toHaveBeenCalledTimes(2);
  expect(options.onToggle).not.toHaveBeenCalled();
  expect(options.onActivate).not.toHaveBeenCalled();
});
// A file opens from a click or Enter; Space, directories and links never open anything.
it("separates file activation from selection", () => {
  const options = props();
  render(<FileTree {...options} />);
  const file = screen.getByRole("treeitem", { name: "z.ts" });

  fireEvent.click(file, { detail: 1 });
  expect(options.onActivate).toHaveBeenCalledExactlyOnceWith(entry("z.ts"));
  // The second click of a double-click carries the same intent and must not reopen.
  fireEvent.click(file, { detail: 2 });
  fireEvent.keyDown(file, { key: "Enter" });
  expect(options.onActivate).toHaveBeenCalledTimes(2);

  fireEvent.keyDown(file, { key: " " });
  expect(options.onSelect).toHaveBeenLastCalledWith("z.ts");
  expect(options.onActivate).toHaveBeenCalledTimes(2);

  const directory = screen.getByRole("treeitem", { name: "src" });
  fireEvent.click(directory, { detail: 1 });
  fireEvent.keyDown(directory, { key: "Enter" });
  const link = screen.getByRole("treeitem", { name: "link" });
  fireEvent.click(link, { detail: 1 });
  fireEvent.keyDown(link, { key: "Enter" });
  expect(options.onActivate).toHaveBeenCalledTimes(2);
});
// A locked tree reports the entry being opened and refuses every further activation.
it("locks activation while one file is opening", () => {
  const options = props();
  render(<FileTree {...options} openingPath="z.ts" disabled />);
  const file = screen.getByRole("treeitem", { name: "z.ts" });

  expect(file).toHaveAttribute("aria-busy", "true");
  fireEvent.click(file, { detail: 1 });
  fireEvent.keyDown(file, { key: "Enter" });
  expect(options.onActivate).not.toHaveBeenCalled();
});
