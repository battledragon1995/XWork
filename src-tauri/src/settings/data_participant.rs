use crate::app::data_participants::{
    CliProfilesDataParticipant, KeyboardShortcutsDataParticipant, ProjectsDataParticipant,
    SettingsDataParticipant,
};
use crate::files::RecentFilesResetProjection;
use crate::notifications::{NotificationCommittedProjection, NotificationService};
use crate::projects::{ProjectCommittedProjection, ProjectImportPlan};
use crate::settings::{
    KeyboardShortcutsCommittedProjection, SettingsCommittedProjection, ShortcutOverridesImportPlan,
};
use crate::terminal::{CliProfilesCommittedProjection, CliProfilesImportPlan};

/// Holds the concrete Phase 1 owner adapters in dependency order.
#[derive(Clone)]
pub struct DataParticipants {
    pub projects: ProjectsDataParticipant,
    pub settings: SettingsDataParticipant,
    pub cli_profiles: CliProfilesDataParticipant,
    pub keyboard_shortcuts: KeyboardShortcutsDataParticipant,
    pub notifications: NotificationService,
}

/// Owns every validated Phase 1 import plan until one transaction applies it.
pub struct PreparedImportPlans {
    pub projects: ProjectImportPlan,
    pub settings: crate::settings::SettingsRestorePlan,
    pub cli_profiles: CliProfilesImportPlan,
    pub keyboard_shortcuts: ShortcutOverridesImportPlan,
}

/// Owns every projection that becomes publishable after an import commit.
pub struct ImportCommittedProjections {
    pub projects: ProjectCommittedProjection,
    pub settings: SettingsCommittedProjection,
    pub cli_profiles: CliProfilesCommittedProjection,
    pub keyboard_shortcuts: KeyboardShortcutsCommittedProjection,
}

/// Owns every projection that becomes publishable after a reset commit.
pub struct ResetCommittedProjections {
    pub projects: ProjectCommittedProjection,
    pub settings: SettingsCommittedProjection,
    pub cli_profiles: CliProfilesCommittedProjection,
    pub keyboard_shortcuts: KeyboardShortcutsCommittedProjection,
    pub notifications: NotificationCommittedProjection,
    pub recent_files: Option<RecentFilesResetProjection>,
}
