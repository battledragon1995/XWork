use std::{
    fmt::{Display, Formatter},
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard},
};

use serde::Serialize;
use tauri::{AppHandle, Runtime, State, WebviewWindow};
use ts_rs::TS;

use crate::platform::window::{hide_window, minimize_window, toggle_window_maximized};

pub use crate::platform::window::WindowOperation;

/// Contains runtime counts shown by the Quit confirmation dialog.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "app-lifecycle.ts")]
pub struct QuitSummaryDto {
    pub session_count: u32,
    pub project_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

/// Identifies one pending Quit request and its immutable snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "app-lifecycle.ts")]
pub struct QuitRequestDto {
    pub request_id: u32,
    pub summary: QuitSummaryDto,
}

/// Carries an opaque session identifier to frontend navigation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "app-lifecycle.ts")]
pub struct SessionNavigationDto {
    pub session_id: String,
}

/// Identifies the native tray operation that failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
#[ts(export_to = "app-lifecycle.ts")]
pub enum TrayOperation {
    CreateIcon,
    BuildMenu,
    ReplaceMenu,
}

/// Identifies the lifecycle event that could not be delivered.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
#[ts(export_to = "app-lifecycle.ts")]
pub enum LifecycleEvent {
    QuitRequested,
    NavigateSession,
}

/// Describes lifecycle failures without exposing native or runtime details.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
#[ts(export_to = "app-lifecycle.ts")]
pub enum AppLifecycleError {
    InvalidWindow,
    UnauthorizedWindow,
    MainWindowUnavailable,
    WindowOperationFailed { operation: WindowOperation },
    TrayOperationFailed { operation: TrayOperation },
    EventDeliveryFailed { event: LifecycleEvent },
    RuntimeSnapshotFailed,
    RuntimeShutdownFailed,
    InvalidRequestId,
    StaleQuitRequest,
    QuitAlreadyInProgress,
    StateLockPoisoned,
}

impl Display for AppLifecycleError {
    /// Formats a lifecycle failure without including sensitive source details.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "application lifecycle error: {self:?}")
    }
}

impl std::error::Error for AppLifecycleError {}

impl From<WindowOperation> for AppLifecycleError {
    /// Converts a native operation category into the public lifecycle error.
    fn from(operation: WindowOperation) -> Self {
        Self::WindowOperationFailed { operation }
    }
}

/// Boxes runtime futures while preserving borrowing and object safety.
#[doc(hidden)]
pub type AppRuntimeFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Supplies runtime snapshots, attention sessions, and orderly shutdown.
#[doc(hidden)]
pub trait AppRuntime: Send + Sync {
    /// Returns a consistent snapshot for the Quit decision.
    fn quit_summary<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>>;

    /// Returns sessions currently represented in the attention tray group.
    fn attention_sessions<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>>;

    /// Stops all transient runtime resources before process exit.
    fn shutdown_for_quit<'a>(&'a self) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>>;
}

/// Describes one session eligible for the tray attention group.
#[derive(Clone, Debug, PartialEq, Eq)]
#[doc(hidden)]
pub struct AttentionSession {
    pub session_id: String,
    pub project_name: String,
    pub session_name: String,
    pub status_label: Option<String>,
    pub attention_sequence: u64,
}

/// Implements the empty Phase 1 runtime without persisted session state.
pub(crate) struct EmptyAppRuntime;

impl AppRuntime for EmptyAppRuntime {
    /// Returns an empty Quit snapshot for the initial application slice.
    fn quit_summary<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>> {
        Box::pin(async { Ok(QuitSummaryDto::default()) })
    }

    /// Returns no attention sessions before session runtime is implemented.
    fn attention_sessions<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    /// Completes cleanup because Phase 1 owns no transient runtime resources.
    fn shutdown_for_quit<'a>(&'a self) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Reports the state-machine decision after a Quit request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum QuitFlow {
    Dialog(QuitRequestDto),
    ProceedShutdown,
}

/// Reports successful completion of the runtime shutdown pipeline.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShutdownOutcome {
    ExitReady,
}

/// Stores the process-local Quit state and its runtime adapter.
#[doc(hidden)]
pub struct AppLifecycleState {
    runtime: Arc<dyn AppRuntime>,
    inner: Mutex<LifecycleInner>,
}

/// Stores mutable lifecycle state guarded by one short-lived mutex.
struct LifecycleInner {
    phase: LifecyclePhase,
    next_request_id: u32,
}

/// Represents mutually exclusive Quit transitions within one process.
enum LifecyclePhase {
    Idle,
    Snapshotting,
    Pending(QuitRequestDto),
    ShuttingDown(Option<QuitRequestDto>),
}

impl AppLifecycleState {
    /// Creates process-local lifecycle state for the supplied runtime adapter.
    #[doc(hidden)]
    pub fn new(runtime: Arc<dyn AppRuntime>) -> Self {
        Self {
            runtime,
            inner: Mutex::new(LifecycleInner {
                phase: LifecyclePhase::Idle,
                next_request_id: 1,
            }),
        }
    }

    /// Starts or reuses the process-wide Quit request.
    pub(crate) async fn request_quit(&self) -> Result<QuitFlow, AppLifecycleError> {
        {
            let mut inner = self.lock_inner()?;
            match &inner.phase {
                LifecyclePhase::Pending(request) => {
                    return Ok(QuitFlow::Dialog(request.clone()));
                }
                LifecyclePhase::Snapshotting | LifecyclePhase::ShuttingDown(_) => {
                    return Err(AppLifecycleError::QuitAlreadyInProgress);
                }
                LifecyclePhase::Idle => {
                    // The transient marker prevents competing callers from creating two requests.
                    inner.phase = LifecyclePhase::Snapshotting;
                }
            }
        }

        // Runtime work must never hold the lifecycle mutex across an await.
        let summary_result = self.runtime.quit_summary().await;
        let mut inner = self.lock_inner()?;
        let summary = match summary_result {
            Ok(summary) => summary,
            Err(_) => {
                inner.phase = LifecyclePhase::Idle;
                return Err(AppLifecycleError::RuntimeSnapshotFailed);
            }
        };

        if summary.session_count == 0 {
            inner.phase = LifecyclePhase::ShuttingDown(None);
            return Ok(QuitFlow::ProceedShutdown);
        }

        let request_id = inner.allocate_request_id();
        let request = QuitRequestDto {
            request_id,
            summary,
        };
        inner.phase = LifecyclePhase::Pending(request.clone());
        Ok(QuitFlow::Dialog(request))
    }

    /// Cancels the matching pending Quit request without touching runtime state.
    pub(crate) fn cancel_quit(&self, request_id: u32) -> Result<(), AppLifecycleError> {
        validate_request_id(request_id)?;
        let mut inner = self.lock_inner()?;
        match &inner.phase {
            LifecyclePhase::ShuttingDown(_) | LifecyclePhase::Snapshotting => {
                Err(AppLifecycleError::QuitAlreadyInProgress)
            }
            LifecyclePhase::Pending(request) if request.request_id == request_id => {
                inner.phase = LifecyclePhase::Idle;
                Ok(())
            }
            LifecyclePhase::Idle | LifecyclePhase::Pending(_) => {
                Err(AppLifecycleError::StaleQuitRequest)
            }
        }
    }

    /// Atomically reserves the matching pending request for shutdown.
    pub(crate) fn begin_confirm_quit(&self, request_id: u32) -> Result<(), AppLifecycleError> {
        validate_request_id(request_id)?;
        let mut inner = self.lock_inner()?;
        match &inner.phase {
            LifecyclePhase::ShuttingDown(_) | LifecyclePhase::Snapshotting => {
                Err(AppLifecycleError::QuitAlreadyInProgress)
            }
            LifecyclePhase::Pending(request) if request.request_id == request_id => {
                let request = request.clone();
                inner.phase = LifecyclePhase::ShuttingDown(Some(request));
                Ok(())
            }
            LifecyclePhase::Idle | LifecyclePhase::Pending(_) => {
                Err(AppLifecycleError::StaleQuitRequest)
            }
        }
    }

    /// Awaits runtime cleanup and commits or rolls back the shutdown transition.
    pub(crate) async fn finish_shutdown(&self) -> Result<ShutdownOutcome, AppLifecycleError> {
        let previous_request = {
            let inner = self.lock_inner()?;
            match &inner.phase {
                LifecyclePhase::ShuttingDown(request) => request.clone(),
                _ => return Err(AppLifecycleError::QuitAlreadyInProgress),
            }
        };
        // Runtime cleanup is deliberately awaited after releasing the lifecycle mutex.
        let shutdown_result = self.runtime.shutdown_for_quit().await;
        let mut inner = self.lock_inner()?;

        match shutdown_result {
            Ok(()) => {
                // Keep shutdown terminal until process exit so no new Quit or close flow can race it.
                inner.phase = LifecyclePhase::ShuttingDown(None);
                Ok(ShutdownOutcome::ExitReady)
            }
            Err(_) => {
                // A confirmed request is restored verbatim so the same dialog can retry.
                inner.phase = previous_request
                    .map(LifecyclePhase::Pending)
                    .unwrap_or(LifecyclePhase::Idle);
                Err(AppLifecycleError::RuntimeShutdownFailed)
            }
        }
    }

    /// Retrieves the current attention-session snapshot through the runtime seam.
    pub(crate) async fn attention_sessions(
        &self,
    ) -> Result<Vec<AttentionSession>, AppLifecycleError> {
        self.runtime.attention_sessions().await.map_err(
            // Hides runtime-owned source details behind the snapshot category.
            |_| AppLifecycleError::RuntimeSnapshotFailed,
        )
    }

    /// Reports whether native close handling must allow process exit.
    pub(crate) fn is_shutting_down(&self) -> Result<bool, AppLifecycleError> {
        let inner = self.lock_inner()?;
        Ok(matches!(inner.phase, LifecyclePhase::ShuttingDown(_)))
    }

    /// Returns the pending request for hermetic integration assertions.
    #[doc(hidden)]
    pub fn pending_request_for_tests(&self) -> Result<Option<QuitRequestDto>, AppLifecycleError> {
        let inner = self.lock_inner()?;
        Ok(match &inner.phase {
            LifecyclePhase::Pending(request) | LifecyclePhase::ShuttingDown(Some(request)) => {
                Some(request.clone())
            }
            LifecyclePhase::Idle
            | LifecyclePhase::Snapshotting
            | LifecyclePhase::ShuttingDown(None) => None,
        })
    }

    /// Probes whether runtime futures are executing without the lifecycle mutex.
    #[doc(hidden)]
    pub fn try_lock_inner_for_tests(&self) -> bool {
        self.inner.try_lock().is_ok()
    }

    /// Acquires the lifecycle mutex and maps poisoning to the public category.
    fn lock_inner(&self) -> Result<MutexGuard<'_, LifecycleInner>, AppLifecycleError> {
        self.inner.lock().map_err(
            // Converts mutex poisoning into the stable lifecycle error contract.
            |_| AppLifecycleError::StateLockPoisoned,
        )
    }
}

impl LifecycleInner {
    /// Allocates the next nonzero process-local request identifier.
    fn allocate_request_id(&mut self) -> u32 {
        let request_id = self.next_request_id.max(1);
        self.next_request_id = request_id.checked_add(1).unwrap_or(1);
        request_id
    }
}

/// Restricts a window-management command to the exact main window label.
pub(crate) fn authorize_window_command(label: &str) -> Result<(), AppLifecycleError> {
    if label == "main" {
        Ok(())
    } else {
        Err(AppLifecycleError::InvalidWindow)
    }
}

/// Restricts a Quit command to the exact main window label.
pub(crate) fn authorize_quit_command(label: &str) -> Result<(), AppLifecycleError> {
    if label == "main" {
        Ok(())
    } else {
        Err(AppLifecycleError::UnauthorizedWindow)
    }
}

/// Rejects the reserved zero request identifier before any state transition.
fn validate_request_id(request_id: u32) -> Result<(), AppLifecycleError> {
    if request_id == 0 {
        Err(AppLifecycleError::InvalidRequestId)
    } else {
        Ok(())
    }
}

/// Hides the invoking main window without changing runtime or Quit state.
#[tauri::command]
pub(crate) fn hide_main_window<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<(), AppLifecycleError> {
    authorize_window_command(window.label())?;
    hide_window(&window).map_err(AppLifecycleError::from)
}

/// Minimizes the invoking main window without changing runtime or Quit state.
#[tauri::command]
pub(crate) fn minimize_main_window<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<(), AppLifecycleError> {
    authorize_window_command(window.label())?;
    minimize_window(&window).map_err(AppLifecycleError::from)
}

/// Toggles maximization for the invoking main window.
#[tauri::command]
pub(crate) fn toggle_main_window_maximized<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<bool, AppLifecycleError> {
    authorize_window_command(window.label())?;
    toggle_window_maximized(&window).map_err(AppLifecycleError::from)
}

/// Starts a Quit request and exits immediately only when no dialog is required.
#[tauri::command]
pub(crate) async fn request_quit<R: Runtime>(
    window: WebviewWindow<R>,
    app: AppHandle<R>,
    state: State<'_, AppLifecycleState>,
) -> Result<Option<QuitRequestDto>, AppLifecycleError> {
    authorize_quit_command(window.label())?;
    match state.request_quit().await? {
        QuitFlow::Dialog(request) => Ok(Some(request)),
        QuitFlow::ProceedShutdown => {
            state.finish_shutdown().await?;
            app.exit(0);
            Ok(None)
        }
    }
}

/// Cancels the invoking main window's matching pending Quit request.
#[tauri::command]
pub(crate) fn cancel_quit<R: Runtime>(
    window: WebviewWindow<R>,
    request_id: u32,
    state: State<'_, AppLifecycleState>,
) -> Result<(), AppLifecycleError> {
    authorize_quit_command(window.label())?;
    state.cancel_quit(request_id)
}

/// Confirms, cleans up, and exits for the matching pending Quit request.
#[tauri::command]
pub(crate) async fn confirm_quit<R: Runtime>(
    window: WebviewWindow<R>,
    request_id: u32,
    app: AppHandle<R>,
    state: State<'_, AppLifecycleState>,
) -> Result<(), AppLifecycleError> {
    authorize_quit_command(window.label())?;
    state.begin_confirm_quit(request_id)?;
    state.finish_shutdown().await?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        future::Future,
        panic::{AssertUnwindSafe, catch_unwind},
        pin::Pin,
        sync::{
            Arc, Mutex, Weak,
            atomic::{AtomicUsize, Ordering},
        },
        task::{Context, Poll},
    };

    use super::{
        AppLifecycleError, AppLifecycleState, AppRuntime, AppRuntimeFuture, AttentionSession,
        QuitFlow, QuitSummaryDto, ShutdownOutcome, authorize_quit_command,
        authorize_window_command,
    };

    /// Provides configurable snapshots and shutdown results for state-machine tests.
    struct FakeRuntime {
        summary: Mutex<Result<QuitSummaryDto, AppLifecycleError>>,
        shutdown: Mutex<Result<(), AppLifecycleError>>,
        summary_calls: AtomicUsize,
        shutdown_calls: AtomicUsize,
    }

    impl FakeRuntime {
        /// Creates a fake runtime with successful cleanup.
        fn new(summary: Result<QuitSummaryDto, AppLifecycleError>) -> Self {
            Self {
                summary: Mutex::new(summary),
                shutdown: Mutex::new(Ok(())),
                summary_calls: AtomicUsize::new(0),
                shutdown_calls: AtomicUsize::new(0),
            }
        }

        /// Replaces the cleanup result for failure-path tests.
        fn set_shutdown(&self, result: Result<(), AppLifecycleError>) {
            *self
                .shutdown
                .lock()
                .expect("the shutdown fixture lock should be available") = result;
        }
    }

    impl AppRuntime for FakeRuntime {
        /// Returns the configured Quit snapshot and records the request.
        fn quit_summary<'a>(
            &'a self,
        ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>> {
            self.summary_calls.fetch_add(1, Ordering::SeqCst);
            let result = self
                .summary
                .lock()
                .expect("the summary fixture lock should be available")
                .clone();
            Box::pin(async move { result })
        }

        /// Returns no attention sessions because these tests exercise Quit state only.
        fn attention_sessions<'a>(
            &'a self,
        ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>> {
            Box::pin(async { Ok(Vec::new()) })
        }

        /// Returns the configured cleanup result and records the request.
        fn shutdown_for_quit<'a>(&'a self) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>> {
            self.shutdown_calls.fetch_add(1, Ordering::SeqCst);
            let result = self
                .shutdown
                .lock()
                .expect("the shutdown fixture lock should be available")
                .clone();
            Box::pin(async move { result })
        }
    }

    /// Yields once so a runtime future can probe the lifecycle lock after suspension.
    struct YieldOnce(bool);

    impl Future for YieldOnce {
        type Output = ();

        /// Returns pending once, wakes the task, then completes on the next poll.
        fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
            if self.0 {
                Poll::Ready(())
            } else {
                self.0 = true;
                context.waker().wake_by_ref();
                Poll::Pending
            }
        }
    }

    /// Probes that the lifecycle mutex is released while snapshots are awaited.
    struct LockProbeRuntime {
        state: Mutex<Option<Weak<AppLifecycleState>>>,
    }

    impl AppRuntime for LockProbeRuntime {
        /// Yields and then fails if the lifecycle lock remains held.
        fn quit_summary<'a>(
            &'a self,
        ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>> {
            Box::pin(async move {
                YieldOnce(false).await;
                let state = self
                    .state
                    .lock()
                    .expect("the probe state lock should be available")
                    .as_ref()
                    .and_then(Weak::upgrade)
                    .expect("the lifecycle state should still exist");
                if state.try_lock_inner_for_tests() {
                    Ok(summary(1))
                } else {
                    Err(AppLifecycleError::RuntimeSnapshotFailed)
                }
            })
        }

        /// Returns no attention sessions for the lock probe.
        fn attention_sessions<'a>(
            &'a self,
        ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>> {
            Box::pin(async { Ok(Vec::new()) })
        }

        /// Yields and then fails if the lifecycle lock remains held during cleanup.
        fn shutdown_for_quit<'a>(&'a self) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>> {
            Box::pin(async move {
                YieldOnce(false).await;
                let state = self
                    .state
                    .lock()
                    .expect("the probe state lock should be available")
                    .as_ref()
                    .and_then(Weak::upgrade)
                    .expect("the lifecycle state should still exist");
                if state.try_lock_inner_for_tests() {
                    Ok(())
                } else {
                    Err(AppLifecycleError::RuntimeShutdownFailed)
                }
            })
        }
    }

    /// Creates a Quit snapshot with the requested session count.
    fn summary(session_count: u32) -> QuitSummaryDto {
        QuitSummaryDto {
            session_count,
            project_count: 1,
            running_process_count: 3,
            unsaved_file_count: 2,
        }
    }

    /// Extracts a dialog request from a state-machine result.
    fn dialog_request(flow: QuitFlow) -> super::QuitRequestDto {
        match flow {
            QuitFlow::Dialog(request) => request,
            QuitFlow::ProceedShutdown => panic!("the fixture should require a dialog"),
        }
    }

    /// Verifies the distinct exact-label authorization errors.
    #[test]
    fn authorization_uses_exact_main_label() {
        assert_eq!(authorize_window_command("main"), Ok(()));
        assert_eq!(
            authorize_window_command("quick-note"),
            Err(AppLifecycleError::InvalidWindow)
        );
        assert_eq!(authorize_quit_command("main"), Ok(()));
        assert_eq!(
            authorize_quit_command("Main"),
            Err(AppLifecycleError::UnauthorizedWindow)
        );
    }

    /// Verifies that repeated Quit entry points reuse one immutable request.
    #[test]
    fn pending_quit_request_is_reused() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(2))));
        let state = AppLifecycleState::new(runtime.clone());

        let first = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the first request should succeed"),
        );
        let second = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the repeated request should succeed"),
        );

        assert_eq!(first, second);
        assert_eq!(first.request_id, 1);
        assert_eq!(first.summary, summary(2));
        assert_eq!(runtime.summary_calls.load(Ordering::SeqCst), 1);
    }

    /// Verifies cancellation, stale IDs, zero IDs, and double-confirm behavior.
    #[test]
    fn request_ids_guard_each_transition() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(1))));
        let state = AppLifecycleState::new(runtime);
        let request = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the request should succeed"),
        );

        assert_eq!(
            state.cancel_quit(0),
            Err(AppLifecycleError::InvalidRequestId)
        );
        assert_eq!(
            state.cancel_quit(request.request_id + 1),
            Err(AppLifecycleError::StaleQuitRequest)
        );
        state
            .begin_confirm_quit(request.request_id)
            .expect("the first confirm should reserve shutdown");
        assert_eq!(
            state.begin_confirm_quit(request.request_id),
            Err(AppLifecycleError::QuitAlreadyInProgress)
        );
        assert_eq!(
            state.cancel_quit(request.request_id),
            Err(AppLifecycleError::QuitAlreadyInProgress)
        );
    }

    /// Verifies failed cleanup restores the same request for retry.
    #[test]
    fn failed_shutdown_restores_pending_request() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(1))));
        runtime.set_shutdown(Err(AppLifecycleError::RuntimeShutdownFailed));
        let state = AppLifecycleState::new(runtime.clone());
        let request = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the request should succeed"),
        );
        state
            .begin_confirm_quit(request.request_id)
            .expect("confirm should reserve shutdown");

        assert_eq!(
            tauri::async_runtime::block_on(state.finish_shutdown()),
            Err(AppLifecycleError::RuntimeShutdownFailed)
        );
        assert_eq!(
            state
                .pending_request_for_tests()
                .expect("the state lock should remain usable"),
            Some(request)
        );
        assert_eq!(runtime.shutdown_calls.load(Ordering::SeqCst), 1);
    }

    /// Verifies zero-session Quit reaches exit-ready without a pending dialog.
    #[test]
    fn zero_session_quit_completes_shutdown() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(0))));
        let state = AppLifecycleState::new(runtime);

        assert!(matches!(
            tauri::async_runtime::block_on(state.request_quit()),
            Ok(QuitFlow::ProceedShutdown)
        ));
        assert!(matches!(
            tauri::async_runtime::block_on(state.finish_shutdown()),
            Ok(ShutdownOutcome::ExitReady)
        ));
        assert_eq!(
            state
                .pending_request_for_tests()
                .expect("the state lock should remain usable"),
            None
        );
    }

    /// Verifies failed cleanup without a dialog restores Idle for a later retry.
    #[test]
    fn zero_session_shutdown_failure_restores_idle() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(0))));
        runtime.set_shutdown(Err(AppLifecycleError::RuntimeShutdownFailed));
        let state = AppLifecycleState::new(runtime.clone());

        assert!(matches!(
            tauri::async_runtime::block_on(state.request_quit()),
            Ok(QuitFlow::ProceedShutdown)
        ));
        assert_eq!(
            tauri::async_runtime::block_on(state.finish_shutdown()),
            Err(AppLifecycleError::RuntimeShutdownFailed)
        );
        assert!(
            !state
                .is_shutting_down()
                .expect("the restored Idle state should remain readable")
        );
        assert_eq!(runtime.shutdown_calls.load(Ordering::SeqCst), 1);
    }

    /// Verifies a failed snapshot leaves the state available for a retry.
    #[test]
    fn snapshot_failure_leaves_state_idle() {
        let runtime = Arc::new(FakeRuntime::new(Err(
            AppLifecycleError::RuntimeSnapshotFailed,
        )));
        let state = AppLifecycleState::new(runtime);

        assert!(matches!(
            tauri::async_runtime::block_on(state.request_quit()),
            Err(AppLifecycleError::RuntimeSnapshotFailed)
        ));
        assert!(
            !state
                .is_shutting_down()
                .expect("the state lock should remain usable")
        );
    }

    /// Verifies a poisoned lifecycle mutex maps to the stable public error.
    #[test]
    fn poisoned_state_lock_is_rejected() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(1))));
        let state = AppLifecycleState::new(runtime);
        let panic_result = catch_unwind(AssertUnwindSafe(
            // Poisons the lifecycle mutex so the next transition can classify it.
            || {
                let _guard = state
                    .inner
                    .lock()
                    .expect("the state lock should initially be available");
                panic!("poison the lifecycle state lock");
            },
        ));

        assert!(panic_result.is_err());
        assert_eq!(
            state.is_shutting_down(),
            Err(AppLifecycleError::StateLockPoisoned)
        );
    }

    /// Verifies the allocator wraps from the maximum identifier back to one.
    #[test]
    fn request_id_allocator_wraps_to_one() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(1))));
        let state = AppLifecycleState::new(runtime);
        state
            .inner
            .lock()
            .expect("the state lock should be available")
            .next_request_id = u32::MAX;

        let maximum = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the maximum request should be allocated"),
        );
        assert_eq!(maximum.request_id, u32::MAX);
        state
            .cancel_quit(maximum.request_id)
            .expect("the maximum request should cancel");
        let wrapped = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the wrapped request should be allocated"),
        );
        assert_eq!(wrapped.request_id, 1);
    }

    /// Verifies yielding snapshot and cleanup work execute outside the lifecycle lock.
    #[test]
    fn runtime_futures_are_awaited_without_the_state_lock() {
        let runtime = Arc::new(LockProbeRuntime {
            state: Mutex::new(None),
        });
        let state = Arc::new(AppLifecycleState::new(runtime.clone()));
        *runtime
            .state
            .lock()
            .expect("the probe state lock should be available") = Some(Arc::downgrade(&state));

        let request = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the yielding snapshot should succeed"),
        );

        assert_eq!(request.summary.session_count, 1);
        state
            .begin_confirm_quit(request.request_id)
            .expect("confirm should reserve shutdown");
        assert!(matches!(
            tauri::async_runtime::block_on(state.finish_shutdown()),
            Ok(ShutdownOutcome::ExitReady)
        ));
    }

    /// Verifies successful cleanup remains terminal and rejects repeated Quit entry points.
    #[test]
    fn successful_shutdown_stays_terminal_and_runs_cleanup_once() {
        let runtime = Arc::new(FakeRuntime::new(Ok(summary(1))));
        let state = AppLifecycleState::new(runtime.clone());
        let request = dialog_request(
            tauri::async_runtime::block_on(state.request_quit())
                .expect("the request should succeed"),
        );
        state
            .begin_confirm_quit(request.request_id)
            .expect("confirm should reserve shutdown");

        assert!(matches!(
            tauri::async_runtime::block_on(state.finish_shutdown()),
            Ok(ShutdownOutcome::ExitReady)
        ));
        assert!(
            state
                .is_shutting_down()
                .expect("shutdown state should remain readable")
        );
        assert_eq!(
            state
                .pending_request_for_tests()
                .expect("the state lock should remain usable"),
            None
        );
        assert!(matches!(
            tauri::async_runtime::block_on(state.request_quit()),
            Err(AppLifecycleError::QuitAlreadyInProgress)
        ));
        assert_eq!(
            state.begin_confirm_quit(request.request_id),
            Err(AppLifecycleError::QuitAlreadyInProgress)
        );
        assert_eq!(runtime.shutdown_calls.load(Ordering::SeqCst), 1);
    }
}
