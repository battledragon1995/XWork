#![cfg(target_os = "windows")]

use std::{fs, path::Path, sync::Arc};

use tempfile::TempDir;
use xwork_lib::platform::command::{CommandResolver, NativeCommandResolver};
use xwork_lib::platform::credential::{
    CredentialError, CredentialStore, InMemoryCredentialStore, KeyringCredentialStore,
};
use xwork_lib::platform::environment::ProcessEnvironmentSnapshot;
use xwork_lib::platform::shell::{NativeShellResolver, ShellMode, ShellResolver};
use xwork_lib::shared::DataMaintenanceGate;
use xwork_lib::storage::Storage;
use xwork_lib::terminal::{
    CliProfileAvailabilityStatusDto, CliProfileIdFactory, CliProfilesChangedDto, CliProfilesClock,
    CliProfilesError, CliProfilesEventSink, CliProfilesService,
};

/// Writes one inert Windows script that would create a sentinel if executed.
fn write_sentinel_script(directory: &Path, file_name: &str, sentinel: &Path) {
    let script = format!("@echo off\r\necho executed> \"{}\"\r\n", sentinel.display());
    fs::write(directory.join(file_name), script).expect("the fixture script should be written");
}

/// Writes one inert placeholder file that discovery may resolve but never run.
fn write_inert_executable(directory: &Path, file_name: &str) {
    fs::write(directory.join(file_name), b"inert").expect("the fixture file should be written");
}

/// Verifies bare-name discovery honours an explicit `PATH`/`PATHEXT` snapshot.
#[test]
fn resolver_uses_explicit_path_and_pathext_without_execution() {
    let directory = TempDir::new().expect("the temporary directory should be created");
    let sentinel = directory.path().join("executed.marker");
    write_sentinel_script(directory.path(), "xwork-fixture-tool.cmd", &sentinel);
    let environment = ProcessEnvironmentSnapshot::empty()
        .with_path(directory.path().as_os_str())
        // A lowercase list proves extension matching ignores ASCII case.
        .with_path_ext(".com;.exe;.cmd");
    let resolver = NativeCommandResolver::new(environment);

    let resolved = resolver
        .resolve("xwork-fixture-tool")
        .expect("the fixture command should be discovered");

    assert_eq!(resolved, directory.path().join("xwork-fixture-tool.cmd"));
    // Discovery must inspect metadata only, so the script's side effect never happens.
    assert!(!sentinel.exists());

    let absolute = resolver
        .resolve(
            directory
                .path()
                .join("xwork-fixture-tool.cmd")
                .to_str()
                .expect("the fixture path should be UTF-8"),
        )
        .expect("an absolute candidate should be accepted");
    assert_eq!(absolute, directory.path().join("xwork-fixture-tool.cmd"));
    assert!(!sentinel.exists());

    // An extension outside the supplied list must not be discovered.
    write_inert_executable(directory.path(), "xwork-other-tool.bat");
    assert!(resolver.resolve("xwork-other-tool").is_err());
    assert!(!sentinel.exists());
}

/// Verifies the Windows `system` policy prefers PowerShell 7, then Windows PowerShell, then cmd.
#[test]
fn windows_system_shell_fallback_is_stable() {
    let directory = TempDir::new().expect("the temporary directory should be created");
    let com_spec = directory.path().join("fixture-cmd.exe");
    write_inert_executable(directory.path(), "fixture-cmd.exe");

    let cmd_only = NativeShellResolver::new(NativeCommandResolver::new(
        ProcessEnvironmentSnapshot::empty()
            .with_path(directory.path().as_os_str())
            .with_path_ext(".COM;.EXE")
            .with_com_spec(com_spec.as_os_str()),
    ));
    let resolved = cmd_only
        .resolve("system")
        .expect("a valid COMSPEC should satisfy the last fallback");
    assert_eq!(resolved.id, "cmd");
    assert_eq!(resolved.mode, ShellMode::WindowsCommandPrompt);
    assert_eq!(resolved.executable, com_spec);

    write_inert_executable(directory.path(), "powershell.exe");
    let powershell = NativeShellResolver::new(NativeCommandResolver::new(
        ProcessEnvironmentSnapshot::empty()
            .with_path(directory.path().as_os_str())
            .with_path_ext(".COM;.EXE")
            .with_com_spec(com_spec.as_os_str()),
    ));
    let resolved = powershell
        .resolve("system")
        .expect("Windows PowerShell should outrank the command prompt");
    assert_eq!(resolved.id, "windows-powershell");
    assert_eq!(resolved.mode, ShellMode::PowerShell);

    write_inert_executable(directory.path(), "pwsh.exe");
    let pwsh = NativeShellResolver::new(NativeCommandResolver::new(
        ProcessEnvironmentSnapshot::empty()
            .with_path(directory.path().as_os_str())
            .with_path_ext(".COM;.EXE")
            .with_com_spec(com_spec.as_os_str()),
    ));
    let resolved = pwsh
        .resolve("system")
        .expect("PowerShell 7 should be the preferred Windows shell");
    assert_eq!(resolved.id, "pwsh");
    assert_eq!(resolved.executable, directory.path().join("pwsh.exe"));

    // With nothing discoverable the policy reports a missing shell instead of guessing.
    let empty = NativeShellResolver::new(NativeCommandResolver::new(
        ProcessEnvironmentSnapshot::empty().with_path_ext(".COM;.EXE"),
    ));
    assert!(empty.resolve("system").is_err());
}

/// Deletes one test credential even when an assertion fails first.
struct CredentialGuard {
    store: KeyringCredentialStore,
    account: String,
}

impl Drop for CredentialGuard {
    /// Performs the final best-effort delete so no test credential survives.
    fn drop(&mut self) {
        let _ = self.store.delete_secret(&self.account);
    }
}

/// Verifies one real Windows Credential Manager round trip under a unique account.
#[test]
fn windows_credential_manager_round_trip_uses_isolated_account() {
    let store = KeyringCredentialStore::new();
    // Only this integration test uses the `test-` prefix; production accounts are bare UUIDs.
    let account = format!("test-{}", uuid::Uuid::new_v4().hyphenated());
    let guard = CredentialGuard {
        store: KeyringCredentialStore::new(),
        account: account.clone(),
    };
    let canary = "BE006_SECRET_CANARY_WINDOWS";

    store
        .write_secret(&account, canary)
        .expect("the isolated credential should be writable");
    let read_back = store
        .read_secret(&account)
        .expect("the isolated credential should be readable");
    assert_eq!(read_back.as_str(), canary);

    store
        .delete_secret(&account)
        .expect("the isolated credential should be deletable");
    assert!(
        matches!(store.read_secret(&account), Err(CredentialError::NotFound)),
        "the deleted credential must no longer resolve"
    );

    drop(guard);
}

/// Returns one fixed timestamp so the native check stays deterministic.
struct WindowsClock;

impl CliProfilesClock for WindowsClock {
    /// Returns the pinned fixture timestamp.
    fn now_ms(&self) -> Result<i64, CliProfilesError> {
        Ok(1_700_000_000_000)
    }
}

/// Returns deterministic identifiers for the native Windows fixture.
struct WindowsIds;

impl CliProfileIdFactory for WindowsIds {
    /// Returns one canonical fixture profile identifier.
    fn new_profile_id(&self) -> String {
        "profile-00000001-0000-4000-8000-000000000000".to_owned()
    }

    /// Returns one opaque fixture credential account.
    fn new_credential_account(&self) -> String {
        "00000001-0000-4000-8000-aaaaaaaaaaaa".to_owned()
    }
}

/// Discards every published invalidation during the native Windows test.
struct SilentSink;

impl CliProfilesEventSink for SilentSink {
    /// Accepts the payload without emitting it to any webview.
    fn publish(&self, _event: CliProfilesChangedDto) -> Result<(), CliProfilesError> {
        Ok(())
    }
}

/// Verifies a real Windows availability check resolves without running anything.
#[test]
fn windows_check_uses_real_resolvers_without_execution() {
    let app_data = TempDir::new().expect("the temporary app data should be created");
    let tools = TempDir::new().expect("the temporary tool directory should be created");
    let sentinel = tools.path().join("executed.marker");
    write_inert_executable(tools.path(), "pwsh.exe");
    write_sentinel_script(tools.path(), "codex.cmd", &sentinel);
    let environment = ProcessEnvironmentSnapshot::empty()
        .with_path(tools.path().as_os_str())
        .with_path_ext(".COM;.EXE;.CMD");
    let commands = Arc::new(NativeCommandResolver::new(environment.clone()));
    let shells = Arc::new(NativeShellResolver::new(NativeCommandResolver::new(
        environment,
    )));
    let service = CliProfilesService::with_seams(
        Storage::open(app_data.path()).expect("isolated storage should open"),
        DataMaintenanceGate::new(),
        commands,
        shells,
        Arc::new(InMemoryCredentialStore::new()),
        Arc::new(SilentSink),
        Arc::new(WindowsClock),
        Arc::new(WindowsIds),
    );

    let snapshot = tauri::async_runtime::block_on(service.snapshot())
        .expect("hydration should resolve the real Windows catalog");
    assert_eq!(snapshot.effective_default_shell_id, "pwsh");

    let checked = tauri::async_runtime::block_on(service.check_profile("builtin:codex"))
        .expect("the native check should succeed");

    assert_eq!(
        checked.availability.status,
        CliProfileAvailabilityStatusDto::Available
    );
    // The candidate was inspected only, so its side effect never happened.
    assert!(!sentinel.exists());

    let claude = tauri::async_runtime::block_on(service.check_profile("builtin:claude"))
        .expect("a missing command is still a successful status");
    assert_eq!(
        claude.availability.status,
        CliProfileAvailabilityStatusDto::CommandNotFound
    );
    assert!(!sentinel.exists());
}
