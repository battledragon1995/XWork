import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppearanceSettingsDto,
  AppearanceSettingsPatchDto,
  InterfaceColorsDto,
  TerminalPaletteDto,
  ThemeModeDto,
} from "@/bindings/settings";
import {
  type ContrastViolation,
  collectContrastViolations,
  normalizeHex,
} from "./appearance-contrast";
import type { BuiltInThemePreset } from "./appearance-preset-cards";
import { useSettingsStore } from "./settings-store";
import { type EffectiveColorScheme, useEffectiveColorScheme } from "./use-effective-color-scheme";

/** Quiet period after which a valid colour or size edit is persisted. */
const COMMIT_DELAY_MS = 300;

/** Integer bounds BE-008 enforces for the interface size. */
const INTERFACE_FONT_MIN = 12;
const INTERFACE_FONT_MAX = 20;

/** Integer bounds BE-008 enforces for the terminal size. */
const TERMINAL_FONT_MIN = 10;
const TERMINAL_FONT_MAX = 24;

/** Which terminal colour one edit addresses; `ansi:<index>` names one indexed slot. */
export type TerminalColorKey = "background" | "foreground" | `ansi:${number}`;

/** Editing surface the Appearance page renders against. */
export interface AppearanceEditor {
  appearance: AppearanceSettingsDto;
  editedScheme: EffectiveColorScheme;
  violations: readonly ContrastViolation[];
  invalidHexFields: readonly string[];
  setEditedScheme(next: EffectiveColorScheme): void;
  setThemeMode(next: ThemeModeDto): void;
  setPreset(next: BuiltInThemePreset): void;
  setInterfaceColor(key: keyof InterfaceColorsDto, hex: string): void;
  setTerminalColor(key: TerminalColorKey, hex: string): void;
  setInterfaceFontSizePx(next: number): void;
  setTerminalFontSizePx(next: number): void;
  flushPendingCommit(): void;
}

/** Translate one terminal colour key into the field path BE-008 reports failures with. */
function terminalFieldPath(key: TerminalColorKey): string {
  if (key === "background" || key === "foreground") {
    return `terminalPalette.${key}`;
  }
  return `terminalPalette.ansiColors.${key.slice("ansi:".length)}`;
}

/** Report whether a field path belongs to the interface colour group. */
function isInterfaceField(field: string): boolean {
  return field.startsWith("interfaceColors.");
}

/** Report whether a field path belongs to the terminal palette group. */
function isTerminalField(field: string): boolean {
  return field.startsWith("terminalPalette.");
}

/**
 * Turn user intent into an immediate preview, local validation, and a debounced patch. The
 * hook owns no durable state: previews go to the shared draft and every persisted change
 * still crosses the single BE-008 command boundary through the store's write queue.
 */
export function useAppearanceEditor(committed: AppearanceSettingsDto): AppearanceEditor {
  const draft = useSettingsStore((state) => state.appearanceDraft);
  const previewAppearance = useSettingsStore((state) => state.previewAppearance);
  const commitAppearance = useSettingsStore((state) => state.commitAppearance);
  const discardAppearanceDraft = useSettingsStore((state) => state.discardAppearanceDraft);

  const appearance = draft ?? committed;
  const effectiveScheme = useEffectiveColorScheme(appearance.themeMode);
  const [manualScheme, setManualScheme] = useState<EffectiveColorScheme | null>(null);
  const [invalidHexFields, setInvalidHexFields] = useState<readonly string[]>([]);
  const editedScheme = manualScheme ?? effectiveScheme;
  const violations = useMemo(() => collectContrastViolations(appearance), [appearance]);

  const pendingPatchRef = useRef<AppearanceSettingsPatchDto>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidFieldsRef = useRef<readonly string[]>(invalidHexFields);
  invalidFieldsRef.current = invalidHexFields;

  // Cleanup runs once on unmount but must see the newest callbacks and validation result,
  // so the whole teardown is kept in a ref that every render refreshes.
  const cleanupRef = useRef<() => void>(() => {});

  /** Stop a scheduled commit without discarding what it would have sent. */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flushPendingCommit = useCallback(() => {
    clearTimer();
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length > 0) {
      void commitAppearance(patch);
    }
  }, [clearTimer, commitAppearance]);

  /**
   * Record or withdraw one patch field. Independent fields accumulate into one patch, so a
   * size edit made moments after a colour edit is never lost by restarting the timer.
   */
  const queueField = useCallback(
    <TKey extends keyof AppearanceSettingsPatchDto>(
      key: TKey,
      value: AppearanceSettingsPatchDto[TKey] | undefined,
    ) => {
      if (value === undefined) {
        delete pendingPatchRef.current[key];
      } else {
        pendingPatchRef.current[key] = value;
      }

      clearTimer();
      if (Object.keys(pendingPatchRef.current).length > 0) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          flushPendingCommit();
        }, COMMIT_DELAY_MS);
      }
    },
    [clearTimer, flushPendingCommit],
  );

  /** Add or remove one field from the malformed-hex set, keeping the ref in step. */
  const markHexValidity = useCallback((field: string, valid: boolean) => {
    const current = invalidFieldsRef.current;
    const listed = current.includes(field);
    if (valid !== listed) {
      return;
    }

    const next = valid ? current.filter((item) => item !== field) : [...current, field];
    invalidFieldsRef.current = next;
    setInvalidHexFields(next);
  }, []);

  const setThemeMode = useCallback(
    (next: ThemeModeDto) => {
      previewAppearance({ ...appearance, themeMode: next });
      void commitAppearance({ themeMode: next });
    },
    [appearance, commitAppearance, previewAppearance],
  );

  const setPreset = useCallback(
    (next: BuiltInThemePreset) => {
      // A built-in preset replaces every backend-owned colour, so any pending colour edit
      // and its preview are dropped rather than merged into a forbidden combination.
      clearTimer();
      pendingPatchRef.current = {};
      invalidFieldsRef.current = [];
      setInvalidHexFields([]);
      discardAppearanceDraft();
      void commitAppearance({ themePreset: next });
    },
    [clearTimer, commitAppearance, discardAppearanceDraft],
  );

  const setInterfaceColor = useCallback(
    (key: keyof InterfaceColorsDto, hex: string) => {
      const field = `interfaceColors.${editedScheme}.${key}`;
      const normalized = normalizeHex(hex);
      if (normalized === null) {
        markHexValidity(field, false);
        queueField("interfaceColors", undefined);
        return;
      }

      markHexValidity(field, true);
      const nextColors = {
        light: { ...appearance.interfaceColors.light },
        dark: { ...appearance.interfaceColors.dark },
      };
      nextColors[editedScheme][key] = normalized;
      const next: AppearanceSettingsDto = { ...appearance, interfaceColors: nextColors };
      previewAppearance(next);

      const blocked =
        collectContrastViolations(next).some((violation) =>
          isInterfaceField(violation.foregroundField),
        ) || invalidFieldsRef.current.some(isInterfaceField);
      queueField("interfaceColors", blocked ? undefined : nextColors);
    },
    [appearance, editedScheme, markHexValidity, previewAppearance, queueField],
  );

  const setTerminalColor = useCallback(
    (key: TerminalColorKey, hex: string) => {
      const field = terminalFieldPath(key);
      const normalized = normalizeHex(hex);
      if (normalized === null) {
        markHexValidity(field, false);
        queueField("terminalPalette", undefined);
        return;
      }

      markHexValidity(field, true);
      const nextPalette: TerminalPaletteDto = {
        background: appearance.terminalPalette.background,
        foreground: appearance.terminalPalette.foreground,
        ansiColors: [...appearance.terminalPalette.ansiColors],
      };
      if (key === "background" || key === "foreground") {
        nextPalette[key] = normalized;
      } else {
        const index = Number.parseInt(key.slice("ansi:".length), 10);
        if (!Number.isInteger(index) || index < 0 || index > 15) {
          return;
        }
        nextPalette.ansiColors[index] = normalized;
      }

      const next: AppearanceSettingsDto = { ...appearance, terminalPalette: nextPalette };
      previewAppearance(next);

      const blocked =
        collectContrastViolations(next).some((violation) =>
          isTerminalField(violation.foregroundField),
        ) || invalidFieldsRef.current.some(isTerminalField);
      queueField("terminalPalette", blocked ? undefined : nextPalette);
    },
    [appearance, markHexValidity, previewAppearance, queueField],
  );

  const setInterfaceFontSizePx = useCallback(
    (next: number) => {
      if (!Number.isInteger(next) || next < INTERFACE_FONT_MIN || next > INTERFACE_FONT_MAX) {
        return;
      }
      previewAppearance({ ...appearance, interfaceFontSizePx: next });
      queueField("interfaceFontSizePx", next);
    },
    [appearance, previewAppearance, queueField],
  );

  const setTerminalFontSizePx = useCallback(
    (next: number) => {
      if (!Number.isInteger(next) || next < TERMINAL_FONT_MIN || next > TERMINAL_FONT_MAX) {
        return;
      }
      previewAppearance({ ...appearance, terminalFontSizePx: next });
      queueField("terminalFontSizePx", next);
    },
    [appearance, previewAppearance, queueField],
  );

  cleanupRef.current = () => {
    flushPendingCommit();
    // A preview the backend would refuse cannot survive the page, so the window returns to
    // the last committed theme instead of showing an unsaveable colour forever.
    if (violations.length > 0 || invalidFieldsRef.current.length > 0) {
      discardAppearanceDraft();
    }
  };

  useEffect(() => () => cleanupRef.current(), []);

  return {
    appearance,
    editedScheme,
    violations,
    invalidHexFields,
    setEditedScheme: setManualScheme,
    setThemeMode,
    setPreset,
    setInterfaceColor,
    setTerminalColor,
    setInterfaceFontSizePx,
    setTerminalFontSizePx,
    flushPendingCommit,
  };
}
