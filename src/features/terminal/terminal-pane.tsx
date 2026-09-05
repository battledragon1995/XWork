import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PaneContentDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { openTerminalLink, writeTerminalClipboard } from "@/lib/ipc/terminal";
import { TerminalActions } from "./terminal-actions";
import { terminalErrorCopy } from "./terminal-error-copy";
import { TerminalFindBar } from "./terminal-find-bar";
import {
  findPlainWebLinks,
  findTerminalMatches,
  type TerminalSearchMatch,
} from "./terminal-search";
import { useTerminalRegistry } from "./terminal-provider";
import "./terminal.css";

/** Public terminal render-slot contract consumed only by the app composition layer. */
export interface TerminalPaneProps {
  sessionId: string;
  tabId: string;
  paneId: string;
  content: Extract<PaneContentDto, { kind: "toolSelection" | "terminal" }>;
  isActive: boolean;
  isVisible: boolean;
  onActivate(): void;
  onRefreshSession(): void;
  onOpenProject(): void;
  onOpenTerminalSettings(profileId?: string): void;
  onCheckProfile(profileId: string): void;
}

/** Attaches one retained terminal surface to the current Sessions pane. */
export function TerminalPane(props: TerminalPaneProps) {
  const registry = useTerminalRegistry();
  const entry = registry.entry({
    sessionId: props.sessionId,
    tabId: props.tabId,
    paneId: props.paneId,
    content: props.content,
  });
  const state = useSyncExternalStore(entry.subscribe, entry.getSnapshot, entry.getSnapshot);
  const host = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<TerminalSearchMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<string[]>([]);
  const [selectionAvailable, setSelectionAvailable] = useState(false);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const refreshedTerminal = useRef<string | null>(null);
  const historySurface = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null || !props.isVisible) return;
    const detach = entry.attach(element);
    const observer = new ResizeObserver(() => entry.adapter.measureAndResize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      detach();
    };
  }, [entry, props.isVisible]);

  useEffect(() => {
    if (!(props.isActive && props.isVisible)) {
      entry.deactivate();
      return;
    }
    /** Acknowledges attention only while the native webview document owns focus. */
    const activateFocusedPane = (): void => {
      if (document.hasFocus()) entry.activate();
    };
    activateFocusedPane();
    window.addEventListener("focus", activateFocusedPane);
    return () => {
      window.removeEventListener("focus", activateFocusedPane);
      entry.deactivate();
    };
  }, [entry, props.isActive, props.isVisible]);

  useEffect(() => {
    /** Tracks whether Copy has a selection fully contained by this terminal surface. */
    const updateSelection = (): void => {
      const selection = window.getSelection();
      if (selection === null) {
        setSelectionAvailable(false);
        return;
      }
      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      setSelectionAvailable(
        !selection.isCollapsed &&
          anchor !== null &&
          focus !== null &&
          entry.adapter.element.contains(anchor) &&
          entry.adapter.element.contains(focus),
      );
    };
    document.addEventListener("selectionchange", updateSelection);
    return () => document.removeEventListener("selectionchange", updateSelection);
  }, [entry]);

  useEffect(() => {
    if (historyOpen) historySurface.current?.focus();
  }, [historyOpen]);

  useEffect(() => {
    if (
      props.content.kind === "toolSelection" &&
      state.terminal !== null &&
      refreshedTerminal.current !== state.terminal.id
    ) {
      refreshedTerminal.current = state.terminal.id;
      props.onRefreshSession();
    }
  }, [props, state.terminal]);

  useEffect(() => {
    if (!findOpen) return;
    void state.lastApplied;
    let current = true;
    setSearching(true);
    void findTerminalMatches(entry.adapter.readHistoryRows(), query, () => current).then((next) => {
      if (!current) return;
      setMatches(next);
      setActiveMatch(next.length === 0 ? null : 0);
      setSearching(false);
    });
    return () => {
      current = false;
    };
  }, [entry, findOpen, query, state.lastApplied]);

  /** Moves to one wrapped retained-history match and scrolls the WTerm viewport near it. */
  const moveMatch = (direction: "next" | "previous"): void => {
    if (matches.length === 0) return;
    const current = activeMatch ?? 0;
    const next =
      direction === "next"
        ? (current + 1) % matches.length
        : (current - 1 + matches.length) % matches.length;
    setActiveMatch(next);
    const rowHeight = Number.parseFloat(
      getComputedStyle(entry.adapter.element).getPropertyValue("--term-row-height"),
    );
    entry.adapter.element.scrollTop = matches[next]?.row * (rowHeight || 17);
  };

  /** Opens an activated DOM hyperlink through the scoped Rust command. */
  const openLink = async (url: string): Promise<void> => {
    if (state.terminal === null) return;
    try {
      await openTerminalLink(state.terminal.id, url);
      setActionFailure(null);
    } catch (error) {
      setActionFailure(terminalErrorCopy(error instanceof IpcCallError ? error.payload : null));
    }
  };

  /** Handles terminal-only shortcuts while leaving CLI control keys and IME untouched. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && historyOpen) {
      event.preventDefault();
      setHistoryOpen(false);
      setHistoryRows([]);
      queueMicrotask(() => entry.focus());
      return;
    }
    if (event.key === "Escape" && !findOpen) {
      event.currentTarget.closest<HTMLElement>("[data-pane-id]")?.focus();
      return;
    }
    if (event.ctrlKey && event.altKey && event.key === "F6") {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLButtonElement>(".terminal-actions button")?.focus();
      return;
    }
    if (!(event.ctrlKey && event.shiftKey)) return;
    const key = event.key.toLocaleLowerCase();
    if (key === "f") {
      event.preventDefault();
      setFindOpen(true);
    } else if (key === "v" && state.terminal?.state === "running") {
      event.preventDefault();
      event.currentTarget
        .querySelector<HTMLButtonElement>(".terminal-actions button:nth-child(2)")
        ?.click();
    } else if (key === "c") {
      event.preventDefault();
      event.currentTarget
        .querySelector<HTMLButtonElement>(".terminal-actions button:first-child")
        ?.click();
    }
  };

  const running = state.terminal?.state === "running";
  const clearAvailable = entry.adapter.historyCore?.usingAltScreen() !== true;

  /** Opens one immutable, temporary history snapshot for accessible review. */
  const openHistory = (): void => {
    setHistoryRows(entry.adapter.readHistoryRows());
    setHistoryOpen(true);
  };
  const historyText = historyRows.join("\n");

  /** Routes keyboard copying from the accessible history snapshot through Rust. */
  const copyHistorySelection = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    event.preventDefault();
    const terminalId = state.terminal?.id;
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (terminalId === undefined || selectionStart === selectionEnd) return;
    void writeTerminalClipboard(terminalId, historyText.slice(selectionStart, selectionEnd))
      .then(() => setActionFailure(null))
      .catch((error: unknown) =>
        setActionFailure(terminalErrorCopy(error instanceof IpcCallError ? error.payload : null)),
      );
  };

  return (
    <section
      data-terminal-root="true"
      data-terminal-id={state.terminal?.id}
      aria-label="Terminal"
      className="terminal-pane"
      onKeyDown={handleKeyDown}
      onPointerDown={props.onActivate}
      onClick={(event) => {
        const anchor = (event.target as Element).closest<HTMLAnchorElement>("a.term-link");
        if (anchor === null) return;
        event.preventDefault();
        setLinkTarget(anchor.href);
        if (event.ctrlKey) void openLink(anchor.href);
      }}
      onContextMenu={(event) => {
        const anchor = (event.target as Element).closest<HTMLAnchorElement>("a.term-link");
        const selectedLink = findPlainWebLinks(window.getSelection()?.toString() ?? "")[0];
        const target = anchor?.href ?? selectedLink;
        if (target === undefined) return;
        event.preventDefault();
        setLinkTarget(target);
      }}
      onDoubleClick={() => {
        queueMicrotask(() => {
          const selection = window.getSelection()?.toString() ?? "";
          const [url] = findPlainWebLinks(selection);
          if (url !== undefined) void openLink(url);
        });
      }}
      onPaste={(event) => {
        // Native WebView clipboard payloads never reach WTerm; Paste always reads through Rust.
        event.preventDefault();
      }}
    >
      <TerminalActions
        entry={entry}
        terminalId={state.terminal?.id ?? null}
        running={running}
        selectionAvailable={selectionAvailable}
        clearAvailable={clearAvailable}
        linkTarget={linkTarget}
        onFind={() => setFindOpen(true)}
        onBrowseHistory={openHistory}
        onOpenLink={(url) => void openLink(url)}
        onFailure={setActionFailure}
      />
      {findOpen && (
        <TerminalFindBar
          query={query}
          searching={searching}
          matchCount={matches.length}
          activeMatch={activeMatch}
          onQuery={setQuery}
          onMove={moveMatch}
          onClose={() => {
            setFindOpen(false);
            entry.focus();
          }}
        />
      )}
      <section
        ref={host}
        className="terminal-host"
        aria-label={state.terminal?.title ?? "Terminal output"}
      />

      {(state.phase === "preparing" || state.phase === "starting") && (
        <div role="status" aria-busy="true" className="terminal-overlay">
          {state.phase === "preparing" ? "Preparing terminal…" : "Starting terminal…"}
        </div>
      )}
      {state.phase === "recovering" && (
        <div role="status" aria-busy="true" className="terminal-recovery-status">
          Reconnecting output…
        </div>
      )}
      {(state.phase === "error" || state.phase === "unrecoverable") && (
        <div role="alert" className="terminal-overlay terminal-overlay-error">
          <p>{state.failure}</p>
          {state.phase === "error" && (
            <Button type="button" variant="outline" size="sm" onClick={() => void entry.retry()}>
              Try again
            </Button>
          )}
          {state.failure?.includes("project") && (
            <Button type="button" variant="outline" size="sm" onClick={props.onOpenProject}>
              Open Project
            </Button>
          )}
          {state.failure?.includes("profile") && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => props.onCheckProfile(props.content.profileId)}
              >
                Check again
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => props.onOpenTerminalSettings(props.content.profileId)}
              >
                Terminal Settings
              </Button>
            </>
          )}
        </div>
      )}
      {actionFailure !== null && (
        <div role="alert" className="terminal-action-error">
          {actionFailure}
        </div>
      )}
      {state.terminal !== null &&
        state.terminal.state !== "running" &&
        (state.finalSequence === null || state.lastApplied >= state.finalSequence) && (
          <div className="terminal-exit-status" role="status">
            {state.terminal.state === "exited"
              ? `Process exited${state.terminal.exitCode === null ? "" : ` (${state.terminal.exitCode})`}`
              : "Process stopped with an error"}
          </div>
        )}
      {historyOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Terminal history"
          className="terminal-history"
        >
          <div className="terminal-history-header">
            <strong>Terminal history</strong>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setHistoryOpen(false);
                setHistoryRows([]);
                queueMicrotask(() => entry.focus());
              }}
            >
              Close
            </Button>
          </div>
          <textarea
            ref={historySurface}
            aria-label="Terminal history content"
            className="terminal-history-content"
            readOnly
            value={historyText}
            onCopy={copyHistorySelection}
          />
        </div>
      )}
    </section>
  );
}
