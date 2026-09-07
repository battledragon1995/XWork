import type { Extension } from "@codemirror/state";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, textFile } from "./files-test-fixture";
import { sourceLanguage, type SourceLanguageEntry } from "./source-language";
import { createSourceView, type SourceViewAdapterOptions } from "./source-view-adapter";
import { SourceView, type SourceViewProps } from "./source-view";

// The component is tested against an inert adapter; no CodeMirror view is mounted in jsdom.
vi.mock("./source-view-adapter", () => ({ createSourceView: vi.fn() }));

// Only the lookup is replaced so thresholds and labels stay real while loaders stay controllable.
vi.mock("./source-language", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./source-language")>();
  return { ...actual, sourceLanguage: vi.fn(actual.sourceLanguage) };
});

/** One adapter instance the component drove, recorded for assertions. */
interface AdapterRecord {
  options: SourceViewAdapterOptions;
  docs: string[];
  languages: (Extension | null)[];
  restored: number[];
  scrollTop: number;
  destroyed: number;
}

/** Every adapter built during the current test. */
const adapters: AdapterRecord[] = [];

/** Build a stub language entry whose loader the test controls. */
function languageEntry(load: () => Promise<Extension>, id = "rust"): SourceLanguageEntry {
  return {
    id,
    label: "Rust",
    module: "@codemirror/lang-rust",
    exportName: "rust",
    stream: false,
    load,
  };
}

/** Move the only live surface and notify the component, the way a real scroller would. */
function scrollSurface(scrollTop: number): void {
  const record = adapters[0];
  if (!record) throw new Error("No surface was mounted");
  record.scrollTop = scrollTop;
  record.options.onScroll?.(scrollTop);
}

/** Render the surface with inert defaults every case can override. */
function renderSource(overrides: Partial<SourceViewProps> = {}) {
  const props: SourceViewProps = {
    file: textFile(),
    name: "main.rs",
    watchMode: "native",
    isVisible: true,
    readScrollTop: () => 0,
    writeScrollTop: vi.fn(),
    ...overrides,
  };
  const view = render(<SourceView {...props} />);
  // Re-render with the same identity so a case can change only the snapshot.
  const update = (next: Partial<SourceViewProps>) =>
    view.rerender(<SourceView {...props} {...next} />);
  return { ...view, props, update };
}

beforeEach(() => {
  adapters.length = 0;
  vi.mocked(createSourceView).mockImplementation((options: SourceViewAdapterOptions) => {
    const record: AdapterRecord = {
      options,
      docs: [],
      languages: [],
      restored: [],
      scrollTop: 0,
      destroyed: 0,
    };
    adapters.push(record);
    return {
      // Record replaced content instead of running a CodeMirror transaction.
      setDoc: (value: string) => record.docs.push(value),
      // Record compartment reconfiguration requests.
      setLanguage: (value: Extension | null) => record.languages.push(value),
      // Report the position the component last restored or the user last scrolled to.
      readScrollTop: () => record.scrollTop,
      // Record every restoration request.
      writeScrollTop: (value: number) => {
        record.restored.push(value);
        record.scrollTop = value;
      },
      // Count teardown so a leaked view is provable.
      destroy: () => {
        record.destroyed += 1;
      },
    };
  });
  const resolved = Promise.resolve<Extension>([]);
  vi.mocked(sourceLanguage).mockImplementation(() => languageEntry(() => resolved));
});

// Unmount every surface so a later case cannot read a previous render.
afterEach(() => {
  cleanup();
});

describe("source surface", () => {
  /** FilePane uses a block parent, so flex growth alone leaves the absolute code host at zero height. */
  it("fills the pane height even inside a non-flex content container", () => {
    const { container } = renderSource();
    expect(container.firstElementChild).toHaveClass("h-full");
  });

  /** The code region is reachable by its accessible name. */
  it("labels the code region with the file name", () => {
    renderSource({ name: "pty.rs" });
    expect(screen.getByLabelText("Source view of pty.rs")).toBeInTheDocument();
  });

  /** The surface is built once from the backend text. */
  it("mounts one adapter with the backend text", () => {
    renderSource({ file: textFile({ text: "line one\nline two\n" }) });
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.options.doc).toBe("line one\nline two\n");
    expect(adapters[0]?.options.parent).toBe(screen.getByLabelText("Source view of main.rs"));
  });

  /** A reload replaces content on the live view rather than rebuilding it. */
  it("applies a reload through the existing adapter", () => {
    const { update } = renderSource({ file: textFile({ text: "before\n" }) });
    update({ file: textFile({ text: "after\n" }) });
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.docs).toEqual(["after\n"]);
  });

  /** The initial content must not be pushed twice on mount. */
  it("does not replay the initial content", () => {
    const { update } = renderSource({ file: textFile({ text: "same\n" }) });
    update({ file: textFile({ text: "same\n" }) });
    expect(adapters[0]?.docs).toEqual([]);
  });

  /** An empty file still gets a surface plus an explanation. */
  it("explains an empty file", () => {
    renderSource({ file: textFile({ text: "", byteSize: 0n, lineCount: 0 }) });
    expect(screen.getByText("This file is empty.")).toBeInTheDocument();
    expect(screen.getByText("0 lines")).toBeInTheDocument();
  });

  /** The surface is released when the pane closes. */
  it("destroys the adapter on unmount", () => {
    const { unmount } = renderSource();
    unmount();
    expect(adapters[0]?.destroyed).toBe(1);
  });
});

describe("language loading", () => {
  /** An eligible file loads its pack and applies it to the live view. */
  it("applies the loaded language without rebuilding the view", async () => {
    const gate = deferred<Extension>();
    const load = vi.fn(() => gate.promise);
    vi.mocked(sourceLanguage).mockReturnValue(languageEntry(load));
    renderSource({ file: textFile({ syntaxHint: "rs" }) });
    expect(load).toHaveBeenCalledTimes(1);
    const extension: Extension = [];
    await act(async () => {
      gate.resolve(extension);
      await gate.promise;
    });
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.languages.at(-1)).toBe(extension);
  });

  /** A missing extension is plain text, so no pack is requested at all. */
  it("skips loading for a null syntax hint", () => {
    const load = vi.fn(() => Promise.resolve<Extension>([]));
    vi.mocked(sourceLanguage).mockImplementation((hint) =>
      hint === null ? null : languageEntry(load),
    );
    renderSource({ file: textFile({ syntaxHint: null }) });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText("Plain text")).toBeInTheDocument();
    expect(screen.queryByText("Syntax highlighting is off for large files.")).toBeNull();
  });

  /** A file past the byte threshold never reaches a loader. */
  it("skips loading past the byte threshold", () => {
    const load = vi.fn(() => Promise.resolve<Extension>([]));
    vi.mocked(sourceLanguage).mockReturnValue(languageEntry(load));
    renderSource({ file: textFile({ syntaxHint: "rs", byteSize: 2_097_153n, lineCount: 10 }) });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText("Syntax highlighting is off for large files.")).toBeInTheDocument();
  });

  /** A file past the line threshold never reaches a loader either. */
  it("skips loading past the line threshold", () => {
    const load = vi.fn(() => Promise.resolve<Extension>([]));
    vi.mocked(sourceLanguage).mockReturnValue(languageEntry(load));
    renderSource({ file: textFile({ syntaxHint: "rs", byteSize: 10n, lineCount: 20_001 }) });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText("Syntax highlighting is off for large files.")).toBeInTheDocument();
  });

  /** Text sitting exactly on both thresholds is still highlighted. */
  it("still loads on the exact threshold", () => {
    const load = vi.fn(() => Promise.resolve<Extension>([]));
    vi.mocked(sourceLanguage).mockReturnValue(languageEntry(load));
    renderSource({
      file: textFile({ syntaxHint: "rs", byteSize: 2_097_152n, lineCount: 20_000 }),
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Syntax highlighting is off for large files.")).toBeNull();
  });

  /** Content at the viewer limit still displays; only highlighting is dropped. */
  it("displays text at the viewer limit without highlighting", () => {
    const load = vi.fn(() => Promise.resolve<Extension>([]));
    vi.mocked(sourceLanguage).mockReturnValue(languageEntry(load));
    renderSource({
      file: textFile({ text: "big\n", syntaxHint: "rs", byteSize: 5_242_880n, lineCount: 1 }),
    });
    expect(load).not.toHaveBeenCalled();
    expect(adapters[0]?.options.doc).toBe("big\n");
    expect(screen.getByText("Syntax highlighting is off for large files.")).toBeInTheDocument();
  });

  /** A rejected pack degrades to plain text once and is not retried. */
  it("handles a loader rejection once", async () => {
    const gate = deferred<Extension>();
    const load = vi.fn(() => gate.promise);
    vi.mocked(sourceLanguage).mockReturnValue(languageEntry(load));
    renderSource({ file: textFile({ syntaxHint: "rs" }) });
    gate.reject(new Error("chunk failed"));
    await gate.promise.catch(() => undefined);
    expect(
      await screen.findByText("Syntax highlighting is unavailable for this file."),
    ).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(adapters[0]?.languages.every((entry) => entry === null)).toBe(true);
  });

  /** A pack that resolves after the snapshot changed language must be discarded. */
  it("ignores a superseded loader result", async () => {
    const first = deferred<Extension>();
    const second = deferred<Extension>();
    vi.mocked(sourceLanguage).mockImplementation((hint) =>
      hint === "rs"
        ? languageEntry(() => first.promise)
        : languageEntry(() => second.promise, "go"),
    );
    const { update } = renderSource({ file: textFile({ syntaxHint: "rs" }) });
    update({ file: textFile({ syntaxHint: "go" }) });
    const stale: Extension = [];
    first.resolve(stale);
    await first.promise;
    expect(adapters[0]?.languages).not.toContain(stale);
  });

  /** A pack that resolves after unmount must never touch a destroyed view. */
  it("ignores a loader result after unmount", async () => {
    const gate = deferred<Extension>();
    vi.mocked(sourceLanguage).mockReturnValue(languageEntry(() => gate.promise));
    const { unmount } = renderSource({ file: textFile({ syntaxHint: "rs" }) });
    unmount();
    const late: Extension = [];
    gate.resolve(late);
    await gate.promise;
    expect(adapters[0]?.languages).not.toContain(late);
  });
});

describe("scroll position", () => {
  /** A cached tab reopens where the reader left off. */
  it("restores the saved position after mount", () => {
    renderSource({ readScrollTop: () => 240 });
    expect(adapters[0]?.restored).toContain(240);
  });

  /** A reload keeps the reader in place instead of jumping to the top. */
  it("restores the saved position after a content update", () => {
    const { update } = renderSource({ readScrollTop: () => 180, file: textFile({ text: "a\n" }) });
    update({ file: textFile({ text: "b\n" }) });
    expect(adapters[0]?.restored.filter((value) => value === 180)).toHaveLength(2);
  });

  /** User scrolling is persisted so a remount can restore it. */
  it("saves the position while the pane is visible", () => {
    const writeScrollTop = vi.fn();
    renderSource({ writeScrollTop });
    scrollSurface(96);
    expect(writeScrollTop).toHaveBeenCalledWith(96);
  });

  /** Closing the pane persists the final position. */
  it("saves the position on unmount", () => {
    const writeScrollTop = vi.fn();
    const { unmount } = renderSource({ writeScrollTop, readScrollTop: () => 120 });
    scrollSurface(140);
    writeScrollTop.mockClear();
    unmount();
    expect(writeScrollTop).toHaveBeenCalledWith(140);
  });

  /** A hidden pane measures zero, which must never replace a valid saved position. */
  it("never saves an unmeasured position from a hidden pane", () => {
    const writeScrollTop = vi.fn();
    const { unmount } = renderSource({
      writeScrollTop,
      isVisible: false,
      readScrollTop: () => 300,
    });
    scrollSurface(0);
    unmount();
    expect(writeScrollTop).not.toHaveBeenCalled();
  });
});

describe("status bar", () => {
  /** Language, encoding, line ending, line count and the read-only label are all shown. */
  it("renders the documented facts", () => {
    renderSource({ file: textFile({ syntaxHint: "ts", lineCount: 212, lineEnding: "crlf" }) });
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("UTF-8")).toBeInTheDocument();
    expect(screen.getByText("CRLF")).toBeInTheDocument();
    expect(screen.getByText("212 lines")).toBeInTheDocument();
    expect(screen.getByText("Read-only · edit in your editor")).toBeInTheDocument();
  });

  /** The backend line count wins even when it disagrees with the visible text. */
  it("trusts the backend line count", () => {
    renderSource({ file: textFile({ text: "a\nb\nc\n", lineCount: 1 }) });
    expect(screen.getByText("1 line")).toBeInTheDocument();
  });

  /** A byte-order mark is its own fact. */
  it("names a byte-order mark", () => {
    renderSource({ file: textFile({ hasUtf8Bom: true }) });
    expect(screen.getByText("UTF-8 with BOM")).toBeInTheDocument();
  });

  /** Mixed line endings are reported instead of being normalized away. */
  it("reports mixed line endings", () => {
    renderSource({ file: textFile({ lineEnding: "mixed" }) });
    expect(screen.getByText("Mixed")).toBeInTheDocument();
  });

  /** A file with no line break has no line-ending cell at all. */
  it("hides the line-ending cell for none", () => {
    renderSource({ file: textFile({ lineEnding: "none" }) });
    expect(screen.queryByText("LF")).toBeNull();
    expect(screen.queryByText("CRLF")).toBeNull();
    expect(screen.queryByText("Mixed")).toBeNull();
    expect(screen.queryByText("None")).toBeNull();
  });

  /** An unknown extension is plain text without guessing from the name. */
  it("labels an unknown extension as plain text", () => {
    renderSource({ file: textFile({ syntaxHint: "bak" }), name: "Makefile" });
    expect(screen.getByText("Plain text")).toBeInTheDocument();
  });

  /** Markdown is source-only for now and says so. */
  it("explains the deferred Markdown editor", () => {
    renderSource({ file: textFile({ mode: "markdown", syntaxHint: "md" }) });
    expect(
      screen.getByText("Editing and preview arrive with the Markdown editor."),
    ).toBeInTheDocument();
  });

  /** Source files carry no Markdown note. */
  it("omits the Markdown note for source files", () => {
    renderSource({ file: textFile({ mode: "sourceReadOnly" }) });
    expect(screen.queryByText("Editing and preview arrive with the Markdown editor.")).toBeNull();
  });

  /** A degraded watch mode is a backend fact worth surfacing. */
  it("warns about delayed change detection", () => {
    renderSource({ watchMode: "pollingFallback" });
    expect(screen.getByText("Change detection is delayed for this file.")).toBeInTheDocument();
  });

  /** Native watching adds no note. */
  it("stays quiet for native watching", () => {
    renderSource({ watchMode: "native" });
    expect(screen.queryByText("Change detection is delayed for this file.")).toBeNull();
  });
});
