import { useSyncExternalStore } from "react";

/** Media query carrying the reduced-motion preference of the operating system. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Read the media query. A webview without `matchMedia` is treated as expressing no
// preference, which is the same answer a browser gives when the setting is off.
function getPrefersReducedMotion(): boolean {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

// Re-render a consumer when the operating-system preference changes.
function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

// Track the reduced-motion preference without caching a stale answer between consumers.
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, getPrefersReducedMotion);
}
