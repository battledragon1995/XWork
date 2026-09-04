import type { AppearanceSettingsDto, InterfaceColorsDto } from "@/bindings/settings";
import type { EffectiveColorScheme } from "./use-effective-color-scheme";

/** One required colour pair that the drafted Appearance value does not satisfy. */
export interface ContrastViolation {
  foregroundField: string;
  backgroundField: string;
  required: number;
  actual: number;
}

/** BE-008 accepts full six-digit hex only: no shorthand, no colour name, no `rgb(...)`. */
const FULL_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Minimum ratio for reading interface or terminal text against its own surface. */
const TEXT_CONTRAST_MINIMUM = 4.5;

/** Minimum ratio for the accent, which carries shape and not prose. */
const ACCENT_CONTRAST_MINIMUM = 3;

/** Report whether a raw value is a strict `#rrggbb` colour. */
export function isFullHex(value: string): boolean {
  return FULL_HEX_PATTERN.test(value);
}

/** Return the lowercase `#rrggbb` form, or `null` when the value is not a full hex colour. */
export function normalizeHex(value: string): string | null {
  return isFullHex(value) ? value.toLowerCase() : null;
}

/** Convert one sRGB channel byte to its WCAG linear component. */
function linearChannel(byte: number): number {
  const channel = byte / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Compute the WCAG relative luminance of one full hex colour. */
function relativeLuminance(hex: string): number {
  const red = linearChannel(Number.parseInt(hex.slice(1, 3), 16));
  const green = linearChannel(Number.parseInt(hex.slice(3, 5), 16));
  const blue = linearChannel(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Compute the WCAG contrast ratio between two colours. Full precision is kept so a caller
 * can compare against a threshold; a value that is not a full hex colour yields the neutral
 * `1` instead of throwing, because malformed input is reported by its own field error.
 */
export function contrastRatio(foreground: string, background: string): number {
  const first = normalizeHex(foreground);
  const second = normalizeHex(background);
  if (first === null || second === null) {
    return 1;
  }

  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Record one pair when both colours parse and their ratio misses the required minimum. */
function pushViolation(
  into: ContrastViolation[],
  foreground: string,
  foregroundField: string,
  background: string,
  backgroundField: string,
  required: number,
): void {
  if (normalizeHex(foreground) === null || normalizeHex(background) === null) {
    return;
  }

  const actual = contrastRatio(foreground, background);
  if (actual < required) {
    into.push({ foregroundField, backgroundField, required, actual });
  }
}

/** Collect the three required interface pairs of one scheme, using backend field paths. */
function collectInterfaceViolations(
  into: ContrastViolation[],
  scheme: EffectiveColorScheme,
  colors: InterfaceColorsDto,
): void {
  const base = `interfaceColors.${scheme}`;
  pushViolation(
    into,
    colors.text,
    `${base}.text`,
    colors.canvas,
    `${base}.canvas`,
    TEXT_CONTRAST_MINIMUM,
  );
  pushViolation(
    into,
    colors.text,
    `${base}.text`,
    colors.sidebar,
    `${base}.sidebar`,
    TEXT_CONTRAST_MINIMUM,
  );
  pushViolation(
    into,
    colors.accent,
    `${base}.accent`,
    colors.canvas,
    `${base}.canvas`,
    ACCENT_CONTRAST_MINIMUM,
  );
}

/**
 * List every BE-008 contrast rule the drafted Appearance value breaks. This mirrors the
 * backend so the page can answer instantly; the backend still decides what is stored.
 */
export function collectContrastViolations(
  appearance: AppearanceSettingsDto,
): readonly ContrastViolation[] {
  const violations: ContrastViolation[] = [];
  collectInterfaceViolations(violations, "light", appearance.interfaceColors.light);
  collectInterfaceViolations(violations, "dark", appearance.interfaceColors.dark);
  pushViolation(
    violations,
    appearance.terminalPalette.foreground,
    "terminalPalette.foreground",
    appearance.terminalPalette.background,
    "terminalPalette.background",
    TEXT_CONTRAST_MINIMUM,
  );
  return violations;
}
