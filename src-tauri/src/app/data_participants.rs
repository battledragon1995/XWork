use rusqlite::Transaction;

use crate::projects::{
    ProjectBackupRecordV1, ProjectCommittedProjection, ProjectImportMap, ProjectImportPlan,
    ProjectService, ProjectsError,
};
use crate::settings::{
    SettingsBackupSection, SettingsCommittedProjection, SettingsError, SettingsRestorePlan,
    SettingsService,
};
use crate::terminal::{
    CliProfilesBackupV1, CliProfilesCommittedProjection, CliProfilesError, CliProfilesImportPlan,
    CliProfilesService,
};

/// Adapts Projects to the typed backup participant contract of `BE-012`.
///
/// The adapter calls only public owner methods, so the Data Management
/// coordinator never reaches the Projects repository, path key, or schema.
pub struct ProjectsDataParticipant {
    service: ProjectService,
}

impl ProjectsDataParticipant {
    /// Creates the Projects participant around the managed project service.
    pub fn new(service: ProjectService) -> Self {
        Self { service }
    }

    /// Exports the Projects section of one consistent coordinator snapshot.
    pub fn export(
        &self,
        tx: &Transaction<'_>,
    ) -> Result<Vec<ProjectBackupRecordV1>, ProjectsError> {
        self.service.export_backup_records_in(tx)
    }

    /// Validates and plans the Projects merge for the coordinator transaction.
    pub fn prepare_import(
        &self,
        tx: &Transaction<'_>,
        records: &[ProjectBackupRecordV1],
    ) -> Result<ProjectImportPlan, ProjectsError> {
        self.service.prepare_backup_merge_in(tx, records)
    }

    /// Applies one already validated Projects plan without a nested transaction.
    pub fn apply_import(
        &self,
        tx: &Transaction<'_>,
        plan: &ProjectImportPlan,
    ) -> Result<ProjectCommittedProjection, ProjectsError> {
        self.service.apply_backup_merge_in(tx, plan)
    }

    /// Clears Projects inside the shared coordinator reset transaction.
    pub fn apply_reset(
        &self,
        tx: &Transaction<'_>,
    ) -> Result<ProjectCommittedProjection, ProjectsError> {
        self.service.reset_projects_in(tx)
    }

    /// Publishes exactly one already prepared owner projection after commit.
    pub fn publish_after_commit(&self, committed: ProjectCommittedProjection) {
        self.service.publish_data_change(committed);
    }

    /// Resolves one source project link for a later Notes or Events adapter.
    ///
    /// A source identifier outside the import snapshot returns `None` so the
    /// calling adapter can apply its nullable unlink semantics.
    pub fn resolve_project_link<'a>(
        import_map: &'a ProjectImportMap,
        source_project_id: &str,
    ) -> Option<&'a str> {
        import_map.resolve(source_project_id)
    }
}

/// Adapts Settings to the typed backup participant contract of `BE-012`.
pub struct SettingsDataParticipant {
    service: SettingsService,
}

impl SettingsDataParticipant {
    /// Creates the Settings participant around the managed settings service.
    pub fn new(service: SettingsService) -> Self {
        Self { service }
    }

    /// Exports persisted Settings inside the coordinator-owned transaction.
    pub fn export(&self, tx: &Transaction<'_>) -> Result<SettingsBackupSection, SettingsError> {
        SettingsService::export_persisted_settings_in(tx)
    }

    /// Validates incoming Settings and builds an owned restore plan.
    pub fn prepare_restore(
        &self,
        tx: &Transaction<'_>,
        incoming: &SettingsBackupSection,
    ) -> Result<SettingsRestorePlan, SettingsError> {
        SettingsService::prepare_settings_restore_in(tx, incoming)
    }

    /// Applies one prepared Settings restore without a nested transaction.
    pub fn apply_restore(
        &self,
        tx: &Transaction<'_>,
        plan: &SettingsRestorePlan,
    ) -> Result<SettingsCommittedProjection, SettingsError> {
        SettingsService::apply_settings_restore_in(tx, plan)
    }

    /// Resets persisted Settings inside the shared coordinator transaction.
    pub fn apply_reset(
        &self,
        tx: &Transaction<'_>,
    ) -> Result<SettingsCommittedProjection, SettingsError> {
        SettingsService::reset_settings_in(tx)
    }

    /// Publishes one already committed Settings projection to the owner cache.
    pub fn publish_after_commit(&self, committed: SettingsCommittedProjection) {
        self.service.publish_data_change(committed);
    }
}

/// Adapts CLI Profiles to the typed backup participant contract of `BE-012`.
///
/// The adapter calls only public owner methods, so the Data Management
/// coordinator never reaches the CLI profile tables, cache, or credentials.
pub struct CliProfilesDataParticipant {
    service: CliProfilesService,
}

impl CliProfilesDataParticipant {
    /// Creates the participant around the managed CLI profiles service.
    pub fn new(service: CliProfilesService) -> Self {
        Self { service }
    }

    /// Exports profile metadata and secret references inside one transaction.
    pub fn export(&self, tx: &Transaction<'_>) -> Result<CliProfilesBackupV1, CliProfilesError> {
        self.service.export_cli_profiles_in(tx)
    }

    /// Validates incoming profiles and builds an owned merge plan.
    pub fn prepare_import(
        &self,
        tx: &Transaction<'_>,
        incoming: &CliProfilesBackupV1,
    ) -> Result<CliProfilesImportPlan, CliProfilesError> {
        self.service.prepare_cli_profiles_merge_in(tx, incoming)
    }

    /// Applies one already validated merge without a nested transaction.
    pub fn apply_import(
        &self,
        tx: &Transaction<'_>,
        plan: &CliProfilesImportPlan,
    ) -> Result<CliProfilesCommittedProjection, CliProfilesError> {
        self.service.apply_cli_profiles_merge_in(tx, plan)
    }

    /// Clears custom profiles inside the shared coordinator reset transaction.
    pub fn apply_reset(
        &self,
        tx: &Transaction<'_>,
    ) -> Result<CliProfilesCommittedProjection, CliProfilesError> {
        self.service.reset_cli_profiles_in(tx)
    }

    /// Publishes exactly one already prepared owner projection after commit.
    pub fn publish_after_commit(&self, committed: CliProfilesCommittedProjection) {
        self.service.publish_data_change(committed);
    }

    /// Retries queued credential deletion after the coordinator released its permit.
    pub async fn retry_credential_cleanup(&self) -> Result<(), CliProfilesError> {
        self.service.retry_credential_cleanup().await
    }
}
