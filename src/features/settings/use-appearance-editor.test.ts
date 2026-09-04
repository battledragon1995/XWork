// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsDto, AppearanceSettingsDto } from "@/bindings/settings";
import { restoreAppearanceDefaults, updateSettings } from "@/lib/ipc/settings";
import { resetMatchMediaStub, setMediaQueryMatches } from "@/test-setup";
import { resetSettingsStore, useSettingsStore } from "./settings-store";
import { createAppearanceSettings, createSettingsSnapshot } from "./settings-test-fixture";
import { useAppearanceEditor } from "./use-appearance-editor";

vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
}));

const updateSettingsMock = vi.mocked(updateSettings);
const restoreAppearanceDefaultsMock = vi.mocked(restoreAppearanceDefaults);

/** The single query the theme layer is allowed to observe. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Mount the editor over one committed Appearance value held by the shared store. */
function mountEditor(committed: AppearanceSettingsDto = createAppearanceSettings()) {
  useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
  return renderHook(() => useAppearanceEditor(committed));
}

/** Read the Appearance patch of the nth `update_settings` call. */
function patchOf(callIndex: number) {
  return updateSettingsMock.mock.calls[callIndex]?.[0]?.appearance;
}

describe("useAppearanceEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettingsStore();
    resetMatchMediaStub();
    updateSettingsMock.mockReset().mockResolvedValue(createSettingsSnapshot() as AppSettingsDto);
    restoreAppearanceDefaultsMock.mockReset().mockResolvedValue(createSettingsSnapshot());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetSettingsStore();
    resetMatchMediaStub();
  });

  // Verify the editor reads the committed value until a preview exists.
  it("starts from the committed appearance", () => {
    const committed = createAppearanceSettings({ interfaceFontSizePx: 17 });
    const { result } = mountEditor(committed);

    expect(result.current.appearance).toBe(committed);
    expect(result.current.violations).toEqual([]);
    expect(result.current.invalidHexFields).toEqual([]);
  });

  // Verify a theme mode previews and persists at once, without waiting for a quiet period.
  it("commits a theme mode immediately", () => {
    const { result } = mountEditor();

    act(() => result.current.setThemeMode("dark"));

    expect(useSettingsStore.getState().appearanceDraft).toMatchObject({ themeMode: "dark" });
    expect(patchOf(0)).toEqual({ themeMode: "dark" });
  });

  // Verify a preset commits alone and invents no local palette for the window to paint.
  it("commits a preset without a local preview", () => {
    const { result } = mountEditor();

    act(() => result.current.setPreset("ink"));

    expect(patchOf(0)).toEqual({ themePreset: "ink" });
    expect(useSettingsStore.getState().appearanceDraft).toBeNull();
  });

  // Verify one interface colour previews at once and persists both complete schemes.
  it("sends both complete interface schemes", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor("accent", "#3b6ea8"));
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().appearanceDraft?.interfaceColors.light.accent).toBe(
      "#3b6ea8",
    );

    act(() => vi.advanceTimersByTime(300));

    const patch = patchOf(0);
    expect(Object.keys(patch ?? {})).toEqual(["interfaceColors"]);
    expect(patch?.interfaceColors).toEqual({
      light: { accent: "#3b6ea8", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#141413" },
      dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
    });
  });

  // Verify an uppercase colour is normalized before it previews or is persisted.
  it("normalizes an uppercase colour", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor("accent", "#3B6EA8"));
    act(() => vi.advanceTimersByTime(300));

    expect(patchOf(0)?.interfaceColors?.light.accent).toBe("#3b6ea8");
  });

  // Verify editing the inactive scheme changes only that set and never the theme mode.
  it("edits the inactive scheme without changing the theme mode", () => {
    const { result } = mountEditor();

    act(() => result.current.setEditedScheme("dark"));
    act(() => result.current.setInterfaceColor("canvas", "#101010"));
    act(() => vi.advanceTimersByTime(300));

    const patch = patchOf(0);
    expect(patch?.interfaceColors?.dark.canvas).toBe("#101010");
    expect(patch?.interfaceColors?.light.canvas).toBe("#faf9f5");
    expect(patch?.themeMode).toBeUndefined();
  });

  // Verify a terminal edit persists the background, foreground and all sixteen ANSI slots.
  it("sends the complete terminal palette", () => {
    const { result } = mountEditor();

    act(() => result.current.setTerminalColor("ansi:3", "#ffcc00"));
    act(() => vi.advanceTimersByTime(300));

    const palette = patchOf(0)?.terminalPalette;
    expect(Object.keys(patchOf(0) ?? {})).toEqual(["terminalPalette"]);
    expect(palette?.ansiColors).toHaveLength(16);
    expect(palette?.ansiColors[3]).toBe("#ffcc00");
    expect(palette?.ansiColors[2]).toBe("#5db872");
    expect(palette?.background).toBe("#181715");
    expect(palette?.foreground).toBe("#faf9f5");
  });

  // Verify each size control sends only its own field.
  it.each([
    ["setInterfaceFontSizePx", 18, "interfaceFontSizePx"],
    ["setTerminalFontSizePx", 20, "terminalFontSizePx"],
  ] as const)("sends only %s", (setter, value, field) => {
    const { result } = mountEditor();

    act(() => result.current[setter](value));
    act(() => vi.advanceTimersByTime(300));

    expect(patchOf(0)).toEqual({ [field]: value });
  });

  // Verify a size outside the backend bounds is refused before it can preview or be sent.
  it.each([
    ["setInterfaceFontSizePx", 11],
    ["setInterfaceFontSizePx", 21],
    ["setInterfaceFontSizePx", 14.5],
    ["setTerminalFontSizePx", 9],
    ["setTerminalFontSizePx", 25],
  ] as const)("refuses %s with %s", (setter, value) => {
    const { result } = mountEditor();

    act(() => result.current[setter](value));
    act(() => vi.advanceTimersByTime(300));

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().appearanceDraft).toBeNull();
  });

  // Verify rapid edits restart the one quiet period instead of persisting each step.
  it("restarts the quiet period on every edit", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceFontSizePx(15));
    act(() => vi.advanceTimersByTime(250));
    act(() => result.current.setInterfaceFontSizePx(16));
    act(() => vi.advanceTimersByTime(250));
    expect(updateSettingsMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(50));

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(patchOf(0)).toEqual({ interfaceFontSizePx: 16 });
  });

  // Verify independent fields edited inside one quiet period travel together.
  it("coalesces independent fields into one patch", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceFontSizePx(15));
    act(() => result.current.setTerminalFontSizePx(11));
    act(() => result.current.setInterfaceColor("accent", "#3b6ea8"));
    act(() => vi.advanceTimersByTime(300));

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    const patch = patchOf(0);
    expect(patch?.interfaceFontSizePx).toBe(15);
    expect(patch?.terminalFontSizePx).toBe(11);
    expect(patch?.interfaceColors?.light.accent).toBe("#3b6ea8");
  });

  // Verify an explicit flush persists the pending value without waiting.
  it("flushes a pending commit on request", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor("accent", "#3b6ea8"));
    act(() => result.current.flushPendingCommit());

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(300));
    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });

  // Verify leaving the page immediately after an edit still persists that last value.
  it("flushes the last valid commit on unmount", () => {
    const { result, unmount } = mountEditor();

    act(() => result.current.setTerminalFontSizePx(12));
    unmount();

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(patchOf(0)).toEqual({ terminalFontSizePx: 12 });
  });

  // Verify malformed text neither previews nor is persisted, and is reported to the page.
  it("blocks a malformed interface colour", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor("accent", "#3b6"));
    act(() => vi.advanceTimersByTime(300));

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().appearanceDraft).toBeNull();
    expect(result.current.invalidHexFields).toEqual(["interfaceColors.light.accent"]);
  });

  // Verify a malformed colour also blocks the sibling fields of the same group.
  it("blocks the whole group while one field is malformed", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor("accent", "rgb(1, 2, 3)"));
    act(() => result.current.setInterfaceColor("canvas", "#fefefe"));
    act(() => vi.advanceTimersByTime(300));

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().appearanceDraft?.interfaceColors.light.canvas).toBe(
      "#fefefe",
    );
  });

  // Verify correcting the malformed field releases the group again.
  it("releases the group once the malformed field is corrected", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor("accent", "#3b6"));
    act(() => result.current.setInterfaceColor("accent", "#3b6ea8"));
    act(() => vi.advanceTimersByTime(300));

    expect(result.current.invalidHexFields).toEqual([]);
    expect(patchOf(0)?.interfaceColors?.light.accent).toBe("#3b6ea8");
  });

  // Verify each contrast rule previews the problem but refuses to persist it.
  it.each([
    ["text", "#f2f2f2", "interfaceColors.light.text"],
    ["accent", "#f6f4ef", "interfaceColors.light.accent"],
  ] as const)("previews but never sends a low-contrast %s", (key, hex, foregroundField) => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor(key, hex));
    act(() => vi.advanceTimersByTime(300));

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().appearanceDraft?.interfaceColors.light[key]).toBe(hex);
    expect(result.current.violations.map((violation) => violation.foregroundField)).toContain(
      foregroundField,
    );
  });

  // Verify the terminal rule behaves the same way and names its own pair.
  it("previews but never sends a low-contrast terminal pair", () => {
    const { result } = mountEditor();

    act(() => result.current.setTerminalColor("foreground", "#2a2a2a"));
    act(() => vi.advanceTimersByTime(300));

    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(result.current.violations).toEqual([
      {
        foregroundField: "terminalPalette.foreground",
        backgroundField: "terminalPalette.background",
        required: 4.5,
        actual: expect.any(Number),
      },
    ]);
  });

  // Verify an unrelated row still persists while one group is blocked.
  it("keeps committing unrelated rows while a group is blocked", () => {
    const { result } = mountEditor();

    act(() => result.current.setInterfaceColor("text", "#f2f2f2"));
    act(() => result.current.setTerminalFontSizePx(18));
    act(() => vi.advanceTimersByTime(300));

    expect(updateSettingsMock).toHaveBeenCalledOnce();
    expect(patchOf(0)).toEqual({ terminalFontSizePx: 18 });
  });

  // Verify an unsaveable preview is dropped when the user leaves the page.
  it("discards an unsaveable preview on unmount", () => {
    const { result, unmount } = mountEditor();

    act(() => result.current.setInterfaceColor("text", "#f2f2f2"));
    expect(useSettingsStore.getState().appearanceDraft).not.toBeNull();

    unmount();

    expect(useSettingsStore.getState().appearanceDraft).toBeNull();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  // Verify a valid preview survives unmount, because its commit is on the way.
  it("keeps a valid preview on unmount", () => {
    const { result, unmount } = mountEditor();

    act(() => result.current.setInterfaceColor("accent", "#3b6ea8"));
    unmount();

    expect(useSettingsStore.getState().appearanceDraft).not.toBeNull();
    expect(updateSettingsMock).toHaveBeenCalledOnce();
  });

  // Verify the edited scheme starts on the scheme the window is actually painting.
  it("defaults the edited scheme to the effective scheme", () => {
    setMediaQueryMatches(DARK_QUERY, true);

    const { result } = mountEditor();

    expect(result.current.editedScheme).toBe("dark");
  });

  // Verify the edited scheme keeps following the mode until the user chooses one.
  it("follows the theme mode until the user chooses", () => {
    const { result } = mountEditor();
    expect(result.current.editedScheme).toBe("light");

    act(() => setMediaQueryMatches(DARK_QUERY, true));

    expect(result.current.editedScheme).toBe("dark");
  });

  // Verify an explicit choice is stable against later operating-system changes.
  it("keeps a manual edited scheme", () => {
    const { result } = mountEditor();

    act(() => result.current.setEditedScheme("light"));
    act(() => setMediaQueryMatches(DARK_QUERY, true));

    expect(result.current.editedScheme).toBe("light");
  });

  // Verify the generated snapshot is never mutated while a nested value is edited.
  it("never mutates the committed snapshot", () => {
    const committed = createAppearanceSettings();
    const before = structuredClone(committed);
    const { result } = mountEditor(committed);

    act(() => result.current.setInterfaceColor("accent", "#3b6ea8"));
    act(() => result.current.setTerminalColor("ansi:0", "#010203"));

    expect(committed).toEqual(before);
  });
});
