use std::sync::Arc;

use rusqlite::params;
use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use xwork_lib::{
    app::notify_settings_shutdown,
    settings::{
        AppearanceSettingsPatchDto, CliOsNotificationStatesDto, NotificationSettingsDto,
        NotificationSettingsPatchDto, SettingsError, SettingsService, SettingsSnapshot,
        SidebarSettingsPatchDto, ThemeModeDto, ThemePresetDto, UpdateSettingsDto,
    },
    shared::DataMaintenanceGate,
    storage::{Storage, StorageError},
};

/// Owns one isolated settings service and its temporary database.
struct ServiceHarness {
    service: SettingsService,
    storage: Storage,
    gate: DataMaintenanceGate,
    _app_data: TempDir,
}

impl ServiceHarness {
    /// Opens a migrated temporary database and hydrates one settings service.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let storage = Storage::open(app_data.path()).expect("isolated storage should open");
        let gate = DataMaintenanceGate::new();
        let service = SettingsService::new(storage.clone(), gate.clone())
            .expect("default settings should hydrate");
        Self {
            service,
            storage,
            gate,
            _app_data: app_data,
        }
    }
}

/// Reads the isolated database schema version.
fn schema_version(storage: &Storage) -> u32 {
    storage
        .with_connection(
            // Reads the scalar migration marker through the public storage seam.
            |connection| {
                connection
                    .pragma_query_value(None, "user_version", |row| row.get(0))
                    .map_err(|source| StorageError::ReadSchemaVersion { source })
            },
        )
        .expect("the schema version should be readable")
}

/// Returns the persisted settings revision for atomicity assertions.
fn persisted_revision(storage: &Storage) -> i64 {
    storage
        .with_connection(
            // Reads only the settings revision from the isolated fixture.
            |connection| {
                connection
                    .query_row(
                        "SELECT revision FROM settings WHERE id = ?1",
                        params![1],
                        |row| row.get(0),
                    )
                    .map_err(SettingsError::from)
            },
        )
        .expect("the persisted revision should be readable")
}

/// Verifies migration 0002 creates one exact default singleton row.
#[test]
fn settings_migration_creates_single_default_row() {
    let app_data = TempDir::new().expect("the temporary app data should be created");
    let storage = Storage::open(app_data.path()).expect("isolated storage should open");

    assert_eq!(schema_version(&storage), 10);
    let settings = SettingsService::new(storage.clone(), DataMaintenanceGate::new()).unwrap();
    assert_eq!(
        settings.snapshot().unwrap().notifications,
        NotificationSettingsDto::default()
    );
    let values = storage
        .with_connection(
            // Casts scalar defaults to text so one compact assertion covers the full row.
            |connection| {
                connection
                    .query_row(
                        "SELECT CAST(id AS TEXT), CAST(revision AS TEXT), theme_mode, theme_preset, \
                         light_accent_color, light_canvas_color, light_sidebar_color, light_text_color, \
                         dark_accent_color, dark_canvas_color, dark_sidebar_color, dark_text_color, \
                         terminal_background, terminal_foreground, terminal_ansi_colors_json, \
                         CAST(interface_font_size_px AS TEXT), CAST(terminal_font_size_px AS TEXT), \
                         CAST(sidebar_width_px AS TEXT), CAST(sidebar_collapsed AS TEXT) FROM settings",
                        [],
                        // Copies every default column from the single migration row.
                        |row| {
                            (0..19)
                                .map(|index| row.get::<_, String>(index))
                                .collect::<rusqlite::Result<Vec<_>>>()
                        },
                    )
                    .map_err(SettingsError::from)
            },
        )
        .expect("the default settings row should be readable");
    assert_eq!(
        values,
        vec![
            "1",
            "0",
            "system",
            "cream",
            "#cc785c",
            "#faf9f5",
            "#f5f0e8",
            "#141413",
            "#e08a6c",
            "#1e1b18",
            "#26211d",
            "#f7f2ea",
            "#181715",
            "#faf9f5",
            "[\"#181715\",\"#c64545\",\"#5db872\",\"#e8a55a\",\"#93b4d6\",\"#b48ead\",\"#5db8a6\",\"#a09d96\",\"#3d3d3a\",\"#e08a8a\",\"#8fd19e\",\"#f0c48a\",\"#b4cde6\",\"#d0b0d8\",\"#8ed4c6\",\"#faf9f5\"]",
            "14",
            "13",
            "280",
            "0",
        ]
    );
}

/// Verifies service hydration preserves committed settings across reopening storage.
#[test]
fn service_hydrates_default_and_survives_restart() {
    let app_data = TempDir::new().expect("the temporary app data should be created");
    let storage = Storage::open(app_data.path()).expect("isolated storage should open");
    let first = SettingsService::new(storage.clone(), DataMaintenanceGate::new())
        .expect("default settings should hydrate");
    let updated = first
        .update(&UpdateSettingsDto {
            notifications: None,
            appearance: Some(AppearanceSettingsPatchDto {
                theme_mode: Some(ThemeModeDto::System),
                terminal_font_size_px: Some(18),
                ..Default::default()
            }),
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: Some(320),
                collapsed: Some(true),
            }),
        })
        .expect("the settings update should commit");
    drop(first);
    drop(storage);

    let reopened = Storage::open(app_data.path()).expect("storage should reopen");
    let hydrated = SettingsService::new(reopened, DataMaintenanceGate::new())
        .expect("committed settings should rehydrate")
        .snapshot()
        .expect("the hydrated snapshot should be readable");
    assert_eq!(hydrated, updated);
    assert_eq!(hydrated.revision, 1);
    assert_eq!(hydrated.appearance.theme_mode, ThemeModeDto::System);
}

/// Verifies a multi-section patch merges atomically and increments once.
#[test]
fn update_persists_merged_sections_and_revision() {
    let harness = ServiceHarness::new();
    let updated = harness
        .service
        .update(&UpdateSettingsDto {
            notifications: None,
            appearance: Some(AppearanceSettingsPatchDto {
                theme_preset: Some(ThemePresetDto::Ink),
                interface_font_size_px: Some(20),
                ..Default::default()
            }),
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: Some(420),
                collapsed: Some(true),
            }),
        })
        .expect("the multi-section update should commit");

    assert_eq!(updated.revision, 1);
    assert_eq!(updated.appearance.theme_preset, ThemePresetDto::Ink);
    assert_eq!(updated.appearance.interface_font_size_px, 20);
    assert_eq!(updated.sidebar.width_px, 420);
    assert!(updated.sidebar.collapsed);
    assert_eq!(persisted_revision(&harness.storage), 1);
}

/// Verifies invalid patches leave the row, cache, and revision unchanged.
#[test]
fn invalid_patch_changes_nothing() {
    let harness = ServiceHarness::new();
    let before = harness
        .service
        .snapshot()
        .expect("the cache should be readable");
    let error = harness
        .service
        .update(&UpdateSettingsDto {
            notifications: None,
            appearance: Some(AppearanceSettingsPatchDto {
                interface_font_size_px: Some(11),
                ..Default::default()
            }),
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: Some(300),
                collapsed: None,
            }),
        })
        .expect_err("the invalid font size should reject the whole patch");

    assert!(matches!(error, SettingsError::ValueOutOfRange { .. }));
    assert_eq!(harness.service.snapshot(), Ok(before));
    assert_eq!(persisted_revision(&harness.storage), 0);
}

/// Verifies a SQLite write failure is sanitized and leaves the cache untouched.
#[test]
fn sqlite_failure_maps_to_persistence_failed_and_keeps_cache() {
    let harness = ServiceHarness::new();
    let before = harness
        .service
        .snapshot()
        .expect("the cache should be readable");
    harness
        .storage
        .with_connection(
            // Removes only the isolated fixture table to force the next update to fail.
            |connection| {
                connection
                    .execute("DROP TABLE settings", [])
                    .map(|_| ())
                    .map_err(SettingsError::from)
            },
        )
        .expect("the fixture table should be dropped");

    let error = harness
        .service
        .update(&UpdateSettingsDto {
            notifications: None,
            appearance: None,
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: None,
                collapsed: Some(true),
            }),
        })
        .expect_err("the missing table should reject persistence");
    assert_eq!(error, SettingsError::PersistenceFailed);
    assert_eq!(harness.service.snapshot(), Ok(before));
}

/// Verifies restore changes only Appearance and always creates a new revision.
#[test]
fn restore_appearance_defaults_keeps_sidebar_and_increments_revision() {
    let harness = ServiceHarness::new();
    let first_restore = harness
        .service
        .restore_appearance_defaults()
        .expect("restoring default state should still commit");
    assert_eq!(first_restore.revision, 1);
    let changed = harness
        .service
        .update(&UpdateSettingsDto {
            notifications: None,
            appearance: Some(AppearanceSettingsPatchDto {
                theme_preset: Some(ThemePresetDto::Paper),
                ..Default::default()
            }),
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: Some(333),
                collapsed: Some(true),
            }),
        })
        .expect("the fixture update should commit");
    let restored = harness
        .service
        .restore_appearance_defaults()
        .expect("Appearance should restore");
    assert_eq!(restored.revision, changed.revision + 1);
    assert_eq!(restored.appearance, SettingsSnapshot::defaults().appearance);
    assert_eq!(restored.sidebar, changed.sidebar);
    assert_eq!(restored.general, changed.general);
}

/// Verifies concurrent disjoint patches serialize against the latest committed cache.
#[test]
fn concurrent_disjoint_patches_serialize() {
    let harness = ServiceHarness::new();
    let first = harness.service.clone();
    let second = harness.service.clone();
    let width = std::thread::spawn(move || {
        first.update(&UpdateSettingsDto {
            notifications: None,
            appearance: None,
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: Some(360),
                collapsed: None,
            }),
        })
    });
    let font = std::thread::spawn(move || {
        second.update(&UpdateSettingsDto {
            notifications: None,
            appearance: Some(AppearanceSettingsPatchDto {
                interface_font_size_px: Some(16),
                ..Default::default()
            }),
            sidebar: None,
        })
    });
    width
        .join()
        .expect("the width thread should join")
        .expect("width should commit");
    font.join()
        .expect("the font thread should join")
        .expect("font should commit");

    let snapshot = harness
        .service
        .snapshot()
        .expect("the cache should be readable");
    assert_eq!(snapshot.revision, 2);
    assert_eq!(snapshot.sidebar.width_px, 360);
    assert_eq!(snapshot.appearance.interface_font_size_px, 16);
}

/// Verifies shutdown rejects new reads and writes without changing persistence.
#[test]
fn begin_shutdown_rejects_new_operations_with_unavailable() {
    let harness = ServiceHarness::new();
    harness.service.begin_shutdown();
    assert_eq!(harness.service.snapshot(), Err(SettingsError::Unavailable));
    assert!(matches!(
        harness.service.subscribe(),
        Err(SettingsError::Unavailable)
    ));
    assert_eq!(
        harness.service.update(&UpdateSettingsDto {
            notifications: None,
            appearance: None,
            sidebar: Some(SidebarSettingsPatchDto {
                width_px: None,
                collapsed: Some(true),
            }),
        }),
        Err(SettingsError::Unavailable)
    );
    assert_eq!(persisted_revision(&harness.storage), 0);
}

/// Verifies representative corrupt rows fail hydration without default substitution.
#[test]
fn corrupt_rows_are_rejected_during_hydration() {
    let cases = [
        ("UPDATE settings SET theme_mode = 'unknown'", "themeMode"),
        (
            "UPDATE settings SET terminal_activity_notifications_enabled = 2",
            "notifications.terminalActivityEnabled",
        ),
        (
            "UPDATE settings SET notify_os_needs_input = 2",
            "notifications.terminalOsStates.needsInput",
        ),
        (
            "UPDATE settings SET notify_os_process_finished = 2",
            "notifications.terminalOsStates.processFinished",
        ),
        (
            "UPDATE settings SET notify_os_process_exited_with_error = 2",
            "notifications.terminalOsStates.processExitedWithError",
        ),
        (
            "UPDATE settings SET event_reminder_notifications_enabled = 2",
            "notifications.eventRemindersEnabled",
        ),
        (
            "UPDATE settings SET terminal_ansi_colors_json = '[\"#000000\"]'",
            "terminalPalette.ansiColors",
        ),
        (
            "UPDATE settings SET light_accent_color = 'red'",
            "interfaceColors.light.accent",
        ),
        (
            "UPDATE settings SET interface_font_size_px = 11",
            "interfaceFontSizePx",
        ),
    ];
    for (statement, expected_field) in cases {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let storage = Storage::open(app_data.path()).expect("isolated storage should open");
        storage
            .with_connection(
                // Bypasses schema checks only to arrange an intentionally corrupt startup row.
                |connection| {
                    connection
                        .execute_batch("PRAGMA ignore_check_constraints = ON;")
                        .map_err(SettingsError::from)?;
                    connection
                        .execute(statement, [])
                        .map_err(SettingsError::from)?;
                    connection
                        .execute_batch("PRAGMA ignore_check_constraints = OFF;")
                        .map_err(SettingsError::from)?;
                    Ok::<(), SettingsError>(())
                },
            )
            .expect("the corrupt row should be arranged");
        let error = match SettingsService::new(storage, DataMaintenanceGate::new()) {
            Ok(_) => panic!("corrupt settings should not hydrate"),
            Err(error) => error,
        };
        assert_eq!(
            error,
            SettingsError::CorruptStoredSettings {
                field: expected_field.to_owned(),
            }
        );
    }

    let harness = ServiceHarness::new();
    harness
        .storage
        .with_connection(
            // Deletes the singleton only in the isolated corruption fixture.
            |connection| {
                connection
                    .execute("DELETE FROM settings", [])
                    .map(|_| ())
                    .map_err(SettingsError::from)
            },
        )
        .expect("the singleton should be deleted");
    let error = match SettingsService::new(harness.storage, DataMaintenanceGate::new()) {
        Ok(_) => panic!("a missing singleton should not hydrate"),
        Err(error) => error,
    };
    assert_eq!(
        error,
        SettingsError::CorruptStoredSettings {
            field: "id".to_owned()
        }
    );
}

/// Owns one isolated mock application for real command-routing tests.
struct TestApplication {
    app: tauri::App<tauri::test::MockRuntime>,
    _app_data: TempDir,
}

impl TestApplication {
    /// Builds the production composition against a temporary app data directory.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let mut app = xwork_lib::app::configure_with_app_data_dir(
            tauri::test::mock_builder(),
            app_data.path().to_path_buf(),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the mock application should build");
        #[allow(deprecated)]
        app.run_iteration(
            // Advances the mock lifecycle so setup hydrates managed settings.
            |_app_handle, _event| {},
        );
        Self {
            app,
            _app_data: app_data,
        }
    }

    /// Returns or creates one mock webview with the requested backend label.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        if let Some(window) = self.app.get_webview_window(label) {
            return window;
        }
        WebviewWindowBuilder::new(&self.app, label, Default::default())
            .build()
            .expect("the mock webview should build")
    }
}

/// Invokes one Settings command through Tauri's real routing pipeline.
fn invoke(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.to_owned(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost"
                .parse()
                .expect("the mock IPC URL should parse"),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_owned(),
        },
    )
    .map(
        // Decodes successful IPC payloads into comparable JSON values.
        |response| {
            response
                .deserialize()
                .expect("the response should contain JSON")
        },
    )
}

/// Verifies every XWork-created window can read the same cached snapshot.
#[test]
fn get_settings_returns_default_snapshot_from_main_and_quick_note() {
    let application = TestApplication::new();
    let main = application.window("main");
    let quick_note = application.window("quick-note");
    let expected = invoke(&main, "get_settings", json!({})).expect("main should read settings");
    assert_eq!(expected["revision"], "0");
    assert_eq!(expected["general"]["interfaceLanguage"], "english");
    assert_eq!(invoke(&quick_note, "get_settings", json!({})), Ok(expected));
}

/// Verifies non-main mutations fail before patch validation or database access.
#[test]
fn update_settings_rejects_non_main_window_before_validation() {
    let application = TestApplication::new();
    let quick_note = application.window("quick-note");
    assert_eq!(
        invoke(&quick_note, "update_settings", json!({ "input": {} })),
        Err(json!({ "code": "unauthorized_window" }))
    );
    assert_eq!(
        application
            .app
            .state::<SettingsService>()
            .snapshot()
            .expect("the cache should remain readable")
            .revision,
        0
    );
}

/// Verifies routed update and restore commands persist their complete snapshots.
#[test]
fn update_and_restore_commands_apply_the_contract() {
    let application = TestApplication::new();
    let main = application.window("main");
    let updated = invoke(
        &main,
        "update_settings",
        json!({
            "input": {
                "appearance": { "themePreset": "paper" },
                "sidebar": { "widthPx": 300, "collapsed": true }
            }
        }),
    )
    .expect("the routed update should succeed");
    assert_eq!(updated["revision"], "1");
    assert_eq!(updated["appearance"]["themePreset"], "paper");
    assert_eq!(updated["sidebar"]["widthPx"], 300);
    let restored = invoke(&main, "restore_appearance_defaults", json!({}))
        .expect("the routed restore should succeed");
    assert_eq!(restored["revision"], "2");
    assert_eq!(restored["appearance"]["themePreset"], "cream");
    assert_eq!(restored["sidebar"], updated["sidebar"]);
}

/// Verifies null-only command payloads are rejected as empty patches.
#[test]
fn empty_patch_returns_empty_patch_error() {
    let application = TestApplication::new();
    let main = application.window("main");
    assert_eq!(
        invoke(
            &main,
            "update_settings",
            json!({ "input": { "appearance": null, "sidebar": null } }),
        ),
        Err(json!({ "code": "empty_patch" }))
    );
}

/// Verifies the composition shutdown helper makes Settings unavailable.
#[test]
fn quit_shutdown_notifies_settings_service() {
    let application = TestApplication::new();
    let main = application.window("main");
    let before = application
        .app
        .state::<SettingsService>()
        .snapshot()
        .expect("the cache should initially be available");
    notify_settings_shutdown(application.app.handle());
    assert_eq!(
        application.app.state::<SettingsService>().snapshot(),
        Err(SettingsError::Unavailable)
    );
    assert_eq!(
        invoke(&main, "get_settings", json!({})),
        Err(json!({ "code": "unavailable" }))
    );
    assert_eq!(
        invoke(
            &main,
            "update_settings",
            json!({ "input": { "sidebar": { "collapsed": true } } }),
        ),
        Err(json!({ "code": "unavailable" }))
    );
    assert_eq!(
        persisted_revision(application.app.state::<Storage>().inner()),
        i64::try_from(before.revision).expect("the fixture revision should fit SQLite")
    );
}

/// Verifies the service retains exactly the process-wide maintenance gate.
#[test]
fn settings_service_shares_the_injected_gate() {
    let harness = ServiceHarness::new();
    assert!(harness.service.shares_gate_with(&harness.gate));
    assert!(
        !harness
            .service
            .shares_gate_with(&DataMaintenanceGate::new())
    );
    let clone = Arc::new(harness.service.clone());
    assert_eq!(
        clone
            .snapshot()
            .expect("the clone should share the cache")
            .revision,
        0
    );
}

/// Upgrades a stage-20 database without rewriting appearance or existing terminal inbox rows.
#[test]
fn notification_settings_migration_preserves_stage_twenty_data() {
    let app_data = TempDir::new().unwrap();
    let connection =
        rusqlite::Connection::open(app_data.path().join(Storage::DATABASE_FILE_NAME)).unwrap();
    for sql in [
        include_str!("../migrations/0001_create_projects.sql"),
        include_str!("../migrations/0002_create_settings.sql"),
        include_str!("../migrations/0003_create_cli_profiles.sql"),
        include_str!("../migrations/0004_create_keyboard_shortcuts.sql"),
        include_str!("../migrations/0005_create_notifications.sql"),
        include_str!("../migrations/0006_create_recent_files.sql"),
        include_str!("../migrations/0007_create_notes.sql"),
        include_str!("../migrations/0008_create_calendar_events.sql"),
    ] {
        connection.execute_batch(sql).unwrap();
    }
    connection
        .execute_batch(
            "UPDATE settings SET revision = 9, theme_mode = 'dark', sidebar_width_px = 333;
        INSERT INTO notifications (id, source_kind, source_id, source_key, kind, title, context,
            target_kind, project_id, target_id, tab_id, pane_id, created_at_ms, read_at_ms)
        VALUES ('notification:00000000-0000-4000-8000-000000000001', 'terminal', 'session-1',
            'terminal:session-1', 'needs_input', 'Waiting', 'Project', 'session',
            '00000000-0000-4000-8000-000000000002', 'session-1', 'tab-1', 'pane-1', 10, 20);
        PRAGMA user_version = 8;",
        )
        .unwrap();
    drop(connection);
    let storage = Storage::open(app_data.path()).unwrap();
    assert_eq!(schema_version(&storage), 10);
    let service = SettingsService::new(storage.clone(), DataMaintenanceGate::new()).unwrap();
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.revision, 9);
    assert_eq!(snapshot.appearance.theme_mode, ThemeModeDto::Dark);
    assert_eq!(snapshot.sidebar.width_px, 333);
    assert_eq!(snapshot.notifications, NotificationSettingsDto::default());
    let inbox = storage
        .with_connection(
            // Confirms terminal identity, context, timestamps and read state survive both migrations.
            |connection| {
                connection
                    .query_row(
                        "SELECT source_key, title, created_at_ms, read_at_ms FROM notifications",
                        [],
                        // Copies the preserved inbox row into owned scalar values.
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, i64>(3)?,
                            ))
                        },
                    )
                    .map_err(SettingsError::from)
            },
        )
        .unwrap();
    assert_eq!(
        inbox,
        ("terminal:session-1".into(), "Waiting".into(), 10, 20)
    );
}

/// Publishes only committed policy snapshots and retains the latest value without subscribers.
#[test]
fn notification_policy_watch_and_restart_follow_commits() {
    let harness = ServiceHarness::new();
    let mut watch = harness.service.subscribe().unwrap();
    assert_eq!(watch.borrow_and_update().revision, 0);
    let changed = harness
        .service
        .update(&UpdateSettingsDto {
            notifications: Some(NotificationSettingsPatchDto {
                terminal_activity_enabled: Some(false),
                terminal_os_states: Some(CliOsNotificationStatesDto {
                    needs_input: false,
                    process_finished: true,
                    process_exited_with_error: false,
                }),
                event_reminders_enabled: Some(false),
            }),
            ..Default::default()
        })
        .unwrap();
    assert!(watch.has_changed().unwrap());
    assert_eq!(*watch.borrow_and_update(), changed);
    assert!(!watch.has_changed().unwrap());
    let restored = harness.service.restore_appearance_defaults().unwrap();
    assert_eq!(restored.notifications, changed.notifications);
    drop(watch);
    harness.service.restore_appearance_defaults().unwrap();
    let latest = harness.service.snapshot().unwrap();
    assert_eq!(*harness.service.subscribe().unwrap().borrow(), latest);
    let reopened = SettingsService::new(harness.storage.clone(), harness.gate.clone()).unwrap();
    assert_eq!(reopened.snapshot().unwrap(), latest);
}

/// Rejects invalid and null-only patches without publishing or partially committing valid fields.
#[test]
fn notification_policy_strict_input_and_sql_failure_do_not_publish() {
    let harness = ServiceHarness::new();
    let watch = harness.service.subscribe().unwrap();
    for value in [
        json!({"notifications": {"eventRemindersEnabled": "false"}}),
        json!({"notifications": {"unknown": true}}),
        json!({"notifications": {"terminalOsStates": {"needsInput": true}}}),
        json!({"unknown": true}),
    ] {
        assert!(serde_json::from_value::<UpdateSettingsDto>(value).is_err());
    }
    for value in [
        json!({"notifications": null}),
        json!({"notifications": {"eventRemindersEnabled": null}}),
    ] {
        let patch = serde_json::from_value::<UpdateSettingsDto>(value).unwrap();
        assert_eq!(
            harness.service.update(&patch),
            Err(SettingsError::EmptyPatch)
        );
    }
    harness
        .storage
        .with_connection(
            // Aborts the isolated settings write while retaining the table for rollback assertions.
            |connection| {
                connection
                    .execute_batch(
                        "CREATE TRIGGER reject_policy BEFORE UPDATE ON settings
            BEGIN SELECT RAISE(ABORT, 'injected policy failure'); END;",
                    )
                    .map_err(SettingsError::from)
            },
        )
        .unwrap();
    let before = harness.service.snapshot().unwrap();
    let result = harness.service.update(&UpdateSettingsDto {
        notifications: Some(NotificationSettingsPatchDto {
            event_reminders_enabled: Some(false),
            ..Default::default()
        }),
        sidebar: Some(SidebarSettingsPatchDto {
            width_px: Some(400),
            collapsed: None,
        }),
        ..Default::default()
    });
    assert_eq!(result, Err(SettingsError::PersistenceFailed));
    assert_eq!(harness.service.snapshot().unwrap(), before);
    assert_eq!(persisted_revision(&harness.storage), 0);
    assert!(!watch.has_changed().unwrap());
}

/// Merges disjoint notification patches against each preceding commit under the write gate.
#[test]
fn concurrent_notification_patches_keep_both_changes() {
    let harness = ServiceHarness::new();
    let first = harness.service.clone();
    let second = harness.service.clone();
    let terminal = std::thread::spawn(
        // Updates terminal policy concurrently with the independent reminder toggle.
        move || {
            first
                .update(&UpdateSettingsDto {
                    notifications: Some(NotificationSettingsPatchDto {
                        terminal_activity_enabled: Some(false),
                        ..Default::default()
                    }),
                    ..Default::default()
                })
                .unwrap()
        },
    );
    let reminders = std::thread::spawn(
        // Updates reminder policy without overwriting the concurrently committed terminal toggle.
        move || {
            second
                .update(&UpdateSettingsDto {
                    notifications: Some(NotificationSettingsPatchDto {
                        event_reminders_enabled: Some(false),
                        ..Default::default()
                    }),
                    ..Default::default()
                })
                .unwrap()
        },
    );
    terminal.join().unwrap();
    reminders.join().unwrap();
    let latest = harness.service.snapshot().unwrap();
    assert_eq!(latest.revision, 2);
    assert!(!latest.notifications.terminal_activity_enabled);
    assert!(!latest.notifications.event_reminders_enabled);
    assert_eq!(harness.service.subscribe().unwrap().borrow().revision, 2);
}

/// Restores typed backup policy atomically while old backups preserve the local committed policy.
#[test]
fn notification_backup_optional_restore_and_rollback_preserve_policy() {
    let harness = ServiceHarness::new();
    harness
        .service
        .update(&UpdateSettingsDto {
            notifications: Some(NotificationSettingsPatchDto {
                event_reminders_enabled: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        })
        .unwrap();
    let mut watch = harness.service.subscribe().unwrap();
    watch.borrow_and_update();
    let exported = harness
        .storage
        .with_transaction(SettingsService::export_persisted_settings_in)
        .unwrap();
    assert!(
        !exported
            .notification_settings
            .as_ref()
            .unwrap()
            .event_reminders_enabled
    );
    let mut old_backup = exported.clone();
    old_backup.notification_settings = None;
    old_backup.sidebar.width_px = 300;
    let old_projection = harness
        .storage
        .with_transaction(
            // Commits an old backup that changes layout and omits notification policy.
            |tx| {
                let plan = SettingsService::prepare_settings_restore_in(tx, &old_backup)?;
                SettingsService::apply_settings_restore_in(tx, &plan)
            },
        )
        .unwrap();
    assert!(!watch.has_changed().unwrap());
    harness.service.publish_data_change(old_projection);
    let old_result = harness.service.snapshot().unwrap();
    assert_eq!(old_result.sidebar.width_px, 300);
    assert!(!old_result.notifications.event_reminders_enabled);
    assert_eq!(*watch.borrow_and_update(), old_result);
    let incoming = xwork_lib::settings::SettingsBackupSection::defaults();
    let failed: Result<(), SettingsError> = harness.storage.with_transaction(
        // Rolls back a fully applied owner projection before any cache publication.
        |tx| {
            let plan = SettingsService::prepare_settings_restore_in(tx, &incoming)?;
            let _projection = SettingsService::apply_settings_restore_in(tx, &plan)?;
            Err(SettingsError::PersistenceFailed)
        },
    );
    assert_eq!(failed, Err(SettingsError::PersistenceFailed));
    assert!(!watch.has_changed().unwrap());
    assert_eq!(harness.service.snapshot().unwrap(), old_result);
    assert_eq!(
        persisted_revision(&harness.storage),
        old_result.revision as i64
    );
    let projection = harness
        .storage
        .with_transaction(
            // Imports a present notification settings object in the shared transaction.
            |tx| {
                let plan = SettingsService::prepare_settings_restore_in(tx, &incoming)?;
                SettingsService::apply_settings_restore_in(tx, &plan)
            },
        )
        .unwrap();
    harness.service.publish_data_change(projection);
    assert_eq!(
        watch.borrow().notifications,
        NotificationSettingsDto::default()
    );
    assert_eq!(
        harness.service.snapshot().unwrap().notifications,
        NotificationSettingsDto::default()
    );
}
