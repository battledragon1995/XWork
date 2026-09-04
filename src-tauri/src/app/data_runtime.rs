// Sessions errors intentionally preserve the complete confirmation impact payload.
#![allow(clippy::result_large_err)]

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
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
        CliProfileLookup, CloseRetention, LaunchableProfile, PaneCloseImpact, PaneContentOwner,
        PaneContentRef, PaneContentRuntime, PaneRuntimeFuture, ProjectSessionAccess,
        ProjectSessionAvailability, ReopenHandle, SESSION_RUNTIME_CHANGED_EVENT, SessionEventSink,
        SessionManager, SessionRuntimeEventDto, SessionsError,
    },
    terminal::{CliProfilesError, CliProfilesService},
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
pub(crate) struct PhaseOnePaneContentRuntime {
    inner: Mutex<PhaseOneContentState>,
}

/// Stores retained tool selections under opaque process-local tokens.
struct PhaseOneContentState {
    next_token: u64,
    retained: HashMap<String, PaneContentRef>,
}

impl PhaseOnePaneContentRuntime {
    /// Creates an empty process-local content runtime.
    pub(crate) fn new() -> Self {
        Self {
            inner: Mutex::new(PhaseOneContentState {
                next_token: 1,
                retained: HashMap::new(),
            }),
        }
    }
}

impl PaneContentRuntime for PhaseOnePaneContentRuntime {
    /// Reports no process or file blockers for a Stage 8 tool selection.
    fn close_impact<'a>(
        &'a self,
        content: &'a PaneContentRef,
    ) -> PaneRuntimeFuture<'a, Result<PaneCloseImpact, SessionsError>> {
        Box::pin(async move {
            match content {
                PaneContentRef::ToolSelection { .. } => Ok(PaneCloseImpact::default()),
                PaneContentRef::Terminal { terminal_id, .. } => {
                    Err(content_failure("inspect", terminal_id))
                }
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
    sessions: SessionManager,
    projects: ProjectService,
}

impl SessionsAppRuntime {
    /// Creates the real lifecycle runtime around public owner handles.
    pub(crate) fn new(sessions: SessionManager, projects: ProjectService) -> Self {
        Self { sessions, projects }
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
            self.sessions
                .shutdown_all()
                .await
                // Lifecycle exposes one stable shutdown failure category.
                .map_err(|_| AppLifecycleError::RuntimeShutdownFailed)
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
    use super::{DeferredProjectRuntimeGuard, PhaseOnePaneContentRuntime};
    use crate::projects::ProjectRuntimeGuard;
    use crate::sessions::{
        CloseRetention, PaneContentOwner, PaneContentRef, PaneContentRuntime, ReopenHandle,
    };

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
            let runtime = PhaseOnePaneContentRuntime::new();
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
}
