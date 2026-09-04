import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionWorkspace } from "./session-workspace";
import { createNonEmptySessionDetail, createToolCatalogData } from "./sessions-test-fixture";

const mutations = {
  pending: null,
  failure: null,
  isSessionClosing: false,
  pendingClose: null,
  createTab: vi.fn(),
  renameTab: vi.fn(async () => true),
  moveTab: vi.fn(),
  activateTab: vi.fn(),
  activatePane: vi.fn(),
  splitPane: vi.fn(),
  commitSplitRatio: vi.fn(),
  toggleMaximizedPane: vi.fn(),
  selectPaneTool: vi.fn(),
  reopenLastClosedTab: vi.fn(),
  requestClose: vi.fn(),
  confirmClose: vi.fn(),
  cancelClose: vi.fn(),
  clearFailure: vi.fn(),
  retryFailure: vi.fn(),
};

vi.mock("./use-tool-catalog", () => ({ useToolCatalog: () => createToolCatalogData() }));
vi.mock("./use-workspace-mutations", () => ({ useWorkspaceMutations: () => mutations }));

afterEach(cleanup);

describe("SessionWorkspace", () => {
  // Verify the active tab and pane render and session menu intents remain route-owned.
  it("composes tabs, panes, and session intents", async () => {
    const user = userEvent.setup();
    const onRenameSession = vi.fn();
    render(
      <TooltipProvider>
        <MemoryRouter>
          <SessionWorkspace
            detail={createNonEmptySessionDetail()}
            rootPath={null}
            onApplyDetail={vi.fn()}
            onRefresh={vi.fn()}
            onRenameSession={onRenameSession}
            onDeleteSession={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(screen.getByRole("tab", { name: /Codex/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Codex is ready to run.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tab options" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    expect(onRenameSession).toHaveBeenCalledOnce();
  });
});
