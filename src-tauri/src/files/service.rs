use std::{
    collections::HashMap,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use tokio::sync::Semaphore;

use crate::{
    projects::ProjectService,
    sessions::{CloseRetention, PaneCloseImpact, PaneContentOwner, PaneContentRef, ReopenHandle},
    shared::DataMaintenanceGate,
    storage::Storage,
};

use super::{
    FileDependencies, FileHandleEventSink, FilesClock, FilesOpenCallback, FilesRevealCallback,
    RecentFilesEventSink,
    error::FilesError,
    models::{
        FileContentDto, FileEditorSnapshot, FileEntryPathsDto, FileEntryRequestDto,
        FileHandleChangeKindDto, FileHandleChangedEventDto, FileHandleDto, FileHandleStateDto,
        FileTreePageDto, FileTreeSearchDto, ListFileChildrenRequestDto, MAX_FILE_HANDLES,
        MAX_TEXT_BUFFER_BYTES, OpenFileInPaneRequestDto, OpenFileResultDto, OpenFileWarningDto,
        OpenableFileSearchItem, OpenableFileSearchSlice, RecentFileAvailabilityDto, RecentFileDto,
        RecentFilesChangedEventDto, RecentFilesResetPlan, RecentFilesResetProjection,
        ResolveExternalFileChangeRequestDto, SearchFileTreeRequestDto, TextFileDto,
        TextFileModeDto,
    },
    path_policy::{FilePathIntent, FilePathPolicy, ProjectRootIdentity},
    platform::{CallbackFilePlatform, FilePlatform},
    reader::{DiskFileSnapshot, DiskFingerprint, FileReader},
    repository::RecentFilesRepository,
    walker::{FileTreeReadError, FileTreeReader, NativeFileTreeReader},
    watcher::ParentWatcherRegistry,
};

/// Owns bounded Files orchestration over registered project roots.
#[derive(Clone)]
pub struct FilesService {
    inner: Arc<ServiceInner>,
}

pub(crate) struct ServiceInner {
    projects: Arc<dyn ProjectRootSource>,
    reader: Arc<dyn FileTreeReader>,
    platform: Arc<dyn FilePlatform>,
    policy: FilePathPolicy,
    scan_limit: Arc<Semaphore>,
    runtime: Option<RuntimeState>,
}

struct RuntimeState {
    dependencies: Arc<dyn FileDependencies>,
    repository: RecentFilesRepository,
    maintenance: DataMaintenanceGate,
    handles: Mutex<HandleState>,
    watchers: ParentWatcherRegistry,
    open_external: FilesOpenCallback,
    clock: FilesClock,
    handle_events: FileHandleEventSink,
    recent_events: RecentFilesEventSink,
}

#[derive(Default)]
struct HandleState {
    live: HashMap<String, HandleRecord>,
    retained: HashMap<String, RetainedHandle>,
    text_bytes: usize,
}

#[derive(Clone)]
struct HandleRecord {
    dto: FileHandleDto,
    root: PathBuf,
    root_identity: ProjectRootIdentity,
    parent: PathBuf,
    fingerprint: DiskFingerprint,
    base_text: Option<TextFileDto>,
    recovery_text: Option<TextFileDto>,
    previous_clean_disk_revision: Option<String>,
}

#[derive(Clone)]
struct RetainedHandle {
    file_handle_id: String,
    project_id: String,
    relative_path: String,
    root_identity: ProjectRootIdentity,
    session_id: String,
    tab_id: String,
    pane_id: String,
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

/// Adapts the complete Files dependency port to legacy tree root lookups.
struct DependenciesRootSource(Arc<dyn FileDependencies>);

impl ProjectRootSource for DependenciesRootSource {
    /// Resolves the current root through the Files dependency port.
    fn available_root<'a>(&'a self, project_id: &'a str) -> ProjectRootFuture<'a> {
        self.0.available_project_root(project_id)
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
                runtime: None,
            }),
        }
    }

    /// Creates the complete stage16 service with isolated owner and native seams.
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_runtime(
        dependencies: Arc<dyn FileDependencies>,
        storage: Storage,
        maintenance: DataMaintenanceGate,
        reveal: FilesRevealCallback,
        open_external: FilesOpenCallback,
        clock: FilesClock,
        handle_events: FileHandleEventSink,
        recent_events: RecentFilesEventSink,
    ) -> Self {
        let projects: Arc<dyn ProjectRootSource> =
            Arc::new(DependenciesRootSource(dependencies.clone()));
        let repository = RecentFilesRepository::new(storage);
        let inner = Arc::new_cyclic(|weak: &std::sync::Weak<ServiceInner>| {
            let weak_service = weak.clone();
            let hint = Arc::new(move |path: Option<PathBuf>| {
                let Some(inner) = weak_service.upgrade() else {
                    return;
                };
                tauri::async_runtime::spawn(async move {
                    let service = FilesService { inner };
                    if let Some(path) = path {
                        let _ = service.reconcile_path(&path).await;
                    } else {
                        let _ = service.reconcile_open_files().await;
                    }
                });
            });
            ServiceInner {
                projects,
                reader: Arc::new(NativeFileTreeReader),
                platform: Arc::new(CallbackFilePlatform::new(reveal)),
                policy: FilePathPolicy,
                scan_limit: Arc::new(Semaphore::new(2)),
                runtime: Some(RuntimeState {
                    dependencies,
                    repository,
                    maintenance,
                    handles: Mutex::new(HandleState::default()),
                    watchers: ParentWatcherRegistry::new(hint),
                    open_external,
                    clock,
                    handle_events,
                    recent_events,
                }),
            }
        });
        Self { inner }
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
                runtime: None,
            }),
        }
    }

    /// Reconstructs a public service around one upgraded lifecycle owner.
    pub(crate) fn from_inner(inner: Arc<ServiceInner>) -> Self {
        Self { inner }
    }

    /// Returns the weak lifecycle manager bound to this service.
    pub fn handle_manager(&self) -> super::FileHandleManager {
        super::FileHandleManager::new(&self.inner)
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

    /// Opens, classifies, watches, attaches, and records one visible regular file.
    pub async fn open_file_in_pane(
        &self,
        request: OpenFileInPaneRequestDto,
    ) -> Result<OpenFileResultDto, FilesError> {
        let runtime = self.runtime()?;
        let observed_at_ms = (runtime.clock)()?;
        let target = runtime
            .dependencies
            .resolve_empty_pane(&request.session_id, &request.tab_id, &request.pane_id)
            .await?;
        let root = runtime
            .dependencies
            .available_project_root(&target.project_id)
            .await?;
        let snapshot = self
            .read_new_visible(&root, &request.relative_path, observed_at_ms)
            .await?;
        let root_identity = self.inner.policy.identify_root(&root)?;
        let name = request
            .relative_path
            .rsplit('/')
            .next()
            .ok_or(FilesError::InvalidRelativePath)?
            .to_owned();
        let id = uuid::Uuid::new_v4().to_string();
        let parent = root
            .join(
                request
                    .relative_path
                    .replace('/', std::path::MAIN_SEPARATOR_STR),
            )
            .parent()
            .ok_or(FilesError::InvalidRelativePath)?
            .to_path_buf();
        let watch_mode = runtime.watchers.watch(&parent);
        let dto = FileHandleDto {
            id: id.clone(),
            project_id: target.project_id.clone(),
            session_id: target.session_id.clone(),
            tab_id: target.tab_id.clone(),
            pane_id: target.pane_id.clone(),
            name: name.clone(),
            relative_path: request.relative_path.clone(),
            revision: "1".to_owned(),
            watch_mode,
            is_dirty: false,
            dirty_since_ms: None,
            edit_count: 0,
            state: FileHandleStateDto::Ready {
                content: snapshot.content.clone(),
                disk: snapshot.disk.clone(),
            },
        };
        if let Err(error) = self.insert_live(HandleRecord {
            dto: dto.clone(),
            root,
            root_identity,
            parent: parent.clone(),
            fingerprint: snapshot.fingerprint,
            base_text: text_content(&snapshot.content),
            recovery_text: None,
            previous_clean_disk_revision: None,
        }) {
            runtime.watchers.unwatch(&parent, watch_mode);
            return Err(error);
        }
        if runtime
            .dependencies
            .attach_file(&target, &id, &name)
            .await
            .is_err()
        {
            self.remove_live(&id);
            return Err(FilesError::SessionAttachFailed);
        }
        let mut warnings = Vec::new();
        let _permit = runtime.maintenance.read_permit().await;
        let repository = runtime.repository.clone();
        let project_id = target.project_id.clone();
        let relative_path = request.relative_path.clone();
        let record = tauri::async_runtime::spawn_blocking(move || {
            repository.record(&project_id, &relative_path, observed_at_ms)
        })
        .await;
        if !matches!(record, Ok(Ok(()))) {
            warnings.push(OpenFileWarningDto::RecentFileNotRecorded);
        } else {
            let _ = (runtime.recent_events)(RecentFilesChangedEventDto {
                project_id: target.project_id,
            });
        }
        Ok(OpenFileResultDto {
            file: dto,
            warnings,
        })
    }

    /// Returns one current attached or retained handle snapshot without disk access.
    pub fn get_open_file(&self, file_handle_id: &str) -> Result<FileHandleDto, FilesError> {
        validate_handle_id(file_handle_id)?;
        self.runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileHandleNotFound {
                file_handle_id: file_handle_id.to_owned(),
            })?
            .live
            .get(file_handle_id)
            .map(|record| record.dto.clone())
            .ok_or_else(|| FilesError::FileHandleNotFound {
                file_handle_id: file_handle_id.to_owned(),
            })
    }

    /// Reconciles one clean attached handle against its current disk version.
    pub async fn reload_open_file(
        &self,
        file_handle_id: &str,
    ) -> Result<FileHandleDto, FilesError> {
        let current = self.get_record(file_handle_id)?;
        if current.dto.is_dirty
            || matches!(
                current.dto.state,
                FileHandleStateDto::ExternalConflict { .. }
            )
        {
            return Err(FilesError::UnsavedChangesWouldBeLost);
        }
        self.reconcile_handle(file_handle_id, true).await?;
        self.get_open_file(file_handle_id)
    }

    /// Resolves one external conflict after verifying both handle and disk revisions.
    pub async fn resolve_external_file_change(
        &self,
        request: ResolveExternalFileChangeRequestDto,
    ) -> Result<FileHandleDto, FilesError> {
        let current = self.get_record(&request.file_handle_id)?;
        if request.expected_revision != current.dto.revision {
            return Err(FilesError::RevisionConflict {
                current_revision: current.dto.revision,
            });
        }
        let expected_external = match &current.dto.state {
            FileHandleStateDto::ExternalConflict { external, .. } => external.disk_revision.clone(),
            _ => return Err(FilesError::NoExternalConflict),
        };
        let snapshot = self
            .read_existing(&current, (self.runtime()?.clock)()?)
            .await?;
        if snapshot.disk.disk_revision != expected_external {
            self.commit_snapshot(
                &request.file_handle_id,
                snapshot,
                FileHandleChangeKindDto::ConflictDetected,
                true,
            )?;
            let latest = self.get_open_file(&request.file_handle_id)?;
            return Err(FilesError::FileChangedAgain {
                current_revision: latest.revision,
            });
        }
        let runtime = self.runtime()?;
        let mut handles = runtime
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?;
        let live = handles.live.get(&request.file_handle_id).ok_or_else(|| {
            FilesError::FileHandleNotFound {
                file_handle_id: request.file_handle_id.clone(),
            }
        })?;
        if live.dto.revision != request.expected_revision {
            return Err(FilesError::RevisionConflict {
                current_revision: live.dto.revision.clone(),
            });
        }
        let old_bytes = record_text_bytes(live);
        let mut next = live.clone();
        increment_revision(&mut next.dto)?;
        match request.resolution {
            super::ExternalFileResolutionDto::KeepMine => {
                let local = local_text(&next.dto.state).ok_or(FilesError::NoExternalConflict)?;
                next.base_text = text_content(&snapshot.content);
                next.dto.state = FileHandleStateDto::Ready {
                    content: FileContentDto::Text { file: local },
                    disk: snapshot.disk.clone(),
                };
            }
            super::ExternalFileResolutionDto::ReloadFromDisk => {
                next.dto.is_dirty = false;
                next.dto.dirty_since_ms = None;
                next.dto.edit_count = 0;
                next.base_text = text_content(&snapshot.content);
                next.dto.state = FileHandleStateDto::Ready {
                    content: snapshot.content.clone(),
                    disk: snapshot.disk.clone(),
                };
            }
        }
        next.fingerprint = snapshot.fingerprint;
        next.previous_clean_disk_revision = None;
        next.recovery_text = None;
        let projected = handles
            .text_bytes
            .saturating_sub(old_bytes)
            .saturating_add(record_text_bytes(&next));
        if projected > MAX_TEXT_BUFFER_BYTES {
            return Err(FilesError::FileMemoryLimitReached);
        }
        handles.text_bytes = projected;
        let dto = next.dto.clone();
        handles.live.insert(request.file_handle_id.clone(), next);
        drop(handles);
        let _ = (runtime.handle_events)(FileHandleChangedEventDto {
            file_handle_id: dto.id.clone(),
            revision: dto.revision.clone(),
            change: FileHandleChangeKindDto::Reloaded,
        });
        Ok(dto)
    }

    /// Opens one attached handle through the injected default-application adapter.
    pub async fn open_file_with_default_app(&self, file_handle_id: &str) -> Result<(), FilesError> {
        let record = self.get_record(file_handle_id)?;
        let root = self
            .runtime()?
            .dependencies
            .available_project_root(&record.dto.project_id)
            .await?;
        if self.inner.policy.identify_root(&root)? != record.root_identity {
            return Err(FilesError::ProjectRootChanged {
                project_id: record.dto.project_id,
            });
        }
        let path = record.dto.relative_path.clone();
        let policy = self.inner.policy;
        let callback = self.runtime()?.open_external.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let target = policy.resolve(
                &root,
                &path,
                Some(&record.root_identity),
                FilePathIntent::ExistingHandleFile,
            )?;
            policy.revalidate(&target)?;
            callback(&target.absolute_path).map_err(|_| FilesError::OpenExternalFailed)
        })
        .await
        .map_err(|_| FilesError::OpenExternalFailed)?
    }

    /// Lists durable recent paths enriched with current filesystem and runtime availability.
    pub async fn list_recent_files(
        &self,
        project_id: &str,
        limit: Option<u32>,
    ) -> Result<Vec<RecentFileDto>, FilesError> {
        uuid::Uuid::parse_str(project_id).map_err(|_| FilesError::InvalidProjectId)?;
        let limit = limit.unwrap_or(10);
        if !(1..=50).contains(&limit) {
            return Err(FilesError::InvalidLimit);
        }
        let runtime = self.runtime()?;
        let repository = runtime.repository.clone();
        let project = project_id.to_owned();
        let rows = tauri::async_runtime::spawn_blocking(move || repository.list(&project, limit))
            .await
            .map_err(|_| FilesError::RecentFilesFailed)??;
        let root = runtime
            .dependencies
            .available_project_root(project_id)
            .await;
        let live = runtime
            .handles
            .lock()
            .map_err(|_| FilesError::RecentFilesFailed)?
            .live
            .values()
            .map(|record| {
                (
                    record.dto.project_id.clone(),
                    record.dto.relative_path.clone(),
                    record.dto.is_dirty,
                )
            })
            .collect::<Vec<_>>();
        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            let availability = match &root {
                Err(FilesError::ProjectUnavailable { .. }) => {
                    RecentFileAvailabilityDto::ProjectUnavailable
                }
                Err(FilesError::ProjectNotFound { project_id }) => {
                    return Err(FilesError::ProjectNotFound {
                        project_id: project_id.clone(),
                    });
                }
                Err(_) => RecentFileAvailabilityDto::Unreadable,
                Ok(root) => self.recent_availability(root, &row.relative_path).await,
            };
            let name = row
                .relative_path
                .rsplit('/')
                .next()
                .unwrap_or(&row.relative_path)
                .to_owned();
            let parent_path = row
                .relative_path
                .rsplit_once('/')
                .map_or(String::new(), |(parent, _)| parent.to_owned());
            let matching = live
                .iter()
                .filter(|(owner, path, _)| {
                    owner == project_id && path_key(path) == path_key(&row.relative_path)
                })
                .collect::<Vec<_>>();
            result.push(RecentFileDto {
                project_id: row.project_id,
                name,
                parent_path,
                relative_path: row.relative_path,
                opened_at_ms: row.opened_at_ms,
                availability,
                is_open: !matching.is_empty(),
                has_unsaved_changes: matching.iter().any(|(_, _, dirty)| *dirty),
            });
        }
        Ok(result)
    }

    /// Returns bounded regular-file candidates in Projects-owned order.
    pub async fn search_openable_files(
        &self,
        query: &str,
        candidate_limit: u32,
    ) -> Result<OpenableFileSearchSlice, FilesError> {
        let query = validate_search(query)?;
        if !(1..=64).contains(&candidate_limit) {
            return Err(FilesError::InvalidLimit);
        }
        let runtime = self.runtime()?;
        let project_ids = runtime.dependencies.ordered_project_ids().await?;
        let mut items = Vec::new();
        let mut has_more = false;
        for (source_order, project_id) in project_ids.into_iter().enumerate() {
            let root = match runtime
                .dependencies
                .available_project_root(&project_id)
                .await
            {
                Ok(root) => root,
                Err(FilesError::ProjectUnavailable { .. }) => continue,
                Err(error) => return Err(error),
            };
            let remaining = candidate_limit as usize + 1 - items.len();
            if remaining == 0 {
                has_more = true;
                break;
            }
            let query_copy = query.clone();
            let files = tauri::async_runtime::spawn_blocking(move || {
                super::walker::search_regular_files(&root, &query_copy, remaining)
            })
            .await
            .map_err(|_| FilesError::FileSystemReadFailed)??;
            for entry in files {
                if items.len() == candidate_limit as usize {
                    has_more = true;
                    break;
                }
                items.push(OpenableFileSearchItem {
                    project_id: project_id.clone(),
                    relative_path: entry.relative_path,
                    file_name: entry.name,
                    source_order: u32::try_from(source_order).unwrap_or(u32::MAX),
                });
            }
            if has_more {
                break;
            }
        }
        Ok(OpenableFileSearchSlice { items, has_more })
    }

    /// Replaces a Markdown buffer while deriving all dirty metadata in the backend.
    pub async fn replace_editor_snapshot(
        &self,
        file_handle_id: &str,
        snapshot: FileEditorSnapshot,
    ) -> Result<FileHandleDto, FilesError> {
        let now = (self.runtime()?.clock)()?;
        let runtime = self.runtime()?;
        let mut handles = runtime
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?;
        let (current_revision, current_disk, watcher_race, base, current_local, old_bytes) =
            {
                let record = handles.live.get(file_handle_id).ok_or_else(|| {
                    FilesError::FileHandleNotFound {
                        file_handle_id: file_handle_id.to_owned(),
                    }
                })?;
                let current_revision = record.dto.revision.clone();
                let current_disk =
                    disk_version(&record.dto.state).ok_or(FilesError::RevisionConflict {
                        current_revision: current_revision.clone(),
                    })?;
                (
                    current_revision,
                    current_disk,
                    record.previous_clean_disk_revision.as_deref()
                        == Some(snapshot.base_disk_revision.as_str()),
                    record
                        .base_text
                        .clone()
                        .ok_or(FilesError::UnsavedChangesWouldBeLost)?,
                    local_text(&record.dto.state),
                    record_text_bytes(record),
                )
            };
        if snapshot.expected_handle_revision != current_revision && !watcher_race {
            return Err(FilesError::RevisionConflict { current_revision });
        }
        if base.mode != TextFileModeDto::Markdown {
            return Err(FilesError::UnsavedChangesWouldBeLost);
        }
        let current_local = current_local.unwrap_or_else(|| base.clone());
        if current_local.text == snapshot.text {
            return Ok(handles
                .live
                .get(file_handle_id)
                .expect("handle exists")
                .dto
                .clone());
        }
        let mut local = current_local;
        local.byte_size = snapshot.text.len() as u64;
        local.text = snapshot.text;
        let new_bytes = local.text.len().saturating_add(base.text.len());
        let projected = handles
            .text_bytes
            .saturating_sub(old_bytes)
            .saturating_add(new_bytes);
        if projected > MAX_TEXT_BUFFER_BYTES {
            return Err(FilesError::FileMemoryLimitReached);
        }
        handles.text_bytes = projected;
        let record = handles.live.get_mut(file_handle_id).expect("handle exists");
        increment_revision(&mut record.dto)?;
        if local.text == base.text {
            record.dto.is_dirty = false;
            record.dto.dirty_since_ms = None;
            record.dto.edit_count = 0;
            record.dto.state = FileHandleStateDto::Ready {
                content: FileContentDto::Text { file: local },
                disk: current_disk,
            };
        } else {
            if !record.dto.is_dirty {
                record.dto.dirty_since_ms = Some(now);
                record.dto.edit_count = 1;
            } else {
                record.dto.edit_count = record.dto.edit_count.saturating_add(1);
            }
            record.dto.is_dirty = true;
            if snapshot.base_disk_revision != current_disk.disk_revision || watcher_race {
                record.dto.state = FileHandleStateDto::ExternalConflict {
                    local,
                    external: current_disk,
                };
            } else {
                record.dto.state = FileHandleStateDto::Ready {
                    content: FileContentDto::Text { file: local },
                    disk: current_disk,
                };
            }
        }
        record.previous_clean_disk_revision = None;
        Ok(record.dto.clone())
    }

    /// Reconciles every attached handle after focus or watcher overflow recovery.
    pub async fn reconcile_open_files(&self) -> Result<(), FilesError> {
        let ids = self
            .runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .live
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.reconcile_handle(&id, false).await;
        }
        Ok(())
    }

    /// Prepares recent reset facts in the coordinator transaction.
    pub fn prepare_recent_files_reset_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<RecentFilesResetPlan, FilesError> {
        self.runtime()?.repository.prepare_reset_in(tx)
    }

    /// Applies recent reset through the coordinator-owned transaction.
    pub fn reset_recent_files_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &RecentFilesResetPlan,
    ) -> Result<RecentFilesResetProjection, FilesError> {
        self.runtime()?.repository.reset_in(tx, plan)
    }

    /// Publishes deterministic recent invalidations after commit.
    pub fn publish_recent_files_reset(&self, projection: RecentFilesResetProjection) {
        if let Ok(runtime) = self.runtime() {
            for project_id in projection.affected_project_ids {
                let _ = (runtime.recent_events)(RecentFilesChangedEventDto { project_id });
            }
        }
    }

    /// Returns the complete runtime or fails closed for tree-only composition.
    fn runtime(&self) -> Result<&RuntimeState, FilesError> {
        self.inner
            .runtime
            .as_ref()
            .ok_or(FilesError::SessionAttachFailed)
    }

    /// Reads one new file only after the existing visibility policy accepts it.
    async fn read_new_visible(
        &self,
        root: &Path,
        relative_path: &str,
        observed_at_ms: i64,
    ) -> Result<DiskFileSnapshot, FilesError> {
        let root = root.to_path_buf();
        let path = relative_path.to_owned();
        let reader = self.inner.reader.clone();
        let policy = self.inner.policy;
        let permit = self.acquire_scan().await?;
        let result = tauri::async_runtime::spawn_blocking(move || {
            if !map_reader(reader.is_visible(&root, &path))? {
                return Err(FilesError::EntryNotVisible {
                    relative_path: path,
                });
            }
            let target = policy
                .resolve(&root, &path, None, FilePathIntent::OpenVisibleFile)
                .map_err(|error| match error {
                    FilesError::EntryNotFound { .. } => FilesError::EntryNotFound {
                        relative_path: path.clone(),
                    },
                    other => other,
                })?;
            FileReader.read(policy, &target, observed_at_ms)
        })
        .await
        .map_err(|_| FilesError::FileReadFailed)?;
        drop(permit);
        result
    }

    /// Reads an existing handle only while its captured root identity remains current.
    async fn read_existing(
        &self,
        record: &HandleRecord,
        observed_at_ms: i64,
    ) -> Result<DiskFileSnapshot, FilesError> {
        let root = self
            .runtime()?
            .dependencies
            .available_project_root(&record.dto.project_id)
            .await?;
        if self.inner.policy.identify_root(&root)? != record.root_identity {
            return Err(FilesError::ProjectRootChanged {
                project_id: record.dto.project_id.clone(),
            });
        }
        let path = record.dto.relative_path.clone();
        let expected = record.root_identity.clone();
        let policy = self.inner.policy;
        let permit = self.acquire_scan().await?;
        let result = tauri::async_runtime::spawn_blocking(move || {
            let target = policy.resolve(
                &root,
                &path,
                Some(&expected),
                FilePathIntent::ExistingHandleFile,
            )?;
            FileReader.read(policy, &target, observed_at_ms)
        })
        .await
        .map_err(|_| FilesError::FileReadFailed)?;
        drop(permit);
        result
    }

    /// Adds a live handle after atomically checking count and text budgets.
    fn insert_live(&self, record: HandleRecord) -> Result<(), FilesError> {
        let runtime = self.runtime()?;
        let bytes = record_text_bytes(&record);
        let mut handles = runtime
            .handles
            .lock()
            .map_err(|_| FilesError::FileMemoryLimitReached)?;
        if handles.live.len().saturating_add(handles.retained.len()) >= MAX_FILE_HANDLES
            || handles.text_bytes.saturating_add(bytes) > MAX_TEXT_BUFFER_BYTES
        {
            return Err(FilesError::FileMemoryLimitReached);
        }
        handles.text_bytes = handles.text_bytes.saturating_add(bytes);
        handles.live.insert(record.dto.id.clone(), record);
        Ok(())
    }

    /// Removes one live handle and releases its exact watcher and text allocation.
    fn remove_live(&self, file_handle_id: &str) -> Option<HandleRecord> {
        let runtime = self.runtime().ok()?;
        let record = {
            let mut handles = runtime.handles.lock().ok()?;
            let record = handles.live.remove(file_handle_id)?;
            handles.text_bytes = handles
                .text_bytes
                .saturating_sub(record_text_bytes(&record));
            record
        };
        runtime
            .watchers
            .unwatch(&record.parent, record.dto.watch_mode);
        Some(record)
    }

    /// Clones private handle state before any filesystem await.
    fn get_record(&self, file_handle_id: &str) -> Result<HandleRecord, FilesError> {
        validate_handle_id(file_handle_id)?;
        self.runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .live
            .get(file_handle_id)
            .cloned()
            .ok_or_else(|| FilesError::FileHandleNotFound {
                file_handle_id: file_handle_id.to_owned(),
            })
    }

    /// Reconciles handles sharing a changed parent or target.
    async fn reconcile_path(&self, path: &Path) -> Result<(), FilesError> {
        let parent = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(path)
        };
        let ids = self
            .runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .live
            .values()
            .filter(|record| {
                record.parent == parent
                    || record.root.join(
                        record
                            .dto
                            .relative_path
                            .replace('/', std::path::MAIN_SEPARATOR_STR),
                    ) == path
            })
            .map(|record| record.dto.id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.reconcile_handle(&id, false).await;
        }
        Ok(())
    }

    /// Reads current disk state and commits only if the same handle revision remains live.
    async fn reconcile_handle(
        &self,
        file_handle_id: &str,
        explicit: bool,
    ) -> Result<(), FilesError> {
        let current = self.get_record(file_handle_id)?;
        if explicit && current.dto.is_dirty {
            return Err(FilesError::UnsavedChangesWouldBeLost);
        }
        let observed = (self.runtime()?.clock)()?;
        match self.read_existing(&current, observed).await {
            Ok(snapshot) if snapshot.fingerprint == current.fingerprint => Ok(()),
            Ok(snapshot) => self.commit_snapshot(
                file_handle_id,
                snapshot,
                FileHandleChangeKindDto::Reloaded,
                current.dto.is_dirty,
            ),
            Err(FilesError::EntryNotFound { .. }) => self.commit_unavailable(file_handle_id, true),
            Err(FilesError::ProjectRootChanged { .. }) => self.commit_root_changed(file_handle_id),
            Err(FilesError::FileReadFailed | FilesError::FileSystemReadFailed) => {
                self.commit_unavailable(file_handle_id, false)
            }
            Err(error) => Err(error),
        }
    }

    /// Commits one changed disk snapshot while preserving dirty Markdown buffers.
    fn commit_snapshot(
        &self,
        file_handle_id: &str,
        snapshot: DiskFileSnapshot,
        change: FileHandleChangeKindDto,
        force_conflict: bool,
    ) -> Result<(), FilesError> {
        let runtime = self.runtime()?;
        let mut handles = runtime
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?;
        let current = handles.live.get(file_handle_id).cloned().ok_or_else(|| {
            FilesError::FileHandleNotFound {
                file_handle_id: file_handle_id.to_owned(),
            }
        })?;
        if current.fingerprint == snapshot.fingerprint {
            return Ok(());
        }
        let old_bytes = record_text_bytes(&current);
        let old_disk = disk_version(&current.dto.state).map(|disk| disk.disk_revision);
        let mut next = current;
        increment_revision(&mut next.dto)?;
        let mut actual_change = change;
        if force_conflict || next.dto.is_dirty {
            let local = local_text(&next.dto.state).ok_or(FilesError::FileReadFailed)?;
            next.dto.state = FileHandleStateDto::ExternalConflict {
                local,
                external: snapshot.disk.clone(),
            };
            actual_change = FileHandleChangeKindDto::ConflictDetected;
        } else {
            next.previous_clean_disk_revision = old_disk;
            next.base_text = text_content(&snapshot.content);
            next.recovery_text = None;
            next.dto.state = FileHandleStateDto::Ready {
                content: snapshot.content.clone(),
                disk: snapshot.disk.clone(),
            };
        }
        next.fingerprint = snapshot.fingerprint;
        let new_bytes = record_text_bytes(&next);
        let projected = handles
            .text_bytes
            .saturating_sub(old_bytes)
            .saturating_add(new_bytes);
        if projected > MAX_TEXT_BUFFER_BYTES {
            return Err(FilesError::FileMemoryLimitReached);
        }
        handles.text_bytes = projected;
        let dto = next.dto.clone();
        handles.live.insert(file_handle_id.to_owned(), next);
        drop(handles);
        let _ = (runtime.handle_events)(FileHandleChangedEventDto {
            file_handle_id: dto.id,
            revision: dto.revision,
            change: actual_change,
        });
        Ok(())
    }

    /// Commits a missing or unreadable state while retaining only dirty Markdown text.
    fn commit_unavailable(&self, file_handle_id: &str, missing: bool) -> Result<(), FilesError> {
        let runtime = self.runtime()?;
        let mut handles = runtime
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?;
        let current = handles.live.get(file_handle_id).cloned().ok_or_else(|| {
            FilesError::FileHandleNotFound {
                file_handle_id: file_handle_id.to_owned(),
            }
        })?;
        let old_bytes = record_text_bytes(&current);
        let last_disk = disk_version(&current.dto.state);
        let local = current
            .dto
            .is_dirty
            .then(|| local_text(&current.dto.state))
            .flatten();
        let next = if missing {
            FileHandleStateDto::Missing { last_disk, local }
        } else {
            FileHandleStateDto::Unreadable { last_disk, local }
        };
        if current.dto.state == next {
            return Ok(());
        }
        let mut next_record = current;
        increment_revision(&mut next_record.dto)?;
        next_record.dto.state = next;
        handles.text_bytes = handles
            .text_bytes
            .saturating_sub(old_bytes)
            .saturating_add(record_text_bytes(&next_record));
        let dto = next_record.dto.clone();
        handles.live.insert(file_handle_id.to_owned(), next_record);
        drop(handles);
        let change = if missing {
            FileHandleChangeKindDto::Missing
        } else {
            FileHandleChangeKindDto::Unreadable
        };
        let _ = (runtime.handle_events)(FileHandleChangedEventDto {
            file_handle_id: dto.id,
            revision: dto.revision,
            change,
        });
        Ok(())
    }

    /// Retires old-root reads and watches while preserving a dirty recovery buffer.
    fn commit_root_changed(&self, file_handle_id: &str) -> Result<(), FilesError> {
        let runtime = self.runtime()?;
        let (parent, mode, event) = {
            let mut handles = runtime
                .handles
                .lock()
                .map_err(|_| FilesError::FileReadFailed)?;
            let current = handles.live.get(file_handle_id).cloned().ok_or_else(|| {
                FilesError::FileHandleNotFound {
                    file_handle_id: file_handle_id.to_owned(),
                }
            })?;
            if current.dto.state == FileHandleStateDto::ProjectRootChanged {
                return Ok(());
            }
            let old_bytes = record_text_bytes(&current);
            let mut next = current;
            next.recovery_text = next
                .dto
                .is_dirty
                .then(|| local_text(&next.dto.state))
                .flatten();
            increment_revision(&mut next.dto)?;
            next.dto.state = FileHandleStateDto::ProjectRootChanged;
            handles.text_bytes = handles
                .text_bytes
                .saturating_sub(old_bytes)
                .saturating_add(record_text_bytes(&next));
            let event = FileHandleChangedEventDto {
                file_handle_id: next.dto.id.clone(),
                revision: next.dto.revision.clone(),
                change: FileHandleChangeKindDto::ProjectRootChanged,
            };
            let parent = next.parent.clone();
            let mode = next.dto.watch_mode;
            handles.live.insert(file_handle_id.to_owned(), next);
            (parent, mode, event)
        };
        runtime.watchers.unwatch(&parent, mode);
        let _ = (runtime.handle_events)(event);
        Ok(())
    }

    /// Checks one recent path through current visibility and no-link policy.
    async fn recent_availability(
        &self,
        root: &Path,
        relative_path: &str,
    ) -> RecentFileAvailabilityDto {
        let root = root.to_path_buf();
        let path = relative_path.to_owned();
        let reader = self.inner.reader.clone();
        let policy = self.inner.policy;
        tauri::async_runtime::spawn_blocking(move || {
            match policy.resolve(&root, &path, None, FilePathIntent::OpenVisibleFile) {
                Ok(_) => match map_reader(reader.is_visible(&root, &path)) {
                    Ok(true) => RecentFileAvailabilityDto::Available,
                    Ok(false) => RecentFileAvailabilityDto::NotVisible,
                    Err(_) => RecentFileAvailabilityDto::Unreadable,
                },
                Err(FilesError::EntryNotFound { .. }) => RecentFileAvailabilityDto::Missing,
                Err(FilesError::LinkTraversalDenied { .. }) => {
                    RecentFileAvailabilityDto::LinkDenied
                }
                Err(_) => RecentFileAvailabilityDto::Unreadable,
            }
        })
        .await
        .unwrap_or(RecentFileAvailabilityDto::Unreadable)
    }

    /// Reports unsaved close impact for the Sessions lifecycle owner.
    pub(crate) async fn close_impact(
        &self,
        file_handle_id: &str,
    ) -> Result<PaneCloseImpact, FilesError> {
        let record = self.get_record(file_handle_id)?;
        Ok(PaneCloseImpact {
            running_process_labels: Vec::new(),
            unsaved_file_labels: if record.dto.is_dirty {
                vec![record.dto.name]
            } else {
                Vec::new()
            },
        })
    }

    /// Closes a handle and optionally retains only its reopen identity.
    pub(crate) async fn close_for_session(
        &self,
        file_handle_id: &str,
        retention: CloseRetention,
    ) -> Result<Option<ReopenHandle>, FilesError> {
        if let Some(existing) = self
            .runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .retained
            .iter()
            .find(|(_, retained)| retained.file_handle_id == file_handle_id)
            .map(|(token, _)| token.clone())
        {
            if retention == CloseRetention::Discard {
                self.runtime()?
                    .handles
                    .lock()
                    .map_err(|_| FilesError::FileReadFailed)?
                    .retained
                    .remove(&existing);
                return Ok(None);
            }
            return Ok(Some(ReopenHandle {
                owner: PaneContentOwner::Files,
                token: existing,
            }));
        }
        let record = match self.remove_live(file_handle_id) {
            Some(record) => record,
            None => return Ok(None),
        };
        if retention == CloseRetention::Discard {
            return Ok(None);
        }
        let token = uuid::Uuid::new_v4().to_string();
        let retained = RetainedHandle {
            file_handle_id: record.dto.id,
            project_id: record.dto.project_id,
            relative_path: record.dto.relative_path,
            root_identity: record.root_identity,
            session_id: record.dto.session_id,
            tab_id: record.dto.tab_id,
            pane_id: record.dto.pane_id,
        };
        self.runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .retained
            .insert(token.clone(), retained);
        Ok(Some(ReopenHandle {
            owner: PaneContentOwner::Files,
            token,
        }))
    }

    /// Restores one retained identity after reading the current disk snapshot.
    pub(crate) async fn reopen_for_session(
        &self,
        handle: ReopenHandle,
    ) -> Result<PaneContentRef, FilesError> {
        if handle.owner != PaneContentOwner::Files {
            return Err(FilesError::InvalidFileHandleId);
        }
        let retained = self
            .runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .retained
            .get(&handle.token)
            .cloned()
            .ok_or_else(|| FilesError::FileHandleNotFound {
                file_handle_id: handle.token.clone(),
            })?;
        let root = self
            .runtime()?
            .dependencies
            .available_project_root(&retained.project_id)
            .await?;
        if self.inner.policy.identify_root(&root)? != retained.root_identity {
            return Err(FilesError::ProjectRootChanged {
                project_id: retained.project_id,
            });
        }
        let snapshot = self
            .read_new_visible(&root, &retained.relative_path, (self.runtime()?.clock)()?)
            .await?;
        let name = retained
            .relative_path
            .rsplit('/')
            .next()
            .unwrap_or(&retained.relative_path)
            .to_owned();
        let parent = root
            .join(
                retained
                    .relative_path
                    .replace('/', std::path::MAIN_SEPARATOR_STR),
            )
            .parent()
            .ok_or(FilesError::InvalidRelativePath)?
            .to_path_buf();
        let mode = self.runtime()?.watchers.watch(&parent);
        let dto = FileHandleDto {
            id: retained.file_handle_id.clone(),
            project_id: retained.project_id.clone(),
            session_id: retained.session_id.clone(),
            tab_id: retained.tab_id.clone(),
            pane_id: retained.pane_id.clone(),
            name: name.clone(),
            relative_path: retained.relative_path.clone(),
            revision: "1".to_owned(),
            watch_mode: mode,
            is_dirty: false,
            dirty_since_ms: None,
            edit_count: 0,
            state: FileHandleStateDto::Ready {
                content: snapshot.content.clone(),
                disk: snapshot.disk.clone(),
            },
        };
        self.runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .retained
            .remove(&handle.token);
        let record = HandleRecord {
            dto: dto.clone(),
            root,
            root_identity: retained.root_identity.clone(),
            parent: parent.clone(),
            fingerprint: snapshot.fingerprint,
            base_text: text_content(&snapshot.content),
            recovery_text: None,
            previous_clean_disk_revision: None,
        };
        if let Err(error) = self.insert_live(record) {
            self.runtime()
                .expect("runtime exists")
                .watchers
                .unwatch(&parent, mode);
            self.runtime()?
                .handles
                .lock()
                .map_err(|_| FilesError::FileReadFailed)?
                .retained
                .insert(handle.token, retained);
            return Err(error);
        }
        Ok(PaneContentRef::File {
            file_handle_id: dto.id,
            title: name,
        })
    }

    /// Permanently releases one retained token idempotently.
    pub(crate) async fn discard_for_session(&self, handle: ReopenHandle) -> Result<(), FilesError> {
        if handle.owner != PaneContentOwner::Files {
            return Err(FilesError::InvalidFileHandleId);
        }
        self.runtime()?
            .handles
            .lock()
            .map_err(|_| FilesError::FileReadFailed)?
            .retained
            .remove(&handle.token);
        Ok(())
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

/// Validates that a public handle identifier is one canonical UUID.
fn validate_handle_id(value: &str) -> Result<(), FilesError> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| FilesError::InvalidFileHandleId)?;
    if parsed.to_string() != value.to_lowercase() {
        return Err(FilesError::InvalidFileHandleId);
    }
    Ok(())
}

/// Increments one JavaScript-safe string revision without wrapping.
fn increment_revision(dto: &mut FileHandleDto) -> Result<(), FilesError> {
    let current = dto
        .revision
        .parse::<u64>()
        .map_err(|_| FilesError::FileReadFailed)?;
    dto.revision = current
        .checked_add(1)
        .ok_or(FilesError::FileReadFailed)?
        .to_string();
    Ok(())
}

/// Returns a cloned text snapshot when classified content retains text.
fn text_content(content: &FileContentDto) -> Option<TextFileDto> {
    match content {
        FileContentDto::Text { file } => Some(file.clone()),
        _ => None,
    }
}

/// Returns the active local text from any state that can retain it.
fn local_text(state: &FileHandleStateDto) -> Option<TextFileDto> {
    match state {
        FileHandleStateDto::Ready { content, .. } => text_content(content),
        FileHandleStateDto::ExternalConflict { local, .. } => Some(local.clone()),
        FileHandleStateDto::Missing { local, .. }
        | FileHandleStateDto::Unreadable { local, .. } => local.clone(),
        FileHandleStateDto::ProjectRootChanged => None,
    }
}

/// Returns the latest known disk version from one handle state.
fn disk_version(state: &FileHandleStateDto) -> Option<super::FileDiskVersionDto> {
    match state {
        FileHandleStateDto::Ready { disk, .. } => Some(disk.clone()),
        FileHandleStateDto::ExternalConflict { external, .. } => Some(external.clone()),
        FileHandleStateDto::Missing { last_disk, .. }
        | FileHandleStateDto::Unreadable { last_disk, .. } => last_disk.clone(),
        FileHandleStateDto::ProjectRootChanged => None,
    }
}

/// Counts the sole retained local text allocation in one state.
fn text_bytes(state: &FileHandleStateDto) -> usize {
    local_text(state).map_or(0, |file| file.text.len())
}

/// Counts every text allocation retained by one live record.
fn record_text_bytes(record: &HandleRecord) -> usize {
    text_bytes(&record.dto.state)
        .saturating_add(record.base_text.as_ref().map_or(0, |file| file.text.len()))
        .saturating_add(
            record
                .recovery_text
                .as_ref()
                .map_or(0, |file| file.text.len()),
        )
}

/// Normalizes runtime identity to the same platform-local key as recent persistence.
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

/// Returns checked Unix epoch milliseconds for production file observations.
pub fn system_files_clock() -> Result<i64, FilesError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| FilesError::ClockFailed)?;
    i64::try_from(duration.as_millis()).map_err(|_| FilesError::ClockFailed)
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
