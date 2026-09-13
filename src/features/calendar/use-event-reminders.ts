import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EventReminderDeliveriesDto,
  VisibleCalendarEventInputDto,
} from "@/bindings/reminders";
import {
  getEventReminderDeliveries,
  onRemindersChanged,
  setVisibleCalendarEvent,
} from "@/lib/ipc/reminders";
import type { CalendarBoundary } from "./use-calendar-query";

// Every mounted detail shares the native projection; retire A before admitting B's show.
let visibilityQueue: Promise<void> = Promise.resolve();
/** Serialize visibility IPC across replacement React component owners. */
function enqueue(input: VisibleCalendarEventInputDto, admitted?: () => boolean): Promise<void> {
  const next = visibilityQueue.then(
    /** Skip a show retired before its queue slot starts. */ async () => {
      if (!admitted || admitted()) await setVisibleCalendarEvent(input);
    },
  );
  visibilityQueue = next.catch(
    /** Keep cleanup and newer owners progressing after failure. */ () => {},
  );
  return next;
}

/** Own authoritative delivery reads and a token-scoped visible-detail lifetime. */
export function useEventReminders(
  eventId: string,
  occurrenceId: string | null,
  visible: boolean,
  boundary: CalendarBoundary,
  readBoundary?: () => CalendarBoundary,
) {
  const [snapshot, setSnapshot] = useState<EventReminderDeliveriesDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [listenerError, setListenerError] = useState(false);
  const [visibilityError, setVisibilityError] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(document.visibilityState === "visible");
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ eventId, occurrenceId, boundary, readBoundary, visible });
  latest.current = { eventId, occurrenceId, boundary, readBoundary, visible };
  /** Reject callbacks after synchronous selection, mode or maintenance changes. */
  const admitted = useCallback(() => {
    const current = latest.current;
    const live = current.readBoundary?.() ?? current.boundary;
    return (
      current.eventId === eventId &&
      current.occurrenceId === occurrenceId &&
      !live.suspended &&
      live.epoch === boundary.epoch
    );
  }, [eventId, occurrenceId, boundary.epoch]);
  useEffect(
    /** Track WebView visibility independently from backend main-window visibility. */ () => {
      /** Hide the projection as soon as the document is backgrounded. */
      function changed() {
        setDocumentVisible(document.visibilityState === "visible");
      }
      document.addEventListener("visibilitychange", changed);
      return /** Release document visibility ownership. */ () =>
        document.removeEventListener("visibilitychange", changed);
    },
    [],
  );
  useEffect(
    /** Register actual visible detail with serialized token cleanup. */ () => {
      void attempt;
      setVisibilityError(false);
      if (!visible || !documentVisible || boundary.suspended) return;
      let retired = false;
      const viewToken = crypto.randomUUID();
      /** Recheck mode and document state immediately before queued show IPC. */
      function canShow() {
        return (
          !retired && admitted() && latest.current.visible && document.visibilityState === "visible"
        );
      }
      void enqueue({ kind: "show", viewToken, eventId, occurrenceId }, canShow).catch(
        /** Surface only errors belonging to the current visible owner. */ () => {
          if (canShow()) setVisibilityError(true);
        },
      );
      return /** Wait for any admitted show before removing this token. */ () => {
        retired = true;
        void enqueue({ kind: "hide", viewToken }).catch(
          /** Retired cleanup cannot publish an error to a replacement view. */ () => {},
        );
      };
    },
    [visible, documentVisible, boundary.suspended, eventId, occurrenceId, admitted, attempt],
  );
  useEffect(
    /** Read only supplied occurrence identities and preserve event drafts outside this hook. */ () => {
      void attempt;
      setSnapshot(null);
      setError(null);
      setListenerError(false);
      setLoading(false);
      if (!occurrenceId || boundary.suspended) return;
      const selectedOccurrenceId = occurrenceId;
      let retired = false;
      let generation = 0;
      let running = false;
      let dirty = false;
      let unlisten: (() => void) | undefined;
      /** Keep one read active and reject every response invalidated while it was pending. */
      async function load() {
        if (retired || !admitted()) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        dirty = false;
        const ticket = generation;
        setLoading(true);
        setError(null);
        try {
          const result = await getEventReminderDeliveries(eventId, selectedOccurrenceId);
          if (!retired && admitted() && ticket === generation) setSnapshot(result);
        } catch (issue) {
          if (!retired && admitted() && ticket === generation) setError(issue);
        } finally {
          running = false;
          if (!retired && admitted()) {
            setLoading(false);
            if (dirty) void load();
          }
        }
      }
      /** Retire current reads before refreshing a changed delivery snapshot. */
      function changed() {
        generation++;
        void load();
      }
      void onRemindersChanged(changed)
        .then(
          /** Cover subscription setup while releasing late handles. */ (cleanup) => {
            if (retired) cleanup();
            else {
              unlisten = cleanup;
              changed();
            }
          },
        )
        .catch(
          /** Keep delivery read retry available after listener failure. */ () => {
            if (!retired && admitted()) setListenerError(true);
          },
        );
      void load();
      window.addEventListener("focus", changed);
      return /** Retire occurrence reads and their subscription. */ () => {
        retired = true;
        unlisten?.();
        window.removeEventListener("focus", changed);
      };
    },
    [eventId, occurrenceId, boundary.suspended, admitted, attempt],
  );
  const retry = useCallback(
    /** Retry failed reads, subscriptions and visibility as one explicit action. */ () =>
      setAttempt(/** Restart this reminder lifetime. */ (value) => value + 1),
    [],
  );
  const current =
    snapshot?.eventId === eventId && snapshot.occurrenceId === occurrenceId && !boundary.suspended;
  return {
    snapshot: current ? snapshot : null,
    error,
    loading,
    listenerError,
    visibilityError,
    retry,
  };
}
