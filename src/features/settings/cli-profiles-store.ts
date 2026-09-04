import { create } from "zustand";
import type { CliProfileInputDto, CliProfilesSnapshotDto } from "@/bindings/terminal/cli-profiles";
import {
  checkCliProfile,
  createCliProfile,
  deleteCliProfile,
  getCliProfiles,
  onCliProfilesChanged,
  setDefaultCliShell,
  type UnlistenFn,
  updateCliProfile,
} from "@/lib/ipc/cli-profiles";
import {
  classifyCliProfilesFailure,
  type CliProfilesFailure,
  type CliProfilesMutationKind,
  compareCliProfileRevisions,
} from "./cli-profile-error-copy";

export type { CliProfilesFailure, CliProfilesMutationKind };

/** Lifecycle of the retained backend snapshot. */
export type CliProfilesStatus = "idle" | "loading" | "ready" | "error";

/** The one persistent write currently crossing the command boundary. */
export interface CliProfilesMutation {
  kind: CliProfilesMutationKind;
  profileId: string | null;
}

/** State shared by the Terminal & CLI Profiles page and every modal it opens. */
export interface CliProfilesState {
  status: CliProfilesStatus;
  snapshot: CliProfilesSnapshotDto | null;
  failure: CliProfilesFailure | null;
  listenerFailed: boolean;
  consumerCount: number;
  mutation: CliProfilesMutation | null;
  checkingProfileIds: ReadonlySet<string>;
  acquire(): void;
  release(): void;
  refresh(): void;
  create(input: CliProfileInputDto): Promise<boolean>;
  update(profileId: string, input: CliProfileInputDto): Promise<boolean>;
  remove(profileId: string): Promise<boolean>;
  setDefaultShell(shellId: string): Promise<boolean>;
  check(profileId: string): Promise<boolean>;
  clearFailure(): void;
}

/**
 * Generation of the current consumer session. Every asynchronous operation records the
 * generation it started in and publishes only while it still matches, so a read, a write or
 * a check that answers after the last consumer left can never write into a released store.
 */
let sessionGeneration = 0;

/**
 * Generation of the current subscription. Registering a Tauri listener is asynchronous, so a
 * registration can win its race against the final release; comparing generations is what
 * lets that late callback be disposed instead of surviving as an orphan.
 */
let subscriptionGeneration = 0;

/** Generation currently subscribed, or `0` when nothing is. */
let activeSubscription = 0;

/** Unlisten callbacks of the active subscription. */
let activeUnlistens: UnlistenFn[] = [];

/** True while exactly one snapshot read is crossing the command boundary. */
let refreshRunning = false;

/** True when at least one invalidation arrived during the running read. */
let refreshQueued = false;

/** Register the one invalidation listener the feature needs. */
function subscribe(): void {
  subscriptionGeneration += 1;
  const generation = subscriptionGeneration;
  activeSubscription = generation;

  void onCliProfilesChanged(() => {
    // The payload is an invalidation hint only: read a whole snapshot instead of patching.
    useCliProfilesStore.getState().refresh();
  })
    .then((unlisten) => {
      if (activeSubscription !== generation) {
        // Registration lost the race with the final release, so remove it right away.
        unlisten();
        return;
      }

      activeUnlistens.push(unlisten);
    })
    .catch(() => {
      // Commands still work without live updates, so the page only warns and offers Refresh.
      if (activeSubscription === generation) {
        useCliProfilesStore.setState({ listenerFailed: true });
      }
    });
}

/** Remove the listener and invalidate every operation still in flight. */
function unsubscribe(): void {
  activeSubscription = 0;
  sessionGeneration += 1;
  refreshRunning = false;
  refreshQueued = false;

  for (const unlisten of activeUnlistens) {
    unlisten();
  }
  activeUnlistens = [];
}

/**
 * Replace the retained snapshot when the response is not older than what is already shown.
 * An equal revision is accepted because it describes the same committed state; anything
 * older is dropped so a slow response can never roll the page backwards.
 */
function acceptSnapshot(next: CliProfilesSnapshotDto): void {
  useCliProfilesStore.setState((current) => {
    if (current.snapshot !== null && isOlderRevision(next.revision, current.snapshot.revision)) {
      // The read is finished either way, so the page leaves its refreshing state.
      return { status: "ready" as const };
    }
    return { status: "ready" as const, snapshot: next };
  });
}

/** Report whether one revision string is strictly older than another. */
function isOlderRevision(candidate: string, current: string): boolean {
  return compareCliProfileRevisions(candidate, current) < 0;
}

/** Run one snapshot read, then drain whatever invalidation arrived while it was running. */
function runRefresh(): void {
  const generation = sessionGeneration;
  refreshRunning = true;

  // `loading` with a retained snapshot is what the page renders as `Refreshing…`; without one
  // it is the first read. Keeping one status for both is why no extra flag exists.
  useCliProfilesStore.setState((current) => ({
    status: "loading" as const,
    // A new read replaces only the failure it can actually resolve.
    failure:
      current.failure?.operation === "load" || current.failure?.operation === "refresh"
        ? null
        : current.failure,
  }));

  getCliProfiles()
    .then((snapshot) => {
      if (generation !== sessionGeneration) {
        return;
      }

      acceptSnapshot(snapshot);
      useCliProfilesStore.setState((current) => ({
        failure:
          current.failure?.operation === "load" || current.failure?.operation === "refresh"
            ? null
            : current.failure,
      }));
    })
    .catch((rejection: unknown) => {
      if (generation !== sessionGeneration) {
        return;
      }

      const hasSnapshot = useCliProfilesStore.getState().snapshot !== null;
      useCliProfilesStore.setState({
        status: hasSnapshot ? "ready" : "error",
        failure: classifyCliProfilesFailure(rejection, hasSnapshot ? "refresh" : "load", null),
      });
    })
    .finally(() => {
      if (generation !== sessionGeneration) {
        return;
      }

      refreshRunning = false;
      if (refreshQueued) {
        refreshQueued = false;
        runRefresh();
      }
    });
}

/** Run one durable write behind the single slot the feature allows. */
async function runMutation(
  mutation: CliProfilesMutation,
  call: () => Promise<CliProfilesSnapshotDto>,
): Promise<boolean> {
  const store = useCliProfilesStore;
  if (store.getState().mutation !== null) {
    return false;
  }

  const generation = sessionGeneration;
  store.setState({ mutation, failure: null });

  try {
    const snapshot = await call();
    if (generation !== sessionGeneration) {
      return false;
    }

    acceptSnapshot(snapshot);
    store.setState({ failure: null });
    return true;
  } catch (rejection: unknown) {
    if (generation !== sessionGeneration) {
      return false;
    }

    const failure = classifyCliProfilesFailure(rejection, mutation.kind, mutation.profileId);
    store.setState({ failure });
    if (failure.code === "profileNotFound" || failure.code === "invalidShell") {
      // The catalog the user acted on is stale, so the page needs the committed truth.
      store.getState().refresh();
    }
    return false;
  } finally {
    // Only this operation's own marker is cleared, so a newer failure is never erased.
    if (generation === sessionGeneration) {
      store.setState((current) => (current.mutation === mutation ? { mutation: null } : {}));
    }
  }
}

export const useCliProfilesStore = create<CliProfilesState>((set, get) => ({
  status: "idle",
  snapshot: null,
  failure: null,
  listenerFailed: false,
  consumerCount: 0,
  mutation: null,
  checkingProfileIds: new Set<string>(),

  // Register one mounted consumer. Only the transition from zero subscribes and reads, which
  // is what keeps the page and its modals on one listener and one snapshot.
  acquire() {
    const consumerCount = get().consumerCount + 1;
    set({ consumerCount });

    if (consumerCount === 1) {
      // The listener is registered before the first read settles, so a startup availability
      // check that commits in between is still reflected by that first snapshot.
      subscribe();
      get().refresh();
    }
  },

  // Unregister one mounted consumer. The snapshot carries no plaintext, so it is kept for an
  // instant re-render on the next mount; only transient operation state is dropped.
  release() {
    const consumerCount = Math.max(0, get().consumerCount - 1);
    set({ consumerCount });

    if (consumerCount === 0) {
      unsubscribe();
      set((current) => ({
        status: current.snapshot === null ? "idle" : "ready",
        failure: null,
        listenerFailed: false,
        mutation: null,
        checkingProfileIds: new Set<string>(),
      }));
    }
  },

  // Ask for a fresh snapshot, collapsing an invalidation burst into one queued read.
  refresh() {
    if (refreshRunning) {
      refreshQueued = true;
      return;
    }

    runRefresh();
  },

  // Create one custom profile and adopt the committed snapshot the backend answers with.
  create(input) {
    return runMutation({ kind: "create", profileId: null }, () => createCliProfile(input));
  },

  // Replace one custom profile completely and adopt the committed snapshot.
  update(profileId, input) {
    return runMutation({ kind: "update", profileId }, () => updateCliProfile(profileId, input));
  },

  // Delete one custom profile and adopt the committed snapshot.
  remove(profileId) {
    return runMutation({ kind: "delete", profileId }, () => deleteCliProfile(profileId));
  },

  // Persist the default shell by catalog id and adopt the committed snapshot.
  setDefaultShell(shellId) {
    return runMutation({ kind: "setDefaultShell", profileId: null }, () =>
      setDefaultCliShell(shellId),
    );
  },

  // Re-check one saved profile. A second press on the same row is dropped; other rows queue
  // behind the backend's own limit instead of behind this store.
  async check(profileId) {
    if (get().checkingProfileIds.has(profileId)) {
      return false;
    }

    const generation = sessionGeneration;
    set((current) => ({ checkingProfileIds: new Set(current.checkingProfileIds).add(profileId) }));

    try {
      await checkCliProfile(profileId);
      if (generation !== sessionGeneration) {
        return false;
      }

      // The returned profile carries no revision, so it is never store authority: the only
      // way the new availability reaches the page is a full snapshot read.
      get().refresh();
      return true;
    } catch (rejection: unknown) {
      if (generation !== sessionGeneration) {
        return false;
      }

      const failure = classifyCliProfilesFailure(rejection, "check", profileId);
      set({ failure });
      if (failure.code === "profileNotFound") {
        get().refresh();
      }
      return false;
    } finally {
      if (generation === sessionGeneration) {
        set((current) => {
          const next = new Set(current.checkingProfileIds);
          next.delete(profileId);
          return { checkingProfileIds: next };
        });
      }
    }
  },

  // Dismiss the current failure without touching committed data.
  clearFailure() {
    set({ failure: null });
  },
}));

/** Restore every documented default and drop the listener so tests cannot inherit state. */
export function resetCliProfilesStore(): void {
  unsubscribe();
  useCliProfilesStore.setState({
    status: "idle",
    snapshot: null,
    failure: null,
    listenerFailed: false,
    consumerCount: 0,
    mutation: null,
    checkingProfileIds: new Set<string>(),
  });
}
