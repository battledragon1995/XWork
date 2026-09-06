use std::collections::HashMap;
use std::sync::Arc;

use crate::{
    files::FilesService,
    projects::{ProjectAvailabilityDto, ProjectService},
    search::{
        FileSearchDocument, FileSearchSource, ProjectSearchDocument, ProjectSearchSource,
        SearchCandidates, SearchFuture, SearchSessionStatus, SearchShortcutChord,
        SearchSourceError, SessionSearchDocument, SessionSearchSource,
        ShortcutActionSearchDocument, ShortcutCatalogSource,
    },
    sessions::{SessionManager, SessionStatusDto},
    settings::KeyboardShortcutsService,
};

/// Adapts Files candidates and Projects display names to Search documents.
pub(super) struct AppFileSearchSource {
    files: FilesService,
    projects: ProjectService,
}

impl AppFileSearchSource {
    /// Creates a Files source adapter over public owner queries only.
    pub(super) fn new(files: FilesService, projects: ProjectService) -> Self {
        Self { files, projects }
    }
}

impl FileSearchSource for AppFileSearchSource {
    /// Enriches relative file identities with current project display names.
    fn search_files<'a>(
        &'a self,
        query: &'a str,
        candidate_limit: u32,
    ) -> SearchFuture<'a, Result<SearchCandidates<FileSearchDocument>, SearchSourceError>> {
        Box::pin(async move {
            let slice = self
                .files
                .search_openable_files(query, candidate_limit)
                .await
                .map_err(|_| SearchSourceError::Unavailable)?;
            let names = self
                .projects
                .list_projects(None)
                .await
                .map_err(|_| SearchSourceError::Unavailable)?
                .into_iter()
                .map(|project| (project.id, project.display_name))
                .collect::<HashMap<_, _>>();
            let items = slice
                .items
                .into_iter()
                .map(|item| FileSearchDocument {
                    project_name: names.get(&item.project_id).cloned().unwrap_or_default(),
                    project_id: item.project_id,
                    relative_path: item.relative_path,
                    file_name: item.file_name,
                    supports_open_in_split: true,
                    source_order: item.source_order,
                })
                .collect();
            Ok(SearchCandidates {
                items,
                has_more: slice.has_more,
            })
        })
    }
}

/// Adapts the Projects public query to Search-owned documents.
pub(super) struct AppProjectSearchSource {
    projects: ProjectService,
}

impl AppProjectSearchSource {
    /// Creates one public-query adapter for Projects.
    pub(super) fn new(projects: ProjectService) -> Self {
        Self { projects }
    }
}

impl ProjectSearchSource for AppProjectSearchSource {
    /// Maps the current public project list without reordering it.
    fn list_projects<'a>(
        &'a self,
    ) -> SearchFuture<'a, Result<Vec<ProjectSearchDocument>, SearchSourceError>> {
        Box::pin(async move {
            self.projects
                .list_projects(None)
                .await
                .map_err(|_| SearchSourceError::Unavailable)
                .map(|projects| {
                    projects
                        .into_iter()
                        .enumerate()
                        .map(|(source_order, project)| ProjectSearchDocument {
                            project_id: project.id,
                            display_name: project.display_name,
                            root_path: project.root_path,
                            is_available: matches!(
                                project.availability,
                                ProjectAvailabilityDto::Available
                            ),
                            source_order: u32::try_from(source_order).unwrap_or(u32::MAX),
                        })
                        .collect()
                })
        })
    }
}

/// Adapts the Sessions public query to Search-owned documents.
pub(super) struct AppSessionSearchSource {
    sessions: Arc<SessionManager>,
}

impl AppSessionSearchSource {
    /// Creates one public-query adapter for Sessions.
    pub(super) fn new(sessions: Arc<SessionManager>) -> Self {
        Self { sessions }
    }
}

impl SessionSearchSource for AppSessionSearchSource {
    /// Maps the current public session summaries without cloning layouts.
    fn list_sessions<'a>(
        &'a self,
    ) -> SearchFuture<'a, Result<Vec<SessionSearchDocument>, SearchSourceError>> {
        Box::pin(async move {
            self.sessions
                .list_sessions(None)
                .await
                .map_err(|_| SearchSourceError::Unavailable)
                .map(|sessions| {
                    sessions
                        .into_iter()
                        .enumerate()
                        .map(|(source_order, session)| SessionSearchDocument {
                            session_id: session.id,
                            project_id: session.project_id,
                            name: session.name,
                            status: map_session_status(session.status),
                            source_order: u32::try_from(source_order).unwrap_or(u32::MAX),
                        })
                        .collect()
                })
        })
    }
}

/// Maps the owner status enum into the consumer-owned search value.
fn map_session_status(status: SessionStatusDto) -> SearchSessionStatus {
    match status {
        SessionStatusDto::NoToolYet => SearchSessionStatus::NoToolYet,
        SessionStatusDto::Running => SearchSessionStatus::Running,
        SessionStatusDto::UnseenOutput => SearchSessionStatus::UnseenOutput,
        SessionStatusDto::NeedsAttention => SearchSessionStatus::NeedsAttention,
        SessionStatusDto::Finished => SearchSessionStatus::Finished,
        SessionStatusDto::ExitedWithError => SearchSessionStatus::ExitedWithError,
    }
}

/// Adapts the current in-memory shortcut snapshot to Search documents.
pub(super) struct AppShortcutCatalogSource {
    shortcuts: KeyboardShortcutsService,
}

impl AppShortcutCatalogSource {
    /// Creates one public-query adapter for keyboard shortcuts.
    pub(super) fn new(shortcuts: KeyboardShortcutsService) -> Self {
        Self { shortcuts }
    }
}

impl ShortcutCatalogSource for AppShortcutCatalogSource {
    /// Maps every current action and conflict group without filtering dispatchability.
    fn shortcut_actions(&self) -> Result<Vec<ShortcutActionSearchDocument>, SearchSourceError> {
        self.shortcuts
            .snapshot()
            .map_err(|_| SearchSourceError::Unavailable)
            .map(|snapshot| {
                snapshot
                    .actions
                    .into_iter()
                    .enumerate()
                    .map(|(source_order, action)| ShortcutActionSearchDocument {
                        action_id: action.action_id,
                        label: action.label,
                        current_chord: SearchShortcutChord {
                            primary: action.current_chord.primary,
                            alt: action.current_chord.alt,
                            shift: action.current_chord.shift,
                            key_code: action.current_chord.key_code,
                        },
                        shortcut_conflicted: !action.conflicts_with.is_empty(),
                        source_order: u32::try_from(source_order).unwrap_or(u32::MAX),
                    })
                    .collect()
            })
    }
}
