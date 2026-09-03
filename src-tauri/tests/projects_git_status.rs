use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};

use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use xwork_lib::projects::{
    ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectsError,
};

/// Supplies one queued project folder without opening a native picker.
struct FixturePlatform {
    selected: Mutex<Option<PathBuf>>,
}

impl ProjectPlatform for FixturePlatform {
    /// Returns the one test-owned folder queued for registration.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        let selected = self
            .selected
            .lock()
            .expect("the fixture lock should be available")
            .take();
        Box::pin(async move { Ok(selected) })
    }

    /// Rejects file-manager access because Git acceptance tests never need it.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Discards project invalidation events produced while arranging a fixture.
struct FixtureEvents;

impl ProjectEventSink for FixtureEvents {
    /// Accepts a committed project event without contacting a webview.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        Ok(())
    }
}

/// Owns one application, repository, and disposable database.
struct Fixture {
    app: tauri::App<tauri::test::MockRuntime>,
    platform: Arc<FixturePlatform>,
    root: tempfile::TempDir,
    _app_data: tempfile::TempDir,
}

impl Fixture {
    /// Builds a mock application whose real command router uses temporary state only.
    fn new() -> Self {
        let app_data = tempfile::TempDir::new().expect("temporary app data should open");
        let root = tempfile::TempDir::new().expect("temporary project root should open");
        let platform = Arc::new(FixturePlatform {
            selected: Mutex::new(None),
        });
        let injected = platform.clone();
        let mut app = xwork_lib::app::configure_with_projects_for_tests(
            tauri::test::mock_builder(),
            app_data.path().to_path_buf(),
            move |_app| (injected, Arc::new(FixtureEvents)),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the mock application should build");
        #[allow(deprecated)]
        app.run_iteration(
            // Advances setup so the database and project service become managed state.
            |_app, _event| {},
        );
        Self {
            app,
            platform,
            root,
            _app_data: app_data,
        }
    }

    /// Returns or creates a mock window with a backend-owned label.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        if let Some(window) = self.app.get_webview_window(label) {
            return window;
        }
        WebviewWindowBuilder::new(&self.app, label, Default::default())
            .build()
            .expect("the mock window should build")
    }

    /// Registers the fixture root through the public add-project command.
    fn register(&self) -> Value {
        *self
            .platform
            .selected
            .lock()
            .expect("the fixture lock should be available") = Some(self.root.path().to_path_buf());
        invoke(&self.window("main"), "add_project", json!({}))
            .expect("the fixture project should register")["project"]
            .clone()
    }
}

/// Invokes one command through Tauri's real routing and serialization path.
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
            url: "http://tauri.localhost"
                .parse()
                .expect("the mock IPC URL should parse"),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_owned(),
        },
    )
    .map(|response| {
        response
            .deserialize::<Value>()
            .expect("the response should contain JSON")
    })
}

/// Runs Git only to arrange a repository under the test-owned temporary root.
fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "XWork Test")
        .env("GIT_AUTHOR_EMAIL", "xwork@example.invalid")
        .env("GIT_COMMITTER_NAME", "XWork Test")
        .env("GIT_COMMITTER_EMAIL", "xwork@example.invalid")
        .output()
        .expect("git.exe is required for Git acceptance fixtures");
    assert!(
        output.status.success(),
        "fixture command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Recursively snapshots relative paths and bytes without following directory links.
fn tree_snapshot(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    /// Visits one directory while retaining paths relative to the snapshot root.
    fn visit(root: &Path, directory: &Path, output: &mut Vec<(PathBuf, Vec<u8>)>) {
        let mut entries = std::fs::read_dir(directory)
            .expect("the snapshot directory should be readable")
            .collect::<Result<Vec<_>, _>>()
            .expect("the snapshot entries should be readable");
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let file_type = entry
                .file_type()
                .expect("the snapshot entry type should be readable");
            if file_type.is_dir() {
                visit(root, &entry.path(), output);
            } else if file_type.is_file() {
                output.push((
                    entry
                        .path()
                        .strip_prefix(root)
                        .expect("the entry should remain under the snapshot root")
                        .to_path_buf(),
                    std::fs::read(entry.path()).expect("the snapshot file should be readable"),
                ));
            }
        }
    }

    let mut output = Vec::new();
    visit(root, root, &mut output);
    output
}

/// Verifies public summary/detail semantics and repository immutability.
#[test]
fn public_commands_return_stable_read_only_status() {
    let fixture = Fixture::new();
    git(fixture.root.path(), &["init", "--initial-branch=main"]);
    std::fs::write(fixture.root.path().join("tracked.txt"), b"original")
        .expect("the tracked fixture should be written");
    git(fixture.root.path(), &["add", "tracked.txt"]);
    git(fixture.root.path(), &["commit", "-m", "initial"]);
    let project = fixture.register();
    let project_id = project["id"]
        .as_str()
        .expect("the project identifier should be text");
    std::fs::write(fixture.root.path().join("tracked.txt"), b"changed")
        .expect("the worktree fixture should change");
    let repository_before = tree_snapshot(fixture.root.path());

    let summary = invoke(
        &fixture.window("main"),
        "get_project_git_summary",
        json!({ "projectId": project_id }),
    )
    .expect("the summary should succeed");
    let detail = invoke(
        &fixture.window("main"),
        "get_project_git_status",
        json!({ "projectId": project_id }),
    )
    .expect("the detail should succeed");

    assert_eq!(detail["summary"], summary);
    assert_eq!(summary["repositoryKind"], "worktree");
    assert_eq!(detail["changes"][0]["path"], "tracked.txt");
    assert_eq!(tree_snapshot(fixture.root.path()), repository_before);
    assert!(!fixture.root.path().join(".git/index.lock").exists());
    assert_eq!(
        invoke(
            &fixture.window("main"),
            "get_project",
            json!({ "projectId": project_id }),
        )
        .expect("project metadata should remain readable"),
        project
    );
}

/// Verifies exact-main authorization wins before project lookup and Git work.
#[test]
fn unauthorized_windows_are_rejected_before_git_inspection() {
    let fixture = Fixture::new();
    let invalid = "not-a-project-id";

    for command in ["get_project_git_summary", "get_project_git_status"] {
        assert_eq!(
            invoke(
                &fixture.window("quick-note"),
                command,
                json!({ "projectId": invalid }),
            ),
            Err(json!({ "code": "unauthorizedWindow" }))
        );
    }
}

/// Verifies helper-capable configuration is rejected and its marker is never created.
#[test]
fn hostile_filter_is_rejected_without_external_execution() {
    let fixture = Fixture::new();
    git(fixture.root.path(), &["init", "--initial-branch=main"]);
    std::fs::write(
        fixture.root.path().join(".gitattributes"),
        b"*.txt filter=hostile\n",
    )
    .expect("the attributes fixture should be written");
    std::fs::write(fixture.root.path().join("tracked.txt"), b"content")
        .expect("the tracked fixture should be written");
    git(
        fixture.root.path(),
        &["add", ".gitattributes", "tracked.txt"],
    );
    git(fixture.root.path(), &["commit", "-m", "initial"]);
    let marker = fixture.root.path().join("helper-ran.txt");
    let helper = format!(
        "cmd.exe /C echo ran>\"{}\"",
        marker
            .to_str()
            .expect("the temporary marker path should be UTF-8")
    );
    git(
        fixture.root.path(),
        &["config", "filter.hostile.process", &helper],
    );
    let project = fixture.register();
    let project_id = project["id"]
        .as_str()
        .expect("the project identifier should be text");
    let repository_before = tree_snapshot(fixture.root.path());

    let error = invoke(
        &fixture.window("main"),
        "get_project_git_status",
        json!({ "projectId": project_id }),
    )
    .expect_err("helper configuration must fail closed");

    assert_eq!(
        error,
        json!({ "code": "gitInspectionFailed", "project_id": project_id })
    );
    assert!(!marker.exists());
    assert_eq!(tree_snapshot(fixture.root.path()), repository_before);
}
