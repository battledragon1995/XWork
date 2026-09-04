// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThemeModeDto } from "@/bindings/settings";
import { mediaQueryListenerCount, resetMatchMediaStub, setMediaQueryMatches } from "@/test-setup";
import { useEffectiveColorScheme } from "./use-effective-color-scheme";

/** The single query the hook is allowed to observe. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

describe("useEffectiveColorScheme", () => {
  // Start every case from a Light operating system with no retained subscriber.
  beforeEach(() => {
    resetMatchMediaStub();
  });

  afterEach(() => {
    cleanup();
    resetMatchMediaStub();
  });

  // Verify a pinned mode is returned verbatim and never observes the operating system.
  it.each(["light", "dark"] as const)("returns the pinned %s mode", (mode) => {
    const { result } = renderHook(() => useEffectiveColorScheme(mode));

    expect(result.current).toBe(mode);
    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(0);
  });

  // Verify system mode resolves from the current operating-system preference on first render.
  it.each([
    [false, "light"],
    [true, "dark"],
  ] as const)("resolves system mode to %s", (prefersDark, expected) => {
    setMediaQueryMatches(DARK_QUERY, prefersDark);

    const { result } = renderHook(() => useEffectiveColorScheme("system"));

    expect(result.current).toBe(expected);
  });

  // Verify a live operating-system change repaints the window while the mode stays `system`.
  it("follows an operating system change in system mode", () => {
    const { result } = renderHook(() => useEffectiveColorScheme("system"));
    expect(result.current).toBe("light");

    act(() => setMediaQueryMatches(DARK_QUERY, true));
    expect(result.current).toBe("dark");

    act(() => setMediaQueryMatches(DARK_QUERY, false));
    expect(result.current).toBe("light");
  });

  // Verify a pinned mode stays pinned even when the operating system flips underneath it.
  it("ignores an operating system change in a pinned mode", () => {
    const { result } = renderHook(() => useEffectiveColorScheme("light"));

    act(() => setMediaQueryMatches(DARK_QUERY, true));

    expect(result.current).toBe("light");
  });

  // Verify switching modes while mounted re-reads the preference and drops the old listener.
  it("re-resolves when the mode changes while mounted", () => {
    setMediaQueryMatches(DARK_QUERY, true);
    const { result, rerender } = renderHook(
      ({ mode }: { mode: ThemeModeDto }) => useEffectiveColorScheme(mode),
      { initialProps: { mode: "system" as ThemeModeDto } },
    );
    expect(result.current).toBe("dark");
    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(1);

    rerender({ mode: "light" });
    expect(result.current).toBe("light");
    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(0);

    rerender({ mode: "system" });
    expect(result.current).toBe("dark");
    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(1);
  });

  // Verify unmounting removes the exact listener the hook attached.
  it("removes its listener on unmount", () => {
    const { unmount } = renderHook(() => useEffectiveColorScheme("system"));
    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(1);

    unmount();

    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(0);
  });

  // Verify a development remount cannot leave a second subscriber behind.
  it("keeps one listener across a remount", () => {
    const first = renderHook(() => useEffectiveColorScheme("system"));
    first.unmount();
    const second = renderHook(() => useEffectiveColorScheme("system"));

    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(1);

    second.unmount();
    expect(mediaQueryListenerCount(DARK_QUERY)).toBe(0);
  });

  // Verify a webview without media query support still renders a usable pinned theme.
  it("falls back to light without matchMedia", () => {
    const original = window.matchMedia;
    Reflect.deleteProperty(window, "matchMedia");

    try {
      const system = renderHook(() => useEffectiveColorScheme("system"));
      expect(system.result.current).toBe("light");

      const pinned = renderHook(() => useEffectiveColorScheme("dark"));
      expect(pinned.result.current).toBe("dark");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});
