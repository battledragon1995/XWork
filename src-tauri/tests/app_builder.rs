/// Verifies that the public composition root builds with Tauri's mock runtime.
#[test]
fn composition_root_builds_with_mock_runtime() {
    let _app = xwork_lib::app::configure(tauri::test::mock_builder())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the configured mock application should build");
}
