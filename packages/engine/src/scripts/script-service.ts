import { Socket } from 'node:net';
import { allocatePort } from '@linkcode/common/node';
import type { ScriptHealth, ScriptLifecycle, WirePayload, WorkspaceScript } from '@linkcode/schema';
import { normalizeCwdKey } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { TerminalService } from '../terminal-service';
import type { ScriptDeclaration } from './config';
import { readWorkspaceScripts } from './config';
import { scriptHostname } from './hostname';
import type { PreviewRouteRegistry } from './route-registry';

const HEALTH_PROBE_INTERVAL_MS = 3000;
const HEALTH_PROBE_TIMEOUT_MS = 500;
/** A service that just started gets this long before failed probes count. */
const HEALTH_GRACE_MS = 5000;
const HEALTH_FAILURES_FOR_UNHEALTHY = 2;

const SERVICE_PTY_COLS = 160;
const SERVICE_PTY_ROWS = 48;

interface RunningScript {
  terminalId: string;
  lifecycle: Extract<ScriptLifecycle, 'running'>;
  health: ScriptHealth;
  startedAt: number;
  probeTimer?: NodeJS.Timeout;
  consecutiveProbeFailures: number;
  hostname?: string;
}

interface WorkspaceScriptsState {
  /** Planned ports for every declared service, allocated together on first need. */
  plan: Map<string, number>;
  running: Map<string, RunningScript>;
  lastExit: Map<string, number | null>;
}

/**
 * ScriptService: runs the workspace's declared scripts in managed PTYs, plans service
 * ports, injects the LINKCODE_* env contract, registers preview proxy routes, probes
 * service health over TCP, and broadcasts `script.status` on every change. Sits beside
 * `TerminalService` in the Engine; declarations are re-read from `linkcode.json` on
 * every list/start so config edits apply without a daemon restart.
 */
export class ScriptService {
  private readonly workspaces = new Map<string, WorkspaceScriptsState>();

  constructor(
    private readonly transport: Transport,
    private readonly terminals: TerminalService,
    private readonly routes: PreviewRouteRegistry,
    /** Display name for the hostname label (falls back to the cwd's last segment). */
    private readonly workspaceName: (cwd: string) => string | undefined,
  ) {}

  async list(cwd: string): Promise<WorkspaceScript[]> {
    const declarations = readWorkspaceScripts(cwd);
    const state = this.stateFor(cwd);
    await this.ensurePortPlan(declarations, state);
    return declarations.map((decl) => this.describe(cwd, decl, state));
  }

  async start(cwd: string, scriptName: string): Promise<void> {
    const declarations = readWorkspaceScripts(cwd);
    const decl = declarations.find((d) => d.name === scriptName);
    if (!decl) throw new Error(`Script not declared in ${cwd}: ${scriptName}`);

    const state = this.stateFor(cwd);
    if (state.running.has(scriptName)) throw new Error(`Script already running: ${scriptName}`);
    await this.ensurePortPlan(declarations, state);

    const terminalId = await this.terminals.openManaged(
      {
        cols: SERVICE_PTY_COLS,
        rows: SERVICE_PTY_ROWS,
        cwd,
        shell: '/bin/sh',
        args: ['-c', decl.command],
        env: this.scriptEnv(cwd, decl, declarations, state),
      },
      (exitCode) => this.onScriptExit(cwd, scriptName, exitCode),
    );

    const run: RunningScript = {
      terminalId,
      lifecycle: 'running',
      health: decl.type === 'service' ? 'unhealthy' : 'unknown',
      startedAt: Date.now(),
      consecutiveProbeFailures: 0,
    };
    state.running.set(scriptName, run);
    state.lastExit.delete(scriptName);

    if (decl.type === 'service') {
      const port = state.plan.get(scriptName)!;
      run.hostname = this.hostnameFor(cwd, scriptName);
      this.routes.register(run.hostname, { port }, ownerKey(cwd, scriptName));
      run.probeTimer = setInterval(() => {
        void this.probe(cwd, decl, run, port);
      }, HEALTH_PROBE_INTERVAL_MS);
      run.probeTimer.unref();
    }

    this.broadcast(cwd, this.describe(cwd, decl, state));
  }

  stop(cwd: string, scriptName: string): void {
    const run = this.stateFor(cwd).running.get(scriptName);
    if (!run) throw new Error(`Script not running: ${scriptName}`);
    // Cleanup and the status broadcast follow from the PTY exit event.
    this.terminals.close(run.terminalId);
  }

  /** Stop probes and kill script PTYs (engine shutdown; TerminalService reaps the processes). */
  shutdown(): void {
    for (const state of this.workspaces.values()) {
      for (const run of state.running.values()) {
        if (run.probeTimer) clearInterval(run.probeTimer);
        this.terminals.close(run.terminalId);
      }
    }
  }

  private onScriptExit(cwd: string, scriptName: string, exitCode: number | null): void {
    const state = this.stateFor(cwd);
    const run = state.running.get(scriptName);
    if (!run) return;
    if (run.probeTimer) clearInterval(run.probeTimer);
    if (run.hostname) this.routes.unregister(run.hostname, ownerKey(cwd, scriptName));
    state.running.delete(scriptName);
    state.lastExit.set(scriptName, exitCode);

    const decl = readWorkspaceScripts(cwd).find((d) => d.name === scriptName);
    this.broadcast(cwd, {
      scriptName,
      type: decl?.type ?? 'task',
      command: decl?.command ?? '',
      lifecycle: 'stopped',
      health: 'unknown',
      exitCode,
    });
  }

  private async probe(
    cwd: string,
    decl: ScriptDeclaration,
    run: RunningScript,
    port: number,
  ): Promise<void> {
    const reachable = await probeTcp(port);
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
      this.broadcast(cwd, this.describe(cwd, decl, this.stateFor(cwd)));
    }
  }

  private describe(
    cwd: string,
    decl: ScriptDeclaration,
    state: WorkspaceScriptsState,
  ): WorkspaceScript {
    const run = state.running.get(decl.name);
    const port = decl.type === 'service' ? state.plan.get(decl.name) : undefined;
    const hostname = decl.type === 'service' ? this.hostnameFor(cwd, decl.name) : undefined;
    return {
      scriptName: decl.name,
      type: decl.type,
      command: decl.command,
      lifecycle: run?.lifecycle ?? (state.lastExit.has(decl.name) ? 'stopped' : 'idle'),
      health: run?.health ?? 'unknown',
      port,
      hostname,
      localProxyUrl: hostname ? this.proxyUrl(hostname) : undefined,
      terminalId: run?.terminalId,
      exitCode: state.lastExit.get(decl.name),
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
    for (const decl of declarations) {
      if (decl.type !== 'service' || state.plan.has(decl.name)) continue;
      // eslint-disable-next-line no-await-in-loop -- ports are allocated one at a time on purpose
      state.plan.set(decl.name, decl.preferredPort ?? (await allocatePort()));
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
      state = { plan: new Map(), running: new Map(), lastExit: new Map() };
      this.workspaces.set(key, state);
    }
    return state;
  }

  private broadcast(cwd: string, script: WorkspaceScript): void {
    const payload: WirePayload = { kind: 'script.status', cwd, script };
    this.transport.send(createWireMessage(payload));
  }
}

function ownerKey(cwd: string, scriptName: string): string {
  return `${normalizeCwdKey(cwd)}#${scriptName}`;
}

function probeTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(HEALTH_PROBE_TIMEOUT_MS);
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}
