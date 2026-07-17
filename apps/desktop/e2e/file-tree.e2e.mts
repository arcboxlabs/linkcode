/**
 * Files-panel tree E2E (CODE-263): boots an isolated daemon + the built desktop app, starts a real
 * pi session in the daemon-owned chat workspace (pre-populated with fixture files), opens the right
 * panel's Files section, and asserts the @pierre/trees browser renders the workspace enumeration
 * and that clicking a file opens its viewer tab. Run `pnpm -F @linkcode/desktop e2e:file-tree`
 * after building daemon and desktop; needs the `pi` CLI on PATH.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const PORT = 43000 + (process.pid % 1000);

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

/** Row identity lives on `button[data-type="item"][aria-label="<path basename>"]` inside the
 * host's shadow root (visible label text is span-split for middle-ellipsis truncation). */
async function treeRowLabels(win: Page): Promise<string[]> {
  return win.evaluate(() => {
    const host = document.querySelector('file-tree-container');
    const rows = host?.shadowRoot?.querySelectorAll('button[data-type="item"]') ?? [];
    return [...rows].map((row) => row.getAttribute('aria-label') ?? '');
  });
}

async function run(win: Page): Promise<void> {
  const composer = win.locator('textarea').first();
  await composer.waitFor({ state: 'visible', timeout: 30000 });
  await win.waitForTimeout(2000);

  // Pi is the fresh-profile default provider; a session must exist for the Files
  // panel to have a cwd, so send one prompt from the draft composer.
  await composer.fill('Reply with one short sentence.');
  await win.getByRole('button', { name: 'Send' }).click();
  await win.waitForTimeout(3000);
  console.log('pi session started in the chat workspace');

  // The right panel is already open on a fresh profile — switch to its Files section.
  await win.getByRole('button', { name: 'Files', exact: true }).click();
  await win.waitForTimeout(2000);

  const treeHost = win.locator('file-tree-container');
  await treeHost.waitFor({ state: 'attached', timeout: 15000 });

  const deadline = Date.now() + 20000;
  let labels: string[] = [];
  while (Date.now() < deadline) {
    labels = await treeRowLabels(win);
    if (labels.includes('fixture-readme.md')) break;
    await wait(500);
  }
  console.log('tree rows:', JSON.stringify(labels));
  if (!labels.includes('fixture-readme.md')) {
    const shot = join(tmpdir(), `linkcode-e2e-file-tree-${process.pid}.png`);
    await win.screenshot({ path: shot });
    console.error(`screenshot: ${shot}`);
    fail('tree did not render fixture-readme.md');
  }
  if (!labels.includes('docs')) fail('tree did not render the docs/ directory row');
  // Hidden + heavy entries must be filtered out by the engine enumeration.
  if (labels.some((l) => l.includes('secret') || l.includes('.hidden'))) {
    fail('tree leaked a hidden directory entry');
  }

  // Click the file row inside the shadow DOM and expect a viewer tab for it.
  await win.evaluate(() => {
    const host = document.querySelector('file-tree-container');
    const row = host?.shadowRoot?.querySelector<HTMLElement>(
      'button[data-type="item"][aria-label="fixture-readme.md"]',
    );
    if (!row) throw new Error('no tree row for fixture-readme.md');
    row.click();
  });
  await win.waitForTimeout(2000);

  const bodyText = await win.evaluate(() => document.body.innerText);
  if (!bodyText.includes('Tree fixture readme content')) {
    fail('clicking the tree row did not open the file viewer with its content');
  }
  console.log('viewer opened with file content after tree click');

  // Long unwrapped lines must scroll inside the viewer, not clip at the window edge
  // (regression: the viewer flex column lacked min-w-0 and grew to its content width).
  await win.evaluate(() => {
    const host = document.querySelector('file-tree-container');
    const row = host?.shadowRoot?.querySelector<HTMLElement>(
      'button[data-type="item"][aria-label="long-line.txt"]',
    );
    if (!row) throw new Error('no tree row for long-line.txt');
    row.click();
  });
  await win.waitForTimeout(2000);

  const viewer = await win.evaluate(() => {
    const pre = [...document.querySelectorAll('pre')].find((el) =>
      el.textContent?.includes('end-of-long-line'),
    );
    if (!pre) return null;
    const rect = pre.getBoundingClientRect();
    return {
      right: rect.right,
      innerWidth: window.innerWidth,
      scrollWidth: pre.scrollWidth,
      clientWidth: pre.clientWidth,
    };
  });
  console.log('long-line viewer metrics:', JSON.stringify(viewer));
  if (!viewer) fail('long-line.txt did not open in the plain-text viewer');
  if (viewer.right > viewer.innerWidth + 1) {
    fail('viewer overflows the window instead of scrolling (missing min-w-0)');
  }
  if (viewer.scrollWidth <= viewer.clientWidth) {
    fail('long line is not horizontally scrollable inside the viewer');
  }
  console.log('long-line content scrolls inside the viewer');
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

  // Pre-populate the daemon-owned chat workspace ($HOME/LinkCode) the pi session runs in, so
  // the tree has a known enumeration: nested dirs plus a hidden dir the walk must skip.
  const chatRoot = join(home, 'LinkCode');
  mkdirSync(join(chatRoot, 'docs'), { recursive: true });
  mkdirSync(join(chatRoot, '.hidden'), { recursive: true });
  writeFileSync(join(chatRoot, 'fixture-readme.md'), '# Tree fixture readme content\n');
  writeFileSync(join(chatRoot, 'long-line.txt'), `${'x'.repeat(2000)} end-of-long-line\n`);
  writeFileSync(join(chatRoot, 'docs', 'notes.md'), '# Notes\n');
  writeFileSync(join(chatRoot, '.hidden', 'secret.txt'), 'nope\n');

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
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      env: { ...process.env, HOME: home },
    });

    const win = await app.firstWindow();
    try {
      await run(win);
    } catch (error) {
      const shot = join(tmpdir(), `linkcode-e2e-file-tree-${process.pid}.png`);
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
    } else {
      console.error(`kept for debugging: HOME=${home} userData=${userData}`);
      process.exitCode = 1;
    }
  }
}

void main();
