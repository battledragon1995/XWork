use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

use tokio::sync::{Mutex as AsyncMutex, Semaphore};

use super::error::{InvalidProjectFolderReasonDto, ProjectsError};
use super::git_status::{GitInspectionMode, GitReadSnapshot, GitStatusReader, GixGitStatusReader};
use super::models::{
    AvailableProjectRoot, GitRepositoryKindDto, ProjectAvailabilityDto,
    ProjectAvailabilitySnapshot, ProjectBackupRecordV1, ProjectChangeKindDto,
    ProjectChangedEventDto, ProjectCommittedProjection, ProjectDto, ProjectFolderSelectionDto,
    ProjectGitStatusDto, ProjectGitSummaryDto, ProjectImportCounts, ProjectImportMap,
    ProjectImportPlan, ProjectRow, ProjectUnavailableReasonDto, RemoveProjectImpactDto,
    RemoveProjectResultDto, compare_list_order, matches_search, normalize_display_name,
    normalize_search, validate_project_id,
};
use super::platform::{
    ProjectClock, ProjectEventSink, ProjectIdFactory, ProjectPlatform, ProjectRuntimeGuard,
    SystemProjectClock, UuidProjectIdFactory,
};
use super::repository;
use crate::shared::DataMaintenanceGate;
use crate::storage::Storage;

/// Selects the path-identity rules that match one operating-system family.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[doc(hidden)]
pub enum PathIdentity {
    /// Windows compares roots without case and with a unified separator.
    WindowsLike,
    /// macOS keeps the case the filesystem reported for the canonical path.
    CasePreserving,
}

/// Selects the identity rules of the platform this binary was built for.
#[doc(hidden)]
pub const CURRENT_PATH_IDENTITY: PathIdentity = if cfg!(windows) {
    PathIdentity::WindowsLike
} else {
    PathIdentity::CasePreserving
};

/// Holds the canonical identity derived from one selected folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ValidatedFolder {
    pub root_path: String,
    pub path_key: String,
    pub display_name: String,
}

/// Removes a Windows verbatim prefix only when the remainder stays valid.
pub(super) fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        // A verbatim UNC path becomes the familiar `\\server\share` form.
        return format!(r"\\{rest}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        // Only a plain drive-letter path is safe to un-prefix without changing meaning.
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return rest.to_owned();
        }
    }
    path.to_owned()
}

/// Removes a trailing separator so display paths stay comparable.
pub(super) fn trim_trailing_separator(path: &str) -> String {
    let trimmed = path.trim_end_matches(['\\', '/']);
    if trimmed.is_empty() {
        // A path made only of separators keeps one so it never becomes empty.
        path[..1].to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Builds the duplicate-detection key for one canonical display path.
pub(super) fn path_key_for(identity: PathIdentity, root_path: &str) -> String {
    match identity {
        // Windows folders are the same folder across separator and case variants.
        PathIdentity::WindowsLike => root_path.replace('\\', "/").to_lowercase(),
        // macOS keeps the case the filesystem reported so display and key agree.
        PathIdentity::CasePreserving => root_path.to_owned(),
    }
}

/// Reports whether a canonical path names a filesystem or share root.
pub(super) fn is_filesystem_root(root_path: &str) -> bool {
    // A root has no ordinary component, only a prefix and/or the root separator.
    !Path::new(root_path)
        .components()
        .any(|component| matches!(component, Component::Normal(_)))
}

/// Derives the display name from the final component of a canonical path.
pub(super) fn derive_display_name(root_path: &str) -> Result<String, ProjectsError> {
    let basename = Path::new(root_path)
        .components()
        .filter_map(
            // Keeps only ordinary components so prefixes never become the name.
            |component| match component {
                Component::Normal(value) => value.to_str(),
                _ => None,
            },
        )
        .next_back()
        .ok_or(ProjectsError::InvalidDisplayName)?;
    normalize_display_name(basename)
}

/// Classifies one filesystem failure as a public unavailability reason.
pub(super) fn availability_reason_for(kind: std::io::ErrorKind) -> ProjectUnavailableReasonDto {
    match kind {
        std::io::ErrorKind::NotFound => ProjectUnavailableReasonDto::Missing,
        std::io::ErrorKind::PermissionDenied => ProjectUnavailableReasonDto::AccessDenied,
        // Every other failure keeps the generic reason so no system detail leaks.
        _ => ProjectUnavailableReasonDto::Io,
    }
}

/// Classifies one filesystem failure as a public invalid-folder reason.
pub(super) fn folder_reason_for(kind: std::io::ErrorKind) -> InvalidProjectFolderReasonDto {
    match kind {
        std::io::ErrorKind::NotFound => InvalidProjectFolderReasonDto::Missing,
        std::io::ErrorKind::PermissionDenied => InvalidProjectFolderReasonDto::AccessDenied,
        // Every other failure is reported as a canonicalization problem.
        _ => InvalidProjectFolderReasonDto::CannotCanonicalize,
    }
}

/// Requires a lossless UTF-8 representation of one canonical path.
pub(super) fn canonical_text(canonical: &Path) -> Result<&str, ProjectsError> {
    canonical
        .to_str()
        .ok_or(ProjectsError::InvalidProjectFolder {
            reason: InvalidProjectFolderReasonDto::NotUtf8,
        })
}

/// Maps a filesystem probe of one persisted root into public availability.
pub(super) fn measure_availability(root: &Path) -> ProjectAvailabilityDto {
    match std::fs::metadata(root) {
        Ok(metadata) if metadata.is_dir() => ProjectAvailabilityDto::Available,
        // An existing non-directory keeps its own reason so the banner can explain it.
        Ok(_) => ProjectAvailabilityDto::Unavailable(ProjectUnavailableReasonDto::NotDirectory),
        Err(error) => ProjectAvailabilityDto::Unavailable(availability_reason_for(error.kind())),
    }
}

/// Validates one picker selection and derives its persisted identity.
pub(super) fn validate_selected_folder(
    identity: PathIdentity,
    selected: &Path,
) -> Result<ValidatedFolder, ProjectsError> {
    if !selected.is_absolute() {
        return Err(ProjectsError::InvalidProjectFolder {
            reason: InvalidProjectFolderReasonDto::NotAbsolute,
        });
    }

    let canonical = std::fs::canonicalize(selected).map_err(
        // Expected filesystem failures keep their own reason for the picker message.
        |error| ProjectsError::InvalidProjectFolder {
            reason: folder_reason_for(error.kind()),
        },
    )?;

    // Resolving symbolic links and junctions can change the target into a file.
    let metadata = std::fs::metadata(&canonical).map_err(
        // A canonical path that cannot be inspected is not usable as a project root.
        |error| ProjectsError::InvalidProjectFolder {
            reason: folder_reason_for(error.kind()),
        },
    )?;
    if !metadata.is_dir() {
        return Err(ProjectsError::InvalidProjectFolder {
            reason: InvalidProjectFolderReasonDto::NotDirectory,
        });
    }

    let displayed = strip_verbatim_prefix(canonical_text(&canonical)?);
    // The root check runs before trimming so a bare drive is never reshaped first.
    if is_filesystem_root(&displayed) {
        return Err(ProjectsError::InvalidProjectFolder {
            reason: InvalidProjectFolderReasonDto::FileSystemRoot,
        });
    }
    let root_path = trim_trailing_separator(&displayed);

    let display_name = derive_display_name(&root_path)?;
    let path_key = path_key_for(identity, &root_path);
    Ok(ValidatedFolder {
        root_path,
        path_key,
        display_name,
    })
}

/// Runs one blocking database or filesystem operation on a worker thread.
async fn run_blocking<T>(
    fallback: ProjectsError,
    operation: impl FnOnce() -> Result<T, ProjectsError> + Send + 'static,
) -> Result<T, ProjectsError>
where
    T: Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(operation).await {
        Ok(result) => result,
        // A cancelled or panicking worker is infrastructure failure, never a contract case.
        Err(_) => Err(fallback),
    }
}

/// Creates the only public error exposed for Git reader and worker failures.
fn git_failure(project_id: &str) -> ProjectsError {
    ProjectsError::GitInspectionFailed {
        project_id: project_id.to_owned(),
    }
}

/// Attaches the requested project identifier to an internal read snapshot.
fn summary_from_snapshot(project_id: &str, snapshot: &GitReadSnapshot) -> ProjectGitSummaryDto {
    ProjectGitSummaryDto {
        project_id: project_id.to_owned(),
        repository_kind: snapshot.repository_kind,
        head: snapshot.head.clone(),
        changed_count: snapshot.changed_count,
        untracked_count: snapshot.untracked_count,
    }
}

/// Rejects internally inconsistent reader output before constructing a public DTO.
fn validate_git_snapshot(
    snapshot: &GitReadSnapshot,
    mode: GitInspectionMode,
) -> Result<(), super::git_status::GitReadError> {
    if snapshot.untracked_count > snapshot.changed_count {
        return Err(super::git_status::GitReadError);
    }
    match snapshot.repository_kind {
        GitRepositoryKindDto::NotRepository
            if snapshot.head.is_none()
                && snapshot.changed_count == 0
                && snapshot.changes.is_empty() => {}
        GitRepositoryKindDto::Bare
            if snapshot.head.is_some()
                && snapshot.changed_count == 0
                && snapshot.changes.is_empty() => {}
        GitRepositoryKindDto::Worktree
            if snapshot.head.is_some()
                && ((mode == GitInspectionMode::Summary && snapshot.changes.is_empty())
                    || (mode == GitInspectionMode::Detail
                        && usize::try_from(snapshot.changed_count).ok()
                            == Some(snapshot.changes.len()))) => {}
        _ => return Err(super::git_status::GitReadError),
    }
    Ok(())
}

/// Owns Projects orchestration for Tauri commands and backend consumers.
#[derive(Clone)]
pub struct ProjectService {
    inner: Arc<ServiceInner>,
}

/// Stores every collaborator and admission primitive of the project service.
struct ServiceInner {
    storage: Storage,
    gate: DataMaintenanceGate,
    platform: Arc<dyn ProjectPlatform>,
    runtime_guard: Arc<dyn ProjectRuntimeGuard>,
    clock: Arc<dyn ProjectClock>,
    ids: Arc<dyn ProjectIdFactory>,
    events: Arc<dyn ProjectEventSink>,
    identity: PathIdentity,
    /// Serializes ordinary project mutations after the application gate.
    mutation_gate: AsyncMutex<()>,
    /// Names every project whose removal already closed the admission gate.
    removals: Arc<Mutex<HashSet<String>>>,
    /// Performs all repository reads behind a narrow synchronous seam.
    git_reader: Arc<dyn GitStatusReader>,
    /// Limits the entire application to two simultaneous Git scans.
    git_scan_limit: Arc<Semaphore>,
}

impl ProjectService {
    /// Creates the production project service around its injected collaborators.
    pub fn new(
        storage: Storage,
        gate: DataMaintenanceGate,
        platform: Arc<dyn ProjectPlatform>,
        runtime_guard: Arc<dyn ProjectRuntimeGuard>,
        events: Arc<dyn ProjectEventSink>,
    ) -> Self {
        Self::with_seams(
            storage,
            gate,
            platform,
            runtime_guard,
            events,
            Arc::new(SystemProjectClock),
            Arc::new(UuidProjectIdFactory),
            CURRENT_PATH_IDENTITY,
        )
    }

    /// Creates a project service whose clock, identifiers, and identity are injected.
    #[doc(hidden)]
    #[allow(clippy::too_many_arguments)]
    pub fn with_seams(
        storage: Storage,
        gate: DataMaintenanceGate,
        platform: Arc<dyn ProjectPlatform>,
        runtime_guard: Arc<dyn ProjectRuntimeGuard>,
        events: Arc<dyn ProjectEventSink>,
        clock: Arc<dyn ProjectClock>,
        ids: Arc<dyn ProjectIdFactory>,
        identity: PathIdentity,
    ) -> Self {
        Self::with_git_seams(
            storage,
            gate,
            platform,
            runtime_guard,
            events,
            clock,
            ids,
            identity,
            Arc::new(GixGitStatusReader),
            Arc::new(Semaphore::new(2)),
        )
    }

    /// Creates a project service with deterministic Git collaborators for tests.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn with_git_seams(
        storage: Storage,
        gate: DataMaintenanceGate,
        platform: Arc<dyn ProjectPlatform>,
        runtime_guard: Arc<dyn ProjectRuntimeGuard>,
        events: Arc<dyn ProjectEventSink>,
        clock: Arc<dyn ProjectClock>,
        ids: Arc<dyn ProjectIdFactory>,
        identity: PathIdentity,
        git_reader: Arc<dyn GitStatusReader>,
        git_scan_limit: Arc<Semaphore>,
    ) -> Self {
        Self {
            inner: Arc::new(ServiceInner {
                storage,
                gate,
                platform,
                runtime_guard,
                clock,
                ids,
                events,
                identity,
                mutation_gate: AsyncMutex::new(()),
                removals: Arc::new(Mutex::new(HashSet::new())),
                git_reader,
                git_scan_limit,
            }),
        }
    }

    /// Reports whether this service shares one admission gate with another handle.
    #[doc(hidden)]
    pub fn shares_gate_with(&self, gate: &DataMaintenanceGate) -> bool {
        self.inner.gate.shares_state_with(gate)
    }

    /// Lists one owner-produced project snapshot for commands and consumers.
    pub async fn list_projects(
        &self,
        search: Option<&str>,
    ) -> Result<Vec<ProjectDto>, ProjectsError> {
        let filter = normalize_search(search)?;
        let rows = self.load_all_rows().await?;
        let selected = match filter {
            // Filtering happens in Rust so Unicode case folding matches the specification.
            Some(needle) => rows
                .into_iter()
                .filter(
                    // Keeps the original display order while dropping non-matching rows.
                    |row| matches_search(row, &needle),
                )
                .collect(),
            None => rows,
        };
        self.project_rows(selected).await
    }

    /// Returns one project with current folder availability.
    pub async fn get_project(&self, project_id: &str) -> Result<ProjectDto, ProjectsError> {
        validate_project_id(project_id)?;
        let row = self.load_row(project_id).await?;
        let availability = self.availability_of(&row.root_path).await?;
        Ok(row.to_dto(availability))
    }

    /// Selects and registers an existing folder as a new project.
    pub async fn add_project(&self) -> Result<ProjectFolderSelectionDto, ProjectsError> {
        let Some(selected) = self.inner.platform.select_folder().await? else {
            return Ok(ProjectFolderSelectionDto::Cancelled);
        };
        // Pure path validation runs before admission so a rejected folder takes no permit.
        let validated = self.validate_folder(selected).await?;

        let _permit = self.inner.gate.read_permit().await;
        let _mutation = self.inner.mutation_gate.lock().await;
        let now = self.inner.clock.now_ms()?;
        let row = ProjectRow {
            id: self.inner.ids.new_project_id(),
            display_name: validated.display_name,
            root_path: validated.root_path,
            path_key: validated.path_key,
            is_pinned: false,
            // Opening the overview happens immediately after add, so both stamps match.
            added_at_ms: now,
            last_opened_at_ms: now,
        };

        let storage = self.inner.storage.clone();
        let inserted = row.clone();
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Commits the new project row in exactly one immediate transaction.
            move || {
                storage.with_transaction(
                    // Classifies a duplicate canonical folder inside the repository.
                    |transaction| repository::insert_project(transaction, &inserted),
                )
            },
        )
        .await?;

        let availability = self.availability_of(&row.root_path).await?;
        self.publish(ProjectChangeKindDto::Added, &row.id);
        Ok(ProjectFolderSelectionDto::Selected {
            project: row.to_dto(availability),
        })
    }

    /// Renames a project without changing its folder.
    pub async fn rename_project(
        &self,
        project_id: &str,
        display_name: &str,
    ) -> Result<ProjectDto, ProjectsError> {
        validate_project_id(project_id)?;
        let name = normalize_display_name(display_name)?;

        let _permit = self.inner.gate.read_permit().await;
        let _mutation = self.inner.mutation_gate.lock().await;
        self.reject_while_removing(project_id)?;

        let storage = self.inner.storage.clone();
        let id = project_id.to_owned();
        let (row, changed) = run_blocking(
            ProjectsError::PersistenceFailed,
            // Rewrites only the display name of one existing project row.
            move || {
                storage.with_transaction(
                    // Re-reads the row so a competing removal is reported instead of recreated.
                    |transaction| {
                        let existing = load_existing(transaction, &id)?;
                        if existing.display_name == name {
                            // An unchanged value is a no-op that must not publish an event.
                            return Ok((existing, false));
                        }
                        if repository::update_display_name(transaction, &id, &name)? == 0 {
                            return Err(ProjectsError::ProjectNotFound {
                                project_id: id.clone(),
                            });
                        }
                        Ok((
                            ProjectRow {
                                display_name: name,
                                ..existing
                            },
                            true,
                        ))
                    },
                )
            },
        )
        .await?;

        self.publish_if_changed(changed, ProjectChangeKindDto::Updated, project_id);
        let availability = self.availability_of(&row.root_path).await?;
        Ok(row.to_dto(availability))
    }

    /// Sets the pinned state of a project without changing its timestamps.
    pub async fn set_project_pinned(
        &self,
        project_id: &str,
        is_pinned: bool,
    ) -> Result<ProjectDto, ProjectsError> {
        validate_project_id(project_id)?;

        let _permit = self.inner.gate.read_permit().await;
        let _mutation = self.inner.mutation_gate.lock().await;
        self.reject_while_removing(project_id)?;

        let storage = self.inner.storage.clone();
        let id = project_id.to_owned();
        let (row, changed) = run_blocking(
            ProjectsError::PersistenceFailed,
            // Rewrites only the pinned flag of one existing project row.
            move || {
                storage.with_transaction(
                    // Leaves insertion order untouched because only the pinned flag changes.
                    |transaction| {
                        let existing = load_existing(transaction, &id)?;
                        if existing.is_pinned == is_pinned {
                            // An unchanged pin is a no-op that must not publish an event.
                            return Ok((existing, false));
                        }
                        if repository::update_pinned(transaction, &id, is_pinned)? == 0 {
                            return Err(ProjectsError::ProjectNotFound {
                                project_id: id.clone(),
                            });
                        }
                        Ok((
                            ProjectRow {
                                is_pinned,
                                ..existing
                            },
                            true,
                        ))
                    },
                )
            },
        )
        .await?;

        self.publish_if_changed(changed, ProjectChangeKindDto::Updated, project_id);
        let availability = self.availability_of(&row.root_path).await?;
        Ok(row.to_dto(availability))
    }

    /// Records a project overview opening and returns current metadata.
    pub async fn open_project(&self, project_id: &str) -> Result<ProjectDto, ProjectsError> {
        validate_project_id(project_id)?;

        let _permit = self.inner.gate.read_permit().await;
        let _mutation = self.inner.mutation_gate.lock().await;
        self.reject_while_removing(project_id)?;
        let now = self.inner.clock.now_ms()?;

        let storage = self.inner.storage.clone();
        let id = project_id.to_owned();
        let (row, changed) = run_blocking(
            ProjectsError::PersistenceFailed,
            // Advances the last-opened stamp without ever moving it backwards.
            move || {
                storage.with_transaction(
                    // A backwards system clock must never lower a persisted timestamp.
                    |transaction| {
                        let existing = load_existing(transaction, &id)?;
                        let advanced = now
                            .max(existing.added_at_ms)
                            .max(existing.last_opened_at_ms);
                        if advanced == existing.last_opened_at_ms {
                            return Ok((existing, false));
                        }
                        if repository::update_last_opened(transaction, &id, advanced)? == 0 {
                            return Err(ProjectsError::ProjectNotFound {
                                project_id: id.clone(),
                            });
                        }
                        Ok((
                            ProjectRow {
                                last_opened_at_ms: advanced,
                                ..existing
                            },
                            true,
                        ))
                    },
                )
            },
        )
        .await?;

        self.publish_if_changed(changed, ProjectChangeKindDto::Updated, project_id);
        let availability = self.availability_of(&row.root_path).await?;
        Ok(row.to_dto(availability))
    }

    /// Replaces a project's missing or relocated root folder.
    pub async fn locate_project_folder(
        &self,
        project_id: &str,
    ) -> Result<ProjectFolderSelectionDto, ProjectsError> {
        validate_project_id(project_id)?;
        // The project must exist before a native dialog interrupts the user.
        self.load_row(project_id).await?;

        let Some(selected) = self.inner.platform.select_folder().await? else {
            return Ok(ProjectFolderSelectionDto::Cancelled);
        };
        let validated = self.validate_folder(selected).await?;

        let _permit = self.inner.gate.read_permit().await;
        let _mutation = self.inner.mutation_gate.lock().await;
        self.reject_while_removing(project_id)?;

        let storage = self.inner.storage.clone();
        let id = project_id.to_owned();
        let (row, changed) = run_blocking(
            ProjectsError::PersistenceFailed,
            // Replaces exactly the two path fields of one existing project row.
            move || {
                storage.with_transaction(
                    // Identity, name, pin, and timestamps must survive relocation unchanged.
                    |transaction| {
                        let existing = load_existing(transaction, &id)?;
                        if existing.path_key == validated.path_key {
                            // Selecting the same canonical folder is a no-op without an event.
                            return Ok((existing, false));
                        }
                        if repository::update_root(
                            transaction,
                            &id,
                            &validated.root_path,
                            &validated.path_key,
                        )? == 0
                        {
                            return Err(ProjectsError::ProjectNotFound {
                                project_id: id.clone(),
                            });
                        }
                        Ok((
                            ProjectRow {
                                root_path: validated.root_path,
                                path_key: validated.path_key,
                                ..existing
                            },
                            true,
                        ))
                    },
                )
            },
        )
        .await?;

        self.publish_if_changed(changed, ProjectChangeKindDto::Updated, project_id);
        let availability = self.availability_of(&row.root_path).await?;
        Ok(ProjectFolderSelectionDto::Selected {
            project: row.to_dto(availability),
        })
    }

    /// Opens an available project root in the operating-system file manager.
    pub async fn open_project_folder(&self, project_id: &str) -> Result<(), ProjectsError> {
        validate_project_id(project_id)?;
        let row = self.load_row(project_id).await?;

        // Availability is measured again immediately before the native opener runs.
        if let ProjectAvailabilityDto::Unavailable(reason) =
            self.availability_of(&row.root_path).await?
        {
            return Err(ProjectsError::ProjectUnavailable { reason });
        }

        let root = PathBuf::from(&row.root_path);
        self.inner.platform.open_folder(&root).await
    }

    /// Returns current availability for the Sessions consumer adapter.
    pub async fn session_availability(
        &self,
        project_id: &str,
    ) -> Result<ProjectAvailabilitySnapshot, ProjectsError> {
        validate_project_id(project_id)?;
        let row = self.load_row(project_id).await?;
        // A project inside the removal gate must never admit a new session.
        if self.is_removing(project_id)? {
            return Ok(ProjectAvailabilitySnapshot {
                project_id: project_id.to_owned(),
                is_available: false,
            });
        }
        let availability = self.availability_of(&row.root_path).await?;
        Ok(ProjectAvailabilitySnapshot {
            project_id: project_id.to_owned(),
            is_available: availability == ProjectAvailabilityDto::Available,
        })
    }

    /// Returns project identifiers in pinned-then-insertion order.
    pub async fn ordered_project_ids(&self) -> Result<Vec<String>, ProjectsError> {
        let storage = self.inner.storage.clone();
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Reads only identifiers because this query never touches the filesystem.
            move || {
                storage.with_connection(
                    // Uses the same display order as the public project list.
                    repository::select_ordered_ids,
                )
            },
        )
        .await
    }

    /// Returns a validated canonical root for backend filesystem consumers.
    pub async fn available_root(
        &self,
        project_id: &str,
    ) -> Result<AvailableProjectRoot, ProjectsError> {
        validate_project_id(project_id)?;
        let row = self.load_row(project_id).await?;
        if self.is_removing(project_id)? {
            return Err(ProjectsError::RemovalInProgress {
                project_id: project_id.to_owned(),
            });
        }
        if let ProjectAvailabilityDto::Unavailable(reason) =
            self.availability_of(&row.root_path).await?
        {
            return Err(ProjectsError::ProjectUnavailable { reason });
        }
        Ok(AvailableProjectRoot {
            project_id: row.id,
            root_path: PathBuf::from(row.root_path),
        })
    }

    /// Resolves a project root and returns its current read-only Git summary.
    pub async fn git_summary(
        &self,
        project_id: &str,
    ) -> Result<ProjectGitSummaryDto, ProjectsError> {
        let snapshot = self
            .inspect_git(project_id, GitInspectionMode::Summary)
            .await?;
        Ok(summary_from_snapshot(project_id, &snapshot))
    }

    /// Resolves a project root and returns its current detailed Git status.
    pub async fn git_status(&self, project_id: &str) -> Result<ProjectGitStatusDto, ProjectsError> {
        let snapshot = self
            .inspect_git(project_id, GitInspectionMode::Detail)
            .await?;
        let summary = summary_from_snapshot(project_id, &snapshot);
        Ok(ProjectGitStatusDto {
            summary,
            changes: snapshot.changes,
        })
    }

    /// Scans and revalidates one root, retrying one relocation race at most once.
    async fn inspect_git(
        &self,
        project_id: &str,
        mode: GitInspectionMode,
    ) -> Result<GitReadSnapshot, ProjectsError> {
        let mut root = self.available_root(project_id).await?.root_path;
        for attempt in 0..2 {
            let permit = self
                .inner
                .git_scan_limit
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| git_failure(project_id))?;
            let reader = self.inner.git_reader.clone();
            let scan_root = root.clone();
            let snapshot = tauri::async_runtime::spawn_blocking(move || {
                // The owned permit remains in the worker even if the awaiting task is cancelled.
                let _permit = permit;
                reader.inspect(&scan_root, mode)
            })
            .await
            .map_err(|_| git_failure(project_id))?
            .map_err(|_| git_failure(project_id))?;
            validate_git_snapshot(&snapshot, mode).map_err(|_| git_failure(project_id))?;

            let current = self.available_root(project_id).await?.root_path;
            if current == root {
                return Ok(snapshot);
            }
            if attempt == 1 {
                return Err(git_failure(project_id));
            }
            // Discard a snapshot from the old folder and rescan the newly located root once.
            root = current;
        }
        Err(git_failure(project_id))
    }

    /// Reads every persisted project row in stable display order.
    pub(super) async fn load_all_rows(&self) -> Result<Vec<ProjectRow>, ProjectsError> {
        let storage = self.inner.storage.clone();
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Holds the storage lock only for the short ordered read.
            move || {
                storage.with_connection(
                    // Releases the connection before any filesystem probe runs.
                    repository::select_all_ordered,
                )
            },
        )
        .await
    }

    /// Reads one persisted project row or reports that it no longer exists.
    pub(super) async fn load_row(&self, project_id: &str) -> Result<ProjectRow, ProjectsError> {
        let storage = self.inner.storage.clone();
        let id = project_id.to_owned();
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Reads exactly one project row through the shared storage boundary.
            move || {
                storage.with_connection(
                    // Reports a removed row as not found instead of recreating it.
                    |connection| load_existing(connection, &id),
                )
            },
        )
        .await
    }

    /// Measures availability for every supplied row outside the storage lock.
    pub(super) async fn project_rows(
        &self,
        rows: Vec<ProjectRow>,
    ) -> Result<Vec<ProjectDto>, ProjectsError> {
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Probes only the roots that the caller will actually receive.
            move || {
                Ok(rows
                    .into_iter()
                    .map(
                        // Derives availability freshly instead of reading a persisted flag.
                        |row| {
                            let availability = measure_availability(Path::new(&row.root_path));
                            row.to_dto(availability)
                        },
                    )
                    .collect())
            },
        )
        .await
    }

    /// Measures one project root's availability on a blocking worker.
    pub(super) async fn availability_of(
        &self,
        root_path: &str,
    ) -> Result<ProjectAvailabilityDto, ProjectsError> {
        let root = PathBuf::from(root_path);
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Filesystem metadata must never run on the async runtime thread.
            move || Ok(measure_availability(&root)),
        )
        .await
    }

    /// Validates one picker selection on a blocking worker.
    async fn validate_folder(&self, selected: PathBuf) -> Result<ValidatedFolder, ProjectsError> {
        let identity = self.inner.identity;
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Canonicalization and metadata checks are blocking filesystem work.
            move || validate_selected_folder(identity, &selected),
        )
        .await
    }

    /// Publishes one committed change without letting delivery affect the result.
    pub(super) fn publish(&self, change: ProjectChangeKindDto, project_id: &str) {
        let event = ProjectChangedEventDto {
            change,
            project_id: project_id.to_owned(),
        };
        if self.inner.events.publish(event).is_err() {
            // The transaction already committed, so the frontend recovers by re-querying.
            eprintln!("projects://changed delivery failed for project {project_id}");
        }
    }

    /// Publishes a change only when the transaction really modified a row.
    fn publish_if_changed(&self, changed: bool, change: ProjectChangeKindDto, project_id: &str) {
        if changed {
            self.publish(change, project_id);
        }
    }

    /// Reports whether one project currently sits inside the removal gate.
    pub(super) fn is_removing(&self, project_id: &str) -> Result<bool, ProjectsError> {
        let removals = self.inner.removals.lock().map_err(
            // A poisoned admission set is reported as an internal persistence failure.
            |_| ProjectsError::PersistenceFailed,
        )?;
        Ok(removals.contains(project_id))
    }

    /// Rejects an ordinary mutation that races an in-progress removal.
    pub(super) fn reject_while_removing(&self, project_id: &str) -> Result<(), ProjectsError> {
        if self.is_removing(project_id)? {
            return Err(ProjectsError::RemovalInProgress {
                project_id: project_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Returns the shared storage handle for owner-controlled test scenarios.
    #[doc(hidden)]
    pub fn storage_for_tests(&self) -> Storage {
        self.inner.storage.clone()
    }
}

/// Holds the per-project removal admission until every exit path releases it.
struct RemovalGuard {
    removals: Arc<Mutex<HashSet<String>>>,
    project_id: String,
}

impl RemovalGuard {
    /// Closes the removal gate for one project or reports a competing removal.
    fn acquire(
        removals: Arc<Mutex<HashSet<String>>>,
        project_id: &str,
    ) -> Result<Self, ProjectsError> {
        {
            let mut active = removals.lock().map_err(
                // A poisoned admission set is reported as an internal persistence failure.
                |_| ProjectsError::PersistenceFailed,
            )?;
            if !active.insert(project_id.to_owned()) {
                return Err(ProjectsError::RemovalInProgress {
                    project_id: project_id.to_owned(),
                });
            }
        }
        Ok(Self {
            removals,
            project_id: project_id.to_owned(),
        })
    }
}

impl Drop for RemovalGuard {
    /// Reopens the project for ordinary mutations on every exit path.
    fn drop(&mut self) {
        if let Ok(mut active) = self.removals.lock() {
            active.remove(&self.project_id);
        }
    }
}

impl ProjectService {
    /// Inspects sessions and unsaved work affected by removing a project.
    pub async fn get_remove_project_impact(
        &self,
        project_id: &str,
    ) -> Result<RemoveProjectImpactDto, ProjectsError> {
        validate_project_id(project_id)?;
        let row = self.load_row(project_id).await?;
        self.build_impact(&row).await
    }

    /// Removes project metadata after explicit confirmation and runtime cleanup.
    pub async fn remove_project(
        &self,
        project_id: &str,
        confirmed: bool,
    ) -> Result<RemoveProjectResultDto, ProjectsError> {
        validate_project_id(project_id)?;
        let row = self.load_row(project_id).await?;

        if !confirmed {
            // Confirmation always carries the impact measured at this exact moment.
            return Err(ProjectsError::ConfirmationRequired {
                impact: self.build_impact(&row).await?,
            });
        }

        let _permit = self.inner.gate.read_permit().await;
        let _removal = {
            // The mutation gate is held only long enough to close the removal gate.
            let _mutation = self.inner.mutation_gate.lock().await;
            RemovalGuard::acquire(self.inner.removals.clone(), project_id)?
        };

        // The impact is recalculated after the gate closed so no new session can slip in.
        let row = self.load_row(project_id).await?;
        self.build_impact(&row).await?;
        self.inner
            .runtime_guard
            .close_project(project_id)
            .await
            .map_err(
                // Cleanup failure keeps the project so the user can retry safely.
                |_| ProjectsError::RuntimeCleanupFailed,
            )?;

        let storage = self.inner.storage.clone();
        let id = project_id.to_owned();
        run_blocking(
            ProjectsError::PersistenceFailed,
            // Metadata is deleted only after runtime cleanup already succeeded.
            move || {
                storage.with_transaction(
                    // No filesystem delete ever runs; only the metadata row is removed.
                    |transaction| {
                        if repository::delete_project(transaction, &id)? == 0 {
                            return Err(ProjectsError::ProjectNotFound {
                                project_id: id.clone(),
                            });
                        }
                        Ok(())
                    },
                )
            },
        )
        .await?;

        self.publish(ProjectChangeKindDto::Removed, project_id);
        Ok(RemoveProjectResultDto {
            project_id: project_id.to_owned(),
        })
    }

    /// Builds the confirmation facts from metadata and the runtime guard.
    async fn build_impact(
        &self,
        row: &ProjectRow,
    ) -> Result<RemoveProjectImpactDto, ProjectsError> {
        let impact = self
            .inner
            .runtime_guard
            .removal_impact(&row.id)
            .await
            .map_err(
                // Incomplete runtime facts must never reach a destructive confirmation.
                |_| ProjectsError::RuntimeInspectionFailed,
            )?;
        Ok(RemoveProjectImpactDto {
            project_id: row.id.clone(),
            display_name: row.display_name.clone(),
            root_path: row.root_path.clone(),
            session_count: impact.session_count,
            running_process_count: impact.running_process_count,
            unsaved_file_count: impact.unsaved_file_count,
        })
    }
}

/// Validates one incoming backup record and derives its persisted identity.
///
/// The maintenance path never touches the filesystem because it runs inside a
/// caller-owned transaction; only pure string normalization is applied.
fn validated_backup_row(
    identity: PathIdentity,
    record: &ProjectBackupRecordV1,
) -> Result<ProjectRow, ProjectsError> {
    validate_project_id(&record.id)?;
    let display_name = normalize_display_name(&record.display_name)?;
    let raw_root = trim_trailing_separator(&strip_verbatim_prefix(&record.root_path));
    if raw_root.is_empty() || !Path::new(&raw_root).is_absolute() {
        return Err(ProjectsError::InvalidProjectFolder {
            reason: InvalidProjectFolderReasonDto::NotAbsolute,
        });
    }
    if is_filesystem_root(&raw_root) {
        return Err(ProjectsError::InvalidProjectFolder {
            reason: InvalidProjectFolderReasonDto::FileSystemRoot,
        });
    }
    if record.added_at_ms < 0 || record.last_opened_at_ms < record.added_at_ms {
        // A record whose timestamps break the schema check can never be committed.
        return Err(ProjectsError::ClockFailed);
    }

    let path_key = path_key_for(identity, &raw_root);
    Ok(ProjectRow {
        id: record.id.clone(),
        display_name,
        root_path: raw_root,
        path_key,
        is_pinned: record.is_pinned,
        added_at_ms: record.added_at_ms,
        last_opened_at_ms: record.last_opened_at_ms,
    })
}

impl ProjectService {
    /// Exports deterministic project records in the coordinator snapshot.
    pub fn export_backup_records_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<Vec<ProjectBackupRecordV1>, ProjectsError> {
        let mut rows = repository::select_all_ordered(tx)?;
        // Sorting in Rust keeps the export byte-for-byte stable across SQLite plans.
        rows.sort_by(compare_list_order);
        Ok(rows
            .into_iter()
            .map(
                // Copies only the fields the backup package is allowed to carry.
                |row| ProjectBackupRecordV1 {
                    id: row.id,
                    display_name: row.display_name,
                    root_path: row.root_path,
                    is_pinned: row.is_pinned,
                    added_at_ms: row.added_at_ms,
                    last_opened_at_ms: row.last_opened_at_ms,
                },
            )
            .collect())
    }

    /// Validates incoming projects and builds the project remap and merge plan.
    pub fn prepare_backup_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        records: &[ProjectBackupRecordV1],
    ) -> Result<ProjectImportPlan, ProjectsError> {
        let identity = self.inner.identity;
        let local = repository::select_all_ordered(tx)?;
        let mut by_path_key: HashMap<String, ProjectRow> = HashMap::new();
        let mut by_id: HashMap<String, ProjectRow> = HashMap::new();
        let mut entries: HashMap<String, String> = HashMap::new();
        for row in local {
            // Local projects map onto themselves so later participants can resolve them.
            entries.insert(row.id.clone(), row.id.clone());
            by_path_key.insert(row.path_key.clone(), row.clone());
            by_id.insert(row.id.clone(), row);
        }

        let mut counts = ProjectImportCounts::default();
        let mut inserts = Vec::new();
        let mut updates = Vec::new();
        let mut changes = Vec::new();
        let mut claimed_path_keys: HashMap<String, String> = HashMap::new();

        for record in records {
            let incoming = validated_backup_row(identity, record)?;
            // Two incoming records naming one folder cannot both be committed.
            if let Some(owner) = claimed_path_keys.get(&incoming.path_key) {
                return Err(ProjectsError::ProjectAlreadyExists {
                    project_id: owner.clone(),
                });
            }

            let target = match by_path_key.get(&incoming.path_key) {
                // A matching folder wins over the source identifier so no duplicate root appears.
                Some(existing) => {
                    counts.path_matches += 1;
                    ProjectRow {
                        id: existing.id.clone(),
                        ..incoming
                    }
                }
                None => incoming,
            };

            match by_id.get(&target.id) {
                Some(existing) if existing == &target => {
                    counts.unchanged += 1;
                }
                Some(_) => {
                    counts.updates += 1;
                    changes.push(ProjectChangedEventDto {
                        change: ProjectChangeKindDto::Updated,
                        project_id: target.id.clone(),
                    });
                    updates.push(target.clone());
                }
                None => {
                    counts.inserts += 1;
                    changes.push(ProjectChangedEventDto {
                        change: ProjectChangeKindDto::Added,
                        project_id: target.id.clone(),
                    });
                    inserts.push(target.clone());
                }
            }

            claimed_path_keys.insert(target.path_key.clone(), target.id.clone());
            entries.insert(record.id.clone(), target.id.clone());
        }

        Ok(ProjectImportPlan {
            counts,
            import_map: ProjectImportMap::from_entries(entries),
            inserts,
            updates,
            projection: ProjectCommittedProjection::new(changes),
        })
    }

    /// Applies a prepared project merge inside the coordinator transaction.
    pub fn apply_backup_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &ProjectImportPlan,
    ) -> Result<ProjectCommittedProjection, ProjectsError> {
        for row in &plan.updates {
            if repository::update_full_row(tx, row)? == 0 {
                return Err(ProjectsError::ProjectNotFound {
                    project_id: row.id.clone(),
                });
            }
        }
        for row in &plan.inserts {
            repository::insert_project(tx, row)?;
        }
        Ok(plan.projection.clone())
    }

    /// Deletes project metadata inside the shared reset transaction.
    pub fn reset_projects_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<ProjectCommittedProjection, ProjectsError> {
        let removed = repository::select_ordered_ids(tx)?;
        repository::delete_all(tx)?;
        Ok(ProjectCommittedProjection::new(
            removed
                .into_iter()
                .map(
                    // Every cleared project becomes one committed removal payload.
                    |project_id| ProjectChangedEventDto {
                        change: ProjectChangeKindDto::Removed,
                        project_id,
                    },
                )
                .collect(),
        ))
    }

    /// Publishes a prepared projection after the coordinator commit.
    pub fn publish_data_change(&self, projection: ProjectCommittedProjection) {
        for change in projection.changes {
            // Publication consumes owned payloads and can never fail the commit.
            self.publish(change.change, &change.project_id);
        }
    }
}

/// Reads one row or maps its absence to the public not-found failure.
fn load_existing(
    connection: &rusqlite::Connection,
    project_id: &str,
) -> Result<ProjectRow, ProjectsError> {
    repository::select_by_id(connection, project_id)?.ok_or_else(
        // A row removed by a competing operation is never silently recreated.
        || ProjectsError::ProjectNotFound {
            project_id: project_id.to_owned(),
        },
    )
}

#[cfg(test)]
pub(super) mod test_support {
    use std::{
        collections::VecDeque,
        path::{Path, PathBuf},
        sync::{
            Arc, Mutex,
            atomic::{AtomicI64, AtomicUsize, Ordering},
        },
    };

    use tempfile::TempDir;

    use super::{PathIdentity, ProjectService};
    use crate::projects::error::ProjectsError;
    use crate::projects::models::{ProjectChangedEventDto, ProjectDto, ProjectFolderSelectionDto};
    use crate::projects::platform::{
        NoProjectRuntimeGuard, ProjectClock, ProjectEventSink, ProjectFuture, ProjectIdFactory,
        ProjectPlatform, ProjectRuntimeGuard,
    };
    use crate::shared::DataMaintenanceGate;
    use crate::storage::Storage;

    /// Returns configured picker and opener outcomes without native user interface.
    pub(in crate::projects) struct FakePlatform {
        selections: Mutex<VecDeque<Result<Option<PathBuf>, ProjectsError>>>,
        open_result: Mutex<Result<(), ProjectsError>>,
        pub opened: Mutex<Vec<PathBuf>>,
        pub select_calls: AtomicUsize,
    }

    impl FakePlatform {
        /// Creates a fake platform that cancels the picker until selections are queued.
        pub(in crate::projects) fn new() -> Self {
            Self {
                selections: Mutex::new(VecDeque::new()),
                open_result: Mutex::new(Ok(())),
                opened: Mutex::new(Vec::new()),
                select_calls: AtomicUsize::new(0),
            }
        }

        /// Queues one picker outcome consumed by the next selection request.
        pub(in crate::projects) fn queue_selection(
            &self,
            selection: Result<Option<PathBuf>, ProjectsError>,
        ) {
            self.selections
                .lock()
                .expect("the fixture lock should be available")
                .push_back(selection);
        }

        /// Replaces the opener outcome for failure-path assertions.
        pub(in crate::projects) fn set_open_result(&self, result: Result<(), ProjectsError>) {
            *self
                .open_result
                .lock()
                .expect("the fixture lock should be available") = result;
        }

        /// Returns every directory the fake opener was asked to reveal.
        pub(in crate::projects) fn opened_paths(&self) -> Vec<PathBuf> {
            self.opened
                .lock()
                .expect("the fixture lock should be available")
                .clone()
        }

        /// Returns how many times the native picker would have been opened.
        pub(in crate::projects) fn selection_count(&self) -> usize {
            self.select_calls.load(Ordering::SeqCst)
        }
    }

    impl ProjectPlatform for FakePlatform {
        /// Returns the next queued picker outcome and records the request.
        fn select_folder<'a>(
            &'a self,
        ) -> ProjectFuture<'a, Result<Option<PathBuf>, ProjectsError>> {
            self.select_calls.fetch_add(1, Ordering::SeqCst);
            let result = self
                .selections
                .lock()
                .expect("the fixture lock should be available")
                .pop_front()
                .unwrap_or(Ok(None));
            Box::pin(async move { result })
        }

        /// Records the opened directory and returns the configured outcome.
        fn open_folder<'a>(
            &'a self,
            path: &'a Path,
        ) -> ProjectFuture<'a, Result<(), ProjectsError>> {
            self.opened
                .lock()
                .expect("the fixture lock should be available")
                .push(path.to_path_buf());
            let result = self
                .open_result
                .lock()
                .expect("the fixture lock should be available")
                .clone();
            Box::pin(async move { result })
        }
    }

    /// Returns a caller-controlled millisecond timestamp.
    pub(in crate::projects) struct FakeClock {
        now: AtomicI64,
        failing: Mutex<bool>,
    }

    impl FakeClock {
        /// Creates a clock pinned at the supplied timestamp.
        pub(in crate::projects) fn new(now_ms: i64) -> Self {
            Self {
                now: AtomicI64::new(now_ms),
                failing: Mutex::new(false),
            }
        }

        /// Moves the fake clock to an exact timestamp.
        pub(in crate::projects) fn set(&self, now_ms: i64) {
            self.now.store(now_ms, Ordering::SeqCst);
        }

        /// Makes every later timestamp read fail like an unusable system clock.
        pub(in crate::projects) fn fail(&self, failing: bool) {
            *self
                .failing
                .lock()
                .expect("the fixture lock should be available") = failing;
        }
    }

    impl ProjectClock for FakeClock {
        /// Returns the configured timestamp or the configured clock failure.
        fn now_ms(&self) -> Result<i64, ProjectsError> {
            if *self
                .failing
                .lock()
                .expect("the fixture lock should be available")
            {
                return Err(ProjectsError::ClockFailed);
            }
            Ok(self.now.load(Ordering::SeqCst))
        }
    }

    /// Returns deterministic canonical identifiers for new projects.
    pub(in crate::projects) struct FakeIdFactory {
        next: AtomicI64,
    }

    impl FakeIdFactory {
        /// Creates an identifier factory starting at the first fixture value.
        pub(in crate::projects) fn new() -> Self {
            Self {
                next: AtomicI64::new(1),
            }
        }
    }

    impl ProjectIdFactory for FakeIdFactory {
        /// Returns the next canonical hyphenated fixture identifier.
        fn new_project_id(&self) -> String {
            let value = self.next.fetch_add(1, Ordering::SeqCst);
            format!("{value:08x}-0000-4000-8000-{value:012x}")
        }
    }

    /// Records every published change and can simulate delivery failure.
    pub(in crate::projects) struct RecordingEventSink {
        published: Mutex<Vec<ProjectChangedEventDto>>,
        failing: Mutex<bool>,
    }

    impl RecordingEventSink {
        /// Creates an event sink that always succeeds.
        pub(in crate::projects) fn new() -> Self {
            Self {
                published: Mutex::new(Vec::new()),
                failing: Mutex::new(false),
            }
        }

        /// Makes every later publication fail after its transaction committed.
        pub(in crate::projects) fn fail(&self, failing: bool) {
            *self
                .failing
                .lock()
                .expect("the fixture lock should be available") = failing;
        }

        /// Returns every recorded change as a debug-kind and project-id pair.
        pub(in crate::projects) fn recorded(&self) -> Vec<(String, String)> {
            self.published
                .lock()
                .expect("the fixture lock should be available")
                .iter()
                .map(
                    // Reduces the payload to the two fields assertions care about.
                    |event| (format!("{:?}", event.change), event.project_id.clone()),
                )
                .collect()
        }
    }

    impl ProjectEventSink for RecordingEventSink {
        /// Records the attempted publication and returns the configured outcome.
        fn publish(&self, event: ProjectChangedEventDto) -> Result<(), ProjectsError> {
            self.published
                .lock()
                .expect("the fixture lock should be available")
                .push(event);
            if *self
                .failing
                .lock()
                .expect("the fixture lock should be available")
            {
                return Err(ProjectsError::PersistenceFailed);
            }
            Ok(())
        }
    }

    /// Owns one isolated service, its temporary state, and its injected fakes.
    pub(in crate::projects) struct Harness {
        pub service: ProjectService,
        pub platform: Arc<FakePlatform>,
        pub clock: Arc<FakeClock>,
        pub events: Arc<RecordingEventSink>,
        pub gate: DataMaintenanceGate,
        pub workspace: TempDir,
        _app_data: TempDir,
    }

    impl Harness {
        /// Builds an isolated harness whose runtime guard closes nothing.
        pub(in crate::projects) fn new() -> Self {
            Self::with_guard(Arc::new(NoProjectRuntimeGuard), PathIdentity::WindowsLike)
        }

        /// Builds an isolated harness with the supplied runtime guard and identity.
        pub(in crate::projects) fn with_guard(
            runtime_guard: Arc<dyn ProjectRuntimeGuard>,
            identity: PathIdentity,
        ) -> Self {
            let app_data = TempDir::new().expect("the temporary app data should be created");
            let workspace = TempDir::new().expect("the temporary workspace should be created");
            let storage = Storage::open(app_data.path()).expect("isolated storage should open");
            let platform = Arc::new(FakePlatform::new());
            let clock = Arc::new(FakeClock::new(1_000));
            let events = Arc::new(RecordingEventSink::new());
            let gate = DataMaintenanceGate::new();
            let service = ProjectService::with_seams(
                storage,
                gate.clone(),
                platform.clone(),
                runtime_guard,
                events.clone(),
                clock.clone(),
                Arc::new(FakeIdFactory::new()),
                identity,
            );

            Self {
                service,
                platform,
                clock,
                events,
                gate,
                workspace,
                _app_data: app_data,
            }
        }

        /// Creates one workspace folder and returns its absolute path.
        pub(in crate::projects) fn folder(&self, name: &str) -> PathBuf {
            let path = self.workspace.path().join(name);
            std::fs::create_dir_all(&path).expect("the fixture folder should be created");
            path
        }

        /// Registers one workspace folder as a project and returns its snapshot.
        pub(in crate::projects) fn add_folder(&self, name: &str) -> ProjectDto {
            let path = self.folder(name);
            self.platform.queue_selection(Ok(Some(path)));
            match tauri::async_runtime::block_on(self.service.add_project())
                .expect("the fixture project should be added")
            {
                ProjectFolderSelectionDto::Selected { project } => project,
                ProjectFolderSelectionDto::Cancelled => {
                    panic!("the fixture selection should not cancel")
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::test_support::Harness;
    use super::{
        CURRENT_PATH_IDENTITY, PathIdentity, availability_reason_for, canonical_text,
        derive_display_name, folder_reason_for, is_filesystem_root, measure_availability,
        path_key_for, strip_verbatim_prefix, trim_trailing_separator, validate_selected_folder,
    };
    use crate::projects::error::{InvalidProjectFolderReasonDto, ProjectsError};
    use crate::projects::models::{
        ProjectAvailabilityDto, ProjectFolderSelectionDto, ProjectUnavailableReasonDto,
    };

    /// Runs one service future on the shared Tauri async runtime.
    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    /// Extracts the project of a successful folder selection.
    fn selected(outcome: ProjectFolderSelectionDto) -> crate::projects::models::ProjectDto {
        match outcome {
            ProjectFolderSelectionDto::Selected { project } => project,
            ProjectFolderSelectionDto::Cancelled => panic!("the selection should not be cancelled"),
        }
    }

    /// Verifies that the built binary uses its own platform's identity rules.
    #[test]
    fn current_identity_matches_the_build_target() {
        if cfg!(windows) {
            assert_eq!(CURRENT_PATH_IDENTITY, PathIdentity::WindowsLike);
        } else {
            assert_eq!(CURRENT_PATH_IDENTITY, PathIdentity::CasePreserving);
        }
    }

    /// Verifies Windows verbatim prefixes are removed only when it stays safe.
    #[test]
    fn verbatim_prefixes_are_stripped_safely() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Work\XWork"),
            r"C:\Work\XWork"
        );
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\XWork"),
            r"\\server\share\XWork"
        );
        // A volume GUID path keeps its prefix because removing it changes the meaning.
        assert_eq!(
            strip_verbatim_prefix(r"\\?\Volume{0}\XWork"),
            r"\\?\Volume{0}\XWork"
        );
        assert_eq!(strip_verbatim_prefix("/srv/docs"), "/srv/docs");
    }

    /// Verifies that display paths never keep a trailing separator.
    #[test]
    fn trailing_separators_are_removed() {
        assert_eq!(trim_trailing_separator(r"C:\Work\XWork\"), r"C:\Work\XWork");
        assert_eq!(trim_trailing_separator("/srv/docs/"), "/srv/docs");
        assert_eq!(trim_trailing_separator("/"), "/");
        assert_eq!(trim_trailing_separator(r"\\"), r"\");
    }

    /// Verifies Windows keys ignore case and separator while macOS keeps case.
    #[test]
    fn path_keys_follow_platform_identity_rules() {
        assert_eq!(
            path_key_for(PathIdentity::WindowsLike, r"C:\Work\XWork"),
            "c:/work/xwork"
        );
        assert_eq!(
            path_key_for(PathIdentity::WindowsLike, r"c:/WORK/xwork"),
            "c:/work/xwork"
        );
        assert_eq!(
            path_key_for(PathIdentity::WindowsLike, r"\\server\share\XWork"),
            "//server/share/xwork"
        );
        assert_eq!(
            path_key_for(PathIdentity::WindowsLike, r"D:\Work\Größe"),
            "d:/work/größe"
        );
        // A case-preserving filesystem must keep the exact canonical spelling.
        assert_eq!(
            path_key_for(PathIdentity::CasePreserving, "/Users/dev/XWork"),
            "/Users/dev/XWork"
        );
        assert_ne!(
            path_key_for(PathIdentity::CasePreserving, "/Users/dev/xwork"),
            path_key_for(PathIdentity::CasePreserving, "/Users/dev/XWork")
        );
    }

    /// Verifies that only paths without an ordinary component count as roots.
    #[test]
    fn filesystem_roots_are_detected() {
        assert!(is_filesystem_root(r"C:\"));
        assert!(is_filesystem_root("C:"));
        assert!(is_filesystem_root("/"));
        assert!(is_filesystem_root(r"\\server\share"));
        assert!(!is_filesystem_root(r"C:\Work"));
        assert!(!is_filesystem_root("/srv/docs"));
        assert!(!is_filesystem_root(r"\\server\share\XWork"));
    }

    /// Verifies that the display name comes from the final ordinary component.
    #[test]
    fn display_names_come_from_the_final_component() {
        assert_eq!(
            derive_display_name(r"C:\Work\XWork"),
            Ok("XWork".to_owned())
        );
        assert_eq!(derive_display_name("/srv/docs"), Ok("docs".to_owned()));
        assert_eq!(
            derive_display_name(r"\\server\share\Tài liệu"),
            Ok("Tài liệu".to_owned())
        );
        assert_eq!(
            derive_display_name(r"C:\"),
            Err(ProjectsError::InvalidDisplayName)
        );
    }

    /// Verifies that every filesystem failure keeps its documented public reason.
    #[test]
    fn filesystem_failures_map_to_documented_reasons() {
        use std::io::ErrorKind;

        assert_eq!(
            availability_reason_for(ErrorKind::NotFound),
            ProjectUnavailableReasonDto::Missing
        );
        assert_eq!(
            availability_reason_for(ErrorKind::PermissionDenied),
            ProjectUnavailableReasonDto::AccessDenied
        );
        assert_eq!(
            availability_reason_for(ErrorKind::InvalidData),
            ProjectUnavailableReasonDto::Io
        );
        assert_eq!(
            folder_reason_for(ErrorKind::NotFound),
            InvalidProjectFolderReasonDto::Missing
        );
        assert_eq!(
            folder_reason_for(ErrorKind::PermissionDenied),
            InvalidProjectFolderReasonDto::AccessDenied
        );
        assert_eq!(
            folder_reason_for(ErrorKind::InvalidData),
            InvalidProjectFolderReasonDto::CannotCanonicalize
        );
    }

    /// Verifies that a lossy path representation is rejected before persistence.
    #[cfg(windows)]
    #[test]
    fn lossy_path_representation_is_rejected() {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;

        // An unpaired surrogate cannot round-trip through UTF-8.
        let lossy = OsString::from_wide(&[0x0043, 0x003a, 0x005c, 0xd800]);
        let path = PathBuf::from(lossy);

        assert_eq!(
            canonical_text(&path),
            Err(ProjectsError::InvalidProjectFolder {
                reason: InvalidProjectFolderReasonDto::NotUtf8
            })
        );
        assert_eq!(canonical_text(Path::new(r"C:\Work")), Ok(r"C:\Work"));
    }

    /// Verifies that folder validation rejects every documented bad selection.
    #[test]
    fn folder_validation_rejects_invalid_selections() {
        let harness = Harness::new();
        let workspace = harness.workspace.path();

        assert_eq!(
            validate_selected_folder(CURRENT_PATH_IDENTITY, Path::new("relative/folder")),
            Err(ProjectsError::InvalidProjectFolder {
                reason: InvalidProjectFolderReasonDto::NotAbsolute
            })
        );
        assert_eq!(
            validate_selected_folder(CURRENT_PATH_IDENTITY, &workspace.join("missing")),
            Err(ProjectsError::InvalidProjectFolder {
                reason: InvalidProjectFolderReasonDto::Missing
            })
        );

        let file_path = workspace.join("plain.txt");
        std::fs::write(&file_path, b"fixture").expect("the fixture file should be created");
        assert_eq!(
            validate_selected_folder(CURRENT_PATH_IDENTITY, &file_path),
            Err(ProjectsError::InvalidProjectFolder {
                reason: InvalidProjectFolderReasonDto::NotDirectory
            })
        );

        let root = workspace
            .ancestors()
            .last()
            .expect("every path has a root ancestor");
        assert_eq!(
            validate_selected_folder(CURRENT_PATH_IDENTITY, root),
            Err(ProjectsError::InvalidProjectFolder {
                reason: InvalidProjectFolderReasonDto::FileSystemRoot
            })
        );
    }

    /// Verifies that a valid folder produces a canonical identity and name.
    #[test]
    fn folder_validation_derives_canonical_identity() {
        let harness = Harness::new();
        let folder = harness.folder("Work Space");

        let validated = validate_selected_folder(CURRENT_PATH_IDENTITY, &folder)
            .expect("the fixture folder should validate");

        assert_eq!(validated.display_name, "Work Space");
        assert!(!validated.root_path.starts_with(r"\\?\"));
        assert!(!validated.root_path.ends_with(['\\', '/']));
        assert_eq!(
            validated.path_key,
            path_key_for(CURRENT_PATH_IDENTITY, &validated.root_path)
        );
    }

    /// Verifies that availability reflects the live folder state, never a stored flag.
    #[test]
    fn availability_is_measured_from_the_live_folder() {
        let harness = Harness::new();
        let folder = harness.folder("Live");
        assert_eq!(
            measure_availability(&folder),
            ProjectAvailabilityDto::Available
        );

        let file_path = harness.workspace.path().join("file.txt");
        std::fs::write(&file_path, b"fixture").expect("the fixture file should be created");
        assert_eq!(
            measure_availability(&file_path),
            ProjectAvailabilityDto::Unavailable(ProjectUnavailableReasonDto::NotDirectory)
        );
        assert_eq!(
            measure_availability(&harness.workspace.path().join("gone")),
            ProjectAvailabilityDto::Unavailable(ProjectUnavailableReasonDto::Missing)
        );
    }

    /// Verifies that cancelling the picker writes nothing and emits nothing.
    #[test]
    fn cancelled_add_writes_nothing() {
        let harness = Harness::new();
        harness.platform.queue_selection(Ok(None));

        let outcome = run(harness.service.add_project()).expect("cancelling should succeed");

        assert_eq!(outcome, ProjectFolderSelectionDto::Cancelled);
        assert!(
            run(harness.service.list_projects(None))
                .expect("the list should be readable")
                .is_empty()
        );
        assert!(harness.events.recorded().is_empty());
    }

    /// Verifies that a failing picker never reaches the database.
    #[test]
    fn failing_picker_writes_nothing() {
        let harness = Harness::new();
        harness
            .platform
            .queue_selection(Err(ProjectsError::FolderPickerFailed));

        let error =
            run(harness.service.add_project()).expect_err("the picker failure should surface");

        assert_eq!(error, ProjectsError::FolderPickerFailed);
        assert!(
            run(harness.service.list_projects(None))
                .expect("the list should be readable")
                .is_empty()
        );
        assert!(harness.events.recorded().is_empty());
    }

    /// Verifies that adding a folder persists canonical metadata and emits once.
    #[test]
    fn adding_a_folder_persists_canonical_metadata() {
        let harness = Harness::new();
        harness.clock.set(5_000);

        let project = harness.add_folder("XWork");

        assert_eq!(project.display_name, "XWork");
        assert!(!project.is_pinned);
        assert_eq!(project.added_at_ms, 5_000);
        assert_eq!(project.last_opened_at_ms, 5_000);
        assert_eq!(project.availability, ProjectAvailabilityDto::Available);
        assert_eq!(
            harness.events.recorded(),
            vec![("Added".to_owned(), project.id.clone())]
        );
        assert_eq!(
            run(harness.service.get_project(&project.id)).expect("the project should be readable"),
            project
        );
    }

    /// Verifies that a failing clock prevents both the row and the event.
    #[test]
    fn failing_clock_prevents_the_new_project() {
        let harness = Harness::new();
        let folder = harness.folder("XWork");
        harness.platform.queue_selection(Ok(Some(folder)));
        harness.clock.fail(true);

        let error =
            run(harness.service.add_project()).expect_err("the clock failure should surface");

        assert_eq!(error, ProjectsError::ClockFailed);
        assert!(
            run(harness.service.list_projects(None))
                .expect("the list should be readable")
                .is_empty()
        );
        assert!(harness.events.recorded().is_empty());
    }

    /// Verifies that the same canonical folder cannot be registered twice.
    #[test]
    fn duplicate_canonical_folders_are_rejected() {
        let harness = Harness::new();
        let first = harness.add_folder("XWork");
        let folder = harness.folder("XWork");

        // A separator and case variant still resolves to the same canonical folder.
        let variant = PathBuf::from(folder.to_string_lossy().to_uppercase().replace('\\', "/"));
        harness.platform.queue_selection(Ok(Some(variant)));
        let error = run(harness.service.add_project())
            .expect_err("the duplicate folder should be rejected");

        assert_eq!(
            error,
            ProjectsError::ProjectAlreadyExists {
                project_id: first.id.clone()
            }
        );
        assert_eq!(
            run(harness.service.list_projects(None))
                .expect("the list should be readable")
                .len(),
            1
        );
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that two different folders may share one display name.
    #[test]
    fn duplicate_display_names_are_allowed() {
        let harness = Harness::new();
        let first_parent = harness.folder("first");
        let second_parent = harness.folder("second");
        for parent in [&first_parent, &second_parent] {
            let path = parent.join("XWork");
            std::fs::create_dir_all(&path).expect("the fixture folder should be created");
            harness.platform.queue_selection(Ok(Some(path)));
            run(harness.service.add_project()).expect("the project should be added");
        }

        let projects =
            run(harness.service.list_projects(None)).expect("the list should be readable");

        assert_eq!(projects.len(), 2);
        assert!(projects.iter().all(
            // Both projects keep the same derived basename.
            |project| project.display_name == "XWork"
        ));
    }

    /// Verifies that an unusable basename is rejected before persistence.
    #[test]
    fn invalid_basename_is_rejected() {
        let harness = Harness::new();
        let long_name = "n".repeat(256);
        let folder = harness.workspace.path().join(&long_name);
        // Creating a 256-character folder can fail on constrained filesystems.
        if std::fs::create_dir_all(&folder).is_err() {
            return;
        }
        harness.platform.queue_selection(Ok(Some(folder)));

        let error =
            run(harness.service.add_project()).expect_err("the long basename should be rejected");

        assert_eq!(error, ProjectsError::InvalidDisplayName);
        assert!(harness.events.recorded().is_empty());
    }

    /// Verifies that renaming changes only the display name and emits once.
    #[test]
    fn renaming_changes_only_the_display_name() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");

        let renamed = run(harness.service.rename_project(&project.id, "  Renamed  "))
            .expect("the rename should succeed");

        assert_eq!(renamed.display_name, "Renamed");
        assert_eq!(renamed.root_path, project.root_path);
        assert_eq!(renamed.added_at_ms, project.added_at_ms);
        assert_eq!(renamed.last_opened_at_ms, project.last_opened_at_ms);
        assert_eq!(
            harness.events.recorded(),
            vec![
                ("Added".to_owned(), project.id.clone()),
                ("Updated".to_owned(), project.id.clone())
            ]
        );
    }

    /// Verifies that an unchanged rename neither writes nor emits.
    #[test]
    fn unchanged_rename_is_a_no_op() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");

        let unchanged = run(harness.service.rename_project(&project.id, "XWork"))
            .expect("the no-op rename should succeed");

        assert_eq!(unchanged, project);
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that an invalid display name is rejected before storage work.
    #[test]
    fn invalid_rename_is_rejected() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");

        for rejected in ["   ", "Bad\u{7f}Name"] {
            assert_eq!(
                run(harness.service.rename_project(&project.id, rejected)),
                Err(ProjectsError::InvalidDisplayName)
            );
        }
        assert_eq!(
            run(harness.service.get_project(&project.id))
                .expect("the project should be readable")
                .display_name,
            "XWork"
        );
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that pinning reorders the list without changing timestamps.
    #[test]
    fn pinning_reorders_without_changing_timestamps() {
        let harness = Harness::new();
        harness.clock.set(10);
        let first = harness.add_folder("first");
        harness.clock.set(20);
        let second = harness.add_folder("second");

        let pinned = run(harness.service.set_project_pinned(&second.id, true))
            .expect("the pin should succeed");

        assert!(pinned.is_pinned);
        assert_eq!(pinned.added_at_ms, second.added_at_ms);
        assert_eq!(pinned.last_opened_at_ms, second.last_opened_at_ms);
        assert_eq!(
            run(harness.service.ordered_project_ids()).expect("the order should be readable"),
            vec![second.id.clone(), first.id.clone()]
        );

        run(harness.service.set_project_pinned(&second.id, false))
            .expect("the unpin should succeed");
        assert_eq!(
            run(harness.service.ordered_project_ids()).expect("the order should be readable"),
            vec![first.id, second.id]
        );
    }

    /// Verifies that an unchanged pinned value neither writes nor emits.
    #[test]
    fn unchanged_pin_is_a_no_op() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");

        let unchanged = run(harness.service.set_project_pinned(&project.id, false))
            .expect("the no-op pin should succeed");

        assert_eq!(unchanged, project);
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that the last-opened timestamp never moves backwards.
    #[test]
    fn last_opened_timestamp_is_monotonic() {
        let harness = Harness::new();
        harness.clock.set(1_000);
        let project = harness.add_folder("XWork");

        harness.clock.set(2_000);
        let advanced =
            run(harness.service.open_project(&project.id)).expect("the open should succeed");
        assert_eq!(advanced.last_opened_at_ms, 2_000);

        // A backwards system clock must leave the persisted timestamp untouched.
        harness.clock.set(500);
        let unchanged =
            run(harness.service.open_project(&project.id)).expect("the open should succeed");
        assert_eq!(unchanged.last_opened_at_ms, 2_000);
        assert_eq!(
            harness.events.recorded(),
            vec![
                ("Added".to_owned(), project.id.clone()),
                ("Updated".to_owned(), project.id.clone())
            ]
        );
    }

    /// Verifies that an unavailable project can still be opened and renamed.
    #[test]
    fn unavailable_projects_stay_manageable() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        std::fs::remove_dir_all(&project.root_path).expect("the fixture folder should be removed");

        let listed = run(harness.service.list_projects(None)).expect("the list should be readable");
        assert_eq!(
            listed[0].availability,
            ProjectAvailabilityDto::Unavailable(ProjectUnavailableReasonDto::Missing)
        );
        let opened =
            run(harness.service.open_project(&project.id)).expect("the overview should open");
        assert_eq!(
            opened.availability,
            ProjectAvailabilityDto::Unavailable(ProjectUnavailableReasonDto::Missing)
        );
        run(harness.service.rename_project(&project.id, "Renamed"))
            .expect("renaming should stay possible");
    }

    /// Verifies that opening the folder is blocked while the root is unavailable.
    #[test]
    fn opening_an_unavailable_root_is_blocked() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        std::fs::remove_dir_all(&project.root_path).expect("the fixture folder should be removed");

        let error = run(harness.service.open_project_folder(&project.id))
            .expect_err("the unavailable root should be rejected");

        assert_eq!(
            error,
            ProjectsError::ProjectUnavailable {
                reason: ProjectUnavailableReasonDto::Missing
            }
        );
        assert!(harness.platform.opened_paths().is_empty());
    }

    /// Verifies that opening a folder uses the stored root and changes nothing.
    #[test]
    fn opening_a_folder_uses_the_stored_root() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");

        run(harness.service.open_project_folder(&project.id)).expect("the opener should succeed");

        assert_eq!(
            harness.platform.opened_paths(),
            vec![PathBuf::from(&project.root_path)]
        );
        assert_eq!(
            run(harness.service.get_project(&project.id)).expect("the project should be readable"),
            project
        );
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that an opener failure is reported without extra side effects.
    #[test]
    fn opener_failure_is_reported() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        harness
            .platform
            .set_open_result(Err(ProjectsError::OpenFolderFailed));

        let error = run(harness.service.open_project_folder(&project.id))
            .expect_err("the opener failure should surface");

        assert_eq!(error, ProjectsError::OpenFolderFailed);
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that relocating keeps every metadata field except the two paths.
    #[test]
    fn locating_replaces_only_the_root_path() {
        let harness = Harness::new();
        harness.clock.set(10);
        let project = harness.add_folder("XWork");
        run(harness.service.set_project_pinned(&project.id, true)).expect("the pin should succeed");
        std::fs::remove_dir_all(&project.root_path).expect("the fixture folder should be removed");
        let moved = harness.folder("Moved");
        harness.platform.queue_selection(Ok(Some(moved.clone())));
        harness.clock.set(999);

        let relocated = selected(
            run(harness.service.locate_project_folder(&project.id))
                .expect("the relocation should succeed"),
        );

        assert_eq!(relocated.id, project.id);
        assert_eq!(relocated.display_name, project.display_name);
        assert!(relocated.is_pinned);
        assert_eq!(relocated.added_at_ms, project.added_at_ms);
        assert_eq!(relocated.last_opened_at_ms, project.last_opened_at_ms);
        assert_ne!(relocated.root_path, project.root_path);
        assert_eq!(relocated.availability, ProjectAvailabilityDto::Available);
        assert_eq!(
            run(harness.service.available_root(&project.id))
                .expect("the new root should be available")
                .root_path,
            PathBuf::from(&relocated.root_path)
        );
    }

    /// Verifies that cancelling relocation leaves the project untouched.
    #[test]
    fn cancelled_relocation_keeps_the_project() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        harness.platform.queue_selection(Ok(None));

        let outcome = run(harness.service.locate_project_folder(&project.id))
            .expect("cancelling should succeed");

        assert_eq!(outcome, ProjectFolderSelectionDto::Cancelled);
        assert_eq!(
            run(harness.service.get_project(&project.id)).expect("the project should be readable"),
            project
        );
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that relocating onto the same canonical folder emits nothing.
    #[test]
    fn relocating_to_the_same_folder_is_a_no_op() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        harness
            .platform
            .queue_selection(Ok(Some(PathBuf::from(&project.root_path))));

        let outcome = selected(
            run(harness.service.locate_project_folder(&project.id))
                .expect("the no-op relocation should succeed"),
        );

        assert_eq!(outcome, project);
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that relocating onto another project's folder is rejected.
    #[test]
    fn relocating_onto_another_project_is_rejected() {
        let harness = Harness::new();
        let first = harness.add_folder("first");
        let second = harness.add_folder("second");
        harness
            .platform
            .queue_selection(Ok(Some(PathBuf::from(&first.root_path))));

        let error = run(harness.service.locate_project_folder(&second.id))
            .expect_err("the taken folder should be rejected");

        assert_eq!(
            error,
            ProjectsError::ProjectAlreadyExists {
                project_id: first.id
            }
        );
        assert_eq!(
            run(harness.service.get_project(&second.id)).expect("the project should be readable"),
            second
        );
    }

    /// Verifies that relocating an unknown project never opens the picker.
    #[test]
    fn relocating_an_unknown_project_never_opens_the_picker() {
        let harness = Harness::new();
        let missing = "ffffffff-ffff-4fff-8fff-ffffffffffff";

        let error = run(harness.service.locate_project_folder(missing))
            .expect_err("the unknown project should be rejected");

        assert_eq!(
            error,
            ProjectsError::ProjectNotFound {
                project_id: missing.to_owned()
            }
        );
        assert_eq!(harness.platform.selection_count(), 0);
    }

    /// Verifies that the list keeps pinned-then-insertion order and filters safely.
    #[test]
    fn listing_keeps_order_and_filters_by_unicode() {
        let harness = Harness::new();
        harness.clock.set(10);
        let alpha = harness.add_folder("Alpha");
        harness.clock.set(20);
        let unicode = harness.add_folder("Tài liệu");
        harness.clock.set(30);
        let gamma = harness.add_folder("Gamma");
        run(harness.service.set_project_pinned(&gamma.id, true)).expect("the pin should succeed");

        let all = run(harness.service.list_projects(None)).expect("the list should be readable");
        assert_eq!(
            all.iter()
                .map(
                    // Reduces the snapshot to identifiers for the order assertion.
                    |project| project.id.clone()
                )
                .collect::<Vec<_>>(),
            vec![gamma.id.clone(), alpha.id.clone(), unicode.id.clone()]
        );

        let filtered = run(harness.service.list_projects(Some("  TÀI  ")))
            .expect("the filtered list should be readable");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, unicode.id);

        // A filter that matches the root path keeps the original list order.
        let by_path = run(harness.service.list_projects(Some("a")))
            .expect("the filtered list should be readable");
        assert_eq!(
            by_path
                .iter()
                .map(
                    // Reduces the filtered snapshot to identifiers.
                    |project| project.id.clone()
                )
                .collect::<Vec<_>>(),
            vec![gamma.id, alpha.id, unicode.id]
        );

        assert_eq!(
            run(harness.service.list_projects(Some(&"x".repeat(257)))),
            Err(ProjectsError::InvalidSearch)
        );
    }

    /// Verifies that unknown and malformed identifiers are rejected consistently.
    #[test]
    fn unknown_and_malformed_identifiers_are_rejected() {
        let harness = Harness::new();
        let missing = "ffffffff-ffff-4fff-8fff-ffffffffffff";

        for result in [
            run(harness.service.get_project("nope")),
            run(harness.service.rename_project("nope", "Name")),
            run(harness.service.set_project_pinned("nope", true)),
            run(harness.service.open_project("nope")),
        ] {
            assert_eq!(result.err(), Some(ProjectsError::InvalidProjectId));
        }
        assert_eq!(
            run(harness.service.get_project(missing)),
            Err(ProjectsError::ProjectNotFound {
                project_id: missing.to_owned()
            })
        );
        assert_eq!(
            run(harness.service.open_project_folder(missing)),
            Err(ProjectsError::ProjectNotFound {
                project_id: missing.to_owned()
            })
        );
    }

    /// Verifies the public consumer queries used by later capabilities.
    #[test]
    fn owner_queries_serve_backend_consumers() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");

        let snapshot = run(harness.service.session_availability(&project.id))
            .expect("the snapshot should be readable");
        assert_eq!(snapshot.project_id, project.id);
        assert!(snapshot.is_available);

        let root =
            run(harness.service.available_root(&project.id)).expect("the root should be available");
        assert_eq!(root.project_id, project.id);
        assert_eq!(root.root_path, PathBuf::from(&project.root_path));

        std::fs::remove_dir_all(&project.root_path).expect("the fixture folder should be removed");
        assert!(
            !run(harness.service.session_availability(&project.id))
                .expect("the snapshot should be readable")
                .is_available
        );
        assert_eq!(
            run(harness.service.available_root(&project.id)),
            Err(ProjectsError::ProjectUnavailable {
                reason: ProjectUnavailableReasonDto::Missing
            })
        );
    }

    /// Verifies that the command list and the owner query produce one snapshot.
    #[test]
    fn owner_list_matches_the_command_snapshot() {
        let harness = Harness::new();
        harness.add_folder("first");
        harness.add_folder("second");

        let first = run(harness.service.list_projects(None)).expect("the list should be readable");
        let second = run(harness.service.list_projects(None)).expect("the list should be readable");

        assert_eq!(first, second);
    }

    /// Verifies that a failed event delivery still returns the committed result.
    #[test]
    fn failed_event_delivery_keeps_the_committed_result() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        harness.events.fail(true);

        let renamed = run(harness.service.rename_project(&project.id, "Renamed"))
            .expect("the committed rename should still succeed");

        assert_eq!(renamed.display_name, "Renamed");
        assert_eq!(harness.events.recorded().len(), 2);
        assert_eq!(
            run(harness.service.get_project(&project.id))
                .expect("the project should be readable")
                .display_name,
            "Renamed"
        );
    }

    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };

    use super::ProjectService;
    use crate::projects::models::{ProjectDto, RemoveProjectImpactDto, RemoveProjectResultDto};
    use crate::projects::platform::{ProjectFuture, ProjectRuntimeGuard, ProjectRuntimeImpact};

    /// Signals when a parked cleanup started and releases it on demand.
    struct CleanupParking {
        started: tokio::sync::oneshot::Receiver<()>,
        release: tokio::sync::oneshot::Sender<()>,
    }

    /// Reports configurable impact, cleanup, and parking behavior for removal tests.
    struct ScriptedRuntimeGuard {
        impact: ProjectRuntimeImpact,
        inspection_fails: AtomicBool,
        cleanup_fails: AtomicBool,
        cleanup_started: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
        cleanup_release: Mutex<Option<tokio::sync::oneshot::Receiver<()>>>,
        impact_calls: AtomicUsize,
        cleanup_calls: AtomicUsize,
    }

    impl ScriptedRuntimeGuard {
        /// Creates a guard that reports the supplied impact and closes immediately.
        fn new(impact: ProjectRuntimeImpact) -> Self {
            Self {
                impact,
                inspection_fails: AtomicBool::new(false),
                cleanup_fails: AtomicBool::new(false),
                cleanup_started: Mutex::new(None),
                cleanup_release: Mutex::new(None),
                impact_calls: AtomicUsize::new(0),
                cleanup_calls: AtomicUsize::new(0),
            }
        }

        /// Parks the next cleanup call until the returned handle releases it.
        fn park_cleanup(&self) -> CleanupParking {
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = tokio::sync::oneshot::channel();
            *self
                .cleanup_started
                .lock()
                .expect("the fixture lock should be available") = Some(started_tx);
            *self
                .cleanup_release
                .lock()
                .expect("the fixture lock should be available") = Some(release_rx);
            CleanupParking {
                started: started_rx,
                release: release_tx,
            }
        }
    }

    impl ProjectRuntimeGuard for ScriptedRuntimeGuard {
        /// Returns the configured impact and records the inspection request.
        fn removal_impact<'a>(
            &'a self,
            _project_id: &'a str,
        ) -> ProjectFuture<'a, Result<ProjectRuntimeImpact, ProjectsError>> {
            self.impact_calls.fetch_add(1, Ordering::SeqCst);
            let failing = self.inspection_fails.load(Ordering::SeqCst);
            let impact = self.impact;
            Box::pin(async move {
                if failing {
                    return Err(ProjectsError::RuntimeInspectionFailed);
                }
                Ok(impact)
            })
        }

        /// Waits for the configured release, then reports the cleanup outcome.
        fn close_project<'a>(
            &'a self,
            _project_id: &'a str,
        ) -> ProjectFuture<'a, Result<(), ProjectsError>> {
            self.cleanup_calls.fetch_add(1, Ordering::SeqCst);
            let failing = self.cleanup_fails.load(Ordering::SeqCst);
            let started = self
                .cleanup_started
                .lock()
                .expect("the fixture lock should be available")
                .take();
            let release = self
                .cleanup_release
                .lock()
                .expect("the fixture lock should be available")
                .take();
            Box::pin(async move {
                // Parking on a channel models a slow session shutdown without any sleep.
                if let Some(started) = started {
                    let _ = started.send(());
                }
                if let Some(release) = release {
                    let _ = release.await;
                }
                if failing {
                    return Err(ProjectsError::RuntimeCleanupFailed);
                }
                Ok(())
            })
        }
    }

    /// Builds an isolated harness whose runtime guard follows a test script.
    fn scripted_harness(impact: ProjectRuntimeImpact) -> (Harness, Arc<ScriptedRuntimeGuard>) {
        let guard = Arc::new(ScriptedRuntimeGuard::new(impact));
        let harness = Harness::with_guard(guard.clone(), PathIdentity::WindowsLike);
        (harness, guard)
    }

    /// Writes one fixture file inside a project root and returns its bytes.
    fn seed_project_file(project: &ProjectDto) -> Vec<u8> {
        let path = std::path::Path::new(&project.root_path).join("keep.txt");
        let content = "user content that must survive removal".as_bytes().to_vec();
        std::fs::write(&path, &content).expect("the fixture file should be created");
        content
    }

    /// Verifies that removal always requires confirmation and reports live facts.
    #[test]
    fn remove_requires_confirmation_with_current_impact() {
        let (harness, _guard) = scripted_harness(ProjectRuntimeImpact {
            session_count: 2,
            running_process_count: 3,
            unsaved_file_count: 4,
        });
        let project = harness.add_folder("XWork");

        let error = run(harness.service.remove_project(&project.id, false))
            .expect_err("removal without confirmation must be rejected");

        assert_eq!(
            error,
            ProjectsError::ConfirmationRequired {
                impact: RemoveProjectImpactDto {
                    project_id: project.id.clone(),
                    display_name: project.display_name.clone(),
                    root_path: project.root_path.clone(),
                    session_count: 2,
                    running_process_count: 3,
                    unsaved_file_count: 4,
                }
            }
        );
        assert_eq!(
            run(harness.service.get_project(&project.id)).expect("the project should remain"),
            project
        );
        assert_eq!(harness.events.recorded().len(), 1);
    }

    /// Verifies that a zero-impact project still requires confirmation.
    #[test]
    fn remove_requires_confirmation_even_without_runtime_work() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");

        let error = run(harness.service.remove_project(&project.id, false))
            .expect_err("removal without confirmation must be rejected");

        assert!(matches!(
            error,
            ProjectsError::ConfirmationRequired { impact }
                if impact.session_count == 0
                    && impact.running_process_count == 0
                    && impact.unsaved_file_count == 0
        ));
    }

    /// Verifies that the impact query reports metadata plus runtime counts.
    #[test]
    fn remove_impact_query_reports_metadata_and_counts() {
        let (harness, guard) = scripted_harness(ProjectRuntimeImpact {
            session_count: 1,
            running_process_count: 5,
            unsaved_file_count: 0,
        });
        let project = harness.add_folder("XWork");

        let impact = run(harness.service.get_remove_project_impact(&project.id))
            .expect("the impact should be readable");

        assert_eq!(impact.project_id, project.id);
        assert_eq!(impact.display_name, project.display_name);
        assert_eq!(impact.root_path, project.root_path);
        assert_eq!(impact.session_count, 1);
        assert_eq!(impact.running_process_count, 5);
        assert_eq!(guard.impact_calls.load(Ordering::SeqCst), 1);
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 0);
    }

    /// Verifies that a confirmed removal recalculates impact after the gate closes.
    #[test]
    fn remove_recalculates_impact_after_closing_the_gate() {
        let (harness, guard) = scripted_harness(ProjectRuntimeImpact::default());
        let project = harness.add_folder("XWork");

        run(harness.service.remove_project(&project.id, true)).expect("the removal should succeed");

        // One inspection belongs to the confirmed run itself, after the gate closed.
        assert_eq!(guard.impact_calls.load(Ordering::SeqCst), 1);
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 1);
    }

    /// Verifies that competing mutations and new sessions are blocked while removing.
    #[test]
    fn remove_blocks_competing_mutations_and_new_sessions() {
        let (harness, guard) = scripted_harness(ProjectRuntimeImpact::default());
        let project = harness.add_folder("XWork");
        // Relocation must reach the removal gate, so its picker returns a real folder.
        harness
            .platform
            .queue_selection(Ok(Some(harness.folder("Relocated"))));
        let parking = guard.park_cleanup();
        let blocked = ProjectsError::RemovalInProgress {
            project_id: project.id.clone(),
        };

        let removed = run(async {
            let removing = {
                let service = harness.service.clone();
                let project_id = project.id.clone();
                tauri::async_runtime::spawn(
                    // Runs the confirmed removal until the parked cleanup suspends it.
                    async move { service.remove_project(&project_id, true).await },
                )
            };
            // The cleanup signal proves the removal gate is already closed.
            parking
                .started
                .await
                .expect("the parked cleanup should start");

            assert_eq!(
                harness.service.rename_project(&project.id, "Renamed").await,
                Err(blocked.clone())
            );
            assert_eq!(
                harness.service.set_project_pinned(&project.id, true).await,
                Err(blocked.clone())
            );
            assert_eq!(
                harness.service.open_project(&project.id).await,
                Err(blocked.clone())
            );
            assert_eq!(
                harness.service.locate_project_folder(&project.id).await,
                Err(blocked.clone())
            );
            assert_eq!(
                harness.service.available_root(&project.id).await,
                Err(blocked.clone())
            );
            // A future session must not be created against a project that is disappearing.
            assert!(
                !harness
                    .service
                    .session_availability(&project.id)
                    .await
                    .expect("the snapshot should be readable")
                    .is_available
            );

            let _ = parking.release.send(());
            removing
                .await
                .expect("the removal task should finish")
                .expect("the parked removal should succeed")
        });

        assert_eq!(
            removed,
            RemoveProjectResultDto {
                project_id: project.id.clone()
            }
        );
        assert!(
            run(harness.service.list_projects(None))
                .expect("the list should be readable")
                .is_empty()
        );
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 1);
    }

    /// Verifies that a failed runtime inspection keeps the project and its gate open.
    #[test]
    fn remove_keeps_the_project_when_inspection_fails() {
        let (harness, guard) = scripted_harness(ProjectRuntimeImpact::default());
        let project = harness.add_folder("XWork");
        guard.inspection_fails.store(true, Ordering::SeqCst);

        let error = run(harness.service.remove_project(&project.id, true))
            .expect_err("a failed inspection must abort the removal");

        assert_eq!(error, ProjectsError::RuntimeInspectionFailed);
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            run(harness.service.get_project(&project.id)).expect("the project should remain"),
            project
        );
        // The removal gate must be released so a retry is admitted.
        guard.inspection_fails.store(false, Ordering::SeqCst);
        run(harness.service.remove_project(&project.id, true))
            .expect("the retry should succeed after inspection recovers");
    }

    /// Verifies that a failed cleanup keeps the project row and allows a retry.
    #[test]
    fn remove_keeps_the_project_when_cleanup_fails() {
        let (harness, guard) = scripted_harness(ProjectRuntimeImpact::default());
        let project = harness.add_folder("XWork");
        let bytes = seed_project_file(&project);
        guard.cleanup_fails.store(true, Ordering::SeqCst);

        let error = run(harness.service.remove_project(&project.id, true))
            .expect_err("a failed cleanup must abort the removal");

        assert_eq!(error, ProjectsError::RuntimeCleanupFailed);
        assert_eq!(
            run(harness.service.get_project(&project.id)).expect("the project should remain"),
            project
        );
        assert_eq!(harness.events.recorded().len(), 1);

        guard.cleanup_fails.store(false, Ordering::SeqCst);
        run(harness.service.remove_project(&project.id, true))
            .expect("the retry should succeed after cleanup recovers");
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 2);
        assert_eq!(
            std::fs::read(std::path::Path::new(&project.root_path).join("keep.txt"))
                .expect("the user file should still exist"),
            bytes
        );
    }

    /// Verifies that a delete failure after cleanup keeps metadata and retries safely.
    #[test]
    fn remove_keeps_metadata_when_delete_fails_then_retry_succeeds() {
        let (harness, guard) = scripted_harness(ProjectRuntimeImpact::default());
        let project = harness.add_folder("XWork");
        let storage = harness.service.storage_for_tests();
        storage
            .with_connection(
                // Occupying the connection makes the removal transaction fail to begin.
                |connection| {
                    connection
                        .execute_batch("BEGIN IMMEDIATE")
                        .map_err(ProjectsError::from)
                },
            )
            .expect("the blocking transaction should begin");

        let error = run(harness.service.remove_project(&project.id, true))
            .expect_err("the delete must fail while the database is occupied");

        assert_eq!(error, ProjectsError::PersistenceFailed);
        // Runtime cleanup already ran, but the metadata must survive the failure.
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 1);
        assert_eq!(harness.events.recorded().len(), 1);

        storage
            .with_connection(
                // Releases the blocking transaction so the retry can commit.
                |connection| {
                    connection
                        .execute_batch("ROLLBACK")
                        .map_err(ProjectsError::from)
                },
            )
            .expect("the blocking transaction should roll back");
        assert_eq!(
            run(harness.service.get_project(&project.id))
                .expect("the project should have survived")
                .id,
            project.id
        );
        run(harness.service.remove_project(&project.id, true))
            .expect("the retry should succeed once storage recovers");
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 2);
    }

    /// Verifies that a successful removal deletes metadata but no user file.
    #[test]
    fn remove_deletes_only_metadata_and_emits_once() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        let bytes = seed_project_file(&project);

        let removed = run(harness.service.remove_project(&project.id, true))
            .expect("the removal should succeed");

        assert_eq!(removed.project_id, project.id);
        assert_eq!(
            harness.events.recorded(),
            vec![
                ("Added".to_owned(), project.id.clone()),
                ("Removed".to_owned(), project.id.clone())
            ]
        );
        assert_eq!(
            run(harness.service.get_project(&project.id)),
            Err(ProjectsError::ProjectNotFound {
                project_id: project.id.clone()
            })
        );
        // The selected folder and every byte inside it must be untouched.
        assert!(std::path::Path::new(&project.root_path).is_dir());
        assert_eq!(
            std::fs::read(std::path::Path::new(&project.root_path).join("keep.txt"))
                .expect("the user file should still exist"),
            bytes
        );
    }

    /// Verifies that a failed event after commit still returns the removal result.
    #[test]
    fn remove_returns_the_result_after_a_failed_event() {
        let harness = Harness::new();
        let project = harness.add_folder("XWork");
        harness.events.fail(true);

        let removed = run(harness.service.remove_project(&project.id, true))
            .expect("the committed removal should still succeed");

        assert_eq!(removed.project_id, project.id);
        assert!(
            run(harness.service.list_projects(None))
                .expect("the list should be readable")
                .is_empty()
        );
    }

    /// Verifies that unknown and malformed identifiers never reach the runtime guard.
    #[test]
    fn remove_rejects_unknown_and_malformed_identifiers() {
        let (harness, guard) = scripted_harness(ProjectRuntimeImpact::default());
        let missing = "ffffffff-ffff-4fff-8fff-ffffffffffff";

        assert_eq!(
            run(harness.service.remove_project("nope", true)),
            Err(ProjectsError::InvalidProjectId)
        );
        assert_eq!(
            run(harness.service.get_remove_project_impact("nope")),
            Err(ProjectsError::InvalidProjectId)
        );
        assert_eq!(
            run(harness.service.remove_project(missing, true)),
            Err(ProjectsError::ProjectNotFound {
                project_id: missing.to_owned()
            })
        );
        assert_eq!(guard.impact_calls.load(Ordering::SeqCst), 0);
        assert_eq!(guard.cleanup_calls.load(Ordering::SeqCst), 0);
    }

    /// Verifies that the service keeps the exact admission gate it was given.
    #[test]
    fn remove_service_keeps_the_injected_admission_gate() {
        let harness = Harness::new();

        assert!(harness.service.shares_gate_with(&harness.gate));
        assert!(
            !harness
                .service
                .shares_gate_with(&crate::shared::DataMaintenanceGate::new())
        );
    }

    /// Verifies that the service type stays cloneable for managed Tauri state.
    #[test]
    fn remove_service_handle_stays_cloneable() {
        let harness = Harness::new();
        let clone: ProjectService = harness.service.clone();
        let project = harness.add_folder("XWork");

        run(clone.remove_project(&project.id, true)).expect("the clone should share one service");

        assert!(
            run(harness.service.list_projects(None))
                .expect("the list should be readable")
                .is_empty()
        );
    }

    mod git_tests {
        use std::{
            path::Path,
            sync::{
                Arc, Condvar, Mutex,
                atomic::{AtomicUsize, Ordering},
            },
        };

        use tokio::sync::Semaphore;

        use super::{Harness, run};
        use crate::projects::service::test_support::FakeIdFactory;
        use crate::projects::{
            NoProjectRuntimeGuard,
            git_status::{GitInspectionMode, GitReadError, GitReadSnapshot, GitStatusReader},
            models::GitRepositoryKindDto,
            service::{PathIdentity, ProjectService},
        };

        /// Returns a fixed snapshot while recording each worker entry.
        struct RecordingReader {
            calls: AtomicUsize,
            failing: bool,
        }

        /// Parks scans so the two-permit concurrency ceiling can be observed exactly.
        struct ParkingReader {
            entered: AtomicUsize,
            active: AtomicUsize,
            maximum: AtomicUsize,
            state: Mutex<(usize, bool)>,
            changed: Condvar,
        }

        impl ParkingReader {
            /// Creates a reader whose scans remain parked until explicitly released.
            fn new() -> Self {
                Self {
                    entered: AtomicUsize::new(0),
                    active: AtomicUsize::new(0),
                    maximum: AtomicUsize::new(0),
                    state: Mutex::new((0, false)),
                    changed: Condvar::new(),
                }
            }

            /// Waits until the requested number of workers have entered.
            fn wait_for_entries(&self, expected: usize) {
                let mut state = self
                    .state
                    .lock()
                    .expect("the parking lock should be available");
                while state.0 < expected {
                    state = self
                        .changed
                        .wait(state)
                        .expect("the parking lock should remain available");
                }
            }

            /// Releases every parked worker and all later entries.
            fn release(&self) {
                let mut state = self
                    .state
                    .lock()
                    .expect("the parking lock should be available");
                state.1 = true;
                self.changed.notify_all();
            }
        }

        impl GitStatusReader for ParkingReader {
            /// Records active concurrency and waits for the test-owned release.
            fn inspect(
                &self,
                _root: &Path,
                _mode: GitInspectionMode,
            ) -> Result<GitReadSnapshot, GitReadError> {
                self.entered.fetch_add(1, Ordering::SeqCst);
                let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                self.maximum.fetch_max(active, Ordering::SeqCst);
                let mut state = self
                    .state
                    .lock()
                    .expect("the parking lock should be available");
                state.0 += 1;
                self.changed.notify_all();
                while !state.1 {
                    state = self
                        .changed
                        .wait(state)
                        .expect("the parking lock should remain available");
                }
                drop(state);
                self.active.fetch_sub(1, Ordering::SeqCst);
                Ok(GitReadSnapshot {
                    repository_kind: GitRepositoryKindDto::NotRepository,
                    head: None,
                    changed_count: 0,
                    untracked_count: 0,
                    changes: Vec::new(),
                })
            }
        }

        impl GitStatusReader for RecordingReader {
            /// Records one scan and returns the configured safe result.
            fn inspect(
                &self,
                _root: &Path,
                _mode: GitInspectionMode,
            ) -> Result<GitReadSnapshot, GitReadError> {
                self.calls.fetch_add(1, Ordering::SeqCst);
                if self.failing {
                    return Err(GitReadError);
                }
                Ok(GitReadSnapshot {
                    repository_kind: GitRepositoryKindDto::NotRepository,
                    head: None,
                    changed_count: 0,
                    untracked_count: 0,
                    changes: Vec::new(),
                })
            }
        }

        /// Returns a deliberately impossible worktree snapshot.
        struct InconsistentReader;

        impl GitStatusReader for InconsistentReader {
            /// Produces counts that cannot match the empty detailed list.
            fn inspect(
                &self,
                _root: &Path,
                _mode: GitInspectionMode,
            ) -> Result<GitReadSnapshot, GitReadError> {
                Ok(GitReadSnapshot {
                    repository_kind: GitRepositoryKindDto::Worktree,
                    head: Some(crate::projects::models::GitHeadDto::Branch {
                        name: "main".into(),
                    }),
                    changed_count: 1,
                    untracked_count: 0,
                    changes: Vec::new(),
                })
            }
        }

        /// Rebuilds the harness service around a deterministic Git reader and scan limit.
        fn service_with_reader(
            harness: &Harness,
            reader: Arc<dyn GitStatusReader>,
            limit: Arc<Semaphore>,
        ) -> ProjectService {
            ProjectService::with_git_seams(
                harness.service.storage_for_tests(),
                harness.gate.clone(),
                harness.platform.clone(),
                Arc::new(NoProjectRuntimeGuard),
                harness.events.clone(),
                harness.clock.clone(),
                Arc::new(FakeIdFactory::new()),
                PathIdentity::WindowsLike,
                reader,
                limit,
            )
        }

        /// Verifies validation occurs before permit acquisition and reader entry.
        #[test]
        fn validation_precedes_the_scan_limit_and_reader() {
            let harness = Harness::new();
            let reader = Arc::new(RecordingReader {
                calls: AtomicUsize::new(0),
                failing: false,
            });
            let limit = Arc::new(Semaphore::new(2));
            let service = service_with_reader(&harness, reader.clone(), limit.clone());

            assert_eq!(
                run(service.git_summary("not-an-id")),
                Err(crate::projects::ProjectsError::InvalidProjectId)
            );
            assert_eq!(reader.calls.load(Ordering::SeqCst), 0);
            assert_eq!(limit.available_permits(), 2);
        }

        /// Verifies public DTO attachment and sanitized reader failure mapping.
        #[test]
        fn service_attaches_the_project_id_and_sanitizes_reader_errors() {
            let harness = Harness::new();
            let project = harness.add_folder("XWork");
            let reader = Arc::new(RecordingReader {
                calls: AtomicUsize::new(0),
                failing: false,
            });
            let service =
                service_with_reader(&harness, reader.clone(), Arc::new(Semaphore::new(2)));

            let summary = run(service.git_summary(&project.id))
                .expect("the injected snapshot should succeed");
            assert_eq!(summary.project_id, project.id);
            assert_eq!(reader.calls.load(Ordering::SeqCst), 1);

            let failing = Arc::new(RecordingReader {
                calls: AtomicUsize::new(0),
                failing: true,
            });
            let service =
                service_with_reader(&harness, failing.clone(), Arc::new(Semaphore::new(2)));
            assert_eq!(
                run(service.git_status(&project.id)),
                Err(crate::projects::ProjectsError::GitInspectionFailed {
                    project_id: project.id.clone()
                })
            );
            assert_eq!(failing.calls.load(Ordering::SeqCst), 1);

            let service = service_with_reader(
                &harness,
                Arc::new(InconsistentReader),
                Arc::new(Semaphore::new(2)),
            );
            assert_eq!(
                run(service.git_status(&project.id)),
                Err(crate::projects::ProjectsError::GitInspectionFailed {
                    project_id: project.id.clone()
                })
            );
        }

        /// Verifies two scans enter while a third waits for a shared permit.
        #[test]
        fn scan_limit_admits_exactly_two_workers_at_once() {
            let harness = Harness::new();
            let project = harness.add_folder("XWork");
            let reader = Arc::new(ParkingReader::new());
            let limit = Arc::new(Semaphore::new(2));
            let service = service_with_reader(&harness, reader.clone(), limit.clone());
            let mut handles = Vec::new();
            for _ in 0..3 {
                let service = service.clone();
                let project_id = project.id.clone();
                handles.push(tauri::async_runtime::spawn(async move {
                    service.git_summary(&project_id).await
                }));
            }

            reader.wait_for_entries(2);
            assert_eq!(reader.entered.load(Ordering::SeqCst), 2);
            assert_eq!(reader.maximum.load(Ordering::SeqCst), 2);
            assert_eq!(limit.available_permits(), 0);
            reader.release();
            for handle in handles {
                run(handle)
                    .expect("the scan task should join")
                    .expect("the parked scan should succeed");
            }

            assert_eq!(reader.entered.load(Ordering::SeqCst), 3);
            assert_eq!(reader.maximum.load(Ordering::SeqCst), 2);
            assert_eq!(limit.available_permits(), 2);
        }
    }
}
