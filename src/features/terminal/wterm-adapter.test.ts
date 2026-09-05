import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GhosttyCore } from "@wterm/ghostty";
import type { TerminalHistoryCore, WTermAdapterFactory, WTermSurface } from "./wterm-adapter";
import { RETAINED_SCROLLBACK_BYTES, WTermAdapter, readCoreRows } from "./wterm-adapter";

/** Builds one plain printable cell for fake core rows. */
function cell(character: string, width = 1) {
  return { char: character.codePointAt(0) ?? 32, fg: 0, bg: 0, flags: 0, width };
}

/** Implements the history and mode surface needed by the adapter. */
class FakeCore implements TerminalHistoryCore {
  readonly viewport = ["first", "second"];
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
    return 1;
  }

  /** Returns one retained cell. */
  getScrollbackCell(_offset: number, column: number) {
    return cell("history"[column] ?? " ");
  }

  /** Returns the retained line length. */
  getScrollbackLineLen(): number {
    return 7;
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
    if (data === "\u001b[2J\u001b[H") core.viewport.fill("");
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
  expect(value.write).toHaveBeenCalledWith("\u001b[2J\u001b[H");
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
