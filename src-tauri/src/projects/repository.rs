use rusqlite::{Connection, ErrorCode, Row, params};

use super::error::ProjectsError;
use super::models::ProjectRow;

/// Lists the persisted columns in the exact order used by every row mapping.
const PROJECT_COLUMNS: &str =
    "id, display_name, root_path, path_key, is_pinned, added_at_ms, last_opened_at_ms";

/// Orders rows exactly like `idx_projects_list_order`.
const LIST_ORDER: &str = "ORDER BY is_pinned DESC, added_at_ms ASC, id ASC";

/// Decodes one persisted project row from a SQLite result row.
fn map_row(row: &Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: row.get(0)?,
        display_name: row.get(1)?,
        root_path: row.get(2)?,
        path_key: row.get(3)?,
        // SQLite stores the pinned flag as a constrained integer rather than a boolean.
        is_pinned: row.get::<_, i64>(4)? != 0,
        added_at_ms: row.get(5)?,
        last_opened_at_ms: row.get(6)?,
    })
}

/// Reports whether a SQLite failure was caused by a uniqueness constraint.
fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == ErrorCode::ConstraintViolation
    )
}

/// Classifies a duplicate path key as the public already-registered failure.
fn duplicate_path_key_error(connection: &Connection, path_key: &str) -> ProjectsError {
    match select_id_by_path_key(connection, path_key) {
        Ok(Some(project_id)) => ProjectsError::ProjectAlreadyExists { project_id },
        // A constraint failure without an owning row is not a contract case the frontend can act on.
        Ok(None) | Err(_) => ProjectsError::PersistenceFailed,
    }
}

/// Reads every persisted project in stable display order.
pub(super) fn select_all_ordered(
    connection: &Connection,
) -> Result<Vec<ProjectRow>, ProjectsError> {
    let mut statement = connection.prepare(&format!(
        "SELECT {PROJECT_COLUMNS} FROM projects {LIST_ORDER}"
    ))?;
    let rows = statement
        .query_map([], map_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Reads project identifiers in stable display order without touching the filesystem.
pub(super) fn select_ordered_ids(connection: &Connection) -> Result<Vec<String>, ProjectsError> {
    let mut statement = connection.prepare(&format!("SELECT id FROM projects {LIST_ORDER}"))?;
    let ids = statement
        .query_map(
            [],
            // Decodes the identifier column of one ordered row.
            |row| row.get::<_, String>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ids)
}

/// Reads one persisted project by its identifier.
pub(super) fn select_by_id(
    connection: &Connection,
    project_id: &str,
) -> Result<Option<ProjectRow>, ProjectsError> {
    let mut statement = connection.prepare(&format!(
        "SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1"
    ))?;
    let mut rows = statement.query_map(params![project_id], map_row)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Reads the identifier that already owns one canonical path key.
pub(super) fn select_id_by_path_key(
    connection: &Connection,
    path_key: &str,
) -> Result<Option<String>, ProjectsError> {
    let mut statement = connection.prepare("SELECT id FROM projects WHERE path_key = ?1")?;
    let mut rows = statement.query_map(
        params![path_key],
        // Decodes the owning identifier of the matched path key.
        |row| row.get::<_, String>(0),
    )?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Inserts one new project row and classifies duplicate path keys.
pub(super) fn insert_project(
    connection: &Connection,
    row: &ProjectRow,
) -> Result<(), ProjectsError> {
    let result = connection.execute(
        &format!("INSERT INTO projects({PROJECT_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"),
        params![
            row.id,
            row.display_name,
            row.root_path,
            row.path_key,
            i64::from(row.is_pinned),
            row.added_at_ms,
            row.last_opened_at_ms
        ],
    );

    match result {
        Ok(_) => Ok(()),
        Err(error) if is_unique_violation(&error) => {
            Err(duplicate_path_key_error(connection, &row.path_key))
        }
        Err(error) => Err(ProjectsError::from(error)),
    }
}

/// Updates one project display name and reports how many rows changed.
pub(super) fn update_display_name(
    connection: &Connection,
    project_id: &str,
    display_name: &str,
) -> Result<usize, ProjectsError> {
    let changed = connection.execute(
        "UPDATE projects SET display_name = ?2 WHERE id = ?1",
        params![project_id, display_name],
    )?;
    Ok(changed)
}

/// Updates one project pinned flag and reports how many rows changed.
pub(super) fn update_pinned(
    connection: &Connection,
    project_id: &str,
    is_pinned: bool,
) -> Result<usize, ProjectsError> {
    let changed = connection.execute(
        "UPDATE projects SET is_pinned = ?2 WHERE id = ?1",
        params![project_id, i64::from(is_pinned)],
    )?;
    Ok(changed)
}

/// Updates one project last-opened timestamp and reports how many rows changed.
pub(super) fn update_last_opened(
    connection: &Connection,
    project_id: &str,
    last_opened_at_ms: i64,
) -> Result<usize, ProjectsError> {
    let changed = connection.execute(
        "UPDATE projects SET last_opened_at_ms = ?2 WHERE id = ?1",
        params![project_id, last_opened_at_ms],
    )?;
    Ok(changed)
}

/// Replaces one project root and classifies duplicate path keys.
pub(super) fn update_root(
    connection: &Connection,
    project_id: &str,
    root_path: &str,
    path_key: &str,
) -> Result<usize, ProjectsError> {
    let result = connection.execute(
        "UPDATE projects SET root_path = ?2, path_key = ?3 WHERE id = ?1",
        params![project_id, root_path, path_key],
    );

    match result {
        Ok(changed) => Ok(changed),
        Err(error) if is_unique_violation(&error) => {
            Err(duplicate_path_key_error(connection, path_key))
        }
        Err(error) => Err(ProjectsError::from(error)),
    }
}

/// Replaces every mutable field of one existing project row.
pub(super) fn update_full_row(
    connection: &Connection,
    row: &ProjectRow,
) -> Result<usize, ProjectsError> {
    let result = connection.execute(
        "UPDATE projects SET display_name = ?2, root_path = ?3, path_key = ?4, \
         is_pinned = ?5, added_at_ms = ?6, last_opened_at_ms = ?7 WHERE id = ?1",
        params![
            row.id,
            row.display_name,
            row.root_path,
            row.path_key,
            i64::from(row.is_pinned),
            row.added_at_ms,
            row.last_opened_at_ms
        ],
    );

    match result {
        Ok(changed) => Ok(changed),
        Err(error) if is_unique_violation(&error) => {
            Err(duplicate_path_key_error(connection, &row.path_key))
        }
        Err(error) => Err(ProjectsError::from(error)),
    }
}

/// Deletes one project row and reports how many rows were removed.
pub(super) fn delete_project(
    connection: &Connection,
    project_id: &str,
) -> Result<usize, ProjectsError> {
    let changed = connection.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
    Ok(changed)
}

/// Deletes every project row inside a caller-owned reset transaction.
pub(super) fn delete_all(connection: &Connection) -> Result<usize, ProjectsError> {
    let changed = connection.execute("DELETE FROM projects", [])?;
    Ok(changed)
}

#[cfg(test)]
pub(super) mod test_support {
    use rusqlite::Connection;

    /// Opens an isolated in-memory database carrying the released Projects schema.
    pub(in crate::projects) fn open_migrated_database() -> Connection {
        let connection = Connection::open_in_memory().expect("the in-memory database should open");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("the fixture pragmas should apply");
        connection
            .execute_batch(include_str!("../../migrations/0001_create_projects.sql"))
            .expect("the released migration should apply");
        connection
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::test_support::open_migrated_database;
    use super::{
        delete_all, delete_project, insert_project, select_all_ordered, select_by_id,
        select_id_by_path_key, select_ordered_ids, update_display_name, update_last_opened,
        update_pinned, update_root,
    };
    use crate::projects::error::ProjectsError;
    use crate::projects::models::ProjectRow;

    /// Builds one persisted fixture row for repository assertions.
    fn row(id: &str, name: &str, path: &str, pinned: bool, added: i64) -> ProjectRow {
        ProjectRow {
            id: id.to_owned(),
            display_name: name.to_owned(),
            root_path: path.to_owned(),
            path_key: path.to_lowercase(),
            is_pinned: pinned,
            added_at_ms: added,
            last_opened_at_ms: added,
        }
    }

    /// Builds a canonical fixture identifier from one repeated hexadecimal digit.
    fn identifier(seed: char) -> String {
        format!(
            "{a}-{b}-4{c}-8{d}-{e}",
            a = seed.to_string().repeat(8),
            b = seed.to_string().repeat(4),
            c = seed.to_string().repeat(3),
            d = seed.to_string().repeat(3),
            e = seed.to_string().repeat(12)
        )
    }

    /// Seeds one database with three rows covering pinned and unpinned order.
    fn seed(connection: &Connection) -> (String, String, String) {
        let pinned = identifier('a');
        let older = identifier('b');
        let newer = identifier('c');
        insert_project(connection, &row(&pinned, "Pinned", "/p", true, 30))
            .expect("the pinned fixture should insert");
        insert_project(connection, &row(&older, "Older", "/o", false, 10))
            .expect("the older fixture should insert");
        insert_project(connection, &row(&newer, "Newer", "/n", false, 20))
            .expect("the newer fixture should insert");
        (pinned, older, newer)
    }

    /// Verifies that inserted values decode back into the same persisted row.
    #[test]
    fn inserted_rows_decode_verbatim() {
        let connection = open_migrated_database();
        let expected = ProjectRow {
            id: identifier('a'),
            display_name: "Größe".to_owned(),
            root_path: "C:\\Work\\Größe".to_owned(),
            path_key: "c:/work/größe".to_owned(),
            is_pinned: true,
            added_at_ms: 12,
            last_opened_at_ms: 34,
        };

        insert_project(&connection, &expected).expect("the fixture row should insert");

        assert_eq!(
            select_by_id(&connection, &expected.id).expect("the row should be readable"),
            Some(expected)
        );
    }

    /// Verifies stable display order for both list queries.
    #[test]
    fn list_queries_use_the_documented_order() {
        let connection = open_migrated_database();
        let (pinned, older, newer) = seed(&connection);

        let rows = select_all_ordered(&connection).expect("the rows should be readable");
        assert_eq!(
            rows.iter()
                .map(
                    // Reduces each ordered row to its identifier.
                    |row| row.id.as_str()
                )
                .collect::<Vec<_>>(),
            vec![pinned.as_str(), older.as_str(), newer.as_str()]
        );
        assert_eq!(
            select_ordered_ids(&connection).expect("the identifiers should be readable"),
            vec![pinned, older, newer]
        );
    }

    /// Verifies that equal timestamps fall back to ascending identifier order.
    #[test]
    fn equal_timestamps_break_ties_by_identifier() {
        let connection = open_migrated_database();
        let low = identifier('a');
        let high = identifier('b');
        insert_project(&connection, &row(&high, "High", "/h", false, 10))
            .expect("the high identifier should insert");
        insert_project(&connection, &row(&low, "Low", "/l", false, 10))
            .expect("the low identifier should insert");

        assert_eq!(
            select_ordered_ids(&connection).expect("the identifiers should be readable"),
            vec![low, high]
        );
    }

    /// Verifies that a duplicate path key is reported with the owning identifier.
    #[test]
    fn duplicate_path_key_reports_the_existing_project() {
        let connection = open_migrated_database();
        let existing = identifier('a');
        insert_project(&connection, &row(&existing, "First", "/same", false, 1))
            .expect("the first fixture should insert");

        let error = insert_project(
            &connection,
            &row(&identifier('b'), "Second", "/same", false, 2),
        )
        .expect_err("the duplicate path key should be rejected");

        assert_eq!(
            error,
            ProjectsError::ProjectAlreadyExists {
                project_id: existing.clone()
            }
        );
        assert_eq!(
            select_id_by_path_key(&connection, "/same").expect("the lookup should succeed"),
            Some(existing)
        );
        assert_eq!(
            select_id_by_path_key(&connection, "/other").expect("the lookup should succeed"),
            None
        );
    }

    /// Verifies that relocating onto another project's path key is rejected.
    #[test]
    fn relocating_onto_a_taken_path_key_is_rejected() {
        let connection = open_migrated_database();
        let (pinned, older, _newer) = seed(&connection);

        let error = update_root(&connection, &older, "/P", "/p")
            .expect_err("the taken path key should be rejected");

        assert_eq!(
            error,
            ProjectsError::ProjectAlreadyExists {
                project_id: pinned.clone()
            }
        );
        let unchanged = select_by_id(&connection, &older)
            .expect("the row should be readable")
            .expect("the row should still exist");
        assert_eq!(unchanged.root_path, "/o");
        assert_eq!(unchanged.path_key, "/o");
    }

    /// Verifies affected-row counts for every single-row mutation.
    #[test]
    fn mutations_report_affected_row_counts() {
        let connection = open_migrated_database();
        let (pinned, _older, _newer) = seed(&connection);
        let missing = identifier('f');

        assert_eq!(
            update_display_name(&connection, &pinned, "Renamed").expect("the update should run"),
            1
        );
        assert_eq!(
            update_pinned(&connection, &pinned, false).expect("the update should run"),
            1
        );
        assert_eq!(
            update_last_opened(&connection, &pinned, 99).expect("the update should run"),
            1
        );
        assert_eq!(
            update_root(&connection, &pinned, "/moved", "/moved").expect("the update should run"),
            1
        );

        let updated = select_by_id(&connection, &pinned)
            .expect("the row should be readable")
            .expect("the row should still exist");
        assert_eq!(updated.display_name, "Renamed");
        assert!(!updated.is_pinned);
        assert_eq!(updated.last_opened_at_ms, 99);
        assert_eq!(updated.root_path, "/moved");
        assert_eq!(updated.path_key, "/moved");

        // A row removed by a competing operation reports zero affected rows instead of failing.
        assert_eq!(
            update_display_name(&connection, &missing, "Ghost").expect("the update should run"),
            0
        );
        assert_eq!(
            update_pinned(&connection, &missing, true).expect("the update should run"),
            0
        );
        assert_eq!(
            update_last_opened(&connection, &missing, 5).expect("the update should run"),
            0
        );
        assert_eq!(
            update_root(&connection, &missing, "/ghost", "/ghost").expect("the update should run"),
            0
        );
        assert_eq!(
            delete_project(&connection, &missing).expect("the delete should run"),
            0
        );
        assert_eq!(
            select_by_id(&connection, &missing).expect("the lookup should succeed"),
            None
        );
    }

    /// Verifies that deleting one project leaves every other project untouched.
    #[test]
    fn delete_removes_only_the_selected_project() {
        let connection = open_migrated_database();
        let (pinned, older, newer) = seed(&connection);

        assert_eq!(
            delete_project(&connection, &pinned).expect("the delete should run"),
            1
        );

        assert_eq!(
            select_ordered_ids(&connection).expect("the identifiers should be readable"),
            vec![older, newer]
        );
    }

    /// Verifies that a reset clears every project row in one statement.
    #[test]
    fn delete_all_clears_every_project() {
        let connection = open_migrated_database();
        seed(&connection);

        assert_eq!(delete_all(&connection).expect("the reset should run"), 3);

        assert!(
            select_all_ordered(&connection)
                .expect("the rows should be readable")
                .is_empty()
        );
    }

    /// Verifies that a rolled-back transaction persists no repository write.
    #[test]
    fn rolled_back_transaction_persists_nothing() {
        let mut connection = open_migrated_database();
        let created = identifier('a');
        {
            let transaction = connection
                .transaction()
                .expect("the fixture transaction should begin");
            insert_project(&transaction, &row(&created, "Temp", "/t", false, 1))
                .expect("the insert should run inside the transaction");
            transaction
                .rollback()
                .expect("the fixture transaction should roll back");
        }

        assert_eq!(
            select_by_id(&connection, &created).expect("the lookup should succeed"),
            None
        );
    }
}
