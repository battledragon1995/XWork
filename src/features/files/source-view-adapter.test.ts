import { EditorState, type Extension, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSourceExtensions,
  createSourceState,
  createSourceView,
  type SourceEditorView,
  SOURCE_THEME_SPEC,
  SOURCE_TOKEN_COLORS,
  sourceHighlightStyle,
  sourceLanguageCompartment,
} from "./source-view-adapter";

// Spy on the gutter factory so the line-number requirement is observable without a real view.
vi.mock("@codemirror/view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/view")>();
  return { ...actual, lineNumbers: vi.fn(actual.lineNumbers) };
});

/** Record every construction, transaction and teardown without mounting CodeMirror. */
function fakeViewFactory() {
  const views: {
    view: SourceEditorView;
    parent: HTMLElement;
    transactions: TransactionSpec[];
    destroyed: number;
  }[] = [];
  // Build one inert double whose state is a real EditorState so facets stay authoritative.
  const create = vi.fn((config: { state: EditorState; parent: HTMLElement }) => {
    const scrollDOM = document.createElement("div");
    const record = {
      parent: config.parent,
      transactions: [] as TransactionSpec[],
      destroyed: 0,
      view: {
        state: config.state,
        scrollDOM,
        // Apply the transaction to the real state so later assertions see the effect.
        dispatch(spec: TransactionSpec) {
          record.transactions.push(spec);
          record.view.state = record.view.state.update(spec).state;
        },
        // Count teardown so double-destroy is provable.
        destroy() {
          record.destroyed += 1;
        },
      } satisfies SourceEditorView,
    };
    views.push(record);
    return record.view;
  });
  return { create, views };
}

/** Give a fake scroller measurable geometry, which jsdom never computes on its own. */
function measure(element: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
}

beforeEach(() => {
  vi.mocked(lineNumbers).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("source state configuration", () => {
  /** No keyboard, mouse or IME path may alter a viewer document. */
  it("configures the state read-only and the view noneditable", () => {
    const state = createSourceState("fn main() {}\n", null);
    expect(state.readOnly).toBe(true);
    expect(state.facet(EditorView.editable)).toBe(false);
  });

  /** The wireframe shows a line-number gutter on every source surface. */
  it("configures a line-number gutter", () => {
    createSourceState("a\nb\n", null);
    expect(lineNumbers).toHaveBeenCalled();
  });

  /** Read-only must not mean unreachable: the surface stays focusable and selectable. */
  it("keeps the surface focusable and marked read-only", () => {
    const state = createSourceState("a", null);
    // The facet collects raw inputs, so the static attribute objects are merged here.
    const provided = state
      .facet(EditorView.contentAttributes)
      .filter((value): value is Record<string, string> => typeof value !== "function");
    const attributes: Record<string, string> = Object.assign({}, ...provided);
    expect(attributes.tabindex).toBe("0");
    expect(attributes["aria-readonly"]).toBe("true");
  });

  /**
   * An empty keymap facet is the strongest available proof that no editing command, Tab
   * indentation, history, search panel, folding or completion binding was installed.
   */
  it("installs no keymap at all", () => {
    const state = createSourceState("a", null);
    expect(state.facet(keymap)).toHaveLength(0);
  });

  /** The language always arrives through the compartment so it can be swapped later. */
  it("puts the language inside the language compartment", () => {
    const language = EditorState.tabSize.of(4);
    const state = createSourceState("a", language);
    expect(sourceLanguageCompartment.get(state)).toBe(language);
    expect(state.tabSize).toBe(4);
  });

  /** Plain text still builds a valid surface, with an empty compartment. */
  it("accepts a null language", () => {
    const state = createSourceState("a", null);
    expect(buildSourceExtensions(null)).not.toHaveLength(0);
    expect(sourceLanguageCompartment.get(state)).toEqual([]);
  });
});

describe("appearance mapping", () => {
  /** Background, foreground and font size come from Appearance, never from a local palette. */
  it("maps the surface to terminal variables", () => {
    expect(SOURCE_THEME_SPEC["&"]).toMatchObject({
      backgroundColor: "var(--terminal-background)",
      color: "var(--terminal-foreground)",
      fontSize: "var(--terminal-font-size)",
    });
    expect(SOURCE_THEME_SPEC[".cm-gutters"]).toMatchObject({
      color: "var(--terminal-ansi-8)",
      backgroundColor: "var(--terminal-background)",
    });
  });

  /** A long line must scroll inside the pane instead of widening it. */
  it("scrolls instead of wrapping", () => {
    expect(SOURCE_THEME_SPEC[".cm-scroller"]?.overflow).toBe("auto");
    expect(SOURCE_THEME_SPEC[".cm-content"]?.whiteSpace).toBe("pre");
  });

  /** Every FE-017 token group resolves to its documented Appearance variable. */
  it("pins the token colour mapping", () => {
    expect(SOURCE_TOKEN_COLORS).toEqual({
      comment: "var(--terminal-ansi-8)",
      keyword: "var(--terminal-ansi-4)",
      string: "var(--terminal-ansi-3)",
      number: "var(--terminal-ansi-5)",
      type: "var(--terminal-ansi-6)",
      functionName: "var(--terminal-ansi-2)",
      property: "var(--terminal-ansi-6)",
      invalid: "var(--terminal-ansi-1)",
    });
  });

  /** The highlight style must actually assign a class to each mapped group. */
  it.each([
    tags.comment,
    tags.keyword,
    tags.operatorKeyword,
    tags.string,
    tags.character,
    tags.regexp,
    tags.number,
    tags.bool,
    tags.null,
    tags.typeName,
    tags.className,
    tags.namespace,
    tags.macroName,
    tags.propertyName,
    tags.attributeName,
    tags.invalid,
  ])("styles a mapped token group", (tag) => {
    expect(sourceHighlightStyle.style([tag])).toBeTruthy();
  });

  /** The generated rules must reference the variables rather than literal colours. */
  it("emits only Appearance variables in its rules", () => {
    const rules = sourceHighlightStyle.module?.getRules() ?? "";
    for (const color of Object.values(SOURCE_TOKEN_COLORS)) {
      expect(rules).toContain(color);
    }
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("createSourceView", () => {
  /** The adapter mounts exactly one view into the host element it was given. */
  it("constructs one view for the host element", () => {
    const factory = fakeViewFactory();
    const parent = document.createElement("div");
    createSourceView({ parent, doc: "a\nb", language: null }, factory.create);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(factory.views[0]?.parent).toBe(parent);
    expect(factory.views[0]?.view.state.doc.toString()).toBe("a\nb");
  });

  /** A backend reload replaces content through a transaction, never a new view. */
  it("replaces content without recreating the view", () => {
    const factory = fakeViewFactory();
    const adapter = createSourceView(
      { parent: document.createElement("div"), doc: "old", language: null },
      factory.create,
    );
    adapter.setDoc("new content");
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(factory.views[0]?.view.state.doc.toString()).toBe("new content");
    expect(factory.views[0]?.view.state.readOnly).toBe(true);
  });

  /** A late language load reconfigures the compartment on the same view. */
  it("swaps the language through the compartment", () => {
    const factory = fakeViewFactory();
    const adapter = createSourceView(
      { parent: document.createElement("div"), doc: "a", language: null },
      factory.create,
    );
    const language: Extension = EditorState.tabSize.of(8);
    adapter.setLanguage(language);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(sourceLanguageCompartment.get(factory.views[0]?.view.state as EditorState)).toBe(
      language,
    );
    const effects = factory.views[0]?.transactions.at(-1)?.effects;
    expect(Array.isArray(effects) ? effects : [effects]).toHaveLength(1);
  });

  /** Clearing the language returns the surface to plain text on the same view. */
  it("clears the language without recreating the view", () => {
    const factory = fakeViewFactory();
    const adapter = createSourceView(
      { parent: document.createElement("div"), doc: "a", language: EditorState.tabSize.of(8) },
      factory.create,
    );
    adapter.setLanguage(null);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(sourceLanguageCompartment.get(factory.views[0]?.view.state as EditorState)).toEqual([]);
  });
});

describe("scroll position", () => {
  /** The saved offset must survive a remount. */
  it("reads and writes the scroller offset", () => {
    const factory = fakeViewFactory();
    const adapter = createSourceView(
      { parent: document.createElement("div"), doc: "a", language: null },
      factory.create,
    );
    const scroller = factory.views[0]?.view.scrollDOM as HTMLElement;
    measure(scroller, 1000, 200);
    adapter.writeScrollTop(320);
    expect(scroller.scrollTop).toBe(320);
    expect(adapter.readScrollTop()).toBe(320);
  });

  /** A shorter reload must clamp instead of leaving the viewer past the last line. */
  it("clamps a restored offset to the remaining range", () => {
    const factory = fakeViewFactory();
    const adapter = createSourceView(
      { parent: document.createElement("div"), doc: "a", language: null },
      factory.create,
    );
    const scroller = factory.views[0]?.view.scrollDOM as HTMLElement;
    measure(scroller, 300, 200);
    adapter.writeScrollTop(5_000);
    expect(scroller.scrollTop).toBe(100);
    adapter.writeScrollTop(-40);
    expect(scroller.scrollTop).toBe(0);
  });

  /** The owner is told about user scrolling so it can persist the position. */
  it("reports user scrolling to the owner", () => {
    const factory = fakeViewFactory();
    const onScroll = vi.fn();
    createSourceView(
      { parent: document.createElement("div"), doc: "a", language: null, onScroll },
      factory.create,
    );
    const scroller = factory.views[0]?.view.scrollDOM as HTMLElement;
    measure(scroller, 1000, 200);
    scroller.scrollTop = 64;
    scroller.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledWith(64);
  });
});

describe("teardown", () => {
  /** Unmounting must release the view and stop every callback it owned. */
  it("destroys the view and detaches the scroll listener", () => {
    const factory = fakeViewFactory();
    const onScroll = vi.fn();
    const adapter = createSourceView(
      { parent: document.createElement("div"), doc: "a", language: null, onScroll },
      factory.create,
    );
    const scroller = factory.views[0]?.view.scrollDOM as HTMLElement;
    adapter.destroy();
    scroller.dispatchEvent(new Event("scroll"));
    expect(factory.views[0]?.destroyed).toBe(1);
    expect(onScroll).not.toHaveBeenCalled();
  });

  /** A second teardown, which React can trigger, must stay inert. */
  it("ignores a repeated teardown and later updates", () => {
    const factory = fakeViewFactory();
    const adapter = createSourceView(
      { parent: document.createElement("div"), doc: "a", language: null },
      factory.create,
    );
    adapter.destroy();
    adapter.destroy();
    adapter.setDoc("late");
    adapter.setLanguage(EditorState.tabSize.of(2));
    adapter.writeScrollTop(10);
    expect(factory.views[0]?.destroyed).toBe(1);
    expect(factory.views[0]?.transactions).toHaveLength(0);
    expect(adapter.readScrollTop()).toBe(0);
  });
});
