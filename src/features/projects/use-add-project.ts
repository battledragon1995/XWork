import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { addProject as addProjectCommand } from "@/lib/ipc/projects";
import { type AddProjectFailure, classifyAddFailure } from "./project-error-copy";
import { useProjectsStore } from "./projects-store";

/** What both Add Project entry points read from the shared flow. */
export interface AddProjectFlow {
  isAdding: boolean;
  failure: AddProjectFailure | null;
  startAdd(restoreFocus?: () => void): Promise<void>;
  dismissFailure(): void;
  openDuplicate(projectId: string): void;
}

/**
 * Drive the one Add Project attempt the whole feature may have in flight. The page button and
 * the sidebar action each call this hook, so the guard against a second native picker has to
 * live in the shared store rather than in component state — two separately mounted components
 * cannot see each other's `useState`.
 *
 * This is a feature-local copy of the FE-002 flow on purpose: the dependency rules forbid
 * importing another feature's implementation, and the copy strings are shared through
 * `project-error-copy.ts` so both screens describe the same failure identically.
 */
export function useAddProject(): AddProjectFlow {
  const isAdding = useProjectsStore((state) => state.isAdding);
  const failure = useProjectsStore((state) => state.addFailure);
  const navigate = useNavigate();

  const startAdd = useCallback(
    async (restoreFocus?: () => void) => {
      // `beginAdd` is the only duplicate-picker guard. It answers from the store's current
      // value, so two clicks in the same tick cannot both get through.
      if (!useProjectsStore.getState().beginAdd()) {
        return;
      }

      try {
        const selection = await addProjectCommand();

        if (selection.outcome === "selected") {
          useProjectsStore.getState().endAdd(null);
          // `open_project` belongs to Project Overview; the backend already stamped the row.
          void navigate(`/projects/${selection.project.id}`);
          return;
        }

        // Flushed on purpose: the initiating control is disabled while the flow runs, and a
        // still-disabled button cannot take focus back.
        flushSync(() => {
          useProjectsStore.getState().endAdd(null);
        });
        restoreFocus?.();
      } catch (rejection: unknown) {
        useProjectsStore.getState().endAdd(classifyAddFailure(rejection));
      }
    },
    [navigate],
  );

  // Drop the visible message without starting another attempt.
  const dismissFailure = useCallback(() => {
    useProjectsStore.getState().endAdd(null);
  }, []);

  // Open the project that already owns the folder the user just picked.
  const openDuplicate = useCallback(
    (projectId: string) => {
      void navigate(`/projects/${projectId}`);
    },
    [navigate],
  );

  return { isAdding, failure, startAdd, dismissFailure, openDuplicate };
}
