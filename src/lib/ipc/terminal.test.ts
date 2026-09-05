import { beforeEach, expect, it, vi } from "vitest";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", async () => {
  /** Test Channel exposes its callback for deterministic delivery. */
  class Channel<T> {
    onmessage: (value: T) => void;

    /** Stores the supplied callback. */
    constructor(onmessage: (value: T) => void) {
      this.onmessage = onmessage;
    }
  }
  return { Channel, invoke };
});
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import {
  decodeTerminalFrame,
  openTerminalLink,
  resizeTerminal,
  startTerminal,
  subscribeTerminalOutput,
  terminalOutputChannel,
  writeTerminal,
} from "./terminal";

/** Encodes one raw BE-007 frame for parser tests. */
function frame(sequence: bigint, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(13 + payload.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1;
  view.setBigUint64(1, sequence, true);
  view.setUint32(9, payload.length, true);
  bytes.set(payload, 13);
  return bytes;
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(null);
  listen.mockReset();
});

/** Verifies raw bytes, little-endian sequence and strict frame length validation. */
it("decodes exact v1 terminal frames", () => {
  const encoded = frame(0x0102030405060708n, [0xf0, 0x9f, 0x99, 0x82]);
  expect(decodeTerminalFrame(encoded)).toEqual({
    sequence: 0x0102030405060708n,
    payload: Uint8Array.from([0xf0, 0x9f, 0x99, 0x82]),
  });
  expect(decodeTerminalFrame(encoded.buffer as ArrayBuffer)).toEqual({
    sequence: 0x0102030405060708n,
    payload: Uint8Array.from([0xf0, 0x9f, 0x99, 0x82]),
  });
  expect(() => decodeTerminalFrame(frame(0n, [1]))).toThrow("Malformed");
  expect(() => decodeTerminalFrame(Uint8Array.from([2, 0]))).toThrow("Malformed");
  expect(() => decodeTerminalFrame(frame(1n, []))).toThrow("Malformed");
});

/** Verifies malformed Channel messages take recovery rather than reaching the core. */
it("routes malformed channel frames to recovery", () => {
  const received = vi.fn();
  const malformed = vi.fn();
  const channel = terminalOutputChannel(received, malformed);
  channel.onmessage(frame(2n, [65]).buffer as ArrayBuffer);
  channel.onmessage(Uint8Array.from([1]));
  expect(received).toHaveBeenCalledWith({ sequence: 2n, payload: Uint8Array.from([65]) });
  expect(malformed).toHaveBeenCalledTimes(1);
});

/** Verifies PTY payload names and decimal bigint serialization stay exact. */
it("sends exact command payloads for launch, subscribe, input and resize", async () => {
  const channel = terminalOutputChannel(vi.fn(), vi.fn());
  await startTerminal("session-1", "tab-2", "pane-3", { columns: 80, rows: 24 }, channel);
  await subscribeTerminalOutput("terminal-4", 9n, channel);
  await writeTerminal("terminal-4", 7n, "🙂");
  await resizeTerminal("terminal-4", 3n, { columns: 100, rows: 30 });
  expect(invoke.mock.calls).toEqual([
    [
      "start_terminal",
      {
        sessionId: "session-1",
        tabId: "tab-2",
        paneId: "pane-3",
        initialSize: { columns: 80, rows: 24 },
        onOutput: channel,
      },
    ],
    [
      "subscribe_terminal_output",
      { terminalId: "terminal-4", afterSequence: "9", onOutput: channel },
    ],
    ["write_terminal", { terminalId: "terminal-4", inputSequence: "7", data: "🙂" }],
    [
      "resize_terminal",
      { terminalId: "terminal-4", resizeSequence: "3", size: { columns: 100, rows: 30 } },
    ],
  ]);
});

/** Verifies link opening uses only the scoped Rust command. */
it("routes link opening through the terminal interaction command", async () => {
  await openTerminalLink("terminal-4", "https://example.com");
  expect(invoke).toHaveBeenCalledWith("open_terminal_link", {
    terminalId: "terminal-4",
    url: "https://example.com",
  });
});
