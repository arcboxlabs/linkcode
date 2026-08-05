import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve as resolvePath } from 'node:path';

import type { ElectronApplication } from 'playwright-core';
import { _electron } from 'playwright-core';

import { fixture } from './fixture.mts';

const require = createRequire(import.meta.url);
const desktopDir = resolvePath(import.meta.dirname, '../..');
const electronBinary = require('electron') as unknown as string;

export const PORT = 44100 + (process.pid % 1000);

export function generateTlsMaterial(directory: string): { cert: string; key: string } {
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  const result = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '3',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'pipe' },
  );
  if (result.status !== 0) {
    throw new Error(`openssl failed: ${result.stderr.toString()}`);
  }
  return { cert, key };
}

export function buildDesktopWithBootstrap(): void {
  const bootstrap = {
    brandId: fixture.target.brandId,
    channel: fixture.target.channel,
    defaults: fixture.bootstrapDefaults,
    emergencyEndpoint: null,
    emergencyPublicKeys: {},
    endpoint: `https://127.0.0.1:${PORT}`,
    maximumSchemaVersion: fixture.maximumSchemaVersion,
    publicKeys: fixture.keys,
  };
  console.log('building desktop bundle with pilot bootstrap…');
  const result = spawnSync('pnpm', ['run', 'build'], {
    cwd: desktopDir,
    env: { ...process.env, MAIN_VITE_CONFIG_BOOTSTRAP: JSON.stringify(bootstrap) },
    stdio: 'inherit',
    timeout: 15 * 60000,
  });
  if (result.status !== 0) throw new Error('desktop build with pilot bootstrap failed');
}

export async function launchApp(
  userData: string,
  home: string,
  caCert: string,
): Promise<ElectronApplication> {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [desktopDir, `--user-data-dir=${userData}`, '--use-mock-keychain'],
    env: {
      ...process.env,
      HOME: home,
      NODE_EXTRA_CA_CERTS: caCert,
      // identity.ts repins userData to appData/APP_NAME, so isolation comes from here.
      XDG_CONFIG_HOME: join(home, '.config'),
    },
  });
  const page = await app.firstWindow();
  await page.locator('body').waitFor({ state: 'visible', timeout: 30000 });
  return app;
}
