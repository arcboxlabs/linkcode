//! Capturing the simulator framebuffer as JPEG.
//!
//! Uses CoreSimulator's `SimDisplayIOSurfaceRenderable` screen: `device.io` → `deviceIOPorts` → the
//! `com.apple.framebuffer.display` descriptor(s), then
//! `registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:`.
//! Registering those callbacks is what makes CoreSimulator composite the framebuffer headlessly (no
//! Simulator.app viewer needed) — `framebufferSurface` stays nil until delivery is active.
//!
//! The delivery model on the Xcode 26 `SimStreamProcessor` era is: `surfacesChangedCallback` fires
//! once at activation (and again only on a resize/realloc) with the live `IOSurface`; `frameCallback`
//! fires per composited frame; and the display surface then updates in place. So the surfaces
//! callback retains the delivered surface, and the frame callback (on the same serial queue,
//! synchronized with frame production) locks-and-copies it into an owned buffer; the reader thread
//! then does the CoreGraphics/ImageIO encode off the queue. The hot per-frame path therefore touches
//! only local IOSurface C calls — it never re-messages the CoreSimulator XPC proxy, which is what
//! made the earlier "poll `framebufferSurface` every frame" recipe abort intermittently inside the
//! proxy machinery.
//!
//! Two things this path must get right or it crashes hard: the callback blocks must be captureless
//! and reach state through a process global (`CURRENT_SINK`), because ROCK's XPC delivery does not
//! preserve a pointer captured in the block body; and the ImageIO options dictionary must use the
//! standard CFType callbacks, because ImageIO deep-copies and validates it. The path is still driven
//! only from the crash-isolated worker subprocess ([`crate::capture`]), never in the sidecar's main
//! process, so any residual hard abort (e.g. a cold-connect class race) is contained.

use std::ffi::{CString, c_ulong, c_void};
use std::ptr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicPtr, Ordering};

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Sel};
use objc2::sel;
use objc2_foundation::{NSString, NSUUID};

use super::debug::dbg_log;
use super::device::SimDevice;

// Hand-rolled ObjC blocks for the three screen callbacks. block2's `RcBlock` crashes the
// CoreSimulator callback path; a hand-rolled global block with a signature is what the API accepts.
// The blocks are captureless: ROCK's XPC delivery does not preserve a pointer captured in the block
// body (it reads back null in the callback), so the callbacks reach state through [`CURRENT_SINK`]
// instead. All three share one layout so a single builder and invoke-pointer cast serve them.
#[repr(C)]
struct BlockDescriptor {
    reserved: c_ulong,
    size: c_ulong,
    /// Objective-C type encoding of the block signature; required with `BLOCK_HAS_SIGNATURE`.
    /// CoreSimulator reads it, so a signature-less block makes registration throw.
    signature: *const i8,
}

// SAFETY: descriptors are immutable; each signature points at a static NUL-terminated string.
unsafe impl Sync for BlockDescriptor {}

#[repr(C)]
struct CallbackBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    /// One of the three invoke fns below, stored type-erased; the descriptor's signature tells the
    /// runtime the real ABI to call it with.
    invoke: *const c_void,
    descriptor: *const BlockDescriptor,
}

/// The active stream's sink, reached by the callbacks. The blocks are handed to a CoreSimulator
/// `ROCKRemoteProxy` and delivered back through `ROCKInvocation`/XPC, which does NOT preserve a
/// pointer captured in the block body — a captured `sink` field reads back null in the callback and
/// segfaults. So the sink is reached through this process-global pointer instead, read from the
/// callback's own address space. `Screen::open` runs once per (worker) process, so a single global is
/// exactly right; it is set at registration and cleared on drop.
static CURRENT_SINK: AtomicPtr<FrameSink> = AtomicPtr::new(ptr::null_mut());

/// The active sink, or `None` if no stream is registered.
fn current_sink() -> Option<&'static FrameSink> {
    let ptr = CURRENT_SINK.load(Ordering::Acquire);
    // SAFETY: when non-null, `ptr` is the boxed sink owned by the live `Screen` that set it; it is
    // cleared to null in `Screen::drop` before the box is freed, so a non-null read is valid.
    unsafe { ptr.as_ref() }
}

unsafe extern "C" {
    static _NSConcreteGlobalBlock: c_void;
}

const BLOCK_IS_GLOBAL: i32 = 1 << 28;
const BLOCK_HAS_SIGNATURE: i32 = 1 << 30;
/// `void (^)(void)` — the per-frame callback (we copy on the reader, so this is a no-op).
const FRAME_SIGNATURE: &[u8] = b"v8@?0\0";
/// `void (^)(IOSurface *unmasked, IOSurface *masked)` — the surfaces-changed callback.
const SURFACES_SIGNATURE: &[u8] = b"v24@?0@8@16\0";
/// `void (^)(id<SimScreenProperties>)` — the properties-changed callback (no-op).
const PROPS_SIGNATURE: &[u8] = b"v16@?0@8\0";

static FRAME_DESCRIPTOR: BlockDescriptor = block_descriptor(FRAME_SIGNATURE);
static SURFACES_DESCRIPTOR: BlockDescriptor = block_descriptor(SURFACES_SIGNATURE);
static PROPS_DESCRIPTOR: BlockDescriptor = block_descriptor(PROPS_SIGNATURE);

const fn block_descriptor(signature: &'static [u8]) -> BlockDescriptor {
    BlockDescriptor {
        reserved: 0,
        size: size_of::<CallbackBlock>() as c_ulong,
        signature: signature.as_ptr().cast::<i8>(),
    }
}

/// Per-composited-frame callback: copy the current surface into an owned frame. Runs on
/// CoreSimulator's serial delivery queue, synchronized with frame production, so the surface backing
/// is valid here — it is NOT valid to retain and read later on another thread (recycled buffer). Only
/// the memcpy happens here; the reader thread does the CoreGraphics/ImageIO encode.
unsafe extern "C" fn frame_invoke(_block: *mut CallbackBlock) {
    if let Some(sink) = current_sink() {
        sink.grab_current();
    }
}

/// Surfaces-changed callback: retain the delivered unmasked (full, bezel-free) surface as the current
/// framebuffer; ignore the masked one (rounded-corner alpha we don't want). Also copies it once right
/// away — the frame callback only fires on *new* composited frames, so a static screen (no motion
/// after boot) would otherwise never yield a first frame.
unsafe extern "C" fn surfaces_invoke(
    _block: *mut CallbackBlock,
    unmasked: *mut c_void,
    _masked: *mut c_void,
) {
    if let Some(sink) = current_sink() {
        sink.set_current(unmasked);
        sink.grab_current();
    }
}

/// Properties-changed callback: no-op.
unsafe extern "C" fn props_invoke(_block: *mut CallbackBlock, _props: *mut c_void) {}

/// A raw BGRA frame copied out of an `IOSurface`. Owned pixels, so it outlives the surface lock and
/// can be encoded off the callback queue.
struct RawFrame {
    width: usize,
    height: usize,
    stride: usize,
    pixels: Vec<u8>,
}

/// A CFRetained `IOSurface`, released on drop. The surfaces callback delivers the surface borrowed
/// (valid only for that call), so we retain it to hold across later frame callbacks — the way
/// `SimDisplayView` retains the surface it renders each display frame. Its content updates in place.
struct Held(*mut c_void);

// SAFETY: a retained IOSurface is safe to reference until released; it is only locked/copied on the
// serial delivery queue.
unsafe impl Send for Held {}

impl Held {
    fn new(surface: *mut c_void) -> Held {
        // SAFETY: surface is a live IOSurface (CFType) for the duration of the delivering callback;
        // retain to hold it past that call.
        unsafe { CFRetain(surface.cast_const()) };
        Held(surface)
    }
}

impl Drop for Held {
    fn drop(&mut self) {
        // SAFETY: balances the CFRetain in `new`.
        unsafe { CFRelease(self.0.cast_const()) };
    }
}

/// Shared state between the callbacks (CoreSimulator's serial delivery queue) and the capture reader
/// (the sidecar's request thread). `current` is the retained live surface, swapped by the surfaces
/// callback and copied by the frame callback — both on the same serial queue. `latest` is the owned
/// copy the reader encodes.
struct FrameSink {
    current: Mutex<Option<Held>>,
    latest: Mutex<Option<std::sync::Arc<RawFrame>>>,
}

// SAFETY: both fields are mutex-guarded; the surface is only locked/copied on the delivery queue.
unsafe impl Send for FrameSink {}
unsafe impl Sync for FrameSink {}

impl FrameSink {
    /// Adopt a freshly delivered surface as current, retaining it and releasing the previous one.
    fn set_current(&self, surface: *mut c_void) {
        if surface.is_null() {
            return;
        }
        *self.current.lock().expect("frame sink mutex poisoned") = Some(Held::new(surface));
    }

    /// Copy the current surface into `latest`. Called from the frame callback on the delivery queue,
    /// where the retained surface's backing is live and coherent with the just-composited frame.
    fn grab_current(&self) {
        let frame = {
            let guard = self.current.lock().expect("frame sink mutex poisoned");
            let Some(held) = guard.as_ref() else {
                return;
            };
            copy_surface(held.0)
        };
        if let Some(frame) = frame {
            *self.latest.lock().expect("frame sink mutex poisoned") =
                Some(std::sync::Arc::new(frame));
        }
    }

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
    if surface.is_null() {
        return None;
    }
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

/// Build a leaked, captureless callback block with `invoke`/`descriptor`. It carries no context —
/// the callbacks reach the sink through [`CURRENT_SINK`], since a captured pointer does not survive
/// ROCK's XPC delivery.
fn callback_block(invoke: *const c_void, descriptor: *const BlockDescriptor) -> *mut c_void {
    let block = Box::new(CallbackBlock {
        isa: (&raw const _NSConcreteGlobalBlock).cast::<c_void>(),
        flags: BLOCK_IS_GLOBAL | BLOCK_HAS_SIGNATURE,
        reserved: 0,
        invoke,
        descriptor,
    });
    // Leak: CoreSimulator retains the block for the whole registration.
    (Box::into_raw(block) as *mut c_void).cast()
}

// The framebuffer ports are CoreSimulator XPC proxies (`ROCKRemoteProxy`) that answer via
// `forwardInvocation:` — the messaged selectors are not in their class method lists, so objc2's
// `msg_send!` (which verifies against the method list) rejects them. Raw `objc_msgSend` uses the
// runtime's real dispatch, which honors forwarding.
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
    fn CFRetain(cf: *const c_void) -> *const c_void;
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
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}

// dispatch (public): a serial queue for CoreSimulator to deliver the screen callbacks on.
unsafe extern "C" {
    fn dispatch_queue_create(label: *const i8, attr: *const c_void) -> *mut c_void;
}

const KCG_ALPHA_PREMULTIPLIED_FIRST: u32 = 2;
const KCG_BYTE_ORDER_32_LITTLE: u32 = 2 << 12;
const KCF_NUMBER_DOUBLE_TYPE: isize = 13;
const KCF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

/// How long [`Screen::open`] waits for the first surface to be delivered before giving up.
const ACTIVATION_TIMEOUT_MS: u64 = 2000;

/// The framebuffer of one booted device, held for a streaming session. Registration makes
/// CoreSimulator composite the framebuffer headlessly and push the display surface into the sink; the
/// reader copies that held surface on demand. The registration UUID is retained to unregister on drop.
pub struct Screen {
    /// Every `com.apple.framebuffer.display` descriptor we registered on, retained. A device exposes
    /// several (main LCD plus secondary/overlay planes); we register on all and hold the surface each
    /// delivers.
    descriptors: Vec<Retained<AnyObject>>,
    uuid: Retained<NSUUID>,
    /// The surfaces callback stashes the current surface here; the reader copies it. Boxed so the
    /// callback's captured raw pointer stays valid, and dropped only after callbacks are unregistered.
    sink: Box<FrameSink>,
    /// The serial dispatch queue CoreSimulator delivers callbacks on; retained for the registration.
    queue: *mut c_void,
}

// SAFETY: the descriptors are messaged read-only, the sink is internally synchronized, and the queue
// is only handed to CoreSimulator and released on drop.
unsafe impl Send for Screen {}

impl Drop for Screen {
    fn drop(&mut self) {
        // Stop the callbacks from reaching the sink, then unregister. Cleared before the boxed sink is
        // freed so an in-flight callback either sees the live sink or (after this) sees null.
        CURRENT_SINK.store(ptr::null_mut(), Ordering::Release);
        // Unregister so no further callback can fire.
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
        if !self.queue.is_null() {
            // SAFETY: the queue was created +1 by dispatch_queue_create and handed to CoreSimulator,
            // which retained it for the registration we just tore down; release our reference.
            unsafe { CFRelease(self.queue.cast_const()) };
        }
    }
}

impl Screen {
    /// Open the framebuffer of a booted device and start surface delivery. `None` when the device has
    /// no framebuffer (not booted), the IO plumbing is unavailable, no descriptor supports the screen
    /// callbacks, or no surface is delivered within the activation timeout (the caller degrades to
    /// simctl).
    pub fn open(device: &SimDevice) -> Option<Screen> {
        // The framebuffer probe messages CoreSimulator XPC proxies whose forwarding autoreleases
        // reply objects; hold a pool for the whole probe, and retain the descriptors (they survive
        // the drain) before returning.
        objc2::rc::autoreleasepool(|_| {
            let io = io_client(device)?;
            // Populate the port list lazily.
            // SAFETY: io is a live SimDeviceIOClient that handles updateIOPorts (returns void).
            unsafe { send_obj(Retained::as_ptr(&io).cast_mut(), sel!(updateIOPorts)) };
            let ports = value_for_key(&io, "deviceIOPorts")?;
            let ports_ptr = Retained::as_ptr(&ports).cast_mut();
            // SAFETY: deviceIOPorts is an NSArray.
            let count = unsafe { array_count(ports_ptr) };
            dbg_log!("open: {count} io ports");
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
            let screen = register(descriptors)?;
            // Wait for delivery to activate (the surfaces callback fires ~once at activation, and the
            // proxy also exposes `framebufferSurface` once live). If neither yields a surface, the
            // connection is dead/degraded — report None so the caller degrades to simctl.
            if screen.await_first_surface() {
                Some(screen)
            } else {
                dbg_log!("open: no surface within activation timeout");
                None
            }
        })
    }

    /// Wait for the first frame to be copied out by the frame callback, up to
    /// [`ACTIVATION_TIMEOUT_MS`]. A copied frame (not just a delivered surface pointer) proves the
    /// whole delivery path is live.
    fn await_first_surface(&self) -> bool {
        for _ in 0..(ACTIVATION_TIMEOUT_MS / 10) {
            if self.sink.latest().is_some() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }

    /// The latest copied framebuffer encoded as JPEG at `quality` (0..1), or `None` if no frame has
    /// been copied yet. The frame callback did the surface copy on the delivery queue; this reader
    /// thread only encodes the owned pixels — the CoreSimulator proxy is never messaged on this path.
    pub fn capture_jpeg(&self, quality: f64) -> Option<Vec<u8>> {
        let frame = self.sink.latest()?;
        encode_bgra_jpeg(&frame, quality.clamp(0.1, 1.0))
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

/// The measured cost of encoding one framebuffer at a given resolution/quality, with the frame rate
/// it implies (a single reader thread does the encode, so `1000 / avg_ms` is the sustainable ceiling).
pub struct EncodeBench {
    pub width: usize,
    pub height: usize,
    pub quality: f64,
    pub avg_ms: f64,
    pub best_ms: f64,
    pub p95_ms: f64,
    pub out_kib: usize,
}

impl EncodeBench {
    /// Sustainable frames per second at the average encode cost.
    pub fn fps(&self) -> f64 {
        if self.avg_ms > 0.0 {
            1000.0 / self.avg_ms
        } else {
            0.0
        }
    }

    /// Best-case frames per second (fastest encode observed).
    pub fn peak_fps(&self) -> f64 {
        if self.best_ms > 0.0 {
            1000.0 / self.best_ms
        } else {
            0.0
        }
    }
}

/// Benchmark the JPEG encode hot path (the capture pipeline's single-thread ceiling) on a synthetic
/// BGRA frame of `width`×`height`, timing `iters` encodes at `quality` after a warmup. No simulator
/// is needed — this isolates the CoreGraphics/ImageIO cost that bounds the stream's frame rate.
pub fn bench_encode(width: usize, height: usize, quality: f64, iters: u32) -> Option<EncodeBench> {
    let stride = width * 4;
    // A gradient plus a per-pixel wobble so the JPEG has realistic entropy (a flat frame would
    // compress trivially and understate the encode cost).
    let mut pixels = vec![0u8; stride * height];
    for y in 0..height {
        let row = &mut pixels[y * stride..y * stride + width * 4];
        for x in 0..width {
            let p = &mut row[x * 4..x * 4 + 4];
            p[0] = (x ^ y) as u8; // B
            p[1] = (x.wrapping_add(y)) as u8; // G
            p[2] = (x.wrapping_mul(3) ^ y) as u8; // R
            p[3] = 0xFF; // A
        }
    }
    let frame = RawFrame {
        width,
        height,
        stride,
        pixels,
    };
    let q = quality.clamp(0.1, 1.0);

    // Warm up: the first encode pays one-time ImageIO/CoreGraphics setup.
    let mut out_len = 0usize;
    for _ in 0..3 {
        out_len = encode_bgra_jpeg(&frame, q)?.len();
    }

    let mut samples = Vec::with_capacity(iters as usize);
    for _ in 0..iters {
        let start = std::time::Instant::now();
        let jpeg = encode_bgra_jpeg(&frame, q)?;
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
        out_len = jpeg.len();
    }
    samples.sort_by(|a, b| a.partial_cmp(b).expect("no NaN durations"));
    let avg_ms = samples.iter().sum::<f64>() / samples.len() as f64;
    let best_ms = samples[0];
    let p95_ms = samples[(samples.len() * 95 / 100).min(samples.len() - 1)];

    Some(EncodeBench {
        width,
        height,
        quality: q,
        avg_ms,
        best_ms,
        p95_ms,
        out_kib: out_len / 1024,
    })
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
/// failure. Uses the standard CFType key/value callbacks so the dict properly retains its CF
/// members — ImageIO deep-copies and validates the properties dict, which crashes on a dict built
/// with null callbacks (its members are then treated as opaque, non-CF pointers).
///
/// # Safety
/// Caller releases the returned dictionary.
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
            (&raw const kCFTypeDictionaryKeyCallBacks).cast(),
            (&raw const kCFTypeDictionaryValueCallBacks).cast(),
        );
        // The dict retained the number under the CFType callbacks; drop our reference.
        CFRelease(number);
        dict
    }
}

/// Register the three screen callbacks on every framebuffer descriptor so CoreSimulator composites
/// and delivers the display surface (no Simulator.app viewer needed). Returns the assembled `Screen`,
/// or `None` if no descriptor supports the registration.
fn register(descriptors: Vec<Retained<AnyObject>>) -> Option<Screen> {
    let uuid = NSUUID::new();
    let label = c"ai.linkcode.sim.framebuffer";
    // SAFETY: dispatch_queue_create with a static label and null (serial) attr returns a +1 queue.
    let queue = unsafe { dispatch_queue_create(label.as_ptr(), ptr::null()) };
    // The sink is boxed (stable address) and owned by the Screen; the callbacks reach it through
    // CURRENT_SINK. Publish it before registering so an immediately-delivered callback finds it.
    let sink = Box::new(FrameSink {
        current: Mutex::new(None),
        latest: Mutex::new(None),
    });
    CURRENT_SINK.store((&*sink as *const FrameSink).cast_mut(), Ordering::Release);
    let register_sel = sel!(registerScreenCallbacksWithUUID:callbackQueue:frameCallback:surfacesChangedCallback:propertiesChangedCallback:);
    let mut registered = 0;
    for descriptor in &descriptors {
        let descriptor_ptr = Retained::as_ptr(descriptor).cast_mut();
        if !unsafe { responds_to(descriptor_ptr, register_sel) } {
            continue;
        }
        let frame = callback_block(frame_invoke as *const c_void, &raw const FRAME_DESCRIPTOR);
        let surfaces = callback_block(
            surfaces_invoke as *const c_void,
            &raw const SURFACES_DESCRIPTOR,
        );
        let props = callback_block(props_invoke as *const c_void, &raw const PROPS_DESCRIPTOR);
        // SAFETY: the 5-object-argument registration selector. UUID + queue stay alive in the Screen;
        // the blocks are leaked captureless globals; the sink is reached via CURRENT_SINK.
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
                queue,
                frame,
                surfaces,
                props,
            );
        }
        registered += 1;
    }
    dbg_log!("registered {registered} framebuffer descriptors");
    if registered == 0 {
        CURRENT_SINK.store(ptr::null_mut(), Ordering::Release);
        if !queue.is_null() {
            // SAFETY: nothing adopted the queue; release the +1 from dispatch_queue_create.
            unsafe { CFRelease(queue.cast_const()) };
        }
        return None;
    }
    Some(Screen {
        descriptors,
        uuid,
        sink,
        queue,
    })
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
