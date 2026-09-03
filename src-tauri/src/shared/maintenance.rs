use std::sync::Arc;

use tokio::sync::{OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

/// Admits ordinary persistent mutations and exclusive maintenance snapshots.
///
/// The gate is the outermost lock of the application-wide order
/// `DataMaintenanceGate` -> owner mutation/removal lock -> `Storage`. Ordinary
/// writes take a shared read permit and keep it until after commit and owner
/// publication; backup and reset take the exclusive write permit so no other
/// durable mutation can interleave. Owner maintenance callbacks that already run
/// inside a caller-owned transaction must never re-enter the gate.
#[derive(Clone)]
pub struct DataMaintenanceGate {
    inner: Arc<RwLock<()>>,
}

/// Grants shared admission for exactly one ordinary persistent mutation.
///
/// The permit is an owned Tokio guard, so it is `Send` and may be held across
/// `.await` points while blocking database work runs on a worker thread.
pub struct DataReadPermit(#[allow(dead_code)] OwnedRwLockReadGuard<()>);

/// Grants exclusive admission for exactly one backup or reset snapshot.
pub struct DataWritePermit(#[allow(dead_code)] OwnedRwLockWriteGuard<()>);

impl DataMaintenanceGate {
    /// Creates the single application-wide admission gate.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(())),
        }
    }

    /// Acquires shared admission for one ordinary persistent mutation.
    pub async fn read_permit(&self) -> DataReadPermit {
        DataReadPermit(self.inner.clone().read_owned().await)
    }

    /// Acquires exclusive admission for one backup or reset maintenance snapshot.
    pub async fn write_permit(&self) -> DataWritePermit {
        DataWritePermit(self.inner.clone().write_owned().await)
    }

    /// Reports whether two handles share one admission state.
    pub fn shares_state_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }
}

impl Default for DataMaintenanceGate {
    /// Creates an independent gate for callers that do not inject one.
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::{
        pin::Pin,
        task::{Context, Poll, Waker},
    };

    use super::{DataMaintenanceGate, DataReadPermit, DataWritePermit};

    /// Polls one pinned future exactly once with a no-op waker.
    fn poll_once<T>(future: &mut Pin<Box<dyn Future<Output = T> + Send + '_>>) -> Poll<T> {
        let waker = Waker::noop();
        let mut context = Context::from_waker(waker);
        future.as_mut().poll(&mut context)
    }

    /// Boxes one read-permit acquisition so the test can poll it repeatedly.
    fn read_future(
        gate: &DataMaintenanceGate,
    ) -> Pin<Box<dyn Future<Output = DataReadPermit> + Send + '_>> {
        Box::pin(gate.read_permit())
    }

    /// Boxes one write-permit acquisition so the test can poll it repeatedly.
    fn write_future(
        gate: &DataMaintenanceGate,
    ) -> Pin<Box<dyn Future<Output = DataWritePermit> + Send + '_>> {
        Box::pin(gate.write_permit())
    }

    /// Verifies that many ordinary mutations may hold shared admission at once.
    #[test]
    fn concurrent_read_permits_are_admitted() {
        let gate = DataMaintenanceGate::new();

        let mut first = read_future(&gate);
        let mut second = read_future(&gate);

        let first_permit = match poll_once(&mut first) {
            Poll::Ready(permit) => permit,
            Poll::Pending => panic!("the first read permit should be admitted immediately"),
        };
        let second_permit = match poll_once(&mut second) {
            Poll::Ready(permit) => permit,
            Poll::Pending => panic!("a concurrent read permit should also be admitted"),
        };

        drop((first_permit, second_permit));
    }

    /// Verifies that a maintenance write permit excludes every ordinary mutation.
    #[test]
    fn write_permit_excludes_reads_until_released() {
        let gate = DataMaintenanceGate::new();
        let mut writer = write_future(&gate);
        let write_permit = match poll_once(&mut writer) {
            Poll::Ready(permit) => permit,
            Poll::Pending => panic!("an idle gate should admit the write permit"),
        };

        let mut blocked_reader = read_future(&gate);
        assert!(poll_once(&mut blocked_reader).is_pending());

        drop(write_permit);
        assert!(poll_once(&mut blocked_reader).is_ready());
    }

    /// Verifies that a queued writer stops new readers from starving maintenance.
    #[test]
    fn queued_writer_blocks_new_readers() {
        let gate = DataMaintenanceGate::new();
        let mut active_reader = read_future(&gate);
        let active_permit = match poll_once(&mut active_reader) {
            Poll::Ready(permit) => permit,
            Poll::Pending => panic!("an idle gate should admit the first read permit"),
        };

        // Registering the writer before the late reader proves admission is not read-biased.
        let mut writer = write_future(&gate);
        assert!(poll_once(&mut writer).is_pending());
        let mut late_reader = read_future(&gate);
        assert!(poll_once(&mut late_reader).is_pending());

        drop(active_permit);
        let write_permit = match poll_once(&mut writer) {
            Poll::Ready(permit) => permit,
            Poll::Pending => panic!("the queued writer should be admitted after the reader exits"),
        };
        assert!(poll_once(&mut late_reader).is_pending());

        drop(write_permit);
        assert!(poll_once(&mut late_reader).is_ready());
    }

    /// Verifies that every clone of the gate shares one admission state.
    #[test]
    fn cloned_gate_shares_admission_state() {
        let gate = DataMaintenanceGate::new();
        let clone = gate.clone();

        assert!(gate.shares_state_with(&clone));
        assert!(!gate.shares_state_with(&DataMaintenanceGate::new()));

        let mut writer = write_future(&clone);
        let write_permit = match poll_once(&mut writer) {
            Poll::Ready(permit) => permit,
            Poll::Pending => panic!("the cloned gate should admit the write permit"),
        };
        let mut reader = read_future(&gate);
        assert!(poll_once(&mut reader).is_pending());

        drop(write_permit);
        assert!(poll_once(&mut reader).is_ready());
    }
}
