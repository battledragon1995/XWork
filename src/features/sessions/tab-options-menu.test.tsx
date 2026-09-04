import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TabOptionsMenu } from "./tab-options-menu";

afterEach(cleanup);

describe("TabOptionsMenu", () => {
  // Verify both operation groups and endpoint enablement are exposed from one menu.
  it("renders tab and session actions", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <TabOptionsMenu
          isBusy={false}
          canMoveLeft={false}
          canMoveRight
          canReopen={false}
          onRenameTab={vi.fn()}
          onMoveLeft={vi.fn()}
          onMoveRight={vi.fn()}
          onCloseTab={vi.fn()}
          onReopen={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Tab options" }));
    expect(screen.getByRole("menuitem", { name: "Rename tab…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move tab left" })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("menuitem", { name: "Reopen closed tab" })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("menuitem", { name: "Delete Session" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
  });
});
