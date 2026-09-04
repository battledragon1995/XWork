import type { PaneDto, PaneLayoutNodeDto } from "@/bindings/sessions/sessions";

/** Maximum pane count BE-005 accepts for one tab. */
export const PANE_LIMIT = 4;

/** Smallest committed first-panel ratio. */
export const MIN_RATIO_BASIS_POINTS = 1000;

/** Largest committed first-panel ratio. */
export const MAX_RATIO_BASIS_POINTS = 9000;

/** Return pane leaves in stable first-then-second tree order. */
export function flattenPanes(layout: PaneLayoutNodeDto): readonly PaneDto[] {
  return layout.kind === "pane"
    ? [layout.pane]
    : [...flattenPanes(layout.first), ...flattenPanes(layout.second)];
}

/** Count all pane leaves in one binary layout tree. */
export function countPanes(layout: PaneLayoutNodeDto): number {
  return flattenPanes(layout).length;
}

/** Find one pane by opaque id without modifying its tree. */
export function findPane(layout: PaneLayoutNodeDto, paneId: string): PaneDto | null {
  return flattenPanes(layout).find((pane) => pane.id === paneId) ?? null;
}

/** Return a pane's one-based leaf position, or zero when absent. */
export function paneIndex(layout: PaneLayoutNodeDto, paneId: string): number {
  const index = flattenPanes(layout).findIndex((pane) => pane.id === paneId);
  return index < 0 ? 0 : index + 1;
}

/** Clamp and round a ratio to BE-005's accepted integer interval. */
export function clampRatioBasisPoints(value: number): number {
  return Math.min(MAX_RATIO_BASIS_POINTS, Math.max(MIN_RATIO_BASIS_POINTS, Math.round(value)));
}

/** Convert integer basis points to the percentage used by the panel library. */
export function ratioToPercent(basisPoints: number): number {
  return clampRatioBasisPoints(basisPoints) / 100;
}

/** Convert a panel percentage to a clamped integer backend ratio. */
export function percentToRatioBasisPoints(percent: number): number {
  return clampRatioBasisPoints(percent * 100);
}

/** Resolve the post-removal insertion anchor, returning the current anchor for a no-op. */
export function resolveMoveBeforeTabId(
  tabIds: readonly string[],
  tabId: string,
  toIndex: number,
): string | null {
  const fromIndex = tabIds.indexOf(tabId);
  if (fromIndex < 0) {
    return null;
  }

  const remaining = tabIds.filter((id) => id !== tabId);
  const boundedIndex = Math.max(0, Math.min(toIndex, remaining.length));
  if (
    boundedIndex === fromIndex ||
    (fromIndex === tabIds.length - 1 && boundedIndex === remaining.length)
  ) {
    return tabIds[fromIndex + 1] ?? null;
  }
  return remaining[boundedIndex] ?? null;
}
