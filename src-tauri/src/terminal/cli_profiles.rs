use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fmt::{Display, Formatter},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State, WebviewWindow};
use tokio::sync::{Mutex as AsyncMutex, OnceCell, Semaphore, watch};
use ts_rs::TS;
use zeroize::Zeroizing;

use crate::platform::{
    command::{CommandResolutionError, CommandResolver, validate_command_candidate},
    credential::{CredentialError, CredentialStore},
    shell::{ResolvedShell, SYSTEM_SHELL_ID, ShellResolutionError, ShellResolver},
};
use crate::shared::DataMaintenanceGate;
use crate::storage::{Storage, StorageError};

/// Names the invalidation event published after a committed CLI profile change.
pub const CLI_PROFILES_CHANGED_EVENT: &str = "cli-profiles://changed";

/// Limits every documented CLI profile input and collection size.
const MAX_CUSTOM_PROFILES: usize = 100;
const MAX_NAME_SCALARS: usize = 80;
const MAX_ICON_SCALARS: usize = 16;
const MAX_COMMAND_BYTES: usize = 1024;
const MAX_ARGUMENTS: usize = 128;
const MAX_ARGUMENT_BYTES: usize = 4096;
const MAX_ARGUMENTS_TOTAL_BYTES: usize = 32 * 1024;
const MAX_ENVIRONMENT_ENTRIES: usize = 64;
const MAX_ENVIRONMENT_NAME_LENGTH: usize = 128;
const MAX_ENVIRONMENT_VALUE_BYTES: usize = 32 * 1024;
const MAX_SHELL_ID_LENGTH: usize = 64;
const MAX_AVAILABILITY_CHECKS: usize = 4;

/// Prefixes and sizes the opaque identifier of every custom profile.
const PROFILE_ID_PREFIX: &str = "profile-";
const PROFILE_ID_LENGTH: usize = 44;

/// Identifies the three immutable built-in profiles.
pub const BUILT_IN_CODEX_ID: &str = "builtin:codex";
pub const BUILT_IN_CLAUDE_ID: &str = "builtin:claude";
pub const BUILT_IN_TERMINAL_ID: &str = "builtin:terminal";

/// Describes one immutable built-in profile synthesized in memory.
struct BuiltInProfile {
    id: &'static str,
    name: &'static str,
    command: Option<&'static str>,
    icon: &'static str,
    color: &'static str,
}

/// Lists the three built-in profiles in their exact contract order.
const BUILT_IN_PROFILES: [BuiltInProfile; 3] = [
    BuiltInProfile {
        id: BUILT_IN_CODEX_ID,
        name: "Codex",
        command: Some("codex"),
        icon: "Cx",
        color: "#10a37f",
    },
    BuiltInProfile {
        id: BUILT_IN_CLAUDE_ID,
        name: "Claude",
        command: Some("claude"),
        icon: "Cl",
        color: "#d97757",
    },
    BuiltInProfile {
        id: BUILT_IN_TERMINAL_ID,
        name: "Terminal",
        command: None,
        icon: ">_",
        color: "#64748b",
    },
];

/// Distinguishes the immutable built-in profiles from user-owned profiles.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub enum CliProfileKindDto {
    BuiltIn,
    Custom,
}

/// Reports the last known launch availability of one profile.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub enum CliProfileAvailabilityStatusDto {
    Unchecked,
    Available,
    CommandNotFound,
    ShellNotFound,
}

/// Reports one availability status together with its completion time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliProfileAvailabilityDto {
    pub status: CliProfileAvailabilityStatusDto,
    pub checked_at_unix_ms: Option<String>,
}

/// Returns one environment entry without ever carrying a secret value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliProfileEnvironmentDto {
    pub name: String,
    pub value: Option<String>,
    pub is_secret: bool,
    pub has_stored_value: bool,
}

/// Accepts one environment entry that may carry a plaintext secret value.
///
/// The type intentionally derives neither `Debug`, `Clone`, nor `Serialize`
/// so a supplied secret cannot reach a log, a clone, or an outgoing payload.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliProfileEnvironmentInputDto {
    pub name: String,
    #[ts(optional)]
    pub value: Option<String>,
    pub is_secret: bool,
}

/// Accepts one complete custom profile configuration from the frontend.
///
/// The type intentionally derives neither `Debug`, `Clone`, nor `Serialize`
/// because its environment entries may carry plaintext secret values.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliProfileInputDto {
    pub name: String,
    pub command: String,
    pub arguments: Vec<String>,
    #[ts(optional)]
    pub shell_id: Option<String>,
    pub icon: String,
    pub color: String,
    pub environment: Vec<CliProfileEnvironmentInputDto>,
}

/// Returns one catalog shell with its current availability and default flag.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliShellDto {
    pub id: String,
    pub display_name: String,
    pub command: String,
    pub is_available: bool,
    pub is_default: bool,
}

/// Returns one built-in or custom profile with its resolved presentation data.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliProfileDto {
    pub id: String,
    pub name: String,
    pub kind: CliProfileKindDto,
    pub command: Option<String>,
    pub arguments: Vec<String>,
    pub shell_id: Option<String>,
    pub effective_shell_id: String,
    pub icon: String,
    pub color: String,
    pub environment: Vec<CliProfileEnvironmentDto>,
    pub availability: CliProfileAvailabilityDto,
}

/// Returns the complete profile and shell catalog snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliProfilesSnapshotDto {
    pub revision: String,
    pub default_shell_id: String,
    pub effective_default_shell_id: String,
    pub shells: Vec<CliShellDto>,
    pub profiles: Vec<CliProfileDto>,
}

/// Names the observable change that invalidated the previous snapshot.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub enum CliProfilesChangeKindDto {
    Created,
    Updated,
    Deleted,
    DefaultShellChanged,
    AvailabilityChanged,
}

/// Carries one invalidation payload without any profile configuration.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub struct CliProfilesChangedDto {
    pub revision: String,
    pub kind: CliProfilesChangeKindDto,
    pub profile_id: Option<String>,
}

/// Describes CLI profile failures without leaking paths, values, or accounts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "camelCase")]
#[ts(tag = "code", rename_all = "camelCase")]
#[ts(export_to = "terminal/cli-profiles.ts")]
pub enum CliProfilesError {
    UnauthorizedWindow,
    ProfileNotFound,
    BuiltInProfileReadOnly,
    TooManyProfiles,
    InvalidName,
    InvalidCommand,
    InvalidArguments,
    InvalidShell,
    InvalidIcon,
    InvalidColor,
    InvalidEnvironmentName,
    DuplicateEnvironmentName,
    TooManyEnvironmentVariables,
    InvalidEnvironmentValue,
    SecretValueRequired,
    CommandNotFound,
    ShellNotFound,
    CredentialStoreUnavailable,
    SecretWriteFailed,
    SecretReadFailed,
    SecretNotFound,
    CommandResolutionFailed,
    PersistenceFailed,
}

impl Display for CliProfilesError {
    /// Formats one stable category without any path, value, or account.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::UnauthorizedWindow => "the invoking window cannot manage CLI profiles",
            Self::ProfileNotFound => "the CLI profile no longer exists",
            Self::BuiltInProfileReadOnly => "built-in CLI profiles are read-only",
            Self::TooManyProfiles => "the custom CLI profile limit is reached",
            Self::InvalidName => "the profile name is not valid",
            Self::InvalidCommand => "the profile command is not valid",
            Self::InvalidArguments => "the profile arguments are not valid",
            Self::InvalidShell => "the selected shell is not part of the catalog",
            Self::InvalidIcon => "the profile icon is not valid",
            Self::InvalidColor => "the profile colour is not valid",
            Self::InvalidEnvironmentName => "an environment variable name is not valid",
            Self::DuplicateEnvironmentName => "an environment variable name is duplicated",
            Self::TooManyEnvironmentVariables => "the environment variable limit is reached",
            Self::InvalidEnvironmentValue => "an environment variable value is not valid",
            Self::SecretValueRequired => "a new or renamed secret requires a value",
            Self::CommandNotFound => "the profile command could not be found",
            Self::ShellNotFound => "the effective shell could not be found",
            Self::CredentialStoreUnavailable => "the credential store is unavailable",
            Self::SecretWriteFailed => "the secret could not be stored",
            Self::SecretReadFailed => "the secret could not be read",
            Self::SecretNotFound => "the stored secret no longer exists",
            Self::CommandResolutionFailed => "the command could not be checked",
            Self::PersistenceFailed => "the CLI profile database operation failed",
        };
        formatter.write_str(message)
    }
}

impl Error for CliProfilesError {}

impl From<StorageError> for CliProfilesError {
    /// Collapses every storage failure into the safe persistence category.
    fn from(_error: StorageError) -> Self {
        Self::PersistenceFailed
    }
}

impl From<rusqlite::Error> for CliProfilesError {
    /// Collapses every SQLite failure into the safe persistence category.
    fn from(_error: rusqlite::Error) -> Self {
        Self::PersistenceFailed
    }
}

/// Supplies the millisecond wall clock used by profile timestamps.
#[doc(hidden)]
pub trait CliProfilesClock: Send + Sync {
    /// Returns the current Unix epoch time in milliseconds.
    fn now_ms(&self) -> Result<i64, CliProfilesError>;
}

/// Supplies opaque profile identifiers and credential accounts.
#[doc(hidden)]
pub trait CliProfileIdFactory: Send + Sync {
    /// Returns one new prefixed custom profile identifier.
    fn new_profile_id(&self) -> String;

    /// Returns one new opaque credential account identifier.
    fn new_credential_account(&self) -> String;
}

/// Publishes the invalidation event emitted after a committed change.
#[doc(hidden)]
pub trait CliProfilesEventSink: Send + Sync {
    /// Delivers one already committed invalidation to interested webviews.
    fn publish(&self, event: CliProfilesChangedDto) -> Result<(), CliProfilesError>;
}

/// Reads the operating-system wall clock for production timestamps.
pub struct SystemCliProfilesClock;

impl CliProfilesClock for SystemCliProfilesClock {
    /// Converts the system clock into a non-negative millisecond timestamp.
    fn now_ms(&self) -> Result<i64, CliProfilesError> {
        let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).map_err(
            // A clock before the Unix epoch cannot produce a valid persisted timestamp.
            |_| CliProfilesError::PersistenceFailed,
        )?;
        i64::try_from(elapsed.as_millis()).map_err(
            // A timestamp beyond the signed range would break the persisted contract.
            |_| CliProfilesError::PersistenceFailed,
        )
    }
}

/// Generates version 4 identifiers for profiles and credential accounts.
pub struct UuidCliProfileIdFactory;

impl CliProfileIdFactory for UuidCliProfileIdFactory {
    /// Returns the prefixed lowercase hyphenated custom profile identifier.
    fn new_profile_id(&self) -> String {
        format!("{PROFILE_ID_PREFIX}{}", uuid::Uuid::new_v4().hyphenated())
    }

    /// Returns one opaque account that carries no profile or variable text.
    fn new_credential_account(&self) -> String {
        uuid::Uuid::new_v4().hyphenated().to_string()
    }
}

/// Emits committed CLI profile invalidations to every listening webview.
pub struct TauriCliProfilesEventSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriCliProfilesEventSink<R> {
    /// Creates the native event sink from the composition root's handle.
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> CliProfilesEventSink for TauriCliProfilesEventSink<R> {
    /// Publishes one invalidation payload after the owning change committed.
    fn publish(&self, event: CliProfilesChangedDto) -> Result<(), CliProfilesError> {
        self.app.emit(CLI_PROFILES_CHANGED_EVENT, event).map_err(
            // Delivery failures are reported without exposing runtime details.
            |_| CliProfilesError::PersistenceFailed,
        )
    }
}

/// Holds one persisted environment entry exactly as SQLite stores it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StoredEnvironment {
    pub(crate) name: String,
    pub(crate) value: Option<String>,
    pub(crate) is_secret: bool,
    pub(crate) credential_account: Option<String>,
}

/// Holds one persisted custom profile exactly as SQLite stores it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StoredProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) command: String,
    pub(crate) arguments: Vec<String>,
    pub(crate) shell_id: Option<String>,
    pub(crate) icon: String,
    pub(crate) color: String,
    pub(crate) environment: Vec<StoredEnvironment>,
    pub(crate) created_at_ms: i64,
    pub(crate) updated_at_ms: i64,
}

/// Holds one catalog shell together with its last resolved availability.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ShellState {
    id: String,
    display_name: String,
    command: String,
    is_available: bool,
}

/// Holds one profile's runtime availability, which is never persisted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AvailabilityState {
    status: CliProfileAvailabilityStatusDto,
    checked_at_ms: Option<i64>,
}

impl AvailabilityState {
    /// Returns the unchecked state used before any completed check.
    fn unchecked() -> Self {
        Self {
            status: CliProfileAvailabilityStatusDto::Unchecked,
            checked_at_ms: None,
        }
    }

    /// Projects the native state into its precision-safe DTO representation.
    fn to_dto(self) -> CliProfileAvailabilityDto {
        CliProfileAvailabilityDto {
            status: self.status,
            checked_at_unix_ms: self.checked_at_ms.map(
                // JavaScript-safe transport keeps every timestamp a decimal string.
                |value| value.to_string(),
            ),
        }
    }
}

/// Holds one immutable committed view of all CLI profile state.
#[derive(Clone, Debug)]
struct CacheState {
    revision: u64,
    generation: u64,
    default_shell_id: String,
    effective_default_shell_id: String,
    shells: Vec<ShellState>,
    profiles: Vec<StoredProfile>,
    availability: HashMap<String, AvailabilityState>,
}

impl CacheState {
    /// Returns the effective shell of one custom profile.
    fn effective_shell_of(&self, profile: &StoredProfile) -> String {
        profile
            .shell_id
            .clone()
            .unwrap_or_else(|| self.effective_default_shell_id.clone())
    }

    /// Returns the display command of the current effective default shell.
    fn effective_default_command(&self) -> String {
        self.shells
            .iter()
            .find(
                // The Terminal profile shows whichever shell the default resolves to.
                |shell| shell.id == self.effective_default_shell_id,
            )
            .map_or_else(String::new, |shell| shell.command.clone())
    }

    /// Returns the availability of one profile, defaulting to unchecked.
    fn availability_of(&self, profile_id: &str) -> AvailabilityState {
        self.availability
            .get(profile_id)
            .copied()
            .unwrap_or_else(AvailabilityState::unchecked)
    }

    /// Projects the whole committed cache into the public snapshot contract.
    fn to_dto(&self) -> CliProfilesSnapshotDto {
        let terminal_command = self.effective_default_command();
        let mut profiles = Vec::with_capacity(BUILT_IN_PROFILES.len() + self.profiles.len());

        for built_in in &BUILT_IN_PROFILES {
            profiles.push(CliProfileDto {
                id: built_in.id.to_owned(),
                name: built_in.name.to_owned(),
                kind: CliProfileKindDto::BuiltIn,
                command: built_in.command.map(str::to_owned).or_else(
                    // Terminal has no CLI command, so it displays the effective shell instead.
                    || Some(terminal_command.clone()),
                ),
                arguments: Vec::new(),
                shell_id: None,
                effective_shell_id: self.effective_default_shell_id.clone(),
                icon: built_in.icon.to_owned(),
                color: built_in.color.to_owned(),
                environment: Vec::new(),
                availability: self.availability_of(built_in.id).to_dto(),
            });
        }

        for profile in &self.profiles {
            profiles.push(CliProfileDto {
                id: profile.id.clone(),
                name: profile.name.clone(),
                kind: CliProfileKindDto::Custom,
                command: Some(profile.command.clone()),
                arguments: profile.arguments.clone(),
                shell_id: profile.shell_id.clone(),
                effective_shell_id: self.effective_shell_of(profile),
                icon: profile.icon.clone(),
                color: profile.color.clone(),
                environment: profile
                    .environment
                    .iter()
                    .map(
                        // A secret entry reports storage without ever exposing its value.
                        |entry| CliProfileEnvironmentDto {
                            name: entry.name.clone(),
                            value: entry.value.clone(),
                            is_secret: entry.is_secret,
                            has_stored_value: entry.value.is_some()
                                || entry.credential_account.is_some(),
                        },
                    )
                    .collect(),
                availability: self.availability_of(&profile.id).to_dto(),
            });
        }

        CliProfilesSnapshotDto {
            revision: self.revision.to_string(),
            default_shell_id: self.default_shell_id.clone(),
            effective_default_shell_id: self.effective_default_shell_id.clone(),
            shells: self
                .shells
                .iter()
                .map(
                    // The persisted selection decides which catalog entry is the default.
                    |shell| CliShellDto {
                        id: shell.id.clone(),
                        display_name: shell.display_name.clone(),
                        command: shell.command.clone(),
                        is_available: shell.is_available,
                        is_default: shell.id == self.default_shell_id,
                    },
                )
                .collect(),
            profiles,
        }
    }
}

/// Owns the CLI profile cache, persistence handle, and collaborator ports.
#[derive(Clone)]
pub struct CliProfilesService {
    inner: Arc<ServiceInner>,
}

/// Stores every collaborator and admission primitive of the profile service.
struct ServiceInner {
    storage: Storage,
    gate: DataMaintenanceGate,
    commands: Arc<dyn CommandResolver>,
    shells: Arc<dyn ShellResolver>,
    credentials: Arc<dyn CredentialStore>,
    events: Arc<dyn CliProfilesEventSink>,
    clock: Arc<dyn CliProfilesClock>,
    ids: Arc<dyn CliProfileIdFactory>,
    /// Serializes every mutation, publication, and accepted availability result.
    mutation_lock: AsyncMutex<()>,
    /// Publishes exactly one hydrated cache after a successful first read.
    initialized: OnceCell<()>,
    cache: RwLock<Option<CacheState>>,
    /// Caps every startup and explicit availability check at four workers.
    check_limit: Arc<Semaphore>,
    /// Notifies internal backend consumers of each committed cache revision.
    revisions: watch::Sender<u64>,
}

impl CliProfilesService {
    /// Creates the production service around its native collaborators.
    pub fn new(
        storage: Storage,
        gate: DataMaintenanceGate,
        commands: Arc<dyn CommandResolver>,
        shells: Arc<dyn ShellResolver>,
        credentials: Arc<dyn CredentialStore>,
        events: Arc<dyn CliProfilesEventSink>,
    ) -> Self {
        Self::with_seams(
            storage,
            gate,
            commands,
            shells,
            credentials,
            events,
            Arc::new(SystemCliProfilesClock),
            Arc::new(UuidCliProfileIdFactory),
        )
    }

    /// Creates a service whose clock and identifier source are injected.
    #[doc(hidden)]
    #[allow(clippy::too_many_arguments)]
    pub fn with_seams(
        storage: Storage,
        gate: DataMaintenanceGate,
        commands: Arc<dyn CommandResolver>,
        shells: Arc<dyn ShellResolver>,
        credentials: Arc<dyn CredentialStore>,
        events: Arc<dyn CliProfilesEventSink>,
        clock: Arc<dyn CliProfilesClock>,
        ids: Arc<dyn CliProfileIdFactory>,
    ) -> Self {
        Self {
            inner: Arc::new(ServiceInner {
                storage,
                gate,
                commands,
                shells,
                credentials,
                events,
                clock,
                ids,
                mutation_lock: AsyncMutex::new(()),
                initialized: OnceCell::new(),
                cache: RwLock::new(None),
                check_limit: Arc::new(Semaphore::new(MAX_AVAILABILITY_CHECKS)),
                revisions: watch::Sender::new(0),
            }),
        }
    }

    /// Reports whether this service shares one admission gate with another handle.
    #[doc(hidden)]
    pub fn shares_gate_with(&self, gate: &DataMaintenanceGate) -> bool {
        self.inner.gate.shares_state_with(gate)
    }

    /// Hydrates the cache exactly once and returns the same result to every caller.
    pub async fn initialize(&self) -> Result<(), CliProfilesError> {
        self.inner
            .initialized
            .get_or_try_init(
                // A failed hydration is never cached, so a later call can retry it.
                || async { self.hydrate().await },
            )
            .await
            .copied()
    }

    /// Returns the current committed snapshot without any database work.
    pub async fn snapshot(&self) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        self.initialize().await?;
        self.with_cache(CacheState::to_dto)
    }

    /// Reads persisted state and resolves the shell catalog on a blocking worker.
    async fn hydrate(&self) -> Result<(), CliProfilesError> {
        let storage = self.inner.storage.clone();
        let shells = self.inner.shells.clone();
        let state = tauri::async_runtime::spawn_blocking(
            // Every SQLite and discovery call runs off the asynchronous runtime.
            move || {
                let persisted = storage.with_connection(read_persisted_state)?;
                let runtime = resolve_shell_runtime(shells.as_ref(), &persisted.default_shell_id);
                Ok::<_, CliProfilesError>(build_cache(persisted, runtime))
            },
        )
        .await
        .map_err(
            // A cancelled worker leaves the service uninitialized rather than empty.
            |_| CliProfilesError::PersistenceFailed,
        )??;

        let mut cache = self
            .inner
            .cache
            .write()
            .map_err(|_| CliProfilesError::PersistenceFailed)?;
        *cache = Some(state);
        Ok(())
    }

    /// Applies one read-only projection to the hydrated cache.
    fn with_cache<T>(
        &self,
        projection: impl FnOnce(&CacheState) -> T,
    ) -> Result<T, CliProfilesError> {
        let cache = self
            .inner
            .cache
            .read()
            .map_err(|_| CliProfilesError::PersistenceFailed)?;
        cache
            .as_ref()
            .map(projection)
            .ok_or(CliProfilesError::PersistenceFailed)
    }
}

/// Holds every persisted value one hydration read produced.
pub(crate) struct PersistedState {
    pub(crate) default_shell_id: String,
    pub(crate) profiles: Vec<StoredProfile>,
}

/// Holds the resolved shell catalog and the current effective default shell.
struct ShellRuntime {
    shells: Vec<ShellState>,
    effective_default_shell_id: String,
}

/// Builds the first committed cache from persisted state and resolved shells.
fn build_cache(persisted: PersistedState, runtime: ShellRuntime) -> CacheState {
    let mut availability = HashMap::new();
    for built_in in &BUILT_IN_PROFILES {
        availability.insert(built_in.id.to_owned(), AvailabilityState::unchecked());
    }
    for profile in &persisted.profiles {
        availability.insert(profile.id.clone(), AvailabilityState::unchecked());
    }

    CacheState {
        revision: 0,
        generation: 0,
        default_shell_id: persisted.default_shell_id,
        effective_default_shell_id: runtime.effective_default_shell_id,
        shells: runtime.shells,
        profiles: persisted.profiles,
        availability,
    }
}

/// Resolves the catalog and the effective default shell without persisting it.
fn resolve_shell_runtime(shells: &dyn ShellResolver, default_shell_id: &str) -> ShellRuntime {
    let descriptors = shells.catalog();
    let states = descriptors
        .iter()
        .map(
            // A resolvable entry reports the concrete command it actually found.
            |descriptor| {
                let resolved = shells.resolve(&descriptor.id);
                ShellState {
                    id: descriptor.id.clone(),
                    display_name: descriptor.display_name.clone(),
                    command: resolved
                        .as_ref()
                        .map(|shell| shell.command.clone())
                        .unwrap_or_else(|_| descriptor.command.clone()),
                    is_available: resolved.is_ok(),
                }
            },
        )
        .collect::<Vec<_>>();

    // The effective identifier is always concrete, even when nothing resolves.
    let effective_default_shell_id = match shells.resolve(default_shell_id) {
        Ok(resolved) => resolved.id,
        Err(_) if default_shell_id != SYSTEM_SHELL_ID => default_shell_id.to_owned(),
        Err(_) => descriptors
            .iter()
            .find(
                // The first concrete catalog entry stays a stable display fallback.
                |descriptor| descriptor.id != SYSTEM_SHELL_ID,
            )
            .map_or_else(|| SYSTEM_SHELL_ID.to_owned(), |entry| entry.id.clone()),
    };

    ShellRuntime {
        shells: states,
        effective_default_shell_id,
    }
}

/// Reads and revalidates every persisted CLI profile row.
pub(crate) fn read_persisted_state(
    connection: &Connection,
) -> Result<PersistedState, CliProfilesError> {
    let default_shell_id = connection.query_row(
        "SELECT default_shell_id FROM cli_profile_settings WHERE id = 1",
        [],
        // Decodes the singleton default shell selection.
        |row| row.get::<_, String>(0),
    )?;
    validate_persisted_shell_id(&default_shell_id, true)?;

    let mut environment: HashMap<String, Vec<StoredEnvironment>> = HashMap::new();
    {
        let mut statement = connection.prepare(
            "SELECT profile_id, name, value, is_secret, credential_account \
             FROM cli_profile_environment ORDER BY profile_id, position",
        )?;
        let rows = statement
            .query_map(
                [],
                // Copies each untrusted row so validation runs after the borrow ends.
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        for (profile_id, name, value, is_secret, credential_account) in rows {
            let is_secret = match is_secret {
                0 => false,
                1 => true,
                _ => return Err(CliProfilesError::PersistenceFailed),
            };
            environment
                .entry(profile_id)
                .or_default()
                .push(StoredEnvironment {
                    name,
                    value,
                    is_secret,
                    credential_account,
                });
        }
    }

    let mut statement = connection.prepare(
        "SELECT id, name, command, arguments_json, shell_id, icon, color, \
         created_at_ms, updated_at_ms FROM cli_profiles \
         ORDER BY created_at_ms ASC, id ASC",
    )?;
    let rows = statement
        .query_map(
            [],
            // Copies each untrusted row so validation runs after the borrow ends.
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    let mut profiles = Vec::with_capacity(rows.len());
    for (id, name, command, arguments_json, shell_id, icon, color, created, updated) in rows {
        let arguments = decode_arguments(&arguments_json)?;
        let profile = StoredProfile {
            environment: environment.remove(&id).unwrap_or_default(),
            id,
            name,
            command,
            arguments,
            shell_id,
            icon,
            color,
            created_at_ms: created,
            updated_at_ms: updated,
        };
        validate_stored_profile(&profile)?;
        profiles.push(profile);
    }

    // Environment rows without a surviving profile would break the foreign key.
    if !environment.is_empty() {
        return Err(CliProfilesError::PersistenceFailed);
    }

    Ok(PersistedState {
        default_shell_id,
        profiles,
    })
}

/// Decodes one persisted argument array and rejects a non-string element.
pub(crate) fn decode_arguments(arguments_json: &str) -> Result<Vec<String>, CliProfilesError> {
    let values = serde_json::from_str::<Vec<serde_json::Value>>(arguments_json).map_err(
        // A malformed array is corrupt storage, never a silently empty argument list.
        |_| CliProfilesError::PersistenceFailed,
    )?;
    values
        .into_iter()
        .map(
            // Every element must already be a JSON string, exactly as written.
            |value| match value {
                serde_json::Value::String(argument) => Ok(argument),
                _ => Err(CliProfilesError::PersistenceFailed),
            },
        )
        .collect()
}

/// Encodes one argument list into the persisted canonical JSON array.
pub(crate) fn encode_arguments(arguments: &[String]) -> Result<String, CliProfilesError> {
    serde_json::to_string(arguments).map_err(
        // Encoding cannot fail for plain strings, so a failure is a persistence fault.
        |_| CliProfilesError::PersistenceFailed,
    )
}

/// Revalidates one persisted profile and rejects corrupt storage loudly.
fn validate_stored_profile(profile: &StoredProfile) -> Result<(), CliProfilesError> {
    let corrupt = |_error: CliProfilesError| CliProfilesError::PersistenceFailed;

    validate_profile_id(&profile.id).map_err(corrupt)?;
    validate_name(&profile.name).map_err(corrupt)?;
    validate_command(&profile.command).map_err(corrupt)?;
    validate_arguments(&profile.arguments).map_err(corrupt)?;
    validate_icon(&profile.icon).map_err(corrupt)?;
    validate_color(&profile.color).map_err(corrupt)?;
    if let Some(shell_id) = &profile.shell_id {
        validate_persisted_shell_id(shell_id, false)?;
    }
    if profile.environment.len() > MAX_ENVIRONMENT_ENTRIES {
        return Err(CliProfilesError::PersistenceFailed);
    }
    let mut seen = HashSet::new();
    for entry in &profile.environment {
        validate_environment_name(&entry.name).map_err(corrupt)?;
        if !seen.insert(entry.name.to_ascii_lowercase()) {
            return Err(CliProfilesError::PersistenceFailed);
        }
        match (entry.is_secret, &entry.value, &entry.credential_account) {
            (false, Some(value), None) => validate_environment_value(value).map_err(corrupt)?,
            (true, None, Some(account)) if !account.is_empty() => {}
            _ => return Err(CliProfilesError::PersistenceFailed),
        }
    }
    if profile.created_at_ms < 0 || profile.updated_at_ms < profile.created_at_ms {
        return Err(CliProfilesError::PersistenceFailed);
    }
    Ok(())
}

/// Rejects a persisted shell identifier that violates the storage contract.
fn validate_persisted_shell_id(shell_id: &str, allow_system: bool) -> Result<(), CliProfilesError> {
    if shell_id.is_empty() || shell_id.len() > MAX_SHELL_ID_LENGTH {
        return Err(CliProfilesError::PersistenceFailed);
    }
    // A profile override can never be the sentinel, which only the singleton may hold.
    if shell_id == SYSTEM_SHELL_ID && !allow_system {
        return Err(CliProfilesError::PersistenceFailed);
    }
    Ok(())
}

/// Rejects a custom profile identifier that is not backend generated.
pub(crate) fn validate_profile_id(profile_id: &str) -> Result<(), CliProfilesError> {
    if profile_id.len() != PROFILE_ID_LENGTH {
        return Err(CliProfilesError::ProfileNotFound);
    }
    let Some(suffix) = profile_id.strip_prefix(PROFILE_ID_PREFIX) else {
        return Err(CliProfilesError::ProfileNotFound);
    };
    if uuid::Uuid::try_parse(suffix).is_err() || suffix != suffix.to_ascii_lowercase() {
        return Err(CliProfilesError::ProfileNotFound);
    }
    Ok(())
}

/// Reports whether one identifier names an immutable built-in profile.
pub(crate) fn is_built_in(profile_id: &str) -> bool {
    BUILT_IN_PROFILES
        .iter()
        .any(|built_in| built_in.id == profile_id)
}

/// Validates one trimmed display name against the documented scalar limits.
fn validate_name(name: &str) -> Result<(), CliProfilesError> {
    let trimmed = name.trim();
    let scalars = trimmed.chars().count();
    if scalars == 0 || scalars > MAX_NAME_SCALARS || trimmed.chars().any(char::is_control) {
        return Err(CliProfilesError::InvalidName);
    }
    Ok(())
}

/// Validates one command as a bare executable name or an absolute path.
fn validate_command(command: &str) -> Result<(), CliProfilesError> {
    let trimmed = command.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_COMMAND_BYTES {
        return Err(CliProfilesError::InvalidCommand);
    }
    validate_command_candidate(trimmed).map_err(
        // Shape rejection is a validation failure, never an operating-system result.
        |error| match error {
            CommandResolutionError::InvalidCandidate => CliProfilesError::InvalidCommand,
            _ => CliProfilesError::InvalidCommand,
        },
    )
}

/// Validates the argument array against every documented size limit.
fn validate_arguments(arguments: &[String]) -> Result<(), CliProfilesError> {
    if arguments.len() > MAX_ARGUMENTS {
        return Err(CliProfilesError::InvalidArguments);
    }
    let mut total = 0usize;
    for argument in arguments {
        if argument.len() > MAX_ARGUMENT_BYTES || argument.contains('\u{0}') {
            return Err(CliProfilesError::InvalidArguments);
        }
        total += argument.len();
    }
    if total > MAX_ARGUMENTS_TOTAL_BYTES {
        return Err(CliProfilesError::InvalidArguments);
    }
    Ok(())
}

/// Validates one trimmed icon label against the documented scalar limits.
fn validate_icon(icon: &str) -> Result<(), CliProfilesError> {
    let trimmed = icon.trim();
    let scalars = trimmed.chars().count();
    if scalars == 0 || scalars > MAX_ICON_SCALARS || trimmed.chars().any(char::is_control) {
        return Err(CliProfilesError::InvalidIcon);
    }
    Ok(())
}

/// Validates one lowercase six-digit hexadecimal identity colour.
fn validate_color(color: &str) -> Result<(), CliProfilesError> {
    let bytes = color.as_bytes();
    if bytes.len() != 7
        || bytes[0] != b'#'
        || !bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(CliProfilesError::InvalidColor);
    }
    Ok(())
}

/// Validates one environment variable name against the documented pattern.
fn validate_environment_name(name: &str) -> Result<(), CliProfilesError> {
    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_ENVIRONMENT_NAME_LENGTH {
        return Err(CliProfilesError::InvalidEnvironmentName);
    }
    if !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_') {
        return Err(CliProfilesError::InvalidEnvironmentName);
    }
    if !bytes[1..]
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
    {
        return Err(CliProfilesError::InvalidEnvironmentName);
    }
    Ok(())
}

/// Validates one environment value, allowing an empty but not a NUL value.
fn validate_environment_value(value: &str) -> Result<(), CliProfilesError> {
    if value.len() > MAX_ENVIRONMENT_VALUE_BYTES || value.contains('\u{0}') {
        return Err(CliProfilesError::InvalidEnvironmentValue);
    }
    Ok(())
}

/// Holds one already validated environment entry from a command input.
///
/// The type derives neither `Debug`, `Clone`, nor `Serialize` so a plaintext
/// secret cannot leave the validated buffer by accident.
pub(crate) struct ValidatedEnvironment {
    pub(crate) name: String,
    pub(crate) value: Option<Zeroizing<String>>,
    pub(crate) is_secret: bool,
}

/// Holds one already validated custom profile configuration.
///
/// The type derives neither `Debug`, `Clone`, nor `Serialize` because its
/// environment entries may still carry plaintext secret values.
pub(crate) struct ValidatedProfileInput {
    pub(crate) name: String,
    pub(crate) command: String,
    pub(crate) arguments: Vec<String>,
    pub(crate) shell_id: Option<String>,
    pub(crate) icon: String,
    pub(crate) color: String,
    pub(crate) environment: Vec<ValidatedEnvironment>,
}

/// Validates one complete profile input before any side effect can happen.
pub(crate) fn validate_input(
    input: CliProfileInputDto,
    catalog: &[String],
) -> Result<ValidatedProfileInput, CliProfilesError> {
    validate_name(&input.name)?;
    validate_command(&input.command)?;
    validate_arguments(&input.arguments)?;
    if let Some(shell_id) = &input.shell_id {
        // Only a concrete catalog identifier may override the global default shell.
        if shell_id == SYSTEM_SHELL_ID || !catalog.iter().any(|known| known == shell_id) {
            return Err(CliProfilesError::InvalidShell);
        }
    }
    validate_icon(&input.icon)?;
    validate_color(&input.color)?;
    if input.environment.len() > MAX_ENVIRONMENT_ENTRIES {
        return Err(CliProfilesError::TooManyEnvironmentVariables);
    }

    let mut seen = HashSet::new();
    let mut environment = Vec::with_capacity(input.environment.len());
    for entry in input.environment {
        validate_environment_name(&entry.name)?;
        if !seen.insert(entry.name.to_ascii_lowercase()) {
            return Err(CliProfilesError::DuplicateEnvironmentName);
        }
        let value = match (entry.is_secret, entry.value) {
            (false, Some(value)) => {
                validate_environment_value(&value)?;
                Some(Zeroizing::new(value))
            }
            // A non-secret entry always carries its own literal value.
            (false, None) => return Err(CliProfilesError::InvalidEnvironmentValue),
            (true, Some(value)) => {
                validate_environment_value(&value)?;
                Some(Zeroizing::new(value))
            }
            // A missing secret value means "keep the current credential" and is resolved later.
            (true, None) => None,
        };
        environment.push(ValidatedEnvironment {
            name: entry.name,
            value,
            is_secret: entry.is_secret,
        });
    }

    Ok(ValidatedProfileInput {
        name: input.name.trim().to_owned(),
        command: input.command.trim().to_owned(),
        arguments: input.arguments,
        shell_id: input.shell_id,
        icon: input.icon.trim().to_owned(),
        color: input.color,
        environment,
    })
}

/// Writes one profile row and every environment row inside a transaction.
pub(crate) fn write_profile_rows(
    connection: &Connection,
    profile: &StoredProfile,
) -> Result<(), CliProfilesError> {
    connection.execute(
        "INSERT INTO cli_profiles \
         (id, name, command, arguments_json, shell_id, icon, color, created_at_ms, updated_at_ms) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, command = excluded.command, \
         arguments_json = excluded.arguments_json, shell_id = excluded.shell_id, \
         icon = excluded.icon, color = excluded.color, updated_at_ms = excluded.updated_at_ms",
        params![
            profile.id,
            profile.name,
            profile.command,
            encode_arguments(&profile.arguments)?,
            profile.shell_id,
            profile.icon,
            profile.color,
            profile.created_at_ms,
            profile.updated_at_ms,
        ],
    )?;
    connection.execute(
        "DELETE FROM cli_profile_environment WHERE profile_id = ?1",
        params![profile.id],
    )?;
    for (position, entry) in profile.environment.iter().enumerate() {
        connection.execute(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                profile.id,
                position as i64,
                entry.name,
                entry.value,
                i64::from(entry.is_secret),
                entry.credential_account,
            ],
        )?;
    }
    Ok(())
}

/// Distinguishes a first insert from a full replacement of one profile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PersistMode {
    Create,
    Update,
}

impl CliProfilesService {
    /// Creates one custom profile and returns the snapshot committed with it.
    pub async fn create_profile(
        &self,
        input: CliProfileInputDto,
    ) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        let profile_id = self.inner.ids.new_profile_id();
        self.persist_profile(
            PersistMode::Create,
            profile_id,
            input,
            CliProfilesChangeKindDto::Created,
        )
        .await
    }

    /// Replaces the whole configuration of one existing custom profile.
    pub async fn update_profile(
        &self,
        profile_id: &str,
        input: CliProfileInputDto,
    ) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        if is_built_in(profile_id) {
            return Err(CliProfilesError::BuiltInProfileReadOnly);
        }
        validate_profile_id(profile_id)?;
        self.persist_profile(
            PersistMode::Update,
            profile_id.to_owned(),
            input,
            CliProfilesChangeKindDto::Updated,
        )
        .await
    }

    /// Deletes one custom profile and queues every credential it referenced.
    pub async fn delete_profile(
        &self,
        profile_id: &str,
    ) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        self.initialize().await?;
        if is_built_in(profile_id) {
            return Err(CliProfilesError::BuiltInProfileReadOnly);
        }
        validate_profile_id(profile_id)?;

        let permit = self.inner.gate.read_permit().await;
        let now_ms = self.inner.clock.now_ms()?;
        let committed = {
            let _mutation = self.inner.mutation_lock.lock().await;
            let storage = self.inner.storage.clone();
            let target = profile_id.to_owned();
            let outcome = tauri::async_runtime::spawn_blocking(
                // The metadata delete and cleanup enqueue share one transaction.
                move || storage.with_transaction(|tx| delete_profile_in(tx, &target, now_ms)),
            )
            .await
            .map_err(
                // A cancelled worker leaves the committed configuration untouched.
                |_| CliProfilesError::PersistenceFailed,
            )?;

            match outcome {
                Ok(()) => {
                    let removed = profile_id.to_owned();
                    self.commit_change(
                        CliProfilesChangeKindDto::Deleted,
                        Some(removed.clone()),
                        true,
                        // The deleted profile leaves both the ordered list and the cache.
                        move |state| {
                            state.profiles.retain(|profile| profile.id != removed);
                            state.availability.remove(&removed);
                        },
                    )
                }
                Err(error) => Err(error),
            }
        };
        drop(permit);

        if committed.is_ok() {
            // A failed post-commit cleanup keeps its durable queue row and retries later.
            let _ = self.retry_credential_cleanup().await;
        }
        committed
    }

    /// Selects the global default shell used by Terminal and inheriting profiles.
    pub async fn set_default_shell(
        &self,
        shell_id: &str,
    ) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        self.initialize().await?;
        let catalog = self.catalog_ids()?;
        if !catalog.iter().any(|known| known == shell_id) {
            return Err(CliProfilesError::InvalidShell);
        }
        // The selection must resolve now, so an unusable shell can never be persisted.
        self.resolve_shell(shell_id).await?;

        let permit = self.inner.gate.read_permit().await;
        let committed = {
            let _mutation = self.inner.mutation_lock.lock().await;
            let storage = self.inner.storage.clone();
            let shells = self.inner.shells.clone();
            let selected = shell_id.to_owned();
            let outcome = tauri::async_runtime::spawn_blocking(
                // Persisting the selection and re-resolving the catalog both block.
                move || {
                    storage.with_transaction(|tx| write_default_shell(tx, &selected))?;
                    Ok::<_, CliProfilesError>(resolve_shell_runtime(shells.as_ref(), &selected))
                },
            )
            .await
            .map_err(
                // A cancelled worker leaves the previous selection committed.
                |_| CliProfilesError::PersistenceFailed,
            )?;

            match outcome {
                Ok(runtime) => {
                    let selected = shell_id.to_owned();
                    self.commit_change(
                        CliProfilesChangeKindDto::DefaultShellChanged,
                        None,
                        true,
                        // Only inheriting profiles lose their availability status.
                        move |state| {
                            state.default_shell_id = selected;
                            state.effective_default_shell_id = runtime.effective_default_shell_id;
                            state.shells = runtime.shells;
                            for built_in in &BUILT_IN_PROFILES {
                                state
                                    .availability
                                    .insert(built_in.id.to_owned(), AvailabilityState::unchecked());
                            }
                            let inheriting = state
                                .profiles
                                .iter()
                                .filter(
                                    // A profile with its own override keeps its checked status.
                                    |profile| profile.shell_id.is_none(),
                                )
                                .map(|profile| profile.id.clone())
                                .collect::<Vec<_>>();
                            for id in inheriting {
                                state
                                    .availability
                                    .insert(id, AvailabilityState::unchecked());
                            }
                        },
                    )
                }
                Err(error) => Err(error),
            }
        };
        drop(permit);
        committed
    }

    /// Retries every durably queued credential deletion under its own permit.
    pub async fn retry_credential_cleanup(&self) -> Result<(), CliProfilesError> {
        let _permit = self.inner.gate.read_permit().await;
        let storage = self.inner.storage.clone();
        let credentials = self.inner.credentials.clone();
        tauri::async_runtime::spawn_blocking(
            // Reading the queue, deleting credentials, and clearing rows all block.
            move || {
                let accounts = storage.with_connection(select_cleanup_accounts)?;
                let mut failure = None;
                for account in accounts {
                    match credentials.delete_secret(&account) {
                        // Invariant: the queue row survives until the credential is provably
                        // gone, so a transient credential-store failure can never orphan it.
                        Ok(()) | Err(CredentialError::NotFound) => {
                            storage.with_transaction(|tx| delete_cleanup_row(tx, &account))?;
                        }
                        Err(error) => failure = Some(map_delete_error(error)),
                    }
                }
                match failure {
                    Some(error) => Err(error),
                    None => Ok(()),
                }
            },
        )
        .await
        .map_err(
            // A cancelled worker leaves every queue row durable for the next retry.
            |_| CliProfilesError::PersistenceFailed,
        )?
    }

    /// Validates, stages secrets, commits, and publishes one profile change.
    async fn persist_profile(
        &self,
        mode: PersistMode,
        profile_id: String,
        input: CliProfileInputDto,
        kind: CliProfilesChangeKindDto,
    ) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        self.initialize().await?;
        let catalog = self.catalog_ids()?;
        // Pure validation runs before admission so a rejected input takes no permit.
        let validated = validate_input(input, &catalog)?;

        let permit = self.inner.gate.read_permit().await;
        let now_ms = self.inner.clock.now_ms()?;
        let staged = match self.stage_secrets(&validated).await {
            Ok(staged) => staged,
            Err((error, staged)) => {
                self.compensate_staged(staged, now_ms).await;
                return Err(error);
            }
        };
        let staged_accounts = staged.values().cloned().collect::<Vec<_>>();

        let committed = {
            let _mutation = self.inner.mutation_lock.lock().await;
            let storage = self.inner.storage.clone();
            let target = profile_id.clone();
            let outcome = tauri::async_runtime::spawn_blocking(
                // The definitive metadata read, row writes, and enqueue share one transaction.
                move || {
                    storage.with_transaction(|tx| {
                        persist_profile_in(tx, mode, &target, &validated, &staged, now_ms)
                    })
                },
            )
            .await
            .map_err(
                // A cancelled worker leaves the previous configuration committed.
                |_| CliProfilesError::PersistenceFailed,
            )?;

            match outcome {
                Ok(profile) => self.commit_change(
                    kind,
                    Some(profile.id.clone()),
                    true,
                    // The committed row replaces its cached copy and loses its status.
                    move |state| apply_profile(state, profile),
                ),
                Err(error) => Err(error),
            }
        };

        match committed {
            Ok(snapshot) => {
                drop(permit);
                // A failed post-commit cleanup keeps its queue row and never fails the result.
                let _ = self.retry_credential_cleanup().await;
                Ok(snapshot)
            }
            Err(error) => {
                // Invariant: credentials written before a failed commit must be deleted,
                // otherwise the store would keep a secret no metadata row references.
                self.compensate_staged(staged_accounts, now_ms).await;
                Err(error)
            }
        }
    }

    /// Writes every supplied secret to a fresh account without the mutation lock.
    #[allow(clippy::type_complexity)]
    async fn stage_secrets(
        &self,
        validated: &ValidatedProfileInput,
    ) -> Result<HashMap<String, String>, (CliProfilesError, Vec<String>)> {
        let requests = validated
            .environment
            .iter()
            .filter(
                // Only a supplied secret value needs a brand-new credential account.
                |entry| entry.is_secret && entry.value.is_some(),
            )
            .map(
                // Each request pairs the entry key with the account that will hold it.
                |entry| {
                    (
                        entry.name.to_ascii_lowercase(),
                        self.inner.ids.new_credential_account(),
                        entry
                            .value
                            .clone()
                            .expect("a filtered secret always carries its value"),
                    )
                },
            )
            .collect::<Vec<_>>();
        if requests.is_empty() {
            return Ok(HashMap::new());
        }

        let credentials = self.inner.credentials.clone();
        let outcome = tauri::async_runtime::spawn_blocking(
            // Every credential write runs on a blocking worker, never on the runtime.
            move || {
                let mut written = HashMap::new();
                let mut accounts = Vec::new();
                for (key, account, value) in requests {
                    accounts.push(account.clone());
                    match credentials.write_secret(&account, &value) {
                        Ok(()) => {
                            written.insert(key, account);
                        }
                        // A partially applied write is still compensated by account.
                        Err(error) => return Err((map_write_error(error), accounts)),
                    }
                }
                Ok(written)
            },
        )
        .await;

        match outcome {
            Ok(result) => result,
            Err(_) => Err((CliProfilesError::SecretWriteFailed, Vec::new())),
        }
    }

    /// Deletes uncommitted credentials and durably queues whatever resists deletion.
    async fn compensate_staged(&self, accounts: Vec<String>, now_ms: i64) {
        if accounts.is_empty() {
            return;
        }
        let credentials = self.inner.credentials.clone();
        let storage = self.inner.storage.clone();
        let _ = tauri::async_runtime::spawn_blocking(
            // Credential deletion and the compensating transaction both block.
            move || {
                let mut failed = Vec::new();
                for account in accounts {
                    match credentials.delete_secret(&account) {
                        Ok(()) | Err(CredentialError::NotFound) => {}
                        Err(_) => failed.push(account),
                    }
                }
                if failed.is_empty() {
                    return;
                }
                for account in &failed {
                    // Only a non-reversible hash is logged so no account can be correlated.
                    eprintln!(
                        "cli profile credential compensation deferred for account {}",
                        account_hash(account)
                    );
                }
                // Invariant: a credential that survived compensation must stay queued so a
                // later retry removes it instead of leaving an unreferenced secret behind.
                let _ = storage.with_transaction::<(), CliProfilesError>(|tx| {
                    enqueue_cleanup(tx, &failed, now_ms)
                });
            },
        )
        .await;
    }

    /// Returns the identifiers of every catalog shell from the hydrated cache.
    fn catalog_ids(&self) -> Result<Vec<String>, CliProfilesError> {
        self.with_cache(|cache| {
            cache
                .shells
                .iter()
                .map(
                    // Only identifiers are needed to validate a selection.
                    |shell| shell.id.clone(),
                )
                .collect()
        })
    }

    /// Resolves one shell identifier on a blocking worker and maps its failure.
    async fn resolve_shell(&self, shell_id: &str) -> Result<ResolvedShell, CliProfilesError> {
        let shells = self.inner.shells.clone();
        let selected = shell_id.to_owned();
        tauri::async_runtime::spawn_blocking(
            // Shell discovery inspects the filesystem and must never block the runtime.
            move || shells.resolve(&selected),
        )
        .await
        .map_err(
            // A cancelled worker is reported as an inspection failure, not as absence.
            |_| CliProfilesError::CommandResolutionFailed,
        )?
        .map_err(map_shell_error)
    }

    /// Publishes exactly one revision and invalidation for a committed change.
    fn commit_change(
        &self,
        kind: CliProfilesChangeKindDto,
        profile_id: Option<String>,
        invalidates_checks: bool,
        mutate: impl FnOnce(&mut CacheState),
    ) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        let (snapshot, event) = {
            let mut cache = self
                .inner
                .cache
                .write()
                .map_err(|_| CliProfilesError::PersistenceFailed)?;
            let state = cache.as_mut().ok_or(CliProfilesError::PersistenceFailed)?;
            mutate(state);
            state.revision = state
                .revision
                .checked_add(1)
                .ok_or(CliProfilesError::PersistenceFailed)?;
            // A new generation discards every availability check started before a
            // configuration change; an accepted availability result keeps the generation.
            if invalidates_checks {
                state.generation = state.generation.wrapping_add(1);
            }
            let snapshot = state.to_dto();
            let event = CliProfilesChangedDto {
                revision: state.revision.to_string(),
                kind,
                profile_id,
            };
            // Internal backend subscribers are notified without any failure path.
            let _ = self.inner.revisions.send(state.revision);
            (snapshot, event)
        };

        // Event delivery is best effort and never rolls back an already committed change.
        let _ = self.inner.events.publish(event);
        Ok(snapshot)
    }
}

/// Inserts or replaces one cached profile while keeping the documented order.
fn apply_profile(state: &mut CacheState, profile: StoredProfile) {
    state
        .availability
        .insert(profile.id.clone(), AvailabilityState::unchecked());
    match state
        .profiles
        .iter()
        .position(|existing| existing.id == profile.id)
    {
        Some(index) => state.profiles[index] = profile,
        None => {
            state.profiles.push(profile);
            state.profiles.sort_by(compare_profile_order);
        }
    }
}

/// Orders custom profiles by creation time and then by identifier.
fn compare_profile_order(left: &StoredProfile, right: &StoredProfile) -> std::cmp::Ordering {
    left.created_at_ms
        .cmp(&right.created_at_ms)
        .then_with(|| left.id.cmp(&right.id))
}

/// Maps one credential write failure onto its public category.
fn map_write_error(error: CredentialError) -> CliProfilesError {
    match error {
        CredentialError::Unavailable => CliProfilesError::CredentialStoreUnavailable,
        _ => CliProfilesError::SecretWriteFailed,
    }
}

/// Maps one credential read failure onto its public category.
fn map_read_error(error: CredentialError) -> CliProfilesError {
    match error {
        CredentialError::NotFound => CliProfilesError::SecretNotFound,
        CredentialError::Unavailable => CliProfilesError::CredentialStoreUnavailable,
        _ => CliProfilesError::SecretReadFailed,
    }
}

/// Maps one credential delete failure onto its public category.
fn map_delete_error(error: CredentialError) -> CliProfilesError {
    match error {
        CredentialError::Unavailable => CliProfilesError::CredentialStoreUnavailable,
        _ => CliProfilesError::SecretWriteFailed,
    }
}

/// Maps one shell resolution failure onto its public category.
fn map_shell_error(error: ShellResolutionError) -> CliProfilesError {
    match error {
        ShellResolutionError::UnknownShell => CliProfilesError::InvalidShell,
        // An inspection failure cannot confirm the shell, so it is reported as missing.
        _ => CliProfilesError::ShellNotFound,
    }
}

/// Returns one non-reversible short digest used only in diagnostics.
fn account_hash(account: &str) -> String {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    account.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Writes one full profile replacement and queues every replaced credential.
fn persist_profile_in(
    connection: &Connection,
    mode: PersistMode,
    profile_id: &str,
    validated: &ValidatedProfileInput,
    staged: &HashMap<String, String>,
    now_ms: i64,
) -> Result<StoredProfile, CliProfilesError> {
    let existing = select_profile(connection, profile_id)?;
    let created_at_ms = match mode {
        PersistMode::Create => {
            if existing.is_some() {
                return Err(CliProfilesError::PersistenceFailed);
            }
            if count_profiles(connection)? >= MAX_CUSTOM_PROFILES {
                return Err(CliProfilesError::TooManyProfiles);
            }
            now_ms
        }
        PersistMode::Update => {
            existing
                .as_ref()
                .ok_or(CliProfilesError::ProfileNotFound)?
                .created_at_ms
        }
    };

    let mut environment = Vec::with_capacity(validated.environment.len());
    for entry in &validated.environment {
        if entry.is_secret {
            let account = match entry.value.is_some() {
                true => staged
                    .get(&entry.name.to_ascii_lowercase())
                    .cloned()
                    .ok_or(CliProfilesError::SecretWriteFailed)?,
                // A missing value keeps the current credential only when one already exists.
                false => existing
                    .as_ref()
                    .and_then(|profile| current_secret_account(profile, &entry.name))
                    .ok_or(CliProfilesError::SecretValueRequired)?,
            };
            environment.push(StoredEnvironment {
                name: entry.name.clone(),
                value: None,
                is_secret: true,
                credential_account: Some(account),
            });
        } else {
            environment.push(StoredEnvironment {
                name: entry.name.clone(),
                value: Some(
                    entry
                        .value
                        .as_ref()
                        .map(|value| value.as_str().to_owned())
                        .ok_or(CliProfilesError::InvalidEnvironmentValue)?,
                ),
                is_secret: false,
                credential_account: None,
            });
        }
    }

    let retained = environment
        .iter()
        .filter_map(
            // Only surviving references may keep their credential in the store.
            |entry| entry.credential_account.clone(),
        )
        .collect::<HashSet<_>>();
    let replaced = existing
        .as_ref()
        .map(|profile| {
            profile
                .environment
                .iter()
                .filter_map(
                    // Every dropped or replaced reference must be cleaned up after commit.
                    |entry| entry.credential_account.clone(),
                )
                .filter(|account| !retained.contains(account))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let profile = StoredProfile {
        id: profile_id.to_owned(),
        name: validated.name.clone(),
        command: validated.command.clone(),
        arguments: validated.arguments.clone(),
        shell_id: validated.shell_id.clone(),
        icon: validated.icon.clone(),
        color: validated.color.clone(),
        environment,
        created_at_ms,
        updated_at_ms: now_ms.max(created_at_ms),
    };
    write_profile_rows(connection, &profile)?;
    enqueue_cleanup(connection, &replaced, now_ms)?;
    Ok(profile)
}

/// Returns the credential account of one currently secret variable.
fn current_secret_account(profile: &StoredProfile, name: &str) -> Option<String> {
    profile
        .environment
        .iter()
        .find(
            // Windows semantics compare variable names without ASCII case.
            |entry| entry.is_secret && entry.name.eq_ignore_ascii_case(name),
        )
        .and_then(|entry| entry.credential_account.clone())
}

/// Deletes one profile's metadata after queueing every credential it referenced.
fn delete_profile_in(
    connection: &Connection,
    profile_id: &str,
    now_ms: i64,
) -> Result<(), CliProfilesError> {
    let profile =
        select_profile(connection, profile_id)?.ok_or(CliProfilesError::ProfileNotFound)?;
    let accounts = profile
        .environment
        .iter()
        .filter_map(
            // Cascade deletion removes the rows, so the references must be queued first.
            |entry| entry.credential_account.clone(),
        )
        .collect::<Vec<_>>();
    enqueue_cleanup(connection, &accounts, now_ms)?;
    let affected = connection.execute(
        "DELETE FROM cli_profiles WHERE id = ?1",
        params![profile_id],
    )?;
    if affected == 0 {
        return Err(CliProfilesError::ProfileNotFound);
    }
    Ok(())
}

/// Reads one persisted profile together with its ordered environment rows.
fn select_profile(
    connection: &Connection,
    profile_id: &str,
) -> Result<Option<StoredProfile>, CliProfilesError> {
    let row = connection
        .query_row(
            "SELECT name, command, arguments_json, shell_id, icon, color, \
             created_at_ms, updated_at_ms FROM cli_profiles WHERE id = ?1",
            params![profile_id],
            // Copies every untrusted scalar so decoding runs after the borrow ends.
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((name, command, arguments_json, shell_id, icon, color, created, updated)) = row else {
        return Ok(None);
    };

    let mut statement = connection.prepare(
        "SELECT name, value, is_secret, credential_account FROM cli_profile_environment \
         WHERE profile_id = ?1 ORDER BY position",
    )?;
    let environment = statement
        .query_map(
            params![profile_id],
            // Copies every untrusted environment scalar for later validation.
            |row| {
                Ok(StoredEnvironment {
                    name: row.get(0)?,
                    value: row.get(1)?,
                    is_secret: row.get::<_, i64>(2)? == 1,
                    credential_account: row.get(3)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Some(StoredProfile {
        id: profile_id.to_owned(),
        name,
        command,
        arguments: decode_arguments(&arguments_json)?,
        shell_id,
        icon,
        color,
        environment,
        created_at_ms: created,
        updated_at_ms: updated,
    }))
}

/// Counts the persisted custom profiles for the documented capacity limit.
fn count_profiles(connection: &Connection) -> Result<usize, CliProfilesError> {
    let count = connection.query_row(
        "SELECT COUNT(*) FROM cli_profiles",
        [],
        // Decodes the aggregate profile count.
        |row| row.get::<_, i64>(0),
    )?;
    usize::try_from(count).map_err(
        // A negative count would mean the aggregate itself is corrupt.
        |_| CliProfilesError::PersistenceFailed,
    )
}

/// Persists the singleton default shell selection.
fn write_default_shell(connection: &Connection, shell_id: &str) -> Result<(), CliProfilesError> {
    let affected = connection.execute(
        "UPDATE cli_profile_settings SET default_shell_id = ?1 WHERE id = 1",
        params![shell_id],
    )?;
    if affected != 1 {
        return Err(CliProfilesError::PersistenceFailed);
    }
    Ok(())
}

/// Queues every supplied credential reference for post-commit deletion.
fn enqueue_cleanup(
    connection: &Connection,
    accounts: &[String],
    now_ms: i64,
) -> Result<(), CliProfilesError> {
    for account in accounts {
        connection.execute(
            "INSERT INTO credential_cleanup_queue (credential_account, queued_at_ms) \
             VALUES (?1, ?2) ON CONFLICT(credential_account) DO NOTHING",
            params![account, now_ms.max(0)],
        )?;
    }
    Ok(())
}

/// Reads every queued credential reference in a stable order.
fn select_cleanup_accounts(connection: &Connection) -> Result<Vec<String>, CliProfilesError> {
    let mut statement = connection.prepare(
        "SELECT credential_account FROM credential_cleanup_queue \
         ORDER BY queued_at_ms ASC, credential_account ASC",
    )?;
    let accounts = statement
        .query_map(
            [],
            // Decodes one queued credential reference.
            |row| row.get::<_, String>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(accounts)
}

/// Removes one queue row after its credential is provably gone.
fn delete_cleanup_row(connection: &Connection, account: &str) -> Result<(), CliProfilesError> {
    connection.execute(
        "DELETE FROM credential_cleanup_queue WHERE credential_account = ?1",
        params![account],
    )?;
    Ok(())
}

/// Reports the current display name and launch availability of one profile.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CliProfileLaunchability {
    pub id: String,
    pub display_name: String,
    pub is_available: bool,
}

/// Describes how the terminal capability must start one resolved profile.
///
/// The type derives neither `Serialize`, `Debug`, nor `Clone` because it is
/// only ever handed to the launch adapter together with resolved secrets.
pub enum ResolvedCliLaunchKind {
    InteractiveShell {
        shell: ResolvedShell,
    },
    Command {
        shell: ResolvedShell,
        executable: String,
        arguments: Vec<String>,
    },
}

/// Describes one fully resolved profile immediately before a process launch.
///
/// The type derives neither `Serialize`, `Debug`, nor `Clone` so plaintext
/// secrets cannot reach a log, a clone, or an outgoing payload.
pub struct ResolvedCliProfile {
    pub profile_id: String,
    pub display_name: String,
    pub launch_kind: ResolvedCliLaunchKind,
    pub environment: Vec<(String, Zeroizing<String>)>,
}

/// Holds everything one availability check needs outside the mutation lock.
#[derive(Clone, Debug, PartialEq, Eq)]
struct CheckTarget {
    profile_id: String,
    display_name: String,
    command: Option<String>,
    shell_id: String,
    arguments: Vec<String>,
    generation: u64,
}

impl CliProfilesService {
    /// Rechecks one profile without executing its command.
    pub async fn check_profile(&self, profile_id: &str) -> Result<CliProfileDto, CliProfilesError> {
        self.initialize().await?;
        let target = {
            // The configuration and its generation are snapshotted under the lock only.
            let _mutation = self.inner.mutation_lock.lock().await;
            self.with_cache(|cache| check_target(cache, profile_id))?
                .ok_or(CliProfilesError::ProfileNotFound)?
        };

        let status = self.resolve_availability(&target).await?;
        let now_ms = self.inner.clock.now_ms()?;

        let _mutation = self.inner.mutation_lock.lock().await;
        // A configuration change during the check makes this result stale.
        if self.with_cache(|cache| cache.generation)? != target.generation {
            return self.profile_dto(profile_id);
        }
        let id = target.profile_id.clone();
        let snapshot = self.commit_change(
            CliProfilesChangeKindDto::AvailabilityChanged,
            Some(id.clone()),
            false,
            // Only the runtime cache changes, so nothing is persisted here.
            move |state| {
                state.availability.insert(
                    id,
                    AvailabilityState {
                        status,
                        checked_at_ms: Some(now_ms),
                    },
                );
            },
        )?;
        snapshot
            .profiles
            .into_iter()
            .find(
                // The freshly published snapshot always contains the checked profile.
                |profile| profile.id == target.profile_id,
            )
            .ok_or(CliProfilesError::ProfileNotFound)
    }

    /// Resolves the current display name and launch availability for Sessions.
    pub async fn launchability(
        &self,
        profile_id: &str,
    ) -> Result<CliProfileLaunchability, CliProfilesError> {
        self.initialize().await?;
        let target = self
            .with_cache(|cache| check_target(cache, profile_id))?
            .ok_or(CliProfilesError::ProfileNotFound)?;

        // Availability is re-resolved instead of trusted from the runtime cache.
        let status = self.resolve_availability(&target).await?;
        Ok(CliProfileLaunchability {
            id: target.profile_id,
            display_name: target.display_name,
            is_available: status == CliProfileAvailabilityStatusDto::Available,
        })
    }

    /// Resolves one structured profile and its secrets before a process launch.
    pub async fn resolve_for_launch(
        &self,
        profile_id: &str,
    ) -> Result<ResolvedCliProfile, CliProfilesError> {
        self.initialize().await?;
        let target = self
            .with_cache(|cache| check_target(cache, profile_id))?
            .ok_or(CliProfilesError::ProfileNotFound)?;
        let environment = self.with_cache(|cache| launch_environment(cache, profile_id))?;

        // The effective shell is rechecked so a removed shell blocks the whole launch.
        let shell = self.resolve_shell(&target.shell_id).await?;
        let launch_kind = match &target.command {
            None => ResolvedCliLaunchKind::InteractiveShell { shell },
            Some(command) => {
                let executable = self.resolve_command(command).await?;
                ResolvedCliLaunchKind::Command {
                    shell,
                    executable,
                    arguments: target.arguments,
                }
            }
        };

        // Secrets are read only here, and a single failure blocks the entire launch.
        let environment = self.read_launch_environment(environment).await?;
        Ok(ResolvedCliProfile {
            profile_id: target.profile_id,
            display_name: target.display_name,
            launch_kind,
            environment,
        })
    }

    /// Subscribes one backend consumer to every committed cache revision.
    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<u64> {
        self.inner.revisions.subscribe()
    }

    /// Returns the shared semaphore that caps concurrent availability checks.
    #[doc(hidden)]
    pub fn check_concurrency_limit(&self) -> Arc<Semaphore> {
        self.inner.check_limit.clone()
    }

    /// Resolves one profile's availability on the bounded blocking pool.
    async fn resolve_availability(
        &self,
        target: &CheckTarget,
    ) -> Result<CliProfileAvailabilityStatusDto, CliProfilesError> {
        let _permit = self
            .inner
            .check_limit
            .clone()
            .acquire_owned()
            .await
            .map_err(
                // A closed semaphore means the application is shutting down.
                |_| CliProfilesError::CommandResolutionFailed,
            )?;
        let shells = self.inner.shells.clone();
        let commands = self.inner.commands.clone();
        let shell_id = target.shell_id.clone();
        let command = target.command.clone();

        tauri::async_runtime::spawn_blocking(
            // Discovery inspects the filesystem and never executes a candidate.
            move || {
                match shells.resolve(&shell_id) {
                    Ok(_) => {}
                    Err(ShellResolutionError::Inspection) => {
                        return Err(CliProfilesError::CommandResolutionFailed);
                    }
                    // A missing shell is a successful status, not an inspection failure.
                    Err(_) => return Ok(CliProfileAvailabilityStatusDto::ShellNotFound),
                }
                let Some(command) = command else {
                    return Ok(CliProfileAvailabilityStatusDto::Available);
                };
                match commands.resolve(&command) {
                    Ok(_) => Ok(CliProfileAvailabilityStatusDto::Available),
                    Err(CommandResolutionError::Inspection) => {
                        Err(CliProfilesError::CommandResolutionFailed)
                    }
                    Err(_) => Ok(CliProfileAvailabilityStatusDto::CommandNotFound),
                }
            },
        )
        .await
        .map_err(
            // A cancelled worker preserves the previous status instead of guessing.
            |_| CliProfilesError::CommandResolutionFailed,
        )?
    }

    /// Resolves one command candidate for a launch and maps its failure.
    async fn resolve_command(&self, command: &str) -> Result<String, CliProfilesError> {
        let commands = self.inner.commands.clone();
        let candidate = command.to_owned();
        let resolved = tauri::async_runtime::spawn_blocking(
            // Discovery inspects the filesystem and must not block the runtime.
            move || commands.resolve(&candidate),
        )
        .await
        .map_err(
            // A cancelled worker is an inspection failure, never a missing command.
            |_| CliProfilesError::CommandResolutionFailed,
        )?
        .map_err(
            // Only an inspection failure is an error; absence blocks the launch too.
            |error| match error {
                CommandResolutionError::Inspection => CliProfilesError::CommandResolutionFailed,
                _ => CliProfilesError::CommandNotFound,
            },
        )?;

        resolved.to_str().map(str::to_owned).ok_or(
            // A path that is not valid Unicode fails closed instead of being corrupted.
            CliProfilesError::CommandNotFound,
        )
    }

    /// Reads every required secret into zeroizing buffers on a blocking worker.
    async fn read_launch_environment(
        &self,
        entries: Vec<LaunchEnvironmentEntry>,
    ) -> Result<Vec<(String, Zeroizing<String>)>, CliProfilesError> {
        if entries.is_empty() {
            return Ok(Vec::new());
        }
        let credentials = self.inner.credentials.clone();
        tauri::async_runtime::spawn_blocking(
            // Credential reads are blocking and happen only immediately before a launch.
            move || {
                let mut resolved = Vec::with_capacity(entries.len());
                for entry in entries {
                    match entry {
                        LaunchEnvironmentEntry::Plain { name, value } => {
                            resolved.push((name, Zeroizing::new(value)));
                        }
                        LaunchEnvironmentEntry::Secret { name, account } => {
                            // A single missing or unreadable secret blocks the whole launch.
                            let secret =
                                credentials.read_secret(&account).map_err(map_read_error)?;
                            resolved.push((name, secret));
                        }
                    }
                }
                Ok(resolved)
            },
        )
        .await
        .map_err(
            // A cancelled worker never returns a partial launch description.
            |_| CliProfilesError::SecretReadFailed,
        )?
    }

    /// Returns one profile's current DTO without changing any cached state.
    fn profile_dto(&self, profile_id: &str) -> Result<CliProfileDto, CliProfilesError> {
        self.with_cache(|cache| {
            cache.to_dto().profiles.into_iter().find(
                // The cached snapshot always contains every known profile.
                |profile| profile.id == profile_id,
            )
        })?
        .ok_or(CliProfilesError::ProfileNotFound)
    }
}

/// Describes one launch environment entry before its secret is resolved.
enum LaunchEnvironmentEntry {
    Plain { name: String, value: String },
    Secret { name: String, account: String },
}

/// Builds the ordered launch environment description of one profile.
fn launch_environment(cache: &CacheState, profile_id: &str) -> Vec<LaunchEnvironmentEntry> {
    cache
        .profiles
        .iter()
        .find(
            // Built-in profiles carry no environment of their own.
            |profile| profile.id == profile_id,
        )
        .map(|profile| {
            profile
                .environment
                .iter()
                .map(
                    // A secret entry becomes a credential reference resolved later.
                    |entry| match (&entry.value, &entry.credential_account) {
                        (Some(value), _) => LaunchEnvironmentEntry::Plain {
                            name: entry.name.clone(),
                            value: value.clone(),
                        },
                        (None, Some(account)) => LaunchEnvironmentEntry::Secret {
                            name: entry.name.clone(),
                            account: account.clone(),
                        },
                        (None, None) => LaunchEnvironmentEntry::Plain {
                            name: entry.name.clone(),
                            value: String::new(),
                        },
                    },
                )
                .collect()
        })
        .unwrap_or_default()
}

/// Snapshots everything one check or launch needs about a single profile.
fn check_target(cache: &CacheState, profile_id: &str) -> Option<CheckTarget> {
    if let Some(built_in) = BUILT_IN_PROFILES
        .iter()
        .find(|built_in| built_in.id == profile_id)
    {
        return Some(CheckTarget {
            profile_id: built_in.id.to_owned(),
            display_name: built_in.name.to_owned(),
            command: built_in.command.map(str::to_owned),
            shell_id: cache.effective_default_shell_id.clone(),
            arguments: Vec::new(),
            generation: cache.generation,
        });
    }

    cache
        .profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .map(|profile| CheckTarget {
            profile_id: profile.id.clone(),
            display_name: profile.name.clone(),
            command: Some(profile.command.clone()),
            shell_id: cache.effective_shell_of(profile),
            arguments: profile.arguments.clone(),
            generation: cache.generation,
        })
}

impl CliProfilesService {
    /// Hydrates, drains the cleanup queue, and rechecks every profile once.
    ///
    /// A hydration failure is returned so startup can report it without
    /// publishing a fallback cache, while recoverable cleanup and discovery
    /// failures only emit a sanitized diagnostic.
    pub async fn run_startup(&self) -> Result<(), CliProfilesError> {
        self.initialize().await?;

        if let Err(error) = self.retry_credential_cleanup().await {
            // The queue row stays durable, so the next retry can still remove it.
            eprintln!("cli profile credential cleanup deferred at startup: {error}");
        }
        for error in self.run_startup_checks().await {
            // A discovery failure leaves the affected status unchecked and retryable.
            eprintln!("cli profile availability check failed at startup: {error}");
        }
        Ok(())
    }

    /// Rechecks every known profile and returns each failure that occurred.
    #[doc(hidden)]
    pub async fn run_startup_checks(&self) -> Vec<CliProfilesError> {
        let Ok(ids) = self.with_cache(|cache| {
            BUILT_IN_PROFILES
                .iter()
                .map(|built_in| built_in.id.to_owned())
                .chain(cache.profiles.iter().map(
                    // Custom profiles are rechecked in their stable display order.
                    |profile| profile.id.clone(),
                ))
                .collect::<Vec<_>>()
        }) else {
            return Vec::new();
        };

        let mut handles = Vec::with_capacity(ids.len());
        for id in ids {
            let service = self.clone();
            handles.push(tauri::async_runtime::spawn(
                // The shared semaphore bounds how many of these run at once.
                async move { service.check_profile(&id).await.err() },
            ));
        }

        let mut failures = Vec::new();
        for handle in handles {
            if let Ok(Some(error)) = handle.await {
                failures.push(error);
            }
        }
        failures
    }
}

/// Restricts every CLI profile command to the exact main window label.
fn authorize_main_caller(label: &str) -> Result<(), CliProfilesError> {
    if label == "main" {
        Ok(())
    } else {
        Err(CliProfilesError::UnauthorizedWindow)
    }
}

/// Clones the managed service so no state borrow is held across an await.
fn take_service(state: State<'_, CliProfilesService>) -> CliProfilesService {
    state.inner().clone()
}

/// Returns the current CLI profiles and shell catalog snapshot.
#[tauri::command]
pub(crate) async fn get_cli_profiles<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CliProfilesService>,
) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
    authorize_main_caller(window.label())?;
    take_service(state).snapshot().await
}

/// Creates one custom CLI profile.
#[tauri::command]
pub(crate) async fn create_cli_profile<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CliProfilesService>,
    input: CliProfileInputDto,
) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
    authorize_main_caller(window.label())?;
    take_service(state).create_profile(input).await
}

/// Replaces the configuration of one custom CLI profile.
#[tauri::command]
pub(crate) async fn update_cli_profile<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CliProfilesService>,
    profile_id: String,
    input: CliProfileInputDto,
) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
    authorize_main_caller(window.label())?;
    take_service(state).update_profile(&profile_id, input).await
}

/// Deletes one custom CLI profile and schedules credential cleanup.
#[tauri::command]
pub(crate) async fn delete_cli_profile<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CliProfilesService>,
    profile_id: String,
) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
    authorize_main_caller(window.label())?;
    take_service(state).delete_profile(&profile_id).await
}

/// Selects the global default shell.
#[tauri::command]
pub(crate) async fn set_default_cli_shell<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CliProfilesService>,
    shell_id: String,
) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
    authorize_main_caller(window.label())?;
    take_service(state).set_default_shell(&shell_id).await
}

/// Rechecks one profile without executing its command.
#[tauri::command]
pub(crate) async fn check_cli_profile<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, CliProfilesService>,
    profile_id: String,
) -> Result<CliProfileDto, CliProfilesError> {
    authorize_main_caller(window.label())?;
    take_service(state).check_profile(&profile_id).await
}

/// Carries the CLI profiles section of one coordinator backup snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliProfilesBackupV1 {
    pub default_shell_id: String,
    pub custom_profiles: Vec<CliProfileBackupRecordV1>,
}

/// Carries one custom profile's metadata without any secret value.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliProfileBackupRecordV1 {
    pub id: String,
    pub name: String,
    pub command: String,
    pub arguments: Vec<String>,
    pub shell_id: Option<String>,
    pub icon: String,
    pub color: String,
    pub environment: Vec<CliEnvironmentBackupRecordV1>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// Carries one environment entry as a literal value or an opaque reference.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CliEnvironmentBackupRecordV1 {
    Plain {
        name: String,
        value: String,
    },
    SecretReference {
        name: String,
        credential_account: String,
    },
}

/// Reports how one prepared merge would change the persisted profiles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CliProfilesImportCounts {
    pub inserts: u32,
    pub updates: u32,
    pub unchanged: u32,
}

/// Owns one fully validated profile merge and its post-commit projection.
#[derive(Clone, Debug)]
pub struct CliProfilesImportPlan {
    pub counts: CliProfilesImportCounts,
    default_shell_id: String,
    writes: Vec<StoredProfile>,
    removed_accounts: Vec<String>,
    projection: CliProfilesCommittedProjection,
}

/// Owns the cache projection that may be published only after commit.
#[derive(Clone, Debug)]
pub struct CliProfilesCommittedProjection {
    default_shell_id: String,
    profiles: Vec<StoredProfile>,
}

impl CliProfilesService {
    /// Exports profile metadata from the coordinator-owned transaction.
    pub fn export_cli_profiles_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<CliProfilesBackupV1, CliProfilesError> {
        let persisted = read_persisted_state(tx)?;
        Ok(CliProfilesBackupV1 {
            default_shell_id: persisted.default_shell_id,
            custom_profiles: persisted
                .profiles
                .into_iter()
                .map(
                    // Only persisted metadata is exported; no secret value is ever read.
                    |profile| CliProfileBackupRecordV1 {
                        id: profile.id,
                        name: profile.name,
                        command: profile.command,
                        arguments: profile.arguments,
                        shell_id: profile.shell_id,
                        icon: profile.icon,
                        color: profile.color,
                        environment: profile
                            .environment
                            .into_iter()
                            .map(
                                // A secret entry exports its opaque reference only.
                                |entry| match (entry.value, entry.credential_account) {
                                    (Some(value), _) => CliEnvironmentBackupRecordV1::Plain {
                                        name: entry.name,
                                        value,
                                    },
                                    (None, Some(credential_account)) => {
                                        CliEnvironmentBackupRecordV1::SecretReference {
                                            name: entry.name,
                                            credential_account,
                                        }
                                    }
                                    (None, None) => CliEnvironmentBackupRecordV1::Plain {
                                        name: entry.name,
                                        value: String::new(),
                                    },
                                },
                            )
                            .collect(),
                        created_at_ms: profile.created_at_ms,
                        updated_at_ms: profile.updated_at_ms,
                    },
                )
                .collect(),
        })
    }

    /// Validates and prepares one metadata-only profile merge.
    pub fn prepare_cli_profiles_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        incoming: &CliProfilesBackupV1,
    ) -> Result<CliProfilesImportPlan, CliProfilesError> {
        let catalog = self.catalog_ids()?;
        let local = read_persisted_state(tx)?;
        let local_by_id = local
            .profiles
            .iter()
            .map(
                // Local rows are indexed so each incoming record can be compared once.
                |profile| (profile.id.clone(), profile.clone()),
            )
            .collect::<HashMap<_, _>>();
        // Every credential reference already belongs to exactly one local profile.
        let owner_by_account = local
            .profiles
            .iter()
            .flat_map(|profile| {
                profile.environment.iter().filter_map(move |entry| {
                    entry
                        .credential_account
                        .clone()
                        .map(|account| (account, profile.id.clone()))
                })
            })
            .collect::<HashMap<_, _>>();

        let default_shell_id = normalize_backup_shell(incoming.default_shell_id.as_str(), &catalog)
            .unwrap_or_else(|| SYSTEM_SHELL_ID.to_owned());

        let mut counts = CliProfilesImportCounts::default();
        let mut writes = Vec::new();
        let mut merged = Vec::with_capacity(incoming.custom_profiles.len());
        let mut claimed_ids = HashSet::new();
        let mut claimed_accounts = HashSet::new();

        for record in &incoming.custom_profiles {
            let profile = validated_backup_profile(record, &catalog)?;
            if !claimed_ids.insert(profile.id.clone()) {
                // Two incoming records naming one profile cannot both be committed.
                return Err(CliProfilesError::PersistenceFailed);
            }
            for account in profile.environment.iter().filter_map(
                // Only secret entries carry a credential reference to check.
                |entry| entry.credential_account.as_ref(),
            ) {
                if !claimed_accounts.insert(account.clone()) {
                    return Err(CliProfilesError::PersistenceFailed);
                }
                // A reference owned by a different profile would alias one credential.
                if owner_by_account
                    .get(account)
                    .is_some_and(|owner| owner != &profile.id)
                {
                    return Err(CliProfilesError::PersistenceFailed);
                }
            }

            match local_by_id.get(&profile.id) {
                Some(existing) if existing == &profile => counts.unchanged += 1,
                Some(_) => {
                    counts.updates += 1;
                    writes.push(profile.clone());
                }
                None => {
                    counts.inserts += 1;
                    writes.push(profile.clone());
                }
            }
            merged.push(profile);
        }

        // Only references the merge actually drops may be queued for deletion.
        let retained = claimed_accounts;
        let removed_accounts = local
            .profiles
            .iter()
            .filter(
                // A local profile outside the backup keeps every credential it owns.
                |profile| claimed_ids.contains(&profile.id),
            )
            .flat_map(|profile| {
                profile.environment.iter().filter_map(
                    // Only secret entries can leave a reference behind.
                    |entry| entry.credential_account.clone(),
                )
            })
            .filter(|account| !retained.contains(account))
            .collect::<Vec<_>>();

        let mut projected = local
            .profiles
            .into_iter()
            .filter(
                // Replaced rows are re-added from the already validated merge.
                |profile| !claimed_ids.contains(&profile.id),
            )
            .collect::<Vec<_>>();
        projected.extend(merged);
        projected.sort_by(compare_profile_order);

        Ok(CliProfilesImportPlan {
            counts,
            default_shell_id: default_shell_id.clone(),
            writes,
            removed_accounts,
            projection: CliProfilesCommittedProjection {
                default_shell_id,
                profiles: projected,
            },
        })
    }

    /// Applies one prepared merge inside the coordinator transaction.
    pub fn apply_cli_profiles_merge_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
        plan: &CliProfilesImportPlan,
    ) -> Result<CliProfilesCommittedProjection, CliProfilesError> {
        // The clock is synchronous, so the shared transaction still gets a real time.
        let now_ms = self.inner.clock.now_ms().unwrap_or_default();
        write_default_shell(tx, &plan.default_shell_id)?;
        for profile in &plan.writes {
            write_profile_rows(tx, profile)?;
        }
        // The coordinator commits first; cleanup retries only after the write permit.
        enqueue_cleanup(tx, &plan.removed_accounts, now_ms)?;
        Ok(plan.projection.clone())
    }

    /// Resets custom profiles and the default shell in the shared transaction.
    pub fn reset_cli_profiles_in(
        &self,
        tx: &rusqlite::Transaction<'_>,
    ) -> Result<CliProfilesCommittedProjection, CliProfilesError> {
        let local = read_persisted_state(tx)?;
        let accounts = local
            .profiles
            .iter()
            .flat_map(|profile| {
                profile.environment.iter().filter_map(
                    // Every cleared reference must survive the reset as a queue row.
                    |entry| entry.credential_account.clone(),
                )
            })
            .collect::<Vec<_>>();
        let now_ms = self.inner.clock.now_ms().unwrap_or_default();
        enqueue_cleanup(tx, &accounts, now_ms)?;
        tx.execute("DELETE FROM cli_profiles", [])?;
        write_default_shell(tx, SYSTEM_SHELL_ID)?;
        Ok(CliProfilesCommittedProjection {
            default_shell_id: SYSTEM_SHELL_ID.to_owned(),
            profiles: Vec::new(),
        })
    }

    /// Publishes one already committed owner projection without any query.
    pub fn publish_data_change(&self, projection: CliProfilesCommittedProjection) {
        let published = {
            let Ok(mut cache) = self.inner.cache.write() else {
                return;
            };
            let Some(state) = cache.as_mut() else {
                return;
            };
            state.default_shell_id = projection.default_shell_id;
            // The effective identifier is recomputed from already resolved shell state.
            state.effective_default_shell_id =
                effective_from_cached_shells(&state.shells, &state.default_shell_id);
            state.availability.clear();
            for built_in in &BUILT_IN_PROFILES {
                state
                    .availability
                    .insert(built_in.id.to_owned(), AvailabilityState::unchecked());
            }
            for profile in &projection.profiles {
                state
                    .availability
                    .insert(profile.id.clone(), AvailabilityState::unchecked());
            }
            state.profiles = projection.profiles;
            state.revision = state.revision.wrapping_add(1);
            state.generation = state.generation.wrapping_add(1);
            // Internal backend subscribers are notified without any failure path.
            let _ = self.inner.revisions.send(state.revision);
            state.revision
        };

        // A bulk change is one invalidation, so every consumer reloads the snapshot.
        let _ = self.inner.events.publish(CliProfilesChangedDto {
            revision: published.to_string(),
            kind: CliProfilesChangeKindDto::Updated,
            profile_id: None,
        });
    }
}

/// Returns the concrete effective shell implied by already resolved catalog state.
fn effective_from_cached_shells(shells: &[ShellState], default_shell_id: &str) -> String {
    if default_shell_id != SYSTEM_SHELL_ID {
        return default_shell_id.to_owned();
    }
    shells
        .iter()
        .find(
            // The sentinel follows the first concrete catalog entry that resolves.
            |shell| shell.id != SYSTEM_SHELL_ID && shell.is_available,
        )
        .or_else(|| shells.iter().find(|shell| shell.id != SYSTEM_SHELL_ID))
        .map_or_else(|| SYSTEM_SHELL_ID.to_owned(), |shell| shell.id.clone())
}

/// Maps one incoming shell identifier onto a usable local selection.
fn normalize_backup_shell(shell_id: &str, catalog: &[String]) -> Option<String> {
    if shell_id == SYSTEM_SHELL_ID {
        return Some(SYSTEM_SHELL_ID.to_owned());
    }
    catalog
        .iter()
        .find(
            // A shell that does not exist on this platform cannot be selected.
            |known| known.as_str() == shell_id,
        )
        .cloned()
}

/// Validates one incoming backup record into a persistable profile row.
fn validated_backup_profile(
    record: &CliProfileBackupRecordV1,
    catalog: &[String],
) -> Result<StoredProfile, CliProfilesError> {
    validate_profile_id(&record.id)?;
    validate_name(&record.name)?;
    validate_command(&record.command)?;
    validate_arguments(&record.arguments)?;
    validate_icon(&record.icon)?;
    validate_color(&record.color)?;
    if record.environment.len() > MAX_ENVIRONMENT_ENTRIES {
        return Err(CliProfilesError::TooManyEnvironmentVariables);
    }
    if record.created_at_ms < 0 || record.updated_at_ms < record.created_at_ms {
        return Err(CliProfilesError::PersistenceFailed);
    }

    let mut seen = HashSet::new();
    let mut environment = Vec::with_capacity(record.environment.len());
    for entry in &record.environment {
        let name = match entry {
            CliEnvironmentBackupRecordV1::Plain { name, .. } => name,
            CliEnvironmentBackupRecordV1::SecretReference { name, .. } => name,
        };
        validate_environment_name(name)?;
        if !seen.insert(name.to_ascii_lowercase()) {
            return Err(CliProfilesError::DuplicateEnvironmentName);
        }
        environment.push(match entry {
            CliEnvironmentBackupRecordV1::Plain { name, value } => {
                validate_environment_value(value)?;
                StoredEnvironment {
                    name: name.clone(),
                    value: Some(value.clone()),
                    is_secret: false,
                    credential_account: None,
                }
            }
            // A foreign reference stays metadata; the missing value surfaces at launch.
            CliEnvironmentBackupRecordV1::SecretReference {
                name,
                credential_account,
            } => {
                if credential_account.is_empty() {
                    return Err(CliProfilesError::PersistenceFailed);
                }
                StoredEnvironment {
                    name: name.clone(),
                    value: None,
                    is_secret: true,
                    credential_account: Some(credential_account.clone()),
                }
            }
        });
    }

    Ok(StoredProfile {
        id: record.id.clone(),
        name: record.name.trim().to_owned(),
        command: record.command.trim().to_owned(),
        arguments: record.arguments.clone(),
        // An identifier that does not exist locally falls back to the global default.
        shell_id: record
            .shell_id
            .as_deref()
            .and_then(|shell_id| normalize_backup_shell(shell_id, catalog))
            .filter(|shell_id| shell_id != SYSTEM_SHELL_ID),
        icon: record.icon.trim().to_owned(),
        color: record.color.clone(),
        environment,
        created_at_ms: record.created_at_ms,
        updated_at_ms: record.updated_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds one valid environment input entry for validation tests.
    fn environment_entry(
        name: &str,
        value: Option<&str>,
        is_secret: bool,
    ) -> CliProfileEnvironmentInputDto {
        CliProfileEnvironmentInputDto {
            name: name.to_owned(),
            value: value.map(str::to_owned),
            is_secret,
        }
    }

    /// Builds one otherwise valid profile input for validation tests.
    fn valid_input() -> CliProfileInputDto {
        CliProfileInputDto {
            name: "Fixture".to_owned(),
            command: "fixture-tool".to_owned(),
            arguments: vec!["--flag".to_owned(), "one two".to_owned()],
            shell_id: None,
            icon: "Fx".to_owned(),
            color: "#112233".to_owned(),
            environment: vec![environment_entry("TOKEN", Some("value"), false)],
        }
    }

    /// Returns the fixture shell catalog identifiers used by validation tests.
    fn catalog() -> Vec<String> {
        vec![
            "system".to_owned(),
            "pwsh".to_owned(),
            "windows-powershell".to_owned(),
            "cmd".to_owned(),
        ]
    }

    /// Validates one input against the fixture catalog.
    fn validate(input: CliProfileInputDto) -> Result<ValidatedProfileInput, CliProfilesError> {
        validate_input(input, &catalog())
    }

    /// Validates one input and discards the secret-bearing success value.
    fn validate_error(input: CliProfileInputDto) -> Result<(), CliProfilesError> {
        validate(input).map(
            // The validated value must never reach an assertion message.
            |_| (),
        )
    }

    /// Verifies the exact built-in identity, order, and presentation metadata.
    #[test]
    fn built_in_profiles_match_the_contract() {
        let ids = BUILT_IN_PROFILES
            .iter()
            .map(
                // Only identifiers matter for the stable ordering assertion.
                |built_in| built_in.id,
            )
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec!["builtin:codex", "builtin:claude", "builtin:terminal"]
        );
        assert_eq!(BUILT_IN_PROFILES[0].command, Some("codex"));
        assert_eq!(BUILT_IN_PROFILES[1].command, Some("claude"));
        assert_eq!(BUILT_IN_PROFILES[2].command, None);
        assert_eq!(BUILT_IN_PROFILES[0].icon, "Cx");
        assert_eq!(BUILT_IN_PROFILES[1].color, "#d97757");
        assert_eq!(BUILT_IN_PROFILES[2].icon, ">_");
        assert!(is_built_in("builtin:terminal"));
        assert!(!is_built_in("profile-00000001-0000-4000-8000-000000000000"));
    }

    /// Verifies that display names honour the trimmed Unicode scalar limits.
    #[test]
    fn name_limits_are_enforced_in_unicode_scalars() {
        let mut input = valid_input();
        input.name = format!("  {}  ", "é".repeat(MAX_NAME_SCALARS));
        assert!(validate(input).is_ok());

        let mut input = valid_input();
        input.name = "é".repeat(MAX_NAME_SCALARS + 1);
        assert_eq!(validate_error(input), Err(CliProfilesError::InvalidName));

        for invalid in ["", "   ", "bad\nname", "bad\u{0}name"] {
            let mut input = valid_input();
            input.name = invalid.to_owned();
            assert_eq!(
                validate_error(input),
                Err(CliProfilesError::InvalidName),
                "name {invalid:?} should be rejected"
            );
        }
    }

    /// Verifies that only a bare name or an absolute path is accepted as a command.
    #[test]
    fn command_accepts_only_bare_names_and_absolute_paths() {
        for accepted in ["codex", "fixture-tool.exe", "C:\\Tools\\tool.exe"] {
            let mut input = valid_input();
            input.command = accepted.to_owned();
            assert!(
                validate(input).is_ok(),
                "command {accepted:?} should be accepted"
            );
        }
        for rejected in [
            "",
            "  ",
            "tools\\tool.exe",
            "./tool",
            "~/tool",
            "%SystemRoot%\\tool.exe",
            "$SHELL",
            "tool --flag",
            "tool\u{0}",
            &"a".repeat(MAX_COMMAND_BYTES + 1),
        ] {
            let mut input = valid_input();
            input.command = rejected.to_owned();
            assert_eq!(
                validate_error(input),
                Err(CliProfilesError::InvalidCommand),
                "command {rejected:?} should be rejected"
            );
        }
    }

    /// Verifies every documented argument count, size, and content limit.
    #[test]
    fn argument_limits_are_enforced() {
        let mut input = valid_input();
        input.arguments = vec!["a".to_owned(); MAX_ARGUMENTS];
        assert!(validate(input).is_ok());

        let mut input = valid_input();
        input.arguments = vec!["a".to_owned(); MAX_ARGUMENTS + 1];
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::InvalidArguments)
        );

        let mut input = valid_input();
        input.arguments = vec!["a".repeat(MAX_ARGUMENT_BYTES + 1)];
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::InvalidArguments)
        );

        let mut input = valid_input();
        // Sixteen arguments of four kibibytes reach exactly the documented total.
        input.arguments = vec!["a".repeat(MAX_ARGUMENT_BYTES); 8];
        assert!(validate(input).is_ok());

        let mut input = valid_input();
        input.arguments = vec!["a".repeat(MAX_ARGUMENT_BYTES); 9];
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::InvalidArguments)
        );

        let mut input = valid_input();
        input.arguments = vec!["bad\u{0}argument".to_owned()];
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::InvalidArguments)
        );
    }

    /// Verifies icon and colour syntax rules including lowercase hexadecimal.
    #[test]
    fn icon_and_colour_rules_are_enforced() {
        let mut input = valid_input();
        input.icon = "é".repeat(MAX_ICON_SCALARS);
        assert!(validate(input).is_ok());

        for invalid in ["", "   ", &"a".repeat(MAX_ICON_SCALARS + 1), "bad\u{7}"] {
            let mut input = valid_input();
            input.icon = invalid.to_owned();
            assert_eq!(validate_error(input), Err(CliProfilesError::InvalidIcon));
        }

        for invalid in ["#11223G", "#ABCDEF", "112233", "#1122", "#11223344"] {
            let mut input = valid_input();
            input.color = invalid.to_owned();
            assert_eq!(
                validate_error(input),
                Err(CliProfilesError::InvalidColor),
                "colour {invalid:?} should be rejected"
            );
        }
    }

    /// Verifies environment naming, duplication, count, and value limits.
    #[test]
    fn environment_rules_are_enforced() {
        let mut input = valid_input();
        input.environment = (0..MAX_ENVIRONMENT_ENTRIES)
            .map(
                // Every fixture entry is a distinct valid non-secret variable.
                |index| environment_entry(&format!("VAR_{index}"), Some(""), false),
            )
            .collect();
        assert!(validate(input).is_ok());

        let mut input = valid_input();
        input.environment = (0..MAX_ENVIRONMENT_ENTRIES + 1)
            .map(|index| environment_entry(&format!("VAR_{index}"), Some(""), false))
            .collect();
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::TooManyEnvironmentVariables)
        );

        for invalid in ["", "1VAR", "VA R", "VAR-NAME", "VÁR"] {
            let mut input = valid_input();
            input.environment = vec![environment_entry(invalid, Some(""), false)];
            assert_eq!(
                validate_error(input),
                Err(CliProfilesError::InvalidEnvironmentName),
                "environment name {invalid:?} should be rejected"
            );
        }

        // Duplicates are compared without ASCII case so Windows semantics hold.
        let mut input = valid_input();
        input.environment = vec![
            environment_entry("TOKEN", Some("a"), false),
            environment_entry("token", Some("b"), false),
        ];
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::DuplicateEnvironmentName)
        );

        let mut input = valid_input();
        input.environment = vec![environment_entry(
            "TOKEN",
            Some(&"v".repeat(MAX_ENVIRONMENT_VALUE_BYTES + 1)),
            false,
        )];
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::InvalidEnvironmentValue)
        );

        // A non-secret entry must always supply its own literal value.
        let mut input = valid_input();
        input.environment = vec![environment_entry("TOKEN", None, false)];
        assert_eq!(
            validate_error(input),
            Err(CliProfilesError::InvalidEnvironmentValue)
        );

        // A secret without a value is the documented "keep current credential" request.
        let mut input = valid_input();
        input.environment = vec![environment_entry("TOKEN", None, true)];
        let validated = validate(input).expect("a secret may omit its value");
        assert!(validated.environment[0].is_secret);
        assert!(validated.environment[0].value.is_none());
    }

    /// Verifies that only a concrete catalog identifier may override the shell.
    #[test]
    fn shell_override_rejects_the_sentinel_and_unknown_identifiers() {
        let mut input = valid_input();
        input.shell_id = Some("cmd".to_owned());
        assert!(validate(input).is_ok());

        for invalid in ["system", "bash", "", "C:\\Windows\\system32\\cmd.exe"] {
            let mut input = valid_input();
            input.shell_id = Some(invalid.to_owned());
            assert_eq!(
                validate_error(input),
                Err(CliProfilesError::InvalidShell),
                "shell {invalid:?} should be rejected"
            );
        }
    }

    /// Verifies that identifiers must be backend generated to be accepted.
    #[test]
    fn profile_identifier_shape_is_enforced() {
        assert_eq!(
            validate_profile_id("profile-11111111-1111-4111-8111-111111111111"),
            Ok(())
        );
        for invalid in [
            "",
            "11111111-1111-4111-8111-111111111111",
            "profile-11111111-1111-4111-8111-11111111111",
            "profile-11111111-1111-4111-8111-11111111111Z",
            "PROFILE-11111111-1111-4111-8111-111111111111",
            "profile-11111111-1111-4111-8111-11111111111A",
        ] {
            assert_eq!(
                validate_profile_id(invalid),
                Err(CliProfilesError::ProfileNotFound),
                "identifier {invalid:?} should be rejected"
            );
        }
    }

    /// Verifies that persisted argument arrays round-trip without joining.
    #[test]
    fn arguments_round_trip_as_separate_literals() {
        let arguments = vec!["--flag".to_owned(), "one two".to_owned(), String::new()];

        let encoded = encode_arguments(&arguments).expect("the arguments should encode");
        assert_eq!(decode_arguments(&encoded), Ok(arguments));

        for corrupt in ["[1]", "{}", "not json", "[null]", "[[\"nested\"]]"] {
            assert_eq!(
                decode_arguments(corrupt),
                Err(CliProfilesError::PersistenceFailed),
                "argument payload {corrupt:?} should be rejected"
            );
        }
    }

    /// Verifies that generated identifiers satisfy the persisted identity rule.
    #[test]
    fn generated_identifiers_are_opaque_and_unique() {
        let factory = UuidCliProfileIdFactory;

        let first = factory.new_profile_id();
        let second = factory.new_profile_id();
        assert_eq!(validate_profile_id(&first), Ok(()));
        assert_eq!(first.len(), PROFILE_ID_LENGTH);
        assert_ne!(first, second);

        let account = factory.new_credential_account();
        assert!(uuid::Uuid::try_parse(&account).is_ok());
        assert_ne!(account, factory.new_credential_account());
    }

    /// Verifies that the published event name is a stable public contract.
    #[test]
    fn change_event_name_is_fixed() {
        assert_eq!(CLI_PROFILES_CHANGED_EVENT, "cli-profiles://changed");
    }

    /// Verifies that every error category formats without a value or account.
    #[test]
    fn error_text_never_repeats_untrusted_input() {
        for error in [
            CliProfilesError::InvalidCommand,
            CliProfilesError::InvalidEnvironmentValue,
            CliProfilesError::SecretNotFound,
            CliProfilesError::CredentialStoreUnavailable,
        ] {
            let text = error.to_string();
            assert!(!text.contains('\\'));
            assert!(!text.contains("BE006"));
        }
        assert_eq!(
            CliProfilesError::from(StorageError::LockPoisoned),
            CliProfilesError::PersistenceFailed
        );
        assert_eq!(
            CliProfilesError::from(rusqlite::Error::QueryReturnedNoRows),
            CliProfilesError::PersistenceFailed
        );
    }
}
