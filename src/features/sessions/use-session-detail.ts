import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDto } from "@/bindings/projects/projects";
import type { SessionDetailDto, SessionRuntimeEventDto } from "@/bindings/sessions/sessions";
import { getProject, onProjectsChanged } from "@/lib/ipc/projects";
import {
  getSession,
  onSessionsRuntimeChanged,
  setObservedSession,
  type UnlistenFn,
} from "@/lib/ipc/sessions";
import { classifySessionsFailure, type SessionsFailure } from "@/lib/utils/session-copy";
import { classifySessionRevision } from "@/lib/utils/session-revision";

/** What the session route reads about the one session it is showing. */
export interface SessionDetailData {
  status: "loading" | "ready" | "missing" | "error";
  detail: SessionDetailDto | null;
  project: ProjectDto | null;
  failure: SessionsFailure | null;
  refresh(): void;
  /** Adopt the post-commit snapshot a mutation answered with, without a second read. */
  applyDetail(detail: SessionDetailDto): void;
}

/** Everything the route publishes, kept as one value so it always updates atomically. */
interface DetailState {
  status: SessionDetailData["status"];
  detail: SessionDetailDto | null;
  project: ProjectDto | null;
  failure: SessionsFailure | null;
}

const INITIAL_STATE: DetailState = {
  status: "loading",
  detail: null,
  project: null,
  failure: null,
};

/**
 * Load, observe and keep current the one session `/sessions/:sessionId` is showing.
 *
 * The hook is the route's only reader: it holds the snapshot for the current session id
 * alone, invalidates every answer that arrives after that id changed, and tells BE-005 which
 * session the user is looking at for exactly as long as the route shows it.
 */
export function useSessionDetail(sessionId: string): SessionDetailData {
  const [state, setState] = useState<DetailState>(INITIAL_STATE);

  /** Newest session read. A read publishes only while its token still matches. */
  const sessionToken = useRef(0);
  /** Newest project read, tracked separately so the two reads cannot cancel each other. */
  const projectToken = useRef(0);
  /**
   * Revision this route has applied. `get_session` answers with one, so the route starts from
   * a real baseline and can detect a dropped event from its very first delivery.
   */
  const appliedRevision = useRef<string | null>(null);

  /** Read the project, which the route needs only for its root path and breadcrumb label. */
  const loadProject = useCallback((projectId: string) => {
    projectToken.current += 1;
    const token = projectToken.current;

    getProject(projectId)
      .then((project) => {
        if (token !== projectToken.current) {
          return;
        }

        setState((current) => ({ ...current, project }));
      })
      .catch((rejection: unknown) => {
        if (token !== projectToken.current) {
          return;
        }

        const failure = classifySessionsFailure(rejection);
        if (failure.code === "projectNotFound") {
          // BE-003 closes every session of a removed project, so this session is going away
          // too. With no project left to return to, the route leaves for the project list.
          setState((current) => ({ ...current, status: "missing", project: null, failure: null }));
          return;
        }

        // Showing a path that may already be wrong is worse than showing none, so the
        // `Starts in …` line disappears until a later read succeeds.
        setState((current) => ({ ...current, project: null }));
      });
  }, []);

  /** Read the whole session snapshot for the current route parameter. */
  const load = useCallback((id: string) => {
    sessionToken.current += 1;
    const token = sessionToken.current;
    setState((current) => ({
      // A retained snapshot keeps rendering while a refresh runs; only a first read shows the
      // skeleton, so a focus refresh never blanks the route the user is reading.
      status: current.detail === null ? "loading" : current.status,
      detail: current.detail,
      project: current.project,
      failure: null,
    }));

    getSession(id)
      .then((detail) => {
        if (token !== sessionToken.current) {
          return;
        }

        appliedRevision.current = detail.revision;
        setState((current) => ({
          status: "ready",
          detail,
          project: current.project?.id === detail.summary.projectId ? current.project : null,
          failure: null,
        }));
      })
      .catch((rejection: unknown) => {
        if (token !== sessionToken.current) {
          return;
        }

        const failure = classifySessionsFailure(rejection);

        if (failure.code === "sessionNotFound") {
          // A session that is gone is not an error the user has to read: the route leaves.
          setState((current) => ({ ...current, status: "missing", failure: null }));
          return;
        }

        setState((current) => ({ ...current, status: "error", failure }));
      });
  }, []);

  const refresh = useCallback(() => {
    load(sessionId);
  }, [load, sessionId]);

  const applyDetail = useCallback(
    (detail: SessionDetailDto) => {
      if (detail.summary.id !== sessionId) {
        // A snapshot for another session would silently replace the route's own.
        return;
      }

      appliedRevision.current = detail.revision;
      setState((current) => ({
        status: "ready",
        detail,
        project: current.project?.id === detail.summary.projectId ? current.project : null,
        failure: null,
      }));
    },
    [sessionId],
  );

  /**
   * Project the current snapshot names, and the project already loaded. Comparing the two in
   * an effect is what keeps the metadata read out of every state update that produced a
   * snapshot, so no code path can forget to trigger it.
   */
  const detailProjectId = state.detail?.summary.projectId ?? null;
  const loadedProjectId = state.project?.id ?? null;

  useEffect(() => {
    if (detailProjectId !== null && detailProjectId !== loadedProjectId) {
      loadProject(detailProjectId);
    }
  }, [detailProjectId, loadedProjectId, loadProject]);

  // The listeners are registered once per session id and reach the current values through
  // these refs, so a re-render never re-registers a subscription.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const projectIdRef = useRef(detailProjectId);
  projectIdRef.current = detailProjectId;
  const loadProjectRef = useRef(loadProject);
  loadProjectRef.current = loadProject;

  /** Apply one committed runtime event to the route's own snapshot. */
  const handleRuntimeEvent = useCallback(
    (event: SessionRuntimeEventDto) => {
      const applied = appliedRevision.current;

      if (applied !== null) {
        const relation = classifySessionRevision(applied, event.revision);

        if (relation === "stale") {
          return;
        }

        if (relation === "gap") {
          refreshRef.current();
          return;
        }
      }

      // The revision is process-global, so it advances for a change in any session; otherwise
      // the next event about this session would look like a dropped one.
      appliedRevision.current = event.revision;

      if (event.sessionId !== sessionId) {
        return;
      }

      if (event.change === "deleted") {
        setState((current) => ({ ...current, status: "missing", failure: null }));
        return;
      }

      const summary = event.summary;
      if (summary === null) {
        return;
      }

      setState((current) =>
        current.detail === null
          ? current
          : { ...current, status: "ready", detail: { ...current.detail, summary } },
      );
    },
    [sessionId],
  );

  const handleRuntimeEventRef = useRef(handleRuntimeEvent);
  handleRuntimeEventRef.current = handleRuntimeEvent;

  // Read the session and register every invalidation source exactly once for as long as this
  // route shows this session id.
  useEffect(() => {
    let isCurrent = true;
    const unlistens: UnlistenFn[] = [];
    load(sessionId);

    const handleFocus = (): void => {
      refreshRef.current();
      const projectId = projectIdRef.current;
      if (projectId !== null) {
        loadProjectRef.current(projectId);
      }
    };
    window.addEventListener("focus", handleFocus);

    /** Keep one registration, disposing it immediately if the route already moved on. */
    const keep = (unlisten: UnlistenFn): void => {
      if (!isCurrent) {
        unlisten();
        return;
      }
      unlistens.push(unlisten);
    };

    void onSessionsRuntimeChanged((event) => {
      handleRuntimeEventRef.current(event);
    })
      .then(keep)
      .catch(() => {
        // Without live updates the snapshot is still correct: the focus refresh and every
        // mutation's returned detail keep it current, so nothing is shown to the user.
      });

    void onProjectsChanged(() => {
      // The route needs no more than the root path and the label, so a project change only
      // re-reads the project; the session snapshot is unaffected by it.
      const projectId = projectIdRef.current;
      if (projectId !== null) {
        loadProjectRef.current(projectId);
      }
    })
      .then(keep)
      .catch(() => {
        // The `Starts in …` line simply stops following an out-of-band project rename.
      });

    return () => {
      isCurrent = false;
      sessionToken.current += 1;
      projectToken.current += 1;
      window.removeEventListener("focus", handleFocus);
      for (const unlisten of unlistens) {
        unlisten();
      }
    };
  }, [sessionId, load]);

  // Observation is scoped to this exact route instance: React runs the cleanup of the
  // previous session id before the effect of the new one, so the two calls cannot cross.
  useEffect(() => {
    // Best effort by design. Failing to record what the user is looking at must never stop
    // the route from rendering, so every rejection is swallowed on purpose.
    void setObservedSession(sessionId).catch(() => {});

    return () => {
      void setObservedSession(null).catch(() => {});
    };
  }, [sessionId]);

  return {
    status: state.status,
    detail: state.detail,
    project: state.project,
    failure: state.failure,
    refresh,
    applyDetail,
  };
}
