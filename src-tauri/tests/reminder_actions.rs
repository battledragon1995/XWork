#[path = "support/reminders.rs"]
mod reminders;
use reminders::*;
use xwork_lib::calendar::*;

/// Validates narrow main-window authorization and malformed action inputs without writes.
#[test]
fn command_authorization_and_validation() {
    assert!(authorize_reminder_caller("main").is_ok());
    for label in ["quick-note", "main-child", ""] {
        assert_eq!(
            authorize_reminder_caller(label),
            Err(ReminderError::UnauthorizedWindow)
        );
    }
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(1100);
        h.service.process_once().await.unwrap();
        h.clock.set(1100);
        h.service.process_once().await.unwrap();
        let row = h.rows().await.remove(0);
        assert_eq!(
            h.service
                .snooze_reminder(&row.id, &row.version, 6)
                .await
                .unwrap_err(),
            ReminderError::InvalidSnoozeMinutes
        );
        assert_eq!(
            h.service.dismiss_reminder(&row.id, "01").await.unwrap_err(),
            ReminderError::InvalidVersion
        );
        assert_eq!(
            h.service
                .get_missed_reminders(None, Some(0))
                .await
                .unwrap_err(),
            ReminderError::InvalidLimit { min: 1, max: 100 }
        );
        assert_eq!(
            h.service
                .get_missed_reminders(
                    Some(ReminderCursorDto {
                        id: row.id.clone(),
                        original_due_at_ms: "01".into()
                    }),
                    None
                )
                .await
                .unwrap_err(),
            ReminderError::InvalidCursor
        );
        assert_eq!(h.rows().await[0].version, row.version);
    });
}
/// Open preserves Missed and Dismiss uses the exact optimistic version only once.
#[test]
fn open_missed_does_not_dismiss_and_stale_dismiss_conflicts() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(2000);
        h.service.process_once().await.unwrap();
        h.clock.set(3000);
        let service = h.restart();
        service.process_once().await.unwrap();
        let before = service.get_missed_reminders(None, None).await.unwrap();
        let row = &before.items[0];
        service.open_reminder(&row.id).await.unwrap();
        assert_eq!(
            service.get_missed_reminders(None, None).await.unwrap(),
            before
        );
        assert_eq!(
            service
                .snooze_reminder(&row.id, &row.version, 5)
                .await
                .unwrap_err(),
            ReminderError::ActionNotAllowed
        );
        assert_eq!(
            service
                .dismiss_reminder(&row.id, &row.version)
                .await
                .unwrap()
                .missed_count,
            0
        );
        assert_eq!(
            service
                .dismiss_reminder(&row.id, &row.version)
                .await
                .unwrap_err(),
            ReminderError::DeliveryChanged
        );
    });
}
/// Snooze always uses current time and the supported delays, then reactivates the same identity.
#[test]
fn snooze_uses_now_and_increments_generation() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        for minutes in [5, 10, 30] {
            let h = Harness::new(1000).await;
            h.add(1100);
            h.service.process_once().await.unwrap();
            h.clock.set(1100);
            h.service.process_once().await.unwrap();
            let row = h.rows().await.remove(0);
            h.clock.set(5000);
            let result = h
                .service
                .snooze_reminder(&row.id, &row.version, minutes)
                .await
                .unwrap();
            let due = 5000 + i64::from(minutes) * 60000;
            assert_eq!(result.delivery.snoozed_until_ms, Some(due.to_string()));
            h.clock.set(due);
            h.service.process_once().await.unwrap();
            let fired = h.rows().await.remove(0);
            assert_eq!(fired.id, row.id);
            assert_eq!(fired.status, ReminderDeliveryStatusDto::Active);
            assert_eq!(h.field("generation"), "2");
        }
    });
}
/// Concurrent actions with the same version produce exactly one successful durable mutation.
#[test]
fn simultaneous_same_version_actions_commit_once() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(1100);
        h.service.process_once().await.unwrap();
        h.clock.set(1100);
        h.service.process_once().await.unwrap();
        let row = h.rows().await.remove(0);
        let service = h.service.clone();
        let id = row.id.clone();
        let version = row.version.clone();
        // Races two owned action futures at the optimistic mutation boundary.
        let other =
            tauri::async_runtime::spawn(
                async move { service.dismiss_reminder(&id, &version).await },
            );
        let local = h.service.snooze_reminder(&row.id, &row.version, 5).await;
        let other = other.await.unwrap();
        assert_ne!(local.is_ok(), other.is_ok());
        assert!(
            matches!(local, Err(ReminderError::DeliveryChanged))
                || matches!(other, Err(ReminderError::DeliveryChanged))
        );
    });
}
/// Dismiss-all changes Missed only and an empty repeat preserves sequence.
#[test]
fn dismiss_all_missed_is_atomic_and_empty_repeat_is_noop() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(2000);
        h.service.process_once().await.unwrap();
        h.clock.set(3000);
        let service = h.restart();
        service.process_once().await.unwrap();
        let changed = service.dismiss_all_missed_reminders().await.unwrap();
        assert_eq!(changed.missed_count, 0);
        assert_eq!(
            service.dismiss_all_missed_reminders().await.unwrap(),
            changed
        );
    });
}
/// Overflowing current time cannot partially persist a snooze action.
#[test]
fn snooze_clock_overflow_does_not_write() {
    // Runs the isolated scenario with explicit clock advancement.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(1000).await;
        h.add(1100);
        h.service.process_once().await.unwrap();
        h.clock.set(1100);
        h.service.process_once().await.unwrap();
        let row = h.rows().await.remove(0);
        h.clock.set(i64::MAX - 1000);
        assert_eq!(
            h.service
                .snooze_reminder(&row.id, &row.version, 30)
                .await
                .unwrap_err(),
            ReminderError::ClockOutOfRange
        );
        assert_eq!(h.rows().await[0].version, row.version);
    });
}
