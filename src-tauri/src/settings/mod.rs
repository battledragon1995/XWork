mod keyboard_shortcuts;
pub(crate) use keyboard_shortcuts::*;
pub use keyboard_shortcuts::{
    KeyboardShortcutActionDto, KeyboardShortcutsCommittedProjection, KeyboardShortcutsDto,
    KeyboardShortcutsError, KeyboardShortcutsService, SetKeyboardShortcutInputDto,
    ShortcutCategoryDto, ShortcutChordDto, ShortcutOverride, ShortcutOverridesImportPlan,
    ShortcutScopeDto,
};

use std::{
    error::Error,
    fmt::{Display, Formatter},
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use ts_rs::TS;

use crate::{
    shared::{DataMaintenanceGate, DataReadPermit},
    storage::{Storage, StorageError},
};

const INTERFACE_FONT_MIN: u16 = 12;
const INTERFACE_FONT_MAX: u16 = 20;
const TERMINAL_FONT_MIN: u16 = 10;
const TERMINAL_FONT_MAX: u16 = 24;
const SIDEBAR_WIDTH_MIN: u16 = 200;
const SIDEBAR_WIDTH_MAX: u16 = 420;

const CREAM_ANSI: [&str; 16] = [
    "#181715", "#c64545", "#5db872", "#e8a55a", "#93b4d6", "#b48ead", "#5db8a6", "#a09d96",
    "#3d3d3a", "#e08a8a", "#8fd19e", "#f0c48a", "#b4cde6", "#d0b0d8", "#8ed4c6", "#faf9f5",
];

const PAPER_ANSI: [&str; 16] = [
    "#141413", "#c64545", "#327a47", "#9a6700", "#3b6ea8", "#875f8b", "#2f7f75", "#a09d96",
    "#66635d", "#a33434", "#256f3b", "#7d5700", "#315f91", "#704f74", "#266c64", "#f5f0e8",
];

/// Identifies the only interface language supported in Phase 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
#[ts(export_to = "settings.ts")]
pub enum InterfaceLanguageDto {
    English,
}

/// Selects a fixed or operating-system-driven interface theme mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
#[ts(export_to = "settings.ts")]
pub enum ThemeModeDto {
    Light,
    Dark,
    System,
}

/// Identifies a built-in color preset or a customized palette.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
#[ts(export_to = "settings.ts")]
pub enum ThemePresetDto {
    Cream,
    Ink,
    Paper,
    Custom,
}

/// Contains the four interface colors for one effective theme mode.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct InterfaceColorsDto {
    pub accent: String,
    pub canvas: String,
    pub sidebar: String,
    pub text: String,
}

/// Contains both light and dark interface color sets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct InterfaceThemeColorsDto {
    pub light: InterfaceColorsDto,
    pub dark: InterfaceColorsDto,
}

/// Contains the terminal foreground, background, and fixed ANSI palette.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct TerminalPaletteDto {
    pub background: String,
    pub foreground: String,
    pub ansi_colors: [String; 16],
}

/// Returns the immutable General behavior owned by the application lifecycle.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct GeneralSettingsDto {
    pub interface_language: InterfaceLanguageDto,
    pub close_to_tray: bool,
    pub show_tray_icon: bool,
    pub ask_before_quitting: bool,
    pub open_at_home_on_launch: bool,
}

/// Returns every persisted Appearance setting.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct AppearanceSettingsDto {
    pub theme_mode: ThemeModeDto,
    pub theme_preset: ThemePresetDto,
    pub interface_colors: InterfaceThemeColorsDto,
    pub terminal_palette: TerminalPaletteDto,
    pub interface_font_size_px: u8,
    pub terminal_font_size_px: u8,
}

/// Returns the persisted sidebar layout state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct SidebarSettingsDto {
    pub width_px: u16,
    pub collapsed: bool,
}

/// Returns the complete Phase 1 application settings contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct AppSettingsDto {
    pub revision: String,
    pub general: GeneralSettingsDto,
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
}

/// Describes an optional partial Appearance update.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct AppearanceSettingsPatchDto {
    #[ts(optional)]
    pub theme_mode: Option<ThemeModeDto>,
    #[ts(optional)]
    pub theme_preset: Option<ThemePresetDto>,
    #[ts(optional)]
    pub interface_colors: Option<InterfaceThemeColorsDto>,
    #[ts(optional)]
    pub terminal_palette: Option<TerminalPaletteDto>,
    #[ts(optional)]
    pub interface_font_size_px: Option<u8>,
    #[ts(optional)]
    pub terminal_font_size_px: Option<u8>,
}

/// Describes an optional partial sidebar update.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct SidebarSettingsPatchDto {
    #[ts(optional)]
    pub width_px: Option<u16>,
    #[ts(optional)]
    pub collapsed: Option<bool>,
}

/// Describes one atomic partial settings update.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
#[ts(export_to = "settings.ts")]
pub struct UpdateSettingsDto {
    #[ts(optional)]
    pub appearance: Option<AppearanceSettingsPatchDto>,
    #[ts(optional)]
    pub sidebar: Option<SidebarSettingsPatchDto>,
}

/// Describes stable Settings failures without exposing SQLite details.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
#[ts(tag = "code", rename_all = "snake_case")]
#[ts(export_to = "settings.ts")]
pub enum SettingsError {
    UnauthorizedWindow,
    EmptyPatch,
    InvalidColor {
        field: String,
    },
    ContrastTooLow {
        foreground: String,
        background: String,
    },
    ValueOutOfRange {
        field: String,
        min: u16,
        max: u16,
    },
    InvalidPresetCombination,
    CorruptStoredSettings {
        field: String,
    },
    PersistenceFailed,
    Unavailable,
}

impl Display for SettingsError {
    /// Formats one stable category without exposing settings or database details.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::UnauthorizedWindow => "the invoking window cannot mutate settings",
            Self::EmptyPatch => "the settings patch is empty",
            Self::InvalidColor { .. } => "a settings color is invalid",
            Self::ContrastTooLow { .. } => "a required color contrast is too low",
            Self::ValueOutOfRange { .. } => "a settings value is outside its allowed range",
            Self::InvalidPresetCombination => "a built-in preset cannot include custom colors",
            Self::CorruptStoredSettings { .. } => "persisted settings are corrupt",
            Self::PersistenceFailed => "the settings database operation failed",
            Self::Unavailable => "the settings service is unavailable",
        };
        formatter.write_str(message)
    }
}

impl Error for SettingsError {}

impl From<StorageError> for SettingsError {
    /// Maps poisoned storage to unavailable and all other storage failures to persistence failure.
    fn from(error: StorageError) -> Self {
        if matches!(error, StorageError::LockPoisoned) {
            Self::Unavailable
        } else {
            Self::PersistenceFailed
        }
    }
}

impl From<rusqlite::Error> for SettingsError {
    /// Hides every raw SQLite failure behind the stable persistence category.
    fn from(_error: rusqlite::Error) -> Self {
        Self::PersistenceFailed
    }
}

/// Stores one immutable committed settings snapshot in backend-native form.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettingsSnapshot {
    pub revision: u64,
    pub general: GeneralSettingsDto,
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
}

impl SettingsSnapshot {
    /// Creates the exact first-run Phase 1 settings snapshot.
    pub fn defaults() -> Self {
        Self {
            revision: 0,
            general: general_settings(),
            appearance: default_appearance(),
            sidebar: SidebarSettingsDto {
                width_px: 280,
                collapsed: false,
            },
        }
    }

    /// Projects the native revision into its precision-safe decimal DTO representation.
    pub fn to_dto(&self) -> AppSettingsDto {
        AppSettingsDto {
            revision: self.revision.to_string(),
            general: self.general.clone(),
            appearance: self.appearance.clone(),
            sidebar: self.sidebar.clone(),
        }
    }
}

/// Carries the settings-owned section of a future coordinator snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettingsBackupSection {
    pub appearance: AppearanceSettingsDto,
    pub sidebar: SidebarSettingsDto,
    pub notification_settings: Option<()>,
}

/// Owns a fully validated settings restore operation and its committed projection.
#[derive(Clone, Debug)]
pub struct SettingsRestorePlan {
    snapshot: SettingsSnapshot,
}

/// Owns the cache projection that may be published only after transaction commit.
#[derive(Clone, Debug)]
pub struct SettingsCommittedProjection {
    snapshot: SettingsSnapshot,
}

/// Owns the process-wide settings cache, persistence handle, and mutation locks.
#[derive(Clone)]
pub struct SettingsService {
    inner: Arc<SettingsServiceInner>,
}

struct SettingsServiceInner {
    storage: Storage,
    gate: DataMaintenanceGate,
    write_gate: Mutex<()>,
    cache: RwLock<SettingsSnapshot>,
    shutting_down: AtomicBool,
}

impl SettingsService {
    /// Hydrates and validates the singleton row before exposing the service.
    pub fn new(storage: Storage, gate: DataMaintenanceGate) -> Result<Self, SettingsError> {
        let snapshot = storage.with_connection(read_snapshot)?;
        Ok(Self {
            inner: Arc::new(SettingsServiceInner {
                storage,
                gate,
                write_gate: Mutex::new(()),
                cache: RwLock::new(snapshot),
                shutting_down: AtomicBool::new(false),
            }),
        })
    }

    /// Returns the latest committed snapshot without database I/O.
    pub fn snapshot(&self) -> Result<SettingsSnapshot, SettingsError> {
        self.ensure_available()?;
        self.clone_cache()
    }

    /// Applies one atomic update while acquiring its own maintenance admission.
    pub fn update(&self, patch: &UpdateSettingsDto) -> Result<SettingsSnapshot, SettingsError> {
        self.ensure_available()?;
        validate_update_shape(patch)?;
        let permit = tauri::async_runtime::block_on(self.inner.gate.read_permit());
        self.update_admitted(patch, permit)
    }

    /// Restores Appearance while acquiring its own maintenance admission.
    pub fn restore_appearance_defaults(&self) -> Result<SettingsSnapshot, SettingsError> {
        self.ensure_available()?;
        let permit = tauri::async_runtime::block_on(self.inner.gate.read_permit());
        self.restore_appearance_defaults_admitted(permit)
    }

    /// Rejects operations admitted after application shutdown starts.
    pub fn begin_shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
    }

    /// Reports whether the service uses the supplied process-wide maintenance gate.
    #[doc(hidden)]
    pub fn shares_gate_with(&self, gate: &DataMaintenanceGate) -> bool {
        self.inner.gate.shares_state_with(gate)
    }

    /// Applies an update under the command-owned maintenance permit.
    pub(crate) fn update_admitted(
        &self,
        patch: &UpdateSettingsDto,
        _permit: DataReadPermit,
    ) -> Result<SettingsSnapshot, SettingsError> {
        let _write_guard = self
            .inner
            .write_gate
            .lock()
            .map_err(|_| SettingsError::Unavailable)?;
        let current = self.clone_cache()?;
        let next = merge_update(current, patch)?;
        self.persist_and_publish(next)
    }

    /// Restores Appearance under the command-owned maintenance permit.
    pub(crate) fn restore_appearance_defaults_admitted(
        &self,
        _permit: DataReadPermit,
    ) -> Result<SettingsSnapshot, SettingsError> {
        let _write_guard = self
            .inner
            .write_gate
            .lock()
            .map_err(|_| SettingsError::Unavailable)?;
        let mut next = self.clone_cache()?;
        next.appearance = default_appearance();
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or(SettingsError::PersistenceFailed)?;
        self.persist_and_publish(next)
    }

    /// Exports persisted settings from the coordinator-owned transaction.
    pub fn export_persisted_settings_in(
        tx: &Transaction<'_>,
    ) -> Result<SettingsBackupSection, SettingsError> {
        let snapshot = read_snapshot(tx)?;
        Ok(SettingsBackupSection {
            appearance: snapshot.appearance,
            sidebar: snapshot.sidebar,
            notification_settings: None,
        })
    }

    /// Validates incoming settings and builds an owned coordinator restore plan.
    pub fn prepare_settings_restore_in(
        tx: &Transaction<'_>,
        incoming: &SettingsBackupSection,
    ) -> Result<SettingsRestorePlan, SettingsError> {
        if incoming.notification_settings.is_some() {
            return Err(SettingsError::CorruptStoredSettings {
                field: "notificationSettings".to_owned(),
            });
        }
        let current = read_snapshot(tx)?;
        let mut snapshot = SettingsSnapshot {
            revision: current
                .revision
                .checked_add(1)
                .ok_or(SettingsError::PersistenceFailed)?,
            general: general_settings(),
            appearance: incoming.appearance.clone(),
            sidebar: incoming.sidebar.clone(),
        };
        normalize_and_validate_snapshot(&mut snapshot)?;
        Ok(SettingsRestorePlan { snapshot })
    }

    /// Applies a prepared restore in the coordinator-owned transaction.
    pub fn apply_settings_restore_in(
        tx: &Transaction<'_>,
        plan: &SettingsRestorePlan,
    ) -> Result<SettingsCommittedProjection, SettingsError> {
        write_snapshot(tx, &plan.snapshot)?;
        Ok(SettingsCommittedProjection {
            snapshot: plan.snapshot.clone(),
        })
    }

    /// Writes exact first-run settings in the coordinator-owned reset transaction.
    pub fn reset_settings_in(
        tx: &Transaction<'_>,
    ) -> Result<SettingsCommittedProjection, SettingsError> {
        let snapshot = SettingsSnapshot::defaults();
        write_snapshot(tx, &snapshot)?;
        Ok(SettingsCommittedProjection { snapshot })
    }

    /// Publishes one coordinator projection after its transaction commits.
    pub fn publish_data_change(&self, projection: SettingsCommittedProjection) {
        if let Ok(mut cache) = self.inner.cache.write() {
            *cache = projection.snapshot;
        }
    }

    /// Persists a complete snapshot and publishes it only after commit.
    fn persist_and_publish(
        &self,
        snapshot: SettingsSnapshot,
    ) -> Result<SettingsSnapshot, SettingsError> {
        self.inner
            .storage
            .with_transaction(|tx| write_snapshot(tx, &snapshot))?;
        let mut cache = self
            .inner
            .cache
            .write()
            .map_err(|_| SettingsError::Unavailable)?;
        *cache = snapshot.clone();
        Ok(snapshot)
    }

    /// Rejects new public operations after shutdown begins.
    fn ensure_available(&self) -> Result<(), SettingsError> {
        if self.inner.shutting_down.load(Ordering::Acquire) {
            Err(SettingsError::Unavailable)
        } else {
            Ok(())
        }
    }

    /// Clones the committed cache without repeating lifecycle admission checks.
    fn clone_cache(&self) -> Result<SettingsSnapshot, SettingsError> {
        self.inner
            .cache
            .read()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| SettingsError::Unavailable)
    }
}

/// Returns the latest committed application settings.
#[tauri::command]
pub(crate) async fn get_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AppSettingsDto, SettingsError> {
    let service = managed_service(&app)?;
    service.snapshot().map(|snapshot| snapshot.to_dto())
}

/// Validates and atomically persists a partial settings update.
#[tauri::command]
pub(crate) async fn update_settings<R: Runtime>(
    input: UpdateSettingsDto,
    window: WebviewWindow<R>,
) -> Result<AppSettingsDto, SettingsError> {
    authorize_main_caller(window.label())?;
    validate_update_shape(&input)?;
    let service = managed_service(window.app_handle())?;
    service.ensure_available()?;
    let gate = managed_gate(window.app_handle())?;
    let permit = gate.read_permit().await;
    tauri::async_runtime::spawn_blocking(move || service.update_admitted(&input, permit))
        .await
        .map_err(|_| SettingsError::PersistenceFailed)?
        .map(|snapshot| snapshot.to_dto())
}

/// Restores all Appearance fields to the built-in default theme.
#[tauri::command]
pub(crate) async fn restore_appearance_defaults<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<AppSettingsDto, SettingsError> {
    authorize_main_caller(window.label())?;
    let service = managed_service(window.app_handle())?;
    service.ensure_available()?;
    let gate = managed_gate(window.app_handle())?;
    let permit = gate.read_permit().await;
    tauri::async_runtime::spawn_blocking(move || {
        service.restore_appearance_defaults_admitted(permit)
    })
    .await
    .map_err(|_| SettingsError::PersistenceFailed)?
    .map(|snapshot| snapshot.to_dto())
}

/// Clones managed settings state without holding a Tauri state borrow across await.
fn managed_service<R: Runtime>(app: &AppHandle<R>) -> Result<SettingsService, SettingsError> {
    app.try_state::<SettingsService>()
        .map(|state| state.inner().clone())
        .ok_or(SettingsError::Unavailable)
}

/// Clones the managed maintenance gate without holding a state borrow across await.
fn managed_gate<R: Runtime>(app: &AppHandle<R>) -> Result<DataMaintenanceGate, SettingsError> {
    app.try_state::<DataMaintenanceGate>()
        .map(|state| state.inner().clone())
        .ok_or(SettingsError::Unavailable)
}

/// Restricts persistent settings mutations to the exact main window label.
fn authorize_main_caller(label: &str) -> Result<(), SettingsError> {
    if label == "main" {
        Ok(())
    } else {
        Err(SettingsError::UnauthorizedWindow)
    }
}

/// Rejects a missing, null-only, or nested empty update before admission.
fn validate_update_shape(patch: &UpdateSettingsDto) -> Result<(), SettingsError> {
    if patch.appearance.is_none() && patch.sidebar.is_none() {
        return Err(SettingsError::EmptyPatch);
    }
    if patch.appearance.as_ref().is_some_and(|value| {
        value.theme_mode.is_none()
            && value.theme_preset.is_none()
            && value.interface_colors.is_none()
            && value.terminal_palette.is_none()
            && value.interface_font_size_px.is_none()
            && value.terminal_font_size_px.is_none()
    }) || patch
        .sidebar
        .as_ref()
        .is_some_and(|value| value.width_px.is_none() && value.collapsed.is_none())
    {
        return Err(SettingsError::EmptyPatch);
    }
    Ok(())
}

/// Merges, normalizes, validates, and revisions one update against the latest snapshot.
fn merge_update(
    mut snapshot: SettingsSnapshot,
    patch: &UpdateSettingsDto,
) -> Result<SettingsSnapshot, SettingsError> {
    if let Some(appearance) = &patch.appearance {
        let supplies_colors =
            appearance.interface_colors.is_some() || appearance.terminal_palette.is_some();
        if appearance
            .theme_preset
            .is_some_and(|preset| preset != ThemePresetDto::Custom)
            && supplies_colors
        {
            return Err(SettingsError::InvalidPresetCombination);
        }
        if let Some(mode) = appearance.theme_mode {
            snapshot.appearance.theme_mode = mode;
        }
        if let Some(preset) = appearance.theme_preset {
            snapshot.appearance.theme_preset = preset;
            if preset != ThemePresetDto::Custom {
                let (interface_colors, terminal_palette) = preset_colors(preset);
                snapshot.appearance.interface_colors = interface_colors;
                snapshot.appearance.terminal_palette = terminal_palette;
            }
        }
        if let Some(colors) = &appearance.interface_colors {
            snapshot.appearance.interface_colors = colors.clone();
            snapshot.appearance.theme_preset = ThemePresetDto::Custom;
        }
        if let Some(palette) = &appearance.terminal_palette {
            snapshot.appearance.terminal_palette = palette.clone();
            snapshot.appearance.theme_preset = ThemePresetDto::Custom;
        }
        if let Some(size) = appearance.interface_font_size_px {
            snapshot.appearance.interface_font_size_px = size;
        }
        if let Some(size) = appearance.terminal_font_size_px {
            snapshot.appearance.terminal_font_size_px = size;
        }
    }
    if let Some(sidebar) = &patch.sidebar {
        if let Some(width) = sidebar.width_px {
            snapshot.sidebar.width_px = width;
        }
        if let Some(collapsed) = sidebar.collapsed {
            snapshot.sidebar.collapsed = collapsed;
        }
    }
    snapshot.revision = snapshot
        .revision
        .checked_add(1)
        .ok_or(SettingsError::PersistenceFailed)?;
    normalize_and_validate_snapshot(&mut snapshot)?;
    Ok(snapshot)
}

/// Returns the immutable General settings contract.
fn general_settings() -> GeneralSettingsDto {
    GeneralSettingsDto {
        interface_language: InterfaceLanguageDto::English,
        close_to_tray: true,
        show_tray_icon: true,
        ask_before_quitting: true,
        open_at_home_on_launch: true,
    }
}

/// Returns the exact default Appearance settings.
fn default_appearance() -> AppearanceSettingsDto {
    let (interface_colors, terminal_palette) = preset_colors(ThemePresetDto::Cream);
    AppearanceSettingsDto {
        theme_mode: ThemeModeDto::System,
        theme_preset: ThemePresetDto::Cream,
        interface_colors,
        terminal_palette,
        interface_font_size_px: 14,
        terminal_font_size_px: 13,
    }
}

/// Returns all color tokens for one built-in preset.
fn preset_colors(preset: ThemePresetDto) -> (InterfaceThemeColorsDto, TerminalPaletteDto) {
    match preset {
        ThemePresetDto::Cream => (
            interface_theme(
                ["#cc785c", "#faf9f5", "#f5f0e8", "#141413"],
                ["#e08a6c", "#1e1b18", "#26211d", "#f7f2ea"],
            ),
            terminal_palette("#181715", "#faf9f5", &CREAM_ANSI),
        ),
        ThemePresetDto::Ink => (
            interface_theme(
                ["#a95f4a", "#f6f5f2", "#eceae6", "#171717"],
                ["#cc785c", "#181715", "#1f1e1b", "#faf9f5"],
            ),
            terminal_palette("#181715", "#faf9f5", &CREAM_ANSI),
        ),
        ThemePresetDto::Paper => (
            interface_theme(
                ["#3b6ea8", "#ffffff", "#f1efe9", "#141413"],
                ["#78a9dd", "#1b1d21", "#22252a", "#f7f7f5"],
            ),
            terminal_palette("#ffffff", "#141413", &PAPER_ANSI),
        ),
        ThemePresetDto::Custom => unreachable!("custom has no built-in palette"),
    }
}

/// Builds both interface color modes from compact constant tables.
fn interface_theme(light: [&str; 4], dark: [&str; 4]) -> InterfaceThemeColorsDto {
    InterfaceThemeColorsDto {
        light: interface_colors(light),
        dark: interface_colors(dark),
    }
}

/// Builds one interface color set from its ordered constant table.
fn interface_colors(values: [&str; 4]) -> InterfaceColorsDto {
    InterfaceColorsDto {
        accent: values[0].to_owned(),
        canvas: values[1].to_owned(),
        sidebar: values[2].to_owned(),
        text: values[3].to_owned(),
    }
}

/// Builds one terminal palette from its immutable preset tokens.
fn terminal_palette(background: &str, foreground: &str, ansi: &[&str; 16]) -> TerminalPaletteDto {
    TerminalPaletteDto {
        background: background.to_owned(),
        foreground: foreground.to_owned(),
        ansi_colors: std::array::from_fn(|index| ansi[index].to_owned()),
    }
}

/// Normalizes every color and validates the complete merged snapshot.
fn normalize_and_validate_snapshot(snapshot: &mut SettingsSnapshot) -> Result<(), SettingsError> {
    normalize_interface_colors(
        &mut snapshot.appearance.interface_colors.light,
        "interfaceColors.light",
    )?;
    normalize_interface_colors(
        &mut snapshot.appearance.interface_colors.dark,
        "interfaceColors.dark",
    )?;
    normalize_color(
        &mut snapshot.appearance.terminal_palette.background,
        "terminalPalette.background",
    )?;
    normalize_color(
        &mut snapshot.appearance.terminal_palette.foreground,
        "terminalPalette.foreground",
    )?;
    for (index, color) in snapshot
        .appearance
        .terminal_palette
        .ansi_colors
        .iter_mut()
        .enumerate()
    {
        normalize_color(color, &format!("terminalPalette.ansiColors.{index}"))?;
    }

    validate_interface_contrast(
        &snapshot.appearance.interface_colors.light,
        "interfaceColors.light",
    )?;
    validate_interface_contrast(
        &snapshot.appearance.interface_colors.dark,
        "interfaceColors.dark",
    )?;
    require_contrast(
        &snapshot.appearance.terminal_palette.foreground,
        &snapshot.appearance.terminal_palette.background,
        4.5,
        "terminalPalette.foreground",
        "terminalPalette.background",
    )?;
    validate_range(
        u16::from(snapshot.appearance.interface_font_size_px),
        "interfaceFontSizePx",
        INTERFACE_FONT_MIN,
        INTERFACE_FONT_MAX,
    )?;
    validate_range(
        u16::from(snapshot.appearance.terminal_font_size_px),
        "terminalFontSizePx",
        TERMINAL_FONT_MIN,
        TERMINAL_FONT_MAX,
    )?;
    validate_range(
        snapshot.sidebar.width_px,
        "sidebar.widthPx",
        SIDEBAR_WIDTH_MIN,
        SIDEBAR_WIDTH_MAX,
    )?;

    if snapshot.appearance.theme_preset != ThemePresetDto::Custom {
        let (expected_interface, expected_terminal) =
            preset_colors(snapshot.appearance.theme_preset);
        if snapshot.appearance.interface_colors != expected_interface
            || snapshot.appearance.terminal_palette != expected_terminal
        {
            return Err(SettingsError::InvalidPresetCombination);
        }
    }
    Ok(())
}

/// Normalizes all four colors in one effective interface mode.
fn normalize_interface_colors(
    colors: &mut InterfaceColorsDto,
    prefix: &str,
) -> Result<(), SettingsError> {
    normalize_color(&mut colors.accent, &format!("{prefix}.accent"))?;
    normalize_color(&mut colors.canvas, &format!("{prefix}.canvas"))?;
    normalize_color(&mut colors.sidebar, &format!("{prefix}.sidebar"))?;
    normalize_color(&mut colors.text, &format!("{prefix}.text"))
}

/// Validates and lowercases one strict six-digit hexadecimal color.
fn normalize_color(value: &mut String, field: &str) -> Result<(), SettingsError> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err(SettingsError::InvalidColor {
            field: field.to_owned(),
        });
    }
    value.make_ascii_lowercase();
    Ok(())
}

/// Validates every required WCAG pair in one interface color mode.
fn validate_interface_contrast(
    colors: &InterfaceColorsDto,
    prefix: &str,
) -> Result<(), SettingsError> {
    require_contrast(
        &colors.text,
        &colors.canvas,
        4.5,
        &format!("{prefix}.text"),
        &format!("{prefix}.canvas"),
    )?;
    require_contrast(
        &colors.text,
        &colors.sidebar,
        4.5,
        &format!("{prefix}.text"),
        &format!("{prefix}.sidebar"),
    )?;
    require_contrast(
        &colors.accent,
        &colors.canvas,
        3.0,
        &format!("{prefix}.accent"),
        &format!("{prefix}.canvas"),
    )
}

/// Rejects a color pair whose WCAG contrast falls below the supplied threshold.
fn require_contrast(
    foreground_color: &str,
    background_color: &str,
    minimum: f64,
    foreground_field: &str,
    background_field: &str,
) -> Result<(), SettingsError> {
    if contrast_ratio(foreground_color, background_color) + f64::EPSILON < minimum {
        return Err(SettingsError::ContrastTooLow {
            foreground: foreground_field.to_owned(),
            background: background_field.to_owned(),
        });
    }
    Ok(())
}

/// Computes the WCAG contrast ratio for two already normalized colors.
fn contrast_ratio(first: &str, second: &str) -> f64 {
    let first = relative_luminance(first);
    let second = relative_luminance(second);
    let (lighter, darker) = if first >= second {
        (first, second)
    } else {
        (second, first)
    };
    (lighter + 0.05) / (darker + 0.05)
}

/// Computes WCAG relative luminance from one strict sRGB color.
fn relative_luminance(color: &str) -> f64 {
    let channel = |start: usize| {
        let value = u8::from_str_radix(&color[start..start + 2], 16)
            .expect("validated colors always contain hexadecimal channels")
            as f64
            / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

/// Validates one bounded integer and returns the exact field bounds on failure.
fn validate_range(value: u16, field: &str, min: u16, max: u16) -> Result<(), SettingsError> {
    if !(min..=max).contains(&value) {
        Err(SettingsError::ValueOutOfRange {
            field: field.to_owned(),
            min,
            max,
        })
    } else {
        Ok(())
    }
}

/// Holds the untrusted scalar values decoded directly from SQLite.
struct RawSettingsRow {
    revision: i64,
    theme_mode: String,
    theme_preset: String,
    light_accent: String,
    light_canvas: String,
    light_sidebar: String,
    light_text: String,
    dark_accent: String,
    dark_canvas: String,
    dark_sidebar: String,
    dark_text: String,
    terminal_background: String,
    terminal_foreground: String,
    terminal_ansi: String,
    interface_font_size: i64,
    terminal_font_size: i64,
    sidebar_width: i64,
    sidebar_collapsed: i64,
}

/// Reads and validates the singleton settings row from a connection or transaction.
fn read_snapshot(connection: &Connection) -> Result<SettingsSnapshot, SettingsError> {
    let raw = connection
        .query_row(
            "SELECT revision, theme_mode, theme_preset, light_accent_color, \
             light_canvas_color, light_sidebar_color, light_text_color, dark_accent_color, \
             dark_canvas_color, dark_sidebar_color, dark_text_color, terminal_background, \
             terminal_foreground, terminal_ansi_colors_json, interface_font_size_px, \
             terminal_font_size_px, sidebar_width_px, sidebar_collapsed \
             FROM settings WHERE id = ?1",
            params![1],
            // Copies every untrusted scalar so validation runs after the row borrow ends.
            |row| {
                Ok(RawSettingsRow {
                    revision: row.get(0)?,
                    theme_mode: row.get(1)?,
                    theme_preset: row.get(2)?,
                    light_accent: row.get(3)?,
                    light_canvas: row.get(4)?,
                    light_sidebar: row.get(5)?,
                    light_text: row.get(6)?,
                    dark_accent: row.get(7)?,
                    dark_canvas: row.get(8)?,
                    dark_sidebar: row.get(9)?,
                    dark_text: row.get(10)?,
                    terminal_background: row.get(11)?,
                    terminal_foreground: row.get(12)?,
                    terminal_ansi: row.get(13)?,
                    interface_font_size: row.get(14)?,
                    terminal_font_size: row.get(15)?,
                    sidebar_width: row.get(16)?,
                    sidebar_collapsed: row.get(17)?,
                })
            },
        )
        .optional()
        .map_err(SettingsError::from)?
        .ok_or_else(|| corrupt("id"))?;
    decode_snapshot(raw)
}

/// Converts one raw SQLite row into a fully validated native snapshot.
fn decode_snapshot(raw: RawSettingsRow) -> Result<SettingsSnapshot, SettingsError> {
    let revision = u64::try_from(raw.revision).map_err(|_| corrupt("revision"))?;
    let interface_font_size_px =
        u8::try_from(raw.interface_font_size).map_err(|_| corrupt("interfaceFontSizePx"))?;
    let terminal_font_size_px =
        u8::try_from(raw.terminal_font_size).map_err(|_| corrupt("terminalFontSizePx"))?;
    let sidebar_width = u16::try_from(raw.sidebar_width).map_err(|_| corrupt("sidebar.widthPx"))?;
    let mut snapshot = SettingsSnapshot {
        revision,
        general: general_settings(),
        appearance: AppearanceSettingsDto {
            theme_mode: parse_theme_mode(&raw.theme_mode)?,
            theme_preset: parse_theme_preset(&raw.theme_preset)?,
            interface_colors: InterfaceThemeColorsDto {
                light: InterfaceColorsDto {
                    accent: raw.light_accent,
                    canvas: raw.light_canvas,
                    sidebar: raw.light_sidebar,
                    text: raw.light_text,
                },
                dark: InterfaceColorsDto {
                    accent: raw.dark_accent,
                    canvas: raw.dark_canvas,
                    sidebar: raw.dark_sidebar,
                    text: raw.dark_text,
                },
            },
            terminal_palette: TerminalPaletteDto {
                background: raw.terminal_background,
                foreground: raw.terminal_foreground,
                ansi_colors: parse_ansi_colors(&raw.terminal_ansi)?,
            },
            interface_font_size_px,
            terminal_font_size_px,
        },
        sidebar: SidebarSettingsDto {
            width_px: sidebar_width,
            collapsed: parse_bool(raw.sidebar_collapsed, "sidebar.collapsed")?,
        },
    };
    normalize_and_validate_snapshot(&mut snapshot).map_err(as_corrupt)?;
    Ok(snapshot)
}

/// Parses one stored theme mode without applying a default fallback.
fn parse_theme_mode(value: &str) -> Result<ThemeModeDto, SettingsError> {
    match value {
        "light" => Ok(ThemeModeDto::Light),
        "dark" => Ok(ThemeModeDto::Dark),
        "system" => Ok(ThemeModeDto::System),
        _ => Err(corrupt("themeMode")),
    }
}

/// Parses one stored theme preset without applying a default fallback.
fn parse_theme_preset(value: &str) -> Result<ThemePresetDto, SettingsError> {
    match value {
        "cream" => Ok(ThemePresetDto::Cream),
        "ink" => Ok(ThemePresetDto::Ink),
        "paper" => Ok(ThemePresetDto::Paper),
        "custom" => Ok(ThemePresetDto::Custom),
        _ => Err(corrupt("themePreset")),
    }
}

/// Parses one persisted SQLite boolean strictly as zero or one.
fn parse_bool(value: i64, field: &str) -> Result<bool, SettingsError> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(corrupt(field)),
    }
}

/// Parses the canonical JSON representation of the fixed sixteen-color ANSI array.
fn parse_ansi_colors(value: &str) -> Result<[String; 16], SettingsError> {
    let value = value.trim();
    let Some(contents) = value
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    else {
        return Err(corrupt("terminalPalette.ansiColors"));
    };
    let values = if contents.is_empty() {
        Vec::new()
    } else {
        contents
            .split(',')
            .map(|item| {
                item.trim()
                    .strip_prefix('"')
                    .and_then(|rest| rest.strip_suffix('"'))
                    .map(str::to_owned)
                    .ok_or_else(|| corrupt("terminalPalette.ansiColors"))
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    values
        .try_into()
        .map_err(|_| corrupt("terminalPalette.ansiColors"))
}

/// Serializes the fixed ANSI array into its canonical compact JSON representation.
fn encode_ansi_colors(colors: &[String; 16]) -> String {
    let quoted = colors
        .iter()
        .map(|color| format!("\"{color}\""))
        .collect::<Vec<_>>();
    format!("[{}]", quoted.join(","))
}

/// Updates the complete singleton row and requires exactly one affected row.
fn write_snapshot(
    connection: &Connection,
    snapshot: &SettingsSnapshot,
) -> Result<(), SettingsError> {
    let revision =
        i64::try_from(snapshot.revision).map_err(|_| SettingsError::PersistenceFailed)?;
    let appearance = &snapshot.appearance;
    let affected = connection.execute(
        "UPDATE settings SET revision = ?1, theme_mode = ?2, theme_preset = ?3, \
         light_accent_color = ?4, light_canvas_color = ?5, light_sidebar_color = ?6, \
         light_text_color = ?7, dark_accent_color = ?8, dark_canvas_color = ?9, \
         dark_sidebar_color = ?10, dark_text_color = ?11, terminal_background = ?12, \
         terminal_foreground = ?13, terminal_ansi_colors_json = ?14, \
         interface_font_size_px = ?15, terminal_font_size_px = ?16, sidebar_width_px = ?17, \
         sidebar_collapsed = ?18 WHERE id = 1",
        params![
            revision,
            theme_mode_text(appearance.theme_mode),
            theme_preset_text(appearance.theme_preset),
            appearance.interface_colors.light.accent,
            appearance.interface_colors.light.canvas,
            appearance.interface_colors.light.sidebar,
            appearance.interface_colors.light.text,
            appearance.interface_colors.dark.accent,
            appearance.interface_colors.dark.canvas,
            appearance.interface_colors.dark.sidebar,
            appearance.interface_colors.dark.text,
            appearance.terminal_palette.background,
            appearance.terminal_palette.foreground,
            encode_ansi_colors(&appearance.terminal_palette.ansi_colors),
            appearance.interface_font_size_px,
            appearance.terminal_font_size_px,
            snapshot.sidebar.width_px,
            i64::from(snapshot.sidebar.collapsed),
        ],
    )?;
    if affected != 1 {
        return Err(SettingsError::PersistenceFailed);
    }
    Ok(())
}

/// Returns the stable SQLite literal for one theme mode.
fn theme_mode_text(value: ThemeModeDto) -> &'static str {
    match value {
        ThemeModeDto::Light => "light",
        ThemeModeDto::Dark => "dark",
        ThemeModeDto::System => "system",
    }
}

/// Returns the stable SQLite literal for one theme preset.
fn theme_preset_text(value: ThemePresetDto) -> &'static str {
    match value {
        ThemePresetDto::Cream => "cream",
        ThemePresetDto::Ink => "ink",
        ThemePresetDto::Paper => "paper",
        ThemePresetDto::Custom => "custom",
    }
}

/// Constructs one corrupt-row error for a known settings field.
fn corrupt(field: &str) -> SettingsError {
    SettingsError::CorruptStoredSettings {
        field: field.to_owned(),
    }
}

/// Converts validation details into their corrupt persisted-field category.
fn as_corrupt(error: SettingsError) -> SettingsError {
    match error {
        SettingsError::InvalidColor { field } | SettingsError::ValueOutOfRange { field, .. } => {
            corrupt(&field)
        }
        SettingsError::ContrastTooLow { foreground, .. } => corrupt(&foreground),
        SettingsError::InvalidPresetCombination => corrupt("themePreset"),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verifies the exact General invariants and first-run snapshot.
    #[test]
    fn defaults_match_the_phase_one_contract() {
        let snapshot = SettingsSnapshot::defaults();
        assert_eq!(snapshot.revision, 0);
        assert_eq!(
            snapshot.general.interface_language,
            InterfaceLanguageDto::English
        );
        assert!(snapshot.general.close_to_tray);
        assert!(snapshot.general.show_tray_icon);
        assert!(snapshot.general.ask_before_quitting);
        assert!(snapshot.general.open_at_home_on_launch);
        assert_eq!(snapshot.appearance, default_appearance());
        assert_eq!(snapshot.sidebar.width_px, 280);
        assert!(!snapshot.sidebar.collapsed);
        assert_eq!(snapshot.to_dto().revision, "0");
    }

    /// Verifies every built-in preset token table against the specification.
    #[test]
    fn built_in_presets_contain_the_exact_tokens() {
        let (cream, cream_terminal) = preset_colors(ThemePresetDto::Cream);
        assert_eq!(cream.light.accent, "#cc785c");
        assert_eq!(cream.dark.text, "#f7f2ea");
        assert_eq!(cream_terminal.ansi_colors[15], "#faf9f5");
        let (ink, ink_terminal) = preset_colors(ThemePresetDto::Ink);
        assert_eq!(ink.light.canvas, "#f6f5f2");
        assert_eq!(ink.dark.sidebar, "#1f1e1b");
        assert_eq!(ink_terminal, cream_terminal);
        let (paper, paper_terminal) = preset_colors(ThemePresetDto::Paper);
        assert_eq!(paper.light.accent, "#3b6ea8");
        assert_eq!(paper.dark.canvas, "#1b1d21");
        assert_eq!(paper_terminal.background, "#ffffff");
        assert_eq!(paper_terminal.ansi_colors[0], "#141413");
    }

    /// Verifies strict color syntax and lowercase normalization.
    #[test]
    fn colors_accept_only_six_digit_hex_and_normalize_case() {
        let mut color = "#A1B2C3".to_owned();
        assert_eq!(normalize_color(&mut color, "field"), Ok(()));
        assert_eq!(color, "#a1b2c3");
        for invalid in ["#FFF", "#11223344", "red", "rgb(1,2,3)"] {
            assert!(matches!(
                normalize_color(&mut invalid.to_owned(), "field"),
                Err(SettingsError::InvalidColor { .. })
            ));
        }
    }

    /// Verifies WCAG contrast accepts exact thresholds and rejects values below them.
    #[test]
    fn contrast_thresholds_are_inclusive() {
        assert_eq!(
            require_contrast("#767676", "#ffffff", 4.5, "a", "b"),
            Ok(())
        );
        assert!(require_contrast("#777777", "#ffffff", 4.5, "a", "b").is_err());
        assert_eq!(
            require_contrast("#949494", "#ffffff", 3.0, "a", "b"),
            Ok(())
        );
        assert!(require_contrast("#959595", "#ffffff", 3.0, "a", "b").is_err());
    }

    /// Verifies font and sidebar integer bounds at and around every endpoint.
    #[test]
    fn integer_bounds_are_inclusive() {
        for valid in [12, 20] {
            assert_eq!(validate_range(valid, "ui", 12, 20), Ok(()));
        }
        for invalid in [11, 21] {
            assert!(validate_range(invalid, "ui", 12, 20).is_err());
        }
        for valid in [10, 24] {
            assert_eq!(validate_range(valid, "terminal", 10, 24), Ok(()));
        }
        for invalid in [9, 25] {
            assert!(validate_range(invalid, "terminal", 10, 24).is_err());
        }
        for valid in [200, 420] {
            assert_eq!(validate_range(valid, "sidebar", 200, 420), Ok(()));
        }
        for invalid in [199, 421] {
            assert!(validate_range(invalid, "sidebar", 200, 420).is_err());
        }
    }

    /// Verifies empty nested patches and preset conflicts are rejected.
    #[test]
    fn patch_shape_and_preset_rules_are_enforced() {
        assert_eq!(
            validate_update_shape(&UpdateSettingsDto::default()),
            Err(SettingsError::EmptyPatch)
        );
        assert_eq!(
            validate_update_shape(&UpdateSettingsDto {
                appearance: Some(AppearanceSettingsPatchDto::default()),
                sidebar: None,
            }),
            Err(SettingsError::EmptyPatch)
        );
        let patch = UpdateSettingsDto {
            appearance: Some(AppearanceSettingsPatchDto {
                theme_preset: Some(ThemePresetDto::Ink),
                interface_colors: Some(default_appearance().interface_colors),
                ..Default::default()
            }),
            sidebar: None,
        };
        assert_eq!(
            merge_update(SettingsSnapshot::defaults(), &patch),
            Err(SettingsError::InvalidPresetCombination)
        );
    }

    /// Verifies custom colors and explicit custom selection preserve the documented semantics.
    #[test]
    fn custom_patch_rules_preserve_merged_colors() {
        let mut colors = default_appearance().interface_colors;
        colors.light.accent = "#000000".to_owned();
        let patch = UpdateSettingsDto {
            appearance: Some(AppearanceSettingsPatchDto {
                interface_colors: Some(colors),
                ..Default::default()
            }),
            sidebar: None,
        };
        let customized = merge_update(SettingsSnapshot::defaults(), &patch)
            .expect("the high-contrast custom colors should be accepted");
        assert_eq!(customized.appearance.theme_preset, ThemePresetDto::Custom);
        let palette = customized.appearance.terminal_palette.clone();
        let marked = merge_update(
            customized,
            &UpdateSettingsDto {
                appearance: Some(AppearanceSettingsPatchDto {
                    theme_preset: Some(ThemePresetDto::Custom),
                    ..Default::default()
                }),
                sidebar: None,
            },
        )
        .expect("custom without colors should preserve the palette");
        assert_eq!(marked.appearance.terminal_palette, palette);
    }

    /// Verifies decimal revision formatting remains unsigned and has no leading zeroes.
    #[test]
    fn revision_formats_as_a_decimal_string() {
        let mut snapshot = SettingsSnapshot::defaults();
        snapshot.revision = 9_007_199_254_740_993;
        assert_eq!(snapshot.to_dto().revision, "9007199254740993");
    }

    /// Verifies poisoned cache and mutation locks map to Unavailable without fallback state.
    #[test]
    fn poisoned_service_locks_are_unavailable() {
        use std::panic::{AssertUnwindSafe, catch_unwind};

        let cache_dir = tempfile::TempDir::new().expect("the temporary directory should exist");
        let cache_service = SettingsService::new(
            Storage::open(cache_dir.path()).expect("storage should open"),
            DataMaintenanceGate::new(),
        )
        .expect("settings should hydrate");
        let cache_clone = cache_service.clone();
        let cache_panic = catch_unwind(AssertUnwindSafe(
            // Panics while owning the cache guard so the next read observes poison.
            || {
                let _guard = cache_clone
                    .inner
                    .cache
                    .write()
                    .expect("the cache lock should initially work");
                panic!("poison the settings cache");
            },
        ));
        assert!(cache_panic.is_err());
        assert_eq!(cache_service.snapshot(), Err(SettingsError::Unavailable));

        let write_dir = tempfile::TempDir::new().expect("the temporary directory should exist");
        let write_service = SettingsService::new(
            Storage::open(write_dir.path()).expect("storage should open"),
            DataMaintenanceGate::new(),
        )
        .expect("settings should hydrate");
        let write_clone = write_service.clone();
        let write_panic = catch_unwind(AssertUnwindSafe(
            // Panics while owning the mutation guard so the next write observes poison.
            || {
                let _guard = write_clone
                    .inner
                    .write_gate
                    .lock()
                    .expect("the write lock should initially work");
                panic!("poison the settings write gate");
            },
        ));
        assert!(write_panic.is_err());
        assert_eq!(
            write_service.update(&UpdateSettingsDto {
                appearance: None,
                sidebar: Some(SidebarSettingsPatchDto {
                    width_px: Some(300),
                    collapsed: None,
                }),
            }),
            Err(SettingsError::Unavailable)
        );
    }
}
