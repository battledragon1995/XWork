import type {
  CalendarOccurrenceDto,
  CalendarRangeInputDto,
  EventRecurrenceDto,
  EventReminderDto,
} from "@/bindings/calendar";

const MIN_DATE = "1900-01-01";
const MAX_DATE = "9999-12-31";

/** Use UTC only as a Gregorian arithmetic coordinate, never a viewer conversion. */
function dateCoordinate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Clamp navigation to the backend's supported date domain. */
function coordinateDate(date: Date): string {
  if (date.getTime() <= dateCoordinate(MIN_DATE).getTime()) return MIN_DATE;
  if (date.getTime() >= dateCoordinate(MAX_DATE).getTime()) return MAX_DATE;
  return date.toISOString().slice(0, 10);
}

/** Validate a strict Gregorian date without local timezone interpretation. */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < MIN_DATE || date > MAX_DATE) return false;
  const value = dateCoordinate(date);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

/** Move a date by whole calendar days with supported-year clamping. */
export function addDays(date: string, days: number): string {
  const value = dateCoordinate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return coordinateDate(value);
}

/** Move months while preserving the day where that month permits it. */
export function shiftMonth(date: string, months: number): string {
  const value = dateCoordinate(date);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const last = new Date(value.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  value.setUTCDate(Math.min(day, last.getUTCDate()));
  return coordinateDate(value);
}

/** Build Monday-first weeks, trimming only unsupported boundary dates. */
export function monthGrid(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`;
  const value = dateCoordinate(first);
  const offset = (value.getUTCDay() + 6) % 7;
  const last = new Date(value.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const count = Math.max(35, Math.ceil((offset + last.getUTCDate()) / 7) * 7);
  const dates: string[] = [];
  for (let index = 0; index < count; index++) {
    const candidate = new Date(value.getTime() + (index - offset) * 86_400_000);
    if (candidate.getUTCFullYear() >= 1900 && candidate.getUTCFullYear() <= 9999)
      dates.push(coordinateDate(candidate));
  }
  return dates;
}

/** Construct a normal, half-open Calendar read. */
export function calendarRange(
  startDate: string,
  days: number,
  viewerTimeZoneId: string,
  projectId: string | null = null,
): CalendarRangeInputDto {
  return {
    startDate,
    endDateExclusive: addDays(startDate, days),
    viewerTimeZoneId,
    projectId,
    onlyWithReminders: false,
  };
}

/** Obtain the viewer zone while retaining UTC as the missing-value fallback. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Read a viewer date from an epoch using stable numeric date parts. */
function epochDate(epoch: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(epoch);
  /** Extract one numeric Gregorian component. */
  const part = (type: string) =>
    parts.find(/** Match the requested component. */ (item) => item.type === type)?.value;
  return `${part("year")?.padStart(4, "0")}-${part("month")}-${part("day")}`;
}

/** Compute today in the current viewer timezone. */
export function todayDate(zone: string): string {
  return epochDate(Date.now(), zone);
}

/** Format date-only values without shifting their calendar day. */
export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full" }).format(
    dateCoordinate(date),
  );
}

/** Format the visible month heading. */
export function formatCalendarMonth(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(dateCoordinate(date));
}

/** Group backend occurrences by their viewer start date. */
export function occurrenceDate(item: CalendarOccurrenceDto, zone: string): string {
  return item.time.kind === "all_day" ? item.time.startDate : epochDate(item.time.startAtMs, zone);
}

/** Select already-expanded occurrences for month cells without expanding recurrence. */
export function occurrencesForDate(
  items: CalendarOccurrenceDto[],
  date: string,
  zone: string,
): CalendarOccurrenceDto[] {
  return items.filter(
    /** All-day intervals cover each included date; timed chips use their start. */ (item) =>
      item.time.kind === "all_day"
        ? item.time.startDate <= date && date < item.time.endDateExclusive
        : occurrenceDate(item, zone) === date,
  );
}

/** Label whole-day intervals and timed overlap without relying on the event's base date. */
export function occurrenceLabel(item: CalendarOccurrenceDto, zone: string): string {
  const time = item.time;
  if (time.kind === "all_day")
    return addDays(time.startDate, 1) === time.endDateExclusive
      ? "All day"
      : `All day · ${time.startDate} – ${addDays(time.endDateExclusive, -1)}`;
  const crossDay = epochDate(time.startAtMs, zone) !== epochDate(time.endAtMs, zone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    ...(crossDay ? ({ month: "short", day: "numeric" } as const) : {}),
  });
  return `${formatter.format(time.startAtMs)} – ${formatter.format(time.endAtMs)}`;
}

/** Describe recurrence definitions without generating occurrences. */
export function recurrenceSummary(recurrence: EventRecurrenceDto): string {
  if (recurrence.kind === "none") return "Does not repeat";
  const frequency = recurrence.kind[0].toUpperCase() + recurrence.kind.slice(1);
  const weekdays = recurrence.kind === "weekly" ? ` · ${recurrence.weekdays.join(", ")}` : "";
  const end =
    recurrence.end.kind === "never"
      ? ""
      : recurrence.end.kind === "on_date"
        ? ` · until ${recurrence.end.date}`
        : ` · ${recurrence.end.count} occurrences`;
  return frequency + weekdays + end;
}

/** Describe reminder definitions without claiming delivery status. */
export function reminderSummary(reminders: EventReminderDto[]): string {
  return reminders.length === 0
    ? "No reminders"
    : reminders
        .map(
          /** Label each configured offset. */ (reminder) =>
            reminder.minutesBefore === 0 ? "At start" : `${reminder.minutesBefore} minutes before`,
        )
        .join(", ");
}
