// Sessions errors intentionally preserve the complete confirmation impact payload.
#![allow(clippy::result_large_err)]

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock, Weak},
};

use tauri::{AppHandle, Emitter, Runtime};

use super::{
    lifecycle::{
        AppLifecycleError, AppRuntime, AppRuntimeFuture, AttentionSession, QuitSummaryDto,
    },
    tray::refresh_attention_menu,
};
use crate::{
    projects::{
        ProjectFuture, ProjectRuntimeGuard, ProjectRuntimeImpact, ProjectService, ProjectsError,
    },
    sessions::{
        CliProfileLookup, CloseRetention, LaunchableProfile, PaneCloseImpact, PaneContentDto,
        PaneContentOwner, PaneContentRef, PaneContentRuntime, PaneLayoutNodeDto, PaneRuntimeFuture,
        ProjectSessionAccess, ProjectSessionAvailability, ReopenHandle,
        SESSION_RUNTIME_CHANGED_EVENT, SessionEventSink, SessionManager, SessionRuntimeEventDto,
        SessionsError,
    },
    terminal::{
        CliProfilesError, CliProfilesService, ResolvedCliProfile, TERMINAL_STATE_CHANGED_EVENT,
        TerminalActivity, TerminalDependencies, TerminalError, TerminalEventSink, TerminalFuture,
        TerminalManager, TerminalManagerWeak, TerminalPaneTarget,
        TerminalProfileUnavailableReasonDto, TerminalStateChangedDto,
    },
};

/// Adapts the public Projects service to the narrow Sessions consumer port.
pub(crate) struct SessionsProjectAccess {
    projects: ProjectService,
}

impl SessionsProjectAccess {
    /// Creates the adapter around the public Projects owner.
    pub(crate) fn new(projects: ProjectService) -> Self {
        Self { projects }
    }
}

impl ProjectSessionAccess for SessionsProjectAccess {
    /// Maps current project availability into the Sessions-owned contract.
    fn session_availability<'a>(
        &'a self,
        project_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<ProjectSessionAvailability, SessionsError>> {
        Box::pin(async move {
            match self.projects.session_availability(project_id).await {
                Ok(snapshot) if snapshot.is_available => Ok(ProjectSessionAvailability::Available),
                Ok(_) => Ok(ProjectSessionAvailability::Unavailable),
                Err(ProjectsError::ProjectNotFound { .. } | ProjectsError::InvalidProjectId) => {
                    Err(SessionsError::ProjectNotFound {
                        project_id: project_id.to_owned(),
                    })
                }
                Err(_) => Err(SessionsError::ProjectLookupFailed),
            }
        })
    }

    /// Preserves the display ordering already owned by Projects.
    fn ordered_project_ids<'a>(
        &'a self,
    ) -> PaneRuntimeFuture<'a, Result<Vec<String>, SessionsError>> {
        Box::pin(async move {
            self.projects
                .ordered_project_ids()
                .await
                // Internal Projects failures never cross the Sessions boundary verbatim.
                .map_err(|_| SessionsError::ProjectLookupFailed)
        })
    }
}

/// Adapts CLI Profiles launchability without resolving secrets or launch commands.
pub(crate) struct SessionsCliProfileLookup {
    profiles: CliProfilesService,
}

impl SessionsCliProfileLookup {
    /// Creates the adapter around the public CLI Profiles owner.
    pub(crate) fn new(profiles: CliProfilesService) -> Self {
        Self { profiles }
    }
}

impl CliProfileLookup for SessionsCliProfileLookup {
    /// Maps the current profile title and availability into Sessions-owned data.
    fn launchable_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<LaunchableProfile, SessionsError>> {
        Box::pin(async move {
            match self.profiles.launchability(profile_id).await {
                Ok(profile) => Ok(LaunchableProfile {
                    id: profile.id,
                    display_name: profile.display_name,
                    is_available: profile.is_available,
                }),
                Err(CliProfilesError::ProfileNotFound) => Err(SessionsError::ProfileNotFound {
                    profile_id: profile_id.to_owned(),
                }),
                Err(_) => Err(SessionsError::ProfileLookupFailed),
            }
        })
    }
}

/// Owns Stage 8 retention for tool selections and rejects future live content.
pub(crate) struct PaneContentRuntimeRouter {
    inner: Mutex<PhaseOneContentState>,
    terminal: OnceLock<TerminalManagerWeak>,
}

/// Stores retained tool selections under opaque process-local tokens.
struct PhaseOneContentState {
    next_token: u64,
    retained: HashMap<String, PaneContentRef>,
}

impl PaneContentRuntimeRouter {
    /// Creates an empty process-local content runtime.
    pub(crate) fn new() -> Self {
        Self {
            inner: Mutex::new(PhaseOneContentState {
                next_token: 1,
                retained: HashMap::new(),
            }),
            terminal: OnceLock::new(),
        }
    }

    /// Binds the Terminal lifecycle delegate exactly once.
    pub(crate) fn bind_terminal(&self, manager: &TerminalManager) -> Result<(), TerminalError> {
        self.terminal
            .set(manager.downgrade())
            .map_err(|_| TerminalError::SessionAttachFailed)
    }

    /// Upgrades the bound terminal manager or fails closed during invalid setup.
    fn terminal(&self) -> Result<TerminalManager, SessionsError> {
        self.terminal
            .get()
            .and_then(TerminalManagerWeak::upgrade)
            .ok_or_else(|| content_failure("delegate", "terminal"))
    }
}

impl PaneContentRuntime for PaneContentRuntimeRouter {
    /// Reports no process or file blockers for a Stage 8 tool selection.
    fn close_impact<'a>(
        &'a self,
        content: &'a PaneContentRef,
    ) -> PaneRuntimeFuture<'a, Result<PaneCloseImpact, SessionsError>> {
        Box::pin(async move {
            match content {
                PaneContentRef::ToolSelection { .. } => Ok(PaneCloseImpact::default()),
                PaneContentRef::Terminal { terminal_id, .. } => self
                    .terminal()?
                    .close_impact(terminal_id)
                    .await
                    .map_err(|_| content_failure("inspect", terminal_id)),
                PaneContentRef::File { file_handle_id, .. } => {
                    Err(content_failure("inspect", file_handle_id))
                }
            }
        })
    }

    /// Discards a tool selection or stores it behind an opaque reopen token.
    fn close<'a>(
        &'a self,
        content: &'a PaneContentRef,
        retention: CloseRetention,
    ) -> PaneRuntimeFuture<'a, Result<Option<ReopenHandle>, SessionsError>> {
        Box::pin(async move {
            if let PaneContentRef::Terminal { terminal_id, .. } = content {
                return self
                    .terminal()?
                    .close_for_session(terminal_id, retention)
                    .await
                    .map_err(|_| content_failure("close", terminal_id));
            }
            if !matches!(content, PaneContentRef::ToolSelection { .. }) {
                return Err(content_failure("close", content_id(content)));
            }
            if retention == CloseRetention::Discard {
                return Ok(None);
            }
            let mut state = self
                .inner
                .lock()
                // A poisoned owner lock is reported without leaking retained content.
                .map_err(|_| content_failure("close", "tool-selection"))?;
            if let Some((token, _)) = state
                .retained
                .iter()
                // Repeated close calls reuse the existing idempotent retention token.
                .find(|(_, retained)| *retained == content)
            {
                return Ok(Some(ReopenHandle {
                    owner: PaneContentOwner::Sessions,
                    token: token.clone(),
                }));
            }
            let token = format!("content-{}", state.next_token);
            state.next_token = state.next_token.saturating_add(1);
            state.retained.insert(token.clone(), content.clone());
            Ok(Some(ReopenHandle {
                owner: PaneContentOwner::Sessions,
                token,
            }))
        })
    }

    /// Restores one retained Stage 8 tool selection without consuming its retry token.
    fn reopen<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<PaneContentRef, SessionsError>> {
        Box::pin(async move {
            if handle.owner == PaneContentOwner::Terminal {
                return self
                    .terminal()?
                    .reopen_for_session(handle.clone())
                    .await
                    .map_err(|_| content_failure("reopen", &handle.token));
            }
            if handle.owner != PaneContentOwner::Sessions {
                return Err(content_failure("reopen", &handle.token));
            }
            self.inner
                .lock()
                // Lock failures are reduced to an opaque handle-scoped error.
                .map_err(|_| content_failure("reopen", &handle.token))?
                .retained
                .get(&handle.token)
                .cloned()
                // A missing or already discarded token cannot be reconstructed.
                .ok_or_else(|| content_failure("reopen", &handle.token))
        })
    }

    /// Permanently removes one retained Stage 8 tool selection idempotently.
    fn discard<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<(), SessionsError>> {
        Box::pin(async move {
            if handle.owner == PaneContentOwner::Terminal {
                return self
                    .terminal()?
                    .discard_for_session(handle.clone())
                    .await
                    .map_err(|_| content_failure("discard", &handle.token));
            }
            if handle.owner != PaneContentOwner::Sessions {
                return Err(content_failure("discard", &handle.token));
            }
            self.inner
                .lock()
                // Lock failures are reduced to an opaque handle-scoped error.
                .map_err(|_| content_failure("discard", &handle.token))?
                .retained
                .remove(&handle.token);
            Ok(())
        })
    }
}

/// Adapts public Projects, Profiles, and Sessions APIs to Terminal's narrow port.
pub(crate) struct AppTerminalDependencies {
    projects: ProjectService,
    profiles: CliProfilesService,
    sessions: Weak<SessionManager>,
}

impl AppTerminalDependencies {
    /// Creates the production adapter without retaining Sessions through Terminal.
    pub(crate) fn new(
        projects: ProjectService,
        profiles: CliProfilesService,
        sessions: Weak<SessionManager>,
    ) -> Self {
        Self {
            projects,
            profiles,
            sessions,
        }
    }

    /// Upgrades the process-lifetime Sessions owner.
    fn sessions(&self) -> Result<Arc<SessionManager>, TerminalError> {
        self.sessions
            .upgrade()
            .ok_or(TerminalError::RuntimeShuttingDown)
    }
}

impl TerminalDependencies for AppTerminalDependencies {
    /// Resolves the exact ToolSelection from the public session snapshot.
    fn launch_target<'a>(
        &'a self,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<TerminalPaneTarget, TerminalError>> {
        Box::pin(async move {
            let session = self
                .sessions()?
                .get_session(session_id)
                .await
                .map_err(|error| match error {
                    SessionsError::SessionNotFound { .. } => TerminalError::SessionNotFound {
                        session_id: session_id.to_owned(),
                    },
                    _ => TerminalError::SessionNotFound {
                        session_id: session_id.to_owned(),
                    },
                })?;
            let tab = session
                .tabs
                .iter()
                .find(|tab| tab.id == tab_id)
                .ok_or_else(|| TerminalError::TabNotFound {
                    tab_id: tab_id.to_owned(),
                })?;
            let pane = find_public_pane(&tab.layout, pane_id).ok_or_else(|| {
                TerminalError::PaneNotFound {
                    pane_id: pane_id.to_owned(),
                }
            })?;
            let PaneContentDto::ToolSelection { profile_id, title } = &pane.content else {
                return Err(TerminalError::PaneNotLaunchable {
                    pane_id: pane_id.to_owned(),
                });
            };
            Ok(TerminalPaneTarget {
                session_id: session_id.to_owned(),
                tab_id: tab_id.to_owned(),
                pane_id: pane_id.to_owned(),
                project_id: session.summary.project_id,
                profile_id: profile_id.clone(),
                title: title.clone(),
            })
        })
    }

    /// Resolves an available canonical project root through Projects.
    fn available_project_root<'a>(
        &'a self,
        project_id: &'a str,
    ) -> TerminalFuture<'a, Result<PathBuf, TerminalError>> {
        Box::pin(async move {
            self.projects
                .available_root(project_id)
                .await
                .map(|root| root.root_path)
                .map_err(|error| match error {
                    ProjectsError::ProjectNotFound { .. } | ProjectsError::InvalidProjectId => {
                        TerminalError::ProjectNotFound {
                            project_id: project_id.to_owned(),
                        }
                    }
                    ProjectsError::ProjectUnavailable { .. }
                    | ProjectsError::RemovalInProgress { .. } => {
                        TerminalError::ProjectUnavailable {
                            project_id: project_id.to_owned(),
                        }
                    }
                    _ => TerminalError::ProjectLookupFailed,
                })
        })
    }

    /// Resolves structured launch data and maps credential failures safely.
    fn resolve_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> TerminalFuture<'a, Result<ResolvedCliProfile, TerminalError>> {
        Box::pin(async move {
            self.profiles
                .resolve_for_launch(profile_id)
                .await
                .map_err(|error| map_cli_profile_error(profile_id, error))
        })
    }

    /// Commits the terminal content through Sessions authority.
    fn attach_terminal<'a>(
        &'a self,
        target: &'a TerminalPaneTarget,
        terminal_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async move {
            self.sessions()?
                .attach_runtime_content(
                    &target.pane_id,
                    PaneContentRef::Terminal {
                        terminal_id: terminal_id.to_owned(),
                        profile_id: target.profile_id.clone(),
                        title: target.title.clone(),
                    },
                )
                .await
                .map(|_| ())
                .map_err(|_| TerminalError::SessionAttachFailed)
        })
    }

    /// Records a real output edge through Sessions.
    fn record_output<'a>(
        &'a self,
        pane_id: &'a str,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async move {
            self.sessions()?
                .record_pane_output(pane_id)
                .await
                .map_err(|_| TerminalError::SessionAttachFailed)
        })
    }

    /// Replaces pane activity through Sessions.
    fn update_activity<'a>(
        &'a self,
        pane_id: &'a str,
        activity: TerminalActivity,
    ) -> TerminalFuture<'a, Result<(), TerminalError>> {
        Box::pin(async move {
            self.sessions()?
                .update_pane_activity(
                    pane_id,
                    crate::sessions::PaneActivitySnapshot {
                        running_process_count: activity.running_process_count,
                        needs_attention: activity.needs_attention,
                        finished_process_count: activity.finished_process_count,
                        failed_process_count: activity.failed_process_count,
                    },
                )
                .await
                .map_err(|_| TerminalError::SessionAttachFailed)
        })
    }
}

/// Emits low-frequency Terminal state through the application handle.
pub(crate) struct TauriTerminalEventSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriTerminalEventSink<R> {
    /// Creates a state event sink around the application handle.
    pub(crate) fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> TerminalEventSink for TauriTerminalEventSink<R> {
    /// Emits a state snapshot without ever carrying terminal bytes.
    fn publish(&self, event: TerminalStateChangedDto) -> Result<(), TerminalError> {
        self.app
            .emit(TERMINAL_STATE_CHANGED_EVENT, event)
            .map_err(|_| TerminalError::StreamAttachFailed)
    }
}

/// Finds one pane in a public immutable layout snapshot.
fn find_public_pane<'a>(
    layout: &'a PaneLayoutNodeDto,
    pane_id: &str,
) -> Option<&'a crate::sessions::PaneDto> {
    match layout {
        PaneLayoutNodeDto::Pane { pane } => (pane.id == pane_id).then_some(pane),
        PaneLayoutNodeDto::Split { first, second, .. } => {
            find_public_pane(first, pane_id).or_else(|| find_public_pane(second, pane_id))
        }
    }
}

/// Constructs one sanitized unavailable-profile error.
fn profile_unavailable(
    profile_id: &str,
    reason: TerminalProfileUnavailableReasonDto,
) -> TerminalError {
    TerminalError::ProfileUnavailable {
        profile_id: profile_id.to_owned(),
        reason,
    }
}

/// Maps CLI Profiles launch failures into the complete sanitized Terminal contract.
fn map_cli_profile_error(profile_id: &str, error: CliProfilesError) -> TerminalError {
    match error {
        CliProfilesError::ProfileNotFound => TerminalError::ProfileNotFound {
            profile_id: profile_id.to_owned(),
        },
        CliProfilesError::CommandNotFound => profile_unavailable(
            profile_id,
            TerminalProfileUnavailableReasonDto::CommandNotFound,
        ),
        CliProfilesError::ShellNotFound => profile_unavailable(
            profile_id,
            TerminalProfileUnavailableReasonDto::ShellNotFound,
        ),
        CliProfilesError::SecretNotFound => profile_unavailable(
            profile_id,
            TerminalProfileUnavailableReasonDto::CredentialMissing,
        ),
        CliProfilesError::CredentialStoreUnavailable | CliProfilesError::SecretReadFailed => {
            profile_unavailable(
                profile_id,
                TerminalProfileUnavailableReasonDto::CredentialStoreUnavailable,
            )
        }
        _ => TerminalError::ProfileLookupFailed,
    }
}

/// Defers the Projects runtime guard until Sessions can be constructed.
pub(crate) struct DeferredProjectRuntimeGuard {
    manager: OnceLock<SessionManager>,
}

impl DeferredProjectRuntimeGuard {
    /// Creates an unbound guard that fails closed until setup completes.
    pub(crate) fn new() -> Self {
        Self {
            manager: OnceLock::new(),
        }
    }

    /// Binds the one process-local manager exactly once.
    pub(crate) fn bind(&self, manager: SessionManager) -> Result<(), ProjectsError> {
        self.manager
            .set(manager)
            // A second binding indicates an invalid composition attempt.
            .map_err(|_| ProjectsError::RuntimeCleanupFailed)
    }
}

impl ProjectRuntimeGuard for DeferredProjectRuntimeGuard {
    /// Delegates project impact after binding or fails closed during incomplete setup.
    fn removal_impact<'a>(
        &'a self,
        project_id: &'a str,
    ) -> ProjectFuture<'a, Result<ProjectRuntimeImpact, ProjectsError>> {
        Box::pin(async move {
            let manager = self
                .manager
                .get()
                .ok_or(ProjectsError::RuntimeInspectionFailed)?;
            let impact = manager
                .project_removal_impact(project_id)
                .await
                // Sessions inspection details stay behind the Projects boundary.
                .map_err(|_| ProjectsError::RuntimeInspectionFailed)?;
            Ok(ProjectRuntimeImpact {
                session_count: impact.session_count,
                running_process_count: impact.running_process_count,
                unsaved_file_count: impact.unsaved_file_count,
            })
        })
    }

    /// Delegates confirmed project cleanup after binding.
    fn close_project<'a>(
        &'a self,
        project_id: &'a str,
    ) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async move {
            let manager = self
                .manager
                .get()
                .ok_or(ProjectsError::RuntimeCleanupFailed)?;
            manager
                .close_project_sessions(project_id)
                .await
                // Sessions cleanup details stay behind the Projects boundary.
                .map_err(|_| ProjectsError::RuntimeCleanupFailed)
        })
    }
}

/// Emits committed Sessions changes and schedules a ticketed tray refresh.
pub(crate) struct TauriSessionEventSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriSessionEventSink<R> {
    /// Creates an event sink around the application handle.
    pub(crate) fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> SessionEventSink for TauriSessionEventSink<R> {
    /// Emits best-effort while always scheduling tray recovery from owner state.
    fn publish(&self, event: SessionRuntimeEventDto) -> Result<(), SessionsError> {
        let emit_result = self.app.emit(SESSION_RUNTIME_CHANGED_EVENT, event);
        let app = self.app.clone();
        // Refresh from owner state even when best-effort event delivery fails.
        tauri::async_runtime::spawn(async move {
            if refresh_attention_menu(&app).await.is_err() {
                eprintln!("sessions attention-menu refresh failed");
            }
        });
        emit_result
            // Event delivery is best effort and exposes no serialized payload on failure.
            .map_err(|_| content_failure("publish", "runtime"))
    }
}

/// Adapts Sessions and Projects owner snapshots to application lifecycle needs.
pub(crate) struct SessionsAppRuntime {
    sessions: Arc<SessionManager>,
    projects: ProjectService,
    terminal: TerminalManager,
}

impl SessionsAppRuntime {
    /// Creates the real lifecycle runtime around public owner handles.
    pub(crate) fn new(
        sessions: Arc<SessionManager>,
        projects: ProjectService,
        terminal: TerminalManager,
    ) -> Self {
        Self {
            sessions,
            projects,
            terminal,
        }
    }
}

impl AppRuntime for SessionsAppRuntime {
    /// Joins current runtime counts with the current persisted project count.
    fn quit_summary<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<QuitSummaryDto, AppLifecycleError>> {
        Box::pin(async move {
            let impact = self
                .sessions
                .shutdown_impact()
                .await
                // Lifecycle exposes one stable snapshot failure category.
                .map_err(|_| AppLifecycleError::RuntimeSnapshotFailed)?;
            let projects = self
                .projects
                .list_projects(None)
                .await
                // Project storage details do not cross the lifecycle boundary.
                .map_err(|_| AppLifecycleError::RuntimeSnapshotFailed)?;
            Ok(QuitSummaryDto {
                session_count: impact.session_count,
                project_count: u32::try_from(projects.len())
                    // An unrepresentable public count fails instead of truncating.
                    .map_err(|_| AppLifecycleError::RuntimeSnapshotFailed)?,
                running_process_count: impact.running_process_count,
                unsaved_file_count: impact.unsaved_file_count,
            })
        })
    }

    /// Joins attention snapshots to current project display names.
    fn attention_sessions<'a>(
        &'a self,
    ) -> AppRuntimeFuture<'a, Result<Vec<AttentionSession>, AppLifecycleError>> {
        Box::pin(async move {
            let snapshots = self
                .sessions
                .attention_sessions()
                .await
                // Sessions lookup details stay behind the lifecycle boundary.
                .map_err(|_| AppLifecycleError::RuntimeSnapshotFailed)?;
            let project_names = self
                .projects
                .list_projects(None)
                .await
                // Project storage details stay behind the lifecycle boundary.
                .map_err(|_| AppLifecycleError::RuntimeSnapshotFailed)?
                .into_iter()
                // Build one immutable project-name join table for this snapshot.
                .map(|project| (project.id, project.display_name))
                .collect::<HashMap<_, _>>();
            snapshots
                .into_iter()
                // Join each attention summary to its current project display name.
                .map(|snapshot| {
                    let project_name = project_names
                        .get(&snapshot.summary.project_id)
                        .cloned()
                        .ok_or(AppLifecycleError::RuntimeSnapshotFailed)?;
                    Ok(AttentionSession {
                        session_id: snapshot.summary.id,
                        project_name,
                        session_name: snapshot.summary.name,
                        status_label: None,
                        attention_sequence: snapshot.attention_sequence,
                    })
                })
                .collect()
        })
    }

    /// Delegates true-Quit cleanup to the Sessions owner.
    fn shutdown_for_quit<'a>(&'a self) -> AppRuntimeFuture<'a, Result<(), AppLifecycleError>> {
        Box::pin(async move {
            self.terminal.begin_shutdown();
            let sessions = self.sessions.shutdown_all().await;
            let terminal = self.terminal.shutdown_remaining().await;
            if sessions.is_err() || terminal.is_err() {
                Err(AppLifecycleError::RuntimeShutdownFailed)
            } else {
                Ok(())
            }
        })
    }
}

/// Returns a stable opaque identity for unsupported Stage 8 content failures.
fn content_id(content: &PaneContentRef) -> &str {
    match content {
        PaneContentRef::ToolSelection { profile_id, .. } => profile_id,
        PaneContentRef::Terminal { terminal_id, .. } => terminal_id,
        PaneContentRef::File { file_handle_id, .. } => file_handle_id,
    }
}

/// Constructs one sanitized Sessions content failure.
fn content_failure(operation: &str, target_id: &str) -> SessionsError {
    SessionsError::ContentLifecycleFailed {
        operation: operation.to_owned(),
        target_id: target_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{DeferredProjectRuntimeGuard, PaneContentRuntimeRouter, map_cli_profile_error};
    use crate::projects::ProjectRuntimeGuard;
    use crate::sessions::{
        CloseRetention, PaneContentOwner, PaneContentRef, PaneContentRuntime, ReopenHandle,
    };
    use crate::terminal::{
        CliProfilesError, PtyCallbacks, PtyFactory, PtyProcess, PtySizeDto, ResolvedCliProfile,
        TerminalActivity, TerminalDependencies, TerminalError, TerminalEventSink, TerminalFuture,
        TerminalManager, TerminalPaneTarget, TerminalProfileUnavailableReasonDto,
        TerminalStateChangedDto,
    };
    use std::{path::PathBuf, sync::Arc};

    /// Rejects every owner lookup because binding tests never launch a terminal.
    struct UnavailableTerminalDependencies;

    impl TerminalDependencies for UnavailableTerminalDependencies {
        /// Rejects pane resolution in the setup-only fixture.
        fn launch_target<'a>(
            &'a self,
            _session_id: &'a str,
            _tab_id: &'a str,
            _pane_id: &'a str,
        ) -> TerminalFuture<'a, Result<TerminalPaneTarget, TerminalError>> {
            Box::pin(async { Err(TerminalError::RuntimeShuttingDown) })
        }

        /// Rejects project lookup in the setup-only fixture.
        fn available_project_root<'a>(
            &'a self,
            _project_id: &'a str,
        ) -> TerminalFuture<'a, Result<PathBuf, TerminalError>> {
            Box::pin(async { Err(TerminalError::RuntimeShuttingDown) })
        }

        /// Rejects profile resolution in the setup-only fixture.
        fn resolve_profile<'a>(
            &'a self,
            _profile_id: &'a str,
        ) -> TerminalFuture<'a, Result<ResolvedCliProfile, TerminalError>> {
            Box::pin(async { Err(TerminalError::RuntimeShuttingDown) })
        }

        /// Rejects Sessions attachment in the setup-only fixture.
        fn attach_terminal<'a>(
            &'a self,
            _target: &'a TerminalPaneTarget,
            _terminal_id: &'a str,
        ) -> TerminalFuture<'a, Result<(), TerminalError>> {
            Box::pin(async { Err(TerminalError::RuntimeShuttingDown) })
        }

        /// Rejects output recording in the setup-only fixture.
        fn record_output<'a>(
            &'a self,
            _pane_id: &'a str,
        ) -> TerminalFuture<'a, Result<(), TerminalError>> {
            Box::pin(async { Err(TerminalError::RuntimeShuttingDown) })
        }

        /// Rejects activity updates in the setup-only fixture.
        fn update_activity<'a>(
            &'a self,
            _pane_id: &'a str,
            _activity: TerminalActivity,
        ) -> TerminalFuture<'a, Result<(), TerminalError>> {
            Box::pin(async { Err(TerminalError::RuntimeShuttingDown) })
        }
    }

    /// Rejects any accidental process spawn in binding tests.
    struct NoSpawnPtyFactory;

    impl PtyFactory for NoSpawnPtyFactory {
        /// Panics if setup attempts to start a native process.
        fn spawn(
            &self,
            _profile: ResolvedCliProfile,
            _cwd: PathBuf,
            _size: PtySizeDto,
            _callbacks: PtyCallbacks,
        ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
            panic!("router binding must not spawn a PTY")
        }
    }

    /// Discards state events in binding tests.
    struct NoopTerminalEvents;

    impl TerminalEventSink for NoopTerminalEvents {
        /// Accepts one synthetic event.
        fn publish(&self, _event: TerminalStateChangedDto) -> Result<(), TerminalError> {
            Ok(())
        }
    }

    /// Creates a manager whose collaborators cannot perform external work.
    fn terminal_manager() -> TerminalManager {
        TerminalManager::new(
            Arc::new(UnavailableTerminalDependencies),
            Arc::new(NoopTerminalEvents),
            Arc::new(NoSpawnPtyFactory),
        )
    }

    /// Verifies the deferred project guard fails closed before Sessions is bound.
    #[test]
    fn deferred_guard_fails_closed_before_binding() {
        let guard = DeferredProjectRuntimeGuard::new();
        let result = tauri::async_runtime::block_on(guard.removal_impact("project"));
        assert!(result.is_err());
    }

    /// Verifies Stage 8 tool selections can be retained, reopened, and discarded idempotently.
    #[test]
    fn phase_one_content_runtime_owns_tool_selection_retention() {
        tauri::async_runtime::block_on(async {
            let runtime = PaneContentRuntimeRouter::new();
            let content = PaneContentRef::ToolSelection {
                profile_id: "profile-1".to_owned(),
                title: "Fixture Tool".to_owned(),
            };
            assert_eq!(
                runtime
                    .close_impact(&content)
                    .await
                    .expect("tool selection impact should be available"),
                Default::default()
            );
            let handle = runtime
                .close(&content, CloseRetention::ReopenLastTab)
                .await
                .expect("tool selection close should succeed")
                .expect("retained content should return a handle");
            assert_eq!(
                runtime
                    .reopen(handle.clone())
                    .await
                    .expect("retained content should reopen"),
                content
            );
            runtime
                .discard(handle.clone())
                .await
                .expect("the first discard should succeed");
            runtime
                .discard(handle.clone())
                .await
                .expect("a repeated discard should remain successful");
            assert!(runtime.reopen(handle).await.is_err());

            let foreign = ReopenHandle {
                owner: PaneContentOwner::Terminal,
                token: "foreign".to_owned(),
            };
            assert!(runtime.reopen(foreign).await.is_err());
        });
    }

    /// Verifies missing, duplicate, and expired Terminal delegates fail closed without spawning.
    #[test]
    fn terminal_router_binding_is_once_only_and_weak() {
        tauri::async_runtime::block_on(async {
            let content = PaneContentRef::Terminal {
                terminal_id: "terminal-1".to_owned(),
                profile_id: "builtin:terminal".to_owned(),
                title: "Fixture".to_owned(),
            };
            let unbound = PaneContentRuntimeRouter::new();
            assert!(unbound.close_impact(&content).await.is_err());

            let router = PaneContentRuntimeRouter::new();
            let manager = terminal_manager();
            router
                .bind_terminal(&manager)
                .expect("first bind should succeed");
            assert_eq!(
                router.bind_terminal(&manager),
                Err(TerminalError::SessionAttachFailed)
            );
            drop(manager);
            assert!(router.close_impact(&content).await.is_err());
        });
    }

    /// Verifies every launch-specific CLI profile failure maps to its BE-007 reason.
    #[test]
    fn cli_profile_launch_errors_map_to_safe_terminal_reasons() {
        let profile_id = "profile-00000000-0000-0000-0000-000000000001";
        let cases = [
            (
                CliProfilesError::CommandNotFound,
                TerminalProfileUnavailableReasonDto::CommandNotFound,
            ),
            (
                CliProfilesError::ShellNotFound,
                TerminalProfileUnavailableReasonDto::ShellNotFound,
            ),
            (
                CliProfilesError::SecretNotFound,
                TerminalProfileUnavailableReasonDto::CredentialMissing,
            ),
            (
                CliProfilesError::CredentialStoreUnavailable,
                TerminalProfileUnavailableReasonDto::CredentialStoreUnavailable,
            ),
            (
                CliProfilesError::SecretReadFailed,
                TerminalProfileUnavailableReasonDto::CredentialStoreUnavailable,
            ),
        ];
        for (source, reason) in cases {
            assert_eq!(
                map_cli_profile_error(profile_id, source),
                TerminalError::ProfileUnavailable {
                    profile_id: profile_id.to_owned(),
                    reason,
                }
            );
        }
        assert_eq!(
            map_cli_profile_error(profile_id, CliProfilesError::ProfileNotFound),
            TerminalError::ProfileNotFound {
                profile_id: profile_id.to_owned(),
            }
        );
        assert_eq!(
            map_cli_profile_error(profile_id, CliProfilesError::PersistenceFailed),
            TerminalError::ProfileLookupFailed
        );
    }
}
