import type { CalendarOccurrenceDto } from "@/bindings/calendar";
import { addDays, monthGrid, occurrencesForDate, shiftMonth } from "./calendar-presentation";

interface Props {
  month: string;
  selectedDate: string;
  today: string;
  items: CalendarOccurrenceDto[];
  zone: string;
  disabled?: boolean;
  onSelect(date: string): void;
  onOpen(item: CalendarOccurrenceDto): void;
}
/** Render a Monday-first month with sibling date and event controls. */
export function CalendarMonth({
  month,
  selectedDate,
  today,
  items,
  zone,
  disabled,
  onSelect,
  onOpen,
}: Props) {
  const days = monthGrid(month);
  /** Move the roving date control without activating an event. */
  function move(event: React.KeyboardEvent<HTMLButtonElement>, date: string) {
    let next: string;
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    switch (event.key) {
      case "ArrowLeft":
        next = addDays(date, -1);
        break;
      case "ArrowRight":
        next = addDays(date, 1);
        break;
      case "ArrowUp":
        next = addDays(date, -7);
        break;
      case "ArrowDown":
        next = addDays(date, 7);
        break;
      case "Home":
        next = addDays(date, -weekday);
        break;
      case "End":
        next = addDays(date, 6 - weekday);
        break;
      case "PageUp":
        next = shiftMonth(date, -1);
        break;
      case "PageDown":
        next = shiftMonth(date, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    onSelect(next);
    requestAnimationFrame(
      /** Focus after the newly selected month renders. */ () =>
        document.querySelector<HTMLButtonElement>(`[data-calendar-date="${next}"]`)?.focus(),
    );
  }
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-7 border-x border-t border-hairline py-2 text-center text-[11px] text-muted uppercase">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
          /** Label weekdays without extra focus stops. */ (day) => (
            <span key={day}>{day}</span>
          ),
        )}
      </div>
      <div className="grid grid-cols-7 border-t border-l border-hairline">
        {days.map(
          /** Keep all occurrences reachable from their day agenda. */ (date) => {
            const events = occurrencesForDate(items, date, zone);
            return (
              <div
                key={date}
                className={`min-h-22 min-w-0 border-r border-b border-hairline p-1 ${date === selectedDate ? "bg-cream-strong" : date.slice(0, 7) !== month.slice(0, 7) ? "bg-surface-soft text-muted" : ""}`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  data-calendar-date={date}
                  tabIndex={date === selectedDate ? 0 : -1}
                  aria-label={`${date}${date === today ? ", today" : ""}`}
                  aria-pressed={date === selectedDate}
                  aria-current={date === today ? "date" : undefined}
                  onClick={/** Select the agenda date. */ () => onSelect(date)}
                  onKeyDown={/** Route date navigation keys. */ (event) => move(event, date)}
                  className="flex size-6 items-center justify-center rounded-full text-xs outline-none aria-[current=date]:bg-ink aria-[current=date]:text-canvas focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {Number(date.slice(8))}
                </button>
                {events.slice(0, 3).map(
                  /** Open an occurrence without nesting interactive controls. */ (item) => (
                    <button
                      type="button"
                      disabled={disabled}
                      key={item.occurrenceId}
                      onClick={/** Preserve the server occurrence context. */ () => onOpen(item)}
                      className={`block w-full truncate rounded px-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.time.kind === "all_day" ? "bg-surface-soft" : ""}`}
                      title={item.title}
                    >
                      {item.time.kind === "all_day" ? "All day · " : ""}
                      {item.title}
                      {item.projectId ? " · Project" : ""}
                    </button>
                  ),
                )}
                {events.length > 3 && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={
                      /** Reveal every occurrence in the date agenda. */ () => onSelect(date)
                    }
                    className="text-xs underline"
                  >
                    +{events.length - 3} more
                  </button>
                )}
              </div>
            );
          },
        )}
      </div>
      <section
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted"
        aria-label="Calendar legend"
      >
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full bg-ink" />
          Today
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-cream-strong" />
          Selected day / all-day event
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-ink" />
          Linked to a project
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-error/10" />
          Missed reminder
        </span>
      </section>
    </div>
  );
}
