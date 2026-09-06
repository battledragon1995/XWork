use std::{
    collections::HashSet,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use ts_rs::TS;

use crate::{
    app::data_runtime::{DataResetCompletion, DataRuntimeControl},
    files::FilesService,
    platform::data::{DataPlatform, MAX_BACKUP_BYTES},
    projects::ProjectBackupRecordV1,
    shared::DataMaintenanceGate,
    storage::{Storage, StorageError},
    terminal::CliProfilesBackupV1,
};

use super::{
    SettingsBackupSection, ShortcutOverride,
    data_participant::{
        DataParticipants, ImportCommittedProjections, PreparedImportPlans,
        ResetCommittedProjections,
    },
};

/// Names the aggregate event emitted after import or reset publication.
pub const DATA_CHANGED_EVENT: &str = "data://changed";
const BACKUP_FORMAT: &str = "xwork-backup";
const SCHEMA_VERSION: u32 = 1;
const REQUEST_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_RECORDS: usize = 100_000;

/// Wraps one strict versioned XWork backup payload.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupEnvelope<T> {
    pub format: String,
    pub schema_version: u32,
    pub created_at_ms: i64,
    pub app_version: String,
    pub data: T,
}

/// Carries every Phase 1 owner section in one strict snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDataV1 {
    pub projects: Vec<ProjectBackupRecordV1>,
    pub cli_profiles: CliProfilesBackupV1,
    pub appearance: crate::settings::AppearanceSettingsDto,
    pub sidebar: crate::settings::SidebarSettingsDto,
    pub keyboard_shortcut_overrides: Vec<ShortcutOverride>,
}

/// Describes the backend-resolved application data location.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct DataLocationDto {
    pub directory: String,
    pub database_file_name: String,
    pub logs_directory_name: String,
}

/// Counts backup records without exposing their content.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct BackupContentCountsDto {
    pub projects: u32,
    pub custom_cli_profiles: u32,
    pub secret_references: u32,
    pub keyboard_shortcut_overrides: u32,
    pub notes: Option<u32>,
    pub events: Option<u32>,
}

/// Reports picker cancellation or a completed export.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    export_to = "data-management.ts"
)]
pub enum BackupExportOutcomeDto {
    Cancelled,
    Exported {
        file_name: String,
        schema_version: u32,
        counts: BackupContentCountsDto,
    },
}

/// Summarizes identity-level changes prepared by an import.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct BackupMergeCountsDto {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
    pub removals: u32,
    pub project_path_matches: u32,
}

/// Carries an immutable import preview tied to one pending request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct BackupImportPreviewDto {
    pub request_id: u32,
    pub schema_version: u32,
    pub created_at_ms: i64,
    pub source_app_version: String,
    pub counts: BackupContentCountsDto,
    pub merge: BackupMergeCountsDto,
}

/// Reports picker cancellation or an import ready for confirmation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    export_to = "data-management.ts"
)]
pub enum PrepareBackupImportOutcomeDto {
    Cancelled,
    Ready { preview: BackupImportPreviewDto },
}

/// Reports the committed import and durable cleanup backlog.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct BackupImportResultDto {
    pub schema_version: u32,
    pub applied: BackupMergeCountsDto,
    pub credential_cleanup_pending: u32,
}

/// Describes durable and runtime state affected by a confirmed reset.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct ResetImpactDto {
    pub request_id: u32,
    pub projects: u32,
    pub custom_cli_profiles: u32,
    pub keyboard_shortcut_overrides: u32,
    pub settings_differ_from_default: bool,
    pub notes: u32,
    pub events: u32,
    pub sessions: u32,
    pub running_processes: u32,
    pub unsaved_documents: u32,
}

/// Reports the exact committed Phase 1 reset counts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct ResetResultDto {
    pub projects_removed: u32,
    pub custom_cli_profiles_removed: u32,
    pub keyboard_shortcut_overrides_removed: u32,
    pub settings_reset: bool,
    pub notes_removed: u32,
    pub events_removed: u32,
    pub sessions_stopped: u32,
    pub credential_cleanup_pending: u32,
}

/// Identifies the committed aggregate data change.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "data-management.ts")]
pub enum DataChangeKindDto {
    BackupImported,
    AppReset,
}

/// Invalidates frontend projections after all owners publish.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "data-management.ts")]
pub struct DataChangedEventDto {
    pub kind: DataChangeKindDto,
}

/// Identifies the owner that rejected one backup section.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "data-management.ts")]
pub enum BackupDomainDto {
    Projects,
    Settings,
    CliProfiles,
    KeyboardShortcuts,
    Notes,
    Events,
}

/// Exposes stable Data Management failures without paths or user content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "code",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[ts(
    tag = "code",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    export_to = "data-management.ts"
)]
pub enum DataManagementError {
    UnauthorizedWindow,
    OperationInProgress,
    NoPendingOperation,
    StaleRequest,
    InvalidResetConfirmation,
    DataLocationUnavailable,
    OpenLocationFailed,
    ClipboardWriteFailed,
    FileReadFailed,
    FileWriteFailed,
    BackupTooLarge,
    InvalidBackup,
    UnsupportedBackupVersion { found: u32, supported: u32 },
    SerializeFailed,
    SnapshotFailed,
    DomainValidationFailed { domain: BackupDomainDto },
    ImportPreviewChanged { preview: BackupImportPreviewDto },
    RuntimeUnavailable,
    RuntimeCleanupFailed,
    PersistenceFailed,
}

impl std::fmt::Display for DataManagementError {
    /// Formats only the stable public category.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}
impl std::error::Error for DataManagementError {}
impl From<StorageError> for DataManagementError {
    /// Removes database details at the capability boundary.
    fn from(_: StorageError) -> Self {
        Self::PersistenceFailed
    }
}

/// Supplies monotonic request time and UTC export time without global mutation.
pub trait DataClock: Send + Sync {
    /// Returns monotonic elapsed time for request expiry.
    fn monotonic(&self) -> Duration;
    /// Returns nonnegative Unix epoch milliseconds for package metadata.
    fn epoch_ms(&self) -> Result<i64, DataManagementError>;
}

/// Uses process-local monotonic and system UTC clocks in production.
pub struct SystemDataClock {
    started: Instant,
}
impl SystemDataClock {
    /// Starts the process-local monotonic origin.
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}
impl Default for SystemDataClock {
    /// Creates a production clock with a fresh monotonic origin.
    fn default() -> Self {
        Self::new()
    }
}
impl DataClock for SystemDataClock {
    /// Reports elapsed process-local monotonic time.
    fn monotonic(&self) -> Duration {
        self.started.elapsed()
    }
    /// Reads the current nonnegative Unix epoch milliseconds.
    fn epoch_ms(&self) -> Result<i64, DataManagementError> {
        let value = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| DataManagementError::SnapshotFailed)?
            .as_millis();
        i64::try_from(value).map_err(|_| DataManagementError::SnapshotFailed)
    }
}

/// Publishes one best-effort aggregate invalidation.
pub trait DataEventSink: Send + Sync {
    /// Emits one already committed change without user content.
    fn publish(&self, event: DataChangedEventDto) -> Result<(), DataEventError>;
}

/// Classifies best-effort aggregate event delivery failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DataEventError;

/// Emits aggregate changes through the managed Tauri handle.
pub struct TauriDataEventSink<R: Runtime>(pub AppHandle<R>);
impl<R: Runtime> DataEventSink for TauriDataEventSink<R> {
    /// Emits one aggregate invalidation without forwarding runtime details.
    fn publish(&self, event: DataChangedEventDto) -> Result<(), DataEventError> {
        self.0
            .emit(DATA_CHANGED_EVENT, event)
            .map_err(|_| DataEventError)
    }
}

#[derive(Clone)]
struct PendingImport {
    package: BackupEnvelope<BackupDataV1>,
    preview: BackupImportPreviewDto,
    fingerprint: Vec<u8>,
    created: Duration,
}
#[derive(Clone)]
struct PendingReset {
    impact: ResetImpactDto,
    created: Duration,
}
enum Pending {
    Import(Box<PendingImport>),
    Reset(PendingReset),
}
struct OperationState {
    next_request_id: u32,
    active: bool,
    pending: Option<Pending>,
}

/// Coordinates strict backup, previewed import, and explicit reset.
#[derive(Clone)]
pub struct DataManagementService {
    inner: Arc<DataManagementInner>,
}
struct DataManagementInner {
    storage: Storage,
    gate: DataMaintenanceGate,
    participants: DataParticipants,
    runtime: Arc<dyn DataRuntimeControl>,
    platform: Arc<dyn DataPlatform>,
    clock: Arc<dyn DataClock>,
    events: Arc<dyn DataEventSink>,
    files: Option<FilesService>,
    state: Mutex<OperationState>,
}

impl DataManagementService {
    /// Creates the service from explicit production or test seams.
    pub fn with_seams(
        storage: Storage,
        gate: DataMaintenanceGate,
        participants: DataParticipants,
        runtime: Arc<dyn DataRuntimeControl>,
        platform: Arc<dyn DataPlatform>,
        clock: Arc<dyn DataClock>,
        events: Arc<dyn DataEventSink>,
    ) -> Self {
        Self {
            inner: Arc::new(DataManagementInner {
                storage,
                gate,
                participants,
                runtime,
                platform,
                clock,
                events,
                files: None,
                state: Mutex::new(OperationState {
                    next_request_id: 1,
                    active: false,
                    pending: None,
                }),
            }),
        }
    }

    /// Creates the production coordinator with the stage16 recent reset participant.
    #[allow(clippy::too_many_arguments)]
    pub fn with_files_seams(
        storage: Storage,
        gate: DataMaintenanceGate,
        participants: DataParticipants,
        runtime: Arc<dyn DataRuntimeControl>,
        platform: Arc<dyn DataPlatform>,
        clock: Arc<dyn DataClock>,
        events: Arc<dyn DataEventSink>,
        files: FilesService,
    ) -> Self {
        let mut service = Self::with_seams(
            storage,
            gate,
            participants,
            runtime,
            platform,
            clock,
            events,
        );
        Arc::get_mut(&mut service.inner)
            .expect("new coordinator is uniquely owned")
            .files = Some(files);
        service
    }

    /// Returns the configured location after ensuring it exists.
    pub async fn get_data_location(&self) -> Result<DataLocationDto, DataManagementError> {
        let path = self.inner.platform.data_location().await?;
        let directory = path
            .to_str()
            .ok_or(DataManagementError::DataLocationUnavailable)?
            .to_owned();
        Ok(DataLocationDto {
            directory,
            database_file_name: Storage::DATABASE_FILE_NAME.to_owned(),
            logs_directory_name: "logs".to_owned(),
        })
    }

    /// Opens only the backend-configured data directory.
    pub async fn open_data_location(&self) -> Result<(), DataManagementError> {
        self.inner.platform.open_data_location().await
    }
    /// Copies only the backend-configured data directory.
    pub async fn copy_data_location(&self) -> Result<(), DataManagementError> {
        self.inner.platform.copy_data_location().await
    }

    /// Exports one consistent Phase 1 snapshot to a picker-selected destination.
    pub async fn export_backup(&self) -> Result<BackupExportOutcomeDto, DataManagementError> {
        self.begin_operation()?;
        let result = self.export_backup_inner().await;
        self.finish_operation();
        result
    }

    /// Performs the export after operation admission.
    async fn export_backup_inner(&self) -> Result<BackupExportOutcomeDto, DataManagementError> {
        let now = self.inner.clock.epoch_ms()?;
        let suggested = backup_file_name(now)?;
        let Some(path) = self.inner.platform.pick_export(&suggested).await? else {
            return Ok(BackupExportOutcomeDto::Cancelled);
        };
        let permit = self.inner.gate.write_permit().await;
        let snapshot = self.snapshot(now).await?;
        drop(permit);
        let counts = content_counts(&snapshot.data)?;
        let bytes =
            serde_json::to_vec(&snapshot).map_err(|_| DataManagementError::SerializeFailed)?;
        if bytes.len() > MAX_BACKUP_BYTES {
            return Err(DataManagementError::BackupTooLarge);
        }
        self.inner.platform.write_backup(&path, &bytes).await?;
        Ok(BackupExportOutcomeDto::Exported {
            file_name: safe_file_name(&path)?,
            schema_version: SCHEMA_VERSION,
            counts,
        })
    }

    /// Parses and prepares one picker-selected import without writing data.
    pub async fn prepare_import_backup(
        &self,
    ) -> Result<PrepareBackupImportOutcomeDto, DataManagementError> {
        self.begin_operation()?;
        let result = self.prepare_import_inner().await;
        self.finish_operation();
        result
    }

    /// Performs import preparation after operation admission.
    async fn prepare_import_inner(
        &self,
    ) -> Result<PrepareBackupImportOutcomeDto, DataManagementError> {
        let Some(path) = self.inner.platform.pick_import().await? else {
            return Ok(PrepareBackupImportOutcomeDto::Cancelled);
        };
        let bytes = self.inner.platform.read_backup(&path).await?;
        let package = parse_backup(&bytes)?;
        let request_id = self.next_request_id()?;
        let permit = self.inner.gate.write_permit().await;
        let (_, merge, fingerprint) = self.prepare_plans(&package.data).await?;
        drop(permit);
        let preview = BackupImportPreviewDto {
            request_id,
            schema_version: package.schema_version,
            created_at_ms: package.created_at_ms,
            source_app_version: package.app_version.clone(),
            counts: content_counts(&package.data)?,
            merge,
        };
        self.set_pending(Pending::Import(Box::new(PendingImport {
            package,
            preview: preview.clone(),
            fingerprint,
            created: self.inner.clock.monotonic(),
        })))?;
        Ok(PrepareBackupImportOutcomeDto::Ready { preview })
    }

    /// Confirms a stable import in an operation-owned asynchronous task.
    pub async fn confirm_import_backup(
        &self,
        request_id: u32,
    ) -> Result<BackupImportResultDto, DataManagementError> {
        let service = self.clone();
        tauri::async_runtime::spawn(async move { service.confirm_import_inner(request_id).await })
            .await
            .map_err(|_| DataManagementError::PersistenceFailed)?
    }

    /// Revalidates and applies one pending import atomically.
    async fn confirm_import_inner(
        &self,
        request_id: u32,
    ) -> Result<BackupImportResultDto, DataManagementError> {
        self.begin_operation()?;
        let result = async {
            let pending = self.pending_import(request_id)?;
            let permit = self.inner.gate.write_permit().await;
            let (plans, merge, fingerprint) = self.prepare_plans(&pending.package.data).await?;
            if merge != pending.preview.merge || fingerprint != pending.fingerprint {
                let mut preview = pending.preview.clone();
                preview.merge = merge;
                self.replace_import_preview(request_id, preview.clone(), fingerprint)?;
                return Err(DataManagementError::ImportPreviewChanged { preview });
            }
            let projections = self.apply_import(plans).await?;
            self.publish_import(projections);
            self.clear_pending(request_id, true)?;
            drop(permit);
            let _ = self
                .inner
                .participants
                .cli_profiles
                .retry_credential_cleanup()
                .await;
            let cleanup = self
                .inner
                .participants
                .cli_profiles
                .pending_credential_cleanup_count()
                .await
                .unwrap_or(0);
            let _ = self.inner.events.publish(DataChangedEventDto {
                kind: DataChangeKindDto::BackupImported,
            });
            Ok(BackupImportResultDto {
                schema_version: SCHEMA_VERSION,
                applied: pending.preview.merge,
                credential_cleanup_pending: cleanup,
            })
        }
        .await;
        self.finish_operation();
        result
    }

    /// Prepares a reset request from one durable/runtime snapshot.
    pub async fn prepare_reset_xwork(&self) -> Result<ResetImpactDto, DataManagementError> {
        self.begin_operation()?;
        let result = async {
            let request_id = self.next_request_id()?;
            let runtime = self
                .inner
                .runtime
                .impact()
                .await
                .map_err(|_| DataManagementError::RuntimeUnavailable)?;
            let permit = self.inner.gate.write_permit().await;
            let durable = self.reset_impact(runtime, request_id).await?;
            drop(permit);
            self.set_pending(Pending::Reset(PendingReset {
                impact: durable.clone(),
                created: self.inner.clock.monotonic(),
            }))?;
            Ok(durable)
        }
        .await;
        self.finish_operation();
        result
    }

    /// Confirms an explicit reset in an operation-owned asynchronous task.
    pub async fn confirm_reset_xwork(
        &self,
        request_id: u32,
        confirmation: &str,
    ) -> Result<ResetResultDto, DataManagementError> {
        self.pending_reset(request_id)?;
        if confirmation.trim() != "RESET" {
            return Err(DataManagementError::InvalidResetConfirmation);
        }
        let confirmation = confirmation.to_owned();
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service.confirm_reset_inner(request_id, &confirmation).await
        })
        .await
        .map_err(|_| DataManagementError::PersistenceFailed)?
    }

    /// Stops runtime, resets all Phase 1 owners in one transaction, and resumes admission.
    async fn confirm_reset_inner(
        &self,
        request_id: u32,
        _confirmation: &str,
    ) -> Result<ResetResultDto, DataManagementError> {
        self.begin_operation()?;
        let result = async {
            self.pending_reset(request_id)?;
            let runtime = self
                .inner
                .runtime
                .impact()
                .await
                .map_err(|_| DataManagementError::RuntimeUnavailable)?;
            let permit = self.inner.gate.write_permit().await;
            // Notification permit waits are cancellation-safe while maintenance owns admission.
            self.inner
                .runtime
                .shutdown_for_reset()
                .await
                .map_err(|_| DataManagementError::RuntimeCleanupFailed)?;
            let current = match self.reset_impact(runtime, request_id).await {
                Ok(current) => current,
                Err(error) => {
                    self.inner
                        .runtime
                        .resume_after_reset(DataResetCompletion::Aborted);
                    return Err(error);
                }
            };
            let applied = self.apply_reset().await;
            match applied {
                Ok(projections) => {
                    self.publish_reset(projections).await;
                    self.clear_pending(request_id, false)?;
                    self.inner
                        .runtime
                        .resume_after_reset(DataResetCompletion::Committed);
                    drop(permit);
                    let _ = self
                        .inner
                        .participants
                        .cli_profiles
                        .retry_credential_cleanup()
                        .await;
                    let cleanup = self
                        .inner
                        .participants
                        .cli_profiles
                        .pending_credential_cleanup_count()
                        .await
                        .unwrap_or(0);
                    let _ = self.inner.events.publish(DataChangedEventDto {
                        kind: DataChangeKindDto::AppReset,
                    });
                    Ok(ResetResultDto {
                        projects_removed: current.projects,
                        custom_cli_profiles_removed: current.custom_cli_profiles,
                        keyboard_shortcut_overrides_removed: current.keyboard_shortcut_overrides,
                        settings_reset: current.settings_differ_from_default,
                        notes_removed: 0,
                        events_removed: 0,
                        sessions_stopped: current.sessions,
                        credential_cleanup_pending: cleanup,
                    })
                }
                Err(error) => {
                    self.inner
                        .runtime
                        .resume_after_reset(DataResetCompletion::Aborted);
                    Err(error)
                }
            }
        }
        .await;
        self.finish_operation();
        result
    }

    /// Cancels one matching pending request while no apply operation is active.
    pub fn cancel_data_operation(&self, request_id: u32) -> Result<(), DataManagementError> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?;
        if state.active {
            return Err(DataManagementError::OperationInProgress);
        }
        let Some(pending) = state.pending.as_ref() else {
            return Err(DataManagementError::NoPendingOperation);
        };
        let id = match pending {
            Pending::Import(value) => value.preview.request_id,
            Pending::Reset(value) => value.impact.request_id,
        };
        if id != request_id {
            return Err(DataManagementError::StaleRequest);
        }
        state.pending = None;
        Ok(())
    }

    /// Reads every export participant in one coordinator transaction.
    async fn snapshot(
        &self,
        created_at_ms: i64,
    ) -> Result<BackupEnvelope<BackupDataV1>, DataManagementError> {
        let storage = self.inner.storage.clone();
        let participants = self.inner.participants.clone();
        tauri::async_runtime::spawn_blocking(move || {
            storage.with_transaction(|tx| {
                let settings = participants
                    .settings
                    .export(tx)
                    .map_err(|_| DataManagementError::SnapshotFailed)?;
                Ok(BackupEnvelope {
                    format: BACKUP_FORMAT.to_owned(),
                    schema_version: SCHEMA_VERSION,
                    created_at_ms,
                    app_version: env!("CARGO_PKG_VERSION").to_owned(),
                    data: BackupDataV1 {
                        projects: participants
                            .projects
                            .export(tx)
                            .map_err(|_| DataManagementError::SnapshotFailed)?,
                        cli_profiles: participants
                            .cli_profiles
                            .export(tx)
                            .map_err(|_| DataManagementError::SnapshotFailed)?,
                        appearance: settings.appearance,
                        sidebar: settings.sidebar,
                        keyboard_shortcut_overrides: participants
                            .keyboard_shortcuts
                            .export(tx)
                            .map_err(|_| DataManagementError::SnapshotFailed)?,
                    },
                })
            })
        })
        .await
        .map_err(|_| DataManagementError::SnapshotFailed)?
    }

    /// Builds owner plans and deterministic aggregate counts without writes.
    async fn prepare_plans(
        &self,
        data: &BackupDataV1,
    ) -> Result<(PreparedImportPlans, BackupMergeCountsDto, Vec<u8>), DataManagementError> {
        let storage = self.inner.storage.clone();
        let participants = self.inner.participants.clone();
        let data = data.clone();
        tauri::async_runtime::spawn_blocking(move || {
            storage.with_transaction(|tx| {
                let current_projects = participants
                    .projects
                    .export(tx)
                    .map_err(|_| domain(BackupDomainDto::Projects))?;
                let current_settings = participants
                    .settings
                    .export(tx)
                    .map_err(|_| domain(BackupDomainDto::Settings))?;
                let current_profiles = participants
                    .cli_profiles
                    .export(tx)
                    .map_err(|_| domain(BackupDomainDto::CliProfiles))?;
                let current_shortcuts = participants
                    .keyboard_shortcuts
                    .export(tx)
                    .map_err(|_| domain(BackupDomainDto::KeyboardShortcuts))?;
                let fingerprint = serde_json::to_vec(&BackupDataV1 {
                    projects: current_projects,
                    cli_profiles: current_profiles,
                    appearance: current_settings.appearance,
                    sidebar: current_settings.sidebar,
                    keyboard_shortcut_overrides: current_shortcuts.clone(),
                })
                .map_err(|_| DataManagementError::SnapshotFailed)?;
                let projects = participants
                    .projects
                    .prepare_import(tx, &data.projects)
                    .map_err(|_| domain(BackupDomainDto::Projects))?;
                let settings = participants
                    .settings
                    .prepare_restore(
                        tx,
                        &SettingsBackupSection {
                            appearance: data.appearance.clone(),
                            sidebar: data.sidebar.clone(),
                            notification_settings: None,
                        },
                    )
                    .map_err(|_| domain(BackupDomainDto::Settings))?;
                let cli_profiles = participants
                    .cli_profiles
                    .prepare_import(tx, &data.cli_profiles)
                    .map_err(|_| domain(BackupDomainDto::CliProfiles))?;
                let keyboard_shortcuts = participants
                    .keyboard_shortcuts
                    .prepare_replace(tx, &data.keyboard_shortcut_overrides)
                    .map_err(|_| domain(BackupDomainDto::KeyboardShortcuts))?;
                let shortcut_counts =
                    compare_shortcuts(&current_shortcuts, &data.keyboard_shortcut_overrides)?;
                let merge = BackupMergeCountsDto {
                    inserts: projects
                        .counts
                        .inserts
                        .checked_add(cli_profiles.counts.inserts)
                        .and_then(|n| n.checked_add(shortcut_counts.0))
                        .ok_or(DataManagementError::InvalidBackup)?,
                    updates: projects
                        .counts
                        .updates
                        .checked_add(cli_profiles.counts.updates)
                        .and_then(|n| n.checked_add(shortcut_counts.1))
                        .ok_or(DataManagementError::InvalidBackup)?,
                    unchanged: projects
                        .counts
                        .unchanged
                        .checked_add(cli_profiles.counts.unchanged)
                        .and_then(|n| n.checked_add(shortcut_counts.2))
                        .ok_or(DataManagementError::InvalidBackup)?,
                    removals: shortcut_counts.3,
                    project_path_matches: projects.counts.path_matches,
                };
                Ok((
                    PreparedImportPlans {
                        projects,
                        settings,
                        cli_profiles,
                        keyboard_shortcuts,
                    },
                    merge,
                    fingerprint,
                ))
            })
        })
        .await
        .map_err(|_| DataManagementError::PersistenceFailed)?
    }

    /// Applies all core owner plans in dependency order inside one transaction.
    async fn apply_import(
        &self,
        plans: PreparedImportPlans,
    ) -> Result<ImportCommittedProjections, DataManagementError> {
        let storage = self.inner.storage.clone();
        let participants = self.inner.participants.clone();
        tauri::async_runtime::spawn_blocking(move || {
            storage.with_transaction(|tx| {
                Ok(ImportCommittedProjections {
                    projects: participants
                        .projects
                        .apply_import(tx, &plans.projects)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                    settings: participants
                        .settings
                        .apply_restore(tx, &plans.settings)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                    cli_profiles: participants
                        .cli_profiles
                        .apply_import(tx, &plans.cli_profiles)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                    keyboard_shortcuts: participants
                        .keyboard_shortcuts
                        .apply_replace(tx, &plans.keyboard_shortcuts)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                })
            })
        })
        .await
        .map_err(|_| DataManagementError::PersistenceFailed)?
    }

    /// Publishes committed import projections in dependency order.
    fn publish_import(&self, projections: ImportCommittedProjections) {
        self.inner
            .participants
            .projects
            .publish_after_commit(projections.projects);
        self.inner
            .participants
            .settings
            .publish_after_commit(projections.settings);
        self.inner
            .participants
            .cli_profiles
            .publish_after_commit(projections.cli_profiles);
        self.inner
            .participants
            .keyboard_shortcuts
            .publish_after_commit(projections.keyboard_shortcuts);
    }

    /// Reads reset counts under the coordinator write permit.
    async fn reset_impact(
        &self,
        runtime: crate::app::data_runtime::DataRuntimeImpact,
        request_id: u32,
    ) -> Result<ResetImpactDto, DataManagementError> {
        let snapshot = self.snapshot(self.inner.clock.epoch_ms()?).await?;
        Ok(ResetImpactDto {
            request_id,
            projects: count(snapshot.data.projects.len())?,
            custom_cli_profiles: count(snapshot.data.cli_profiles.custom_profiles.len())?,
            keyboard_shortcut_overrides: count(snapshot.data.keyboard_shortcut_overrides.len())?,
            settings_differ_from_default: SettingsBackupSection {
                appearance: snapshot.data.appearance,
                sidebar: snapshot.data.sidebar,
                notification_settings: None,
            } != SettingsBackupSection::defaults()
                || snapshot.data.cli_profiles.default_shell_id != "system",
            notes: 0,
            events: 0,
            sessions: runtime.sessions,
            running_processes: runtime.running_processes,
            unsaved_documents: runtime.unsaved_documents,
        })
    }

    /// Applies reset-only and core owners child-first in one transaction.
    async fn apply_reset(&self) -> Result<ResetCommittedProjections, DataManagementError> {
        let storage = self.inner.storage.clone();
        let participants = self.inner.participants.clone();
        let files = self.inner.files.clone();
        tauri::async_runtime::spawn_blocking(move || {
            storage.with_transaction(|tx| {
                let notifications = participants
                    .notifications
                    .reset_notifications_in(tx)
                    .map_err(|_| DataManagementError::PersistenceFailed)?;
                let recent_plan = files
                    .as_ref()
                    .map(|files| files.prepare_recent_files_reset_in(tx))
                    .transpose()
                    .map_err(|_| DataManagementError::PersistenceFailed)?;
                let recent_files = match (&files, recent_plan.as_ref()) {
                    (Some(files), Some(plan)) => Some(
                        files
                            .reset_recent_files_in(tx, plan)
                            .map_err(|_| DataManagementError::PersistenceFailed)?,
                    ),
                    _ => None,
                };
                Ok(ResetCommittedProjections {
                    notifications,
                    keyboard_shortcuts: participants
                        .keyboard_shortcuts
                        .apply_reset(tx)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                    cli_profiles: participants
                        .cli_profiles
                        .apply_reset(tx)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                    settings: participants
                        .settings
                        .apply_reset(tx)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                    projects: participants
                        .projects
                        .apply_reset(tx)
                        .map_err(|_| DataManagementError::PersistenceFailed)?,
                    recent_files,
                })
            })
        })
        .await
        .map_err(|_| DataManagementError::PersistenceFailed)?
    }

    /// Publishes reset projections only after the shared transaction commits.
    async fn publish_reset(&self, projections: ResetCommittedProjections) {
        self.inner
            .participants
            .projects
            .publish_after_commit(projections.projects);
        self.inner
            .participants
            .settings
            .publish_after_commit(projections.settings);
        self.inner
            .participants
            .cli_profiles
            .publish_after_commit(projections.cli_profiles);
        self.inner
            .participants
            .keyboard_shortcuts
            .publish_after_commit(projections.keyboard_shortcuts);
        if let (Some(files), Some(projection)) = (&self.inner.files, projections.recent_files) {
            files.publish_recent_files_reset(projection);
        }
        self.inner
            .participants
            .notifications
            .publish_notification_reset(projections.notifications)
            .await;
    }

    /// Reserves the single active file/apply operation.
    fn begin_operation(&self) -> Result<(), DataManagementError> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?;
        if state.active {
            return Err(DataManagementError::OperationInProgress);
        }
        state.active = true;
        Ok(())
    }
    /// Releases operation admission after every result path.
    fn finish_operation(&self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.active = false;
        }
    }
    /// Allocates a nonzero wrapping request identifier.
    fn next_request_id(&self) -> Result<u32, DataManagementError> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?;
        let id = state.next_request_id.max(1);
        state.next_request_id = id.wrapping_add(1).max(1);
        Ok(id)
    }
    /// Installs one pending request, replacing an older preview.
    fn set_pending(&self, pending: Pending) -> Result<(), DataManagementError> {
        self.inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?
            .pending = Some(pending);
        Ok(())
    }
    /// Returns one valid, unexpired pending import.
    fn pending_import(&self, request_id: u32) -> Result<PendingImport, DataManagementError> {
        let state = self
            .inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?;
        match state.pending.as_ref() {
            None => Err(DataManagementError::NoPendingOperation),
            Some(Pending::Import(value))
                if value.preview.request_id == request_id
                    && self.inner.clock.monotonic().saturating_sub(value.created) < REQUEST_TTL =>
            {
                Ok((**value).clone())
            }
            Some(_) => Err(DataManagementError::StaleRequest),
        }
    }
    /// Returns one valid, unexpired pending reset.
    fn pending_reset(&self, request_id: u32) -> Result<PendingReset, DataManagementError> {
        let state = self
            .inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?;
        match state.pending.as_ref() {
            None => Err(DataManagementError::NoPendingOperation),
            Some(Pending::Reset(value))
                if value.impact.request_id == request_id
                    && self.inner.clock.monotonic().saturating_sub(value.created) < REQUEST_TTL =>
            {
                Ok(value.clone())
            }
            Some(_) => Err(DataManagementError::StaleRequest),
        }
    }
    /// Refreshes the pending preview after same-count or identity state changed.
    fn replace_import_preview(
        &self,
        request_id: u32,
        preview: BackupImportPreviewDto,
        fingerprint: Vec<u8>,
    ) -> Result<(), DataManagementError> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?;
        match state.pending.as_mut() {
            Some(Pending::Import(value)) if value.preview.request_id == request_id => {
                value.preview = preview;
                value.fingerprint = fingerprint;
                value.created = self.inner.clock.monotonic();
                Ok(())
            }
            _ => Err(DataManagementError::StaleRequest),
        }
    }
    /// Clears exactly the confirmed pending request.
    fn clear_pending(&self, request_id: u32, import: bool) -> Result<(), DataManagementError> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| DataManagementError::PersistenceFailed)?;
        let matches = matches!(state.pending.as_ref(), Some(Pending::Import(value)) if import && value.preview.request_id == request_id)
            || matches!(state.pending.as_ref(), Some(Pending::Reset(value)) if !import && value.impact.request_id == request_id);
        if !matches {
            return Err(DataManagementError::StaleRequest);
        }
        state.pending = None;
        Ok(())
    }
}

/// Strictly parses and validates one Phase 1 package.
pub fn parse_backup(bytes: &[u8]) -> Result<BackupEnvelope<BackupDataV1>, DataManagementError> {
    if bytes.is_empty() || bytes.len() > MAX_BACKUP_BYTES || bytes.starts_with(&[0xEF, 0xBB, 0xBF])
    {
        return Err(if bytes.len() > MAX_BACKUP_BYTES {
            DataManagementError::BackupTooLarge
        } else {
            DataManagementError::InvalidBackup
        });
    }
    validate_backup_shape(bytes)?;
    let package: BackupEnvelope<BackupDataV1> =
        serde_json::from_slice(bytes).map_err(|_| DataManagementError::InvalidBackup)?;
    if package.format != BACKUP_FORMAT
        || package.created_at_ms < 0
        || package.app_version.is_empty()
        || package.app_version.chars().count() > 64
        || package.app_version.chars().any(char::is_control)
    {
        return Err(DataManagementError::InvalidBackup);
    }
    if package.schema_version != SCHEMA_VERSION {
        return Err(DataManagementError::UnsupportedBackupVersion {
            found: package.schema_version,
            supported: SCHEMA_VERSION,
        });
    }
    content_counts(&package.data)?;
    Ok(package)
}

/// Rejects unknown fields throughout the strict Phase 1 envelope.
fn validate_backup_shape(bytes: &[u8]) -> Result<(), DataManagementError> {
    let root: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| DataManagementError::InvalidBackup)?;
    object_fields(
        &root,
        &[
            "format",
            "schemaVersion",
            "createdAtMs",
            "appVersion",
            "data",
        ],
    )?;
    let data = field(&root, "data")?;
    object_fields(
        data,
        &[
            "projects",
            "cliProfiles",
            "appearance",
            "sidebar",
            "keyboardShortcutOverrides",
        ],
    )?;
    for project in array(field(data, "projects")?)? {
        object_fields(
            project,
            &[
                "id",
                "displayName",
                "rootPath",
                "isPinned",
                "addedAtMs",
                "lastOpenedAtMs",
            ],
        )?;
    }
    let profiles = field(data, "cliProfiles")?;
    object_fields(profiles, &["defaultShellId", "customProfiles"])?;
    for profile in array(field(profiles, "customProfiles")?)? {
        object_fields(
            profile,
            &[
                "id",
                "name",
                "command",
                "arguments",
                "shellId",
                "icon",
                "color",
                "environment",
                "createdAtMs",
                "updatedAtMs",
            ],
        )?;
        for environment in array(field(profile, "environment")?)? {
            let kind = field(environment, "kind")?
                .as_str()
                .ok_or(DataManagementError::InvalidBackup)?;
            match kind {
                "plain" => object_fields(environment, &["kind", "name", "value"]),
                "secret_reference" => {
                    object_fields(environment, &["kind", "name", "credentialAccount"])
                }
                _ => Err(DataManagementError::InvalidBackup),
            }?;
        }
    }
    let appearance = field(data, "appearance")?;
    object_fields(
        appearance,
        &[
            "themeMode",
            "themePreset",
            "interfaceColors",
            "terminalPalette",
            "interfaceFontSizePx",
            "terminalFontSizePx",
        ],
    )?;
    let interface = field(appearance, "interfaceColors")?;
    object_fields(interface, &["light", "dark"])?;
    for mode in [field(interface, "light")?, field(interface, "dark")?] {
        object_fields(mode, &["accent", "canvas", "sidebar", "text"])?;
    }
    object_fields(
        field(appearance, "terminalPalette")?,
        &["background", "foreground", "ansiColors"],
    )?;
    object_fields(field(data, "sidebar")?, &["widthPx", "collapsed"])?;
    for shortcut in array(field(data, "keyboardShortcutOverrides")?)? {
        object_fields(shortcut, &["actionId", "chord"])?;
        object_fields(
            field(shortcut, "chord")?,
            &["primary", "alt", "shift", "keyCode"],
        )?;
    }
    Ok(())
}

/// Requires one JSON object to contain exactly the allowed field names.
fn object_fields(value: &serde_json::Value, allowed: &[&str]) -> Result<(), DataManagementError> {
    let object = value
        .as_object()
        .ok_or(DataManagementError::InvalidBackup)?;
    if object.len() != allowed.len() || object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(DataManagementError::InvalidBackup);
    }
    Ok(())
}

/// Reads one required object field without accepting a missing value.
fn field<'a>(
    value: &'a serde_json::Value,
    name: &str,
) -> Result<&'a serde_json::Value, DataManagementError> {
    value
        .as_object()
        .and_then(|object| object.get(name))
        .ok_or(DataManagementError::InvalidBackup)
}

/// Reads one required JSON array.
fn array(value: &serde_json::Value) -> Result<&Vec<serde_json::Value>, DataManagementError> {
    value.as_array().ok_or(DataManagementError::InvalidBackup)
}

/// Counts every record and secret reference with overflow and allocation limits.
fn content_counts(data: &BackupDataV1) -> Result<BackupContentCountsDto, DataManagementError> {
    let total = data
        .projects
        .len()
        .checked_add(data.cli_profiles.custom_profiles.len())
        .and_then(|n| n.checked_add(data.keyboard_shortcut_overrides.len()))
        .ok_or(DataManagementError::InvalidBackup)?;
    if total > MAX_RECORDS {
        return Err(DataManagementError::InvalidBackup);
    }
    let secret_references = data
        .cli_profiles
        .custom_profiles
        .iter()
        .flat_map(|profile| &profile.environment)
        .filter(|entry| {
            matches!(
                entry,
                crate::terminal::CliEnvironmentBackupRecordV1::SecretReference { .. }
            )
        })
        .count();
    Ok(BackupContentCountsDto {
        projects: count(data.projects.len())?,
        custom_cli_profiles: count(data.cli_profiles.custom_profiles.len())?,
        secret_references: count(secret_references)?,
        keyboard_shortcut_overrides: count(data.keyboard_shortcut_overrides.len())?,
        notes: None,
        events: None,
    })
}

/// Compares complete shortcut sections by action identity.
fn compare_shortcuts(
    current: &[ShortcutOverride],
    incoming: &[ShortcutOverride],
) -> Result<(u32, u32, u32, u32), DataManagementError> {
    let mut seen = HashSet::new();
    if incoming.iter().any(|item| !seen.insert(&item.action_id)) {
        return Err(domain(BackupDomainDto::KeyboardShortcuts));
    }
    let mut inserts = 0u32;
    let mut updates = 0u32;
    let mut unchanged = 0u32;
    for item in incoming {
        match current
            .iter()
            .find(|value| value.action_id == item.action_id)
        {
            None => {
                inserts = inserts
                    .checked_add(1)
                    .ok_or(DataManagementError::InvalidBackup)?
            }
            Some(value) if value == item => {
                unchanged = unchanged
                    .checked_add(1)
                    .ok_or(DataManagementError::InvalidBackup)?
            }
            Some(_) => {
                updates = updates
                    .checked_add(1)
                    .ok_or(DataManagementError::InvalidBackup)?
            }
        }
    }
    let incoming_ids = incoming
        .iter()
        .map(|item| item.action_id.as_str())
        .collect::<HashSet<_>>();
    let removals = count(
        current
            .iter()
            .filter(|item| !incoming_ids.contains(item.action_id.as_str()))
            .count(),
    )?;
    Ok((inserts, updates, unchanged, removals))
}

/// Converts a collection length into the public bounded count.
fn count(value: usize) -> Result<u32, DataManagementError> {
    u32::try_from(value).map_err(|_| DataManagementError::InvalidBackup)
}
/// Creates one owner validation error.
fn domain(domain: BackupDomainDto) -> DataManagementError {
    DataManagementError::DomainValidationFailed { domain }
}
/// Returns only the selected base name and rejects invalid UTF-8.
fn safe_file_name(path: &Path) -> Result<String, DataManagementError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .ok_or(DataManagementError::FileWriteFailed)
}

/// Formats a UTC package timestamp without adding a date-time dependency.
fn backup_file_name(epoch_ms: i64) -> Result<String, DataManagementError> {
    if epoch_ms < 0 {
        return Err(DataManagementError::SnapshotFailed);
    }
    let seconds = epoch_ms / 1_000;
    let days = seconds / 86_400;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_date_from_unix_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = seconds_of_day % 3_600 / 60;
    let second = seconds_of_day % 60;
    Ok(format!(
        "xwork-{year:04}-{month:02}-{day:02}-{hour:02}{minute:02}{second:02}.xwork-backup.json"
    ))
}

/// Converts nonnegative Unix days to a proleptic Gregorian civil date.
fn civil_date_from_unix_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

/// Clones the managed service without retaining Tauri state borrows.
fn managed<R: Runtime>(app: &AppHandle<R>) -> Result<DataManagementService, DataManagementError> {
    app.try_state::<DataManagementService>()
        .map(|state| state.inner().clone())
        .ok_or(DataManagementError::PersistenceFailed)
}
/// Authorizes only the exact primary window before native or durable side effects.
fn authorize(label: &str) -> Result<(), DataManagementError> {
    if label == "main" {
        Ok(())
    } else {
        Err(DataManagementError::UnauthorizedWindow)
    }
}

/// Returns the backend-owned application data location to the main window.
#[tauri::command]
pub async fn get_data_location<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<DataLocationDto, DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?.get_data_location().await
}
/// Opens the backend-owned application data location for the main window.
#[tauri::command]
pub async fn open_data_location<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<(), DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?.open_data_location().await
}
/// Copies the backend-owned application data location for the main window.
#[tauri::command]
pub async fn copy_data_location<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<(), DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?.copy_data_location().await
}
/// Exports one backup through the native picker for the main window.
#[tauri::command]
pub async fn export_backup<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<BackupExportOutcomeDto, DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?.export_backup().await
}
/// Prepares one native-picker backup import for the main window.
#[tauri::command]
pub async fn prepare_import_backup<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<PrepareBackupImportOutcomeDto, DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?.prepare_import_backup().await
}
/// Confirms one stable pending import for the main window.
#[tauri::command]
pub async fn confirm_import_backup<R: Runtime>(
    request_id: u32,
    window: WebviewWindow<R>,
) -> Result<BackupImportResultDto, DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?
        .confirm_import_backup(request_id)
        .await
}
/// Prepares an explicit reset preview for the main window.
#[tauri::command]
pub async fn prepare_reset_xwork<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<ResetImpactDto, DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?.prepare_reset_xwork().await
}
/// Confirms a pending reset with the exact destructive literal.
#[tauri::command]
pub async fn confirm_reset_xwork<R: Runtime>(
    request_id: u32,
    confirmation: String,
    window: WebviewWindow<R>,
) -> Result<ResetResultDto, DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?
        .confirm_reset_xwork(request_id, &confirmation)
        .await
}
/// Cancels one matching pending import or reset request.
#[tauri::command]
pub async fn cancel_data_operation<R: Runtime>(
    request_id: u32,
    window: WebviewWindow<R>,
) -> Result<(), DataManagementError> {
    authorize(window.label())?;
    managed(window.app_handle())?.cancel_data_operation(request_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds one valid empty v1 package for parser assertions.
    fn fixture() -> Vec<u8> {
        serde_json::to_vec(&BackupEnvelope {
            format: BACKUP_FORMAT.to_owned(),
            schema_version: 1,
            created_at_ms: 0,
            app_version: "1.0.0".to_owned(),
            data: BackupDataV1 {
                projects: Vec::new(),
                cli_profiles: CliProfilesBackupV1 {
                    default_shell_id: "system".to_owned(),
                    custom_profiles: Vec::new(),
                },
                appearance: SettingsBackupSection::defaults().appearance,
                sidebar: SettingsBackupSection::defaults().sidebar,
                keyboard_shortcut_overrides: Vec::new(),
            },
        })
        .expect("fixture should serialize")
    }

    /// Rejects BOM, trailing content, duplicate envelope fields, and unsupported versions.
    #[test]
    fn parser_is_strict_at_the_envelope_boundary() {
        assert!(parse_backup(&fixture()).is_ok());
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend(fixture());
        assert_eq!(parse_backup(&bom), Err(DataManagementError::InvalidBackup));
        let trailing = [fixture(), b" true".to_vec()].concat();
        assert_eq!(
            parse_backup(&trailing),
            Err(DataManagementError::InvalidBackup)
        );
        let duplicate = String::from_utf8(fixture())
            .expect("fixture is UTF-8")
            .replacen("\"format\":", "\"format\":\"xwork-backup\",\"format\":", 1);
        assert_eq!(
            parse_backup(duplicate.as_bytes()),
            Err(DataManagementError::InvalidBackup)
        );
        let newer = String::from_utf8(fixture())
            .expect("fixture is UTF-8")
            .replace("\"schemaVersion\":1", "\"schemaVersion\":2");
        assert_eq!(
            parse_backup(newer.as_bytes()),
            Err(DataManagementError::UnsupportedBackupVersion {
                found: 2,
                supported: 1
            })
        );
        let zero = String::from_utf8(fixture())
            .expect("fixture is UTF-8")
            .replace("\"schemaVersion\":1", "\"schemaVersion\":0");
        assert_eq!(
            parse_backup(zero.as_bytes()),
            Err(DataManagementError::UnsupportedBackupVersion {
                found: 0,
                supported: 1
            })
        );
        let unknown = String::from_utf8(fixture())
            .expect("fixture is UTF-8")
            .replacen('{', "{\"unknown\":true,", 1);
        assert_eq!(
            parse_backup(unknown.as_bytes()),
            Err(DataManagementError::InvalidBackup)
        );
        let nested_duplicate = String::from_utf8(fixture())
            .expect("fixture is UTF-8")
            .replacen(
                "\"themeMode\":",
                "\"themeMode\":\"system\",\"themeMode\":",
                1,
            );
        assert_eq!(
            parse_backup(nested_duplicate.as_bytes()),
            Err(DataManagementError::InvalidBackup)
        );
        let nested_unknown = String::from_utf8(fixture())
            .expect("fixture is UTF-8")
            .replacen("\"widthPx\":", "\"futureField\":true,\"widthPx\":", 1);
        assert_eq!(
            parse_backup(nested_unknown.as_bytes()),
            Err(DataManagementError::InvalidBackup)
        );
    }

    /// Formats the documented UTC export name without locale dependencies.
    #[test]
    fn export_name_uses_utc_calendar_fields() {
        assert_eq!(
            backup_file_name(1_700_000_000_000),
            Ok("xwork-2023-11-14-221320.xwork-backup.json".to_owned())
        );
        assert_eq!(
            backup_file_name(-1),
            Err(DataManagementError::SnapshotFailed)
        );
    }
}
