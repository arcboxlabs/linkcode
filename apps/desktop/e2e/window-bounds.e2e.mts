/**
 * Window geometry E2E (CODE-285): a first launch derives the window size from the primary work
 * area (capped at 1560×980), closing persists bounds + maximized state, and a relaunch restores
 * both. Run `pnpm -F @linkcode/desktop e2e:window-bounds` after `pnpm -F @linkcode/desktop build`;
 * no daemon needed — the connection gate is enough surface.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { waitFor } from 'foxts/wait-for';
import type { ElectronApplication } from 'playwright-core';
import { _electron } from 'playwright-core';

const require = createRequire(import.meta.url);
const desktopDir = resolve(import.meta.dirname, '..');
const electronBinary = require('electron') as unknown as string;

const PROFILE = `e2e-window-bounds-${process.pid}`;

function fail(message: string): never {
  throw new Error(message);
}

async function launch(): Promise<ElectronApplication> {
  return _electron.launch({
    executablePath: electronBinary,
    args: [desktopDir, '--use-mock-keychain'],
    env: { ...process.env, LINKCODE_PROFILE: PROFILE },
  });
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function windowBounds(app: ElectronApplication): Promise<Bounds> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
}

async function main(): Promise<void> {
  if (!existsSync(join(desktopDir, 'out/main/index.js'))) {
    fail('apps/desktop/out is missing — run `pnpm -F @linkcode/desktop build` first');
  }

  let app: ElectronApplication | null = null;
  let userData = '';
  let passed = false;
  try {
    // First launch: no persisted state → the derived work-area default.
    app = await launch();
    await app.firstWindow();
    userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
    // Mirrors deriveDefaultWindowSize in src/main/window-state.ts.
    const expected = {
      width: Math.max(940, Math.min(1560, Math.round(workArea.width * 0.9))),
      height: Math.max(600, Math.min(980, Math.round(workArea.height * 0.92))),
    };
    const first = await windowBounds(app);
    console.log(
      `workArea=${JSON.stringify(workArea)} first-launch bounds=${JSON.stringify(first)}`,
    );
    if (first.width !== expected.width || first.height !== expected.height) {
      fail(
        `first-launch size ${first.width}x${first.height}, expected ${expected.width}x${expected.height}`,
      );
    }

    // Resize + move within the work area, then close: the state file must capture the normal bounds.
    // A real window manager is allowed to constrain off-screen geometry before Electron persists it.
    const target = { x: 80, y: 100, width: 1080, height: 780 };
    await app.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows()[0].setBounds(bounds);
    }, target);
    await wait(500);
    await app.close();
    app = null;
    const stateFile = join(userData, 'window-state.json');
    if (!existsSync(stateFile)) fail('window-state.json was not written on close');
    console.log(`persisted: ${readFileSync(stateFile, 'utf8').trim().replaceAll('\n', ' ')}`);

    // Relaunch: the saved bounds come back verbatim.
    app = await launch();
    await app.firstWindow();
    const restored = await windowBounds(app);
    console.log(`restored bounds=${JSON.stringify(restored)}`);
    if (
      restored.x !== target.x ||
      restored.y !== target.y ||
      restored.width !== target.width ||
      restored.height !== target.height
    ) {
      fail(`restored ${JSON.stringify(restored)}, expected ${JSON.stringify(target)}`);
    }

    // Maximize, close, relaunch: the maximized flag survives while normal bounds stay intact.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await waitFor(
      () => app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
      100,
      AbortSignal.timeout(5000),
    );
    await app.close();
    app = null;
    app = await launch();
    await app.firstWindow();
    await wait(1000);
    const maximized = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized(),
    );
    if (!maximized) fail('maximized state did not survive the relaunch');
    console.log('maximized state restored');

    passed = true;
    console.log('PASS');
  } finally {
    await app?.close().catch(noop);
    if (userData && passed) rmSync(userData, { recursive: true, force: true });
    if (!passed) {
      if (userData) console.error(`kept for debugging: userData=${userData}`);
      process.exitCode = 1;
    }
  }
}

void main();
