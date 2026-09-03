import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDto, RemoveProjectImpactDto } from "@/bindings/projects/projects";
import {
  getRemoveProjectImpact,
  locateProjectFolder,
  openProjectFolder,
  removeProject,
  renameProject,
  setProjectPinned,
} from "@/lib/ipc/projects";
import {
  classifyActionFailure,
  type ProjectActionFailure,
  type ProjectOperation,
  projectsErrorOf,
} from "./project-error-copy";
import { useProjectsStore } from "./projects-store";

export type { ProjectActionFailure, ProjectOperation };

/** The project a remove confirmation is about, together with the facts it must state. */
export interface RemoveProjectTarget {
  project: ProjectDto;
  impact: RemoveProjectImpactDto;
}

/** What the caller wires into the flow beyond the commands themselves. */
export interface ProjectActionsOptions {
  /** Called after a successful removal, so the caller can move focus off the destroyed card. */
  onRemoved?(): void;
}

/** Everything the route needs to run the six per-project commands and host both dialogs. */
export interface ProjectActions {
  pendingProjectId: string | null;
  pendingOperation: ProjectOperation | null;
  failure: ProjectActionFailure | null;
  renameTarget: ProjectDto | null;
  removeTarget: RemoveProjectTarget | null;
  openRename(project: ProjectDto): void;
  closeRename(): void;
  rename(projectId: string, displayName: string): Promise<void>;
  togglePinned(project: ProjectDto): Promise<void>;
  openFolder(project: ProjectDto): Promise<void>;
  locateFolder(project: ProjectDto): Promise<void>;
  requestRemove(project: ProjectDto): Promise<void>;
  closeRemove(): void;
  confirmRemove(projectId: string): Promise<void>;
  retryFailure(): Promise<void>;
  dismissFailure(): void;
}

/** One in-flight operation and the project it belongs to. */
interface PendingOperation {
  projectId: string;
  operation: ProjectOperation;
}

/**
 * Coordinate rename, pin, open-folder, locate-folder, impact inspection and confirmed removal
 * for the project grid. The hook owns no project data: the backend stays the source of truth,
 * so every success asks the shared store for a fresh list rather than patching the one on
 * screen. That explicit refresh is also the protection against a mutation that committed but
 * whose `projects://changed` emission failed.
 */
export function useProjectActions(options: ProjectActionsOptions = {}): ProjectActions {
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [failure, setFailure] = useState<ProjectActionFailure | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectDto | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveProjectTarget | null>(null);
  const { onRemoved } = options;

  /**
   * Every operation records the token it started with and publishes only while it still
   * matches. Unmount bumps the token, so a command that answers after the route is gone
   * updates no state and triggers no refresh.
   */
  const requestToken = useRef(0);

  /** The project of the last failure, so a retry control knows what to repeat. */
  const lastTarget = useRef<ProjectDto | null>(null);

  /** Live copy of `pending`, because two clicks in the same tick both read stale state. */
  const pendingRef = useRef<PendingOperation | null>(null);

  /**
   * Live copies of the two dialog targets. A dialog can open and submit before React has
   * re-rendered the hook's caller, so the command path reads the ref rather than the state it
   * was rendered with, which would still be `null`.
   */
  const renameTargetRef = useRef<ProjectDto | null>(null);
  const removeTargetRef = useRef<RemoveProjectTarget | null>(null);

  /** Name the user last submitted, so a retry repeats that instead of the old name. */
  const lastRenameInput = useRef("");

  useEffect(() => {
    return () => {
      requestToken.current += 1;
    };
  }, []);

  // Claim the single operation slot. A second call while one runs is dropped, so a fast
  // double activation cannot send two writes whose commit order nobody controls.
  const begin = useCallback((project: ProjectDto, operation: ProjectOperation): number | null => {
    if (pendingRef.current !== null) {
      return null;
    }

    requestToken.current += 1;
    const token = requestToken.current;
    const next = { projectId: project.id, operation };
    pendingRef.current = next;
    lastTarget.current = project;
    setPending(next);
    setFailure(null);

    return token;
  }, []);

  // Release the operation slot, unless a newer operation or an unmount already invalidated it.
  const settle = useCallback((token: number): boolean => {
    if (token !== requestToken.current) {
      return false;
    }

    pendingRef.current = null;
    setPending(null);

    return true;
  }, []);

  // Ask the shared store for a fresh unfiltered snapshot after a committed change.
  const refreshList = useCallback(() => {
    useProjectsStore.getState().refresh();
  }, []);

  // Publish one failure and close whichever surface the failure makes meaningless.
  const publishFailure = useCallback(
    (rejection: unknown, project: ProjectDto, operation: ProjectOperation) => {
      const classified = classifyActionFailure(rejection, {
        name: project.displayName,
        operation,
      });
      setFailure(classified);

      if (classified.kind === "gone") {
        // The row is gone, so an open menu or dialog for it can only mislead. Both close and
        // the message moves to the page error line instead.
        renameTargetRef.current = null;
        removeTargetRef.current = null;
        setRenameTarget(null);
        setRemoveTarget(null);
        refreshList();
        return;
      }

      if (
        classified.kind === "retryable" &&
        classified.retry === "locate" &&
        operation === "openFolder"
      ) {
        // The path became unusable while the list still says otherwise; refresh so the card
        // flips to `Unavailable` next to the offered relocation.
        refreshList();
      }
    },
    [refreshList],
  );

  // Open the rename dialog on a snapshot of the project the menu was on.
  const openRename = useCallback((project: ProjectDto) => {
    lastTarget.current = project;
    renameTargetRef.current = project;
    lastRenameInput.current = project.displayName;
    setFailure(null);
    setRenameTarget(project);
  }, []);

  // Close the rename dialog without touching the backend.
  const closeRename = useCallback(() => {
    renameTargetRef.current = null;
    setRenameTarget(null);
    setFailure(null);
  }, []);

  const rename = useCallback(
    async (projectId: string, displayName: string) => {
      const project = renameTargetRef.current;

      if (project === null || project.id !== projectId) {
        return;
      }

      const token = begin(project, "rename");
      if (token === null) {
        return;
      }

      lastRenameInput.current = displayName;

      try {
        await renameProject(projectId, displayName);

        if (!settle(token)) {
          return;
        }

        renameTargetRef.current = null;
        setRenameTarget(null);
        refreshList();
      } catch (rejection: unknown) {
        if (!settle(token)) {
          return;
        }

        publishFailure(rejection, project, "rename");
      }
    },
    [begin, publishFailure, refreshList, settle],
  );

  const togglePinned = useCallback(
    async (project: ProjectDto) => {
      const token = begin(project, "pin");
      if (token === null) {
        return;
      }

      try {
        await setProjectPinned(project.id, !project.isPinned);

        if (!settle(token)) {
          return;
        }

        refreshList();
      } catch (rejection: unknown) {
        if (!settle(token)) {
          return;
        }

        publishFailure(rejection, project, "pin");
      }
    },
    [begin, publishFailure, refreshList, settle],
  );

  const openFolder = useCallback(
    async (project: ProjectDto) => {
      const token = begin(project, "openFolder");
      if (token === null) {
        return;
      }

      try {
        await openProjectFolder(project.id);
        settle(token);
      } catch (rejection: unknown) {
        if (!settle(token)) {
          return;
        }

        publishFailure(rejection, project, "openFolder");
      }
    },
    [begin, publishFailure, settle],
  );

  const locateFolder = useCallback(
    async (project: ProjectDto) => {
      const token = begin(project, "locate");
      if (token === null) {
        return;
      }

      try {
        const selection = await locateProjectFolder(project.id);

        if (!settle(token)) {
          return;
        }

        // A cancelled picker is a no-op by contract: the old path stays and nothing is shown.
        if (selection.outcome === "selected") {
          refreshList();
        }
      } catch (rejection: unknown) {
        if (!settle(token)) {
          return;
        }

        publishFailure(rejection, project, "locate");
      }
    },
    [begin, publishFailure, refreshList, settle],
  );

  const requestRemove = useCallback(
    async (project: ProjectDto) => {
      const token = begin(project, "impact");
      if (token === null) {
        return;
      }

      try {
        const impact = await getRemoveProjectImpact(project.id);

        if (!settle(token)) {
          return;
        }

        // The dialog only ever states facts the backend measured, never synthesized ones.
        removeTargetRef.current = { project, impact };
        setRemoveTarget({ project, impact });
      } catch (rejection: unknown) {
        if (!settle(token)) {
          return;
        }

        publishFailure(rejection, project, "impact");
      }
    },
    [begin, publishFailure, settle],
  );

  // Close the remove confirmation without touching the backend.
  const closeRemove = useCallback(() => {
    removeTargetRef.current = null;
    setRemoveTarget(null);
    setFailure(null);
  }, []);

  const confirmRemove = useCallback(
    async (projectId: string) => {
      const target = removeTargetRef.current;

      if (target === null || target.project.id !== projectId) {
        return;
      }

      const token = begin(target.project, "remove");
      if (token === null) {
        return;
      }

      try {
        await removeProject(projectId, true);

        if (!settle(token)) {
          return;
        }

        removeTargetRef.current = null;
        setRemoveTarget(null);
        refreshList();
        onRemoved?.();
      } catch (rejection: unknown) {
        if (!settle(token)) {
          return;
        }

        const error = projectsErrorOf(rejection);

        if (error?.code === "confirmationRequired") {
          // The backend refreshed the facts under the dialog. Rebuild them from this payload
          // and ask again rather than reporting a failure the user cannot act on.
          removeTargetRef.current = { project: target.project, impact: error.impact };
          setRemoveTarget({ project: target.project, impact: error.impact });
          setFailure(null);
          return;
        }

        publishFailure(rejection, target.project, "remove");
      }
    },
    [begin, onRemoved, publishFailure, refreshList, settle],
  );

  // Repeat the operation the current failure names, on the project it happened to.
  const retryFailure = useCallback(async () => {
    const project = lastTarget.current;

    if (project === null || failure === null || failure.kind !== "retryable") {
      return;
    }

    switch (failure.retry) {
      case "rename":
        await rename(project.id, lastRenameInput.current);
        return;
      case "pin":
        await togglePinned(project);
        return;
      case "openFolder":
        await openFolder(project);
        return;
      case "locate":
        await locateFolder(project);
        return;
      case "impact":
        await requestRemove(project);
        return;
      case "remove":
        await confirmRemove(project.id);
        return;
      default:
        // `null` means the message is informational: there is nothing to repeat.
        return;
    }
  }, [confirmRemove, failure, locateFolder, openFolder, rename, requestRemove, togglePinned]);

  // Drop the visible message.
  const dismissFailure = useCallback(() => {
    setFailure(null);
  }, []);

  return {
    pendingProjectId: pending?.projectId ?? null,
    pendingOperation: pending?.operation ?? null,
    failure,
    renameTarget,
    removeTarget,
    openRename,
    closeRename,
    rename,
    togglePinned,
    openFolder,
    locateFolder,
    requestRemove,
    closeRemove,
    confirmRemove,
    retryFailure,
    dismissFailure,
  };
}
