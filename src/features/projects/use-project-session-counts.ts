import { useEffect, useState } from "react";
import type { ProjectDto } from "@/bindings/projects/projects";
import { listSessions, onSessionsRuntimeChanged } from "@/lib/ipc/sessions";

/** Count the existing runtime sessions once for the entire project grid. */
export function useProjectSessionCounts(projects: ProjectDto[]) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let retired = false;
    let sequence = 0;
    let unlisten: (() => void) | undefined;
    setCounts(null);
    /** Reconcile event/focus changes without allowing an older query to win. */
    async function refresh() {
      if (retired) return;
      const ticket = ++sequence;
      try {
        const sessions = await listSessions();
        if (retired || ticket !== sequence) return;
        const next: Record<string, number> = {};
        for (const session of sessions)
          next[session.projectId] = (next[session.projectId] ?? 0) + 1;
        setCounts(next);
      } catch {
        if (!retired && ticket === sequence) setCounts(null);
      }
    }
    if (projects.length) {
      void refresh();
      void onSessionsRuntimeChanged(refresh).then(
        /** Reconcile changes during listener registration and dispose late subscriptions. */ (
          cleanup,
        ) => {
          if (retired) cleanup();
          else {
            unlisten = cleanup;
            void refresh();
          }
        },
        /** Foreground refresh still works if the event channel is unavailable. */ () => {},
      );
      window.addEventListener("focus", refresh);
    }
    return /** Retire all reads when the grid's project snapshot changes. */ () => {
      retired = true;
      unlisten?.();
      window.removeEventListener("focus", refresh);
    };
  }, [projects]);
  return counts;
}
