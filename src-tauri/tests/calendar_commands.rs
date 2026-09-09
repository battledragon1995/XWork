use xwork_lib::storage::{Storage, StorageError};
/// Requires the Calendar schema before any Calendar service is available.
#[test]
fn calendar_migration_is_registered() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::open(temp.path()).unwrap();
    let version = storage
        .with_connection(
            // Reads only the isolated database schema marker.
            |db| {
                Ok::<i64, StorageError>(
                    db.pragma_query_value(
                        None,
                        "user_version",
                        // Decodes the schema version.
                        |row| row.get(0),
                    )
                    .unwrap(),
                )
            },
        )
        .unwrap();
    assert_eq!(version, 8);
}

mod calendar_support;
use calendar_support::*;
use std::sync::atomic::Ordering;
use xwork_lib::calendar::*;
/// Verifies whole-series persistence, reminder identity deltas, stale writes and clock rollback.
#[test]
fn crud_preserves_identity_and_rejects_stale_revisions() {
    let f = Fixture::new();
    tauri::async_runtime::block_on(async {
        let first = f.service.create_calendar_event(input()).await.unwrap();
        assert_eq!(first.title, "Planning Ω");
        assert_eq!(first.description, "first\nsecond");
        assert_eq!(
            f.service
                .get_calendar_event(first.id.clone())
                .await
                .unwrap(),
            first
        );
        f.clock.wall.store(50, Ordering::SeqCst);
        let mut updated_input = input();
        updated_input.reminder_minutes_before = vec![120, 60];
        let updated = f
            .service
            .update_calendar_event(UpdateCalendarEventInputDto {
                event_id: first.id.clone(),
                expected_revision: first.revision.clone(),
                event: updated_input.clone(),
            })
            .await
            .unwrap();
        assert_eq!(updated.revision, "2");
        assert_eq!(updated.updated_at_ms, 101);
        assert_eq!(updated.reminders[1].id, first.reminders[0].id);
        assert_eq!(
            f.service
                .update_calendar_event(UpdateCalendarEventInputDto {
                    event_id: first.id.clone(),
                    expected_revision: first.revision,
                    event: updated_input
                })
                .await,
            Err(CalendarError::RevisionConflict {
                current_revision: "2".into()
            })
        );
        assert_eq!(f.events.values.lock().unwrap().len(), 2);
        f.events.fail.store(true, Ordering::SeqCst);
        assert!(f.service.create_calendar_event(input()).await.is_ok());
        let reopened = Storage::open(&f.directory.path().join("data")).unwrap();
        let count = reopened
            .with_connection(
                // Reads persisted definitions through an independent migrated connection.
                |db| {
                    Ok::<_, StorageError>(
                        db.query_row(
                            "SELECT COUNT(*) FROM calendar_events",
                            [],
                            // Decodes the durable aggregate.
                            |row| row.get::<_, u32>(0),
                        )
                        .unwrap(),
                    )
                },
            )
            .unwrap();
        assert_eq!(count, 2);
    });
}
/// Exercises replacement, exact monotonic expiry, changed impact and repeated confirmation.
#[test]
fn delete_preview_is_single_use_expiring_and_fingerprint_bound() {
    let f = Fixture::new();
    tauri::async_runtime::block_on(async {
        let event = f.service.create_calendar_event(input()).await.unwrap();
        let first = f
            .service
            .prepare_delete_calendar_event(expected(&event))
            .await
            .unwrap();
        let second = f
            .service
            .prepare_delete_calendar_event(expected(&event))
            .await
            .unwrap();
        assert_ne!(first.request_id, second.request_id);
        assert_eq!(
            f.service
                .confirm_delete_calendar_event(ConfirmDeleteCalendarEventInputDto {
                    request_id: first.request_id
                })
                .await,
            Err(CalendarError::DeleteConfirmationMissing)
        );
        f.clock.elapsed.store(60, Ordering::SeqCst);
        assert_eq!(
            f.service
                .confirm_delete_calendar_event(ConfirmDeleteCalendarEventInputDto {
                    request_id: second.request_id
                })
                .await,
            Err(CalendarError::DeleteConfirmationExpired)
        );
        let preview = f
            .service
            .prepare_delete_calendar_event(expected(&event))
            .await
            .unwrap();
        let updated = f
            .service
            .update_calendar_event(UpdateCalendarEventInputDto {
                event_id: event.id,
                expected_revision: event.revision,
                event: input(),
            })
            .await
            .unwrap();
        assert_eq!(
            f.service
                .confirm_delete_calendar_event(ConfirmDeleteCalendarEventInputDto {
                    request_id: preview.request_id
                })
                .await,
            Err(CalendarError::DeleteImpactChanged)
        );
        let preview = f
            .service
            .prepare_delete_calendar_event(expected(&updated))
            .await
            .unwrap();
        f.service
            .confirm_delete_calendar_event(ConfirmDeleteCalendarEventInputDto {
                request_id: preview.request_id,
            })
            .await
            .unwrap();
        assert_eq!(
            f.service.get_calendar_event(updated.id).await,
            Err(CalendarError::EventNotFound)
        );
        assert_eq!(
            f.service
                .confirm_delete_calendar_event(ConfirmDeleteCalendarEventInputDto {
                    request_id: preview.request_id
                })
                .await,
            Err(CalendarError::DeleteConfirmationMissing)
        );
    });
}
/// Injects a late reminder write failure and requires full rollback with no invalidation.
#[test]
fn reminder_failure_rolls_back_base_and_sequence() {
    let f = Fixture::new();
    tauri::async_runtime::block_on(async {
        f.storage.with_connection(
            // Fails after base insertion to exercise transactional atomicity.
            |db| { db.execute_batch("CREATE TRIGGER abort_reminder BEFORE INSERT ON event_reminders BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap(); Ok::<_,StorageError>(()) }).unwrap();
        assert!(f.service.create_calendar_event(input()).await.is_err());
        assert!(f.events.values.lock().unwrap().is_empty());
        let list = f.service.list_calendar_occurrences(range()).await.unwrap();
        assert!(list.items.is_empty());
        assert_eq!(list.revision, "0");
    });
}
/// Requires typed startup failure for an isolated ordinary-file app data path.
#[test]
fn storage_open_failure_does_not_use_real_app_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("file");
    std::fs::write(&path, "fixture").unwrap();
    assert!(matches!(
        Storage::open(&path),
        Err(StorageError::CreateAppDataDirectory { .. })
    ));
}

/// Keeps unavailable project links valid and lets project deletion unlink definitions atomically.
#[test]
fn project_links_validate_and_unlink_through_foreign_keys() {
    let f = Fixture::new();
    let id = "10000000-0000-4000-8000-000000000001";
    let root = f.directory.path().join("missing-project");
    f.storage.with_connection(
        // Inserts isolated public-schema project metadata without native filesystem access.
        |db|Ok::<_,StorageError>(db.execute("INSERT INTO projects(id,display_name,root_path,path_key,is_pinned,added_at_ms,last_opened_at_ms) VALUES(?1,'Unavailable',?2,?2,0,1,1)",rusqlite::params![id,root.to_string_lossy()]).unwrap())).unwrap();
    tauri::async_runtime::block_on(async {
        let mut definition = input();
        definition.project_id = Some(id.into());
        let event = f.service.create_calendar_event(definition).await.unwrap();
        assert_eq!(event.project_id.as_deref(), Some(id));
        let mut query = range();
        query.project_id = Some(id.into());
        assert_eq!(
            f.service
                .list_calendar_occurrences(query.clone())
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        f.storage
            .with_transaction(
                // Exercises the schema-owned unlink behavior within one transaction.
                |db| {
                    Ok::<_, StorageError>(
                        db.execute("DELETE FROM projects WHERE id=?1", [id])
                            .unwrap(),
                    )
                },
            )
            .unwrap();
        assert!(
            f.service
                .get_calendar_event(event.id)
                .await
                .unwrap()
                .project_id
                .is_none()
        );
        assert!(
            f.service
                .list_calendar_occurrences(query)
                .await
                .unwrap()
                .items
                .is_empty()
        );
        let mut missing = input();
        missing.project_id = Some(id.into());
        assert_eq!(
            f.service.create_calendar_event(missing).await,
            Err(CalendarError::ProjectNotFound)
        );
    });
}
