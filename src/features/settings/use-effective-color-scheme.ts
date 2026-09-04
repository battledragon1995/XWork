import { useEffect, useState } from "react";
import type { ThemeModeDto } from "@/bindings/settings";

/** The scheme actually painted, after `system` has been resolved against the host. */
export type EffectiveColorScheme = "light" | "dark";

/** The only media query this feature is allowed to observe. */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Read the current operating-system preference, defaulting to Light without `matchMedia`. */
function readSystemScheme(): EffectiveColorScheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Resolve one theme mode into the scheme the window paints. A pinned mode is returned
 * verbatim and subscribes to nothing, so an operating-system change can never repaint a
 * window the user explicitly pinned.
 */
export function useEffectiveColorScheme(themeMode: ThemeModeDto): EffectiveColorScheme {
  const [systemScheme, setSystemScheme] = useState<EffectiveColorScheme>(readSystemScheme);

  useEffect(() => {
    if (themeMode !== "system") {
      return;
    }

    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia(DARK_QUERY);

    // The preference can change between the first render and this subscription, so the
    // current value is re-read here rather than trusting the lazy initial state.
    setSystemScheme(query.matches ? "dark" : "light");

    /** Repaint the window whenever the operating system flips its preference. */
    const handleChange = () => {
      setSystemScheme(query.matches ? "dark" : "light");
    };

    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [themeMode]);

  return themeMode === "system" ? systemScheme : themeMode;
}
