use std::{collections::BTreeMap, fs, path::Path};

use gix::bstr::ByteSlice;

use super::models::{GitFileChangeDto, GitFileChangeKindDto, GitHeadDto, GitRepositoryKindDto};

/// Selects whether a scan materializes paths or only computes counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GitInspectionMode {
    Summary,
    Detail,
}

/// Owns all data produced by one completed blocking Git scan.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GitReadSnapshot {
    pub repository_kind: GitRepositoryKindDto,
    pub head: Option<GitHeadDto>,
    pub changed_count: u32,
    pub untracked_count: u32,
    pub changes: Vec<GitFileChangeDto>,
}

/// Hides repository and filesystem details from the public error contract.
#[derive(Clone, Copy, Debug)]
pub(crate) struct GitReadError;

/// Reads one repository without exposing a `gix` handle outside the worker.
pub(crate) trait GitStatusReader: Send + Sync {
    /// Reads one Git snapshot without modifying the repository or worktree.
    fn inspect(
        &self,
        root: &Path,
        mode: GitInspectionMode,
    ) -> Result<GitReadSnapshot, GitReadError>;
}

/// Implements the production read-only reader with `gix`.
pub(crate) struct GixGitStatusReader;

/// Holds raw bytes until sorting and escaping are complete.
#[derive(Clone)]
struct RawChange {
    path: Vec<u8>,
    previous_path: Option<Vec<u8>>,
    change: GitFileChangeKindDto,
    is_directory: bool,
}

impl GitStatusReader for GixGitStatusReader {
    /// Opens exactly the supplied root and consumes the complete status iterator.
    fn inspect(
        &self,
        root: &Path,
        mode: GitInspectionMode,
    ) -> Result<GitReadSnapshot, GitReadError> {
        let options = gix::open::Options::isolated().strict_config(true);
        let repository = match gix::open_opts(root, options) {
            Ok(repository)
                if repository.workdir().is_none() || repository.workdir() == Some(root) =>
            {
                repository
            }
            Ok(_) => return Ok(empty_snapshot()),
            Err(_) if has_repository_marker(root) => return Err(GitReadError),
            Err(_) => return Ok(empty_snapshot()),
        };

        reject_external_execution(&repository)?;
        let head = read_head(&repository)?;
        if repository.is_bare() {
            return Ok(GitReadSnapshot {
                repository_kind: GitRepositoryKindDto::Bare,
                head: Some(head),
                changed_count: 0,
                untracked_count: 0,
                changes: Vec::new(),
            });
        }
        if !matches!(head, GitHeadDto::Unborn { .. })
            && !repository.git_dir().join("index").is_file()
        {
            return Err(GitReadError);
        }

        let mut merged = BTreeMap::<Vec<u8>, RawChange>::new();
        let platform = repository
            .status(gix::progress::Discard)
            .map_err(|_| GitReadError)?
            .untracked_files(gix::status::UntrackedFiles::Collapsed)
            .index_worktree_rewrites(None)
            .index_worktree_submodules(gix::status::Submodule::Given {
                ignore: gix::submodule::config::Ignore::Dirty,
                check_dirty: true,
            });
        let mut iterator = platform.into_iter(Vec::new()).map_err(|_| GitReadError)?;
        for item in &mut iterator {
            merge_item(&mut merged, item.map_err(|_| GitReadError)?)?;
        }
        // A fully consumed iterator has an outcome; absence means a worker failed or was interrupted.
        iterator.into_outcome().ok_or(GitReadError)?;

        let changed_count = u32::try_from(merged.len()).map_err(|_| GitReadError)?;
        let untracked_count = u32::try_from(
            merged
                .values()
                .filter(|entry| entry.change == GitFileChangeKindDto::Untracked)
                .count(),
        )
        .map_err(|_| GitReadError)?;
        let changes = if mode == GitInspectionMode::Detail {
            merged.into_values().map(public_change).collect()
        } else {
            Vec::new()
        };
        Ok(GitReadSnapshot {
            repository_kind: GitRepositoryKindDto::Worktree,
            head: Some(head),
            changed_count,
            untracked_count,
            changes,
        })
    }
}

/// Creates the successful result for an ordinary non-repository folder.
fn empty_snapshot() -> GitReadSnapshot {
    GitReadSnapshot {
        repository_kind: GitRepositoryKindDto::NotRepository,
        head: None,
        changed_count: 0,
        untracked_count: 0,
        changes: Vec::new(),
    }
}

/// Detects metadata at the exact root so corruption is not hidden as a plain folder.
fn has_repository_marker(root: &Path) -> bool {
    root.join(".git").exists()
        || (root.join("HEAD").exists()
            && root.join("objects").is_dir()
            && root.join("refs").is_dir())
}

/// Rejects configuration that could cause status processing to execute a program.
fn reject_external_execution(repository: &gix::Repository) -> Result<(), GitReadError> {
    for config_path in [
        repository.common_dir().join("config"),
        repository.git_dir().join("config.worktree"),
    ] {
        let bytes = match fs::read(config_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(GitReadError),
        };
        if config_requires_external_execution(&bytes) {
            return Err(GitReadError);
        }
    }
    Ok(())
}

/// Detects only configuration keys that can execute external Git helpers.
fn config_requires_external_execution(bytes: &[u8]) -> bool {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    let mut section = "";
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            section = line;
            continue;
        }
        let key = line
            .split_once('=')
            .map_or(line, |(key, _value)| key)
            .trim();
        if (section.starts_with("[filter") && matches!(key, "process" | "clean" | "smudge"))
            || (section.starts_with("[diff") && matches!(key, "textconv" | "command" | "external"))
            || (section.starts_with("[core") && key == "fsmonitor")
            || (section.starts_with("[credential") && key == "helper")
        {
            return true;
        }
    }
    false
}

/// Converts HEAD into the branch, unborn, or detached public form.
fn read_head(repository: &gix::Repository) -> Result<GitHeadDto, GitReadError> {
    let head = repository.head().map_err(|_| GitReadError)?;
    if head.is_detached() {
        let oid = head.id().ok_or(GitReadError)?.to_string();
        return Ok(GitHeadDto::Detached {
            short_oid: oid.chars().take(8).collect(),
        });
    }
    let name = head.referent_name().ok_or(GitReadError)?.shorten();
    let name = escape_bytes(name.as_bytes());
    if head.is_unborn() {
        Ok(GitHeadDto::Unborn { name })
    } else {
        Ok(GitHeadDto::Branch { name })
    }
}

/// Merges one index/worktree observation using the documented display precedence.
fn merge_item(
    merged: &mut BTreeMap<Vec<u8>, RawChange>,
    item: gix::status::Item,
) -> Result<(), GitReadError> {
    let candidate = match item {
        gix::status::Item::IndexWorktree(item) => map_index_worktree(item)?,
        gix::status::Item::TreeIndex(change) => map_tree_index(change)?,
    };
    let Some(candidate) = candidate else {
        return Ok(());
    };
    match merged.get(&candidate.path) {
        Some(current) if priority(current.change) >= priority(candidate.change) => {}
        _ => {
            merged.insert(candidate.path.clone(), candidate);
        }
    }
    Ok(())
}

/// Maps an index-to-worktree observation into a raw display entry.
fn map_index_worktree(
    item: gix::status::index_worktree::Item,
) -> Result<Option<RawChange>, GitReadError> {
    use gix::status::index_worktree::{Item, iter::Summary};
    let directory_on_disk = match &item {
        Item::DirectoryContents { entry, .. } => entry.disk_kind.is_some_and(|kind| kind.is_dir()),
        Item::Rewrite { dirwalk_entry, .. } => {
            dirwalk_entry.disk_kind.is_some_and(|kind| kind.is_dir())
        }
        Item::Modification { .. } => false,
    };
    let summary = item.summary();
    let change = match summary {
        Some(Summary::Conflict) => GitFileChangeKindDto::Conflicted,
        Some(Summary::Removed) => GitFileChangeKindDto::Deleted,
        Some(Summary::TypeChange) => GitFileChangeKindDto::TypeChanged,
        Some(Summary::Modified) => GitFileChangeKindDto::Modified,
        Some(Summary::IntentToAdd) => GitFileChangeKindDto::Added,
        Some(Summary::Added) => GitFileChangeKindDto::Untracked,
        Some(Summary::Renamed) => GitFileChangeKindDto::Renamed,
        Some(Summary::Copied) => GitFileChangeKindDto::Copied,
        None => return Ok(None),
    };
    let previous_path = match &item {
        Item::Rewrite { source, .. } => Some(source.rela_path().as_bytes().to_vec()),
        _ => None,
    };
    if let Some(previous) = previous_path.as_deref() {
        validate_raw_path(previous)?;
    }
    let mut path = item.rela_path().as_bytes().to_vec();
    let is_directory = change == GitFileChangeKindDto::Untracked && directory_on_disk;
    if is_directory && !path.ends_with(b"/") {
        path.push(b'/');
    }
    validate_raw_path(&path)?;
    Ok(Some(RawChange {
        path,
        previous_path,
        change,
        is_directory,
    }))
}

/// Maps a HEAD-to-index observation, preserving rewrite source paths.
fn map_tree_index(change: gix::diff::index::Change) -> Result<Option<RawChange>, GitReadError> {
    use gix::diff::index::ChangeRef;
    let (path, previous_path, kind) = match change {
        ChangeRef::Addition { location, .. } => {
            (location.into_owned(), None, GitFileChangeKindDto::Added)
        }
        ChangeRef::Deletion { location, .. } => {
            (location.into_owned(), None, GitFileChangeKindDto::Deleted)
        }
        ChangeRef::Modification {
            location,
            previous_entry_mode,
            entry_mode,
            ..
        } => {
            let kind = if previous_entry_mode != entry_mode {
                GitFileChangeKindDto::TypeChanged
            } else {
                GitFileChangeKindDto::Modified
            };
            (location.into_owned(), None, kind)
        }
        ChangeRef::Rewrite {
            source_location,
            location,
            copy,
            ..
        } => (
            location.into_owned(),
            Some(source_location.into_owned().to_vec()),
            if copy {
                GitFileChangeKindDto::Copied
            } else {
                GitFileChangeKindDto::Renamed
            },
        ),
    };
    let path = path.to_vec();
    validate_raw_path(&path)?;
    if let Some(previous) = previous_path.as_deref() {
        validate_raw_path(previous)?;
    }
    Ok(Some(RawChange {
        path,
        previous_path,
        change: kind,
        is_directory: false,
    }))
}

/// Rejects absolute and parent-traversing paths before they enter a DTO.
fn validate_raw_path(path: &[u8]) -> Result<(), GitReadError> {
    if path.is_empty()
        || path.starts_with(b"/")
        || path.starts_with(b"\\")
        || path.get(1) == Some(&b':')
        || path
            .split(|byte| *byte == b'/' || *byte == b'\\')
            .any(|part| part == b"..")
    {
        return Err(GitReadError);
    }
    Ok(())
}

/// Defines precedence for observations sharing one current path.
fn priority(change: GitFileChangeKindDto) -> u8 {
    match change {
        GitFileChangeKindDto::Conflicted => 8,
        GitFileChangeKindDto::Renamed => 7,
        GitFileChangeKindDto::Copied => 6,
        GitFileChangeKindDto::Deleted => 5,
        GitFileChangeKindDto::Added => 4,
        GitFileChangeKindDto::TypeChanged => 3,
        GitFileChangeKindDto::Modified => 2,
        GitFileChangeKindDto::Untracked => 1,
    }
}

/// Escapes non-UTF-8 bytes without collapsing distinct paths.
fn escape_bytes(bytes: &[u8]) -> String {
    let mut output = String::new();
    let mut remaining = bytes;
    while !remaining.is_empty() {
        match std::str::from_utf8(remaining) {
            Ok(valid) => {
                output.push_str(&valid.replace('\\', "/"));
                break;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                output.push_str(
                    &std::str::from_utf8(&remaining[..valid])
                        .expect("the UTF-8 validator identified this prefix")
                        .replace('\\', "/"),
                );
                let invalid = error.error_len().unwrap_or(remaining.len() - valid);
                for byte in &remaining[valid..valid + invalid] {
                    use std::fmt::Write as _;
                    let _ = write!(output, "\\x{byte:02X}");
                }
                remaining = &remaining[valid + invalid..];
            }
        }
    }
    output
}

/// Converts raw sorted bytes into the public escaped form.
fn public_change(change: RawChange) -> GitFileChangeDto {
    GitFileChangeDto {
        path: escape_bytes(&change.path),
        previous_path: change.previous_path.map(|path| escape_bytes(&path)),
        change: change.change,
        is_directory: change.is_directory,
    }
}

#[cfg(test)]
mod tests {
    use std::{path::Path, process::Command};

    use super::{
        GitInspectionMode, GitStatusReader, GixGitStatusReader, escape_bytes, validate_raw_path,
    };
    use crate::projects::models::{GitFileChangeKindDto, GitHeadDto, GitRepositoryKindDto};

    /// Runs Git only to arrange an isolated repository fixture.
    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "XWork Test")
            .env("GIT_AUTHOR_EMAIL", "xwork@example.invalid")
            .env("GIT_COMMITTER_NAME", "XWork Test")
            .env("GIT_COMMITTER_EMAIL", "xwork@example.invalid")
            .output()
            .expect("git.exe is required to arrange Git reader fixtures");
        assert!(
            output.status.success(),
            "fixture command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// Creates a committed repository at the supplied temporary root.
    fn committed_repository(root: &Path) {
        git(root, &["init", "--initial-branch=main"]);
        std::fs::write(root.join("tracked.txt"), b"original")
            .expect("the tracked fixture should be written");
        git(root, &["add", "tracked.txt"]);
        git(root, &["commit", "-m", "initial"]);
    }

    /// Verifies lossless escaping for mixed valid and invalid UTF-8.
    #[test]
    fn path_escaping_preserves_valid_text_and_invalid_bytes() {
        assert_eq!(escape_bytes(b"src/a\xFF.txt"), "src/a\\xFF.txt");
        assert!(!escape_bytes(b"\xFF").contains('\u{fffd}'));
    }

    /// Verifies that paths cannot escape the registered project root.
    #[test]
    fn path_validation_rejects_absolute_drive_and_parent_paths() {
        for path in [b"/tmp/a".as_slice(), b"C:/a", b"a/../b", b"\\server\\a"] {
            assert!(validate_raw_path(path).is_err());
        }
        assert!(validate_raw_path(b"src/main.rs").is_ok());
    }

    /// Verifies exact-root detection never discovers a repository in a parent folder.
    #[test]
    fn exact_root_detection_ignores_parent_repositories() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        let child = directory.path().join("child");
        std::fs::create_dir(&child).expect("the child folder should be created");

        let snapshot = GixGitStatusReader
            .inspect(&child, GitInspectionMode::Detail)
            .expect("a plain child folder should be a successful result");

        assert_eq!(
            snapshot.repository_kind,
            GitRepositoryKindDto::NotRepository
        );
        assert_eq!(snapshot.changed_count, 0);
        assert!(snapshot.changes.is_empty());
    }

    /// Verifies branch, tracked modification, and collapsed untracked-directory mapping.
    #[test]
    fn worktree_status_maps_branch_and_visible_changes() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        std::fs::write(directory.path().join("tracked.txt"), b"changed")
            .expect("the tracked fixture should change");
        std::fs::create_dir(directory.path().join("untracked"))
            .expect("the untracked folder should be created");
        std::fs::write(directory.path().join("untracked/file.txt"), b"new")
            .expect("the untracked fixture should be written");

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the repository should be readable");

        assert_eq!(snapshot.repository_kind, GitRepositoryKindDto::Worktree);
        assert_eq!(
            snapshot.head,
            Some(GitHeadDto::Branch {
                name: "main".into()
            })
        );
        assert_eq!(snapshot.changed_count, 2);
        assert_eq!(snapshot.untracked_count, 1);
        assert_eq!(snapshot.changes[0].path, "tracked.txt");
        assert_eq!(snapshot.changes[0].change, GitFileChangeKindDto::Modified);
        assert_eq!(snapshot.changes[1].path, "untracked/");
        assert!(snapshot.changes[1].is_directory);
    }

    /// Verifies summary mode computes the same counts without returning path details.
    #[test]
    fn summary_mode_omits_changes_but_preserves_counts() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        std::fs::write(directory.path().join("new.txt"), b"new")
            .expect("the untracked fixture should be written");

        let summary = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Summary)
            .expect("the summary should be readable");
        let detail = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the detail should be readable");

        assert_eq!(summary.changed_count, detail.changed_count);
        assert_eq!(summary.untracked_count, detail.untracked_count);
        assert!(summary.changes.is_empty());
    }

    /// Verifies an unborn repository and a detached repository are distinct HEAD states.
    #[test]
    fn head_distinguishes_unborn_and_detached_states() {
        let unborn = tempfile::TempDir::new().expect("the temporary directory should open");
        git(unborn.path(), &["init", "--initial-branch=topic"]);
        let snapshot = GixGitStatusReader
            .inspect(unborn.path(), GitInspectionMode::Summary)
            .expect("the unborn repository should be readable");
        assert_eq!(
            snapshot.head,
            Some(GitHeadDto::Unborn {
                name: "topic".into()
            })
        );

        let detached = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(detached.path());
        git(detached.path(), &["checkout", "--detach"]);
        let snapshot = GixGitStatusReader
            .inspect(detached.path(), GitInspectionMode::Summary)
            .expect("the detached repository should be readable");
        assert!(
            matches!(snapshot.head, Some(GitHeadDto::Detached { short_oid }) if short_oid.len() == 8)
        );
    }

    /// Verifies bare repositories succeed without presenting a clean worktree.
    #[test]
    fn bare_repository_has_no_worktree_changes() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        git(
            directory.path(),
            &["init", "--bare", "--initial-branch=main"],
        );

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the bare repository should be readable");

        assert_eq!(snapshot.repository_kind, GitRepositoryKindDto::Bare);
        assert_eq!(
            snapshot.head,
            Some(GitHeadDto::Unborn {
                name: "main".into()
            })
        );
        assert_eq!(snapshot.changed_count, 0);
        assert!(snapshot.changes.is_empty());
    }

    /// Verifies corrupt repository metadata is an error instead of a plain folder.
    #[test]
    fn corrupt_repository_marker_returns_an_inspection_error() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        std::fs::create_dir(directory.path().join(".git"))
            .expect("the corrupt marker should be created");

        assert!(
            GixGitStatusReader
                .inspect(directory.path(), GitInspectionMode::Summary)
                .is_err()
        );
    }

    /// Verifies a born worktree with a missing index fails instead of returning partial data.
    #[test]
    fn missing_index_in_a_born_worktree_is_an_inspection_error() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        std::fs::remove_file(directory.path().join(".git/index"))
            .expect("the fixture index should be removed");

        assert!(
            GixGitStatusReader
                .inspect(directory.path(), GitInspectionMode::Detail)
                .is_err()
        );
    }

    /// Verifies helper-capable local configuration is rejected before status iteration.
    #[test]
    fn external_helper_configuration_is_rejected() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        git(
            directory.path(),
            &["config", "filter.hostile.process", "helper.exe"],
        );

        assert!(
            GixGitStatusReader
                .inspect(directory.path(), GitInspectionMode::Detail)
                .is_err()
        );
    }

    /// Verifies linked worktrees are opened only when their own root is supplied.
    #[test]
    fn linked_worktree_is_recognized_at_its_exact_root() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        let primary = directory.path().join("primary");
        let linked = directory.path().join("linked");
        std::fs::create_dir(&primary).expect("the primary root should be created");
        committed_repository(&primary);
        git(
            &primary,
            &[
                "worktree",
                "add",
                "-b",
                "linked-topic",
                linked.to_str().expect("the fixture path should be UTF-8"),
            ],
        );

        let snapshot = GixGitStatusReader
            .inspect(&linked, GitInspectionMode::Detail)
            .expect("the linked worktree should be readable");

        assert_eq!(snapshot.repository_kind, GitRepositoryKindDto::Worktree);
        assert_eq!(
            snapshot.head,
            Some(GitHeadDto::Branch {
                name: "linked-topic".into()
            })
        );
        assert_eq!(snapshot.changed_count, 0);
    }

    /// Verifies staged renames preserve destination and source paths exactly once.
    #[test]
    fn staged_rename_is_deduplicated_with_its_previous_path() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        git(directory.path(), &["mv", "tracked.txt", "renamed.txt"]);

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the staged rename should be readable");

        assert_eq!(snapshot.changed_count, 1);
        assert_eq!(snapshot.changes[0].path, "renamed.txt");
        assert_eq!(
            snapshot.changes[0].previous_path.as_deref(),
            Some("tracked.txt")
        );
        assert_eq!(snapshot.changes[0].change, GitFileChangeKindDto::Renamed);
    }

    /// Verifies configured staged copy tracking preserves both source and destination.
    #[test]
    fn staged_copy_preserves_its_previous_path() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        git(directory.path(), &["config", "status.renames", "copies"]);
        git(directory.path(), &["config", "diff.renames", "copies"]);
        std::fs::write(directory.path().join("tracked.txt"), b"changed source")
            .expect("the changed source should be written");
        std::fs::write(directory.path().join("copied.txt"), b"changed source")
            .expect("the copied fixture should be written");
        git(directory.path(), &["add", "tracked.txt", "copied.txt"]);

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the staged copy should be readable");

        assert_eq!(snapshot.changed_count, 1);
        assert_eq!(snapshot.changes[0].path, "copied.txt");
        assert_eq!(
            snapshot.changes[0].previous_path.as_deref(),
            Some("tracked.txt")
        );
        assert_eq!(snapshot.changes[0].change, GitFileChangeKindDto::Copied);
    }

    /// Verifies ignored files never become public change entries.
    #[test]
    fn ignored_entries_are_excluded() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        std::fs::write(directory.path().join(".gitignore"), b"ignored.txt\n")
            .expect("the ignore fixture should be written");
        git(directory.path(), &["add", ".gitignore"]);
        git(directory.path(), &["commit", "-m", "ignore rule"]);
        std::fs::write(directory.path().join("ignored.txt"), b"ignored")
            .expect("the ignored fixture should be written");

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the ignored repository should be readable");

        assert_eq!(snapshot.changed_count, 0);
        assert!(snapshot.changes.is_empty());
    }

    /// Verifies staged and unstaged observations of one current path count once.
    #[test]
    fn staged_and_unstaged_changes_are_deduplicated_by_current_path() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        std::fs::write(directory.path().join("tracked.txt"), b"staged")
            .expect("the staged fixture should be written");
        git(directory.path(), &["add", "tracked.txt"]);
        std::fs::write(directory.path().join("tracked.txt"), b"unstaged")
            .expect("the unstaged fixture should be written");

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the combined status should be readable");

        assert_eq!(snapshot.changed_count, 1);
        assert_eq!(snapshot.changes.len(), 1);
        assert_eq!(snapshot.changes[0].path, "tracked.txt");
        assert_eq!(snapshot.changes[0].change, GitFileChangeKindDto::Modified);
    }

    /// Verifies staged additions and deletions are classified and sorted by raw path.
    #[test]
    fn staged_addition_and_deletion_are_classified_in_stable_order() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        std::fs::write(directory.path().join("added.txt"), b"added")
            .expect("the added fixture should be written");
        git(directory.path(), &["add", "added.txt"]);
        git(directory.path(), &["rm", "tracked.txt"]);

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the staged status should be readable");

        assert_eq!(snapshot.changed_count, 2);
        assert_eq!(snapshot.changes[0].path, "added.txt");
        assert_eq!(snapshot.changes[0].change, GitFileChangeKindDto::Added);
        assert_eq!(snapshot.changes[1].path, "tracked.txt");
        assert_eq!(snapshot.changes[1].change, GitFileChangeKindDto::Deleted);
    }

    /// Verifies an index mode change is distinct from a content modification.
    #[test]
    fn staged_mode_change_is_classified_as_type_changed() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        git(
            directory.path(),
            &["update-index", "--chmod=+x", "tracked.txt"],
        );

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the mode change should be readable");

        assert_eq!(snapshot.changed_count, 1);
        assert_eq!(
            snapshot.changes[0].change,
            GitFileChangeKindDto::TypeChanged
        );
    }

    /// Verifies an unmerged index entry has the highest conflict classification.
    #[test]
    fn merge_conflict_is_classified_as_conflicted() {
        let directory = tempfile::TempDir::new().expect("the temporary directory should open");
        committed_repository(directory.path());
        git(directory.path(), &["checkout", "-b", "other"]);
        std::fs::write(directory.path().join("tracked.txt"), b"other branch")
            .expect("the branch fixture should be written");
        git(directory.path(), &["add", "tracked.txt"]);
        git(directory.path(), &["commit", "-m", "other change"]);
        git(directory.path(), &["checkout", "main"]);
        std::fs::write(directory.path().join("tracked.txt"), b"main branch")
            .expect("the main fixture should be written");
        git(directory.path(), &["add", "tracked.txt"]);
        git(directory.path(), &["commit", "-m", "main change"]);
        let merge = Command::new("git")
            .args(["merge", "other"])
            .current_dir(directory.path())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "XWork Test")
            .env("GIT_AUTHOR_EMAIL", "xwork@example.invalid")
            .env("GIT_COMMITTER_NAME", "XWork Test")
            .env("GIT_COMMITTER_EMAIL", "xwork@example.invalid")
            .output()
            .expect("git.exe should arrange the conflict fixture");
        assert!(!merge.status.success(), "the fixture merge must conflict");

        let snapshot = GixGitStatusReader
            .inspect(directory.path(), GitInspectionMode::Detail)
            .expect("the conflict status should be readable");

        assert_eq!(snapshot.changed_count, 1);
        assert_eq!(snapshot.changes[0].path, "tracked.txt");
        assert_eq!(snapshot.changes[0].change, GitFileChangeKindDto::Conflicted);
    }
}
