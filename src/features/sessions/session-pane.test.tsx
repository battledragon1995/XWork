import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionPane } from "./session-pane";
import { createPaneDto, createToolCatalogData, FIXTURE_ROOT_PATH } from "./sessions-test-fixture";

afterEach(cleanup);

describe("SessionPane", () => {
  // Verify the active pane identity, root path, focus activation, and pane-limit affordance.
  it("renders an active empty pane at the pane limit", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <TooltipProvider>
        <MemoryRouter>
          <SessionPane
            shortcutSnapshot={snapshot}
            shortcutPlatform="windows"
            pane={createPaneDto()}
            tabId="tab-1"
            rootPath={FIXTURE_ROOT_PATH}
            profiles={[]}
            catalog={createToolCatalogData()}
            paneCount={4}
            paneIndex={1}
            isActive
            isMaximized={false}
            isHiddenByMaximize={false}
            isBusy={false}
            selectingProfileId={null}
            onActivate={onActivate}
            onSplit={vi.fn()}
            onToggleMaximize={vi.fn()}
            onClose={vi.fn()}
            onSelectProfile={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );
    const pane = screen.getByText("New pane").closest("section");
    expect(pane).toHaveAttribute("aria-current", "true");
    expect(screen.getByText(FIXTURE_ROOT_PATH)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Split right (Ctrl \\)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Split down (Ctrl Alt \\)" })).toBeDisabled();
    if (pane !== null) await user.click(pane);
    expect(onActivate).toHaveBeenCalled();
  });

  // Verify maximized state changes action copy and displays the exact index badge.
  it("renders maximize restoration state", () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <SessionPane
            shortcutSnapshot={snapshot}
            shortcutPlatform="windows"
            pane={createPaneDto()}
            tabId="tab-1"
            rootPath={null}
            profiles={[]}
            catalog={createToolCatalogData()}
            paneCount={2}
            paneIndex={2}
            isActive
            isMaximized
            isHiddenByMaximize={false}
            isBusy={false}
            selectingProfileId={null}
            onActivate={vi.fn()}
            onSplit={vi.fn()}
            onToggleMaximize={vi.fn()}
            onClose={vi.fn()}
            onSelectProfile={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Restore layout (Ctrl Shift M)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Maximized · 2 of 2 panes · Ctrl Shift M to restore"),
    ).toBeInTheDocument();
  });

  // Verify Terminal arrives through the app-owned slot with the exact pane identities.
  it("renders terminal content through the optional composition slot", () => {
    const renderTerminal = vi.fn((props: { paneId: string; isVisible: boolean }) => (
      <div data-testid="terminal-slot">{props.paneId}</div>
    ));
    render(
      <TooltipProvider>
        <MemoryRouter>
          <SessionPane
            shortcutSnapshot={snapshot}
            shortcutPlatform="windows"
            pane={createPaneDto({
              content: {
                kind: "terminal",
                terminalId: "terminal-1",
                profileId: "builtin:codex",
                title: "Codex",
              },
            })}
            sessionId="session-1"
            tabId="tab-1"
            rootPath={null}
            profiles={[]}
            catalog={createToolCatalogData()}
            paneCount={1}
            paneIndex={1}
            isActive
            isMaximized={false}
            isHiddenByMaximize={false}
            isBusy={false}
            selectingProfileId={null}
            onActivate={vi.fn()}
            onSplit={vi.fn()}
            onToggleMaximize={vi.fn()}
            onClose={vi.fn()}
            onSelectProfile={vi.fn()}
            renderTerminal={renderTerminal}
            onRefreshSession={vi.fn()}
            onCheckProfile={vi.fn()}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );
    expect(screen.getByTestId("terminal-slot")).toHaveTextContent("pane-1");
    expect(screen.getByTestId("terminal-slot").parentElement).toHaveClass(
      "min-w-0",
      "overflow-hidden",
    );
    expect(renderTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        tabId: "tab-1",
        paneId: "pane-1",
        isActive: true,
        isVisible: true,
      }),
    );
    expect(screen.queryByText("Terminals arrive with FE-008.")).not.toBeInTheDocument();
  });
});

const snapshot: KeyboardShortcutsDto = {
  actions: [
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
/** Rerenders replace every pane accelerator and remove unavailable configuration. */
it("updates pane labels and restore guidance from the same snapshot", () => {
  /** Render a stable pane while replacing only its shortcut inputs. */
  const pane = (shortcutSnapshot: KeyboardShortcutsDto | null) => (
    <TooltipProvider>
      <MemoryRouter>
        <SessionPane
          shortcutSnapshot={shortcutSnapshot}
          shortcutPlatform="windows"
          pane={createPaneDto()}
          tabId="tab-1"
          rootPath={null}
          profiles={[]}
          catalog={createToolCatalogData()}
          paneCount={2}
          paneIndex={1}
          isActive
          isMaximized
          isHiddenByMaximize={false}
          isBusy={false}
          selectingProfileId={null}
          onActivate={vi.fn()}
          onSplit={vi.fn()}
          onToggleMaximize={vi.fn()}
          onClose={vi.fn()}
          onSelectProfile={vi.fn()}
        />
      </MemoryRouter>
    </TooltipProvider>
  );
  const view = render(pane(snapshot));
  const changed: KeyboardShortcutsDto = {
    actions: snapshot.actions.map(
      // Give each action a distinct override with no modifier ambiguity.
      (action, index) => ({
        ...action,
        currentChord: { primary: false, alt: false, shift: false, keyCode: `F${index + 5}` },
        isCustom: true,
      }),
    ),
  };
  view.rerender(pane(changed));
  for (const label of [
    "Split right (F5)",
    "Split down (F6)",
    "Restore layout (F7)",
    "Close pane (F8)",
  ])
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  expect(screen.getByText("Maximized · 1 of 2 panes · F7 to restore")).toBeInTheDocument();
  view.rerender(
    pane({
      actions: changed.actions.map(
        // Conflicts replace accelerators while preserving direct controls.
        (action) => ({ ...action, isDispatchable: false, conflictsWith: ["tabs.create"] }),
      ),
    }),
  );
  expect(
    screen.getByRole("button", { name: "Close pane (Shortcut conflict — change it in Settings)" }),
  ).toBeEnabled();
  view.rerender(pane(null));
  expect(screen.getByRole("button", { name: "Close pane" })).toBeEnabled();
  expect(screen.queryByText(/to restore/)).not.toBeInTheDocument();
});
