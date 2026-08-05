/**
 * Unsigned dev-shell acceptance boundary: launches the electron-builder directory product and
 * proves its sandbox preload, packaged daemon supervisor, native database, and staged PTY work.
 * This deliberately uses no agent or network service. `e2e:packaged` builds the product first;
 * `e2e:packaged:smoke` rechecks an already-built product.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { extractFile } from '@electron/asar';
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

/** Staging proof (CODE-552): when the build rendered a config bundle, the packaged asar must
 * carry the byte-identical copy under out/config; without one, nothing may be staged. Returns the
 * bundled default values the packaged main must serve, or null for the sentinel build. */
function verifyPackagedConfigStaging(): Record<string, unknown> | null {
  const asarPath = join(desktopDir, 'release/linux-unpacked/resources/app.asar');
  assert(existsSync(asarPath), `packaged asar is missing: ${asarPath}`);
  const generatedPath = join(desktopDir, 'generated/config-build-bundle.json');
  let staged: Buffer | null;
  try {
    staged = extractFile(asarPath, 'out/config/build-bundle.json');
  } catch {
    staged = null;
  }
  if (!existsSync(generatedPath)) {
    assert.equal(staged, null, 'packaged asar staged a config bundle no render produced');
    return null;
  }
  const generated = readFileSync(generatedPath);
  assert(staged, 'rendered config bundle was not staged into the packaged asar');
  assert(staged.equals(generated), 'packaged config bundle differs from the rendered bundle');
  const bundle = JSON.parse(generated.toString('utf8')) as { snapshot: { base64Url: string } };
  const snapshot = JSON.parse(
    Buffer.from(bundle.snapshot.base64Url, 'base64url').toString('utf8'),
  ) as { values: Record<string, unknown> };
  console.log('PASS packaged asar carries the byte-identical rendered config bundle');
  return snapshot.values;
}

async function main(): Promise<void> {
  assert.equal(process.platform, 'linux', 'packaged dev-shell smoke is a Linux CI boundary');
  assert(existsSync(executable), `packaged executable is missing: ${executable}`);
  const expectedBundledValues = verifyPackagedConfigStaging();

  const root = mkdtempSync(join(tmpdir(), 'linkcode-packaged-e2e-'));
  const home = join(root, 'home');
  const config = join(root, 'config');
  const profile = `packaged-smoke-${process.pid}`;
  // The devshell pack is the development channel, and its supervisor injects that into the daemon
  // it spawns — so the state dir is the development sibling, profile-suffixed (CODE-460). Asserting
  // the plain `.linkcode-<profile>` here would prove the channel injection had been lost.
  const stateDir = join(home, `.linkcode.development-${profile}`);
  const runtimePath = join(stateDir, 'runtime.json');
  mkdirSync(home);
  mkdirSync(config);
  // A packaged (release-shaped) product must ignore the development-only local override file and
  // any runtime bootstrap variable — both are planted here and asserted inert below (CODE-552).
  const overrideDir = join(config, 'LinkCode Development', 'config');
  mkdirSync(overrideDir, { recursive: true });
  writeFileSync(
    join(overrideDir, 'override.json'),
    '{"app.displayName":"LOCAL-OVERRIDE-MUST-BE-IGNORED"}',
  );
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
        MAIN_VITE_CONFIG_BOOTSTRAP: '{"defaults":{"app.displayName":"RUNTIME-OVERRIDE"}}',
      },
    });
    const page = await app.firstWindow();
    await page.locator('body').waitFor({ state: 'visible', timeout: 30000 });

    const bridge = await page.evaluate(async () => {
      const system = window.linkcodeSystem;
      return {
        configSnapshot: window.linkcodeConfig.effectiveSnapshot(),
        configSource: window.linkcodeConfig.snapshotInfo().source,
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
    // Packaged runs must serve exactly the build-time bundle (or the empty sentinel): the planted
    // override.json and runtime MAIN_VITE_CONFIG_BOOTSTRAP above must both be ignored.
    assert.deepEqual(bridge.configSnapshot, expectedBundledValues ?? {});
    assert.equal(bridge.configSource, 'bundled');
    console.log('PASS packaged config ignores local override and runtime bootstrap variable');

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
