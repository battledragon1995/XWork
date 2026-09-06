use tempfile::TempDir;
use xwork_lib::storage::{Storage, StorageError};
#[path = "support/notifications.rs"]
mod support;
use serde_json::{Value, json};
use std::sync::{Arc, atomic::Ordering};
use support::*;
use tauri::WebviewWindowBuilder;

/// Captures the real Terminal manager's producer callbacks without creating a process.
#[derive(Default)]
struct CapturedPty(std::sync::Mutex<Option<PtyCallbacks>>);
impl PtyFactory for CapturedPty {
    /// Retains callbacks for explicit output/final transitions driven by the test.
    fn spawn(
        &self,
        _: ResolvedCliProfile,
        _: std::path::PathBuf,
        _: PtySizeDto,
        callbacks: PtyCallbacks,
    ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
        *self.0.lock().unwrap() = Some(callbacks);
        Ok(Arc::new(FakeProcess(std::sync::atomic::AtomicBool::new(
            true,
        ))))
    }
}
/// Provides in-memory control methods for the fake PTY.
struct FakeProcess(std::sync::atomic::AtomicBool);
impl PtyProcess for FakeProcess {
    /// Accepts test input without sending it to the OS.
    fn write(&self, _: &[u8]) -> Result<(), TerminalError> {
        Ok(())
    }
    /// Accepts test resize without native resources.
    fn resize(&self, _: PtySizeDto) -> Result<(), TerminalError> {
        Ok(())
    }
    /// Completes synthetic process cleanup.
    fn terminate(&self) -> Result<(), TerminalError> {
        self.0.store(false, Ordering::SeqCst);
        Ok(())
    }
    /// Reports the synthetic process as controllable until owner cleanup.
    fn is_alive(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}
/// Observes production app fan-out while simulating a failed downstream consumer.
struct ObservedAppSink {
    app_sink: xwork_lib::app::data_runtime::TauriTerminalEventSink<tauri::test::MockRuntime>,
    observed: tokio::sync::mpsc::UnboundedSender<TerminalStateChangedDto>,
}
impl TerminalEventSink for ObservedAppSink {
    /// Calls the production sink, acknowledges publication, and injects a downstream failure.
    fn publish(&self, event: TerminalStateChangedDto) -> Result<(), TerminalError> {
        let result = self.app_sink.publish_with_emitter(
            event.clone(),
            // Injects failure at the same frontend boundary used by production publish.
            |_| Err(TerminalError::StreamAttachFailed),
        );
        let _ = self.observed.send(event);
        result
    }
}

/// Drives BEL and natural exit through real Terminal code and the production application sink.
#[test]
fn real_terminal_producer_reaches_notifications_without_frontend_listener() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        let app = tauri::test::mock_builder()
            .manage(h.service.clone())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
        let factory = Arc::new(CapturedPty::default());
        let sink = Arc::new(ObservedAppSink {
            app_sink: xwork_lib::app::data_runtime::TauriTerminalEventSink::new(
                app.handle().clone(),
            ),
            observed: send,
        });
        let manager = TerminalManager::new(
            Arc::new(CommandDependencies {
                attaches: std::sync::atomic::AtomicUsize::new(0),
            }),
            sink,
            factory.clone(),
        );
        let output = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let output_copy = output.clone();
        let terminal = manager
            .start_terminal(
                "session-1",
                "tab-1",
                "pane-1",
                PtySizeDto {
                    columns: 80,
                    rows: 24,
                },
                // Records output delivery independently of notification state events.
                tauri::ipc::Channel::new(move |_| {
                    output_copy.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                }),
            )
            .await
            .unwrap();
        let callbacks = factory.0.lock().unwrap().take().unwrap();
        (callbacks.output)(b"ordinary output\x07".to_vec());
        loop {
            let event = tokio::time::timeout(std::time::Duration::from_secs(5), receive.recv())
                .await
                .unwrap()
                .unwrap();
            if event.change == TerminalStateChangeKindDto::AttentionChanged {
                break;
            }
        }
        h.service.flush().await.unwrap();
        assert_eq!(h.page().await.unread_count, 1);
        assert!(output.load(Ordering::SeqCst) > 0);
        (callbacks.exited)(Ok(Some(1)));
        (callbacks.eof)();
        loop {
            let event = tokio::time::timeout(std::time::Duration::from_secs(5), receive.recv())
                .await
                .unwrap()
                .unwrap();
            if event.change == TerminalStateChangeKindDto::ProcessChanged
                && event.terminal.state == TerminalProcessStateDto::Failed
            {
                break;
            }
        }
        h.service.flush().await.unwrap();
        assert_eq!(h.page().await.items.len(), 2);
        assert_eq!(h.page().await.unread_count, 1);
        assert_eq!(
            manager.get_terminal(&terminal.id).await.unwrap().state,
            TerminalProcessStateDto::Failed
        );
        manager.shutdown_remaining().await.unwrap();
        h.service.flush().await.unwrap();
        assert_eq!(h.count(), 0);
    });
}
use xwork_lib::{
    notifications::*,
    sessions::{SessionChangeKindDto, SessionRuntimeEventDto},
    terminal::*,
};

/// Verifies the notification migration is part of normal storage startup.
#[test]
fn notification_schema_is_version_five() {
    let dir = TempDir::new().unwrap();
    let storage = Storage::open(dir.path()).unwrap();
    let version = storage
        .with_connection::<_, StorageError>(
            // Reads only the isolated schema marker.
            |connection| {
                Ok(connection
                    // Decodes only the requested database projection.
                    .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                    .unwrap())
            },
        )
        .unwrap();
    assert_eq!(version, 6);
}

/// Invokes the real Tauri wrapper rather than bypassing window authorization.
fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    // Projects the verified result into the required output shape.
    .map(|body| body.deserialize().unwrap())
}

/// Exercises all six production handlers from authorized and unauthorized windows.
#[test]
fn six_ipc_handlers_authorize_before_access_and_round_trip() {
    let h = tauri::async_runtime::block_on(Harness::new());
    tauri::async_runtime::block_on(h.send(attention("terminal-1", 1)));
    let app = tauri::test::mock_builder()
        .manage(h.service.clone())
        .invoke_handler(tauri::generate_handler![
            xwork_lib::notifications::commands::get_notifications,
            xwork_lib::notifications::commands::mark_notification_read,
            xwork_lib::notifications::commands::mark_all_notifications_read,
            xwork_lib::notifications::commands::delete_notification,
            xwork_lib::notifications::commands::clear_read_notifications,
            xwork_lib::notifications::commands::open_notification
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let other = WebviewWindowBuilder::new(&app, "quick-note", Default::default())
        .build()
        .unwrap();
    let calls = h.dependencies.calls.load(Ordering::SeqCst);
    for command in [
        "get_notifications",
        "mark_notification_read",
        "mark_all_notifications_read",
        "delete_notification",
        "clear_read_notifications",
        "open_notification",
    ] {
        assert_eq!(
            invoke(
                &other,
                command,
                json!({"notificationId":"invalid","cursor":null,"limit":0})
            ),
            Err(json!({"code":"unauthorized_window"}))
        );
    }
    assert_eq!(h.dependencies.calls.load(Ordering::SeqCst), calls);
    assert_eq!(h.count(), 1);
    let page = invoke(&main, "get_notifications", json!({})).unwrap();
    let id = page["items"][0]["id"].as_str().unwrap();
    assert_eq!(
        invoke(&main, "open_notification", json!({"notificationId":id})).unwrap()["target"]["paneId"],
        "pane-1"
    );
    assert_eq!(
        invoke(
            &main,
            "mark_notification_read",
            json!({"notificationId":id})
        )
        .unwrap()["affectedCount"],
        0
    );
    assert_eq!(
        invoke(&main, "mark_all_notifications_read", json!({})).unwrap()["affectedCount"],
        0
    );
    assert_eq!(
        invoke(&main, "clear_read_notifications", json!({})).unwrap()["affectedCount"],
        1
    );
    tauri::async_runtime::block_on(h.send(finished("terminal-2", true)));
    let page = invoke(&main, "get_notifications", json!({})).unwrap();
    assert_eq!(
        invoke(
            &main,
            "delete_notification",
            json!({"notificationId":page["items"][0]["id"]})
        )
        .unwrap()["affectedCount"],
        1
    );
    assert_eq!(
        invoke(&main, "delete_notification", json!({"notificationId":id})),
        Err(json!({"code":"notification_not_found"}))
    );
}

/// Verifies a conflicting version-five object rolls back migration without advancing the marker.
#[test]
fn migration_failure_retains_version_four_without_partial_indexes() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join(Storage::DATABASE_FILE_NAME);
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("PRAGMA user_version=4;CREATE TABLE notifications(id TEXT);")
        .unwrap();
    drop(db);
    assert!(Storage::open(dir.path()).is_err());
    let db = rusqlite::Connection::open(path).unwrap();
    assert_eq!(
        // Decodes only the requested database projection.
        db.pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .unwrap(),
        4
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'idx_notifications_%'",
            [],
            // Decodes only the requested database projection.
            |row| row.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
}

/// Proves ingestion dedupes even after deletion and re-arms only after attention clears.
#[test]
fn attention_dedupe_survives_user_deletion() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        let event = attention("terminal-1", 1);
        h.send(event.clone()).await;
        let first = h.page().await;
        assert_eq!(first.unread_count, 1);
        assert_eq!(first.revision, "1");
        h.send(event.clone()).await;
        assert_eq!(h.page().await.revision, "1");
        h.service
            .delete_notification(&first.items[0].id)
            .await
            .unwrap();
        h.send(event).await;
        assert_eq!(h.count(), 0);
        h.send(attention("terminal-1", 2)).await;
        assert_eq!(h.count(), 0);
        let mut cleared = attention("terminal-1", 2);
        cleared.terminal.needs_attention = false;
        h.send(cleared).await;
        h.send(attention("terminal-1", 3)).await;
        assert_eq!(h.page().await.unread_count, 1);
        assert_eq!(h.os.calls.lock().unwrap().len(), 2);
    });
}

/// Proves final insertion resolves earlier attention atomically and never redelivers a deleted final.
#[test]
fn final_transition_reads_prompt_and_dedupes_after_clear() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.send(attention("terminal-1", 1)).await;
        h.send(finished("terminal-1", false)).await;
        let page = h.page().await;
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.unread_count, 1);
        assert_eq!(page.revision, "2");
        assert_eq!(h.events.lock().unwrap().len(), 2);
        assert_eq!(h.os.calls.lock().unwrap().len(), 1);
        h.service.mark_all_notifications_read().await.unwrap();
        h.service.clear_read_notifications().await.unwrap();
        h.send(finished("terminal-1", false)).await;
        assert_eq!(h.count(), 0);
    });
}

/// Covers timestamp ties, canonical cursors and stable pagination through concurrent row changes.
#[test]
fn keyset_pagination_and_validation() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        for index in 1..=4 {
            h.send(finished(&format!("terminal-{index}"), false)).await;
        }
        let page = h.service.get_notifications(None, Some(2)).await.unwrap();
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.unread_count, 4);
        assert!(page.items[0].id > page.items[1].id);
        h.service
            .delete_notification(&page.items[0].id)
            .await
            .unwrap();
        h.send(finished("terminal-5", false)).await;
        let next = h
            .service
            .get_notifications(page.next_cursor, Some(2))
            .await
            .unwrap();
        assert_eq!(next.items.len(), 2);
        assert!(next.next_cursor.is_none());
        assert!(next.items[0].id < page.items[1].id);
        assert!(matches!(
            h.service.get_notifications(None, Some(0)).await,
            Err(NotificationError::InvalidLimit { .. })
        ));
        assert!(matches!(
            h.service.get_notifications(None, Some(101)).await,
            Err(NotificationError::InvalidLimit { .. })
        ));
        for time in ["01", "-1", "9223372036854775808", "1.0"] {
            assert_eq!(
                h.service
                    .get_notifications(
                        Some(NotificationCursorDto {
                            created_at_ms: time.into(),
                            id: page.items[1].id.clone()
                        }),
                        None
                    )
                    .await,
                Err(NotificationError::InvalidCursor)
            );
        }
        assert_eq!(
            h.service.mark_notification_read("bad").await,
            Err(NotificationError::InvalidNotificationId)
        );
    });
}

/// Verifies mutation no-ops preserve revisions and read timestamps clamp a backward clock.
#[test]
fn read_clear_and_clock_rollback() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.send(attention("terminal-1", 1)).await;
        let id = h.page().await.items[0].id.clone();
        h.clock.store(1, Ordering::SeqCst);
        let changed = h.service.mark_notification_read(&id).await.unwrap();
        assert_eq!(changed.affected_count, 1);
        let noop = h.service.mark_notification_read(&id).await.unwrap();
        assert_eq!(noop.affected_count, 0);
        assert_eq!(changed.revision, noop.revision);
        assert_eq!(h.page().await.items[0].read_at_ms.as_deref(), Some("100"));
        assert_eq!(
            h.service
                .mark_all_notifications_read()
                .await
                .unwrap()
                .affected_count,
            0
        );
        h.send(finished("terminal-2", true)).await;
        assert_eq!(
            h.service
                .clear_read_notifications()
                .await
                .unwrap()
                .affected_count,
            1
        );
        assert_eq!(h.page().await.unread_count, 1);
        assert_eq!(
            h.service
                .clear_read_notifications()
                .await
                .unwrap()
                .affected_count,
            0
        );
    });
}

/// Proves dependency and SQL failures preserve unread state and permit transition retry.
#[test]
fn failures_rollback_without_poisoning_dedupe_or_terminal() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        let event = attention("terminal-1", 1);
        h.dependencies.fail.store(true, Ordering::SeqCst);
        h.send(event.clone()).await;
        assert_eq!(h.count(), 0);
        h.dependencies.fail.store(false, Ordering::SeqCst);
        h.sql("CREATE TRIGGER fail_insert BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'fixture'); END;");
        h.send(event.clone()).await;
        assert_eq!(h.page().await.revision, "0");
        assert!(h.events.lock().unwrap().is_empty());
        assert!(h.os.calls.lock().unwrap().is_empty());
        h.sql("DROP TRIGGER fail_insert");
        h.send(event).await;
        let id = h.page().await.items[0].id.clone();
        h.sql("CREATE TRIGGER fail_update BEFORE UPDATE ON notifications BEGIN SELECT RAISE(ABORT,'fixture'); END;");
        assert_eq!(
            h.service.mark_notification_read(&id).await,
            Err(NotificationError::PersistenceFailed)
        );
        assert_eq!(h.page().await.revision, "1");
        assert_eq!(h.page().await.unread_count, 1);
    });
}

/// Covers exact target rejection without prematurely marking the notification read.
#[test]
fn open_validates_target_and_does_not_route() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.send(attention("terminal-1", 1)).await;
        let id = h.page().await.items[0].id.clone();
        h.dependencies.target_missing.store(true, Ordering::SeqCst);
        assert_eq!(
            h.service.open_notification(&id).await,
            Err(NotificationError::TargetUnavailable)
        );
        assert_eq!(h.page().await.unread_count, 1);
        h.dependencies.target_missing.store(false, Ordering::SeqCst);
        h.dependencies.fail.store(true, Ordering::SeqCst);
        assert_eq!(
            h.service.open_notification(&id).await,
            Err(NotificationError::DependencyUnavailable)
        );
        h.dependencies.fail.store(false, Ordering::SeqCst);
        let opened = h.service.open_notification(&id).await.unwrap();
        assert_eq!(opened.state.unread_count, 0);
        let json = serde_json::to_value(opened.target).unwrap();
        assert_eq!(json["projectId"], PROJECT);
        assert_eq!(json["sessionId"], "session-1");
        assert!(json.get("sourceId").is_none());
    });
}

/// Proves cleanup can win while Open awaits owner validation without recreating a row.
#[test]
fn open_cleanup_race_returns_not_found_without_locking_owner_await() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.send(attention("terminal-1", 1)).await;
        let id = h.page().await.items[0].id.clone();
        let (entered, observed) = tokio::sync::oneshot::channel();
        let (resume, paused) = tokio::sync::oneshot::channel();
        *h.dependencies.target_pause.lock().unwrap() = Some((entered, paused));
        let service = h.service.clone();
        let open_id = id.clone();
        let open =
            // Awaits owner work without retaining a calling state borrow.
            tauri::async_runtime::spawn(async move { service.open_notification(&open_id).await });
        observed.await.unwrap();
        h.service.delete_notification(&id).await.unwrap();
        resume.send(()).unwrap();
        assert_eq!(
            open.await.unwrap(),
            Err(NotificationError::NotificationNotFound)
        );
        assert_eq!(h.count(), 0);
    });
}

/// Proves close and session deletion remove stale rows while ordinary stream changes do not insert.
#[test]
fn runtime_cleanup_and_ignored_sources() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        let mut ordinary = attention("terminal-1", 1);
        ordinary.change = TerminalStateChangeKindDto::StreamDetached;
        h.send(ordinary.clone()).await;
        assert_eq!(h.count(), 0);
        h.send(attention("terminal-1", 1)).await;
        ordinary.change = TerminalStateChangeKindDto::Disposed;
        h.send(ordinary).await;
        assert_eq!(h.count(), 0);
        h.dependencies.target_missing.store(true, Ordering::SeqCst);
        h.send(finished("terminal-1", false)).await;
        assert_eq!(h.count(), 0);
        h.dependencies.target_missing.store(false, Ordering::SeqCst);
        h.send(attention("terminal-2", 1)).await;
        h.service.observe_session_runtime(SessionRuntimeEventDto {
            revision: "2".into(),
            change: SessionChangeKindDto::Deleted,
            project_id: PROJECT.into(),
            session_id: "session-1".into(),
            summary: None,
        });
        h.service.flush().await.unwrap();
        assert_eq!(h.count(), 0);
        let mut killed = finished("terminal-3", true);
        killed.terminal.was_terminated = true;
        h.send(killed).await;
        assert_eq!(h.count(), 0);
    });
}

/// Verifies startup purges runtime rows and a failing purge cannot expose a ready service.
#[test]
fn startup_purge_failure_and_restart() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.send(attention("terminal-1", 1)).await;
        h.sql("CREATE TRIGGER fail_delete BEFORE DELETE ON notifications BEGIN SELECT RAISE(ABORT,'fixture'); END;");
        let create = || {
            NotificationService::new(
                h.storage.clone(),
                h.gate.clone(),
                h.dependencies.clone(),
                NotificationCollaborators::system(Arc::new(|_| Ok(())), h.os.clone()),
            )
        };
        assert!(matches!(
            create().await,
            Err(NotificationError::PersistenceFailed)
        ));
        assert_eq!(h.count(), 1);
        h.sql("DROP TRIGGER fail_delete");
        let restarted = create().await.unwrap();
        assert_eq!(
            restarted
                .get_notifications(None, None)
                .await
                .unwrap()
                .revision,
            "0"
        );
        assert_eq!(h.count(), 0);
    });
}

/// Verifies strict decoding rejects unsupported rows without silently resetting data.
#[test]
fn corrupt_rows_fail_closed() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.send(attention("terminal-1", 1)).await;
        h.sql("UPDATE notifications SET kind='unknown'");
        assert!(matches!(
            h.service.get_notifications(None, None).await,
            Err(NotificationError::CorruptStoredNotification { .. })
        ));
        h.sql("UPDATE notifications SET source_kind='unknown'");
        let result = NotificationService::new(
            h.storage.clone(),
            h.gate.clone(),
            h.dependencies.clone(),
            NotificationCollaborators::system(Arc::new(|_| Ok(())), h.os.clone()),
        )
        .await;
        assert!(matches!(
            result,
            Err(NotificationError::CorruptStoredNotification { .. })
        ));
        assert_eq!(h.count(), 1);
    });
}

/// Verifies explicit Quit blocks intake and retries a failed mandatory purge without dispatching effects.
#[test]
fn quit_cleanup_is_retryable_and_suppresses_effects() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        h.send(attention("terminal-1", 1)).await;
        h.sql("CREATE TRIGGER fail_delete BEFORE DELETE ON notifications BEGIN SELECT RAISE(ABORT,'fixture'); END;");
        h.service.begin_shutdown();
        h.service
            .observe_terminal_state(finished("terminal-2", true));
        assert_eq!(
            h.service.shutdown_runtime_sources().await,
            Err(NotificationError::PersistenceFailed)
        );
        assert_eq!(h.count(), 1);
        assert_eq!(
            h.service.get_notifications(None, None).await,
            Err(NotificationError::Unavailable)
        );
        h.sql("DROP TRIGGER fail_delete");
        h.service.shutdown_runtime_sources().await.unwrap();
        assert_eq!(h.count(), 0);
        assert_eq!(h.os.calls.lock().unwrap().len(), 1);
        assert_eq!(h.events.lock().unwrap().len(), 1);
    });
}

/// Proves the service shares the maintenance gate and concurrent mutations publish ordered revisions.
#[test]
fn shared_gate_and_concurrent_revision_order() {
    // Awaits owner work without retaining a calling state borrow.
    tauri::async_runtime::block_on(async {
        let h = Harness::new().await;
        for index in 1..=4 {
            h.send(attention(&format!("terminal-{index}"), 1)).await;
        }
        let page = h.page().await;
        let permit = h.gate.write_permit().await;
        let mut future = Box::pin(h.service.mark_notification_read(&page.items[0].id));
        assert!(
            // Observes pending admission deterministically without sleeping.
            std::future::poll_fn(|cx| std::task::Poll::Ready(
                future.as_mut().poll(cx).is_pending()
            ))
            .await
        );
        drop(permit);
        future.await.unwrap();
        let mut tasks = Vec::new();
        for item in page.items.iter().skip(1) {
            let service = h.service.clone();
            let id = item.id.clone();
            // Awaits owner work without retaining a calling state borrow.
            tasks.push(tauri::async_runtime::spawn(async move {
                service.mark_notification_read(&id).await.unwrap()
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        h.service.flush().await.unwrap();
        assert_eq!(h.page().await.unread_count, 0);
        let events = h.events.lock().unwrap();
        assert_eq!(events.len(), 8);
        for (index, event) in events.iter().enumerate() {
            assert_eq!(event.revision, (index + 1).to_string());
        }
    });
}
