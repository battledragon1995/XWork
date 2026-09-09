import { IpcCallError } from "@/lib/ipc/ipc-error";
import type { EventFieldErrors } from "./event-form-state";

/** Attach known backend validation failures to editable fields. */
export function eventFieldErrors(error: unknown): EventFieldErrors {
  const kind = calendarErrorKind(error);
  switch (kind) {
    case "invalid_title":
      return { title: "Enter a valid title of 1–200 characters." };
    case "description_too_long":
      return { description: "Use at most 20,000 characters." };
    case "invalid_project_id":
    case "project_not_found":
    case "project_changed":
      return { projectId: "Choose None or an available project before saving again." };
    case "invalid_time_zone":
      return { timeZoneId: "Enter a valid IANA time zone, for example UTC." };
    case "nonexistent_local_time":
      return {
        startTime:
          "This local time does not exist because of daylight saving time. Change Starts or Ends.",
      };
    case "invalid_date":
    case "invalid_local_date_time":
    case "invalid_time_range":
    case "date_out_of_range":
      return { endDate: "Choose valid dates and times with a duration of at most 366 days." };
    case "invalid_recurrence":
    case "invalid_recurrence_end":
      return { recurrence: "Check repeat weekdays and the repeat end." };
    case "too_many_reminders":
    case "duplicate_reminder":
    case "invalid_reminder_offset":
      return { reminderMinutes: "Use up to 16 distinct whole-minute offsets from 0 to 525,600." };
    default:
      return {};
  }
}

/** Provide mutation recovery without leaking transport or storage details. */
export function eventMutationCopy(error: unknown): string {
  switch (calendarErrorKind(error)) {
    case null:
      return "The result is unknown. Close and check Calendar before trying again.";
    case "event_not_found":
      return "This event no longer exists. Your draft is still available to copy.";
    case "revision_conflict":
      return "This event changed. Reload to edit the latest version.";
    case "delete_confirmation_missing":
    case "delete_confirmation_expired":
    case "delete_impact_changed":
      return "The deletion preview is no longer valid. Review deletion again.";
    case "invalid_event_id":
    case "invalid_revision":
    case "unauthorized_caller":
    case "corrupt_stored_data":
      return "This event cannot be changed safely. Reload before trying again.";
    default:
      return "Could not save this change. Check the fields and try again.";
  }
}

/** Require an authoritative reload before retrying unsafe or uncertain writes. */
export function eventNeedsReload(error: unknown): boolean {
  return [
    null,
    "event_not_found",
    "revision_conflict",
    "invalid_event_id",
    "invalid_revision",
    "unauthorized_caller",
    "corrupt_stored_data",
  ].includes(calendarErrorKind(error));
}

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
