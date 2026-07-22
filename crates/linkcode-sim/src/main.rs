//! `linkcode-sim`: the Link Code iOS Simulator host (P0 — public `simctl` only).
//!
//! One long-lived process the daemon spawns; it serves simulator RPCs over a framed stdio
//! protocol (see [`proto`]). Requests arrive on stdin; results go to stdout. Each request runs
//! on its own thread so a slow boot never blocks a screenshot.

mod proto;
mod rpc;
mod simctl;

use std::io::{self, BufReader, Write};
use std::sync::mpsc::{Sender, channel};
use std::thread;

use crate::proto::{REQUEST, RESULT, SCREENSHOT, encode_screenshot, read_frame, write_frame};
use crate::rpc::{ErrorCode, Op, OpError, Request, RequestIdOnly, error_body, success_body};

/// A frame bound for the daemon, or the sentinel that tells the writer thread to stop.
enum OutMsg {
    Frame { type_byte: u8, body: Vec<u8> },
    Stop,
}

fn main() {
    let (tx, rx) = channel::<OutMsg>();

    // Sole stdout owner: serializes frames from every request thread.
    let writer = thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        while let Ok(OutMsg::Frame { type_byte, body }) = rx.recv() {
            if write_frame(&mut stdout, type_byte, &body).is_err() {
                // The daemon is gone; frames have nowhere to go.
                break;
            }
        }
        let _ = stdout.flush();
    });

    let mut stdin = BufReader::new(io::stdin());
    loop {
        let (type_byte, body) = match read_frame(&mut stdin) {
            Ok(Some(frame)) => frame,
            // Clean end-of-stream: the daemon closed the pipe.
            Ok(None) => break,
            // A truncated/corrupt frame is distinct from a graceful close — surface it before exiting.
            Err(err) => {
                eprintln!("sim protocol read error: {err}");
                break;
            }
        };
        if type_byte != REQUEST {
            continue;
        }
        match serde_json::from_slice::<Request>(&body) {
            Ok(request) => {
                let tx = tx.clone();
                thread::spawn(move || serve(request, &tx));
            }
            Err(err) => {
                eprintln!("invalid REQUEST frame: {err}");
                // Fail only this request (recover its id if we can); never kill the whole host.
                match serde_json::from_slice::<RequestIdOnly>(&body) {
                    Ok(id) => send_error(
                        &tx,
                        &id.request_id,
                        &OpError::new(ErrorCode::InvalidRequest, err.to_string()),
                    ),
                    // No requestId to reply against — the daemon's pending request is reclaimed
                    // by its own timeout (see PROTOCOL.md).
                    Err(_) => eprintln!(
                        "REQUEST frame has no recoverable requestId; the daemon's pending request for it will time out"
                    ),
                }
            }
        }
    }

    // Stop the writer without waiting for in-flight simctl calls: a mid-boot device keeps booting
    // server-side in CoreSimulatorService whether or not our child lives to see it.
    let _ = tx.send(OutMsg::Stop);
    let _ = writer.join();
}

/// Run one request to completion and send its RESULT (and, for screenshots, the image frame).
fn serve(request: Request, tx: &Sender<OutMsg>) {
    let request_id = request.request_id;
    let outcome = match request.op {
        Op::Probe => simctl::probe(),
        Op::List => simctl::list(),
        Op::Boot { udid } => simctl::boot(&udid),
        Op::Shutdown { udid } => simctl::shutdown(&udid),
        Op::Install { udid, app_path } => simctl::install(&udid, &app_path),
        Op::Launch { udid, bundle_id } => simctl::launch(&udid, &bundle_id),
        Op::Terminate { udid, bundle_id } => simctl::terminate(&udid, &bundle_id),
        Op::OpenUrl { udid, url } => simctl::open_url(&udid, &url),
        Op::Screenshot { udid, format } => {
            match simctl::screenshot(&udid, format).and_then(|image| {
                encode_screenshot(&request_id, &image)
                    .map_err(|e| OpError::new(ErrorCode::Io, e.to_string()))
            }) {
                Ok(body) => {
                    send(tx, SCREENSHOT, body);
                    return;
                }
                Err(e) => Err(e),
            }
        }
    };
    match outcome {
        Ok(result) => send(tx, RESULT, success_body(&request_id, result)),
        Err(error) => send_error(tx, &request_id, &error),
    }
}

fn send(tx: &Sender<OutMsg>, type_byte: u8, body: Vec<u8>) {
    let _ = tx.send(OutMsg::Frame { type_byte, body });
}

fn send_error(tx: &Sender<OutMsg>, request_id: &str, error: &OpError) {
    send(tx, RESULT, error_body(request_id, error));
}
