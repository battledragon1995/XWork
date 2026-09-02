#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Delegates process startup to the desktop library entry point.
fn main() {
    xwork_lib::run();
}
