import { useRef } from "react";
import type { ReminderDeliveryDto, ReminderTargetDto } from "@/bindings/reminders";
import { Button } from "@/components/ui/button";
import { reminderErrorCode, reminderErrorMessage } from "@/lib/ipc/reminder-error";
import { reminderTime } from "./calendar-presentation";
import type { useMissedReminders } from "./use-missed-reminders";

interface Props {
  reminders: ReturnType<typeof useMissedReminders>;
  projectScoped: boolean;
  onOpen(target: ReminderTargetDto): void;
  onUpcoming?(): void;
}
/** Render global backend-owned Missed rows without inferring scheduling state. */
export function CalendarMissed({ reminders, projectScoped, onOpen, onUpcoming }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { page, loading, pending, error, listenerError } = reminders;
  /** Navigate only validated targets and restore keyboard focus after disappearing rows. */
  async function act(kind: "open" | "dismiss" | "all", row?: ReminderDeliveryDto) {
    const target = await reminders.action(kind, row);
    if (target) onOpen(target);
    else if (kind !== "open") heading.current?.focus();
  }
  const catchingUp = reminderErrorCode(error) === "scheduler_catching_up";
  const disabled = loading || pending || reminders.stale;
  return (
    <section aria-busy={loading || pending} className="space-y-3">
      <h2 ref={heading} tabIndex={-1} className="font-semibold outline-none">
        Missed reminders
      </h2>
      {projectScoped && <p className="text-sm text-muted">Missed reminders across all projects</p>}
      {(loading || catchingUp) && (
        <p role="status">{catchingUp ? "Catching up reminders…" : "Loading missed reminders…"}</p>
      )}
      {error != null && !catchingUp && <p role="alert">{reminderErrorMessage(error)}</p>}
      {reminders.stale && <p role="status">Displayed reminders may be out of date.</p>}
      {listenerError && <p role="alert">Reminder updates are unavailable.</p>}
      {(error != null || listenerError) && (
        <Button variant="outline" disabled={loading || pending} onClick={reminders.retry}>
          Retry
        </Button>
      )}
      {page && (
        <>
          <Button
            variant="outline"
            disabled={disabled || page.missedCount === 0}
            aria-label="Dismiss all missed reminders"
            onClick={
              /** Dismiss every backend Missed row, including unloaded pages. */ () => {
                void act("all");
              }
            }
          >
            Dismiss all missed
          </Button>
          <p className="text-xs text-muted">
            Applies across all projects, including reminders not loaded here.
          </p>
          {page.missedCount === 0 && !catchingUp && (
            <>
              <p>No missed reminders</p>
              <p className="text-sm text-muted">
                Reminders that became due while XWork was quit appear here when you reopen it.
              </p>
              {onUpcoming && (
                <Button variant="outline" onClick={onUpcoming}>
                  View upcoming events
                </Button>
              )}
            </>
          )}
          <ul className="space-y-3">
            {page.items.map(
              /** Keep opaque delivery identity for each action. */ (row) => (
                <li key={row.id} className="space-y-1 rounded border border-border p-3">
                  <h3 className="break-words font-medium">{row.title}</h3>
                  <p className="text-xs text-muted">
                    Due: {reminderTime(row.originalDueAtMs, row.timeZoneId)}
                  </p>
                  <p className="text-xs text-muted">
                    Event: {reminderTime(row.startsAtMs, row.timeZoneId)}
                  </p>
                  <p className="text-xs text-muted">
                    {row.minutesBefore === 0 ? "At start" : `${row.minutesBefore} minutes before`}
                    {row.projectId ? " · Project linked" : ""}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={
                        /** Open without marking the delivery dismissed. */ () => {
                          void act("open", row);
                        }
                      }
                    >
                      Open event
                    </Button>
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={
                        /** Submit the exact observed delivery version. */ () => {
                          void act("dismiss", row);
                        }
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
          {page.nextCursor && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={
                /** Fetch one explicit continuation page. */ () => {
                  void reminders.loadMore();
                }
              }
            >
              Load more
            </Button>
          )}
        </>
      )}
    </section>
  );
}
