use super::{NotesError, models::*, search};
use rusqlite::{Connection, OptionalExtension, params, types::Value};
const COLUMNS: &str = "id,title,content_markdown,project_id,is_pinned,status,trashed_from,created_at_ms,updated_at_ms,archived_at_ms,trashed_at_ms,revision";
/// Encodes a lifecycle state for parameterized SQL.
pub(crate) fn status(value: &NoteStatusDto) -> &'static str {
    match value {
        NoteStatusDto::Active => "active",
        NoteStatusDto::Archived => "archived",
        NoteStatusDto::Trash => "trash",
    }
}
/// Decodes one schema-validated record.
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteDto> {
    let state: String = row.get(5)?;
    let previous: Option<String> = row.get(6)?;
    Ok(NoteDto {
        id: row.get(0)?,
        title: row.get(1)?,
        content_markdown: row.get(2)?,
        project_id: row.get(3)?,
        is_pinned: row.get(4)?,
        status: match state.as_str() {
            "active" => NoteStatusDto::Active,
            "archived" => NoteStatusDto::Archived,
            _ => NoteStatusDto::Trash,
        },
        trashed_from: previous.map(
            // Decodes the schema-constrained previous lifecycle.
            |value| {
                if value == "active" {
                    NotePreviousStatusDto::Active
                } else {
                    NotePreviousStatusDto::Archived
                }
            },
        ),
        created_at_ms: row.get(7)?,
        updated_at_ms: row.get(8)?,
        archived_at_ms: row.get(9)?,
        trashed_at_ms: row.get(10)?,
        revision: row.get::<_, i64>(11)?.to_string(),
    })
}
/// Reads one record without opening a nested storage operation.
pub(crate) fn get(db: &Connection, id: &str) -> Result<NoteDto, NotesError> {
    db.query_row(
        &format!("SELECT {COLUMNS} FROM notes WHERE id=?1"),
        [id],
        decode,
    )
    .optional()?
    .ok_or(NotesError::NoteNotFound)
}
/// Persists a complete validated row and its derived search fields.
pub(crate) fn put(db: &Connection, note: &NoteDto) -> Result<(), NotesError> {
    let previous = note.trashed_from.as_ref().map(
        // Encodes the prior lifecycle for Trash restoration.
        |value| match value {
            NotePreviousStatusDto::Active => "active",
            NotePreviousStatusDto::Archived => "archived",
        },
    );
    db.execute("INSERT INTO notes(id,title,content_markdown,project_id,is_pinned,status,trashed_from,created_at_ms,updated_at_ms,archived_at_ms,trashed_at_ms,revision,search_title,search_content) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content_markdown=excluded.content_markdown,project_id=excluded.project_id,is_pinned=excluded.is_pinned,status=excluded.status,trashed_from=excluded.trashed_from,created_at_ms=excluded.created_at_ms,updated_at_ms=excluded.updated_at_ms,archived_at_ms=excluded.archived_at_ms,trashed_at_ms=excluded.trashed_at_ms,revision=excluded.revision,search_title=excluded.search_title,search_content=excluded.search_content", params![note.id,note.title,note.content_markdown,note.project_id,note.is_pinned,status(&note.status),previous,note.created_at_ms,note.updated_at_ms,note.archived_at_ms,note.trashed_at_ms,note.revision.parse::<i64>().map_err(
// Rejects malformed durable revision input.
|_| NotesError::InvalidRevision)?,note.title.as_deref().unwrap_or("").to_lowercase(),note.content_markdown.to_lowercase()])?;
    Ok(())
}
/// Removes a revision-validated row inside the caller's transaction.
pub(crate) fn delete(db: &Connection, id: &str) -> Result<(), NotesError> {
    db.execute("DELETE FROM notes WHERE id=?1", [id])?;
    Ok(())
}
/// Reads all lifecycle rows in deterministic identity order for maintenance.
pub(crate) fn all(db: &Connection) -> Result<Vec<NoteDto>, NotesError> {
    Ok(db
        .prepare(&format!("SELECT {COLUMNS} FROM notes ORDER BY id"))?
        .query_map([], decode)?
        .collect::<Result<Vec<_>, _>>()?)
}
/// Counts the complete domain independently of list filters.
pub(crate) fn counts(db: &Connection) -> Result<NoteCountsDto, NotesError> {
    Ok(db.query_row("SELECT COALESCE(SUM(status='active'),0),COALESCE(SUM(status='archived'),0),COALESCE(SUM(status='trash'),0) FROM notes",[],
        // Decodes aggregate counts from the same storage snapshot.
        |row| Ok(NoteCountsDto { active: row.get(0)?, archived: row.get(1)?, trash: row.get(2)? }))?)
}
/// Produces bound all-token predicates without interpolating user text.
fn predicates(tokens: &[String], values: &mut Vec<Value>) -> String {
    let mut sql = String::new();
    for token in tokens {
        values.push(Value::Text(token.clone()));
        let index = values.len();
        sql.push_str(&format!(
            " AND (instr(search_title,?{index})>0 OR instr(search_content,?{index})>0)"
        ));
    }
    sql
}
/// Returns one bounded list page and consistent counts.
pub(crate) fn list(
    db: &Connection,
    input: &ListNotesInputDto,
    tokens: &[String],
) -> Result<NoteListPageDto, NotesError> {
    let mut values = vec![Value::Text(status(&input.status).into())];
    let mut filter = "status=?1".to_owned();
    match &input.project_filter {
        NoteProjectFilterDto::All => {}
        NoteProjectFilterDto::Unlinked => filter.push_str(" AND project_id IS NULL"),
        NoteProjectFilterDto::Project { project_id } => {
            values.push(Value::Text(project_id.clone()));
            filter.push_str(" AND project_id=?2");
        }
    }
    match input.pinned_filter {
        NotePinnedFilterDto::Any => {}
        NotePinnedFilterDto::Only => filter.push_str(" AND is_pinned=1"),
        NotePinnedFilterDto::Exclude => filter.push_str(" AND is_pinned=0"),
    }
    filter.push_str(&predicates(tokens, &mut values));
    let total_matches: u32 = db.query_row(
        &format!("SELECT COUNT(*) FROM notes WHERE {filter}"),
        rusqlite::params_from_iter(&values),
        // Decodes the filtered count before applying pagination.
        |row| row.get(0),
    )?;
    let order = match input.status {
        NoteStatusDto::Active => "is_pinned DESC,updated_at_ms DESC,id",
        NoteStatusDto::Archived => "archived_at_ms DESC,id",
        NoteStatusDto::Trash => "trashed_at_ms DESC,id",
    };
    values.push(Value::Integer(input.limit.into()));
    let limit = values.len();
    values.push(Value::Integer(input.offset.into()));
    let offset = values.len();
    let notes=db.prepare(&format!("SELECT {COLUMNS} FROM notes WHERE {filter} ORDER BY {order} LIMIT ?{limit} OFFSET ?{offset}"))?.query_map(rusqlite::params_from_iter(&values),decode)?.collect::<Result<Vec<_>,_>>()?;
    let items = notes
        .into_iter()
        .map(
            // Builds display-only projections for this bounded page.
            |note| search::summary(note, tokens),
        )
        .collect::<Vec<_>>();
    Ok(NoteListPageDto {
        has_more: u64::from(input.offset) + (items.len() as u64) < u64::from(total_matches),
        items,
        offset: input.offset,
        total_matches,
        counts: counts(db)?,
    })
}
/// Reads at most one extra ranked candidate to establish source truncation.
pub(crate) fn candidates(
    db: &Connection,
    tokens: &[String],
    query: &str,
    limit: u32,
) -> Result<Vec<NoteDto>, NotesError> {
    let mut values = Vec::new();
    let filter = predicates(tokens, &mut values);
    values.push(Value::Text(query.into()));
    let exact = values.len();
    let mut title_terms = Vec::new();
    for index in 1..=tokens.len() {
        title_terms.push(format!("instr(search_title,?{index})>0"));
    }
    let title = if title_terms.is_empty() {
        "1".into()
    } else {
        title_terms.join(" AND ")
    };
    values.push(Value::Integer(i64::from(limit) + 1));
    let cap = values.len();
    Ok(db.prepare(&format!("SELECT {COLUMNS} FROM notes WHERE status!='trash'{filter} ORDER BY CASE WHEN search_title=?{exact} THEN 0 WHEN instr(search_title,?{exact})=1 THEN 1 WHEN {title} THEN 2 ELSE 3 END,updated_at_ms DESC,id LIMIT ?{cap}"))?.query_map(rusqlite::params_from_iter(&values),decode)?.collect::<Result<Vec<_>,_>>()?)
}
