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
use xwork_lib::sessions::{
    CloseImpactDto, CloseResultDto, CloseTargetDto, PaneContentDto, PaneDto, PaneLayoutNodeDto,
    SessionChangeKindDto, SessionDetailDto, SessionRuntimeEventDto, SessionStatusDto,
    SessionSummaryDto, SessionsError, SplitAxisDto, SplitDirectionDto, TabDto,
};
use xwork_lib::settings::{
    AppSettingsDto, AppearanceSettingsDto, AppearanceSettingsPatchDto, GeneralSettingsDto,
    InterfaceColorsDto, InterfaceLanguageDto, InterfaceThemeColorsDto, SettingsError,
    SidebarSettingsDto, SidebarSettingsPatchDto, TerminalPaletteDto, ThemeModeDto, ThemePresetDto,
    UpdateSettingsDto,
};
use xwork_lib::terminal::{
    CliProfileAvailabilityDto, CliProfileAvailabilityStatusDto, CliProfileDto,
    CliProfileEnvironmentDto, CliProfileEnvironmentInputDto, CliProfileInputDto, CliProfileKindDto,
    CliProfilesChangeKindDto, CliProfilesChangedDto, CliProfilesError, CliProfilesSnapshotDto,
    CliShellDto, PtySizeDto, TerminalDto, TerminalError, TerminalInputAckDto,
    TerminalProcessStateDto, TerminalProfileUnavailableReasonDto, TerminalResizeAckDto,
    TerminalStateChangeKindDto, TerminalStateChangedDto, TerminalSubscriptionDto,
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

/// Generates the complete CLI profiles binding in stable contract order.
fn generated_cli_profiles_binding() -> String {
    let config = Config::default();
    [
        CliProfileKindDto::export_to_string(&config).expect("CliProfileKindDto should export"),
        CliProfileAvailabilityStatusDto::export_to_string(&config)
            .expect("CliProfileAvailabilityStatusDto should export"),
        CliProfileAvailabilityDto::export_to_string(&config)
            .expect("CliProfileAvailabilityDto should export"),
        CliProfileEnvironmentDto::export_to_string(&config)
            .expect("CliProfileEnvironmentDto should export"),
        CliProfileEnvironmentInputDto::export_to_string(&config)
            .expect("CliProfileEnvironmentInputDto should export"),
        CliProfileInputDto::export_to_string(&config).expect("CliProfileInputDto should export"),
        CliShellDto::export_to_string(&config).expect("CliShellDto should export"),
        CliProfileDto::export_to_string(&config).expect("CliProfileDto should export"),
        CliProfilesSnapshotDto::export_to_string(&config)
            .expect("CliProfilesSnapshotDto should export"),
        CliProfilesChangeKindDto::export_to_string(&config)
            .expect("CliProfilesChangeKindDto should export"),
        CliProfilesChangedDto::export_to_string(&config)
            .expect("CliProfilesChangedDto should export"),
        CliProfilesError::export_to_string(&config).expect("CliProfilesError should export"),
    ]
    .join("\n")
}

/// Generates the complete Terminal runtime binding in dependency order.
fn generated_terminal_binding() -> String {
    let config = Config::default();
    [
        PtySizeDto::export_to_string(&config).expect("PtySizeDto should export"),
        TerminalProcessStateDto::export_to_string(&config)
            .expect("TerminalProcessStateDto should export"),
        TerminalProfileUnavailableReasonDto::export_to_string(&config)
            .expect("TerminalProfileUnavailableReasonDto should export"),
        TerminalDto::export_to_string(&config).expect("TerminalDto should export"),
        TerminalSubscriptionDto::export_to_string(&config)
            .expect("TerminalSubscriptionDto should export"),
        TerminalInputAckDto::export_to_string(&config).expect("TerminalInputAckDto should export"),
        TerminalResizeAckDto::export_to_string(&config)
            .expect("TerminalResizeAckDto should export"),
        TerminalStateChangeKindDto::export_to_string(&config)
            .expect("TerminalStateChangeKindDto should export"),
        TerminalStateChangedDto::export_to_string(&config)
            .expect("TerminalStateChangedDto should export"),
        TerminalError::export_to_string(&config).expect("TerminalError should export"),
    ]
    .join("\n")
}

/// Generates the complete Sessions binding in stable dependency order.
fn generated_sessions_binding() -> String {
    let config = Config::default();
    [
        SessionStatusDto::export_to_string(&config).expect("SessionStatusDto should export"),
        PaneContentDto::export_to_string(&config).expect("PaneContentDto should export"),
        PaneDto::export_to_string(&config).expect("PaneDto should export"),
        SplitAxisDto::export_to_string(&config).expect("SplitAxisDto should export"),
        PaneLayoutNodeDto::export_to_string(&config).expect("PaneLayoutNodeDto should export"),
        TabDto::export_to_string(&config).expect("TabDto should export"),
        SessionSummaryDto::export_to_string(&config).expect("SessionSummaryDto should export"),
        SessionDetailDto::export_to_string(&config).expect("SessionDetailDto should export"),
        SplitDirectionDto::export_to_string(&config).expect("SplitDirectionDto should export"),
        CloseTargetDto::export_to_string(&config).expect("CloseTargetDto should export"),
        CloseImpactDto::export_to_string(&config).expect("CloseImpactDto should export"),
        CloseResultDto::export_to_string(&config).expect("CloseResultDto should export"),
        SessionChangeKindDto::export_to_string(&config)
            .expect("SessionChangeKindDto should export"),
        SessionRuntimeEventDto::export_to_string(&config)
            .expect("SessionRuntimeEventDto should export"),
        SessionsError::export_to_string(&config).expect("SessionsError should export"),
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

/// Regenerates the CLI profiles binding and fails once whenever it is stale.
#[test]
fn cli_profiles_binding_matches_rust_contract() {
    assert_binding_is_current(
        binding_path(&["terminal", "cli-profiles.ts"]),
        generated_cli_profiles_binding(),
    );
}

/// Regenerates the Terminal runtime binding and fails once whenever stale.
#[test]
fn terminal_binding_matches_rust_contract() {
    let generated = generated_terminal_binding();
    assert!(!generated.contains("Channel"));
    assert!(!generated.contains("ResolvedCliProfile"));
    assert_binding_is_current(binding_path(&["terminal", "terminal.ts"]), generated);
}

/// Regenerates the Sessions binding and fails once whenever it is stale.
#[test]
fn sessions_binding_matches_rust_contract() {
    let generated = generated_sessions_binding();
    assert!(!generated.contains("SessionNotificationContext"));
    assert!(!generated.contains("SessionAttentionSnapshot"));
    assert_binding_is_current(binding_path(&["sessions", "sessions.ts"]), generated);
}
