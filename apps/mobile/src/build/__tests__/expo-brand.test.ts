import type { BrandIdentityArtifact } from '@linkcode/common/config';
import { describe, expect, it } from 'vitest';
import baseAppJson from '../../../app.json';
import type { ExpoBrandableConfig } from '../expo-brand';
import {
  applyBrandExpoConfig,
  deriveExpoBrandOverlay,
  parseExpoBrandOverlay,
  serializeExpoBrandOverlay,
} from '../expo-brand';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

function identity(
  platform: 'ios' | 'android',
  overrides: Partial<BrandIdentityArtifact> = {},
): BrandIdentityArtifact {
  return {
    applicationId: 'dev.arcbox.acme',
    assetsPath: 'brands/acme',
    brandId: 'acme',
    brandIdentityVersion: 1,
    channel: 'stable',
    displayName: 'Acme Studio',
    platform,
    provenance: { manifestSchemaVersion: 1, sourceGitSha: SOURCE_SHA },
    storageNamespace: 'Acme Studio',
    urlScheme: 'acme',
    ...overrides,
  };
}

const ACME = deriveExpoBrandOverlay(identity('ios'), identity('android'));

const ZENITH = deriveExpoBrandOverlay(
  identity('ios', {
    applicationId: 'dev.arcbox.zenith.canary',
    assetsPath: 'brands/zenith',
    brandId: 'zenith',
    channel: 'canary',
    displayName: 'Zenith Workspace Canary',
    storageNamespace: 'Zenith Workspace Canary',
    urlScheme: 'zenith-canary',
  }),
  identity('android', {
    applicationId: 'dev.arcbox.zenith.canary',
    assetsPath: 'brands/zenith',
    brandId: 'zenith',
    channel: 'canary',
    displayName: 'Zenith Workspace Canary',
    storageNamespace: 'Zenith Workspace Canary',
    urlScheme: 'zenith-canary',
  }),
);

const BASE = baseAppJson.expo as unknown as ExpoBrandableConfig;

describe('deriveExpoBrandOverlay', () => {
  it('collapses matching platform identities into one overlay', () => {
    expect(ACME).toStrictEqual({
      androidPackage: 'dev.arcbox.acme',
      brandId: 'acme',
      channel: 'stable',
      displayName: 'Acme Studio',
      iosBundleIdentifier: 'dev.arcbox.acme',
      sourceGitSha: SOURCE_SHA,
      urlScheme: 'acme',
    });
  });

  it('fails closed on swapped platforms', () => {
    expect(() => deriveExpoBrandOverlay(identity('android'), identity('android'))).toThrow(
      /expected an ios identity/,
    );
    expect(() => deriveExpoBrandOverlay(identity('ios'), identity('ios'))).toThrow(
      /expected an android identity/,
    );
  });

  it('fails closed when the two artifacts disagree', () => {
    expect(() =>
      deriveExpoBrandOverlay(identity('ios'), identity('android', { displayName: 'Other' })),
    ).toThrow(/displayName differs/);
    expect(() =>
      deriveExpoBrandOverlay(identity('ios'), identity('android', { brandId: 'zenith' })),
    ).toThrow(/brandId differs/);
    expect(() =>
      deriveExpoBrandOverlay(
        identity('ios'),
        identity('android', {
          provenance: {
            manifestSchemaVersion: 1,
            sourceGitSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
          },
        }),
      ),
    ).toThrow(/sourceGitSha differs/);
  });
});

describe('overlay serialization', () => {
  it('is deterministic and round-trips through the structural parser', () => {
    const first = serializeExpoBrandOverlay(ACME);
    expect(serializeExpoBrandOverlay(ACME)).toBe(first);
    expect(parseExpoBrandOverlay(JSON.parse(first))).toStrictEqual(ACME);
  });

  it('rejects missing, extra, and empty fields', () => {
    const valid = JSON.parse(serializeExpoBrandOverlay(ACME)) as Record<string, unknown>;
    const { urlScheme: _dropped, ...missing } = valid;
    expect(() => parseExpoBrandOverlay(missing)).toThrow(/exactly/);
    expect(() => parseExpoBrandOverlay({ ...valid, extraField: 'x' })).toThrow(/exactly/);
    expect(() => parseExpoBrandOverlay({ ...valid, displayName: '' })).toThrow(/non-empty/);
    expect(() => parseExpoBrandOverlay(null)).toThrow(/object/);
  });
});

describe('applyBrandExpoConfig', () => {
  const branded = applyBrandExpoConfig(BASE, ACME);

  it('replaces every identity-owned field from the overlay', () => {
    expect(branded.name).toBe('Acme Studio');
    expect(branded.slug).toBe('acme');
    expect(branded.scheme).toBe('acme');
    expect(branded.icon).toBe('./generated/brand-assets/icon.png');
    expect(branded.ios?.bundleIdentifier).toBe('dev.arcbox.acme');
    expect(branded.ios?.icon).toBe('./generated/brand-assets/icon.png');
    expect(branded.android?.package).toBe('dev.arcbox.acme');
    expect(branded.android?.adaptiveIcon).toStrictEqual({
      backgroundColor: '#FFFFFF',
      foregroundImage: './generated/brand-assets/icon.png',
    });
    expect(branded.splash?.image).toBe('./generated/brand-assets/icon.png');
    expect(branded.web?.favicon).toBe('./generated/brand-assets/icon.png');
  });

  it('strips the default product update/EAS wiring instead of inheriting it', () => {
    expect(branded.updates).toBeUndefined();
    expect(branded.extra).toStrictEqual({});
    expect(JSON.stringify(branded)).not.toContain('u.expo.dev');
  });

  it('rebrands user-visible permission prompts and the share app group', () => {
    const text = JSON.stringify(branded);
    expect(text).toContain('"appGroupId":"group.dev.arcbox.acme"');
    expect(text).toContain('Acme Studio needs camera access');
    expect(text).toContain('Acme Studio needs microphone access');
    expect(text).toContain('Acme Studio uses Face ID');
  });

  it('leaks nothing of the default product identity', () => {
    const text = JSON.stringify(branded);
    expect(text).not.toContain('LinkCode');
    expect(text).not.toContain('com.arcboxlabs.linkcode');
    // The daemon discovery service type is shared-core runtime behavior, not brand identity.
    expect(text).toContain('_linkcode._tcp');
  });

  it('keeps non-identity configuration untouched', () => {
    expect(branded.orientation).toBe(BASE.orientation);
    expect(branded.runtimeVersion).toStrictEqual(BASE.runtimeVersion);
    expect(branded.android?.permissions).toStrictEqual(BASE.android?.permissions);
    expect(branded.ios?.appleTeamId).toBe(BASE.ios?.appleTeamId);
    expect(branded.plugins?.length).toBe(BASE.plugins?.length);
  });

  it('keeps a second brand fully isolated (zenith canary)', () => {
    const zenith = applyBrandExpoConfig(BASE, ZENITH);
    const text = JSON.stringify(zenith);
    expect(zenith.ios?.bundleIdentifier).toBe('dev.arcbox.zenith.canary');
    expect(zenith.android?.package).toBe('dev.arcbox.zenith.canary');
    expect(zenith.scheme).toBe('zenith-canary');
    expect(text).not.toContain('LinkCode');
    expect(text).not.toMatch(/acme/i);
  });

  it('is deterministic', () => {
    expect(applyBrandExpoConfig(BASE, ACME)).toStrictEqual(branded);
  });
});
