import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetDir, assetsRootFor, versionDir } from '../paths';

const home = '/home/u';

describe('assetsRootFor', () => {
  it('prefers the LINKCODE_ASSETS_DIR override on any platform', () => {
    expect(
      assetsRootFor({ platform: 'darwin', env: { LINKCODE_ASSETS_DIR: '/e2e/assets' }, home }),
    ).toBe('/e2e/assets');
  });

  it('maps darwin to Application Support', () => {
    expect(assetsRootFor({ platform: 'darwin', env: {}, home })).toBe(
      '/home/u/Library/Application Support/LinkCode/assets',
    );
  });

  it('maps linux to XDG_DATA_HOME when set, else ~/.local/share', () => {
    expect(assetsRootFor({ platform: 'linux', env: { XDG_DATA_HOME: '/xdg' }, home })).toBe(
      '/xdg/linkcode/assets',
    );
    expect(assetsRootFor({ platform: 'linux', env: {}, home })).toBe(
      '/home/u/.local/share/linkcode/assets',
    );
  });

  it('maps win32 to LOCALAPPDATA when set, else the AppData/Local fallback', () => {
    expect(
      assetsRootFor({
        platform: 'win32',
        env: { LOCALAPPDATA: String.raw`C:\Users\u\AppData\Local` },
        home,
      }),
    ).toBe(String.raw`C:\Users\u\AppData\Local/LinkCode/assets`);
    expect(assetsRootFor({ platform: 'win32', env: {}, home })).toBe(
      '/home/u/AppData/Local/LinkCode/assets',
    );
  });
});

describe('store layout', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('maps the asset id namespace to a directory level, resolved at call time', () => {
    vi.stubEnv('LINKCODE_ASSETS_DIR', '/store');
    expect(assetDir('agent:claude-code')).toBe('/store/agent/claude-code');
    expect(versionDir('tool:tectonic', '0.16.9')).toBe('/store/tool/tectonic/0.16.9');
  });
});
