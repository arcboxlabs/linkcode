//! PTY spawning via `portable-pty`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

use anyhow::{Result, bail};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Deserialize;

use crate::proto::MAX_TERMINAL_ID_LEN;

/// Parameters for opening a terminal, deserialized from a daemon `OPEN` frame.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenParams {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
    /// Executable to run — a shell, already resolved by the daemon.
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

impl OpenParams {
    /// Validate protocol invariants that the rest of the sidecar relies on.
    pub fn validate(&self) -> Result<()> {
        let terminal_id_len = self.terminal_id.len();
        if terminal_id_len == 0 || terminal_id_len > MAX_TERMINAL_ID_LEN {
            bail!("invalid terminal id length");
        }
        Ok(())
    }
}

/// A spawned PTY: the master handle, its split reader/writer, and the child process.
pub struct SpawnedPty {
    pub master: Box<dyn MasterPty + Send>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub pid: u32,
}

/// Spawn `params.cmd` attached to a fresh PTY sized to `params.cols` × `params.rows`.
pub fn spawn(params: &OpenParams) -> Result<SpawnedPty> {
    params.validate()?;

    let pair = native_pty_system().openpty(PtySize {
        // Clamp to at least 1×1: openpty accepts a 0-sized winsize, which makes TUIs misbehave.
        rows: params.rows.max(1),
        cols: params.cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(&params.cmd);
    for arg in &params.args {
        cmd.arg(arg);
    }
    if let Some(cwd) = &params.cwd {
        // portable-pty silently substitutes $HOME for a non-directory cwd; surface it as an error
        // instead so a deleted/renamed workspace dir doesn't yield a shell in the wrong place.
        if !Path::new(cwd).is_dir() {
            bail!("cwd is not a directory: {cwd}");
        }
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");
    for (key, value) in &params.env {
        cmd.env(key, value);
    }

    let child = pair.slave.spawn_command(cmd)?;
    // Drop the slave so the parent no longer holds it open; the master read then sees EOF once the
    // child exits, which is what drives terminal teardown.
    drop(pair.slave);

    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let pid = child.process_id().unwrap_or(0);

    Ok(SpawnedPty {
        master: pair.master,
        reader,
        writer,
        child,
        pid,
    })
}
