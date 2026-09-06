import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import {
  formatShortcut,
  matchesShortcut,
  type ShortcutPlatform,
} from "@/lib/utils/keyboard-shortcuts";
/** Stable identifiers for the seven workspace-local Phase 1 shortcuts. */
export type WorkspaceShortcutId =
  | "tabs.create"
  | "tabs.close"
  | "tabs.reopenClosed"
  | "panes.splitRight"
  | "panes.splitDown"
  | "panes.maximizeToggle"
  | "panes.close";

const ACTION_IDS: Record<WorkspaceShortcutId, string> = {
  "tabs.create": "tabs.create",
  "tabs.close": "tabs.close",
  "tabs.reopenClosed": "tabs.reopen_closed",
  "panes.splitRight": "panes.split_right",
  "panes.splitDown": "panes.split_down",
  "panes.maximizeToggle": "panes.maximize_toggle",
  "panes.close": "panes.close",
};
/** Match the seven existing handlers against committed, unique assignments only. */
export function matchWorkspaceShortcut(
  event: KeyboardEvent,
  snapshot: KeyboardShortcutsDto | null = null,
  platform: ShortcutPlatform | null = null,
): WorkspaceShortcutId | null {
  if (snapshot === null || platform === null || event.defaultPrevented) return null;
  for (const id of Object.keys(ACTION_IDS) as WorkspaceShortcutId[]) {
    const action = snapshot.actions.find(
      // Resolve the existing local callback ID to its canonical backend action.
      (item) => item.actionId === ACTION_IDS[id],
    );
    if (
      action?.scope === "application" &&
      action.isDispatchable &&
      action.conflictsWith.length === 0 &&
      matchesShortcut(event, action.currentChord, platform)
    )
      return id;
  }
  return null;
}
/** Return current accelerator text or a visible conflict warning. */
export function shortcutLabel(
  id: WorkspaceShortcutId,
  snapshot: KeyboardShortcutsDto | null = null,
  platform: ShortcutPlatform | null = null,
): string {
  if (snapshot === null || platform === null) return "";
  const action = snapshot.actions.find(
    // Share the exact same catalog source used by dispatch.
    (item) => item.actionId === ACTION_IDS[id],
  );
  if (action === undefined) return "";
  if (action.conflictsWith.length > 0) return "Shortcut conflict — change it in Settings";
  return action.scope === "application" && action.isDispatchable
    ? formatShortcut(action.currentChord, platform)
    : "";
}
/** Append an accelerator only when configuration supplies one. */
export function workspaceActionLabel(
  label: string,
  id: WorkspaceShortcutId,
  snapshot: KeyboardShortcutsDto | null = null,
  platform: ShortcutPlatform | null = null,
): string {
  const shortcut = shortcutLabel(id, snapshot, platform);
  return shortcut ? `${label} (${shortcut})` : label;
}
