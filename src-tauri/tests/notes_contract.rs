use xwork_lib::storage::{Storage, StorageError};
/// Verifies the Notes schema version on an isolated fresh database.
#[test]
fn notes_migration_is_registered() {
    let directory = tempfile::tempdir().unwrap();
    let storage = Storage::open(directory.path()).unwrap();
    let version = storage
        .with_connection(
            // Reads the durable migration marker.
            |db| {
                Ok::<_, StorageError>(
                    db.pragma_query_value(
                        None,
                        "user_version",
                        // Decodes the marker.
                        |row| row.get::<_, u32>(0),
                    )
                    .unwrap(),
                )
            },
        )
        .unwrap();
    assert_eq!(version, 10);
}
/// Requires a typed Notes array in every schema-v2 backup.
#[test]
fn backup_v2_requires_notes_and_accepts_empty_array() {
    let value = serde_json::json!({"format":"xwork-backup","schemaVersion":2,"createdAtMs":1,"appVersion":"0.0.0","data":{"projects":[],"cliProfiles":{"defaultShellId":"system","customProfiles":[]},"appearance":xwork_lib::settings::SettingsBackupSection::defaults().appearance,"sidebar":xwork_lib::settings::SettingsBackupSection::defaults().sidebar,"keyboardShortcutOverrides":[],"notes":[]}});
    assert!(xwork_lib::settings::parse_backup(&serde_json::to_vec(&value).unwrap()).is_ok());
}
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, AtomicU64, Ordering},
};
use std::time::Duration;
use xwork_lib::{notes::*, shared::DataMaintenanceGate};
struct Clock {
    wall: AtomicI64,
    elapsed: AtomicU64,
}
impl NotesClock for Clock {
    /// Returns a controlled wall clock; negative values inject failure.
    fn now_ms(&self) -> Result<i64, NotesError> {
        let value = self.wall.load(Ordering::SeqCst);
        if value < 0 {
            Err(NotesError::ClockFailed)
        } else {
            Ok(value)
        }
    }
    /// Returns controlled monotonic time without sleeps.
    fn elapsed(&self) -> Duration {
        Duration::from_secs(self.elapsed.load(Ordering::SeqCst))
    }
}
#[derive(Default)]
struct Events {
    values: Mutex<Vec<NoteChangedEventDto>>,
    fail: std::sync::atomic::AtomicBool,
}
impl NotesEventSink for Events {
    /// Records events and optionally fails after observing the committed payload.
    fn emit(&self, event: NoteChangedEventDto) -> Result<(), NotesError> {
        self.values.lock().unwrap().push(event);
        if self.fail.load(Ordering::SeqCst) {
            Err(NotesError::PersistenceFailed)
        } else {
            Ok(())
        }
    }
}
struct Fixture {
    directory: tempfile::TempDir,
    storage: Storage,
    service: NotesService,
    clock: Arc<Clock>,
    events: Arc<Events>,
    gate: DataMaintenanceGate,
}
impl Fixture {
    /// Builds a completely isolated Notes owner with controllable clocks and events.
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(directory.path()).unwrap();
        let gate = DataMaintenanceGate::new();
        let clock = Arc::new(Clock {
            wall: AtomicI64::new(100),
            elapsed: AtomicU64::new(0),
        });
        let events = Arc::new(Events::default());
        let service =
            NotesService::with_seams(storage.clone(), gate.clone(), clock.clone(), events.clone());
        Self {
            directory,
            storage,
            service,
            clock,
            events,
            gate,
        }
    }
    /// Creates a meaningful note through the public service boundary.
    async fn create(&self, text: &str) -> NoteDto {
        self.service
            .create_note(CreateNoteInputDto {
                title: Some("  Title  ".into()),
                content_markdown: text.into(),
                project_id: None,
            })
            .await
            .unwrap()
    }
}
/// Builds an expected-revision command from the most recent owner snapshot.
fn expected(note: &NoteDto) -> NoteRevisionInputDto {
    NoteRevisionInputDto {
        note_id: note.id.clone(),
        expected_revision: note.revision.clone(),
    }
}
/// Builds a full autosave command using the exact current revision.
fn save(note: &NoteDto, body: &str) -> AutosaveNoteInputDto {
    AutosaveNoteInputDto {
        note_id: note.id.clone(),
        expected_revision: note.revision.clone(),
        title: note.title.clone(),
        content_markdown: body.into(),
    }
}
/// Builds the standard unfiltered lifecycle query.
fn list(status: NoteStatusDto) -> ListNotesInputDto {
    ListNotesInputDto {
        status,
        query: None,
        project_filter: NoteProjectFilterDto::All,
        pinned_filter: NotePinnedFilterDto::Any,
        offset: 0,
        limit: 100,
    }
}
/// Validates input boundaries, persistence, no-op behavior and competing saves.
#[test]
fn autosave_is_revision_safe_durable_and_validated() {
    tauri::async_runtime::block_on(async {
        let fixture = Fixture::new();
        assert_eq!(
            fixture
                .service
                .create_note(CreateNoteInputDto {
                    title: Some("Only title".into()),
                    content_markdown: " \n ".into(),
                    project_id: None
                })
                .await,
            Err(NotesError::EmptyInitialContent)
        );
        let note = fixture.create("original 😀").await;
        assert_eq!(note.title.as_deref(), Some("Title"));
        let noop = fixture
            .service
            .autosave_note(save(&note, "original 😀"))
            .await
            .unwrap();
        assert_eq!(noop, note);
        assert_eq!(fixture.events.values.lock().unwrap().len(), 1);
        fixture.clock.wall.store(50, Ordering::SeqCst);
        let first_service = fixture.service.clone();
        let first_input = save(&note, "one");
        let first =
            tauri::async_runtime::spawn(
                async move { first_service.autosave_note(first_input).await },
            );
        let second = fixture.service.autosave_note(save(&note, "two")).await;
        let first = first.await.unwrap();
        assert_ne!(first.is_ok(), second.is_ok());
        let current = fixture.service.get_note(note.id.clone()).await.unwrap();
        assert_eq!(current.revision, "2");
        assert_eq!(current.updated_at_ms, 101);
        let conflict = if first.is_err() { first } else { second };
        assert_eq!(
            conflict,
            Err(NotesError::RevisionConflict {
                current: Box::new(current.clone())
            })
        );
        fixture.events.fail.store(true, Ordering::SeqCst);
        let empty = fixture
            .service
            .autosave_note(save(&current, ""))
            .await
            .unwrap();
        assert_eq!(empty.revision, "3");
        let reopened = NotesService::with_seams(
            Storage::open(fixture.directory.path()).unwrap(),
            fixture.gate.clone(),
            fixture.clock.clone(),
            fixture.events.clone(),
        );
        assert_eq!(reopened.get_note(note.id.clone()).await.unwrap(), empty);
        fixture.clock.wall.store(-1, Ordering::SeqCst);
        assert_eq!(
            fixture.service.autosave_note(save(&empty, "fail")).await,
            Err(NotesError::ClockFailed)
        );
        assert_eq!(fixture.service.get_note(note.id).await.unwrap(), empty);
        assert_eq!(
            fixture
                .service
                .autosave_note(AutosaveNoteInputDto {
                    title: Some("x".repeat(256)),
                    ..save(&empty, "")
                })
                .await,
            Err(NotesError::InvalidTitle)
        );
        assert_eq!(
            fixture
                .service
                .autosave_note(save(&empty, &"😀".repeat(262145)))
                .await,
            Err(NotesError::ContentTooLarge)
        );
        assert_eq!(
            fixture
                .service
                .autosave_note(AutosaveNoteInputDto {
                    expected_revision: "03".into(),
                    ..save(&empty, "")
                })
                .await,
            Err(NotesError::InvalidRevision)
        );
    });
}

/// Covers every lifecycle edge and ensures metadata never changes edited time.
#[test]
fn lifecycle_pin_and_read_only_matrix() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let note = f.create("body").await;
        let pinned = f
            .service
            .set_note_pinned(SetNotePinnedInputDto {
                note_id: note.id.clone(),
                expected_revision: note.revision.clone(),
                pinned: true,
            })
            .await
            .unwrap();
        assert_eq!(pinned.updated_at_ms, note.updated_at_ms);
        let archive = f.service.archive_note(expected(&pinned)).await.unwrap();
        assert!(archive.is_pinned);
        assert_eq!(archive.updated_at_ms, note.updated_at_ms);
        assert!(matches!(
            f.service.autosave_note(save(&archive, "no")).await,
            Err(NotesError::NoteNotEditable {
                status: NoteStatusDto::Archived
            })
        ));
        assert!(matches!(
            f.service.archive_note(expected(&archive)).await,
            Err(NotesError::InvalidTransition { .. })
        ));
        let trash = f
            .service
            .move_note_to_trash(expected(&archive))
            .await
            .unwrap();
        assert_eq!(trash.trashed_from, Some(NotePreviousStatusDto::Archived));
        assert!(matches!(
            f.service
                .set_note_pinned(SetNotePinnedInputDto {
                    note_id: trash.id.clone(),
                    expected_revision: trash.revision.clone(),
                    pinned: false
                })
                .await,
            Err(NotesError::NoteNotEditable { .. })
        ));
        let restored = f
            .service
            .restore_note_from_trash(expected(&trash))
            .await
            .unwrap();
        assert_eq!(restored.status, NoteStatusDto::Archived);
        assert_eq!(restored.archived_at_ms, archive.archived_at_ms);
        let active = f
            .service
            .restore_archived_note(expected(&restored))
            .await
            .unwrap();
        assert_eq!(active.status, NoteStatusDto::Active);
        assert_eq!(active.archived_at_ms, None);
        assert!(matches!(
            f.service.delete_note_permanently(expected(&active)).await,
            Err(NotesError::InvalidTransition { .. })
        ));
        let trash = f
            .service
            .move_note_to_trash(expected(&active))
            .await
            .unwrap();
        let active = f
            .service
            .restore_note_from_trash(expected(&trash))
            .await
            .unwrap();
        assert_eq!(active.status, NoteStatusDto::Active);
        let trash = f
            .service
            .move_note_to_trash(expected(&active))
            .await
            .unwrap();
        f.service
            .delete_note_permanently(expected(&trash))
            .await
            .unwrap();
        assert_eq!(
            f.service.get_note(trash.id).await,
            Err(NotesError::NoteNotFound)
        );
        let events = f.events.values.lock().unwrap();
        for (index, event) in events.iter().enumerate() {
            assert_eq!(event.sequence, (index + 1).to_string());
        }
        assert_eq!(NOTES_CHANGED_EVENT, "notes://changed");
    });
}

/// Verifies bounded deterministic paging, search, global counts and project FK behavior.
#[test]
fn list_search_counts_project_unlink_and_sql_binding() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let project = uuid::Uuid::new_v4().to_string();
        f.storage.with_connection(
        // Inserts metadata only; no project filesystem access occurs.
        |db| {db.execute("INSERT INTO projects(id,display_name,root_path,path_key,is_pinned,added_at_ms,last_opened_at_ms) VALUES (?1,'Unavailable','X:/missing','x:/missing',0,1,1)",[&project])?;Ok::<_,NotesError>(())}).unwrap();
        let note = f
            .service
            .create_note(CreateNoteInputDto {
                title: None,
                content_markdown: "Body ' quoted İ 😀 <script>hidden</script>".into(),
                project_id: Some(project.clone()),
            })
            .await
            .unwrap();
        let second = f.create("other").await;
        let archived = f.service.archive_note(expected(&second)).await.unwrap();
        let page = f
            .service
            .list_notes(ListNotesInputDto {
                query: Some("' quoted".into()),
                ..list(NoteStatusDto::Active)
            })
            .await
            .unwrap();
        assert_eq!(page.total_matches, 1);
        assert_eq!(page.counts.archived, 1);
        assert!(!page.items[0].snippet.contains("hidden"));
        let search = f.service.search_for_unified("other", 64).await.unwrap();
        assert_eq!(search.items[0].note_id, archived.id);
        f.service
            .move_note_to_trash(expected(&archived))
            .await
            .unwrap();
        assert!(
            f.service
                .search_for_unified("other", 64)
                .await
                .unwrap()
                .items
                .is_empty()
        );
        f.storage
            .with_transaction(
                // Exercises the schema's project unlink behavior without touching source files.
                |tx| {
                    tx.execute("DELETE FROM projects WHERE id=?1", [&project])?;
                    Ok::<_, NotesError>(())
                },
            )
            .unwrap();
        let unlinked = f.service.get_note(note.id.clone()).await.unwrap();
        assert_eq!(unlinked.project_id, None);
        assert_eq!(unlinked.revision, note.revision);
        assert_eq!(
            f.service
                .set_note_project(SetNoteProjectInputDto {
                    note_id: note.id,
                    expected_revision: note.revision,
                    project_id: Some(project)
                })
                .await,
            Err(NotesError::ProjectNotFound)
        );
        assert_eq!(
            f.service
                .list_notes(ListNotesInputDto {
                    limit: 0,
                    ..list(NoteStatusDto::Active)
                })
                .await,
            Err(NotesError::InvalidPagination)
        );
        assert_eq!(
            f.service
                .list_notes(ListNotesInputDto {
                    pinned_filter: NotePinnedFilterDto::Only,
                    ..list(NoteStatusDto::Trash)
                })
                .await,
            Err(NotesError::InvalidFilter)
        );
    });
}

/// Ensures stale, replaced, changed, expired and consumed Trash requests cannot delete.
#[test]
fn empty_trash_confirmation_is_atomic_and_expiring() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        assert_eq!(
            f.service.prepare_empty_notes_trash().await,
            Err(NotesError::TrashEmpty)
        );
        let note = f.create("one").await;
        f.service.move_note_to_trash(expected(&note)).await.unwrap();
        let first = f.service.prepare_empty_notes_trash().await.unwrap();
        let second = f.service.prepare_empty_notes_trash().await.unwrap();
        assert_eq!(
            f.service.confirm_empty_notes_trash(first.request_id).await,
            Err(NotesError::StaleTrashRequest)
        );
        f.service
            .cancel_empty_notes_trash(second.request_id)
            .await
            .unwrap();
        assert_eq!(
            f.service.confirm_empty_notes_trash(second.request_id).await,
            Err(NotesError::NoPendingTrashOperation)
        );
        let request = f.service.prepare_empty_notes_trash().await.unwrap();
        f.clock.elapsed.store(300, Ordering::SeqCst);
        assert_eq!(
            f.service
                .confirm_empty_notes_trash(request.request_id)
                .await,
            Err(NotesError::StaleTrashRequest)
        );
        let request = f.service.prepare_empty_notes_trash().await.unwrap();
        let note = f.create("two").await;
        f.service.move_note_to_trash(expected(&note)).await.unwrap();
        let changed = f
            .service
            .confirm_empty_notes_trash(request.request_id)
            .await
            .unwrap_err();
        let NotesError::TrashChanged { impact } = changed else {
            panic!("changed preview expected")
        };
        assert_eq!(impact.note_count, 2);
        assert_eq!(
            f.service
                .confirm_empty_notes_trash(impact.request_id)
                .await
                .unwrap()
                .deleted_count,
            2
        );
        assert_eq!(
            f.service.confirm_empty_notes_trash(impact.request_id).await,
            Err(NotesError::NoPendingTrashOperation)
        );
        let events = f.events.values.lock().unwrap();
        let event = events.last().unwrap();
        assert_eq!(event.kind, NoteChangeKindDto::TrashEmptied);
        assert_eq!(event.note_id, None);
        assert_eq!(event.revision, None);
    });
}

/// Confirms transaction rollback, maintenance exclusion and revision exhaustion.
#[test]
fn maintenance_merge_reset_rollback_and_gate() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let note = f.create("original").await;
        let mut records = f
            .storage
            .with_transaction(
                // Exports through the transaction-only owner interface.
                |tx| f.service.export_notes_in(tx),
            )
            .unwrap();
        records[0].content_markdown = "incoming".into();
        let permit = f.gate.write_permit().await;
        let blocked = f.service.autosave_note(save(&note, "must wait"));
        tokio::pin!(blocked);
        assert!(matches!(
            std::future::poll_fn(
                // Polls once to prove admission remains pending without wall-clock sleeps.
                |cx| std::task::Poll::Ready(blocked.as_mut().poll(cx))
            )
            .await,
            std::task::Poll::Pending
        ));
        let events_before = f.events.values.lock().unwrap().len();
        let error = f.storage.with_transaction(
            // Injects a later domain failure after Notes writes in the shared transaction.
            |tx| {
                let plan = f.service.prepare_notes_merge_in(tx, &records)?;
                f.service.apply_notes_merge_in(tx, &plan)?;
                Err::<(), NotesError>(NotesError::PersistenceFailed)
            },
        );
        assert!(error.is_err());
        assert_eq!(f.events.values.lock().unwrap().len(), events_before);
        assert_eq!(
            f.service
                .get_note(note.id.clone())
                .await
                .unwrap()
                .content_markdown,
            "original"
        );
        let projection = f
            .storage
            .with_transaction(
                // Applies a valid prepared merge and returns its owned projection.
                |tx| {
                    let plan = f.service.prepare_notes_merge_in(tx, &records)?;
                    assert_eq!(plan.counts.updates, 1);
                    f.service.apply_notes_merge_in(tx, &plan)
                },
            )
            .unwrap();
        f.service.publish_data_change(projection);
        drop(permit);
        assert!(matches!(
            blocked.await,
            Err(NotesError::RevisionConflict { .. })
        ));
        assert_eq!(records[0].content_markdown, "incoming");
        f.storage
            .with_connection(
                // Injects the durable revision ceiling directly into an isolated fixture.
                |db| {
                    db.execute("UPDATE notes SET revision=9223372036854775807", [])?;
                    Ok::<_, NotesError>(())
                },
            )
            .unwrap();
        let latest = f.service.get_note(note.id.clone()).await.unwrap();
        assert_eq!(
            f.service.autosave_note(save(&latest, "overflow")).await,
            Err(NotesError::RevisionExhausted)
        );
        let projection = f
            .storage
            .with_transaction(
                // Deletes every lifecycle state inside the coordinator-owned transaction.
                |tx| f.service.reset_notes_in(tx),
            )
            .unwrap();
        assert_eq!(projection.affected_count, 1);
        f.service.publish_data_change(projection);
        assert_eq!(
            f.service.get_note(note.id).await,
            Err(NotesError::NoteNotFound)
        );
    });
}

/// Validates caller allowlists and exact public discriminator field casing.
#[test]
fn caller_and_serialization_contracts() {
    assert!(authorize_notes_caller("main", false).is_ok());
    assert!(authorize_notes_caller("quick-note", true).is_ok());
    assert_eq!(
        authorize_notes_caller("quick-note", false),
        Err(NotesError::UnauthorizedWindow)
    );
    assert_eq!(
        authorize_notes_caller("quick-note-2", true),
        Err(NotesError::UnauthorizedWindow)
    );
    assert_eq!(
        serde_json::to_value(NoteProjectFilterDto::Project {
            project_id: "id".into()
        })
        .unwrap(),
        serde_json::json!({"kind":"project","projectId":"id"})
    );
}
/// Measures bounded list/search latency against deterministic 10,000-note Windows data.
#[test]
#[ignore = "explicit Windows performance measurement, separate from correctness"]
fn notes_windows_10000_record_benchmark() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let body = format!("needle {}", "safe text ".repeat(409));
        let records = (0..10000)
            .map(
                // Creates deterministic identities and approximately four-KiB bodies.
                |index| NoteBackupRecordV1 {
                    id: format!("00000000-0000-4000-8000-{index:012}"),
                    title: Some(format!("Note {index}")),
                    content_markdown: body.clone(),
                    project_id: None,
                    is_pinned: false,
                    status: NoteStatusDto::Active,
                    trashed_from: None,
                    created_at_ms: 1,
                    updated_at_ms: 1,
                    archived_at_ms: None,
                    trashed_at_ms: None,
                },
            )
            .collect::<Vec<_>>();
        f.storage
            .with_transaction(
                // Seeds all owner records in one isolated transaction.
                |tx| {
                    let plan = f.service.prepare_notes_merge_in(tx, &records)?;
                    f.service.apply_notes_merge_in(tx, &plan)
                },
            )
            .unwrap();
        let mut lists = Vec::new();
        let mut searches = Vec::new();
        for _ in 0..20 {
            let started = std::time::Instant::now();
            f.service
                .list_notes(ListNotesInputDto {
                    limit: 30,
                    ..list(NoteStatusDto::Active)
                })
                .await
                .unwrap();
            lists.push(started.elapsed());
            let started = std::time::Instant::now();
            f.service
                .list_notes(ListNotesInputDto {
                    query: Some("needle".into()),
                    limit: 30,
                    ..list(NoteStatusDto::Active)
                })
                .await
                .unwrap();
            searches.push(started.elapsed());
        }
        lists.sort();
        searches.sort();
        eprintln!(
            "Notes 10000 x ~4KiB: list p95 {:?}; search p95 {:?}",
            lists[18], searches[18]
        );
        assert!(lists[18] < Duration::from_millis(50));
        assert!(searches[18] < Duration::from_millis(200));
    });
}
/// Upgrades an isolated version-six database and verifies migration persistence on reopen.
#[test]
fn notes_upgrade_from_six_preserves_existing_metadata() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join(Storage::DATABASE_FILE_NAME);
    let mut db = rusqlite::Connection::open(&database).unwrap();
    for sql in [
        include_str!("../migrations/0001_create_projects.sql"),
        include_str!("../migrations/0002_create_settings.sql"),
        include_str!("../migrations/0003_create_cli_profiles.sql"),
        include_str!("../migrations/0004_create_keyboard_shortcuts.sql"),
        include_str!("../migrations/0005_create_notifications.sql"),
        include_str!("../migrations/0006_create_recent_files.sql"),
    ] {
        let tx = db.transaction().unwrap();
        tx.execute_batch(sql).unwrap();
        tx.commit().unwrap();
    }
    db.pragma_update(None, "user_version", 6).unwrap();
    db.execute("INSERT INTO projects(id,display_name,root_path,path_key,is_pinned,added_at_ms,last_opened_at_ms) VALUES ('00000000-0000-4000-8000-000000000001','Keep','X:/missing','x:/missing',0,1,1)",[]).unwrap();
    drop(db);
    for _ in 0..2 {
        let storage = Storage::open(directory.path()).unwrap();
        storage
            .with_connection(
                // Confirms the upgrade retains the pre-existing owner and STRICT Notes table.
                |db| {
                    assert_eq!(
                        db.query_row("SELECT COUNT(*) FROM projects", [], |row| row
                            .get::<_, i64>(0))
                            .unwrap(),
                        1
                    );
                    assert_eq!(
                        db.query_row(
                            "SELECT strict FROM pragma_table_list WHERE name='notes'",
                            [],
                            |row| row.get::<_, i64>(0)
                        )
                        .unwrap(),
                        1
                    );
                    Ok::<_, NotesError>(())
                },
            )
            .unwrap();
    }
}
/// Covers exact input caps, deterministic pin pagination and bounded bulk previews.
#[test]
fn input_caps_and_deterministic_pages() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let note = f
            .service
            .create_note(CreateNoteInputDto {
                title: Some("界".repeat(255)),
                content_markdown: "😀".repeat(262144),
                project_id: None,
            })
            .await
            .unwrap();
        assert_eq!(note.content_markdown.len(), 1048576);
        assert_eq!(
            f.service.get_note("BAD-ID".into()).await,
            Err(NotesError::InvalidNoteId)
        );
        assert_eq!(
            f.service
                .autosave_note(AutosaveNoteInputDto {
                    title: Some("bad\ntitle".into()),
                    ..save(&note, "body")
                })
                .await,
            Err(NotesError::InvalidTitle)
        );
        assert_eq!(
            f.service
                .list_notes(ListNotesInputDto {
                    query: Some("x".repeat(129)),
                    ..list(NoteStatusDto::Active)
                })
                .await,
            Err(NotesError::InvalidSearch)
        );
        let mut notes = vec![note];
        for index in 0..11 {
            notes.push(f.create(&format!("small {index}")).await);
        }
        let pinned = f
            .service
            .set_note_pinned(SetNotePinnedInputDto {
                note_id: notes[5].id.clone(),
                expected_revision: notes[5].revision.clone(),
                pinned: true,
            })
            .await
            .unwrap();
        notes[5] = pinned.clone();
        let page = f
            .service
            .list_notes(ListNotesInputDto {
                limit: 1,
                ..list(NoteStatusDto::Active)
            })
            .await
            .unwrap();
        assert_eq!(page.items[0].id, pinned.id);
        assert!(page.has_more);
        assert_eq!(page.total_matches, 12);
        let count = f.events.values.lock().unwrap().len();
        assert_eq!(
            f.service
                .set_note_pinned(SetNotePinnedInputDto {
                    note_id: pinned.id.clone(),
                    expected_revision: pinned.revision.clone(),
                    pinned: true
                })
                .await
                .unwrap(),
            pinned
        );
        assert_eq!(f.events.values.lock().unwrap().len(), count);
        for note in notes {
            f.service.move_note_to_trash(expected(&note)).await.unwrap();
        }
        let impact = f.service.prepare_empty_notes_trash().await.unwrap();
        assert_eq!(impact.note_count, 12);
        assert_eq!(impact.notes.len(), 10);
        assert!(impact.has_more);
    });
}
/// Rejects malformed maintenance records before any write and preserves absent local IDs.
#[test]
fn maintenance_validation_is_atomic_and_incoming_wins() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let note = f.create("before").await;
        let retained = f.create("retain").await;
        let mut records = f
            .storage
            .with_transaction(
                // Takes an owned fixture snapshot through the public maintenance interface.
                |tx| f.service.export_notes_in(tx),
            )
            .unwrap();
        records.retain(
            // Imports only the selected identity to test preservation of absent locals.
            |record| record.id == note.id,
        );
        let original = records.clone();
        records.push(records[0].clone());
        assert!(
            f.storage
                .with_transaction(
                    // Rejects duplicate identities before any operation becomes applicable.
                    |tx| f.service.prepare_notes_merge_in(tx, &records)
                )
                .is_err()
        );
        records = original;
        records[0].status = NoteStatusDto::Trash;
        assert!(
            f.storage
                .with_transaction(
                    // Rejects missing Trash provenance and timestamp as one invalid lifecycle.
                    |tx| f.service.prepare_notes_merge_in(tx, &records)
                )
                .is_err()
        );
        records[0].status = NoteStatusDto::Active;
        records[0].content_markdown = "incoming".into();
        let projection = f
            .storage
            .with_transaction(
                // Applies the complete validated incoming snapshot in one transaction.
                |tx| {
                    let plan = f.service.prepare_notes_merge_in(tx, &records)?;
                    f.service.apply_notes_merge_in(tx, &plan)
                },
            )
            .unwrap();
        f.service.publish_data_change(projection);
        assert_eq!(f.service.get_note(note.id).await.unwrap().revision, "2");
        assert_eq!(
            f.service.get_note(retained.id.clone()).await.unwrap(),
            retained
        );
    });
}
