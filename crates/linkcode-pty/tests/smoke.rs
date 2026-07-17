//! End-to-end smoke test: drive the compiled sidecar over its stdio protocol against a real shell.
#![cfg(unix)]

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

const OPEN: u8 = 0x01;
const INPUT: u8 = 0x02;
const CLOSE: u8 = 0x04;
const OPENED: u8 = 0x81;
const OUTPUT: u8 = 0x82;
const EXIT: u8 = 0x83;
const ERROR: u8 = 0x84;

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

fn data_body(id: &str, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&(id.len() as u16).to_le_bytes());
    out.extend_from_slice(id.as_bytes());
    out.extend_from_slice(data);
    out
}

fn frame_text(body: &[u8]) -> String {
    split_data(body).1
}

/// Split a data-frame body into its terminal id and payload text. Only meaningful for INPUT/OUTPUT
/// bodies; JSON control frames have no id prefix.
fn split_data(body: &[u8]) -> (String, String) {
    let id_len = u16::from_le_bytes([body[0], body[1]]) as usize;
    let id = String::from_utf8_lossy(&body[2..2 + id_len]).into_owned();
    let data = String::from_utf8_lossy(&body[2 + id_len..]).into_owned();
    (id, data)
}

fn spawn_sidecar() -> (Child, ChildStdin, ChildStdout) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_linkcode-pty"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    (child, stdin, stdout)
}

/// Read frames until `handle` returns true or `secs` elapse; returns whether it matched.
fn wait_for(stdout: &mut impl Read, secs: u64, mut handle: impl FnMut(u8, &[u8]) -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        match read_frame(stdout) {
            Some((type_byte, body)) => {
                if handle(type_byte, &body) {
                    return true;
                }
            }
            None => return false,
        }
    }
    false
}

#[test]
fn spawns_shell_echoes_input_and_exits() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_linkcode-pty"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();

    let id = "t-1";
    write_frame(
        &mut stdin,
        OPEN,
        format!(r#"{{"terminalId":"{id}","cols":80,"rows":24,"cmd":"/bin/sh","args":[]}}"#)
            .as_bytes(),
    );

    // The first frame is always OPENED for our id.
    let (type_byte, body) = read_frame(&mut stdout).expect("opened frame");
    assert_eq!(type_byte, OPENED);
    assert!(String::from_utf8_lossy(&body).contains(id));

    // A command's echoed output must round-trip back on OUTPUT frames.
    write_frame(&mut stdin, INPUT, &data_body(id, b"echo linkcode-marker\n"));
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = String::new();
    while Instant::now() < deadline && !seen.contains("linkcode-marker") {
        match read_frame(&mut stdout) {
            Some((OUTPUT, body)) => seen.push_str(&frame_text(&body)),
            Some(_) => {}
            None => break,
        }
    }
    assert!(
        seen.contains("linkcode-marker"),
        "no echoed output; saw {seen:?}"
    );

    // Closing the terminal kills the shell, which surfaces as an EXIT frame.
    write_frame(
        &mut stdin,
        CLOSE,
        format!(r#"{{"terminalId":"{id}"}}"#).as_bytes(),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut exited = false;
    while Instant::now() < deadline {
        match read_frame(&mut stdout) {
            Some((EXIT, body)) => {
                assert!(String::from_utf8_lossy(&body).contains(id));
                exited = true;
                break;
            }
            Some(_) => {}
            None => break,
        }
    }
    assert!(exited, "expected EXIT frame after close");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn duplicate_terminal_ids_are_rejected() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_linkcode-pty"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();

    let id = "t-1";
    let open = format!(r#"{{"terminalId":"{id}","cols":80,"rows":24,"cmd":"/bin/sh","args":[]}}"#);
    write_frame(&mut stdin, OPEN, open.as_bytes());
    let (type_byte, body) = read_frame(&mut stdout).expect("opened frame");
    assert_eq!(type_byte, OPENED);
    assert!(String::from_utf8_lossy(&body).contains(id));

    write_frame(&mut stdin, OPEN, open.as_bytes());

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut rejected = false;
    while Instant::now() < deadline {
        match read_frame(&mut stdout) {
            Some((ERROR, body)) => {
                let body = String::from_utf8_lossy(&body);
                assert!(body.contains(id));
                assert!(body.contains("already exists"));
                rejected = true;
                break;
            }
            Some(_) => {}
            None => break,
        }
    }
    assert!(rejected, "expected ERROR frame for duplicate terminal id");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn shutdown_flushes_a_final_exit_frame() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_linkcode-pty"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn sidecar");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();

    let id = "t-shutdown";
    write_frame(
        &mut stdin,
        OPEN,
        format!(r#"{{"terminalId":"{id}","cols":80,"rows":24,"cmd":"/bin/sh","args":[]}}"#)
            .as_bytes(),
    );
    let (type_byte, _) = read_frame(&mut stdout).expect("opened frame");
    assert_eq!(type_byte, OPENED);

    // Control-pipe EOF triggers shutdown, which must join the reader *before* stopping the
    // writer so the final EXIT frame is flushed rather than raced away.
    drop(stdin);
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut exited = false;
    while Instant::now() < deadline {
        match read_frame(&mut stdout) {
            Some((EXIT, body)) => {
                assert!(String::from_utf8_lossy(&body).contains(id));
                exited = true;
                break;
            }
            Some(_) => {}
            None => break,
        }
    }
    assert!(
        exited,
        "expected a final EXIT frame to be flushed on shutdown"
    );

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn multiplexes_two_terminals_without_crosstalk() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();

    for id in ["t-1", "t-2"] {
        write_frame(
            &mut stdin,
            OPEN,
            format!(r#"{{"terminalId":"{id}","cols":80,"rows":24,"cmd":"/bin/sh","args":[]}}"#)
                .as_bytes(),
        );
    }
    let mut opened1 = false;
    let mut opened2 = false;
    let both_open = wait_for(&mut stdout, 10, |type_byte, body| {
        if type_byte == OPENED {
            let s = String::from_utf8_lossy(body);
            opened1 |= s.contains("\"t-1\"");
            opened2 |= s.contains("\"t-2\"");
        }
        opened1 && opened2
    });
    assert!(both_open, "both terminals should open");

    write_frame(&mut stdin, INPUT, &data_body("t-1", b"echo MARKER-AAA\n"));
    write_frame(&mut stdin, INPUT, &data_body("t-2", b"echo MARKER-BBB\n"));

    let mut buf1 = String::new();
    let mut buf2 = String::new();
    let both_seen = wait_for(&mut stdout, 10, |type_byte, body| {
        if type_byte == OUTPUT {
            let (id, data) = split_data(body);
            if id == "t-1" {
                buf1.push_str(&data);
            } else if id == "t-2" {
                buf2.push_str(&data);
            }
        }
        buf1.contains("MARKER-AAA") && buf2.contains("MARKER-BBB")
    });
    assert!(both_seen, "each terminal should echo its own marker");
    // The core multiplexing guarantee: output is routed by terminal id and never crosses over.
    assert!(!buf1.contains("MARKER-BBB"), "t-1 received t-2's output");
    assert!(!buf2.contains("MARKER-AAA"), "t-2 received t-1's output");

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn reports_the_shell_exit_code() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();
    write_frame(
        &mut stdin,
        OPEN,
        br#"{"terminalId":"t-1","cols":80,"rows":24,"cmd":"/bin/sh","args":[]}"#,
    );
    assert!(
        wait_for(&mut stdout, 10, |type_byte, _| type_byte == OPENED),
        "terminal should open"
    );

    write_frame(&mut stdin, INPUT, &data_body("t-1", b"exit 42\n"));
    let got_code = wait_for(&mut stdout, 10, |type_byte, body| {
        type_byte == EXIT && String::from_utf8_lossy(body).contains("\"exitCode\":42")
    });
    assert!(
        got_code,
        "shell `exit 42` should surface as EXIT exitCode 42"
    );

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn malformed_open_is_rejected_without_killing_the_host() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();

    // Missing the required `cmd` field: the OPEN fails to parse, but its id is still recoverable.
    write_frame(
        &mut stdin,
        OPEN,
        br#"{"terminalId":"t-bad","cols":80,"rows":24}"#,
    );
    let rejected = wait_for(&mut stdout, 10, |type_byte, body| {
        type_byte == ERROR && String::from_utf8_lossy(body).contains("t-bad")
    });
    assert!(
        rejected,
        "a malformed OPEN should be rejected for just that terminal"
    );

    // The host must survive: a well-formed OPEN afterwards still works.
    write_frame(
        &mut stdin,
        OPEN,
        br#"{"terminalId":"t-good","cols":80,"rows":24,"cmd":"/bin/sh","args":[]}"#,
    );
    let opened = wait_for(&mut stdout, 10, |type_byte, body| {
        type_byte == OPENED && String::from_utf8_lossy(body).contains("t-good")
    });
    assert!(
        opened,
        "the host should survive a malformed OPEN and keep serving"
    );

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn rejects_open_with_a_nonexistent_cwd() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();
    write_frame(
        &mut stdin,
        OPEN,
        br#"{"terminalId":"t-cwd","cols":80,"rows":24,"cmd":"/bin/sh","args":[],"cwd":"/no/such/dir/linkcode-test"}"#,
    );
    let rejected = wait_for(&mut stdout, 10, |type_byte, body| {
        type_byte == ERROR && String::from_utf8_lossy(body).contains("t-cwd")
    });
    assert!(
        rejected,
        "an OPEN with a nonexistent cwd should be rejected"
    );

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn close_escalates_to_sigkill_when_the_shell_ignores_sighup() {
    let (mut child, mut stdin, mut stdout) = spawn_sidecar();
    write_frame(
        &mut stdin,
        OPEN,
        br#"{"terminalId":"t-1","cols":80,"rows":24,"cmd":"/bin/sh","args":["-c","trap '' HUP; echo ready-linkcode; while true; do sleep 1; done"]}"#,
    );
    assert!(
        wait_for(&mut stdout, 10, |type_byte, _| type_byte == OPENED),
        "terminal should open"
    );
    // Wait for the trap to be installed before closing — otherwise CLOSE can land while SIGHUP
    // still has its default (terminating) disposition and never exercise the escalation.
    assert!(
        wait_for(&mut stdout, 10, |type_byte, body| {
            type_byte == OUTPUT && frame_text(body).contains("ready-linkcode")
        }),
        "shell should report its trap is installed"
    );

    let start = Instant::now();
    write_frame(&mut stdin, CLOSE, br#"{"terminalId":"t-1"}"#);
    // A plain SIGHUP would never end this shell (it traps and ignores it); the sidecar's close()
    // grace-period escalation to SIGKILL is what must surface the EXIT frame.
    let exited = wait_for(&mut stdout, 10, |type_byte, body| {
        type_byte == EXIT && String::from_utf8_lossy(body).contains("t-1")
    });
    assert!(
        exited,
        "close() should escalate to SIGKILL once the grace period elapses"
    );
    // A generous lower bound confirms this actually waited out the grace period rather than
    // exiting immediately (e.g. if SIGHUP's default disposition had killed it despite the trap).
    assert!(
        start.elapsed() >= Duration::from_secs(2),
        "expected the grace period to elapse before SIGKILL, took {:?}",
        start.elapsed()
    );

    let _ = child.kill();
    let _ = child.wait();
}
