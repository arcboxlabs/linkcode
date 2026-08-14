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
const RE_SHARED_DESTINATION = /Desktop destinations must not have overlapping/;
const RE_WRONG_CREDENTIAL_ENVIRONMENT = /credentialEnvironment: must equal release/;
const RE_SHARED_APP_STORE_APP = /ios\.ascAppId: must be unique/;
const RE_INVALID_SOURCE_ROOT = /sourceRoot: must be/;
const RE_LEGACY_DESKTOP_UPLOAD = /"s3:\/\/\$\{R2_BUCKET\}\/\$\{R2_PREFIX\}\/"/;
const RE_SECRETS_EXPRESSION = /secrets(?:\.|\[)/;
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
    sourceRoot: '.',
  };
}

function matrix(...brands) {
  return { brandBuildMatrixVersion: 1, brands };
}

function desktopDestination(brandId) {
  return {
    credentialEnvironment: 'release',
    r2Bucket: `release-${brandId}`,
    r2Prefix: `desktop/${brandId}/canary`,
    updateUrl: `https://${brandId}.example.invalid/desktop/${brandId}/canary`,
  };
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
    ).toEqual(new Set(['986d9f21403df53bc932f511eb1b5f0bb634d48d']));
    expect(
      new Set(pilot.brands.map((entry) => entry.releaseManifests.desktop.sourceGitSha)),
    ).toEqual(new Set(['a1ed4d666721c3aed0d563aaea42fce8b5f945b5']));
    expect(
      pilot.brands.every(
        (entry) =>
          entry.releaseManifests.desktop.publisherGitSha !==
          entry.releaseManifests.desktop.sourceGitSha,
      ),
    ).toBe(true);
    expect(
      pilot.brands.every((entry) => Object.values(entry.distribution).every((x) => x === null)),
    ).toBe(true);
    expect(pilot.brands.every((entry) => entry.sourceRoot === 'examples/acme-zenith')).toBe(true);
    expect(() => buildMatrixPlan(pilot, { build: true })).toThrow(RE_MISSING_DELIVERY);
    const fixture = await readFile(
      new URL('../../apps/desktop/e2e/fixtures/pilot-e2e-v1.json', import.meta.url),
    );
    expect(createHash('sha256').update(fixture).digest('hex')).toBe(
      '54ce1fc855e12295a8dd1490463c9afac8e84a526f1e16340bcefe4f0fec8e39',
    );
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
      credentialEnvironment: 'release',
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
    expect(() => parseBrandBuildMatrix(matrix(first), { build: true })).not.toThrow();
    const second = structuredClone(first);
    second.brandId = 'zenith';
    for (const platform of ['desktop', 'ios', 'android']) {
      second.releaseManifests[platform].brandId = 'zenith';
    }
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_MISSING_BRAND_SEGMENT,
    );
  });

  it('rejects shared R2 destinations and store apps across brands', () => {
    const first = brand('acme');
    first.distribution.desktop = {
      credentialEnvironment: 'release',
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
      credentialEnvironment: 'release',
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
    second.distribution.desktop.credentialEnvironment = 'release-acme';
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_WRONG_CREDENTIAL_ENVIRONMENT,
    );

    second.distribution.desktop.credentialEnvironment = 'release';
    second.distribution.mobile.ios.ascAppId = first.distribution.mobile.ios.ascAppId;
    expect(() => parseBrandBuildMatrix(matrix(first, second), { build: true })).toThrow(
      RE_SHARED_APP_STORE_APP,
    );
  });

  it('accepts an explicit generic legacy Desktop destination', () => {
    const arbitrary = brand('northstar');
    arbitrary.distribution.desktop = desktopDestination('northstar');
    arbitrary.distribution.desktop.legacyDestination = {
      r2Bucket: 'linkcode-releases',
      r2Prefix: 'desktop',
      updateUrl: 'https://releases.linkcode.ai/desktop',
    };

    const parsed = parseBrandBuildMatrix(matrix(arbitrary));
    expect(parsed.brands[0].distribution.desktop.legacyDestination).toStrictEqual({
      r2Bucket: 'linkcode-releases',
      r2Prefix: 'desktop',
      updateUrl: 'https://releases.linkcode.ai/desktop',
    });
  });

  it('rejects malformed or implicit legacy Desktop destinations', () => {
    const missingOptIn = brand();
    missingOptIn.distribution.desktop = desktopDestination('acme');
    missingOptIn.distribution.desktop.legacyR2Prefix = 'desktop';
    expect(() => parseBrandBuildMatrix(matrix(missingOptIn))).toThrow(RE_UNKNOWN_FIELD);

    for (const legacyDestination of [
      null,
      { r2Bucket: 'valid-bucket', r2Prefix: 'desktop' },
      {
        r2Bucket: 'Valid_Bucket',
        r2Prefix: 'desktop',
        updateUrl: 'https://downloads.example.invalid/desktop',
      },
      {
        r2Bucket: 'valid-bucket',
        r2Prefix: '../desktop',
        updateUrl: 'https://downloads.example.invalid/desktop',
      },
      {
        r2Bucket: 'valid-bucket',
        r2Prefix: 'desktop',
        updateUrl: 'http://downloads.example.invalid/desktop',
      },
    ]) {
      const malformed = brand();
      malformed.distribution.desktop = {
        ...desktopDestination('acme'),
        legacyDestination,
      };
      expect(() => parseBrandBuildMatrix(matrix(malformed))).toThrow();
    }
  });

  it('rejects standard and legacy destination overlap within and across brands', () => {
    const first = brand('acme');
    first.distribution.desktop = desktopDestination('acme');
    first.distribution.desktop.legacyDestination = {
      r2Bucket: 'release-acme',
      r2Prefix: 'desktop/acme',
      updateUrl: 'https://legacy.example.invalid/desktop/acme',
    };
    expect(() => parseBrandBuildMatrix(matrix(first))).toThrow(RE_SHARED_DESTINATION);

    first.distribution.desktop.legacyDestination = {
      r2Bucket: 'legacy-acme',
      r2Prefix: 'desktop',
      updateUrl: 'https://legacy.example.invalid/desktop',
    };
    const second = brand('zenith');
    second.distribution.desktop = desktopDestination('zenith');
    second.distribution.desktop.legacyDestination = {
      r2Bucket: 'legacy-acme',
      r2Prefix: 'desktop/archive',
      updateUrl: 'https://zenith-legacy.example.invalid/desktop/archive',
    };
    expect(() => parseBrandBuildMatrix(matrix(first, second))).toThrow(RE_SHARED_DESTINATION);

    second.distribution.desktop.legacyDestination = {
      r2Bucket: 'legacy-zenith',
      r2Prefix: 'desktop/archive',
      updateUrl: 'https://legacy.example.invalid/desktop/archive',
    };
    expect(() => parseBrandBuildMatrix(matrix(first, second))).toThrow(RE_SHARED_DESTINATION);

    first.distribution.desktop.legacyDestination.updateUrl =
      'https://legacy.example.invalid/desktop/';
    expect(() => parseBrandBuildMatrix(matrix(first, second))).toThrow(RE_SHARED_DESTINATION);
  });

  it('rejects unknown fields and divergent immutable source bindings', () => {
    const extra = matrix(brand());
    extra.brands[0].releaseManifests.desktop.hidden = true;
    expect(() => parseBrandBuildMatrix(extra)).toThrow(RE_UNKNOWN_FIELD);

    const divergent = matrix(brand());
    divergent.brands[0].releaseManifests.ios.sourceGitSha = gitSha('f');
    expect(() => parseBrandBuildMatrix(divergent)).toThrow(RE_DIVERGENT_SOURCE);

    const redirected = matrix(brand());
    redirected.brands[0].sourceRoot = 'brands/acme';
    expect(() => parseBrandBuildMatrix(redirected)).toThrow(RE_INVALID_SOURCE_ROOT);
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
    expect(validation).toContain('platform: [desktop, ios, android]');
    expect(validation).toContain('xvfb-run -a pnpm -F @linkcode/desktop e2e:config-canary');
    expect(validation).toContain('pnpm -F @linkcode/mobile smoke:export');
    expect(validation).toContain(
      `expo prebuild --clean --no-install --platform '${ACTIONS_EXPRESSION}{{ matrix.platform }}'`,
    );
    expect(validation).toContain("matrix.platform == 'desktop'");
    expect(validation).toContain("matrix.platform != 'desktop'");
    expect(validation).toContain(`credential-free-${ACTIONS_EXPRESSION}{{ matrix.platform }}`);
    expect(validation).toContain('"local-static-origin"');
    expect(validation).toContain('providerDeploymentId:null');
    expect(validation).not.toContain('environment: release');
    expect(validation).not.toMatch(RE_SECRETS_EXPRESSION);
    expect(validation).not.toContain('brandId:$brandId');
    expect(validation).not.toContain('release-environment-preflight');
  });

  it('fails closed unless the release environment is protected', async () => {
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
    expect(preflight).toContain('gh api "repos/$GITHUB_REPOSITORY/environments/$name"');
    expect(preflight).toContain('deployment-branch-policies?per_page=100');
    expect(preflight).toContain(
      'expected=\'[{"name":"master","type":"branch"},{"name":"v*.*.*","type":"tag"}]\'',
    );
    expect(preflight).not.toContain('credentialEnvironment');
    expect(preflight).toContain(`GH_TOKEN: ${ACTIONS_EXPRESSION}{{ github.token }}`);
    expect(preflight).not.toContain('RELEASE_ENVIRONMENT_ADMIN_TOKEN');
    expect(workflow).toContain('actions: read');
    expect(preflight).toContain('inputs.build');
    const renderInputs = workflow.slice(
      workflow.indexOf('  render-inputs:'),
      workflow.indexOf('  signing-inputs:'),
    );
    expect(renderInputs).toContain('needs: [prepare, release-environment-preflight]');
    expect(renderInputs).toContain('environment: release');
    const signingInputs = workflow.slice(
      workflow.indexOf('  signing-inputs:'),
      workflow.indexOf('  render:'),
    );
    expect(signingInputs).toContain('needs: [prepare, release-environment-preflight]');
    expect(signingInputs).toContain(
      `environment: ${ACTIONS_EXPRESSION}{{ matrix.distribution.desktop.credentialEnvironment }}`,
    );
    expect(workflow).not.toContain('secrets[format(');
    expect(workflow).toContain(
      `R2_ACCESS_KEY_ID: ${ACTIONS_EXPRESSION}{{ secrets.R2_ACCESS_KEY_ID }}`,
    );
    expect(workflow).toContain(
      `release_environment: ${ACTIONS_EXPRESSION}{{ matrix.distribution.desktop.credentialEnvironment }}`,
    );
    expect(workflow).toContain(
      `if: ${ACTIONS_EXPRESSION}{{ inputs.build && !cancelled() && needs.render.result == 'success' && (needs.signing-inputs.result == 'success' || (!inputs.sign && needs.signing-inputs.result == 'skipped')) }}`,
    );
    expect(workflow).not.toContain(`ref: ${ACTIONS_EXPRESSION}{{ inputs.ref }}`);
  });

  it('passes the release environment through reusable signing workflows', async () => {
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

  it('uses an explicit reviewed legacy Desktop destination for packaging and upload', async () => {
    const workflow = await readFile(
      new URL('../workflows/release-brand-matrix.yml', import.meta.url),
      'utf8',
    );
    const desktop = workflow.slice(
      workflow.indexOf('  desktop:'),
      workflow.indexOf('  desktop-validation:'),
    );
    const publish = workflow.slice(workflow.indexOf('  publish-desktop:'));

    expect(desktop).toContain(
      `update_url: ${ACTIONS_EXPRESSION}{{ matrix.distribution.desktop.legacyDestination.updateUrl || matrix.distribution.desktop.updateUrl || '' }}`,
    );
    expect(publish).toContain(
      `R2_BUCKET: ${ACTIONS_EXPRESSION}{{ matrix.distribution.desktop.legacyDestination.r2Bucket || matrix.distribution.desktop.r2Bucket }}`,
    );
    expect(publish).toContain(
      `R2_PREFIX: ${ACTIONS_EXPRESSION}{{ matrix.distribution.desktop.legacyDestination.r2Prefix || matrix.distribution.desktop.r2Prefix }}`,
    );
    expect(publish).toMatch(RE_LEGACY_DESKTOP_UPLOAD);
    expect(workflow).not.toContain("brandId == 'linkcode'");
  });

  it('mints scoped read tokens before any selected client checkout', async () => {
    const [action, desktop, mobile, workflow] = await Promise.all([
      readFile(new URL('../actions/render-release-config/action.yml', import.meta.url), 'utf8'),
      readFile(new URL('../workflows/build-desktop.yml', import.meta.url), 'utf8'),
      readFile(new URL('../workflows/build-mobile.yml', import.meta.url), 'utf8'),
      readFile(new URL('../workflows/release-brand-matrix.yml', import.meta.url), 'utf8'),
    ]);
    const appTokenAction =
      'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1';

    expect(action).toContain('publisher-token:');
    expect(action).toContain('source-token:');
    expect(action).not.toContain(appTokenAction);
    expect(action).not.toContain('github-app-private-key');
    expect(action).not.toContain('BOT_APP_PRIVATE_KEY');
    expect(action).toContain('publisher-repository:');
    expect(action).toContain('publisher_repo="$PUBLISHER_REPO"');
    expect(action).toContain('source-repository:');
    expect(action).toContain('source_repo="$SOURCE_REPO"');
    expect(action).toContain('default: "."');
    expect(action).toContain('.|examples/acme-zenith)');
    expect(action).toContain('cmp -s');
    expect(action).toContain('http.followRedirects=false');
    expect(action).toContain('--max-redirs 0');
    expect(action).toContain('refs/heads/master');
    expect(action).toContain('not reachable from reviewed master');
    expect(action).toContain('must be exact lowercase 40-hex commits');
    expect(action).toContain('must not contain symbolic links');
    expect(action).toContain('CONFIG_PUBLISHER_REPO');
    expect(action).toContain('CONFIG_SOURCE_REPO');
    expect(action).not.toContain('CONFIG_PUBLISHER_TOKEN');
    expect(action).not.toContain('CONFIG_SOURCE_TOKEN');
    expect(action).toContain('checkout identity did not match expected repository');
    expect(action).toContain('publisher/parser/schema contract');
    expect(action).toContain('Pinned config source must contain source root');
    expect(action).toContain('unset PUBLISHER_TOKEN SOURCE_TOKEN');
    expect(action.indexOf('unset PUBLISHER_TOKEN SOURCE_TOKEN')).toBeLessThan(
      action.indexOf('pnpm --dir "$publisher" install --frozen-lockfile'),
    );

    const renderJobs = [
      desktop.slice(desktop.indexOf('  render-config:'), desktop.indexOf('  build:')),
      mobile.slice(mobile.indexOf('  render-config:'), mobile.indexOf('  build:')),
      workflow.slice(workflow.indexOf('  render:'), workflow.indexOf('  desktop:')),
    ];
    for (const renderJob of renderJobs) {
      expect(renderJob.split(appTokenAction)).toHaveLength(3);
      expect(renderJob.split('owner: arcboxlabs')).toHaveLength(3);
      expect(renderJob).toContain(
        `CONFIG_PUBLISHER_REPO: ${ACTIONS_EXPRESSION}{{ vars.CONFIG_PUBLISHER_REPO }}`,
      );
      expect(renderJob).toContain(
        `CONFIG_SOURCE_REPO: ${ACTIONS_EXPRESSION}{{ vars.CONFIG_SOURCE_REPO }}`,
      );
      expect(renderJob).toContain('$name is required');
      expect(renderJob).toContain('must use canonical owner/repository syntax');
      expect(renderJob).toContain('$name owner must be arcboxlabs');
      expect(renderJob).toContain('must identify different repositories');
      expect(renderJob).toContain(
        `repositories: ${ACTIONS_EXPRESSION}{{ steps.repositories.outputs.publisher-name }}`,
      );
      expect(renderJob).toContain(
        `repositories: ${ACTIONS_EXPRESSION}{{ steps.repositories.outputs.source-name }}`,
      );
      expect(renderJob.split('permission-contents: read')).toHaveLength(3);
      expect(renderJob).toContain(
        `publisher-repository: ${ACTIONS_EXPRESSION}{{ steps.repositories.outputs.publisher-full }}`,
      );
      expect(renderJob).toContain(
        `source-repository: ${ACTIONS_EXPRESSION}{{ steps.repositories.outputs.source-full }}`,
      );
      expect(renderJob).toContain(
        `publisher-token: ${ACTIONS_EXPRESSION}{{ steps.publisher-token.outputs.token }}`,
      );
      expect(renderJob).toContain(
        `source-token: ${ACTIONS_EXPRESSION}{{ steps.source-token.outputs.token }}`,
      );
      expect(renderJob.indexOf(appTokenAction)).toBeLessThan(
        renderJob.indexOf('actions/checkout@'),
      );
      expect(renderJob).not.toContain('repositories: linkcodehq');
      expect(renderJob).not.toContain('repositories: linkcode-config');
    }
    expect(
      workflow.split(`source-root: ${ACTIONS_EXPRESSION}{{ matrix.sourceRoot }}`),
    ).toHaveLength(3);
  });

  it('rejects publisher/source role swaps through independent checkout contracts', async () => {
    const action = await readFile(
      new URL('../actions/render-release-config/action.yml', import.meta.url),
      'utf8',
    );

    expect(action).toContain('$publisher/packages/config-publisher/package.json');
    expect(action).toContain('$publisher/packages/config-structural/schema/config.schema.json');
    expect(action).toContain('$structural/brands.manifest.yaml');
    expect(action).toContain('$structural/schema/config.schema.json');
    expect(action).toContain('publisher/parser/schema contract');
    expect(action).toContain('Pinned config source must contain source root');
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
