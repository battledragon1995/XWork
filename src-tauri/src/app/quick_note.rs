//! Rust-owned singleton Quick Note orchestration and caller-scoped commands.
use crate::platform::global_shortcut::{
    GlobalShortcutPlatform, NativeGlobalShortcutPlatform, PlatformShortcut, PlatformShortcutCode,
};
use crate::settings::{KeyboardShortcutsDto, KeyboardShortcutsService, ShortcutChordDto};
use serde::Serialize;
use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use ts_rs::TS;

pub const ACTION_ID: &str = "quick_note.open_global";
pub const WINDOW_LABEL: &str = "quick-note";
pub const STATUS_EVENT: &str = "quick-note://global-shortcut-status-changed";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "quick-note-window.ts")]
pub enum QuickNoteGlobalShortcutStateDto {
    Active,
    DisabledByConflict,
    Unavailable,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "quick-note-window.ts")]
pub struct QuickNoteGlobalShortcutStatusDto {
    pub sequence: String,
    pub action_id: String,
    pub chord: ShortcutChordDto,
    pub state: QuickNoteGlobalShortcutStateDto,
    pub conflicts_with: Vec<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "quick-note-window.ts")]
pub enum QuickNoteWindowOperation {
    Create,
    Show,
    Unminimize,
    Focus,
    Close,
    StartDragging,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(
    tag = "code",
    rename_all = "snake_case",
    export_to = "quick-note-window.ts"
)]
pub enum QuickNoteWindowError {
    UnauthorizedWindow,
    AppShuttingDown,
    StaleWindow,
    WindowOperationFailed { operation: QuickNoteWindowOperation },
    Unavailable,
}
impl std::fmt::Display for QuickNoteWindowError {
    /// Reports only the stable operation category.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for QuickNoteWindowError {}

pub type WindowFuture = Pin<Box<dyn Future<Output = Result<(), QuickNoteWindowError>> + Send>>;
/// Supplies isolated window operations without owning Notes persistence.
#[doc(hidden)]
pub trait QuickNoteWindowPlatform: Send + Sync {
    /// Performs one native operation for the reserved instance generation.
    fn operate(&self, operation: QuickNoteWindowOperation, generation: u64) -> WindowFuture;
}
type ShutdownGuard = Arc<dyn Fn() -> bool + Send + Sync>;
type StatusSink = Arc<dyn Fn(QuickNoteGlobalShortcutStatusDto) + Send + Sync>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowPhase {
    Absent,
    Opening,
    Open,
    Closing,
}
struct WindowState {
    native_identity: Option<usize>,
    phase: WindowPhase,
    generation: u64,
}
struct ShortcutState {
    status: Option<QuickNoteGlobalShortcutStatusDto>,
    registered: Option<PlatformShortcut>,
    sequence: u64,
}
struct Inner {
    window: Mutex<WindowState>,
    window_gate: tokio::sync::Mutex<()>,
    shortcut: Mutex<ShortcutState>,
    reconcile_gate: tokio::sync::Mutex<()>,
    next_handler: AtomicU64,
    active_handler: AtomicU64,
    windows: Arc<dyn QuickNoteWindowPlatform>,
    shortcuts: Arc<dyn GlobalShortcutPlatform>,
    shutting_down: ShutdownGuard,
    sink: StatusSink,
}
#[derive(Clone)]
pub struct QuickNoteController {
    inner: Arc<Inner>,
}
impl QuickNoteController {
    /// Constructs an isolated controller; the initial catalog is reconciled by composition.
    #[doc(hidden)]
    pub fn new(
        windows: Arc<dyn QuickNoteWindowPlatform>,
        shortcuts: Arc<dyn GlobalShortcutPlatform>,
        shutting_down: ShutdownGuard,
        sink: StatusSink,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                window: Mutex::new(WindowState {
                    native_identity: None,
                    phase: WindowPhase::Absent,
                    generation: 0,
                }),
                window_gate: tokio::sync::Mutex::new(()),
                shortcut: Mutex::new(ShortcutState {
                    status: None,
                    registered: None,
                    sequence: 0,
                }),
                reconcile_gate: tokio::sync::Mutex::new(()),
                next_handler: AtomicU64::new(0),
                active_handler: AtomicU64::new(0),
                windows,
                shortcuts,
                shutting_down,
                sink,
            }),
        }
    }
    /// Returns the committed runtime registration snapshot.
    pub fn status(&self) -> Result<QuickNoteGlobalShortcutStatusDto, QuickNoteWindowError> {
        self.inner
            .shortcut
            .lock()
            .map_err(
                // Poisoned runtime state cannot safely report registration success.
                |_| QuickNoteWindowError::Unavailable,
            )?
            .status
            .clone()
            .ok_or(QuickNoteWindowError::Unavailable)
    }
    /// Opens or refocuses the singleton from a trusted Rust trigger.
    pub async fn open(&self) -> Result<(), QuickNoteWindowError> {
        self.open_trigger(None).await
    }
    /// Serializes native work without holding a blocking mutex across dispatch.
    async fn open_trigger(&self, handler: Option<u64>) -> Result<(), QuickNoteWindowError> {
        let _gate = self.inner.window_gate.lock().await;
        if (self.inner.shutting_down)() {
            return Err(QuickNoteWindowError::AppShuttingDown);
        }
        if let Some(handler) = handler
            && self.inner.active_handler.load(Ordering::Acquire) != handler
        {
            return Ok(());
        }
        let (create, generation) = {
            let mut state = self.inner.window.lock().map_err(
                // Rejects poisoned singleton state.
                |_| QuickNoteWindowError::Unavailable,
            )?;
            let create = state.phase == WindowPhase::Absent;
            if create {
                state.generation = state.generation.wrapping_add(1).max(1);
                state.phase = WindowPhase::Opening;
            }
            (create, state.generation)
        };
        if create {
            if let Err(error) = self
                .inner
                .windows
                .operate(QuickNoteWindowOperation::Create, generation)
                .await
            {
                self.destroyed(generation);
                return Err(error);
            }
            let mut state = self.inner.window.lock().map_err(
                // Prevents publication after poisoned state.
                |_| QuickNoteWindowError::Unavailable,
            )?;
            if state.generation != generation || state.phase == WindowPhase::Absent {
                return Err(QuickNoteWindowError::StaleWindow);
            }
            state.phase = WindowPhase::Open;
        }
        for operation in [
            QuickNoteWindowOperation::Show,
            QuickNoteWindowOperation::Unminimize,
            QuickNoteWindowOperation::Focus,
        ] {
            self.inner.windows.operate(operation, generation).await?;
        }
        Ok(())
    }
    /// Captures the current instance before an asynchronous close can queue.
    pub fn generation(&self) -> Result<u64, QuickNoteWindowError> {
        let state = self.inner.window.lock().map_err(
            // Rejects poisoned state instead of guessing an instance.
            |_| QuickNoteWindowError::Unavailable,
        )?;
        if state.phase == WindowPhase::Absent {
            return Err(QuickNoteWindowError::StaleWindow);
        }
        Ok(state.generation)
    }
    /// Closes only the generation that admitted this caller and retains it on failure.
    pub async fn close(&self, generation: u64) -> Result<(), QuickNoteWindowError> {
        let _gate = self.inner.window_gate.lock().await;
        {
            let mut state = self.inner.window.lock().map_err(
                // Rejects poisoned state before native effects.
                |_| QuickNoteWindowError::Unavailable,
            )?;
            if state.generation != generation || state.phase != WindowPhase::Open {
                return Err(QuickNoteWindowError::StaleWindow);
            }
            state.phase = WindowPhase::Closing;
        }
        let result = self
            .inner
            .windows
            .operate(QuickNoteWindowOperation::Close, generation)
            .await;
        if result.is_ok() {
            self.destroyed(generation);
        } else if let Ok(mut state) = self.inner.window.lock()
            && state.generation == generation
            && state.phase == WindowPhase::Closing
        {
            state.phase = WindowPhase::Open;
        }
        result
    }
    /// Drops only the destroyed instance; a late callback cannot erase its replacement.
    pub fn destroyed(&self, generation: u64) {
        if let Ok(mut state) = self.inner.window.lock()
            && state.generation == generation
        {
            state.phase = WindowPhase::Absent;
            state.native_identity = None;
        }
    }
    /// Reconciles the latest committed action while invalidating old callbacks first.
    pub async fn reconcile(
        &self,
        snapshot: KeyboardShortcutsDto,
    ) -> Result<(), QuickNoteWindowError> {
        let action = snapshot
            .actions
            .into_iter()
            .find(
                // Uses the catalog owner rather than inventing a fallback default.
                |action| action.action_id == ACTION_ID,
            )
            .ok_or(QuickNoteWindowError::Unavailable)?;
        let _gate = self.inner.reconcile_gate.lock().await;
        if (self.inner.shutting_down)() {
            return Ok(());
        }
        let desired = PlatformShortcutCode::try_from(action.current_chord.key_code.as_str())
            .ok()
            .map(
                // Translates owner DTO fields at the composition boundary.
                |key_code| PlatformShortcut {
                    primary: action.current_chord.primary,
                    alt: action.current_chord.alt,
                    shift: action.current_chord.shift,
                    key_code,
                },
            );
        {
            let state = self.inner.shortcut.lock().map_err(
                // Rejects poisoned registration state.
                |_| QuickNoteWindowError::Unavailable,
            )?;
            if action.is_dispatchable
                && state.registered == desired
                && self.inner.active_handler.load(Ordering::Acquire) != 0
            {
                return Ok(());
            }
        }
        self.inner.active_handler.store(0, Ordering::Release);
        let old = self
            .inner
            .shortcut
            .lock()
            .map_err(
                // Reads ownership before releasing the lock for OS dispatch.
                |_| QuickNoteWindowError::Unavailable,
            )?
            .registered;
        let mut available = true;
        if let Some(old) = old {
            let platform = self.inner.shortcuts.clone();
            available = tauri::async_runtime::spawn_blocking(
                // Plugin methods dispatch to the main thread and must not block an async worker.
                move || platform.unregister(&old),
            )
            .await
            .map_err(
                // Converts worker failure to unavailable registration.
                |_| QuickNoteWindowError::Unavailable,
            )?
            .is_ok();
            if available {
                self.inner
                    .shortcut
                    .lock()
                    .map_err(
                        // Clears confirmed OS ownership only after unregister succeeds.
                        |_| QuickNoteWindowError::Unavailable,
                    )?
                    .registered = None;
            }
        }
        if !available {
            eprintln!("quick-note global shortcut unregistration failed");
        }
        let mut state = if action.is_dispatchable {
            QuickNoteGlobalShortcutStateDto::Unavailable
        } else {
            QuickNoteGlobalShortcutStateDto::DisabledByConflict
        };
        if available
            && action.is_dispatchable
            && let Some(desired) = desired
        {
            let generation = self
                .inner
                .next_handler
                .fetch_add(1, Ordering::AcqRel)
                .wrapping_add(1)
                .max(1);
            let weak = Arc::downgrade(&self.inner);
            let callback = Arc::new(
                // Captures the registration generation so stale and released events cannot open windows.
                move |pressed: bool| {
                    if !pressed {
                        return;
                    }
                    if let Some(inner) = weak.upgrade()
                        && inner.active_handler.load(Ordering::Acquire) == generation
                    {
                        tauri::async_runtime::spawn(async move {
                            // Rechecks generation after acquiring the window operation gate.
                            let _ = QuickNoteController { inner }
                                .open_trigger(Some(generation))
                                .await;
                        });
                    }
                },
            );
            let platform = self.inner.shortcuts.clone();
            let registering = desired;
            if tauri::async_runtime::spawn_blocking(
                // Registers without retaining a controller mutex during native dispatch.
                move || platform.register(&registering, callback),
            )
            .await
            .map_err(
                // A worker failure leaves registration observably unavailable.
                |_| QuickNoteWindowError::Unavailable,
            )?
            .is_ok()
            {
                self.inner
                    .shortcut
                    .lock()
                    .map_err(
                        // Records ownership before admitting callbacks.
                        |_| QuickNoteWindowError::Unavailable,
                    )?
                    .registered = Some(desired);
                self.inner
                    .active_handler
                    .store(generation, Ordering::Release);
                state = QuickNoteGlobalShortcutStateDto::Active;
            }
        }
        if state == QuickNoteGlobalShortcutStateDto::Unavailable {
            eprintln!("quick-note global shortcut registration unavailable");
        }
        let mut next = QuickNoteGlobalShortcutStatusDto {
            sequence: String::new(),
            action_id: ACTION_ID.into(),
            chord: action.current_chord,
            state,
            conflicts_with: action.conflicts_with,
        };
        let changed = {
            let mut state = self.inner.shortcut.lock().map_err(
                // Commits the public status atomically.
                |_| QuickNoteWindowError::Unavailable,
            )?;
            next.sequence = state.sequence.to_string();
            if state.status.as_ref() == Some(&next) {
                false
            } else {
                state.sequence = state.sequence.wrapping_add(1);
                next.sequence = state.sequence.to_string();
                state.status = Some(next.clone());
                true
            }
        };
        if changed {
            (self.inner.sink)(next);
        }
        Ok(())
    }
    /// Invalidates handlers immediately and releases OS ownership before process exit.
    pub async fn shutdown(&self) {
        self.inner.active_handler.store(0, Ordering::Release);
        let _gate = self.inner.reconcile_gate.lock().await;
        self.inner.active_handler.store(0, Ordering::Release);
        let old = self.inner.shortcut.lock().ok().and_then(
            // Keeps failed unregister ownership available for a later retry.
            |state| state.registered,
        );
        if let Some(old) = old {
            let platform = self.inner.shortcuts.clone();
            if matches!(
                tauri::async_runtime::spawn_blocking(
                    // OS unregister is best effort during shutdown.
                    move || platform.unregister(&old)
                )
                .await,
                Ok(Ok(()))
            ) && let Ok(mut state) = self.inner.shortcut.lock()
            {
                state.registered = None;
            }
        }
    }
}

struct NativeWindows<R: Runtime> {
    app: AppHandle<R>,
}
impl<R: Runtime> QuickNoteWindowPlatform for NativeWindows<R> {
    /// Dispatches each native operation to the event-loop thread using a nonblocking response.
    fn operate(&self, operation: QuickNoteWindowOperation, generation: u64) -> WindowFuture {
        let app = self.app.clone();
        Box::pin(async move {
            let (tx, rx) = tokio::sync::oneshot::channel();
            let native_app = app.clone();
            app.run_on_main_thread(
                // Resolves the fixed label exclusively inside main-thread work.
                move || {
                    let _ = tx.send(native_operation(&native_app, operation, generation));
                },
            )
            .map_err(
                // Dispatch failure leaves no successful native acknowledgement.
                |_| QuickNoteWindowError::Unavailable,
            )?;
            rx.await.map_err(
                // Missing acknowledgement is a typed availability failure.
                |_| QuickNoteWindowError::Unavailable,
            )?
        })
    }
}
/// Executes the immutable native window policy without exposing any flags to IPC.
fn native_operation<R: Runtime>(
    app: &AppHandle<R>,
    operation: QuickNoteWindowOperation,
    generation: u64,
) -> Result<(), QuickNoteWindowError> {
    let failure =
        // Hides native error messages behind the stable operation category.
        |_| QuickNoteWindowError::WindowOperationFailed { operation };
    if operation == QuickNoteWindowOperation::Create {
        let window = WebviewWindowBuilder::new(
            app,
            WINDOW_LABEL,
            WebviewUrl::App("index.html?window=quick-note".into()),
        )
        .title("XWork Quick Note")
        .inner_size(560.0, 420.0)
        .min_inner_size(420.0, 300.0)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(true)
        .focused(true)
        .build()
        .map_err(failure)?;
        let identity = native_identity(&window)?;
        app.state::<QuickNoteController>()
            .inner
            .window
            .lock()
            .map_err(
                // Stores the OS identity only for production-created instances.
                |_| QuickNoteWindowError::Unavailable,
            )?
            .native_identity = Some(identity);
        let weak = Arc::downgrade(&app.state::<QuickNoteController>().inner);
        window.on_window_event(
            // Generation ownership protects a replacement from delayed native destruction.
            move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed)
                    && let Some(inner) = weak.upgrade()
                {
                    QuickNoteController { inner }.destroyed(generation);
                }
            },
        );
        return Ok(());
    }
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or(QuickNoteWindowError::StaleWindow)?;
    match operation {
        QuickNoteWindowOperation::Show => window.show(),
        QuickNoteWindowOperation::Unminimize => window.unminimize(),
        QuickNoteWindowOperation::Focus => window.set_focus(),
        QuickNoteWindowOperation::Close => window.destroy(),
        QuickNoteWindowOperation::StartDragging => window.start_dragging(),
        QuickNoteWindowOperation::Create => unreachable!(),
    }
    .map_err(failure)
}
/// Reads the invoking native handle so a replaced renderer cannot close its successor.
#[cfg(windows)]
fn native_identity<R: Runtime>(window: &WebviewWindow<R>) -> Result<usize, QuickNoteWindowError> {
    window
        .hwnd()
        .map(
            // The handle is compared only in process memory and never crosses IPC.
            |handle| handle.0 as usize,
        )
        .map_err(
            // A destroyed native caller is stale even if its label was reused.
            |_| QuickNoteWindowError::StaleWindow,
        )
}
/// Reads the native macOS identity; validation remains deferred to release preparation.
#[cfg(target_os = "macos")]
fn native_identity<R: Runtime>(window: &WebviewWindow<R>) -> Result<usize, QuickNoteWindowError> {
    window
        .ns_window()
        .map(
            // Native identity is used only to guard the current in-process generation.
            |handle| handle as usize,
        )
        .map_err(
            // An unavailable old native window must not act on a replacement.
            |_| QuickNoteWindowError::StaleWindow,
        )
}
/// Validates the actual invoking window before looking up managed state or dispatching work.
fn authorize(actual: &str, expected: &str) -> Result<(), QuickNoteWindowError> {
    if actual == expected {
        Ok(())
    } else {
        Err(QuickNoteWindowError::UnauthorizedWindow)
    }
}
/// Clones the managed controller without retaining a Tauri state borrow across await.
fn controller<R: Runtime>(app: &AppHandle<R>) -> Result<QuickNoteController, QuickNoteWindowError> {
    app.try_state::<QuickNoteController>()
        .map(
            // Clones the shared owner handle only.
            |state| state.inner().clone(),
        )
        .ok_or(QuickNoteWindowError::Unavailable)
}
/// Opens or focuses the singleton from the exact main window.
#[tauri::command]
pub async fn open_quick_note_window<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<(), QuickNoteWindowError> {
    authorize(window.label(), "main")?;
    controller(window.app_handle())?.open().await
}
/// Closes the admitted Quick Note instance after cancel or a separate Notes acknowledgement.
#[tauri::command]
pub async fn close_quick_note_window<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<(), QuickNoteWindowError> {
    authorize(window.label(), WINDOW_LABEL)?;
    let controller = controller(window.app_handle())?;
    let (expected, generation) = {
        let state = controller.inner.window.lock().map_err(
            // Captures identity and generation together before asynchronous close dispatch.
            |_| QuickNoteWindowError::Unavailable,
        )?;
        if state.phase == WindowPhase::Absent {
            return Err(QuickNoteWindowError::StaleWindow);
        }
        (state.native_identity, state.generation)
    };
    if let Some(expected) = expected
        && native_identity(&window)? != expected
    {
        return Err(QuickNoteWindowError::StaleWindow);
    }
    controller.close(generation).await
}
/// Starts native dragging without granting window plugin permission.
#[tauri::command]
pub fn start_quick_note_window_drag<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<(), QuickNoteWindowError> {
    authorize(window.label(), WINDOW_LABEL)?;
    window.start_dragging().map_err(
        // Identifies drag failure without exposing platform details.
        |_| QuickNoteWindowError::WindowOperationFailed {
            operation: QuickNoteWindowOperation::StartDragging,
        },
    )
}
/// Returns process-local registration status only to the main renderer.
#[tauri::command]
pub fn get_quick_note_global_shortcut_status<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<QuickNoteGlobalShortcutStatusDto, QuickNoteWindowError> {
    authorize(window.label(), "main")?;
    controller(window.app_handle())?.status()
}
/// Constructs production collaborators and starts the committed snapshot consumer after setup.
pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), QuickNoteWindowError> {
    let service = app.state::<KeyboardShortcutsService>().inner().clone();
    let mut snapshots = service.subscribe_snapshot();
    if !snapshots.borrow().actions.iter().any(
        // Missing binary catalog configuration is a hard startup error.
        |action| action.action_id == ACTION_ID,
    ) {
        return Err(QuickNoteWindowError::Unavailable);
    }
    let guard_app = app.clone();
    let sink_app = app.clone();
    let controller = QuickNoteController::new(
        Arc::new(NativeWindows { app: app.clone() }),
        Arc::new(NativeGlobalShortcutPlatform::new(app.clone())),
        Arc::new(
            // Lifecycle remains the authority and restores admission if runtime cleanup fails.
            move || {
                guard_app
                    .state::<super::lifecycle::AppLifecycleState>()
                    .is_shutting_down()
                    .unwrap_or(true)
            },
        ),
        Arc::new(
            // The event is main-scoped; tray refresh reads this same committed status.
            move |status| {
                if sink_app.emit_to("main", STATUS_EVENT, &status).is_err() {
                    eprintln!("quick-note status event failed");
                }
                let app = sink_app.clone();
                tauri::async_runtime::spawn(async move {
                    // Refreshes the accelerator without blocking the registration callback.
                    if super::tray::refresh_attention_menu(&app).await.is_err() {
                        eprintln!("quick-note tray refresh failed");
                    }
                });
            },
        ),
    );
    app.manage(controller.clone());
    tauri::async_runtime::spawn(async move {
        // Coalesces intermediate committed snapshots and never consumes uncommitted mutations.
        loop {
            let snapshot = snapshots.borrow_and_update().clone();
            if controller.reconcile(snapshot).await.is_err() {
                eprintln!("quick-note reconciliation unavailable");
            }
            if snapshots.changed().await.is_err() {
                break;
            }
        }
    });
    Ok(())
}
/// Runs lifecycle cleanup after releasing hotkeys, restoring registration when cleanup is retried.
pub(crate) async fn finish_shutdown<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), super::lifecycle::AppLifecycleError> {
    let controller = controller(app).ok();
    if let Some(controller) = &controller {
        controller.shutdown().await;
    }
    let result = app
        .state::<super::lifecycle::AppLifecycleState>()
        .finish_shutdown()
        .await;
    if result.is_err()
        && let Some(controller) = controller
    {
        let snapshot = app
            .state::<KeyboardShortcutsService>()
            .subscribe_snapshot()
            .borrow()
            .clone();
        let _ = controller.reconcile(snapshot).await;
    }
    result.map(
        // The caller owns process exit after successful cleanup.
        |_| (),
    )
}
