use std::path::{Path, PathBuf};

use super::{
    error::FilesError,
    models::{MAX_PATH_COMPONENTS, MAX_RELATIVE_PATH_BYTES},
};

/// Identifies the canonical project root used by one validation operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProjectRootIdentity {
    pub canonical_key: String,
}

/// Selects the invariants required by one filesystem operation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(dead_code)]
pub(crate) enum FilePathIntent {
    ListDirectory,
    ReadVisibleEntry,
    RevealVisibleEntry,
    OpenVisibleFile,
    ExistingHandleFile,
    WriteExistingFile,
}

/// Holds one path validated against a captured project root.
pub(crate) struct ValidatedProjectPath {
    pub root_identity: ProjectRootIdentity,
    pub root: PathBuf,
    pub relative_path: String,
    pub absolute_path: PathBuf,
    pub intent: FilePathIntent,
}

/// Restricts future writes to targets produced by the Files path policy.
#[allow(dead_code)]
pub(crate) struct ValidatedFileWriteTarget(ValidatedProjectPath);

/// Validates project-relative paths without following links or reparse points.
#[derive(Clone, Copy, Default)]
pub(crate) struct FilePathPolicy;

impl FilePathPolicy {
    /// Derives a stable comparison key from a canonical available project root.
    pub(crate) fn identify_root(
        &self,
        canonical_root: &Path,
    ) -> Result<ProjectRootIdentity, FilesError> {
        let canonical =
            std::fs::canonicalize(canonical_root).map_err(|_| FilesError::FileSystemReadFailed)?;
        if !canonical.is_dir() {
            return Err(FilesError::FileSystemReadFailed);
        }
        let key = canonical
            .to_str()
            .ok_or(FilesError::FileSystemReadFailed)?
            .to_owned();
        #[cfg(windows)]
        let key = key.to_lowercase();
        Ok(ProjectRootIdentity { canonical_key: key })
    }

    /// Resolves and validates a path for one explicit operation intent.
    pub(crate) fn resolve(
        &self,
        canonical_root: &Path,
        relative_path: &str,
        expected_root: Option<&ProjectRootIdentity>,
        intent: FilePathIntent,
    ) -> Result<ValidatedProjectPath, FilesError> {
        if intent == FilePathIntent::WriteExistingFile {
            return Err(FilesError::InvalidRelativePath);
        }
        let components =
            validate_relative_path(relative_path, intent == FilePathIntent::ListDirectory)?;
        let root_identity = self.identify_root(canonical_root)?;
        if let Some(expected) = expected_root
            && (intent != FilePathIntent::ExistingHandleFile || expected != &root_identity)
        {
            return Err(FilesError::ProjectRootChanged {
                project_id: String::new(),
            });
        }

        let root_metadata = std::fs::symlink_metadata(canonical_root)
            .map_err(|_| FilesError::FileSystemReadFailed)?;
        let mut absolute = canonical_root.to_path_buf();
        for (index, component) in components.iter().enumerate() {
            absolute.push(component);
            let metadata = match std::fs::symlink_metadata(&absolute) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(FilesError::EntryNotFound {
                        relative_path: relative_path.to_owned(),
                    });
                }
                Err(_) => return Err(FilesError::FileSystemReadFailed),
            };
            let final_component = index + 1 == components.len();
            let link_like = is_link_like(&metadata, &root_metadata);
            // A link-like leaf may be named or copied, but never traversed.
            if link_like && (!final_component || intent != FilePathIntent::ReadVisibleEntry) {
                return Err(FilesError::LinkTraversalDenied {
                    relative_path: relative_path.to_owned(),
                });
            }
            if !final_component && !metadata.is_dir() {
                return Err(FilesError::EntryNotFound {
                    relative_path: relative_path.to_owned(),
                });
            }
        }

        let metadata = std::fs::symlink_metadata(&absolute).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                FilesError::EntryNotFound {
                    relative_path: relative_path.to_owned(),
                }
            } else {
                FilesError::FileSystemReadFailed
            }
        })?;
        match intent {
            FilePathIntent::ListDirectory if !metadata.is_dir() => {
                return Err(FilesError::NotDirectory {
                    relative_path: relative_path.to_owned(),
                });
            }
            FilePathIntent::OpenVisibleFile | FilePathIntent::ExistingHandleFile
                if !metadata.is_file() =>
            {
                return Err(FilesError::EntryNotFound {
                    relative_path: relative_path.to_owned(),
                });
            }
            _ => {}
        }

        Ok(ValidatedProjectPath {
            root_identity,
            root: canonical_root.to_path_buf(),
            relative_path: relative_path.to_owned(),
            absolute_path: absolute,
            intent,
        })
    }

    /// Resolves an existing regular file into a write-only target.
    #[allow(dead_code)]
    pub(crate) fn resolve_writer_target(
        &self,
        canonical_root: &Path,
        relative_path: &str,
        expected_root: &ProjectRootIdentity,
    ) -> Result<ValidatedFileWriteTarget, FilesError> {
        let mut target = self.resolve(
            canonical_root,
            relative_path,
            Some(expected_root),
            FilePathIntent::ExistingHandleFile,
        )?;
        target.intent = FilePathIntent::WriteExistingFile;
        Ok(ValidatedFileWriteTarget(target))
    }

    /// Rechecks a previously validated target immediately before its side effect.
    pub(crate) fn revalidate(&self, target: &ValidatedProjectPath) -> Result<(), FilesError> {
        let expected =
            (target.intent == FilePathIntent::ExistingHandleFile).then_some(&target.root_identity);
        self.resolve(&target.root, &target.relative_path, expected, target.intent)?;
        Ok(())
    }

    /// Rechecks root, containment, regular-file and no-link writer invariants.
    #[allow(dead_code)]
    pub(crate) fn revalidate_writer_target(
        &self,
        target: &ValidatedFileWriteTarget,
    ) -> Result<(), FilesError> {
        self.resolve(
            &target.0.root,
            &target.0.relative_path,
            Some(&target.0.root_identity),
            FilePathIntent::ExistingHandleFile,
        )?;
        Ok(())
    }
}

impl ValidatedFileWriteTarget {
    /// Returns the validated absolute target to the future platform writer.
    #[allow(dead_code)]
    pub(crate) fn absolute_path(&self) -> &Path {
        &self.0.absolute_path
    }

    /// Returns the root identity captured by the path policy.
    #[allow(dead_code)]
    pub(crate) fn root_identity(&self) -> &ProjectRootIdentity {
        &self.0.root_identity
    }
}

/// Parses the strict slash-separated relative-path grammar.
pub(crate) fn validate_relative_path(
    path: &str,
    allow_root: bool,
) -> Result<Vec<&str>, FilesError> {
    if path.is_empty() {
        return allow_root
            .then(Vec::new)
            .ok_or(FilesError::InvalidRelativePath);
    }
    if path.len() > MAX_RELATIVE_PATH_BYTES
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path.chars().any(char::is_control)
    {
        return Err(FilesError::InvalidRelativePath);
    }
    let components = path.split('/').collect::<Vec<_>>();
    if components.len() > MAX_PATH_COMPONENTS
        || components
            .iter()
            .any(|component| component.is_empty() || *component == "." || *component == "..")
    {
        return Err(FilesError::InvalidRelativePath);
    }
    #[cfg(windows)]
    if components.iter().any(|component| {
        component.contains(':')
            || component.ends_with('.')
            || component.ends_with(' ')
            || matches!(
                component
                    .trim_end_matches(['.', ' '])
                    .to_ascii_uppercase()
                    .as_str(),
                "CON"
                    | "PRN"
                    | "AUX"
                    | "NUL"
                    | "COM1"
                    | "COM2"
                    | "COM3"
                    | "COM4"
                    | "COM5"
                    | "COM6"
                    | "COM7"
                    | "COM8"
                    | "COM9"
                    | "LPT1"
                    | "LPT2"
                    | "LPT3"
                    | "LPT4"
                    | "LPT5"
                    | "LPT6"
                    | "LPT7"
                    | "LPT8"
                    | "LPT9"
            )
    }) {
        return Err(FilesError::InvalidRelativePath);
    }
    Ok(components)
}

/// Reports whether metadata represents a link, reparse point, or mount boundary.
pub(crate) fn is_link_like(metadata: &std::fs::Metadata, _root: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        is_windows_reparse(metadata.file_attributes())
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.dev() != _root.dev()
    }
    #[cfg(not(any(windows, unix)))]
    false
}

/// Classifies the Windows reparse attribute without a privileged fixture.
#[cfg(windows)]
fn is_windows_reparse(attributes: u32) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(test)]
mod tests {
    use super::{FilePathIntent, FilePathPolicy, validate_relative_path};
    use crate::files::FilesError;

    /// Verifies strict grammar rejects path normalization and platform escape forms.
    #[test]
    fn relative_path_grammar_is_strict() {
        assert!(validate_relative_path("folder/file.txt", false).is_ok());
        for invalid in [
            "", "/file", "file/", "a//b", ".", "..", "a/../b", "a\\b", "a\0b",
        ] {
            assert_eq!(
                validate_relative_path(invalid, false),
                Err(FilesError::InvalidRelativePath)
            );
        }
        assert!(validate_relative_path("", true).is_ok());

        let exact_bytes = "x".repeat(4_096);
        assert!(validate_relative_path(&exact_bytes, false).is_ok());
        assert_eq!(
            validate_relative_path(&"x".repeat(4_097), false),
            Err(FilesError::InvalidRelativePath)
        );
        let exact_components = std::iter::repeat_n("x", 128).collect::<Vec<_>>().join("/");
        assert!(validate_relative_path(&exact_components, false).is_ok());
        let too_many_components = std::iter::repeat_n("x", 129).collect::<Vec<_>>().join("/");
        assert_eq!(
            validate_relative_path(&too_many_components, false),
            Err(FilesError::InvalidRelativePath)
        );
    }

    /// Verifies intent validation accepts directories and copyable regular files.
    #[test]
    fn policy_resolves_real_entries_under_the_root() {
        let fixture = tempfile::tempdir().expect("the fixture should be created");
        std::fs::create_dir(fixture.path().join("folder")).expect("the folder should be created");
        std::fs::write(fixture.path().join("folder/file.txt"), b"fixture")
            .expect("the file should be created");
        let root = std::fs::canonicalize(fixture.path()).expect("the root should canonicalize");
        let policy = FilePathPolicy;

        assert!(
            policy
                .resolve(&root, "folder", None, FilePathIntent::ListDirectory)
                .is_ok()
        );
        assert!(
            policy
                .resolve(
                    &root,
                    "folder/file.txt",
                    None,
                    FilePathIntent::ReadVisibleEntry
                )
                .is_ok()
        );
        assert!(
            policy
                .resolve(
                    &root,
                    "folder/file.txt",
                    None,
                    FilePathIntent::RevealVisibleEntry
                )
                .is_ok()
        );
    }

    /// Verifies the writer target is bound to the captured root identity.
    #[test]
    fn writer_target_requires_the_expected_root() {
        let fixture = tempfile::tempdir().expect("the fixture should be created");
        std::fs::write(fixture.path().join("file.txt"), b"fixture")
            .expect("the file should be created");
        let root = std::fs::canonicalize(fixture.path()).expect("the root should canonicalize");
        let policy = FilePathPolicy;
        let identity = policy
            .identify_root(&root)
            .expect("the root should identify");
        let target = policy
            .resolve_writer_target(&root, "file.txt", &identity)
            .expect("the writer target should validate");
        assert_eq!(target.absolute_path(), root.join("file.txt"));
        policy
            .revalidate_writer_target(&target)
            .expect("the unchanged target should revalidate");
    }

    /// Verifies the mandatory Windows reparse bit is always link-like.
    #[cfg(windows)]
    #[test]
    fn windows_reparse_attribute_is_link_like() {
        assert!(super::is_windows_reparse(0x400));
        assert!(super::is_windows_reparse(0x420));
        assert!(!super::is_windows_reparse(0x20));
    }
}
