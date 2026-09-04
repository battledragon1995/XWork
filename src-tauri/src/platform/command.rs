use std::{
    error::Error,
    fmt::{Display, Formatter},
    fs::Metadata,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Arc,
};

use super::environment::ProcessEnvironmentSnapshot;

/// Lists the executable extensions Windows uses when `PATHEXT` is absent.
const DEFAULT_WINDOWS_PATH_EXT: &str = ".COM;.EXE;.BAT;.CMD";

/// Describes why one command candidate could not be resolved to an executable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommandResolutionError {
    /// The candidate is not a bare executable name or an absolute path.
    InvalidCandidate,
    /// No executable file matched the candidate.
    NotFound,
    /// The operating system could not be inspected for an unrelated reason.
    Inspection,
}

impl Display for CommandResolutionError {
    /// Formats one stable category without ever including the inspected path.
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::InvalidCandidate => "the command candidate is not a valid executable reference",
            Self::NotFound => "no executable matched the command candidate",
            Self::Inspection => "the operating system could not be inspected for the command",
        };
        formatter.write_str(message)
    }
}

impl Error for CommandResolutionError {}

/// Resolves one command candidate to an executable file without running it.
pub trait CommandResolver: Send + Sync {
    /// Returns the executable a candidate names, inspecting metadata only.
    fn resolve(&self, candidate: &str) -> Result<PathBuf, CommandResolutionError>;
}

/// Resolves executables from one immutable environment snapshot.
#[derive(Clone)]
pub struct NativeCommandResolver {
    environment: Arc<ProcessEnvironmentSnapshot>,
}

impl NativeCommandResolver {
    /// Creates a resolver bound to the supplied environment snapshot.
    pub fn new(environment: ProcessEnvironmentSnapshot) -> Self {
        Self {
            environment: Arc::new(environment),
        }
    }

    /// Creates a resolver bound to the real backend process environment.
    pub fn from_process() -> Self {
        Self::new(ProcessEnvironmentSnapshot::from_process())
    }

    /// Returns the shared environment snapshot for collaborating adapters.
    pub fn environment(&self) -> Arc<ProcessEnvironmentSnapshot> {
        self.environment.clone()
    }

    /// Searches every search-path directory for one bare executable name.
    fn search_path(&self, candidate: &str) -> Result<PathBuf, CommandResolutionError> {
        let Some(search_path) = self.environment.path() else {
            return Err(CommandResolutionError::NotFound);
        };
        let file_names = self.candidate_file_names(candidate);
        // A single unreadable directory must not hide a match in a later directory.
        let mut inspection_failed = false;

        for directory in std::env::split_paths(search_path) {
            if directory.as_os_str().is_empty() {
                continue;
            }
            for file_name in &file_names {
                let full_path = directory.join(file_name);
                match inspect_executable(&full_path) {
                    Ok(()) => return Ok(full_path),
                    Err(CommandResolutionError::Inspection) => inspection_failed = true,
                    Err(_) => {}
                }
            }
        }

        if inspection_failed {
            Err(CommandResolutionError::Inspection)
        } else {
            Err(CommandResolutionError::NotFound)
        }
    }

    /// Returns every file name one bare candidate may match in a directory.
    fn candidate_file_names(&self, candidate: &str) -> Vec<String> {
        if !cfg!(target_os = "windows") {
            return vec![candidate.to_owned()];
        }

        let extensions = self.windows_extensions();
        let already_executable = Path::new(candidate).extension().is_some_and(|extension| {
            extensions.iter().any(
                // Windows compares executable extensions without ASCII case sensitivity.
                |known| known[1..].eq_ignore_ascii_case(&extension.to_string_lossy()),
            )
        });

        if already_executable {
            vec![candidate.to_owned()]
        } else {
            extensions
                .iter()
                .map(
                    // Each configured extension produces one candidate file name.
                    |extension| format!("{candidate}{extension}"),
                )
                .collect()
        }
    }

    /// Returns the normalized Windows executable extension list.
    fn windows_extensions(&self) -> Vec<String> {
        let configured = self
            .environment
            .path_ext()
            .map(
                // Lossy decoding is safe because extensions are ASCII by contract.
                |value| value.to_string_lossy().into_owned(),
            )
            .filter(
                // An empty variable falls back to the documented Windows default.
                |value| !value.trim().is_empty(),
            )
            .unwrap_or_else(|| DEFAULT_WINDOWS_PATH_EXT.to_owned());

        configured
            .split(';')
            .filter_map(
                // Each entry becomes one normalized extension with a leading dot.
                |entry| {
                    let entry = entry.trim();
                    if entry.is_empty() {
                        return None;
                    }
                    if entry.starts_with('.') {
                        Some(entry.to_owned())
                    } else {
                        Some(format!(".{entry}"))
                    }
                },
            )
            .collect()
    }
}

impl CommandResolver for NativeCommandResolver {
    /// Resolves a bare name through the search path or an absolute path directly.
    fn resolve(&self, candidate: &str) -> Result<PathBuf, CommandResolutionError> {
        let candidate = candidate.trim();
        // One shared rule set keeps discovery and domain validation in agreement.
        validate_command_candidate(candidate)?;

        let path = Path::new(candidate);
        if path.is_absolute() {
            return inspect_executable(path).map(
                // The inspected absolute candidate is already the resolved executable.
                |()| path.to_path_buf(),
            );
        }

        self.search_path(candidate)
    }
}

/// Validates one candidate's shape without touching the filesystem.
///
/// Domain validation reuses this so a persisted command can never disagree with
/// what discovery is willing to resolve later.
pub fn validate_command_candidate(candidate: &str) -> Result<(), CommandResolutionError> {
    validate_candidate(candidate)?;
    let path = Path::new(candidate);
    if path.is_absolute() {
        return Ok(());
    }
    if path.has_root() || contains_separator(candidate) || candidate.contains(':') {
        return Err(CommandResolutionError::InvalidCandidate);
    }
    // A bare executable name never carries whitespace, so it cannot smuggle an argument.
    if candidate.chars().any(char::is_whitespace) {
        return Err(CommandResolutionError::InvalidCandidate);
    }
    Ok(())
}

/// Rejects every candidate shape the backend refuses to expand or execute.
fn validate_candidate(candidate: &str) -> Result<(), CommandResolutionError> {
    if candidate.is_empty() {
        return Err(CommandResolutionError::InvalidCandidate);
    }
    if candidate.chars().any(char::is_control) {
        return Err(CommandResolutionError::InvalidCandidate);
    }
    // Home and environment expansion are the shell's job, never the backend's.
    if candidate.starts_with('~') || candidate.contains('%') || candidate.contains('$') {
        return Err(CommandResolutionError::InvalidCandidate);
    }
    Ok(())
}

/// Reports whether a candidate contains any platform path separator.
fn contains_separator(candidate: &str) -> bool {
    candidate.contains('/') || (cfg!(target_os = "windows") && candidate.contains('\\'))
}

/// Inspects one path's metadata and never opens or executes the file.
fn inspect_executable(path: &Path) -> Result<(), CommandResolutionError> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() && is_executable(&metadata) => Ok(()),
        Ok(_) => Err(CommandResolutionError::NotFound),
        Err(error)
            if matches!(
                error.kind(),
                ErrorKind::NotFound | ErrorKind::NotADirectory | ErrorKind::InvalidFilename
            ) =>
        {
            Err(CommandResolutionError::NotFound)
        }
        Err(_) => Err(CommandResolutionError::Inspection),
    }
}

/// Reports whether one regular file is executable on the current platform.
#[cfg(unix)]
fn is_executable(metadata: &Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

/// Reports Windows executability, which the extension list already decided.
#[cfg(not(unix))]
fn is_executable(_metadata: &Metadata) -> bool {
    true
}

/// Returns configured outcomes so tests never inspect a real filesystem.
#[doc(hidden)]
#[derive(Default)]
pub struct StubCommandResolver {
    state: std::sync::Mutex<StubCommandState>,
}

/// Holds the scripted outcomes and recorded calls of the stub resolver.
#[derive(Default)]
struct StubCommandState {
    outcomes: std::collections::HashMap<String, Result<PathBuf, CommandResolutionError>>,
    calls: Vec<String>,
}

impl StubCommandResolver {
    /// Creates a resolver whose every unconfigured candidate is missing.
    pub fn new() -> Self {
        Self::default()
    }

    /// Locks the fixture state and rejects a poisoned fixture loudly.
    fn state(&self) -> std::sync::MutexGuard<'_, StubCommandState> {
        self.state
            .lock()
            .expect("the fixture resolver lock should be available")
    }

    /// Configures one candidate to resolve to the supplied executable.
    pub fn set_found(&self, candidate: &str, executable: PathBuf) {
        self.state()
            .outcomes
            .insert(candidate.to_owned(), Ok(executable));
    }

    /// Configures one candidate to fail with the supplied category.
    pub fn set_error(&self, candidate: &str, error: CommandResolutionError) {
        self.state()
            .outcomes
            .insert(candidate.to_owned(), Err(error));
    }

    /// Returns every candidate the resolver was asked about, in call order.
    pub fn calls(&self) -> Vec<String> {
        self.state().calls.clone()
    }
}

impl CommandResolver for StubCommandResolver {
    /// Returns the scripted outcome and records the requested candidate.
    fn resolve(&self, candidate: &str) -> Result<PathBuf, CommandResolutionError> {
        let mut state = self.state();
        state.calls.push(candidate.to_owned());
        state
            .outcomes
            .get(candidate)
            .cloned()
            .unwrap_or(Err(CommandResolutionError::NotFound))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::{
        CommandResolutionError, CommandResolver, NativeCommandResolver, ProcessEnvironmentSnapshot,
    };

    /// Creates one inert fixture file that discovery may find but never run.
    fn write_inert_file(directory: &TempDir, file_name: &str) -> std::path::PathBuf {
        let path = directory.path().join(file_name);
        fs::write(&path, b"inert").expect("the fixture file should be written");
        make_executable(&path);
        path
    }

    /// Grants the executable bit required by Unix discovery rules.
    #[cfg(unix)]
    fn make_executable(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path)
            .expect("the fixture metadata should be readable")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("the fixture should become executable");
    }

    /// Leaves Windows fixtures unchanged because extensions decide executability.
    #[cfg(not(unix))]
    fn make_executable(_path: &std::path::Path) {}

    /// Compares two resolved paths using the host filesystem's case rules.
    fn assert_same_path(
        actual: Result<std::path::PathBuf, CommandResolutionError>,
        expected: &std::path::Path,
    ) {
        let actual = actual.expect("the fixture command should resolve");
        if cfg!(target_os = "windows") {
            assert!(
                actual
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&expected.to_string_lossy()),
                "resolved {actual:?} should name {expected:?}"
            );
        } else {
            assert_eq!(actual, expected);
        }
    }

    /// Returns the platform-specific bare fixture name and its file name.
    fn fixture_names() -> (&'static str, &'static str) {
        if cfg!(target_os = "windows") {
            ("fixture-tool", "fixture-tool.exe")
        } else {
            ("fixture-tool", "fixture-tool")
        }
    }

    /// Verifies that a bare name resolves through the injected search path.
    #[test]
    fn bare_name_resolves_through_the_search_path() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let (bare, file_name) = fixture_names();
        let expected = write_inert_file(&directory, file_name);
        let resolver = NativeCommandResolver::new(
            ProcessEnvironmentSnapshot::empty()
                .with_path(directory.path())
                .with_path_ext(".COM;.EXE"),
        );

        assert_same_path(resolver.resolve(bare), &expected);
    }

    /// Verifies that an absolute candidate is inspected without a path search.
    #[test]
    fn absolute_candidate_is_inspected_directly() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let (_, file_name) = fixture_names();
        let expected = write_inert_file(&directory, file_name);
        let resolver = NativeCommandResolver::new(ProcessEnvironmentSnapshot::empty());

        let candidate = expected.to_str().expect("the fixture path should be UTF-8");

        assert_eq!(resolver.resolve(candidate), Ok(expected.clone()));
        assert_eq!(
            resolver.resolve(
                directory
                    .path()
                    .join("missing-tool")
                    .to_str()
                    .expect("the fixture path should be UTF-8")
            ),
            Err(CommandResolutionError::NotFound)
        );
        // A directory is not an executable even when the path exists.
        assert_eq!(
            resolver.resolve(
                directory
                    .path()
                    .to_str()
                    .expect("the fixture path should be UTF-8")
            ),
            Err(CommandResolutionError::NotFound)
        );
    }

    /// Verifies that unsupported candidate shapes are rejected before any I/O.
    #[test]
    fn unsupported_candidate_shapes_are_rejected() {
        let resolver =
            NativeCommandResolver::new(ProcessEnvironmentSnapshot::empty().with_path("C:\\Tools"));

        for candidate in [
            "",
            "   ",
            "tool\u{0}name",
            "tool\u{7}",
            "~/tool",
            "~",
            "%SystemRoot%\\tool.exe",
            "$HOME/tool",
            "tools/fixture",
            "./fixture",
        ] {
            assert_eq!(
                resolver.resolve(candidate),
                Err(CommandResolutionError::InvalidCandidate),
                "candidate {candidate:?} should be rejected"
            );
        }
    }

    /// Verifies that a missing search path reports absence instead of failing.
    #[test]
    fn missing_search_path_reports_not_found() {
        let resolver = NativeCommandResolver::new(ProcessEnvironmentSnapshot::empty());

        assert_eq!(
            resolver.resolve("fixture-tool"),
            Err(CommandResolutionError::NotFound)
        );
    }

    /// Verifies that Windows extension matching ignores ASCII case in both directions.
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_extension_matching_ignores_case() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        let expected = write_inert_file(&directory, "fixture-tool.EXE");
        let resolver = NativeCommandResolver::new(
            ProcessEnvironmentSnapshot::empty()
                .with_path(directory.path())
                .with_path_ext(".com;.exe"),
        );

        assert_same_path(resolver.resolve("fixture-tool"), &expected);
        // A candidate that already carries a listed extension is used verbatim.
        assert_same_path(resolver.resolve("fixture-tool.exe"), &expected);
    }

    /// Verifies that an unlisted Windows extension is never discovered.
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_unlisted_extension_is_not_discovered() {
        let directory = TempDir::new().expect("the temporary directory should be created");
        write_inert_file(&directory, "fixture-tool.bat");
        let resolver = NativeCommandResolver::new(
            ProcessEnvironmentSnapshot::empty()
                .with_path(directory.path())
                .with_path_ext(".COM;.EXE"),
        );

        assert_eq!(
            resolver.resolve("fixture-tool"),
            Err(CommandResolutionError::NotFound)
        );
    }

    /// Verifies that macOS discovery requires the executable permission bit.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_requires_the_executable_bit() {
        use std::os::unix::fs::PermissionsExt;

        let directory = TempDir::new().expect("the temporary directory should be created");
        let path = directory.path().join("fixture-tool");
        fs::write(&path, b"inert").expect("the fixture file should be written");
        let mut permissions = fs::metadata(&path)
            .expect("the fixture metadata should be readable")
            .permissions();
        permissions.set_mode(0o644);
        fs::set_permissions(&path, permissions).expect("the fixture should lose execution rights");
        let resolver = NativeCommandResolver::new(
            ProcessEnvironmentSnapshot::empty().with_path(directory.path()),
        );

        assert_eq!(
            resolver.resolve("fixture-tool"),
            Err(CommandResolutionError::NotFound)
        );
    }

    /// Verifies that resolver errors never include the inspected candidate path.
    #[test]
    fn resolver_errors_never_expose_a_path() {
        for error in [
            CommandResolutionError::InvalidCandidate,
            CommandResolutionError::NotFound,
            CommandResolutionError::Inspection,
        ] {
            let text = error.to_string();
            assert!(!text.contains('\\') && !text.contains('/'));
        }
    }
}
