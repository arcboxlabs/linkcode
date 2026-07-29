/**
 * New-session approval-policy default E2E (CODE-467): boots an isolated daemon + the built desktop
 * app against a fake HOME whose chat workspace declares `permissions.defaultMode: "plan"`, then
 * asserts the new-session page advertises Plan mode.
 *
 * The catalog request is what this guards: it must carry the selected workspace's cwd, or
 * claude-code's `startCatalog` cannot read that settings file and the picker falls back to "Ask
 * permissions" while the started session would actually run in Plan mode. No agent CLI is needed —
 * `startCatalog` only reads the workspace's settings. Run `pnpm -F @linkcode/desktop
 * e2e:new-session-policy` after building daemon and desktop.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const PORT = 43000 + (process.pid % 1000);
// Both sides must agree, or the app resolves a different userData universe than the daemon's HOME
// and reads a real dev profile's persisted provider instead of this run's.
const PROFILE = `e2e-policy-${process.pid}`;
const RE_PLAN_MODE = /Plan mode/;

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

async function run(win: Page): Promise<void> {
  // A fresh profile opens straight onto the new-session page.
  await win.getByText('What should we build?').waitFor({ state: 'visible', timeout: 30000 });
  await win.waitForTimeout(2000);

  // The chip is the approval-policy trigger specifically, so this cannot pass on the words
  // appearing anywhere else on the page.
  const policyChip = win.getByRole('button', { name: RE_PLAN_MODE });
  if (!(await policyChip.isVisible().catch(falseFn))) {
    const labels = await win
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
    console.error('composer controls:', JSON.stringify(labels.filter(Boolean)));
    fail(
      'the new-session composer does not advertise Plan mode — the agent catalog was fetched without the workspace cwd',
    );
  }
  console.log('approval-policy picker resolved the workspace default: Plan mode');
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

  // The daemon-owned chat workspace is the new-session page's default selection; declaring a
  // non-default tier here is what the picker has to discover.
  const chatRoot = join(home, 'LinkCode');
  mkdirSync(join(chatRoot, '.claude'), { recursive: true });
  writeFileSync(
    join(chatRoot, '.claude', 'settings.json'),
    `${JSON.stringify({ permissions: { defaultMode: 'plan' } }, null, 2)}\n`,
  );

  let daemon: ChildProcess | null = null;
  let app: ElectronApplication | null = null;
  let passed = false;
  try {
    daemon = spawn(process.execPath, ['dist/index.js'], {
      cwd: daemonDir,
      env: { ...process.env, HOME: home, LINKCODE_PORT: String(PORT), LINKCODE_PROFILE: PROFILE },
      stdio: 'ignore',
    });
    await waitForDaemon();
    console.log(`daemon up on :${PORT} (HOME=${home})`);

    app = await _electron.launch({
      executablePath: electronBinary,
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      env: { ...process.env, HOME: home, LINKCODE_PROFILE: PROFILE },
    });

    const win = await app.firstWindow();
    try {
      await run(win);
    } catch (error) {
      const shot = join(tmpdir(), `linkcode-e2e-new-session-policy-${process.pid}.png`);
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
