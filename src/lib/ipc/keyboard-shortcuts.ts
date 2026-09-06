import type {
  KeyboardShortcutsDto,
  KeyboardShortcutsError,
  SetKeyboardShortcutInputDto,
} from "@/bindings/keyboard-shortcuts";
import { invokeCommand } from "./ipc-error";

/** Read the committed shortcut catalog. */
export function getKeyboardShortcuts(): Promise<KeyboardShortcutsDto> {
  return invokeCommand<KeyboardShortcutsDto, KeyboardShortcutsError>("get_keyboard_shortcuts");
}
/** Save one assignment and return the committed catalog. */
export function setKeyboardShortcut(
  input: SetKeyboardShortcutInputDto,
): Promise<KeyboardShortcutsDto> {
  return invokeCommand<KeyboardShortcutsDto, KeyboardShortcutsError>("set_keyboard_shortcut", {
    input,
  });
}
/** Restore one backend default. */
export function resetKeyboardShortcut(actionId: string): Promise<KeyboardShortcutsDto> {
  return invokeCommand<KeyboardShortcutsDto, KeyboardShortcutsError>("reset_keyboard_shortcut", {
    actionId,
  });
}
/** Restore all defaults, including orphan overrides. */
export function resetAllKeyboardShortcuts(): Promise<KeyboardShortcutsDto> {
  return invokeCommand<KeyboardShortcutsDto, KeyboardShortcutsError>(
    "reset_all_keyboard_shortcuts",
  );
}
