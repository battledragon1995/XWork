import { Pen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DeleteSessionDialog } from "./delete-session-dialog";
import { RenameSessionDialog } from "./rename-session-dialog";
import { SessionActionsMenu } from "./session-actions-menu";
import { SessionToolPicker } from "./session-tool-picker";
import { SessionWorkspace } from "./session-workspace";
import { useSessionDetail } from "./use-session-detail";
import { useSessionLifecycle } from "./use-session-lifecycle";
import type { PaneContentDto } from "@/bindings/sessions/sessions";

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
export function SessionRoute(props: { renderTerminal?: SessionTerminalRenderer }) {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const detail = useSessionDetail(sessionId);
  const lifecycle = useSessionLifecycle();
  const { reset: resetLifecycle, inspect } = lifecycle;

  const [isRenameOpen, setRenameOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<FocusTarget | null>(null);

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

  if (detail.detail.tabs.length > 0) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <SessionWorkspace
          detail={detail.detail}
          rootPath={detail.project?.rootPath ?? null}
          onApplyDetail={detail.applyDetail}
          onRefresh={detail.refresh}
          onRenameSession={() => openRename("menu")}
          onDeleteSession={() => void openDelete()}
          renderTerminal={props.renderTerminal}
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="@container h-full overflow-y-auto overflow-x-hidden px-8 py-7">
      <div className="grid min-w-0 gap-6">
        <SessionHeader
          name={summary.name}
          rootPath={detail.project?.rootPath ?? null}
          isBusy={isBusy}
          renameRef={renameButtonRef}
          menuRef={menuButtonRef}
          onRenameFromButton={() => openRename("rename")}
          onRenameFromMenu={() => openRename("menu")}
          onDelete={() => void openDelete()}
        />

        <SessionToolPicker
          sessionId={summary.id}
          onSelected={detail.applyDetail}
          onRefresh={detail.refresh}
        />
      </div>
      {dialogs}
    </div>
  );
}
