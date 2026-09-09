use super::{models::*, recurrence};
use rusqlite::{Connection, OptionalExtension, params};

/// Converts public time to its validated input representation.
pub(super) fn input(event: &CalendarEventDto) -> EventInputDto {
    let time = match &event.time {
        EventTimeDto::Timed {
            start_local,
            end_local,
            time_zone_id,
            ..
        } => EventTimeInputDto::Timed {
            start_local: start_local.clone(),
            end_local: end_local.clone(),
            time_zone_id: time_zone_id.clone(),
        },
        EventTimeDto::AllDay {
            start_date,
            end_date_exclusive,
            time_zone_id,
        } => EventTimeInputDto::AllDay {
            start_date: start_date.clone(),
            end_date_exclusive: end_date_exclusive.clone(),
            time_zone_id: time_zone_id.clone(),
        },
    };
    EventInputDto {
        title: event.title.clone(),
        description: event.description.clone(),
        project_id: event.project_id.clone(),
        time,
        recurrence: event.recurrence.clone(),
        reminder_minutes_before: event
            .reminders
            .iter()
            .map(
                // Retains semantic offsets while validation derives cache fields.
                |reminder| reminder.minutes_before,
            )
            .collect(),
    }
}
/// Reads one base definition and reminders within the caller's snapshot.
pub(super) fn get(db: &Connection, id: &str) -> Result<CalendarEventDto, CalendarError> {
    let raw = db.query_row("SELECT title,description,project_id,is_all_day,start_local,end_local,time_zone_id,start_at_ms,end_at_ms,recurrence_rule,revision,created_at_ms,updated_at_ms FROM calendar_events WHERE id=?1", [id],
        // Decodes storage primitives before validating the domain representation.
        |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,bool>(3)?,row.get::<_,String>(4)?,row.get::<_,String>(5)?,row.get::<_,String>(6)?,row.get::<_,Option<i64>>(7)?,row.get::<_,Option<i64>>(8)?,row.get::<_,Option<String>>(9)?,row.get::<_,i64>(10)?,row.get::<_,i64>(11)?,row.get::<_,i64>(12)?))).optional()?.ok_or(CalendarError::EventNotFound)?;
    let reminders = db.prepare("SELECT id,minutes_before FROM event_reminders WHERE event_id=?1 ORDER BY minutes_before DESC,id")?.query_map([id],
        // Decodes stable reminder definitions in public order.
        |row| Ok(EventReminderDto { id: row.get(0)?, minutes_before: row.get(1)? }))?.collect::<Result<Vec<_>,_>>()?;
    let time = if raw.3 {
        EventTimeDto::AllDay {
            start_date: raw.4,
            end_date_exclusive: raw.5,
            time_zone_id: raw.6,
        }
    } else {
        EventTimeDto::Timed {
            start_local: raw.4,
            end_local: raw.5,
            time_zone_id: raw.6,
            start_at_ms: raw.7.ok_or(CalendarError::CorruptStoredData)?,
            end_at_ms: raw.8.ok_or(CalendarError::CorruptStoredData)?,
        }
    };
    let event = CalendarEventDto {
        id: id.into(),
        title: raw.0,
        description: raw.1,
        project_id: raw.2,
        time,
        recurrence: recurrence::decode_recurrence(raw.9.as_deref())?,
        reminders,
        revision: raw.10.to_string(),
        created_at_ms: raw.11,
        updated_at_ms: raw.12,
    };
    let normalized = recurrence::normalize_event(input(&event)).map_err(
        // Stored invalid definitions must not be silently repaired.
        |_| CalendarError::CorruptStoredData,
    )?;
    if normalized.time != event.time
        || normalized.input.title != event.title
        || normalized.input.description != event.description
        || event.created_at_ms < 0
        || event.updated_at_ms < event.created_at_ms
    {
        return Err(CalendarError::CorruptStoredData);
    }
    Ok(event)
}
/// Reads complete definitions in deterministic identity order.
pub(super) fn all(db: &Connection) -> Result<Vec<CalendarEventDto>, CalendarError> {
    let ids = db
        .prepare("SELECT id FROM calendar_events ORDER BY id")?
        .query_map(
            [],
            // Collects owned identities before nested statement reads.
            |row| row.get::<_, String>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter()
        .map(
            // Loads every base and its reminders in the same Storage snapshot.
            |id| get(db, id),
        )
        .collect()
}
/// Persists a validated definition and exact reminder set atomically in the caller transaction.
pub(super) fn put(db: &Connection, event: &CalendarEventDto) -> Result<(), CalendarError> {
    let value = recurrence::normalize_event(input(event))?;
    db.execute("INSERT INTO calendar_events(id,title,description,project_id,is_all_day,start_local,end_local,time_zone_id,start_at_ms,end_at_ms,recurrence_rule,search_text,revision,created_at_ms,updated_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,project_id=excluded.project_id,is_all_day=excluded.is_all_day,start_local=excluded.start_local,end_local=excluded.end_local,time_zone_id=excluded.time_zone_id,start_at_ms=excluded.start_at_ms,end_at_ms=excluded.end_at_ms,recurrence_rule=excluded.recurrence_rule,search_text=excluded.search_text,revision=excluded.revision,created_at_ms=excluded.created_at_ms,updated_at_ms=excluded.updated_at_ms",params![event.id,value.input.title,value.input.description,value.input.project_id,value.is_all_day,value.start_local,value.end_local,value.time_zone_id,value.start_at_ms,value.end_at_ms,value.recurrence_rule,value.search_text,recurrence::validate_revision(&event.revision)?,event.created_at_ms,event.updated_at_ms])?;
    db.execute("DELETE FROM event_reminders WHERE event_id=?1", [&event.id])?;
    for reminder in &event.reminders {
        db.execute(
            "INSERT INTO event_reminders(id,event_id,minutes_before) VALUES(?1,?2,?3)",
            params![reminder.id, event.id, reminder.minutes_before],
        )?;
    }
    Ok(())
}
/// Removes a definition with schema-owned reminder cascading.
pub(super) fn delete(db: &Connection, id: &str) -> Result<(), CalendarError> {
    db.execute("DELETE FROM calendar_events WHERE id=?1", [id])?;
    Ok(())
}

/// Uses indexed time paths before recurrence expansion and resolves project/reminder filters in SQL.
pub(super) fn range_candidates(
    db: &Connection,
    input: &CalendarRangeInputDto,
    range: &recurrence::ValidatedRange,
) -> Result<Vec<CalendarEventDto>, CalendarError> {
    let ids=db.prepare("SELECT id FROM calendar_events WHERE (?1 IS NULL OR project_id=?1) AND (?2=0 OR EXISTS(SELECT 1 FROM event_reminders WHERE event_id=calendar_events.id)) AND ((recurrence_rule IS NOT NULL AND substr(start_local,1,10)<=?3) OR (recurrence_rule IS NULL AND is_all_day=0 AND start_at_ms<?4 AND end_at_ms>?5) OR (recurrence_rule IS NULL AND is_all_day=1 AND start_local<?6 AND end_local>?7)) ORDER BY id")?.query_map(params![input.project_id,input.only_with_reminders,range.end_date.checked_add_signed(chrono::Duration::days(2)).ok_or(CalendarError::DateOutOfRange)?.to_string(),range.to_ms,range.from_ms,input.end_date_exclusive,input.start_date],
        // Collects owned identities from the bounded candidate snapshot.
        |row|row.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?;
    ids.iter()
        .map(
            // Loads only definitions that can overlap this requested range.
            |id| get(db, id),
        )
        .collect()
}
