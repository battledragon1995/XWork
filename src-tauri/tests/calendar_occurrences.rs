mod calendar_support;
use calendar_support::*;
use xwork_lib::calendar::*;
/// Verifies viewer-day overlap, all-day floating dates, filters and typed range limits.
#[test]
fn occurrences_obey_overlap_filters_and_range_limits() {
    let f = Fixture::new();
    tauri::async_runtime::block_on(async {
        let mut timed = input();
        timed.time = EventTimeInputDto::Timed {
            start_local: "2026-08-31T23:00".into(),
            end_local: "2026-09-01T02:00".into(),
            time_zone_id: "Asia/Bangkok".into(),
        };
        let timed = f.service.create_calendar_event(timed).await.unwrap();
        let mut all_day = input();
        all_day.time = EventTimeInputDto::AllDay {
            start_date: "2026-09-01".into(),
            end_date_exclusive: "2026-09-03".into(),
            time_zone_id: "Pacific/Auckland".into(),
        };
        all_day.reminder_minutes_before.clear();
        let all_day = f.service.create_calendar_event(all_day).await.unwrap();
        let list = f.service.list_calendar_occurrences(range()).await.unwrap();
        assert_eq!(list.items.len(), 2);
        assert!(list.items.iter().any(
            // Includes an event beginning before the requested range.
            |item| item.event_id == timed.id
        ));
        assert!(list.items.iter().any(
            // Preserves the all-day event's original floating start date.
            |item|item.event_id==all_day.id&&matches!(&item.time,EventTimeDto::AllDay {start_date,..} if start_date=="2026-09-01")));
        let mut filtered = range();
        filtered.only_with_reminders = true;
        assert_eq!(
            f.service
                .list_calendar_occurrences(filtered)
                .await
                .unwrap()
                .items
                .len(),
            1
        );
        let mut invalid = range();
        invalid.end_date_exclusive = "2026-12-01".into();
        assert_eq!(
            f.service.list_calendar_occurrences(invalid).await,
            Err(CalendarError::InvalidRange)
        );
    });
}
/// Requires the service boundary to retain valid COUNT after a nonexistent future local start.
#[test]
fn recurring_service_retains_valid_count_across_dst_gap() {
    let f = Fixture::new();
    tauri::async_runtime::block_on(async {
        let mut event = input();
        event.time = EventTimeInputDto::Timed {
            start_local: "2026-03-07T02:30".into(),
            end_local: "2026-03-07T03:30".into(),
            time_zone_id: "America/New_York".into(),
        };
        event.recurrence = EventRecurrenceDto::Daily {
            end: EventRecurrenceEndDto::AfterCount { count: 3 },
        };
        f.service.create_calendar_event(event).await.unwrap();
        let mut query = range();
        query.start_date = "2026-03-07".into();
        query.end_date_exclusive = "2026-03-12".into();
        query.viewer_time_zone_id = "America/New_York".into();
        let items = f
            .service
            .list_calendar_occurrences(query)
            .await
            .unwrap()
            .items;
        assert_eq!(items.len(), 3);
        assert!(
            matches!(&items[2].time,EventTimeDto::Timed {start_local,..} if start_local=="2026-03-10T02:30")
        );
    });
}

/// Rejects an overfull occurrence response without truncating any series.
#[test]
fn occurrence_cap_rejects_5001_results() {
    let f = Fixture::new();
    tauri::async_runtime::block_on(async {
        let mut value = input();
        value.recurrence = EventRecurrenceDto::Daily {
            end: EventRecurrenceEndDto::Never,
        };
        value.reminder_minutes_before.clear();
        for _ in 0..84 {
            f.service
                .create_calendar_event(value.clone())
                .await
                .unwrap();
        }
        let mut query = range();
        query.start_date = "2026-09-09".into();
        query.end_date_exclusive = "2026-11-10".into();
        assert_eq!(
            f.service.list_calendar_occurrences(query).await,
            Err(CalendarError::OccurrenceLimitExceeded)
        );
    });
}
