/// Generates the Tauri build metadata for the desktop crate.
fn main() {
    tauri_build::build();

    // Tauri's test binaries also need ComCtl32 v6 when its default feature is enabled.
    #[cfg(windows)]
    println!(
        "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
    );
}
