import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EventReminderDeliveriesDto,
  MissedReminderPageDto,
  ReminderActionResultDto,
  ReminderChangedDto,
  ReminderCursorDto,
  ReminderError,
  ReminderTargetDto,
  VisibleCalendarEventInputDto,
} from "@/bindings/reminders";
import { invokeCommand } from "./ipc-error";

/** Reads one authoritative global Missed page with opaque decimal cursors. */
export function getMissedReminders(
  cursor: ReminderCursorDto | null,
  limit = 30,
): Promise<MissedReminderPageDto> {
  return invokeCommand<MissedReminderPageDto, ReminderError>("get_missed_reminders", {
    cursor,
    limit,
  });
}
/** Reads delivery state for the exact backend occurrence. */
export function getEventReminderDeliveries(
  eventId: string,
  occurrenceId: string,
): Promise<EventReminderDeliveriesDto> {
  return invokeCommand<EventReminderDeliveriesDto, ReminderError>("get_event_reminder_deliveries", {
    eventId,
    occurrenceId,
  });
}
/** Validates a reminder target without dismissing or marking it read. */
export function openReminder(deliveryId: string): Promise<ReminderTargetDto> {
  return invokeCommand<ReminderTargetDto, ReminderError>("open_reminder", { deliveryId });
}
/** Snoozes an active delivery using its current optimistic version. */
export function snoozeReminder(
  deliveryId: string,
  expectedVersion: string,
  minutes: 5 | 10 | 30,
): Promise<ReminderActionResultDto> {
  return invokeCommand<ReminderActionResultDto, ReminderError>("snooze_reminder", {
    deliveryId,
    expectedVersion,
    minutes,
  });
}
/** Dismisses one delivery independently from notification read/delete state. */
export function dismissReminder(
  deliveryId: string,
  expectedVersion: string,
): Promise<ReminderActionResultDto> {
  return invokeCommand<ReminderActionResultDto, ReminderError>("dismiss_reminder", {
    deliveryId,
    expectedVersion,
  });
}
/** Dismisses all backend Missed rows, including unloaded pages. */
export function dismissAllMissedReminders(): Promise<ReminderChangedDto> {
  return invokeCommand<ReminderChangedDto, ReminderError>("dismiss_all_missed_reminders");
}
/** Reports token-owned event visibility without scheduling in the frontend. */
export function setVisibleCalendarEvent(input: VisibleCalendarEventInputDto): Promise<void> {
  return invokeCommand<void, ReminderError>("set_visible_calendar_event", { input });
}
/** Unwraps reminder invalidations while leaving subscription ownership to the caller. */
export function onRemindersChanged(
  callback: (payload: ReminderChangedDto) => void,
): Promise<UnlistenFn> {
  // Strip the native event envelope at the shared IPC boundary.
  return listen<ReminderChangedDto>("reminders://changed", (event) => callback(event.payload));
}
