//! Device state-change notifications, straight from CoreSimulator.
//!
//! The `state-watcher` subprocess registers a captureless hand-rolled block with the device's
//! `SimDeviceNotificationManager` and relays `device_state` notifications as `state <n>` lines on
//! stdout. It is a separate process for the same reason the capture worker is: this is a private
//! callback ABI, and a drifted signature must crash a disposable child, never the sidecar server.
//! The server treats the lines as a fast path only — its own state poll (`interactive::push_stream`)
//! remains the backstop, so a dead or silent watcher degrades to polling, not to a stale stream.

use std::ffi::{c_ulong, c_void};
use std::io::{self, BufRead, Write};

use objc2::runtime::AnyObject;
use objc2::{msg_send, sel};
use objc2_foundation::NSString;

use super::debug::dbg_log;
use super::device::SimDevice;

// Block ABI mirrors `screen.rs`: hand-rolled global block with a signature (block2's `RcBlock`
// crashes CoreSimulator callback paths), captureless by discipline — this process watches exactly
// one device, so the callback needs no state beyond process-global stdout.

#[repr(C)]
struct BlockDescriptor {
    reserved: c_ulong,
    size: c_ulong,
    signature: *const i8,
}

// SAFETY: the descriptor is immutable; the signature points at a static NUL-terminated string.
unsafe impl Sync for BlockDescriptor {}

#[repr(C)]
struct NotifyBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: *const c_void,
    descriptor: *const BlockDescriptor,
}

unsafe extern "C" {
    static _NSConcreteGlobalBlock: c_void;
    // dispatch (public): a serial queue for CoreSimulator to deliver the notifications on.
    fn dispatch_queue_create(label: *const i8, attr: *const c_void) -> *mut c_void;
}

const BLOCK_IS_GLOBAL: i32 = 1 << 28;
const BLOCK_HAS_SIGNATURE: i32 = 1 << 30;
/// `void (^)(NSDictionary *)` — one notification payload.
const NOTIFY_SIGNATURE: &[u8] = b"v16@?0@8\0";

static NOTIFY_DESCRIPTOR: BlockDescriptor = BlockDescriptor {
    reserved: 0,
    size: size_of::<NotifyBlock>() as c_ulong,
    signature: NOTIFY_SIGNATURE.as_ptr().cast::<i8>(),
};

/// Notification callback, on the delivery queue. Filters for `device_state` and emits the new raw
/// state. Must never unwind (extern "C" boundary), so every failure is a silent return — the
/// server's poll backstop covers a watcher that goes quiet.
unsafe extern "C" fn notify_invoke(_block: *mut NotifyBlock, payload: *mut AnyObject) {
    if payload.is_null() {
        return;
    }
    let name_key = NSString::from_str("notification");
    // SAFETY: payload is the notification NSDictionary for the duration of the callback.
    let name: *mut NSString = unsafe { msg_send![payload, objectForKey: &*name_key] };
    if name.is_null() {
        return;
    }
    let device_state = NSString::from_str("device_state");
    // SAFETY: name is an NSString*.
    let is_state: bool = unsafe { msg_send![name, isEqualToString: &*device_state] };
    if !is_state {
        // SAFETY: name is a valid NSString for the duration of this read.
        dbg_log!("state-watcher: ignoring {}", unsafe { (*name).to_string() });
        return;
    }
    let state_key = NSString::from_str("new_state");
    // SAFETY: payload is still the notification NSDictionary.
    let number: *mut AnyObject = unsafe { msg_send![payload, objectForKey: &*state_key] };
    if number.is_null() {
        return;
    }
    // SAFETY: number is an NSNumber*; unsignedLongLongValue is its standard accessor.
    let state: u64 = unsafe { msg_send![number, unsignedLongLongValue] };
    emit_state(state);
}

/// Write one `state <n>` line. Errors are ignored: a dead server also closes our stdin, which is
/// what actually exits this process.
fn emit_state(state: u64) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "state {state}");
    let _ = out.flush();
}

/// The handler block, leaked on purpose: CoreSimulator retains it for the registration's lifetime,
/// which here is the process's lifetime.
fn notify_block() -> *mut c_void {
    let block = Box::new(NotifyBlock {
        isa: (&raw const _NSConcreteGlobalBlock).cast::<c_void>(),
        flags: BLOCK_IS_GLOBAL | BLOCK_HAS_SIGNATURE,
        reserved: 0,
        invoke: notify_invoke as *const c_void,
        descriptor: &NOTIFY_DESCRIPTOR,
    });
    Box::into_raw(block).cast::<c_void>()
}

/// `linkcode-sim state-watcher <udid>`: relay this device's state notifications as stdout lines.
///
/// Contract with the server (`interactive::stream_start`): one `state <n>` line per `device_state`
/// notification, plus one at startup for the current state so a subscription gap at spawn time
/// cannot hide an already-dead device; everything else goes to stderr. Exits when stdin closes
/// (the server dropped the pipe) or when registration is impossible.
pub fn run_state_watcher(udid: &str) -> i32 {
    let Some(device) = SimDevice::resolve(udid) else {
        eprintln!("state-watcher: device {udid} not found");
        return 1;
    };
    let ptr = device.object_ptr();
    // SAFETY: respondsToSelector: is defined on NSObject.
    let has_manager: bool =
        unsafe { msg_send![ptr, respondsToSelector: sel!(notificationManager)] };
    if !has_manager {
        eprintln!("state-watcher: SimDevice has no notificationManager");
        return 1;
    }
    // SAFETY: the accessor returns the device's SimDeviceNotificationManager (or nil).
    let manager: *mut AnyObject = unsafe { msg_send![ptr, notificationManager] };
    if manager.is_null() {
        eprintln!("state-watcher: notificationManager is nil");
        return 1;
    }
    let block = notify_block();
    // SAFETY: respondsToSelector: probes; both register selectors take the block as their last
    // argument and return an NSUInteger registration id.
    let reg_id: usize = unsafe {
        let on_queue: bool = msg_send![manager, respondsToSelector: sel!(registerNotificationHandlerOnQueue:handler:)];
        if on_queue {
            let queue =
                dispatch_queue_create(c"linkcode.sim.state-watcher".as_ptr(), std::ptr::null());
            msg_send![manager, registerNotificationHandlerOnQueue: queue, handler: block]
        } else {
            let plain: bool =
                msg_send![manager, respondsToSelector: sel!(registerNotificationHandler:)];
            if !plain {
                eprintln!("state-watcher: no register selector on the notification manager");
                return 1;
            }
            msg_send![manager, registerNotificationHandler: block]
        }
    };
    dbg_log!("state-watcher: registered (id {reg_id}) for {udid}");
    match device.state_raw() {
        Some(state) => emit_state(state),
        None => eprintln!("state-watcher: device state unreadable"),
    }
    // Park until the server closes our stdin; notifications arrive on the delivery queue.
    let stdin = io::stdin();
    let mut sink = String::new();
    while stdin
        .lock()
        .read_line(&mut sink)
        .map(|n| n > 0)
        .unwrap_or(false)
    {
        sink.clear();
    }
    0
}
