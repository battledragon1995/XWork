import type { AppSettingsDto, AppearanceSettingsDto } from "@/bindings/settings";

/** The exact BE-008 Cream ANSI table, so fixtures cannot drift from the backend defaults. */
const CREAM_ANSI_COLORS: AppearanceSettingsDto["terminalPalette"]["ansiColors"] = [
  "#181715",
  "#c64545",
  "#5db872",
  "#e8a55a",
  "#93b4d6",
  "#b48ead",
  "#5db8a6",
  "#a09d96",
  "#3d3d3a",
  "#e08a8a",
  "#8fd19e",
  "#f0c48a",
  "#b4cde6",
  "#d0b0d8",
  "#8ed4c6",
  "#faf9f5",
];

/** Build the exact BE-008 default Appearance value: `system`, `cream`, `14 px` and `13 px`. */
export function createAppearanceSettings(
  overrides: Partial<AppearanceSettingsDto> = {},
): AppearanceSettingsDto {
  return {
    themeMode: "system",
    themePreset: "cream",
    interfaceColors: {
      light: { accent: "#cc785c", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#141413" },
      dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
    },
    terminalPalette: {
      background: "#181715",
      foreground: "#faf9f5",
      ansiColors: [...CREAM_ANSI_COLORS],
    },
    interfaceFontSizePx: 14,
    terminalFontSizePx: 13,
    ...overrides,
  };
}

/** Build a complete generated settings snapshot with optional General and Appearance overrides. */
export function createSettingsSnapshot(
  general: Partial<AppSettingsDto["general"]> = {},
  appearance: Partial<AppearanceSettingsDto> = {},
): AppSettingsDto {
  return {
    revision: "0",
    general: {
      interfaceLanguage: "english",
      closeToTray: true,
      showTrayIcon: true,
      askBeforeQuitting: true,
      openAtHomeOnLaunch: true,
      ...general,
    },
    appearance: createAppearanceSettings(appearance),
    sidebar: { widthPx: 280, collapsed: false },
  };
}
