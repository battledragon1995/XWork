import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionTabStrip } from "./session-tab-strip";
import { createNonEmptySessionDetail, createTabDto } from "./sessions-test-fixture";

afterEach(cleanup);

describe("SessionTabStrip", () => {
  // Verify selection, creation, roving focus, and backend order are presented accessibly.
  it("renders and operates the tablist", async () => {
    const user = userEvent.setup();
    const first = createTabDto();
    const second = createTabDto({ id: "tab-2", name: "Second" });
    const detail = createNonEmptySessionDetail({ tabs: [first, second], activeTabId: first.id });
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    render(
      <TooltipProvider>
        <SessionTabStrip
          detail={detail}
          activeTab={first}
          isBusy={false}
          onCreate={onCreate}
          onSelect={onSelect}
          onMove={vi.fn()}
          onClose={vi.fn()}
          onRename={vi.fn()}
          onReopen={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("tablist", { name: "Session tabs" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Second/ }));
    expect(onSelect).toHaveBeenCalledWith("tab-2");
    await user.click(screen.getByRole("button", { name: "New tab" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
