use rusqlite::Transaction;

use crate::projects::{
    ProjectBackupRecordV1, ProjectCommittedProjection, ProjectImportMap, ProjectImportPlan,
    ProjectService, ProjectsError,
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
