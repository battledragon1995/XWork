import { Channel } from "@tauri-apps/api/core";
import { type Event, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  PtySizeDto,
  TerminalDto,
  TerminalError,
  TerminalInputAckDto,
  TerminalInteractionError,
  TerminalResizeAckDto,
  TerminalStateChangedDto,
  TerminalSubscriptionDto,
} from "@/bindings/terminal/terminal";
import { invokeCommand } from "./ipc-error";

/** Low-frequency state event emitted by BE-007. */
export const TERMINAL_STATE_CHANGED_EVENT = "terminal://state-changed";

/** Decoded raw terminal frame with its exact sequence and unmodified payload bytes. */
export interface TerminalOutputFrame {
  sequence: bigint;
  payload: Uint8Array;
}

/** Raw byte containers produced by Tauri's direct and fetched Channel paths. */
type TerminalFrameBytes = ArrayBuffer | Uint8Array | number[];

/** Calls one PTY command through the normalized error boundary. */
function invokeTerminal<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invokeCommand<TResult, TerminalError>(command, args);
}

/** Calls one scoped clipboard or link command through its separate error contract. */
function invokeInteraction<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invokeCommand<TResult, TerminalInteractionError>(command, args);
}

/** Decodes one v1 little-endian raw output frame and rejects malformed boundaries. */
export function decodeTerminalFrame(raw: TerminalFrameBytes): TerminalOutputFrame {
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : Uint8Array.from(raw);
  if (bytes.byteLength < 13 || bytes[0] !== 1) {
    throw new Error("Malformed terminal output frame.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sequence = view.getBigUint64(1, true);
  const length = view.getUint32(9, true);
  if (sequence === 0n || length < 1 || length > 32768 || bytes.byteLength !== 13 + length) {
    throw new Error("Malformed terminal output frame.");
  }
  return { sequence, payload: bytes.slice(13) };
}

/** Creates a raw Channel whose callback validates and decodes every output frame. */
export function terminalOutputChannel(
  onFrame: (frame: TerminalOutputFrame) => void,
  onMalformed: () => void,
): Channel<TerminalFrameBytes> {
  return new Channel((raw) => {
    try {
      onFrame(decodeTerminalFrame(raw));
    } catch {
      onMalformed();
    }
  });
}

/** Starts one measured terminal and immediately attaches its output Channel. */
export function startTerminal(
  sessionId: string,
  tabId: string,
  paneId: string,
  initialSize: PtySizeDto,
  onOutput: Channel<TerminalFrameBytes>,
): Promise<TerminalDto> {
  return invokeTerminal("start_terminal", { sessionId, tabId, paneId, initialSize, onOutput });
}

/** Reads one authoritative terminal snapshot. */
export function getTerminal(terminalId: string): Promise<TerminalDto> {
  return invokeTerminal("get_terminal", { terminalId });
}

/** Replaces a terminal output subscriber and requests replay after one sequence. */
export function subscribeTerminalOutput(
  terminalId: string,
  afterSequence: bigint,
  onOutput: Channel<TerminalFrameBytes>,
): Promise<TerminalSubscriptionDto> {
  return invokeTerminal("subscribe_terminal_output", {
    terminalId,
    afterSequence: afterSequence.toString(),
    onOutput,
  });
}

/** Sends one ordered terminal input chunk. */
export function writeTerminal(
  terminalId: string,
  inputSequence: bigint,
  data: string,
): Promise<TerminalInputAckDto> {
  return invokeTerminal("write_terminal", {
    terminalId,
    inputSequence: inputSequence.toString(),
    data,
  });
}

/** Sends one coalesced terminal resize. */
export function resizeTerminal(
  terminalId: string,
  resizeSequence: bigint,
  size: PtySizeDto,
): Promise<TerminalResizeAckDto> {
  return invokeTerminal("resize_terminal", {
    terminalId,
    resizeSequence: resizeSequence.toString(),
    size,
  });
}

/** Clears one attention marker after the terminal becomes actively visible. */
export function acknowledgeTerminalAttention(terminalId: string): Promise<TerminalDto> {
  return invokeTerminal("acknowledge_terminal_attention", { terminalId });
}

/** Reads plain text for an explicit paste into a running terminal. */
export function readTerminalClipboard(terminalId: string): Promise<string | null> {
  return invokeInteraction("read_terminal_clipboard", { terminalId });
}

/** Copies selected terminal text through the Rust-owned clipboard. */
export function writeTerminalClipboard(terminalId: string, text: string): Promise<void> {
  return invokeInteraction("write_terminal_clipboard", { terminalId, text });
}

/** Opens an explicit HTTP or HTTPS target through the Rust-owned opener. */
export function openTerminalLink(terminalId: string, url: string): Promise<void> {
  return invokeInteraction("open_terminal_link", { terminalId, url });
}

/** Subscribes to safe process, attention, stream and disposal state changes. */
export function onTerminalStateChanged(
  handler: (event: TerminalStateChangedDto) => void,
): Promise<UnlistenFn> {
  return listen<TerminalStateChangedDto>(
    TERMINAL_STATE_CHANGED_EVENT,
    (event: Event<TerminalStateChangedDto>) => handler(event.payload),
  );
}
