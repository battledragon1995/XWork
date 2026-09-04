import { useEffect } from "react";
import { NavLink } from "react-router";
import type { SessionSummaryDto } from "@/bindings/sessions/sessions";
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/animate-ui/components/radix/sidebar";
import { cn } from "@/lib/utils/cn";
import { describeSessionStatus, type SessionStatusTone } from "@/lib/utils/session-status";
import { useSessionsStore } from "./sessions-store";

/**
 * Dot appearance per tone. `idle` is an outline rather than a fill so the six tones stay
 * distinguishable without relying on hue alone; every row also carries the textual label.
 */
const DOT_CLASS: Record<SessionStatusTone, string> = {
  idle: "ring-1 ring-inset ring-muted-soft",
  running: "bg-teal",
  unread: "bg-ink",
  attention: "bg-amber",
  done: "bg-success",
  error: "bg-error",
};

/** Row styling shared with the project rows above, so both read as one sidebar. */
const ROW_CLASS =
  "h-7 gap-2 rounded-sm px-2 text-[13px] whitespace-nowrap text-body focus-visible:ring-ring aria-[current=page]:bg-cream-strong aria-[current=page]:text-ink";

/** What one mounted group reads from the shared retained snapshot. */
interface SessionRowsSnapshot {
  sessions: readonly SessionSummaryDto[];
  hasFailure: boolean;
  refresh(): void;
}

/**
 * Subscribe one project group to the shared session snapshot for as long as it is mounted.
 * The store owns the query, the runtime listener and the consumer count, so several groups
 * plus the breadcrumb never duplicate any of them.
 */
function useSessionRows(projectId: string): SessionRowsSnapshot {
  const sessions = useSessionsStore((state) => state.sessionsByProject[projectId]);
  const failure = useSessionsStore((state) => state.failure);
  const status = useSessionsStore((state) => state.status);
  const refresh = useSessionsStore((state) => state.refresh);

  useEffect(() => {
    const { acquire, release } = useSessionsStore.getState();
    acquire();

    return release;
  }, []);

  return {
    sessions: sessions ?? [],
    // A failure only replaces the rows while there is nothing to show; a retained snapshot
    // always outranks it, because hiding real rows behind an error helps nobody.
    hasFailure: failure !== null && status !== "loading",
    refresh,
  };
}

/** Render the status dot together with the words that carry the same information. */
function SessionStatusDot(props: { summary: SessionSummaryDto }) {
  const { tone, label } = describeSessionStatus(props.summary.status);

  return (
    <>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[tone])} />
      {/* The row is only wide enough for a dot and a name, so the label is visually hidden
          rather than dropped: colour must never be the sole status channel. */}
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * The session rows of one project row on the sidebar. The whole block belongs to the sessions
 * feature and is composed under a project row by `src/app/app-sidebar.tsx`, so the projects
 * feature never has to know how a session is presented.
 */
export function SidebarSessionRows(props: { projectId: string }) {
  const { sessions, hasFailure, refresh } = useSessionRows(props.projectId);

  if (sessions.length === 0) {
    if (!hasFailure) {
      // An empty project renders nothing at all: an expanded row with no session must not
      // invent a placeholder that reads like one.
      return null;
    }

    return (
      <div className="mx-3.5 px-2.5 py-1 text-xs leading-relaxed text-muted-soft">
        {/* No technical detail here on purpose: the sidebar is not where a failure is explained. */}
        <p>Couldn&apos;t load sessions.</p>
        <button
          type="button"
          className="rounded-xs font-medium text-brand underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={refresh}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <SidebarMenuSub className="gap-0.5">
      {sessions.map((session) => (
        // Keyed by backend id and rendered in the order the backend returned, so the sidebar
        // and the project overview can never disagree about the order.
        <SidebarMenuSubItem key={session.id}>
          <SidebarMenuSubButton asChild className={ROW_CLASS}>
            <NavLink to={`/sessions/${session.id}`} end>
              <SessionStatusDot summary={session} />
              <span className="truncate" title={session.name}>
                {session.name}
              </span>
            </NavLink>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );
}
