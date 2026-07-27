//! The in-simulator accessibility tree, via `AXPTranslator`.
//!
//! Recipe ported from baguette (Apache-2.0; see crate NOTICE). `AXPTranslator` lives in the
//! **system** `/System/Library/PrivateFrameworks`, not Xcode's, and is in the dyld shared cache —
//! so its symbols are invisible to `nm` and only a runtime `dlopen` + `objc_getClass` proves it out.
//!
//! The translator is useless on its own: it reaches the guest's AX service by asking a
//! *bridge-token delegate* for a block that can route an `AXPTranslatorRequest` over the device's
//! XPC channel. Without that delegate installed, every query returns nil. So this module defines a
//! delegate class at runtime and installs it — the one place in this crate that declares an
//! Objective-C class rather than only messaging existing ones.

use std::ffi::{CString, c_ulong, c_void};
use std::ptr;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::time::Duration;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use objc2_core_foundation::CGRect;
use objc2_foundation::NSString;

use super::debug::dbg_log;
use super::device::SimDevice;

const AXP_FRAMEWORK: &str = "/System/Library/PrivateFrameworks/AccessibilityPlatformTranslation.framework/AccessibilityPlatformTranslation";

/// How long one XPC round-trip to the guest's AX service may take before the dispatcher gives up
/// and answers with the empty response. The translator issues many sub-requests per tree walk, so
/// this bounds a hung guest per request, not per walk.
const XPC_TIMEOUT: Duration = Duration::from_secs(10);

/// The device this process serves, reached by the delegate callback.
///
/// The callback runs on AXPTranslator's own thread and must not depend on a captured pointer: the
/// block we hand back is stored by the framework and invoked later, so it is built captureless and
/// reads the device from here instead — the same discipline `screen.rs` uses for its framebuffer
/// callbacks. One `ax-worker` process serves exactly one device, so a single global is precisely
/// right; it is set by [`install`] and never cleared while the process lives.
static CURRENT_DEVICE: AtomicPtr<AnyObject> = AtomicPtr::new(ptr::null_mut());

/// The bridge token this process registered. AXPTranslator echoes it back on every callback; a
/// mismatch means the request belongs to some other registration and is answered empty.
static CURRENT_TOKEN: OnceLock<String> = OnceLock::new();

// dispatch (public): the delegate's XPC round-trip is synchronous, so it needs its own queue plus a
// group to park on until the completion handler fires.
unsafe extern "C" {
    fn dispatch_queue_create(label: *const i8, attr: *const c_void) -> *mut c_void;
    fn dispatch_group_create() -> *mut c_void;
    fn dispatch_group_enter(group: *mut c_void);
    fn dispatch_group_leave(group: *mut c_void);
    fn dispatch_group_wait(group: *mut c_void, timeout: u64) -> isize;
    fn dispatch_time(when: u64, delta: i64) -> u64;
    fn dispatch_release(object: *mut c_void);
    static _NSConcreteGlobalBlock: c_void;
}

/// `DISPATCH_TIME_NOW`.
const DISPATCH_TIME_NOW: u64 = 0;

/// Load the accessibility framework once. `false` means this host cannot translate at all, which
/// the caller reports as an unavailable capability rather than an error.
pub fn available() -> bool {
    static LOADED: OnceLock<bool> = OnceLock::new();
    *LOADED.get_or_init(|| {
        let Ok(path) = CString::new(AXP_FRAMEWORK) else {
            return false;
        };
        // SAFETY: `path` is a valid NUL-terminated C string kept alive across the call.
        let handle = unsafe { libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL) };
        if handle.is_null() {
            dbg_log!("ax: dlopen failed for {AXP_FRAMEWORK}");
            return false;
        }
        AnyClass::get(c"AXPTranslator").is_some()
    })
}

/// Send a parameterless class message that returns an object (`+sharedInstance`, `+emptyResponse`).
///
/// # Safety
/// `sel` must name a class method on `class` taking no arguments and returning an object.
unsafe fn class_object_message(class: &AnyClass, sel: Sel) -> *mut AnyObject {
    // SAFETY: forwarded to this function's contract; the receiver is a live class object.
    unsafe { msg_send![class, performSelector: sel] }
}

/// The framework's typed empty response, or `NSNull` if it cannot be obtained. AXPTranslator
/// re-issues a request answered with `NSNull`, so the typed value is strongly preferred.
fn empty_response() -> *mut AnyObject {
    let Some(class) = AnyClass::get(c"AXPTranslatorResponse") else {
        return null_object();
    };
    // SAFETY: `+emptyResponse` takes no arguments and returns an autoreleased response object.
    let response = unsafe { class_object_message(class, sel!(emptyResponse)) };
    if response.is_null() {
        null_object()
    } else {
        response
    }
}

/// `[NSNull null]` — the last-resort answer when even the typed empty response is unavailable.
fn null_object() -> *mut AnyObject {
    let Some(class) = AnyClass::get(c"NSNull") else {
        return ptr::null_mut();
    };
    // SAFETY: `+null` is NSNull's standard singleton accessor.
    unsafe { class_object_message(class, sel!(null)) }
}

/// Route one `AXPTranslatorRequest` to the guest and block until it answers.
///
/// `SimDevice` only exposes the async form, and AXPTranslator calls us synchronously, so the
/// completion handler parks a dispatch group that this function waits on. A timeout answers empty
/// rather than hanging the translator's thread forever.
fn send_request(device: *mut AnyObject, request: *mut AnyObject) -> *mut AnyObject {
    if device.is_null() {
        return empty_response();
    }
    // SAFETY: respondsToSelector: is defined on NSObject; `device` is the retained SimDevice.
    let responds: bool = unsafe {
        msg_send![device, respondsToSelector: sel!(sendAccessibilityRequestAsync:completionQueue:completionHandler:)]
    };
    if !responds {
        dbg_log!("ax: SimDevice has no sendAccessibilityRequestAsync:");
        return empty_response();
    }

    // SAFETY: dispatch_group_create/dispatch_queue_create return owned objects released below.
    let group = unsafe { dispatch_group_create() };
    let queue = unsafe { dispatch_queue_create(c"linkcode.sim.ax".as_ptr(), ptr::null()) };
    if group.is_null() || queue.is_null() {
        return empty_response();
    }
    // SAFETY: balanced by the `dispatch_group_leave` in the completion block.
    unsafe { dispatch_group_enter(group) };

    // Both the slot and the block live on the heap, not this stack frame: a global block's
    // `Block_copy` is a no-op returning the same pointer, so the callee holds exactly what we hand
    // it. If it fired after a stack-allocated pair went out of scope it would write through dead
    // memory — an intermittent segfault that only shows up when a reply is late.
    let slot = Box::into_raw(Box::new(ResponseSlot {
        response: ptr::null_mut(),
        group,
    }));
    let completion = Box::into_raw(Box::new(completion_block(slot)));
    // SAFETY: the selector's ABI is (request, queue, block); the block and its slot are heap-owned
    // and outlive this call on every path (see the timeout branch below).
    unsafe {
        let _: () = msg_send![
            device,
            sendAccessibilityRequestAsync: request,
            completionQueue: queue,
            completionHandler: completion.cast::<c_void>(),
        ];
    }

    // SAFETY: `dispatch_time` with DISPATCH_TIME_NOW yields an absolute deadline for the wait.
    let deadline = unsafe { dispatch_time(DISPATCH_TIME_NOW, XPC_TIMEOUT.as_nanos() as i64) };
    // SAFETY: `group` is live and entered exactly once.
    let timed_out = unsafe { dispatch_group_wait(group, deadline) } != 0;
    if timed_out {
        // Deliberately leak the slot, the block and the group. The request is still outstanding, so
        // a late reply will run the completion handler; freeing any of the three now would turn a
        // slow guest into a use-after-free. A timeout is rare and the leak is a few words.
        dbg_log!("ax: XPC request timed out after {}s", XPC_TIMEOUT.as_secs());
        // SAFETY: the queue is not referenced by the completion handler, only by dispatch itself.
        unsafe { dispatch_release(queue) };
        return empty_response();
    }

    // The handler has run, so nothing else can reach either allocation.
    // SAFETY: both pointers came from `Box::into_raw` above and are reclaimed exactly once.
    let response = unsafe {
        let slot = Box::from_raw(slot);
        drop(Box::from_raw(completion));
        slot.response
    };
    // SAFETY: created by this function; the handler has finished with the group.
    unsafe {
        dispatch_release(group);
        dispatch_release(queue);
    }
    if response.is_null() {
        empty_response()
    } else {
        response
    }
}

/// Where the completion handler parks its answer. Heap-allocated by `send_request` and reclaimed
/// there once the handler has run — or leaked on timeout, when the handler may still be pending.
struct ResponseSlot {
    response: *mut AnyObject,
    group: *mut c_void,
}

// ── Hand-rolled blocks ──────────────────────────────────────────────────────────────────────────
//
// Same layout as `screen.rs`: a global block with a signature, because the framework reads the
// signature and rejects a signature-less block. The dispatcher's returned block is captureless by
// design (see `CURRENT_DEVICE`); the XPC completion block is the one exception and carries a single
// pointer, which is safe only because its creator blocks until it has run.

#[repr(C)]
struct BlockDescriptor {
    reserved: c_ulong,
    size: c_ulong,
    signature: *const i8,
}

// SAFETY: descriptors are immutable and their signatures are static NUL-terminated strings.
unsafe impl Sync for BlockDescriptor {}

#[repr(C)]
struct CaptureBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: *const c_void,
    descriptor: *const BlockDescriptor,
    /// The one captured word; unused by the captureless dispatcher block.
    context: *mut c_void,
}

const BLOCK_IS_GLOBAL: i32 = 1 << 28;
const BLOCK_HAS_SIGNATURE: i32 = 1 << 30;

/// `void (^)(id)` — the XPC completion handler.
const COMPLETION_SIGNATURE: &[u8] = b"v16@?0@8\0";
/// `id (^)(id)` — the request router the dispatcher hands back to the translator.
const ROUTER_SIGNATURE: &[u8] = b"@16@?0@8\0";

static COMPLETION_DESCRIPTOR: BlockDescriptor = BlockDescriptor {
    reserved: 0,
    size: size_of::<CaptureBlock>() as c_ulong,
    signature: COMPLETION_SIGNATURE.as_ptr().cast::<i8>(),
};
static ROUTER_DESCRIPTOR: BlockDescriptor = BlockDescriptor {
    reserved: 0,
    size: size_of::<CaptureBlock>() as c_ulong,
    signature: ROUTER_SIGNATURE.as_ptr().cast::<i8>(),
};

/// The XPC completion handler: store the response and release the waiter.
unsafe extern "C" fn completion_invoke(block: *mut CaptureBlock, response: *mut AnyObject) {
    // SAFETY: `context` is the `ResponseSlot` pointer this block was built with, and
    // `send_request` blocks on the group until this runs, so the slot is still alive.
    let slot = unsafe { &mut *(*block).context.cast::<ResponseSlot>() };
    if !response.is_null() {
        // SAFETY: the response is autoreleased by the sender; retain it to outlive the callback.
        slot.response = unsafe { msg_send![response, retain] };
    }
    // SAFETY: balances the `dispatch_group_enter` in `send_request`.
    unsafe { dispatch_group_leave(slot.group) };
}

/// The request router handed back to AXPTranslator: captureless, reads the process-global device.
unsafe extern "C" fn router_invoke(
    _block: *mut CaptureBlock,
    request: *mut AnyObject,
) -> *mut AnyObject {
    send_request(CURRENT_DEVICE.load(Ordering::Acquire), request)
}

fn completion_block(slot: *mut ResponseSlot) -> CaptureBlock {
    CaptureBlock {
        isa: (&raw const _NSConcreteGlobalBlock).cast::<c_void>(),
        flags: BLOCK_IS_GLOBAL | BLOCK_HAS_SIGNATURE,
        reserved: 0,
        invoke: completion_invoke as *const c_void,
        descriptor: &raw const COMPLETION_DESCRIPTOR,
        context: slot.cast::<c_void>(),
    }
}

/// The router block, leaked on purpose: AXPTranslator retains it for as long as it keeps the token.
fn router_block() -> *mut c_void {
    let block = Box::new(CaptureBlock {
        isa: (&raw const _NSConcreteGlobalBlock).cast::<c_void>(),
        flags: BLOCK_IS_GLOBAL | BLOCK_HAS_SIGNATURE,
        reserved: 0,
        invoke: router_invoke as *const c_void,
        descriptor: &raw const ROUTER_DESCRIPTOR,
        context: ptr::null_mut(),
    });
    Box::into_raw(block).cast::<c_void>()
}

// ── The runtime-defined delegate ────────────────────────────────────────────────────────────────

/// `-accessibilityTranslationDelegateBridgeCallbackWithToken:` — hand back the router block.
unsafe extern "C" fn bridge_callback(
    _this: &AnyObject,
    _cmd: Sel,
    token: *mut NSString,
) -> *mut c_void {
    if !token_matches(token) {
        dbg_log!("ax: callback for an unregistered token");
    }
    router_block()
}

/// `-accessibilityTranslationConvertPlatformFrameToSystem:withToken:` — the simulator's frame
/// space already is the system space here, so this is the identity.
unsafe extern "C" fn convert_frame(
    _this: &AnyObject,
    _cmd: Sel,
    rect: CGRect,
    _token: *mut NSString,
) -> CGRect {
    rect
}

/// `-accessibilityTranslationRootParentWithToken:` — no synthetic parent above the app.
unsafe extern "C" fn root_parent(
    _this: &AnyObject,
    _cmd: Sel,
    _token: *mut NSString,
) -> *mut AnyObject {
    ptr::null_mut()
}

fn token_matches(token: *mut NSString) -> bool {
    if token.is_null() {
        return false;
    }
    // SAFETY: `token` is a valid NSString for the duration of the callback.
    let value = unsafe { (*token).to_string() };
    CURRENT_TOKEN.get().is_some_and(|current| *current == value)
}

/// Define (once) and instantiate the bridge-token delegate.
fn dispatcher() -> *mut AnyObject {
    static CLASS: OnceLock<usize> = OnceLock::new();
    let class_ptr = *CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSObject").expect("NSObject is always registered");
        let mut builder = ClassBuilder::new(c"LinkCodeAXTokenDispatcher", superclass)
            .expect("the dispatcher class name is unused");
        // SAFETY: each signature matches the selector AXPTranslator invokes it with — an object
        // return for the callback, a CGRect in/out for the frame conversion, an object return for
        // the root parent. Encodings are checked against the runtime by `add_method`.
        unsafe {
            builder.add_method(
                sel!(accessibilityTranslationDelegateBridgeCallbackWithToken:),
                bridge_callback as unsafe extern "C" fn(_, _, _) -> _,
            );
            builder.add_method(
                sel!(accessibilityTranslationConvertPlatformFrameToSystem:withToken:),
                convert_frame as unsafe extern "C" fn(_, _, _, _) -> _,
            );
            builder.add_method(
                sel!(accessibilityTranslationRootParentWithToken:),
                root_parent as unsafe extern "C" fn(_, _, _) -> _,
            );
        }
        ptr::from_ref(builder.register()) as usize
    });
    let class = class_ptr as *const AnyClass;
    // SAFETY: `class` came from `ClassBuilder::register`, which returns a `'static` class.
    unsafe { msg_send![&*class, new] }
}

/// Wire the translator to `udid`'s device and return the shared translator.
///
/// Installing the delegate is not optional: without it every translator query answers nil, because
/// the translator has no way to reach the guest's accessibility service.
pub fn install(udid: &str) -> Option<Retained<AnyObject>> {
    if !available() {
        return None;
    }
    let device = SimDevice::resolve(udid)?;
    // Retained for the process's lifetime: the router block reads it on the translator's thread.
    // SAFETY: `object_ptr` is the live SimDevice; retaining it keeps it valid past this scope.
    let retained: *mut AnyObject = unsafe { msg_send![device.object_ptr(), retain] };
    CURRENT_DEVICE.store(retained, Ordering::Release);
    let token = format!("linkcode-{udid}");
    let _ = CURRENT_TOKEN.set(token);

    let class = AnyClass::get(c"AXPTranslator")?;
    // SAFETY: `+sharedInstance` takes no arguments and returns the singleton translator.
    let translator = unsafe { class_object_message(class, sel!(sharedInstance)) };
    if translator.is_null() {
        dbg_log!("ax: +sharedInstance returned nil");
        return None;
    }
    let key = NSString::from_str("bridgeTokenDelegate");
    let delegate = dispatcher();
    // SAFETY: KVC write of an object value onto the translator singleton.
    unsafe {
        let _: () = msg_send![translator, setValue: delegate, forKey: &*key];
    }
    dbg_log!("ax: translator wired for {udid}");
    // SAFETY: the singleton is owned by the framework; retain it for the returned handle.
    Some(unsafe { Retained::retain(translator)? })
}

/// The token this process registered, for the translator entry points that take one.
pub fn token() -> Option<&'static str> {
    CURRENT_TOKEN.get().map(String::as_str)
}

/// The frontmost application element on `display`, or `None` when the translator cannot reach it.
pub fn frontmost_application(translator: &AnyObject, display: u32) -> Option<Retained<AnyObject>> {
    let token = NSString::from_str(token()?);
    // SAFETY: the selector takes (uint32 displayId, NSString *token) and returns an element.
    let element: *mut AnyObject = unsafe {
        msg_send![translator, frontmostApplicationWithDisplayId: display, bridgeDelegateToken: &*token]
    };
    if element.is_null() {
        return None;
    }
    // SAFETY: the returned element is autoreleased; retain it to outlive the pool.
    unsafe { Retained::retain(element) }
}

/// Convert a translation object into the readable `AXPMacPlatformElement`. The translator hands
/// back opaque translations; only the platform element answers the accessibility properties.
pub fn platform_element(
    translator: &AnyObject,
    translation: &AnyObject,
) -> Option<Retained<AnyObject>> {
    // SAFETY: the selector takes a translation and returns an autoreleased platform element.
    let element: *mut AnyObject =
        unsafe { msg_send![translator, macPlatformElementFromTranslation: translation] };
    if element.is_null() {
        return None;
    }
    // SAFETY: autoreleased; retained so it outlives the enclosing pool.
    unsafe { Retained::retain(element) }
}

/// One node of the guest's accessibility tree, in device points.
///
/// Coordinates stay in points here; normalizing against the screen is the caller's job, because
/// only it knows the device size the agent's tap coordinates are expressed against.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxNode {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subrole: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// `[x, y, width, height]` in device points.
    pub frame: [f64; 4],
    /// The frame's centre as `[x, y]` normalized 0..1 against the screen — the exact shape the
    /// tap/swipe tools take, so an agent can act on a node without knowing the device's size.
    /// Absent when the root reported no usable screen size.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center: Option<[f64; 2]>,
    pub enabled: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub focused: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<AxNode>,
}

/// Caps on a serialized tree. A deep SwiftUI hierarchy can run to thousands of nodes, which would
/// blow an agent's tool-result budget long before it became useful.
#[derive(Debug, Clone, Copy)]
pub struct WalkLimits {
    pub max_depth: u32,
    pub max_nodes: usize,
}

impl Default for WalkLimits {
    fn default() -> Self {
        Self {
            max_depth: 24,
            max_nodes: 800,
        }
    }
}

/// Read a non-empty string property by KVC. `NSNumber` values are coerced so numeric
/// `accessibilityValue`s (sliders, progress) surface as stable strings.
fn string_property(element: &AnyObject, key: &str) -> Option<String> {
    let key = NSString::from_str(key);
    // SAFETY: KVC read returning any object (or nil).
    let raw: *mut AnyObject = unsafe { msg_send![element, valueForKey: &*key] };
    if raw.is_null() {
        return None;
    }
    let string_class = AnyClass::get(c"NSString")?;
    // SAFETY: isKindOfClass: is defined on NSObject.
    let is_string: bool = unsafe { msg_send![raw, isKindOfClass: string_class] };
    let text = if is_string {
        // SAFETY: `raw` is an NSString for the duration of this read.
        unsafe { (*raw.cast::<NSString>()).to_string() }
    } else {
        let number_class = AnyClass::get(c"NSNumber")?;
        // SAFETY: isKindOfClass: is defined on NSObject.
        let is_number: bool = unsafe { msg_send![raw, isKindOfClass: number_class] };
        if !is_number {
            return None;
        }
        // SAFETY: NSNumber answers `stringValue` with an autoreleased NSString.
        let value: *mut NSString = unsafe { msg_send![raw, stringValue] };
        if value.is_null() {
            return None;
        }
        // SAFETY: valid for the duration of this read.
        unsafe { (*value).to_string() }
    };
    if text.is_empty() { None } else { Some(text) }
}

/// Read a bool property by KVC, falling back when the key is missing or not a number.
fn bool_property(element: &AnyObject, key: &str, fallback: bool) -> bool {
    let key = NSString::from_str(key);
    // SAFETY: KVC read returning any object (or nil).
    let raw: *mut AnyObject = unsafe { msg_send![element, valueForKey: &*key] };
    if raw.is_null() {
        return fallback;
    }
    let Some(number_class) = AnyClass::get(c"NSNumber") else {
        return fallback;
    };
    // SAFETY: isKindOfClass: is defined on NSObject.
    let is_number: bool = unsafe { msg_send![raw, isKindOfClass: number_class] };
    if !is_number {
        return fallback;
    }
    // SAFETY: NSNumber answers boolValue.
    unsafe { msg_send![raw, boolValue] }
}

/// `accessibilityFrame` returns a CGRect, which cannot ride KVC's object return — message it
/// directly. Elements that do not answer the selector report an empty frame.
fn frame_property(element: &AnyObject) -> [f64; 4] {
    // SAFETY: respondsToSelector: is defined on NSObject.
    let responds: bool =
        unsafe { msg_send![element, respondsToSelector: sel!(accessibilityFrame)] };
    if !responds {
        return [0.0; 4];
    }
    // SAFETY: the selector is declared to return a CGRect by value.
    let rect: CGRect = unsafe { msg_send![element, accessibilityFrame] };
    [
        rect.origin.x,
        rect.origin.y,
        rect.size.width,
        rect.size.height,
    ]
}

/// Walk the whole tree from the application root.
///
/// The root's own frame is the screen size in points, which is what every node's normalized centre
/// is computed against — so the caller needs no separate notion of how big the device is.
pub fn walk_tree(root: &AnyObject, limits: WalkLimits) -> AxNode {
    let screen = frame_property(root);
    let size = (screen[2] > 0.0 && screen[3] > 0.0).then_some((screen[2], screen[3]));
    let mut budget = limits.max_nodes;
    walk(root, limits, &mut budget, size)
}

/// Walk `element` and its descendants into a serializable tree, stopping at `limits`.
///
/// `budget` is shared across the whole walk (not per level), so a wide tree truncates as decisively
/// as a deep one and the result always fits the caller's cap.
fn walk(
    element: &AnyObject,
    limits: WalkLimits,
    budget: &mut usize,
    screen: Option<(f64, f64)>,
) -> AxNode {
    let frame = frame_property(element);
    let node = AxNode {
        role: string_property(element, "accessibilityRole")
            .unwrap_or_else(|| "AXUnknown".to_owned()),
        subrole: string_property(element, "accessibilitySubrole"),
        label: string_property(element, "accessibilityLabel"),
        value: string_property(element, "accessibilityValue"),
        identifier: string_property(element, "accessibilityIdentifier"),
        title: string_property(element, "accessibilityTitle"),
        frame,
        center: screen.map(|(width, height)| {
            [
                ((frame[0] + frame[2] / 2.0) / width).clamp(0.0, 1.0),
                ((frame[1] + frame[3] / 2.0) / height).clamp(0.0, 1.0),
            ]
        }),
        enabled: bool_property(element, "accessibilityEnabled", true)
            || bool_property(element, "isAccessibilityEnabled", false),
        focused: bool_property(element, "isAccessibilityFocused", false)
            || bool_property(element, "accessibilityFocused", false),
        children: Vec::new(),
    };
    *budget = budget.saturating_sub(1);
    if limits.max_depth == 0 || *budget == 0 {
        return node;
    }

    let key = NSString::from_str("accessibilityChildren");
    // SAFETY: KVC read returning an NSArray (or nil).
    let raw: *mut AnyObject = unsafe { msg_send![element, valueForKey: &*key] };
    if raw.is_null() {
        return node;
    }
    // SAFETY: `raw` is an NSArray; count is its standard accessor.
    let count: usize = unsafe { msg_send![raw, count] };
    let deeper = WalkLimits {
        max_depth: limits.max_depth - 1,
        ..limits
    };
    let mut node = node;
    for index in 0..count {
        if *budget == 0 {
            break;
        }
        // SAFETY: index < count.
        let child: *mut AnyObject = unsafe { msg_send![raw, objectAtIndex: index] };
        if child.is_null() {
            continue;
        }
        // SAFETY: the child is owned by the array, which outlives this loop.
        node.children
            .push(walk(unsafe { &*child }, deeper, budget, screen));
    }
    node
}
