import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

/** Keep composition props observable across rerenders. */
const bridge = vi.hoisted(() => ({
  status: "ready",
  pending: null as string | null,
  snapshot: { actions: [] },
  platform: "windows",
  received: vi.fn(),
}));
afterEach(cleanup);
vi.mock("@/features/sessions/session-route", () => ({
  /** Invokes the supplied terminal slot with one generated-contract-shaped target. */
  SessionRoute: (props: { renderTerminal(values: Record<string, unknown>): React.ReactNode }) => {
    bridge.received(props);
    return props.renderTerminal({
      sessionId: "session-1",
      tabId: "tab-2",
      paneId: "pane-3",
      content: {
        kind: "terminal",
        terminalId: "terminal-4",
        profileId: "builtin:terminal",
        title: "Terminal",
      },
      isActive: true,
      isVisible: true,
      onActivate: vi.fn(),
      onRefreshSession: vi.fn(),
      onCheckProfile: vi.fn(),
    });
  },
}));
vi.mock("@/features/terminal", () => ({
  /** Exposes app navigation callbacks from the composed terminal slot. */
  TerminalPane: (props: { onOpenTerminalSettings(profileId?: string): void }) => (
    <button type="button" onClick={() => props.onOpenTerminalSettings("profile-1")}>
      Terminal slot
    </button>
  ),
}));

import { SessionTerminalRoute } from "./session-terminal-route";

/** Verifies the app supplies Terminal to Sessions and owns settings navigation. */
it("composes the terminal render slot with app navigation callbacks", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <SessionTerminalRoute />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Terminal slot" }));
  expect(screen.getByRole("button", { name: "Terminal slot" })).toBeInTheDocument();
});

/** Supply the public provider boundary without invoking native APIs. */
vi.mock("@/features/settings/keyboard-shortcuts-provider", () => ({
  /** Return the current public state for the composition root. */
  useKeyboardShortcuts: () => bridge,
}));

/** Composition exposes only confirmed dispatchable snapshots to Sessions. */
it("passes refreshed props and suppresses unconfirmed configuration", () => {
  const view = render(
    <MemoryRouter>
      <SessionTerminalRoute />
    </MemoryRouter>,
  );
  expect(bridge.received).toHaveBeenLastCalledWith(
    expect.objectContaining({ shortcutSnapshot: bridge.snapshot, shortcutPlatform: "windows" }),
  );
  for (const status of ["refreshing", "error", "loading"]) {
    bridge.status = status;
    view.rerender(
      <MemoryRouter>
        <SessionTerminalRoute />
      </MemoryRouter>,
    );
    expect(bridge.received).toHaveBeenLastCalledWith(
      expect.objectContaining({ shortcutSnapshot: null }),
    );
  }
  bridge.status = "ready";
  bridge.pending = "set";
  view.rerender(
    <MemoryRouter>
      <SessionTerminalRoute />
    </MemoryRouter>,
  );
  expect(bridge.received).toHaveBeenLastCalledWith(
    expect.objectContaining({ shortcutSnapshot: null }),
  );
  bridge.pending = null;
});

/** Accepts only the documented neutral focus request shape from navigation state. */
it.each([
  { notificationFocus: { tabId: "t", paneId: "p", requestId: "r" } },
  { notificationFocus: { tabId: 1, paneId: "p", requestId: "r" } },
  { notificationFocus: { tabId: "t", paneId: "p", requestId: "" } },
  null,
])("validates notification focus state %j without changing the terminal slot", (state) => {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/sessions/s", state }]}>
      <SessionTerminalRoute />
    </MemoryRouter>,
  );
  expect(bridge.received).toHaveBeenLastCalledWith(
    expect.objectContaining({
      focusRequest:
        state?.notificationFocus?.requestId === "r" && state.notificationFocus.tabId === "t"
          ? state.notificationFocus
          : undefined,
      renderTerminal: expect.any(Function),
    }),
  );
});
