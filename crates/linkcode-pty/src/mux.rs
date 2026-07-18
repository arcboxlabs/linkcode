//! Terminal multiplexer: owns every live PTY and serializes event frames back to the daemon.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use portable_pty::{Child, MasterPty, PtySize};
use serde_json::json;

use crate::credit::Credit;
use crate::proto::{ERROR, EXIT, OPENED, OUTPUT, encode_data, write_frame};
use crate::pty::{OpenParams, SpawnedPty, spawn};

struct Terminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    /// `None` once the reader thread has reaped the child; guards `signal_group` from ever
    /// targeting a pid the OS may have recycled.
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    /// Read-credit gate shared with this terminal's reader thread.
    credit: Arc<Credit>,
}

/// How hard to tear a terminal's process group down.
#[derive(Clone, Copy)]
enum Teardown {
    /// `SIGHUP` — the conventional "the terminal hung up" signal, used when a client closes one
    /// terminal; shells and well-behaved children exit on it and run their traps first.
    Hangup,
    /// `SIGKILL` — unconditional, used on sidecar shutdown right before the reader threads are
    /// joined, so every group is guaranteed dead and the blocking master reads hit EOF.
    Kill,
}

impl Terminal {
    /// Signal the whole process group, not just the shell: the shell is a `setsid` leader (pid =
    /// group id), so children that inherited the slave — which block master EOF — die with it.
    #[cfg(unix)]
    fn signal_group(&self, teardown: Teardown) {
        let signal = match teardown {
            Teardown::Hangup => libc::SIGHUP,
            Teardown::Kill => libc::SIGKILL,
        };
        // Hold the child lock so `reap` can't `take` (and then `wait`, freeing the pid) underneath
        // us; a live `Some(child)` means the pid is still a valid, un-recycled process-group id.
        let child = self.child.lock().expect("terminal child mutex poisoned");
        if let Some(pid) = child.as_ref().and_then(|c| c.process_id()) {
            // SAFETY: `killpg` only delivers `signal` to the process group `pid`; it dereferences
            // no memory. The unreaped child guarded above keeps `pid` a live group id.
            unsafe {
                libc::killpg(pid as libc::pid_t, signal);
            }
        }
    }

    /// Non-Unix fallback: no portable process-group signalling, so just kill the shell itself.
    #[cfg(not(unix))]
    fn signal_group(&self, _teardown: Teardown) {
        if let Some(child) = self
            .child
            .lock()
            .expect("terminal child mutex poisoned")
            .as_mut()
        {
            let _ = child.kill();
        }
    }
}

/// How long `close` waits for `SIGHUP` before escalating to `SIGKILL` — long enough for a shell
/// to run its exit traps, short enough that a signal-ignoring terminal doesn't stall the close.
const CLOSE_GRACE_PERIOD: Duration = Duration::from_secs(3);

/// A frame bound for the daemon, or the sentinel that tells the writer thread to drain and stop.
enum OutMsg {
    Frame { type_byte: u8, body: Vec<u8> },
    Shutdown,
}

/// Routes control frames to PTYs and PTY output back to the daemon; `Arc`-shared with the
/// per-terminal reader threads. Every outbound frame funnels through `out` to the single
/// stdout-owning writer thread — no torn frames, no head-of-line blocking on a slow stdout.
pub struct Mux {
    terminals: Mutex<HashMap<String, Arc<Terminal>>>,
    out: Sender<OutMsg>,
    writer: Mutex<Option<JoinHandle<()>>>,
    /// Per-terminal reader threads, joined on shutdown so their final `EXIT` frames reach the
    /// writer. Finished handles are pruned on each `open` so this stays roughly live-terminal sized.
    readers: Mutex<Vec<JoinHandle<()>>>,
}

impl Mux {
    /// Create a shared multiplexer. Returns `Arc<Self>` because reader threads co-own it.
    pub fn shared() -> Arc<Self> {
        let (out, rx) = channel::<OutMsg>();
        let writer = thread::spawn(move || {
            let mut stdout = io::stdout();
            while let Ok(msg) = rx.recv() {
                match msg {
                    OutMsg::Frame { type_byte, body } => {
                        let _ = write_frame(&mut stdout, type_byte, &body);
                    }
                    OutMsg::Shutdown => break,
                }
            }
        });
        Arc::new(Self {
            terminals: Mutex::new(HashMap::new()),
            out,
            writer: Mutex::new(Some(writer)),
            readers: Mutex::new(Vec::new()),
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

        let credit = Arc::new(Credit::new(params.credit));
        self.lock_terminals().insert(
            terminal_id.clone(),
            Arc::new(Terminal {
                master: Mutex::new(master),
                writer: Mutex::new(writer),
                child: Mutex::new(Some(child)),
                credit: Arc::clone(&credit),
            }),
        );
        // Reply OPENED before starting the reader so it always precedes this terminal's output.
        self.send_json(OPENED, &json!({ "terminalId": terminal_id, "pid": pid }));
        Arc::clone(self).spawn_reader(terminal_id, reader, credit);
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

    /// Grant additional read credit to a terminal. Best effort: an unknown id (already exited) is
    /// ignored, matching the other per-terminal control frames.
    pub fn credit(&self, terminal_id: &str, bytes: u64) {
        if let Some(terminal) = self.terminal(terminal_id) {
            terminal.credit.grant(bytes);
        }
    }

    /// Request termination; the `EXIT` frame and map removal follow from the reader hitting EOF.
    /// A terminal still alive after [`CLOSE_GRACE_PERIOD`] is escalated to `SIGKILL` on its group.
    pub fn close(self: &Arc<Self>, terminal_id: &str) {
        if let Some(terminal) = self.terminal(terminal_id) {
            // Lift throttling first: a credit-parked reader would otherwise never see the EOF this
            // teardown produces. The dying process drains unthrottled from here on.
            terminal.credit.release();
            terminal.signal_group(Teardown::Hangup);
        } else {
            return;
        }
        let mux = Arc::clone(self);
        let terminal_id = terminal_id.to_string();
        thread::spawn(move || {
            thread::sleep(CLOSE_GRACE_PERIOD);
            // Still present means the reader hasn't hit EOF yet — SIGHUP alone didn't end it.
            if let Some(terminal) = mux.terminal(&terminal_id) {
                terminal.signal_group(Teardown::Kill);
            }
        });
    }

    /// Called once when the daemon closes the control pipe: `SIGKILL` every group (guaranteeing
    /// the blocking master reads hit EOF, so the joins can't hang), join the readers so their
    /// final `EXIT` frames are queued, then stop the writer once its queue drains.
    pub fn shutdown(&self) {
        for terminal in self.lock_terminals().values() {
            terminal.signal_group(Teardown::Kill);
            // Wake any credit-parked reader so it can drain to EOF; the joins below depend on it.
            terminal.credit.release();
        }
        let readers = std::mem::take(&mut *self.readers.lock().expect("readers mutex poisoned"));
        for reader in readers {
            let _ = reader.join();
        }
        let _ = self.out.send(OutMsg::Shutdown);
        if let Some(writer) = self.writer.lock().expect("writer mutex poisoned").take() {
            let _ = writer.join();
        }
    }

    fn spawn_reader(
        self: Arc<Self>,
        terminal_id: String,
        mut reader: Box<dyn Read + Send>,
        credit: Arc<Credit>,
    ) {
        let handle = thread::spawn({
            let mux = Arc::clone(&self);
            move || {
                let mut buf = [0u8; 4096];
                loop {
                    // Parks while the budget is exhausted — the kernel PTY buffer then fills and
                    // the child's writes block, which is the whole point of the credit gate.
                    let allowance = credit.acquire(buf.len());
                    match reader.read(&mut buf[..allowance]) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            credit.consume(n);
                            match encode_data(&terminal_id, &buf[..n]) {
                                Ok(body) => mux.send(OUTPUT, body),
                                Err(_) => break,
                            }
                        }
                    }
                }
                let exit_code = mux.reap(&terminal_id);
                mux.send_json(
                    EXIT,
                    &json!({ "terminalId": terminal_id, "exitCode": exit_code }),
                );
            }
        });
        self.push_reader(handle);
    }

    /// Track a reader thread for the shutdown join, first reaping any handles whose threads have
    /// already finished so the list doesn't grow across a session's worth of opened terminals.
    fn push_reader(&self, handle: JoinHandle<()>) {
        let mut readers = self.readers.lock().expect("readers mutex poisoned");
        let mut i = 0;
        while i < readers.len() {
            if readers[i].is_finished() {
                let _ = readers.swap_remove(i).join();
            } else {
                i += 1;
            }
        }
        readers.push(handle);
    }

    /// Remove a terminal and wait on its child for the exit code (`None` if the wait failed).
    /// `i64` so a high-bit platform exit code (e.g. Windows 0xC0000005) doesn't wrap negative in `i32`.
    fn reap(&self, terminal_id: &str) -> Option<i64> {
        let terminal = self.lock_terminals().remove(terminal_id)?;
        // `take` the child before waiting so a concurrent `signal_group` sees `None` and won't
        // signal the pid once `wait` has freed it.
        let mut child = terminal
            .child
            .lock()
            .expect("terminal child mutex poisoned")
            .take()?;
        child
            .wait()
            .ok()
            .map(|status| i64::from(status.exit_code()))
    }

    fn send(&self, type_byte: u8, body: Vec<u8>) {
        // Best effort: once the writer thread has stopped (shutdown), the frame is simply dropped.
        let _ = self.out.send(OutMsg::Frame { type_byte, body });
    }

    fn send_json(&self, type_byte: u8, value: &serde_json::Value) {
        let body = serde_json::to_vec(value).expect("serde_json::Value always serializes");
        self.send(type_byte, body);
    }

    fn terminal(&self, terminal_id: &str) -> Option<Arc<Terminal>> {
        self.lock_terminals().get(terminal_id).cloned()
    }

    fn lock_terminals(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<Terminal>>> {
        self.terminals.lock().expect("terminals mutex poisoned")
    }
}
