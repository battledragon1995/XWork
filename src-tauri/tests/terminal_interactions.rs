use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use tauri::WebviewWindowBuilder;
use xwork_lib::{
    platform::shell::{ResolvedShell, ShellMode},
    terminal::{
        PtyCallbacks, PtyFactory, PtyProcess, PtySizeDto, ResolvedCliLaunchKind,
        ResolvedCliProfile, TerminalActivity, TerminalDependencies, TerminalError,
        TerminalEventSink, TerminalFuture, TerminalInteractionAdapter, TerminalInteractionError,
        TerminalInteractions, TerminalManager, TerminalPaneTarget, TerminalStateChangedDto,
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

/// Returns structured launch facts without touching projects or credentials.
struct FakeDependencies;

impl TerminalDependencies for FakeDependencies {
    /// Resolves a fixed launch target.
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

    /// Supplies an isolated fake root.
    fn available_project_root<'a>(
        &'a self,
        _project_id: &'a str,
    ) -> TerminalFuture<'a, Result<PathBuf, TerminalError>> {
        Box::pin(async { Ok(PathBuf::from("fixture-root")) })
    }

    /// Supplies a fake executable that the fake PTY never launches.
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

    /// Accepts the fake runtime attachment.
    fn attach_terminal<'a>(
        &'a self,
        _target: &'a TerminalPaneTarget,
        _terminal_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async { Ok(()) })
    }

    /// Accepts output activity without persistence.
    fn record_output<'a>(
        &'a self,
        _pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async { Ok(()) })
    }

    /// Accepts state aggregation without persistence.
    fn update_activity<'a>(
        &'a self,
        _pane_id: &'a str,
        _activity: TerminalActivity,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Holds callbacks so a test can stop the fake runtime deterministically.
struct FakeProcess {
    alive: AtomicBool,
    callbacks: Mutex<Option<PtyCallbacks>>,
    writes: AtomicUsize,
}

impl FakeProcess {
    /// Emits a complete successful exit and reader EOF.
    fn finish(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(callbacks) = self.callbacks.lock().expect("callbacks lock").as_ref() {
            (callbacks.exited)(Ok(Some(0)));
            (callbacks.eof)();
        }
    }
}

impl PtyProcess for FakeProcess {
    /// Counts PTY writes so clipboard operations can prove they have no input side effect.
    fn write(&self, _bytes: &[u8]) -> Result<(), TerminalError> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    /// Accepts fake resizes.
    fn resize(&self, _size: PtySizeDto) -> Result<(), TerminalError> {
        Ok(())
    }

    /// Stops the fake process.
    fn terminate(&self) -> Result<(), TerminalError> {
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Reports fake aliveness.
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }
}

/// Produces one reusable in-memory process.
struct FakeFactory(Arc<FakeProcess>);

impl PtyFactory for FakeFactory {
    /// Captures callbacks and returns the fake process.
    fn spawn(
        &self,
        _profile: ResolvedCliProfile,
        _cwd: PathBuf,
        _size: PtySizeDto,
        callbacks: PtyCallbacks,
    ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
        *self.0.callbacks.lock().expect("callbacks lock") = Some(callbacks);
        Ok(self.0.clone())
    }
}

/// Discards terminal state events.
struct NoopEvents;

impl TerminalEventSink for NoopEvents {
    /// Accepts one safe event.
    fn publish(&self, _event: TerminalStateChangedDto) -> Result<(), TerminalError> {
        Ok(())
    }
}

/// Captures interaction calls and supplies deterministic results.
struct FakeAdapter {
    read: Mutex<Result<Option<String>, TerminalInteractionError>>,
    write_error: Mutex<Option<TerminalInteractionError>>,
    open_error: Mutex<Option<TerminalInteractionError>>,
    writes: Mutex<Vec<String>>,
    opens: Mutex<Vec<String>>,
}

impl TerminalInteractionAdapter for FakeAdapter {
    /// Returns the configured clipboard result.
    fn read_text(&self) -> Result<Option<String>, TerminalInteractionError> {
        self.read.lock().expect("read lock").clone()
    }

    /// Captures one clipboard write.
    fn write_text(&self, text: &str) -> Result<(), TerminalInteractionError> {
        if let Some(error) = self.write_error.lock().expect("write error lock").clone() {
            return Err(error);
        }
        self.writes
            .lock()
            .expect("writes lock")
            .push(text.to_owned());
        Ok(())
    }

    /// Captures one canonical URL.
    fn open_web_url(&self, url: &str) -> Result<(), TerminalInteractionError> {
        if let Some(error) = self.open_error.lock().expect("open error lock").clone() {
            return Err(error);
        }
        self.opens.lock().expect("opens lock").push(url.to_owned());
        Ok(())
    }
}

/// Builds a mock app with all interaction commands and their explicit seams.
fn command_app(
    manager: TerminalManager,
    adapter: Arc<FakeAdapter>,
) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(TerminalInteractions::new(manager.clone(), adapter))
        .manage(manager)
        .invoke_handler(tauri::generate_handler![
            xwork_lib::terminal::commands::start_terminal,
            xwork_lib::terminal::commands::read_terminal_clipboard,
            xwork_lib::terminal::commands::write_terminal_clipboard,
            xwork_lib::terminal::commands::open_terminal_link,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the interaction command app should build")
}

/// Launches the fixture terminal through the same command router used by production.
fn launch(window: &tauri::WebviewWindow<tauri::test::MockRuntime>) {
    tauri::test::get_ipc_response(
        window,
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
    .expect("the fake terminal should launch");
}

/// Verifies main-only authorization runs before any adapter call.
#[test]
fn interaction_commands_reject_non_main_callers() {
    let process = Arc::new(FakeProcess {
        alive: AtomicBool::new(true),
        callbacks: Mutex::new(None),
        writes: AtomicUsize::new(0),
    });
    let manager = TerminalManager::new(
        Arc::new(FakeDependencies),
        Arc::new(NoopEvents),
        Arc::new(FakeFactory(process)),
    );
    let adapter = Arc::new(FakeAdapter {
        read: Mutex::new(Ok(Some("secret".to_owned()))),
        write_error: Mutex::new(None),
        open_error: Mutex::new(None),
        writes: Mutex::new(Vec::new()),
        opens: Mutex::new(Vec::new()),
    });
    let app = command_app(manager.clone(), adapter.clone());
    let quick_note = WebviewWindowBuilder::new(&app, "quick-note", Default::default())
        .build()
        .expect("quick note window should build");

    for (command, body) in [
        (
            "read_terminal_clipboard",
            serde_json::json!({"terminalId":"bad"}),
        ),
        (
            "write_terminal_clipboard",
            serde_json::json!({"terminalId":"bad","text":"x"}),
        ),
        (
            "open_terminal_link",
            serde_json::json!({"terminalId":"bad","url":"https://example.com"}),
        ),
    ] {
        assert_eq!(
            tauri::test::get_ipc_response(&quick_note, invoke_request(command, body))
                .expect_err("quick note caller should fail"),
            serde_json::json!({"code":"unauthorizedWindow"})
        );
    }
    assert!(adapter.writes.lock().expect("writes lock").is_empty());
    assert!(adapter.opens.lock().expect("opens lock").is_empty());
}

/// Verifies Unicode clipboard and canonical HTTP interactions without PTY writes.
#[test]
fn valid_interactions_use_only_the_scoped_adapter() {
    let process = Arc::new(FakeProcess {
        alive: AtomicBool::new(true),
        callbacks: Mutex::new(None),
        writes: AtomicUsize::new(0),
    });
    let manager = TerminalManager::new(
        Arc::new(FakeDependencies),
        Arc::new(NoopEvents),
        Arc::new(FakeFactory(process.clone())),
    );
    let adapter = Arc::new(FakeAdapter {
        read: Mutex::new(Ok(Some("xin chào\r\n🙂".to_owned()))),
        write_error: Mutex::new(None),
        open_error: Mutex::new(None),
        writes: Mutex::new(Vec::new()),
        opens: Mutex::new(Vec::new()),
    });
    let app = command_app(manager.clone(), adapter.clone());
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("main window should build");
    launch(&main);

    let read = tauri::test::get_ipc_response(
        &main,
        invoke_request(
            "read_terminal_clipboard",
            serde_json::json!({"terminalId":"terminal-1"}),
        ),
    )
    .expect("clipboard read should succeed");
    assert!(
        matches!(read, tauri::ipc::InvokeResponseBody::Json(value) if value.contains("xin chào"))
    );
    tauri::test::assert_ipc_response(
        &main,
        invoke_request(
            "write_terminal_clipboard",
            serde_json::json!({"terminalId":"terminal-1","text":"đã chọn"}),
        ),
        Ok(serde_json::Value::Null),
    );
    tauri::test::assert_ipc_response(
        &main,
        invoke_request(
            "open_terminal_link",
            serde_json::json!({"terminalId":"terminal-1","url":"https://bücher.example/path"}),
        ),
        Ok(serde_json::Value::Null),
    );

    process.finish();
    let stopped = tauri::async_runtime::block_on(manager.get_terminal("terminal-1"))
        .expect("the stopped terminal should remain retained");
    assert_ne!(
        stopped.state,
        xwork_lib::terminal::TerminalProcessStateDto::Running
    );
    tauri::test::assert_ipc_response(
        &main,
        invoke_request(
            "write_terminal_clipboard",
            serde_json::json!({"terminalId":"terminal-1","text":"stopped"}),
        ),
        Ok(serde_json::Value::Null),
    );
    tauri::test::assert_ipc_response(
        &main,
        invoke_request(
            "open_terminal_link",
            serde_json::json!({"terminalId":"terminal-1","url":"http://localhost:8080/"}),
        ),
        Ok(serde_json::Value::Null),
    );
    assert_eq!(
        tauri::test::get_ipc_response(
            &main,
            invoke_request(
                "read_terminal_clipboard",
                serde_json::json!({"terminalId":"terminal-1"}),
            ),
        )
        .expect_err("stopped terminals must reject Paste"),
        serde_json::json!({"code":"terminalNotRunning","terminalId":"terminal-1"})
    );
    assert_eq!(
        adapter.writes.lock().expect("writes lock").as_slice(),
        &["đã chọn".to_owned(), "stopped".to_owned()]
    );
    assert_eq!(
        adapter.opens.lock().expect("opens lock").as_slice(),
        &[
            "https://xn--bcher-kva.example/path".to_owned(),
            "http://localhost:8080/".to_owned(),
        ]
    );
    assert_eq!(process.writes.load(Ordering::SeqCst), 0);
}

/// Verifies invalid IDs, clipboard text and URLs are rejected before adapter side effects.
#[test]
fn invalid_interactions_are_safe_and_side_effect_free() {
    let process = Arc::new(FakeProcess {
        alive: AtomicBool::new(true),
        callbacks: Mutex::new(None),
        writes: AtomicUsize::new(0),
    });
    let manager = TerminalManager::new(
        Arc::new(FakeDependencies),
        Arc::new(NoopEvents),
        Arc::new(FakeFactory(process)),
    );
    let adapter = Arc::new(FakeAdapter {
        read: Mutex::new(Ok(None)),
        write_error: Mutex::new(None),
        open_error: Mutex::new(None),
        writes: Mutex::new(Vec::new()),
        opens: Mutex::new(Vec::new()),
    });
    let app = command_app(manager, adapter.clone());
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("main window should build");
    launch(&main);

    let nul = tauri::test::get_ipc_response(
        &main,
        invoke_request(
            "write_terminal_clipboard",
            serde_json::json!({"terminalId":"terminal-1","text":"bad\u{0}text"}),
        ),
    )
    .expect_err("NUL text should fail");
    assert_eq!(nul, serde_json::json!({"code":"unsupportedClipboardText"}));

    for url in [
        "file:///tmp/a".to_owned(),
        "javascript:alert(1)".to_owned(),
        "https://user@example.com".to_owned(),
        "https://example.com/with space".to_owned(),
        format!("https://example.com/{}", "a".repeat(8200)),
    ] {
        assert_eq!(
            tauri::test::get_ipc_response(
                &main,
                invoke_request(
                    "open_terminal_link",
                    serde_json::json!({"terminalId":"terminal-1","url":url}),
                ),
            )
            .expect_err("invalid URL should fail"),
            serde_json::json!({"code":"invalidLink"})
        );
    }
    assert!(adapter.writes.lock().expect("writes lock").is_empty());
    assert!(adapter.opens.lock().expect("opens lock").is_empty());
}

/// Verifies null clipboard text and native failures retain safe public categories.
#[test]
fn adapter_results_are_sanitized_without_native_details() {
    let process = Arc::new(FakeProcess {
        alive: AtomicBool::new(true),
        callbacks: Mutex::new(None),
        writes: AtomicUsize::new(0),
    });
    let manager = TerminalManager::new(
        Arc::new(FakeDependencies),
        Arc::new(NoopEvents),
        Arc::new(FakeFactory(process)),
    );
    let adapter = Arc::new(FakeAdapter {
        read: Mutex::new(Ok(None)),
        write_error: Mutex::new(None),
        open_error: Mutex::new(None),
        writes: Mutex::new(Vec::new()),
        opens: Mutex::new(Vec::new()),
    });
    let app = command_app(manager, adapter.clone());
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("main window should build");
    launch(&main);

    tauri::test::assert_ipc_response(
        &main,
        invoke_request(
            "read_terminal_clipboard",
            serde_json::json!({"terminalId":"terminal-1"}),
        ),
        Ok(serde_json::Value::Null),
    );
    *adapter.read.lock().expect("read lock") = Err(TerminalInteractionError::ClipboardUnavailable);
    assert_eq!(
        tauri::test::get_ipc_response(
            &main,
            invoke_request(
                "read_terminal_clipboard",
                serde_json::json!({"terminalId":"terminal-1"}),
            ),
        )
        .expect_err("clipboard failure should be public"),
        serde_json::json!({"code":"clipboardUnavailable"})
    );
    *adapter.open_error.lock().expect("open error lock") =
        Some(TerminalInteractionError::LinkOpenFailed);
    assert_eq!(
        tauri::test::get_ipc_response(
            &main,
            invoke_request(
                "open_terminal_link",
                serde_json::json!({"terminalId":"terminal-1","url":"https://example.com"}),
            ),
        )
        .expect_err("opener failure should be public"),
        serde_json::json!({"code":"linkOpenFailed"})
    );
    assert!(!format!("{:?}", TerminalInteractionError::ClipboardUnavailable).contains("secret"));
}
