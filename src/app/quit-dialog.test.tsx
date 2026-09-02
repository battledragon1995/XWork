// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuitRequestDto, QuitSummaryDto } from "@/bindings/app-lifecycle";
import { cancelQuit, confirmQuit, requestQuit } from "@/lib/ipc/app-lifecycle";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { QuitDialog } from "./quit-dialog";
import { resetQuitStore, useQuitStore } from "./quit-store";

// Replace the lifecycle boundary so no test reaches the real backend.
vi.mock("@/lib/ipc/app-lifecycle", () => ({
  requestQuit: vi.fn(),
  cancelQuit: vi.fn(),
  confirmQuit: vi.fn(),
}));

const requestQuitMock = vi.mocked(requestQuit);
const cancelQuitMock = vi.mocked(cancelQuit);
const confirmQuitMock = vi.mocked(confirmQuit);

// Build one pending request from the counts a case cares about.
function requestWith(summary: Partial<QuitSummaryDto>): QuitRequestDto {
  return {
    requestId: 7,
    summary: {
      sessionCount: 4,
      projectCount: 3,
      runningProcessCount: 3,
      unsavedFileCount: 1,
      ...summary,
    },
  };
}

// Open the dialog on a pending request without going through the backend.
async function openDialogWith(request: QuitRequestDto) {
  render(<QuitDialog />);
  await act(async () => {
    useQuitStore.getState().receiveTrayRequest(request);
  });

  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.resetAllMocks();
  resetQuitStore();
});

afterEach(() => {
  cleanup();
});

describe("QuitDialog content", () => {
  // Verify the dialog is closed while nothing is pending.
  it("renders nothing while the flow is idle", () => {
    render(<QuitDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Verify the warning copy matches the wireframe exactly.
  it("states the title, the warning and the background alternative", async () => {
    const dialog = await openDialogWith(requestWith({}));

    expect(within(dialog).getByRole("heading", { name: "Quit XWork?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Quitting stops every session. Sessions, tabs, panes and terminal output are not restored the next time XWork opens. Projects, notes, events and settings are kept.",
    );
    expect(dialog).toHaveTextContent(
      "To keep working in the background, close the window instead — XWork stays in the tray.",
    );
  });

  // Verify the plural forms of every documented count.
  it("renders the plural counts", async () => {
    const dialog = await openDialogWith(
      requestWith({
        sessionCount: 4,
        projectCount: 3,
        runningProcessCount: 3,
        unsavedFileCount: 2,
      }),
    );

    expect(within(dialog).getByText("4 sessions across 3 projects")).toBeInTheDocument();
    expect(within(dialog).getByText("3 running processes")).toBeInTheDocument();
    expect(within(dialog).getByText("2 files with unsaved changes")).toBeInTheDocument();
  });

  // Verify the singular forms of every documented count.
  it("renders the singular counts", async () => {
    const dialog = await openDialogWith(
      requestWith({
        sessionCount: 1,
        projectCount: 1,
        runningProcessCount: 1,
        unsavedFileCount: 1,
      }),
    );

    expect(within(dialog).getByText("1 session across 1 project")).toBeInTheDocument();
    expect(within(dialog).getByText("1 running process")).toBeInTheDocument();
    expect(within(dialog).getByText("1 file with unsaved changes")).toBeInTheDocument();
  });

  // Verify the unsaved-file line disappears at zero while both required lines stay.
  it("omits the unsaved-file line at zero and keeps the required lines", async () => {
    const dialog = await openDialogWith(
      requestWith({ runningProcessCount: 0, unsavedFileCount: 0 }),
    );

    expect(within(dialog).queryByText(/unsaved changes/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("4 sessions across 3 projects")).toBeInTheDocument();
    expect(within(dialog).getByText("0 running processes")).toBeInTheDocument();
  });

  // Verify both actions are present and Cancel holds the initial focus.
  it("offers Cancel and Quit with the initial focus on Cancel", async () => {
    const dialog = await openDialogWith(requestWith({}));

    expect(within(dialog).getByRole("button", { name: "Quit" })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
  });

  // Verify focus stays inside the dialog and moves from Cancel to Quit.
  it("traps focus and orders Cancel before Quit", async () => {
    const user = userEvent.setup();
    const dialog = await openDialogWith(requestWith({}));
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const quit = within(dialog).getByRole("button", { name: "Quit" });

    await waitFor(() => {
      expect(cancel).toHaveFocus();
    });
    await user.tab();

    expect(quit).toHaveFocus();

    await user.tab();

    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("QuitDialog actions", () => {
  // Verify Cancel drops the pending request exactly once with the identifier on display.
  it("cancels with the pending identifier", async () => {
    const user = userEvent.setup();
    cancelQuitMock.mockResolvedValue(undefined);
    const dialog = await openDialogWith(requestWith({}));

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(cancelQuitMock).toHaveBeenCalledExactlyOnceWith(7);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // Verify Escape is treated exactly like Cancel.
  it("treats Escape as Cancel", async () => {
    const user = userEvent.setup();
    cancelQuitMock.mockResolvedValue(undefined);
    await openDialogWith(requestWith({}));

    await user.keyboard("{Escape}");

    expect(cancelQuitMock).toHaveBeenCalledExactlyOnceWith(7);
  });

  // Verify interacting outside the dialog is treated exactly like Cancel. The pointer-events
  // check is disabled because Radix makes everything outside a modal dialog inert on purpose.
  it("treats an outside click as Cancel", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    cancelQuitMock.mockResolvedValue(undefined);
    await openDialogWith(requestWith({}));

    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    if (overlay === null) {
      throw new Error("The dialog overlay is missing.");
    }
    await user.click(overlay);

    await waitFor(() => {
      expect(cancelQuitMock).toHaveBeenCalledExactlyOnceWith(7);
    });
  });

  // Verify a fast double click cannot send two confirmations.
  it("confirms once even when Quit is clicked twice quickly", async () => {
    const user = userEvent.setup();
    confirmQuitMock.mockReturnValue(new Promise<void>(() => {}));
    const dialog = await openDialogWith(requestWith({}));
    const quit = within(dialog).getByRole("button", { name: "Quit" });

    await user.dblClick(quit);

    expect(confirmQuitMock).toHaveBeenCalledExactlyOnceWith(7);
  });

  // Verify the quitting state locks both actions and relabels the primary one.
  it("locks both actions while quitting", async () => {
    const user = userEvent.setup();
    confirmQuitMock.mockReturnValue(new Promise<void>(() => {}));
    const dialog = await openDialogWith(requestWith({}));

    await user.click(within(dialog).getByRole("button", { name: "Quit" }));

    const quitting = await within(dialog).findByRole("button", { name: "Quitting…" });

    expect(quitting).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

describe("QuitDialog failures", () => {
  // Verify a failed snapshot shows only the error and offers another attempt.
  it("shows the snapshot failure with a retry", async () => {
    requestQuitMock.mockRejectedValue(
      new IpcCallError("request_quit", { code: "runtime_snapshot_failed" }),
    );
    render(<QuitDialog />);

    await act(async () => {
      await useQuitStore.getState().startQuit();
    });

    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("Couldn't check what is still running. XWork stays open.");
    expect(within(dialog).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/sessions across/)).not.toBeInTheDocument();
  });

  // Verify the retry asks the backend for a fresh snapshot.
  it("retries the snapshot", async () => {
    const user = userEvent.setup();
    requestQuitMock.mockRejectedValue(
      new IpcCallError("request_quit", { code: "runtime_snapshot_failed" }),
    );
    render(<QuitDialog />);
    await act(async () => {
      await useQuitStore.getState().startQuit();
    });

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(requestQuitMock).toHaveBeenCalledTimes(2);
  });

  // Verify a failed cleanup keeps the numbers, states what happened and offers a retry.
  it("shows the shutdown failure and keeps the dialog open", async () => {
    const user = userEvent.setup();
    confirmQuitMock.mockRejectedValue(
      new IpcCallError("confirm_quit", { code: "runtime_shutdown_failed" }),
    );
    const dialog = await openDialogWith(requestWith({}));

    await user.click(within(dialog).getByRole("button", { name: "Quit" }));

    expect(
      await within(dialog).findByText("XWork couldn't stop everything, so nothing was closed."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(dialog).getByText("4 sessions across 3 projects")).toBeInTheDocument();
  });

  // Verify an integration failure closes the dialog and reports the unrecoverable state.
  it("closes the dialog on an integration failure", async () => {
    const user = userEvent.setup();
    confirmQuitMock.mockRejectedValue(
      new IpcCallError("confirm_quit", { code: "state_lock_poisoned" }),
    );
    const dialog = await openDialogWith(requestWith({}));

    await user.click(within(dialog).getByRole("button", { name: "Quit" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(useQuitStore.getState().phase).toBe("integration-failed");
  });
});
