use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

use serde_json::{Value, json};
use tauri::{Listener, Manager, WebviewWindow, WebviewWindowBuilder};
use xwork_lib::{
    app::{
        CloseDecision, apply_close_requested, configure_with_lifecycle_for_tests,
        lifecycle::{
            AppLifecycleError, AppLifecycleState, AppRuntime, AppRuntimeFuture, AttentionSession,
            QuitSummaryDto,
        },
        tray::{TrayQuitOutcome, tray_open, tray_quit, tray_select_session},
    },
    storage::{Storage, StorageError},
};

/// Supplies deterministic runtime data for IPC and tray integration tests.
struct FakeAppRuntime {
    summary: QuitSummaryDto,
    attention: Vec<AttentionSession>,
    shutdown_fails: bool,
    summary_calls: AtomicUsize,
    shutdown_calls: AtomicUsize,
}

impl FakeAppRuntime {
    /// Creates a runtime fixture for the requested session count.
    fn new(session_count: u32) -> Self {
        Self {
            summary: QuitSummaryDto {
                session_count,
                project_count: 1,
                running_process_count: 3,
                unsaved_file_count: 0,
            },
            attention: Vec::new(),
            shutdown_fails: false,
            summary_calls: AtomicUsize::new(0),
            shutdown_calls: AtomicUsize::new(0),
        }
    }

    /// Adds attention sessions to a runtime fixture.
    fn with_attention(mut self, attention: Vec<AttentionSession>) -> Self {
        self.attention = attention;
        self
    }

    /// Makes runtime cleanup fail without terminating the mock process.
    fn with_shutdown_failure(mut self) -> Self {
        self.shutdown_fails = true;
        self
    }
}

impl AppRuntime for FakeAppRuntime {
    /// Returns the configured Quit snapshot and records access.
    fn quit_summary<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>> {
        self.summary_calls.fetch_add(1, Ordering::SeqCst);
        let summary = self.summary.clone();
        Box::pin(async move { Ok(summary) })
    }

    /// Returns the configured attention-session snapshot.
    fn attention_sessions<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>> {
        let attention = self.attention.clone();
        Box::pin(async move { Ok(attention) })
    }

    /// Returns the configured cleanup outcome and records access.
    fn shutdown_for_quit<'a>(&'a self) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>> {
        self.shutdown_calls.fetch_add(1, Ordering::SeqCst);
        let fails = self.shutdown_fails;
        Box::pin(async move {
            if fails {
                Err(AppLifecycleError::RuntimeShutdownFailed)
            } else {
                Ok(())
            }
        })
    }
}

/// Owns an isolated mock application and its temporary data directory.
struct TestApplication {
    app: tauri::App<tauri::test::MockRuntime>,
    _directory: tempfile::TempDir,
}

impl TestApplication {
    /// Builds lifecycle composition and advances setup exactly once.
    fn new(runtime: Arc<dyn AppRuntime>) -> Self {
        let directory = tempfile::TempDir::new().expect("the temporary directory should exist");
        let mut app = configure_with_lifecycle_for_tests(
            tauri::test::mock_builder(),
            directory.path().to_path_buf(),
            runtime,
            // Avoids native tray creation while retaining setup ordering.
            |_app| Ok(()),
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
            _directory: directory,
        }
    }

    /// Creates a mock webview window with the requested backend-owned label.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        WebviewWindowBuilder::new(&self.app, label, Default::default())
            .build()
            .expect("the mock webview window should build")
    }
}

/// Invokes one lifecycle command through Tauri's real IPC routing pipeline.
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

/// Creates one attention-session fixture for tray navigation tests.
fn attention_session(id: &str, sequence: u64) -> AttentionSession {
    AttentionSession {
        session_id: id.to_owned(),
        project_name: "xwork".to_owned(),
        session_name: format!("Session {id}"),
        status_label: None,
        attention_sequence: sequence,
    }
}

/// Verifies all window commands route for main and reject a different label.
#[test]
fn window_commands_authorize_the_invoking_window() {
    let application = TestApplication::new(Arc::new(FakeAppRuntime::new(1)));
    let main = application.window("main");
    let quick_note = application.window("quick-note");

    assert_eq!(
        invoke(&main, "hide_main_window", json!({})),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&main, "minimize_main_window", json!({})),
        Ok(Value::Null)
    );
    assert!(invoke(&main, "toggle_main_window_maximized", json!({})).is_ok());
    for command in [
        "hide_main_window",
        "minimize_main_window",
        "toggle_main_window_maximized",
    ] {
        assert_eq!(
            invoke(&quick_note, command, json!({})),
            Err(json!({ "code": "invalid_window" }))
        );
    }
}

/// Verifies unauthorized Quit commands do not read runtime or mutate state.
#[test]
fn quit_commands_reject_non_main_before_side_effects() {
    let runtime = Arc::new(FakeAppRuntime::new(2));
    let application = TestApplication::new(runtime.clone());
    let quick_note = application.window("quick-note");

    for (command, body) in [
        ("request_quit", json!({})),
        ("cancel_quit", json!({ "requestId": 1 })),
        ("confirm_quit", json!({ "requestId": 1 })),
    ] {
        assert_eq!(
            invoke(&quick_note, command, body),
            Err(json!({ "code": "unauthorized_window" }))
        );
    }

    assert_eq!(runtime.summary_calls.load(Ordering::SeqCst), 0);
    assert_eq!(runtime.shutdown_calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        application
            .app
            .state::<AppLifecycleState>()
            .pending_request_for_tests()
            .expect("the state lock should be available"),
        None
    );
}

/// Verifies Quit payload casing, request reuse, close preservation, and cancel rules.
#[test]
fn quit_request_round_trip_preserves_pending_state() {
    let runtime = Arc::new(FakeAppRuntime::new(2));
    let application = TestApplication::new(runtime.clone());
    let main = application.window("main");
    let quick_note = application.window("quick-note");

    let first = invoke(&main, "request_quit", json!({})).expect("Quit should request a dialog");
    assert_eq!(
        first,
        json!({
            "requestId": 1,
            "summary": {
                "sessionCount": 2,
                "projectCount": 1,
                "runningProcessCount": 3,
                "unsavedFileCount": 0
            }
        })
    );
    assert_eq!(invoke(&main, "request_quit", json!({})), Ok(first));
    assert_eq!(runtime.summary_calls.load(Ordering::SeqCst), 1);
    assert_eq!(apply_close_requested(&main), Ok(CloseDecision::HideToTray));
    assert_eq!(
        apply_close_requested(&quick_note),
        Ok(CloseDecision::AllowClose)
    );
    assert_eq!(
        invoke(&main, "cancel_quit", json!({ "requestId": 0 })),
        Err(json!({ "code": "invalid_request_id" }))
    );
    assert_eq!(
        invoke(&main, "cancel_quit", json!({ "requestId": 2 })),
        Err(json!({ "code": "stale_quit_request" }))
    );
    assert_eq!(
        invoke(&main, "cancel_quit", json!({ "requestId": 1 })),
        Ok(Value::Null)
    );
}

/// Verifies tray Quit emits only to main and reuses the pending request.
#[test]
fn tray_quit_targets_main_with_one_dialog_event() {
    let application = TestApplication::new(Arc::new(FakeAppRuntime::new(2)));
    let main = application.window("main");
    let quick_note = application.window("quick-note");
    let main_events = Arc::new(Mutex::new(Vec::new()));
    let quick_note_events = Arc::new(Mutex::new(Vec::new()));
    let main_capture = main_events.clone();
    let quick_note_capture = quick_note_events.clone();
    main.listen(
        "app-quit-requested",
        // Captures payloads delivered specifically to the main webview.
        move |event| {
            main_capture
                .lock()
                .expect("the main event lock should be available")
                .push(event.payload().to_owned());
        },
    );
    quick_note.listen(
        "app-quit-requested",
        // Captures any accidental delivery to the quick-note webview.
        move |event| {
            quick_note_capture
                .lock()
                .expect("the quick-note event lock should be available")
                .push(event.payload().to_owned());
        },
    );

    let outcome = tauri::async_runtime::block_on(tray_quit(application.app.handle()))
        .expect("tray Quit should request a dialog");

    assert!(matches!(outcome, TrayQuitOutcome::DialogShown(_)));
    assert_eq!(
        main_events
            .lock()
            .expect("the event lock should work")
            .len(),
        1
    );
    assert!(
        quick_note_events
            .lock()
            .expect("the event lock should work")
            .is_empty()
    );
}

/// Verifies zero-session tray Quit completes cleanup without a dialog event.
#[test]
fn tray_quit_without_sessions_is_exit_ready() {
    let runtime = Arc::new(FakeAppRuntime::new(0));
    let application = TestApplication::new(runtime.clone());
    application.window("main");

    let outcome = tauri::async_runtime::block_on(tray_quit(application.app.handle()))
        .expect("zero-session tray Quit should clean up");

    assert_eq!(outcome, TrayQuitOutcome::ReadyToExit);
    assert_eq!(runtime.shutdown_calls.load(Ordering::SeqCst), 1);
}

/// Verifies session selection revalidates IDs and emits one main-window event.
#[test]
fn tray_session_selection_revalidates_and_targets_main() {
    let attention = (1..=6)
        .map(
            // Creates ordered fixtures that exercise the five-item cap.
            |index| attention_session(&format!("s{index}"), index),
        )
        .collect();
    let application =
        TestApplication::new(Arc::new(FakeAppRuntime::new(1).with_attention(attention)));
    let main = application.window("main");
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    main.listen(
        "app-navigate-session",
        // Captures navigation payloads delivered to the main webview.
        move |event| {
            capture
                .lock()
                .expect("the event lock should be available")
                .push(event.payload().to_owned());
        },
    );

    assert!(
        tauri::async_runtime::block_on(tray_select_session(
            application.app.handle(),
            "xwork.tray.session.s6"
        ))
        .expect("the newest session should still be valid")
    );
    assert!(
        !tauri::async_runtime::block_on(tray_select_session(
            application.app.handle(),
            "xwork.tray.session.missing"
        ))
        .expect("a stale session should be ignored")
    );
    assert_eq!(
        events
            .lock()
            .expect("the event lock should work")
            .as_slice(),
        [r#"{"sessionId":"s6"}"#]
    );
}

/// Verifies tray Open reports a missing main window precisely.
#[test]
fn tray_open_requires_the_existing_main_window() {
    let application = TestApplication::new(Arc::new(FakeAppRuntime::new(0)));

    assert_eq!(
        tray_open(application.app.handle()),
        Err(AppLifecycleError::MainWindowUnavailable)
    );
}

/// Verifies failed confirmed cleanup restores the same pending request over IPC.
#[test]
fn confirm_failure_keeps_the_process_and_request_pending() {
    let runtime = Arc::new(FakeAppRuntime::new(1).with_shutdown_failure());
    let application = TestApplication::new(runtime.clone());
    let main = application.window("main");
    let request = invoke(&main, "request_quit", json!({})).expect("Quit should request a dialog");

    assert_eq!(
        invoke(&main, "confirm_quit", json!({ "requestId": 1 })),
        Err(json!({ "code": "runtime_shutdown_failed" }))
    );
    assert_eq!(
        application
            .app
            .state::<AppLifecycleState>()
            .pending_request_for_tests()
            .expect("the state lock should be available")
            .expect("the request should be restored")
            .request_id,
        request["requestId"]
    );
    assert_eq!(runtime.shutdown_calls.load(Ordering::SeqCst), 1);
}

/// Verifies lifecycle setup exposes storage without reading real user data.
#[test]
fn isolated_lifecycle_composition_manages_storage() {
    let application = TestApplication::new(Arc::new(FakeAppRuntime::new(0)));

    assert_eq!(
        application
            .app
            .state::<Storage>()
            .with_connection(
                // Reads only the isolated fixture database schema marker.
                |connection| {
                    connection
                        .pragma_query_value(
                            None,
                            "user_version",
                            // Decodes the isolated database's schema marker.
                            |row| row.get::<_, u32>(0),
                        )
                        .map_err(
                            // Maps fixture query failure through the storage contract.
                            |source| StorageError::ReadSchemaVersion { source },
                        )
                },
            )
            .expect("isolated storage should be readable"),
        1
    );
}
