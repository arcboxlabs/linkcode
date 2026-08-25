import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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
  removeFailurePrefix: undefined as string | undefined,
  renameFailureDestination: undefined as string | undefined,
  renameFailureSource: undefined as string | undefined,
}));

vi.mock('@linkcode/assets', () => ({ downloadVerified: mocks.downloadVerified }));
vi.mock('tar', () => ({ extract: mocks.tarExtract }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync(source: import('node:fs').PathLike, destination: import('node:fs').PathLike): void {
      if (source === mocks.renameFailureSource || destination === mocks.renameFailureDestination) {
        throw Object.assign(new Error('injected rename failure'), { code: 'EACCES' });
      }
      actual.renameSync(source, destination);
    },
    rmSync(...args: Parameters<typeof actual.rmSync>): void {
      const [path] = args;
      if (
        typeof path === 'string' &&
        mocks.removeFailurePrefix !== undefined &&
        path.startsWith(mocks.removeFailurePrefix)
      ) {
        throw Object.assign(new Error('injected remove failure'), { code: 'EACCES' });
      }
      actual.rmSync(...args);
    },
  };
});

let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-plugin-store-'));
  process.env.LINKCODE_CHANNEL = 'release';
  mocks.downloadVerified.mockReset().mockResolvedValue(undefined);
  mocks.tarExtract.mockReset();
  mocks.removeFailurePrefix = undefined;
  mocks.renameFailureDestination = undefined;
  mocks.renameFailureSource = undefined;
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

  it('keeps the live package and registry intact when a reinstall fails before publishing', async () => {
    const live = record('0.2.0');
    writePackage(live, manifest('0.2.0', 'live-skill'));
    writeRegistry([live]);
    // A staged package that fails the id/version check: the common failure shape (download, extract,
    // or manifest mismatch) must never touch the live package, and must leave no staging sibling.
    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(manifest('9.9.9', 'staged-skill')));
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

    await expect(store.install(release, 'linkcode-official')).rejects.toThrow();

    expect(existsSync(live.path)).toBe(true);
    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('live-skill');
    expect(JSON.parse(readFileSync(pluginRegistryPath(), 'utf8'))).toMatchObject([
      { id: 'arcbox/latex', version: '0.2.0' },
    ]);
    const siblings = readdirSync(join(live.path, '..'));
    expect(siblings.filter((name) => name.startsWith('.tmp-'))).toEqual([]);
  });

  it('commits the install when retired-package cleanup fails', async () => {
    const live = record('0.2.0');
    writePackage(live, manifest('0.2.0', 'live-skill'));
    writeRegistry([live]);
    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(manifest('0.2.0', 'new-skill')));
    });
    mocks.removeFailurePrefix = join(live.path, '..', '.tmp-retired-');
    const release = {
      manifest: manifest('0.2.0'),
      artifact: {
        urls: ['https://plugins.example/arcbox-latex-0.2.0.tgz'],
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        format: 'tgz',
      },
    } satisfies LinkCodePluginRelease;
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    await expect(store.install(release, 'linkcode-official')).resolves.toMatchObject({
      installed: { version: '0.2.0' },
    });

    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('new-skill');
    expect(
      readdirSync(join(live.path, '..')).some((name) => name.startsWith('.tmp-retired-')),
    ).toBe(true);
  });

  it('restores the live package when registry persistence fails after publishing', async () => {
    const live = record('0.2.0');
    writePackage(live, manifest('0.2.0', 'live-skill'));
    writeRegistry([live]);
    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(manifest('0.2.0', 'new-skill')));
    });
    mocks.renameFailureDestination = pluginRegistryPath();
    const release = {
      manifest: manifest('0.2.0'),
      artifact: {
        urls: ['https://plugins.example/arcbox-latex-0.2.0.tgz'],
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        format: 'tgz',
      },
    } satisfies LinkCodePluginRelease;
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    await expect(store.install(release, 'linkcode-official')).rejects.toThrow(
      'injected rename failure',
    );

    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('live-skill');
    expect(JSON.parse(readFileSync(pluginRegistryPath(), 'utf8'))).toMatchObject([
      { id: 'arcbox/latex', version: '0.2.0' },
    ]);
    expect(readdirSync(join(live.path, '..')).filter((name) => name.startsWith('.tmp-'))).toEqual(
      [],
    );
  });

  it('sweeps orphaned staging directories at construction', () => {
    const live = record('0.1.0');
    writePackage(live, manifest('0.1.0'));
    writeRegistry([live]);
    const orphan = join(live.path, '..', '.tmp-999-0.1.0-abandoned');
    mkdirSync(orphan, { recursive: true });

    // Construction runs the sweep; the store handle itself is unused here.
    expect(new DaemonLinkCodePluginStore(createInMemoryVault())).toBeDefined();

    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(live.path)).toBe(true);
  });

  it('promotes a retired package back when a hard kill left it as the only copy', () => {
    // A hard kill between retire and publish leaves this as the registry's only live copy.
    const live = record('0.1.0');
    writeRegistry([live]);
    const retired = join(live.path, '..', '.tmp-retired-999-abandoned');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'manifest.json'), JSON.stringify(manifest('0.1.0', 'live-skill')));
    expect(existsSync(live.path)).toBe(false);

    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    expect(existsSync(retired)).toBe(false);
    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('live-skill');
  });

  it('restores a retired package only to its exact recorded version', () => {
    const legacy = record('0.1.0');
    const live = record('0.2.0');
    writeRegistry([legacy, live]);
    const retired = join(live.path, '..', '.tmp-retired-999-versioned');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'manifest.json'), JSON.stringify(manifest('0.2.0', 'live-skill')));
    expect([existsSync(legacy.path), existsSync(live.path), existsSync(retired)]).toEqual([
      false,
      false,
      true,
    ]);

    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    expect([existsSync(legacy.path), existsSync(live.path), existsSync(retired)]).toEqual([
      false,
      true,
      false,
    ]);
    expect(store.get('arcbox/latex')?.installed.version).toBe('0.2.0');
  });

  it('keeps a retired package when restoring it fails', () => {
    const live = record('0.1.0');
    writeRegistry([live]);
    const retired = join(live.path, '..', '.tmp-retired-999-unrestored');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'manifest.json'), JSON.stringify(manifest('0.1.0', 'live-skill')));
    mocks.renameFailureSource = retired;

    expect(new DaemonLinkCodePluginStore(createInMemoryVault())).toBeDefined();

    expect(existsSync(retired)).toBe(true);
    expect(existsSync(live.path)).toBe(false);
  });

  it('keeps a retired package when its target is occupied by a different package', () => {
    const live = record('0.1.0');
    writePackage(live, manifest('9.9.9', 'unexpected-skill'));
    writeRegistry([live]);
    const retired = join(live.path, '..', '.tmp-retired-999-conflict');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'manifest.json'), JSON.stringify(manifest('0.1.0', 'live-skill')));

    expect(new DaemonLinkCodePluginStore(createInMemoryVault())).toBeDefined();

    expect(existsSync(retired)).toBe(true);
    expect(readFileSync(join(live.path, 'manifest.json'), 'utf8')).toContain('9.9.9');
  });

  it('deletes a retired sibling once its version dir is already back in place', () => {
    // Once the exact published package is present, the retired copy is redundant.
    const live = record('0.1.0');
    writePackage(live, manifest('0.1.0', 'published-skill'));
    writeRegistry([live]);
    const retired = join(live.path, '..', '.tmp-retired-999-stale');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'manifest.json'), JSON.stringify(manifest('0.1.0', 'old-skill')));

    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    expect(existsSync(retired)).toBe(false);
    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('published-skill');
  });

  it('uninstall prunes only its own secrets, even beside a dotted sibling id', async () => {
    const installed = record('0.1.0');
    writePackage(installed, settingsManifest('0.1.0'));
    const neighbour: InstalledLinkCodePlugin = {
      ...record('0.3.0'),
      // Dots are legal in ids, so this neighbour matches a naive `arcbox/latex.` secret prefix.
      // Its corrupt manifest must not make those secrets look orphaned either.
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
