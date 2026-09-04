import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectChangedEventDto,
  ProjectDto,
  ProjectGitStatusDto,
} from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import * as sessionsIpc from "@/lib/ipc/sessions";
import { ProjectOverviewRoute } from "./project-overview-route";
import { resetProjectSessions } from "./use-project-sessions";

// Replace the complete Projects boundary so route tests touch no native or user-owned state.
vi.mock("@/lib/ipc/projects", () => ({
  getProject: vi.fn(),
  getProjectGitStatus: vi.fn(),
  getRemoveProjectImpact: vi.fn(),
  listProjects: vi.fn(async () => []),
  locateProjectFolder: vi.fn(),
  onProjectsChanged: vi.fn(),
  openProject: vi.fn(),
  openProjectFolder: vi.fn(),
  removeProject: vi.fn(),
  renameProject: vi.fn(),
  setProjectPinned: vi.fn(),
}));

// Replace the Sessions boundary too: the overview now reads and mutates runtime sessions.
vi.mock("@/lib/ipc/sessions", () => ({
  closeRuntimeTarget: vi.fn(),
  createSession: vi.fn(),
  getCloseImpact: vi.fn(),
  listSessions: vi.fn(),
  onSessionsRuntimeChanged: vi.fn(),
  renameSession: vi.fn(),
}));

const openProjectMock = vi.mocked(projectsIpc.openProject);
const listSessionsMock = vi.mocked(sessionsIpc.listSessions);
const createSessionMock = vi.mocked(sessionsIpc.createSession);
const getProjectMock = vi.mocked(projectsIpc.getProject);
const getProjectGitStatusMock = vi.mocked(projectsIpc.getProjectGitStatus);
const onProjectsChangedMock = vi.mocked(projectsIpc.onProjectsChanged);

/** Available project shown by the route. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: Date.now(),
  lastOpenedAtMs: Date.now(),
  availability: { status: "available" },
};

/** Clean worktree snapshot used by the ready layout. */
const GIT_STATUS: ProjectGitStatusDto = {
  summary: {
    projectId: "3f2a",
    repositoryKind: "worktree",
    head: { kind: "branch", name: "main" },
    changedCount: 0,
    untrackedCount: 0,
  },
  changes: [],
};

/** Event callback registered by the overview hook. */
let projectEvent: ((event: ProjectChangedEventDto) => void) | null;

/** Create a promise that keeps a visible loading state until a test settles it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** One freshly created session detail, of which the route keeps only the identifier. */
const CREATED_DETAIL = {
  summary: {
    id: "s7",
    projectId: "3f2a",
    name: "New Session",
    status: "noToolYet" as const,
    runningProcessCount: 0,
    tabCount: 0,
  },
  tabs: [],
  activeTabId: null,
  canReopenLastClosedTab: false,
  revision: "3",
};

/** Render the real route with small destination routes for every navigation it can perform. */
function renderRoute() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/3f2a"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectOverviewRoute />} />
          <Route path="/projects" element={<p>Projects destination</p>} />
          <Route path="/sessions/:sessionId" element={<p>Session destination</p>} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProjectSessions();
  projectEvent = null;
  listSessionsMock.mockResolvedValue([]);
  createSessionMock.mockResolvedValue(CREATED_DETAIL);
  vi.mocked(sessionsIpc.onSessionsRuntimeChanged).mockResolvedValue(() => {});
  openProjectMock.mockResolvedValue(PROJECT);
  getProjectMock.mockResolvedValue(PROJECT);
  getProjectGitStatusMock.mockResolvedValue(GIT_STATUS);
  onProjectsChangedMock.mockImplementation(async (handler) => {
    projectEvent = handler;
    return () => {};
  });
  vi.mocked(projectsIpc.openProjectFolder).mockResolvedValue(undefined);
  vi.mocked(projectsIpc.locateProjectFolder).mockResolvedValue({ outcome: "cancelled" });
  vi.mocked(projectsIpc.renameProject).mockResolvedValue(PROJECT);
  vi.mocked(projectsIpc.setProjectPinned).mockResolvedValue(PROJECT);
  vi.mocked(projectsIpc.getRemoveProjectImpact).mockResolvedValue({
    projectId: "3f2a",
    displayName: "xwork",
    rootPath: "D:\\Self\\XWork",
    sessionCount: 0,
    runningProcessCount: 0,
    unsavedFileCount: 0,
  });
  vi.mocked(projectsIpc.removeProject).mockResolvedValue({ projectId: "3f2a" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
});

afterEach(() => {
  cleanup();
  resetProjectSessions();
});

describe("ProjectOverviewRoute states", () => {
  // Verify the initial open shows only the non-interactive skeleton.
  it("renders the loading skeleton without header actions", () => {
    const pending = deferred<ProjectDto>();
    openProjectMock.mockReturnValue(pending.promise);

    renderRoute();

    expect(screen.getByRole("status", { name: "Loading project overview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Session" })).not.toBeInTheDocument();
  });

  // Verify a retryable open error replaces the page and retries the open command.
  it("renders and retries the full-page open failure", async () => {
    const user = userEvent.setup();
    openProjectMock.mockRejectedValueOnce(
      new IpcCallError("open_project", { code: "persistenceFailed" }),
    );
    renderRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("XWork couldn't open this project.");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { level: 1, name: "xwork" })).toBeInTheDocument();
    expect(openProjectMock).toHaveBeenCalledTimes(2);
  });

  // Verify the ready state composes the header, Git block, menu, and no deferred sessions.
  it("renders the ready Stage 5 layout", async () => {
    renderRoute();

    expect(await screen.findByRole("heading", { level: 1, name: "xwork" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Changes on main (0)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    // Two entry points now exist: the header one and the empty state's own.
    for (const entry of screen.getAllByRole("button", { name: "New Session" })) {
      expect(entry).not.toHaveAttribute("aria-disabled");
    }
    expect(screen.getByRole("heading", { name: "Sessions in this run" })).toBeInTheDocument();
    expect(listSessionsMock).toHaveBeenCalledExactlyOnceWith("3f2a");
  });

  // Verify unavailable metadata replaces the Git area with its recovery banner.
  it("renders the unavailable banner and suppresses Git", async () => {
    openProjectMock.mockResolvedValue({
      ...PROJECT,
      availability: { status: "unavailable", reason: "missing" },
    });
    renderRoute();

    expect(await screen.findByText("Folder not found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: /Changes on/ })).not.toBeInTheDocument();
    expect(getProjectGitStatusMock).not.toHaveBeenCalled();
  });

  // Verify Git failure is isolated and its retry invokes only the Git command once.
  it("renders and retries the Git failure", async () => {
    const user = userEvent.setup();
    getProjectGitStatusMock.mockRejectedValueOnce(
      new IpcCallError("get_project_git_status", {
        code: "gitInspectionFailed",
        project_id: "3f2a",
      }),
    );
    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("XWork couldn't read Git status for xwork.");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(getProjectGitStatusMock).toHaveBeenCalledTimes(2);
    expect(getProjectMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Working tree is clean.")).toBeInTheDocument();
  });

  // Verify a metadata refresh failure leaves the stale project and Git block visible.
  it("keeps ready content through an inline refresh failure", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1, name: "xwork" });
    getProjectMock.mockRejectedValue(
      new IpcCallError("get_project", { code: "persistenceFailed" }),
    );

    await act(async () => window.dispatchEvent(new Event("focus")));

    expect(screen.getByRole("heading", { level: 1, name: "xwork" })).toBeInTheDocument();
    expect(screen.getByText("Working tree is clean.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("XWork couldn't refresh this project.");
  });

  // Verify current-project removal closes the route without its own failure copy.
  it("navigates silently after a removed event", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1, name: "xwork" });

    act(() => projectEvent?.({ change: "removed", projectId: "3f2a" }));

    expect(await screen.findByText("Projects destination")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ProjectOverviewRoute actions", () => {
  // Verify the header opener reaches the reused action hook and keeps its FE-004 command.
  it("opens the project folder from the header", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1, name: "xwork" });

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));

    expect(projectsIpc.openProjectFolder).toHaveBeenCalledExactlyOnceWith("3f2a");
  });
});

describe("ProjectOverviewRoute sessions", () => {
  // Verify the session block leads the left column, above the read-only Git changes.
  it("places the session block before the Git changes", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1, name: "xwork" });

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);

    expect(headings.indexOf("Sessions in this run")).toBeLessThan(
      headings.indexOf("Changes on main (0)"),
    );
  });

  // Verify the empty state offers its own entry point with the documented sentences.
  it("renders the empty session state with its own New Session control", async () => {
    renderRoute();
    await screen.findByRole("heading", { level: 1, name: "xwork" });

    expect(await screen.findByText("No sessions in this run yet.")).toBeInTheDocument();
    expect(screen.getByText("Start one to work in this project.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New Session" })).toHaveLength(2);
  });

  // Verify both entry points run the one shared create flow and navigate exactly once.
  it.each([0, 1])("creates one session from entry point %i", async (index) => {
    const user = userEvent.setup();
    renderRoute();
    await screen.findByText("No sessions in this run yet.");

    const entry = screen.getAllByRole("button", { name: "New Session" })[index];
    if (entry === undefined) {
      throw new Error("Both New Session entry points should be rendered.");
    }

    await user.click(entry);

    expect(createSessionMock).toHaveBeenCalledExactlyOnceWith("3f2a");
    expect(await screen.findByText("Session destination")).toBeInTheDocument();
  });

  // Verify the two entry points share one lock, so a rapid double activation creates one
  // session and navigates once.
  it("creates one session when both entry points are pressed", async () => {
    const user = userEvent.setup();
    let release!: (detail: typeof CREATED_DETAIL) => void;
    createSessionMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderRoute();
    await screen.findByText("No sessions in this run yet.");

    const entries = screen.getAllByRole("button", { name: "New Session" });
    await user.click(entries[0] as HTMLElement);
    await user.click(entries[1] as HTMLElement);

    expect(createSessionMock).toHaveBeenCalledOnce();

    release(CREATED_DETAIL);
    expect(await screen.findByText("Session destination")).toBeInTheDocument();
  });

  // Verify an unavailable project blocks both entry points instead of only explaining itself.
  it("blocks both entry points for an unavailable project", async () => {
    const user = userEvent.setup();
    openProjectMock.mockResolvedValue({
      ...PROJECT,
      availability: { status: "unavailable", reason: "missing" },
    });
    renderRoute();
    await screen.findByText("Folder not found.");

    for (const entry of screen.getAllByRole("button", { name: "New Session" })) {
      expect(entry).toHaveAttribute("aria-disabled", "true");
      await user.click(entry);
    }

    expect(createSessionMock).not.toHaveBeenCalled();
  });

  // Verify a create refused because the project vanished leaves the route silently.
  it("navigates away when the project is gone", async () => {
    const user = userEvent.setup();
    createSessionMock.mockRejectedValue(
      new IpcCallError("create_session", { code: "projectNotFound", projectId: "3f2a" }),
    );
    renderRoute();
    await screen.findByText("No sessions in this run yet.");

    await user.click(screen.getAllByRole("button", { name: "New Session" })[0] as HTMLElement);

    expect(await screen.findByText("Projects destination")).toBeInTheDocument();
  });

  // Verify a create refused because the root is unusable re-reads the metadata and keeps the
  // banner's own sentence, rather than inventing a message of its own.
  it("re-reads the project after an unavailable create", async () => {
    const user = userEvent.setup();
    createSessionMock.mockRejectedValue(
      new IpcCallError("create_session", { code: "projectUnavailable", projectId: "3f2a" }),
    );
    getProjectMock.mockResolvedValue({
      ...PROJECT,
      availability: { status: "unavailable", reason: "missing" },
    });
    renderRoute();
    await screen.findByText("No sessions in this run yet.");

    await user.click(screen.getAllByRole("button", { name: "New Session" })[0] as HTMLElement);

    expect(await screen.findByText("Folder not found.")).toBeInTheDocument();
    // The banner states the reason exactly once; the create flow adds no second copy of it.
    expect(
      screen.getAllByText("Sessions cannot start until the path is valid again."),
    ).toHaveLength(1);
    expect(getProjectMock).toHaveBeenCalledWith("3f2a");
  });

  // Verify a transient create failure is reported with one more attempt and can be dismissed.
  it("offers Try again after a transient create failure", async () => {
    const user = userEvent.setup();
    createSessionMock.mockRejectedValueOnce(
      new IpcCallError("create_session", { code: "projectLookupFailed" }),
    );
    renderRoute();
    await screen.findByText("No sessions in this run yet.");

    await user.click(screen.getAllByRole("button", { name: "New Session" })[0] as HTMLElement);

    const alert = await screen.findByText("XWork couldn't start a session for this project.");
    expect(alert).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Session destination")).toBeInTheDocument();
  });

  // Verify a shutdown refusal states the fact and offers no retry at all.
  it("reports a shutdown refusal without a retry", async () => {
    const user = userEvent.setup();
    createSessionMock.mockRejectedValue(
      new IpcCallError("create_session", { code: "runtimeShuttingDown" }),
    );
    renderRoute();
    await screen.findByText("No sessions in this run yet.");

    await user.click(screen.getAllByRole("button", { name: "New Session" })[0] as HTMLElement);

    expect(await screen.findByText("XWork is shutting down.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
