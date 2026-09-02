use std::{fs, path::PathBuf};

use ts_rs::{Config, TS};
use xwork_lib::app::lifecycle::{
    AppLifecycleError, LifecycleEvent, QuitRequestDto, QuitSummaryDto, SessionNavigationDto,
    TrayOperation, WindowOperation,
};

/// Generates the complete lifecycle binding in its stable contract order.
fn generated_binding() -> String {
    let config = Config::default();
    [
        QuitSummaryDto::export_to_string(&config).expect("QuitSummaryDto should export"),
        QuitRequestDto::export_to_string(&config).expect("QuitRequestDto should export"),
        SessionNavigationDto::export_to_string(&config)
            .expect("SessionNavigationDto should export"),
        WindowOperation::export_to_string(&config).expect("WindowOperation should export"),
        TrayOperation::export_to_string(&config).expect("TrayOperation should export"),
        LifecycleEvent::export_to_string(&config).expect("LifecycleEvent should export"),
        AppLifecycleError::export_to_string(&config).expect("AppLifecycleError should export"),
    ]
    .join("\n")
}

/// Returns the only generated lifecycle binding output path.
fn binding_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("bindings")
        .join("app-lifecycle.ts")
}

/// Regenerates the binding and fails once whenever committed output is stale.
#[test]
fn lifecycle_binding_matches_rust_contract() {
    let path = binding_path();
    let generated = generated_binding();
    let current = fs::read_to_string(&path).ok();

    if current.as_deref() != Some(generated.as_str()) {
        fs::create_dir_all(
            path.parent()
                .expect("the binding path should have a parent"),
        )
        .expect("the binding directory should be created");
        fs::write(&path, generated).expect("the generated binding should be written");
        panic!("bindings were regenerated; rerun the test to verify a clean output");
    }
}
