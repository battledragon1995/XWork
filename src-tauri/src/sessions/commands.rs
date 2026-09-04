use tauri::{Runtime, State, WebviewWindow};

use super::{
    CloseImpactDto, CloseResultDto, CloseTargetDto, SessionDetailDto, SessionManager,
    SessionSummaryDto, SessionsError, SplitDirectionDto,
};

/// Restricts every Sessions command to the exact main webview label.
fn authorize_main_caller(label: &str) -> Result<(), SessionsError> {
    if label == "main" {
        Ok(())
    } else {
        Err(SessionsError::UnauthorizedWindow)
    }
}

/// Clones managed state so no Tauri state borrow crosses an await.
fn take_manager(state: State<'_, SessionManager>) -> SessionManager {
    state.inner().clone()
}

/// Lists runtime sessions, optionally restricted to one project.
#[tauri::command]
pub async fn list_sessions<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: Option<String>,
    state: State<'_, SessionManager>,
) -> Result<Vec<SessionSummaryDto>, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .list_sessions(project_id.as_deref())
        .await
}

/// Returns one runtime session and its complete tab layout.
#[tauri::command]
pub async fn get_session<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state).get_session(&session_id).await
}

/// Creates an empty runtime session for an available project.
#[tauri::command]
pub async fn create_session<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state).create_session(&project_id).await
}

/// Renames one runtime session.
#[tauri::command]
pub async fn rename_session<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    name: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state).rename_session(&session_id, &name).await
}

/// Appends an empty tab and makes it active.
#[tauri::command]
pub async fn create_tab<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state).create_tab(&session_id).await
}

/// Renames one tab in a session.
#[tauri::command]
pub async fn rename_tab<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    name: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .rename_tab(&session_id, &tab_id, &name)
        .await
}

/// Reorders a tab relative to a stable tab identifier.
#[tauri::command]
pub async fn move_tab<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    before_tab_id: Option<String>,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .move_tab(&session_id, &tab_id, before_tab_id.as_deref())
        .await
}

/// Selects the active tab in a session.
#[tauri::command]
pub async fn set_active_tab<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .set_active_tab(&session_id, &tab_id)
        .await
}

/// Selects the active pane in one tab.
#[tauri::command]
pub async fn set_active_pane<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    pane_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .set_active_pane(&session_id, &tab_id, &pane_id)
        .await
}

/// Splits one pane to the right or downward.
#[tauri::command]
pub async fn split_pane<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    pane_id: String,
    direction: SplitDirectionDto,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .split_pane(&session_id, &tab_id, &pane_id, direction)
        .await
}

/// Commits the final ratio for one split node.
#[tauri::command]
pub async fn set_split_ratio<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    split_id: String,
    ratio_basis_points: u16,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .set_split_ratio(&session_id, &tab_id, &split_id, ratio_basis_points)
        .await
}

/// Maximizes one pane or restores the tab layout.
#[tauri::command]
pub async fn set_maximized_pane<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    pane_id: Option<String>,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .set_maximized_pane(&session_id, &tab_id, pane_id.as_deref())
        .await
}

/// Creates the first tool-selection tab in an empty session.
#[tauri::command]
pub async fn select_session_tool<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    profile_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .select_session_tool(&session_id, &profile_id)
        .await
}

/// Stores one tool selection in an empty pane.
#[tauri::command]
pub async fn select_pane_tool<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    tab_id: String,
    pane_id: String,
    profile_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .select_pane_tool(&session_id, &tab_id, &pane_id, &profile_id)
        .await
}

/// Inspects the destructive impact of closing one runtime target.
#[tauri::command]
pub async fn get_close_impact<R: Runtime>(
    window: WebviewWindow<R>,
    target: CloseTargetDto,
    state: State<'_, SessionManager>,
) -> Result<CloseImpactDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state).get_close_impact(target).await
}

/// Closes one target with explicit confirmation when required.
#[tauri::command]
pub async fn close_runtime_target<R: Runtime>(
    window: WebviewWindow<R>,
    target: CloseTargetDto,
    confirmed: bool,
    state: State<'_, SessionManager>,
) -> Result<CloseResultDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .close_runtime_target(target, confirmed)
        .await
}

/// Reopens the most recently closed tab in a session.
#[tauri::command]
pub async fn reopen_last_closed_tab<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: String,
    state: State<'_, SessionManager>,
) -> Result<SessionDetailDto, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .reopen_last_closed_tab(&session_id)
        .await
}

/// Updates the session currently observed by the main application route.
#[tauri::command]
pub async fn set_observed_session<R: Runtime>(
    window: WebviewWindow<R>,
    session_id: Option<String>,
    state: State<'_, SessionManager>,
) -> Result<Option<SessionSummaryDto>, SessionsError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .set_observed_session(session_id.as_deref())
        .await
}

#[cfg(test)]
mod tests {
    use super::authorize_main_caller;
    use crate::sessions::SessionsError;

    /// Verifies every Sessions command shares an exact-label authorization rule.
    #[test]
    fn only_exact_main_is_authorized() {
        assert_eq!(authorize_main_caller("main"), Ok(()));
        for label in ["quick-note", "", "Main", "main "] {
            assert_eq!(
                authorize_main_caller(label),
                Err(SessionsError::UnauthorizedWindow)
            );
        }
    }
}
