import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CalendarChangedEventDto,
  CalendarError,
  CalendarEventDto,
  CalendarOccurrenceListDto,
  CalendarRangeInputDto,
} from "@/bindings/calendar";
import { invokeCommand } from "./ipc-error";

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
