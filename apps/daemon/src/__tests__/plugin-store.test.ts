import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  InstalledLinkCodePlugin,
  LinkCodePluginManifest,
  LinkCodePluginRelease,
} from '@linkcode/schema';
import { wait } from 'foxts/wait';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePluginTmpDir, pluginPackageDir, pluginRegistryPath } from '../plugin-store/paths';
import { DaemonLinkCodePluginStore } from '../plugin-store/store';
import { createInMemoryVault } from './fixtures/in-memory-vault';

const mocks = vi.hoisted(() => ({
  downloadVerified: vi.fn(),
  tarExtract: vi.fn(),
}));

vi.mock('@linkcode/assets', () => ({ downloadVerified: mocks.downloadVerified }));
vi.mock('tar', () => ({ extract: mocks.tarExtract }));

let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-plugin-store-'));
  process.env.LINKCODE_CHANNEL = 'release';
  mocks.downloadVerified.mockReset().mockResolvedValue(undefined);
  mocks.tarExtract.mockReset();
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_CHANNEL;
  vi.restoreAllMocks();
});

function manifest(version: string, componentName = 'latex'): LinkCodePluginManifest {
  return {
    manifestVersion: 1,
    id: 'arcbox/latex',
    version,
    keywords: [],
    components: [{ kind: 'skill', name: componentName, entry: 'skills/latex/SKILL.md' }],
    assets: [],
  };
}

function record(version: string): InstalledLinkCodePlugin {
  return {
    id: 'arcbox/latex',
    version,
    marketplaceId: 'linkcode-official',
    integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
    enabled: true,
    path: pluginPackageDir('arcbox/latex', version),
  };
}

function writePackage(installed: InstalledLinkCodePlugin, packageManifest: unknown): void {
  mkdirSync(installed.path, { recursive: true });
  writeFileSync(join(installed.path, 'manifest.json'), JSON.stringify(packageManifest));
}

function writeRegistry(records: InstalledLinkCodePlugin[]): void {
  const path = pluginRegistryPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(records));
}

function settingsManifest(version: string): LinkCodePluginManifest {
  return {
    ...manifest(version),
    settings: {
      account: { type: 'string', label: 'Account' },
      authcode: { type: 'password', label: 'Authorization code', secret: true },
    },
  };
}

describe('DaemonLinkCodePluginStore', () => {
  it('allocates a unique staging directory for concurrent installs of the same release', () => {
    expect(makePluginTmpDir('arcbox/latex', '0.2.0')).not.toBe(
      makePluginTmpDir('arcbox/latex', '0.2.0'),
    );
  });

  it('uses the most recently installed record for legacy duplicate plugin ids', () => {
    const v1 = record('0.1.0');
    const v2 = record('0.2.0');
    writePackage(v1, { ...manifest('0.1.0'), futureManifestField: 'ignored' });
    writePackage(v2, manifest('0.2.0'));
    writeRegistry([v1, v2]);

    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    expect(store.list()).toMatchObject([{ installed: { version: '0.2.0' } }]);
    expect(store.get('arcbox/latex')?.installed.version).toBe('0.2.0');
  });

  it('replaces an older package and returns the verified on-disk manifest', async () => {
    const v0 = record('0.0.1');
    const v1 = record('0.1.0');
    writePackage(v0, manifest('0.0.1'));
    writePackage(v1, manifest('0.1.0'));
    writeRegistry([v0, v1]);
    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(manifest('0.2.0', 'package-skill')));
    });
    const release = {
      manifest: manifest('0.2.0', 'index-skill'),
      artifact: {
        urls: ['https://plugins.example/arcbox-latex-0.2.0.tgz'],
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        format: 'tgz',
      },
    } satisfies LinkCodePluginRelease;
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    const installed = await store.install(release, 'linkcode-official');

    expect(installed.manifest.components[0]?.name).toBe('package-skill');
    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('package-skill');
    expect(existsSync(v0.path)).toBe(false);
    expect(existsSync(v1.path)).toBe(false);
    expect(JSON.parse(readFileSync(pluginRegistryPath(), 'utf8'))).toMatchObject([
      { id: 'arcbox/latex', version: '0.2.0' },
    ]);
  });

  it('serializes concurrent installs of the same plugin so neither deletes the other’s package', async () => {
    const events: string[] = [];
    mocks.tarExtract.mockImplementation(async ({ cwd }: { cwd: string }) => {
      events.push('extract:start');
      await wait(10);
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(manifest('0.2.0')));
      events.push('extract:end');
    });
    const release = {
      manifest: manifest('0.2.0'),
      artifact: {
        urls: ['https://plugins.example/arcbox-latex-0.2.0.tgz'],
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        format: 'tgz',
      },
    } satisfies LinkCodePluginRelease;
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    await Promise.all([
      store.install(release, 'linkcode-official'),
      store.install(release, 'linkcode-official'),
    ]);

    expect(events).toEqual(['extract:start', 'extract:end', 'extract:start', 'extract:end']);
    expect(existsSync(pluginPackageDir('arcbox/latex', '0.2.0'))).toBe(true);
    expect(JSON.parse(readFileSync(pluginRegistryPath(), 'utf8'))).toMatchObject([
      { id: 'arcbox/latex', version: '0.2.0' },
    ]);
  });

  it('uninstall prunes only its own secrets, even beside a dotted sibling id', async () => {
    const installed = record('0.1.0');
    writePackage(installed, settingsManifest('0.1.0'));
    const neighbour: InstalledLinkCodePlugin = {
      ...record('0.3.0'),
      // Dots are legal inside id segments, so `arcbox/latex.pro` is a real neighbour whose keys
      // would match a naive `arcbox/latex.` prefix; a corrupt manifest must not turn them into
      // prunable orphans either.
      id: 'arcbox/latex.pro',
      path: pluginPackageDir('arcbox/latex.pro', '0.3.0'),
    };
    writePackage(neighbour, '{broken');
    writeRegistry([installed, neighbour]);
    const vault = createInMemoryVault();
    const store = new DaemonLinkCodePluginStore(vault);
    await store.setSettings('arcbox/latex', {
      set: { account: 'a@example.com', authcode: 'secret-a' },
    });
    vault.namespace('plugin').set('arcbox/latex.pro/authcode', 'secret-b');

    await store.uninstall('arcbox/latex');

    const secrets = vault.namespace('plugin');
    expect(secrets.get('arcbox/latex/authcode')).toBeNull();
    expect(secrets.get('arcbox/latex.pro/authcode')).toBe('secret-b');
  });

  it('folds manifest defaults into settings that have no stored value', async () => {
    const installed = record('0.1.0');
    const withDefaults = settingsManifest('0.1.0');
    withDefaults.settings = {
      ...withDefaults.settings,
      preset: { type: 'enum', enum: ['163', 'qq'], default: '163' },
      limit: { type: 'number', default: 8000 },
      fallbacktoken: { type: 'password', secret: true, default: 'manifest-leak' },
    };
    writePackage(installed, withDefaults);
    writeRegistry([installed]);
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());
    await store.setSettings('arcbox/latex', { set: { account: 'a@example.com' } });

    // A secret field's default is a plaintext credential in the manifest — never folded in.
    expect(store.getSettings('arcbox/latex')).toEqual({
      account: 'a@example.com',
      preset: '163',
      limit: 8000,
    });
  });

  it('rolls back config and secret changes when the vault rejects a settings update', () => {
    const installed = record('0.1.0');
    writePackage(installed, settingsManifest('0.1.0'));
    writeRegistry([installed]);
    const baseVault = createInMemoryVault();
    const store = new DaemonLinkCodePluginStore(baseVault);
    store.setSettings('arcbox/latex', {
      set: { account: 'old@example.com', authcode: 'old-secret' },
    });
    const vaultFailure = new Error('vault unavailable');
    const flakyVault = {
      ...baseVault,
      namespace(name: Parameters<typeof baseVault.namespace>[0]) {
        const secrets = baseVault.namespace(name);
        if (name !== 'plugin') return secrets;
        return {
          ...secrets,
          set(key: string, value: string) {
            if (key === 'arcbox/latex/authcode' && value === 'new-secret') throw vaultFailure;
            secrets.set(key, value);
          },
        };
      },
    };

    expect(() =>
      new DaemonLinkCodePluginStore(flakyVault).setSettings('arcbox/latex', {
        set: { account: 'new@example.com', authcode: 'new-secret' },
      }),
    ).toThrow(vaultFailure);

    expect(store.getSettings('arcbox/latex')).toEqual({
      account: 'old@example.com',
      authcode: 'old-secret',
    });
  });
});
