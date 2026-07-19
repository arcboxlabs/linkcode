import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { Cause, Effect, Exit } from 'effect';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PreviewRouteRegistry } from '../preview/route-registry';
import { readWorkspaceScripts } from '../scripts/config';
import { scriptHostname } from '../scripts/hostname';
import { ScriptService } from '../scripts/script-service';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from '../terminal/pty-backend';
import { TerminalService } from '../terminal/service';

const roots: string[] = [];
const RE_TERMINAL_ID = /^term-/;

function makeWorkspace(config?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-script-test-'));
  roots.push(dir);
  if (config !== undefined) {
    writeFileSync(join(dir, 'linkcode.json'), JSON.stringify(config));
  }
  return dir;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

class FakePtyProcess implements PtyProcess {
  killed = false;
  private readonly exitCbs: Array<(c: number | null) => void> = [];

  onData(_cb: (data: string) => void): Unsubscribe {
    return noop;
  }
  onExit(cb: (c: number | null) => void): Unsubscribe {
    this.exitCbs.push(cb);
    return noop;
  }
  write(): void {
    /* scripts never write to their PTY in these tests */
  }
  resize(): void {
    /* no observable effect */
  }
  grantRead(): void {
    /* unthrottled fake */
  }
  kill(): void {
    this.killed = true;
    this.exit(0);
  }
  exit(code: number | null): void {
    for (const cb of this.exitCbs) cb(code);
  }
}

class SyncExitPtyProcess extends FakePtyProcess {
  override onData(cb: (data: string) => void): Unsubscribe {
    cb('done\r\n');
    return noop;
  }

  override onExit(cb: (code: number | null) => void): Unsubscribe {
    cb(7);
    return noop;
  }
}

class FakePtyBackend implements PtyBackend {
  readonly opens: Array<{ opts: PtyOpenOptions; process: FakePtyProcess }> = [];

  open(_terminalId: string, opts: PtyOpenOptions): Promise<PtyProcess> {
    const process = new FakePtyProcess();
    this.opens.push({ opts, process });
    return Promise.resolve(process);
  }
  shutdown(): void {
    /* nothing to release */
  }
}

class SyncExitPtyBackend extends FakePtyBackend {
  override open(_terminalId: string, opts: PtyOpenOptions): Promise<PtyProcess> {
    const process = new SyncExitPtyProcess();
    this.opens.push({ opts, process });
    return Promise.resolve(process);
  }
}

class PendingPtyBackend extends FakePtyBackend {
  readonly opened: Promise<void>;
  readonly process = new FakePtyProcess();
  private readonly pending: Promise<PtyProcess>;
  private resolveOpen: () => void = noop;
  private resolveProcess: (process: PtyProcess) => void = noop;

  constructor() {
    super();
    this.opened = new Promise((resolve) => {
      this.resolveOpen = resolve;
    });
    this.pending = new Promise((resolve) => {
      this.resolveProcess = resolve;
    });
  }

  override open(_terminalId: string, opts: PtyOpenOptions): Promise<PtyProcess> {
    this.opens.push({ opts, process: this.process });
    this.resolveOpen();
    return this.pending;
  }

  release(): void {
    this.resolveProcess(this.process);
  }
}

function recordingTransport(): { transport: Transport; sent: WirePayload[] } {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  return { transport, sent };
}

function makeService(
  backend = new FakePtyBackend(),
  options: NonNullable<ConstructorParameters<typeof ScriptService>[4]> = {},
): {
  service: ScriptService;
  terminals: TerminalService;
  backend: FakePtyBackend;
  routes: PreviewRouteRegistry;
  sent: WirePayload[];
} {
  const { transport, sent } = recordingTransport();
  const terminals = new TerminalService(backend, transport);
  const routes = new PreviewRouteRegistry();
  routes.proxyPort = 19523;
  const service = new ScriptService(transport, terminals, routes, () => 'app', options);
  service.bindRuntime(Effect.runFork);
  return { service, terminals, backend, routes, sent };
}

describe('readWorkspaceScripts', () => {
  it('parses task and service shapes, dropping malformed entries alone', () => {
    const cwd = makeWorkspace({
      scripts: {
        build: { command: 'pnpm build' },
        web: { type: 'service', command: 'pnpm dev', port: 5173 },
        broken: { commnd: 'typo' },
        alsoBroken: 42,
      },
    });
    expect(readWorkspaceScripts(cwd)).toEqual([
      { name: 'build', type: 'task', command: 'pnpm build', preferredPort: undefined },
      { name: 'web', type: 'service', command: 'pnpm dev', preferredPort: 5173 },
    ]);
  });

  it('returns nothing for a missing or unparsable config', () => {
    expect(readWorkspaceScripts(makeWorkspace())).toEqual([]);
    const cwd = makeWorkspace();
    writeFileSync(join(cwd, 'linkcode.json'), '{not json');
    expect(readWorkspaceScripts(cwd)).toEqual([]);
  });
});

describe('scriptHostname', () => {
  it('builds the namespaced label with a stable cwd hash', () => {
    const a = scriptHostname('Web App', 'My Project', '/tmp/a');
    expect(a).toMatch(/^web-app--my-project-[0-9a-f]{6}\.localhost$/);
    expect(scriptHostname('Web App', 'My Project', '/tmp/a')).toBe(a);
    expect(scriptHostname('Web App', 'My Project', '/tmp/b')).not.toBe(a);
  });
});

describe('ScriptService', () => {
  it('starts a service: plans the port, injects env, registers the route, broadcasts', async () => {
    const cwd = makeWorkspace({
      scripts: {
        web: { type: 'service', command: 'pnpm dev', port: 4321 },
        api: { type: 'service', command: 'pnpm api' },
      },
    });
    const { service, backend, routes, sent } = makeService();

    await Effect.runPromise(service.start(cwd, 'web'));

    const { opts } = backend.opens[0];
    expect(opts.shell).toBe('/bin/sh');
    expect(opts.args).toEqual(['-c', 'pnpm dev']);
    expect(opts.cwd).toBe(cwd);
    expect(opts.env?.LINKCODE_PORT).toBe('4321');
    expect(opts.env?.LINKCODE_URL).toMatch(/^http:\/\/web--app-[0-9a-f]{6}\.localhost:19523$/);
    // Sibling service got a planned port without being started.
    expect(opts.env?.LINKCODE_SERVICE_API_PORT).toMatch(/^\d+$/);
    expect(opts.env?.LINKCODE_SERVICE_API_URL).toContain('api--app-');

    const hostname = new URL(opts.env!.LINKCODE_URL).hostname;
    expect(routes.lookup(hostname)).toEqual({ port: 4321 });

    const status = sent.find((p) => p.kind === 'script.status');
    expect(status?.kind === 'script.status' && status.script.lifecycle).toBe('running');
  });

  it('stop kills the PTY; exit unregisters the route and broadcasts stopped', async () => {
    const cwd = makeWorkspace({
      scripts: { web: { type: 'service', command: 'sleep 999', port: 4545 } },
    });
    const { service, backend, routes, sent } = makeService();

    await Effect.runPromise(service.start(cwd, 'web'));
    const hostname = [...sent]
      .map((p) => (p.kind === 'script.status' ? p.script.hostname : undefined))
      .find(Boolean)!;

    await Effect.runPromise(service.stop(cwd, 'web'));
    expect(backend.opens[0].process.killed).toBe(true);
    expect(routes.lookup(hostname)).toBeNull();

    const last = sent.findLast((p) => p.kind === 'script.status');
    expect(last?.kind === 'script.status' && last.script.lifecycle).toBe('stopped');
    expect(last?.kind === 'script.status' && last.script.exitCode).toBe(0);

    const listed = await Effect.runPromise(service.list(cwd));
    expect(listed[0].lifecycle).toBe('stopped');
    expect(listed[0].terminalId).toBe(
      last?.kind === 'script.status' ? last.script.terminalId : null,
    );
  });

  it('records a synchronous exit as stopped and keeps its terminal replay attachable', async () => {
    const cwd = makeWorkspace({ scripts: { build: { command: 'printf done' } } });
    const { service, terminals, sent } = makeService(new SyncExitPtyBackend());

    await Effect.runPromise(service.start(cwd, 'build'));

    const [script] = await Effect.runPromise(service.list(cwd));
    expect(script).toMatchObject({
      lifecycle: 'stopped',
      health: 'unknown',
      exitCode: 7,
      terminalId: expect.stringMatching(RE_TERMINAL_ID),
    });
    await expect(Effect.runPromise(service.stop(cwd, 'build'))).rejects.toThrow('not running');
    const status = sent.findLast((payload) => payload.kind === 'script.status');
    expect(status).toMatchObject({
      kind: 'script.status',
      script: { lifecycle: 'stopped', terminalId: script.terminalId, exitCode: 7 },
    });

    const attachIndex = sent.length;
    terminals.attach(
      'req-replay',
      script.terminalId!,
      { attachmentId: 'viewer', attachmentSecret: 'v'.repeat(32) },
      'view',
    );
    expect(sent.slice(attachIndex)).toMatchObject([
      {
        kind: 'terminal.attached',
        replay: [
          { type: 'resize', seq: 1, cols: 160, rows: 48 },
          { type: 'write', seq: 2, data: 'done\r\n' },
        ],
      },
      { kind: 'terminal.exit', terminalId: script.terminalId, exitCode: 7 },
    ]);
    await Effect.runPromise(terminals.shutdown());
  });

  it('rejects starting an unknown or already-running script', async () => {
    const cwd = makeWorkspace({ scripts: { web: { type: 'service', command: 'x', port: 4646 } } });
    const { service } = makeService();
    await expect(Effect.runPromise(service.start(cwd, 'nope'))).rejects.toThrow('not declared');
    await Effect.runPromise(service.start(cwd, 'web'));
    await expect(Effect.runPromise(service.start(cwd, 'web'))).rejects.toThrow('already running');
  });

  it('admits only one concurrent start for a script', async () => {
    const cwd = makeWorkspace({ scripts: { web: { command: 'sleep 999' } } });
    const backend = new PendingPtyBackend();
    const { service } = makeService(backend);
    const first = Effect.runPromise(service.start(cwd, 'web'));
    await backend.opened;

    await expect(Effect.runPromise(service.start(cwd, 'web'))).rejects.toThrow('already running');
    expect(backend.opens).toHaveLength(1);

    backend.release();
    await first;
  });

  it('runs service health probes as an owned serial Effect loop', async () => {
    const cwd = makeWorkspace({
      scripts: { web: { type: 'service', command: 'sleep 999', port: 4747 } },
    });
    const { service, terminals, sent } = makeService(new FakePtyBackend(), {
      healthProbeIntervalMs: 1,
      probeTcp: () => Effect.succeed(true),
    });

    await Effect.runPromise(service.start(cwd, 'web'));
    await vi.waitFor(() => {
      const status = sent.findLast((payload) => payload.kind === 'script.status');
      expect(status?.kind === 'script.status' && status.script.health).toBe('healthy');
    });

    await Effect.runPromise(service.shutdown());
    await Effect.runPromise(terminals.shutdown());
  });

  it('interrupts an active probe when its PTY exits', async () => {
    const cwd = makeWorkspace({
      scripts: { web: { type: 'service', command: 'sleep 999', port: 4797 } },
    });
    let signalStarted = noop;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let finishProbe = noop;
    let cleanups = 0;
    const { service, terminals, sent } = makeService(new FakePtyBackend(), {
      healthProbeIntervalMs: 1,
      probeTcp: () =>
        Effect.callback<boolean>((resume) => {
          finishProbe = () => resume(Effect.succeed(true));
          signalStarted();
          return Effect.sync(() => {
            cleanups += 1;
          });
        }),
    });

    await Effect.runPromise(service.start(cwd, 'web'));
    await started;
    await Effect.runPromise(service.stop(cwd, 'web'));
    await vi.waitFor(() => expect(cleanups).toBe(1));

    const statusCount = sent.filter((payload) => payload.kind === 'script.status').length;
    finishProbe();
    await wait(0);
    expect(sent.filter((payload) => payload.kind === 'script.status')).toHaveLength(statusCount);
    await Effect.runPromise(service.shutdown());
    await Effect.runPromise(terminals.shutdown());
  });

  it('does not overlap probes and waits for probe cleanup during shutdown', async () => {
    const cwd = makeWorkspace({
      scripts: { web: { type: 'service', command: 'sleep 999', port: 4848 } },
    });
    let signalStarted = noop;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let signalCleanupStarted = noop;
    const cleanupStarted = new Promise<void>((resolve) => {
      signalCleanupStarted = resolve;
    });
    let releaseCleanup = noop;
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let finishProbe = noop;
    let probeCalls = 0;
    let cleanups = 0;
    const { service, terminals, routes, sent } = makeService(new FakePtyBackend(), {
      healthProbeIntervalMs: 1,
      probeTcp: () =>
        Effect.callback<boolean>((resume) => {
          probeCalls += 1;
          finishProbe = () => resume(Effect.succeed(true));
          signalStarted();
          return Effect.sync(signalCleanupStarted).pipe(
            Effect.andThen(Effect.promise(() => cleanupReleased)),
            Effect.tap(() =>
              Effect.sync(() => {
                cleanups += 1;
              }),
            ),
          );
        }),
    });

    await Effect.runPromise(service.start(cwd, 'web'));
    await started;
    await wait(10);
    expect(probeCalls).toBe(1);
    const running = sent.find((payload) => payload.kind === 'script.status');
    const hostname = running?.kind === 'script.status' ? running.script.hostname : undefined;

    let shutdownSettled = false;
    const shutdown = Effect.runPromise(service.shutdown()).then(() => {
      shutdownSettled = true;
    });
    await cleanupStarted;
    await wait(0);
    expect(shutdownSettled).toBe(false);

    releaseCleanup();
    await shutdown;
    expect(cleanups).toBe(1);
    expect(hostname && routes.lookup(hostname)).toBeNull();

    const statusCount = sent.filter((payload) => payload.kind === 'script.status').length;
    finishProbe();
    await wait(0);
    expect(sent.filter((payload) => payload.kind === 'script.status')).toHaveLength(statusCount);
    await Effect.runPromise(terminals.shutdown());
  });

  it('shutdown interrupts a pending start and closes admission', async () => {
    const cwd = makeWorkspace({ scripts: { web: { command: 'sleep 999' } } });
    const backend = new PendingPtyBackend();
    const { service, terminals, sent } = makeService(backend);
    const startExit = Effect.runPromiseExit(service.start(cwd, 'web'));
    await backend.opened;

    await Promise.all([
      Effect.runPromise(service.shutdown()),
      Effect.runPromise(service.shutdown()),
    ]);

    const exit = await startExit;
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    await expect(Effect.runPromise(service.start(cwd, 'web'))).rejects.toThrow('shutting down');
    expect(sent.filter((payload) => payload.kind === 'script.status')).toEqual([]);

    backend.release();
    await Effect.runPromise(terminals.shutdown());
    expect(backend.process.killed).toBe(true);
  });

  it('list keeps planned ports stable across calls', async () => {
    const cwd = makeWorkspace({ scripts: { api: { type: 'service', command: 'x' } } });
    const { service } = makeService();
    const [first] = await Effect.runPromise(service.list(cwd));
    const [second] = await Effect.runPromise(service.list(cwd));
    expect(first.port).toBeGreaterThan(0);
    expect(second.port).toBe(first.port);
    expect(first.localProxyUrl).toBe(`http://${first.hostname}:19523`);
  });

  it('shares one port plan across concurrent callers', async () => {
    const cwd = makeWorkspace({ scripts: { api: { type: 'service', command: 'x' } } });
    let releaseAllocation = noop;
    const allocationReleased = new Promise<void>((resolve) => {
      releaseAllocation = resolve;
    });
    let allocations = 0;
    const { service, terminals } = makeService(new FakePtyBackend(), {
      async allocatePort() {
        const allocation = ++allocations;
        await allocationReleased;
        return 5000 + allocation;
      },
    });

    const first = Effect.runPromise(service.list(cwd));
    const second = Effect.runPromise(service.list(cwd));
    await vi.waitFor(() => expect(allocations).toBeGreaterThan(0));
    releaseAllocation();
    const [[firstScript], [secondScript]] = await Promise.all([first, second]);

    expect(allocations).toBe(1);
    expect(secondScript.port).toBe(firstScript.port);
    await Effect.runPromise(service.shutdown());
    await Effect.runPromise(terminals.shutdown());
  });
});
