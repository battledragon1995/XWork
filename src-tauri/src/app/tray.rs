use std::sync::Mutex;

use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    menu::{MenuBuilder, MenuItem},
    tray::TrayIconBuilder,
};

use crate::platform::window::bring_to_front;

use super::lifecycle::{
    AppLifecycleError, AppLifecycleState, AttentionSession, LifecycleEvent, QuitFlow,
    QuitRequestDto, SessionNavigationDto, TrayOperation,
};

pub(crate) const TRAY_ID: &str = "xwork.tray";
pub(crate) const OPEN_MENU_ID: &str = "xwork.tray.open";
pub(crate) const QUIT_MENU_ID: &str = "xwork.tray.quit";
pub(crate) const ATTENTION_GROUP_LABEL: &str = "Needs attention";
const ATTENTION_HEADER_ID: &str = "xwork.tray.attention";
const SESSION_MENU_PREFIX: &str = "xwork.tray.session.";
const QUIT_REQUESTED_EVENT: &str = "app-quit-requested";
const NAVIGATE_SESSION_EVENT: &str = "app-navigate-session";

/// Represents one ordered entry in the backend-owned tray model.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TrayEntry {
    Open,
    AttentionHeader,
    Session { menu_id: String, label: String },
    Separator,
    Quit,
}

/// Represents an action resolved only from backend-owned menu identifiers.
#[derive(Clone, Debug, PartialEq, Eq)]
enum TrayAction {
    Open,
    Session(String),
    Quit,
    Unknown,
}

/// Stores the model currently attached to the native tray menu.
struct TrayMenuState {
    model: Mutex<Vec<TrayEntry>>,
}

/// Reports the result of selecting Quit from the native tray.
#[derive(Clone, Debug, PartialEq, Eq)]
#[doc(hidden)]
pub enum TrayQuitOutcome {
    DialogShown(QuitRequestDto),
    ReadyToExit,
}

/// Builds the deterministic tray model for the current attention snapshot.
pub(crate) fn build_tray_menu_model(sessions: &[AttentionSession]) -> Vec<TrayEntry> {
    let mut sorted_sessions = sessions.to_vec();
    sorted_sessions.sort_by(
        // Orders newest attention first and uses the opaque ID only as a stable tie-breaker.
        |left, right| {
            right
                .attention_sequence
                .cmp(&left.attention_sequence)
                .then_with(
                    // Applies the stable tie-breaker for equal attention sequences.
                    || left.session_id.cmp(&right.session_id),
                )
        },
    );

    let mut entries = vec![TrayEntry::Open, TrayEntry::Separator];
    if !sorted_sessions.is_empty() {
        entries.push(TrayEntry::AttentionHeader);
        entries.extend(sorted_sessions.into_iter().take(5).map(
            // Keeps the routing ID independent from the normalized display label.
            |session| TrayEntry::Session {
                menu_id: session_menu_id(&session.session_id),
                label: format_session_label(&session),
            },
        ));
        entries.push(TrayEntry::Separator);
    }
    entries.push(TrayEntry::Quit);
    entries
}

/// Normalizes untrusted display text and limits it to 80 Unicode scalars.
pub(crate) fn normalize_label(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

/// Resolves a native menu identifier against the current backend model.
fn resolve_menu_action(entries: &[TrayEntry], menu_id: &str) -> TrayAction {
    if menu_id == OPEN_MENU_ID {
        return TrayAction::Open;
    }
    if menu_id == QUIT_MENU_ID {
        return TrayAction::Quit;
    }

    entries
        .iter()
        .find_map(
            // Accepts only a session entry already present in the backend model.
            |entry| match entry {
                TrayEntry::Session {
                    menu_id: entry_id, ..
                } if entry_id == menu_id => entry_id.strip_prefix(SESSION_MENU_PREFIX).map(
                    // Restores the opaque routing ID without using display text.
                    |session_id| TrayAction::Session(session_id.to_owned()),
                ),
                _ => None,
            },
        )
        .unwrap_or(TrayAction::Unknown)
}

/// Shows, restores, and focuses the existing main window from the tray.
#[doc(hidden)]
pub fn tray_open<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppLifecycleError> {
    let window = app
        .get_webview_window("main")
        .ok_or(AppLifecycleError::MainWindowUnavailable)?;
    bring_to_front(&window).map_err(AppLifecycleError::from)
}

/// Runs the shared Quit state machine and emits a dialog request when required.
#[doc(hidden)]
pub async fn tray_quit<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TrayQuitOutcome, AppLifecycleError> {
    let state = app.state::<AppLifecycleState>();
    match state.request_quit().await? {
        QuitFlow::Dialog(request) => {
            tray_open(app)?;
            app.emit_to("main", QUIT_REQUESTED_EVENT, &request)
                .map_err(
                    // Preserves the pending request so a later activation can retry delivery.
                    |_source| AppLifecycleError::EventDeliveryFailed {
                        event: LifecycleEvent::QuitRequested,
                    },
                )?;
            Ok(TrayQuitOutcome::DialogShown(request))
        }
        QuitFlow::ProceedShutdown => {
            state.finish_shutdown().await?;
            Ok(TrayQuitOutcome::ReadyToExit)
        }
    }
}

/// Navigates only when the selected session still exists in a fresh snapshot.
#[doc(hidden)]
pub async fn tray_select_session<R: Runtime>(
    app: &AppHandle<R>,
    menu_id: &str,
) -> Result<bool, AppLifecycleError> {
    let state = app.state::<AppLifecycleState>();
    let sessions = state.attention_sessions().await?;
    let model = build_tray_menu_model(&sessions);
    let TrayAction::Session(session_id) = resolve_menu_action(&model, menu_id) else {
        replace_native_menu_if_attached(app, model)?;
        return Ok(false);
    };

    let window = app
        .get_webview_window("main")
        .ok_or(AppLifecycleError::MainWindowUnavailable)?;
    window.show().map_err(
        // Maps the native source to the stable show operation category.
        |_| AppLifecycleError::from(crate::platform::window::WindowOperation::Show),
    )?;
    window.unminimize().map_err(
        // Maps the native source to the stable restore operation category.
        |_| AppLifecycleError::from(crate::platform::window::WindowOperation::Unminimize),
    )?;
    // Focus is best effort for session navigation, but delivery still targets main exactly once.
    if window.set_focus().is_err() {
        eprintln!("native window operation failed: Focus");
    }
    app.emit_to(
        "main",
        NAVIGATE_SESSION_EVENT,
        SessionNavigationDto { session_id },
    )
    .map_err(
        // Hides event-system details behind the stable navigation category.
        |_| AppLifecycleError::EventDeliveryFailed {
            event: LifecycleEvent::NavigateSession,
        },
    )?;
    Ok(true)
}

/// Attaches the Phase 1 native tray using the existing application icon.
pub(crate) fn attach_native_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), AppLifecycleError> {
    let model = build_tray_menu_model(&[]);
    let menu = build_native_menu(app, &model)?;
    let icon =
        app.default_window_icon()
            .cloned()
            .ok_or(AppLifecycleError::TrayOperationFailed {
                operation: TrayOperation::CreateIcon,
            })?;
    app.manage(TrayMenuState {
        model: Mutex::new(model),
    });

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("XWork")
        .menu(&menu)
        .on_menu_event(
            // Native callbacks schedule work and return without waiting for runtime futures.
            move |app, event| {
                let app = app.clone();
                let action = resolve_attached_action(&app, event.id().as_ref());
                tauri::async_runtime::spawn(async move {
                    match action {
                        Ok(action) => dispatch_native_action(app, action).await,
                        Err(error) => eprintln!("native tray action failed: {error}"),
                    }
                });
            },
        )
        .build(app)
        .map_err(
            // Classifies native tray construction without exposing its source error.
            |_| AppLifecycleError::TrayOperationFailed {
                operation: TrayOperation::CreateIcon,
            },
        )?;
    Ok(())
}

/// Resolves an event against the exact menu model currently attached to the tray.
fn resolve_attached_action<R: Runtime>(
    app: &AppHandle<R>,
    menu_id: &str,
) -> Result<TrayAction, AppLifecycleError> {
    let state = app.state::<TrayMenuState>();
    let model = state.model.lock().map_err(
        // Reuses the lock-poison category for process-local tray state.
        |_| AppLifecycleError::StateLockPoisoned,
    )?;
    Ok(resolve_menu_action(&model, menu_id))
}

/// Replaces a native menu after a stale selection when a tray is attached.
fn replace_native_menu_if_attached<R: Runtime>(
    app: &AppHandle<R>,
    model: Vec<TrayEntry>,
) -> Result<(), AppLifecycleError> {
    let Some(state) = app.try_state::<TrayMenuState>() else {
        return Ok(());
    };
    let menu = build_native_menu(app, &model)?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or(AppLifecycleError::TrayOperationFailed {
            operation: TrayOperation::ReplaceMenu,
        })?;
    tray.set_menu(Some(menu)).map_err(
        // Classifies failure to replace the current native menu.
        |_| AppLifecycleError::TrayOperationFailed {
            operation: TrayOperation::ReplaceMenu,
        },
    )?;
    *state.model.lock().map_err(
        // Keeps poisoned state from silently diverging from the native menu.
        |_| AppLifecycleError::StateLockPoisoned,
    )? = model;
    Ok(())
}

/// Builds a native menu from the pure ordered tray model.
fn build_native_menu<R: Runtime>(
    app: &AppHandle<R>,
    model: &[TrayEntry],
) -> Result<tauri::menu::Menu<R>, AppLifecycleError> {
    let mut builder = MenuBuilder::new(app);
    for entry in model {
        builder = match entry {
            TrayEntry::Open => builder.text(OPEN_MENU_ID, "Open XWork"),
            TrayEntry::AttentionHeader => {
                let header = MenuItem::with_id(
                    app,
                    ATTENTION_HEADER_ID,
                    ATTENTION_GROUP_LABEL,
                    false,
                    None::<&str>,
                )
                .map_err(
                    // Classifies failure to create the native group header.
                    |_| AppLifecycleError::TrayOperationFailed {
                        operation: TrayOperation::BuildMenu,
                    },
                )?;
                builder.item(&header)
            }
            TrayEntry::Session { menu_id, label } => builder.text(menu_id, label),
            TrayEntry::Separator => builder.separator(),
            TrayEntry::Quit => builder.text(QUIT_MENU_ID, "Quit XWork"),
        };
    }
    builder.build().map_err(
        // Classifies failure to assemble the complete native menu.
        |_| AppLifecycleError::TrayOperationFailed {
            operation: TrayOperation::BuildMenu,
        },
    )
}

/// Executes one already-resolved native tray action in an asynchronous task.
async fn dispatch_native_action<R: Runtime>(app: AppHandle<R>, action: TrayAction) {
    let result = match action {
        TrayAction::Open => tray_open(&app),
        TrayAction::Quit => match tray_quit(&app).await {
            Ok(TrayQuitOutcome::ReadyToExit) => {
                app.exit(0);
                Ok(())
            }
            Ok(TrayQuitOutcome::DialogShown(_)) => Ok(()),
            Err(error) => Err(error),
        },
        TrayAction::Session(session_id) => {
            let menu_id = session_menu_id(&session_id);
            tray_select_session(&app, &menu_id).await.map(
                // Discards the stale-selection flag after native dispatch handles it.
                |_| (),
            )
        }
        TrayAction::Unknown => Ok(()),
    };

    if let Err(error) = result {
        eprintln!("native tray action failed: {error}");
    }
}

/// Creates a collision-resistant menu identifier for an opaque session ID.
fn session_menu_id(session_id: &str) -> String {
    format!("{SESSION_MENU_PREFIX}{session_id}")
}

/// Formats one attention entry to match the approved tray hierarchy.
fn format_session_label(session: &AttentionSession) -> String {
    let status = session
        .status_label
        .as_deref()
        .map(
            // Adds spacing only when the optional status label is present.
            |status| format!(" {status}"),
        )
        .unwrap_or_default();
    normalize_label(&format!(
        "{} · {}{}",
        session.project_name, session.session_name, status
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        OPEN_MENU_ID, QUIT_MENU_ID, TrayAction, TrayEntry, build_tray_menu_model, normalize_label,
        resolve_menu_action, session_menu_id,
    };
    use crate::app::lifecycle::AttentionSession;

    /// Creates one attention-session fixture with stable display fields.
    fn session(id: &str, sequence: u64) -> AttentionSession {
        AttentionSession {
            session_id: id.to_owned(),
            project_name: "xwork".to_owned(),
            session_name: format!("Session {id}"),
            status_label: None,
            attention_sequence: sequence,
        }
    }

    /// Verifies that the empty Phase 1 model omits the attention group.
    #[test]
    fn empty_model_contains_only_open_separator_and_quit() {
        assert_eq!(
            build_tray_menu_model(&[]),
            vec![TrayEntry::Open, TrayEntry::Separator, TrayEntry::Quit]
        );
    }

    /// Verifies stable newest-first ordering and the five-session cap.
    #[test]
    fn attention_model_sorts_stably_and_caps_sessions() {
        let sessions = vec![
            session("f", 1),
            session("b", 3),
            session("a", 3),
            session("c", 2),
            session("d", 2),
            session("e", 1),
        ];

        let model = build_tray_menu_model(&sessions);
        let ids = model
            .iter()
            .filter_map(|entry| match entry {
                TrayEntry::Session { menu_id, .. } => Some(menu_id.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(ids, ["a", "b", "c", "d", "e"].map(session_menu_id).to_vec());
        assert_eq!(model.first(), Some(&TrayEntry::Open));
        assert_eq!(model.last(), Some(&TrayEntry::Quit));
        assert_eq!(model[2], TrayEntry::AttentionHeader);
        assert_eq!(model[8], TrayEntry::Separator);
    }

    /// Verifies whitespace normalization and Unicode-scalar truncation.
    #[test]
    fn labels_are_normalized_and_limited_to_unicode_scalars() {
        assert_eq!(
            normalize_label("  alpha\n\tbeta   gamma "),
            "alpha beta gamma"
        );
        let long = format!("{}e\u{301}tail", "🙂".repeat(79));
        let normalized = normalize_label(&long);

        assert_eq!(normalized.chars().count(), 80);
        assert!(normalized.ends_with('e'));
    }

    /// Verifies action resolution trusts IDs and never display labels.
    #[test]
    fn actions_resolve_only_from_backend_ids() {
        let model = build_tray_menu_model(&[session("session-1", 1)]);

        assert_eq!(resolve_menu_action(&model, OPEN_MENU_ID), TrayAction::Open);
        assert_eq!(resolve_menu_action(&model, QUIT_MENU_ID), TrayAction::Quit);
        assert_eq!(
            resolve_menu_action(&model, &session_menu_id("session-1")),
            TrayAction::Session("session-1".to_owned())
        );
        assert_eq!(
            resolve_menu_action(&model, "xwork · Session session-1"),
            TrayAction::Unknown
        );
    }
}
