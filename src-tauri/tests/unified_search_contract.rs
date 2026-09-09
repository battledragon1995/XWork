use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use xwork_lib::{
    platform::{
        command::StubCommandResolver, credential::InMemoryCredentialStore, shell::StubShellResolver,
    },
    projects::{
        ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectService,
        ProjectsError,
    },
    sessions::SessionManager,
    terminal::{
        CliProfileIdFactory, CliProfilesChangedDto, CliProfilesClock, CliProfilesError,
        CliProfilesEventSink,
    },
};

/// Returns one selected disposable folder and rejects native opening.
struct FixtureProjectPlatform {
    selected: Mutex<Option<PathBuf>>,
}

impl ProjectPlatform for FixtureProjectPlatform {
    /// Returns the configured disposable project folder once.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        let selected = self.selected.lock().unwrap().take();
        Box::pin(async move { Ok(selected) })
    }

    /// Rejects file-manager opening because this contract test never requests it.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Discards project invalidations after owner mutations.
struct RecordingProjectEvents {
    count: AtomicUsize,
}

impl ProjectEventSink for RecordingProjectEvents {
    /// Records one owner event without touching a webview.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        self.count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

/// Supplies a fixed timestamp to the unused CLI profile service.
struct FixedClock;

impl CliProfilesClock for FixedClock {
    /// Returns one deterministic millisecond timestamp.
    fn now_ms(&self) -> Result<i64, CliProfilesError> {
        Ok(1_700_000_000_000)
    }
}

/// Supplies deterministic identifiers to the unused CLI profile service.
struct FixedIds;

impl CliProfileIdFactory for FixedIds {
    /// Returns one canonical custom-profile identifier.
    fn new_profile_id(&self) -> String {
        "profile-00000001-0000-4000-8000-000000000000".into()
    }

    /// Returns one opaque credential account.
    fn new_credential_account(&self) -> String {
        "00000001-0000-4000-8000-aaaaaaaaaaaa".into()
    }
}

/// Discards CLI profile invalidations in isolated composition.
struct DiscardingCliEvents;

impl CliProfilesEventSink for DiscardingCliEvents {
    /// Accepts one event without publishing it to a webview.
    fn publish(&self, _event: CliProfilesChangedDto) -> Result<(), CliProfilesError> {
        Ok(())
    }
}

/// Advances the mock runtime once so Tauri executes setup.
fn run_setup(app: &mut tauri::App<tauri::test::MockRuntime>) {
    #[allow(deprecated)]
    app.run_iteration(|_app, _event| {});
}

/// Creates one mock window with the requested caller label.
fn window(
    app: &tauri::App<tauri::test::MockRuntime>,
    label: &str,
) -> WebviewWindow<tauri::test::MockRuntime> {
    WebviewWindowBuilder::new(app, label, Default::default())
        .build()
        .unwrap()
}

/// Builds one JSON IPC request for a registered command.
fn request(command: &str, body: serde_json::Value) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: command.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.into(),
    }
}

/// Invokes one command and decodes its successful JSON response.
fn invoke(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    tauri::test::get_ipc_response(window, request(command, body))
        .unwrap()
        .deserialize()
        .unwrap()
}

/// Builds isolated production composition around disposable owner collaborators.
fn build_app(
    app_data: PathBuf,
    project_root: PathBuf,
    project_events: Arc<RecordingProjectEvents>,
) -> tauri::App<tauri::test::MockRuntime> {
    xwork_lib::app::configure_with_search_for_tests(
        tauri::test::mock_builder(),
        app_data,
        move |_app| {
            (
                Arc::new(FixtureProjectPlatform {
                    selected: Mutex::new(Some(project_root)),
                }),
                project_events,
            )
        },
        |_app| {
            (
                Arc::new(StubCommandResolver::new()),
                Arc::new(StubShellResolver::windows_like()),
                Arc::new(InMemoryCredentialStore::new()),
                Arc::new(DiscardingCliEvents),
                Arc::new(FixedClock),
                Arc::new(FixedIds),
            )
        },
    )
    .build(tauri::test::mock_context(tauri::test::noop_assets()))
    .unwrap()
}

/// Verifies real public project, session, and shortcut queries through the IPC boundary.
#[test]
fn unified_search_uses_real_phase_one_owner_queries() {
    let app_data = tempfile::TempDir::new().unwrap();
    let project_parent = tempfile::TempDir::new().unwrap();
    let project_root = project_parent.path().join("xwork-search-fixture");
    std::fs::create_dir(&project_root).unwrap();
    let project_events = Arc::new(RecordingProjectEvents {
        count: AtomicUsize::new(0),
    });
    let mut app = build_app(
        app_data.path().to_path_buf(),
        project_root.clone(),
        project_events.clone(),
    );
    run_setup(&mut app);
    let main = window(&app, "main");

    let added = invoke(&main, "add_project", serde_json::json!({}));
    let project_id = added["project"]["id"].as_str().unwrap().to_owned();
    invoke(
        &main,
        "rename_project",
        serde_json::json!({"projectId": project_id, "displayName": "Unified Workspace"}),
    );
    invoke(
        &main,
        "set_project_pinned",
        serde_json::json!({"projectId": project_id, "isPinned": true}),
    );
    let created = invoke(
        &main,
        "create_session",
        serde_json::json!({"projectId": project_id}),
    );
    let session_id = created["summary"]["id"].as_str().unwrap().to_owned();
    invoke(
        &main,
        "rename_session",
        serde_json::json!({"sessionId": session_id, "name": "Build Session"}),
    );
    let owner_event_count = project_events.count.load(Ordering::SeqCst);

    let response = invoke(
        &main,
        "search_unified",
        serde_json::json!({
            "input": {"query": "build", "contextProjectId": project_id}
        }),
    );
    assert_eq!(response["query"], "build");
    assert_eq!(response["groups"][0]["kind"], "session");
    assert_eq!(
        response["groups"][0]["results"][0]["target"]["projectId"],
        project_id
    );
    assert_eq!(
        response["groups"][0]["results"][0]["target"]["sessionId"],
        session_id
    );

    let command_response = invoke(
        &main,
        "search_unified",
        serde_json::json!({
            "input": {"query": "pty", "contextProjectId": project_id}
        }),
    );
    let command_results = command_response["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["kind"] == "command")
        .unwrap()["results"]
        .as_array()
        .unwrap();
    assert_eq!(command_results.len(), 2);
    assert!(
        command_results
            .iter()
            .any(|item| item["target"]["actionId"] == "sessions.create_current_project")
    );
    assert!(
        command_results
            .iter()
            .any(|item| item["target"]["actionId"] == "settings.open_cli_profiles")
    );

    invoke(
        &main,
        "set_keyboard_shortcut",
        serde_json::json!({
            "actionId": "tabs.create",
            "chord": {"primary": true, "alt": false, "shift": false, "keyCode": "KeyW"}
        }),
    );
    let shortcut_response = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "new tab", "contextProjectId": null}}),
    );
    let shortcut = &shortcut_response["groups"][0]["results"][0]["shortcut"];
    assert_eq!(shortcut["keyCode"], "KeyW");
    assert_eq!(shortcut["isConflicted"], true);

    let projects_before =
        tauri::async_runtime::block_on(app.state::<ProjectService>().list_projects(None)).unwrap();
    let sessions_before =
        tauri::async_runtime::block_on(app.state::<SessionManager>().list_sessions(None)).unwrap();
    invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "unified build", "contextProjectId": null}}),
    );
    assert_eq!(
        tauri::async_runtime::block_on(app.state::<ProjectService>().list_projects(None)).unwrap(),
        projects_before
    );
    assert_eq!(
        tauri::async_runtime::block_on(app.state::<SessionManager>().list_sessions(None)).unwrap(),
        sessions_before
    );
    assert_eq!(
        project_events.count.load(Ordering::SeqCst),
        owner_event_count
    );

    std::fs::remove_dir(&project_root).unwrap();
    let unavailable = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "unified", "contextProjectId": project_id}}),
    );
    assert_eq!(unavailable["groups"][0]["kind"], "project");
    let unavailable_commands = unavailable["groups"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["kind"] == "command")
        .map(|group| group["results"].as_array().unwrap());
    assert!(unavailable_commands.is_none_or(|results| {
        results
            .iter()
            .all(|item| item["target"]["actionId"] != "sessions.create_current_project")
    }));

    invoke(
        &main,
        "close_runtime_target",
        serde_json::json!({
            "target": {"kind": "session", "sessionId": session_id},
            "confirmed": true
        }),
    );
    let after_session_delete = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "build", "contextProjectId": null}}),
    );
    assert!(
        after_session_delete["groups"]
            .as_array()
            .unwrap()
            .iter()
            .all(|group| group["kind"] != "session")
    );

    invoke(
        &main,
        "remove_project",
        serde_json::json!({"projectId": project_id, "confirmed": true}),
    );
    let after_project_delete = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input": {"query": "", "contextProjectId": project_id}}),
    );
    assert!(
        after_project_delete["groups"][0]["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["target"]["actionId"] != "sessions.create_current_project")
    );
}

/// Verifies caller and input validation return typed errors at the command boundary.
#[test]
fn unified_search_authorizes_and_validates_before_querying() {
    let app_data = tempfile::TempDir::new().unwrap();
    let project_parent = tempfile::TempDir::new().unwrap();
    let project_root = project_parent.path().join("xwork-search-fixture");
    std::fs::create_dir(&project_root).unwrap();
    let mut app = build_app(
        app_data.path().to_path_buf(),
        project_root,
        Arc::new(RecordingProjectEvents {
            count: AtomicUsize::new(0),
        }),
    );
    run_setup(&mut app);
    let quick_note = window(&app, "quick-note");
    let unauthorized = tauri::test::get_ipc_response(
        &quick_note,
        request(
            "search_unified",
            serde_json::json!({
                "input": {"query": "x", "contextProjectId": null}
            }),
        ),
    )
    .unwrap_err();
    assert_eq!(
        unauthorized,
        serde_json::json!({"code": "unauthorized_window"})
    );

    let main = window(&app, "main");
    let invalid = tauri::test::get_ipc_response(
        &main,
        request(
            "search_unified",
            serde_json::json!({
                "input": {"query": "ok\nno", "contextProjectId": null}
            }),
        ),
    )
    .unwrap_err();
    assert_eq!(invalid, serde_json::json!({"code": "invalid_query"}));
}
/// Exercises real Notes commands, source joining, lifecycle exclusion and caller boundaries.
#[test]
fn notes_commands_and_search_use_the_managed_public_owner() {
    use xwork_lib::notes::NotesService;
    let app_data = tempfile::tempdir().unwrap();
    let source = tempfile::tempdir().unwrap();
    let project_root = source.path().join("Notes project");
    std::fs::create_dir(&project_root).unwrap();
    let canary = project_root.join("canary.md");
    std::fs::write(&canary, "untouched source").unwrap();
    let project_events = Arc::new(RecordingProjectEvents {
        count: AtomicUsize::new(0),
    });
    let mut app = build_app(app_data.path().into(), project_root, project_events.clone());
    run_setup(&mut app);
    let main = window(&app, "main");
    let quick = window(&app, "quick-note");
    let project = invoke(&main, "add_project", serde_json::json!({}));
    let project_id = project["project"]["id"].as_str().unwrap();
    let note = invoke(
        &quick,
        "create_note",
        serde_json::json!({"input":{"title":null,"contentMarkdown":"needle body","projectId":project_id}}),
    );
    let id = note["id"].as_str().unwrap();
    let unauthorized = tauri::test::get_ipc_response(
        &quick,
        request("get_note", serde_json::json!({"noteId":id})),
    )
    .unwrap_err();
    assert_eq!(
        unauthorized,
        serde_json::json!({"code":"unauthorized_window"})
    );
    let response = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input":{"query":"needle","contextProjectId":null}}),
    );
    let result = &response["groups"][0]["results"][0];
    assert_eq!(
        result["target"],
        serde_json::json!({"kind":"note","noteId":id})
    );
    assert_eq!(result["title"], "Untitled note");
    assert!(
        result["context"]
            .as_str()
            .unwrap()
            .contains("Notes project")
    );
    let archived = invoke(
        &main,
        "archive_note",
        serde_json::json!({"input":{"noteId":id,"expectedRevision":"1"}}),
    );
    let response = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input":{"query":"needle","contextProjectId":null}}),
    );
    assert_eq!(response["groups"][0]["kind"], "note");
    let trashed = invoke(
        &main,
        "move_note_to_trash",
        serde_json::json!({"input":{"noteId":id,"expectedRevision":archived["revision"]}}),
    );
    let response = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input":{"query":"needle","contextProjectId":null}}),
    );
    assert_eq!(response["resultCount"], 0);
    let restored = invoke(
        &main,
        "restore_note_from_trash",
        serde_json::json!({"input":{"noteId":id,"expectedRevision":trashed["revision"]}}),
    );
    let events = project_events.count.load(Ordering::SeqCst);
    invoke(
        &main,
        "remove_project",
        serde_json::json!({"projectId":project_id,"confirmed":true}),
    );
    assert_eq!(project_events.count.load(Ordering::SeqCst), events + 1);
    let after = invoke(&main, "get_note", serde_json::json!({"noteId":id}));
    assert_eq!(after["projectId"], serde_json::Value::Null);
    assert_eq!(after["revision"], restored["revision"]);
    assert_eq!(
        std::fs::read_to_string(&canary).unwrap(),
        "untouched source"
    );
    tauri::async_runtime::block_on(async {
        let service = app.state::<NotesService>();
        for index in 0..65 {
            service
                .create_note(xwork_lib::notes::CreateNoteInputDto {
                    title: Some(format!("cap note {index}")),
                    content_markdown: "cap".into(),
                    project_id: None,
                })
                .await
                .unwrap();
        }
        let prefix = service.search_for_unified("cap", 64).await.unwrap();
        assert_eq!(prefix.items.len(), 64);
        assert!(prefix.has_more);
    });
    let response = invoke(
        &main,
        "search_unified",
        serde_json::json!({"input":{"query":"cap","contextProjectId":null}}),
    );
    assert_eq!(
        response["groups"][0]["results"].as_array().unwrap().len(),
        8
    );
    assert_eq!(response["groups"][0]["hasMore"], true);
}

mod calendar_search_contract {
    use std::sync::Arc;
    use xwork_lib::search::*;

    struct OtherSources;
    impl ProjectSearchSource for OtherSources {
        /// Supplies an unrelated successful source during Event failures.
        fn list_projects<'a>(
            &'a self,
        ) -> SearchFuture<'a, Result<Vec<ProjectSearchDocument>, SearchSourceError>> {
            Box::pin(async { Ok(vec![]) })
        }
    }
    impl SessionSearchSource for OtherSources {
        /// Keeps runtime sessions isolated from this source contract.
        fn list_sessions<'a>(
            &'a self,
        ) -> SearchFuture<'a, Result<Vec<SessionSearchDocument>, SearchSourceError>> {
            Box::pin(async { Ok(vec![]) })
        }
    }
    impl ShortcutCatalogSource for OtherSources {
        /// Leaves built-in commands available to verify partial-source success.
        fn shortcut_actions(&self) -> Result<Vec<ShortcutActionSearchDocument>, SearchSourceError> {
            Ok(vec![])
        }
    }

    enum EventFixture {
        Ready(Vec<EventSearchDocument>, bool),
        Unavailable,
        Pending,
    }
    impl EventSearchSource for EventFixture {
        /// Returns an owned bounded fixture or a controlled failure without OS state.
        fn search_events<'a>(
            &'a self,
            _query: &'a str,
            candidate_limit: u32,
        ) -> SearchFuture<'a, Result<SearchCandidates<EventSearchDocument>, SearchSourceError>>
        {
            assert_eq!(candidate_limit, 64);
            Box::pin(async move {
                match self {
                    Self::Ready(items, has_more) => Ok(SearchCandidates {
                        items: items.clone(),
                        has_more: *has_more,
                    }),
                    Self::Unavailable => Err(SearchSourceError::Unavailable),
                    Self::Pending => std::future::pending().await,
                }
            })
        }
    }

    /// Creates an Event-enabled service using only deterministic public source ports.
    fn service(events: EventFixture) -> SearchService {
        let other = Arc::new(OtherSources);
        SearchService::new(other.clone(), other.clone(), other)
            .unwrap()
            .with_events(Arc::new(events))
    }

    /// Runs search with an automatically advancing isolated monotonic test clock.
    fn search(service: SearchService, query: &str) -> UnifiedSearchResponseDto {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .unwrap()
            .block_on(service.search(UnifiedSearchInputDto {
                query: query.into(),
                context_project_id: None,
            }))
            .unwrap()
    }

    /// Constructs one base definition candidate without materialized occurrences.
    fn document(id: u32, title: &str, starts_at_ms: i64) -> EventSearchDocument {
        EventSearchDocument {
            event_id: format!("00000000-0000-4000-8000-{id:012}"),
            title: title.into(),
            matching_description: None,
            starts_at_ms,
            time_zone_id: "UTC".into(),
            project_name: None,
        }
    }

    /// Preserves Unicode-scalar highlights and stable start/identity ranking at the group cap.
    #[test]
    fn event_group_has_unicode_highlights_stable_order_and_eight_item_cap() {
        let mut items = Vec::new();
        for id in (1..=10).rev() {
            items.push(document(
                id,
                "📅 Họp",
                if id <= 2 { 0 } else { i64::from(id) },
            ));
        }
        let response = search(service(EventFixture::Ready(items, false)), "họp");
        let group = response
            .groups
            .iter()
            .find(
                // Selects the Calendar group independently of built-in command order.
                |group| group.kind == SearchResultKindDto::Event,
            )
            .unwrap();
        assert_eq!(group.results.len(), 8);
        assert!(group.has_more);
        assert_eq!(
            group.results[0].target,
            SearchTargetDto::Event {
                event_id: "00000000-0000-4000-8000-000000000001".into()
            }
        );
        assert_eq!(
            group.results[1].target,
            SearchTargetDto::Event {
                event_id: "00000000-0000-4000-8000-000000000002".into()
            }
        );
        assert_eq!(
            group.results[0].title_highlights,
            vec![SearchTextRangeDto {
                start_scalar: 2,
                end_scalar: 5
            }]
        );
        assert!(group.results.iter().all(
            // Calendar details have no file-style split-opening action.
            |result| !result.supports_open_in_split
        ));
    }

    /// Propagates bounded owner continuation even when fewer than eight matches arrive.
    #[test]
    fn event_source_continuation_is_not_silently_lost() {
        let response = search(
            service(EventFixture::Ready(vec![document(1, "Planning", 0)], true)),
            "planning",
        );
        let group = response
            .groups
            .iter()
            .find(
                // Retrieves the group whose continuation belongs to the owner.
                |group| group.kind == SearchResultKindDto::Event,
            )
            .unwrap();
        assert_eq!(group.results.len(), 1);
        assert!(group.has_more);
    }

    /// Event timeout/unavailability remain redacted while successful command results survive.
    #[test]
    fn event_failure_and_timeout_preserve_other_search_groups() {
        for (fixture, reason) in [
            (
                EventFixture::Unavailable,
                SearchSourceFailureReasonDto::Unavailable,
            ),
            (EventFixture::Pending, SearchSourceFailureReasonDto::Timeout),
        ] {
            let response = search(service(fixture), "settings");
            assert!(response.groups.iter().any(
                // Built-in Settings commands remain visible on partial source failure.
                |group| group.kind == SearchResultKindDto::Command && !group.results.is_empty()
            ));
            assert!(response.source_failures.contains(&SearchSourceFailureDto {
                source: SearchSourceDto::Events,
                reason
            }));
        }
    }
}
