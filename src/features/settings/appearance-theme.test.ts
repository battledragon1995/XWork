import { describe, expect, it } from "vitest";
import { buildAppearanceStyle } from "./appearance-theme";
import { createAppearanceSettings } from "./settings-test-fixture";

/** Read one built variable, so each assertion names the token it protects. */
function readVariable(
  appearance: Parameters<typeof buildAppearanceStyle>[0],
  scheme: Parameters<typeof buildAppearanceStyle>[1],
  name: string,
): string | undefined {
  return buildAppearanceStyle(appearance, scheme).variables[name];
}

describe("buildAppearanceStyle", () => {
  // Verify the root attributes follow the scheme actually being painted.
  it.each(["light", "dark"] as const)("reports %s as the painted scheme", (scheme) => {
    const style = buildAppearanceStyle(createAppearanceSettings(), scheme);

    expect(style.dataTheme).toBe(scheme);
    expect(style.colorScheme).toBe(scheme);
  });

  // Verify the four user-owned colours override their tokens directly, with no formula.
  it("applies the four light interface colours directly", () => {
    const style = buildAppearanceStyle(createAppearanceSettings(), "light");

    expect(style.variables).toMatchObject({
      "--color-canvas": "#faf9f5",
      "--color-sidebar": "#f5f0e8",
      "--color-surface-soft": "#f5f0e8",
      "--color-ink": "#141413",
      "--color-brand": "#cc785c",
    });
  });

  // Verify the same four tokens read the Dark set when Dark is painted.
  it("applies the four dark interface colours directly", () => {
    const style = buildAppearanceStyle(createAppearanceSettings(), "dark");

    expect(style.variables).toMatchObject({
      "--color-canvas": "#1e1b18",
      "--color-sidebar": "#26211d",
      "--color-surface-soft": "#26211d",
      "--color-ink": "#f7f2ea",
      "--color-brand": "#e08a6c",
    });
  });

  // Verify every derived token keeps its exact formula, percentage and source colours.
  it.each([
    ["--color-surface-card", "color-mix(in srgb, #141413 8%, #f5f0e8)"],
    ["--color-cream-strong", "color-mix(in srgb, #141413 14%, #f5f0e8)"],
    ["--color-hairline", "color-mix(in srgb, #141413 12%, #faf9f5)"],
    ["--color-hairline-soft", "color-mix(in srgb, #141413 7%, #faf9f5)"],
    ["--color-body-strong", "color-mix(in srgb, #141413 92%, #faf9f5)"],
    ["--color-body", "color-mix(in srgb, #141413 78%, #faf9f5)"],
    ["--color-muted", "color-mix(in srgb, #141413 58%, #faf9f5)"],
    ["--color-muted-soft", "color-mix(in srgb, #141413 42%, #faf9f5)"],
    ["--color-brand-active", "color-mix(in srgb, #141413 22%, #cc785c)"],
    ["--color-brand-disabled", "color-mix(in srgb, #cc785c 30%, #faf9f5)"],
  ])("emits %s as its exact formula", (name, expected) => {
    expect(readVariable(createAppearanceSettings(), "light", name)).toBe(expected);
  });

  // Verify the primary label picks whichever candidate reads better on the accent.
  it("selects the higher-contrast primary label", () => {
    expect(readVariable(createAppearanceSettings(), "light", "--color-on-primary")).toBe("#141413");
    expect(readVariable(createAppearanceSettings(), "dark", "--color-on-primary")).toBe("#ffffff");
  });

  // Verify a very dark accent flips the label to white in the same scheme.
  it("selects white on a dark accent", () => {
    const appearance = createAppearanceSettings({
      interfaceColors: {
        light: { accent: "#101010", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#141413" },
        dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
      },
    });

    expect(readVariable(appearance, "light", "--color-on-primary")).toBe("#ffffff");
  });

  // Verify the dark-surface tokens follow the terminal palette rather than the interface set.
  it("derives the dark surface tokens from the terminal palette", () => {
    const style = buildAppearanceStyle(createAppearanceSettings(), "light");

    expect(style.variables).toMatchObject({
      "--color-dark": "#181715",
      "--color-on-dark": "#faf9f5",
      "--color-dark-elevated": "color-mix(in srgb, #faf9f5 10%, #181715)",
      "--terminal-background": "#181715",
      "--terminal-foreground": "#faf9f5",
    });
  });

  // Verify all sixteen ANSI slots are published in order for the future terminal consumer.
  it("publishes every indexed ANSI colour", () => {
    const appearance = createAppearanceSettings();
    const style = buildAppearanceStyle(appearance, "light");

    for (let index = 0; index < 16; index += 1) {
      expect(style.variables[`--terminal-ansi-${index}`]).toBe(
        appearance.terminalPalette.ansiColors[index],
      );
    }
    expect(style.variables["--terminal-ansi-16"]).toBeUndefined();
  });

  // Verify both font sizes are published in pixels and the terminal size is not rescaled.
  it("publishes both font sizes verbatim", () => {
    const style = buildAppearanceStyle(
      createAppearanceSettings({ interfaceFontSizePx: 20, terminalFontSizePx: 11 }),
      "light",
    );

    expect(style.variables["--ui-font-size"]).toBe("20px");
    expect(style.variables["--terminal-font-size"]).toBe("11px");
  });

  // Verify the interface scale and the document zoom agree at both bounds and the base size.
  it.each([
    [12, "0.8571"],
    [14, "1"],
    [20, "1.4286"],
  ])("scales interface size %i to %s", (interfaceFontSizePx, expected) => {
    const style = buildAppearanceStyle(createAppearanceSettings({ interfaceFontSizePx }), "light");

    expect(style.variables["--ui-scale"]).toBe(expected);
    expect(style.zoom).toBe(expected);
  });

  // Verify the pure builder neither mutates nor reads anything outside its arguments.
  it("does not mutate the appearance it reads", () => {
    const appearance = createAppearanceSettings();
    const before = structuredClone(appearance);

    buildAppearanceStyle(appearance, "dark");

    expect(appearance).toEqual(before);
  });
});
