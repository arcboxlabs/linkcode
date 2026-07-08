import { afterEach, describe, expect, it } from 'vitest';
import { DownloadError } from '../errors';
import { fetchNpmDist } from '../registry-client';
import type { LocalServer } from './helpers/local-server';
import { startLocalServer } from './helpers/local-server';

const servers: LocalServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function registry(handler: Parameters<typeof startLocalServer>[0]): Promise<LocalServer> {
  const server = await startLocalServer(handler);
  servers.push(server);
  return server;
}

const dist = { tarball: 'https://example.test/pkg-1.0.0.tgz', integrity: 'sha512-abc' };

describe('fetchNpmDist', () => {
  it('resolves dist from the single-version manifest, keeping scoped names unencoded', async () => {
    const server = await registry((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ dist }));
    });
    await expect(
      fetchNpmDist('@scope/pkg', '1.0.0', { registries: [server.url], retry: 0 }),
    ).resolves.toEqual(dist);
    expect(server.requests).toEqual(['/@scope/pkg/1.0.0']);
  });

  it('falls through to the next registry on HTTP errors and network failures', async () => {
    const failing = await registry((_req, res) => {
      res.statusCode = 404;
      res.end('not found');
    });
    const good = await registry((_req, res) => {
      res.end(JSON.stringify({ dist }));
    });
    const unreachable = 'http://127.0.0.1:1';
    await expect(
      fetchNpmDist('pkg', '1.0.0', { registries: [unreachable, failing.url, good.url], retry: 0 }),
    ).resolves.toEqual(dist);
  });

  it('treats a malformed manifest as a source failure', async () => {
    const malformed = await registry((_req, res) => {
      res.end(JSON.stringify({ dist: { tarball: '' } }));
    });
    await expect(
      fetchNpmDist('pkg', '1.0.0', { registries: [malformed.url], retry: 0 }),
    ).rejects.toThrow(DownloadError);
  });

  it('reports every attempted source when all registries fail', async () => {
    const failing = await registry((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    await expect(
      fetchNpmDist('pkg', '2.0.0', { registries: [failing.url], retry: 0 }),
    ).rejects.toThrow('HTTP 500');
  });
});
