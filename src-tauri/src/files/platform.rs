use std::path::Path;

use super::{FilesError, FilesRevealCallback};

/// Reveals one path that the service already validated.
pub(crate) trait FilePlatform: Send + Sync {
    /// Reveals the supplied non-link path in the native file manager.
    fn reveal_item(&self, path: &Path) -> Result<(), FilesError>;
}

/// Adapts an application-owned callback to the narrow Files platform port.
pub(crate) struct CallbackFilePlatform {
    callback: FilesRevealCallback,
}

impl CallbackFilePlatform {
    /// Creates the platform adapter around one injected reveal callback.
    pub(crate) fn new(callback: FilesRevealCallback) -> Self {
        Self { callback }
    }
}

impl FilePlatform for CallbackFilePlatform {
    /// Delegates a validated path to the application-owned callback.
    fn reveal_item(&self, path: &Path) -> Result<(), FilesError> {
        (self.callback)(path)
    }
}
