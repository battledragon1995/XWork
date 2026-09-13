use super::*;
use tauri::{Runtime, State, WebviewWindow};
/// Allows reminder commands only from the exact primary window label.
pub fn authorize_reminder_caller(label: &str) -> Result<(), ReminderError> {
    if label == "main" {
        Ok(())
    } else {
        Err(ReminderError::UnauthorizedWindow)
    }
}

/// Authorizes the caller before delegating the narrowly scoped reminder operation.
#[tauri::command]
pub(crate) async fn get_missed_reminders<R: Runtime>(
    cursor: Option<ReminderCursorDto>,
    limit: Option<u16>,
    window: WebviewWindow<R>,
    state: State<'_, ReminderService>,
) -> Result<MissedReminderPageDto, ReminderError> {
    authorize_reminder_caller(window.label())?;
    let service = state.inner().clone();
    service.get_missed_reminders(cursor, limit).await
}

/// Authorizes the caller before delegating the narrowly scoped reminder operation.
#[tauri::command]
pub(crate) async fn get_event_reminder_deliveries<R: Runtime>(
    event_id: String,
    occurrence_id: String,
    window: WebviewWindow<R>,
    state: State<'_, ReminderService>,
) -> Result<EventReminderDeliveriesDto, ReminderError> {
    authorize_reminder_caller(window.label())?;
    let service = state.inner().clone();
    service
        .get_event_reminder_deliveries(event_id, occurrence_id)
        .await
}

/// Authorizes the caller before delegating the narrowly scoped reminder operation.
#[tauri::command]
pub(crate) async fn open_reminder<R: Runtime>(
    delivery_id: String,
    window: WebviewWindow<R>,
    state: State<'_, ReminderService>,
) -> Result<ReminderTargetDto, ReminderError> {
    authorize_reminder_caller(window.label())?;
    let service = state.inner().clone();
    service.open_reminder(&delivery_id).await
}

/// Authorizes the caller before delegating the narrowly scoped reminder operation.
#[tauri::command]
pub(crate) async fn snooze_reminder<R: Runtime>(
    delivery_id: String,
    expected_version: String,
    minutes: u16,
    window: WebviewWindow<R>,
    state: State<'_, ReminderService>,
) -> Result<ReminderActionResultDto, ReminderError> {
    authorize_reminder_caller(window.label())?;
    let service = state.inner().clone();
    service
        .snooze_reminder(&delivery_id, &expected_version, minutes)
        .await
}

/// Authorizes the caller before delegating the narrowly scoped reminder operation.
#[tauri::command]
pub(crate) async fn dismiss_reminder<R: Runtime>(
    delivery_id: String,
    expected_version: String,
    window: WebviewWindow<R>,
    state: State<'_, ReminderService>,
) -> Result<ReminderActionResultDto, ReminderError> {
    authorize_reminder_caller(window.label())?;
    let service = state.inner().clone();
    service
        .dismiss_reminder(&delivery_id, &expected_version)
        .await
}

/// Authorizes the caller before delegating the narrowly scoped reminder operation.
#[tauri::command]
pub(crate) async fn dismiss_all_missed_reminders<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, ReminderService>,
) -> Result<ReminderChangedDto, ReminderError> {
    authorize_reminder_caller(window.label())?;
    let service = state.inner().clone();
    service.dismiss_all_missed_reminders().await
}

/// Authorizes the caller before delegating the narrowly scoped reminder operation.
#[tauri::command]
pub(crate) async fn set_visible_calendar_event<R: Runtime>(
    input: VisibleCalendarEventInputDto,
    window: WebviewWindow<R>,
    state: State<'_, ReminderService>,
) -> Result<(), ReminderError> {
    authorize_reminder_caller(window.label())?;
    let service = state.inner().clone();
    service.set_visible_calendar_event(input).await
}
