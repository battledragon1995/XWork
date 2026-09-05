use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
};

use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use ts_rs::TS;

use crate::{
    shared::{DataMaintenanceGate, DataReadPermit},
    storage::{Storage, StorageError},
};

/// Represents a layout-independent keyboard chord.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "keyboard-shortcuts.ts")]
pub struct ShortcutChordDto {
    pub primary: bool,
    pub alt: bool,
    pub shift: bool,
    pub key_code: String,
}

/// Groups catalog actions for presentation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "keyboard-shortcuts.ts")]
pub enum ShortcutCategoryDto {
    Global,
    Navigation,
    Tabs,
    Panes,
    Files,
}

/// Describes the focus boundary of a shortcut.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case", export_to = "keyboard-shortcuts.ts")]
pub enum ShortcutScopeDto {
    Application,
    Global,
}

/// Returns one action with its effective chord and complete conflict group.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "keyboard-shortcuts.ts")]
pub struct KeyboardShortcutActionDto {
    pub action_id: String,
    pub label: String,
    pub category: ShortcutCategoryDto,
    pub scope: ShortcutScopeDto,
    pub default_chord: ShortcutChordDto,
    pub current_chord: ShortcutChordDto,
    pub is_custom: bool,
    pub conflicts_with: Vec<String>,
    pub is_dispatchable: bool,
}

/// Contains the committed catalog in declaration order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase", export_to = "keyboard-shortcuts.ts")]
pub struct KeyboardShortcutsDto {
    pub actions: Vec<KeyboardShortcutActionDto>,
}

/// Defines the typed shortcut assignment input.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(rename_all = "camelCase", export_to = "keyboard-shortcuts.ts")]
pub struct SetKeyboardShortcutInputDto {
    pub action_id: String,
    pub chord: ShortcutChordDto,
}

/// Exposes stable errors without database details.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(
    tag = "code",
    rename_all = "snake_case",
    export_to = "keyboard-shortcuts.ts"
)]
pub enum KeyboardShortcutsError {
    UnauthorizedWindow,
    ActionNotFound { action_id: String },
    InvalidKeyCode { key_code: String },
    ModifierRequired,
    ReservedShortcut,
    CorruptStoredShortcut { action_id: String },
    PersistenceFailed,
    Unavailable,
}

impl std::fmt::Display for KeyboardShortcutsError {
    /// Formats only the stable error category for startup diagnostics.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::UnauthorizedWindow => "unauthorized_window",
            Self::ActionNotFound { .. } => "action_not_found",
            Self::InvalidKeyCode { .. } => "invalid_key_code",
            Self::ModifierRequired => "modifier_required",
            Self::ReservedShortcut => "reserved_shortcut",
            Self::CorruptStoredShortcut { .. } => "corrupt_stored_shortcut",
            Self::PersistenceFailed => "persistence_failed",
            Self::Unavailable => "unavailable",
        })
    }
}
impl std::error::Error for KeyboardShortcutsError {}
impl From<rusqlite::Error> for KeyboardShortcutsError {
    /// Hides raw SQLite failure details.
    fn from(_: rusqlite::Error) -> Self {
        Self::PersistenceFailed
    }
}
impl From<StorageError> for KeyboardShortcutsError {
    /// Preserves unavailable storage locks without leaking SQL details.
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::LockPoisoned => Self::Unavailable,
            _ => Self::PersistenceFailed,
        }
    }
}

struct CatalogAction {
    id: &'static str,
    label: &'static str,
    category: ShortcutCategoryDto,
    alt: bool,
    shift: bool,
    code: &'static str,
}

impl CatalogAction {
    /// Materializes the platform-neutral Primary default.
    fn default_chord(&self) -> ShortcutChordDto {
        ShortcutChordDto {
            primary: true,
            alt: self.alt,
            shift: self.shift,
            key_code: self.code.into(),
        }
    }
}

const CATALOG: &[CatalogAction] = &[
    CatalogAction {
        id: "search.open_command_palette",
        label: "Search or run a command",
        category: ShortcutCategoryDto::Navigation,
        alt: false,
        shift: false,
        code: "KeyK",
    },
    CatalogAction {
        id: "navigation.previous_project",
        label: "Previous project",
        category: ShortcutCategoryDto::Navigation,
        alt: true,
        shift: false,
        code: "ArrowLeft",
    },
    CatalogAction {
        id: "navigation.next_project",
        label: "Next project",
        category: ShortcutCategoryDto::Navigation,
        alt: true,
        shift: false,
        code: "ArrowRight",
    },
    CatalogAction {
        id: "navigation.previous_session",
        label: "Previous session",
        category: ShortcutCategoryDto::Navigation,
        alt: true,
        shift: false,
        code: "ArrowUp",
    },
    CatalogAction {
        id: "navigation.next_session",
        label: "Next session",
        category: ShortcutCategoryDto::Navigation,
        alt: true,
        shift: false,
        code: "ArrowDown",
    },
    CatalogAction {
        id: "navigation.previous_tab",
        label: "Previous tab",
        category: ShortcutCategoryDto::Navigation,
        alt: false,
        shift: false,
        code: "PageUp",
    },
    CatalogAction {
        id: "navigation.next_tab",
        label: "Next tab",
        category: ShortcutCategoryDto::Navigation,
        alt: false,
        shift: false,
        code: "PageDown",
    },
    CatalogAction {
        id: "tabs.create",
        label: "New tab",
        category: ShortcutCategoryDto::Tabs,
        alt: false,
        shift: false,
        code: "KeyT",
    },
    CatalogAction {
        id: "tabs.close",
        label: "Close tab",
        category: ShortcutCategoryDto::Tabs,
        alt: false,
        shift: false,
        code: "KeyW",
    },
    CatalogAction {
        id: "tabs.reopen_closed",
        label: "Reopen closed tab",
        category: ShortcutCategoryDto::Tabs,
        alt: false,
        shift: true,
        code: "KeyT",
    },
    CatalogAction {
        id: "panes.split_right",
        label: "Split right",
        category: ShortcutCategoryDto::Panes,
        alt: false,
        shift: false,
        code: "Backslash",
    },
    CatalogAction {
        id: "panes.split_down",
        label: "Split down",
        category: ShortcutCategoryDto::Panes,
        alt: true,
        shift: false,
        code: "Backslash",
    },
    CatalogAction {
        id: "panes.maximize_toggle",
        label: "Maximize or restore pane",
        category: ShortcutCategoryDto::Panes,
        alt: false,
        shift: true,
        code: "KeyM",
    },
    CatalogAction {
        id: "panes.close",
        label: "Close pane",
        category: ShortcutCategoryDto::Panes,
        alt: false,
        shift: true,
        code: "KeyW",
    },
    CatalogAction {
        id: "panes.focus_up",
        label: "Focus pane above",
        category: ShortcutCategoryDto::Panes,
        alt: true,
        shift: true,
        code: "ArrowUp",
    },
    CatalogAction {
        id: "panes.focus_down",
        label: "Focus pane below",
        category: ShortcutCategoryDto::Panes,
        alt: true,
        shift: true,
        code: "ArrowDown",
    },
    CatalogAction {
        id: "panes.focus_left",
        label: "Focus pane left",
        category: ShortcutCategoryDto::Panes,
        alt: true,
        shift: true,
        code: "ArrowLeft",
    },
    CatalogAction {
        id: "panes.focus_right",
        label: "Focus pane right",
        category: ShortcutCategoryDto::Panes,
        alt: true,
        shift: true,
        code: "ArrowRight",
    },
];

/// Resolves an exact stable action identifier.
fn find_action(id: &str) -> Result<&'static CatalogAction, KeyboardShortcutsError> {
    CATALOG
        .iter()
        .find(
            // Matches only the stable identifier, never a display label.
            |action| action.id == id,
        )
        .ok_or_else(
            // Retains the invalid identifier in the typed error.
            || KeyboardShortcutsError::ActionNotFound {
                action_id: id.into(),
            },
        )
}

/// Recognizes only canonical F1 through F12 codes.
fn function_key(code: &str) -> bool {
    matches!(
        code,
        "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12"
    )
}

/// Validates stored portable syntax independently of the current OS reservations.
fn validate_chord(chord: &ShortcutChordDto) -> Result<(), KeyboardShortcutsError> {
    let code = chord.key_code.as_str();
    let bytes = code.as_bytes();
    let letter = bytes.len() == 4 && bytes.starts_with(b"Key") && bytes[3].is_ascii_uppercase();
    let digit = bytes.len() == 6 && bytes.starts_with(b"Digit") && bytes[5].is_ascii_digit();
    if !(letter
        || digit
        || function_key(code)
        || matches!(
            code,
            "ArrowUp"
                | "ArrowDown"
                | "ArrowLeft"
                | "ArrowRight"
                | "PageUp"
                | "PageDown"
                | "Home"
                | "End"
                | "Insert"
                | "Delete"
                | "Backspace"
                | "Enter"
                | "Escape"
                | "Space"
                | "Tab"
                | "Backslash"
                | "BracketLeft"
                | "BracketRight"
                | "Minus"
                | "Equal"
                | "Comma"
                | "Period"
                | "Slash"
                | "Semicolon"
                | "Quote"
                | "Backquote"
        ))
    {
        return Err(KeyboardShortcutsError::InvalidKeyCode {
            key_code: chord.key_code.clone(),
        });
    }
    if !function_key(code) && !chord.primary && !chord.alt {
        return Err(KeyboardShortcutsError::ModifierRequired);
    }
    Ok(())
}

/// Rejects exact OS-reserved chords for a new assignment on this target.
fn validate_assignment(id: &str, chord: &ShortcutChordDto) -> Result<(), KeyboardShortcutsError> {
    find_action(id)?;
    validate_chord(chord)?;
    #[cfg(windows)]
    let reserved = !chord.shift
        && ((chord.alt && !chord.primary && chord.key_code == "F4")
            || (chord.primary && chord.alt && chord.key_code == "Delete"));
    #[cfg(target_os = "macos")]
    let reserved = chord.primary
        && !chord.shift
        && ((!chord.alt && matches!(chord.key_code.as_str(), "KeyQ" | "KeyH" | "KeyM"))
            || (chord.alt && chord.key_code == "Escape"));
    #[cfg(not(any(windows, target_os = "macos")))]
    let reserved = false;
    if reserved {
        return Err(KeyboardShortcutsError::ReservedShortcut);
    }
    Ok(())
}

/// Owns one persisted non-default override for the maintenance coordinator.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShortcutOverride {
    pub action_id: String,
    pub chord: ShortcutChordDto,
}

/// Owns a prepared replacement and its already computed cache projection.
#[derive(Clone, Debug)]
pub struct ShortcutOverridesImportPlan {
    projection: KeyboardShortcutsCommittedProjection,
}

/// Carries the owned overrides and conflict projection for post-commit publication.
#[derive(Clone, Debug)]
pub struct KeyboardShortcutsCommittedProjection {
    overrides: HashMap<String, ShortcutChordDto>,
    snapshot: KeyboardShortcutsDto,
}

/// Builds fingerprint groups once and emits conflict members in catalog order.
fn project(overrides: HashMap<String, ShortcutChordDto>) -> KeyboardShortcutsCommittedProjection {
    let mut groups: HashMap<ShortcutChordDto, Vec<String>> = HashMap::new();
    for action in CATALOG {
        let chord = overrides.get(action.id).cloned().unwrap_or_else(
            // Uses the versioned default when no user override exists.
            || action.default_chord(),
        );
        groups.entry(chord).or_default().push(action.id.into());
    }
    let mut actions = Vec::with_capacity(CATALOG.len());
    for action in CATALOG {
        let default_chord = action.default_chord();
        let current_chord = overrides.get(action.id).cloned().unwrap_or_else(
            // Copies the default into the effective chord.
            || default_chord.clone(),
        );
        let conflicts_with: Vec<_> = groups[&current_chord]
            .iter()
            .filter(
                // Excludes the action itself while preserving catalog order.
                |id| id.as_str() != action.id,
            )
            .cloned()
            .collect();
        actions.push(KeyboardShortcutActionDto {
            action_id: action.id.into(),
            label: action.label.into(),
            category: action.category,
            scope: ShortcutScopeDto::Application,
            is_custom: current_chord != default_chord,
            default_chord,
            current_chord,
            is_dispatchable: conflicts_with.is_empty(),
            conflicts_with,
        });
    }
    KeyboardShortcutsCommittedProjection {
        overrides,
        snapshot: KeyboardShortcutsDto { actions },
    }
}

/// Hydrates known rows strictly while preserving unknown rows only in SQLite.
fn read_projection(
    connection: &Connection,
) -> Result<KeyboardShortcutsCommittedProjection, KeyboardShortcutsError> {
    let mut statement = connection.prepare("SELECT action_id, primary_modifier, alt_modifier, shift_modifier, key_code FROM keyboard_shortcut_overrides")?;
    let mut rows = statement.query([])?;
    let mut overrides = HashMap::new();

    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        if find_action(&id).is_err() {
            continue;
        }
        // Classifies every decoding or validation failure of a known row as corruption.
        let decode = || -> Result<ShortcutChordDto, KeyboardShortcutsError> {
            let primary: i64 = row.get(1)?;
            let alt: i64 = row.get(2)?;
            let shift: i64 = row.get(3)?;
            if ![primary, alt, shift].iter().all(
                // SQLite booleans must be exactly zero or one.
                |value| matches!(value, 0 | 1),
            ) {
                return Err(KeyboardShortcutsError::PersistenceFailed);
            }
            let chord = ShortcutChordDto {
                primary: primary == 1,
                alt: alt == 1,
                shift: shift == 1,
                key_code: row.get(4)?,
            };
            validate_chord(&chord)?;
            Ok(chord)
        };
        let chord = decode().map_err(
            // Identifies the corrupt action without exposing its stored chord.
            |_| KeyboardShortcutsError::CorruptStoredShortcut {
                action_id: id.clone(),
            },
        )?;
        overrides.insert(id, chord);
    }
    Ok(project(overrides))
}

/// Upserts exactly one validated user override using bound values.
fn write_override(
    tx: &Transaction<'_>,
    id: &str,
    chord: &ShortcutChordDto,
) -> Result<(), KeyboardShortcutsError> {
    tx.execute("INSERT INTO keyboard_shortcut_overrides (action_id, primary_modifier, alt_modifier, shift_modifier, key_code) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(action_id) DO UPDATE SET primary_modifier = excluded.primary_modifier, alt_modifier = excluded.alt_modifier, shift_modifier = excluded.shift_modifier, key_code = excluded.key_code", params![id, chord.primary, chord.alt, chord.shift, chord.key_code])?;
    Ok(())
}

/// Owns the shortcut cache and serialized ordinary mutation lifecycle.
#[derive(Clone)]
pub struct KeyboardShortcutsService {
    inner: Arc<KeyboardShortcutsServiceInner>,
}
struct KeyboardShortcutsServiceInner {
    storage: Storage,
    gate: DataMaintenanceGate,
    write_gate: Mutex<()>,
    cache: RwLock<KeyboardShortcutsCommittedProjection>,
    shutting_down: AtomicBool,
}

impl KeyboardShortcutsService {
    /// Hydrates the migrated database before commands become available.
    pub fn new(
        storage: Storage,
        gate: DataMaintenanceGate,
    ) -> Result<Self, KeyboardShortcutsError> {
        let cache = storage.with_connection(read_projection)?;
        Ok(Self {
            inner: Arc::new(KeyboardShortcutsServiceInner {
                storage,
                gate,
                write_gate: Mutex::new(()),
                cache: RwLock::new(cache),
                shutting_down: AtomicBool::new(false),
            }),
        })
    }
    /// Reads only the latest committed in-memory snapshot.
    pub fn snapshot(&self) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        self.ensure_available()?;
        Ok(self.clone_cache()?.snapshot)
    }
    /// Rejects new work after shutdown begins.
    pub fn begin_shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
    }
    /// Verifies composition uses the process-wide maintenance gate.
    pub fn shares_gate_with(&self, gate: &DataMaintenanceGate) -> bool {
        self.inner.gate.shares_state_with(gate)
    }
    /// Checks lifecycle admission without holding a lock across an await.
    fn ensure_available(&self) -> Result<(), KeyboardShortcutsError> {
        if self.inner.shutting_down.load(Ordering::Acquire)
            || self.inner.cache.is_poisoned()
            || self.inner.write_gate.is_poisoned()
        {
            Err(KeyboardShortcutsError::Unavailable)
        } else {
            Ok(())
        }
    }
    /// Clones the complete committed cache and propagates poison as unavailable.
    fn clone_cache(&self) -> Result<KeyboardShortcutsCommittedProjection, KeyboardShortcutsError> {
        self.inner
            .cache
            .read()
            .map(
                // Copies owned state before touching Storage.
                |cache| cache.clone(),
            )
            .map_err(
                // Never substitute defaults for a poisoned cache.
                |_| KeyboardShortcutsError::Unavailable,
            )
    }
    /// Admits a synchronous assignment through the shared maintenance gate.
    pub fn set_shortcut(
        &self,
        id: &str,
        chord: &ShortcutChordDto,
    ) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        self.ensure_available()?;
        validate_assignment(id, chord)?;
        self.set_shortcut_admitted(
            id,
            chord,
            tauri::async_runtime::block_on(self.inner.gate.read_permit()),
        )
    }
    /// Admits a synchronous reset of one action.
    pub fn reset_shortcut(&self, id: &str) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        self.ensure_available()?;
        find_action(id)?;
        self.reset_shortcut_admitted(
            id,
            tauri::async_runtime::block_on(self.inner.gate.read_permit()),
        )
    }
    /// Admits a synchronous reset of all overrides including orphans.
    pub fn reset_all(&self) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        self.ensure_available()?;
        self.reset_all_admitted(tauri::async_runtime::block_on(
            self.inner.gate.read_permit(),
        ))
    }
    /// Validates and serializes an assignment while retaining the caller's permit.
    pub(crate) fn set_shortcut_admitted(
        &self,
        id: &str,
        chord: &ShortcutChordDto,
        _permit: DataReadPermit,
    ) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        self.ensure_available()?;
        validate_assignment(id, chord)?;
        self.mutate(Some((id, Some(chord))))
    }
    /// Deletes one target while retaining the caller's permit through publication.
    pub(crate) fn reset_shortcut_admitted(
        &self,
        id: &str,
        _permit: DataReadPermit,
    ) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        self.ensure_available()?;
        find_action(id)?;
        self.mutate(Some((id, None)))
    }
    /// Clears every override while retaining the caller's permit through publication.
    pub(crate) fn reset_all_admitted(
        &self,
        _permit: DataReadPermit,
    ) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        self.ensure_available()?;
        self.mutate(None)
    }
    /// Computes a candidate under the write gate and publishes only after commit.
    fn mutate(
        &self,
        change: Option<(&str, Option<&ShortcutChordDto>)>,
    ) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
        let _guard = self.inner.write_gate.lock().map_err(
            // Rejects a poisoned mutation gate before accessing persistence.
            |_| KeyboardShortcutsError::Unavailable,
        )?;
        self.ensure_available()?;
        let current = self.clone_cache()?;
        let mut overrides = current.overrides.clone();
        if let Some((id, chord)) = change {
            let default = find_action(id)?.default_chord();
            let desired = chord.unwrap_or(&default);
            if chord.is_some() && current.overrides.get(id).unwrap_or(&default) == desired {
                return Ok(current.snapshot);
            }
            if chord.is_none() && !overrides.contains_key(id) {
                return Ok(current.snapshot);
            }
            if desired == &default {
                overrides.remove(id);
            } else {
                overrides.insert(id.into(), desired.clone());
            }
        } else {
            overrides.clear();
        }
        let candidate = project(overrides);
        // A read count observes orphan rows inserted by an older/newer owner, even when the visible cache is empty.
        if change.is_none() {
            let has_rows = self
                .inner
                .storage
                .with_connection::<_, KeyboardShortcutsError>(
                    // Does not begin a write transaction for an empty reset.
                    |connection| {
                        Ok(connection.query_row(
                            "SELECT EXISTS(SELECT 1 FROM keyboard_shortcut_overrides)",
                            [],
                            // Reads whether any known or orphan override exists.
                            |row| row.get::<_, bool>(0),
                        )?)
                    },
                )?;
            if !has_rows {
                return Ok(current.snapshot);
            }
        }
        self.inner
            .storage
            .with_transaction::<_, KeyboardShortcutsError>(
                // Applies only the requested row operation, preserving unrelated orphan rows.
                |tx| {
                    if let Some((id, _)) = change {
                        if let Some(chord) = candidate.overrides.get(id) {
                            write_override(tx, id, chord)?;
                        } else {
                            tx.execute(
                                "DELETE FROM keyboard_shortcut_overrides WHERE action_id = ?1",
                                params![id],
                            )?;
                        }
                    } else {
                        tx.execute("DELETE FROM keyboard_shortcut_overrides", [])?;
                    }
                    Ok(())
                },
            )?;
        let snapshot = candidate.snapshot.clone();
        self.publish_data_change(candidate);
        Ok(snapshot)
    }
    /// Exports known non-default overrides in catalog order using only the caller's transaction.
    pub fn export_overrides_in(
        tx: &Transaction<'_>,
    ) -> Result<Vec<ShortcutOverride>, KeyboardShortcutsError> {
        let projection = read_projection(tx)?;
        let mut result = Vec::new();
        for action in CATALOG {
            if let Some(chord) = projection.overrides.get(action.id)
                && chord != &action.default_chord()
            {
                result.push(ShortcutOverride {
                    action_id: action.id.into(),
                    chord: chord.clone(),
                });
            }
        }
        Ok(result)
    }
    /// Validates a full replacement without taking gates or writing any rows.
    pub fn prepare_replace_overrides_in(
        _tx: &Transaction<'_>,
        incoming: &[ShortcutOverride],
    ) -> Result<ShortcutOverridesImportPlan, KeyboardShortcutsError> {
        let mut seen = HashSet::new();
        let mut overrides = HashMap::new();
        for value in incoming {
            validate_assignment(&value.action_id, &value.chord)?;
            if !seen.insert(value.action_id.clone()) {
                return Err(KeyboardShortcutsError::CorruptStoredShortcut {
                    action_id: value.action_id.clone(),
                });
            }
            if value.chord != find_action(&value.action_id)?.default_chord() {
                overrides.insert(value.action_id.clone(), value.chord.clone());
            }
        }

        Ok(ShortcutOverridesImportPlan {
            projection: project(overrides),
        })
    }
    /// Applies a prepared replacement exclusively on the coordinator-owned transaction.
    pub fn apply_replace_overrides_in(
        tx: &Transaction<'_>,
        plan: &ShortcutOverridesImportPlan,
    ) -> Result<KeyboardShortcutsCommittedProjection, KeyboardShortcutsError> {
        tx.execute("DELETE FROM keyboard_shortcut_overrides", [])?;
        for action in CATALOG {
            if let Some(chord) = plan.projection.overrides.get(action.id) {
                write_override(tx, action.id, chord)?;
            }
        }
        Ok(plan.projection.clone())
    }
    /// Clears all rows in the shared transaction without acquiring owner locks.
    pub fn reset_overrides_in(
        tx: &Transaction<'_>,
    ) -> Result<KeyboardShortcutsCommittedProjection, KeyboardShortcutsError> {
        tx.execute("DELETE FROM keyboard_shortcut_overrides", [])?;
        Ok(project(HashMap::new()))
    }
    /// Installs an already committed projection with no fallible post-commit operation.
    pub fn publish_data_change(&self, projection: KeyboardShortcutsCommittedProjection) {
        let mut cache = self.inner.cache.write().unwrap_or_else(
            // Commit is irreversible; retain poison for subsequent public admission while installing committed state.
            |poison| poison.into_inner(),
        );
        *cache = projection;
    }
}

/// Clones the managed owner without retaining a Tauri state borrow.
fn managed_service<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<KeyboardShortcutsService, KeyboardShortcutsError> {
    app.try_state::<KeyboardShortcutsService>()
        .map(
            // Copies the Arc-backed owner handle.
            |state| state.inner().clone(),
        )
        .ok_or(KeyboardShortcutsError::Unavailable)
}

/// Authorizes only the primary application window for persistence.
fn authorize(label: &str) -> Result<(), KeyboardShortcutsError> {
    if label == "main" {
        Ok(())
    } else {
        Err(KeyboardShortcutsError::UnauthorizedWindow)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies every catalog field, declaration order, and default against the Phase 1 contract.
    #[test]
    fn catalog_lists_eighteen_actions_in_contract_order() {
        use ShortcutCategoryDto::{Navigation, Panes, Tabs};
        let expected = [
            (
                "search.open_command_palette",
                "Search or run a command",
                Navigation,
                false,
                false,
                "KeyK",
            ),
            (
                "navigation.previous_project",
                "Previous project",
                Navigation,
                true,
                false,
                "ArrowLeft",
            ),
            (
                "navigation.next_project",
                "Next project",
                Navigation,
                true,
                false,
                "ArrowRight",
            ),
            (
                "navigation.previous_session",
                "Previous session",
                Navigation,
                true,
                false,
                "ArrowUp",
            ),
            (
                "navigation.next_session",
                "Next session",
                Navigation,
                true,
                false,
                "ArrowDown",
            ),
            (
                "navigation.previous_tab",
                "Previous tab",
                Navigation,
                false,
                false,
                "PageUp",
            ),
            (
                "navigation.next_tab",
                "Next tab",
                Navigation,
                false,
                false,
                "PageDown",
            ),
            ("tabs.create", "New tab", Tabs, false, false, "KeyT"),
            ("tabs.close", "Close tab", Tabs, false, false, "KeyW"),
            (
                "tabs.reopen_closed",
                "Reopen closed tab",
                Tabs,
                false,
                true,
                "KeyT",
            ),
            (
                "panes.split_right",
                "Split right",
                Panes,
                false,
                false,
                "Backslash",
            ),
            (
                "panes.split_down",
                "Split down",
                Panes,
                true,
                false,
                "Backslash",
            ),
            (
                "panes.maximize_toggle",
                "Maximize or restore pane",
                Panes,
                false,
                true,
                "KeyM",
            ),
            ("panes.close", "Close pane", Panes, false, true, "KeyW"),
            (
                "panes.focus_up",
                "Focus pane above",
                Panes,
                true,
                true,
                "ArrowUp",
            ),
            (
                "panes.focus_down",
                "Focus pane below",
                Panes,
                true,
                true,
                "ArrowDown",
            ),
            (
                "panes.focus_left",
                "Focus pane left",
                Panes,
                true,
                true,
                "ArrowLeft",
            ),
            (
                "panes.focus_right",
                "Focus pane right",
                Panes,
                true,
                true,
                "ArrowRight",
            ),
        ];
        let snapshot = project(HashMap::new()).snapshot;
        assert_eq!(snapshot.actions.len(), expected.len());
        let mut ids = HashSet::new();
        let mut defaults = HashSet::new();
        for (action, (id, label, category, alt, shift, code)) in
            snapshot.actions.iter().zip(expected)
        {
            assert_eq!(action.action_id, id);
            assert_eq!(action.label, label);
            assert_eq!(action.category, category);
            assert_eq!(action.scope, ShortcutScopeDto::Application);
            assert_eq!(
                action.default_chord,
                ShortcutChordDto {
                    primary: true,
                    alt,
                    shift,
                    key_code: code.into()
                }
            );
            assert_eq!(action.current_chord, action.default_chord);
            assert!(
                !action.is_custom && action.is_dispatchable && action.conflicts_with.is_empty()
            );
            assert!(ids.insert(id));
            assert!(defaults.insert(action.default_chord.clone()));
            assert_eq!(validate_assignment(id, &action.default_chord), Ok(()));
        }
    }

    /// Checks canonical allowlist endpoints, all named keys, and common misspellings.
    #[test]
    fn key_code_allowlist_accepts_canonical_codes_and_rejects_typos() {
        let mut codes: Vec<String> = Vec::new();
        for letter in 'A'..='Z' {
            codes.push(format!("Key{letter}"));
        }
        for digit in 0..=9 {
            codes.push(format!("Digit{digit}"));
        }
        for number in 1..=12 {
            codes.push(format!("F{number}"));
        }
        for code in [
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "PageUp",
            "PageDown",
            "Home",
            "End",
            "Insert",
            "Delete",
            "Backspace",
            "Enter",
            "Escape",
            "Space",
            "Tab",
            "Backslash",
            "BracketLeft",
            "BracketRight",
            "Minus",
            "Equal",
            "Comma",
            "Period",
            "Slash",
            "Semicolon",
            "Quote",
            "Backquote",
        ] {
            codes.push(code.into());
        }
        for code in codes {
            assert!(
                validate_chord(&ShortcutChordDto {
                    primary: true,
                    alt: false,
                    shift: false,
                    key_code: code
                })
                .is_ok()
            );
        }
        for code in [
            "keya",
            "Keya",
            "F0",
            "F01",
            "F13",
            "Digit10",
            "",
            "ControlLeft",
            "ShiftRight",
            "é",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ] {
            assert_eq!(
                validate_chord(&ShortcutChordDto {
                    primary: true,
                    alt: false,
                    shift: false,
                    key_code: code.into()
                }),
                Err(KeyboardShortcutsError::InvalidKeyCode {
                    key_code: code.into()
                })
            );
        }
    }

    /// Requires Primary or Alt for every non-function key, including Shift-only input.
    #[test]
    fn modifier_rules_require_primary_or_alt_except_function_keys() {
        for code in ["KeyA", "Digit0", "Backslash", "ArrowUp", "Tab"] {
            for shift in [false, true] {
                assert_eq!(
                    validate_chord(&ShortcutChordDto {
                        primary: false,
                        alt: false,
                        shift,
                        key_code: code.into()
                    }),
                    Err(KeyboardShortcutsError::ModifierRequired)
                );
            }
        }
        for number in 1..=12 {
            assert!(
                validate_chord(&ShortcutChordDto {
                    primary: false,
                    alt: false,
                    shift: false,
                    key_code: format!("F{number}")
                })
                .is_ok()
            );
        }
    }

    /// Verifies exact Windows reservations without over-rejecting modified variants.
    #[test]
    #[cfg(windows)]
    fn windows_reserved_combos_are_rejected() {
        for (primary, alt, shift, code, reserved) in [
            (false, true, false, "F4", true),
            (true, true, false, "Delete", true),
            (false, true, true, "F4", false),
            (true, true, false, "Backspace", false),
        ] {
            let chord = ShortcutChordDto {
                primary,
                alt,
                shift,
                key_code: code.into(),
            };
            let result = validate_assignment("tabs.create", &chord);
            if reserved {
                assert_eq!(result, Err(KeyboardShortcutsError::ReservedShortcut));
            } else {
                assert_eq!(result, Ok(()));
            }
        }
    }

    /// Verifies exact macOS reservations only when compiled and tested on that target.
    #[test]
    #[cfg(target_os = "macos")]
    fn macos_reserved_combos_are_rejected() {
        for (alt, shift, code, reserved) in [
            (false, false, "KeyQ", true),
            (false, false, "KeyH", true),
            (false, false, "KeyM", true),
            (true, false, "Escape", true),
            (false, true, "KeyM", false),
        ] {
            let chord = ShortcutChordDto {
                primary: true,
                alt,
                shift,
                key_code: code.into(),
            };
            let result = validate_assignment("tabs.create", &chord);
            if reserved {
                assert_eq!(result, Err(KeyboardShortcutsError::ReservedShortcut));
            } else {
                assert_eq!(result, Ok(()));
            }
        }
    }

    /// Demonstrates symmetric fingerprint projection without assigning a hidden winner.
    #[test]
    fn merge_overrides_project_conflict_groups() {
        let shared = CATALOG[0].default_chord();
        let mut overrides = HashMap::new();
        overrides.insert("tabs.create".into(), shared.clone());
        let two = project(overrides.clone()).snapshot;
        assert_eq!(two.actions[0].conflicts_with, ["tabs.create"]);
        overrides.insert("tabs.close".into(), shared);
        let three = project(overrides).snapshot;
        assert_eq!(
            three.actions[0].conflicts_with,
            ["tabs.create", "tabs.close"]
        );
        assert_eq!(
            three.actions[7].conflicts_with,
            ["search.open_command_palette", "tabs.close"]
        );
        assert_eq!(
            three.actions[8].conflicts_with,
            ["search.open_command_palette", "tabs.create"]
        );
        for index in [0, 7, 8] {
            assert!(!three.actions[index].is_dispatchable);
        }
        assert!(!three.actions[0].is_custom);
        assert!(three.actions[7].is_custom && three.actions[8].is_custom);
        assert!(three.actions[1].is_dispatchable);
    }

    /// Confirms poisoned cache and write-gate locks reject public operations without default fallback.
    #[test]
    fn poisoned_service_locks_are_unavailable() {
        use std::panic::{AssertUnwindSafe, catch_unwind};
        for poison_cache in [true, false] {
            let dir = tempfile::TempDir::new().unwrap();
            let service = KeyboardShortcutsService::new(
                Storage::open(dir.path()).unwrap(),
                DataMaintenanceGate::new(),
            )
            .unwrap();
            let result = catch_unwind(AssertUnwindSafe(
                // Intentionally poisons exactly one owner lock in the isolated fixture.
                || {
                    if poison_cache {
                        let _guard = service.inner.cache.write().unwrap();
                        panic!("poison cache");
                    } else {
                        let _guard = service.inner.write_gate.lock().unwrap();
                        panic!("poison write gate");
                    }
                },
            ));
            assert!(result.is_err());
            assert_eq!(
                service.set_shortcut("tabs.create", &CATALOG[0].default_chord()),
                Err(KeyboardShortcutsError::Unavailable)
            );
            assert_eq!(service.snapshot(), Err(KeyboardShortcutsError::Unavailable));
        }
    }
}

/// Returns the cached catalog from any application window.
#[tauri::command]
pub(crate) async fn get_keyboard_shortcuts<R: Runtime>(
    app: AppHandle<R>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
    managed_service(&app)?.snapshot()
}

/// Persists a validated assignment on the blocking pool under maintenance admission.
#[tauri::command]
pub(crate) async fn set_keyboard_shortcut<R: Runtime>(
    action_id: String,
    chord: ShortcutChordDto,
    window: WebviewWindow<R>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
    authorize(window.label())?;
    let service = managed_service(window.app_handle())?;
    service.ensure_available()?;
    validate_assignment(&action_id, &chord)?;
    let permit = service.inner.gate.read_permit().await;
    tauri::async_runtime::spawn_blocking(
        // Holds admission through write, commit, and cache publication.
        move || service.set_shortcut_admitted(&action_id, &chord, permit),
    )
    .await
    .map_err(
        // Matches the established settings blocking-task error mapping.
        |_| KeyboardShortcutsError::PersistenceFailed,
    )?
}

/// Resets one validated action on the blocking pool.
#[tauri::command]
pub(crate) async fn reset_keyboard_shortcut<R: Runtime>(
    action_id: String,
    window: WebviewWindow<R>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
    authorize(window.label())?;
    let service = managed_service(window.app_handle())?;
    service.ensure_available()?;
    find_action(&action_id)?;
    let permit = service.inner.gate.read_permit().await;
    tauri::async_runtime::spawn_blocking(
        // Keeps the owned permit alive through reset publication.
        move || service.reset_shortcut_admitted(&action_id, permit),
    )
    .await
    .map_err(
        // Hides worker failure details.
        |_| KeyboardShortcutsError::PersistenceFailed,
    )?
}

/// Resets all persisted overrides including unknown future actions.
#[tauri::command]
pub(crate) async fn reset_all_keyboard_shortcuts<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<KeyboardShortcutsDto, KeyboardShortcutsError> {
    authorize(window.label())?;
    let service = managed_service(window.app_handle())?;
    service.ensure_available()?;
    let permit = service.inner.gate.read_permit().await;
    tauri::async_runtime::spawn_blocking(
        // Holds admission until the default snapshot has been published.
        move || service.reset_all_admitted(permit),
    )
    .await
    .map_err(
        // Hides worker failure details.
        |_| KeyboardShortcutsError::PersistenceFailed,
    )?
}
