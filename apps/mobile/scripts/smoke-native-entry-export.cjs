const { spawn } = require('node:child_process');
const { mkdir, mkdtemp, readFile, rm, stat } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const process = require('node:process');
const { isObjectEmpty } = require('foxts/is-object-empty');

const projectRoot = resolve(__dirname, '..');
const temporaryRoot = join(projectRoot, 'expo-export');
const expoCli = require.resolve('expo/bin/cli');
const platforms = ['android', 'ios'];
const requiredRouteModules = [
  '/apps/mobile/src/app/_layout.tsx',
  '/apps/mobile/src/app/index.tsx',
  '/apps/mobile/src/app/host/[hostId]/index.tsx',
  '/apps/mobile/src/app/host/[hostId]/terminal/index.tsx',
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

  console.log(
    `validated ${platform}: ${platformMetadata.bundle} (${platformMetadata.assets.length} assets)`,
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
