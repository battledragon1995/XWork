import { readTerminalClipboard } from "@/lib/ipc/terminal";
import type { TerminalRegistryEntry } from "./terminal-registry";

/** Reads the current native selection only when it belongs to this terminal surface. */
export function selectedTerminalText(surface: HTMLElement): string {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (selection === undefined || selection === null || selection.isCollapsed) return "";
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (anchor === null || focus === null || !surface.contains(anchor) || !surface.contains(focus)) {
    return "";
  }
  return selection.toString();
}

/** Reads Rust clipboard text once and drops a stale reply after pane activation changes. */
export async function pasteFromClipboard(
  entry: TerminalRegistryEntry,
  terminalId: string,
  read: (terminalId: string) => Promise<string | null> = readTerminalClipboard,
): Promise<boolean> {
  const generation = entry.activationToken();
  const text = await read(terminalId);
  if (text === null || !entry.isActivationCurrent(generation)) return false;
  return entry.paste(text);
}
