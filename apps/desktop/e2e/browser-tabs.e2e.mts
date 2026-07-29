/**
 * Multi-tab Browser section E2E (CODE-266): boots an isolated daemon + the built desktop app,
 * opens the right panel's Browser section, and asserts the tab strip seeds an empty tab,
 * address-bar navigation retitles the tab, "New tab" adds an instance, a guest `target="_blank"`
 * popup lands in a new in-app tab, closing works, and tabs survive an app restart.
 * Run `pnpm -F @linkcode/desktop e2e:browser-tabs` after building daemon and desktop.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { falseFn, noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import type { ElectronApplication, Page } from 'playwright-core';
import { _electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, '..');
const daemonDir = resolve(desktopDir, '../daemon');
const electronBinary = require('electron') as unknown as string;

const PORT = 44000 + (process.pid % 1000);

/** Isolates userData + single-instance lock from any real install: `--user-data-dir` is
 * overridden by the app's identity resolution, so a dedicated profile is the only lever. */
const PROFILE = `e2e-browser-${process.pid}`;

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

function startPageServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/popup') {
      res.end('<html><head><title>E2E Popup Page</title></head><body>popup</body></html>');
      return;
    }
    res.end(
      '<html><head><title>E2E Page One</title></head><body>' +
        '<a id="pop" href="/popup" target="_blank">open popup</a></body></html>',
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') fail('page server has no port');
      resolve({ server, port: address.port });
    });
  });
}

async function waitForTab(win: Page, name: string): Promise<void> {
  const button = win.getByRole('button', { name, exact: true });
  await button.waitFor({ state: 'visible', timeout: 15000 });
}

async function waitForMainWindow(app: ElectronApplication): Promise<Page> {
  await app.firstWindow();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const main = app.windows().find((page) => page.url().endsWith('/out/renderer/index.html'));
    if (main !== undefined) return main;
    await wait(50);
  }
  return fail('desktop main window did not appear');
}

function logPageErrors(page: Page): void {
  page.on('pageerror', (error) => console.error('renderer page error:', error));
  page.on('crash', () => console.error('renderer page crashed:', page.url()));
}

function watchAppErrors(app: ElectronApplication): void {
  for (const page of app.windows()) logPageErrors(page);
  app.on('window', logPageErrors);
}

async function sendGuestShortcut(
  app: ElectronApplication,
  urlPrefix: string,
  keyCode: string,
): Promise<void> {
  const sent = await app.evaluate(
    ({ webContents }, { prefix, key }) => {
      const guest = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(prefix));
      if (guest === undefined) return false;
      const modifiers: Electron.InputEvent['modifiers'] = [
        process.platform === 'darwin' ? 'meta' : 'control',
      ];
      guest.focus();
      guest.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
      guest.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
      return true;
    },
    { prefix: urlPrefix, key: keyCode },
  );
  if (!sent) fail(`no guest WebContents for ${urlPrefix}`);
}

async function run(win: Page, app: ElectronApplication, pagePort: number): Promise<void> {
  const composer = win.locator('[data-slot="composer-editor"][contenteditable="true"]');
  await composer.waitFor({ state: 'visible', timeout: 30000 });
  await win.waitForTimeout(1000);

  // Fresh profile: the right panel starts closed — open it, then switch to the Browser section.
  await win.getByRole('button', { name: 'Toggle side panel', exact: true }).click();
  await win.getByRole('button', { name: 'Browser', exact: true }).click();
  await win.waitForTimeout(500);

  // Entering the section seeds one empty tab with the index-derived label.
  await waitForTab(win, 'Browser 1');
  console.log('browser section seeded one empty tab');

  // Address-bar navigation: the loaded page's title becomes the tab label.
  const address = win.getByPlaceholder('Enter an address, or open a preview from Services');
  await address.fill(`http://127.0.0.1:${pagePort}/`);
  await address.press('Enter');
  await waitForTab(win, 'E2E Page One');
  console.log('navigation retitled the tab from the page title');

  // App-owned shortcuts must still work while the guest WebContents owns focus; guest key events
  // do not bubble to the renderer's keyboard registry.
  const guest = app.windows().find((page) => page.url().startsWith(`http://127.0.0.1:${pagePort}`));
  if (guest === undefined) fail('did not find the webview guest page');
  await guest.locator('body').click();
  await sendGuestShortcut(app, `http://127.0.0.1:${pagePort}`, 'f');
  await win.getByPlaceholder('Find…').waitFor({ state: 'visible' });
  await win.keyboard.press('Escape');
  await guest.locator('body').click();
  await sendGuestShortcut(app, `http://127.0.0.1:${pagePort}`, '=');
  await win.waitForTimeout(100);
  const zoomLevel = await app.evaluate(
    ({ webContents }, prefix) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(prefix))
        ?.getZoomLevel(),
    `http://127.0.0.1:${pagePort}`,
  );
  if (zoomLevel === undefined || zoomLevel <= 0) fail('focused guest zoom shortcut did not run');
  console.log('focused guest find and zoom shortcuts reached the active browser tab');

  // New tab: a second, empty instance appears and becomes active.
  await win.getByRole('button', { name: 'New tab', exact: true }).click();
  await waitForTab(win, 'Browser 2');
  console.log('added a second (empty) tab');

  // Popup: click the target=_blank link inside the FIRST tab's webview guest page. The guest
  // is a separate Playwright page; main must reroute the popup into a new in-app tab.
  await win.getByRole('button', { name: 'E2E Page One', exact: true }).click();
  await guest.click('#pop');
  await waitForTab(win, 'E2E Popup Page');
  console.log('guest popup landed in a new in-app tab');

  // Close the popup tab; the neighbor becomes active and the button disappears.
  await win.getByRole('button', { name: 'Close E2E Popup Page', exact: true }).click();
  await win.waitForTimeout(500);
  const closed = await win
    .getByRole('button', { name: 'E2E Popup Page', exact: true })
    .isVisible()
    .catch(falseFn);
  if (closed) fail('closing the popup tab did not remove it');
  console.log('closed the popup tab');
}

async function assertRestored(
  win: Page,
  app: ElectronApplication,
  pagePort: number,
): Promise<void> {
  // activeSection persisted as browser; the navigated tab reloads and re-reports its title.
  await waitForTab(win, 'E2E Page One');
  await waitForTab(win, 'Browser 2');
  await win.getByRole('button', { name: 'E2E Page One', exact: true }).click();
  const guest = app.windows().find((page) => page.url().startsWith(`http://127.0.0.1:${pagePort}`));
  if (guest === undefined) fail('did not restore the webview guest page');
  await guest.locator('body').click();
  await sendGuestShortcut(app, `http://127.0.0.1:${pagePort}`, 'f');
  await win.getByPlaceholder('Find…').waitFor({ state: 'visible' });
  console.log('tabs restored after restart');
}

async function main(): Promise<void> {
  if (!existsSync(join(daemonDir, 'dist/index.js'))) {
    fail('apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first');
  }
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) {
    fail('apps/desktop/out is missing — run `pnpm -F @linkcode/desktop build` first');
  }

  const home = mkdtempSync(join(tmpdir(), 'linkcode-e2e-home-'));
  const { server, port } = await startPageServer();
  console.log(`page server on :${port}`);

  let daemon: ChildProcess | null = null;
  let app: ElectronApplication | null = null;
  let userData: string | null = null;
  let passed = false;
  try {
    daemon = spawn(process.execPath, ['dist/index.js'], {
      cwd: daemonDir,
      env: { ...process.env, HOME: home, LINKCODE_PORT: String(PORT), LINKCODE_PROFILE: PROFILE },
      stdio: 'ignore',
    });
    await waitForDaemon();
    console.log(`daemon up on :${PORT} (HOME=${home}, profile=${PROFILE})`);

    const launch = (): Promise<ElectronApplication> =>
      _electron.launch({
        executablePath: electronBinary,
        // --lang pins navigator.languages (the renderer's locale source) to English so the
        // role-name locators are deterministic on non-English machines.
        args: [desktopDir, '--use-mock-keychain', '--lang=en-US'],
        env: { ...process.env, HOME: home, LINKCODE_PROFILE: PROFILE },
      });

    app = await launch();
    watchAppErrors(app);
    userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    let win = await waitForMainWindow(app);
    try {
      await run(win, app, port);
      await app.close();
      app = await launch();
      watchAppErrors(app);
      win = await waitForMainWindow(app);
      await assertRestored(win, app, port);
    } catch (error) {
      const shot = join(tmpdir(), `linkcode-e2e-browser-tabs-${process.pid}.png`);
      await win.screenshot({ path: shot }).catch(noop);
      console.error(`screenshot: ${shot}`);
      throw error;
    }
    passed = true;
    console.log('PASS');
  } finally {
    await app?.close().catch(noop);
    daemon?.kill('SIGTERM');
    server.close();
    if (userData !== null) rmSync(userData, { recursive: true, force: true });
    if (passed) {
      rmSync(home, { recursive: true, force: true });
    } else {
      console.error(`kept for debugging: HOME=${home}`);
      process.exitCode = 1;
    }
  }
}

void main();
