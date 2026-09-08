use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use xwork_lib::{
    files::{FileEditorSnapshot, FilesService},
    projects::{
        ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectsError,
    },
    sessions::{PaneLayoutNodeDto, SessionManager},
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

/// Verifies that the existing edit hook counts BOM bytes and derives line metadata.
#[test]
fn edit_hook_preserves_exact_metadata() {
    let harness = Harness::new();
    let (project, root) = harness.project();
    std::fs::write(root.join("a.md"), b"\xEF\xBB\xBFbase").unwrap();
    let opened = open(&harness, &project, "a.md").unwrap();
    let file = &opened["file"];
    let updated = tauri::async_runtime::block_on(
        harness.app.state::<FilesService>().replace_editor_snapshot(
            file["id"].as_str().unwrap(),
            FileEditorSnapshot {
                text: "mới\r\nline\n".into(),
                expected_handle_revision: file["revision"].as_str().unwrap().into(),
                base_disk_revision: file["state"]["disk"]["diskRevision"]
                    .as_str()
                    .unwrap()
                    .into(),
            },
        ),
    )
    .unwrap();
    let serialized = serde_json::to_value(updated).unwrap();
    assert_eq!(
        serialized["state"]["content"]["file"]["byteSize"],
        "mới\r\nline\n".len() + 3
    );
    assert_eq!(
        serialized["state"]["content"]["file"]["lineEnding"],
        "mixed"
    );
    assert_eq!(
        std::fs::read(root.join("a.md")).unwrap(),
        b"\xEF\xBB\xBFbase"
    );
}

/// Verifies that real IPC routes the two manual edit and save commands.
#[test]
fn manual_save_round_trips_exact_bytes() {
    let harness = Harness::new();
    let (project, root) = harness.project();
    std::fs::write(root.join("a.md"), b"base").unwrap();
    let opened = open(&harness, &project, "a.md").unwrap();
    let file = &opened["file"];
    let updated = invoke(
        &harness.window("main"),
        "update_markdown_buffer",
        request(json!({
            "fileHandleId": file["id"], "expectedRevision": file["revision"],
            "baseDiskRevision": file["state"]["disk"]["diskRevision"], "text": "mới\r\n"
        })),
    )
    .unwrap();
    assert_eq!(std::fs::read(root.join("a.md")).unwrap(), b"base");
    let saved = invoke(
        &harness.window("main"),
        "save_markdown_file",
        request(json!({
            "fileHandleId": file["id"], "expectedRevision": updated["revision"]
        })),
    )
    .unwrap();
    assert_eq!(saved["outcome"], "saved");
    assert_eq!(saved["file"]["isDirty"], false);
    assert_eq!(
        std::fs::read(root.join("a.md")).unwrap(),
        "mới\r\n".as_bytes()
    );
}

/// Updates a handle through the real command using its currently displayed base.
fn edit(harness: &Harness, file: &Value, text: &str) -> Result<Value, Value> {
    let disk = if file["state"]["kind"] == "externalConflict" {
        &file["state"]["external"]
    } else {
        &file["state"]["disk"]
    };
    invoke(
        &harness.window("main"),
        "update_markdown_buffer",
        request(json!({
            "fileHandleId": file["id"], "expectedRevision": file["revision"], "baseDiskRevision": disk["diskRevision"], "text": text,
        })),
    )
}

/// Saves an acknowledged handle through the real command.
fn save(harness: &Harness, file: &Value) -> Result<Value, Value> {
    invoke(
        &harness.window("main"),
        "save_markdown_file",
        request(json!({ "fileHandleId": file["id"], "expectedRevision": file["revision"] })),
    )
}

/// Queries the current handle after synchronous watcher reconciliation.
fn current(harness: &Harness, file: &Value) -> Value {
    invoke(
        &harness.window("main"),
        "get_open_file",
        request(json!({ "fileHandleId": file["id"] })),
    )
    .unwrap()
}

/// Checks exact BOM boundary, token validation, stale retries, and clean manual save.
#[test]
fn validation_and_exact_bom_boundary_preserve_state() {
    let harness = Harness::new();
    let (project, root) = harness.project();
    std::fs::write(root.join("a.md"), b"\xef\xbb\xbfbase").unwrap();
    let opened = open(&harness, &project, "a.md").unwrap()["file"].clone();
    assert_eq!(save(&harness, &opened).unwrap()["outcome"], "alreadyClean");
    assert_eq!(
        edit(&harness, &opened, &"x".repeat(5_242_878)).unwrap_err()["code"],
        "markdownSizeLimitExceeded"
    );
    assert_eq!(current(&harness, &opened), opened);
    let exact = edit(&harness, &opened, &"x".repeat(5_242_877)).unwrap();
    assert_eq!(exact["state"]["content"]["file"]["byteSize"], 5_242_880);
    assert_eq!(
        edit(&harness, &opened, &"x".repeat(5_242_877)).unwrap(),
        exact
    );
    assert_eq!(
        edit(&harness, &opened, "stale").unwrap_err()["code"],
        "revisionConflict"
    );
    let clean = edit(&harness, &exact, "base").unwrap();
    assert_eq!(clean["isDirty"], false);
    for revision in ["", "+1", " 1", "18446744073709551616"] {
        let mut invalid = clean.clone();
        invalid["revision"] = json!(revision);
        assert_eq!(
            save(&harness, &invalid).unwrap_err()["code"],
            "invalidRevision"
        );
    }
    for disk in ["", "bad\n", &"x".repeat(129)] {
        let mut invalid = clean.clone();
        invalid["state"]["disk"]["diskRevision"] = json!(disk);
        assert_eq!(
            edit(&harness, &invalid, "draft").unwrap_err()["code"],
            "invalidDiskRevision"
        );
    }
    for command in ["update_markdown_buffer", "save_markdown_file"] {
        assert_eq!(invoke(&harness.window("secondary"), command, request(json!({
            "fileHandleId": opened["id"], "expectedRevision": "1", "baseDiskRevision": "base", "text": "draft"
        }))).unwrap_err()["code"], "windowNotAllowed");
    }
    std::fs::write(root.join("source.rs"), b"source").unwrap();
    let source = open(&harness, &project, "source.rs").unwrap()["file"].clone();
    assert_eq!(
        edit(&harness, &source, "changed").unwrap_err()["code"],
        "markdownNotEditable"
    );
    assert_eq!(
        save(&harness, &source).unwrap_err()["code"],
        "markdownNotEditable"
    );
}

/// Checks explicit external authorization, sibling fanout, no self conflict, and recent timestamps.
#[test]
fn conflict_keep_mine_and_sibling_save_are_manual() {
    let harness = Harness::new();
    let (project, root) = harness.project();
    let path = root.join("a.md");
    std::fs::write(&path, b"base").unwrap();
    let first = open(&harness, &project, "a.md").unwrap()["file"].clone();
    let clean_sibling = open(&harness, &project, "a.md").unwrap()["file"].clone();
    let dirty_sibling = edit(
        &harness,
        &open(&harness, &project, "a.md").unwrap()["file"],
        "sibling",
    )
    .unwrap();
    let first = edit(&harness, &first, "mine").unwrap();
    let before_recent = invoke(
        &harness.window("main"),
        "list_recent_files",
        json!({"projectId": project, "limit": null}),
    )
    .unwrap();
    std::fs::write(&path, b"external").unwrap();
    tauri::async_runtime::block_on(harness.app.state::<FilesService>().reconcile_open_files())
        .unwrap();
    let first = current(&harness, &first);
    assert_eq!(first["state"]["kind"], "externalConflict");
    assert_eq!(
        save(&harness, &first).unwrap_err()["code"],
        "externalChangeDetected"
    );
    let kept = invoke(&harness.window("main"), "resolve_external_file_change", request(json!({
        "fileHandleId": first["id"], "expectedRevision": first["revision"], "resolution": "keepMine"
    }))).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"external");
    let saved = save(&harness, &kept).unwrap();
    assert_eq!(saved["outcome"], "saved");
    assert_eq!(std::fs::read(&path).unwrap(), b"mine");
    tauri::async_runtime::block_on(harness.app.state::<FilesService>().reconcile_open_files())
        .unwrap();
    assert_eq!(current(&harness, &saved["file"]), saved["file"]);
    assert_eq!(
        current(&harness, &clean_sibling)["state"]["content"]["file"]["text"],
        "mine"
    );
    let sibling = current(&harness, &dirty_sibling);
    assert_eq!(sibling["state"]["kind"], "externalConflict");
    assert_eq!(sibling["state"]["local"]["text"], "sibling");
    let after_recent = invoke(
        &harness.window("main"),
        "list_recent_files",
        json!({"projectId": project, "limit": null}),
    )
    .unwrap();
    assert_eq!(
        before_recent[0]["openedAtMs"],
        after_recent[0]["openedAtMs"]
    );
    let converged = edit(&harness, &sibling, "mine").unwrap();
    assert_eq!(converged["isDirty"], false);
    assert_eq!(converged["state"]["kind"], "ready");
}

/// Ensures native read-only and missing targets preserve drafts without creating files.
#[test]
fn denied_targets_preserve_recovery_drafts() {
    let harness = Harness::new();
    let (project, root) = harness.project();
    let path = root.join("a.md");
    std::fs::write(&path, b"base").unwrap();
    let file = edit(
        &harness,
        &open(&harness, &project, "a.md").unwrap()["file"],
        "draft",
    )
    .unwrap();
    let original = std::fs::metadata(&path).unwrap().permissions();
    let mut readonly = original.clone();
    readonly.set_readonly(true);
    std::fs::set_permissions(&path, readonly).unwrap();
    assert_eq!(
        save(&harness, &file).unwrap_err()["code"],
        "fileNotWritable"
    );
    std::fs::set_permissions(&path, original).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"base");
    std::fs::remove_file(&path).unwrap();
    let latest = current(&harness, &file);
    let error = save(&harness, &latest).unwrap_err();
    assert!(error["code"] == "entryNotFound" || error["code"] == "revisionConflict");
    tauri::async_runtime::block_on(harness.app.state::<FilesService>().reconcile_open_files())
        .unwrap();
    let missing = current(&harness, &file);
    assert_eq!(missing["state"]["local"]["text"], "draft");
    let recovered = invoke(
        &harness.window("main"),
        "update_markdown_buffer",
        request(json!({
            "fileHandleId": missing["id"], "expectedRevision": missing["revision"],
            "baseDiskRevision": missing["state"]["lastDisk"]["diskRevision"], "text": "recovery"
        })),
    )
    .unwrap();
    assert_eq!(recovered["state"]["kind"], "missing");
    assert_eq!(recovered["state"]["local"]["text"], "recovery");
    assert!(!path.exists());
}
