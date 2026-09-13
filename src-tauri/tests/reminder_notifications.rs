#[path = "support/reminders.rs"]
mod support;
use std::sync::atomic::Ordering;
use support::*;
use xwork_lib::{calendar::*, notifications::NotificationKindDto};

/// Delivers one live bell and OS attempt despite duplicate cycles at the same or later instants.
#[test]
fn live_delivery_syncs_bell_and_attempts_os_once() {
    // Advances the explicit due boundary without launching a scheduler worker.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(100).await;
        h.add(200);
        assert_eq!(h.service.process_once().await.unwrap(), 200);
        assert!(h.rows().await.is_empty());
        h.clock.set(200);
        h.service.process_once().await.unwrap();
        assert_eq!(h.rows().await[0].status, ReminderDeliveryStatusDto::Active);
        assert_eq!(h.field("notification_sync"), "synced");
        assert_eq!(h.field("os_state"), "attempted");
        assert_eq!(h.inbox.page().await.items[0].title, "Planning starts now");
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
        h.service.process_once().await.unwrap();
        h.clock.set(300);
        h.service.process_once().await.unwrap();
        assert_eq!(h.deps.upserts.lock().unwrap().len(), 1);
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
        assert_eq!(h.events.0.lock().unwrap().len(), 1);
    });
}

/// Turns downtime due instants into Missed bell items without an OS catch-up burst.
#[test]
fn restart_catchup_creates_missed_bell_without_os() {
    // Reconstructs startup after advancing over a future reminder's due instant.
    tauri::async_runtime::block_on(async {
        let mut h = Harness::new(100).await;
        h.add(200);
        h.service.process_once().await.unwrap();
        h.clock.set(300);
        h.service = h.restart();
        h.service.process_once().await.unwrap();
        let missed = h.service.get_missed_reminders(None, None).await.unwrap();
        assert_eq!(missed.missed_count, 1);
        assert_eq!(missed.items[0].status, ReminderDeliveryStatusDto::Missed);
        let inbox = h.inbox.page().await;
        assert_eq!(
            inbox.items[0].kind,
            NotificationKindDto::EventReminderMissed
        );
        assert_eq!(inbox.items[0].title, "Planning reminder was missed");
        assert!(h.inbox.os.calls.lock().unwrap().is_empty());
        h.service = h.restart();
        h.service.process_once().await.unwrap();
        assert_eq!(h.deps.upserts.lock().unwrap().len(), 1);
        assert_eq!(h.inbox.count(), 1);
    });
}

/// Suppresses OS only for the exact event detail in a visible main window, keeping every bell.
#[test]
fn exact_visible_detail_suppresses_os_but_keeps_bell() {
    // Enumerates native visibility and exact-event combinations with isolated state per case.
    tauri::async_runtime::block_on(async {
        for (main_visible, exact, expected_os) in
            [(true, true, 0), (false, true, 1), (true, false, 1)]
        {
            let h = Harness::new(100).await;
            h.add(200);
            h.service.process_once().await.unwrap();
            h.service
                .set_visible_calendar_event(VisibleCalendarEventInputDto::Show {
                    view_token: TOKEN.into(),
                    event_id: if exact {
                        EVENT
                    } else {
                        "00000000-0000-4000-8000-000000000099"
                    }
                    .into(),
                    occurrence_id: OCCURRENCE.into(),
                })
                .await
                .unwrap();
            h.service.observe_main_window_visibility(main_visible);
            h.clock.set(200);
            h.service.process_once().await.unwrap();
            assert_eq!(h.inbox.count(), 1);
            assert_eq!(h.inbox.os.calls.lock().unwrap().len(), expected_os);
            assert_eq!(
                h.field("os_state"),
                if expected_os == 0 {
                    "suppressed_visible"
                } else {
                    "attempted"
                }
            );
            h.service.observe_main_window_visibility(false);
            h.service.process_once().await.unwrap();
            assert_eq!(h.inbox.os.calls.lock().unwrap().len(), expected_os);
        }
    });
}

/// Retries a failed bell at controlled exponential deadlines and attempts OS only after sync.
#[test]
fn failed_inbox_retries_with_controlled_backoff() {
    // Drives the initial one-second and subsequent two-second retry boundaries explicitly.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(100).await;
        h.add(200);
        h.service.process_once().await.unwrap();
        h.deps.fail_upsert.store(true, Ordering::SeqCst);
        h.clock.set(200);
        assert_eq!(h.service.process_once().await.unwrap(), 1200);
        assert_eq!(h.field("notification_retry_count"), "1");
        assert!(h.inbox.os.calls.lock().unwrap().is_empty());
        h.clock.set(1199);
        h.service.process_once().await.unwrap();
        assert_eq!(h.deps.upserts.lock().unwrap().len(), 1);
        h.clock.set(1200);
        assert_eq!(h.service.process_once().await.unwrap(), 3200);
        assert_eq!(h.field("notification_retry_count"), "2");
        h.deps.fail_upsert.store(false, Ordering::SeqCst);
        h.clock.set(3200);
        h.service.process_once().await.unwrap();
        assert_eq!(h.deps.upserts.lock().unwrap().len(), 3);
        assert_eq!(h.inbox.count(), 1);
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
        assert_eq!(h.field("notification_retry_count"), "0");
    });
}

/// Applies the latest disabled policy before retry and permanently suppresses an unsynced live row.
#[test]
fn settings_off_before_retry_suppresses_without_later_backfill() {
    // Disables notifications during the durable retry gap without changing Calendar definitions.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(100).await;
        h.add(200);
        h.service.process_once().await.unwrap();
        h.deps.fail_upsert.store(true, Ordering::SeqCst);
        h.clock.set(200);
        h.service.process_once().await.unwrap();
        h.deps.enabled.store(false, Ordering::SeqCst);
        h.clock.set(1200);
        h.service.process_once().await.unwrap();
        assert_eq!(
            h.rows().await[0].status,
            ReminderDeliveryStatusDto::Suppressed
        );
        assert_eq!(h.field("notification_sync"), "none");
        assert_eq!(h.field("os_state"), "none");
        assert_eq!(h.inbox.count(), 0);
        h.deps.enabled.store(true, Ordering::SeqCst);
        h.deps.fail_upsert.store(false, Ordering::SeqCst);
        h.clock.set(2200);
        h.service.process_once().await.unwrap();
        assert_eq!(h.deps.upserts.lock().unwrap().len(), 1);
        assert_eq!(h.inbox.count(), 0);
        assert!(h.inbox.os.calls.lock().unwrap().is_empty());
    });
}

/// Leaves synced delivery state intact when the user deletes its bell row, including after restart.
#[test]
fn generic_inbox_delete_does_not_dismiss_or_recreate_synced_delivery() {
    // Uses the real Notifications delete command boundary behind the scheduler dependency.
    tauri::async_runtime::block_on(async {
        let mut h = Harness::new(100).await;
        h.add(200);
        h.service.process_once().await.unwrap();
        h.clock.set(200);
        h.service.process_once().await.unwrap();
        let id = h.inbox.page().await.items[0].id.clone();
        h.inbox.service.delete_notification(&id).await.unwrap();
        h.clock.set(300);
        h.service.process_once().await.unwrap();
        assert_eq!(h.rows().await[0].status, ReminderDeliveryStatusDto::Active);
        assert_eq!(h.field("notification_sync"), "synced");
        h.service = h.restart();
        h.service.process_once().await.unwrap();
        assert_eq!(h.inbox.count(), 0);
        assert_eq!(h.deps.upserts.lock().unwrap().len(), 1);
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
    });
}

/// Preserves a successful inbox commit and read state across a crash before outbox acknowledgement.
#[test]
fn inbox_commit_crash_retry_keeps_read_state_and_single_identity() {
    // Seeds the exact gap using a failed intake followed by an unacknowledged real inbox commit.
    tauri::async_runtime::block_on(async {
        let mut h = Harness::new(100).await;
        h.add(200);
        h.service.process_once().await.unwrap();
        h.deps.fail_upsert.store(true, Ordering::SeqCst);
        h.clock.set(200);
        h.service.process_once().await.unwrap();
        let pending = h.deps.upserts.lock().unwrap()[0].clone();
        h.inbox.service.upsert_reminder(pending).await.unwrap();
        let id = h.inbox.page().await.items[0].id.clone();
        h.inbox.service.mark_notification_read(&id).await.unwrap();
        let before = h.inbox.page().await;
        h.deps.fail_upsert.store(false, Ordering::SeqCst);
        h.clock.set(1200);
        h.service = h.restart();
        h.service.process_once().await.unwrap();
        assert_eq!(h.inbox.page().await, before);
        assert_eq!(h.field("notification_sync"), "synced");
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
    });
}

/// Never retries a persisted OS attempt after a platform failure or service reconstruction.
#[test]
fn attempted_os_failure_is_not_retried_after_restart() {
    // Records a failing native adapter call while retaining the successful bell commit.
    tauri::async_runtime::block_on(async {
        let mut h = Harness::new(100).await;
        h.add(200);
        h.service.process_once().await.unwrap();
        h.inbox.os.fail.store(true, Ordering::SeqCst);
        h.clock.set(200);
        h.service.process_once().await.unwrap();
        assert_eq!(h.field("os_state"), "attempted");
        assert_eq!(h.inbox.count(), 1);
        h.inbox.os.fail.store(false, Ordering::SeqCst);
        h.clock.set(500);
        h.service = h.restart();
        h.service.process_once().await.unwrap();
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
        assert_eq!(h.deps.upserts.lock().unwrap().len(), 1);
    });
}

/// Bounds a test hang while all scheduler progress comes from explicit fixture signals.
async fn bounded<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(std::time::Duration::from_secs(5), future)
        .await
        .expect("controlled worker did not acknowledge the requested transition")
}

/// Starts a single worker and joins its pending controlled timer on true Quit.
#[test]
fn worker_start_is_single_and_quit_cancels_waiting_clock() {
    // Uses clock registration acknowledgement to prove the worker reached its idle wait.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(100).await;
        h.add(200);
        let (settings, receiver) =
            tokio::sync::watch::channel(xwork_lib::settings::SettingsSnapshot::defaults());
        h.service.start(receiver).await;
        bounded(h.clock.wait_for_sleeps(1)).await;
        h.service.start(settings.subscribe()).await;
        assert_eq!(h.clock.active_sleeps.load(Ordering::SeqCst), 1);
        h.clock.set(200);
        bounded(h.clock.wait_for_sleeps(2)).await;
        assert_eq!(h.inbox.count(), 1);
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
        bounded(h.service.shutdown_for_quit()).await.unwrap();
        assert_eq!(h.clock.active_sleeps.load(Ordering::SeqCst), 0);
        assert_eq!(
            h.service.process_once().await,
            Err(ReminderError::Unavailable)
        );
        h.clock.set(300);
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
    });
}

/// Wakes the worker from Settings watch before its due deadline and applies the current policy.
#[test]
fn settings_watch_wakes_worker_before_due_without_advancing_clock() {
    // Separates the committed snapshot signal from the controlled wall-clock due signal.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(100).await;
        h.add(200);
        let (settings, receiver) =
            tokio::sync::watch::channel(xwork_lib::settings::SettingsSnapshot::defaults());
        h.service.start(receiver).await;
        bounded(h.clock.wait_for_sleeps(1)).await;
        h.deps.enabled.store(false, Ordering::SeqCst);
        let mut disabled = settings.borrow().clone();
        disabled.revision += 1;
        disabled.notifications.event_reminders_enabled = false;
        settings.send_replace(disabled);
        bounded(h.clock.wait_for_sleeps(2)).await;
        assert_eq!(h.clock.now_ms(), 100);
        assert!(h.rows().await.is_empty());
        assert_eq!(h.checkpoint(), 101);
        h.clock.set(200);
        bounded(h.clock.wait_for_sleeps(3)).await;
        assert_eq!(
            h.rows().await[0].status,
            ReminderDeliveryStatusDto::Suppressed
        );
        assert_eq!(h.inbox.count(), 0);
        assert!(h.inbox.os.calls.lock().unwrap().is_empty());
        bounded(h.service.shutdown_for_quit()).await.unwrap();
        assert_eq!(h.clock.active_sleeps.load(Ordering::SeqCst), 0);
    });
}

/// Quiesces admission blocked behind maintenance and resumes one worker without leaking timers.
#[test]
fn reset_pause_cancels_blocked_admission_and_resume_keeps_one_timer() {
    // Stops a due query at an owner boundary where maintenance can acquire exclusive ownership.
    tauri::async_runtime::block_on(async {
        let h = Harness::new(100).await;
        h.add(200);
        let (_settings, receiver) =
            tokio::sync::watch::channel(xwork_lib::settings::SettingsSnapshot::defaults());
        h.service.start(receiver).await;
        bounded(h.clock.wait_for_sleeps(1)).await;
        let (entered, observed) = tokio::sync::oneshot::channel();
        let (resume_query, paused_query) = tokio::sync::oneshot::channel();
        *h.deps.query_pause.lock().unwrap() = Some((entered, paused_query));
        h.clock.set(200);
        bounded(observed).await.unwrap();
        let maintenance = bounded(h.inbox.gate.write_permit()).await;
        bounded(h.service.pause_for_reset()).await.unwrap();
        // Reset cancels the in-flight owner future even while its dependency remains blocked.
        assert!(resume_query.send(()).is_err());
        bounded(h.clock.wait_for_sleeps(2)).await;
        assert_eq!(h.checkpoint(), 101);
        assert_eq!(h.inbox.count(), 0);
        assert_eq!(h.clock.active_sleeps.load(Ordering::SeqCst), 1);
        drop(maintenance);
        h.clock.set(300);
        h.service.resume_after_reset(false);
        bounded(h.clock.wait_for_sleeps(3)).await;
        assert_eq!(h.rows().await[0].status, ReminderDeliveryStatusDto::Active);
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
        assert_eq!(h.clock.active_sleeps.load(Ordering::SeqCst), 1);
        bounded(h.service.pause_for_reset()).await.unwrap();
        bounded(h.clock.wait_for_sleeps(4)).await;
        h.service.resume_after_reset(false);
        bounded(h.clock.wait_for_sleeps(5)).await;
        assert_eq!(h.clock.active_sleeps.load(Ordering::SeqCst), 1);
        assert_eq!(h.inbox.os.calls.lock().unwrap().len(), 1);
        bounded(h.service.shutdown_for_quit()).await.unwrap();
        assert_eq!(h.clock.active_sleeps.load(Ordering::SeqCst), 0);
    });
}
