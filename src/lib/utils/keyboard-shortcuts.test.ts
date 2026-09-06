import { expect, it } from "vitest";
import { normalizeShortcut } from "./keyboard-shortcuts";

/** Verify normalization uses physical code rather than the active layout. */
it("normalizes Ctrl T", () => {
  expect(
    normalizeShortcut(
      new KeyboardEvent("keydown", { code: "KeyT", key: "ư", ctrlKey: true }),
      "windows",
    ),
  ).toEqual({ primary: true, alt: false, shift: false, keyCode: "KeyT" });
});

import {
  equalShortcut,
  formatShortcut,
  matchesShortcut,
  shortcutParts,
  validateShortcut,
} from "./keyboard-shortcuts";

/** Exact modifiers prevent an extra key from matching another action. */
it("compares complete modifiers and rejects composition", () => {
  const chord = { primary: true, alt: false, shift: false, keyCode: "KeyT" };
  for (const extras of [
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
  ])
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true, ...extras }),
        chord,
        "windows",
      ),
    ).toBe(false);
  const graph = new KeyboardEvent("keydown", { code: "KeyT", ctrlKey: true });
  Object.defineProperty(graph, "getModifierState", {
    value: /** Simulate an active AltGraph modifier. */ () => true,
  });
  expect(matchesShortcut(graph, chord, "windows")).toBe(false);
  expect(equalShortcut(chord, { ...chord, primary: false })).toBe(false);
  expect(
    normalizeShortcut(new KeyboardEvent("keydown", { code: "KeyT", metaKey: true }), "macos"),
  ).toEqual(chord);
  expect(
    normalizeShortcut(
      new KeyboardEvent("keydown", { code: "KeyT", metaKey: true, ctrlKey: true }),
      "macos",
    ),
  ).toBeNull();
});
/** All backend-supported codes normalize and format from explicit platform data. */
it("supports the complete code allowlist and function-key rule", () => {
  const codes = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    .map(
      // Enumerate letters by physical code.
      (letter) => `Key${letter}`,
    )
    .concat(
      [..."0123456789"].map(
        // Enumerate the top-row digits rather than the numpad.
        (digit) => `Digit${digit}`,
      ),
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        "Insert",
        "Delete",
        "Backspace",
        "Enter",
        "Escape",
        "Space",
        "Tab",
        "Backslash",
        "BracketLeft",
        "BracketRight",
        "Minus",
        "Equal",
        "Comma",
        "Period",
        "Slash",
        "Semicolon",
        "Quote",
        "Backquote",
      ],
    );
  for (const code of codes)
    expect(
      normalizeShortcut(new KeyboardEvent("keydown", { code, ctrlKey: true }), "windows")?.keyCode,
    ).toBe(code);
  for (let index = 1; index <= 12; index++)
    expect(
      normalizeShortcut(new KeyboardEvent("keydown", { code: `F${index}` }), "windows")?.primary,
    ).toBe(false);
  for (const code of ["F0", "F13", "F01", "Numpad1", "Keya", "Digit10"])
    expect(
      normalizeShortcut(new KeyboardEvent("keydown", { code, ctrlKey: true }), "windows"),
    ).toBeNull();
  const chord = { primary: true, alt: true, shift: true, keyCode: "ArrowUp" };
  expect(formatShortcut(chord, "windows")).toBe("Ctrl Alt Shift ↑");
  expect(formatShortcut(chord, "macos")).toBe("Command Option Shift ↑");
  expect(shortcutParts(chord, "macos", true).at(-1)).toBe("Arrow up");
  expect(validateShortcut({ ...chord, keyCode: "KeyQ", alt: false, shift: false }, "macos")).toBe(
    "This shortcut is reserved by the operating system.",
  );
});
