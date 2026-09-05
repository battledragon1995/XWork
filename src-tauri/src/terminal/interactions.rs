use std::sync::Arc;

use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use super::{
    TerminalInteractionError, TerminalManager, TerminalProcessStateDto, models::validate_runtime_id,
};

/// Supplies the blocking operating-system calls used by explicit terminal interactions.
pub trait TerminalInteractionAdapter: Send + Sync {
    /// Returns plain text, or `None` when the clipboard has no text representation.
    fn read_text(&self) -> Result<Option<String>, TerminalInteractionError>;
    /// Writes one complete Unicode text value without altering a PTY.
    fn write_text(&self, text: &str) -> Result<(), TerminalInteractionError>;
    /// Opens one previously validated absolute web URL without a shell command.
    fn open_web_url(&self, url: &str) -> Result<(), TerminalInteractionError>;
}

/// Owns scoped clipboard and link operations alongside the terminal manager.
#[derive(Clone)]
pub struct TerminalInteractions {
    manager: TerminalManager,
    adapter: Arc<dyn TerminalInteractionAdapter>,
}

impl TerminalInteractions {
    /// Creates the capability with an explicit operating-system seam.
    pub fn new(manager: TerminalManager, adapter: Arc<dyn TerminalInteractionAdapter>) -> Self {
        Self { manager, adapter }
    }

    /// Reads clipboard text for an explicit paste into a running terminal.
    pub async fn read_text(
        &self,
        terminal_id: &str,
    ) -> Result<Option<String>, TerminalInteractionError> {
        let terminal = self.running_terminal(terminal_id).await?;
        let adapter = self.adapter.clone();
        let value = tauri::async_runtime::spawn_blocking(move || adapter.read_text())
            .await
            .map_err(|_| TerminalInteractionError::ClipboardUnavailable)??;

        // A clipboard read may block while the owning pane closes, so recheck before returning it.
        let current = self.running_terminal(&terminal.id).await?;
        if current.id != terminal.id {
            return Err(TerminalInteractionError::TerminalNotFound {
                terminal_id: terminal.id,
            });
        }
        Ok(value)
    }

    /// Writes selected terminal text to the clipboard without touching terminal I/O.
    pub async fn write_text(
        &self,
        terminal_id: &str,
        text: String,
    ) -> Result<(), TerminalInteractionError> {
        self.existing_terminal(terminal_id).await?;
        if text.contains('\0') {
            return Err(TerminalInteractionError::UnsupportedClipboardText);
        }
        let adapter = self.adapter.clone();
        tauri::async_runtime::spawn_blocking(move || adapter.write_text(&text))
            .await
            .map_err(|_| TerminalInteractionError::ClipboardUnavailable)??;
        Ok(())
    }

    /// Opens one explicitly activated HTTP or HTTPS link for an existing terminal.
    pub async fn open_web_url(
        &self,
        terminal_id: &str,
        raw_url: String,
    ) -> Result<(), TerminalInteractionError> {
        self.existing_terminal(terminal_id).await?;
        let url = validate_web_url(&raw_url)?;
        let adapter = self.adapter.clone();
        tauri::async_runtime::spawn_blocking(move || adapter.open_web_url(&url))
            .await
            .map_err(|_| TerminalInteractionError::LinkOpenFailed)??;
        Ok(())
    }

    /// Resolves any retained terminal after applying the shared shutdown and ID gates.
    async fn existing_terminal(
        &self,
        terminal_id: &str,
    ) -> Result<super::TerminalDto, TerminalInteractionError> {
        if self.manager.is_shutting_down() {
            return Err(TerminalInteractionError::RuntimeShuttingDown);
        }
        validate_runtime_id(terminal_id, "terminal-", "terminalId")
            .map_err(|_| TerminalInteractionError::InvalidRuntimeId)?;
        self.manager.get_terminal(terminal_id).await.map_err(|_| {
            TerminalInteractionError::TerminalNotFound {
                terminal_id: terminal_id.to_owned(),
            }
        })
    }

    /// Resolves a terminal and requires its process to still accept input.
    async fn running_terminal(
        &self,
        terminal_id: &str,
    ) -> Result<super::TerminalDto, TerminalInteractionError> {
        let terminal = self.existing_terminal(terminal_id).await?;
        if terminal.state != TerminalProcessStateDto::Running {
            return Err(TerminalInteractionError::TerminalNotRunning {
                terminal_id: terminal_id.to_owned(),
            });
        }
        Ok(terminal)
    }
}

/// Uses Rust-side official plugins for production clipboard and browser access.
pub struct NativeTerminalInteractionAdapter<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> NativeTerminalInteractionAdapter<R> {
    /// Captures the application handle whose plugin state owns native resources.
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> TerminalInteractionAdapter for NativeTerminalInteractionAdapter<R> {
    /// Reads text through the clipboard plugin and hides native failure details.
    fn read_text(&self) -> Result<Option<String>, TerminalInteractionError> {
        match self.app.clipboard().read_text() {
            Ok(text) => Ok(Some(text)),
            Err(error)
                if error
                    .to_string()
                    .to_ascii_lowercase()
                    .contains("not available") =>
            {
                Ok(None)
            }
            Err(_) => Err(TerminalInteractionError::ClipboardUnavailable),
        }
    }

    /// Writes text through the clipboard plugin and hides native failure details.
    fn write_text(&self, text: &str) -> Result<(), TerminalInteractionError> {
        self.app
            .clipboard()
            .write_text(text)
            .map_err(|_| TerminalInteractionError::ClipboardUnavailable)
    }

    /// Opens the validated URL through the Rust opener without exposing a frontend command.
    fn open_web_url(&self, url: &str) -> Result<(), TerminalInteractionError> {
        tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|_| TerminalInteractionError::LinkOpenFailed)
    }
}

/// Rejects native interactions in isolated application compositions.
pub struct UnavailableTerminalInteractionAdapter;

impl TerminalInteractionAdapter for UnavailableTerminalInteractionAdapter {
    /// Reports that isolated compositions have no clipboard.
    fn read_text(&self) -> Result<Option<String>, TerminalInteractionError> {
        Err(TerminalInteractionError::ClipboardUnavailable)
    }

    /// Reports that isolated compositions have no clipboard.
    fn write_text(&self, _text: &str) -> Result<(), TerminalInteractionError> {
        Err(TerminalInteractionError::ClipboardUnavailable)
    }

    /// Reports that isolated compositions cannot open links.
    fn open_web_url(&self, _url: &str) -> Result<(), TerminalInteractionError> {
        Err(TerminalInteractionError::LinkOpenFailed)
    }
}

/// Parses and canonicalizes the exact safe web-link subset accepted by Terminal.
fn validate_web_url(raw: &str) -> Result<String, TerminalInteractionError> {
    if raw.len() > 8192
        || raw.is_empty()
        || raw
            .chars()
            .any(|character| character.is_ascii_control() || character.is_ascii_whitespace())
    {
        return Err(TerminalInteractionError::InvalidLink);
    }
    let url = url::Url::parse(raw).map_err(|_| TerminalInteractionError::InvalidLink)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(TerminalInteractionError::InvalidLink);
    }
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies the web URL allowlist and canonicalization without invoking an opener.
    #[test]
    fn validates_only_absolute_http_links() {
        assert_eq!(
            validate_web_url("https://bücher.example/path").expect("Unicode host should parse"),
            "https://xn--bcher-kva.example/path"
        );
        assert!(validate_web_url("http://localhost:8080/").is_ok());
        for invalid in [
            "relative/path",
            "//example.com",
            "file:///tmp/a",
            "https://user@example.com",
            "https://example.com/a b",
        ] {
            assert_eq!(
                validate_web_url(invalid),
                Err(TerminalInteractionError::InvalidLink)
            );
        }
    }
}
