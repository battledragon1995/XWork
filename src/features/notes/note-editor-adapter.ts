import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
/** Construct a Notes editor with Markdown history and UTF-8 admission. */
export function createNoteEditorState(
  text: string,
  onChange: (state: EditorState) => void,
  onComposition: (active: boolean) => void,
  readOnly = false,
) {
  return EditorState.create({
    doc: text,
    extensions: [
      markdown(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({
        "aria-label": "Note Markdown",
        role: "textbox",
        "aria-multiline": "true",
      }),
      EditorState.transactionFilter.of(
        /** Reject oversize documents before publication. */ (transaction) =>
          new TextEncoder().encode(transaction.newDoc.toString()).length > 1048576
            ? []
            : transaction,
      ),
      EditorView.updateListener.of(
        /** Retain history and selection as well as document edits. */ (update) => {
          if (update.docChanged || update.selectionSet) onChange(update.state);
        },
      ),
      EditorView.domEventHandlers({
        /** Pause debounce throughout IME composition. */ compositionstart: () => {
          onComposition(true);
          return false;
        },
        /** Resume only after the committed input transaction. */ compositionend: () => {
          onComposition(false);
          return false;
        },
      }),
      EditorView.theme({
        "&": { height: "100%", backgroundColor: "transparent", color: "inherit" },
        ".cm-scroller": { overflow: "auto", fontFamily: "inherit" },
        ".cm-content": { padding: "16px" },
        "&.cm-focused": { outline: "none" },
      }),
    ],
  });
}
/** Mount a retained state; a view factory isolates DOM work in unit tests. */
export function mountNoteEditor(
  parent: HTMLElement,
  state: EditorState,
  factory: (config: {
    parent: HTMLElement;
    state: EditorState;
  }) => Pick<
    EditorView,
    "destroy" | "focus" | "scrollDOM" | "state"
  > = /** Use the actual view only in the production host. */ (config) => new EditorView(config),
) {
  return factory({ parent, state });
}
