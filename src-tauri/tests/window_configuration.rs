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

/// Keeps the floating renderer lazy and scoped to custom caller-authorized commands.
#[test]
fn quick_note_has_empty_capability_and_no_static_renderer() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["app"]["windows"].as_array().unwrap().len(), 1);
    assert_eq!(
        config["app"]["security"]["capabilities"],
        serde_json::json!(["main", "quick-note"])
    );
    let capability: Value =
        serde_json::from_str(include_str!("../capabilities/quick-note.json")).unwrap();
    assert_eq!(capability["identifier"], "quick-note");
    assert_eq!(capability["windows"], serde_json::json!(["quick-note"]));
    assert_eq!(capability["permissions"], serde_json::json!([]));
}
