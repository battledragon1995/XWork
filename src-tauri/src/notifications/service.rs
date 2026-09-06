use super::{
    models::*,
    repository::{self, StoredNotification},
};
use crate::{
    platform::notification::OsNotification,
    sessions::{SessionChangeKindDto, SessionRuntimeEventDto},
    shared::DataMaintenanceGate,
    storage::Storage,
    terminal::{TerminalProcessStateDto, TerminalStateChangeKindDto, TerminalStateChangedDto},
};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex as AsyncMutex, mpsc, oneshot};

pub const NOTIFICATIONS_CHANGED_EVENT: &str = "notifications://changed";
/// Injects time, identities and side effects without any IPC-visible test control.
pub struct NotificationCollaborators {
    pub clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    pub ids: Arc<dyn Fn() -> String + Send + Sync>,
    pub events:
        Arc<dyn Fn(NotificationCenterChangedDto) -> Result<(), NotificationError> + Send + Sync>,
    pub os: Arc<dyn OsNotification>,
}
impl NotificationCollaborators {
    /// Supplies production clock and UUID values around injected output adapters.
    pub fn system(
        events: Arc<
            dyn Fn(NotificationCenterChangedDto) -> Result<(), NotificationError> + Send + Sync,
        >,
        os: Arc<dyn OsNotification>,
    ) -> Self {
        Self {
            // Supplies the current clock value without frontend input.
            clock: Arc::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .min(i64::MAX as u128) as u64
            }),
            // Allocates an opaque backend identity for the new occurrence.
            ids: Arc::new(|| format!("notification-{}", uuid::Uuid::new_v4())),
            events,
            os,
        }
    }
}
/// Owns the durable center and low-frequency source admission.
#[derive(Clone)]
pub struct NotificationService {
    inner: Arc<Inner>,
}
struct Inner {
    storage: Storage,
    maintenance: DataMaintenanceGate,
    gate: Arc<AsyncMutex<u64>>,
    dependencies: Arc<dyn NotificationDependencies>,
    collaborators: NotificationCollaborators,
    shutdown: AtomicBool,
    paused: AtomicBool,
    stopped: AtomicBool,
    delivery: Mutex<()>,
    source: mpsc::UnboundedSender<Source>,
    effects: mpsc::UnboundedSender<Effect>,
}
enum Source {
    Terminal(TerminalStateChangedDto),
    Session(SessionRuntimeEventDto),
    Barrier(oneshot::Sender<()>),
    Stop,
}
enum Effect {
    Changed(NotificationCenterChangedDto),
    Toast(String, String),
    Barrier(oneshot::Sender<()>),
}
#[derive(Default)]
struct Seen {
    session: String,
    attention: bool,
    occurrences: HashSet<String>,
}
/// Identifies the small set of fixed SQL mutations accepted by commands and workers.
enum Mutation {
    Read(String),
    ReadAll,
    Delete(String),
    ClearRead,
    Attention(String),
    Terminal(String),
    Session(String),
    Insert(Box<StoredNotification>, bool),
}

impl NotificationService {
    /// Purges obsolete runtime rows before serving any command and starts weak-owned workers.
    pub async fn new(
        storage: Storage,
        maintenance: DataMaintenanceGate,
        dependencies: Arc<dyn NotificationDependencies>,
        collaborators: NotificationCollaborators,
    ) -> Result<Self, NotificationError> {
        let permit = maintenance.read_permit().await;
        let startup_storage = storage.clone();
        // Moves SQLite work off the asynchronous worker.
        tauri::async_runtime::spawn_blocking(move || {
            // Commits all related row changes as one storage transaction.
            startup_storage.with_transaction::<_, NotificationError>(|tx| {
                tx.execute(
                    "DELETE FROM notifications WHERE source_kind='terminal_activity'",
                    [],
                )?;
                repository::validate_all(tx)
            })
        })
        .await
        // Maps the failure to a sanitized boundary error.
        .map_err(|_| NotificationError::Unavailable)??;
        drop(permit);
        let (source, source_rx) = mpsc::unbounded_channel();
        let (effects, effects_rx) = mpsc::unbounded_channel();
        let service = Self {
            inner: Arc::new(Inner {
                storage,
                maintenance,
                dependencies,
                collaborators,
                gate: Arc::new(AsyncMutex::new(0)),
                shutdown: AtomicBool::new(false),
                paused: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                delivery: Mutex::new(()),
                source,
                effects,
            }),
        };
        tauri::async_runtime::spawn(source_worker(Arc::downgrade(&service.inner), source_rx));
        tauri::async_runtime::spawn(effect_worker(Arc::downgrade(&service.inner), effects_rx));
        Ok(service)
    }
    /// Rejects ordinary work once true-Quit admission closes.
    fn ready(&self) -> Result<(), NotificationError> {
        if self.inner.shutdown.load(Ordering::Acquire) {
            Err(NotificationError::Unavailable)
        } else {
            Ok(())
        }
    }
    /// Validates caller-controlled pagination before reading a consistent database/revision snapshot.
    pub async fn get_notifications(
        &self,
        cursor: Option<NotificationCursorDto>,
        limit: Option<u16>,
    ) -> Result<NotificationPageDto, NotificationError> {
        self.ready()?;
        let limit = limit.unwrap_or(30);
        if !(1..=100).contains(&limit) {
            return Err(NotificationError::InvalidLimit { min: 1, max: 100 });
        }
        if let Some(c) = &cursor {
            timestamp(&c.created_at_ms)?;
            // Maps the failure to a sanitized boundary error.
            validate_id(&c.id).map_err(|_| NotificationError::InvalidCursor)?;
        }
        let gate = self.inner.gate.clone().lock_owned().await;
        self.ready()?;
        let storage = self.inner.storage.clone();
        // Moves SQLite work off the asynchronous worker.
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = gate;
            // Runs the bounded query through the storage owner.
            storage.with_connection(|db| repository::page(db, cursor, limit, *_guard))
        })
        .await
        // Maps the failure to a sanitized boundary error.
        .map_err(|_| NotificationError::Unavailable)?
    }
    /// Reads one stored source without retaining a lock across owner dependency calls.
    async fn stored(&self, id: &str) -> Result<StoredNotification, NotificationError> {
        self.ready()?;
        validate_id(id)?;
        let gate = self.inner.gate.clone().lock_owned().await;
        let storage = self.inner.storage.clone();
        let id = id.to_owned();
        // Moves SQLite work off the asynchronous worker.
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = gate;
            // Runs the bounded query through the storage owner.
            storage.with_connection(|db| repository::get(db, &id))
        })
        .await
        // Maps the failure to a sanitized boundary error.
        .map_err(|_| NotificationError::Unavailable)?
    }
    /// Serializes changed rows and revision allocation before enqueueing post-commit effects.
    async fn mutate(
        &self,
        mutation: Mutation,
    ) -> Result<(NotificationCenterStateDto, bool), NotificationError> {
        self.ready()?;
        let permit = loop {
            if self.inner.paused.load(Ordering::Acquire) {
                return Err(NotificationError::Unavailable);
            }
            match tokio::time::timeout(
                std::time::Duration::from_millis(25),
                self.inner.maintenance.read_permit(),
            )
            .await
            {
                Ok(permit) => break permit,
                // Recreating the permit future is cancellation-safe and observes reset pause.
                Err(_) => continue,
            }
        };
        let gate = self.inner.gate.clone().lock_owned().await;
        self.ready()?;
        let inner = self.inner.clone();
        // Moves SQLite work off the asynchronous worker.
        tauri::async_runtime::spawn_blocking(move || {
            let _permit=permit; let mut revision=gate;
            let now = (inner.collaborators.clock)().min(i64::MAX as u64) as i64;
            // Commits all related row changes as one storage transaction.
            let (count, unread, inserted, next) = inner.storage.with_transaction::<_, NotificationError>(|tx| {
                let mut inserted=false;
                let count = match mutation {
                    Mutation::Read(id) => { repository::get(tx,&id)?; tx.execute("UPDATE notifications SET read_at_ms=max(?1,created_at_ms) WHERE id=?2 AND read_at_ms IS NULL", rusqlite::params![now,id])? },
                    Mutation::ReadAll => tx.execute("UPDATE notifications SET read_at_ms=max(?1,created_at_ms) WHERE read_at_ms IS NULL", [now])?,
                    Mutation::Delete(id) => { repository::get(tx,&id)?; tx.execute("DELETE FROM notifications WHERE id=?1", [id])? },
                    Mutation::ClearRead => tx.execute("DELETE FROM notifications WHERE read_at_ms IS NOT NULL", [])?,
                    Mutation::Attention(id) => repository::read_attention(tx,&id,now)?,
                    Mutation::Terminal(id) => tx.execute("DELETE FROM notifications WHERE source_kind='terminal_activity' AND source_id=?1", [id])?,
                    Mutation::Session(id) => tx.execute("DELETE FROM notifications WHERE target_kind='session' AND target_id=?1", [id])?,
                    Mutation::Insert(mut row, final_state) => {
                        row.dto.created_at_ms=now.to_string();
                        let read=if final_state { repository::read_attention(tx,&row.source_id,now)? } else {0};
                        let added=repository::insert(tx,&row)?; inserted=added!=0; read+added
                    }
                };
                // Maps the failure to a sanitized boundary error.
                let count=u32::try_from(count).map_err(|_| NotificationError::PersistenceFailed)?;
                let next=if count>0 { revision.checked_add(1).ok_or(NotificationError::Unavailable)? } else {*revision};
                Ok((count,repository::unread(tx)?,inserted,next))
            })?;
            // The database commit precedes publication, and FIFO enqueue precedes gate release.
            *revision=next;
            if count>0 { let _=inner.effects.send(Effect::Changed(NotificationCenterChangedDto {revision:next.to_string(),unread_count:unread})); }
            Ok((NotificationCenterStateDto {revision:next.to_string(),unread_count:unread,affected_count:count},inserted))
        // Maps the failure to a sanitized boundary error.
        }).await.map_err(|_| NotificationError::Unavailable)?
    }
    /// Marks a single existing item read, preserving an already-read revision.
    pub async fn mark_notification_read(
        &self,
        id: &str,
    ) -> Result<NotificationCenterStateDto, NotificationError> {
        validate_id(id)?;
        Ok(self.mutate(Mutation::Read(id.into())).await?.0)
    }
    /// Marks all currently unread items in one transaction.
    pub async fn mark_all_notifications_read(
        &self,
    ) -> Result<NotificationCenterStateDto, NotificationError> {
        Ok(self.mutate(Mutation::ReadAll).await?.0)
    }
    /// Deletes one existing row without changing any terminal state.
    pub async fn delete_notification(
        &self,
        id: &str,
    ) -> Result<NotificationCenterStateDto, NotificationError> {
        validate_id(id)?;
        Ok(self.mutate(Mutation::Delete(id.into())).await?.0)
    }
    /// Removes only read items while retaining all unread rows.
    pub async fn clear_read_notifications(
        &self,
    ) -> Result<NotificationCenterStateDto, NotificationError> {
        Ok(self.mutate(Mutation::ClearRead).await?.0)
    }
    /// Validates the exact live target before marking read and returning navigation data.
    pub async fn open_notification(
        &self,
        id: &str,
    ) -> Result<OpenNotificationDto, NotificationError> {
        let stored = self.stored(id).await?;
        let NotificationTargetDto::Session {
            project_id,
            session_id,
            tab_id,
            pane_id,
        } = &stored.dto.target;
        if !self
            .inner
            .dependencies
            .session_target_exists(project_id, session_id, tab_id, pane_id, &stored.source_id)
            .await?
        {
            return Err(NotificationError::TargetUnavailable);
        }
        let state = self.mark_notification_read(id).await?;
        Ok(OpenNotificationDto {
            target: stored.dto.target,
            state,
        })
    }
    /// Enqueues a committed terminal snapshot without waiting for database work.
    pub fn observe_terminal_state(&self, event: TerminalStateChangedDto) {
        if self.ready().is_ok() && !self.inner.paused.load(Ordering::Acquire) {
            let _ = self.inner.source.send(Source::Terminal(event));
        }
    }
    /// Enqueues only deletion events relevant to stale runtime targets.
    pub fn observe_session_runtime(&self, event: SessionRuntimeEventDto) {
        if self.ready().is_ok()
            && !self.inner.paused.load(Ordering::Acquire)
            && event.change == SessionChangeKindDto::Deleted
        {
            let _ = self.inner.source.send(Source::Session(event));
        }
    }
    /// Stops new side effects before terminal teardown; no database lock is acquired.
    pub fn begin_shutdown(&self) {
        let _delivery = self
            .inner
            .delivery
            .lock()
            // Recovers the shutdown synchronization guard without exposing poison details.
            .unwrap_or_else(|e| e.into_inner());
        self.inner.shutdown.store(true, Ordering::Release);
    }
    /// Waits for source and delivery queues; used by deterministic backend contract tests.
    #[doc(hidden)]
    pub async fn flush(&self) -> Result<(), NotificationError> {
        let (send, receive) = oneshot::channel();
        self.inner
            .source
            .send(Source::Barrier(send))
            // Maps the failure to a sanitized boundary error.
            .map_err(|_| NotificationError::Unavailable)?;
        // Maps the failure to a sanitized boundary error.
        receive.await.map_err(|_| NotificationError::Unavailable)?;
        let (send, receive) = oneshot::channel();
        self.inner
            .effects
            .send(Effect::Barrier(send))
            // Maps the failure to a sanitized boundary error.
            .map_err(|_| NotificationError::Unavailable)?;
        // Maps the failure to a sanitized boundary error.
        receive.await.map_err(|_| NotificationError::Unavailable)
    }

    /// Pauses new runtime intake and drains work admitted before the pause boundary.
    pub async fn pause_for_reset(&self) -> Result<(), NotificationError> {
        self.ready()?;
        self.inner.paused.store(true, Ordering::Release);
        if let Err(error) = self.flush().await {
            self.inner.paused.store(false, Ordering::Release);
            return Err(error);
        }
        Ok(())
    }

    /// Reopens runtime intake after reset without reviving discarded candidates.
    pub fn resume_after_reset(&self, _committed: bool) {
        self.inner.paused.store(false, Ordering::Release);
    }

    /// Deletes the notification inbox inside the coordinator transaction.
    pub fn reset_notifications_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<NotificationCommittedProjection, NotificationError> {
        let affected = tx.execute("DELETE FROM notifications", [])?;
        Ok(NotificationCommittedProjection {
            affected_count: u32::try_from(affected)
                .map_err(|_| NotificationError::PersistenceFailed)?,
        })
    }

    /// Publishes the committed zero-unread projection after coordinator commit.
    pub async fn publish_notification_reset(&self, projection: NotificationCommittedProjection) {
        let mut revision = self.inner.gate.lock().await;
        if projection.affected_count > 0 {
            *revision = revision.wrapping_add(1);
            let _ = self
                .inner
                .effects
                .send(Effect::Changed(NotificationCenterChangedDto {
                    revision: revision.to_string(),
                    unread_count: 0,
                }));
        }
    }
    /// Purges terminal rows after owner cleanup, allowing a failed SQL attempt to be retried.
    pub async fn shutdown_runtime_sources(&self) -> Result<(), NotificationError> {
        self.begin_shutdown();
        if self.inner.stopped.load(Ordering::Acquire) {
            return Ok(());
        }
        self.flush().await?;
        let permit = self.inner.maintenance.read_permit().await;
        let gate = self.inner.gate.clone().lock_owned().await;
        let storage = self.inner.storage.clone();
        // Moves SQLite work off the asynchronous worker.
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let _gate = gate;
            // Commits all related row changes as one storage transaction.
            storage.with_transaction::<_, NotificationError>(|tx| {
                tx.execute(
                    "DELETE FROM notifications WHERE source_kind='terminal_activity'",
                    [],
                )?;
                Ok(())
            })
        })
        .await
        // Maps the failure to a sanitized boundary error.
        .map_err(|_| NotificationError::Unavailable)??;
        self.inner.stopped.store(true, Ordering::Release);
        let _ = self.inner.source.send(Source::Stop);
        Ok(())
    }
}

/// Processes state transitions in source order without retaining a service ownership cycle.
async fn source_worker(weak: Weak<Inner>, mut queue: mpsc::UnboundedReceiver<Source>) {
    let mut seen = HashMap::<String, Seen>::new();
    while let Some(message) = queue.recv().await {
        if let Source::Barrier(done) = message {
            let _ = done.send(());
            continue;
        }
        if matches!(message, Source::Stop) {
            break;
        }
        let Some(inner) = weak.upgrade() else {
            break;
        };
        let service = NotificationService { inner };
        if service.ready().is_err() {
            continue;
        }
        let result = match message {
            Source::Terminal(event) => process_terminal(&service, event, &mut seen).await,
            Source::Session(event) => {
                let result = service
                    .mutate(Mutation::Session(event.session_id.clone()))
                    .await;
                if result.is_ok() {
                    // Releases processed occurrences for the deleted runtime target.
                    seen.retain(|_, state| state.session != event.session_id);
                }
                // Projects the verified result into the required output shape.
                result.map(|_| ())
            }
            _ => Ok(()),
        };
        if result.is_err() {
            eprintln!("notification source processing failed");
        }
    }
}

/// Emits effects outside all service/storage locks while honoring the synchronous Quit barrier.
async fn effect_worker(weak: Weak<Inner>, mut queue: mpsc::UnboundedReceiver<Effect>) {
    while let Some(effect) = queue.recv().await {
        if let Effect::Barrier(done) = effect {
            let _ = done.send(());
            continue;
        }
        let Some(inner) = weak.upgrade() else {
            break;
        };
        // The short delivery mutex linearizes dispatch with begin_shutdown, not database work.
        let _delivery = inner.delivery.lock().unwrap_or_else(|e| e.into_inner());
        if inner.shutdown.load(Ordering::Acquire) {
            continue;
        }
        match effect {
            Effect::Changed(event) => {
                if (inner.collaborators.events)(event).is_err() {
                    eprintln!("notification event dispatch failed");
                }
            }
            Effect::Toast(title, body) => {
                if let Err(error) = inner.collaborators.os.show(&title, &body) {
                    use crate::platform::notification::NotificationDeliveryError;
                    let category = match error {
                        NotificationDeliveryError::Permission => "permission",
                        NotificationDeliveryError::Platform => "platform",
                        NotificationDeliveryError::Show => "show",
                    };
                    eprintln!("notification OS dispatch failed: {category}");
                }
            }
            Effect::Barrier(_) => {}
        }
    }
}

/// Converts only authoritative state edges into safe notification candidates.
async fn process_terminal(
    service: &NotificationService,
    event: TerminalStateChangedDto,
    seen: &mut HashMap<String, Seen>,
) -> Result<(), NotificationError> {
    let terminal = event.terminal;
    if terminal.was_terminated
        || terminal.state == TerminalProcessStateDto::Closing
        || event.change == TerminalStateChangeKindDto::Disposed
    {
        service
            .mutate(Mutation::Terminal(terminal.id.clone()))
            .await?;
        seen.remove(&terminal.id);
        return Ok(());
    }
    if event.change == TerminalStateChangeKindDto::StreamDetached {
        return Ok(());
    }
    if event.change == TerminalStateChangeKindDto::AttentionChanged && !terminal.needs_attention {
        service
            .mutate(Mutation::Attention(terminal.id.clone()))
            .await?;
        seen.entry(terminal.id).or_default().attention = false;
        return Ok(());
    }
    let kind = match (event.change, terminal.state) {
        (TerminalStateChangeKindDto::AttentionChanged, TerminalProcessStateDto::Running)
            if terminal.needs_attention =>
        {
            NotificationKindDto::TerminalNeedsInput
        }
        (TerminalStateChangeKindDto::ProcessChanged, TerminalProcessStateDto::Exited) => {
            NotificationKindDto::TerminalProcessFinished
        }
        (TerminalStateChangeKindDto::ProcessChanged, TerminalProcessStateDto::Failed) => {
            NotificationKindDto::TerminalProcessFailed
        }
        _ => return Ok(()),
    };
    let final_state = kind != NotificationKindDto::TerminalNeedsInput;
    let key = if final_state {
        format!("terminal:{}:process_final", terminal.id)
    } else {
        if terminal
            .latest_output_sequence
            .parse::<u64>()
            .map_or(true, |n| n.to_string() != terminal.latest_output_sequence)
        {
            return Err(NotificationError::DependencyUnavailable);
        }
        format!(
            "terminal:{}:attention:{}",
            terminal.id, terminal.latest_output_sequence
        )
    };
    if seen
        .get(&terminal.id)
        // Checks the canonical value before accepting the snapshot.
        .is_some_and(|state| state.occurrences.contains(&key) || (!final_state && state.attention))
    {
        return Ok(());
    }
    // Resolve current owner facts without a notification gate or storage connection.
    let context = service
        .inner
        .dependencies
        .session_context(&terminal.session_id)
        .await?;
    let policy = service.inner.dependencies.terminal_policy()?;
    let Some(context) = context else {
        return Ok(());
    };
    if !service
        .inner
        .dependencies
        .session_target_exists(
            &context.project_id,
            &terminal.session_id,
            &terminal.tab_id,
            &terminal.pane_id,
            &terminal.id,
        )
        .await?
    {
        return Ok(());
    }
    if !context.is_observed && policy.terminal_activity_enabled {
        let suffix = match kind {
            NotificationKindDto::TerminalNeedsInput => "needs input",
            NotificationKindDto::TerminalProcessFinished => "finished",
            NotificationKindDto::TerminalProcessFailed => "exited with an error",
        };
        let title = normalize(&format!("{} {suffix}", terminal.title), 120);
        let context_text = normalize(&context.session_name, 240);
        let id = (service.inner.collaborators.ids)();
        validate_id(&id)?;
        let row = StoredNotification {
            source_id: terminal.id.clone(),
            source_key: key.clone(),
            dto: NotificationDto {
                id,
                kind,
                title: title.clone(),
                context: context_text.clone(),
                target: NotificationTargetDto::Session {
                    project_id: context.project_id,
                    session_id: terminal.session_id.clone(),
                    tab_id: terminal.tab_id,
                    pane_id: terminal.pane_id,
                },
                status_code: if final_state {
                    terminal.exit_code
                } else {
                    None
                },
                created_at_ms: "0".into(),
                read_at_ms: None,
            },
        };
        let (_, inserted) = service
            .mutate(Mutation::Insert(Box::new(row), final_state))
            .await?;
        let os = match kind {
            NotificationKindDto::TerminalNeedsInput => policy.os_needs_input,
            NotificationKindDto::TerminalProcessFinished => policy.os_process_finished,
            NotificationKindDto::TerminalProcessFailed => policy.os_process_failed,
        };
        if inserted && os {
            let _ = service
                .inner
                .effects
                .send(Effect::Toast(title, context_text));
        }
    } else if final_state {
        service
            .mutate(Mutation::Attention(terminal.id.clone()))
            .await?;
    }
    let state = seen.entry(terminal.id).or_default();
    state.session = terminal.session_id;
    state.attention = !final_state;
    state.occurrences.insert(key);
    Ok(())
}
