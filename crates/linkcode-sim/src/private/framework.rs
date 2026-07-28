//! Locating and loading the private simulator frameworks.
//!
//! Recipe ported from baguette (Apache-2.0; see crate NOTICE): CoreSimulator lives in a stable
//! system path; SimulatorKit moved from `Contents/Developer/Library/PrivateFrameworks` (Xcode ≤26)
//! up to `Contents/SharedFrameworks` (Xcode 27), so both layouts are probed oldest-first. The IOKit
//! `IOHIDEvent*` symbols are in the dyld shared cache and reachable via `RTLD_DEFAULT` once anything
//! is loaded.

use std::ffi::{CString, c_void};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

const CORE_SIMULATOR: &str =
    "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator";
const SIMKIT_SUFFIX: &str = "SimulatorKit.framework/SimulatorKit";

/// A dlopen handle to SimulatorKit. `None` means no Xcode on this machine carries SimulatorKit —
/// the caller degrades to the public simctl path.
pub struct Frameworks {
    pub simulator_kit: *mut c_void,
}

// SAFETY: the handle is a process-lifetime dlopen result, only ever read to resolve symbols.
unsafe impl Send for Frameworks {}
unsafe impl Sync for Frameworks {}

static FRAMEWORKS: OnceLock<Option<Frameworks>> = OnceLock::new();

/// Load CoreSimulator + SimulatorKit once. Returns `None` when SimulatorKit cannot be found, which
/// the sidecar reports as a non-interactive capability rather than failing.
pub fn load() -> Option<&'static Frameworks> {
    FRAMEWORKS.get_or_init(load_once).as_ref()
}

fn load_once() -> Option<Frameworks> {
    // CoreSimulator is also loaded by simctl-adjacent paths, but load it here so its classes
    // (SimServiceContext, SimDevice) are registered before we message them. Best-effort.
    dlopen(CORE_SIMULATOR);

    let kit_path = simulator_kit_path(&developer_dir())?;
    let simulator_kit = dlopen(&kit_path.to_string_lossy())?;
    Some(Frameworks { simulator_kit })
}

/// Resolve a developer directory that actually contains SimulatorKit: `xcode-select -p` first, then
/// a scan of `/Applications/Xcode*.app`, else the canonical default so a later error names a path
/// the user recognizes.
pub fn developer_dir() -> PathBuf {
    if let Some(dir) = xcode_select_dir()
        && simulator_kit_path(&dir).is_some()
    {
        return dir;
    }
    if let Some(dir) = scan_applications() {
        return dir;
    }
    xcode_select_dir()
        .unwrap_or_else(|| PathBuf::from("/Applications/Xcode.app/Contents/Developer"))
}

/// The candidate SimulatorKit paths for a developer dir, in probe order (Xcode ≤26 then 27).
pub fn simulator_kit_candidates(developer_dir: &Path) -> [PathBuf; 2] {
    let contents = developer_dir.parent().unwrap_or(developer_dir);
    [
        developer_dir.join(format!("Library/PrivateFrameworks/{SIMKIT_SUFFIX}")),
        contents.join(format!("SharedFrameworks/{SIMKIT_SUFFIX}")),
    ]
}

/// The first candidate that exists, or `None` when this Xcode carries no SimulatorKit.
pub fn simulator_kit_path(developer_dir: &Path) -> Option<PathBuf> {
    simulator_kit_candidates(developer_dir)
        .into_iter()
        .find(|path| path.exists())
}

fn xcode_select_dir() -> Option<PathBuf> {
    let output = Command::new("/usr/bin/xcode-select")
        .arg("-p")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let dir = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if dir.is_empty() {
        None
    } else {
        Some(PathBuf::from(dir))
    }
}

fn scan_applications() -> Option<PathBuf> {
    let canonical = PathBuf::from("/Applications/Xcode.app/Contents/Developer");
    if simulator_kit_path(&canonical).is_some() {
        return Some(canonical);
    }
    let mut entries: Vec<_> = std::fs::read_dir("/Applications")
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name())
        .filter_map(|name| name.into_string().ok())
        .filter(|name| name.starts_with("Xcode") && name.ends_with(".app") && name != "Xcode.app")
        .collect();
    entries.sort();
    for app in entries {
        let dir = PathBuf::from(format!("/Applications/{app}/Contents/Developer"));
        if simulator_kit_path(&dir).is_some() {
            return Some(dir);
        }
    }
    None
}

/// `dlopen(path, RTLD_NOW | RTLD_GLOBAL)`; `None` on failure.
fn dlopen(path: &str) -> Option<*mut c_void> {
    let c_path = CString::new(path).ok()?;
    // SAFETY: c_path is a valid NUL-terminated C string kept alive across the call.
    let handle = unsafe { libc::dlopen(c_path.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL) };
    if handle.is_null() { None } else { Some(handle) }
}

/// Resolve a symbol from a specific dlopen handle.
///
/// # Safety
/// The returned pointer is only valid to transmute to the symbol's true ABI; the caller asserts the
/// signature. `handle` must be a live dlopen handle.
pub unsafe fn dlsym(handle: *mut c_void, name: &str) -> Option<*mut c_void> {
    let c_name = CString::new(name).ok()?;
    // SAFETY: forwarded to the caller's contract; c_name outlives the call.
    let sym = unsafe { libc::dlsym(handle, c_name.as_ptr()) };
    if sym.is_null() { None } else { Some(sym) }
}

/// Resolve a symbol from the dyld shared cache (`RTLD_DEFAULT`) — used for the public `IOHIDEvent*`
/// creators that are not in SimulatorKit itself.
///
/// # Safety
/// Same contract as [`dlsym`].
pub unsafe fn dlsym_default(name: &str) -> Option<*mut c_void> {
    let c_name = CString::new(name).ok()?;
    // RTLD_DEFAULT is the special handle (void*)-2 on Darwin.
    let rtld_default = (-2isize) as *mut c_void;
    // SAFETY: forwarded to the caller's contract; c_name outlives the call.
    let sym = unsafe { libc::dlsym(rtld_default, c_name.as_ptr()) };
    if sym.is_null() { None } else { Some(sym) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_cover_both_xcode_layouts() {
        let dir = Path::new("/Applications/Xcode.app/Contents/Developer");
        let candidates = simulator_kit_candidates(dir);
        assert!(
            candidates[0].ends_with(
                "Developer/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
            )
        );
        assert!(
            candidates[1]
                .ends_with("Contents/SharedFrameworks/SimulatorKit.framework/SimulatorKit")
        );
    }
}
