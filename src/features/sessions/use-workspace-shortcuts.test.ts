import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";

describe("useWorkspaceShortcuts", () => {
  // Verify an available shortcut runs once and suppresses the browser default.
  it("dispatches a matched shortcut", () => {
    const onCreateTab = vi.fn();
    const view = renderHook(() =>
      useWorkspaceShortcuts({
        isEnabled: true,
        shortcutSnapshot: snapshot,
        shortcutPlatform: "windows",
        onCreateTab,
        onCloseTab: vi.fn(),
        onReopenTab: vi.fn(),
        onSplit: vi.fn(),
        onToggleMaximize: vi.fn(),
        onClosePane: vi.fn(),
      }),
    );
    const event = new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(onCreateTab).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    view.unmount();
  });

  // Verify disabled and editable contexts leave both action and browser behavior untouched.
  it("ignores disabled and editable contexts", () => {
    const onCloseTab = vi.fn();
    renderHook(() =>
      useWorkspaceShortcuts({
        isEnabled: true,
        shortcutSnapshot: snapshot,
        shortcutPlatform: "windows",
        canCloseTab: false,
        onCreateTab: vi.fn(),
        onCloseTab,
        onReopenTab: vi.fn(),
        onSplit: vi.fn(),
        onToggleMaximize: vi.fn(),
        onClosePane: vi.fn(),
      }),
    );
    const disabled = new KeyboardEvent("keydown", {
      code: "KeyW",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(disabled);
    const input = document.createElement("input");
    document.body.append(input);
    const editable = new KeyboardEvent("keydown", {
      code: "KeyW",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(editable);
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(disabled.defaultPrevented).toBe(false);
    expect(editable.defaultPrevented).toBe(false);
    input.remove();
  });

  // Verify every descendant of Terminal keeps CLI control keys, even when it is not editable.
  it("ignores shortcuts originating anywhere inside a terminal subtree", () => {
    const onClosePane = vi.fn();
    const view = renderHook(() =>
      useWorkspaceShortcuts({
        isEnabled: true,
        shortcutSnapshot: snapshot,
        shortcutPlatform: "windows",
        onCreateTab: vi.fn(),
        onCloseTab: vi.fn(),
        onReopenTab: vi.fn(),
        onSplit: vi.fn(),
        onToggleMaximize: vi.fn(),
        onClosePane,
      }),
    );
    const terminal = document.createElement("div");
    terminal.dataset.terminalRoot = "true";
    const cell = document.createElement("span");
    terminal.append(cell);
    document.body.append(terminal);
    const event = new KeyboardEvent("keydown", {
      code: "KeyW",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    cell.dispatchEvent(event);
    expect(onClosePane).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    terminal.remove();
    view.unmount();
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
/** All editable surfaces, prevented events and dialogs retain their native input. */
it("preserves editable, dialog, IME and prevented event guards", () => {
  const onCreateTab = vi.fn();
  renderHook(
    // Register the real listener against an explicit committed snapshot.
    () =>
      useWorkspaceShortcuts({
        isEnabled: true,
        shortcutSnapshot: snapshot,
        shortcutPlatform: "windows",
        onCreateTab,
        onCloseTab: vi.fn(),
        onReopenTab: vi.fn(),
        onSplit: vi.fn(),
        onToggleMaximize: vi.fn(),
        onClosePane: vi.fn(),
      }),
  );
  for (const tag of ["input", "textarea", "select"]) {
    const target = document.createElement(tag);
    document.body.append(target);
    const event = new KeyboardEvent("keydown", {
      code: "KeyT",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    target.remove();
  }
  for (const attribute of ["contenteditable", "data-editor-root", "data-terminal-root"]) {
    const root = document.createElement("div");
    root.setAttribute(attribute, "true");
    const child = document.createElement("span");
    root.append(child);
    document.body.append(root);
    child.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true, bubbles: true }),
    );
    root.remove();
  }
  for (const extra of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }])
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true, ...extra }));
  const prevented = new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true, cancelable: true });
  prevented.preventDefault();
  window.dispatchEvent(prevented);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true }));
  dialog.remove();
  expect(onCreateTab).not.toHaveBeenCalled();
});
