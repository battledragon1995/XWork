import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceShortcuts } from "./use-workspace-shortcuts";

describe("useWorkspaceShortcuts", () => {
  // Verify an available shortcut runs once and suppresses the browser default.
  it("dispatches a matched shortcut", () => {
    const onCreateTab = vi.fn();
    const view = renderHook(() =>
      useWorkspaceShortcuts({
        isEnabled: true,
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
