use std::{
    path::PathBuf,
    pin::Pin,
    sync::{Arc, Mutex, mpsc},
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};

use rusqlite::{Connection, params};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use xwork_lib::platform::command::{CommandResolutionError, StubCommandResolver};
use xwork_lib::platform::credential::{CredentialError, CredentialStore, InMemoryCredentialStore};
use xwork_lib::platform::shell::{ShellMode, ShellResolutionError, StubShellResolver};
use xwork_lib::shared::DataMaintenanceGate;
use xwork_lib::storage::{Storage, StorageError};
use xwork_lib::terminal::{
    CliProfileAvailabilityStatusDto, CliProfileEnvironmentInputDto, CliProfileIdFactory,
    CliProfileInputDto, CliProfileKindDto, CliProfilesChangedDto, CliProfilesClock,
    CliProfilesError, CliProfilesEventSink, CliProfilesService, CliProfilesSnapshotDto,
    ResolvedCliLaunchKind,
};
use zeroize::{Zeroize, Zeroizing};

/// Wraps storage and SQLite failures raised inside integration callbacks.
#[derive(Debug)]
enum TestError {
    Storage,
    Sqlite,
}

impl From<StorageError> for TestError {
    /// Converts a storage-layer failure into the integration-test error type.
    fn from(_error: StorageError) -> Self {
        Self::Storage
    }
}

impl From<rusqlite::Error> for TestError {
    /// Converts a SQLite callback failure into the integration-test error type.
    fn from(_error: rusqlite::Error) -> Self {
        Self::Sqlite
    }
}

/// Reads the live schema version from an isolated integration database.
fn schema_version(storage: &Storage) -> u32 {
    storage
        .with_connection(
            // Reads the schema marker through the public storage boundary.
            |connection| {
                connection
                    .pragma_query_value(
                        None,
                        "user_version",
                        // Decodes the scalar schema marker for assertions.
                        |row| row.get::<_, u32>(0),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the schema version should be readable")
}

/// Collects every table name created by the registered migrations.
fn table_names(storage: &Storage) -> Vec<String> {
    storage
        .with_connection(
            // Reads only user tables so SQLite's internal objects stay out of scope.
            |connection| {
                let mut statement = connection.prepare(
                    "SELECT name FROM sqlite_master \
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )?;
                let names = statement
                    .query_map(
                        [],
                        // Decodes one schema object name.
                        |row| row.get::<_, String>(0),
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok::<_, TestError>(names)
            },
        )
        .expect("the schema objects should be readable")
}

/// Returns one table's columns as `(name, declared type, not null)` tuples.
fn table_columns(storage: &Storage, table: &'static str) -> Vec<(String, String, bool)> {
    storage
        .with_connection(
            // Reads the migrated column layout without depending on private models.
            |connection| {
                let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
                let columns = statement
                    .query_map(
                        [],
                        // Decodes the name, declared type, and nullability of one column.
                        |row| {
                            Ok((
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, i64>(3)? == 1,
                            ))
                        },
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok::<_, TestError>(columns)
            },
        )
        .expect("the table columns should be readable")
}

/// Executes one raw statement and reports whether SQLite accepted it.
fn try_execute(storage: &Storage, sql: &str) -> bool {
    storage
        .with_connection(
            // Reports acceptance without turning an expected constraint failure into a panic.
            |connection| Ok::<_, TestError>(connection.execute_batch(sql).is_ok()),
        )
        .expect("the statement should be attempted")
}

/// Counts the rows of one migrated table.
fn row_count(storage: &Storage, table: &'static str) -> i64 {
    storage
        .with_connection(
            // Counts rows through the shared connection used by production code.
            |connection| {
                connection
                    .query_row(
                        &format!("SELECT COUNT(*) FROM {table}"),
                        [],
                        // Decodes the aggregate row count.
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the row count should be readable")
}

/// Inserts one minimal custom profile fixture row directly through SQL.
fn insert_profile_fixture(storage: &Storage, id: &str) {
    storage
        .with_connection(
            // Writes the fixture through the same connection production code uses.
            |connection| {
                connection
                    .execute(
                        "INSERT INTO cli_profiles \
                         (id, name, command, arguments_json, shell_id, icon, color, \
                          created_at_ms, updated_at_ms) \
                         VALUES (?1, 'Fixture', 'fixture', '[\"--flag\"]', NULL, 'Fx', \
                          '#112233', 10, 20)",
                        params![id],
                    )
                    .map(
                        // Discards the affected-row count after the fixture insert succeeds.
                        |_| (),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the profile fixture should be inserted");
}

/// Returns one canonical 44-character custom profile identifier.
fn profile_id(suffix: u8) -> String {
    format!("profile-{suffix:08x}-0000-4000-8000-000000000000")
}

/// Verifies that migration 3 creates the exact BE-006 schema and singleton row.
#[test]
fn migration_v3_creates_exact_schema_and_default() {
    let directory = TempDir::new().expect("the temporary directory should be created");
    let storage = Storage::open(directory.path()).expect("storage should open");

    assert_eq!(schema_version(&storage), 3);
    assert_eq!(
        table_names(&storage),
        vec![
            "cli_profile_environment",
            "cli_profile_settings",
            "cli_profiles",
            "credential_cleanup_queue",
            "projects",
            "settings",
        ]
    );
    assert_eq!(
        table_columns(&storage, "cli_profile_settings"),
        vec![
            ("id".to_owned(), "INTEGER".to_owned(), true),
            ("default_shell_id".to_owned(), "TEXT".to_owned(), true),
        ]
    );
    assert_eq!(
        table_columns(&storage, "cli_profiles"),
        vec![
            ("id".to_owned(), "TEXT".to_owned(), true),
            ("name".to_owned(), "TEXT".to_owned(), true),
            ("command".to_owned(), "TEXT".to_owned(), true),
            ("arguments_json".to_owned(), "TEXT".to_owned(), true),
            ("shell_id".to_owned(), "TEXT".to_owned(), false),
            ("icon".to_owned(), "TEXT".to_owned(), true),
            ("color".to_owned(), "TEXT".to_owned(), true),
            ("created_at_ms".to_owned(), "INTEGER".to_owned(), true),
            ("updated_at_ms".to_owned(), "INTEGER".to_owned(), true),
        ]
    );
    assert_eq!(
        table_columns(&storage, "cli_profile_environment"),
        vec![
            ("profile_id".to_owned(), "TEXT".to_owned(), true),
            ("position".to_owned(), "INTEGER".to_owned(), true),
            ("name".to_owned(), "TEXT".to_owned(), true),
            ("value".to_owned(), "TEXT".to_owned(), false),
            ("is_secret".to_owned(), "INTEGER".to_owned(), true),
            ("credential_account".to_owned(), "TEXT".to_owned(), false),
        ]
    );
    assert_eq!(
        table_columns(&storage, "credential_cleanup_queue"),
        vec![
            ("credential_account".to_owned(), "TEXT".to_owned(), true),
            ("queued_at_ms".to_owned(), "INTEGER".to_owned(), true),
        ]
    );

    // The singleton settings row is the only row any migration inserts.
    let default_shell = storage
        .with_connection(
            // Reads the singleton default shell created by the migration.
            |connection| {
                connection
                    .query_row(
                        "SELECT id, default_shell_id FROM cli_profile_settings",
                        [],
                        // Decodes the singleton identity and its persisted shell selection.
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the singleton settings row should exist");
    assert_eq!(default_shell, (1, "system".to_owned()));
    assert_eq!(row_count(&storage, "cli_profiles"), 0);
    assert_eq!(row_count(&storage, "cli_profile_environment"), 0);
    assert_eq!(row_count(&storage, "credential_cleanup_queue"), 0);

    // A second settings row and an out-of-range shell identifier are both rejected.
    assert!(!try_execute(
        &storage,
        "INSERT INTO cli_profile_settings (id, default_shell_id) VALUES (2, 'system')"
    ));
    assert!(!try_execute(
        &storage,
        "UPDATE cli_profile_settings SET default_shell_id = '' WHERE id = 1"
    ));

    // Identifier shape, colour syntax, JSON argument shape, and timestamps are enforced.
    assert!(!try_execute(
        &storage,
        "INSERT INTO cli_profiles (id, name, command, arguments_json, shell_id, icon, color, \
         created_at_ms, updated_at_ms) \
         VALUES ('short', 'Fixture', 'fixture', '[]', NULL, 'Fx', '#112233', 1, 1)"
    ));
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profiles (id, name, command, arguments_json, shell_id, icon, color, \
             created_at_ms, updated_at_ms) \
             VALUES ('{}', 'Fixture', 'fixture', '{{}}', NULL, 'Fx', '#112233', 1, 1)",
            profile_id(1)
        )
    ));
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profiles (id, name, command, arguments_json, shell_id, icon, color, \
             created_at_ms, updated_at_ms) \
             VALUES ('{}', 'Fixture', 'fixture', '[]', NULL, 'Fx', '#11223G', 1, 1)",
            profile_id(2)
        )
    ));
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profiles (id, name, command, arguments_json, shell_id, icon, color, \
             created_at_ms, updated_at_ms) \
             VALUES ('{}', 'Fixture', 'fixture', '[]', NULL, 'Fx', '#112233', 5, 4)",
            profile_id(3)
        )
    ));

    let owner = profile_id(9);
    insert_profile_fixture(&storage, &owner);
    assert!(try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES ('{owner}', 0, 'TOKEN', NULL, 1, 'account-one')"
        )
    ));
    // A secret row must not carry a plaintext value and a plain row must not carry an account.
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES ('{owner}', 1, 'MIXED', 'plain', 1, 'account-two')"
        )
    ));
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES ('{owner}', 1, 'PLAIN', 'plain', 0, 'account-two')"
        )
    ));
    // Names are unique without ASCII case sensitivity so Windows semantics hold.
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES ('{owner}', 1, 'token', 'plain', 0, NULL)"
        )
    ));
    // Positions are unique per profile and credential accounts are unique globally.
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES ('{owner}', 0, 'OTHER', 'plain', 0, NULL)"
        )
    ));
    let second_owner = profile_id(10);
    insert_profile_fixture(&storage, &second_owner);
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES ('{second_owner}', 0, 'TOKEN', NULL, 1, 'account-one')"
        )
    ));
    // An environment row cannot reference a profile that does not exist.
    assert!(!try_execute(
        &storage,
        &format!(
            "INSERT INTO cli_profile_environment \
             (profile_id, position, name, value, is_secret, credential_account) \
             VALUES ('{}', 0, 'ORPHAN', 'plain', 0, NULL)",
            profile_id(11)
        )
    ));

    // Deleting a profile cascades to every environment row it owns.
    assert!(try_execute(
        &storage,
        &format!("DELETE FROM cli_profiles WHERE id = '{owner}'")
    ));
    assert_eq!(row_count(&storage, "cli_profile_environment"), 0);

    // The cleanup queue rejects duplicate references and negative timestamps.
    assert!(try_execute(
        &storage,
        "INSERT INTO credential_cleanup_queue (credential_account, queued_at_ms) \
         VALUES ('account-one', 5)"
    ));
    assert!(!try_execute(
        &storage,
        "INSERT INTO credential_cleanup_queue (credential_account, queued_at_ms) \
         VALUES ('account-one', 6)"
    ));
    assert!(!try_execute(
        &storage,
        "INSERT INTO credential_cleanup_queue (credential_account, queued_at_ms) \
         VALUES ('account-two', -1)"
    ));
}

/// Verifies that migration 3 keeps every row written by versions one and two.
#[test]
fn migration_v3_preserves_versions_one_and_two() {
    let directory = TempDir::new().expect("the temporary directory should be created");
    let database_path = directory.path().join(Storage::DATABASE_FILE_NAME);
    let connection = Connection::open(&database_path).expect("the fixture database should open");
    connection
        .execute_batch(include_str!("../migrations/0001_create_projects.sql"))
        .expect("the projects migration fixture should apply");
    connection
        .execute_batch(include_str!("../migrations/0002_create_settings.sql"))
        .expect("the settings migration fixture should apply");
    connection
        .execute(
            "INSERT INTO projects \
             (id, display_name, root_path, path_key, is_pinned, added_at_ms, last_opened_at_ms) \
             VALUES ('11111111-1111-4111-8111-111111111111', 'Legacy', 'C:\\Legacy', \
              'c:\\legacy', 1, 7, 9)",
            [],
        )
        .expect("the legacy project fixture should insert");
    connection
        .execute(
            "UPDATE settings SET sidebar_width_px = 321 WHERE id = 1",
            [],
        )
        .expect("the legacy settings fixture should update");
    connection
        .pragma_update(None, "user_version", 2)
        .expect("the fixture schema version should be set");
    drop(connection);

    let storage = Storage::open(directory.path()).expect("storage should migrate the fixture");

    assert_eq!(schema_version(&storage), 3);
    let (project_name, sidebar_width) = storage
        .with_connection(
            // Reads one value from each pre-existing migration to prove nothing was rebuilt.
            |connection| {
                let name = connection.query_row(
                    "SELECT display_name FROM projects",
                    [],
                    // Decodes the preserved project display name.
                    |row| row.get::<_, String>(0),
                )?;
                let width = connection.query_row(
                    "SELECT sidebar_width_px FROM settings WHERE id = 1",
                    [],
                    // Decodes the preserved settings value.
                    |row| row.get::<_, i64>(0),
                )?;
                Ok::<_, TestError>((name, width))
            },
        )
        .expect("the earlier migrations' data should survive");
    assert_eq!(project_name, "Legacy");
    assert_eq!(sidebar_width, 321);
    assert_eq!(row_count(&storage, "cli_profile_settings"), 1);
}

/// Verifies that reopening an already migrated database does not rerun version 3.
#[test]
fn migration_v3_reopens_without_reapplying() {
    let directory = TempDir::new().expect("the temporary directory should be created");
    let storage = Storage::open(directory.path()).expect("storage should open");
    let id = profile_id(7);
    insert_profile_fixture(&storage, &id);
    storage
        .with_connection(
            // Changes the singleton row so a rerun of the migration would be observable.
            |connection| {
                connection
                    .execute(
                        "UPDATE cli_profile_settings SET default_shell_id = 'cmd' WHERE id = 1",
                        [],
                    )
                    .map(
                        // Discards the affected-row count after the fixture update succeeds.
                        |_| (),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the singleton row should be updatable");
    drop(storage);

    let reopened = Storage::open(directory.path()).expect("storage should reopen");

    assert_eq!(schema_version(&reopened), 3);
    assert_eq!(row_count(&reopened, "cli_profile_settings"), 1);
    assert_eq!(row_count(&reopened, "cli_profiles"), 1);
    let persisted_shell = reopened
        .with_connection(
            // Proves the reopen neither reinserted nor reset the singleton row.
            |connection| {
                connection
                    .query_row(
                        "SELECT default_shell_id FROM cli_profile_settings WHERE id = 1",
                        [],
                        // Decodes the persisted default shell selection.
                        |row| row.get::<_, String>(0),
                    )
                    .map_err(TestError::from)
            },
        )
        .expect("the singleton row should be readable");
    assert_eq!(persisted_shell, "cmd");
}

/// Returns one fixed timestamp so hydration assertions stay deterministic.
struct FixedClock {
    now_ms: Mutex<i64>,
}

impl FixedClock {
    /// Creates a clock pinned to the supplied fixture timestamp.
    fn new(now_ms: i64) -> Self {
        Self {
            now_ms: Mutex::new(now_ms),
        }
    }

    /// Moves the fixture clock forward by the supplied milliseconds.
    fn advance(&self, delta_ms: i64) {
        *self
            .now_ms
            .lock()
            .expect("the fixture lock should be available") += delta_ms;
    }
}

impl CliProfilesClock for FixedClock {
    /// Returns the pinned fixture timestamp.
    fn now_ms(&self) -> Result<i64, CliProfilesError> {
        Ok(*self
            .now_ms
            .lock()
            .expect("the fixture lock should be available"))
    }
}

/// Returns deterministic profile identifiers and credential accounts.
#[derive(Default)]
struct SequentialIds {
    next_profile: Mutex<u32>,
    next_account: Mutex<u32>,
}

impl CliProfileIdFactory for SequentialIds {
    /// Returns the next canonical fixture profile identifier.
    fn new_profile_id(&self) -> String {
        let mut next = self
            .next_profile
            .lock()
            .expect("the fixture lock should be available");
        *next += 1;
        format!("profile-{:08x}-0000-4000-8000-000000000000", *next)
    }

    /// Returns the next opaque fixture credential account.
    fn new_credential_account(&self) -> String {
        let mut next = self
            .next_account
            .lock()
            .expect("the fixture lock should be available");
        *next += 1;
        format!("{:08x}-0000-4000-8000-aaaaaaaaaaaa", *next)
    }
}

/// Records every published invalidation and can fail delivery on demand.
#[derive(Default)]
struct RecordingEventSink {
    published: Mutex<Vec<CliProfilesChangedDto>>,
    fails: Mutex<bool>,
}

impl RecordingEventSink {
    /// Returns every published event as a revision, kind, and profile triple.
    fn recorded(&self) -> Vec<(String, String, Option<String>)> {
        self.published
            .lock()
            .expect("the fixture lock should be available")
            .iter()
            .map(
                // Reduces each payload to the three fields assertions inspect.
                |event| {
                    (
                        event.revision.clone(),
                        format!("{:?}", event.kind),
                        event.profile_id.clone(),
                    )
                },
            )
            .collect()
    }

    /// Makes every later publication attempt fail without losing the record.
    fn start_failing(&self) {
        *self
            .fails
            .lock()
            .expect("the fixture lock should be available") = true;
    }
}

impl CliProfilesEventSink for RecordingEventSink {
    /// Records one publication attempt and applies the injected failure.
    fn publish(&self, event: CliProfilesChangedDto) -> Result<(), CliProfilesError> {
        let fails = *self
            .fails
            .lock()
            .expect("the fixture lock should be available");
        self.published
            .lock()
            .expect("the fixture lock should be available")
            .push(event);
        if fails {
            Err(CliProfilesError::PersistenceFailed)
        } else {
            Ok(())
        }
    }
}

/// Owns one isolated service with every collaborator replaced by a fixture.
struct Harness {
    service: CliProfilesService,
    storage: Storage,
    gate: DataMaintenanceGate,
    commands: Arc<StubCommandResolver>,
    shells: Arc<StubShellResolver>,
    credentials: Arc<InMemoryCredentialStore>,
    events: Arc<RecordingEventSink>,
    clock: Arc<FixedClock>,
    app_data: TempDir,
}

impl Harness {
    /// Builds one isolated service over a fresh migrated database.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let storage = Storage::open(app_data.path()).expect("isolated storage should open");
        Self::with_storage(storage, app_data)
    }

    /// Builds one isolated service over the supplied migrated database.
    fn with_storage(storage: Storage, app_data: TempDir) -> Self {
        let commands = Arc::new(StubCommandResolver::new());
        let shells = Arc::new(StubShellResolver::windows_like());
        let credentials = Arc::new(InMemoryCredentialStore::new());
        let events = Arc::new(RecordingEventSink::default());
        let clock = Arc::new(FixedClock::new(1_700_000_000_000));
        let gate = DataMaintenanceGate::new();
        // Every documented shell resolves so profile availability depends on the command only.
        shells.set_available("pwsh", "pwsh.exe", ShellMode::PowerShell);
        shells.set_resolved(
            "windows-powershell",
            StubShellResolver::resolved(
                "windows-powershell",
                "powershell.exe",
                ShellMode::PowerShell,
            ),
        );
        shells.set_resolved(
            "cmd",
            StubShellResolver::resolved("cmd", "cmd.exe", ShellMode::WindowsCommandPrompt),
        );
        let service = CliProfilesService::with_seams(
            storage.clone(),
            gate.clone(),
            commands.clone(),
            shells.clone(),
            credentials.clone(),
            events.clone(),
            clock.clone(),
            Arc::new(SequentialIds::default()),
        );
        Self {
            service,
            storage,
            gate,
            commands,
            shells,
            credentials,
            events,
            clock,
            app_data,
        }
    }

    /// Reopens the same database with a second service to prove persistence.
    fn restart(self) -> Self {
        let path = self.app_data.path().to_path_buf();
        drop(self.service);
        drop(self.storage);
        let storage = Storage::open(&path).expect("isolated storage should reopen");
        Self::with_storage(storage, self.app_data)
    }

    /// Reads one snapshot through the public service contract.
    fn snapshot(&self) -> Result<CliProfilesSnapshotDto, CliProfilesError> {
        block_on(self.service.snapshot())
    }
}

/// Runs one future to completion on the shared Tauri runtime.
fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

/// Seeds one complete custom profile with its ordered environment rows.
#[allow(clippy::too_many_arguments)]
fn seed_profile(
    storage: &Storage,
    id: &str,
    name: &str,
    command: &str,
    arguments_json: &str,
    shell_id: Option<&str>,
    created_at_ms: i64,
    environment: &[(&str, Option<&str>, bool, Option<&str>)],
) {
    storage
        .with_connection(
            // Writes the fixture through the same connection production code uses.
            |connection| {
                connection.execute(
                    "INSERT INTO cli_profiles \
                     (id, name, command, arguments_json, shell_id, icon, color, \
                      created_at_ms, updated_at_ms) \
                     VALUES (?1, ?2, ?3, ?4, ?5, 'Fx', '#112233', ?6, ?6)",
                    params![id, name, command, arguments_json, shell_id, created_at_ms],
                )?;
                for (position, (env_name, value, is_secret, account)) in
                    environment.iter().enumerate()
                {
                    connection.execute(
                        "INSERT INTO cli_profile_environment \
                         (profile_id, position, name, value, is_secret, credential_account) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            id,
                            position as i64,
                            env_name,
                            value,
                            i64::from(*is_secret),
                            account
                        ],
                    )?;
                }
                Ok::<_, TestError>(())
            },
        )
        .expect("the profile fixture should be inserted");
}

/// Returns the identifiers of one snapshot's profiles in contract order.
fn profile_ids(snapshot: &CliProfilesSnapshotDto) -> Vec<String> {
    snapshot
        .profiles
        .iter()
        .map(
            // Only identifiers matter for the ordering assertion.
            |profile| profile.id.clone(),
        )
        .collect()
}

/// Verifies hydration exposes built-ins, custom rows, and survives a restart.
#[test]
fn service_hydrates_defaults_and_custom_profiles_after_restart() {
    let harness = Harness::new();
    let first = profile_id(1);
    let second = profile_id(2);
    seed_profile(
        &harness.storage,
        &second,
        "Second",
        "second-tool",
        "[\"--b\"]",
        Some("cmd"),
        200,
        &[("PLAIN", Some("value"), false, None)],
    );
    seed_profile(
        &harness.storage,
        &first,
        "First",
        "C:\\Tools\\first.exe",
        "[\"--a\",\"one two\"]",
        None,
        100,
        &[
            ("ALPHA", Some(""), false, None),
            ("BETA", Some("second"), false, None),
        ],
    );

    let snapshot = harness.snapshot().expect("hydration should succeed");

    assert_eq!(snapshot.revision, "0");
    assert_eq!(snapshot.default_shell_id, "system");
    assert_eq!(snapshot.effective_default_shell_id, "pwsh");
    assert_eq!(
        profile_ids(&snapshot),
        vec![
            "builtin:codex".to_owned(),
            "builtin:claude".to_owned(),
            "builtin:terminal".to_owned(),
            first.clone(),
            second.clone(),
        ]
    );
    let codex = &snapshot.profiles[0];
    assert_eq!(codex.name, "Codex");
    assert_eq!(codex.command.as_deref(), Some("codex"));
    assert_eq!(codex.icon, "Cx");
    assert_eq!(codex.color, "#10a37f");
    assert_eq!(codex.kind, CliProfileKindDto::BuiltIn);
    assert_eq!(codex.effective_shell_id, "pwsh");
    assert_eq!(
        codex.availability.status,
        CliProfileAvailabilityStatusDto::Unchecked
    );
    assert_eq!(codex.availability.checked_at_unix_ms, None);
    // The Terminal profile displays the effective shell command for the picker.
    assert_eq!(snapshot.profiles[2].command.as_deref(), Some("pwsh.exe"));
    let custom = &snapshot.profiles[3];
    assert_eq!(custom.kind, CliProfileKindDto::Custom);
    assert_eq!(custom.command.as_deref(), Some("C:\\Tools\\first.exe"));
    // Arguments stay separate literals, so an argument with a space is never split.
    assert_eq!(
        custom.arguments,
        vec!["--a".to_owned(), "one two".to_owned()]
    );
    assert_eq!(custom.shell_id, None);
    assert_eq!(custom.effective_shell_id, "pwsh");
    assert_eq!(
        custom
            .environment
            .iter()
            .map(
                // Only the ordered name and value pairs matter for this assertion.
                |entry| (entry.name.clone(), entry.value.clone())
            )
            .collect::<Vec<_>>(),
        vec![
            ("ALPHA".to_owned(), Some(String::new())),
            ("BETA".to_owned(), Some("second".to_owned())),
        ]
    );
    // An override keeps its own shell instead of following the global default.
    assert_eq!(snapshot.profiles[4].shell_id.as_deref(), Some("cmd"));
    assert_eq!(snapshot.profiles[4].effective_shell_id, "cmd");
    assert_eq!(
        snapshot
            .shells
            .iter()
            .map(
                // Identifier and default flag are the two stable catalog facts.
                |shell| (shell.id.clone(), shell.is_default)
            )
            .collect::<Vec<_>>(),
        vec![
            ("system".to_owned(), true),
            ("pwsh".to_owned(), false),
            ("windows-powershell".to_owned(), false),
            ("cmd".to_owned(), false),
        ]
    );

    let restarted = harness.restart();
    let reopened = restarted.snapshot().expect("rehydration should succeed");
    assert_eq!(profile_ids(&reopened), profile_ids(&snapshot));
    assert_eq!(
        reopened.profiles[3].arguments,
        snapshot.profiles[3].arguments
    );
    assert_eq!(reopened.revision, "0");
}

/// Verifies that building a snapshot never touches the credential store.
#[test]
fn snapshot_never_reads_the_credential_store() {
    let harness = Harness::new();
    let id = profile_id(1);
    harness
        .credentials
        .seed("account-one", "BE006_SECRET_CANARY");
    seed_profile(
        &harness.storage,
        &id,
        "Secretive",
        "secret-tool",
        "[]",
        None,
        100,
        &[
            ("TOKEN", None, true, Some("account-one")),
            ("PLAIN", Some("visible"), false, None),
        ],
    );

    let snapshot = harness.snapshot().expect("hydration should succeed");

    let environment = &snapshot.profiles[3].environment;
    assert_eq!(environment[0].name, "TOKEN");
    assert_eq!(environment[0].value, None);
    assert!(environment[0].is_secret);
    assert!(environment[0].has_stored_value);
    assert_eq!(environment[1].value.as_deref(), Some("visible"));
    assert!(!environment[1].is_secret);
    assert!(environment[1].has_stored_value);
    assert_eq!(harness.credentials.call_counts(), (0, 0, 0));
    let serialized =
        serde_json::to_string(&snapshot).expect("the snapshot should serialize for the frontend");
    assert!(!serialized.contains("BE006_SECRET_CANARY"));
    assert!(!serialized.contains("account-one"));
}

/// Verifies a corrupt persisted row fails initialization without a default cache.
#[test]
fn corrupt_profile_row_fails_initialization_without_fallback() {
    let harness = Harness::new();
    let id = profile_id(1);
    // The column CHECK only proves JSON array shape, so Rust must reject the element type.
    seed_profile(
        &harness.storage,
        &id,
        "Corrupt",
        "corrupt-tool",
        "[1, 2]",
        None,
        100,
        &[],
    );

    assert_eq!(harness.snapshot(), Err(CliProfilesError::PersistenceFailed));
    // A second attempt must fail identically instead of publishing a silent default.
    assert_eq!(harness.snapshot(), Err(CliProfilesError::PersistenceFailed));
}

/// Verifies a warm snapshot at the documented fixture size stays well under 100 ms.
#[test]
fn warm_snapshot_at_documented_limits_completes_within_100_ms() {
    let harness = Harness::new();
    let argument = "a".repeat(256);
    let arguments_json = serde_json::to_string(&vec![argument; 128])
        .expect("the fixture arguments should serialize");
    let value = "v".repeat(512);
    let environment = (0..64)
        .map(
            // Each fixture profile carries the documented maximum environment count.
            |index| (format!("VAR_{index}"), value.clone()),
        )
        .collect::<Vec<_>>();
    let borrowed = environment
        .iter()
        .map(
            // Borrowed tuples match the shared seeding helper's signature.
            |(name, value)| (name.as_str(), Some(value.as_str()), false, None),
        )
        .collect::<Vec<_>>();
    for index in 0..100u32 {
        seed_profile(
            &harness.storage,
            &profile_id_wide(index),
            "Fixture",
            "fixture-tool",
            &arguments_json,
            None,
            i64::from(index),
            &borrowed,
        );
    }
    // Hydration and operating-system discovery are excluded from the measured path.
    let warm = harness.snapshot().expect("hydration should succeed");
    assert_eq!(warm.profiles.len(), 103);

    let started = Instant::now();
    let snapshot = harness
        .snapshot()
        .expect("the warm snapshot should succeed");
    let elapsed = started.elapsed();

    assert_eq!(snapshot.profiles.len(), 103);
    assert!(
        elapsed < Duration::from_millis(100),
        "a warm snapshot took {elapsed:?}"
    );
}

/// Returns one canonical identifier for the wide performance fixture.
fn profile_id_wide(index: u32) -> String {
    format!("profile-{index:08x}-0000-4000-8000-000000000000")
}

/// Builds one profile input from borrowed fixture values.
fn profile_input(
    name: &str,
    command: &str,
    arguments: &[&str],
    shell_id: Option<&str>,
    environment: &[(&str, Option<&str>, bool)],
) -> CliProfileInputDto {
    CliProfileInputDto {
        name: name.to_owned(),
        command: command.to_owned(),
        arguments: arguments.iter().map(|value| (*value).to_owned()).collect(),
        shell_id: shell_id.map(str::to_owned),
        icon: "Fx".to_owned(),
        color: "#112233".to_owned(),
        environment: environment
            .iter()
            .map(
                // Each fixture tuple becomes one environment input entry.
                |(name, value, is_secret)| CliProfileEnvironmentInputDto {
                    name: (*name).to_owned(),
                    value: value.map(str::to_owned),
                    is_secret: *is_secret,
                },
            )
            .collect(),
    }
}

/// Reads every queued credential reference from the isolated database.
fn queue_accounts(storage: &Storage) -> Vec<String> {
    storage
        .with_connection(
            // Reads the durable outbox through the production storage seam.
            |connection| {
                let mut statement = connection.prepare(
                    "SELECT credential_account FROM credential_cleanup_queue \
                     ORDER BY credential_account",
                )?;
                let accounts = statement
                    .query_map(
                        [],
                        // Decodes one queued credential reference.
                        |row| row.get::<_, String>(0),
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok::<_, TestError>(accounts)
            },
        )
        .expect("the cleanup queue should be readable")
}

/// Reads one profile's persisted environment rows in position order.
fn stored_environment(
    storage: &Storage,
    profile_id: &str,
) -> Vec<(String, Option<String>, i64, Option<String>)> {
    storage
        .with_connection(
            // Reads persisted metadata so no assertion depends on the cache.
            |connection| {
                let mut statement = connection.prepare(
                    "SELECT name, value, is_secret, credential_account \
                     FROM cli_profile_environment WHERE profile_id = ?1 ORDER BY position",
                )?;
                let rows = statement
                    .query_map(
                        params![profile_id],
                        // Decodes every persisted environment column.
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, Option<String>>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, Option<String>>(3)?,
                            ))
                        },
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok::<_, TestError>(rows)
            },
        )
        .expect("the environment rows should be readable")
}

/// Returns the fixture credential account the identifier source produces next.
fn fixture_account(index: u32) -> String {
    format!("{index:08x}-0000-4000-8000-aaaaaaaaaaaa")
}

/// Verifies that creating a profile persists every field and publishes once.
#[test]
fn create_persists_every_field_and_publishes_created() {
    let harness = Harness::new();

    let snapshot = block_on(harness.service.create_profile(profile_input(
        "  My Tool  ",
        "  my-tool  ",
        &["--flag", "one two"],
        Some("cmd"),
        &[
            ("PLAIN", Some("visible"), false),
            ("TOKEN", Some("BE006_SECRET_CANARY"), true),
        ],
    )))
    .expect("the profile should be created");

    let id = profile_id(1);
    assert_eq!(snapshot.revision, "1");
    assert_eq!(profile_ids(&snapshot).len(), 4);
    let created = &snapshot.profiles[3];
    assert_eq!(created.id, id);
    // Trimming applies to the display fields without touching argument literals.
    assert_eq!(created.name, "My Tool");
    assert_eq!(created.command.as_deref(), Some("my-tool"));
    assert_eq!(
        created.arguments,
        vec!["--flag".to_owned(), "one two".to_owned()]
    );
    assert_eq!(created.shell_id.as_deref(), Some("cmd"));
    assert_eq!(created.effective_shell_id, "cmd");
    assert_eq!(
        created.availability.status,
        CliProfileAvailabilityStatusDto::Unchecked
    );
    assert_eq!(
        harness.events.recorded(),
        vec![("1".to_owned(), "Created".to_owned(), Some(id.clone()))]
    );

    // The secret lives only in the credential store, never in SQLite.
    assert_eq!(
        stored_environment(&harness.storage, &id),
        vec![
            ("PLAIN".to_owned(), Some("visible".to_owned()), 0, None),
            ("TOKEN".to_owned(), None, 1, Some(fixture_account(1))),
        ]
    );
    assert_eq!(
        harness.credentials.stored_secret(&fixture_account(1)),
        Some("BE006_SECRET_CANARY".to_owned())
    );
    assert!(queue_accounts(&harness.storage).is_empty());
}

/// Verifies that a full update keeps a secret whose value is omitted.
#[test]
fn update_replaces_configuration_and_preserves_kept_secret() {
    let harness = Harness::new();
    block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &["--a"],
        None,
        &[("TOKEN", Some("original"), true)],
    )))
    .expect("the profile should be created");
    let id = profile_id(1);

    let snapshot = block_on(harness.service.update_profile(
        &id,
        profile_input(
            "Renamed",
            "second-tool",
            &["--b", "--c"],
            Some("windows-powershell"),
            &[("TOKEN", None, true), ("EXTRA", Some("added"), false)],
        ),
    ))
    .expect("the profile should be updated");

    assert_eq!(snapshot.revision, "2");
    let updated = &snapshot.profiles[3];
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.command.as_deref(), Some("second-tool"));
    assert_eq!(updated.arguments, vec!["--b".to_owned(), "--c".to_owned()]);
    assert_eq!(updated.effective_shell_id, "windows-powershell");
    // The kept secret still references its original credential account.
    assert_eq!(
        stored_environment(&harness.storage, &id),
        vec![
            ("TOKEN".to_owned(), None, 1, Some(fixture_account(1))),
            ("EXTRA".to_owned(), Some("added".to_owned()), 0, None),
        ]
    );
    assert_eq!(
        harness.credentials.stored_secret(&fixture_account(1)),
        Some("original".to_owned())
    );
    assert!(queue_accounts(&harness.storage).is_empty());
    assert_eq!(
        harness.events.recorded().last().cloned(),
        Some(("2".to_owned(), "Updated".to_owned(), Some(id)))
    );
}

/// Verifies that a new or renamed secret must always supply its value.
#[test]
fn renamed_or_new_secret_without_value_is_rejected() {
    let harness = Harness::new();

    // A brand-new profile has no current credential to keep.
    assert_eq!(
        block_on(harness.service.create_profile(profile_input(
            "First",
            "first-tool",
            &[],
            None,
            &[("TOKEN", None, true)],
        ))),
        Err(CliProfilesError::SecretValueRequired)
    );
    assert!(harness.credentials.accounts().is_empty());

    let created = block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[("TOKEN", Some("original"), true)],
    )))
    .expect("the profile should be created");
    // The rejected attempt already consumed one fixture identifier.
    let id = created.profiles[3].id.clone();

    // A renamed secret is a different variable, so it needs its own value.
    assert_eq!(
        block_on(harness.service.update_profile(
            &id,
            profile_input("First", "first-tool", &[], None, &[("RENAMED", None, true)]),
        )),
        Err(CliProfilesError::SecretValueRequired)
    );
    // A previously plain variable can never silently become a kept secret.
    block_on(harness.service.update_profile(
        &id,
        profile_input(
            "First",
            "first-tool",
            &[],
            None,
            &[("PLAIN", Some("value"), false)],
        ),
    ))
    .expect("the profile should drop its secret");
    assert_eq!(
        block_on(harness.service.update_profile(
            &id,
            profile_input("First", "first-tool", &[], None, &[("PLAIN", None, true)]),
        )),
        Err(CliProfilesError::SecretValueRequired)
    );
    assert_eq!(
        stored_environment(&harness.storage, &id),
        vec![("PLAIN".to_owned(), Some("value".to_owned()), 0, None)]
    );
}

/// Verifies that a changed secret writes a new credential and queues the old one.
#[test]
fn changed_secret_replaces_the_credential_and_queues_the_old_one() {
    let harness = Harness::new();
    block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[("TOKEN", Some("original"), true)],
    )))
    .expect("the profile should be created");
    let id = profile_id(1);
    // A failing delete keeps the queue row observable after the commit.
    harness
        .credentials
        .fail_deletes(xwork_lib::platform::credential::CredentialError::Unavailable);

    block_on(harness.service.update_profile(
        &id,
        profile_input(
            "First",
            "first-tool",
            &[],
            None,
            &[("TOKEN", Some("rotated"), true)],
        ),
    ))
    .expect("the rotated secret should be committed");

    assert_eq!(
        stored_environment(&harness.storage, &id),
        vec![("TOKEN".to_owned(), None, 1, Some(fixture_account(2)))]
    );
    assert_eq!(
        harness.credentials.stored_secret(&fixture_account(2)),
        Some("rotated".to_owned())
    );
    assert_eq!(queue_accounts(&harness.storage), vec![fixture_account(1)]);
}

/// Verifies that deleting a profile removes metadata and cleans up credentials.
#[test]
fn delete_removes_metadata_and_cleans_up_credentials() {
    let harness = Harness::new();
    block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[("TOKEN", Some("original"), true)],
    )))
    .expect("the profile should be created");
    let id = profile_id(1);

    let snapshot =
        block_on(harness.service.delete_profile(&id)).expect("the profile should be deleted");

    assert_eq!(profile_ids(&snapshot).len(), 3);
    assert_eq!(snapshot.revision, "2");
    assert_eq!(row_count(&harness.storage, "cli_profiles"), 0);
    assert_eq!(row_count(&harness.storage, "cli_profile_environment"), 0);
    // Post-commit cleanup deleted the credential and cleared its queue row.
    assert!(queue_accounts(&harness.storage).is_empty());
    assert!(harness.credentials.accounts().is_empty());
    assert_eq!(
        harness.events.recorded().last().cloned(),
        Some(("2".to_owned(), "Deleted".to_owned(), Some(id.clone())))
    );
    assert_eq!(
        block_on(harness.service.delete_profile(&id)),
        Err(CliProfilesError::ProfileNotFound)
    );
}

/// Verifies that built-in profiles reject every mutation before any side effect.
#[test]
fn built_in_profiles_reject_update_and_delete() {
    let harness = Harness::new();
    harness.snapshot().expect("hydration should succeed");

    for id in ["builtin:codex", "builtin:claude", "builtin:terminal"] {
        assert_eq!(
            block_on(
                harness
                    .service
                    .update_profile(id, profile_input("X", "x-tool", &[], None, &[]))
            ),
            Err(CliProfilesError::BuiltInProfileReadOnly)
        );
        assert_eq!(
            block_on(harness.service.delete_profile(id)),
            Err(CliProfilesError::BuiltInProfileReadOnly)
        );
    }
    assert_eq!(row_count(&harness.storage, "cli_profiles"), 0);
    assert!(harness.events.recorded().is_empty());
    // An unknown but well-formed identifier is a plain not-found result.
    assert_eq!(
        block_on(harness.service.delete_profile(&profile_id(9))),
        Err(CliProfilesError::ProfileNotFound)
    );
    assert_eq!(
        block_on(harness.service.delete_profile("not-an-identifier")),
        Err(CliProfilesError::ProfileNotFound)
    );
}

/// Verifies that the hundredth profile is accepted and the next one is rejected.
#[test]
fn hundredth_profile_is_the_last_accepted_one() {
    let harness = Harness::new();
    for index in 0..100 {
        block_on(harness.service.create_profile(profile_input(
            &format!("Fixture {index}"),
            "fixture-tool",
            &[],
            None,
            &[],
        )))
        .expect("every profile up to the limit should be created");
    }

    assert_eq!(
        block_on(harness.service.create_profile(profile_input(
            "Overflow",
            "fixture-tool",
            &[],
            None,
            &[],
        ))),
        Err(CliProfilesError::TooManyProfiles)
    );
    assert_eq!(row_count(&harness.storage, "cli_profiles"), 100);
    assert_eq!(harness.snapshot().expect("hydration").revision, "100");
}

/// Verifies that a default shell change moves only inheriting profiles.
#[test]
fn default_shell_change_moves_only_inheriting_profiles() {
    let harness = Harness::new();
    block_on(harness.service.create_profile(profile_input(
        "Inheriting",
        "first-tool",
        &[],
        None,
        &[],
    )))
    .expect("the inheriting profile should be created");
    block_on(harness.service.create_profile(profile_input(
        "Overriding",
        "second-tool",
        &[],
        Some("windows-powershell"),
        &[],
    )))
    .expect("the overriding profile should be created");

    let snapshot = block_on(harness.service.set_default_shell("cmd"))
        .expect("a resolvable catalog shell should be accepted");

    assert_eq!(snapshot.default_shell_id, "cmd");
    assert_eq!(snapshot.effective_default_shell_id, "cmd");
    assert_eq!(snapshot.profiles[2].effective_shell_id, "cmd");
    assert_eq!(snapshot.profiles[3].effective_shell_id, "cmd");
    // The overriding profile keeps its own shell regardless of the new default.
    assert_eq!(
        snapshot.profiles[4].effective_shell_id,
        "windows-powershell"
    );
    assert_eq!(
        snapshot
            .shells
            .iter()
            .filter(
                // Exactly one catalog entry may be flagged as the persisted default.
                |shell| shell.is_default
            )
            .map(|shell| shell.id.clone())
            .collect::<Vec<_>>(),
        vec!["cmd".to_owned()]
    );
    assert_eq!(
        harness.events.recorded().last().cloned(),
        Some(("3".to_owned(), "DefaultShellChanged".to_owned(), None))
    );

    // A shell outside the catalog and an unresolvable catalog shell both fail closed.
    assert_eq!(
        block_on(harness.service.set_default_shell("bash")),
        Err(CliProfilesError::InvalidShell)
    );
    harness.shells.set_error(
        "pwsh",
        xwork_lib::platform::shell::ShellResolutionError::NotFound,
    );
    assert_eq!(
        block_on(harness.service.set_default_shell("pwsh")),
        Err(CliProfilesError::ShellNotFound)
    );
    assert_eq!(
        harness
            .snapshot()
            .expect("hydration should succeed")
            .default_shell_id,
        "cmd"
    );
}

/// Verifies that every committed mutation survives a service restart.
#[test]
fn mutations_survive_a_restart() {
    let harness = Harness::new();
    block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &["--a", "one two"],
        Some("cmd"),
        &[
            ("PLAIN", Some("visible"), false),
            ("TOKEN", Some("secret"), true),
        ],
    )))
    .expect("the profile should be created");
    block_on(harness.service.set_default_shell("windows-powershell"))
        .expect("the default shell should change");
    let before = harness.snapshot().expect("hydration should succeed");

    let restarted = harness.restart();
    let after = restarted.snapshot().expect("rehydration should succeed");

    assert_eq!(after.default_shell_id, "windows-powershell");
    assert_eq!(after.effective_default_shell_id, "windows-powershell");
    assert_eq!(profile_ids(&after), profile_ids(&before));
    assert_eq!(after.profiles[3].arguments, before.profiles[3].arguments);
    assert_eq!(
        after.profiles[3].environment,
        before.profiles[3].environment
    );
    // A restart resets only the in-process revision counter.
    assert_eq!(after.revision, "0");
}

/// Verifies that a failed credential write changes nothing observable.
#[test]
fn secret_write_failure_changes_nothing() {
    let harness = Harness::new();
    harness.snapshot().expect("hydration should succeed");
    harness
        .credentials
        .fail_writes(xwork_lib::platform::credential::CredentialError::Unavailable);

    assert_eq!(
        block_on(harness.service.create_profile(profile_input(
            "First",
            "first-tool",
            &[],
            None,
            &[("TOKEN", Some("BE006_SECRET_CANARY"), true)],
        ))),
        Err(CliProfilesError::CredentialStoreUnavailable)
    );

    assert_eq!(row_count(&harness.storage, "cli_profiles"), 0);
    assert!(harness.credentials.accounts().is_empty());
    assert!(queue_accounts(&harness.storage).is_empty());
    assert!(harness.events.recorded().is_empty());
    assert_eq!(harness.snapshot().expect("hydration").revision, "0");
}

/// Verifies that a failed transaction deletes every staged credential.
#[test]
fn database_failure_compensates_staged_credentials() {
    let harness = Harness::new();
    // A foreign profile already owns the account the fixture source generates next.
    seed_profile(
        &harness.storage,
        &profile_id(200),
        "Blocker",
        "blocker-tool",
        "[]",
        None,
        1,
        &[("TOKEN", None, true, Some(&fixture_account(1)))],
    );

    assert_eq!(
        block_on(harness.service.create_profile(profile_input(
            "First",
            "first-tool",
            &[],
            None,
            &[("TOKEN", Some("BE006_SECRET_CANARY"), true)],
        ))),
        Err(CliProfilesError::PersistenceFailed)
    );

    // Only the pre-existing blocker profile survives, without its secret rewritten.
    assert_eq!(row_count(&harness.storage, "cli_profiles"), 1);
    assert!(harness.credentials.accounts().is_empty());
    assert!(queue_accounts(&harness.storage).is_empty());
    assert!(harness.events.recorded().is_empty());
}

/// Verifies that a credential which resists compensation stays durably queued.
#[test]
fn compensation_failure_is_durably_queued() {
    let harness = Harness::new();
    seed_profile(
        &harness.storage,
        &profile_id(200),
        "Blocker",
        "blocker-tool",
        "[]",
        None,
        1,
        &[("TOKEN", None, true, Some(&fixture_account(1)))],
    );
    harness.snapshot().expect("hydration should succeed");
    harness
        .credentials
        .fail_deletes(xwork_lib::platform::credential::CredentialError::Unavailable);

    assert_eq!(
        block_on(harness.service.create_profile(profile_input(
            "First",
            "first-tool",
            &[],
            None,
            &[("TOKEN", Some("BE006_SECRET_CANARY"), true)],
        ))),
        Err(CliProfilesError::PersistenceFailed)
    );

    // The staged credential still exists, so its reference must remain queued.
    assert_eq!(
        harness.credentials.stored_secret(&fixture_account(1)),
        Some("BE006_SECRET_CANARY".to_owned())
    );
    assert_eq!(queue_accounts(&harness.storage), vec![fixture_account(1)]);
    assert_eq!(row_count(&harness.storage, "cli_profiles"), 1);
    assert!(harness.events.recorded().is_empty());
}

/// Verifies that a failed post-commit delete keeps both the result and the queue.
#[test]
fn post_commit_delete_failure_keeps_success_and_queue() {
    let harness = Harness::new();
    block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[("TOKEN", Some("original"), true)],
    )))
    .expect("the profile should be created");
    let id = profile_id(1);
    harness
        .credentials
        .fail_deletes(xwork_lib::platform::credential::CredentialError::Unavailable);

    let snapshot = block_on(harness.service.delete_profile(&id))
        .expect("a failed credential cleanup must not fail the committed delete");

    assert_eq!(profile_ids(&snapshot).len(), 3);
    assert_eq!(row_count(&harness.storage, "cli_profiles"), 0);
    assert_eq!(queue_accounts(&harness.storage), vec![fixture_account(1)]);
    assert_eq!(
        harness.credentials.stored_secret(&fixture_account(1)),
        Some("original".to_owned())
    );
}

/// Verifies that a queue row survives until its credential is provably gone.
#[test]
fn cleanup_deletes_queue_row_only_after_deleted_or_not_found() {
    let harness = Harness::new();
    harness.snapshot().expect("hydration should succeed");
    harness.credentials.seed(&fixture_account(1), "original");
    harness
        .storage
        .with_connection(
            // Seeds two references so both cleanup outcomes are exercised at once.
            |connection| {
                connection.execute(
                    "INSERT INTO credential_cleanup_queue (credential_account, queued_at_ms) \
                     VALUES (?1, 1), (?2, 2)",
                    params![fixture_account(1), fixture_account(2)],
                )?;
                Ok::<_, TestError>(())
            },
        )
        .expect("the queue fixture should be inserted");
    harness.credentials.fail_next_deletes(
        xwork_lib::platform::credential::CredentialError::Unavailable,
        1,
    );

    assert_eq!(
        block_on(harness.service.retry_credential_cleanup()),
        Err(CliProfilesError::CredentialStoreUnavailable)
    );
    // The first reference failed, while the absent second one is already resolved.
    assert_eq!(queue_accounts(&harness.storage), vec![fixture_account(1)]);

    block_on(harness.service.retry_credential_cleanup())
        .expect("the retry should clear the remaining reference");

    assert!(queue_accounts(&harness.storage).is_empty());
    assert!(harness.credentials.accounts().is_empty());
}

/// Returns one inert fixture executable path for the stub resolver.
fn fixture_executable(name: &str) -> PathBuf {
    PathBuf::from(format!("C:\\fixture\\{name}"))
}

/// Polls one pinned future exactly once with a no-op waker.
fn poll_once<T>(future: &mut Pin<Box<dyn Future<Output = T> + Send + '_>>) -> Poll<T> {
    let waker = Waker::noop();
    let mut context = Context::from_waker(waker);
    future.as_mut().poll(&mut context)
}

/// Verifies that a completed check publishes an available status exactly once.
#[test]
fn check_publishes_available_status_and_completion_time() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("codex", fixture_executable("codex.exe"));

    let checked = block_on(harness.service.check_profile("builtin:codex"))
        .expect("the built-in check should succeed");

    assert_eq!(
        checked.availability.status,
        CliProfileAvailabilityStatusDto::Available
    );
    assert_eq!(
        checked.availability.checked_at_unix_ms.as_deref(),
        Some("1700000000000")
    );
    assert_eq!(
        harness.events.recorded(),
        vec![(
            "1".to_owned(),
            "AvailabilityChanged".to_owned(),
            Some("builtin:codex".to_owned())
        )]
    );
    // Every other profile keeps its unchecked status until it is checked too.
    let snapshot = harness.snapshot().expect("hydration should succeed");
    assert_eq!(
        snapshot.profiles[1].availability.status,
        CliProfileAvailabilityStatusDto::Unchecked
    );
    assert_eq!(snapshot.revision, "1");

    // The completion time only moves when another check actually finishes.
    harness.clock.advance(5_000);
    let rechecked = block_on(harness.service.check_profile("builtin:codex"))
        .expect("the second check should succeed");
    assert_eq!(
        rechecked.availability.checked_at_unix_ms.as_deref(),
        Some("1700000005000")
    );
}

/// Verifies that missing commands and shells stay successful DTO statuses.
#[test]
fn missing_command_or_shell_is_a_successful_status() {
    let harness = Harness::new();

    let missing_command = block_on(harness.service.check_profile("builtin:claude"))
        .expect("a missing command is not an IPC failure");
    assert_eq!(
        missing_command.availability.status,
        CliProfileAvailabilityStatusDto::CommandNotFound
    );

    // The Terminal profile only needs its effective shell to resolve.
    let terminal = block_on(harness.service.check_profile("builtin:terminal"))
        .expect("the Terminal check should succeed");
    assert_eq!(
        terminal.availability.status,
        CliProfileAvailabilityStatusDto::Available
    );

    harness
        .shells
        .set_error("pwsh", ShellResolutionError::NotFound);
    let missing_shell = block_on(harness.service.check_profile("builtin:terminal"))
        .expect("a missing shell is not an IPC failure");
    assert_eq!(
        missing_shell.availability.status,
        CliProfileAvailabilityStatusDto::ShellNotFound
    );
    assert_eq!(
        block_on(
            harness
                .service
                .check_profile("profile-00000009-0000-4000-8000-000000000000")
        ),
        Err(CliProfilesError::ProfileNotFound)
    );
}

/// Verifies that an operating-system inspection failure preserves the status.
#[test]
fn resolver_failure_is_typed_and_preserves_the_previous_status() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("codex", fixture_executable("codex.exe"));
    block_on(harness.service.check_profile("builtin:codex"))
        .expect("the first check should succeed");

    harness
        .commands
        .set_error("codex", CommandResolutionError::Inspection);

    assert_eq!(
        block_on(harness.service.check_profile("builtin:codex")),
        Err(CliProfilesError::CommandResolutionFailed)
    );
    let snapshot = harness.snapshot().expect("hydration should succeed");
    assert_eq!(
        snapshot.profiles[0].availability.status,
        CliProfileAvailabilityStatusDto::Available
    );
    // A failed check publishes nothing, so the revision stays where it was.
    assert_eq!(snapshot.revision, "1");
}

/// Verifies that an explicit check runs while maintenance holds the write permit.
#[test]
fn explicit_check_does_not_require_a_maintenance_permit() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("codex", fixture_executable("codex.exe"));
    harness.snapshot().expect("hydration should succeed");
    let write_permit = block_on(harness.gate.write_permit());

    let service = harness.service.clone();
    let (sender, receiver) = mpsc::channel();
    let worker = std::thread::spawn(
        // A runtime cache change must not wait for the maintenance permit.
        move || {
            let result = block_on(service.check_profile("builtin:codex"));
            sender
                .send(result)
                .expect("the result receiver should remain open");
        },
    );

    let checked = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("the check should complete without maintenance admission")
        .expect("the check should succeed");
    assert_eq!(
        checked.availability.status,
        CliProfileAvailabilityStatusDto::Available
    );
    worker.join().expect("the check thread should join");
    drop(write_permit);
}

/// Verifies that at most four availability checks run at the same time.
#[test]
fn availability_checks_are_capped_at_four() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("codex", fixture_executable("codex.exe"));
    harness.snapshot().expect("hydration should succeed");
    let limit = harness.service.check_concurrency_limit();
    let held = limit
        .clone()
        .try_acquire_many_owned(4)
        .expect("the documented limit should provide exactly four permits");
    assert_eq!(limit.available_permits(), 0);

    let mut check: Pin<Box<dyn Future<Output = _> + Send + '_>> =
        Box::pin(harness.service.check_profile("builtin:codex"));
    assert!(poll_once(&mut check).is_pending());

    drop(held);
    let checked = block_on(check).expect("the fifth check should proceed after a permit frees");
    assert_eq!(
        checked.availability.status,
        CliProfileAvailabilityStatusDto::Available
    );
}

/// Verifies that a result from a stale generation is discarded on arrival.
#[test]
fn stale_availability_result_is_discarded() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("codex", fixture_executable("codex.exe"));
    harness.snapshot().expect("hydration should succeed");

    let mut check: Pin<Box<dyn Future<Output = _> + Send + '_>> =
        Box::pin(harness.service.check_profile("builtin:codex"));
    // The first poll snapshots the configuration and starts the blocking resolution.
    assert!(poll_once(&mut check).is_pending());
    block_on(harness.service.set_default_shell("cmd"))
        .expect("the competing configuration change should commit");

    let checked = block_on(check).expect("a discarded result is still a successful read");

    assert_eq!(
        checked.availability.status,
        CliProfileAvailabilityStatusDto::Unchecked
    );
    assert_eq!(checked.availability.checked_at_unix_ms, None);
    // Only the configuration change published, so no availability event exists.
    assert_eq!(
        harness.events.recorded(),
        vec![("1".to_owned(), "DefaultShellChanged".to_owned(), None)]
    );
    assert_eq!(harness.snapshot().expect("hydration").revision, "1");
}

/// Verifies that revisions and event kinds follow the exact mutation order.
#[test]
fn revision_and_events_follow_the_mutation_order() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("first-tool", fixture_executable("first.exe"));
    let created = block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[],
    )))
    .expect("the profile should be created");
    let id = created.profiles[3].id.clone();
    block_on(
        harness
            .service
            .update_profile(&id, profile_input("Renamed", "first-tool", &[], None, &[])),
    )
    .expect("the profile should be updated");
    block_on(harness.service.check_profile(&id)).expect("the check should succeed");
    block_on(harness.service.set_default_shell("cmd")).expect("the default shell should change");
    block_on(harness.service.delete_profile(&id)).expect("the profile should be deleted");

    assert_eq!(
        harness.events.recorded(),
        vec![
            ("1".to_owned(), "Created".to_owned(), Some(id.clone())),
            ("2".to_owned(), "Updated".to_owned(), Some(id.clone())),
            (
                "3".to_owned(),
                "AvailabilityChanged".to_owned(),
                Some(id.clone())
            ),
            ("4".to_owned(), "DefaultShellChanged".to_owned(), None),
            ("5".to_owned(), "Deleted".to_owned(), Some(id)),
        ]
    );
    assert_eq!(harness.snapshot().expect("hydration").revision, "5");
}

/// Verifies that a failed event delivery never rolls back a committed change.
#[test]
fn event_sink_failure_keeps_the_committed_state() {
    let harness = Harness::new();
    harness.snapshot().expect("hydration should succeed");
    harness.events.start_failing();

    let snapshot = block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[],
    )))
    .expect("a failed event must not fail the committed create");

    assert_eq!(snapshot.revision, "1");
    assert_eq!(row_count(&harness.storage, "cli_profiles"), 1);
    // The attempt was still recorded, proving publication ran after the commit.
    assert_eq!(harness.events.recorded().len(), 1);
    assert_eq!(harness.snapshot().expect("hydration").revision, "1");
}

/// Verifies that Sessions receives a freshly resolved launch availability.
#[test]
fn launchability_rechecks_instead_of_trusting_the_cache() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("codex", fixture_executable("codex.exe"));
    let available = block_on(harness.service.launchability("builtin:codex"))
        .expect("the built-in lookup should succeed");

    assert_eq!(available.id, "builtin:codex");
    assert_eq!(available.display_name, "Codex");
    assert!(available.is_available);
    // A read-only lookup never publishes a revision of its own.
    assert!(harness.events.recorded().is_empty());

    harness
        .commands
        .set_error("codex", CommandResolutionError::NotFound);
    assert!(
        !block_on(harness.service.launchability("builtin:codex"))
            .expect("a missing command is still a successful lookup")
            .is_available
    );

    harness
        .commands
        .set_found("codex", fixture_executable("codex.exe"));
    harness
        .shells
        .set_error("pwsh", ShellResolutionError::NotFound);
    assert!(
        !block_on(harness.service.launchability("builtin:codex"))
            .expect("a missing shell is still a successful lookup")
            .is_available
    );
    assert_eq!(
        block_on(
            harness
                .service
                .launchability("profile-00000009-0000-4000-8000-000000000000")
        ),
        Err(CliProfilesError::ProfileNotFound)
    );
}

/// Verifies that a launch resolution keeps every field separate and reads secrets.
#[test]
fn resolve_for_launch_returns_structured_fields_and_reads_secrets() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("first-tool", fixture_executable("first.exe"));
    let created = block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &["--flag", "one two"],
        Some("cmd"),
        &[
            ("PLAIN", Some("visible"), false),
            ("TOKEN", Some("BE006_SECRET_CANARY"), true),
        ],
    )))
    .expect("the profile should be created");
    let id = created.profiles[3].id.clone();
    let reads_before = harness.credentials.call_counts().1;

    let resolved =
        block_on(harness.service.resolve_for_launch(&id)).expect("the launch should resolve");

    assert_eq!(resolved.profile_id, id);
    assert_eq!(resolved.display_name, "First");
    match resolved.launch_kind {
        ResolvedCliLaunchKind::Command {
            ref shell,
            ref executable,
            ref arguments,
        } => {
            assert_eq!(shell.id, "cmd");
            assert_eq!(
                executable,
                &fixture_executable("first.exe").display().to_string()
            );
            // Arguments stay separate literals and are never joined into the command.
            assert_eq!(arguments, &vec!["--flag".to_owned(), "one two".to_owned()]);
        }
        ResolvedCliLaunchKind::InteractiveShell { .. } => {
            panic!("a custom profile launches its own command")
        }
    }
    assert_eq!(
        resolved
            .environment
            .iter()
            .map(
                // Both the name and the resolved value are asserted in order.
                |(name, value)| (name.clone(), value.as_str().to_owned())
            )
            .collect::<Vec<_>>(),
        vec![
            ("PLAIN".to_owned(), "visible".to_owned()),
            ("TOKEN".to_owned(), "BE006_SECRET_CANARY".to_owned()),
        ]
    );
    // Exactly one credential read happened, and only inside this method.
    assert_eq!(harness.credentials.call_counts().1, reads_before + 1);

    // The Terminal profile resolves to an interactive shell instead of a command.
    let terminal = block_on(harness.service.resolve_for_launch("builtin:terminal"))
        .expect("the Terminal launch should resolve");
    assert!(matches!(
        terminal.launch_kind,
        ResolvedCliLaunchKind::InteractiveShell { .. }
    ));
    assert!(terminal.environment.is_empty());
}

/// Verifies that every launch failure blocks the whole launch without a partial result.
#[test]
fn resolve_for_launch_fails_closed_on_every_error() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("first-tool", fixture_executable("first.exe"));
    let created = block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[("TOKEN", Some("BE006_SECRET_CANARY"), true)],
    )))
    .expect("the profile should be created");
    let id = created.profiles[3].id.clone();

    // A credential deleted outside the application leaves valid metadata behind.
    harness
        .credentials
        .delete_secret(&fixture_account(1))
        .expect("the fixture credential should be removable");
    assert_eq!(
        block_on(harness.service.resolve_for_launch(&id)).err(),
        Some(CliProfilesError::SecretNotFound)
    );

    harness.credentials.seed(&fixture_account(1), "restored");
    harness.credentials.fail_reads(CredentialError::ReadFailed);
    assert_eq!(
        block_on(harness.service.resolve_for_launch(&id)).err(),
        Some(CliProfilesError::SecretReadFailed)
    );

    harness.credentials.fail_reads(CredentialError::Unavailable);
    assert_eq!(
        block_on(harness.service.resolve_for_launch(&id)).err(),
        Some(CliProfilesError::CredentialStoreUnavailable)
    );

    harness.credentials.clear_failures();
    harness
        .commands
        .set_error("first-tool", CommandResolutionError::NotFound);
    assert_eq!(
        block_on(harness.service.resolve_for_launch(&id)).err(),
        Some(CliProfilesError::CommandNotFound)
    );

    harness
        .commands
        .set_found("first-tool", fixture_executable("first.exe"));
    harness
        .shells
        .set_error("pwsh", ShellResolutionError::NotFound);
    assert_eq!(
        block_on(harness.service.resolve_for_launch(&id)).err(),
        Some(CliProfilesError::ShellNotFound)
    );
}

/// Verifies that a resolved secret buffer is zeroized instead of merely dropped.
#[test]
fn resolved_secret_buffer_is_zeroized() {
    let harness = Harness::new();
    harness
        .commands
        .set_found("first-tool", fixture_executable("first.exe"));
    let created = block_on(harness.service.create_profile(profile_input(
        "First",
        "first-tool",
        &[],
        None,
        &[("TOKEN", Some("BE006_SECRET_CANARY"), true)],
    )))
    .expect("the profile should be created");
    let id = created.profiles[3].id.clone();

    let mut resolved =
        block_on(harness.service.resolve_for_launch(&id)).expect("the launch should resolve");
    // The launch contract hands every value over inside a zeroizing buffer.
    let (_, mut buffer): (String, Zeroizing<String>) = resolved.environment.remove(0);
    let pointer = buffer.as_ptr();
    let length = buffer.len();
    assert_eq!(buffer.as_str(), "BE006_SECRET_CANARY");

    // Running the same zeroize implementation the drop glue runs keeps the
    // allocation owned, so the cleared bytes can be inspected safely.
    buffer.zeroize();

    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    assert!(
        bytes.iter().all(|byte| *byte == 0),
        "the secret buffer should be zeroized"
    );
    assert!(buffer.is_empty());
}

/// Owns one mock application whose CLI profile collaborators are fixtures.
struct CommandApp {
    app: tauri::App<tauri::test::MockRuntime>,
    storage: Storage,
    commands: Arc<StubCommandResolver>,
    credentials: Arc<InMemoryCredentialStore>,
    events: Arc<RecordingEventSink>,
    _app_data: TempDir,
}

impl CommandApp {
    /// Builds one mock application with hydrated CLI profile state.
    fn new() -> Self {
        let app_data = TempDir::new().expect("the temporary app data should be created");
        let commands = Arc::new(StubCommandResolver::new());
        let shells = Arc::new(StubShellResolver::windows_like());
        shells.set_available("pwsh", "pwsh.exe", ShellMode::PowerShell);
        shells.set_resolved(
            "cmd",
            StubShellResolver::resolved("cmd", "cmd.exe", ShellMode::WindowsCommandPrompt),
        );
        let credentials = Arc::new(InMemoryCredentialStore::new());
        let events = Arc::new(RecordingEventSink::default());
        let collaborators = (
            commands.clone(),
            shells,
            credentials.clone(),
            events.clone(),
            Arc::new(FixedClock::new(1_700_000_000_000)),
            Arc::new(SequentialIds::default()),
        );
        let mut app = xwork_lib::app::configure_with_cli_profiles_for_tests(
            tauri::test::mock_builder(),
            app_data.path().to_path_buf(),
            // Every operating-system seam is replaced before the command surface runs.
            move |_app_handle| {
                (
                    collaborators.0,
                    collaborators.1,
                    collaborators.2,
                    collaborators.3,
                    collaborators.4,
                    collaborators.5,
                )
            },
        )
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("the configured mock application should build");
        #[allow(deprecated)]
        app.run_iteration(
            // Advances the mock lifecycle once so Tauri executes its setup hook.
            |_app_handle, _event| {},
        );
        let storage = app.state::<Storage>().inner().clone();
        Self {
            app,
            storage,
            commands,
            credentials,
            events,
            _app_data: app_data,
        }
    }

    /// Creates one mock webview window with the requested backend-owned label.
    fn window(&self, label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
        WebviewWindowBuilder::new(&self.app, label, Default::default())
            .build()
            .expect("the mock webview should build")
    }

    /// Returns the managed CLI profiles service for deterministic setup.
    fn service(&self) -> CliProfilesService {
        self.app.state::<CliProfilesService>().inner().clone()
    }
}

/// Builds one mock invoke request carrying the supplied JSON payload.
fn invoke_request(cmd: &str, body: serde_json::Value) -> tauri::webview::InvokeRequest {
    tauri::webview::InvokeRequest {
        cmd: cmd.to_owned(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "http://tauri.localhost"
            .parse()
            .expect("the mock IPC URL should parse"),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.to_owned(),
    }
}

/// Invokes one command and returns its decoded success or error payload.
fn invoke(
    window: &WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    match tauri::test::get_ipc_response(window, invoke_request(cmd, body)) {
        Ok(response) => Ok(response
            .deserialize::<serde_json::Value>()
            .expect("a successful response should contain JSON")),
        Err(error) => Err(error),
    }
}

/// Returns one valid CLI profile input payload for command tests.
fn command_input(name: &str, secret: Option<&str>) -> serde_json::Value {
    let environment = match secret {
        Some(value) => serde_json::json!([
            {"name": "TOKEN", "value": value, "isSecret": true}
        ]),
        None => serde_json::json!([]),
    };
    serde_json::json!({
        "name": name,
        "command": "fixture-tool",
        "arguments": ["--flag"],
        "shellId": null,
        "icon": "Fx",
        "color": "#112233",
        "environment": environment,
    })
}

/// Verifies that the snapshot command answers only the exact main window.
#[test]
fn get_cli_profiles_routes_only_from_main() {
    let application = CommandApp::new();
    let main = application.window("main");

    let snapshot = invoke(&main, "get_cli_profiles", serde_json::json!({}))
        .expect("the main window should read the snapshot");

    assert_eq!(snapshot["revision"], "0");
    assert_eq!(snapshot["defaultShellId"], "system");
    assert_eq!(snapshot["effectiveDefaultShellId"], "pwsh");
    assert_eq!(snapshot["profiles"][0]["id"], "builtin:codex");
    assert_eq!(snapshot["profiles"][2]["id"], "builtin:terminal");

    for label in ["quick-note", "settings", "Main"] {
        let error = invoke(
            &application.window(label),
            "get_cli_profiles",
            serde_json::json!({}),
        )
        .expect_err("only the main window may read CLI profiles");
        assert_eq!(error["code"], "unauthorizedWindow");
    }
}

/// Verifies that every command routes and answers with a typed payload.
#[test]
fn every_cli_profile_command_is_routed_and_typed() {
    let application = CommandApp::new();
    let main = application.window("main");
    application
        .commands
        .set_found("fixture-tool", PathBuf::from("C:\\fixture\\fixture.exe"));

    let created = invoke(
        &main,
        "create_cli_profile",
        serde_json::json!({
            "input": command_input("Created", Some("BE006_SECRET_CANARY")),
        }),
    )
    .expect("the create command should succeed");
    let id = created["profiles"][3]["id"]
        .as_str()
        .expect("the created profile should have an identifier")
        .to_owned();
    assert_eq!(created["profiles"][3]["name"], "Created");
    assert_eq!(
        created["profiles"][3]["environment"][0]["value"],
        serde_json::Value::Null
    );
    assert_eq!(
        created["profiles"][3]["environment"][0]["hasStoredValue"],
        true
    );

    let checked = invoke(
        &main,
        "check_cli_profile",
        serde_json::json!({"profileId": id}),
    )
    .expect("the check command should succeed");
    assert_eq!(checked["availability"]["status"], "available");

    // A missing command is a successful status instead of an IPC failure.
    let claude = invoke(
        &main,
        "check_cli_profile",
        serde_json::json!({"profileId": "builtin:claude"}),
    )
    .expect("a missing command is not an IPC failure");
    assert_eq!(claude["availability"]["status"], "commandNotFound");

    let updated = invoke(
        &main,
        "update_cli_profile",
        serde_json::json!({
            "profileId": id,
            "input": command_input("Renamed", None),
        }),
    )
    .expect("the update command should succeed");
    assert_eq!(updated["profiles"][3]["name"], "Renamed");

    let shell = invoke(
        &main,
        "set_default_cli_shell",
        serde_json::json!({"shellId": "cmd"}),
    )
    .expect("the default shell command should succeed");
    assert_eq!(shell["defaultShellId"], "cmd");

    let deleted = invoke(
        &main,
        "delete_cli_profile",
        serde_json::json!({"profileId": id}),
    )
    .expect("the delete command should succeed");
    assert_eq!(deleted["profiles"].as_array().map(Vec::len), Some(3));

    // Built-in profiles reject both mutations through the routed command surface.
    for command in ["update_cli_profile", "delete_cli_profile"] {
        let body = if command == "update_cli_profile" {
            serde_json::json!({
                "profileId": "builtin:codex",
                "input": command_input("Hijack", None),
            })
        } else {
            serde_json::json!({"profileId": "builtin:codex"})
        };
        let error = invoke(&main, command, body).expect_err("built-ins are read-only");
        assert_eq!(error["code"], "builtInProfileReadOnly");
    }
}

/// Verifies that an unauthorized caller is rejected before any protected work.
#[test]
fn unauthorized_commands_have_no_protected_side_effects() {
    let application = CommandApp::new();
    let intruder = application.window("settings");
    block_on(application.service().snapshot()).expect("hydration should succeed");
    let calls_before = application.credentials.call_counts();

    for (command, body) in [
        (
            "create_cli_profile",
            serde_json::json!({"input": command_input("Blocked", Some("BE006_SECRET_CANARY"))}),
        ),
        (
            "update_cli_profile",
            serde_json::json!({
                "profileId": "profile-00000001-0000-4000-8000-000000000000",
                "input": command_input("Blocked", Some("BE006_SECRET_CANARY")),
            }),
        ),
        (
            "delete_cli_profile",
            serde_json::json!({"profileId": "profile-00000001-0000-4000-8000-000000000000"}),
        ),
        (
            "set_default_cli_shell",
            serde_json::json!({"shellId": "cmd"}),
        ),
        (
            "check_cli_profile",
            serde_json::json!({"profileId": "builtin:codex"}),
        ),
    ] {
        let error = invoke(&intruder, command, body).unwrap_or_else(|error| error);
        assert_eq!(
            error["code"], "unauthorizedWindow",
            "command {command} should reject a non-main caller"
        );
    }

    // No database row, credential call, resolver call, or event happened.
    assert_eq!(row_count(&application.storage, "cli_profiles"), 0);
    assert_eq!(application.credentials.call_counts(), calls_before);
    assert!(application.commands.calls().is_empty());
    assert!(application.events.recorded().is_empty());
    assert_eq!(
        block_on(application.service().snapshot())
            .expect("hydration should succeed")
            .revision,
        "0"
    );
}

/// Verifies that a hydration failure stays observable without a fallback cache.
#[test]
fn startup_hydration_failure_is_observable_without_fallback() {
    let harness = Harness::new();
    seed_profile(
        &harness.storage,
        &profile_id(1),
        "Corrupt",
        "corrupt-tool",
        "[1]",
        None,
        100,
        &[],
    );

    assert_eq!(
        block_on(harness.service.run_startup()),
        Err(CliProfilesError::PersistenceFailed)
    );
    assert_eq!(harness.snapshot(), Err(CliProfilesError::PersistenceFailed));
    assert!(harness.events.recorded().is_empty());
}

/// Verifies that a failed startup cleanup keeps its queue row and the application.
#[test]
fn startup_cleanup_failure_keeps_queue_and_app_available() {
    let harness = Harness::new();
    harness.credentials.seed(&fixture_account(1), "orphan");
    harness
        .storage
        .with_connection(
            // Seeds one durable reference the failing cleanup must leave behind.
            |connection| {
                connection.execute(
                    "INSERT INTO credential_cleanup_queue (credential_account, queued_at_ms) \
                     VALUES (?1, 1)",
                    params![fixture_account(1)],
                )?;
                Ok::<_, TestError>(())
            },
        )
        .expect("the queue fixture should be inserted");
    harness
        .credentials
        .fail_deletes(CredentialError::Unavailable);

    block_on(harness.service.run_startup()).expect("a cleanup failure must not fail startup");

    assert_eq!(queue_accounts(&harness.storage), vec![fixture_account(1)]);
    assert_eq!(
        harness.credentials.stored_secret(&fixture_account(1)),
        Some("orphan".to_owned())
    );
    // The application remains fully usable after the recoverable failure.
    assert!(harness.snapshot().is_ok());
}

/// Verifies that a resolver failure leaves the affected status unchecked.
#[test]
fn startup_resolver_failure_keeps_status_unchecked() {
    let harness = Harness::new();
    harness
        .commands
        .set_error("codex", CommandResolutionError::Inspection);
    harness
        .commands
        .set_found("claude", PathBuf::from("C:\\fixture\\claude.exe"));

    block_on(harness.service.run_startup()).expect("a resolver failure must not fail startup");

    let snapshot = harness.snapshot().expect("hydration should succeed");
    assert_eq!(
        snapshot.profiles[0].availability.status,
        CliProfileAvailabilityStatusDto::Unchecked
    );
    // Every other profile still completed its own check.
    assert_eq!(
        snapshot.profiles[1].availability.status,
        CliProfileAvailabilityStatusDto::Available
    );
    assert_eq!(
        snapshot.profiles[2].availability.status,
        CliProfileAvailabilityStatusDto::Available
    );
}
