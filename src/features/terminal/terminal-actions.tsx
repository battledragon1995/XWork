import {
  ArrowDownToLine,
  Clipboard,
  ClipboardPaste,
  Eraser,
  ExternalLink,
  FileSearch,
  History,
  Link,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { writeTerminalClipboard } from "@/lib/ipc/terminal";
import { pasteFromClipboard, selectedTerminalText } from "./terminal-action-helpers";
import { terminalErrorCopy } from "./terminal-error-copy";
import type { TerminalRegistryEntry } from "./terminal-registry";

/** Renders direct keyboard-reachable actions without exposing browser clipboard APIs. */
export function TerminalActions(props: {
  entry: TerminalRegistryEntry;
  terminalId: string | null;
  running: boolean;
  selectionAvailable: boolean;
  clearAvailable: boolean;
  linkTarget: string | null;
  onFind(): void;
  onBrowseHistory(): void;
  onOpenLink(url: string): void;
  onFailure(message: string | null): void;
}) {
  /** Creates one labelled toolbar action with its disabled explanation. */
  const action = (
    label: string,
    icon: React.ReactNode,
    run: () => void,
    disabled = false,
    title?: string,
  ) => (
    <Button type="button" variant="ghost" size="sm" disabled={disabled} title={title} onClick={run}>
      {icon}
      {label}
    </Button>
  );

  /** Copies only selection contained by the retained WTerm surface. */
  const copy = async (): Promise<void> => {
    if (props.terminalId === null) return;
    const text = selectedTerminalText(props.entry.adapter.element);
    if (text === "") return;
    try {
      await writeTerminalClipboard(props.terminalId, text);
      props.onFailure(null);
    } catch (error) {
      props.onFailure(terminalErrorCopy(error instanceof IpcCallError ? error.payload : null));
    }
  };

  /** Pastes one Rust clipboard snapshot into the still-active running entry. */
  const paste = async (): Promise<void> => {
    if (props.terminalId === null) return;
    try {
      await pasteFromClipboard(props.entry, props.terminalId);
      props.onFailure(null);
    } catch (error) {
      props.onFailure(terminalErrorCopy(error instanceof IpcCallError ? error.payload : null));
    }
  };

  /** Clears only the local primary screen and leaves retained search history intact. */
  const clear = (): void => {
    if (!props.entry.clearScreen()) {
      props.onFailure("Clear Screen is unavailable while an alternate screen is active.");
      return;
    }
    props.onFailure(null);
    props.entry.focus();
  };

  /** Copies the explicitly targeted link through the same Rust clipboard command. */
  const copyLink = async (): Promise<void> => {
    if (props.terminalId === null || props.linkTarget === null) return;
    try {
      await writeTerminalClipboard(props.terminalId, props.linkTarget);
      props.onFailure(null);
    } catch (error) {
      props.onFailure(terminalErrorCopy(error instanceof IpcCallError ? error.payload : null));
    }
  };
  const targetLink = props.linkTarget;

  return (
    <div className="terminal-actions" role="toolbar" aria-label="Terminal actions">
      {action(
        "Copy",
        <Clipboard />,
        () => void copy(),
        props.terminalId === null || !props.selectionAvailable,
      )}
      {action(
        "Paste",
        <ClipboardPaste />,
        () => void paste(),
        props.terminalId === null || !props.running,
      )}
      {action("Find", <FileSearch />, props.onFind)}
      {action("History", <History />, props.onBrowseHistory)}
      {action("Latest", <ArrowDownToLine />, () => props.entry.jumpToLatest())}
      {action(
        "Clear",
        <Eraser />,
        clear,
        props.terminalId === null || !props.clearAvailable,
        props.clearAvailable
          ? undefined
          : "Clear Screen is unavailable while an application controls the screen.",
      )}
      {targetLink !== null && (
        <>
          {action("Open Link", <ExternalLink />, () => props.onOpenLink(targetLink))}
          {action("Copy Link", <Link />, () => void copyLink())}
        </>
      )}
    </div>
  );
}
