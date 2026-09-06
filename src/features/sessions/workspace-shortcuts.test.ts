import { expect, it } from "vitest";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import { matchWorkspaceShortcut, shortcutLabel } from "./workspace-shortcuts";

/** Overrides replace the old chord immediately and never fall back to defaults. */
it("uses only committed assignments", () => {
  const event = new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true });
  expect(matchWorkspaceShortcut(event)).toBeNull();
  expect(matchWorkspaceShortcut(event, snapshot, "windows")).toBe("tabs.create");
  const changed = structuredClone(snapshot);
  const target = changed.actions[7];
  if (target === undefined) throw new Error("Expected fixture action");
  target.currentChord.keyCode = "KeyY";
  expect(matchWorkspaceShortcut(event, changed, "windows")).toBeNull();
  expect(
    matchWorkspaceShortcut(
      new KeyboardEvent("keydown", { code: "KeyY", ctrlKey: true }),
      changed,
      "windows",
    ),
  ).toBe("tabs.create");
  expect(shortcutLabel("tabs.create", changed, "windows")).toBe("Ctrl Y");
});
/** Conflicts with unavailable actions also suppress an existing handler. */
it("suppresses complete conflict groups", () => {
  const changed = structuredClone(snapshot);
  const target = changed.actions[7];
  if (target === undefined) throw new Error("Expected fixture action");
  target.conflictsWith = ["tabs.close", "navigation.next_tab"];
  target.isDispatchable = false;
  expect(
    matchWorkspaceShortcut(
      new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true }),
      changed,
      "windows",
    ),
  ).toBeNull();
  expect(shortcutLabel("tabs.create", changed, "windows")).toBe(
    "Shortcut conflict — change it in Settings",
  );
});
/** Every existing adapter maps to the canonical backend ID. */
it("maps all seven actions", () => {
  const ids = [
    "tabs.create",
    "tabs.close",
    "tabs.reopenClosed",
    "panes.splitRight",
    "panes.splitDown",
    "panes.maximizeToggle",
    "panes.close",
  ];
  snapshot.actions.slice(7, 14).forEach(
    // Exercise all physical defaults through the snapshot boundary.
    (action, index) => {
      const chord = action.currentChord;
      expect(
        matchWorkspaceShortcut(
          new KeyboardEvent("keydown", {
            code: chord.keyCode,
            ctrlKey: chord.primary,
            altKey: chord.alt,
            shiftKey: chord.shift,
          }),
          snapshot,
          "windows",
        ),
      ).toBe(ids[index]);
    },
  );
});

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
