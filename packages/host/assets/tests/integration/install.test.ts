import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { managedToolAssetId } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetDescriptor } from '../../src/catalog';
import { IntegrityError } from '../../src/errors';
import { installAsset, installedComplete, installedPath } from '../../src/install';
import { assetDir } from '../../src/paths';
import { currentPlatformKey } from '../../src/platform';
import type { TgzFixture } from '../support/fixtures';
import { makeTgz } from '../support/fixtures';
import type { LocalServer } from '../support/local-server';
import { startLocalServer } from '../support/local-server';

const platform = currentPlatformKey();
if (!platform) throw new Error('tests require a catalog-supported platform');

const AIGATEWAY_ID = managedToolAssetId('aigateway');
const TECTONIC_ID = managedToolAssetId('tectonic');
const servers: LocalServer[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(fixture: TgzFixture): Promise<LocalServer> {
  const server = await startLocalServer((_req, res) => {
    res.end(fixture.bytes);
  });
  servers.push(server);
  return server;
}

function descriptor(
  url: string,
  integrity: string,
  size: number,
  extraMembers?: string[],
  id: AssetDescriptor['id'] = TECTONIC_ID,
): AssetDescriptor {
  return {
    id,
    binaryBase: 'tool',
    version: { kind: 'pinned', version: '1.0.0' },
    artifacts: {
      [platform!]: {
        kind: 'baked',
        url,
        integrity,
        size,
        member: 'package/tool',
        extraMembers,
        format: 'tgz',
      },
    },
  };
}

function freshStore(): void {
  vi.stubEnv('LINKCODE_ASSETS_DIR', mkdtempSync(join(tmpdir(), 'store-')));
}

describe('installAsset', () => {
  it('downloads, verifies, extracts, and publishes atomically to the canonical path', async () => {
    freshStore();
    const fixture = makeTgz('package/tool', '#!/bin/sh\necho tool\n');
    const server = await serve(fixture);
    const spec = descriptor(`${server.url}/a.tgz`, fixture.integrity, fixture.bytes.length);

    const installed = await installAsset(spec, '1.0.0');
    expect(installed.path).toBe(join(assetDir(TECTONIC_ID), '1.0.0', 'tool'));
    expect(readFileSync(installed.path, 'utf8')).toContain('echo tool');
    expect(statSync(installed.path).mode & 0o111).not.toBe(0);
    expect(installedPath(spec, '1.0.0')).toBe(installed.path);
    expect(readdirSync(assetDir(TECTONIC_ID))).toEqual(['1.0.0']);
  });

  it('short-circuits when the version is already installed — zero network', async () => {
    freshStore();
    const fixture = makeTgz('package/tool', 'v1');
    const server = await serve(fixture);
    const spec = descriptor(`${server.url}/a.tgz`, fixture.integrity, fixture.bytes.length);

    await installAsset(spec, '1.0.0');
    const requestsAfterFirst = server.requests.length;
    await installAsset(spec, '1.0.0');
    expect(server.requests.length).toBe(requestsAfterFirst);
  });

  it('deduplicates concurrent installs of the same id and version', async () => {
    freshStore();
    const fixture = makeTgz('package/tool', 'concurrent');
    const server = await serve(fixture);
    const spec = descriptor(`${server.url}/a.tgz`, fixture.integrity, fixture.bytes.length);

    const [a, b] = await Promise.all([installAsset(spec, '1.0.0'), installAsset(spec, '1.0.0')]);
    expect(a.path).toBe(b.path);
    expect(server.requests).toHaveLength(1);
  });

  it('does not deduplicate different assets that share a version', async () => {
    freshStore();
    const fixture = makeTgz('package/tool', 'concurrent');
    const tectonicServer = await serve(fixture);
    const gatewayServer = await serve(fixture);
    const tectonic = descriptor(
      `${tectonicServer.url}/a.tgz`,
      fixture.integrity,
      fixture.bytes.length,
    );
    const gateway = descriptor(
      `${gatewayServer.url}/a.tgz`,
      fixture.integrity,
      fixture.bytes.length,
      undefined,
      AIGATEWAY_ID,
    );

    const [tectonicInstall, gatewayInstall] = await Promise.all([
      installAsset(tectonic, '1.0.0'),
      installAsset(gateway, '1.0.0'),
    ]);

    expect(tectonicInstall.id).toBe('tool:tectonic');
    expect(gatewayInstall.id).toBe('tool:aigateway');
    expect(tectonicServer.requests).toHaveLength(1);
    expect(gatewayServer.requests).toHaveLength(1);
  });

  it('extracts extra members as executable siblings under their basenames', async () => {
    freshStore();
    const fixture = makeTgz('package/tool', 'main', {
      'package/resources/helper-a': 'ha',
      'package/resources/helper-b': 'hb',
    });
    const server = await serve(fixture);
    const spec = descriptor(`${server.url}/a.tgz`, fixture.integrity, fixture.bytes.length, [
      'package/resources/helper-a',
      'package/resources/helper-b',
    ]);

    const installed = await installAsset(spec, '1.0.0');
    const dir = dirname(installed.path);
    expect(readdirSync(dir).sort()).toEqual(['helper-a', 'helper-b', 'tool']);
    expect(readFileSync(join(dir, 'helper-a'), 'utf8')).toBe('ha');
    expect(statSync(join(dir, 'helper-a')).mode & 0o111).not.toBe(0);
    expect(installedComplete(spec, '1.0.0')).toBe(true);
  });

  it('backfills only the missing extra members into an install made under an older catalog', async () => {
    freshStore();
    const bare = makeTgz('package/tool', 'v1');
    const bareServer = await serve(bare);
    await installAsset(
      descriptor(`${bareServer.url}/a.tgz`, bare.integrity, bare.bytes.length),
      '1.0.0',
    );

    const full = makeTgz('package/tool', 'v1-refetched', { 'package/resources/helper': 'helper' });
    const fullServer = await serve(full);
    const spec = descriptor(`${fullServer.url}/a.tgz`, full.integrity, full.bytes.length, [
      'package/resources/helper',
    ]);
    expect(installedComplete(spec, '1.0.0')).toBe(false);

    const installed = await installAsset(spec, '1.0.0');
    expect(readFileSync(join(dirname(installed.path), 'helper'), 'utf8')).toBe('helper');
    // The already-present executable is never replaced — it may be running.
    expect(readFileSync(installed.path, 'utf8')).toBe('v1');
    expect(installedComplete(spec, '1.0.0')).toBe(true);

    // Once complete, the short-circuit is back: zero network.
    const requestsAfterBackfill = fullServer.requests.length;
    await installAsset(spec, '1.0.0');
    expect(fullServer.requests.length).toBe(requestsAfterBackfill);
  });

  it('rejects tampered artifacts and leaves neither a version dir nor tmp litter', async () => {
    freshStore();
    const fixture = makeTgz('package/tool', 'good');
    const tampered = makeTgz('package/tool', 'evil');
    const server = await serve(tampered);
    const spec = descriptor(`${server.url}/a.tgz`, fixture.integrity, fixture.bytes.length);

    await expect(installAsset(spec, '1.0.0')).rejects.toThrow(IntegrityError);
    expect(installedPath(spec, '1.0.0')).toBeUndefined();
    expect(readdirSync(assetDir(TECTONIC_ID))).toEqual([]);
  });
});
