#![cfg(windows)]

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

use xwork_lib::{
    platform::shell::{ResolvedShell, ShellMode},
    terminal::{
        NativePtyFactory, PtyCallbacks, PtyFactory, PtySizeDto, ResolvedCliLaunchKind,
        ResolvedCliProfile,
    },
};

/// Resolves the fixed inbox Windows PowerShell executable.
fn powershell() -> PathBuf {
    PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot should exist"))
        .join("System32/WindowsPowerShell/v1.0/powershell.exe")
}

/// Builds a structured noninteractive fixture profile without user data or secrets.
fn fixture_profile(script: &Path, arguments: &[&str]) -> ResolvedCliProfile {
    let shell_path = powershell();
    let mut command_arguments = vec![
        "-NoLogo".to_owned(),
        "-NoProfile".to_owned(),
        "-ExecutionPolicy".to_owned(),
        "Bypass".to_owned(),
        "-File".to_owned(),
        script.to_string_lossy().into_owned(),
    ];
    command_arguments.extend(arguments.iter().map(|value| (*value).to_owned()));
    ResolvedCliProfile {
        profile_id: "builtin:terminal".to_owned(),
        display_name: "PTY fixture".to_owned(),
        launch_kind: ResolvedCliLaunchKind::Command {
            shell: ResolvedShell {
                id: "windows-powershell".to_owned(),
                display_name: "Windows PowerShell".to_owned(),
                command: "powershell.exe".to_owned(),
                executable: shell_path.clone(),
                mode: ShellMode::PowerShell,
            },
            executable: shell_path.to_string_lossy().into_owned(),
            arguments: command_arguments,
        },
        environment: vec![(
            "XWORK_PTY_FIXTURE".to_owned(),
            zeroize::Zeroizing::new("synthetic".to_owned()),
        )],
    }
}

/// Waits until captured output contains one synthetic marker.
fn wait_for_marker(output: &Arc<Mutex<Vec<u8>>>, marker: &[u8]) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let snapshot = output.lock().expect("output lock").clone();
        if snapshot
            .windows(marker.len())
            .any(|window| window == marker)
        {
            return snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "PTY fixture marker {:?} was not observed; bytes={}, tail={:?}",
            String::from_utf8_lossy(marker),
            snapshot.len(),
            String::from_utf8_lossy(&snapshot[snapshot.len().saturating_sub(512)..])
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Opens one real ConPTY and verifies Unicode, input, resize, exit, and final drain.
#[test]
fn conpty_round_trips_unicode_input_resize_and_exit() {
    let root = tempfile::TempDir::new().expect("temporary project root should exist");
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pty_echo.ps1");
    let output = Arc::new(Mutex::new(Vec::new()));
    let output_capture = output.clone();
    let (eof_send, eof_receive) = mpsc::channel();
    let (exit_send, exit_receive) = mpsc::channel();
    let process = NativePtyFactory
        .spawn(
            fixture_profile(&script, &["0"]),
            root.path().to_path_buf(),
            PtySizeDto {
                columns: 80,
                rows: 24,
            },
            PtyCallbacks {
                output: Arc::new(move |bytes| {
                    output_capture.lock().expect("output lock").extend(bytes)
                }),
                eof: Arc::new(move || {
                    let _ = eof_send.send(());
                }),
                exited: Arc::new(move |result| {
                    let _ = exit_send.send(result);
                }),
                failed: Arc::new(|| {}),
            },
        )
        .expect("ConPTY fixture should spawn");

    process
        .write(b"\x1b[1;1R")
        .expect("terminal query response should succeed");
    let ready = "READY:Tiếng Việt:界:😀".as_bytes();
    wait_for_marker(&output, ready);
    let split = "SPLIT:Tiếng Việt:界:😀".as_bytes();
    wait_for_marker(&output, split);
    process
        .resize(PtySizeDto {
            columns: 100,
            rows: 30,
        })
        .expect("resize should succeed");
    let paste_chunk = "x".repeat(512);
    let large_input = format!("large:{}:xong", paste_chunk.repeat(32));
    process
        .write(b"large:")
        .expect("large paste prefix should succeed");
    for _ in 0..32 {
        process
            .write(paste_chunk.as_bytes())
            .expect("large paste chunk should succeed");
    }
    process
        .write(b":xong\r\n")
        .expect("paste terminator should succeed");
    wait_for_marker(&output, b"ECHO:large");
    wait_for_marker(
        &output,
        format!("INPUT-BYTES:{}", large_input.len()).as_bytes(),
    );
    let final_output = wait_for_marker(&output, b"SIZE:100x30");
    assert!(
        final_output
            .windows(ready.len())
            .any(|window| window == ready)
    );
    assert!(
        final_output
            .windows(split.len())
            .any(|window| window == split)
    );
    assert!(final_output.windows(8).any(|window| window == b"BURST:64"));
    assert!(final_output.windows(5).any(|window| window == b":xong"));
    assert_eq!(
        exit_receive
            .recv_timeout(Duration::from_secs(10))
            .expect("exit should be reported"),
        Ok(Some(0))
    );
    eof_receive
        .recv_timeout(Duration::from_secs(10))
        .expect("reader EOF should be reported");
    assert!(!process.is_alive());
}

/// Closes a real ConPTY Job Object and verifies its exact child is terminated.
#[test]
fn conpty_close_terminates_descendant_process() {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };

    let root = tempfile::TempDir::new().expect("temporary project root should exist");
    let script =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pty_child_tree.ps1");
    let output = Arc::new(Mutex::new(Vec::new()));
    let output_capture = output.clone();
    let process = NativePtyFactory
        .spawn(
            fixture_profile(&script, &[]),
            root.path().to_path_buf(),
            PtySizeDto {
                columns: 80,
                rows: 24,
            },
            PtyCallbacks {
                output: Arc::new(move |bytes| {
                    output_capture.lock().expect("output lock").extend(bytes)
                }),
                eof: Arc::new(|| {}),
                exited: Arc::new(|_| {}),
                failed: Arc::new(|| {}),
            },
        )
        .expect("child-tree fixture should spawn");
    process
        .write(b"\x1b[1;1R")
        .expect("terminal query response should succeed");
    let snapshot = wait_for_marker(&output, b"CHILD:");
    let text = String::from_utf8_lossy(&snapshot);
    let child_id = text
        .split("CHILD:")
        .nth(1)
        .and_then(|tail| {
            tail.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse::<u32>()
                .ok()
        })
        .expect("child marker should contain a PID");
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, child_id) };
    assert!(
        !handle.is_null(),
        "fixture child should still be alive before close"
    );
    process
        .terminate()
        .expect("the complete job should terminate");
    assert_eq!(unsafe { WaitForSingleObject(handle, 3000) }, WAIT_OBJECT_0);
    unsafe { CloseHandle(handle) };
    assert!(!process.is_alive());
}

/// Runs four independent ConPTY fixtures concurrently through input and exit.
#[test]
fn four_conpty_processes_keep_output_and_control_independent() {
    let root = tempfile::TempDir::new().expect("temporary project root should exist");
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pty_echo.ps1");
    let mut terminals = Vec::new();
    for index in 0..4 {
        let output = Arc::new(Mutex::new(Vec::new()));
        let capture = output.clone();
        let (exit_send, exit_receive) = mpsc::channel();
        let process = NativePtyFactory
            .spawn(
                fixture_profile(&script, &[if index == 3 { "7" } else { "0" }]),
                root.path().to_path_buf(),
                PtySizeDto {
                    columns: 80 + index,
                    rows: 24,
                },
                PtyCallbacks {
                    output: Arc::new(move |bytes| {
                        capture.lock().expect("output lock").extend(bytes)
                    }),
                    eof: Arc::new(|| {}),
                    exited: Arc::new(move |result| {
                        let _ = exit_send.send(result);
                    }),
                    failed: Arc::new(|| {}),
                },
            )
            .expect("concurrent ConPTY fixture should spawn");
        terminals.push((index, process, output, exit_receive));
    }
    for (index, process, output, _) in &terminals {
        process
            .write(b"\x1b[1;1R")
            .expect("terminal query response should succeed");
        wait_for_marker(output, b"READY:");
        process
            .resize(PtySizeDto {
                columns: 90 + *index,
                rows: 25,
            })
            .expect("independent resize should succeed");
        process
            .write(format!("terminal-{index}\r\n").as_bytes())
            .expect("independent input should succeed");
    }
    for (index, process, output, exit_receive) in terminals {
        wait_for_marker(&output, format!("ECHO:terminal-{index}").as_bytes());
        assert_eq!(
            exit_receive
                .recv_timeout(Duration::from_secs(10))
                .expect("exit should be reported"),
            Ok(Some(if index == 3 { 7 } else { 0 }))
        );
        assert!(!process.is_alive());
    }
}
