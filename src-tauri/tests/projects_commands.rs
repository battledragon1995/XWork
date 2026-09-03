use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use rusqlite::params;
use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use xwork_lib::projects::{
    NoProjectRuntimeGuard, ProjectChangedEventDto, ProjectEventSink, ProjectFuture,
    ProjectPlatform, ProjectRuntimeGuard, ProjectRuntimeImpact, ProjectService, ProjectsError,
};
use xwork_lib::storage::{Storage, StorageError};

/// Wraps storage and SQLite failures raised inside integration callbacks.
#[derive(Debug)]
enum TestError {
    Storage,
    Sqlite,
}

impl From<StorageError> for TestError {
    /// Converts a storage-layer failure into the integration-test error type.
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

/// Reads the live schema version from an isolated integration database.
fn schema_version(storage: &Storage) -> u32 {
    storage
        .with_connection(
            // Reads the schema marker through the public storage boundary.
            |connection| {
                connection
                    .pragma_query_value(
                        None,
                        "user_version",
                        // Decodes the scalar schema marker for assertions.
                        |row| row.get::<_, u32>(0),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the schema version should be readable")
}

/// Collects every object name of one `sqlite_master` type in stable order.
fn schema_object_names(storage: &Storage, object_type: &str) -> Vec<String> {
    storage
        .with_connection(
            // Reads the created schema objects created by the registered migrations.
            |connection| {
                let mut statement = connection.prepare(
                    "SELECT name FROM sqlite_master \
                     WHERE type = ?1 AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )?;
                let names = statement
                    .query_map(
                        params![object_type],
                        // Decodes one schema object name.
                        |row| row.get::<_, String>(0),
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok::<_, TestError>(names)
            },
        )
        .expect("the schema objects should be readable")
}

/// Returns the `projects` columns as `(name, declared type, not null)` tuples.
fn projects_columns(storage: &Storage) -> Vec<(String, String, bool)> {
    storage
        .with_connection(
            // Reads the migrated column layout without depending on private models.
            |connection| {
                let mut statement = connection.prepare("PRAGMA table_info(projects)")?;
                let columns = statement
                    .query_map(
                        [],
                        // Decodes the column name, declared type, and null constraint.
                        |row| {
                            Ok((
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, i64>(3)? == 1,
                            ))
                        },
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok::<_, TestError>(columns)
            },
        )
        .expect("the column layout should be readable")
}

/// Returns the indexed columns of `idx_projects_list_order` in index order.
fn list_order_index_columns(storage: &Storage) -> Vec<(String, bool)> {
    storage
        .with_connection(
            // Reads the display-order index layout including per-column direction.
            |connection| {
                let mut statement =
                    connection.prepare("PRAGMA index_xinfo(idx_projects_list_order)")?;
                let columns = statement
                    .query_map(
                        [],
                        // Decodes the optional column name and its descending flag.
                        |row| Ok((row.get::<_, Option<String>>(2)?, row.get::<_, i64>(3)? == 1)),
                    )?
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .filter_map(
                        // Drops the trailing rowid entry that SQLite appends to every index.
                        |(name, descending)| name.map(|name| (name, descending)),
                    )
                    .collect::<Vec<_>>();
                Ok::<_, TestError>(columns)
            },
        )
        .expect("the index layout should be readable")
}

/// Describes one candidate row used to exercise the migrated constraints.
struct ProjectFixture<'a> {
    id: &'a str,
    display_name: &'a str,
    root_path: &'a str,
    path_key: &'a str,
    is_pinned: i64,
    added_at_ms: i64,
    last_opened_at_ms: i64,
}

/// Inserts one fixture row and reports whether the statement succeeded.
fn try_insert_project(storage: &Storage, fixture: &ProjectFixture<'_>) -> Result<(), TestError> {
    storage.with_connection(
        // Exercises the migrated constraints through a parameterized insert.
        |connection| {
            connection
                .execute(
                    "INSERT INTO projects(\
                         id, display_name, root_path, path_key, is_pinned, \
                         added_at_ms, last_opened_at_ms\
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        fixture.id,
                        fixture.display_name,
                        fixture.root_path,
                        fixture.path_key,
                        fixture.is_pinned,
                        fixture.added_at_ms,
                        fixture.last_opened_at_ms
                    ],
                )
                .map(
                    // Discards the affected-row count once the insert is accepted.
                    |_| (),
                )
                .map_err(TestError::from)
        },
    )
}

/// Verifies that the registered Projects migration creates its exact schema.
#[test]
fn migration_creates_projects_schema() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let storage = Storage::open(directory.path()).expect("storage should open");

    assert_eq!(schema_version(&storage), 1);
    assert_eq!(schema_object_names(&storage, "table"), vec!["projects"]);
    assert_eq!(
        schema_object_names(&storage, "index"),
        vec!["idx_projects_list_order"]
    );
    assert_eq!(
        projects_columns(&storage),
        vec![
            ("id".to_owned(), "TEXT".to_owned(), true),
            ("display_name".to_owned(), "TEXT".to_owned(), true),
            ("root_path".to_owned(), "TEXT".to_owned(), true),
            ("path_key".to_owned(), "TEXT".to_owned(), true),
            ("is_pinned".to_owned(), "INTEGER".to_owned(), true),
            ("added_at_ms".to_owned(), "INTEGER".to_owned(), true),
            ("last_opened_at_ms".to_owned(), "INTEGER".to_owned(), true),
        ]
    );
    assert_eq!(
        list_order_index_columns(&storage),
        vec![
            ("is_pinned".to_owned(), true),
            ("added_at_ms".to_owned(), false),
            ("id".to_owned(), false),
        ]
    );

    // Reopening must not rerun the migration or change the committed schema version.
    drop(storage);
    let reopened = Storage::open(directory.path()).expect("storage should reopen");
    assert_eq!(schema_version(&reopened), 1);
    assert_eq!(schema_object_names(&reopened, "table"), vec!["projects"]);
}

/// Verifies that the migrated table enforces every documented constraint.
#[test]
fn migration_enforces_projects_constraints() {
    let directory = tempfile::TempDir::new().expect("the temporary directory should be created");
    let storage = Storage::open(directory.path()).expect("storage should open");
    let valid_id = "11111111-1111-4111-8111-111111111111";

    try_insert_project(
        &storage,
        &ProjectFixture {
            id: valid_id,
            display_name: "Fixture",
            root_path: "C:\\fixture",
            path_key: "c:/fixture",
            is_pinned: 0,
            added_at_ms: 10,
            last_opened_at_ms: 10,
        },
    )
    .expect("a valid fixture row should be accepted");

    let rejected_cases: &[(&str, &str, &str, &str, i64, i64, i64)] = &[
        // A duplicate path key must be rejected by the unique constraint.
        (
            "22222222-2222-4222-8222-222222222222",
            "Other",
            "C:\\other",
            "c:/fixture",
            0,
            10,
            10,
        ),
        // An identifier that is not 36 characters long must be rejected.
        ("short-id", "Other", "C:\\other", "c:/other", 0, 10, 10),
        // A blank display name must be rejected after trimming.
        (
            "33333333-3333-4333-8333-333333333333",
            "   ",
            "C:\\other",
            "c:/other",
            0,
            10,
            10,
        ),
        // An empty root path must be rejected.
        (
            "44444444-4444-4444-8444-444444444444",
            "Other",
            "",
            "c:/other",
            0,
            10,
            10,
        ),
        // An empty path key must be rejected.
        (
            "55555555-5555-4555-8555-555555555555",
            "Other",
            "C:\\other",
            "",
            0,
            10,
            10,
        ),
        // A pinned flag outside the boolean domain must be rejected.
        (
            "66666666-6666-4666-8666-666666666666",
            "Other",
            "C:\\other",
            "c:/other",
            2,
            10,
            10,
        ),
        // A negative added timestamp must be rejected.
        (
            "77777777-7777-4777-8777-777777777777",
            "Other",
            "C:\\other",
            "c:/other",
            0,
            -1,
            10,
        ),
        // A last-opened timestamp before the added timestamp must be rejected.
        (
            "88888888-8888-4888-8888-888888888888",
            "Other",
            "C:\\other",
            "c:/other",
            0,
            10,
            9,
        ),
    ];

    for (id, display_name, root_path, path_key, is_pinned, added_at_ms, last_opened_at_ms) in
        rejected_cases
    {
        try_insert_project(
            &storage,
            &ProjectFixture {
                id,
                display_name,
                root_path,
                path_key,
                is_pinned: *is_pinned,
                added_at_ms: *added_at_ms,
                last_opened_at_ms: *last_opened_at_ms,
            },
        )
        .expect_err("the constrained fixture row should be rejected");
    }

    // A STRICT table must also reject a value whose type does not match its column.
    let strict_error = storage
        .with_connection(
            // Writes a text value into the strict integer pinned column.
            |connection| {
                connection
                    .execute(
                        "INSERT INTO projects(\
                             id, display_name, root_path, path_key, is_pinned, \
                             added_at_ms, last_opened_at_ms\
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![
                            "99999999-9999-4999-8999-999999999999",
                            "Other",
                            "C:\\other",
                            "c:/other",
                            "yes",
                            10,
                            10
                        ],
                    )
                    .map(
                        // Discards the affected-row count when the strict check unexpectedly passes.
                        |_| (),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect_err("a non-integer pinned value should be rejected by the strict table");
    assert!(matches!(strict_error, TestError::Sqlite));

    let count = storage
        .with_connection(
            // Confirms that only the single valid fixture row survived.
            |connection| {
                connection
                    .query_row(
                        "SELECT COUNT(*) FROM projects",
                        [],
                        // Decodes the aggregate row count.
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the row count should be readable");
    assert_eq!(count, 1);
}

/// Records picker, opener, and event activity of one mock application.
struct ProjectObservations {
    selections: Mutex<Vec<PathBuf>>,
    opened: Mutex<Vec<PathBuf>>,
    published: Mutex<Vec<ProjectChangedEventDto>>,
    select_calls: AtomicUsize,
    open_calls: AtomicUsize,
}

impl ProjectObservations {
    /// Creates an empty observation record shared with the mock application.
    fn new() -> Arc<Self> {
        Arc::new(Self {
            selections: Mutex::new(Vec::new()),
            opened: Mutex::new(Vec::new()),
            published: Mutex::new(Vec::new()),
            select_calls: AtomicUsize::new(0),
            open_calls: AtomicUsize::new(0),
        })
    }

    /// Queues one folder the next picker call will return.
    fn queue_selection(&self, path: PathBuf) {
        self.selections
            .lock()
            .expect("the fixture lock should be available")
            .push(path);
    }

    /// Returns every published change as a debug-kind and project-id pair.
    fn published_changes(&self) -> Vec<(String, String)> {
        self.published
            .lock()
            .expect("the fixture lock should be available")
            .iter()
            .map(
                // Reduces each payload to the two fields the assertions check.
                |event| (format!("{:?}", event.change), event.project_id.clone()),
            )
            .collect()
    }

    /// Returns how many native side effects the fakes observed in total.
    fn platform_calls(&self) -> (usize, usize) {
        (
            self.select_calls.load(Ordering::SeqCst),
            self.open_calls.load(Ordering::SeqCst),
        )
    }
}

/// Serves queued selections instead of opening a native folder picker.
struct ObservingPlatform {
    observations: Arc<ProjectObservations>,
}

impl ProjectPlatform for ObservingPlatform {
    /// Returns the next queued folder or reports a cancellation.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        self.observations
            .select_calls
            .fetch_add(1, Ordering::SeqCst);
        let selection = {
            let mut queue = self
                .observations
                .selections
                .lock()
                .expect("the fixture lock should be available");
            if queue.is_empty() {
                None
            } else {
                Some(queue.remove(0))
            }
        };
        Box::pin(async move { Ok(selection) })
    }

    /// Records the requested directory instead of opening a file manager.
    fn open_folder<'a>(&'a self, path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        self.observations.open_calls.fetch_add(1, Ordering::SeqCst);
        self.observations
            .opened
            .lock()
            .expect("the fixture lock should be available")
            .push(path.to_path_buf());
        Box::pin(async { Ok(()) })
    }
}

/// Records every published change instead of emitting to a real webview.
struct ObservingEventSink {
    observations: Arc<ProjectObservations>,
}

impl ProjectEventSink for ObservingEventSink {
    /// Records one publication attempt and always succeeds.
    fn publish(&self, event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        self.observations
            .published
            .lock()
            .expect("the fixture lock should be available")
            .push(event);
        Ok(())
    }
}

/// Owns one isolated mock application, its fixtures, and its observations.
struct TestApplication {
    app: tauri::App<tauri::test::MockRuntime>,
    observations: Arc<ProjectObservations>,
    workspace: TempDir,
    _app_data: TempDir,
}

impl TestApplication {
    /// Builds Projects composition with isolated storage and no native user interface.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let workspace = TempDir::new().expect("the temporary workspace should be created");
        let observations = ProjectObservations::new();
        let collaborators = observations.clone();
        let mut app = xwork_lib::app::configure_with_projects_for_tests(
            tauri::test::mock_builder(),
            app_data.path().to_path_buf(),
            // Replaces both native adapters so no dialog or file manager can open.
            move |_app_handle| {
                (
                    Arc::new(ObservingPlatform {
                        observations: collaborators.clone(),
                    }),
                    Arc::new(ObservingEventSink {
                        observations: collaborators,
                    }),
                )
            },
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the mock application should build");
        #[allow(deprecated)]
        app.run_iteration(
            // Advances the mock lifecycle so the setup hook manages state.
            |_app_handle, _event| {},
        );

        Self {
            app,
            observations,
            workspace,
            _app_data: app_data,
        }
    }

    /// Returns the mock webview window with the requested backend-owned label.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        // Labels are unique per application, so an existing window is reused.
        if let Some(existing) = self.app.get_webview_window(label) {
            return existing;
        }
        WebviewWindowBuilder::new(&self.app, label, Default::default())
            .build()
            .expect("the mock webview window should build")
    }

    /// Creates one workspace folder and returns its absolute path.
    fn folder(&self, name: &str) -> PathBuf {
        let path = self.workspace.path().join(name);
        std::fs::create_dir_all(&path).expect("the fixture folder should be created");
        path
    }

    /// Returns the managed project service for owner-query comparisons.
    fn service(&self) -> ProjectService {
        self.app.state::<ProjectService>().inner().clone()
    }
}

/// Invokes one command through Tauri's real IPC routing pipeline.
fn invoke(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: cmd.to_owned(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost"
                .parse()
                .expect("the mock IPC URL should parse"),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_owned(),
        },
    )
    .map(
        // Decodes successful IPC bodies into comparable JSON values.
        |response| {
            response
                .deserialize::<Value>()
                .expect("the IPC response should contain JSON")
        },
    )
}

/// Registers one workspace folder through the real add command.
fn add_project(application: &TestApplication, name: &str) -> Value {
    let main = application.window("main");
    application
        .observations
        .queue_selection(application.folder(name));
    let outcome = invoke(&main, "add_project", json!({})).expect("the project should be added");
    outcome["project"].clone()
}

/// Builds one command payload from a project identifier.
type PayloadBuilder = fn(&str) -> Value;

/// Names one command together with the payload builder its arguments need.
struct CommandCase {
    name: &'static str,
    payload: PayloadBuilder,
}

/// Lists the command names that only the main window may invoke.
const MAIN_ONLY_COMMANDS: &[CommandCase] = &[
    CommandCase {
        name: "get_project",
        payload: payload_with_id,
    },
    CommandCase {
        name: "add_project",
        payload: empty_payload,
    },
    CommandCase {
        name: "rename_project",
        payload: payload_rename,
    },
    CommandCase {
        name: "set_project_pinned",
        payload: payload_pin,
    },
    CommandCase {
        name: "open_project",
        payload: payload_with_id,
    },
    CommandCase {
        name: "locate_project_folder",
        payload: payload_with_id,
    },
    CommandCase {
        name: "open_project_folder",
        payload: payload_with_id,
    },
    CommandCase {
        name: "get_remove_project_impact",
        payload: payload_with_id,
    },
    CommandCase {
        name: "remove_project",
        payload: payload_remove,
    },
];

/// Builds an empty command payload.
fn empty_payload(_project_id: &str) -> Value {
    json!({})
}

/// Builds a payload carrying only the project identifier.
fn payload_with_id(project_id: &str) -> Value {
    json!({ "projectId": project_id })
}

/// Builds the rename payload for authorization checks.
fn payload_rename(project_id: &str) -> Value {
    json!({ "projectId": project_id, "displayName": "Renamed" })
}

/// Builds the pin payload for authorization checks.
fn payload_pin(project_id: &str) -> Value {
    json!({ "projectId": project_id, "isPinned": true })
}

/// Builds the confirmed removal payload for authorization checks.
fn payload_remove(project_id: &str) -> Value {
    json!({ "projectId": project_id, "confirmed": true })
}

/// Verifies that only main and Quick Note may read the project list.
#[test]
fn command_list_allows_main_and_quick_note_only() {
    let application = TestApplication::new();
    let project = add_project(&application, "XWork");

    for label in ["main", "quick-note"] {
        let window = application.window(label);
        let listed = invoke(&window, "list_projects", json!({ "search": Value::Null }))
            .expect("the allowed window should read the list");
        assert_eq!(listed, json!([project.clone()]));
    }

    let unauthorized = application.window("settings");
    assert_eq!(
        invoke(
            &unauthorized,
            "list_projects",
            json!({ "search": Value::Null })
        ),
        Err(json!({ "code": "unauthorizedWindow" }))
    );
}

/// Verifies that every other command rejects any caller other than main.
#[test]
fn command_mutations_reject_non_main_before_side_effects() {
    let application = TestApplication::new();
    let project = add_project(&application, "XWork");
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    let baseline_events = application.observations.published_changes();
    let baseline_calls = application.observations.platform_calls();

    for label in ["quick-note", "settings"] {
        let window = application.window(label);
        for case in MAIN_ONLY_COMMANDS {
            assert_eq!(
                invoke(&window, case.name, (case.payload)(project_id)),
                Err(json!({ "code": "unauthorizedWindow" })),
                "command {} must reject caller {label}",
                case.name
            );
        }
    }

    // An unauthorized call must not reach storage, the picker, the opener, or events.
    assert_eq!(
        application.observations.published_changes(),
        baseline_events
    );
    assert_eq!(application.observations.platform_calls(), baseline_calls);
    let main = application.window("main");
    assert_eq!(
        invoke(&main, "get_project", payload_with_id(project_id))
            .expect("the project should still exist"),
        project
    );
}

/// Verifies the exact success payload and owner-query equality of the list.
#[test]
fn command_list_matches_the_owner_query_snapshot() {
    let application = TestApplication::new();
    add_project(&application, "alpha");
    add_project(&application, "beta");
    let main = application.window("main");

    let listed = invoke(&main, "list_projects", json!({ "search": Value::Null }))
        .expect("the list should be readable");
    let owner = tauri::async_runtime::block_on(application.service().list_projects(None))
        .expect("the owner query should succeed");

    assert_eq!(
        listed,
        serde_json::to_value(&owner).expect("the owner snapshot should serialize")
    );
    let filtered = invoke(&main, "list_projects", json!({ "search": "  ALPHA " }))
        .expect("the filtered list should be readable");
    assert_eq!(filtered.as_array().expect("an array is returned").len(), 1);
    assert_eq!(
        invoke(&main, "list_projects", json!({ "search": "bad\u{7f}" })),
        Err(json!({ "code": "invalidSearch" }))
    );
}

/// Verifies that a cancelled picker returns the documented outcome without writes.
#[test]
fn command_add_reports_cancellation_without_side_effects() {
    let application = TestApplication::new();
    let main = application.window("main");

    let outcome = invoke(&main, "add_project", json!({})).expect("cancelling should succeed");

    assert_eq!(outcome, json!({ "outcome": "cancelled" }));
    assert_eq!(
        invoke(&main, "list_projects", json!({ "search": Value::Null }))
            .expect("the list should be readable"),
        json!([])
    );
    assert!(application.observations.published_changes().is_empty());
}

/// Verifies the add success shape, its committed event, and duplicate rejection.
#[test]
fn command_add_registers_the_selected_folder_once() {
    let application = TestApplication::new();
    let main = application.window("main");
    let folder = application.folder("XWork");
    application.observations.queue_selection(folder.clone());

    let outcome = invoke(&main, "add_project", json!({})).expect("the project should be added");

    let project = outcome["project"].clone();
    assert_eq!(outcome["outcome"], json!("selected"));
    assert_eq!(project["displayName"], json!("XWork"));
    assert_eq!(project["isPinned"], json!(false));
    assert_eq!(project["availability"], json!({ "status": "available" }));
    assert!(project["addedAtMs"].is_number());
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    assert_eq!(
        application.observations.published_changes(),
        vec![("Added".to_owned(), project_id.to_owned())]
    );

    // Selecting the same folder again must identify the existing project instead.
    application.observations.queue_selection(folder);
    assert_eq!(
        invoke(&main, "add_project", json!({})),
        Err(json!({ "code": "projectAlreadyExists", "project_id": project_id }))
    );
    assert_eq!(application.observations.published_changes().len(), 1);
}

/// Verifies rename, pin, and open success payloads plus their event timing.
#[test]
fn command_mutations_return_typed_results_and_emit_once() {
    let application = TestApplication::new();
    let project = add_project(&application, "XWork");
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    let main = application.window("main");

    let renamed = invoke(&main, "rename_project", payload_rename(project_id))
        .expect("the rename should succeed");
    assert_eq!(renamed["displayName"], json!("Renamed"));
    let pinned = invoke(&main, "set_project_pinned", payload_pin(project_id))
        .expect("the pin should succeed");
    assert_eq!(pinned["isPinned"], json!(true));
    let opened = invoke(&main, "open_project", payload_with_id(project_id))
        .expect("the open should succeed");
    assert!(opened["lastOpenedAtMs"].is_number());

    assert_eq!(
        application.observations.published_changes(),
        vec![
            ("Added".to_owned(), project_id.to_owned()),
            ("Updated".to_owned(), project_id.to_owned()),
            ("Updated".to_owned(), project_id.to_owned()),
            ("Updated".to_owned(), project_id.to_owned()),
        ]
    );

    // Repeating the same values is a no-op that must not publish another event.
    invoke(&main, "rename_project", payload_rename(project_id)).expect("the rename should succeed");
    invoke(&main, "set_project_pinned", payload_pin(project_id)).expect("the pin should succeed");
    assert_eq!(application.observations.published_changes().len(), 4);
}

/// Verifies the documented typed failures of every identifier-based command.
#[test]
fn command_failures_use_the_documented_error_codes() {
    let application = TestApplication::new();
    let main = application.window("main");
    let missing = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    assert_eq!(
        invoke(&main, "get_project", payload_with_id("nope")),
        Err(json!({ "code": "invalidProjectId" }))
    );
    assert_eq!(
        invoke(&main, "get_project", payload_with_id(missing)),
        Err(json!({ "code": "projectNotFound", "project_id": missing }))
    );
    assert_eq!(
        invoke(
            &main,
            "rename_project",
            json!({ "projectId": missing, "displayName": "  " })
        ),
        Err(json!({ "code": "invalidDisplayName" }))
    );

    let project = add_project(&application, "XWork");
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    std::fs::remove_dir_all(
        project["rootPath"]
            .as_str()
            .expect("the root path should be text"),
    )
    .expect("the fixture folder should be removed");
    assert_eq!(
        invoke(&main, "open_project_folder", payload_with_id(project_id)),
        Err(json!({ "code": "projectUnavailable", "reason": "missing" }))
    );
    assert_eq!(
        invoke(&main, "get_project", payload_with_id(project_id))
            .expect("the project should still exist")["availability"],
        json!({ "status": "unavailable", "reason": "missing" })
    );
}

/// Verifies that opening a folder reaches the platform port with the stored root.
#[test]
fn command_open_folder_uses_the_stored_root() {
    let application = TestApplication::new();
    let project = add_project(&application, "XWork");
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    let main = application.window("main");

    let outcome = invoke(&main, "open_project_folder", payload_with_id(project_id))
        .expect("the opener should succeed");

    assert_eq!(outcome, Value::Null);
    assert_eq!(
        *application
            .observations
            .opened
            .lock()
            .expect("the fixture lock should be available"),
        vec![PathBuf::from(
            project["rootPath"]
                .as_str()
                .expect("the root path should be text")
        )]
    );
    assert_eq!(application.observations.published_changes().len(), 1);
}

/// Verifies that relocation keeps identity while replacing only the root path.
#[test]
fn command_locate_replaces_only_the_root_path() {
    let application = TestApplication::new();
    let project = add_project(&application, "XWork");
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    let main = application.window("main");
    application
        .observations
        .queue_selection(application.folder("Moved"));

    let outcome = invoke(&main, "locate_project_folder", payload_with_id(project_id))
        .expect("the relocation should succeed");

    let relocated = outcome["project"].clone();
    assert_eq!(relocated["id"], project["id"]);
    assert_eq!(relocated["displayName"], project["displayName"]);
    assert_eq!(relocated["addedAtMs"], project["addedAtMs"]);
    assert_eq!(relocated["lastOpenedAtMs"], project["lastOpenedAtMs"]);
    assert_ne!(relocated["rootPath"], project["rootPath"]);
    assert_eq!(
        application.observations.published_changes(),
        vec![
            ("Added".to_owned(), project_id.to_owned()),
            ("Updated".to_owned(), project_id.to_owned()),
        ]
    );

    // Cancelling a later relocation keeps the project exactly as it is.
    assert_eq!(
        invoke(&main, "locate_project_folder", payload_with_id(project_id))
            .expect("cancelling should succeed"),
        json!({ "outcome": "cancelled" })
    );
    assert_eq!(application.observations.published_changes().len(), 2);
}

/// Verifies that removal requires confirmation and reports live impact facts.
#[test]
fn remove_command_requires_confirmation_first() {
    let application = TestApplication::new();
    let project = add_project(&application, "XWork");
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    let main = application.window("main");

    let impact = invoke(
        &main,
        "get_remove_project_impact",
        payload_with_id(project_id),
    )
    .expect("the impact should be readable");
    assert_eq!(
        impact,
        json!({
            "projectId": project_id,
            "displayName": project["displayName"],
            "rootPath": project["rootPath"],
            "sessionCount": 0,
            "runningProcessCount": 0,
            "unsavedFileCount": 0,
        })
    );

    let refused = invoke(
        &main,
        "remove_project",
        json!({ "projectId": project_id, "confirmed": false }),
    )
    .expect_err("an unconfirmed removal must be rejected");
    assert_eq!(refused["code"], json!("confirmationRequired"));
    assert_eq!(refused["impact"], impact);
    assert_eq!(application.observations.published_changes().len(), 1);
}

/// Verifies that a confirmed removal deletes metadata but never user files.
#[test]
fn remove_command_deletes_metadata_without_touching_the_folder() {
    let application = TestApplication::new();
    let project = add_project(&application, "XWork");
    let project_id = project["id"]
        .as_str()
        .expect("the identifier should be text");
    let root = PathBuf::from(
        project["rootPath"]
            .as_str()
            .expect("the root path should be text"),
    );
    let file_path = root.join("keep.txt");
    let bytes = b"user content that must survive removal".to_vec();
    std::fs::write(&file_path, &bytes).expect("the fixture file should be created");
    let main = application.window("main");

    let removed = invoke(&main, "remove_project", payload_remove(project_id))
        .expect("the confirmed removal should succeed");

    assert_eq!(removed, json!({ "projectId": project_id }));
    assert_eq!(
        invoke(&main, "list_projects", json!({ "search": Value::Null }))
            .expect("the list should be readable"),
        json!([])
    );
    assert_eq!(
        application.observations.published_changes(),
        vec![
            ("Added".to_owned(), project_id.to_owned()),
            ("Removed".to_owned(), project_id.to_owned()),
        ]
    );
    // The selected folder and every byte inside it must be untouched.
    assert!(root.is_dir());
    assert_eq!(
        std::fs::read(&file_path).expect("the user file should still exist"),
        bytes
    );
    assert_eq!(
        invoke(&main, "remove_project", payload_remove(project_id)),
        Err(json!({ "code": "projectNotFound", "project_id": project_id }))
    );
}

/// Verifies that the Stage 4 runtime guard reports and closes nothing.
#[test]
fn remove_uses_the_empty_stage_four_runtime_guard() {
    let guard = NoProjectRuntimeGuard;
    let project_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    let impact = tauri::async_runtime::block_on(guard.removal_impact(project_id))
        .expect("the empty guard should report an impact");
    tauri::async_runtime::block_on(guard.close_project(project_id))
        .expect("the empty guard should close nothing");
    tauri::async_runtime::block_on(guard.close_project(project_id))
        .expect("the empty guard should stay idempotent");

    assert_eq!(impact, ProjectRuntimeImpact::default());
}
