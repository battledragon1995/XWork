use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::platform::process_tree::ProcessTree;

use super::{PtySizeDto, ResolvedCliLaunchKind, ResolvedCliProfile, TerminalError};

/// Receives asynchronous PTY output, EOF, and child completion.
#[doc(hidden)]
pub struct PtyCallbacks {
    pub output: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    pub eof: Arc<dyn Fn() + Send + Sync>,
    pub exited: Arc<dyn Fn(Result<Option<u32>, ()>) + Send + Sync>,
    pub failed: Arc<dyn Fn() + Send + Sync>,
}

/// Provides the controllable resources of one spawned PTY process.
#[doc(hidden)]
pub trait PtyProcess: Send + Sync {
    /// Writes and flushes one complete input chunk.
    fn write(&self, bytes: &[u8]) -> Result<(), TerminalError>;
    /// Applies one measured terminal size.
    fn resize(&self, size: PtySizeDto) -> Result<(), TerminalError>;
    /// Performs bounded graceful then forced process-tree cleanup.
    fn terminate(&self) -> Result<(), TerminalError>;
    /// Reports whether the root child is still running.
    fn is_alive(&self) -> bool;
}

/// Opens and spawns PTY processes behind an injectable boundary.
#[doc(hidden)]
pub trait PtyFactory: Send + Sync {
    /// Consumes sensitive launch data and returns only runtime control handles.
    fn spawn(
        &self,
        profile: ResolvedCliProfile,
        cwd: PathBuf,
        size: PtySizeDto,
        callbacks: PtyCallbacks,
    ) -> Result<Arc<dyn PtyProcess>, TerminalError>;
}

/// Uses portable-pty and the native process-tree adapter in production.
#[derive(Default)]
pub struct NativePtyFactory;

impl PtyFactory for NativePtyFactory {
    /// Opens the native PTY, spawns a structured command, and starts reader/wait workers.
    fn spawn(
        &self,
        profile: ResolvedCliProfile,
        cwd: PathBuf,
        size: PtySizeDto,
        callbacks: PtyCallbacks,
    ) -> Result<Arc<dyn PtyProcess>, TerminalError> {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: size.rows,
                cols: size.columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| TerminalError::PtyOpenFailed)?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|_| TerminalError::PtyOpenFailed)?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|_| TerminalError::PtyOpenFailed)?;
        let command = build_command(profile, cwd);
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|_| TerminalError::ProcessSpawnFailed)?;
        drop(pair.slave);
        // Job/process-group attachment completes before a runtime can be published.
        let tree = match ProcessTree::attach(child.as_ref()) {
            Ok(tree) => tree,
            Err(()) => {
                let mut child = child;
                let _ = child.kill();
                return Err(TerminalError::ProcessSpawnFailed);
            }
        };
        let process = Arc::new(NativePtyProcess {
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(child),
            tree: Mutex::new(Some(tree)),
            exit_reported: AtomicBool::new(false),
            control: Mutex::new(None),
        });
        bind_control_worker(&process)?;
        start_reader(
            reader,
            callbacks.output,
            callbacks.eof,
            callbacks.failed.clone(),
        )?;
        start_waiter(process.clone(), callbacks.exited, callbacks.failed)?;
        Ok(process)
    }
}

/// Stores native handles used by short control operations and polling workers.
struct NativePtyProcess {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    tree: Mutex<Option<ProcessTree>>,
    exit_reported: AtomicBool,
    control: Mutex<Option<std::sync::mpsc::SyncSender<ControlRequest>>>,
}

impl PtyProcess for NativePtyProcess {
    /// Writes exactly one chunk and acknowledges only after flush succeeds.
    fn write(&self, bytes: &[u8]) -> Result<(), TerminalError> {
        self.request_control(|reply| ControlRequest::Write {
            bytes: bytes.to_vec(),
            reply,
        })
    }

    /// Resizes through the retained PTY master.
    fn resize(&self, size: PtySizeDto) -> Result<(), TerminalError> {
        self.request_control(|reply| ControlRequest::Resize { size, reply })
    }

    /// Sends ETX, then kills the complete owned process tree within fixed deadlines.
    fn terminate(&self) -> Result<(), TerminalError> {
        self.request_control(|reply| ControlRequest::Terminate { reply })
    }

    /// Polls the root child without blocking control work.
    fn is_alive(&self) -> bool {
        self.child
            .lock()
            .map(|mut child| {
                child
                    .try_wait()
                    .map(|status| status.is_none())
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }
}

impl NativePtyProcess {
    /// Sends one command to the named control actor and waits for its acknowledgement.
    fn request_control(
        &self,
        command: impl FnOnce(std::sync::mpsc::Sender<Result<(), TerminalError>>) -> ControlRequest,
    ) -> Result<(), TerminalError> {
        let (reply, response) = std::sync::mpsc::channel();
        self.control
            .lock()
            .map_err(|_| TerminalError::ProcessIoFailed)?
            .as_ref()
            .ok_or(TerminalError::ProcessIoFailed)?
            .send(command(reply))
            .map_err(|_| TerminalError::ProcessIoFailed)?;
        response
            .recv()
            .map_err(|_| TerminalError::ProcessIoFailed)?
    }

    /// Performs one complete input write on the control actor.
    fn write_direct(&self, bytes: &[u8]) -> Result<(), TerminalError> {
        let mut guard = self
            .writer
            .lock()
            .map_err(|_| TerminalError::ProcessIoFailed)?;
        let writer = guard.as_mut().ok_or(TerminalError::TerminalNotRunning {
            terminal_id: String::new(),
        })?;
        writer
            .write_all(bytes)
            .and_then(|_| writer.flush())
            .map_err(|_| TerminalError::ProcessIoFailed)
    }

    /// Performs one native resize on the control actor.
    fn resize_direct(&self, size: PtySizeDto) -> Result<(), TerminalError> {
        self.master
            .lock()
            .map_err(|_| TerminalError::ResizeFailed)?
            .as_ref()
            .ok_or(TerminalError::ResizeFailed)?
            .resize(PtySize {
                rows: size.rows,
                cols: size.columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| TerminalError::ResizeFailed)
    }

    /// Performs graceful and forced termination on the control actor.
    fn terminate_direct(&self) -> Result<(), TerminalError> {
        if self.is_alive()
            && let Ok(mut writer) = self.writer.lock()
            && let Some(writer) = writer.as_mut()
        {
            let _ = writer.write_all(&[0x03]);
            let _ = writer.flush();
        }
        if self.is_alive() {
            let _ = wait_until_stopped(self, Duration::from_millis(750));
        }
        self.writer
            .lock()
            .map_err(|_| TerminalError::TerminationFailed)?
            .take();
        // Even when the root exited after ETX, its descendants can still remain in the job.
        let tree_result = self
            .tree
            .lock()
            .map_err(|_| TerminalError::TerminationFailed)?
            .as_ref()
            .ok_or(TerminalError::TerminationFailed)?
            .terminate();
        let child_result = self
            .child
            .lock()
            .map_err(|_| TerminalError::TerminationFailed)?
            .kill();
        // A failed tree operation can leave descendants alive even when the root exited.
        if tree_result.is_err() {
            return Err(TerminalError::TerminationFailed);
        }
        let _ = child_result;
        if wait_until_stopped(self, Duration::from_millis(1250)) {
            Ok(())
        } else {
            Err(TerminalError::TerminationFailed)
        }
    }
}

/// Carries one serialized native control request and its acknowledgement channel.
enum ControlRequest {
    Write {
        bytes: Vec<u8>,
        reply: std::sync::mpsc::Sender<Result<(), TerminalError>>,
    },
    Resize {
        size: PtySizeDto,
        reply: std::sync::mpsc::Sender<Result<(), TerminalError>>,
    },
    Terminate {
        reply: std::sync::mpsc::Sender<Result<(), TerminalError>>,
    },
}

/// Starts and binds the named control actor without retaining a strong process cycle.
fn bind_control_worker(process: &Arc<NativePtyProcess>) -> Result<(), TerminalError> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(64);
    *process
        .control
        .lock()
        .map_err(|_| TerminalError::ProcessSpawnFailed)? = Some(sender);
    let weak = Arc::downgrade(process);
    std::thread::Builder::new()
        .name("xwork-terminal-control".to_owned())
        .spawn(move || {
            while let Ok(command) = receiver.recv() {
                let Some(process) = weak.upgrade() else {
                    break;
                };
                match command {
                    ControlRequest::Write { bytes, reply } => {
                        let _ = reply.send(process.write_direct(&bytes));
                    }
                    ControlRequest::Resize { size, reply } => {
                        let _ = reply.send(process.resize_direct(size));
                    }
                    ControlRequest::Terminate { reply } => {
                        let _ = reply.send(process.terminate_direct());
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|_| TerminalError::ProcessSpawnFailed)
}

/// Builds a structured command with deterministic terminal environment overrides.
fn build_command(profile: ResolvedCliProfile, cwd: PathBuf) -> CommandBuilder {
    let ResolvedCliProfile {
        launch_kind,
        environment,
        ..
    } = profile;
    let (mut command, _shell_path) = match launch_kind {
        ResolvedCliLaunchKind::InteractiveShell { shell } => {
            let path = shell.executable;
            (CommandBuilder::new(&path), path)
        }
        ResolvedCliLaunchKind::Command {
            shell,
            executable,
            arguments,
        } => {
            let mut command = CommandBuilder::new(executable);
            command.args(arguments);
            (command, shell.executable)
        }
    };
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    for (name, value) in environment {
        command.env(name, value.as_str());
    }
    #[cfg(unix)]
    command.env("SHELL", _shell_path);
    command
}

/// Starts the named blocking reader and distinguishes EOF from read failure.
fn start_reader(
    mut reader: Box<dyn Read + Send>,
    output: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    eof: Arc<dyn Fn() + Send + Sync>,
    failed: Arc<dyn Fn() + Send + Sync>,
) -> Result<(), TerminalError> {
    let (sender, receiver) = std::sync::mpsc::sync_channel::<ReaderMessage>(64);
    std::thread::Builder::new()
        .name("xwork-terminal-dispatcher".to_owned())
        .spawn(move || {
            while let Ok(message) = receiver.recv() {
                match message {
                    ReaderMessage::Data(bytes) => output(bytes),
                    ReaderMessage::Complete { failed: did_fail } => {
                        if did_fail {
                            failed();
                        }
                        eof();
                        break;
                    }
                }
            }
        })
        .map_err(|_| TerminalError::ProcessSpawnFailed)?;
    std::thread::Builder::new()
        .name("xwork-terminal-reader".to_owned())
        .spawn(move || {
            let mut buffer = vec![0_u8; 32_768];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        let _ = sender.send(ReaderMessage::Complete { failed: false });
                        break;
                    }
                    Ok(count) => {
                        if sender
                            .send(ReaderMessage::Data(buffer[..count].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(ReaderMessage::Complete {
                            failed: error.kind() != std::io::ErrorKind::BrokenPipe,
                        });
                        break;
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|_| TerminalError::ProcessSpawnFailed)
}

/// Separates data from reader completion on the bounded dispatcher queue.
enum ReaderMessage {
    Data(Vec<u8>),
    Complete { failed: bool },
}

/// Starts a named nonblocking child poller so termination never waits on a held child lock.
fn start_waiter(
    process: Arc<NativePtyProcess>,
    exited: Arc<dyn Fn(Result<Option<u32>, ()>) + Send + Sync>,
    failed: Arc<dyn Fn() + Send + Sync>,
) -> Result<(), TerminalError> {
    std::thread::Builder::new()
        .name("xwork-terminal-waiter".to_owned())
        .spawn(move || {
            loop {
                let result = process
                    .child
                    .lock()
                    .map_err(|_| ())
                    .and_then(|mut child| child.try_wait().map_err(|_| ()))
                    .map(|status| {
                        status.map(|status| {
                            if status.signal().is_some() {
                                None
                            } else {
                                Some(status.exit_code())
                            }
                        })
                    });
                match result {
                    Ok(Some(code)) => {
                        process
                            .writer
                            .lock()
                            .ok()
                            .and_then(|mut writer| writer.take());
                        process
                            .master
                            .lock()
                            .ok()
                            .and_then(|mut master| master.take());
                        if !process.exit_reported.swap(true, Ordering::AcqRel) {
                            exited(Ok(code));
                        }
                        break;
                    }
                    Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                    Err(()) => {
                        failed();
                        if !process.exit_reported.swap(true, Ordering::AcqRel) {
                            exited(Err(()));
                        }
                        break;
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|_| TerminalError::ProcessSpawnFailed)
}

/// Polls until the root process stops or one bounded deadline expires.
fn wait_until_stopped(process: &NativePtyProcess, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if !process.is_alive() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    !process.is_alive()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::shell::{ResolvedShell, ShellMode};
    use std::ffi::OsStr;
    use zeroize::Zeroizing;

    /// Creates one synthetic shell without reading the host machine.
    fn shell() -> ResolvedShell {
        ResolvedShell {
            id: "fixture-shell".to_owned(),
            display_name: "Fixture Shell".to_owned(),
            command: "fixture-shell".to_owned(),
            executable: PathBuf::from("C:/Fixture Shell/shell.exe"),
            mode: ShellMode::PowerShell,
        }
    }

    /// Verifies interactive shell launch keeps cwd and final terminal environment.
    #[test]
    fn interactive_command_is_structured() {
        let cwd = PathBuf::from("C:/Fixture Root");
        let command = build_command(
            ResolvedCliProfile {
                profile_id: "builtin:terminal".to_owned(),
                display_name: "Fixture".to_owned(),
                launch_kind: ResolvedCliLaunchKind::InteractiveShell { shell: shell() },
                environment: vec![("TERM".to_owned(), Zeroizing::new("overridden".to_owned()))],
            },
            cwd.clone(),
        );
        assert_eq!(
            command.get_argv(),
            &vec![PathBuf::from("C:/Fixture Shell/shell.exe").into_os_string()]
        );
        assert_eq!(command.get_cwd(), Some(&cwd.into_os_string()));
        assert_eq!(command.get_env("TERM"), Some(OsStr::new("overridden")));
        assert_eq!(command.get_env("COLORTERM"), Some(OsStr::new("truecolor")));
        #[cfg(windows)]
        assert_eq!(
            command.get_env("COMSPEC"),
            std::env::var_os("COMSPEC").as_deref()
        );
    }

    /// Verifies executable arguments remain separate literal values.
    #[test]
    fn direct_command_preserves_literal_arguments() {
        let command = build_command(
            ResolvedCliProfile {
                profile_id: "builtin:codex".to_owned(),
                display_name: "Fixture".to_owned(),
                launch_kind: ResolvedCliLaunchKind::Command {
                    shell: shell(),
                    executable: "C:/Program Files/tool.exe".to_owned(),
                    arguments: vec!["space value".to_owned(), "& literal".to_owned()],
                },
                environment: Vec::new(),
            },
            PathBuf::from("C:/Fixture Root"),
        );
        assert_eq!(command.get_argv()[1], OsStr::new("space value"));
        assert_eq!(command.get_argv()[2], OsStr::new("& literal"));
        #[cfg(windows)]
        assert_eq!(
            command.get_env("COMSPEC"),
            std::env::var_os("COMSPEC").as_deref()
        );
    }
}
