import { readFileSync } from "node:fs";
import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import { expect, it, vi } from "vitest";

/** Keeps the last painted screen visible until a resized grid can be painted atomically. */
it.each([
  { alternate: false, synchronization: "none" },
  { alternate: true, synchronization: "none" },
  { alternate: false, synchronization: "release" },
  { alternate: true, synchronization: "release" },
  { alternate: false, synchronization: "timeout" },
  { alternate: true, synchronization: "timeout" },
])(
  "keeps resize content visible: $alternate / $synchronization",
  async ({ alternate, synchronization }) => {
    vi.useFakeTimers();
    const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(wasm, { headers: { "content-type": "application/wasm" } }));
    const element = document.createElement("div");
    document.body.appendChild(element);
    let surface: WTerm | null = null;
    try {
      const core = await GhosttyCore.load({ wasmPath: "/fixture/ghostty-vt.wasm" });
      const onData = vi.fn();
      const terminal = new WTerm(element, { core, cols: 40, rows: 6, autoResize: false, onData });
      surface = terminal;
      await terminal.init();
      terminal.write(`${alternate ? "\u001b[?1049h" : ""}BEFORE_RESIZE`);
      vi.advanceTimersToNextFrame();
      const grid = element.querySelector(".term-grid");
      expect(grid).toHaveTextContent("BEFORE_RESIZE");

      if (synchronization !== "none") terminal.write("\u001b[?2026h");
      // Match TerminalPane, which delivers measurements inside an animation frame.
      requestAnimationFrame(() => {
        terminal.resize(39, 5);
        terminal.resize(42, 7);
      });
      vi.advanceTimersToNextFrame();
      expect(grid).toHaveTextContent("BEFORE_RESIZE");

      terminal.write("\rAFTER_RESIZE!\u001b[6n");
      // Protocol replies remain immediate even while the previous DOM is retained.
      expect(onData).toHaveBeenCalledWith("\u001b[1;14R");
      expect(grid).toHaveTextContent("BEFORE_RESIZE");

      if (synchronization === "release") {
        terminal.write("\u001b[?2026l");
        expect(grid).toHaveTextContent("BEFORE_RESIZE");
      } else if (synchronization === "timeout") {
        vi.advanceTimersToNextFrame();
        expect(grid).toHaveTextContent("BEFORE_RESIZE");
        vi.advanceTimersByTime(1100);
      }
      vi.advanceTimersToNextFrame();
      expect(grid).toHaveTextContent("AFTER_RESIZE!");
      expect(grid?.querySelectorAll(".term-row")).toHaveLength(7);
      expect(core.getCols()).toBe(42);
      expect(core.getRows()).toBe(7);
    } finally {
      surface?.destroy();
      element.remove();
      fetch.mockRestore();
      vi.useRealTimers();
    }
  },
);
