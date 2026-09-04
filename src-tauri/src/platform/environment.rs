use std::ffi::{OsStr, OsString};

/// Names the environment variables command and shell discovery may read.
const PATH_VARIABLE: &str = "PATH";
const PATH_EXT_VARIABLE: &str = "PATHEXT";
const COM_SPEC_VARIABLE: &str = "COMSPEC";
const SHELL_VARIABLE: &str = "SHELL";

/// Holds one immutable copy of the environment values discovery is allowed to read.
///
/// Adapters capture the snapshot once at construction so a test can inject exact
/// values without mutating process-global state that other concurrent tests share.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProcessEnvironmentSnapshot {
    path: Option<OsString>,
    path_ext: Option<OsString>,
    com_spec: Option<OsString>,
    shell: Option<OsString>,
}

impl ProcessEnvironmentSnapshot {
    /// Captures the backend process environment exactly once.
    pub fn from_process() -> Self {
        Self {
            path: std::env::var_os(PATH_VARIABLE),
            path_ext: std::env::var_os(PATH_EXT_VARIABLE),
            com_spec: std::env::var_os(COM_SPEC_VARIABLE),
            shell: std::env::var_os(SHELL_VARIABLE),
        }
    }

    /// Creates a snapshot that exposes no environment value at all.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Returns the snapshot with an explicit executable search path.
    pub fn with_path(mut self, value: impl AsRef<OsStr>) -> Self {
        self.path = Some(value.as_ref().to_os_string());
        self
    }

    /// Returns the snapshot with an explicit Windows executable extension list.
    pub fn with_path_ext(mut self, value: impl AsRef<OsStr>) -> Self {
        self.path_ext = Some(value.as_ref().to_os_string());
        self
    }

    /// Returns the snapshot with an explicit Windows command processor path.
    pub fn with_com_spec(mut self, value: impl AsRef<OsStr>) -> Self {
        self.com_spec = Some(value.as_ref().to_os_string());
        self
    }

    /// Returns the snapshot with an explicit Unix login shell path.
    pub fn with_shell(mut self, value: impl AsRef<OsStr>) -> Self {
        self.shell = Some(value.as_ref().to_os_string());
        self
    }

    /// Returns the captured executable search path.
    pub fn path(&self) -> Option<&OsStr> {
        self.path.as_deref()
    }

    /// Returns the captured Windows executable extension list.
    pub fn path_ext(&self) -> Option<&OsStr> {
        self.path_ext.as_deref()
    }

    /// Returns the captured Windows command processor path.
    pub fn com_spec(&self) -> Option<&OsStr> {
        self.com_spec.as_deref()
    }

    /// Returns the captured Unix login shell path.
    pub fn shell(&self) -> Option<&OsStr> {
        self.shell.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::ProcessEnvironmentSnapshot;

    /// Verifies that an empty snapshot exposes no environment value.
    #[test]
    fn empty_snapshot_exposes_nothing() {
        let snapshot = ProcessEnvironmentSnapshot::empty();

        assert_eq!(snapshot.path(), None);
        assert_eq!(snapshot.path_ext(), None);
        assert_eq!(snapshot.com_spec(), None);
        assert_eq!(snapshot.shell(), None);
    }

    /// Verifies that injected values replace exactly one captured variable each.
    #[test]
    fn injected_values_are_returned_verbatim() {
        let snapshot = ProcessEnvironmentSnapshot::empty()
            .with_path("C:\\Tools")
            .with_path_ext(".EXE")
            .with_com_spec("C:\\Windows\\system32\\cmd.exe")
            .with_shell("/bin/zsh");

        assert_eq!(snapshot.path(), Some("C:\\Tools".as_ref()));
        assert_eq!(snapshot.path_ext(), Some(".EXE".as_ref()));
        assert_eq!(
            snapshot.com_spec(),
            Some("C:\\Windows\\system32\\cmd.exe".as_ref())
        );
        assert_eq!(snapshot.shell(), Some("/bin/zsh".as_ref()));
    }

    /// Verifies that capturing the real process environment never panics.
    #[test]
    fn process_snapshot_is_capturable() {
        let snapshot = ProcessEnvironmentSnapshot::from_process();

        // Every supported development host exposes a search path.
        assert!(snapshot.path().is_some());
    }
}
