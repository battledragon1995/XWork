import { useEffect } from "react";
import type { SplitDirectionDto } from "@/bindings/sessions/sessions";
import { matchWorkspaceShortcut } from "./workspace-shortcuts";

/** Callbacks and global enablement for workspace-local shortcuts. */
export interface WorkspaceShortcutHandlers {
  isEnabled: boolean;
  canCreateTab?: boolean;
  canCloseTab?: boolean;
  canReopenTab?: boolean;
  canSplit?: boolean;
  canToggleMaximize?: boolean;
  canClosePane?: boolean;
  onCreateTab(): void;
  onCloseTab(): void;
  onReopenTab(): void;
  onSplit(direction: SplitDirectionDto): void;
  onToggleMaximize(): void;
  onClosePane(): void;
}

/** Return whether the event belongs to a control accepting typed text. */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Register the seven exact Windows shortcuts for the mounted workspace. */
export function useWorkspaceShortcuts(handlers: WorkspaceShortcutHandlers): void {
  useEffect(() => {
    /** Dispatch one available shortcut and suppress WebView2 only after it is accepted. */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        !handlers.isEnabled ||
        event.repeat ||
        event.isComposing ||
        isEditableTarget(event.target) ||
        document.querySelector('[role="dialog"]') !== null
      ) {
        return;
      }

      const shortcut = matchWorkspaceShortcut(event);
      if (shortcut === null) return;

      const isAvailable =
        (shortcut === "tabs.create" && handlers.canCreateTab !== false) ||
        (shortcut === "tabs.close" && handlers.canCloseTab !== false) ||
        (shortcut === "tabs.reopenClosed" && handlers.canReopenTab !== false) ||
        ((shortcut === "panes.splitRight" || shortcut === "panes.splitDown") &&
          handlers.canSplit !== false) ||
        (shortcut === "panes.maximizeToggle" && handlers.canToggleMaximize !== false) ||
        (shortcut === "panes.close" && handlers.canClosePane !== false);
      if (!isAvailable) return;

      event.preventDefault();
      if (shortcut === "tabs.create") handlers.onCreateTab();
      else if (shortcut === "tabs.close") handlers.onCloseTab();
      else if (shortcut === "tabs.reopenClosed") handlers.onReopenTab();
      else if (shortcut === "panes.splitRight") handlers.onSplit("right");
      else if (shortcut === "panes.splitDown") handlers.onSplit("down");
      else if (shortcut === "panes.maximizeToggle") handlers.onToggleMaximize();
      else handlers.onClosePane();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
