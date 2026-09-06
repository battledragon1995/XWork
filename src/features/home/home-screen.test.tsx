import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import type { SessionSummaryDto } from "@/bindings/sessions/sessions";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listSessions, onSessionsRuntimeChanged } from "@/lib/ipc/sessions";
import { STATUS_LABELS } from "./home-presentation";
import type { HomeRouteProps } from "./home-route";
import { HomeScreen } from "./home-screen";
import type { ProjectPresenceResult } from "./use-project-presence";

// All dashboard reads stop at the public IPC wrapper boundary.
vi.mock("@/lib/ipc/sessions", () => ({ listSessions: vi.fn(), onSessionsRuntimeChanged: vi.fn() }));
const PROJECT: ProjectDto = {
  id: "p/a",
  displayName: "Project",
  rootPath: "C:/fixtures/project",
  isPinned: false,
  addedAtMs: 1,
  lastOpenedAtMs: 1,
  availability: { status: "available" },
};
const SESSION: SessionSummaryDto = {
  id: "s/a",
  projectId: PROJECT.id,
  name: "Build",
  status: "running",
  runningProcessCount: 2,
  tabCount: 3,
};
/** Supply one full query snapshot as the route does in production. */
function projects(
  rows = [PROJECT],
  patch: Partial<ProjectPresenceResult> = {},
): ProjectPresenceResult {
  return {
    snapshot: rows,
    projects: rows,
    presence: { status: "present" },
    invalidation: 0,
    loading: false,
    refreshing: false,
    failure: null,
    subscriptionFailed: false,
    refresh: vi.fn(),
    ...patch,
  };
}
/** Render links with real router activation and a separate external focus owner. */
function mount(query = projects(), props: HomeRouteProps = {}) {
  return render(
    <MemoryRouter>
      <button type="button">External</button>
      <Routes>
        <Route path="/" element={<HomeScreen projects={query} {...props} />} />
        <Route path="/projects/*" element={<h1>Project owner</h1>} />
        <Route path="/sessions/*" element={<h1>Session owner</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}
// Reset query and listener implementations between isolated render lifetimes.
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listSessions).mockResolvedValue([SESSION]);
  vi.mocked(onSessionsRuntimeChanged).mockResolvedValue(vi.fn());
});
// Clear timers, listeners and DOM after every case.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Display actual summaries, independent process counts and no future-phase UI.
it("shows the two Phase 1 blocks with real counts and encoded destinations", async () => {
  mount();
  expect(await screen.findByRole("link", { name: "Open session Build" })).toHaveAttribute(
    "href",
    "/sessions/s%2Fa",
  );
  expect(screen.getByRole("link", { name: "Open project Project" })).toHaveAttribute(
    "href",
    "/projects/p%2Fa",
  );
  expect(screen.getByText("1 sessions running · 0 need attention")).toBeInTheDocument();
  expect(screen.getByText("3 tabs · 2 processes")).toBeInTheDocument();
  expect(screen.queryByText(/Quick Note|Calendar|Upcoming|Save note/)).toBeNull();
  expect(listSessions).toHaveBeenCalledExactlyOnceWith();
});
// Status labels never filter finished, unconfigured or failed sessions out of Home.
it("renders all six status labels", async () => {
  vi.mocked(listSessions).mockResolvedValue(
    Object.keys(STATUS_LABELS).map((status, index) => ({
      ...SESSION,
      id: `${index}`,
      name: `${index}`,
      status: status as SessionSummaryDto["status"],
    })),
  );
  mount();
  await screen.findByText("Finished");
  for (const label of Object.values(STATUS_LABELS))
    expect(screen.getByText(label)).toBeInTheDocument();
});
// A session's project name must come from the full snapshot, not its five recent rows.
it("joins project names outside recent and gives missing owners a safe label", async () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    ...PROJECT,
    id: `${index}`,
    displayName: `Project ${index}`,
    lastOpenedAtMs: index,
  }));
  vi.mocked(listSessions).mockResolvedValue([
    { ...SESSION, projectId: "0" },
    { ...SESSION, id: "missing", name: "Missing", projectId: "unknown" },
  ]);
  mount(projects(rows));
  const section = screen.getByRole("region", { name: "Sessions" });
  expect(await within(section).findByText("Project 0")).toBeInTheDocument();
  expect(within(section).getByText("Project unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open project Project 0" })).toBeNull();
});
// Unavailable roots still open the owner's repair actions.
it.each(["missing", "notDirectory", "accessDenied", "io"] as const)(
  "keeps %s projects navigable",
  async (reason) => {
    mount(projects([{ ...PROJECT, availability: { status: "unavailable", reason } }]));
    expect(screen.getByText(/Unavailable ·/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("link", { name: "Open project Project" }));
    expect(screen.getByRole("heading", { name: "Project owner" })).toBeInTheDocument();
  },
);
// Loading and failures do not fabricate an empty runtime or block successful projects.
it("keeps recent projects usable during session loading and failure", async () => {
  let reject!: (error: unknown) => void;
  vi.mocked(listSessions).mockReturnValue(
    new Promise((_, no) => {
      reject = no;
    }),
  );
  mount();
  expect(screen.getByText("Loading sessions…")).toBeInTheDocument();
  expect(screen.queryByText(/No sessions running/)).toBeNull();
  await act(async () => reject(new IpcCallError("list_sessions", { code: "projectLookupFailed" })));
  expect(screen.getByText("XWork couldn't load your sessions.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open project Project" })).toBeInTheDocument();
});
// An empty runtime offers owner navigation without creating a session in Home.
it("offers Open Projects only after an empty successful response", async () => {
  vi.mocked(listSessions).mockResolvedValue([]);
  mount();
  await userEvent.setup().click(await screen.findByRole("link", { name: "Open Projects" }));
  expect(screen.getByRole("heading", { name: "Project owner" })).toBeInTheDocument();
});
// Listener degradation and stale project failures each expose explicit recovery.
it("shows independent stale project and subscription notices", async () => {
  vi.mocked(onSessionsRuntimeChanged).mockRejectedValue(new Error("listener"));
  const query = projects(undefined, { failure: "retryable" });
  mount(query);
  await screen.findByText("Live updates are unavailable. Refresh to update.");
  expect(screen.getByText("Projects may be out of date.")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(query.refresh).toHaveBeenCalledOnce();
});
// Native link keyboard semantics must open the session owner without custom key handlers.
it("opens a session with Tab and Enter", async () => {
  const user = userEvent.setup();
  mount();
  const row = await screen.findByRole("link", { name: "Open session Build" });
  screen.getByRole("link", { name: "Projects" }).focus();
  await user.tab();
  expect(row).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Session owner" })).toBeInTheDocument();
});
// A live reset can precede rendered props; stale links must still be blocked.
it("blocks navigation against a newer live epoch", async () => {
  let live = { epoch: 0, suspended: false };
  mount(projects(), { boundary: live, readBoundary: () => live });
  const link = await screen.findByRole("link", { name: "Open session Build" });
  live = { epoch: 1, suspended: true };
  fireEvent.click(link);
  expect(screen.queryByRole("heading", { name: "Session owner" })).toBeNull();
});
// Identity keys preserve focus on reorder; removal returns it to the section heading.
it("preserves row focus on reorder and moves it after deletion", async () => {
  const second = { ...SESSION, id: "second", name: "Second", status: "finished" as const };
  vi.mocked(listSessions).mockResolvedValue([SESSION, second]);
  mount();
  const row = await screen.findByRole("link", { name: "Open session Second" });
  row.focus();
  vi.mocked(listSessions).mockResolvedValue([{ ...second, status: "needsAttention" }, SESSION]);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(row).toHaveFocus();
  vi.mocked(listSessions).mockResolvedValue([SESSION]);
  await act(async () =>
    vi.mocked(onSessionsRuntimeChanged).mock.calls[0]?.[0]({
      change: "deleted",
      revision: "3",
      sessionId: "second",
      projectId: PROJECT.id,
      summary: null,
    }),
  );
  expect(screen.getByRole("heading", { name: "Sessions" })).toHaveFocus();
});
// Removal must not steal focus from a dialog/sidebar-like external control.
it("does not steal external focus when a previous row disappears", async () => {
  mount();
  (await screen.findByRole("link", { name: "Open session Build" })).focus();
  const external = screen.getByRole("button", { name: "External" });
  external.focus();
  vi.mocked(listSessions).mockResolvedValue([]);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(external).toHaveFocus();
});
// A single local-midnight timer updates the header and is cleaned on disposal.
it("rolls the header over at local midnight and clears its timer", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 6, 23, 59, 59));
  const view = mount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText("Sunday, 6 September")).toBeInTheDocument();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(screen.getByText("Monday, 7 September")).toBeInTheDocument();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
