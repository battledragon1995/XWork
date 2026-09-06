import type { SearchSourceFailureDto } from "@/bindings/search";
import { IpcCallError } from "@/lib/ipc/ipc-error";

/** Explain stable search errors without exposing diagnostic payloads. */
export function searchErrorCopy(error: unknown): string {
  switch (error instanceof IpcCallError ? error.payload?.code : null) {
    case "invalid_query":
      return "Use up to 128 characters and remove control characters.";
    case "invalid_context_project_id":
      return "Search context is unavailable.";
    case "unauthorized_window":
      return "Search is only available in the main window.";
    default:
      return "Could not search. Try again.";
  }
}

/** Label one partial source failure using fixed product copy. */
export function sourceFailureCopy(failure: SearchSourceFailureDto): string {
  const labels = {
    projects: "Projects",
    sessions: "Sessions",
    files: "Files",
    commands: "Commands",
  };
  return `${labels[failure.source]}: ${failure.reason === "timeout" ? "Timed out" : "Unavailable"}`;
}
