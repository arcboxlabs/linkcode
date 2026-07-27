//! `linkcode-sim`: the Link Code iOS Simulator host (P0 — public `simctl` only).
//!
//! One long-lived process the daemon spawns; it serves simulator RPCs over a framed stdio
//! protocol (see [`proto`]). Requests arrive on stdin; results go to stdout. Each request runs
//! on its own thread so a slow boot never blocks a screenshot.

// The framebuffer-capture and HID surface is macOS-only (its consumers are behind
// `#[cfg(target_os = "macos")]`), so on other targets the streaming machinery, its imports, and the
// diag-dispatch locals are unreachable — don't fail the `-D warnings` lint on that expected slack.
#![cfg_attr(
    not(target_os = "macos"),
    allow(dead_code, unused_imports, unused_variables)
)]

mod capture;
mod interactive;
mod mask;
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
    // The crash-isolated device-state watcher (spawned by the sidecar alongside each stream).
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("state-watcher") {
        let udid = std::env::args()
            .nth(2)
            .expect("usage: state-watcher <udid>");
        std::process::exit(private::notify::run_state_watcher(&udid));
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
    // Diagnostic: render a device's screen mask to a PNG file: `linkcode-sim diag-mask <udid> [out]`.
    if subcommand.as_deref() == Some("diag-mask") {
        diag_mask();
        return;
    }
    // Diagnostic: inject an orientation change: `linkcode-sim diag-rotate <udid> <orientation>`.
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("diag-rotate") {
        diag_rotate();
        return;
    }
    // Diagnostic: prove a live reconfigure retunes the stream without respawning the worker:
    // `linkcode-sim diag-reconfigure <udid>`.
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("diag-reconfigure") {
        diag_reconfigure();
        return;
    }
    // Diagnostic: press a hardware button, for eyeballing the volume HUD against a real device:
    // `linkcode-sim diag-button <udid> <home|lock|volume-up|volume-down>`.
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("diag-button") {
        diag_button();
        return;
    }
    // Diagnostic: report CoreSimulator's view of a device's boot state — the signal the stream
    // pusher uses to reap a dead boot session: `linkcode-sim diag-state <udid>`.
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("diag-state") {
        diag_state();
        return;
    }
    // Diagnostic: prove the AXPTranslator bridge-token handshake reaches the guest's accessibility
    // service: `linkcode-sim diag-ax <udid>`.
    #[cfg(target_os = "macos")]
    if subcommand.as_deref() == Some("diag-ax") {
        diag_ax();
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
                // Touch phases and key presses must keep stdio order — a per-request thread would
                // race a gesture's down/move/up or reorder typed characters. Each is a handful of
                // fast HID sends, so inline handling is cheap and stays off the inflight gate.
                if matches!(
                    request.op,
                    Op::Touch { .. } | Op::Pinch { .. } | Op::Key { .. }
                ) {
                    serve(request, &tx);
                } else {
                    gate.acquire();
                    let tx = tx.clone();
                    let gate = Arc::clone(&gate);
                    thread::spawn(move || {
                        serve(request, &tx);
                        gate.release();
                    });
                }
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
        // Both ends of a boot session invalidate the warmed HID client bound to the old one.
        Op::Boot { udid } => {
            interactive::forget(&udid);
            simctl::boot(&udid)
        }
        Op::Shutdown { udid } => {
            interactive::forget(&udid);
            simctl::shutdown(&udid)
        }
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
        Op::ScreenMask { udid } => {
            match mask::screen_mask(&udid).and_then(|image| {
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
        Op::Touch { udid, phase, x, y } => interactive::touch(&udid, phase, x, y),
        Op::Pinch {
            udid,
            phase,
            x0,
            y0,
            x1,
            y1,
        } => interactive::pinch(&udid, phase, (x0, y0), (x1, y1)),
        Op::Paste { udid, text } => simctl::set_pasteboard(&udid, &text),
        Op::Swipe {
            udid,
            x0,
            y0,
            x1,
            y1,
            duration_ms,
        } => interactive::swipe(&udid, x0, y0, x1, y1, duration_ms),
        Op::Button { udid, button } => interactive::button(&udid, button),
        Op::Rotate { udid, orientation } => interactive::rotate(&udid, orientation),
        Op::Key {
            udid,
            usage,
            modifiers,
        } => interactive::key(&udid, usage, &modifiers),
        Op::StreamStart {
            udid,
            fps,
            quality,
            scale,
            codec,
        } => interactive::stream_start(&udid, fps, quality, scale, codec, tx),
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

/// Diagnostic entry: render the screen mask for a device to a PNG file.
fn diag_mask() {
    let udid = std::env::args()
        .nth(2)
        .expect("usage: diag-mask <udid> [out.png]");
    let out = std::env::args()
        .nth(3)
        .unwrap_or_else(|| "mask.png".to_owned());
    match mask::screen_mask(&udid) {
        Ok(bytes) => {
            std::fs::write(&out, &bytes).expect("write mask png");
            eprintln!("wrote {} bytes to {out}", bytes.len());
        }
        Err(error) => {
            eprintln!("mask failed: {}", error.message);
            std::process::exit(1);
        }
    }
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
            codec: rpc::StreamCodec::Jpeg,
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

/// Diagnostic (macOS only): prove `CaptureStream::reconfigure` retunes a running stream in place —
/// the worker pid stays the same across a JPEG→H.264 + fps change, and H.264 units start flowing.
/// `linkcode-sim diag-reconfigure <udid>`. Needs a booted device with an active framebuffer.
#[cfg(target_os = "macos")]
fn diag_reconfigure() {
    let udid = std::env::args()
        .nth(2)
        .expect("usage: diag-reconfigure <udid>");
    eprintln!(
        "interactive available: {}",
        private::interactive_available()
    );

    let stream = capture::CaptureStream::start(
        udid.clone(),
        capture::StreamParams {
            fps: 30,
            quality: 0.6,
            scale: 1.0,
            codec: rpc::StreamCodec::Jpeg,
        },
    );

    // JPEG phase: wait for the first frame, then count distinct frames for ~2s.
    let mut jpeg_frames = 0u32;
    let mut last: Option<capture::Frame> = None;
    let phase = Instant::now();
    while phase.elapsed() < Duration::from_secs(3) && !stream.is_dead() {
        if let Some(frame) = stream.latest()
            && last.as_ref().is_none_or(|prev| !Arc::ptr_eq(prev, &frame))
        {
            jpeg_frames += 1;
            last = Some(frame);
        }
        thread::sleep(Duration::from_millis(30));
    }
    let pid_before = stream.worker_pid();
    eprintln!("JPEG @30fps: worker pid={pid_before}, distinct frames≈{jpeg_frames}");

    // Reconfigure to H.264 @15fps — expected to retune in place, no respawn.
    stream.reconfigure(capture::StreamParams {
        fps: 15,
        quality: 0.6,
        scale: 1.0,
        codec: rpc::StreamCodec::H264,
    });
    let mut units = 0u32;
    let mut keyframes = 0u32;
    let phase = Instant::now();
    while phase.elapsed() < Duration::from_secs(3) {
        if let Some(unit) = stream.next_encoded(Duration::from_millis(250)) {
            units += 1;
            if unit.key {
                keyframes += 1;
            }
        }
    }
    let pid_after = stream.worker_pid();
    eprintln!("H.264 @15fps: worker pid={pid_after}, units={units} (keyframes={keyframes})");

    // Downscale live: the encoder is rebuilt at the scaled session size, so units must keep flowing
    // (a VideoToolbox that refused the size mismatch would deliver none).
    stream.reconfigure(capture::StreamParams {
        fps: 15,
        quality: 0.6,
        scale: 0.5,
        codec: rpc::StreamCodec::H264,
    });
    let mut scaled_units = 0u32;
    let phase = Instant::now();
    while phase.elapsed() < Duration::from_secs(3) {
        if stream.next_encoded(Duration::from_millis(250)).is_some() {
            scaled_units += 1;
        }
    }
    let pid_scaled = stream.worker_pid();
    eprintln!("H.264 @15fps scale=0.5: worker pid={pid_scaled}, units={scaled_units}");

    assert_eq!(
        pid_before, pid_after,
        "worker pid changed — reconfigure respawned the worker instead of retuning it"
    );
    assert!(pid_before != 0, "no worker was running to reconfigure");
    assert!(units > 0, "no H.264 units after switching codec live");
    assert_eq!(pid_after, pid_scaled, "rescaling respawned the worker");
    assert!(
        scaled_units > 0,
        "no H.264 units at scale 0.5 — VideoToolbox refused the scaled session"
    );
    eprintln!(
        "PASS: reconfigure retuned in place (pid stable {pid_before}); jpeg→h264 and h264 rescale both live"
    );
}

/// Diagnostic (macOS only): inject an interface-orientation change against a booted device — the
/// spike that decides whether the GraphicsServices `PurpleWorkspacePort` GSEvent path works before
/// it is threaded through the stack. `linkcode-sim diag-rotate <udid> <portrait|portrait-upside-down|
/// landscape-left|landscape-right>`.
#[cfg(target_os = "macos")]
fn diag_rotate() {
    let udid = std::env::args()
        .nth(2)
        .expect("usage: diag-rotate <udid> <orientation>");
    let name = std::env::args()
        .nth(3)
        .unwrap_or_else(|| "landscape-left".to_owned());
    let orientation = match name.as_str() {
        "portrait" => private::Orientation::Portrait,
        "portrait-upside-down" => private::Orientation::PortraitUpsideDown,
        "landscape-left" => private::Orientation::LandscapeLeft,
        "landscape-right" => private::Orientation::LandscapeRight,
        other => panic!("unknown orientation: {other}"),
    };
    let device = private::SimDevice::resolve(&udid).expect("device not found");
    let ok = device.set_orientation(orientation);
    eprintln!("set_orientation({name}) -> {ok}");
}

/// Diagnostic entry (macOS only): press one hardware button on a booted device. Volume is the
/// reason this exists — it is the one button whose only proof is the on-device HUD, and the
/// consumer-page HID path it takes is different from home/lock's legacy button message.
#[cfg(target_os = "macos")]
fn diag_button() {
    use crate::private::Button;
    let udid = std::env::args()
        .nth(2)
        .expect("usage: diag-button <udid> <home|lock|volume-up|volume-down>");
    let name = std::env::args().nth(3).unwrap_or_else(|| "home".to_owned());
    let button = match name.as_str() {
        "home" => Button::Home,
        "lock" => Button::Lock,
        "volume-up" => Button::VolumeUp,
        "volume-down" => Button::VolumeDown,
        other => panic!("unknown button: {other}"),
    };
    let device = private::SimDevice::resolve(&udid).expect("device not found");
    let input = private::Input::warm(&device).expect("HID unavailable for this device");
    let ok = input.button(button, std::time::Duration::from_millis(80));
    eprintln!("button({name}) -> {ok}");
}

/// Diagnostic entry (macOS only): wire the accessibility translator to a booted device and ask it
/// for the frontmost application. This is the whole risk of the a11y-tree work in one command —
/// the bridge-token delegate either reaches the guest's AX service or every query answers nil.
#[cfg(target_os = "macos")]
fn diag_ax() {
    let udid = std::env::args().nth(2).expect("usage: diag-ax <udid>");
    eprintln!("available: {}", private::ax::available());
    let Some(translator) = private::ax::install(&udid) else {
        eprintln!("install failed — no translator (see LINKCODE_SIM_DEBUG=1 for detail)");
        return;
    };
    eprintln!("translator wired, token {:?}", private::ax::token());
    match private::ax::frontmost_application(&translator, 0) {
        Some(app) => {
            // The description is enough to prove the round-trip: a real element prints its class
            // and address, whereas a failed handshake never gets this far.
            let description: *mut objc2_foundation::NSString =
                unsafe { objc2::msg_send![&*app, description] };
            let text = if description.is_null() {
                "<no description>".to_owned()
            } else {
                unsafe { (*description).to_string() }
            };
            eprintln!("frontmostApplication -> {text}");
        }
        None => eprintln!("frontmostApplication -> nil (handshake did not reach the guest)"),
    }
}

/// Diagnostic entry (macOS only): print whether CoreSimulator reports the device Booted — ground
/// truth for the reap-on-shutdown signal in `interactive::push_stream`.
#[cfg(target_os = "macos")]
fn diag_state() {
    let udid = std::env::args().nth(2).expect("usage: diag-state <udid>");
    match private::SimDevice::resolve(&udid) {
        Some(device) => eprintln!("is_booted({udid}) -> {}", device.is_booted()),
        None => eprintln!("device {udid} not found"),
    }
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
