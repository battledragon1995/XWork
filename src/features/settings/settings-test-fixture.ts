import type { AppSettingsDto } from "@/bindings/settings";

/** Build a complete generated settings snapshot with optional General overrides for tests. */
export function createSettingsSnapshot(
  general: Partial<AppSettingsDto["general"]> = {},
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
    appearance: {
      themeMode: "system",
      themePreset: "cream",
      interfaceColors: {
        light: { accent: "#cc785c", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#141413" },
        dark: { accent: "#cc785c", canvas: "#181715", sidebar: "#252320", text: "#faf9f5" },
      },
      terminalPalette: {
        background: "#181715",
        foreground: "#faf9f5",
        ansiColors: [
          "#000000",
          "#800000",
          "#008000",
          "#808000",
          "#000080",
          "#800080",
          "#008080",
          "#c0c0c0",
          "#808080",
          "#ff0000",
          "#00ff00",
          "#ffff00",
          "#0000ff",
          "#ff00ff",
          "#00ffff",
          "#ffffff",
        ],
      },
      interfaceFontSizePx: 14,
      terminalFontSizePx: 14,
    },
    sidebar: { widthPx: 248, collapsed: false },
  };
}
