// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import { getProjectGitStatus, listProjects, openProject } from "@/lib/ipc/projects";
import { AppErrorBoundary } from "./app-error-boundary";
import { AppProviders } from "./app-providers";
import { createAppRouter } from "./app-router";
import { AppShell } from "./app-shell";
import { resetProjectsStore } from "@/features/projects/projects-store";
import { resetQuitStore, useQuitStore } from "./quit-store";

// Replace the Projects boundary the index route, the Projects page and the sidebar block all
// depend on. Every function resolves so no case can leak an unresolved event registration, a
// real filesystem read or a native dialog into the next one.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(async () => ({ outcome: "cancelled" })),
  getProject: vi.fn(),
  getProjectGitStatus: vi.fn(),
  getRemoveProjectImpact: vi.fn(),
  listProjects: vi.fn(async () => []),
  locateProjectFolder: vi.fn(async () => ({ outcome: "cancelled" })),
  onProjectsChanged: vi.fn(async () => () => {}),
  openProject: vi.fn(),
  openProjectFolder: vi.fn(),
  removeProject: vi.fn(),
  renameProject: vi.fn(),
  setProjectPinned: vi.fn(),
}));

const listProjectsMock = vi.mocked(listProjects);
const openProjectMock = vi.mocked(openProject);
const getProjectGitStatusMock = vi.mocked(getProjectGitStatus);

/** One registered project, so the index route settles on its Home branch. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

// Start every case from an idle Quit flow, one registered project, and no previous render.
beforeEach(() => {
  resetQuitStore();
  resetProjectsStore();
  listProjectsMock.mockResolvedValue([PROJECT]);
  openProjectMock.mockResolvedValue(PROJECT);
  getProjectGitStatusMock.mockResolvedValue({
    summary: {
      projectId: "3f2a",
      repositoryKind: "worktree",
      head: { kind: "branch", name: "main" },
      changedCount: 0,
      untrackedCount: 0,
    },
    changes: [],
  });
});

afterEach(() => {
  cleanup();
});

// Render the production router at one entry so every case shares the same setup.
function renderAt(path: string) {
  return render(
    <AppProviders>
      <RouterProvider router={createAppRouter([path])} />
    </AppProviders>,
  );
}

// Read the breadcrumb labels currently rendered by the shell, in order.
function readBreadcrumb(): string[] {
  return within(screen.getByLabelText("Breadcrumb"))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("createAppRouter", () => {
  // Verify each primary area route renders its own placeholder with the owning feature.
  it.each([
    ["/notes", "Notes", "FE-019"],
    ["/calendar", "Calendar", "FE-021"],
    ["/settings", "Settings", "FE-011"],
  ])("renders the %s route as the %s area placeholder", (path, area, arrivesWith) => {
    renderAt(path);

    expect(screen.getByRole("heading", { level: 1, name: area })).toBeInTheDocument();
    expect(screen.getByText(`This area arrives with ${arrivesWith}.`)).toBeInTheDocument();
  });

  // Verify the Projects route now renders the feature page instead of the shell placeholder,
  // while the route table keeps owning its breadcrumb label.
  it("renders the Projects route as ProjectsRoute", async () => {
    renderAt("/projects");

    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search projects by name or path")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 3, name: "xwork" })).toBeInTheDocument();
    expect(screen.queryByText("This area arrives with FE-004.")).not.toBeInTheDocument();
    expect(readBreadcrumb()).toEqual(["Projects"]);
  });

  // Verify the index route now renders the Home feature entry, which resolves its own branch
  // from project data instead of the static shell placeholder.
  it("renders the index route as HomeRoute", async () => {
    renderAt("/");

    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("This area arrives with FE-003.")).toBeInTheDocument();
  });

  // Verify the same route resolves to the Welcome branch when no project exists yet.
  it("renders the Welcome branch of the index route on a clean install", async () => {
    listProjectsMock.mockResolvedValue([]);

    renderAt("/");

    expect(await screen.findByRole("button", { name: "Add Project" })).toBeInTheDocument();
  });

  // Verify the shell keeps naming the index route `Home` whichever branch it renders, so the
  // feature never writes into shell state to change a crumb or a navigation highlight.
  it("keeps the Home breadcrumb and navigation highlight on the Welcome branch", async () => {
    listProjectsMock.mockResolvedValue([]);

    renderAt("/");
    await screen.findByRole("button", { name: "Add Project" });

    expect(readBreadcrumb()).toEqual(["Home"]);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  // Verify the project detail route now mounts the real overview feature.
  it("renders the project detail route as ProjectOverviewRoute", async () => {
    renderAt("/projects/3f2a");

    expect(await screen.findByRole("heading", { level: 1, name: "xwork" })).toBeInTheDocument();
    expect(screen.getByText("Working tree is clean.")).toBeInTheDocument();
    expect(screen.queryByText("This area arrives with FE-005.")).not.toBeInTheDocument();
  });

  // Verify the reserved session route renders and keeps the opaque identifier untouched.
  it("reserves the session route for FE-006 and keeps the raw session id", () => {
    renderAt("/sessions/9f3a-B7%20c");

    expect(screen.getByRole("heading", { level: 1, name: "Session" })).toBeInTheDocument();
    expect(screen.getByText("This area arrives with FE-006.")).toBeInTheDocument();
    expect(readBreadcrumb()).toEqual(["Session", "9f3a-B7 c"]);
  });

  // Verify the project route translates its opaque id through the project snapshot.
  it("builds the project breadcrumb from the display name", async () => {
    renderAt("/projects/3f2a");
    await screen.findByRole("heading", { level: 1, name: "xwork" });

    expect(readBreadcrumb()).toEqual(["Projects", "xwork"]);
  });

  // Verify an unmatched route renders the not-found placeholder and can return Home.
  it("renders the not-found placeholder with a Home action", async () => {
    const user = userEvent.setup();
    renderAt("/nope");

    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to Home" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  // Verify the shell keeps its landmarks exactly once around whichever child route matched.
  it("keeps one persistent shell around the matched child route", () => {
    renderAt("/notes");

    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("heading", { level: 1, name: "Notes" }),
    );
  });

  // Verify every child route carries the application error element rather than bubbling out.
  it("attaches the route error element to every child route", () => {
    const router = createAppRouter(["/"]);
    const children = router.routes[0]?.children ?? [];

    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.errorElement).toBeDefined();
    }
  });
});

describe("AppErrorBoundary", () => {
  // Build a router whose only child route throws, so the boundary renders inside the shell.
  function renderFailingRoute() {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <AppShell />,
          children: [
            {
              path: "boom",
              element: <ThrowingRoute />,
              errorElement: <AppErrorBoundary />,
              handle: { crumbs: () => ["Notes"] },
            },
            { index: true, element: <p>Home stand-in</p>, handle: { crumbs: () => ["Home"] } },
          ],
        },
      ],
      { initialEntries: ["/boom"] },
    );

    return render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
  }

  // Fail on purpose so the router hands control to the route error element.
  function ThrowingRoute(): never {
    throw new Error("Deliberate render failure");
  }

  // Verify a failing child route keeps the shell usable and names the failing area.
  it("keeps the shell usable and names the failing area", () => {
    renderFailingRoute();

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.getByText("The Notes area could not be displayed.")).toBeInTheDocument();
  });

  // Verify the recovery action returns the user to Home without reloading the application.
  it("recovers to Home", async () => {
    const user = userEvent.setup();
    renderFailingRoute();

    await user.click(screen.getByRole("button", { name: "Go to Home" }));

    expect(screen.getByText("Home stand-in")).toBeInTheDocument();
  });
});

describe("AppProviders", () => {
  // Verify the providers pass the application through untouched.
  it("renders its children", () => {
    render(
      <AppProviders>
        <p>Application</p>
      </AppProviders>,
    );

    expect(screen.getByText("Application")).toBeInTheDocument();
  });

  // Verify the single Quit dialog host is mounted at application level, so the wordmark menu
  // and the tray can never produce two dialogs.
  it("hosts the one Quit dialog", async () => {
    render(
      <AppProviders>
        <RouterProvider router={createAppRouter(["/"])} />
      </AppProviders>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      useQuitStore.getState().receiveTrayRequest({
        requestId: 3,
        summary: {
          sessionCount: 1,
          projectCount: 1,
          runningProcessCount: 0,
          unsavedFileCount: 0,
        },
      });
    });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Quit XWork?" })).toBeInTheDocument();
  });
});
