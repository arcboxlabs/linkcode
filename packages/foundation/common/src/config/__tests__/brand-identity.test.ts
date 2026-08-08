import { readFile } from 'node:fs/promises';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/brand-identity-v1.json';
import fixtureAndroid from '../__fixtures__/brand-identity-v1-android.json';
import fixtureIos from '../__fixtures__/brand-identity-v1-ios.json';
import fixtureZenithCanary from '../__fixtures__/brand-identity-v1-zenith-canary.json';
import bundleFixture from '../__fixtures__/build-bundle-v1.json';
import { assertBrandIdentityMatchesBundle, parseBrandIdentityArtifact } from '../brand-identity';
import { parseConfigBuildBundle } from '../build-bundle';

// Frozen publisher fixture bytes (config-publisher fixtures/brand-identity-v1*.json). Never edit
// the vendored copies; re-vendor from the publisher and update the digests together.
const FIXTURE_SHA256 = {
  android: '5a3339557869a5ba44c4b43f6c1b401522fe78203431f803b1db2f84a90f0f2d',
  desktop: 'a5894d069644597b470551e4c6e1cd53c5b9c19316226b1c3ea1de22607d9dad',
  ios: '1e0190690315416b16d5976d3f54847f20efa487e3efd938d9c8d7cc6598cd05',
  'zenith-canary': 'a1990f62f8848f303664859d3b9fd52958854db2aad60be982980dd4a8a64090',
} as const;

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tampering requires loose writes
function mutate(change: (artifact: Record<string, any>) => void): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tampering requires loose writes
  const clone = structuredClone(fixture) as Record<string, any>;
  change(clone);
  return clone;
}

describe('brand identity v1 vendored fixtures', () => {
  it('matches the frozen publisher bytes exactly', async () => {
    for (const [name, digest] of Object.entries(FIXTURE_SHA256)) {
      const suffix = name === 'desktop' ? '' : `-${name}`;
      // eslint-disable-next-line no-await-in-loop -- four small reads
      const bytes = await readFile(
        new URL(`../__fixtures__/brand-identity-v1${suffix}.json`, import.meta.url),
      );
      expect(toHex(sha256(bytes)), name).toBe(digest);
    }
  });

  it('validates every fixture and preserves its target', () => {
    for (const [raw, brandId, platform, channel] of [
      [fixture, 'acme', 'desktop', 'stable'],
      [fixtureIos, 'acme', 'ios', 'stable'],
      [fixtureAndroid, 'acme', 'android', 'stable'],
      [fixtureZenithCanary, 'zenith', 'desktop', 'canary'],
    ] as const) {
      const identity = parseBrandIdentityArtifact(structuredClone(raw));
      expect(identity.brandId).toBe(brandId);
      expect(identity.platform).toBe(platform);
      expect(identity.channel).toBe(channel);
    }
  });

  it('keeps the two brands disjoint on every OS-visible identifier', () => {
    const acme = parseBrandIdentityArtifact(structuredClone(fixture));
    const zenith = parseBrandIdentityArtifact(structuredClone(fixtureZenithCanary));
    expect(acme.applicationId).not.toBe(zenith.applicationId);
    expect(acme.urlScheme).not.toBe(zenith.urlScheme);
    expect(acme.storageNamespace).not.toBe(zenith.storageNamespace);
    expect(acme.assetsPath).not.toBe(zenith.assetsPath);
    expect(acme.displayName).not.toBe(zenith.displayName);
  });
});

describe('parseBrandIdentityArtifact', () => {
  it('rejects structural tampering', () => {
    expect(() => parseBrandIdentityArtifact(null)).toThrow('must be an object');
    expect(() =>
      parseBrandIdentityArtifact(
        mutate((artifact) => {
          artifact.extra = true;
        }),
      ),
    ).toThrow('unsupported field extra');
    expect(() =>
      parseBrandIdentityArtifact(
        mutate((artifact) => {
          delete artifact.storageNamespace;
        }),
      ),
    ).toThrow('missing field storageNamespace');
    expect(() =>
      parseBrandIdentityArtifact(
        mutate((artifact) => {
          artifact.brandIdentityVersion = 2;
        }),
      ),
    ).toThrow('unsupported');
    expect(() =>
      parseBrandIdentityArtifact(
        mutate((artifact) => {
          artifact.provenance.extra = true;
        }),
      ),
    ).toThrow('unsupported field extra');
  });

  it('rejects malformed identifiers, names, paths, and provenance', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tampering requires loose writes
    const cases: Array<[(artifact: Record<string, any>) => void, string]> = [
      [
        (artifact) => {
          artifact.brandId = 'Acme';
        },
        'brandId is invalid',
      ],
      [
        (artifact) => {
          artifact.platform = 'windows';
        },
        'platform is invalid',
      ],
      [
        (artifact) => {
          artifact.channel = 'beta';
        },
        'channel is invalid',
      ],
      [
        (artifact) => {
          artifact.applicationId = 'singlesegment';
        },
        'at least two segments',
      ],
      [
        (artifact) => {
          artifact.applicationId = 'dev..acme';
        },
        'segment',
      ],
      [
        (artifact) => {
          artifact.displayName = ' Acme';
        },
        'whitespace',
      ],
      [
        (artifact) => {
          artifact.displayName = 'Acme\u{7}Studio';
        },
        'control characters',
      ],
      [
        (artifact) => {
          artifact.storageNamespace = 'Acme/Studio';
        },
        'Windows-reserved',
      ],
      [
        (artifact) => {
          artifact.storageNamespace = 'Acme Studio.';
        },
        'end with a dot',
      ],
      [
        (artifact) => {
          artifact.urlScheme = '1acme';
        },
        'urlScheme is invalid',
      ],
      [
        (artifact) => {
          artifact.assetsPath = '/brands/acme';
        },
        'forward-slash relative path',
      ],
      [
        (artifact) => {
          artifact.assetsPath = 'brands/../acme';
        },
        'parent segments',
      ],
      [
        (artifact) => {
          artifact.assetsPath = String.raw`brands\acme`;
        },
        'forward-slash relative path',
      ],
      [
        (artifact) => {
          artifact.provenance.sourceGitSha = 'not-a-sha';
        },
        'sourceGitSha',
      ],
      [
        (artifact) => {
          artifact.provenance.manifestSchemaVersion = 0;
        },
        'manifestSchemaVersion',
      ],
    ];
    for (const [change, message] of cases) {
      expect(() => parseBrandIdentityArtifact(mutate(change))).toThrow(message);
    }
  });

  it('enforces platform-specific application id rules', () => {
    // Dashes are legal in Apple/desktop ids but never in Android application ids.
    const android = structuredClone(fixtureAndroid) as Record<string, unknown>;
    android.applicationId = 'dev.arc-box.acme';
    expect(() => parseBrandIdentityArtifact(android)).toThrow('invalid for android');
    expect(() =>
      parseBrandIdentityArtifact(
        mutate((artifact) => {
          artifact.applicationId = 'dev.arc-box.acme';
        }),
      ),
    ).not.toThrow();
  });
});

describe('assertBrandIdentityMatchesBundle', () => {
  const bundle = parseConfigBuildBundle(structuredClone(bundleFixture));

  it('accepts an identity for the same target and source commit', () => {
    const identity = parseBrandIdentityArtifact(
      mutate((artifact) => {
        artifact.provenance.sourceGitSha = bundle.provenance.sourceGitSha;
      }),
    );
    expect(() => assertBrandIdentityMatchesBundle(identity, bundle)).not.toThrow();
  });

  it('rejects a cross-target identity', () => {
    const identity = parseBrandIdentityArtifact(
      mutate((artifact) => {
        artifact.brandId = 'zenith';
        artifact.provenance.sourceGitSha = bundle.provenance.sourceGitSha;
      }),
    );
    expect(() => assertBrandIdentityMatchesBundle(identity, bundle)).toThrow(
      'identity targets zenith/desktop/stable',
    );
  });

  it('rejects source commit drift between the two artifacts', () => {
    const identity = parseBrandIdentityArtifact(
      mutate((artifact) => {
        artifact.provenance.sourceGitSha = 'feedfacefeedfacefeedfacefeedfacefeedface';
      }),
    );
    expect(identity.provenance.sourceGitSha).not.toBe(bundle.provenance.sourceGitSha);
    expect(() => assertBrandIdentityMatchesBundle(identity, bundle)).toThrow(
      'regenerate both from the same pinned commit',
    );
  });
});
