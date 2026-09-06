use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, RecvTimeoutError, SyncSender, TrySendError},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};

use super::{FileWatchModeDto, FilesError};

const HINT_QUEUE_CAPACITY: usize = 1_024;
const HINT_DEBOUNCE: Duration = Duration::from_millis(100);
const FALLBACK_INTERVAL: Duration = Duration::from_secs(2);
const WORKER_TICK: Duration = Duration::from_millis(50);

/// Receives a debounced path hint, or `None` when every handle needs reconciliation.
pub(crate) type WatchHintCallback = Arc<dyn Fn(Option<PathBuf>) + Send + Sync>;

/// Shares bounded native and polling watches for every handle in a parent directory.
pub(crate) struct ParentWatcherRegistry {
    parents: Arc<Mutex<HashMap<PathBuf, ParentWatch>>>,
    sender: SyncSender<PathBuf>,
    overflow: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

/// Retains one watch mode and its number of interested handles.
struct ParentWatch {
    watcher: Option<RecommendedWatcher>,
    references: usize,
    mode: FileWatchModeDto,
}

impl ParentWatcherRegistry {
    /// Creates the bounded debounce and polling worker for one Files service.
    pub(crate) fn new(callback: WatchHintCallback) -> Self {
        let parents = Arc::new(Mutex::new(HashMap::new()));
        let overflow = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::sync_channel(HINT_QUEUE_CAPACITY);
        let worker_parents = parents.clone();
        let worker_overflow = overflow.clone();
        let worker_shutdown = shutdown.clone();
        let worker = thread::Builder::new()
            .name("files-watch".to_owned())
            .spawn(move || {
                run_worker(
                    receiver,
                    worker_parents,
                    worker_overflow,
                    worker_shutdown,
                    callback,
                );
            })
            .ok();
        Self {
            parents,
            sender,
            overflow,
            shutdown,
            worker: Mutex::new(worker),
        }
    }

    /// Adds one parent reference or installs targeted polling after native setup fails.
    pub(crate) fn watch(&self, parent: &Path) -> FileWatchModeDto {
        let Ok(mut parents) = self.parents.lock() else {
            return FileWatchModeDto::PollingFallback;
        };
        if let Some(entry) = parents.get_mut(parent) {
            entry.references = entry.references.saturating_add(1);
            return entry.mode;
        }
        let sender = self.sender.clone();
        let overflow = self.overflow.clone();
        let watcher = RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                if let Ok(event) = result {
                    for path in event.paths {
                        enqueue_hint(&sender, &overflow, path);
                    }
                }
            },
            Config::default().with_follow_symlinks(false),
        )
        .ok()
        .and_then(|mut watcher| {
            watcher
                .watch(parent, RecursiveMode::NonRecursive)
                .ok()
                .map(|()| watcher)
        });
        let mode = if watcher.is_some() {
            FileWatchModeDto::Native
        } else {
            FileWatchModeDto::PollingFallback
        };
        parents.insert(
            parent.to_path_buf(),
            ParentWatch {
                watcher,
                references: 1,
                mode,
            },
        );
        mode
    }

    /// Releases one parent mode when the final interested handle leaves.
    pub(crate) fn unwatch(&self, parent: &Path, mode: FileWatchModeDto) {
        let Ok(mut parents) = self.parents.lock() else {
            return;
        };
        let should_remove = if let Some(entry) = parents.get_mut(parent) {
            if entry.mode != mode {
                return;
            }
            entry.references = entry.references.saturating_sub(1);
            entry.references == 0
        } else {
            false
        };
        if should_remove
            && let Some(mut entry) = parents.remove(parent)
            && let Some(watcher) = entry.watcher.as_mut()
        {
            let _ = watcher.unwatch(parent);
        }
    }

    /// Removes every native or polling registration during service shutdown.
    pub(crate) fn clear(&self) {
        if let Ok(mut parents) = self.parents.lock() {
            for (path, mut entry) in parents.drain() {
                if let Some(watcher) = entry.watcher.as_mut() {
                    let _ = watcher.unwatch(&path);
                }
            }
        }
    }
}

impl Drop for ParentWatcherRegistry {
    /// Stops the worker after releasing every operating-system registration.
    fn drop(&mut self) {
        self.clear();
        self.shutdown.store(true, Ordering::Release);
        if let Ok(mut worker) = self.worker.lock()
            && let Some(worker) = worker.take()
        {
            let _ = worker.join();
        }
    }
}

/// Adds one native hint without blocking the operating-system callback.
fn enqueue_hint(sender: &SyncSender<PathBuf>, overflow: &AtomicBool, path: PathBuf) {
    if let Err(TrySendError::Full(_)) = sender.try_send(path) {
        overflow.store(true, Ordering::Release);
    }
}

/// Coalesces native paths and schedules targeted fallback reconciliation.
fn run_worker(
    receiver: mpsc::Receiver<PathBuf>,
    parents: Arc<Mutex<HashMap<PathBuf, ParentWatch>>>,
    overflow: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    callback: WatchHintCallback,
) {
    let mut pending = HashMap::<PathBuf, Instant>::new();
    let mut next_fallback = Instant::now() + FALLBACK_INTERVAL;
    while !shutdown.load(Ordering::Acquire) {
        match receiver.recv_timeout(WORKER_TICK) {
            Ok(path) => {
                pending.insert(path, Instant::now());
                while let Ok(path) = receiver.try_recv() {
                    pending.insert(path, Instant::now());
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if overflow.swap(false, Ordering::AcqRel) {
            pending.clear();
            callback(None);
        }
        let now = Instant::now();
        let ready = pending
            .iter()
            .filter(|(_, observed)| now.duration_since(**observed) >= HINT_DEBOUNCE)
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        for path in ready {
            pending.remove(&path);
            callback(Some(path));
        }
        if now >= next_fallback {
            let fallback = parents
                .lock()
                .map(|parents| {
                    parents
                        .iter()
                        .filter(|(_, watch)| watch.mode == FileWatchModeDto::PollingFallback)
                        .map(|(path, _)| path.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for parent in fallback {
                callback(Some(parent));
            }
            next_fallback = now + FALLBACK_INTERVAL;
        }
    }
}

impl From<notify::Error> for FilesError {
    /// Converts native watcher setup failures into the safe read category.
    fn from(_value: notify::Error) -> Self {
        Self::FileSystemReadFailed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Waits for one worker callback with a bounded deadline.
    fn receive_hint(receiver: &mpsc::Receiver<Option<PathBuf>>) -> Option<PathBuf> {
        receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("the watcher worker should report before the deadline")
    }

    /// Verifies duplicate native hints coalesce into one callback after the debounce window.
    #[test]
    fn worker_debounces_duplicate_paths() {
        let (sender, receiver) = mpsc::sync_channel(HINT_QUEUE_CAPACITY);
        let parents = Arc::new(Mutex::new(HashMap::new()));
        let overflow = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));
        let (observed_sender, observed_receiver) = mpsc::channel();
        let callback = Arc::new(move |path| {
            observed_sender
                .send(path)
                .expect("the observer should remain connected");
        });
        let worker_shutdown = shutdown.clone();
        let worker = thread::spawn(move || {
            run_worker(receiver, parents, overflow, worker_shutdown, callback);
        });
        let path = PathBuf::from("fixture.md");
        sender
            .send(path.clone())
            .expect("the first hint should fit");
        sender.send(path.clone()).expect("the duplicate should fit");
        assert_eq!(receive_hint(&observed_receiver), Some(path));
        assert!(observed_receiver.try_recv().is_err());
        shutdown.store(true, Ordering::Release);
        worker.join().expect("the worker should stop cleanly");
    }

    /// Verifies queue saturation requests a reconcile-all callback instead of dropping silently.
    #[test]
    fn queue_overflow_requests_full_reconciliation() {
        let (sender, _receiver) = mpsc::sync_channel(HINT_QUEUE_CAPACITY);
        let overflow = AtomicBool::new(false);
        for index in 0..HINT_QUEUE_CAPACITY {
            enqueue_hint(&sender, &overflow, PathBuf::from(index.to_string()));
        }
        enqueue_hint(&sender, &overflow, PathBuf::from("overflow"));
        assert!(overflow.load(Ordering::Acquire));
    }

    /// Verifies fallback parents are reconciled on the fixed polling interval.
    #[test]
    fn worker_polls_fallback_parents() {
        let (_sender, receiver) = mpsc::sync_channel(HINT_QUEUE_CAPACITY);
        let parent = PathBuf::from("fallback-parent");
        let parents = Arc::new(Mutex::new(HashMap::from([(
            parent.clone(),
            ParentWatch {
                watcher: None,
                references: 1,
                mode: FileWatchModeDto::PollingFallback,
            },
        )])));
        let overflow = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));
        let (observed_sender, observed_receiver) = mpsc::channel();
        let callback = Arc::new(move |path| {
            observed_sender
                .send(path)
                .expect("the observer should remain connected");
        });
        let worker_shutdown = shutdown.clone();
        let worker = thread::spawn(move || {
            run_worker(receiver, parents, overflow, worker_shutdown, callback);
        });
        assert_eq!(receive_hint(&observed_receiver), Some(parent));
        shutdown.store(true, Ordering::Release);
        worker.join().expect("the worker should stop cleanly");
    }
}
