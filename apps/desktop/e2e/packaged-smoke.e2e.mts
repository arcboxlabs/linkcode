/**
 * Unsigned dev-shell acceptance boundary: launches the electron-builder directory product and
 * proves its sandbox preload, packaged daemon supervisor, native database, and staged PTY work.
 * This deliberately uses no agent or network service. `e2e:packaged` builds the product first;
 * `e2e:packaged:smoke` rechecks an already-built product.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ValidatedWireMessage } from '@linkcode/schema';
import { createWireMessage, SocketIoTransport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { waitFor } from 'foxts/wait-for';
import type { ElectronApplication } from 'playwright-core';
import { _electron } from 'playwright-core';

const desktopDir = resolve(import.meta.dirname, '..');
const executable = join(
  desktopDir,
  'release',
  process.platform === 'linux' ? 'linux-unpacked' : 'unsupported-platform',
  'linkcode',
);
const MARKER = `packaged-pty-${process.pid}`;
const VERSION_RE = /^\d+\.\d+\.\d+/;

interface RuntimeInfo {
  name: string;
  pid: number;
  profile?: string;
  listeners: Array<{ type: string; url: string }>;
}

async function main(): Promise<void> {
  assert.equal(process.platform, 'linux', 'packaged dev-shell smoke is a Linux CI boundary');
  assert(existsSync(executable), `packaged executable is missing: ${executable}`);

  const root = mkdtempSync(join(tmpdir(), 'linkcode-packaged-e2e-'));
  const home = join(root, 'home');
  const config = join(root, 'config');
  const profile = `packaged-smoke-${process.pid}`;
  const stateDir = join(home, `.linkcode-${profile}`);
  const runtimePath = join(stateDir, 'runtime.json');
  mkdirSync(home);
  mkdirSync(config);
  let app: ElectronApplication | null = null;
  let transport: SocketIoTransport | null = null;

  try {
    app = await _electron.launch({
      executablePath: executable,
      args: ['--use-mock-keychain'],
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: config,
        LINKCODE_PROFILE: profile,
      },
    });
    const page = await app.firstWindow();
    await page.locator('body').waitFor({ state: 'visible', timeout: 30000 });

    const bridge = await page.evaluate(async () => {
      const system = window.linkcodeSystem;
      return {
        platform: system.app.platform,
        version: await system.app.version(),
        settings: system.settings.snapshot(),
        managed: await system.daemon.isManaged(),
        maximized: await system.window.isMaximized(),
      };
    });
    assert.equal(bridge.platform, 'linux');
    assert.match(bridge.version, VERSION_RE);
    assert.equal(bridge.settings.daemonUrl, null);
    assert.equal(bridge.managed, true);
    assert.equal(typeof bridge.maximized, 'boolean');

    // This surface mounts only below the Workbench connection gate. Bridge and external transport
    // checks alone would not catch a renderer that failed to discover or dial the packaged daemon.
    await page.getByRole('heading', { name: 'What should we build?' }).waitFor({ timeout: 30000 });

    const runtime = await waitFor(
      () => {
        if (!existsSync(runtimePath)) return false;
        try {
          return JSON.parse(readFileSync(runtimePath, 'utf8')) as RuntimeInfo;
        } catch {
          return false;
        }
      },
      100,
      AbortSignal.timeout(30000),
    );
    assert.equal(runtime.name, 'linkcode-daemon');
    assert.equal(runtime.profile, profile);
    assert.notEqual(runtime.pid, process.pid);
    assert.equal(linuxParentPid(runtime.pid), app.process().pid);
    const listener = runtime.listeners.find(({ type }) => type === 'socket.io');
    assert(listener, 'packaged daemon did not advertise its Socket.IO listener');
    await page.waitForFunction(
      (url) => window.linkcodeSystem.daemon.resolveUrl() === url,
      listener.url,
      { timeout: 10000 },
    );

    const identity = (await fetch(`${listener.url}/linkcode`).then((response) => {
      assert(response.ok, `daemon identity returned HTTP ${response.status}`);
      return response.json();
    })) as { name: string; pid: number; profile?: string; startedAt?: number };
    assert.equal(identity.name, 'linkcode-daemon');
    assert.equal(identity.pid, runtime.pid);
    assert.equal(identity.profile, profile);
    assert(identity.startedAt && identity.startedAt > 0);

    transport = new SocketIoTransport({ url: listener.url });
    await transport.connect();
    await verifyWorkspaceStore(transport);
    await verifyTerminal(transport);

    await Promise.resolve(transport.close());
    transport = null;
    await app.close();
    app = null;
    await waitFor(() => !existsSync(`/proc/${runtime.pid}`), 100, AbortSignal.timeout(10000));
    assert.equal(existsSync(runtimePath), false, 'packaged daemon runtime survived app shutdown');

    console.log(
      'PASS packaged renderer connection, preload, bundled daemon, SQLite, PTY, and shutdown',
    );
  } finally {
    if (transport) await Promise.resolve(transport.close());
    await app?.close().catch(noop);
    await wait(500);
    rmSync(root, { recursive: true, force: true });
  }
}

async function verifyWorkspaceStore(transport: SocketIoTransport): Promise<void> {
  const clientReqId = randomUUID();
  const listed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('packaged workspace list timed out')), 10000);
    transport.onMessage((message: ValidatedWireMessage) => {
      const payload = message.payload;
      if (payload.kind === 'request.failed' && payload.replyTo === clientReqId) {
        clearTimeout(timeout);
        reject(new Error(`packaged workspace list failed: ${payload.message}`));
        return;
      }
      if (payload.kind !== 'workspace.listed' || payload.replyTo !== clientReqId) return;
      clearTimeout(timeout);
      assert(
        payload.workspaces.some(({ kind }) => kind === 'chat'),
        'chat workspace was not migrated',
      );
      resolve();
    });
  });
  transport.send(createWireMessage({ kind: 'workspace.list', clientReqId }));
  await listed;
}

async function verifyTerminal(transport: SocketIoTransport): Promise<void> {
  const clientReqId = randomUUID();
  const credentials = { attachmentId: randomUUID(), attachmentSecret: randomUUID() };
  let terminalId = '';
  let output = '';
  const observed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('packaged PTY echo timed out')), 10000);
    transport.onMessage((message: ValidatedWireMessage) => {
      const payload = message.payload;
      if (payload.kind === 'request.failed' && payload.replyTo === clientReqId) {
        clearTimeout(timeout);
        reject(new Error(`packaged PTY open failed: ${payload.message}`));
        return;
      }
      if (payload.kind === 'terminal.opened' && payload.replyTo === clientReqId) {
        terminalId = payload.terminal.terminalId;
        transport.send(
          createWireMessage({
            kind: 'terminal.input',
            terminalId,
            data: `printf '${MARKER}\\n'\n`,
            ...credentials,
          }),
        );
      }
      if (payload.kind !== 'terminal.output' || payload.terminalId !== terminalId) return;
      output += payload.data;
      transport.send(
        createWireMessage({
          kind: 'terminal.ack',
          terminalId,
          acked: output.length,
          ...credentials,
        }),
      );
      if (!output.includes(MARKER)) return;
      clearTimeout(timeout);
      resolve();
    });
  });
  transport.send(
    createWireMessage({
      kind: 'terminal.open',
      clientReqId,
      opts: { cols: 80, rows: 24, shell: '/bin/sh' },
      ...credentials,
    }),
  );
  await observed;
  transport.send(createWireMessage({ kind: 'terminal.close', terminalId, ...credentials }));
}

function linuxParentPid(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return Number(afterName[1]);
}

void main();
