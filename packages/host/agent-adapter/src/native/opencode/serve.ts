import process from 'node:process';
import crossSpawn from 'cross-spawn';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { agentRuntimeProber } from '../../probe/prober';

/** Startup output kept for the failure message when the server never reports readiness. */
const STARTUP_OUTPUT_CAP = 8192;
/** Rolling window the readiness regex runs over — bounded (unlike a capped-then-frozen buffer) so
 * a chatty startup cannot stop it matching. */
const READINESS_WINDOW = 512;
/** The server's readiness line: `opencode server listening on http://127.0.0.1:<port>`. The
 * trailing newline keeps a URL split across chunks from matching on its half-arrived prefix. */
const RE_LISTENING = /listening on\s+(https?:\/\/\S+)\s*[\r\n]/;

/** The slice of `ChildProcess` the serve helpers drive — a structural type so tests can hand in a
 * plain fake instead of force-casting through `unknown`. */
export interface OpencodeServeProcess {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stdout: {
    on(event: 'data', cb: (chunk: Buffer) => void): unknown;
    destroy(): void;
  } | null;
  readonly stderr: {
    on(event: 'data', cb: (chunk: Buffer) => void): unknown;
    destroy(): void;
  } | null;
  once(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', cb: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  unref(): void;
}

/** Exit is read off the process itself — both fields stay null until it is truly gone, so there
 * is no shadow flag to drift out of sync with reality. */
export function serveProcessExited(proc: OpencodeServeProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/** A startup-window death, as opposed to a timeout or spawn failure — the one failure mode worth
 * one automatic retry, because a pre-allocated port can be stolen between probe and bind. */
export class ServeStartupExitError extends Error {
  override name = 'ServeStartupExitError';
}

/**
 * The `opencode` binary every serve spawn runs: managed install → detected user install (the
 * boot probe, CODE-76) → the bare name for hosts that never probed (dev/standalone daemons),
 * where the inherited PATH still resolves it. GUI-launched packaged apps inherit a stripped
 * PATH, which is why bare-name resolution alone used to fail there with `spawn opencode ENOENT`.
 */
export function resolveOpencodeBinary(): string {
  return agentRuntimeProber.resolveBinary('opencode') ?? 'opencode';
}

export interface OpencodeServeSpawnOptions {
  port: number;
  cwd?: string;
  /** Inline opencode config, delivered the way the SDK's `createOpencodeServer` does —
   * serialized into the `OPENCODE_CONFIG_CONTENT` env var. Omitted = no env override at all. */
  config?: unknown;
}

/** Spawn `opencode serve` on loopback. cross-spawn matches the SDK's resolution semantics for a
 * bare name (incl. Windows `.cmd`); `--port=0` does NOT auto-allocate (falls back to 4096,
 * verified live on 1.17.11), so callers must pre-allocate a free port. */
export function spawnOpencodeServe(opts: OpencodeServeSpawnOptions): OpencodeServeProcess {
  return crossSpawn(
    resolveOpencodeBinary(),
    ['serve', '--hostname=127.0.0.1', `--port=${opts.port}`],
    {
      ...(opts.cwd !== undefined && { cwd: opts.cwd }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...(opts.config !== undefined && {
        env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(opts.config) },
      }),
    },
  );
}

/**
 * Wait for the serve process to report readiness and resolve its base URL. On success the pipes
 * are destroyed and the process unref'd so an idle server never keeps the daemon's event loop
 * alive; crash detection stays on the caller's own 'exit' listener. Failures reject with the
 * captured startup output; a startup-window exit rejects {@link ServeStartupExitError} so callers
 * can retry once with a fresh port.
 */
export function awaitServeReady(
  proc: OpencodeServeProcess,
  { timeoutMs, what }: { timeoutMs: number; what: string },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    /** Capped capture for failure messages only — readiness matching never depends on it. */
    let output = '';
    /** Bounded rolling tail the readiness regex runs over; grows with every chunk regardless of
     * how much came before, so verbose startup output cannot freeze detection. */
    let tail = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Listeners stay attached after settling (guarded by `settled`): success destroys the pipes
    // anyway, and a failed startup kills the process, so explicit removal buys nothing.
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      fn();
    };
    const fail = (headline: string, startupExit = false): void => {
      settle(() => {
        const detail = output.trim();
        const message = detail ? `${headline}\n${detail}` : headline;
        reject(startupExit ? new ServeStartupExitError(message) : new Error(message));
      });
    };
    timer = setTimeout(() => {
      fail(`opencode: ${what} startup timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    timer.unref();
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      const text = chunk.toString();
      if (output.length < STARTUP_OUTPUT_CAP) output += text;
      tail = (tail + text).slice(-READINESS_WINDOW);
      const match = RE_LISTENING.exec(tail);
      if (!match) return;
      const url = match[1];
      settle(() => {
        proc.stdout?.destroy();
        proc.stderr?.destroy();
        proc.unref();
        resolve(url);
      });
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (!settled && output.length < STARTUP_OUTPUT_CAP) output += chunk.toString();
    });
    proc.once('error', (err) => {
      fail(`opencode: failed to spawn ${what} (${extractErrorMessage(err) ?? 'unknown error'})`);
    });
    proc.once('exit', (code) => {
      fail(`opencode: ${what} exited during startup (code ${code})`, true);
    });
  });
}

/** Graceful shutdown: SIGTERM, escalating to SIGKILL after the grace window (the SDK's own
 * `close()` is a bare SIGTERM with no escalation). Resolves once the process is gone. */
export function terminateServe(proc: OpencodeServeProcess, graceMs: number): Promise<void> {
  if (serveProcessExited(proc)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => proc.kill('SIGKILL'), graceMs);
    killTimer.unref();
    proc.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

export interface OpencodeServeHandle {
  url: string;
  close: () => void;
}

/** SIGTERM→SIGKILL grace for a per-session server shutdown. */
const SESSION_SHUTDOWN_GRACE_MS = 5000;

/**
 * Spawn a per-session `opencode serve` and wait for readiness — the owned replacement for the
 * SDK's `createOpencodeServer`, which hard-codes bare-name PATH resolution (and no
 * `windowsHide`). A failed startup kills the process before rejecting.
 */
export async function startOpencodeServe(opts: {
  port: number;
  config?: unknown;
  readyTimeoutMs?: number;
}): Promise<OpencodeServeHandle> {
  // Always deliver a config env (`{}` when none) to mirror the SDK spawn this replaces.
  const proc = spawnOpencodeServe({ port: opts.port, config: opts.config ?? {} });
  try {
    const url = await awaitServeReady(proc, {
      timeoutMs: opts.readyTimeoutMs ?? 30000,
      what: 'server',
    });
    return {
      url,
      close() {
        void terminateServe(proc, SESSION_SHUTDOWN_GRACE_MS);
      },
    };
  } catch (err) {
    if (!serveProcessExited(proc)) proc.kill('SIGKILL');
    throw err;
  }
}
