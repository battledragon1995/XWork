import { Outlet } from "react-router";
import { AppSidebar } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";
import { useQuitStore } from "./quit-store";
import { COLLAPSED_SIDEBAR_WIDTH_PX, useShellStore } from "./shell-store";
import { SidebarResizeHandle } from "./sidebar-resize-handle";
import { useLifecycleEvents } from "./use-lifecycle-events";

/** Copy for a failure the user cannot retry, only restart out of. */
const INTEGRATION_MESSAGE = "XWork ran into a problem it cannot recover from. Restart XWork.";

// Report whether any unrecoverable failure is on display. `window_operation_failed` is
// excluded because the window controls already offer it as a retryable status line.
function useIntegrationFailure(): boolean {
  const windowFailure = useShellStore((state) => state.windowControlFailure);
  const quitPhase = useQuitStore((state) => state.phase);

  return (
    quitPhase === "integration-failed" ||
    (windowFailure !== null && windowFailure.code !== "window_operation_failed")
  );
}

// Compose the persistent three-region layout every route renders inside. The sidebar column
// follows the shell state so the topbar brand column and the sidebar always line up.
export function AppShell() {
  const isCollapsed = useShellStore((state) => state.isSidebarCollapsed);
  const sidebarWidthPx = useShellStore((state) => state.sidebarWidthPx);
  const startQuit = useQuitStore((state) => state.startQuit);
  const isCheckingQuit = useQuitStore((state) => state.phase === "requesting");
  const hasIntegrationFailure = useIntegrationFailure();
  const columnWidthPx = isCollapsed ? COLLAPSED_SIDEBAR_WIDTH_PX : sidebarWidthPx;

  // Mounted here because this is the innermost persistent component that has router context.
  useLifecycleEvents();

  return (
    <div className="grid h-full grid-rows-[40px_minmax(0,1fr)] bg-canvas">
      <AppTopbar onQuit={() => void startQuit()} isCheckingQuit={isCheckingQuit} />
      <div
        data-testid="shell-body"
        className="relative grid min-h-0"
        style={{ gridTemplateColumns: `${columnWidthPx}px minmax(0, 1fr)` }}
      >
        <AppSidebar />
        {!isCollapsed && <SidebarResizeHandle />}
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-canvas">
          {hasIntegrationFailure && (
            <p
              role="alert"
              className="shrink-0 border-b border-hairline bg-surface-card px-8 py-2.5 text-[13px] text-error"
            >
              {INTEGRATION_MESSAGE}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
