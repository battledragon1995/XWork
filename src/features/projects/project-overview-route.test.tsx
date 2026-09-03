import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import type {
  ProjectChangedEventDto,
  ProjectDto,
  ProjectGitStatusDto,
} from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import { ProjectOverviewRoute } from "./project-overview-route";

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

const openProjectMock = vi.mocked(projectsIpc.openProject);
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

/** Render the real route with a small destination route for silent gone navigation. */
function renderRoute() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/projects/3f2a"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectOverviewRoute />} />
          <Route path="/projects" element={<p>Projects destination</p>} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  projectEvent = null;
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
    expect(screen.getByRole("button", { name: "New Session" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByText("Sessions in this run")).not.toBeInTheDocument();
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
