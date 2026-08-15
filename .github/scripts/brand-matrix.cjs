const process = require('node:process');

const BUILD_MATRIX_VERSION = 1;
const PLATFORMS = ['desktop', 'ios', 'android'];
const CHECKLIST_KEYS = [
  'configurableFeaturesDisclosed',
  'dataPracticesReviewed',
  'noExecutableCode',
  'permissionsReviewed',
  'storeMetadataReviewed',
];
const RELEASE_MANIFEST_BASE_KEYS = [
  'brandId',
  'channel',
  'configRevisionId',
  'expectedSnapshotSha256',
  'platform',
  'publicKeyringsSha256',
  'publisherGitSha',
  'releaseManifestFormatVersion',
  'revisionSha256',
  'sourceGitSha',
  'telemetryEndpoint',
];
const PUBLICATION_EVIDENCE_KEYS = [
  'activationVersion',
  'deploymentId',
  'deploymentSourceGitSha',
  'keyId',
  'pointerSha256',
  'verifiedAt',
];
const RELEASE_MANIFEST_VERSIONS = new Set([1, 2]);

const RE_BRAND_ID = /^[a-z][a-z0-9-]{0,62}$/;
const RE_GIT_SHA = /^[0-9a-f]{40}$/;
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_REVISION = /^[A-Z0-9][\w.-]{0,127}$/i;
const RE_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RE_DISCLOSED_FEATURE = /^(?:feature|modules)\.[\w.-]+$/;
const RE_R2_PREFIX = /^[a-z0-9][a-z0-9/-]*$/;
const RE_TRAILING_SLASH = /\/$/;
const RE_TEAM_ID = /^[A-Z0-9]{10}$/;
const RE_ASC_APP_ID = /^\d+$/;
const RE_MONOTONIC_VERSION = /^(?:0|[1-9]\d{0,19})$/;
const RE_KEY_ID = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function record(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value;
}

function exact(value, keys, path) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `must contain exactly: ${expected.join(', ')}`);
  }
}

function string(value, path, pattern) {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string');
  if (pattern && !pattern.test(value)) fail(path, 'has an invalid format');
  return value;
}

function httpsUrl(value, path) {
  const text = string(value, path);
  let url;
  try {
    url = new URL(text);
  } catch {
    fail(path, 'must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail(path, 'must be HTTPS without credentials, query, or fragment');
  }
  return text;
}

function releaseManifest(value, path, platform, brandId, channel, requirePublicationEvidence) {
  const manifest = record(value, path);
  if (!RELEASE_MANIFEST_VERSIONS.has(manifest.releaseManifestFormatVersion)) {
    fail(path, 'format version must be 1 or 2');
  }
  if (requirePublicationEvidence && manifest.releaseManifestFormatVersion !== 2) {
    fail(path, 'production releases require observed publication evidence');
  }
  exact(
    manifest,
    manifest.releaseManifestFormatVersion === 2
      ? [...RELEASE_MANIFEST_BASE_KEYS, 'publicationEvidence']
      : RELEASE_MANIFEST_BASE_KEYS,
    path,
  );
  for (const field of ['brandId', 'channel', 'configRevisionId', 'platform']) {
    string(manifest[field], `${path}.${field}`);
  }
  for (const field of ['publisherGitSha', 'sourceGitSha']) {
    string(manifest[field], `${path}.${field}`, RE_GIT_SHA);
  }
  for (const field of ['expectedSnapshotSha256', 'publicKeyringsSha256', 'revisionSha256']) {
    string(manifest[field], `${path}.${field}`, RE_SHA256);
  }
  string(manifest.configRevisionId, `${path}.configRevisionId`, RE_REVISION);
  httpsUrl(manifest.telemetryEndpoint, `${path}.telemetryEndpoint`);
  if (manifest.releaseManifestFormatVersion === 2) {
    const evidence = record(manifest.publicationEvidence, `${path}.publicationEvidence`);
    exact(evidence, PUBLICATION_EVIDENCE_KEYS, `${path}.publicationEvidence`);
    const activationVersion = string(
      evidence.activationVersion,
      `${path}.publicationEvidence.activationVersion`,
      RE_MONOTONIC_VERSION,
    );
    if (activationVersion === '0') {
      fail(`${path}.publicationEvidence.activationVersion`, 'must be greater than zero');
    }
    const deploymentId = string(evidence.deploymentId, `${path}.publicationEvidence.deploymentId`);
    if (deploymentId.length > 256) fail(`${path}.publicationEvidence.deploymentId`, 'is too long');
    string(
      evidence.deploymentSourceGitSha,
      `${path}.publicationEvidence.deploymentSourceGitSha`,
      RE_GIT_SHA,
    );
    if (evidence.deploymentSourceGitSha !== manifest.sourceGitSha) {
      fail(`${path}.publicationEvidence.deploymentSourceGitSha`, 'must equal sourceGitSha');
    }
    string(evidence.keyId, `${path}.publicationEvidence.keyId`, RE_KEY_ID);
    string(evidence.pointerSha256, `${path}.publicationEvidence.pointerSha256`, RE_SHA256);
    string(evidence.verifiedAt, `${path}.publicationEvidence.verifiedAt`, RE_TIMESTAMP);
    if (Number.isNaN(Date.parse(evidence.verifiedAt))) {
      fail(`${path}.publicationEvidence.verifiedAt`, 'must be a valid timestamp');
    }
  }
  if (
    manifest.brandId !== brandId ||
    manifest.channel !== channel ||
    manifest.platform !== platform
  ) {
    fail(path, `must target ${brandId}/${platform}/${channel}`);
  }
  return manifest;
}

function compliance(value, path) {
  const declaration = record(value, path);
  exact(declaration, ['checklist', 'disclosedFeatures'], path);
  if (!Array.isArray(declaration.disclosedFeatures)) {
    fail(`${path}.disclosedFeatures`, 'must be an array');
  }
  const features = declaration.disclosedFeatures.map((entry, index) =>
    string(entry, `${path}.disclosedFeatures[${index}]`, RE_DISCLOSED_FEATURE),
  );
  if (
    new Set(features).size !== features.length ||
    features.some((entry, i) => entry !== [...features].sort()[i])
  ) {
    fail(`${path}.disclosedFeatures`, 'must be unique and lexicographically sorted');
  }
  const checklist = record(declaration.checklist, `${path}.checklist`);
  exact(checklist, CHECKLIST_KEYS, `${path}.checklist`);
  for (const key of CHECKLIST_KEYS) {
    if (checklist[key] !== true) fail(`${path}.checklist.${key}`, 'must be true');
  }
  return declaration;
}

function desktopDistribution(value, path, brandId, channel) {
  if (value === null) return null;
  const distribution = record(value, path);
  exact(distribution, ['credentialEnvironment', 'r2Bucket', 'r2Prefix', 'updateUrl'], path);
  const updateUrl = httpsUrl(distribution.updateUrl, `${path}.updateUrl`);
  const credentialEnvironment = string(
    distribution.credentialEnvironment,
    `${path}.credentialEnvironment`,
  );
  if (credentialEnvironment !== 'release') {
    fail(`${path}.credentialEnvironment`, 'must equal release');
  }
  const r2Bucket = string(distribution.r2Bucket, `${path}.r2Bucket`, RE_BUCKET);
  const r2Prefix = string(distribution.r2Prefix, `${path}.r2Prefix`, RE_R2_PREFIX);
  const expectedSuffix = `/${r2Prefix.replace(RE_TRAILING_SLASH, '')}`;
  if (!r2Prefix.split('/').includes(brandId) || !r2Prefix.split('/').includes(channel)) {
    fail(`${path}.r2Prefix`, 'must include the brand id and channel as path segments');
  }
  if (!new URL(updateUrl).pathname.replace(RE_TRAILING_SLASH, '').endsWith(expectedSuffix)) {
    fail(path, 'updateUrl path must end with r2Prefix');
  }
  return {
    credentialEnvironment,
    r2Bucket,
    r2Prefix: r2Prefix.replace(RE_TRAILING_SLASH, ''),
    updateUrl,
  };
}

function mobileDistribution(value, path) {
  if (value === null) return null;
  const distribution = record(value, path);
  exact(distribution, ['android', 'easProjectId', 'ios', 'updatesUrl'], path);
  const easProjectId = string(distribution.easProjectId, `${path}.easProjectId`, RE_UUID);
  const updatesUrl = httpsUrl(distribution.updatesUrl, `${path}.updatesUrl`);
  if (updatesUrl !== `https://u.expo.dev/${easProjectId}`) {
    fail(`${path}.updatesUrl`, 'must be the EAS update URL for easProjectId');
  }
  const ios = record(distribution.ios, `${path}.ios`);
  exact(ios, ['appleTeamId', 'ascAppId'], `${path}.ios`);
  string(ios.appleTeamId, `${path}.ios.appleTeamId`, RE_TEAM_ID);
  string(ios.ascAppId, `${path}.ios.ascAppId`, RE_ASC_APP_ID);
  const android = record(distribution.android, `${path}.android`);
  exact(android, ['track'], `${path}.android`);
  if (android.track !== 'internal') fail(`${path}.android.track`, 'must be internal');
  return distribution;
}

function parseBrandBuildMatrix(value, options = {}) {
  const matrix = structuredClone(record(value, 'matrix'));
  exact(matrix, ['brandBuildMatrixVersion', 'brands'], 'matrix');
  if (matrix.brandBuildMatrixVersion !== BUILD_MATRIX_VERSION) {
    fail('matrix.brandBuildMatrixVersion', 'must be 1');
  }
  if (!Array.isArray(matrix.brands) || matrix.brands.length === 0) {
    fail('matrix.brands', 'must be a non-empty array');
  }
  if (options.sign && !options.build) fail('options.sign', 'sign requires build=true');
  if (options.upload && !options.sign) fail('options.upload', 'upload requires sign=true');
  const seenBrands = new Set();
  const destinations = [];
  const projects = new Set();
  const appStoreApps = new Set();
  const brands = matrix.brands.map((raw, index) => {
    const path = `matrix.brands[${index}]`;
    const brand = record(raw, path);
    exact(
      brand,
      ['brandId', 'channel', 'compliance', 'distribution', 'releaseManifests', 'sourceRoot'],
      path,
    );
    const brandId = string(brand.brandId, `${path}.brandId`, RE_BRAND_ID);
    if (seenBrands.has(brandId)) fail(`${path}.brandId`, 'must be unique');
    seenBrands.add(brandId);
    if (brand.channel !== 'canary' && brand.channel !== 'stable') {
      fail(`${path}.channel`, 'must be canary or stable');
    }
    if (brand.sourceRoot !== '.' && brand.sourceRoot !== 'examples/acme-zenith') {
      fail(`${path}.sourceRoot`, 'must be . or examples/acme-zenith');
    }
    const requirePublicationEvidence = options.build || brand.sourceRoot === '.';
    const manifests = record(brand.releaseManifests, `${path}.releaseManifests`);
    exact(manifests, PLATFORMS, `${path}.releaseManifests`);
    const declarations = record(brand.compliance, `${path}.compliance`);
    exact(declarations, PLATFORMS, `${path}.compliance`);
    for (const platform of PLATFORMS) {
      manifests[platform] = releaseManifest(
        manifests[platform],
        `${path}.releaseManifests.${platform}`,
        platform,
        brandId,
        brand.channel,
        requirePublicationEvidence,
      );
      declarations[platform] = compliance(declarations[platform], `${path}.compliance.${platform}`);
    }
    for (const field of [
      'publisherGitSha',
      'sourceGitSha',
      'configRevisionId',
      'revisionSha256',
      'publicKeyringsSha256',
    ]) {
      if (PLATFORMS.some((platform) => manifests[platform][field] !== manifests.desktop[field])) {
        fail(`${path}.releaseManifests`, `all platforms must share ${field}`);
      }
    }
    if (requirePublicationEvidence) {
      for (const field of ['deploymentId', 'deploymentSourceGitSha', 'keyId', 'verifiedAt']) {
        if (
          PLATFORMS.some(
            (platform) =>
              manifests[platform].publicationEvidence[field] !==
              manifests.desktop.publicationEvidence[field],
          )
        ) {
          fail(`${path}.releaseManifests`, `all platforms must share publicationEvidence.${field}`);
        }
      }
    }
    const distribution = record(brand.distribution, `${path}.distribution`);
    exact(distribution, ['desktop', 'mobile'], `${path}.distribution`);
    distribution.desktop = desktopDistribution(
      distribution.desktop,
      `${path}.distribution.desktop`,
      brandId,
      brand.channel,
    );
    distribution.mobile = mobileDistribution(distribution.mobile, `${path}.distribution.mobile`);
    if (options.build && (distribution.desktop === null || distribution.mobile === null)) {
      fail(
        `${path}.distribution`,
        'desktop and mobile delivery inputs are required when build=true',
      );
    }
    if (distribution.desktop) {
      const collision = destinations.some(
        ({ bucket, prefix }) =>
          bucket === distribution.desktop.r2Bucket &&
          (prefix === distribution.desktop.r2Prefix ||
            prefix.startsWith(`${distribution.desktop.r2Prefix}/`) ||
            distribution.desktop.r2Prefix.startsWith(`${prefix}/`)),
      );
      if (collision) {
        fail(`${path}.distribution.desktop`, 'R2 prefixes in one bucket must not overlap');
      }
    }
    if (distribution.mobile && projects.has(distribution.mobile.easProjectId)) {
      fail(`${path}.distribution.mobile.easProjectId`, 'must be unique');
    }
    if (distribution.mobile && appStoreApps.has(distribution.mobile.ios.ascAppId)) {
      fail(`${path}.distribution.mobile.ios.ascAppId`, 'must be unique');
    }
    if (distribution.desktop) {
      destinations.push({
        bucket: distribution.desktop.r2Bucket,
        prefix: distribution.desktop.r2Prefix,
      });
    }
    if (distribution.mobile) {
      projects.add(distribution.mobile.easProjectId);
      appStoreApps.add(distribution.mobile.ios.ascAppId);
    }
    return brand;
  });
  return { brandBuildMatrixVersion: BUILD_MATRIX_VERSION, brands };
}

function buildMatrixPlan(matrix, options = {}) {
  const parsed = parseBrandBuildMatrix(matrix, options);
  return {
    brands: { include: parsed.brands },
    targets: {
      include: parsed.brands.flatMap((brand) =>
        PLATFORMS.map((platform) => ({ brandId: brand.brandId, channel: brand.channel, platform })),
      ),
    },
  };
}

function strictBoolean(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(name, 'must be true or false');
}

function runCli(argv = process.argv.slice(2), env = process.env) {
  const { createHash } = require('node:crypto');
  const { appendFileSync, readFileSync } = require('node:fs');
  const { parseArgs } = require('node:util');
  const { values } = parseArgs({
    args: argv,
    options: {
      build: { type: 'string', default: 'false' },
      'matrix-file': { type: 'string' },
      sign: { type: 'string', default: 'false' },
      upload: { type: 'string', default: 'false' },
    },
    strict: true,
  });
  if (!values['matrix-file']) fail('--matrix-file', 'is required');
  const bytes = readFileSync(values['matrix-file']);
  const text = bytes.toString('utf8');
  let matrix;
  try {
    matrix = JSON.parse(text);
  } catch {
    fail('--matrix-file', 'must contain valid JSON');
  }
  const plan = buildMatrixPlan(matrix, {
    build: strictBoolean(values.build, '--build'),
    sign: strictBoolean(values.sign, '--sign'),
    upload: strictBoolean(values.upload, '--upload'),
  });
  const outputs = [
    `brands=${JSON.stringify(plan.brands)}`,
    `delivery_descriptor_sha256=${createHash('sha256').update(bytes).digest('hex')}`,
    `targets=${JSON.stringify(plan.targets)}`,
  ];
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
  else console.log(outputs.join('\n'));
  return plan;
}

if (require.main === module) runCli();

module.exports = {
  BUILD_MATRIX_VERSION,
  CHECKLIST_KEYS,
  PLATFORMS,
  buildMatrixPlan,
  parseBrandBuildMatrix,
  runCli,
};
