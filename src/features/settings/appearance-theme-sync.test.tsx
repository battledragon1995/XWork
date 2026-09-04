// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/app/app-providers";
import { getSettings } from "@/lib/ipc/settings";
import { resetMatchMediaStub, setMediaQueryMatches } from "@/test-setup";
import { AppearanceThemeSync } from "./appearance-theme-sync";
import { resetSettingsStore, useSettingsStore } from "./settings-store";
import { createAppearanceSettings, createSettingsSnapshot } from "./settings-test-fixture";

vi.mock("@/lib/ipc/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  restoreAppearanceDefaults: vi.fn(),
}));

const getSettingsMock = vi.mocked(getSettings);

/** The single query the theme layer is allowed to observe. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Read one inline custom property from the document root. */
function readRootVariable(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe("AppearanceThemeSync", () => {
  // Record the untouched document root so every case can restore it exactly.
  let originalAttribute: string | null = null;
  let originalStyle = "";

  beforeEach(() => {
    resetSettingsStore();
    resetMatchMediaStub();
    getSettingsMock.mockReset().mockResolvedValue(createSettingsSnapshot());
    originalAttribute = document.documentElement.getAttribute("data-theme");
    originalStyle = document.documentElement.getAttribute("style") ?? "";
  });

  afterEach(() => {
    cleanup();
    resetSettingsStore();
    resetMatchMediaStub();
    if (originalAttribute === null) {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", originalAttribute);
    }
    document.documentElement.setAttribute("style", originalStyle);
  });

  // Verify the loading window announces only its scheme, leaving the CSS tables in charge.
  it.each([
    [false, "light"],
    [true, "dark"],
  ] as const)("announces only the %s fallback scheme without a snapshot", (prefersDark, scheme) => {
    setMediaQueryMatches(DARK_QUERY, prefersDark);

    render(<AppearanceThemeSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", scheme);
    expect(readRootVariable("color-scheme")).toBe(scheme);
    expect(readRootVariable("--color-canvas")).toBe("");
    expect(readRootVariable("--terminal-ansi-0")).toBe("");
    expect(readRootVariable("zoom")).toBe("");
  });

  // Verify a committed snapshot writes the complete token contract onto the root.
  it("applies a committed snapshot", () => {
    useSettingsStore.setState({
      status: "ready",
      snapshot: createSettingsSnapshot({}, { themeMode: "light", interfaceFontSizePx: 16 }),
    });

    render(<AppearanceThemeSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(readRootVariable("color-scheme")).toBe("light");
    expect(readRootVariable("zoom")).toBe("1.1429");
    expect(readRootVariable("--color-canvas")).toBe("#faf9f5");
    expect(readRootVariable("--color-brand")).toBe("#cc785c");
    expect(readRootVariable("--color-body")).toBe("color-mix(in srgb, #141413 78%, #faf9f5)");
    expect(readRootVariable("--color-on-primary")).toBe("#141413");
    expect(readRootVariable("--terminal-background")).toBe("#181715");
    expect(readRootVariable("--terminal-ansi-12")).toBe("#b4cde6");
    expect(readRootVariable("--ui-font-size")).toBe("16px");
    expect(readRootVariable("--terminal-font-size")).toBe("13px");
  });

  // Verify a pinned Dark mode paints the Dark colour set whatever the operating system says.
  it("paints the dark set for a pinned dark mode", () => {
    setMediaQueryMatches(DARK_QUERY, false);
    useSettingsStore.setState({
      status: "ready",
      snapshot: createSettingsSnapshot({}, { themeMode: "dark" }),
    });

    render(<AppearanceThemeSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(readRootVariable("--color-canvas")).toBe("#1e1b18");
    expect(readRootVariable("--color-ink")).toBe("#f7f2ea");
  });

  // Verify system mode resolves through the operating system rather than a stored scheme.
  it("resolves system mode through the operating system", () => {
    setMediaQueryMatches(DARK_QUERY, true);
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });

    render(<AppearanceThemeSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(readRootVariable("--color-canvas")).toBe("#1e1b18");
  });

  // Verify a live operating-system change repaints the window with no further backend read.
  it("repaints when the operating system changes in system mode", () => {
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
    render(<AppearanceThemeSync />);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    act(() => setMediaQueryMatches(DARK_QUERY, true));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(readRootVariable("--color-canvas")).toBe("#1e1b18");
    expect(getSettingsMock).not.toHaveBeenCalled();
  });

  // Verify a preview outranks the committed snapshot so the window shows the drafted value.
  it("prefers the draft over the snapshot", () => {
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
    render(<AppearanceThemeSync />);

    act(() => {
      useSettingsStore.getState().previewAppearance(
        createAppearanceSettings({
          themeMode: "light",
          interfaceColors: {
            light: { accent: "#0000ff", canvas: "#ffffff", sidebar: "#eeeeee", text: "#111111" },
            dark: { accent: "#e08a6c", canvas: "#1e1b18", sidebar: "#26211d", text: "#f7f2ea" },
          },
        }),
      );
    });

    expect(readRootVariable("--color-canvas")).toBe("#ffffff");
    expect(readRootVariable("--color-brand")).toBe("#0000ff");
  });

  // Verify discarding a preview returns the window to the committed snapshot.
  it("returns to the snapshot when the draft is discarded", () => {
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
    render(<AppearanceThemeSync />);

    act(() => {
      useSettingsStore
        .getState()
        .previewAppearance(createAppearanceSettings({ themeMode: "dark" }));
    });
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    act(() => useSettingsStore.getState().discardAppearanceDraft());

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  // Verify a later snapshot replaces every value the previous one wrote.
  it("reacts to a replaced snapshot", () => {
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
    render(<AppearanceThemeSync />);
    expect(readRootVariable("--ui-font-size")).toBe("14px");

    act(() => {
      useSettingsStore.setState({
        snapshot: createSettingsSnapshot({}, { interfaceFontSizePx: 20 }),
      });
    });

    expect(readRootVariable("--ui-font-size")).toBe("20px");
    expect(readRootVariable("zoom")).toBe("1.4286");
  });

  // Verify unmount removes every property the component owns, including all ANSI slots.
  it("removes everything it wrote on unmount", () => {
    useSettingsStore.setState({ status: "ready", snapshot: createSettingsSnapshot() });
    const view = render(<AppearanceThemeSync />);

    view.unmount();

    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(readRootVariable("color-scheme")).toBe("");
    expect(readRootVariable("zoom")).toBe("");
    expect(readRootVariable("--color-canvas")).toBe("");
    for (let index = 0; index < 16; index += 1) {
      expect(readRootVariable(`--terminal-ansi-${index}`)).toBe("");
    }
  });

  // Verify the application providers mount exactly one theme host and read no settings.
  it("is mounted once by the application providers", () => {
    useSettingsStore.setState({
      status: "ready",
      snapshot: createSettingsSnapshot({}, { themeMode: "dark" }),
    });

    render(
      <AppProviders>
        <p>Application</p>
      </AppProviders>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(getSettingsMock).not.toHaveBeenCalled();
  });
});
