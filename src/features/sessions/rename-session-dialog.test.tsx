// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummaryDto } from "@/bindings/sessions/sessions";
import type { SessionsFailure } from "@/lib/utils/session-copy";
import { RenameSessionDialog } from "./rename-session-dialog";
import { createSessionSummary } from "./sessions-test-fixture";

/** Intents recorded by every case. */
const onCancel = vi.fn();
const onSubmit = vi.fn();
const onClosed = vi.fn();

/** Render the dialog open for one session with the state a case chooses. */
function renderDialog(
  options: {
    session?: SessionSummaryDto | null;
    isPending?: boolean;
    failure?: SessionsFailure | null;
  } = {},
) {
  return render(
    <RenameSessionDialog
      session={options.session === undefined ? createSessionSummary() : options.session}
      isPending={options.isPending ?? false}
      failure={options.failure ?? null}
      onCancel={onCancel}
      onSubmit={onSubmit}
      onClosed={onClosed}
    />,
  );
}

/**
 * Host that opens the dialog from a real control, so the focus the dialog gives up can be
 * observed landing back where the user pressed.
 */
function DialogHost() {
  const [isOpen, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Rename session
      </button>
      <RenameSessionDialog
        session={isOpen ? createSessionSummary() : null}
        isPending={false}
        failure={null}
        onCancel={() => setOpen(false)}
        onSubmit={() => setOpen(false)}
        onClosed={() => {
          document.querySelector<HTMLButtonElement>("button")?.focus();
        }}
      />
    </>
  );
}

beforeEach(() => {
  onCancel.mockReset();
  onSubmit.mockReset();
  onClosed.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RenameSessionDialog", () => {
  // Verify a `null` session keeps the dialog closed entirely.
  it("renders nothing without a session", () => {
    renderDialog({ session: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Verify the field starts from the current name, fully selected, so typing replaces it in
  // one keystroke instead of appending to it.
  it("prefills and selects the current name", async () => {
    renderDialog({ session: createSessionSummary({ name: "Docs review" }) });

    const input = await screen.findByLabelText<HTMLInputElement>("Session name");
    expect(input).toHaveValue("Docs review");
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Docs review".length);
  });

  // Verify the rule is shown and the command blocked for a whitespace-only name.
  it("blocks a whitespace-only name", async () => {
    const user = userEvent.setup();
    renderDialog();

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "   ");

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(
      screen.getByText("Use 1 to 80 characters without control characters."),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  // Verify the boundary is measured in Unicode scalar values, so an astral emoji counts once
  // and a name of exactly eighty of them is still accepted.
  it("accepts exactly 80 scalar values", async () => {
    const user = userEvent.setup();
    renderDialog();

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.paste("😀".repeat(80));

    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  // Verify one scalar value past the limit is refused before any command is sent.
  it("blocks 81 scalar values", async () => {
    const user = userEvent.setup();
    renderDialog();

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.paste("😀".repeat(81));

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Verify a duplicate name is valid, because BE-005 accepts it and stays authoritative.
  it("allows the unchanged name", async () => {
    const user = userEvent.setup();
    renderDialog({ session: createSessionSummary({ name: "Docs review" }) });

    await user.click(await screen.findByRole("button", { name: "Rename" }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Docs review");
  });

  // Verify the trimmed value is what reaches the caller, from either submit path.
  it.each([
    ["the Rename button", false],
    ["the Enter key", true],
  ])("submits the trimmed name with %s", async (_label, useEnter) => {
    const user = userEvent.setup();
    renderDialog();

    const input = await screen.findByLabelText("Session name");
    await user.clear(input);
    await user.type(input, "  Renamed  ");

    if (useEnter) {
      await user.type(input, "{Enter}");
    } else {
      await user.click(screen.getByRole("button", { name: "Rename" }));
    }

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Renamed");
  });

  // Verify a running command locks the whole dialog, so nothing can be sent twice.
  it("locks its controls while the command runs", async () => {
    renderDialog({ isPending: true });

    expect(await screen.findByLabelText("Session name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Renaming…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  // Verify Escape cannot close the dialog while a command is still unanswered.
  it("ignores Escape while the command runs", async () => {
    const user = userEvent.setup();
    renderDialog({ isPending: true });
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
  });

  // Verify a backend failure is shown as an alert without closing the dialog.
  it("shows a backend failure", async () => {
    renderDialog({
      failure: {
        kind: "invalidName",
        code: "invalidName",
        message: "Use 1 to 80 characters without control characters.",
        canRetry: false,
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use 1 to 80 characters without control characters.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // Verify Cancel reports the intent without submitting anything.
  it("cancels without submitting", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // Verify the dialog hands focus back to the control that opened it, instead of letting
  // Radix drop it on the document body.
  it("returns focus to the control that opened it", async () => {
    const user = userEvent.setup();
    render(<DialogHost />);

    const opener = screen.getByRole("button", { name: "Rename session" });
    await user.click(opener);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await vi.waitFor(() => expect(opener).toHaveFocus());
  });
});
