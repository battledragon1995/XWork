use std::{cmp::Ordering, collections::HashSet, path::Path};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};

use super::{
    error::FilesError,
    models::{
        FileSearchTruncatedReasonDto, FileTreeEntryDto, FileTreeEntryKindDto, FileTreeWarningDto,
        FileTreeWarningReasonDto, MAX_CURSOR_BYTES, MAX_PAGE_ENTRIES, MAX_PATH_COMPONENTS,
        MAX_SCAN_ENTRIES, MAX_SEARCH_RESULTS, MAX_WARNINGS, saturating_u32,
    },
    path_policy::{is_link_like, validate_relative_path},
};

/// Holds one directory page before service-owned project fields are added.
pub(crate) struct FileTreePage {
    pub entries: Vec<FileTreeEntryDto>,
    pub next_cursor: Option<String>,
    pub warnings: WarningCollection,
}

/// Holds one recursive search before service-owned project fields are added.
pub(crate) struct FileTreeSearch {
    pub matches: Vec<FileTreeEntryDto>,
    pub truncated_reason: Option<FileSearchTruncatedReasonDto>,
    pub warnings: WarningCollection,
}

/// Classifies a reader failure for safe service mapping.
#[derive(Debug)]
pub(crate) enum FileTreeReadError {
    Files(FilesError),
}

/// Provides synchronous filesystem queries for the bounded blocking worker.
pub(crate) trait FileTreeReader: Send + Sync {
    /// Lists one page of visible direct children under a validated directory.
    fn list_children(
        &self,
        root: &Path,
        directory: &Path,
        cursor: Option<&str>,
    ) -> Result<FileTreePage, FileTreeReadError>;

    /// Searches visible entries recursively without reading file contents.
    fn search(&self, root: &Path, query: &str) -> Result<FileTreeSearch, FileTreeReadError>;

    /// Checks whether one existing path is currently visible.
    fn is_visible(&self, root: &Path, relative_path: &str) -> Result<bool, FileTreeReadError>;
}

/// Reads the real filesystem with a fresh ignore matcher per operation.
#[derive(Default)]
pub(crate) struct NativeFileTreeReader;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CursorV1 {
    version: u8,
    directory: String,
    key: SortKey,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SortKey {
    kind: u8,
    folded_name: String,
    name: String,
    relative_path: String,
}

impl Ord for SortKey {
    /// Orders entries by the stable BE-013 tuple.
    fn cmp(&self, other: &Self) -> Ordering {
        self.kind
            .cmp(&other.kind)
            .then_with(|| self.folded_name.cmp(&other.folded_name))
            .then_with(|| self.name.as_bytes().cmp(other.name.as_bytes()))
            .then_with(|| {
                self.relative_path
                    .as_bytes()
                    .cmp(other.relative_path.as_bytes())
            })
    }
}

impl PartialOrd for SortKey {
    /// Delegates partial ordering to the total stable tuple.
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Aggregates warnings with a saturating total and a bounded unique payload.
#[derive(Default)]
pub(crate) struct WarningCollection {
    count: usize,
    values: Vec<FileTreeWarningDto>,
    unique: HashSet<(String, FileTreeWarningReasonDto)>,
    truncated: bool,
}

impl WarningCollection {
    /// Records one recoverable issue without leaking an absolute path.
    fn push(&mut self, directory: &str, reason: FileTreeWarningReasonDto) {
        self.count = self.count.saturating_add(1);
        let key = (directory.to_owned(), reason);
        if !self.unique.insert(key.clone()) {
            return;
        }
        if self.values.len() == MAX_WARNINGS {
            self.truncated = true;
            return;
        }
        self.values.push(FileTreeWarningDto {
            relative_directory: key.0,
            reason,
        });
    }

    /// Converts warnings into public response fields.
    pub(crate) fn into_parts(self) -> (u32, bool, Vec<FileTreeWarningDto>) {
        (saturating_u32(self.count), self.truncated, self.values)
    }
}

impl FileTreeReader for NativeFileTreeReader {
    /// Lists and sorts all bounded direct candidates before applying a cursor.
    fn list_children(
        &self,
        root: &Path,
        directory: &Path,
        cursor: Option<&str>,
    ) -> Result<FileTreePage, FileTreeReadError> {
        let relative_directory = slash_relative(root, directory)?;
        let cursor = cursor
            .map(|value| decode_cursor(value, &relative_directory))
            .transpose()
            .map_err(FileTreeReadError::Files)?;
        let mut warnings = WarningCollection::default();
        let matcher = build_matcher(root, directory, &mut warnings)?;
        let root_metadata = std::fs::symlink_metadata(root)
            .map_err(|_| FileTreeReadError::Files(FilesError::FileSystemReadFailed))?;
        let entries = std::fs::read_dir(directory)
            .map_err(|_| FileTreeReadError::Files(FilesError::FileSystemReadFailed))?;
        let mut candidates = Vec::new();
        for (inspected, candidate) in entries.enumerate() {
            if inspected == MAX_SCAN_ENTRIES {
                return Err(FileTreeReadError::Files(FilesError::TraversalLimitExceeded));
            }
            let candidate = match candidate {
                Ok(value) => value,
                Err(_) => {
                    warnings.push(
                        &relative_directory,
                        FileTreeWarningReasonDto::UnreadableEntry,
                    );
                    continue;
                }
            };
            let Some(name) = candidate.file_name().to_str().map(str::to_owned) else {
                warnings.push(
                    &relative_directory,
                    FileTreeWarningReasonDto::UnsupportedName,
                );
                continue;
            };
            if is_vcs_metadata(&name) {
                continue;
            }
            let relative_path = join_relative(&relative_directory, &name);
            let metadata = match std::fs::symlink_metadata(candidate.path()) {
                Ok(value) => value,
                Err(_) => {
                    warnings.push(
                        &relative_directory,
                        FileTreeWarningReasonDto::UnreadableEntry,
                    );
                    continue;
                }
            };
            let kind = classify(&metadata, &root_metadata);
            if matcher
                .matched_path_or_any_parents(
                    candidate.path(),
                    kind == FileTreeEntryKindDto::Directory,
                )
                .is_ignore()
            {
                continue;
            }
            candidates.push(FileTreeEntryDto {
                name,
                relative_path,
                kind,
            });
        }
        candidates.sort_by_key(entry_key);
        if let Some(cursor) = cursor {
            candidates.retain(|entry| entry_key(entry) > cursor.key);
        }
        let has_more = candidates.len() > MAX_PAGE_ENTRIES;
        candidates.truncate(MAX_PAGE_ENTRIES);
        let next_cursor = has_more
            .then(|| {
                candidates
                    .last()
                    .map(|entry| encode_cursor(&relative_directory, entry))
            })
            .flatten()
            .transpose()
            .map_err(FileTreeReadError::Files)?;
        Ok(FileTreePage {
            entries: candidates,
            next_cursor,
            warnings,
        })
    }

    /// Searches recursively in deterministic depth-first sibling order.
    fn search(&self, root: &Path, query: &str) -> Result<FileTreeSearch, FileTreeReadError> {
        let root_metadata = std::fs::symlink_metadata(root)
            .map_err(|_| FileTreeReadError::Files(FilesError::FileSystemReadFailed))?;
        let mut state = SearchState {
            root,
            root_metadata: &root_metadata,
            folded_query: query.to_lowercase(),
            inspected: 0,
            matches: Vec::new(),
            truncated_reason: None,
            warnings: WarningCollection::default(),
        };
        search_directory(root, "", 0, &mut state)?;
        state.matches.sort_by_key(entry_key);
        state.matches.truncate(MAX_SEARCH_RESULTS);
        Ok(FileTreeSearch {
            matches: state.matches,
            truncated_reason: state.truncated_reason,
            warnings: state.warnings,
        })
    }

    /// Applies fresh nested ignore rules to one existing lexical path.
    fn is_visible(&self, root: &Path, relative_path: &str) -> Result<bool, FileTreeReadError> {
        let components =
            validate_relative_path(relative_path, false).map_err(FileTreeReadError::Files)?;
        if components
            .iter()
            .any(|component| is_vcs_metadata(component))
        {
            return Ok(false);
        }
        let absolute = relative_path
            .split('/')
            .fold(root.to_path_buf(), |path, component| path.join(component));
        let parent = absolute
            .parent()
            .ok_or(FileTreeReadError::Files(FilesError::InvalidRelativePath))?;
        let mut warnings = WarningCollection::default();
        let matcher = build_matcher(root, parent, &mut warnings)?;
        let metadata = std::fs::symlink_metadata(&absolute).map_err(|error| {
            FileTreeReadError::Files(if error.kind() == std::io::ErrorKind::NotFound {
                FilesError::EntryNotFound {
                    relative_path: relative_path.to_owned(),
                }
            } else {
                FilesError::FileSystemReadFailed
            })
        })?;
        let name = absolute.file_name().and_then(|name| name.to_str());
        Ok(name.is_some_and(is_visible_vcs_name)
            && !matcher
                .matched_path_or_any_parents(&absolute, metadata.is_dir())
                .is_ignore())
    }
}

struct SearchState<'a> {
    root: &'a Path,
    root_metadata: &'a std::fs::Metadata,
    folded_query: String,
    inspected: usize,
    matches: Vec<FileTreeEntryDto>,
    truncated_reason: Option<FileSearchTruncatedReasonDto>,
    warnings: WarningCollection,
}

/// Visits one directory while preserving deterministic sibling order.
fn search_directory(
    directory: &Path,
    relative_directory: &str,
    depth: usize,
    state: &mut SearchState<'_>,
) -> Result<(), FileTreeReadError> {
    if state.truncated_reason.is_some() {
        return Ok(());
    }
    let matcher = build_matcher(state.root, directory, &mut state.warnings)?;
    let read_dir = match std::fs::read_dir(directory) {
        Ok(value) => value,
        Err(_) if relative_directory.is_empty() => {
            return Err(FileTreeReadError::Files(FilesError::FileSystemReadFailed));
        }
        Err(_) => {
            state.warnings.push(
                relative_directory,
                FileTreeWarningReasonDto::UnreadableEntry,
            );
            return Ok(());
        }
    };
    let mut children = Vec::new();
    for child in read_dir {
        if state.inspected == MAX_SCAN_ENTRIES {
            state.truncated_reason = Some(FileSearchTruncatedReasonDto::ScanLimit);
            break;
        }
        state.inspected += 1;
        let child = match child {
            Ok(value) => value,
            Err(_) => {
                state.warnings.push(
                    relative_directory,
                    FileTreeWarningReasonDto::UnreadableEntry,
                );
                continue;
            }
        };
        let Some(name) = child.file_name().to_str().map(str::to_owned) else {
            state.warnings.push(
                relative_directory,
                FileTreeWarningReasonDto::UnsupportedName,
            );
            continue;
        };
        if is_vcs_metadata(&name) {
            continue;
        }
        let metadata = match std::fs::symlink_metadata(child.path()) {
            Ok(value) => value,
            Err(_) => {
                state.warnings.push(
                    relative_directory,
                    FileTreeWarningReasonDto::UnreadableEntry,
                );
                continue;
            }
        };
        let kind = classify(&metadata, state.root_metadata);
        if matcher
            .matched_path_or_any_parents(child.path(), kind == FileTreeEntryKindDto::Directory)
            .is_ignore()
        {
            continue;
        }
        let entry = FileTreeEntryDto {
            relative_path: join_relative(relative_directory, &name),
            name,
            kind,
        };
        children.push(entry);
    }
    children.sort_by_key(entry_key);
    for child in children {
        if state.truncated_reason.is_some() {
            break;
        }
        if child.name.to_lowercase().contains(&state.folded_query) {
            if state.matches.len() == MAX_SEARCH_RESULTS {
                state.truncated_reason = Some(FileSearchTruncatedReasonDto::ResultLimit);
                break;
            }
            state.matches.push(child.clone());
        }
        if child.kind == FileTreeEntryKindDto::Directory {
            if depth + 1 >= MAX_PATH_COMPONENTS {
                state.truncated_reason = Some(FileSearchTruncatedReasonDto::DepthLimit);
                break;
            }
            search_directory(
                &state.root.join(
                    child
                        .relative_path
                        .replace('/', std::path::MAIN_SEPARATOR_STR),
                ),
                &child.relative_path,
                depth + 1,
                state,
            )?;
        }
    }
    Ok(())
}

/// Builds ignore rules from validated project-local sources only.
fn build_matcher(
    root: &Path,
    directory: &Path,
    warnings: &mut WarningCollection,
) -> Result<Gitignore, FileTreeReadError> {
    let mut builder = GitignoreBuilder::new(root);
    let mut ancestors = Vec::new();
    let mut current = Some(directory);
    while let Some(path) = current {
        if !path.starts_with(root) {
            return Err(FileTreeReadError::Files(FilesError::FileSystemReadFailed));
        }
        ancestors.push(path);
        if path == root {
            break;
        }
        current = path.parent();
    }
    ancestors.reverse();
    for ancestor in ancestors {
        let relative = slash_relative(root, ancestor)?;
        for name in [".gitignore", ".ignore"] {
            add_ignore_file(&mut builder, &ancestor.join(name), &relative, warnings);
        }
    }
    add_ignore_file(
        &mut builder,
        &root.join(".git/info/exclude"),
        ".git/info",
        warnings,
    );
    builder.build().map_err(|_| {
        warnings.push("", FileTreeWarningReasonDto::InvalidIgnoreRule);
        FileTreeReadError::Files(FilesError::FileSystemReadFailed)
    })
}

/// Adds one regular non-link ignore file and records malformed rules.
fn add_ignore_file(
    builder: &mut GitignoreBuilder,
    path: &Path,
    relative_directory: &str,
    warnings: &mut WarningCollection,
) {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            warnings.push(
                relative_directory,
                FileTreeWarningReasonDto::InvalidIgnoreRule,
            );
            return;
        }
    };
    if !metadata.is_file() || ignore_source_is_link_like(&metadata) {
        warnings.push(
            relative_directory,
            FileTreeWarningReasonDto::InvalidIgnoreRule,
        );
        return;
    }
    if builder.add(path).is_some() {
        warnings.push(
            relative_directory,
            FileTreeWarningReasonDto::InvalidIgnoreRule,
        );
    }
}

/// Rejects any link or Windows reparse source before the ignore crate reads it.
fn ignore_source_is_link_like(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    false
}

/// Classifies metadata without following a link-like target.
fn classify(
    metadata: &std::fs::Metadata,
    root_metadata: &std::fs::Metadata,
) -> FileTreeEntryKindDto {
    if is_link_like(metadata, root_metadata) {
        FileTreeEntryKindDto::SymbolicLink
    } else if metadata.is_dir() {
        FileTreeEntryKindDto::Directory
    } else if metadata.is_file() {
        FileTreeEntryKindDto::File
    } else {
        FileTreeEntryKindDto::Other
    }
}

/// Produces the stable entry ordering tuple.
fn entry_key(entry: &FileTreeEntryDto) -> SortKey {
    SortKey {
        kind: match entry.kind {
            FileTreeEntryKindDto::Directory => 0,
            FileTreeEntryKindDto::File => 1,
            FileTreeEntryKindDto::SymbolicLink => 2,
            FileTreeEntryKindDto::Other => 3,
        },
        folded_name: entry.name.to_lowercase(),
        name: entry.name.clone(),
        relative_path: entry.relative_path.clone(),
    }
}

/// Encodes one versioned cursor without padding or absolute paths.
fn encode_cursor(directory: &str, entry: &FileTreeEntryDto) -> Result<String, FilesError> {
    let bytes = serde_json::to_vec(&CursorV1 {
        version: 1,
        directory: directory.to_owned(),
        key: entry_key(entry),
    })
    .map_err(|_| FilesError::InvalidCursor)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Decodes and binds a cursor to its requested directory.
fn decode_cursor(cursor: &str, directory: &str) -> Result<CursorV1, FilesError> {
    if cursor.len() > MAX_CURSOR_BYTES {
        return Err(FilesError::InvalidCursor);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| FilesError::InvalidCursor)?;
    let decoded: CursorV1 =
        serde_json::from_slice(&bytes).map_err(|_| FilesError::InvalidCursor)?;
    if decoded.version != 1
        || decoded.directory != directory
        || decoded.key.kind > 3
        || decoded.key.folded_name != decoded.key.name.to_lowercase()
        || decoded.key.relative_path != join_relative(directory, &decoded.key.name)
    {
        return Err(FilesError::InvalidCursor);
    }
    validate_relative_path(&decoded.key.relative_path, false)
        .map_err(|_| FilesError::InvalidCursor)?;
    Ok(decoded)
}

/// Converts a path under root into a slash-separated lossless identity.
fn slash_relative(root: &Path, path: &Path) -> Result<String, FileTreeReadError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| FileTreeReadError::Files(FilesError::FileSystemReadFailed))?;
    let mut output = Vec::new();
    for component in relative.components() {
        output.push(
            component
                .as_os_str()
                .to_str()
                .ok_or(FileTreeReadError::Files(FilesError::FileSystemReadFailed))?,
        );
    }
    Ok(output.join("/"))
}

/// Joins a normalized relative directory and basename.
fn join_relative(directory: &str, name: &str) -> String {
    if directory.is_empty() {
        name.to_owned()
    } else {
        format!("{directory}/{name}")
    }
}

/// Reports whether a basename is outside the always-pruned VCS set.
fn is_visible_vcs_name(name: &str) -> bool {
    !is_vcs_metadata(name)
}

/// Reports whether a basename identifies an always-pruned VCS directory.
fn is_vcs_metadata(name: &str) -> bool {
    matches!(name, ".git" | ".hg" | ".svn")
}

#[cfg(test)]
mod tests {
    use super::{FileTreeReader, NativeFileTreeReader};

    /// Verifies sorting, pagination, hidden visibility, and VCS pruning.
    #[test]
    fn listing_is_stable_and_prunes_vcs_metadata() {
        let fixture = tempfile::tempdir().expect("the fixture should be created");
        std::fs::create_dir(fixture.path().join("z-dir")).expect("the folder should be created");
        std::fs::create_dir(fixture.path().join(".git")).expect("the VCS folder should be created");
        std::fs::write(fixture.path().join("A.txt"), b"fixture")
            .expect("the file should be created");
        std::fs::write(fixture.path().join(".env"), b"fixture")
            .expect("the hidden file should be created");
        let root = std::fs::canonicalize(fixture.path()).expect("the root should canonicalize");

        let page = NativeFileTreeReader
            .list_children(&root, &root, None)
            .expect("the root should list");

        let names = page
            .entries
            .into_iter()
            .map(|entry| entry.name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["z-dir", ".env", "A.txt"]);
    }

    /// Verifies fresh local ignore rules affect list and search alike.
    #[test]
    fn ignore_rules_are_rebuilt_for_each_query() {
        let fixture = tempfile::tempdir().expect("the fixture should be created");
        std::fs::write(fixture.path().join("keep.txt"), b"fixture")
            .expect("the file should be created");
        std::fs::write(fixture.path().join("skip.txt"), b"fixture")
            .expect("the file should be created");
        std::fs::write(fixture.path().join(".gitignore"), b"skip.txt\n")
            .expect("the ignore file should be created");
        let root = std::fs::canonicalize(fixture.path()).expect("the root should canonicalize");
        let reader = NativeFileTreeReader;

        let first = reader
            .list_children(&root, &root, None)
            .expect("the root should list");
        assert!(!first.entries.iter().any(|entry| entry.name == "skip.txt"));
        std::fs::write(fixture.path().join(".gitignore"), b"keep.txt\n")
            .expect("the ignore file should change");
        let second = reader.search(&root, "txt").expect("the root should search");
        assert!(second.matches.iter().any(|entry| entry.name == "skip.txt"));
        assert!(!second.matches.iter().any(|entry| entry.name == "keep.txt"));
    }
}
