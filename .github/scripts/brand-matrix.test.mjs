import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import matrixModule from './brand-matrix.cjs';

const { buildMatrixPlan, parseBrandBuildMatrix, runCli } = matrixModule;
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
const ACTIONS_EXPRESSION = String.fromCodePoint(36);

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
  it('pins the CODE-561 credential-free pilot to two brands and all platforms', async () => {
    const pilot = JSON.parse(
      await readFile(
        new URL('../release/brand-matrices/code-561-pilot.json', import.meta.url),
        'utf8',
      ),
    );
    const plan = buildMatrixPlan(pilot);

    expect(plan.targets.include.map(({ brandId, platform }) => `${brandId}/${platform}`)).toEqual([
      'acme/desktop',
      'acme/ios',
      'acme/android',
      'zenith/desktop',
      'zenith/ios',
      'zenith/android',
    ]);
    expect(
      new Set(pilot.brands.map((entry) => entry.releaseManifests.desktop.publisherGitSha)),
    ).toEqual(new Set(['e4a0624abbc8ed1cac4948fa90239176a83cb96e']));
    expect(
      pilot.brands.every((entry) => Object.values(entry.distribution).every((x) => x === null)),
    ).toBe(true);
  });

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

  it('emits the digest of the exact matrix-file bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brand-matrix-'));
    const matrixPath = join(root, 'matrix.json');
    const outputPath = join(root, 'github-output');
    const bytes = `${JSON.stringify(matrix(brand()))}\n`;
    await writeFile(matrixPath, bytes);
    runCli(['--matrix-file', matrixPath], { GITHUB_OUTPUT: outputPath });
    const output = await readFile(outputPath, 'utf8');
    expect(output).toContain(
      `delivery_descriptor_sha256=${createHash('sha256').update(bytes).digest('hex')}\n`,
    );
  });
});

describe('release brand matrix workflow', () => {
  it('keeps local runtime validation independent of provider and signing inputs', async () => {
    const workflow = await readFile(
      new URL('../workflows/release-brand-matrix.yml', import.meta.url),
      'utf8',
    );
    const validation = workflow.slice(
      workflow.indexOf('  credential-free-validation:'),
      workflow.indexOf('  release-environment-preflight:'),
    );

    expect(validation).toContain('needs: prepare');
    expect(validation).toContain(
      `matrix: ${ACTIONS_EXPRESSION}{{ fromJSON(needs.prepare.outputs.targets) }}`,
    );
    expect(validation).toContain('xvfb-run -a pnpm -F @linkcode/desktop e2e:config-canary');
    expect(validation).toContain('pnpm -F @linkcode/mobile smoke:export');
    expect(validation).toContain(
      `expo prebuild --clean --no-install --platform '${ACTIONS_EXPRESSION}{{ matrix.platform }}'`,
    );
    expect(validation).toContain("matrix.platform == 'desktop'");
    expect(validation).toContain("matrix.platform != 'desktop'");
    expect(validation).toContain(
      `credential-free-${ACTIONS_EXPRESSION}{{ matrix.brandId }}-${ACTIONS_EXPRESSION}{{ matrix.platform }}`,
    );
    expect(validation).toContain('"local-static-origin"');
    expect(validation).toContain('providerDeploymentId:null');
    expect(validation).not.toContain('environment: release');
    expect(validation).not.toContain('secrets.');
    expect(validation).not.toContain('release-environment-preflight');
  });

  it('fails closed unless the live-pilot environment is protected', async () => {
    const workflow = await readFile(
      new URL('../workflows/release-brand-matrix.yml', import.meta.url),
      'utf8',
    );
    const preflight = workflow.slice(
      workflow.indexOf('  release-environment-preflight:'),
      workflow.indexOf('  render-inputs:'),
    );

    expect(preflight).not.toContain('environment:');
    expect(preflight).toContain('protection_rules');
    expect(preflight).toContain('required_reviewers');
    expect(preflight).toContain('deployment_branch_policy');
    expect(preflight).toContain(
      'gh api "repos/$GITHUB_REPOSITORY/environments/pilot-nonproduction"',
    );
    expect(preflight).toContain('secrets.PILOT_ENVIRONMENT_ADMIN_TOKEN');
    expect(preflight).toContain('inputs.build');
    const renderInputs = workflow.slice(
      workflow.indexOf('  render-inputs:'),
      workflow.indexOf('  signing-inputs:'),
    );
    expect(renderInputs).toContain('needs: [prepare, release-environment-preflight]');
    expect(renderInputs).toContain('environment: pilot-nonproduction');
    const signingInputs = workflow.slice(
      workflow.indexOf('  signing-inputs:'),
      workflow.indexOf('  render:'),
    );
    expect(signingInputs).toContain('needs: [prepare, release-environment-preflight]');
    expect(signingInputs).toContain('environment: pilot-nonproduction');
    expect(workflow).not.toContain('environment: release');
    expect(workflow.split('release_environment: pilot-nonproduction')).toHaveLength(3);
  });

  it('passes the isolated pilot environment through reusable signing workflows', async () => {
    const [desktop, mobile] = await Promise.all([
      readFile(new URL('../workflows/build-desktop.yml', import.meta.url), 'utf8'),
      readFile(new URL('../workflows/build-mobile.yml', import.meta.url), 'utf8'),
    ]);

    expect(desktop).toContain('release_environment:');
    expect(desktop).toContain(
      `environment: ${ACTIONS_EXPRESSION}{{ inputs.release_environment || 'release' }}`,
    );
    expect(desktop).toContain(
      `environment: ${ACTIONS_EXPRESSION}{{ inputs.sign && (inputs.release_environment || 'release') || '' }}`,
    );
    expect(mobile).toContain('release_environment:');
    expect(
      mobile.split(
        `environment: ${ACTIONS_EXPRESSION}{{ inputs.release_environment || 'release' }}`,
      ),
    ).toHaveLength(4);
  });

  it('binds credential-free desktop recovery evidence to immutable release inputs', async () => {
    const workflow = await readFile(
      new URL('../workflows/release-brand-matrix.yml', import.meta.url),
      'utf8',
    );
    const desktopValidation = workflow.slice(
      workflow.indexOf('  desktop-validation:'),
      workflow.indexOf('  mobile-validation:'),
    );

    expect(desktopValidation).toContain('inputs.build && !inputs.sign');
    expect(desktopValidation).toContain('xvfb-run -a pnpm -F @linkcode/desktop e2e:config-canary');
    expect(desktopValidation).toContain(
      '54ce1fc855e12295a8dd1490463c9afac8e84a526f1e16340bcefe4f0fec8e39',
    );
    expect(desktopValidation).toContain('"normal":["1","2","3","4"]');
    expect(desktopValidation).toContain('"emergency":["1","2","3"]');
    expect(desktopValidation).toContain('"kind":"local-static-origin"');
    expect(desktopValidation).toContain('"providerDeploymentId":null');
    expect(desktopValidation).toContain('--expected-delivery-sha256');
    expect(desktopValidation).toContain(
      '--release-manifest release-inputs/release-manifest.desktop.json',
    );
    expect(desktopValidation).toContain('--out release-provenance.desktop.json');
    expect(desktopValidation).not.toContain('environment: release');
  });
});
