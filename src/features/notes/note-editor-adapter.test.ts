import { expect, it, vi } from "vitest";
import { createNoteEditorState, mountNoteEditor } from "./note-editor-adapter";
/** Real transactions preserve Unicode and normalize editor line breaks without corrupting text. */
it("admits Unicode and CRLF text with selection/history state", () => {
  let state = createNoteEditorState("Việt\r\n😀", vi.fn(), vi.fn());
  expect(state.doc.toString()).toBe("Việt\n😀");
  state = state.update({
    changes: { from: state.doc.length, insert: "!" },
    selection: { anchor: 2 },
  }).state;
  expect(state.doc.toString()).toBe("Việt\n😀!");
  expect(state.selection.main.anchor).toBe(2);
});
/** Oversize multi-byte inserts are rejected by real EditorState admission. */
it("rejects more than one MiB without damaging the previous document", () => {
  const state = createNoteEditorState("safe", vi.fn(), vi.fn());
  const next = state.update({ changes: { from: 0, to: 4, insert: "😀".repeat(262145) } }).state;
  expect(next.doc.toString()).toBe("safe");
});
/** Mounting uses an inert view seam rather than native desktop automation. */
it("passes retained state to the view factory", () => {
  const state = createNoteEditorState("text", vi.fn(), vi.fn());
  const fake = {
    state,
    destroy: vi.fn(),
    focus: vi.fn(),
    scrollDOM: document.createElement("div"),
  };
  const factory = vi.fn(() => fake);
  expect(mountNoteEditor(document.createElement("div"), state, factory)).toBe(fake);
  expect(factory).toHaveBeenCalledWith({ parent: expect.any(HTMLElement), state });
});
