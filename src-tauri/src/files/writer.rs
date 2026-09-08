use super::{
    FilesError,
    path_policy::{FilePathPolicy, ValidatedFileWriteTarget},
    reader::DiskFingerprint,
};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
};

/// Owns a fully synced sibling temporary file until replacement or cleanup.
pub(crate) struct StagedAtomicWrite {
    pub target: ValidatedFileWriteTarget,
    temporary_path: PathBuf,
    pub digest: blake3::Hash,
}

impl Drop for StagedAtomicWrite {
    /// Removes only the exact sibling created by this operation.
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.temporary_path);
    }
}

/// Allows deterministic staging and commit barriers without exposing paths over IPC.
pub(crate) trait AtomicFileWriter: Send + Sync {
    /// Stages complete exact bytes without changing the target.
    fn stage(
        &self,
        target: ValidatedFileWriteTarget,
        bytes: &[u8],
    ) -> Result<StagedAtomicWrite, FilesError>;
    /// Replaces once and classifies a failed native call by a single target inspection.
    fn commit(&self, staged: &StagedAtomicWrite, base: &DiskFingerprint) -> Result<(), FilesError>;
}

/// Performs same-directory native atomic replacement.
pub(crate) struct NativeAtomicFileWriter;

/// Rejects explicit read-only intent even when the parent permits replacement.
pub(crate) fn writable(target: &ValidatedFileWriteTarget) -> Result<(), FilesError> {
    FilePathPolicy.revalidate_writer_target(target)?;
    let metadata =
        std::fs::metadata(target.absolute_path()).map_err(|_| FilesError::FileNotWritable)?;
    if metadata.permissions().readonly() {
        return Err(FilesError::FileNotWritable);
    }
    Ok(())
}

impl AtomicFileWriter for NativeAtomicFileWriter {
    /// Creates and syncs a unique sibling with the target's supported permissions.
    fn stage(
        &self,
        target: ValidatedFileWriteTarget,
        bytes: &[u8],
    ) -> Result<StagedAtomicWrite, FilesError> {
        stage_with(target, bytes, &NativePlatform)
    }

    /// Calls the native replace exactly once, then inspects once only on failure.
    fn commit(&self, staged: &StagedAtomicWrite, base: &DiskFingerprint) -> Result<(), FilesError> {
        writable(&staged.target)?;
        if !replace(staged) {
            return classify_failed_commit(&NativePlatform, staged, base);
        }
        // Directory durability is best effort after atomic visibility has succeeded.
        if let Some(parent) = staged.target.absolute_path().parent()
            && let Ok(directory) = File::open(parent)
        {
            let _ = directory.sync_all();
        }
        Ok(())
    }
}

/// Selects the native complete-file replacement primitive without retry or ignore flags.
fn replace(staged: &StagedAtomicWrite) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
        let target: Vec<u16> = staged
            .target
            .absolute_path()
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let temporary: Vec<u16> = staged
            .temporary_path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        // Both terminated paths remain live; optional backup and reserved pointers are null.
        unsafe {
            ReplaceFileW(
                target.as_ptr(),
                temporary.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            ) != 0
        }
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(&staged.temporary_path, staged.target.absolute_path()).is_ok()
    }
}

/// Supplies a private platform seam for deterministic failures at each staging step.
trait WritePlatform {
    /// Chooses one new sibling name for this attempt.
    fn temporary_name(&self) -> String {
        format!(".xwork-{}.tmp", uuid::Uuid::new_v4())
    }
    /// Creates one file with the caller's exclusive creation options.
    fn create(&self, options: &OpenOptions, path: &std::path::Path) -> std::io::Result<File> {
        options.open(path)
    }
    /// Writes every staged byte or reports the injected/native failure.
    fn write_all(&self, file: &mut File, bytes: &[u8]) -> std::io::Result<()> {
        file.write_all(bytes)
    }
    /// Flushes buffered writes before the durability boundary.
    fn flush(&self, file: &mut File) -> std::io::Result<()> {
        file.flush()
    }
    /// Syncs the complete file before replacement is permitted.
    fn sync_all(&self, file: &File) -> std::io::Result<()> {
        file.sync_all()
    }
    /// Inspects exactly one target using bounded hashing memory.
    fn inspect(&self, path: &std::path::Path) -> std::io::Result<blake3::Hash> {
        let mut file = File::open(path)?;
        let mut hash = blake3::Hasher::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hash.update(&buffer[..read]);
        }
        Ok(hash.finalize())
    }
}

/// Uses the native filesystem for every staging and inspection operation.
struct NativePlatform;
impl WritePlatform for NativePlatform {}

/// Stages through the same operation sequence under both native and injected I/O.
fn stage_with(
    target: ValidatedFileWriteTarget,
    bytes: &[u8],
    platform: &dyn WritePlatform,
) -> Result<StagedAtomicWrite, FilesError> {
    writable(&target)?;
    let parent = target
        .absolute_path()
        .parent()
        .ok_or(FilesError::FileWriteFailed)?;
    let mut created = None;
    for _ in 0..3 {
        let path = parent.join(platform.temporary_name());
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match platform.create(&options, &path) {
            Ok(file) => {
                created = Some((path, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(FilesError::FileWriteFailed),
        }
    }
    let (temporary_path, mut file) = created.ok_or(FilesError::FileWriteFailed)?;
    let staged = StagedAtomicWrite {
        target,
        temporary_path,
        digest: blake3::hash(bytes),
    };
    platform
        .write_all(&mut file, bytes)
        .map_err(|_| FilesError::FileWriteFailed)?;
    platform
        .flush(&mut file)
        .map_err(|_| FilesError::FileWriteFailed)?;
    #[cfg(unix)]
    {
        let permissions = std::fs::metadata(staged.target.absolute_path())
            .map_err(|_| FilesError::FileNotWritable)?
            .permissions();
        file.set_permissions(permissions)
            .map_err(|_| FilesError::FileWriteFailed)?;
    }
    platform
        .sync_all(&file)
        .map_err(|_| FilesError::FileSyncFailed)?;
    Ok(staged)
}

/// Classifies one failed replace without retrying or exposing any native detail.
fn classify_failed_commit(
    platform: &dyn WritePlatform,
    staged: &StagedAtomicWrite,
    base: &DiskFingerprint,
) -> Result<(), FilesError> {
    match platform.inspect(staged.target.absolute_path()) {
        Ok(digest) if digest == staged.digest => Ok(()),
        Ok(digest) if digest == base.content_digest => Err(FilesError::AtomicReplaceFailed),
        _ => Err(FilesError::AtomicCommitStateUnknown),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::{path_policy::FilePathIntent, reader::FileReader};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Injects exactly one selected I/O failure while retaining real fixture operations.
    struct FaultPlatform {
        failure: &'static str,
        calls: AtomicUsize,
    }
    impl WritePlatform for FaultPlatform {
        /// Forces a fixed collision name when collision coverage is selected.
        fn temporary_name(&self) -> String {
            if self.failure == "collision" {
                "collision.tmp".into()
            } else {
                NativePlatform.temporary_name()
            }
        }
        /// Counts exclusive create attempts and optionally denies creation.
        fn create(&self, options: &OpenOptions, path: &std::path::Path) -> std::io::Result<File> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.failure == "create" {
                return Err(std::io::ErrorKind::PermissionDenied.into());
            }
            options.open(path)
        }
        /// Simulates a partial write before returning a write failure.
        fn write_all(&self, file: &mut File, bytes: &[u8]) -> std::io::Result<()> {
            if self.failure == "write" {
                file.write_all(&bytes[..1])?;
                return Err(std::io::ErrorKind::WriteZero.into());
            }
            file.write_all(bytes)
        }
        /// Injects a flush failure after all staged bytes exist.
        fn flush(&self, file: &mut File) -> std::io::Result<()> {
            if self.failure == "flush" {
                return Err(std::io::ErrorKind::Other.into());
            }
            file.flush()
        }
        /// Injects a sync failure at the durability boundary.
        fn sync_all(&self, file: &File) -> std::io::Result<()> {
            if self.failure == "sync" {
                return Err(std::io::ErrorKind::Other.into());
            }
            file.sync_all()
        }
        /// Counts the one inspection permitted after a failed native replacement.
        fn inspect(&self, path: &std::path::Path) -> std::io::Result<blake3::Hash> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            NativePlatform.inspect(path)
        }
    }

    /// Creates a validated writer target in a test-owned directory.
    fn target(root: &std::path::Path) -> ValidatedFileWriteTarget {
        FilePathPolicy
            .resolve_writer_target(root, "a.md", &FilePathPolicy.identify_root(root).unwrap())
            .unwrap()
    }

    /// Confirms every failed staging step preserves old bytes and removes its exact temp.
    #[test]
    fn staged_failures_preserve_target_and_cleanup() {
        for failure in ["create", "write", "flush", "sync", "collision"] {
            let root = tempfile::tempdir().unwrap();
            std::fs::write(root.path().join("a.md"), b"old").unwrap();
            if failure == "collision" {
                std::fs::write(root.path().join("collision.tmp"), b"user").unwrap();
            }
            let platform = FaultPlatform {
                failure,
                calls: AtomicUsize::new(0),
            };
            let error = stage_with(target(root.path()), b"complete new content", &platform)
                .err()
                .unwrap();
            assert_eq!(
                error,
                if failure == "sync" {
                    FilesError::FileSyncFailed
                } else {
                    FilesError::FileWriteFailed
                }
            );
            assert_eq!(std::fs::read(root.path().join("a.md")).unwrap(), b"old");
            assert_eq!(
                std::fs::read_dir(root.path()).unwrap().count(),
                if failure == "collision" { 2 } else { 1 }
            );
            if failure == "collision" {
                assert_eq!(platform.calls.load(Ordering::SeqCst), 3);
                assert_eq!(
                    std::fs::read(root.path().join("collision.tmp")).unwrap(),
                    b"user"
                );
            }
        }
    }

    /// Verifies failed commit classification inspects once for base, staged, other and missing states.
    #[test]
    fn failed_commit_is_inspected_once_without_retry() {
        for (bytes, expected) in [
            (
                Some(b"old".as_slice()),
                Err(FilesError::AtomicReplaceFailed),
            ),
            (Some(b"new".as_slice()), Ok(())),
            (
                Some(b"third".as_slice()),
                Err(FilesError::AtomicCommitStateUnknown),
            ),
            (None, Err(FilesError::AtomicCommitStateUnknown)),
        ] {
            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("a.md");
            std::fs::write(&path, b"old").unwrap();
            let read = FilePathPolicy
                .resolve(root.path(), "a.md", None, FilePathIntent::OpenVisibleFile)
                .unwrap();
            let base = FileReader
                .read(FilePathPolicy, &read, 1)
                .unwrap()
                .fingerprint;
            let staged = NativeAtomicFileWriter
                .stage(target(root.path()), b"new")
                .unwrap();
            assert_eq!(std::fs::read(&staged.temporary_path).unwrap(), b"new");
            match bytes {
                Some(bytes) => std::fs::write(&path, bytes).unwrap(),
                None => std::fs::remove_file(&path).unwrap(),
            }
            let platform = FaultPlatform {
                failure: "inspect",
                calls: AtomicUsize::new(0),
            };
            assert_eq!(classify_failed_commit(&platform, &staged, &base), expected);
            assert_eq!(platform.calls.load(Ordering::SeqCst), 1);
        }
    }

    /// Exercises actual native replacement while concurrent readers see only complete versions.
    #[test]
    fn native_replace_is_atomic_for_readers() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("a.md");
        let old = vec![b'a'; 128 * 1024];
        let new = vec![b'b'; 128 * 1024];
        std::fs::write(&path, &old).unwrap();
        let read = FilePathPolicy
            .resolve(root.path(), "a.md", None, FilePathIntent::OpenVisibleFile)
            .unwrap();
        let base = FileReader
            .read(FilePathPolicy, &read, 1)
            .unwrap()
            .fingerprint;
        let staged = NativeAtomicFileWriter
            .stage(target(root.path()), &new)
            .unwrap();
        let reader_path = path.clone();
        let ready = std::sync::Arc::new(std::sync::Barrier::new(2));
        let worker_ready = ready.clone();
        let reader = std::thread::spawn(move || {
            worker_ready.wait();
            for _ in 0..200 {
                let bytes = match std::fs::read(&reader_path) {
                    Ok(bytes) => bytes,
                    Err(error)
                        if error.raw_os_error() == Some(32)
                            || matches!(
                                error.kind(),
                                std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
                            ) =>
                    {
                        continue;
                    }
                    Err(error) => panic!("unexpected reader failure: {error}"),
                };
                assert!(bytes == vec![b'a'; 128 * 1024] || bytes == vec![b'b'; 128 * 1024]);
            }
        });
        ready.wait();
        NativeAtomicFileWriter.commit(&staged, &base).unwrap();
        reader.join().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), new);
    }

    /// Confirms a Windows exclusive target lock causes a definite failed replace without data loss.
    #[cfg(windows)]
    #[test]
    fn windows_locked_target_preserves_original() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("a.md");
        std::fs::write(&path, b"old").unwrap();
        let read = FilePathPolicy
            .resolve(root.path(), "a.md", None, FilePathIntent::OpenVisibleFile)
            .unwrap();
        let base = FileReader
            .read(FilePathPolicy, &read, 1)
            .unwrap()
            .fingerprint;
        let staged = NativeAtomicFileWriter
            .stage(target(root.path()), b"new")
            .unwrap();
        // Share read/write but deny deletion, allowing the required failed-commit inspection.
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&path)
            .unwrap();
        assert_eq!(
            NativeAtomicFileWriter.commit(&staged, &base),
            Err(FilesError::AtomicReplaceFailed)
        );
        drop(lock);
        drop(staged);
        assert_eq!(std::fs::read(&path).unwrap(), b"old");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
