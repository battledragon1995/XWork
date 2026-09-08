use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::files::{
    FILE_HANDLE_CHANGED_EVENT, FileHandleEventSink, FilesClock, FilesError, FilesOpenCallback,
    FilesRevealCallback, FilesService, RECENT_FILES_CHANGED_EVENT, RecentFilesEventSink,
    system_files_clock,
};
use crate::notifications::{
    NOTIFICATIONS_CHANGED_EVENT, NotificationCollaborators, NotificationService,
};
use crate::platform::data::TauriDataPlatform;
use crate::platform::notification::{NativeNotification, UnavailableNotification};
use notification_dependencies::{AppNotificationDependencies, NotificationVisibility};
use tauri::{App, AppHandle, Builder, Emitter, Manager, Runtime, WebviewWindow, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use crate::{
    platform::{
        command::{CommandResolver, NativeCommandResolver},
        credential::{CredentialStore, KeyringCredentialStore},
        environment::ProcessEnvironmentSnapshot,
        shell::{NativeShellResolver, ShellResolver},
        window::{bring_to_front, hide_window},
    },
    projects::{
        ProjectChangedEventDto, ProjectEventSink, ProjectFuture, ProjectPlatform, ProjectService,
        ProjectsError, TauriProjectEventSink, TauriProjectPlatform,
    },
    search::SearchService,
    sessions::{SessionManager, commands as session_commands},
    settings::{
        DataManagementService, KeyboardShortcutsService, SettingsService, SystemDataClock,
        TauriDataEventSink, data_participant::DataParticipants,
    },
    shared::DataMaintenanceGate,
    storage::Storage,
    terminal::{
        CliProfileIdFactory, CliProfilesClock, CliProfilesEventSink, CliProfilesService,
        NativePtyFactory, NativeTerminalInteractionAdapter, SystemCliProfilesClock,
        TauriCliProfilesEventSink, TerminalInteractions, TerminalManager,
        UnavailableTerminalInteractionAdapter, UuidCliProfileIdFactory,
    },
};

pub mod data_participants;
pub mod data_runtime;
pub mod lifecycle;
mod notification_dependencies;
mod search_sources;
pub mod tray;

use data_participants::{
    CliProfilesDataParticipant, KeyboardShortcutsDataParticipant, ProjectsDataParticipant,
    SettingsDataParticipant,
};
use data_runtime::{
    AppDataRuntime, AppFileDependencies, AppTerminalDependencies, DeferredProjectRuntimeGuard,
    PaneContentRuntimeRouter, SessionsAppRuntime, SessionsCliProfileLookup, SessionsProjectAccess,
    TauriSessionEventSink, TauriTerminalEventSink,
};
use lifecycle::{AppLifecycleError, AppLifecycleState, AppRuntime};
use search_sources::{
    AppFileSearchSource, AppProjectSearchSource, AppSessionSearchSource, AppShortcutCatalogSource,
};

/// Describes whether a native close event should be intercepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[doc(hidden)]
pub enum CloseDecision {
    HideToTray,
    AllowClose,
}

/// Supplies the platform and event adapters injected into `ProjectService`.
#[doc(hidden)]
pub type ProjectCollaborators = (Arc<dyn ProjectPlatform>, Arc<dyn ProjectEventSink>);

/// Supplies every operating-system and determinism seam of `CliProfilesService`.
#[doc(hidden)]
pub type CliProfileCollaborators = (
    Arc<dyn CommandResolver>,
    Arc<dyn ShellResolver>,
    Arc<dyn CredentialStore>,
    Arc<dyn CliProfilesEventSink>,
    Arc<dyn CliProfilesClock>,
    Arc<dyn CliProfileIdFactory>,
);

/// Applies the desktop application's composition to a Tauri builder.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        // Ignores argv and cwd while restoring the existing main window in place.
        |app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                if bring_to_front(&window).is_err() {
                    eprintln!("single-instance main-window activation failed");
                } else {
                    notify_sessions_visibility(app, true);
                }
            }
        },
    ));

    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init());
    configure_app(
        builder,
        None,
        None,
        tray::attach_native_tray,
        native_project_collaborators,
        native_cli_profile_collaborators,
        true,
        None,
        None,
        true,
    )
}

/// Applies composition with an isolated app data path for integration tests.
#[doc(hidden)]
pub fn configure_with_app_data_dir<R: Runtime>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
) -> Builder<R> {
    configure_app(
        builder,
        Some(app_data_dir),
        None,
        // Skips native tray attachment because these tests observe setup only.
        |_app| Ok(()),
        native_project_collaborators,
        native_cli_profile_collaborators,
        true,
        Some(true),
        None,
        false,
    )
}

/// Applies lifecycle composition with isolated runtime, storage, and tray seams.
#[doc(hidden)]
pub fn configure_with_lifecycle_for_tests<R, F>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
    runtime: Arc<dyn AppRuntime>,
    attach_tray: F,
) -> Builder<R>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) -> Result<(), AppLifecycleError> + Send + 'static,
{
    configure_app(
        builder,
        Some(app_data_dir),
        Some(runtime),
        attach_tray,
        native_project_collaborators,
        native_cli_profile_collaborators,
        true,
        Some(true),
        None,
        false,
    )
}

/// Applies composition with isolated storage and fake Projects collaborators.
#[doc(hidden)]
pub fn configure_with_projects_for_tests<R, C>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
    project_collaborators: C,
) -> Builder<R>
where
    R: Runtime,
    C: FnOnce(&AppHandle<R>) -> ProjectCollaborators + Send + 'static,
{
    configure_app(
        builder,
        Some(app_data_dir),
        None,
        // Skips native tray attachment because these tests observe Projects only.
        |_app| Ok(()),
        project_collaborators,
        native_cli_profile_collaborators,
        true,
        Some(true),
        None,
        false,
    )
}

/// Applies composition with isolated storage and fake CLI profile collaborators.
#[doc(hidden)]
pub fn configure_with_cli_profiles_for_tests<R, C>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
    cli_profile_collaborators: C,
) -> Builder<R>
where
    R: Runtime,
    C: FnOnce(&AppHandle<R>) -> CliProfileCollaborators + Send + 'static,
{
    configure_app(
        builder,
        Some(app_data_dir),
        None,
        // Skips native tray attachment because these tests observe CLI profiles only.
        |_app| Ok(()),
        // Replaces both Projects adapters so no dialog or file manager can open.
        |_app_handle| {
            (
                Arc::new(UnusedTestPlatform),
                Arc::new(DiscardingTestEventSink),
            )
        },
        cli_profile_collaborators,
        // Command tests drive hydration, cleanup, and checks explicitly instead.
        false,
        Some(true),
        None,
        false,
    )
}

/// Applies isolated composition with both owner collaborator sets for Search tests.
#[doc(hidden)]
pub fn configure_with_search_for_tests<R, C, P>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
    project_collaborators: C,
    cli_profile_collaborators: P,
) -> Builder<R>
where
    R: Runtime,
    C: FnOnce(&AppHandle<R>) -> ProjectCollaborators + Send + 'static,
    P: FnOnce(&AppHandle<R>) -> CliProfileCollaborators + Send + 'static,
{
    configure_app(
        builder,
        Some(app_data_dir),
        None,
        // Search integration tests do not attach native tray state.
        |_app| Ok(()),
        project_collaborators,
        cli_profile_collaborators,
        false,
        Some(true),
        None,
        false,
    )
}

/// Applies isolated composition with fake Projects and Files native collaborators.
#[doc(hidden)]
pub fn configure_with_files_for_tests<R, C>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
    project_collaborators: C,
    reveal: FilesRevealCallback,
) -> Builder<R>
where
    R: Runtime,
    C: FnOnce(&AppHandle<R>) -> ProjectCollaborators + Send + 'static,
{
    configure_app(
        builder,
        Some(app_data_dir),
        None,
        |_app| Ok(()),
        project_collaborators,
        native_cli_profile_collaborators,
        false,
        Some(true),
        Some(reveal),
        false,
    )
}

/// Rejects every native call so CLI profile tests never open a dialog.
struct UnusedTestPlatform;

impl ProjectPlatform for UnusedTestPlatform {
    /// Fails because CLI profile tests must not reach the native picker.
    fn select_folder<'a>(&'a self) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
        Box::pin(async { Err(ProjectsError::FolderPickerFailed) })
    }

    /// Fails because CLI profile tests must not reach the native opener.
    fn open_folder<'a>(&'a self, _path: &'a Path) -> ProjectFuture<'a, Result<(), ProjectsError>> {
        Box::pin(async { Err(ProjectsError::OpenFolderFailed) })
    }
}

/// Discards every published Projects change during CLI profile tests.
struct DiscardingTestEventSink;

impl ProjectEventSink for DiscardingTestEventSink {
    /// Accepts the payload without emitting it to any webview.
    fn publish(&self, _event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
        Ok(())
    }
}

/// Applies close-to-tray semantics to the exact main webview window.
#[doc(hidden)]
pub fn apply_close_requested<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<CloseDecision, AppLifecycleError> {
    if window.label() != "main" {
        return Ok(CloseDecision::AllowClose);
    }
    hide_window(window).map_err(AppLifecycleError::from)?;
    notify_sessions_visibility(window.app_handle(), false);
    Ok(CloseDecision::HideToTray)
}

/// Reports a successful native show or hide to the Sessions visibility owner.
pub(crate) fn notify_sessions_visibility<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    if let Some(ordering) = app.try_state::<NotificationVisibility>() {
        ordering.set(visible);
        return;
    }
    let Some(manager) = app.try_state::<SessionManager>() else {
        return;
    };
    let manager = manager.inner().clone();
    // Visibility reporting is asynchronous so native window callbacks stay non-blocking.
    tauri::async_runtime::spawn(async move {
        manager.set_main_window_visible(visible).await;
    });
}

/// Reports whether the two official Rust-owned plugins are initialized.
///
/// The check reads the state each plugin publishes during initialization, so it
/// observes registration without invoking any native dialog or file manager.
#[doc(hidden)]
pub fn official_plugins_initialized<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<tauri_plugin_dialog::Dialog<R>>().is_some()
        && app.try_state::<tauri_plugin_opener::Opener<R>>().is_some()
}

/// Notifies managed Settings state that application shutdown has begun.
#[doc(hidden)]
pub fn notify_settings_shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(service) = app.try_state::<SettingsService>() {
        service.begin_shutdown();
    }
}

/// Builds the native discovery, credential, and event adapters used at startup.
fn native_cli_profile_collaborators<R: Runtime>(app: &AppHandle<R>) -> CliProfileCollaborators {
    // One captured environment snapshot keeps command and shell discovery consistent.
    let environment = ProcessEnvironmentSnapshot::from_process();
    (
        Arc::new(NativeCommandResolver::new(environment.clone())),
        Arc::new(NativeShellResolver::new(NativeCommandResolver::new(
            environment,
        ))),
        Arc::new(KeyringCredentialStore::new()),
        Arc::new(TauriCliProfilesEventSink::new(app.clone())),
        Arc::new(SystemCliProfilesClock),
        Arc::new(UuidCliProfileIdFactory),
    )
}

/// Builds the native dialog and opener adapters used by production startup.
fn native_project_collaborators<R: Runtime>(app: &AppHandle<R>) -> ProjectCollaborators {
    (
        Arc::new(TauriProjectPlatform::new(app.clone())),
        Arc::new(TauriProjectEventSink::new(app.clone())),
    )
}

/// Creates the single command router shared by production and tests.
fn app_invoke_handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync {
    tauri::generate_handler![
        lifecycle::hide_main_window,
        lifecycle::minimize_main_window,
        lifecycle::toggle_main_window_maximized,
        lifecycle::request_quit,
        lifecycle::cancel_quit,
        lifecycle::confirm_quit,
        crate::projects::commands::list_projects,
        crate::projects::commands::get_project,
        crate::projects::commands::get_project_git_summary,
        crate::projects::commands::get_project_git_status,
        crate::projects::commands::add_project,
        crate::projects::commands::rename_project,
        crate::projects::commands::set_project_pinned,
        crate::projects::commands::open_project,
        crate::projects::commands::locate_project_folder,
        crate::projects::commands::open_project_folder,
        crate::projects::commands::get_remove_project_impact,
        crate::projects::commands::remove_project,
        crate::files::commands::list_file_children,
        crate::files::commands::search_file_tree,
        crate::files::commands::get_file_entry_paths,
        crate::files::commands::reveal_file_entry,
        crate::files::commands::open_file_in_pane,
        crate::files::commands::get_open_file,
        crate::files::commands::reload_open_file,
        crate::files::commands::resolve_external_file_change,
        crate::files::commands::open_file_with_default_app,
        crate::files::commands::list_recent_files,
        crate::files::commands::update_markdown_buffer,
        crate::files::commands::save_markdown_file,
        crate::settings::get_settings,
        crate::settings::get_keyboard_shortcuts,
        crate::settings::set_keyboard_shortcut,
        crate::settings::reset_keyboard_shortcut,
        crate::settings::reset_all_keyboard_shortcuts,
        crate::settings::update_settings,
        crate::settings::restore_appearance_defaults,
        crate::terminal::cli_profiles::get_cli_profiles,
        crate::terminal::cli_profiles::create_cli_profile,
        crate::terminal::cli_profiles::update_cli_profile,
        crate::terminal::cli_profiles::delete_cli_profile,
        crate::terminal::cli_profiles::set_default_cli_shell,
        crate::terminal::cli_profiles::check_cli_profile,
        session_commands::list_sessions,
        session_commands::get_session,
        session_commands::create_session,
        session_commands::rename_session,
        session_commands::create_tab,
        session_commands::rename_tab,
        session_commands::move_tab,
        session_commands::set_active_tab,
        session_commands::set_active_pane,
        session_commands::split_pane,
        session_commands::set_split_ratio,
        session_commands::set_maximized_pane,
        session_commands::select_session_tool,
        session_commands::select_pane_tool,
        session_commands::get_close_impact,
        session_commands::close_runtime_target,
        session_commands::reopen_last_closed_tab,
        session_commands::set_observed_session,
        crate::terminal::commands::start_terminal,
        crate::terminal::commands::get_terminal,
        crate::terminal::commands::subscribe_terminal_output,
        crate::terminal::commands::write_terminal,
        crate::terminal::commands::resize_terminal,
        crate::terminal::commands::acknowledge_terminal_attention,
        crate::terminal::commands::read_terminal_clipboard,
        crate::terminal::commands::write_terminal_clipboard,
        crate::terminal::commands::open_terminal_link,
        crate::notifications::commands::get_notifications,
        crate::notifications::commands::mark_notification_read,
        crate::notifications::commands::mark_all_notifications_read,
        crate::notifications::commands::delete_notification,
        crate::notifications::commands::clear_read_notifications,
        crate::notifications::commands::open_notification,
        crate::search::search_unified,
        crate::settings::data::get_data_location,
        crate::settings::data::open_data_location,
        crate::settings::data::copy_data_location,
        crate::settings::data::export_backup,
        crate::settings::data::prepare_import_backup,
        crate::settings::data::confirm_import_backup,
        crate::settings::data::prepare_reset_xwork,
        crate::settings::data::confirm_reset_xwork,
        crate::settings::data::cancel_data_operation
    ]
}

/// Wires storage, Projects, lifecycle state, tray attachment, and close handling.
#[allow(clippy::too_many_arguments)]
fn configure_app<R, F, C, P>(
    builder: Builder<R>,
    app_data_dir: Option<PathBuf>,
    runtime_override: Option<Arc<dyn AppRuntime>>,
    attach_tray: F,
    project_collaborators: C,
    cli_profile_collaborators: P,
    start_background_work: bool,
    initial_visibility: Option<bool>,
    files_reveal_override: Option<FilesRevealCallback>,
    native_terminal_interactions: bool,
) -> Builder<R>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) -> Result<(), AppLifecycleError> + Send + 'static,
    C: FnOnce(&AppHandle<R>) -> ProjectCollaborators + Send + 'static,
    P: FnOnce(&AppHandle<R>) -> CliProfileCollaborators + Send + 'static,
{
    builder
        // Dialog and opener are Rust-owned; OS exposes only the explicitly granted facts.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .setup(
            // Publishes state only after storage migrates, then attaches the required tray.
            move |app| {
                let app_data_dir = match app_data_dir {
                    Some(path) => path,
                    None => app.path().app_data_dir()?,
                };
                let data_location = app_data_dir.clone();
                let storage = setup_storage(app, app_data_dir)?;
                let project_guard = setup_projects(app, storage.clone(), project_collaborators);
                setup_settings(app, storage.clone())?;
                setup_keyboard_shortcuts(app, storage.clone())?;
                setup_cli_profiles(
                    app,
                    storage.clone(),
                    cli_profile_collaborators,
                    start_background_work,
                );
                let (sessions, content_router) =
                    setup_sessions(app, project_guard, initial_visibility)?;
                setup_files(
                    app,
                    storage.clone(),
                    sessions.clone(),
                    content_router.clone(),
                    files_reveal_override,
                    native_terminal_interactions,
                )?;
                setup_search(app, sessions.clone())?;
                let terminal =
                    setup_terminal(app, &sessions, content_router, native_terminal_interactions)?;
                let visibility = NotificationVisibility::new(Arc::downgrade(&sessions));
                app.manage(visibility.clone());
                let notification_app = app.handle().clone();
                let os: Arc<dyn crate::platform::notification::OsNotification> =
                    if native_terminal_interactions {
                        Arc::new(NativeNotification(app.handle().clone()))
                    } else {
                        Arc::new(UnavailableNotification)
                    };
                // Setup waits for blocking startup cleanup before managed commands become ready.
                let notifications = tauri::async_runtime::block_on(NotificationService::new(
                    app.state::<Storage>().inner().clone(),
                    app.state::<DataMaintenanceGate>().inner().clone(),
                    Arc::new(AppNotificationDependencies {
                        sessions: sessions.clone(),
                        visibility,
                    }),
                    NotificationCollaborators::system(
                        // Delivers badge invalidations only to the authorized main window.
                        Arc::new(move |event| {
                            notification_app
                                .emit_to("main", NOTIFICATIONS_CHANGED_EVENT, event)
                                .map_err(|_| crate::notifications::NotificationError::Unavailable)
                        }),
                        os,
                    ),
                ))?;
                app.manage(notifications.clone());
                setup_data_management(
                    app,
                    storage.clone(),
                    data_location,
                    sessions.clone(),
                    notifications.clone(),
                );
                let runtime = runtime_override.unwrap_or_else(
                    // Normal composition uses Sessions; focused lifecycle tests may inject a fake.
                    || {
                        Arc::new(SessionsAppRuntime::new(
                            sessions.clone(),
                            app.state::<ProjectService>().inner().clone(),
                            terminal.clone(),
                            notifications.clone(),
                            app.state::<FilesService>().inner().clone(),
                        ))
                    },
                );
                app.manage(AppLifecycleState::new(runtime));
                attach_tray(app.handle())?;
                Ok(())
            },
        )
        .invoke_handler(app_invoke_handler())
        .on_window_event(
            // Intercepts native close only for main while shutdown is not in progress.
            |window, event| {
                if window.label() != "main" {
                    return;
                }
                if matches!(event, WindowEvent::Focused(true)) {
                    if let Some(files) = window.app_handle().try_state::<FilesService>() {
                        let files = files.inner().clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = files.reconcile_open_files().await;
                        });
                    }
                    return;
                }
                let WindowEvent::CloseRequested { api, .. } = event else {
                    return;
                };
                let state = window.state::<AppLifecycleState>();
                match state.is_shutting_down() {
                    Ok(true) => {}
                    Ok(false) => {
                        if let Some(webview_window) =
                            window.app_handle().get_webview_window(window.label())
                            && apply_close_requested(&webview_window).is_err()
                        {
                            eprintln!("close-to-tray window operation failed");
                        }
                        // A hide failure still prevents accidental process termination.
                        api.prevent_close();
                    }
                    Err(_) => {
                        eprintln!("close-to-tray lifecycle state was unavailable");
                        api.prevent_close();
                    }
                }
            },
        )
}

/// Constructs and manages Files from the public Projects owner query.
fn setup_files<R: Runtime>(
    app: &mut App<R>,
    storage: Storage,
    sessions: Arc<SessionManager>,
    content_router: Arc<PaneContentRuntimeRouter>,
    reveal_override: Option<FilesRevealCallback>,
    native_reveal: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let reveal = reveal_override.unwrap_or_else(|| {
        if native_reveal {
            let handle = app.handle().clone();
            Arc::new(
                // Delegates only a path already validated by the Files service.
                move |path: &Path| {
                    handle
                        .opener()
                        .reveal_item_in_dir(path)
                        .map_err(|_| FilesError::RevealFailed)
                },
            )
        } else {
            Arc::new(
                // Keeps isolated composition fail-closed for native reveal.
                |_path: &Path| Err(FilesError::RevealFailed),
            )
        }
    });
    let open_external: FilesOpenCallback = if native_reveal {
        let handle = app.handle().clone();
        Arc::new(move |path: &Path| {
            let path = path.to_str().ok_or(FilesError::OpenExternalFailed)?;
            handle
                .opener()
                .open_path(path, None::<&str>)
                .map_err(|_| FilesError::OpenExternalFailed)
        })
    } else {
        Arc::new(|_path: &Path| Err(FilesError::OpenExternalFailed))
    };
    let event_app = app.handle().clone();
    let handle_events: FileHandleEventSink = Arc::new(move |event| {
        event_app
            .emit_to("main", FILE_HANDLE_CHANGED_EVENT, event)
            .map_err(|_| FilesError::FileReadFailed)
    });
    let recent_app = app.handle().clone();
    let recent_events: RecentFilesEventSink = Arc::new(move |event| {
        recent_app
            .emit_to("main", RECENT_FILES_CHANGED_EVENT, event)
            .map_err(|_| FilesError::RecentFilesFailed)
    });
    let clock: FilesClock = Arc::new(system_files_clock);
    let dependencies = Arc::new(AppFileDependencies::new(
        app.state::<ProjectService>().inner().clone(),
        Arc::downgrade(&sessions),
    ));
    let service = FilesService::new_with_runtime(
        dependencies,
        storage,
        app.state::<DataMaintenanceGate>().inner().clone(),
        reveal,
        open_external,
        clock,
        handle_events,
        recent_events,
    );
    content_router.bind_files(&service.handle_manager())?;
    app.manage(service);
    Ok(())
}

/// Composes Data Management only after all Phase 1 owners are ready.
fn setup_data_management<R: Runtime>(
    app: &mut App<R>,
    storage: Storage,
    app_data_dir: PathBuf,
    sessions: Arc<SessionManager>,
    notifications: NotificationService,
) {
    let participants = DataParticipants {
        projects: app.state::<ProjectsDataParticipant>().inner().clone(),
        settings: app.state::<SettingsDataParticipant>().inner().clone(),
        cli_profiles: app.state::<CliProfilesDataParticipant>().inner().clone(),
        keyboard_shortcuts: app
            .state::<KeyboardShortcutsDataParticipant>()
            .inner()
            .clone(),
        notifications: notifications.clone(),
    };
    let service = DataManagementService::with_files_seams(
        storage,
        app.state::<DataMaintenanceGate>().inner().clone(),
        participants,
        Arc::new(AppDataRuntime::new(sessions, notifications)),
        Arc::new(TauriDataPlatform::new(app.handle().clone(), app_data_dir)),
        Arc::new(SystemDataClock::new()),
        Arc::new(TauriDataEventSink(app.handle().clone())),
        app.state::<FilesService>().inner().clone(),
    );
    app.manage(service);
}

/// Constructs and manages Search from public owner-query adapters.
fn setup_search<R: Runtime>(
    app: &mut App<R>,
    sessions: Arc<SessionManager>,
) -> Result<(), Box<dyn std::error::Error>> {
    let service = SearchService::new_with_files(
        Arc::new(AppProjectSearchSource::new(
            app.state::<ProjectService>().inner().clone(),
        )),
        Arc::new(AppSessionSearchSource::new(sessions)),
        Arc::new(AppFileSearchSource::new(
            app.state::<FilesService>().inner().clone(),
            app.state::<ProjectService>().inner().clone(),
        )),
        Arc::new(AppShortcutCatalogSource::new(
            app.state::<KeyboardShortcutsService>().inner().clone(),
        )),
    )?;
    app.manage(service);
    Ok(())
}

/// Opens storage completely before registering it as application state.
fn setup_storage<R: Runtime>(
    app: &mut App<R>,
    app_data_dir: PathBuf,
) -> Result<Storage, Box<dyn std::error::Error>> {
    let storage = Storage::open(&app_data_dir)?;
    app.manage(storage.clone());
    Ok(storage)
}

/// Creates the single maintenance gate and the managed Projects capability.
fn setup_projects<R, C>(
    app: &mut App<R>,
    storage: Storage,
    project_collaborators: C,
) -> Arc<DeferredProjectRuntimeGuard>
where
    R: Runtime,
    C: FnOnce(&AppHandle<R>) -> ProjectCollaborators,
{
    // Exactly one gate exists per process; `BE-005` and `BE-012` reuse this instance.
    let gate = DataMaintenanceGate::new();
    let runtime_guard = Arc::new(DeferredProjectRuntimeGuard::new());
    let (platform, events) = project_collaborators(app.handle());
    let service = ProjectService::new(
        storage,
        gate.clone(),
        platform,
        runtime_guard.clone(),
        events,
    );
    app.manage(ProjectsDataParticipant::new(service.clone()));
    app.manage(service);
    app.manage(gate);
    runtime_guard
}

/// Constructs, binds, and manages the process-local Sessions capability.
fn setup_sessions<R: Runtime>(
    app: &mut App<R>,
    project_guard: Arc<DeferredProjectRuntimeGuard>,
    initial_visibility: Option<bool>,
) -> Result<(Arc<SessionManager>, Arc<PaneContentRuntimeRouter>), Box<dyn std::error::Error>> {
    let main_window_visible = match initial_visibility {
        Some(visible) => visible,
        None => app
            .get_webview_window("main")
            .ok_or(AppLifecycleError::MainWindowUnavailable)?
            .is_visible()?,
    };
    let projects = app.state::<ProjectService>().inner().clone();
    let profiles = app.state::<CliProfilesService>().inner().clone();
    let gate = app.state::<DataMaintenanceGate>().inner().clone();
    let content_router = Arc::new(PaneContentRuntimeRouter::new());
    let manager = Arc::new(SessionManager::new(
        gate,
        Arc::new(SessionsProjectAccess::new(projects)),
        Arc::new(SessionsCliProfileLookup::new(profiles)),
        content_router.clone(),
        Arc::new(TauriSessionEventSink::new(app.handle().clone())),
        main_window_visible,
    ));
    project_guard.bind(manager.as_ref().clone())?;
    app.manage(manager.as_ref().clone());
    Ok((manager, content_router))
}

/// Constructs, binds, and manages the process-local Terminal capability.
fn setup_terminal<R: Runtime>(
    app: &mut App<R>,
    sessions: &Arc<SessionManager>,
    content_router: Arc<PaneContentRuntimeRouter>,
    native_interactions: bool,
) -> Result<TerminalManager, Box<dyn std::error::Error>> {
    let dependencies = Arc::new(AppTerminalDependencies::new(
        app.state::<ProjectService>().inner().clone(),
        app.state::<CliProfilesService>().inner().clone(),
        Arc::downgrade(sessions),
    ));
    let manager = TerminalManager::new(
        dependencies,
        Arc::new(TauriTerminalEventSink::new(app.handle().clone())),
        Arc::new(NativePtyFactory),
    );
    content_router.bind_terminal(&manager)?;
    let adapter: Arc<dyn crate::terminal::TerminalInteractionAdapter> = if native_interactions {
        Arc::new(NativeTerminalInteractionAdapter::new(app.handle().clone()))
    } else {
        Arc::new(UnavailableTerminalInteractionAdapter)
    };
    app.manage(TerminalInteractions::new(manager.clone(), adapter));
    app.manage(manager.clone());
    Ok(manager)
}

/// Manages CLI Profiles and starts its hydration, cleanup, and check work.
fn setup_cli_profiles<R, P>(
    app: &mut App<R>,
    storage: Storage,
    cli_profile_collaborators: P,
    start_background_work: bool,
) where
    R: Runtime,
    P: FnOnce(&AppHandle<R>) -> CliProfileCollaborators,
{
    let gate = app.state::<DataMaintenanceGate>().inner().clone();
    let (commands, shells, credentials, events, clock, ids) =
        cli_profile_collaborators(app.handle());
    let service = CliProfilesService::with_seams(
        storage,
        gate,
        commands,
        shells,
        credentials,
        events,
        clock,
        ids,
    );
    app.manage(CliProfilesDataParticipant::new(service.clone()));
    app.manage(service.clone());

    if !start_background_work {
        return;
    }
    // Hydration is asynchronous so a slow credential store cannot delay the window.
    tauri::async_runtime::spawn(async move {
        if let Err(error) = service.run_startup().await {
            // A hydration failure stays observable through every public command.
            eprintln!("cli profiles startup failed: {error}");
        }
    });
}

/// Notifies the shortcut owner before application shutdown begins.
pub fn notify_keyboard_shortcuts_shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(service) = app.try_state::<KeyboardShortcutsService>() {
        service.begin_shutdown();
    }
}

/// Hydrates shortcuts only after all embedded migrations have committed.
fn setup_keyboard_shortcuts<R: Runtime>(
    app: &mut App<R>,
    storage: Storage,
) -> Result<(), Box<dyn std::error::Error>> {
    let gate = app.state::<DataMaintenanceGate>().inner().clone();
    let service = KeyboardShortcutsService::new(storage, gate)?;
    app.manage(KeyboardShortcutsDataParticipant::new(service.clone()));
    app.manage(service);
    Ok(())
}

/// Hydrates and manages Settings with the process-wide maintenance gate.
fn setup_settings<R: Runtime>(
    app: &mut App<R>,
    storage: Storage,
) -> Result<(), Box<dyn std::error::Error>> {
    let gate = app.state::<DataMaintenanceGate>().inner().clone();
    let service = SettingsService::new(storage, gate)?;
    app.manage(SettingsDataParticipant::new(service.clone()));
    app.manage(service);
    Ok(())
}
