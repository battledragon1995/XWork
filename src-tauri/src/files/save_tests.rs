use super::*;
use crate::files::{
    FilePaneTarget, FilesFuture, MarkdownSaveOutcomeDto, SaveMarkdownFileRequestDto,
    path_policy::ValidatedFileWriteTarget,
    writer::{AtomicFileWriter, NativeAtomicFileWriter, StagedAtomicWrite},
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc,
};
use std::time::Duration;

/// Resolves only the fixture root and counts reads for no-op assertions.
struct Dependencies {
    root: Mutex<PathBuf>,
    roots: AtomicUsize,
}
impl FileDependencies for Dependencies {
    /// Returns a deterministic pane identity without invoking Sessions from unit tests.
    fn resolve_empty_pane<'a>(
        &'a self,
        session: &'a str,
        tab: &'a str,
        pane: &'a str,
    ) -> FilesFuture<'a, Result<FilePaneTarget, FilesError>> {
        Box::pin(async move {
            Ok(FilePaneTarget {
                session_id: session.into(),
                tab_id: tab.into(),
                pane_id: pane.into(),
                project_id: "11111111-1111-4111-8111-111111111111".into(),
            })
        })
    }
    /// Reads the injected current project root.
    fn available_project_root<'a>(
        &'a self,
        _: &'a str,
    ) -> FilesFuture<'a, Result<PathBuf, FilesError>> {
        self.roots.fetch_add(1, Ordering::SeqCst);
        let root = self.root.lock().unwrap().clone();
        Box::pin(async move { Ok(root) })
    }
    /// Returns no unrelated projects in isolated unit tests.
    fn ordered_project_ids<'a>(&'a self) -> FilesFuture<'a, Result<Vec<String>, FilesError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    /// Accepts the isolated pane attachment.
    fn attach_file<'a>(
        &'a self,
        _: &'a FilePaneTarget,
        _: &'a str,
        _: &'a str,
    ) -> FilesFuture<'a, Result<(), FilesError>> {
        Box::pin(async { Ok(()) })
    }
}

/// Retains every resource needed until background watcher teardown finishes.
struct Fixture {
    service: FilesService,
    dependencies: Arc<Dependencies>,
    events: Arc<Mutex<Vec<FileHandleChangedEventDto>>>,
    root: tempfile::TempDir,
    _data: tempfile::TempDir,
}
impl Fixture {
    /// Creates a real Files service over owned storage and a real temporary Markdown target.
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a.md"), b"base").unwrap();
        let dependencies = Arc::new(Dependencies {
            root: Mutex::new(root.path().to_owned()),
            roots: AtomicUsize::new(0),
        });
        let events = Arc::new(Mutex::new(Vec::new()));
        let event_sink = events.clone();
        let service = FilesService::new_with_runtime(
            dependencies.clone(),
            Storage::open(data.path()).unwrap(),
            DataMaintenanceGate::new(),
            Arc::new(|_| Ok(())),
            Arc::new(|_| Ok(())),
            Arc::new(|| Ok(7)),
            Arc::new(move |event| {
                event_sink.lock().unwrap().push(event);
                Ok(())
            }),
            Arc::new(|_| Ok(())),
        );
        Self {
            service,
            dependencies,
            events,
            root,
            _data: data,
        }
    }
    /// Opens another handle for the same fixture path.
    fn open(&self) -> FileHandleDto {
        tauri::async_runtime::block_on(self.service.open_file_in_pane(OpenFileInPaneRequestDto {
            session_id: "session".into(),
            tab_id: "tab".into(),
            pane_id: uuid::Uuid::new_v4().to_string(),
            relative_path: "a.md".into(),
        }))
        .unwrap()
        .file
    }
    /// Applies a snapshot against the currently known disk token.
    fn edit(&self, file: &FileHandleDto, text: &str) -> Result<FileHandleDto, FilesError> {
        let record = self.service.get_record(&file.id).unwrap();
        tauri::async_runtime::block_on(self.service.replace_editor_snapshot(
            &file.id,
            FileEditorSnapshot {
                text: text.into(),
                expected_handle_revision: file.revision.clone(),
                base_disk_revision: record.base_disk_revision,
            },
        ))
    }
    /// Installs a stage-complete barrier for one deterministic save.
    fn barrier(&self) -> (mpsc::Receiver<()>, mpsc::SyncSender<()>) {
        let (entered, observed) = mpsc::sync_channel(1);
        let (release, wait) = mpsc::sync_channel(1);
        *self.service.runtime().unwrap().writer.lock().unwrap() = Arc::new(BarrierWriter {
            entered,
            wait: Mutex::new(wait),
        });
        (observed, release)
    }
}

/// Blocks only after a complete synced stage, leaving the second Files permit for editing.
struct BarrierWriter {
    entered: mpsc::SyncSender<()>,
    wait: Mutex<mpsc::Receiver<()>>,
}
impl AtomicFileWriter for BarrierWriter {
    /// Stages real bytes then waits on a bounded test-owned release channel.
    fn stage(
        &self,
        target: ValidatedFileWriteTarget,
        bytes: &[u8],
    ) -> Result<StagedAtomicWrite, FilesError> {
        let staged = NativeAtomicFileWriter.stage(target, bytes)?;
        self.entered.send(()).unwrap();
        self.wait
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        Ok(staged)
    }
    /// Delegates the native commit after the service's preflight.
    fn commit(&self, staged: &StagedAtomicWrite, base: &DiskFingerprint) -> Result<(), FilesError> {
        NativeAtomicFileWriter.commit(staged, base)
    }
}

/// Starts one save on its own caller thread so a test can edit during staging.
fn start_save(
    service: FilesService,
    file: &FileHandleDto,
) -> std::thread::JoinHandle<Result<crate::files::SaveMarkdownFileResultDto, FilesError>> {
    let request = SaveMarkdownFileRequestDto {
        file_handle_id: file.id.clone(),
        expected_revision: file.revision.clone(),
    };
    std::thread::spawn(move || tauri::async_runtime::block_on(service.save_markdown_file(request)))
}

/// Proves staging saves its requested snapshot while newer edits stay open and dirty.
#[test]
fn save_snapshot_preserves_newer_edits_and_event_order() {
    let fixture = Fixture::new();
    let first = fixture.open();
    let sibling = fixture.open();
    let dirty = fixture.edit(&first, "save this").unwrap();
    let (entered, release) = fixture.barrier();
    let save = start_save(fixture.service.clone(), &dirty);
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    let newer = fixture.edit(&dirty, "newer draft").unwrap();
    assert!(newer.is_dirty);
    fixture.events.lock().unwrap().clear();
    release.send(()).unwrap();
    let saved = save.join().unwrap().unwrap();
    assert_eq!(saved.outcome, MarkdownSaveOutcomeDto::SavedWithNewerEdits);
    assert_eq!(
        std::fs::read(fixture.root.path().join("a.md")).unwrap(),
        b"save this"
    );
    assert_eq!(local_text(&saved.file.state).unwrap().text, "newer draft");
    assert_eq!(
        local_text(&fixture.service.get_open_file(&sibling.id).unwrap().state)
            .unwrap()
            .text,
        "save this"
    );
    let impact = tauri::async_runtime::block_on(fixture.service.close_impact(&first.id)).unwrap();
    assert_eq!(impact.unsaved_file_labels, ["a.md"]);
    let events = fixture.events.lock().unwrap();
    assert_eq!(events[0].file_handle_id, first.id);
    assert_eq!(events[0].change, FileHandleChangeKindDto::Saved);
    assert_eq!(events[1].file_handle_id, sibling.id);
    let handles = fixture.service.runtime().unwrap().handles.lock().unwrap();
    assert!(handles.save_operations.is_empty());
    assert_eq!(handles.reserved_bytes, 0);
}

/// Shows a disk race after staging blocks commit and preserves the latest local draft.
#[test]
fn preflight_change_after_staging_never_overwrites_external_bytes() {
    let fixture = Fixture::new();
    let dirty = fixture.edit(&fixture.open(), "mine").unwrap();
    let (entered, release) = fixture.barrier();
    let save = start_save(fixture.service.clone(), &dirty);
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    std::fs::write(fixture.root.path().join("a.md"), b"external").unwrap();
    release.send(()).unwrap();
    assert!(matches!(
        save.join().unwrap(),
        Err(FilesError::ExternalChangeDetected { .. })
    ));
    let file = fixture.service.get_open_file(&dirty.id).unwrap();
    assert!(matches!(
        file.state,
        FileHandleStateDto::ExternalConflict { .. }
    ));
    assert_eq!(local_text(&file.state).unwrap().text, "mine");
    assert_eq!(
        std::fs::read(fixture.root.path().join("a.md")).unwrap(),
        b"external"
    );
    assert_eq!(std::fs::read_dir(fixture.root.path()).unwrap().count(), 1);
}

/// Verifies close waits for a lease and explicit discard removes only the final local buffer.
#[test]
fn discard_and_second_save_wait_for_the_active_writer() {
    let fixture = Fixture::new();
    let dirty = fixture.edit(&fixture.open(), "mine").unwrap();
    let (entered, release) = fixture.barrier();
    let save = start_save(fixture.service.clone(), &dirty);
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    let second = start_save(fixture.service.clone(), &dirty);
    let service = fixture.service.clone();
    let id = dirty.id.clone();
    let (closed, observed) = mpsc::channel();
    let close = std::thread::spawn(move || {
        let result =
            tauri::async_runtime::block_on(service.close_for_session(&id, CloseRetention::Discard));
        closed.send(()).unwrap();
        result
    });
    assert!(observed.recv_timeout(Duration::from_millis(50)).is_err());
    release.send(()).unwrap();
    assert!(save.join().unwrap().is_ok());
    assert!(matches!(
        second.join().unwrap(),
        Err(FilesError::RevisionConflict { .. } | FilesError::FileHandleNotFound { .. })
    ));
    assert!(close.join().unwrap().is_ok());
    assert!(matches!(
        fixture.service.get_open_file(&dirty.id),
        Err(FilesError::FileHandleNotFound { .. })
    ));
    assert_eq!(
        std::fs::read(fixture.root.path().join("a.md")).unwrap(),
        b"mine"
    );
}

/// Verifies shutdown denies pre-commit work and waits for its worker to retire.
#[test]
fn shutdown_aborts_staged_save_and_releases_lease() {
    let fixture = Fixture::new();
    let dirty = fixture.edit(&fixture.open(), "mine").unwrap();
    let (entered, release) = fixture.barrier();
    let save = start_save(fixture.service.clone(), &dirty);
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    let service = fixture.service.clone();
    let shutdown = std::thread::spawn(move || tauri::async_runtime::block_on(service.shutdown()));
    while !fixture
        .service
        .runtime()
        .unwrap()
        .shutdown
        .load(Ordering::Acquire)
    {
        std::thread::yield_now();
    }
    release.send(()).unwrap();
    assert_eq!(
        save.join().unwrap(),
        Err(FilesError::FileOperationUnavailable)
    );
    shutdown.join().unwrap().unwrap();
    assert_eq!(
        std::fs::read(fixture.root.path().join("a.md")).unwrap(),
        b"base"
    );
    assert_eq!(
        start_save(fixture.service.clone(), &dirty).join().unwrap(),
        Err(FilesError::FileOperationUnavailable)
    );
    assert_eq!(
        fixture
            .service
            .runtime()
            .unwrap()
            .handles
            .lock()
            .unwrap()
            .reserved_bytes,
        0
    );
}

/// Verifies root relocation after staging preserves both roots and a recovery draft.
#[test]
fn relocated_root_never_receives_old_handle_save() {
    let fixture = Fixture::new();
    let dirty = fixture.edit(&fixture.open(), "mine").unwrap();
    let other = tempfile::tempdir().unwrap();
    std::fs::write(other.path().join("a.md"), b"other").unwrap();
    let (entered, release) = fixture.barrier();
    let save = start_save(fixture.service.clone(), &dirty);
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    *fixture.dependencies.root.lock().unwrap() = other.path().to_owned();
    release.send(()).unwrap();
    assert!(matches!(
        save.join().unwrap(),
        Err(FilesError::ProjectRootChanged { .. })
    ));
    let current = fixture.service.get_open_file(&dirty.id).unwrap();
    assert_eq!(current.state, FileHandleStateDto::ProjectRootChanged);
    let edited = fixture.edit(&current, "recovery").unwrap();
    assert_eq!(edited.state, FileHandleStateDto::ProjectRootChanged);
    assert_eq!(
        fixture
            .service
            .get_record(&dirty.id)
            .unwrap()
            .recovery_text
            .unwrap()
            .text,
        "recovery"
    );
    assert_eq!(std::fs::read(other.path().join("a.md")).unwrap(), b"other");
    assert_eq!(
        std::fs::read(fixture.root.path().join("a.md")).unwrap(),
        b"base"
    );
}

/// Verifies clean saves avoid root/writer/events and revision overflow never mutates state.
#[test]
fn clean_save_and_overflow_are_side_effect_free() {
    let fixture = Fixture::new();
    let file = fixture.open();
    let roots = fixture.dependencies.roots.load(Ordering::SeqCst);
    let events = fixture.events.lock().unwrap().len();
    let saved = start_save(fixture.service.clone(), &file)
        .join()
        .unwrap()
        .unwrap();
    assert_eq!(saved.outcome, MarkdownSaveOutcomeDto::AlreadyClean);
    assert_eq!(fixture.dependencies.roots.load(Ordering::SeqCst), roots);
    assert_eq!(fixture.events.lock().unwrap().len(), events);
    {
        fixture
            .service
            .runtime()
            .unwrap()
            .handles
            .lock()
            .unwrap()
            .live
            .get_mut(&file.id)
            .unwrap()
            .dto
            .revision = u64::MAX.to_string();
    }
    let file = fixture.service.get_open_file(&file.id).unwrap();
    assert_eq!(
        fixture.edit(&file, "overflow"),
        Err(FilesError::FileOperationUnavailable)
    );
    assert_eq!(fixture.service.get_open_file(&file.id).unwrap(), file);
}

/// Verifies the watcher exception is one exact revision and explicit reload retires its marker.
#[test]
fn watcher_first_edit_accepts_only_one_exact_stale_revision() {
    let fixture = Fixture::new();
    let first = fixture.open();
    std::fs::write(fixture.root.path().join("a.md"), b"external").unwrap();
    tauri::async_runtime::block_on(fixture.service.reconcile_open_files()).unwrap();
    let original_base = match &first.state {
        FileHandleStateDto::Ready { disk, .. } => disk.disk_revision.clone(),
        _ => unreachable!(),
    };
    let accepted = tauri::async_runtime::block_on(fixture.service.replace_editor_snapshot(
        &first.id,
        FileEditorSnapshot {
            text: "first draft".into(),
            expected_handle_revision: first.revision.clone(),
            base_disk_revision: original_base.clone(),
        },
    ))
    .unwrap();
    assert!(matches!(
        accepted.state,
        FileHandleStateDto::ExternalConflict { .. }
    ));
    assert!(matches!(
        tauri::async_runtime::block_on(fixture.service.replace_editor_snapshot(
            &first.id,
            FileEditorSnapshot {
                text: "too stale".into(),
                expected_handle_revision: first.revision,
                base_disk_revision: original_base
            }
        )),
        Err(FilesError::RevisionConflict { .. })
    ));
}

/// Returns an uncertain commit to exercise recovery without any global fault state.
struct UnknownWriter;
impl AtomicFileWriter for UnknownWriter {
    /// Stages complete bytes through the production writer.
    fn stage(
        &self,
        target: ValidatedFileWriteTarget,
        bytes: &[u8],
    ) -> Result<StagedAtomicWrite, FilesError> {
        NativeAtomicFileWriter.stage(target, bytes)
    }
    /// Injects uncertainty after staging while preserving the fixture's original bytes.
    fn commit(&self, _: &StagedAtomicWrite, _: &DiskFingerprint) -> Result<(), FilesError> {
        Err(FilesError::AtomicCommitStateUnknown)
    }
}

/// Proves uncertain state blocks blind retry until a fresh disk reconciliation becomes visible.
#[test]
fn unknown_commit_requires_reconciliation_without_losing_draft() {
    let fixture = Fixture::new();
    let dirty = fixture.edit(&fixture.open(), "mine").unwrap();
    *fixture.service.runtime().unwrap().writer.lock().unwrap() = Arc::new(UnknownWriter);
    assert_eq!(
        start_save(fixture.service.clone(), &dirty).join().unwrap(),
        Err(FilesError::AtomicCommitStateUnknown)
    );
    let recovery = fixture.service.get_open_file(&dirty.id).unwrap();
    assert!(matches!(
        recovery.state,
        FileHandleStateDto::Unreadable { .. }
    ));
    assert_eq!(
        start_save(fixture.service.clone(), &recovery)
            .join()
            .unwrap(),
        Err(FilesError::FileReadFailed)
    );
    tauri::async_runtime::block_on(fixture.service.reconcile_open_files()).unwrap();
    let reconciled = fixture.service.get_open_file(&dirty.id).unwrap();
    assert!(matches!(
        reconciled.state,
        FileHandleStateDto::ExternalConflict { .. }
    ));
    assert_eq!(local_text(&reconciled.state).unwrap().text, "mine");
}

/// Shows dropping the invoking future does not abandon the worker's active commit authority.
#[test]
fn caller_cancellation_does_not_orphan_the_save_worker() {
    let fixture = Fixture::new();
    let dirty = fixture.edit(&fixture.open(), "mine").unwrap();
    let (entered, release) = fixture.barrier();
    let service = fixture.service.clone();
    let id = dirty.id.clone();
    let caller = tauri::async_runtime::spawn(async move {
        service
            .save_markdown_file(SaveMarkdownFileRequestDto {
                file_handle_id: id,
                expected_revision: dirty.revision,
            })
            .await
    });
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    caller.abort();
    release.send(()).unwrap();
    // Reconciliation takes the same gate, guaranteeing the detached save has finalized first.
    tauri::async_runtime::block_on(fixture.service.reconcile_open_files()).unwrap();
    let current = fixture.service.get_open_file(&dirty.id).unwrap();
    assert!(!current.is_dirty);
    assert_eq!(
        std::fs::read(fixture.root.path().join("a.md")).unwrap(),
        b"mine"
    );
    assert!(
        fixture
            .service
            .runtime()
            .unwrap()
            .handles
            .lock()
            .unwrap()
            .save_operations
            .is_empty()
    );
}

/// Covers lifecycle invalidation and missing targets immediately after staging.
#[test]
fn stale_worker_and_missing_target_cannot_commit() {
    for stale in [false, true] {
        let fixture = Fixture::new();
        let dirty = fixture.edit(&fixture.open(), "mine").unwrap();
        let (entered, release) = fixture.barrier();
        let save = start_save(fixture.service.clone(), &dirty);
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        if stale {
            fixture.service.remove_live(&dirty.id).unwrap();
        } else {
            std::fs::remove_file(fixture.root.path().join("a.md")).unwrap();
        }
        release.send(()).unwrap();
        let error = save.join().unwrap().unwrap_err();
        assert!(if stale {
            error == FilesError::FileOperationUnavailable
        } else {
            matches!(error, FilesError::EntryNotFound { .. })
        });
        assert_eq!(
            std::fs::read_dir(fixture.root.path()).unwrap().count(),
            if stale { 1 } else { 0 }
        );
        assert_eq!(
            fixture
                .service
                .runtime()
                .unwrap()
                .handles
                .lock()
                .unwrap()
                .reserved_bytes,
            0
        );
    }
}

/// Asserts retained-text budget rejection cannot partially mutate an acknowledged snapshot.
#[test]
fn memory_budget_rejection_is_atomic() {
    let fixture = Fixture::new();
    let first = fixture.open();
    let actual = fixture
        .service
        .runtime()
        .unwrap()
        .handles
        .lock()
        .unwrap()
        .text_bytes;
    fixture
        .service
        .runtime()
        .unwrap()
        .handles
        .lock()
        .unwrap()
        .text_bytes = MAX_TEXT_BUFFER_BYTES;
    assert_eq!(
        fixture.edit(&first, "larger than base"),
        Err(FilesError::FileMemoryLimitReached)
    );
    assert_eq!(fixture.service.get_open_file(&first.id).unwrap(), first);
    fixture
        .service
        .runtime()
        .unwrap()
        .handles
        .lock()
        .unwrap()
        .text_bytes = actual;
    let dirty = fixture.edit(&first, "mine").unwrap();
    fixture
        .service
        .runtime()
        .unwrap()
        .handles
        .lock()
        .unwrap()
        .text_bytes = MAX_TEXT_BUFFER_BYTES;
    assert_eq!(
        start_save(fixture.service.clone(), &dirty).join().unwrap(),
        Err(FilesError::FileMemoryLimitReached)
    );
    assert_eq!(
        std::fs::read(fixture.root.path().join("a.md")).unwrap(),
        b"base"
    );
}

/// Keeps an undo to the old base dirty when an already staged save advances the disk base.
#[test]
fn undo_during_staging_gets_dirty_metadata_against_the_new_base() {
    let fixture = Fixture::new();
    let dirty = fixture.edit(&fixture.open(), "staged").unwrap();
    let (entered, release) = fixture.barrier();
    let save = start_save(fixture.service.clone(), &dirty);
    entered.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(!fixture.edit(&dirty, "base").unwrap().is_dirty);
    release.send(()).unwrap();
    let saved = save.join().unwrap().unwrap();
    assert_eq!(saved.outcome, MarkdownSaveOutcomeDto::SavedWithNewerEdits);
    assert_eq!(saved.file.dirty_since_ms, Some(7));
    assert_eq!(saved.file.edit_count, 1);
    assert_eq!(local_text(&saved.file.state).unwrap().text, "base");
}

/// Ensures a missing-file transition cannot reuse an earlier watcher-reload exception.
#[test]
fn unavailable_transition_retires_the_watcher_race_marker() {
    let fixture = Fixture::new();
    let original = fixture.open();
    let original_token = fixture
        .service
        .get_record(&original.id)
        .unwrap()
        .base_disk_revision;
    std::fs::write(fixture.root.path().join("a.md"), b"external").unwrap();
    tauri::async_runtime::block_on(fixture.service.reconcile_open_files()).unwrap();
    let reloaded = fixture.service.get_open_file(&original.id).unwrap();
    std::fs::remove_file(fixture.root.path().join("a.md")).unwrap();
    tauri::async_runtime::block_on(fixture.service.reconcile_open_files()).unwrap();
    assert!(matches!(
        tauri::async_runtime::block_on(fixture.service.replace_editor_snapshot(
            &original.id,
            FileEditorSnapshot {
                text: "stale draft".into(),
                expected_handle_revision: reloaded.revision,
                base_disk_revision: original_token
            }
        )),
        Err(FilesError::RevisionConflict { .. })
    ));
}
