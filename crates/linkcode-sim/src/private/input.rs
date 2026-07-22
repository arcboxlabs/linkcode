//! Touch and button injection into a booted simulator.
//!
//! Recipe ported from baguette's `IndigoHIDInput.swift` + `IOHIDDigitizerDispatch.swift`
//! (Apache-2.0; see crate NOTICE). On iOS 26 a tap CANNOT go through the 9-arg
//! `IndigoHIDMessageForMouseNSEvent` — it is misread as a Home gesture or dropped. The working path
//! builds a real `IOHIDEvent` digitizer parent+finger pair, runs it through
//! `IndigoHIDMessageForTrackpadEventFromHIDEventRef`, then patches the two byte slots the wrapper
//! leaves uninitialised (the `0x32` touch-target tag and the edge bitmask). Buttons (home/lock) use
//! the legacy `IndigoHIDMessageForButton`, which SpringBoard still honors on Face ID devices.

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread::sleep;
use std::time::Duration;

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};

use super::device::SimDevice;
use super::framework;

// IOHIDEvent creators — public IOKit symbols in the dyld shared cache. ABIs transcribed verbatim
// from the baguette Swift typedefs. `bool` is C `_Bool` (1 byte); the AArch64/x86-64 ABIs place the
// integer- and float-class args from the declared order, so no manual register juggling is needed.
type CreateDigitizerFn = unsafe extern "C" fn(
    *const c_void, // allocator (null)
    u64,           // timestamp
    u32,           // transducer type (2 = finger)
    u32,           // index
    u32,           // identifier
    u32,           // event mask
    u32,           // button mask
    f64,           // x
    f64,           // y
    f64,           // z
    f64,           // tip pressure
    f64,           // barrel pressure
    bool,          // range
    bool,          // touch
    u32,           // options
) -> *mut c_void; // IOHIDEventRef (+1, Create rule)

type CreateFingerFn = unsafe extern "C" fn(
    *const c_void, // allocator (null)
    u64,           // timestamp
    u32,           // index
    u32,           // identifier
    u32,           // event mask
    f64,           // x
    f64,           // y
    f64,           // z
    f64,           // tip pressure
    f64,           // twist
    bool,          // range
    bool,          // touch
    u32,           // options
) -> *mut c_void; // IOHIDEventRef (+1)

type AppendEventFn = unsafe extern "C" fn(*mut c_void, *mut c_void, u32);
type TrackpadWrapFn = unsafe extern "C" fn(*const c_void) -> *mut c_void;
type ButtonFn = unsafe extern "C" fn(u32, u32, u32) -> *mut c_void;
/// `IndigoHIDMessageForHIDArbitrary(target, page, usage, operation)` — routes any HID
/// (page, usage) pair; operation 1=down, 2=up. No timestamp arg.
type HidArbitraryFn = unsafe extern "C" fn(u32, u32, u32, u32) -> *mut c_void;
type ServiceFn = unsafe extern "C" fn() -> *mut c_void;

unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
    fn malloc_size(ptr: *const c_void) -> usize;
    fn mach_absolute_time() -> u64;
}

const TRANSDUCER_FINGER: u32 = 2;
const TOUCH_TARGET: u32 = 0x32;
/// `IndigoHIDMessageForButton` arg0 for the legacy home/lock path; 3rd arg is the digitizer routing
/// target (0x33), not a timestamp.
const HOME_ARG0: u32 = 0x0;
const LOCK_ARG0: u32 = 0x1;
const LEGACY_BUTTON_TARGET: u32 = 0x33;

/// Which hardware button to press.
#[derive(Clone, Copy)]
pub enum Button {
    Home,
    Lock,
}

/// Touch phase for a streamed gesture.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Down,
    Move,
    Up,
}

impl Phase {
    fn event_mask(self) -> u32 {
        match self {
            // Range | Touch | Position for a sustained touch; Touch | Position for the lift.
            Self::Down | Self::Move => 0x07,
            Self::Up => 0x06,
        }
    }
    fn range(self) -> bool {
        self != Self::Up
    }
    fn touch(self) -> bool {
        self != Self::Up
    }
}

struct Symbols {
    create_digitizer: CreateDigitizerFn,
    create_finger: CreateFingerFn,
    append_event: AppendEventFn,
    trackpad_wrap: TrackpadWrapFn,
    button: ButtonFn,
    hid_arbitrary: Option<HidArbitraryFn>,
    create_pointer_service: Option<ServiceFn>,
    create_mouse_service: Option<ServiceFn>,
}

/// HID keyboard/keypad usage page (the page every key press below lives on).
const KEYBOARD_USAGE_PAGE: u32 = 7;

/// A warmed HID client bound to one device, plus the resolved private symbols. Created lazily; a
/// resolution failure means this host cannot inject input (the caller degrades to view-only).
pub struct Input {
    client: Retained<AnyObject>,
    symbols: Symbols,
    touch_counter: AtomicU32,
}

// SAFETY: the sidecar serializes input per device; the HID client and C fn pointers are only touched
// under that serialization.
unsafe impl Send for Input {}
unsafe impl Sync for Input {}

impl Input {
    /// Resolve symbols, create + warm the `SimDeviceLegacyHIDClient` for `device`. `None` when
    /// SimulatorKit or the HID client cannot be reached.
    pub fn warm(device: &SimDevice) -> Option<Input> {
        let symbols = resolve_symbols()?;
        let client = make_hid_client(device)?;
        let input = Input {
            client,
            symbols,
            touch_counter: AtomicU32::new(0),
        };
        input.warm_services();
        Some(input)
    }

    /// Allocate the shared identifier for one caller-driven touch stream (down → moves → up).
    pub fn allocate_touch(&self) -> u32 {
        self.next_identifier()
    }

    /// Inject one phase of a caller-driven touch stream. The caller owns the cadence and the
    /// down/move/up sequencing; `identifier` ties the phases into one gesture.
    pub fn touch_phase(&self, x: f64, y: f64, identifier: u32, phase: Phase) -> bool {
        self.send_touch(x, y, identifier, phase)
    }

    /// Single-finger tap at a normalised (0..1) point, holding for `hold`.
    pub fn tap(&self, x: f64, y: f64, hold: Duration) -> bool {
        let id = self.next_identifier();
        if !self.send_touch(x, y, id, Phase::Down) {
            return false;
        }
        sleep(hold.max(Duration::from_millis(20)));
        self.send_touch(x, y, id, Phase::Up)
    }

    /// Continuous swipe between two normalised points over `steps` interpolated moves.
    pub fn swipe(&self, x0: f64, y0: f64, x1: f64, y1: f64, steps: u32, step: Duration) -> bool {
        let steps = steps.max(2);
        let id = self.next_identifier();
        if !self.send_touch(x0, y0, id, Phase::Down) {
            return false;
        }
        let mut ok = 0u32;
        for i in 1..=steps {
            sleep(step);
            let t = f64::from(i) / f64::from(steps);
            let x = x0 + (x1 - x0) * t;
            let y = y0 + (y1 - y0) * t;
            if self.send_touch(x, y, id, Phase::Move) {
                ok += 1;
            }
        }
        sleep(step);
        self.send_touch(x1, y1, id, Phase::Up) && ok >= steps / 2
    }

    /// Press one keyboard key (HID usage on page 7) with `modifiers` (usages `0xE0..=0xE7`)
    /// bracketed around it: modifier-downs → key-down → hold → key-up → modifier-ups.
    pub fn key(&self, usage: u32, modifiers: &[u32], hold: Duration) -> bool {
        let Some(hid) = self.symbols.hid_arbitrary else {
            return false;
        };
        let send_op = |usage: u32, operation: u32| -> bool {
            // SAFETY: symbol resolved above; returns a malloc'd message consumed by send.
            let message = unsafe { hid(TOUCH_TARGET, KEYBOARD_USAGE_PAGE, usage, operation) };
            if message.is_null() {
                return false;
            }
            self.send_message(message);
            true
        };
        for modifier in modifiers {
            if !send_op(*modifier, 1) {
                return false;
            }
        }
        if !send_op(usage, 1) {
            return false;
        }
        sleep(hold.max(Duration::from_millis(20)));
        let mut ok = send_op(usage, 2);
        for modifier in modifiers.iter().rev() {
            ok = send_op(*modifier, 2) && ok;
        }
        ok
    }

    /// Press a hardware button (home/lock) for `hold`.
    pub fn button(&self, button: Button, hold: Duration) -> bool {
        let arg0 = match button {
            Button::Home => HOME_ARG0,
            Button::Lock => LOCK_ARG0,
        };
        // SAFETY: button fn resolved in `resolve_symbols`; direction 1=down, 2=up (0 crashes
        // backboardd). Each returns a freshly malloc'd message consumed by send (freeWhenDone).
        let down = unsafe { (self.symbols.button)(arg0, 1, LEGACY_BUTTON_TARGET) };
        if down.is_null() {
            return false;
        }
        self.send_message(down);
        sleep(hold.max(Duration::from_millis(20)));
        let up = unsafe { (self.symbols.button)(arg0, 2, LEGACY_BUTTON_TARGET) };
        if up.is_null() {
            return false;
        }
        self.send_message(up);
        true
    }

    fn next_identifier(&self) -> u32 {
        let id = self
            .touch_counter
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        if id == 0 { 1 } else { id }
    }

    /// Build one digitizer parent+finger event, wrap it, patch the target/edge byte slots, and send.
    fn send_touch(&self, x: f64, y: f64, identifier: u32, phase: Phase) -> bool {
        let x = clamp01(x);
        let y = clamp01(y);
        let mask = phase.event_mask();
        let range = phase.range();
        let touch = phase.touch();
        let now = unsafe { mach_absolute_time() };

        // SAFETY: creators resolved in resolve_symbols; args match the transcribed ABIs. Returns are
        // +1 IOHIDEventRefs we own and release below.
        let parent = unsafe {
            (self.symbols.create_digitizer)(
                ptr::null(),
                now,
                TRANSDUCER_FINGER,
                0,
                identifier,
                mask,
                0,
                x,
                y,
                0.0,
                0.0,
                0.0,
                range,
                touch,
                0,
            )
        };
        if parent.is_null() {
            return false;
        }
        let finger = unsafe {
            (self.symbols.create_finger)(
                ptr::null(),
                now,
                0,
                identifier,
                mask,
                x,
                y,
                0.0,
                0.0,
                0.0,
                range,
                touch,
                0,
            )
        };
        if !finger.is_null() {
            // SAFETY: append copies the child into the parent; both stay valid here.
            unsafe { (self.symbols.append_event)(parent, finger, 0) };
        }
        // SAFETY: wrapper reads the parent event and returns a malloc'd Indigo message (or null).
        let message = unsafe { (self.symbols.trackpad_wrap)(parent.cast_const()) };
        // The wrapper has copied out what it needs; release the events regardless of outcome.
        unsafe {
            if !finger.is_null() {
                CFRelease(finger.cast_const());
            }
            CFRelease(parent.cast_const());
        }
        if message.is_null() {
            return false;
        }
        patch_message(message);
        self.send_message(message);
        true
    }

    fn warm_services(&self) {
        for create in [
            self.symbols.create_pointer_service,
            self.symbols.create_mouse_service,
        ]
        .into_iter()
        .flatten()
        {
            // SAFETY: service creators take no args and return a malloc'd message consumed by send.
            let message = unsafe { create() };
            if !message.is_null() {
                self.send_message(message);
                sleep(Duration::from_millis(20));
            }
        }
    }

    /// Dispatch a malloc'd Indigo message; `freeWhenDone: true` hands ownership to the client.
    fn send_message(&self, message: *mut c_void) {
        let null_obj: *mut AnyObject = ptr::null_mut();
        // SAFETY: the client implements sendWithMessage:freeWhenDone:completionQueue:completion:;
        // message is a live malloc'd buffer the client frees.
        unsafe {
            let _: () = msg_send![
                &*self.client,
                sendWithMessage: message,
                freeWhenDone: true,
                completionQueue: null_obj,
                completion: null_obj,
            ];
        }
    }
}

/// Patch the two byte slots the trackpad wrapper leaves uninitialised: the touch-target routing tag
/// (offset 0x6c, and 0x10c on the larger layout) and the edge bitmask (0x3a/0x3b, 0xda/0xdb). We
/// only ever inject interior touches, so the edge bits stay zero.
fn patch_message(message: *mut c_void) {
    // SAFETY: message is a malloc'd buffer at least 0x70 bytes; malloc_size gates the larger writes.
    unsafe {
        message
            .byte_add(0x6c)
            .cast::<u32>()
            .write_unaligned(TOUCH_TARGET);
        let size = malloc_size(message.cast_const());
        if size >= 0x110 {
            message
                .byte_add(0x10c)
                .cast::<u32>()
                .write_unaligned(TOUCH_TARGET);
        }
        message.byte_add(0x3a).cast::<u8>().write_unaligned(0);
        message.byte_add(0x3b).cast::<u8>().write_unaligned(0);
        if size >= 0xdc {
            message.byte_add(0xda).cast::<u8>().write_unaligned(0);
            message.byte_add(0xdb).cast::<u8>().write_unaligned(0);
        }
    }
}

fn make_hid_client(device: &SimDevice) -> Option<Retained<AnyObject>> {
    let cls = AnyClass::get(c"_TtC12SimulatorKit24SimDeviceLegacyHIDClient")?;
    let mut err: *mut AnyObject = ptr::null_mut();
    // SAFETY: alloc + initWithDevice:error: on the resolved class; the device object outlives the
    // call. init returns a +1 object we own.
    let client: *mut AnyObject = unsafe {
        let allocated: *mut AnyObject = msg_send![cls, alloc];
        msg_send![allocated, initWithDevice: device.object_ptr(), error: &mut err]
    };
    if client.is_null() {
        return None;
    }
    // SAFETY: init already returned +1; adopt it without an extra retain.
    unsafe { Retained::from_raw(client) }
}

fn resolve_symbols() -> Option<Symbols> {
    let frameworks = framework::load()?;
    let kit = frameworks.simulator_kit;
    // SAFETY: each dlsym result is transmuted to the ABI its symbol name denotes; the fn pointers
    // are only invoked with matching argument types above.
    unsafe {
        let create_digitizer = framework::dlsym_default("IOHIDEventCreateDigitizerEvent")?;
        let create_finger = framework::dlsym_default("IOHIDEventCreateDigitizerFingerEvent")?;
        let append_event = framework::dlsym_default("IOHIDEventAppendEvent")?;
        let trackpad_wrap =
            framework::dlsym(kit, "IndigoHIDMessageForTrackpadEventFromHIDEventRef")?;
        let button = framework::dlsym(kit, "IndigoHIDMessageForButton")?;
        let hid_arbitrary = framework::dlsym(kit, "IndigoHIDMessageForHIDArbitrary");
        Some(Symbols {
            create_digitizer: std::mem::transmute::<*mut c_void, CreateDigitizerFn>(
                create_digitizer,
            ),
            create_finger: std::mem::transmute::<*mut c_void, CreateFingerFn>(create_finger),
            append_event: std::mem::transmute::<*mut c_void, AppendEventFn>(append_event),
            trackpad_wrap: std::mem::transmute::<*mut c_void, TrackpadWrapFn>(trackpad_wrap),
            button: std::mem::transmute::<*mut c_void, ButtonFn>(button),
            hid_arbitrary: hid_arbitrary
                .map(|p| std::mem::transmute::<*mut c_void, HidArbitraryFn>(p)),
            create_pointer_service: framework::dlsym(kit, "IndigoHIDMessageToCreatePointerService")
                .map(|p| std::mem::transmute::<*mut c_void, ServiceFn>(p)),
            create_mouse_service: framework::dlsym(kit, "IndigoHIDMessageToCreateMouseService")
                .map(|p| std::mem::transmute::<*mut c_void, ServiceFn>(p)),
        })
    }
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}
