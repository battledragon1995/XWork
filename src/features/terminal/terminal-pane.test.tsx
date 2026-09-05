import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    attach: vi.fn(() => () => undefined),
    activate: vi.fn(),
    deactivate: vi.fn(),
    retry: vi.fn(async () => undefined),
    activationToken: vi.fn(() => 1),
    isActivationCurrent: vi.fn(() => true),
    paste: vi.fn(() => true),
    clearScreen: vi.fn(() => true),
    focus: vi.fn(),
    jumpToLatest: vi.fn(),
  };
  return {
    entry,
    adapter,
    reset: () => {
      snapshot = preparing;
      listeners.clear();
    },
    publish: (next: Record<string, unknown>) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("./terminal-provider", () => ({
  useTerminalRegistry: () => ({ entry: () => fixture.entry }),
}));

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

beforeEach(() => {
  fixture.reset();
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Verifies the measured surface attaches while the initial core is preparing. */
it("attaches one retained surface and exposes a truthful loading state", () => {
  renderPane();
  expect(screen.getByRole("status")).toHaveTextContent("Preparing terminal");
  expect(fixture.entry.attach).toHaveBeenCalledTimes(1);
  expect(fixture.entry.activate).toHaveBeenCalledTimes(1);
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
