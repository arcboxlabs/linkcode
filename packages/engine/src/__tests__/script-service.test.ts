import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { afterAll, describe, expect, it } from 'vitest';
import { PreviewRouteRegistry } from '../preview/route-registry';
import type { PtyBackend, PtyOpenOptions, PtyProcess } from '../pty-backend';
import { readWorkspaceScripts } from '../scripts/config';
import { scriptHostname } from '../scripts/hostname';
import { ScriptService } from '../scripts/script-service';
import { TerminalService } from '../terminal-service';

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

function makeService(backend = new FakePtyBackend()): {
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
  const service = new ScriptService(transport, terminals, routes, () => 'app');
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

    await service.start(cwd, 'web');

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

    await service.start(cwd, 'web');
    const hostname = [...sent]
      .map((p) => (p.kind === 'script.status' ? p.script.hostname : undefined))
      .find(Boolean)!;

    service.stop(cwd, 'web');
    expect(backend.opens[0].process.killed).toBe(true);
    expect(routes.lookup(hostname)).toBeNull();

    const last = sent.findLast((p) => p.kind === 'script.status');
    expect(last?.kind === 'script.status' && last.script.lifecycle).toBe('stopped');
    expect(last?.kind === 'script.status' && last.script.exitCode).toBe(0);

    const listed = await service.list(cwd);
    expect(listed[0].lifecycle).toBe('stopped');
    expect(listed[0].terminalId).toBe(
      last?.kind === 'script.status' ? last.script.terminalId : null,
    );
  });

  it('records a synchronous exit as stopped and keeps its terminal replay attachable', async () => {
    const cwd = makeWorkspace({ scripts: { build: { command: 'printf done' } } });
    const { service, terminals, sent } = makeService(new SyncExitPtyBackend());

    await service.start(cwd, 'build');

    const [script] = await service.list(cwd);
    expect(script).toMatchObject({
      lifecycle: 'stopped',
      health: 'unknown',
      exitCode: 7,
      terminalId: expect.stringMatching(RE_TERMINAL_ID),
    });
    expect(() => service.stop(cwd, 'build')).toThrow('not running');
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
    terminals.closeAll();
  });

  it('rejects starting an unknown or already-running script', async () => {
    const cwd = makeWorkspace({ scripts: { web: { type: 'service', command: 'x', port: 4646 } } });
    const { service } = makeService();
    await expect(service.start(cwd, 'nope')).rejects.toThrow('not declared');
    await service.start(cwd, 'web');
    await expect(service.start(cwd, 'web')).rejects.toThrow('already running');
  });

  it('list keeps planned ports stable across calls', async () => {
    const cwd = makeWorkspace({ scripts: { api: { type: 'service', command: 'x' } } });
    const { service } = makeService();
    const [first] = await service.list(cwd);
    const [second] = await service.list(cwd);
    expect(first.port).toBeGreaterThan(0);
    expect(second.port).toBe(first.port);
    expect(first.localProxyUrl).toBe(`http://${first.hostname}:19523`);
  });
});
