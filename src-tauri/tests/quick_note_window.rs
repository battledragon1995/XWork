use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use xwork_lib::{
    app::quick_note::{
        ACTION_ID, QuickNoteController, QuickNoteGlobalShortcutStateDto as State,
        QuickNoteGlobalShortcutStatusDto, QuickNoteWindowError as Error,
        QuickNoteWindowOperation as Operation, QuickNoteWindowPlatform, WindowFuture,
    },
    platform::global_shortcut::{
        GlobalShortcutPlatform, GlobalShortcutPlatformError as PlatformError, PlatformShortcut,
    },
    settings::{KeyboardShortcutsDto, KeyboardShortcutsService, ShortcutChordDto},
    shared::DataMaintenanceGate,
    storage::Storage,
};

#[derive(Default)]
struct FakeWindows {
    operations: Mutex<Vec<(Operation, u64)>>,
    fail_next: Mutex<Option<Operation>>,
}
impl QuickNoteWindowPlatform for FakeWindows {
    /// Records each operation and consumes a single injected native failure.
    fn operate(&self, operation: Operation, generation: u64) -> WindowFuture {
        self.operations
            .lock()
            .unwrap()
            .push((operation, generation));
        let mut failure = self.fail_next.lock().unwrap();
        let result = if *failure == Some(operation) {
            *failure = None;
            Err(Error::WindowOperationFailed { operation })
        } else {
            Ok(())
        };
        // Yields so concurrent callers exercise the controller's serialization gate.
        Box::pin(async move {
            tokio::task::yield_now().await;
            result
        })
    }
}
impl FakeWindows {
    /// Counts native attempts of the requested operation.
    fn count(&self, operation: Operation) -> usize {
        self.operations
            .lock()
            .unwrap()
            .iter()
            .filter(
                // Selects only the operation under assertion.
                |(actual, _)| *actual == operation,
            )
            .count()
    }
}

type Callback = Arc<dyn Fn(bool) + Send + Sync>;
#[derive(Default)]
struct FakeShortcuts {
    registrations: Mutex<Vec<(PlatformShortcut, Callback)>>,
    removals: Mutex<Vec<PlatformShortcut>>,
    fail_register: AtomicBool,
    fail_unregister: AtomicBool,
}
impl GlobalShortcutPlatform for FakeShortcuts {
    /// Retains even failed callbacks so tests can exercise stale native delivery.
    fn register(
        &self,
        shortcut: &PlatformShortcut,
        callback: Callback,
    ) -> Result<(), PlatformError> {
        self.registrations
            .lock()
            .unwrap()
            .push((*shortcut, callback));
        if self.fail_register.load(Ordering::SeqCst) {
            Err(PlatformError::RegistrationFailed)
        } else {
            Ok(())
        }
    }
    /// Records unregister attempts and returns a controlled platform failure.
    fn unregister(&self, shortcut: &PlatformShortcut) -> Result<(), PlatformError> {
        self.removals.lock().unwrap().push(*shortcut);
        if self.fail_unregister.load(Ordering::SeqCst) {
            Err(PlatformError::UnregistrationFailed)
        } else {
            Ok(())
        }
    }
}
impl FakeShortcuts {
    /// Clones a callback without holding the registry lock during delivery.
    fn callback(&self, index: usize) -> Callback {
        self.registrations.lock().unwrap()[index].1.clone()
    }
}

struct Harness {
    controller: QuickNoteController,
    windows: Arc<FakeWindows>,
    shortcuts: Arc<FakeShortcuts>,
    shutting_down: Arc<AtomicBool>,
    events: Arc<Mutex<Vec<QuickNoteGlobalShortcutStatusDto>>>,
    service: KeyboardShortcutsService,
    _dir: tempfile::TempDir,
}
impl Harness {
    /// Uses the real shortcut catalog and disposable storage with entirely fake native effects.
    fn new() -> Self {
        let dir = tempfile::TempDir::new().unwrap();
        let service = KeyboardShortcutsService::new(
            Storage::open(dir.path()).unwrap(),
            DataMaintenanceGate::new(),
        )
        .unwrap();
        let windows = Arc::new(FakeWindows::default());
        let shortcuts = Arc::new(FakeShortcuts::default());
        let shutting_down = Arc::new(AtomicBool::new(false));
        let events = Arc::new(Mutex::new(Vec::new()));
        let guard = shutting_down.clone();
        let sink = events.clone();
        let controller = QuickNoteController::new(
            windows.clone(),
            shortcuts.clone(),
            Arc::new(
                // Mirrors the lifecycle owner's current shutdown admission state.
                move || guard.load(Ordering::SeqCst),
            ),
            Arc::new(
                // Captures only committed observable registration changes.
                move |status| sink.lock().unwrap().push(status),
            ),
        );
        Self {
            controller,
            windows,
            shortcuts,
            shutting_down,
            events,
            service,
            _dir: dir,
        }
    }
    /// Reconciles the latest committed snapshot of the real catalog owner.
    async fn reconcile(&self) {
        self.controller
            .reconcile(self.service.snapshot().unwrap())
            .await
            .unwrap();
    }
    /// Mutates the global chord through the owner service rather than fabricating defaults.
    async fn change(&self, code: &str) {
        let service = self.service.clone();
        let chord = ShortcutChordDto {
            primary: true,
            alt: false,
            shift: true,
            key_code: code.into(),
        };
        tauri::async_runtime::spawn_blocking(
            // Runs the synchronous owner API outside the asynchronous test runtime.
            move || service.set_shortcut(ACTION_ID, &chord),
        )
        .await
        .unwrap()
        .unwrap();
    }
}

/// Proves concurrent triggers create one native instance and preserve its generation.
#[test]
fn twenty_simultaneous_opens_share_one_instance() {
    tauri::async_runtime::block_on(async {
        let h = Harness::new();
        let barrier = Arc::new(tokio::sync::Barrier::new(20));
        let mut workers = Vec::new();
        for _ in 0..20 {
            let controller = h.controller.clone();
            let barrier = barrier.clone();
            // Releases all open requests together to contend on the singleton gate.
            workers.push(tauri::async_runtime::spawn(async move {
                barrier.wait().await;
                controller.open().await
            }));
        }
        for worker in workers {
            worker.await.unwrap().unwrap();
        }
        assert_eq!(h.windows.count(Operation::Create), 1);
        assert_eq!(h.controller.generation().unwrap(), 1);
    });
}

/// Checks create and close retries plus delayed destruction and close from an obsolete instance.
#[test]
fn native_failures_retry_without_losing_generation_ownership() {
    tauri::async_runtime::block_on(async {
        let h = Harness::new();
        *h.windows.fail_next.lock().unwrap() = Some(Operation::Create);
        assert_eq!(
            h.controller.open().await,
            Err(Error::WindowOperationFailed {
                operation: Operation::Create
            })
        );
        assert_eq!(h.controller.generation(), Err(Error::StaleWindow));
        h.controller.open().await.unwrap();
        let first = h.controller.generation().unwrap();
        *h.windows.fail_next.lock().unwrap() = Some(Operation::Close);
        assert_eq!(
            h.controller.close(first).await,
            Err(Error::WindowOperationFailed {
                operation: Operation::Close
            })
        );
        assert_eq!(h.controller.generation().unwrap(), first);
        h.controller.close(first).await.unwrap();
        h.controller.open().await.unwrap();
        let replacement = h.controller.generation().unwrap();
        assert!(replacement > first);
        h.controller.destroyed(first);
        assert_eq!(h.controller.generation().unwrap(), replacement);
        assert_eq!(h.controller.close(first).await, Err(Error::StaleWindow));
        h.controller.destroyed(replacement);
        assert_eq!(h.controller.generation(), Err(Error::StaleWindow));
    });
}

/// Preserves the created instance when a visibility or focus operation fails and retries it safely.
#[test]
fn show_unminimize_and_focus_failures_reuse_the_existing_generation() {
    tauri::async_runtime::block_on(async {
        for operation in [Operation::Show, Operation::Unminimize, Operation::Focus] {
            let h = Harness::new();
            *h.windows.fail_next.lock().unwrap() = Some(operation);
            assert_eq!(
                h.controller.open().await,
                Err(Error::WindowOperationFailed { operation })
            );
            let generation = h.controller.generation().unwrap();
            assert_eq!(h.windows.count(Operation::Create), 1);
            h.controller.open().await.unwrap();
            assert_eq!(h.controller.generation().unwrap(), generation);
            assert_eq!(h.windows.count(Operation::Create), 1);
            assert_eq!(h.windows.count(operation), 2);
        }
    });
}

/// Confirms missing catalog data is fatal while a normal reconcile has stable no-op sequencing.
#[test]
fn catalog_status_conflict_and_noop_follow_committed_snapshots() {
    tauri::async_runtime::block_on(async {
        let h = Harness::new();
        assert_eq!(h.controller.status(), Err(Error::Unavailable));
        let mut missing: KeyboardShortcutsDto = h.service.snapshot().unwrap();
        missing.actions.clear();
        assert_eq!(
            h.controller.reconcile(missing).await,
            Err(Error::Unavailable)
        );
        h.reconcile().await;
        let active = h.controller.status().unwrap();
        assert_eq!(active.state, State::Active);
        assert_eq!(active.sequence, "1");
        h.reconcile().await;
        assert_eq!(h.controller.status().unwrap(), active);
        assert_eq!(h.shortcuts.registrations.lock().unwrap().len(), 1);
        let service = h.service.clone();
        tauri::async_runtime::spawn_blocking(
            // Commits the conflict through the synchronous owner on a blocking worker.
            move || service.set_shortcut("tabs.create", &active.chord),
        )
        .await
        .unwrap()
        .unwrap();
        h.reconcile().await;
        let conflict = h.controller.status().unwrap();
        assert_eq!(conflict.state, State::DisabledByConflict);
        assert_eq!(conflict.sequence, "2");
        assert_eq!(conflict.conflicts_with, vec!["tabs.create"]);
        assert_eq!(h.shortcuts.removals.lock().unwrap().len(), 1);
        h.reconcile().await;
        assert_eq!(h.controller.status().unwrap(), conflict);
        let service = h.service.clone();
        tauri::async_runtime::spawn_blocking(
            // Resets the persisted conflict outside the async test runtime.
            move || service.reset_shortcut("tabs.create"),
        )
        .await
        .unwrap()
        .unwrap();
        h.reconcile().await;
        assert_eq!(h.controller.status().unwrap().state, State::Active);
        assert_eq!(h.controller.status().unwrap().sequence, "3");
        assert_eq!(h.events.lock().unwrap().len(), 3);
    });
}

/// Gives any incorrectly admitted callback a bounded chance to reach its first native operation.
async fn settle_callbacks() {
    tokio::time::sleep(Duration::from_millis(50)).await;
}

/// Checks fail-soft registration and failed unregister preserve ownership while rejecting stale events.
#[test]
fn platform_failures_and_old_or_released_callbacks_cannot_open() {
    tauri::async_runtime::block_on(async {
        let h = Harness::new();
        h.shortcuts.fail_register.store(true, Ordering::SeqCst);
        h.reconcile().await;
        assert_eq!(h.controller.status().unwrap().state, State::Unavailable);
        let failed = h.shortcuts.callback(0);
        failed(true);
        settle_callbacks().await;
        assert_eq!(h.windows.count(Operation::Create), 0);
        h.shortcuts.fail_register.store(false, Ordering::SeqCst);
        h.reconcile().await;
        let old = h.shortcuts.callback(1);
        old(false);
        settle_callbacks().await;
        assert_eq!(h.windows.count(Operation::Create), 0);
        h.change("KeyY").await;
        h.shortcuts.fail_unregister.store(true, Ordering::SeqCst);
        h.reconcile().await;
        assert_eq!(h.controller.status().unwrap().state, State::Unavailable);
        assert_eq!(h.shortcuts.registrations.lock().unwrap().len(), 2);
        old(true);
        settle_callbacks().await;
        assert_eq!(h.windows.count(Operation::Create), 0);
        h.shortcuts.fail_unregister.store(false, Ordering::SeqCst);
        h.reconcile().await;
        assert_eq!(h.shortcuts.removals.lock().unwrap().len(), 2);
        assert_eq!(h.controller.status().unwrap().state, State::Active);
        old(true);
        failed(true);
        settle_callbacks().await;
        assert_eq!(h.windows.count(Operation::Create), 0);
        let current = h.shortcuts.callback(2);
        current(true);
        // Waits for successful delivery with a finite failure deadline.
        tokio::time::timeout(Duration::from_secs(2), async {
            while h.windows.count(Operation::Focus) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(h.windows.count(Operation::Create), 1);
    });
}

/// Blocks explicit and callback opens during Quit and releases the registered shortcut.
#[test]
fn shutdown_invalidates_callbacks_and_blocks_new_windows() {
    tauri::async_runtime::block_on(async {
        let h = Harness::new();
        h.reconcile().await;
        let callback = h.shortcuts.callback(0);
        h.shutting_down.store(true, Ordering::SeqCst);
        assert_eq!(h.controller.open().await, Err(Error::AppShuttingDown));
        h.controller.shutdown().await;
        callback(true);
        settle_callbacks().await;
        assert_eq!(h.windows.count(Operation::Create), 0);
        assert_eq!(h.shortcuts.removals.lock().unwrap().len(), 1);
        h.change("KeyY").await;
        h.reconcile().await;
        assert_eq!(h.shortcuts.registrations.lock().unwrap().len(), 1);
    });
}

/// Invokes the production IPC router using the actual mock invoking window.
fn invoke(window: &WebviewWindow<tauri::test::MockRuntime>, command: &str) -> Result<Value, Value> {
    invoke_body(window, command, json!({}))
}

/// Sends a structured payload through the production IPC router.
fn invoke_body(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(
        // Decodes typed IPC responses for exact authorization assertions.
        |response| response.deserialize().unwrap(),
    )
}

/// Persists through Notes IPC and retries only close after a native failure without duplicating the note.
#[test]
fn notes_save_acknowledgement_precedes_close_and_close_retry_keeps_one_note() {
    let h = Harness::new();
    let dir = tempfile::TempDir::new().unwrap();
    let mut app = xwork_lib::app::configure_with_app_data_dir(
        tauri::test::mock_builder(),
        dir.path().to_path_buf(),
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .unwrap();
    #[allow(deprecated)]
    app.run_iteration(
        // Initializes the real Notes service with an isolated temporary database.
        |_, _| {},
    );
    assert!(app.manage(h.controller.clone()));
    let main = app.get_webview_window("main").unwrap_or_else(
        // Reuses a main window if the production setup already supplied one.
        || {
            WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .unwrap()
        },
    );
    let quick = WebviewWindowBuilder::new(&app, "quick-note", Default::default())
        .build()
        .unwrap();
    invoke(&main, "open_quick_note_window").unwrap();
    let invalid = invoke_body(
        &quick,
        "create_note",
        json!({"input": {"title": null, "contentMarkdown": "", "projectId": null}}),
    );
    assert_eq!(invalid, Err(json!({"code": "empty_initial_content"})));
    assert_eq!(h.windows.count(Operation::Close), 0);
    let note = invoke_body(&quick, "create_note", json!({"input": {"title": "Quick capture", "contentMarkdown": "Saved once", "projectId": null}})).unwrap();
    assert_eq!(note["contentMarkdown"], "Saved once");
    assert_eq!(h.windows.count(Operation::Close), 0);
    *h.windows.fail_next.lock().unwrap() = Some(Operation::Close);
    assert_eq!(
        invoke(&quick, "close_quick_note_window"),
        Err(json!({"code": "window_operation_failed", "operation": "close"}))
    );
    invoke(&quick, "close_quick_note_window").unwrap();
    let input = json!({"input": {"status": "active", "query": null, "projectFilter": {"kind": "all"}, "pinnedFilter": "any", "offset": 0, "limit": 50}});
    assert_eq!(
        invoke_body(&quick, "list_notes", input.clone()),
        Err(json!({"code": "unauthorized_window"}))
    );
    let page = invoke_body(&main, "list_notes", input).unwrap();
    assert_eq!(page["totalMatches"], 1);
    assert_eq!(page["items"][0]["id"], note["id"]);
    assert_eq!(h.windows.count(Operation::Close), 2);
}

/// Verifies all four commands enforce exact caller labels through the production handler.
#[test]
fn ipc_authorization_matrix_uses_actual_invoking_windows() {
    let h = Harness::new();
    let dir = tempfile::TempDir::new().unwrap();
    let mut app = xwork_lib::app::configure_with_app_data_dir(
        tauri::test::mock_builder(),
        dir.path().to_path_buf(),
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .unwrap();
    #[allow(deprecated)]
    app.run_iteration(
        // Runs production state setup without creating native desktop windows.
        |_, _| {},
    );
    assert!(app.manage(h.controller.clone()));
    tauri::async_runtime::block_on(h.reconcile());
    for label in ["main", "quick-note", "secondary", "quick-note-extra"] {
        let window = app.get_webview_window(label).unwrap_or_else(
            // Supplies one exact mock caller label per authorization row.
            || {
                WebviewWindowBuilder::new(&app, label, Default::default())
                    .build()
                    .unwrap()
            },
        );
        for (command, allowed) in [
            ("open_quick_note_window", "main"),
            ("get_quick_note_global_shortcut_status", "main"),
            ("close_quick_note_window", "quick-note"),
            ("start_quick_note_window_drag", "quick-note"),
        ] {
            let result = invoke(&window, command);
            if label != allowed {
                assert_eq!(
                    result,
                    Err(json!({ "code": "unauthorized_window" })),
                    "{label}: {command}"
                );
            } else {
                assert!(result.is_ok(), "{label}: {command}: {result:?}");
            }
        }
    }
}
