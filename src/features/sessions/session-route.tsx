import { FolderTree, Pen } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { KeyboardShortcutsDto } from "@/bindings/keyboard-shortcuts";
import type { PaneContentDto, SessionDetailDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutPlatform } from "@/lib/utils/keyboard-shortcuts";
import { DeleteSessionDialog } from "./delete-session-dialog";
import { RenameSessionDialog } from "./rename-session-dialog";
import { SessionActionsMenu } from "./session-actions-menu";
import type { SessionFilePlacement, SessionFileTarget } from "./session-layout";
import { SessionToolPicker } from "./session-tool-picker";
import { SessionWorkspace } from "./session-workspace";
import { useSessionDetail } from "./use-session-detail";
import { useSessionLifecycle } from "./use-session-lifecycle";
import { useToolCatalog } from "./use-tool-catalog";
import { useWorkspaceMutations } from "./use-workspace-mutations";

export type { SessionFilePlacement, SessionFileTarget } from "./session-layout";

/** Copy for a session that could not be opened for any reason other than being gone. */
export const SESSION_OPEN_FAILED_MESSAGE = "XWork couldn't open this session.";

/** Control that opened the current dialog, so closing hands focus back to the right one. */
type FocusTarget = "rename" | "menu";

/** App-owned render slot that keeps Terminal implementation outside the Sessions feature. */
export interface SessionTerminalSlotProps {
  sessionId: string;
  tabId: string;
  paneId: string;
  content: Extract<PaneContentDto, { kind: "toolSelection" | "terminal" }>;
  isActive: boolean;
  isVisible: boolean;
  onActivate(): void;
  onRefreshSession(): void;
  onCheckProfile(profileId: string): void;
}

/** Optional app composition surface for terminal content. */
export type SessionTerminalRenderer = (props: SessionTerminalSlotProps) => React.ReactNode;

/** Supply the minimal session-owned Explorer placement context. */
export interface SessionFileExplorerSlotProps {
  sessionId: string;
  projectId: string;
  isVisible: boolean;
  regionId: string;
  /** Which openings the current session snapshot can satisfy right now. */
  placements: Record<SessionFilePlacement, boolean>;
  /** Close through the same toggle owner used by the tab strip. */
  onClose(): void;
  /** Prepare one empty pane, or refuse with `null` when Sessions cannot satisfy it. */
  prepareFileTarget(placement: SessionFilePlacement): Promise<SessionFileTarget | null>;
  /** Re-read the session snapshot once a file has been attached by the backend. */
  onFileAttached(): void;
}
/** Compose Files at the application boundary without a feature dependency. */
export type SessionFileExplorerRenderer = (props: SessionFileExplorerSlotProps) => React.ReactNode;

/** Region of a pane the file renderer is asked to fill. */
export type SessionPaneRegion = "header" | "body";

/** Minimal context Sessions gives file content, with no Files type in the signature. */
export interface SessionFilePaneSlotProps {
  region: SessionPaneRegion;
  sessionId: string;
  tabId: string;
  paneId: string;
  content: Extract<PaneContentDto, { kind: "file" }>;
  isActive: boolean;
  isVisible: boolean;
  onActivate(): void;
  onRefreshSession(): void;
}
/** Optional app composition surface for file content. */
export type SessionFilePaneRenderer = (props: SessionFilePaneSlotProps) => React.ReactNode;

/** Render the non-interactive route shape while the first read is pending. */
function SessionRouteSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading session" className="grid gap-6">
      <span className="h-8 w-56 max-w-full animate-pulse rounded bg-surface-card" />
      <div className="grid max-w-[760px] gap-3 @min-[640px]:grid-cols-2">
        {/* Four placeholders stand in for the tool grid, which is what an empty session
            shows; no action control is rendered while nothing is known yet. */}
        <span className="h-14 animate-pulse rounded-md bg-surface-card" />
        <span className="h-14 animate-pulse rounded-md bg-surface-card" />
        <span className="h-14 animate-pulse rounded-md bg-surface-card" />
        <span className="h-14 animate-pulse rounded-md bg-surface-card" />
      </div>
    </div>
  );
}

/** Render the session name, its two action entries, and the project root it starts in. */
function SessionHeader(props: {
  name: string;
  rootPath: string | null;
  isBusy: boolean;
  renameRef: React.Ref<HTMLButtonElement>;
  menuRef: React.Ref<HTMLButtonElement>;
  /** Raised by the icon button, which is where focus returns when its dialog closes. */
  onRenameFromButton(): void;
  /** Raised by the menu item, whose trigger is the control focus returns to instead. */
  onRenameFromMenu(): void;
  onDelete(): void;
}) {
  return (
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <h1
          className="min-w-0 truncate font-display text-[22px] leading-tight tracking-tight text-ink"
          title={props.name}
        >
          {props.name}
        </h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={props.renameRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Rename session"
              disabled={props.isBusy}
              className="text-muted"
              onClick={props.onRenameFromButton}
            >
              <Pen aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rename session</TooltipContent>
        </Tooltip>
        <SessionActionsMenu
          isBusy={props.isBusy}
          triggerRef={props.menuRef}
          onRename={props.onRenameFromMenu}
          onDelete={props.onDelete}
        />
      </div>

      {/* Hidden rather than guessed at: a stale root path would tell the user their tool
          starts somewhere it does not. */}
      {props.rootPath !== null && (
        <p className="min-w-0 truncate text-xs text-muted" title={props.rootPath}>
          Starts in <span className="font-mono text-body-strong">{props.rootPath}</span>
        </p>
      )}
    </header>
  );
}

/**
 * The `/sessions/:sessionId` route.
 *
 * FE-006 owns the whole route: the header, both content branches, and the two dialogs. The
 * header is deliberately present in both branches at this slice, so rename and delete always
 * have a way in even once a session has tabs; FE-007 may fold those two entries into the tab
 * strip and drop the header from the branch it owns.
 */
export function SessionRoute(props: {
  focusRequest?: { tabId: string; paneId: string; requestId: string };
  shortcutSnapshot?: KeyboardShortcutsDto | null;
  shortcutPlatform?: ShortcutPlatform | null;
  renderTerminal?: SessionTerminalRenderer;
  renderFileExplorer?: SessionFileExplorerRenderer;
  renderFilePane?: SessionFilePaneRenderer;
}) {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const detail = useSessionDetail(sessionId);
  const lifecycle = useSessionLifecycle();
  const { reset: resetLifecycle, inspect } = lifecycle;

  const [explorerSession, setExplorerSession] = useState<string | null>(null);
  const explorerToggle = useRef<HTMLButtonElement>(null);
  const explorerRegionId = useId();
  const explorerVisible = explorerSession === sessionId;
  // A reused route starts closed and cannot revive intent from an earlier visit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Route identity explicitly retires visibility intent.
  useEffect(() => {
    setExplorerSession(null);
  }, [sessionId]);

  const [isRenameOpen, setRenameOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<FocusTarget | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const requestedFocus = useRef<{
    sessionId: string;
    requestId: string;
    previous: SessionDetailDto | null;
    consumed: boolean;
  } | null>(null);

  // Refresh once per request and wait for a replacement snapshot, including equal revisions.
  useEffect(() => {
    const request = props.focusRequest;
    if (!request) {
      requestedFocus.current = null;
      return;
    }
    if (
      requestedFocus.current?.sessionId !== sessionId ||
      requestedFocus.current.requestId !== request.requestId
    ) {
      requestedFocus.current = {
        sessionId,
        requestId: request.requestId,
        previous: detail.detail,
        consumed: false,
      };
      detail.refresh();
      return;
    }
    const pending = requestedFocus.current;
    if (
      pending.consumed ||
      detail.status !== "ready" ||
      !detail.detail ||
      detail.detail === pending.previous
    )
      return;
    if (detail.detail.summary.id !== sessionId || detail.detail.activeTabId !== request.tabId)
      return;
    // Focus only the requested visible pane, without querying any other route's DOM.
    const tab = detail.detail.tabs.find((entry) => entry.id === request.tabId);
    if (
      !tab ||
      tab.activePaneId !== request.paneId ||
      (tab.maximizedPaneId !== null && tab.maximizedPaneId !== request.paneId)
    )
      return;
    const panes = workspaceRef.current?.querySelectorAll<HTMLElement>("section[data-pane-id]");
    // Opaque pane IDs are compared directly rather than inserted into CSS selectors.
    const pane = [...(panes ?? [])].find((entry) => entry.dataset.paneId === request.paneId);
    pending.consumed = true;
    pane?.focus();
  }, [props.focusRequest, sessionId, detail.detail, detail.status, detail.refresh]);

  /**
   * Project this session belongs to, mirrored in a ref so the navigation that follows a
   * delete uses the value from before the session disappeared.
   */
  const projectId = detail.detail?.summary.projectId ?? null;
  const projectIdRef = useRef<string | null>(projectId);
  if (projectId !== null) {
    projectIdRef.current = projectId;
  }

  /** Leave a session that no longer exists, without any error copy of its own. */
  const leave = useCallback(() => {
    const target = projectIdRef.current;
    // With no project known, the project list is the only place that is certainly still there.
    void navigate(target === null ? "/projects" : `/projects/${target}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (detail.status !== "missing") {
      return;
    }

    setRenameOpen(false);
    setDeleteOpen(false);
    resetLifecycle();
    leave();
  }, [detail.status, leave, resetLifecycle]);

  /** Hand focus back to whichever control opened the dialog that is closing. */
  const restoreFocus = useCallback(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "rename") {
      renameButtonRef.current?.focus();
    } else if (target === "menu") {
      const menuButton =
        menuButtonRef.current ??
        document.querySelector<HTMLButtonElement>('button[aria-label="Tab options"]');
      menuButton?.focus();
    }
  }, []);

  /** Open the rename dialog from either entry point. */
  const openRename = useCallback(
    (from: FocusTarget) => {
      focusTarget.current = from;
      resetLifecycle();
      setRenameOpen(true);
    },
    [resetLifecycle],
  );

  /** Read the close impact first, then open the confirmation with the facts it reported. */
  const openDelete = useCallback(async () => {
    focusTarget.current = "menu";
    const canOpen = await inspect(sessionId);
    if (canOpen) {
      setDeleteOpen(true);
    } else {
      restoreFocus();
    }
  }, [inspect, restoreFocus, sessionId]);

  if (detail.status === "missing") {
    // The effect above is already navigating. Rendering nothing keeps the route silent about
    // a session that is simply gone, instead of flashing a failure the user cannot act on.
    return null;
  }

  if (detail.status === "loading" && detail.detail === null) {
    return (
      <div className="@container h-full overflow-y-auto overflow-x-hidden px-8 py-7">
        <SessionRouteSkeleton />
      </div>
    );
  }

  if (detail.status === "error" || detail.detail === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 overflow-hidden px-8 py-7 text-center">
        <p role="alert" className="text-[15px] text-body">
          {SESSION_OPEN_FAILED_MESSAGE}
        </p>
        <Button type="button" variant="outline" onClick={detail.refresh}>
          Try again
        </Button>
      </div>
    );
  }

  const summary = detail.detail.summary;
  const isBusy = lifecycle.pending !== null;
  const explorerControl = props.renderFileExplorer && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={explorerToggle}
          variant="ghost"
          size="icon-sm"
          aria-label={explorerVisible ? "Hide File Explorer" : "Show File Explorer"}
          aria-expanded={explorerVisible}
          aria-controls={explorerRegionId}
          disabled={isBusy || isRenameOpen || isDeleteOpen}
          // Visibility belongs to this route and never mutates tab or terminal state.
          onClick={() => setExplorerSession(explorerVisible ? null : sessionId)}
        >
          <FolderTree aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {explorerVisible ? "Hide File Explorer" : "Show File Explorer"}
      </TooltipContent>
    </Tooltip>
  );

  const dialogs = (
    <>
      <RenameSessionDialog
        session={isRenameOpen ? summary : null}
        isPending={lifecycle.pending === "rename"}
        failure={isRenameOpen ? lifecycle.failure : null}
        onClosed={restoreFocus}
        onCancel={() => {
          setRenameOpen(false);
          resetLifecycle();
        }}
        onSubmit={(name) => {
          void lifecycle.rename(summary.id, name).then((shouldClose) => {
            if (shouldClose) setRenameOpen(false);
          });
        }}
      />
      <DeleteSessionDialog
        session={isDeleteOpen ? summary : null}
        impact={lifecycle.impact}
        isPending={lifecycle.pending === "delete"}
        failure={isDeleteOpen ? lifecycle.failure : null}
        onClosed={restoreFocus}
        onCancel={() => {
          setDeleteOpen(false);
          resetLifecycle();
        }}
        onRetryImpact={() => void inspect(summary.id)}
        onConfirm={() => {
          void lifecycle.confirmDelete(summary.id).then((shouldClose) => {
            if (shouldClose) {
              setDeleteOpen(false);
              leave();
            }
          });
        }}
      />
    </>
  );

  return (
    <div ref={workspaceRef} className="@container/session h-full min-h-0 overflow-hidden">
      <SessionRouteReady
        // Session identity retires the mutation owner instead of reusing it for another route.
        key={summary.id}
        sessionId={sessionId}
        detail={detail.detail}
        rootPath={detail.project?.rootPath ?? null}
        shortcutSnapshot={props.shortcutSnapshot}
        shortcutPlatform={props.shortcutPlatform}
        isLifecycleBusy={isBusy}
        explorerControl={explorerControl}
        explorerVisible={explorerVisible}
        explorerRegionId={explorerRegionId}
        renameRef={renameButtonRef}
        menuRef={menuButtonRef}
        onApplyDetail={detail.applyDetail}
        onRefresh={detail.refresh}
        onCloseExplorer={() => {
          setExplorerSession(null);
          // Restore only the still-mounted, enabled toggle after an explicit panel close.
          if (explorerToggle.current?.isConnected && !explorerToggle.current.disabled)
            explorerToggle.current.focus();
        }}
        onRenameFromButton={() => openRename("rename")}
        onRenameFromMenu={() => openRename("menu")}
        onDelete={() => void openDelete()}
        renderTerminal={props.renderTerminal}
        renderFileExplorer={props.renderFileExplorer}
        renderFilePane={props.renderFilePane}
      />
      {dialogs}
    </div>
  );
}

/**
 * Own the catalog subscription and the one mutation slot of a ready session.
 *
 * File Explorer sits outside `SessionWorkspace` but has to prepare tabs and panes through the
 * same slot the tab strip uses, and a session with no tab at all must still be able to create
 * its first one. Both branches therefore render inside this one owner, which stays mounted
 * while a session gains or loses its last tab.
 */
function SessionRouteReady(props: {
  sessionId: string;
  detail: SessionDetailDto;
  rootPath: string | null;
  shortcutSnapshot?: KeyboardShortcutsDto | null;
  shortcutPlatform?: ShortcutPlatform | null;
  isLifecycleBusy: boolean;
  explorerControl: React.ReactNode;
  explorerVisible: boolean;
  explorerRegionId: string;
  renameRef: React.Ref<HTMLButtonElement>;
  menuRef: React.Ref<HTMLButtonElement>;
  onApplyDetail(detail: SessionDetailDto): void;
  onRefresh(): void;
  onCloseExplorer(): void;
  onRenameFromButton(): void;
  onRenameFromMenu(): void;
  onDelete(): void;
  renderTerminal?: SessionTerminalRenderer;
  renderFileExplorer?: SessionFileExplorerRenderer;
  renderFilePane?: SessionFilePaneRenderer;
}) {
  const catalog = useToolCatalog();
  const mutations = useWorkspaceMutations({
    detail: props.detail,
    onApplyDetail: props.onApplyDetail,
    onRefresh: props.onRefresh,
    onProfileUnavailable: catalog.markUnavailable,
    onCatalogRefresh: catalog.refresh,
    onProfileCheck: (profileId) => void catalog.check(profileId),
  });
  const summary = props.detail.summary;

  return (
    <div className="flex h-full min-h-0 flex-col @min-[600px]/session:flex-row">
      <div
        hidden={!props.explorerVisible}
        className="max-h-[40%] min-h-0 shrink-0 overflow-auto border-b border-hairline @min-[600px]/session:max-h-full @min-[600px]/session:w-[240px] @min-[600px]/session:border-r @min-[600px]/session:border-b-0"
      >
        {summary.id === props.sessionId &&
          props.renderFileExplorer?.({
            sessionId: props.sessionId,
            projectId: summary.projectId,
            isVisible: props.explorerVisible,
            regionId: props.explorerRegionId,
            placements: mutations.filePlacements,
            onClose: props.onCloseExplorer,
            prepareFileTarget: mutations.prepareFileTarget,
            // Only the session owner can read the snapshot the attachment produced.
            onFileAttached: props.onRefresh,
          })}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {props.detail.tabs.length > 0 ? (
          <SessionWorkspace
            shortcutSnapshot={props.shortcutSnapshot}
            shortcutPlatform={props.shortcutPlatform}
            detail={props.detail}
            rootPath={props.rootPath}
            catalog={catalog}
            mutations={mutations}
            onApplyDetail={props.onApplyDetail}
            onRefresh={props.onRefresh}
            onRenameSession={props.onRenameFromMenu}
            onDeleteSession={props.onDelete}
            renderTerminal={props.renderTerminal}
            renderFilePane={props.renderFilePane}
            fileExplorerToggle={props.explorerControl}
          />
        ) : (
          <div className="@container h-full overflow-y-auto overflow-x-hidden px-8 py-7">
            <div className="grid min-w-0 gap-6">
              {props.explorerControl}
              <SessionHeader
                name={summary.name}
                rootPath={props.rootPath}
                isBusy={props.isLifecycleBusy}
                renameRef={props.renameRef}
                menuRef={props.menuRef}
                onRenameFromButton={props.onRenameFromButton}
                onRenameFromMenu={props.onRenameFromMenu}
                onDelete={props.onDelete}
              />

              {/* The empty branch keeps reporting preparation failures, which is the only
                  place a first-tab opening can fail before the workspace exists. */}
              {mutations.failure !== null && (
                <p role="alert" className="text-[13px] text-error">
                  {mutations.failure.message}
                </p>
              )}

              <SessionToolPicker
                sessionId={summary.id}
                catalog={catalog}
                onSelected={props.onApplyDetail}
                onRefresh={props.onRefresh}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
