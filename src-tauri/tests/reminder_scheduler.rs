#[path = "support/reminders.rs"]
mod reminders;
use reminders::*;
use std::sync::atomic::Ordering;
use xwork_lib::calendar::*;

/// Verifies first-run baseline, exact live boundary, duplicate wakes, and nondecreasing rollback.
#[test]
fn first_run_live_boundary_and_clock_rollback() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(999);
        h.service.process_once().await.unwrap();
        assert!(h.rows().await.is_empty());
        h.deps.candidates.lock().unwrap().clear();
        h.deps.contexts.lock().unwrap().clear();
        h.add(1100);
        h.clock.set(1100);
        h.service.process_once().await.unwrap();
        assert_eq!(h.rows().await.len(), 1);
        assert_eq!(h.rows().await[0].status, ReminderDeliveryStatusDto::Active);
        let checkpoint = h.checkpoint();
        h.service.process_once().await.unwrap();
        assert_eq!(h.rows().await.len(), 1);
        h.clock.set(1050);
        h.service.process_once().await.unwrap();
        assert_eq!(h.checkpoint(), checkpoint);
    });
}
/// Verifies downtime classification is durable and does not replay the same identity on restart.
#[test]
fn downtime_is_missed_and_restart_deduplicates() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(2000);
        h.service.process_once().await.unwrap();
        h.clock.set(3000);
        let restarted = h.restart();
        restarted.process_once().await.unwrap();
        let page = restarted.get_missed_reminders(None, None).await.unwrap();
        assert_eq!(page.missed_count, 1);
        assert_eq!(page.items[0].status, ReminderDeliveryStatusDto::Missed);
        h.clock.set(4000);
        h.restart().process_once().await.unwrap();
        assert_eq!(h.rows().await.len(), 1);
    });
}
/// Verifies same-process resume stays live while a snooze expiring between processes becomes Missed.
#[test]
fn resume_live_and_downtime_snooze_missed() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(2000);
        h.service.process_once().await.unwrap();
        h.clock.set(10000);
        h.service.process_once().await.unwrap();
        let row = h.rows().await.remove(0);
        assert_eq!(row.status, ReminderDeliveryStatusDto::Active);
        h.service
            .snooze_reminder(&row.id, &row.version, 5)
            .await
            .unwrap();
        h.clock.set(400000);
        let restarted = h.restart();
        restarted.process_once().await.unwrap();
        assert_eq!(
            restarted
                .get_missed_reminders(None, None)
                .await
                .unwrap()
                .missed_count,
            1
        );
    });
}
/// Proves dependency failure preserves the checkpoint and keeps startup queries catching up.
#[test]
fn startup_dependency_failure_preserves_checkpoint_until_retry() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(2000);
        h.service.process_once().await.unwrap();
        let checkpoint = h.checkpoint();
        h.clock.set(3000);
        let restarted = h.restart();
        h.deps.fail_occurrences.store(true, Ordering::Release);
        assert_eq!(
            restarted.process_once().await.unwrap_err(),
            ReminderError::DependencyUnavailable
        );
        assert_eq!(h.checkpoint(), checkpoint);
        assert_eq!(
            restarted
                .get_missed_reminders(None, None)
                .await
                .unwrap_err(),
            ReminderError::SchedulerCatchingUp
        );
        h.deps.fail_occurrences.store(false, Ordering::Release);
        restarted.process_once().await.unwrap();
        assert_eq!(
            restarted
                .get_missed_reminders(None, None)
                .await
                .unwrap()
                .missed_count,
            1
        );
    });
}
/// Proves current-definition removal cancels a delivery and removes its bell item.
#[test]
fn removed_context_cancels_delivery_and_cleans_inbox() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(1100);
        h.service.process_once().await.unwrap();
        h.clock.set(1100);
        h.service.process_once().await.unwrap();
        h.deps.contexts.lock().unwrap().clear();
        h.service.process_once().await.unwrap();
        assert_eq!(h.field("status"), "cancelled");
        assert_eq!(
            h.service
                .get_missed_reminders(None, None)
                .await
                .unwrap()
                .missed_count,
            0
        );
        assert!(!h.deps.removes.lock().unwrap().is_empty());
    });
}
/// A one-millisecond saturated query cannot advance the checkpoint and silently lose deliveries.
#[test]
fn saturated_single_instant_and_invalid_candidate_preserve_checkpoint() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.service.process_once().await.unwrap();
        let candidate = h.add(1100);
        *h.deps.candidates.lock().unwrap() = vec![candidate.clone(); 5000];
        h.clock.set(1100);
        let checkpoint = h.checkpoint();
        assert!(h.service.process_once().await.is_err());
        assert!(h.checkpoint() <= 1100);
        assert!(h.checkpoint() >= checkpoint);
        *h.deps.candidates.lock().unwrap() = vec![CalendarReminderOccurrence {
            reminder_id: "invalid".into(),
            ..candidate
        }];
        let checkpoint = h.checkpoint();
        assert!(h.service.process_once().await.is_err());
        assert_eq!(h.checkpoint(), checkpoint);
    });
}
/// Corrupt singleton state fails construction without starting any delivery side effects.
#[test]
fn corrupt_checkpoint_rejects_startup() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.sql("DELETE FROM reminder_scheduler_state");
        let result = ReminderService::with_seams(
            h.inbox.storage.clone(),
            h.inbox.gate.clone(),
            h.clock.clone(),
            h.deps.clone(),
            h.inbox.os.clone(),
            h.events.clone(),
        );
        assert!(matches!(
            result,
            Err(ReminderError::CorruptStoredDelivery { .. })
        ));
    });
}
mod calendar_support;
/// Real Calendar recurrence and timezone projections produce distinct durable reminder identities.
#[test]
fn real_all_day_dst_and_skipped_date_projections_schedule_each_offset() {
    let calendar = calendar_support::Fixture::new();
    // Runs real recurrence expansion while keeping Reminder time and OS completely controlled.
    tauri::async_runtime::block_on(async {
        for (zone, start, end, from, through, expected) in [
            (
                "America/New_York",
                "2026-03-07",
                "2026-03-08",
                "2026-03-06T00:00:00Z",
                "2026-03-11T00:00:00Z",
                6,
            ),
            (
                "Pacific/Apia",
                "2011-12-29",
                "2011-12-30",
                "2011-12-28T00:00:00Z",
                "2012-01-03T00:00:00Z",
                6,
            ),
        ] {
            let event = calendar
                .service
                .create_calendar_event(EventInputDto {
                    title: "All day".into(),
                    description: String::new(),
                    project_id: None,
                    time: EventTimeInputDto::AllDay {
                        start_date: start.into(),
                        end_date_exclusive: end.into(),
                        time_zone_id: zone.into(),
                    },
                    recurrence: EventRecurrenceDto::Daily {
                        end: EventRecurrenceEndDto::AfterCount { count: 3 },
                    },
                    reminder_minutes_before: vec![60, 0],
                })
                .await
                .unwrap();
            let from = chrono::DateTime::parse_from_rfc3339(from)
                .unwrap()
                .timestamp_millis();
            let through = chrono::DateTime::parse_from_rfc3339(through)
                .unwrap()
                .timestamp_millis();
            let candidates: Vec<_> = calendar
                .service
                .reminder_occurrences(from, through, 5000)
                .await
                .unwrap()
                .into_iter()
                .filter(
                    // Restricts this independent scenario to its newly created Calendar definition.
                    |c| c.event_id == event.id,
                )
                .collect();
            assert_eq!(candidates.len(), expected);
            if zone == "Pacific/Apia" {
                assert!(candidates.iter().all(
                    // The deleted local date is skipped while recurrence count remains three valid occurrences.
                    |c| {
                        chrono::DateTime::from_timestamp_millis(c.starts_at_ms)
                            .unwrap()
                            .with_timezone(&chrono_tz::Pacific::Apia)
                            .format("%Y-%m-%d")
                            .to_string()
                            != "2011-12-30"
                    }
                ));
            }
            let h = Harness::new(from).await;
            for candidate in &candidates {
                let context = calendar
                    .service
                    .get_notification_context(&candidate.event_id, &candidate.occurrence_id)
                    .await
                    .unwrap()
                    .unwrap();
                h.deps.contexts.lock().unwrap().push(context);
            }
            *h.deps.candidates.lock().unwrap() = candidates;
            h.service.process_once().await.unwrap();
            h.clock.set(through);
            let service = h.restart();
            service.process_once().await.unwrap();
            let page = service.get_missed_reminders(None, Some(100)).await.unwrap();
            assert_eq!(page.items.len(), expected);
            assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 0);
            let unique: std::collections::HashSet<_> = page
                .items
                .iter()
                .map(
                    // Distinct offsets remain independent within the same occurrence.
                    |d| (&d.occurrence_id, d.minutes_before),
                )
                .collect();
            assert_eq!(unique.len(), expected);
            assert!(h.deps.queries.lock().unwrap().iter().all(
                // Every dependency request remains within Calendar's supported 31-day bound.
                |(from, through)| through - from <= 31 * 86400000
            ));
        }
    });
}
