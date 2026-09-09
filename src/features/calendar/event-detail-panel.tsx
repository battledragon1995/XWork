import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { CalendarEventDto, CalendarOccurrenceDto } from "@/bindings/calendar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getCalendarEvent, onCalendarChanged } from "@/lib/ipc/calendar";
import { getProject, onProjectsChanged } from "@/lib/ipc/projects";
import { calendarErrorCopy, calendarErrorKind } from "./calendar-error-copy";
import { occurrenceLabel, recurrenceSummary, reminderSummary } from "./calendar-presentation";
import type { CalendarBoundary } from "./use-calendar-query";
interface Props {
  eventId: string;
  occurrence: CalendarOccurrenceDto | null;
  zone: string;
  boundary: CalendarBoundary;
  readBoundary?(): CalendarBoundary;
  onClose(): void;
  onChanged(): void;
  restoreFocus(): void;
}
/** Own the authoritative read detail; FE022 extends this same owner for mutations. */
export function EventDetailPanel({
  eventId,
  occurrence,
  zone,
  boundary,
  readBoundary,
  onClose,
  onChanged,
  restoreFocus,
}: Props) {
  const [state, setState] = useState<{
    event: CalendarEventDto | null;
    error: unknown;
    project: { id: string; name: string } | null;
    loading: boolean;
    context: CalendarOccurrenceDto | null;
  }>({ event: null, error: null, project: null, loading: true, context: occurrence });
  const [retry, setRetry] = useState(0);
  const [listenerError, setListenerError] = useState(false);
  useEffect(
    /** Bound event details and project labels to this selection and operation epoch. */ () => {
      void retry;
      let retired = false;
      let sequence = 0;
      const unlisteners: (() => void)[] = [];
      /** Check synchronous admission before publishing native responses. */
      function valid(ticket: number) {
        const live = readBoundary?.() ?? { epoch: boundary.epoch, suspended: boundary.suspended };
        return !retired && sequence === ticket && !live.suspended && live.epoch === boundary.epoch;
      }
      /** Replace clean detail after invalidation and discard stale occurrence context. */
      async function load(invalidated = false) {
        const ticket = ++sequence;
        if (boundary.suspended) return;
        setState({
          event: null,
          error: null,
          project: null,
          loading: true,
          context: invalidated ? null : occurrence,
        });
        try {
          const event = await getCalendarEvent(eventId);
          if (!valid(ticket)) return;
          setState({
            event,
            error: null,
            project: null,
            loading: false,
            context: invalidated ? null : occurrence,
          });
          if (event.projectId) {
            try {
              const project = await getProject(event.projectId);
              if (valid(ticket))
                setState(
                  /** Attach only the still-current project label. */ (previous) => ({
                    ...previous,
                    project: { id: project.id, name: project.displayName },
                  }),
                );
            } catch {
              /* Event reads do not depend on project availability. */
            }
          }
        } catch (error) {
          if (valid(ticket)) {
            setState({ event: null, error, project: null, loading: false, context: null });
            if (calendarErrorKind(error) === "event_not_found") onChanged();
          }
        }
      }
      /** Refresh both the detail and visible owner queries. */
      function changed() {
        onChanged();
        void load(true);
      }
      setListenerError(false);
      for (const subscribe of [onCalendarChanged, onProjectsChanged]) {
        void subscribe(changed)
          .then(
            /** Close late subscriptions or cover setup races. */ (unlisten) => {
              if (retired) unlisten();
              else {
                unlisteners.push(unlisten);
                void load(true);
              }
            },
          )
          .catch(
            /** Keep a recoverable subscription warning. */ () => {
              if (!retired) setListenerError(true);
            },
          );
      }
      void load();
      window.addEventListener("focus", changed);
      return /** Retire pending read work before removing listeners. */ () => {
        retired = true;
        sequence++;
        for (const unlisten of unlisteners) unlisten();
        window.removeEventListener("focus", changed);
      };
    },
    [eventId, occurrence, boundary.epoch, boundary.suspended, readBoundary, retry, onChanged],
  );
  const event = state.event;
  return (
    <Dialog
      open={!boundary.suspended}
      onOpenChange={
        /** Close from Escape or the dialog close control. */ (open) => {
          if (!open) onClose();
        }
      }
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        onCloseAutoFocus={
          /** Return focus to the surviving opener or Calendar heading. */ (e) => {
            e.preventDefault();
            restoreFocus();
          }
        }
      >
        <DialogTitle>{event?.title ?? "Event details"}</DialogTitle>
        <DialogDescription>Calendar event details</DialogDescription>
        {state.loading && <p role="status">Loading event…</p>}
        {state.error != null && <p role="alert">{calendarErrorCopy(state.error)}</p>}
        {listenerError && <p role="alert">Calendar updates are unavailable</p>}
        {(state.error != null || listenerError) && (
          <button
            type="button"
            onClick={
              /** Retry subscription and authoritative detail. */ () =>
                setRetry((value) => value + 1)
            }
          >
            Retry
          </button>
        )}
        {event && (
          <div className="space-y-3 break-words text-sm">
            {state.context && <p>Selected occurrence: {occurrenceLabel(state.context, zone)}</p>}
            <p>
              Base schedule:{" "}
              {event.time.kind === "all_day"
                ? `${event.time.startDate} – ${event.time.endDateExclusive} (exclusive), all day`
                : `${event.time.startLocal} – ${event.time.endLocal}`}
            </p>
            <p>Time zone: {event.time.timeZoneId}</p>
            <p className="whitespace-pre-wrap">{event.description || "No description"}</p>
            <p>{recurrenceSummary(event.recurrence)}</p>
            <p>{reminderSummary(event.reminders)}</p>
            {state.project && (
              <Link
                to={`/projects/${encodeURIComponent(state.project.id)}`}
                onClick={
                  /** Block navigation after synchronous boundary changes. */ (e) => {
                    const live = readBoundary?.() ?? {
                      epoch: boundary.epoch,
                      suspended: boundary.suspended,
                    };
                    if (live.suspended || live.epoch !== boundary.epoch) e.preventDefault();
                  }
                }
              >
                Project: {state.project.name}
              </Link>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
