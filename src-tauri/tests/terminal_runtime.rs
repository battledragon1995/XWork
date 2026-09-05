use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use tauri::{Manager, WebviewWindowBuilder};
use xwork_lib::{
    platform::shell::{ResolvedShell, ShellMode},
    terminal::{
        PtyCallbacks, PtyFactory, PtyProcess, PtySizeDto, ResolvedCliLaunchKind,
        ResolvedCliProfile, TerminalActivity, TerminalDependencies, TerminalError,
        TerminalEventSink, TerminalFuture, TerminalManager, TerminalPaneTarget,
        TerminalStateChangedDto,
    },
};

/// Builds one mock invoke request with an explicit JSON body.
fn invoke_request(cmd: &str, body: serde_json::Value) -> tauri::webview::InvokeRequest {
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
    }
}

/// Decodes the JSON branch returned by a successful mock invoke.
fn response_json(body: tauri::ipc::InvokeResponseBody) -> serde_json::Value {
    match body {
        tauri::ipc::InvokeResponseBody::Json(json) => {
            serde_json::from_str(&json).expect("invoke response should contain valid JSON")
        }
        tauri::ipc::InvokeResponseBody::Raw(_) => panic!("command DTO should use JSON response"),
    }
}

/// Advances a mock application once so its setup hook manages Terminal.
fn isolated_app(path: PathBuf) -> tauri::App<tauri::test::MockRuntime> {
    let mut app = xwork_lib::app::configure_with_app_data_dir(tauri::test::mock_builder(), path)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the mock application should build");
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    app
}

/// Supplies fixed owner facts for command delegation tests.
struct CommandDependencies {
    attaches: AtomicUsize,
}

impl TerminalDependencies for CommandDependencies {
    /// Resolves one fixed launchable tool-selection pane.
    fn launch_target<'a>(
        &'a self,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<TerminalPaneTarget, TerminalError>> {
        Box::pin(async move {
            Ok(TerminalPaneTarget {
                session_id: session_id.to_owned(),
                tab_id: tab_id.to_owned(),
                pane_id: pane_id.to_owned(),
                project_id: "project-fixture".to_owned(),
                profile_id: "builtin:terminal".to_owned(),
                title: "Fixture".to_owned(),
            })
        })
    }

    /// Returns one synthetic canonical root consumed only by the fake PTY.
    fn available_project_root<'a>(
        &'a self,
        _project_id: &'a str,
    ) -> TerminalFuture<'a, Result<PathBuf, TerminalError>> {
        Box::pin(async { Ok(PathBuf::from("fixture-root")) })
    }

    /// Returns structured launch data without reading credentials or host discovery.
    fn resolve_profile<'a>(
        &'a self,
        _profile_id: &'a str,
    ) -> TerminalFuture<'a, Result<ResolvedCliProfile, TerminalError>> {
        Box::pin(async {
            Ok(ResolvedCliProfile {
                profile_id: "builtin:terminal".to_owned(),
                display_name: "Fixture Shell".to_owned(),
                launch_kind: ResolvedCliLaunchKind::InteractiveShell {
                    shell: ResolvedShell {
                        id: "fixture-shell".to_owned(),
                        display_name: "Fixture Shell".to_owned(),
                        command: "fixture.exe".to_owned(),
                        executable: PathBuf::from("fixture.exe"),
                        mode: ShellMode::PowerShell,
                    },
                },
                environment: Vec::new(),
            })
        })
    }

    /// Records that the real start handler reached authoritative attachment.
    fn attach_terminal<'a>(
        &'a self,
        _target: &'a TerminalPaneTarget,
        _terminal_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async move {
            self.attaches.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    }

    /// Accepts synthetic output aggregation.
    fn record_output<'a>(
        &'a self,
        _pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async { Ok(()) })
    }

    /// Accepts synthetic activity aggregation.
    fn update_activity<'a>(
        &'a self,
        _pane_id: &'a str,
        _activity: TerminalActivity,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Captures control calls made through the command handler.
struct CommandProcess {
    alive: AtomicBool,
    writes: Mutex<Vec<Vec<u8>>>,
    size: Mutex<PtySizeDto>,
}

impl PtyProcess for CommandProcess {
    /// Captures one complete input write.
    fn write(&self, bytes: &[u8]) -> Result<(), TerminalError> {
        self.writes
            .lock()
            .expect("writes lock")
            .push(bytes.to_vec());
        Ok(())
    }

    /// Captures one applied PTY size.
    fn resize(&self, size: PtySizeDto) -> Result<(), TerminalError> {
        *self.size.lock().expect("size lock") = size;
        Ok(())
    }

    /// Marks the synthetic process stopped.
    fn terminate(&self) -> Result<(), TerminalError> {
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Reports synthetic process aliveness.
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }
}

/// Returns the same fake process without starting native resources.
struct CommandFactory {
    process: Arc<CommandProcess>,
    spawns: AtomicUsize,
}

impl PtyFactory for CommandFactory {
    /// Records one launch and returns the in-memory process.
    fn spawn(
        &self,
        _profile: ResolvedCliProfile,
        _cwd: PathBuf,
        _size: PtySizeDto,
        _callbacks: PtyCallbacks,
    ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
        self.spawns.fetch_add(1, Ordering::SeqCst);
        Ok(self.process.clone())
    }
}

/// Discards best-effort state events during command delegation tests.
struct CommandEvents;

impl TerminalEventSink for CommandEvents {
    /// Accepts one sanitized state event.
    fn publish(&self, _event: TerminalStateChangedDto) -> Result<(), TerminalError> {
        Ok(())
    }
}

/// Builds a mock app that registers the six production Terminal handlers.
fn command_app(manager: TerminalManager) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(manager)
        .invoke_handler(tauri::generate_handler![
            xwork_lib::terminal::commands::start_terminal,
            xwork_lib::terminal::commands::get_terminal,
            xwork_lib::terminal::commands::subscribe_terminal_output,
            xwork_lib::terminal::commands::write_terminal,
            xwork_lib::terminal::commands::resize_terminal,
            xwork_lib::terminal::commands::acknowledge_terminal_attention,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the command app should build")
}

/// Verifies all six handlers reject a non-main caller before owner or PTY work.
#[test]
fn all_terminal_commands_enforce_the_main_window_boundary() {
    let directory = tempfile::TempDir::new().expect("temporary app data should exist");
    let app = isolated_app(directory.path().to_path_buf());
    assert!(
        app.try_state::<xwork_lib::terminal::TerminalManager>()
            .is_some()
    );
    let window = WebviewWindowBuilder::new(&app, "quick-note", Default::default())
        .build()
        .expect("mock window should build");
    let cases = [
        (
            "start_terminal",
            serde_json::json!({"sessionId":"session-1","tabId":"tab-2","paneId":"pane-3","initialSize":{"columns":80,"rows":24},"onOutput":"__CHANNEL__:7"}),
        ),
        (
            "get_terminal",
            serde_json::json!({"terminalId":"terminal-1"}),
        ),
        (
            "subscribe_terminal_output",
            serde_json::json!({"terminalId":"terminal-1","afterSequence":"0","onOutput":"__CHANNEL__:8"}),
        ),
        (
            "write_terminal",
            serde_json::json!({"terminalId":"terminal-1","inputSequence":"1","data":"fixture"}),
        ),
        (
            "resize_terminal",
            serde_json::json!({"terminalId":"terminal-1","resizeSequence":"1","size":{"columns":80,"rows":24}}),
        ),
        (
            "acknowledge_terminal_attention",
            serde_json::json!({"terminalId":"terminal-1"}),
        ),
    ];
    for (command, body) in cases {
        let error = tauri::test::get_ipc_response(&window, invoke_request(command, body))
            .expect_err("non-main terminal command should fail");
        assert_eq!(
            error,
            serde_json::json!({"code":"unauthorizedWindow"}),
            "unexpected response for {command}"
        );
    }
}

/// Verifies all six main-window invokes delegate through the production handlers.
#[test]
fn all_terminal_commands_delegate_for_the_main_window() {
    let dependencies = Arc::new(CommandDependencies {
        attaches: AtomicUsize::new(0),
    });
    let process = Arc::new(CommandProcess {
        alive: AtomicBool::new(true),
        writes: Mutex::new(Vec::new()),
        size: Mutex::new(PtySizeDto {
            columns: 80,
            rows: 24,
        }),
    });
    let factory = Arc::new(CommandFactory {
        process: process.clone(),
        spawns: AtomicUsize::new(0),
    });
    let manager = TerminalManager::new(
        dependencies.clone(),
        Arc::new(CommandEvents),
        factory.clone(),
    );
    let app = command_app(manager);
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("main mock window should build");
    let start = response_json(
        tauri::test::get_ipc_response(
            &window,
            invoke_request(
                "start_terminal",
                serde_json::json!({
                    "sessionId":"session-1",
                    "tabId":"tab-2",
                    "paneId":"pane-3",
                    "initialSize":{"columns":80,"rows":24},
                    "onOutput":"__CHANNEL__:7"
                }),
            ),
        )
        .expect("main start should succeed"),
    );
    assert_eq!(start["id"], "terminal-1");
    assert_eq!(start["profileId"], "builtin:terminal");
    assert_eq!(dependencies.attaches.load(Ordering::SeqCst), 1);
    assert_eq!(factory.spawns.load(Ordering::SeqCst), 1);

    let get = response_json(
        tauri::test::get_ipc_response(
            &window,
            invoke_request(
                "get_terminal",
                serde_json::json!({"terminalId":"terminal-1"}),
            ),
        )
        .expect("main get should succeed"),
    );
    assert_eq!(get["state"], "running");

    let subscription = response_json(
        tauri::test::get_ipc_response(
            &window,
            invoke_request(
                "subscribe_terminal_output",
                serde_json::json!({
                    "terminalId":"terminal-1",
                    "afterSequence":"0",
                    "onOutput":"__CHANNEL__:8"
                }),
            ),
        )
        .expect("main subscribe should succeed"),
    );
    assert_eq!(subscription["latestSequence"], "0");

    let write = response_json(
        tauri::test::get_ipc_response(
            &window,
            invoke_request(
                "write_terminal",
                serde_json::json!({
                    "terminalId":"terminal-1",
                    "inputSequence":"1",
                    "data":"fixture"
                }),
            ),
        )
        .expect("main write should succeed"),
    );
    assert_eq!(write["acceptedSequence"], "1");
    assert_eq!(
        process.writes.lock().expect("writes lock").as_slice(),
        &[b"fixture".to_vec()]
    );

    let resize = response_json(
        tauri::test::get_ipc_response(
            &window,
            invoke_request(
                "resize_terminal",
                serde_json::json!({
                    "terminalId":"terminal-1",
                    "resizeSequence":"1",
                    "size":{"columns":100,"rows":30}
                }),
            ),
        )
        .expect("main resize should succeed"),
    );
    assert_eq!(resize["acceptedSequence"], "1");
    assert_eq!(resize["size"]["columns"], 100);

    let acknowledged = response_json(
        tauri::test::get_ipc_response(
            &window,
            invoke_request(
                "acknowledge_terminal_attention",
                serde_json::json!({"terminalId":"terminal-1"}),
            ),
        )
        .expect("main acknowledge should succeed"),
    );
    assert_eq!(acknowledged["needsAttention"], false);
}
