import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LinkCodeClient } from '@linkcode/client-core';
import { SocketIoTransport } from '@linkcode/transport';
import { wait } from 'foxts/wait';
import { waitFor } from 'foxts/wait-for';

const daemonDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(daemonDir, '..', '..');
const marketplaceScript = join(repoRoot, 'scripts', 'dev-marketplace.mts');
const fixtureIndex = join(repoRoot, 'node_modules', '.cache', 'dev-marketplace', 'index.json');

const MARKETPLACE_ID = 'linkcode-official';
const PLUGIN_ID = 'linkcode/echo';
const PLUGIN_VERSION = '0.1.0';
const SECRET_TOKEN = 'e2e-secret-token';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function main(): Promise<void> {
  assert(
    existsSync(join(daemonDir, 'dist/index.js')),
    'daemon dist is missing; run its build first',
  );
  assert(
    existsSync(fixtureIndex),
    'dev marketplace fixture is missing; run: node scripts/dev-marketplace.mts --build',
  );

  const home = mkdtempSync(join(tmpdir(), 'linkcode-marketplace-e2e-'));
  const daemonPort = await freePort();
  const marketPort = await freePort();
  const logs: string[] = [];

  const marketplace = spawn(process.execPath, [marketplaceScript], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, DEV_MARKETPLACE_PORT: String(marketPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  marketplace.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  marketplace.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));

  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const child = spawn(process.execPath, ['--import', './dist/instrument.js', 'dist/index.js'], {
    cwd: daemonDir,
    env: {
      ...process.env,
      HOME: home,
      LINKCODE_HOST: '127.0.0.1',
      LINKCODE_PORT: String(daemonPort),
      LINKCODE_MARKETPLACE_URL: `http://127.0.0.1:${marketPort}/index.json`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => logs.push(chunk.toString()));
  child.once('exit', (code, signal) => {
    exit = { code, signal };
  });

  let client: LinkCodeClient | null = null;
  try {
    // The tsup bundle is stamped `release`, so state lands in `.linkcode`, not `.linkcode.development`.
    const runtimePath = join(home, '.linkcode', 'runtime.json');
    const runtime = await waitFor(
      () => {
        if (exit) throw new Error(`daemon exited during boot: ${JSON.stringify(exit)}`);
        if (!existsSync(runtimePath)) return false;
        try {
          return JSON.parse(readFileSync(runtimePath, 'utf8')) as {
            pid: number;
            listeners: Array<{ type: string; url: string }>;
          };
        } catch {
          return false;
        }
      },
      100,
      AbortSignal.timeout(30000),
    );
    assert.equal(runtime.pid, child.pid);
    const listener = runtime.listeners.find((entry) => entry.type === 'socket.io');
    assert(listener, 'runtime.json has no socket.io listener');

    client = new LinkCodeClient(new SocketIoTransport({ url: listener.url }), { randomUUID });
    await client.connect();

    // 1. The env override retargets the built-in official marketplace at the loopback fixture.
    const marketplaces = await client.listPluginMarketplaces();
    const official = marketplaces.find((entry) => entry.id === MARKETPLACE_ID);
    assert(official, 'official marketplace missing from list');
    assert.equal(official.source.url, `http://127.0.0.1:${marketPort}/index.json`);

    // 2. Refresh pulls the catalog; a second refresh rides the ETag to a 304.
    const first = await client.refreshPluginMarketplace(MARKETPLACE_ID);
    assert(
      first.releases.some(
        (entry) =>
          entry.pluginId === PLUGIN_ID && entry.release.manifest.version === PLUGIN_VERSION,
      ),
      'catalog does not list linkcode/echo',
    );
    const second = await client.refreshPluginMarketplace(MARKETPLACE_ID);
    assert.equal(second.notModified, true, 'second refresh did not hit the ETag cache');
    assert(
      second.releases.some(
        (entry) =>
          entry.pluginId === PLUGIN_ID && entry.release.manifest.version === PLUGIN_VERSION,
      ),
      '304 refresh cleared the cached catalog',
    );

    // 3. Install from the cached catalog; the package lands in the Store.
    const installed = await client.installLinkCodePlugin({
      marketplaceId: MARKETPLACE_ID,
      pluginId: PLUGIN_ID,
      version: PLUGIN_VERSION,
    });
    assert.equal(installed.pluginId, PLUGIN_ID);
    const packageDir = join(home, '.linkcode', 'plugins', 'linkcode', 'echo', PLUGIN_VERSION);
    assert(existsSync(join(packageDir, 'manifest.json')), 'installed manifest.json missing');
    assert(existsSync(join(packageDir, 'dist', 'index.js')), 'installed dist/index.js missing');

    // 4. Settings: masked read shows the schema, set splits secret vs non-secret.
    const before = await client.listLinkCodePluginConfigs();
    const view = before.find((entry) => entry.id === PLUGIN_ID);
    assert(view, 'installed plugin missing from plugin-config.list');
    assert(view.settings.token?.secret, 'token must be a secret field');
    assert.equal(view.values.token, undefined, 'secret value leaked in masked read');

    await client.setLinkCodePluginConfig({
      pluginId: PLUGIN_ID,
      set: { greeting: '你好', token: SECRET_TOKEN, mode: 'shout' },
    });
    const configFile = JSON.parse(readFileSync(join(home, '.linkcode', 'config.json'), 'utf8')) as {
      pluginConfigs?: Record<string, Record<string, unknown>>;
    };
    assert.equal(configFile.pluginConfigs?.[PLUGIN_ID]?.greeting, '你好');
    assert.equal(configFile.pluginConfigs?.[PLUGIN_ID]?.mode, 'shout');
    assert(!('token' in (configFile.pluginConfigs?.[PLUGIN_ID] ?? {})), 'secret in config.json');
    const secretsFile = JSON.parse(
      readFileSync(join(home, '.linkcode', 'secrets.json'), 'utf8'),
    ) as {
      protection: 'os-keyring' | 'plaintext';
    };
    // A fake HOME has no login keychain, so the vault degrades to plaintext on disk (with a boot
    // warning). Either way the token belongs in secrets.json — just never in config.json.
    const secretsRaw = readFileSync(join(home, '.linkcode', 'secrets.json'), 'utf8');
    if (secretsFile.protection === 'os-keyring') {
      assert(!secretsRaw.includes(SECRET_TOKEN), 'token stored in plaintext under os-keyring');
    } else {
      assert(secretsRaw.includes(SECRET_TOKEN), 'token missing from the vault');
    }

    const after = await client.listLinkCodePluginConfigs();
    const afterView = after.find((entry) => entry.id === PLUGIN_ID);
    assert.equal(afterView?.values.greeting, '你好');
    assert.equal(afterView?.values.token, undefined, 'secret value leaked after set');

    // 5. Uninstall removes the package and prunes its config.
    const removed = await client.uninstallLinkCodePlugin(PLUGIN_ID);
    assert.equal(removed, PLUGIN_ID);
    assert(!existsSync(packageDir), 'package dir survived uninstall');

    assert(child.kill('SIGTERM'), 'daemon rejected SIGTERM');
    const shutdown = await waitFor(() => exit ?? false, 50, AbortSignal.timeout(10000));
    assert.deepEqual(shutdown, { code: 0, signal: null });

    console.log('PASS marketplace refresh (ETag 304), install, settings vault split, uninstall');
  } catch (error) {
    console.error(logs.join('').slice(-8000));
    throw error;
  } finally {
    client?.dispose();
    await stop(child);
    await stop(marketplace);
    rmSync(home, { recursive: true, force: true });
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    }),
    wait(5000).then(() => child.kill('SIGKILL')),
  ]);
}

void main();
