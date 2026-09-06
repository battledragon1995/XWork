import type { SessionSummaryDto } from "@/bindings/sessions/sessions";
import { listSessions, onSessionsRuntimeChanged } from "@/lib/ipc/sessions";
import type { HomeRouteProps } from "./home-route";
import { useHomeQuery } from "./use-project-presence";

const SESSIONS = {
  list: listSessions,
  /** Session payloads invalidate the aggregate rather than replacing it. */
  subscribe: (invalidate: (removedId?: string) => void) =>
    onSessionsRuntimeChanged(
      /** Remove deleted rows before a trailing authoritative read can complete. */
      (event) => invalidate(event.change === "deleted" ? event.sessionId : undefined),
    ),
  retryable: ["projectLookupFailed", "projectNotFound"],
};

/** Read every runtime session without acquiring terminal or project owner state. */
export function useHomeSessions(
  props: HomeRouteProps,
  invalidation: number,
  refreshProjects: () => void,
  enabled = true,
) {
  return useHomeQuery<SessionSummaryDto>(
    SESSIONS,
    props,
    enabled,
    invalidation,
    undefined,
    refreshProjects,
  );
}
