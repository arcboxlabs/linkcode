//! Capturing the simulator framebuffer as JPEG.
//!
//! Recipe ported from baguette's `SimulatorKitScreen.swift` + `JPEGEncoder.swift` (Apache-2.0; see
//! crate NOTICE): `device.io` → `deviceIOPorts` → the `com.apple.framebuffer.display` descriptor(s),
//! whose `framebufferSurface` is a live `IOSurface`. Registering frame callbacks is what makes
//! CoreSimulator composite and deliver frames without a Simulator.app viewer; the callback copies the
//! surface pixels out (the reader thread encodes them) — surfaces are recycled buffers that cannot be
//! held past the callback, and the CoreGraphics/ImageIO encode is unstable on the callback thread.
//!
//! This path is fragile on the Xcode 26 / iOS 26 `SimStreamProcessor` era — it intermittently aborts
//! hard inside CoreSimulator's XPC-proxy machinery — so it is only ever driven from the crash-isolated
//! worker subprocess ([`crate::capture`]), never in the sidecar's main process.

use std::ffi::{CString, c_ulong, c_void};
use std::ptr;

use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Sel};
use objc2::sel;
use objc2_foundation::{NSString, NSUUID};

use super::debug::dbg_log;
use super::device::SimDevice;

// A hand-rolled ObjC block that captures a `*const FrameSink` context, used as the framebuffer
// frame/surfaces callbacks. This mirrors baguette's model exactly: `framebufferSurface` only returns
// a live surface once delivery is active, and delivery only activates when a real callback fires —
// so the callback must grab the surface when SimulatorKit signals a frame. block2's `RcBlock`
// crashes the SimulatorKit callback path; a hand-rolled block with a POD capture and a signature is
// what the API accepts. It is registered as a copyable global block whose captured pointer aims at a
// process-lifetime (leaked-with-registration) sink.
#[repr(C)]
struct BlockDescriptor {
    reserved: c_ulong,
    size: c_ulong,
    /// Objective-C type encoding of the block signature; required with `BLOCK_HAS_SIGNATURE`.
    /// SimulatorKit reads it, so a signature-less block makes registration throw.
    signature: *const i8,
}

// SAFETY: the descriptor is immutable; its signature points at a static NUL-terminated string.
unsafe impl Sync for BlockDescriptor {}

#[repr(C)]
struct CaptureBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: unsafe extern "C" fn(*mut CaptureBlock),
    descriptor: *const BlockDescriptor,
    /// Captured context: the sink the callback stashes the latest surface into.
    sink: *const FrameSink,
}

unsafe extern "C" {
    static _NSConcreteGlobalBlock: c_void;
}

const BLOCK_IS_GLOBAL: i32 = 1 << 28;
const BLOCK_HAS_SIGNATURE: i32 = 1 << 30;
/// `void (^)(void)`: void return (`v`), 8-byte frame, block self at offset 0 (`@?`).
const BLOCK_SIGNATURE: &[u8] = b"v8@?0\0";

static CAPTURE_DESCRIPTOR: BlockDescriptor = BlockDescriptor {
    reserved: 0,
    size: size_of::<CaptureBlock>() as c_ulong,
    signature: BLOCK_SIGNATURE.as_ptr().cast::<i8>(),
};

/// The callback: SimulatorKit signalled a frame, so grab the current largest surface into the sink.
unsafe extern "C" fn capture_invoke(block: *mut CaptureBlock) {
    // SAFETY: block is our own CaptureBlock; sink is a live FrameSink for the registration lifetime.
    let sink = unsafe { &*(*block).sink };
    sink.grab_latest();
}

/// A raw BGRA frame copied out of an `IOSurface`. Owned pixels, so it outlives the surface and can
/// be encoded off the callback thread.
struct RawFrame {
    width: usize,
    height: usize,
    stride: usize,
    pixels: Vec<u8>,
}

/// Shared state between the framebuffer callbacks (SimulatorKit's queue thread) and the capture
/// reader (the sidecar's request thread). The framebuffer surfaces are live, recycled buffers that
/// must NOT be held past the callback — and the CoreGraphics/ImageIO JPEG encode intermittently
/// aborts when run on the callback thread. So the callback does only the minimal safe work (lock →
/// memcpy the pixels → unlock) and the reader thread encodes the owned copy, where it is stable.
struct FrameSink {
    descriptors: Vec<*mut AnyObject>,
    /// Gate: callbacks can fire for one descriptor while `register` is still wiring the next, so
    /// `grab_latest` must not touch a descriptor until every registration has completed. Set true
    /// only after the registration loop finishes.
    active: std::sync::atomic::AtomicBool,
    latest: std::sync::Mutex<Option<std::sync::Arc<RawFrame>>>,
}

// SAFETY: `latest` is mutex-guarded; the descriptor pointers are only messaged (thread-safe reads).
unsafe impl Send for FrameSink {}
unsafe impl Sync for FrameSink {}

impl FrameSink {
    /// Pick the largest live surface across descriptors and copy its pixels into `latest`. Runs on
    /// SimulatorKit's callback thread; only a lock + memcpy touch the surface.
    fn grab_latest(&self) {
        // Ignore callbacks that race the registration loop — a not-yet-registered descriptor aborts
        // when messaged for its surface.
        if !self.active.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        let frame = objc2::rc::autoreleasepool(|_| {
            let mut best: *mut c_void = ptr::null_mut();
            let mut best_area = 0usize;
            for &descriptor in &self.descriptors {
                // SAFETY: framebufferSurface returns the current IOSurface (or nil).
                let surface =
                    unsafe { send_obj(descriptor, sel!(framebufferSurface)) }.cast::<c_void>();
                if surface.is_null() {
                    continue;
                }
                // SAFETY: surface is a live IOSurface.
                let area = unsafe { IOSurfaceGetWidth(surface) * IOSurfaceGetHeight(surface) };
                if area > best_area {
                    best = surface;
                    best_area = area;
                }
            }
            if best.is_null() {
                return None;
            }
            copy_surface(best)
        });
        if let Some(frame) = frame {
            *self.latest.lock().expect("frame sink mutex poisoned") =
                Some(std::sync::Arc::new(frame));
        }
    }

    /// The most recent raw frame, or `None` if none has arrived.
    fn latest(&self) -> Option<std::sync::Arc<RawFrame>> {
        self.latest
            .lock()
            .expect("frame sink mutex poisoned")
            .clone()
    }
}

/// Copy the pixels of a locked BGRA surface into an owned [`RawFrame`]. Minimal surface access: read
/// dimensions, lock read-only, memcpy row by row (surfaces can be padded), unlock.
fn copy_surface(surface: *mut c_void) -> Option<RawFrame> {
    // SAFETY: surface is a live IOSurface; read-only lock, bounded row copies, matching unlock.
    unsafe {
        const READ_ONLY: u32 = 1;
        if IOSurfaceLock(surface, READ_ONLY, ptr::null_mut()) != 0 {
            return None;
        }
        let width = IOSurfaceGetWidth(surface);
        let height = IOSurfaceGetHeight(surface);
        let stride = IOSurfaceGetBytesPerRow(surface);
        let base = IOSurfaceGetBaseAddress(surface);
        let frame = if base.is_null() || width == 0 || height == 0 || stride < width * 4 {
            None
        } else {
            let mut pixels = vec![0u8; stride * height];
            std::ptr::copy_nonoverlapping(base.cast::<u8>(), pixels.as_mut_ptr(), stride * height);
            Some(RawFrame {
                width,
                height,
                stride,
                pixels,
            })
        };
        IOSurfaceUnlock(surface, READ_ONLY, ptr::null_mut());
        frame
    }
}

/// Build a leaked capturing block bound to `sink` for the registration callbacks.
fn capture_block(sink: *const FrameSink) -> *mut c_void {
    let block = Box::new(CaptureBlock {
        isa: (&raw const _NSConcreteGlobalBlock).cast::<c_void>(),
        flags: BLOCK_IS_GLOBAL | BLOCK_HAS_SIGNATURE,
        reserved: 0,
        invoke: capture_invoke,
        descriptor: &raw const CAPTURE_DESCRIPTOR,
        sink,
    });
    // Leak: SimulatorKit retains the block for the whole registration; the sink outlives it too.
    (Box::into_raw(block) as *mut c_void).cast()
}

// The framebuffer ports are CoreSimulator XPC proxies (`ROCKRemoteProxy`) that answer via
// `forwardInvocation:` — the messaged selectors are not in their class method lists, so objc2's
// `msg_send!` (which verifies against the method list) rejects them. Raw `objc_msgSend` uses the
// runtime's real dispatch, which honors forwarding — the same path baguette's ObjC `perform:` takes.
unsafe extern "C" {
    fn objc_msgSend();
}

/// Send a no-argument, object-returning message via raw `objc_msgSend`.
///
/// # Safety
/// `receiver` must be a live object that handles `sel` (directly or by forwarding); `sel` must name
/// a zero-argument, object-returning method.
unsafe fn send_obj(receiver: *mut AnyObject, sel: Sel) -> *mut AnyObject {
    // SAFETY: transmute the runtime dispatcher to this call's concrete ABI, per the fn contract.
    let f: unsafe extern "C" fn(*mut AnyObject, Sel) -> *mut AnyObject =
        unsafe { std::mem::transmute(objc_msgSend as *const c_void) };
    unsafe { f(receiver, sel) }
}

/// Send `respondsToSelector:` via raw `objc_msgSend`.
///
/// # Safety
/// `receiver` must be a live object.
unsafe fn responds_to(receiver: *mut AnyObject, target: Sel) -> bool {
    // SAFETY: respondsToSelector: takes a SEL and returns BOOL; transmute to that ABI.
    let f: unsafe extern "C" fn(*mut AnyObject, Sel, Sel) -> bool =
        unsafe { std::mem::transmute(objc_msgSend as *const c_void) };
    unsafe { f(receiver, sel!(respondsToSelector:), target) }
}

/// Send `objectAtIndex:` via raw `objc_msgSend`.
///
/// # Safety
/// `receiver` must be a live NSArray and `index` within bounds.
unsafe fn object_at_index(receiver: *mut AnyObject, index: usize) -> *mut AnyObject {
    // SAFETY: objectAtIndex: takes NSUInteger, returns id; transmute to that ABI.
    let f: unsafe extern "C" fn(*mut AnyObject, Sel, usize) -> *mut AnyObject =
        unsafe { std::mem::transmute(objc_msgSend as *const c_void) };
    unsafe { f(receiver, sel!(objectAtIndex:), index) }
}

/// Send `count` via raw `objc_msgSend`.
///
/// # Safety
/// `receiver` must be a live NSArray.
unsafe fn array_count(receiver: *mut AnyObject) -> usize {
    // SAFETY: count returns NSUInteger; transmute to that ABI.
    let f: unsafe extern "C" fn(*mut AnyObject, Sel) -> usize =
        unsafe { std::mem::transmute(objc_msgSend as *const c_void) };
    unsafe { f(receiver, sel!(count)) }
}

/// Send `valueForKey:` via raw `objc_msgSend`.
///
/// # Safety
/// `receiver` must be a live object and `key` a live NSString.
unsafe fn value_for_key_raw(receiver: *mut AnyObject, key: *mut AnyObject) -> *mut AnyObject {
    // SAFETY: valueForKey: takes id, returns id; transmute to that ABI.
    let f: unsafe extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject =
        unsafe { std::mem::transmute(objc_msgSend as *const c_void) };
    unsafe { f(receiver, sel!(valueForKey:), key) }
}

// IOSurface (public framework).
#[link(name = "IOSurface", kind = "framework")]
unsafe extern "C" {
    fn IOSurfaceLock(surface: *mut c_void, options: u32, seed: *mut u32) -> i32;
    fn IOSurfaceUnlock(surface: *mut c_void, options: u32, seed: *mut u32) -> i32;
    fn IOSurfaceGetBaseAddress(surface: *mut c_void) -> *mut c_void;
    fn IOSurfaceGetWidth(surface: *mut c_void) -> usize;
    fn IOSurfaceGetHeight(surface: *mut c_void) -> usize;
    fn IOSurfaceGetBytesPerRow(surface: *mut c_void) -> usize;
}

// CoreGraphics (public framework).
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
    fn CGColorSpaceRelease(space: *mut c_void);
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits_per_component: usize,
        bytes_per_row: usize,
        space: *mut c_void,
        bitmap_info: u32,
    ) -> *mut c_void;
    fn CGBitmapContextCreateImage(context: *mut c_void) -> *mut c_void;
    fn CGContextRelease(context: *mut c_void);
    fn CGImageRelease(image: *mut c_void);
}

// ImageIO (public framework).
#[link(name = "ImageIO", kind = "framework")]
unsafe extern "C" {
    fn CGImageDestinationCreateWithData(
        data: *mut c_void,
        type_: *const c_void,
        count: usize,
        options: *const c_void,
    ) -> *mut c_void;
    fn CGImageDestinationAddImage(dest: *mut c_void, image: *mut c_void, properties: *const c_void);
    fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
    static kCGImageDestinationLossyCompressionQuality: *const c_void;
}

// CoreFoundation (public framework).
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *mut c_void;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFNumberCreate(
        allocator: *const c_void,
        type_: isize,
        value: *const c_void,
    ) -> *const c_void;
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        cstr: *const i8,
        encoding: u32,
    ) -> *const c_void;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
}

const KCG_ALPHA_PREMULTIPLIED_FIRST: u32 = 2;
const KCG_BYTE_ORDER_32_LITTLE: u32 = 2 << 12;
const KCF_NUMBER_DOUBLE_TYPE: isize = 13;
const KCF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

/// The framebuffer of one booted device, held for a streaming session. Registration (which the
/// leaked no-op block backs) makes CoreSimulator composite the framebuffer headlessly; the
/// descriptor's `framebufferSurface` is then polled on demand under a per-capture autorelease pool.
/// The registration UUID is retained to unregister on drop.
pub struct Screen {
    /// Every `com.apple.framebuffer.display` descriptor, retained. A device exposes several (main
    /// LCD plus secondary/overlay planes); the sink polls all and keeps the largest live surface.
    descriptors: Vec<Retained<AnyObject>>,
    uuid: Retained<NSUUID>,
    /// The callbacks stash the latest surface here; capture reads it. Boxed so the callback's
    /// captured raw pointer stays valid, and dropped only after callbacks are unregistered.
    sink: Box<FrameSink>,
    /// Held to keep the callback dispatch queue alive for the registration's lifetime.
    _queue: dispatch2::DispatchRetained<DispatchQueue>,
}

// SAFETY: the descriptors are messaged read-only and the sink is internally synchronized.
unsafe impl Send for Screen {}

impl Drop for Screen {
    fn drop(&mut self) {
        // Unregister first so no further callback can fire into the sink we are about to drop.
        let uuid = Retained::as_ptr(&self.uuid).cast_mut().cast::<AnyObject>();
        for descriptor in &self.descriptors {
            let descriptor = Retained::as_ptr(descriptor).cast_mut();
            if unsafe { responds_to(descriptor, sel!(unregisterScreenCallbacksWithUUID:)) } {
                // SAFETY: unregister takes the UUID we registered with.
                let f: unsafe extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) =
                    unsafe { std::mem::transmute(objc_msgSend as *const c_void) };
                unsafe { f(descriptor, sel!(unregisterScreenCallbacksWithUUID:), uuid) };
            }
        }
    }
}

impl Screen {
    /// Resolve the largest framebuffer descriptor for a booted device. `None` when the device has no
    /// framebuffer (not booted) or the IO plumbing is unavailable.
    pub fn open(device: &SimDevice) -> Option<Screen> {
        // The framebuffer probe messages CoreSimulator XPC proxies whose forwarding autoreleases
        // reply objects; hold a pool for the whole probe, and retain the descriptors (they survive
        // the drain) before returning.
        objc2::rc::autoreleasepool(|_| {
            let io = io_client(device)?;
            // Populate the port list lazily, as SimulatorKitScreen does.
            // SAFETY: io is a live SimDeviceIOClient that handles updateIOPorts (returns void).
            unsafe { send_obj(Retained::as_ptr(&io).cast_mut(), sel!(updateIOPorts)) };
            let ports = value_for_key(&io, "deviceIOPorts")?;
            let ports_ptr = Retained::as_ptr(&ports).cast_mut();
            // SAFETY: deviceIOPorts is an NSArray.
            let count = unsafe { array_count(ports_ptr) };
            dbg_log!("open: {count} io ports");
            // Collect every framebuffer.display descriptor: a device exposes several planes and only
            // the active one(s) carry a live surface, so we register on all and pick the largest.
            let mut descriptors = Vec::new();
            for index in 0..count {
                // SAFETY: index < count.
                let port = unsafe { object_at_index(ports_ptr, index) };
                if port.is_null() {
                    continue;
                }
                if let Some(descriptor) = framebuffer_descriptor(port, index) {
                    descriptors.push(descriptor);
                }
            }
            if descriptors.is_empty() {
                return None;
            }
            Some(register(descriptors))
        })
    }

    /// The latest framebuffer frame encoded as JPEG at `quality` (0..1), or `None` if none has been
    /// delivered yet. The callback copies raw pixels; this reader thread does the CoreGraphics/ImageIO
    /// encode (stable off the callback thread).
    pub fn capture_jpeg(&self, quality: f64) -> Option<Vec<u8>> {
        // The first frame arrives asynchronously after registration; poll the sink briefly so the
        // first read doesn't spuriously fail. Steady-state reads find a frame immediately.
        for _ in 0..60 {
            if let Some(frame) = self.sink.latest() {
                return encode_bgra_jpeg(&frame, quality.clamp(0.1, 1.0));
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        None
    }
}

/// Encode an owned BGRA [`RawFrame`] to JPEG bytes via CoreGraphics + ImageIO. Runs on the reader
/// thread from owned pixels — no live surface involved.
fn encode_bgra_jpeg(frame: &RawFrame, quality: f64) -> Option<Vec<u8>> {
    // SAFETY: pixels back a `width×height`, `stride`-padded BGRA buffer; every CF/CG object created
    // here is released on all paths.
    unsafe {
        let color_space = CGColorSpaceCreateDeviceRGB();
        let context = CGBitmapContextCreate(
            frame.pixels.as_ptr().cast_mut().cast::<c_void>(),
            frame.width,
            frame.height,
            8,
            frame.stride,
            color_space,
            KCG_ALPHA_PREMULTIPLIED_FIRST | KCG_BYTE_ORDER_32_LITTLE,
        );
        CGColorSpaceRelease(color_space);
        if context.is_null() {
            return None;
        }
        let image = CGBitmapContextCreateImage(context);
        CGContextRelease(context);
        if image.is_null() {
            return None;
        }
        let bytes = encode_cgimage_jpeg(image, quality);
        CGImageRelease(image);
        bytes
    }
}

/// Write a `CGImage` to JPEG via ImageIO at `quality`.
///
/// # Safety
/// `image` must be a live CGImageRef.
unsafe fn encode_cgimage_jpeg(image: *mut c_void, quality: f64) -> Option<Vec<u8>> {
    unsafe {
        let data = CFDataCreateMutable(ptr::null(), 0);
        if data.is_null() {
            return None;
        }
        let jpeg_uti = CString::new("public.jpeg").ok()?;
        let type_ =
            CFStringCreateWithCString(ptr::null(), jpeg_uti.as_ptr(), KCF_STRING_ENCODING_UTF8);
        let options = quality_dictionary(quality);
        let dest = CGImageDestinationCreateWithData(data, type_, 1, options);
        if !type_.is_null() {
            CFRelease(type_);
        }
        if !options.is_null() {
            CFRelease(options);
        }
        if dest.is_null() {
            CFRelease(data.cast_const());
            return None;
        }
        CGImageDestinationAddImage(dest, image, ptr::null());
        let ok = CGImageDestinationFinalize(dest);
        CFRelease(dest.cast_const());
        let out = if ok {
            let len = CFDataGetLength(data.cast_const());
            let bytes = CFDataGetBytePtr(data.cast_const());
            if len > 0 && !bytes.is_null() {
                Some(std::slice::from_raw_parts(bytes, len as usize).to_vec())
            } else {
                None
            }
        } else {
            None
        };
        CFRelease(data.cast_const());
        out
    }
}

/// A one-entry `{ kCGImageDestinationLossyCompressionQuality: quality }` dictionary, or null on
/// failure. Uses null CF callbacks — legal for a transient dict whose keys/values we release after.
///
/// # Safety
/// Caller releases the returned dictionary (which owns nothing under null callbacks) and must keep
/// the quality value alive only until this returns.
unsafe fn quality_dictionary(quality: f64) -> *const c_void {
    unsafe {
        let number = CFNumberCreate(
            ptr::null(),
            KCF_NUMBER_DOUBLE_TYPE,
            (&raw const quality).cast(),
        );
        if number.is_null() {
            return ptr::null();
        }
        let keys = [kCGImageDestinationLossyCompressionQuality];
        let values = [number];
        let dict = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::null(),
            ptr::null(),
        );
        CFRelease(number);
        dict
    }
}

/// Register frame/surfaces callbacks on every framebuffer descriptor so CoreSimulator composites and
/// delivers frames (no Simulator.app viewer needed); each delivery stashes the largest live surface
/// into the shared sink. Returns the assembled `Screen`.
fn register(descriptors: Vec<Retained<AnyObject>>) -> Screen {
    let uuid = NSUUID::new();
    let queue = DispatchQueue::new("ai.linkcode.sim.framebuffer", None);
    // The sink is boxed and its pointer captured by the callback blocks; it must not move and must
    // outlive the registration (Screen drops it only after unregistering).
    let sink = Box::new(FrameSink {
        descriptors: descriptors
            .iter()
            .map(|d| Retained::as_ptr(d).cast_mut())
            .collect(),
        active: std::sync::atomic::AtomicBool::new(false),
        latest: std::sync::Mutex::new(None),
    });
    let sink_ptr: *const FrameSink = &*sink;
    let register_sel = sel!(registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:);
    let mut registered = 0;
    for descriptor in &descriptors {
        let descriptor_ptr = Retained::as_ptr(descriptor).cast_mut();
        if !unsafe { responds_to(descriptor_ptr, register_sel) } {
            continue;
        }
        // A fresh capturing block per callback slot, all pointing at the one sink.
        let frame = capture_block(sink_ptr);
        let surfaces = capture_block(sink_ptr);
        let props = capture_block(sink_ptr);
        // SAFETY: the 5-object-argument registration selector. UUID stays alive in the Screen; the
        // dispatch queue is retained by CoreSimulator for the registration; the blocks are leaked
        // and point at the boxed sink which outlives the registration.
        unsafe {
            let f: unsafe extern "C" fn(
                *mut AnyObject,
                Sel,
                *mut AnyObject,
                *mut c_void,
                *mut c_void,
                *mut c_void,
                *mut c_void,
            ) = std::mem::transmute(objc_msgSend as *const c_void);
            f(
                descriptor_ptr,
                register_sel,
                Retained::as_ptr(&uuid).cast_mut().cast::<AnyObject>(),
                dispatch2::DispatchRetained::as_ptr(&queue)
                    .as_ptr()
                    .cast::<c_void>(),
                frame,
                surfaces,
                props,
            );
        }
        registered += 1;
    }
    // All descriptors registered — callbacks may now safely touch any of them.
    sink.active
        .store(true, std::sync::atomic::Ordering::Release);
    dbg_log!("registered {registered} framebuffer descriptors");
    Screen {
        descriptors,
        uuid,
        sink,
        _queue: queue,
    }
}

/// Probe one IO port: if it is the `com.apple.framebuffer.display` port, retain and return its
/// descriptor.
fn framebuffer_descriptor(port: *mut AnyObject, index: usize) -> Option<Retained<AnyObject>> {
    if !unsafe { responds_to(port, sel!(portIdentifier)) } {
        return None;
    }
    let pid = unsafe { send_obj(port, sel!(portIdentifier)) };
    let identifier = if pid.is_null() {
        String::new()
    } else {
        nsstring_utf8(pid)
    };
    dbg_log!("port {index}: identifier={identifier:?}");
    if identifier != "com.apple.framebuffer.display" {
        return None;
    }
    if !unsafe { responds_to(port, sel!(descriptor)) } {
        return None;
    }
    let descriptor = unsafe { send_obj(port, sel!(descriptor)) };
    if descriptor.is_null() || !unsafe { responds_to(descriptor, sel!(framebufferSurface)) } {
        return None;
    }
    // SAFETY: descriptor is a live +0 object; retain to hold across the session.
    unsafe { Retained::retain(descriptor) }
}

fn io_client(device: &SimDevice) -> Option<Retained<AnyObject>> {
    // SAFETY: `io` returns the device's SimDeviceIOClient (+0) or nil.
    let io = unsafe { send_obj(device.object_ptr(), sel!(io)) };
    if io.is_null() {
        return None;
    }
    // SAFETY: io is a live +0 object; retain to hold across the session.
    unsafe { Retained::retain(io) }
}

fn value_for_key(object: &Retained<AnyObject>, key: &str) -> Option<Retained<AnyObject>> {
    let key = NSString::from_str(key);
    let key_ptr = (&*key as *const NSString).cast_mut().cast::<AnyObject>();
    // SAFETY: KVC read via raw dispatch.
    let value = unsafe { value_for_key_raw(Retained::as_ptr(object).cast_mut(), key_ptr) };
    if value.is_null() {
        return None;
    }
    // SAFETY: value is a live +0 object.
    unsafe { Retained::retain(value) }
}

/// Read an NSString-typed object's bytes via raw `UTF8String`. The port identifier is an NSString;
/// reading it through objc2's `NSString::to_string` would re-message via the verifying macro and can
/// trip over CoreSimulator's string proxies, so use raw dispatch and guard with respondsToSelector:.
fn nsstring_utf8(object: *mut AnyObject) -> String {
    if object.is_null() || !unsafe { responds_to(object, sel!(UTF8String)) } {
        return String::new();
    }
    // SAFETY: UTF8String returns a const char* valid until the autorelease pool drains.
    let ptr = unsafe {
        let f: unsafe extern "C" fn(*mut AnyObject, Sel) -> *const i8 =
            std::mem::transmute(objc_msgSend as *const c_void);
        f(object, sel!(UTF8String))
    };
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: ptr is a NUL-terminated C string from UTF8String.
    unsafe { std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned() }
}
