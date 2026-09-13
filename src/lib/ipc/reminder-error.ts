import { IpcCallError } from "./ipc-error";

/** Reads only the tagged backend category; transport failures remain unknown. */
export function reminderErrorCode(error: unknown): string | undefined {
  return error instanceof IpcCallError ? error.payload?.code : undefined;
}

/** Provides safe shared copy without exposing native errors or stored user content. */
export function reminderErrorMessage(error: unknown): string {
  switch (reminderErrorCode(error)) {
    case "delivery_not_found":
    case "target_unavailable":
      return "This reminder is no longer available.";
    case "delivery_changed":
    case "action_not_allowed":
      return "This reminder changed. Refresh and try again.";
    case "scheduler_catching_up":
      return "Loading missed reminders…";
    case "dependency_unavailable":
    case "persistence_failed":
    case "unavailable":
      return "Reminders are temporarily unavailable. Try again.";
    case "clock_out_of_range":
      return "Check your system clock, then try again.";
    default:
      return "Couldn't update reminders. Refresh and try again.";
  }
}
