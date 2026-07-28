//! Protocol smoke tests: drive the compiled sidecar over its stdio framing without touching any
//! simulator. Runs on every platform — a machine without Xcode still answers every request with
//! a structured error instead of dying.

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

const REQUEST: u8 = 0x01;
const RESULT: u8 = 0x81;

fn write_frame(w: &mut impl Write, type_byte: u8, body: &[u8]) {
    let total = (1 + body.len()) as u32;
    w.write_all(&total.to_le_bytes()).unwrap();
    w.write_all(&[type_byte]).unwrap();
    w.write_all(body).unwrap();
    w.flush().unwrap();
}

fn read_frame(r: &mut impl Read) -> Option<(u8, Vec<u8>)> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len).ok()?;
    let total = u32::from_le_bytes(len) as usize;
    let mut type_byte = [0u8; 1];
    r.read_exact(&mut type_byte).ok()?;
    let mut body = vec![0u8; total - 1];
    r.read_exact(&mut body).ok()?;
    Some((type_byte[0], body))
}

fn spawn_sidecar() -> (Child, ChildStdin, ChildStdout) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_linkcode-sim"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    (child, stdin, stdout)
}

/// Read RESULT frames until one matches `request_id` or the deadline passes.
fn wait_result(stdout: &mut impl Read, request_id: &str, secs: u64) -> Value {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        let Some((type_byte, body)) = read_frame(stdout) else {
            break;
        };
        if type_byte != RESULT {
            continue;
        }
        let value: Value = serde_json::from_slice(&body).expect("RESULT body is JSON");
        if value["requestId"] == request_id {
            return value;
        }
    }
    panic!("no RESULT for {request_id} within {secs}s");
}

#[test]
fn malformed_request_with_recoverable_id_gets_a_structured_error() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();

    // `type: nope` is not an op; the request must fail alone, with its id echoed back.
    write_frame(
        &mut stdin,
        REQUEST,
        br#"{"requestId":"r-bad","op":{"type":"nope"}}"#,
    );
    let result = wait_result(&mut stdout, "r-bad", 10);
    assert_eq!(result["ok"], false);
    assert_eq!(result["error"]["code"], "invalidRequest");

    // The host must survive: a well-formed request afterwards is still served.
    write_frame(
        &mut stdin,
        REQUEST,
        br#"{"requestId":"r-after","op":{"type":"probe"}}"#,
    );
    let result = wait_result(&mut stdout, "r-after", 60);
    assert_eq!(result["requestId"], "r-after");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn unknown_frame_types_are_ignored() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();

    write_frame(&mut stdin, 0x7F, b"garbage");
    write_frame(
        &mut stdin,
        REQUEST,
        br#"{"requestId":"r-1","op":{"type":"probe"}}"#,
    );
    let result = wait_result(&mut stdout, "r-1", 60);
    assert_eq!(result["requestId"], "r-1");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn probe_reports_tooling_or_a_structured_absence() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();

    write_frame(
        &mut stdin,
        REQUEST,
        br#"{"requestId":"r-probe","op":{"type":"probe"}}"#,
    );
    let result = wait_result(&mut stdout, "r-probe", 60);
    if result["ok"] == true {
        // A Mac with Xcode: the probe pinpoints simctl.
        let simctl_path = result["result"]["simctlPath"].as_str().unwrap();
        assert!(simctl_path.ends_with("simctl"), "got {simctl_path}");
    } else {
        // Everything else: a stable capability-gate code, not a crash.
        assert_eq!(result["error"]["code"], "xcodeMissing");
    }

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn stdin_eof_shuts_the_sidecar_down() {
    let (mut child, stdin, _stdout) = spawn_sidecar();

    drop(stdin);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait().unwrap() {
            Some(status) => {
                assert!(status.success(), "expected a clean exit, got {status}");
                break;
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                panic!("sidecar did not exit on stdin EOF");
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}
