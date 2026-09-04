import { describe, expect, it } from "vitest";
import {
  collectContrastViolations,
  contrastRatio,
  isFullHex,
  normalizeHex,
} from "./appearance-contrast";
import { createAppearanceSettings } from "./settings-test-fixture";

describe("isFullHex", () => {
  // Verify only strict six-digit hex is accepted, in either letter case.
  it.each(["#ffffff", "#000000", "#CC785C", "#cc785c"])("accepts %s", (value) => {
    expect(isFullHex(value)).toBe(true);
  });

  // Verify shorthand, colour names, functional colours and partial input are all rejected.
  it.each(["#abc", "#ABC", "red", "rgb(1, 2, 3)", "#cc785", "#cc785cc", "cc785c", "", "#"])(
    "rejects %s",
    (value) => {
      expect(isFullHex(value)).toBe(false);
    },
  );
});

describe("normalizeHex", () => {
  // Verify a pasted uppercase value is normalized to the lowercase form the backend stores.
  it("lowercases an accepted colour", () => {
    expect(normalizeHex("#CC785C")).toBe("#cc785c");
  });

  // Verify a rejected value yields no colour at all rather than a coerced one.
  it("returns null for a rejected colour", () => {
    expect(normalizeHex("#abc")).toBeNull();
  });
});

describe("contrastRatio", () => {
  // Verify the two absolute endpoints of the WCAG sRGB scale.
  it("computes the extreme ratios", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  // Verify the ratio is symmetric, because a pair has no inherent ordering.
  it("is symmetric", () => {
    expect(contrastRatio("#141413", "#faf9f5")).toBeCloseTo(contrastRatio("#faf9f5", "#141413"), 9);
  });

  // Verify the sRGB conversion by pinning two documented greys around the 4.5:1 threshold.
  it("brackets the 4.5:1 threshold", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  // Verify the same conversion around the accent threshold.
  it("brackets the 3:1 threshold", () => {
    expect(contrastRatio("#949494", "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#959595", "#ffffff")).toBeLessThan(3);
  });

  // Verify a malformed colour yields the neutral ratio instead of throwing.
  it("returns the neutral ratio for a rejected colour", () => {
    expect(contrastRatio("#abc", "#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "rgb(0, 0, 0)")).toBe(1);
  });
});

describe("collectContrastViolations", () => {
  // Verify the shipped Cream defaults satisfy every rule the backend enforces.
  it("accepts the default appearance", () => {
    expect(collectContrastViolations(createAppearanceSettings())).toEqual([]);
  });

  // Verify unreadable Light interface text is reported with the backend's own field paths.
  it("reports both light text pairs", () => {
    const appearance = createAppearanceSettings({
      interfaceColors: {
        light: { accent: "#cc785c", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#f2f2f2" },
        dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
      },
    });

    const violations = collectContrastViolations(appearance);

    expect(violations.map((violation) => violation.foregroundField)).toEqual([
      "interfaceColors.light.text",
      "interfaceColors.light.text",
    ]);
    expect(violations.map((violation) => violation.backgroundField)).toEqual([
      "interfaceColors.light.canvas",
      "interfaceColors.light.sidebar",
    ]);
    expect(violations[0]).toMatchObject({ required: 4.5 });
    expect(violations[0]?.actual).toBeLessThan(4.5);
  });

  // Verify the accent rule uses the lower threshold and names the accent field.
  it("reports a low-contrast accent at the 3:1 threshold", () => {
    const appearance = createAppearanceSettings({
      interfaceColors: {
        light: { accent: "#f6f4ef", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#141413" },
        dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
      },
    });

    expect(collectContrastViolations(appearance)).toEqual([
      {
        foregroundField: "interfaceColors.light.accent",
        backgroundField: "interfaceColors.light.canvas",
        required: 3,
        actual: expect.any(Number),
      },
    ]);
  });

  // Verify the inactive Dark scheme is validated too, since the backend merges both sets.
  it("reports the dark scheme independently", () => {
    const appearance = createAppearanceSettings({
      interfaceColors: {
        light: { accent: "#cc785c", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#141413" },
        dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#242020" },
      },
    });

    const violations = collectContrastViolations(appearance);

    expect(violations).toHaveLength(2);
    for (const violation of violations) {
      expect(violation.foregroundField).toBe("interfaceColors.dark.text");
    }
  });

  // Verify the terminal pair is checked with its own backend field paths.
  it("reports the terminal pair", () => {
    const appearance = createAppearanceSettings({
      terminalPalette: {
        background: "#181715",
        foreground: "#2a2a2a",
        ansiColors: createAppearanceSettings().terminalPalette.ansiColors,
      },
    });

    expect(collectContrastViolations(appearance)).toEqual([
      {
        foregroundField: "terminalPalette.foreground",
        backgroundField: "terminalPalette.background",
        required: 4.5,
        actual: expect.any(Number),
      },
    ]);
  });

  // Verify simultaneous interface and terminal problems are all listed at once.
  it("reports multiple simultaneous violations", () => {
    const appearance = createAppearanceSettings({
      interfaceColors: {
        light: { accent: "#f6f4ef", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#f2f2f2" },
        dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
      },
      terminalPalette: {
        background: "#181715",
        foreground: "#2a2a2a",
        ansiColors: createAppearanceSettings().terminalPalette.ansiColors,
      },
    });

    expect(collectContrastViolations(appearance)).toHaveLength(4);
  });

  // Verify a malformed colour is left to hex validation instead of producing a false pair.
  it("skips a pair whose colour is not full hex", () => {
    const appearance = createAppearanceSettings({
      interfaceColors: {
        light: { accent: "#cc785c", canvas: "#faf9f5", sidebar: "#f5f0e8", text: "#14" },
        dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
      },
    });

    expect(collectContrastViolations(appearance)).toEqual([]);
  });

  // Verify the collector never mutates the generated snapshot it inspects.
  it("does not mutate its input", () => {
    const appearance = createAppearanceSettings();
    const before = structuredClone(appearance);

    collectContrastViolations(appearance);

    expect(appearance).toEqual(before);
  });
});
