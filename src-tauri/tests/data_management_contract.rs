use std::{
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex, mpsc},
    task::{Context, Poll, Waker},
    time::Duration,
};

use tempfile::TempDir;
use tokio::sync::Barrier;
use xwork_lib::app::data_participants::{
    CliProfilesDataParticipant, ProjectsDataParticipant, SettingsDataParticipant,
};
use xwork_lib::platform::command::StubCommandResolver;
use xwork_lib::platform::credential::InMemoryCredentialStore;
use xwork_lib::platform::shell::{ShellMode, StubShellResolver};
use xwork_lib::projects::{
    CURRENT_PATH_IDENTITY, NoProjectRuntimeGuard, ProjectBackupRecordV1, ProjectChangedEventDto,
    ProjectClock, ProjectCommittedProjection, ProjectDto, ProjectEventSink,
    ProjectFolderSelectionDto, ProjectFuture, ProjectIdFactory, ProjectImportPlan, ProjectPlatform,
    ProjectService, ProjectsError,
};
use xwork_lib::sessions::{
    CliProfileLookup, CloseRetention, LaunchableProfile, PaneCloseImpact, PaneContentRef,
    PaneContentRuntime, PaneRuntimeFuture, ProjectSessionAccess, ProjectSessionAvailability,
    ReopenHandle, SessionEventSink, SessionManager, SessionRuntimeEventDto, SessionsError,
};
use xwork_lib::settings::{
    AppearanceSettingsPatchDto, SettingsBackupSection, SettingsError, SettingsService,
    SettingsSnapshot, SidebarSettingsPatchDto, ThemePresetDto, UpdateSettingsDto,
};
use xwork_lib::shared::DataMaintenanceGate;
use xwork_lib::storage::Storage;
use xwork_lib::terminal::{
    CliEnvironmentBackupRecordV1, CliProfileBackupRecordV1, CliProfileEnvironmentInputDto,
    CliProfileIdFactory, CliProfileInputDto, CliProfilesBackupV1, CliProfilesChangedDto,
    CliProfilesClock, CliProfilesCommittedProjection, CliProfilesError, CliProfilesEventSink,
    CliProfilesImportPlan, CliProfilesService,
};

/// Supplies one available project to the Sessions maintenance-gate test.
struct GateSessionProjects;

impl ProjectSessionAccess for GateSessionProjects {
    /// Accepts the isolated project without reading persistent state.
    fn session_availability<'a>(
        &'a self,
        _project_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<ProjectSessionAvailability, SessionsError>> {
        Box::pin(async { Ok(ProjectSessionAvailability::Available) })
    }

    /// Returns the isolated project's display order.
    fn ordered_project_ids<'a>(
        &'a self,
    ) -> PaneRuntimeFuture<'a, Result<Vec<String>, SessionsError>> {
        Box::pin(async { Ok(vec!["project".to_owned()]) })
    }
}

/// Rejects profile lookup because the gate test never selects a tool.
struct GateSessionProfiles;

impl CliProfileLookup for GateSessionProfiles {
    /// Fails closed if an unrelated profile lookup reaches this fixture.
    fn launchable_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<LaunchableProfile, SessionsError>> {
        Box::pin(async move {
            Err(SessionsError::ProfileNotFound {
                profile_id: profile_id.to_owned(),
            })
        })
    }
}

/// Supplies no live pane content for the Sessions maintenance-gate test.
struct GateSessionContent;

impl PaneContentRuntime for GateSessionContent {
    /// Reports no blockers for an unreachable content value.
    fn close_impact<'a>(
        &'a self,
        _content: &'a PaneContentRef,
    ) -> PaneRuntimeFuture<'a, Result<PaneCloseImpact, SessionsError>> {
        Box::pin(async { Ok(PaneCloseImpact::default()) })
    }

    /// Closes an unreachable content value without retention.
    fn close<'a>(
        &'a self,
        _content: &'a PaneContentRef,
        _retention: CloseRetention,
    ) -> PaneRuntimeFuture<'a, Result<Option<ReopenHandle>, SessionsError>> {
        Box::pin(async { Ok(None) })
    }

    /// Rejects an unreachable reopen request.
    fn reopen<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<PaneContentRef, SessionsError>> {
        Box::pin(async move {
            Err(SessionsError::ContentLifecycleFailed {
                operation: "reopen".to_owned(),
                target_id: handle.token,
            })
        })
    }

    /// Accepts idempotent release of an unreachable handle.
    fn discard<'a>(
        &'a self,
        _handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<(), SessionsError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Discards Sessions events while preserving the publication boundary.
struct GateSessionEvents;

impl SessionEventSink for GateSessionEvents {
    /// Accepts one committed event without external effects.
    fn publish(&self, _event: SessionRuntimeEventDto) -> Result<(), SessionsError> {
        Ok(())
    }
}

/// Returns one queued folder selection without opening a native dialog.
struct QueuedPlatform {
    selections: Mutex<Vec<PathBuf>>,
}

impl QueuedPlatform {
    /// Creates a platform whose picker returns queued fixture folders.
    fn new() -> Self {
        Self {
            selections: Mutex::new(Vec::new()),
        }
    }

    /// Queues one folder the next picker call will return.
    fn queue(&self, path: PathBuf) {
        self.selections
            .lock()
            .expect("the fixture lock should be available")
            .push(path);
    }
}

impl ProjectPlatform for QueuedPlatform {
    /// Returns the next queued folder or reports a cancellation.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        let selection = {
            let mut queue = self
                .selections
                .lock()
                .expect("the fixture lock should be available");
            if queue.is_empty() {
                None
            } else {
                Some(queue.remove(0))
            }
        };
        Box::pin(async move { Ok(selection) })
    }

    /// Fails because contract tests never open a native file manager.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Returns one fixed timestamp so exports stay byte-for-byte comparable.
struct FixedClock;

impl ProjectClock for FixedClock {
    /// Returns the pinned fixture timestamp.
    fn now_ms(&self) -> Result<i64, ProjectsError> {
        Ok(1_700_000_000_000)
    }
}

/// Returns deterministic canonical identifiers for fixture projects.
struct SequentialIds {
    next: Mutex<u32>,
}

impl ProjectIdFactory for SequentialIds {
    /// Returns the next canonical hyphenated fixture identifier.
    fn new_project_id(&self) -> String {
        let mut next = self
            .next
            .lock()
            .expect("the fixture lock should be available");
        let value = *next;
        *next += 1;
        format!("{value:08x}-0000-4000-8000-{value:012x}")
    }
}

/// Records every published project change for publication assertions.
struct RecordingSink {
    published: Mutex<Vec<ProjectChangedEventDto>>,
}

impl RecordingSink {
    /// Returns every recorded change as a debug-kind and project-id pair.
    fn recorded(&self) -> Vec<(String, String)> {
        self.published
            .lock()
            .expect("the fixture lock should be available")
            .iter()
            .map(
                // Reduces each payload to the two fields the assertions check.
                |event| (format!("{:?}", event.change), event.project_id.clone()),
            )
            .collect()
    }
}

impl ProjectEventSink for RecordingSink {
    /// Records one publication attempt and always succeeds.
    fn publish(&self, event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        self.published
            .lock()
            .expect("the fixture lock should be available")
            .push(event);
        Ok(())
    }
}

/// Owns one isolated service, its storage handle, and its injected fakes.
struct Harness {
    service: ProjectService,
    participant: ProjectsDataParticipant,
    storage: Storage,
    platform: Arc<QueuedPlatform>,
    events: Arc<RecordingSink>,
    gate: DataMaintenanceGate,
    workspace: TempDir,
    _app_data: TempDir,
}

/// Owns an isolated Settings participant and its coordinator seams.
struct SettingsHarness {
    service: SettingsService,
    participant: SettingsDataParticipant,
    storage: Storage,
    gate: DataMaintenanceGate,
    _app_data: TempDir,
}

impl SettingsHarness {
    /// Builds Settings against an isolated migrated database.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let storage = Storage::open(app_data.path()).expect("isolated storage should open");
        let gate = DataMaintenanceGate::new();
        let service = SettingsService::new(storage.clone(), gate.clone())
            .expect("default settings should hydrate");
        Self {
            participant: SettingsDataParticipant::new(service.clone()),
            service,
            storage,
            gate,
            _app_data: app_data,
        }
    }

    /// Returns one valid non-default backup section for restore tests.
    fn incoming(&self) -> SettingsBackupSection {
        let paper = self
            .service
            .update(&UpdateSettingsDto {
                appearance: Some(AppearanceSettingsPatchDto {
                    theme_preset: Some(ThemePresetDto::Paper),
                    ..Default::default()
                }),
                sidebar: None,
            })
            .expect("the paper fixture should be valid")
            .appearance;
        SettingsBackupSection {
            appearance: paper,
            sidebar: xwork_lib::settings::SidebarSettingsDto {
                width_px: 350,
                collapsed: true,
            },
            notification_settings: None,
        }
    }
}

impl Harness {
    /// Builds an isolated Projects service backed by a temporary database.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let workspace = TempDir::new().expect("the temporary workspace should be created");
        let storage = Storage::open(app_data.path()).expect("isolated storage should open");
        let platform = Arc::new(QueuedPlatform::new());
        let events = Arc::new(RecordingSink {
            published: Mutex::new(Vec::new()),
        });
        let gate = DataMaintenanceGate::new();
        let service = ProjectService::with_seams(
            storage.clone(),
            gate.clone(),
            platform.clone(),
            Arc::new(NoProjectRuntimeGuard),
            events.clone(),
            Arc::new(FixedClock),
            Arc::new(SequentialIds {
                next: Mutex::new(1),
            }),
            CURRENT_PATH_IDENTITY,
        );

        Self {
            participant: ProjectsDataParticipant::new(service.clone()),
            service,
            storage,
            platform,
            events,
            gate,
            workspace,
            _app_data: app_data,
        }
    }

    /// Registers one temporary folder as a project and returns its snapshot.
    fn add_project(&self, name: &str) -> ProjectDto {
        let path = self.workspace.path().join(name);
        std::fs::create_dir_all(&path).expect("the fixture folder should be created");
        self.platform.queue(path);
        match tauri::async_runtime::block_on(self.service.add_project())
            .expect("the fixture project should be added")
        {
            ProjectFolderSelectionDto::Selected { project } => project,
            ProjectFolderSelectionDto::Cancelled => panic!("the fixture should not cancel"),
        }
    }

    /// Reads the persisted project identifiers in stable display order.
    fn persisted_ids(&self) -> Vec<String> {
        tauri::async_runtime::block_on(self.service.ordered_project_ids())
            .expect("the identifiers should be readable")
    }
}

/// Polls one pinned future exactly once with a no-op waker.
fn poll_once<T>(future: &mut Pin<Box<dyn Future<Output = T> + Send + '_>>) -> Poll<T> {
    let waker = Waker::noop();
    let mut context = Context::from_waker(waker);
    future.as_mut().poll(&mut context)
}

/// Fails to compile unless the supplied type is an owned, sendable value.
fn assert_owned_and_sendable<T: Send + 'static>() {}

/// Verifies that two ordinary mutations really hold shared admission together.
#[test]
fn gate_admits_concurrent_ordinary_mutations() {
    let gate = DataMaintenanceGate::new();
    // The barrier can only clear when both permits are held at the same moment.
    let barrier = Arc::new(Barrier::new(2));

    tauri::async_runtime::block_on(async {
        let mut tasks = Vec::new();
        for _ in 0..2 {
            let gate = gate.clone();
            let barrier = barrier.clone();
            tasks.push(tauri::async_runtime::spawn(
                // Holds one read permit until its sibling permit has also been admitted.
                async move {
                    let permit = gate.read_permit().await;
                    barrier.wait().await;
                    drop(permit);
                },
            ));
        }

        for task in tasks {
            task.await
                .expect("each admitted mutation task should finish");
        }
    });
}

/// Verifies that the exclusive maintenance permit is reachable after readers exit.
#[test]
fn gate_grants_exclusive_maintenance_after_readers_exit() {
    let gate = DataMaintenanceGate::new();

    tauri::async_runtime::block_on(async {
        let permit = gate.read_permit().await;
        drop(permit);
        let write_permit = gate.write_permit().await;
        drop(write_permit);
    });
}

/// Verifies that the maintenance plan and projection are owned sendable values.
#[test]
fn projects_plan_and_projection_are_owned_values() {
    assert_owned_and_sendable::<ProjectImportPlan>();
    assert_owned_and_sendable::<ProjectCommittedProjection>();
    assert_owned_and_sendable::<Vec<ProjectBackupRecordV1>>();
}

/// Verifies that the export is deterministic and uses the display order.
#[test]
fn projects_export_is_deterministic() {
    let harness = Harness::new();
    let first = harness.add_project("alpha");
    let second = harness.add_project("beta");
    tauri::async_runtime::block_on(harness.service.set_project_pinned(&second.id, true))
        .expect("the pin should succeed");

    let export_one = harness
        .storage
        .with_transaction(
            // Exports the Projects section from one consistent snapshot.
            |transaction| harness.participant.export(transaction),
        )
        .expect("the export should succeed");
    let export_two = harness
        .storage
        .with_transaction(
            // Repeating the export must produce byte-for-byte identical records.
            |transaction| harness.participant.export(transaction),
        )
        .expect("the export should succeed");

    assert_eq!(export_one, export_two);
    assert_eq!(
        export_one
            .iter()
            .map(
                // Reduces the export to identifiers for the order assertion.
                |record| record.id.clone()
            )
            .collect::<Vec<_>>(),
        vec![second.id, first.id]
    );
    assert!(harness.events.recorded().iter().all(
        // Exporting must never publish an invalidation of its own.
        |(kind, _)| kind != "Removed"
    ));
}

/// Verifies that malformed incoming records are rejected before any write.
#[test]
fn projects_import_records_are_strictly_validated() {
    let harness = Harness::new();
    let valid = ProjectBackupRecordV1 {
        id: "00000009-0000-4000-8000-000000000009".to_owned(),
        display_name: "Imported".to_owned(),
        root_path: if cfg!(windows) {
            r"C:\Imported\Work".to_owned()
        } else {
            "/imported/work".to_owned()
        },
        is_pinned: false,
        added_at_ms: 10,
        last_opened_at_ms: 20,
    };

    let rejected: Vec<(ProjectBackupRecordV1, ProjectsError)> = vec![
        (
            ProjectBackupRecordV1 {
                id: "not-a-uuid".to_owned(),
                ..valid.clone()
            },
            ProjectsError::InvalidProjectId,
        ),
        (
            ProjectBackupRecordV1 {
                display_name: "   ".to_owned(),
                ..valid.clone()
            },
            ProjectsError::InvalidDisplayName,
        ),
        (
            ProjectBackupRecordV1 {
                root_path: "relative/path".to_owned(),
                ..valid.clone()
            },
            ProjectsError::InvalidProjectFolder {
                reason: xwork_lib::projects::InvalidProjectFolderReasonDto::NotAbsolute,
            },
        ),
        (
            ProjectBackupRecordV1 {
                last_opened_at_ms: 5,
                ..valid.clone()
            },
            ProjectsError::ClockFailed,
        ),
    ];

    for (record, expected) in rejected {
        let error = harness
            .storage
            .with_transaction(
                // Preparation must fail before it can build any owned operation.
                |transaction| {
                    harness
                        .participant
                        .prepare_import(transaction, std::slice::from_ref(&record))
                },
            )
            .expect_err("the malformed record should be rejected");
        assert_eq!(error, expected);
    }

    assert!(harness.persisted_ids().is_empty());
    assert!(harness.events.recorded().is_empty());
}

/// Verifies insert, update, unchanged, and path-match merge decisions.
#[test]
fn projects_merge_plan_counts_every_decision() {
    let harness = Harness::new();
    let existing = harness.add_project("existing");
    let untouched = harness.add_project("untouched");

    let unchanged_record = ProjectBackupRecordV1 {
        id: untouched.id.clone(),
        display_name: untouched.display_name.clone(),
        root_path: untouched.root_path.clone(),
        is_pinned: untouched.is_pinned,
        added_at_ms: untouched.added_at_ms,
        last_opened_at_ms: untouched.last_opened_at_ms,
    };
    // The same folder arriving under a foreign identifier must remap onto the local row.
    let path_match_record = ProjectBackupRecordV1 {
        id: "000000aa-0000-4000-8000-0000000000aa".to_owned(),
        display_name: "Renamed Elsewhere".to_owned(),
        root_path: existing.root_path.clone(),
        is_pinned: true,
        added_at_ms: existing.added_at_ms,
        last_opened_at_ms: existing.last_opened_at_ms,
    };
    let inserted_record = ProjectBackupRecordV1 {
        id: "000000bb-0000-4000-8000-0000000000bb".to_owned(),
        display_name: "Brand New".to_owned(),
        root_path: if cfg!(windows) {
            r"C:\Imported\Fresh".to_owned()
        } else {
            "/imported/fresh".to_owned()
        },
        is_pinned: false,
        added_at_ms: 1,
        last_opened_at_ms: 2,
    };

    let plan = harness
        .storage
        .with_transaction(
            // Planning inspects the local snapshot without changing it.
            |transaction| {
                harness.participant.prepare_import(
                    transaction,
                    &[
                        unchanged_record.clone(),
                        path_match_record.clone(),
                        inserted_record.clone(),
                    ],
                )
            },
        )
        .expect("the merge plan should be built");

    assert_eq!(plan.counts.inserts, 1);
    assert_eq!(plan.counts.updates, 1);
    assert_eq!(plan.counts.unchanged, 1);
    assert_eq!(plan.counts.path_matches, 2);
    // The foreign identifier must resolve onto the local project owning that folder.
    assert_eq!(
        ProjectsDataParticipant::resolve_project_link(&plan.import_map, &path_match_record.id),
        Some(existing.id.as_str())
    );
    assert_eq!(
        ProjectsDataParticipant::resolve_project_link(&plan.import_map, &inserted_record.id),
        Some(inserted_record.id.as_str())
    );
    assert_eq!(
        ProjectsDataParticipant::resolve_project_link(&plan.import_map, &untouched.id),
        Some(untouched.id.as_str())
    );
    // A source identifier outside the snapshot stays dangling for nullable unlink.
    assert_eq!(
        ProjectsDataParticipant::resolve_project_link(
            &plan.import_map,
            "ffffffff-ffff-4fff-8fff-ffffffffffff"
        ),
        None
    );
}

/// Verifies that a rolled-back merge changes nothing and publishes nothing.
#[test]
fn projects_rolled_back_merge_publishes_nothing() {
    let harness = Harness::new();
    let existing = harness.add_project("existing");
    let before = harness.events.recorded().len();
    let record = ProjectBackupRecordV1 {
        id: "000000cc-0000-4000-8000-0000000000cc".to_owned(),
        display_name: "Brand New".to_owned(),
        root_path: if cfg!(windows) {
            r"C:\Imported\Rolled".to_owned()
        } else {
            "/imported/rolled".to_owned()
        },
        is_pinned: false,
        added_at_ms: 1,
        last_opened_at_ms: 2,
    };

    let outcome: Result<(), ProjectsError> = harness.storage.with_transaction(
        // Applies the merge and then aborts with a coordinator-owned failure.
        |transaction| {
            let plan = harness
                .participant
                .prepare_import(transaction, std::slice::from_ref(&record))?;
            let projection = harness.participant.apply_import(transaction, &plan)?;
            // Dropping the projection without publishing models a coordinator rollback.
            drop(projection);
            Err(ProjectsError::PersistenceFailed)
        },
    );

    assert_eq!(outcome, Err(ProjectsError::PersistenceFailed));
    assert_eq!(harness.persisted_ids(), vec![existing.id]);
    assert_eq!(harness.events.recorded().len(), before);
}

/// Verifies that a committed merge publishes exactly one prepared projection.
#[test]
fn projects_committed_merge_publishes_one_projection() {
    let harness = Harness::new();
    let existing = harness.add_project("existing");
    let baseline = harness.events.recorded().len();
    let updated_record = ProjectBackupRecordV1 {
        id: existing.id.clone(),
        display_name: "Renamed By Import".to_owned(),
        root_path: existing.root_path.clone(),
        is_pinned: true,
        added_at_ms: existing.added_at_ms,
        last_opened_at_ms: existing.last_opened_at_ms,
    };
    let inserted_record = ProjectBackupRecordV1 {
        id: "000000dd-0000-4000-8000-0000000000dd".to_owned(),
        display_name: "Brand New".to_owned(),
        root_path: if cfg!(windows) {
            r"C:\Imported\Committed".to_owned()
        } else {
            "/imported/committed".to_owned()
        },
        is_pinned: false,
        added_at_ms: 1,
        last_opened_at_ms: 2,
    };

    let projection = harness
        .storage
        .with_transaction(
            // Applies both operations of the plan in the coordinator transaction.
            |transaction| {
                let plan = harness.participant.prepare_import(
                    transaction,
                    &[updated_record.clone(), inserted_record.clone()],
                )?;
                harness.participant.apply_import(transaction, &plan)
            },
        )
        .expect("the merge should commit");

    assert_eq!(projection.change_count(), 2);
    assert_eq!(harness.events.recorded().len(), baseline);
    harness.participant.publish_after_commit(projection);
    assert_eq!(
        harness.events.recorded()[baseline..],
        [
            ("Updated".to_owned(), existing.id.clone()),
            ("Added".to_owned(), inserted_record.id.clone()),
        ]
    );
    let renamed = tauri::async_runtime::block_on(harness.service.get_project(&existing.id))
        .expect("the merged project should be readable");
    assert_eq!(renamed.display_name, "Renamed By Import");
    assert!(renamed.is_pinned);
    assert!(harness.persisted_ids().contains(&inserted_record.id));
}

/// Verifies that a reset clears metadata and publishes one removal per project.
#[test]
fn projects_reset_clears_metadata_inside_the_shared_transaction() {
    let harness = Harness::new();
    let first = harness.add_project("first");
    let second = harness.add_project("second");
    let baseline = harness.events.recorded().len();

    let projection = harness
        .storage
        .with_transaction(
            // Clears Projects without opening a nested transaction of its own.
            |transaction| harness.participant.apply_reset(transaction),
        )
        .expect("the reset should commit");

    assert_eq!(projection.change_count(), 2);
    assert!(harness.persisted_ids().is_empty());
    assert_eq!(harness.events.recorded().len(), baseline);
    harness.participant.publish_after_commit(projection);
    assert_eq!(
        harness.events.recorded()[baseline..],
        [
            ("Removed".to_owned(), first.id),
            ("Removed".to_owned(), second.id),
        ]
    );
    // The folders behind the cleared projects must still exist untouched.
    assert!(harness.workspace.path().join("first").is_dir());
    assert!(harness.workspace.path().join("second").is_dir());
}

/// Verifies that a held maintenance write permit blocks ordinary mutations.
#[test]
fn projects_write_permit_blocks_ordinary_mutation() {
    let harness = Harness::new();
    let project = harness.add_project("blocked");

    let mut writer: Pin<Box<dyn Future<Output = _> + Send + '_>> =
        Box::pin(harness.gate.write_permit());
    let write_permit = match poll_once(&mut writer) {
        Poll::Ready(permit) => permit,
        Poll::Pending => panic!("an idle gate should admit the write permit"),
    };

    let mut rename: Pin<Box<dyn Future<Output = _> + Send + '_>> =
        Box::pin(harness.service.rename_project(&project.id, "Blocked"));
    assert!(poll_once(&mut rename).is_pending());
    assert_eq!(
        tauri::async_runtime::block_on(harness.service.get_project(&project.id))
            .expect("the project should be readable")
            .display_name,
        "blocked"
    );

    drop(write_permit);
    drop(rename);
    let renamed =
        tauri::async_runtime::block_on(harness.service.rename_project(&project.id, "Blocked"))
            .expect("the mutation should proceed after maintenance finishes");
    assert_eq!(renamed.display_name, "Blocked");
}

/// Verifies settings export reads the persisted Phase 1 section in one transaction.
#[test]
fn settings_export_reads_persisted_section_under_shared_transaction() {
    let harness = SettingsHarness::new();
    let incoming = harness.incoming();
    harness
        .service
        .update(&UpdateSettingsDto {
            appearance: None,
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: Some(incoming.sidebar.width_px),
                collapsed: Some(incoming.sidebar.collapsed),
            }),
        })
        .expect("the sidebar fixture should commit");

    let exported = harness
        .storage
        .with_transaction(
            // Exports through the participant without opening nested storage.
            |transaction| harness.participant.export(transaction),
        )
        .expect("settings export should commit its read transaction");
    assert_eq!(exported.appearance, incoming.appearance);
    assert_eq!(exported.sidebar, incoming.sidebar);
    assert_eq!(exported.notification_settings, None);
}

/// Verifies owner APIs do not re-enter the maintenance gate while write admission is held.
#[test]
fn settings_owner_apis_work_while_write_permit_is_held() {
    let harness = SettingsHarness::new();
    let incoming = harness.incoming();
    let write_permit = tauri::async_runtime::block_on(harness.gate.write_permit());
    let projection = harness
        .storage
        .with_transaction(
            // Runs the complete owner sequence inside the coordinator transaction.
            |transaction| {
                let _exported = harness.participant.export(transaction)?;
                let plan = harness
                    .participant
                    .prepare_restore(transaction, &incoming)?;
                harness.participant.apply_restore(transaction, &plan)
            },
        )
        .expect("owner APIs should not wait on the already-held gate");
    harness.participant.publish_after_commit(projection);
    drop(write_permit);
    assert_eq!(
        harness
            .service
            .snapshot()
            .expect("the projection should publish")
            .sidebar,
        incoming.sidebar
    );
}

/// Verifies invalid restore input is rejected before any row is written.
#[test]
fn settings_restore_prepare_rejects_invalid_section_without_writes() {
    let harness = SettingsHarness::new();
    let mut incoming = harness.incoming();
    let before = harness
        .service
        .snapshot()
        .expect("the cache should be readable");
    incoming.appearance.interface_font_size_px = 11;

    let error = harness
        .storage
        .with_transaction(
            // Calls prepare only so invalid input cannot reach an apply operation.
            |transaction| harness.participant.prepare_restore(transaction, &incoming),
        )
        .expect_err("the invalid restore section should be rejected");
    assert!(matches!(error, SettingsError::ValueOutOfRange { .. }));
    let persisted = harness
        .storage
        .with_transaction(
            // Re-exports after rejection to prove the row stayed at the fixture baseline.
            |transaction| harness.participant.export(transaction),
        )
        .expect("the unchanged row should remain readable");
    assert_eq!(persisted.appearance, before.appearance);
    assert_eq!(harness.service.snapshot(), Ok(before));
}

/// Verifies a coordinator rollback does not publish or persist its prepared projection.
#[test]
fn settings_coordinator_rollback_publishes_nothing() {
    let harness = SettingsHarness::new();
    let incoming = harness.incoming();
    let before = harness
        .service
        .snapshot()
        .expect("the cache should be readable");
    let error = harness
        .storage
        .with_transaction(
            // Applies inside the transaction and then injects a coordinator failure.
            |transaction| {
                let plan = harness
                    .participant
                    .prepare_restore(transaction, &incoming)?;
                let _projection = harness.participant.apply_restore(transaction, &plan)?;
                Err::<(), SettingsError>(SettingsError::PersistenceFailed)
            },
        )
        .expect_err("the injected coordinator error should roll back");
    assert_eq!(error, SettingsError::PersistenceFailed);
    assert_eq!(harness.service.snapshot(), Ok(before.clone()));
    let exported = harness
        .storage
        .with_transaction(
            // Reads the row after rollback through the same owner contract.
            |transaction| harness.participant.export(transaction),
        )
        .expect("the rolled-back row should remain readable");
    assert_eq!(exported.appearance, before.appearance);
    assert_eq!(exported.sidebar, before.sidebar);
}

/// Verifies commit publication replaces the cache only after the transaction succeeds.
#[test]
fn settings_commit_publishes_prepared_projection() {
    let harness = SettingsHarness::new();
    let incoming = harness.incoming();
    let before = harness
        .service
        .snapshot()
        .expect("the cache should be readable");
    let projection = harness
        .storage
        .with_transaction(
            // Prepares and applies one restore under the coordinator transaction.
            |transaction| {
                let plan = harness
                    .participant
                    .prepare_restore(transaction, &incoming)?;
                harness.participant.apply_restore(transaction, &plan)
            },
        )
        .expect("the restore transaction should commit");
    assert_eq!(harness.service.snapshot(), Ok(before));
    harness.participant.publish_after_commit(projection);
    let published = harness
        .service
        .snapshot()
        .expect("the cache should be replaced");
    assert_eq!(published.appearance, incoming.appearance);
    assert_eq!(published.sidebar, incoming.sidebar);
}

/// Verifies coordinator reset writes and publishes the exact first-run row.
#[test]
fn settings_reset_writes_default_row() {
    let harness = SettingsHarness::new();
    let _incoming = harness.incoming();
    let projection = harness
        .storage
        .with_transaction(
            // Resets the singleton without entering Storage again.
            |transaction| harness.participant.apply_reset(transaction),
        )
        .expect("the settings reset should commit");
    harness.participant.publish_after_commit(projection);
    assert_eq!(harness.service.snapshot(), Ok(SettingsSnapshot::defaults()));
    let exported = harness
        .storage
        .with_transaction(
            // Exports the committed reset row for a persistence assertion.
            |transaction| harness.participant.export(transaction),
        )
        .expect("the reset row should be readable");
    assert_eq!(exported.appearance, SettingsSnapshot::defaults().appearance);
    assert_eq!(exported.sidebar, SettingsSnapshot::defaults().sidebar);
}

/// Verifies a held maintenance write permit blocks an ordinary settings mutation.
#[test]
fn settings_mutation_is_blocked_by_write_permit() {
    let harness = SettingsHarness::new();
    let write_permit = tauri::async_runtime::block_on(harness.gate.write_permit());
    let service = harness.service.clone();
    let (sender, receiver) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = service.update(&UpdateSettingsDto {
            appearance: None,
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: Some(310),
                collapsed: None,
            }),
        });
        sender
            .send(result)
            .expect("the result receiver should remain open");
    });

    assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
    assert_eq!(
        harness
            .service
            .snapshot()
            .expect("reads should remain available")
            .sidebar
            .width_px,
        280
    );
    drop(write_permit);
    let updated = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("the mutation should finish after maintenance")
        .expect("the admitted mutation should commit");
    worker.join().expect("the mutation thread should join");
    assert_eq!(updated.sidebar.width_px, 310);
}

/// Returns one pinned fixture timestamp for CLI profile mutations.
struct FixedCliClock;

impl CliProfilesClock for FixedCliClock {
    /// Returns the pinned fixture timestamp.
    fn now_ms(&self) -> Result<i64, CliProfilesError> {
        Ok(1_700_000_000_000)
    }
}

/// Returns deterministic CLI profile identifiers and credential accounts.
#[derive(Default)]
struct SequentialCliIds {
    next: Mutex<u32>,
}

impl SequentialCliIds {
    /// Returns the next fixture counter value.
    fn next(&self) -> u32 {
        let mut next = self
            .next
            .lock()
            .expect("the fixture lock should be available");
        *next += 1;
        *next
    }
}

impl CliProfileIdFactory for SequentialCliIds {
    /// Returns the next canonical fixture profile identifier.
    fn new_profile_id(&self) -> String {
        format!("profile-{:08x}-0000-4000-8000-000000000000", self.next())
    }

    /// Returns the next opaque fixture credential account.
    fn new_credential_account(&self) -> String {
        format!("{:08x}-0000-4000-8000-aaaaaaaaaaaa", self.next())
    }
}

/// Records every published CLI profile invalidation for publication assertions.
#[derive(Default)]
struct RecordingCliSink {
    published: Mutex<Vec<CliProfilesChangedDto>>,
}

impl RecordingCliSink {
    /// Returns every recorded change as a revision, kind, and profile triple.
    fn recorded(&self) -> Vec<(String, String, Option<String>)> {
        self.published
            .lock()
            .expect("the fixture lock should be available")
            .iter()
            .map(
                // Reduces each payload to the three fields assertions inspect.
                |event| {
                    (
                        event.revision.clone(),
                        format!("{:?}", event.kind),
                        event.profile_id.clone(),
                    )
                },
            )
            .collect()
    }
}

impl CliProfilesEventSink for RecordingCliSink {
    /// Records one publication attempt and always succeeds.
    fn publish(&self, event: CliProfilesChangedDto) -> Result<(), CliProfilesError> {
        self.published
            .lock()
            .expect("the fixture lock should be available")
            .push(event);
        Ok(())
    }
}

/// Owns one isolated CLI profiles service and its maintenance collaborators.
struct CliProfilesHarness {
    service: CliProfilesService,
    participant: CliProfilesDataParticipant,
    storage: Storage,
    gate: DataMaintenanceGate,
    commands: Arc<StubCommandResolver>,
    credentials: Arc<InMemoryCredentialStore>,
    events: Arc<RecordingCliSink>,
    _app_data: TempDir,
}

impl CliProfilesHarness {
    /// Builds one hydrated service over a fresh migrated database.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let storage = Storage::open(app_data.path()).expect("isolated storage should open");
        let shells = Arc::new(StubShellResolver::windows_like());
        shells.set_available("pwsh", "pwsh.exe", ShellMode::PowerShell);
        shells.set_resolved(
            "cmd",
            StubShellResolver::resolved("cmd", "cmd.exe", ShellMode::WindowsCommandPrompt),
        );
        let credentials = Arc::new(InMemoryCredentialStore::new());
        let events = Arc::new(RecordingCliSink::default());
        let commands = Arc::new(StubCommandResolver::new());
        let gate = DataMaintenanceGate::new();
        let service = CliProfilesService::with_seams(
            storage.clone(),
            gate.clone(),
            commands.clone(),
            shells,
            credentials.clone(),
            events.clone(),
            Arc::new(FixedCliClock),
            Arc::new(SequentialCliIds::default()),
        );
        // Hydration completes before any assertion so later polls observe admission only.
        tauri::async_runtime::block_on(service.snapshot()).expect("hydration should succeed");
        Self {
            participant: CliProfilesDataParticipant::new(service.clone()),
            service,
            storage,
            gate,
            commands,
            credentials,
            events,
            _app_data: app_data,
        }
    }

    /// Seeds one custom profile row with its ordered environment entries.
    fn seed_profile(
        &self,
        id: &str,
        name: &str,
        shell_id: Option<&str>,
        environment: &[(&str, Option<&str>, Option<&str>)],
    ) {
        self.storage
            .with_connection(
                // Fixtures are written through the same storage seam production uses.
                |connection| {
                    connection
                        .execute(
                            "INSERT INTO cli_profiles \
                             (id, name, command, arguments_json, shell_id, icon, color, \
                              created_at_ms, updated_at_ms) \
                             VALUES (?1, ?2, 'fixture-tool', '[\"--flag\"]', ?3, 'Fx', \
                              '#112233', 100, 200)",
                            rusqlite::params![id, name, shell_id],
                        )
                        .map_err(|_| CliProfilesError::PersistenceFailed)?;
                    for (position, (env_name, value, account)) in environment.iter().enumerate() {
                        connection
                            .execute(
                                "INSERT INTO cli_profile_environment \
                                 (profile_id, position, name, value, is_secret, \
                                  credential_account) \
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                                rusqlite::params![
                                    id,
                                    position as i64,
                                    env_name,
                                    value,
                                    i64::from(account.is_some()),
                                    account
                                ],
                            )
                            .map_err(|_| CliProfilesError::PersistenceFailed)?;
                    }
                    Ok::<_, CliProfilesError>(())
                },
            )
            .expect("the profile fixture should be inserted");
    }

    /// Queues one credential reference so reset behaviour stays observable.
    fn enqueue_account(&self, account: &str) {
        self.storage
            .with_connection(
                // The queue fixture uses the production storage seam as well.
                |connection| {
                    connection
                        .execute(
                            "INSERT INTO credential_cleanup_queue \
                             (credential_account, queued_at_ms) VALUES (?1, 5)",
                            rusqlite::params![account],
                        )
                        .map_err(|_| CliProfilesError::PersistenceFailed)?;
                    Ok::<_, CliProfilesError>(())
                },
            )
            .expect("the queue fixture should be inserted");
    }

    /// Reads every queued credential reference in sorted order.
    fn queued_accounts(&self) -> Vec<String> {
        self.storage
            .with_connection(
                // Reads the durable outbox without depending on private helpers.
                |connection| {
                    let mut statement = connection
                        .prepare(
                            "SELECT credential_account FROM credential_cleanup_queue \
                             ORDER BY credential_account",
                        )
                        .map_err(|_| CliProfilesError::PersistenceFailed)?;
                    let accounts = statement
                        .query_map(
                            [],
                            // Decodes one queued credential reference.
                            |row| row.get::<_, String>(0),
                        )
                        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
                        .map_err(|_| CliProfilesError::PersistenceFailed)?;
                    Ok::<_, CliProfilesError>(accounts)
                },
            )
            .expect("the cleanup queue should be readable")
    }

    /// Reads the credential references one persisted profile still owns.
    fn stored_accounts(&self, profile_id: &str) -> Vec<String> {
        self.storage
            .with_connection(
                // Reads persisted metadata so no assertion depends on the cache.
                |connection| {
                    let mut statement = connection
                        .prepare(
                            "SELECT credential_account FROM cli_profile_environment \
                             WHERE profile_id = ?1 AND credential_account IS NOT NULL \
                             ORDER BY position",
                        )
                        .map_err(|_| CliProfilesError::PersistenceFailed)?;
                    let accounts = statement
                        .query_map(
                            rusqlite::params![profile_id],
                            // Decodes one persisted credential reference.
                            |row| row.get::<_, String>(0),
                        )
                        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
                        .map_err(|_| CliProfilesError::PersistenceFailed)?;
                    Ok::<_, CliProfilesError>(accounts)
                },
            )
            .expect("the environment rows should be readable")
    }

    /// Counts the persisted custom profiles of the isolated database.
    fn profile_count(&self) -> i64 {
        self.storage
            .with_connection(
                // Counts rows through the same storage seam production code uses.
                |connection| {
                    connection
                        .query_row(
                            "SELECT COUNT(*) FROM cli_profiles",
                            [],
                            // Decodes the aggregate profile count.
                            |row| row.get::<_, i64>(0),
                        )
                        .map_err(
                            // Fixture queries reuse the owner error contract.
                            |_| CliProfilesError::PersistenceFailed,
                        )
                },
            )
            .expect("the profile count should be readable")
    }
}

/// Builds one minimal CLI profile input with a single secret entry.
fn cli_profile_input(name: &str) -> CliProfileInputDto {
    CliProfileInputDto {
        name: name.to_owned(),
        command: "fixture-tool".to_owned(),
        arguments: Vec::new(),
        shell_id: None,
        icon: "Fx".to_owned(),
        color: "#112233".to_owned(),
        environment: vec![CliProfileEnvironmentInputDto {
            name: "TOKEN".to_owned(),
            value: Some("BE006_SECRET_CANARY".to_owned()),
            is_secret: true,
        }],
    }
}

/// Verifies a held maintenance write permit blocks an ordinary profile mutation.
#[test]
fn cli_profiles_ordinary_mutation_is_blocked_by_write_permit() {
    let harness = CliProfilesHarness::new();
    let mut writer: Pin<Box<dyn Future<Output = _> + Send + '_>> =
        Box::pin(harness.gate.write_permit());
    let write_permit = match poll_once(&mut writer) {
        Poll::Ready(permit) => permit,
        Poll::Pending => panic!("an idle gate should admit the write permit"),
    };

    let mut create: Pin<Box<dyn Future<Output = _> + Send + '_>> =
        Box::pin(harness.service.create_profile(cli_profile_input("Blocked")));
    assert!(poll_once(&mut create).is_pending());

    // The blocked mutation never reached the database, the credential store, or an event.
    assert_eq!(harness.profile_count(), 0);
    assert_eq!(harness.credentials.call_counts(), (0, 0, 0));
    assert!(harness.events.recorded().is_empty());

    drop(write_permit);
    drop(create);
    let snapshot = tauri::async_runtime::block_on(
        harness.service.create_profile(cli_profile_input("Allowed")),
    )
    .expect("the mutation should proceed after maintenance finishes");
    assert_eq!(snapshot.profiles.len(), 4);
    assert_eq!(harness.profile_count(), 1);
}

/// Returns one canonical fixture profile identifier.
fn cli_profile_id(index: u32) -> String {
    format!("profile-{index:08x}-0000-4000-8000-000000000000")
}

/// Returns one opaque fixture credential account.
fn cli_account(index: u32) -> String {
    format!("{index:08x}-0000-4000-8000-aaaaaaaaaaaa")
}

/// Builds one backup record with the supplied environment entries.
fn backup_record(
    id: &str,
    name: &str,
    shell_id: Option<&str>,
    environment: Vec<CliEnvironmentBackupRecordV1>,
) -> CliProfileBackupRecordV1 {
    CliProfileBackupRecordV1 {
        id: id.to_owned(),
        name: name.to_owned(),
        command: "fixture-tool".to_owned(),
        arguments: vec!["--flag".to_owned()],
        shell_id: shell_id.map(str::to_owned),
        icon: "Fx".to_owned(),
        color: "#112233".to_owned(),
        environment,
        created_at_ms: 100,
        updated_at_ms: 200,
    }
}

/// Verifies that the export carries metadata and secret references only.
#[test]
fn cli_profiles_export_contains_metadata_and_secret_references_only() {
    let harness = CliProfilesHarness::new();
    harness.seed_profile(
        &cli_profile_id(1),
        "Seeded",
        Some("cmd"),
        &[
            ("PLAIN", Some("visible"), None),
            ("TOKEN", None, Some(&cli_account(1))),
        ],
    );
    harness
        .credentials
        .seed(&cli_account(1), "BE006_SECRET_CANARY");

    let exported = harness
        .storage
        .with_transaction(
            // The coordinator owns the transaction the owner method must reuse.
            |tx| harness.participant.export(tx),
        )
        .expect("the export should succeed");

    assert_eq!(exported.default_shell_id, "system");
    assert_eq!(exported.custom_profiles.len(), 1);
    let record = &exported.custom_profiles[0];
    assert_eq!(record.id, cli_profile_id(1));
    assert_eq!(record.arguments, vec!["--flag".to_owned()]);
    assert_eq!(record.shell_id.as_deref(), Some("cmd"));
    assert_eq!(
        record.environment,
        vec![
            CliEnvironmentBackupRecordV1::Plain {
                name: "PLAIN".to_owned(),
                value: "visible".to_owned(),
            },
            CliEnvironmentBackupRecordV1::SecretReference {
                name: "TOKEN".to_owned(),
                credential_account: cli_account(1),
            },
        ]
    );
    // The export never reads a secret value from the credential store.
    assert_eq!(harness.credentials.call_counts(), (0, 0, 0));
    let serialized = serde_json::to_string(&exported).expect("the export should serialize");
    assert!(!serialized.contains("BE006_SECRET_CANARY"));
}

/// Verifies the plan and projection are owned sendable values.
#[test]
fn cli_profiles_plan_and_projection_are_owned_values() {
    assert_owned_and_sendable::<CliProfilesImportPlan>();
    assert_owned_and_sendable::<CliProfilesCommittedProjection>();
    assert_owned_and_sendable::<CliProfilesBackupV1>();
}

/// Verifies every owner method runs while maintenance holds the write permit.
#[test]
fn cli_profiles_prepare_is_gate_and_storage_reentry_free() {
    let harness = CliProfilesHarness::new();
    harness.seed_profile(&cli_profile_id(1), "Seeded", None, &[]);
    let incoming = CliProfilesBackupV1 {
        default_shell_id: "cmd".to_owned(),
        custom_profiles: vec![backup_record(
            &cli_profile_id(2),
            "Imported",
            None,
            Vec::new(),
        )],
    };
    // A re-entrant permit or nested Storage call would deadlock this transaction.
    let write_permit = tauri::async_runtime::block_on(harness.gate.write_permit());

    let counts = harness
        .storage
        .with_transaction(|tx| {
            let plan = harness.participant.prepare_import(tx, &incoming)?;
            let projection = harness.participant.apply_import(tx, &plan)?;
            harness.participant.publish_after_commit(projection);
            Ok::<_, CliProfilesError>(plan.counts)
        })
        .expect("every owner method should run inside the coordinator transaction");

    assert_eq!(counts.inserts, 1);
    assert_eq!(counts.updates, 0);
    assert_eq!(counts.unchanged, 0);
    drop(write_permit);
    // The local profile outside the backup survives the merge.
    assert_eq!(harness.profile_count(), 2);
}

/// Verifies that a matching local secret reference survives the merge untouched.
#[test]
fn cli_profiles_merge_preserves_local_matching_secret_reference() {
    let harness = CliProfilesHarness::new();
    harness.seed_profile(
        &cli_profile_id(1),
        "Seeded",
        None,
        &[("TOKEN", None, Some(&cli_account(1)))],
    );
    let incoming = CliProfilesBackupV1 {
        default_shell_id: "system".to_owned(),
        custom_profiles: vec![backup_record(
            &cli_profile_id(1),
            "Renamed",
            None,
            vec![CliEnvironmentBackupRecordV1::SecretReference {
                name: "TOKEN".to_owned(),
                credential_account: cli_account(1),
            }],
        )],
    };

    let counts = harness
        .storage
        .with_transaction(|tx| {
            let plan = harness.participant.prepare_import(tx, &incoming)?;
            harness.participant.apply_import(tx, &plan)?;
            Ok::<_, CliProfilesError>(plan.counts)
        })
        .expect("the merge should commit");

    assert_eq!(counts.updates, 1);
    // The reference is retained, so nothing may be queued for deletion.
    assert!(harness.queued_accounts().is_empty());
    assert_eq!(
        harness.stored_accounts(&cli_profile_id(1)),
        vec![cli_account(1)]
    );
}

/// Verifies that a credential reference owned by another profile is rejected.
#[test]
fn cli_profiles_merge_rejects_cross_identity_credential_alias() {
    let harness = CliProfilesHarness::new();
    harness.seed_profile(
        &cli_profile_id(1),
        "Owner",
        None,
        &[("TOKEN", None, Some(&cli_account(1)))],
    );
    let incoming = CliProfilesBackupV1 {
        default_shell_id: "system".to_owned(),
        custom_profiles: vec![backup_record(
            &cli_profile_id(2),
            "Alias",
            None,
            vec![CliEnvironmentBackupRecordV1::SecretReference {
                name: "TOKEN".to_owned(),
                credential_account: cli_account(1),
            }],
        )],
    };

    let error = harness
        .storage
        .with_transaction(|tx| harness.participant.prepare_import(tx, &incoming))
        .expect_err("an aliased credential must be rejected before any write");

    assert_eq!(error, CliProfilesError::PersistenceFailed);
    assert_eq!(harness.profile_count(), 1);
    assert!(harness.queued_accounts().is_empty());
}

/// Verifies that a rolled-back coordinator transaction publishes nothing.
#[test]
fn cli_profiles_rollback_publishes_nothing() {
    let harness = CliProfilesHarness::new();
    let incoming = CliProfilesBackupV1 {
        default_shell_id: "cmd".to_owned(),
        custom_profiles: vec![backup_record(
            &cli_profile_id(1),
            "Imported",
            None,
            Vec::new(),
        )],
    };

    let error = harness
        .storage
        .with_transaction(|tx| {
            let plan = harness.participant.prepare_import(tx, &incoming)?;
            let _projection = harness.participant.apply_import(tx, &plan)?;
            // The coordinator aborts after applying, so nothing may be published.
            Err::<(), CliProfilesError>(CliProfilesError::PersistenceFailed)
        })
        .expect_err("the coordinator rollback should surface");

    assert_eq!(error, CliProfilesError::PersistenceFailed);
    assert_eq!(harness.profile_count(), 0);
    assert!(harness.events.recorded().is_empty());
    let snapshot = tauri::async_runtime::block_on(harness.service.snapshot())
        .expect("hydration should succeed");
    assert_eq!(snapshot.revision, "0");
    assert_eq!(snapshot.default_shell_id, "system");
    assert_eq!(snapshot.profiles.len(), 3);
}

/// Verifies that a committed merge publishes exactly one owned projection.
#[test]
fn cli_profiles_commit_publishes_owned_projection() {
    let harness = CliProfilesHarness::new();
    let incoming = CliProfilesBackupV1 {
        default_shell_id: "cmd".to_owned(),
        custom_profiles: vec![backup_record(
            &cli_profile_id(1),
            "Imported",
            None,
            Vec::new(),
        )],
    };

    let projection = harness
        .storage
        .with_transaction(|tx| {
            let plan = harness.participant.prepare_import(tx, &incoming)?;
            harness.participant.apply_import(tx, &plan)
        })
        .expect("the merge should commit");
    harness.participant.publish_after_commit(projection);

    let snapshot = tauri::async_runtime::block_on(harness.service.snapshot())
        .expect("the published cache should be readable");
    assert_eq!(snapshot.revision, "1");
    assert_eq!(snapshot.default_shell_id, "cmd");
    assert_eq!(snapshot.effective_default_shell_id, "cmd");
    assert_eq!(snapshot.profiles.len(), 4);
    assert_eq!(snapshot.profiles[3].name, "Imported");
    // One bulk invalidation carries no profile identifier at all.
    assert_eq!(
        harness.events.recorded(),
        vec![("1".to_owned(), "Updated".to_owned(), None)]
    );
}

/// Verifies that a reset clears profiles while keeping the cleanup queue.
#[test]
fn cli_profiles_reset_keeps_cleanup_queue_and_builtins() {
    let harness = CliProfilesHarness::new();
    harness.seed_profile(
        &cli_profile_id(1),
        "Seeded",
        Some("cmd"),
        &[("TOKEN", None, Some(&cli_account(1)))],
    );
    harness.enqueue_account(&cli_account(9));

    let projection = harness
        .storage
        .with_transaction(
            // The reset shares the coordinator transaction with every other owner.
            |tx| harness.participant.apply_reset(tx),
        )
        .expect("the reset should commit");
    harness.participant.publish_after_commit(projection);

    assert_eq!(harness.profile_count(), 0);
    // The queue keeps its earlier row and gains the cleared reference.
    assert_eq!(
        harness.queued_accounts(),
        vec![cli_account(1), cli_account(9)]
    );
    let snapshot = tauri::async_runtime::block_on(harness.service.snapshot())
        .expect("the published cache should be readable");
    assert_eq!(snapshot.default_shell_id, "system");
    assert_eq!(snapshot.effective_default_shell_id, "pwsh");
    assert_eq!(
        snapshot
            .profiles
            .iter()
            .map(
                // Only the three built-ins may survive a reset.
                |profile| profile.id.clone()
            )
            .collect::<Vec<_>>(),
        vec![
            "builtin:codex".to_owned(),
            "builtin:claude".to_owned(),
            "builtin:terminal".to_owned(),
        ]
    );
}

/// Verifies that a foreign secret reference stays metadata and blocks a launch.
#[test]
fn cli_profiles_foreign_secret_reference_fails_at_launch() {
    let harness = CliProfilesHarness::new();
    harness
        .commands
        .set_found("fixture-tool", PathBuf::from("C:\\fixture\\fixture.exe"));
    let incoming = CliProfilesBackupV1 {
        default_shell_id: "system".to_owned(),
        custom_profiles: vec![backup_record(
            &cli_profile_id(1),
            "Imported",
            // A shell identifier from another platform falls back to the default.
            Some("zsh"),
            vec![CliEnvironmentBackupRecordV1::SecretReference {
                name: "TOKEN".to_owned(),
                credential_account: "foreign-machine-account".to_owned(),
            }],
        )],
    };

    let projection = harness
        .storage
        .with_transaction(|tx| {
            let plan = harness.participant.prepare_import(tx, &incoming)?;
            harness.participant.apply_import(tx, &plan)
        })
        .expect("the merge should commit");
    harness.participant.publish_after_commit(projection);

    let snapshot = tauri::async_runtime::block_on(harness.service.snapshot())
        .expect("the published cache should be readable");
    assert_eq!(snapshot.profiles[3].shell_id, None);
    assert_eq!(snapshot.profiles[3].effective_shell_id, "pwsh");
    let entry = &snapshot.profiles[3].environment[0];
    assert!(entry.is_secret);
    assert_eq!(entry.value, None);
    assert!(entry.has_stored_value);

    // The metadata survived, so only the launch reports the missing credential.
    assert_eq!(
        tauri::async_runtime::block_on(harness.service.resolve_for_launch(&cli_profile_id(1)))
            .err(),
        Some(CliProfilesError::SecretNotFound)
    );
}

/// Verifies that a removed local reference is queued while other rows remain.
#[test]
fn cli_profiles_merge_queues_removed_references_and_keeps_other_rows() {
    let harness = CliProfilesHarness::new();
    harness.seed_profile(
        &cli_profile_id(1),
        "Replaced",
        None,
        &[("TOKEN", None, Some(&cli_account(1)))],
    );
    harness.seed_profile(&cli_profile_id(2), "Untouched", None, &[]);
    let incoming = CliProfilesBackupV1 {
        default_shell_id: "system".to_owned(),
        custom_profiles: vec![backup_record(
            &cli_profile_id(1),
            "Replaced",
            None,
            vec![CliEnvironmentBackupRecordV1::Plain {
                name: "PLAIN".to_owned(),
                value: "visible".to_owned(),
            }],
        )],
    };

    harness
        .storage
        .with_transaction(|tx| {
            let plan = harness.participant.prepare_import(tx, &incoming)?;
            harness.participant.apply_import(tx, &plan)
        })
        .expect("the merge should commit");

    // The dropped reference is queued and the untouched local profile remains.
    assert_eq!(harness.queued_accounts(), vec![cli_account(1)]);
    assert_eq!(harness.profile_count(), 2);
    assert!(harness.stored_accounts(&cli_profile_id(1)).is_empty());
}

/// Verifies session creation shares the write gate while shutdown and resume stay gate-free.
#[test]
fn sessions_create_and_reset_share_maintenance_gate() {
    tauri::async_runtime::block_on(async {
        let gate = DataMaintenanceGate::new();
        let manager = SessionManager::with_seams(
            gate.clone(),
            Arc::new(GateSessionProjects),
            Arc::new(GateSessionProfiles),
            Arc::new(GateSessionContent),
            Arc::new(GateSessionEvents),
            true,
        );
        let write_permit = gate.write_permit().await;
        let mut create: Pin<Box<dyn Future<Output = _> + Send + '_>> =
            Box::pin(manager.create_session("project"));
        assert!(poll_once(&mut create).is_pending());

        // Runtime impact and shutdown must not re-enter the gate held by Reset.
        assert_eq!(
            manager
                .shutdown_impact()
                .await
                .expect("gate-free impact should complete")
                .session_count,
            0
        );
        manager
            .shutdown_all()
            .await
            .expect("gate-free shutdown should complete");
        manager.resume_after_reset(true);
        drop(create);
        drop(write_permit);

        let created = manager
            .create_session("project")
            .await
            .expect("admission should reopen after reset");
        assert_eq!(created.summary.project_id, "project");
        assert_eq!(
            manager
                .list_sessions(None)
                .await
                .expect("the post-reset list should be readable")
                .len(),
            1
        );
    });
}
