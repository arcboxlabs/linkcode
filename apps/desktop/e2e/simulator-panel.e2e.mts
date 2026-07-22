/**
 * Simulator-panel E2E (CODE-397): boots an isolated daemon (with the linkcode-sim sidecar) + the
 * built desktop app, summons the on-demand Simulator section from the right panel's + menu, and
 * asserts the device picker reflects the host's real device list. When a booted simulator exists,
 * it also starts a pi session and asserts live frames paint the canvas end-to-end. Run
 * `pnpm -F @linkcode/desktop e2e:simulator` after building daemon and desktop; macOS only.
 */

import type { ChildProcess } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type { ElectronApplication, Page } from 'playwright-core';
import { _electron } from 'playwright-core';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, '..');
const daemonDir = resolve(desktopDir, '../daemon');
const repoRoot = resolve(desktopDir, '../..');
const simSidecar = join(repoRoot, 'target', 'release', 'linkcode-sim');
const electronBinary = require('electron') as unknown as string;

const PORT = 43000 + (process.pid % 1000);

/** Must match `WIRE_PROTOCOL_VERSION` (node can't load the raw-TS schema barrel); a mismatch is
 * silently discarded by the daemon, surfacing here as the session.start timeout. */
const WIRE_VERSION = 45;

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

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
  fail(`daemon did not come up on port ${PORT}`);
}

function bootedDeviceCount(): number {
  try {
    const raw = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(raw) as { devices: Record<string, unknown[]> };
    return Object.values(parsed.devices).reduce((sum, list) => sum + list.length, 0);
  } catch {
    return 0;
  }
}

function piOnPath(): boolean {
  try {
    execFileSync('which', ['pi'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Seed the stream-claim session over the wire: the panel binds to the active thread. */
function seedPiSession(cwd: string): Promise<string> {
  const socket = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  return new Promise<string>((_resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('session.start timed out (stale WIRE_VERSION pin?)'));
    }, 60000);
    socket.on('frame', (raw: unknown) => {
      const payload = (raw as { payload?: Record<string, unknown> }).payload;
      if (payload?.replyTo !== 'e2e-session') return;
      clearTimeout(timer);
      if (payload.kind === 'session.started' && typeof payload.sessionId === 'string') {
        _resolve(payload.sessionId);
      } else {
        reject(new Error(`session.start failed: ${JSON.stringify(payload)}`));
      }
    });
    socket.on('connect', () => {
      socket.emit('frame', {
        v: WIRE_VERSION,
        id: `e2e-${Date.now().toString(36)}`,
        ts: Date.now(),
        payload: {
          kind: 'session.start',
          clientReqId: 'e2e-session',
          opts: { kind: 'pi', cwd },
        },
      });
    });
    socket.on('connect_error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  }).finally(() => socket.close());
}

async function run(win: Page, chatRoot: string, deepPass: boolean): Promise<void> {
  await win
    .locator('button[aria-label="Toggle side panel"]:visible')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });
  await win.waitForTimeout(2000);

  // The right panel starts closed on a fresh profile, leaving its chrome strip hit-testing
  // behind the main pane. Toggle it open until the + trigger is actually clickable (a trial
  // click probes actionability without clicking) — the open animation makes one wait racy.
  const toggle = win.locator('button[aria-label="Toggle side panel"]:visible').first();
  const plus = win.locator('button[aria-label="Open window"]:visible');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click();
    await win.waitForTimeout(600);
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      fail('the right panel did not open from its chrome toggle');
    }
  }
  // Both panels label their + "Open window" and locator order is not stable, so probe every
  // match with a trial click and keep the one that is actually actionable.
  let plusTarget = null as Awaited<ReturnType<typeof plus.all>>[number] | null;
  const plusDeadline = Date.now() + 15000;
  while (plusTarget === null && Date.now() < plusDeadline) {
    for (const candidate of await plus.all()) {
      try {
        await candidate.click({ trial: true, timeout: 1000 });
        plusTarget = candidate;
        break;
      } catch {
        // Covered instance (collapsed panel); try the next match.
      }
    }
    if (plusTarget === null) await wait(500);
  }
  if (plusTarget === null) {
    const shot = join(tmpdir(), `linkcode-e2e-simulator-plus-${process.pid}.png`);
    await win.screenshot({ path: shot });
    console.error(`screenshot: ${shot}`);
    console.error(`toggle aria-pressed: ${await toggle.getAttribute('aria-pressed')}`);
    for (const candidate of await plus.all()) {
      console.error(`plus box: ${JSON.stringify(await candidate.boundingBox())}`);
    }
    fail('the section strip + trigger never became clickable');
  }

  const plusBefore = await plus.count();
  await plusTarget.click();
  await win.getByRole('menuitem', { name: 'Simulator' }).click();
  await win.waitForTimeout(2000);

  const sectionTab = win.locator('button[aria-label="Simulator"][aria-pressed="true"]:visible');
  if ((await sectionTab.count()) === 0) fail('adding Simulator did not activate its section tab');
  console.log('simulator section summoned and active');

  // The right panel's + trigger disappears once the only optional section is added.
  const plusAfter = await win.locator('button[aria-label="Open window"]:visible').count();
  if (plusAfter !== plusBefore - 1) {
    fail('the section strip + menu should hide while every optional section is added');
  }

  // The panel body must reflect the daemon's real device probe.
  const picker = win.locator('[aria-label="Select a device"]');
  const noDevices = win.getByText('No simulator devices found');
  const deadline = Date.now() + 15000;
  let bodyReady = false;
  while (Date.now() < deadline) {
    if ((await picker.count()) > 0 || (await noDevices.count()) > 0) {
      bodyReady = true;
      break;
    }
    await wait(500);
  }
  if (!bodyReady) fail('the panel showed neither a device picker nor the empty-list hint');
  if ((await picker.count()) > 0) {
    console.log(`device picker: ${JSON.stringify(await picker.first().textContent())}`);
  } else {
    console.log('daemon reported no simulator devices');
  }

  const summonShot = join(tmpdir(), `linkcode-e2e-simulator-summon-${process.pid}.png`);
  await win.screenshot({ path: summonShot });
  console.log(`screenshot: ${summonShot}`);

  if (deepPass && (await picker.count()) > 0) {
    // Deep pass: with a session claim the booted device streams; frames must paint the canvas.
    const sessionId = await seedPiSession(chatRoot);
    console.log(`pi session seeded for the stream claim: ${sessionId}`);
    // The wire-seeded session came from another connection; reload so the fresh session.list
    // includes it. This doubles as the persisted-panel restore check: the Simulator section
    // must come back open after the reload (shell-state v3).
    await win.reload();
    await win
      .locator('button[aria-label="Toggle side panel"]:visible')
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
    await win.waitForTimeout(2000);
    if ((await sectionTab.count()) === 0) {
      fail('the Simulator section did not restore from persisted shell state after reload');
    }
    // The untitled row reads "<agent> in <repository>"; clicking it makes the thread active.
    const row = win.getByText(/ in LinkCode$/).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.click();
    await win.waitForTimeout(1500);

    const canvas = win.locator('canvas:visible');
    const frameDeadline = Date.now() + 30000;
    let painted: { width: number; height: number } | null = null;
    while (Date.now() < frameDeadline) {
      if ((await canvas.count()) > 0) {
        const size = await canvas.first().evaluate((el) => {
          const c = el as HTMLCanvasElement;
          return { width: c.width, height: c.height };
        });
        if (size.width > 0 && size.height > 0) {
          painted = size;
          break;
        }
      }
      await wait(500);
    }
    if (!painted) fail('no frame painted the simulator canvas within 30s');
    console.log(`canvas painted at ${painted.width}x${painted.height}`);

    const streamShot = join(tmpdir(), `linkcode-e2e-simulator-stream-${process.pid}.png`);
    await win.screenshot({ path: streamShot });
    console.log(`screenshot: ${streamShot}`);
  } else {
    console.log('no booted simulator — skipping the live-stream pass');
  }

  // Closing the section removes it from the strip and falls back to the default section.
  await win.locator('button[aria-label="Close Simulator"]:visible').first().click();
  await win.waitForTimeout(1000);
  if ((await win.locator('button[aria-label="Simulator"]:visible').count()) !== 0) {
    fail('closing the Simulator section did not remove its tab');
  }
  if ((await win.locator('button[aria-label="Open window"]:visible').count()) !== plusBefore) {
    fail('the + menu did not return after removing the section');
  }
  console.log('simulator section closed; + menu restored');
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') fail('simulator E2E is macOS-only');
  if (!existsSync(join(daemonDir, 'dist/index.js'))) {
    fail('apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first');
  }
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) {
    fail('apps/desktop/out is missing — run `pnpm -F @linkcode/desktop build` first');
  }
  if (!existsSync(simSidecar)) {
    fail('target/release/linkcode-sim is missing — run `cargo build --release -p linkcode-sim`');
  }

  const home = mkdtempSync(join(tmpdir(), 'linkcode-e2e-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'linkcode-e2e-userdata-'));
  const chatRoot = join(home, 'LinkCode');
  mkdirSync(chatRoot, { recursive: true });
  // A fake $HOME cannot move Electron's appData on macOS, so localStorage (the persisted shell
  // state) would leak across runs through the real ~/Library. A per-run profile isolates the
  // app-name universe instead — the daemon must carry the SAME profile to be discovered.
  const profile = `e2e-sim-${process.pid}`;
  const appSupport = join(
    process.env.HOME ?? home,
    'Library',
    'Application Support',
    `LinkCode Development (${profile})`,
  );
  // Locale-stable text locators + no first-install import prompt over the shell.
  mkdirSync(appSupport, { recursive: true });
  writeFileSync(
    join(appSupport, 'settings.json'),
    `${JSON.stringify({ locale: 'en', historyImportOnboardingHandled: true }, null, 2)}\n`,
  );
  const deepPass = bootedDeviceCount() > 0 && piOnPath();
  console.log(`live-stream pass (booted device + pi CLI): ${deepPass ? 'yes' : 'no'}`);

  let daemon: ChildProcess | null = null;
  let app: ElectronApplication | null = null;
  let passed = false;
  try {
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
    console.log(`daemon up on :${PORT} (HOME=${home})`);

    app = await _electron.launch({
      executablePath: electronBinary,
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      env: { ...process.env, HOME: home, LINKCODE_PROFILE: profile },
    });

    const win = await app.firstWindow();
    try {
      await run(win, chatRoot, deepPass);
    } catch (error) {
      const shot = join(tmpdir(), `linkcode-e2e-simulator-${process.pid}.png`);
      await win.screenshot({ path: shot }).catch(noop);
      console.error(`screenshot: ${shot}`);
      throw error;
    }
    passed = true;
    console.log('PASS');
  } finally {
    await app?.close().catch(noop);
    daemon?.kill('SIGTERM');
    if (passed) {
      rmSync(home, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
      rmSync(appSupport, { recursive: true, force: true });
    } else {
      console.error(`kept for debugging: HOME=${home} userData=${userData} appData=${appSupport}`);
      process.exitCode = 1;
    }
  }
}

void main();
