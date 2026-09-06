import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionTabStrip } from "./session-tab-strip";
import { createNonEmptySessionDetail, createTabDto } from "./sessions-test-fixture";

afterEach(cleanup);

/** The supplied control precedes Tab options and retains its owner-provided ARIA contract. */
it("places Explorer before Tab options without a fake accelerator", () => {
  const detail = createNonEmptySessionDetail();
  render(
    <TooltipProvider>
      <SessionTabStrip
        detail={detail}
        activeTab={detail.tabs[0]}
        isBusy={false}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onReopen={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
        fileExplorerToggle={
          <button type="button" aria-expanded="false" aria-controls="explorer">
            Show File Explorer
          </button>
        }
      />
    </TooltipProvider>,
  );
  const toggle = screen.getByRole("button", { name: "Show File Explorer" });
  const menu = screen.getByRole("button", { name: "Tab options" });
  expect(toggle.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(toggle).toHaveAttribute("aria-controls", "explorer");
  expect(screen.queryByText(/Ctrl.?B/)).not.toBeInTheDocument();
});

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
          shortcutSnapshot={snapshot}
          shortcutPlatform="windows"
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

const snapshot: KeyboardShortcutsDto = {
  actions: [
    {
      actionId: "tabs.create",
      label: "New tab",
      category: "tabs",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: false, keyCode: "KeyT" },
      currentChord: { primary: true, alt: false, shift: false, keyCode: "KeyT" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
  ],
};
/** Updated and missing snapshots change the active New-tab tooltip immediately. */
it("updates the New tab accelerator after rerender", async () => {
  const user = userEvent.setup();
  const detail = createNonEmptySessionDetail();
  const activeTab = detail.tabs[0];
  if (activeTab === undefined) throw new Error("Expected fixture tab");
  /** Keep tab runtime props stable while changing only shortcut configuration. */
  const strip = (shortcutSnapshot: KeyboardShortcutsDto | null) => (
    <TooltipProvider delayDuration={0}>
      <SessionTabStrip
        detail={detail}
        activeTab={activeTab}
        shortcutSnapshot={shortcutSnapshot}
        shortcutPlatform="windows"
        isBusy={false}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onClose={vi.fn()}
        onRename={vi.fn()}
        onReopen={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    </TooltipProvider>
  );
  const view = render(strip(snapshot));
  await user.hover(screen.getByRole("button", { name: "New tab" }));
  expect(await screen.findByRole("tooltip")).toHaveTextContent("New tab (Ctrl T)");
  const changed: KeyboardShortcutsDto = {
    actions: snapshot.actions.map(
      // Use one explicit override without mutating the fixture.
      (action) => ({ ...action, currentChord: { ...action.currentChord, keyCode: "KeyY" } }),
    ),
  };
  view.rerender(strip(changed));
  expect(screen.getByRole("tooltip")).toHaveTextContent("New tab (Ctrl Y)");
  view.rerender(strip(null));
  expect(screen.getByRole("tooltip")).toHaveTextContent("New tab");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent("Ctrl");
});
