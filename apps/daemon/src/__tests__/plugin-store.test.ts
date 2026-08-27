import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  InstalledLinkCodePlugin,
  LinkCodePluginManifest,
  LinkCodePluginRelease,
} from '@linkcode/schema';
import { wait } from 'foxts/wait';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPluginConfigValues } from '../config';
import {
  makePluginTmpDir,
  pluginPackageDir,
  pluginRegistryPath,
  pluginsRoot,
  pluginUninstallTombstonePath,
} from '../plugin-store/paths';
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

  it('applies an uninstall issued during an install after the install completes', async () => {
    // The install stalls in extraction; the uninstall must queue behind it, not race the
    // still-incomplete registry read and let the plugin come back after being removed.
    mocks.tarExtract.mockImplementation(async ({ cwd }: { cwd: string }) => {
      await wait(20);
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(manifest('0.2.0')));
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
      store.uninstall('arcbox/latex'),
    ]);

    expect(store.get('arcbox/latex')).toBeUndefined();
    expect(existsSync(pluginPackageDir('arcbox/latex', '0.2.0'))).toBe(false);
    expect(JSON.parse(readFileSync(pluginRegistryPath(), 'utf8'))).toEqual([]);
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
    // Both versions are really on disk, so the sweep must touch neither except the 0.2.0 restore.
    writePackage(legacy, manifest('0.1.0', 'legacy-skill'));
    writeRegistry([legacy, live]);
    const retired = join(live.path, '..', '.tmp-retired-999-versioned');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'manifest.json'), JSON.stringify(manifest('0.2.0', 'live-skill')));
    expect([existsSync(legacy.path), existsSync(live.path), existsSync(retired)]).toEqual([
      true,
      false,
      true,
    ]);

    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    expect([existsSync(legacy.path), existsSync(live.path), existsSync(retired)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('live-skill');
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

  it('blocks install and uninstall when the registry is malformed, leaving it untouched', async () => {
    const live = record('0.1.0');
    writePackage(live, manifest('0.1.0'));
    writeRegistry([live]);
    writeFileSync(pluginRegistryPath(), '{corrupted');
    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(manifest('0.2.0')));
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

    // A degraded read must never participate in an overwrite: both mutations fail closed.
    await expect(store.install(release, 'linkcode-official')).rejects.toThrow();
    await expect(store.uninstall('arcbox/latex')).rejects.toThrow();

    expect(readFileSync(pluginRegistryPath(), 'utf8')).toBe('{corrupted');
    expect(existsSync(pluginPackageDir('arcbox/latex', '0.2.0'))).toBe(false);
    expect(existsSync(live.path)).toBe(true);
  });

  it('refuses mutations when a registry record points outside the store', async () => {
    const escaped = { ...record('0.1.0'), path: join(dirname(pluginsRoot()), 'escaped-package') };
    mkdirSync(escaped.path, { recursive: true });
    writeFileSync(join(escaped.path, 'manifest.json'), JSON.stringify(manifest('0.1.0')));
    writeRegistry([escaped]);
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    // Reads degrade (the record is dropped); mutations fail closed and never touch the path.
    expect(store.list()).toEqual([]);
    await expect(store.uninstall('arcbox/latex')).rejects.toThrow('Invalid plugin install record');

    expect(existsSync(escaped.path)).toBe(true);
  });

  it('restores the retired package when the registry write fails during uninstall', async () => {
    const live = record('0.2.0');
    writePackage(live, manifest('0.2.0', 'live-skill'));
    writeRegistry([live]);
    mocks.renameFailureDestination = pluginRegistryPath();
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    await expect(store.uninstall('arcbox/latex')).rejects.toThrow('injected rename failure');

    expect(store.get('arcbox/latex')?.manifest.components[0]?.name).toBe('live-skill');
    expect(JSON.parse(readFileSync(pluginRegistryPath(), 'utf8'))).toMatchObject([
      { id: 'arcbox/latex', version: '0.2.0' },
    ]);
    expect(readdirSync(join(live.path, '..')).filter((name) => name.startsWith('.tmp-'))).toEqual(
      [],
    );
    expect(readdirSync(pluginsRoot()).filter((name) => name.startsWith('.uninstall-'))).toEqual([]);
  });

  it('retries a failed settings cleanup at boot via the uninstall marker', async () => {
    const installed = record('0.1.0');
    writePackage(installed, settingsManifest('0.1.0'));
    writeRegistry([installed]);
    const baseVault = createInMemoryVault();
    const store = new DaemonLinkCodePluginStore(baseVault);
    await store.setSettings('arcbox/latex', {
      set: { account: 'a@example.com', authcode: 'secret-a' },
    });
    let failReplaceAll = true;
    const flakyVault = {
      ...baseVault,
      namespace(name: Parameters<typeof baseVault.namespace>[0]) {
        const secrets = baseVault.namespace(name);
        if (name !== 'plugin') return secrets;
        return {
          ...secrets,
          replaceAll(entries: ReadonlyMap<string, string>) {
            if (failReplaceAll) {
              failReplaceAll = false;
              throw new Error('vault write failed');
            }
            secrets.replaceAll(entries);
          },
        };
      },
    };

    // The registry commits; the vault failure must not fail the uninstall — the marker retries.
    await new DaemonLinkCodePluginStore(flakyVault).uninstall('arcbox/latex');

    expect(store.get('arcbox/latex')).toBeUndefined();
    expect(loadPluginConfigValues('arcbox/latex')).toEqual({});
    expect(baseVault.refs.get('plugin:arcbox/latex/authcode')).toBe('secret-a');
    expect(existsSync(pluginUninstallTombstonePath('arcbox/latex'))).toBe(true);

    // Construction runs the boot sweep, which retries the cleanup and clears the marker.
    expect(new DaemonLinkCodePluginStore(baseVault)).toBeDefined();

    expect(baseVault.refs.get('plugin:arcbox/latex/authcode')).toBeUndefined();
    expect(existsSync(pluginUninstallTombstonePath('arcbox/latex'))).toBe(false);
  });

  it('rejects settings writes that violate the manifest field schemas', () => {
    const installed = record('0.1.0');
    writePackage(installed, settingsManifest('0.1.0'));
    writeRegistry([installed]);
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    expect(() => store.setSettings('arcbox/latex', { set: { account: 42 } })).toThrow(
      'Invalid value for plugin setting account',
    );
    expect(() => store.setSettings('arcbox/latex', { set: { nickname: 'x' } })).toThrow(
      'Unknown plugin setting: nickname',
    );
    // The UI contract never sends a blank secret ("blank = keep"); the daemon refuses to store one.
    expect(() => store.setSettings('arcbox/latex', { set: { authcode: '' } })).toThrow(
      'must not be an empty secret',
    );

    expect(store.getSettings('arcbox/latex')).toEqual({});
  });

  it('rejects a patch that leaves a required setting without any value', () => {
    const installed = record('0.1.0');
    const requiredManifest = settingsManifest('0.1.0');
    requiredManifest.settings = {
      ...requiredManifest.settings,
      account: { type: 'string', required: true },
      authcode: { type: 'password', secret: true, required: true },
    };
    writePackage(installed, requiredManifest);
    writeRegistry([installed]);
    const store = new DaemonLinkCodePluginStore(createInMemoryVault());

    // A blank secret is "keep" only when a value exists; nothing is stored yet.
    expect(() => store.setSettings('arcbox/latex', { set: { account: 'a@example.com' } })).toThrow(
      'Missing required plugin setting: authcode',
    );

    store.setSettings('arcbox/latex', {
      set: { account: 'a@example.com', authcode: 'secret-a' },
    });
    expect(() => store.setSettings('arcbox/latex', { remove: ['account'] })).toThrow(
      'Missing required plugin setting: account',
    );
  });

  it('reconciles stored settings against the new manifest on upgrade', async () => {
    // v0.1.0: plain + legacy in config.json, creds/quota/verbose/retained in the vault. v0.2.0
    // drops legacy, flips creds/quota/verbose to non-secret, turns plain into a secret password
    // field, and keeps retained a secret number.
    const v1: LinkCodePluginManifest = {
      ...manifest('0.1.0'),
      settings: {
        plain: { type: 'string' },
        legacy: { type: 'string' },
        creds: { type: 'password', secret: true },
        quota: { type: 'number', secret: true },
        verbose: { type: 'boolean', secret: true },
        retained: { type: 'number', secret: true },
      },
    };
    const v2: LinkCodePluginManifest = {
      ...manifest('0.2.0'),
      settings: {
        plain: { type: 'password', secret: true },
        creds: { type: 'string' },
        quota: { type: 'number' },
        verbose: { type: 'boolean' },
        retained: { type: 'number', secret: true },
      },
    };
    const installed = record('0.1.0');
    writePackage(installed, v1);
    writeRegistry([installed]);
    const vault = createInMemoryVault();
    const store = new DaemonLinkCodePluginStore(vault);
    await store.setSettings('arcbox/latex', {
      set: { plain: 'p', legacy: 'l', creds: 'c-value', quota: 42, verbose: true, retained: 7 },
    });
    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(v2));
    });
    const release = {
      manifest: v2,
      artifact: {
        urls: ['https://plugins.example/arcbox-latex-0.2.0.tgz'],
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        format: 'tgz',
      },
    } satisfies LinkCodePluginRelease;

    await store.install(release, 'linkcode-official');

    // non-secret → secret moved into the vault; a secret → non-secret flip drops the value rather
    // than migrating it into plaintext config.json, where the masked read would hand it back
    // unmasked — re-entry costs the user one field. The dropped/removed fields vanish from both.
    expect(loadPluginConfigValues('arcbox/latex')).toEqual({});
    expect(vault.refs.get('plugin:arcbox/latex/plain')).toBe('p');
    // A number secret that stays secret keeps its (stringified) vault value across the upgrade.
    expect(vault.refs.get('plugin:arcbox/latex/retained')).toBe('7');
    expect(vault.refs.get('plugin:arcbox/latex/creds')).toBeUndefined();
    expect(vault.refs.get('plugin:arcbox/latex/quota')).toBeUndefined();
    expect(vault.refs.get('plugin:arcbox/latex/verbose')).toBeUndefined();
    expect(vault.refs.get('plugin:arcbox/latex/legacy')).toBeUndefined();
    expect(store.getSettings('arcbox/latex')).toEqual({
      plain: 'p',
      retained: '7',
    });
  });

  it('purges settings inherited through a pending uninstall when reinstalling', async () => {
    // The uninstall committed (registry entry gone, marker kept) but its cleanup failed; a
    // reinstall must consume that marker instead of registering the id and letting the boot sweep
    // discard it unread with the old values still in place.
    const installed = record('0.2.0');
    writePackage(installed, settingsManifest('0.2.0'));
    writeRegistry([installed]);
    const baseVault = createInMemoryVault();
    let failReplaceAll = true;
    const flakyVault = {
      ...baseVault,
      namespace(name: Parameters<typeof baseVault.namespace>[0]) {
        const secrets = baseVault.namespace(name);
        if (name !== 'plugin') return secrets;
        return {
          ...secrets,
          replaceAll(entries: ReadonlyMap<string, string>) {
            if (failReplaceAll) {
              failReplaceAll = false;
              throw new Error('vault write failed');
            }
            secrets.replaceAll(entries);
          },
        };
      },
    };
    const store = new DaemonLinkCodePluginStore(flakyVault);
    await store.setSettings('arcbox/latex', {
      set: { account: 'stale@example.com', authcode: 'stale-secret' },
    });
    // The uninstall commits but its vault prune fails: the marker survives alongside the
    // unreaped secret while the plugin disappears from the registry.
    await new DaemonLinkCodePluginStore(flakyVault).uninstall('arcbox/latex');

    expect(existsSync(pluginUninstallTombstonePath('arcbox/latex'))).toBe(true);
    expect(baseVault.refs.get('plugin:arcbox/latex/authcode')).toBe('stale-secret');
    expect(store.get('arcbox/latex')).toBeUndefined();

    // Reinstall the same version while the marker is still pending.
    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(settingsManifest('0.2.0')));
    });
    const release = {
      manifest: settingsManifest('0.2.0'),
      artifact: {
        urls: ['https://plugins.example/arcbox-latex-0.2.0.tgz'],
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        format: 'tgz',
      },
    } satisfies LinkCodePluginRelease;
    const store2 = new DaemonLinkCodePluginStore(baseVault);
    await store2.install(release, 'linkcode-official');

    // The constructor sweep consumed the marker and purged the stale block; the fresh install
    // starts empty instead of inheriting the uninstalled plugin's values.
    expect(loadPluginConfigValues('arcbox/latex')).toEqual({});
    expect(baseVault.refs.get('plugin:arcbox/latex/authcode')).toBeUndefined();
    expect(existsSync(pluginUninstallTombstonePath('arcbox/latex'))).toBe(false);
  });

  it('aborts the reinstall when the install-time pending-uninstall purge fails', async () => {
    // One store per process is the production shape, so a same-instance uninstall→reinstall never
    // triggers the constructor sweep — the install-time purge is the only cleanup. If the vault is
    // still broken it must throw, leaving the id unregistered and the marker for the boot sweep,
    // rather than committing an install that inherits the uninstalled plugin's credentials.
    const installed = record('0.2.0');
    writePackage(installed, settingsManifest('0.2.0'));
    writeRegistry([installed]);
    const baseVault = createInMemoryVault();
    const brokenVault = {
      ...baseVault,
      namespace(name: Parameters<typeof baseVault.namespace>[0]) {
        const secrets = baseVault.namespace(name);
        if (name !== 'plugin') return secrets;
        return {
          ...secrets,
          replaceAll() {
            throw new Error('vault write failed');
          },
        };
      },
    };
    // Seed the secret through the working vault, then reuse a single broken-vault instance so the
    // uninstall's prune and the reinstall's purge both fail on the same instance.
    baseVault.namespace('plugin').replaceAll(new Map([['arcbox/latex/authcode', 'stale-secret']]));
    const store = new DaemonLinkCodePluginStore(brokenVault);
    await store.uninstall('arcbox/latex');

    expect(existsSync(pluginUninstallTombstonePath('arcbox/latex'))).toBe(true);
    expect(baseVault.refs.get('plugin:arcbox/latex/authcode')).toBe('stale-secret');

    mocks.tarExtract.mockImplementation(({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'manifest.json'), JSON.stringify(settingsManifest('0.2.0')));
    });
    const release = {
      manifest: settingsManifest('0.2.0'),
      artifact: {
        urls: ['https://plugins.example/arcbox-latex-0.2.0.tgz'],
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        format: 'tgz',
      },
    } satisfies LinkCodePluginRelease;

    await expect(store.install(release, 'linkcode-official')).rejects.toThrow(
      'Failed to purge settings for arcbox/latex before reinstall',
    );

    // Unregistered, marker kept, and the stale secret survives — exactly the state the boot sweep retries.
    expect(store.get('arcbox/latex')).toBeUndefined();
    expect(existsSync(pluginUninstallTombstonePath('arcbox/latex'))).toBe(true);
    expect(baseVault.refs.get('plugin:arcbox/latex/authcode')).toBe('stale-secret');
  });
});
