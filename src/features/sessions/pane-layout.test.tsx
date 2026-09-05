import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PaneLayout } from "./pane-layout";
import { createSplitLayout, createTabDto, createToolCatalogData } from "./sessions-test-fixture";

afterEach(cleanup);

describe("PaneLayout", () => {
  // Verify the recursive renderer preserves both leaves and exposes the physical split axis.
  it("renders a vertical split as left and right panes", () => {
    const tab = createTabDto({ layout: createSplitLayout(), activePaneId: "pane-1" });
    render(
      <TooltipProvider>
        <MemoryRouter>
          <PaneLayout
            tab={tab}
            rootPath={null}
            catalog={createToolCatalogData()}
            isBusy={false}
            selectingProfileId={null}
            onActivatePane={vi.fn()}
            onSplitPane={vi.fn()}
            onCommitRatio={vi.fn()}
            onToggleMaximize={vi.fn()}
            onClosePane={vi.fn()}
            onSelectProfile={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(document.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    expect(
      screen.getByRole("separator", { name: "Resize panes left and right" }),
    ).toBeInTheDocument();
    expect(document.querySelector("#split-1")).toHaveAttribute("data-group");
    for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]")) {
      expect(panel.firstElementChild).toHaveStyle({ overflow: "hidden" });
    }
  });

  // Verify maximize hides without unmounting the other pane and disables the separator.
  it("keeps all panes mounted while maximized", () => {
    const tab = createTabDto({
      layout: createSplitLayout(),
      activePaneId: "pane-2",
      maximizedPaneId: "pane-2",
    });
    render(
      <TooltipProvider>
        <MemoryRouter>
          <PaneLayout
            tab={tab}
            rootPath={null}
            catalog={createToolCatalogData()}
            isBusy={false}
            selectingProfileId={null}
            onActivatePane={vi.fn()}
            onSplitPane={vi.fn()}
            onCommitRatio={vi.fn()}
            onToggleMaximize={vi.fn()}
            onClosePane={vi.fn()}
            onSelectProfile={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(document.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    expect(document.querySelector('[data-pane-id="pane-1"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByRole("separator", { hidden: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
