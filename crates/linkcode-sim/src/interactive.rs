//! The interactive (private-API) op handlers: HID injection and framebuffer streaming.
//!
//! Off macOS, and on a macOS host whose Xcode lacks SimulatorKit, every op fails with a stable
//! `unsupported` error so the daemon gates the capability. On macOS the ops resolve a per-udid
//! warmed HID client (`Input`) and drive taps/swipes/buttons, or start/stop a crash-isolated
//! [`CaptureStream`](crate::capture::CaptureStream) whose frames are pushed to the daemon as
//! `STREAM_FRAME`s.

use std::sync::mpsc::Sender;

use serde_json::{Value, json};

use crate::OutMsg;
use crate::rpc::{ButtonKind, ErrorCode, OpError, RotateOrientation, TouchPhase};

fn unsupported() -> OpError {
    OpError::new(
        ErrorCode::XcodeMissing,
        "interactive simulator control is unavailable on this host",
    )
}

#[cfg(target_os = "macos")]
pub use imp::{
    available, button, forget, key, pinch, rotate, stream_start, stream_stop, swipe, tap, touch,
};

#[cfg(not(target_os = "macos"))]
mod stubs {
    use super::*;

    /// No cached HID client off macOS, so nothing to evict.
    pub fn forget(_udid: &str) {}

    pub fn available() -> bool {
        false
    }
    pub fn tap(_udid: &str, _x: f64, _y: f64) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn touch(_udid: &str, _phase: TouchPhase, _x: f64, _y: f64) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn pinch(
        _udid: &str,
        _phase: TouchPhase,
        _a: (f64, f64),
        _b: (f64, f64),
    ) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn swipe(
        _udid: &str,
        _x0: f64,
        _y0: f64,
        _x1: f64,
        _y1: f64,
        _duration_ms: u64,
    ) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn button(_udid: &str, _button: ButtonKind) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn rotate(_udid: &str, _orientation: RotateOrientation) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn key(_udid: &str, _usage: u32, _modifiers: &[u32]) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn stream_start(
        _udid: &str,
        _fps: u32,
        _quality: f64,
        _scale: f64,
        _codec: crate::rpc::StreamCodec,
        _tx: &Sender<OutMsg>,
    ) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn stream_stop(_udid: &str) -> Result<Value, OpError> {
        Err(unsupported())
    }
}

#[cfg(not(target_os = "macos"))]
pub use stubs::{
    available, button, forget, key, pinch, rotate, stream_start, stream_stop, swipe, tap, touch,
};

#[cfg(target_os = "macos")]
mod imp {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::capture::{CaptureStream, Frame, FrameClock};
    use crate::private::{self, Button, Input, SimDevice};
    use crate::proto::{
        STREAM_FRAME, STREAM_FRAME_H264, encode_stream_frame, encode_stream_frame_h264,
    };
    use crate::rpc::StreamCodec;

    /// A live-but-silent private worker (framebuffer registration produced no callbacks) is treated
    /// as unusable after this long with no new frame, and the pusher degrades to simctl.
    const SILENT_FALLBACK_AFTER: Duration = Duration::from_secs(3);

    /// Warmed HID clients and running streams, keyed by udid. Warming a client is expensive, so it
    /// is cached; a stream is one crash-isolated worker plus a pusher thread.
    struct Registry {
        inputs: HashMap<String, Arc<Input>>,
        streams: HashMap<String, StreamHandle>,
        /// Active streamed-touch identifiers by udid (down allocates, up removes).
        touches: HashMap<String, u32>,
        /// Active two-finger identifiers by udid (pinch streams).
        pinches: HashMap<String, [u32; 2]>,
    }

    struct StreamHandle {
        // Held so the CaptureStream (and its worker) stay alive until the handle is removed; the
        // pusher thread holds the other Arc and stops when `stop` is set.
        #[allow(dead_code, reason = "ownership hold that keeps the stream alive")]
        stream: Arc<CaptureStream>,
        stop: Arc<AtomicBool>,
        pusher: Option<thread::JoinHandle<()>>,
    }

    fn registry() -> &'static Mutex<Registry> {
        static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
        REGISTRY.get_or_init(|| {
            Mutex::new(Registry {
                inputs: HashMap::new(),
                streams: HashMap::new(),
                touches: HashMap::new(),
                pinches: HashMap::new(),
            })
        })
    }

    pub fn available() -> bool {
        private::interactive_available()
    }

    fn to_hid_phase(phase: TouchPhase) -> private::Phase {
        match phase {
            TouchPhase::Down => private::Phase::Down,
            TouchPhase::Move => private::Phase::Move,
            TouchPhase::Up => private::Phase::Up,
        }
    }

    /// Drop the cached HID client and any in-flight gesture state for `udid`.
    ///
    /// A warmed `SimDeviceLegacyHIDClient` is bound to the boot session it was created in. Once the
    /// device shuts down, that client is dead: sends still report success but nothing reaches the
    /// guest, so the panel looks fine while every tap, button and key silently does nothing. Boot
    /// and shutdown are the two moments a new session begins, so both evict — the next use re-warms
    /// against the live device.
    pub fn forget(udid: &str) {
        let mut reg = registry().lock().expect("interactive registry poisoned");
        reg.inputs.remove(udid);
        reg.touches.remove(udid);
        reg.pinches.remove(udid);
    }

    /// Resolve (and cache) a warmed HID client for `udid`.
    fn input_for(udid: &str) -> Result<Arc<Input>, OpError> {
        let mut reg = registry().lock().expect("interactive registry poisoned");
        if let Some(input) = reg.inputs.get(udid) {
            return Ok(Arc::clone(input));
        }
        let device = SimDevice::resolve(udid).ok_or_else(|| {
            OpError::new(ErrorCode::SimctlFailed, format!("device {udid} not found"))
        })?;
        let input = Input::warm(&device).ok_or_else(unsupported).map(Arc::new)?;
        reg.inputs.insert(udid.to_owned(), Arc::clone(&input));
        Ok(input)
    }

    /// Run a discrete injection against the device's HID client, re-warming once if it fails.
    ///
    /// A warmed client is bound to the boot session it was created in, and a device can be shut
    /// down and re-booted behind our back — from Simulator.app, from `simctl`, or by a boot the
    /// engine short-circuited because the host already had the device up. The stale client then
    /// builds no messages, so the failure is indistinguishable from "the device is gone" and the
    /// panel goes dead with every control still looking healthy. Treat the first failure as
    /// possibly-stale: drop the client, warm a fresh one, and try once more. A failed build
    /// injected nothing, so the retry cannot double-send.
    fn with_input(udid: &str, what: &str, op: impl Fn(&Input) -> bool) -> Result<Value, OpError> {
        if op(input_for(udid)?.as_ref()) {
            return Ok(json!({}));
        }
        forget(udid);
        if op(input_for(udid)?.as_ref()) {
            return Ok(json!({}));
        }
        Err(OpError::new(
            ErrorCode::SimctlFailed,
            format!("{what} failed"),
        ))
    }

    pub fn tap(udid: &str, x: f64, y: f64) -> Result<Value, OpError> {
        with_input(udid, "tap", |input| {
            input.tap(x, y, Duration::from_millis(80))
        })
    }

    /// One phase of a streamed touch gesture. A `move`/`up` without an active stream is a benign
    /// race (a duplicate up, a move after cancel) and no-ops successfully.
    pub fn touch(udid: &str, phase: TouchPhase, x: f64, y: f64) -> Result<Value, OpError> {
        // `down` is the one phase that can safely re-warm a stale client: nothing has been injected
        // yet, so the retry costs only a fresh identifier. A mid-gesture phase must not — the new
        // client would carry a new identifier and the guest would read it as a second finger
        // rather than a continuation, so a gesture caught by a reboot is simply lost and the next
        // `down` recovers. This is the path a canvas tap or drag takes, so it matters most.
        if matches!(phase, TouchPhase::Down) {
            return with_input(udid, "touch", |input| {
                let id = input.allocate_touch();
                registry()
                    .lock()
                    .expect("interactive registry poisoned")
                    .touches
                    .insert(udid.to_owned(), id);
                input.touch_phase(x, y, id, private::Phase::Down)
            });
        }
        let input = input_for(udid)?;
        let mut reg = registry().lock().expect("interactive registry poisoned");
        let identifier = match phase {
            // Returned above; `None` here degrades to a no-op rather than a panic.
            TouchPhase::Down => None,
            TouchPhase::Move => reg.touches.get(udid).copied(),
            TouchPhase::Up => reg.touches.remove(udid),
        };
        drop(reg);
        let Some(identifier) = identifier else {
            return Ok(json!({}));
        };
        if input.touch_phase(x, y, identifier, to_hid_phase(phase)) {
            Ok(json!({}))
        } else {
            Err(OpError::new(ErrorCode::SimctlFailed, "touch failed"))
        }
    }

    /// One phase of a streamed two-finger gesture (pinch/zoom). Identifiers are allocated on
    /// `down` and released on `up`; a stray `move`/`up` no-ops like [`touch`].
    pub fn pinch(
        udid: &str,
        phase: TouchPhase,
        a: (f64, f64),
        b: (f64, f64),
    ) -> Result<Value, OpError> {
        // Same rule as `touch`: only the two-finger `down` may re-warm.
        if matches!(phase, TouchPhase::Down) {
            return with_input(udid, "pinch", |input| {
                let ids = [input.allocate_touch(), input.allocate_touch()];
                registry()
                    .lock()
                    .expect("interactive registry poisoned")
                    .pinches
                    .insert(udid.to_owned(), ids);
                input.touch_pair(
                    [(a.0, a.1, ids[0]), (b.0, b.1, ids[1])],
                    private::Phase::Down,
                )
            });
        }
        let input = input_for(udid)?;
        let mut reg = registry().lock().expect("interactive registry poisoned");
        let ids = match phase {
            // Returned above; `None` here degrades to a no-op rather than a panic.
            TouchPhase::Down => None,
            TouchPhase::Move => reg.pinches.get(udid).copied(),
            TouchPhase::Up => reg.pinches.remove(udid),
        };
        drop(reg);
        let Some([id0, id1]) = ids else {
            return Ok(json!({}));
        };
        let hid_phase = to_hid_phase(phase);
        if input.touch_pair([(a.0, a.1, id0), (b.0, b.1, id1)], hid_phase) {
            Ok(json!({}))
        } else {
            Err(OpError::new(ErrorCode::SimctlFailed, "pinch failed"))
        }
    }

    pub fn swipe(
        udid: &str,
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
        duration_ms: u64,
    ) -> Result<Value, OpError> {
        let duration = if duration_ms == 0 {
            Duration::from_millis(250)
        } else {
            Duration::from_millis(duration_ms)
        };
        let steps = 10u32;
        let step = duration / (steps + 2);
        with_input(udid, "swipe", |input| {
            input.swipe(x0, y0, x1, y1, steps, step)
        })
    }

    pub fn button(udid: &str, button: ButtonKind) -> Result<Value, OpError> {
        let button = match button {
            ButtonKind::Home => Button::Home,
            ButtonKind::Lock => Button::Lock,
            ButtonKind::VolumeUp => Button::VolumeUp,
            ButtonKind::VolumeDown => Button::VolumeDown,
        };
        with_input(udid, "button press", |input| {
            input.button(button, Duration::from_millis(80))
        })
    }

    /// Rotate the interface orientation. Unlike the HID ops this needs no warmed `Input` — it is a
    /// mach GSEvent to the guest's `PurpleWorkspacePort` — so it only resolves the `SimDevice`.
    pub fn rotate(udid: &str, orientation: RotateOrientation) -> Result<Value, OpError> {
        let device = SimDevice::resolve(udid).ok_or_else(|| {
            OpError::new(ErrorCode::SimctlFailed, format!("device {udid} not found"))
        })?;
        let orientation = match orientation {
            RotateOrientation::Portrait => private::Orientation::Portrait,
            RotateOrientation::PortraitUpsideDown => private::Orientation::PortraitUpsideDown,
            RotateOrientation::LandscapeLeft => private::Orientation::LandscapeLeft,
            RotateOrientation::LandscapeRight => private::Orientation::LandscapeRight,
        };
        if device.set_orientation(orientation) {
            Ok(json!({}))
        } else {
            Err(OpError::new(
                ErrorCode::SimctlFailed,
                "orientation change failed (device not booted, or port unvended)",
            ))
        }
    }

    pub fn key(udid: &str, usage: u32, modifiers: &[u32]) -> Result<Value, OpError> {
        with_input(udid, "key press", |input| {
            input.key(usage, modifiers, Duration::from_millis(20))
        })
    }

    pub fn stream_start(
        udid: &str,
        fps: u32,
        quality: f64,
        scale: f64,
        codec: StreamCodec,
        tx: &Sender<OutMsg>,
    ) -> Result<Value, OpError> {
        if !available() {
            return Err(unsupported());
        }
        // Warming the HID connection first stabilizes the framebuffer worker's cold open.
        let _ = input_for(udid);
        let fps = fps.clamp(1, 60);
        let scale = scale.clamp(0.1, 1.0);
        let params = crate::capture::StreamParams {
            fps,
            quality: quality.clamp(0.1, 1.0),
            scale,
            codec,
        };
        let mut reg = registry().lock().expect("interactive registry poisoned");
        if let Some(handle) = reg.streams.get(udid) {
            // A start on a running stream retunes it in place — no worker respawn, no XPC re-warm.
            // The unified pusher and the worker pick up the new params; `alreadyStreaming` marks that
            // this was a reconfigure, while the shape still carries `streaming`/`fps`/`scale`/`codec`.
            handle.stream.reconfigure(params);
            return Ok(
                json!({ "streaming": true, "fps": fps, "scale": scale, "codec": codec, "alreadyStreaming": true }),
            );
        }
        let stream = Arc::new(CaptureStream::start(udid.to_owned(), params));
        let stop = Arc::new(AtomicBool::new(false));
        let pusher = thread::spawn({
            let stream = Arc::clone(&stream);
            let stop = Arc::clone(&stop);
            let tx = tx.clone();
            let udid = udid.to_owned();
            move || push_stream(&udid, &stream, &stop, &tx)
        });
        reg.streams.insert(
            udid.to_owned(),
            StreamHandle {
                stream,
                stop,
                pusher: Some(pusher),
            },
        );
        Ok(json!({ "streaming": true, "fps": fps, "scale": scale, "codec": codec }))
    }

    pub fn stream_stop(udid: &str) -> Result<Value, OpError> {
        let handle = registry()
            .lock()
            .expect("interactive registry poisoned")
            .streams
            .remove(udid);
        if let Some(mut handle) = handle {
            handle.stop.store(true, Ordering::Relaxed);
            if let Some(pusher) = handle.pusher.take() {
                let _ = pusher.join();
            }
        }
        Ok(json!({}))
    }

    /// Push framebuffer frames to the daemon, adapting to the stream's live codec each frame so a
    /// reconfigure (JPEG↔H.264, fps) needs no pusher restart. JPEG is latest-wins — deduped by
    /// identity so a static screen doesn't flood, paced on a drift-free clock at the current fps;
    /// H.264 drains the ordered queue (deltas must not be dropped). If the crash-isolated worker
    /// gives up (or stays silent in JPEG mode), it degrades to `simctl io screenshot` — slower, but
    /// frames never stop; each wire frame carries its codec so a mixed stream stays decodable.
    fn push_stream(udid: &str, stream: &CaptureStream, stop: &AtomicBool, tx: &Sender<OutMsg>) {
        // simctl screenshots cost ~200-400ms, so poll the fallback well below the private fps.
        let fallback_interval = Duration::from_millis(500);
        let mut clock = FrameClock::new(stream.config().fps());
        let mut clock_fps = stream.config().fps();
        // Retain the last-sent JPEG frame (not a raw pointer): comparing addresses alone risks ABA —
        // a freed frame's address reused by a new one would read as "already sent".
        let mut last: Option<Frame> = None;
        // Last time a real private frame (either codec) reached the wire; a JPEG-mode silence past
        // the timeout means the framebuffer produced no callbacks, so degrade to simctl.
        let mut last_progress = Instant::now();
        while !stop.load(Ordering::Relaxed) {
            // The worker gave up entirely: degrade to a public screenshot so frames never stop.
            if stream.is_dead() {
                let tick = Instant::now();
                if let Ok(jpeg) = crate::simctl::screenshot(udid, crate::rpc::ImageFormat::Jpeg)
                    && let Ok(body) = encode_stream_frame(udid, &jpeg)
                    && tx
                        .send(OutMsg::Frame {
                            type_byte: STREAM_FRAME,
                            body,
                        })
                        .is_err()
                {
                    break; // daemon gone
                }
                if let Some(rest) = fallback_interval.checked_sub(tick.elapsed()) {
                    thread::sleep(rest);
                }
                continue;
            }
            match stream.config().codec() {
                StreamCodec::H264 => {
                    // The queue pop paces this branch (blocks up to 250ms for the next unit).
                    let Some(unit) = stream.next_encoded(Duration::from_millis(250)) else {
                        continue;
                    };
                    last_progress = Instant::now();
                    if let Ok(body) = encode_stream_frame_h264(udid, unit.key, &unit.data)
                        && tx
                            .send(OutMsg::Frame {
                                type_byte: STREAM_FRAME_H264,
                                body,
                            })
                            .is_err()
                    {
                        break; // daemon gone
                    }
                }
                StreamCodec::Jpeg => {
                    let fps = stream.config().fps();
                    if fps != clock_fps {
                        clock = FrameClock::new(fps);
                        clock_fps = fps;
                    }
                    if let Some(frame) = stream.latest()
                        && last.as_ref().is_none_or(|prev| !Arc::ptr_eq(prev, &frame))
                    {
                        last = Some(Arc::clone(&frame));
                        last_progress = Instant::now();
                        if let Ok(body) = encode_stream_frame(udid, &frame)
                            && tx
                                .send(OutMsg::Frame {
                                    type_byte: STREAM_FRAME,
                                    body,
                                })
                                .is_err()
                        {
                            break; // daemon gone
                        }
                        clock.tick();
                    } else if last_progress.elapsed() >= SILENT_FALLBACK_AFTER {
                        let tick = Instant::now();
                        if let Ok(jpeg) =
                            crate::simctl::screenshot(udid, crate::rpc::ImageFormat::Jpeg)
                            && let Ok(body) = encode_stream_frame(udid, &jpeg)
                            && tx
                                .send(OutMsg::Frame {
                                    type_byte: STREAM_FRAME,
                                    body,
                                })
                                .is_err()
                        {
                            break; // daemon gone
                        }
                        if let Some(rest) = fallback_interval.checked_sub(tick.elapsed()) {
                            thread::sleep(rest);
                        }
                    } else {
                        clock.tick();
                    }
                }
            }
        }
    }
}
