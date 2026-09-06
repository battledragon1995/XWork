use tauri::{Runtime, State, WebviewWindow};

use super::{
    FileEntryPathsDto, FileEntryRequestDto, FileTreePageDto, FileTreeSearchDto, FilesError,
    FilesService, ListFileChildrenRequestDto, SearchFileTreeRequestDto,
};

/// Lists one page of direct children for the main window.
#[tauri::command]
pub(crate) async fn list_file_children<R: Runtime>(
    request: ListFileChildrenRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<FileTreePageDto, FilesError> {
    require_main(&window)?;
    state.list_children(request).await
}

/// Searches one project tree by basename for the main window.
#[tauri::command]
pub(crate) async fn search_file_tree<R: Runtime>(
    request: SearchFileTreeRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<FileTreeSearchDto, FilesError> {
    require_main(&window)?;
    state.search_tree(request).await
}

/// Returns copyable paths for one visible entry in the main window.
#[tauri::command]
pub(crate) async fn get_file_entry_paths<R: Runtime>(
    request: FileEntryRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<FileEntryPathsDto, FilesError> {
    require_main(&window)?;
    state.entry_paths(request).await
}

/// Reveals one validated entry for the main window.
#[tauri::command]
pub(crate) async fn reveal_file_entry<R: Runtime>(
    request: FileEntryRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<(), FilesError> {
    require_main(&window)?;
    state.reveal_entry(request).await
}

/// Rejects every non-main webview before project or filesystem access.
fn require_main<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), FilesError> {
    (window.label() == "main")
        .then_some(())
        .ok_or(FilesError::WindowNotAllowed)
}
