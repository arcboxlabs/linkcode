//! Private-framework layer: live framebuffer capture and HID injection via CoreSimulator +
//! SimulatorKit. macOS-only; recipes ported from baguette (Apache-2.0, see the crate NOTICE).
//!
//! Everything here is best-effort and degrades: [`interactive_available`] reports whether the
//! frameworks resolved, and the sidecar falls back to public `simctl` (screenshot polling, no touch)
//! when they don't — so an Xcode without SimulatorKit is view-only, not broken.

pub(crate) mod debug;
mod device;
mod framework;
mod input;
mod screen;

pub use device::SimDevice;
pub use input::{Button, Input};
pub use screen::Screen;

/// Whether this host can drive simulators interactively (private frameworks resolved).
pub fn interactive_available() -> bool {
    framework::load().is_some()
}
