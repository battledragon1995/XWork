import { useEffect } from "react";
import { buildAppearanceStyle } from "./appearance-theme";
import { useSettingsStore } from "./settings-store";
import { useEffectiveColorScheme } from "./use-effective-color-scheme";

/**
 * Apply the drafted or committed Appearance value to the whole window. This is the only
 * writer of the FE-012 root attributes, so a live preview and a saved value follow exactly
 * the same path. Before a snapshot exists only the scheme is announced, which leaves the
 * static token tables in `index.css` in charge and avoids a wrong-colour flash.
 */
export function AppearanceThemeSync(): null {
  const snapshot = useSettingsStore((state) => state.snapshot);
  const draft = useSettingsStore((state) => state.appearanceDraft);
  const appearance = draft ?? snapshot?.appearance ?? null;
  const scheme = useEffectiveColorScheme(appearance?.themeMode ?? "system");

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", scheme);
    root.style.setProperty("color-scheme", scheme);

    if (appearance === null) {
      return () => {
        root.removeAttribute("data-theme");
        root.style.removeProperty("color-scheme");
      };
    }

    const style = buildAppearanceStyle(appearance, scheme);
    root.style.setProperty("zoom", style.zoom);
    for (const [name, value] of Object.entries(style.variables)) {
      root.style.setProperty(name, value);
    }

    // Only the exact properties written above are removed, so cleanup can never restore a
    // stale colour from an earlier snapshot or leak one into another test.
    return () => {
      root.removeAttribute("data-theme");
      root.style.removeProperty("color-scheme");
      root.style.removeProperty("zoom");
      for (const name of Object.keys(style.variables)) {
        root.style.removeProperty(name);
      }
    };
  }, [appearance, scheme]);

  return null;
}
