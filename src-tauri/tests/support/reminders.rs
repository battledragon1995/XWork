#![allow(dead_code)]
#[path = "notifications.rs"]
pub mod notifications;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
};
use xwork_lib::{
    calendar::*,
    notifications::{NotificationError, NotificationService, ReminderNotificationInput},
};

pub const EVENT: &str = "00000000-0000-4000-8000-000000000021";
pub const REMINDER: &str = "00000000-0000-4000-8000-000000000022";
pub const OCCURRENCE: &str = "single";
pub const TOKEN: &str = "00000000-0000-4000-8000-000000000023";

/// Advances scheduler time explicitly without real timer sleeps.
pub struct Clock {
    pub now: AtomicI64,
    pub changed: tokio::sync::Notify,
    pub sleep_calls: AtomicU64,
    pub active_sleeps: AtomicU64,
    pub sleep_activity: tokio::sync::Notify,
}
/// Counts cancellation of an in-flight controlled timer through ordinary future destruction.
struct SleepGuard<'a>(&'a Clock);
impl Drop for SleepGuard<'_> {
    /// Records that worker wake or shutdown released its previous timer future.
    fn drop(&mut self) {
        self.0.active_sleeps.fetch_sub(1, Ordering::SeqCst);
        self.0.sleep_activity.notify_waiters();
    }
}
impl Clock {
    /// Constructs a deterministic UTC clock at the requested instant.
    pub fn new(now: i64) -> Self {
        Self {
            now: AtomicI64::new(now),
            changed: tokio::sync::Notify::new(),
            sleep_calls: AtomicU64::new(0),
            active_sleeps: AtomicU64::new(0),
            sleep_activity: tokio::sync::Notify::new(),
        }
    }
    /// Publishes a controlled wall-clock change to all sleeping workers.
    pub fn set(&self, now: i64) {
        self.now.store(now, Ordering::SeqCst);
        self.changed.notify_waiters();
    }
}
impl Clock {
    /// Waits for an explicit worker timer registration acknowledgement without time-based polling.
    pub async fn wait_for_sleeps(&self, minimum: u64) {
        loop {
            let activity = self.sleep_activity.notified();
            tokio::pin!(activity);
            activity.as_mut().enable();
            if self.sleep_calls.load(Ordering::SeqCst) >= minimum {
                return;
            }
            activity.await;
        }
    }
}
impl ReminderClock for Clock {
    /// Returns the latest explicit test instant.
    fn now_ms(&self) -> i64 {
        self.now.load(Ordering::SeqCst)
    }
    /// Registers before reading the clock so an advancement cannot be lost.
    fn sleep_until<'a>(&'a self, deadline: i64) -> ReminderFuture<'a, ()> {
        // Waits exclusively for fixture clock changes until the target instant arrives.
        Box::pin(async move {
            self.active_sleeps.fetch_add(1, Ordering::SeqCst);
            let _active = SleepGuard(self);
            self.sleep_calls.fetch_add(1, Ordering::SeqCst);
            self.sleep_activity.notify_waiters();
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if self.now_ms() >= deadline {
                    return;
                }
                changed.await;
            }
        })
    }
}

/// Records post-commit aggregate events without involving an application window.
#[derive(Default)]
pub struct Events(pub Mutex<Vec<ReminderChangedDto>>);
impl ReminderEventSink for Events {
    /// Records the committed aggregate projection for exact count and sequence assertions.
    fn publish(&self, event: ReminderChangedDto) {
        self.0.lock().unwrap().push(event);
    }
}

/// Supplies public Calendar projections and forwards bell operations to the real inbox owner.
pub struct Dependencies {
    pub candidates: Mutex<Vec<CalendarReminderOccurrence>>,
    pub contexts: Mutex<Vec<CalendarNotificationContext>>,
    pub enabled: AtomicBool,
    pub fail_occurrences: AtomicBool,
    pub fail_context: AtomicBool,
    pub fail_upsert: AtomicBool,
    pub upserts: Mutex<Vec<ReminderNotificationInput>>,
    pub removes: Mutex<Vec<String>>,
    pub queries: Mutex<Vec<(i64, i64)>>,
    pub query_pause: Mutex<
        Option<(
            tokio::sync::oneshot::Sender<()>,
            tokio::sync::oneshot::Receiver<()>,
        )>,
    >,
    pub notifications: NotificationService,
}
impl ReminderDependencies for Dependencies {
    /// Returns only candidates inside the requested half-open due interval.
    fn occurrences(
        &self,
        from: i64,
        through: i64,
    ) -> ReminderFuture<'_, Result<Vec<CalendarReminderOccurrence>, ReminderError>> {
        // Models the public bounded Calendar query and its dependency failure seam.
        Box::pin(async move {
            self.queries.lock().unwrap().push((from, through));
            let pause = self.query_pause.lock().unwrap().take();
            if let Some((entered, resume)) = pause {
                let _ = entered.send(());
                resume.await.unwrap();
            }
            if self.fail_occurrences.load(Ordering::SeqCst) {
                return Err(ReminderError::DependencyUnavailable);
            }
            Ok(self
                .candidates
                .lock()
                .unwrap()
                .iter()
                // Keeps fake results faithful to Calendar's half-open range contract.
                .filter(|item| item.due_at_ms >= from && item.due_at_ms < through)
                .take(5000)
                .cloned()
                .collect())
        })
    }
    /// Resolves an exact current event occurrence or a controlled owner failure.
    fn context<'a>(
        &'a self,
        event: &'a str,
        occurrence: &'a str,
    ) -> ReminderFuture<'a, Result<Option<CalendarNotificationContext>, ReminderError>> {
        // Returns an owned snapshot so caller awaits never retain fixture locks.
        Box::pin(async move {
            if self.fail_context.load(Ordering::SeqCst) {
                return Err(ReminderError::DependencyUnavailable);
            }
            Ok(self
                .contexts
                .lock()
                .unwrap()
                .iter()
                // Matches both components of the current Calendar occurrence identity.
                .find(|item| item.event_id == event && item.occurrence_id == occurrence)
                .cloned())
        })
    }
    /// Reads the latest notification policy directly at the delivery decision point.
    fn enabled(&self) -> Result<bool, ReminderError> {
        Ok(self.enabled.load(Ordering::SeqCst))
    }
    /// Records each attempted bell sync before applying the real idempotent intake contract.
    fn upsert(
        &self,
        input: ReminderNotificationInput,
    ) -> ReminderFuture<'_, Result<(), ReminderError>> {
        // Applies the injected failure before any inbox write.
        Box::pin(async move {
            self.upserts.lock().unwrap().push(input.clone());
            if self.fail_upsert.load(Ordering::SeqCst) {
                return Err(ReminderError::DependencyUnavailable);
            }
            self.notifications.upsert_reminder(input).await.map_err(
                // Maps the consumer's sanitized error to the scheduler dependency boundary.
                |_| ReminderError::DependencyUnavailable,
            )
        })
    }
    /// Records reminder-owned cleanup and removes the real bell row idempotently.
    fn remove<'a>(&'a self, id: &'a str) -> ReminderFuture<'a, Result<(), ReminderError>> {
        // Executes cleanup outside any scheduler transaction.
        Box::pin(async move {
            self.removes.lock().unwrap().push(id.into());
            self.notifications.remove_reminder(id).await.map_err(
                // Keeps inbox persistence errors inside the dependency category.
                |_| ReminderError::DependencyUnavailable,
            )
        })
    }
}

/// Owns temporary SQLite storage, a real inbox and deterministic reminder collaborators.
pub struct Harness {
    pub service: ReminderService,
    pub inbox: notifications::Harness,
    pub clock: Arc<Clock>,
    pub deps: Arc<Dependencies>,
    pub events: Arc<Events>,
}
impl Harness {
    /// Constructs a first-run service without starting a background worker or native effects.
    pub async fn new(now: i64) -> Self {
        let inbox = notifications::Harness::new().await;
        let clock = Arc::new(Clock::new(now));
        let deps = Arc::new(Dependencies {
            candidates: Mutex::new(Vec::new()),
            contexts: Mutex::new(Vec::new()),
            enabled: AtomicBool::new(true),
            fail_occurrences: AtomicBool::new(false),
            fail_context: AtomicBool::new(false),
            fail_upsert: AtomicBool::new(false),
            upserts: Mutex::new(Vec::new()),
            removes: Mutex::new(Vec::new()),
            queries: Mutex::new(Vec::new()),
            query_pause: Mutex::new(None),
            notifications: inbox.service.clone(),
        });
        let events = Arc::new(Events::default());
        let service = ReminderService::with_seams(
            inbox.storage.clone(),
            inbox.gate.clone(),
            clock.clone(),
            deps.clone(),
            inbox.os.clone(),
            events.clone(),
        )
        .unwrap();
        Self {
            service,
            inbox,
            clock,
            deps,
            events,
        }
    }
    /// Reconstructs scheduler startup over the same durable state and controlled collaborators.
    pub fn restart(&self) -> ReminderService {
        ReminderService::with_seams(
            self.inbox.storage.clone(),
            self.inbox.gate.clone(),
            self.clock.clone(),
            self.deps.clone(),
            self.inbox.os.clone(),
            self.events.clone(),
        )
        .unwrap()
    }
    /// Adds a zero-offset reminder with matching current Calendar context.
    pub fn add(&self, due: i64) -> CalendarReminderOccurrence {
        let candidate = CalendarReminderOccurrence {
            event_id: EVENT.into(),
            occurrence_id: OCCURRENCE.into(),
            reminder_id: REMINDER.into(),
            title: "Planning".into(),
            project_id: None,
            starts_at_ms: due,
            due_at_ms: due,
            time_zone_id: "UTC".into(),
            minutes_before: 0,
        };
        self.deps.candidates.lock().unwrap().push(candidate.clone());
        self.deps
            .contexts
            .lock()
            .unwrap()
            .push(CalendarNotificationContext {
                event_id: candidate.event_id.clone(),
                occurrence_id: candidate.occurrence_id.clone(),
                title: candidate.title.clone(),
                project_id: candidate.project_id.clone(),
                starts_at_ms: candidate.starts_at_ms,
                time_zone_id: candidate.time_zone_id.clone(),
                reminder_definitions: vec![CalendarReminderDefinition {
                    reminder_id: candidate.reminder_id.clone(),
                    minutes_before: candidate.minutes_before,
                }],
            });
        candidate
    }
    /// Queries the standard fixture's materialized deliveries through the public API.
    pub async fn rows(&self) -> Vec<ReminderDeliveryDto> {
        self.service
            .get_event_reminder_deliveries(EVENT.into(), OCCURRENCE.into())
            .await
            .unwrap()
            .items
    }
    /// Applies isolated corruption or crash-boundary state without touching real app data.
    pub fn sql(&self, sql: &str) {
        self.inbox.sql(sql);
    }
    /// Reads one whitelisted internal field to assert durable outbox decisions.
    pub fn field(&self, field: &str) -> String {
        assert!(matches!(
            field,
            "os_state"
                | "notification_sync"
                | "status"
                | "generation"
                | "version"
                | "notification_retry_count"
                | "notification_retry_at_ms"
        ));
        self.inbox
            .storage
            .with_connection::<_, NotificationError>(
                // Formats only the allowlisted column name; values remain database-owned.
                |db| {
                    Ok(db.query_row(
                        &format!("SELECT CAST({field} AS TEXT) FROM reminder_deliveries LIMIT 1"),
                        [],
                        // Returns a scalar assertion projection without exposing the whole stored row.
                        |row| row.get(0),
                    )?)
                },
            )
            .unwrap()
    }
    /// Reads the durable half-open checkpoint used by catch-up and rollback assertions.
    pub fn checkpoint(&self) -> i64 {
        self.inbox
            .storage
            .with_connection::<_, NotificationError>(
                // Reads only the singleton scheduler cursor in this temporary database.
                |db| {
                    Ok(db.query_row(
                        "SELECT scan_through_ms FROM reminder_scheduler_state WHERE singleton_id=1",
                        [],
                        // Projects the initialized checkpoint as a lossless SQLite integer.
                        |row| row.get(0),
                    )?)
                },
            )
            .unwrap()
    }
}
