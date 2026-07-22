//! JSON request/response shapes carried by `REQUEST` and `RESULT` frames.
//!
//! Keys are camelCase to match the TypeScript client (`@linkcode/sim`). The op set is the P0
//! simctl surface; screenshot success bytes travel on the binary `SCREENSHOT` frame instead of
//! a JSON result.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// One daemon request: a unique id (daemon-generated) plus the operation to run.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub request_id: String,
    pub op: Op,
}

/// Minimal projection used to recover a request id from a `REQUEST` frame that failed full
/// parsing, so the failure can be reported for just that request instead of dropped silently.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestIdOnly {
    pub request_id: String,
}

/// The P0 operation set. Everything shells out to `xcrun simctl`; no private API.
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Op {
    /// Check that Xcode's simulator tooling is present and report where it lives.
    Probe,
    /// List available simulator devices with their runtimes.
    List,
    /// Boot a device, waiting until it finishes booting.
    Boot { udid: String },
    /// Shut a device down.
    Shutdown { udid: String },
    /// Install an `.app` bundle on a device.
    Install { udid: String, app_path: String },
    /// Launch an installed app by bundle id; resolves to the spawned pid.
    Launch { udid: String, bundle_id: String },
    /// Terminate a running app by bundle id.
    Terminate { udid: String, bundle_id: String },
    /// Open a URL on the device (deep links, Safari).
    OpenUrl { udid: String, url: String },
    /// Capture the device screen; bytes come back on a `SCREENSHOT` frame.
    Screenshot {
        udid: String,
        #[serde(default)]
        format: ImageFormat,
    },
    /// Single-finger tap at a normalised (0..1) point (private API; P1).
    Tap { udid: String, x: f64, y: f64 },
    /// Swipe between two normalised (0..1) points over `duration_ms` (private API; P1).
    Swipe {
        udid: String,
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
        #[serde(default)]
        duration_ms: u64,
    },
    /// Press a hardware button (private API; P1).
    Button { udid: String, button: ButtonKind },
    /// Start streaming the device framebuffer as JPEG `FRAME`s at `fps` (private API; P1).
    StreamStart {
        udid: String,
        #[serde(default = "default_fps")]
        fps: u32,
        #[serde(default = "default_quality")]
        quality: f64,
        #[serde(default = "default_scale")]
        scale: f64,
    },
    /// Stop a running framebuffer stream.
    StreamStop { udid: String },
}

fn default_fps() -> u32 {
    60
}
fn default_quality() -> f64 {
    0.6
}
fn default_scale() -> f64 {
    1.0
}

/// Hardware buttons exposable over the wire (extended as the private HID layer grows).
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ButtonKind {
    Home,
    Lock,
}

/// Screenshot encodings supported by `simctl io screenshot --type`.
#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImageFormat {
    #[default]
    Jpeg,
    Png,
}

impl ImageFormat {
    /// The `--type` value and file extension simctl expects.
    pub fn simctl_name(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Png => "png",
        }
    }
}

/// Why an operation failed, as a stable machine-readable code for the TypeScript client.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// Xcode (or its simulator tooling) is not installed or not selected.
    XcodeMissing,
    /// simctl ran and reported failure.
    SimctlFailed,
    /// simctl did not finish within the operation's deadline.
    Timeout,
    /// The request body could not be parsed.
    InvalidRequest,
    /// Spawning simctl or handling its output failed at the OS level.
    Io,
}

/// A failed operation: a stable code plus a human-readable message (usually simctl's stderr).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpError {
    pub code: ErrorCode,
    pub message: String,
}

impl OpError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Serialize a success `RESULT` body: `{ requestId, ok: true, result }`.
pub fn success_body(request_id: &str, result: Value) -> Vec<u8> {
    body(json!({ "requestId": request_id, "ok": true, "result": result }))
}

/// Serialize a failure `RESULT` body: `{ requestId, ok: false, error: { code, message } }`.
pub fn error_body(request_id: &str, error: &OpError) -> Vec<u8> {
    body(json!({ "requestId": request_id, "ok": false, "error": error }))
}

fn body(value: Value) -> Vec<u8> {
    serde_json::to_vec(&value).expect("response body is valid JSON by construction")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_tagged_op() {
        let req: Request = serde_json::from_slice(
            br#"{"requestId":"r-1","op":{"type":"launch","udid":"U","bundleId":"com.example"}}"#,
        )
        .unwrap();
        assert_eq!(req.request_id, "r-1");
        assert!(
            matches!(req.op, Op::Launch { udid, bundle_id } if udid == "U" && bundle_id == "com.example")
        );
    }

    #[test]
    fn screenshot_format_defaults_to_jpeg() {
        let req: Request =
            serde_json::from_slice(br#"{"requestId":"r-2","op":{"type":"screenshot","udid":"U"}}"#)
                .unwrap();
        assert!(matches!(req.op, Op::Screenshot { format, .. } if format == ImageFormat::Jpeg));
    }

    #[test]
    fn error_body_carries_camel_case_code() {
        let body = error_body("r-3", &OpError::new(ErrorCode::XcodeMissing, "no xcode"));
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "xcodeMissing");
        assert_eq!(value["requestId"], "r-3");
    }
}
