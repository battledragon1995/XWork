use std::path::Path;

use xwork_lib::storage::{Storage, StorageError};

/// Wraps storage and SQLite failures used by integration tests.
#[derive(Debug)]
enum TestError {
    Storage,
    Sqlite,
    Rollback,
}

impl From<StorageError> for TestError {
    /// Converts a storage failure into the integration-test error type.
    fn from(_error: StorageError) -> Self {
        Self::Storage
    }
}

impl From<rusqlite::Error> for TestError {
    /// Converts a SQLite callback failure into the integration-test error type.
    fn from(_error: rusqlite::Error) -> Self {
        Self::Sqlite
    }
}

/// Opens storage in an isolated temporary application data directory.
fn open_storage(path: &Path) -> Storage {
    Storage::open(path).expect("storage should open in the temporary directory")
}

/// Verifies the exact database path and every required connection pragma.
#[test]
fn open_creates_exact_file_and_configures_connection() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let storage = open_storage(directory.path());

    assert!(directory.path().join(Storage::DATABASE_FILE_NAME).is_file());
    let pragmas = storage
        .with_connection(
            // Reads back the live connection settings configured during open.
            |connection| {
                let foreign_keys = connection.pragma_query_value(
                    None,
                    "foreign_keys",
                    // Decodes the live foreign-key flag.
                    |row| row.get::<_, i64>(0),
                )?;
                let journal_mode = connection.pragma_query_value(
                    None,
                    "journal_mode",
                    // Decodes the live journal-mode name.
                    |row| row.get::<_, String>(0),
                )?;
                let synchronous = connection.pragma_query_value(
                    None,
                    "synchronous",
                    // Decodes the live synchronization level.
                    |row| row.get::<_, i64>(0),
                )?;
                let busy_timeout = connection.pragma_query_value(
                    None,
                    "busy_timeout",
                    // Decodes the live timeout in milliseconds.
                    |row| row.get::<_, i64>(0),
                )?;
                Ok::<_, TestError>((foreign_keys, journal_mode, synchronous, busy_timeout))
            },
        )
        .expect("the connection pragmas should be readable");

    assert_eq!(pragmas, (1, "wal".to_owned(), 1, 5_000));
}

/// Verifies that committed data survives closing and reopening storage.
#[test]
fn committed_data_survives_reopen() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    {
        let storage = open_storage(directory.path());
        storage
            .with_transaction(
                // Creates and populates durable test data in one transaction.
                |transaction| {
                    transaction.execute_batch(
                        "CREATE TABLE durable(value TEXT NOT NULL);\
                         INSERT INTO durable VALUES ('preserved');",
                    )?;
                    Ok::<_, TestError>(())
                },
            )
            .expect("the durable transaction should commit");
    }

    let reopened = open_storage(directory.path());
    let value = reopened
        .with_connection(
            // Reads the row after a completely new open operation.
            |connection| {
                connection
                    .query_row(
                        "SELECT value FROM durable",
                        [],
                        // Decodes the durable value after reopening.
                        |row| row.get::<_, String>(0),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the committed row should survive reopening");
    assert_eq!(value, "preserved");
}

/// Verifies commit on success and rollback when the callback returns an error.
#[test]
fn transaction_commits_on_ok_and_rolls_back_on_err() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let storage = open_storage(directory.path());
    storage
        .with_connection(
            // Creates the transaction fixture table.
            |connection| {
                connection
                    .execute("CREATE TABLE entries(value INTEGER NOT NULL)", [])
                    .map(
                        // Discards the affected-row count after creating the fixture.
                        |_| (),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the fixture table should be created");

    storage
        .with_transaction(
            // Inserts the row that should be committed.
            |transaction| {
                transaction.execute("INSERT INTO entries VALUES (1)", [])?;
                Ok::<_, TestError>(())
            },
        )
        .expect("the successful callback should commit");
    let error = storage
        .with_transaction(
            // Inserts the row that should be rolled back with this callback error.
            |transaction| {
                transaction.execute("INSERT INTO entries VALUES (2)", [])?;
                Err::<(), TestError>(TestError::Rollback)
            },
        )
        .expect_err("the callback error should be preserved");

    assert!(matches!(error, TestError::Rollback));
    let values = storage
        .with_connection(
            // Reads every row after both transactions finish.
            |connection| {
                connection
                    .prepare("SELECT value FROM entries ORDER BY value")?
                    .query_map(
                        [],
                        // Decodes each committed transaction value.
                        |row| row.get::<_, i64>(0),
                    )?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(TestError::from)
            },
        )
        .expect("the committed values should be readable");
    assert_eq!(values, vec![1]);
}

/// Verifies that cloning storage shares the exact same connection allocation.
#[test]
fn clones_share_one_connection() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let storage = open_storage(directory.path());
    let clone = storage.clone();

    let first_address = storage
        .with_connection(
            // Captures only the connection address, never a borrowed reference.
            |connection| Ok::<_, StorageError>(connection as *const _ as usize),
        )
        .expect("the original handle should access the connection");
    let clone_address = clone
        .with_connection(
            // Captures the connection address through the cloned handle.
            |connection| Ok::<_, StorageError>(connection as *const _ as usize),
        )
        .expect("the cloned handle should access the connection");

    assert_eq!(first_address, clone_address);
}
