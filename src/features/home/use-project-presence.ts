import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDto } from "@/bindings/projects/projects";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listProjects, onProjectsChanged } from "@/lib/ipc/projects";
import type { HomeRouteProps } from "./home-route";

export type ProjectPresence =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "present" }
  | { status: "failed"; kind: "retryable" | "integration" };

export interface HomeQueryState<T> {
  snapshot: T[] | null;
  loading: boolean;
  refreshing: boolean;
  failure: "retryable" | "integration" | null;
  subscriptionFailed: boolean;
  refresh(): void;
}

interface QuerySource<T> {
  list(): Promise<T[]>;
  subscribe(invalidate: (removedId?: string) => void): Promise<() => void>;
  retryable: string[];
}

const DEFAULT_BOUNDARY = { suspended: false, epoch: 0 };

/** Share the two Home read lifetimes without duplicating subscription and retirement rules. */
export function useHomeQuery<T extends { id: string }>(
  source: QuerySource<T>,
  props: HomeRouteProps,
  enabled = true,
  invalidation = 0,
  onInvalidate?: () => void,
  onMissingProject?: () => void,
): HomeQueryState<T> {
  const boundary = props.boundary ?? DEFAULT_BOUNDARY;
  const current = useRef({ props, enabled, onInvalidate, onMissingProject });
  current.current = { props, enabled, onInvalidate, onMissingProject };
  const [state, setState] = useState({
    epoch: boundary.epoch,
    snapshot: null as T[] | null,
    refreshing: false,
    failure: null as HomeQueryState<T>["failure"],
    subscriptionFailed: false,
  });
  const refreshRef = useRef<() => void>(() => {
    /* No work before subscription setup. */
  });
  const invalidateRef = useRef<() => void>(() => {
    /* No active query to invalidate. */
  });
  /** Keep the retry API stable across provider and query updates. */
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(
    /** Synchronize the active query lifetime with its rendered invalidation boundary. */ () => {
      if (!enabled || boundary.suspended) return;
      let disposed = false;
      let flight = false;
      let dirty = false;
      let registering = false;
      let unlisten: (() => void) | undefined;
      let reconciled = false;
      const epoch = boundary.epoch;
      /** Check live owner state before every asynchronous publication. */
      function valid() {
        const live =
          current.current.props.readBoundary?.() ??
          current.current.props.boundary ??
          DEFAULT_BOUNDARY;
        return !disposed && current.current.enabled && !live.suspended && live.epoch === epoch;
      }
      /** Run at most one request and discard responses invalidated during its flight. */
      async function query() {
        if (!valid() || registering) return;
        if (flight) {
          dirty = true;
          return;
        }
        flight = true;
        dirty = false;
        setState(
          /** Retain independent query flags while publishing this transition. */ (previous) => ({
            ...previous,
            refreshing: true,
          }),
        );
        try {
          const snapshot = await source.list();
          if (valid() && !dirty)
            setState(
              /** Retain independent query flags while publishing this transition. */ (
                previous,
              ) => ({ ...previous, epoch, snapshot, failure: null }),
            );
        } catch (cause) {
          if (valid() && !dirty) {
            const code = cause instanceof IpcCallError ? cause.payload?.code : null;
            if (code === "projectNotFound" && !reconciled && current.current.onMissingProject) {
              reconciled = true;
              dirty = true;
              current.current.onMissingProject();
            } else {
              setState(
                /** Retain independent query flags while publishing this transition. */ (
                  previous,
                ) => ({
                  ...previous,
                  epoch,
                  failure: source.retryable.includes(code ?? "") ? "retryable" : "integration",
                }),
              );
            }
          }
        } finally {
          flight = false;
          if (valid()) {
            if (dirty) void query();
            else
              setState(
                /** Retain independent query flags while publishing this transition. */ (
                  previous,
                ) => ({ ...previous, refreshing: false }),
              );
          }
        }
      }
      /** Retire an in-flight response and remove known deleted rows immediately. */
      function invalidate(removedId?: string) {
        if (!valid()) return;
        if (removedId)
          setState(
            /** Retain independent query flags while publishing this transition. */ (previous) => ({
              ...previous,
              snapshot:
                previous.snapshot?.filter(
                  /** Exclude the authoritative removal identity. */ (row) => row.id !== removedId,
                ) ?? null,
            }),
          );
        current.current.onInvalidate?.();
        void query();
      }
      /** Register before reading; failed registration still permits authoritative manual reads. */
      async function subscribe() {
        if (registering || unlisten || !valid()) return;
        registering = true;
        try {
          const cleanup = await source.subscribe(invalidate);
          if (disposed) {
            cleanup();
            return;
          }
          unlisten = cleanup;
          if (valid())
            setState(
              /** Retain independent query flags while publishing this transition. */ (
                previous,
              ) => ({ ...previous, subscriptionFailed: false }),
            );
        } catch {
          if (valid())
            setState(
              /** Retain independent query flags while publishing this transition. */ (
                previous,
              ) => ({ ...previous, subscriptionFailed: true }),
            );
        } finally {
          registering = false;
          if (valid()) void query();
        }
      }
      /** Explicit recovery also retries a failed listener without multiplying requests. */
      function retry() {
        if (!valid() || flight || registering) return;
        reconciled = false;
        if (!unlisten) void subscribe();
        else void query();
      }
      /** Foreground signals coalesce through the same single-flight query. */
      function focus() {
        if (!document.hidden) invalidate();
      }
      refreshRef.current = retry;
      invalidateRef.current = invalidate;
      setState(
        /** Retain independent query flags while publishing this transition. */ (previous) =>
          previous.epoch === epoch
            ? previous
            : { epoch, snapshot: null, refreshing: true, failure: null, subscriptionFailed: false },
      );
      void subscribe();
      window.addEventListener("focus", focus);
      document.addEventListener("visibilitychange", focus);
      /** Retire pending reads and asynchronous subscriptions on cleanup or suspension. */
      return () => {
        disposed = true;
        unlisten?.();
        window.removeEventListener("focus", focus);
        document.removeEventListener("visibilitychange", focus);
      };
    },
    [source, enabled, boundary.epoch, boundary.suspended],
  );
  const previousInvalidation = useRef(invalidation);
  useEffect(
    /** Synchronize the active query lifetime with its rendered invalidation boundary. */ () => {
      if (previousInvalidation.current !== invalidation) {
        previousInvalidation.current = invalidation;
        invalidateRef.current();
      }
    },
    [invalidation],
  );
  const live = props.readBoundary?.() ?? boundary;
  const retired = state.epoch !== boundary.epoch || live.epoch !== state.epoch;
  const snapshot = retired ? null : state.snapshot;
  const failure = retired ? null : state.failure;
  return {
    snapshot,
    failure,
    loading: snapshot === null && failure === null,
    refreshing: retired ? false : state.refreshing,
    subscriptionFailed: retired ? false : state.subscriptionFailed,
    refresh,
  };
}

const PROJECTS: QuerySource<ProjectDto> = {
  list: listProjects,
  /** Forward only invalidation and a known removal identity. */
  subscribe: (invalidate) =>
    onProjectsChanged(
      /** Treat the event as invalidation rather than a list snapshot. */ (event) =>
        invalidate(event.change === "removed" ? event.projectId : undefined),
    ),
  retryable: ["persistenceFailed"],
};

export interface ProjectPresenceResult extends HomeQueryState<ProjectDto> {
  presence: ProjectPresence;
  projects: ProjectDto[] | null;
  invalidation: number;
}

/** One authoritative project snapshot drives both Welcome presence and recent rows. */
export function useProjectPresence(props: HomeRouteProps = {}): ProjectPresenceResult {
  const [invalidation, setInvalidation] = useState(0);
  const query = useHomeQuery(
    PROJECTS,
    props,
    true,
    0,
    /** Notify the session projection when project membership or metadata changes. */
    () => setInvalidation(/** Advance the Sessions invalidation signal. */ (value) => value + 1),
  );
  const presence: ProjectPresence =
    query.snapshot !== null
      ? { status: query.snapshot.length ? "present" : "empty" }
      : query.failure
        ? { status: "failed", kind: query.failure }
        : { status: "loading" };
  return { ...query, presence, projects: query.snapshot, invalidation };
}
