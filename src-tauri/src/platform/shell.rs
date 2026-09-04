use std::{
    collections::HashMap,
    error::Error,
    fmt::{Display, Formatter},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use super::{
    command::{CommandResolutionError, CommandResolver, NativeCommandResolver},
    environment::ProcessEnvironmentSnapshot,
};

/// Names the persisted sentinel that resolves through the platform fallback policy.
pub const SYSTEM_SHELL_ID: &str = "system";

/// Names the display label of the persisted `system` sentinel.
const SYSTEM_SHELL_DISPLAY_NAME: &str = "System default";

/// Describes how a later PTY adapter must drive one resolved shell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellMode {
    PowerShell,
    WindowsCommandPrompt,
    PosixShell,
}

/// Describes one concrete shell that currently resolves on this machine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedShell {
    pub id: String,
    pub display_name: String,
    pub command: String,
    pub executable: PathBuf,
    pub mode: ShellMode,
}

/// Describes one catalog shell without performing any filesystem inspection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CliShellDescriptor {
    pub id: String,
    pub display_name: String,
    pub command: String,
}

/// Describes why one shell identifier could not be resolved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellResolutionError {
    /// The identifier is not part of this platform's shell catalog.
    UnknownShell,
    /// No catalog candidate resolved to an executable.
    NotFound,
    /// The operating system could not be inspected for an unrelated reason.
    Inspection,
}

impl Display for ShellResolutionError {
    /// Formats one stable category without ever including the inspected path.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::UnknownShell => "the shell identifier is not part of the platform catalog",
            Self::NotFound => "no catalog shell matched an installed executable",
            Self::Inspection => "the operating system could not be inspected for the shell",
        };
        formatter.write_str(message)
    }
}

impl Error for ShellResolutionError {}

/// Lists and resolves the stable platform shell catalog.
pub trait ShellResolver: Send + Sync {
    /// Lists every catalog shell without inspecting the filesystem.
    fn catalog(&self) -> Vec<CliShellDescriptor>;

    /// Resolves one stable identifier, including the `system` sentinel.
    fn resolve(&self, shell_id: &str) -> Result<ResolvedShell, ShellResolutionError>;
}

/// Holds one concrete catalog entry before any resolution attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ShellEntry {
    id: &'static str,
    display_name: &'static str,
    command: String,
    mode: ShellMode,
}

/// Resolves the platform shell catalog from one immutable environment snapshot.
#[derive(Clone)]
pub struct NativeShellResolver {
    commands: Arc<dyn CommandResolver>,
    environment: Arc<ProcessEnvironmentSnapshot>,
}

impl NativeShellResolver {
    /// Creates a shell resolver that shares one command resolver's environment.
    pub fn new(commands: NativeCommandResolver) -> Self {
        Self {
            environment: commands.environment(),
            commands: Arc::new(commands),
        }
    }

    /// Creates a shell resolver bound to the real backend process environment.
    pub fn from_process() -> Self {
        Self::new(NativeCommandResolver::from_process())
    }

    /// Builds every concrete catalog entry available on this platform.
    fn concrete_entries(&self) -> Vec<ShellEntry> {
        if cfg!(target_os = "windows") {
            self.windows_entries()
        } else {
            self.macos_entries()
        }
    }

    /// Builds the Windows catalog in its documented fallback order.
    fn windows_entries(&self) -> Vec<ShellEntry> {
        let command_prompt = self
            .environment
            .com_spec()
            .map(
                // Lossy decoding is safe because the value is only displayed and inspected.
                |value| value.to_string_lossy().into_owned(),
            )
            .filter(
                // An empty or relative command processor falls back to the bare name.
                |value| !value.trim().is_empty() && Path::new(value.trim()).is_absolute(),
            )
            .map(|value| value.trim().to_owned())
            .unwrap_or_else(|| "cmd.exe".to_owned());

        vec![
            ShellEntry {
                id: "pwsh",
                display_name: "PowerShell 7",
                command: "pwsh.exe".to_owned(),
                mode: ShellMode::PowerShell,
            },
            ShellEntry {
                id: "windows-powershell",
                display_name: "Windows PowerShell",
                command: "powershell.exe".to_owned(),
                mode: ShellMode::PowerShell,
            },
            ShellEntry {
                id: "cmd",
                display_name: "Command Prompt",
                command: command_prompt,
                mode: ShellMode::WindowsCommandPrompt,
            },
        ]
    }

    /// Builds the macOS catalog in its documented fallback order.
    fn macos_entries(&self) -> Vec<ShellEntry> {
        let mut entries = Vec::with_capacity(3);
        // The login shell only exists in the catalog when the value is a usable path.
        if let Some(login_shell) = self.environment.shell().map(
            // Lossy decoding is safe because the value is only displayed and inspected.
            |value| value.to_string_lossy().into_owned(),
        ) && Path::new(login_shell.trim()).is_absolute()
        {
            entries.push(ShellEntry {
                id: "login-shell",
                display_name: "Login shell",
                command: login_shell.trim().to_owned(),
                mode: ShellMode::PosixShell,
            });
        }
        entries.push(ShellEntry {
            id: "zsh",
            display_name: "Zsh",
            command: "/bin/zsh".to_owned(),
            mode: ShellMode::PosixShell,
        });
        entries.push(ShellEntry {
            id: "bash",
            display_name: "Bash",
            command: "/bin/bash".to_owned(),
            mode: ShellMode::PosixShell,
        });
        entries
    }

    /// Resolves one already located catalog entry into a concrete shell.
    fn resolve_entry(&self, entry: &ShellEntry) -> Result<ResolvedShell, ShellResolutionError> {
        let executable = self.commands.resolve(&entry.command).map_err(
            // An unusable candidate is reported as a missing shell, never as a leak of its path.
            |error| match error {
                CommandResolutionError::Inspection => ShellResolutionError::Inspection,
                _ => ShellResolutionError::NotFound,
            },
        )?;
        Ok(ResolvedShell {
            id: entry.id.to_owned(),
            display_name: entry.display_name.to_owned(),
            command: entry.command.clone(),
            executable,
            mode: entry.mode,
        })
    }

    /// Applies the platform fallback policy behind the `system` sentinel.
    fn resolve_system(&self) -> Result<ResolvedShell, ShellResolutionError> {
        // One unreadable candidate must not hide a working shell later in the order.
        let mut inspection_failed = false;

        for entry in self.concrete_entries() {
            match self.resolve_entry(&entry) {
                Ok(resolved) => return Ok(resolved),
                Err(ShellResolutionError::Inspection) => inspection_failed = true,
                Err(_) => {}
            }
        }

        if inspection_failed {
            Err(ShellResolutionError::Inspection)
        } else {
            Err(ShellResolutionError::NotFound)
        }
    }
}

impl ShellResolver for NativeShellResolver {
    /// Lists the sentinel followed by every concrete catalog entry in policy order.
    fn catalog(&self) -> Vec<CliShellDescriptor> {
        let entries = self.concrete_entries();
        let system_command = entries.first().map_or_else(String::new, |entry| {
            // The sentinel displays the first fallback candidate until a check resolves one.
            entry.command.clone()
        });

        std::iter::once(CliShellDescriptor {
            id: SYSTEM_SHELL_ID.to_owned(),
            display_name: SYSTEM_SHELL_DISPLAY_NAME.to_owned(),
            command: system_command,
        })
        .chain(entries.into_iter().map(
            // Each concrete entry keeps its stable identifier and display command.
            |entry| CliShellDescriptor {
                id: entry.id.to_owned(),
                display_name: entry.display_name.to_owned(),
                command: entry.command,
            },
        ))
        .collect()
    }

    /// Resolves the sentinel through the fallback policy or one concrete entry directly.
    fn resolve(&self, shell_id: &str) -> Result<ResolvedShell, ShellResolutionError> {
        if shell_id == SYSTEM_SHELL_ID {
            return self.resolve_system();
        }
        let entries = self.concrete_entries();
        let entry = entries
            .iter()
            .find(
                // Identifiers are stable and compared exactly, never case-insensitively.
                |entry| entry.id == shell_id,
            )
            .ok_or(ShellResolutionError::UnknownShell)?;
        self.resolve_entry(entry)
    }
}

/// Returns configured shells so tests never inspect a real filesystem.
#[doc(hidden)]
pub struct StubShellResolver {
    descriptors: Vec<CliShellDescriptor>,
    state: Mutex<StubShellState>,
}

/// Holds the scripted shell outcomes and recorded calls of the stub resolver.
#[derive(Default)]
struct StubShellState {
    outcomes: HashMap<String, Result<ResolvedShell, ShellResolutionError>>,
    calls: Vec<String>,
}

impl StubShellResolver {
    /// Creates a resolver that lists the supplied catalog and resolves nothing.
    pub fn new(descriptors: Vec<CliShellDescriptor>) -> Self {
        Self {
            descriptors,
            state: Mutex::new(StubShellState::default()),
        }
    }

    /// Creates a resolver whose catalog matches the documented Windows contract.
    pub fn windows_like() -> Self {
        Self::new(vec![
            CliShellDescriptor {
                id: SYSTEM_SHELL_ID.to_owned(),
                display_name: SYSTEM_SHELL_DISPLAY_NAME.to_owned(),
                command: "pwsh.exe".to_owned(),
            },
            CliShellDescriptor {
                id: "pwsh".to_owned(),
                display_name: "PowerShell 7".to_owned(),
                command: "pwsh.exe".to_owned(),
            },
            CliShellDescriptor {
                id: "windows-powershell".to_owned(),
                display_name: "Windows PowerShell".to_owned(),
                command: "powershell.exe".to_owned(),
            },
            CliShellDescriptor {
                id: "cmd".to_owned(),
                display_name: "Command Prompt".to_owned(),
                command: "cmd.exe".to_owned(),
            },
        ])
    }

    /// Builds one resolved shell fixture for the supplied catalog identifier.
    pub fn resolved(id: &str, command: &str, mode: ShellMode) -> ResolvedShell {
        ResolvedShell {
            id: id.to_owned(),
            display_name: id.to_owned(),
            command: command.to_owned(),
            executable: PathBuf::from(format!("C:\\fixture\\{command}")),
            mode,
        }
    }

    /// Locks the fixture state and rejects a poisoned fixture loudly.
    fn state(&self) -> std::sync::MutexGuard<'_, StubShellState> {
        self.state
            .lock()
            .expect("the fixture shell lock should be available")
    }

    /// Configures one identifier to resolve to the supplied shell.
    pub fn set_resolved(&self, id: &str, resolved: ResolvedShell) {
        self.state().outcomes.insert(id.to_owned(), Ok(resolved));
    }

    /// Configures one identifier to fail with the supplied category.
    pub fn set_error(&self, id: &str, error: ShellResolutionError) {
        self.state().outcomes.insert(id.to_owned(), Err(error));
    }

    /// Configures the sentinel and one concrete identifier to resolve together.
    pub fn set_available(&self, id: &str, command: &str, mode: ShellMode) {
        let resolved = Self::resolved(id, command, mode);
        self.set_resolved(id, resolved.clone());
        self.set_resolved(SYSTEM_SHELL_ID, resolved);
    }

    /// Returns every identifier the resolver was asked about, in call order.
    pub fn calls(&self) -> Vec<String> {
        self.state().calls.clone()
    }
}

impl ShellResolver for StubShellResolver {
    /// Lists the fixed fixture catalog without any filesystem inspection.
    fn catalog(&self) -> Vec<CliShellDescriptor> {
        self.descriptors.clone()
    }

    /// Returns the scripted outcome and records the requested identifier.
    fn resolve(&self, shell_id: &str) -> Result<ResolvedShell, ShellResolutionError> {
        let mut state = self.state();
        state.calls.push(shell_id.to_owned());
        state
            .outcomes
            .get(shell_id)
            .cloned()
            .unwrap_or(Err(ShellResolutionError::NotFound))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::{
        NativeCommandResolver, NativeShellResolver, ProcessEnvironmentSnapshot, SYSTEM_SHELL_ID,
        ShellResolutionError, ShellResolver,
    };

    /// Creates one inert fixture executable inside the temporary search path.
    fn write_inert_file(directory: &TempDir, file_name: &str) -> std::path::PathBuf {
        let path = directory.path().join(file_name);
        fs::write(&path, b"inert").expect("the fixture file should be written");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = fs::metadata(&path)
                .expect("the fixture metadata should be readable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&path, permissions).expect("the fixture should be executable");
        }
        path
    }

    /// Builds a shell resolver over one explicit environment snapshot.
    fn resolver(environment: ProcessEnvironmentSnapshot) -> NativeShellResolver {
        NativeShellResolver::new(NativeCommandResolver::new(environment))
    }

    /// Verifies that the catalog exposes the sentinel first in stable policy order.
    #[test]
    fn catalog_starts_with_the_system_sentinel() {
        let catalog = resolver(ProcessEnvironmentSnapshot::empty()).catalog();

        let ids = catalog
            .iter()
            .map(
                // Only identifiers matter for the stable ordering assertion.
                |entry| entry.id.as_str(),
            )
            .collect::<Vec<_>>();
        assert_eq!(catalog[0].id, SYSTEM_SHELL_ID);
        assert_eq!(catalog[0].display_name, "System default");
        if cfg!(target_os = "windows") {
            assert_eq!(ids, vec!["system", "pwsh", "windows-powershell", "cmd"]);
        } else {
            assert_eq!(ids, vec!["system", "zsh", "bash"]);
        }
    }

    /// Verifies that an identifier outside the catalog is rejected without I/O.
    #[test]
    fn unknown_identifier_is_rejected() {
        let shells = resolver(ProcessEnvironmentSnapshot::empty());

        for unknown in ["", "SYSTEM", "powershell", "C:\\Windows\\system32\\cmd.exe"] {
            assert_eq!(
                shells.resolve(unknown),
                Err(ShellResolutionError::UnknownShell)
            );
        }
    }

    /// Verifies that the sentinel reports absence when no catalog shell resolves.
    #[test]
    fn system_reports_not_found_without_any_candidate() {
        let shells = resolver(ProcessEnvironmentSnapshot::empty());

        assert_eq!(
            shells.resolve(SYSTEM_SHELL_ID),
            Err(ShellResolutionError::NotFound)
        );
    }

    /// Verifies that the Windows catalog exposes `COMSPEC` only when it is absolute.
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_command_prompt_uses_a_valid_com_spec() {
        let with_absolute = resolver(
            ProcessEnvironmentSnapshot::empty().with_com_spec("C:\\Windows\\system32\\cmd.exe"),
        );
        assert_eq!(
            with_absolute.catalog()[3].command,
            "C:\\Windows\\system32\\cmd.exe"
        );

        let with_relative =
            resolver(ProcessEnvironmentSnapshot::empty().with_com_spec("relative\\cmd.exe"));
        assert_eq!(with_relative.catalog()[3].command, "cmd.exe");
    }

    /// Verifies that the Windows fallback order stops at the first resolvable shell.
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_fallback_order_prefers_powershell_seven() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        write_inert_file(&directory, "powershell.exe");
        let shells = resolver(
            ProcessEnvironmentSnapshot::empty()
                .with_path(directory.path())
                .with_path_ext(".EXE"),
        );
        assert_eq!(
            shells
                .resolve(SYSTEM_SHELL_ID)
                .expect("Windows PowerShell should resolve")
                .id,
            "windows-powershell"
        );

        let expected = write_inert_file(&directory, "pwsh.exe");
        let shells = resolver(
            ProcessEnvironmentSnapshot::empty()
                .with_path(directory.path())
                .with_path_ext(".EXE"),
        );
        let resolved = shells
            .resolve(SYSTEM_SHELL_ID)
            .expect("PowerShell 7 should resolve");
        assert_eq!(resolved.id, "pwsh");
        assert_eq!(resolved.executable, expected);
        assert_eq!(resolved.display_name, "PowerShell 7");
        // An explicit concrete identifier ignores the fallback order entirely.
        assert_eq!(
            shells
                .resolve("windows-powershell")
                .expect("the explicit identifier should resolve")
                .id,
            "windows-powershell"
        );
    }

    /// Verifies that macOS exposes the login shell only when `SHELL` is absolute.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_login_shell_requires_an_absolute_value() {
        let with_login = resolver(ProcessEnvironmentSnapshot::empty().with_shell("/bin/zsh"));
        let ids = with_login
            .catalog()
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["system", "login-shell", "zsh", "bash"]);

        let without_login = resolver(ProcessEnvironmentSnapshot::empty().with_shell("zsh"));
        let ids = without_login
            .catalog()
            .iter()
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["system", "zsh", "bash"]);
    }

    /// Verifies that a resolved shell keeps its structured mode for later launch work.
    #[test]
    fn resolved_shell_keeps_its_structured_mode() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let (file_name, shell_id) = if cfg!(target_os = "windows") {
            ("pwsh.exe", "pwsh")
        } else {
            ("zsh", "zsh")
        };
        let executable = if cfg!(target_os = "windows") {
            write_inert_file(&directory, file_name)
        } else {
            // The macOS catalog uses fixed absolute candidates, so this path is unused.
            std::path::PathBuf::from("/bin/zsh")
        };
        if !cfg!(target_os = "windows") {
            return;
        }
        let shells = resolver(
            ProcessEnvironmentSnapshot::empty()
                .with_path(directory.path())
                .with_path_ext(".EXE"),
        );

        let resolved = shells
            .resolve(shell_id)
            .expect("the fixture shell should resolve");

        assert_eq!(resolved.executable, executable);
        assert_eq!(resolved.command, file_name);
    }
}
