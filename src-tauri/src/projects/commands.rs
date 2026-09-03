use tauri::{Runtime, State, WebviewWindow};

use super::error::ProjectsError;
use super::models::{
    ProjectDto, ProjectFolderSelectionDto, ProjectGitStatusDto, ProjectGitSummaryDto,
    RemoveProjectImpactDto, RemoveProjectResultDto,
};
use super::service::ProjectService;

/// Allows the read-only project list for the main and Quick Note windows.
fn authorize_list_caller(label: &str) -> Result<(), ProjectsError> {
    if label == "main" || label == "quick-note" {
        Ok(())
    } else {
        Err(ProjectsError::UnauthorizedWindow)
    }
}

/// Restricts every other Projects command to the exact main window.
fn authorize_main_caller(label: &str) -> Result<(), ProjectsError> {
    if label == "main" {
        Ok(())
    } else {
        Err(ProjectsError::UnauthorizedWindow)
    }
}

/// Clones the managed service so no state borrow is held across an await.
fn take_service(state: State<'_, ProjectService>) -> ProjectService {
    state.inner().clone()
}

/// Lists projects in stable display order with current availability.
#[tauri::command]
pub(crate) async fn list_projects<R: Runtime>(
    window: WebviewWindow<R>,
    search: Option<String>,
    state: State<'_, ProjectService>,
) -> Result<Vec<ProjectDto>, ProjectsError> {
    authorize_list_caller(window.label())?;
    let service = take_service(state);
    service.list_projects(search.as_deref()).await
}

/// Returns one project with current folder availability.
#[tauri::command]
pub(crate) async fn get_project<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.get_project(&project_id).await
}

/// Returns the current read-only Git summary for one project.
#[tauri::command]
pub(crate) async fn get_project_git_summary<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, ProjectService>,
) -> Result<ProjectGitSummaryDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.git_summary(&project_id).await
}

/// Returns the current read-only Git status and change list for one project.
#[tauri::command]
pub(crate) async fn get_project_git_status<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, ProjectService>,
) -> Result<ProjectGitStatusDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.git_status(&project_id).await
}

/// Selects and registers an existing project folder.
#[tauri::command]
pub(crate) async fn add_project<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, ProjectService>,
) -> Result<ProjectFolderSelectionDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.add_project().await
}

/// Renames a project without changing its folder.
#[tauri::command]
pub(crate) async fn rename_project<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    display_name: String,
    state: State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.rename_project(&project_id, &display_name).await
}

/// Sets the pinned state of a project.
#[tauri::command]
pub(crate) async fn set_project_pinned<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    is_pinned: bool,
    state: State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.set_project_pinned(&project_id, is_pinned).await
}

/// Records a project overview opening and returns current metadata.
#[tauri::command]
pub(crate) async fn open_project<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, ProjectService>,
) -> Result<ProjectDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.open_project(&project_id).await
}

/// Replaces a project's missing or relocated root folder.
#[tauri::command]
pub(crate) async fn locate_project_folder<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, ProjectService>,
) -> Result<ProjectFolderSelectionDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.locate_project_folder(&project_id).await
}

/// Opens an available project root in the operating-system file manager.
#[tauri::command]
pub(crate) async fn open_project_folder<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, ProjectService>,
) -> Result<(), ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.open_project_folder(&project_id).await
}

/// Inspects sessions and unsaved work affected by removing a project.
#[tauri::command]
pub(crate) async fn get_remove_project_impact<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    state: State<'_, ProjectService>,
) -> Result<RemoveProjectImpactDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.get_remove_project_impact(&project_id).await
}

/// Removes project metadata after explicit confirmation and runtime cleanup.
#[tauri::command]
pub(crate) async fn remove_project<R: Runtime>(
    window: WebviewWindow<R>,
    project_id: String,
    confirmed: bool,
    state: State<'_, ProjectService>,
) -> Result<RemoveProjectResultDto, ProjectsError> {
    authorize_main_caller(window.label())?;
    let service = take_service(state);
    service.remove_project(&project_id, confirmed).await
}

#[cfg(test)]
mod tests {
    use super::{authorize_list_caller, authorize_main_caller};
    use crate::projects::error::ProjectsError;

    /// Verifies that only the two documented windows may read the project list.
    #[test]
    fn list_authorization_allows_main_and_quick_note() {
        assert_eq!(authorize_list_caller("main"), Ok(()));
        assert_eq!(authorize_list_caller("quick-note"), Ok(()));
        for rejected in ["Main", "quick-Note", "", "settings"] {
            assert_eq!(
                authorize_list_caller(rejected),
                Err(ProjectsError::UnauthorizedWindow)
            );
        }
    }

    /// Verifies that every other command accepts only the exact main window.
    #[test]
    fn main_authorization_uses_the_exact_label() {
        assert_eq!(authorize_main_caller("main"), Ok(()));
        for rejected in ["quick-note", "Main", "", "main "] {
            assert_eq!(
                authorize_main_caller(rejected),
                Err(ProjectsError::UnauthorizedWindow)
            );
        }
    }
}
