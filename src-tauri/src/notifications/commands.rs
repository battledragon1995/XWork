use super::*;
use tauri::{Runtime, State, WebviewWindow};

/// Rejects non-main windows before validation or owner access.
fn authorize(label: &str) -> Result<(), NotificationError> {
    if label == "main" {
        Ok(())
    } else {
        Err(NotificationError::UnauthorizedWindow)
    }
}
/// Clones the owner so no managed state borrow crosses an await.
fn take(state: State<'_, NotificationService>) -> NotificationService {
    state.inner().clone()
}

/// Lists a bounded notification page and current unread count.
#[tauri::command]
pub async fn get_notifications<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NotificationService>,
    cursor: Option<NotificationCursorDto>,
    limit: Option<u16>,
) -> Result<NotificationPageDto, NotificationError> {
    authorize(window.label())?;
    take(state).get_notifications(cursor, limit).await
}
/// Marks one notification read without removing its row.
#[tauri::command]
pub async fn mark_notification_read<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NotificationService>,
    notification_id: String,
) -> Result<NotificationCenterStateDto, NotificationError> {
    authorize(window.label())?;
    take(state).mark_notification_read(&notification_id).await
}
/// Marks all current unread rows in one transaction.
#[tauri::command]
pub async fn mark_all_notifications_read<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NotificationService>,
) -> Result<NotificationCenterStateDto, NotificationError> {
    authorize(window.label())?;
    take(state).mark_all_notifications_read().await
}
/// Deletes one notification without acting on its target.
#[tauri::command]
pub async fn delete_notification<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NotificationService>,
    notification_id: String,
) -> Result<NotificationCenterStateDto, NotificationError> {
    authorize(window.label())?;
    take(state).delete_notification(&notification_id).await
}
/// Clears only read rows and preserves unread items.
#[tauri::command]
pub async fn clear_read_notifications<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NotificationService>,
) -> Result<NotificationCenterStateDto, NotificationError> {
    authorize(window.label())?;
    take(state).clear_read_notifications().await
}
/// Validates a live target and marks its notification read before returning it.
#[tauri::command]
pub async fn open_notification<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, NotificationService>,
    notification_id: String,
) -> Result<OpenNotificationDto, NotificationError> {
    authorize(window.label())?;
    take(state).open_notification(&notification_id).await
}
