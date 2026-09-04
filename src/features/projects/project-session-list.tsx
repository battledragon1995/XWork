import { Ellipsis, Pen, Plus, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Link } from "react-router";
import type { SessionSummaryDto } from "@/bindings/sessions/sessions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils/cn";
import type { SessionStatusTone } from "@/lib/utils/session-status";
import { describeSessionMeta, describeSessionStatus } from "@/lib/utils/session-status";
import { DeleteSessionDialog } from "./delete-session-dialog";
import { RenameSessionDialog } from "./rename-session-dialog";
import { useProjectSessions } from "./use-project-sessions";

/**
 * Dot appearance per tone. `idle` is an outline rather than a fill so the six tones stay
 * distinguishable without relying on hue; every row also carries the label as text.
 */
const DOT_CLASS: Record<SessionStatusTone, string> = {
  idle: "ring-1 ring-inset ring-muted-soft",
  running: "bg-teal",
  unread: "bg-ink",
  attention: "bg-amber",
  done: "bg-success",
  error: "bg-error",
};

/** Intent-only props of the block. Data and commands are the hook's, not the caller's. */
export interface ProjectSessionListProps {
  projectId: string;
  isProjectUnavailable: boolean;
  /** The route's shared create flow, so both `New Session` entry points stay on one lock. */
  onCreateSession(): void;
}

/** Render one placeholder row while the first project-scoped read is pending. */
function SessionRowSkeleton() {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-surface-card" />
      <span className="grid flex-1 gap-1.5">
        <span className="h-4 w-40 max-w-full animate-pulse rounded bg-surface-card" />
        <span className="h-3 w-28 max-w-full animate-pulse rounded bg-surface-card" />
      </span>
    </li>
  );
}

/**
 * The `Sessions in this run` block at the top of the left overview column.
 *
 * The block is an independent reader of BE-005: it queries and listens on its own, so it and
 * the sidebar converge on the same backend snapshot without either feature importing the
 * other. All it takes from the route is where a create should lead.
 */
export function ProjectSessionList(props: ProjectSessionListProps) {
  const { projectId, isProjectUnavailable, onCreateSession } = props;
  const data = useProjectSessions({ projectId });
  const { inspect, resetLifecycle } = data;

  const [renameTarget, setRenameTarget] = useState<SessionSummaryDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummaryDto | null>(null);
  /** Menu trigger that opened the current dialog, so closing hands focus back to it. */
  const menuTriggers = useRef(new Map<string, HTMLButtonElement | null>());
  const focusTargetId = useRef<string | null>(null);

  /** Return focus to the control that opened a dialog, as §18 requires. */
  const restoreFocus = useCallback(() => {
    const id = focusTargetId.current;
    focusTargetId.current = null;
    if (id !== null) {
      menuTriggers.current.get(id)?.focus();
    }
  }, []);

  /** Open the rename dialog for one row. */
  const openRename = useCallback(
    (session: SessionSummaryDto) => {
      focusTargetId.current = session.id;
      resetLifecycle();
      setRenameTarget(session);
    },
    [resetLifecycle],
  );

  /** Read the close impact first, then open the confirmation with the facts it reported. */
  const openDelete = useCallback(
    async (session: SessionSummaryDto) => {
      focusTargetId.current = session.id;
      const canOpen = await inspect(session.id);
      if (canOpen) {
        setDeleteTarget(session);
      } else {
        // The flow was abandoned before any confirmation appeared, so focus goes back.
        restoreFocus();
      }
    },
    [inspect, restoreFocus],
  );

  const isBusy = data.isCreating || data.lifecycle.pending !== null;

  return (
    <section className="grid min-w-0 gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium tracking-[1.2px] text-muted-soft uppercase">
          Sessions in this run
        </h2>
        {/* Stating the lifetime here is the only warning the user gets before Quit. */}
        <span className="text-xs text-muted-soft">Not restored after Quit</span>
      </div>

      {data.status === "loading" && data.sessions.length === 0 ? (
        <ul aria-busy="true" aria-label="Loading sessions" className="grid">
          <SessionRowSkeleton />
          <SessionRowSkeleton />
        </ul>
      ) : data.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-error">
          {data.failure?.message}
          {data.failure?.canRetry === true && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-brand underline underline-offset-4"
              onClick={data.refresh}
            >
              Try again
            </Button>
          )}
        </div>
      ) : data.sessions.length === 0 ? (
        <div className="grid justify-items-start gap-2 py-1">
          <p className="text-[13px] text-body">No sessions in this run yet.</p>
          <p className="text-[13px] text-muted">Start one to work in this project.</p>
          <NewSessionButton
            variant="secondary"
            isProjectUnavailable={isProjectUnavailable}
            isCreating={data.isCreating}
            onCreateSession={onCreateSession}
          />
        </div>
      ) : (
        <ul className="grid">
          {data.sessions.map((session) => (
            // Keyed by backend id and rendered in the order the backend returned it.
            <SessionRow
              key={session.id}
              session={session}
              isBusy={isBusy}
              triggerRef={(element) => {
                menuTriggers.current.set(session.id, element);
              }}
              onRename={() => openRename(session)}
              onDelete={() => void openDelete(session)}
            />
          ))}
        </ul>
      )}

      <RenameSessionDialog
        session={renameTarget}
        isPending={data.lifecycle.pending === "rename"}
        failure={renameTarget === null ? null : data.lifecycle.failure}
        onClosed={restoreFocus}
        onCancel={() => {
          setRenameTarget(null);
          data.resetLifecycle();
        }}
        onSubmit={(name) => {
          if (renameTarget === null) {
            return;
          }

          void data.rename(renameTarget.id, name).then((shouldClose) => {
            if (shouldClose) {
              setRenameTarget(null);
            }
          });
        }}
      />

      <DeleteSessionDialog
        session={deleteTarget}
        impact={data.lifecycle.impact}
        isPending={data.lifecycle.pending === "delete"}
        failure={deleteTarget === null ? null : data.lifecycle.failure}
        onClosed={restoreFocus}
        onCancel={() => {
          setDeleteTarget(null);
          data.resetLifecycle();
        }}
        onRetryImpact={() => {
          if (deleteTarget !== null) {
            void data.inspect(deleteTarget.id);
          }
        }}
        onConfirm={() => {
          if (deleteTarget === null) {
            return;
          }

          // Deleting from the overview only removes the row: the user stays on this page,
          // because unlike the session route nothing they are looking at disappeared.
          void data.confirmDelete(deleteTarget.id).then((shouldClose) => {
            if (shouldClose) {
              setDeleteTarget(null);
            }
          });
        }}
      />
    </section>
  );
}

/** Render one session row: its status, its name, and the two things it can do. */
function SessionRow(props: {
  session: SessionSummaryDto;
  isBusy: boolean;
  triggerRef(element: HTMLButtonElement | null): void;
  onRename(): void;
  onDelete(): void;
}) {
  const { session, isBusy } = props;
  const { tone, label } = describeSessionStatus(session.status);

  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-hairline-soft py-2.5 last:border-b-0">
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[tone])} />
      {/* The label is hidden visually because the dot already occupies the row's only slot for
          it, but it must stay readable: colour is never the sole status channel. */}
      <span className="sr-only">{label}</span>
      <Link
        to={`/sessions/${session.id}`}
        className="min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block truncate font-medium text-ink" title={session.name}>
          {session.name}
        </span>
        <span className="block truncate text-xs text-muted">{describeSessionMeta(session)}</span>
      </Link>
      <Button asChild variant="secondary" size="sm" className="shrink-0">
        <Link to={`/sessions/${session.id}`}>Open</Link>
      </Button>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={props.triggerRef}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`More actions for ${session.name}`}
                disabled={isBusy}
                className="shrink-0 text-muted"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={props.onRename}>
            <Pen aria-hidden="true" />
            Rename session…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
            <Trash2 aria-hidden="true" />
            Delete Session
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * Render one `New Session` control. Both entry points share this component so the reason a
 * press is refused reads identically wherever the user tried it.
 */
export function NewSessionButton(props: {
  variant: "default" | "secondary";
  isProjectUnavailable: boolean;
  isCreating: boolean;
  onCreateSession(): void;
}) {
  const { isProjectUnavailable, isCreating } = props;
  const isBlocked = isProjectUnavailable || isCreating;
  const reason = isProjectUnavailable
    ? "The project folder is unavailable."
    : isCreating
      ? "XWork is already starting a session."
      : "Start a session in this project.";

  const button = (
    <Button
      type="button"
      variant={props.variant}
      // `aria-disabled` rather than `disabled` keeps the control in the documented focus order
      // so its tooltip stays reachable from the keyboard, exactly as §18 requires.
      aria-disabled={isBlocked || undefined}
      className={cn(isBlocked && "cursor-default aria-disabled:opacity-60")}
      onClick={() => {
        if (!isBlocked) {
          props.onCreateSession();
        }
      }}
    >
      <Plus aria-hidden="true" className="size-3.5" />
      New Session
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
