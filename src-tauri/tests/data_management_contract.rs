use std::{
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
};

use tempfile::TempDir;
use tokio::sync::Barrier;
use xwork_lib::app::data_participants::ProjectsDataParticipant;
use xwork_lib::projects::{
    CURRENT_PATH_IDENTITY, NoProjectRuntimeGuard, ProjectBackupRecordV1, ProjectChangedEventDto,
    ProjectClock, ProjectCommittedProjection, ProjectDto, ProjectEventSink,
    ProjectFolderSelectionDto, ProjectFuture, ProjectIdFactory, ProjectImportPlan, ProjectPlatform,
    ProjectService, ProjectsError,
};
use xwork_lib::shared::DataMaintenanceGate;
use xwork_lib::storage::Storage;

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
