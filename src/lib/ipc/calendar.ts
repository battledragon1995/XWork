import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CalendarChangedEventDto,
  CalendarError,
  CalendarEventDto,
  CalendarOccurrenceListDto,
  CalendarRangeInputDto,
  EventInputDto,
  UpdateCalendarEventInputDto,
  EventRevisionInputDto,
  DeleteCalendarEventImpactDto,
  ConfirmDeleteCalendarEventInputDto,
  DeletedCalendarEventDto,
} from "@/bindings/calendar";
import { invokeCommand } from "./ipc-error";

/** Create one definition and return its committed snapshot. */
export function createCalendarEvent(input: EventInputDto) {
  return invokeCommand<CalendarEventDto, CalendarError>("create_calendar_event", { input });
}

/** Update the whole definition using an opaque expected revision. */
export function updateCalendarEvent(input: UpdateCalendarEventInputDto) {
  return invokeCommand<CalendarEventDto, CalendarError>("update_calendar_event", { input });
}

/** Read a caller-bound deletion preview before requesting confirmation. */
export function prepareDeleteCalendarEvent(input: EventRevisionInputDto) {
  return invokeCommand<DeleteCalendarEventImpactDto, CalendarError>(
    "prepare_delete_calendar_event",
    { input },
  );
}

/** Confirm only the reviewed backend-issued deletion request. */
export function confirmDeleteCalendarEvent(input: ConfirmDeleteCalendarEventInputDto) {
  return invokeCommand<DeletedCalendarEventDto, CalendarError>("confirm_delete_calendar_event", {
    input,
  });
}

/** Read a bounded occurrence snapshot expanded by Rust. */
export function listCalendarOccurrences(input: CalendarRangeInputDto) {
  return invokeCommand<CalendarOccurrenceListDto, CalendarError>("list_calendar_occurrences", {
    input,
  });
}

/** Read one authoritative event independently of visible ranges. */
export function getCalendarEvent(eventId: string) {
  return invokeCommand<CalendarEventDto, CalendarError>("get_calendar_event", { eventId });
}

/** Forward Calendar invalidations without exposing native envelopes. */
export function onCalendarChanged(
  handler: (event: CalendarChangedEventDto) => void,
): Promise<UnlistenFn> {
  return listen<CalendarChangedEventDto>(
    "calendar://changed",
    /** Forward the committed payload. */ (event) => handler(event.payload),
  );
}
