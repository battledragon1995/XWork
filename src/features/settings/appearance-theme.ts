import type { AppearanceSettingsDto } from "@/bindings/settings";
import { contrastRatio } from "./appearance-contrast";
import type { EffectiveColorScheme } from "./use-effective-color-scheme";

/** Complete root-level contract one Appearance value produces for the whole window. */
export interface AppearanceDocumentStyle {
  dataTheme: EffectiveColorScheme;
  colorScheme: EffectiveColorScheme;
  zoom: string;
  variables: Readonly<Record<string, string>>;
}

/** Interface size the whole shell is authored against; every other size scales from it. */
const BASE_INTERFACE_FONT_SIZE_PX = 14;

/** Light text used on the accent whenever it beats the interface text colour. */
const LIGHT_ON_PRIMARY = "#ffffff";

/** Build one `color-mix()` string. The browser, not TypeScript, resolves the result. */
function mix(source: string, percentage: number, base: string): string {
  return `color-mix(in srgb, ${source} ${percentage}%, ${base})`;
}

/** Round the interface scale to four decimals so `zoom` and `--ui-scale` stay stable. */
function readUiScale(interfaceFontSizePx: number): string {
  const scale = interfaceFontSizePx / BASE_INTERFACE_FONT_SIZE_PX;
  return String(Math.round(scale * 10_000) / 10_000);
}

/**
 * Convert one Appearance value plus the scheme being painted into the exact attributes and
 * inline custom properties the document root carries. The four user colours override their
 * tokens directly; every derived token is emitted as a formula so the browser resolves it.
 */
export function buildAppearanceStyle(
  appearance: AppearanceSettingsDto,
  scheme: EffectiveColorScheme,
): AppearanceDocumentStyle {
  const colors = appearance.interfaceColors[scheme];
  const { accent, canvas, sidebar, text } = colors;
  const terminal = appearance.terminalPalette;
  const uiScale = readUiScale(appearance.interfaceFontSizePx);

  const variables: Record<string, string> = {
    "--color-canvas": canvas,
    "--color-sidebar": sidebar,
    "--color-surface-soft": sidebar,
    "--color-ink": text,
    "--color-brand": accent,
    "--color-surface-card": mix(text, 8, sidebar),
    "--color-cream-strong": mix(text, 14, sidebar),
    "--color-hairline": mix(text, 12, canvas),
    "--color-hairline-soft": mix(text, 7, canvas),
    "--color-body-strong": mix(text, 92, canvas),
    "--color-body": mix(text, 78, canvas),
    "--color-muted": mix(text, 58, canvas),
    "--color-muted-soft": mix(text, 42, canvas),
    "--color-brand-active": mix(text, 22, accent),
    "--color-brand-disabled": mix(accent, 30, canvas),
    // Primary buttons must stay readable whichever accent the user picked, so the label
    // takes whichever of white and the interface text colour contrasts better with it.
    "--color-on-primary":
      contrastRatio(LIGHT_ON_PRIMARY, accent) >= contrastRatio(text, accent)
        ? LIGHT_ON_PRIMARY
        : text,
    "--color-dark": terminal.background,
    "--color-dark-elevated": mix(terminal.foreground, 10, terminal.background),
    "--color-on-dark": terminal.foreground,
    "--terminal-background": terminal.background,
    "--terminal-foreground": terminal.foreground,
    "--terminal-font-size": `${appearance.terminalFontSizePx}px`,
    "--ui-font-size": `${appearance.interfaceFontSizePx}px`,
    "--ui-scale": uiScale,
  };

  terminal.ansiColors.forEach((color, index) => {
    variables[`--terminal-ansi-${index}`] = color;
  });

  return {
    dataTheme: scheme,
    colorScheme: scheme,
    zoom: uiScale,
    variables,
  };
}
