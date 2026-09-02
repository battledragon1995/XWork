use std::{path::PathBuf, sync::Arc};

use tauri::{App, AppHandle, Builder, Manager, Runtime, WebviewWindow, WindowEvent};

use crate::{
    platform::window::{bring_to_front, hide_window},
    storage::Storage,
};

pub mod lifecycle;
pub mod tray;

use lifecycle::{AppLifecycleError, AppLifecycleState, AppRuntime, EmptyAppRuntime};

/// Describes whether a native close event should be intercepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[doc(hidden)]
pub enum CloseDecision {
    HideToTray,
    AllowClose,
}

/// Applies the desktop application's composition to a Tauri builder.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        // Ignores argv and cwd while restoring the existing main window in place.
        |app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main")
                && bring_to_front(&window).is_err()
            {
                eprintln!("single-instance main-window activation failed");
            }
        },
    ));

    configure_lifecycle(
        builder,
        None,
        Arc::new(EmptyAppRuntime),
        tray::attach_native_tray,
    )
}

/// Applies composition with an isolated app data path for integration tests.
#[doc(hidden)]
pub fn configure_with_app_data_dir<R: Runtime>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
) -> Builder<R> {
    builder.setup(
        // Uses the caller-owned isolated path while exercising the production setup helper.
        move |app| setup_storage(app, app_data_dir),
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
    configure_lifecycle(builder, Some(app_data_dir), runtime, attach_tray)
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
    Ok(CloseDecision::HideToTray)
}

/// Creates the single lifecycle command router shared by production and tests.
fn lifecycle_invoke_handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync {
    tauri::generate_handler![
        lifecycle::hide_main_window,
        lifecycle::minimize_main_window,
        lifecycle::toggle_main_window_maximized,
        lifecycle::request_quit,
        lifecycle::cancel_quit,
        lifecycle::confirm_quit
    ]
}

/// Wires storage, lifecycle state, tray attachment, commands, and close handling.
fn configure_lifecycle<R, F>(
    builder: Builder<R>,
    app_data_dir: Option<PathBuf>,
    runtime: Arc<dyn AppRuntime>,
    attach_tray: F,
) -> Builder<R>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) -> Result<(), AppLifecycleError> + Send + 'static,
{
    builder
        .setup(
            // Publishes state only after storage opens, then attaches the required tray.
            move |app| {
                let app_data_dir = match app_data_dir {
                    Some(path) => path,
                    None => app.path().app_data_dir()?,
                };
                setup_storage(app, app_data_dir)?;
                app.manage(AppLifecycleState::new(runtime));
                attach_tray(app.handle())?;
                Ok(())
            },
        )
        .invoke_handler(lifecycle_invoke_handler())
        .on_window_event(
            // Intercepts native close only for main while shutdown is not in progress.
            |window, event| {
                if window.label() != "main" {
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

/// Opens storage completely before registering it as application state.
fn setup_storage<R: Runtime>(
    app: &mut App<R>,
    app_data_dir: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let storage = Storage::open(&app_data_dir)?;
    app.manage(storage);
    Ok(())
}
