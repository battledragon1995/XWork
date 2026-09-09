use super::*;
use tauri::{Runtime, State, WebviewWindow};
/// Authorizes Calendar access exclusively from the primary application window.
pub fn authorize_calendar_caller(label: &str) -> Result<(), CalendarError> {
    if label == "main" {
        Ok(())
    } else {
        Err(CalendarError::UnauthorizedCaller)
    }
}
/// Authorizes the window before delegating the narrow Calendar operation.
#[tauri::command]
pub(crate) async fn list_calendar_occurrences<R: Runtime>(
    input: CalendarRangeInputDto,
    window: WebviewWindow<R>,
    state: State<'_, CalendarService>,
) -> Result<CalendarOccurrenceListDto, CalendarError> {
    authorize_calendar_caller(window.label())?;
    let service = state.inner().clone();
    service.list_calendar_occurrences(input).await
}
/// Authorizes the window before delegating the narrow Calendar operation.
#[tauri::command]
pub(crate) async fn create_calendar_event<R: Runtime>(
    input: EventInputDto,
    window: WebviewWindow<R>,
    state: State<'_, CalendarService>,
) -> Result<CalendarEventDto, CalendarError> {
    authorize_calendar_caller(window.label())?;
    let service = state.inner().clone();
    service.create_calendar_event(input).await
}
/// Authorizes the window before delegating the narrow Calendar operation.
#[tauri::command]
pub(crate) async fn update_calendar_event<R: Runtime>(
    input: UpdateCalendarEventInputDto,
    window: WebviewWindow<R>,
    state: State<'_, CalendarService>,
) -> Result<CalendarEventDto, CalendarError> {
    authorize_calendar_caller(window.label())?;
    let service = state.inner().clone();
    service.update_calendar_event(input).await
}
/// Authorizes the window before delegating the narrow Calendar operation.
#[tauri::command]
pub(crate) async fn prepare_delete_calendar_event<R: Runtime>(
    input: EventRevisionInputDto,
    window: WebviewWindow<R>,
    state: State<'_, CalendarService>,
) -> Result<DeleteCalendarEventImpactDto, CalendarError> {
    authorize_calendar_caller(window.label())?;
    let service = state.inner().clone();
    service.prepare_delete_calendar_event(input).await
}
/// Authorizes the window before delegating the narrow Calendar operation.
#[tauri::command]
pub(crate) async fn confirm_delete_calendar_event<R: Runtime>(
    input: ConfirmDeleteCalendarEventInputDto,
    window: WebviewWindow<R>,
    state: State<'_, CalendarService>,
) -> Result<DeletedCalendarEventDto, CalendarError> {
    authorize_calendar_caller(window.label())?;
    let service = state.inner().clone();
    service.confirm_delete_calendar_event(input).await
}
/// Authorizes the window before reading one complete definition.
#[tauri::command]
pub(crate) async fn get_calendar_event<R: Runtime>(
    event_id: String,
    window: WebviewWindow<R>,
    state: State<'_, CalendarService>,
) -> Result<CalendarEventDto, CalendarError> {
    authorize_calendar_caller(window.label())?;
    let service = state.inner().clone();
    service.get_calendar_event(event_id).await
}
