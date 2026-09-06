use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

/// Accepts only normalized informational content, never runtime or project metadata.
pub trait OsNotification: Send + Sync {
    /// Dispatches one best-effort system notification without promising visible delivery.
    fn show(&self, title: &str, body: &str) -> Result<(), NotificationDeliveryError>;
}
/// Keeps native diagnostics free of raw platform details.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationDeliveryError {
    Permission,
    Platform,
    Show,
}
/// Wraps the official Rust notification plugin.
pub struct NativeNotification<R: Runtime>(pub AppHandle<R>);
impl<R: Runtime> OsNotification for NativeNotification<R> {
    /// Sends only the approved title and body through the initialized plugin.
    fn show(&self, title: &str, body: &str) -> Result<(), NotificationDeliveryError> {
        self.0
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            // Maps the failure to a sanitized boundary error.
            .map_err(|_| NotificationDeliveryError::Show)
    }
}
/// Prevents operating-system delivery from mock application composition.
pub struct UnavailableNotification;
impl OsNotification for UnavailableNotification {
    /// Reports a missing platform adapter without invoking native code.
    fn show(&self, _: &str, _: &str) -> Result<(), NotificationDeliveryError> {
        Err(NotificationDeliveryError::Platform)
    }
}
