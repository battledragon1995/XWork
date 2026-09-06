import { useNavigate } from "react-router";
import { SessionRoute, type SessionTerminalSlotProps } from "@/features/sessions/session-route";
import { readSessionCrumb } from "@/features/sessions/sessions-store";
import { useKeyboardShortcuts } from "@/features/settings/keyboard-shortcuts-provider";
import { TerminalPane } from "@/features/terminal";

/** Composes Terminal into the Sessions-owned render slot and supplies app navigation. */
export function SessionTerminalRoute() {
  const navigate = useNavigate();
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
      renderTerminal={renderTerminal}
      shortcutSnapshot={
        shortcuts.status === "ready" && shortcuts.pending === null ? shortcuts.snapshot : null
      }
      shortcutPlatform={shortcuts.platform}
    />
  );
}
