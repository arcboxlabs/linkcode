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
use crate::rpc::{ButtonKind, ErrorCode, OpError};

fn unsupported() -> OpError {
    OpError::new(
        ErrorCode::XcodeMissing,
        "interactive simulator control is unavailable on this host",
    )
}

#[cfg(target_os = "macos")]
pub use imp::{available, button, stream_start, stream_stop, swipe, tap};

#[cfg(not(target_os = "macos"))]
mod stubs {
    use super::*;

    pub fn available() -> bool {
        false
    }
    pub fn tap(_udid: &str, _x: f64, _y: f64) -> Result<Value, OpError> {
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
    pub fn stream_start(
        _udid: &str,
        _fps: u32,
        _quality: f64,
        _scale: f64,
        _tx: &Sender<OutMsg>,
    ) -> Result<Value, OpError> {
        Err(unsupported())
    }
    pub fn stream_stop(_udid: &str) -> Result<Value, OpError> {
        Err(unsupported())
    }
}

#[cfg(not(target_os = "macos"))]
pub use stubs::{available, button, stream_start, stream_stop, swipe, tap};

#[cfg(target_os = "macos")]
mod imp {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::*;
    use crate::capture::{CaptureStream, FrameClock};
    use crate::private::{self, Button, Input, SimDevice};
    use crate::proto::{STREAM_FRAME, encode_stream_frame};

    /// Warmed HID clients and running streams, keyed by udid. Warming a client is expensive, so it
    /// is cached; a stream is one crash-isolated worker plus a pusher thread.
    struct Registry {
        inputs: HashMap<String, Arc<Input>>,
        streams: HashMap<String, StreamHandle>,
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
            })
        })
    }

    pub fn available() -> bool {
        private::interactive_available()
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

    pub fn tap(udid: &str, x: f64, y: f64) -> Result<Value, OpError> {
        if input_for(udid)?.tap(x, y, Duration::from_millis(80)) {
            Ok(json!({}))
        } else {
            Err(OpError::new(ErrorCode::SimctlFailed, "tap failed"))
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
        if input_for(udid)?.swipe(x0, y0, x1, y1, steps, step) {
            Ok(json!({}))
        } else {
            Err(OpError::new(ErrorCode::SimctlFailed, "swipe failed"))
        }
    }

    pub fn button(udid: &str, button: ButtonKind) -> Result<Value, OpError> {
        let button = match button {
            ButtonKind::Home => Button::Home,
            ButtonKind::Lock => Button::Lock,
        };
        if input_for(udid)?.button(button, Duration::from_millis(80)) {
            Ok(json!({}))
        } else {
            Err(OpError::new(ErrorCode::SimctlFailed, "button press failed"))
        }
    }

    pub fn stream_start(
        udid: &str,
        fps: u32,
        quality: f64,
        scale: f64,
        tx: &Sender<OutMsg>,
    ) -> Result<Value, OpError> {
        if !available() {
            return Err(unsupported());
        }
        // Warming the HID connection first stabilizes the framebuffer worker's cold open.
        let _ = input_for(udid);
        let fps = fps.clamp(1, 60);
        let scale = scale.clamp(0.1, 1.0);
        let mut reg = registry().lock().expect("interactive registry poisoned");
        if reg.streams.contains_key(udid) {
            return Ok(json!({ "alreadyStreaming": true }));
        }
        let stream = Arc::new(CaptureStream::start(
            udid.to_owned(),
            crate::capture::StreamParams {
                fps,
                quality: quality.clamp(0.1, 1.0),
                scale,
            },
        ));
        let stop = Arc::new(AtomicBool::new(false));
        let pusher = thread::spawn({
            let stream = Arc::clone(&stream);
            let stop = Arc::clone(&stop);
            let tx = tx.clone();
            let udid = udid.to_owned();
            move || push_frames(&udid, fps, &stream, &stop, &tx)
        });
        reg.streams.insert(
            udid.to_owned(),
            StreamHandle {
                stream,
                stop,
                pusher: Some(pusher),
            },
        );
        Ok(json!({ "streaming": true, "fps": fps, "scale": scale }))
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

    /// Push framebuffer frames to the daemon at `fps`. Prefers the fast private capture stream; if
    /// its crash-isolated worker gives up (the private API is unusable on this host/state), it
    /// degrades to `simctl io screenshot` — slower, but frames never stop and the sidecar never
    /// crashes. De-duplicates the private frames by identity so a static screen doesn't flood.
    fn push_frames(
        udid: &str,
        fps: u32,
        stream: &CaptureStream,
        stop: &AtomicBool,
        tx: &Sender<OutMsg>,
    ) {
        // Poll the private stream on a drift-free clock so a locked worker fps reaches the wire
        // without the per-frame sleep overshoot that would otherwise sample it below target.
        let mut clock = FrameClock::new(fps);
        // simctl screenshots cost ~200-400ms, so poll them well below the private fps.
        let fallback_interval = Duration::from_millis(500);
        let mut last: Option<*const Vec<u8>> = None;
        while !stop.load(Ordering::Relaxed) {
            if stream.is_dead() {
                // Degraded path: capture via the public simctl screenshot and push it.
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
            if let Some(frame) = stream.latest() {
                let ptr = Arc::as_ptr(&frame);
                if last != Some(ptr) {
                    last = Some(ptr);
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
                }
            }
            clock.tick();
        }
    }
}
