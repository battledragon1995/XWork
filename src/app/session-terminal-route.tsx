import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { FileExplorer, FilePane } from "@/features/files";
import {
  type SessionFileExplorerSlotProps,
  type SessionFilePaneSlotProps,
  SessionRoute,
  type SessionTerminalSlotProps,
} from "@/features/sessions/session-route";
import { readSessionCrumb } from "@/features/sessions/sessions-store";
import { useDataManagement } from "@/features/settings/data-management-provider";
import { useKeyboardShortcuts } from "@/features/settings/keyboard-shortcuts-provider";
import { TerminalPane } from "@/features/terminal";
import { useQuitStore } from "./quit-store";

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
  const { busy, invalidationEpoch, getCurrent } = useDataManagement();
  const phase = useQuitStore(
    /** Subscribe only to the Quit work barrier. */ (state) => state.phase,
  );
  const suspended = busy || (phase !== "idle" && phase !== "snapshot-failed");
  /** Read owners synchronously before callbacks or navigation can cross a reset. */
  const readBoundary = useCallback(() => {
    const data = getCurrent();
    const quit = useQuitStore.getState().phase;
    return {
      epoch: data.invalidationEpoch,
      suspended: data.busy || (quit !== "idle" && quit !== "snapshot-failed"),
    };
  }, [getCurrent]);
  /** Supply Files only the project identity confirmed by the Sessions summary. */
  const renderFileExplorer = useCallback(
    (props: SessionFileExplorerSlotProps) => (
      <FileExplorer
        {...props}
        platform={shortcuts.platform}
        boundary={{ epoch: invalidationEpoch, suspended }}
        readBoundary={readBoundary}
        prepareTarget={
          /** Prepare a pane only while the live application still accepts mutations. */ async (
            placement,
          ) => {
            const live = readBoundary();
            if (live.suspended || live.epoch !== invalidationEpoch) return null;
            return props.prepareFileTarget(placement);
          }
        }
        onFileOpened={
          /** Let Sessions re-read its snapshot, but never across a reset boundary. */ () => {
            const live = readBoundary();
            if (!live.suspended && live.epoch === invalidationEpoch) props.onFileAttached();
          }
        }
        onClose={
          /** Avoid restoring focus across a reset or active Quit flow. */ () => {
            const live = readBoundary();
            if (!live.suspended && live.epoch === invalidationEpoch) props.onClose();
          }
        }
        onOpenProject={
          /** Navigate to the summary-owned project only in the live generation. */ () => {
            const live = readBoundary();
            if (!live.suspended && live.epoch === invalidationEpoch)
              void navigate(`/projects/${props.projectId}`);
          }
        }
        onProjectMissing={
          /** Replace a removed project route without replaying stale recovery. */ () => {
            const live = readBoundary();
            if (!live.suspended && live.epoch === invalidationEpoch)
              void navigate("/projects", { replace: true });
          }
        }
      />
    ),
    [shortcuts.platform, invalidationEpoch, suspended, readBoundary, navigate],
  );

  /** Renders one file region without making Sessions import Files implementation. */
  const renderFilePane = useCallback(
    (props: SessionFilePaneSlotProps): React.ReactNode => (
      <FilePane
        region={props.region}
        fileHandleId={props.content.fileHandleId}
        paneTitle={props.content.title}
        isVisible={props.isVisible}
        onRefreshSession={props.onRefreshSession}
        onOpenProject={
          /** Recovery navigates through the app, never through a Files-owned route. */ () => {
            const live = readBoundary();
            if (live.suspended || live.epoch !== invalidationEpoch) return;
            const projectId = readSessionCrumb(props.sessionId)?.projectId;
            void navigate(projectId === undefined ? "/projects" : `/projects/${projectId}`);
          }
        }
      />
    ),
    [invalidationEpoch, navigate, readBoundary],
  );

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
      renderFileExplorer={renderFileExplorer}
      renderFilePane={renderFilePane}
      shortcutSnapshot={
        shortcuts.status === "ready" && shortcuts.pending === null ? shortcuts.snapshot : null
      }
      shortcutPlatform={shortcuts.platform}
    />
  );
}
