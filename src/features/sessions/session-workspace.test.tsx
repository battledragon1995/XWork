import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
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
  filePlacements: { newTab: true, emptyPane: false, splitRight: true, splitDown: true },
  prepareFileTarget: vi.fn(async () => null),
};

/** The route owns both seams now, so every case supplies them as props. */
const catalog = createToolCatalogData();

afterEach(cleanup);

/** Workspace-local pending state disables the supplied control without replacing terminal DOM. */
it("preserves terminal DOM and disables Explorer at the workspace boundary", async () => {
  const clicked = vi.fn();
  const user = userEvent.setup();
  const detail = createNonEmptySessionDetail();
  /** Re-render exactly the same terminal position while changing local closing state. */
  const workspace = () => (
    <TooltipProvider>
      <MemoryRouter>
        <SessionWorkspace
          detail={detail}
          rootPath={null}
          catalog={catalog}
          mutations={mutations}
          onApplyDetail={vi.fn()}
          onRefresh={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
          renderTerminal={() => <div data-testid="durable-terminal" />}
          fileExplorerToggle={
            <button type="button" onClick={clicked}>
              Show File Explorer
            </button>
          }
        />
      </MemoryRouter>
    </TooltipProvider>
  );
  const view = render(workspace());
  const terminal = screen.getByTestId("durable-terminal");
  await user.click(screen.getByRole("button", { name: "Show File Explorer" }));
  expect(clicked).toHaveBeenCalledOnce();
  mutations.isSessionClosing = true;
  view.rerender(workspace());
  expect(screen.getByRole("button", { name: "Show File Explorer" })).toBeDisabled();
  expect(screen.getByTestId("durable-terminal")).toBe(terminal);
  mutations.isSessionClosing = false;
});

describe("SessionWorkspace", () => {
  // Verify the active tab stays width-constrained and session menu intents remain route-owned.
  it("composes constrained tabs, panes, and session intents", async () => {
    const user = userEvent.setup();
    const onRenameSession = vi.fn();
    const view = render(
      <TooltipProvider>
        <MemoryRouter>
          <SessionWorkspace
            shortcutSnapshot={snapshot}
            shortcutPlatform="windows"
            detail={createNonEmptySessionDetail()}
            rootPath={null}
            catalog={catalog}
            mutations={mutations}
            onApplyDetail={vi.fn()}
            onRefresh={vi.fn()}
            onRenameSession={onRenameSession}
            onDeleteSession={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(view.container.firstElementChild?.lastElementChild).toHaveClass(
      "min-w-0",
      "overflow-hidden",
    );
    expect(screen.getByRole("tab", { name: /Codex/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Codex is ready to run.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tab options" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    expect(onRenameSession).toHaveBeenCalledOnce();
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
    {
      actionId: "tabs.close",
      label: "Close tab",
      category: "tabs",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: false, keyCode: "KeyW" },
      currentChord: { primary: true, alt: false, shift: false, keyCode: "KeyW" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "tabs.reopen_closed",
      label: "Reopen closed tab",
      category: "tabs",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: true, keyCode: "KeyT" },
      currentChord: { primary: true, alt: false, shift: true, keyCode: "KeyT" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "panes.split_right",
      label: "Split right",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: false, keyCode: "Backslash" },
      currentChord: { primary: true, alt: false, shift: false, keyCode: "Backslash" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "panes.split_down",
      label: "Split down",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: false, keyCode: "Backslash" },
      currentChord: { primary: true, alt: true, shift: false, keyCode: "Backslash" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "panes.maximize_toggle",
      label: "Maximize or restore pane",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: true, keyCode: "KeyM" },
      currentChord: { primary: true, alt: false, shift: true, keyCode: "KeyM" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "panes.close",
      label: "Close pane",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: true, keyCode: "KeyW" },
      currentChord: { primary: true, alt: false, shift: true, keyCode: "KeyW" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
  ],
};
/** Live assignment changes keep original runtime callbacks and suppress conflicts. */
it("dispatches overrides through the existing workspace callbacks", async () => {
  mutations.createTab.mockClear();
  mutations.requestClose.mockClear();
  /** Keep the workspace mounted while committing a new configuration. */
  const workspace = (shortcutSnapshot: KeyboardShortcutsDto | null) => (
    <TooltipProvider>
      <MemoryRouter>
        <SessionWorkspace
          shortcutSnapshot={shortcutSnapshot}
          shortcutPlatform="windows"
          detail={createNonEmptySessionDetail()}
          rootPath={null}
          catalog={catalog}
          mutations={mutations}
          onApplyDetail={vi.fn()}
          onRefresh={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </MemoryRouter>
    </TooltipProvider>
  );
  const view = render(workspace(snapshot));
  const changed: KeyboardShortcutsDto = {
    actions: snapshot.actions.map(
      // Change only the New tab binding and preserve close-impact handlers.
      (action) =>
        action.actionId === "tabs.create"
          ? { ...action, currentChord: { ...action.currentChord, keyCode: "KeyY" } }
          : action,
    ),
  };
  view.rerender(workspace(changed));
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true }));
  expect(mutations.createTab).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyY", ctrlKey: true }));
  expect(mutations.createTab).toHaveBeenCalledOnce();
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", ctrlKey: true }));
  expect(mutations.requestClose).toHaveBeenCalledWith(expect.objectContaining({ kind: "tab" }));
  view.rerender(
    workspace({
      actions: changed.actions.map(
        // Simulate a committed conflicting group without disabling direct buttons.
        (action) => ({ ...action, isDispatchable: false, conflictsWith: ["navigation.next_tab"] }),
      ),
    }),
  );
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyY", ctrlKey: true }));
  expect(mutations.createTab).toHaveBeenCalledOnce();
  await userEvent.setup().click(screen.getByRole("button", { name: "New tab" }));
  expect(mutations.createTab).toHaveBeenCalledTimes(2);
});
