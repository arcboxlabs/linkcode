import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { managedAgentAssetId, managedToolAssetId } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BinaryAssetDescriptor, NpmClosureAssetDescriptor } from '../../src/catalog';
import type { AssetInstallEvent } from '../../src/manager';
import { AssetManager } from '../../src/manager';
import { assetDir } from '../../src/paths';
import { currentPlatformKey } from '../../src/platform';
import type { TgzFixture } from '../support/fixtures';
import { makeTgz } from '../support/fixtures';
import type { LocalServer } from '../support/local-server';
import { startLocalServer } from '../support/local-server';

const platform = currentPlatformKey();
if (!platform) throw new Error('tests require a catalog-supported platform');

const CLAUDE_CODE_ID = managedAgentAssetId('claude-code');
const CODEX_ID = managedAgentAssetId('codex');
const OPENCODE_ID = managedAgentAssetId('opencode');
const PI_ID = managedAgentAssetId('pi');
const TECTONIC_ID = managedToolAssetId('tectonic');

const servers: LocalServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function freshStore(): void {
  vi.stubEnv('LINKCODE_ASSETS_DIR', mkdtempSync(join(tmpdir(), 'manager-store-')));
}

async function servedDescriptor(version: string): Promise<BinaryAssetDescriptor> {
  const fixture: TgzFixture = makeTgz('package/tool', `#!/bin/sh\necho ${version}\n`);
  const server = await startLocalServer((_req, res) => {
    res.end(fixture.bytes);
  });
  servers.push(server);
  return {
    id: TECTONIC_ID,
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

function closureDescriptor(sdkPackage = 'fake-pi-sdk'): NpmClosureAssetDescriptor {
  return {
    id: PI_ID,
    version: { kind: 'sdk-version', package: sdkPackage },
    closure: { version: '1.0.0', entry: 'node_modules/fake-pi-sdk/index.js', packages: [] },
  };
}

/** A pinFrom anchor whose node_modules holds the given packages. */
function anchorWith(packages: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'closure-pin-'));
  for (const [name, version] of Object.entries(packages)) {
    const dir = join(root, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  }
  const anchor = join(root, 'anchor.js');
  writeFileSync(anchor, '');
  return anchor;
}

describe('AssetManager closure pins (CODE-219)', () => {
  it('falls back to the manifest version when the SDK is not resolvable (packaged hosts)', () => {
    freshStore();
    const manager = new AssetManager({
      catalog: [closureDescriptor()],
      pinFrom: anchorWith({}),
    });
    expect(manager.wantedVersionOf(PI_ID)).toBe('1.0.0');
  });

  it('agrees with a resolvable SDK pin that matches the manifest (dev hosts)', () => {
    freshStore();
    const manager = new AssetManager({
      catalog: [closureDescriptor()],
      pinFrom: anchorWith({ 'fake-pi-sdk': '1.0.0' }),
    });
    expect(manager.wantedVersionOf(PI_ID)).toBe('1.0.0');
  });

  it('reads a mismatching SDK pin as a stale manifest: unpinnable, GC hands off', () => {
    freshStore();
    const manager = new AssetManager({
      catalog: [closureDescriptor()],
      pinFrom: anchorWith({ 'fake-pi-sdk': '2.0.0' }),
    });
    expect(manager.wantedVersionOf(PI_ID)).toBeUndefined();
    const stale = join(assetDir(PI_ID), '0.9.0');
    mkdirSync(stale, { recursive: true });
    expect(manager.gcAtBoot()).toEqual({ removed: [], skipped: [] });
    expect(existsSync(stale)).toBe(true);
  });

  it('managedEntry answers for installed closures; managedBinary never does', () => {
    freshStore();
    const manager = new AssetManager({ catalog: [closureDescriptor()], pinFrom: anchorWith({}) });
    expect(manager.managedBinary(PI_ID)).toBeUndefined();
    expect(manager.managedEntry(PI_ID)).toBeUndefined();

    const entry = join(assetDir(PI_ID), '1.0.0', 'node_modules', 'fake-pi-sdk', 'index.js');
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, '');
    expect(manager.managedEntry(PI_ID)).toBe(entry);
    expect(manager.managedBinary(PI_ID)).toBeUndefined();
  });
});

describe('AssetManager', () => {
  it('answers managed lookups synchronously once ensure() has installed', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    expect(manager.wantedVersionOf(TECTONIC_ID)).toBe('2.0.0');
    expect(manager.managedBinary(TECTONIC_ID)).toBeUndefined();

    const installed = await manager.ensure(TECTONIC_ID);
    expect(installed?.version).toBe('2.0.0');
    expect(manager.managedBinary(TECTONIC_ID)).toBe(installed?.path);
  });

  it('hasInstallOnDisk: consent survives a pin bump and a failed refresh, until the replacement lands', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    expect(manager.hasInstallOnDisk(TECTONIC_ID)).toBe(false);
    expect(manager.hasInstallOnDisk(CLAUDE_CODE_ID)).toBe(false); // not in this catalog

    // A .tmp-* orphan (aborted install) is not an install.
    mkdirSync(join(assetDir(TECTONIC_ID), '.tmp-orphan'), {
      recursive: true,
    });
    expect(manager.hasInstallOnDisk(TECTONIC_ID)).toBe(false);

    // Neither is a stray file (Finder's .DS_Store) — consent needs a version directory.
    writeFileSync(join(assetDir(TECTONIC_ID), '.DS_Store'), '');
    expect(manager.hasInstallOnDisk(TECTONIC_ID)).toBe(false);

    await manager.ensure(TECTONIC_ID);
    expect(manager.hasInstallOnDisk(TECTONIC_ID)).toBe(true);

    // A pin bump keeps the superseded install through GC while 3.0.0 is not yet installed —
    // an offline refresh failure on the first post-upgrade boot must not erase consent.
    const bumped = new AssetManager({ catalog: [await servedDescriptor('3.0.0')] });
    bumped.gcAtBoot();
    expect(bumped.hasInstallOnDisk(TECTONIC_ID)).toBe(true);
    expect(existsSync(join(assetDir(TECTONIC_ID), '2.0.0'))).toBe(true);

    // Once the replacement lands, the next GC sweeps the superseded version.
    await bumped.ensure(TECTONIC_ID);
    bumped.gcAtBoot();
    expect(existsSync(join(assetDir(TECTONIC_ID), '2.0.0'))).toBe(false);
    expect(bumped.hasInstallOnDisk(TECTONIC_ID)).toBe(true);
  });

  it('gcAtBoot removes superseded versions and tmp orphans but keeps the wanted version', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    await manager.ensure(TECTONIC_ID);
    const dir = assetDir(TECTONIC_ID);
    mkdirSync(join(dir, '1.0.0'), { recursive: true });
    writeFileSync(join(dir, '1.0.0', 'tool'), 'old');
    mkdirSync(join(dir, '.tmp-orphan'), { recursive: true });

    const report = manager.gcAtBoot();
    expect(report.removed.sort()).toEqual([join(dir, '.tmp-orphan'), join(dir, '1.0.0')]);
    expect(existsSync(join(dir, '2.0.0'))).toBe(true);
  });

  it('gcAtBoot skips an uninspectable asset path and continues with later assets', () => {
    freshStore();
    const catalog = ([CLAUDE_CODE_ID, OPENCODE_ID, CODEX_ID] as const).map((id) => ({
      id,
      binaryBase: 'tool',
      version: { kind: 'pinned' as const, version: '2.0.0' },
      artifacts: {},
    }));
    const manager = new AssetManager({ catalog });
    const blocked = assetDir(CLAUDE_CODE_ID);
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, 'not a directory');
    // The wanted 2.0.0 is not installed, so the stale version survives (consent, CODE-221)
    // while the tmp orphan still goes.
    const stale = join(assetDir(CODEX_ID), '1.0.0');
    mkdirSync(stale, { recursive: true });
    const orphan = join(assetDir(CODEX_ID), '.tmp-orphan');
    mkdirSync(orphan, { recursive: true });

    expect(manager.gcAtBoot()).toEqual({ removed: [orphan], skipped: [blocked] });
    expect(existsSync(stale)).toBe(true);
  });

  it('leaves unpinnable assets alone: ensure() is undefined and GC does not touch their dirs', async () => {
    freshStore();
    const unpinnable: BinaryAssetDescriptor = {
      id: OPENCODE_ID,
      binaryBase: 'opencode',
      version: { kind: 'sdk-version', package: 'absent-sdk' },
      artifacts: {},
    };
    const anchor = join(mkdtempSync(join(tmpdir(), 'no-sdk-')), 'anchor.js');
    writeFileSync(anchor, '');
    const manager = new AssetManager({ catalog: [unpinnable], pinFrom: anchor });

    const dir = assetDir(OPENCODE_ID);
    mkdirSync(join(dir, '9.9.9'), { recursive: true });
    await expect(manager.ensure(OPENCODE_ID)).resolves.toBeUndefined();
    expect(manager.managedBinary(OPENCODE_ID)).toBeUndefined();
    expect(manager.gcAtBoot()).toEqual({ removed: [], skipped: [] });
    expect(existsSync(join(dir, '9.9.9'))).toBe(true);
  });

  it('needsRepair flags an installed version missing newly declared extra members', async () => {
    freshStore();
    const bare = await servedDescriptor('2.0.0');
    const manager = new AssetManager({ catalog: [bare] });
    // Not installed at all: repair must never turn into an unprompted first download.
    expect(manager.needsRepair(TECTONIC_ID)).toBe(false);

    await manager.ensure(TECTONIC_ID);
    expect(manager.needsRepair(TECTONIC_ID)).toBe(false);

    // The same install read under a catalog that now expects an extra member.
    const withExtra: BinaryAssetDescriptor = {
      ...bare,
      artifacts: {
        [platform]: {
          ...bare.artifacts[platform]!,
          extraMembers: ['package/resources/helper'],
        },
      },
    };
    expect(new AssetManager({ catalog: [withExtra] }).needsRepair(TECTONIC_ID)).toBe(true);
  });

  it('fans install lifecycle out to subscribers: progress, then installed', async () => {
    freshStore();
    const manager = new AssetManager({ catalog: [await servedDescriptor('2.0.0')] });
    const events: AssetInstallEvent[] = [];
    manager.subscribe((event) => events.push(event));

    const installed = await manager.ensure(TECTONIC_ID);

    const progress = events.filter((event) => event.kind === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toMatchObject({ id: TECTONIC_ID });
    expect(progress.at(-1)?.receivedBytes).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({
      kind: 'installed',
      id: TECTONIC_ID,
      installed,
    });
  });

  it('emits failed (and keeps the caller rejection) when the install cannot complete', async () => {
    freshStore();
    const descriptor = await servedDescriptor('2.0.0');
    const broken: BinaryAssetDescriptor = {
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

    await expect(manager.ensure(TECTONIC_ID)).rejects.toThrow();
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

    await manager.ensure(TECTONIC_ID);
    expect(events).toEqual([]);
  });
});
