// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDto } from "@/bindings/projects/projects";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import { isValidDisplayName, RenameProjectDialog } from "./rename-project-dialog";
import { resetProjectsStore, useProjectsStore } from "./projects-store";
import { useProjectActions } from "./use-project-actions";

// Replace the backend boundary so no case reaches Tauri or a real project.
vi.mock("@/lib/ipc/projects", () => ({
  addProject: vi.fn(),
  getRemoveProjectImpact: vi.fn(),
  listProjects: vi.fn(async () => []),
  locateProjectFolder: vi.fn(),
  onProjectsChanged: vi.fn(async () => () => {}),
  openProjectFolder: vi.fn(),
  removeProject: vi.fn(),
  renameProject: vi.fn(),
  setProjectPinned: vi.fn(),
}));

const renameProjectMock = vi.mocked(projectsIpc.renameProject);

/** One registered project used wherever the exact field values do not matter. */
const PROJECT: ProjectDto = {
  id: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  isPinned: false,
  addedAtMs: 1_700_000_000_000,
  lastOpenedAtMs: 1_700_000_000_000,
  availability: { status: "available" },
};

// Build one promise a case can settle by hand, which is how the pending phase is observed.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });

  return { promise, resolve, reject };
}

// Render the dialog with props the case controls directly, for the pure interface branches.
function renderControlled(
  overrides: Partial<React.ComponentProps<typeof RenameProjectDialog>> = {},
) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <TooltipProvider>
      <RenameProjectDialog
        project={PROJECT}
        isPending={false}
        failure={null}
        onCancel={onCancel}
        onSubmit={onSubmit}
        {...overrides}
      />
    </TooltipProvider>,
  );

  return { onSubmit, onCancel };
}

/**
 * Wire the dialog to the real action hook behind one trigger, so the backend branches and the
 * focus hand-back are exercised the way the route composes them.
 */
function RenameHarness() {
  const actions = useProjectActions();

  return (
    <TooltipProvider>
      <button type="button" onClick={() => actions.openRename(PROJECT)}>
        More actions
      </button>
      <RenameProjectDialog
        project={actions.renameTarget}
        isPending={actions.pendingOperation === "rename"}
        failure={actions.failure}
        onCancel={actions.closeRename}
        onSubmit={(displayName) => void actions.rename(PROJECT.id, displayName)}
      />
      <p data-testid="page-error">{actions.failure?.message ?? ""}</p>
    </TooltipProvider>
  );
}

beforeEach(() => {
  resetProjectsStore();
  vi.clearAllMocks();
  useProjectsStore.setState({ projects: [PROJECT], status: "ready", refresh: vi.fn() });
  renameProjectMock.mockResolvedValue(PROJECT);
});

afterEach(() => {
  cleanup();
});

describe("isValidDisplayName", () => {
  // Verify the front-end rules match the backend's, so an invalid name never round-trips.
  it.each([
    ["a plain name", "XWork", true],
    ["a padded name", "  XWork  ", true],
    ["255 scalar values", "a".repeat(255), true],
    ["255 astral scalar values", "😀".repeat(255), true],
    ["an empty string", "", false],
    ["whitespace only", "   ", false],
    ["256 scalar values", "a".repeat(256), false],
    ["256 astral scalar values", "😀".repeat(256), false],
    ["a control character", "XW\u0001ork", false],
  ])("accepts %s: %s", (_label, value, expected) => {
    expect(isValidDisplayName(value)).toBe(expected);
  });
});

describe("RenameProjectDialog content", () => {
  // Verify the dialog states exactly what it changes, so nobody expects the folder to move.
  it("shows the documented title and description", () => {
    renderControlled();

    expect(screen.getByRole("heading", { name: "Rename project" })).toBeInTheDocument();
    expect(
      screen.getByText("This changes the name in XWork only. The folder keeps its own name."),
    ).toBeInTheDocument();
  });

  // Verify the field opens prefilled, focused and fully selected, so typing replaces the name.
  it("prefills, focuses and selects the current name", () => {
    renderControlled();

    const input = screen.getByLabelText("Display name") as HTMLInputElement;

    expect(input).toHaveValue("xwork");
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("xwork".length);
  });
});

describe("RenameProjectDialog validation", () => {
  // Verify no invalid or pointless name can be submitted, and that the requirement is shown.
  it.each([
    ["the unchanged name", "xwork", false],
    ["the unchanged name with padding", "  xwork  ", false],
    ["an empty name", "", true],
    ["a whitespace-only name", "   ", true],
    ["a too-long name", "a".repeat(256), true],
  ])("disables Rename for %s", async (_label, next, expectsHint) => {
    const user = userEvent.setup();
    const { onSubmit } = renderControlled();
    const input = screen.getByLabelText("Display name");

    await user.clear(input);
    if (next !== "") {
      await user.type(input, next);
    }

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();

    const hint = screen.queryByText(
      "Enter a name between 1 and 255 characters, without control characters.",
    );
    expect(hint === null).toBe(!expectsHint);

    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Verify a valid change submits the trimmed value, both by button and by Enter.
  it.each([
    ["the Rename button", "button" as const],
    ["the Enter key", "enter" as const],
  ])("submits the trimmed name with %s", async (_label, how) => {
    const user = userEvent.setup();
    const { onSubmit } = renderControlled();
    const input = screen.getByLabelText("Display name");

    await user.clear(input);
    await user.type(input, "  XWork  ");

    if (how === "button") {
      await user.click(screen.getByRole("button", { name: "Rename" }));
    } else {
      await user.keyboard("{Enter}");
    }

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("XWork");
  });
});

describe("RenameProjectDialog pending state", () => {
  // Verify the running command is visible and the dialog cannot be dismissed under it.
  it("renames the confirm button and blocks every exit", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderControlled({ isPending: true });

    expect(screen.getByRole("button", { name: "Renaming…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Rename project" })).toBeInTheDocument();
  });

  // Verify Esc closes the dialog while nothing is running.
  it("closes on Escape while idle", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderControlled();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("RenameProjectDialog backend branches", () => {
  // Verify a rejected name keeps the dialog open with the backend's own message inline, so
  // the user can correct the value without losing what they typed.
  it("keeps the dialog open and shows invalidDisplayName inline", async () => {
    renameProjectMock.mockRejectedValue(
      new IpcCallError("rename_project", { code: "invalidDisplayName" }),
    );
    const user = userEvent.setup();
    render(<RenameHarness />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "XWork");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(screen.getByRole("heading", { name: "Rename project" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a name between 1 and 255 characters, without control characters.",
    );
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  // Verify a project that vanished closes the dialog and moves its message to the page, since
  // there is nothing left to rename.
  it("closes the dialog for projectNotFound", async () => {
    renameProjectMock.mockRejectedValue(
      new IpcCallError("rename_project", { code: "projectNotFound", project_id: "3f2a" }),
    );
    const user = userEvent.setup();
    render(<RenameHarness />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "XWork");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(
      await screen.findByText("xwork is no longer in XWork.", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rename project" })).not.toBeInTheDocument();
  });

  // Verify a successful rename sends the trimmed name once and closes the dialog. Where focus
  // lands afterwards belongs to the route, which owns the card trigger refs.
  it("closes on success", async () => {
    const user = userEvent.setup();
    render(<RenameHarness />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "XWork");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(renameProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a", "XWork");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Rename project" })).not.toBeInTheDocument(),
    );
  });

  // Verify cancelling closes the dialog and calls no command at all.
  it("closes on cancel without calling a command", async () => {
    const user = userEvent.setup();
    render(<RenameHarness />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(renameProjectMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Rename project" })).not.toBeInTheDocument(),
    );
  });

  // Verify the pending phase really is driven by the command, not by a local flag.
  it("shows the pending label while the command runs", async () => {
    const pending = deferred<ProjectDto>();
    renameProjectMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<RenameHarness />);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const input = screen.getByLabelText("Display name");
    await user.clear(input);
    await user.type(input, "XWork");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(await screen.findByRole("button", { name: "Renaming…" })).toBeDisabled();

    pending.resolve(PROJECT);
  });
});
