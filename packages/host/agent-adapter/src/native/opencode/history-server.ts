import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { allocatePort } from '@linkcode/common/node';
import { linkcodeStateDirName } from '@linkcode/schema/daemon-runtime';

import type { OpencodeServeProcess } from './serve';
import {
  awaitServeReady,
  ServeStartupExitError,
  serveProcessExited,
  spawnOpencodeServe,
  terminateServe,
} from './serve';

/** The slice of `ChildProcess` this manager drives — a structural type so tests can hand in a
 * plain fake instead of force-casting through `unknown`. */
export type HistoryServerProcess = OpencodeServeProcess;

export interface OpencodeHistoryServerOptions {
  /** Test seam — the real thing spawns `opencode serve` from the probe-resolved binary
   * ({@link spawnOpencodeServe}). */
  spawnServer?: (args: { port: number; cwd: string }) => HistoryServerProcess;
  allocatePort?: () => Promise<number>;
  /** Spawn cwd. opencode indexes its cwd as the default workspace, so this must be a neutral
   * empty directory — NEVER the daemon's cwd (from `$HOME` it would index the whole home tree).
   * The SDK's `createOpencode()` has no cwd option, which is why this manager spawns itself. */
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

/**
 * Daemon-shared `opencode serve` for history reads (CODE-171): history `list`/`read` run on
 * never-started adapter instances, so the backing server belongs to no live session — it is a
 * lazily-spawned, idle-reaped process shared across all history calls (live sessions keep their
 * own per-session SDK server). Multi-tenant: history calls carry no `directory`, and the
 * neutral-cwd instance lists/reads sessions across every project (verified live on 1.17.11).
 * For the eventual live-session consolidation (CODE-140): `withServer`'s callback-scoped
 * single-shot contract deliberately cannot express a session-lifetime acquire/release handle —
 * consolidation means REWRITING this class's public interface, not extending it.
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
  /** Installed ONCE for the manager's lifetime and never removed — it reads `current` dynamically.
   * (Per-generation removal once stripped the NEW generation's cleanup and orphaned the server on
   * daemon exit.) Process 'exit' handlers cannot wait; SIGKILL is the only reliable cleanup left. */
  private readonly onProcessExit = (): void => {
    const proc = this.current?.proc;
    if (proc && !serveProcessExited(proc)) proc.kill('SIGKILL');
  };

  constructor(options: OpencodeHistoryServerOptions = {}) {
    this.spawnServer = options.spawnServer ?? defaultSpawnServer;
    this.allocatePort = options.allocatePort ?? allocatePort;
    this.neutralCwd =
      options.neutralCwd ?? join(homedir(), linkcodeStateDirName(), 'opencode-history');
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
    if (!generation || serveProcessExited(generation.proc)) return;
    const stopping = terminateServe(generation.proc, this.shutdownGraceMs).finally(() => {
      if (this.stopping === stopping) this.stopping = null;
    });
    this.stopping = stopping;
    await stopping;
  }

  private async ensureRunning(): Promise<string> {
    if (this.current && !serveProcessExited(this.current.proc)) return this.current.ready;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async start(): Promise<string> {
    mkdirSync(this.neutralCwd, { recursive: true });
    try {
      return await this.spawnGeneration();
    } catch (err) {
      // One retry with a fresh port: allocatePort is check-then-use, so the port can be stolen
      // between probe and bind (an immediate startup-window exit). A config failure just fails twice.
      if (err instanceof ServeStartupExitError) return this.spawnGeneration();
      throw err;
    }
  }

  private async spawnGeneration(): Promise<string> {
    // A dispose may still be inside its SIGTERM grace window; overlapping it would briefly run
    // two servers. Checked per attempt — the startup retry must honor it too.
    if (this.stopping) await this.stopping;
    const port = await this.allocatePort();
    const proc = this.spawnServer({ port, cwd: this.neutralCwd });
    const generation: ServerGeneration = {
      proc,
      ready: awaitServeReady(proc, { timeoutMs: this.readyTimeoutMs, what: 'history server' }),
    };
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
      if (!serveProcessExited(proc)) proc.kill('SIGKILL');
      throw err;
    }
  }

  private armIdleTimer(): void {
    if (!this.current || serveProcessExited(this.current.proc)) return;
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
  return spawnOpencodeServe({ port: args.port, cwd: args.cwd });
}

let shared: OpencodeHistoryServer | null = null;

/** The daemon-wide shared history server (one per process, created on first history call). */
export function sharedOpencodeHistoryServer(): OpencodeHistoryServer {
  shared ??= new OpencodeHistoryServer();
  return shared;
}
