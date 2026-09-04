/**
 * Tools the user picked during this run of the application.
 *
 * The list is module memory and nothing else. BE-006 states it does not own recent usage and
 * BE-005 has no field for it, so the feature records it itself — and because a session only
 * exists for one run, the list must disappear with that run too. No browser storage, no
 * settings field and no database is involved, by design.
 */

/** One successful tool selection, with the moment it happened. */
export interface RecentToolUse {
  profileId: string;
  usedAtMs: number;
}

/** Most entries the block ever keeps, so an old pick cannot linger for a whole run. */
const MAX_ENTRIES = 4;

/** Newest first. Only this module may write to it. */
let recentTools: RecentToolUse[] = [];

/**
 * Record one successful selection. A profile picked again moves to the front instead of
 * appearing twice, and the oldest entry beyond the cap is dropped.
 */
export function recordToolUse(profileId: string, atMs: number): void {
  const withoutProfile = recentTools.filter((entry) => entry.profileId !== profileId);
  recentTools = [{ profileId, usedAtMs: atMs }, ...withoutProfile].slice(0, MAX_ENTRIES);
}

/** Read the newest entries, at most `limit` of them and never more than the cap. */
export function readRecentTools(limit: number): readonly RecentToolUse[] {
  return recentTools.slice(0, Math.max(0, limit));
}

/**
 * Describe when a tool was last used, in the coarse steps the card has room for. `nowMs` is
 * a parameter rather than a `Date.now()` call so the label is a pure function of its inputs.
 */
export function formatUsedAt(usedAtMs: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - usedAtMs);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;

  if (elapsedMs < minuteMs) {
    return "just now";
  }
  if (elapsedMs < hourMs) {
    return `${Math.floor(elapsedMs / minuteMs)}m ago`;
  }

  return `${Math.floor(elapsedMs / hourMs)}h ago`;
}

/** Forget every entry, so no test case observes another case's picks. */
export function resetRecentTools(): void {
  recentTools = [];
}
