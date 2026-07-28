//! Per-terminal read-credit gate.
//!
//! The daemon grants byte budgets (`OPEN.credit`, then incremental `CREDIT` frames); the
//! terminal's reader thread parks once the budget is exhausted. A parked reader stops draining
//! the PTY, the kernel PTY buffer fills, and the child's writes block — restoring end-to-end
//! backpressure all the way into the flooding process.

use std::sync::{Condvar, Mutex};

/// Byte budget for one terminal's PTY reads.
///
/// `None` means unthrottled: either the daemon never sent a credit (a pre-credit daemon) or the
/// terminal is draining to EOF after close/shutdown. The reader thread is the only consumer;
/// grants and releases may come from any thread.
pub struct Credit {
    remaining: Mutex<Option<u64>>,
    granted: Condvar,
}

impl Credit {
    /// A gate starting with `initial` bytes of budget, or unthrottled when `None`.
    pub fn new(initial: Option<u64>) -> Self {
        Self {
            remaining: Mutex::new(initial),
            granted: Condvar::new(),
        }
    }

    /// Block until some budget is available, then return how much may be read (at most `max`,
    /// never 0 for `max > 0`). Unthrottled gates return `max` immediately.
    pub fn acquire(&self, max: usize) -> usize {
        let mut remaining = self.remaining.lock().expect("credit mutex poisoned");
        loop {
            match *remaining {
                None => return max,
                Some(0) => {
                    remaining = self.granted.wait(remaining).expect("credit mutex poisoned");
                }
                Some(budget) => return usize::try_from(budget).unwrap_or(usize::MAX).min(max),
            }
        }
    }

    /// Consume `n` bytes actually read. Saturating: a concurrent `release` may have lifted the
    /// budget between `acquire` and here.
    pub fn consume(&self, n: usize) {
        let mut remaining = self.remaining.lock().expect("credit mutex poisoned");
        if let Some(budget) = *remaining {
            *remaining = Some(budget.saturating_sub(n as u64));
        }
    }

    /// Add daemon-granted budget and wake a parked reader. No-op on an unthrottled gate.
    pub fn grant(&self, bytes: u64) {
        let mut remaining = self.remaining.lock().expect("credit mutex poisoned");
        if let Some(budget) = *remaining {
            *remaining = Some(budget.saturating_add(bytes));
            self.granted.notify_all();
        }
    }

    /// Lift throttling permanently (close/shutdown drain) and wake a parked reader.
    pub fn release(&self) {
        let mut remaining = self.remaining.lock().expect("credit mutex poisoned");
        *remaining = None;
        self.granted.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::mpsc::channel;
    use std::thread;
    use std::time::Duration;

    use super::*;

    #[test]
    fn unthrottled_gates_pass_through() {
        let credit = Credit::new(None);
        assert_eq!(credit.acquire(4096), 4096);
        credit.consume(4096);
        assert_eq!(credit.acquire(4096), 4096);
    }

    #[test]
    fn acquire_clamps_to_the_remaining_budget() {
        let credit = Credit::new(Some(100));
        assert_eq!(credit.acquire(4096), 100);
        credit.consume(60);
        assert_eq!(credit.acquire(4096), 40);
        assert_eq!(credit.acquire(16), 16);
    }

    #[test]
    fn grant_unparks_an_exhausted_reader() {
        let credit = Arc::new(Credit::new(Some(10)));
        credit.consume(10);

        let (tx, rx) = channel();
        let parked = Arc::clone(&credit);
        thread::spawn(move || {
            tx.send(parked.acquire(4096)).unwrap();
        });
        assert!(
            rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "reader should park on an exhausted budget"
        );

        credit.grant(64);
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 64);
    }

    #[test]
    fn release_unparks_to_unthrottled() {
        let credit = Arc::new(Credit::new(Some(0)));
        let (tx, rx) = channel();
        let parked = Arc::clone(&credit);
        thread::spawn(move || {
            tx.send(parked.acquire(4096)).unwrap();
        });

        credit.release();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 4096);
        // Grants after release must not re-arm throttling.
        credit.grant(1);
        assert_eq!(credit.acquire(4096), 4096);
    }
}
