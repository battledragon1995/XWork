// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import { resetProjectsStore } from "@/features/projects/projects-store";
import { resetSessionsStore } from "@/features/sessions/sessions-store";
import { resetCliProfilesStore } from "@/features/settings/cli-profiles-store";
import { createCliProfilesSnapshot } from "@/features/settings/cli-profiles-test-fixture";
import { resetSettingsStore } from "@/features/settings/settings-store";
import { createSettingsSnapshot } from "@/features/settings/settings-test-fixture";
import { readAppInfo } from "@/lib/ipc/app-info";
import { getCliProfiles } from "@/lib/ipc/cli-profiles";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { getProject, getProjectGitStatus, listProjects, openProject } from "@/lib/ipc/projects";
import { getSession, listSessions } from "@/lib/ipc/sessions";
import { getSettings } from "@/lib/ipc/settings";
import { AppErrorBoundary } from "./app-error-boundary";
import { AppProviders } from "./app-providers";
import { createAppRouter } from "./app-router";
import { AppShell } from "./app-shell";
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

// Replace both Settings data boundaries so route tests never call Tauri or read real app data.
vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
}));
vi.mock("@/lib/ipc/app-info", () => ({ readAppInfo: vi.fn() }));

// Replace the Sessions boundary the real session route and the sidebar rows now read, so no
// case reaches Tauri or observes a runtime session.
vi.mock("@/lib/ipc/sessions", () => ({
  closeRuntimeTarget: vi.fn(),
  createSession: vi.fn(),
  getCloseImpact: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(async () => []),
  onSessionsRuntimeChanged: vi.fn(async () => () => {}),
  renameSession: vi.fn(),
  selectSessionTool: vi.fn(),
  setObservedSession: vi.fn(async () => null),
}));

// Replace the CLI profile boundary the real Terminal route reads, so the router test never
// touches real shells, profiles or the credential store.
vi.mock("@/lib/ipc/cli-profiles", () => ({
  getCliProfiles: vi.fn(),
  createCliProfile: vi.fn(),
  updateCliProfile: vi.fn(),
  deleteCliProfile: vi.fn(),
  setDefaultCliShell: vi.fn(),
  checkCliProfile: vi.fn(),
  onCliProfilesChanged: vi.fn(async () => () => {}),
}));

const listProjectsMock = vi.mocked(listProjects);
const openProjectMock = vi.mocked(openProject);
const getProjectMock = vi.mocked(getProject);
const getProjectGitStatusMock = vi.mocked(getProjectGitStatus);
const getSettingsMock = vi.mocked(getSettings);
const readAppInfoMock = vi.mocked(readAppInfo);
const getCliProfilesMock = vi.mocked(getCliProfiles);
const listSessionsMock = vi.mocked(listSessions);
const getSessionMock = vi.mocked(getSession);

/** One runtime session of the registered project, used by the session-route cases. */
const SESSION_SUMMARY = {
  id: "9f3a",
  projectId: "3f2a",
  name: "Debounce PTY resize",
  status: "noToolYet" as const,
  runningProcessCount: 0,
  tabCount: 0,
};

/** The snapshot `get_session` answers with for that session. */
const SESSION_DETAIL = {
  summary: SESSION_SUMMARY,
  tabs: [],
  activeTabId: null,
  canReopenLastClosedTab: false,
  revision: "4",
};

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
  resetSessionsStore();
  listProjectsMock.mockResolvedValue([PROJECT]);
  listSessionsMock.mockReset().mockResolvedValue([SESSION_SUMMARY]);
  getSessionMock.mockReset().mockResolvedValue(SESSION_DETAIL);
  openProjectMock.mockResolvedValue(PROJECT);
  getProjectMock.mockResolvedValue(PROJECT);
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
  resetSettingsStore();
  resetCliProfilesStore();
  getCliProfilesMock.mockReset().mockResolvedValue(createCliProfilesSnapshot());
  getSettingsMock.mockReset().mockResolvedValue(createSettingsSnapshot());
  readAppInfoMock.mockReset().mockResolvedValue({
    appVersion: "0.0.0",
    osPlatform: "windows",
    osVersion: "11",
    osArch: "x86_64",
  });
});

afterEach(() => {
  cleanup();
  resetSettingsStore();
  resetCliProfilesStore();
  resetSessionsStore();
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
  ])("renders the %s route as the %s area placeholder", (path, area, arrivesWith) => {
    renderAt(path);

    expect(screen.getByRole("heading", { level: 1, name: area })).toBeInTheDocument();
    expect(screen.getByText(`This area arrives with ${arrivesWith}.`)).toBeInTheDocument();
  });

  // Verify the Settings index is replaced by General with matching shell and sub-nav state.
  it("redirects /settings to the real General route", async () => {
    const router = createAppRouter(["/notes", "/settings"]);
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "General" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/general");
    expect(readBreadcrumb()).toEqual(["Settings", "General"]);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");

    await act(async () => router.navigate(-1));
    expect(await screen.findByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument();
  });

  // Verify every deferred route keeps the frame and names the feature that will own it.
  it.each([
    ["/settings/keyboard-shortcuts", "Keyboard Shortcuts", "FE-014"],
    ["/settings/notifications", "Notifications", "FE-023"],
    ["/settings/data", "Data", "FE-015"],
  ])("renders %s with the %s placeholder", async (path, section, owner) => {
    renderAt(path);

    expect(screen.getByRole("heading", { level: 1, name: section })).toBeInTheDocument();
    expect(screen.getByText(`This section arrives with ${owner}.`)).toBeInTheDocument();
    expect(readBreadcrumb()).toEqual(["Settings", section]);
    expect(screen.getByRole("link", { name: section })).toHaveAttribute("aria-current", "page");
  });

  // Verify the Terminal section renders its real page instead of the FE-013 placeholder.
  it("renders the real Terminal & CLI Profiles route", async () => {
    renderAt("/settings/terminal-profiles");

    expect(await screen.findByLabelText("Default shell")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Terminal & CLI Profiles" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Profile" })).toBeInTheDocument();
    expect(screen.queryByText("This section arrives with FE-013.")).not.toBeInTheDocument();
    expect(readBreadcrumb()).toEqual(["Settings", "Terminal & CLI Profiles"]);
    expect(screen.getByRole("link", { name: "Terminal & CLI Profiles" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // Verify the Appearance section now renders its real page instead of the FE-012 placeholder.
  it("renders the real Appearance route", async () => {
    renderAt("/settings/appearance");

    expect(await screen.findByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore default theme" })).toBeInTheDocument();
    expect(screen.queryByText("This section arrives with FE-012.")).not.toBeInTheDocument();
    expect(readBreadcrumb()).toEqual(["Settings", "Appearance"]);
    expect(screen.getByRole("link", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // Verify About reads its isolated data source and does not trigger another Settings read.
  it("renders the real About route independently", async () => {
    renderAt("/settings/about");

    expect(await screen.findByText("Version 0.0.0")).toBeInTheDocument();
    expect(readBreadcrumb()).toEqual(["Settings", "About"]);
    expect(getSettingsMock).toHaveBeenCalledOnce();
    expect(readAppInfoMock).toHaveBeenCalledOnce();
  });

  // Verify a missing Settings child falls through to the shell's existing Not Found route.
  it("renders Not Found for an unknown Settings child", () => {
    renderAt("/settings/not-real");

    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Settings sections" })).not.toBeInTheDocument();
  });

  // Verify the nested Settings list does not alter the shell's landmark contract.
  it("keeps one shell landmark set around Settings", async () => {
    renderAt("/settings/general");
    await screen.findByRole("heading", { level: 1, name: "General" });

    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
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
  it("renders the real session route", async () => {
    renderAt("/sessions/9f3a");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Debounce PTY resize" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("This area arrives with FE-006.")).not.toBeInTheDocument();
    expect(getSessionMock).toHaveBeenCalledWith("9f3a");
  });

  // Verify the session breadcrumb is three levels built from both retained snapshots, never
  // from the opaque route parameter.
  it("builds a three-level session breadcrumb", async () => {
    renderAt("/sessions/9f3a");
    await screen.findByRole("heading", { level: 1, name: "Debounce PTY resize" });

    await vi.waitFor(() =>
      expect(readBreadcrumb()).toEqual(["Projects", "xwork", "Debounce PTY resize"]),
    );
  });

  // Verify a session the runtime does not know names only the area it belongs to, rather
  // than echoing an id the user never typed.
  it("names only the area for an unknown session", async () => {
    getSessionMock.mockRejectedValue(
      new IpcCallError("get_session", { code: "unauthorizedWindow" }),
    );
    renderAt("/sessions/9f3a-B7%20c");

    await screen.findByText("XWork couldn't open this session.");
    expect(readBreadcrumb()).toEqual(["Projects"]);
  });

  // Verify a rename committed elsewhere recomputes the crumb without any navigation.
  it("follows a renamed session in the breadcrumb", async () => {
    renderAt("/sessions/9f3a");
    await vi.waitFor(() =>
      expect(readBreadcrumb()).toEqual(["Projects", "xwork", "Debounce PTY resize"]),
    );

    listSessionsMock.mockResolvedValue([{ ...SESSION_SUMMARY, name: "Renamed" }]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => expect(readBreadcrumb()).toEqual(["Projects", "xwork", "Renamed"]));
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
