//! Resolving a CoreSimulator `SimDevice` object by udid.
//!
//! Recipe ported from baguette's `CoreSimulators.swift`: `SimServiceContext` → default device set →
//! `availableDevices` → match `UDID.UUIDString`. Everything goes through the ObjC runtime; there is
//! no bridging header.

use std::ptr;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::{msg_send, sel};
use objc2_foundation::NSString;

use super::framework;

/// A resolved `SimDevice`, retained for the lifetime of a stream/input session.
pub struct SimDevice {
    pub object: Retained<AnyObject>,
}

// SAFETY: SimDevice objects are thread-safe for the read/HID operations we perform; the sidecar
// serializes writes per device through the mux anyway.
unsafe impl Send for SimDevice {}

impl SimDevice {
    /// Resolve the booted-or-not `SimDevice` for `udid`, or `None` if CoreSimulator can't be reached
    /// or no device matches.
    pub fn resolve(udid: &str) -> Option<SimDevice> {
        framework::load();
        let set = default_device_set()?;
        let devices = available_devices(&set);
        for device in devices {
            if device_udid(&device).as_deref() == Some(udid) {
                return Some(SimDevice { object: device });
            }
        }
        None
    }

    pub fn object_ptr(&self) -> *mut AnyObject {
        Retained::as_ptr(&self.object).cast_mut()
    }
}

fn default_device_set() -> Option<Retained<AnyObject>> {
    let ctx = shared_service_context()?;
    let sel = sel!(defaultDeviceSetWithError:);
    if !responds_to(&ctx, sel) {
        return None;
    }
    let mut err: *mut AnyObject = ptr::null_mut();
    // SAFETY: dynamic message to a method with an `(NSError**)` out-param; we pass a valid slot and
    // ignore the error object. The returned set is autoreleased — retain it to hold across the call.
    let set: *mut AnyObject = unsafe { msg_send![&*ctx, defaultDeviceSetWithError: &mut err] };
    retain(set)
}

fn shared_service_context() -> Option<Retained<AnyObject>> {
    let cls = AnyClass::get(c"SimServiceContext")?;
    let dev = framework::developer_dir();
    let dir = NSString::from_str(&dev.to_string_lossy());
    let mut err: *mut AnyObject = ptr::null_mut();
    // SAFETY: class method with a developer-dir NSString and an `(NSError**)` out-param.
    let ctx: *mut AnyObject =
        unsafe { msg_send![cls, sharedServiceContextForDeveloperDir: &*dir, error: &mut err] };
    retain(ctx)
}

fn available_devices(set: &Retained<AnyObject>) -> Vec<Retained<AnyObject>> {
    let key = NSString::from_str("availableDevices");
    // SAFETY: KVC read returning an NSArray (or nil).
    let array: *mut AnyObject = unsafe { msg_send![&**set, valueForKey: &*key] };
    if array.is_null() {
        return Vec::new();
    }
    // SAFETY: array is an NSArray*; count + objectAtIndex: are its standard accessors.
    let count: usize = unsafe { msg_send![array, count] };
    let mut out = Vec::with_capacity(count);
    for index in 0..count {
        // SAFETY: index < count.
        let device: *mut AnyObject = unsafe { msg_send![array, objectAtIndex: index] };
        if let Some(device) = retain(device) {
            out.push(device);
        }
    }
    out
}

fn device_udid(device: &Retained<AnyObject>) -> Option<String> {
    let key = NSString::from_str("UDID");
    // SAFETY: KVC read returning an NSUUID (or nil).
    let uuid: *mut AnyObject = unsafe { msg_send![&**device, valueForKey: &*key] };
    if uuid.is_null() {
        return None;
    }
    // SAFETY: uuid is an NSUUID*; UUIDString returns an NSString.
    let string: *mut NSString = unsafe { msg_send![uuid, UUIDString] };
    if string.is_null() {
        return None;
    }
    // SAFETY: string is a valid NSString for the duration of this read.
    Some(unsafe { (*string).to_string() })
}

fn responds_to(object: &Retained<AnyObject>, sel: Sel) -> bool {
    // SAFETY: respondsToSelector: is defined on NSObject.
    unsafe { msg_send![&**object, respondsToSelector: sel] }
}

/// Retain a +0 (autoreleased/borrowed) object pointer into an owned `Retained`, or `None` if null.
fn retain(ptr: *mut AnyObject) -> Option<Retained<AnyObject>> {
    if ptr.is_null() {
        return None;
    }
    // SAFETY: ptr is a live ObjC object we did not create; retaining it takes shared ownership.
    unsafe { Retained::retain(ptr) }
}
