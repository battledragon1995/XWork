use super::reminder_models::*;
use rusqlite::{Connection, Row};

pub(crate) const COLUMNS: &str = "id,reminder_id,event_id,occurrence_id,project_id,title_snapshot,starts_at_ms,original_due_at_ms,time_zone_id,minutes_before,status,next_fire_at_ms,generation,version,notification_sync,notification_retry_at_ms,notification_retry_count,os_state,created_at_ms,updated_at_ms";
#[derive(Clone, Debug)]
pub(crate) struct Delivery {
    pub dto: ReminderDeliveryDto,
    pub reminder_id: String,
    pub cancelled: bool,
    pub sync: String,
    pub retries: u32,
    pub os: String,
}
/// Returns a sanitized corruption error naming only the schema field.
pub(crate) fn corrupt(field: &str) -> ReminderError {
    ReminderError::CorruptStoredDelivery {
        field: field.into(),
    }
}
/// Reads a strict SQLite column without exposing stored content.
fn field<T: rusqlite::types::FromSql>(row: &Row<'_>, index: usize) -> Result<T, ReminderError> {
    row.get(index).map_err(
        // Treats invalid stored types as corruption rather than transient failures.
        |_| corrupt("delivery"),
    )
}
/// Decodes every durable state invariant before exposing a delivery.
fn decode(row: &Row<'_>) -> Result<Delivery, ReminderError> {
    let id: String = field(row, 0)?;
    let reminder_id: String = field(row, 1)?;
    let event_id: String = field(row, 2)?;
    let occurrence_id: String = field(row, 3)?;
    let project_id: Option<String> = field(row, 4)?;
    let title: String = field(row, 5)?;
    let starts: i64 = field(row, 6)?;
    let due: i64 = field(row, 7)?;
    let zone: String = field(row, 8)?;
    let minutes: u32 = field(row, 9)?;
    let status: String = field(row, 10)?;
    let next: Option<i64> = field(row, 11)?;
    let generation: i64 = field(row, 12)?;
    let version: i64 = field(row, 13)?;
    let sync: String = field(row, 14)?;
    let retry_at: Option<i64> = field(row, 15)?;
    let retries: u32 = field(row, 16)?;
    let os: String = field(row, 17)?;
    let created: i64 = field(row, 18)?;
    let updated: i64 = field(row, 19)?;
    if delivery_id(&id).is_err()
        || !reminder_uuid(&reminder_id)
        || event_ids(&event_id, &occurrence_id).is_err()
        || project_id.as_ref().is_some_and(
            // Checks optional current project identity.
            |id| !reminder_uuid(id),
        )
        || title.trim().is_empty()
        || title.chars().count() > 200
        || zone.parse::<chrono_tz::Tz>().is_err()
        || minutes > 525600
        || starts < 0
        || due < 0
        || starts.checked_sub(i64::from(minutes) * 60000) != Some(due)
        || generation < 1
        || version < 1
        || created < 0
        || updated < created
    {
        return Err(corrupt("delivery"));
    }
    if !matches!(
        sync.as_str(),
        "none" | "upsert_pending" | "synced" | "delete_pending"
    ) || matches!(sync.as_str(), "upsert_pending" | "delete_pending") != retry_at.is_some()
        || retry_at.is_some_and(
            // Rejects invalid retry instants.
            |n| n < 0,
        )
        || !matches!(
            os.as_str(),
            "none" | "pending" | "suppressed_visible" | "attempted"
        )
        || (status != "active" && os != "none")
        || (status == "snoozed") != next.is_some()
    {
        return Err(corrupt("state"));
    }
    let cancelled = status == "cancelled";
    let status = match status.as_str() {
        "active" => ReminderDeliveryStatusDto::Active,
        "missed" => ReminderDeliveryStatusDto::Missed,
        "snoozed" => ReminderDeliveryStatusDto::Snoozed,
        "dismissed" | "cancelled" => ReminderDeliveryStatusDto::Dismissed,
        "suppressed" => ReminderDeliveryStatusDto::Suppressed,
        _ => return Err(corrupt("status")),
    };
    Ok(Delivery {
        dto: ReminderDeliveryDto {
            id,
            event_id,
            occurrence_id,
            project_id,
            title,
            starts_at_ms: starts.to_string(),
            original_due_at_ms: due.to_string(),
            time_zone_id: zone,
            minutes_before: minutes,
            status,
            snoozed_until_ms: next.map(
                // Converts the validated timestamp losslessly.
                |n| n.to_string(),
            ),
            version: version.to_string(),
        },
        reminder_id,
        cancelled,
        sync,
        retries,
        os,
    })
}
/// Reads a bounded SQL projection, keeping SQLite statements inside the connection scope.
pub(crate) fn list(
    connection: &Connection,
    suffix: &str,
    parameters: impl rusqlite::Params,
) -> Result<Vec<Delivery>, ReminderError> {
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM reminder_deliveries {suffix}"
    ))?;
    let mut rows = statement.query(parameters)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        result.push(decode(row)?);
    }
    Ok(result)
}
/// Looks up one durable identity including its internal cancellation state.
pub(crate) fn get(connection: &Connection, id: &str) -> Result<Delivery, ReminderError> {
    list(connection, "WHERE id=?1", [id])?
        .pop()
        .ok_or(ReminderError::DeliveryNotFound)
}
/// Counts only reminders classified during process downtime.
pub(crate) fn missed(connection: &Connection) -> Result<u32, ReminderError> {
    Ok(connection.query_row(
        "SELECT count(*) FROM reminder_deliveries WHERE status='missed'",
        [],
        // Decodes the aggregate count.
        |r| r.get(0),
    )?)
}
/// Reads the singleton checkpoint and detects malformed startup state.
pub(crate) fn checkpoint(connection: &Connection) -> Result<Option<i64>, ReminderError> {
    let mut statement = connection.prepare(
        "SELECT singleton_id,scan_through_ms,updated_at_ms FROM reminder_scheduler_state",
    )?;
    let mut rows = statement.query([])?;
    let row = rows.next()?.ok_or_else(
        // Missing singleton state is corruption, not a first-run baseline.
        || corrupt("checkpoint"),
    )?;
    let id: i64 = field(row, 0)?;
    let checkpoint: Option<i64> = field(row, 1)?;
    let updated: i64 = field(row, 2)?;
    if id != 1
        || updated < 0
        || checkpoint.is_some_and(
            // Checkpoints never precede the Unix epoch.
            |n| n < 0,
        )
        || rows.next()?.is_some()
    {
        return Err(corrupt("checkpoint"));
    }
    Ok(checkpoint)
}
