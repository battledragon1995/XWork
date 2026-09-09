#![allow(dead_code)]
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::Manager;
use xwork_lib::{
    calendar::*,
    projects::*,
    shared::DataMaintenanceGate,
    storage::{Storage, StorageError},
};
struct Platform;
impl ProjectPlatform for Platform {
    /// Prevents all native folder picker access in isolated fixtures.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        Box::pin(async { Err(ProjectsError::FolderPickerFailed) })
    }
    /// Prevents all native folder opener access in isolated fixtures.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}
struct ProjectEvents;
impl ProjectEventSink for ProjectEvents {
    /// Discards unrelated project invalidations in this isolated fixture.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        Ok(())
    }
}
pub struct Clock {
    pub wall: AtomicI64,
    pub elapsed: AtomicU64,
}
impl CalendarClock for Clock {
    /// Reads controllable wall milliseconds.
    fn now_ms(&self) -> Result<i64, CalendarError> {
        Ok(self.wall.load(Ordering::SeqCst))
    }
    /// Reads controllable monotonic seconds without sleeping.
    fn elapsed(&self) -> Duration {
        Duration::from_secs(self.elapsed.load(Ordering::SeqCst))
    }
}
pub struct Events {
    pub values: Mutex<Vec<CalendarChangedEventDto>>,
    pub fail: AtomicBool,
    storage: Storage,
}
impl CalendarEventSink for Events {
    /// Proves sink calls can read committed state after Storage locks release.
    fn emit(&self, event: CalendarChangedEventDto) -> Result<(), CalendarError> {
        self.storage
            .with_connection(
                // A synchronous query here would deadlock if emission held the database lock.
                |db| {
                    Ok::<_, StorageError>(
                        db.query_row(
                            "SELECT COUNT(*) FROM calendar_events",
                            [],
                            // Reads the committed row count.
                            |row| row.get::<_, i64>(0),
                        )
                        .unwrap(),
                    )
                },
            )
            .unwrap();
        self.values.lock().unwrap().push(event);
        if self.fail.load(Ordering::SeqCst) {
            Err(CalendarError::StorageUnavailable)
        } else {
            Ok(())
        }
    }
}
pub struct Fixture {
    pub directory: tempfile::TempDir,
    pub app: tauri::App<tauri::test::MockRuntime>,
    pub storage: Storage,
    pub service: CalendarService,
    pub clock: Arc<Clock>,
    pub events: Arc<Events>,
}
impl Fixture {
    /// Builds real owners around temporary storage and mocked native collaborators.
    pub fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let mut app = xwork_lib::app::configure_with_projects_for_tests(
            tauri::test::mock_builder(),
            directory.path().join("data"),
            // Prevents fixture initialization from touching native project resources.
            |_| (Arc::new(Platform), Arc::new(ProjectEvents)),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
        #[allow(deprecated)]
        app.run_iteration(
            // Performs only the mock runtime setup iteration.
            |_, _| {},
        );
        let storage = app.state::<Storage>().inner().clone();
        let clock = Arc::new(Clock {
            wall: AtomicI64::new(100),
            elapsed: AtomicU64::new(0),
        });
        let events = Arc::new(Events {
            values: Mutex::new(Vec::new()),
            fail: AtomicBool::new(false),
            storage: storage.clone(),
        });
        let service = CalendarService::with_seams(
            storage.clone(),
            app.state::<ProjectService>().inner().clone(),
            clock.clone(),
            events.clone(),
            app.state::<DataMaintenanceGate>().inner().clone(),
        );
        Self {
            directory,
            app,
            storage,
            service,
            clock,
            events,
        }
    }
}
/// Returns a stable timed input that crosses no timezone transition.
pub fn input() -> EventInputDto {
    EventInputDto {
        title: "  Planning Ω  ".into(),
        description: "first\r\nsecond".into(),
        project_id: None,
        time: EventTimeInputDto::Timed {
            start_local: "2026-09-09T10:00".into(),
            end_local: "2026-09-09T11:00".into(),
            time_zone_id: "Asia/Bangkok".into(),
        },
        recurrence: EventRecurrenceDto::None,
        reminder_minutes_before: vec![60, 0],
    }
}
/// Builds an optimistic whole-series revision reference.
pub fn expected(event: &CalendarEventDto) -> EventRevisionInputDto {
    EventRevisionInputDto {
        event_id: event.id.clone(),
        expected_revision: event.revision.clone(),
    }
}
/// Builds the standard September viewer window.
pub fn range() -> CalendarRangeInputDto {
    CalendarRangeInputDto {
        start_date: "2026-09-01".into(),
        end_date_exclusive: "2026-10-01".into(),
        viewer_time_zone_id: "Asia/Bangkok".into(),
        project_id: None,
        only_with_reminders: false,
    }
}
