use serde_json::{Value, json};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use xwork_lib::storage::{Storage, StorageError};
use xwork_lib::{
    settings::{KeyboardShortcutsError, KeyboardShortcutsService, ShortcutChordDto},
    shared::DataMaintenanceGate,
};

/// Owns an isolated service and database for persistence tests.
struct Harness {
    service: KeyboardShortcutsService,
    storage: Storage,
    _dir: TempDir,
}
impl Harness {
    /// Hydrates a service from a new temporary database.
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let storage = Storage::open(dir.path()).unwrap();
        let service =
            KeyboardShortcutsService::new(storage.clone(), DataMaintenanceGate::new()).unwrap();
        Self {
            service,
            storage,
            _dir: dir,
        }
    }
    /// Arranges isolated SQL fixtures without touching real application data.
    fn sql(&self, sql: &str) {
        self.storage
            .with_connection::<_, KeyboardShortcutsError>(
                // Executes the test fixture on the isolated connection.
                |connection| Ok(connection.execute_batch(sql)?),
            )
            .unwrap();
    }
    /// Counts durable overrides, including unknown actions.
    fn count(&self) -> i64 {
        self.storage
            .with_connection::<_, KeyboardShortcutsError>(
                // Reads the table cardinality for persistence assertions.
                |connection| {
                    Ok(connection.query_row(
                        "SELECT COUNT(*) FROM keyboard_shortcut_overrides",
                        [],
                        // Decodes the scalar count.
                        |row| row.get(0),
                    )?)
                },
            )
            .unwrap()
    }
}

/// Creates a Primary chord for service and IPC tests.
fn chord(code: &str) -> ShortcutChordDto {
    ShortcutChordDto {
        primary: true,
        alt: false,
        shift: false,
        key_code: code.into(),
    }
}

/// Verifies first-run defaults and cache-only reads after SQLite becomes unavailable.
#[test]
fn startup_returns_the_default_snapshot_from_an_empty_table() {
    let h = Harness::new();
    let snapshot = h.service.snapshot().unwrap();
    assert_eq!(snapshot.actions.len(), 18);
    assert!(snapshot.actions.iter().all(
        // Every default is unique and dispatchable.
        |action| !action.is_custom && action.is_dispatchable && action.conflicts_with.is_empty()
    ));
    assert_eq!(h.count(), 0);
    h.sql("DROP TABLE keyboard_shortcut_overrides");
    assert_eq!(h.service.snapshot().unwrap(), snapshot);
}

/// Verifies persisted overrides survive reopening the database and return-to-default deletes rows.
#[test]
fn set_persists_override_and_survives_restart() {
    let h = Harness::new();
    let changed = h
        .service
        .set_shortcut("tabs.create", &chord("KeyY"))
        .unwrap();
    assert!(changed.actions[7].is_custom);
    assert_eq!(h.count(), 1);
    let reopened = Storage::open(h._dir.path()).unwrap();
    let service = KeyboardShortcutsService::new(reopened, DataMaintenanceGate::new()).unwrap();
    assert_eq!(service.snapshot().unwrap(), changed);
    service.set_shortcut("tabs.create", &chord("KeyT")).unwrap();
    assert_eq!(h.count(), 0);
}

/// Uses failing write triggers to prove identical set and empty resets perform no writes.
#[test]
fn setting_the_current_chord_is_a_database_noop() {
    let h = Harness::new();
    let snapshot = h
        .service
        .set_shortcut("tabs.create", &chord("KeyY"))
        .unwrap();
    h.sql("CREATE TRIGGER forbid_update BEFORE UPDATE ON keyboard_shortcut_overrides BEGIN SELECT RAISE(ABORT, 'unexpected write'); END; CREATE TRIGGER forbid_insert BEFORE INSERT ON keyboard_shortcut_overrides BEGIN SELECT RAISE(ABORT, 'unexpected write'); END;");
    assert_eq!(
        h.service
            .set_shortcut("tabs.create", &chord("KeyY"))
            .unwrap(),
        snapshot
    );
    assert_eq!(h.count(), 1);
    h.service.reset_all().unwrap();
    h.sql("PRAGMA query_only = ON;");
    assert!(h.service.reset_shortcut("tabs.create").is_ok());
    assert!(h.service.reset_all().is_ok());
    assert!(
        h.service
            .set_shortcut("tabs.create", &chord("KeyT"))
            .is_ok()
    );
}

/// Verifies all members of two- and three-action conflicts persist and reset releases the group.
#[test]
fn conflicting_assignments_commit_and_round_trip() {
    let h = Harness::new();
    let two = h
        .service
        .set_shortcut("tabs.create", &chord("KeyK"))
        .unwrap();
    assert_eq!(two.actions[0].conflicts_with, ["tabs.create"]);
    let three = h
        .service
        .set_shortcut("tabs.close", &chord("KeyK"))
        .unwrap();
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
    let restarted =
        KeyboardShortcutsService::new(h.storage.clone(), DataMaintenanceGate::new()).unwrap();
    assert_eq!(restarted.snapshot().unwrap(), three);
    h.service.reset_shortcut("tabs.create").unwrap();
    assert_eq!(h.count(), 1);
    let resolved = h.service.reset_shortcut("tabs.close").unwrap();
    for index in [0, 7, 8] {
        assert!(resolved.actions[index].is_dispatchable);
    }
}

/// Verifies unknown rows remain hidden and survive targeted writes but are cleared by reset all.
#[test]
fn unknown_action_rows_are_preserved_but_hidden() {
    let h = Harness::new();
    h.sql(
        "INSERT INTO keyboard_shortcut_overrides VALUES ('future.action', 0, 0, 0, 'UnknownCode')",
    );
    let service =
        KeyboardShortcutsService::new(h.storage.clone(), DataMaintenanceGate::new()).unwrap();
    assert_eq!(service.snapshot().unwrap().actions.len(), 18);
    service.set_shortcut("tabs.create", &chord("KeyY")).unwrap();
    assert_eq!(h.count(), 2);
    service.reset_shortcut("tabs.create").unwrap();
    assert_eq!(h.count(), 1);
    let reset = service.reset_all().unwrap();
    assert_eq!(h.count(), 0);
    assert!(reset.actions.iter().all(
        // Reset restores a conflict-free default catalog.
        |action| action.is_dispatchable && !action.is_custom
    ));
}

/// Verifies known rows reject invalid codes, boolean values, and modifier-only syntax at startup.
#[test]
fn corrupt_known_row_fails_startup() {
    for values in [
        "1, 0, 0, 'Nope'",
        "2, 0, 0, 'KeyY'",
        "0, 0, 1, 'KeyY'",
        "1, 0, 0, X'FF'",
    ] {
        let h = Harness::new();
        h.sql(&format!("PRAGMA ignore_check_constraints = ON; INSERT INTO keyboard_shortcut_overrides VALUES ('tabs.create', {values}); PRAGMA ignore_check_constraints = OFF;"));
        assert!(
            matches!(KeyboardShortcutsService::new(h.storage.clone(), DataMaintenanceGate::new()), Err(KeyboardShortcutsError::CorruptStoredShortcut { action_id }) if action_id == "tabs.create")
        );
    }
}

/// Proves validation precedes SQLite access and failed writes leave cached state unchanged.
#[test]
fn validation_rejects_before_database_access() {
    let h = Harness::new();
    let previous = h.service.snapshot().unwrap();
    h.sql("DROP TABLE keyboard_shortcut_overrides");
    assert!(matches!(
        h.service.set_shortcut("unknown", &chord("Nope")),
        Err(KeyboardShortcutsError::ActionNotFound { .. })
    ));
    assert!(matches!(
        h.service.set_shortcut("tabs.create", &chord("Nope")),
        Err(KeyboardShortcutsError::InvalidKeyCode { .. })
    ));
    let mut bare = chord("KeyY");
    bare.primary = false;
    assert_eq!(
        h.service.set_shortcut("tabs.create", &bare),
        Err(KeyboardShortcutsError::ModifierRequired)
    );
    let reserved = ShortcutChordDto {
        primary: false,
        alt: true,
        shift: false,
        key_code: "F4".into(),
    };
    assert_eq!(
        h.service.set_shortcut("tabs.create", &reserved),
        Err(KeyboardShortcutsError::ReservedShortcut)
    );
    assert_eq!(
        h.service.set_shortcut("tabs.create", &chord("KeyY")),
        Err(KeyboardShortcutsError::PersistenceFailed)
    );
    assert_eq!(h.service.snapshot().unwrap(), previous);
}

/// Forces a deferred foreign-key failure at commit, proving both durable and cached rollback.
#[test]
fn commit_failure_keeps_cache_and_snapshot_unchanged() {
    let h = Harness::new();
    let before = h.service.snapshot().unwrap();
    h.sql("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_failure(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail_commit AFTER INSERT ON keyboard_shortcut_overrides BEGIN INSERT INTO commit_failure VALUES (1); END;");
    assert_eq!(
        h.service.set_shortcut("tabs.create", &chord("KeyY")),
        Err(KeyboardShortcutsError::PersistenceFailed)
    );
    assert_eq!(h.count(), 0);
    assert_eq!(h.service.snapshot().unwrap(), before);
}

/// Verifies concurrent writers merge against the latest serialized cache.
#[test]
fn concurrent_writers_serialize_through_the_write_gate() {
    let h = Harness::new();
    let mut threads = Vec::new();
    for (id, code) in [("tabs.create", "KeyY"), ("tabs.close", "KeyU")] {
        let service = h.service.clone();
        threads.push(std::thread::spawn(
            // Races independent assignments through the same owner write gate.
            move || service.set_shortcut(id, &chord(code)).unwrap(),
        ));
    }
    for thread in threads {
        thread.join().unwrap();
    }
    let snapshot = h.service.snapshot().unwrap();
    assert_eq!(snapshot.actions[7].current_chord, chord("KeyY"));
    assert_eq!(snapshot.actions[8].current_chord, chord("KeyU"));
    assert_eq!(h.count(), 2);
}

/// Verifies the registry creates an empty shortcut override table at version four.
#[test]
fn migration_creates_empty_shortcut_overrides() {
    let dir = TempDir::new().unwrap();
    let storage = Storage::open(dir.path()).unwrap();
    storage
        .with_connection::<_, StorageError>(
            // Checks the migration marker before inspecting the new table.
            |connection| {
                let version: u32 = connection
                    .pragma_query_value(
                        None,
                        "user_version",
                        // Decodes the schema marker.
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(version, 4);
                let count: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM keyboard_shortcut_overrides",
                        [],
                        // Decodes the number of persisted overrides.
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(count, 0);
                let columns = connection.prepare("PRAGMA table_info(keyboard_shortcut_overrides)").unwrap()
                    .query_map([],
                        // Captures column names, affinity, nullability, and primary-key position.
                        |row| Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?, row.get::<_, i64>(5)?)))
                    .unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
                assert_eq!(columns, vec![
                    ("action_id".into(), "TEXT".into(), 1, 1),
                    ("primary_modifier".into(), "INTEGER".into(), 1, 0),
                    ("alt_modifier".into(), "INTEGER".into(), 1, 0),
                    ("shift_modifier".into(), "INTEGER".into(), 1, 0),
                    ("key_code".into(), "TEXT".into(), 1, 0),
                ]);
                for (id, primary, alt, shift, code) in [
                    ("".to_owned(), 1, 0, 0, "KeyY".to_owned()),
                    ("a".repeat(65), 1, 0, 0, "KeyY".to_owned()),
                    ("tabs.create".into(), 2, 0, 0, "KeyY".into()),
                    ("tabs.create".into(), 1, 2, 0, "KeyY".into()),
                    ("tabs.create".into(), 1, 0, 2, "KeyY".into()),
                    ("tabs.create".into(), 1, 0, 0, "".into()),
                    ("tabs.create".into(), 1, 0, 0, "a".repeat(33)),
                ] {
                    assert!(connection.execute("INSERT INTO keyboard_shortcut_overrides VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![id, primary, alt, shift, code]).is_err());
                }
                connection.execute("INSERT INTO keyboard_shortcut_overrides VALUES (?1, 1, 0, 0, ?2)", rusqlite::params!["tabs.create", "KeyY"]).unwrap();
                connection.execute("INSERT INTO keyboard_shortcut_overrides VALUES (?1, 1, 0, 0, ?2)", rusqlite::params!["tabs.close", "KeyY"]).unwrap();
                assert_eq!(connection.execute("DELETE FROM keyboard_shortcut_overrides", []).unwrap(), 2);
                Ok(())
            },
        )
        .unwrap();
}

/// Owns a production composition running against disposable app data.
struct TestApplication {
    app: tauri::App<tauri::test::MockRuntime>,
    _dir: TempDir,
}
impl TestApplication {
    /// Executes the production setup lifecycle in an isolated mock runtime.
    fn new() -> Self {
        let dir = TempDir::new().unwrap();
        let mut app = xwork_lib::app::configure_with_app_data_dir(
            tauri::test::mock_builder(),
            dir.path().to_path_buf(),
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
        #[allow(deprecated)]
        app.run_iteration(
            // Advances setup without native window automation.
            |_, _| {},
        );
        Self { app, _dir: dir }
    }
    /// Resolves an existing mock window or creates a labeled secondary window.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        self.app.get_webview_window(label).unwrap_or_else(
            // Builds a mock caller for authorization coverage.
            || {
                WebviewWindowBuilder::new(&self.app, label, Default::default())
                    .build()
                    .unwrap()
            },
        )
    }
    /// Arranges database failures through managed isolated Storage.
    fn sql(&self, sql: &str) {
        self.app
            .state::<Storage>()
            .with_connection::<_, KeyboardShortcutsError>(
                // Applies only test-local fixture SQL.
                |connection| Ok(connection.execute_batch(sql)?),
            )
            .unwrap();
    }
    /// Counts rows after a command returns its committed snapshot.
    fn count(&self) -> i64 {
        self.app
            .state::<Storage>()
            .with_connection::<_, KeyboardShortcutsError>(
                // Reads durable command effects.
                |connection| {
                    Ok(connection.query_row(
                        "SELECT COUNT(*) FROM keyboard_shortcut_overrides",
                        [],
                        // Decodes the count.
                        |row| row.get(0),
                    )?)
                },
            )
            .unwrap()
    }
}

/// Routes IPC through the production invoke handler and decodes the response.
fn invoke(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    body: Value,
) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(
        // Converts successful responses into comparable JSON.
        |response| response.deserialize().unwrap(),
    )
}

/// Proves every application window can read the cache without SQLite access.
#[test]
fn get_returns_the_cached_snapshot_from_any_window() {
    let app = TestApplication::new();
    app.sql("DROP TABLE keyboard_shortcut_overrides");
    let main = invoke(&app.window("main"), "get_keyboard_shortcuts", json!({})).unwrap();
    assert_eq!(main["actions"].as_array().unwrap().len(), 18);
    assert_eq!(
        invoke(
            &app.window("secondary"),
            "get_keyboard_shortcuts",
            json!({})
        )
        .unwrap(),
        main
    );
}

/// Proves authorization takes precedence over action validation and database failure.
#[test]
fn mutations_from_a_non_main_window_are_unauthorized_before_database() {
    let app = TestApplication::new();
    app.sql("DROP TABLE keyboard_shortcut_overrides");
    let window = app.window("secondary");
    for command in [
        "set_keyboard_shortcut",
        "reset_keyboard_shortcut",
        "reset_all_keyboard_shortcuts",
    ] {
        assert_eq!(
            invoke(
                &window,
                command,
                json!({"actionId": "unknown", "chord": chord("Nope")})
            ),
            Err(json!({"code": "unauthorized_window"}))
        );
    }
}

/// Proves each validation category is returned before command persistence.
#[test]
fn set_validates_before_persistence() {
    let app = TestApplication::new();
    app.sql("DROP TABLE keyboard_shortcut_overrides");
    let main = app.window("main");
    let bare = ShortcutChordDto {
        primary: false,
        ..chord("KeyY")
    };
    let reserved = ShortcutChordDto {
        primary: false,
        alt: true,
        ..chord("F4")
    };
    for (id, chord, expected) in [
        ("unknown", chord("Nope"), "action_not_found"),
        ("tabs.create", chord("Nope"), "invalid_key_code"),
        ("tabs.create", bare, "modifier_required"),
        ("tabs.create", reserved, "reserved_shortcut"),
        ("tabs.create", chord("KeyY"), "persistence_failed"),
    ] {
        assert_eq!(
            invoke(
                &main,
                "set_keyboard_shortcut",
                json!({"actionId": id, "chord": chord})
            )
            .unwrap_err()["code"],
            expected
        );
    }
}

/// Exercises all persistent commands and their conflict projections through real routing.
#[test]
fn set_reset_and_reset_all_round_trip_through_commands() {
    let app = TestApplication::new();
    let main = app.window("main");
    for id in ["tabs.create", "tabs.close"] {
        invoke(
            &main,
            "set_keyboard_shortcut",
            json!({"actionId": id, "chord": chord("KeyY")}),
        )
        .unwrap();
    }
    assert_eq!(app.count(), 2);
    let snapshot = invoke(&main, "get_keyboard_shortcuts", json!({})).unwrap();
    assert_eq!(
        snapshot["actions"][7]["conflictsWith"],
        json!(["tabs.close"])
    );
    assert_eq!(snapshot["actions"][8]["isDispatchable"], false);
    let reset = invoke(
        &main,
        "reset_keyboard_shortcut",
        json!({"actionId": "tabs.create"}),
    )
    .unwrap();
    assert_eq!(reset["actions"][8]["isDispatchable"], true);
    assert_eq!(app.count(), 1);
    invoke(&main, "reset_all_keyboard_shortcuts", json!({})).unwrap();
    assert_eq!(app.count(), 0);
}

/// Ensures all commands reject work after the owner receives shutdown notification.
#[test]
fn commands_return_unavailable_after_shutdown_begins() {
    let app = TestApplication::new();
    xwork_lib::app::notify_keyboard_shortcuts_shutdown(app.app.handle());
    for command in [
        "get_keyboard_shortcuts",
        "set_keyboard_shortcut",
        "reset_keyboard_shortcut",
        "reset_all_keyboard_shortcuts",
    ] {
        assert_eq!(
            invoke(
                &app.window("main"),
                command,
                json!({"actionId": "tabs.create", "chord": chord("KeyY")})
            ),
            Err(json!({"code": "unavailable"}))
        );
    }
    assert_eq!(app.count(), 0);
}
