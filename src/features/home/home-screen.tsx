import { ArrowUpRight, Folder, Maximize2 } from "lucide-react";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ProjectGitSummary } from "@/components/project-git-summary";
import { Button } from "@/components/ui/button";
import {
  homeDate,
  orderedSessions,
  projectTimestamp,
  recentProjects,
  relativeProjectTime,
  STATUS_LABELS,
  sessionCounts,
} from "./home-presentation";
import type { HomeRouteProps } from "./home-route";
import { useHomeSessions } from "./use-home-sessions";
import type { HomeQueryState, ProjectPresenceResult } from "./use-project-presence";

const ROW =
  "flex min-w-0 items-start gap-2.5 border-b border-hairline-soft py-3 text-[13px] text-body outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring";
const LINK =
  "rounded text-sm text-muted underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const REASONS = {
  missing: "Folder missing",
  notDirectory: "Not a folder",
  accessDenied: "Access denied",
  io: "Could not check folder",
};

/** Display independent query failures without hiding another section's successful data. */
export function QueryNotice<T>({
  query,
  owner,
  suspended,
}: {
  query: HomeQueryState<T>;
  owner: "Projects" | "Sessions";
  suspended: boolean;
}) {
  return (
    <>
      {query.failure && (
        <div role="alert" className="mb-3 space-y-2 text-sm text-body">
          <p>
            {query.snapshot
              ? `${owner} may be out of date.`
              : `XWork couldn't load your ${owner.toLowerCase()}.`}
          </p>
          {query.failure === "integration" ? (
            <p>Restart XWork.</p>
          ) : (
            <Button disabled={suspended || query.refreshing} onClick={query.refresh}>
              Try again
            </Button>
          )}
        </div>
      )}
      {query.subscriptionFailed && (
        <div role="alert" className="mb-3 space-y-2 text-sm text-body">
          <p>Live updates are unavailable. Refresh to update.</p>
          <Button disabled={suspended || query.refreshing} onClick={query.refresh}>
            Refresh
          </Button>
        </div>
      )}
    </>
  );
}

/** Render the two Phase 1 projections while delegating all mutations to destination owners. */
export function HomeScreen({
  projects,
  ...props
}: HomeRouteProps & { projects: ProjectPresenceResult }) {
  const sessions = useHomeSessions(props, projects.invalidation, projects.refresh);
  const [date, setDate] = useState(/** Capture the initial local date. */ () => new Date());
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<{ element: HTMLElement; section: HTMLElement } | null>(null);
  const live = props.readBoundary?.() ?? props.boundary;
  const suspended = !!(
    props.boundary?.suspended ||
    live?.suspended ||
    live?.epoch !== props.boundary?.epoch
  );
  const epoch = props.boundary?.epoch ?? 0;
  /** Validate the current operation boundary even before React has rendered its update. */
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    const now = props.readBoundary?.() ?? props.boundary;
    if (suspended || now?.suspended || (now?.epoch ?? 0) !== epoch) event.preventDefault();
  }
  useEffect(
    /** Maintain one calendar timer for this dashboard lifetime. */ () => {
      let timer: ReturnType<typeof setTimeout>;
      /** Refresh the date and schedule the next local midnight, including DST transitions. */
      function update() {
        clearTimeout(timer);
        const now = new Date();
        setDate(now);
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        timer = setTimeout(update, midnight.getTime() - now.getTime());
      }
      /** Ignore hidden-window visibility signals. */
      function visible() {
        if (!document.hidden) update();
      }
      update();
      window.addEventListener("focus", visible);
      document.addEventListener("visibilitychange", visible);
      /** Release the sole date timer and foreground listeners. */
      return () => {
        clearTimeout(timer);
        window.removeEventListener("focus", visible);
        document.removeEventListener("visibilitychange", visible);
      };
    },
    [],
  );
  useLayoutEffect(
    /** Restore focus only when its keyed row disappeared. */ () => {
      const previous = focused.current;
      if (previous && !previous.element.isConnected && document.activeElement === document.body) {
        previous.section.querySelector<HTMLElement>("h2")?.focus();
        focused.current = null;
      }
    },
  );
  const counts = sessions.snapshot === null ? null : sessionCounts(sessions.snapshot);
  return (
    <div
      ref={root}
      className="@container h-full overflow-y-auto p-7"
      onFocusCapture={
        /** Track ownership without stealing focus from another app control. */ (event) => {
          const section = event.target.closest("section");
          focused.current = section ? { element: event.target, section } : null;
        }
      }
    >
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="mr-auto font-display text-[30px] font-medium leading-tight tracking-tight text-ink">
          {homeDate(date)}
        </h1>
        {counts && !sessions.failure && (
          <p className="text-xs text-muted">
            {counts.running ? `${counts.running} sessions running` : "No sessions running"} ·{" "}
            {counts.attention} need attention
          </p>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open Quick Note window"
          title="Open Quick Note window"
          disabled={suspended || props.quickNoteOpening}
          onClick={props.onOpenQuickNote}
        >
          <Maximize2 aria-hidden="true" />
        </Button>
        {props.quickNoteOpenError && (
          <p role="alert">
            {props.quickNoteOpenError}{" "}
            <Button disabled={suspended || props.quickNoteOpening} onClick={props.onOpenQuickNote}>
              Retry
            </Button>
          </p>
        )}
      </header>
      <div className="grid min-w-0 grid-cols-1 items-start gap-7 @[720px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {(props.notesSection || props.quickNoteSlot) && (
          <div className="min-w-0 space-y-6">
            {props.quickNoteSlot}
            {props.notesSection}
          </div>
        )}
        <div className="min-w-0 space-y-6">
          <section
            aria-labelledby="home-sessions"
            aria-busy={sessions.loading || sessions.refreshing}
            className="min-w-0"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2
                id="home-sessions"
                tabIndex={-1}
                className="text-[11px] font-medium uppercase tracking-wider text-muted"
              >
                Sessions
              </h2>
              <Link className={LINK} to="/projects" onClick={navigate} aria-disabled={suspended}>
                Projects
              </Link>
            </div>
            <QueryNotice query={sessions} owner="Sessions" suspended={suspended} />
            {sessions.loading && (
              <p role="status" className="text-sm text-muted">
                Loading sessions…
              </p>
            )}
            {sessions.snapshot?.length === 0 && (
              <div className="space-y-2 rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-xs text-muted">
                <p className="font-display text-xl text-ink">No sessions running</p>
                <p>Open a project and choose a tool to start a session.</p>
                <Link className={LINK} to="/projects" onClick={navigate} aria-disabled={suspended}>
                  Open Projects
                </Link>
              </div>
            )}
            <ul>
              {orderedSessions(sessions.snapshot ?? []).map(
                /** Use session identity as the key so reorder preserves keyboard focus. */
                (session) => (
                  <li key={session.id}>
                    <Link
                      className={ROW}
                      to={`/sessions/${encodeURIComponent(session.id)}`}
                      aria-label={`Open session ${session.name}`}
                      aria-disabled={suspended}
                      onClick={navigate}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${session.status === "needsAttention" ? "bg-amber" : session.status === "exitedWithError" ? "bg-error" : session.status === "running" ? "bg-teal" : "bg-muted-soft"}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-ink">{session.name}</span>
                        {" · "}
                        <span className="text-muted">
                          {projects.projects?.find(
                            /** Join the full project snapshot by identity. */ (project) =>
                              project.id === session.projectId,
                          )?.displayName || "Project unavailable"}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {STATUS_LABELS[session.status]}
                        </span>
                        <span className="block text-xs text-muted">
                          {session.tabCount} tabs · {session.runningProcessCount} processes
                        </span>
                      </span>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-muted"
                      />
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </section>
          <section
            aria-labelledby="home-projects"
            aria-busy={projects.refreshing}
            className="min-w-0"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2
                id="home-projects"
                tabIndex={-1}
                className="text-[11px] font-medium uppercase tracking-wider text-muted"
              >
                Recent projects
              </h2>
              <Link className={LINK} to="/projects" onClick={navigate} aria-disabled={suspended}>
                All projects
              </Link>
            </div>
            <QueryNotice query={projects} owner="Projects" suspended={suspended} />
            <ul>
              {recentProjects(projects.projects ?? []).map(
                /** Keep unavailable projects navigable so the overview can repair their location. */
                (project) => (
                  <li key={project.id}>
                    <Link
                      className={ROW}
                      to={`/projects/${encodeURIComponent(project.id)}`}
                      aria-label={`Open project ${project.displayName}`}
                      aria-disabled={suspended}
                      onClick={navigate}
                    >
                      <Folder aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">
                          {project.displayName}
                        </span>
                        <span
                          className="block truncate font-mono text-[11px] text-muted"
                          title={project.rootPath}
                        >
                          {project.rootPath}
                        </span>
                        <ProjectGitSummary
                          projectId={project.id}
                          suspended={suspended || project.availability.status === "unavailable"}
                          epoch={epoch}
                          readBoundary={props.readBoundary}
                        />
                        <span
                          className="mt-1 block text-[11px] text-muted"
                          title={projectTimestamp(project)}
                        >
                          {relativeProjectTime(project.lastOpenedAtMs, date.getTime())}
                        </span>
                        {project.availability.status === "unavailable" && (
                          <span className="mt-2 block text-sm">
                            Unavailable · {REASONS[project.availability.reason]}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </section>
          {props.calendarSection}
        </div>
      </div>
    </div>
  );
}
