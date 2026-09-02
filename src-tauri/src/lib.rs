pub mod app;
pub mod storage;

/// Starts the XWork desktop application with the real Tauri runtime.
pub fn run() {
    app::configure(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("failed to start the XWork desktop application");
}
