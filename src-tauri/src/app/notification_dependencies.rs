use crate::{
    notifications::*,
    sessions::{
        PaneContentDto, PaneLayoutNodeDto, SessionManager, SessionNotificationContext,
        SessionsError,
    },
};
use std::sync::{Arc, Weak};
use tokio::sync::{mpsc, oneshot};

/// Serializes native visibility updates before notification context reads.
#[derive(Clone)]
pub(crate) struct NotificationVisibility(mpsc::UnboundedSender<VisibilityMessage>);
enum VisibilityMessage {
    Set(bool),
    Barrier(oneshot::Sender<()>),
}
impl NotificationVisibility {
    /// Starts a weak-owned worker so idle ordering state cannot retain Sessions.
    pub(crate) fn new(sessions: Weak<SessionManager>) -> Self {
        let (send, mut receive) = mpsc::unbounded_channel();
        // Commits show/hide updates in enqueue order, acknowledging only earlier updates.
        tauri::async_runtime::spawn(async move {
            while let Some(message) = receive.recv().await {
                match message {
                    VisibilityMessage::Set(visible) => {
                        let Some(sessions) = sessions.upgrade() else {
                            break;
                        };
                        sessions.set_main_window_visible(visible).await;
                    }
                    VisibilityMessage::Barrier(done) => {
                        let _ = done.send(());
                    }
                }
            }
        });
        Self(send)
    }
    /// Enqueues native visibility without blocking the native event callback.
    pub(crate) fn set(&self, visible: bool) {
        let _ = self.0.send(VisibilityMessage::Set(visible));
    }
    /// Waits until all previously enqueued native visibility updates have committed.
    async fn synchronize(&self) -> Result<(), NotificationError> {
        let (send, receive) = oneshot::channel();
        self.0
            .send(VisibilityMessage::Barrier(send))
            // Maps the failure to a sanitized boundary error.
            .map_err(|_| NotificationError::DependencyUnavailable)?;
        receive
            .await
            // Maps the failure to a sanitized boundary error.
            .map_err(|_| NotificationError::DependencyUnavailable)
    }
}
/// Maps Notifications consumer ports using only Sessions public snapshots.
pub(crate) struct AppNotificationDependencies {
    pub sessions: Arc<SessionManager>,
    pub visibility: NotificationVisibility,
}
impl NotificationDependencies for AppNotificationDependencies {
    /// Reads session context after earlier native visibility changes commit.
    fn session_context<'a>(
        &'a self,
        session_id: &'a str,
    ) -> NotificationFuture<'a, Result<Option<SessionNotificationContext>, NotificationError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async move {
            self.visibility.synchronize().await?;
            self.sessions
                .notification_context(session_id)
                .await
                // Maps the failure to a sanitized boundary error.
                .map_err(|_| NotificationError::DependencyUnavailable)
        })
    }
    /// Verifies every part of the persisted opaque navigation relationship.
    fn session_target_exists<'a>(
        &'a self,
        project_id: &'a str,
        session_id: &'a str,
        tab_id: &'a str,
        pane_id: &'a str,
        terminal_id: &'a str,
    ) -> NotificationFuture<'a, Result<bool, NotificationError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async move {
            let detail = match self.sessions.get_session(session_id).await {
                Ok(detail) => detail,
                Err(SessionsError::SessionNotFound { .. }) => return Ok(false),
                Err(_) => return Err(NotificationError::DependencyUnavailable),
            };
            Ok(detail.summary.project_id == project_id
                && detail
                    .tabs
                    .iter()
                    // Matches the requested identity against the public owner snapshot.
                    .any(|tab| tab.id == tab_id && target_pane(&tab.layout, pane_id, terminal_id)))
        })
    }
    /// Keeps Phase 4 Calendar resolution absent without importing its implementation.
    fn event_target<'a>(
        &'a self,
        _event_id: &'a str,
        _occurrence_id: &'a str,
    ) -> NotificationFuture<'a, Result<Option<NotificationEventTarget>, NotificationError>> {
        // Awaits owner work without retaining a calling state borrow.
        Box::pin(async { Ok(None) })
    }
    /// Returns the Phase 1 defaults until notification settings ship in Phase 4.
    fn terminal_policy(&self) -> Result<TerminalNotificationPolicy, NotificationError> {
        Ok(TerminalNotificationPolicy {
            terminal_activity_enabled: true,
            os_needs_input: true,
            os_process_finished: false,
            os_process_failed: true,
        })
    }
}
/// Finds an exact terminal leaf without relying on active/maximized pane state.
fn target_pane(layout: &PaneLayoutNodeDto, pane_id: &str, terminal_id: &str) -> bool {
    match layout {
        PaneLayoutNodeDto::Pane { pane } => {
            pane.id == pane_id
                && matches!(&pane.content,PaneContentDto::Terminal {terminal_id:id,..} if id==terminal_id)
        }
        PaneLayoutNodeDto::Split { first, second, .. } => {
            target_pane(first, pane_id, terminal_id) || target_pane(second, pane_id, terminal_id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sessions::*, shared::DataMaintenanceGate};
    /// Supplies in-memory owner collaborators without project paths or native resources.
    struct Ports;
    impl ProjectSessionAccess for Ports {
        /// Allows the fixture project without filesystem lookup.
        fn session_availability<'a>(
            &'a self,
            _: &'a str,
        ) -> PaneRuntimeFuture<'a, Result<ProjectSessionAvailability, SessionsError>> {
            // Runs the isolated asynchronous fixture scenario.
            Box::pin(async { Ok(ProjectSessionAvailability::Available) })
        }
        /// Supplies an isolated project ordering.
        fn ordered_project_ids<'a>(
            &'a self,
        ) -> PaneRuntimeFuture<'a, Result<Vec<String>, SessionsError>> {
            // Runs the isolated asynchronous fixture scenario.
            Box::pin(async { Ok(Vec::new()) })
        }
    }
    impl CliProfileLookup for Ports {
        /// Resolves a safe title without accessing credentials or commands.
        fn launchable_profile<'a>(
            &'a self,
            id: &'a str,
        ) -> PaneRuntimeFuture<'a, Result<LaunchableProfile, SessionsError>> {
            // Runs the isolated asynchronous fixture scenario.
            Box::pin(async move {
                Ok(LaunchableProfile {
                    id: id.into(),
                    display_name: "Tool".into(),
                    is_available: true,
                })
            })
        }
    }
    impl PaneContentRuntime for Ports {
        /// Reports no live process blockers for the in-memory pane.
        fn close_impact<'a>(
            &'a self,
            _: &'a PaneContentRef,
        ) -> PaneRuntimeFuture<'a, Result<PaneCloseImpact, SessionsError>> {
            // Runs the isolated asynchronous fixture scenario.
            Box::pin(async { Ok(PaneCloseImpact::default()) })
        }
        /// Discards fixture content without native cleanup.
        fn close<'a>(
            &'a self,
            _: &'a PaneContentRef,
            _: CloseRetention,
        ) -> PaneRuntimeFuture<'a, Result<Option<ReopenHandle>, SessionsError>> {
            // Runs the isolated asynchronous fixture scenario.
            Box::pin(async { Ok(None) })
        }
        /// Rejects unsupported reopen because this test never retains content.
        fn reopen<'a>(
            &'a self,
            _: ReopenHandle,
        ) -> PaneRuntimeFuture<'a, Result<PaneContentRef, SessionsError>> {
            // Runs the isolated asynchronous fixture scenario.
            Box::pin(async { Err(SessionsError::RuntimeShuttingDown) })
        }
        /// Completes fixture disposal without side effects.
        fn discard<'a>(
            &'a self,
            _: ReopenHandle,
        ) -> PaneRuntimeFuture<'a, Result<(), SessionsError>> {
            // Runs the isolated asynchronous fixture scenario.
            Box::pin(async { Ok(()) })
        }
    }
    impl SessionEventSink for Ports {
        /// Keeps fixture Sessions events inside the test.
        fn publish(&self, _: SessionRuntimeEventDto) -> Result<(), SessionsError> {
            Ok(())
        }
    }

    /// Verifies queued show/hide updates, route context, and exact target validation using real Sessions.
    #[test]
    fn visibility_barrier_and_exact_live_owner_target() {
        // Runs the isolated asynchronous fixture scenario.
        tauri::async_runtime::block_on(async {
            let ports = Arc::new(Ports);
            let sessions = Arc::new(SessionManager::new(
                DataMaintenanceGate::new(),
                ports.clone(),
                ports.clone(),
                ports.clone(),
                ports,
                true,
            ));
            let project = "00000000-0000-4000-8000-000000000001";
            let created = sessions.create_session(project).await.unwrap();
            let id = created.summary.id;
            let detail = sessions
                .select_session_tool(&id, "builtin:terminal")
                .await
                .unwrap();
            let tab = &detail.tabs[0];
            let pane = &tab.active_pane_id;
            sessions
                .attach_runtime_content(
                    pane,
                    PaneContentRef::Terminal {
                        terminal_id: "terminal-1".into(),
                        profile_id: "builtin:terminal".into(),
                        title: "Tool".into(),
                    },
                )
                .await
                .unwrap();
            sessions.set_observed_session(Some(&id)).await.unwrap();
            let visibility = NotificationVisibility::new(Arc::downgrade(&sessions));
            let dependencies = AppNotificationDependencies {
                sessions: sessions.clone(),
                visibility: visibility.clone(),
            };
            visibility.set(false);
            assert!(
                !dependencies
                    .session_context(&id)
                    .await
                    .unwrap()
                    .unwrap()
                    .is_observed
            );
            visibility.set(true);
            assert!(
                dependencies
                    .session_context(&id)
                    .await
                    .unwrap()
                    .unwrap()
                    .is_observed
            );
            visibility.set(false);
            visibility.set(true);
            visibility.set(false);
            assert!(
                !dependencies
                    .session_context(&id)
                    .await
                    .unwrap()
                    .unwrap()
                    .is_observed
            );
            visibility.set(true);
            sessions.set_observed_session(None).await.unwrap();
            assert!(
                !dependencies
                    .session_context(&id)
                    .await
                    .unwrap()
                    .unwrap()
                    .is_observed
            );
            assert!(
                dependencies
                    .session_target_exists(project, &id, &tab.id, pane, "terminal-1")
                    .await
                    .unwrap()
            );
            assert!(
                !dependencies
                    .session_target_exists(project, &id, &tab.id, pane, "terminal-other")
                    .await
                    .unwrap()
            );
            assert!(
                !dependencies
                    .session_target_exists(project, &id, "other-tab", pane, "terminal-1")
                    .await
                    .unwrap()
            );
            sessions.shutdown_all().await.unwrap();
            assert!(dependencies.session_context(&id).await.unwrap().is_none());
            assert!(
                !dependencies
                    .session_target_exists(project, &id, &tab.id, pane, "terminal-1")
                    .await
                    .unwrap()
            );
            assert!(
                dependencies
                    .event_target("event", "occurrence")
                    .await
                    .unwrap()
                    .is_none()
            );
        });
    }
}
