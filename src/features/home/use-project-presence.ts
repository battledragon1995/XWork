import { useCallback, useEffect, useRef, useState } from "react";
import { IpcCallError } from "@/lib/ipc/ipc-error";
import { listProjects, onProjectsChanged, type UnlistenFn } from "@/lib/ipc/projects";

/** Whether the route has any project to show, reduced from the backend list. */
export type ProjectPresence =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "present" }
  | { status: "failed"; kind: "retryable" | "integration" };

/** What the route reads from the hook: the current branch and a way to ask again. */
export interface ProjectPresenceResult {
  presence: ProjectPresence;
  refresh(): void;
}

// Sort one load failure into the two recovery paths the screen offers. Only a persistence
// failure is worth another attempt; every other code, and every rejection this build does not
// recognize, is terminal so the user is never trapped in a retry loop.
function classifyFailure(rejection: unknown): ProjectPresence {
  const isRetryable =
    rejection instanceof IpcCallError && rejection.payload?.code === "persistenceFailed";

  return { status: "failed", kind: isRetryable ? "retryable" : "integration" };
}

/**
 * Track whether any project exists, and keep that answer current. The hook queries once on
 * mount and again on every invalidation signal, but it stores presence only — never a copy of
 * the project list, which stays owned by the backend.
 */
export function useProjectPresence(): ProjectPresenceResult {
  const [presence, setPresence] = useState<ProjectPresence>({ status: "loading" });

  // Every query carries a token. Only the newest token may commit its result, so a slow
  // query cannot overwrite a newer one, and teardown invalidates everything still in flight.
  const requestToken = useRef(0);

  // Start one query and publish its result unless a newer query has already started.
  const refresh = useCallback(() => {
    requestToken.current += 1;
    const token = requestToken.current;

    listProjects()
      .then((projects) => {
        if (token !== requestToken.current) {
          return;
        }

        setPresence(projects.length === 0 ? { status: "empty" } : { status: "present" });
      })
      .catch((rejection: unknown) => {
        if (token !== requestToken.current) {
          return;
        }

        setPresence(classifyFailure(rejection));
      });
  }, []);

  useEffect(() => {
    refresh();

    const unlistens: UnlistenFn[] = [];
    let isMounted = true;

    // Re-query when the window comes back to the foreground, which is the only signal the
    // shell has for project data that changed while XWork was in the background.
    function handleWindowFocus(): void {
      refresh();
    }

    window.addEventListener("focus", handleWindowFocus);

    // Subscribe to project mutations. The payload is an invalidation key only, so the handler
    // re-queries instead of deriving presence from the reported change.
    async function subscribe(): Promise<void> {
      const registered = await onProjectsChanged(() => {
        refresh();
      });

      // Registration resolves asynchronously and can lose the race with unmount, so a late
      // subscription is removed immediately rather than left behind.
      if (!isMounted) {
        registered();
        return;
      }

      unlistens.push(registered);
    }

    void subscribe();

    return () => {
      isMounted = false;
      // Invalidate every in-flight query so nothing sets state after unmount.
      requestToken.current += 1;
      window.removeEventListener("focus", handleWindowFocus);
      for (const unlisten of unlistens) {
        unlisten();
      }
    };
  }, [refresh]);

  return { presence, refresh };
}
