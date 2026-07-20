/**
 * OS-notification E2E (CODE-116): boots an isolated daemon + the built desktop app, drives a real
 * pi session, and asserts the whole notify chain from daemon broadcast through main-process
 * `Notification` to click-through. Run `pnpm -F @linkcode/desktop e2e:notifications` after building
 * daemon and desktop; needs the `pi` CLI on PATH. Not part of `pnpm test` (needs a display and real
 * processes); `Notification.prototype.show` is stubbed in main to keep the notification center quiet.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type { ElectronApplication, Page } from 'playwright-core';
import { _electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, '..');
const daemonDir = resolve(desktopDir, '../daemon');
// `require('electron')` resolves to the packaged binary path, not a JS module.
const electronBinary = require('electron') as unknown as string;

const PROMPT = 'Reply with one short sentence about ping pong.';
const PORT = 42000 + (process.pid % 1000);

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

interface CapturedNotification {
  title: string;
  body: string;
}

async function pollNotifications(
  app: ElectronApplication,
  timeoutMs: number,
): Promise<CapturedNotification[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const notifs = await app.evaluate(() =>
      (globalThis as { __notifs?: CapturedNotification[] }).__notifs!.map((n) => ({
        title: n.title,
        body: n.body,
      })),
    );
    if (notifs.length > 0) return notifs;
    await wait(1000);
  }
  return [];
}

async function run(app: ElectronApplication, win: Page): Promise<void> {
  const composer = win.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 30000 });
  await win.waitForTimeout(2000);

  // Switch the new-session provider to pi (auth-free) via the composer's model-selector menu.
  await win.getByRole('button', { name: /Default/ }).click();
  await win.getByRole('menuitem', { name: 'Claude Code' }).click();
  // The AgentIcon initials fallback makes the item's accessible name "PIPi".
  await win.getByRole('menuitemradio', { name: /Pi$/ }).click();
  await win.waitForTimeout(500);

  // Blur the window: an unfocused window must be notified even for the active session, which
  // also makes the assertion independent of how fast the turn completes.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
  await win.waitForTimeout(300);

  await composer.fill(PROMPT);
  await win.getByRole('button', { name: 'Send' }).click();
  console.log('prompt sent to a pi session');

  const notifs = await pollNotifications(app, 90000);
  console.log('captured notifications:', JSON.stringify(notifs));
  if (notifs.length === 0) fail('no OS notification captured within 90s');

  // Open the new-session draft so click-through has real work to do: it must exit the draft,
  // focus the window, and select the notifying session.
  await win.getByRole('button', { name: 'New Task' }).click();
  await win.waitForTimeout(800);
  await app.evaluate(() => {
    (globalThis as { __notifs?: Array<{ emit: (event: string) => void }> }).__notifs![0].emit(
      'click',
    );
  });
  await win.waitForTimeout(1500);

  const bodyText = await win.evaluate(() => document.body.innerText);
  const draftGone = !bodyText.includes('What should we build?');
  const onSession = bodyText.includes('ping pong');
  const focused = await win.evaluate(() => document.hasFocus());
  console.log({ draftGone, onSession, focusedAfterClick: focused });
  if (!draftGone || !onSession) fail('click-through did not land on the notifying session');
  if (!focused) fail('notification click did not focus the app window');
}

async function main(): Promise<void> {
  if (!existsSync(join(daemonDir, 'dist/index.js'))) {
    fail('apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first');
  }
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) {
    fail('apps/desktop/out is missing — run `pnpm -F @linkcode/desktop build` first');
  }

  // Fresh fake HOME per run isolates the daemon and app from the developer's real instances; a
  // reused HOME carries an old daemon DB and leaves the composer disabled (docs/DEVELOPMENT.md).
  const home = mkdtempSync(join(tmpdir(), 'linkcode-e2e-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'linkcode-e2e-userdata-'));

  let daemon: ChildProcess | null = null;
  let app: ElectronApplication | null = null;
  let passed = false;
  try {
    daemon = spawn(process.execPath, ['dist/index.js'], {
      cwd: daemonDir,
      env: { ...process.env, HOME: home, LINKCODE_PORT: String(PORT) },
      stdio: 'ignore',
    });
    await waitForDaemon();
    console.log(`daemon up on :${PORT} (HOME=${home})`);

    app = await _electron.launch({
      executablePath: electronBinary,
      // --use-mock-keychain: a fake HOME has no login keychain; without it macOS pops a blocking
      // "Keychain Not Found / reset" dialog on the developer's screen at every launch.
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      env: { ...process.env, HOME: home },
    });
    // Capture every OS notification main creates, before any can fire. The stub keeps the real
    // banner from posting; the captured instance still exposes `title`/`body` and `emit('click')`.
    await app.evaluate(({ Notification }) => {
      (globalThis as { __notifs?: unknown[] }).__notifs = [];
      Notification.prototype.show = function (this: unknown) {
        (globalThis as { __notifs?: unknown[] }).__notifs!.push(this);
      };
    });

    await run(app, await app.firstWindow());
    passed = true;
    console.log('PASS');
  } finally {
    await app?.close().catch(noop);
    daemon?.kill('SIGTERM');
    if (passed) {
      rmSync(home, { recursive: true, force: true });
      rmSync(userData, { recursive: true, force: true });
    } else {
      console.error(`kept for debugging: HOME=${home} userData=${userData}`);
      process.exitCode = 1;
    }
  }
}

void main();
