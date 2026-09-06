import { useLocation, useNavigate } from "react-router";
import type { NotificationTargetDto } from "@/bindings/notifications/notifications";
import type { PaneLayoutNodeDto, SessionDetailDto } from "@/bindings/sessions/sessions";
import { NotificationCenter } from "@/features/notifications";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { setActivePane, setMaximizedPane } from "@/lib/ipc/sessions";
import { useQuitStore } from "./quit-store";

/** Confirms that the exact target still exists inside the returned tab layout. */
function containsPane(node: PaneLayoutNodeDto, paneId: string): boolean {
  return node.kind === "pane"
    ? node.pane.id === paneId
    : containsPane(node.first, paneId) || containsPane(node.second, paneId);
}
/** Rejects stale/mismatched snapshots instead of opening an arbitrary surviving pane. */
function validatedTab(detail: SessionDetailDto, target: NotificationTargetDto) {
  // Match IDs directly rather than trusting a stale row's project or active selection.
  const tab = detail.tabs.find((entry) => entry.id === target.tabId);
  if (
    detail.summary.id !== target.sessionId ||
    detail.summary.projectId !== target.projectId ||
    detail.activeTabId !== target.tabId ||
    !tab ||
    tab.activePaneId !== target.paneId ||
    !containsPane(tab.layout, target.paneId)
  ) {
    throw new IpcCallError("open_notification", { code: "target_unavailable" });
  }
  return tab;
}

/** Composes exact session activation with the persistent notification owner. */
export function NotificationEntry() {
  const location = useLocation();
  const navigate = useNavigate();
  // Quit owns dialog focus while a request or confirmation is in progress.
  const phase = useQuitStore((state) => state.phase);
  const suspended = phase !== "idle" && phase !== "snapshot-failed";
  /** Runs only the remaining non-aborted steps; committed backend effects are never rolled back. */
  async function onOpenTarget(target: NotificationTargetDto, signal: AbortSignal) {
    if (signal.aborted) return;
    const detail = await setActivePane(target.sessionId, target.tabId, target.paneId);
    if (signal.aborted) return;
    const tab = validatedTab(detail, target);
    if (tab.maximizedPaneId !== null && tab.maximizedPaneId !== target.paneId) {
      const restored = await setMaximizedPane(target.sessionId, target.tabId, null);
      if (signal.aborted) return;
      const restoredTab = validatedTab(restored, target);
      if (restoredTab.maximizedPaneId !== null && restoredTab.maximizedPaneId !== target.paneId)
        throw new Error("Target remains covered.");
    }
    if (signal.aborted) return;
    await navigate(`/sessions/${encodeURIComponent(target.sessionId)}`, {
      state: {
        notificationFocus: {
          tabId: target.tabId,
          paneId: target.paneId,
          requestId: crypto.randomUUID(),
        },
      },
    });
  }
  return (
    <NotificationCenter
      onOpenTarget={onOpenTarget}
      dismissKey={location.key}
      suspended={suspended}
    />
  );
}
