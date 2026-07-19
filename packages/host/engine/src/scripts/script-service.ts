import { Socket } from 'node:net';
import { allocatePort } from '@linkcode/common/node';
import type { ScriptHealth, ScriptLifecycle, WirePayload, WorkspaceScript } from '@linkcode/schema';
import { normalizeCwdKey } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Cause, Effect, Fiber } from 'effect';
import { nullthrow } from 'foxts/guard';
import type { EngineFailure } from '../failure';
import { RequestError, toOperationFailure } from '../failure';
import type { PreviewRouteRegistry } from '../preview/route-registry';
import type { TerminalService } from '../terminal/service';
import type { ScriptDeclaration } from './config';
import { readWorkspaceScripts } from './config';
import { scriptHostname } from './hostname';

const HEALTH_PROBE_INTERVAL_MS = 3000;
const HEALTH_PROBE_TIMEOUT_MS = 500;
/** A service that just started gets this long before failed probes count. */
const HEALTH_GRACE_MS = 5000;
const HEALTH_FAILURES_FOR_UNHEALTHY = 2;

const SERVICE_PTY_COLS = 160;
const SERVICE_PTY_ROWS = 48;

type RunTask = <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;

interface StartingHandle {
  fiber?: Fiber.Fiber<void, EngineFailure>;
}

interface RunningScript {
  terminalId: string;
  lifecycle: Extract<ScriptLifecycle, 'running'>;
  health: ScriptHealth;
  startedAt: number;
  probeFiber?: Fiber.Fiber<unknown>;
  consecutiveProbeFailures: number;
  hostname?: string;
}

interface WorkspaceScriptsState {
  /** Planned ports for every declared service, allocated together on first need. */
  plan: Map<string, number>;
  planning?: Promise<void>;
  starting: Map<string, StartingHandle>;
  running: Map<string, RunningScript>;
  stopped: Map<string, { terminalId: string; exitCode: number | null }>;
}

interface ScriptServiceOptions {
  readonly allocatePort?: () => Promise<number>;
  readonly healthProbeIntervalMs?: number;
  readonly probeTcp?: (port: number) => Effect.Effect<boolean>;
}

/**
 * Runs the workspace's declared scripts in managed PTYs (port planning, LINKCODE_* env contract,
 * preview routes, TCP health probes, `script.status` broadcasts). Declarations are re-read from
 * `linkcode.json` on every list/start, so config edits apply without a daemon restart.
 */
export class ScriptService {
  private readonly workspaces = new Map<string, WorkspaceScriptsState>();
  private readonly probes = new Set<Fiber.Fiber<unknown>>();
  private runTask: RunTask | undefined;
  private accepting = true;

  constructor(
    private readonly transport: Transport,
    private readonly terminals: TerminalService,
    private readonly routes: PreviewRouteRegistry,
    /** Display name for the hostname label (falls back to the cwd's last segment). */
    private readonly workspaceName: (cwd: string) => string | undefined,
    private readonly options: ScriptServiceOptions = {},
  ) {}

  bindRuntime(runTask: RunTask): void {
    this.runTask = runTask;
  }

  list(cwd: string): Effect.Effect<WorkspaceScript[], EngineFailure> {
    return Effect.tryPromise({
      try: async () => {
        this.ensureAccepting();
        const declarations = readWorkspaceScripts(cwd);
        const state = this.stateFor(cwd);
        await this.ensurePortPlan(declarations, state);
        this.ensureAccepting();
        return declarations.map((decl) => this.describe(cwd, decl, state));
      },
      catch: (cause) => scriptFailure(cause, 'script.list', 'Failed to list workspace scripts'),
    });
  }

  start(cwd: string, scriptName: string): Effect.Effect<void, EngineFailure> {
    return Effect.try({
      try: () => this.launchStart(cwd, scriptName),
      catch: (cause) => scriptFailure(cause, 'script.start', 'Failed to start workspace script'),
    }).pipe(
      Effect.flatMap((fiber) =>
        Fiber.join(fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(fiber))),
      ),
    );
  }

  stop(cwd: string, scriptName: string): Effect.Effect<void, EngineFailure> {
    return Effect.try({
      try: () => {
        this.ensureAccepting();
        const run = this.stateFor(cwd).running.get(scriptName);
        if (!run) {
          throw new RequestError({
            code: 'conflict',
            message: `Script not running: ${scriptName}`,
          });
        }
        // Cleanup and the status broadcast follow from the PTY exit event.
        this.terminals.closeManaged(run.terminalId);
      },
      catch: (cause) => scriptFailure(cause, 'script.stop', 'Failed to stop workspace script'),
    });
  }

  /** Close admission, release routes and terminals, then drain Engine-owned script fibers. */
  shutdown(): Effect.Effect<void> {
    return Effect.sync(() => this.beginShutdown()).pipe(
      Effect.flatMap((fibers) => Fiber.interruptAll(fibers)),
      Effect.andThen(
        Effect.sync(() => {
          for (const state of this.workspaces.values()) {
            state.starting.clear();
            state.running.clear();
          }
        }),
      ),
    );
  }

  private launchStart(cwd: string, scriptName: string): Fiber.Fiber<void, EngineFailure> {
    this.ensureAccepting();
    const declarations = readWorkspaceScripts(cwd);
    const decl = declarations.find((d) => d.name === scriptName);
    if (!decl) {
      throw new RequestError({
        code: 'not_found',
        message: `Script not declared in ${cwd}: ${scriptName}`,
      });
    }

    const state = this.stateFor(cwd);
    if (state.starting.has(scriptName) || state.running.has(scriptName)) {
      throw new RequestError({
        code: 'conflict',
        message: `Script already running: ${scriptName}`,
      });
    }
    const run = nullthrow(this.runTask, 'Script runtime has not started');
    const handle: StartingHandle = {};
    state.starting.set(scriptName, handle);
    const fiber = run(
      Effect.tryPromise({
        try: (signal) => this.openScriptAsync(cwd, decl, declarations, state, signal),
        catch: (cause) => scriptFailure(cause, 'script.start', 'Failed to start workspace script'),
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (state.starting.get(scriptName) === handle) state.starting.delete(scriptName);
          }),
        ),
      ),
    );
    handle.fiber = fiber;
    return fiber;
  }

  private async openScriptAsync(
    cwd: string,
    decl: ScriptDeclaration,
    declarations: ScriptDeclaration[],
    state: WorkspaceScriptsState,
    signal: AbortSignal,
  ): Promise<void> {
    await this.ensurePortPlan(declarations, state);
    let running: RunningScript | undefined;
    let pendingExit: { exitCode: number | null } | undefined;
    const terminalId = await this.terminals.openManaged(
      {
        cols: SERVICE_PTY_COLS,
        rows: SERVICE_PTY_ROWS,
        cwd,
        shell: '/bin/sh',
        args: ['-c', decl.command],
        env: this.scriptEnv(cwd, decl, declarations, state),
      },
      (exitCode) => {
        if (running) this.onScriptExit(cwd, decl.name, running, exitCode);
        else pendingExit = { exitCode };
      },
      signal,
    );
    if (!this.accepting) {
      this.terminals.closeManaged(terminalId);
      throw shuttingDown();
    }
    running = {
      terminalId,
      lifecycle: 'running',
      health: decl.type === 'service' ? 'unhealthy' : 'unknown',
      startedAt: Date.now(),
      consecutiveProbeFailures: 0,
    };
    state.running.set(decl.name, running);
    state.stopped.delete(decl.name);
    if (pendingExit) {
      this.onScriptExit(cwd, decl.name, running, pendingExit.exitCode);
      return;
    }

    if (decl.type === 'service') {
      const port = nullthrow(state.plan.get(decl.name));
      running.hostname = this.hostnameFor(cwd, decl.name);
      this.routes.register(running.hostname, { port }, ownerKey(cwd, decl.name));
      running.probeFiber = this.startProbe(cwd, decl, running, port);
    }

    this.broadcast(cwd, this.describe(cwd, decl, state));
  }

  private onScriptExit(
    cwd: string,
    scriptName: string,
    run: RunningScript,
    exitCode: number | null,
  ): void {
    const state = this.stateFor(cwd);
    if (state.running.get(scriptName) !== run) return;
    run.probeFiber?.interruptUnsafe();
    if (run.hostname) this.routes.unregister(run.hostname, ownerKey(cwd, scriptName));
    state.running.delete(scriptName);
    state.stopped.set(scriptName, { terminalId: run.terminalId, exitCode });

    const decl = readWorkspaceScripts(cwd).find((d) => d.name === scriptName);
    this.broadcast(cwd, {
      scriptName,
      type: decl?.type ?? 'task',
      command: decl?.command ?? '',
      lifecycle: 'stopped',
      health: 'unknown',
      terminalId: run.terminalId,
      exitCode,
    });
  }

  private startProbe(
    cwd: string,
    decl: ScriptDeclaration,
    run: RunningScript,
    port: number,
  ): Fiber.Fiber<unknown> {
    const runTask = nullthrow(this.runTask, 'Script runtime has not started');
    const interval = this.options.healthProbeIntervalMs ?? HEALTH_PROBE_INTERVAL_MS;
    const fiber = runTask(
      Effect.sleep(interval).pipe(
        Effect.andThen(
          this.probe(cwd, decl, run, port).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.logError(
                    'Script health probe failed',
                    { operation: 'script.probe', subsystem: 'script' },
                    Cause.squash(cause),
                  ),
            ),
          ),
        ),
        Effect.forever,
      ),
    );
    this.probes.add(fiber);
    fiber.addObserver(() => this.probes.delete(fiber));
    return fiber;
  }

  private probe(
    cwd: string,
    decl: ScriptDeclaration,
    run: RunningScript,
    port: number,
  ): Effect.Effect<void> {
    return (this.options.probeTcp ?? probeTcp)(port).pipe(
      Effect.tap((reachable) =>
        Effect.sync(() => {
          const state = this.stateFor(cwd);
          if (!this.accepting || state.running.get(decl.name) !== run) return;
          let next: ScriptHealth = run.health;
          if (reachable) {
            run.consecutiveProbeFailures = 0;
            next = 'healthy';
          } else if (Date.now() - run.startedAt > HEALTH_GRACE_MS) {
            run.consecutiveProbeFailures += 1;
            if (run.consecutiveProbeFailures >= HEALTH_FAILURES_FOR_UNHEALTHY) next = 'unhealthy';
          }
          if (next !== run.health) {
            run.health = next;
            this.broadcast(cwd, this.describe(cwd, decl, state));
          }
        }),
      ),
      Effect.asVoid,
    );
  }

  private describe(
    cwd: string,
    decl: ScriptDeclaration,
    state: WorkspaceScriptsState,
  ): WorkspaceScript {
    const run = state.running.get(decl.name);
    const stopped = state.stopped.get(decl.name);
    const port = decl.type === 'service' ? state.plan.get(decl.name) : undefined;
    const hostname = decl.type === 'service' ? this.hostnameFor(cwd, decl.name) : undefined;
    return {
      scriptName: decl.name,
      type: decl.type,
      command: decl.command,
      lifecycle: run?.lifecycle ?? (stopped ? 'stopped' : 'idle'),
      health: run?.health ?? 'unknown',
      port,
      hostname,
      localProxyUrl: hostname ? this.proxyUrl(hostname) : undefined,
      terminalId: run?.terminalId ?? stopped?.terminalId,
      exitCode: stopped?.exitCode,
    };
  }

  /** LINKCODE_PORT/URL for the script itself plus PORT/URL for every sibling service. */
  private scriptEnv(
    cwd: string,
    decl: ScriptDeclaration,
    declarations: ScriptDeclaration[],
    state: WorkspaceScriptsState,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    const selfPort = decl.type === 'service' ? state.plan.get(decl.name) : undefined;
    if (selfPort !== undefined) {
      env.LINKCODE_PORT = String(selfPort);
      const url = this.proxyUrl(this.hostnameFor(cwd, decl.name));
      if (url) env.LINKCODE_URL = url;
    }
    for (const sibling of declarations) {
      if (sibling.type !== 'service') continue;
      const port = state.plan.get(sibling.name);
      if (port === undefined) continue;
      const key = sibling.name.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');
      env[`LINKCODE_SERVICE_${key}_PORT`] = String(port);
      const url = this.proxyUrl(this.hostnameFor(cwd, sibling.name));
      if (url) env[`LINKCODE_SERVICE_${key}_URL`] = url;
    }
    return env;
  }

  private async ensurePortPlan(
    declarations: ScriptDeclaration[],
    state: WorkspaceScriptsState,
  ): Promise<void> {
    if (state.planning) {
      await state.planning;
      return this.ensurePortPlan(declarations, state);
    }
    const missing = declarations.filter(
      (decl) => decl.type === 'service' && !state.plan.has(decl.name),
    );
    if (missing.length === 0) return;
    const planning = this.allocatePorts(missing, state);
    state.planning = planning;
    try {
      await planning;
    } finally {
      if (state.planning === planning) state.planning = undefined;
    }
    return this.ensurePortPlan(declarations, state);
  }

  private async allocatePorts(
    declarations: ScriptDeclaration[],
    state: WorkspaceScriptsState,
  ): Promise<void> {
    for (const decl of declarations) {
      // eslint-disable-next-line no-await-in-loop -- ports are allocated one at a time on purpose
      const port = decl.preferredPort ?? (await (this.options.allocatePort ?? allocatePort)());
      this.ensureAccepting();
      state.plan.set(decl.name, port);
    }
  }

  private hostnameFor(cwd: string, scriptName: string): string {
    const name = this.workspaceName(cwd) ?? cwd.split('/').findLast(Boolean) ?? 'workspace';
    return scriptHostname(scriptName, name, cwd);
  }

  private proxyUrl(hostname: string): string | undefined {
    const port = this.routes.proxyPort;
    return port === null ? undefined : `http://${hostname}:${port}`;
  }

  private stateFor(cwd: string): WorkspaceScriptsState {
    const key = normalizeCwdKey(cwd);
    let state = this.workspaces.get(key);
    if (!state) {
      state = { plan: new Map(), starting: new Map(), running: new Map(), stopped: new Map() };
      this.workspaces.set(key, state);
    }
    return state;
  }

  private ensureAccepting(): void {
    if (!this.accepting) throw shuttingDown();
  }

  private beginShutdown(): Array<Fiber.Fiber<unknown, unknown>> {
    const fibers: Array<Fiber.Fiber<unknown, unknown>> = [...this.probes];
    for (const state of this.workspaces.values()) {
      for (const handle of state.starting.values()) {
        if (handle.fiber) fibers.push(handle.fiber);
      }
    }
    if (!this.accepting) return fibers;
    this.accepting = false;
    for (const [cwd, state] of this.workspaces) {
      for (const [scriptName, run] of state.running) {
        if (run.hostname) this.routes.unregister(run.hostname, ownerKey(cwd, scriptName));
        this.terminals.closeManaged(run.terminalId);
      }
    }
    return fibers;
  }

  private broadcast(cwd: string, script: WorkspaceScript): void {
    const payload: WirePayload = { kind: 'script.status', cwd, script };
    this.transport.send(createWireMessage(payload));
  }
}

function ownerKey(cwd: string, scriptName: string): string {
  return `${normalizeCwdKey(cwd)}#${scriptName}`;
}

function probeTcp(port: number): Effect.Effect<boolean> {
  return Effect.callback<boolean>((resume) => {
    const socket = new Socket();
    socket.setTimeout(HEALTH_PROBE_TIMEOUT_MS);
    let settled = false;
    function cleanup(): void {
      socket.off('connect', onConnect);
      socket.off('timeout', onTimeout);
      socket.off('error', onError);
      socket.destroy();
    }
    function done(ok: boolean): void {
      if (settled) return;
      settled = true;
      cleanup();
      resume(Effect.succeed(ok));
    }
    function onConnect(): void {
      done(true);
    }
    function onTimeout(): void {
      done(false);
    }
    function onError(): void {
      done(false);
    }
    socket.once('connect', onConnect);
    socket.once('timeout', onTimeout);
    socket.once('error', onError);
    try {
      socket.connect(port, '127.0.0.1');
    } catch {
      done(false);
    }
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      cleanup();
    });
  });
}

function scriptFailure(cause: unknown, operation: string, publicMessage: string): EngineFailure {
  return toOperationFailure(cause, { subsystem: 'script', operation, publicMessage });
}

function shuttingDown(): RequestError {
  return new RequestError({ code: 'cancelled', message: 'Script service is shutting down' });
}
