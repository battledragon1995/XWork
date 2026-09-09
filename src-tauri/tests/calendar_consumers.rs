mod calendar_support;
use calendar_support::*;
use xwork_lib::{calendar::*, storage::StorageError};
/// Proves reminder/context/search share identities and remain read-only after timezone edits.
#[test]
fn consumers_share_current_identity_without_delivery_state() {
    let f = Fixture::new();
    tauri::async_runtime::block_on(async {
        let mut definition = input();
        definition.recurrence = EventRecurrenceDto::Daily {
            end: EventRecurrenceEndDto::AfterCount { count: 3 },
        };
        let event = f
            .service
            .create_calendar_event(definition.clone())
            .await
            .unwrap();
        let results = f.service.search_for_unified("planning", 64).await.unwrap();
        assert_eq!(results.items.len(), 1);
        assert_eq!(results.items[0].event_id, event.id);
        let start = results.items[0].starts_at_ms;
        let due = f
            .service
            .reminder_occurrences(start - 3600000, start + 1, 5000)
            .await
            .unwrap();
        assert_eq!(due.len(), 2);
        assert_eq!(due[0].due_at_ms, start - 3600000);
        assert_eq!(due[0].occurrence_id, due[1].occurrence_id);
        let context = f
            .service
            .get_notification_context(&event.id, &due[0].occurrence_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(context.starts_at_ms, start);
        assert_eq!(context.reminder_definitions.len(), 2);
        assert!(
            f.service
                .get_notification_context(&event.id, &format!("forged@t:{start}"))
                .await
                .unwrap()
                .is_none()
        );
        definition.time = EventTimeInputDto::Timed {
            start_local: "2026-09-09T10:00".into(),
            end_local: "2026-09-09T11:00".into(),
            time_zone_id: "UTC".into(),
        };
        f.service
            .update_calendar_event(UpdateCalendarEventInputDto {
                event_id: event.id.clone(),
                expected_revision: event.revision,
                event: definition,
            })
            .await
            .unwrap();
        assert!(
            f.service
                .get_notification_context(&event.id, &due[0].occurrence_id)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(f.events.values.lock().unwrap().len(), 2);
        let tables=f.storage.with_connection(
            // Confirms read ports introduced no scheduler-owned persistence.
            |db|Ok::<_,StorageError>(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%delivery%' OR name LIKE '%reminder_occurrence%')").unwrap().query_map([],
                // Collects names from the isolated schema.
                |row|row.get::<_,String>(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap())).unwrap();
        assert!(tables.is_empty());
    });
}
