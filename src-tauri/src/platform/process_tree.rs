use portable_pty::Child;

/// Owns the operating-system process-tree primitive for one terminal child.
pub(crate) struct ProcessTree {
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
    #[cfg(unix)]
    process_group: i32,
}

impl ProcessTree {
    /// Attaches a spawned PTY child to a kill-on-close process tree.
    pub(crate) fn attach(child: &(dyn Child + Send + Sync)) -> Result<Self, ()> {
        #[cfg(windows)]
        {
            use std::{mem::size_of, ptr::null};
            use windows_sys::Win32::System::Threading::{
                PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
            };
            use windows_sys::Win32::{
                Foundation::CloseHandle,
                System::{
                    JobObjects::{
                        AssignProcessToJobObject, CreateJobObjectW,
                        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                        JobObjectExtendedLimitInformation, SetInformationJobObject,
                    },
                    Threading::OpenProcess,
                },
            };

            let pid = child.process_id().ok_or(())?;
            // The process handle is opened only long enough to assign the exact child.
            let process = unsafe {
                OpenProcess(
                    PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                    0,
                    pid,
                )
            };
            if process.is_null() {
                return Err(());
            }
            let job = unsafe { CreateJobObjectW(null(), null()) };
            if job.is_null() {
                unsafe { CloseHandle(process) };
                return Err(());
            }
            let mut information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION =
                unsafe { std::mem::zeroed() };
            information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&raw const information).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            } != 0;
            let assigned = configured && unsafe { AssignProcessToJobObject(job, process) } != 0;
            unsafe { CloseHandle(process) };
            if !assigned {
                unsafe { CloseHandle(job) };
                return Err(());
            }
            Ok(Self { job })
        }
        #[cfg(unix)]
        {
            let process_group = i32::try_from(child.process_id().ok_or(())?).map_err(|_| ())?;
            Ok(Self { process_group })
        }
    }

    /// Force-terminates every process still owned by this tree.
    pub(crate) fn terminate(&self) -> Result<(), ()> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::JobObjects::TerminateJobObject;
            if unsafe { TerminateJobObject(self.job, 1) } == 0 {
                Err(())
            } else {
                Ok(())
            }
        }
        #[cfg(unix)]
        {
            // A negative PID targets the complete PTY process group at each stage.
            signal_group(self.process_group, libc::SIGHUP)?;
            std::thread::sleep(std::time::Duration::from_millis(250));
            signal_group(self.process_group, libc::SIGTERM)?;
            std::thread::sleep(std::time::Duration::from_millis(250));
            signal_group(self.process_group, libc::SIGKILL)
        }
    }
}

/// Sends one Unix process-group signal and accepts an already-empty group.
#[cfg(unix)]
fn signal_group(process_group: i32, signal: i32) -> Result<(), ()> {
    if unsafe { libc::kill(-process_group, signal) } == 0 {
        return Ok(());
    }
    (std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH))
        .then_some(())
        .ok_or(())
}

#[cfg(windows)]
unsafe impl Send for ProcessTree {}
#[cfg(windows)]
unsafe impl Sync for ProcessTree {}

impl Drop for ProcessTree {
    /// Releases the guard, which kills remaining Windows Job Object members.
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}
