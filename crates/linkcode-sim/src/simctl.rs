//! The `xcrun simctl` driver: every P0 operation shells out to Apple's public simulator CLI.
//!
//! Each call runs under a deadline; a child that outlives it is killed and reported as
//! [`ErrorCode::Timeout`]. A missing `xcrun` (no Xcode / no Command Line Tools) surfaces as
//! [`ErrorCode::XcodeMissing`] so the daemon can gate the capability instead of retrying.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::rpc::{ErrorCode, ImageFormat, OpError};

/// Booting waits for the device to finish (`bootstatus -b`), which dominates this deadline.
const BOOT_TIMEOUT: Duration = Duration::from_secs(180);
/// Large `.app` bundles take a while to copy into the device's container.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(120);
const SCREENSHOT_TIMEOUT: Duration = Duration::from_secs(30);
/// Everything else is quick command dispatch against CoreSimulatorService.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// Apple's OS-provided shims, by absolute path: PATH can carry non-Apple `xcrun` stand-ins
/// (e.g. nix xcbuild's) that fail SDK/utility resolution, and the daemon does not control the
/// environment it was launched from. `/usr/bin/xcrun` ships with macOS itself, not Xcode.
const XCRUN: &str = "/usr/bin/xcrun";
const XCODE_SELECT: &str = "/usr/bin/xcode-select";

/// One available simulator device, flattened from `simctl list -j`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub udid: String,
    pub name: String,
    /// CoreSimulator state string: `Shutdown`, `Booted`, `Booting`, …
    pub state: String,
    /// Runtime identifier, e.g. `com.apple.CoreSimulator.SimRuntime.iOS-26-5`.
    pub runtime: String,
    /// Human-readable runtime name, e.g. `iOS 26.5`, when the runtime section lists it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_name: Option<String>,
    pub device_type: Option<String>,
}

/// Check that simulator tooling is usable and report where it lives.
pub fn probe() -> Result<Value, OpError> {
    let mut find_simctl = apple_tool(XCRUN);
    find_simctl.args(["--find", "simctl"]);
    let simctl_path = run_ok(find_simctl, DEFAULT_TIMEOUT).map_err(|e| match e.code {
        // xcrun exists but cannot find simctl: Xcode's iOS platform is missing.
        ErrorCode::SimctlFailed => OpError::new(ErrorCode::XcodeMissing, e.message),
        _ => e,
    })?;
    let mut developer_dir_cmd = apple_tool(XCODE_SELECT);
    developer_dir_cmd.arg("-p");
    let developer_dir = run_ok(developer_dir_cmd, DEFAULT_TIMEOUT)?;
    Ok(json!({
        "simctlPath": simctl_path.trim(),
        "developerDir": developer_dir.trim(),
        // Interactive framebuffer/HID needs SimulatorKit; simctl alone can't stream a screen or
        // inject touches. Report it so clients gate the live panel instead of mounting a stream that
        // only ever fails. The private layer resolves exactly when interactive drive is possible.
        "interactive": interactive_supported(),
    }))
}

/// Whether this host can drive simulators interactively (framebuffer stream + HID), which requires
/// the private SimulatorKit layer beyond the public `simctl` CLI. Non-macOS builds never can.
#[cfg(target_os = "macos")]
fn interactive_supported() -> bool {
    crate::private::interactive_available()
}

#[cfg(not(target_os = "macos"))]
fn interactive_supported() -> bool {
    false
}

/// List available devices with their runtime names.
pub fn list() -> Result<Value, OpError> {
    let raw = run_ok(
        simctl(["list", "-j", "devices", "available"]),
        DEFAULT_TIMEOUT,
    )?;
    let runtimes_raw = run_ok(simctl(["list", "-j", "runtimes"]), DEFAULT_TIMEOUT)?;
    let devices = parse_device_list(&raw, &runtimes_raw)
        .map_err(|message| OpError::new(ErrorCode::SimctlFailed, message))?;
    Ok(json!({ "devices": devices }))
}

/// Boot a device and wait until it reports fully booted. Already-booted devices succeed.
pub fn boot(udid: &str) -> Result<Value, OpError> {
    match run_ok(simctl(["boot", udid]), DEFAULT_TIMEOUT) {
        Ok(_) => {}
        // `simctl boot` on a booted device exits non-zero; that state is our goal, not an error.
        Err(e) if e.message.contains("current state: Booted") => return Ok(json!({})),
        Err(e) => return Err(e),
    }
    run_ok(simctl(["bootstatus", udid, "-b"]), BOOT_TIMEOUT)?;
    Ok(json!({}))
}

/// Shut a device down. Already-shutdown devices succeed.
pub fn shutdown(udid: &str) -> Result<Value, OpError> {
    match run_ok(simctl(["shutdown", udid]), DEFAULT_TIMEOUT) {
        Ok(_) => Ok(json!({})),
        Err(e) if e.message.contains("current state: Shutdown") => Ok(json!({})),
        Err(e) => Err(e),
    }
}

/// Install an `.app` bundle.
pub fn install(udid: &str, app_path: &str) -> Result<Value, OpError> {
    run_ok(simctl(["install", udid, app_path]), INSTALL_TIMEOUT)?;
    Ok(json!({}))
}

/// Launch an app by bundle id; returns the spawned pid.
pub fn launch(udid: &str, bundle_id: &str) -> Result<Value, OpError> {
    let stdout = run_ok(simctl(["launch", udid, bundle_id]), DEFAULT_TIMEOUT)?;
    Ok(json!({ "pid": parse_launch_pid(&stdout) }))
}

/// Terminate a running app by bundle id.
pub fn terminate(udid: &str, bundle_id: &str) -> Result<Value, OpError> {
    run_ok(simctl(["terminate", udid, bundle_id]), DEFAULT_TIMEOUT)?;
    Ok(json!({}))
}

/// Open a URL on the device.
pub fn open_url(udid: &str, url: &str) -> Result<Value, OpError> {
    run_ok(simctl(["openurl", udid, url]), DEFAULT_TIMEOUT)?;
    Ok(json!({}))
}

/// Capture the device screen and return the encoded image bytes.
///
/// simctl writes to a file, not a pipe, so this stages through a unique temp path and always
/// removes it — including on the error paths.
pub fn screenshot(udid: &str, format: ImageFormat) -> Result<Vec<u8>, OpError> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "linkcode-sim-{}-{}.{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed),
        format.simctl_name(),
    ));
    let type_arg = format!("--type={}", format.simctl_name());
    let mut cmd = simctl(["io", udid, "screenshot", &type_arg]);
    cmd.arg(&path);
    let run = run_ok(cmd, SCREENSHOT_TIMEOUT);
    let read = run.and_then(|_| {
        std::fs::read(&path)
            .map_err(|e| OpError::new(ErrorCode::Io, format!("read screenshot {path:?}: {e}")))
    });
    let _ = std::fs::remove_file(&path);
    read
}

/// Resolve a device's devicetype bundle directory (`…/DeviceTypes/<name>.simdevicetype`),
/// joining `list devices` (udid → devicetype identifier) with `list devicetypes` (identifier →
/// `bundlePath`). Public simctl surface only.
pub fn device_type_bundle_path(udid: &str) -> Result<std::path::PathBuf, OpError> {
    let devices_raw = run_ok(
        simctl(["list", "-j", "devices", "available"]),
        DEFAULT_TIMEOUT,
    )?;
    let identifier = parse_device_type_identifier(&devices_raw, udid)
        .map_err(|message| OpError::new(ErrorCode::SimctlFailed, message))?;
    let types_raw = run_ok(simctl(["list", "-j", "devicetypes"]), DEFAULT_TIMEOUT)?;
    parse_device_type_bundle_path(&types_raw, &identifier)
        .map(std::path::PathBuf::from)
        .map_err(|message| OpError::new(ErrorCode::SimctlFailed, message))
}

/// Set the device pasteboard to `text` (public `simctl pbcopy`, fed on stdin). The client pairs
/// this with a Cmd+V key press to inject arbitrary Unicode — the path US-ASCII key decomposition
/// cannot cover (IME output, emoji, pasted blocks).
pub fn set_pasteboard(udid: &str, text: &str) -> Result<Value, OpError> {
    let mut child = simctl(["pbcopy", udid])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => OpError::new(
                ErrorCode::XcodeMissing,
                format!("{XCRUN} not found; install Xcode with the iOS platform"),
            ),
            _ => OpError::new(ErrorCode::Io, format!("spawn {XCRUN} pbcopy: {e}")),
        })?;
    // Write on a thread so a full pipe buffer can never deadlock against exit polling.
    let stdin = child.stdin.take().expect("stdin piped above");
    let bytes = text.as_bytes().to_vec();
    let writer = thread::spawn(move || {
        let mut stdin = stdin;
        let _ = stdin.write_all(&bytes);
        // Drop closes the pipe so pbcopy sees EOF.
    });
    let stderr = drain(child.stderr.take().expect("stderr piped above"));
    let status = wait_with_timeout(&mut child, XCRUN, DEFAULT_TIMEOUT)?;
    let _ = writer.join();
    if status.success() {
        Ok(json!({}))
    } else {
        Err(OpError::new(
            ErrorCode::SimctlFailed,
            format!(
                "{XCRUN} pbcopy exited with {status}: {}",
                join_drained(stderr).trim()
            ),
        ))
    }
}

fn simctl<'a>(args: impl IntoIterator<Item = &'a str>) -> Command {
    let mut cmd = apple_tool(XCRUN);
    cmd.arg("simctl").args(args);
    cmd
}

/// Build a `Command` for an Apple tool at an absolute path, scrubbing the SDK-selection overrides a
/// launcher may have injected. `/usr/bin/xcrun` honors inherited `DEVELOPER_DIR`/`SDKROOT`, so a
/// foreign selection (nix xcbuild, a stale toolchain in the daemon's environment) makes `--find`,
/// `list`, `boot`, and the rest fail — reporting `xcodeMissing` — even with a full Xcode installed.
/// Every Apple-tool spawn must go through here (the device-loop fixture removes the same two vars).
fn apple_tool(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env_remove("DEVELOPER_DIR").env_remove("SDKROOT");
    cmd
}

/// Run a command to completion under `timeout`; return its stdout on exit code 0, or a
/// classified [`OpError`] otherwise. stderr rides along in the error message.
fn run_ok(mut cmd: Command, timeout: Duration) -> Result<String, OpError> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                OpError::new(
                    ErrorCode::XcodeMissing,
                    format!("{program} not found; install Xcode with the iOS platform"),
                )
            } else {
                OpError::new(ErrorCode::Io, format!("spawn {program}: {e}"))
            }
        })?;

    // Drain both pipes on their own threads so a chatty child can never fill a pipe buffer and
    // deadlock against our exit polling.
    let stdout = drain(child.stdout.take().expect("stdout piped above"));
    let stderr = drain(child.stderr.take().expect("stderr piped above"));

    let status = wait_with_timeout(&mut child, &program, timeout)?;

    let stdout = join_drained(stdout);
    let stderr = join_drained(stderr);
    if status.success() {
        Ok(stdout)
    } else {
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        Err(OpError::new(
            ErrorCode::SimctlFailed,
            format!("{program} exited with {status}: {}", detail.trim()),
        ))
    }
}

/// Wait for `child` under `timeout`; kill and report `Timeout` if it overruns.
fn wait_with_timeout(
    child: &mut std::process::Child,
    program: &str,
    timeout: Duration,
) -> Result<std::process::ExitStatus, OpError> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(OpError::new(
                    ErrorCode::Timeout,
                    format!("{program} timed out after {}s", timeout.as_secs()),
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(OpError::new(ErrorCode::Io, format!("wait {program}: {e}"))),
        }
    }
}

fn drain(mut pipe: impl Read + Send + 'static) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = pipe.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    })
}

fn join_drained(handle: thread::JoinHandle<String>) -> String {
    handle.join().unwrap_or_default()
}

/// `simctl launch` prints `<bundle id>: <pid>`; splitting on the last `: ` is safe because
/// bundle ids never contain one. Absence of a parsable pid maps to `null`.
fn parse_launch_pid(stdout: &str) -> Option<u32> {
    stdout.trim().rsplit(": ").next()?.trim().parse().ok()
}

fn parse_device_type_identifier(devices_json: &str, udid: &str) -> Result<String, String> {
    let raw: RawDeviceList =
        serde_json::from_str(devices_json).map_err(|e| format!("parse device list: {e}"))?;
    raw.devices
        .into_values()
        .flatten()
        .find(|device| device.udid == udid)
        .ok_or_else(|| format!("no device {udid}"))?
        .device_type_identifier
        .ok_or_else(|| format!("device {udid} reports no devicetype identifier"))
}

#[derive(Deserialize)]
struct RawDeviceTypeList {
    devicetypes: Vec<RawDeviceType>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDeviceType {
    identifier: String,
    bundle_path: Option<String>,
}

fn parse_device_type_bundle_path(types_json: &str, identifier: &str) -> Result<String, String> {
    let raw: RawDeviceTypeList =
        serde_json::from_str(types_json).map_err(|e| format!("parse devicetype list: {e}"))?;
    raw.devicetypes
        .into_iter()
        .find(|entry| entry.identifier == identifier)
        .ok_or_else(|| format!("no devicetype {identifier}"))?
        .bundle_path
        .ok_or_else(|| format!("devicetype {identifier} reports no bundle path"))
}

#[derive(Deserialize)]
struct RawDeviceList {
    devices: std::collections::HashMap<String, Vec<RawDevice>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDevice {
    udid: String,
    name: String,
    state: String,
    device_type_identifier: Option<String>,
}

#[derive(Deserialize)]
struct RawRuntimeList {
    runtimes: Vec<RawRuntime>,
}

#[derive(Deserialize)]
struct RawRuntime {
    identifier: String,
    name: String,
}

fn parse_device_list(devices_json: &str, runtimes_json: &str) -> Result<Vec<Device>, String> {
    let raw: RawDeviceList =
        serde_json::from_str(devices_json).map_err(|e| format!("parse device list: {e}"))?;
    let runtimes: RawRuntimeList =
        serde_json::from_str(runtimes_json).map_err(|e| format!("parse runtime list: {e}"))?;
    let runtime_names: std::collections::HashMap<&str, &str> = runtimes
        .runtimes
        .iter()
        .map(|r| (r.identifier.as_str(), r.name.as_str()))
        .collect();

    let mut out = Vec::new();
    for (runtime, devices) in raw.devices {
        for device in devices {
            out.push(Device {
                udid: device.udid,
                name: device.name,
                state: device.state,
                runtime_name: runtime_names.get(runtime.as_str()).map(|s| s.to_string()),
                runtime: runtime.clone(),
                device_type: device.device_type_identifier,
            });
        }
    }
    // simctl's map ordering is unstable; sort so equal worlds serialize equally.
    out.sort_by(|a, b| (&a.runtime, &a.name).cmp(&(&b.runtime, &b.name)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICES: &str = r#"{
        "devices": {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
                {
                    "udid": "AAAA",
                    "name": "iPhone 17 Pro",
                    "state": "Shutdown",
                    "isAvailable": true,
                    "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
                }
            ]
        }
    }"#;
    const RUNTIMES: &str = r#"{
        "runtimes": [
            {
                "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
                "name": "iOS 26.5",
                "isAvailable": true
            }
        ]
    }"#;

    #[test]
    fn flattens_devices_and_resolves_runtime_names() {
        let devices = parse_device_list(DEVICES, RUNTIMES).unwrap();
        assert_eq!(devices.len(), 1);
        let device = &devices[0];
        assert_eq!(device.udid, "AAAA");
        assert_eq!(device.state, "Shutdown");
        assert_eq!(device.runtime_name.as_deref(), Some("iOS 26.5"));
        assert_eq!(
            device.device_type.as_deref(),
            Some("com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro")
        );
    }

    #[test]
    fn unknown_runtimes_flatten_without_a_name() {
        let devices = parse_device_list(DEVICES, r#"{"runtimes":[]}"#).unwrap();
        assert_eq!(devices[0].runtime_name, None);
    }

    #[test]
    fn parses_the_launch_pid() {
        assert_eq!(parse_launch_pid("com.example.app: 4242\n"), Some(4242));
        assert_eq!(parse_launch_pid("garbage"), None);
    }

    #[test]
    fn resolves_a_device_type_identifier_by_udid() {
        assert_eq!(
            parse_device_type_identifier(DEVICES, "AAAA").unwrap(),
            "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
        );
        assert!(parse_device_type_identifier(DEVICES, "missing").is_err());
    }

    #[test]
    fn resolves_a_device_type_bundle_path() {
        let types = r#"{
            "devicetypes": [
                {
                    "identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
                    "bundlePath": "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 17 Pro.simdevicetype",
                    "name": "iPhone 17 Pro"
                }
            ]
        }"#;
        assert_eq!(
            parse_device_type_bundle_path(
                types,
                "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
            )
            .unwrap(),
            "/Library/Developer/CoreSimulator/Profiles/DeviceTypes/iPhone 17 Pro.simdevicetype"
        );
        assert!(parse_device_type_bundle_path(types, "other").is_err());
    }
}
