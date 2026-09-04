import { useCallback, useRef, useState } from "react";
import type { CloseImpactDto } from "@/bindings/sessions/sessions";
import { closeRuntimeTarget, getCloseImpact, renameSession } from "@/lib/ipc/sessions";
import {
  classifySessionsFailure,
  type SessionsFailure,
  sessionsErrorOf,
} from "@/lib/utils/session-copy";

/** Copy for the impact read that could not report what a session is running. */
export const INSPECT_SESSION_FAILED_MESSAGE = "XWork couldn't check what this session is running.";

/** The three mutations the session route's own dialogs can start. */
export type SessionLifecycleOperation = "rename" | "inspect" | "delete";

/** State and actions of the one lifecycle operation the route allows at a time. */
export interface SessionLifecycle {
  pending: SessionLifecycleOperation | null;
  impact: CloseImpactDto | null;
  failure: SessionsFailure | null;
  /** Resolves `true` when the rename dialog should close, whether it succeeded or is moot. */
  rename(sessionId: string, name: string): Promise<boolean>;
  /** Resolves `true` when the delete dialog may open, with facts or a retryable failure. */
  inspect(sessionId: string): Promise<boolean>;
  /** Resolves `true` when the delete dialog should close, whether it deleted or was moot. */
  confirmDelete(sessionId: string): Promise<boolean>;
  reset(): void;
}

/** Transient values the two dialogs read, kept as one object so they change together. */
interface LifecycleState {
  pending: SessionLifecycleOperation | null;
  impact: CloseImpactDto | null;
  failure: SessionsFailure | null;
}

const IDLE_STATE: LifecycleState = { pending: null, impact: null, failure: null };

/**
 * Own the rename, inspect and close commands of the session route.
 *
 * Only one of them may be in flight, so a second activation of the same dialog cannot send a
 * duplicate command. Every outcome is reported as "should the dialog close", because that is
 * the one decision the caller has to make and the backend is what decides it.
 */
export function useSessionLifecycle(): SessionLifecycle {
  const [state, setState] = useState<LifecycleState>(IDLE_STATE);
  /**
   * Mirrors the pending marker so the guard reads the value already committed rather than the
   * one this render closed over; two activations in the same tick would otherwise both pass.
   */
  const pendingRef = useRef<SessionLifecycleOperation | null>(null);

  /** Claim the single slot, or report that another mutation already owns it. */
  const begin = useCallback((operation: SessionLifecycleOperation): boolean => {
    if (pendingRef.current !== null) {
      return false;
    }

    pendingRef.current = operation;
    setState((current) => ({ pending: operation, impact: current.impact, failure: null }));
    return true;
  }, []);

  /** Release the slot and publish what the backend answered. */
  const finish = useCallback((next: Omit<LifecycleState, "pending">): void => {
    pendingRef.current = null;
    setState({ pending: null, ...next });
  }, []);

  const rename = useCallback(
    async (sessionId: string, name: string) => {
      if (!begin("rename")) {
        return false;
      }

      try {
        await renameSession(sessionId, name);
        finish({ impact: null, failure: null });
        return true;
      } catch (rejection: unknown) {
        const classified = classifySessionsFailure(rejection);

        if (classified.code === "sessionNotFound" || classified.code === "runtimeShuttingDown") {
          // Nothing is left to rename, so the dialog closes without an error of its own; the
          // route's own missing-session handling decides where the user goes next.
          finish({ impact: null, failure: null });
          return true;
        }

        finish({ impact: null, failure: classified });
        return false;
      }
    },
    [begin, finish],
  );

  const inspect = useCallback(
    async (sessionId: string) => {
      if (!begin("inspect")) {
        return false;
      }

      try {
        const impact = await getCloseImpact({ kind: "session", sessionId });
        finish({ impact, failure: null });
        return true;
      } catch (rejection: unknown) {
        const classified = classifySessionsFailure(rejection);

        if (classified.code === "contentLifecycleFailed") {
          // The confirmation still opens: the user has to be able to read why the facts are
          // missing and to ask for them again.
          finish({
            impact: null,
            failure: { ...classified, message: INSPECT_SESSION_FAILED_MESSAGE },
          });
          return true;
        }

        finish({ impact: null, failure: classified });
        return false;
      }
    },
    [begin, finish],
  );

  const confirmDelete = useCallback(
    async (sessionId: string) => {
      if (!begin("delete")) {
        return false;
      }

      try {
        await closeRuntimeTarget({ kind: "session", sessionId }, true);
        finish({ impact: null, failure: null });
        return true;
      } catch (rejection: unknown) {
        const payload = sessionsErrorOf(rejection);
        const classified = classifySessionsFailure(rejection);

        if (payload?.code === "confirmationRequired") {
          // A blocker appeared since the facts were read, so the refreshed impact replaces
          // them and the user has to agree to the new consequences explicitly.
          finish({ impact: payload.impact, failure: classified });
          return false;
        }

        if (classified.code === "sessionNotFound" || classified.code === "runtimeShuttingDown") {
          // Already gone, or going: either way the confirmation has nothing left to ask.
          finish({ impact: null, failure: null });
          return true;
        }

        // The impact stays on screen: a failed close changed nothing, so the facts the user
        // already agreed to are still the facts.
        pendingRef.current = null;
        setState((current) => ({ pending: null, impact: current.impact, failure: classified }));
        return false;
      }
    },
    [begin, finish],
  );

  const reset = useCallback(() => {
    pendingRef.current = null;
    setState(IDLE_STATE);
  }, []);

  return {
    pending: state.pending,
    impact: state.impact,
    failure: state.failure,
    rename,
    inspect,
    confirmDelete,
    reset,
  };
}
