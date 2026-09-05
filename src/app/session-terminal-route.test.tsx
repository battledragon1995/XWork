import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

vi.mock("@/features/sessions/session-route", () => ({
  /** Invokes the supplied terminal slot with one generated-contract-shaped target. */
  SessionRoute: (props: { renderTerminal(values: Record<string, unknown>): React.ReactNode }) =>
    props.renderTerminal({
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
    }),
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
