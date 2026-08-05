/** Linux CI entry boundary for the built, unpackaged Electron main/preload/renderer. */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

/** When the build embedded a rendered config bundle (CODE-552), its staged copy under out/ names
 * the exact defaults the main process must serve; without it the sentinel bootstrap is empty. */
function loadExpectedBundledValues(): Record<string, unknown> | null {
  const stagedBundlePath = join(desktopDir, 'out/config/build-bundle.json');
  if (!existsSync(stagedBundlePath)) return null;
  const bundle = JSON.parse(readFileSync(stagedBundlePath, 'utf8')) as {
    snapshot: { base64Url: string };
  };
  const snapshot = JSON.parse(
    Buffer.from(bundle.snapshot.base64Url, 'base64url').toString('utf8'),
  ) as { values: Record<string, unknown> };
  return snapshot.values;
}

async function main(): Promise<void> {
  assert(existsSync(join(desktopDir, 'out/main/index.js')), 'built desktop main is missing');
  const home = mkdtempSync(join(tmpdir(), 'linkcode-unpackaged-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'linkcode-unpackaged-userdata-'));
  let app: ElectronApplication | null = null;
  try {
    app = await _electron.launch({
      executablePath: electronBinary,
      args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
      // The bogus bootstrap below must be inert: the build inlined the real bootstrap and the
      // main process never reads this variable at runtime (CODE-552 immutability boundary).
      env: {
        ...process.env,
        HOME: home,
        MAIN_VITE_CONFIG_BOOTSTRAP: '{"defaults":{"app.displayName":"RUNTIME-OVERRIDE"}}',
      },
    });
    const page = await app.firstWindow();
    await page.locator('body').waitFor({ state: 'visible', timeout: 30000 });
    const boundary = await page.evaluate(async () => ({
      config: {
        info: window.linkcodeConfig.snapshotInfo(),
        refresh: await window.linkcodeConfig.refresh(),
        snapshot: window.linkcodeConfig.effectiveSnapshot(),
        unsubscribeType: typeof window.linkcodeConfig.onHotUpdate((keys) => keys.length),
      },
      platform: window.linkcodeSystem.app.platform,
      version: await window.linkcodeSystem.app.version(),
      managed: await window.linkcodeSystem.daemon.isManaged(),
      maximized: await window.linkcodeSystem.window.isMaximized(),
    }));
    assert.equal(boundary.platform, 'linux');
    assert.match(boundary.version, VERSION_RE);
    assert.equal(boundary.managed, false);
    assert.equal(typeof boundary.maximized, 'boolean');
    const expectedValues = loadExpectedBundledValues();
    if (expectedValues) {
      // Exact same-source check: the served snapshot must byte-match the rendered bundle defaults,
      // untouched by the bogus runtime MAIN_VITE_CONFIG_BOOTSTRAP passed at launch.
      assert.deepEqual(boundary.config.snapshot, expectedValues);
      assert.equal(boundary.config.info.source, 'bundled');
      assert.equal(boundary.config.info.status, 'READY');
      assert.notEqual(boundary.config.refresh.normal, 'disabled');
      assert.notEqual(boundary.config.refresh.emergency, 'disabled');
      console.log('PASS bundled config defaults served first-frame from the rendered bundle');
    } else {
      assert.deepEqual(boundary.config.snapshot, {});
      assert.deepEqual(boundary.config.info, {
        configVersion: null,
        emergency: null,
        emergencySupport: 'disabled',
        sha256: null,
        source: 'bundled',
        stagedColdKeys: [],
        status: 'READY',
      });
      assert.equal(boundary.config.refresh.normal, 'disabled');
      assert.equal(boundary.config.refresh.emergency, 'disabled');
    }
    assert.equal(boundary.config.unsubscribeType, 'function');
    await page.waitForFunction(() => window.configSigningPoc !== undefined);
    const signingPoc = await page.evaluate(() => window.configSigningPoc);
    assert.deepEqual(signingPoc?.noble, signingPoc?.webCrypto);
    assert.equal(
      signingPoc?.webCrypto.snapshotSha256,
      '513910f70984fbd2290d4538d8e668a8b9d853b466921e6839695b2d98b10e97',
    );
    console.log('PASS Electron WebCrypto and Noble config signing vector');
    console.log('PASS unpackaged built main, sandbox preload bridge, and renderer window');
  } finally {
    await app?.close().catch(noop);
    rmSync(home, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  }
}

void main();
