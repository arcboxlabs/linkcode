const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { mkdir, mkdtemp, readFile, rm, stat } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const process = require('node:process');
const { isObjectEmpty } = require('foxts/is-object-empty');

const projectRoot = resolve(__dirname, '..');
const temporaryRoot = join(projectRoot, 'expo-export');
const expoCli = require.resolve('expo/bin/cli');
const platforms = ['android', 'ios'];
const RE_WHITESPACE = /\s/g;
const requiredRouteModules = [
  '/apps/mobile/src/app/_layout.tsx',
  '/apps/mobile/src/app/index.tsx',
  '/apps/mobile/src/app/(tabs)/threads/index.tsx',
  '/apps/mobile/src/app/(tabs)/terminals/index.tsx',
  '/apps/mobile/src/runtime/config/mobile.ts',
  '/apps/mobile/src/runtime/config/background.ts',
  '/packages/foundation/common/src/config/core.ts',
  '/packages/foundation/common/src/config-signing-poc/index.ts',
];

async function runExpoExport(platform, outputDirectory) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        expoCli,
        'export',
        '--platform',
        platform,
        '--output-dir',
        outputDirectory,
        '--dump-assetmap',
        '--source-maps',
        'external',
        '--clear',
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          CI: '1',
          EXPO_PUBLIC_CONFIG_SIGNING_POC: '1',
          EXPO_NO_TELEMETRY: '1',
          NODE_ENV: 'production',
        },
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      },
    );

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Expo ${platform} export failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function assertNonemptyFile(path, description) {
  const file = await stat(path);
  if (!file.isFile() || file.size === 0) {
    throw new Error(`${description} is missing or empty: ${path}`);
  }
}

async function validateExport(platform, outputDirectory) {
  const metadataPath = join(outputDirectory, 'metadata.json');
  const assetMapPath = join(outputDirectory, 'assetmap.json');
  const metadata = await readJson(metadataPath);
  const platformMetadata = metadata?.fileMetadata?.[platform];

  if (!platformMetadata || typeof platformMetadata.bundle !== 'string') {
    throw new Error(`${metadataPath} does not declare a ${platform} JavaScript bundle`);
  }
  if (!platformMetadata.bundle.endsWith('.hbc')) {
    throw new Error(`${platform} export did not produce a Hermes bytecode bundle`);
  }

  const bundlePath = join(outputDirectory, platformMetadata.bundle);
  await assertNonemptyFile(bundlePath, `${platform} JavaScript bundle`);
  const sourceMapPath = `${bundlePath}.map`;
  await assertNonemptyFile(sourceMapPath, `${platform} JavaScript source map`);
  const sourceMap = await readJson(sourceMapPath);
  if (!Array.isArray(sourceMap.sources)) {
    throw new TypeError(`${sourceMapPath} does not declare bundled source modules`);
  }
  for (const requiredRoute of requiredRouteModules) {
    if (!sourceMap.sources.some((source) => source === requiredRoute)) {
      throw new Error(`${platform} bundle did not include Expo Router module ${requiredRoute}`);
    }
  }

  if (!Array.isArray(platformMetadata.assets) || platformMetadata.assets.length === 0) {
    throw new Error(`${metadataPath} does not declare any ${platform} assets`);
  }

  await Promise.all(
    platformMetadata.assets.map((asset) => {
      if (!asset || typeof asset.path !== 'string') {
        throw new Error(`${metadataPath} contains an invalid ${platform} asset path`);
      }
      return assertNonemptyFile(join(outputDirectory, asset.path), `${platform} asset`);
    }),
  );

  const assetMap = await readJson(assetMapPath);
  if (!assetMap || typeof assetMap !== 'object' || isObjectEmpty(assetMap)) {
    throw new Error(`${assetMapPath} is empty`);
  }

  await validateBundledConfig(platform, sourceMap);

  console.log(
    `validated ${platform}: ${platformMetadata.bundle} (${platformMetadata.assets.length} assets)`,
  );
}

// Proves the exact generated config target was compiled into this platform's Hermes export:
// the platform-specific generated module must win over the committed sentinel, and its compiled
// source must carry the bundle's own target and provenance. This validates the export
// (Metro -> Hermes bytecode), not on-device runtime behavior.
async function validateBundledConfig(platform, sourceMap) {
  const configDir = join(projectRoot, 'src/runtime/config');
  const generatedPath = join(configDir, `bundled.generated.${platform}.ts`);
  const generated = existsSync(generatedPath);
  const expectedModule = generated
    ? `/apps/mobile/src/runtime/config/bundled.generated.${platform}.ts`
    : '/apps/mobile/src/runtime/config/bundled.generated.ts';
  const moduleIndex = sourceMap.sources.indexOf(expectedModule);
  if (moduleIndex === -1) {
    throw new Error(`${platform} bundle did not include generated config module ${expectedModule}`);
  }
  if (!generated) {
    console.log(`validated ${platform}: development config sentinel bundled (no generated target)`);
    return;
  }

  // render-config-bundle.mts writes exactly one `= { bundle: <json> };` object literal.
  const moduleSource = await readFile(generatedPath, 'utf8');
  const literalStart = moduleSource.indexOf('= {');
  const literalEnd = moduleSource.lastIndexOf('};');
  if (literalStart === -1 || literalEnd <= literalStart) {
    throw new Error(`${generatedPath} does not hold the generated config module shape`);
  }
  const module = JSON.parse(
    moduleSource.slice(literalStart + 2, literalEnd + 1).replace('{ bundle:', '{ "bundle":'),
  );
  const bundle = module?.bundle;
  if (!bundle || bundle.platform !== platform) {
    throw new Error(`${generatedPath} does not hold a ${platform} build bundle`);
  }
  const compiledSource = Array.isArray(sourceMap.sourcesContent)
    ? sourceMap.sourcesContent[moduleIndex]
    : null;
  if (typeof compiledSource !== 'string') {
    throw new TypeError(`${platform} source map does not embed ${expectedModule}`);
  }
  for (const marker of [
    `"brandId":"${bundle.brandId}"`,
    `"platform":"${platform}"`,
    `"sourceGitSha":"${bundle.provenance.sourceGitSha}"`,
    `"sha256":"${bundle.snapshot.sha256}"`,
  ]) {
    if (!compiledSource.replaceAll(RE_WHITESPACE, '').includes(marker)) {
      throw new Error(`${platform} compiled config module is missing ${marker}`);
    }
  }
  console.log(
    `validated ${platform}: generated config target ${bundle.brandId}/${platform}/${bundle.channel} ` +
      `(source ${bundle.provenance.sourceGitSha.slice(0, 12)}) compiled into Hermes export`,
  );
}

async function main() {
  await mkdir(temporaryRoot, { recursive: true });
  const runRoot = await mkdtemp(join(temporaryRoot, 'native-entry-smoke-'));

  try {
    for (const platform of platforms) {
      const outputDirectory = join(runRoot, platform);
      console.log(`exporting production app entry for ${platform}`);
      // Keep Metro exports isolated so one platform cannot mask or interfere with the other.
      // eslint-disable-next-line no-await-in-loop -- platforms must export sequentially
      await runExpoExport(platform, outputDirectory);
      // eslint-disable-next-line no-await-in-loop -- validate before starting another export
      await validateExport(platform, outputDirectory);
    }
  } finally {
    await rm(runRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
