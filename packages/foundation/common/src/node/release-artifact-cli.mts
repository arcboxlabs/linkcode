import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { ReleaseManifestBinding, StoreComplianceDeclaration } from './release-artifact';
import {
  createReleaseArtifactProvenance,
  parseReleaseArtifactInputs,
  verifyReleaseArtifactProvenance,
  writeReleaseArtifactProvenance,
} from './release-artifact';

const USAGE = `Usage: release-artifact
  --artifact-root <dir> --artifact <relative-file> [--artifact <relative-file> ...]
  --bundle <json-or-generated-ts> --brand-identity <json> --brand-manifest <yaml>
  --delivery-descriptor <json> --release-manifest <json> --compliance <json>
  --expected-delivery-sha256 <sha256> --client-git-sha <sha> --out <json> [--signed]
  release-artifact --artifact-root <dir> --verify <provenance.json>
  --bundle <json-or-generated-ts> --brand-identity <json> --brand-manifest <yaml>
  --delivery-descriptor <json> --release-manifest <json> --client-git-sha <sha>
  --expected-brand <id> --expected-delivery-sha256 <sha256>
  --expected-platform <platform> [--signed]`;

function bail(message: string): never {
  throw new TypeError(`release-artifact: ${message}\n\n${USAGE}`);
}

async function json(path: string, label: string): Promise<{ bytes: Buffer; value: unknown }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    bail(`${label} is missing or unreadable: ${path}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString()) };
  } catch {
    bail(`${label} is not valid JSON: ${path}`);
  }
}

async function bundle(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8');
  if (path.endsWith('.json')) return JSON.parse(text);
  const start = text.indexOf('= { bundle:');
  const end = text.lastIndexOf('};');
  if (start === -1 || end <= start) bail(`generated bundle has an invalid module shape: ${path}`);
  return JSON.parse(text.slice(start + 2, end + 1).replace('{ bundle:', '{ "bundle":')).bundle;
}

function releaseManifest(value: unknown): ReleaseManifestBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    bail('release manifest must be an object');
  }
  const manifest = value as Record<string, unknown>;
  const field = (name: string): string => {
    const result = manifest[name];
    if (typeof result !== 'string' || result === '') {
      bail(`release manifest field ${name} is required`);
    }
    return result;
  };
  return {
    brandId: field('brandId'),
    channel: field('channel'),
    configRevisionId: field('configRevisionId'),
    expectedSnapshotSha256: field('expectedSnapshotSha256'),
    platform: field('platform'),
    publisherGitSha: field('publisherGitSha'),
    sourceGitSha: field('sourceGitSha'),
  };
}

function compliance(value: unknown): StoreComplianceDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    bail('compliance declaration must be an object');
  }
  const declaration = value as Record<string, unknown>;
  if (
    typeof declaration.checklist !== 'object' ||
    declaration.checklist === null ||
    Array.isArray(declaration.checklist) ||
    !Array.isArray(declaration.disclosedFeatures) ||
    declaration.disclosedFeatures.some((entry) => typeof entry !== 'string')
  ) {
    bail('compliance declaration must contain checklist and disclosedFeatures');
  }
  return {
    checklist: Object.entries(declaration.checklist).reduce<Record<string, boolean>>(
      (acc, [key, entry]) => {
        if (typeof entry !== 'boolean') bail(`compliance checklist field ${key} must be boolean`);
        // Own data property, never a prototype write: `acc.__proto__ = …` would mutate the object.
        Object.defineProperty(acc, key, {
          configurable: true,
          enumerable: true,
          value: entry,
          writable: true,
        });
        return acc;
      },
      {},
    ),
    disclosedFeatures: declaration.disclosedFeatures.filter(
      (entry): entry is string => typeof entry === 'string',
    ),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      artifact: { type: 'string', multiple: true },
      'artifact-root': { type: 'string' },
      'brand-identity': { type: 'string' },
      'brand-manifest': { type: 'string' },
      bundle: { type: 'string' },
      'client-git-sha': { type: 'string' },
      compliance: { type: 'string' },
      'delivery-descriptor': { type: 'string' },
      'expected-brand': { type: 'string' },
      'expected-delivery-sha256': { type: 'string' },
      'expected-platform': { type: 'string' },
      out: { type: 'string' },
      'release-manifest': { type: 'string' },
      signed: { type: 'boolean', default: false },
      verify: { type: 'string' },
    },
    strict: true,
  });
  const required = (name: keyof typeof values): string => {
    const value = values[name];
    if (typeof value !== 'string') bail(`--${name} is required`);
    return value;
  };
  const artifactRoot = required('artifact-root');
  if (values.verify !== undefined) {
    const input = await json(values.verify, 'release provenance');
    const releaseInput = await json(required('release-manifest'), 'release manifest');
    const parsed = parseReleaseArtifactInputs(
      await bundle(required('bundle')),
      await json(required('brand-identity'), 'brand identity').then((result) => result.value),
    );
    const provenance = await verifyReleaseArtifactProvenance({
      artifactRoot,
      brandIdentity: parsed.identity,
      brandManifestBytes: await readFile(required('brand-manifest')),
      brandId: required('expected-brand'),
      bundle: parsed.bundle,
      clientGitSha: required('client-git-sha'),
      deliveryDescriptorBytes: await readFile(required('delivery-descriptor')),
      expectedDeliveryDescriptorSha256: required('expected-delivery-sha256'),
      platform: required('expected-platform'),
      provenance: input.value,
      releaseManifest: releaseManifest(releaseInput.value),
      releaseManifestBytes: releaseInput.bytes,
      signed: values.signed,
    });
    process.stdout.write(
      `verified ${provenance.artifacts.length} artifact(s) for ${provenance.brandId}/${provenance.platform}/${provenance.channel}\n`,
    );
    return;
  }
  if (values.artifact === undefined) bail('--artifact is required at least once');
  const artifactPaths = values.artifact;
  const identityInput = await json(required('brand-identity'), 'brand identity');
  const releaseInput = await json(required('release-manifest'), 'release manifest');
  const complianceInput = await json(required('compliance'), 'compliance declaration');
  const parsed = parseReleaseArtifactInputs(await bundle(required('bundle')), identityInput.value);
  const provenance = await createReleaseArtifactProvenance({
    artifactPaths,
    artifactRoot,
    brandIdentity: parsed.identity,
    brandManifestBytes: await readFile(required('brand-manifest')),
    bundle: parsed.bundle,
    clientGitSha: required('client-git-sha'),
    compliance: compliance(complianceInput.value),
    deliveryDescriptorBytes: await readFile(required('delivery-descriptor')),
    expectedDeliveryDescriptorSha256: required('expected-delivery-sha256'),
    releaseManifest: releaseManifest(releaseInput.value),
    releaseManifestBytes: releaseInput.bytes,
    signed: values.signed,
  });
  await writeReleaseArtifactProvenance(required('out'), provenance, artifactRoot);
  process.stdout.write(
    `wrote provenance for ${provenance.brandId}/${provenance.platform}/${provenance.channel}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${extractErrorMessage(error)}\n`);
  process.exitCode = 1;
});
