import { type Event, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CloseImpactDto,
  CloseResultDto,
  CloseTargetDto,
  SessionDetailDto,
  SessionRuntimeEventDto,
  SessionSummaryDto,
  SessionsError,
} from "@/bindings/sessions/sessions";
import { invokeCommand } from "./ipc-error";

/** Re-exported so feature hooks can type a subscription without importing Tauri directly. */
export type { UnlistenFn };

/** Event BE-005 emits after every committed runtime mutation and status change. */
const SESSIONS_RUNTIME_CHANGED_EVENT = "sessions://runtime-changed";

// Call one Sessions command with the shared error normalization of this layer.
function invokeSessions<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invokeCommand<TResult, SessionsError>(command, args);
}

/**
 * List the runtime sessions of the current process. `projectId` is omitted entirely when the
 * caller has none, so the backend applies its own unfiltered default rather than receiving an
 * explicit empty filter.
 */
export function listSessions(projectId?: string): Promise<SessionSummaryDto[]> {
  return invokeSessions<SessionSummaryDto[]>(
    "list_sessions",
    projectId === undefined ? undefined : { projectId },
  );
}

/** Read one complete session snapshot, including its tabs and pane layout. */
export function getSession(sessionId: string): Promise<SessionDetailDto> {
  return invokeSessions<SessionDetailDto>("get_session", { sessionId });
}

/** Create one runtime session for a project and return its first full snapshot. */
export function createSession(projectId: string): Promise<SessionDetailDto> {
  return invokeSessions<SessionDetailDto>("create_session", { projectId });
}

/**
 * Rename one session. The name is forwarded exactly as the caller supplied it: normalization
 * is a backend rule, so trimming here twice would hide what BE-005 actually rejected.
 */
export function renameSession(sessionId: string, name: string): Promise<SessionDetailDto> {
  return invokeSessions<SessionDetailDto>("rename_session", { sessionId, name });
}

/**
 * Attach one CLI profile to an empty session. BE-005 answers with the post-commit snapshot,
 * which already contains the created tab and its `toolSelection` pane.
 */
export function selectSessionTool(sessionId: string, profileId: string): Promise<SessionDetailDto> {
  return invokeSessions<SessionDetailDto>("select_session_tool", { sessionId, profileId });
}

/** Read the process and unsaved-file blockers of one close target. Nothing is closed yet. */
export function getCloseImpact(target: CloseTargetDto): Promise<CloseImpactDto> {
  return invokeSessions<CloseImpactDto>("get_close_impact", { target });
}

/**
 * Close one runtime target. `confirmed` is forwarded as given; the backend answers with
 * `confirmationRequired` and a fresh impact whenever it refuses an unconfirmed close.
 */
export function closeRuntimeTarget(
  target: CloseTargetDto,
  confirmed: boolean,
): Promise<CloseResultDto> {
  return invokeSessions<CloseResultDto>("close_runtime_target", { target, confirmed });
}

/**
 * Tell BE-005 which session the user is looking at, or that none is. `null` is sent as an
 * explicit field rather than an omitted one, because omitting it would leave the backend on
 * its previous observation instead of clearing it.
 */
export function setObservedSession(sessionId: string | null): Promise<SessionSummaryDto | null> {
  return invokeSessions<SessionSummaryDto | null>("set_observed_session", { sessionId });
}

/**
 * Subscribe to committed runtime changes. Unlike the CLI profile event, this payload is
 * committed data: it carries the post-mutation summary readers apply directly.
 */
export function onSessionsRuntimeChanged(
  handler: (event: SessionRuntimeEventDto) => void,
): Promise<UnlistenFn> {
  return listen<SessionRuntimeEventDto>(
    SESSIONS_RUNTIME_CHANGED_EVENT,
    (event: Event<SessionRuntimeEventDto>) => {
      handler(event.payload);
    },
  );
}
