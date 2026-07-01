//! PTY spawning via `portable-pty`.

use std::collections::HashMap;
use std::io::{Read, Write};

use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;

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
    let pair = native_pty_system().openpty(PtySize {
        rows: params.rows,
        cols: params.cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(&params.cmd);
    for arg in &params.args {
        cmd.arg(arg);
    }
    if let Some(cwd) = &params.cwd {
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
