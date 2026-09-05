import type { PaneContentDto } from "@/bindings/sessions/sessions";
import type {
  PtySizeDto,
  TerminalDto,
  TerminalStateChangedDto,
} from "@/bindings/terminal/terminal";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as terminalIpc from "@/lib/ipc/terminal";
import type { TerminalOutputFrame } from "@/lib/ipc/terminal";
import { WTermAdapter, type WTermAdapterCallbacks } from "./wterm-adapter";

const OUTPUT_REORDER_LIMIT = 256;
const OUTPUT_REORDER_BYTES = 8 * 1024 * 1024;
const OUTPUT_GAP_MS = 250;
const INPUT_QUEUE_BYTES = 1024 * 1024;
const INPUT_CHUNK_BYTES = 65_536;

/** Stable pane target used before and after the backend assigns a terminal ID. */
export interface TerminalTarget {
  sessionId: string;
  tabId: string;
  paneId: string;
  content: Extract<PaneContentDto, { kind: "toolSelection" | "terminal" }>;
}

/** Observable entry state kept outside React component lifetime. */
export interface TerminalEntryState {
  terminal: TerminalDto | null;
  phase: "preparing" | "starting" | "ready" | "recovering" | "unrecoverable" | "error";
  lastApplied: bigint;
  finalSequence: bigint | null;
  failure: string | null;
  inputBusy: boolean;
}

/** IPC surface injected into registry tests. */
export interface TerminalRegistryIpc {
  startTerminal: typeof terminalIpc.startTerminal;
  getTerminal: typeof terminalIpc.getTerminal;
  subscribeTerminalOutput: typeof terminalIpc.subscribeTerminalOutput;
  writeTerminal: typeof terminalIpc.writeTerminal;
  resizeTerminal: typeof terminalIpc.resizeTerminal;
  acknowledgeTerminalAttention: typeof terminalIpc.acknowledgeTerminalAttention;
  terminalOutputChannel: typeof terminalIpc.terminalOutputChannel;
  onTerminalStateChanged: typeof terminalIpc.onTerminalStateChanged;
}

/** Factory that gives each entry one renderer with registry-owned callbacks. */
export type TerminalAdapterFactory = (callbacks: WTermAdapterCallbacks) => WTermAdapter;

/** One retained renderer, ordered transport and process snapshot. */
export class TerminalRegistryEntry {
  private state: TerminalEntryState = {
    terminal: null,
    phase: "preparing",
    lastApplied: 0n,
    finalSequence: null,
    failure: null,
    inputBusy: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly frames = new Map<bigint, Uint8Array>();
  private bufferedBytes = 0;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private startPromise: Promise<void> | null = null;
  private subscribePromise: Promise<void> | null = null;
  private disposed = false;
  private generation = 0;
  private generationCursor = 0;
  private pendingGeneration: number | null = null;
  private inputSequence = 1n;
  private inputQueue: string[] = [];
  private queuedInputBytes = 0;
  private inputSending = false;
  private inputLocked = false;
  private resizeSequence = 1n;
  private pendingResize: PtySizeDto | null = null;
  private resizeSending = false;
  private activationGeneration = 0;
  readonly adapter: WTermAdapter;

  /** Creates one target-owned entry and its persistent WTerm adapter. */
  constructor(
    readonly key: string,
    private target: TerminalTarget,
    private readonly registry: TerminalRegistry,
  ) {
    this.adapter = registry.createAdapter({
      onData: (data) => this.sendInput(data),
      onResize: (size) => this.queueResize(size),
    });
  }

  /** Returns one immutable state snapshot for React external-store subscriptions. */
  getSnapshot = (): TerminalEntryState => this.state;

  /** Subscribes a React view to entry changes. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Updates the Sessions-owned target while preserving the existing terminal resources. */
  updateTarget(target: TerminalTarget): void {
    this.target = target;
    if (
      target.content.kind === "terminal" &&
      this.state.terminal?.id !== target.content.terminalId
    ) {
      void this.adopt(target.content.terminalId);
    }
  }

  /** Attaches the retained surface and starts or subscribes after successful measurement. */
  attach(host: HTMLElement): () => void {
    this.adapter.attach(host);
    void this.adapter
      .initialize(host)
      .then(() => {
        if (this.disposed) return;
        if (this.target.content.kind === "terminal") {
          return this.adopt(this.target.content.terminalId);
        }
        return this.start();
      })
      .catch(() => this.fail("XWork couldn't initialize the terminal renderer."));
    return () => {
      this.adapter.detach(host);
    };
  }

  /** Marks the view active and clears backend attention only for a visible terminal. */
  activate(): void {
    this.activationGeneration += 1;
    const terminal = this.state.terminal;
    if (terminal?.needsAttention) {
      void this.registry.ipc
        .acknowledgeTerminalAttention(terminal.id)
        .then((snapshot) => this.applyTerminal(snapshot))
        .catch(() => undefined);
    }
  }

  /** Invalidates user actions that were started while this pane was active. */
  deactivate(): void {
    this.activationGeneration += 1;
  }

  /** Returns a generation token used to discard stale asynchronous paste reads. */
  activationToken(): number {
    return this.activationGeneration;
  }

  /** Reports whether an asynchronous pane action still belongs to this entry. */
  isActivationCurrent(token: number): boolean {
    return !this.disposed && token === this.activationGeneration;
  }

  /** Enqueues terminal input without allowing unbounded memory growth. */
  sendInput(data: string): boolean {
    if (
      data.length === 0 ||
      this.inputLocked ||
      this.state.phase !== "ready" ||
      this.state.terminal?.state !== "running"
    ) {
      return false;
    }
    const chunks = splitUtf8(data, INPUT_CHUNK_BYTES);
    const size = chunks.reduce((total, chunk) => total + new TextEncoder().encode(chunk).length, 0);
    if (this.queuedInputBytes + size > INPUT_QUEUE_BYTES) {
      this.patch({ inputBusy: true, failure: "Terminal input is busy." });
      return false;
    }
    this.inputQueue.push(...chunks);
    this.queuedInputBytes += size;
    void this.drainInput();
    return true;
  }

  /** Sends normalized clipboard text with one optional bracketed-paste envelope. */
  paste(text: string): boolean {
    const normalized = text.replace(/\r\n|\n/g, "\r").replaceAll("\u001b", "");
    const payload = this.adapter.historyCore?.bracketedPaste()
      ? `\u001b[200~${normalized}\u001b[201~`
      : normalized;
    return this.sendInput(payload);
  }

  /** Clears the local primary screen without sending a CLI command. */
  clearScreen(): boolean {
    return this.adapter.clearScreen();
  }

  /** Focuses the retained terminal input. */
  focus(): void {
    this.adapter.focus();
  }

  /** Returns the retained viewport to its newest output and focuses terminal input. */
  jumpToLatest(): void {
    this.adapter.jumpToLatest();
  }

  /** Replaces a broken output subscription from the last applied sequence. */
  reconnect(): Promise<void> {
    const terminal = this.state.terminal;
    if (terminal === null || this.disposed) return Promise.resolve();
    if (this.subscribePromise !== null) return this.subscribePromise;
    this.patch({ phase: "recovering", failure: null });
    const candidateGeneration = ++this.generationCursor;
    this.pendingGeneration = candidateGeneration;
    const channel = this.registry.ipc.terminalOutputChannel(
      (frame) => this.receiveFrame(frame, candidateGeneration),
      () => this.receiveMalformed(candidateGeneration),
    );
    const promise = this.registry.ipc
      .subscribeTerminalOutput(terminal.id, this.state.lastApplied, channel)
      .then((subscription) => {
        if (this.disposed) return;
        this.generation = candidateGeneration;
        this.pendingGeneration = null;
        this.applyTerminal(subscription.terminal);
        this.patch({ phase: "ready" });
        if (BigInt(subscription.latestSequence) > this.state.lastApplied) {
          this.scheduleRecovery();
        }
        if (this.inputLocked) void this.recoverInputCursor();
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        if (this.pendingGeneration === candidateGeneration) this.pendingGeneration = null;
        if (error instanceof IpcCallError && error.payload?.code === "outputReplayUnavailable") {
          this.patch({
            phase: "unrecoverable",
            failure: "The complete terminal history is no longer available.",
          });
          return;
        }
        this.patch({ phase: "error", failure: "Terminal output disconnected." });
      })
      .finally(() => {
        if (this.subscribePromise === promise) this.subscribePromise = null;
      });
    this.subscribePromise = promise;
    return promise;
  }

  /** Retries the current safe operation after a known failed launch or stream attach. */
  retry(): Promise<void> {
    if (this.state.terminal === null) return this.start();
    return this.reconnect();
  }

  /** Reconciles one retained process snapshot without reading output content. */
  async reconcile(): Promise<void> {
    const terminal = this.state.terminal;
    if (terminal === null || this.disposed) return;
    try {
      this.applyTerminal(await this.registry.ipc.getTerminal(terminal.id));
    } catch (error) {
      if (error instanceof IpcCallError && error.payload?.code === "terminalNotFound") {
        this.dispose();
      }
    }
  }

  /** Applies one low-frequency event while preserving final-event ordering. */
  applyEvent(event: TerminalStateChangedDto): void {
    if (this.disposed || event.terminal.id !== this.state.terminal?.id) return;
    if (event.change === "disposed") {
      this.dispose();
      return;
    }
    if (event.finalOutputSequence !== null) {
      const finalSequence = BigInt(event.finalOutputSequence);
      this.patch({ finalSequence });
      if (this.state.lastApplied < finalSequence) this.scheduleRecovery();
    }
    this.applyTerminal(event.terminal);
    if (event.change === "streamDetached") void this.reconnect();
    this.finishAfterDrain();
  }

  /** Releases renderer, queues, timers and listeners after authoritative disposal. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation = ++this.generationCursor;
    this.pendingGeneration = null;
    if (this.gapTimer !== null) clearTimeout(this.gapTimer);
    this.gapTimer = null;
    this.frames.clear();
    this.inputQueue = [];
    this.adapter.destroy();
    this.registry.remove(this);
    this.listeners.clear();
  }

  /** Starts exactly one process for one measured tool-selection target. */
  private start(): Promise<void> {
    if (this.startPromise !== null || this.state.terminal !== null || this.disposed) {
      return this.startPromise ?? Promise.resolve();
    }
    const size = this.adapter.size;
    if (size === null) return Promise.resolve();
    this.patch({ phase: "starting", failure: null });
    const candidateGeneration = ++this.generationCursor;
    this.pendingGeneration = candidateGeneration;
    const channel = this.registry.ipc.terminalOutputChannel(
      (frame) => this.receiveFrame(frame, candidateGeneration),
      () => this.receiveMalformed(candidateGeneration),
    );
    const promise = this.registry.ipc
      .startTerminal(this.target.sessionId, this.target.tabId, this.target.paneId, size, channel)
      .then((terminal) => {
        if (this.disposed) return;
        this.generation = candidateGeneration;
        this.pendingGeneration = null;
        this.applyTerminal(terminal);
        this.registry.indexTerminal(this, terminal.id);
        this.patch({ phase: "ready" });
        if (BigInt(terminal.latestOutputSequence) > this.state.lastApplied) {
          this.scheduleRecovery();
        }
        this.registry.onStarted(this.target.sessionId);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        if (this.pendingGeneration === candidateGeneration) this.pendingGeneration = null;
        this.fail(terminalFailureMessage(error));
      })
      .finally(() => {
        if (this.startPromise === promise) this.startPromise = null;
      });
    this.startPromise = promise;
    return promise;
  }

  /** Adopts one Sessions-owned terminal without launching another process. */
  private adopt(terminalId: string): Promise<void> {
    if (this.state.terminal?.id === terminalId && this.state.phase === "ready") {
      return Promise.resolve();
    }
    const indexed = this.registry.findTerminal(terminalId);
    if (indexed !== null && indexed !== this) return Promise.resolve();
    if (this.subscribePromise !== null) return this.subscribePromise;
    const placeholder: TerminalDto = {
      id: terminalId,
      sessionId: this.target.sessionId,
      tabId: this.target.tabId,
      paneId: this.target.paneId,
      profileId: this.target.content.profileId,
      title: this.target.content.title,
      size: this.adapter.size ?? { columns: 80, rows: 24 },
      state: "running",
      exitCode: null,
      wasTerminated: false,
      needsAttention: false,
      outputSubscribed: false,
      latestOutputSequence: "0",
    };
    this.applyTerminal(placeholder);
    this.registry.indexTerminal(this, terminalId);
    return this.reconnect().then(() => this.recoverInputCursor());
  }

  /** Uses an empty write to recover the backend input cursor without sending user bytes. */
  private async recoverInputCursor(): Promise<void> {
    const terminal = this.state.terminal;
    if (terminal === null || terminal.state !== "running") return;
    try {
      const ack = await this.registry.ipc.writeTerminal(terminal.id, 1n, "");
      this.inputSequence = BigInt(ack.acceptedSequence) + 1n;
      this.inputLocked = false;
      this.patch({ inputBusy: false });
      void this.drainInput();
    } catch (error) {
      if (error instanceof IpcCallError && error.payload?.code === "inputOutOfOrder") {
        this.inputSequence = BigInt(error.payload.expectedSequence);
        this.inputLocked = false;
        this.patch({ inputBusy: false });
        void this.drainInput();
      } else {
        this.inputLocked = true;
      }
    }
  }

  /** Receives one output frame and applies only the contiguous sequence prefix. */
  private receiveFrame(frame: TerminalOutputFrame, generation: number): void {
    if (
      this.disposed ||
      (generation !== this.generation && generation !== this.pendingGeneration) ||
      frame.sequence <= this.state.lastApplied
    ) {
      return;
    }
    if (!this.frames.has(frame.sequence)) {
      if (
        this.frames.size >= OUTPUT_REORDER_LIMIT ||
        this.bufferedBytes + frame.payload.byteLength > OUTPUT_REORDER_BYTES
      ) {
        this.scheduleRecovery(true);
        return;
      }
      this.frames.set(frame.sequence, frame.payload);
      this.bufferedBytes += frame.payload.byteLength;
    }
    this.flushFrames();
  }

  /** Recovers malformed output only while its Channel generation is still live. */
  private receiveMalformed(generation: number): void {
    if (
      this.disposed ||
      (generation !== this.generation && generation !== this.pendingGeneration)
    ) {
      return;
    }
    this.scheduleRecovery();
  }

  /** Writes the contiguous frame prefix and arms recovery for any remaining gap. */
  private flushFrames(): void {
    let next = this.state.lastApplied + 1n;
    let payload = this.frames.get(next);
    while (payload !== undefined) {
      try {
        this.adapter.write(payload);
      } catch {
        this.fail("The terminal renderer ran out of memory.");
        return;
      }
      this.frames.delete(next);
      this.bufferedBytes -= payload.byteLength;
      this.patch({ lastApplied: next });
      next += 1n;
      payload = this.frames.get(next);
    }
    if (this.frames.size > 0) this.scheduleRecovery();
    else if (this.gapTimer !== null) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    this.finishAfterDrain();
  }

  /** Schedules replay recovery after the bounded gap window. */
  private scheduleRecovery(immediate = false): void {
    if (this.gapTimer !== null || this.disposed) return;
    this.gapTimer = setTimeout(
      () => {
        this.gapTimer = null;
        void this.reconnect();
      },
      immediate ? 0 : OUTPUT_GAP_MS,
    );
  }

  /** Serializes queued input and never automatically replays an uncertain result. */
  private async drainInput(): Promise<void> {
    if (this.inputSending || this.inputLocked) return;
    const terminal = this.state.terminal;
    if (terminal === null || terminal.state !== "running") return;
    this.inputSending = true;
    while (this.inputQueue.length > 0 && !this.inputLocked) {
      const chunk = this.inputQueue[0];
      if (chunk === undefined) break;
      const bytes = new TextEncoder().encode(chunk).length;
      const sequence = this.inputSequence;
      try {
        const ack = await this.registry.ipc.writeTerminal(terminal.id, sequence, chunk);
        this.inputSequence = BigInt(ack.acceptedSequence) + 1n;
        this.inputQueue.shift();
        this.queuedInputBytes -= bytes;
      } catch (error) {
        if (
          error instanceof IpcCallError &&
          error.payload?.code === "inputOutOfOrder" &&
          BigInt(error.payload.expectedSequence) === sequence + 1n
        ) {
          this.inputSequence = sequence + 1n;
          this.inputQueue.shift();
          this.queuedInputBytes -= bytes;
          continue;
        }
        this.inputLocked = true;
        this.patch({ inputBusy: true, failure: "Terminal input needs to be reconnected." });
      }
    }
    this.inputSending = false;
    if (this.inputQueue.length === 0) this.patch({ inputBusy: false });
  }

  /** Coalesces resize requests so only the latest measured grid waits behind an invoke. */
  private queueResize(size: PtySizeDto): void {
    this.pendingResize = size;
    void this.drainResize();
  }

  /** Serializes resize acknowledgements while preserving last-write-wins semantics. */
  private async drainResize(): Promise<void> {
    if (this.resizeSending) return;
    const terminal = this.state.terminal;
    if (terminal === null || terminal.state !== "running") return;
    this.resizeSending = true;
    while (this.pendingResize !== null) {
      const size = this.pendingResize;
      this.pendingResize = null;
      try {
        const ack = await this.registry.ipc.resizeTerminal(terminal.id, this.resizeSequence, size);
        this.resizeSequence = BigInt(ack.acceptedSequence) + 1n;
        this.applyTerminal({ ...terminal, size: ack.size });
      } catch {
        this.patch({ failure: "XWork couldn't resize this terminal." });
        break;
      }
    }
    this.resizeSending = false;
  }

  /** Applies a snapshot without allowing stale running state to override a final state. */
  private applyTerminal(terminal: TerminalDto): void {
    const current = this.state.terminal;
    const currentFinal = current !== null && matchesFinalState(current.state);
    const next = currentFinal && terminal.state === "running" ? current : terminal;
    this.patch({ terminal: next });
    if (next.state !== "running" && this.state.finalSequence === null) {
      this.patch({ finalSequence: BigInt(next.latestOutputSequence) });
    }
    this.finishAfterDrain();
  }

  /** Marks a stopped terminal readable only after all final output is applied. */
  private finishAfterDrain(): void {
    if (
      this.state.finalSequence !== null &&
      this.state.lastApplied >= this.state.finalSequence &&
      this.state.phase === "recovering"
    ) {
      this.patch({ phase: "ready" });
    }
  }

  /** Publishes one safe renderer or launch failure. */
  private fail(message: string): void {
    this.patch({ phase: "error", failure: message });
  }

  /** Replaces selected fields and notifies mounted views. */
  private patch(patch: Partial<TerminalEntryState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Root process-local registry independent of route and pane DOM lifetime. */
export class TerminalRegistry {
  readonly ipc: TerminalRegistryIpc;
  private readonly entries = new Map<string, TerminalRegistryEntry>();
  private readonly terminals = new Map<string, TerminalRegistryEntry>();
  private unlisten: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private monitorGeneration = 0;

  /** Creates a registry with explicit IPC and renderer seams. */
  constructor(
    ipc: TerminalRegistryIpc = terminalIpc,
    readonly createAdapter: TerminalAdapterFactory = (callbacks) => new WTermAdapter(callbacks),
    private readonly started: (sessionId: string) => void = () => undefined,
  ) {
    this.ipc = ipc;
  }

  /** Starts one shared state listener and periodic lost-event reconciliation. */
  startMonitoring(): void {
    if (this.pollTimer !== null) return;
    const generation = ++this.monitorGeneration;
    void this.ipc
      .onTerminalStateChanged((event) => this.terminals.get(event.terminal.id)?.applyEvent(event))
      .then((unlisten) => {
        if (generation === this.monitorGeneration) this.unlisten = unlisten;
        else unlisten();
      });
    this.pollTimer = setInterval(() => {
      for (const entry of this.entries.values()) void entry.reconcile();
    }, 5000);
  }

  /** Stops provider-owned listeners without disposing retained terminal resources. */
  stopMonitoring(): void {
    this.monitorGeneration += 1;
    this.unlisten?.();
    this.unlisten = null;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Returns one persistent entry per Sessions pane target. */
  entry(target: TerminalTarget): TerminalRegistryEntry {
    const key = terminalTargetKey(target);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.updateTarget(target);
      return existing;
    }
    const created = new TerminalRegistryEntry(key, target, this);
    this.entries.set(key, created);
    return created;
  }

  /** Indexes a started or adopted terminal for state events and reopened tabs. */
  indexTerminal(entry: TerminalRegistryEntry, terminalId: string): void {
    this.terminals.set(terminalId, entry);
  }

  /** Finds an already retained entry by backend terminal identity. */
  findTerminal(terminalId: string): TerminalRegistryEntry | null {
    return this.terminals.get(terminalId) ?? null;
  }

  /** Removes one authoritatively disposed entry from every index. */
  remove(entry: TerminalRegistryEntry): void {
    this.entries.delete(entry.key);
    for (const [terminalId, candidate] of this.terminals) {
      if (candidate === entry) this.terminals.delete(terminalId);
    }
  }

  /** Notifies the Sessions owner that launch committed and its DTO should refresh. */
  onStarted(sessionId: string): void {
    this.started(sessionId);
  }
}

/** Builds one target key without depending on mutable content kind or terminal ID. */
function terminalTargetKey(target: TerminalTarget): string {
  return `${target.sessionId}\u0000${target.tabId}\u0000${target.paneId}`;
}

/** Reports terminal states that snapshots may never regress back to running. */
function matchesFinalState(state: TerminalDto["state"]): boolean {
  return state === "exited" || state === "failed";
}

/** Maps known launch failures to safe user-facing text without exposing rejection details. */
function terminalFailureMessage(error: unknown): string {
  if (error instanceof IpcCallError) {
    if (error.payload?.code === "projectUnavailable") return "This project folder is unavailable.";
    if (error.payload?.code === "profileNotFound") return "This terminal profile no longer exists.";
    if (error.payload?.code === "profileUnavailable")
      return "This terminal profile is unavailable.";
  }
  return "XWork couldn't start this terminal.";
}

/** Splits UTF-8 text at Unicode scalar boundaries without exceeding the backend byte limit. */
export function splitUtf8(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of text) {
    const bytes = new TextEncoder().encode(character).length;
    if (currentBytes + bytes > maxBytes && current !== "") {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}
