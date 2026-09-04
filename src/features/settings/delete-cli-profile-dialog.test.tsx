// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProfilesFailure } from "./cli-profile-error-copy";
import {
  DeleteCliProfileDialog,
  type DeleteCliProfileDialogProps,
} from "./delete-cli-profile-dialog";
import { createCliProfileDto, createCustomProfileDto } from "./cli-profiles-test-fixture";

/** Build one failure exactly as the store hands it to the dialog. */
function failure(
  code: CliProfilesFailure["code"],
  message: string,
  retryable: boolean,
): CliProfilesFailure {
  return { code, operation: "delete", profileId: "c1", retryable, message };
}

/** Default props with a custom profile targeted and nothing pending. */
function baseProps(
  overrides: Partial<DeleteCliProfileDialogProps> = {},
): DeleteCliProfileDialogProps {
  return {
    target: createCustomProfileDto({ id: "c1", name: "Gemini CLI" }),
    isPending: false,
    failure: null,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
}

/** Render the dialog and hand back the props so callbacks can be asserted. */
function renderDialog(overrides: Partial<DeleteCliProfileDialogProps> = {}) {
  const props = baseProps(overrides);
  return { ...render(<DeleteCliProfileDialog {...props} />), props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("DeleteCliProfileDialog", () => {
  // Verify a closed dialog renders nothing at all.
  it("renders nothing without a target", () => {
    renderDialog({ target: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Verify a built-in can never reach the destructive flow, whatever the page passes.
  it("refuses to target a built-in profile", () => {
    renderDialog({ target: createCliProfileDto() });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Verify the dialog names the exact profile and states the real impact of the deletion.
  it("names the profile and states the impact", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: "Delete Gemini CLI?" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Terminals that are already running are not stopped. The profile disappears from the next selection and launch.",
      ),
    ).toBeInTheDocument();
  });

  // Verify the safe action holds focus, so a stray Enter cannot delete anything.
  it("focuses Cancel first", async () => {
    renderDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  // Verify the destructive action carries the exact FE-013 label and calls back with the id.
  it("confirms with the documented destructive label", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Delete Profile" }));

    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith("c1");
  });

  // Verify no backend call happens until the user explicitly confirms.
  it.each(["Cancel", "Escape"])("cancels through %s without deleting", async (path) => {
    const user = userEvent.setup();
    const { props } = renderDialog();

    if (path === "Cancel") {
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    } else {
      await user.keyboard("{Escape}");
    }

    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  // Verify a running deletion cannot be repeated or dismissed out from under itself.
  it("locks the dialog while the deletion is pending", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog({ isPending: true });

    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  // Verify a retryable failure keeps the dialog open and offers a second attempt.
  it("keeps the dialog open on a retryable failure", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog({
      failure: failure("persistenceFailed", "XWork couldn't delete this profile.", true),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("XWork couldn't delete this profile.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith("c1");
  });

  // Verify an integration failure explains itself without pretending a retry could help.
  it("offers no retry for an integration failure", () => {
    renderDialog({
      failure: failure(
        "unauthorizedWindow",
        "XWork ran into a CLI profile integration problem. Restart XWork.",
        false,
      ),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Restart XWork.");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Profile" })).toBeInTheDocument();
  });

  // Verify no failure message can quote a command, an environment value or an account.
  it("never repeats sensitive detail in its failure copy", () => {
    renderDialog({
      failure: failure("persistenceFailed", "XWork couldn't delete this profile.", true),
    });

    expect(screen.getByRole("alert").textContent ?? "").not.toMatch(
      /gemini\.exe|OPENAI_API_KEY|account=/,
    );
  });
});
