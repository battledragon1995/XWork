pub mod app;
pub mod platform;
pub mod projects;
pub mod settings;
pub mod shared;
pub mod storage;

/// Starts the XWork desktop application with the real Tauri runtime.
pub fn run() {
    app::configure(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("failed to start the XWork desktop application");
}
