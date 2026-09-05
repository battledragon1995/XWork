import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputHandler } from "@wterm/dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { TerminalDto } from "@/bindings/terminal/terminal";

const fixture = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const adapter = {
    element: document.createElement("div"),
    historyCore: null,
    attach: vi.fn(),
    initialize: vi.fn(async () => undefined),
    detach: vi.fn(),
    measureAndResize: vi.fn(),
    readHistoryRows: vi.fn(() => ["first retained row", "latest row"]),
    focus: vi.fn(),
    clearScreen: vi.fn(() => true),
  };
  const preparing = {
    terminal: null,
    phase: "preparing" as const,
    lastApplied: 0n,
    finalSequence: null,
    failure: null,
    inputBusy: false,
  };
  let snapshot: Record<string, unknown> = preparing;
  const entry = {
    adapter,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    attach: vi.fn(
      (_host: HTMLElement): (() => void) =>
        () =>
          undefined,
    ),
    activate: vi.fn(),
    deactivate: vi.fn(),
    retry: vi.fn(async () => undefined),
    activationToken: vi.fn(() => 1),
    isActivationCurrent: vi.fn(() => true),
    paste: vi.fn(() => true),
    clearScreen: vi.fn(() => true),
    focus: vi.fn(),
    jumpToLatest: vi.fn(),
    findQuery: "",
  };
  return {
    entry,
    adapter,
    reset: () => {
      snapshot = preparing;
      listeners.clear();
      entry.findQuery = "";
    },
    publish: (next: Record<string, unknown>) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("./terminal-context", () => ({
  useTerminalRegistry: () => ({ entry: () => fixture.entry }),
}));

vi.mock("@/lib/ipc/terminal", () => ({
  readTerminalClipboard: vi.fn(async () => "RUST_CLIPBOARD"),
  writeTerminalClipboard: vi.fn(async () => undefined),
  openTerminalLink: vi.fn(async () => undefined),
}));

import { openTerminalLink, readTerminalClipboard } from "@/lib/ipc/terminal";
import { TerminalPane } from "./terminal-pane";

/** Creates one process snapshot for a ready or exited renderer state. */
function terminal(state: TerminalDto["state"]): TerminalDto {
  return {
    id: "terminal-1",
    sessionId: "session-1",
    tabId: "tab-2",
    paneId: "pane-3",
    profileId: "builtin:terminal",
    title: "Terminal",
    size: { columns: 80, rows: 24 },
    state,
    exitCode: state === "exited" ? "0" : null,
    wasTerminated: false,
    needsAttention: false,
    outputSubscribed: true,
    latestOutputSequence: "1",
  };
}

/** Renders the standard tool-selection pane with owner callbacks. */
function renderPane(onRefreshSession = vi.fn()) {
  return render(
    <TerminalPane
      sessionId="session-1"
      tabId="tab-2"
      paneId="pane-3"
      content={{ kind: "toolSelection", profileId: "builtin:terminal", title: "Terminal" }}
      isActive
      isVisible
      onActivate={vi.fn()}
      onRefreshSession={onRefreshSession}
      onOpenProject={vi.fn()}
      onOpenTerminalSettings={vi.fn()}
      onCheckProfile={vi.fn()}
    />,
  );
}

/** Publishes a ready terminal snapshot with an explicit process state and output boundary. */
async function publishReady(state: TerminalDto["state"] = "running", latestSequence = "0") {
  await act(async () => {
    fixture.publish({
      terminal: { ...terminal(state), latestOutputSequence: latestSequence },
      phase: "ready",
      lastApplied: BigInt(latestSequence),
      finalSequence: null,
      failure: null,
      inputBusy: false,
    });
  });
}

beforeEach(() => {
  fixture.reset();
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Verifies the measured surface attaches while the initial core is preparing. */
it("attaches one retained surface and exposes a truthful loading state", () => {
  renderPane();
  expect(screen.getByRole("status")).toHaveTextContent("Preparing terminal");
  expect(fixture.entry.attach).toHaveBeenCalledTimes(1);
  expect(fixture.entry.activate).toHaveBeenCalledTimes(1);
});

/** Verifies resize delivery is coalesced outside the observer callback to avoid layout loops. */
it("defers terminal measurement until the next animation frame", () => {
  const resizeCallbacks: ResizeObserverCallback[] = [];
  const scheduledResizes: FrameRequestCallback[] = [];
  class CapturingResizeObserver {
    /** Captures the component callback for explicit observer delivery. */
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
    }

    /** Accepts the terminal host observation. */
    observe(): void {}

    /** Accepts an unused individual unobserve request. */
    unobserve(): void {}

    /** Accepts component teardown. */
    disconnect(): void {}
  }
  vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
  const requestFrame = vi
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation((callback) => {
      scheduledResizes.push(callback);
      return 7;
    });
  const cancelFrame = vi.spyOn(globalThis, "cancelAnimationFrame");
  renderPane();

  expect(resizeCallbacks).toHaveLength(1);
  resizeCallbacks[0]?.([], {} as ResizeObserver);
  resizeCallbacks[0]?.([], {} as ResizeObserver);
  expect(fixture.adapter.measureAndResize).not.toHaveBeenCalled();
  expect(requestFrame).toHaveBeenCalledTimes(2);
  expect(cancelFrame).toHaveBeenCalledWith(7);

  scheduledResizes.at(-1)?.(0);
  expect(fixture.adapter.measureAndResize).toHaveBeenCalledTimes(1);
});

/** Verifies a committed launch refreshes Sessions once and stopped output remains readable. */
it("refreshes owner content after launch and keeps an exited terminal readable", async () => {
  const refresh = vi.fn();
  renderPane(refresh);
  await act(async () => {
    fixture.publish({
      terminal: terminal("exited"),
      phase: "ready",
      lastApplied: 1n,
      finalSequence: 1n,
      failure: null,
      inputBusy: false,
    });
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Process exited (0)")).toBeInTheDocument();
  expect(screen.getAllByLabelText("Terminal").length).toBeGreaterThan(0);
});

/** Verifies Browse History owns focus, keeps a fixed snapshot and returns focus on Escape. */
it("opens and closes an accessible retained-history snapshot", async () => {
  const user = userEvent.setup();
  renderPane();

  await user.click(screen.getByRole("button", { name: "History" }));
  const history = screen.getByRole("textbox", { name: "Terminal history content" });
  expect(history).toHaveValue("first retained row\nlatest row");
  expect(history).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Terminal history" })).not.toBeInTheDocument();
  expect(fixture.entry.focus).toHaveBeenCalled();
});

/** Verifies a running terminal without output explains that input is available. */
it("shows guidance while a running terminal awaits its first output", async () => {
  renderPane();
  await publishReady();

  expect(screen.getByText("Waiting for output. You can type a command below.")).toBeInTheDocument();
});

/** Verifies one retained terminal keeps its find query when its route view remounts. */
it("retains the find query across a view remount", async () => {
  const user = userEvent.setup();
  const view = renderPane();
  await publishReady();
  await user.click(screen.getByRole("button", { name: "Find" }));
  await user.type(screen.getByRole("textbox", { name: "Find in terminal history" }), "retained");

  view.unmount();
  renderPane();
  await user.click(screen.getByRole("button", { name: "Find" }));

  expect(screen.getByRole("textbox", { name: "Find in terminal history" })).toHaveValue("retained");
});

/** Verifies a closing process reports an in-progress stop instead of a failure. */
it("reports a closing terminal as stopping", async () => {
  renderPane();
  await publishReady("closing");

  expect(screen.getByText("Stopping Terminal…")).toBeInTheDocument();
  expect(screen.queryByText("Process stopped with an error")).not.toBeInTheDocument();
});

/** Verifies double-click selection does not activate a selected URL. */
it("does not open selected URL text on double-click", async () => {
  const view = renderPane();
  await publishReady();
  vi.spyOn(window, "getSelection").mockReturnValue({
    toString: () => "https://example.com/qa",
  } as Selection);

  const root = view.container.querySelector("[data-terminal-root]");
  expect(root).not.toBeNull();
  if (root === null) return;
  await act(async () => fireEvent.doubleClick(root));

  expect(openTerminalLink).not.toHaveBeenCalled();
});

/** Verifies native paste is captured before WTerm can consume browser clipboard bytes. */
it("routes native paste through Rust before WTerm handles it", async () => {
  fixture.entry.attach.mockImplementation((host: HTMLElement) => {
    host.appendChild(fixture.adapter.element);
    return () => fixture.adapter.element.remove();
  });
  const view = renderPane();
  await publishReady();
  const onData = vi.fn();
  const handler = new InputHandler(fixture.adapter.element, onData, () => null);

  try {
    const input = fixture.adapter.element.querySelector("textarea");
    expect(input).not.toBeNull();
    if (input === null) return;
    await act(async () => {
      fireEvent.paste(input, {
        clipboardData: { getData: () => "BROWSER_CLIPBOARD_BYPASS" },
      });
    });

    expect(onData).not.toHaveBeenCalledWith("BROWSER_CLIPBOARD_BYPASS");
    expect(readTerminalClipboard).toHaveBeenCalledWith("terminal-1");
  } finally {
    handler.destroy();
    view.unmount();
    fixture.entry.attach.mockImplementation(() => () => undefined);
  }
});
