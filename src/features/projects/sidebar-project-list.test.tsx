// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@/components/animate-ui/components/radix/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import { resetProjectsStore } from "./projects-store";
import { SidebarProjectList } from "./sidebar-project-list";

// Replace the backend boundary so no case reaches Tauri or a native picker.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(),
  listProjects: vi.fn(),
  onProjectsChanged: vi.fn(async () => () => {}),
}));

const addProjectMock = vi.mocked(projectsIpc.addProject);
const listProjectsMock = vi.mocked(projectsIpc.listProjects);

/** One available, unpinned project. */
const XWORK: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

/** A pinned project, which the backend always returns first. */
const PINNED: ProjectDto = { ...XWORK, id: "9b1c", displayName: "recipe-api", isPinned: true };

/** A project whose root became unusable. */
const BROKEN: ProjectDto = {
  ...XWORK,
  id: "7c4d",
  displayName: "invoice-tool",
  availability: { status: "unavailable", reason: "missing" },
};

// Build one promise a case can settle by hand, standing in for the open native picker.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

/**
 * Render the block inside the providers it needs, at one router entry the case chooses. The
 * real `Sidebar` is part of that: its hover highlight is a context every sidebar entry reads,
 * so the block can only ever be composed inside it.
 */
function renderList(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <SidebarProvider>
          <Sidebar collapsible="icon">
            <SidebarContent>
              <SidebarProjectList />
            </SidebarContent>
          </Sidebar>
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

// Read the project row labels currently rendered, in DOM order.
function readRowNames(): string[] {
  return screen.getAllByRole("link").map((link) => link.textContent ?? "");
}

beforeEach(() => {
  resetProjectsStore();
  vi.clearAllMocks();
  listProjectsMock.mockResolvedValue([]);
  addProjectMock.mockResolvedValue({ outcome: "cancelled" });
});

afterEach(() => {
  cleanup();
});

describe("SidebarProjectList states", () => {
  // Verify the block announces its first load without inventing placeholder rows.
  it("announces the first load", () => {
    const pending = deferred<ProjectDto[]>();
    listProjectsMock.mockReturnValue(pending.promise);

    renderList();

    expect(within(screen.getByRole("status")).getByText("Loading your projects…")).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    pending.resolve([]);
  });

  // Verify a clean install keeps the exact FE-001 sentence, which this slice must not reword.
  it("keeps the FE-001 empty sentence", async () => {
    renderList();

    expect(
      await screen.findByText("No projects yet. Add a folder to start a session."),
    ).toBeInTheDocument();
  });

  // Verify a failed load stays brief and offers one more attempt, with no technical detail.
  it("offers Try again after a failed load", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockRejectedValue(
      new IpcCallError("list_projects", { code: "persistenceFailed" }),
    );

    renderList();

    expect(await screen.findByText("Couldn't load projects.")).toBeInTheDocument();
    expect(screen.queryByText(/persistenceFailed/)).not.toBeInTheDocument();

    listProjectsMock.mockResolvedValue([XWORK]);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "xwork" })).toBeInTheDocument();
    expect(listProjectsMock).toHaveBeenCalledTimes(2);
  });

  // Verify the rows follow the exact order the backend returned.
  it("renders the rows in backend order", async () => {
    listProjectsMock.mockResolvedValue([PINNED, XWORK, BROKEN]);

    renderList();
    await screen.findByRole("link", { name: /recipe-api/ });

    expect(readRowNames()).toEqual(["recipe-api", "xwork", "invoice-tool"]);
  });
});

describe("SidebarProjectList rows", () => {
  // Verify a row navigates to the project overview and calls no command on the way.
  it("navigates to the project without calling a command", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);

    renderList();
    const row = await screen.findByRole("link", { name: "xwork" });

    expect(row).toHaveAttribute("href", "/projects/3f2a");

    await user.click(row);

    expect(listProjectsMock).toHaveBeenCalledOnce();
    expect(addProjectMock).not.toHaveBeenCalled();
  });

  // Verify only the open project is marked as the current page.
  it("marks exactly the open project as the current page", async () => {
    listProjectsMock.mockResolvedValue([PINNED, XWORK]);

    renderList("/projects/3f2a");
    const open = await screen.findByRole("link", { name: "xwork" });

    expect(open).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /recipe-api/ })).not.toHaveAttribute("aria-current");
  });

  // Verify both status markers are announced as hidden text, since a non-interactive glyph
  // cannot host a tooltip a keyboard user could reach.
  it("announces the pin and availability markers as hidden text", async () => {
    listProjectsMock.mockResolvedValue([PINNED, BROKEN, XWORK]);

    renderList();
    await screen.findByRole("link", { name: /recipe-api/ });

    expect(screen.getByText("Pinned")).toHaveClass("sr-only");
    expect(screen.getByText("Folder unavailable")).toHaveClass("sr-only");
  });

  // Verify an unusable root reports that fact rather than its pin state, because one badge
  // has to carry the marker that changes what the user can do next.
  it("prefers the availability marker over the pin marker", async () => {
    listProjectsMock.mockResolvedValue([{ ...BROKEN, isPinned: true }]);

    renderList();
    await screen.findByRole("link", { name: /invoice-tool/ });

    expect(screen.getByText("Folder unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  // Verify a row with no marker stays silent about both.
  it("renders no marker for a plain project", async () => {
    listProjectsMock.mockResolvedValue([XWORK]);

    renderList();
    await screen.findByRole("link", { name: "xwork" });

    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
    expect(screen.queryByText("Folder unavailable")).not.toBeInTheDocument();
  });

  // Verify the slice adds no session rows or expander to the sidebar.
  it("renders no session children", async () => {
    listProjectsMock.mockResolvedValue([XWORK]);

    renderList();
    await screen.findByRole("link", { name: "xwork" });

    expect(document.querySelector('[data-slot="sidebar-menu-sub"]')).toBeNull();
    expect(screen.queryByText("No sessions")).not.toBeInTheDocument();
  });
});

describe("SidebarProjectList Add Project", () => {
  // Verify the icon-only action explains itself, which §18 requires.
  it("offers a tooltip on the icon-only action", async () => {
    const user = userEvent.setup();
    renderList();

    await user.hover(screen.getByRole("button", { name: "Add Project" }));

    expect(await screen.findByRole("tooltip", { name: "Add Project" })).toBeInTheDocument();
  });

  // Verify the action starts the shared flow, locks itself while the picker is open, and hands
  // focus back to itself when the user cancels.
  it("starts the shared flow and restores its own focus on cancellation", async () => {
    const user = userEvent.setup();
    const picker = deferred<{ outcome: "cancelled" }>();
    addProjectMock.mockReturnValue(picker.promise);
    renderList();

    const action = screen.getByRole("button", { name: "Add Project" });
    await user.click(action);

    expect(addProjectMock).toHaveBeenCalledOnce();
    await waitFor(() => expect(action).toBeDisabled());

    picker.resolve({ outcome: "cancelled" });

    await waitFor(() => expect(action).toBeEnabled());
    await waitFor(() => expect(action).toHaveFocus());
  });

  // Verify two mounted consumers of the shared flow still open exactly one picker, which is
  // the whole reason the lock lives in the store.
  it("opens one picker for two mounted entry points", async () => {
    const user = userEvent.setup();
    const picker = deferred<{ outcome: "cancelled" }>();
    addProjectMock.mockReturnValue(picker.promise);
    renderList();
    renderList();

    const [first, second] = screen.getAllByRole("button", { name: "Add Project" });
    if (first === undefined || second === undefined) {
      throw new Error("Both Add Project entry points should be rendered.");
    }

    await user.click(first);
    await user.click(second);

    expect(addProjectMock).toHaveBeenCalledOnce();
    expect(second).toBeDisabled();

    picker.resolve({ outcome: "cancelled" });
    await waitFor(() => expect(first).toBeEnabled());
  });
});

describe("SidebarProjectList session composition", () => {
  /** Build the block with a session-row slot and an active project chosen by the case. */
  function slotTree(activeProjectId: string | null, path: string) {
    return (
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>
          <SidebarProvider>
            <Sidebar collapsible="icon">
              <SidebarContent>
                <SidebarProjectList
                  activeProjectId={activeProjectId}
                  renderSessionRows={(project) => (
                    <p data-testid={`slot-${project.id}`}>rows for {project.displayName}</p>
                  )}
                />
              </SidebarContent>
            </Sidebar>
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    );
  }

  /** Render the block with a session-row slot at one router entry. */
  function renderWithSlot(activeProjectId: string | null = null, path = "/") {
    return render(slotTree(activeProjectId, path));
  }

  // Verify a project row starts collapsed and renders no child rows.
  it("starts collapsed", async () => {
    listProjectsMock.mockResolvedValue([XWORK]);

    renderWithSlot();
    await screen.findByRole("link", { name: "xwork" });

    expect(screen.getByRole("button", { name: "Sessions for xwork" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByTestId("slot-3f2a")).not.toBeInTheDocument();
  });

  // Verify the chevron opens and closes the child rows without navigating anywhere.
  it("toggles the child rows with a pointer", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);

    renderWithSlot();
    const chevron = await screen.findByRole("button", { name: "Sessions for xwork" });

    await user.click(chevron);

    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("slot-3f2a")).toHaveTextContent("rows for xwork");
    expect(screen.getByRole("link", { name: "xwork" })).not.toHaveAttribute("aria-current");

    await user.click(chevron);

    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("slot-3f2a")).not.toBeInTheDocument();
  });

  // Verify the chevron is reachable and operable from the keyboard alone.
  it("toggles the child rows from the keyboard", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);

    renderWithSlot();
    const chevron = await screen.findByRole("button", { name: "Sessions for xwork" });
    chevron.focus();

    await user.keyboard("{Enter}");
    expect(chevron).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  // Verify expansion is per project, so opening one row leaves the others closed.
  it("expands each project independently", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK, PINNED]);

    renderWithSlot();
    await screen.findByRole("link", { name: "xwork" });

    await user.click(screen.getByRole("button", { name: "Sessions for xwork" }));

    expect(screen.getByTestId("slot-3f2a")).toBeInTheDocument();
    expect(screen.queryByTestId("slot-9b1c")).not.toBeInTheDocument();
  });

  // Verify the slot receives the project of its own row rather than a shared value.
  it("hands each slot its own project", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK, PINNED]);

    renderWithSlot();
    await screen.findByRole("link", { name: "xwork" });

    await user.click(screen.getByRole("button", { name: "Sessions for xwork" }));
    await user.click(screen.getByRole("button", { name: "Sessions for recipe-api" }));

    expect(screen.getByTestId("slot-3f2a")).toHaveTextContent("rows for xwork");
    expect(screen.getByTestId("slot-9b1c")).toHaveTextContent("rows for recipe-api");
  });

  // Verify activating the project name both navigates and opens that project's sessions,
  // which is what §7.5 asks a project row to do.
  it("opens the sessions of a project whose name is activated", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK]);

    renderWithSlot();
    await user.click(await screen.findByRole("link", { name: "xwork" }));

    expect(screen.getByTestId("slot-3f2a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sessions for xwork" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // Verify the project of the current route is open on the first render, so the active
  // session can never be hidden inside a collapsed row.
  it("forces the active project open", async () => {
    listProjectsMock.mockResolvedValue([XWORK, PINNED]);

    renderWithSlot("3f2a", "/sessions/s1");
    await screen.findByRole("link", { name: "xwork" });

    expect(screen.getByTestId("slot-3f2a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sessions for xwork" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.queryByTestId("slot-9b1c")).not.toBeInTheDocument();
  });

  // Verify a row the user opened by hand stays open after the route moves to another project.
  it("keeps an explicitly opened row open when the active project changes", async () => {
    const user = userEvent.setup();
    listProjectsMock.mockResolvedValue([XWORK, PINNED]);

    const view = render(slotTree(null, "/"));
    await screen.findByRole("link", { name: "xwork" });
    await user.click(screen.getByRole("button", { name: "Sessions for xwork" }));

    view.rerender(slotTree("9b1c", "/"));

    expect(screen.getByTestId("slot-3f2a")).toBeInTheDocument();
    expect(screen.getByTestId("slot-9b1c")).toBeInTheDocument();
  });

  // Verify the block behaves exactly as it did before FE-006 when no slot is supplied.
  it("renders no chevron and no child rows without a slot", async () => {
    listProjectsMock.mockResolvedValue([XWORK]);

    renderList();
    await screen.findByRole("link", { name: "xwork" });

    expect(screen.queryByRole("button", { name: "Sessions for xwork" })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="sidebar-menu-sub"]')).toBeNull();
  });
});
