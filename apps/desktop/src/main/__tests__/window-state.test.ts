import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  workAreaSize: { width: 1728, height: 1079 },
  displays: [] as Array<{ workArea: { x: number; y: number; width: number; height: number } }>,
}));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: mocks.workAreaSize }),
    getAllDisplays: () => mocks.displays,
  },
}));

let root: string;

beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(join(tmpdir(), 'linkcode-window-state-'));
  mocks.userData = join(root, 'user-data');
  mkdirSync(mocks.userData, { recursive: true });
  mocks.workAreaSize = { width: 1728, height: 1079 };
  mocks.displays = [{ workArea: { x: 0, y: 38, width: 1728, height: 1079 } }];
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const VALID_STATE = {
  bounds: { x: 80, y: 90, width: 1200, height: 800 },
  maximized: false,
  fullScreen: false,
};

function writeState(value: unknown): void {
  writeFileSync(join(mocks.userData, 'window-state.json'), JSON.stringify(value));
}

describe('deriveDefaultWindowSize', () => {
  it('takes a work-area fraction capped at the full-layout width', async () => {
    const { deriveDefaultWindowSize } = await import('../window-state');
    // 16" MBP work area: width lands on the 90% fraction, height hits the 980 cap.
    expect(deriveDefaultWindowSize()).toEqual({ width: 1555, height: 980 });
  });

  it('scales down on small work areas but never below the window minimum', async () => {
    const { deriveDefaultWindowSize } = await import('../window-state');
    mocks.workAreaSize = { width: 1470, height: 920 };
    expect(deriveDefaultWindowSize()).toEqual({ width: 1323, height: 846 });
    mocks.workAreaSize = { width: 800, height: 560 };
    expect(deriveDefaultWindowSize()).toEqual({ width: 940, height: 600 });
  });
});

describe('readWindowState', () => {
  it('returns null for a missing, malformed, or sub-minimum state file', async () => {
    const { readWindowState } = await import('../window-state');
    expect(readWindowState()).toBeNull();
    writeFileSync(join(mocks.userData, 'window-state.json'), 'not json');
    expect(readWindowState()).toBeNull();
    writeState({ ...VALID_STATE, bounds: { ...VALID_STATE.bounds, width: 100 } });
    expect(readWindowState()).toBeNull();
  });

  it('restores a state whose bounds still land on a connected display', async () => {
    const { readWindowState } = await import('../window-state');
    writeState(VALID_STATE);
    expect(readWindowState()).toEqual(VALID_STATE);
  });

  it('keeps a grabbable sliver but discards bounds fully off every display', async () => {
    const { readWindowState } = await import('../window-state');
    writeState({ ...VALID_STATE, bounds: { ...VALID_STATE.bounds, x: 1608 } });
    expect(readWindowState()).not.toBeNull();
    writeState({ ...VALID_STATE, bounds: { ...VALID_STATE.bounds, x: 4000 } });
    expect(readWindowState()).toBeNull();
  });

  it('discards bounds when only the bottom of the window remains visible', async () => {
    const { readWindowState } = await import('../window-state');
    mocks.displays = [{ workArea: { x: 0, y: 0, width: 1728, height: 1079 } }];
    writeState({ ...VALID_STATE, bounds: { ...VALID_STATE.bounds, y: -752 } });
    expect(readWindowState()).toBeNull();
  });
});

describe('persistWindowStateOnClose', () => {
  it('writes a restorable snapshot when the window closes', async () => {
    const { persistWindowStateOnClose, readWindowState } = await import('../window-state');
    let onClose: (() => void) | undefined;
    persistWindowStateOnClose({
      on(_event: 'close', cb: () => void) {
        onClose = cb;
      },
      getNormalBounds: () => VALID_STATE.bounds,
      isMaximized: () => true,
      isFullScreen: () => false,
    });
    onClose?.();
    expect(readWindowState()).toEqual({ ...VALID_STATE, maximized: true });
  });
});
