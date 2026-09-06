use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
};

use tokio::sync::Semaphore;

use crate::projects::ProjectService;

use super::{
    FilesRevealCallback,
    error::FilesError,
    models::{
        FileEntryPathsDto, FileEntryRequestDto, FileTreePageDto, FileTreeSearchDto,
        ListFileChildrenRequestDto, SearchFileTreeRequestDto,
    },
    path_policy::{FilePathIntent, FilePathPolicy, ProjectRootIdentity},
    platform::{CallbackFilePlatform, FilePlatform},
    walker::{FileTreeReadError, FileTreeReader, NativeFileTreeReader},
};

/// Owns bounded Files orchestration over registered project roots.
#[derive(Clone)]
pub struct FilesService {
    inner: Arc<ServiceInner>,
}

struct ServiceInner {
    projects: Arc<dyn ProjectRootSource>,
    reader: Arc<dyn FileTreeReader>,
    platform: Arc<dyn FilePlatform>,
    policy: FilePathPolicy,
    scan_limit: Arc<Semaphore>,
}

/// Boxes project-root futures while preserving object safety.
type ProjectRootFuture<'a> = Pin<Box<dyn Future<Output = Result<PathBuf, FilesError>> + Send + 'a>>;

/// Resolves the current project root through the owning Projects capability.
trait ProjectRootSource: Send + Sync {
    /// Returns one currently registered and available project root.
    fn available_root<'a>(&'a self, project_id: &'a str) -> ProjectRootFuture<'a>;
}

/// Adapts the public Projects owner query to the private Files seam.
struct ProjectsRootSource(ProjectService);

impl ProjectRootSource for ProjectsRootSource {
    /// Maps the public Projects result into the Files error vocabulary.
    fn available_root<'a>(&'a self, project_id: &'a str) -> ProjectRootFuture<'a> {
        Box::pin(async move {
            self.0
                .available_root(project_id)
                .await
                .map(|available| available.root_path)
                .map_err(|error| FilesError::from_projects(error, project_id))
        })
    }
}

impl FilesService {
    /// Creates the production service with a real filesystem reader.
    pub fn new(projects: ProjectService, reveal: FilesRevealCallback) -> Self {
        Self {
            inner: Arc::new(ServiceInner {
                projects: Arc::new(ProjectsRootSource(projects)),
                reader: Arc::new(NativeFileTreeReader),
                platform: Arc::new(CallbackFilePlatform::new(reveal)),
                policy: FilePathPolicy,
                scan_limit: Arc::new(Semaphore::new(2)),
            }),
        }
    }

    /// Creates a service from deterministic seams for focused unit tests.
    #[cfg(test)]
    fn with_seams(
        projects: Arc<dyn ProjectRootSource>,
        reader: Arc<dyn FileTreeReader>,
        reveal: FilesRevealCallback,
    ) -> Self {
        Self {
            inner: Arc::new(ServiceInner {
                projects,
                reader,
                platform: Arc::new(CallbackFilePlatform::new(reveal)),
                policy: FilePathPolicy,
                scan_limit: Arc::new(Semaphore::new(2)),
            }),
        }
    }

    /// Lists direct children after resolving the current registered project root.
    pub async fn list_children(
        &self,
        request: ListFileChildrenRequestDto,
    ) -> Result<FileTreePageDto, FilesError> {
        let project_id = request.project_id.clone();
        for attempt in 0..2 {
            let root = self.available_root(&project_id).await?;
            let directory = request.directory.clone();
            let cursor = request.cursor.clone();
            let reader = self.inner.reader.clone();
            let policy = self.inner.policy;
            let permit = self.acquire_scan().await?;
            let scan_root = root.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let validated =
                    policy.resolve(&scan_root, &directory, None, FilePathIntent::ListDirectory)?;
                if !directory.is_empty() && !map_reader(reader.is_visible(&scan_root, &directory))?
                {
                    return Err(FilesError::EntryNotVisible {
                        relative_path: directory,
                    });
                }
                map_reader(reader.list_children(
                    &scan_root,
                    &validated.absolute_path,
                    cursor.as_deref(),
                ))
            })
            .await
            .map_err(|_| FilesError::FileSystemReadFailed)?;
            drop(permit);
            let page = result?;
            if self.root_is_current(&project_id, &root).await? {
                let (warning_count, warnings_truncated, warnings) = page.warnings.into_parts();
                return Ok(FileTreePageDto {
                    project_id,
                    directory: request.directory,
                    entries: page.entries,
                    next_cursor: page.next_cursor,
                    warning_count,
                    warnings_truncated,
                    warnings,
                });
            }
            if attempt == 1 {
                break;
            }
        }
        Err(FilesError::ProjectRootChanged { project_id })
    }

    /// Searches names under the current registered project root.
    pub async fn search_tree(
        &self,
        request: SearchFileTreeRequestDto,
    ) -> Result<FileTreeSearchDto, FilesError> {
        let query = validate_search(&request.query)?;
        let project_id = request.project_id.clone();
        for attempt in 0..2 {
            let root = self.available_root(&project_id).await?;
            let reader = self.inner.reader.clone();
            let scan_root = root.clone();
            let scan_query = query.clone();
            let permit = self.acquire_scan().await?;
            let result = tauri::async_runtime::spawn_blocking(move || {
                map_reader(reader.search(&scan_root, &scan_query))
            })
            .await
            .map_err(|_| FilesError::FileSystemReadFailed)?;
            drop(permit);
            let search = result?;
            if self.root_is_current(&project_id, &root).await? {
                let (warning_count, warnings_truncated, warnings) = search.warnings.into_parts();
                return Ok(FileTreeSearchDto {
                    project_id,
                    query,
                    matches: search.matches,
                    truncated_reason: search.truncated_reason,
                    warning_count,
                    warnings_truncated,
                    warnings,
                });
            }
            if attempt == 1 {
                break;
            }
        }
        Err(FilesError::ProjectRootChanged { project_id })
    }

    /// Returns copyable paths after revalidating a visible entry.
    pub async fn entry_paths(
        &self,
        request: FileEntryRequestDto,
    ) -> Result<FileEntryPathsDto, FilesError> {
        for attempt in 0..2 {
            let (root, target) = self
                .validate_visible_entry(
                    &request.project_id,
                    &request.relative_path,
                    FilePathIntent::ReadVisibleEntry,
                )
                .await?;
            if self.root_is_current(&request.project_id, &root).await? {
                let absolute_path = target
                    .to_str()
                    .ok_or(FilesError::FileSystemReadFailed)?
                    .to_owned();
                return Ok(FileEntryPathsDto {
                    relative_path: request.relative_path,
                    absolute_path,
                });
            }
            if attempt == 1 {
                break;
            }
        }
        Err(FilesError::ProjectRootChanged {
            project_id: request.project_id,
        })
    }

    /// Reveals a validated non-link entry through the platform adapter.
    pub async fn reveal_entry(&self, request: FileEntryRequestDto) -> Result<(), FilesError> {
        for attempt in 0..2 {
            let (root, target) = self
                .validate_visible_entry(
                    &request.project_id,
                    &request.relative_path,
                    FilePathIntent::RevealVisibleEntry,
                )
                .await?;
            if !self.root_is_current(&request.project_id, &root).await? {
                if attempt == 0 {
                    continue;
                }
                break;
            }
            let policy = self.inner.policy;
            let platform = self.inner.platform.clone();
            let relative_path = request.relative_path.clone();
            let reveal_root = root.clone();
            let permit = self.acquire_scan().await?;
            let result = tauri::async_runtime::spawn_blocking(move || {
                let validated = policy.resolve(
                    &reveal_root,
                    &relative_path,
                    None,
                    FilePathIntent::RevealVisibleEntry,
                )?;
                policy.revalidate(&validated)?;
                if validated.absolute_path != target {
                    return Err(FilesError::FileSystemReadFailed);
                }
                platform.reveal_item(&validated.absolute_path)
            })
            .await
            .map_err(|_| FilesError::FileSystemReadFailed)?;
            drop(permit);
            return result;
        }
        Err(FilesError::ProjectRootChanged {
            project_id: request.project_id,
        })
    }

    /// Resolves one visible entry inside the shared blocking admission limit.
    async fn validate_visible_entry(
        &self,
        project_id: &str,
        relative_path: &str,
        intent: FilePathIntent,
    ) -> Result<(std::path::PathBuf, std::path::PathBuf), FilesError> {
        let root = self.available_root(project_id).await?;
        let reader = self.inner.reader.clone();
        let policy = self.inner.policy;
        let scan_root = root.clone();
        let path = relative_path.to_owned();
        let permit = self.acquire_scan().await?;
        let target = tauri::async_runtime::spawn_blocking(move || {
            let validated = policy.resolve(&scan_root, &path, None, intent)?;
            if !map_reader(reader.is_visible(&scan_root, &path))? {
                return Err(FilesError::EntryNotVisible {
                    relative_path: path,
                });
            }
            Ok(validated.absolute_path)
        })
        .await
        .map_err(|_| FilesError::FileSystemReadFailed)?;
        drop(permit);
        Ok((root, target?))
    }

    /// Resolves and canonicalizes the currently registered available root.
    async fn available_root(&self, project_id: &str) -> Result<std::path::PathBuf, FilesError> {
        self.inner.projects.available_root(project_id).await
    }

    /// Compares the current project root with the scan snapshot.
    async fn root_is_current(
        &self,
        project_id: &str,
        previous_root: &Path,
    ) -> Result<bool, FilesError> {
        let current = self.available_root(project_id).await?;
        let previous = self.inner.policy.identify_root(previous_root)?;
        let current = self.inner.policy.identify_root(&current)?;
        Ok(same_identity(&previous, &current))
    }

    /// Acquires one of the process-local blocking scan permits.
    async fn acquire_scan(&self) -> Result<tokio::sync::OwnedSemaphorePermit, FilesError> {
        self.inner
            .scan_limit
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| FilesError::FileSystemReadFailed)
    }
}

/// Maps the reader's private error into the public safe category.
fn map_reader<T>(result: Result<T, FileTreeReadError>) -> Result<T, FilesError> {
    result.map_err(|error| match error {
        FileTreeReadError::Files(error) => error,
    })
}

/// Trims and validates the public Unicode search contract.
fn validate_search(query: &str) -> Result<String, FilesError> {
    let trimmed = query.trim();
    let scalar_count = trimmed.chars().count();
    if !(1..=128).contains(&scalar_count) || trimmed.chars().any(char::is_control) {
        return Err(FilesError::InvalidSearch);
    }
    Ok(trimmed.to_owned())
}

/// Compares two roots through their OS-specific identity key.
fn same_identity(left: &ProjectRootIdentity, right: &ProjectRootIdentity) -> bool {
    left == right
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        path::{Path, PathBuf},
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use super::{FilesService, ProjectRootFuture, ProjectRootSource, validate_search};
    use crate::files::{
        FilesError, ListFileChildrenRequestDto,
        walker::{
            FileTreePage, FileTreeReadError, FileTreeReader, FileTreeSearch, NativeFileTreeReader,
        },
    };

    /// Returns queued roots before falling back to the final configured root.
    struct RootSequence {
        roots: Mutex<VecDeque<PathBuf>>,
        fallback: PathBuf,
    }

    impl ProjectRootSource for RootSequence {
        /// Resolves one root from the deterministic sequence.
        fn available_root<'a>(&'a self, _project_id: &'a str) -> ProjectRootFuture<'a> {
            let root = self
                .roots
                .lock()
                .expect("the root sequence should be available")
                .pop_front()
                .unwrap_or_else(|| self.fallback.clone());
            Box::pin(async move { Ok(root) })
        }
    }

    /// Tracks concurrent list workers while delegating real filesystem behavior.
    struct ControlledReader {
        active: Arc<AtomicUsize>,
        maximum: Arc<AtomicUsize>,
    }

    impl FileTreeReader for ControlledReader {
        /// Delays one real list so concurrent admission is observable.
        fn list_children(
            &self,
            root: &Path,
            directory: &Path,
            cursor: Option<&str>,
        ) -> Result<FileTreePage, FileTreeReadError> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.maximum.fetch_max(active, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(80));
            let result = NativeFileTreeReader.list_children(root, directory, cursor);
            self.active.fetch_sub(1, Ordering::SeqCst);
            result
        }

        /// Delegates search because this seam only controls list admission.
        fn search(&self, root: &Path, query: &str) -> Result<FileTreeSearch, FileTreeReadError> {
            NativeFileTreeReader.search(root, query)
        }

        /// Delegates visibility checks to the production reader.
        fn is_visible(&self, root: &Path, relative_path: &str) -> Result<bool, FileTreeReadError> {
            NativeFileTreeReader.is_visible(root, relative_path)
        }
    }

    /// Creates a no-op reveal callback for service unit tests.
    fn no_reveal() -> super::FilesRevealCallback {
        Arc::new(
            // Unit tests in this module never dispatch a native reveal.
            |_path| Ok(()),
        )
    }

    /// Creates one root source that always returns the supplied path.
    fn stable_roots(root: &Path) -> Arc<dyn ProjectRootSource> {
        Arc::new(RootSequence {
            roots: Mutex::new(VecDeque::new()),
            fallback: root.to_path_buf(),
        })
    }

    /// Creates one valid root-list request for a fixed project identity.
    fn root_request() -> ListFileChildrenRequestDto {
        ListFileChildrenRequestDto {
            project_id: "11111111-1111-4111-8111-111111111111".to_owned(),
            directory: String::new(),
            cursor: None,
        }
    }

    /// Verifies search trimming, scalar limits, and control rejection.
    #[test]
    fn search_validation_matches_the_public_contract() {
        assert_eq!(validate_search("  TeSt  "), Ok("TeSt".to_owned()));
        assert_eq!(validate_search("  "), Err(FilesError::InvalidSearch));
        assert_eq!(validate_search("bad\u{7f}"), Err(FilesError::InvalidSearch));
        assert_eq!(
            validate_search(&"x".repeat(129)),
            Err(FilesError::InvalidSearch)
        );
    }

    /// Verifies exactly two blocking scans may enter at once and queued work completes.
    #[test]
    fn scan_admission_is_bounded_at_two_workers() {
        let fixture = tempfile::tempdir().expect("the fixture should be created");
        let root = std::fs::canonicalize(fixture.path()).expect("the root should canonicalize");
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let service = FilesService::with_seams(
            stable_roots(&root),
            Arc::new(ControlledReader {
                active: active.clone(),
                maximum: maximum.clone(),
            }),
            no_reveal(),
        );
        let threads = (0..3)
            .map(
                // Starts three callers together against the same service semaphore.
                |_| {
                    let service = service.clone();
                    std::thread::spawn(move || {
                        tauri::async_runtime::block_on(service.list_children(root_request()))
                            .expect("the queued list should complete")
                    })
                },
            )
            .collect::<Vec<_>>();
        for thread in threads {
            thread.join().expect("the list thread should finish");
        }
        assert_eq!(maximum.load(Ordering::SeqCst), 2);
        assert_eq!(active.load(Ordering::SeqCst), 0);
    }

    /// Verifies one root relocation discards the stale page and retries once.
    #[test]
    fn one_root_change_retries_from_the_new_root() {
        let first = tempfile::tempdir().expect("the first root should be created");
        let second = tempfile::tempdir().expect("the second root should be created");
        std::fs::write(first.path().join("old.txt"), b"old")
            .expect("the old fixture should be created");
        std::fs::write(second.path().join("new.txt"), b"new")
            .expect("the new fixture should be created");
        let first_root =
            std::fs::canonicalize(first.path()).expect("the first root should resolve");
        let second_root =
            std::fs::canonicalize(second.path()).expect("the second root should resolve");
        let service = FilesService::with_seams(
            Arc::new(RootSequence {
                roots: Mutex::new(VecDeque::from([
                    first_root,
                    second_root.clone(),
                    second_root.clone(),
                    second_root.clone(),
                ])),
                fallback: second_root,
            }),
            Arc::new(NativeFileTreeReader),
            no_reveal(),
        );

        let page = tauri::async_runtime::block_on(service.list_children(root_request()))
            .expect("one relocation should retry successfully");
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].name, "new.txt");
    }

    /// Verifies a second root relocation returns the typed race error.
    #[test]
    fn two_root_changes_return_project_root_changed() {
        let roots = (0..3)
            .map(
                // Creates three distinct owned roots for the controlled race.
                |_| {
                    tempfile::tempdir()
                        .expect("the root should be created")
                        .keep()
                },
            )
            .collect::<Vec<_>>();
        let service = FilesService::with_seams(
            Arc::new(RootSequence {
                roots: Mutex::new(VecDeque::from([
                    roots[0].clone(),
                    roots[1].clone(),
                    roots[1].clone(),
                    roots[2].clone(),
                ])),
                fallback: roots[2].clone(),
            }),
            Arc::new(NativeFileTreeReader),
            no_reveal(),
        );

        assert_eq!(
            tauri::async_runtime::block_on(service.list_children(root_request())),
            Err(FilesError::ProjectRootChanged {
                project_id: "11111111-1111-4111-8111-111111111111".to_owned(),
            })
        );
        for root in roots {
            std::fs::remove_dir(root).expect("the retained temporary root should be removed");
        }
    }
}
