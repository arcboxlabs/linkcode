// Renders the iOS and Android build bundles AND brand identities through the pinned config
// publisher checkout: the bundles land in bundled.generated.<platform>.ts (which Metro resolves
// over the committed { bundle: null } sentinel) and the identity artifacts, brand assets, and
// Expo overlay land in apps/mobile/generated/ for app.config.ts. Run via
// `pnpm -F @linkcode/mobile config:render --publisher …` (no `--` separator). Every input is an
// explicit pin; there is no default checkout, no fetch, and no stale fallback. `--check`
// re-renders into a temp dir and fails on any byte drift instead of silently regenerating.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assertBrandIdentityMatchesBundle } from '@linkcode/common/config';
import {
  renderBrandIdentityWithPublisher,
  renderConfigBundleWithPublisher,
  stageBrandAssets,
} from '@linkcode/common/node';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { trueFn } from 'foxts/noop';
import { deriveExpoBrandOverlay, serializeExpoBrandOverlay } from '../src/build/expo-brand';

const USAGE = String.raw`Usage: config:render \
  --publisher <dir>             config publisher checkout root \
  --publisher-git-sha <sha>     exact lowercase 40-hex commit the publisher checkout must be at \
  --structural <dir>            structural config source directory (contains brands.manifest.yaml) \
  --source-git-sha <sha>        exact lowercase 40-hex commit the source checkout must be at \
  --revision <file>             config revision metadata JSON \
  --keyrings <file>             public keyrings JSON \
  --brand <id> --channel <canary|stable> \
  --telemetry-endpoint <url>    authenticated telemetry endpoint for this target \
  --release-manifest-ios <file>     optional per-target manifest digest-binding inputs/snapshot \
  --release-manifest-android <file> required together with --release-manifest-ios \
  --check                       verify all generated outputs are byte-identical; never rewrite`;

const MOBILE_PLATFORMS = ['ios', 'android'] as const;
type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

const collator = new Intl.Collator();

function bail(message: string): never {
  console.error(`config:render: ${message}\n\n${USAGE}`);
  process.exit(1);
}

interface RenderRoots {
  /** Receives bundled.generated.<platform>.ts (real: src/runtime/config). */
  readonly configDir: string;
  /** Receives brand-identity.*.json, brand-assets/, expo-brand.json (real: generated/). */
  readonly generatedDir: string;
}

async function renderInto(
  roots: RenderRoots,
  values: Record<string, string | boolean | undefined>,
): Promise<void> {
  const channel = values.channel ?? bail('--channel is required');
  if (channel !== 'canary' && channel !== 'stable') {
    bail('--channel must be canary or stable');
  }
  const releaseManifests = {
    android: values['release-manifest-android'],
    ios: values['release-manifest-ios'],
  };
  if ((releaseManifests.ios === undefined) !== (releaseManifests.android === undefined)) {
    bail('--release-manifest-ios and --release-manifest-android must be passed together');
  }
  const structuralDir = String(values.structural ?? bail('--structural is required'));
  const shared = {
    brandId: String(values.brand ?? bail('--brand is required')),
    channel,
    publisherDir: String(values.publisher ?? bail('--publisher is required')),
    publisherGitSha: String(values['publisher-git-sha'] ?? bail('--publisher-git-sha is required')),
    sourceGitSha: String(values['source-git-sha'] ?? bail('--source-git-sha is required')),
    structuralDir,
  } as const;
  await mkdir(roots.configDir, { recursive: true });
  await mkdir(roots.generatedDir, { recursive: true });

  const workDir = await mkdtemp(join(tmpdir(), 'linkcode-config-render-'));
  const identities = {} as Record<
    MobilePlatform,
    Awaited<ReturnType<typeof renderBrandIdentityWithPublisher>>
  >;
  try {
    // Both platforms render in one invocation so they can never drift apart in source or inputs.
    for (const platform of MOBILE_PLATFORMS) {
      const outPath = join(workDir, `${platform}.json`);
      const releaseManifest = releaseManifests[platform];
      // eslint-disable-next-line no-await-in-loop -- renders share pinned checkouts sequentially
      const bundle = await renderConfigBundleWithPublisher({
        ...shared,
        keyringsPath: String(values.keyrings ?? bail('--keyrings is required')),
        outPath,
        platform,
        ...(typeof releaseManifest === 'string' && { releaseManifestPath: releaseManifest }),
        revisionPath: String(values.revision ?? bail('--revision is required')),
        telemetryEndpoint: String(
          values['telemetry-endpoint'] ?? bail('--telemetry-endpoint is required'),
        ),
      });
      // eslint-disable-next-line no-await-in-loop -- one identity render per platform
      const identity = await renderBrandIdentityWithPublisher({
        ...shared,
        outPath: resolve(roots.generatedDir, `brand-identity.${platform}.json`),
        platform,
      });
      // Same target, same manifest commit — or one of the two artifacts is stale.
      assertBrandIdentityMatchesBundle(identity, bundle);
      identities[platform] = identity;
      // eslint-disable-next-line no-await-in-loop -- read back the file the render just wrote
      const rendered = await readFile(outPath, 'utf8');
      // The generated module shape is load-bearing: smoke-native-entry-export.cjs parses the
      // object literal back out of it to verify the compiled Hermes export.
      // eslint-disable-next-line no-await-in-loop -- one small write per platform
      await writeFile(
        join(roots.configDir, `bundled.generated.${platform}.ts`),
        '// Generated by scripts/render-config-bundle.mts — do not edit, do not commit.\n' +
          `const generatedConfigModule: unknown = { bundle: ${rendered.trim()} };\n` +
          'export default generatedConfigModule;\n',
      );
      console.log(
        `Rendered ${bundle.brandId}/${platform}/${bundle.channel} from source ` +
          `${bundle.provenance.sourceGitSha} (revision ${bundle.provenance.configRevisionId})`,
      );
    }
  } finally {
    await rm(workDir, { force: true, recursive: true });
  }

  const overlay = deriveExpoBrandOverlay(identities.ios, identities.android);
  stageBrandAssets({
    assetsPath: identities.ios.assetsPath,
    outDir: resolve(roots.generatedDir, 'brand-assets'),
    structuralDir,
  });
  await writeFile(
    resolve(roots.generatedDir, 'expo-brand.json'),
    serializeExpoBrandOverlay(overlay),
  );
  console.log(`Wrote Expo brand overlay for ${overlay.brandId}/${overlay.channel}`);
}

function listFiles(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    collator.compare(a.name, b.name),
  )) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) appendArrayInPlace(files, listFiles(join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files;
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Byte-compares a fresh render against the on-disk outputs; drift is a hard failure so a stale
 * artifact can never ride into a prebuild unnoticed. `relevant` scopes the comparison to the
 * files this renderer owns — src/runtime/config also holds committed, non-generated modules. */
function assertNoDrift(
  freshDir: string,
  realDir: string,
  label: string,
  relevant: (file: string) => boolean,
): void {
  if (!existsSync(realDir)) {
    bail(`--check: ${realDir} does not exist; run config:render without --check first`);
  }
  const fresh = listFiles(freshDir).filter(relevant);
  const real = listFiles(realDir).filter(relevant);
  const drifted = new Set<string>();
  for (const file of fresh) {
    if (!real.includes(file)) drifted.add(`${file} (missing from ${label})`);
    else if (digest(join(freshDir, file)) !== digest(join(realDir, file))) {
      drifted.add(`${file} (content drift)`);
    }
  }
  for (const file of real) {
    if (!fresh.includes(file)) drifted.add(`${file} (stale extra file)`);
  }
  if (drifted.size > 0) {
    bail(
      `--check: ${label} has drifted from the pinned source:\n  ${[...drifted].join('\n  ')}\n` +
        'Re-run config:render with the pinned inputs and commit nothing — generated output is never checked in',
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brand: { type: 'string' },
      channel: { type: 'string' },
      check: { type: 'boolean' },
      keyrings: { type: 'string' },
      publisher: { type: 'string' },
      'publisher-git-sha': { type: 'string' },
      'release-manifest-android': { type: 'string' },
      'release-manifest-ios': { type: 'string' },
      revision: { type: 'string' },
      'source-git-sha': { type: 'string' },
      structural: { type: 'string' },
      'telemetry-endpoint': { type: 'string' },
    },
    strict: true,
  });

  const roots: RenderRoots = {
    configDir: resolve(import.meta.dirname, '../src/runtime/config'),
    generatedDir: resolve(import.meta.dirname, '../generated'),
  };
  if (values.check === true) {
    const freshRoot = await mkdtemp(join(tmpdir(), 'linkcode-config-check-'));
    const fresh: RenderRoots = {
      configDir: join(freshRoot, 'runtime-config'),
      generatedDir: join(freshRoot, 'generated'),
    };
    try {
      await renderInto(fresh, values);
      assertNoDrift(fresh.configDir, roots.configDir, 'src/runtime/config', (file) =>
        MOBILE_PLATFORMS.some((p) => file === `bundled.generated.${p}.ts`),
      );
      assertNoDrift(fresh.generatedDir, roots.generatedDir, 'generated', trueFn);
      console.log('config:render --check: generated output matches the pinned source');
    } finally {
      await rm(freshRoot, { force: true, recursive: true });
    }
    return;
  }
  await renderInto(roots, values);
}

void main();
