#!/usr/bin/env node
// Release gate for the bundled immutable config: a production store binary must compile the
// generated per-platform modules, never the committed { bundle: null } sentinel. Runs two ways:
// `config:verify-release` checks both platforms before a build, and `--hook` runs as
// eas-build-pre-install inside the EAS project archive (production profile only), so an archive
// that dropped the generated modules fails the build instead of shipping empty defaults.
// Dependency-free on purpose — the pre-install hook runs before node_modules exists.
'use strict';
const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const process = require('node:process');

const CONFIG_DIR = resolve(__dirname, '../src/runtime/config');
const PLATFORMS = new Set(['android', 'ios']);
const CONFORMANCE_FIXTURE_PUBLIC_KEYS = new Set([
  '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  'PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw',
  '_FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU',
]);

function loadGeneratedBundle(platform, configDir = CONFIG_DIR) {
  const path = join(configDir, `bundled.generated.${platform}.ts`);
  if (!existsSync(path)) {
    throw new Error(
      `missing generated config module ${path} — run \`pnpm -F @linkcode/mobile config:render\` ` +
        'with pinned publisher inputs before a production build',
    );
  }
  const source = readFileSync(path, 'utf8');
  // render-config-bundle.mts writes exactly one `= { bundle: <json> };` object literal.
  const start = source.indexOf('= {');
  const end = source.lastIndexOf('};');
  if (start === -1 || end <= start) {
    throw new Error(`${path} does not hold the generated config module shape`);
  }
  const module = JSON.parse(source.slice(start + 2, end + 1).replace('{ bundle:', '{ "bundle":'));
  const bundle = module.bundle;
  if (bundle === null || typeof bundle !== 'object') {
    throw new Error(`${path} holds the development sentinel, not a rendered ${platform} bundle`);
  }
  if (bundle.platform !== platform) {
    throw new Error(`${path} targets ${String(bundle.platform)}, expected ${platform}`);
  }
  if (
    !bundle.endpoints ||
    bundle.endpoints.emergency === null ||
    bundle.endpoints.emergency === undefined
  ) {
    throw new Error(`${path} carries no emergency endpoint`);
  }
  const emergencyKeyring = bundle.keyrings && bundle.keyrings.emergency;
  // eslint-disable-next-line sukka/prefer-foxts-object-size -- This pre-install gate has no dependencies.
  if (!emergencyKeyring || Object.keys(emergencyKeyring).length === 0) {
    throw new Error(`${path} carries no emergency public keys`);
  }
  if (Object.values(emergencyKeyring).some((key) => CONFORMANCE_FIXTURE_PUBLIC_KEYS.has(key))) {
    throw new Error(`${path} emergency keyring contains the conformance fixture key`);
  }
  const provenance = bundle.provenance;
  if (
    provenance === null ||
    typeof provenance !== 'object' ||
    typeof provenance.sourceGitSha !== 'string' ||
    typeof provenance.configRevisionId !== 'string'
  ) {
    throw new Error(`${path} carries no render provenance — re-render with pinned inputs`);
  }
  return bundle;
}

function verifyReleaseConfig(platforms, configDir = CONFIG_DIR) {
  const bundles = platforms.map((platform) => [platform, loadGeneratedBundle(platform, configDir)]);
  // Every platform module must come from one render invocation: same target and provenance.
  const provenances = new Set(
    bundles.map(([, bundle]) =>
      JSON.stringify([
        bundle.brandId,
        bundle.channel,
        bundle.provenance && bundle.provenance.sourceGitSha,
        bundle.provenance && bundle.provenance.configRevisionId,
      ]),
    ),
  );
  if (provenances.size > 1) {
    throw new Error(
      'generated ios and android config modules disagree on target or provenance — ' +
        're-render both platforms in one config:render invocation',
    );
  }
  for (const [platform, bundle] of bundles) {
    console.log(
      `verified ${bundle.brandId}/${platform}/${bundle.channel} ` +
        `(source ${String(bundle.provenance.sourceGitSha).slice(0, 12)}, ` +
        `revision ${bundle.provenance.configRevisionId})`,
    );
  }
}

function main(argv, env) {
  if (argv.includes('--hook')) {
    // Development and preview EAS builds intentionally keep the sentinel.
    if (env.EAS_BUILD_PROFILE !== 'production') return;
    const platform = env.EAS_BUILD_PLATFORM;
    verifyReleaseConfig(PLATFORMS.has(platform) ? [platform] : [...PLATFORMS]);
    return;
  }
  verifyReleaseConfig([...PLATFORMS]);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (error) {
    // Dependency-free on purpose (pre-install hook) — no foxts extractErrorMessage here.
    console.error('verify-release-config:', error);
    process.exitCode = 1;
  }
}

module.exports = { loadGeneratedBundle, main, verifyReleaseConfig };
