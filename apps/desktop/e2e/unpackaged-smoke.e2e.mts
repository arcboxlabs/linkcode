/** Linux CI entry boundary for the built, unpackaged Electron main/preload/renderer. */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { noop } from 'foxts/noop';
import type { ElectronApplication } from 'playwright-core';
import { _electron } from 'playwright-core';

const require = createRequire(import.meta.url);

const desktopDir = resolve(import.meta.dirname, '..');
const electronBinary = require('electron') as unknown as string;

const VERSION_RE = /^\d+\.\d+\.\d+/;

async function main(): Promise<void> {
  assert(existsSync(join(desktopDir, 'out/main/index.js')), 'built desktop main is missing');
  const home = mkdtempSync(join(tmpdir(), 'linkcode-unpackaged-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'linkcode-unpackaged-userdata-'));
  let app: ElectronApplication | null = null;
  try {
    app = await _electron.launch({
      executablePath: electronBinary,
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      env: { ...process.env, HOME: home },
    });
    const page = await app.firstWindow();
    await page.locator('body').waitFor({ state: 'visible', timeout: 30000 });
    const boundary = await page.evaluate(async () => ({
      platform: window.linkcodeSystem.app.platform,
      version: await window.linkcodeSystem.app.version(),
      managed: await window.linkcodeSystem.daemon.isManaged(),
      maximized: await window.linkcodeSystem.window.isMaximized(),
    }));
    assert.equal(boundary.platform, 'linux');
    assert.match(boundary.version, VERSION_RE);
    assert.equal(boundary.managed, false);
    assert.equal(typeof boundary.maximized, 'boolean');
    console.log('PASS unpackaged built main, sandbox preload bridge, and renderer window');
  } finally {
    await app?.close().catch(noop);
    rmSync(home, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
}

void main();
