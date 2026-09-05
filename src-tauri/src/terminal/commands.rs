use tauri::{
    Runtime, State, WebviewWindow,
    ipc::{Channel, InvokeResponseBody},
};

use super::{
    PtySizeDto, TerminalDto, TerminalError, TerminalInputAckDto, TerminalInteractionError,
    TerminalInteractions, TerminalManager, TerminalResizeAckDto, TerminalSubscriptionDto,
};

/// Restricts every Terminal command to the exact main webview label.
fn authorize_main_caller(label: &str) -> Result<(), TerminalError> {
    if label == "main" {
        Ok(())
    } else {
        Err(TerminalError::UnauthorizedWindow)
    }
}

/// Clones managed interaction state so no Tauri state borrow crosses an await.
fn take_interactions(state: State<'_, TerminalInteractions>) -> TerminalInteractions {
    state.inner().clone()
}

/// Clones managed state so no Tauri state borrow crosses an await.
fn take_manager(state: State<'_, TerminalManager>) -> TerminalManager {
    state.inner().clone()
}

/// Starts the selected tool in a measured PTY and attaches it to its pane.
#[tauri::command]
pub async fn start_terminal<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalManager>,
    session_id: String,
    tab_id: String,
    pane_id: String,
    initial_size: PtySizeDto,
    on_output: Channel<InvokeResponseBody>,
) -> Result<TerminalDto, TerminalError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .start_terminal(&session_id, &tab_id, &pane_id, initial_size, on_output)
        .await
}

/// Returns the current public state of one terminal runtime.
#[tauri::command]
pub async fn get_terminal<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalManager>,
    terminal_id: String,
) -> Result<TerminalDto, TerminalError> {
    authorize_main_caller(window.label())?;
    take_manager(state).get_terminal(&terminal_id).await
}

/// Replaces the output subscriber and replays every retained frame after a sequence.
#[tauri::command]
pub async fn subscribe_terminal_output<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalManager>,
    terminal_id: String,
    after_sequence: Option<String>,
    on_output: Channel<InvokeResponseBody>,
) -> Result<TerminalSubscriptionDto, TerminalError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .subscribe_terminal_output(&terminal_id, after_sequence.as_deref(), on_output)
        .await
}

/// Writes one ordered UTF-8/control input chunk to a running PTY.
#[tauri::command]
pub async fn write_terminal<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalManager>,
    terminal_id: String,
    input_sequence: String,
    data: String,
) -> Result<TerminalInputAckDto, TerminalError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .write_terminal(&terminal_id, &input_sequence, data)
        .await
}

/// Resizes a PTY using a monotonic client resize sequence.
#[tauri::command]
pub async fn resize_terminal<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalManager>,
    terminal_id: String,
    resize_sequence: String,
    size: PtySizeDto,
) -> Result<TerminalResizeAckDto, TerminalError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .resize_terminal(&terminal_id, &resize_sequence, size)
        .await
}

/// Clears a terminal attention marker after the user focuses its pane.
#[tauri::command]
pub async fn acknowledge_terminal_attention<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalManager>,
    terminal_id: String,
) -> Result<TerminalDto, TerminalError> {
    authorize_main_caller(window.label())?;
    take_manager(state)
        .acknowledge_terminal_attention(&terminal_id)
        .await
}

/// Reads plain text for an explicit paste into an attached running terminal.
#[tauri::command]
pub async fn read_terminal_clipboard<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalInteractions>,
    terminal_id: String,
) -> Result<Option<String>, TerminalInteractionError> {
    if window.label() != "main" {
        return Err(TerminalInteractionError::UnauthorizedWindow);
    }
    take_interactions(state).read_text(&terminal_id).await
}

/// Writes explicitly selected terminal text or a link target to the OS clipboard.
#[tauri::command]
pub async fn write_terminal_clipboard<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalInteractions>,
    terminal_id: String,
    text: String,
) -> Result<(), TerminalInteractionError> {
    if window.label() != "main" {
        return Err(TerminalInteractionError::UnauthorizedWindow);
    }
    take_interactions(state)
        .write_text(&terminal_id, text)
        .await
}

/// Opens a user-activated HTTP or HTTPS URL in the default browser.
#[tauri::command]
pub async fn open_terminal_link<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, TerminalInteractions>,
    terminal_id: String,
    url: String,
) -> Result<(), TerminalInteractionError> {
    if window.label() != "main" {
        return Err(TerminalInteractionError::UnauthorizedWindow);
    }
    take_interactions(state)
        .open_web_url(&terminal_id, url)
        .await
}
