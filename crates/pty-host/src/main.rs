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
use crate::proto::{decode_data, read_frame, CLOSE, INPUT, OPEN, RESIZE};
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

fn main() {
    let mux = Mux::shared();
    let mut stdin = BufReader::new(io::stdin());

    // Loop until stdin ends (the daemon closed the pipe) or a read error stops us.
    while let Ok(Some((type_byte, body))) = read_frame(&mut stdin) {
        match type_byte {
            OPEN => {
                if let Ok(params) = serde_json::from_slice::<OpenParams>(&body) {
                    mux.open(params);
                }
            }
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

    mux.kill_all();
}
