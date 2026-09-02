use rusqlite::Connection;
use std::panic::{AssertUnwindSafe, catch_unwind};
use tauri::Manager;
use xwork_lib::storage::{Storage, StorageError};

/// Verifies that successful setup builds and exposes initialized storage state.
#[test]
fn composition_root_builds_and_manages_storage() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let mut app = xwork_lib::app::configure_with_app_data_dir(
        tauri::test::mock_builder(),
        directory.path().to_path_buf(),
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .expect("the configured mock application should build");
    #[allow(deprecated)]
    app.run_iteration(
        // Advances the mock lifecycle once so Tauri executes its setup hook.
        |_app_handle, _event| {},
    );

    let storage = app.state::<Storage>();
    let version = storage
        .with_connection(
            // Reads the schema version through the managed storage handle.
            |connection| {
                connection
                    .pragma_query_value(
                        None,
                        "user_version",
                        // Decodes the managed database's schema marker.
                        |row| row.get::<_, u32>(0),
                    )
                    .map_err(
                        // Uses the storage contract to classify an unexpected read failure.
                        |source| StorageError::ReadSchemaVersion { source },
                    )
            },
        )
        .expect("managed storage should be usable");
    assert_eq!(version, 0);
}

/// Verifies that a regular file cannot be used as the app data directory.
#[test]
fn composition_root_fails_when_app_data_path_is_a_file() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let file_path = directory.path().join("not-a-directory");
    std::fs::write(&file_path, b"fixture").expect("the fixture file should be created");

    let mut app =
        xwork_lib::app::configure_with_app_data_dir(tauri::test::mock_builder(), file_path)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("building should succeed before the setup lifecycle runs");
    let result = catch_unwind(AssertUnwindSafe(
        // Runs the setup hook whose failure must stop application startup.
        || {
            #[allow(deprecated)]
            app.run_iteration(
                // Ignores runtime events because this test observes setup failure only.
                |_app_handle, _event| {},
            );
        },
    ));

    assert!(result.is_err());
}

/// Verifies that setup rejects a database newer than the production registry.
#[test]
fn composition_root_fails_for_newer_database() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let database_path = directory.path().join(Storage::DATABASE_FILE_NAME);
    let connection = Connection::open(database_path).expect("the fixture database should open");
    connection
        .pragma_update(None, "user_version", 1)
        .expect("the fixture schema version should be set");
    drop(connection);

    let mut app = xwork_lib::app::configure_with_app_data_dir(
        tauri::test::mock_builder(),
        directory.path().to_path_buf(),
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .expect("building should succeed before the setup lifecycle runs");
    let result = catch_unwind(AssertUnwindSafe(
        // Runs the setup hook whose failure must stop application startup.
        || {
            #[allow(deprecated)]
            app.run_iteration(
                // Ignores runtime events because this test observes setup failure only.
                |_app_handle, _event| {},
            );
        },
    ));

    assert!(result.is_err());
}
