use rusqlite::Connection;
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Manager;
use xwork_lib::app::lifecycle::{
    AppLifecycleError, AppLifecycleState, AppRuntime, AppRuntimeFuture, AttentionSession,
    QuitSummaryDto,
};
use xwork_lib::storage::{Storage, StorageError};

/// Supplies an empty runtime to isolated composition tests.
struct EmptyTestRuntime;

impl AppRuntime for EmptyTestRuntime {
    /// Returns an empty Quit snapshot.
    fn quit_summary<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>> {
        Box::pin(async { Ok(QuitSummaryDto::default()) })
    }

    /// Returns no attention sessions.
    fn attention_sessions<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// Completes the empty runtime shutdown.
    fn shutdown_for_quit<'a>(&'a self) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>> {
        Box::pin(async { Ok(()) })
    }
}

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

/// Verifies storage and lifecycle state exist before tray attachment and IPC is routed.
#[test]
fn lifecycle_composition_orders_setup_and_registers_commands() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let tray_observed_state = Arc::new(AtomicBool::new(false));
    let tray_observation = tray_observed_state.clone();
    let mut app = xwork_lib::app::configure_with_lifecycle_for_tests(
        tauri::test::mock_builder(),
        directory.path().to_path_buf(),
        Arc::new(EmptyTestRuntime),
        // Proves both required states are managed before tray attachment begins.
        move |app| {
            let ready = app.try_state::<Storage>().is_some()
                && app.try_state::<AppLifecycleState>().is_some();
            tray_observation.store(ready, Ordering::SeqCst);
            Ok(())
        },
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .expect("the configured mock application should build");
    #[allow(deprecated)]
    app.run_iteration(
        // Advances the mock lifecycle once so Tauri executes its setup hook.
        |_app_handle, _event| {},
    );
    assert!(tray_observed_state.load(Ordering::SeqCst));

    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("the main mock webview should build");
    tauri::test::assert_ipc_response(
        &main,
        tauri::webview::InvokeRequest {
            cmd: "minimize_main_window".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost"
                .parse()
                .expect("the mock IPC URL should parse"),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_owned(),
        },
        Ok(serde_json::Value::Null),
    );
}
