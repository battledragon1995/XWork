use std::{
    collections::{HashMap, HashSet},
    future::{Future, poll_fn},
    pin::pin,
    sync::Arc,
    task::Poll,
    time::Duration,
};

use tokio::time::timeout;

use super::{
    ProjectSearchDocument, ProjectSearchSource, SearchGroupDto, SearchResultDto,
    SearchResultKindDto, SearchSessionStatus, SearchShortcutDto, SearchSourceDto,
    SearchSourceError, SearchSourceFailureDto, SearchSourceFailureReasonDto, SearchTargetDto,
    SessionSearchDocument, SessionSearchSource, ShortcutActionSearchDocument,
    ShortcutCatalogSource, UnifiedSearchError, UnifiedSearchInputDto, UnifiedSearchResponseDto,
    ranking::{rank_text, validate_context_id, validate_query},
};

const SOURCE_TIMEOUT: Duration = Duration::from_millis(400);
const TOTAL_TIMEOUT: Duration = Duration::from_millis(500);
const GROUP_LIMIT: usize = 8;
const PALETTE_ACTION_ID: &str = "search.open_command_palette";
const CONTEXT_SESSION_ACTION_ID: &str = "sessions.create_current_project";

/// Describes one built-in command that has no keyboard-shortcut owner entry.
struct StaticCommand {
    action_id: &'static str,
    label: &'static str,
    keywords: &'static str,
}

const STATIC_COMMANDS: &[StaticCommand] = &[
    StaticCommand {
        action_id: "navigation.open_home",
        label: "Open Home",
        keywords: "dashboard",
    },
    StaticCommand {
        action_id: "navigation.open_projects",
        label: "Open Projects",
        keywords: "folders workspace",
    },
    StaticCommand {
        action_id: "settings.open_general",
        label: "Open Settings › General",
        keywords: "language tray window",
    },
    StaticCommand {
        action_id: "settings.open_appearance",
        label: "Open Settings › Appearance",
        keywords: "theme colors font",
    },
    StaticCommand {
        action_id: "settings.open_cli_profiles",
        label: "Open Settings › Terminal & CLI Profiles",
        keywords: "terminal shell pty codex claude cli",
    },
    StaticCommand {
        action_id: "settings.open_keyboard_shortcuts",
        label: "Open Settings › Keyboard Shortcuts",
        keywords: "keys hotkey keybinding",
    },
];

/// Owns Phase 1 source orchestration and deterministic ranking.
#[derive(Clone)]
pub struct SearchService {
    projects: Arc<dyn ProjectSearchSource>,
    sessions: Arc<dyn SessionSearchSource>,
    shortcuts: Arc<dyn ShortcutCatalogSource>,
}

/// Retains ranking metadata until one group has been sorted and capped.
struct ScoredResult {
    result: SearchResultDto,
    score: u32,
    source_order: u32,
    catalog_tier: u8,
    identity: String,
}

/// Holds one command-catalog candidate before matching.
struct CommandCandidate {
    action_id: String,
    title: String,
    keywords: Vec<String>,
    shortcut: Option<SearchShortcutDto>,
    project_id: Option<String>,
    catalog_tier: u8,
    source_order: u32,
}

impl SearchService {
    /// Creates a service after checking any currently available shortcut catalog.
    pub fn new(
        projects: Arc<dyn ProjectSearchSource>,
        sessions: Arc<dyn SessionSearchSource>,
        shortcuts: Arc<dyn ShortcutCatalogSource>,
    ) -> Result<Self, UnifiedSearchError> {
        if let Ok(actions) = shortcuts.shortcut_actions() {
            validate_catalog(&actions)?;
        }
        Ok(Self {
            projects,
            sessions,
            shortcuts,
        })
    }

    /// Validates input, queries active sources, and builds one partial response.
    pub async fn search(
        &self,
        input: UnifiedSearchInputDto,
    ) -> Result<UnifiedSearchResponseDto, UnifiedSearchError> {
        let query = validate_query(&input.query)?;
        validate_context_id(input.context_project_id.as_deref())?;

        if query.is_empty() {
            return self
                .empty_query(query, input.context_project_id.as_deref())
                .await;
        }

        let mut failures = Vec::new();
        let joined = timeout(
            TOTAL_TIMEOUT,
            join_two(
                timeout(SOURCE_TIMEOUT, self.projects.list_projects()),
                timeout(SOURCE_TIMEOUT, self.sessions.list_sessions()),
            ),
        )
        .await;
        let (projects, sessions) = match joined {
            Ok((project_outcome, session_outcome)) => (
                source_outcome(project_outcome, SearchSourceDto::Projects, &mut failures),
                source_outcome(session_outcome, SearchSourceDto::Sessions, &mut failures),
            ),
            Err(_) => {
                failures.push(failure(
                    SearchSourceDto::Projects,
                    SearchSourceFailureReasonDto::Timeout,
                ));
                failures.push(failure(
                    SearchSourceDto::Sessions,
                    SearchSourceFailureReasonDto::Timeout,
                ));
                (None, None)
            }
        };
        let shortcut_outcome = self.shortcuts.shortcut_actions();
        let actions = match shortcut_outcome {
            Ok(actions) => {
                validate_catalog(&actions)?;
                Some(actions)
            }
            Err(SearchSourceError::Unavailable) => {
                failures.push(failure(
                    SearchSourceDto::Commands,
                    SearchSourceFailureReasonDto::Unavailable,
                ));
                None
            }
        };

        let mut groups = Vec::new();
        let valid_projects = projects.and_then(|items| {
            if has_duplicate(items.iter().map(|item| item.project_id.as_str())) {
                replace_failure(&mut failures, SearchSourceDto::Projects);
                None
            } else {
                Some(items)
            }
        });
        let project_names: HashMap<&str, &str> = valid_projects
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|project| (project.project_id.as_str(), project.display_name.as_str()))
            .collect();

        if let Some(items) = valid_projects.as_deref()
            && let Some(group) = project_group(&query, items)
        {
            groups.push(group);
        }
        if let Some(items) = sessions {
            if has_duplicate(items.iter().map(|item| item.session_id.as_str())) {
                replace_failure(&mut failures, SearchSourceDto::Sessions);
            } else if let Some(group) = session_group(&query, &items, &project_names) {
                groups.push(group);
            }
        }

        let context_project = input.context_project_id.as_deref().and_then(|id| {
            valid_projects
                .as_deref()
                .unwrap_or_default()
                .iter()
                .find(|project| project.project_id == id && project.is_available)
        });
        if let Some(group) = command_group(&query, actions.as_deref(), context_project, false) {
            groups.push(group);
        }
        failures.sort_by_key(|item| source_order(item.source));
        let result_count = groups.iter().map(|group| group.results.len() as u32).sum();
        Ok(UnifiedSearchResponseDto {
            query,
            groups,
            result_count,
            source_failures: failures,
        })
    }

    /// Produces suggestions without querying sessions or returning domain groups.
    async fn empty_query(
        &self,
        query: String,
        context_project_id: Option<&str>,
    ) -> Result<UnifiedSearchResponseDto, UnifiedSearchError> {
        let mut failures = Vec::new();
        let projects = if context_project_id.is_some() {
            source_outcome(
                timeout(SOURCE_TIMEOUT, self.projects.list_projects()).await,
                SearchSourceDto::Projects,
                &mut failures,
            )
        } else {
            None
        };
        let valid_projects = projects.and_then(|items| {
            if has_duplicate(items.iter().map(|item| item.project_id.as_str())) {
                replace_failure(&mut failures, SearchSourceDto::Projects);
                None
            } else {
                Some(items)
            }
        });
        let context_project = context_project_id.and_then(|id| {
            valid_projects
                .as_deref()
                .unwrap_or_default()
                .iter()
                .find(|project| project.project_id == id && project.is_available)
        });
        let actions = match self.shortcuts.shortcut_actions() {
            Ok(actions) => {
                validate_catalog(&actions)?;
                Some(actions)
            }
            Err(SearchSourceError::Unavailable) => {
                failures.push(failure(
                    SearchSourceDto::Commands,
                    SearchSourceFailureReasonDto::Unavailable,
                ));
                None
            }
        };
        let groups: Vec<_> = command_group(&query, actions.as_deref(), context_project, true)
            .into_iter()
            .collect();
        failures.sort_by_key(|item| source_order(item.source));
        let result_count = groups.iter().map(|group| group.results.len() as u32).sum();
        Ok(UnifiedSearchResponseDto {
            query,
            groups,
            result_count,
            source_failures: failures,
        })
    }
}

/// Polls two independent futures until both have completed.
async fn join_two<A, B>(first: A, second: B) -> (A::Output, B::Output)
where
    A: Future,
    B: Future,
{
    let mut first = pin!(first);
    let mut second = pin!(second);
    let mut first_output = None;
    let mut second_output = None;
    poll_fn(|context| {
        if first_output.is_none()
            && let Poll::Ready(output) = first.as_mut().poll(context)
        {
            first_output = Some(output);
        }
        if second_output.is_none()
            && let Poll::Ready(output) = second.as_mut().poll(context)
        {
            second_output = Some(output);
        }
        match (first_output.take(), second_output.take()) {
            (Some(first), Some(second)) => Poll::Ready((first, second)),
            (first, second) => {
                first_output = first;
                second_output = second;
                Poll::Pending
            }
        }
    })
    .await
}

/// Converts one timeout or owner error into an optional source snapshot.
fn source_outcome<T>(
    outcome: Result<Result<Vec<T>, SearchSourceError>, tokio::time::error::Elapsed>,
    source: SearchSourceDto,
    failures: &mut Vec<SearchSourceFailureDto>,
) -> Option<Vec<T>> {
    match outcome {
        Ok(Ok(items)) => Some(items),
        Ok(Err(SearchSourceError::Unavailable)) => {
            failures.push(failure(source, SearchSourceFailureReasonDto::Unavailable));
            None
        }
        Err(_) => {
            failures.push(failure(source, SearchSourceFailureReasonDto::Timeout));
            None
        }
    }
}

/// Creates one sanitized source failure.
fn failure(
    source: SearchSourceDto,
    reason: SearchSourceFailureReasonDto,
) -> SearchSourceFailureDto {
    SearchSourceFailureDto { source, reason }
}

/// Replaces any prior outcome for a source with an unavailable invariant failure.
fn replace_failure(failures: &mut Vec<SearchSourceFailureDto>, source: SearchSourceDto) {
    failures.retain(|item| item.source != source);
    failures.push(failure(source, SearchSourceFailureReasonDto::Unavailable));
}

/// Returns the fixed Phase 1 source order.
fn source_order(source: SearchSourceDto) -> u8 {
    match source {
        SearchSourceDto::Projects => 0,
        SearchSourceDto::Sessions => 1,
        SearchSourceDto::Commands => 5,
    }
}

/// Detects duplicate opaque identities without changing owner order.
fn has_duplicate<'a>(mut identities: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = HashSet::new();
    identities.any(|identity| !seen.insert(identity))
}

/// Rejects collisions between static and owner-provided action IDs.
fn validate_catalog(actions: &[ShortcutActionSearchDocument]) -> Result<(), UnifiedSearchError> {
    let mut static_ids: HashSet<_> = STATIC_COMMANDS.iter().map(|item| item.action_id).collect();
    static_ids.insert(CONTEXT_SESSION_ACTION_ID);
    let mut seen = HashSet::new();
    for action in actions {
        if static_ids.contains(action.action_id.as_str()) || !seen.insert(action.action_id.as_str())
        {
            return Err(UnifiedSearchError::Unavailable);
        }
    }
    Ok(())
}

/// Ranks and caps project results.
fn project_group(query: &str, projects: &[ProjectSearchDocument]) -> Option<SearchGroupDto> {
    let scored = projects
        .iter()
        .filter_map(|project| {
            let ranked = rank_text(query, &project.display_name, Some(&project.root_path), &[])?;
            Some(ScoredResult {
                result: SearchResultDto {
                    key: format!("project:{}", project.project_id),
                    kind: SearchResultKindDto::Project,
                    title: ranked.title,
                    context: ranked.context,
                    title_highlights: ranked.title_highlights,
                    context_highlights: ranked.context_highlights,
                    target: SearchTargetDto::Project {
                        project_id: project.project_id.clone(),
                    },
                    shortcut: None,
                    supports_open_in_split: false,
                },
                score: ranked.score,
                source_order: project.source_order,
                catalog_tier: 0,
                identity: project.project_id.clone(),
            })
        })
        .collect();
    capped_group(SearchResultKindDto::Project, "Projects", scored)
}

/// Returns the stable English label for one session status.
fn status_label(status: SearchSessionStatus) -> &'static str {
    match status {
        SearchSessionStatus::NoToolYet => "No tool chosen",
        SearchSessionStatus::Running => "Running",
        SearchSessionStatus::UnseenOutput => "New output",
        SearchSessionStatus::NeedsAttention => "Needs attention",
        SearchSessionStatus::Finished => "Finished",
        SearchSessionStatus::ExitedWithError => "Exited with an error",
    }
}

/// Ranks and caps session results with best-effort project enrichment.
fn session_group(
    query: &str,
    sessions: &[SessionSearchDocument],
    project_names: &HashMap<&str, &str>,
) -> Option<SearchGroupDto> {
    let scored = sessions
        .iter()
        .filter_map(|session| {
            let status = status_label(session.status);
            let context = project_names
                .get(session.project_id.as_str())
                .map(|name| format!("{name} · {status}"))
                .unwrap_or_else(|| status.to_owned());
            let ranked = rank_text(query, &session.name, Some(&context), &[])?;
            Some(ScoredResult {
                result: SearchResultDto {
                    key: format!("session:{}", session.session_id),
                    kind: SearchResultKindDto::Session,
                    title: ranked.title,
                    context: ranked.context,
                    title_highlights: ranked.title_highlights,
                    context_highlights: ranked.context_highlights,
                    target: SearchTargetDto::Session {
                        project_id: session.project_id.clone(),
                        session_id: session.session_id.clone(),
                    },
                    shortcut: None,
                    supports_open_in_split: false,
                },
                score: ranked.score,
                source_order: session.source_order,
                catalog_tier: 0,
                identity: session.session_id.clone(),
            })
        })
        .collect();
    capped_group(SearchResultKindDto::Session, "Sessions", scored)
}

/// Builds, ranks, and caps the current command catalog.
fn command_group(
    query: &str,
    actions: Option<&[ShortcutActionSearchDocument]>,
    context_project: Option<&ProjectSearchDocument>,
    suggestions: bool,
) -> Option<SearchGroupDto> {
    let mut commands: Vec<CommandCandidate> = STATIC_COMMANDS
        .iter()
        .enumerate()
        .map(|(order, command)| CommandCandidate {
            action_id: command.action_id.to_owned(),
            title: command.label.to_owned(),
            keywords: vec![
                command.keywords.to_owned(),
                action_keywords(command.action_id),
            ],
            shortcut: None,
            project_id: None,
            catalog_tier: 0,
            source_order: if order >= 2 {
                order as u32 + 1
            } else {
                order as u32
            },
        })
        .collect();
    if let Some(project) = context_project {
        commands.insert(
            2,
            CommandCandidate {
                action_id: CONTEXT_SESSION_ACTION_ID.into(),
                title: format!("New Session in {}", project.display_name),
                keywords: vec![
                    format!(
                        "terminal shell pty cli {} {}",
                        project.display_name, project.root_path
                    ),
                    action_keywords(CONTEXT_SESSION_ACTION_ID),
                ],
                shortcut: None,
                project_id: Some(project.project_id.clone()),
                catalog_tier: 0,
                source_order: 2,
            },
        );
    }
    if let Some(actions) = actions {
        commands.extend(
            actions
                .iter()
                .filter(|action| action.action_id != PALETTE_ACTION_ID)
                .map(|action| CommandCandidate {
                    action_id: action.action_id.clone(),
                    title: action.label.clone(),
                    keywords: vec![action_keywords(&action.action_id)],
                    shortcut: Some(SearchShortcutDto {
                        primary: action.current_chord.primary,
                        alt: action.current_chord.alt,
                        shift: action.current_chord.shift,
                        key_code: action.current_chord.key_code.clone(),
                        is_conflicted: action.shortcut_conflicted,
                    }),
                    project_id: None,
                    catalog_tier: 1,
                    source_order: action.source_order,
                }),
        );
    }
    let scored = commands
        .into_iter()
        .filter_map(|candidate| {
            let ranked = if suggestions {
                super::ranking::RankedText {
                    title: candidate.title,
                    context: None,
                    title_highlights: Vec::new(),
                    context_highlights: Vec::new(),
                    score: 0,
                }
            } else {
                rank_text(query, &candidate.title, None, &candidate.keywords)?
            };
            Some(ScoredResult {
                result: SearchResultDto {
                    key: format!("command:{}", candidate.action_id),
                    kind: SearchResultKindDto::Command,
                    title: ranked.title,
                    context: None,
                    title_highlights: ranked.title_highlights,
                    context_highlights: Vec::new(),
                    target: SearchTargetDto::Command {
                        action_id: candidate.action_id.clone(),
                        project_id: candidate.project_id,
                    },
                    shortcut: candidate.shortcut,
                    supports_open_in_split: false,
                },
                score: ranked.score,
                source_order: candidate.source_order,
                catalog_tier: candidate.catalog_tier,
                identity: candidate.action_id,
            })
        })
        .collect();
    capped_group(SearchResultKindDto::Command, "Commands", scored)
}

/// Converts action punctuation into searchable words.
fn action_keywords(action_id: &str) -> String {
    action_id.replace(['.', '_'], " ")
}

/// Sorts one complete matching list before applying the group limit.
fn capped_group(
    kind: SearchResultKindDto,
    label: &str,
    mut scored: Vec<ScoredResult>,
) -> Option<SearchGroupDto> {
    scored.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.catalog_tier.cmp(&right.catalog_tier))
            .then_with(|| left.source_order.cmp(&right.source_order))
            .then_with(|| left.identity.cmp(&right.identity))
    });
    let has_more = scored.len() > GROUP_LIMIT;
    let results = scored
        .into_iter()
        .take(GROUP_LIMIT)
        .map(|item| item.result)
        .collect::<Vec<_>>();
    (!results.is_empty()).then(|| SearchGroupDto {
        kind,
        label: label.to_owned(),
        results,
        has_more,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use super::*;
    use crate::search::{SearchFuture, SearchShortcutChord};

    /// Supplies deterministic project fixtures and records calls.
    struct ProjectSource {
        items: Vec<ProjectSearchDocument>,
        calls: AtomicUsize,
    }

    impl ProjectSearchSource for ProjectSource {
        /// Returns the configured project fixtures.
        fn list_projects<'a>(
            &'a self,
        ) -> SearchFuture<'a, Result<Vec<ProjectSearchDocument>, SearchSourceError>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(self.items.clone()) })
        }
    }

    /// Supplies deterministic or unavailable session fixtures.
    struct SessionSource {
        result: Mutex<Result<Vec<SessionSearchDocument>, SearchSourceError>>,
        calls: AtomicUsize,
    }

    impl SessionSearchSource for SessionSource {
        /// Returns a clone of the configured outcome.
        fn list_sessions<'a>(
            &'a self,
        ) -> SearchFuture<'a, Result<Vec<SessionSearchDocument>, SearchSourceError>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let result = self.result.lock().unwrap().clone();
            Box::pin(async move { result })
        }
    }

    /// Supplies a mutable shortcut snapshot for recovery tests.
    struct ShortcutSource {
        result: Mutex<Result<Vec<ShortcutActionSearchDocument>, SearchSourceError>>,
    }

    impl ShortcutCatalogSource for ShortcutSource {
        /// Returns the current configured shortcut outcome.
        fn shortcut_actions(&self) -> Result<Vec<ShortcutActionSearchDocument>, SearchSourceError> {
            self.result.lock().unwrap().clone()
        }
    }

    /// Supplies a project future that never resolves.
    struct PendingProjectSource {
        calls: AtomicUsize,
    }

    impl ProjectSearchSource for PendingProjectSource {
        /// Records the call and remains pending for timeout verification.
        fn list_projects<'a>(
            &'a self,
        ) -> SearchFuture<'a, Result<Vec<ProjectSearchDocument>, SearchSourceError>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(std::future::pending())
        }
    }

    /// Supplies a session future that never resolves.
    struct PendingSessionSource {
        calls: AtomicUsize,
    }

    impl SessionSearchSource for PendingSessionSource {
        /// Records the call and remains pending for timeout verification.
        fn list_sessions<'a>(
            &'a self,
        ) -> SearchFuture<'a, Result<Vec<SessionSearchDocument>, SearchSourceError>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(std::future::pending())
        }
    }

    /// Creates one service and exposes its fixture call counters.
    fn fixture_service() -> (
        SearchService,
        Arc<ProjectSource>,
        Arc<SessionSource>,
        Arc<ShortcutSource>,
    ) {
        let projects = Arc::new(ProjectSource {
            items: vec![ProjectSearchDocument {
                project_id: "00000000-0000-4000-8000-000000000001".into(),
                display_name: "XWork".into(),
                root_path: "C:/work/xwork".into(),
                is_available: true,
                source_order: 0,
            }],
            calls: AtomicUsize::new(0),
        });
        let sessions = Arc::new(SessionSource {
            result: Mutex::new(Err(SearchSourceError::Unavailable)),
            calls: AtomicUsize::new(0),
        });
        let shortcuts = Arc::new(ShortcutSource {
            result: Mutex::new(Ok(vec![ShortcutActionSearchDocument {
                action_id: "tabs.create".into(),
                label: "Create tab".into(),
                current_chord: SearchShortcutChord {
                    primary: true,
                    alt: false,
                    shift: false,
                    key_code: "KeyT".into(),
                },
                shortcut_conflicted: true,
                source_order: 0,
            }])),
        });
        let service =
            SearchService::new(projects.clone(), sessions.clone(), shortcuts.clone()).unwrap();
        (service, projects, sessions, shortcuts)
    }

    /// Verifies empty queries skip sessions and include contextual suggestions.
    #[test]
    fn empty_query_returns_commands_without_calling_sessions() {
        let (service, projects, sessions, _) = fixture_service();
        let response = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "   ".into(),
            context_project_id: Some("00000000-0000-4000-8000-000000000001".into()),
        }))
        .unwrap();
        assert_eq!(projects.calls.load(Ordering::SeqCst), 1);
        assert_eq!(sessions.calls.load(Ordering::SeqCst), 0);
        assert_eq!(response.groups[0].kind, SearchResultKindDto::Command);
        assert!(
            response.groups[0]
                .results
                .iter()
                .any(|item| item.key == "command:sessions.create_current_project")
        );
    }

    /// Verifies one failed domain keeps successful groups and conflicted commands.
    #[test]
    fn partial_failure_preserves_successful_results() {
        let (service, _, _, _) = fixture_service();
        let response = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "work".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert_eq!(response.groups[0].kind, SearchResultKindDto::Project);
        assert_eq!(
            response.source_failures,
            vec![failure(
                SearchSourceDto::Sessions,
                SearchSourceFailureReasonDto::Unavailable
            )]
        );

        let command_response =
            tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
                query: "create tab".into(),
                context_project_id: None,
            }))
            .unwrap();
        let command = &command_response
            .groups
            .iter()
            .find(|group| group.kind == SearchResultKindDto::Command)
            .unwrap()
            .results[0];
        assert!(command.shortcut.as_ref().unwrap().is_conflicted);
    }

    /// Verifies complete source lists are ranked before the eight-result cap.
    #[test]
    fn ranking_considers_matches_after_sixty_four_candidates() {
        let (_, _, sessions, shortcuts) = fixture_service();
        let projects = Arc::new(ProjectSource {
            items: (0..70)
                .map(|index| ProjectSearchDocument {
                    project_id: format!("project-{index}"),
                    display_name: if index == 69 {
                        "Needle".into()
                    } else {
                        format!("Other {index}")
                    },
                    root_path: format!("C:/p/{index}"),
                    is_available: true,
                    source_order: index,
                })
                .collect(),
            calls: AtomicUsize::new(0),
        });
        let service = SearchService::new(projects, sessions, shortcuts).unwrap();
        let response = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "needle".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert_eq!(response.groups[0].results[0].title, "Needle");
    }

    /// Verifies static/action collisions are rejected at construction.
    #[test]
    fn catalog_collision_rejects_service() {
        let (_, projects, sessions, shortcuts) = fixture_service();
        *shortcuts.result.lock().unwrap() = Ok(vec![ShortcutActionSearchDocument {
            action_id: "navigation.open_home".into(),
            label: "Collision".into(),
            current_chord: SearchShortcutChord {
                primary: true,
                alt: false,
                shift: false,
                key_code: "KeyH".into(),
            },
            shortcut_conflicted: false,
            source_order: 0,
        }]);
        assert!(matches!(
            SearchService::new(projects, sessions, shortcuts),
            Err(UnifiedSearchError::Unavailable)
        ));
    }

    /// Verifies a collision introduced after startup is rejected on the next query.
    #[test]
    fn catalog_collision_is_rechecked_per_query() {
        let (service, _, _, shortcuts) = fixture_service();
        *shortcuts.result.lock().unwrap() = Ok(vec![ShortcutActionSearchDocument {
            action_id: CONTEXT_SESSION_ACTION_ID.into(),
            label: "Collision".into(),
            current_chord: SearchShortcutChord {
                primary: true,
                alt: false,
                shift: false,
                key_code: "KeyN".into(),
            },
            shortcut_conflicted: false,
            source_order: 0,
        }]);
        let result = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "collision".into(),
            context_project_id: None,
        }));
        assert_eq!(result, Err(UnifiedSearchError::Unavailable));
    }

    /// Verifies a full matching source is capped only after ranking.
    #[test]
    fn project_group_reports_more_than_eight_matches() {
        let (_, _, sessions, shortcuts) = fixture_service();
        let projects = Arc::new(ProjectSource {
            items: (0..9)
                .map(|index| ProjectSearchDocument {
                    project_id: format!("project-{index}"),
                    display_name: format!("Project {index}"),
                    root_path: format!("C:/project/{index}"),
                    is_available: true,
                    source_order: index,
                })
                .collect(),
            calls: AtomicUsize::new(0),
        });
        let service = SearchService::new(projects, sessions, shortcuts).unwrap();
        let response = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "project".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert_eq!(response.groups[0].results.len(), GROUP_LIMIT);
        assert!(response.groups[0].has_more);
    }

    /// Verifies equal-scoring project results preserve owner order.
    #[test]
    fn project_ties_follow_source_order() {
        let (_, _, sessions, shortcuts) = fixture_service();
        let projects = Arc::new(ProjectSource {
            items: vec![
                ProjectSearchDocument {
                    project_id: "second".into(),
                    display_name: "Project Match".into(),
                    root_path: "C:/second".into(),
                    is_available: true,
                    source_order: 1,
                },
                ProjectSearchDocument {
                    project_id: "first".into(),
                    display_name: "Project Match".into(),
                    root_path: "C:/first".into(),
                    is_available: true,
                    source_order: 0,
                },
            ],
            calls: AtomicUsize::new(0),
        });
        let service = SearchService::new(projects, sessions, shortcuts).unwrap();
        let response = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "project match".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert_eq!(response.groups[0].results[0].key, "project:first");
    }

    /// Verifies duplicate owner identities fail only their source.
    #[test]
    fn duplicate_project_identity_becomes_source_failure() {
        let (_, _, sessions, shortcuts) = fixture_service();
        let duplicate = ProjectSearchDocument {
            project_id: "duplicate".into(),
            display_name: "Duplicate Project".into(),
            root_path: "C:/duplicate".into(),
            is_available: true,
            source_order: 0,
        };
        let projects = Arc::new(ProjectSource {
            items: vec![duplicate.clone(), duplicate],
            calls: AtomicUsize::new(0),
        });
        let service = SearchService::new(projects, sessions, shortcuts).unwrap();
        let response = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "duplicate".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert!(
            !response
                .groups
                .iter()
                .any(|group| group.kind == SearchResultKindDto::Project)
        );
        assert!(response.source_failures.contains(&failure(
            SearchSourceDto::Projects,
            SearchSourceFailureReasonDto::Unavailable
        )));
    }

    /// Verifies a degraded shortcut source is re-read and can recover without restart.
    #[test]
    fn shortcut_catalog_recovers_on_a_later_query() {
        let (_, projects, sessions, shortcuts) = fixture_service();
        *shortcuts.result.lock().unwrap() = Err(SearchSourceError::Unavailable);
        let service = SearchService::new(projects, sessions, shortcuts.clone()).unwrap();
        let degraded = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "home".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert!(degraded.source_failures.contains(&failure(
            SearchSourceDto::Commands,
            SearchSourceFailureReasonDto::Unavailable
        )));

        *shortcuts.result.lock().unwrap() = Ok(vec![ShortcutActionSearchDocument {
            action_id: "tabs.create".into(),
            label: "Create tab".into(),
            current_chord: SearchShortcutChord {
                primary: true,
                alt: false,
                shift: false,
                key_code: "KeyT".into(),
            },
            shortcut_conflicted: false,
            source_order: 0,
        }]);
        let recovered = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "create tab".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert!(
            !recovered
                .source_failures
                .iter()
                .any(|failure| failure.source == SearchSourceDto::Commands)
        );
        assert!(recovered.groups.iter().any(|group| {
            group
                .results
                .iter()
                .any(|result| result.key == "command:tabs.create")
        }));
    }

    /// Verifies both sources start and independently time out at the controlled deadline.
    #[test]
    fn source_deadlines_are_concurrent_and_partial() {
        let projects = Arc::new(PendingProjectSource {
            calls: AtomicUsize::new(0),
        });
        let sessions = Arc::new(PendingSessionSource {
            calls: AtomicUsize::new(0),
        });
        let shortcuts = Arc::new(ShortcutSource {
            result: Mutex::new(Err(SearchSourceError::Unavailable)),
        });
        let service = SearchService::new(projects.clone(), sessions.clone(), shortcuts).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .unwrap();
        runtime.block_on(async {
            let started = tokio::time::Instant::now();
            let response = service
                .search(UnifiedSearchInputDto {
                    query: "needle".into(),
                    context_project_id: None,
                })
                .await
                .unwrap();
            assert_eq!(tokio::time::Instant::now() - started, SOURCE_TIMEOUT);
            assert_eq!(
                response.source_failures,
                vec![
                    failure(
                        SearchSourceDto::Projects,
                        SearchSourceFailureReasonDto::Timeout
                    ),
                    failure(
                        SearchSourceDto::Sessions,
                        SearchSourceFailureReasonDto::Timeout
                    ),
                    failure(
                        SearchSourceDto::Commands,
                        SearchSourceFailureReasonDto::Unavailable
                    ),
                ]
            );
        });
        assert_eq!(projects.calls.load(Ordering::SeqCst), 1);
        assert_eq!(sessions.calls.load(Ordering::SeqCst), 1);
    }

    /// Verifies malformed input reaches none of the source ports.
    #[test]
    fn invalid_query_calls_no_source() {
        let (service, projects, sessions, _) = fixture_service();
        let result = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "bad\nquery".into(),
            context_project_id: None,
        }));
        assert_eq!(result, Err(UnifiedSearchError::InvalidQuery));
        assert_eq!(projects.calls.load(Ordering::SeqCst), 0);
        assert_eq!(sessions.calls.load(Ordering::SeqCst), 0);
    }

    /// Verifies sessions remain searchable when project enrichment is unavailable.
    #[test]
    fn session_results_fall_back_to_status_context() {
        let (_, _, _, shortcuts) = fixture_service();
        let sessions = Arc::new(SessionSource {
            result: Mutex::new(Ok(vec![SessionSearchDocument {
                session_id: "session-1".into(),
                project_id: "missing-project".into(),
                name: "Build Session".into(),
                status: SearchSessionStatus::NeedsAttention,
                source_order: 0,
            }])),
            calls: AtomicUsize::new(0),
        });
        let unavailable_projects: Arc<dyn ProjectSearchSource> = Arc::new(UnavailableProjectSource);
        let service = SearchService::new(unavailable_projects, sessions, shortcuts).unwrap();
        let response = tauri::async_runtime::block_on(service.search(UnifiedSearchInputDto {
            query: "attention".into(),
            context_project_id: None,
        }))
        .unwrap();
        assert_eq!(
            response.groups[0].results[0].context.as_deref(),
            Some("Needs attention")
        );
    }

    /// Verifies independent requests do not share mutable result state.
    #[test]
    fn concurrent_requests_keep_their_own_query_and_groups() {
        let (service, _, _, _) = fixture_service();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (projects, commands) = join_two(
                service.search(UnifiedSearchInputDto {
                    query: "work".into(),
                    context_project_id: None,
                }),
                service.search(UnifiedSearchInputDto {
                    query: "create tab".into(),
                    context_project_id: None,
                }),
            )
            .await;
            assert_eq!(projects.unwrap().query, "work");
            assert_eq!(commands.unwrap().query, "create tab");
        });
    }

    /// Supplies an unavailable project source for enrichment fallback tests.
    struct UnavailableProjectSource;

    impl ProjectSearchSource for UnavailableProjectSource {
        /// Returns the sanitized unavailable category.
        fn list_projects<'a>(
            &'a self,
        ) -> SearchFuture<'a, Result<Vec<ProjectSearchDocument>, SearchSourceError>> {
            Box::pin(async { Err(SearchSourceError::Unavailable) })
        }
    }
}
