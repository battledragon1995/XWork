use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior};

mod migrations;

use migrations::{MIGRATIONS, run_migrations};

/// Owns the process-wide SQLite connection shared by backend capabilities.
#[derive(Clone)]
pub struct Storage {
    connection: Arc<Mutex<Connection>>,
}

impl Storage {
    pub const DATABASE_FILE_NAME: &'static str = "xwork.sqlite3";

    /// Opens, configures, and migrates storage inside the resolved app data directory.
    pub fn open(app_data_dir: &Path) -> Result<Self, StorageError> {
        std::fs::create_dir_all(app_data_dir).map_err(
            // Preserves the I/O source under the directory-creation error category.
            |source| StorageError::CreateAppDataDirectory { source },
        )?;
        let database_path = app_data_dir.join(Self::DATABASE_FILE_NAME);
        let mut connection = Connection::open_with_flags(
            database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(
            // Preserves the SQLite source under the database-open error category.
            |source| StorageError::OpenDatabase { source },
        )?;

        configure_connection(&connection)?;
        run_migrations(&mut connection, MIGRATIONS)?;

        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    /// Serializes one read or single-statement operation on the shared connection.
    pub fn with_connection<T, E>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, E>,
    ) -> Result<T, E>
    where
        E: From<StorageError>,
    {
        let connection = self.connection.lock().map_err(
            // Hides poison details behind the stable storage error contract.
            |_| E::from(StorageError::LockPoisoned),
        )?;
        operation(&connection)
    }

    /// Runs one serialized immediate transaction and commits only on callback success.
    pub fn with_transaction<T, E>(
        &self,
        operation: impl FnOnce(&Transaction<'_>) -> Result<T, E>,
    ) -> Result<T, E>
    where
        E: From<StorageError>,
    {
        let mut connection = self.connection.lock().map_err(
            // Hides poison details behind the stable storage error contract.
            |_| E::from(StorageError::LockPoisoned),
        )?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(
                // Lets capability errors retain the classified begin failure.
                |source| E::from(StorageError::BeginTransaction { source }),
            )?;

        match operation(&transaction) {
            Ok(value) => {
                transaction.commit().map_err(
                    // Lets capability errors retain the classified commit failure.
                    |source| E::from(StorageError::CommitTransaction { source }),
                )?;
                Ok(value)
            }
            // Dropping the live transaction rolls it back while preserving the callback error.
            Err(error) => Err(error),
        }
    }
}

/// Applies every required connection setting and verifies its live value.
fn configure_connection(connection: &Connection) -> Result<(), StorageError> {
    connection
        .busy_timeout(Duration::from_millis(5_000))
        .map_err(
            // Identifies which required setting could not be applied.
            |source| StorageError::ConfigureConnection {
                pragma: "busy_timeout",
                source,
            },
        )?;
    update_pragma(connection, "foreign_keys", "ON")?;
    update_pragma(connection, "journal_mode", "WAL")?;
    update_pragma(connection, "synchronous", "NORMAL")?;

    verify_integer_pragma(connection, "foreign_keys", 1, "1")?;
    verify_text_pragma(connection, "journal_mode", "wal")?;
    verify_integer_pragma(connection, "synchronous", 1, "1")?;
    verify_integer_pragma(connection, "busy_timeout", 5_000, "5000")?;

    Ok(())
}

/// Updates one connection pragma and maps failures without exposing SQL.
fn update_pragma(
    connection: &Connection,
    pragma: &'static str,
    value: &'static str,
) -> Result<(), StorageError> {
    connection.pragma_update(None, pragma, value).map_err(
        // Attaches the public pragma name without exposing SQL.
        |source| StorageError::ConfigureConnection { pragma, source },
    )
}

/// Verifies an integer-valued connection pragma against its required value.
fn verify_integer_pragma(
    connection: &Connection,
    pragma: &'static str,
    expected_value: i64,
    expected_display: &'static str,
) -> Result<(), StorageError> {
    let actual = connection
        .pragma_query_value(
            None,
            pragma,
            // Reads the pragma's single scalar result.
            |row| row.get::<_, i64>(0),
        )
        .map_err(
            // Classifies a failed read-back as connection configuration failure.
            |source| StorageError::ConfigureConnection { pragma, source },
        )?;

    if actual != expected_value {
        return Err(StorageError::UnexpectedPragmaValue {
            pragma,
            expected: expected_display,
            actual: actual.to_string(),
        });
    }

    Ok(())
}

/// Verifies a text-valued connection pragma without case sensitivity.
fn verify_text_pragma(
    connection: &Connection,
    pragma: &'static str,
    expected: &'static str,
) -> Result<(), StorageError> {
    let actual = connection
        .pragma_query_value(
            None,
            pragma,
            // Reads the pragma's single scalar result.
            |row| row.get::<_, String>(0),
        )
        .map_err(
            // Classifies a failed read-back as connection configuration failure.
            |source| StorageError::ConfigureConnection { pragma, source },
        )?;

    if !actual.eq_ignore_ascii_case(expected) {
        return Err(StorageError::UnexpectedPragmaValue {
            pragma,
            expected,
            actual,
        });
    }

    Ok(())
}

/// Describes failures while opening, configuring, migrating, or using storage.
#[derive(Debug)]
pub enum StorageError {
    CreateAppDataDirectory {
        source: std::io::Error,
    },
    OpenDatabase {
        source: rusqlite::Error,
    },
    ConfigureConnection {
        pragma: &'static str,
        source: rusqlite::Error,
    },
    UnexpectedPragmaValue {
        pragma: &'static str,
        expected: &'static str,
        actual: String,
    },
    InvalidMigrationSet {
        version: Option<u32>,
        reason: &'static str,
    },
    ReadSchemaVersion {
        source: rusqlite::Error,
    },
    DatabaseVersionTooNew {
        found: u32,
        supported: u32,
    },
    MigrationFailed {
        version: u32,
        name: &'static str,
        source: rusqlite::Error,
    },
    LockPoisoned,
    BeginTransaction {
        source: rusqlite::Error,
    },
    CommitTransaction {
        source: rusqlite::Error,
    },
}

impl Display for StorageError {
    /// Formats a storage error without exposing SQL or persisted data.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CreateAppDataDirectory { .. } => {
                formatter.write_str("failed to create the application data directory")
            }
            Self::OpenDatabase { .. } => formatter.write_str("failed to open the database"),
            Self::ConfigureConnection { pragma, .. } => {
                write!(formatter, "failed to configure database pragma {pragma}")
            }
            Self::UnexpectedPragmaValue {
                pragma,
                expected,
                actual,
            } => write!(
                formatter,
                "database pragma {pragma} was {actual}, expected {expected}"
            ),
            Self::InvalidMigrationSet { version, reason } => match version {
                Some(version) => write!(
                    formatter,
                    "invalid migration registry at version {version}: {reason}"
                ),
                None => write!(formatter, "invalid migration registry: {reason}"),
            },
            Self::ReadSchemaVersion { .. } => {
                formatter.write_str("failed to read the database schema version")
            }
            Self::DatabaseVersionTooNew { found, supported } => write!(
                formatter,
                "database schema version {found} is newer than supported version {supported}"
            ),
            Self::MigrationFailed { version, name, .. } => {
                write!(formatter, "migration {version} ({name}) failed")
            }
            Self::LockPoisoned => formatter.write_str("the database connection lock is poisoned"),
            Self::BeginTransaction { .. } => {
                formatter.write_str("failed to begin a database transaction")
            }
            Self::CommitTransaction { .. } => {
                formatter.write_str("failed to commit a database transaction")
            }
        }
    }
}

impl Error for StorageError {
    /// Returns the underlying I/O or SQLite failure when one exists.
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::CreateAppDataDirectory { source } => Some(source),
            Self::OpenDatabase { source }
            | Self::ConfigureConnection { source, .. }
            | Self::ReadSchemaVersion { source }
            | Self::MigrationFailed { source, .. }
            | Self::BeginTransaction { source }
            | Self::CommitTransaction { source } => Some(source),
            Self::UnexpectedPragmaValue { .. }
            | Self::InvalidMigrationSet { .. }
            | Self::DatabaseVersionTooNew { .. }
            | Self::LockPoisoned => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::panic::{AssertUnwindSafe, catch_unwind};

    use rusqlite::params;
    use tempfile::TempDir;

    use super::{Storage, StorageError};

    /// Wraps storage and callback failures used by transaction tests.
    #[derive(Debug)]
    enum TestError {
        Storage(StorageError),
        Sqlite,
        Callback,
    }

    impl From<StorageError> for TestError {
        /// Converts a storage-layer failure into the test error type.
        fn from(error: StorageError) -> Self {
            Self::Storage(error)
        }
    }

    impl From<rusqlite::Error> for TestError {
        /// Converts a SQLite callback failure into the test error type.
        fn from(_error: rusqlite::Error) -> Self {
            Self::Sqlite
        }
    }

    /// Verifies that the database file name is a stable public contract.
    #[test]
    fn database_file_name_is_fixed() {
        assert_eq!(Storage::DATABASE_FILE_NAME, "xwork.sqlite3");
    }

    /// Verifies that a poisoned connection mutex maps to the documented error.
    #[test]
    fn poisoned_mutex_maps_to_storage_error() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let storage = Storage::open(directory.path()).expect("storage should open");
        let panic_result = catch_unwind(AssertUnwindSafe(
            // Contains the intentional panic so the test can inspect the poisoned lock.
            || {
                let _: Result<(), StorageError> = storage.with_connection(
                    // Poisons the mutex while the callback owns its guard.
                    |_connection| panic!("poison the storage mutex"),
                );
            },
        ));
        assert!(panic_result.is_err());

        let error = storage
            .with_connection(
                // Performs no database work because lock acquisition should fail first.
                |_connection| Ok::<(), StorageError>(()),
            )
            .expect_err("the poisoned mutex should be rejected");

        assert!(matches!(error, StorageError::LockPoisoned));
    }

    /// Verifies that failure to begin an immediate transaction is mapped safely.
    #[test]
    fn begin_failure_maps_to_storage_error() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let storage = Storage::open(directory.path()).expect("storage should open");
        storage
            .with_connection(
                // Opens a manual transaction so the next begin operation must fail.
                |connection| {
                    connection
                        .execute_batch("BEGIN IMMEDIATE")
                        .map_err(TestError::from)
                },
            )
            .expect("the manual transaction should begin");

        let error = storage
            .with_transaction(
                // Returns success if the transaction unexpectedly begins.
                |_transaction| Ok::<(), TestError>(()),
            )
            .expect_err("a nested transaction should fail to begin");

        assert!(matches!(
            error,
            TestError::Storage(StorageError::BeginTransaction { .. })
        ));
        storage
            .with_connection(
                // Cleans up the manual transaction created by this test.
                |connection| {
                    connection
                        .execute_batch("ROLLBACK")
                        .map_err(TestError::from)
                },
            )
            .expect("the manual transaction should roll back");
    }

    /// Verifies that a deferred constraint failure at commit is mapped safely.
    #[test]
    fn commit_failure_maps_to_storage_error() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let storage = Storage::open(directory.path()).expect("storage should open");
        storage
            .with_connection(
                // Creates a deferred foreign key that is checked only at commit.
                |connection| {
                    connection
                        .execute_batch(
                            "CREATE TABLE parent(id INTEGER PRIMARY KEY);\
                             CREATE TABLE child(\
                                 parent_id INTEGER,\
                                 FOREIGN KEY(parent_id) REFERENCES parent(id)\
                                     DEFERRABLE INITIALLY DEFERRED\
                             );",
                        )
                        .map_err(TestError::from)
                },
            )
            .expect("the foreign-key fixture should be created");

        let error = storage
            .with_transaction(
                // Inserts a row that remains valid until the deferred commit check.
                |transaction| {
                    transaction
                        .execute("INSERT INTO child(parent_id) VALUES (?1)", params![99])
                        .map(
                            // Discards the affected-row count after the fixture insert succeeds.
                            |_| (),
                        )
                        .map_err(TestError::from)
                },
            )
            .expect_err("the deferred foreign key should fail at commit");

        assert!(matches!(
            error,
            TestError::Storage(StorageError::CommitTransaction { .. })
        ));
    }

    /// Verifies that a callback error rolls back instead of committing its writes.
    #[test]
    fn callback_error_does_not_commit() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let storage = Storage::open(directory.path()).expect("storage should open");
        storage
            .with_connection(
                // Creates the table outside the transaction being exercised.
                |connection| {
                    connection
                        .execute("CREATE TABLE values_table(value INTEGER NOT NULL)", [])
                        .map(
                            // Discards the affected-row count after creating the fixture.
                            |_| (),
                        )
                        .map_err(TestError::from)
                },
            )
            .expect("the test table should be created");

        let error = storage
            .with_transaction(
                // Writes once and then returns the capability-owned callback error.
                |transaction| {
                    transaction
                        .execute("INSERT INTO values_table VALUES (1)", [])
                        .expect("the insert should succeed before rollback");
                    Err::<(), TestError>(TestError::Callback)
                },
            )
            .expect_err("the callback error should be returned");

        assert!(matches!(error, TestError::Callback));
        let count = storage
            .with_connection(
                // Counts rows after the failed callback releases the transaction.
                |connection| {
                    connection
                        .query_row(
                            "SELECT COUNT(*) FROM values_table",
                            [],
                            // Decodes the aggregate count from its single result row.
                            |row| row.get::<_, i64>(0),
                        )
                        .map_err(TestError::from)
                },
            )
            .expect("the row count should be readable");
        assert_eq!(count, 0);
    }
}
