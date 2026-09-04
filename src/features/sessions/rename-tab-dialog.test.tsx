import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameTabDialog } from "./rename-tab-dialog";
import { createTabDto } from "./sessions-test-fixture";

afterEach(cleanup);

describe("RenameTabDialog", () => {
  // Verify prefill, validation, trimming, and submission use the shared name contract.
  it("validates and submits a tab name", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <RenameTabDialog
        tab={createTabDto({ name: "Old" })}
        isPending={false}
        failure={null}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        onClosed={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Tab name");
    expect(input).toHaveValue("Old");
    await user.clear(input);
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    await user.type(input, "  Mới  {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Mới");
  });
});
