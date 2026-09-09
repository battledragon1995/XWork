import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";

const snapshot: KeyboardShortcutsDto = {
  actions: [
    {
      actionId: "search.open_command_palette",
      label: "Search or run a command",
      category: "navigation",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: false, keyCode: "KeyK" },
      currentChord: { primary: true, alt: false, shift: false, keyCode: "KeyK" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "navigation.previous_project",
      label: "Previous project",
      category: "navigation",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: false, keyCode: "ArrowLeft" },
      currentChord: { primary: true, alt: true, shift: false, keyCode: "ArrowLeft" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "navigation.next_project",
      label: "Next project",
      category: "navigation",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: false, keyCode: "ArrowRight" },
      currentChord: { primary: true, alt: true, shift: false, keyCode: "ArrowRight" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "navigation.previous_session",
      label: "Previous session",
      category: "navigation",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: false, keyCode: "ArrowUp" },
      currentChord: { primary: true, alt: true, shift: false, keyCode: "ArrowUp" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "navigation.next_session",
      label: "Next session",
      category: "navigation",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: false, keyCode: "ArrowDown" },
      currentChord: { primary: true, alt: true, shift: false, keyCode: "ArrowDown" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "navigation.previous_tab",
      label: "Previous tab",
      category: "navigation",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: false, keyCode: "PageUp" },
      currentChord: { primary: true, alt: false, shift: false, keyCode: "PageUp" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "navigation.next_tab",
      label: "Next tab",
      category: "navigation",
      scope: "application",
      defaultChord: { primary: true, alt: false, shift: false, keyCode: "PageDown" },
      currentChord: { primary: true, alt: false, shift: false, keyCode: "PageDown" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
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
    {
      actionId: "panes.focus_up",
      label: "Focus pane above",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: true, keyCode: "ArrowUp" },
      currentChord: { primary: true, alt: true, shift: true, keyCode: "ArrowUp" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "panes.focus_down",
      label: "Focus pane below",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: true, keyCode: "ArrowDown" },
      currentChord: { primary: true, alt: true, shift: true, keyCode: "ArrowDown" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "panes.focus_left",
      label: "Focus pane left",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: true, keyCode: "ArrowLeft" },
      currentChord: { primary: true, alt: true, shift: true, keyCode: "ArrowLeft" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
    {
      actionId: "panes.focus_right",
      label: "Focus pane right",
      category: "panes",
      scope: "application",
      defaultChord: { primary: true, alt: true, shift: true, keyCode: "ArrowRight" },
      currentChord: { primary: true, alt: true, shift: true, keyCode: "ArrowRight" },
      isCustom: false,
      conflictsWith: [],
      isDispatchable: true,
    },
  ],
};

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuickNoteGlobalShortcutStatusDto } from "@/bindings/quick-note-window";
import { readAppInfo } from "@/lib/ipc/app-info";
import * as ipc from "@/lib/ipc/keyboard-shortcuts";
import * as quickNoteIpc from "@/lib/ipc/quick-note-window";
import { KeyboardShortcutsProvider } from "./keyboard-shortcuts-provider";
import { SettingsKeyboardShortcutsRoute } from "./settings-keyboard-shortcuts-route";

/** Keep all shortcut reads and writes inside isolated mocks. */
vi.mock("@/lib/ipc/keyboard-shortcuts", () => ({
  getKeyboardShortcuts: vi.fn(),
  setKeyboardShortcut: vi.fn(),
  resetKeyboardShortcut: vi.fn(),
  resetAllKeyboardShortcuts: vi.fn(),
}));
/** Never inspect the host OS in component tests. */
vi.mock("@/lib/ipc/app-info", () => ({ readAppInfo: vi.fn() }));
/** Keep native registration isolated from route tests. */
vi.mock("@/lib/ipc/quick-note-window", () => ({
  getQuickNoteGlobalShortcutStatus: vi.fn(),
  onQuickNoteGlobalShortcutStatusChanged: vi.fn(),
}));
const globalChord = { primary: true, alt: true, shift: false, keyCode: "KeyN" };
const globalStatus: QuickNoteGlobalShortcutStatusDto = {
  sequence: "1",
  actionId: "quick_note.open_global",
  chord: globalChord,
  state: "active",
  conflictsWith: [],
};
/** Extend the historical fixture with the Phase 3 native shortcut action. */
function withGlobal() {
  const catalog = structuredClone(snapshot);
  catalog.actions.unshift({
    actionId: "quick_note.open_global",
    label: "Quick Note",
    category: "global",
    scope: "global",
    currentChord: globalChord,
    defaultChord: globalChord,
    isCustom: false,
    conflictsWith: [],
    isDispatchable: true,
  });
  return catalog;
}
/** Reset the catalog for every independent route lifetime. */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(quickNoteIpc.getQuickNoteGlobalShortcutStatus).mockResolvedValue(globalStatus);
  vi.mocked(quickNoteIpc.onQuickNoteGlobalShortcutStatusChanged).mockResolvedValue(vi.fn());
  vi.mocked(readAppInfo).mockResolvedValue({
    osPlatform: "windows",
    appVersion: "test",
    osArch: "x64",
    osVersion: "test",
  });
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(structuredClone(snapshot));
  vi.mocked(ipc.resetAllKeyboardShortcuts).mockResolvedValue(structuredClone(snapshot));
});
afterEach(cleanup);

/** Native availability replaces the historical unimplemented action label. */
it("shows actual global status and supports explicit reconciliation", async () => {
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(withGlobal());
  vi.mocked(quickNoteIpc.getQuickNoteGlobalShortcutStatus).mockRejectedValueOnce(
    new Error("offline"),
  );
  await mount();
  const row = screen.getByRole("button", { name: "Change shortcut for Quick Note" }).closest("tr");
  expect(row).not.toHaveTextContent("Not available yet");
  expect(
    await screen.findByText("Could not read global shortcut status. Try again."),
  ).toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Retry global shortcut status" }));
  expect(await screen.findByText("Global shortcut active")).toBeInTheDocument();
});

/** An OS registration failure never rolls back an acknowledged shortcut assignment. */
it("retains a saved global chord when native registration is unavailable", async () => {
  const user = userEvent.setup();
  const catalog = withGlobal();
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(catalog);
  await mount();
  await user.click(screen.getByRole("button", { name: "Change shortcut for Quick Note" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Press a shortcut" }), {
    code: "KeyY",
    ctrlKey: true,
  });
  const changed = structuredClone(catalog);
  const action = changed.actions[0];
  if (action === undefined) throw new Error("Expected global action");
  action.currentChord = { ...globalChord, alt: false, keyCode: "KeyY" };
  action.isCustom = true;
  vi.mocked(ipc.setKeyboardShortcut).mockResolvedValue(changed);
  vi.mocked(quickNoteIpc.getQuickNoteGlobalShortcutStatus).mockResolvedValue({
    ...globalStatus,
    sequence: "2",
    chord: action.currentChord,
    state: "unavailable",
  });
  const reads = vi.mocked(quickNoteIpc.getQuickNoteGlobalShortcutStatus).mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText(
      "Global shortcut unavailable. Change or reset the shortcut, or restart XWork.",
    ),
  ).toBeInTheDocument();
  expect(quickNoteIpc.getQuickNoteGlobalShortcutStatus).toHaveBeenCalledTimes(reads + 1);
  expect(screen.getByRole("button", { name: "Change shortcut for Quick Note" })).toHaveTextContent(
    "CtrlY",
  );
  expect(screen.getByRole("button", { name: "Reset shortcut for Quick Note" })).toBeEnabled();
  expect(ipc.resetKeyboardShortcut).not.toHaveBeenCalled();
});

/** Native status for an old chord stays pending until the committed chord is reconciled. */
it("shows pending reconciliation and then backend conflict names", async () => {
  const catalog = withGlobal();
  const action = catalog.actions[0];
  if (action === undefined) throw new Error("Expected global action");
  action.conflictsWith = ["tabs.create"];
  action.isDispatchable = false;
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(catalog);
  vi.mocked(quickNoteIpc.getQuickNoteGlobalShortcutStatus).mockResolvedValue({
    ...globalStatus,
    chord: { ...globalChord, keyCode: "KeyY" },
  });
  await mount();
  expect(screen.getByText("Applying global shortcut…")).toBeInTheDocument();
  expect(screen.queryByText("Global shortcut active")).not.toBeInTheDocument();
  const callback = vi.mocked(quickNoteIpc.onQuickNoteGlobalShortcutStatusChanged).mock
    .calls[0]?.[0];
  if (callback === undefined) throw new Error("Expected status listener");
  act(
    // Reconcile the actual catalog assignment after its OS registration is disabled.
    () =>
      callback({
        ...globalStatus,
        sequence: "2",
        state: "disabled_by_conflict",
        conflictsWith: ["tabs.create"],
      }),
  );
  expect(screen.getByText("Disabled by shortcut conflict")).toBeInTheDocument();
  expect(screen.getByText(/Conflicts with New tab/)).toBeInTheDocument();
});

/** Both reset operations reconcile native status after the catalog commit succeeds. */
it("refreshes global registration after reset-one and reset-all", async () => {
  const user = userEvent.setup();
  const catalog = withGlobal();
  const action = catalog.actions[0];
  if (action === undefined) throw new Error("Expected global action");
  action.isCustom = true;
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(catalog);
  vi.mocked(ipc.resetKeyboardShortcut).mockResolvedValue(withGlobal());
  vi.mocked(ipc.resetAllKeyboardShortcuts).mockResolvedValue(withGlobal());
  await mount();
  const reads = vi.mocked(quickNoteIpc.getQuickNoteGlobalShortcutStatus).mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Reset shortcut for Quick Note" }));
  expect(quickNoteIpc.getQuickNoteGlobalShortcutStatus).toHaveBeenCalledTimes(reads + 1);
  await user.click(screen.getByRole("button", { name: "Restore all defaults" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Restore all defaults" }),
  );
  expect(quickNoteIpc.getQuickNoteGlobalShortcutStatus).toHaveBeenCalledTimes(reads + 2);
});
/** Mount the real provider and wait for the backend catalog. */
async function mount() {
  const view = render(
    <KeyboardShortcutsProvider>
      <SettingsKeyboardShortcutsRoute />
    </KeyboardShortcutsProvider>,
  );
  await waitFor(
    /** Wait for the committed UI state. */ () =>
      expect(screen.getByRole("button", { name: "Change shortcut for New tab" })).toBeEnabled(),
  );
  return view;
}
/** Show all actions and keep search independent of IPC. */
it("renders 18 ordered actions and ten unavailable handlers", async () => {
  await mount();
  expect(screen.getAllByRole("button", { name: /^Change shortcut for/ })).toHaveLength(18);
  // Stage15 does not register an Explorer action or advertise the wireframe accelerator.
  expect(screen.queryByText(/File Explorer|Ctrl\s*\+?\s*B/i)).not.toBeInTheDocument();
  expect(screen.getAllByText("Not available yet")).toHaveLength(10);
  expect(
    screen.getAllByRole("heading", { level: 3 }).map(
      // Inspect displayed group order without relying on CSS.
      (heading) => heading.textContent,
    ),
  ).toEqual(["Navigation", "Tabs", "Panes"]);
  const calls = vi.mocked(ipc.getKeyboardShortcuts).mock.calls.length;
  fireEvent.change(screen.getByRole("textbox", { name: "Search actions" }), {
    target: { value: "  NEW TAB " },
  });
  expect(screen.getAllByRole("button", { name: /^Change shortcut for/ })).toHaveLength(1);
  expect(ipc.getKeyboardShortcuts).toHaveBeenCalledTimes(calls);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing" } });
  expect(screen.getByText("No actions found. Try another search.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getAllByRole("button", { name: /^Change shortcut for/ })).toHaveLength(18);
});
/** Save only an explicit candidate and retain the search after commit. */
it("records, cancels, saves and restores focus", async () => {
  const user = userEvent.setup();
  await mount();
  const opener = screen.getByRole("button", { name: "Change shortcut for New tab" });
  await user.click(opener);
  fireEvent.keyDown(screen.getByRole("button", { name: "Press a shortcut" }), {
    code: "KeyY",
    ctrlKey: true,
  });
  expect(ipc.setKeyboardShortcut).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(opener).toHaveFocus();
  await user.click(opener);
  fireEvent.keyDown(screen.getByRole("button", { name: "Press a shortcut" }), {
    code: "KeyY",
    ctrlKey: true,
  });
  vi.mocked(ipc.setKeyboardShortcut).mockResolvedValue(structuredClone(snapshot));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(ipc.setKeyboardShortcut).toHaveBeenCalledExactlyOnceWith({
    actionId: "tabs.create",
    chord: { primary: true, alt: false, shift: false, keyCode: "KeyY" },
  });
  expect(screen.getByText("Shortcut saved.")).toBeInTheDocument();
  expect(opener).toHaveFocus();
});
/** Restore all remains available with no custom rows and requires confirmation. */
it("confirms restore-all independently of the filter", async () => {
  const user = userEvent.setup();
  await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "New tab" } });
  await user.click(screen.getByRole("button", { name: "Restore all defaults" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(ipc.resetAllKeyboardShortcuts).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Restore all defaults" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Restore all defaults" }),
  );
  expect(ipc.resetAllKeyboardShortcuts).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox")).toHaveValue("New tab");
});
/** Filtering cannot hide conflict membership and reset focuses the remaining chord control. */
it("keeps filtered conflicts and resets a custom row", async () => {
  const custom = structuredClone(snapshot);
  const target = custom.actions[7];
  if (target === undefined) throw new Error("Expected fixture action");
  target.isCustom = true;
  target.conflictsWith = ["tabs.close", "navigation.next_tab"];
  target.isDispatchable = false;
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue(custom);
  vi.mocked(ipc.resetKeyboardShortcut).mockResolvedValue(snapshot);
  await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "New tab" } });
  expect(screen.getByText(/Conflicts with Next tab, Close tab/)).toBeInTheDocument();
  await act(
    /** Flush pending backend and React updates. */ async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset shortcut for New tab" }));
    },
  );
  expect(ipc.resetKeyboardShortcut).toHaveBeenCalledWith("tabs.create");
  expect(screen.getByRole("button", { name: "Change shortcut for New tab" })).toHaveFocus();
});
/** Unknown commits keep the draft and require reconciliation before another Save. */
it("recovers an uncertain save without discarding the recorded candidate", async () => {
  const user = userEvent.setup();
  await mount();
  await user.click(screen.getByRole("button", { name: "Change shortcut for New tab" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Press a shortcut" }), {
    code: "KeyY",
    ctrlKey: true,
  });
  vi.mocked(ipc.setKeyboardShortcut).mockRejectedValueOnce(new Error("unconfirmed commit"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("alert")).toHaveTextContent(
    "Could not confirm the shortcut change. Reload shortcuts before trying again.",
  );
  expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Press a shortcut" })).toHaveTextContent("Ctrl Y");
  await user.click(dialog.getByRole("button", { name: "Try again" }));
  expect(ipc.setKeyboardShortcut).toHaveBeenCalledOnce();
  expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  vi.mocked(ipc.setKeyboardShortcut).mockResolvedValue(snapshot);
  await user.click(dialog.getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
/** An empty or failed catalog never fabricates active keyboard assignments. */
it("renders recoverable load and empty states", async () => {
  vi.mocked(ipc.getKeyboardShortcuts).mockRejectedValueOnce(new Error("offline"));
  render(
    <KeyboardShortcutsProvider>
      <SettingsKeyboardShortcutsRoute />
    </KeyboardShortcutsProvider>,
  );
  expect(await screen.findByText("Could not load keyboard shortcuts.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restore all defaults" })).toBeDisabled();
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue({ actions: [] });
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("No keyboard shortcuts are available.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restore all defaults" })).toBeDisabled();
});
/** Refreshing the full catalog can remove an action while its dialog is open. */
it("closes a removed action and restores focus to search", async () => {
  const user = userEvent.setup();
  await mount();
  await user.click(screen.getByRole("button", { name: "Change shortcut for New tab" }));
  vi.mocked(ipc.getKeyboardShortcuts).mockResolvedValue({
    actions: snapshot.actions.filter(
      // Simulate a newer backend catalog removing the edited action.
      (action) => action.actionId !== "tabs.create",
    ),
  });
  await act(
    /** Flush pending backend and React updates. */ async () => {
      fireEvent.focus(window);
    },
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("This action is no longer available.")).toBeInTheDocument();
  await waitFor(
    // Radix restores focus after its unmount cleanup completes.
    () => expect(screen.getByRole("textbox", { name: "Search actions" })).toHaveFocus(),
  );
});
