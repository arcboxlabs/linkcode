import { describe, expect, it } from 'vitest';
import matrixModule from './brand-matrix.cjs';

const { buildMatrixPlan, parseBrandBuildMatrix } = matrixModule;
const RE_WRONG_BRAND = /must target acme\/ios\/canary/;
const RE_WRONG_PLATFORM = /must target acme\/android\/canary/;
const RE_UNCHECKED = /noExecutableCode: must be true/;
const RE_INVALID_FORMAT = /has an invalid format/;
const RE_MISSING_DELIVERY = /delivery inputs are required/;
const RE_SIGN_WITHOUT_BUILD = /sign requires build=true/;
const RE_UPLOAD_WITHOUT_SIGN = /upload requires sign=true/;
const RE_MISSING_BRAND_SEGMENT = /must include the brand id/;
const RE_UNKNOWN_FIELD = /must contain exactly/;
const RE_DIVERGENT_SOURCE = /all platforms must share sourceGitSha/;
const RE_SHARED_DESTINATION = /R2 prefixes in one bucket must not overlap/;
const RE_SHARED_CREDENTIALS = /credentialSecretPrefix: must be unique/;
const RE_SHARED_APP_STORE_APP = /ios\.ascAppId: must be unique/;

function sha(character) {
  return character.repeat(64);
}

function gitSha(character) {
  return character.repeat(40);
}

function checklist() {
  return {
    configurableFeaturesDisclosed: true,
    dataPracticesReviewed: true,
    noExecutableCode: true,
    permissionsReviewed: true,
    storeMetadataReviewed: true,
  };
}

function manifest(brandId, platform) {
  return {
    brandId,
    channel: 'canary',
    configRevisionId: 'fixture-v1',
    expectedSnapshotSha256: sha('a'),
    platform,
    publicKeyringsSha256: sha('b'),
    publisherGitSha: gitSha('c'),
    releaseManifestFormatVersion: 1,
    revisionSha256: sha('d'),
    sourceGitSha: gitSha('e'),
    telemetryEndpoint: `https://${brandId}.example.invalid/telemetry`,
  };
}

function brand(brandId = 'acme') {
  const declaration = {
    checklist: checklist(),
    disclosedFeatures: ['feature.aiAssist', 'modules.gitLab'],
  };
  return {
    brandId,
    channel: 'canary',
    compliance: {
      android: structuredClone(declaration),
      desktop: structuredClone(declaration),
      ios: structuredClone(declaration),
    },
    distribution: { desktop: null, mobile: null },
    releaseManifests: {
      android: manifest(brandId, 'android'),
      desktop: manifest(brandId, 'desktop'),
      ios: manifest(brandId, 'ios'),
    },
  };
}

function matrix(...brands) {
  return { brandBuildMatrixVersion: 1, brands };
}

describe('parseBrandBuildMatrix', () => {
  it('builds the complete brand by platform plan', () => {
    const input = matrix(brand('acme'), brand('zenith'));
    const plan = buildMatrixPlan(input);
    expect(
      plan.targets.include.map(({ brandId, platform }) => `${brandId}/${platform}`),
    ).toStrictEqual([
      'acme/desktop',
      'acme/ios',
      'acme/android',
      'zenith/desktop',
      'zenith/ios',
      'zenith/android',
    ]);
    expect(input.brands[0].distribution).toStrictEqual({ desktop: null, mobile: null });
  });

  it('rejects cross-brand and cross-platform manifest bindings', () => {
    const wrongBrand = matrix(brand());
    wrongBrand.brands[0].releaseManifests.ios.brandId = 'zenith';
    expect(() => parseBrandBuildMatrix(wrongBrand)).toThrow(RE_WRONG_BRAND);

    const wrongPlatform = matrix(brand());
    wrongPlatform.brands[0].releaseManifests.android.platform = 'ios';
    expect(() => parseBrandBuildMatrix(wrongPlatform)).toThrow(RE_WRONG_PLATFORM);
  });

  it('rejects undisclosed checklist state and non-feature disclosure keys', () => {
    const unchecked = matrix(brand());
    unchecked.brands[0].compliance.ios.checklist.noExecutableCode = false;
    expect(() => parseBrandBuildMatrix(unchecked)).toThrow(RE_UNCHECKED);

    const invalidDisclosure = matrix(brand());
    invalidDisclosure.brands[0].compliance.android.disclosedFeatures = ['review.hiddenMode'];
    expect(() => parseBrandBuildMatrix(invalidDisclosure)).toThrow(RE_INVALID_FORMAT);
  });

  it('rejects missing delivery inputs when building or signing is requested', () => {
    expect(() => parseBrandBuildMatrix(matrix(brand()), { build: true })).toThrow(
      RE_MISSING_DELIVERY,
    );
    expect(() => parseBrandBuildMatrix(matrix(brand()), { sign: true })).toThrow(
      RE_SIGN_WITHOUT_BUILD,
    );
    expect(() => parseBrandBuildMatrix(matrix(brand()), { upload: true })).toThrow(
      RE_UPLOAD_WITHOUT_SIGN,
    );

    const first = brand('acme');
    first.distribution.desktop = {
      credentialSecretPrefix: 'ACME',
      r2Bucket: 'release-acme',
      r2Prefix: 'desktop/acme/canary',
      updateUrl: 'https://acme.example.invalid/desktop/acme/canary',
    };
    first.distribution.mobile = {
      android: { track: 'internal' },
      easProjectId: '11111111-1111-4111-8111-111111111111',
      ios: { appleTeamId: 'ABC1234567', ascAppId: '1234567890' },
      updatesUrl: 'https://u.expo.dev/11111111-1111-4111-8111-111111111111',
    };
    const second = structuredClone(first);
    second.brandId = 'zenith';
    for (const platform of ['desktop', 'ios', 'android']) {
      second.releaseManifests[platform].brandId = 'zenith';
    }
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_MISSING_BRAND_SEGMENT,
    );
  });

  it('rejects shared R2 destinations, credentials, and store apps across brands', () => {
    const first = brand('acme');
    first.distribution.desktop = {
      credentialSecretPrefix: 'ACME',
      r2Bucket: 'release-brands',
      r2Prefix: 'desktop/acme/zenith/canary',
      updateUrl: 'https://acme.example.invalid/desktop/acme/zenith/canary',
    };
    first.distribution.mobile = {
      android: { track: 'internal' },
      easProjectId: '11111111-1111-4111-8111-111111111111',
      ios: { appleTeamId: 'ABC1234567', ascAppId: '1234567890' },
      updatesUrl: 'https://u.expo.dev/11111111-1111-4111-8111-111111111111',
    };
    const second = brand('zenith');
    second.distribution.desktop = {
      credentialSecretPrefix: 'ZENITH',
      r2Bucket: first.distribution.desktop.r2Bucket,
      r2Prefix: first.distribution.desktop.r2Prefix,
      updateUrl: 'https://zenith.example.invalid/desktop/acme/zenith/canary',
    };
    second.distribution.mobile = {
      android: { track: 'internal' },
      easProjectId: '22222222-2222-4222-8222-222222222222',
      ios: { appleTeamId: 'ABC1234567', ascAppId: '0987654321' },
      updatesUrl: 'https://u.expo.dev/22222222-2222-4222-8222-222222222222',
    };
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_SHARED_DESTINATION,
    );

    second.distribution.desktop.r2Prefix = 'desktop/acme/zenith/canary/child';
    second.distribution.desktop.updateUrl =
      'https://zenith.example.invalid/desktop/acme/zenith/canary/child';
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_SHARED_DESTINATION,
    );

    second.distribution.desktop.r2Prefix = 'desktop/zenith/canary';
    second.distribution.desktop.updateUrl = 'https://zenith.example.invalid/desktop/zenith/canary';
    second.distribution.desktop.credentialSecretPrefix = 'ACME';
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_SHARED_CREDENTIALS,
    );

    second.distribution.desktop.credentialSecretPrefix = 'ZENITH';
    second.distribution.mobile.ios.ascAppId = first.distribution.mobile.ios.ascAppId;
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_SHARED_APP_STORE_APP,
    );
  });

  it('rejects unknown fields and divergent immutable source bindings', () => {
    const extra = matrix(brand());
    extra.brands[0].releaseManifests.desktop.hidden = true;
    expect(() => parseBrandBuildMatrix(extra)).toThrow(RE_UNKNOWN_FIELD);

    const divergent = matrix(brand());
    divergent.brands[0].releaseManifests.ios.sourceGitSha = gitSha('f');
    expect(() => parseBrandBuildMatrix(divergent)).toThrow(RE_DIVERGENT_SOURCE);
  });
});
