use std::path::PathBuf;

use tauri::{App, Builder, Manager, Runtime};

use crate::storage::Storage;

/// Applies the desktop application's composition to a Tauri builder.
pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.setup(
        // Resolves the production app data directory before initializing storage.
        |app| {
            let app_data_dir = app.path().app_data_dir()?;
            setup_storage(app, app_data_dir)
        },
    )
}

/// Applies composition with an isolated app data path for integration tests.
#[doc(hidden)]
pub fn configure_with_app_data_dir<R: Runtime>(
    builder: Builder<R>,
    app_data_dir: PathBuf,
) -> Builder<R> {
    builder.setup(
        // Uses the caller-owned isolated path while exercising the production setup helper.
        move |app| setup_storage(app, app_data_dir),
    )
}

/// Opens storage completely before registering it as application state.
fn setup_storage<R: Runtime>(
    app: &mut App<R>,
    app_data_dir: PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let storage = Storage::open(&app_data_dir)?;
    app.manage(storage);
    Ok(())
}
