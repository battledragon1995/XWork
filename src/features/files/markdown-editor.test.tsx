import { EditorState } from "@codemirror/state";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FileHandleRegistry } from "./file-handle-registry";
import { handle, readyTextState } from "./files-test-fixture";
import { MarkdownEditor } from "./markdown-editor";
import type { createMarkdownEditor } from "./markdown-editor-adapter";

/** Create an isolated registry and inert adapter while retaining real immutable editor state. */
async function setup(active = true, platform = "windows") {
  const snapshot = handle({
    state: readyTextState({ mode: "markdown", text: "# Draft" }),
    isDirty: true,
  });
  const save = vi.fn(async () => ({
    outcome: "saved" as const,
    file: { ...snapshot, isDirty: false },
    savedDisk: null,
  }));
  const registry = new FileHandleRegistry({
    getOpenFile: async () => snapshot,
    reloadOpenFile: async () => snapshot,
    openFileWithDefaultApp: async () => undefined,
    onFileHandleChanged: async () => () => undefined,
    getFileEntryPaths: async () => ({ relativePath: "x", absolutePath: "X:/x" }),
    writeText: async () => undefined,
    saveMarkdownFile: save,
  });
  const entry = registry.entry(snapshot.id);
  entry.retain();
  await Promise.resolve();
  await Promise.resolve();
  const destroy = vi.fn();
  const factory = vi.fn<typeof createMarkdownEditor>((options) => ({
    setText: vi.fn(),
    setBlocked: vi.fn(),
    readState: () => options.state ?? EditorState.create(),
    readScrollTop: () => 42,
    destroy,
  }));
  /** Subscribe like the production pane and render both regions over the same entry. */
  function Host() {
    const state = useSyncExternalStore(entry.subscribe, entry.getSnapshot);
    return (
      <>
        <MarkdownEditor
          entry={entry}
          state={state}
          region="header"
          active={active}
          visible
          platform={platform}
          createAdapter={factory}
        />
        <MarkdownEditor
          entry={entry}
          state={state}
          region="body"
          active={active}
          visible
          platform={platform}
          createAdapter={factory}
        />
      </>
    );
  }
  const view = render(<Host />);
  return { view, entry, factory, save, destroy };
}
// Mode switching destroys only the DOM view and restores retained history and edit scroll.
it("retains editor state and preview across mode switches", async () => {
  const { entry, factory, destroy } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByRole("heading", { name: "Draft" })).toBeInTheDocument();
  expect(destroy).toHaveBeenCalledOnce();
  expect(entry.readEditorState()).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(factory.mock.calls[1]?.[0].scrollTop).toBe(42);
  expect(factory.mock.calls[1]?.[0].state).toBe(entry.readEditorState());
});
// Both platform modifiers work only within the active pane.
it.each(["windows", "macos"])("scopes Save to the active %s pane", async (platform) => {
  const { save } = await setup(true, platform);
  fireEvent.keyDown(screen.getByRole("button", { name: "Save" }), {
    key: "s",
    ctrlKey: platform === "windows",
    metaKey: platform === "macos",
  });
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
});
// An inactive pane cannot intercept another pane's Save command.
it("ignores save shortcuts in inactive panes", async () => {
  const { save } = await setup(false);
  fireEvent.keyDown(screen.getByRole("button", { name: "Save" }), { key: "s", ctrlKey: true });
  await act(async () => undefined);
  expect(save).not.toHaveBeenCalled();
});
// Header Save waits for composition owned by the separate body region.
it("waits for IME completion before saving", async () => {
  const { save } = await setup();
  const body = screen.getByRole("region", { name: "Markdown document" });
  fireEvent.compositionStart(body);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await act(async () => undefined);
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(body);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
});

// Release mounted surfaces between isolated component cases.
afterEach(cleanup);
