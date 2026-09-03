// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectChangedEventDto, ProjectDto } from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { addProject, listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { HomeRoute } from "./home-route";

// Replace the shared Projects adapter so the route is exercised without a database or picker.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(),
  listProjects: vi.fn(),
  onProjectsChanged: vi.fn(),
}));

const listProjectsMock = vi.mocked(listProjects);
const onProjectsChangedMock = vi.mocked(onProjectsChanged);

/** One registered project; only its presence in the list matters to this route. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

/** Copy for a failure the user cannot retry, only restart out of. */
const INTEGRATION_MESSAGE = "XWork ran into a problem it cannot recover from. Restart XWork.";

/** A promise whose settlement the test controls, so a refresh can be observed mid-flight. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolveFn) => {
    resolve = resolveFn;
  });

  return { promise, resolve };
}

/** Render the route inside the router and tooltip context the application provides. */
function renderRoute() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/"]}>
        <HomeRoute />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** Emit one project invalidation event to the listener the route registered. */
async function emitProjectsChanged(): Promise<void> {
  const handler = onProjectsChangedMock.mock.calls[0]?.[0] as (
    event: ProjectChangedEventDto,
  ) => void;

  await act(async () => {
    handler({ change: "added", projectId: "3f2a" });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(addProject).mockResolvedValue({ outcome: "cancelled" });
  listProjectsMock.mockResolvedValue([]);
  onProjectsChangedMock.mockResolvedValue(() => {});
});

afterEach(() => {
  cleanup();
});

describe("HomeRoute branches", () => {
  // Verify the first load commits to neither branch, so the screen cannot flash between them.
  it("announces the first load without rendering Welcome or Home", async () => {
    const pending = createDeferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);

    renderRoute();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Checking your projects…");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Project" })).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve([]);
    });

    expect(screen.getByRole("button", { name: "Add Project" })).toBeInTheDocument();
  });

  // Verify an empty result opens the first-run screen.
  it("renders Welcome when no project exists", async () => {
    renderRoute();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Every project, every CLI, one window.",
      }),
    ).toBeInTheDocument();
  });

  // Verify any project at all hands the route to the Home branch instead.
  it("renders the Home placeholder once a project exists", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);

    renderRoute();

    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("This area arrives with FE-003.")).toBeInTheDocument();
  });

  // Verify a recoverable load failure states the problem and offers exactly one retry.
  it("offers a retry after a recoverable load failure", async () => {
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );

    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("XWork couldn't load your projects.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  // Verify an unrecoverable load failure names the only remedy and offers no retry loop.
  it.each([
    ["unauthorizedWindow", new IpcCallError("list_projects", { code: "unauthorizedWindow" })],
    ["invalidSearch", new IpcCallError("list_projects", { code: "invalidSearch" })],
    ["an unrecognized payload", new IpcCallError("list_projects", null)],
  ])("reports %s without a retry", async (_label, rejection) => {
    listProjectsMock.mockRejectedValue(rejection);

    renderRoute();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(INTEGRATION_MESSAGE);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

describe("HomeRoute retry", () => {
  // Verify one click issues one query and locks the button until the result arrives, so a
  // frustrated user cannot queue several loads of the same list.
  it("queries once per retry and locks the button while it runs", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );
    renderRoute();
    await screen.findByRole("alert");

    const pending = createDeferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(listProjectsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();

    await act(async () => {
      pending.resolve([PROJECT]);
    });

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  // Verify the lock is released when a retry fails again, so the user can try once more.
  it("unlocks the retry after another failure", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );
    renderRoute();
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

describe("HomeRoute refresh", () => {
  // Verify a project added elsewhere moves the route off Welcome without any user action.
  it("switches from Welcome to Home when a project appears", async () => {
    renderRoute();
    await screen.findByRole("button", { name: "Add Project" });

    listProjectsMock.mockResolvedValue([PROJECT]);
    await emitProjectsChanged();

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  // Verify removing the last project brings the first-run screen back, with no onboarding
  // flag standing in the way.
  it("switches from Home back to Welcome when the last project disappears", async () => {
    listProjectsMock.mockResolvedValue([PROJECT]);
    renderRoute();
    await screen.findByRole("heading", { level: 1, name: "Home" });

    listProjectsMock.mockResolvedValue([]);
    await emitProjectsChanged();

    expect(screen.getByRole("button", { name: "Add Project" })).toBeInTheDocument();
  });

  // Verify a background refresh keeps the rendered branch and the caret exactly where they
  // were, because the user may be part-way through the Add Project flow.
  it("keeps the current branch and focus while refreshing", async () => {
    renderRoute();
    const addProjectButton = await screen.findByRole("button", { name: "Add Project" });
    act(() => {
      addProjectButton.focus();
    });

    const pending = createDeferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);
    await emitProjectsChanged();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Project" })).toHaveFocus();

    await act(async () => {
      pending.resolve([]);
    });

    expect(screen.getByRole("button", { name: "Add Project" })).toHaveFocus();
  });
});
