import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LinkCodeMarketplaceConfigList } from '@linkcode/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketplaceIndexResponse } from '../marketplace/service';
import { DaemonLinkCodeMarketplaceService } from '../marketplace/service';

let savedHome: string | undefined;

// The marketplace cache resolves under the channel's state dir; point HOME at a fresh temp dir
// per test, the same isolation the config tests use.
beforeEach(() => {
  savedHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'linkcode-marketplace-'));
  process.env.LINKCODE_CHANNEL = 'release';
});

afterEach(() => {
  process.env.HOME = savedHome;
  delete process.env.LINKCODE_CHANNEL;
  vi.restoreAllMocks();
});

const MARKETPLACES: LinkCodeMarketplaceConfigList = [
  {
    id: 'linkcode-official',
    source: { type: 'remote', url: 'https://plugins.example/index.json' },
    enabled: true,
  },
];

const INDEX = {
  indexVersion: 1,
  name: 'Example',
  plugins: [
    {
      id: 'arcbox/latex',
      releases: [
        {
          manifest: {
            manifestVersion: 1,
            id: 'arcbox/latex',
            version: '1.2.0',
            keywords: [],
            components: [{ kind: 'skill', name: 'latex', entry: 'skills/latex/SKILL.md' }],
            assets: [],
          },
          artifact: {
            urls: ['releases/arcbox-latex-1.2.0.tgz'],
            integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
            format: 'tgz',
          },
        },
      ],
    },
  ],
};

function fakeResponse(
  status: number,
  body = '',
  headers: Record<string, string> = {},
): MarketplaceIndexResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(body),
  };
}

describe('DaemonLinkCodeMarketplaceService.refresh', () => {
  it('fetches the index, returns the flattened catalog, and persists validators', async () => {
    const fetchIndex = vi.fn(() =>
      Promise.resolve(fakeResponse(200, JSON.stringify(INDEX), { etag: '"index-v1"' })),
    );
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);

    const result = await service.refresh('linkcode-official');

    expect(result.notModified).toBeUndefined();
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]?.pluginId).toBe('arcbox/latex');
    expect(result.releases[0]?.release.manifest.version).toBe('1.2.0');
    expect(fetchIndex).toHaveBeenCalledWith(
      'https://plugins.example/index.json',
      expect.objectContaining({ headers: {} }),
    );

    // The next refresh replays the stored validator against the same URL.
    await service.refresh('linkcode-official');
    expect(fetchIndex).toHaveBeenLastCalledWith(
      'https://plugins.example/index.json',
      expect.objectContaining({ headers: { 'if-none-match': '"index-v1"' } }),
    );
  });

  it('serves a 304 from the cached catalog and keeps it installable', async () => {
    let calls = 0;
    const fetchIndex = vi.fn(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? fakeResponse(200, JSON.stringify(INDEX), { etag: '"index-v1"' })
          : fakeResponse(304),
      );
    });
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);

    await service.refresh('linkcode-official');
    const result = await service.refresh('linkcode-official');

    expect(result).toEqual({
      releases: [{ pluginId: 'arcbox/latex', release: INDEX.plugins[0].releases[0] }],
      notModified: true,
    });
    expect(fetchIndex).toHaveBeenLastCalledWith(
      'https://plugins.example/index.json',
      expect.objectContaining({ headers: { 'if-none-match': '"index-v1"' } }),
    );
    expect(
      service.resolveRelease({
        marketplaceId: 'linkcode-official',
        pluginId: 'arcbox/latex',
        version: '1.2.0',
      }),
    ).toBeDefined();
  });

  it('discards cached validators when the configured source URL changed', async () => {
    const fetchIndex = vi.fn(() =>
      Promise.resolve(fakeResponse(200, JSON.stringify(INDEX), { etag: '"index-v1"' })),
    );
    await new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex).refresh(
      'linkcode-official',
    );

    const moved: LinkCodeMarketplaceConfigList = [
      { ...MARKETPLACES[0], source: { type: 'remote', url: 'https://mirror.example/index.json' } },
    ];
    await new DaemonLinkCodeMarketplaceService(moved, fetchIndex).refresh('linkcode-official');

    expect(fetchIndex).toHaveBeenLastCalledWith(
      'https://mirror.example/index.json',
      expect.objectContaining({ headers: {} }),
    );
  });

  it('rejects a non-OK response without touching the cache', async () => {
    const fetchIndex = vi.fn(() => Promise.resolve(fakeResponse(500)));
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);

    await expect(service.refresh('linkcode-official')).rejects.toThrow('HTTP 500');
    expect(
      service.resolveRelease({
        marketplaceId: 'linkcode-official',
        pluginId: 'arcbox/latex',
        version: '1.2.0',
      }),
    ).toBeUndefined();
  });

  it('rejects a malformed index body without touching the cache', async () => {
    const fetchIndex = vi.fn(() => Promise.resolve(fakeResponse(200, 'not json')));
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);

    await expect(service.refresh('linkcode-official')).rejects.toThrow('not valid JSON');
    expect(
      service.resolveRelease({
        marketplaceId: 'linkcode-official',
        pluginId: 'arcbox/latex',
        version: '1.2.0',
      }),
    ).toBeUndefined();
  });

  it('rejects an index this build cannot read without touching the cache', async () => {
    const body = JSON.stringify({ ...INDEX, indexVersion: 2 });
    const fetchIndex = vi.fn(() => Promise.resolve(fakeResponse(200, body)));
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);

    await expect(service.refresh('linkcode-official')).rejects.toThrow('failed validation');
    expect(
      service.resolveRelease({
        marketplaceId: 'linkcode-official',
        pluginId: 'arcbox/latex',
        version: '1.2.0',
      }),
    ).toBeUndefined();
  });

  it('rejects an unconfigured marketplace id without fetching', async () => {
    const fetchIndex = vi.fn();
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);

    await expect(service.refresh('community')).rejects.toThrow('Unknown marketplace: community');
    expect(fetchIndex).not.toHaveBeenCalled();
  });
});

describe('DaemonLinkCodeMarketplaceService.resolveRelease', () => {
  it('resolves index-relative artifact mirrors against the source URL', async () => {
    const fetchIndex = vi.fn(() => Promise.resolve(fakeResponse(200, JSON.stringify(INDEX))));
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);
    await service.refresh('linkcode-official');

    const release = service.resolveRelease({
      marketplaceId: 'linkcode-official',
      pluginId: 'arcbox/latex',
      version: '1.2.0',
    });

    expect(release?.artifact.urls).toEqual([
      'https://plugins.example/releases/arcbox-latex-1.2.0.tgz',
    ]);
  });

  it('misses on an unknown plugin id or version', async () => {
    const fetchIndex = vi.fn(() => Promise.resolve(fakeResponse(200, JSON.stringify(INDEX))));
    const service = new DaemonLinkCodeMarketplaceService(MARKETPLACES, fetchIndex);
    await service.refresh('linkcode-official');

    for (const identity of [
      { marketplaceId: 'linkcode-official', pluginId: 'arcbox/other', version: '1.2.0' },
      { marketplaceId: 'linkcode-official', pluginId: 'arcbox/latex', version: '9.9.9' },
      { marketplaceId: 'community', pluginId: 'arcbox/latex', version: '1.2.0' },
    ]) {
      expect(service.resolveRelease(identity)).toBeUndefined();
    }
  });
});
