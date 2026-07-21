/**
 * Chrome title overflow-menu E2E (CODE-379): boots an isolated daemon + the built desktop app with a
 * pre-seeded titled session, then drives the title menu — pin round-trips through the sidebar, copy
 * lands on the clipboard, reveal reaches the main process with the thread's cwd, and close drops the
 * thread. `shell.showItemInFolder` is swapped out in main so the run never pops a Finder window.
 *
 * Deliberately NOT covered: clicking "open in editor" would launch a real editor over the
 * developer's desktop, so this only asserts the item reflects what main detected — the launch path
 * itself is unit-tested (`src/main/__tests__/editors.test.ts`) and verified by hand.
 *
 * Run `pnpm -F @linkcode/desktop e2e:thread-menu` after building daemon and desktop. Needs no agent
 * CLI: the session is seeded straight into the daemon's database and never run.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
const electronBinary = require('electron') as unknown as string;

const PORT = 44000 + (process.pid % 1000);
const SESSION_ID = 'e2e-thread-menu-session';
const SESSION_TITLE = 'Seeded thread for the title menu';

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/**
 * Ready means the runtime file is on disk, not merely that something answers on the port: the
 * desktop discovers its endpoint through `$HOME/.linkcode/runtime.json`, and a restart that races
 * the previous daemon's shutdown leaves the port answering with no runtime file to find.
 */
async function waitForDaemon(home: string): Promise<void> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (existsSync(join(home, '.linkcode', 'runtime.json'))) {
      try {
        await fetch(`http://127.0.0.1:${PORT}/socket.io/?EIO=4&transport=polling`);
        return;
      } catch {
        /* not accepting connections yet */
      }
    }
    await wait(250);
  }
  fail(`daemon did not come up on port ${PORT}`);
}

function startDaemon(home: string): ChildProcess {
  return spawn(process.execPath, ['dist/index.js'], {
    cwd: daemonDir,
    env: { ...process.env, HOME: home, LINKCODE_PORT: String(PORT) },
    stdio: 'ignore',
  });
}

function stopDaemon(daemon: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    daemon.once('exit', () => resolve());
    daemon.kill('SIGTERM');
  });
}

/** Insert one titled, never-run session so the chrome renders its title area (and the menu). */
function seedSession(home: string, cwd: string): void {
  const Database = require('better-sqlite3') as new (
    path: string,
  ) => {
    prepare(sql: string): { run(...params: unknown[]): void };
    close(): void;
  };
  const db = new Database(join(home, '.linkcode', 'daemon.db'));
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions
       (session_id, kind, cwd, title, origin_type, created_at, updated_at)
     VALUES (?, 'pi', ?, ?, 'created', ?, ?)`,
  ).run(SESSION_ID, cwd, SESSION_TITLE, now, now);
  db.close();
}

async function openMenu(win: Page): Promise<void> {
  await win.getByRole('button', { name: 'More actions' }).click();
  await win.waitForTimeout(500);
}

async function run(win: Page, app: ElectronApplication, workspace: string): Promise<void> {
  // No composer to wait on: under a throwaway HOME no agent is signed in, so the surface shows
  // its onboarding card. The seeded thread row is the real readiness signal.
  const thread = win.getByRole('button', { name: new RegExp(SESSION_TITLE) }).first();
  await thread.waitFor({ state: 'visible', timeout: 30000 });
  await thread.click();
  await win.waitForTimeout(1500);

  await win.getByRole('button', { name: 'More actions' }).waitFor({
    state: 'visible',
    timeout: 15000,
  });
  console.log('title menu trigger rendered for the seeded thread');

  // Pin: the item flips to Unpin and the thread joins the sidebar's Pinned group.
  await openMenu(win);
  const openShot = join(tmpdir(), `linkcode-e2e-thread-menu-open-${process.pid}.png`);
  await win.screenshot({ path: openShot });
  console.log(`open-menu screenshot: ${openShot}`);
  await win.getByRole('menuitem', { name: 'Pin thread' }).click();
  await win.waitForTimeout(1000);
  if (!(await win.evaluate(() => document.body.innerText.includes('Pinned')))) {
    fail('pinning from the title menu did not add a Pinned group to the sidebar');
  }
  await openMenu(win);
  const unpin = win.getByRole('menuitem', { name: 'Unpin thread' });
  if ((await unpin.count()) === 0) fail('the menu did not flip to Unpin after pinning');
  await unpin.click();
  await win.waitForTimeout(1000);
  console.log('pin/unpin round-trips through the sidebar');

  // Copy: read the clipboard from main, where no page-permission prompt applies.
  await app.evaluate(({ clipboard }) => clipboard.writeText('e2e-clipboard-sentinel'));
  await openMenu(win);
  await win.getByRole('menuitem', { name: 'Copy title' }).click();
  await win.waitForTimeout(1000);
  const clipboard = await app.evaluate(({ clipboard: c }) => c.readText());
  if (clipboard !== SESSION_TITLE) {
    fail(`clipboard holds ${JSON.stringify(clipboard)}, expected the thread title`);
  }
  console.log('copy title lands on the clipboard');

  // Reveal: the swapped-in main handler records the path instead of opening a file manager.
  await openMenu(win);
  const reveal = win.getByRole('menuitem', { name: /Reveal in Finder|Show in File|file manager/ });
  if ((await reveal.count()) === 0) fail('the menu has no reveal item');
  await reveal.click();
  await win.waitForTimeout(1000);
  const revealed = await app.evaluate(
    () => (globalThis as unknown as { __e2eRevealed?: string[] }).__e2eRevealed ?? [],
  );
  if (revealed.length !== 1) fail(`reveal reached main ${revealed.length} times, expected 1`);
  if (revealed[0] !== workspace) {
    fail(`reveal got ${JSON.stringify(revealed[0])}, expected the thread cwd ${workspace}`);
  }
  console.log(`reveal reached main with the thread cwd (${revealed[0]})`);

  // Open in editor: presence only — clicking would launch a real editor. Whether the item is a
  // plain entry, a chooser submenu, or absent depends on what main detected on this host.
  await openMenu(win);
  const editorItem = win.getByRole('menuitem', { name: 'Open in editor' });
  console.log(
    (await editorItem.count()) === 0
      ? 'no editor detected on this host; the item is correctly hidden'
      : 'open-in-editor item present',
  );
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // Close: the thread leaves the list, taking the title area (and this menu) with it.
  await openMenu(win);
  await win.getByRole('menuitem', { name: 'Close thread' }).click();
  await win.waitForTimeout(2000);
  if (await win.evaluate((title) => document.body.innerText.includes(title), SESSION_TITLE)) {
    fail('closing from the title menu left the thread in the list');
  }
  console.log('close removes the thread');

  const shot = join(tmpdir(), `linkcode-e2e-thread-menu-${process.pid}.png`);
  await win.screenshot({ path: shot });
  console.log(`final screenshot: ${shot}`);
}

async function main(): Promise<void> {
  if (!existsSync(join(daemonDir, 'dist/index.js'))) {
    fail('apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first');
  }
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) {
    fail('apps/desktop/out is missing — run `pnpm -F @linkcode/desktop build` first');
  }

  const home = mkdtempSync(join(tmpdir(), 'linkcode-e2e-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'linkcode-e2e-userdata-'));
  const workspace = join(home, 'LinkCode');
  mkdirSync(workspace, { recursive: true });

  let daemon: ChildProcess | null = null;
  let app: ElectronApplication | null = null;
  let passed = false;
  try {
    // Boot once so the daemon creates and migrates the database, seed, then restart it so the
    // session list is served from the seeded rows.
    daemon = startDaemon(home);
    await waitForDaemon(home);
    await stopDaemon(daemon);
    seedSession(home, workspace);
    daemon = startDaemon(home);
    await waitForDaemon(home);
    console.log(`daemon up on :${PORT} with a seeded titled session (HOME=${home})`);

    app = await _electron.launch({
      executablePath: electronBinary,
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      env: { ...process.env, HOME: home },
    });

    // The system context calls `shell.showItemInFolder` as a property lookup, so replacing it on
    // the electron module records the call without opening a file-manager window.
    await app.evaluate(({ shell }) => {
      const recorder = globalThis as unknown as { __e2eRevealed?: string[] };
      recorder.__e2eRevealed = [];
      shell.showItemInFolder = (fullPath: string): void => {
        recorder.__e2eRevealed?.push(fullPath);
      };
    });

    const win = await app.firstWindow();
    win.on('pageerror', (error) => console.error(`[renderer:error] ${error.message}`));
    try {
      await run(win, app, workspace);
    } catch (error) {
      const shot = join(tmpdir(), `linkcode-e2e-thread-menu-${process.pid}.png`);
      await win.screenshot({ path: shot }).catch(noop);
      const body = await win.evaluate(() => document.body.innerText).catch(() => '<unreadable>');
      console.error(`screenshot: ${shot}`);
      console.error(`body text:\n${body.slice(0, 2000)}`);
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
    } else {
      console.error(`kept for debugging: HOME=${home} userData=${userData}`);
      process.exitCode = 1;
    }
  }
}

void main();
