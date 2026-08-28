import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import { deriveDesktopBrandBase, parseDesktopBrandIdentity } from '../brand';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';
const RE_DESKTOP = /desktop/;
const RE_DEFAULT_PRODUCT = /linkcode/i;

function rawIdentity(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
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

describe('parseDesktopBrandIdentity', () => {
  it('returns null when no identity is inlined', () => {
    expect(parseDesktopBrandIdentity(undefined)).toBeNull();
    expect(parseDesktopBrandIdentity('')).toBeNull();
  });

  it('parses a desktop identity', () => {
    const identity = parseDesktopBrandIdentity(rawIdentity());
    expect(identity?.brandId).toBe('acme');
    expect(identity?.applicationId).toBe('dev.arcbox.acme.desktop');
  });

  it('fails closed on malformed JSON instead of falling back to the default brand', () => {
    expect(() => parseDesktopBrandIdentity('{not json')).toThrow();
  });

  it('fails closed on a non-desktop identity', () => {
    expect(() =>
      parseDesktopBrandIdentity(rawIdentity({ applicationId: 'dev.arcbox.acme', platform: 'ios' })),
    ).toThrow(RE_DESKTOP);
  });

  it('fails closed on malformed identity fields', () => {
    expect(() => parseDesktopBrandIdentity(rawIdentity({ urlScheme: 'Not A Scheme' }))).toThrow();
    expect(() =>
      parseDesktopBrandIdentity(rawIdentity({ applicationId: 'no spaces allowed' })),
    ).toThrow();
  });
});

describe('deriveDesktopBrandBase', () => {
  it('uses the publisher identity verbatim on the release channel', () => {
    const identity = nullthrow(parseDesktopBrandIdentity(rawIdentity()), 'expected identity');
    expect(deriveDesktopBrandBase(identity, 'release')).toStrictEqual({
      appId: 'dev.arcbox.acme.desktop',
      appName: 'Acme Studio',
      authScheme: 'acme',
      storageDirName: 'Acme Studio',
    });
  });

  it('decorates the development channel without touching release identity', () => {
    const identity = nullthrow(parseDesktopBrandIdentity(rawIdentity()), 'expected identity');
    expect(deriveDesktopBrandBase(identity, 'development')).toStrictEqual({
      appId: 'dev.arcbox.acme.desktop.development',
      appName: 'Acme Studio Development',
      authScheme: 'acme-dev',
      storageDirName: 'Acme Studio Development',
    });
  });

  it('keeps two brands fully isolated on the same channel', () => {
    const acme = parseDesktopBrandIdentity(rawIdentity());
    const zenith = parseDesktopBrandIdentity(
      rawIdentity({
        applicationId: 'dev.arcbox.zenith.desktop',
        assetsPath: 'brands/zenith',
        brandId: 'zenith',
        displayName: 'Zenith Workspace',
        storageNamespace: 'Zenith Workspace',
        urlScheme: 'zenith',
      }),
    );
    if (acme === null || zenith === null) throw new Error('expected identities');
    const channels = ['release', 'development'] as const;
    for (let i = 0, len = channels.length; i < len; i++) {
      const channel = channels[i];
      const acmeBase = deriveDesktopBrandBase(acme, channel);
      const zenithBase = deriveDesktopBrandBase(zenith, channel);
      expect(zenithBase.storageDirName).not.toBe(acmeBase.storageDirName);
      expect(zenithBase.appId).not.toBe(acmeBase.appId);
      expect(zenithBase.authScheme).not.toBe(acmeBase.authScheme);
    }
  });

  it('never derives the legacy unbranded storage location', () => {
    const identity = nullthrow(parseDesktopBrandIdentity(rawIdentity()), 'expected identity');
    const channels = ['release', 'development'] as const;
    for (let i = 0, len = channels.length; i < len; i++) {
      const channel = channels[i];
      const base = deriveDesktopBrandBase(identity, channel);
      expect(base.storageDirName).not.toMatch(RE_DEFAULT_PRODUCT);
      expect(base.appId).not.toMatch(RE_DEFAULT_PRODUCT);
    }
  });
});
