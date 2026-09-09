import type {
  CalendarEventDto,
  CalendarWeekdayDto,
  EventInputDto,
  EventRecurrenceDto,
} from "@/bindings/calendar";
import { addDays, isValidDate } from "./calendar-presentation";

export interface EventFormDraft {
  title: string;
  description: string;
  projectId: string | null;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timeZoneId: string;
  recurrence: EventRecurrenceDto;
  reminderMinutes: string[];
}
export type EventFieldErrors = Partial<Record<keyof EventFormDraft, string>>;
export const WEEKDAYS: CalendarWeekdayDto[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Prefill a temporary event without resolving timezone offsets in JavaScript. */
export function newEventDraft(
  date: string,
  projectId: string | null,
  timeZoneId: string,
): EventFormDraft {
  return {
    title: "",
    description: "",
    projectId,
    allDay: false,
    startDate: date,
    endDate: date,
    startTime: "09:00",
    endTime: "10:00",
    timeZoneId,
    recurrence: { kind: "none" },
    reminderMinutes: ["10"],
  };
}

/** Edit the base definition, omitting caches, reminder IDs and opaque revision. */
export function eventDraft(event: CalendarEventDto): EventFormDraft {
  const time = event.time;
  return {
    ...newEventDraft(
      time.kind === "all_day" ? time.startDate : time.startLocal.slice(0, 10),
      event.projectId,
      time.timeZoneId,
    ),
    title: event.title,
    description: event.description,
    allDay: time.kind === "all_day",
    endDate:
      time.kind === "all_day" ? addDays(time.endDateExclusive, -1) : time.endLocal.slice(0, 10),
    startTime: time.kind === "timed" ? time.startLocal.slice(11) : "09:00",
    endTime: time.kind === "timed" ? time.endLocal.slice(11) : "10:00",
    recurrence: event.recurrence,
    reminderMinutes: event.reminders.map(
      /** Keep only editable offsets. */ (reminder) => String(reminder.minutesBefore),
    ),
  };
}

/** Resolve only the Gregorian weekday used to initialize weekly controls. */
export function startWeekday(date: string): CalendarWeekdayDto {
  return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "monday";
}

/** Validate presentation values while Rust remains the final business validator. */
export function validateEventDraft(draft: EventFormDraft): EventFieldErrors {
  const errors: EventFieldErrors = {};
  if (
    !draft.title.trim() ||
    [...draft.title.trim()].length > 200 ||
    [...draft.title].some(
      /** Reject Unicode control characters in titles. */ (character) => /\p{Cc}/u.test(character),
    )
  )
    errors.title = "Enter a title of 1–200 characters without control characters.";
  if (
    [...draft.description].length > 20_000 ||
    [...draft.description].some(
      /** Permit only tab and newline among description controls. */ (character) =>
        /\p{Cc}/u.test(character) && character !== "\n" && character !== "\t",
    )
  )
    errors.description = "Use at most 20,000 characters without control characters.";
  if (!isValidDate(draft.startDate)) errors.startDate = "Choose a valid start date (1900–9999).";
  if (!isValidDate(draft.endDate) || (draft.allDay && draft.endDate === "9999-12-31"))
    errors.endDate = "Choose a valid last day with a supported following date.";
  if (draft.allDay) {
    if (draft.endDate < draft.startDate) errors.endDate = "Last day must not precede Starts.";
  } else {
    if (
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(draft.startTime) ||
      !Number.isFinite(Date.parse(`${draft.startDate}T${draft.startTime}Z`))
    )
      errors.startTime = "Choose a valid start time.";
    if (
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(draft.endTime) ||
      !Number.isFinite(Date.parse(`${draft.endDate}T${draft.endTime}Z`))
    )
      errors.endTime = "Choose a valid end time.";
    if (`${draft.endDate}T${draft.endTime}` <= `${draft.startDate}T${draft.startTime}`)
      errors.endTime = "Ends must be after Starts.";
  }
  if (!draft.timeZoneId.trim()) errors.timeZoneId = "Enter a time zone, for example UTC.";
  const recurrence = draft.recurrence;
  if (recurrence.kind !== "none") {
    if (
      recurrence.kind === "weekly" &&
      !recurrence.weekdays.includes(startWeekday(draft.startDate))
    )
      errors.recurrence = "Select the weekday of Starts.";
    if (
      recurrence.end.kind === "on_date" &&
      (!isValidDate(recurrence.end.date) || recurrence.end.date < draft.startDate)
    )
      errors.recurrence = "Repeat end date must be on or after Starts.";
    if (
      recurrence.end.kind === "after_count" &&
      (!Number.isInteger(recurrence.end.count) ||
        recurrence.end.count < 1 ||
        recurrence.end.count > 10_000)
    )
      errors.recurrence = "Use an occurrence count from 1 to 10,000.";
  }
  const minutes = draft.reminderMinutes.map(
    /** Validate numeric offsets without accepting blank input. */ (value) =>
      /^\d+$/.test(value) ? Number(value) : NaN,
  );
  if (
    minutes.length > 16 ||
    minutes.some(
      /** Bound each configured offset. */ (value) =>
        !Number.isInteger(value) || value < 0 || value > 525_600,
    ) ||
    new Set(minutes).size !== minutes.length
  )
    errors.reminderMinutes = "Use up to 16 distinct whole-minute offsets from 0 to 525,600.";
  return errors;
}

/** Produce the exact tagged input after successful presentation validation. */
export function eventInput(draft: EventFormDraft): EventInputDto {
  return {
    title: draft.title.trim(),
    description: draft.description,
    projectId: draft.projectId,
    time: draft.allDay
      ? {
          kind: "all_day",
          startDate: draft.startDate,
          endDateExclusive: addDays(draft.endDate, 1),
          timeZoneId: draft.timeZoneId.trim(),
        }
      : {
          kind: "timed",
          startLocal: `${draft.startDate}T${draft.startTime.length === 5 ? `${draft.startTime}:00` : draft.startTime}`,
          endLocal: `${draft.endDate}T${draft.endTime.length === 5 ? `${draft.endTime}:00` : draft.endTime}`,
          timeZoneId: draft.timeZoneId.trim(),
        },
    recurrence: draft.recurrence,
    reminderMinutesBefore: draft.reminderMinutes.map(
      /** Map validated integer strings. */ (value) => Number(value),
    ),
  };
}
