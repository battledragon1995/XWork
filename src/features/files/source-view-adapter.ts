import { HighlightStyle, syntaxHighlighting, type TagStyle } from "@codemirror/language";
import { Compartment, EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** Exact FE-017 token-group to CSS-variable mapping; the surface adds no palette of its own. */
export const SOURCE_TOKEN_COLORS = {
  comment: "var(--terminal-ansi-8)",
  keyword: "var(--terminal-ansi-4)",
  string: "var(--terminal-ansi-3)",
  number: "var(--terminal-ansi-5)",
  type: "var(--terminal-ansi-6)",
  functionName: "var(--terminal-ansi-2)",
  property: "var(--terminal-ansi-6)",
  invalid: "var(--terminal-ansi-1)",
} as const;

/**
 * Surface chrome, expressed only through Appearance-owned custom properties so an Appearance
 * change repaints the live view without any content being rebuilt.
 */
export const SOURCE_THEME_SPEC: Record<string, Record<string, string>> = {
  "&": {
    backgroundColor: "var(--terminal-background)",
    color: "var(--terminal-foreground)",
    fontSize: "var(--terminal-font-size)",
    height: "100%",
    minWidth: "0",
    minHeight: "0",
  },
  // `overflow: auto` keeps both axes inside the pane instead of widening the window.
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5",
    overflow: "auto",
  },
  // `pre` is what stops one very long source line from wrapping.
  ".cm-content": {
    whiteSpace: "pre",
  },
  ".cm-gutters": {
    backgroundColor: "var(--terminal-background)",
    color: "var(--terminal-ansi-8)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    color: "var(--terminal-ansi-8)",
  },
  // The default focus ring is invisible against a dark surface, so it is restated here.
  "&.cm-focused": {
    outline: "1px solid var(--terminal-ansi-4)",
    outlineOffset: "-1px",
  },
};

/** Every FE-017 token group, each pointing at one Appearance variable. */
export const SOURCE_HIGHLIGHT_SPECS: TagStyle[] = [
  { tag: tags.comment, color: SOURCE_TOKEN_COLORS.comment },
  { tag: [tags.keyword, tags.operatorKeyword], color: SOURCE_TOKEN_COLORS.keyword },
  { tag: [tags.string, tags.character, tags.regexp], color: SOURCE_TOKEN_COLORS.string },
  { tag: [tags.number, tags.bool, tags.null], color: SOURCE_TOKEN_COLORS.number },
  { tag: [tags.typeName, tags.className, tags.namespace], color: SOURCE_TOKEN_COLORS.type },
  { tag: [tags.propertyName, tags.attributeName], color: SOURCE_TOKEN_COLORS.property },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
    color: SOURCE_TOKEN_COLORS.functionName,
  },
  { tag: tags.invalid, color: SOURCE_TOKEN_COLORS.invalid },
];

/** Highlight style that paints every FE-017 token group with an Appearance variable. */
export const sourceHighlightStyle = HighlightStyle.define(SOURCE_HIGHLIGHT_SPECS);

/** Compartment that swaps the language without rebuilding the view. */
export const sourceLanguageCompartment = new Compartment();

/**
 * Build the complete read-only extension set for one source surface. Editing commands, Tab
 * indentation, history, search, folding and completion are all absent by construction: the
 * viewer installs no keymap at all, so nothing can bind an editing action.
 */
export function buildSourceExtensions(language: Extension | null): Extension[] {
  return [
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    // A noneditable surface still has to be reachable by keyboard and selectable by mouse.
    EditorView.contentAttributes.of({ tabindex: "0", "aria-readonly": "true" }),
    EditorView.theme(SOURCE_THEME_SPEC, { dark: true }),
    syntaxHighlighting(sourceHighlightStyle),
    sourceLanguageCompartment.of(language ?? []),
  ];
}

/** Build the state a source surface starts from. */
export function createSourceState(doc: string, language: Extension | null): EditorState {
  return EditorState.create({ doc, extensions: buildSourceExtensions(language) });
}

/** Minimal editor surface the adapter drives; tests substitute a double for it. */
export interface SourceEditorView {
  state: EditorState;
  scrollDOM: HTMLElement;
  dispatch(spec: TransactionSpec): void;
  destroy(): void;
}

/** Construct one editor view; production uses CodeMirror, tests use an inert double. */
export type SourceEditorViewFactory = (config: {
  state: EditorState;
  parent: HTMLElement;
}) => SourceEditorView;

/** Everything the React host supplies when it mounts a surface. */
export interface SourceViewAdapterOptions {
  parent: HTMLElement;
  doc: string;
  language: Extension | null;
  /** Called whenever the user scrolls, so the owner can persist the position. */
  onScroll?(scrollTop: number): void;
}

/** Controlled handle over one live surface; the host never touches CodeMirror directly. */
export interface SourceViewAdapter {
  setDoc(text: string): void;
  setLanguage(language: Extension | null): void;
  readScrollTop(): number;
  writeScrollTop(scrollTop: number): void;
  destroy(): void;
}

/** Create the production editor view. */
const createEditorView: SourceEditorViewFactory = (config) => new EditorView(config);

/** Mount one read-only source surface and return the controlled handle over it. */
export function createSourceView(
  options: SourceViewAdapterOptions,
  createView: SourceEditorViewFactory = createEditorView,
): SourceViewAdapter {
  const view = createView({
    state: createSourceState(options.doc, options.language),
    parent: options.parent,
  });
  const scroller = view.scrollDOM;
  let destroyed = false;
  // Report scrolling to the owner so a remount can restore the reader's position.
  const handleScroll = () => {
    if (!destroyed) options.onScroll?.(scroller.scrollTop);
  };
  if (options.onScroll) scroller.addEventListener("scroll", handleScroll);
  return {
    // Replace the whole document through one transaction on the existing view.
    setDoc(text: string) {
      if (destroyed) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    // Swap the language through the compartment, never by rebuilding the view.
    setLanguage(language: Extension | null) {
      if (destroyed) return;
      view.dispatch({ effects: sourceLanguageCompartment.reconfigure(language ?? []) });
    },
    // Report the current vertical offset of the scroller.
    readScrollTop() {
      return destroyed ? 0 : scroller.scrollTop;
    },
    // Restore a saved offset, clamped so a shorter reload cannot leave the reader past the end.
    writeScrollTop(scrollTop: number) {
      if (destroyed) return;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.min(Math.max(scrollTop, 0), maximum);
    },
    // Release the view and every listener it owns; a repeated call stays inert.
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scroller.removeEventListener("scroll", handleScroll);
      view.destroy();
    },
  };
}
