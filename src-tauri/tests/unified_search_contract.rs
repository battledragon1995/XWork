use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use xwork_lib::{
    platform::{
        command::StubCommandResolver, credential::InMemoryCredentialStore, shell::StubShellResolver,
    },
    projects::{
        ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectService,
        ProjectsError,
    },
    sessions::SessionManager,
    terminal::{
        CliProfileIdFactory, CliProfilesChangedDto, CliProfilesClock, CliProfilesError,
        CliProfilesEventSink,
    },
};

/// Returns one selected disposable folder and rejects native opening.
struct FixtureProjectPlatform {
    selected: Mutex<Option<PathBuf>>,
}

impl ProjectPlatform for FixtureProjectPlatform {
    /// Returns the configured disposable project folder once.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        let selected = self.selected.lock().unwrap().take();
        Box::pin(async move { Ok(selected) })
    }

    /// Rejects file-manager opening because this contract test never requests it.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Discards project invalidations after owner mutations.
struct RecordingProjectEvents {
    count: AtomicUsize,
}

impl ProjectEventSink for RecordingProjectEvents {
    /// Records one owner event without touching a webview.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        self.count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

/// Supplies a fixed timestamp to the unused CLI profile service.
struct FixedClock;

impl CliProfilesClock for FixedClock {
    /// Returns one deterministic millisecond timestamp.
    fn now_ms(&self) -> Result<i64, CliProfilesError> {
        Ok(1_700_000_000_000)
    }
}

/// Supplies deterministic identifiers to the unused CLI profile service.
struct FixedIds;

impl CliProfileIdFactory for FixedIds {
    /// Returns one canonical custom-profile identifier.
    fn new_profile_id(&self) -> String {
        "profile-00000001-0000-4000-8000-000000000000".into()
    }

    /// Returns one opaque credential account.
    fn new_credential_account(&self) -> String {
        "00000001-0000-4000-8000-aaaaaaaaaaaa".into()
    }
}

/// Discards CLI profile invalidations in isolated composition.
struct DiscardingCliEvents;

impl CliProfilesEventSink for DiscardingCliEvents {
    /// Accepts one event without publishing it to a webview.
    fn publish(&self, _event: CliProfilesChangedDto) -> Result<(), CliProfilesError> {
        Ok(())
    }
}

/// Advances the mock runtime once so Tauri executes setup.
fn run_setup(app: &mut tauri::App<tauri::test::MockRuntime>) {
    #[allow(deprecated)]
    app.run_iteration(|_app, _event| {});
}

/// Creates one mock window with the requested caller label.
fn window(
    app: &tauri::App<tauri::test::MockRuntime>,
    label: &str,
) -> WebviewWindow<tauri::test::MockRuntime> {
    WebviewWindowBuilder::new(app, label, Default::default())
        .build()
        .unwrap()
}

/// Builds one JSON IPC request for a registered command.
fn request(command: &str, body: serde_json::Value) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: command.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.into(),
    }
}

/// Invokes one command and decodes its successful JSON response.
fn invoke(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    tauri::test::get_ipc_response(window, request(command, body))
        .unwrap()
        .deserialize()
        .unwrap()
}

/// Builds isolated production composition around disposable owner collaborators.
fn build_app(
    app_data: PathBuf,
    project_root: PathBuf,
    project_events: Arc<RecordingProjectEvents>,
) -> tauri::App<tauri::test::MockRuntime> {
    xwork_lib::app::configure_with_search_for_tests(
        tauri::test::mock_builder(),
        app_data,
        move |_app| {
            (
                Arc::new(FixtureProjectPlatform {
                    selected: Mutex::new(Some(project_root)),
                }),
                project_events,
            )
        },
        |_app| {
            (
                Arc::new(StubCommandResolver::new()),
                Arc::new(StubShellResolver::windows_like()),
                Arc::new(InMemoryCredentialStore::new()),
                Arc::new(DiscardingCliEvents),
                Arc::new(FixedClock),
                Arc::new(FixedIds),
            )
        },
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .unwrap()
}

/// Verifies real public project, session, and shortcut queries through the IPC boundary.
#[test]
fn unified_search_uses_real_phase_one_owner_queries() {
    let app_data = tempfile::TempDir::new().unwrap();
    let project_parent = tempfile::TempDir::new().unwrap();
    let project_root = project_parent.path().join("xwork-search-fixture");
    std::fs::create_dir(&project_root).unwrap();
    let project_events = Arc::new(RecordingProjectEvents {
        count: AtomicUsize::new(0),
    });
    let mut app = build_app(
        app_data.path().to_path_buf(),
        project_root.clone(),
        project_events.clone(),
    );
    run_setup(&mut app);
    let main = window(&app, "main");

    let added = invoke(&main, "add_project", serde_json::json!({}));
    let project_id = added["project"]["id"].as_str().unwrap().to_owned();
    invoke(
        &main,
        "rename_project",
        serde_json::json!({"projectId": project_id, "displayName": "Unified Workspace"}),
    );
    invoke(
        &main,
        "set_project_pinned",
        serde_json::json!({"projectId": project_id, "isPinned": true}),
    );
    let created = invoke(
        &main,
        "create_session",
        serde_json::json!({"projectId": project_id}),
    );
    let session_id = created["summary"]["id"].as_str().unwrap().to_owned();
    invoke(
        &main,
        "rename_session",
        serde_json::json!({"sessionId": session_id, "name": "Build Session"}),
    );
    let owner_event_count = project_events.count.load(Ordering::SeqCst);

    let response = invoke(
        &main,
        "search_unified",
        serde_json::json!({
            "input": {"query": "build", "contextProjectId": project_id}
        }),
    );
    assert_eq!(response["query"], "build");
    assert_eq!(response["groups"][0]["kind"], "session");
    assert_eq!(
        response["groups"][0]["results"][0]["target"]["projectId"],
        project_id
    );
    assert_eq!(
        response["groups"][0]["results"][0]["target"]["sessionId"],
        session_id
    );

    let command_response = invoke(
        &main,
        "search_unified",
        serde_json::json!({
            "input": {"query": "pty", "contextProjectId": project_id}
        }),
    );
    let command_results = command_response["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["kind"] == "command")
        .unwrap()["results"]
        .as_array()
        .unwrap();
    assert_eq!(command_results.len(), 2);
    assert!(
        command_results
            .iter()
            .any(|item| item["target"]["actionId"] == "sessions.create_current_project")
    );
    assert!(
        command_results
            .iter()
            .any(|item| item["target"]["actionId"] == "settings.open_cli_profiles")
    );

    invoke(
        &main,
        "set_keyboard_shortcut",
        serde_json::json!({
            "actionId": "tabs.create",
            "chord": {"primary": true, "alt": false, "shift": false, "keyCode": "KeyW"}
        }),
    );
    let shortcut_response = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "new tab", "contextProjectId": null}}),
    );
    let shortcut = &shortcut_response["groups"][0]["results"][0]["shortcut"];
    assert_eq!(shortcut["keyCode"], "KeyW");
    assert_eq!(shortcut["isConflicted"], true);

    let projects_before =
        tauri::async_runtime::block_on(app.state::<ProjectService>().list_projects(None)).unwrap();
    let sessions_before =
        tauri::async_runtime::block_on(app.state::<SessionManager>().list_sessions(None)).unwrap();
    invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "unified build", "contextProjectId": null}}),
    );
    assert_eq!(
        tauri::async_runtime::block_on(app.state::<ProjectService>().list_projects(None)).unwrap(),
        projects_before
    );
    assert_eq!(
        tauri::async_runtime::block_on(app.state::<SessionManager>().list_sessions(None)).unwrap(),
        sessions_before
    );
    assert_eq!(
        project_events.count.load(Ordering::SeqCst),
        owner_event_count
    );

    std::fs::remove_dir(&project_root).unwrap();
    let unavailable = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "unified", "contextProjectId": project_id}}),
    );
    assert_eq!(unavailable["groups"][0]["kind"], "project");
    let unavailable_commands = unavailable["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["kind"] == "command")
        .map(|group| group["results"].as_array().unwrap());
    assert!(unavailable_commands.is_none_or(|results| {
        results
            .iter()
            .all(|item| item["target"]["actionId"] != "sessions.create_current_project")
    }));

    invoke(
        &main,
        "close_runtime_target",
        serde_json::json!({
            "target": {"kind": "session", "sessionId": session_id},
            "confirmed": true
        }),
    );
    let after_session_delete = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "build", "contextProjectId": null}}),
    );
    assert!(
        after_session_delete["groups"]
            .as_array()
            .unwrap()
            .iter()
            .all(|group| group["kind"] != "session")
    );

    invoke(
        &main,
        "remove_project",
        serde_json::json!({"projectId": project_id, "confirmed": true}),
    );
    let after_project_delete = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "", "contextProjectId": project_id}}),
    );
    assert!(
        after_project_delete["groups"][0]["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["target"]["actionId"] != "sessions.create_current_project")
    );
}

/// Verifies caller and input validation return typed errors at the command boundary.
#[test]
fn unified_search_authorizes_and_validates_before_querying() {
    let app_data = tempfile::TempDir::new().unwrap();
    let project_parent = tempfile::TempDir::new().unwrap();
    let project_root = project_parent.path().join("xwork-search-fixture");
    std::fs::create_dir(&project_root).unwrap();
    let mut app = build_app(
        app_data.path().to_path_buf(),
        project_root,
        Arc::new(RecordingProjectEvents {
            count: AtomicUsize::new(0),
        }),
    );
    run_setup(&mut app);
    let quick_note = window(&app, "quick-note");
    let unauthorized = tauri::test::get_ipc_response(
        &quick_note,
        request(
            "search_unified",
            serde_json::json!({
                "input": {"query": "x", "contextProjectId": null}
            }),
        ),
    )
    .unwrap_err();
    assert_eq!(
        unauthorized,
        serde_json::json!({"code": "unauthorized_window"})
    );

    let main = window(&app, "main");
    let invalid = tauri::test::get_ipc_response(
        &main,
        request(
            "search_unified",
            serde_json::json!({
                "input": {"query": "ok\nno", "contextProjectId": null}
            }),
        ),
    )
    .unwrap_err();
    assert_eq!(invalid, serde_json::json!({"code": "invalid_query"}));
}
