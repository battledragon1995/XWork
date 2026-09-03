import { useEffect } from "react";
import type { ProjectDto } from "@/bindings/projects/projects";
import {
  type AddProjectFailure,
  type ProjectListFailure,
  type ProjectListStatus,
  useProjectsStore,
} from "./projects-store";

/** What a mounted consumer reads from the shared store. */
export interface ProjectsSnapshot {
  status: ProjectListStatus;
  projects: ProjectDto[];
  failure: ProjectListFailure | null;
  isAdding: boolean;
  addFailure: AddProjectFailure | null;
  refresh(): void;
}

/**
 * Subscribe one component to the shared unfiltered snapshot for as long as it is mounted.
 * The hook is deliberately thin: the store owns the query, both listeners and the consumer
 * count, so the page and the sidebar can mount in any order without duplicating either.
 */
export function useProjects(): ProjectsSnapshot {
  const status = useProjectsStore((state) => state.status);
  const projects = useProjectsStore((state) => state.projects);
  const failure = useProjectsStore((state) => state.failure);
  const isAdding = useProjectsStore((state) => state.isAdding);
  const addFailure = useProjectsStore((state) => state.addFailure);
  const refresh = useProjectsStore((state) => state.refresh);

  useEffect(() => {
    const { acquire, release } = useProjectsStore.getState();
    acquire();

    return release;
  }, []);

  return { status, projects, failure, isAdding, addFailure, refresh };
}
