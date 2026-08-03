import { describe, expect, it } from 'vitest';
import {
  LinkCodeMarketplaceConfigListSchema,
  LinkCodeMarketplaceIndexReaderSchema,
  LinkCodeMarketplaceIndexSchema,
  LinkCodeMarketplaceRefreshStateSchema,
  LinkCodeMarketplaceReleaseIdentitySchema,
} from '../linkcode-marketplace';

const latexRelease = {
  manifest: {
    manifestVersion: 1,
    id: 'arcbox/latex',
    version: '1.2.0',
    displayName: 'LaTeX',
    keywords: ['latex', 'pdf'],
    components: [{ kind: 'skill', name: 'latex', entry: 'skills/latex/SKILL.md' }],
    assets: [{ id: { kind: 'tool', name: 'tectonic' }, versionRange: '>=0.16.0 <0.17.0' }],
  },
  artifact: {
    urls: ['releases/arcbox-latex-1.2.0.tgz'],
    integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
    size: 4096,
    format: 'tgz',
  },
  publishedAt: '2026-08-03T08:00:00.000+08:00',
} as const;

function releaseWithBuild(build: string) {
  return {
    ...latexRelease,
    manifest: { ...latexRelease.manifest, version: `1.2.0+${build}` },
  };
}

function marketplace(id: string, url: string) {
  return { id, source: { type: 'remote' as const, url }, enabled: true };
}

const marketplaceIndex = {
  indexVersion: 1,
  name: 'LinkCode Official',
  updatedAt: '2026-08-03T09:00:00.000+08:00',
  plugins: [{ id: 'arcbox/latex', releases: [latexRelease] }],
} as const;

describe('LinkCode marketplace contracts', () => {
  it('configures multiple independent HTTPS marketplaces', () => {
    expect(
      LinkCodeMarketplaceConfigListSchema.parse([
        {
          ...marketplace('linkcode-official', 'https://plugins.linkcode.ai/index.json'),
          displayName: 'LinkCode Official',
        },
        marketplace('community', 'https://example.com/linkcode/index.json'),
      ]),
    ).toHaveLength(2);
  });

  it('rejects insecure remote sources and duplicate local marketplace ids', () => {
    for (const url of ['http://example.com/index.json', 'https:example.com/index.json']) {
      expect(
        LinkCodeMarketplaceConfigListSchema.safeParse([marketplace('community', url)]).success,
      ).toBe(false);
    }
    expect(
      LinkCodeMarketplaceConfigListSchema.safeParse([
        marketplace('community', 'https://one.example/index.json'),
        marketplace('community', 'https://two.example/index.json'),
      ]).success,
    ).toBe(false);
  });

  it('reads a versioned marketplace index and ignores additive metadata', () => {
    expect(
      LinkCodeMarketplaceIndexReaderSchema.parse({
        ...marketplaceIndex,
        futureIndexMetadata: 'ignored by older readers',
        plugins: [
          {
            ...marketplaceIndex.plugins[0],
            futurePluginMetadata: 'ignored by older readers',
          },
        ],
      }),
    ).toMatchObject({
      indexVersion: 1,
      plugins: [{ id: 'arcbox/latex', releases: [{ manifest: { version: '1.2.0' } }] }],
    });
  });

  it('rejects an unknown index version', () => {
    expect(
      LinkCodeMarketplaceIndexReaderSchema.safeParse({
        ...marketplaceIndex,
        indexVersion: 2,
      }).success,
    ).toBe(false);
  });

  it('retains compatible releases while ignoring component kinds this reader cannot represent', () => {
    const futureRelease = {
      ...latexRelease,
      manifest: {
        ...latexRelease.manifest,
        version: '2.0.0',
        components: [{ kind: 'command', name: 'latex', entry: 'commands/latex.md' }],
      },
    };
    expect(
      LinkCodeMarketplaceIndexSchema.safeParse({
        ...marketplaceIndex,
        plugins: [
          {
            id: 'arcbox/latex',
            releases: [latexRelease, futureRelease],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      LinkCodeMarketplaceIndexReaderSchema.parse({
        ...marketplaceIndex,
        plugins: [{ id: 'arcbox/latex', releases: [latexRelease, futureRelease] }],
      }).plugins[0]?.releases.map((release) => release.manifest.version),
    ).toEqual(['1.2.0']);
  });

  it('rejects a release grouped under another plugin id', () => {
    expect(
      LinkCodeMarketplaceIndexSchema.safeParse({
        ...marketplaceIndex,
        plugins: [{ id: 'community/latex', releases: [latexRelease] }],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate release versions and duplicate plugin entries', () => {
    expect(
      LinkCodeMarketplaceIndexSchema.safeParse({
        ...marketplaceIndex,
        plugins: [{ id: 'arcbox/latex', releases: [latexRelease, latexRelease] }],
      }).success,
    ).toBe(false);
    expect(
      LinkCodeMarketplaceIndexSchema.safeParse({
        ...marketplaceIndex,
        plugins: [marketplaceIndex.plugins[0], marketplaceIndex.plugins[0]],
      }).success,
    ).toBe(false);
  });

  it('rejects releases that differ only by semver build metadata', () => {
    expect(
      LinkCodeMarketplaceIndexSchema.safeParse({
        ...marketplaceIndex,
        plugins: [
          {
            id: 'arcbox/latex',
            releases: [releaseWithBuild('first'), releaseWithBuild('second')],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps equal plugin releases from different marketplaces independently addressable', () => {
    expect(
      ['linkcode-official', 'community'].map((marketplaceId) =>
        LinkCodeMarketplaceReleaseIdentitySchema.parse({
          marketplaceId,
          pluginId: 'arcbox/latex',
          version: '1.2.0',
        }),
      ),
    ).toEqual([
      { marketplaceId: 'linkcode-official', pluginId: 'arcbox/latex', version: '1.2.0' },
      { marketplaceId: 'community', pluginId: 'arcbox/latex', version: '1.2.0' },
    ]);
  });

  it('stores HTTP refresh validators outside the published index', () => {
    expect(
      LinkCodeMarketplaceRefreshStateSchema.parse({
        marketplaceId: 'linkcode-official',
        sourceUrl: 'https://plugins.linkcode.ai/index.json',
        etag: '"index-v1"',
        lastModified: 'Mon, 03 Aug 2026 01:00:00 GMT',
        checkedAt: 1_785_719_600_000,
        lastSuccessfulUpdateAt: 1_785_719_600_000,
        futureRefreshMetadata: 'ignored by older readers',
      }),
    ).toEqual({
      marketplaceId: 'linkcode-official',
      sourceUrl: 'https://plugins.linkcode.ai/index.json',
      etag: '"index-v1"',
      lastModified: 'Mon, 03 Aug 2026 01:00:00 GMT',
      checkedAt: 1_785_719_600_000,
      lastSuccessfulUpdateAt: 1_785_719_600_000,
    });
  });
});
