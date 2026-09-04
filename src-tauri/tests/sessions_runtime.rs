// The public Sessions contract intentionally returns a data-rich confirmation error.
#![allow(clippy::result_large_err)]

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use xwork_lib::{
    projects::ProjectsError,
    sessions::{
        CliProfileLookup, CloseRetention, CloseTargetDto, LaunchableProfile, PaneActivitySnapshot,
        PaneCloseImpact, PaneContentOwner, PaneContentRef, PaneContentRuntime, PaneLayoutNodeDto,
        PaneRuntimeFuture, ProjectSessionAccess, ProjectSessionAvailability, ReopenHandle,
        SessionChangeKindDto, SessionEventSink, SessionManager, SessionRuntimeEventDto,
        SessionStatusDto, SessionsError, SplitAxisDto, SplitDirectionDto,
    },
    shared::DataMaintenanceGate,
    storage::Storage,
};

/// Supplies two deterministic available projects and rejects every other identifier.
struct FakeProjects;

impl ProjectSessionAccess for FakeProjects {
    /// Resolves fixture availability without touching a filesystem or database.
    fn session_availability<'a>(
        &'a self,
        project_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<ProjectSessionAvailability, SessionsError>> {
        Box::pin(async move {
            match project_id {
                "project-1" | "project-2" => Ok(ProjectSessionAvailability::Available),
                "project-unavailable" => Ok(ProjectSessionAvailability::Unavailable),
                _ => Err(SessionsError::ProjectNotFound {
                    project_id: project_id.to_owned(),
                }),
            }
        })
    }

    /// Returns the fixture project display order.
    fn ordered_project_ids<'a>(
        &'a self,
    ) -> PaneRuntimeFuture<'a, Result<Vec<String>, SessionsError>> {
        Box::pin(async { Ok(vec!["project-1".to_owned(), "project-2".to_owned()]) })
    }
}

/// Supplies one available and one unavailable CLI profile.
struct FakeProfiles;

impl CliProfileLookup for FakeProfiles {
    /// Returns current fixture launchability without resolving a secret or command.
    fn launchable_profile<'a>(
        &'a self,
        profile_id: &'a str,
    ) -> PaneRuntimeFuture<'a, Result<LaunchableProfile, SessionsError>> {
        Box::pin(async move {
            match profile_id {
                "profile-a" => Ok(LaunchableProfile {
                    id: profile_id.to_owned(),
                    display_name: "Fixture Tool".to_owned(),
                    is_available: true,
                }),
                "profile-off" => Ok(LaunchableProfile {
                    id: profile_id.to_owned(),
                    display_name: "Offline".to_owned(),
                    is_available: false,
                }),
                _ => Err(SessionsError::ProfileNotFound {
                    profile_id: profile_id.to_owned(),
                }),
            }
        })
    }
}

/// Records content lifecycle operations and retains reopenable fixture content.
#[derive(Default)]
struct FakeContent {
    inner: Mutex<FakeContentState>,
}

/// Stores fake retained content and observed retention modes.
#[derive(Default)]
struct FakeContentState {
    next_handle: u32,
    retained: HashMap<String, PaneContentRef>,
    close_retentions: Vec<CloseRetention>,
    close_failures_remaining: usize,
}

impl FakeContent {
    /// Returns every close retention observed by the fake content owner.
    fn close_retentions(&self) -> Vec<CloseRetention> {
        self.inner
            .lock()
            .expect("the fake content lock should be available")
            .close_retentions
            .clone()
    }

    /// Makes the next requested number of close calls fail after being recorded.
    fn fail_next_closes(&self, count: usize) {
        self.inner
            .lock()
            .expect("the fake content lock should be available")
            .close_failures_remaining = count;
    }
}

impl PaneContentRuntime for FakeContent {
    /// Reports deterministic blockers for Terminal and File content only.
    fn close_impact<'a>(
        &'a self,
        content: &'a PaneContentRef,
    ) -> PaneRuntimeFuture<'a, Result<PaneCloseImpact, SessionsError>> {
        Box::pin(async move {
            Ok(match content {
                PaneContentRef::ToolSelection { .. } => PaneCloseImpact::default(),
                PaneContentRef::Terminal { .. } => PaneCloseImpact {
                    running_process_labels: vec!["Fixture process".to_owned()],
                    unsaved_file_labels: Vec::new(),
                },
                PaneContentRef::File { .. } => PaneCloseImpact {
                    running_process_labels: Vec::new(),
                    unsaved_file_labels: vec!["Fixture file".to_owned()],
                },
            })
        })
    }

    /// Records the retention mode and creates one fake reopen handle when requested.
    fn close<'a>(
        &'a self,
        content: &'a PaneContentRef,
        retention: CloseRetention,
    ) -> PaneRuntimeFuture<'a, Result<Option<ReopenHandle>, SessionsError>> {
        Box::pin(async move {
            let mut state = self
                .inner
                .lock()
                .expect("the fake content lock should be available");
            state.close_retentions.push(retention);
            if state.close_failures_remaining > 0 {
                state.close_failures_remaining -= 1;
                return Err(SessionsError::ContentLifecycleFailed {
                    operation: "fixture-close".to_owned(),
                    target_id: "fixture-content".to_owned(),
                });
            }
            if retention == CloseRetention::Discard {
                return Ok(None);
            }
            state.next_handle += 1;
            let token = format!("handle-{}", state.next_handle);
            state.retained.insert(token.clone(), content.clone());
            Ok(Some(ReopenHandle {
                owner: PaneContentOwner::Terminal,
                token,
            }))
        })
    }

    /// Restores one fake retained content value without starting a process.
    fn reopen<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<PaneContentRef, SessionsError>> {
        Box::pin(async move {
            self.inner
                .lock()
                .expect("the fake content lock should be available")
                .retained
                .get(&handle.token)
                .cloned()
                .ok_or(SessionsError::ContentLifecycleFailed {
                    operation: "reopen".to_owned(),
                    target_id: handle.token,
                })
        })
    }

    /// Releases one retained fake handle idempotently.
    fn discard<'a>(
        &'a self,
        handle: ReopenHandle,
    ) -> PaneRuntimeFuture<'a, Result<(), SessionsError>> {
        Box::pin(async move {
            self.inner
                .lock()
                .expect("the fake content lock should be available")
                .retained
                .remove(&handle.token);
            Ok(())
        })
    }
}

/// Captures every committed runtime event in publication order.
#[derive(Default)]
struct RecordingEvents {
    events: Mutex<Vec<SessionRuntimeEventDto>>,
    failures_remaining: Mutex<usize>,
}

impl RecordingEvents {
    /// Returns an immutable copy of all published event payloads.
    fn recorded(&self) -> Vec<SessionRuntimeEventDto> {
        self.events
            .lock()
            .expect("the event lock should be available")
            .clone()
    }

    /// Makes the next requested number of event publications fail before recording.
    fn fail_next_publications(&self, count: usize) {
        *self
            .failures_remaining
            .lock()
            .expect("the event failure lock should be available") = count;
    }
}

impl SessionEventSink for RecordingEvents {
    /// Records one post-commit event without touching a webview.
    fn publish(&self, event: SessionRuntimeEventDto) -> Result<(), SessionsError> {
        let mut failures = self
            .failures_remaining
            .lock()
            .expect("the event failure lock should be available");
        if *failures > 0 {
            *failures -= 1;
            return Err(SessionsError::ContentLifecycleFailed {
                operation: "publish".to_owned(),
                target_id: "fixture-event".to_owned(),
            });
        }
        drop(failures);
        self.events
            .lock()
            .expect("the event lock should be available")
            .push(event);
        Ok(())
    }
}

/// Builds a deterministic manager and returns its observable fake ports.
fn build_manager() -> (SessionManager, Arc<FakeContent>, Arc<RecordingEvents>) {
    let content = Arc::new(FakeContent::default());
    let events = Arc::new(RecordingEvents::default());
    let manager = SessionManager::with_seams(
        DataMaintenanceGate::new(),
        Arc::new(FakeProjects),
        Arc::new(FakeProfiles),
        content.clone(),
        events.clone(),
        true,
    );
    (manager, content, events)
}

/// Returns the first pane identifier from a public tab snapshot.
fn first_pane_id(layout: &PaneLayoutNodeDto) -> String {
    match layout {
        PaneLayoutNodeDto::Pane { pane } => pane.id.clone(),
        PaneLayoutNodeDto::Split { first, .. } => first_pane_id(first),
    }
}

/// Exercises creation, layout, activity, confirmation, close, and reopen through public methods.
#[test]
fn public_runtime_flow_preserves_ids_revisions_layout_and_reopen() {
    tauri::async_runtime::block_on(async {
        let (manager, content, events) = build_manager();
        assert!(
            manager
                .list_sessions(None)
                .await
                .expect("list should work")
                .is_empty()
        );
        assert_eq!(
            manager.create_session("missing").await,
            Err(SessionsError::ProjectNotFound {
                project_id: "missing".to_owned()
            })
        );
        assert_eq!(
            manager.create_session("project-unavailable").await,
            Err(SessionsError::ProjectUnavailable {
                project_id: "project-unavailable".to_owned()
            })
        );

        let second_project = manager
            .create_session("project-2")
            .await
            .expect("the second-project session should be created");
        let created = manager
            .create_session("project-1")
            .await
            .expect("the first-project session should be created");
        assert_eq!(second_project.summary.id, "session-1");
        assert_eq!(created.summary.id, "session-2");
        assert_eq!(created.summary.status, SessionStatusDto::NoToolYet);
        assert!(created.tabs.is_empty());
        assert_eq!(
            manager
                .list_sessions(None)
                .await
                .expect("ordered list should work")
                .into_iter()
                // Compare only stable runtime identities in Projects-owned order.
                .map(|summary| summary.id)
                .collect::<Vec<_>>(),
            vec!["session-2".to_owned(), "session-1".to_owned()]
        );

        let renamed = manager
            .rename_session("session-2", "  Work  ")
            .await
            .expect("rename should work");
        assert_eq!(renamed.summary.name, "Work");
        let tabbed = manager
            .create_tab("session-2")
            .await
            .expect("tab creation should work");
        assert_eq!(tabbed.tabs[0].id, "tab-3");
        assert_eq!(first_pane_id(&tabbed.tabs[0].layout), "pane-4");
        let split = manager
            .split_pane("session-2", "tab-3", "pane-4", SplitDirectionDto::Right)
            .await
            .expect("split should work");
        assert!(matches!(
            split.tabs[0].layout,
            PaneLayoutNodeDto::Split {
                ref split_id,
                axis: SplitAxisDto::Vertical,
                ratio_basis_points: 5000,
                ..
            } if split_id == "split-5"
        ));
        assert_eq!(split.tabs[0].active_pane_id, "pane-6");

        let selected = manager
            .select_pane_tool("session-2", "tab-3", "pane-6", "profile-a")
            .await
            .expect("tool selection should work");
        assert_eq!(selected.summary.status, SessionStatusDto::NoToolYet);
        manager
            .attach_runtime_content(
                "pane-6",
                PaneContentRef::Terminal {
                    terminal_id: "terminal-1".to_owned(),
                    profile_id: "profile-a".to_owned(),
                    title: "Fixture Tool".to_owned(),
                },
            )
            .await
            .expect("terminal attachment should work");
        manager
            .update_pane_activity(
                "pane-6",
                PaneActivitySnapshot {
                    running_process_count: 1,
                    needs_attention: true,
                    finished_process_count: 0,
                    failed_process_count: 0,
                },
            )
            .await
            .expect("activity should update");
        let attention = manager
            .attention_sessions()
            .await
            .expect("attention snapshot should work");
        assert_eq!(attention.len(), 1);
        assert_eq!(
            attention[0].summary.status,
            SessionStatusDto::NeedsAttention
        );

        let target = CloseTargetDto::Pane {
            session_id: "session-2".to_owned(),
            tab_id: "tab-3".to_owned(),
            pane_id: "pane-6".to_owned(),
        };
        let impact = manager
            .get_close_impact(target.clone())
            .await
            .expect("impact should work");
        assert!(impact.requires_confirmation);
        assert_eq!(impact.running_process_count, 1);
        assert!(matches!(
            manager.close_runtime_target(target.clone(), false).await,
            Err(SessionsError::ConfirmationRequired { .. })
        ));
        let collapsed = manager
            .close_runtime_target(target, true)
            .await
            .expect("confirmed pane close should work")
            .session
            .expect("the session should survive");
        assert!(matches!(
            collapsed.tabs[0].layout,
            PaneLayoutNodeDto::Pane { .. }
        ));

        manager
            .select_pane_tool("session-2", "tab-3", "pane-4", "profile-a")
            .await
            .expect("the retained tab should contain a tool selection");
        let closed_tab = manager
            .close_runtime_target(
                CloseTargetDto::Tab {
                    session_id: "session-2".to_owned(),
                    tab_id: "tab-3".to_owned(),
                },
                true,
            )
            .await
            .expect("tab close should work")
            .session
            .expect("the session should survive");
        assert!(closed_tab.tabs.is_empty());
        assert!(closed_tab.can_reopen_last_closed_tab);
        let reopened = manager
            .reopen_last_closed_tab("session-2")
            .await
            .expect("tab reopen should work");
        assert_eq!(reopened.tabs[0].id, "tab-3");
        assert!(!reopened.can_reopen_last_closed_tab);
        assert!(
            content
                .close_retentions()
                .contains(&CloseRetention::ReopenLastTab)
        );

        events.fail_next_publications(1);
        let committed_after_event_failure = manager
            .rename_session("session-2", "Event recovery")
            .await
            .expect("event failure should not roll back committed state");
        assert_eq!(committed_after_event_failure.summary.name, "Event recovery");
        assert_eq!(
            manager
                .get_session("session-2")
                .await
                .expect("owner query should recover the committed snapshot")
                .summary
                .name,
            "Event recovery"
        );

        let recorded = events.recorded();
        assert!(recorded.windows(2).all(
            // Every adjacent event pair must preserve strict revision publication order.
            |pair| {
                pair[0]
                    .revision
                    .parse::<u64>()
                    .expect("revision should parse")
                    < pair[1]
                        .revision
                        .parse::<u64>()
                        .expect("revision should parse")
            },
        ));
        assert_eq!(recorded[0].change, SessionChangeKindDto::Created);
    });
}

/// Verifies tab ordering, pane limits, ratios, maximize state, and no-op revisions.
#[test]
fn structural_mutations_enforce_limits_and_preserve_no_op_revisions() {
    tauri::async_runtime::block_on(async {
        let (manager, _, _) = build_manager();
        let session = manager
            .create_session("project-1")
            .await
            .expect("the session should be created");
        let session_id = session.summary.id;
        let first = manager
            .create_tab(&session_id)
            .await
            .expect("the first tab should be created");
        let first_tab = first.tabs[0].id.clone();
        let first_pane = first_pane_id(&first.tabs[0].layout);
        let second = manager
            .create_tab(&session_id)
            .await
            .expect("the second tab should be created");
        let second_tab = second.tabs[1].id.clone();
        let third = manager
            .create_tab(&session_id)
            .await
            .expect("the third tab should be created");
        let third_tab = third.tabs[2].id.clone();

        let moved = manager
            .move_tab(&session_id, &first_tab, None)
            .await
            .expect("moving the first tab to the end should work");
        assert_eq!(
            moved
                .tabs
                .iter()
                // Compare stable identities after the reorder.
                .map(|tab| tab.id.as_str())
                .collect::<Vec<_>>(),
            vec![second_tab.as_str(), third_tab.as_str(), first_tab.as_str()]
        );
        assert_eq!(moved.active_tab_id.as_deref(), Some(third_tab.as_str()));
        let unchanged = manager
            .move_tab(&session_id, &first_tab, None)
            .await
            .expect("repeating the same move should be a no-op");
        assert_eq!(unchanged.revision, moved.revision);
        assert_eq!(
            manager
                .move_tab(&session_id, &first_tab, Some(&first_tab))
                .await,
            Err(SessionsError::InvalidMove)
        );

        let split_once = manager
            .split_pane(
                &session_id,
                &first_tab,
                &first_pane,
                SplitDirectionDto::Down,
            )
            .await
            .expect("the first split should work");
        let split_id = match &split_once.tabs[2].layout {
            PaneLayoutNodeDto::Split { split_id, axis, .. } => {
                assert_eq!(*axis, SplitAxisDto::Horizontal);
                split_id.clone()
            }
            PaneLayoutNodeDto::Pane { .. } => panic!("the tab should now contain a split"),
        };
        let second_pane = split_once.tabs[2].active_pane_id.clone();
        let split_twice = manager
            .split_pane(
                &session_id,
                &first_tab,
                &second_pane,
                SplitDirectionDto::Right,
            )
            .await
            .expect("the second split should work");
        let third_pane = split_twice.tabs[2].active_pane_id.clone();
        let split_thrice = manager
            .split_pane(
                &session_id,
                &first_tab,
                &third_pane,
                SplitDirectionDto::Right,
            )
            .await
            .expect("the third split should reach four panes");
        let fourth_pane = split_thrice.tabs[2].active_pane_id.clone();
        assert_eq!(
            manager
                .split_pane(
                    &session_id,
                    &first_tab,
                    &fourth_pane,
                    SplitDirectionDto::Right,
                )
                .await,
            Err(SessionsError::PaneLimitReached)
        );
        assert_eq!(
            manager
                .set_split_ratio(&session_id, &first_tab, &split_id, 999)
                .await,
            Err(SessionsError::InvalidSplitRatio)
        );
        let resized = manager
            .set_split_ratio(&session_id, &first_tab, &split_id, 1000)
            .await
            .expect("the lower ratio endpoint should work");
        let same_ratio = manager
            .set_split_ratio(&session_id, &first_tab, &split_id, 1000)
            .await
            .expect("repeating a ratio should be a no-op");
        assert_eq!(same_ratio.revision, resized.revision);
        let maximized = manager
            .set_maximized_pane(&session_id, &first_tab, Some(&fourth_pane))
            .await
            .expect("a live pane should maximize");
        assert_eq!(
            maximized.tabs[2].maximized_pane_id.as_deref(),
            Some(fourth_pane.as_str())
        );
        assert_eq!(
            manager
                .set_maximized_pane(&session_id, &first_tab, Some("pane-missing"))
                .await,
            Err(SessionsError::PaneNotFound {
                pane_id: "pane-missing".to_owned()
            })
        );
    });
}

/// Verifies visibility, unread output, status priority, and attention sequencing.
#[test]
fn activity_visibility_and_attention_follow_owner_snapshots() {
    tauri::async_runtime::block_on(async {
        let (manager, _, events) = build_manager();
        let session = manager
            .create_session("project-1")
            .await
            .expect("the session should be created");
        let session_id = session.summary.id;
        let selected = manager
            .select_session_tool(&session_id, "profile-a")
            .await
            .expect("the first tool should be selected");
        let pane_id = first_pane_id(&selected.tabs[0].layout);
        manager
            .attach_runtime_content(
                &pane_id,
                PaneContentRef::Terminal {
                    terminal_id: "terminal-activity".to_owned(),
                    profile_id: "profile-a".to_owned(),
                    title: "Fixture Tool".to_owned(),
                },
            )
            .await
            .expect("runtime content should attach");
        manager
            .set_observed_session(Some(&session_id))
            .await
            .expect("the visible session should become observed");
        let before_visible_output = events.recorded().len();
        manager
            .record_pane_output(&pane_id)
            .await
            .expect("visible output should be accepted");
        assert_eq!(events.recorded().len(), before_visible_output);

        manager.set_main_window_visible(false).await;
        manager
            .record_pane_output(&pane_id)
            .await
            .expect("hidden output should be recorded");
        assert_eq!(
            manager
                .get_session(&session_id)
                .await
                .expect("the session should remain readable")
                .summary
                .status,
            SessionStatusDto::UnseenOutput
        );
        let unread_revision = manager
            .get_session(&session_id)
            .await
            .expect("the unread snapshot should be readable")
            .revision;
        manager
            .record_pane_output(&pane_id)
            .await
            .expect("repeated hidden output should be a no-op");
        assert_eq!(
            manager
                .get_session(&session_id)
                .await
                .expect("the repeated snapshot should be readable")
                .revision,
            unread_revision
        );

        manager
            .update_pane_activity(
                &pane_id,
                PaneActivitySnapshot {
                    running_process_count: 1,
                    needs_attention: true,
                    finished_process_count: 1,
                    failed_process_count: 1,
                },
            )
            .await
            .expect("attention activity should update");
        let attention = manager
            .attention_sessions()
            .await
            .expect("attention should be queryable");
        assert_eq!(attention.len(), 1);
        assert_eq!(
            attention[0].summary.status,
            SessionStatusDto::NeedsAttention
        );
        let sequence = attention[0].attention_sequence;
        manager
            .update_pane_activity(
                &pane_id,
                PaneActivitySnapshot {
                    running_process_count: 2,
                    needs_attention: true,
                    finished_process_count: 1,
                    failed_process_count: 1,
                },
            )
            .await
            .expect("remaining in attention should update counts");
        assert_eq!(
            manager
                .attention_sessions()
                .await
                .expect("attention should remain queryable")[0]
                .attention_sequence,
            sequence
        );
        let hidden_context = manager
            .notification_context(&session_id)
            .await
            .expect("notification context should be queryable")
            .expect("the session should exist");
        assert!(!hidden_context.is_observed);
        manager.set_main_window_visible(true).await;
        assert!(
            manager
                .notification_context(&session_id)
                .await
                .expect("visible notification context should be queryable")
                .expect("the session should exist")
                .is_observed
        );
    });
}

/// Verifies close, retained-tab replacement, project cleanup, and shutdown remain retryable.
#[test]
fn lifecycle_failures_preserve_retryable_owner_state() {
    tauri::async_runtime::block_on(async {
        let (manager, content, _) = build_manager();
        let session = manager
            .create_session("project-1")
            .await
            .expect("the session should be created");
        let session_id = session.summary.id;
        let selected = manager
            .select_session_tool(&session_id, "profile-a")
            .await
            .expect("the first tool should be selected");
        let tab_id = selected.tabs[0].id.clone();
        let pane_id = first_pane_id(&selected.tabs[0].layout);
        manager
            .attach_runtime_content(
                &pane_id,
                PaneContentRef::Terminal {
                    terminal_id: "terminal-retry".to_owned(),
                    profile_id: "profile-a".to_owned(),
                    title: "Fixture Tool".to_owned(),
                },
            )
            .await
            .expect("runtime content should attach");
        let pane_target = CloseTargetDto::Pane {
            session_id: session_id.clone(),
            tab_id: tab_id.clone(),
            pane_id: pane_id.clone(),
        };
        content.fail_next_closes(1);
        assert!(matches!(
            manager
                .close_runtime_target(pane_target.clone(), true)
                .await,
            Err(SessionsError::ContentLifecycleFailed { .. })
        ));
        assert!(matches!(
            manager
                .get_session(&session_id)
                .await
                .expect("the failed target should remain")
                .tabs[0]
                .layout,
            PaneLayoutNodeDto::Pane { .. }
        ));
        manager
            .close_runtime_target(pane_target, true)
            .await
            .expect("the pane close retry should succeed");

        manager
            .select_pane_tool(&session_id, &tab_id, &pane_id, "profile-a")
            .await
            .expect("the cleared pane should accept another tool");
        manager
            .close_runtime_target(
                CloseTargetDto::Tab {
                    session_id: session_id.clone(),
                    tab_id: tab_id.clone(),
                },
                true,
            )
            .await
            .expect("the first tab should become reopenable");
        let replacement = manager
            .select_session_tool(&session_id, "profile-a")
            .await
            .expect("a replacement tab should be created");
        let replacement_tab_id = replacement.tabs[0].id.clone();
        content.fail_next_closes(1);
        assert!(matches!(
            manager
                .close_runtime_target(
                    CloseTargetDto::Tab {
                        session_id: session_id.clone(),
                        tab_id: replacement_tab_id,
                    },
                    true,
                )
                .await,
            Err(SessionsError::ContentLifecycleFailed { .. })
        ));
        let reopened = manager
            .reopen_last_closed_tab(&session_id)
            .await
            .expect("the old retained tab should survive a replacement close failure");
        assert_eq!(reopened.tabs.len(), 2);
        assert!(!reopened.can_reopen_last_closed_tab);

        content.fail_next_closes(1);
        assert!(manager.shutdown_all().await.is_err());
        assert_eq!(
            manager.create_tab(&session_id).await,
            Err(SessionsError::RuntimeShuttingDown)
        );
        manager
            .shutdown_all()
            .await
            .expect("shutdown should be retryable after partial failure");
        assert!(
            manager
                .list_sessions(None)
                .await
                .expect("the cleared runtime should remain queryable")
                .is_empty()
        );
        manager.resume_after_reset(false);

        let (project_manager, project_content, _) = build_manager();
        for _ in 0..2 {
            let created = project_manager
                .create_session("project-1")
                .await
                .expect("a project session should be created");
            project_manager
                .select_session_tool(&created.summary.id, "profile-a")
                .await
                .expect("each project session should own content");
        }
        project_content.fail_next_closes(1);
        assert!(
            project_manager
                .close_project_sessions("project-1")
                .await
                .is_err()
        );
        assert_eq!(
            project_manager
                .list_sessions(Some("project-1"))
                .await
                .expect("partial project cleanup should remain queryable")
                .len(),
            1
        );
        project_manager
            .close_project_sessions("project-1")
            .await
            .expect("project cleanup should succeed on retry");
        assert!(
            project_manager
                .list_sessions(Some("project-1"))
                .await
                .expect("the project should have no runtime sessions")
                .is_empty()
        );
    });
}

/// Verifies project cleanup, shutdown, fresh-manager emptiness, and runtime-only state.
#[test]
fn owner_cleanup_is_scoped_retryable_and_never_restored() {
    tauri::async_runtime::block_on(async {
        let (manager, _, _) = build_manager();
        manager
            .create_session("project-1")
            .await
            .expect("project one session should be created");
        manager
            .create_session("project-2")
            .await
            .expect("project two session should be created");
        let impact = manager
            .project_removal_impact("project-1")
            .await
            .expect("project impact should work");
        assert_eq!(impact.session_count, 1);
        manager
            .close_project_sessions("project-1")
            .await
            .expect("project cleanup should work");
        assert!(
            manager
                .list_sessions(Some("project-1"))
                .await
                .expect("list should work")
                .is_empty()
        );
        assert_eq!(
            manager
                .list_sessions(Some("project-2"))
                .await
                .expect("list should work")
                .len(),
            1
        );
        assert_eq!(
            manager
                .shutdown_impact()
                .await
                .expect("impact should work")
                .session_count,
            1
        );
        manager.shutdown_all().await.expect("shutdown should work");
        assert!(
            manager
                .list_sessions(None)
                .await
                .expect("list should work")
                .is_empty()
        );
        assert_eq!(
            manager.create_session("project-1").await,
            Err(SessionsError::RuntimeShuttingDown)
        );
        manager.resume_after_reset(true);
        let created = manager
            .create_session("project-1")
            .await
            .expect("reset resume should reopen admission");
        assert!(created.summary.id.starts_with("session-"));

        let (fresh, _, _) = build_manager();
        assert!(
            fresh
                .list_sessions(None)
                .await
                .expect("fresh list should work")
                .is_empty()
        );
    });
}

/// Verifies runtime operations add no SQLite table, row, or backup representation.
#[test]
fn sessions_runtime_never_touches_persistence() {
    tauri::async_runtime::block_on(async {
        let app_data = tempfile::TempDir::new().expect("temporary app data should exist");
        let storage = Storage::open(app_data.path()).expect("isolated storage should open");
        let before = storage
            .with_connection(
                // Snapshots every schema object name before runtime mutations.
                |connection| -> Result<Vec<String>, ProjectsError> {
                    let mut statement =
                        connection.prepare("SELECT name FROM sqlite_master ORDER BY type, name")?;
                    let names = statement
                        // Read each schema object's stable SQLite name.
                        .query_map([], |row| row.get::<_, String>(0))?
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(names)
                },
            )
            .expect("schema should be readable");
        let (manager, _, _) = build_manager();
        manager
            .create_session("project-1")
            .await
            .expect("runtime session should be created");
        manager
            .create_tab("session-1")
            .await
            .expect("runtime tab should be created");
        manager
            .shutdown_all()
            .await
            .expect("runtime shutdown should succeed");
        let after = storage
            .with_connection(
                // Snapshots every schema object after runtime cleanup.
                |connection| -> Result<Vec<String>, ProjectsError> {
                    let mut statement =
                        connection.prepare("SELECT name FROM sqlite_master ORDER BY type, name")?;
                    let names = statement
                        // Read each schema object's stable SQLite name.
                        .query_map([], |row| row.get::<_, String>(0))?
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(names)
                },
            )
            .expect("schema should remain readable");
        assert_eq!(after, before);
        assert!(after.iter().all(
            // No schema object may introduce Sessions persistence by name.
            |name| !name.contains("session"),
        ));
    });
}
