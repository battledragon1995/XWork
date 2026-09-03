// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type {
  ProjectDto,
  RemoveProjectImpactDto,
  RemoveProjectResultDto,
} from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import * as projectsIpc from "@/lib/ipc/projects";
import { resetProjectsStore, useProjectsStore } from "./projects-store";
import { RemoveProjectDialog, removalFacts } from "./remove-project-dialog";
import { useProjectActions } from "./use-project-actions";

// Replace the backend boundary so no case can reach a real project or the filesystem.
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

const getRemoveProjectImpactMock = vi.mocked(projectsIpc.getRemoveProjectImpact);
const removeProjectMock = vi.mocked(projectsIpc.removeProject);

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

/** Impact with no runtime facts, which is what the Stage 4 runtime guard actually reports. */
const EMPTY_IMPACT: RemoveProjectImpactDto = {
  projectId: "3f2a",
  displayName: "xwork",
  rootPath: "D:\\Self\\XWork",
  sessionCount: 0,
  runningProcessCount: 0,
  unsavedFileCount: 0,
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
  overrides: Partial<React.ComponentProps<typeof RemoveProjectDialog>> = {},
) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <RemoveProjectDialog
      target={{ project: PROJECT, impact: EMPTY_IMPACT }}
      isPending={false}
      failure={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );

  return { onConfirm, onCancel };
}

/** Records that the route was told to move focus off the destroyed card. */
let onRemovedSpy: Mock<() => void>;

/**
 * Wire the dialog to the real action hook behind one trigger, so the impact read, the exact
 * removal arguments and every backend branch are exercised as the route composes them.
 */
function RemoveHarness() {
  const actions = useProjectActions({ onRemoved: onRemovedSpy });

  return (
    <>
      <button type="button" onClick={() => void actions.requestRemove(PROJECT)}>
        Remove Project
      </button>
      <RemoveProjectDialog
        target={actions.removeTarget}
        isPending={actions.pendingOperation === "remove"}
        failure={actions.failure}
        onCancel={actions.closeRemove}
        onConfirm={(projectId) => void actions.confirmRemove(projectId)}
      />
      <p data-testid="page-error">{actions.failure?.message ?? ""}</p>
    </>
  );
}

beforeEach(() => {
  resetProjectsStore();
  vi.clearAllMocks();
  onRemovedSpy = vi.fn<() => void>();
  useProjectsStore.setState({ projects: [PROJECT], status: "ready", refresh: vi.fn() });
  getRemoveProjectImpactMock.mockResolvedValue(EMPTY_IMPACT);
  removeProjectMock.mockResolvedValue({ projectId: "3f2a" });
});

afterEach(() => {
  cleanup();
});

describe("removalFacts", () => {
  // Verify a measured count of zero produces no line at all, so the dialog never pads itself
  // with consequences the backend did not report.
  it("returns nothing when every count is zero", () => {
    expect(removalFacts(EMPTY_IMPACT)).toEqual([]);
  });

  // Verify each count uses the singular form at exactly one.
  it("uses the singular form for one", () => {
    expect(
      removalFacts({
        ...EMPTY_IMPACT,
        sessionCount: 1,
        runningProcessCount: 1,
        unsavedFileCount: 1,
      }),
    ).toEqual([
      "1 session will be stopped first.",
      "1 running process will be stopped.",
      "1 file with unsaved changes will lose them.",
    ]);
  });

  // Verify each count uses the plural form above one, in the documented order.
  it("uses the plural form above one", () => {
    expect(
      removalFacts({
        ...EMPTY_IMPACT,
        sessionCount: 2,
        runningProcessCount: 3,
        unsavedFileCount: 4,
      }),
    ).toEqual([
      "2 sessions will be stopped first.",
      "3 running processes will be stopped.",
      "4 files with unsaved changes will lose them.",
    ]);
  });

  // Verify only the non-zero counts contribute, which is the Stage 8 mix this must survive.
  it("omits only the zero counts", () => {
    expect(removalFacts({ ...EMPTY_IMPACT, runningProcessCount: 2 })).toEqual([
      "2 running processes will be stopped.",
    ]);
  });
});

describe("RemoveProjectDialog content", () => {
  // Verify the title names the project and the body states plainly that nothing on disk moves.
  it("shows the exact title and reassurance", () => {
    renderControlled();

    expect(screen.getByRole("heading", { name: "Remove xwork from XWork?" })).toBeInTheDocument();
    // Read the whole description at once: the root path sits in its own `mono` element, so a
    // text query would only ever see the fragments around it.
    const description = document.querySelector('[data-slot="dialog-description"]');
    expect(description?.textContent?.replace(/\s+/g, " ")).toBe(
      "The folder D:\\Self\\XWork and every file in it stay exactly where they are. " +
        "XWork only forgets the project. Notes and events linked to it stay, unlinked.",
    );
    expect(screen.getByText("D:\\Self\\XWork")).toHaveClass("font-mono");
  });

  // Verify a zero-fact impact renders only the description, with no empty facts block.
  it("renders no facts block when nothing is running", () => {
    renderControlled();

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  // Verify measured facts appear as their own list, in the documented order.
  it("renders the measured facts", () => {
    renderControlled({
      target: {
        project: PROJECT,
        impact: { ...EMPTY_IMPACT, sessionCount: 2, unsavedFileCount: 1 },
      },
    });

    const facts = within(screen.getByRole("list")).getAllByRole("listitem");

    expect(facts.map((fact) => fact.textContent)).toEqual([
      "2 sessions will be stopped first.",
      "1 file with unsaved changes will lose them.",
    ]);
  });

  // Verify the dialog stays closed with no target, which is how the route keeps it hidden.
  it("renders nothing without a target", () => {
    renderControlled({ target: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("RemoveProjectDialog pending state", () => {
  // Verify the running removal is visible and neither exit works under it.
  it("renames the confirm button and blocks every exit", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderControlled({ isPending: true });

    expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Verify a cleanup failure turns the same control into a second attempt.
  it("offers Try again after a cleanup failure", () => {
    renderControlled({
      failure: {
        kind: "retryable",
        message: "XWork couldn't stop everything for xwork, so it was not removed.",
        retry: "remove",
      },
    });

    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "XWork couldn't stop everything for xwork, so it was not removed.",
    );
  });
});

describe("RemoveProjectDialog backend branches", () => {
  // Verify the confirmation is preceded by a real impact read and that removal is only ever
  // sent as an explicitly confirmed call.
  it("reads the impact first and confirms with confirmed set to true", async () => {
    const user = userEvent.setup();
    render(<RemoveHarness />);

    await user.click(screen.getByRole("button", { name: "Remove Project" }));
    expect(getRemoveProjectImpactMock).toHaveBeenCalledExactlyOnceWith("3f2a");

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove Project" }));

    expect(removeProjectMock).toHaveBeenCalledExactlyOnceWith("3f2a", true);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onRemovedSpy).toHaveBeenCalledOnce();
  });

  // Verify a re-confirmation request rebuilds the facts from its payload, so the user agrees
  // to what is true now rather than to what the dialog opened with.
  it("rebuilds the facts from confirmationRequired", async () => {
    removeProjectMock.mockRejectedValue(
      new IpcCallError("remove_project", {
        code: "confirmationRequired",
        impact: { ...EMPTY_IMPACT, sessionCount: 3 },
      }),
    );
    const user = userEvent.setup();
    render(<RemoveHarness />);

    await user.click(screen.getByRole("button", { name: "Remove Project" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove Project" }));

    expect(await screen.findByText("3 sessions will be stopped first.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onRemovedSpy).not.toHaveBeenCalled();
  });

  // Verify a cleanup failure keeps the project, keeps the dialog and allows another attempt.
  it("keeps the dialog open after runtimeCleanupFailed and can retry", async () => {
    removeProjectMock.mockRejectedValueOnce(
      new IpcCallError("remove_project", { code: "runtimeCleanupFailed" }),
    );
    const user = userEvent.setup();
    render(<RemoveHarness />);

    await user.click(screen.getByRole("button", { name: "Remove Project" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove Project" }));

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "XWork couldn't stop everything for xwork, so it was not removed.",
    );

    removeProjectMock.mockResolvedValue({ projectId: "3f2a" } satisfies RemoveProjectResultDto);
    await user.click(retry);

    expect(removeProjectMock).toHaveBeenCalledTimes(2);
    expect(removeProjectMock).toHaveBeenLastCalledWith("3f2a", true);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // Verify a failed impact read never opens the dialog, because confirming with missing facts
  // would ask the user to accept consequences XWork could not measure.
  it("never opens after a failed impact read", async () => {
    getRemoveProjectImpactMock.mockRejectedValue(
      new IpcCallError("get_remove_project_impact", { code: "runtimeInspectionFailed" }),
    );
    const user = userEvent.setup();
    render(<RemoveHarness />);

    await user.click(screen.getByRole("button", { name: "Remove Project" }));

    expect(await screen.findByTestId("page-error")).toHaveTextContent(
      "XWork couldn't check what is still running for xwork.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(removeProjectMock).not.toHaveBeenCalled();
  });

  // Verify cancelling calls no removal at all.
  it("closes on cancel without removing", async () => {
    const user = userEvent.setup();
    render(<RemoveHarness />);

    await user.click(screen.getByRole("button", { name: "Remove Project" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(removeProjectMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // Verify the pending phase is driven by the command rather than by a local flag.
  it("shows the pending label while the removal runs", async () => {
    const pending = deferred<RemoveProjectResultDto>();
    removeProjectMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<RemoveHarness />);

    await user.click(screen.getByRole("button", { name: "Remove Project" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove Project" }));

    expect(await screen.findByRole("button", { name: "Removing…" })).toBeDisabled();

    pending.resolve({ projectId: "3f2a" });
  });
});
