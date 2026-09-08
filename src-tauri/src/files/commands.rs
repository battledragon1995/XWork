use tauri::{Runtime, State, WebviewWindow};

use super::{
    FileEntryPathsDto, FileEntryRequestDto, FileHandleDto, FileHandleRequestDto, FileTreePageDto,
    FileTreeSearchDto, FilesError, FilesService, ListFileChildrenRequestDto,
    OpenFileInPaneRequestDto, OpenFileResultDto, RecentFileDto,
    ResolveExternalFileChangeRequestDto, SearchFileTreeRequestDto,
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

/// Opens one visible regular file into an exact empty main-window pane.
#[tauri::command]
pub(crate) async fn open_file_in_pane<R: Runtime>(
    request: OpenFileInPaneRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<OpenFileResultDto, FilesError> {
    require_main(&window)?;
    state.open_file_in_pane(request).await
}

/// Returns one in-memory file handle snapshot for the main window.
#[tauri::command]
pub(crate) async fn get_open_file<R: Runtime>(
    request: FileHandleRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError> {
    require_main(&window)?;
    state.get_open_file(&request.file_handle_id)
}

/// Reloads one clean attached file from disk for the main window.
#[tauri::command]
pub(crate) async fn reload_open_file<R: Runtime>(
    request: FileHandleRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError> {
    require_main(&window)?;
    state.reload_open_file(&request.file_handle_id).await
}

/// Applies one explicit external-conflict choice without writing the file.
#[tauri::command]
pub(crate) async fn resolve_external_file_change<R: Runtime>(
    request: ResolveExternalFileChangeRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError> {
    require_main(&window)?;
    state.resolve_external_file_change(request).await
}

/// Opens one revalidated handle through the operating-system default application.
#[tauri::command]
pub(crate) async fn open_file_with_default_app<R: Runtime>(
    request: FileHandleRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<(), FilesError> {
    require_main(&window)?;
    state
        .open_file_with_default_app(&request.file_handle_id)
        .await
}

/// Lists recent files for one project through the main window only.
#[tauri::command]
pub(crate) async fn list_recent_files<R: Runtime>(
    project_id: String,
    limit: Option<u32>,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<Vec<RecentFileDto>, FilesError> {
    require_main(&window)?;
    state.list_recent_files(&project_id, limit).await
}

/// Rejects every non-main webview before project or filesystem access.
fn require_main<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), FilesError> {
    (window.label() == "main")
        .then_some(())
        .ok_or(FilesError::WindowNotAllowed)
}

/// Applies one editor snapshot from the main window without touching disk.
#[tauri::command]
pub(crate) async fn update_markdown_buffer<R: Runtime>(
    request: super::UpdateMarkdownBufferRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<FileHandleDto, FilesError> {
    require_main(&window)?;
    state
        .replace_editor_snapshot(
            &request.file_handle_id,
            super::FileEditorSnapshot {
                text: request.text,
                expected_handle_revision: request.expected_revision,
                base_disk_revision: request.base_disk_revision,
            },
        )
        .await
}

/// Saves exactly one acknowledged snapshot from the main window.
#[tauri::command]
pub(crate) async fn save_markdown_file<R: Runtime>(
    request: super::SaveMarkdownFileRequestDto,
    window: WebviewWindow<R>,
    state: State<'_, FilesService>,
) -> Result<super::SaveMarkdownFileResultDto, FilesError> {
    require_main(&window)?;
    state.save_markdown_file(request).await
}
