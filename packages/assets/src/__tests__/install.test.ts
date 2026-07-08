import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetDescriptor } from '../catalog';
import { IntegrityError } from '../errors';
import { installAsset, installedPath } from '../install';
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

async function serve(fixture: TgzFixture): Promise<LocalServer> {
  const server = await startLocalServer((_req, res) => {
    res.end(fixture.bytes);
  });
  servers.push(server);
  return server;
}

function descriptor(url: string, integrity: string, size: number): AssetDescriptor {
  return {
    id: 'tool:tectonic',
    binaryBase: 'tool',
    version: { kind: 'pinned', version: '1.0.0' },
    artifacts: {
      [platform!]: { kind: 'baked', url, integrity, size, member: 'package/tool', format: 'tgz' },
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
    expect(installed.path).toBe(join(assetDir('tool:tectonic'), '1.0.0', 'tool'));
    expect(readFileSync(installed.path, 'utf8')).toContain('echo tool');
    expect(statSync(installed.path).mode & 0o111).not.toBe(0);
    expect(installedPath(spec, '1.0.0')).toBe(installed.path);
    expect(readdirSync(assetDir('tool:tectonic'))).toEqual(['1.0.0']);
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

  it('rejects tampered artifacts and leaves neither a version dir nor tmp litter', async () => {
    freshStore();
    const fixture = makeTgz('package/tool', 'good');
    const tampered = makeTgz('package/tool', 'evil');
    const server = await serve(tampered);
    const spec = descriptor(`${server.url}/a.tgz`, fixture.integrity, fixture.bytes.length);

    await expect(installAsset(spec, '1.0.0')).rejects.toThrow(IntegrityError);
    expect(installedPath(spec, '1.0.0')).toBeUndefined();
    expect(readdirSync(assetDir('tool:tectonic'))).toEqual([]);
  });
});
