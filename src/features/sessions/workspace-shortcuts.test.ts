import { describe, expect, it } from "vitest";
import { matchWorkspaceShortcut, shortcutLabel, WORKSPACE_SHORTCUTS } from "./workspace-shortcuts";

describe("workspace shortcut rules", () => {
  // Verify all seven table entries match from code and exact modifiers.
  it("matches every canonical shortcut", () => {
    for (const shortcut of WORKSPACE_SHORTCUTS) {
      const event = new KeyboardEvent("keydown", {
        code: shortcut.code,
        ctrlKey: true,
        altKey: shortcut.alt,
        shiftKey: shortcut.shift,
      });
      expect(matchWorkspaceShortcut(event)).toBe(shortcut.id);
      expect(shortcutLabel(shortcut.id)).toBe(shortcut.label);
    }
  });

  // Verify extra platform modifiers never produce an accidental match.
  it("rejects extra modifiers", () => {
    expect(
      matchWorkspaceShortcut(
        new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true, metaKey: true }),
      ),
    ).toBeNull();
    expect(
      matchWorkspaceShortcut(
        new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true, altKey: true }),
      ),
    ).toBeNull();
    expect(shortcutLabel("panes.splitDown")).toBe("Ctrl Alt \\");
  });
});
