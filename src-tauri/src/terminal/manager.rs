use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::sessions::{
    CloseRetention, PaneCloseImpact, PaneContentOwner, PaneContentRef, ReopenHandle,
};

use super::{
    PtyCallbacks, PtyFactory, PtyProcess, PtySizeDto, TerminalActivity, TerminalDependencies,
    TerminalDto, TerminalError, TerminalInputAckDto, TerminalProcessStateDto, TerminalResizeAckDto,
    TerminalStateChangeKindDto, TerminalStateChangedDto, TerminalSubscriptionDto,
    models::{parse_sequence, validate_profile_id, validate_runtime_id},
    stream::{FrameSender, OutputStream},
};

/// Names the low-frequency terminal state event.
pub const TERMINAL_STATE_CHANGED_EVENT: &str = "terminal://state-changed";

/// Publishes safe state snapshots independently from raw terminal output.
pub trait TerminalEventSink: Send + Sync {
    /// Publishes one best-effort state change.
    fn publish(&self, event: TerminalStateChangedDto) -> Result<(), TerminalError>;
}

/// Owns every process-local terminal and its pane launch gate.
#[derive(Clone)]
pub struct TerminalManager {
    inner: Arc<TerminalManagerInner>,
}

/// Holds a non-owning terminal manager delegate for lifecycle routing.
#[derive(Clone)]
pub struct TerminalManagerWeak(Weak<TerminalManagerInner>);

/// Stores dependencies and synchronized manager indexes.
struct TerminalManagerInner {
    state: Mutex<ManagerState>,
    dependencies: Arc<dyn TerminalDependencies>,
    events: Arc<dyn TerminalEventSink>,
    factory: Arc<dyn PtyFactory>,
}

/// Stores published, pending, and retained runtime indexes.
struct ManagerState {
    next_terminal_id: u64,
    next_reopen_id: u64,
    shutting_down: bool,
    pane_index: HashMap<String, String>,
    launch_gates: HashMap<String, String>,
    runtimes: HashMap<String, Arc<TerminalRuntime>>,
    pending: HashMap<String, Arc<TerminalRuntime>>,
    retained: HashMap<String, String>,
}

/// Holds safe identity, output, control, and mutable public state for one runtime.
struct TerminalRuntime {
    id: String,
    session_id: String,
    tab_id: String,
    pane_id: String,
    profile_id: String,
    title: String,
    stream: OutputStream,
    process: Mutex<Option<Arc<dyn PtyProcess>>>,
    dynamic: Mutex<RuntimeState>,
    control_gate: tokio::sync::Mutex<()>,
    resize_sender: tokio::sync::mpsc::Sender<ResizeRequest>,
    manager: Weak<TerminalManagerInner>,
    dependencies: Arc<dyn TerminalDependencies>,
    events: Arc<dyn TerminalEventSink>,
}

/// Stores state that can change after process spawn.
struct RuntimeState {
    size: PtySizeDto,
    state: TerminalProcessStateDto,
    exit_code: Option<String>,
    was_terminated: bool,
    needs_attention: bool,
    input_sequence: u64,
    resize_sequence: u64,
    attached: bool,
    reader_eof: bool,
    child_result: Option<Result<Option<u32>, ()>>,
    transport_failed: bool,
    last_output_edge: Option<Instant>,
}

/// Carries one resize request to the per-terminal coalescing worker.
struct ResizeRequest {
    sequence: u64,
    size: PtySizeDto,
    reply: tokio::sync::oneshot::Sender<Result<TerminalResizeAckDto, TerminalError>>,
}

impl TerminalManager {
    /// Creates an empty manager without opening a PTY.
    pub fn new(
        dependencies: Arc<dyn TerminalDependencies>,
        events: Arc<dyn TerminalEventSink>,
        factory: Arc<dyn PtyFactory>,
    ) -> Self {
        Self {
            inner: Arc::new(TerminalManagerInner {
                state: Mutex::new(ManagerState {
                    next_terminal_id: 1,
                    next_reopen_id: 1,
                    shutting_down: false,
                    pane_index: HashMap::new(),
                    launch_gates: HashMap::new(),
                    runtimes: HashMap::new(),
                    pending: HashMap::new(),
                    retained: HashMap::new(),
                }),
                dependencies,
                events,
                factory,
            }),
        }
    }

    /// Creates a non-owning delegate that cannot form a Sessions cycle.
    pub fn downgrade(&self) -> TerminalManagerWeak {
        TerminalManagerWeak(Arc::downgrade(&self.inner))
    }

    /// Launches the authoritative pane selection and attaches its native PTY.
    pub async fn start_terminal(
        &self,
        session_id: &str,
        tab_id: &str,
        pane_id: &str,
        initial_size: PtySizeDto,
        on_output: Channel<InvokeResponseBody>,
    ) -> Result<TerminalDto, TerminalError> {
        self.start_with_sender(
            session_id,
            tab_id,
            pane_id,
            initial_size,
            Arc::new(on_output),
        )
        .await
    }

    /// Launches through an abstract sender used by the command and deterministic tests.
    pub(crate) async fn start_with_sender(
        &self,
        session_id: &str,
        tab_id: &str,
        pane_id: &str,
        initial_size: PtySizeDto,
        on_output: Arc<dyn FrameSender>,
    ) -> Result<TerminalDto, TerminalError> {
        validate_runtime_id(session_id, "session-", "sessionId")?;
        validate_runtime_id(tab_id, "tab-", "tabId")?;
        validate_runtime_id(pane_id, "pane-", "paneId")?;
        initial_size.validate()?;

        let terminal_id = {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|_| TerminalError::RuntimeShuttingDown)?;
            if state.shutting_down {
                return Err(TerminalError::RuntimeShuttingDown);
            }
            if let Some(existing) = state.pane_index.get(pane_id).cloned() {
                return Err(TerminalError::TerminalAlreadyAttached {
                    pane_id: pane_id.to_owned(),
                    terminal_id: Some(existing),
                });
            }
            if state.pending.contains_key(pane_id) || state.launch_gates.contains_key(pane_id) {
                return Err(TerminalError::TerminalAlreadyAttached {
                    pane_id: pane_id.to_owned(),
                    terminal_id: None,
                });
            }
            let id = format!("terminal-{}", state.next_terminal_id);
            state.next_terminal_id = state.next_terminal_id.saturating_add(1);
            state.launch_gates.insert(pane_id.to_owned(), id.clone());
            id
        };
        let mut launch_reservation = LaunchReservation {
            inner: self.inner.clone(),
            pane_id: pane_id.to_owned(),
            preserve_pending: false,
        };

        let mut target = match self
            .inner
            .dependencies
            .launch_target(session_id, tab_id, pane_id)
            .await
        {
            Ok(target) => target,
            Err(error) => return Err(error),
        };
        if self.is_shutting_down() {
            return Err(TerminalError::RuntimeShuttingDown);
        }
        if target.session_id != session_id || target.tab_id != tab_id || target.pane_id != pane_id {
            return Err(TerminalError::PaneNotLaunchable {
                pane_id: pane_id.to_owned(),
            });
        }
        validate_profile_id(&target.profile_id)?;
        let root = self
            .inner
            .dependencies
            .available_project_root(&target.project_id)
            .await?;
        if self.is_shutting_down() {
            return Err(TerminalError::RuntimeShuttingDown);
        }
        let profile = self
            .inner
            .dependencies
            .resolve_profile(&target.profile_id)
            .await?;
        if self.is_shutting_down() {
            return Err(TerminalError::RuntimeShuttingDown);
        }
        if profile.profile_id != target.profile_id {
            return Err(TerminalError::ProfileLookupFailed);
        }
        target.title = profile.display_name.clone();

        let detach_slot = Arc::new(Mutex::new(None::<std::sync::Weak<TerminalRuntime>>));
        let detach_lookup = detach_slot.clone();
        let stream = OutputStream::new(Arc::new(move || {
            if let Ok(slot) = detach_lookup.lock()
                && let Some(runtime) = slot.as_ref().and_then(std::sync::Weak::upgrade)
            {
                runtime.stream_detached();
            }
        }))?;
        stream.subscribe(None, on_output)?;
        let (resize_sender, resize_receiver) = tokio::sync::mpsc::channel(64);
        let runtime = Arc::new(TerminalRuntime {
            id: terminal_id.clone(),
            session_id: target.session_id.clone(),
            tab_id: target.tab_id.clone(),
            pane_id: target.pane_id.clone(),
            profile_id: target.profile_id.clone(),
            title: target.title.clone(),
            stream,
            process: Mutex::new(None),
            dynamic: Mutex::new(RuntimeState {
                size: initial_size,
                state: TerminalProcessStateDto::Running,
                exit_code: None,
                was_terminated: false,
                needs_attention: false,
                input_sequence: 0,
                resize_sequence: 0,
                attached: false,
                reader_eof: false,
                child_result: None,
                transport_failed: false,
                last_output_edge: None,
            }),
            control_gate: tokio::sync::Mutex::new(()),
            resize_sender,
            manager: Arc::downgrade(&self.inner),
            dependencies: self.inner.dependencies.clone(),
            events: self.inner.events.clone(),
        });
        *detach_slot
            .lock()
            .map_err(|_| TerminalError::StreamAttachFailed)? = Some(Arc::downgrade(&runtime));
        {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|_| TerminalError::RuntimeShuttingDown)?;
            if state.shutting_down {
                return Err(TerminalError::RuntimeShuttingDown);
            }
            // Pending ownership makes Quit able to find a launch before Sessions attachment.
            state.pending.insert(pane_id.to_owned(), runtime.clone());
        }

        let weak = Arc::downgrade(&runtime);
        let output = Arc::new(move |bytes: Vec<u8>| {
            if let Some(runtime) = weak.upgrade() {
                runtime.accept_output(&bytes);
            }
        });
        let weak = Arc::downgrade(&runtime);
        let eof = Arc::new(move || {
            if let Some(runtime) = weak.upgrade() {
                runtime.reader_finished();
            }
        });
        let weak = Arc::downgrade(&runtime);
        let exited = Arc::new(move |result| {
            if let Some(runtime) = weak.upgrade() {
                runtime.child_finished(result);
            }
        });
        let weak = Arc::downgrade(&runtime);
        let failed = Arc::new(move || {
            if let Some(runtime) = weak.upgrade() {
                runtime.transport_failed();
            }
        });
        let factory = self.inner.factory.clone();
        let spawned = tauri::async_runtime::spawn_blocking(move || {
            factory.spawn(
                profile,
                root,
                initial_size,
                PtyCallbacks {
                    output,
                    eof,
                    exited,
                    failed,
                },
            )
        })
        .await
        .map_err(|_| TerminalError::ProcessSpawnFailed)?;
        let process = match spawned {
            Ok(process) => process,
            Err(error) => {
                self.remove_pending(pane_id);
                return Err(error);
            }
        };
        *runtime
            .process
            .lock()
            .map_err(|_| TerminalError::ProcessSpawnFailed)? = Some(process.clone());
        start_resize_worker(&runtime, resize_receiver);
        if runtime
            .dynamic
            .lock()
            .map(|state| state.transport_failed)
            .unwrap_or(true)
        {
            let cleanup = process.clone();
            return match tauri::async_runtime::spawn_blocking(move || cleanup.terminate()).await {
                Ok(Ok(())) => {
                    self.remove_pending(pane_id);
                    Err(TerminalError::ProcessIoFailed)
                }
                _ => {
                    launch_reservation.preserve_pending = true;
                    Err(TerminalError::TerminationFailed)
                }
            };
        }
        if self.is_shutting_down() {
            return match tauri::async_runtime::spawn_blocking(move || process.terminate()).await {
                Ok(Ok(())) => {
                    self.remove_pending(pane_id);
                    Err(TerminalError::RuntimeShuttingDown)
                }
                _ => {
                    launch_reservation.preserve_pending = true;
                    Err(TerminalError::TerminationFailed)
                }
            };
        }
        if self
            .inner
            .dependencies
            .attach_terminal(&target, &terminal_id)
            .await
            .is_err()
        {
            let cleanup = tauri::async_runtime::spawn_blocking(move || process.terminate()).await;
            return match cleanup {
                Ok(Ok(())) => {
                    self.remove_pending(pane_id);
                    Err(TerminalError::SessionAttachFailed)
                }
                _ => {
                    launch_reservation.preserve_pending = true;
                    Err(TerminalError::TerminationFailed)
                }
            };
        }
        if self.is_shutting_down() {
            let cleanup = tauri::async_runtime::spawn_blocking(move || process.terminate()).await;
            return match cleanup {
                Ok(Ok(())) => {
                    self.remove_pending(pane_id);
                    Err(TerminalError::RuntimeShuttingDown)
                }
                _ => {
                    launch_reservation.preserve_pending = true;
                    Err(TerminalError::TerminationFailed)
                }
            };
        }
        let published = {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|_| TerminalError::SessionAttachFailed)?;
            if state.shutting_down {
                false
            } else {
                state.pending.remove(pane_id);
                state
                    .pane_index
                    .insert(pane_id.to_owned(), terminal_id.clone());
                state.runtimes.insert(terminal_id, runtime.clone());
                true
            }
        };
        if !published {
            let cleanup = tauri::async_runtime::spawn_blocking(move || process.terminate()).await;
            return match cleanup {
                Ok(Ok(())) => Err(TerminalError::RuntimeShuttingDown),
                _ => {
                    launch_reservation.preserve_pending = true;
                    Err(TerminalError::TerminationFailed)
                }
            };
        }
        {
            let mut dynamic = runtime
                .dynamic
                .lock()
                .map_err(|_| TerminalError::SessionAttachFailed)?;
            dynamic.attached = true;
        }
        runtime.publish_current_activity();
        if runtime.stream.latest_sequence() > 0 {
            if let Ok(mut dynamic) = runtime.dynamic.lock() {
                dynamic.last_output_edge = Some(Instant::now());
            }
            runtime.record_output();
        }
        let already_final = runtime
            .dynamic
            .lock()
            .map(|dynamic| {
                matches!(
                    dynamic.state,
                    TerminalProcessStateDto::Exited | TerminalProcessStateDto::Failed
                )
            })
            .unwrap_or(false);
        if already_final {
            runtime.publish_state(TerminalStateChangeKindDto::ProcessChanged, true);
        } else {
            runtime.finalize_if_ready();
        }
        Ok(runtime.snapshot())
    }

    /// Returns one attached or retained terminal snapshot.
    pub async fn get_terminal(&self, terminal_id: &str) -> Result<TerminalDto, TerminalError> {
        Ok(self.runtime(terminal_id)?.snapshot())
    }

    /// Replaces the output subscriber and schedules retained replay.
    pub async fn subscribe_terminal_output(
        &self,
        terminal_id: &str,
        after_sequence: Option<&str>,
        on_output: Channel<InvokeResponseBody>,
    ) -> Result<TerminalSubscriptionDto, TerminalError> {
        self.subscribe_with_sender(terminal_id, after_sequence, Arc::new(on_output))
            .await
    }

    /// Subscribes through an abstract sender used by tests.
    pub(crate) async fn subscribe_with_sender(
        &self,
        terminal_id: &str,
        after_sequence: Option<&str>,
        sender: Arc<dyn FrameSender>,
    ) -> Result<TerminalSubscriptionDto, TerminalError> {
        let runtime = self.runtime(terminal_id)?;
        let after = after_sequence
            .map(|value| parse_sequence(value, "afterSequence"))
            .transpose()?;
        let (first, latest) = runtime.stream.subscribe(after, sender)?;
        Ok(TerminalSubscriptionDto {
            terminal: runtime.snapshot(),
            first_available_sequence: first.to_string(),
            latest_sequence: latest.to_string(),
        })
    }

    /// Writes one strictly ordered input chunk to a running PTY.
    pub async fn write_terminal(
        &self,
        terminal_id: &str,
        input_sequence: &str,
        data: String,
    ) -> Result<TerminalInputAckDto, TerminalError> {
        if self.is_shutting_down() {
            return Err(TerminalError::RuntimeShuttingDown);
        }
        let runtime = self.runtime(terminal_id)?;
        let sequence = parse_sequence(input_sequence, "inputSequence")?;
        if data.len() > 65_536 {
            return Err(TerminalError::InputTooLarge { max_bytes: 65_536 });
        }
        let _gate = runtime.control_gate.lock().await;
        let expected = {
            let dynamic = runtime
                .dynamic
                .lock()
                .map_err(|_| TerminalError::ProcessIoFailed)?;
            if dynamic.state != TerminalProcessStateDto::Running {
                return Err(TerminalError::TerminalNotRunning {
                    terminal_id: terminal_id.to_owned(),
                });
            }
            dynamic.input_sequence.saturating_add(1)
        };
        if sequence != expected {
            return Err(TerminalError::InputOutOfOrder {
                expected_sequence: expected.to_string(),
                received_sequence: sequence.to_string(),
            });
        }
        let process = runtime.process()?;
        let result = tauri::async_runtime::spawn_blocking(move || process.write(data.as_bytes()))
            .await
            .map_err(|_| TerminalError::ProcessIoFailed)?;
        if let Err(error) = result {
            runtime.transport_failed();
            return Err(error);
        }
        let attention_changed = {
            let mut dynamic = runtime
                .dynamic
                .lock()
                .map_err(|_| TerminalError::ProcessIoFailed)?;
            dynamic.input_sequence = sequence;
            let changed = dynamic.needs_attention;
            dynamic.needs_attention = false;
            changed
        };
        if attention_changed {
            runtime.publish_attention();
        }
        Ok(TerminalInputAckDto {
            accepted_sequence: sequence.to_string(),
        })
    }

    /// Applies a newer measured size and returns the current resize acknowledgement.
    pub async fn resize_terminal(
        &self,
        terminal_id: &str,
        resize_sequence: &str,
        size: PtySizeDto,
    ) -> Result<TerminalResizeAckDto, TerminalError> {
        if self.is_shutting_down() {
            return Err(TerminalError::RuntimeShuttingDown);
        }
        size.validate()?;
        let runtime = self.runtime(terminal_id)?;
        let sequence = parse_sequence(resize_sequence, "resizeSequence")?;
        {
            let dynamic = runtime
                .dynamic
                .lock()
                .map_err(|_| TerminalError::ResizeFailed)?;
            if dynamic.state != TerminalProcessStateDto::Running {
                return Err(TerminalError::TerminalNotRunning {
                    terminal_id: terminal_id.to_owned(),
                });
            }
            if sequence <= dynamic.resize_sequence {
                return Ok(TerminalResizeAckDto {
                    accepted_sequence: dynamic.resize_sequence.to_string(),
                    size: dynamic.size,
                });
            }
        }
        let (reply, response) = tokio::sync::oneshot::channel();
        runtime
            .resize_sender
            .send(ResizeRequest {
                sequence,
                size,
                reply,
            })
            .await
            .map_err(|_| TerminalError::ResizeFailed)?;
        response.await.map_err(|_| TerminalError::ResizeFailed)?
    }

    /// Clears one attached terminal attention marker.
    pub async fn acknowledge_terminal_attention(
        &self,
        terminal_id: &str,
    ) -> Result<TerminalDto, TerminalError> {
        let runtime = self.runtime(terminal_id)?;
        let changed = {
            let mut dynamic =
                runtime
                    .dynamic
                    .lock()
                    .map_err(|_| TerminalError::TerminalNotFound {
                        terminal_id: terminal_id.to_owned(),
                    })?;
            if !dynamic.attached {
                return Err(TerminalError::TerminalNotFound {
                    terminal_id: terminal_id.to_owned(),
                });
            }
            let changed = dynamic.needs_attention;
            dynamic.needs_attention = false;
            changed
        };
        if changed {
            runtime.publish_attention();
        }
        Ok(runtime.snapshot())
    }

    /// Inspects close blockers for one terminal content reference.
    pub async fn close_impact(&self, terminal_id: &str) -> Result<PaneCloseImpact, TerminalError> {
        let runtime = self.runtime(terminal_id)?;
        let running = runtime
            .dynamic
            .lock()
            .map(|state| state.state == TerminalProcessStateDto::Running)
            .unwrap_or(false);
        Ok(PaneCloseImpact {
            running_process_labels: if running {
                vec![runtime.title.clone()]
            } else {
                Vec::new()
            },
            unsaved_file_labels: Vec::new(),
        })
    }

    /// Stops a terminal and optionally retains its runtime-only buffer handle.
    pub async fn close_for_session(
        &self,
        terminal_id: &str,
        retention: CloseRetention,
    ) -> Result<Option<ReopenHandle>, TerminalError> {
        let runtime = self.runtime(terminal_id)?;
        self.stop_runtime(runtime.clone()).await?;
        match retention {
            CloseRetention::Discard => {
                self.dispose_runtime(&runtime);
                Ok(None)
            }
            CloseRetention::ReopenLastTab => {
                let token = {
                    let mut state = self
                        .inner
                        .state
                        .lock()
                        .map_err(|_| TerminalError::TerminationFailed)?;
                    if let Some((token, _)) =
                        state.retained.iter().find(|(_, id)| *id == terminal_id)
                    {
                        token.clone()
                    } else {
                        let token = format!("terminal-reopen-{}", state.next_reopen_id);
                        state.next_reopen_id = state.next_reopen_id.saturating_add(1);
                        state.retained.insert(token.clone(), terminal_id.to_owned());
                        token
                    }
                };
                if let Ok(mut dynamic) = runtime.dynamic.lock() {
                    dynamic.attached = false;
                }
                Ok(Some(ReopenHandle {
                    owner: PaneContentOwner::Terminal,
                    token,
                }))
            }
        }
    }

    /// Restores a retained stopped terminal without spawning a process.
    pub async fn reopen_for_session(
        &self,
        handle: ReopenHandle,
    ) -> Result<PaneContentRef, TerminalError> {
        if handle.owner != PaneContentOwner::Terminal {
            return Err(TerminalError::TerminalNotFound {
                terminal_id: handle.token,
            });
        }
        let terminal_id = self
            .inner
            .state
            .lock()
            .map_err(|_| TerminalError::TerminationFailed)?
            .retained
            .get(&handle.token)
            .cloned()
            .ok_or_else(|| TerminalError::TerminalNotFound {
                terminal_id: handle.token.clone(),
            })?;
        let runtime = self.runtime(&terminal_id)?;
        if let Ok(mut dynamic) = runtime.dynamic.lock() {
            dynamic.attached = true;
        }
        Ok(PaneContentRef::Terminal {
            terminal_id,
            profile_id: runtime.profile_id.clone(),
            title: runtime.title.clone(),
        })
    }

    /// Permanently disposes a retained terminal output and token.
    pub async fn discard_for_session(&self, handle: ReopenHandle) -> Result<(), TerminalError> {
        if handle.owner != PaneContentOwner::Terminal {
            return Ok(());
        }
        let terminal_id = self
            .inner
            .state
            .lock()
            .map_err(|_| TerminalError::TerminationFailed)?
            .retained
            .remove(&handle.token);
        if let Some(terminal_id) = terminal_id
            && let Ok(runtime) = self.runtime(&terminal_id)
        {
            self.stop_runtime(runtime.clone()).await?;
            self.dispose_runtime(&runtime);
        }
        Ok(())
    }

    /// Closes admission synchronously before Sessions begins Quit cleanup.
    pub fn begin_shutdown(&self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.shutting_down = true;
        }
    }

    /// Attempts cleanup for every pending or remaining process independently.
    pub async fn shutdown_remaining(&self) -> Result<(), TerminalError> {
        self.begin_shutdown();
        let runtimes = {
            let state = self
                .inner
                .state
                .lock()
                .map_err(|_| TerminalError::TerminationFailed)?;
            state
                .runtimes
                .values()
                .chain(state.pending.values())
                .cloned()
                .collect::<Vec<_>>()
        };
        let mut first_error = None;
        for runtime in runtimes {
            if let Err(error) = self.stop_runtime(runtime.clone()).await {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            } else {
                self.dispose_runtime(&runtime);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    /// Looks up one validated terminal runtime.
    fn runtime(&self, terminal_id: &str) -> Result<Arc<TerminalRuntime>, TerminalError> {
        validate_runtime_id(terminal_id, "terminal-", "terminalId")?;
        self.inner
            .state
            .lock()
            .map_err(|_| TerminalError::TerminalNotFound {
                terminal_id: terminal_id.to_owned(),
            })?
            .runtimes
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| TerminalError::TerminalNotFound {
                terminal_id: terminal_id.to_owned(),
            })
    }

    /// Returns whether Quit has closed manager admission.
    pub(crate) fn is_shutting_down(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.shutting_down)
            .unwrap_or(true)
    }

    /// Removes one failed pending launch and releases its pane gate.
    fn remove_pending(&self, pane_id: &str) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.pending.remove(pane_id);
        }
    }

    /// Performs bounded process cleanup and preserves state for a failed retry.
    async fn stop_runtime(&self, runtime: Arc<TerminalRuntime>) -> Result<(), TerminalError> {
        let _gate = runtime.control_gate.lock().await;
        let previous_state = {
            let mut dynamic = runtime
                .dynamic
                .lock()
                .map_err(|_| TerminalError::TerminationFailed)?;
            let previous = dynamic.state;
            if previous == TerminalProcessStateDto::Running {
                dynamic.state = TerminalProcessStateDto::Closing;
            }
            previous
        };
        let process = runtime
            .process()
            .map_err(|_| TerminalError::TerminationFailed)?;
        let cleanup_process = process.clone();
        let result = tauri::async_runtime::spawn_blocking(move || cleanup_process.terminate())
            .await
            .map_err(|_| TerminalError::TerminationFailed)?;
        if let Err(error) = result {
            if let Ok(mut dynamic) = runtime.dynamic.lock() {
                dynamic.state = previous_state;
            }
            return Err(error);
        }
        if process.is_alive() {
            if let Ok(mut dynamic) = runtime.dynamic.lock() {
                dynamic.state = previous_state;
            }
            return Err(TerminalError::TerminationFailed);
        }
        let deadline = Instant::now() + Duration::from_millis(1250);
        while !runtime
            .dynamic
            .lock()
            .map(|dynamic| dynamic.reader_eof)
            .unwrap_or(false)
        {
            if Instant::now() >= deadline {
                if let Ok(mut dynamic) = runtime.dynamic.lock() {
                    dynamic.state = if process.is_alive() {
                        previous_state
                    } else {
                        TerminalProcessStateDto::Failed
                    };
                }
                return Err(TerminalError::TerminationFailed);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        if previous_state == TerminalProcessStateDto::Running {
            if let Ok(mut dynamic) = runtime.dynamic.lock() {
                dynamic.state = TerminalProcessStateDto::Exited;
                dynamic.exit_code = None;
                dynamic.was_terminated = true;
                dynamic.needs_attention = false;
            }
            runtime.publish_current_activity();
            runtime.publish_state(TerminalStateChangeKindDto::ProcessChanged, true);
        }
        Ok(())
    }

    /// Removes all indexes and emits disposal for a published runtime.
    fn dispose_runtime(&self, runtime: &Arc<TerminalRuntime>) {
        runtime.stream.detach();
        let removed = self
            .inner
            .state
            .lock()
            .map(|mut state| {
                let runtime_removed = state.runtimes.remove(&runtime.id).is_some();
                let pending_removed = state
                    .pending
                    .get(&runtime.pane_id)
                    .is_some_and(|pending| pending.id == runtime.id)
                    && state.pending.remove(&runtime.pane_id).is_some();
                if state.pane_index.get(&runtime.pane_id) == Some(&runtime.id) {
                    state.pane_index.remove(&runtime.pane_id);
                }
                state.retained.retain(|_, id| id != &runtime.id);
                runtime_removed || pending_removed
            })
            .unwrap_or(false);
        if removed {
            runtime.publish_state(TerminalStateChangeKindDto::Disposed, true);
        }
    }
}

/// Runs one per-terminal resize queue and coalesces pending requests to the newest sequence.
fn start_resize_worker(
    runtime: &Arc<TerminalRuntime>,
    mut receiver: tokio::sync::mpsc::Receiver<ResizeRequest>,
) {
    let runtime = Arc::downgrade(runtime);
    tauri::async_runtime::spawn(async move {
        while let Some(first) = receiver.recv().await {
            let Some(runtime) = runtime.upgrade() else {
                break;
            };
            let mut requests = vec![first];
            while let Ok(request) = receiver.try_recv() {
                requests.push(request);
            }
            let _gate = runtime.control_gate.lock().await;
            // Requests accumulated behind input/close are folded into the same native resize.
            while let Ok(request) = receiver.try_recv() {
                requests.push(request);
            }
            let (process_state, applied_sequence, applied_size) = match runtime.dynamic.lock() {
                Ok(dynamic) => (dynamic.state, dynamic.resize_sequence, dynamic.size),
                Err(_) => {
                    reply_to_resizes(requests, Err(TerminalError::ResizeFailed));
                    continue;
                }
            };
            if process_state != TerminalProcessStateDto::Running {
                reply_to_resizes(
                    requests,
                    Err(TerminalError::TerminalNotRunning {
                        terminal_id: runtime.id.clone(),
                    }),
                );
                continue;
            }
            let target = requests
                .iter()
                .filter(|request| request.sequence > applied_sequence)
                .max_by_key(|request| request.sequence)
                .map(|request| (request.sequence, request.size));
            let Some((target_sequence, target_size)) = target else {
                reply_to_resizes(
                    requests,
                    Ok(TerminalResizeAckDto {
                        accepted_sequence: applied_sequence.to_string(),
                        size: applied_size,
                    }),
                );
                continue;
            };
            let result = match runtime.process() {
                Ok(process) => {
                    tauri::async_runtime::spawn_blocking(move || process.resize(target_size))
                        .await
                        .map_err(|_| TerminalError::ResizeFailed)
                        .and_then(|result| result.map_err(|_| TerminalError::ResizeFailed))
                }
                Err(_) => Err(TerminalError::ResizeFailed),
            };
            let response = match result {
                Ok(()) => runtime
                    .dynamic
                    .lock()
                    .map(|mut dynamic| {
                        if target_sequence > dynamic.resize_sequence {
                            dynamic.resize_sequence = target_sequence;
                            dynamic.size = target_size;
                        }
                        TerminalResizeAckDto {
                            accepted_sequence: dynamic.resize_sequence.to_string(),
                            size: dynamic.size,
                        }
                    })
                    .map_err(|_| TerminalError::ResizeFailed),
                Err(error) => Err(error),
            };
            reply_to_resizes(requests, response);
        }
    });
}

/// Completes every request in one coalesced resize batch with the same applied snapshot.
fn reply_to_resizes(
    requests: Vec<ResizeRequest>,
    response: Result<TerminalResizeAckDto, TerminalError>,
) {
    for request in requests {
        let _ = request.reply.send(response.clone());
    }
}

impl TerminalManagerWeak {
    /// Upgrades the delegate while the application still owns the manager.
    pub fn upgrade(&self) -> Option<TerminalManager> {
        self.0.upgrade().map(|inner| TerminalManager { inner })
    }
}

/// Releases one pane launch gate on every success, error, or caller cancellation path.
struct LaunchReservation {
    inner: Arc<TerminalManagerInner>,
    pane_id: String,
    preserve_pending: bool,
}

impl Drop for LaunchReservation {
    /// Removes only this scoped launch reservation.
    fn drop(&mut self) {
        let pending = self.inner.state.lock().ok().and_then(|mut state| {
            state.launch_gates.remove(&self.pane_id);
            (!self.preserve_pending)
                .then(|| state.pending.remove(&self.pane_id))
                .flatten()
        });
        if let Some(runtime) = pending
            && let Ok(process) = runtime.process()
        {
            // A cancelled invoke cannot await cleanup, so a detached worker owns it.
            let _ = std::thread::Builder::new()
                .name("xwork-terminal-cancel-cleanup".to_owned())
                .spawn(move || {
                    let _ = process.terminate();
                });
        }
    }
}

impl TerminalRuntime {
    /// Returns a safe snapshot without launch or process data.
    fn snapshot(&self) -> TerminalDto {
        let dynamic = self.dynamic.lock().expect("terminal runtime lock poisoned");
        TerminalDto {
            id: self.id.clone(),
            session_id: self.session_id.clone(),
            tab_id: self.tab_id.clone(),
            pane_id: self.pane_id.clone(),
            profile_id: self.profile_id.clone(),
            title: self.title.clone(),
            size: dynamic.size,
            state: dynamic.state,
            exit_code: dynamic.exit_code.clone(),
            was_terminated: dynamic.was_terminated,
            needs_attention: dynamic.needs_attention,
            output_subscribed: self.stream.is_subscribed(),
            latest_output_sequence: self.stream.latest_sequence().to_string(),
        }
    }

    /// Returns the spawned process or a safe lifecycle failure.
    fn process(&self) -> Result<Arc<dyn PtyProcess>, TerminalError> {
        self.process
            .lock()
            .map_err(|_| TerminalError::ProcessIoFailed)?
            .clone()
            .ok_or(TerminalError::ProcessSpawnFailed)
    }

    /// Accepts raw bytes, records real output, and propagates recognized attention.
    fn accept_output(self: &Arc<Self>, bytes: &[u8]) {
        let result = self.stream.publish(bytes);
        let (attached, attention_changed, record_edge) = self
            .dynamic
            .lock()
            .map(|mut dynamic| {
                let attention_changed = result.attention && !dynamic.needs_attention;
                dynamic.needs_attention |= result.attention;
                let now = Instant::now();
                let record_edge = dynamic.attached
                    && dynamic
                        .last_output_edge
                        .map(|last| now.duration_since(last) >= Duration::from_millis(100))
                        .unwrap_or(true);
                if record_edge {
                    dynamic.last_output_edge = Some(now);
                }
                (dynamic.attached, attention_changed, record_edge)
            })
            .unwrap_or((false, false, false));
        if attached && record_edge {
            self.record_output();
        }
        if attached && attention_changed {
            self.publish_attention();
        }
    }

    /// Marks reader EOF and attempts the wait/EOF final-state rendezvous.
    fn reader_finished(self: &Arc<Self>) {
        if let Ok(mut dynamic) = self.dynamic.lock() {
            dynamic.reader_eof = true;
        }
        self.finalize_if_ready();
    }

    /// Stores a child exit result and attempts the wait/EOF rendezvous.
    fn child_finished(self: &Arc<Self>, result: Result<Option<u32>, ()>) {
        if let Ok(mut dynamic) = self.dynamic.lock()
            && !dynamic.transport_failed
        {
            dynamic.child_result = Some(result);
        }
        self.finalize_if_ready();
    }

    /// Marks fatal transport failure and requests process-tree cleanup.
    fn transport_failed(self: &Arc<Self>) {
        if let Ok(mut dynamic) = self.dynamic.lock() {
            dynamic.transport_failed = true;
            dynamic.child_result = Some(Err(()));
        }
        if let Ok(process) = self.process() {
            tauri::async_runtime::spawn_blocking(move || {
                let _ = process.terminate();
            });
        }
        self.finalize_if_ready();
    }

    /// Commits natural final state only after both child completion and reader EOF.
    fn finalize_if_ready(self: &Arc<Self>) {
        let final_state = self.dynamic.lock().ok().and_then(|mut dynamic| {
            if !dynamic.reader_eof
                || dynamic.child_result.is_none()
                || dynamic.state != TerminalProcessStateDto::Running
            {
                return None;
            }
            match dynamic.child_result.take().expect("checked child result") {
                Ok(code) => {
                    dynamic.exit_code = code.map(|value| value.to_string());
                    dynamic.state = if code == Some(0) {
                        TerminalProcessStateDto::Exited
                    } else {
                        TerminalProcessStateDto::Failed
                    };
                }
                Err(()) => {
                    dynamic.exit_code = None;
                    dynamic.state = TerminalProcessStateDto::Failed;
                }
            }
            Some(dynamic.attached)
        });
        if final_state == Some(true) {
            self.publish_current_activity();
            self.publish_state(TerminalStateChangeKindDto::ProcessChanged, true);
        }
    }

    /// Records one output edge through the Sessions owner port.
    fn record_output(self: &Arc<Self>) {
        let dependencies = self.dependencies.clone();
        let pane_id = self.pane_id.clone();
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = dependencies.record_output(&pane_id).await {
                runtime.cleanup_if_owner_missing(&error).await;
            }
        });
    }

    /// Publishes the current activity snapshot through the Sessions owner port.
    fn publish_current_activity(self: &Arc<Self>) {
        let activity = self
            .dynamic
            .lock()
            .map(|dynamic| match dynamic.state {
                TerminalProcessStateDto::Running | TerminalProcessStateDto::Closing => {
                    TerminalActivity {
                        running_process_count: 1,
                        needs_attention: dynamic.needs_attention,
                        ..Default::default()
                    }
                }
                TerminalProcessStateDto::Exited if !dynamic.was_terminated => TerminalActivity {
                    finished_process_count: 1,
                    ..Default::default()
                },
                TerminalProcessStateDto::Failed => TerminalActivity {
                    failed_process_count: 1,
                    ..Default::default()
                },
                _ => TerminalActivity::default(),
            })
            .unwrap_or_default();
        let dependencies = self.dependencies.clone();
        let pane_id = self.pane_id.clone();
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = dependencies.update_activity(&pane_id, activity).await {
                runtime.cleanup_if_owner_missing(&error).await;
            }
        });
    }

    /// Stops and disposes this runtime when its authoritative Sessions owner vanished.
    async fn cleanup_if_owner_missing(self: Arc<Self>, error: &TerminalError) {
        if !matches!(
            error,
            TerminalError::SessionNotFound { .. }
                | TerminalError::TabNotFound { .. }
                | TerminalError::PaneNotFound { .. }
        ) {
            return;
        }
        let Some(inner) = self.manager.upgrade() else {
            return;
        };
        let manager = TerminalManager { inner };
        if manager.stop_runtime(self.clone()).await.is_ok() {
            manager.dispose_runtime(&self);
        }
    }

    /// Publishes an attention transition to both owner activity and the state event.
    fn publish_attention(self: &Arc<Self>) {
        self.publish_current_activity();
        self.publish_state(TerminalStateChangeKindDto::AttentionChanged, false);
    }

    /// Marks a failed subscriber without changing process health.
    fn stream_detached(self: &Arc<Self>) {
        let attached = self
            .dynamic
            .lock()
            .map(|dynamic| dynamic.attached)
            .unwrap_or(false);
        if attached {
            self.publish_state(TerminalStateChangeKindDto::StreamDetached, false);
        }
    }

    /// Emits one best-effort safe state event.
    fn publish_state(&self, change: TerminalStateChangeKindDto, final_sequence: bool) {
        let attached = self
            .dynamic
            .lock()
            .map(|dynamic| dynamic.attached)
            .unwrap_or(false);
        if !attached && change != TerminalStateChangeKindDto::Disposed {
            return;
        }
        let _ = self.events.publish(TerminalStateChangedDto {
            change,
            terminal: self.snapshot(),
            final_output_sequence: final_sequence
                .then(|| self.stream.latest_sequence().to_string()),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        platform::shell::{ResolvedShell, ShellMode},
        terminal::{ResolvedCliLaunchKind, ResolvedCliProfile},
    };
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    /// Captures frames while accepting every send.
    struct CaptureSender(Mutex<Vec<Vec<u8>>>);

    impl FrameSender for CaptureSender {
        /// Stores one raw frame.
        fn send(&self, frame: Vec<u8>) -> Result<(), ()> {
            self.0.lock().expect("capture lock").push(frame);
            Ok(())
        }
    }

    /// Rejects every frame to simulate a detached Tauri Channel.
    struct RejectingSender;

    impl FrameSender for RejectingSender {
        /// Rejects one raw frame without blocking the dispatcher.
        fn send(&self, _frame: Vec<u8>) -> Result<(), ()> {
            Err(())
        }
    }

    /// Provides deterministic owner responses and an optional launch barrier.
    struct FakeDependencies {
        launches: AtomicUsize,
        root_lookups: AtomicUsize,
        profile_lookups: AtomicUsize,
        output_edges: AtomicUsize,
        activities: Mutex<Vec<TerminalActivity>>,
        attach_fails: AtomicBool,
        entered: tokio::sync::Notify,
        release: tokio::sync::Notify,
        block_launch: AtomicBool,
        attach_entered: tokio::sync::Notify,
        attach_release: tokio::sync::Notify,
        block_attach: AtomicBool,
        launch_error: Mutex<Option<TerminalError>>,
        root_error: Mutex<Option<TerminalError>>,
        profile_error: Mutex<Option<TerminalError>>,
        owner_missing: AtomicBool,
    }

    impl FakeDependencies {
        /// Creates owner ports that succeed immediately.
        fn new() -> Self {
            Self {
                launches: AtomicUsize::new(0),
                root_lookups: AtomicUsize::new(0),
                profile_lookups: AtomicUsize::new(0),
                output_edges: AtomicUsize::new(0),
                activities: Mutex::new(Vec::new()),
                attach_fails: AtomicBool::new(false),
                entered: tokio::sync::Notify::new(),
                release: tokio::sync::Notify::new(),
                block_launch: AtomicBool::new(false),
                attach_entered: tokio::sync::Notify::new(),
                attach_release: tokio::sync::Notify::new(),
                block_attach: AtomicBool::new(false),
                launch_error: Mutex::new(None),
                root_error: Mutex::new(None),
                profile_error: Mutex::new(None),
                owner_missing: AtomicBool::new(false),
            }
        }
    }

    impl TerminalDependencies for FakeDependencies {
        /// Returns one fixed matching pane after the optional barrier.
        fn launch_target<'a>(
            &'a self,
            session_id: &'a str,
            tab_id: &'a str,
            pane_id: &'a str,
        ) -> super::super::TerminalFuture<'a, Result<super::super::TerminalPaneTarget, TerminalError>>
        {
            Box::pin(async move {
                self.launches.fetch_add(1, Ordering::SeqCst);
                self.entered.notify_waiters();
                if self.block_launch.load(Ordering::SeqCst) {
                    self.release.notified().await;
                }
                if let Some(error) = self.launch_error.lock().expect("launch error lock").clone() {
                    return Err(error);
                }
                Ok(super::super::TerminalPaneTarget {
                    session_id: session_id.to_owned(),
                    tab_id: tab_id.to_owned(),
                    pane_id: pane_id.to_owned(),
                    project_id: "project-fixture".to_owned(),
                    profile_id: "builtin:terminal".to_owned(),
                    title: "Fixture Shell".to_owned(),
                })
            })
        }

        /// Returns an isolated synthetic root consumed only by the fake factory.
        fn available_project_root<'a>(
            &'a self,
            _project_id: &'a str,
        ) -> super::super::TerminalFuture<'a, Result<std::path::PathBuf, TerminalError>> {
            Box::pin(async move {
                self.root_lookups.fetch_add(1, Ordering::SeqCst);
                if let Some(error) = self.root_error.lock().expect("root error lock").clone() {
                    return Err(error);
                }
                Ok(std::path::PathBuf::from("fixture-root"))
            })
        }

        /// Returns one structured built-in shell profile without credentials.
        fn resolve_profile<'a>(
            &'a self,
            _profile_id: &'a str,
        ) -> super::super::TerminalFuture<'a, Result<ResolvedCliProfile, TerminalError>> {
            Box::pin(async move {
                self.profile_lookups.fetch_add(1, Ordering::SeqCst);
                if let Some(error) = self
                    .profile_error
                    .lock()
                    .expect("profile error lock")
                    .clone()
                {
                    return Err(error);
                }
                Ok(ResolvedCliProfile {
                    profile_id: "builtin:terminal".to_owned(),
                    display_name: "Fixture Shell".to_owned(),
                    launch_kind: ResolvedCliLaunchKind::InteractiveShell {
                        shell: ResolvedShell {
                            id: "fixture".to_owned(),
                            display_name: "Fixture".to_owned(),
                            command: "fixture".to_owned(),
                            executable: "fixture.exe".into(),
                            mode: ShellMode::PowerShell,
                        },
                    },
                    environment: Vec::new(),
                })
            })
        }

        /// Optionally injects the authoritative attach race.
        fn attach_terminal<'a>(
            &'a self,
            _target: &'a super::super::TerminalPaneTarget,
            _terminal_id: &'a str,
        ) -> super::super::TerminalFuture<'a, Result<(), TerminalError>> {
            Box::pin(async move {
                self.attach_entered.notify_waiters();
                if self.block_attach.load(Ordering::SeqCst) {
                    self.attach_release.notified().await;
                }
                if self.attach_fails.load(Ordering::SeqCst) {
                    Err(TerminalError::SessionAttachFailed)
                } else {
                    Ok(())
                }
            })
        }

        /// Accepts output aggregation without external state.
        fn record_output<'a>(
            &'a self,
            _pane_id: &'a str,
        ) -> super::super::TerminalFuture<'a, Result<(), TerminalError>> {
            Box::pin(async move {
                if self.owner_missing.load(Ordering::SeqCst) {
                    return Err(TerminalError::PaneNotFound {
                        pane_id: "pane-3".to_owned(),
                    });
                }
                self.output_edges.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        }

        /// Accepts activity aggregation without external state.
        fn update_activity<'a>(
            &'a self,
            _pane_id: &'a str,
            _activity: TerminalActivity,
        ) -> super::super::TerminalFuture<'a, Result<(), TerminalError>> {
            Box::pin(async move {
                if self.owner_missing.load(Ordering::SeqCst) {
                    return Err(TerminalError::PaneNotFound {
                        pane_id: "pane-3".to_owned(),
                    });
                }
                self.activities
                    .lock()
                    .expect("activities lock")
                    .push(_activity);
                Ok(())
            })
        }
    }

    /// Names the fake child completion callback used by the test process.
    type FakeExitCallback = Arc<dyn Fn(Result<Option<u32>, ()>) + Send + Sync>;
    /// Names the fake raw output callback used by the test process.
    type FakeOutputCallback = Arc<dyn Fn(Vec<u8>) + Send + Sync>;
    /// Names the fake fatal transport callback used by the test process.
    type FakeFailureCallback = Arc<dyn Fn() + Send + Sync>;

    /// Stores fake control effects and process aliveness.
    struct FakeProcess {
        alive: AtomicBool,
        writes: Mutex<Vec<Vec<u8>>>,
        size: Mutex<PtySizeDto>,
        eof: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
        exited: Mutex<Option<FakeExitCallback>>,
        output: Mutex<Option<FakeOutputCallback>>,
        failed: Mutex<Option<FakeFailureCallback>>,
        write_entered: AtomicBool,
        write_blocks: AtomicBool,
        resize_calls: AtomicUsize,
        terminate_calls: AtomicUsize,
        resize_fails: AtomicBool,
        terminate_fails: AtomicBool,
        terminate_keeps_alive: AtomicBool,
        suppress_eof: AtomicBool,
    }

    impl FakeProcess {
        /// Emits one deterministic fake output chunk through the production callback path.
        fn emit_output(&self, bytes: &[u8]) {
            if let Some(output) = self.output.lock().expect("output lock").as_ref() {
                output(bytes.to_vec());
            }
        }

        /// Reports root-child completion without implying reader EOF.
        fn emit_exit(&self, result: Result<Option<u32>, ()>) {
            self.alive.store(false, Ordering::SeqCst);
            if let Some(exited) = self.exited.lock().expect("exit lock").as_ref() {
                exited(result);
            }
        }

        /// Reports reader EOF independently from root-child completion.
        fn emit_eof(&self) {
            if let Some(eof) = self.eof.lock().expect("EOF lock").take() {
                eof();
            }
        }

        /// Reports one fatal transport failure through the production callback path.
        fn emit_failure(&self) {
            if let Some(failed) = self.failed.lock().expect("failure lock").as_ref() {
                failed();
            }
        }
    }

    impl PtyProcess for FakeProcess {
        /// Captures one complete write.
        fn write(&self, bytes: &[u8]) -> Result<(), TerminalError> {
            self.write_entered.store(true, Ordering::SeqCst);
            while self.write_blocks.load(Ordering::SeqCst) {
                std::thread::yield_now();
            }
            self.writes
                .lock()
                .expect("writes lock")
                .push(bytes.to_vec());
            Ok(())
        }
        /// Captures one applied size.
        fn resize(&self, size: PtySizeDto) -> Result<(), TerminalError> {
            self.resize_calls.fetch_add(1, Ordering::SeqCst);
            if self.resize_fails.load(Ordering::SeqCst) {
                return Err(TerminalError::ResizeFailed);
            }
            *self.size.lock().expect("size lock") = size;
            Ok(())
        }
        /// Marks the complete fake process tree stopped.
        fn terminate(&self) -> Result<(), TerminalError> {
            self.terminate_calls.fetch_add(1, Ordering::SeqCst);
            if self.terminate_fails.load(Ordering::SeqCst) {
                return Err(TerminalError::TerminationFailed);
            }
            if !self.terminate_keeps_alive.load(Ordering::SeqCst) {
                self.alive.store(false, Ordering::SeqCst);
            }
            if !self.suppress_eof.load(Ordering::SeqCst) {
                self.emit_eof();
            }
            Ok(())
        }
        /// Returns the current fake aliveness.
        fn is_alive(&self) -> bool {
            self.alive.load(Ordering::SeqCst)
        }
    }

    /// Spawns fake processes and emits output before Sessions attachment.
    struct FakeFactory {
        process: Arc<FakeProcess>,
        spawns: AtomicUsize,
    }

    impl PtyFactory for FakeFactory {
        /// Returns the shared fake after one pending output chunk.
        fn spawn(
            &self,
            _profile: ResolvedCliProfile,
            _cwd: std::path::PathBuf,
            _size: PtySizeDto,
            callbacks: PtyCallbacks,
        ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
            self.spawns.fetch_add(1, Ordering::SeqCst);
            (callbacks.output)(b"pending-output".to_vec());
            *self.process.eof.lock().expect("EOF lock") = Some(callbacks.eof);
            *self.process.exited.lock().expect("exit lock") = Some(callbacks.exited);
            *self.process.output.lock().expect("output lock") = Some(callbacks.output);
            *self.process.failed.lock().expect("failure lock") = Some(callbacks.failed);
            Ok(self.process.clone())
        }
    }

    /// Creates one independent fake process with successful default behavior.
    fn fake_process() -> Arc<FakeProcess> {
        Arc::new(FakeProcess {
            alive: AtomicBool::new(true),
            writes: Mutex::new(Vec::new()),
            size: Mutex::new(PtySizeDto {
                columns: 80,
                rows: 24,
            }),
            eof: Mutex::new(None),
            exited: Mutex::new(None),
            output: Mutex::new(None),
            failed: Mutex::new(None),
            write_entered: AtomicBool::new(false),
            write_blocks: AtomicBool::new(false),
            resize_calls: AtomicUsize::new(0),
            terminate_calls: AtomicUsize::new(0),
            resize_fails: AtomicBool::new(false),
            terminate_fails: AtomicBool::new(false),
            terminate_keeps_alive: AtomicBool::new(false),
            suppress_eof: AtomicBool::new(false),
        })
    }

    /// Binds production callbacks to one fake process and emits pending output.
    fn bind_fake_process(process: &Arc<FakeProcess>, callbacks: PtyCallbacks) {
        (callbacks.output)(b"pending-output".to_vec());
        *process.eof.lock().expect("EOF lock") = Some(callbacks.eof);
        *process.exited.lock().expect("exit lock") = Some(callbacks.exited);
        *process.output.lock().expect("output lock") = Some(callbacks.output);
        *process.failed.lock().expect("failure lock") = Some(callbacks.failed);
    }

    /// Spawns independent fake processes for multi-runtime shutdown tests.
    struct MultiFactory {
        processes: Mutex<Vec<Arc<FakeProcess>>>,
    }

    /// Emits output, attention, child exit, and EOF before returning the fake process.
    struct FastExitFactory {
        process: Arc<FakeProcess>,
    }

    /// Blocks process creation at a deterministic in-flight spawn barrier.
    struct BlockingFactory {
        process: Arc<FakeProcess>,
        entered: AtomicBool,
        release: AtomicBool,
    }

    impl PtyFactory for BlockingFactory {
        /// Waits at the spawn barrier before binding callbacks and returning the process.
        fn spawn(
            &self,
            _profile: ResolvedCliProfile,
            _cwd: std::path::PathBuf,
            _size: PtySizeDto,
            callbacks: PtyCallbacks,
        ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
            self.entered.store(true, Ordering::SeqCst);
            while !self.release.load(Ordering::SeqCst) {
                std::thread::yield_now();
            }
            bind_fake_process(&self.process, callbacks);
            Ok(self.process.clone())
        }
    }

    impl PtyFactory for FastExitFactory {
        /// Completes every callback while the runtime is still pending attachment.
        fn spawn(
            &self,
            _profile: ResolvedCliProfile,
            _cwd: std::path::PathBuf,
            _size: PtySizeDto,
            callbacks: PtyCallbacks,
        ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
            self.process.alive.store(false, Ordering::SeqCst);
            (callbacks.output)(b"early-output\x07".to_vec());
            (callbacks.exited)(Ok(Some(0)));
            (callbacks.eof)();
            Ok(self.process.clone())
        }
    }

    impl PtyFactory for MultiFactory {
        /// Creates and records one independently controllable fake process.
        fn spawn(
            &self,
            _profile: ResolvedCliProfile,
            _cwd: std::path::PathBuf,
            _size: PtySizeDto,
            callbacks: PtyCallbacks,
        ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
            let process = fake_process();
            bind_fake_process(&process, callbacks);
            self.processes
                .lock()
                .expect("processes lock")
                .push(process.clone());
            Ok(process)
        }
    }

    /// Discards every low-frequency state event.
    struct NoopEvents;
    impl TerminalEventSink for NoopEvents {
        /// Accepts the safe event.
        fn publish(&self, _event: TerminalStateChangedDto) -> Result<(), TerminalError> {
            Ok(())
        }
    }

    /// Captures safe state events and can inject best-effort publication failure.
    struct CaptureEvents {
        events: Mutex<Vec<TerminalStateChangedDto>>,
        fails: AtomicBool,
    }

    impl TerminalEventSink for CaptureEvents {
        /// Captures one event or returns the configured synthetic failure.
        fn publish(&self, event: TerminalStateChangedDto) -> Result<(), TerminalError> {
            if self.fails.load(Ordering::SeqCst) {
                return Err(TerminalError::ProcessIoFailed);
            }
            self.events.lock().expect("events lock").push(event);
            Ok(())
        }
    }

    /// Builds one manager and exposes its fake collaborators.
    fn harness() -> (TerminalManager, Arc<FakeDependencies>, Arc<FakeFactory>) {
        let dependencies = Arc::new(FakeDependencies::new());
        let process = fake_process();
        let factory = Arc::new(FakeFactory {
            process,
            spawns: AtomicUsize::new(0),
        });
        (
            TerminalManager::new(dependencies.clone(), Arc::new(NoopEvents), factory.clone()),
            dependencies,
            factory,
        )
    }

    /// Waits for one asynchronous fake dependency counter to reach a value.
    fn wait_for_count(counter: &AtomicUsize, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while counter.load(Ordering::SeqCst) < expected {
            assert!(Instant::now() < deadline, "fake callback should complete");
            std::thread::yield_now();
        }
    }

    /// Verifies launch, pending output, ordered control, and retained reopen behavior.
    #[test]
    fn launch_control_and_reopen_preserve_identity() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let sender = Arc::new(CaptureSender(Mutex::new(Vec::new())));
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    sender,
                )
                .await
                .expect("launch should succeed");
            assert_eq!(terminal.latest_output_sequence, "1");
            assert_eq!(factory.spawns.load(Ordering::SeqCst), 1);
            assert_eq!(
                manager
                    .write_terminal(&terminal.id, "1", "\0\u{3}".to_owned())
                    .await
                    .expect("input should succeed")
                    .accepted_sequence,
                "1"
            );
            assert_eq!(
                manager
                    .resize_terminal(
                        &terminal.id,
                        "1",
                        PtySizeDto {
                            columns: 100,
                            rows: 30
                        }
                    )
                    .await
                    .expect("resize should succeed")
                    .size
                    .columns,
                100
            );
            let handle = manager
                .close_for_session(&terminal.id, CloseRetention::ReopenLastTab)
                .await
                .expect("close should succeed")
                .expect("retain should return a handle");
            let reopened = manager
                .reopen_for_session(handle)
                .await
                .expect("reopen should succeed");
            assert!(
                matches!(reopened, PaneContentRef::Terminal { terminal_id, .. } if terminal_id == terminal.id)
            );
            assert_eq!(factory.spawns.load(Ordering::SeqCst), 1);
        });
    }

    /// Verifies a pane launch gate excludes a second request before resolution completes.
    #[test]
    fn pane_launch_gate_precedes_owner_queries() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            dependencies.block_launch.store(true, Ordering::SeqCst);
            let first_manager = manager.clone();
            let first = tauri::async_runtime::spawn(async move {
                first_manager
                    .start_with_sender(
                        "session-1",
                        "tab-2",
                        "pane-3",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await
            });
            dependencies.entered.notified().await;
            let second = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await;
            assert!(matches!(
                second,
                Err(TerminalError::TerminalAlreadyAttached { .. })
            ));
            dependencies.release.notify_waiters();
            first
                .await
                .expect("first task should join")
                .expect("first launch should succeed");
            assert_eq!(dependencies.launches.load(Ordering::SeqCst), 1);
            assert_eq!(factory.spawns.load(Ordering::SeqCst), 1);
        });
    }

    /// Verifies each authoritative launch-stage failure stops later lookups and spawning.
    #[test]
    fn launch_stage_failures_do_not_cross_owner_boundaries() {
        tauri::async_runtime::block_on(async {
            let launch = |manager: TerminalManager| async move {
                manager
                    .start_with_sender(
                        "session-1",
                        "tab-2",
                        "pane-3",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await
            };

            let (manager, dependencies, factory) = harness();
            *dependencies.launch_error.lock().expect("launch error lock") =
                Some(TerminalError::PaneNotFound {
                    pane_id: "pane-3".to_owned(),
                });
            assert!(matches!(
                launch(manager).await,
                Err(TerminalError::PaneNotFound { .. })
            ));
            assert_eq!(dependencies.root_lookups.load(Ordering::SeqCst), 0);
            assert_eq!(dependencies.profile_lookups.load(Ordering::SeqCst), 0);
            assert_eq!(factory.spawns.load(Ordering::SeqCst), 0);

            for project_error in [
                TerminalError::ProjectNotFound {
                    project_id: "project-fixture".to_owned(),
                },
                TerminalError::ProjectUnavailable {
                    project_id: "project-fixture".to_owned(),
                },
            ] {
                let (manager, dependencies, factory) = harness();
                *dependencies.root_error.lock().expect("root error lock") = Some(project_error);
                assert!(launch(manager).await.is_err());
                assert_eq!(dependencies.profile_lookups.load(Ordering::SeqCst), 0);
                assert_eq!(factory.spawns.load(Ordering::SeqCst), 0);
            }

            for profile_error in [
                TerminalError::ProfileNotFound {
                    profile_id: "builtin:terminal".to_owned(),
                },
                TerminalError::ProfileUnavailable {
                    profile_id: "builtin:terminal".to_owned(),
                    reason: super::super::TerminalProfileUnavailableReasonDto::CommandNotFound,
                },
            ] {
                let (manager, dependencies, factory) = harness();
                *dependencies
                    .profile_error
                    .lock()
                    .expect("profile error lock") = Some(profile_error);
                assert!(launch(manager).await.is_err());
                assert_eq!(dependencies.root_lookups.load(Ordering::SeqCst), 1);
                assert_eq!(dependencies.profile_lookups.load(Ordering::SeqCst), 1);
                assert_eq!(factory.spawns.load(Ordering::SeqCst), 0);
            }
        });
    }

    /// Verifies an attach race terminates the spawned process before returning.
    #[test]
    fn attach_failure_compensates_the_spawn() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            dependencies.attach_fails.store(true, Ordering::SeqCst);
            let result = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await;
            assert_eq!(result, Err(TerminalError::SessionAttachFailed));
            assert!(!factory.process.is_alive());
            assert!(manager.get_terminal("terminal-1").await.is_err());
        });
    }

    /// Verifies output, attention, and natural exit before attach publish one truthful final state.
    #[test]
    fn fast_exit_before_attach_publishes_the_actual_final_snapshot() {
        tauri::async_runtime::block_on(async {
            let dependencies = Arc::new(FakeDependencies::new());
            let process = fake_process();
            let events = Arc::new(CaptureEvents {
                events: Mutex::new(Vec::new()),
                fails: AtomicBool::new(false),
            });
            let manager = TerminalManager::new(
                dependencies.clone(),
                events.clone(),
                Arc::new(FastExitFactory { process }),
            );
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("fast exit should still attach successfully");
            assert_eq!(terminal.state, TerminalProcessStateDto::Exited);
            assert_eq!(terminal.exit_code.as_deref(), Some("0"));
            assert!(terminal.needs_attention);
            assert_eq!(terminal.latest_output_sequence, "1");
            assert_eq!(
                events.events.lock().expect("events lock").as_slice(),
                &[TerminalStateChangedDto {
                    change: TerminalStateChangeKindDto::ProcessChanged,
                    terminal: terminal.clone(),
                    final_output_sequence: Some("1".to_owned()),
                }]
            );
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let latest_activity = dependencies
                    .activities
                    .lock()
                    .expect("activities lock")
                    .last()
                    .copied();
                if let Some(activity) = latest_activity {
                    assert_eq!(activity.finished_process_count, 1);
                    assert_eq!(activity.running_process_count, 0);
                    break;
                }
                assert!(Instant::now() < deadline, "activity should publish");
                tokio::task::yield_now().await;
            }
        });
    }

    /// Verifies sender failure during pending attach is reflected without early state events.
    #[test]
    fn pending_sender_failure_is_deferred_until_publication() {
        tauri::async_runtime::block_on(async {
            let dependencies = Arc::new(FakeDependencies::new());
            dependencies.block_attach.store(true, Ordering::SeqCst);
            let process = fake_process();
            let factory = Arc::new(FakeFactory {
                process,
                spawns: AtomicUsize::new(0),
            });
            let events = Arc::new(CaptureEvents {
                events: Mutex::new(Vec::new()),
                fails: AtomicBool::new(false),
            });
            let manager = TerminalManager::new(dependencies.clone(), events.clone(), factory);
            let launch_manager = manager.clone();
            let launch = tauri::async_runtime::spawn(async move {
                launch_manager
                    .start_with_sender(
                        "session-1",
                        "tab-2",
                        "pane-3",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(RejectingSender),
                    )
                    .await
            });
            dependencies.attach_entered.notified().await;
            let pending = manager
                .inner
                .state
                .lock()
                .expect("manager state lock")
                .pending
                .get("pane-3")
                .cloned()
                .expect("runtime should remain pending");
            let deadline = Instant::now() + Duration::from_secs(2);
            while pending.stream.is_subscribed() {
                assert!(Instant::now() < deadline, "failed sender should detach");
                std::thread::yield_now();
            }
            assert!(!pending.dynamic.lock().expect("runtime lock").attached);
            assert!(events.events.lock().expect("events lock").is_empty());
            dependencies.attach_release.notify_waiters();
            let terminal = launch
                .await
                .expect("launch task should join")
                .expect("detached output must not fail process launch");
            assert!(!terminal.output_subscribed);
            assert_eq!(terminal.latest_output_sequence, "1");
        });
    }

    /// Verifies failed attach cleanup remains pending so shutdown can retry it.
    #[test]
    fn attach_cleanup_failure_is_retained_for_shutdown_retry() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            dependencies.attach_fails.store(true, Ordering::SeqCst);
            factory
                .process
                .terminate_fails
                .store(true, Ordering::SeqCst);
            let result = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await;
            assert_eq!(result, Err(TerminalError::TerminationFailed));
            assert!(factory.process.is_alive());
            assert!(manager.get_terminal("terminal-1").await.is_err());

            factory
                .process
                .terminate_fails
                .store(false, Ordering::SeqCst);
            manager
                .shutdown_remaining()
                .await
                .expect("shutdown should retry pending cleanup");
            assert!(!factory.process.is_alive());
            assert_eq!(factory.process.terminate_calls.load(Ordering::SeqCst), 2);
        });
    }

    /// Verifies cancelling an invoke during owner attach removes pending state and the process.
    #[test]
    fn caller_cancellation_during_attach_cleans_pending_process() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            dependencies.block_attach.store(true, Ordering::SeqCst);
            let launch_manager = manager.clone();
            let launch = tauri::async_runtime::spawn(async move {
                launch_manager
                    .start_with_sender(
                        "session-1",
                        "tab-2",
                        "pane-3",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await
            });
            dependencies.attach_entered.notified().await;
            launch.abort();
            assert!(launch.await.is_err());
            let deadline = Instant::now() + Duration::from_secs(2);
            while factory.process.is_alive() {
                assert!(Instant::now() < deadline, "cancel cleanup should terminate");
                tokio::task::yield_now().await;
            }
            assert!(manager.get_terminal("terminal-1").await.is_err());
            assert_eq!(factory.process.terminate_calls.load(Ordering::SeqCst), 1);
        });
    }

    /// Verifies an attach completion after Quit cannot republish an already-cleaned runtime.
    #[test]
    fn shutdown_during_attach_prevents_runtime_republication() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            dependencies.block_attach.store(true, Ordering::SeqCst);
            let launch_manager = manager.clone();
            let launch = tauri::async_runtime::spawn(async move {
                launch_manager
                    .start_with_sender(
                        "session-1",
                        "tab-2",
                        "pane-3",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await
            });
            dependencies.attach_entered.notified().await;
            manager
                .shutdown_remaining()
                .await
                .expect("pending runtime cleanup should succeed");
            dependencies.attach_release.notify_waiters();
            assert_eq!(
                launch.await.expect("launch task should join"),
                Err(TerminalError::RuntimeShuttingDown)
            );
            assert!(!factory.process.is_alive());
            assert!(manager.get_terminal("terminal-1").await.is_err());
        });
    }

    /// Verifies Quit during root resolution prevents all later profile and spawn work.
    #[test]
    fn shutdown_during_owner_resolution_prevents_spawn() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            dependencies.block_launch.store(true, Ordering::SeqCst);
            let launch_manager = manager.clone();
            let launch = tauri::async_runtime::spawn(async move {
                launch_manager
                    .start_with_sender(
                        "session-1",
                        "tab-2",
                        "pane-3",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await
            });
            dependencies.entered.notified().await;
            manager
                .shutdown_remaining()
                .await
                .expect("no process exists yet, so shutdown should succeed");
            dependencies.release.notify_waiters();
            assert_eq!(
                launch.await.expect("launch task should join"),
                Err(TerminalError::RuntimeShuttingDown)
            );
            assert_eq!(dependencies.root_lookups.load(Ordering::SeqCst), 0);
            assert_eq!(dependencies.profile_lookups.load(Ordering::SeqCst), 0);
            assert_eq!(factory.spawns.load(Ordering::SeqCst), 0);
        });
    }

    /// Verifies Quit during blocking spawn fails closed until the returned process is cleaned.
    #[test]
    fn shutdown_during_spawn_cleans_the_late_process() {
        tauri::async_runtime::block_on(async {
            let dependencies = Arc::new(FakeDependencies::new());
            let process = fake_process();
            let factory = Arc::new(BlockingFactory {
                process: process.clone(),
                entered: AtomicBool::new(false),
                release: AtomicBool::new(false),
            });
            let manager = TerminalManager::new(dependencies, Arc::new(NoopEvents), factory.clone());
            let launch_manager = manager.clone();
            let launch = tauri::async_runtime::spawn(async move {
                launch_manager
                    .start_with_sender(
                        "session-1",
                        "tab-2",
                        "pane-3",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while !factory.entered.load(Ordering::SeqCst) {
                assert!(Instant::now() < deadline, "spawn should reach its barrier");
                tokio::task::yield_now().await;
            }
            assert_eq!(
                manager.shutdown_remaining().await,
                Err(TerminalError::TerminationFailed)
            );
            factory.release.store(true, Ordering::SeqCst);
            assert_eq!(
                launch.await.expect("launch task should join"),
                Err(TerminalError::RuntimeShuttingDown)
            );
            assert!(!process.is_alive());
            manager
                .shutdown_remaining()
                .await
                .expect("shutdown retry should find no remaining process");
        });
    }

    /// Verifies input validation and acknowledgements advance only after a successful write.
    #[test]
    fn input_sequence_and_byte_limit_preserve_the_last_ack() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            assert!(matches!(
                manager
                    .write_terminal(&terminal.id, "2", "late".to_owned())
                    .await,
                Err(TerminalError::InputOutOfOrder {
                    expected_sequence,
                    received_sequence
                }) if expected_sequence == "1" && received_sequence == "2"
            ));
            assert_eq!(
                manager
                    .write_terminal(&terminal.id, "1", "\0\u{3}".to_owned())
                    .await
                    .expect("control input should succeed")
                    .accepted_sequence,
                "1"
            );
            assert_eq!(
                manager
                    .write_terminal(&terminal.id, "2", "x".repeat(65_537))
                    .await,
                Err(TerminalError::InputTooLarge { max_bytes: 65_536 })
            );
            assert_eq!(factory.process.writes.lock().expect("writes lock").len(), 1);
        });
    }

    /// Verifies stale resize is a no-op and native failure retains the applied size and ack.
    #[test]
    fn resize_ack_tracks_only_successfully_applied_sizes() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            let applied = PtySizeDto {
                columns: 100,
                rows: 30,
            };
            manager
                .resize_terminal(&terminal.id, "1", applied)
                .await
                .expect("first resize should succeed");
            let stale = manager
                .resize_terminal(
                    &terminal.id,
                    "1",
                    PtySizeDto {
                        columns: 120,
                        rows: 40,
                    },
                )
                .await
                .expect("duplicate resize should be idempotent");
            assert_eq!(stale.accepted_sequence, "1");
            assert_eq!(stale.size, applied);
            assert_eq!(factory.process.resize_calls.load(Ordering::SeqCst), 1);

            factory.process.resize_fails.store(true, Ordering::SeqCst);
            assert_eq!(
                manager
                    .resize_terminal(
                        &terminal.id,
                        "2",
                        PtySizeDto {
                            columns: 140,
                            rows: 50,
                        },
                    )
                    .await,
                Err(TerminalError::ResizeFailed)
            );
            let snapshot = manager
                .get_terminal(&terminal.id)
                .await
                .expect("terminal should remain available");
            assert_eq!(snapshot.size, applied);
            assert_eq!(snapshot.state, TerminalProcessStateDto::Running);
        });
    }

    /// Verifies a blocked control write cannot prevent the independent reader callback path.
    #[test]
    fn blocked_writer_does_not_block_output_ingestion() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            factory.process.write_blocks.store(true, Ordering::SeqCst);
            let writer_manager = manager.clone();
            let terminal_id = terminal.id.clone();
            let writer = tauri::async_runtime::spawn(async move {
                writer_manager
                    .write_terminal(&terminal_id, "1", "blocked".to_owned())
                    .await
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while !factory.process.write_entered.load(Ordering::SeqCst) {
                assert!(
                    Instant::now() < deadline,
                    "write should enter the fake process"
                );
                std::thread::yield_now();
            }
            factory.process.emit_output(b"reader-progress");
            assert_eq!(
                manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("terminal should remain queryable")
                    .latest_output_sequence,
                "2"
            );
            factory.process.write_blocks.store(false, Ordering::SeqCst);
            writer
                .await
                .expect("writer task should join")
                .expect("write should finish after release");
        });
    }

    /// Verifies resize requests waiting behind control work collapse to the newest sequence.
    #[test]
    fn pending_resizes_are_coalesced_before_native_control() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            let runtime = manager.runtime(&terminal.id).expect("runtime should exist");
            let gate = runtime.control_gate.lock().await;
            let first_manager = manager.clone();
            let first_id = terminal.id.clone();
            let first = tauri::async_runtime::spawn(async move {
                first_manager
                    .resize_terminal(
                        &first_id,
                        "2",
                        PtySizeDto {
                            columns: 100,
                            rows: 30,
                        },
                    )
                    .await
            });
            let second_manager = manager.clone();
            let second_id = terminal.id.clone();
            let second = tauri::async_runtime::spawn(async move {
                second_manager
                    .resize_terminal(
                        &second_id,
                        "3",
                        PtySizeDto {
                            columns: 120,
                            rows: 40,
                        },
                    )
                    .await
            });
            tokio::time::sleep(Duration::from_millis(20)).await;
            drop(gate);
            let first_ack = first
                .await
                .expect("first resize task should join")
                .expect("first resize should share the applied ack");
            let second_ack = second
                .await
                .expect("second resize task should join")
                .expect("second resize should succeed");
            assert_eq!(first_ack.accepted_sequence, "3");
            assert_eq!(second_ack.accepted_sequence, "3");
            assert_eq!(second_ack.size.columns, 120);
            assert_eq!(factory.process.resize_calls.load(Ordering::SeqCst), 1);
        });
    }

    /// Verifies natural final state waits for EOF and close still sweeps descendant ownership.
    #[test]
    fn natural_exit_joins_reader_eof_before_final_state() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            factory.process.emit_exit(Ok(Some(0)));
            assert_eq!(
                manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("terminal should exist")
                    .state,
                TerminalProcessStateDto::Running
            );
            factory.process.emit_output(b"final-output");
            factory.process.emit_eof();
            let final_snapshot = manager
                .get_terminal(&terminal.id)
                .await
                .expect("terminal should exist");
            assert_eq!(final_snapshot.state, TerminalProcessStateDto::Exited);
            assert_eq!(final_snapshot.exit_code.as_deref(), Some("0"));
            assert_eq!(final_snapshot.latest_output_sequence, "2");
            assert!(
                manager
                    .close_impact(&terminal.id)
                    .await
                    .expect("impact should resolve")
                    .running_process_labels
                    .is_empty()
            );
            manager
                .close_for_session(&terminal.id, CloseRetention::Discard)
                .await
                .expect("natural exit should still clean its process tree");
            assert_eq!(factory.process.terminate_calls.load(Ordering::SeqCst), 1);
        });
    }

    /// Verifies EOF may precede child wait while final bytes and signal state remain intact.
    #[test]
    fn reader_eof_can_precede_child_wait() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            factory.process.emit_output(b"final-before-eof");
            factory.process.emit_eof();
            assert_eq!(
                manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("terminal should exist")
                    .state,
                TerminalProcessStateDto::Running
            );
            factory.process.emit_exit(Ok(None));
            let snapshot = manager
                .get_terminal(&terminal.id)
                .await
                .expect("terminal should remain available");
            assert_eq!(snapshot.state, TerminalProcessStateDto::Failed);
            assert_eq!(snapshot.exit_code, None);
            assert_eq!(snapshot.latest_output_sequence, "2");
        });
    }

    /// Verifies fatal transport cleanup keeps already-sequenced output available.
    #[test]
    fn fatal_transport_failure_preserves_prior_output() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            factory.process.emit_output(b"preserved");
            factory.process.emit_failure();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let snapshot = manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("failed terminal should remain available");
                if snapshot.state == TerminalProcessStateDto::Failed {
                    assert_eq!(snapshot.latest_output_sequence, "2");
                    assert_eq!(snapshot.exit_code, None);
                    break;
                }
                assert!(Instant::now() < deadline, "failure cleanup should finish");
                tokio::task::yield_now().await;
            }
            assert!(!factory.process.is_alive());
            let replay = Arc::new(CaptureSender(Mutex::new(Vec::new())));
            let subscription = manager
                .subscribe_with_sender(&terminal.id, Some("0"), replay.clone())
                .await
                .expect("failed runtime output should remain replayable");
            assert_eq!(subscription.latest_sequence, "2");
            let deadline = Instant::now() + Duration::from_secs(2);
            while replay.0.lock().expect("capture lock").len() < 2 {
                assert!(Instant::now() < deadline, "retained output should replay");
                std::thread::yield_now();
            }
            assert_eq!(
                &replay.0.lock().expect("capture lock")[1][13..],
                b"preserved"
            );
        });
    }

    /// Verifies failed close restores retryable state and retention calls remain idempotent.
    #[test]
    fn close_failure_can_retry_reopen_and_discard_idempotently() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            assert_eq!(
                manager
                    .close_impact(&terminal.id)
                    .await
                    .expect("running impact should resolve")
                    .running_process_labels,
                vec!["Fixture Shell"]
            );
            factory
                .process
                .terminate_fails
                .store(true, Ordering::SeqCst);
            assert_eq!(
                manager
                    .close_for_session(&terminal.id, CloseRetention::ReopenLastTab)
                    .await,
                Err(TerminalError::TerminationFailed)
            );
            assert_eq!(
                manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("failed close should preserve runtime")
                    .state,
                TerminalProcessStateDto::Running
            );

            factory
                .process
                .terminate_fails
                .store(false, Ordering::SeqCst);
            let first = manager
                .close_for_session(&terminal.id, CloseRetention::ReopenLastTab)
                .await
                .expect("retry should succeed")
                .expect("retention should return a token");
            let second = manager
                .close_for_session(&terminal.id, CloseRetention::ReopenLastTab)
                .await
                .expect("repeated close should succeed")
                .expect("repeated retention should return a token");
            assert_eq!(first, second);
            let reopened = manager
                .reopen_for_session(first.clone())
                .await
                .expect("retained runtime should reopen");
            assert!(matches!(
                &reopened,
                PaneContentRef::Terminal { terminal_id, profile_id, title }
                    if terminal_id == &terminal.id
                        && profile_id == "builtin:terminal"
                        && title == "Fixture Shell"
            ));
            let retained = manager
                .get_terminal(&terminal.id)
                .await
                .expect("reopen should preserve the runtime snapshot");
            assert_eq!(retained.latest_output_sequence, "1");
            manager
                .discard_for_session(first.clone())
                .await
                .expect("discard should succeed");
            manager
                .discard_for_session(first)
                .await
                .expect("repeated discard should succeed");
            assert!(manager.get_terminal(&terminal.id).await.is_err());
            assert_eq!(factory.spawns.load(Ordering::SeqCst), 1);
        });
    }

    /// Verifies a false successful terminate result cannot close a still-live process.
    #[test]
    fn close_requires_observed_process_termination() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            factory
                .process
                .terminate_keeps_alive
                .store(true, Ordering::SeqCst);
            assert_eq!(
                manager
                    .close_for_session(&terminal.id, CloseRetention::Discard)
                    .await,
                Err(TerminalError::TerminationFailed)
            );
            assert!(factory.process.is_alive());
            assert_eq!(
                manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("runtime should remain retryable")
                    .state,
                TerminalProcessStateDto::Running
            );
            factory
                .process
                .terminate_keeps_alive
                .store(false, Ordering::SeqCst);
            manager
                .close_for_session(&terminal.id, CloseRetention::Discard)
                .await
                .expect("retry should observe termination");
        });
    }

    /// Verifies reader-drain timeout is surfaced and a later EOF permits cleanup retry.
    #[test]
    fn reader_drain_timeout_preserves_runtime_for_retry() {
        tauri::async_runtime::block_on(async {
            let (manager, _, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            factory.process.suppress_eof.store(true, Ordering::SeqCst);
            assert_eq!(
                manager
                    .close_for_session(&terminal.id, CloseRetention::ReopenLastTab)
                    .await,
                Err(TerminalError::TerminationFailed)
            );
            assert_eq!(
                manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("timed-out runtime should remain retryable")
                    .state,
                TerminalProcessStateDto::Failed
            );
            factory.process.emit_eof();
            factory.process.suppress_eof.store(false, Ordering::SeqCst);
            assert!(
                manager
                    .close_for_session(&terminal.id, CloseRetention::ReopenLastTab)
                    .await
                    .expect("retry after EOF should succeed")
                    .is_some()
            );
        });
    }

    /// Verifies pending-output synchronization establishes the throttle boundary.
    #[test]
    fn attached_output_edges_are_throttled_after_pending_output() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            wait_for_count(&dependencies.output_edges, 1);
            factory.process.emit_output(b"near-one");
            factory.process.emit_output(b"near-two");
            std::thread::sleep(Duration::from_millis(20));
            assert_eq!(dependencies.output_edges.load(Ordering::SeqCst), 1);
            tokio::time::sleep(Duration::from_millis(110)).await;
            factory.process.emit_output(b"later");
            wait_for_count(&dependencies.output_edges, 2);
        });
    }

    /// Verifies attention and final events carry safe snapshots and tolerate sink failure.
    #[test]
    fn attention_and_final_events_follow_committed_runtime_state() {
        tauri::async_runtime::block_on(async {
            let dependencies = Arc::new(FakeDependencies::new());
            let process = fake_process();
            let factory = Arc::new(FakeFactory {
                process: process.clone(),
                spawns: AtomicUsize::new(0),
            });
            let events = Arc::new(CaptureEvents {
                events: Mutex::new(Vec::new()),
                fails: AtomicBool::new(false),
            });
            let manager = TerminalManager::new(dependencies, events.clone(), factory.clone());
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            process.emit_output(b"\x07");
            let attention = manager
                .get_terminal(&terminal.id)
                .await
                .expect("terminal should exist");
            assert!(attention.needs_attention);
            assert!(
                events
                    .events
                    .lock()
                    .expect("events lock")
                    .iter()
                    .any(
                        |event| event.change == TerminalStateChangeKindDto::AttentionChanged
                            && event.terminal.needs_attention
                            && event.final_output_sequence.is_none()
                    )
            );

            events.fails.store(true, Ordering::SeqCst);
            let acknowledged = manager
                .acknowledge_terminal_attention(&terminal.id)
                .await
                .expect("event failure must not change command success");
            assert!(!acknowledged.needs_attention);
            events.fails.store(false, Ordering::SeqCst);

            process.emit_exit(Ok(Some(7)));
            process.emit_output(b"final");
            assert_eq!(
                manager
                    .get_terminal(&terminal.id)
                    .await
                    .expect("terminal should exist")
                    .state,
                TerminalProcessStateDto::Running
            );
            process.emit_eof();
            let final_snapshot = manager
                .get_terminal(&terminal.id)
                .await
                .expect("terminal should remain retained");
            assert_eq!(final_snapshot.state, TerminalProcessStateDto::Failed);
            assert_eq!(final_snapshot.exit_code.as_deref(), Some("7"));
            assert!(
                events
                    .events
                    .lock()
                    .expect("events lock")
                    .iter()
                    .any(
                        |event| event.change == TerminalStateChangeKindDto::ProcessChanged
                            && event.final_output_sequence.as_deref() == Some("3")
                            && event.terminal.state == TerminalProcessStateDto::Failed
                    )
            );
        });
    }

    /// Verifies an owner disappearance during activity propagation cleans the orphan runtime.
    #[test]
    fn owner_disappearance_triggers_orphan_cleanup() {
        tauri::async_runtime::block_on(async {
            let (manager, dependencies, factory) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            dependencies.owner_missing.store(true, Ordering::SeqCst);
            factory.process.emit_output(b"\x07");
            let deadline = Instant::now() + Duration::from_secs(2);
            while manager.get_terminal(&terminal.id).await.is_ok() {
                assert!(Instant::now() < deadline, "orphan cleanup should finish");
                tokio::task::yield_now().await;
            }
            assert!(!factory.process.is_alive());
            assert_eq!(factory.process.terminate_calls.load(Ordering::SeqCst), 1);
        });
    }

    /// Verifies shutdown admission closes before cleanup and a fresh manager restores nothing.
    #[test]
    fn shutdown_gate_rejects_new_control_and_clears_stopped_runtimes() {
        tauri::async_runtime::block_on(async {
            let (manager, _, _) = harness();
            let terminal = manager
                .start_with_sender(
                    "session-1",
                    "tab-2",
                    "pane-3",
                    PtySizeDto {
                        columns: 80,
                        rows: 24,
                    },
                    Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                )
                .await
                .expect("launch should succeed");
            manager.begin_shutdown();
            assert_eq!(
                manager
                    .write_terminal(&terminal.id, "1", "blocked".to_owned())
                    .await,
                Err(TerminalError::RuntimeShuttingDown)
            );
            assert_eq!(
                manager
                    .resize_terminal(
                        &terminal.id,
                        "1",
                        PtySizeDto {
                            columns: 90,
                            rows: 25,
                        },
                    )
                    .await,
                Err(TerminalError::RuntimeShuttingDown)
            );
            assert!(matches!(
                manager
                    .start_with_sender(
                        "session-4",
                        "tab-5",
                        "pane-6",
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await,
                Err(TerminalError::RuntimeShuttingDown)
            ));
            manager
                .shutdown_remaining()
                .await
                .expect("shutdown cleanup should succeed");
            assert!(manager.get_terminal(&terminal.id).await.is_err());
            let (fresh, _, _) = harness();
            assert!(fresh.get_terminal("terminal-1").await.is_err());
        });
    }

    /// Verifies one cleanup failure cannot skip another runtime and shutdown can retry.
    #[test]
    fn shutdown_attempts_every_runtime_and_retries_only_remaining_work() {
        tauri::async_runtime::block_on(async {
            let dependencies = Arc::new(FakeDependencies::new());
            let factory = Arc::new(MultiFactory {
                processes: Mutex::new(Vec::new()),
            });
            let manager = TerminalManager::new(dependencies, Arc::new(NoopEvents), factory.clone());
            for (tab, pane) in [("tab-2", "pane-3"), ("tab-5", "pane-6")] {
                manager
                    .start_with_sender(
                        "session-1",
                        tab,
                        pane,
                        PtySizeDto {
                            columns: 80,
                            rows: 24,
                        },
                        Arc::new(CaptureSender(Mutex::new(Vec::new()))),
                    )
                    .await
                    .expect("each terminal should launch");
            }
            let processes = factory.processes.lock().expect("processes lock").clone();
            processes[0].terminate_fails.store(true, Ordering::SeqCst);
            assert_eq!(
                manager.shutdown_remaining().await,
                Err(TerminalError::TerminationFailed)
            );
            assert!(processes[0].is_alive());
            assert!(!processes[1].is_alive());
            assert!(manager.get_terminal("terminal-1").await.is_ok());
            assert!(manager.get_terminal("terminal-2").await.is_err());

            processes[0].terminate_fails.store(false, Ordering::SeqCst);
            manager
                .shutdown_remaining()
                .await
                .expect("shutdown retry should clean the remaining runtime");
            assert!(!processes[0].is_alive());
            assert!(manager.get_terminal("terminal-1").await.is_err());
            assert_eq!(processes[1].terminate_calls.load(Ordering::SeqCst), 1);
        });
    }
}
