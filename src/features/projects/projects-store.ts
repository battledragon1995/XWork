import { create } from "zustand";
import type { ProjectDto } from "@/bindings/projects/projects";
import { listProjects, onProjectsChanged, type UnlistenFn } from "@/lib/ipc/projects";
import {
  type AddProjectFailure,
  classifyListFailure,
  type ProjectListFailure,
} from "./project-error-copy";

/** Phase of the one unfiltered query the store owns. */
export type ProjectListStatus = "idle" | "loading" | "ready" | "failed";

export type { AddProjectFailure, ProjectListFailure };

/** Shared feature state: the unfiltered snapshot plus the Add Project flow both entries use. */
export interface ProjectsState {
  status: ProjectListStatus;
  projects: ProjectDto[];
  failure: ProjectListFailure | null;
  isAdding: boolean;
  addFailure: AddProjectFailure | null;
  consumerCount: number;
  acquire(): void;
  release(): void;
  refresh(): void;
  beginAdd(): boolean;
  endAdd(failure: AddProjectFailure | null): void;
}

/** Read one project name from the retained store snapshot for the route breadcrumb. */
export function readProjectCrumbLabel(projectId: string | undefined): string {
  if (projectId === undefined) {
    return "";
  }

  return (
    useProjectsStore.getState().projects.find((project) => project.id === projectId)?.displayName ??
    ""
  );
}

/**
 * Newest query token. Every query records the token it started with and publishes only while
 * it still matches, so a slow answer can never overwrite a newer one and releasing every
 * consumer invalidates whatever is still in flight.
 */
let requestToken = 0;

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

/** Window `focus` handler of the active subscription set, kept so it can be removed by identity. */
let activeFocusHandler: (() => void) | null = null;

// Ask the store for a fresh unfiltered snapshot. Used by both invalidation signals.
function requestRefresh(): void {
  useProjectsStore.getState().refresh();
}

// Register the one project-event listener and the one window-focus listener the feature needs.
function subscribe(): void {
  subscriptionGeneration += 1;
  const generation = subscriptionGeneration;
  activeGeneration = generation;

  // Coming back to the foreground is the only signal available for availability changes made
  // outside XWork, because BE-001 emits no "main window shown" event.
  const handleFocus = (): void => {
    requestRefresh();
  };
  activeFocusHandler = handleFocus;
  window.addEventListener("focus", handleFocus);

  void onProjectsChanged(() => {
    // The payload is an invalidation key only: re-query instead of patching the snapshot.
    requestRefresh();
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
      // A refused registration leaves the focus listener as the only invalidation source.
      // There is nothing to show the user and nothing to retry, so it is deliberately dropped.
    });
}

// Remove both listeners and invalidate every query still in flight.
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

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  status: "idle",
  projects: [],
  failure: null,
  isAdding: false,
  addFailure: null,
  consumerCount: 0,

  // Register one mounted consumer. Only the transition from zero creates work, which is what
  // keeps the page and the sidebar on one query, one event listener and one focus listener.
  acquire() {
    const consumerCount = get().consumerCount + 1;
    set({ consumerCount });

    if (consumerCount === 1) {
      subscribe();
      get().refresh();
    }
  },

  // Unregister one mounted consumer. The loaded list is deliberately kept so the next mount
  // renders the previous snapshot instead of flashing an empty state.
  release() {
    const consumerCount = Math.max(0, get().consumerCount - 1);
    set({ consumerCount });

    if (consumerCount === 0) {
      unsubscribe();
    }
  },

  // Start one unfiltered query. The visible list stays until this query answers.
  refresh() {
    requestToken += 1;
    const token = requestToken;
    set({ status: "loading", failure: null });

    listProjects()
      .then((projects) => {
        if (token !== requestToken) {
          return;
        }

        set({ status: "ready", projects, failure: null });
      })
      .catch((rejection: unknown) => {
        if (token !== requestToken) {
          return;
        }

        set({ status: "failed", failure: classifyListFailure(rejection) });
      });
  },

  // Claim the shared Add Project flow. Returning `false` is the single guard against a second
  // native folder picker, because the page button and the sidebar action can both be pressed.
  beginAdd() {
    if (get().isAdding) {
      return false;
    }

    set({ isAdding: true, addFailure: null });
    return true;
  },

  // Release the shared flow and publish its outcome.
  endAdd(failure) {
    set({ isAdding: false, addFailure: failure });
  },
}));

// Restore the documented defaults and drop every active listener. Tests call this so no case
// observes another case's state or subscriptions.
export function resetProjectsStore(): void {
  unsubscribe();
  useProjectsStore.setState({
    status: "idle",
    projects: [],
    failure: null,
    isAdding: false,
    addFailure: null,
    consumerCount: 0,
  });
}
