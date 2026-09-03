import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDto, ProjectGitStatusDto } from "@/bindings/projects/projects";
import {
  getProject,
  getProjectGitStatus,
  onProjectsChanged,
  openProject,
} from "@/lib/ipc/projects";
import {
  classifyGitFailure,
  classifyProjectReadFailure,
  type ProjectReadFailure,
} from "./project-error-copy";

/** State of the independent, read-only Git snapshot. */
export type GitSnapshotState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; snapshot: ProjectGitStatusDto }
  | { status: "failed"; message: string };

/** Route inputs that are intentionally kept outside the hook's snapshot. */
export interface UseProjectOverviewOptions {
  projectId: string;
  onGone(): void;
}

/** Project metadata, Git state, and the three recovery actions the route can expose. */
export interface ProjectOverviewData {
  status: "loading" | "ready" | "failed";
  project: ProjectDto | null;
  failure: ProjectReadFailure | null;
  git: GitSnapshotState;
  load(): void;
  refreshProject(): void;
  retryGit(): void;
}

/**
 * Load one overview and keep it current through the project event and window-focus signals.
 * A single monotonically increasing token owns each metadata-plus-Git sequence, so only the
 * newest request may publish and unmount invalidates every promise still in flight.
 */
export function useProjectOverview(options: UseProjectOverviewOptions): ProjectOverviewData {
  const { projectId, onGone } = options;
  const [status, setStatus] = useState<ProjectOverviewData["status"]>("loading");
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [failure, setFailure] = useState<ProjectReadFailure | null>(null);
  const [git, setGit] = useState<GitSnapshotState>({ status: "idle" });
  const requestToken = useRef(0);
  const projectRef = useRef<ProjectDto | null>(null);
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;

  /** Publish navigation only if the request that discovered removal is still current. */
  const reportGone = useCallback((token: number) => {
    if (token === requestToken.current) {
      onGoneRef.current();
    }
  }, []);

  /** Query Git inside an existing request sequence and classify every backend failure. */
  const readGit = useCallback(
    async (token: number, currentProject: ProjectDto, refreshAvailability = true) => {
      if (currentProject.availability.status === "unavailable") {
        if (token === requestToken.current) {
          setGit({ status: "idle" });
        }
        return;
      }

      if (token === requestToken.current) {
        setGit({ status: "loading" });
      }

      try {
        const snapshot = await getProjectGitStatus(projectId);
        if (token === requestToken.current) {
          setGit({ status: "ready", snapshot });
        }
      } catch (rejection: unknown) {
        if (token !== requestToken.current) {
          return;
        }

        const classified = classifyGitFailure(rejection, currentProject.displayName);
        switch (classified.kind) {
          case "retryable":
          case "integration":
            setGit({ status: "failed", message: classified.message });
            return;
          case "gone":
            reportGone(token);
            return;
          case "unavailable":
            if (!refreshAvailability) {
              setGit({ status: "idle" });
              return;
            }
            // The Git command observed a newer availability state than this snapshot. Clear
            // stale Git immediately, then let one read-only metadata command confirm it.
            setGit({ status: "idle" });
            requestToken.current += 1;
            {
              const refreshToken = requestToken.current;
              try {
                const refreshed = await getProject(projectId);
                if (refreshToken !== requestToken.current) {
                  return;
                }
                projectRef.current = refreshed;
                setProject(refreshed);
                setStatus("ready");
                setFailure(null);
                // One follow-up Git read catches a root that recovered during the metadata
                // query, but it cannot start another metadata loop if the race repeats.
                await readGit(refreshToken, refreshed, false);
              } catch (refreshRejection: unknown) {
                if (refreshToken !== requestToken.current) {
                  return;
                }
                const refreshFailure = classifyProjectReadFailure(refreshRejection, "refresh");
                if (refreshFailure.kind === "gone") {
                  reportGone(refreshToken);
                } else {
                  setFailure(refreshFailure);
                }
              }
            }
        }
      }
    },
    [projectId, reportGone],
  );

  /** Run the initial open path; retries intentionally call `open_project` again. */
  const load = useCallback(() => {
    requestToken.current += 1;
    const token = requestToken.current;
    projectRef.current = null;
    setStatus("loading");
    setProject(null);
    setFailure(null);
    setGit({ status: "idle" });

    void openProject(projectId)
      .then(async (opened) => {
        if (token !== requestToken.current) {
          return;
        }
        projectRef.current = opened;
        setProject(opened);
        setStatus("ready");
        await readGit(token, opened);
      })
      .catch((rejection: unknown) => {
        if (token !== requestToken.current) {
          return;
        }
        const classified = classifyProjectReadFailure(rejection, "open");
        if (classified.kind === "gone") {
          reportGone(token);
          return;
        }
        setStatus("failed");
        setFailure(classified);
      });
  }, [projectId, readGit, reportGone]);

  /** Refresh metadata without advancing `lastOpenedAtMs`, then refresh Git if applicable. */
  const refreshProject = useCallback(() => {
    requestToken.current += 1;
    const token = requestToken.current;
    setFailure(null);

    void getProject(projectId)
      .then(async (refreshed) => {
        if (token !== requestToken.current) {
          return;
        }
        projectRef.current = refreshed;
        setProject(refreshed);
        setStatus("ready");
        await readGit(token, refreshed);
      })
      .catch((rejection: unknown) => {
        if (token !== requestToken.current) {
          return;
        }
        const classified = classifyProjectReadFailure(rejection, "refresh");
        if (classified.kind === "gone") {
          reportGone(token);
          return;
        }
        // A refresh failure is inline: the last good project and Git snapshot remain visible.
        setFailure(classified);
      });
  }, [projectId, readGit, reportGone]);

  /** Retry only the Git command against the last good project snapshot. */
  const retryGit = useCallback(() => {
    const currentProject = projectRef.current;
    if (currentProject === null || currentProject.availability.status === "unavailable") {
      return;
    }
    requestToken.current += 1;
    void readGit(requestToken.current, currentProject);
  }, [readGit]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    /** Refresh the current route when its window returns to the foreground. */
    const handleFocus = (): void => {
      refreshProject();
    };

    window.addEventListener("focus", handleFocus);
    void onProjectsChanged((event) => {
      if (event.projectId === projectId && event.change === "removed") {
        requestToken.current += 1;
        onGoneRef.current();
        return;
      }
      refreshProject();
    })
      .then((removeListener) => {
        if (!active) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch(() => {
        // Focus remains a valid refresh seam if native event registration is refused.
      });

    load();

    return () => {
      active = false;
      requestToken.current += 1;
      window.removeEventListener("focus", handleFocus);
      unlisten?.();
    };
  }, [load, projectId, refreshProject]);

  return { status, project, failure, git, load, refreshProject, retryGit };
}
