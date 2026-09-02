import { create } from "zustand";
import type { AppLifecycleError, QuitRequestDto } from "@/bindings/app-lifecycle";
import {
  cancelQuit as cancelQuitCommand,
  confirmQuit as confirmQuitCommand,
  requestQuit as requestQuitCommand,
} from "@/lib/ipc/app-lifecycle";
import { IpcCallError } from "@/lib/ipc/ipc-error";

/** Every step of the Quit flow the interface can be in. */
export type QuitPhase =
  | "idle"
  | "requesting"
  | "awaiting-confirmation"
  | "confirming"
  | "snapshot-failed"
  | "integration-failed";

/**
 * The failure currently on display. `"unknown"` stands for a rejection that carried no
 * recognizable `{ code }`, which `FE-001` requires the shell to treat as an integration failure.
 */
export interface QuitFailure {
  stage: "snapshot" | "shutdown" | "integration";
  code: AppLifecycleError["code"] | "unknown";
}

/** Temporary interface state of the Quit flow. The request itself is never cached. */
export interface QuitState {
  phase: QuitPhase;
  request: QuitRequestDto | null;
  failure: QuitFailure | null;
  startQuit(): Promise<void>;
  receiveTrayRequest(request: QuitRequestDto): void;
  cancelQuit(): Promise<void>;
  confirmQuit(): Promise<void>;
}

// Read the failure code out of a rejection, falling back to the unrecognized marker.
function toFailureCode(rejection: unknown): AppLifecycleError["code"] | "unknown" {
  if (rejection instanceof IpcCallError && rejection.payload !== null) {
    return (rejection.payload as AppLifecycleError).code;
  }

  return "unknown";
}

/** The state a non-recoverable failure leaves behind: no dialog, no retry. */
function integrationFailure(code: AppLifecycleError["code"] | "unknown") {
  return {
    phase: "integration-failed" as const,
    request: null,
    failure: { stage: "integration" as const, code },
  };
}

export const useQuitStore = create<QuitState>((set, get) => {
  // Ask the backend for the current runtime snapshot and publish whichever state it implies.
  // `startQuit` and the one stale-request refresh share this, so both branch identically.
  async function loadRequest(): Promise<void> {
    try {
      const request = await requestQuitCommand();

      if (request === null) {
        // The backend already cleaned up and is exiting; there is nothing left to show.
        set({ phase: "idle", request: null, failure: null });
        return;
      }

      set({ phase: "awaiting-confirmation", request, failure: null });
    } catch (rejection) {
      const code = toFailureCode(rejection);

      if (code === "runtime_snapshot_failed") {
        set({
          phase: "snapshot-failed",
          request: null,
          failure: { stage: "snapshot", code },
        });
        return;
      }

      if (code === "quit_already_in_progress") {
        set({ phase: "confirming", failure: null });
        return;
      }

      set(integrationFailure(code));
    }
  }

  return {
    phase: "idle",
    request: null,
    failure: null,

    // Start the flow from the wordmark menu. A second start while a call is still in flight is
    // dropped, so the menu cannot open two requests.
    async startQuit() {
      const phase = get().phase;
      if (phase === "requesting" || phase === "confirming") {
        return;
      }

      set({ phase: "requesting", failure: null });
      await loadRequest();
    },

    // Accept a tray-initiated request. A repeat of the identifier already on display is
    // ignored so the open dialog and its focus survive untouched.
    receiveTrayRequest(request) {
      if (get().request?.requestId === request.requestId) {
        return;
      }

      set({ phase: "awaiting-confirmation", request, failure: null });
    },

    // Cancel the pending request. Escape and an outside click both arrive here, so a request
    // can never stay pending without a dialog to act on it.
    async cancelQuit() {
      const { phase, request } = get();
      if (phase === "confirming" || phase === "requesting") {
        return;
      }

      if (request === null) {
        set({ phase: "idle", request: null, failure: null });
        return;
      }

      try {
        await cancelQuitCommand(request.requestId);
        set({ phase: "idle", request: null, failure: null });
      } catch (rejection) {
        const code = toFailureCode(rejection);

        if (code === "stale_quit_request") {
          // The backend already dropped the request, which is exactly what the user asked for.
          set({ phase: "idle", request: null, failure: null });
          return;
        }

        if (code === "quit_already_in_progress") {
          set({ phase: "confirming", failure: null });
          return;
        }

        set(integrationFailure(code));
      }
    },

    // Confirm the pending request. The phase is raised before the await so both dialog actions
    // are already locked when a second click arrives.
    async confirmQuit() {
      const { phase, request } = get();
      if (phase !== "awaiting-confirmation" || request === null) {
        return;
      }

      set({ phase: "confirming", failure: null });

      try {
        await confirmQuitCommand(request.requestId);
        // On success the backend exits the process, so there is no follow-up state to publish.
      } catch (rejection) {
        const code = toFailureCode(rejection);

        if (code === "runtime_shutdown_failed") {
          set({
            phase: "awaiting-confirmation",
            failure: { stage: "shutdown", code },
          });
          return;
        }

        if (code === "stale_quit_request") {
          // Drop the outdated dialog and ask once for the current state. `loadRequest` either
          // closes the flow or opens the dialog again with fresh numbers.
          set({ phase: "requesting", request: null, failure: null });
          await loadRequest();
          return;
        }

        if (code === "quit_already_in_progress") {
          set({ phase: "confirming", failure: null });
          return;
        }

        set(integrationFailure(code));
      }
    },
  };
});

// Restore the idle flow. Tests call this so no case observes another case's pending request.
export function resetQuitStore(): void {
  useQuitStore.setState({ phase: "idle", request: null, failure: null });
}
