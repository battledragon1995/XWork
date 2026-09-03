// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InvalidProjectFolderReasonDto,
  ProjectDto,
  ProjectFolderSelectionDto,
  ProjectsError,
} from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { addProject } from "@/lib/ipc/projects";
import { HomePlaceholder } from "./home-placeholder";
import { WelcomeScreen } from "./welcome-screen";

// Replace the shared Projects adapter so no test opens a native picker or writes a project.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(),
}));

const addProjectMock = vi.mocked(addProject);

/** The project the backend reports after a successful folder selection. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

/** Copy shared by every unrecoverable failure of this slice. */
const INTEGRATION_MESSAGE = "XWork ran into a problem it cannot recover from. Restart XWork.";

/** Stand in for the Project Overview route so navigation is observable. */
function ProjectProbe() {
  const { projectId } = useParams();

  return <p>Opened project {projectId}</p>;
}

/** Render Welcome inside the router and tooltip context the application provides. */
function renderWelcome() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<WelcomeScreen />} />
          <Route path="/projects/:projectId" element={<ProjectProbe />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** Reject the next `add_project` call with one tagged backend error. */
function rejectWith(error: ProjectsError): void {
  addProjectMock.mockRejectedValue(new IpcCallError<ProjectsError>("add_project", error));
}

/** Read the primary action, whatever label it currently shows. */
function primaryButton(): HTMLElement {
  return screen.getByRole("button", { name: /Add Project|Selecting folder…/ });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("WelcomeScreen content", () => {
  // Verify every piece of wireframe copy is present with its exact wording.
  it("renders the first-run copy from the wireframe", () => {
    renderWelcome();

    expect(screen.getByText("First run")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Every project, every CLI, one window." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "XWork keeps Codex, Claude and your terminal side by side, one workspace per project, without leaving the keyboard. Everything stays on this machine.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Quick Note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See keyboard shortcuts" })).toBeInTheDocument();
  });

  // Verify the wireframe hint about shortcuts that do not work yet is not rendered.
  it("omits the inactive shortcut hint", () => {
    renderWelcome();

    expect(screen.queryByText(/Ctrl K/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ctrl Shift N/)).not.toBeInTheDocument();
  });

  // Verify the illustration is decorative: hidden from assistive technology and unfocusable.
  it("renders the illustration as decoration only", () => {
    const { container } = renderWelcome();
    const art = container.querySelector('[data-slot="welcome-art"]');

    expect(art).not.toBeNull();
    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(art).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  // Verify the illustration takes its colors from repository tokens rather than hex literals.
  it("paints the illustration with token-backed classes", () => {
    const { container } = renderWelcome();
    const art = container.querySelector('[data-slot="welcome-art"]');

    expect(art?.outerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  // Verify the responsive rules of the spec: one column and reduced padding below 900px,
  // two columns and the hidden illustration above it.
  it("switches to one column and hides the art below 900px", () => {
    const { container } = renderWelcome();
    const grid = container.querySelector('[data-slot="welcome-grid"]');
    const artColumn = container.querySelector('[data-slot="welcome-art-column"]');

    expect(grid?.className).toContain("grid-cols-1");
    expect(grid?.className).toContain("px-12");
    expect(grid?.className).toContain("@min-[900px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]");
    expect(grid?.className).toContain("@min-[900px]:px-24");
    expect(artColumn?.className).toContain("hidden");
    expect(artColumn?.className).toContain("@min-[900px]:flex");
  });
});

describe("WelcomeScreen keyboard access", () => {
  // Verify the documented tab order, and that nothing steals focus on mount.
  it("does not auto-focus and follows the documented tab order", async () => {
    const user = userEvent.setup();
    renderWelcome();

    expect(document.body).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Add Project" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Open Quick Note" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "See keyboard shortcuts" })).toHaveFocus();
  });

  // Verify both unavailable controls stay reachable instead of being removed from the tab
  // order, because their tooltip is the only explanation a keyboard user can reach.
  it.each([
    ["Open Quick Note", "Quick Note arrives with FE-020."],
    ["See keyboard shortcuts", "Keyboard shortcuts arrive with FE-014."],
  ])("keeps %s focusable and explained by a tooltip", async (name, tooltip) => {
    const user = userEvent.setup();
    renderWelcome();
    const control = screen.getByRole("button", { name });

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).not.toBeDisabled();

    await user.hover(control);
    expect((await screen.findAllByText(tooltip)).length).toBeGreaterThan(0);

    await user.unhover(control);
    act(() => {
      control.focus();
    });
    expect((await screen.findAllByText(tooltip)).length).toBeGreaterThan(0);
  });

  // Verify an unavailable control performs no action through any of its activation paths.
  it.each([["Open Quick Note"], ["See keyboard shortcuts"]])(
    "makes %s inert on click, Enter and Space",
    async (name) => {
      const user = userEvent.setup();
      renderWelcome();
      const control = screen.getByRole("button", { name });

      await user.click(control);
      act(() => {
        control.focus();
      });
      await user.keyboard("{Enter}");
      await user.keyboard(" ");

      expect(addProjectMock).not.toHaveBeenCalled();
      expect(control).toHaveFocus();
      expect(screen.queryByText(/Opened project/)).not.toBeInTheDocument();
    },
  );
});

describe("Add Project flow", () => {
  // Verify the pending state locks the primary action and renames it, and that a fast double
  // click can still only open one native picker.
  it("locks the primary action while the picker is open", async () => {
    let resolveSelection!: (value: ProjectFolderSelectionDto) => void;
    addProjectMock.mockReturnValue(
      new Promise<ProjectFolderSelectionDto>((resolve) => {
        resolveSelection = resolve;
      }),
    );
    renderWelcome();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Project" }));
      fireEvent.click(primaryButton());
    });

    expect(addProjectMock).toHaveBeenCalledTimes(1);
    const pendingButton = screen.getByRole("button", { name: "Selecting folder…" });
    expect(pendingButton).toBeDisabled();

    await act(async () => {
      resolveSelection({ outcome: "cancelled" });
    });

    expect(screen.getByRole("button", { name: "Add Project" })).toBeEnabled();
  });

  // Verify a cancelled picker leaves no trace and hands focus back to the button that
  // started the flow, which the native dialog took focus away from.
  it("returns to the untouched screen and restores focus after cancellation", async () => {
    const user = userEvent.setup();
    addProjectMock.mockResolvedValue({ outcome: "cancelled" });
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Project" })).toHaveFocus();
  });

  // Verify a selected folder navigates straight to the new project's overview route.
  it("navigates to the new project after a successful selection", async () => {
    const user = userEvent.setup();
    addProjectMock.mockResolvedValue({ outcome: "selected", project: PROJECT });
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(screen.getByText("Opened project 3f2a")).toBeInTheDocument();
  });

  // Verify every retryable failure shows its own message and unlocks the primary action.
  it.each<[string, ProjectsError, string]>([
    [
      "folderPickerFailed",
      { code: "folderPickerFailed" },
      "XWork couldn't open the folder picker. Try again.",
    ],
    [
      "invalidDisplayName",
      { code: "invalidDisplayName" },
      "XWork couldn't use that folder's name. Pick a different folder.",
    ],
    ["clockFailed", { code: "clockFailed" }, "XWork couldn't save the project. Try again."],
    [
      "persistenceFailed",
      { code: "persistenceFailed" },
      "XWork couldn't save the project. Try again.",
    ],
  ])("reports %s with its own message", async (_label, error, message) => {
    const user = userEvent.setup();
    rejectWith(error);
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Add Project" })).toBeEnabled();
  });

  // Verify all seven generated invalid-folder reasons map to the documented copy.
  it.each<[InvalidProjectFolderReasonDto, string]>([
    ["missing", "That folder no longer exists. Pick another folder."],
    ["notDirectory", "That path is a file, not a folder. Pick a folder."],
    ["fileSystemRoot", "A drive root can't be a project. Pick a folder inside it."],
    ["accessDenied", "XWork can't read that folder. Check its permissions or pick another folder."],
    ["notAbsolute", "XWork can't use that folder's path. Pick another folder."],
    ["notUtf8", "XWork can't use that folder's path. Pick another folder."],
    ["cannotCanonicalize", "XWork can't use that folder's path. Pick another folder."],
  ])("explains the %s invalid-folder reason", async (reason, message) => {
    const user = userEvent.setup();
    rejectWith({ code: "invalidProjectFolder", reason });
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  // Verify a duplicate folder offers a way to the project that already owns it, using the
  // snake_case identifier the generated binding declares.
  it("offers to open the existing project when the folder is already registered", async () => {
    const user = userEvent.setup();
    rejectWith({ code: "projectAlreadyExists", project_id: "3f2a" });
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("That folder is already a project in XWork.");

    await user.click(within(alert).getByRole("button", { name: "Open project" }));

    expect(screen.getByText("Opened project 3f2a")).toBeInTheDocument();
  });

  // Verify the recovery action of a failure sits immediately after the primary action, so a
  // keyboard user meets it before the two unavailable controls.
  it("places the failure action immediately after Add Project", async () => {
    const user = userEvent.setup();
    rejectWith({ code: "projectAlreadyExists", project_id: "3f2a" });
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    act(() => {
      screen.getByRole("button", { name: "Add Project" }).focus();
    });
    await user.tab();
    expect(screen.getByRole("button", { name: "Open project" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Open Quick Note" })).toHaveFocus();
  });

  // Verify unrecoverable failures state that plainly and offer no retry affordance.
  it.each<[string, ProjectsError | null]>([
    ["unauthorizedWindow", { code: "unauthorizedWindow" }],
    ["an unrecognized payload", null],
  ])("reports %s as unrecoverable", async (_label, error) => {
    const user = userEvent.setup();
    if (error === null) {
      addProjectMock.mockRejectedValue(new IpcCallError<ProjectsError>("add_project", null));
    } else {
      rejectWith(error);
    }
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(screen.getByRole("alert")).toHaveTextContent(INTEGRATION_MESSAGE);
    expect(screen.queryByRole("button", { name: "Open project" })).not.toBeInTheDocument();
  });

  // Verify a new attempt clears the previous failure instead of stacking messages.
  it("clears the previous failure when the next attempt starts", async () => {
    const user = userEvent.setup();
    rejectWith({ code: "folderPickerFailed" });
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Add Project" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    addProjectMock.mockResolvedValue({ outcome: "cancelled" });
    await user.click(screen.getByRole("button", { name: "Add Project" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("HomePlaceholder", () => {
  // Verify the branch shown once a project exists keeps the copy the shell used before, so
  // replacing the route element changes no observable behavior for existing users.
  it("keeps the Home area copy unchanged", () => {
    render(<HomePlaceholder />);

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("This area arrives with FE-003.")).toBeInTheDocument();
  });
});
