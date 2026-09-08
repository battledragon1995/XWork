import { defaultKeymap, history, historyKeymap, invertedEffects } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { isSyntaxHighlightingEligible } from "./source-language";
import { SOURCE_THEME_SPEC, sourceHighlightStyle } from "./source-view-adapter";

/** Exact raw replacement, also stored in history for lossless undo. */
const rawReplacement = StateEffect.define<string>();
/** Map one normalized UTF-16 offset to the original raw document. */
export function rawOffset(raw: string, offset: number): number {
  let position = 0;
  for (let logical = 0; logical < offset && position < raw.length; logical += 1, position += 1) {
    if (raw[position] === "\r" && raw[position + 1] === "\n") position += 1;
  }
  return position;
}
/** Apply CodeMirror changes without rewriting untouched newline bytes. */
function changedRaw(raw: string, transaction: Transaction): string {
  const newline =
    raw.includes("\r\n") && !raw.replaceAll("\r\n", "").includes("\n") ? "\r\n" : "\n";
  let result = "";
  let cursor = 0;
  transaction.changes.iterChanges((from, to, _newFrom, _newTo, insert) => {
    result += raw.slice(cursor, rawOffset(raw, from)) + insert.toString().replaceAll("\n", newline);
    cursor = rawOffset(raw, to);
  });
  return result + raw.slice(cursor);
}
/** Keep lossless text next to the immutable editor state and its history. */
export const rawMarkdown = StateField.define<string>({
  /** Initial content is supplied through the field initializer. */
  create: () => "",
  /** Explicit history effects take priority over normalized document changes. */
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(rawReplacement)) return effect.value;
    return transaction.docChanged ? changedRaw(value, transaction) : value;
  },
});
/** Create a state usable both by production views and DOM-free transaction tests. */
export function createMarkdownState(raw: string, name = "Markdown"): EditorState {
  return EditorState.create({
    doc: raw.replaceAll("\r\n", "\n"),
    extensions: [
      rawMarkdown.init(() => raw),
      history(),
      invertedEffects.of((transaction) =>
        transaction.docChanged
          ? [rawReplacement.of(transaction.startState.field(rawMarkdown))]
          : [],
      ),
      lineNumbers(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      ...(isSyntaxHighlightingEligible({
        byteSize: BigInt(new TextEncoder().encode(raw).length),
        lineCount: raw.split(/\r\n|\n|\r/).length,
      })
        ? [markdown()]
        : []),
      syntaxHighlighting(sourceHighlightStyle),
      EditorView.theme(SOURCE_THEME_SPEC),
      EditorView.contentAttributes.of({ "aria-label": `Markdown editor: ${name}`, tabindex: "0" }),
    ],
  });
}
/** Minimal mounted surface; tests can exercise actual transactions through an inert view. */
export interface MarkdownView {
  composing?: boolean;
  state: EditorState;
  scrollDOM: HTMLElement;
  update(transactions: readonly Transaction[]): void;
  setState(state: EditorState): void;
  dispatch(spec: TransactionSpec): void;
  destroy(): void;
}
/** Lifecycle contract keeps React independent of CodeMirror DOM internals. */
export interface MarkdownEditorAdapter {
  setText(text: string): void;
  setBlocked(blocked: boolean): void;
  readState(): EditorState;
  readScrollTop(): number;
  destroy(): void;
}
/** Create one editable surface with admission checks before applying transactions. */
export function createMarkdownEditor(
  options: {
    parent: HTMLElement;
    text: string;
    name: string;
    state: EditorState | null;
    scrollTop: number;
    accept(text: string): boolean;
    onState(state: EditorState): void;
  },
  factory: (config: {
    state: EditorState;
    parent: HTMLElement;
    dispatchTransactions(transactions: readonly Transaction[]): void;
  }) => MarkdownView = (config) => new EditorView(config),
): MarkdownEditorAdapter {
  let blocked = false;
  const admission = new Compartment();
  const initial = options.state ?? createMarkdownState(options.text, options.name);
  const view = factory({
    state: initial.update({ effects: StateEffect.appendConfig.of(admission.of([])) }).state,
    parent: options.parent,
    /** Refuse oversize or boundary-locked transactions before they reach the view. */
    dispatchTransactions(transactions) {
      for (const transaction of transactions) {
        if (
          transaction.docChanged &&
          ((blocked && !view.composing) || !options.accept(transaction.state.field(rawMarkdown)))
        )
          continue;
        view.update([transaction]);
        options.onState(view.state);
      }
    },
  });
  view.scrollDOM.scrollTop = options.scrollTop;
  return {
    /** Acknowledgements preserve history; authoritative replacement clears it. */
    setText(text) {
      if (view.state.field(rawMarkdown) !== text)
        view.setState(createMarkdownState(text, options.name));
    },
    /** Deny subsequent edits while preserving selectable content. */
    setBlocked(value) {
      blocked = value;
    },
    /** Capture selection and lossless undo history before unmount. */
    readState: () => view.state,
    /** Capture the edit-mode scroll independently of preview. */
    readScrollTop: () => view.scrollDOM.scrollTop,
    /** Release only the DOM view, leaving state owned by the entry. */
    destroy: () => view.destroy(),
  };
}
