import { IpcCallError } from "@/lib/ipc/ipc-error";

/** Recognize normalized Calendar failures without exposing transport details. */
export function calendarErrorKind(error: unknown): string | null {
  if (!(error instanceof IpcCallError) || !error.payload) return null;
  return "kind" in error.payload && typeof error.payload.kind === "string"
    ? error.payload.kind
    : null;
}

/** Provide safe recovery text for the Calendar read surface. */
export function calendarErrorCopy(error: unknown): string {
  switch (calendarErrorKind(error)) {
    case "event_not_found":
      return "This event no longer exists";
    case "invalid_event_id":
      return "This event link is invalid";
    case "invalid_time_zone":
      return "This time zone is unavailable. Use UTC to reload calendar events.";
    case "invalid_date":
    case "invalid_range":
    case "date_out_of_range":
      return "Choose a valid calendar date or range.";
    case "occurrence_limit_exceeded":
      return "Too many events in this range. Choose Day or another range.";
    default:
      return "Could not load calendar events";
  }
}
