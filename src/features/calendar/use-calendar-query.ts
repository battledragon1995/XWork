import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarOccurrenceListDto, CalendarRangeInputDto } from "@/bindings/calendar";
import { listCalendarOccurrences, onCalendarChanged } from "@/lib/ipc/calendar";
import { onProjectsChanged, type UnlistenFn } from "@/lib/ipc/projects";

export interface CalendarBoundary {
  suspended: boolean;
  epoch: number;
}
interface QueryState {
  key: string;
  snapshot: CalendarOccurrenceListDto | null;
  loading: boolean;
  refreshing: boolean;
  error: unknown | null;
  listenerError: boolean;
}
const IDLE_BOUNDARY: CalendarBoundary = { suspended: false, epoch: 0 };

/** Own a bounded snapshot and retire asynchronous work across each UI lifetime. */
export function useCalendarQuery(
  input: CalendarRangeInputDto | null,
  boundary: CalendarBoundary = IDLE_BOUNDARY,
  readBoundary?: () => CalendarBoundary,
) {
  const key = JSON.stringify([input, boundary.epoch, boundary.suspended]);
  const reader = useRef(readBoundary);
  useEffect(
    /** Keep synchronous admission aligned with the latest app reader. */ () => {
      reader.current = readBoundary;
    },
    [readBoundary],
  );
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(
    /** Restart the read lifetime without changing callback identity. */ () =>
      setAttempt(/** Advance the retry generation. */ (value) => value + 1),
    [],
  );
  const [state, setState] = useState<QueryState>({
    key: "",
    snapshot: null,
    loading: false,
    refreshing: false,
    error: null,
    listenerError: false,
  });
  useEffect(
    /** Subscribe before reading and clean up even late subscription completions. */ () => {
      // Retry deliberately retires and recreates this subscription lifetime.
      void attempt;
      const [query] = JSON.parse(key) as [CalendarRangeInputDto | null];
      if (!query || boundary.suspended) return;
      let disposed = false;
      let ready = false;
      let running = false;
      let dirty = false;
      let version = 0;
      const cleanups: UnlistenFn[] = [];
      /** Check the synchronous epoch even before React rerenders. */
      const admitted = () => {
        const live = reader.current?.() ?? { epoch: boundary.epoch, suspended: boundary.suspended };
        return !disposed && !live.suspended && live.epoch === boundary.epoch;
      };
      /** Coalesce invalidations into at most one follow-up read per active flight. */
      async function refresh() {
        if (!admitted()) return;
        if (!ready || running) {
          dirty = true;
          return;
        }
        running = true;
        dirty = false;
        const readVersion = version;
        setState(
          /** Retain only a snapshot belonging to this exact query. */ (previous) => ({
            key,
            snapshot: previous.key === key ? previous.snapshot : null,
            loading: previous.key !== key || !previous.snapshot,
            refreshing: previous.key === key && !!previous.snapshot,
            error: null,
            listenerError: previous.key === key && previous.listenerError,
          }),
        );
        try {
          const snapshot = await listCalendarOccurrences(query as CalendarRangeInputDto);
          if (admitted() && readVersion === version)
            setState(
              /** Publish the authoritative current response. */ (previous) => ({
                ...previous,
                snapshot,
                loading: false,
                refreshing: false,
                error: null,
              }),
            );
        } catch (error) {
          if (admitted() && readVersion === version)
            setState(
              /** Keep a readable stale snapshot alongside the read failure. */ (previous) => ({
                ...previous,
                loading: false,
                refreshing: false,
                error,
              }),
            );
        } finally {
          running = false;
          if (dirty && admitted()) void refresh();
        }
      }
      /** Invalidate active reads so a pre-change response cannot briefly publish. */
      function invalidate() {
        version++;
        void refresh();
      }
      /** Refresh only when the application is visible. */
      function visibleRefresh() {
        if (document.visibilityState === "visible") invalidate();
      }
      /** Track each listener independently and close registrations that finish after cleanup. */
      async function subscribe(promise: Promise<UnlistenFn>) {
        try {
          const unlisten = await promise;
          if (disposed) unlisten();
          else cleanups.push(unlisten);
        } catch {
          if (admitted())
            setState(
              /** Expose update failure without blocking an ordinary read. */ (previous) => ({
                ...previous,
                key,
                listenerError: true,
              }),
            );
        }
      }
      setState(
        /** Reset the new lifetime while preserving same-query retry data. */ (previous) => ({
          key,
          snapshot: previous.key === key ? previous.snapshot : null,
          loading: previous.key !== key || !previous.snapshot,
          refreshing: previous.key === key && !!previous.snapshot,
          error: null,
          listenerError: false,
        }),
      );
      void Promise.all([
        subscribe(onCalendarChanged(invalidate)),
        subscribe(onProjectsChanged(invalidate)),
      ]).then(
        /** Read only after both subscription attempts settle. */ () => {
          ready = true;
          void refresh();
        },
      );
      window.addEventListener("focus", visibleRefresh);
      document.addEventListener("visibilitychange", visibleRefresh);
      return /** Retire all responses and release browser/native subscriptions. */ () => {
        disposed = true;
        for (const unlisten of cleanups) unlisten();
        window.removeEventListener("focus", visibleRefresh);
        document.removeEventListener("visibilitychange", visibleRefresh);
      };
    },
    [key, attempt, boundary.epoch, boundary.suspended],
  );
  const current = state.key === key && !boundary.suspended && input !== null;
  return {
    snapshot: current ? state.snapshot : null,
    loading: current ? state.loading : input !== null && !boundary.suspended,
    refreshing: current && state.refreshing,
    error: current ? state.error : null,
    listenerError: current && state.listenerError,
    retry,
  };
}
