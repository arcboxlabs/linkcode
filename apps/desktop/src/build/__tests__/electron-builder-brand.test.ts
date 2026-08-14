import type { BrandIdentityArtifact } from '@linkcode/common/config';
import { parseBrandIdentityArtifact } from '@linkcode/common/config';
import { describe, expect, it } from 'vitest';
import {
  electronBuilderBrandConfig,
  serializeElectronBuilderBrandConfig,
} from '../electron-builder-brand';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

function identity(overrides: Partial<Record<string, unknown>> = {}): BrandIdentityArtifact {
  return parseBrandIdentityArtifact({
    applicationId: 'dev.arcbox.acme.desktop',
    assetsPath: 'brands/acme',
    brandId: 'acme',
    brandIdentityVersion: 1,
    channel: 'stable',
    displayName: 'Acme Studio',
    platform: 'desktop',
    provenance: { manifestSchemaVersion: 1, sourceGitSha: SOURCE_SHA },
    storageNamespace: 'Acme Studio',
    urlScheme: 'acme',
    ...overrides,
  });
}

const ZENITH_CANARY = identity({
  applicationId: 'dev.arcbox.zenith.desktop.canary',
  assetsPath: 'brands/zenith',
  brandId: 'zenith',
  channel: 'canary',
  displayName: 'Zenith Workspace Canary',
  storageNamespace: 'Zenith Workspace Canary',
  urlScheme: 'zenith-canary',
});

describe('electronBuilderBrandConfig', () => {
  it('derives every identity-owned builder field from the artifact (acme stable)', () => {
    expect(serializeElectronBuilderBrandConfig(electronBuilderBrandConfig(identity()))).toBe(
      `${JSON.stringify(
        {
          appId: 'dev.arcbox.acme.desktop',
          extends: './electron-builder.yml',
          linux: { executableName: 'acme', icon: 'generated/brand-assets/icon.png' },
          mac: { icon: 'generated/brand-assets/icon.png' },
          productName: 'Acme Studio',
          protocols: [{ name: 'Acme Studio', schemes: ['acme'] }],
          publish: null,
          win: { icon: 'generated/brand-assets/icon.png' },
        },
        null,
        2,
      )}\n`,
    );
  });

  it('keeps a second brand fully isolated (zenith canary)', () => {
    const serialized = serializeElectronBuilderBrandConfig(
      electronBuilderBrandConfig(ZENITH_CANARY),
    );
    expect(serialized).toContain('"appId": "dev.arcbox.zenith.desktop.canary"');
    expect(serialized).toContain('"productName": "Zenith Workspace Canary"');
    expect(serialized).toContain('"zenith-canary"');
    // Nothing of the other brand, the default product, or internal names leaks in.
    expect(serialized).not.toMatch(/acme/i);
    expect(serialized.replaceAll('./electron-builder.yml', '')).not.toMatch(/linkcode/i);
  });

  it('uses the publisher-resolved LinkCode desktop app id verbatim', () => {
    const config = electronBuilderBrandConfig(
      identity({
        applicationId: 'com.arcboxlabs.linkcode.desktop',
        brandId: 'linkcode',
        displayName: 'LinkCode',
        storageNamespace: 'LinkCode',
        urlScheme: 'linkcode',
      }),
    );

    expect(config.appId).toBe('com.arcboxlabs.linkcode.desktop');
  });

  it('serializes deterministically', () => {
    const first = serializeElectronBuilderBrandConfig(electronBuilderBrandConfig(ZENITH_CANARY));
    const second = serializeElectronBuilderBrandConfig(electronBuilderBrandConfig(ZENITH_CANARY));
    expect(second).toBe(first);
  });

  it('refuses a non-desktop identity', () => {
    const ios = identity({ applicationId: 'dev.arcbox.acme', platform: 'ios' });
    expect(() => electronBuilderBrandConfig(ios)).toThrow(/requires a desktop identity/);
  });
});
