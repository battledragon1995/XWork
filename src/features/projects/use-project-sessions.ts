import { useCallback, useEffect } from "react";
import { create } from "zustand";
import type {
  CloseImpactDto,
  SessionRuntimeEventDto,
  SessionSummaryDto,
} from "@/bindings/sessions/sessions";
import {
  closeRuntimeTarget,
  createSession,
  getCloseImpact,
  listSessions,
  onSessionsRuntimeChanged,
  renameSession,
  type UnlistenFn,
} from "@/lib/ipc/sessions";
import {
  classifySessionsFailure,
  type SessionsFailure,
  sessionsErrorOf,
} from "@/lib/utils/session-copy";
import { classifySessionRevision } from "@/lib/utils/session-revision";

/** Copy for the impact read that could not report what a session is running. */
export const INSPECT_SESSION_FAILED_MESSAGE = "XWork couldn't check what this session is running.";

/** Copy for the one project-scoped list failure worth another attempt. */
export const SESSION_LIST_FAILED_MESSAGE = "XWork couldn't load sessions for this project.";

/** The three per-session mutations the overview owns, used as a pending marker. */
export type ProjectSessionOperation = "rename" | "inspect" | "delete";

/** Transient state of the one lifecycle operation the overview allows at a time. */
export interface ProjectSessionsLifecycle {
  pending: ProjectSessionOperation | null;
  impact: CloseImpactDto | null;
  failure: SessionsFailure | null;
}

/** What every mounted consumer of the project's session block reads and can do. */
export interface ProjectSessionsData {
  status: "loading" | "ready" | "error";
  sessions: readonly SessionSummaryDto[];
  failure: SessionsFailure | null;
  isCreating: boolean;
  createFailure: SessionsFailure | null;
  lifecycle: ProjectSessionsLifecycle;
  refresh(): void;
  create(): Promise<void>;
  /** Resolves `true` when the rename dialog should close, whether it succeeded or is moot. */
  rename(sessionId: string, name: string): Promise<boolean>;
  /** Resolves `true` when the delete dialog may open, with facts or with a retryable failure. */
  inspect(sessionId: string): Promise<boolean>;
  /** Resolves `true` when the delete dialog should close, whether it deleted or was moot. */
  confirmDelete(sessionId: string): Promise<boolean>;
  resetLifecycle(): void;
  dismissCreateFailure(): void;
}

/** What the route hands the hook. Only the route knows where a create result should lead. */
export interface UseProjectSessionsOptions {
  projectId: string;
  /** Called with the new session id after exactly one successful create. */
  onCreated?(sessionId: string): void;
  /** Called when the backend reports the project itself is gone. */
  onProjectGone?(): void;
  /** Called when the project root became unusable, so its metadata is read again. */
  onProjectUnavailable?(): void;
}

/** Empty lifecycle state, used for both the initial value and every reset. */
const IDLE_LIFECYCLE: ProjectSessionsLifecycle = { pending: null, impact: null, failure: null };

/**
 * The block's state lives in one module-level store rather than in each component, because
 * the header's `New Session` and the empty state's `New Session` are two mounted entry points
 * that must share exactly one create lock, one query and one event listener — the same reason
 * the Add Project flow lives in `projects-store`.
 */
interface ProjectSessionsState {
  projectId: string | null;
  status: "loading" | "ready" | "error";
  sessions: readonly SessionSummaryDto[];
  appliedRevision: string | null;
  failure: SessionsFailure | null;
  isCreating: boolean;
  createFailure: SessionsFailure | null;
  lifecycle: ProjectSessionsLifecycle;
  consumerCount: number;
}

const useStore = create<ProjectSessionsState>(() => ({
  projectId: null,
  status: "loading",
  sessions: [],
  appliedRevision: null,
  failure: null,
  isCreating: false,
  createFailure: null,
  lifecycle: IDLE_LIFECYCLE,
  consumerCount: 0,
}));

/** Newest read token. A read publishes only while its token still matches. */
let requestToken = 0;

/**
 * Generation of the current consumer session. Every asynchronous operation records it and
 * publishes only while it still matches, so a call that answers after the block unmounted can
 * never write into a released store.
 */
let sessionGeneration = 0;

/** Generation of the current subscription, compared so a late registration disposes itself. */
let subscriptionGeneration = 0;

/** Generation currently subscribed, or `0` when nothing is. */
let activeSubscription = 0;

/** Unlisten callbacks of the active subscription. */
let activeUnlistens: UnlistenFn[] = [];

/** Window `focus` handler of the active subscription, kept so it can be removed by identity. */
let activeFocusHandler: (() => void) | null = null;

/**
 * How many committed events have been applied. A read records this counter and discards its
 * own result if the counter moved, because an event describes a later state than the snapshot
 * the backend had already assembled.
 */
let appliedEventCount = 0;

/** Replace or append one summary while keeping the backend order of everything else. */
function upsertSession(
  sessions: readonly SessionSummaryDto[],
  summary: SessionSummaryDto,
): readonly SessionSummaryDto[] {
  const index = sessions.findIndex((candidate) => candidate.id === summary.id);

  return index === -1
    ? [...sessions, summary]
    : [...sessions.slice(0, index), summary, ...sessions.slice(index + 1)];
}

/** Read the project-scoped list once, dropping a result that lost its race. */
function runRefresh(): void {
  const projectId = useStore.getState().projectId;
  if (projectId === null) {
    return;
  }

  requestToken += 1;
  const token = requestToken;
  const generation = sessionGeneration;
  const eventCountAtStart = appliedEventCount;
  useStore.setState((current) => ({
    status: current.status === "ready" ? "ready" : "loading",
    failure: null,
  }));

  listSessions(projectId)
    .then((sessions) => {
      if (token !== requestToken || generation !== sessionGeneration) {
        return;
      }

      if (appliedEventCount !== eventCountAtStart) {
        // A committed event landed while this read was in flight, so the event is the newer
        // truth. The read is finished either way, so only the phase is published.
        useStore.setState({ status: "ready", failure: null });
        return;
      }

      useStore.setState({
        status: "ready",
        sessions,
        // A snapshot carries no revision, so gap detection restarts from the next event.
        appliedRevision: null,
        failure: null,
      });
    })
    .catch((rejection: unknown) => {
      if (token !== requestToken || generation !== sessionGeneration) {
        return;
      }

      const failure = classifySessionsFailure(rejection);
      const hasSnapshot = useStore.getState().status === "ready";
      useStore.setState({
        status: hasSnapshot ? "ready" : "error",
        failure: failure.canRetry ? { ...failure, message: SESSION_LIST_FAILED_MESSAGE } : failure,
      });
    });
}

/** Apply one committed event, or re-read when it proves an event was missed. */
function applyEvent(event: SessionRuntimeEventDto): void {
  const state = useStore.getState();
  const applied = state.appliedRevision;

  if (applied !== null) {
    const relation = classifySessionRevision(applied, event.revision);

    if (relation === "stale") {
      return;
    }

    if (relation === "gap") {
      runRefresh();
      return;
    }
  }

  appliedEventCount += 1;

  // The revision is process-global, so it advances for every project. Only the summaries of
  // this project are applied; tracking the revision globally is what keeps the sequence
  // contiguous and stops a change in another project from looking like a dropped event.
  if (event.projectId !== state.projectId) {
    useStore.setState({ appliedRevision: event.revision });
    return;
  }

  if (event.change === "deleted") {
    useStore.setState((current) => ({
      appliedRevision: event.revision,
      sessions: current.sessions.filter((session) => session.id !== event.sessionId),
    }));
    return;
  }

  const summary = event.summary;
  if (summary === null) {
    useStore.setState({ appliedRevision: event.revision });
    return;
  }

  useStore.setState((current) => ({
    appliedRevision: event.revision,
    sessions: upsertSession(current.sessions, summary),
  }));
}

/** Register the one runtime listener and the one window-focus listener the block needs. */
function subscribe(): void {
  subscriptionGeneration += 1;
  const generation = subscriptionGeneration;
  activeSubscription = generation;

  // Returning to the foreground is the only signal for a change committed while the window
  // was hidden, because BE-001 emits no "main window shown" event.
  const handleFocus = (): void => {
    runRefresh();
  };
  activeFocusHandler = handleFocus;
  window.addEventListener("focus", handleFocus);

  void onSessionsRuntimeChanged(applyEvent)
    .then((unlisten) => {
      if (activeSubscription !== generation) {
        // Registration lost the race with the final release, so remove it right away.
        unlisten();
        return;
      }

      activeUnlistens.push(unlisten);
    })
    .catch(() => {
      // Without live updates the list is still correct: the focus refresh and every mutation
      // keep it current, so there is no technical failure to show the user.
    });
}

/** Remove both listeners and invalidate every operation still in flight. */
function unsubscribe(): void {
  activeSubscription = 0;
  sessionGeneration += 1;
  requestToken += 1;

  if (activeFocusHandler !== null) {
    window.removeEventListener("focus", activeFocusHandler);
    activeFocusHandler = null;
  }

  for (const unlisten of activeUnlistens) {
    unlisten();
  }
  activeUnlistens = [];
}

/** Claim the single lifecycle slot, or report that another mutation already owns it. */
function beginLifecycle(operation: ProjectSessionOperation): boolean {
  if (useStore.getState().lifecycle.pending !== null) {
    return false;
  }

  useStore.setState((current) => ({
    lifecycle: { pending: operation, impact: current.lifecycle.impact, failure: null },
  }));
  return true;
}

/**
 * Read this project's runtime sessions and own every session mutation the overview offers.
 *
 * The hook is an independent reader of BE-005: it queries `list_sessions(projectId)` and
 * listens to `sessions://runtime-changed` itself rather than sharing state with the sessions
 * feature, so the two surfaces converge on the same backend snapshot without an import
 * between them.
 */
export function useProjectSessions(options: UseProjectSessionsOptions): ProjectSessionsData {
  const { projectId, onCreated, onProjectGone, onProjectUnavailable } = options;

  const status = useStore((state) => state.status);
  const sessions = useStore((state) => state.sessions);
  const failure = useStore((state) => state.failure);
  const isCreating = useStore((state) => state.isCreating);
  const createFailure = useStore((state) => state.createFailure);
  const lifecycle = useStore((state) => state.lifecycle);

  useEffect(() => {
    const consumerCount = useStore.getState().consumerCount + 1;
    const isFirst = consumerCount === 1;
    const isNewProject = useStore.getState().projectId !== projectId;

    useStore.setState({ consumerCount });

    if (isFirst || isNewProject) {
      useStore.setState({
        projectId,
        status: "loading",
        sessions: isNewProject ? [] : useStore.getState().sessions,
        appliedRevision: null,
        failure: null,
        createFailure: null,
        lifecycle: IDLE_LIFECYCLE,
      });
    }

    if (isFirst) {
      subscribe();
    }

    if (isFirst || isNewProject) {
      runRefresh();
    }

    return () => {
      const remaining = Math.max(0, useStore.getState().consumerCount - 1);
      useStore.setState({ consumerCount: remaining });

      if (remaining === 0) {
        unsubscribe();
        useStore.setState({
          projectId: null,
          status: "loading",
          sessions: [],
          appliedRevision: null,
          failure: null,
          isCreating: false,
          createFailure: null,
          lifecycle: IDLE_LIFECYCLE,
        });
      }
    };
  }, [projectId]);

  const refresh = useCallback(() => {
    runRefresh();
  }, []);

  /** Start exactly one session, whichever entry point asked for it. */
  const createOne = useCallback(async () => {
    if (useStore.getState().isCreating) {
      // The single guard against a double activation creating two sessions.
      return;
    }

    const generation = sessionGeneration;
    useStore.setState({ isCreating: true, createFailure: null });

    try {
      const detail = await createSession(projectId);
      if (generation !== sessionGeneration) {
        return;
      }

      onCreated?.(detail.summary.id);
    } catch (rejection: unknown) {
      if (generation !== sessionGeneration) {
        return;
      }

      const classified = classifySessionsFailure(rejection);

      if (classified.code === "projectNotFound") {
        // Nothing on this page is meaningful any more, so the route leaves instead of
        // explaining a project that no longer exists.
        onProjectGone?.();
        return;
      }

      if (classified.code === "projectUnavailable") {
        // The banner is built from project metadata, so the route reads it again and that
        // banner is what states the reason. Repeating the same sentence as a create failure
        // would show the user the identical line twice.
        onProjectUnavailable?.();
        return;
      }

      useStore.setState({ createFailure: classified });
    } finally {
      if (generation === sessionGeneration) {
        useStore.setState({ isCreating: false });
      }
    }
  }, [projectId, onCreated, onProjectGone, onProjectUnavailable]);

  const rename = useCallback(async (sessionId: string, name: string) => {
    if (!beginLifecycle("rename")) {
      return false;
    }

    const generation = sessionGeneration;

    try {
      await renameSession(sessionId, name);
      if (generation !== sessionGeneration) {
        return false;
      }

      useStore.setState({ lifecycle: IDLE_LIFECYCLE });
      return true;
    } catch (rejection: unknown) {
      if (generation !== sessionGeneration) {
        return false;
      }

      const classified = classifySessionsFailure(rejection);

      if (classified.code === "sessionNotFound" || classified.code === "runtimeShuttingDown") {
        // There is nothing left to rename, so the dialog closes without an error of its own.
        useStore.setState({ lifecycle: IDLE_LIFECYCLE });
        runRefresh();
        return true;
      }

      useStore.setState((current) => ({
        lifecycle: { ...current.lifecycle, pending: null, failure: classified },
      }));
      return false;
    }
  }, []);

  const inspect = useCallback(async (sessionId: string) => {
    if (!beginLifecycle("inspect")) {
      return false;
    }

    const generation = sessionGeneration;

    try {
      const impact = await getCloseImpact({ kind: "session", sessionId });
      if (generation !== sessionGeneration) {
        return false;
      }

      useStore.setState({ lifecycle: { pending: null, impact, failure: null } });
      return true;
    } catch (rejection: unknown) {
      if (generation !== sessionGeneration) {
        return false;
      }

      const classified = classifySessionsFailure(rejection);

      if (classified.code === "contentLifecycleFailed") {
        // The confirmation still opens: the user has to be able to read why the facts are
        // missing and ask for them again.
        useStore.setState({
          lifecycle: {
            pending: null,
            impact: null,
            failure: { ...classified, message: INSPECT_SESSION_FAILED_MESSAGE },
          },
        });
        return true;
      }

      useStore.setState({ lifecycle: { pending: null, impact: null, failure: classified } });

      if (classified.code === "sessionNotFound") {
        runRefresh();
      }

      return false;
    }
  }, []);

  const confirmDelete = useCallback(async (sessionId: string) => {
    if (!beginLifecycle("delete")) {
      return false;
    }

    const generation = sessionGeneration;

    try {
      await closeRuntimeTarget({ kind: "session", sessionId }, true);
      if (generation !== sessionGeneration) {
        return false;
      }

      useStore.setState({ lifecycle: IDLE_LIFECYCLE });
      return true;
    } catch (rejection: unknown) {
      if (generation !== sessionGeneration) {
        return false;
      }

      const payload = sessionsErrorOf(rejection);
      const classified = classifySessionsFailure(rejection);

      if (payload?.code === "confirmationRequired") {
        // A blocker appeared since the facts were read, so the refreshed impact is shown and
        // the user has to agree to the new consequences explicitly.
        useStore.setState({
          lifecycle: { pending: null, impact: payload.impact, failure: classified },
        });
        return false;
      }

      if (classified.code === "sessionNotFound" || classified.code === "runtimeShuttingDown") {
        // Already gone, or going: either way the confirmation has nothing left to ask.
        useStore.setState({ lifecycle: IDLE_LIFECYCLE });
        runRefresh();
        return true;
      }

      useStore.setState((current) => ({
        lifecycle: { ...current.lifecycle, pending: null, failure: classified },
      }));
      return false;
    }
  }, []);

  const resetLifecycle = useCallback(() => {
    useStore.setState({ lifecycle: IDLE_LIFECYCLE });
  }, []);

  const dismissCreateFailure = useCallback(() => {
    useStore.setState({ createFailure: null });
  }, []);

  return {
    status,
    sessions,
    failure,
    isCreating,
    createFailure,
    lifecycle,
    refresh,
    create: createOne,
    rename,
    inspect,
    confirmDelete,
    resetLifecycle,
    dismissCreateFailure,
  };
}

/** Restore every default and drop the listeners so tests cannot inherit state. */
export function resetProjectSessions(): void {
  unsubscribe();
  appliedEventCount = 0;
  useStore.setState({
    projectId: null,
    status: "loading",
    sessions: [],
    appliedRevision: null,
    failure: null,
    isCreating: false,
    createFailure: null,
    lifecycle: IDLE_LIFECYCLE,
    consumerCount: 0,
  });
}
