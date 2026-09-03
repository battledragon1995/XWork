use std::{fs, path::PathBuf};

use ts_rs::{Config, TS};
use xwork_lib::app::lifecycle::{
    AppLifecycleError, LifecycleEvent, QuitRequestDto, QuitSummaryDto, SessionNavigationDto,
    TrayOperation, WindowOperation,
};
use xwork_lib::projects::{
    GitFileChangeDto, GitFileChangeKindDto, GitHeadDto, GitRepositoryKindDto,
    InvalidProjectFolderReasonDto, ProjectAvailabilityDto, ProjectChangeKindDto,
    ProjectChangedEventDto, ProjectDto, ProjectFolderSelectionDto, ProjectGitStatusDto,
    ProjectGitSummaryDto, ProjectUnavailableReasonDto, ProjectsError, RemoveProjectImpactDto,
    RemoveProjectResultDto,
};
use xwork_lib::settings::{
    AppSettingsDto, AppearanceSettingsDto, AppearanceSettingsPatchDto, GeneralSettingsDto,
    InterfaceColorsDto, InterfaceLanguageDto, InterfaceThemeColorsDto, SettingsError,
    SidebarSettingsDto, SidebarSettingsPatchDto, TerminalPaletteDto, ThemeModeDto, ThemePresetDto,
    UpdateSettingsDto,
};

/// Generates the complete lifecycle binding in its stable contract order.
fn generated_lifecycle_binding() -> String {
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

/// Generates the complete Projects binding in its stable contract order.
fn generated_projects_binding() -> String {
    let config = Config::default();
    [
        ProjectUnavailableReasonDto::export_to_string(&config)
            .expect("ProjectUnavailableReasonDto should export"),
        ProjectAvailabilityDto::export_to_string(&config)
            .expect("ProjectAvailabilityDto should export"),
        ProjectDto::export_to_string(&config).expect("ProjectDto should export"),
        ProjectFolderSelectionDto::export_to_string(&config)
            .expect("ProjectFolderSelectionDto should export"),
        GitRepositoryKindDto::export_to_string(&config)
            .expect("GitRepositoryKindDto should export"),
        GitHeadDto::export_to_string(&config).expect("GitHeadDto should export"),
        GitFileChangeKindDto::export_to_string(&config)
            .expect("GitFileChangeKindDto should export"),
        GitFileChangeDto::export_to_string(&config).expect("GitFileChangeDto should export"),
        ProjectGitSummaryDto::export_to_string(&config)
            .expect("ProjectGitSummaryDto should export"),
        ProjectGitStatusDto::export_to_string(&config).expect("ProjectGitStatusDto should export"),
        RemoveProjectImpactDto::export_to_string(&config)
            .expect("RemoveProjectImpactDto should export"),
        RemoveProjectResultDto::export_to_string(&config)
            .expect("RemoveProjectResultDto should export"),
        ProjectChangeKindDto::export_to_string(&config)
            .expect("ProjectChangeKindDto should export"),
        ProjectChangedEventDto::export_to_string(&config)
            .expect("ProjectChangedEventDto should export"),
        InvalidProjectFolderReasonDto::export_to_string(&config)
            .expect("InvalidProjectFolderReasonDto should export"),
        ProjectsError::export_to_string(&config).expect("ProjectsError should export"),
    ]
    .join("\n")
}

/// Generates the complete Phase 1 Settings binding in stable contract order.
fn generated_settings_binding() -> String {
    let config = Config::default();
    [
        InterfaceLanguageDto::export_to_string(&config)
            .expect("InterfaceLanguageDto should export"),
        ThemeModeDto::export_to_string(&config).expect("ThemeModeDto should export"),
        ThemePresetDto::export_to_string(&config).expect("ThemePresetDto should export"),
        InterfaceColorsDto::export_to_string(&config).expect("InterfaceColorsDto should export"),
        InterfaceThemeColorsDto::export_to_string(&config)
            .expect("InterfaceThemeColorsDto should export"),
        TerminalPaletteDto::export_to_string(&config).expect("TerminalPaletteDto should export"),
        GeneralSettingsDto::export_to_string(&config).expect("GeneralSettingsDto should export"),
        AppearanceSettingsDto::export_to_string(&config)
            .expect("AppearanceSettingsDto should export"),
        SidebarSettingsDto::export_to_string(&config).expect("SidebarSettingsDto should export"),
        AppSettingsDto::export_to_string(&config).expect("AppSettingsDto should export"),
        AppearanceSettingsPatchDto::export_to_string(&config)
            .expect("AppearanceSettingsPatchDto should export"),
        SidebarSettingsPatchDto::export_to_string(&config)
            .expect("SidebarSettingsPatchDto should export"),
        UpdateSettingsDto::export_to_string(&config).expect("UpdateSettingsDto should export"),
        SettingsError::export_to_string(&config).expect("SettingsError should export"),
    ]
    .join("\n")
}

/// Returns one generated binding output path under the frontend bindings root.
fn binding_path(relative: &[&str]) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("bindings");
    for segment in relative {
        path = path.join(segment);
    }
    path
}

/// Rewrites stale generated output once and fails so the next run verifies it.
fn assert_binding_is_current(path: PathBuf, generated: String) {
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

/// Regenerates the binding and fails once whenever committed output is stale.
#[test]
fn lifecycle_binding_matches_rust_contract() {
    assert_binding_is_current(
        binding_path(&["app-lifecycle.ts"]),
        generated_lifecycle_binding(),
    );
}

/// Regenerates the Projects binding and fails once whenever it is stale.
#[test]
fn projects_binding_matches_rust_contract() {
    assert_binding_is_current(
        binding_path(&["projects", "projects.ts"]),
        generated_projects_binding(),
    );
}

/// Regenerates the Settings binding and fails once whenever it is stale.
#[test]
fn settings_binding_matches_rust_contract() {
    assert_binding_is_current(binding_path(&["settings.ts"]), generated_settings_binding());
}
