import type { ShortcutChordDto } from "@/bindings/keyboard-shortcuts";
export type ShortcutPlatform = "windows" | "macos";
const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Home: "Home",
  End: "End",
  Insert: "Insert",
  Delete: "Delete",
  Backspace: "Backspace",
  Enter: "Enter",
  Escape: "Escape",
  Space: "Space",
  Tab: "Tab",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
};
/** Ignore composition, repeated and unrepresentable modifier events. */
export function ignoreShortcutEvent(event: KeyboardEvent, platform: ShortcutPlatform): boolean {
  return (
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState("AltGraph") ||
    (platform === "windows" ? event.metaKey : event.ctrlKey) ||
    /^(Control|Meta|Alt|Shift)(Left|Right)$/.test(event.code)
  );
}
/** Mirror backend validation for immediate feedback only. */
export function validateShortcut(
  chord: ShortcutChordDto,
  platform: ShortcutPlatform,
): string | null {
  const functionKey = /^F([1-9]|1[0-2])$/.test(chord.keyCode);
  if (
    !functionKey &&
    !/^Key[A-Z]$|^Digit[0-9]$/.test(chord.keyCode) &&
    !Object.hasOwn(KEY_NAMES, chord.keyCode)
  )
    return "This key is not supported.";
  if (!functionKey && !chord.primary && !chord.alt)
    return platform === "windows"
      ? "Use Ctrl or Alt, or a function key."
      : "Use Command or Option, or a function key.";
  const reserved =
    !chord.shift &&
    (platform === "windows"
      ? (chord.alt && !chord.primary && chord.keyCode === "F4") ||
        (chord.primary && chord.alt && chord.keyCode === "Delete")
      : chord.primary &&
        ((!chord.alt && ["KeyQ", "KeyH", "KeyM"].includes(chord.keyCode)) ||
          (chord.alt && chord.keyCode === "Escape")));
  return reserved ? "This shortcut is reserved by the operating system." : null;
}
/** Normalize one complete physical event without retaining modifier state. */
export function normalizeShortcut(
  event: KeyboardEvent,
  platform: ShortcutPlatform,
): ShortcutChordDto | null {
  if (ignoreShortcutEvent(event, platform)) return null;
  const chord = {
    primary: platform === "windows" ? event.ctrlKey : event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    keyCode: event.code,
  };
  return validateShortcut(chord, platform) === null ? chord : null;
}
/** Compare every representable modifier and physical key. */
export function equalShortcut(a: ShortcutChordDto, b: ShortcutChordDto): boolean {
  return (
    a.primary === b.primary && a.alt === b.alt && a.shift === b.shift && a.keyCode === b.keyCode
  );
}
/** Match only a valid exact event. */
export function matchesShortcut(
  event: KeyboardEvent,
  chord: ShortcutChordDto,
  platform: ShortcutPlatform,
): boolean {
  const normalized = normalizeShortcut(event, platform);
  return normalized !== null && equalShortcut(normalized, chord);
}
/** Format keycaps without reverse parsing them into assignments. */
export function shortcutParts(
  chord: ShortcutChordDto,
  platform: ShortcutPlatform,
  accessible = false,
): string[] {
  const key =
    accessible && chord.keyCode.startsWith("Arrow")
      ? `Arrow ${chord.keyCode.slice(5).toLowerCase()}`
      : (KEY_NAMES[chord.keyCode] ?? chord.keyCode.replace(/^(Key|Digit)/, ""));
  return [
    ...(chord.primary ? [platform === "windows" ? "Ctrl" : "Command"] : []),
    ...(chord.alt ? [platform === "windows" ? "Alt" : "Option"] : []),
    ...(chord.shift ? ["Shift"] : []),
    key,
  ];
}
/** Format an accelerator for a tooltip. */
export function formatShortcut(chord: ShortcutChordDto, platform: ShortcutPlatform): string {
  return shortcutParts(chord, platform).join(" ");
}
