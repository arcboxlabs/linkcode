/**
 * Live simulator panel — NOT a test. Boots an isolated daemon (with the linkcode-sim sidecar) and
 * the built desktop app, seeds a claim session, summons the Simulator section, and then holds the
 * window open so you can drive the real booted device by hand (tap, drag, pinch with ⌥, scroll,
 * type). Ctrl-C to tear it all down. Run: `pnpm -F @linkcode/desktop exec node e2e/simulator-live.mts`
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type { ElectronApplication } from 'playwright-core';
import { _electron } from 'playwright-core';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, '..');
const daemonDir = resolve(desktopDir, '../daemon');
const repoRoot = resolve(desktopDir, '../..');
const simSidecar = join(repoRoot, 'target', 'release', 'linkcode-sim');
const electronBinary = require('electron') as unknown as string;

const PORT = 43000 + (process.pid % 1000);
const WIRE_VERSION = 49;

async function waitForDaemon(): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/socket.io/?EIO=4&transport=polling`);
      return;
    } catch {
      await wait(250);
    }
  }
  throw new Error(`daemon did not come up on :${PORT}`);
}

function seedPiSession(cwd: string): Promise<string> {
  const socket = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('session.start timed out')), 60000);
    socket.on('frame', (raw: unknown) => {
      const reply = (raw as { payload?: Record<string, unknown> }).payload;
      if (reply?.replyTo !== 'live-session') return;
      clearTimeout(timer);
      if (reply.kind === 'session.started' && typeof reply.sessionId === 'string') {
        resolve(reply.sessionId);
      } else {
        reject(new Error(`session.start failed: ${JSON.stringify(reply)}`));
      }
    });
    socket.on('connect', () => {
      socket.emit('frame', {
        v: WIRE_VERSION,
        id: `live-${Date.now().toString(36)}`,
        ts: Date.now(),
        payload: { kind: 'session.start', clientReqId: 'live-session', opts: { kind: 'pi', cwd } },
      });
    });
    socket.on('connect_error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  }).finally(() => socket.close());
}

async function main(): Promise<void> {
  if (!existsSync(join(daemonDir, 'dist/index.js'))) throw new Error('build the daemon first');
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) throw new Error('build desktop first');
  if (!existsSync(simSidecar)) throw new Error('build target/release/linkcode-sim first');

  const home = mkdtempSync(join(tmpdir(), 'linkcode-live-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'linkcode-live-userdata-'));
  const chatRoot = join(home, 'LinkCode');
  mkdirSync(chatRoot, { recursive: true });
  const profile = `live-sim-${process.pid}`;
  const appSupport = join(
    process.env.HOME ?? home,
    'Library',
    'Application Support',
    `LinkCode Development (${profile})`,
  );
  mkdirSync(appSupport, { recursive: true });
  writeFileSync(
    join(appSupport, 'settings.json'),
    `${JSON.stringify({ locale: 'en', historyImportOnboardingHandled: true }, null, 2)}\n`,
  );

  let daemon: ChildProcess | null = null;
  let app: ElectronApplication | null = null;
  const teardown = (): void => {
    void app?.close().catch(noop);
    daemon?.kill('SIGTERM');
  };
  process.on('SIGINT', () => {
    teardown();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    teardown();
    process.exit(0);
  });

  daemon = spawn(process.execPath, ['dist/index.js'], {
    cwd: daemonDir,
    env: {
      ...process.env,
      HOME: home,
      LINKCODE_PORT: String(PORT),
      LINKCODE_PROFILE: profile,
      LINKCODE_SIM_SIDECAR_PATH: simSidecar,
    },
    stdio: 'ignore',
  });
  await waitForDaemon();
  console.log(`daemon up on :${PORT}`);

  const sessionId = await seedPiSession(chatRoot);
  console.log(`seeded claim session ${sessionId}`);

  app = await _electron.launch({
    executablePath: electronBinary,
    args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
    env: { ...process.env, HOME: home, LINKCODE_PROFILE: profile },
  });
  const win = await app.firstWindow();
  await win
    .locator('button[aria-label="Toggle side panel"]:visible')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
  await win.waitForTimeout(2000);

  // Open the right panel, summon the Simulator section, activate the seeded thread.
  const toggle = win.locator('button[aria-label="Toggle side panel"]:visible').first();
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click();
    await win.waitForTimeout(1200);
  }
  const plus = win.locator('button[aria-label="Open window"]:visible');
  for (const candidate of await plus.all()) {
    try {
      await candidate.click({ timeout: 2000 });
      break;
    } catch {
      // try the next matching + trigger
    }
  }
  await win.getByRole('menuitem', { name: 'Simulator' }).click().catch(noop);
  await win.waitForTimeout(1000);
  const row = win.getByText(/ in LinkCode$/).first();
  await row.waitFor({ state: 'visible', timeout: 15000 }).catch(noop);
  await row.click().catch(noop);

  console.log('\n─────────────────────────────────────────────');
  console.log('Live simulator panel is up. In the window:');
  console.log('  • tap / long-press / drag — single finger');
  console.log('  • ⌥ (Option) + drag — pinch to zoom');
  console.log('  • scroll — trackpad/wheel');
  console.log('  • click the screen, then type — English keys + IME (中文/emoji via paste)');
  console.log('Ctrl-C here to shut it all down.');
  console.log('─────────────────────────────────────────────\n');

  // Hold forever; the SIGINT/SIGTERM handlers tear everything down.
  await new Promise<never>(noop);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
