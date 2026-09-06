import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationTargetDto } from "@/bindings/notifications/notifications";
import type { SessionDetailDto } from "@/bindings/sessions/sessions";
import type { NotificationCenterProps } from "@/features/notifications";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as sessions from "@/lib/ipc/sessions";
import { NotificationEntry } from "./notification-entry";
import { resetQuitStore, useQuitStore } from "./quit-store";

// Capture the public feature boundary without depending on its implementation.
const bridge = vi.hoisted(() => ({ props: null as NotificationCenterProps | null }));
vi.mock("@/features/notifications", () => ({
  /** Records only the app-supplied callback and lifecycle props. */
  NotificationCenter: (props: NotificationCenterProps) => {
    bridge.props = props;
    return null;
  },
}));
// Activation is isolated from real sessions, PTYs and application data.
vi.mock("@/lib/ipc/sessions", () => ({ setActivePane: vi.fn(), setMaximizedPane: vi.fn() }));
const target: NotificationTargetDto = {
  kind: "session",
  projectId: "project",
  sessionId: "session /one",
  tabId: "tab",
  paneId: "pane",
};
/** Builds a complete exact-target snapshot, optionally covered by another pane. */
function detail(maximizedPaneId: string | null = null): SessionDetailDto {
  return {
    summary: {
      id: target.sessionId,
      projectId: target.projectId,
      name: "Session",
      status: "finished",
      runningProcessCount: 0,
      tabCount: 1,
    },
    revision: "9",
    activeTabId: "tab",
    canReopenLastClosedTab: false,
    tabs: [
      {
        id: "tab",
        name: "Terminal",
        activePaneId: "pane",
        maximizedPaneId,
        layout: { kind: "pane", pane: { id: "pane", content: { kind: "empty" } } },
      },
    ],
  };
}
/** Observes the real memory-router destination and transient navigation state. */
function Destination() {
  const location = useLocation();
  return (
    <output data-testid="destination">
      {JSON.stringify({ pathname: location.pathname, state: location.state })}
    </output>
  );
}
/** Mounts one persistent entry across the router's locations. */
function mount() {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <NotificationEntry />
      <Destination />
    </MemoryRouter>,
  );
}
/** Retains command completion until cancellation can be inserted. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  // The test controls the only asynchronous response.
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// Each scenario owns independent session responses and quit state.
beforeEach(() => {
  vi.resetAllMocks();
  resetQuitStore();
  vi.mocked(sessions.setActivePane).mockResolvedValue(detail());
  vi.mocked(sessions.setMaximizedPane).mockResolvedValue(detail());
});
// Release router subscriptions and pending quit state between cases.
afterEach(() => {
  cleanup();
  resetQuitStore();
});
// Activation selects the tab and pane together, followed by one exact encoded destination.
it("activates the validated exact target and creates a fresh focus token even on the same route", async () => {
  mount();
  await act(async () => bridge.props?.onOpenTarget(target, new AbortController().signal));
  expect(sessions.setActivePane).toHaveBeenCalledWith(target.sessionId, "tab", "pane");
  expect(sessions.setMaximizedPane).not.toHaveBeenCalled();
  const first = JSON.parse(screen.getByTestId("destination").textContent ?? "{}");
  expect(first.pathname).toBe("/sessions/session%20%2Fone");
  expect(first.state.notificationFocus).toEqual({
    tabId: "tab",
    paneId: "pane",
    requestId: expect.any(String),
  });
  const firstKey = bridge.props?.dismissKey;
  await act(async () => bridge.props?.onOpenTarget(target, new AbortController().signal));
  const second = JSON.parse(screen.getByTestId("destination").textContent ?? "{}");
  expect(second.state.notificationFocus.requestId).not.toBe(
    first.state.notificationFocus.requestId,
  );
  expect(bridge.props?.dismissKey).not.toBe(firstKey);
});
// Only a different maximized pane must be restored before navigation.
it.each([null, "pane", "other"])(
  "restores maximize only when target is covered by %s",
  async (maximized) => {
    vi.mocked(sessions.setActivePane).mockResolvedValue(detail(maximized));
    mount();
    await act(async () => bridge.props?.onOpenTarget(target, new AbortController().signal));
    if (maximized === "other")
      expect(sessions.setMaximizedPane).toHaveBeenCalledWith(target.sessionId, "tab", null);
    else expect(sessions.setMaximizedPane).not.toHaveBeenCalled();
    expect(screen.getByTestId("destination")).toHaveTextContent("/sessions/");
  },
);
// A missing/mismatched target never falls back to any surviving route or pane.
it.each(["project", "session", "tab", "pane"])(
  "rejects a mismatched %s snapshot",
  async (field) => {
    const value = detail();
    if (field === "project") value.summary.projectId = "other";
    if (field === "session") value.summary.id = "other";
    if (field === "tab") value.activeTabId = "other";
    if (field === "pane") {
      const tab = value.tabs[0];
      if (!tab) throw new Error("Expected the fixture tab.");
      tab.layout = { kind: "pane", pane: { id: "other", content: { kind: "empty" } } };
    }
    vi.mocked(sessions.setActivePane).mockResolvedValue(value);
    mount();
    await expect(
      bridge.props?.onOpenTarget(target, new AbortController().signal),
    ).rejects.toMatchObject({ payload: { code: "target_unavailable" } });
    expect(screen.getByTestId("destination")).toHaveTextContent("/projects");
  },
);
// Backend failure at either step leaves navigation untouched for the panel to report.
it.each(["activate", "restore"])("propagates %s failure without navigation", async (step) => {
  const error = new IpcCallError("set_active_pane", { code: "paneNotFound", paneId: "pane" });
  if (step === "activate") vi.mocked(sessions.setActivePane).mockRejectedValue(error);
  else {
    vi.mocked(sessions.setActivePane).mockResolvedValue(detail("other"));
    vi.mocked(sessions.setMaximizedPane).mockRejectedValue(error);
  }
  mount();
  await expect(bridge.props?.onOpenTarget(target, new AbortController().signal)).rejects.toBe(
    error,
  );
  expect(screen.getByTestId("destination")).toHaveTextContent("/projects");
});
// AbortSignal is checked before commands and after every asynchronous boundary.
it.each(["before", "activation", "restore"])(
  "does not navigate after cancellation at %s",
  async (step) => {
    const controller = new AbortController();
    const response = deferred<SessionDetailDto>();
    if (step === "before") controller.abort();
    if (step === "activation") vi.mocked(sessions.setActivePane).mockReturnValue(response.promise);
    if (step === "restore") {
      vi.mocked(sessions.setActivePane).mockResolvedValue(detail("other"));
      vi.mocked(sessions.setMaximizedPane).mockReturnValue(response.promise);
    }
    mount();
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = bridge.props?.onOpenTarget(target, controller.signal);
      await Promise.resolve();
    });
    controller.abort();
    await act(async () => {
      response.resolve(detail("other"));
      await pending;
    });
    expect(screen.getByTestId("destination")).toHaveTextContent("/projects");
    if (step === "before") expect(sessions.setActivePane).not.toHaveBeenCalled();
    if (step === "activation") expect(sessions.setMaximizedPane).not.toHaveBeenCalled();
  },
);
// Actual quit-store phases determine suspension and allow recovery at safe retry phases.
it("suspends on all active Quit phases and permits idle/snapshot-failed", () => {
  mount();
  for (const phase of [
    "requesting",
    "awaiting-confirmation",
    "confirming",
    "integration-failed",
    "idle",
    "snapshot-failed",
  ] as const) {
    act(() => useQuitStore.setState({ phase }));
    expect(bridge.props?.suspended).toBe(phase !== "idle" && phase !== "snapshot-failed");
  }
});
