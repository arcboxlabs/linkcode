// Renders the desktop build bundle through the pinned config publisher checkout and derives the
// immutable main-process bootstrap. Run via `pnpm -F @linkcode/desktop config:render --publisher …`
// (no `--` separator).
// Every input is an explicit pin; there is no default checkout, no fetch, and no stale fallback.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { configBuildBundleDefaults } from '@linkcode/common/config';
import { renderConfigBundleWithPublisher } from '@linkcode/common/node';

const USAGE = String.raw`Usage: config:render \
  --publisher <dir>             config publisher checkout root \
  --publisher-git-sha <sha>     exact lowercase 40-hex commit the publisher checkout must be at \
  --structural <dir>            structural config source directory (contains brands.manifest.yaml) \
  --source-git-sha <sha>        exact lowercase 40-hex commit the source checkout must be at \
  --revision <file>             config revision metadata JSON \
  --keyrings <file>             public keyrings JSON \
  --brand <id> --channel <canary|stable> \
  --telemetry-endpoint <url>    authenticated telemetry endpoint for this target`;

function bail(message: string): never {
  console.error(`config:render: ${message}\n\n${USAGE}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      brand: { type: 'string' },
      channel: { type: 'string' },
      keyrings: { type: 'string' },
      publisher: { type: 'string' },
      'publisher-git-sha': { type: 'string' },
      revision: { type: 'string' },
      'source-git-sha': { type: 'string' },
      structural: { type: 'string' },
      'telemetry-endpoint': { type: 'string' },
    },
    strict: true,
  });

  const channel = values.channel ?? bail('--channel is required');
  if (channel !== 'canary' && channel !== 'stable') {
    bail('--channel must be canary or stable');
  }
  const generatedDir = resolve(import.meta.dirname, '../generated');
  await mkdir(generatedDir, { recursive: true });
  const outPath = resolve(generatedDir, 'config-build-bundle.json');

  const bundle = await renderConfigBundleWithPublisher({
    brandId: values.brand ?? bail('--brand is required'),
    channel,
    keyringsPath: values.keyrings ?? bail('--keyrings is required'),
    outPath,
    platform: 'desktop',
    publisherDir: values.publisher ?? bail('--publisher is required'),
    publisherGitSha: values['publisher-git-sha'] ?? bail('--publisher-git-sha is required'),
    revisionPath: values.revision ?? bail('--revision is required'),
    sourceGitSha: values['source-git-sha'] ?? bail('--source-git-sha is required'),
    structuralDir: values.structural ?? bail('--structural is required'),
    telemetryEndpoint: values['telemetry-endpoint'] ?? bail('--telemetry-endpoint is required'),
  });

  // Same shape as DesktopConfigBootstrap (src/main/config.ts); parseBootstrap revalidates it at
  // runtime after Vite inlines it into the main bundle.
  const bootstrap = {
    brandId: bundle.brandId,
    channel: bundle.channel,
    defaults: configBuildBundleDefaults(bundle),
    emergencyEndpoint: bundle.endpoints.emergency,
    emergencyPublicKeys: bundle.keyrings.emergency,
    endpoint: bundle.endpoints.normal,
    maximumSchemaVersion: bundle.maximumSchemaVersion,
    publicKeys: bundle.keyrings.normal,
    telemetryEndpoint: bundle.endpoints.telemetry,
  };
  await writeFile(resolve(generatedDir, 'config-bootstrap.json'), JSON.stringify(bootstrap));
  console.log(
    `Rendered ${bundle.brandId}/desktop/${bundle.channel} from source ${bundle.provenance.sourceGitSha} ` +
      `(revision ${bundle.provenance.configRevisionId}) into apps/desktop/generated`,
  );
}

void main();
