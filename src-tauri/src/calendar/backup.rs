use super::{models::*, recurrence, repository, service::CalendarService};
use rusqlite::Transaction;
use serde::{Serialize, de::DeserializeOwned};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Owns validated Calendar writes until the coordinator commits them.
pub struct PreparedEventMerge {
    pub counts: EventImportCounts,
    pub reminder_id_remaps: Vec<EventReminderIdRemap>,
    row_operations: Vec<CalendarEventDto>,
    next_sequence: u64,
}

/// Identifies one aggregate Calendar maintenance change.
pub enum CalendarMaintenanceChange {
    BackupImported,
    Reset,
}

/// Carries a complete content-free publication after the shared commit.
pub struct CalendarMaintenanceProjection {
    pub change: CalendarMaintenanceChange,
    pub affected_event_count: u32,
    next_sequence: u64,
}

/// Converts structurally identical typed backup enums without derived fields.
fn convert<T: Serialize, U: DeserializeOwned>(value: &T) -> Result<U, CalendarError> {
    serde_json::from_value(serde_json::to_value(value).map_err(
        // Serialization failure indicates an internal contract mismatch.
        |_| CalendarError::CorruptStoredData,
    )?)
    .map_err(
        // Structurally incompatible backup values cannot enter a prepared plan.
        |_| CalendarError::CorruptStoredData,
    )
}

/// Removes derived UTC instants while preserving the event's civil definition.
fn backup_record(event: &CalendarEventDto) -> Result<EventBackupRecordV1, CalendarError> {
    let time = match &event.time {
        EventTimeDto::Timed {
            start_local,
            end_local,
            time_zone_id,
            ..
        } => EventTimeBackupV1::Timed {
            start_local: start_local.clone(),
            end_local: end_local.clone(),
            time_zone_id: time_zone_id.clone(),
        },
        EventTimeDto::AllDay {
            start_date,
            end_date_exclusive,
            time_zone_id,
        } => EventTimeBackupV1::AllDay {
            start_date: start_date.clone(),
            end_date_exclusive: end_date_exclusive.clone(),
            time_zone_id: time_zone_id.clone(),
        },
    };
    Ok(EventBackupRecordV1 {
        id: event.id.clone(),
        title: event.title.clone(),
        description: event.description.clone(),
        project_id: event.project_id.clone(),
        time,
        recurrence: convert(&event.recurrence)?,
        reminders: convert(&event.reminders)?,
        created_at_ms: event.created_at_ms,
        updated_at_ms: event.updated_at_ms,
    })
}

impl CalendarService {
    /// Exports base definitions in deterministic event and reminder identity order.
    pub fn export_events_in(
        &self,
        tx: &Transaction<'_>,
    ) -> Result<Vec<EventBackupRecordV1>, CalendarError> {
        let mut events = repository::all(tx)?;
        events.sort_by(
            // Stabilizes event order independently of storage row order.
            |a, b| a.id.cmp(&b.id),
        );
        for event in &mut events {
            event.reminders.sort_by(
                // Matches the documented backup reminder ordering.
                |a, b| {
                    b.minutes_before
                        .cmp(&a.minutes_before)
                        .then(a.id.cmp(&b.id))
                },
            );
        }
        events.iter().map(backup_record).collect()
    }

    /// Validates incoming definitions and reserves deterministic semantic reminder identities.
    pub fn prepare_event_merge_in(
        &self,
        tx: &Transaction<'_>,
        incoming: &[EventBackupRecordV1],
    ) -> Result<PreparedEventMerge, CalendarError> {
        let local = repository::all(tx)?;
        let local_by_id = local
            .iter()
            .map(
                // Indexes the existing snapshot for bounded incoming-wins lookup.
                |event| (event.id.as_str(), event),
            )
            .collect::<HashMap<_, _>>();
        let mut occupied = HashMap::new();
        for event in &local {
            for reminder in &event.reminders {
                occupied.insert(
                    reminder.id.clone(),
                    (event.id.clone(), reminder.minutes_before),
                );
            }
        }
        let mut event_ids = HashSet::new();
        let mut source_ids = HashSet::new();
        for record in incoming {
            if !event_ids.insert(record.id.clone()) {
                return Err(CalendarError::InvalidEventId);
            }
            for reminder in &record.reminders {
                if !source_ids.insert(reminder.id.clone()) {
                    return Err(CalendarError::DuplicateReminder);
                }
            }
        }
        let mut plan = PreparedEventMerge {
            counts: EventImportCounts {
                inserts: 0,
                updates: 0,
                unchanged: 0,
            },
            reminder_id_remaps: Vec::new(),
            row_operations: Vec::new(),
            next_sequence: self.next_maintenance_sequence(),
        };
        for record in incoming {
            recurrence::validate_id(&record.id, CalendarError::InvalidEventId)?;
            if record.created_at_ms < 0 || record.updated_at_ms < record.created_at_ms {
                return Err(CalendarError::CorruptStoredData);
            }
            let normalized = recurrence::normalize_event(EventInputDto {
                title: record.title.clone(),
                description: record.description.clone(),
                project_id: record.project_id.clone(),
                time: convert(&record.time)?,
                recurrence: convert(&record.recurrence)?,
                reminder_minutes_before: record
                    .reminders
                    .iter()
                    .map(
                        // Validates offsets through the same input rules as CRUD.
                        |r| r.minutes_before,
                    )
                    .collect(),
            })?;
            let mut reminders = Vec::new();
            for reminder in &record.reminders {
                recurrence::validate_id(&reminder.id, CalendarError::DuplicateReminder)?;
                let semantic = (record.id.clone(), reminder.minutes_before);
                let mut id = reminder.id.clone();
                if occupied.get(&id).is_some_and(
                    // A reminder identity cannot be reused for a different delivery semantic.
                    |old| old != &semantic,
                ) {
                    let mut attempt = 0_u64;
                    loop {
                        id = Uuid::new_v5(
                            &Uuid::NAMESPACE_OID,
                            format!(
                                "xwork:event-reminder-import:{}:{}:{}:{attempt}",
                                record.id, reminder.id, reminder.minutes_before
                            )
                            .as_bytes(),
                        )
                        .to_string();
                        if !occupied.contains_key(&id) && !source_ids.contains(&id) {
                            break;
                        }
                        attempt = attempt
                            .checked_add(1)
                            .ok_or(CalendarError::StorageUnavailable)?;
                    }
                    plan.reminder_id_remaps.push(EventReminderIdRemap {
                        source_reminder_id: reminder.id.clone(),
                        effective_reminder_id: id.clone(),
                    });
                }
                occupied.insert(id.clone(), semantic);
                reminders.push(EventReminderDto {
                    id,
                    minutes_before: reminder.minutes_before,
                });
            }
            reminders.sort_by(
                // Matches the documented backup reminder ordering.
                |a, b| {
                    b.minutes_before
                        .cmp(&a.minutes_before)
                        .then(a.id.cmp(&b.id))
                },
            );
            let previous = local_by_id.get(record.id.as_str()).copied();
            let revision = match previous {
                Some(event) => recurrence::validate_revision(&event.revision)?
                    .checked_add(1)
                    .ok_or(CalendarError::CorruptStoredData)?,
                None => 1,
            };
            let event = CalendarEventDto {
                id: record.id.clone(),
                title: normalized.input.title,
                description: normalized.input.description,
                project_id: normalized.input.project_id,
                time: normalized.time,
                recurrence: normalized.input.recurrence,
                reminders,
                revision: revision.to_string(),
                created_at_ms: record.created_at_ms,
                updated_at_ms: record.updated_at_ms,
            };
            match previous {
                None => plan.counts.inserts += 1,
                Some(previous) if backup_record(previous)? == backup_record(&event)? => {
                    plan.counts.unchanged += 1
                }
                Some(_) => plan.counts.updates += 1,
            }
            plan.row_operations.push(event);
        }
        Ok(plan)
    }

    /// Applies prepared incoming-wins definitions in the existing shared transaction.
    pub fn apply_event_merge_in(
        &self,
        tx: &Transaction<'_>,
        plan: &PreparedEventMerge,
    ) -> Result<CalendarMaintenanceProjection, CalendarError> {
        for event in &plan.row_operations {
            repository::put(tx, event)?;
        }
        Ok(CalendarMaintenanceProjection {
            change: CalendarMaintenanceChange::BackupImported,
            affected_event_count: plan.row_operations.len() as u32,
            next_sequence: plan.next_sequence,
        })
    }

    /// Clears Calendar children before Projects are removed by the coordinator.
    pub fn reset_events_in(
        &self,
        tx: &Transaction<'_>,
    ) -> Result<CalendarMaintenanceProjection, CalendarError> {
        let events = repository::all(tx)?;
        for event in &events {
            repository::delete(tx, &event.id)?;
        }
        Ok(CalendarMaintenanceProjection {
            change: CalendarMaintenanceChange::Reset,
            affected_event_count: events.len() as u32,
            next_sequence: self.next_maintenance_sequence(),
        })
    }

    /// Publishes the prepared sequence once, without reading persistence after commit.
    pub fn publish_event_maintenance(&self, projection: CalendarMaintenanceProjection) {
        let kind = match projection.change {
            CalendarMaintenanceChange::BackupImported => CalendarChangeKindDto::BackupImported,
            CalendarMaintenanceChange::Reset => CalendarChangeKindDto::Reset,
        };
        self.publish_maintenance(kind, projection.next_sequence);
    }
}
