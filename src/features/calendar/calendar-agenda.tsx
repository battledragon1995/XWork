import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import {
  formatCalendarDate,
  occurrenceDate,
  occurrenceLabel,
  recurrenceSummary,
  reminderSummary,
} from "./calendar-presentation";
interface Props {
  items: CalendarOccurrenceDto[];
  zone: string;
  upcoming?: boolean;
  disabled?: boolean;
  projectNames?: Record<string, string>;
  onOpen(item: CalendarOccurrenceDto): void;
}
/** Display backend-expanded occurrences in stable order with accessible event controls. */
export function CalendarAgenda({
  items,
  zone,
  upcoming,
  disabled,
  projectNames = {},
  onOpen,
}: Props) {
  if (items.length === 0)
    return (
      <p className="p-4 text-sm text-muted">
        {upcoming ? "No events in the next 14 days" : "No events this day"}
      </p>
    );
  return (
    <ul className="space-y-2">
      {items.map(
        /** Group only server occurrences, never expand recurrence in React. */ (item, index) => {
          const date = occurrenceDate(item, zone);
          return (
            <li key={item.occurrenceId} className="min-w-0">
              {upcoming && (index === 0 || occurrenceDate(items[index - 1], zone) !== date) && (
                <h3 className="mt-3 text-sm font-semibold">{formatCalendarDate(date)}</h3>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={/** Open this exact occurrence. */ () => onOpen(item)}
                className="w-full rounded-lg border border-hairline p-3 text-left outline-none hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block break-words font-medium">{item.title}</span>
                <span className="block text-xs text-muted">{occurrenceLabel(item, zone)}</span>
                {item.projectId && (
                  <span className="block text-xs">
                    Project: {projectNames[item.projectId] ?? "Linked project"}
                  </span>
                )}
                <span className="block text-xs text-muted">
                  {recurrenceSummary(item.recurrence)} · {reminderSummary(item.reminders)}
                </span>
              </button>
            </li>
          );
        },
      )}
    </ul>
  );
}
