// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloseImpactDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import type { SessionsFailure } from "@/lib/utils/session-copy";
import { DeleteSessionDialog } from "./delete-session-dialog";
import { createCloseImpact, createSessionSummary } from "./sessions-test-fixture";

/** Intents recorded by every case. */
const onCancel = vi.fn();
const onConfirm = vi.fn();
const onRetryImpact = vi.fn();
const onClosed = vi.fn();

/** Render the confirmation with the state a case chooses. */
function renderDialog(
  options: {
    session?: SessionSummaryDto | null;
    impact?: CloseImpactDto | null;
    isPending?: boolean;
    failure?: SessionsFailure | null;
  } = {},
) {
  return render(
    <DeleteSessionDialog
      session={options.session === undefined ? createSessionSummary() : options.session}
      impact={options.impact === undefined ? createCloseImpact() : options.impact}
      isPending={options.isPending ?? false}
      failure={options.failure ?? null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onRetryImpact={onRetryImpact}
      onClosed={onClosed}
    />,
  );
}

/** Build one classified failure of the shape the route's lifecycle hook publishes. */
function failure(overrides: Partial<SessionsFailure>): SessionsFailure {
  return {
    kind: "unknown",
    code: "contentLifecycleFailed",
    message: "XWork couldn't stop everything in this session.",
    canRetry: true,
    ...overrides,
  };
}

beforeEach(() => {
  onCancel.mockReset();
  onConfirm.mockReset();
  onRetryImpact.mockReset();
  onClosed.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("DeleteSessionDialog", () => {
  // Verify a `null` session keeps the dialog closed entirely.
  it("renders nothing without a session", () => {
    renderDialog({ session: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Verify the destructive label names the object and states what is lost.
  it("names the session and what deleting it destroys", async () => {
    renderDialog({ session: createSessionSummary({ name: "Debounce PTY resize" }) });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Delete session “Debounce PTY resize”?" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Everything in this session is stopped and removed: its tabs, panes and terminal output. This cannot be undone.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete Session" })).toBeInTheDocument();
  });

  // Verify a session with no measured blocker still asks, and renders no fact row at all.
  it("renders no facts box for an empty impact", async () => {
    renderDialog();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
  });

  // Verify an impact the backend says needs no confirmation still opens the dialog, because
  // the output and layout it destroys are not recoverable either way.
  it("still asks when the backend requires no confirmation", async () => {
    renderDialog({ impact: createCloseImpact({ requiresConfirmation: false }) });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // Verify one blocker of each family reads in the singular.
  it("states single blockers in the singular", async () => {
    renderDialog({
      impact: createCloseImpact({
        runningProcessCount: 1,
        runningProcessLabels: ["claude"],
        unsavedFileCount: 1,
        unsavedFileLabels: ["README.md"],
      }),
    });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("1 running process will be stopped: claude"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("1 file with unsaved changes: README.md")).toBeInTheDocument();
  });

  // Verify several blockers read in the plural with every label named.
  it("states several blockers in the plural", async () => {
    renderDialog({
      impact: createCloseImpact({
        runningProcessCount: 2,
        runningProcessLabels: ["claude", "pnpm test"],
        unsavedFileCount: 3,
        unsavedFileLabels: ["a.md", "b.md", "c.md"],
      }),
    });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("2 running processes will be stopped: claude, pnpm test"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("3 files with unsaved changes: a.md, b.md, c.md"),
    ).toBeInTheDocument();
  });

  // Verify a zero count renders no row even while the other family has one.
  it("renders no row for a zero count", async () => {
    renderDialog({
      impact: createCloseImpact({ runningProcessCount: 1, runningProcessLabels: ["claude"] }),
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(within(dialog).queryByText(/unsaved changes/)).not.toBeInTheDocument();
  });

  // Verify a long label list is capped and its remainder summarized, while the count stays
  // the backend's own.
  it("caps the label list and reports the remainder", async () => {
    renderDialog({
      impact: createCloseImpact({
        runningProcessCount: 7,
        runningProcessLabels: ["a", "b", "c", "d", "e", "f", "g"],
      }),
    });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("7 running processes will be stopped: a, b, c, d, e, +2 more"),
    ).toBeInTheDocument();
  });

  // Verify cancelling never sends the destructive command.
  it("cancels without confirming", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Verify the destructive button raises exactly one confirmation intent.
  it("confirms the deletion", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Delete Session" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  // Verify a running close locks both controls and cannot be escaped.
  it("locks its controls while the close runs", async () => {
    const user = userEvent.setup();
    renderDialog({ isPending: true });

    expect(await screen.findByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Verify a repeated confirmation keeps the destructive label, so the user has to agree to
  // the refreshed consequences with the same deliberate press.
  it("keeps the destructive label after confirmationRequired", async () => {
    renderDialog({
      impact: createCloseImpact({ runningProcessCount: 1, runningProcessLabels: ["claude"] }),
      failure: failure({
        kind: "busy",
        code: "confirmationRequired",
        message: "Confirm again to delete this session.",
        canRetry: false,
      }),
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Confirm again to delete this session.",
    );
    expect(within(dialog).getByRole("button", { name: "Delete Session" })).toBeEnabled();
  });

  // Verify a cleanup failure turns the same button into a second attempt.
  it("offers a second attempt after a cleanup failure", async () => {
    const user = userEvent.setup();
    renderDialog({ failure: failure({}) });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "XWork couldn't stop everything in this session.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Try again" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  // Verify a failed impact read offers the impact read again rather than a blind delete.
  it("offers the impact read again when no facts could be measured", async () => {
    const user = userEvent.setup();
    renderDialog({
      impact: null,
      failure: failure({ message: "XWork couldn't check what this session is running." }),
    });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).queryByRole("button", { name: "Delete Session" }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Try again" }));

    expect(onRetryImpact).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Verify a close the runtime already started cannot be pressed again.
  it("locks the destructive button while the session is already closing", async () => {
    renderDialog({
      failure: failure({
        kind: "busy",
        code: "closeInProgress",
        message: "This session is closing.",
        canRetry: false,
      }),
    });

    expect(await screen.findByRole("button", { name: "Delete Session" })).toBeDisabled();
  });

  // Verify the dialog reports that it gave up focus, which is how the route hands focus back.
  it("reports that it gave up focus", async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(
      <DeleteSessionDialog
        session={null}
        impact={null}
        isPending={false}
        failure={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
        onRetryImpact={onRetryImpact}
        onClosed={onClosed}
      />,
    );

    await vi.waitFor(() => expect(onClosed).toHaveBeenCalled());
  });
});
