import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { allocatePort } from '@linkcode/common/node';
import crossSpawn from 'cross-spawn';
import { extractErrorMessage } from 'foxts/extract-error-message';

/** Startup output kept for the failure message when the server never reports readiness. */
const STARTUP_OUTPUT_CAP = 8192;
/** Rolling window the readiness regex runs over — a couple of lines is plenty for the readiness
 * line, and a bounded window (unlike a capped-then-frozen buffer) cannot stop matching just
 * because a chatty startup produced a lot of output first. */
const READINESS_WINDOW = 512;
/** The server's readiness line: `opencode server listening on http://127.0.0.1:<port>`. The
 * trailing newline is required so a URL split across chunks can't match on its half-arrived
 * prefix. */
const RE_LISTENING = /listening on\s+(https?:\/\/\S+)\s*[\r\n]/;

/** The slice of `ChildProcess` this manager drives — a structural type so tests can hand in a
 * plain fake instead of force-casting through `unknown`. */
export interface HistoryServerProcess {
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

export interface OpencodeHistoryServerOptions {
  /** Test seam — the real thing resolves `opencode` from PATH (vendoring is CODE-76) and spawns
   * `opencode serve`. */
  spawnServer?: (args: { port: number; cwd: string }) => HistoryServerProcess;
  allocatePort?: () => Promise<number>;
  /** Spawn cwd for the server. opencode treats its cwd as the default workspace and indexes the
   * whole tree under it, so this must be a neutral empty directory — NEVER the daemon's cwd (a
   * daemon launched from `$HOME` would index the entire home tree; the SDK's `createOpencode()`
   * has no cwd option, which is why this manager spawns the server itself). */
  neutralCwd?: string;
  /** How long the server may sit with no in-flight history call before it is shut down. */
  idleMs?: number;
  readyTimeoutMs?: number;
  /** SIGTERM grace before SIGKILL (the SDK's own `close()` is a bare SIGTERM with no escalation). */
  shutdownGraceMs?: number;
}

/** The one method history calls consume — the adapter's test seam returns this shape. */
export interface OpencodeHistoryServerLike {
  withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T>;
}

interface ServerGeneration {
  proc: HistoryServerProcess;
  ready: Promise<string>;
}

/** Exit is read off the process itself — both fields stay null until it is truly gone, so there
 * is no shadow flag to drift out of sync with reality. */
function processExited(proc: HistoryServerProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/** A startup-window death, as opposed to a timeout or spawn failure — the one failure mode worth
 * one automatic retry, because the pre-allocated port can be stolen between probe and bind. */
class StartupExitError extends Error {
  override name = 'StartupExitError';
}

/**
 * Daemon-shared `opencode serve` for history reads (CODE-171). History `list`/`read` are served to
 * never-started adapter instances (`HistoryService` constructs one per call via the factory), so
 * the server backing them cannot belong to any live session — it is a lazily-spawned, idle-reaped
 * process shared across all history calls. Live sessions keep their own per-session SDK server.
 *
 * The server is multi-tenant: history calls carry no `directory`, and the neutral-cwd instance
 * lists and reads sessions across every project (verified live on opencode 1.17.11).
 *
 * Scope note for the eventual paseo-style consolidation (live sessions sharing this server,
 * CODE-140): `withServer`'s callback-scoped single-shot contract deliberately cannot express what
 * live sessions need — a session-lifetime acquire/release handle plus a "generation rotated,
 * reconnect" signal after a crash respawn. Consolidation means REWRITING this class's public
 * interface, not extending it; do not try to squeeze a live session into one long `withServer`
 * call.
 */
export class OpencodeHistoryServer implements OpencodeHistoryServerLike {
  private readonly spawnServer: (args: { port: number; cwd: string }) => HistoryServerProcess;
  private readonly allocatePort: () => Promise<number>;
  private readonly neutralCwd: string;
  private readonly idleMs: number;
  private readonly readyTimeoutMs: number;
  private readonly shutdownGraceMs: number;

  private current: ServerGeneration | null = null;
  private startPromise: Promise<string> | null = null;
  /** In-flight graceful shutdown; a new spawn awaits it so an idle reap racing a fresh call can
   * never briefly run two servers. */
  private stopping: Promise<void> | null = null;
  private inFlight = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private exitHookInstalled = false;
  /** Installed ONCE for the manager's lifetime and never removed: it reads `current` dynamically,
   * so one registration serves every generation. (Removing it per-generation is how an old
   * generation's exit once stripped the NEW generation's cleanup — the shared function reference
   * made `removeListener` blind to which registration it was deleting — orphaning the server on
   * daemon exit.) Process 'exit' handlers cannot wait; SIGKILL is the only reliable cleanup left. */
  private readonly onProcessExit = (): void => {
    const proc = this.current?.proc;
    if (proc && !processExited(proc)) proc.kill('SIGKILL');
  };

  constructor(options: OpencodeHistoryServerOptions = {}) {
    this.spawnServer = options.spawnServer ?? defaultSpawnServer;
    this.allocatePort = options.allocatePort ?? allocatePort;
    this.neutralCwd = options.neutralCwd ?? join(homedir(), '.linkcode', 'opencode-history');
    this.idleMs = options.idleMs ?? 60000;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 30000;
    this.shutdownGraceMs = options.shutdownGraceMs ?? 5000;
  }

  /** Run one history call against the shared server, spawning it if needed. Calls are ref-counted;
   * the idle timer only arms once the last in-flight call finishes. */
  async withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
    this.clearIdleTimer();
    this.inFlight += 1;
    try {
      const url = await this.ensureRunning();
      return await fn(url);
    } finally {
      this.inFlight -= 1;
      if (this.inFlight === 0) this.armIdleTimer();
    }
  }

  /** Shut the server down now (graceful, then SIGKILL). Safe to call with no server running. */
  async dispose(): Promise<void> {
    this.clearIdleTimer();
    const generation = this.current;
    this.current = null;
    this.startPromise = null;
    if (!generation || processExited(generation.proc)) return;
    const stopping = terminate(generation.proc, this.shutdownGraceMs).finally(() => {
      if (this.stopping === stopping) this.stopping = null;
    });
    this.stopping = stopping;
    await stopping;
  }

  private async ensureRunning(): Promise<string> {
    if (this.current && !processExited(this.current.proc)) return this.current.ready;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async start(): Promise<string> {
    // An idle reap may still be inside its SIGTERM grace window; overlapping it would briefly run
    // two servers and waste a full respawn on what should be a fast reuse.
    if (this.stopping) await this.stopping;
    mkdirSync(this.neutralCwd, { recursive: true });
    try {
      return await this.spawnGeneration();
    } catch (err) {
      // One retry with a fresh port: allocatePort is check-then-use, so the port can be stolen
      // between probe and the child's bind — which surfaces as an immediate startup-window exit.
      // A genuine config failure just fails once more with the same captured output.
      if (err instanceof StartupExitError) return this.spawnGeneration();
      throw err;
    }
  }

  private async spawnGeneration(): Promise<string> {
    const port = await this.allocatePort();
    const proc = this.spawnServer({ port, cwd: this.neutralCwd });
    const generation: ServerGeneration = { proc, ready: this.awaitReadiness(proc) };
    this.current = generation;
    if (!this.exitHookInstalled) {
      this.exitHookInstalled = true;
      process.once('exit', this.onProcessExit);
    }
    proc.once('exit', () => {
      // A crash (or the idle reap) retires this generation; the next call respawns fresh.
      if (this.current === generation) this.current = null;
    });
    try {
      return await generation.ready;
    } catch (err) {
      if (this.current === generation) this.current = null;
      if (!processExited(proc)) proc.kill('SIGKILL');
      throw err;
    }
  }

  private awaitReadiness(proc: HistoryServerProcess): Promise<string> {
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
          reject(startupExit ? new StartupExitError(message) : new Error(message));
        });
      };
      timer = setTimeout(() => {
        fail(`opencode: history server startup timed out after ${this.readyTimeoutMs}ms`);
      }, this.readyTimeoutMs);
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
          // Detach the pipes and unref so an idle-but-running server never keeps the daemon's
          // event loop alive; crash detection stays on the 'exit' listener.
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
        fail(
          `opencode: failed to spawn history server (${extractErrorMessage(err) ?? 'unknown error'})`,
        );
      });
      proc.once('exit', (code) => {
        fail(`opencode: history server exited during startup (code ${code})`, true);
      });
    });
  }

  private armIdleTimer(): void {
    if (!this.current || processExited(this.current.proc)) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // A call that raced the timer wins: withServer clears the timer before awaiting, but if it
      // fired first, only reap while genuinely idle.
      if (this.inFlight === 0) void this.dispose();
    }, this.idleMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

function defaultSpawnServer(args: { port: number; cwd: string }): HistoryServerProcess {
  // `--port=0` does NOT auto-allocate (the server falls back to its default 4096, verified live
  // on 1.17.11) — the free port must be found up front. cross-spawn matches the SDK's own PATH
  // resolution, including Windows `.cmd` shims.
  return crossSpawn('opencode', ['serve', '--hostname=127.0.0.1', `--port=${args.port}`], {
    cwd: args.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function terminate(proc: HistoryServerProcess, graceMs: number): Promise<void> {
  if (processExited(proc)) return Promise.resolve();
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

let shared: OpencodeHistoryServer | null = null;

/** The daemon-wide shared history server (one per process, created on first history call). */
export function sharedOpencodeHistoryServer(): OpencodeHistoryServer {
  shared ??= new OpencodeHistoryServer();
  return shared;
}
