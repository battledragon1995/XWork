use super::{
    CalendarChangedEventDto, CalendarNotificationContext, CalendarReminderOccurrence,
    reminder_models::*, reminder_repository as repo,
};
use crate::{
    notifications::ReminderNotificationInput, platform::notification::OsNotification,
    shared::DataMaintenanceGate, storage::Storage,
};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tokio::sync::{Mutex as AsyncMutex, Notify, watch};

pub const REMINDERS_CHANGED_EVENT: &str = "reminders://changed";
pub type ReminderFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub trait ReminderClock: Send + Sync {
    /// Returns the current UTC instant, substitutable by an isolated controlled clock.
    fn now_ms(&self) -> i64;
    /// Waits until the wall-clock instant or a controlled-clock advancement.
    fn sleep_until<'a>(&'a self, instant_ms: i64) -> ReminderFuture<'a, ()>;
}
pub struct SystemReminderClock;
impl ReminderClock for SystemReminderClock {
    /// Reads UTC without relying on OS timezone configuration.
    fn now_ms(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
    /// Maps a wall-clock deadline to a bounded Tokio timer.
    fn sleep_until<'a>(&'a self, instant_ms: i64) -> ReminderFuture<'a, ()> {
        Box::pin(async move {
            tokio::time::sleep(std::time::Duration::from_millis(
                instant_ms.saturating_sub(self.now_ms()).max(0) as u64,
            ))
            .await;
        })
    }
}
pub trait ReminderDependencies: Send + Sync {
    /// Enumerates only the public Calendar due projection.
    fn occurrences(
        &self,
        from: i64,
        through: i64,
    ) -> ReminderFuture<'_, Result<Vec<CalendarReminderOccurrence>, ReminderError>>;
    /// Resolves current occurrence definitions for validation and reconciliation.
    fn context<'a>(
        &'a self,
        event: &'a str,
        occurrence: &'a str,
    ) -> ReminderFuture<'a, Result<Option<CalendarNotificationContext>, ReminderError>>;
    /// Reads committed notification policy for each delivery decision.
    fn enabled(&self) -> Result<bool, ReminderError>;
    /// Idempotently syncs one durable bell generation without dispatching OS notifications.
    fn upsert(
        &self,
        input: ReminderNotificationInput,
    ) -> ReminderFuture<'_, Result<(), ReminderError>>;
    /// Removes one reminder-owned inbox row idempotently.
    fn remove<'a>(&'a self, id: &'a str) -> ReminderFuture<'a, Result<(), ReminderError>>;
}
pub trait ReminderEventSink: Send + Sync {
    /// Publishes a committed aggregate invalidation without user content.
    fn publish(&self, event: ReminderChangedDto);
}
type VisibleDetail = (String, String, Option<String>);
pub(crate) struct Inner {
    pub storage: Storage,
    pub maintenance: DataMaintenanceGate,
    pub clock: Arc<dyn ReminderClock>,
    pub dependencies: Arc<dyn ReminderDependencies>,
    pub os: Arc<dyn OsNotification>,
    pub events: Arc<dyn ReminderEventSink>,
    pub gate: AsyncMutex<()>,
    pub sequence: AtomicU64,
    pub ready: AtomicBool,
    pub paused: AtomicBool,
    pub stopped: AtomicBool,
    pub wake: Notify,
    pub stop_signal: Notify,
    pub worker: AsyncMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub running: AsyncMutex<()>,
    pub visible: Mutex<(bool, Option<VisibleDetail>)>,
    pub startup_boundary: i64,
}
#[derive(Clone)]
pub struct ReminderService {
    pub(crate) inner: Arc<Inner>,
}
pub struct ReminderResetPlan {
    pub baseline_ms: i64,
    pub delivery_count: u32,
    next_sequence: u64,
}
pub struct ReminderResetProjection {
    pub baseline_ms: i64,
    pub removed_delivery_count: u32,
    next_sequence: u64,
}
impl ReminderService {
    /// Constructs isolated collaborators and validates startup state before exposing readiness.
    pub fn with_seams(
        storage: Storage,
        maintenance: DataMaintenanceGate,
        clock: Arc<dyn ReminderClock>,
        dependencies: Arc<dyn ReminderDependencies>,
        os: Arc<dyn OsNotification>,
        events: Arc<dyn ReminderEventSink>,
    ) -> Result<Self, ReminderError> {
        let now = clock.now_ms();
        if now < 0 {
            return Err(ReminderError::ClockOutOfRange);
        }
        storage.with_transaction::<_, ReminderError>(
            // Establishes a first-run baseline without backfilling historical definitions.
            |tx| {
                if repo::checkpoint(tx)?.is_none() {
                    tx.execute(
                        "UPDATE reminder_scheduler_state SET scan_through_ms=?1,updated_at_ms=?1",
                        [now],
                    )?;
                }
                repo::list(tx, "", [])?;
                Ok(())
            },
        )?;
        Ok(Self {
            inner: Arc::new(Inner {
                storage,
                maintenance,
                clock,
                dependencies,
                os,
                events,
                gate: AsyncMutex::new(()),
                sequence: AtomicU64::new(0),
                ready: AtomicBool::new(false),
                paused: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                wake: Notify::new(),
                stop_signal: Notify::new(),
                worker: AsyncMutex::new(None),
                running: AsyncMutex::new(()),
                visible: Mutex::new((true, None)),
                startup_boundary: now,
            }),
        })
    }
    /// Returns an admission error while recovery or application shutdown is in progress.
    pub(crate) fn ready(&self) -> Result<(), ReminderError> {
        if self.inner.stopped.load(Ordering::Acquire) || self.inner.paused.load(Ordering::Acquire) {
            return Err(ReminderError::Unavailable);
        }
        if !self.inner.ready.load(Ordering::Acquire) {
            return Err(ReminderError::SchedulerCatchingUp);
        }
        Ok(())
    }
    /// Returns one aggregate projection under the caller's existing mutation gate.
    pub(crate) fn state(&self) -> Result<ReminderChangedDto, ReminderError> {
        Ok(ReminderChangedDto {
            sequence: self.inner.sequence.load(Ordering::Acquire).to_string(),
            missed_count: self.inner.storage.with_connection(repo::missed)?,
        })
    }
    /// Publishes exactly one aggregate event after a user-visible transaction commits.
    pub(crate) fn changed(&self, affected: usize) -> Result<(), ReminderError> {
        if affected > 0 {
            self.inner.sequence.fetch_add(1, Ordering::AcqRel);
            self.inner.events.publish(self.state()?);
        }
        Ok(())
    }
    /// Resolves current owner facts without retaining Reminder or Storage locks.
    pub(crate) async fn context_for(
        &self,
        row: &repo::Delivery,
    ) -> Result<CalendarNotificationContext, ReminderError> {
        let context = self
            .inner
            .dependencies
            .context(&row.dto.event_id, &row.dto.occurrence_id)
            .await?
            .ok_or(ReminderError::TargetUnavailable)?;
        if !context.reminder_definitions.iter().any(
            // A removed or changed definition invalidates the old occurrence identity.
            |d| d.reminder_id == row.reminder_id && d.minutes_before == row.dto.minutes_before,
        ) || context.starts_at_ms.to_string() != row.dto.starts_at_ms
        {
            return Err(ReminderError::TargetUnavailable);
        }
        Ok(context)
    }
    /// Lists the bounded descending keyset page and its linearized global missed count.
    pub async fn get_missed_reminders(
        &self,
        cursor: Option<ReminderCursorDto>,
        limit: Option<u16>,
    ) -> Result<MissedReminderPageDto, ReminderError> {
        let limit = limit.unwrap_or(30);
        if !(1..=100).contains(&limit) {
            return Err(ReminderError::InvalidLimit { min: 1, max: 100 });
        }
        let (time, id) = match cursor {
            Some(c) => {
                delivery_id(&c.id).map_err(
                    // Maps malformed paging identity to the cursor contract.
                    |_| ReminderError::InvalidCursor,
                )?;
                (
                    Some(decimal(&c.original_due_at_ms).ok_or(ReminderError::InvalidCursor)?),
                    c.id,
                )
            }
            None => (None, String::new()),
        };
        let _permit = self.inner.maintenance.read_permit().await;
        let _gate = self.inner.gate.lock().await;
        self.ready()?;
        let rows=self.inner.storage.with_connection(
            // Reads page and count under one serialized mutation boundary.
            |db| repo::list(db,"WHERE status='missed' AND (?1 IS NULL OR (original_due_at_ms,id)<(?1,?2)) ORDER BY original_due_at_ms DESC,id DESC LIMIT ?3",rusqlite::params![time,id,u32::from(limit)+1]))?;
        let mut items: Vec<_> = rows
            .into_iter()
            .map(
                // Exposes only validated public state.
                |r| r.dto,
            )
            .collect();
        let next_cursor = if items.len() > usize::from(limit) {
            items.pop();
            items.last().map(
                // Uses the final retained item as the exclusive continuation key.
                |r| ReminderCursorDto {
                    original_due_at_ms: r.original_due_at_ms.clone(),
                    id: r.id.clone(),
                },
            )
        } else {
            None
        };
        let state = self.state()?;
        Ok(MissedReminderPageDto {
            sequence: state.sequence,
            missed_count: state.missed_count,
            items,
            next_cursor,
        })
    }
    /// Reads materialized state only after the current Calendar target has been validated.
    pub async fn get_event_reminder_deliveries(
        &self,
        event: String,
        occurrence: String,
    ) -> Result<EventReminderDeliveriesDto, ReminderError> {
        event_ids(&event, &occurrence)?;
        self.inner
            .dependencies
            .context(&event, &occurrence)
            .await?
            .ok_or(ReminderError::TargetUnavailable)?;
        let _permit = self.inner.maintenance.read_permit().await;
        let _gate = self.inner.gate.lock().await;
        self.ready()?;
        let rows=self.inner.storage.with_connection(
            // Keeps pending reminder definitions owned by Calendar rather than materializing them.
            |db|repo::list(db,"WHERE event_id=?1 AND occurrence_id=?2 AND status<>'cancelled' ORDER BY minutes_before DESC,id",rusqlite::params![event,occurrence]))?;
        Ok(EventReminderDeliveriesDto {
            sequence: self.inner.sequence.load(Ordering::Acquire).to_string(),
            event_id: event,
            occurrence_id: occurrence,
            items: rows
                .into_iter()
                .map(
                    // Drops internal outbox fields at the public boundary.
                    |r| r.dto,
                )
                .collect(),
        })
    }
    /// Reads an owned delivery snapshot without holding any lock across dependency calls.
    async fn stored(&self, id: &str) -> Result<repo::Delivery, ReminderError> {
        delivery_id(id)?;
        let _permit = self.inner.maintenance.read_permit().await;
        let _gate = self.inner.gate.lock().await;
        self.ready()?;
        let row = self.inner.storage.with_connection(
            // Resolves one durable identity under the mutation gate.
            |db| repo::get(db, id),
        )?;
        if row.cancelled {
            return Err(ReminderError::DeliveryNotFound);
        }
        Ok(row)
    }
    /// Returns current route ownership without changing delivery status or the missed count.
    pub async fn open_reminder(&self, id: &str) -> Result<ReminderTargetDto, ReminderError> {
        let row = self.stored(id).await?;
        let c = self.context_for(&row).await?;
        Ok(ReminderTargetDto {
            event_id: c.event_id,
            occurrence_id: c.occurrence_id,
            project_id: c.project_id,
        })
    }
    /// Applies an optimistic action exactly once and queues durable inbox cleanup.
    async fn action(
        &self,
        id: &str,
        version: &str,
        minutes: Option<u16>,
    ) -> Result<ReminderActionResultDto, ReminderError> {
        delivery_id(id)?;
        let version = decimal(version)
            .filter(
                // Versions start at one and must remain incrementable in SQLite.
                |n| *n > 0 && *n < i64::MAX,
            )
            .ok_or(ReminderError::InvalidVersion)?;
        if minutes.is_some_and(
            // Only the three product durations are accepted.
            |n| !matches!(n, 5 | 10 | 30),
        ) {
            return Err(ReminderError::InvalidSnoozeMinutes);
        }
        if minutes.is_some() {
            let row = self.stored(id).await?;
            self.context_for(&row).await?;
        }
        let _permit = self.inner.maintenance.read_permit().await;
        let _gate = self.inner.gate.lock().await;
        self.ready()?;
        let now = self.inner.clock.now_ms();
        if now < 0 {
            return Err(ReminderError::ClockOutOfRange);
        }
        let next = minutes
            .map(
                // Snooze uses current time rather than the previous due instant.
                |m| {
                    now.checked_add(i64::from(m) * 60000)
                        .ok_or(ReminderError::ClockOutOfRange)
                },
            )
            .transpose()?;
        let dto=self.inner.storage.with_transaction::<_,ReminderError>(
            // Rechecks version and status atomically after asynchronous context resolution.
            |tx|{let row=repo::get(tx,id)?;if row.cancelled{return Err(ReminderError::DeliveryNotFound);}
                if row.dto.version!=version.to_string(){return Err(ReminderError::DeliveryChanged);}
                if (minutes.is_some()&&row.dto.status!=ReminderDeliveryStatusDto::Active)||matches!(row.dto.status,ReminderDeliveryStatusDto::Suppressed|ReminderDeliveryStatusDto::Dismissed){return Err(ReminderError::ActionNotAllowed);}
                tx.execute("UPDATE reminder_deliveries SET status=?1,next_fire_at_ms=?2,version=version+1,notification_sync='delete_pending',notification_retry_at_ms=?3,notification_retry_count=0,os_state='none',updated_at_ms=max(updated_at_ms,?3) WHERE id=?4",rusqlite::params![if minutes.is_some(){"snoozed"}else{"dismissed"},next,now,id])?;
                Ok(repo::get(tx,id)?.dto)})?;
        self.changed(1)?;
        self.inner.wake.notify_one();
        let state = self.state()?;
        Ok(ReminderActionResultDto {
            sequence: state.sequence,
            missed_count: state.missed_count,
            delivery: dto,
        })
    }
    /// Reschedules one active reminder from the current controlled-clock instant.
    pub async fn snooze_reminder(
        &self,
        id: &str,
        version: &str,
        minutes: u16,
    ) -> Result<ReminderActionResultDto, ReminderError> {
        self.action(id, version, Some(minutes)).await
    }
    /// Dismisses an active, missed, or snoozed reminder without changing its identity.
    pub async fn dismiss_reminder(
        &self,
        id: &str,
        version: &str,
    ) -> Result<ReminderActionResultDto, ReminderError> {
        self.action(id, version, None).await
    }
    /// Dismisses all missed rows in one transaction and emits nothing for an empty set.
    pub async fn dismiss_all_missed_reminders(&self) -> Result<ReminderChangedDto, ReminderError> {
        let _permit = self.inner.maintenance.read_permit().await;
        let _gate = self.inner.gate.lock().await;
        self.ready()?;
        let now = self.inner.clock.now_ms().max(0);
        let affected=self.inner.storage.with_transaction::<_,ReminderError>(
            // Enqueues cleanup atomically with the aggregate missed-state transition.
            |tx|Ok(tx.execute("UPDATE reminder_deliveries SET status='dismissed',version=version+1,notification_sync='delete_pending',notification_retry_at_ms=?1,notification_retry_count=0,updated_at_ms=max(updated_at_ms,?1) WHERE status='missed'",[now])?))?;
        self.changed(affected)?;
        self.inner.wake.notify_one();
        self.state()
    }
    /// Tracks exact event detail with stale-cleanup-safe view tokens.
    pub async fn set_visible_calendar_event(
        &self,
        input: VisibleCalendarEventInputDto,
    ) -> Result<(), ReminderError> {
        let token = match &input {
            VisibleCalendarEventInputDto::Show { view_token, .. }
            | VisibleCalendarEventInputDto::Hide { view_token } => view_token,
        };
        if !reminder_uuid(token) {
            return Err(ReminderError::InvalidViewToken);
        }
        let mut visible = self.inner.visible.lock().map_err(
            // Hides runtime synchronization failure details.
            |_| ReminderError::Unavailable,
        )?;
        match input {
            VisibleCalendarEventInputDto::Show {
                view_token,
                event_id,
                occurrence_id,
            } => {
                if !reminder_uuid(&event_id) {
                    return Err(ReminderError::InvalidEventId);
                }
                if let Some(occurrence) = &occurrence_id {
                    event_ids(&event_id, occurrence)?;
                }
                visible.1 = Some((view_token, event_id, occurrence_id));
            }
            VisibleCalendarEventInputDto::Hide { view_token } => {
                if visible.1.as_ref().is_some_and(
                    // A stale unmount cannot clear a newer detail view.
                    |v| v.0 == view_token,
                ) {
                    visible.1 = None;
                }
            }
        }
        Ok(())
    }
    /// Wakes reconciliation only after the Calendar owner has committed its invalidation.
    pub fn observe_calendar_change(&self, _event: CalendarChangedEventDto) {
        self.inner.wake.notify_one();
    }
    /// Updates native main visibility synchronously before later delivery decisions.
    pub fn observe_main_window_visibility(&self, visible: bool) {
        if let Ok(mut state) = self.inner.visible.lock() {
            state.0 = visible;
        }
    }
    /// Quiesces the worker without waiting forever on the maintenance write permit.
    pub fn pause_for_reset(&self) -> ReminderFuture<'_, Result<(), ReminderError>> {
        Box::pin(async move {
            self.inner.paused.store(true, Ordering::Release);
            self.inner.stop_signal.notify_waiters();
            self.inner.wake.notify_one();
            let _running = self.inner.running.lock().await;
            Ok(())
        })
    }
    /// Reopens scheduling after all committed projections have been published or rolled back.
    pub fn resume_after_reset(&self, _committed: bool) {
        self.inner.paused.store(false, Ordering::Release);
        self.inner.wake.notify_one();
    }
    /// Prepares an owned reset projection from one coordinator-captured baseline.
    pub fn prepare_reminder_reset_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        baseline_ms: i64,
    ) -> Result<ReminderResetPlan, ReminderError> {
        if baseline_ms < 0 {
            return Err(ReminderError::ClockOutOfRange);
        }
        repo::checkpoint(tx)?;
        let delivery_count = tx.query_row(
            "SELECT count(*) FROM reminder_deliveries",
            [],
            // Captures the durable impact inside the coordinator transaction.
            |r| r.get(0),
        )?;
        Ok(ReminderResetPlan {
            baseline_ms,
            delivery_count,
            next_sequence: self
                .inner
                .sequence
                .load(Ordering::Acquire)
                .checked_add(1)
                .ok_or(ReminderError::Unavailable)?,
        })
    }
    /// Deletes child delivery state and replaces the baseline atomically with the owning reset.
    pub fn reset_reminders_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &ReminderResetPlan,
    ) -> Result<ReminderResetProjection, ReminderError> {
        tx.execute("DELETE FROM reminder_deliveries", [])?;
        tx.execute(
            "UPDATE reminder_scheduler_state SET scan_through_ms=?1,updated_at_ms=?1",
            [plan.baseline_ms],
        )?;
        Ok(ReminderResetProjection {
            baseline_ms: plan.baseline_ms,
            removed_delivery_count: plan.delivery_count,
            next_sequence: plan.next_sequence,
        })
    }
    /// Publishes only owned committed state without querying storage after reset.
    pub fn publish_reminder_reset(&self, projection: ReminderResetProjection) {
        self.inner
            .sequence
            .store(projection.next_sequence, Ordering::Release);
        self.inner.ready.store(true, Ordering::Release);
        if let Ok(mut visible) = self.inner.visible.lock() {
            visible.1 = None;
        }
        self.inner.events.publish(ReminderChangedDto {
            sequence: projection.next_sequence.to_string(),
            missed_count: 0,
        });
    }
    /// Starts exactly one worker, observing committed settings changes as scheduling signals.
    pub async fn start(&self, settings: watch::Receiver<crate::settings::SettingsSnapshot>) {
        let mut worker = self.inner.worker.lock().await;
        if worker.is_some() {
            return;
        }
        let weak = Arc::downgrade(&self.inner);
        *worker = Some(tauri::async_runtime::spawn(
            super::reminder_scheduler::worker(weak, settings),
        ));
    }
    /// Stops and joins the worker before application storage can close.
    pub async fn shutdown_for_quit(&self) -> Result<(), ReminderError> {
        self.inner.stopped.store(true, Ordering::Release);
        self.inner.stop_signal.notify_waiters();
        self.inner.wake.notify_one();
        if let Some(worker) = self.inner.worker.lock().await.take() {
            worker.await.map_err(
                // Keeps task teardown failures sanitized.
                |_| ReminderError::Unavailable,
            )?;
        }
        Ok(())
    }
}
