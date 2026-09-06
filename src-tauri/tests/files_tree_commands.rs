use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use xwork_lib::{
    files::FilesError,
    projects::{
        ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectsError,
    },
};

/// Holds fake native observations and queued project selections.
#[derive(Default)]
struct Observations {
    selections: Mutex<Vec<PathBuf>>,
    revealed: Mutex<Vec<PathBuf>>,
}

/// Supplies project folders without opening native user interface.
struct FakeProjectPlatform {
    observations: Arc<Observations>,
}

impl ProjectPlatform for FakeProjectPlatform {
    /// Returns the next queued temporary folder.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        let selection = self
            .observations
            .selections
            .lock()
            .expect("the selection queue should be available")
            .pop();
        Box::pin(async move { Ok(selection) })
    }

    /// Rejects the unrelated Projects opener in Files tests.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Discards committed project invalidation events.
struct DiscardingEvents;

impl ProjectEventSink for DiscardingEvents {
    /// Accepts one project event without leaving the test process.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        Ok(())
    }
}

/// Owns an isolated mock application and filesystem fixture.
struct TestApplication {
    app: tauri::App<tauri::test::MockRuntime>,
    observations: Arc<Observations>,
    workspace: TempDir,
    _app_data: TempDir,
}

impl TestApplication {
    /// Builds full composition with temporary storage and fake native adapters.
    fn new() -> Self {
        Self::build(false)
    }

    /// Builds composition whose Files reveal adapter returns a typed failure.
    fn with_reveal_failure() -> Self {
        Self::build(true)
    }

    /// Builds the shared isolated application with a configured reveal outcome.
    fn build(reveal_fails: bool) -> Self {
        let app_data = TempDir::new().expect("temporary app data should be created");
        let workspace = TempDir::new().expect("temporary workspace should be created");
        let observations = Arc::new(Observations::default());
        let project_observations = observations.clone();
        let reveal_observations = observations.clone();
        let reveal = Arc::new(
            // Records only paths that passed every Files validation step.
            move |path: &Path| {
                if reveal_fails {
                    return Err(FilesError::RevealFailed);
                }
                reveal_observations
                    .revealed
                    .lock()
                    .expect("the reveal list should be available")
                    .push(path.to_path_buf());
                Ok(())
            },
        );
        let mut app = xwork_lib::app::configure_with_files_for_tests(
            tauri::test::mock_builder(),
            app_data.path().to_path_buf(),
            // Supplies only temporary test collaborators to Projects.
            move |_handle| {
                (
                    Arc::new(FakeProjectPlatform {
                        observations: project_observations,
                    }),
                    Arc::new(DiscardingEvents),
                )
            },
            reveal,
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the mock application should build");
        #[allow(deprecated)]
        app.run_iteration(
            // Advances setup without observing runtime events.
            |_handle, _event| {},
        );
        Self {
            app,
            observations,
            workspace,
            _app_data: app_data,
        }
    }

    /// Returns or creates one mock webview by label.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        if let Some(window) = self.app.get_webview_window(label) {
            return window;
        }
        WebviewWindowBuilder::new(&self.app, label, Default::default())
            .build()
            .expect("the mock window should build")
    }

    /// Creates and registers one owned temporary project root.
    fn register_project(&self) -> (String, PathBuf) {
        let root = self.workspace.path().join("project");
        std::fs::create_dir(&root).expect("the project root should be created");
        self.observations
            .selections
            .lock()
            .expect("the selection queue should be available")
            .push(root.clone());
        let response = invoke(&self.window("main"), "add_project", json!({}))
            .expect("the project should register");
        let id = response["project"]["id"]
            .as_str()
            .expect("the project id should be text")
            .to_owned();
        // Registration expands Windows short paths and removes verbatim prefixes.
        let registered_root = response["project"]["rootPath"]
            .as_str()
            .expect("the registered root should be text");
        (id, PathBuf::from(registered_root))
    }
}

/// Captures names, kinds, and regular-file bytes without following links.
fn snapshot_tree(root: &Path) -> BTreeMap<String, (String, Vec<u8>)> {
    /// Visits one owned fixture directory without following link entries.
    fn visit(root: &Path, directory: &Path, output: &mut BTreeMap<String, (String, Vec<u8>)>) {
        for entry in std::fs::read_dir(directory).expect("the fixture directory should list") {
            let entry = entry.expect("the fixture entry should be readable");
            let metadata = std::fs::symlink_metadata(entry.path())
                .expect("the fixture metadata should be readable");
            let relative = entry
                .path()
                .strip_prefix(root)
                .expect("the entry should remain under root")
                .to_string_lossy()
                .replace('\\', "/");
            if metadata.file_type().is_symlink() {
                output.insert(relative, ("link".to_owned(), Vec::new()));
            } else if metadata.is_dir() {
                output.insert(relative, ("directory".to_owned(), Vec::new()));
                visit(root, &entry.path(), output);
            } else if metadata.is_file() {
                output.insert(
                    relative,
                    (
                        "file".to_owned(),
                        std::fs::read(entry.path()).expect("fixture bytes should be readable"),
                    ),
                );
            }
        }
    }

    let mut output = BTreeMap::new();
    visit(root, root, &mut output);
    output
}

/// Invokes one command through the real Tauri mock IPC router.
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
                .expect("the URL should parse"),
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

/// Builds one nested request payload for a Files command.
fn request(value: Value) -> Value {
    json!({ "request": value })
}

/// Verifies real tree queries, sorting, search, and fresh ignore refresh.
#[test]
fn commands_query_the_registered_temporary_tree() {
    let application = TestApplication::new();
    let (project_id, root) = application.register_project();
    std::fs::create_dir(root.join("src")).expect("the source folder should be created");
    std::fs::write(root.join("src/Main.rs"), b"fn main() {}")
        .expect("the source file should be created");
    std::fs::write(root.join("README.md"), b"fixture").expect("the readme should be created");
    std::fs::write(root.join("ignored.txt"), b"fixture")
        .expect("the ignored file should be created");
    std::fs::write(root.join("parent-only.txt"), b"fixture")
        .expect("the parent-ignore fixture should be created");
    std::fs::write(
        application.workspace.path().join(".gitignore"),
        b"parent-only.txt\n",
    )
    .expect("the parent ignore file should be created");
    std::fs::write(root.join(".gitignore"), b"ignored.txt\n")
        .expect("the ignore file should be created");
    std::fs::create_dir_all(root.join(".git/info"))
        .expect("the local exclude folder should be created");
    std::fs::write(root.join(".git/info/exclude"), b"excluded.txt\n")
        .expect("the local exclude should be created");
    std::fs::write(root.join("excluded.txt"), b"fixture")
        .expect("the excluded file should be created");
    std::fs::write(root.join("src/.ignore"), b"nested.tmp\n")
        .expect("the nested ignore should be created");
    std::fs::write(root.join("src/nested.tmp"), b"fixture")
        .expect("the nested ignored file should be created");
    let main = application.window("main");

    let listed = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "", "cursor": null })),
    )
    .expect("the root should list");
    let names = listed["entries"]
        .as_array()
        .expect("entries should be an array")
        .iter()
        .map(|entry| entry["name"].as_str().expect("the name should be text"))
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        vec!["src", ".gitignore", "parent-only.txt", "README.md"]
    );

    let search = invoke(
        &main,
        "search_file_tree",
        request(json!({ "projectId": project_id, "query": "  main  " })),
    )
    .expect("the tree should search");
    assert_eq!(search["query"], "main");
    assert_eq!(search["matches"][0]["relativePath"], "src/Main.rs");
    let ignored_search = invoke(
        &main,
        "search_file_tree",
        request(json!({ "projectId": project_id, "query": "tmp" })),
    )
    .expect("the ignored basename search should complete");
    assert_eq!(ignored_search["matches"], json!([]));

    std::fs::write(root.join(".gitignore"), b"README.md\n").expect("the ignore file should change");
    let refreshed = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "", "cursor": null })),
    )
    .expect("the refreshed root should list");
    assert!(
        refreshed["entries"]
            .as_array()
            .expect("entries should be an array")
            .iter()
            .any(|entry| entry["name"] == "ignored.txt")
    );
}

/// Verifies copy and reveal revalidate a visible lexical entry.
#[test]
fn path_actions_use_only_validated_entries() {
    let application = TestApplication::new();
    let (project_id, root) = application.register_project();
    let file = root.join("file.txt");
    std::fs::write(&file, b"fixture").expect("the file should be created");
    let before = snapshot_tree(&root);
    let main = application.window("main");

    let paths = invoke(
        &main,
        "get_file_entry_paths",
        request(json!({ "projectId": project_id, "relativePath": "file.txt" })),
    )
    .expect("copy paths should resolve");
    assert_eq!(paths["relativePath"], "file.txt");
    assert_eq!(
        paths["absolutePath"],
        file.to_str().expect("the path should be UTF-8")
    );
    invoke(
        &main,
        "reveal_file_entry",
        request(json!({ "projectId": project_id, "relativePath": "file.txt" })),
    )
    .expect("the validated file should reveal");
    assert_eq!(
        *application
            .observations
            .revealed
            .lock()
            .expect("the reveal list should be available"),
        vec![file]
    );
    assert_eq!(snapshot_tree(&root), before);
}

/// Verifies foreign windows are rejected before malformed request validation.
#[test]
fn commands_reject_foreign_windows_first() {
    let application = TestApplication::new();
    let error = invoke(
        &application.window("quick-note"),
        "list_file_children",
        request(json!({ "projectId": "invalid", "directory": "../escape", "cursor": null })),
    )
    .expect_err("the foreign window should be rejected");
    assert_eq!(error, json!({ "code": "windowNotAllowed" }));
}

/// Verifies malformed paths and unavailable projects return typed failures.
#[test]
fn commands_report_path_and_project_failures() {
    let application = TestApplication::new();
    let (project_id, root) = application.register_project();
    let main = application.window("main");
    let invalid = invoke(
        &main,
        "get_file_entry_paths",
        request(json!({ "projectId": project_id, "relativePath": "../escape" })),
    )
    .expect_err("the traversal path should fail");
    assert_eq!(invalid, json!({ "code": "invalidRelativePath" }));

    std::fs::remove_dir(&root).expect("the empty temporary root should be removed");
    let unavailable = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "", "cursor": null })),
    )
    .expect_err("the missing root should fail");
    assert_eq!(unavailable["code"], "projectUnavailable");
    invoke(
        &main,
        "remove_project",
        json!({ "projectId": project_id, "confirmed": true }),
    )
    .expect("the unavailable project metadata should be removable");
    let missing = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "", "cursor": null })),
    )
    .expect_err("the removed project should be missing");
    assert_eq!(missing["code"], "projectNotFound");
}

/// Verifies a directory with 501 entries returns a bound opaque cursor.
#[test]
fn command_paginates_direct_children() {
    let application = TestApplication::new();
    let (project_id, root) = application.register_project();
    for index in 0..501 {
        std::fs::write(root.join(format!("file-{index:03}.txt")), b"fixture")
            .expect("the page fixture should be created");
    }
    let main = application.window("main");
    let first = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "", "cursor": null })),
    )
    .expect("the first page should list");
    assert_eq!(first["entries"].as_array().map(Vec::len), Some(500));
    let cursor = first["nextCursor"].clone();
    let second = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "", "cursor": cursor })),
    )
    .expect("the second page should list");
    assert_eq!(second["entries"].as_array().map(Vec::len), Some(1));
    assert_eq!(second["nextCursor"], Value::Null);
}

/// Verifies the public error type remains serializable for test seam failures.
#[test]
fn reveal_callback_error_shape_is_typed() {
    assert_eq!(
        serde_json::to_value(FilesError::RevealFailed).expect("the error should serialize"),
        json!({ "code": "revealFailed" })
    );
}

/// Verifies an injected native failure maps to RevealFailed without mutation.
#[test]
fn reveal_failure_is_typed_and_read_only() {
    let application = TestApplication::with_reveal_failure();
    let (project_id, root) = application.register_project();
    std::fs::write(root.join("file.txt"), b"fixture").expect("the file should be created");
    let before = snapshot_tree(&root);
    let error = invoke(
        &application.window("main"),
        "reveal_file_entry",
        request(json!({ "projectId": project_id, "relativePath": "file.txt" })),
    )
    .expect_err("the fake native failure should surface");
    assert_eq!(error, json!({ "code": "revealFailed" }));
    assert_eq!(snapshot_tree(&root), before);
}

/// Verifies a Windows symbolic link is a copyable leaf but cannot reveal or expand.
#[cfg(windows)]
#[test]
fn symbolic_link_is_never_followed() {
    use std::os::windows::fs::symlink_dir;

    let application = TestApplication::new();
    let (project_id, root) = application.register_project();
    let outside = application.workspace.path().join("outside");
    std::fs::create_dir(&outside).expect("the outside fixture should be created");
    std::fs::write(outside.join("sentinel.txt"), b"outside")
        .expect("the sentinel should be created");
    let link = root.join("outside-link");
    if let Err(error) = symlink_dir(&outside, &link) {
        eprintln!("skipping privileged Windows symlink fixture: {error}");
        return;
    }
    let main = application.window("main");

    let listed = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "", "cursor": null })),
    )
    .expect("the link leaf should list");
    let entry = listed["entries"]
        .as_array()
        .expect("entries should be an array")
        .iter()
        .find(|entry| entry["name"] == "outside-link")
        .expect("the link should be visible");
    assert_eq!(entry["kind"], "symbolicLink");
    invoke(
        &main,
        "get_file_entry_paths",
        request(json!({ "projectId": project_id, "relativePath": "outside-link" })),
    )
    .expect("the lexical link path should be copyable");
    let reveal_error = invoke(
        &main,
        "reveal_file_entry",
        request(json!({ "projectId": project_id, "relativePath": "outside-link" })),
    )
    .expect_err("the link should not reveal");
    assert_eq!(reveal_error["code"], "linkTraversalDenied");
    let expand_error = invoke(
        &main,
        "list_file_children",
        request(json!({ "projectId": project_id, "directory": "outside-link", "cursor": null })),
    )
    .expect_err("the link should not expand");
    assert_eq!(expand_error["code"], "linkTraversalDenied");
    assert!(
        application
            .observations
            .revealed
            .lock()
            .expect("the reveal list should be available")
            .is_empty()
    );
}
