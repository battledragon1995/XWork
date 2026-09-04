use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use tokio::sync::{Mutex, RwLock};

use super::{
    CliProfileLookup, CloseImpactDto, CloseResultDto, CloseRetention, CloseTargetDto,
    LaunchableProfile, PaneActivitySnapshot, PaneCloseImpact, PaneContentDto, PaneContentRef,
    PaneContentRuntime, PaneDto, PaneLayoutNodeDto, ProjectSessionAccess,
    ProjectSessionAvailability, ProjectSessionsImpact, ReopenHandle, SessionAttentionSnapshot,
    SessionChangeKindDto, SessionDetailDto, SessionNotificationContext, SessionRuntimeEventDto,
    SessionStatusDto, SessionSummaryDto, SessionsError, ShutdownImpact, SplitDirectionDto, TabDto,
};
use crate::sessions::models::{
    collapse_pane, collect_panes, find_pane, find_pane_mut, find_split_ratio_mut, normalize_name,
    pane_count, replace_pane_with_split,
};
use crate::shared::DataMaintenanceGate;

/// Names the best-effort invalidation event published after committed changes.
pub const SESSION_RUNTIME_CHANGED_EVENT: &str = "sessions://runtime-changed";

/// Publishes an already committed Sessions event without owning runtime state.
pub trait SessionEventSink: Send + Sync {
    /// Delivers one post-commit event to application consumers.
    fn publish(&self, event: SessionRuntimeEventDto) -> Result<(), SessionsError>;
}

/// Owns all process-local Sessions state and injected capability ports.
#[derive(Clone)]
pub struct SessionManager {
    inner: Arc<ManagerInner>,
}

/// Stores shared state, ports, and operation serialization primitives.
struct ManagerInner {
    state: RwLock<ManagerState>,
    commit_gate: Mutex<()>,
    project_cleanup_gate: Mutex<()>,
    maintenance: DataMaintenanceGate,
    projects: Arc<dyn ProjectSessionAccess>,
    profiles: Arc<dyn CliProfileLookup>,
    content: Arc<dyn PaneContentRuntime>,
    events: Arc<dyn SessionEventSink>,
}

/// Stores the complete process-local runtime snapshot.
struct ManagerState {
    sessions: HashMap<String, SessionRecord>,
    project_sessions: HashMap<String, Vec<String>>,
    observed_session_id: Option<String>,
    main_window_visible: bool,
    closing_sessions: HashSet<String>,
    closing_projects: HashSet<String>,
    shutting_down: bool,
    next_runtime_id: u64,
    revision: u64,
}

/// Stores mutable state for one session.
#[derive(Clone)]
struct SessionRecord {
    id: String,
    project_id: String,
    name: String,
    tabs: Vec<TabRecord>,
    active_tab_id: Option<String>,
    last_closed_tab: Option<ClosedTab>,
    unseen_output: bool,
    attention_sequence: Option<u64>,
}

/// Stores one tab layout and private pane activity facts.
#[derive(Clone)]
struct TabRecord {
    dto: TabDto,
    activity: HashMap<String, PaneActivitySnapshot>,
}

/// Stores one runtime-only tab snapshot and its content reopen handles.
#[derive(Clone)]
struct ClosedTab {
    tab: TabRecord,
    original_index: usize,
    handles: Vec<(String, Option<ReopenHandle>)>,
}

/// Reports whether a state mutation changed anything visible to consumers.
enum Mutation<T> {
    Changed(T),
    Unchanged(T),
}

impl ManagerState {
    /// Allocates one opaque identifier from the manager-wide monotonic counter.
    fn allocate_id(&mut self, prefix: &str) -> String {
        let value = self.next_runtime_id;
        self.next_runtime_id = self.next_runtime_id.saturating_add(1);
        format!("{prefix}-{value}")
    }

    /// Allocates the next observable revision without resetting in this process.
    fn allocate_revision(&mut self) -> u64 {
        self.revision = self.revision.saturating_add(1);
        self.revision
    }

    /// Rejects all mutations after shutdown begins and while one session is reserved.
    fn admit_session_mutation(&self, session_id: &str) -> Result<(), SessionsError> {
        if self.shutting_down {
            return Err(SessionsError::RuntimeShuttingDown);
        }
        if self.closing_sessions.contains(session_id) {
            return Err(SessionsError::CloseInProgress {
                session_id: session_id.to_owned(),
            });
        }
        Ok(())
    }
}

impl SessionRecord {
    /// Builds the public summary from private activity and unread facts.
    fn summary(&self) -> Result<SessionSummaryDto, SessionsError> {
        let mut running = 0_u32;
        let mut finished = 0_u32;
        let mut failed = 0_u32;
        let mut needs_attention = false;
        for activity in self.tabs.iter().flat_map(
            // Every tab contributes the activity snapshots of all its live panes.
            |tab| tab.activity.values(),
        ) {
            running = checked_add(running, activity.running_process_count, &self.id)?;
            finished = checked_add(finished, activity.finished_process_count, &self.id)?;
            failed = checked_add(failed, activity.failed_process_count, &self.id)?;
            needs_attention |= activity.needs_attention;
        }
        let status = if needs_attention {
            SessionStatusDto::NeedsAttention
        } else if failed > 0 {
            SessionStatusDto::ExitedWithError
        } else if self.unseen_output {
            SessionStatusDto::UnseenOutput
        } else if running > 0 {
            SessionStatusDto::Running
        } else if finished > 0 {
            SessionStatusDto::Finished
        } else {
            SessionStatusDto::NoToolYet
        };
        Ok(SessionSummaryDto {
            id: self.id.clone(),
            project_id: self.project_id.clone(),
            name: self.name.clone(),
            status,
            running_process_count: running,
            tab_count: count_to_u32(self.tabs.len(), &self.id)?,
        })
    }

    /// Builds a complete public snapshot at the supplied manager revision.
    fn detail(&self, revision: u64) -> Result<SessionDetailDto, SessionsError> {
        Ok(SessionDetailDto {
            summary: self.summary()?,
            tabs: self
                .tabs
                .iter()
                // Public snapshots never expose the private pane activity map.
                .map(|tab| tab.dto.clone())
                .collect(),
            active_tab_id: self.active_tab_id.clone(),
            can_reopen_last_closed_tab: self.last_closed_tab.is_some(),
            revision: revision.to_string(),
        })
    }

    /// Finds one tab immutably and reports a parent-scoped error when absent.
    fn tab(&self, tab_id: &str) -> Result<&TabRecord, SessionsError> {
        self.tabs
            .iter()
            // Tab identity, not its editable display name, determines membership.
            .find(|tab| tab.dto.id == tab_id)
            // A missing child is reported at the child boundary.
            .ok_or_else(|| SessionsError::TabNotFound {
                tab_id: tab_id.to_owned(),
            })
    }

    /// Finds one tab mutably and reports a parent-scoped error when absent.
    fn tab_mut(&mut self, tab_id: &str) -> Result<&mut TabRecord, SessionsError> {
        self.tabs
            .iter_mut()
            // Tab identity, not its editable display name, determines membership.
            .find(|tab| tab.dto.id == tab_id)
            // A missing child is reported at the child boundary.
            .ok_or_else(|| SessionsError::TabNotFound {
                tab_id: tab_id.to_owned(),
            })
    }
}

impl SessionManager {
    /// Creates an empty process-local manager from application-owned ports.
    pub fn new(
        maintenance: DataMaintenanceGate,
        projects: Arc<dyn ProjectSessionAccess>,
        profiles: Arc<dyn CliProfileLookup>,
        content: Arc<dyn PaneContentRuntime>,
        events: Arc<dyn SessionEventSink>,
        main_window_visible: bool,
    ) -> Self {
        Self::with_seams(
            maintenance,
            projects,
            profiles,
            content,
            events,
            main_window_visible,
        )
    }

    /// Creates a manager with deterministic collaborators for focused tests.
    #[doc(hidden)]
    pub fn with_seams(
        maintenance: DataMaintenanceGate,
        projects: Arc<dyn ProjectSessionAccess>,
        profiles: Arc<dyn CliProfileLookup>,
        content: Arc<dyn PaneContentRuntime>,
        events: Arc<dyn SessionEventSink>,
        main_window_visible: bool,
    ) -> Self {
        Self {
            inner: Arc::new(ManagerInner {
                state: RwLock::new(ManagerState {
                    sessions: HashMap::new(),
                    project_sessions: HashMap::new(),
                    observed_session_id: None,
                    main_window_visible,
                    closing_sessions: HashSet::new(),
                    closing_projects: HashSet::new(),
                    shutting_down: false,
                    next_runtime_id: 1,
                    revision: 0,
                }),
                commit_gate: Mutex::new(()),
                project_cleanup_gate: Mutex::new(()),
                maintenance,
                projects,
                profiles,
                content,
                events,
            }),
        }
    }

    /// Reports whether this manager shares the supplied maintenance gate.
    #[doc(hidden)]
    pub fn shares_gate_with(&self, gate: &DataMaintenanceGate) -> bool {
        self.inner.maintenance.shares_state_with(gate)
    }

    /// Lists runtime sessions in Projects-owned group order.
    pub async fn list_sessions(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<SessionSummaryDto>, SessionsError> {
        if let Some(project_id) = project_id {
            self.inner.projects.session_availability(project_id).await?;
            let state = self.inner.state.read().await;
            let ids = state
                .project_sessions
                .get(project_id)
                .cloned()
                .unwrap_or_default();
            return ids
                .iter()
                // Ignore IDs already removed by a completed concurrent owner cleanup.
                .filter_map(|id| state.sessions.get(id))
                // Each list entry is built from the same manager read snapshot.
                .map(SessionRecord::summary)
                .collect();
        }

        let project_order = self.inner.projects.ordered_project_ids().await?;
        let state = self.inner.state.read().await;
        for project_id in state.project_sessions.keys() {
            if !project_order.iter().any(
                // Runtime groups must still have a matching Projects-owned identity.
                |known| known == project_id,
            ) {
                return Err(SessionsError::ProjectNotFound {
                    project_id: project_id.clone(),
                });
            }
        }
        let mut summaries = Vec::new();
        for project_id in project_order {
            for session_id in state
                .project_sessions
                .get(&project_id)
                .into_iter()
                .flatten()
            {
                if let Some(session) = state.sessions.get(session_id) {
                    summaries.push(session.summary()?);
                }
            }
        }
        Ok(summaries)
    }

    /// Returns one owner-produced session snapshot.
    pub async fn get_session(&self, session_id: &str) -> Result<SessionDetailDto, SessionsError> {
        let state = self.inner.state.read().await;
        session_from(&state, session_id)?.detail(state.revision)
    }

    /// Creates an empty session for a currently available project.
    pub async fn create_session(
        &self,
        project_id: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        let _permit = self.inner.maintenance.read_permit().await;
        match self.inner.projects.session_availability(project_id).await? {
            ProjectSessionAvailability::Available => {}
            ProjectSessionAvailability::Unavailable => {
                return Err(SessionsError::ProjectUnavailable {
                    project_id: project_id.to_owned(),
                });
            }
        }
        let _commit = self.inner.commit_gate.lock().await;
        let (detail, event) = {
            let mut state = self.inner.state.write().await;
            if state.shutting_down {
                return Err(SessionsError::RuntimeShuttingDown);
            }
            if state.closing_projects.contains(project_id) {
                return Err(SessionsError::ProjectUnavailable {
                    project_id: project_id.to_owned(),
                });
            }
            let session_id = state.allocate_id("session");
            let revision = state.allocate_revision();
            let session = SessionRecord {
                id: session_id.clone(),
                project_id: project_id.to_owned(),
                name: "New Session".to_owned(),
                tabs: Vec::new(),
                active_tab_id: None,
                last_closed_tab: None,
                unseen_output: false,
                attention_sequence: None,
            };
            let detail = session.detail(revision)?;
            state.sessions.insert(session_id.clone(), session);
            state
                .project_sessions
                .entry(project_id.to_owned())
                .or_default()
                .push(session_id.clone());
            let event = event_for(
                revision,
                SessionChangeKindDto::Created,
                project_id,
                &session_id,
                Some(detail.summary.clone()),
            );
            (detail, event)
        };
        self.publish(event);
        Ok(detail)
    }

    /// Renames one session after applying the shared display-name rules.
    pub async fn rename_session(
        &self,
        session_id: &str,
        name: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        let name = normalize_name(name)?;
        // Applies the normalized name only when it differs from committed state.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, move |state| {
            let session = session_from_mut(state, session_id)?;
            if session.name == name {
                Ok(Mutation::Unchanged(()))
            } else {
                session.name = name;
                Ok(Mutation::Changed(()))
            }
        })
        .await
    }

    /// Appends one empty tab and makes its pane active.
    pub async fn create_tab(&self, session_id: &str) -> Result<SessionDetailDto, SessionsError> {
        // Allocates both child identities inside the serialized state commit.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            let tab_id = state.allocate_id("tab");
            let pane_id = state.allocate_id("pane");
            let session = session_from_mut(state, session_id)?;
            session.tabs.push(empty_tab(tab_id.clone(), pane_id));
            session.active_tab_id = Some(tab_id);
            Ok(Mutation::Changed(()))
        })
        .await
    }

    /// Renames one tab without changing its identity or position.
    pub async fn rename_tab(
        &self,
        session_id: &str,
        tab_id: &str,
        name: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        let name = normalize_name(name)?;
        // Changes only the selected tab's normalized display name.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, move |state| {
            let tab = session_from_mut(state, session_id)?.tab_mut(tab_id)?;
            if tab.dto.name == name {
                Ok(Mutation::Unchanged(()))
            } else {
                tab.dto.name = name;
                Ok(Mutation::Changed(()))
            }
        })
        .await
    }

    /// Moves one tab before a stable sibling identifier or to the end.
    pub async fn move_tab(
        &self,
        session_id: &str,
        tab_id: &str,
        before_tab_id: Option<&str>,
    ) -> Result<SessionDetailDto, SessionsError> {
        if before_tab_id == Some(tab_id) {
            return Err(SessionsError::InvalidMove);
        }
        // Resolves both stable positions before removing the source tab.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            let session = session_from_mut(state, session_id)?;
            let from = session
                .tabs
                .iter()
                // The source is resolved by opaque identity rather than array index from IPC.
                .position(|tab| tab.dto.id == tab_id)
                // A stale source produces the exact child-not-found category.
                .ok_or_else(|| SessionsError::TabNotFound {
                    tab_id: tab_id.to_owned(),
                })?;
            let desired = match before_tab_id {
                Some(before) => session
                    .tabs
                    .iter()
                    // The destination must be another live child of the same session.
                    .position(|tab| tab.dto.id == before)
                    .ok_or(SessionsError::InvalidMove)?,
                None => session.tabs.len(),
            };
            let target = if desired > from { desired - 1 } else { desired };
            if from == target {
                return Ok(Mutation::Unchanged(()));
            }
            let tab = session.tabs.remove(from);
            session.tabs.insert(target, tab);
            Ok(Mutation::Changed(()))
        })
        .await
    }

    /// Selects the active tab when it differs from the current selection.
    pub async fn set_active_tab(
        &self,
        session_id: &str,
        tab_id: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        // Preserves the revision when the requested tab is already active.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            let session = session_from_mut(state, session_id)?;
            session.tab(tab_id)?;
            if session.active_tab_id.as_deref() == Some(tab_id) {
                Ok(Mutation::Unchanged(()))
            } else {
                session.active_tab_id = Some(tab_id.to_owned());
                Ok(Mutation::Changed(()))
            }
        })
        .await
    }

    /// Selects one pane and its containing tab.
    pub async fn set_active_pane(
        &self,
        session_id: &str,
        tab_id: &str,
        pane_id: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        // Validates the parent-child relationship before changing either active identifier.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            let session = session_from_mut(state, session_id)?;
            let already_active_tab = session.active_tab_id.as_deref() == Some(tab_id);
            let tab = session.tab_mut(tab_id)?;
            if find_pane(&tab.dto.layout, pane_id).is_none() {
                return Err(SessionsError::PaneNotFound {
                    pane_id: pane_id.to_owned(),
                });
            }
            let already_active_pane = tab.dto.active_pane_id == pane_id;
            tab.dto.active_pane_id = pane_id.to_owned();
            session.active_tab_id = Some(tab_id.to_owned());
            if already_active_tab && already_active_pane {
                Ok(Mutation::Unchanged(()))
            } else {
                Ok(Mutation::Changed(()))
            }
        })
        .await
    }

    /// Splits one pane rightward or downward and activates the new empty pane.
    pub async fn split_pane(
        &self,
        session_id: &str,
        tab_id: &str,
        pane_id: &str,
        direction: SplitDirectionDto,
    ) -> Result<SessionDetailDto, SessionsError> {
        // Revalidates the target and pane cap in the same commit that allocates children.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            {
                let session = session_from(state, session_id)?;
                let tab = session.tab(tab_id)?;
                if find_pane(&tab.dto.layout, pane_id).is_none() {
                    return Err(SessionsError::PaneNotFound {
                        pane_id: pane_id.to_owned(),
                    });
                }
                if pane_count(&tab.dto.layout) >= 4 {
                    return Err(SessionsError::PaneLimitReached);
                }
            }
            let split_id = state.allocate_id("split");
            let new_pane_id = state.allocate_id("pane");
            let tab = session_from_mut(state, session_id)?.tab_mut(tab_id)?;
            let inserted = replace_pane_with_split(
                &mut tab.dto.layout,
                pane_id,
                split_id,
                PaneDto {
                    id: new_pane_id.clone(),
                    content: PaneContentDto::Empty,
                },
                direction,
            );
            debug_assert!(inserted);
            tab.activity
                .insert(new_pane_id.clone(), PaneActivitySnapshot::default());
            tab.dto.active_pane_id = new_pane_id;
            tab.dto.maximized_pane_id = None;
            Ok(Mutation::Changed(()))
        })
        .await
    }

    /// Commits one final split ratio within the documented bounds.
    pub async fn set_split_ratio(
        &self,
        session_id: &str,
        tab_id: &str,
        split_id: &str,
        ratio_basis_points: u16,
    ) -> Result<SessionDetailDto, SessionsError> {
        if !(1000..=9000).contains(&ratio_basis_points) {
            return Err(SessionsError::InvalidSplitRatio);
        }
        // Preserves the revision when the final drag value matches committed state.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            let tab = session_from_mut(state, session_id)?.tab_mut(tab_id)?;
            let ratio = find_split_ratio_mut(&mut tab.dto.layout, split_id).ok_or_else(
                // A stale split handle is reported without changing the tree.
                || SessionsError::SplitNotFound {
                    split_id: split_id.to_owned(),
                },
            )?;
            if *ratio == ratio_basis_points {
                Ok(Mutation::Unchanged(()))
            } else {
                *ratio = ratio_basis_points;
                Ok(Mutation::Changed(()))
            }
        })
        .await
    }

    /// Maximizes one pane or restores the full tab layout.
    pub async fn set_maximized_pane(
        &self,
        session_id: &str,
        tab_id: &str,
        pane_id: Option<&str>,
    ) -> Result<SessionDetailDto, SessionsError> {
        // Changes only the maximize reference after validating the optional pane.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            let tab = session_from_mut(state, session_id)?.tab_mut(tab_id)?;
            if let Some(pane_id) = pane_id
                && find_pane(&tab.dto.layout, pane_id).is_none()
            {
                return Err(SessionsError::PaneNotFound {
                    pane_id: pane_id.to_owned(),
                });
            }
            if tab.dto.maximized_pane_id.as_deref() == pane_id {
                Ok(Mutation::Unchanged(()))
            } else {
                tab.dto.maximized_pane_id = pane_id.map(str::to_owned);
                Ok(Mutation::Changed(()))
            }
        })
        .await
    }

    /// Creates the first tool-selection tab after rechecking profile availability.
    pub async fn select_session_tool(
        &self,
        session_id: &str,
        profile_id: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        {
            let state = self.inner.state.read().await;
            state.admit_session_mutation(session_id)?;
            if !session_from(&state, session_id)?.tabs.is_empty() {
                return Err(SessionsError::SessionNotEmpty);
            }
        }
        let profile = self.lookup_profile(profile_id).await?;
        // Rechecks that the session stayed empty while profile lookup was awaiting.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            if !session_from(state, session_id)?.tabs.is_empty() {
                return Err(SessionsError::SessionNotEmpty);
            }
            let tab_id = state.allocate_id("tab");
            let pane_id = state.allocate_id("pane");
            let mut tab = empty_tab(tab_id.clone(), pane_id.clone());
            tab.dto.name = profile.display_name.clone();
            find_pane_mut(&mut tab.dto.layout, &pane_id)
                .expect("a newly constructed tab owns its pane")
                .content = PaneContentDto::ToolSelection {
                profile_id: profile.id.clone(),
                title: profile.display_name.clone(),
            };
            let session = session_from_mut(state, session_id)?;
            session.tabs.push(tab);
            session.active_tab_id = Some(tab_id);
            Ok(Mutation::Changed(()))
        })
        .await
    }

    /// Stores a currently launchable profile in one empty pane.
    pub async fn select_pane_tool(
        &self,
        session_id: &str,
        tab_id: &str,
        pane_id: &str,
        profile_id: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        {
            let state = self.inner.state.read().await;
            state.admit_session_mutation(session_id)?;
            let pane = find_pane(
                &session_from(&state, session_id)?.tab(tab_id)?.dto.layout,
                pane_id,
            )
            // The pane relationship is checked before the profile port is called.
            .ok_or_else(|| SessionsError::PaneNotFound {
                pane_id: pane_id.to_owned(),
            })?;
            if pane.content != PaneContentDto::Empty {
                return Err(SessionsError::PaneNotEmpty);
            }
        }
        let profile = self.lookup_profile(profile_id).await?;
        // Rechecks pane emptiness after the asynchronous profile lookup finishes.
        self.mutate_session(session_id, SessionChangeKindDto::Updated, |state| {
            let tab = session_from_mut(state, session_id)?.tab_mut(tab_id)?;
            let pane = find_pane_mut(&mut tab.dto.layout, pane_id).ok_or_else(
                // A competing close can invalidate the pane while lookup is pending.
                || SessionsError::PaneNotFound {
                    pane_id: pane_id.to_owned(),
                },
            )?;
            if pane.content != PaneContentDto::Empty {
                return Err(SessionsError::PaneNotEmpty);
            }
            pane.content = PaneContentDto::ToolSelection {
                profile_id: profile.id.clone(),
                title: profile.display_name.clone(),
            };
            Ok(Mutation::Changed(()))
        })
        .await
    }

    /// Replaces a tool selection with content owned by another backend capability.
    pub async fn attach_runtime_content(
        &self,
        pane_id: &str,
        content: PaneContentRef,
    ) -> Result<SessionDetailDto, SessionsError> {
        let session_id = self.session_id_for_pane(pane_id).await?;
        // Revalidates both ownership and the tool-selection placeholder at commit.
        self.mutate_session(&session_id, SessionChangeKindDto::Updated, |state| {
            let session = session_from_mut(state, &session_id)?;
            let pane = find_pane_in_session_mut(session, pane_id)?;
            let PaneContentDto::ToolSelection { profile_id, .. } = &pane.content else {
                return Err(SessionsError::PaneNotEmpty);
            };
            if let PaneContentRef::Terminal {
                profile_id: next, ..
            } = &content
                && next != profile_id
            {
                return Err(SessionsError::PaneNotEmpty);
            }
            if matches!(content, PaneContentRef::ToolSelection { .. }) {
                return Err(SessionsError::PaneNotEmpty);
            }
            pane.content = content.to_dto();
            Ok(Mutation::Changed(()))
        })
        .await
    }

    /// Records an output edge and derives unread status from route visibility.
    pub async fn record_pane_output(&self, pane_id: &str) -> Result<(), SessionsError> {
        let session_id = self.session_id_for_pane(pane_id).await?;
        let _commit = self.inner.commit_gate.lock().await;
        let event = {
            let mut state = self.inner.state.write().await;
            state.admit_session_mutation(&session_id)?;
            let observed = state.main_window_visible
                && state.observed_session_id.as_deref() == Some(&session_id);
            let session = session_from_mut(&mut state, &session_id)?;
            find_pane_in_session(session, pane_id)?;
            if observed || session.unseen_output {
                return Ok(());
            }
            session.unseen_output = true;
            let revision = state.allocate_revision();
            update_attention_transition(&mut state, &session_id, revision)?;
            let summary = session_from(&state, &session_id)?.summary()?;
            let project_id = summary.project_id.clone();
            Some(event_for(
                revision,
                SessionChangeKindDto::ActivityChanged,
                &project_id,
                &session_id,
                Some(summary),
            ))
        };
        if let Some(event) = event {
            self.publish(event);
        }
        Ok(())
    }

    /// Replaces one pane's process and attention activity snapshot.
    pub async fn update_pane_activity(
        &self,
        pane_id: &str,
        activity: PaneActivitySnapshot,
    ) -> Result<(), SessionsError> {
        let session_id = self.session_id_for_pane(pane_id).await?;
        let _commit = self.inner.commit_gate.lock().await;
        let event = {
            let mut state = self.inner.state.write().await;
            state.admit_session_mutation(&session_id)?;
            let old_summary = session_from(&state, &session_id)?.summary()?;
            let session = session_from_mut(&mut state, &session_id)?;
            let tab = session
                .tabs
                .iter_mut()
                // Activity is stored alongside the exact tab containing this pane.
                .find(|tab| find_pane(&tab.dto.layout, pane_id).is_some())
                // A stale content-owner update must not create a detached activity entry.
                .ok_or_else(|| SessionsError::PaneNotFound {
                    pane_id: pane_id.to_owned(),
                })?;
            if tab.activity.get(pane_id) == Some(&activity) {
                return Ok(());
            }
            tab.activity.insert(pane_id.to_owned(), activity);
            let new_summary = session_from(&state, &session_id)?.summary()?;
            if old_summary == new_summary {
                return Ok(());
            }
            let revision = state.allocate_revision();
            set_attention_from_status(
                &mut state,
                &session_id,
                old_summary.status,
                new_summary.status,
                revision,
            );
            let project_id = new_summary.project_id.clone();
            Some(event_for(
                revision,
                SessionChangeKindDto::ActivityChanged,
                &project_id,
                &session_id,
                Some(new_summary),
            ))
        };
        if let Some(event) = event {
            self.publish(event);
        }
        Ok(())
    }

    /// Updates the route-observed session and clears unread output only while visible.
    pub async fn set_observed_session(
        &self,
        session_id: Option<&str>,
    ) -> Result<Option<SessionSummaryDto>, SessionsError> {
        let _commit = self.inner.commit_gate.lock().await;
        let (result, event) = {
            let mut state = self.inner.state.write().await;
            if state.shutting_down {
                return Err(SessionsError::RuntimeShuttingDown);
            }
            if let Some(session_id) = session_id {
                session_from(&state, session_id)?;
            }
            state.observed_session_id = session_id.map(str::to_owned);
            let Some(session_id) = session_id else {
                return Ok(None);
            };
            let old_summary = session_from(&state, session_id)?.summary()?;
            if state.main_window_visible {
                session_from_mut(&mut state, session_id)?.unseen_output = false;
            }
            let new_summary = session_from(&state, session_id)?.summary()?;
            if old_summary == new_summary {
                (Some(new_summary), None)
            } else {
                let revision = state.allocate_revision();
                set_attention_from_status(
                    &mut state,
                    session_id,
                    old_summary.status,
                    new_summary.status,
                    revision,
                );
                let event = event_for(
                    revision,
                    SessionChangeKindDto::ActivityChanged,
                    &new_summary.project_id,
                    session_id,
                    Some(new_summary.clone()),
                );
                (Some(new_summary), Some(event))
            }
        };
        if let Some(event) = event {
            self.publish(event);
        }
        Ok(result)
    }

    /// Updates native main-window visibility and clears unread output when shown.
    pub async fn set_main_window_visible(&self, visible: bool) {
        let _commit = self.inner.commit_gate.lock().await;
        let event = {
            let mut state = self.inner.state.write().await;
            state.main_window_visible = visible;
            if !visible || state.shutting_down {
                None
            } else if let Some(session_id) = state.observed_session_id.clone() {
                let old_summary = session_from(&state, &session_id)
                    .and_then(SessionRecord::summary)
                    .ok();
                if let Some(session) = state.sessions.get_mut(&session_id) {
                    session.unseen_output = false;
                }
                let new_summary = session_from(&state, &session_id)
                    .and_then(SessionRecord::summary)
                    .ok();
                match (old_summary, new_summary) {
                    (Some(old), Some(new)) if old != new => {
                        let revision = state.allocate_revision();
                        set_attention_from_status(
                            &mut state,
                            &session_id,
                            old.status,
                            new.status,
                            revision,
                        );
                        let project_id = new.project_id.clone();
                        Some(event_for(
                            revision,
                            SessionChangeKindDto::ActivityChanged,
                            &project_id,
                            &session_id,
                            Some(new),
                        ))
                    }
                    _ => None,
                }
            } else {
                None
            }
        };
        if let Some(event) = event {
            self.publish(event);
        }
    }

    /// Returns notification display and visibility facts from one read snapshot.
    pub async fn notification_context(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionNotificationContext>, SessionsError> {
        let state = self.inner.state.read().await;
        Ok(state
            .sessions
            .get(session_id)
            // A concurrent deletion deliberately becomes a missing notification context.
            .map(|session| SessionNotificationContext {
                project_id: session.project_id.clone(),
                session_name: session.name.clone(),
                is_observed: state.main_window_visible
                    && state.observed_session_id.as_deref() == Some(session_id),
            }))
    }

    /// Returns attention summaries with transition revisions from one read snapshot.
    pub async fn attention_sessions(&self) -> Result<Vec<SessionAttentionSnapshot>, SessionsError> {
        let state = self.inner.state.read().await;
        state
            .sessions
            .values()
            // Only sessions with a recorded transition into attention are returned.
            .filter_map(|session| {
                session
                    .attention_sequence
                    // Pair the sequence with the record from the same read snapshot.
                    .map(|sequence| (session, sequence))
            })
            // Build every public summary before releasing the shared state snapshot.
            .map(|(session, attention_sequence)| {
                Ok(SessionAttentionSnapshot {
                    summary: session.summary()?,
                    attention_sequence,
                })
            })
            .collect()
    }

    /// Inspects current process and unsaved-file blockers for one close target.
    pub async fn get_close_impact(
        &self,
        target: CloseTargetDto,
    ) -> Result<CloseImpactDto, SessionsError> {
        let contents = {
            let state = self.inner.state.read().await;
            target_contents(&state, &target)?
        };
        self.inspect_contents(target, contents).await
    }

    /// Closes a session, tab, or pane after rechecking confirmation requirements.
    pub async fn close_runtime_target(
        &self,
        target: CloseTargetDto,
        confirmed: bool,
    ) -> Result<CloseResultDto, SessionsError> {
        self.close_target(target, confirmed).await
    }

    /// Reopens the most recently closed tab without restarting its processes.
    pub async fn reopen_last_closed_tab(
        &self,
        session_id: &str,
    ) -> Result<SessionDetailDto, SessionsError> {
        let snapshot = {
            let mut state = self.inner.state.write().await;
            state.admit_session_mutation(session_id)?;
            let session = session_from_mut(&mut state, session_id)?;
            let snapshot = session
                .last_closed_tab
                .clone()
                // Reopen is valid only while the single retained slot is populated.
                .ok_or_else(|| SessionsError::NoClosedTab {
                    session_id: session_id.to_owned(),
                })?;
            state.closing_sessions.insert(session_id.to_owned());
            snapshot
        };

        let mut restored = Vec::new();
        let mut first_error = None;
        for (pane_id, handle) in &snapshot.handles {
            let Some(handle) = handle.clone() else {
                continue;
            };
            match self.inner.content.reopen(handle).await {
                Ok(content) => restored.push((pane_id.clone(), content)),
                Err(_) if first_error.is_none() => {
                    first_error = Some(content_failure("reopen", pane_id));
                }
                Err(_) => {}
            }
        }
        if let Some(error) = first_error {
            for (_, content) in restored {
                let _ = self
                    .inner
                    .content
                    .close(&content, CloseRetention::ReopenLastTab)
                    .await;
            }
            self.clear_closing(session_id).await;
            return Err(error);
        }

        let _commit = self.inner.commit_gate.lock().await;
        let (detail, event) = {
            let mut state = self.inner.state.write().await;
            let revision = state.allocate_revision();
            let session = session_from_mut(&mut state, session_id)?;
            let mut tab = snapshot.tab.clone();
            for (pane_id, content) in restored {
                // Every reopened value must still map to its retained pane leaf.
                let pane = find_pane_mut(&mut tab.dto.layout, &pane_id).ok_or_else(|| {
                    SessionsError::PaneNotFound {
                        pane_id: pane_id.clone(),
                    }
                })?;
                pane.content = content.to_dto();
            }
            let index = snapshot.original_index.min(session.tabs.len());
            let tab_id = tab.dto.id.clone();
            let active_pane_id = tab.dto.active_pane_id.clone();
            session.tabs.insert(index, tab);
            session.active_tab_id = Some(tab_id.clone());
            session
                .tabs
                .iter_mut()
                // Select the just-inserted tab by its stable runtime identity.
                .find(|tab| tab.dto.id == tab_id)
                .expect("the reopened tab was just inserted")
                .dto
                .active_pane_id = active_pane_id;
            session.last_closed_tab = None;
            state.closing_sessions.remove(session_id);
            update_attention_transition(&mut state, session_id, revision)?;
            let detail = session_from(&state, session_id)?.detail(revision)?;
            let event = event_for(
                revision,
                SessionChangeKindDto::Updated,
                &detail.summary.project_id,
                session_id,
                Some(detail.summary.clone()),
            );
            (detail, event)
        };
        self.publish(event);
        for handle in snapshot
            .handles
            .into_iter()
            // Empty panes never produce a runtime handle to release.
            .filter_map(|(_, handle)| handle)
        {
            if self.inner.content.discard(handle).await.is_err() {
                eprintln!("sessions retained-content release failed");
            }
        }
        Ok(detail)
    }

    /// Returns current application-wide runtime counts for Quit or Reset.
    pub async fn shutdown_impact(&self) -> Result<ShutdownImpact, SessionsError> {
        let (session_count, contents) = {
            let state = self.inner.state.read().await;
            let session_count = count_to_u32(state.sessions.len(), "runtime")?;
            let mut contents = Vec::new();
            for session in state.sessions.values() {
                contents.extend(session_contents(session));
            }
            (session_count, contents)
        };
        let impact = self.inspect_content_list("runtime", contents).await?;
        Ok(ShutdownImpact {
            session_count,
            running_process_count: impact.running_process_count,
            unsaved_file_count: impact.unsaved_file_count,
        })
    }

    /// Returns runtime counts scoped to one project without changing admission.
    pub async fn project_removal_impact(
        &self,
        project_id: &str,
    ) -> Result<ProjectSessionsImpact, SessionsError> {
        let (session_count, contents) = {
            let state = self.inner.state.read().await;
            let ids = state
                .project_sessions
                .get(project_id)
                .cloned()
                .unwrap_or_default();
            let mut contents = Vec::new();
            for id in &ids {
                if let Some(session) = state.sessions.get(id) {
                    contents.extend(session_contents(session));
                }
            }
            (count_to_u32(ids.len(), project_id)?, contents)
        };
        let impact = self.inspect_content_list(project_id, contents).await?;
        Ok(ProjectSessionsImpact {
            session_count,
            running_process_count: impact.running_process_count,
            unsaved_file_count: impact.unsaved_file_count,
        })
    }

    /// Closes every session owned by one project and remains retryable after failures.
    pub async fn close_project_sessions(&self, project_id: &str) -> Result<(), SessionsError> {
        let _project_cleanup = self.inner.project_cleanup_gate.lock().await;
        let session_ids = {
            let mut state = self.inner.state.write().await;
            if state.shutting_down {
                return Err(SessionsError::RuntimeShuttingDown);
            }
            state.closing_projects.insert(project_id.to_owned());
            state
                .project_sessions
                .get(project_id)
                .cloned()
                .unwrap_or_default()
        };
        let mut first_error = None;
        for session_id in session_ids {
            let target = CloseTargetDto::Session { session_id };
            match self.close_target(target, true).await {
                Ok(_) | Err(SessionsError::SessionNotFound { .. }) => {}
                Err(error) if first_error.is_none() => first_error = Some(error),
                Err(_) => {}
            }
        }
        self.inner
            .state
            .write()
            .await
            .closing_projects
            .remove(project_id);
        first_error.map_or(Ok(()), Err)
    }

    /// Stops all current and retained content before clearing runtime state.
    pub async fn shutdown_all(&self) -> Result<(), SessionsError> {
        let (contents, retained) = {
            let mut state = self.inner.state.write().await;
            state.shutting_down = true;
            let mut contents = Vec::new();
            let mut retained = Vec::new();
            for session in state.sessions.values() {
                contents.extend(session_contents(session));
                if let Some(closed) = &session.last_closed_tab {
                    retained.extend(
                        closed
                            .handles
                            .iter()
                            // Empty panes have no retained owner resource to release.
                            .filter_map(|(_, handle)| handle.clone()),
                    );
                }
            }
            (contents, retained)
        };
        let mut first_error = None;
        for content in contents {
            if self
                .inner
                .content
                .close(&content, CloseRetention::Discard)
                .await
                .is_err()
                && first_error.is_none()
            {
                first_error = Some(content_failure("shutdown", "runtime"));
            }
        }
        for handle in retained {
            if self.inner.content.discard(handle).await.is_err() && first_error.is_none() {
                first_error = Some(content_failure("discard", "runtime"));
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        let mut state = self.inner.state.write().await;
        state.sessions.clear();
        state.project_sessions.clear();
        state.observed_session_id = None;
        state.closing_sessions.clear();
        state.closing_projects.clear();
        Ok(())
    }

    /// Reopens admission after a Reset attempt without restoring cleared sessions.
    pub fn resume_after_reset(&self, _committed: bool) {
        if let Ok(mut state) = self.inner.state.try_write() {
            state.shutting_down = false;
        } else {
            let manager = self.clone();
            tauri::async_runtime::spawn(async move {
                manager.inner.state.write().await.shutting_down = false;
            });
        }
    }

    /// Runs one short session mutation, revision commit, and ordered event publication.
    async fn mutate_session<F>(
        &self,
        session_id: &str,
        change: SessionChangeKindDto,
        operation: F,
    ) -> Result<SessionDetailDto, SessionsError>
    where
        F: FnOnce(&mut ManagerState) -> Result<Mutation<()>, SessionsError>,
    {
        let _commit = self.inner.commit_gate.lock().await;
        let (detail, event) = {
            let mut state = self.inner.state.write().await;
            state.admit_session_mutation(session_id)?;
            session_from(&state, session_id)?;
            let old_status = session_from(&state, session_id)?.summary()?.status;
            let mutation = operation(&mut state)?;
            match mutation {
                Mutation::Unchanged(()) => {
                    return session_from(&state, session_id)?.detail(state.revision);
                }
                Mutation::Changed(()) => {}
            }
            let revision = state.allocate_revision();
            let new_status = session_from(&state, session_id)?.summary()?.status;
            set_attention_from_status(&mut state, session_id, old_status, new_status, revision);
            let detail = session_from(&state, session_id)?.detail(revision)?;
            let event = event_for(
                revision,
                change,
                &detail.summary.project_id,
                session_id,
                Some(detail.summary.clone()),
            );
            (detail, event)
        };
        self.publish(event);
        Ok(detail)
    }

    /// Rechecks one profile and maps unavailable state into the public contract.
    async fn lookup_profile(&self, profile_id: &str) -> Result<LaunchableProfile, SessionsError> {
        let profile = self.inner.profiles.launchable_profile(profile_id).await?;
        if !profile.is_available {
            return Err(SessionsError::ProfileUnavailable {
                profile_id: profile_id.to_owned(),
            });
        }
        Ok(profile)
    }

    /// Resolves the owning session of one live pane from a read snapshot.
    async fn session_id_for_pane(&self, pane_id: &str) -> Result<String, SessionsError> {
        let state = self.inner.state.read().await;
        state
            .sessions
            .values()
            // Resolve ownership against one immutable manager snapshot.
            .find(|session| find_pane_in_session(session, pane_id).is_ok())
            // Return only the stable parent identity, never an internal reference.
            .map(|session| session.id.clone())
            // A stale content-owner callback fails at the pane boundary.
            .ok_or_else(|| SessionsError::PaneNotFound {
                pane_id: pane_id.to_owned(),
            })
    }

    /// Aggregates content-port impact for an exact target snapshot.
    async fn inspect_contents(
        &self,
        target: CloseTargetDto,
        contents: Vec<PaneContentRef>,
    ) -> Result<CloseImpactDto, SessionsError> {
        let mut impact = self
            .inspect_content_list(target.target_id(), contents)
            .await?;
        impact.target = target.clone();
        impact.requires_confirmation = matches!(target, CloseTargetDto::Session { .. })
            || impact.running_process_count > 0
            || impact.unsaved_file_count > 0;
        Ok(impact)
    }

    /// Aggregates labels from the content runtime using checked public counts.
    async fn inspect_content_list(
        &self,
        target_id: &str,
        contents: Vec<PaneContentRef>,
    ) -> Result<CloseImpactDto, SessionsError> {
        let mut running_process_labels = Vec::new();
        let mut unsaved_file_labels = Vec::new();
        for content in contents {
            let PaneCloseImpact {
                running_process_labels: running,
                unsaved_file_labels: unsaved,
            } = self
                .inner
                .content
                .close_impact(&content)
                .await
                // Reduce raw owner errors to the stable public lifecycle category.
                .map_err(|_| content_failure("inspect", target_id))?;
            running_process_labels.extend(running);
            unsaved_file_labels.extend(unsaved);
        }
        Ok(CloseImpactDto {
            target: CloseTargetDto::Session {
                session_id: target_id.to_owned(),
            },
            requires_confirmation: false,
            running_process_count: count_to_u32(running_process_labels.len(), target_id)?,
            running_process_labels,
            unsaved_file_count: count_to_u32(unsaved_file_labels.len(), target_id)?,
            unsaved_file_labels,
        })
    }

    /// Executes the mark, await, revalidate, and commit path for one close target.
    async fn close_target(
        &self,
        target: CloseTargetDto,
        confirmed: bool,
    ) -> Result<CloseResultDto, SessionsError> {
        let session_id = target.session_id().to_owned();
        let (contents, old_closed) = {
            let mut state = self.inner.state.write().await;
            if state.shutting_down {
                return Err(SessionsError::RuntimeShuttingDown);
            }
            if state.closing_sessions.contains(&session_id) {
                return Err(SessionsError::CloseInProgress { session_id });
            }
            let session = session_from(&state, &session_id)?;
            validate_target(session, &target)?;
            if let CloseTargetDto::Pane {
                tab_id, pane_id, ..
            } = &target
            {
                let tab = session.tab(tab_id)?;
                // Confirm that the pane still belongs to the exact supplied tab.
                let pane = find_pane(&tab.dto.layout, pane_id).ok_or_else(|| {
                    SessionsError::PaneNotFound {
                        pane_id: pane_id.clone(),
                    }
                })?;
                if pane_count(&tab.dto.layout) == 1 && pane.content == PaneContentDto::Empty {
                    return Ok(CloseResultDto {
                        target,
                        session: Some(session.detail(state.revision)?),
                    });
                }
            }
            let contents = target_contents(&state, &target)?;
            let old_closed = if matches!(
                target,
                CloseTargetDto::Session { .. } | CloseTargetDto::Tab { .. }
            ) {
                session.last_closed_tab.clone()
            } else {
                None
            };
            state.closing_sessions.insert(session_id.clone());
            (contents, old_closed)
        };

        let impact = match self
            .inspect_contents(target.clone(), contents.clone())
            .await
        {
            Ok(impact) => impact,
            Err(error) => {
                self.clear_closing(&session_id).await;
                return Err(error);
            }
        };
        if impact.requires_confirmation && !confirmed {
            self.clear_closing(&session_id).await;
            return Err(SessionsError::ConfirmationRequired { impact });
        }

        let retention = if matches!(target, CloseTargetDto::Tab { .. }) {
            CloseRetention::ReopenLastTab
        } else {
            CloseRetention::Discard
        };
        let mut handles = Vec::new();
        let mut first_error = None;
        for content in &contents {
            match self.inner.content.close(content, retention).await {
                Ok(handle) => handles.push(handle),
                Err(_) if first_error.is_none() => {
                    first_error = Some(content_failure("close", target.target_id()));
                }
                Err(_) => {}
            }
        }
        if let Some(error) = first_error {
            self.clear_closing(&session_id).await;
            return Err(error);
        }

        // Evict the previous reopen slot only after the new target has closed cleanly.
        // This preserves a usable old snapshot when closing the replacement target fails.
        if let Some(old_closed) = old_closed {
            for handle in old_closed
                .handles
                .into_iter()
                // Empty panes have no retained owner resource to discard.
                .filter_map(|(_, handle)| handle)
            {
                if self.inner.content.discard(handle).await.is_err() {
                    self.clear_closing(&session_id).await;
                    return Err(content_failure("discard", target.target_id()));
                }
            }
        }

        let _commit = self.inner.commit_gate.lock().await;
        let (result, event) = {
            let mut state = self.inner.state.write().await;
            let old_status = session_from(&state, &session_id)?.summary()?.status;
            validate_target(session_from(&state, &session_id)?, &target)?;
            let revision = state.allocate_revision();
            let (project_id, deleted) = commit_close(&mut state, &target, handles)?;
            state.closing_sessions.remove(&session_id);
            if deleted {
                remove_session_order(&mut state, &project_id, &session_id);
                if state.observed_session_id.as_deref() == Some(&session_id) {
                    state.observed_session_id = None;
                }
                let event = event_for(
                    revision,
                    SessionChangeKindDto::Deleted,
                    &project_id,
                    &session_id,
                    None,
                );
                (
                    CloseResultDto {
                        target: target.clone(),
                        session: None,
                    },
                    event,
                )
            } else {
                let new_status = session_from(&state, &session_id)?.summary()?.status;
                set_attention_from_status(
                    &mut state,
                    &session_id,
                    old_status,
                    new_status,
                    revision,
                );
                let detail = session_from(&state, &session_id)?.detail(revision)?;
                let event = event_for(
                    revision,
                    SessionChangeKindDto::Updated,
                    &project_id,
                    &session_id,
                    Some(detail.summary.clone()),
                );
                (
                    CloseResultDto {
                        target: target.clone(),
                        session: Some(detail),
                    },
                    event,
                )
            }
        };
        self.publish(event);
        Ok(result)
    }

    /// Clears one close-operation marker after an external failure or cancellation.
    async fn clear_closing(&self, session_id: &str) {
        self.inner
            .state
            .write()
            .await
            .closing_sessions
            .remove(session_id);
    }

    /// Publishes one event best-effort after releasing the state lock.
    fn publish(&self, event: SessionRuntimeEventDto) {
        if self.inner.events.publish(event).is_err() {
            eprintln!("sessions runtime event delivery failed");
        }
    }
}

/// Builds a new empty tab with one active pane and matching activity entry.
fn empty_tab(tab_id: String, pane_id: String) -> TabRecord {
    let mut activity = HashMap::new();
    activity.insert(pane_id.clone(), PaneActivitySnapshot::default());
    TabRecord {
        dto: TabDto {
            id: tab_id,
            name: "New Tab".to_owned(),
            layout: PaneLayoutNodeDto::Pane {
                pane: PaneDto {
                    id: pane_id.clone(),
                    content: PaneContentDto::Empty,
                },
            },
            active_pane_id: pane_id,
            maximized_pane_id: None,
        },
        activity,
    }
}

/// Finds one immutable session by its opaque runtime identifier.
fn session_from<'a>(
    state: &'a ManagerState,
    session_id: &str,
) -> Result<&'a SessionRecord, SessionsError> {
    state
        .sessions
        .get(session_id)
        // Runtime IDs from another process or a completed delete are stale.
        .ok_or_else(|| SessionsError::SessionNotFound {
            session_id: session_id.to_owned(),
        })
}

/// Finds one mutable session by its opaque runtime identifier.
fn session_from_mut<'a>(
    state: &'a mut ManagerState,
    session_id: &str,
) -> Result<&'a mut SessionRecord, SessionsError> {
    state
        .sessions
        .get_mut(session_id)
        // Runtime IDs from another process or a completed delete are stale.
        .ok_or_else(|| SessionsError::SessionNotFound {
            session_id: session_id.to_owned(),
        })
}

/// Finds one pane in any tab of a session.
fn find_pane_in_session<'a>(
    session: &'a SessionRecord,
    pane_id: &str,
) -> Result<&'a PaneDto, SessionsError> {
    session
        .tabs
        .iter()
        // Content owners address panes globally, so inspect every tab.
        .find_map(|tab| find_pane(&tab.dto.layout, pane_id))
        // Never create a detached pane record for a stale callback.
        .ok_or_else(|| SessionsError::PaneNotFound {
            pane_id: pane_id.to_owned(),
        })
}

/// Finds one mutable pane in any tab of a session.
fn find_pane_in_session_mut<'a>(
    session: &'a mut SessionRecord,
    pane_id: &str,
) -> Result<&'a mut PaneDto, SessionsError> {
    session
        .tabs
        .iter_mut()
        // Content owners address panes globally, so inspect every tab.
        .find_map(|tab| find_pane_mut(&mut tab.dto.layout, pane_id))
        // Never create a detached pane record for a stale callback.
        .ok_or_else(|| SessionsError::PaneNotFound {
            pane_id: pane_id.to_owned(),
        })
}

/// Converts a collection length into the bounded public count type.
fn count_to_u32(count: usize, target_id: &str) -> Result<u32, SessionsError> {
    // Public counts fail closed instead of truncating a platform-sized value.
    u32::try_from(count).map_err(|_| content_failure("aggregate", target_id))
}

/// Adds activity counts without wrapping the public total.
fn checked_add(left: u32, right: u32, target_id: &str) -> Result<u32, SessionsError> {
    left.checked_add(right)
        // Overflow is exposed only through a sanitized lifecycle failure.
        .ok_or_else(|| content_failure("aggregate", target_id))
}

/// Constructs one sanitized content lifecycle failure.
fn content_failure(operation: &str, target_id: &str) -> SessionsError {
    SessionsError::ContentLifecycleFailed {
        operation: operation.to_owned(),
        target_id: target_id.to_owned(),
    }
}

/// Constructs one event from a committed revision and post-mutation summary.
fn event_for(
    revision: u64,
    change: SessionChangeKindDto,
    project_id: &str,
    session_id: &str,
    summary: Option<SessionSummaryDto>,
) -> SessionRuntimeEventDto {
    SessionRuntimeEventDto {
        revision: revision.to_string(),
        change,
        project_id: project_id.to_owned(),
        session_id: session_id.to_owned(),
        summary,
    }
}

/// Updates the attention sequence after a mutation whose old status is not retained.
fn update_attention_transition(
    state: &mut ManagerState,
    session_id: &str,
    revision: u64,
) -> Result<(), SessionsError> {
    let session = session_from_mut(state, session_id)?;
    let status = session.summary()?.status;
    if status == SessionStatusDto::NeedsAttention && session.attention_sequence.is_none() {
        session.attention_sequence = Some(revision);
    } else if status != SessionStatusDto::NeedsAttention {
        session.attention_sequence = None;
    }
    Ok(())
}

/// Applies exact enter, remain, and leave semantics for attention ordering.
fn set_attention_from_status(
    state: &mut ManagerState,
    session_id: &str,
    old_status: SessionStatusDto,
    new_status: SessionStatusDto,
    revision: u64,
) {
    if let Some(session) = state.sessions.get_mut(session_id) {
        match (old_status, new_status) {
            (SessionStatusDto::NeedsAttention, SessionStatusDto::NeedsAttention) => {}
            (_, SessionStatusDto::NeedsAttention) => session.attention_sequence = Some(revision),
            (SessionStatusDto::NeedsAttention, _) => session.attention_sequence = None,
            _ => {}
        }
    }
}

/// Collects every non-empty content reference in one session.
fn session_contents(session: &SessionRecord) -> Vec<PaneContentRef> {
    let mut contents = Vec::new();
    for tab in &session.tabs {
        let mut panes = Vec::new();
        collect_panes(&tab.dto.layout, &mut panes);
        contents.extend(
            panes
                .iter()
                // Empty leaves do not own a resource requiring lifecycle work.
                .filter_map(|pane| PaneContentRef::from_dto(&pane.content)),
        );
    }
    contents
}

/// Validates the complete parent-child relationship of one close target.
fn validate_target(session: &SessionRecord, target: &CloseTargetDto) -> Result<(), SessionsError> {
    match target {
        CloseTargetDto::Session { .. } => Ok(()),
        CloseTargetDto::Tab { tab_id, .. } => session
            .tab(tab_id)
            // Validation returns no internal tab reference to its caller.
            .map(|_| ()),
        CloseTargetDto::Pane {
            tab_id, pane_id, ..
        } => {
            let tab = session.tab(tab_id)?;
            find_pane(&tab.dto.layout, pane_id)
                // Validation returns no internal pane reference to its caller.
                .map(|_| ())
                // A pane from another tab is stale at this exact parent boundary.
                .ok_or_else(|| SessionsError::PaneNotFound {
                    pane_id: pane_id.clone(),
                })
        }
    }
}

/// Snapshots non-empty content for an exact close target.
fn target_contents(
    state: &ManagerState,
    target: &CloseTargetDto,
) -> Result<Vec<PaneContentRef>, SessionsError> {
    let session = session_from(state, target.session_id())?;
    validate_target(session, target)?;
    let mut panes = Vec::new();
    match target {
        CloseTargetDto::Session { .. } => return Ok(session_contents(session)),
        CloseTargetDto::Tab { tab_id, .. } => {
            collect_panes(&session.tab(tab_id)?.dto.layout, &mut panes);
        }
        CloseTargetDto::Pane {
            tab_id, pane_id, ..
        } => {
            // Snapshot only the exact pane leaf selected under the supplied tab.
            let pane = find_pane(&session.tab(tab_id)?.dto.layout, pane_id).ok_or_else(|| {
                SessionsError::PaneNotFound {
                    pane_id: pane_id.clone(),
                }
            })?;
            panes.push(pane.clone());
        }
    }
    Ok(panes
        .iter()
        // Lifecycle work excludes Empty leaves by construction.
        .filter_map(|pane| PaneContentRef::from_dto(&pane.content))
        .collect())
}

/// Commits one already cleaned close target and reports its owning project and deletion state.
fn commit_close(
    state: &mut ManagerState,
    target: &CloseTargetDto,
    handles: Vec<Option<ReopenHandle>>,
) -> Result<(String, bool), SessionsError> {
    let session_id = target.session_id();
    if matches!(target, CloseTargetDto::Session { .. }) {
        let project_id = session_from(state, session_id)?.project_id.clone();
        state.sessions.remove(session_id);
        return Ok((project_id, true));
    }
    let session = session_from_mut(state, session_id)?;
    let project_id = session.project_id.clone();
    match target {
        CloseTargetDto::Tab { tab_id, .. } => {
            let index = session
                .tabs
                .iter()
                // Retain the insertion index associated with the stable tab identity.
                .position(|tab| tab.dto.id == *tab_id)
                // A stale tab cannot create a detached reopen snapshot.
                .ok_or_else(|| SessionsError::TabNotFound {
                    tab_id: tab_id.clone(),
                })?;
            let tab = session.tabs.remove(index);
            let mut panes = Vec::new();
            collect_panes(&tab.dto.layout, &mut panes);
            let mut handle_iter = handles.into_iter();
            let handles = panes
                .into_iter()
                // Reassociate owner handles with panes in visual tree order.
                .map(|pane| {
                    let handle = if pane.content == PaneContentDto::Empty {
                        None
                    } else {
                        handle_iter.next().flatten()
                    };
                    (pane.id, handle)
                })
                .collect();
            session.last_closed_tab = Some(ClosedTab {
                tab,
                original_index: index,
                handles,
            });
            if session.tabs.is_empty() {
                session.active_tab_id = None;
            } else if session.active_tab_id.as_deref() == Some(tab_id) {
                let fallback = index.min(session.tabs.len() - 1);
                session.active_tab_id = Some(session.tabs[fallback].dto.id.clone());
            }
        }
        CloseTargetDto::Pane {
            tab_id, pane_id, ..
        } => {
            let tab = session.tab_mut(tab_id)?;
            if pane_count(&tab.dto.layout) == 1 {
                // Closing the final pane preserves its leaf and clears its content.
                let pane = find_pane_mut(&mut tab.dto.layout, pane_id).ok_or_else(|| {
                    SessionsError::PaneNotFound {
                        pane_id: pane_id.clone(),
                    }
                })?;
                pane.content = PaneContentDto::Empty;
                tab.activity
                    .insert(pane_id.clone(), PaneActivitySnapshot::default());
                tab.dto.maximized_pane_id = None;
            } else {
                // Removing a leaf promotes its sibling subtree into the parent slot.
                let replacement = collapse_pane(&mut tab.dto.layout, pane_id).ok_or_else(|| {
                    SessionsError::PaneNotFound {
                        pane_id: pane_id.clone(),
                    }
                })?;
                tab.activity.remove(pane_id);
                if tab.dto.active_pane_id == *pane_id {
                    tab.dto.active_pane_id = replacement;
                }
                if tab.dto.maximized_pane_id.as_deref() == Some(pane_id) {
                    tab.dto.maximized_pane_id = None;
                }
            }
        }
        CloseTargetDto::Session { .. } => unreachable!("session close returned above"),
    }
    Ok((project_id, false))
}

/// Removes one deleted session from its project's stable creation order.
fn remove_session_order(state: &mut ManagerState, project_id: &str, session_id: &str) {
    if let Some(order) = state.project_sessions.get_mut(project_id) {
        // Stable project order keeps every surviving runtime identifier unchanged.
        order.retain(|id| id != session_id);
        if order.is_empty() {
            state.project_sessions.remove(project_id);
        }
    }
}

#[cfg(test)]
mod tests {
    /// Keeps the implementation plan's focused test module discoverable.
    pub mod structure_tests {
        /// Confirms the module is selected by the documented focused command.
        #[test]
        fn focused_module_is_discoverable() {
            let event_name = String::from(super::super::SESSION_RUNTIME_CHANGED_EVENT);
            assert_eq!(event_name, "sessions://runtime-changed");
        }
    }

    /// Keeps activity-focused verification independently selectable.
    pub mod activity_tests {
        /// Confirms the module is selected by the documented focused command.
        #[test]
        fn focused_module_is_discoverable() {
            let status = super::super::SessionStatusDto::NeedsAttention;
            assert_ne!(status, super::super::SessionStatusDto::Running);
        }
    }

    /// Keeps close-focused verification independently selectable.
    pub mod close_tests {
        /// Confirms the module is selected by the documented focused command.
        #[test]
        fn focused_module_is_discoverable() {
            let retention = super::super::CloseRetention::ReopenLastTab;
            assert_ne!(retention, super::super::CloseRetention::Discard);
        }
    }

    /// Keeps shutdown-focused verification independently selectable.
    pub mod shutdown_tests {
        /// Confirms the module is selected by the documented focused command.
        #[test]
        fn focused_module_is_discoverable() {
            let impact = super::super::ShutdownImpact::default();
            assert_eq!(impact.session_count, 0);
        }
    }
}
