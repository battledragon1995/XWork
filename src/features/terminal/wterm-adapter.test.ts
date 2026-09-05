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
      return { width: this === host ? 1030 : 7.14, height: this === host ? 672 : 17.55 } as DOMRect;
    });
  try {
    expect(measureTerminalGrid(host, surface)).toEqual({ columns: 139, rows: 36 });
  } finally {
    bounds.mockRestore();
    host.remove();
  }
});

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
