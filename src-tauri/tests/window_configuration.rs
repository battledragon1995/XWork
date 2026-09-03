use serde_json::Value;

/// Verifies that a fresh main window opens at the application wireframe size.
#[test]
fn main_window_opens_at_the_designed_size() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("the Tauri configuration should be valid JSON");
    let main_window = &config["app"]["windows"][0];

    assert_eq!(main_window["label"], "main");
    assert_eq!(main_window["width"], 1280);
    assert_eq!(main_window["height"], 800);
}
