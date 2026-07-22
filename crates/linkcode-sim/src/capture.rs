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

use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::rpc::StreamCodec;

/// One encoded frame payload (JPEG image or H.264 access unit).
pub type Frame = Arc<Vec<u8>>;

/// One H.264 access unit in delivery order. Unlike JPEG frames, deltas must not be dropped
/// individually — a gap desyncs the decoder until the next keyframe.
pub struct EncodedUnit {
    pub data: Frame,
    pub key: bool,
}

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
    /// Downscale factor applied before JPEG encode (0..1; 1.0 = native resolution). H.264 always
    /// encodes at native resolution — bitrate, not resolution, carries its bandwidth budget.
    pub scale: f64,
    pub codec: StreamCodec,
}

/// Bounded H.264 delivery queue. On overflow (a stalled consumer) the whole queue is dropped and
/// delivery resumes at the next keyframe — the only safe resync point.
struct EncodedQueue {
    state: Mutex<QueueState>,
    ready: Condvar,
}

struct QueueState {
    units: VecDeque<EncodedUnit>,
    need_key: bool,
}

/// ~4s at 60 fps before the overflow resync kicks in.
const MAX_QUEUED_UNITS: usize = 240;

impl EncodedQueue {
    fn new() -> EncodedQueue {
        EncodedQueue {
            state: Mutex::new(QueueState {
                units: VecDeque::new(),
                need_key: false,
            }),
            ready: Condvar::new(),
        }
    }

    fn push(&self, data: Vec<u8>, key: bool) {
        let mut state = self.state.lock().expect("encoded queue poisoned");
        if state.need_key {
            if !key {
                return;
            }
            state.need_key = false;
        }
        if state.units.len() >= MAX_QUEUED_UNITS {
            state.units.clear();
            if !key {
                state.need_key = true;
                return;
            }
        }
        state.units.push_back(EncodedUnit {
            data: Arc::new(data),
            key,
        });
        self.ready.notify_one();
    }

    fn pop(&self, timeout: Duration) -> Option<EncodedUnit> {
        let state = self.state.lock().expect("encoded queue poisoned");
        let (mut state, _) = self
            .ready
            .wait_timeout_while(state, timeout, |state| state.units.is_empty())
            .expect("encoded queue poisoned");
        state.units.pop_front()
    }
}

/// A supervised framebuffer stream for one device. JPEG mode holds the latest delivered frame
/// (latest-wins); H.264 mode delivers ordered access units. The worker subprocess is spawned,
/// read, and respawned by a background manager thread.
pub struct CaptureStream {
    latest: Arc<Mutex<Option<Frame>>>,
    encoded: Arc<EncodedQueue>,
    stopped: Arc<AtomicBool>,
    /// Set true once the manager gives up after a crash loop, so callers can degrade.
    dead: Arc<AtomicBool>,
    /// The live worker child's pid (0 = none). Non-zero only while the manager holds the un-reaped
    /// `Child`, so the pid can't be reused — making a kill-on-drop safe to target it.
    worker_pid: Arc<AtomicU32>,
    manager: Option<thread::JoinHandle<()>>,
}

impl CaptureStream {
    /// Start streaming device `udid` with `params` by supervising a capture worker.
    pub fn start(udid: String, params: StreamParams) -> CaptureStream {
        let latest = Arc::new(Mutex::new(None));
        let encoded = Arc::new(EncodedQueue::new());
        let stopped = Arc::new(AtomicBool::new(false));
        let dead = Arc::new(AtomicBool::new(false));
        let worker_pid = Arc::new(AtomicU32::new(0));
        let manager = thread::spawn({
            let latest = Arc::clone(&latest);
            let encoded = Arc::clone(&encoded);
            let stopped = Arc::clone(&stopped);
            let dead = Arc::clone(&dead);
            let worker_pid = Arc::clone(&worker_pid);
            move || supervise(&udid, params, &latest, &encoded, &stopped, &dead, &worker_pid)
        });
        CaptureStream {
            latest,
            encoded,
            stopped,
            dead,
            worker_pid,
            manager: Some(manager),
        }
    }

    /// The most recently delivered JPEG frame, or `None` before the first frame (or once dead).
    pub fn latest(&self) -> Option<Frame> {
        self.latest
            .lock()
            .expect("capture stream mutex poisoned")
            .clone()
    }

    /// The next H.264 access unit in order, waiting up to `timeout` for one to arrive.
    pub fn next_encoded(&self, timeout: Duration) -> Option<EncodedUnit> {
        self.encoded.pop(timeout)
    }

    /// Whether the worker crash-looped and the stream gave up.
    pub fn is_dead(&self) -> bool {
        self.dead.load(Ordering::Relaxed)
    }
}

impl Drop for CaptureStream {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        // The manager may be parked in a blocking `read_exact` on a worker that opened its
        // framebuffer but never wrote a frame (a boot/shutdown transition); `stopped` alone can't
        // wake that read, so kill the worker to close its stdout and let the read return. The pid is
        // non-zero only while the manager holds the un-reaped child, so it can't have been reused.
        let pid = self.worker_pid.load(Ordering::Relaxed);
        if pid != 0 {
            // SAFETY: best-effort SIGKILL to our capture-worker child (or a not-yet-reaped zombie of
            // it); no other process can hold this pid while `worker_pid` is set.
            unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
        }
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
    encoded: &Arc<EncodedQueue>,
    stopped: &Arc<AtomicBool>,
    dead: &Arc<AtomicBool>,
    worker_pid: &Arc<AtomicU32>,
) {
    let mut fast_crashes = 0u32;
    while !stopped.load(Ordering::Relaxed) {
        let started = Instant::now();
        match spawn_worker(udid, params) {
            Ok(mut child) => {
                // Publish the pid before reading so a concurrent drop can kill a stuck worker; clear
                // it only after `wait()` reaps it, keeping the pid unreusable while it is set.
                worker_pid.store(child.id(), Ordering::Relaxed);
                // A drop that set `stopped` between the spawn and the store above may have read pid 0
                // and not killed us; kill the child ourselves so the pump/wait below can't block on
                // a worker that never writes.
                if stopped.load(Ordering::Relaxed) {
                    // SAFETY: our own just-spawned, un-reaped child pid.
                    unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGKILL) };
                }
                pump_worker(&mut child, params.codec, latest, encoded, stopped);
                let _ = child.wait();
                worker_pid.store(0, Ordering::Relaxed);
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
        .arg(params.codec.cli_name())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
}

/// Read `[u32 LE len][u8 flags][payload]` frames from the worker until EOF (worker exit/crash) or
/// stop. JPEG payloads replace the latest slot; H.264 payloads append to the ordered queue.
fn pump_worker(
    child: &mut Child,
    codec: StreamCodec,
    latest: &Arc<Mutex<Option<Frame>>>,
    encoded: &Arc<EncodedQueue>,
    stopped: &Arc<AtomicBool>,
) {
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
        if !(2..=MAX_WORKER_FRAME).contains(&len) {
            break; // corrupt stream
        }
        let mut frame = vec![0u8; len];
        if reader.read_exact(&mut frame).is_err() {
            break;
        }
        let flags = frame[0];
        frame.drain(..1);
        match codec {
            StreamCodec::Jpeg => {
                *latest.lock().expect("capture stream mutex poisoned") = Some(Arc::new(frame));
            }
            StreamCodec::H264 => encoded.push(frame, flags & 1 != 0),
        }
    }
}

/// The worker entry point (`linkcode-sim capture-worker <udid> <quality> <fps> <scale> <codec>`):
/// open the device's framebuffer and stream `[u32 len][u8 flags][payload]` frames to stdout at
/// `fps` — JPEG images (downscaled by `scale`) or H.264 access units (native resolution, encoded
/// straight from the retained `IOSurface` by VideoToolbox). Exits non-zero on any failure; the
/// parent respawns. A hard `SIGABRT` from the private path also just ends this process.
#[cfg(target_os = "macos")]
pub fn run_worker() -> ! {
    use crate::private::{Screen, SimDevice, VtEncoder};

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
    let codec = match args.next().as_deref() {
        Some("h264") => StreamCodec::H264,
        _ => StreamCodec::Jpeg,
    };

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
    match codec {
        StreamCodec::Jpeg => loop {
            if let Some(jpeg) = screen.capture_jpeg(quality, scale)
                && !write_worker_frame(&mut stdout, 1, &jpeg)
            {
                break; // parent closed the pipe
            }
            clock.tick();
        },
        StreamCodec::H264 => {
            // Lazy per-dimension encoder: a rotation changes the surface size mid-stream.
            let mut encoder: Option<(VtEncoder, usize, usize)> = None;
            'stream: loop {
                if let Some(surface) = screen.capture_surface() {
                    let (width, height) = (surface.width(), surface.height());
                    if encoder
                        .as_ref()
                        .is_none_or(|(_, w, h)| *w != width || *h != height)
                    {
                        encoder = VtEncoder::new(width, height, fps).map(|e| (e, width, height));
                        if encoder.is_none() {
                            eprintln!("sim capture-worker: VideoToolbox session failed");
                            std::process::exit(4);
                        }
                    }
                    if let Some((vt, _, _)) = encoder.as_mut() {
                        for unit in vt.encode(&surface) {
                            if !write_worker_frame(&mut stdout, u8::from(unit.key), &unit.data) {
                                break 'stream; // parent closed the pipe
                            }
                        }
                    }
                }
                clock.tick();
            }
        }
    }
    std::process::exit(0);
}

/// Write one `[u32 LE len][u8 flags][payload]` worker frame; false once the parent is gone.
#[cfg(target_os = "macos")]
fn write_worker_frame(stdout: &mut impl Write, flags: u8, payload: &[u8]) -> bool {
    let Ok(len) = u32::try_from(payload.len() + 1) else {
        return false;
    };
    len != 1
        && stdout.write_all(&len.to_le_bytes()).is_ok()
        && stdout.write_all(&[flags]).is_ok()
        && stdout.write_all(payload).is_ok()
        && stdout.flush().is_ok()
}
