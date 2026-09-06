#![allow(dead_code)]
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use tempfile::TempDir;
use xwork_lib::{
    notifications::*,
    platform::notification::{NotificationDeliveryError, OsNotification},
    sessions::SessionNotificationContext,
    shared::DataMaintenanceGate,
    storage::Storage,
    terminal::*,
};

pub const PROJECT: &str = "00000000-0000-4000-8000-000000000001";
/// Supplies independently controlled owner facts to contract tests.
#[derive(Default)]
pub struct Dependencies {
    pub observed: AtomicBool,
    pub missing: AtomicBool,
    pub target_missing: AtomicBool,
    pub fail: AtomicBool,
    pub calls: AtomicU64,
    pub disabled: AtomicBool,
    pub target_pause: Mutex<
        Option<(
            tokio::sync::oneshot::Sender<()>,
            tokio::sync::oneshot::Receiver<()>,
        )>,
    >,
}
impl NotificationDependencies for Dependencies {
    /// Returns an isolated deterministic session snapshot or injected failure.
    fn session_context<'a>(
        &'a self,
        _: &'a str,
    ) -> NotificationFuture<'a, Result<Option<SessionNotificationContext>, NotificationError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(NotificationError::DependencyUnavailable);
            }
            Ok(
                // Builds a context only when the fixture target still exists.
                (!self.missing.load(Ordering::SeqCst)).then(|| SessionNotificationContext {
                    project_id: PROJECT.into(),
                    session_name: "A session".into(),
                    is_observed: self.observed.load(Ordering::SeqCst),
                }),
            )
        })
    }
    /// Validates the same exact target relationship used by the fixture events.
    fn session_target_exists<'a>(
        &'a self,
        project: &'a str,
        session: &'a str,
        tab: &'a str,
        pane: &'a str,
        terminal: &'a str,
    ) -> NotificationFuture<'a, Result<bool, NotificationError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(NotificationError::DependencyUnavailable);
            }
            let exists = !self.target_missing.load(Ordering::SeqCst)
                && project == PROJECT
                && session == "session-1"
                && tab == "tab-1"
                && pane == "pane-1"
                && terminal.starts_with("terminal-");
            let pause = self.target_pause.lock().unwrap().take();
            if let Some((entered, resume)) = pause {
                let _ = entered.send(());
                resume.await.unwrap();
            }
            Ok(exists)
        })
    }
    /// Leaves future Calendar resolution absent in Phase 1.
    fn event_target<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
    ) -> NotificationFuture<'a, Result<Option<NotificationEventTarget>, NotificationError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async { Ok(None) })
    }
    /// Returns defaults with one test-local activity opt-out switch.
    fn terminal_policy(&self) -> Result<TerminalNotificationPolicy, NotificationError> {
        Ok(TerminalNotificationPolicy {
            terminal_activity_enabled: !self.disabled.load(Ordering::SeqCst),
            os_needs_input: true,
            os_process_finished: false,
            os_process_failed: true,
        })
    }
}
/// Records requests without contacting Windows notification APIs.
#[derive(Default)]
pub struct Recorder {
    pub calls: Mutex<Vec<(String, String)>>,
    pub fail: AtomicBool,
}
impl OsNotification for Recorder {
    /// Records sanitized content and optionally rejects dispatch.
    fn show(&self, title: &str, body: &str) -> Result<(), NotificationDeliveryError> {
        self.calls.lock().unwrap().push((title.into(), body.into()));
        if self.fail.load(Ordering::SeqCst) {
            Err(NotificationDeliveryError::Permission)
        } else {
            Ok(())
        }
    }
}
/// Owns isolated state and records every post-commit side effect.
pub struct Harness {
    pub service: NotificationService,
    pub storage: Storage,
    pub dependencies: Arc<Dependencies>,
    pub os: Arc<Recorder>,
    pub events: Arc<Mutex<Vec<NotificationCenterChangedDto>>>,
    pub clock: Arc<AtomicU64>,
    pub event_fail: Arc<AtomicBool>,
    pub gate: DataMaintenanceGate,
    pub dir: TempDir,
}
impl Harness {
    /// Creates only temporary storage and fake owner/platform collaborators.
    pub async fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let storage = Storage::open(dir.path()).unwrap();
        let dependencies = Arc::new(Dependencies::default());
        let os = Arc::new(Recorder::default());
        let events = Arc::new(Mutex::new(Vec::new()));
        let clock = Arc::new(AtomicU64::new(100));
        let event_fail = Arc::new(AtomicBool::new(false));
        let ids = AtomicU64::new(1);
        let gate = DataMaintenanceGate::new();
        let event_copy = events.clone();
        let clock_copy = clock.clone();
        let failure_copy = event_fail.clone();
        let collaborators = NotificationCollaborators {
            // Supplies the current clock value without frontend input.
            clock: Arc::new(move || clock_copy.load(Ordering::SeqCst)),
            // Allocates an opaque backend identity for the new occurrence.
            ids: Arc::new(move || {
                format!(
                    "notification-00000000-0000-4000-8000-{:012}",
                    ids.fetch_add(1, Ordering::SeqCst)
                )
            }),
            // Records committed events and applies the injected delivery result.
            events: Arc::new(move |event| {
                event_copy.lock().unwrap().push(event);
                if failure_copy.load(Ordering::SeqCst) {
                    Err(NotificationError::Unavailable)
                } else {
                    Ok(())
                }
            }),
            os: os.clone(),
        };
        let service = NotificationService::new(
            storage.clone(),
            gate.clone(),
            dependencies.clone(),
            collaborators,
        )
        .await
        .unwrap();
        Self {
            service,
            storage,
            dependencies,
            os,
            events,
            clock,
            event_fail,
            gate,
            dir,
        }
    }
    /// Waits for all queued intake and effects before reading assertions.
    pub async fn send(&self, event: TerminalStateChangedDto) {
        self.service.observe_terminal_state(event);
        self.service.flush().await.unwrap();
    }
    /// Returns the default page from the public service boundary.
    pub async fn page(&self) -> NotificationPageDto {
        self.service.get_notifications(None, None).await.unwrap()
    }
    /// Applies a failure fixture only to this test's temporary database.
    pub fn sql(&self, sql: &str) {
        self.storage
            // Runs the bounded query through the storage owner.
            .with_connection::<_, NotificationError>(|db| Ok(db.execute_batch(sql)?))
            .unwrap();
    }
    /// Counts persisted rows even after service shutdown closes queries.
    pub fn count(&self) -> u32 {
        self.storage
            // Runs the bounded query through the storage owner.
            .with_connection::<_, NotificationError>(|db| {
                // Decodes only the requested database projection.
                Ok(db.query_row("SELECT COUNT(*) FROM notifications", [], |row| row.get(0))?)
            })
            .unwrap()
    }
}
/// Builds a safe BE-007 attention transition without output content.
pub fn attention(id: &str, sequence: u64) -> TerminalStateChangedDto {
    TerminalStateChangedDto {
        change: TerminalStateChangeKindDto::AttentionChanged,
        terminal: TerminalDto {
            id: id.into(),
            session_id: "session-1".into(),
            tab_id: "tab-1".into(),
            pane_id: "pane-1".into(),
            profile_id: "builtin:terminal".into(),
            title: "Terminal".into(),
            size: PtySizeDto {
                columns: 80,
                rows: 24,
            },
            state: TerminalProcessStateDto::Running,
            exit_code: None,
            was_terminated: false,
            needs_attention: true,
            output_subscribed: false,
            latest_output_sequence: sequence.to_string(),
        },
        final_output_sequence: None,
    }
}
/// Builds a natural final-state transition using the same safe runtime shape.
pub fn finished(id: &str, failed: bool) -> TerminalStateChangedDto {
    let mut event = attention(id, 2);
    event.change = TerminalStateChangeKindDto::ProcessChanged;
    event.terminal.state = if failed {
        TerminalProcessStateDto::Failed
    } else {
        TerminalProcessStateDto::Exited
    };
    event.terminal.exit_code = Some(if failed { "1" } else { "0" }.into());
    event.terminal.needs_attention = false;
    event
}

/// Supplies fixed owner facts for command delegation tests.
pub struct CommandDependencies {
    pub attaches: std::sync::atomic::AtomicUsize,
}

impl TerminalDependencies for CommandDependencies {
    /// Resolves one fixed launchable tool-selection pane.
    fn launch_target<'a>(
        &'a self,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<TerminalPaneTarget, TerminalError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async move {
            Ok(TerminalPaneTarget {
                session_id: session_id.to_owned(),
                tab_id: tab_id.to_owned(),
                pane_id: pane_id.to_owned(),
                project_id: "project-fixture".to_owned(),
                profile_id: "builtin:terminal".to_owned(),
                title: "Fixture".to_owned(),
            })
        })
    }

    /// Returns one synthetic canonical root consumed only by the fake PTY.
    fn available_project_root<'a>(
        &'a self,
        _project_id: &'a str,
    ) -> TerminalFuture<'a, Result<std::path::PathBuf, TerminalError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async { Ok(std::path::PathBuf::from("fixture-root")) })
    }

    /// Returns structured launch data without reading credentials or host discovery.
    fn resolve_profile<'a>(
        &'a self,
        _profile_id: &'a str,
    ) -> TerminalFuture<'a, Result<ResolvedCliProfile, TerminalError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async {
            Ok(ResolvedCliProfile {
                profile_id: "builtin:terminal".to_owned(),
                display_name: "Fixture Shell".to_owned(),
                launch_kind: ResolvedCliLaunchKind::InteractiveShell {
                    shell: xwork_lib::platform::shell::ResolvedShell {
                        id: "fixture-shell".to_owned(),
                        display_name: "Fixture Shell".to_owned(),
                        command: "fixture.exe".to_owned(),
                        executable: std::path::PathBuf::from("fixture.exe"),
                        mode: xwork_lib::platform::shell::ShellMode::PowerShell,
                    },
                },
                environment: Vec::new(),
            })
        })
    }

    /// Records that the real start handler reached authoritative attachment.
    fn attach_terminal<'a>(
        &'a self,
        _target: &'a TerminalPaneTarget,
        _terminal_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async move {
            self.attaches.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    }

    /// Accepts synthetic output aggregation.
    fn record_output<'a>(
        &'a self,
        _pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async { Ok(()) })
    }

    /// Accepts synthetic activity aggregation.
    fn update_activity<'a>(
        &'a self,
        _pane_id: &'a str,
        _activity: TerminalActivity,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async { Ok(()) })
    }
}
