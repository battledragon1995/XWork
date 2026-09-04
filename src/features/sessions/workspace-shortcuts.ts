/** Stable identifiers for the seven workspace-local Phase 1 shortcuts. */
export type WorkspaceShortcutId =
  | "tabs.create"
  | "tabs.close"
  | "tabs.reopenClosed"
  | "panes.splitRight"
  | "panes.splitDown"
  | "panes.maximizeToggle"
  | "panes.close";

/** One exact keyboard chord and its user-facing Windows label. */
export interface WorkspaceShortcut {
  id: WorkspaceShortcutId;
  code: string;
  alt: boolean;
  shift: boolean;
  label: string;
}

/** Canonical shortcuts for FE-007 until configurable shortcuts replace this table. */
export const WORKSPACE_SHORTCUTS: readonly WorkspaceShortcut[] = [
  { id: "tabs.create", code: "KeyT", alt: false, shift: false, label: "Ctrl T" },
  { id: "tabs.close", code: "KeyW", alt: false, shift: false, label: "Ctrl W" },
  { id: "tabs.reopenClosed", code: "KeyT", alt: false, shift: true, label: "Ctrl Shift T" },
  { id: "panes.splitRight", code: "Backslash", alt: false, shift: false, label: "Ctrl \\" },
  { id: "panes.splitDown", code: "Backslash", alt: true, shift: false, label: "Ctrl Alt \\" },
  { id: "panes.maximizeToggle", code: "KeyM", alt: false, shift: true, label: "Ctrl Shift M" },
  { id: "panes.close", code: "KeyW", alt: false, shift: true, label: "Ctrl Shift W" },
];

/** Match one event only when its code and complete modifier set agree exactly. */
export function matchWorkspaceShortcut(event: KeyboardEvent): WorkspaceShortcutId | null {
  if (!event.ctrlKey || event.metaKey) {
    return null;
  }
  return (
    WORKSPACE_SHORTCUTS.find(
      (shortcut) =>
        shortcut.code === event.code &&
        shortcut.alt === event.altKey &&
        shortcut.shift === event.shiftKey,
    )?.id ?? null
  );
}

/** Read the compact Windows label for one workspace action. */
export function shortcutLabel(id: WorkspaceShortcutId): string {
  return WORKSPACE_SHORTCUTS.find((shortcut) => shortcut.id === id)?.label ?? "";
}
