//! `linkcode-pty`: the Link Code PTY host.
//!
//! One long-lived process the daemon spawns; it multiplexes many terminals over a framed stdio
//! protocol (see [`proto`]). Control frames arrive on stdin; output and lifecycle frames go to stdout.

mod mux;
mod proto;
mod pty;

use std::io::{self, BufReader};

use serde::Deserialize;

use crate::mux::Mux;
use crate::proto::{CLOSE, INPUT, OPEN, RESIZE, decode_data, read_frame};
use crate::pty::OpenParams;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeParams {
    terminal_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseParams {
    terminal_id: String,
}

/// Minimal projection used to recover a terminal id from an OPEN frame that failed full parsing,
/// so the failure can be reported for just that terminal instead of the whole host.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalIdOnly {
    terminal_id: String,
}

fn main() {
    let mux = Mux::shared();
    let mut stdin = BufReader::new(io::stdin());

    loop {
        let (type_byte, body) = match read_frame(&mut stdin) {
            Ok(Some(frame)) => frame,
            // Clean end-of-stream: the daemon closed the pipe.
            Ok(None) => break,
            // A truncated/corrupt frame is distinct from a graceful close — surface it before exiting.
            Err(err) => {
                eprintln!("pty protocol read error: {err}");
                break;
            }
        };
        match type_byte {
            OPEN => match serde_json::from_slice::<OpenParams>(&body) {
                Ok(params) => mux.open(params),
                Err(err) => {
                    eprintln!("invalid OPEN frame: {err}");
                    // Fail only this terminal (recover its id if we can); never kill the whole host.
                    match serde_json::from_slice::<TerminalIdOnly>(&body) {
                        Ok(id) => mux.reject_open(&id.terminal_id, &err.to_string()),
                        // No terminalId to reply ERROR against: this side can't resolve it, so the
                        // daemon's pending open is reclaimed by its own open timeout (see PROTOCOL.md).
                        // Surfacing it to stderr is the best we can do here.
                        Err(_) => eprintln!(
                            "OPEN frame has no recoverable terminalId; the daemon's pending open for it will time out"
                        ),
                    }
                }
            },
            INPUT => {
                if let Ok((terminal_id, data)) = decode_data(&body) {
                    mux.input(&terminal_id, data);
                }
            }
            RESIZE => {
                if let Ok(params) = serde_json::from_slice::<ResizeParams>(&body) {
                    mux.resize(&params.terminal_id, params.cols, params.rows);
                }
            }
            CLOSE => {
                if let Ok(params) = serde_json::from_slice::<CloseParams>(&body) {
                    mux.close(&params.terminal_id);
                }
            }
            _ => {}
        }
    }

    mux.shutdown();
}
