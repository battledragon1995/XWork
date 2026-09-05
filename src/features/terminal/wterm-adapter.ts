import type { CellData } from "@wterm/dom";
import { WTerm } from "@wterm/dom";
import { GhosttyCore, type GhosttyOptions } from "@wterm/ghostty";
import ghosttyWasmUrl from "@wterm/ghostty/ghostty-vt.wasm?url";

/** Largest scrollback byte budget accepted by the Ghostty WASM ABI. */
export const RETAINED_SCROLLBACK_BYTES = 0xffffffff;

/** Measured character grid used for initial launch and later PTY resizing. */
export interface TerminalGridSize {
  columns: number;
  rows: number;
}

/** Minimal WTerm surface used by the adapter and its deterministic tests. */
export interface WTermSurface {
  bridge: unknown;
  cols: number;
  rows: number;
  init(): Promise<WTermSurface>;
  write(data: string | Uint8Array): void;
  resize(columns: number, rows: number): void;
  focus(): void;
  destroy(): void;
}

/** Construction seams that keep WASM loading and layout deterministic in unit tests. */
export interface WTermAdapterFactory {
  loadCore(options: GhosttyOptions): Promise<GhosttyCore>;
  createSurface(
    element: HTMLElement,
    options: {
      core: GhosttyCore;
      columns: number;
      rows: number;
      onData(data: string): void;
    },
  ): WTermSurface;
  measure(host: HTMLElement): TerminalGridSize | null;
}

/** Callbacks emitted by one persistent terminal renderer. */
export interface WTermAdapterCallbacks {
  onData(data: string): void;
  onResize(size: TerminalGridSize): void;
}

/** Read-only cell access required by full-history search. */
export interface TerminalHistoryCore {
  getCols(): number;
  getRows(): number;
  getCell(row: number, column: number): CellData;
  getScrollbackCount(): number;
  getScrollbackCell(offset: number, column: number): CellData;
  getScrollbackLineLen(offset: number): number;
  bracketedPaste(): boolean;
  usingAltScreen(): boolean;
}

/** Persistent WTerm/Ghostty owner whose lifetime is independent of any pane mount. */
export class WTermAdapter {
  private readonly root = document.createElement("div");
  private core: GhosttyCore | null = null;
  private surface: WTermSurface | null = null;
  private host: HTMLElement | null = null;
  private initialization: Promise<void> | null = null;
  private readonly archivedRows: string[] = [];
  private archivedScrollbackCount = 0;

  /** Creates a parked terminal surface with explicit transport callbacks. */
  constructor(
    private readonly callbacks: WTermAdapterCallbacks,
    private readonly factory: WTermAdapterFactory = browserWTermFactory,
  ) {
    this.root.className = "xwork-terminal-surface";
    this.root.dataset.terminalInput = "true";
  }

  /** Returns the one DOM surface that moves between pane hosts without recreation. */
  get element(): HTMLElement {
    return this.root;
  }

  /** Returns the initialized history core for search and paste-mode queries. */
  get historyCore(): TerminalHistoryCore | null {
    return this.core;
  }

  /** Returns the renderer's current grid after initialization. */
  get size(): TerminalGridSize | null {
    return this.surface === null ? null : { columns: this.surface.cols, rows: this.surface.rows };
  }

  /** Loads Ghostty and initializes WTerm exactly once at a measured nonzero size. */
  initialize(host: HTMLElement, initialSize?: TerminalGridSize): Promise<void> {
    this.attach(host);
    if (this.initialization !== null) return this.initialization;
    this.initialization = (async () => {
      await document.fonts?.ready;
      const measured = initialSize ?? this.factory.measure(host);
      if (measured === null || measured.columns < 2 || measured.rows < 1) {
        throw new Error("The terminal needs a measurable pane before starting.");
      }
      const core = await this.factory.loadCore({
        wasmPath: ghosttyWasmUrl,
        scrollbackLimit: RETAINED_SCROLLBACK_BYTES,
        foregroundColor: readCssColor("--terminal-foreground", "#faf9f5"),
        backgroundColor: readCssColor("--terminal-background", "#181715"),
      });
      this.core = core;
      const surface = this.factory.createSurface(this.root, {
        core,
        columns: measured.columns,
        rows: measured.rows,
        onData: this.callbacks.onData,
      });
      this.surface = surface;
      await surface.init();
    })().catch((error: unknown) => {
      this.surface?.destroy();
      this.surface = null;
      this.core = null;
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  /** Moves the persistent WTerm element into the currently mounted pane host. */
  attach(host: HTMLElement): void {
    if (this.host === host && this.root.parentElement === host) return;
    this.host = host;
    host.replaceChildren(this.root);
  }

  /** Parks the surface without destroying its renderer, core, history or scroll position. */
  detach(host?: HTMLElement): void {
    if (host !== undefined && this.host !== host) return;
    this.root.remove();
    this.host = null;
  }

  /** Writes raw PTY bytes directly so split UTF-8 and ANSI sequences stay intact. */
  write(data: Uint8Array): void {
    this.surface?.write(data);
  }

  /** Applies a nonzero measured grid and reports it to the ordered resize queue. */
  resize(size: TerminalGridSize): void {
    if (size.columns < 2 || size.rows < 1) return;
    if (this.surface?.cols === size.columns && this.surface.rows === size.rows) return;
    this.surface?.resize(size.columns, size.rows);
    this.callbacks.onResize(size);
  }

  /** Measures and applies the grid of the attached host when it is visible. */
  measureAndResize(): TerminalGridSize | null {
    if (this.host === null) return null;
    const size = this.factory.measure(this.host);
    if (size !== null) this.resize(size);
    return size;
  }

  /** Focuses WTerm's hidden textarea after pane actions close. */
  focus(): void {
    this.surface?.focus();
  }

  /** Clears only the primary screen while archiving every searchable row in RAM. */
  clearScreen(): boolean {
    if (this.surface === null || this.core === null || this.core.usingAltScreen()) return false;
    const snapshot = this.readHistoryRows();
    this.archivedRows.splice(0, this.archivedRows.length, ...snapshot);
    this.archivedScrollbackCount = this.core.getScrollbackCount();
    this.surface.write("\u001b[2J\u001b[H");
    return true;
  }

  /** Returns all archived and current core rows for find and Browse History. */
  readHistoryRows(): string[] {
    if (this.core === null) return [...this.archivedRows];
    return [...this.archivedRows, ...readCoreRows(this.core, this.archivedScrollbackCount)];
  }

  /** Scrolls the retained DOM viewport to its newest rendered row and restores input focus. */
  jumpToLatest(): void {
    this.root.scrollTop = this.root.scrollHeight;
    this.focus();
  }

  /** Releases listeners and all reachable core memory at authoritative disposal. */
  destroy(): void {
    this.surface?.destroy();
    this.root.remove();
    this.surface = null;
    this.core = null;
    this.host = null;
    this.initialization = null;
    this.archivedRows.length = 0;
    this.archivedScrollbackCount = 0;
  }
}

/** Reads one CSS color token while preserving a safe startup fallback. */
function readCssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/** Converts one core cell into its complete grapheme without continuation cells. */
function cellText(cell: CellData): string {
  if (cell.width === 0) return "";
  if (cell.chars !== undefined) return cell.chars;
  return String.fromCodePoint(cell.char || 32);
}

/** Reads all retained scrollback and viewport rows directly from Ghostty memory. */
export function readCoreRows(core: TerminalHistoryCore, scrollbackStart = 0): string[] {
  const rows: string[] = [];
  const columns = core.getCols();
  for (
    let offset = Math.min(scrollbackStart, core.getScrollbackCount());
    offset < core.getScrollbackCount();
    offset += 1
  ) {
    const length = Math.min(columns, core.getScrollbackLineLen(offset));
    let text = "";
    for (let column = 0; column < length; column += 1) {
      text += cellText(core.getScrollbackCell(offset, column));
    }
    rows.push(text.trimEnd());
  }
  for (let row = 0; row < core.getRows(); row += 1) {
    let text = "";
    for (let column = 0; column < columns; column += 1) {
      text += cellText(core.getCell(row, column));
    }
    rows.push(text.trimEnd());
  }
  return rows;
}

/** Measures the current pane using the same font and zoomed CSS pixel space as WTerm. */
function measureTerminalGrid(host: HTMLElement): TerminalGridSize | null {
  const bounds = host.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const probe = document.createElement("span");
  probe.className = "xwork-terminal-measure";
  probe.textContent = "W";
  host.appendChild(probe);
  const cell = probe.getBoundingClientRect();
  probe.remove();
  if (cell.width <= 0 || cell.height <= 0) return null;
  return {
    columns: Math.max(2, Math.min(500, Math.floor(bounds.width / cell.width))),
    rows: Math.max(1, Math.min(300, Math.floor(bounds.height / cell.height))),
  };
}

/** Production factory pinned to WTerm/Ghostty 0.3.4 and its local WASM asset. */
const browserWTermFactory: WTermAdapterFactory = {
  /** Loads one explicit Ghostty core. */
  loadCore: (options) => GhosttyCore.load(options),
  /** Creates WTerm with `onData` present before `init`, preventing local echo. */
  createSurface: (element, options) =>
    new WTerm(element, {
      core: options.core,
      cols: options.columns,
      rows: options.rows,
      autoResize: false,
      cursorBlink: true,
      onData: options.onData,
    }),
  /** Measures a visible terminal host. */
  measure: measureTerminalGrid,
};
