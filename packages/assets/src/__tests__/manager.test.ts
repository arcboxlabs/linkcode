import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetDescriptor } from '../catalog';
import type { AssetInstallEvent } from '../manager';
import { AssetManager } from '../manager';
import { assetDir } from '../paths';
import { currentPlatformKey } from '../platform';
import type { TgzFixture } from './helpers/fixtures';
import { makeTgz } from './helpers/fixtures';
import type { LocalServer } from './helpers/local-server';
import { startLocalServer } from './helpers/local-server';

const platform = currentPlatformKey();
if (!platform) throw new Error('tests require a catalog-supported platform');

const servers: LocalServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function freshStore(): void {
  vi.stubEnv('LINKCODE_ASSETS_DIR', mkdtempSync(join(tmpdir(), 'manager-store-')));
}

async function servedDescriptor(version: string): Promise<AssetDescriptor> {
  const fixture: TgzFixture = makeTgz('package/tool', `#!/bin/sh\necho ${version}\n`);
  const server = await startLocalServer((_req, res) => {
    res.end(fixture.bytes);
  });
  servers.push(server);
  return {
    id: 'tool:tectonic',
    binaryBase: 'tool',
    version: { kind: 'pinned', version },
    artifacts: {
      [platform!]: {
        kind: 'baked',
        url: `${server.url}/a.tgz`,
        integrity: fixture.integrity,
        size: fixture.bytes.length,
        member: 'package/tool',
        format: 'tgz',
      },
    },
  };
}

describe('AssetManager', () => {
  it('answers managed lookups synchronously once ensure() has installed', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    expect(manager.wantedVersionOf('tool:tectonic')).toBe('2.0.0');
    expect(manager.managedBinary('tool:tectonic')).toBeUndefined();

    const installed = await manager.ensure('tool:tectonic');
    expect(installed?.version).toBe('2.0.0');
    expect(manager.managedBinary('tool:tectonic')).toBe(installed?.path);
  });

  it('hasInstallOnDisk: consent survives a pin bump and a failed refresh, until the replacement lands', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    expect(manager.hasInstallOnDisk('tool:tectonic')).toBe(false);
    expect(manager.hasInstallOnDisk('agent:claude-code')).toBe(false); // not in this catalog

    // A .tmp-* orphan (aborted install) is not an install.
    mkdirSync(join(assetDir('tool:tectonic'), '.tmp-orphan'), { recursive: true });
    expect(manager.hasInstallOnDisk('tool:tectonic')).toBe(false);

    // Neither is a stray file (Finder's .DS_Store) — consent needs a version directory.
    writeFileSync(join(assetDir('tool:tectonic'), '.DS_Store'), '');
    expect(manager.hasInstallOnDisk('tool:tectonic')).toBe(false);

    await manager.ensure('tool:tectonic');
    expect(manager.hasInstallOnDisk('tool:tectonic')).toBe(true);

    // A pin bump keeps the superseded install through GC while 3.0.0 is not yet installed —
    // an offline refresh failure on the first post-upgrade boot must not erase consent.
    const bumped = new AssetManager({ catalog: [await servedDescriptor('3.0.0')] });
    bumped.gcAtBoot();
    expect(bumped.hasInstallOnDisk('tool:tectonic')).toBe(true);
    expect(existsSync(join(assetDir('tool:tectonic'), '2.0.0'))).toBe(true);

    // Once the replacement lands, the next GC sweeps the superseded version.
    await bumped.ensure('tool:tectonic');
    bumped.gcAtBoot();
    expect(existsSync(join(assetDir('tool:tectonic'), '2.0.0'))).toBe(false);
    expect(bumped.hasInstallOnDisk('tool:tectonic')).toBe(true);
  });

  it('gcAtBoot removes superseded versions and tmp orphans but keeps the wanted version', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    await manager.ensure('tool:tectonic');
    const dir = assetDir('tool:tectonic');
    mkdirSync(join(dir, '1.0.0'), { recursive: true });
    writeFileSync(join(dir, '1.0.0', 'tool'), 'old');
    mkdirSync(join(dir, '.tmp-orphan'), { recursive: true });

    const report = manager.gcAtBoot();
    expect(report.removed.sort()).toEqual([join(dir, '.tmp-orphan'), join(dir, '1.0.0')]);
    expect(existsSync(join(dir, '2.0.0'))).toBe(true);
  });

  it('gcAtBoot skips an uninspectable asset path and continues with later assets', () => {
    freshStore();
    const catalog = (['agent:claude-code', 'agent:opencode', 'agent:codex'] as const).map((id) => ({
      id,
      binaryBase: 'tool',
      version: { kind: 'pinned' as const, version: '2.0.0' },
      artifacts: {},
    }));
    const manager = new AssetManager({ catalog });
    const blocked = assetDir('agent:claude-code');
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, 'not a directory');
    // The wanted 2.0.0 is not installed, so the stale version survives (consent, CODE-221)
    // while the tmp orphan still goes.
    const stale = join(assetDir('agent:codex'), '1.0.0');
    mkdirSync(stale, { recursive: true });
    const orphan = join(assetDir('agent:codex'), '.tmp-orphan');
    mkdirSync(orphan, { recursive: true });

    expect(manager.gcAtBoot()).toEqual({ removed: [orphan], skipped: [blocked] });
    expect(existsSync(stale)).toBe(true);
  });

  it('leaves unpinnable assets alone: ensure() is undefined and GC does not touch their dirs', async () => {
    freshStore();
    const unpinnable: AssetDescriptor = {
      id: 'agent:opencode',
      binaryBase: 'opencode',
      version: { kind: 'sdk-version', package: 'absent-sdk' },
      artifacts: {},
    };
    const anchor = join(mkdtempSync(join(tmpdir(), 'no-sdk-')), 'anchor.js');
    writeFileSync(anchor, '');
    const manager = new AssetManager({ catalog: [unpinnable], pinFrom: anchor });

    const dir = assetDir('agent:opencode');
    mkdirSync(join(dir, '9.9.9'), { recursive: true });
    await expect(manager.ensure('agent:opencode')).resolves.toBeUndefined();
    expect(manager.managedBinary('agent:opencode')).toBeUndefined();
    expect(manager.gcAtBoot()).toEqual({ removed: [], skipped: [] });
    expect(existsSync(join(dir, '9.9.9'))).toBe(true);
  });

  it('needsRepair flags an installed version missing newly declared extra members', async () => {
    freshStore();
    const bare = await servedDescriptor('2.0.0');
    const manager = new AssetManager({ catalog: [bare] });
    // Not installed at all: repair must never turn into an unprompted first download.
    expect(manager.needsRepair('tool:tectonic')).toBe(false);

    await manager.ensure('tool:tectonic');
    expect(manager.needsRepair('tool:tectonic')).toBe(false);

    // The same install read under a catalog that now expects an extra member.
    const withExtra: AssetDescriptor = {
      ...bare,
      artifacts: {
        [platform]: {
          ...bare.artifacts[platform]!,
          extraMembers: ['package/resources/helper'],
        },
      },
    };
    expect(new AssetManager({ catalog: [withExtra] }).needsRepair('tool:tectonic')).toBe(true);
  });

  it('fans install lifecycle out to subscribers: progress, then installed', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    const events: AssetInstallEvent[] = [];
    manager.subscribe((event) => events.push(event));

    const installed = await manager.ensure('tool:tectonic');

    const progress = events.filter((event) => event.kind === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toMatchObject({ id: 'tool:tectonic' });
    expect(progress.at(-1)?.receivedBytes).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ kind: 'installed', id: 'tool:tectonic', installed });
  });

  it('emits failed (and keeps the caller rejection) when the install cannot complete', async () => {
    freshStore();
    const descriptor = await servedDescriptor('2.0.0');
    const broken: AssetDescriptor = {
      ...descriptor,
      artifacts: {
        [platform]: {
          ...descriptor.artifacts[platform]!,
          integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        },
      },
    };
    const manager = new AssetManager({ catalog: [broken], retry: 0 });
    const events: AssetInstallEvent[] = [];
    manager.subscribe((event) => events.push(event));

    await expect(manager.ensure('tool:tectonic')).rejects.toThrow();
    const last = events.at(-1);
    expect(last?.kind).toBe('failed');
    expect(last && 'error' in last && last.error.length > 0).toBe(true);
  });

  it('stops notifying after unsubscribe', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    const events: AssetInstallEvent[] = [];
    const unsubscribe = manager.subscribe((event) => events.push(event));
    unsubscribe();

    await manager.ensure('tool:tectonic');
    expect(events).toEqual([]);
  });
});
