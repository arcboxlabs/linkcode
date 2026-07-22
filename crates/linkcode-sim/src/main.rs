//! `linkcode-sim`: the Link Code iOS Simulator host (P0 — public `simctl` only).
//!
//! One long-lived process the daemon spawns; it serves simulator RPCs over a framed stdio
//! protocol (see [`proto`]). Requests arrive on stdin; results go to stdout. Each request runs
//! on its own thread so a slow boot never blocks a screenshot.

mod capture;
mod interactive;
#[cfg(target_os = "macos")]
mod private;
mod proto;
mod rpc;
mod simctl;

use std::io::{self, BufReader, Write};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// How long shutdown waits for in-flight request workers to finish before abandoning them.
const SHUTDOWN_DRAIN: Duration = Duration::from_secs(3);

use crate::proto::{
    MAX_FRAME_LEN, REQUEST, RESULT, SCREENSHOT, encode_screenshot, read_frame, write_frame,
};
use crate::rpc::{ErrorCode, Op, OpError, Request, RequestIdOnly, error_body, success_body};

/// A frame bound for the daemon, or the sentinel that tells the writer thread to stop.
pub(crate) enum OutMsg {
    Frame { type_byte: u8, body: Vec<u8> },
    Stop,
}

/// Cap on concurrent request workers. A slow simctl op (a boot waits up to 180s) holds its worker
/// thread and an `xcrun` child the whole time, so spawning one per request unbounded lets a retry
/// burst exhaust the process's threads and file descriptors; over-cap requests park the read loop
/// until a worker frees a slot (backpressure to the daemon).
const MAX_INFLIGHT: usize = 24;

/// A counting gate bounding concurrent request workers (see [`MAX_INFLIGHT`]).
struct InflightGate {
    count: Mutex<usize>,
    freed: Condvar,
    max: usize,
}

impl InflightGate {
    fn new(max: usize) -> Self {
        Self {
            count: Mutex::new(0),
            freed: Condvar::new(),
            max,
        }
    }
    /// Block until a worker slot is free, then take it.
    fn acquire(&self) {
        let mut count = self.count.lock().expect("inflight gate poisoned");
        while *count >= self.max {
            count = self.freed.wait(count).expect("inflight gate poisoned");
        }
        *count += 1;
    }
    /// Return a slot and wake one waiter.
    fn release(&self) {
        *self.count.lock().expect("inflight gate poisoned") -= 1;
        self.freed.notify_one();
    }
    /// Wait up to `timeout` for every worker to finish (best-effort shutdown drain).
    fn wait_idle(&self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        let mut count = self.count.lock().expect("inflight gate poisoned");
        while *count > 0 {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            let (guard, timed_out) = self
                .freed
                .wait_timeout(count, remaining)
                .expect("inflight gate poisoned");
            count = guard;
            if timed_out.timed_out() {
                break;
            }
        }
    }
}

fn main() {
    let subcommand = std::env::args().nth(1);
    // The crash-isolated framebuffer capture worker (spawned by the sidecar itself).
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("capture-worker") {
        capture::run_worker();
    }
    // Hidden diagnostic path to exercise the private-framework layer against a real booted device:
    // `linkcode-sim diag-interactive <udid> <out.jpg>`.
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("diag-interactive") {
        diag_interactive();
        return;
    }
    // Benchmark the JPEG encode ceiling (the capture stream's single-thread frame-rate bound):
    // `linkcode-sim bench-encode [iters]`. No simulator needed.
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("bench-encode") {
        bench_encode();
        return;
    }

    let (tx, rx) = channel::<OutMsg>();

    // Sole stdout owner: serializes frames from every request thread.
    let writer = thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        while let Ok(OutMsg::Frame { type_byte, body }) = rx.recv() {
            match write_frame(&mut stdout, type_byte, &body) {
                Ok(()) => {}
                // An over-limit body is one bad frame, not a dead pipe: drop it and keep the writer
                // alive so later responses still reach the daemon. The request that produced an
                // oversized screenshot already gets a RESULT error from the guard in `serve`, so in
                // practice this only backstops a future unbounded body.
                Err(e) if e.kind() == io::ErrorKind::InvalidInput => {
                    eprintln!("dropping oversized frame ({} bytes)", body.len());
                }
                // A real write failure means the daemon is gone; frames have nowhere to go.
                Err(_) => break,
            }
        }
        let _ = stdout.flush();
    });

    let gate = Arc::new(InflightGate::new(MAX_INFLIGHT));
    let mut stdin = BufReader::new(io::stdin());
    loop {
        let (type_byte, body) = match read_frame(&mut stdin) {
            Ok(Some(frame)) => frame,
            // Clean end-of-stream: the daemon closed the pipe.
            Ok(None) => break,
            // A truncated/corrupt frame is distinct from a graceful close — surface it before exiting.
            Err(err) => {
                eprintln!("sim protocol read error: {err}");
                break;
            }
        };
        if type_byte != REQUEST {
            continue;
        }
        match serde_json::from_slice::<Request>(&body) {
            Ok(request) => {
                gate.acquire();
                let tx = tx.clone();
                let gate = Arc::clone(&gate);
                thread::spawn(move || {
                    serve(request, &tx);
                    gate.release();
                });
            }
            Err(err) => {
                eprintln!("invalid REQUEST frame: {err}");
                // Fail only this request (recover its id if we can); never kill the whole host.
                match serde_json::from_slice::<RequestIdOnly>(&body) {
                    Ok(id) => send_error(
                        &tx,
                        &id.request_id,
                        &OpError::new(ErrorCode::InvalidRequest, err.to_string()),
                    ),
                    // No requestId to reply against — the daemon's pending request is reclaimed
                    // by its own timeout (see PROTOCOL.md).
                    Err(_) => eprintln!(
                        "REQUEST frame has no recoverable requestId; the daemon's pending request for it will time out"
                    ),
                }
            }
        }
    }

    // On stdin EOF, let quick in-flight requests finish so their responses flush and their `xcrun`
    // children exit, rather than orphaning them — but cap the wait: a mid-boot `bootstatus` can run
    // for minutes, and that device keeps booting server-side in CoreSimulatorService whether or not
    // our child lives to see it, so past the drain we abandon the rest.
    gate.wait_idle(SHUTDOWN_DRAIN);
    let _ = tx.send(OutMsg::Stop);
    let _ = writer.join();
}

/// Run one request to completion and send its RESULT (and, for screenshots, the image frame).
fn serve(request: Request, tx: &Sender<OutMsg>) {
    let request_id = request.request_id;
    let outcome = match request.op {
        Op::Probe => probe_with_capabilities(),
        Op::List => simctl::list(),
        Op::Boot { udid } => simctl::boot(&udid),
        Op::Shutdown { udid } => simctl::shutdown(&udid),
        Op::Install { udid, app_path } => simctl::install(&udid, &app_path),
        Op::Launch { udid, bundle_id } => simctl::launch(&udid, &bundle_id),
        Op::Terminate { udid, bundle_id } => simctl::terminate(&udid, &bundle_id),
        Op::OpenUrl { udid, url } => simctl::open_url(&udid, &url),
        Op::Screenshot { udid, format } => {
            match simctl::screenshot(&udid, format).and_then(|image| {
                // Guard the frame budget here so an over-limit capture (a high-entropy iPad screen
                // can exceed it) fails just this request instead of the sole writer thread — which
                // would tear down and silently drop every later response. Frame overhead is the type
                // byte + the u16 id length + the request id (see `encode_screenshot`/`write_frame`).
                if image.len() + request_id.len() + 3 > MAX_FRAME_LEN {
                    return Err(OpError::new(
                        ErrorCode::SimctlFailed,
                        format!(
                            "screenshot is {} bytes, over the {MAX_FRAME_LEN}-byte frame limit",
                            image.len()
                        ),
                    ));
                }
                encode_screenshot(&request_id, &image)
                    .map_err(|e| OpError::new(ErrorCode::Io, e.to_string()))
            }) {
                Ok(body) => {
                    send(tx, SCREENSHOT, body);
                    return;
                }
                Err(e) => Err(e),
            }
        }
        Op::Tap { udid, x, y } => interactive::tap(&udid, x, y),
        Op::Swipe {
            udid,
            x0,
            y0,
            x1,
            y1,
            duration_ms,
        } => interactive::swipe(&udid, x0, y0, x1, y1, duration_ms),
        Op::Button { udid, button } => interactive::button(&udid, button),
        Op::StreamStart {
            udid,
            fps,
            quality,
            scale,
        } => interactive::stream_start(&udid, fps, quality, scale, tx),
        Op::StreamStop { udid } => interactive::stream_stop(&udid),
    };
    match outcome {
        Ok(result) => send(tx, RESULT, success_body(&request_id, result)),
        Err(error) => send_error(tx, &request_id, &error),
    }
}

/// The probe result augmented with the interactive (private-API framebuffer + HID) capability bit.
fn probe_with_capabilities() -> Result<serde_json::Value, OpError> {
    let mut result = simctl::probe()?;
    if let Some(object) = result.as_object_mut() {
        object.insert("interactive".to_owned(), interactive::available().into());
    }
    Ok(result)
}

fn send(tx: &Sender<OutMsg>, type_byte: u8, body: Vec<u8>) {
    let _ = tx.send(OutMsg::Frame { type_byte, body });
}

fn send_error(tx: &Sender<OutMsg>, request_id: &str, error: &OpError) {
    send(tx, RESULT, error_body(request_id, error));
}

/// Diagnostic entry (macOS only): drive the SUPERVISED capture stream (crash-isolated worker) plus
/// input injection against a real device. `linkcode-sim diag-interactive <udid> <out.jpg> [x] [y]`.
/// Verifies the stream survives worker crashes and keeps delivering frames.
#[cfg(target_os = "macos")]
fn diag_interactive() {
    use std::time::Duration;
    let udid = std::env::args()
        .nth(2)
        .expect("usage: diag-interactive <udid> <out.jpg>");
    let out = std::env::args()
        .nth(3)
        .unwrap_or_else(|| "diag.jpg".to_owned());
    let x: f64 = std::env::args()
        .nth(4)
        .and_then(|a| a.parse().ok())
        .unwrap_or(0.5);
    let y: f64 = std::env::args()
        .nth(5)
        .and_then(|a| a.parse().ok())
        .unwrap_or(0.5);
    eprintln!(
        "interactive available: {}",
        private::interactive_available()
    );

    let device = private::SimDevice::resolve(&udid).expect("device not found");
    let input = private::Input::warm(&device).expect("HID warm failed");
    let stream = capture::CaptureStream::start(
        udid.clone(),
        capture::StreamParams {
            fps: 12,
            quality: 0.6,
            scale: 1.0,
        },
    );
    eprintln!("supervised capture stream started; driving input for ~5s");

    let start = std::time::Instant::now();
    let mut frames = 0u32;
    let mut last_len = 0usize;
    while start.elapsed() < Duration::from_secs(5) && !stream.is_dead() {
        input.tap(x, y, Duration::from_millis(30));
        if let Some(frame) = stream.latest() {
            frames += 1;
            last_len = frame.len();
            std::fs::write(&out, &**frame).expect("write jpeg");
        }
        std::thread::sleep(Duration::from_millis(80));
    }
    eprintln!(
        "stream dead={} frames-seen={frames} last={last_len} bytes; wrote {out}",
        stream.is_dead()
    );
}

/// Benchmark entry (macOS only): time the JPEG encode across a resolution/quality sweep and print the
/// implied max frame rate. `linkcode-sim bench-encode [iters]` (default 120). The encode runs on one
/// reader thread, so `1000 / avg_ms` is the sustainable stream ceiling; the capture memcpy runs on a
/// separate thread and is not the bound.
#[cfg(target_os = "macos")]
fn bench_encode() {
    let iters: u32 = std::env::args()
        .nth(2)
        .and_then(|a| a.parse().ok())
        .unwrap_or(120);
    // Native iPhone 17 Pro framebuffer is 1206×2622; sweep it and progressive downscales at the
    // default stream quality, then the same full res at a lower quality to show quality is not the
    // bound.
    let configs = [
        (1206usize, 2622usize, 0.6f64),
        (904, 1966, 0.6),
        (603, 1311, 0.6),
        (402, 874, 0.6),
        (1206, 2622, 0.3),
    ];
    println!(
        "encode bench — {iters} iters/config (single reader thread = stream fps ceiling)\n{:>11}  {:>5}  {:>8}  {:>8}  {:>7}  {:>9}  {:>8}",
        "resolution", "q", "avg ms", "p95 ms", "size", "fps(avg)", "fps(peak)"
    );
    for (w, h, q) in configs {
        match private::bench_encode(w, h, q, iters) {
            Some(b) => println!(
                "{:>4}x{:<6}  {:>5.2}  {:>8.2}  {:>8.2}  {:>6}K  {:>9.1}  {:>8.1}",
                b.width,
                b.height,
                b.quality,
                b.avg_ms,
                b.p95_ms,
                b.out_kib,
                b.fps(),
                b.peak_fps()
            ),
            None => println!("{w}x{h} q{q}: encode failed"),
        }
    }
}
