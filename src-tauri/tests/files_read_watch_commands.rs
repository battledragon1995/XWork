use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use xwork_lib::{
    files::{FilesError, FilesService},
    projects::{
        ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectsError,
    },
    sessions::{PaneContentDto, PaneLayoutNodeDto, SessionManager},
    storage::Storage,
};

/// Stores temporary folder selections used by the Projects picker seam.
#[derive(Default)]
struct Observations {
    selections: Mutex<Vec<PathBuf>>,
}

/// Returns only test-owned temporary project folders.
struct FakeProjectPlatform {
    observations: Arc<Observations>,
}

impl ProjectPlatform for FakeProjectPlatform {
    /// Returns the next queued temporary project root.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        let selected = self
            .observations
            .selections
            .lock()
            .expect("selection lock should work")
            .pop();
        Box::pin(async move { Ok(selected) })
    }

    /// Rejects unrelated native folder opening during automated tests.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Accepts project invalidations without delivering them outside the mock app.
struct DiscardingProjectEvents;

impl ProjectEventSink for DiscardingProjectEvents {
    /// Discards one safe project payload.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        Ok(())
    }
}

/// Owns a fully isolated Tauri app, database, and project filesystem.
struct Harness {
    app: tauri::App<tauri::test::MockRuntime>,
    observations: Arc<Observations>,
    workspace: TempDir,
    _app_data: TempDir,
}

impl Harness {
    /// Builds complete composition without any real opener or user-data path.
    fn new() -> Self {
        let app_data = TempDir::new().expect("app data should be temporary");
        let workspace = TempDir::new().expect("workspace should be temporary");
        let observations = Arc::new(Observations::default());
        let picker = observations.clone();
        let mut app = xwork_lib::app::configure_with_files_for_tests(
            tauri::test::mock_builder(),
            app_data.path().to_path_buf(),
            move |_app| {
                (
                    Arc::new(FakeProjectPlatform {
                        observations: picker,
                    }),
                    Arc::new(DiscardingProjectEvents),
                )
            },
            Arc::new(|_path| Ok(())),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app should build");
        #[allow(deprecated)]
        app.run_iteration(|_handle, _event| {});
        Self {
            app,
            observations,
            workspace,
            _app_data: app_data,
        }
    }

    /// Returns an existing window or creates an isolated mock webview.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        self.app.get_webview_window(label).unwrap_or_else(|| {
            WebviewWindowBuilder::new(&self.app, label, Default::default())
                .build()
                .expect("window should build")
        })
    }

    /// Registers a temporary project through the real Projects command.
    fn project(&self) -> (String, PathBuf) {
        let root = self.workspace.path().join("project");
        std::fs::create_dir(&root).expect("project root should be created");
        self.observations
            .selections
            .lock()
            .expect("selection lock should work")
            .push(root.clone());
        let response = invoke(&self.window("main"), "add_project", json!({}))
            .expect("project should register");
        (
            response["project"]["id"]
                .as_str()
                .expect("project id should exist")
                .to_owned(),
            root,
        )
    }

    /// Creates one session tab and returns its exact empty pane target.
    fn empty_pane(&self, project_id: &str) -> (String, String, String) {
        let manager = self.app.state::<SessionManager>();
        let session = tauri::async_runtime::block_on(manager.create_session(project_id))
            .expect("session should create");
        let detail = tauri::async_runtime::block_on(manager.create_tab(&session.summary.id))
            .expect("tab should create");
        let tab = &detail.tabs[0];
        let PaneLayoutNodeDto::Pane { pane } = &tab.layout else {
            panic!("new tab should have one pane")
        };
        (detail.summary.id, tab.id.clone(), pane.id.clone())
    }
}

/// Invokes one real command through the configured mock IPC router.
fn invoke(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.to_owned(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("url should parse"),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_owned(),
        },
    )
    .map(|response| {
        response
            .deserialize::<Value>()
            .expect("response should be JSON")
    })
}

/// Wraps the single request argument expected by Files commands.
fn request(value: Value) -> Value {
    json!({ "request": value })
}

/// Opens one relative path into a fresh empty pane.
fn open(harness: &Harness, project_id: &str, relative_path: &str) -> Result<Value, Value> {
    let (session_id, tab_id, pane_id) = harness.empty_pane(project_id);
    invoke(
        &harness.window("main"),
        "open_file_in_pane",
        request(json!({
            "sessionId": session_id, "tabId": tab_id, "paneId": pane_id, "relativePath": relative_path,
        })),
    )
}

/// Verifies migration 6, text attachment, recent metadata, and external reconciliation.
#[test]
fn text_open_watch_and_recent_are_isolated_and_read_only() {
    let harness = Harness::new();
    let (project_id, root) = harness.project();
    let path = root.join("README.md");
    std::fs::write(&path, b"first\r\nline").expect("fixture should be written");
    let before = std::fs::read(&path).expect("fixture should be readable");

    let opened = open(&harness, &project_id, "README.md").expect("file should open");
    assert_eq!(opened["file"]["state"]["kind"], "ready");
    assert_eq!(opened["file"]["state"]["content"]["kind"], "text");
    assert_eq!(
        opened["file"]["state"]["content"]["file"]["mode"],
        "markdown"
    );
    assert_eq!(
        std::fs::read(&path).expect("fixture should remain readable"),
        before
    );

    let recent = invoke(
        &harness.window("main"),
        "list_recent_files",
        json!({ "projectId": project_id, "limit": null }),
    )
    .expect("recent files should list");
    assert_eq!(
        recent.as_array().expect("recent should be an array").len(),
        1
    );
    assert_eq!(recent[0]["availability"], "available");
    assert_eq!(recent[0]["isOpen"], true);
    let search = invoke(
        &harness.window("main"),
        "search_unified",
        json!({ "input": { "query": "README", "contextProjectId": null } }),
    )
    .expect("unified search should include Files");
    let files = search["groups"]
        .as_array()
        .expect("groups should be an array")
        .iter()
        .find(|group| group["kind"] == "file")
        .expect("Files group should exist");
    assert_eq!(files["results"][0]["target"]["relativePath"], "README.md");

    std::fs::write(&path, b"changed").expect("external fixture change should succeed");
    let handle_id = opened["file"]["id"]
        .as_str()
        .expect("handle id should exist");
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let current = invoke(
            &harness.window("main"),
            "get_open_file",
            request(json!({ "fileHandleId": handle_id })),
        )
        .expect("handle should remain queryable");
        if current["state"]["content"]["file"]["text"] == "changed" {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "native watcher should converge before its bounded deadline"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(
        std::fs::read(&path).expect("changed fixture should remain readable"),
        b"changed"
    );

    let version: u32 = harness
        .app
        .state::<Storage>()
        .with_connection(|connection| {
            connection
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .map_err(|_| FilesError::RecentFilesFailed)
        })
        .expect("schema should be readable");
    assert_eq!(version, 6);
}

/// Verifies binary and oversized files attach without retaining their bytes.
#[test]
fn binary_and_oversized_files_attach_as_unsupported_content() {
    let harness = Harness::new();
    let (project_id, root) = harness.project();
    std::fs::write(root.join("binary.dat"), b"a\0b").expect("binary fixture should write");
    std::fs::write(root.join("large.txt"), vec![b'x'; 5 * 1024 * 1024 + 1])
        .expect("large fixture should write");
    let binary = open(&harness, &project_id, "binary.dat").expect("binary should attach");
    let large = open(&harness, &project_id, "large.txt").expect("large should attach");
    assert_eq!(binary["file"]["state"]["content"]["kind"], "binary");
    assert_eq!(large["file"]["state"]["content"]["kind"], "tooLarge");
    assert_eq!(
        large["file"]["state"]["content"]["limitBytes"],
        5 * 1024 * 1024
    );
}

/// Verifies non-main authorization runs before session or filesystem side effects.
#[test]
fn non_main_open_is_rejected_before_attachment() {
    let harness = Harness::new();
    let (project_id, root) = harness.project();
    std::fs::write(root.join("file.txt"), b"safe").expect("fixture should write");
    let (session_id, tab_id, pane_id) = harness.empty_pane(&project_id);
    let error = invoke(
        &harness.window("secondary"),
        "open_file_in_pane",
        request(json!({
            "sessionId": session_id, "tabId": tab_id, "paneId": pane_id, "relativePath": "file.txt",
        })),
    )
    .expect_err("secondary window should be rejected");
    assert_eq!(error["code"], "windowNotAllowed");
    let session = tauri::async_runtime::block_on(
        harness
            .app
            .state::<SessionManager>()
            .get_session(&session_id),
    )
    .expect("session should remain");
    let PaneLayoutNodeDto::Pane { pane } = &session.tabs[0].layout else {
        panic!("tab should remain simple")
    };
    assert_eq!(pane.content, PaneContentDto::Empty);
}

/// Verifies default-app failures remain typed and never modify source bytes.
#[test]
fn unavailable_default_opener_returns_typed_error_without_writing() {
    let harness = Harness::new();
    let (project_id, root) = harness.project();
    let path = root.join("image.bin");
    std::fs::write(&path, b"a\0b").expect("fixture should write");
    let opened = open(&harness, &project_id, "image.bin").expect("file should attach");
    let error = invoke(
        &harness.window("main"),
        "open_file_with_default_app",
        request(json!({
            "fileHandleId": opened["file"]["id"],
        })),
    )
    .expect_err("isolated composition should reject native opening");
    assert_eq!(error["code"], "openExternalFailed");
    assert_eq!(
        std::fs::read(path).expect("fixture should remain readable"),
        b"a\0b"
    );
}

/// Verifies typed recent reset runs inside one caller-owned transaction.
#[test]
fn recent_reset_contract_removes_metadata_without_touching_source() {
    let harness = Harness::new();
    let (project_id, root) = harness.project();
    let path = root.join("keep.txt");
    std::fs::write(&path, b"keep").expect("fixture should write");
    open(&harness, &project_id, "keep.txt").expect("file should attach");
    let storage = harness.app.state::<Storage>().inner().clone();
    let files = harness.app.state::<FilesService>().inner().clone();
    let projection = storage
        .with_transaction::<_, FilesError>(|transaction| {
            let plan = files.prepare_recent_files_reset_in(transaction)?;
            assert_eq!(plan.removed_count, 1);
            files.reset_recent_files_in(transaction, &plan)
        })
        .expect("recent reset should commit");
    files.publish_recent_files_reset(projection);
    let recent = tauri::async_runtime::block_on(files.list_recent_files(&project_id, None))
        .expect("recent list should remain readable");
    assert!(recent.is_empty());
    assert_eq!(
        std::fs::read(path).expect("source should remain readable"),
        b"keep"
    );
}
