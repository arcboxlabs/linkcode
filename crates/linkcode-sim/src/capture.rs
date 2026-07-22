//! Crash-isolated framebuffer streaming.
//!
//! The steady-state framebuffer path (see [`crate::private::screen`]) is stable, but the private
//! frameworks can still abort hard in ways that are not catchable in-process — most of all a cold
//! CoreSimulator XPC connection racing class registration ("Attempt to use unknown class", a
//! `SIGABRT`). Rather than let that take down the sidecar (which also serves the simctl lifecycle
//! RPCs), the capture runs in a disposable **worker subprocess**: the sidecar spawns
//! `linkcode-sim capture-worker <udid> <quality> <fps>`, reads length-prefixed JPEG frames from its
//! stdout, and respawns it with backoff if it dies. Input injection and lifecycle RPCs stay in the
//! parent and are never affected by a capture crash.
//!
//! This is the standard isolation pattern for fragile native code (GPU/plugin sandboxes): contain
//! the crash, supervise, recover — defense in depth around a path that is now stable in steady state.

use std::io::{self, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// One framebuffer JPEG frame.
pub type Frame = Arc<Vec<u8>>;

/// A drift-free, precise frame pacer (macOS). It advances an absolute deadline by a fixed interval
/// each tick and waits to it with `mach_wait_until`, whose accuracy is well under a millisecond.
/// `thread::sleep` on macOS coalesces timers and overshoots by several ms — enough that even a
/// deadline loop built on it caps 60 fps near 55. `mach_wait_until` does not busy-spin, so locking to
/// the target rate costs no CPU beyond encoding the frames themselves. Times are in mach ticks.
#[cfg(target_os = "macos")]
pub(crate) struct FrameClock {
    interval_ticks: u64,
    next: u64,
}

#[cfg(target_os = "macos")]
impl FrameClock {
    pub(crate) fn new(fps: u32) -> FrameClock {
        let interval_ns = 1_000_000_000u64 / u64::from(fps.max(1));
        FrameClock {
            interval_ticks: mach_time::ns_to_ticks(interval_ns),
            next: mach_time::now(),
        }
    }

    /// Wait until the next frame deadline. If a stall put us more than a full frame behind, resync to
    /// now instead of emitting a catch-up burst of duplicate frames.
    pub(crate) fn tick(&mut self) {
        self.next = self.next.wrapping_add(self.interval_ticks);
        let now = mach_time::now();
        if self.next > now {
            mach_time::wait_until(self.next);
        } else if now - self.next > self.interval_ticks {
            self.next = now;
        }
    }
}

/// Minimal `mach_absolute_time` timebase wrappers for precise pacing (see [`FrameClock`]).
#[cfg(target_os = "macos")]
mod mach_time {
    use std::sync::OnceLock;

    #[repr(C)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }

    unsafe extern "C" {
        fn mach_absolute_time() -> u64;
        fn mach_wait_until(deadline: u64) -> i32;
        fn mach_timebase_info(info: *mut Timebase) -> i32;
    }

    /// `(numer, denom)`: mach ticks → nanoseconds is `ticks * numer / denom`. Constant per boot.
    fn timebase() -> (u64, u64) {
        static TB: OnceLock<(u64, u64)> = OnceLock::new();
        *TB.get_or_init(|| {
            let mut tb = Timebase { numer: 0, denom: 0 };
            // SAFETY: fills a valid out-param; returns KERN_SUCCESS with a nonzero denom on macOS.
            unsafe { mach_timebase_info(&mut tb) };
            (u64::from(tb.numer.max(1)), u64::from(tb.denom.max(1)))
        })
    }

    pub(super) fn now() -> u64 {
        // SAFETY: reads the monotonic mach clock; no preconditions.
        unsafe { mach_absolute_time() }
    }

    pub(super) fn ns_to_ticks(ns: u64) -> u64 {
        let (numer, denom) = timebase();
        (u128::from(ns) * u128::from(denom) / u128::from(numer)) as u64
    }

    pub(super) fn wait_until(deadline_ticks: u64) {
        // SAFETY: blocks the calling thread until the absolute mach-time deadline.
        unsafe { mach_wait_until(deadline_ticks) };
    }
}

/// Largest accepted worker frame (a JPEG at simulator resolution is well under this).
const MAX_WORKER_FRAME: usize = 32 * 1024 * 1024;
/// Backoff between worker respawns after a crash.
const RESPAWN_BACKOFF: Duration = Duration::from_millis(500);
/// A worker that lived at least this long resets the crash-loop counter.
const HEALTHY_AFTER: Duration = Duration::from_secs(5);
/// Consecutive fast crashes before the stream gives up and reports unavailable.
const MAX_FAST_CRASHES: u32 = 6;

/// Encoder/pacing parameters for a capture stream, threaded from `streamStart` down to the worker
/// (and across the process boundary as CLI args). Clamping happens at the boundary, not here.
#[derive(Clone, Copy)]
pub struct StreamParams {
    pub fps: u32,
    pub quality: f64,
    /// Downscale factor applied before JPEG encode (0..1; 1.0 = native resolution).
    pub scale: f64,
}

/// A supervised framebuffer stream for one device. Holds the latest delivered frame; the worker
/// subprocess is spawned, read, and respawned by a background manager thread.
pub struct CaptureStream {
    latest: Arc<Mutex<Option<Frame>>>,
    stopped: Arc<AtomicBool>,
    /// Set true once the manager gives up after a crash loop, so callers can degrade.
    dead: Arc<AtomicBool>,
    manager: Option<thread::JoinHandle<()>>,
}

impl CaptureStream {
    /// Start streaming device `udid` with `params` by supervising a capture worker.
    pub fn start(udid: String, params: StreamParams) -> CaptureStream {
        let latest = Arc::new(Mutex::new(None));
        let stopped = Arc::new(AtomicBool::new(false));
        let dead = Arc::new(AtomicBool::new(false));
        let manager = thread::spawn({
            let latest = Arc::clone(&latest);
            let stopped = Arc::clone(&stopped);
            let dead = Arc::clone(&dead);
            move || supervise(&udid, params, &latest, &stopped, &dead)
        });
        CaptureStream {
            latest,
            stopped,
            dead,
            manager: Some(manager),
        }
    }

    /// The most recently delivered frame, or `None` before the first frame (or once dead).
    pub fn latest(&self) -> Option<Frame> {
        self.latest
            .lock()
            .expect("capture stream mutex poisoned")
            .clone()
    }

    /// Whether the worker crash-looped and the stream gave up.
    pub fn is_dead(&self) -> bool {
        self.dead.load(Ordering::Relaxed)
    }
}

impl Drop for CaptureStream {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        if let Some(manager) = self.manager.take() {
            let _ = manager.join();
        }
    }
}

/// Manager loop: (re)spawn the worker, pump its frames, back off and retry on crash, give up after
/// too many fast crashes.
fn supervise(
    udid: &str,
    params: StreamParams,
    latest: &Arc<Mutex<Option<Frame>>>,
    stopped: &Arc<AtomicBool>,
    dead: &Arc<AtomicBool>,
) {
    let mut fast_crashes = 0u32;
    while !stopped.load(Ordering::Relaxed) {
        let started = Instant::now();
        match spawn_worker(udid, params) {
            Ok(mut child) => {
                pump_worker(&mut child, latest, stopped);
                let _ = child.wait();
            }
            Err(err) => {
                eprintln!("sim capture: failed to spawn worker: {err}");
            }
        }
        if stopped.load(Ordering::Relaxed) {
            break;
        }
        // A worker that ran a while then died (device shut down, transient crash) is not a loop.
        fast_crashes = if started.elapsed() < HEALTHY_AFTER {
            fast_crashes + 1
        } else {
            0
        };
        if fast_crashes >= MAX_FAST_CRASHES {
            eprintln!("sim capture: worker keeps crashing; giving up on {udid}");
            dead.store(true, Ordering::Relaxed);
            break;
        }
        thread::sleep(RESPAWN_BACKOFF);
    }
}

fn spawn_worker(udid: &str, params: StreamParams) -> io::Result<Child> {
    let exe = std::env::current_exe()?;
    Command::new(exe)
        .arg("capture-worker")
        .arg(udid)
        .arg(format!("{}", params.quality))
        .arg(format!("{}", params.fps))
        .arg(format!("{}", params.scale))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
}

/// Read length-prefixed JPEG frames from the worker until EOF (worker exit/crash) or stop.
fn pump_worker(child: &mut Child, latest: &Arc<Mutex<Option<Frame>>>, stopped: &Arc<AtomicBool>) {
    let Some(stdout) = child.stdout.take() else {
        return;
    };
    let mut reader = io::BufReader::new(stdout);
    let mut header = [0u8; 4];
    while !stopped.load(Ordering::Relaxed) {
        if reader.read_exact(&mut header).is_err() {
            break; // worker gone
        }
        let len = u32::from_le_bytes(header) as usize;
        if len == 0 || len > MAX_WORKER_FRAME {
            break; // corrupt stream
        }
        let mut frame = vec![0u8; len];
        if reader.read_exact(&mut frame).is_err() {
            break;
        }
        *latest.lock().expect("capture stream mutex poisoned") = Some(Arc::new(frame));
    }
}

/// The worker entry point (`linkcode-sim capture-worker <udid> <quality> <fps> <scale>`): open the
/// device's framebuffer and stream length-prefixed JPEG frames to stdout at `fps`, each downscaled by
/// `scale`. Exits non-zero on any failure; the parent respawns. A hard `SIGABRT` from the private
/// path also just ends this process.
#[cfg(target_os = "macos")]
pub fn run_worker() -> ! {
    use crate::private::{Screen, SimDevice};

    let mut args = std::env::args().skip(2);
    let udid = args.next().unwrap_or_default();
    let quality: f64 = args.next().and_then(|a| a.parse().ok()).unwrap_or(0.6);
    let fps: u32 = args
        .next()
        .and_then(|a| a.parse().ok())
        .unwrap_or(60)
        .clamp(1, 60);
    let scale: f64 = args
        .next()
        .and_then(|a| a.parse::<f64>().ok())
        .unwrap_or(1.0)
        .clamp(0.1, 1.0);

    let Some(device) = SimDevice::resolve(&udid) else {
        eprintln!("sim capture-worker: device {udid} not found");
        std::process::exit(2);
    };
    // Warm the device's CoreSimulator XPC connection before enumerating framebuffer ports: the HID
    // client init establishes it and registers the proxy classes, which otherwise race the cold
    // connection and abort framebuffer open with "unknown class".
    let _warm = crate::private::Input::warm(&device);
    let Some(screen) = Screen::open(&device) else {
        eprintln!("sim capture-worker: no framebuffer for {udid}");
        std::process::exit(3);
    };

    let mut clock = FrameClock::new(fps);
    let mut stdout = io::stdout().lock();
    loop {
        if let Some(jpeg) = screen.capture_jpeg(quality, scale) {
            let len = u32::try_from(jpeg.len()).unwrap_or(0);
            if len == 0
                || stdout.write_all(&len.to_le_bytes()).is_err()
                || stdout.write_all(&jpeg).is_err()
                || stdout.flush().is_err()
            {
                break; // parent closed the pipe
            }
        }
        clock.tick();
    }
    std::process::exit(0);
}
