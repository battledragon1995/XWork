use rusqlite::Connection;
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use xwork_lib::app::data_participants::{
    CliProfilesDataParticipant, ProjectsDataParticipant, SettingsDataParticipant,
};
use xwork_lib::app::lifecycle::{
    AppLifecycleError, AppLifecycleState, AppRuntime, AppRuntimeFuture, AttentionSession,
    QuitSummaryDto,
};
use xwork_lib::app::official_plugins_initialized;
use xwork_lib::projects::{
    ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectService,
    ProjectsError,
};
use xwork_lib::settings::SettingsService;
use xwork_lib::shared::DataMaintenanceGate;
use xwork_lib::storage::{Storage, StorageError};
use xwork_lib::terminal::CliProfilesService;

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

/// Rejects every native call so composition tests never open a dialog.
struct UnusedPlatform;

impl ProjectPlatform for UnusedPlatform {
    /// Fails because composition tests must not reach the native picker.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        Box::pin(async { Err(ProjectsError::FolderPickerFailed) })
    }

    /// Fails because composition tests must not reach the native opener.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Discards every published change during composition tests.
struct UnusedEventSink;

impl ProjectEventSink for UnusedEventSink {
    /// Accepts the payload without emitting it to any webview.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        Ok(())
    }
}

/// Builds Projects composition against an isolated app data directory.
fn build_isolated_app(app_data_dir: PathBuf) -> tauri::App<tauri::test::MockRuntime> {
    xwork_lib::app::configure_with_projects_for_tests(
        tauri::test::mock_builder(),
        app_data_dir,
        // Replaces both native adapters so no dialog or file manager can open.
        |_app_handle| (Arc::new(UnusedPlatform), Arc::new(UnusedEventSink)),
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .expect("the configured mock application should build")
}

/// Advances the mock lifecycle once so Tauri executes its setup hook.
fn run_setup(app: &mut tauri::App<tauri::test::MockRuntime>) {
    #[allow(deprecated)]
    app.run_iteration(
        // Ignores runtime events because these tests observe setup only.
        |_app_handle, _event| {},
    );
}

/// Reads the managed database's schema version.
fn managed_schema_version(app: &tauri::App<tauri::test::MockRuntime>) -> u32 {
    app.state::<Storage>()
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
        .expect("managed storage should be usable")
}

/// Creates one mock webview window with the requested backend-owned label.
fn window(
    app: &tauri::App<tauri::test::MockRuntime>,
    label: &str,
) -> WebviewWindow<tauri::test::MockRuntime> {
    WebviewWindowBuilder::new(app, label, Default::default())
        .build()
        .expect("the mock webview should build")
}

/// Builds one mock invoke request for the supplied command name.
fn invoke_request(cmd: &str) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: cmd.to_owned(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "http://tauri.localhost"
            .parse()
            .expect("the mock IPC URL should parse"),
        body: tauri::ipc::InvokeBody::Json(serde_json::json!({})),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_owned(),
    }
}

/// Verifies that successful setup builds and exposes initialized storage state.
#[test]
fn composition_root_builds_and_manages_storage() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let mut app = build_isolated_app(directory.path().to_path_buf());
    run_setup(&mut app);

    assert_eq!(managed_schema_version(&app), 3);
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
        || run_setup(&mut app),
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
        .pragma_update(None, "user_version", 4)
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
        || run_setup(&mut app),
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
        // Proves every required state is managed before tray attachment begins.
        move |app| {
            let ready = app.try_state::<Storage>().is_some()
                && app.try_state::<AppLifecycleState>().is_some()
                && app.try_state::<ProjectService>().is_some()
                && app.try_state::<SettingsService>().is_some()
                && app.try_state::<CliProfilesService>().is_some()
                && app.try_state::<DataMaintenanceGate>().is_some();
            tray_observation.store(ready, Ordering::SeqCst);
            Ok(())
        },
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .expect("the configured mock application should build");
    run_setup(&mut app);
    assert!(tray_observed_state.load(Ordering::SeqCst));

    let main = window(&app, "main");
    tauri::test::assert_ipc_response(
        &main,
        invoke_request("minimize_main_window"),
        Ok(serde_json::Value::Null),
    );
}

/// Verifies that startup manages storage, the gate, and one Projects capability.
#[test]
fn projects_composition_manages_storage_project_and_gate() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let mut app = build_isolated_app(directory.path().to_path_buf());
    run_setup(&mut app);

    assert_eq!(managed_schema_version(&app), 3);
    let gate = app.state::<DataMaintenanceGate>();
    let service = app.state::<ProjectService>();
    let settings = app.state::<SettingsService>();
    // The project service must receive the exact gate the composition root created.
    assert!(service.shares_gate_with(gate.inner()));
    assert!(!service.shares_gate_with(&DataMaintenanceGate::new()));
    assert!(app.try_state::<ProjectsDataParticipant>().is_some());
    assert!(settings.shares_gate_with(gate.inner()));
    assert!(app.try_state::<SettingsDataParticipant>().is_some());
    let cli_profiles = app.state::<CliProfilesService>();
    // The CLI profiles service must receive the exact gate the composition created.
    assert!(cli_profiles.shares_gate_with(gate.inner()));
    assert!(!cli_profiles.shares_gate_with(&DataMaintenanceGate::new()));
    assert!(app.try_state::<CliProfilesDataParticipant>().is_some());
    assert!(
        tauri::async_runtime::block_on(service.list_projects(None))
            .expect("the managed service should query its migrated database")
            .is_empty()
    );
}

/// Verifies that one invoke handler routes lifecycle and every Projects command.
#[test]
fn projects_composition_routes_lifecycle_and_projects_commands() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let mut app = build_isolated_app(directory.path().to_path_buf());
    run_setup(&mut app);
    let main = window(&app, "main");

    // A routed lifecycle command proves the merged handler kept its original routes.
    tauri::test::assert_ipc_response(
        &main,
        invoke_request("minimize_main_window"),
        Ok(serde_json::Value::Null),
    );
    tauri::test::assert_ipc_response(
        &main,
        invoke_request("list_projects"),
        Ok(serde_json::json!([])),
    );
    let profiles = tauri::test::get_ipc_response(&main, invoke_request("get_cli_profiles"))
        .expect("the CLI profiles command should be routed")
        .deserialize::<serde_json::Value>()
        .expect("the CLI profiles response should contain JSON");
    assert_eq!(profiles["profiles"][0]["id"], "builtin:codex");

    let settings = tauri::test::get_ipc_response(&main, invoke_request("get_settings"))
        .expect("the settings command should be routed")
        .deserialize::<serde_json::Value>()
        .expect("the settings response should contain JSON");
    assert_eq!(settings["revision"], "0");

    for command in [
        "get_project",
        "get_project_git_summary",
        "get_project_git_status",
        "add_project",
        "rename_project",
        "set_project_pinned",
        "open_project",
        "locate_project_folder",
        "open_project_folder",
        "get_remove_project_impact",
        "remove_project",
        "update_settings",
        "create_cli_profile",
        "update_cli_profile",
        "delete_cli_profile",
        "set_default_cli_shell",
        "check_cli_profile",
    ] {
        // A routed command answers with its own typed failure, never a routing error.
        let error = tauri::test::get_ipc_response(&main, invoke_request(command))
            .expect_err("an empty payload cannot satisfy these commands");
        let text = format!("{error:?}");
        assert!(
            !text.contains("not found"),
            "command {command} should be routed but answered {text}"
        );
    }
}

/// Verifies that the shared composition still initializes after every official plugin.
#[test]
fn composition_initializes_official_plugins() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let mut app = build_isolated_app(directory.path().to_path_buf());

    // Each plugin publishes its own managed state only when initialization succeeded.
    assert!(official_plugins_initialized(app.handle()));
    run_setup(&mut app);
    assert!(official_plugins_initialized(app.handle()));
}

/// Verifies that a failed startup never publishes the Projects capability.
#[test]
fn projects_composition_publishes_nothing_when_startup_fails() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let file_path = directory.path().join("not-a-directory");
    std::fs::write(&file_path, b"fixture").expect("the fixture file should be created");
    let mut app = build_isolated_app(file_path);

    let result = catch_unwind(AssertUnwindSafe(
        // Runs the setup hook whose storage failure must stop application startup.
        || run_setup(&mut app),
    ));

    assert!(result.is_err());
    assert!(app.try_state::<ProjectService>().is_none());
    assert!(app.try_state::<DataMaintenanceGate>().is_none());
    assert!(app.try_state::<ProjectsDataParticipant>().is_none());
    assert!(app.try_state::<SettingsService>().is_none());
    assert!(app.try_state::<SettingsDataParticipant>().is_none());
    assert!(app.try_state::<CliProfilesService>().is_none());
    assert!(app.try_state::<CliProfilesDataParticipant>().is_none());
}

/// Verifies that a database newer than the registry blocks the Projects capability.
#[test]
fn projects_composition_publishes_nothing_for_a_newer_database() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let database_path = directory.path().join(Storage::DATABASE_FILE_NAME);
    let connection = Connection::open(database_path).expect("the fixture database should open");
    connection
        .pragma_update(None, "user_version", 4)
        .expect("the fixture schema version should be set");
    drop(connection);
    let mut app = build_isolated_app(directory.path().to_path_buf());

    let result = catch_unwind(AssertUnwindSafe(
        // Runs the setup hook whose migration failure must stop application startup.
        || run_setup(&mut app),
    ));

    assert!(result.is_err());
    assert!(app.try_state::<ProjectService>().is_none());
    assert!(app.try_state::<DataMaintenanceGate>().is_none());
    assert!(app.try_state::<SettingsService>().is_none());
}
