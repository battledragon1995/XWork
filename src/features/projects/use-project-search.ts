import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDto } from "@/bindings/projects/projects";
import { listProjects } from "@/lib/ipc/projects";
import { classifyListFailure, type ProjectListFailure } from "./project-error-copy";
import type { ProjectListStatus } from "./projects-store";
import type { ProjectsSnapshot } from "./use-projects";

/** Quiet interval the page waits out before it sends one search query. */
const SEARCH_DEBOUNCE_MS = 200;

/** Longest filter the backend accepts, counted in Unicode scalar values. */
const SEARCH_MAX_SCALARS = 256;

/** Control characters, the one class of input the backend rejects outright. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/** What the route reads from the search box: the visible query and the grid it produces. */
export interface ProjectSearchResult {
  query: string;
  projects: ProjectDto[];
  status: ProjectListStatus;
  failure: ProjectListFailure | null;
  setQuery(next: string): void;
  clear(): void;
  refresh(): void;
}

/**
 * Reduce raw input to the filter the backend will accept: drop control characters, cap the
 * length at 256 Unicode scalar values so an astral emoji counts once exactly as the backend's
 * `chars().count()` does, then trim. Removing the control characters first is what makes
 * `invalidSearch` unreachable from the search box.
 */
export function sanitizeSearch(raw: string): string {
  const withoutControls = raw.replace(CONTROL_CHARACTERS, "");

  return Array.from(withoutControls).slice(0, SEARCH_MAX_SCALARS).join("").trim();
}

/**
 * Own the page's search box. The shared store keeps only the unfiltered snapshot, so the
 * filtered result lives here: an empty query falls straight back to the store's list, and a
 * non-empty one becomes exactly one `list_projects(search)` call after the quiet interval.
 */
export function useProjectSearch(source: ProjectsSnapshot): ProjectSearchResult {
  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<ProjectDto[] | null>(null);
  const [status, setStatus] = useState<ProjectListStatus>("idle");
  const [failure, setFailure] = useState<ProjectListFailure | null>(null);

  // Every query carries a token. Only the newest token may publish, so a slow answer cannot
  // overwrite a newer one and unmounting invalidates whatever is still in flight.
  const requestToken = useRef(0);

  /** Pending debounce timer, kept so a new keystroke or a clear can cancel it. */
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Sanitized query the hook currently owns, which an invalidation or a retry reruns. */
  const activeQuery = useRef("");

  // Drop any scheduled query without starting it.
  const cancelPending = useCallback(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  // Send one search query and publish its result unless a newer query has started.
  const runQuery = useCallback((sanitized: string) => {
    requestToken.current += 1;
    const token = requestToken.current;
    setStatus("loading");
    setFailure(null);

    listProjects(sanitized)
      .then((projects) => {
        if (token !== requestToken.current) {
          return;
        }

        setResults(projects);
        setStatus("ready");
        setFailure(null);
      })
      .catch((rejection: unknown) => {
        if (token !== requestToken.current) {
          return;
        }

        setStatus("failed");
        setFailure(classifyListFailure(rejection));
      });
  }, []);

  // Record what the user sees immediately, then schedule at most one query for it.
  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next);
      cancelPending();

      const sanitized = sanitizeSearch(next);

      if (sanitized === "") {
        // Invalidate any in-flight search so its answer cannot repopulate the grid after the
        // user already went back to the unfiltered list.
        requestToken.current += 1;
        activeQuery.current = "";
        setResults(null);
        setStatus("idle");
        setFailure(null);
        return;
      }

      activeQuery.current = sanitized;
      // Published straight away so the grid keeps its content instead of flashing while the
      // quiet interval runs out.
      setStatus("loading");
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        runQuery(sanitized);
      }, SEARCH_DEBOUNCE_MS);
    },
    [cancelPending, runQuery],
  );

  // Empty the search box. Restoring focus belongs to the caller that owns the input element.
  const clear = useCallback(() => {
    setQuery("");
  }, [setQuery]);

  // Re-run the active query at once, or delegate to the shared store when none is active, so
  // one retry control serves both the filtered and the unfiltered grid.
  const refresh = useCallback(() => {
    const sanitized = activeQuery.current;

    if (sanitized === "") {
      source.refresh();
      return;
    }

    cancelPending();
    runQuery(sanitized);
  }, [cancelPending, runQuery, source]);

  /** Snapshot the hook last reacted to, so only a real store change reruns the query. */
  const lastSeenProjects = useRef(source.projects);

  useEffect(() => {
    if (lastSeenProjects.current === source.projects) {
      return;
    }

    lastSeenProjects.current = source.projects;

    // The store re-queried, which means `projects://changed` or a window focus arrived. Run
    // the active query again so the filtered grid catches the same change.
    if (activeQuery.current === "") {
      return;
    }

    cancelPending();
    runQuery(activeQuery.current);
  }, [cancelPending, runQuery, source.projects]);

  useEffect(() => {
    return () => {
      cancelPending();
      // Invalidate every in-flight query so nothing sets state after unmount.
      requestToken.current += 1;
    };
  }, [cancelPending]);

  const sanitized = sanitizeSearch(query);

  if (sanitized === "") {
    return {
      query,
      projects: source.projects,
      status: source.status,
      failure: source.failure,
      setQuery,
      clear,
      refresh,
    };
  }

  return {
    query,
    // Until the first search for this query answers, the unfiltered list is still the most
    // accurate thing to show, which is what keeps the grid from blanking while typing.
    projects: results ?? source.projects,
    status,
    failure,
    setQuery,
    clear,
    refresh,
  };
}
