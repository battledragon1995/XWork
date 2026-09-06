import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";
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

import type { FileExplorerProps } from "@/features/files";
import type { SessionFileExplorerSlotProps } from "@/features/sessions/session-route";
import { useQuitStore } from "./quit-store";
import { SessionTerminalRoute } from "./session-terminal-route";

/** Supply a mutable public maintenance owner without native operations. */
const maintenance = vi.hoisted(() => ({ busy: false, invalidationEpoch: 0 }));
vi.mock("@/features/settings/data-management-provider", () => ({
  /** Keep synchronous reads tied to the same owner used for rendered props. */
  useDataManagement: () => ({ ...maintenance, getCurrent: () => maintenance }),
}));

/** Keep the Files public props observable without fetching a native tree. */
const explorer = vi.hoisted(() => ({ received: vi.fn() }));
vi.mock("@/features/files", () => ({
  /** Capture the exact app-owned identity, boundary and navigation contract. */
  FileExplorer: (props: FileExplorerProps) => {
    explorer.received(props);
    return <p>Files slot</p>;
  },
}));

/** App composition must read live owners even before a React rerender and guard stale close. */
it("composes Files with summary identity, current platform and synchronous Data/Quit guards", () => {
  const view = render(
    <MemoryRouter>
      <SessionTerminalRoute />
    </MemoryRouter>,
  );
  const received = bridge.received.mock.calls.at(-1)?.[0] as {
    renderFileExplorer(props: SessionFileExplorerSlotProps): React.ReactNode;
  };
  const onClose = vi.fn();
  const slot = {
    sessionId: "session",
    projectId: "summary-project",
    isVisible: true,
    regionId: "files",
    onClose,
  };
  render(received.renderFileExplorer(slot));
  const props = explorer.received.mock.calls.at(-1)?.[0] as FileExplorerProps;
  expect(props.projectId).toBe("summary-project");
  expect(props.platform).toBe("windows");
  expect(props.readBoundary()).toEqual({ epoch: 0, suspended: false });
  maintenance.busy = true;
  expect(props.readBoundary().suspended).toBe(true);
  props.onClose();
  expect(onClose).not.toHaveBeenCalled();
  maintenance.busy = false;
  maintenance.invalidationEpoch = 1;
  props.onClose();
  expect(onClose).not.toHaveBeenCalled();
  maintenance.invalidationEpoch = 0;
  for (const phase of [
    "requesting",
    "awaiting-confirmation",
    "confirming",
    "integration-failed",
  ] as const) {
    act(() => useQuitStore.setState({ phase }));
    expect(props.readBoundary().suspended).toBe(true);
  }
  act(() => useQuitStore.setState({ phase: "snapshot-failed" }));
  expect(props.readBoundary().suspended).toBe(false);
  act(() => useQuitStore.setState({ phase: "idle" }));
  view.unmount();
});

/** Observe navigation through the real router without replacing the app callback contract. */
function LocationProbe() {
  const location = useLocation();
  const method = useNavigationType();
  return (
    <output data-testid="location">
      {method}:{location.pathname}
    </output>
  );
}
/** Existing-project recovery pushes overview; removed-project recovery replaces the route. */
it("routes Files recovery through its project identity and suppresses stale navigation", () => {
  render(
    <MemoryRouter initialEntries={["/sessions/fixture"]}>
      <SessionTerminalRoute />
      <LocationProbe />
    </MemoryRouter>,
  );
  const received = bridge.received.mock.calls.at(-1)?.[0] as {
    renderFileExplorer(props: SessionFileExplorerSlotProps): React.ReactElement<FileExplorerProps>;
  };
  const element = received.renderFileExplorer({
    sessionId: "fixture",
    projectId: "summary-project",
    isVisible: true,
    regionId: "files",
    onClose: vi.fn(),
  });
  act(() => element.props.onOpenProject());
  expect(screen.getByTestId("location")).toHaveTextContent("PUSH:/projects/summary-project");
  act(() => element.props.onProjectMissing());
  expect(screen.getByTestId("location")).toHaveTextContent("REPLACE:/projects");
  maintenance.busy = true;
  act(() => element.props.onOpenProject());
  expect(screen.getByTestId("location")).toHaveTextContent("REPLACE:/projects");
  maintenance.busy = false;
});

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
