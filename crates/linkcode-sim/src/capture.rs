//! Crash-isolated framebuffer streaming.
//!
//! The private-framework framebuffer path (see [`crate::private::screen`]) intermittently aborts
//! hard inside CoreSimulator's XPC-proxy machinery ("Attempt to use unknown class") — a
//! not-in-process-catchable `SIGABRT`. Rather than let that take down the sidecar (which also serves
//! the simctl lifecycle RPCs), the capture runs in a disposable **worker subprocess**: the sidecar
//! spawns `linkcode-sim capture-worker <udid> <quality> <fps>`, reads length-prefixed JPEG frames
//! from its stdout, and respawns it with backoff if it dies. Input injection and lifecycle RPCs stay
//! in the parent and are never affected by a capture crash.
//!
//! This is the standard isolation pattern for fragile native code (GPU/plugin sandboxes): contain
//! the crash, supervise, recover.

use std::io::{self, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// One framebuffer JPEG frame.
pub type Frame = Arc<Vec<u8>>;

/// Largest accepted worker frame (a JPEG at simulator resolution is well under this).
const MAX_WORKER_FRAME: usize = 32 * 1024 * 1024;
/// Backoff between worker respawns after a crash.
const RESPAWN_BACKOFF: Duration = Duration::from_millis(500);
/// A worker that lived at least this long resets the crash-loop counter.
const HEALTHY_AFTER: Duration = Duration::from_secs(5);
/// Consecutive fast crashes before the stream gives up and reports unavailable.
const MAX_FAST_CRASHES: u32 = 6;

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
    /// Start streaming device `udid` at `fps` and JPEG `quality` by supervising a capture worker.
    pub fn start(udid: String, quality: f64, fps: u32) -> CaptureStream {
        let latest = Arc::new(Mutex::new(None));
        let stopped = Arc::new(AtomicBool::new(false));
        let dead = Arc::new(AtomicBool::new(false));
        let manager = thread::spawn({
            let latest = Arc::clone(&latest);
            let stopped = Arc::clone(&stopped);
            let dead = Arc::clone(&dead);
            move || supervise(&udid, quality, fps, &latest, &stopped, &dead)
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
    quality: f64,
    fps: u32,
    latest: &Arc<Mutex<Option<Frame>>>,
    stopped: &Arc<AtomicBool>,
    dead: &Arc<AtomicBool>,
) {
    let mut fast_crashes = 0u32;
    while !stopped.load(Ordering::Relaxed) {
        let started = Instant::now();
        match spawn_worker(udid, quality, fps) {
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

fn spawn_worker(udid: &str, quality: f64, fps: u32) -> io::Result<Child> {
    let exe = std::env::current_exe()?;
    Command::new(exe)
        .arg("capture-worker")
        .arg(udid)
        .arg(format!("{quality}"))
        .arg(format!("{fps}"))
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

/// The worker entry point (`linkcode-sim capture-worker <udid> <quality> <fps>`): open the device's
/// framebuffer and stream length-prefixed JPEG frames to stdout at `fps`. Exits non-zero on any
/// failure; the parent respawns. A hard `SIGABRT` from the private path also just ends this process.
#[cfg(target_os = "macos")]
pub fn run_worker() -> ! {
    use crate::private::{Screen, SimDevice};

    let mut args = std::env::args().skip(2);
    let udid = args.next().unwrap_or_default();
    let quality: f64 = args.next().and_then(|a| a.parse().ok()).unwrap_or(0.6);
    let fps: u32 = args
        .next()
        .and_then(|a| a.parse().ok())
        .unwrap_or(10)
        .clamp(1, 60);

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

    let interval = Duration::from_millis(1000 / u64::from(fps));
    let mut stdout = io::stdout().lock();
    loop {
        let tick = Instant::now();
        if let Some(jpeg) = screen.capture_jpeg(quality) {
            let len = u32::try_from(jpeg.len()).unwrap_or(0);
            if len == 0
                || stdout.write_all(&len.to_le_bytes()).is_err()
                || stdout.write_all(&jpeg).is_err()
                || stdout.flush().is_err()
            {
                break; // parent closed the pipe
            }
        }
        if let Some(rest) = interval.checked_sub(tick.elapsed()) {
            thread::sleep(rest);
        }
    }
    std::process::exit(0);
}
