import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { WTermAdapter } from "./wterm-adapter";

/** Reproduces a CLI clear and redraw arriving in separate PTY reads after a resize. */
it("holds split resize redraws without delaying protocol replies or starving output", async () => {
  vi.useFakeTimers();
  const wasm = readFileSync("node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(wasm, { headers: { "content-type": "application/wasm" } }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const onData = vi.fn();
  const adapter = new WTermAdapter({ onData, onResize: vi.fn() });
  /** Delivers synthetic CLI chunks through the real application adapter. */
  const write = (text: string): void => adapter.write(new TextEncoder().encode(text));
  try {
    await adapter.initialize(host, { columns: 40, rows: 6 });
    write("OLD_COMPLETE_SCREEN");
    vi.advanceTimersByTime(100);
    const grid = host.querySelector(".term-grid");
    adapter.resize({ columns: 42, rows: 7 });
    write("\u001b[2J\u001b[H\u001b[6n");
    expect(onData).toHaveBeenCalledWith("\u001b[1;1R");
    // Native viewport changes can dispatch scroll while the resize redraw is still incomplete.
    adapter.element.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(32);
    expect(grid).toHaveTextContent("OLD_COMPLETE_SCREEN");
    write("NEW_HEADER\r\n");
    vi.advanceTimersByTime(32);
    expect(grid).toHaveTextContent("OLD_COMPLETE_SCREEN");
    write("NEW_PROMPT");
    vi.advanceTimersByTime(100);
    expect(grid).toHaveTextContent("NEW_HEADER");
    expect(grid).toHaveTextContent("NEW_PROMPT");
    expect(grid).not.toHaveTextContent("OLD_COMPLETE_SCREEN");

    // A chatty process must still paint within the bounded resize settling window.
    adapter.resize({ columns: 44, rows: 7 });
    for (let index = 0; index < 20; index += 1) {
      write("\u001b[HCONTINUOUS_OUTPUT");
      vi.advanceTimersByTime(20);
    }
    expect(grid).toHaveTextContent("CONTINUOUS_OUTPUT");
    adapter.resize({ columns: 45, rows: 7 });
    adapter.destroy();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    adapter.destroy();
    host.remove();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

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
    let surface: WTermAdapter | null = null;
    try {
      const onData = vi.fn();
      const terminal = new WTermAdapter({ onData, onResize: vi.fn() });
      surface = terminal;
      await terminal.initialize(element, { columns: 40, rows: 6 });
      const core = terminal.historyCore;
      /** Sends CLI output through the production adapter, including its renderer scheduling. */
      const write = (text: string): void => terminal.write(new TextEncoder().encode(text));
      write(`${alternate ? "\u001b[?1049h" : ""}BEFORE_RESIZE`);
      vi.advanceTimersToNextFrame();
      const grid = element.querySelector(".term-grid");
      expect(grid).toHaveTextContent("BEFORE_RESIZE");

      if (synchronization !== "none") write("\u001b[?2026h");
      // Match TerminalPane, which delivers measurements inside an animation frame.
      requestAnimationFrame(() => {
        terminal.resize({ columns: 39, rows: 5 });
        terminal.resize({ columns: 42, rows: 7 });
      });
      vi.advanceTimersToNextFrame();
      expect(grid).toHaveTextContent("BEFORE_RESIZE");

      if (synchronization === "none") {
        // An idle shell must repaint at the new size without waiting for PTY output.
        vi.advanceTimersByTime(100);
        expect(grid).toHaveTextContent("BEFORE_RESIZE");
        expect(grid?.querySelectorAll(".term-row")).toHaveLength(7);
      }
      write("\rAFTER_RESIZE!\u001b[6n");
      // Protocol replies remain immediate even while the previous DOM is retained.
      expect(onData).toHaveBeenCalledWith("\u001b[1;14R");
      expect(grid).toHaveTextContent("BEFORE_RESIZE");

      if (synchronization === "release") {
        write("\u001b[?2026l");
        expect(grid).toHaveTextContent("BEFORE_RESIZE");
      } else if (synchronization === "timeout") {
        vi.advanceTimersToNextFrame();
        expect(grid).toHaveTextContent("BEFORE_RESIZE");
        vi.advanceTimersByTime(1100);
      }
      vi.advanceTimersByTime(100);
      expect(grid).toHaveTextContent("AFTER_RESIZE!");
      expect(grid?.querySelectorAll(".term-row")).toHaveLength(7);
      expect(core?.getCols()).toBe(42);
      expect(core?.getRows()).toBe(7);
    } finally {
      surface?.destroy();
      element.remove();
      fetch.mockRestore();
      vi.useRealTimers();
    }
  },
);
