use std::sync::{Arc, Weak};

use crate::sessions::{CloseRetention, PaneCloseImpact, PaneContentRef, ReopenHandle};

use super::{
    FilesError,
    service::{FilesService, ServiceInner},
};

/// Exposes file lifecycle operations without retaining a Files↔Sessions cycle.
#[derive(Clone)]
pub struct FileHandleManager {
    service: Weak<ServiceInner>,
}

/// Stores the same weak lifecycle delegate for late-bound composition.
#[derive(Clone)]
pub struct FileHandleManagerWeak {
    service: Weak<ServiceInner>,
}

impl FileHandleManager {
    /// Creates a lifecycle delegate for one Files service.
    pub(crate) fn new(service: &Arc<ServiceInner>) -> Self {
        Self {
            service: Arc::downgrade(service),
        }
    }

    /// Creates a weak delegate suitable for the application router.
    pub fn downgrade(&self) -> FileHandleManagerWeak {
        FileHandleManagerWeak {
            service: self.service.clone(),
        }
    }

    /// Reports one unsaved label for a dirty or conflicted handle.
    pub async fn close_impact(&self, file_handle_id: &str) -> Result<PaneCloseImpact, FilesError> {
        self.service()?.close_impact(file_handle_id).await
    }

    /// Closes one handle and optionally retains clean reopen identity.
    pub async fn close_for_session(
        &self,
        file_handle_id: &str,
        retention: CloseRetention,
    ) -> Result<Option<ReopenHandle>, FilesError> {
        self.service()?
            .close_for_session(file_handle_id, retention)
            .await
    }

    /// Revalidates and restores one retained file identity.
    pub async fn reopen_for_session(
        &self,
        handle: ReopenHandle,
    ) -> Result<PaneContentRef, FilesError> {
        self.service()?.reopen_for_session(handle).await
    }

    /// Permanently drops one retained token idempotently.
    pub async fn discard_for_session(&self, handle: ReopenHandle) -> Result<(), FilesError> {
        self.service()?.discard_for_session(handle).await
    }

    /// Upgrades the service for one lifecycle operation.
    fn service(&self) -> Result<FilesService, FilesError> {
        self.service
            .upgrade()
            .map(FilesService::from_inner)
            .ok_or(FilesError::SessionAttachFailed)
    }
}

impl FileHandleManagerWeak {
    /// Upgrades a live Files service lifecycle delegate.
    pub fn upgrade(&self) -> Option<FileHandleManager> {
        self.service
            .upgrade()
            .map(|service| FileHandleManager::new(&service))
    }
}
