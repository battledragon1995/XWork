import { expect, it, vi } from "vitest";
import type { TerminalDto } from "@/bindings/terminal/terminal";
import type { TerminalOutputFrame } from "@/lib/ipc/terminal";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import type { WTermAdapter } from "./wterm-adapter";
import {
  splitUtf8,
  TerminalRegistry,
  type TerminalRegistryIpc,
  type TerminalTarget,
} from "./terminal-registry";

/** Creates one running terminal snapshot for registry tests. */
function terminal(id = "terminal-1"): TerminalDto {
  return {
    id,
    sessionId: "session-1",
    tabId: "tab-2",
    paneId: "pane-3",
    profileId: "builtin:terminal",
    title: "Terminal",
    size: { columns: 80, rows: 24 },
    state: "running",
    exitCode: null,
    wasTerminated: false,
    needsAttention: false,
    outputSubscribed: true,
    latestOutputSequence: "0",
  };
}

/** Returns one tool-selection target before backend attachment. */
function target(): TerminalTarget {
  return {
    sessionId: "session-1",
    tabId: "tab-2",
    paneId: "pane-3",
    content: { kind: "toolSelection", profileId: "builtin:terminal", title: "Terminal" },
  };
}

/** Creates a renderer fake whose history survives detach. */
function adapterFixture() {
  const writes: Uint8Array[] = [];
  const adapter = {
    size: { columns: 80, rows: 24 },
    historyCore: null,
    attach: vi.fn(),
    detach: vi.fn(),
    initialize: vi.fn(async () => undefined),
    write: vi.fn((payload: Uint8Array) => writes.push(payload)),
    resize: vi.fn(),
    measureAndResize: vi.fn(),
    focus: vi.fn(),
    clearScreen: vi.fn(() => true),
    readHistoryRows: vi.fn(() => []),
    destroy: vi.fn(),
  } as unknown as WTermAdapter;
  return { adapter, writes };
}

/** Creates deterministic IPC and captures each raw-channel callback. */
function ipcFixture() {
  const channels: Array<{
    frame(frame: TerminalOutputFrame): void;
    malformed(): void;
  }> = [];
  const ipc = {
    startTerminal: vi.fn(async () => terminal()),
    getTerminal: vi.fn(async () => terminal()),
    subscribeTerminalOutput: vi.fn(async () => ({
      terminal: terminal(),
      firstAvailableSequence: "1",
      latestSequence: "0",
    })),
    writeTerminal: vi.fn(async (_id: string, sequence: bigint) => ({
      acceptedSequence: sequence.toString(),
    })),
    resizeTerminal: vi.fn(async (_id: string, sequence: bigint, size: unknown) => ({
      acceptedSequence: sequence.toString(),
      size,
    })),
    acknowledgeTerminalAttention: vi.fn(async () => terminal()),
    terminalOutputChannel: vi.fn((frame, malformed) => {
      channels.push({ frame, malformed });
      return {};
    }),
    onTerminalStateChanged: vi.fn(async () => () => undefined),
  } as unknown as TerminalRegistryIpc;
  return { ipc, channels };
}

/** Flushes promise continuations without relying on wall-clock sleeps. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Verifies repeated mounts share one renderer and one launch gate. */
it("starts one terminal across concurrent and repeated view mounts", async () => {
  const { ipc } = ipcFixture();
  const { adapter } = adapterFixture();
  const registry = new TerminalRegistry(ipc, () => adapter);
  const entry = registry.entry(target());
  const firstHost = document.createElement("div");
  const secondHost = document.createElement("div");

  const releaseFirst = entry.attach(firstHost);
  entry.attach(secondHost);
  await flush();
  releaseFirst();
  entry.attach(firstHost);
  await flush();

  expect(ipc.startTerminal).toHaveBeenCalledTimes(1);
  expect(adapter.destroy).not.toHaveBeenCalled();
  expect(entry.getSnapshot().terminal?.id).toBe("terminal-1");
});

/** Verifies pane activation never prevents the matching mounted host from detaching. */
it("detaches the mounted host after activation changes", async () => {
  const { ipc } = ipcFixture();
  const { adapter } = adapterFixture();
  const entry = new TerminalRegistry(ipc, () => adapter).entry(target());
  const host = document.createElement("div");

  const detach = entry.attach(host);
  await flush();
  entry.activate();
  detach();

  expect(adapter.detach).toHaveBeenCalledWith(host);
});

/** Verifies output received before invoke completion waits for contiguous sequence order. */
it("applies reordered output contiguously even before start resolves", async () => {
  let resolveStart!: (value: TerminalDto) => void;
  const { ipc, channels } = ipcFixture();
  vi.mocked(ipc.startTerminal).mockReturnValue(
    new Promise((resolve) => {
      resolveStart = resolve;
    }),
  );
  const { adapter, writes } = adapterFixture();
  const entry = new TerminalRegistry(ipc, () => adapter).entry(target());
  entry.attach(document.createElement("div"));
  await flush();

  channels[0]?.frame({ sequence: 2n, payload: Uint8Array.from([66]) });
  channels[0]?.frame({ sequence: 1n, payload: Uint8Array.from([65]) });
  expect(writes.map((bytes) => bytes[0])).toEqual([65, 66]);
  expect(entry.getSnapshot().lastApplied).toBe(2n);
  resolveStart(terminal());
  await flush();
  expect(entry.getSnapshot().phase).toBe("ready");
});

/** Verifies a sustained gap reconnects from only the last successfully applied sequence. */
it("recovers a missing output sequence after the bounded gap", async () => {
  vi.useFakeTimers();
  try {
    const { ipc, channels } = ipcFixture();
    const { adapter } = adapterFixture();
    const entry = new TerminalRegistry(ipc, () => adapter).entry(target());
    entry.attach(document.createElement("div"));
    await flush();
    channels[0]?.frame({ sequence: 2n, payload: Uint8Array.from([66]) });

    await vi.advanceTimersByTimeAsync(250);
    expect(ipc.subscribeTerminalOutput).toHaveBeenCalledWith("terminal-1", 0n, expect.anything());
  } finally {
    vi.useRealTimers();
  }
});

/** Verifies UTF-8 chunking never divides a scalar or exceeds the byte limit. */
it("splits large UTF-8 input only at scalar boundaries", () => {
  const chunks = splitUtf8("a🙂b🙂c", 5);
  expect(chunks.join("")).toBe("a🙂b🙂c");
  expect(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 5)).toBe(true);
});

/** Verifies input invokes stay serialized and use consecutive acknowledgement sequences. */
it("serializes input acknowledgements without duplicate chunks", async () => {
  const resolvers: Array<() => void> = [];
  const { ipc } = ipcFixture();
  vi.mocked(ipc.writeTerminal).mockImplementation(
    async (_id: string, sequence: bigint, _data: string) => {
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return { acceptedSequence: sequence.toString() };
    },
  );
  const { adapter } = adapterFixture();
  const entry = new TerminalRegistry(ipc, () => adapter).entry(target());
  entry.attach(document.createElement("div"));
  await flush();
  entry.sendInput("a");
  entry.sendInput("b");
  expect(ipc.writeTerminal).toHaveBeenCalledTimes(1);
  resolvers.shift()?.();
  await flush();
  expect(ipc.writeTerminal).toHaveBeenCalledTimes(2);
  expect(vi.mocked(ipc.writeTerminal).mock.calls.map((call) => [call[1], call[2]])).toEqual([
    [1n, "a"],
    [2n, "b"],
  ]);
  resolvers.shift()?.();
  await flush();
});

/** Verifies a final event triggers recovery until its declared last frame is applied. */
it("drains final output that arrives after the process event", async () => {
  vi.useFakeTimers();
  try {
    const { ipc, channels } = ipcFixture();
    const { adapter, writes } = adapterFixture();
    const entry = new TerminalRegistry(ipc, () => adapter).entry(target());
    entry.attach(document.createElement("div"));
    await flush();
    const exited = { ...terminal(), state: "exited" as const, latestOutputSequence: "2" };
    entry.applyEvent({ change: "processChanged", terminal: exited, finalOutputSequence: "2" });
    expect(entry.getSnapshot().finalSequence).toBe(2n);

    channels[0]?.frame({ sequence: 1n, payload: Uint8Array.from([65]) });
    channels[0]?.frame({ sequence: 2n, payload: Uint8Array.from([66]) });
    expect(writes.map((bytes) => bytes[0])).toEqual([65, 66]);
    expect(entry.getSnapshot().lastApplied).toBe(2n);
  } finally {
    vi.useRealTimers();
  }
});

/** Verifies replay exhaustion becomes explicit and never jumps to the backend tail. */
it("marks replay exhaustion unrecoverable without a tail fallback", async () => {
  const { ipc } = ipcFixture();
  vi.mocked(ipc.subscribeTerminalOutput).mockRejectedValue(
    new IpcCallError("subscribe_terminal_output", {
      code: "outputReplayUnavailable",
      firstAvailableSequence: "8",
      latestSequence: "12",
    }),
  );
  const { adapter } = adapterFixture();
  const entry = new TerminalRegistry(ipc, () => adapter).entry({
    ...target(),
    content: {
      kind: "terminal",
      terminalId: "terminal-1",
      profileId: "builtin:terminal",
      title: "Terminal",
    },
  });
  entry.attach(document.createElement("div"));
  await flush();
  await flush();
  expect(entry.getSnapshot().phase).toBe("unrecoverable");
  expect(ipc.subscribeTerminalOutput).toHaveBeenCalledTimes(1);
});

/** Verifies a failed replacement leaves the original Channel eligible to drain output. */
it("keeps the old subscriber active when replacement attach fails", async () => {
  const { ipc, channels } = ipcFixture();
  const { adapter, writes } = adapterFixture();
  const entry = new TerminalRegistry(ipc, () => adapter).entry(target());
  entry.attach(document.createElement("div"));
  await flush();
  vi.mocked(ipc.subscribeTerminalOutput).mockRejectedValueOnce(new Error("detached"));
  await entry.reconnect();
  channels[0]?.frame({ sequence: 1n, payload: Uint8Array.from([65]) });
  expect(writes.map((bytes) => bytes[0])).toEqual([65]);
});

/** Verifies callbacks from a failed replacement cannot leak into a later generation. */
it("rejects stale output from a failed replacement channel", async () => {
  const { ipc, channels } = ipcFixture();
  const { adapter, writes } = adapterFixture();
  const entry = new TerminalRegistry(ipc, () => adapter).entry(target());
  entry.attach(document.createElement("div"));
  await flush();
  vi.mocked(ipc.subscribeTerminalOutput).mockRejectedValueOnce(new Error("detached"));
  await entry.reconnect();

  channels[1]?.frame({ sequence: 1n, payload: Uint8Array.from([88]) });
  channels[0]?.frame({ sequence: 1n, payload: Uint8Array.from([65]) });

  expect(writes.map((bytes) => bytes[0])).toEqual([65]);
});

/** Verifies authoritative disposal destroys the core and ignores stale callbacks. */
it("tombstones disposed entries and releases retained resources", async () => {
  const { ipc, channels } = ipcFixture();
  const { adapter, writes } = adapterFixture();
  const registry = new TerminalRegistry(ipc, () => adapter);
  const entry = registry.entry(target());
  entry.attach(document.createElement("div"));
  await flush();
  entry.applyEvent({ change: "disposed", terminal: terminal(), finalOutputSequence: null });
  channels[0]?.frame({ sequence: 1n, payload: Uint8Array.from([65]) });
  expect(adapter.destroy).toHaveBeenCalledTimes(1);
  expect(writes).toEqual([]);
  expect(registry.findTerminal("terminal-1")).toBeNull();
});
