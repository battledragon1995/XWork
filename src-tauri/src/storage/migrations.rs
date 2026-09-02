use rusqlite::{Connection, TransactionBehavior};

use super::StorageError;

/// Describes one immutable, embedded schema migration.
pub(crate) struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

/// Lists the business-schema migrations supported by this binary.
pub(crate) const MIGRATIONS: &[Migration] = &[];

/// Applies every missing migration after validating the complete registry.
pub(crate) fn run_migrations(
    connection: &mut Connection,
    migrations: &[Migration],
) -> Result<(), StorageError> {
    validate_migrations(migrations)?;

    let current_version = connection
        .pragma_query_value(
            None,
            "user_version",
            // Decodes the schema marker into the registry's version type.
            |row| row.get::<_, u32>(0),
        )
        .map_err(
            // Separates schema-version reads from migration execution failures.
            |source| StorageError::ReadSchemaVersion { source },
        )?;
    let supported_version = migrations.last().map_or(
        0,
        // Uses the final contiguous entry as the binary's supported ceiling.
        |migration| migration.version,
    );

    if current_version > supported_version {
        return Err(StorageError::DatabaseVersionTooNew {
            found: current_version,
            supported: supported_version,
        });
    }

    for migration in migrations.iter().filter(
        // Selects only versions that the database has not already applied.
        |migration| migration.version > current_version,
    ) {
        // Each version owns a transaction so a failure preserves the last fully applied version.
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(
                // Attributes a begin failure to the migration it prevented.
                |source| StorageError::MigrationFailed {
                    version: migration.version,
                    name: migration.name,
                    source,
                },
            )?;

        transaction
            .execute_batch(migration.sql)
            .and_then(
                // The schema marker commits atomically with the SQL for this exact version.
                |()| transaction.pragma_update(None, "user_version", migration.version),
            )
            .and_then(
                // Commits only after both migration SQL and its version marker succeed.
                |()| transaction.commit(),
            )
            .map_err(
                // Reports the safe migration identity while retaining the SQLite source.
                |source| StorageError::MigrationFailed {
                    version: migration.version,
                    name: migration.name,
                    source,
                },
            )?;
    }

    Ok(())
}

/// Rejects malformed registries before the runner can execute migration SQL.
fn validate_migrations(migrations: &[Migration]) -> Result<(), StorageError> {
    for (index, migration) in migrations.iter().enumerate() {
        if migration.version > i32::MAX as u32 {
            return Err(StorageError::InvalidMigrationSet {
                version: Some(migration.version),
                reason: "version exceeds the SQLite user_version range",
            });
        }

        let expected_version = index as u32 + 1;
        if migration.version != expected_version {
            return Err(StorageError::InvalidMigrationSet {
                version: Some(migration.version),
                reason: "versions must start at 1 and increase contiguously",
            });
        }

        if migration.name.trim().is_empty() {
            return Err(StorageError::InvalidMigrationSet {
                version: Some(migration.version),
                reason: "name must not be empty",
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{Migration, run_migrations};
    use crate::storage::StorageError;

    /// Creates an in-memory database for an isolated migration test.
    fn open_test_database() -> Connection {
        Connection::open_in_memory().expect("the in-memory database should open")
    }

    /// Reads the current schema version from a test database.
    fn schema_version(connection: &Connection) -> u32 {
        connection
            .pragma_query_value(
                None,
                "user_version",
                // Decodes the scalar schema marker for assertions.
                |row| row.get(0),
            )
            .expect("the schema version should be readable")
    }

    /// Reports whether a table exists in a test database.
    fn table_exists(connection: &Connection, table_name: &str) -> bool {
        connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                [table_name],
                // Decodes SQLite's boolean existence result.
                |row| row.get(0),
            )
            .expect("the schema should be readable")
    }

    /// Verifies that an empty production-style registry is valid.
    #[test]
    fn empty_registry_is_valid() {
        let mut connection = open_test_database();

        run_migrations(&mut connection, &[]).expect("an empty registry should be valid");

        assert_eq!(schema_version(&connection), 0);
    }

    /// Verifies that every invalid registry shape is rejected before SQL runs.
    #[test]
    fn invalid_registries_are_rejected_before_sql_runs() {
        let cases: &[&[Migration]] = &[
            &[Migration {
                version: 2,
                name: "starts_late",
                sql: "CREATE TABLE marker(value INTEGER);",
            }],
            &[
                Migration {
                    version: 1,
                    name: "first",
                    sql: "CREATE TABLE marker(value INTEGER);",
                },
                Migration {
                    version: 3,
                    name: "gap",
                    sql: "CREATE TABLE later(value INTEGER);",
                },
            ],
            &[
                Migration {
                    version: 1,
                    name: "first",
                    sql: "CREATE TABLE marker(value INTEGER);",
                },
                Migration {
                    version: 1,
                    name: "duplicate",
                    sql: "CREATE TABLE later(value INTEGER);",
                },
            ],
            &[Migration {
                version: 1,
                name: "",
                sql: "CREATE TABLE marker(value INTEGER);",
            }],
            &[Migration {
                version: i32::MAX as u32 + 1,
                name: "out_of_range",
                sql: "CREATE TABLE marker(value INTEGER);",
            }],
        ];

        for migrations in cases {
            let mut connection = open_test_database();
            let error = run_migrations(&mut connection, migrations)
                .expect_err("the invalid registry should be rejected");

            assert!(matches!(error, StorageError::InvalidMigrationSet { .. }));
            assert!(!table_exists(&connection, "marker"));
            assert!(!table_exists(&connection, "later"));
            assert_eq!(schema_version(&connection), 0);
        }
    }

    /// Verifies that missing migrations execute in ascending registry order.
    #[test]
    fn migrations_apply_in_ascending_order() {
        let mut connection = open_test_database();
        let migrations = [
            Migration {
                version: 1,
                name: "create_steps",
                sql: "CREATE TABLE steps(value INTEGER NOT NULL); INSERT INTO steps VALUES (1);",
            },
            Migration {
                version: 2,
                name: "append_step",
                sql: "INSERT INTO steps SELECT MAX(value) + 1 FROM steps;",
            },
        ];

        run_migrations(&mut connection, &migrations).expect("the migrations should succeed");

        let values = connection
            .prepare("SELECT value FROM steps ORDER BY value")
            .expect("the query should prepare")
            .query_map(
                [],
                // Decodes each ordered fixture value.
                |row| row.get::<_, i64>(0),
            )
            .expect("the query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("the rows should decode");
        assert_eq!(values, vec![1, 2]);
        assert_eq!(schema_version(&connection), 2);
    }

    /// Verifies that versions at or below the current schema are not reapplied.
    #[test]
    fn applied_versions_are_skipped() {
        let mut connection = open_test_database();
        connection
            .execute_batch(
                "CREATE TABLE steps(value INTEGER NOT NULL); INSERT INTO steps VALUES (1); PRAGMA user_version = 1;",
            )
            .expect("the initial schema should be created");
        let migrations = [
            Migration {
                version: 1,
                name: "must_not_repeat",
                sql: "INSERT INTO missing_table VALUES (1);",
            },
            Migration {
                version: 2,
                name: "append_step",
                sql: "INSERT INTO steps VALUES (2);",
            },
        ];

        run_migrations(&mut connection, &migrations).expect("only the missing version should run");

        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM steps",
                [],
                // Decodes the aggregate fixture count.
                |row| row.get(0),
            )
            .expect("the row count should be readable");
        assert_eq!(count, 2);
        assert_eq!(schema_version(&connection), 2);
    }

    /// Verifies that a failed version is atomic and prevents later migrations.
    #[test]
    fn failed_migration_rolls_back_and_blocks_later_versions() {
        let mut connection = open_test_database();
        let migrations = [
            Migration {
                version: 1,
                name: "create_steps",
                sql: "CREATE TABLE steps(value INTEGER NOT NULL); INSERT INTO steps VALUES (1);",
            },
            Migration {
                version: 2,
                name: "fail_atomically",
                sql: "CREATE TABLE rolled_back(value INTEGER); INSERT INTO steps VALUES (2); INVALID SQL;",
            },
            Migration {
                version: 3,
                name: "must_not_run",
                sql: "CREATE TABLE later(value INTEGER);",
            },
        ];

        let error = run_migrations(&mut connection, &migrations)
            .expect_err("the second migration should fail");

        assert!(matches!(
            error,
            StorageError::MigrationFailed {
                version: 2,
                name: "fail_atomically",
                ..
            }
        ));
        let values = connection
            .prepare("SELECT value FROM steps ORDER BY value")
            .expect("the query should prepare")
            .query_map(
                [],
                // Decodes each value that survived the failed migration.
                |row| row.get::<_, i64>(0),
            )
            .expect("the query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("the rows should decode");
        assert_eq!(values, vec![1]);
        assert!(!table_exists(&connection, "rolled_back"));
        assert!(!table_exists(&connection, "later"));
        assert_eq!(schema_version(&connection), 1);
    }

    /// Verifies that a newer database is rejected without schema or data changes.
    #[test]
    fn newer_database_is_rejected_without_changes() {
        let mut connection = open_test_database();
        connection
            .execute_batch(
                "CREATE TABLE existing(value INTEGER NOT NULL); INSERT INTO existing VALUES (7); PRAGMA user_version = 2;",
            )
            .expect("the newer schema fixture should be created");
        let migrations = [Migration {
            version: 1,
            name: "older_binary",
            sql: "CREATE TABLE marker(value INTEGER);",
        }];

        let error = run_migrations(&mut connection, &migrations)
            .expect_err("the newer database should be rejected");

        assert!(matches!(
            error,
            StorageError::DatabaseVersionTooNew {
                found: 2,
                supported: 1
            }
        ));
        let value: i64 = connection
            .query_row(
                "SELECT value FROM existing",
                [],
                // Decodes the pre-existing row after rejection.
                |row| row.get(0),
            )
            .expect("the existing row should remain readable");
        assert_eq!(value, 7);
        assert!(!table_exists(&connection, "marker"));
        assert_eq!(schema_version(&connection), 2);
        assert_eq!(connection.total_changes(), 1);
    }
}
