import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { CalendarAgenda } from "./calendar-agenda";
import { calendarErrorCopy } from "./calendar-error-copy";
import { calendarRange, todayDate, viewerTimeZone } from "./calendar-presentation";
import { type CalendarRouteProps, IDLE_CALENDAR_BOUNDARY } from "./calendar-route";
import { useCalendarQuery } from "./use-calendar-query";

/** Share a bounded projection without inferring whether the whole calendar is empty. */
function CalendarSection({
  projectId = null,
  boundary = IDLE_CALENDAR_BOUNDARY,
  readBoundary,
}: CalendarRouteProps & { projectId?: string | null }) {
  const navigate = useNavigate();
  const [labels, setLabels] = useState<{ epoch: number; names: Record<string, string> }>({
    epoch: boundary.epoch,
    names: {},
  });
  useEffect(
    /** Keep optional project labels current without blocking occurrence reads. */ () => {
      let retired = false;
      let sequence = 0;
      let unlisten: (() => void) | undefined;
      setLabels({ epoch: boundary.epoch, names: {} });
      /** Admit only metadata belonging to this still-current boundary. */
      function current() {
        const live = readBoundary?.() ?? { suspended: boundary.suspended, epoch: boundary.epoch };
        return !retired && !boundary.suspended && !live.suspended && live.epoch === boundary.epoch;
      }
      /** Replace labels only after the latest authoritative metadata read. */
      async function refresh() {
        if (!current()) return;
        const ticket = ++sequence;
        try {
          const projects = await listProjects();
          if (current() && ticket === sequence)
            setLabels({
              epoch: boundary.epoch,
              names: Object.fromEntries(
                projects.map(
                  /** Index display labels, including unavailable registered projects. */ (
                    project,
                  ) => [project.id, project.displayName],
                ),
              ),
            });
        } catch {
          if (current() && ticket === sequence) setLabels({ epoch: boundary.epoch, names: {} });
        }
      }
      /** Reconcile labels when the visible window returns to the foreground. */
      function foreground() {
        if (!document.hidden) void refresh();
      }
      if (current()) {
        void refresh();
        void onProjectsChanged(
          /** Refresh renamed or removed project metadata. */ () => {
            void refresh();
          },
        )
          .then(
            /** Reconcile changes missed during registration and release late subscriptions. */ (
              cleanup,
            ) => {
              if (retired) cleanup();
              else {
                unlisten = cleanup;
                void refresh();
              }
            },
          )
          .catch(
            /** Label subscription failure leaves occurrence reads and focus recovery usable. */ () => {},
          );
        window.addEventListener("focus", foreground);
        document.addEventListener("visibilitychange", foreground);
      }
      return /** Retire old responses and release every metadata listener. */ () => {
        retired = true;
        unlisten?.();
        window.removeEventListener("focus", foreground);
        document.removeEventListener("visibilitychange", foreground);
      };
    },
    [boundary.epoch, boundary.suspended, readBoundary],
  );
  const [zone] = useState(viewerTimeZone);
  const [today, setToday] = useState(
    /** Resolve this projection's current viewer date. */ () => todayDate(zone),
  );
  useEffect(
    /** Update only the visible projection's date on foreground transitions. */ () => {
      /** Refresh the presentation day without scheduling reminders. */
      function refresh() {
        setToday(todayDate(zone));
      }
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
      const timer = setInterval(refresh, 60_000);
      return /** Remove foreground and clock listeners. */ () => {
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
        clearInterval(timer);
      };
    },
    [zone],
  );
  const query = useCalendarQuery(calendarRange(today, 14, zone, projectId), boundary, readBoundary);
  /** Check the operation owner before a navigation leaves this aggregate. */
  function admitted() {
    const live = readBoundary?.() ?? boundary;
    return !live.suspended && live.epoch === boundary.epoch;
  }
  /** Open the real Calendar detail with the verified project scope. */
  function open(item: CalendarOccurrenceDto) {
    if (admitted())
      void navigate(
        `/calendar?event=${encodeURIComponent(item.eventId)}${projectId ? `&project=${encodeURIComponent(projectId)}` : ""}`,
      );
  }
  return (
    <section aria-label="Upcoming calendar events" className="min-w-0 space-y-3 self-start">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted">
        Upcoming events
      </h2>
      {query.loading && <p role="status">Loading calendar…</p>}
      {query.refreshing && <p role="status">Refreshing calendar…</p>}
      {query.listenerError && <p role="alert">Calendar updates are unavailable</p>}
      {query.error != null && <p role="alert">{calendarErrorCopy(query.error)}</p>}
      {(query.listenerError || query.error != null) && (
        <button type="button" onClick={query.retry}>
          Retry
        </button>
      )}
      {query.snapshot?.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center">
          <p className="font-display text-xl text-ink">Nothing coming up</p>
          <p className="mt-1 text-xs text-muted">No events in the next 14 days</p>
        </div>
      )}
      {query.snapshot && query.snapshot.items.length > 0 && (
        <CalendarAgenda
          items={query.snapshot.items.slice(0, 5)}
          zone={zone}
          projectNames={labels.epoch === boundary.epoch && !boundary.suspended ? labels.names : {}}
          upcoming
          disabled={boundary.suspended}
          onOpen={open}
        />
      )}
      <Link
        className="inline-block text-xs text-muted hover:text-ink"
        to={`/calendar${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`}
        aria-disabled={boundary.suspended}
        onClick={
          /** Prevent stale links from crossing a maintenance boundary. */ (e) => {
            if (!admitted()) e.preventDefault();
          }
        }
      >
        View calendar
      </Link>
    </section>
  );
}
/** Render the public Home calendar slot. */
export function HomeCalendarSection(props: CalendarRouteProps) {
  return <CalendarSection {...props} />;
}
/** Render upcoming events only for the project verified by the overview owner. */
export function ProjectCalendarSection(props: CalendarRouteProps & { projectId: string }) {
  return <CalendarSection {...props} />;
}
