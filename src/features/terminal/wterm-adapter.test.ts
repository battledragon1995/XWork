import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GhosttyCore } from "@wterm/ghostty";
import { WTerm } from "@wterm/dom";
import type { TerminalHistoryCore, WTermAdapterFactory, WTermSurface } from "./wterm-adapter";
import {
  RETAINED_SCROLLBACK_BYTES,
  WTermAdapter,
  readCoreRows,
  measureTerminalGrid,
} from "./wterm-adapter";

/** Replays empty startup scrolling without hiding subsequent output or changing stored history. */
it("omits leading empty scrollback from the rendered terminal", async () => {
  vi.useFakeTimers();
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(wasm));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const adapter = new WTermAdapter({ onData: vi.fn(), onResize: vi.fn() });
  const encode = new TextEncoder();
  try {
    await adapter.initialize(host, { columns: 20, rows: 4 });
    adapter.write(encode.encode("\u001b[4;1H\r\n\u001b[HAsk Codex"));
    await vi.advanceTimersByTimeAsync(60);
    expect(adapter.historyCore?.getScrollbackCount()).toBe(1);
    expect(adapter.element).not.toHaveClass("has-scrollback");
    expect(adapter.element.querySelectorAll(".term-scrollback-row")).toHaveLength(0);
    expect(adapter.element.textContent).toContain("Ask Codex");

    adapter.write(encode.encode("\u001b[4;1H\r\n\r\n"));
    await vi.advanceTimersByTimeAsync(60);
    expect(adapter.element).toHaveClass("has-scrollback");
    const history = adapter.element.querySelectorAll(".term-scrollback-row");
    expect(history).toHaveLength(2);
    expect(history[0].textContent).toContain("Ask Codex");
    expect(history[1].textContent?.trim()).toBe("");
    expect(adapter.readHistoryRows().slice(0, 3)).toEqual(["", "Ask Codex", ""]);
    adapter.element.style.setProperty("--term-row-height", "18px");
    adapter.scrollToHistoryRow(2);
    expect(adapter.element.scrollTop).toBe(18);
    adapter.scrollToHistoryRow(0);
    expect(adapter.element.scrollTop).toBe(0);

    adapter.write(encode.encode("\u001b[?1049h"));
    await vi.advanceTimersByTimeAsync(60);
    expect(adapter.element).not.toHaveClass("has-scrollback");
    adapter.write(encode.encode("\u001b[?1049l"));
    await vi.advanceTimersByTimeAsync(60);
    expect(adapter.element).toHaveClass("has-scrollback");

    adapter.write(encode.encode("\u001b[3J"));
    await vi.advanceTimersByTimeAsync(60);
    expect(adapter.element).not.toHaveClass("has-scrollback");
  } finally {
    adapter.destroy();
    host.remove();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

/** Keeps painted whitespace visible because it can carry terminal graphics or highlighting. */
it("retains leading scrollback with a painted background", async () => {
  vi.useFakeTimers();
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(wasm));
  const adapter = new WTermAdapter({ onData: vi.fn(), onResize: vi.fn() });
  try {
    await adapter.initialize(document.createElement("div"), { columns: 20, rows: 4 });
    adapter.write(new TextEncoder().encode("\u001b[41m \u001b[0m\u001b[4;1H\r\n"));
    await vi.advanceTimersByTimeAsync(60);
    expect(adapter.element).toHaveClass("has-scrollback");
    expect(adapter.element.querySelectorAll(".term-scrollback-row")).toHaveLength(1);
  } finally {
    adapter.destroy();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

/** Replays ConPTY's split cursor restoration through the production app adapter and CSS. */
it("does not paint the intermediate cursor after a ConPTY synchronized redraw", async () => {
  vi.useFakeTimers();
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(wasm, { headers: { "content-type": "application/wasm" } }));
  const style = document.createElement("style");
  style.textContent = readFileSync("src/features/terminal/terminal.css", "utf8");
  document.head.appendChild(style);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onData = vi.fn();
  const adapter = new WTermAdapter({ onData, onResize: vi.fn() });
  const encode = new TextEncoder();
  try {
    await adapter.initialize(host, { columns: 40, rows: 6 });
    adapter.write(encode.encode("\u001b[3;1HAsk Codex\u001b[3;1H"));
    await vi.advanceTimersByTimeAsync(60);
    expect(adapter.element).not.toHaveClass("terminal-output-active");

    // The real capture ends synchronized output before ConPTY restores the input row.
    adapter.write(encode.encode("\u001b[?2026h\u001b[?25l\u001b[1;1H\u001b[?25h"));
    adapter.write(encode.encode("\u001b[0 q\u001b[?2026l"));
    await vi.advanceTimersByTimeAsync(20);
    const intermediate = adapter.element.querySelector(".term-cursor");
    expect(intermediate).not.toBeNull();
    expect(getComputedStyle(intermediate as Element).animation).toBe("none");
    expect(getComputedStyle(intermediate as Element).outlineStyle).toBe("none");
    expect(adapter.element).toHaveClass("terminal-output-active");

    adapter.write(encode.encode("\u001b[?25l \u001b[3;1H\u001b[?25h\u001b[6n"));
    // Protocol responses must not wait for the visual settling timer.
    expect(onData).toHaveBeenCalledWith("\u001b[3;1R");
    await vi.advanceTimersByTimeAsync(30);
    expect(adapter.element).toHaveClass("terminal-output-active");
    await vi.advanceTimersByTimeAsync(30);
    expect(adapter.element).not.toHaveClass("terminal-output-active");
    expect(adapter.element.querySelectorAll(".term-cursor")).toHaveLength(1);
    expect(adapter.element.querySelector(".term-cursor")?.parentElement?.textContent).toContain(
      "Ask Codex",
    );

    adapter.write(encode.encode("\u001b[1;1H"));
    adapter.destroy();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    adapter.destroy();
    host.remove();
    style.remove();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

/** Matches WTerm's rounded row height and excludes surface padding and the live scrollbar. */
it("measures a grid that fits fractional font metrics inside the pane", () => {
  const host = document.createElement("div");
  const surface = document.createElement("div");
  surface.style.padding = "10px";
  surface.style.borderWidth = "0px";
  host.appendChild(surface);
  document.body.appendChild(host);
  Object.defineProperty(surface, "clientWidth", { value: 1015 });
  const bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    // Supply deterministic layout because jsdom does not measure fonts or boxes.
    .mockImplementation(function (this: HTMLElement) {
      if (this.style.width === "100px") return { width: 100 } as DOMRect;
      return { width: this === host ? 1030 : 7.14, height: this === host ? 672 : 17.55 } as DOMRect;
    });
  try {
    expect(measureTerminalGrid(host, surface)).toEqual({ columns: 139, rows: 36 });
  } finally {
    bounds.mockRestore();
    host.remove();
  }
});

/** Keeps the rightmost column inside one cell of the available width at every interface scale. */
it.each([0.8571, 1, 1.0714, 1.1429, 1.4286])(
  "fills terminal width at interface scale %s with and without a scrollbar",
  (scale) => {
    const host = document.createElement("div");
    const surface = document.createElement("div");
    surface.style.padding = "10px";
    surface.style.border = "1px solid";
    host.appendChild(surface);
    document.body.appendChild(host);
    let clientWidth = 0;
    Object.defineProperty(surface, "clientWidth", { get: () => clientWidth });
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      /** Models CSS zoom: DOM rectangles scale, but clientWidth and CSS padding do not. */
      .mockImplementation(function (this: HTMLElement) {
        const width = this === host ? 1030 : this.style.width === "100px" ? 100 : 7.14;
        return { width: width * scale, height: (this === host ? 672 : 17.55) * scale } as DOMRect;
      });
    try {
      // The first measurement precedes initialization; later measurements include the scrollbar.
      for (const width of [0, 1028, 1013]) {
        clientWidth = width;
        const available = (width || 1028) - 20;
        const columns = measureTerminalGrid(host, surface)?.columns ?? 0;
        expect(columns * 7.14).toBeLessThanOrEqual(available);
        expect(available - columns * 7.14).toBeLessThan(7.14);
      }
    } finally {
      bounds.mockRestore();
      host.remove();
    }
  },
);

/** Checks the last row against WTerm's real initialized row-height rule, including later zoom changes. */
it.each([0.8571, 1, 1.0714, 1.1429, 1.4286])(
  "fits the full terminal height before and after initialization at scale %s",
  async (initialScale) => {
    const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(wasm));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const adapter = new WTermAdapter({ onData: vi.fn(), onResize: vi.fn() });
    adapter.element.style.padding = "10px";
    adapter.element.style.border = "1px solid";
    let scale = initialScale;
    let height = 672;
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      /** Models actual CSS row layout while letting the real WTerm set its rounded row-height token. */
      .mockImplementation(function (this: HTMLElement) {
        const rowHeight =
          Number.parseFloat(adapter.element.style.getPropertyValue("--term-row-height")) || 17.55;
        const width = this === host ? 1030 : this.style.width === "100px" ? 100 : 7.14;
        const elementHeight =
          this === host ? height : this.classList.contains("term-row") ? rowHeight : 17.55;
        return { width: width * scale, height: elementHeight * scale } as DOMRect;
      });
    /** Requires the last row to fit and the remaining bottom gap to be smaller than one row. */
    const expectFullHeight = (): void => {
      const rowHeight = Number.parseFloat(
        adapter.element.style.getPropertyValue("--term-row-height"),
      );
      const used = (adapter.size?.rows ?? 0) * rowHeight;
      expect(used).toBeLessThanOrEqual(height - 22);
      expect(height - 22 - used).toBeLessThan(rowHeight);
    };
    try {
      await adapter.initialize(host);
      expectFullHeight();
      adapter.measureAndResize();
      expectFullHeight();
      // Existing surfaces retain WTerm's inline row height when the pane or interface scale changes.
      scale = 1.25;
      height = 513;
      adapter.measureAndResize();
      expectFullHeight();
    } finally {
      adapter.destroy();
      bounds.mockRestore();
      fetch.mockRestore();
      host.remove();
    }
  },
);

/** Allows WTerm's dynamic cell colors in release without permitting inline scripts or style elements. */
it("allows terminal cell style attributes in the release CSP", () => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const directives = config.app.security.csp.split(";").map((value: string) => value.trim());
  expect(directives).toContain("style-src-attr 'unsafe-inline'");
  expect(directives).toContain("style-src 'self'");
  expect(directives).toContain("script-src 'self' 'wasm-unsafe-eval'");
});

/** Builds one plain printable cell for fake core rows. */
function cell(character: string, width = 1) {
  return { char: character.codePointAt(0) ?? 32, fg: 0, bg: 0, flags: 0, width };
}

/** Implements the history and mode surface needed by the adapter. */
class FakeCore implements TerminalHistoryCore {
  readonly viewport = ["first", "second"];
  readonly history = ["history"];
  altScreen = false;
  bracketed = false;

  /** Returns the fixed fake width. */
  getCols(): number {
    return 8;
  }

  /** Returns the fixed fake height. */
  getRows(): number {
    return this.viewport.length;
  }

  /** Returns one viewport cell.
   */
  getCell(row: number, column: number) {
    return cell(this.viewport[row]?.[column] ?? " ");
  }

  /** Returns one retained row. */
  getScrollbackCount(): number {
    return this.history.length;
  }

  /** Returns one retained cell. */
  getScrollbackCell(offset: number, column: number) {
    return cell(this.history[offset]?.[column] ?? " ");
  }

  /** Returns the retained line length. */
  getScrollbackLineLen(offset: number): number {
    return this.history[offset]?.length ?? 0;
  }

  /** Reports the configured fake paste mode. */
  bracketedPaste(): boolean {
    return this.bracketed;
  }

  /** Reports the configured fake screen. */
  usingAltScreen(): boolean {
    return this.altScreen;
  }
}

/** Builds deterministic core and WTerm construction seams. */
function fixture() {
  const core = new FakeCore();
  const init = vi.fn(async () => surface);
  const write = vi.fn((data: string | Uint8Array) => {
    if (typeof data === "string" && data.startsWith("\u001b[2;1H")) {
      core.history.unshift(...[...core.viewport].reverse());
      core.viewport.fill("");
    } else if (data === "\u001b[2J\u001b[H") {
      core.viewport.fill("");
    }
  });
  const destroy = vi.fn();
  const surface: WTermSurface = {
    bridge: core as never,
    cols: 80,
    rows: 24,
    init,
    write,
    resize: vi.fn(),
    focus: vi.fn(),
    destroy,
  };
  const loadCore = vi.fn(async () => core as never);
  const createSurface = vi.fn(
    (
      _element: HTMLElement,
      _options: {
        core: GhosttyCore;
        columns: number;
        rows: number;
        onData(data: string): void;
      },
    ) => surface,
  );
  const factory: WTermAdapterFactory = {
    loadCore,
    createSurface,
    measure: vi.fn(() => ({ columns: 80, rows: 24 })),
  };
  return { core, surface, factory, loadCore, createSurface, init, write, destroy };
}

/** Verifies explicit Ghostty configuration, one initialization and persistent attachment. */
it("initializes one persistent Ghostty surface before accepting input", async () => {
  const value = fixture();
  const onData = vi.fn();
  const adapter = new WTermAdapter({ onData, onResize: vi.fn() }, value.factory);
  const first = document.createElement("div");
  const second = document.createElement("div");

  await Promise.all([adapter.initialize(first), adapter.initialize(first)]);
  adapter.detach(first);
  adapter.attach(second);

  expect(value.loadCore).toHaveBeenCalledTimes(1);
  expect(value.loadCore).toHaveBeenCalledWith(
    expect.objectContaining({ scrollbackLimit: RETAINED_SCROLLBACK_BYTES }),
  );
  expect(value.createSurface).toHaveBeenCalledTimes(1);
  expect(value.createSurface.mock.calls[0]?.[1].onData).toBe(onData);
  expect(value.init).toHaveBeenCalledTimes(1);
  expect(second.firstChild).toBe(adapter.element);
  expect(adapter.element.style.height).toBe("100%");
});

/** Verifies Clear Screen archives history, emits no PTY input and respects alternate screen. */
it("clears only the local primary screen while preserving searchable history", async () => {
  const value = fixture();
  const onData = vi.fn();
  const adapter = new WTermAdapter({ onData, onResize: vi.fn() }, value.factory);
  await adapter.initialize(document.createElement("div"));

  expect(adapter.clearScreen()).toBe(true);
  expect(adapter.readHistoryRows()).toContain("first");
  expect(adapter.readHistoryRows().filter((row) => row === "history")).toHaveLength(1);
  expect(adapter.readHistoryRows().filter((row) => row === "first")).toHaveLength(1);
  expect(adapter.readHistoryRows().slice(0, 3)).toEqual(["history", "first", "second"]);
  expect(value.write).toHaveBeenCalledWith("\u001b[2;1H\r\n\r\n\u001b[H");
  expect(onData).not.toHaveBeenCalled();

  value.core.altScreen = true;
  expect(adapter.clearScreen()).toBe(false);
  expect(value.write).toHaveBeenCalledTimes(1);
});

/** Verifies complete graphemes and continuation cells are read from retained core memory. */
it("reads history from core cells outside the mounted DOM", () => {
  const core: TerminalHistoryCore = {
    getCols: () => 3,
    getRows: () => 1,
    getScrollbackCount: () => 1,
    getScrollbackLineLen: () => 3,
    getScrollbackCell: (_row, column) =>
      column === 0
        ? { ...cell("🙂"), chars: "🙂", width: 2 }
        : column === 1
          ? cell(" ", 0)
          : cell("a"),
    getCell: (_row, column) => cell("xyz"[column] ?? " "),
    bracketedPaste: () => false,
    usingAltScreen: () => false,
  };
  expect(readCoreRows(core)).toEqual(["🙂a", "xyz"]);
});

/** Verifies a rejected core factory leaves no half-initialized renderer to launch a PTY. */
describe("initialization failure", () => {
  it("can retry only after surfacing the WASM failure", async () => {
    const value = fixture();
    value.loadCore.mockRejectedValueOnce(new Error("WASM unavailable"));
    const adapter = new WTermAdapter({ onData: vi.fn(), onResize: vi.fn() }, value.factory);
    const host = document.createElement("div");

    await expect(adapter.initialize(host)).rejects.toThrow("WASM unavailable");
    await adapter.initialize(host);
    expect(value.createSurface).toHaveBeenCalledTimes(1);
  });
});

/** Verifies the pinned WASM core retains output well beyond its small default byte budget. */
it("loads the local Ghostty WASM and retains an early row with the maximum budget", async () => {
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(wasm, {
      status: 200,
      headers: { "content-type": "application/wasm" },
    }),
  );
  try {
    const core = await GhosttyCore.load({
      wasmPath: "/fixture/ghostty-vt.wasm",
      scrollbackLimit: RETAINED_SCROLLBACK_BYTES,
    });
    core.init(40, 4);
    core.writeString(`first-retained-row\r\n${"012345678901234567890123456789\r\n".repeat(600)}`);

    expect(readCoreRows(core).some((row) => row.includes("first-retained-row"))).toBe(true);
    expect(core.getScrollbackCount()).toBeGreaterThan(300);
  } finally {
    fetch.mockRestore();
  }
});

/** Verifies Ghostty marks alternate-screen content dirty for the DOM renderer. */
it("marks an alternate-screen update as renderable", async () => {
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(wasm, {
      status: 200,
      headers: { "content-type": "application/wasm" },
    }),
  );
  try {
    const core = await GhosttyCore.load({
      wasmPath: "/fixture/ghostty-vt.wasm",
      scrollbackLimit: RETAINED_SCROLLBACK_BYTES,
    });
    core.init(40, 4);
    core.clearDirty();
    core.writeString("\u001b[?1049hALT_SCREEN_SENTINEL");

    expect(core.usingAltScreen()).toBe(true);
    expect(readCoreRows(core)).toContain("ALT_SCREEN_SENTINEL");
    expect(Array.from({ length: core.getRows() }, (_, row) => core.isDirtyRow(row))).toContain(
      true,
    );
  } finally {
    fetch.mockRestore();
  }
});

/** Verifies WTerm paints alternate-screen cells after a synchronized-output fallback. */
it("renders alternate-screen content when synchronized output remains open", async () => {
  vi.useFakeTimers();
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(wasm, {
      status: 200,
      headers: { "content-type": "application/wasm" },
    }),
  );
  let surface: WTerm | null = null;
  try {
    const core = await GhosttyCore.load({
      wasmPath: "/fixture/ghostty-vt.wasm",
      scrollbackLimit: RETAINED_SCROLLBACK_BYTES,
    });
    const element = document.createElement("div");
    document.body.appendChild(element);
    surface = new WTerm(element, { core, cols: 40, rows: 4, autoResize: false });
    await surface.init();
    surface.write("\u001b[?2026h\u001b[?1049hALT_SCREEN_SENTINEL");
    await vi.advanceTimersByTimeAsync(1100);

    expect(element.textContent).toContain("ALT_SCREEN_SENTINEL");
  } finally {
    surface?.destroy();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

/** Verifies a maximum-retention alternate screen remains resizable after TUI output. */
it("resizes a maximum-retention alternate screen without trapping", async () => {
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(wasm, {
      status: 200,
      headers: { "content-type": "application/wasm" },
    }),
  );
  let surface: WTerm | null = null;
  try {
    const core = await GhosttyCore.load({
      wasmPath: "/fixture/ghostty-vt.wasm",
      scrollbackLimit: RETAINED_SCROLLBACK_BYTES,
    });
    const element = document.createElement("div");
    document.body.appendChild(element);
    surface = new WTerm(element, { core, cols: 141, rows: 37, autoResize: false });
    await surface.init();
    surface.write("\u001b[?1049hCODEX_TUI_SENTINEL");

    expect(() => surface?.resize(142, 37)).not.toThrow();
    expect(() => surface?.resize(141, 37)).not.toThrow();
    expect(() => surface?.resize(143, 37)).not.toThrow();
    expect(readCoreRows(core)).toContain("CODEX_TUI_SENTINEL");
  } finally {
    surface?.destroy();
    fetch.mockRestore();
  }
});

/** Verifies Clear Screen moves the old viewport into WTerm's renderable core scrollback once. */
it("keeps a cleared viewport in renderable Ghostty scrollback", async () => {
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(wasm, {
      status: 200,
      headers: { "content-type": "application/wasm" },
    }),
  );
  let adapter: WTermAdapter | null = null;
  try {
    const core = await GhosttyCore.load({
      wasmPath: "/fixture/ghostty-vt.wasm",
      scrollbackLimit: RETAINED_SCROLLBACK_BYTES,
    });
    const surface: WTermSurface = {
      bridge: core,
      cols: 40,
      rows: 4,
      /** Initializes the real pinned WASM core. */
      init: async () => {
        core.init(40, 4);
        return surface;
      },
      /** Applies the exact local display bytes that the adapter passes to WTerm. */
      write: (data) => {
        if (typeof data === "string") core.writeString(data);
        else core.writeRaw(data);
      },
      resize: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
    };
    adapter = new WTermAdapter(
      { onData: vi.fn(), onResize: vi.fn() },
      {
        loadCore: async () => core,
        createSurface: () => surface,
        measure: () => ({ columns: 40, rows: 4 }),
      },
    );
    await adapter.initialize(document.createElement("div"));
    adapter.write(new TextEncoder().encode("BEFORE_CLEAR_SENTINEL"));

    adapter.clearScreen();
    const retainedAfterFirstClear = readCoreRows(core);
    adapter.clearScreen();

    expect(retainedAfterFirstClear).toContain("BEFORE_CLEAR_SENTINEL");
    expect(readCoreRows(core).filter((row) => row === "BEFORE_CLEAR_SENTINEL")).toHaveLength(1);
  } finally {
    adapter?.destroy();
    fetch.mockRestore();
  }
});
