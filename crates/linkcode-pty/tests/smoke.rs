//! End-to-end smoke test: drive the compiled sidecar over its stdio protocol against a real shell.
#![cfg(unix)]

use std::io::{Read, Write};
use std::process::{Command, Stdio};
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
    // For data frames, skip the [u16 id_len][id] prefix; for JSON frames, this is a harmless slice.
    let id_len = u16::from_le_bytes([body[0], body[1]]) as usize;
    String::from_utf8_lossy(&body[2 + id_len..]).into_owned()
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

    // Closing the control pipe (EOF) triggers shutdown. It must kill the terminal, then join the
    // reader thread *before* stopping the writer, so the reader's final EXIT frame is flushed
    // rather than raced away by the writer shutting down first.
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
