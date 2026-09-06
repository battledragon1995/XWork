import { invoke } from "@tauri-apps/api/core";
import { expect, it, vi } from "vitest";
import { IpcCallError } from "./ipc-error";
import {
  getKeyboardShortcuts,
  resetAllKeyboardShortcuts,
  resetKeyboardShortcut,
  setKeyboardShortcut,
} from "./keyboard-shortcuts";

/** Isolate the native command boundary. */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
/** Verify exact command names and envelopes. */
it("calls the four BE-009 commands", async () => {
  vi.mocked(invoke).mockResolvedValue({ actions: [] });
  const input = {
    actionId: "tabs.create",
    chord: { primary: true, alt: false, shift: false, keyCode: "KeyT" },
  };
  await getKeyboardShortcuts();
  await setKeyboardShortcut(input);
  await resetKeyboardShortcut(input.actionId);
  await resetAllKeyboardShortcuts();
  expect(invoke).toHaveBeenNthCalledWith(1, "get_keyboard_shortcuts", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "set_keyboard_shortcut", { input });
  expect(invoke).toHaveBeenNthCalledWith(3, "reset_keyboard_shortcut", {
    actionId: input.actionId,
  });
  expect(invoke).toHaveBeenNthCalledWith(4, "reset_all_keyboard_shortcuts", undefined);
});
/** Preserve backend error casing and classify unknown transport failures. */
it("preserves failures", async () => {
  vi.mocked(invoke).mockRejectedValueOnce({ code: "invalid_key_code", key_code: "Numpad0" });
  await expect(getKeyboardShortcuts()).rejects.toMatchObject({
    payload: { code: "invalid_key_code", key_code: "Numpad0" },
  });
  vi.mocked(invoke).mockRejectedValueOnce("transport");
  await expect(getKeyboardShortcuts()).rejects.toEqual(
    new IpcCallError("get_keyboard_shortcuts", null),
  );
});
