use rusqlite::Transaction;

use crate::storage::{Storage, StorageError};

use super::{
    FilesError,
    models::{MAX_RELATIVE_PATH_BYTES, RecentFilesResetPlan, RecentFilesResetProjection},
};

/// Stores one durable recent-file row without source content.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RecentFileRow {
    pub project_id: String,
    pub relative_path: String,
    pub opened_at_ms: i64,
}

/// Owns bounded recent-file persistence through shared application storage.
#[derive(Clone)]
pub(crate) struct RecentFilesRepository {
    storage: Storage,
}

impl RecentFilesRepository {
    /// Creates a repository over the process-wide storage connection.
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    /// Upserts one path with a monotonic project-local timestamp and prunes after 50 rows.
    pub(crate) fn record(
        &self,
        project_id: &str,
        relative_path: &str,
        now_ms: i64,
    ) -> Result<(), FilesError> {
        if now_ms < 0 || relative_path.is_empty() || relative_path.len() > MAX_RELATIVE_PATH_BYTES {
            return Err(FilesError::RecentFilesFailed);
        }
        let path_key = path_key(relative_path);
        self.storage.with_transaction(|tx| {
            let maximum: Option<i64> = tx.query_row(
                "SELECT MAX(opened_at_ms) FROM recent_files WHERE project_id = ?1",
                [project_id], |row| row.get(0),
            ).map_err(|_| FilesError::RecentFilesFailed)?;
            let next = match maximum {
                Some(value) => now_ms.max(value.checked_add(1).ok_or(FilesError::RecentFilesFailed)?),
                None => now_ms,
            };
            tx.execute(
                "INSERT INTO recent_files(project_id,path_key,relative_path,opened_at_ms) VALUES(?1,?2,?3,?4) ON CONFLICT(project_id,path_key) DO UPDATE SET relative_path=excluded.relative_path, opened_at_ms=excluded.opened_at_ms",
                rusqlite::params![project_id, path_key, relative_path, next],
            ).map_err(|_| FilesError::RecentFilesFailed)?;
            tx.execute(
                "DELETE FROM recent_files WHERE project_id=?1 AND path_key IN (SELECT path_key FROM recent_files WHERE project_id=?1 ORDER BY opened_at_ms DESC,path_key ASC LIMIT -1 OFFSET 50)",
                [project_id],
            ).map_err(|_| FilesError::RecentFilesFailed)?;
            Ok(())
        })
    }

    /// Lists one deterministic recent prefix without holding storage during filesystem checks.
    pub(crate) fn list(
        &self,
        project_id: &str,
        limit: u32,
    ) -> Result<Vec<RecentFileRow>, FilesError> {
        self.storage.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT project_id,relative_path,opened_at_ms FROM recent_files WHERE project_id=?1 ORDER BY opened_at_ms DESC,path_key ASC LIMIT ?2"
            ).map_err(|_| FilesError::RecentFilesFailed)?;
            statement.query_map(rusqlite::params![project_id, limit], |row| Ok(RecentFileRow { project_id: row.get(0)?, relative_path: row.get(1)?, opened_at_ms: row.get(2)? }))
                .map_err(|_| FilesError::RecentFilesFailed)?
                .collect::<Result<Vec<_>, _>>().map_err(|_| FilesError::RecentFilesFailed)
        })
    }

    /// Prepares reset counts and sorted affected project identifiers in a caller-owned transaction.
    pub(crate) fn prepare_reset_in(
        &self,
        tx: &Transaction<'_>,
    ) -> Result<RecentFilesResetPlan, FilesError> {
        let count: i64 = tx
            .query_row("SELECT COUNT(*) FROM recent_files", [], |row| row.get(0))
            .map_err(|_| FilesError::RecentFilesFailed)?;
        let removed_count = u32::try_from(count).map_err(|_| FilesError::RecentFilesFailed)?;
        let mut statement = tx
            .prepare("SELECT DISTINCT project_id FROM recent_files ORDER BY project_id ASC")
            .map_err(|_| FilesError::RecentFilesFailed)?;
        let affected_project_ids = statement
            .query_map([], |row| row.get(0))
            .map_err(|_| FilesError::RecentFilesFailed)?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|_| FilesError::RecentFilesFailed)?;
        Ok(RecentFilesResetPlan {
            removed_count,
            affected_project_ids,
        })
    }

    /// Deletes exactly the rows represented by a prepared reset plan.
    pub(crate) fn reset_in(
        &self,
        tx: &Transaction<'_>,
        plan: &RecentFilesResetPlan,
    ) -> Result<RecentFilesResetProjection, FilesError> {
        let removed = tx
            .execute("DELETE FROM recent_files", [])
            .map_err(|_| FilesError::RecentFilesFailed)?;
        if removed != plan.removed_count as usize {
            return Err(FilesError::RecentFilesFailed);
        }
        Ok(RecentFilesResetProjection {
            removed_count: plan.removed_count,
            affected_project_ids: plan.affected_project_ids.clone(),
        })
    }
}

/// Normalizes a relative path for platform-local recent identity.
fn path_key(relative_path: &str) -> String {
    #[cfg(windows)]
    {
        relative_path.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        relative_path.to_owned()
    }
}

impl From<StorageError> for FilesError {
    /// Hides storage details behind the Files recent category.
    fn from(_value: StorageError) -> Self {
        Self::RecentFilesFailed
    }
}
