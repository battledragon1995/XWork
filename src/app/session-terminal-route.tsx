import { useLocation, useNavigate } from "react-router";
import { SessionRoute, type SessionTerminalSlotProps } from "@/features/sessions/session-route";
import { readSessionCrumb } from "@/features/sessions/sessions-store";
import { useKeyboardShortcuts } from "@/features/settings/keyboard-shortcuts-provider";
import { TerminalPane } from "@/features/terminal";

/** Composes Terminal into the Sessions-owned render slot and supplies app navigation. */
export function SessionTerminalRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const state: unknown = location.state;
  const candidate: unknown =
    typeof state === "object" && state !== null && "notificationFocus" in state
      ? state.notificationFocus
      : undefined;
  const focusRequest =
    typeof candidate === "object" &&
    candidate !== null &&
    "tabId" in candidate &&
    typeof candidate.tabId === "string" &&
    "paneId" in candidate &&
    typeof candidate.paneId === "string" &&
    "requestId" in candidate &&
    typeof candidate.requestId === "string" &&
    candidate.requestId.length > 0
      ? { tabId: candidate.tabId, paneId: candidate.paneId, requestId: candidate.requestId }
      : undefined;
  const shortcuts = useKeyboardShortcuts();

  /** Renders one terminal without making Sessions import Terminal implementation. */
  const renderTerminal = (props: SessionTerminalSlotProps): React.ReactNode => (
    <TerminalPane
      {...props}
      onOpenProject={() => {
        const projectId = readSessionCrumb(props.sessionId)?.projectId;
        void navigate(projectId === undefined ? "/projects" : `/projects/${projectId}`);
      }}
      onOpenTerminalSettings={(profileId) =>
        void navigate("/settings/terminal-profiles", {
          state: profileId === undefined ? undefined : { profileId },
        })
      }
    />
  );

  return (
    <SessionRoute
      focusRequest={focusRequest}
      renderTerminal={renderTerminal}
      shortcutSnapshot={
        shortcuts.status === "ready" && shortcuts.pending === null ? shortcuts.snapshot : null
      }
      shortcutPlatform={shortcuts.platform}
    />
  );
}
