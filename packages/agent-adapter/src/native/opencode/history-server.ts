import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import crossSpawn from 'cross-spawn';
import { extractErrorMessage } from 'foxts/extract-error-message';

/** Startup output kept for the failure message when the server never reports readiness. */
const STARTUP_OUTPUT_CAP = 8192;
/** The server's readiness line: `opencode server listening on http://127.0.0.1:<port>`. */
const RE_LISTENING = /listening on\s+(https?:\/\/\S+)/;

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
  exited: boolean;
}

/**
 * Daemon-shared `opencode serve` for history reads (CODE-171). History `list`/`read` are served to
 * never-started adapter instances (`HistoryService` constructs one per call via the factory), so
 * the server backing them cannot belong to any live session — it is a lazily-spawned, idle-reaped
 * process shared across all history calls. Live sessions keep their own per-session SDK server;
 * consolidating both onto one server (the full paseo model) is a deliberate non-goal here.
 *
 * The server is multi-tenant: history calls carry no `directory`, and the neutral-cwd instance
 * lists and reads sessions across every project (verified live on opencode 1.17.11).
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
  private inFlight = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onProcessExit = (): void => {
    // Process 'exit' handlers cannot wait; SIGKILL is the only reliable cleanup left.
    this.current?.proc.kill('SIGKILL');
  };

  constructor(options: OpencodeHistoryServerOptions = {}) {
    this.spawnServer = options.spawnServer ?? defaultSpawnServer;
    this.allocatePort = options.allocatePort ?? findAvailablePort;
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
    if (!generation || generation.exited) return;
    process.removeListener('exit', this.onProcessExit);
    await terminate(generation.proc, this.shutdownGraceMs);
  }

  private async ensureRunning(): Promise<string> {
    if (this.current && !this.current.exited) return this.current.ready;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async start(): Promise<string> {
    const port = await this.allocatePort();
    mkdirSync(this.neutralCwd, { recursive: true });
    const proc = this.spawnServer({ port, cwd: this.neutralCwd });
    const generation: ServerGeneration = { proc, ready: Promise.resolve(''), exited: false };
    generation.ready = this.awaitReadiness(generation);
    this.current = generation;
    process.once('exit', this.onProcessExit);
    proc.once('exit', () => {
      generation.exited = true;
      process.removeListener('exit', this.onProcessExit);
      // A crash (or the idle reap) retires this generation; the next call respawns fresh.
      if (this.current === generation) this.current = null;
    });
    try {
      return await generation.ready;
    } catch (err) {
      if (this.current === generation) this.current = null;
      if (!generation.exited) proc.kill('SIGKILL');
      throw err;
    }
  }

  private awaitReadiness(generation: ServerGeneration): Promise<string> {
    const { proc } = generation;
    return new Promise<string>((resolve, reject) => {
      let output = '';
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
      const fail = (headline: string): void => {
        settle(() => {
          const detail = output.trim();
          reject(new Error(detail ? `${headline}\n${detail}` : headline));
        });
      };
      timer = setTimeout(() => {
        fail(`opencode: history server startup timed out after ${this.readyTimeoutMs}ms`);
      }, this.readyTimeoutMs);
      timer.unref();
      proc.stdout?.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (output.length < STARTUP_OUTPUT_CAP) output += chunk.toString();
        const match = RE_LISTENING.exec(output);
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
        fail(`opencode: history server exited during startup (code ${code})`);
      });
    });
  }

  private armIdleTimer(): void {
    if (!this.current || this.current.exited) return;
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
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
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

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address) resolve(address.port);
        else reject(new Error('opencode: failed to allocate a port for the history server'));
      });
    });
    server.on('error', reject);
  });
}

let shared: OpencodeHistoryServer | null = null;

/** The daemon-wide shared history server (one per process, created on first history call). */
export function sharedOpencodeHistoryServer(): OpencodeHistoryServer {
  shared ??= new OpencodeHistoryServer();
  return shared;
}
