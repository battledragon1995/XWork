import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MissedReminderPageDto,
  ReminderDeliveryDto,
  ReminderTargetDto,
  ReminderChangedDto,
} from "@/bindings/reminders";
import { reminderErrorCode } from "@/lib/ipc/reminder-error";
import { onCalendarChanged } from "@/lib/ipc/calendar";
import {
  dismissAllMissedReminders,
  dismissReminder,
  getMissedReminders,
  onRemindersChanged,
  openReminder,
} from "@/lib/ipc/reminders";
import type { CalendarBoundary } from "./use-calendar-query";

/** Own global Missed pages and reject work crossing a Calendar operation boundary. */
export function useMissedReminders(
  boundary: CalendarBoundary,
  readBoundary?: () => CalendarBoundary,
) {
  const [page, setPage] = useState<MissedReminderPageDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [listenerError, setListenerError] = useState(false);
  const owner = useRef({
    epoch: -1,
    generation: 0,
    sequence: -1n,
    retired: true,
    busy: false,
    dirty: false,
  });
  const latest = useRef({ boundary, readBoundary, page, error });
  latest.current = { boundary, readBoundary, page, error };
  const [attempt, setAttempt] = useState(0);
  /** Resolve live admission synchronously before every read and mutation. */
  const admitted = useCallback(() => {
    const current = latest.current;
    const live = current.readBoundary?.() ?? current.boundary;
    return (
      !owner.current.retired &&
      owner.current.epoch === current.boundary.epoch &&
      !live.suspended &&
      live.epoch === current.boundary.epoch
    );
  }, []);
  /** Read one page; invalidations retire an in-flight response before refreshing the first page. */
  const load = useCallback(
    async (more = false): Promise<void> => {
      const active = owner.current;
      if (!admitted()) return;
      if (active.busy) {
        if (!more) active.dirty = true;
        return;
      }
      const previous = latest.current.page;
      if (more && !previous?.nextCursor) return;
      active.busy = true;
      active.dirty = false;
      const generation = active.generation;
      setLoading(true);
      setError(null);
      latest.current.error = null;
      try {
        const result = await getMissedReminders(more ? (previous?.nextCursor ?? null) : null, 30);
        if (owner.current !== active || !admitted() || generation !== active.generation) return;
        if (BigInt(result.sequence) < active.sequence) throw new Error("Stale reminder snapshot");
        active.sequence = BigInt(result.sequence);
        if (more && previous && result.sequence !== previous.sequence) {
          active.dirty = true;
        } else {
          const seen = new Set<string>();
          const items = (
            more && previous ? [...previous.items, ...result.items] : result.items
          ).filter(
            /** Preserve first server ordering without duplicate delivery identities. */ (item) => {
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            },
          );
          const snapshot = { ...result, items };
          latest.current.page = snapshot;
          setPage(snapshot);
        }
      } catch (issue) {
        if (owner.current === active && admitted() && generation === active.generation) {
          if (more && reminderErrorCode(issue) === "invalid_cursor") active.dirty = true;
          else {
            latest.current.error = issue;
            setError(issue);
          }
        }
      } finally {
        active.busy = false;
        if (owner.current === active && admitted()) {
          setLoading(false);
          if (active.dirty) void load();
        }
      }
    },
    [admitted],
  );
  useEffect(
    /** Subscribe once per boundary and cover the registration race with a fresh read. */ () => {
      void attempt;
      const active = {
        epoch: boundary.epoch,
        generation: 0,
        sequence: -1n,
        retired: false,
        busy: false,
        dirty: false,
      };
      owner.current = active;
      latest.current.page = null;
      setPage(null);
      setError(null);
      setPending(false);
      setActionError(null);
      setLoading(false);
      setListenerError(false);
      if (boundary.suspended) return;
      const cleanups: (() => void)[] = [];
      /** Invalidate response generations and coalesce overlapping notifications. */
      function refresh() {
        active.generation++;
        void load();
      }
      /** Ignore duplicate/older invalidations while retaining exact decimal sequence ordering. */
      function reminderChanged(event: ReminderChangedDto) {
        if (BigInt(event.sequence) <= active.sequence) return;
        active.sequence = BigInt(event.sequence);
        refresh();
      }
      /** Refresh visible application snapshots without scheduler polling. */
      function focus() {
        if (document.visibilityState === "visible") refresh();
      }
      for (const subscription of [
        onRemindersChanged(reminderChanged),
        onCalendarChanged(refresh),
      ]) {
        void subscription
          .then(
            /** Close registrations arriving after retirement. */ (cleanup) => {
              if (active.retired) cleanup();
              else {
                cleanups.push(cleanup);
                refresh();
              }
            },
          )
          .catch(
            /** Preserve manual refresh when subscriptions fail. */ () => {
              if (owner.current === active && admitted()) setListenerError(true);
            },
          );
      }
      void load();
      window.addEventListener("focus", focus);
      document.addEventListener("visibilitychange", focus);
      return /** Retire reads, actions and late subscriptions together. */ () => {
        active.retired = true;
        for (const cleanup of cleanups) cleanup();
        window.removeEventListener("focus", focus);
        document.removeEventListener("visibilitychange", focus);
      };
    },
    [boundary.epoch, boundary.suspended, attempt, admitted, load],
  );
  /** Serialize navigation and mutation with paging and always reconcile acknowledged or uncertain writes. */
  async function action(
    kind: "open" | "dismiss" | "all",
    row?: ReminderDeliveryDto,
  ): Promise<ReminderTargetDto | null> {
    const active = owner.current;
    if (!admitted() || active.busy || latest.current.error != null) return null;
    active.busy = true;
    active.generation++;
    setPending(true);
    setActionError(null);
    let target: ReminderTargetDto | null = null;
    let failed = false;
    try {
      if (kind === "open" && row) target = await openReminder(row.id);
      else if (kind === "dismiss" && row) await dismissReminder(row.id, row.version);
      else if (kind === "all") await dismissAllMissedReminders();
      if (!admitted() || owner.current !== active) return null;
      return target;
    } catch (issue) {
      failed = true;
      if (admitted() && owner.current === active) setActionError(issue);
      return null;
    } finally {
      active.busy = false;
      if (admitted() && owner.current === active) {
        setPending(false);
        if (kind !== "open" || failed || active.dirty) {
          void load();
        }
      }
    }
  }
  const retry = useCallback(
    /** Restart failed subscriptions as well as the page read. */ () =>
      setAttempt(/** Advance one explicit retry lifetime. */ (value) => value + 1),
    [],
  );
  return {
    page: boundary.suspended ? null : page,
    loading,
    pending,
    error: actionError ?? error,
    stale: page !== null && error != null,
    listenerError,
    retry,
    loadMore: /** Request only the next backend cursor. */ () => load(true),
    action,
  };
}
