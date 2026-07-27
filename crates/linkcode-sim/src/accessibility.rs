//! The `describe-ui` op: the guest's accessibility tree, read by a disposable child process.
//!
//! `AXPTranslator` is a private callback ABI, and this crate's rule for those is settled: they run
//! where a crash costs one throwaway process, never in the long-lived server (the capture worker
//! and the device-state watcher follow the same shape). So the server spawns
//! `linkcode-sim ax-worker <udid>`, which prints one JSON tree on stdout and exits.

use serde_json::{Value, json};

use crate::rpc::{ErrorCode, OpError};

/// Ceiling on how long a tree read may take. The walk is a chain of XPC round-trips into the guest,
/// so a wedged app shows up as a slow worker rather than an error.
const WORKER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[cfg(target_os = "macos")]
pub fn describe_ui(udid: &str, max_depth: u32, max_nodes: usize) -> Result<Value, OpError> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let exe = std::env::current_exe()
        .map_err(|err| OpError::new(ErrorCode::SimctlFailed, format!("no worker path: {err}")))?;
    let mut child = Command::new(exe)
        .arg("ax-worker")
        .arg(udid)
        .arg(max_depth.to_string())
        .arg(max_nodes.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| OpError::new(ErrorCode::SimctlFailed, format!("ax worker failed: {err}")))?;

    // The worker writes one JSON document and exits, so reading to EOF is the whole protocol.
    let mut stdout = child.stdout.take().expect("stdout was piped");
    let reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        stdout.read_to_string(&mut buffer).map(|_| buffer)
    });

    let deadline = std::time::Instant::now() + WORKER_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = reader
                    .join()
                    .map_err(|_| {
                        OpError::new(ErrorCode::SimctlFailed, "ax worker reader panicked")
                    })?
                    .map_err(|err| {
                        OpError::new(ErrorCode::SimctlFailed, format!("ax worker read: {err}"))
                    })?;
                if !status.success() {
                    // The worker prints its own reason to stderr, which the daemon logs.
                    return Err(OpError::new(
                        ErrorCode::SimctlFailed,
                        format!("ax worker exited with {status}"),
                    ));
                }
                let tree: Value = serde_json::from_str(&output).map_err(|err| {
                    OpError::new(ErrorCode::SimctlFailed, format!("ax worker output: {err}"))
                })?;
                return Ok(json!({ "tree": tree }));
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(OpError::new(
                        ErrorCode::Timeout,
                        "the accessibility read timed out",
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(err) => {
                return Err(OpError::new(
                    ErrorCode::SimctlFailed,
                    format!("ax worker wait: {err}"),
                ));
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn describe_ui(_udid: &str, _max_depth: u32, _max_nodes: usize) -> Result<Value, OpError> {
    Err(OpError::new(
        ErrorCode::XcodeMissing,
        "accessibility translation is macOS-only",
    ))
}

/// `linkcode-sim ax-worker <udid> [maxDepth] [maxNodes]` — print one tree and exit.
#[cfg(target_os = "macos")]
pub fn run_worker() -> i32 {
    use crate::private::ax;

    let mut args = std::env::args().skip(2);
    let Some(udid) = args.next() else {
        eprintln!("usage: ax-worker <udid> [maxDepth] [maxNodes]");
        return 2;
    };
    let defaults = ax::WalkLimits::default();
    let limits = ax::WalkLimits {
        max_depth: args
            .next()
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(defaults.max_depth),
        max_nodes: args
            .next()
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(defaults.max_nodes),
    };
    match ax::describe(&udid, limits) {
        Ok(tree) => match serde_json::to_string(&tree) {
            Ok(json) => {
                println!("{json}");
                0
            }
            Err(err) => {
                eprintln!("ax-worker: serialize failed: {err}");
                1
            }
        },
        Err(message) => {
            eprintln!("ax-worker: {message}");
            1
        }
    }
}
