/**
 * New-session branch-picker E2E (CODE-428): boots an isolated daemon + the built desktop app,
 * registers a real Git fixture through the native directory-picker bridge, and verifies the
 * desktop shell's direct NewSessionSurface composition can select a local branch.
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

const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, '..');
const daemonDir = resolve(desktopDir, '../daemon');
const electronBinary = require('electron') as unknown as string;

const PORT = 44000 + (process.pid % 1000);
const FEATURE_BRANCH = 'feature/code-428';
const RE_FIXTURE_WORKSPACE = /branch-picker-fixture/;
const RE_FEATURE_BRANCH = /feature\/code-428/;

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

function makeRepository(path: string): void {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main'], {
    cwd: path,
    stdio: 'ignore',
    windowsHide: true,
  });
  writeFileSync(join(path, 'README.md'), '# Branch picker fixture\n');
  execFileSync('git', ['add', 'README.md'], {
    cwd: path,
    stdio: 'ignore',
    windowsHide: true,
  });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=LinkCode E2E',
      '-c',
      'user.email=e2e@linkcode.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture',
    ],
    { cwd: path, stdio: 'ignore', windowsHide: true },
  );
  execFileSync('git', ['branch', FEATURE_BRANCH], {
    cwd: path,
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function run(app: ElectronApplication, win: Page, repository: string): Promise<void> {
  await win.getByRole('combobox').waitFor({ state: 'visible', timeout: 30000 });
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [directory] });
  }, repository);

  await win.getByRole('button', { name: 'Add project' }).click();
  await win.getByRole('menuitem', { name: 'Use an existing folder' }).click();
  await win.getByText('branch-picker-fixture').first().waitFor({
    state: 'visible',
    timeout: 15000,
  });

  const workspacePicker = win.getByRole('button', { name: 'Choose a workspace' });
  await workspacePicker.click();
  await win
    .getByRole('menuitemradio', { name: RE_FIXTURE_WORKSPACE })
    .waitFor({ state: 'visible', timeout: 15000 });
  await win.getByRole('menuitemradio', { name: RE_FIXTURE_WORKSPACE }).click();

  const branchPicker = win.getByRole('button', { name: 'Branch' });
  await branchPicker.waitFor({ state: 'visible', timeout: 15000 });
  await branchPicker.click();
  const feature = win.getByRole('menuitemradio', { name: RE_FEATURE_BRANCH });
  await feature.waitFor({ state: 'visible', timeout: 15000 });
  const itemText = await feature.textContent();
  if (!itemText?.includes('isolated worktree')) {
    fail('non-current branch did not explain isolated worktree startup');
  }
  await feature.click();

  if (!(await branchPicker.textContent())?.includes(FEATURE_BRANCH)) {
    fail('selected branch was not reflected in the desktop context bar');
  }
  console.log('PASS desktop new-session branch picker');
}

async function main(): Promise<void> {
  if (!existsSync(join(daemonDir, 'dist/index.js'))) {
    fail('apps/daemon/dist is missing — run `pnpm -F @linkcode/daemon build` first');
  }
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) {
    fail('apps/desktop/out is missing — run `pnpm -F @linkcode/desktop build` first');
  }

  const home = mkdtempSync(join(tmpdir(), 'linkcode-e2e-branch-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'linkcode-e2e-branch-userdata-'));
  const repository = join(home, 'branch-picker-fixture');
  makeRepository(repository);

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

    app = await _electron.launch({
      executablePath: electronBinary,
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      env: { ...process.env, HOME: home },
    });
    const win = await app.firstWindow();
    try {
      await run(app, win, repository);
    } catch (error) {
      const shot = join(tmpdir(), `linkcode-e2e-new-session-branch-${process.pid}.png`);
      await win.screenshot({ path: shot }).catch(noop);
      console.error(`screenshot: ${shot}`);
      throw error;
    }
    passed = true;
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
