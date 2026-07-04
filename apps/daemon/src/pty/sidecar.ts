import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from '@linkcode/engine';
import { Listeners } from '@linkcode/transport';
import type { Frame } from './codec';
import {
  CLOSE,
  decodeDataFrame,
  ERROR,
  EXIT,
  encodeDataFrame,
  FrameDecoder,
  INPUT,
  OPEN,
  OPENED,
  OUTPUT,
  RESIZE,
  writeFrame,
} from './codec';

/** The sidecar child: piped stdin/stdout, inherited stderr (its logs go to the daemon's stderr). */
type SidecarChild = ChildProcessByStdio<Writable, Readable, null>;

interface LiveTerminal {
  readonly data: Listeners<string>;
  readonly exit: Listeners<number | null>;
  /** One streaming decoder per terminal so multi-byte sequences survive frame boundaries. */
  readonly decoder: TextDecoder;
}

interface PendingOpen {
  resolve: (process: PtyProcess) => void;
  reject: (error: Error) => void;
}

/**
 * `PtyBackend` backed by the `linkcode-pty` Rust sidecar. One long-lived child process multiplexes
 * every terminal; the daemon decodes its raw output bytes to UTF-8 here so the client wire stays
 * base64-free. Spawned lazily on first open and respawned after a crash (v1 keeps no cross-crash state).
 */
export class SidecarPtyBackend implements PtyBackend {
  private child: SidecarChild | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly terminals = new Map<string, LiveTerminal>();
  private readonly pending = new Map<string, PendingOpen>();

  constructor(private readonly binaryPath: string) {}

  open(terminalId: string, opts: PtyOpenOptions): Promise<PtyProcess> {
    // No binary to spawn (unconfigured in production — see `resolveSidecarPath`): fail this open
    // with a clear, stable message instead of calling `spawn('')`, which would fail the same way
    // on every terminal open with a confusing "sidecar exited" error instead of a config problem.
    if (!this.binaryPath) {
      return Promise.reject(
        new Error('pty sidecar not configured: terminals are unavailable on this host'),
      );
    }
    if (this.pending.has(terminalId) || this.terminals.has(terminalId)) {
      return Promise.reject(new Error(`terminal already exists: ${terminalId}`));
    }
    const child = this.ensureChild();
    const body = Buffer.from(
      JSON.stringify({
        terminalId,
        cols: opts.cols,
        rows: opts.rows,
        cmd: opts.shell ?? defaultShell(),
        args: [],
        // The daemon's own cwd is an implementation accident (wherever it was launched from) —
        // an unspecified shell belongs in the user's home, like a fresh terminal app tab.
        cwd: opts.cwd ?? homedir(),
        env: {},
      }),
    );
    return new Promise<PtyProcess>((resolve, reject) => {
      this.pending.set(terminalId, { resolve, reject });
      writeFrame(child.stdin, OPEN, body);
    });
  }

  shutdown(): void {
    const child = this.child;
    this.child = null;
    this.decoder.reset();
    this.failAll(new Error('pty backend shutdown'));
    // Close stdin (EOF) rather than SIGKILL: the sidecar's stdin loop then runs its own kill_all and
    // reaps every shell — including setsid-detached ones that a bare kill of the sidecar would orphan.
    child?.stdin.end();
  }

  private ensureChild(): SidecarChild {
    if (this.child) return this.child;
    const child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.decoder.feed(chunk)) this.handleFrame(frame);
      } catch (err) {
        console.error(
          `[linkcode/daemon] pty sidecar protocol error (chunk length ${chunk.length}, ${this.terminals.size} active terminal(s)):`,
          err,
        );
        child.kill();
        this.onChildGone();
      }
    });
    // A failed spawn (e.g. missing binary) errors the pipes; a broken pipe means the child is
    // gone. Without these listeners the unhandled stream error would crash the daemon.
    child.stdin.on('error', () => this.onChildGone());
    child.stdout.on('error', () => this.onChildGone());
    child.on('exit', () => this.onChildGone());
    child.on('error', () => this.onChildGone());
    return child;
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case OPENED: {
        const { terminalId } = JSON.parse(frame.body.toString('utf8')) as { terminalId: string };
        const waiter = this.pending.get(terminalId);
        if (!waiter) break;
        this.pending.delete(terminalId);
        const terminal: LiveTerminal = {
          data: new Listeners<string>(),
          exit: new Listeners<number | null>(),
          decoder: new TextDecoder('utf-8', { fatal: false }),
        };
        this.terminals.set(terminalId, terminal);
        waiter.resolve(this.makeProcess(terminalId, terminal));
        break;
      }
      case OUTPUT: {
        const { terminalId, data } = decodeDataFrame(frame.body);
        const terminal = this.terminals.get(terminalId);
        if (!terminal) break;
        const text = terminal.decoder.decode(data, { stream: true });
        if (text.length > 0) terminal.data.emit(text);
        break;
      }
      case EXIT: {
        const { terminalId, exitCode } = JSON.parse(frame.body.toString('utf8')) as {
          terminalId: string;
          exitCode: number | null;
        };
        this.finish(terminalId, exitCode);
        break;
      }
      case ERROR: {
        const { terminalId, message } = JSON.parse(frame.body.toString('utf8')) as {
          terminalId: string;
          message: string;
        };
        const waiter = this.pending.get(terminalId);
        if (!waiter) break;
        this.pending.delete(terminalId);
        waiter.reject(new Error(message));
        break;
      }
      default:
        break;
    }
  }

  private makeProcess(terminalId: string, terminal: LiveTerminal): PtyProcess {
    return {
      onData: (cb) => terminal.data.add(cb),
      onExit: (cb) => terminal.exit.add(cb),
      write: (data) => this.send(INPUT, encodeDataFrame(terminalId, Buffer.from(data, 'utf8'))),
      resize: (cols, rows) =>
        this.send(RESIZE, Buffer.from(JSON.stringify({ terminalId, cols, rows }))),
      kill: () => this.send(CLOSE, Buffer.from(JSON.stringify({ terminalId }))),
    };
  }

  private send(type: number, body: Buffer): void {
    if (this.child) writeFrame(this.child.stdin, type, body);
  }

  private finish(terminalId: string, exitCode: number | null, flushTail = true): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    // Skip the decoder's final flush on an abnormal teardown (crash/broken pipe): flushing a
    // half-received multibyte sequence would synthesize a bogus U+FFFD the shell never produced.
    if (flushTail) {
      const tail = terminal.decoder.decode();
      if (tail.length > 0) terminal.data.emit(tail);
    }
    this.terminals.delete(terminalId);
    terminal.exit.emit(exitCode);
    terminal.data.clear();
    terminal.exit.clear();
  }

  private onChildGone(): void {
    this.child = null;
    this.decoder.reset();
    this.failAll(new Error('pty sidecar exited'));
  }

  private failAll(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    const terminalIds = Array.from(this.terminals.keys());
    for (const terminalId of terminalIds) this.finish(terminalId, null, false);
  }
}

/**
 * Resolve the sidecar binary: an explicit override (set by the desktop supervisor) always wins;
 * in dev, fall back to the workspace's release build by walking up from this file's known depth
 * under `src/`. That depth assumption breaks once tsup bundles this module into a flat `dist/`
 * output, so production trusts only the override instead of guessing a wrong path and leaving the
 * sidecar silently missing.
 */
export function resolveSidecarPath(): string {
  const override = process.env.LINKCODE_PTY_SIDECAR_PATH;
  if (override) return override;
  const here = fileURLToPath(import.meta.url);
  // tsx runs this file straight from source (`.ts`); a tsup bundle is emitted as `.js`/`.mjs`.
  if (here.endsWith('.ts')) {
    // Dev: this file lives at apps/daemon/src/pty, so the repo root is four levels up.
    const repoRoot = join(dirname(here), '..', '..', '..', '..');
    return join(repoRoot, 'target', 'release', binaryName());
  }
  console.error(
    '[linkcode/daemon] pty sidecar is not configured: set LINKCODE_PTY_SIDECAR_PATH to the built linkcode-pty binary. Terminals will be unavailable.',
  );
  return '';
}

export function binaryName(): string {
  return process.platform === 'win32' ? 'linkcode-pty.exe' : 'linkcode-pty';
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'cmd.exe';
  return process.env.SHELL ?? '/bin/bash';
}
