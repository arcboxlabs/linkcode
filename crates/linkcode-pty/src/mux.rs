//! Terminal multiplexer: owns every live PTY and serializes event frames back to the daemon.

use std::collections::HashMap;
use std::io::{Read, Stdout, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{Child, MasterPty, PtySize};
use serde_json::json;

use crate::proto::{ERROR, EXIT, OPENED, OUTPUT, encode_data, write_frame};
use crate::pty::{OpenParams, SpawnedPty, spawn};

struct Terminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

/// Routes control frames to PTYs and PTY output back to the daemon. Shared across the per-terminal
/// reader threads via `Arc`; the terminal map and stdout are separate locks, so output streaming
/// never blocks on the map.
pub struct Mux {
    terminals: Mutex<HashMap<String, Arc<Terminal>>>,
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
        if self.lock_terminals().contains_key(&terminal_id) {
            self.send_json(
                ERROR,
                &json!({ "terminalId": terminal_id, "message": "terminal id already exists" }),
            );
            return;
        }

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
            Arc::new(Terminal {
                master: Mutex::new(master),
                writer: Mutex::new(writer),
                child: Mutex::new(child),
            }),
        );
        // Reply OPENED before starting the reader so it always precedes this terminal's output.
        self.send_json(OPENED, &json!({ "terminalId": terminal_id, "pid": pid }));
        Arc::clone(self).spawn_reader(terminal_id, reader);
    }

    /// Reply `ERROR` for a single terminal that could not be opened (e.g. a malformed OPEN frame),
    /// leaving every other live terminal untouched.
    pub fn reject_open(&self, terminal_id: &str, message: &str) {
        self.send_json(
            ERROR,
            &json!({ "terminalId": terminal_id, "message": message }),
        );
    }

    /// Forward keystrokes to a terminal. Best effort: a dead terminal is reaped by its reader thread.
    pub fn input(&self, terminal_id: &str, data: &[u8]) {
        if let Some(terminal) = self.terminal(terminal_id) {
            let mut writer = terminal
                .writer
                .lock()
                .expect("terminal writer mutex poisoned");
            let _ = writer.write_all(data);
            let _ = writer.flush();
        }
    }

    /// Resize a terminal's window. Best effort.
    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) {
        if let Some(terminal) = self.terminal(terminal_id) {
            let master = terminal
                .master
                .lock()
                .expect("terminal master mutex poisoned");
            let _ = master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    /// Request termination; the `EXIT` frame and map removal follow from the reader hitting EOF.
    pub fn close(&self, terminal_id: &str) {
        if let Some(terminal) = self.terminal(terminal_id) {
            let mut child = terminal
                .child
                .lock()
                .expect("terminal child mutex poisoned");
            let _ = child.kill();
        }
    }

    /// Kill every terminal (sidecar shutdown).
    pub fn kill_all(&self) {
        let terminals = self.lock_terminals().values().cloned().collect::<Vec<_>>();
        for terminal in terminals {
            let mut child = terminal
                .child
                .lock()
                .expect("terminal child mutex poisoned");
            let _ = child.kill();
        }
    }

    fn spawn_reader(self: Arc<Self>, terminal_id: String, mut reader: Box<dyn Read + Send>) {
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => match encode_data(&terminal_id, &buf[..n]) {
                        Ok(body) => self.send(OUTPUT, &body),
                        Err(_) => break,
                    },
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
    /// Kept as `i64` so a platform exit code with the high bit set (e.g. a Windows crash code like
    /// 0xC0000005) is preserved as its true unsigned value rather than wrapping to a negative `i32`.
    fn reap(&self, terminal_id: &str) -> Option<i64> {
        let terminal = self.lock_terminals().remove(terminal_id)?;
        let mut child = terminal
            .child
            .lock()
            .expect("terminal child mutex poisoned");
        child
            .wait()
            .ok()
            .map(|status| i64::from(status.exit_code()))
    }

    fn send(&self, type_byte: u8, body: &[u8]) {
        let mut stdout = self.stdout.lock().expect("stdout mutex poisoned");
        let _ = write_frame(&mut *stdout, type_byte, body);
    }

    fn send_json(&self, type_byte: u8, value: &serde_json::Value) {
        let body = serde_json::to_vec(value).expect("serde_json::Value always serializes");
        self.send(type_byte, &body);
    }

    fn terminal(&self, terminal_id: &str) -> Option<Arc<Terminal>> {
        self.lock_terminals().get(terminal_id).cloned()
    }

    fn lock_terminals(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Terminal>>> {
        self.terminals.lock().expect("terminals mutex poisoned")
    }
}
