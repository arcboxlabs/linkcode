//! Terminal multiplexer: owns every live PTY and serializes event frames back to the daemon.

use std::collections::HashMap;
use std::io::{Read, Stdout, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{Child, MasterPty, PtySize};
use serde_json::json;

use crate::proto::{encode_data, write_frame, ERROR, EXIT, OPENED, OUTPUT};
use crate::pty::{spawn, OpenParams, SpawnedPty};

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Routes control frames to PTYs and PTY output back to the daemon. Shared across the per-terminal
/// reader threads via `Arc`; the terminal map and stdout are separate locks, so output streaming
/// never blocks on the map.
pub struct Mux {
    terminals: Mutex<HashMap<String, Terminal>>,
    stdout: Mutex<Stdout>,
}

impl Mux {
    /// Create a shared multiplexer. Returns `Arc<Self>` because reader threads co-own it.
    pub fn shared() -> Arc<Self> {
        Arc::new(Self {
            terminals: Mutex::new(HashMap::new()),
            stdout: Mutex::new(std::io::stdout()),
        })
    }

    /// Spawn a terminal and reply `OPENED`, or reply `ERROR` if the shell could not start.
    pub fn open(self: &Arc<Self>, params: OpenParams) {
        let terminal_id = params.terminal_id.clone();
        let SpawnedPty {
            master,
            reader,
            writer,
            child,
            pid,
        } = match spawn(&params) {
            Ok(pty) => pty,
            Err(err) => {
                self.send_json(
                    ERROR,
                    &json!({ "terminalId": terminal_id, "message": err.to_string() }),
                );
                return;
            }
        };

        self.lock_terminals().insert(
            terminal_id.clone(),
            Terminal {
                master,
                writer,
                child,
            },
        );
        // Reply OPENED before starting the reader so it always precedes this terminal's output.
        self.send_json(OPENED, &json!({ "terminalId": terminal_id, "pid": pid }));
        Arc::clone(self).spawn_reader(terminal_id, reader);
    }

    /// Forward keystrokes to a terminal. Best effort: a dead terminal is reaped by its reader thread.
    pub fn input(&self, terminal_id: &str, data: &[u8]) {
        if let Some(terminal) = self.lock_terminals().get_mut(terminal_id) {
            let _ = terminal.writer.write_all(data);
            let _ = terminal.writer.flush();
        }
    }

    /// Resize a terminal's window. Best effort.
    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) {
        if let Some(terminal) = self.lock_terminals().get(terminal_id) {
            let _ = terminal.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    /// Request termination; the `EXIT` frame and map removal follow from the reader hitting EOF.
    pub fn close(&self, terminal_id: &str) {
        if let Some(terminal) = self.lock_terminals().get_mut(terminal_id) {
            let _ = terminal.child.kill();
        }
    }

    /// Kill every terminal (sidecar shutdown).
    pub fn kill_all(&self) {
        for terminal in self.lock_terminals().values_mut() {
            let _ = terminal.child.kill();
        }
    }

    fn spawn_reader(self: Arc<Self>, terminal_id: String, mut reader: Box<dyn Read + Send>) {
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => self.send(OUTPUT, &encode_data(&terminal_id, &buf[..n])),
                }
            }
            let exit_code = self.reap(&terminal_id);
            self.send_json(
                EXIT,
                &json!({ "terminalId": terminal_id, "exitCode": exit_code }),
            );
        });
    }

    /// Remove a terminal and wait on its child for the exit code (`None` if the wait failed).
    fn reap(&self, terminal_id: &str) -> Option<i32> {
        let mut terminal = self.lock_terminals().remove(terminal_id)?;
        terminal
            .child
            .wait()
            .ok()
            .map(|status| status.exit_code() as i32)
    }

    fn send(&self, type_byte: u8, body: &[u8]) {
        let mut stdout = self.stdout.lock().expect("stdout mutex poisoned");
        let _ = write_frame(&mut *stdout, type_byte, body);
    }

    fn send_json(&self, type_byte: u8, value: &serde_json::Value) {
        let body = serde_json::to_vec(value).expect("serde_json::Value always serializes");
        self.send(type_byte, &body);
    }

    fn lock_terminals(&self) -> std::sync::MutexGuard<'_, HashMap<String, Terminal>> {
        self.terminals.lock().expect("terminals mutex poisoned")
    }
}
