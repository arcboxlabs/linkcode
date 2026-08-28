/// <reference types="node" />
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { BrandIdentityArtifact, ConfigBuildBundle } from '../config';
import {
  assertBrandIdentityMatchesBundle,
  canonicalizeJson,
  configBuildBundleDefaults,
  parseBrandIdentityArtifact,
  parseConfigBuildBundle,
} from '../config';
import type { JsonValue } from '../config/types';
import type { StoreComplianceDeclaration } from './release-compliance';
import { assertStoreCompliance } from './release-compliance';

export type { StoreComplianceDeclaration } from './release-compliance';
export { assertStoreCompliance } from './release-compliance';

export interface ReleaseManifestBinding {
  readonly brandId: string;
  readonly channel: string;
  readonly configRevisionId: string;
  readonly expectedSnapshotSha256: string;
  readonly platform: string;
  readonly publisherGitSha: string;
  readonly sourceGitSha: string;
}

export interface ReleaseArtifactProvenance {
  readonly artifacts: ReadonlyArray<{
    readonly brandManifestSha256: string;
    readonly configRevisionId: string;
    readonly defaultsSha256: string;
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  }>;
  readonly brandId: string;
  readonly channel: string;
  readonly clientGitSha: string;
  readonly configSnapshotSha256: string;
  readonly deliveryDescriptorSha256: string;
  readonly platform: string;
  readonly publisherGitSha: string;
  readonly releaseArtifactProvenanceVersion: 1;
  readonly releaseManifestSha256: string;
  readonly signed: boolean;
  readonly sourceGitSha: string;
}

const RE_GIT_SHA = /^[0-9a-f]{40}$/;
const RE_SHA256 = /^[0-9a-f]{64}$/;

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function deliveryDescriptorSha256(bytes: Uint8Array, expected: string): string {
  if (!RE_SHA256.test(expected)) {
    throw new TypeError('expectedDeliveryDescriptorSha256 must be a lowercase SHA-256 digest');
  }
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error('delivery descriptor does not match the reviewed release matrix');
  }
  return actual;
}

function assertReleaseBinding(bundle: ConfigBuildBundle, manifest: ReleaseManifestBinding): void {
  const checks = [
    ['brandId', bundle.brandId, manifest.brandId],
    ['channel', bundle.channel, manifest.channel],
    ['platform', bundle.platform, manifest.platform],
    ['sourceGitSha', bundle.provenance.sourceGitSha, manifest.sourceGitSha],
    ['configRevisionId', bundle.provenance.configRevisionId, manifest.configRevisionId],
    ['expectedSnapshotSha256', bundle.snapshot.sha256, manifest.expectedSnapshotSha256],
  ] as const;
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`release manifest ${field} does not match the rendered bundle`);
    }
  }
}

async function artifactFile(
  root: string,
  path: string,
): Promise<{ path: string; sha256: string; sizeBytes: number }> {
  const absoluteRoot = await realpath(root);
  const absolutePath = resolve(root, path);
  const relativePath = relative(absoluteRoot, absolutePath);
  if (relativePath === '' || relativePath.startsWith('..') || relativePath.includes('\\')) {
    throw new TypeError(`artifact path escapes its isolated root: ${path}`);
  }
  const link = await lstat(absolutePath);
  if (link.isSymbolicLink() || !link.isFile()) {
    throw new TypeError(`artifact must be a regular file: ${path}`);
  }
  const canonicalPath = await realpath(absolutePath);
  if (relative(absoluteRoot, canonicalPath).startsWith('..')) {
    throw new TypeError(`artifact resolves outside its isolated root: ${path}`);
  }
  const bytes = await readFile(canonicalPath);
  return {
    path: relativePath.replaceAll('\\', '/'),
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  };
}

export async function createReleaseArtifactProvenance(input: {
  readonly artifactPaths: readonly string[];
  readonly artifactRoot: string;
  readonly brandIdentity: BrandIdentityArtifact;
  readonly brandManifestBytes: Uint8Array;
  readonly bundle: ConfigBuildBundle;
  readonly clientGitSha: string;
  readonly compliance: StoreComplianceDeclaration;
  readonly deliveryDescriptorBytes: Uint8Array;
  readonly expectedDeliveryDescriptorSha256: string;
  readonly releaseManifest: ReleaseManifestBinding;
  readonly releaseManifestBytes: Uint8Array;
  readonly signed: boolean;
}): Promise<ReleaseArtifactProvenance> {
  if (
    input.artifactPaths.length === 0 ||
    new Set(input.artifactPaths).size !== input.artifactPaths.length
  ) {
    throw new TypeError('artifactPaths must be non-empty and unique');
  }
  if (!RE_GIT_SHA.test(input.clientGitSha)) {
    throw new TypeError('clientGitSha must be an exact lowercase 40-hex commit');
  }
  assertBrandIdentityMatchesBundle(input.brandIdentity, input.bundle);
  assertReleaseBinding(input.bundle, input.releaseManifest);
  assertStoreCompliance(input.bundle, input.compliance);
  const defaults = jsonValue(configBuildBundleDefaults(input.bundle));
  const defaultsSha256 = sha256(canonicalizeJson(defaults));
  const brandManifestSha256 = sha256(input.brandManifestBytes);
  const deliverySha256 = deliveryDescriptorSha256(
    input.deliveryDescriptorBytes,
    input.expectedDeliveryDescriptorSha256,
  );
  const files = await Promise.all(
    [...input.artifactPaths].sort().map((path) => artifactFile(input.artifactRoot, path)),
  );
  return {
    artifacts: files.map((file) => ({
      ...file,
      brandManifestSha256,
      configRevisionId: input.bundle.provenance.configRevisionId,
      defaultsSha256,
    })),
    brandId: input.bundle.brandId,
    channel: input.bundle.channel,
    clientGitSha: input.clientGitSha,
    configSnapshotSha256: input.bundle.snapshot.sha256,
    deliveryDescriptorSha256: deliverySha256,
    platform: input.bundle.platform,
    publisherGitSha: input.releaseManifest.publisherGitSha,
    releaseArtifactProvenanceVersion: 1,
    releaseManifestSha256: sha256(input.releaseManifestBytes),
    signed: input.signed,
    sourceGitSha: input.bundle.provenance.sourceGitSha,
  };
}

function releaseArtifactProvenance(value: unknown): ReleaseArtifactProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('release provenance must be an object');
  }
  const provenance = value as Record<string, unknown>;
  const keys = Object.keys(provenance).sort();
  const expectedKeys = [
    'artifacts',
    'brandId',
    'channel',
    'clientGitSha',
    'configSnapshotSha256',
    'deliveryDescriptorSha256',
    'platform',
    'publisherGitSha',
    'releaseArtifactProvenanceVersion',
    'releaseManifestSha256',
    'signed',
    'sourceGitSha',
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(`release provenance must contain exactly: ${expectedKeys.join(', ')}`);
  }
  if (
    provenance.releaseArtifactProvenanceVersion !== 1 ||
    typeof provenance.brandId !== 'string' ||
    (provenance.channel !== 'canary' && provenance.channel !== 'stable') ||
    typeof provenance.platform !== 'string' ||
    typeof provenance.signed !== 'boolean' ||
    typeof provenance.clientGitSha !== 'string' ||
    !RE_GIT_SHA.test(provenance.clientGitSha) ||
    typeof provenance.configSnapshotSha256 !== 'string' ||
    !RE_SHA256.test(provenance.configSnapshotSha256) ||
    typeof provenance.deliveryDescriptorSha256 !== 'string' ||
    !RE_SHA256.test(provenance.deliveryDescriptorSha256) ||
    typeof provenance.releaseManifestSha256 !== 'string' ||
    !RE_SHA256.test(provenance.releaseManifestSha256) ||
    typeof provenance.publisherGitSha !== 'string' ||
    !RE_GIT_SHA.test(provenance.publisherGitSha) ||
    typeof provenance.sourceGitSha !== 'string' ||
    !RE_GIT_SHA.test(provenance.sourceGitSha) ||
    !Array.isArray(provenance.artifacts) ||
    provenance.artifacts.length === 0
  ) {
    throw new TypeError('release provenance has invalid target, digest, or source fields');
  }
  const paths = new Set<string>();
  const artifacts: Array<ReleaseArtifactProvenance['artifacts'][number]> = [];
  for (const [index, value] of provenance.artifacts.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError(`release provenance artifact ${index} must be an object`);
    }
    const artifact = value as Record<string, unknown>;
    const artifactKeys = Object.keys(artifact).sort();
    const expectedArtifactKeys = [
      'brandManifestSha256',
      'configRevisionId',
      'defaultsSha256',
      'path',
      'sha256',
      'sizeBytes',
    ].sort();
    if (
      artifactKeys.length !== expectedArtifactKeys.length ||
      artifactKeys.some((key, artifactIndex) => key !== expectedArtifactKeys[artifactIndex])
    ) {
      throw new TypeError(
        `release provenance artifact ${index} must contain exactly: ${expectedArtifactKeys.join(', ')}`,
      );
    }
    if (
      typeof artifact.path !== 'string' ||
      artifact.path === '' ||
      paths.has(artifact.path) ||
      typeof artifact.configRevisionId !== 'string' ||
      artifact.configRevisionId === '' ||
      typeof artifact.brandManifestSha256 !== 'string' ||
      !RE_SHA256.test(artifact.brandManifestSha256) ||
      typeof artifact.defaultsSha256 !== 'string' ||
      !RE_SHA256.test(artifact.defaultsSha256) ||
      typeof artifact.sha256 !== 'string' ||
      !RE_SHA256.test(artifact.sha256) ||
      typeof artifact.sizeBytes !== 'number' ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes < 0
    ) {
      throw new TypeError(`release provenance artifact ${index} has invalid trace fields`);
    }
    paths.add(artifact.path);
    artifacts.push({
      brandManifestSha256: artifact.brandManifestSha256,
      configRevisionId: artifact.configRevisionId,
      defaultsSha256: artifact.defaultsSha256,
      path: artifact.path,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    });
  }
  return {
    artifacts,
    brandId: provenance.brandId,
    channel: provenance.channel,
    clientGitSha: provenance.clientGitSha,
    configSnapshotSha256: provenance.configSnapshotSha256,
    deliveryDescriptorSha256: provenance.deliveryDescriptorSha256,
    platform: provenance.platform,
    publisherGitSha: provenance.publisherGitSha,
    releaseArtifactProvenanceVersion: 1,
    releaseManifestSha256: provenance.releaseManifestSha256,
    signed: provenance.signed,
    sourceGitSha: provenance.sourceGitSha,
  };
}

export async function verifyReleaseArtifactProvenance(input: {
  readonly artifactRoot: string;
  readonly brandIdentity: BrandIdentityArtifact;
  readonly brandManifestBytes: Uint8Array;
  readonly brandId: string;
  readonly bundle: ConfigBuildBundle;
  readonly clientGitSha: string;
  readonly deliveryDescriptorBytes: Uint8Array;
  readonly expectedDeliveryDescriptorSha256: string;
  readonly platform: string;
  readonly provenance: unknown;
  readonly releaseManifest: ReleaseManifestBinding;
  readonly releaseManifestBytes: Uint8Array;
  readonly signed: boolean;
}): Promise<ReleaseArtifactProvenance> {
  const provenance = releaseArtifactProvenance(input.provenance);
  if (!RE_GIT_SHA.test(input.clientGitSha)) {
    throw new TypeError('clientGitSha must be an exact lowercase 40-hex commit');
  }
  assertBrandIdentityMatchesBundle(input.brandIdentity, input.bundle);
  assertReleaseBinding(input.bundle, input.releaseManifest);
  const brandManifestSha256 = sha256(input.brandManifestBytes);
  const defaultsSha256 = sha256(
    canonicalizeJson(jsonValue(configBuildBundleDefaults(input.bundle))),
  );
  const deliverySha256 = deliveryDescriptorSha256(
    input.deliveryDescriptorBytes,
    input.expectedDeliveryDescriptorSha256,
  );
  if (
    provenance.brandId !== input.brandId ||
    provenance.channel !== input.bundle.channel ||
    provenance.platform !== input.platform ||
    provenance.signed !== input.signed ||
    provenance.clientGitSha !== input.clientGitSha ||
    provenance.configSnapshotSha256 !== input.bundle.snapshot.sha256 ||
    provenance.deliveryDescriptorSha256 !== deliverySha256 ||
    provenance.publisherGitSha !== input.releaseManifest.publisherGitSha ||
    provenance.releaseManifestSha256 !== sha256(input.releaseManifestBytes) ||
    provenance.sourceGitSha !== input.bundle.provenance.sourceGitSha
  ) {
    throw new Error('release provenance does not match the expected immutable release target');
  }
  const [first] = provenance.artifacts;
  await Promise.all(
    provenance.artifacts.map(async (expected) => {
      if (
        expected.brandManifestSha256 !== brandManifestSha256 ||
        expected.brandManifestSha256 !== first.brandManifestSha256 ||
        expected.configRevisionId !== input.bundle.provenance.configRevisionId ||
        expected.configRevisionId !== first.configRevisionId ||
        expected.defaultsSha256 !== defaultsSha256 ||
        expected.defaultsSha256 !== first.defaultsSha256
      ) {
        throw new Error('release provenance artifacts do not share immutable trace bindings');
      }
      const actual = await artifactFile(input.artifactRoot, expected.path);
      if (actual.sha256 !== expected.sha256 || actual.sizeBytes !== expected.sizeBytes) {
        throw new Error(`artifact bytes do not match release provenance: ${expected.path}`);
      }
    }),
  );
  return provenance;
}

export async function writeReleaseArtifactProvenance(
  path: string,
  provenance: ReleaseArtifactProvenance,
  artifactRoot: string,
): Promise<void> {
  const absoluteRoot = await realpath(artifactRoot);
  const absolutePath = resolve(artifactRoot, path);
  const relativePath = relative(absoluteRoot, absolutePath);
  if (relativePath === '' || relativePath.startsWith('..') || relativePath.includes('\\')) {
    throw new TypeError(`provenance path escapes its isolated root: ${path}`);
  }
  const canonicalParent = await realpath(dirname(absolutePath));
  if (relative(absoluteRoot, canonicalParent).startsWith('..')) {
    throw new TypeError(`provenance path resolves outside its isolated root: ${path}`);
  }
  const output = `${canonicalizeJson(jsonValue(provenance))}\n`;
  await writeFile(absolutePath, output, { encoding: 'utf8', flag: 'wx' });
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value !== 'object') {
    throw new TypeError('release provenance must contain only JSON values');
  }
  return Object.entries(value).reduce<Record<string, JsonValue>>((acc, [key, entry]) => {
    // Own data property, never a prototype write: `acc.__proto__ = …` would mutate the clone.
    Object.defineProperty(acc, key, {
      configurable: true,
      enumerable: true,
      value: jsonValue(entry),
      writable: true,
    });
    return acc;
  }, {});
}

export function parseReleaseArtifactInputs(
  bundle: unknown,
  identity: unknown,
): {
  readonly bundle: ConfigBuildBundle;
  readonly identity: BrandIdentityArtifact;
} {
  return { bundle: parseConfigBuildBundle(bundle), identity: parseBrandIdentityArtifact(identity) };
}
