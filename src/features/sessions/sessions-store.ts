import { create } from "zustand";
import type { SessionRuntimeEventDto, SessionSummaryDto } from "@/bindings/sessions/sessions";
import { listSessions, onSessionsRuntimeChanged, type UnlistenFn } from "@/lib/ipc/sessions";
import { classifySessionsFailure, type SessionsFailure } from "@/lib/utils/session-copy";
import { classifySessionRevision } from "@/lib/utils/session-revision";

export type { SessionsFailure };

/** Phase of the one grouped snapshot the store owns. */
export type SessionsStatus = "idle" | "loading" | "ready" | "error";

/** Grouped runtime summaries plus the resource lifecycle the sidebar and breadcrumb share. */
export interface SessionsState {
  status: SessionsStatus;
  /** Summaries per project, each group in the exact order the backend returned them. */
  sessionsByProject: Readonly<Record<string, readonly SessionSummaryDto[]>>;
  appliedRevision: string | null;
  failure: SessionsFailure | null;
  consumerCount: number;
  acquire(): void;
  release(): void;
  refresh(): void;
  applyEvent(event: SessionRuntimeEventDto): void;
}

/**
 * Newest query token. Every read records the token it started with and publishes only while
 * it still matches, so a slow answer can never overwrite a newer one.
 */
let requestToken = 0;

/**
 * How many committed events have been applied. A read records this counter when it starts and
 * discards its own result if the counter moved: an event describes a state later than the
 * snapshot the backend had already assembled, so the event has to win.
 */
let appliedEventCount = 0;

/**
 * Generation of the current subscription set. Registering a Tauri listener is asynchronous, so
 * a registration can finish after the last consumer left; comparing generations is what lets
 * that late callback be removed instead of surviving as an orphan.
 */
let subscriptionGeneration = 0;

/** Generation currently subscribed, or `0` when nothing is. */
let activeGeneration = 0;

/** Unlisten callbacks of the active subscription set. */
let activeUnlistens: UnlistenFn[] = [];

/** Window `focus` handler of the active set, kept so it can be removed by identity. */
let activeFocusHandler: (() => void) | null = null;

/** Group summaries by project while preserving the backend order inside each group. */
function groupByProject(
  summaries: readonly SessionSummaryDto[],
): Record<string, readonly SessionSummaryDto[]> {
  const groups: Record<string, SessionSummaryDto[]> = {};

  for (const summary of summaries) {
    const group = groups[summary.projectId];
    if (group === undefined) {
      groups[summary.projectId] = [summary];
    } else {
      group.push(summary);
    }
  }

  return groups;
}

/** Replace or append one summary inside its project group, keeping every other group as is. */
function upsertSummary(
  groups: Readonly<Record<string, readonly SessionSummaryDto[]>>,
  summary: SessionSummaryDto,
): Record<string, readonly SessionSummaryDto[]> {
  const group = groups[summary.projectId] ?? [];
  const index = group.findIndex((candidate) => candidate.id === summary.id);
  const next =
    index === -1
      ? [...group, summary]
      : [...group.slice(0, index), summary, ...group.slice(index + 1)];

  return { ...groups, [summary.projectId]: next };
}

/** Remove one session from its group, dropping a group that has no session left. */
function removeSummary(
  groups: Readonly<Record<string, readonly SessionSummaryDto[]>>,
  projectId: string,
  sessionId: string,
): Record<string, readonly SessionSummaryDto[]> {
  const group = groups[projectId];
  if (group === undefined) {
    return { ...groups };
  }

  const next = group.filter((candidate) => candidate.id !== sessionId);
  const result = { ...groups };

  if (next.length === 0) {
    delete result[projectId];
  } else {
    result[projectId] = next;
  }

  return result;
}

/** Register the one runtime listener and the one window-focus listener the store needs. */
function subscribe(): void {
  subscriptionGeneration += 1;
  const generation = subscriptionGeneration;
  activeGeneration = generation;

  // Coming back to the foreground is the only signal for a change committed while the window
  // was hidden, because BE-001 emits no "main window shown" event.
  const handleFocus = (): void => {
    useSessionsStore.getState().refresh();
  };
  activeFocusHandler = handleFocus;
  window.addEventListener("focus", handleFocus);

  void onSessionsRuntimeChanged((event) => {
    useSessionsStore.getState().applyEvent(event);
  })
    .then((unlisten) => {
      if (activeGeneration !== generation) {
        // Registration lost the race with the final release, so remove it right away.
        unlisten();
        return;
      }

      activeUnlistens.push(unlisten);
    })
    .catch(() => {
      // Without live updates the data is still correct: the focus refresh and every mutation's
      // own returned snapshot keep it current. There is nothing the user could act on.
    });
}

/** Remove both listeners and invalidate every read still in flight. */
function unsubscribe(): void {
  activeGeneration = 0;
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

export const useSessionsStore = create<SessionsState>((set, get) => ({
  status: "idle",
  sessionsByProject: {},
  appliedRevision: null,
  failure: null,
  consumerCount: 0,

  // Register one mounted consumer. Only the transition from zero creates work, which keeps
  // every session row and the breadcrumb on one query and one listener.
  acquire() {
    const consumerCount = get().consumerCount + 1;
    set({ consumerCount });

    if (consumerCount === 1) {
      subscribe();
      get().refresh();
    }
  },

  // Unregister one mounted consumer. The grouped snapshot is kept so the next mount renders
  // the previous rows instead of flashing an empty sidebar.
  release() {
    const consumerCount = Math.max(0, get().consumerCount - 1);
    set({ consumerCount });

    if (consumerCount === 0) {
      unsubscribe();
      set({ failure: null });
    }
  },

  // Start one unfiltered read. The visible groups stay until it answers.
  refresh() {
    requestToken += 1;
    const token = requestToken;
    const eventCountAtStart = appliedEventCount;
    set((current) => ({ status: current.status === "ready" ? "ready" : "loading", failure: null }));

    listSessions()
      .then((summaries) => {
        if (token !== requestToken) {
          return;
        }

        if (appliedEventCount !== eventCountAtStart) {
          // A committed event landed while this read was in flight, so the event is the newer
          // truth. The read is finished either way, so only the phase is published.
          set({ status: "ready", failure: null });
          return;
        }

        set({
          status: "ready",
          sessionsByProject: groupByProject(summaries),
          // A snapshot carries no revision, so gap detection restarts from the next event.
          appliedRevision: null,
          failure: null,
        });
      })
      .catch((rejection: unknown) => {
        if (token !== requestToken) {
          return;
        }

        const hasSnapshot = get().status === "ready";
        set({
          status: hasSnapshot ? "ready" : "error",
          failure: classifySessionsFailure(rejection),
        });
      });
  },

  // Apply one committed runtime event, or reload when it proves an event was missed.
  applyEvent(event) {
    const applied = get().appliedRevision;

    if (applied !== null) {
      const relation = classifySessionRevision(applied, event.revision);

      if (relation === "stale") {
        // A duplicate or reordered delivery would otherwise resurrect a removed row.
        return;
      }

      if (relation === "gap") {
        // Something was dropped, so patching would leave an inconsistent list. BE-005 tells
        // readers to re-read instead, which also resets the revision baseline.
        get().refresh();
        return;
      }
    }

    appliedEventCount += 1;

    if (event.change === "deleted") {
      set((current) => ({
        appliedRevision: event.revision,
        sessionsByProject: removeSummary(
          current.sessionsByProject,
          event.projectId,
          event.sessionId,
        ),
      }));
      return;
    }

    if (event.summary === null) {
      // Nothing to write, but the revision still advanced, so the baseline has to follow it.
      set({ appliedRevision: event.revision });
      return;
    }

    const summary = event.summary;
    set((current) => ({
      appliedRevision: event.revision,
      sessionsByProject: upsertSummary(current.sessionsByProject, summary),
    }));
  },
}));

/** Find one summary in the retained grouped snapshot. */
function findSummary(sessionId: string | undefined): SessionSummaryDto | null {
  if (sessionId === undefined) {
    return null;
  }

  for (const group of Object.values(useSessionsStore.getState().sessionsByProject)) {
    const found = group.find((summary) => summary.id === sessionId);
    if (found !== undefined) {
      return found;
    }
  }

  return null;
}

/** Read one session's project and name for the route breadcrumb, without subscribing. */
export function readSessionCrumb(
  sessionId: string | undefined,
): { projectId: string; name: string } | null {
  const summary = findSummary(sessionId);

  return summary === null ? null : { projectId: summary.projectId, name: summary.name };
}

/** Read which project owns one session, used to pick the active sidebar project row. */
export function readSessionProjectId(sessionId: string | undefined): string | null {
  return findSummary(sessionId)?.projectId ?? null;
}

/** Restore the documented defaults and drop every listener so tests cannot inherit state. */
export function resetSessionsStore(): void {
  unsubscribe();
  appliedEventCount = 0;
  useSessionsStore.setState({
    status: "idle",
    sessionsByProject: {},
    appliedRevision: null,
    failure: null,
    consumerCount: 0,
  });
}
