use std::{
    future::Future,
    io::{Read, Write},
    path::{Path, PathBuf},
    pin::Pin,
};

use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::settings::DataManagementError;

/// Caps every backup file at 128 MiB.
pub const MAX_BACKUP_BYTES: usize = 128 * 1024 * 1024;

/// Boxes native data-operation futures for injectable platform implementations.
pub type DataPlatformFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Owns native picker, file, opener, and clipboard operations for Data Management.
pub trait DataPlatform: Send + Sync {
    /// Opens the native import picker and returns its Rust-only path.
    fn pick_import<'a>(
        &'a self,
    ) -> DataPlatformFuture<'a, Result<Option<PathBuf>, DataManagementError>>;
    /// Opens the native export picker and returns its Rust-only path.
    fn pick_export<'a>(
        &'a self,
        suggested_name: &'a str,
    ) -> DataPlatformFuture<'a, Result<Option<PathBuf>, DataManagementError>>;
    /// Reads one picker-selected regular file with the backup cap.
    fn read_backup<'a>(
        &'a self,
        path: &'a Path,
    ) -> DataPlatformFuture<'a, Result<Vec<u8>, DataManagementError>>;
    /// Replaces one picker-selected destination atomically.
    fn write_backup<'a>(
        &'a self,
        path: &'a Path,
        bytes: &'a [u8],
    ) -> DataPlatformFuture<'a, Result<(), DataManagementError>>;
    /// Ensures and returns the one configured application data directory.
    fn data_location<'a>(&'a self) -> DataPlatformFuture<'a, Result<PathBuf, DataManagementError>>;
    /// Opens the configured application data directory.
    fn open_data_location<'a>(&'a self) -> DataPlatformFuture<'a, Result<(), DataManagementError>>;
    /// Copies the configured application data directory path.
    fn copy_data_location<'a>(&'a self) -> DataPlatformFuture<'a, Result<(), DataManagementError>>;
}

/// Implements Data Management native operations through Tauri and the filesystem.
pub struct TauriDataPlatform<R: Runtime> {
    app: AppHandle<R>,
    app_data_dir: PathBuf,
}

impl<R: Runtime> TauriDataPlatform<R> {
    /// Creates the production adapter for one resolved app-data directory.
    pub fn new(app: AppHandle<R>, app_data_dir: PathBuf) -> Self {
        Self { app, app_data_dir }
    }
}

impl<R: Runtime> DataPlatform for TauriDataPlatform<R> {
    /// Opens a single-file picker with an advisory XWork backup filter.
    fn pick_import<'a>(
        &'a self,
    ) -> DataPlatformFuture<'a, Result<Option<PathBuf>, DataManagementError>> {
        Box::pin(async move {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            self.app
                .dialog()
                .file()
                .add_filter("XWork Backup", &["json"])
                .pick_file(move |selection| {
                    let _ = sender.send(selection);
                });
            receiver
                .await
                .map_err(|_| DataManagementError::FileReadFailed)?
                .map(|path| {
                    path.into_path()
                        .map_err(|_| DataManagementError::FileReadFailed)
                })
                .transpose()
        })
    }

    /// Opens a save picker without exposing the selected path to the webview.
    fn pick_export<'a>(
        &'a self,
        suggested_name: &'a str,
    ) -> DataPlatformFuture<'a, Result<Option<PathBuf>, DataManagementError>> {
        Box::pin(async move {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            self.app
                .dialog()
                .file()
                .set_file_name(suggested_name)
                .add_filter("XWork Backup", &["json"])
                .save_file(move |selection| {
                    let _ = sender.send(selection);
                });
            receiver
                .await
                .map_err(|_| DataManagementError::FileWriteFailed)?
                .map(|path| {
                    path.into_path()
                        .map_err(|_| DataManagementError::FileWriteFailed)
                })
                .transpose()
        })
    }

    /// Reads from one opened handle and rejects non-files or growth past the cap.
    fn read_backup<'a>(
        &'a self,
        path: &'a Path,
    ) -> DataPlatformFuture<'a, Result<Vec<u8>, DataManagementError>> {
        let path = path.to_path_buf();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || read_bounded(&path))
                .await
                .map_err(|_| DataManagementError::FileReadFailed)?
        })
    }

    /// Writes and synchronizes a sibling temp file before atomic replacement.
    fn write_backup<'a>(
        &'a self,
        path: &'a Path,
        bytes: &'a [u8],
    ) -> DataPlatformFuture<'a, Result<(), DataManagementError>> {
        let path = path.to_path_buf();
        let bytes = bytes.to_vec();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || write_atomic(&path, &bytes))
                .await
                .map_err(|_| DataManagementError::FileWriteFailed)?
        })
    }

    /// Creates the configured location before returning it.
    fn data_location<'a>(&'a self) -> DataPlatformFuture<'a, Result<PathBuf, DataManagementError>> {
        let path = self.app_data_dir.clone();
        Box::pin(async move {
            tauri::async_runtime::spawn_blocking(move || {
                std::fs::create_dir_all(&path)
                    .map_err(|_| DataManagementError::DataLocationUnavailable)?;
                Ok(path)
            })
            .await
            .map_err(|_| DataManagementError::DataLocationUnavailable)?
        })
    }

    /// Opens only the configured location through the official opener plugin.
    fn open_data_location<'a>(&'a self) -> DataPlatformFuture<'a, Result<(), DataManagementError>> {
        Box::pin(async move {
            let path = self.data_location().await?;
            let path = path
                .to_str()
                .ok_or(DataManagementError::OpenLocationFailed)?;
            self.app
                .opener()
                .open_path(path.to_owned(), None::<&str>)
                .map_err(|_| DataManagementError::OpenLocationFailed)
        })
    }

    /// Copies only the configured location through the official clipboard plugin.
    fn copy_data_location<'a>(&'a self) -> DataPlatformFuture<'a, Result<(), DataManagementError>> {
        Box::pin(async move {
            let path = self.data_location().await?;
            let path = path
                .to_str()
                .ok_or(DataManagementError::ClipboardWriteFailed)?;
            self.app
                .clipboard()
                .write_text(path.to_owned())
                .map_err(|_| DataManagementError::ClipboardWriteFailed)
        })
    }
}

/// Reads one regular file without trusting stale path metadata.
fn read_bounded(path: &Path) -> Result<Vec<u8>, DataManagementError> {
    let file = std::fs::File::open(path).map_err(|_| DataManagementError::FileReadFailed)?;
    if !file
        .metadata()
        .map_err(|_| DataManagementError::FileReadFailed)?
        .is_file()
    {
        return Err(DataManagementError::FileReadFailed);
    }
    let mut bytes = Vec::new();
    file.take((MAX_BACKUP_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| DataManagementError::FileReadFailed)?;
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err(DataManagementError::BackupTooLarge);
    }
    Ok(bytes)
}

/// Installs bytes from an operation-owned sibling temp file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), DataManagementError> {
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err(DataManagementError::BackupTooLarge);
    }
    let parent = path.parent().ok_or(DataManagementError::FileWriteFailed)?;
    let temp = parent.join(format!(".xwork-backup-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| DataManagementError::FileWriteFailed)?;
        file.write_all(bytes)
            .map_err(|_| DataManagementError::FileWriteFailed)?;
        file.flush()
            .map_err(|_| DataManagementError::FileWriteFailed)?;
        file.sync_all()
            .map_err(|_| DataManagementError::FileWriteFailed)?;
        drop(file);
        replace_file(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Replaces a destination atomically on the current desktop platform.
#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), DataManagementError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Windows performs the replacement without first deleting the previous destination.
    let ok = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(DataManagementError::FileWriteFailed)
    } else {
        Ok(())
    }
}

/// Renames the synchronized temp file atomically on non-Windows desktop targets.
#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), DataManagementError> {
    std::fs::rename(source, destination).map_err(|_| DataManagementError::FileWriteFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies over-limit reads fail without allocating unbounded input.
    #[test]
    fn bounded_read_rejects_oversized_files() {
        let directory = tempfile::TempDir::new().expect("temp directory should exist");
        let path = directory.path().join("large.json");
        let file = std::fs::File::create(&path).expect("fixture file should open");
        file.set_len((MAX_BACKUP_BYTES + 1) as u64)
            .expect("fixture should resize");
        assert_eq!(
            read_bounded(&path),
            Err(DataManagementError::BackupTooLarge)
        );
    }

    /// Verifies successful replacement changes an existing destination completely.
    #[test]
    fn atomic_write_replaces_existing_bytes() {
        let directory = tempfile::TempDir::new().expect("temp directory should exist");
        let path = directory.path().join("backup.json");
        std::fs::write(&path, b"old").expect("fixture should write");
        write_atomic(&path, b"new").expect("replacement should succeed");
        assert_eq!(std::fs::read(path).expect("result should read"), b"new");
    }
}
