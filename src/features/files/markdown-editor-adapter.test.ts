import { redo, undo } from "@codemirror/commands";
import type { Transaction } from "@codemirror/state";
import { expect, it } from "vitest";
import { createMarkdownState, rawMarkdown, rawOffset } from "./markdown-editor-adapter";

// Untouched bytes survive mixed endings, emoji, no trailing newline and CRLF deletion.
it.each(["a\r\nb", "a\r\nb\nc", "😀\r\nb", "", "no final newline"])(
  "round-trips editing and undo for %j",
  (raw) => {
    let state = createMarkdownState(raw);
    const initial = state;
    state = state.update({
      changes: { from: 0, to: state.doc.length ? 1 : 0, insert: "X\nY" },
    }).state;
    /** Apply history transactions to a real immutable state without a DOM view. */
    const dispatch = (transaction: Transaction) => {
      state = transaction.state;
    };
    const edited = state.field(rawMarkdown);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawMarkdown)).toBe(raw);
    expect(state.doc.eq(initial.doc)).toBe(true);
    expect(redo({ state, dispatch })).toBe(true);
    expect(state.field(rawMarkdown)).toBe(edited);
  },
);
// Spanning a CRLF must remove both raw code units exactly once.
it("maps UTF-16 offsets and preserves untouched mixed delimiters", () => {
  const raw = "😀\r\nA\nB";
  expect(rawOffset(raw, 3)).toBe(4);
  const state = createMarkdownState(raw).update({
    changes: { from: 2, to: 4, insert: "Q\nR" },
  }).state;
  expect(state.field(rawMarkdown)).toBe("😀Q\nR\nB");
});
// New line breaks follow a pure CRLF document without serializing the old text.
it("uses CRLF for newly inserted lines in pure CRLF content", () => {
  const state = createMarkdownState("a\r\nb").update({ changes: { from: 1, insert: "\nX" } }).state;
  expect(state.field(rawMarkdown)).toBe("a\r\nX\r\nb");
});
