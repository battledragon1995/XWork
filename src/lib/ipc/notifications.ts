import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  NotificationCenterChangedDto,
  NotificationCenterStateDto,
  NotificationCursorDto,
  NotificationError,
  NotificationPageDto,
  OpenNotificationDto,
} from "@/bindings/notifications/notifications";
import { invokeCommand } from "./ipc-error";

/** Reads one opaque cursor page without converting decimal strings. */
export function getNotifications(
  cursor: NotificationCursorDto | null,
  limit: number,
): Promise<NotificationPageDto> {
  return invokeCommand<NotificationPageDto, NotificationError>("get_notifications", {
    cursor,
    limit,
  });
}
/** Marks one notification read. */
export function markNotificationRead(notificationId: string): Promise<NotificationCenterStateDto> {
  return invokeCommand<NotificationCenterStateDto, NotificationError>("mark_notification_read", {
    notificationId,
  });
}
/** Marks the entire backend inbox read, including unloaded rows. */
export function markAllNotificationsRead(): Promise<NotificationCenterStateDto> {
  return invokeCommand<NotificationCenterStateDto, NotificationError>(
    "mark_all_notifications_read",
  );
}
/** Deletes one notification without affecting its session. */
export function deleteNotification(notificationId: string): Promise<NotificationCenterStateDto> {
  return invokeCommand<NotificationCenterStateDto, NotificationError>("delete_notification", {
    notificationId,
  });
}
/** Deletes all read records from the backend inbox. */
export function clearReadNotifications(): Promise<NotificationCenterStateDto> {
  return invokeCommand<NotificationCenterStateDto, NotificationError>("clear_read_notifications");
}
/** Validates the live target and commits read state before navigation. */
export function openNotification(notificationId: string): Promise<OpenNotificationDto> {
  return invokeCommand<OpenNotificationDto, NotificationError>("open_notification", {
    notificationId,
  });
}
/** Owns a typed listener whose cleanup remains with the mounted consumer. */
export function onNotificationsChanged(
  callback: (payload: NotificationCenterChangedDto) => void,
): Promise<UnlistenFn> {
  // Strip the Tauri envelope at the IPC boundary.
  return listen<NotificationCenterChangedDto>("notifications://changed", (event) =>
    callback(event.payload),
  );
}
