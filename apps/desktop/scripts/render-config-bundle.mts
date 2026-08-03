// Renders the desktop build bundle through the pinned config publisher checkout. The raw bundle
// is the only generated config source: vite.main.config.mts validates it and derives the inlined
// bootstrap from it in-process, so there is no second generated file to drift. With
// `--brand-artifacts` (white-label builds) it also renders the immutable brand identity, stages
// the brand's assets, and writes the electron-builder brand overlay from the same pinned source.
// Run via `pnpm -F @linkcode/desktop config:render --publisher …` (no `--` separator).
// Every input is an explicit pin; there is no default checkout, no fetch, and no stale fallback.
// `--check` re-renders into a temp dir and fails on any byte drift against apps/desktop/generated
// instead of silently regenerating.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import {
  electronBuilderBrandConfig,
  serializeElectronBuilderBrandConfig,
} from '../src/build/electron-builder-brand';

const USAGE = String.raw`Usage: config:render \
  --publisher <dir>             config publisher checkout root \
  --publisher-git-sha <sha>     exact lowercase 40-hex commit the publisher checkout must be at \
  --structural <dir>            structural config source directory (contains brands.manifest.yaml) \
  --source-git-sha <sha>        exact lowercase 40-hex commit the source checkout must be at \
  --revision <file>             config revision metadata JSON \
  --keyrings <file>             public keyrings JSON \
  --brand <id> --channel <canary|stable> \
  --telemetry-endpoint <url>    authenticated telemetry endpoint for this target \
  --release-manifest <file>     optional manifest digest-binding inputs and published snapshot \
  --brand-artifacts             also render the brand identity, staged assets, and builder overlay \
  --check                       verify apps/desktop/generated is byte-identical; never rewrite`;

function bail(message: string): never {
  console.error(`config:render: ${message}\n\n${USAGE}`);
  process.exit(1);
}

async function renderInto(
  outDir: string,
  values: Record<string, string | boolean | undefined>,
): Promise<void> {
  const channel = values.channel ?? bail('--channel is required');
  if (channel !== 'canary' && channel !== 'stable') {
    bail('--channel must be canary or stable');
  }
  // Render mode is explicit regeneration: clear the target so a previous render (e.g. a branded
  // one) can never leave stale artifacts next to a fresh render of a different target.
  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { recursive: true });
  const structuralDir = String(values.structural ?? bail('--structural is required'));
  const shared = {
    brandId: String(values.brand ?? bail('--brand is required')),
    channel,
    platform: 'desktop',
    publisherDir: String(values.publisher ?? bail('--publisher is required')),
    publisherGitSha: String(values['publisher-git-sha'] ?? bail('--publisher-git-sha is required')),
    sourceGitSha: String(values['source-git-sha'] ?? bail('--source-git-sha is required')),
    structuralDir,
  } as const;

  const releaseManifest = values['release-manifest'];
  const bundle = await renderConfigBundleWithPublisher({
    ...shared,
    keyringsPath: String(values.keyrings ?? bail('--keyrings is required')),
    outPath: resolve(outDir, 'config-build-bundle.json'),
    ...(typeof releaseManifest === 'string' && { releaseManifestPath: releaseManifest }),
    revisionPath: String(values.revision ?? bail('--revision is required')),
    telemetryEndpoint: String(
      values['telemetry-endpoint'] ?? bail('--telemetry-endpoint is required'),
    ),
  });

  if (values['brand-artifacts'] === true) {
    const identity = await renderBrandIdentityWithPublisher({
      ...shared,
      outPath: resolve(outDir, 'brand-identity.json'),
    });
    // Same target, same manifest commit — or one of the two artifacts is stale.
    assertBrandIdentityMatchesBundle(identity, bundle);

    stageBrandAssets({
      assetsPath: identity.assetsPath,
      outDir: resolve(outDir, 'brand-assets'),
      structuralDir,
    });

    await writeFile(
      resolve(outDir, 'electron-builder.brand.json'),
      serializeElectronBuilderBrandConfig(electronBuilderBrandConfig(identity)),
    );
  }

  console.log(
    `Rendered ${bundle.brandId}/desktop/${bundle.channel} from source ${bundle.provenance.sourceGitSha} ` +
      `(revision ${bundle.provenance.configRevisionId}) into ${outDir}`,
  );
}

function listFiles(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
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

/** Byte-compares a fresh render against the checked-in generated dir; drift is a hard failure so
 * a stale artifact can never ride into a build unnoticed. */
function assertNoDrift(freshDir: string, generatedDir: string): void {
  if (!existsSync(generatedDir)) {
    bail(`--check: ${generatedDir} does not exist; run config:render without --check first`);
  }
  const fresh = listFiles(freshDir);
  const generated = listFiles(generatedDir);
  const drifted = new Set<string>();
  for (const file of fresh) {
    if (!generated.includes(file)) drifted.add(`${file} (missing from generated)`);
    else if (digest(join(freshDir, file)) !== digest(join(generatedDir, file))) {
      drifted.add(`${file} (content drift)`);
    }
  }
  for (const file of generated) {
    if (!fresh.includes(file)) drifted.add(`${file} (stale extra file)`);
  }
  if (drifted.size > 0) {
    bail(
      `--check: apps/desktop/generated has drifted from the pinned source:\n  ${[...drifted].join('\n  ')}\n` +
        'Re-run config:render with the pinned inputs and commit nothing — generated output is never checked in',
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brand: { type: 'string' },
      'brand-artifacts': { type: 'boolean' },
      channel: { type: 'string' },
      check: { type: 'boolean' },
      keyrings: { type: 'string' },
      publisher: { type: 'string' },
      'publisher-git-sha': { type: 'string' },
      'release-manifest': { type: 'string' },
      revision: { type: 'string' },
      'source-git-sha': { type: 'string' },
      structural: { type: 'string' },
      'telemetry-endpoint': { type: 'string' },
    },
    strict: true,
  });

  const generatedDir = resolve(import.meta.dirname, '../generated');
  if (values.check === true) {
    const freshDir = await mkdtemp(join(tmpdir(), 'linkcode-config-check-'));
    try {
      await renderInto(freshDir, values);
      assertNoDrift(freshDir, generatedDir);
      console.log('config:render --check: generated output matches the pinned source');
    } finally {
      await rm(freshDir, { force: true, recursive: true });
    }
    return;
  }
  await renderInto(generatedDir, values);
}

void main();
