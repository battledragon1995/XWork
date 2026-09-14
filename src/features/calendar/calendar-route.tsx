import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import type { ReminderTargetDto } from "@/bindings/reminders";
import { getProject, listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import { CalendarAgenda } from "./calendar-agenda";
import { calendarErrorCopy, calendarErrorKind } from "./calendar-error-copy";
import { CalendarMissed } from "./calendar-missed";
import { CalendarMonth } from "./calendar-month";
import {
  addDays,
  calendarRange,
  formatCalendarDate,
  formatCalendarMonth,
  isValidDate,
  monthGrid,
  shiftMonth,
  todayDate,
  viewerTimeZone,
} from "./calendar-presentation";
import { EventDetailPanel } from "./event-detail-panel";
import { type CalendarBoundary, useCalendarQuery } from "./use-calendar-query";
import { useMissedReminders } from "./use-missed-reminders";
export interface CalendarRouteProps {
  boundary?: CalendarBoundary;
  readBoundary?(): CalendarBoundary;
  onCreateEvent?(input: { date: string; projectId: string | null }): void;
}
export const IDLE_CALENDAR_BOUNDARY: CalendarBoundary = { suspended: false, epoch: 0 };
/** Compose month, selected-day and Upcoming reads with one event detail owner. */
export function CalendarRoute({
  boundary = IDLE_CALENDAR_BOUNDARY,
  readBoundary,
  onCreateEvent,
}: CalendarRouteProps) {
  const [params, setParams] = useSearchParams();
  const [zone, setZone] = useState(viewerTimeZone);
  const [today, setToday] = useState(/** Resolve the initial viewer date. */ () => todayDate(zone));
  const dateIntent = params.get("date");
  const projectIntent = params.get("project");
  const eventId = params.get("event");
  const occurrenceId = params.get("occurrence");
  const invalidDate = dateIntent !== null && !isValidDate(dateIntent);
  const [selected, setSelected] = useState(
    dateIntent && isValidDate(dateIntent) ? dateIntent : today,
  );
  const [month, setMonth] = useState(selected);
  const [panel, setPanel] = useState<"day" | "upcoming" | "missed">("day");
  const missed = useMissedReminders(boundary, readBoundary);
  const [occurrence, setOccurrence] = useState<CalendarOccurrenceDto | null>(null);
  const [project, setProject] = useState<{ id: string | null; ready: boolean; error: boolean }>({
    id: null,
    ready: projectIntent === null,
    error: false,
  });
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const selectionEpoch = useRef(boundary.epoch);
  useEffect(
    /** Retire selected event intents when maintenance or Quit takes ownership. */ () => {
      if (boundary.suspended || selectionEpoch.current !== boundary.epoch) {
        selectionEpoch.current = boundary.epoch;
        setOccurrence(null);
        opener.current = null;
        if (eventId)
          setParams(
            /** Remove retired event selection without changing scope. */ (previous) => {
              const next = new URLSearchParams(previous);
              next.delete("event");
              next.delete("occurrence");
              return next;
            },
            { replace: true },
          );
      }
    },
    [boundary.epoch, boundary.suspended, eventId, setParams],
  );
  /** Reject interactions after an operation boundary has changed synchronously. */
  const admitted = useCallback(
    /** Read the live owner boundary. */ () => {
      const live = readBoundary?.() ?? boundary;
      return !live.suspended && live.epoch === boundary.epoch;
    },
    [boundary, readBoundary],
  );
  useEffect(
    /** Follow date URL changes without reconstructing event data. */ () => {
      if (dateIntent && isValidDate(dateIntent)) {
        setSelected(dateIntent);
        setMonth(dateIntent);
      }
    },
    [dateIntent],
  );
  useEffect(
    /** Recompute the viewer day on focus, visibility and midnight. */ () => {
      /** Refresh only presentation time, never reminder scheduling. */
      function refreshToday() {
        setToday(todayDate(zone));
      }
      window.addEventListener("focus", refreshToday);
      document.addEventListener("visibilitychange", refreshToday);
      const timer = setInterval(refreshToday, 60_000);
      refreshToday();
      return /** Remove the presentation clock listeners. */ () => {
        window.removeEventListener("focus", refreshToday);
        document.removeEventListener("visibilitychange", refreshToday);
        clearInterval(timer);
      };
    },
    [zone],
  );
  useEffect(
    /** Validate scope and load optional labels through the public Projects adapter. */ () => {
      let retired = false;
      let sequence = 0;
      let cleanup: (() => void) | undefined;
      /** Prevent old project metadata crossing reset or scope changes. */
      async function load() {
        const ticket = ++sequence;
        setProject({ id: null, ready: projectIntent === null, error: false });
        setProjectNames({});
        if (boundary.suspended) return;
        try {
          if (projectIntent) {
            const result = await getProject(projectIntent);
            if (retired || ticket !== sequence || !admitted()) return;
            setProject({
              id: result.id,
              ready: result.id === projectIntent,
              error: result.id !== projectIntent,
            });
          }
          const rows = await listProjects().catch(
            /** Missing labels never invalidate an already verified project. */ () => [],
          );
          if (!retired && ticket === sequence && admitted())
            setProjectNames(
              Object.fromEntries(
                rows.map(
                  /** Index display labels without owning project state. */ (row) => [
                    row.id,
                    row.displayName,
                  ],
                ),
              ),
            );
        } catch {
          if (!retired && ticket === sequence && admitted() && projectIntent)
            setProject({ id: null, ready: false, error: true });
        }
      }
      void load();
      void onProjectsChanged(
        /** Revalidate the scope after rename, deletion or import. */ () => {
          void load();
        },
      )
        .then(
          /** Close subscriptions resolved after cleanup. */ (unlisten) => {
            if (retired) unlisten();
            else {
              cleanup = unlisten;
              void load();
            }
          },
        )
        .catch(/** Optional labels remain non-blocking for global reads. */ () => {});
      return /** Retire label reads and subscriptions. */ () => {
        retired = true;
        cleanup?.();
      };
    },
    [projectIntent, boundary.suspended, admitted],
  );
  const days = monthGrid(month);
  const enabled = project.ready && project.id === projectIntent && !invalidDate;
  const createIntent = params.get("new") === "1";
  const handledCreate = useRef(false);
  useEffect(
    /** Admit a dashboard create link only after its date/project scope is verified. */ () => {
      if (!createIntent) {
        handledCreate.current = false;
        return;
      }
      if (handledCreate.current || !enabled || !admitted() || !onCreateEvent) return;
      handledCreate.current = true;
      onCreateEvent({ date: selected, projectId: project.id });
      setParams(
        /** Consume this navigation intent once. */ (previous) => {
          const next = new URLSearchParams(previous);
          next.delete("new");
          return next;
        },
        { replace: true },
      );
    },
    [createIntent, enabled, admitted, onCreateEvent, selected, project.id, setParams],
  );
  const monthQuery = useCalendarQuery(
    enabled
      ? {
          ...calendarRange(days[0], days.length, zone, project.id),
          endDateExclusive: addDays(days[days.length - 1], 1),
        }
      : null,
    boundary,
    readBoundary,
  );
  const agendaQuery = useCalendarQuery(
    enabled
      ? calendarRange(
          panel === "day" ? selected : today,
          panel === "day" ? 1 : 14,
          zone,
          project.id,
        )
      : null,
    boundary,
    readBoundary,
  );
  /** Refresh clean query snapshots after a detail mutation invalidation. */
  const refresh = useCallback(
    /** Delegate coalescing to each query owner. */ () => {
      monthQuery.retry();
      agendaQuery.retry();
    },
    [monthQuery.retry, agendaQuery.retry],
  );
  /** Select a date and keep it visible in the month grid. */
  function select(date: string) {
    if (!admitted()) return;
    setSelected(date);
    setMonth(date);
    setPanel("day");
  }
  /** Open a real definition while retaining opaque occurrence context. */
  function open(item: CalendarOccurrenceDto) {
    if (!admitted()) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOccurrence(item);
    setParams(
      /** Preserve valid scope when opening the detail. */ (previous) => {
        const next = new URLSearchParams(previous);
        next.set("event", item.eventId);
        next.set("occurrence", item.occurrenceId);
        return next;
      },
    );
  }
  /** Close only the event intent and keep the current date selection. */
  function close() {
    setOccurrence(null);
    setParams(
      /** Remove the consumed detail intent. */ (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("event");
        next.delete("occurrence");
        return next;
      },
    );
  }
  /** Open only the backend-validated reminder target, retaining its opaque occurrence. */
  function openReminderTarget(target: ReminderTargetDto) {
    if (!admitted()) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOccurrence(null);
    setParams(
      /** Preserve date while applying the validated event and optional project. */ (previous) => {
        const next = new URLSearchParams(previous);
        next.set("event", target.eventId);
        next.set("occurrence", target.occurrenceId);
        if (target.projectId) next.set("project", target.projectId);
        else next.delete("project");
        return next;
      },
    );
  }
  /** Retire occurrence context after an acknowledged event definition change. */
  const clearOccurrence = useCallback(() => {
    setOccurrence(null);
    setParams(
      /** Keep base detail open without stale recurrence identity. */ (previous) => {
        if (!previous.has("occurrence")) return previous;
        const next = new URLSearchParams(previous);
        next.delete("occurrence");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);
  /** Restore keyboard focus after the modal has released its focus trap. */
  function restoreFocus() {
    if (admitted()) (opener.current?.isConnected ? opener.current : heading.current)?.focus();
  }
  const issue = monthQuery.error ?? agendaQuery.error;
  return (
    <section
      className="min-w-0 space-y-4 p-6"
      aria-busy={monthQuery.loading || agendaQuery.loading}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
            Calendar
          </h1>
          <p className="text-xs text-muted">Time zone: {zone}</p>
        </div>
        {onCreateEvent && (
          <button
            type="button"
            disabled={boundary.suspended || !enabled}
            onClick={
              /** Delegate creation to the installed event owner. */ () => {
                if (admitted() && enabled) onCreateEvent({ date: selected, projectId: project.id });
              }
            }
          >
            New Event
          </button>
        )}
      </div>
      {(invalidDate || project.error) && (
        <div role="alert">
          {invalidDate ? "Invalid calendar date." : "This project is no longer available."}
          <button
            type="button"
            onClick={
              /** Clear an invalid URL scope and return to Today. */ () => {
                if (admitted()) {
                  setParams({});
                  select(today);
                }
              }
            }
          >
            Today
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={boundary.suspended || month.slice(0, 7) === "1900-01"}
          onClick={
            /** Move the selected month with date clamping. */ () => select(shiftMonth(month, -1))
          }
        >
          Previous month
        </button>
        <h2 className="font-semibold">{formatCalendarMonth(month)}</h2>
        <button
          type="button"
          disabled={boundary.suspended || month.slice(0, 7) === "9999-12"}
          onClick={
            /** Move forward within backend year bounds. */ () => select(shiftMonth(month, 1))
          }
        >
          Next month
        </button>
        <button
          type="button"
          disabled={boundary.suspended}
          onClick={/** Reset the visible date to today. */ () => select(today)}
        >
          Today
        </button>
      </div>
      {(monthQuery.loading || agendaQuery.loading) && <p role="status">Loading calendar…</p>}
      {(monthQuery.refreshing || agendaQuery.refreshing) && (
        <p role="status">Refreshing calendar…</p>
      )}
      {(monthQuery.listenerError || agendaQuery.listenerError) && (
        <p role="alert">
          Calendar updates are unavailable{" "}
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
      {issue != null && (
        <div role="alert">
          {calendarErrorCopy(issue)}
          {(monthQuery.snapshot || agendaQuery.snapshot) && (
            <p>Displayed events may be out of date.</p>
          )}
          <button type="button" onClick={refresh}>
            Retry
          </button>
          {calendarErrorKind(issue) === "invalid_time_zone" && (
            <button
              type="button"
              onClick={/** Let the user explicitly recover with UTC. */ () => setZone("UTC")}
            >
              Use UTC
            </button>
          )}
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <CalendarMonth
            month={month}
            selectedDate={selected}
            today={today}
            items={monthQuery.snapshot?.items ?? []}
            zone={zone}
            disabled={boundary.suspended || !enabled}
            onSelect={select}
            onOpen={open}
          />
          {monthQuery.snapshot?.items.length === 0 && (
            <p className="text-sm text-muted">No events this month</p>
          )}
        </div>
        <aside className="min-w-0 space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={panel === "day"}
              disabled={boundary.suspended}
              onClick={/** Show the dedicated one-day overlap query. */ () => setPanel("day")}
            >
              Day
            </button>
            <button
              type="button"
              aria-pressed={panel === "upcoming"}
              disabled={boundary.suspended}
              onClick={/** Show the bounded fourteen-day projection. */ () => setPanel("upcoming")}
            >
              Upcoming
            </button>
            <button
              type="button"
              aria-pressed={panel === "missed"}
              disabled={boundary.suspended}
              aria-label={missed.page ? `Missed (${missed.page.missedCount})` : "Missed"}
              onClick={/** Show the global backend Missed projection. */ () => setPanel("missed")}
            >
              Missed
              {missed.page
                ? ` (${missed.page.missedCount > 99 ? "99+" : missed.page.missedCount})`
                : ""}
            </button>
          </div>
          {panel === "missed" ? (
            <CalendarMissed
              reminders={missed}
              projectScoped={projectIntent !== null}
              onOpen={openReminderTarget}
              onUpcoming={
                /** Return from the empty Missed state to future occurrences. */ () =>
                  setPanel("upcoming")
              }
            />
          ) : (
            <>
              <h2 className="font-semibold">
                {panel === "day" ? formatCalendarDate(selected) : "Next 14 days"}
              </h2>
              {agendaQuery.snapshot && (
                <CalendarAgenda
                  items={agendaQuery.snapshot.items}
                  zone={zone}
                  upcoming={panel === "upcoming"}
                  disabled={boundary.suspended}
                  projectNames={projectNames}
                  onOpen={open}
                />
              )}
            </>
          )}{" "}
          {panel === "day" && onCreateEvent && (
            <button
              type="button"
              disabled={boundary.suspended || !enabled}
              onClick={
                /** Preserve the selected date and validated project prefill. */ () => {
                  if (admitted() && enabled)
                    onCreateEvent({ date: selected, projectId: project.id });
                }
              }
            >
              New event this day
            </button>
          )}
        </aside>
      </div>
      {eventId && !boundary.suspended && (
        <EventDetailPanel
          key={`${eventId}:${boundary.epoch}`}
          eventId={eventId}
          occurrence={occurrence?.eventId === eventId ? occurrence : null}
          occurrenceId={occurrenceId}
          zone={zone}
          boundary={boundary}
          readBoundary={readBoundary}
          onClose={close}
          onChanged={refresh}
          onOccurrenceInvalidated={clearOccurrence}
          restoreFocus={restoreFocus}
        />
      )}
    </section>
  );
}
