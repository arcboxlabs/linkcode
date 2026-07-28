//! Interface-orientation injection for a booted simulator.
//!
//! Recipe ported from baguette's `PurpleEventOrientation.swift` + `OrientationEvent.swift`
//! (Apache-2.0; see crate NOTICE). Orientation is NOT a SimulatorKit/Indigo HID event — it is a
//! `GSEventTypeDeviceOrientationChanged` mach message delivered to the guest's `PurpleWorkspacePort`,
//! the same path `Simulator.app`'s `-[SimDevice(GSEvents) gsEventsSendOrientation:]` takes. We look
//! the port up by name via `-[SimDevice lookup:error:]`, patch a 112-byte GSEvent buffer, and
//! `mach_msg_send` it. Write-only: GraphicsServices vends no "current orientation" back to the host,
//! and a guest app whose `UISupportedInterfaceOrientations` excludes the target silently keeps its
//! frame — neither is observable here.

use std::ffi::c_void;
use std::ptr;

use objc2::runtime::AnyObject;
use objc2::{msg_send, sel};
use objc2_foundation::NSString;

use super::device::SimDevice;

/// Interface orientation; raw values match `UIInterfaceOrientation` — landscapeRight = 3 and
/// landscapeLeft = 4, the inverse of `UIDeviceOrientation`'s landscape pair (device-left is
/// interface-right). The GSEvent's 4-byte payload at offset 0x4C is exactly this number. Verified on
/// a booted device: portrait → landscapeRight → portraitUpsideDown → landscapeLeft steps a
/// consistent 90° clockwise cycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orientation {
    Portrait = 1,
    PortraitUpsideDown = 2,
    /// Home indicator on the right (rotated 90° CW).
    LandscapeRight = 3,
    /// Home indicator on the left (rotated 90° CCW).
    LandscapeLeft = 4,
}

/// `mach_msg` send-only option (== what `mach_msg_send` passes).
const MACH_SEND_MSG: i32 = 0x0000_0001;
const KERN_SUCCESS: i32 = 0;
/// GSEvent mach-message layout constants (baguette `OrientationEvent`).
const MSGH_BITS_COPY_SEND: u32 = 0x13;
const MSGH_SIZE: u32 = 108;
const GS_MESSAGE_ID: u32 = 0x7B;
/// `GSEventTypeDeviceOrientationChanged (50) | GSEventHostFlag (0x20000)`.
const GS_ORIENTATION_TYPE: u32 = 50 | 0x0002_0000;
const BUFFER_LEN: usize = 112;

unsafe extern "C" {
    /// libSystem `mach_msg(msg, option, send_size, rcv_size, rcv_name, timeout, notify)`.
    fn mach_msg(
        msg: *mut c_void,
        option: i32,
        send_size: u32,
        rcv_size: u32,
        rcv_name: u32,
        timeout: u32,
        notify: u32,
    ) -> i32;
}

impl SimDevice {
    /// Rotate the booted guest to `orientation`. Returns `false` when the device hasn't vended a
    /// `PurpleWorkspacePort` yet (not booted / pre-SpringBoard) or the mach send failed.
    pub fn set_orientation(&self, orientation: Orientation) -> bool {
        let Some(port) = self.lookup_port("PurpleWorkspacePort") else {
            return false;
        };
        let mut buffer = orientation_message(orientation, port);
        // SAFETY: buffer is a live 112-byte GSEvent whose mach header (first 24 bytes) is well-formed
        // and carries a copy-send right to `port`; mach_msg reads only `send_size` (108) bytes.
        let kr = unsafe {
            mach_msg(
                buffer.as_mut_ptr().cast(),
                MACH_SEND_MSG,
                MSGH_SIZE,
                0,
                0,
                0,
                0,
            )
        };
        kr == KERN_SUCCESS
    }

    /// Resolve a mach port from the simulator's bootstrap namespace by name
    /// (`-[SimDevice lookup:error:]`), or `None` when the port is unvended or the selector is absent.
    fn lookup_port(&self, name: &str) -> Option<u32> {
        // SAFETY: respondsToSelector: is defined on NSObject.
        let responds: bool =
            unsafe { msg_send![&*self.object, respondsToSelector: sel!(lookup:error:)] };
        if !responds {
            return None;
        }
        let name = NSString::from_str(name);
        let mut err: *mut AnyObject = ptr::null_mut();
        // SAFETY: dynamic message to `lookup:error:` (guarded above); NSString arg + (NSError**)
        // out-param. Returns a mach_port_t (u32); 0 means the port is not currently vended.
        let port: u32 = unsafe { msg_send![&*self.object, lookup: &*name, error: &mut err] };
        (port != 0).then_some(port)
    }
}

/// Build the 112-byte `PurpleWorkspacePort` GSEvent for `orientation`, with `port` patched into the
/// mach header's remote-port slot.
fn orientation_message(orientation: Orientation, port: u32) -> [u8; BUFFER_LEN] {
    let mut bytes = [0u8; BUFFER_LEN];
    let mut put = |offset: usize, value: u32| {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    };
    put(0x00, MSGH_BITS_COPY_SEND); // msgh_bits
    put(0x04, MSGH_SIZE); // msgh_size
    put(0x08, port); // msgh_remote_port (PurpleWorkspacePort)
    put(0x14, GS_MESSAGE_ID); // msgh_id
    put(0x18, GS_ORIENTATION_TYPE); // GSEvent.type
    put(0x48, 4); // record_info_size
    put(0x4C, orientation as u32); // record_info_data
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_layout_matches_the_gsevent_wire_format() {
        let msg = orientation_message(Orientation::LandscapeLeft, 0xDEAD_BEEF);
        let word = |off: usize| u32::from_le_bytes(msg[off..off + 4].try_into().unwrap());
        assert_eq!(word(0x00), 0x13);
        assert_eq!(word(0x04), 108);
        assert_eq!(word(0x08), 0xDEAD_BEEF);
        assert_eq!(word(0x14), 0x7B);
        assert_eq!(word(0x18), 50 | 0x0002_0000);
        assert_eq!(word(0x48), 4);
        assert_eq!(word(0x4C), 4); // LandscapeLeft
        // The unused location/timestamp span stays zeroed.
        assert!(msg[0x1C..0x48].iter().all(|&b| b == 0));
    }
}
