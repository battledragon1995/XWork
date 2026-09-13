use super::models::*;
use rusqlite::{Connection, Row, params};

const COLUMNS: &str = "id,source_kind,source_id,source_key,kind,title,context,target_kind,project_id,target_id,tab_id,pane_id,status_code,created_at_ms,read_at_ms,occurrence_id,reminder_delivery_id,delivery_version";

/// Retains source identity privately for target validation and dedupe.
pub(crate) struct StoredNotification {
    pub dto: NotificationDto,
    pub source_id: String,
    pub source_key: String,
}

/// Maps a stored-field violation without echoing the field value.
fn corrupt(field: &str) -> NotificationError {
    NotificationError::CorruptStoredNotification {
        field: field.into(),
    }
}

/// Classifies invalid SQLite field types without exposing stored content.
fn read_field<T: rusqlite::types::FromSql>(
    row: &Row<'_>,
    index: usize,
    name: &str,
) -> Result<T, NotificationError> {
    // A type conversion failure is corruption, not an operational SQL failure.
    row.get(index).map_err(|_| corrupt(name))
}

/// Reads and validates every stored field before exposing a DTO.
fn decode(row: &Row<'_>) -> Result<StoredNotification, NotificationError> {
    let id: String = read_field(row, 0, "id")?;
    // Maps the failure to a sanitized boundary error.
    validate_id(&id).map_err(|_| corrupt("id"))?;
    let source: String = read_field(row, 1, "source_kind")?;
    let source_id: String = read_field(row, 2, "source_id")?;
    let source_key: String = read_field(row, 3, "source_key")?;
    let kind: String = read_field(row, 4, "kind")?;
    let kind = match (source.as_str(), kind.as_str()) {
        ("terminal_activity", "terminal_needs_input") => NotificationKindDto::TerminalNeedsInput,
        ("terminal_activity", "terminal_process_finished") => {
            NotificationKindDto::TerminalProcessFinished
        }
        ("terminal_activity", "terminal_process_failed") => {
            NotificationKindDto::TerminalProcessFailed
        }
        ("event_reminder", "event_reminder_due") => NotificationKindDto::EventReminderDue,
        ("event_reminder", "event_reminder_missed") => NotificationKindDto::EventReminderMissed,
        ("terminal_activity" | "event_reminder", _) => return Err(corrupt("kind")),
        _ => return Err(corrupt("source_kind")),
    };
    let title: String = read_field(row, 5, "title")?;
    let context: String = read_field(row, 6, "context")?;
    if title.is_empty() || normalize(&title, 120) != title {
        return Err(corrupt("title"));
    }
    if context.is_empty() || normalize(&context, 240) != context {
        return Err(corrupt("context"));
    }
    let target_kind: String = read_field(row, 7, "target_kind")?;
    let project_id: Option<String> = read_field(row, 8, "project_id")?;
    // Rejects malformed optional project snapshots before routing.
    if project_id.as_deref().is_some_and(|id| !uuid_valid(id)) {
        return Err(corrupt("project_id"));
    }
    let target_id: String = read_field(row, 9, "target_id")?;
    let tab_id: Option<String> = read_field(row, 10, "tab_id")?;
    let pane_id: Option<String> = read_field(row, 11, "pane_id")?;
    let status_code: Option<String> = read_field(row, 12, "status_code")?;
    let occurrence_id: Option<String> = read_field(row, 15, "occurrence_id")?;
    let delivery_id: Option<String> = read_field(row, 16, "reminder_delivery_id")?;
    let delivery_version: Option<i64> = read_field(row, 17, "delivery_version")?;
    let target = if source == "event_reminder" {
        if target_kind != "event" || tab_id.is_some() || pane_id.is_some() || status_code.is_some()
        {
            return Err(corrupt("target_kind"));
        }
        if !uuid_valid(&target_id) {
            return Err(corrupt("target_id"));
        }
        let occurrence_id = occurrence_id.ok_or_else(
            // Reports the missing field without returning stored content.
            || corrupt("occurrence_id"),
        )?;
        if !occurrence_valid(&occurrence_id) {
            return Err(corrupt("occurrence_id"));
        }
        let delivery_id = delivery_id.ok_or_else(
            // Reports the missing field without returning stored content.
            || corrupt("reminder_delivery_id"),
        )?;
        if !delivery_id_valid(&delivery_id) || source_id != delivery_id {
            return Err(corrupt("reminder_delivery_id"));
        }
        let version = delivery_version.ok_or_else(
            // Reports the missing field without returning stored content.
            || corrupt("delivery_version"),
        )?;
        if version < 1 {
            return Err(corrupt("delivery_version"));
        }
        if source_key != format!("event-reminder:{delivery_id}") {
            return Err(corrupt("source_key"));
        }
        NotificationTargetDto::EventReminder {
            project_id,
            event_id: target_id,
            occurrence_id,
            reminder_delivery_id: delivery_id,
            delivery_version: version.to_string(),
        }
    } else {
        if target_kind != "session"
            || occurrence_id.is_some()
            || delivery_id.is_some()
            || delivery_version.is_some()
        {
            return Err(corrupt("target_kind"));
        }
        let project_id = project_id.ok_or_else(
            // Reports the missing field without returning stored content.
            || corrupt("project_id"),
        )?;
        let tab_id = tab_id.ok_or_else(
            // Reports the missing field without returning stored content.
            || corrupt("tab_id"),
        )?;
        let pane_id = pane_id.ok_or_else(
            // Reports the missing field without returning stored content.
            || corrupt("pane_id"),
        )?;
        for (name, value) in [
            ("source_id", &source_id),
            ("target_id", &target_id),
            ("tab_id", &tab_id),
            ("pane_id", &pane_id),
        ] {
            if value.is_empty() || value.len() > 255
                // Restricts runtime identifiers to their existing safe alphabet.
                || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                return Err(corrupt(name));
            }
        }
        let prefix = format!("terminal:{source_id}:");
        let valid_key = if kind == NotificationKindDto::TerminalNeedsInput {
            source_key
                .strip_prefix(&format!("{prefix}attention:"))
                // Accepts only the canonical runtime sequence.
                .is_some_and(|s| s.parse::<u64>().is_ok_and(|n| n.to_string() == s))
        } else {
            source_key == format!("{prefix}process_final")
        };
        if !valid_key {
            return Err(corrupt("source_key"));
        }
        if status_code
            .as_ref()
            // Validates the canonical exit status without exposing its contents.
            .is_some_and(|s| s.parse::<i64>().map_or(true, |n| n.to_string() != *s))
            || (kind == NotificationKindDto::TerminalNeedsInput && status_code.is_some())
            || (kind == NotificationKindDto::TerminalProcessFinished
                && status_code.as_deref() != Some("0"))
        {
            return Err(corrupt("status_code"));
        }
        NotificationTargetDto::Session {
            project_id,
            session_id: target_id,
            tab_id,
            pane_id,
        }
    };
    let created: i64 = read_field(row, 13, "created_at_ms")?;
    let read: Option<i64> = read_field(row, 14, "read_at_ms")?;
    // Checks the canonical value before accepting the snapshot.
    if created < 0 || read.is_some_and(|n| n < created) {
        return Err(corrupt("timestamp"));
    }
    Ok(StoredNotification {
        source_id,
        source_key,
        dto: NotificationDto {
            id,
            kind,
            title,
            context,
            target,
            status_code,
            created_at_ms: created.to_string(),
            // Projects the verified result into the required output shape.
            read_at_ms: read.map(|n| n.to_string()),
        },
    })
}

/// Counts unread rows in the whole center using the partial index.
pub(crate) fn unread(connection: &Connection) -> Result<u32, NotificationError> {
    Ok(connection.query_row(
        "SELECT COUNT(*) FROM notifications WHERE read_at_ms IS NULL",
        [],
        // Decodes only the requested database projection.
        |row| row.get(0),
    )?)
}

/// Strictly scans remaining startup rows without retaining a full-table snapshot.
pub(crate) fn validate_all(connection: &Connection) -> Result<(), NotificationError> {
    let mut statement = connection.prepare(&format!("SELECT {COLUMNS} FROM notifications"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        decode(row)?;
    }
    Ok(())
}

/// Reads one identity for mutation or exact navigation validation.
pub(crate) fn get(
    connection: &Connection,
    id: &str,
) -> Result<StoredNotification, NotificationError> {
    let mut statement =
        connection.prepare(&format!("SELECT {COLUMNS} FROM notifications WHERE id=?1"))?;
    let mut rows = statement.query([id])?;
    decode(
        rows.next()?
            .ok_or(NotificationError::NotificationNotFound)?,
    )
}

/// Queries a bounded keyset page using the stable descending pair.
pub(crate) fn page(
    connection: &Connection,
    cursor: Option<NotificationCursorDto>,
    limit: u16,
    revision: u64,
) -> Result<NotificationPageDto, NotificationError> {
    let (time, id) = match cursor {
        Some(c) => (Some(timestamp(&c.created_at_ms)?), c.id),
        None => (None, String::new()),
    };
    let sql = if time.is_some() {
        format!(
            "SELECT {COLUMNS} FROM notifications WHERE (created_at_ms,id)<(?1,?2) ORDER BY created_at_ms DESC,id DESC LIMIT ?3"
        )
    } else {
        format!("SELECT {COLUMNS} FROM notifications ORDER BY created_at_ms DESC,id DESC LIMIT ?3")
    };
    let mut statement = connection.prepare(&sql)?;
    let mut rows = statement.query(params![time, id, u32::from(limit) + 1])?;
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        items.push(decode(row)?.dto);
    }
    let next_cursor = if items.len() > usize::from(limit) {
        items.pop();
        // Projects the verified result into the required output shape.
        items.last().map(|item| NotificationCursorDto {
            created_at_ms: item.created_at_ms.clone(),
            id: item.id.clone(),
        })
    } else {
        None
    };
    Ok(NotificationPageDto {
        revision: revision.to_string(),
        unread_count: unread(connection)?,
        items,
        next_cursor,
    })
}

/// Inserts only a new occurrence; the unique source key protects concurrent delivery.
pub(crate) fn insert(
    connection: &Connection,
    stored: &StoredNotification,
) -> Result<usize, NotificationError> {
    let dto = &stored.dto;
    let kind = match dto.kind {
        NotificationKindDto::TerminalNeedsInput => "terminal_needs_input",
        NotificationKindDto::TerminalProcessFinished => "terminal_process_finished",
        NotificationKindDto::TerminalProcessFailed => "terminal_process_failed",
        NotificationKindDto::EventReminderDue | NotificationKindDto::EventReminderMissed => {
            return Err(corrupt("kind"));
        }
    };
    let NotificationTargetDto::Session {
        project_id,
        session_id,
        tab_id,
        pane_id,
    } = &dto.target
    else {
        return Err(corrupt("target_kind"));
    };
    Ok(connection.execute("INSERT INTO notifications(id,source_kind,source_id,source_key,kind,title,context,target_kind,project_id,target_id,tab_id,pane_id,status_code,created_at_ms) VALUES(?1,'terminal_activity',?2,?3,?4,?5,?6,'session',?7,?8,?9,?10,?11,?12) ON CONFLICT(source_key) DO NOTHING",
        params![dto.id,stored.source_id,stored.source_key,kind,dto.title,dto.context,project_id,session_id,tab_id,pane_id,dto.status_code,timestamp(&dto.created_at_ms)?])?)
}

/// Resolves no-longer-active attention prompts atomically with final insertion.
pub(crate) fn read_attention(
    connection: &Connection,
    terminal: &str,
    now: i64,
) -> Result<usize, NotificationError> {
    Ok(connection.execute("UPDATE notifications SET read_at_ms=max(?1,created_at_ms) WHERE source_id=?2 AND source_kind='terminal_activity' AND kind='terminal_needs_input' AND read_at_ms IS NULL", params![now,terminal])?)
}

/// Refreshes only a newer reminder version, preserving the stable inbox identity on retries.
pub(crate) fn upsert_reminder(
    connection: &Connection,
    id: &str,
    input: &ReminderNotificationInput,
) -> Result<usize, NotificationError> {
    let kind = match input.kind {
        ReminderNotificationKind::Due => "event_reminder_due",
        ReminderNotificationKind::Missed => "event_reminder_missed",
    };
    Ok(connection.execute(
        "INSERT INTO notifications(id,source_kind,source_id,source_key,kind,title,context,target_kind,project_id,target_id,occurrence_id,reminder_delivery_id,delivery_version,created_at_ms) VALUES(?1,'event_reminder',?2,?3,?4,?5,?6,'event',?7,?8,?9,?2,?10,?11) ON CONFLICT(source_key) DO UPDATE SET kind=excluded.kind,title=excluded.title,context=excluded.context,project_id=excluded.project_id,target_id=excluded.target_id,occurrence_id=excluded.occurrence_id,delivery_version=excluded.delivery_version,created_at_ms=excluded.created_at_ms,read_at_ms=NULL WHERE notifications.delivery_version < excluded.delivery_version",
        params![id,input.delivery_id,format!("event-reminder:{}", input.delivery_id),kind,input.title,input.context,input.project_id,input.event_id,input.occurrence_id,input.delivery_version as i64,input.created_at_ms],
    )?)
}
