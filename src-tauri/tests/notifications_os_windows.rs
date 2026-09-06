#![cfg(windows)]
#[path = "support/notifications.rs"]
mod support;
use std::sync::atomic::Ordering;
use support::*;

/// Covers visibility, policy defaults, and every Phase 1 event kind without a real OS toast.
#[test]
fn windows_recording_adapter_eligibility_matrix() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        for observed in [false, true] {
            for disabled in [false, true] {
                for kind in 0..3 {
                    let h = Harness::new().await;
                    h.dependencies.observed.store(observed, Ordering::SeqCst);
                    h.dependencies.disabled.store(disabled, Ordering::SeqCst);
                    let event = match kind {
                        0 => attention("terminal-1", 1),
                        1 => finished("terminal-1", false),
                        _ => finished("terminal-1", true),
                    };
                    h.send(event.clone()).await;
                    h.send(event).await;
                    let eligible = !observed && !disabled;
                    assert_eq!(h.count(), u32::from(eligible));
                    assert_eq!(
                        h.os.calls.lock().unwrap().len(),
                        usize::from(eligible && kind != 1)
                    );
                }
            }
        }
    });
}

/// Proves OS/event failures preserve the committed inbox and do not retry delivery.
#[test]
fn delivery_failure_preserves_inbox_without_retry() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.os.fail.store(true, Ordering::SeqCst);
        h.event_fail.store(true, Ordering::SeqCst);
        let event = attention("terminal-1", 1);
        h.send(event.clone()).await;
        h.send(event).await;
        assert_eq!(h.page().await.unread_count, 1);
        assert_eq!(h.os.calls.lock().unwrap().len(), 1);
        assert_eq!(h.events.lock().unwrap().len(), 1);
    });
}

/// Verifies payload normalization, Unicode limits, and exclusion of source/command metadata.
#[test]
fn os_payload_contains_only_normalized_event_time_labels() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        let mut event = attention("terminal-1", 1);
        event.terminal.title = format!("  Công\n cụ\t{}\u{0001}", "界".repeat(150));
        h.send(event).await;
        let page = h.page().await;
        let calls = h.os.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, page.items[0].title);
        assert_eq!(calls[0].1, "A session");
        assert_eq!(calls[0].0.chars().count(), 120);
        assert!(!calls[0].0.chars().any(char::is_control));
        let serialized = serde_json::to_string(&page).unwrap();
        for private in [
            "sourceKey",
            "sourceId",
            "profileId",
            "latestOutputSequence",
            "terminal-1",
        ] {
            assert!(!serialized.contains(private));
        }
    });
}

/// Proves suppressed visible activity is not backfilled when the session becomes hidden.
#[test]
fn observed_activity_never_backfills_on_visibility_change() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.dependencies.observed.store(true, Ordering::SeqCst);
        let event = attention("terminal-1", 1);
        h.send(event.clone()).await;
        h.dependencies.observed.store(false, Ordering::SeqCst);
        h.send(event).await;
        assert_eq!(h.count(), 0);
        assert!(h.os.calls.lock().unwrap().is_empty());
    });
}
