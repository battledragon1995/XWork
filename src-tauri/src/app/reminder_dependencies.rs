use crate::{calendar::*, notifications::*, settings::SettingsService};
use std::sync::Arc;
use tauri::{Emitter, Manager, Runtime};
/// Connects reminder consumer ports through capability-owned public APIs only.
pub(crate) struct AppReminderDependencies {
    pub calendar: CalendarService,
    pub notifications: NotificationService,
    pub settings: SettingsService,
}
impl ReminderDependencies for AppReminderDependencies {
    /// Reads current due occurrences without accessing Calendar tables from the adapter.
    fn occurrences(
        &self,
        from: i64,
        through: i64,
    ) -> ReminderFuture<'_, Result<Vec<CalendarReminderOccurrence>, ReminderError>> {
        Box::pin(async move {
            self.calendar
                .reminder_occurrences(from, through, 5000)
                .await
                .map_err(
                    // Sanitizes Calendar errors at the consumer boundary.
                    |_| ReminderError::DependencyUnavailable,
                )
        })
    }
    /// Resolves the exact live occurrence through the Calendar owner.
    fn context<'a>(
        &'a self,
        event: &'a str,
        occurrence: &'a str,
    ) -> ReminderFuture<'a, Result<Option<CalendarNotificationContext>, ReminderError>> {
        Box::pin(async move {
            self.calendar
                .get_notification_context(event, occurrence)
                .await
                .map_err(
                    // Sanitizes Calendar errors at the consumer boundary.
                    |_| ReminderError::DependencyUnavailable,
                )
        })
    }
    /// Reads the last committed notification setting for every scheduling decision.
    fn enabled(&self) -> Result<bool, ReminderError> {
        Ok(self
            .settings
            .snapshot()
            .map_err(
                // Does not expose settings persistence details through Reminder.
                |_| ReminderError::DependencyUnavailable,
            )?
            .notifications
            .event_reminders_enabled)
    }
    /// Delegates stable reminder upsert to the Notifications owner without OS delivery.
    fn upsert(
        &self,
        input: ReminderNotificationInput,
    ) -> ReminderFuture<'_, Result<(), ReminderError>> {
        Box::pin(async move {
            self.notifications.upsert_reminder(input).await.map_err(
                // Converts intake failures into retryable consumer failures.
                |_| ReminderError::DependencyUnavailable,
            )
        })
    }
    /// Delegates idempotent bell cleanup to its owning capability.
    fn remove<'a>(&'a self, id: &'a str) -> ReminderFuture<'a, Result<(), ReminderError>> {
        Box::pin(async move {
            self.notifications.remove_reminder(id).await.map_err(
                // Converts intake failures into retryable consumer failures.
                |_| ReminderError::DependencyUnavailable,
            )
        })
    }
}
pub(crate) struct AppReminderEvents<R: Runtime>(pub tauri::AppHandle<R>);
impl<R: Runtime> ReminderEventSink for AppReminderEvents<R> {
    /// Emits aggregate reminder invalidations only to the authorized main window.
    fn publish(&self, event: ReminderChangedDto) {
        let _ = self.0.emit_to("main", REMINDERS_CHANGED_EVENT, event);
    }
}
pub(crate) struct AppCalendarEvents<R: Runtime>(pub tauri::AppHandle<R>);
impl<R: Runtime> CalendarEventSink for AppCalendarEvents<R> {
    /// Fans out committed Calendar invalidation to both presentation and the scheduler.
    fn emit(&self, event: CalendarChangedEventDto) -> Result<(), CalendarError> {
        if let Some(reminders) = self.0.try_state::<ReminderService>() {
            reminders.observe_calendar_change(event.clone());
        }
        self.0
            .emit_to("main", CALENDAR_CHANGED_EVENT, event)
            .map_err(
                // Sanitizes presentation transport failures after commit.
                |_| CalendarError::StorageUnavailable,
            )
    }
}
/// Composes the scheduler only after Calendar, Settings and Notifications are ready.
pub(crate) fn setup<R: Runtime>(
    app: &tauri::App<R>,
    os: Arc<dyn crate::platform::notification::OsNotification>,
    start_worker: bool,
) -> Result<ReminderService, ReminderError> {
    let settings = app.state::<SettingsService>().inner().clone();
    let reminders = ReminderService::with_seams(
        app.state::<crate::storage::Storage>().inner().clone(),
        app.state::<crate::shared::DataMaintenanceGate>()
            .inner()
            .clone(),
        Arc::new(SystemReminderClock),
        Arc::new(AppReminderDependencies {
            calendar: app.state::<CalendarService>().inner().clone(),
            notifications: app.state::<NotificationService>().inner().clone(),
            settings: settings.clone(),
        }),
        os,
        Arc::new(AppReminderEvents(app.handle().clone())),
    )?;
    let watch = settings.subscribe().map_err(
        // Prevents scheduler startup without a committed settings feed.
        |_| ReminderError::DependencyUnavailable,
    )?;
    if start_worker {
        tauri::async_runtime::block_on(reminders.start(watch));
    } else {
        tauri::async_runtime::block_on(reminders.process_once())?;
    }
    Ok(reminders)
}
