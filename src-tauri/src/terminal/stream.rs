use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex, Weak,
        mpsc::{self, SyncSender, TrySendError},
    },
};

use tauri::ipc::{Channel, InvokeResponseBody};

use super::TerminalError;

const FRAME_VERSION: u8 = 1;
const HEADER_BYTES: usize = 13;
const MAX_PAYLOAD_BYTES: usize = 32_768;
const MAX_RING_BYTES: usize = 8 * 1024 * 1024;
const MAX_RING_FRAMES: usize = 1024;
const SENDER_QUEUE_FRAMES: usize = 256;
const MAX_PARTIAL_OSC_BYTES: usize = 4096;

/// Sends one encoded output frame to a frontend callback.
pub(crate) trait FrameSender: Send + Sync {
    /// Sends a raw frame or reports that the callback is detached.
    fn send(&self, frame: Vec<u8>) -> Result<(), ()>;
}

impl FrameSender for Channel<InvokeResponseBody> {
    /// Sends bytes through Tauri's raw response path.
    fn send(&self, frame: Vec<u8>) -> Result<(), ()> {
        Channel::send(self, InvokeResponseBody::Raw(frame)).map_err(|_| ())
    }
}

/// Reports the result of accepting one PTY output chunk.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PublishResult {
    pub latest_sequence: u64,
    pub attention: bool,
}

/// Owns ordered framing, retained replay, and one bounded subscriber worker.
#[derive(Clone)]
pub(crate) struct OutputStream {
    inner: Arc<StreamInner>,
}

/// Stores synchronized stream state and its sender queue.
struct StreamInner {
    state: Mutex<StreamState>,
    sender: SyncSender<SenderCommand>,
    on_detach: Arc<dyn Fn() + Send + Sync>,
}

/// Stores retained output and the active subscriber generation.
struct StreamState {
    latest: u64,
    ring_bytes: usize,
    ring: VecDeque<Arc<Vec<u8>>>,
    subscribed: bool,
    generation: u64,
    scanner: AttentionScanner,
}

/// Serializes subscription replacement and live delivery on one worker.
enum SenderCommand {
    Replace {
        generation: u64,
        sender: Arc<dyn FrameSender>,
        replay: Vec<Arc<Vec<u8>>>,
    },
    Frame {
        generation: u64,
        frame: Arc<Vec<u8>>,
    },
}

impl OutputStream {
    /// Creates an empty stream without starting a process.
    pub(crate) fn new(on_detach: Arc<dyn Fn() + Send + Sync>) -> Result<Self, TerminalError> {
        Self::new_with_spawner(on_detach, |weak, receiver| {
            std::thread::Builder::new()
                .name("xwork-terminal-sender".to_owned())
                .spawn(move || sender_worker(weak, receiver))
        })
    }

    /// Creates a stream through an injectable worker spawner for deterministic failure tests.
    fn new_with_spawner(
        on_detach: Arc<dyn Fn() + Send + Sync>,
        spawn: impl FnOnce(
            Weak<StreamInner>,
            mpsc::Receiver<SenderCommand>,
        ) -> std::io::Result<std::thread::JoinHandle<()>>,
    ) -> Result<Self, TerminalError> {
        let (sender, receiver) = mpsc::sync_channel(SENDER_QUEUE_FRAMES);
        let inner = Arc::new(StreamInner {
            state: Mutex::new(StreamState {
                latest: 0,
                ring_bytes: 0,
                ring: VecDeque::new(),
                subscribed: false,
                generation: 0,
                scanner: AttentionScanner::default(),
            }),
            sender,
            on_detach,
        });
        let weak = Arc::downgrade(&inner);
        spawn(weak, receiver).map_err(|_| TerminalError::StreamAttachFailed)?;
        Ok(Self { inner })
    }

    /// Frames one non-empty PTY read and queues it without blocking the reader.
    pub(crate) fn publish(&self, bytes: &[u8]) -> PublishResult {
        let mut latest = self.latest_sequence();
        let mut attention = false;
        for payload in bytes
            .chunks(MAX_PAYLOAD_BYTES)
            .filter(|chunk| !chunk.is_empty())
        {
            let mut state = self
                .inner
                .state
                .lock()
                .expect("terminal stream lock poisoned");
            state.latest = state.latest.saturating_add(1);
            latest = state.latest;
            attention |= state.scanner.scan(payload);
            let frame = Arc::new(encode_frame(latest, payload));
            state.ring_bytes = state.ring_bytes.saturating_add(frame.len());
            state.ring.push_back(frame.clone());
            while state.ring.len() > MAX_RING_FRAMES || state.ring_bytes > MAX_RING_BYTES {
                if let Some(evicted) = state.ring.pop_front() {
                    state.ring_bytes = state.ring_bytes.saturating_sub(evicted.len());
                }
            }
            if state.subscribed {
                let generation = state.generation;
                if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) = self
                    .inner
                    .sender
                    .try_send(SenderCommand::Frame { generation, frame })
                {
                    // Bounded backpressure detaches only the subscriber; PTY ingestion continues.
                    state.subscribed = false;
                    state.generation = state.generation.saturating_add(1);
                    drop(state);
                    (self.inner.on_detach)();
                }
            }
        }
        PublishResult {
            latest_sequence: latest,
            attention,
        }
    }

    /// Replaces the subscriber and schedules retained output before future live frames.
    pub(crate) fn subscribe(
        &self,
        after: Option<u64>,
        sender: Arc<dyn FrameSender>,
    ) -> Result<(u64, u64), TerminalError> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|_| TerminalError::StreamAttachFailed)?;
        let first = first_sequence(&state);
        let latest = state.latest;
        let after = match after {
            Some(value) if value <= latest => value,
            Some(_) => {
                return Err(TerminalError::InvalidSequence {
                    field: "afterSequence".to_owned(),
                });
            }
            None if first == 1 => 0,
            None => {
                return Err(TerminalError::OutputReplayUnavailable {
                    first_available_sequence: first.to_string(),
                    latest_sequence: latest.to_string(),
                });
            }
        };
        if after < latest && after.saturating_add(1) < first {
            return Err(TerminalError::OutputReplayUnavailable {
                first_available_sequence: first.to_string(),
                latest_sequence: latest.to_string(),
            });
        }
        let replay = state
            .ring
            .iter()
            .filter(|frame| frame_sequence(frame) > after)
            .cloned()
            .collect();
        let generation = state.generation.saturating_add(1);
        self.inner
            .sender
            .try_send(SenderCommand::Replace {
                generation,
                sender,
                replay,
            })
            .map_err(|_| TerminalError::StreamAttachFailed)?;
        state.generation = generation;
        state.subscribed = true;
        Ok((first, latest))
    }

    /// Returns the latest assigned output sequence.
    pub(crate) fn latest_sequence(&self) -> u64 {
        self.inner
            .state
            .lock()
            .map(|state| state.latest)
            .unwrap_or(0)
    }

    /// Returns whether a sender is currently attached.
    pub(crate) fn is_subscribed(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.subscribed)
            .unwrap_or(false)
    }

    /// Drops the current subscriber while retaining replay history.
    pub(crate) fn detach(&self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.subscribed = false;
            state.generation = state.generation.saturating_add(1);
        }
    }
}

/// Runs all potentially blocking callback sends outside owner locks.
fn sender_worker(inner: Weak<StreamInner>, receiver: mpsc::Receiver<SenderCommand>) {
    let mut current: Option<(u64, Arc<dyn FrameSender>)> = None;
    while let Ok(command) = receiver.recv() {
        let (generation, frames, replacement) = match command {
            SenderCommand::Replace {
                generation,
                sender,
                replay,
            } => {
                current = Some((generation, sender));
                (generation, replay, true)
            }
            SenderCommand::Frame { generation, frame } => (generation, vec![frame], false),
        };
        let Some((active_generation, sender)) = &current else {
            continue;
        };
        if *active_generation != generation {
            continue;
        }
        for frame in frames {
            if sender.send((*frame).clone()).is_err() {
                if let Some(inner) = inner.upgrade() {
                    inner.detach_generation(generation);
                }
                current = None;
                break;
            }
        }
        // The marker documents that replacement replay is a single serialized batch.
        let _ = replacement;
    }
}

impl StreamInner {
    /// Detaches only the subscriber generation whose send actually failed.
    fn detach_generation(&self, generation: u64) {
        let detached = self
            .state
            .lock()
            .map(|mut state| {
                if state.subscribed && state.generation == generation {
                    state.subscribed = false;
                    state.generation = state.generation.saturating_add(1);
                    true
                } else {
                    false
                }
            })
            .unwrap_or(false);
        if detached {
            (self.on_detach)();
        }
    }
}

/// Encodes one exact version-1 little-endian raw frame.
fn encode_frame(sequence: u64, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(HEADER_BYTES + payload.len());
    frame.push(FRAME_VERSION);
    frame.extend_from_slice(&sequence.to_le_bytes());
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

/// Reads the output sequence from an internally validated frame.
fn frame_sequence(frame: &[u8]) -> u64 {
    u64::from_le_bytes(
        frame[1..9]
            .try_into()
            .expect("an encoded frame has a sequence"),
    )
}

/// Returns the first retained sequence or the empty-ring boundary.
fn first_sequence(state: &StreamState) -> u64 {
    state
        .ring
        .front()
        .map(|frame| frame_sequence(frame))
        .unwrap_or(1)
}

/// Recognizes BEL and completed OSC 9/777 notifications across read boundaries.
#[derive(Default)]
struct AttentionScanner {
    osc: Option<Vec<u8>>,
    outside_escape: bool,
    discard_osc: bool,
    discard_escape: bool,
}

impl AttentionScanner {
    /// Scans raw bytes without decoding or retaining ordinary terminal content.
    fn scan(&mut self, bytes: &[u8]) -> bool {
        let mut attention = false;
        for &byte in bytes {
            if self.discard_osc {
                if byte == 0x07 || (self.discard_escape && byte == b'\\') {
                    self.discard_osc = false;
                    self.discard_escape = false;
                } else {
                    self.discard_escape = byte == 0x1b;
                }
                continue;
            }
            if let Some(osc) = &mut self.osc {
                if byte == 0x07 {
                    attention |= recognized_osc(osc);
                    self.osc = None;
                } else if byte == b'\\' && osc.last() == Some(&0x1b) {
                    osc.pop();
                    attention |= recognized_osc(osc);
                    self.osc = None;
                } else if osc.len() < MAX_PARTIAL_OSC_BYTES {
                    osc.push(byte);
                } else {
                    self.osc = None;
                    self.discard_osc = true;
                }
                continue;
            }
            if self.outside_escape {
                self.outside_escape = false;
                if byte == b']' {
                    self.osc = Some(Vec::new());
                }
                continue;
            }
            if byte == 0x1b {
                self.outside_escape = true;
            } else if byte == 0x07 {
                attention = true;
            }
        }
        attention
    }
}

/// Checks one completed OSC payload for notification command numbers only.
fn recognized_osc(payload: &[u8]) -> bool {
    payload == b"9"
        || payload.starts_with(b"9;")
        || payload == b"777"
        || payload.starts_with(b"777;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    };

    /// Captures raw callback frames for deterministic assertions.
    struct Capture(Mutex<Vec<Vec<u8>>>);
    impl FrameSender for Capture {
        /// Stores one delivered frame.
        fn send(&self, frame: Vec<u8>) -> Result<(), ()> {
            self.0.lock().expect("capture lock").push(frame);
            Ok(())
        }
    }

    /// Waits for an exact minimum number of asynchronously delivered frames.
    fn wait_for_frames(capture: &Capture, count: usize) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while capture.0.lock().expect("capture lock").len() < count {
            assert!(
                std::time::Instant::now() < deadline,
                "subscriber frames should arrive before the deadline"
            );
            std::thread::yield_now();
        }
    }

    /// Verifies framing preserves arbitrary split bytes and exact lengths.
    #[test]
    fn frames_raw_bytes_exactly() {
        let stream = OutputStream::new(Arc::new(|| {})).expect("stream should start");
        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        stream
            .subscribe(None, capture.clone())
            .expect("subscriber should attach");
        stream.publish(&[0xf0, 0x9f]);
        stream.publish(&[0x98, 0x80, 0x1b]);
        stream.publish(&[]);
        wait_for_frames(&capture, 2);
        let frames = capture.0.lock().expect("capture lock");
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0][0], 1);
        assert_eq!(frame_sequence(&frames[0]), 1);
        assert_eq!(
            u32::from_le_bytes(frames[0][9..13].try_into().expect("length")),
            2
        );
        assert_eq!(frames[0].len(), HEADER_BYTES + 2);
        assert_eq!(&frames[0][13..], &[0xf0, 0x9f]);
        assert_eq!(frame_sequence(&frames[1]), 2);
        assert_eq!(stream.latest_sequence(), 2);
    }

    /// Verifies one oversized read becomes only non-empty bounded payload frames.
    #[test]
    fn splits_reads_at_the_exact_payload_limit() {
        let stream = OutputStream::new(Arc::new(|| {})).expect("stream should start");
        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        stream
            .subscribe(None, capture.clone())
            .expect("subscriber should attach");
        stream.publish(&vec![b'x'; MAX_PAYLOAD_BYTES + 1]);
        wait_for_frames(&capture, 2);
        let frames = capture.0.lock().expect("capture lock");
        assert_eq!(frames[0].len(), HEADER_BYTES + MAX_PAYLOAD_BYTES);
        assert_eq!(frames[1].len(), HEADER_BYTES + 1);
        assert_eq!(frame_sequence(&frames[0]), 1);
        assert_eq!(frame_sequence(&frames[1]), 2);
    }

    /// Verifies replay boundaries reject gaps and preserve retained order.
    #[test]
    fn replay_is_ordered_and_validated() {
        let stream = OutputStream::new(Arc::new(|| {})).expect("stream should start");
        for byte in 0..3 {
            stream.publish(&[byte]);
        }
        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        assert_eq!(stream.subscribe(Some(1), capture.clone()), Ok((1, 3)));
        wait_for_frames(&capture, 2);
        let frames = capture.0.lock().expect("capture lock");
        assert_eq!(
            frames
                .iter()
                .map(|frame| frame_sequence(frame))
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
    }

    /// Verifies future and evicted recovery requests preserve a valid subscriber.
    #[test]
    fn invalid_recovery_does_not_replace_the_current_subscriber() {
        let stream = OutputStream::new(Arc::new(|| {})).expect("stream should start");
        let current = Arc::new(Capture(Mutex::new(Vec::new())));
        let rejected = Arc::new(Capture(Mutex::new(Vec::new())));
        stream
            .subscribe(None, current.clone())
            .expect("initial subscriber should attach");
        stream.publish(b"one");
        wait_for_frames(&current, 1);
        assert!(matches!(
            stream.subscribe(Some(2), rejected.clone()),
            Err(TerminalError::InvalidSequence { .. })
        ));
        stream.publish(b"two");
        wait_for_frames(&current, 2);
        assert!(rejected.0.lock().expect("capture lock").is_empty());

        let evicted = OutputStream::new(Arc::new(|| {})).expect("stream should start");
        for _ in 0..=MAX_RING_FRAMES {
            evicted.publish(b"x");
        }
        assert!(matches!(
            evicted.subscribe(None, rejected.clone()),
            Err(TerminalError::OutputReplayUnavailable {
                first_available_sequence,
                latest_sequence
            }) if first_available_sequence == "2" && latest_sequence == "1025"
        ));
        assert_eq!(evicted.subscribe(Some(1025), rejected), Ok((2, 1025)));
    }

    /// Verifies sender worker creation failure maps to the public stream error.
    #[test]
    fn sender_worker_creation_failure_is_reported() {
        let result = OutputStream::new_with_spawner(Arc::new(|| {}), |_weak, _receiver| {
            Err(std::io::Error::other("synthetic worker failure"))
        });
        assert!(matches!(result, Err(TerminalError::StreamAttachFailed)));
    }

    /// Verifies the full retained window replays as one bounded ordered batch.
    #[test]
    fn full_replay_window_precedes_live_output() {
        let stream = OutputStream::new(Arc::new(|| {})).expect("stream should start");
        for value in 0..MAX_RING_FRAMES {
            stream.publish(&[(value % 251) as u8]);
        }
        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        stream
            .subscribe(None, capture.clone())
            .expect("full replay should attach");
        stream.publish(b"live");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while capture.0.lock().expect("capture lock").len() < MAX_RING_FRAMES + 1 {
            assert!(
                std::time::Instant::now() < deadline,
                "full replay should drain"
            );
            std::thread::yield_now();
        }
        let frames = capture.0.lock().expect("capture lock");
        assert_eq!(frame_sequence(&frames[0]), 1);
        assert_eq!(frame_sequence(frames.last().expect("live frame")), 1025);
    }

    /// Blocks callback delivery until released to exercise bounded subscriber overload.
    struct BlockedSender {
        entered: AtomicBool,
        release: AtomicBool,
    }

    impl FrameSender for BlockedSender {
        /// Waits without holding a stream lock, then accepts the frame.
        fn send(&self, _frame: Vec<u8>) -> Result<(), ()> {
            self.entered.store(true, Ordering::Release);
            while !self.release.load(Ordering::Acquire) {
                std::thread::yield_now();
            }
            Ok(())
        }
    }

    /// Verifies replacement and live delivery remain ordered behind an in-flight old callback.
    #[test]
    fn replacement_waits_for_in_flight_callback_without_losing_live_output() {
        let stream = OutputStream::new(Arc::new(|| {})).expect("stream should start");
        let old = Arc::new(BlockedSender {
            entered: AtomicBool::new(false),
            release: AtomicBool::new(false),
        });
        stream
            .subscribe(None, old.clone())
            .expect("old subscriber should attach");
        stream.publish(b"old");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while !old.entered.load(Ordering::Acquire) {
            assert!(
                std::time::Instant::now() < deadline,
                "old callback should enter"
            );
            std::thread::yield_now();
        }
        let replacement = Arc::new(Capture(Mutex::new(Vec::new())));
        assert_eq!(stream.subscribe(Some(1), replacement.clone()), Ok((1, 1)));
        stream.publish(b"new");
        old.release.store(true, Ordering::Release);
        wait_for_frames(&replacement, 1);
        let frames = replacement.0.lock().expect("capture lock");
        assert_eq!(frames.len(), 1);
        assert_eq!(frame_sequence(&frames[0]), 2);
        assert_eq!(&frames[0][HEADER_BYTES..], b"new");
    }

    /// Fails every callback send to exercise worker-side subscriber detachment.
    struct FailingSender;

    impl FrameSender for FailingSender {
        /// Rejects one delivered frame.
        fn send(&self, _frame: Vec<u8>) -> Result<(), ()> {
            Err(())
        }
    }

    /// Verifies callback failure detaches once and permits replay recovery.
    #[test]
    fn failed_subscriber_can_be_replaced_from_retained_output() {
        let detach_count = Arc::new(AtomicUsize::new(0));
        let observed = detach_count.clone();
        let stream = OutputStream::new(Arc::new(move || {
            observed.fetch_add(1, Ordering::SeqCst);
        }))
        .expect("stream should start");
        stream
            .subscribe(None, Arc::new(FailingSender))
            .expect("subscriber should attach");
        stream.publish(b"retained");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while detach_count.load(Ordering::SeqCst) == 0 {
            assert!(
                std::time::Instant::now() < deadline,
                "failed callback should detach"
            );
            std::thread::yield_now();
        }
        assert!(!stream.is_subscribed());
        assert_eq!(detach_count.load(Ordering::SeqCst), 1);
        let replacement = Arc::new(Capture(Mutex::new(Vec::new())));
        assert_eq!(stream.subscribe(Some(0), replacement.clone()), Ok((1, 1)));
        wait_for_frames(&replacement, 1);
        assert_eq!(
            frame_sequence(&replacement.0.lock().expect("capture lock")[0]),
            1
        );
    }

    /// Verifies sender overload detaches once while retaining output ingestion.
    #[test]
    fn blocked_subscriber_detaches_without_stopping_sequences() {
        let detach_count = Arc::new(AtomicUsize::new(0));
        let observed = detach_count.clone();
        let stream = OutputStream::new(Arc::new(move || {
            observed.fetch_add(1, Ordering::SeqCst);
        }))
        .expect("stream should start");
        let sender = Arc::new(BlockedSender {
            entered: AtomicBool::new(false),
            release: AtomicBool::new(false),
        });
        stream
            .subscribe(None, sender.clone())
            .expect("subscriber should attach");
        for _ in 0..300 {
            stream.publish(b"x");
        }
        assert!(!stream.is_subscribed());
        assert_eq!(detach_count.load(Ordering::SeqCst), 1);
        assert_eq!(stream.latest_sequence(), 300);
        sender.release.store(true, Ordering::Release);
    }

    /// Verifies notification recognition spans chunks and ignores keywords.
    #[test]
    fn attention_scanner_recognizes_only_terminal_signals() {
        let mut scanner = AttentionScanner::default();
        assert!(!scanner.scan(b"needs attention notification"));
        assert!(!scanner.scan(b"\x1b]77"));
        assert!(scanner.scan(b"7;done\x1b\\"));
        assert!(scanner.scan(b"\x07"));
        let mut oversized = Vec::from(&b"\x1b]9;"[..]);
        oversized.extend(std::iter::repeat_n(b'x', MAX_PARTIAL_OSC_BYTES + 1));
        oversized.push(0x07);
        assert!(!AttentionScanner::default().scan(&oversized));
    }
}
