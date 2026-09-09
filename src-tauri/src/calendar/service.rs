use super::{models::*, recurrence, repository as repo};
use crate::{projects::ProjectService, shared::DataMaintenanceGate, storage::Storage};
use chrono::{DateTime, Duration as Days, Utc};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Runtime};
pub const CALENDAR_CHANGED_EVENT: &str = "calendar://changed";
/// Supplies wall and monotonic time without global clock mutation.
pub trait CalendarClock: Send + Sync {
    /// Returns validated Unix milliseconds.
    fn now_ms(&self) -> Result<i64, CalendarError>;
    /// Returns monotonic time for confirmation expiration.
    fn elapsed(&self) -> Duration;
}
pub struct SystemCalendarClock {
    started: Instant,
}
impl Default for SystemCalendarClock {
    /// Creates a private monotonic epoch.
    fn default() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}
impl CalendarClock for SystemCalendarClock {
    /// Reads system time with checked conversion.
    fn now_ms(&self) -> Result<i64, CalendarError> {
        i64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(
                    // Rejects a clock before the persistence epoch.
                    |_| CalendarError::DateOutOfRange,
                )?
                .as_millis(),
        )
        .map_err(
            // Rejects timestamps outside the supported integer range.
            |_| CalendarError::DateOutOfRange,
        )
    }
    /// Measures confirmation age independently of wall clock changes.
    fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }
}
/// Receives invalidations only after durable commits and owner locks release.
pub trait CalendarEventSink: Send + Sync {
    /// Attempts delivery without changing the committed result.
    fn emit(&self, event: CalendarChangedEventDto) -> Result<(), CalendarError>;
}
pub struct TauriCalendarEventSink<R: Runtime>(pub tauri::AppHandle<R>);
impl<R: Runtime> CalendarEventSink for TauriCalendarEventSink<R> {
    /// Publishes the narrow event solely to the main window.
    fn emit(&self, event: CalendarChangedEventDto) -> Result<(), CalendarError> {
        self.0
            .emit_to("main", CALENDAR_CHANGED_EVENT, event)
            .map_err(
                // Redacts transport failures.
                |_| CalendarError::StorageUnavailable,
            )
    }
}
struct Pending {
    request_id: u32,
    event: CalendarEventDto,
    created: Duration,
}
#[derive(Default)]
struct MutationState {
    next_request: u32,
    pending: Option<Pending>,
}
struct Inner {
    storage: Storage,
    projects: ProjectService,
    clock: Arc<dyn CalendarClock>,
    events: Arc<dyn CalendarEventSink>,
    gate: DataMaintenanceGate,
    state: Mutex<MutationState>,
    sequence: AtomicU64,
}
#[derive(Clone)]
pub struct CalendarService {
    inner: Arc<Inner>,
}
impl CalendarService {
    /// Composes the owner around explicit production or isolated collaborators.
    pub fn with_seams(
        storage: Storage,
        projects: ProjectService,
        clock: Arc<dyn CalendarClock>,
        events: Arc<dyn CalendarEventSink>,
        maintenance: DataMaintenanceGate,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                storage,
                projects,
                clock,
                events,
                gate: maintenance,
                state: Mutex::new(MutationState::default()),
                sequence: AtomicU64::new(0),
            }),
        }
    }
    /// Exposes admission identity for composition checks.
    pub fn maintenance_gate(&self) -> DataMaintenanceGate {
        self.inner.gate.clone()
    }
    /// Executes persistence and recurrence off async workers.
    async fn blocking<T: Send + 'static>(
        &self,
        operation: impl FnOnce(Self) -> Result<T, CalendarError> + Send + 'static,
    ) -> Result<T, CalendarError> {
        let service = self.clone();
        tauri::async_runtime::spawn_blocking(
            // Transfers owned state to the blocking worker.
            move || operation(service),
        )
        .await
        .map_err(
            // Hides worker panics and runtime details.
            |_| CalendarError::StorageUnavailable,
        )?
    }
    /// Validates the persistence clock and safe JavaScript timestamp ceiling.
    fn now(&self) -> Result<i64, CalendarError> {
        let now = self.inner.clock.now_ms()?;
        if !(0..=253402300799999).contains(&now) {
            Err(CalendarError::DateOutOfRange)
        } else {
            Ok(now)
        }
    }
    /// Reserves one sequence while the mutation lock serializes the durable write.
    fn changed(
        &self,
        kind: CalendarChangeKindDto,
        event: Option<&CalendarEventDto>,
    ) -> CalendarChangedEventDto {
        CalendarChangedEventDto {
            sequence: self
                .inner
                .sequence
                .fetch_add(1, Ordering::SeqCst)
                .saturating_add(1)
                .to_string(),
            kind,
            event_id: event.map(
                // Identifies single-event mutations only.
                |event| event.id.clone(),
            ),
            revision: event.map(
                // Reports the committed durable revision.
                |event| event.revision.clone(),
            ),
        }
    }
    /// Delivers after releasing owner and database locks; sink failures cannot undo commits.
    fn emit(&self, event: CalendarChangedEventDto) {
        let _ = self.inner.events.emit(event);
    }
    /// Predicts a maintenance sequence without mutating runtime state during prepare.
    pub(super) fn next_maintenance_sequence(&self) -> u64 {
        self.inner.sequence.load(Ordering::SeqCst).saturating_add(1)
    }
    /// Applies an owned committed projection without querying persistence.
    pub(super) fn publish_maintenance(&self, kind: CalendarChangeKindDto, next_sequence: u64) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.pending = None;
        }
        self.inner.sequence.store(next_sequence, Ordering::SeqCst);
        self.emit(CalendarChangedEventDto {
            sequence: next_sequence.to_string(),
            kind,
            event_id: None,
            revision: None,
        });
    }
    /// Verifies project existence through its public owner before Calendar locks.
    async fn project(&self, input: &EventInputDto) -> Result<(), CalendarError> {
        if let Some(id) = &input.project_id {
            recurrence::validate_id(id, CalendarError::InvalidProjectId)?;
            self.inner.projects.get_project(id).await.map_err(
                // Keeps project internals outside the Calendar error payload.
                |_| CalendarError::ProjectNotFound,
            )?;
        }
        Ok(())
    }
    /// Reads one coherent persisted definition.
    pub async fn get_calendar_event(
        &self,
        event_id: String,
    ) -> Result<CalendarEventDto, CalendarError> {
        recurrence::validate_id(&event_id, CalendarError::InvalidEventId)?;
        self.blocking(
            // Uses one Storage critical section for base and reminder records.
            move |service| {
                service.inner.storage.with_connection(
                    // Delegates snapshot decoding to the owner repository.
                    |db| repo::get(db, &event_id),
                )
            },
        )
        .await
    }
    /// Creates a complete event and publishes only its successful commit.
    pub async fn create_calendar_event(
        &self,
        input: EventInputDto,
    ) -> Result<CalendarEventDto, CalendarError> {
        self.project(&input).await?;
        let permit = self.inner.gate.read_permit().await;
        self.blocking(
            // Keeps admission until persistence and post-commit publication finish.
            move |service| {
                let _permit = permit;
                let value = recurrence::normalize_event(input)?;
                let now = service.now()?;
                let state = service.inner.state.lock().map_err(
                    // Redacts poisoned mutation state.
                    |_| CalendarError::StorageUnavailable,
                )?;
                let event = CalendarEventDto {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: value.input.title,
                    description: value.input.description,
                    project_id: value.input.project_id,
                    time: value.time,
                    recurrence: value.input.recurrence,
                    reminders: value
                        .input
                        .reminder_minutes_before
                        .into_iter()
                        .map(
                            // Allocates independent stable identities for new offsets.
                            |minutes_before| EventReminderDto {
                                id: uuid::Uuid::new_v4().to_string(),
                                minutes_before,
                            },
                        )
                        .collect(),
                    revision: "1".into(),
                    created_at_ms: now,
                    updated_at_ms: now,
                };
                service.inner.storage.with_transaction(
                    // Writes base and all reminders as one unit.
                    |db| repo::put(db, &event),
                )?;
                let change = service.changed(CalendarChangeKindDto::Created, Some(&event));
                drop(state);
                service.emit(change);
                Ok(event)
            },
        )
        .await
    }
    /// Replaces a whole series using an optimistic durable revision.
    pub async fn update_calendar_event(
        &self,
        input: UpdateCalendarEventInputDto,
    ) -> Result<CalendarEventDto, CalendarError> {
        recurrence::validate_id(&input.event_id, CalendarError::InvalidEventId)?;
        recurrence::validate_revision(&input.expected_revision)?;
        self.project(&input.event).await?;
        let permit = self.inner.gate.read_permit().await;
        self.blocking(
            // Serializes revision comparison and replacement under maintenance admission.
            move |service| {
                let _permit = permit;
                let value = recurrence::normalize_event(input.event)?;
                let now = service.now()?;
                let state = service.inner.state.lock().map_err(
                    // Redacts poisoned mutation state.
                    |_| CalendarError::StorageUnavailable,
                )?;
                let event = service.inner.storage.with_transaction(
                    // Computes all delta identities before the atomic replacement.
                    |db| {
                        let old = repo::get(db, &input.event_id)?;
                        check_revision(&old, &input.expected_revision)?;
                        let mut event = CalendarEventDto {
                            id: old.id,
                            title: value.input.title,
                            description: value.input.description,
                            project_id: value.input.project_id,
                            time: value.time,
                            recurrence: value.input.recurrence,
                            reminders: Vec::new(),
                            revision: recurrence::validate_revision(&old.revision)?
                                .checked_add(1)
                                .ok_or(CalendarError::DateOutOfRange)?
                                .to_string(),
                            created_at_ms: old.created_at_ms,
                            updated_at_ms: now.max(
                                old.updated_at_ms
                                    .checked_add(1)
                                    .ok_or(CalendarError::DateOutOfRange)?,
                            ),
                        };
                        for minutes_before in value.input.reminder_minutes_before {
                            let id = old
                                .reminders
                                .iter()
                                .find(
                                    // Keeps unchanged reminder semantics attached to their original identity.
                                    |reminder| reminder.minutes_before == minutes_before,
                                )
                                .map_or_else(
                                    // Allocates identity only for a new offset.
                                    || uuid::Uuid::new_v4().to_string(),
                                    // Reuses the stable existing identity.
                                    |reminder| reminder.id.clone(),
                                );
                            event
                                .reminders
                                .push(EventReminderDto { id, minutes_before });
                        }
                        repo::put(db, &event)?;
                        Ok::<_, CalendarError>(event)
                    },
                )?;
                let change = service.changed(CalendarChangeKindDto::Updated, Some(&event));
                drop(state);
                service.emit(change);
                Ok(event)
            },
        )
        .await
    }
    /// Prepares one replaceable, expiring whole-series deletion preview.
    pub async fn prepare_delete_calendar_event(
        &self,
        input: EventRevisionInputDto,
    ) -> Result<DeleteCalendarEventImpactDto, CalendarError> {
        recurrence::validate_id(&input.event_id, CalendarError::InvalidEventId)?;
        recurrence::validate_revision(&input.expected_revision)?;
        self.blocking(
            // Captures the exact current definition under the owner mutation lock.
            move |service| {
                let mut state = service.inner.state.lock().map_err(
                    // Redacts poisoned preview state.
                    |_| CalendarError::StorageUnavailable,
                )?;
                let event = service.inner.storage.with_connection(
                    // Reads a coherent deletion fingerprint.
                    |db| repo::get(db, &input.event_id),
                )?;
                check_revision(&event, &input.expected_revision)?;
                state.next_request = state.next_request.wrapping_add(1).max(1);
                let impact = DeleteCalendarEventImpactDto {
                    request_id: state.next_request,
                    event_id: event.id.clone(),
                    title: event.title.clone(),
                    is_recurring: !matches!(event.recurrence, EventRecurrenceDto::None),
                    reminder_count: event.reminders.len() as u32,
                };
                state.pending = Some(Pending {
                    request_id: impact.request_id,
                    event,
                    created: service.inner.clock.elapsed(),
                });
                Ok(impact)
            },
        )
        .await
    }
    /// Confirms an unexpired unchanged fingerprint and cascades its reminder definitions.
    pub async fn confirm_delete_calendar_event(
        &self,
        input: ConfirmDeleteCalendarEventInputDto,
    ) -> Result<DeletedCalendarEventDto, CalendarError> {
        let permit = self.inner.gate.read_permit().await;
        self.blocking(
            // Preserves lock order and checks impact in the deletion transaction.
            move |service| {
                let _permit = permit;
                let mut state = service.inner.state.lock().map_err(
                    // Redacts poisoned mutation state.
                    |_| CalendarError::StorageUnavailable,
                )?;
                let pending = state
                    .pending
                    .as_ref()
                    .filter(
                        // Rejects replaced or absent preview identities.
                        |pending| pending.request_id == input.request_id,
                    )
                    .ok_or(CalendarError::DeleteConfirmationMissing)?;
                if service
                    .inner
                    .clock
                    .elapsed()
                    .saturating_sub(pending.created)
                    >= Duration::from_secs(60)
                {
                    return Err(CalendarError::DeleteConfirmationExpired);
                }
                let event = service.inner.storage.with_transaction(
                    // Rechecks every durable fingerprint field before deletion.
                    |db| {
                        let event = repo::get(db, &pending.event.id)?;
                        if event != pending.event {
                            return Err(CalendarError::DeleteImpactChanged);
                        }
                        repo::delete(db, &event.id)?;
                        Ok::<_, CalendarError>(event)
                    },
                )?;
                state.pending = None;
                let change = service.changed(CalendarChangeKindDto::Deleted, Some(&event));
                drop(state);
                service.emit(change);
                Ok(DeletedCalendarEventDto { event_id: event.id })
            },
        )
        .await
    }
}
/// Rejects stale optimistic revisions without overwriting newer definitions.
fn check_revision(event: &CalendarEventDto, expected: &str) -> Result<(), CalendarError> {
    if event.revision == expected {
        Ok(())
    } else {
        Err(CalendarError::RevisionConflict {
            current_revision: event.revision.clone(),
        })
    }
}
impl CalendarService {
    /// Expands a bounded viewer-date range from one coherent storage snapshot.
    pub async fn list_calendar_occurrences(
        &self,
        input: CalendarRangeInputDto,
    ) -> Result<CalendarOccurrenceListDto, CalendarError> {
        self.blocking(
            // Validates and expands without blocking an async runtime worker.
            move |service| {
                let range = recurrence::normalize_range(&input)?;
                service.inner.storage.with_connection(
                    // Keeps definition/reminder reads and invalidation token in one snapshot.
                    |db| {
                        let mut items = Vec::new();
                        for event in repo::range_candidates(db, &input, &range)? {
                            if input.project_id.as_ref().is_some_and(
                                // Filters current project links after foreign-key unlinking.
                                |id| event.project_id.as_ref() != Some(id),
                            ) || (input.only_with_reminders && event.reminders.is_empty())
                            {
                                continue;
                            }
                            items.extend(recurrence::expand_event(
                                &event,
                                range.from_ms,
                                range.to_ms,
                                range.start_date,
                                range.end_date,
                                5000 - items.len(),
                            )?);
                            if items.len() > 5000 {
                                return Err(CalendarError::OccurrenceLimitExceeded);
                            }
                        }
                        items.sort_by_key(
                            // Applies viewer date, all-day priority, start and stable identity ordering.
                            |item| {
                                let (date, rank, start) = match &item.dto.time {
                                    EventTimeDto::AllDay { start_date, .. } => {
                                        (start_date.clone(), 0, 0)
                                    }
                                    EventTimeDto::Timed { start_at_ms, .. } => (
                                        DateTime::<Utc>::from_timestamp_millis(*start_at_ms)
                                            .expect("validated occurrence timestamp")
                                            .with_timezone(&range.timezone)
                                            .date_naive()
                                            .to_string(),
                                        1,
                                        *start_at_ms,
                                    ),
                                };
                                (
                                    date,
                                    rank,
                                    start,
                                    item.dto.title.to_lowercase(),
                                    item.dto.event_id.clone(),
                                    item.dto.occurrence_id.clone(),
                                )
                            },
                        );
                        Ok(CalendarOccurrenceListDto {
                            revision: service.inner.sequence.load(Ordering::SeqCst).to_string(),
                            items: items
                                .into_iter()
                                .map(
                                    // Exposes only the public occurrence projection.
                                    |item| item.dto,
                                )
                                .collect(),
                        })
                    },
                )
            },
        )
        .await
    }
    /// Produces one bounded candidate per base definition for unified search.
    pub async fn search_for_unified(
        &self,
        query: &str,
        candidate_limit: u32,
    ) -> Result<CalendarEventSearchCandidates, CalendarError> {
        let query = query.to_owned();
        let limit = candidate_limit.clamp(1, 64) as usize;
        self.blocking(
            // Searches only owner-derived text and maps base occurrence instants.
            move |service| {
                service.inner.storage.with_connection(
                    // Uses one snapshot for all candidate records and reminders.
                    |db| {
                        let tokens: Vec<_> = query
                            .split_whitespace()
                            .map(
                                // Matches Unicode text independent of case.
                                |token| token.to_lowercase(),
                            )
                            .collect();
                        let mut items = Vec::new();
                        if tokens.is_empty() {
                            return Ok(CalendarEventSearchCandidates {
                                items,
                                has_more: false,
                            });
                        }
                        for event in repo::all(db)? {
                            let text =
                                format!("{} {}", event.title, event.description).to_lowercase();
                            if !tokens.iter().all(
                                // Requires every query token to match the base definition.
                                |token| text.contains(token),
                            ) {
                                continue;
                            }
                            let (starts_at_ms, time_zone_id) = match base_instant(&event) {
                                Ok(value) => value,
                                Err(CalendarError::DateOutOfRange) => continue,
                                Err(error) => return Err(error),
                            };
                            items.push(CalendarEventSearchRecord {
                                event_id: event.id,
                                title: event.title,
                                matching_description: if event.description.is_empty() {
                                    None
                                } else {
                                    Some(event.description)
                                },
                                project_id: event.project_id,
                                starts_at_ms,
                                time_zone_id,
                            });
                        }
                        items.sort_by_key(
                            // Uses deterministic base-start and identity ordering before the owner cap.
                            |item| (item.starts_at_ms, item.event_id.clone()),
                        );
                        let has_more = items.len() > limit;
                        items.truncate(limit);
                        Ok(CalendarEventSearchCandidates { items, has_more })
                    },
                )
            },
        )
        .await
    }
    /// Enumerates read-only reminder jobs in a half-open due interval.
    pub async fn reminder_occurrences(
        &self,
        from_due_at_ms: i64,
        through_due_at_ms: i64,
        limit: u32,
    ) -> Result<Vec<CalendarReminderOccurrence>, CalendarError> {
        if through_due_at_ms.checked_sub(from_due_at_ms).is_none_or(
            // Enforces the narrow scheduler query window.
            |span| span <= 0 || span > 31 * 86400000,
        ) || !(1..=5000).contains(&limit)
        {
            return Err(CalendarError::InvalidRange);
        }
        self.blocking(
            // Expands only definitions carrying reminder offsets in one storage snapshot.
            move |service| {
                service.inner.storage.with_connection(
                    // Never creates delivery or inbox records from this read-only port.
                    |db| {
                        let mut result = Vec::new();
                        for event in repo::all(db)? {
                            if event.reminders.is_empty() {
                                continue;
                            }
                            let max_offset = event
                                .reminders
                                .iter()
                                .map(
                                    // Bounds the future start horizon by this event's largest reminder offset.
                                    |reminder| i64::from(reminder.minutes_before) * 60000,
                                )
                                .max()
                                .unwrap_or(0);
                            let through = through_due_at_ms
                                .checked_add(max_offset)
                                .ok_or(CalendarError::DateOutOfRange)?;
                            let start = date_margin(from_due_at_ms, -2)?;
                            let end = date_margin(through, 2)?;
                            for occurrence in recurrence::expand_event(
                                &event,
                                from_due_at_ms,
                                through,
                                start,
                                end,
                                10000,
                            )? {
                                for reminder in &event.reminders {
                                    let due = occurrence
                                        .starts_at_ms
                                        .checked_sub(i64::from(reminder.minutes_before) * 60000)
                                        .ok_or(CalendarError::DateOutOfRange)?;
                                    if due < from_due_at_ms || due >= through_due_at_ms {
                                        continue;
                                    }
                                    if result.len() >= limit as usize {
                                        return Err(CalendarError::OccurrenceLimitExceeded);
                                    }
                                    result.push(CalendarReminderOccurrence {
                                        event_id: event.id.clone(),
                                        occurrence_id: occurrence.dto.occurrence_id.clone(),
                                        reminder_id: reminder.id.clone(),
                                        title: event.title.clone(),
                                        project_id: event.project_id.clone(),
                                        starts_at_ms: occurrence.starts_at_ms,
                                        due_at_ms: due,
                                        time_zone_id: time_zone(&event.time).into(),
                                        minutes_before: reminder.minutes_before,
                                    });
                                }
                            }
                        }
                        result.sort_by_key(
                            // Stabilizes downstream reconciliation and identity processing.
                            |item| {
                                (
                                    item.due_at_ms,
                                    item.event_id.clone(),
                                    item.occurrence_id.clone(),
                                    item.reminder_id.clone(),
                                )
                            },
                        );
                        Ok(result)
                    },
                )
            },
        )
        .await
    }
    /// Resolves notification content only for an exact current occurrence identity.
    pub async fn get_notification_context(
        &self,
        event_id: &str,
        occurrence_id: &str,
    ) -> Result<Option<CalendarNotificationContext>, CalendarError> {
        recurrence::validate_id(event_id, CalendarError::InvalidEventId)?;
        let event_id = event_id.to_owned();
        let occurrence_id = occurrence_id.to_owned();
        self.blocking(
            // Revalidates identities against the current event definition without writes.
            move |service| {
                service.inner.storage.with_connection(
                    // Reads the base and verifies the requested occurrence within one snapshot.
                    |db| {
                        let event = match repo::get(db, &event_id) {
                            Ok(event) => event,
                            Err(CalendarError::EventNotFound) => return Ok(None),
                            Err(error) => return Err(error),
                        };
                        let Some(instant) = occurrence_id.rsplit(':').next().and_then(
                            // Treats malformed identity suffixes as absent contexts.
                            |value| value.parse::<i64>().ok(),
                        ) else {
                            return Ok(None);
                        };
                        let through = instant
                            .checked_add(1)
                            .ok_or(CalendarError::DateOutOfRange)?;
                        for occurrence in recurrence::expand_event(
                            &event,
                            instant,
                            through,
                            date_margin(instant, -2)?,
                            date_margin(instant, 2)?,
                            5000,
                        )? {
                            if occurrence.dto.occurrence_id == occurrence_id {
                                return Ok(Some(CalendarNotificationContext {
                                    event_id: event.id,
                                    occurrence_id,
                                    title: event.title,
                                    project_id: event.project_id,
                                    starts_at_ms: occurrence.starts_at_ms,
                                    time_zone_id: time_zone(&event.time).into(),
                                    reminder_definitions: event
                                        .reminders
                                        .into_iter()
                                        .map(
                                            // Transfers current stable reminder definitions to the consumer.
                                            |reminder| CalendarReminderDefinition {
                                                reminder_id: reminder.id,
                                                minutes_before: reminder.minutes_before,
                                            },
                                        )
                                        .collect(),
                                }));
                            }
                        }
                        Ok(None)
                    },
                )
            },
        )
        .await
    }
}
/// Returns the event's persisted IANA zone independent of its time representation.
fn time_zone(time: &EventTimeDto) -> &str {
    match time {
        EventTimeDto::Timed { time_zone_id, .. } | EventTimeDto::AllDay { time_zone_id, .. } => {
            time_zone_id
        }
    }
}
/// Converts a bounded instant to a date window with timezone-offset padding.
fn date_margin(instant: i64, days: i64) -> Result<chrono::NaiveDate, CalendarError> {
    DateTime::<Utc>::from_timestamp_millis(instant)
        .ok_or(CalendarError::DateOutOfRange)?
        .date_naive()
        .checked_add_signed(Days::days(days))
        .ok_or(CalendarError::DateOutOfRange)
}
/// Resolves the base start with the same all-day first-instant rule as recurrence.
fn base_instant(event: &CalendarEventDto) -> Result<(i64, String), CalendarError> {
    match &event.time {
        EventTimeDto::Timed {
            start_at_ms,
            time_zone_id,
            ..
        } => Ok((*start_at_ms, time_zone_id.clone())),
        EventTimeDto::AllDay {
            start_date,
            time_zone_id,
            ..
        } => {
            let date = chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d").map_err(
                // Rejects corrupt stored dates without exposing parser details.
                |_| CalendarError::CorruptStoredData,
            )?;
            let zone = time_zone_id.parse().map_err(
                // Rejects corrupt stored zones without exposing parser details.
                |_| CalendarError::CorruptStoredData,
            )?;
            Ok((
                recurrence::first_instant(date, zone).ok_or(CalendarError::DateOutOfRange)?,
                time_zone_id.clone(),
            ))
        }
    }
}
