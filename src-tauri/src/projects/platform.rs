use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::error::ProjectsError;
use super::models::ProjectChangedEventDto;

/// Names the invalidation event published after a committed project mutation.
pub const PROJECTS_CHANGED_EVENT: &str = "projects://changed";

/// Boxes Projects futures while preserving borrowing and object safety.
#[doc(hidden)]
pub type ProjectFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Reports runtime work that removing one project would close.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProjectRuntimeImpact {
    pub session_count: u32,
    pub running_process_count: u32,
    pub unsaved_file_count: u32,
}

/// Selects and opens folders through native operating-system user interface.
///
/// The port exists so automated tests never open a real dialog or file manager.
#[doc(hidden)]
pub trait ProjectPlatform: Send + Sync {
    /// Opens a native single-directory picker.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>>;

    /// Opens a validated directory in the operating-system file manager.
    fn open_folder<'a>(&'a self, path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>>;
}

/// Closes and inspects the session runtime owned by one project.
pub trait ProjectRuntimeGuard: Send + Sync {
    /// Reports runtime work that a project removal would close.
    fn removal_impact<'a>(
        &'a self,
        project_id: &'a str,
    ) -> ProjectFuture<'a, Result<ProjectRuntimeImpact, ProjectsError>>;

    /// Closes every runtime session owned by a project.
    fn close_project<'a>(
        &'a self,
        project_id: &'a str,
    ) -> ProjectFuture<'a, Result<(), ProjectsError>>;
}

/// Implements the Stage 4 runtime guard before session runtime exists.
pub struct NoProjectRuntimeGuard;

impl ProjectRuntimeGuard for NoProjectRuntimeGuard {
    /// Reports zero impact because no session runtime is composed yet.
    fn removal_impact<'a>(
        &'a self,
        _project_id: &'a str,
    ) -> ProjectFuture<'a, Result<ProjectRuntimeImpact, ProjectsError>> {
        Box::pin(async { Ok(ProjectRuntimeImpact::default()) })
    }

    /// Completes cleanup because no session runtime can own a project yet.
    fn close_project<'a>(
        &'a self,
        _project_id: &'a str,
    ) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Supplies the millisecond wall clock used by project timestamps.
#[doc(hidden)]
pub trait ProjectClock: Send + Sync {
    /// Returns the current Unix epoch time in milliseconds.
    fn now_ms(&self) -> Result<i64, ProjectsError>;
}

/// Supplies durable project identifiers.
#[doc(hidden)]
pub trait ProjectIdFactory: Send + Sync {
    /// Returns a new lowercase hyphenated project identifier.
    fn new_project_id(&self) -> String;
}

/// Publishes the invalidation event emitted after a committed mutation.
#[doc(hidden)]
pub trait ProjectEventSink: Send + Sync {
    /// Delivers one already committed project change to interested webviews.
    fn publish(&self, event: ProjectChangedEventDto) -> Result<(), ProjectsError>;
}

/// Reads the operating-system wall clock for production timestamps.
pub(super) struct SystemProjectClock;

impl ProjectClock for SystemProjectClock {
    /// Converts the system clock into a non-negative millisecond timestamp.
    fn now_ms(&self) -> Result<i64, ProjectsError> {
        let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).map_err(
            // A clock before the Unix epoch cannot produce a valid persisted timestamp.
            |_| ProjectsError::ClockFailed,
        )?;
        i64::try_from(elapsed.as_millis()).map_err(
            // A timestamp beyond the signed range would break the persisted contract.
            |_| ProjectsError::ClockFailed,
        )
    }
}

/// Generates version 4 UUIDs for new projects.
pub(super) struct UuidProjectIdFactory;

impl ProjectIdFactory for UuidProjectIdFactory {
    /// Returns a random lowercase hyphenated version 4 UUID.
    fn new_project_id(&self) -> String {
        uuid::Uuid::new_v4().hyphenated().to_string()
    }
}

/// Adapts the official dialog and opener plugins to the Projects platform port.
pub struct TauriProjectPlatform<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriProjectPlatform<R> {
    /// Creates the native adapter from the composition root's application handle.
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> ProjectPlatform for TauriProjectPlatform<R> {
    /// Opens the native single-directory picker without blocking the async runtime.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        Box::pin(async move {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            self.app.dialog().file().pick_folder(
                // Forwards the single native selection back to the awaiting service call.
                move |selection| {
                    let _ = sender.send(selection);
                },
            );
            let selection = receiver.await.map_err(
                // A dropped callback means the dialog never produced a usable answer.
                |_| ProjectsError::FolderPickerFailed,
            )?;

            match selection {
                // Cancelling the picker is an ordinary outcome rather than a failure.
                None => Ok(None),
                Some(file_path) => file_path.into_path().map(Some).map_err(
                    // A selection that cannot become a filesystem path is a picker failure.
                    |_| ProjectsError::FolderPickerFailed,
                ),
            }
        })
    }

    /// Opens one already validated directory in the system file manager.
    fn open_folder<'a>(&'a self, path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async move {
            let Some(path) = path.to_str() else {
                // Only lossless UTF-8 roots are persisted, so this indicates corrupted metadata.
                return Err(ProjectsError::OpenFolderFailed);
            };
            self.app
                .opener()
                .open_path(path.to_owned(), None::<&str>)
                .map_err(
                    // Native opener details are never forwarded to the frontend.
                    |_| ProjectsError::OpenFolderFailed,
                )
        })
    }
}

/// Emits committed project changes to every listening webview.
pub struct TauriProjectEventSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriProjectEventSink<R> {
    /// Creates the native event sink from the composition root's application handle.
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> ProjectEventSink for TauriProjectEventSink<R> {
    /// Publishes one invalidation payload after the owning transaction committed.
    fn publish(&self, event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        self.app.emit(PROJECTS_CHANGED_EVENT, event).map_err(
            // Delivery failures are reported without exposing runtime details.
            |_| ProjectsError::PersistenceFailed,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::{Path, PathBuf},
        sync::Mutex,
    };

    use super::{
        NoProjectRuntimeGuard, PROJECTS_CHANGED_EVENT, ProjectClock, ProjectFuture,
        ProjectIdFactory, ProjectPlatform, ProjectRuntimeGuard, ProjectRuntimeImpact,
        SystemProjectClock, UuidProjectIdFactory,
    };
    use crate::projects::error::ProjectsError;
    use crate::projects::models::validate_project_id;

    /// Records platform calls and returns configured selections or failures.
    struct FakePlatform {
        selection: Mutex<Result<Option<PathBuf>, ProjectsError>>,
        open_result: Mutex<Result<(), ProjectsError>>,
        opened: Mutex<Vec<PathBuf>>,
        select_calls: Mutex<u32>,
    }

    impl FakePlatform {
        /// Creates a fake platform with the supplied picker outcome.
        fn new(selection: Result<Option<PathBuf>, ProjectsError>) -> Self {
            Self {
                selection: Mutex::new(selection),
                open_result: Mutex::new(Ok(())),
                opened: Mutex::new(Vec::new()),
                select_calls: Mutex::new(0),
            }
        }

        /// Replaces the opener outcome for failure-path assertions.
        fn set_open_result(&self, result: Result<(), ProjectsError>) {
            *self
                .open_result
                .lock()
                .expect("the fixture lock should be available") = result;
        }
    }

    impl ProjectPlatform for FakePlatform {
        /// Returns the configured picker outcome and records the request.
        fn select_folder<'a>(
            &'a self,
        ) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
            *self
                .select_calls
                .lock()
                .expect("the fixture lock should be available") += 1;
            let result = self
                .selection
                .lock()
                .expect("the fixture lock should be available")
                .clone();
            Box::pin(async move { result })
        }

        /// Records the opened directory and returns the configured outcome.
        fn open_folder<'a>(
            &'a self,
            path: &'a Path,
        ) -> ProjectFuture<'a, Result<(), ProjectsError>> {
            self.opened
                .lock()
                .expect("the fixture lock should be available")
                .push(path.to_path_buf());
            let result = self
                .open_result
                .lock()
                .expect("the fixture lock should be available")
                .clone();
            Box::pin(async move { result })
        }
    }

    /// Verifies that a cancelled picker is an ordinary outcome, not a failure.
    #[test]
    fn cancelled_picker_reports_no_selection() {
        let platform = FakePlatform::new(Ok(None));

        let selection = tauri::async_runtime::block_on(platform.select_folder())
            .expect("cancelling should not be an error");

        assert_eq!(selection, None);
        assert_eq!(
            *platform
                .select_calls
                .lock()
                .expect("the fixture lock should be available"),
            1
        );
    }

    /// Verifies that a native picker failure is reported through the typed error.
    #[test]
    fn failing_picker_reports_the_typed_error() {
        let platform = FakePlatform::new(Err(ProjectsError::FolderPickerFailed));

        let error = tauri::async_runtime::block_on(platform.select_folder())
            .expect_err("the picker failure should surface");

        assert_eq!(error, ProjectsError::FolderPickerFailed);
    }

    /// Verifies that the opener receives the exact requested directory.
    #[test]
    fn opener_receives_the_requested_directory() {
        let platform = FakePlatform::new(Ok(None));
        let requested = PathBuf::from("C:\\Work\\XWork");

        tauri::async_runtime::block_on(platform.open_folder(&requested))
            .expect("the fake opener should succeed");

        assert_eq!(
            *platform
                .opened
                .lock()
                .expect("the fixture lock should be available"),
            vec![requested]
        );
    }

    /// Verifies that opener failures never expose native details.
    #[test]
    fn failing_opener_reports_the_typed_error() {
        let platform = FakePlatform::new(Ok(None));
        platform.set_open_result(Err(ProjectsError::OpenFolderFailed));

        let error = tauri::async_runtime::block_on(platform.open_folder(Path::new("C:\\Work")))
            .expect_err("the opener failure should surface");

        assert_eq!(error, ProjectsError::OpenFolderFailed);
    }

    /// Verifies that the Stage 4 runtime guard reports nothing to close.
    #[test]
    fn empty_runtime_guard_reports_zero_impact() {
        let guard = NoProjectRuntimeGuard;
        let project_id = "11111111-1111-4111-8111-111111111111";

        assert_eq!(
            tauri::async_runtime::block_on(guard.removal_impact(project_id))
                .expect("the empty guard should succeed"),
            ProjectRuntimeImpact::default()
        );
        // Repeating cleanup must stay successful because the guard is idempotent.
        for _ in 0..2 {
            tauri::async_runtime::block_on(guard.close_project(project_id))
                .expect("the empty guard should close nothing");
        }
    }

    /// Verifies that generated identifiers satisfy the persisted identity rule.
    #[test]
    fn generated_identifiers_are_canonical_uuids() {
        let factory = UuidProjectIdFactory;

        let first = factory.new_project_id();
        let second = factory.new_project_id();

        assert_eq!(validate_project_id(&first), Ok(()));
        assert_eq!(validate_project_id(&second), Ok(()));
        assert_ne!(first, second);
    }

    /// Verifies that the production clock produces a plausible epoch timestamp.
    #[test]
    fn system_clock_returns_a_non_negative_timestamp() {
        let clock = SystemProjectClock;

        let now = clock.now_ms().expect("the system clock should be readable");

        // The lower bound is 2020-01-01 so a clearly wrong clock fails loudly.
        assert!(now > 1_577_836_800_000);
    }

    /// Verifies that the published event name is a stable public contract.
    #[test]
    fn change_event_name_is_fixed() {
        assert_eq!(PROJECTS_CHANGED_EVENT, "projects://changed");
    }
}
