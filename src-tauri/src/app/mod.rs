use tauri::{Builder, Runtime};

/// Applies the desktop application's composition to a Tauri builder.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
}
