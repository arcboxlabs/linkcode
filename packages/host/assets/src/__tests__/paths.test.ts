import { managedAgentAssetId, managedToolAssetId } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetDir, assetsRootFor, versionDir } from '../paths';

const home = '/home/u';
const channel = 'release';

describe('assetsRootFor', () => {
  it('prefers the LINKCODE_ASSETS_DIR override on any platform', () => {
    expect(
      assetsRootFor({
        platform: 'darwin',
        env: { LINKCODE_ASSETS_DIR: '/e2e/assets' },
        home,
        channel,
      }),
    ).toBe('/e2e/assets');
  });

  it('maps darwin to Application Support', () => {
    expect(assetsRootFor({ platform: 'darwin', env: {}, home, channel })).toBe(
      '/home/u/Library/Application Support/LinkCode/assets',
    );
  });

  it('maps linux to XDG_DATA_HOME when set, else ~/.local/share', () => {
    expect(
      assetsRootFor({ platform: 'linux', env: { XDG_DATA_HOME: '/xdg' }, home, channel }),
    ).toBe('/xdg/linkcode/assets');
    expect(assetsRootFor({ platform: 'linux', env: {}, home, channel })).toBe(
      '/home/u/.local/share/linkcode/assets',
    );
  });

  it('maps win32 to LOCALAPPDATA when set, else the AppData/Local fallback', () => {
    expect(
      assetsRootFor({
        platform: 'win32',
        env: { LOCALAPPDATA: String.raw`C:\Users\u\AppData\Local` },
        home,
        channel,
      }),
    ).toBe(String.raw`C:\Users\u\AppData\Local/LinkCode/assets`);
    expect(assetsRootFor({ platform: 'win32', env: {}, home, channel })).toBe(
      '/home/u/AppData/Local/LinkCode/assets',
    );
  });

  // The store is what a boot GC prunes to the running daemon's version pins, so a shared root
  // would let a dev daemon delete an installed release's binaries (CODE-460).
  it('forks the development channel onto its own root, per platform', () => {
    const development = 'development';
    expect(assetsRootFor({ platform: 'darwin', env: {}, home, channel: development })).toBe(
      '/home/u/Library/Application Support/LinkCode Development/assets',
    );
    expect(assetsRootFor({ platform: 'win32', env: {}, home, channel: development })).toBe(
      '/home/u/AppData/Local/LinkCode Development/assets',
    );
    expect(assetsRootFor({ platform: 'linux', env: {}, home, channel: development })).toBe(
      '/home/u/.local/share/linkcode-development/assets',
    );
  });
});

describe('store layout', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('maps the asset id namespace to a directory level, resolved at call time', () => {
    vi.stubEnv('LINKCODE_ASSETS_DIR', '/store');
    expect(assetDir(managedAgentAssetId('claude-code'))).toBe('/store/agent/claude-code');
    expect(versionDir(managedToolAssetId('tectonic'), '0.16.9')).toBe(
      '/store/tool/tectonic/0.16.9',
    );
  });
});
