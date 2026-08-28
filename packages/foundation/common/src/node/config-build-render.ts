/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { ConfigBuildBundle } from '../config/build-bundle';
import { parseConfigBuildBundle } from '../config/build-bundle';
import type { ConfigChannel, ConfigPlatform } from '../config/types';
import type { RenderCommandResult, RenderCommandRunner } from './render-checkout';
import {
  assertPublisherCheckout,
  defaultRenderCommandRunner,
  RE_GIT_SHA,
  verifyPinnedCheckout,
} from './render-checkout';

// Layout of the publisher checkout; the render CLI ships inside the publisher package itself.
const PUBLISHER_PACKAGE_PATH = 'packages/config-publisher';
const PUBLISHER_SCRIPT_PATH = 'packages/config-publisher/scripts/build-render.mts';

export type { RenderCommandResult, RenderCommandRunner };

/** Explicit, fully pinned inputs for one build-bundle render. Nothing is defaulted or fetched:
 * both checkouts must already exist at the exact pinned commits or the render fails closed. */
export interface ConfigBuildRenderRequest {
  readonly brandId: string;
  readonly channel: ConfigChannel;
  readonly keyringsPath: string;
  readonly outPath: string;
  readonly platform: ConfigPlatform;
  /** Root of the config publisher checkout (contains the render CLI). */
  readonly publisherDir: string;
  /** Exact commit the publisher checkout must be at. */
  readonly publisherGitSha: string;
  /** Optional release manifest that digest-binds every input and the published snapshot;
   * verified by the publisher CLI and re-verified here against the loaded bundle. */
  readonly releaseManifestPath?: string;
  readonly revisionPath: string;
  /** Exact commit the structural source checkout must be at. */
  readonly sourceGitSha: string;
  /** Structural configuration source directory (contains brands.manifest.yaml). */
  readonly structuralDir: string;
  readonly telemetryEndpoint: string;
}

/** pnpm arguments that invoke the publisher's own build-render CLI inside its checkout. */
export function configBuildRenderArgs(request: ConfigBuildRenderRequest): readonly string[] {
  return [
    '--dir',
    join(request.publisherDir, PUBLISHER_PACKAGE_PATH),
    'run',
    'build-render',
    '--structural',
    request.structuralDir,
    '--source-git-sha',
    request.sourceGitSha,
    '--revision',
    request.revisionPath,
    '--keyrings',
    request.keyringsPath,
    '--brand',
    request.brandId,
    '--platform',
    request.platform,
    '--channel',
    request.channel,
    '--telemetry-endpoint',
    request.telemetryEndpoint,
    '--out',
    request.outPath,
    ...(request.releaseManifestPath === undefined
      ? []
      : ['--release-manifest', request.releaseManifestPath]),
  ];
}

const RE_HEX_SHA256 = /^[0-9a-f]{64}$/;
const RE_MONOTONIC_VERSION = /^(?:0|[1-9]\d{0,19})$/;
const RE_KEY_ID = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
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
] as const;
const RELEASE_MANIFEST_V1_KEY_SET: ReadonlySet<string> = new Set(RELEASE_MANIFEST_BASE_KEYS);
const RELEASE_MANIFEST_V2_KEY_SET: ReadonlySet<string> = new Set([
  ...RELEASE_MANIFEST_BASE_KEYS,
  'publicationEvidence',
]);
const PUBLICATION_EVIDENCE_KEYS = new Set([
  'activationVersion',
  'deploymentId',
  'deploymentSourceGitSha',
  'keyId',
  'pointerSha256',
  'verifiedAt',
]);

interface ConfigBuildReleaseManifestBase {
  readonly brandId: string;
  readonly channel: string;
  readonly configRevisionId: string;
  readonly expectedSnapshotSha256: string;
  readonly platform: string;
  readonly publicKeyringsSha256: string;
  readonly publisherGitSha: string;
  readonly revisionSha256: string;
  readonly sourceGitSha: string;
  readonly telemetryEndpoint: string;
}

export interface ConfigBuildPublicationEvidence {
  readonly activationVersion: string;
  readonly deploymentId: string;
  readonly deploymentSourceGitSha: string;
  readonly keyId: string;
  readonly pointerSha256: string;
  readonly verifiedAt: string;
}

export type ConfigBuildReleaseManifest =
  | (ConfigBuildReleaseManifestBase & { readonly releaseManifestFormatVersion: 1 })
  | (ConfigBuildReleaseManifestBase & {
      readonly publicationEvidence?: ConfigBuildPublicationEvidence;
      readonly releaseManifestFormatVersion: 2;
    });

function parseReleaseManifest(value: unknown, path: string): ConfigBuildReleaseManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Release manifest at ${path} must be a JSON object`);
  }
  const manifest = value as Record<string, unknown>;
  const version = manifest.releaseManifestFormatVersion;
  if (version !== 1 && version !== 2) {
    throw new TypeError(`Release manifest at ${path} has an unsupported format version`);
  }
  const keys = version === 1 ? RELEASE_MANIFEST_V1_KEY_SET : RELEASE_MANIFEST_V2_KEY_SET;
  const manifestKeys = Object.keys(manifest);
  for (let i = 0, len = manifestKeys.length; i < len; i++) {
    const key = manifestKeys[i];
    if (!keys.has(key)) {
      throw new TypeError(`Release manifest at ${path} contains unsupported field ${key}`);
    }
  }
  for (let i = 0, len = RELEASE_MANIFEST_BASE_KEYS.length; i < len; i++) {
    const key = RELEASE_MANIFEST_BASE_KEYS[i];
    if (!(key in manifest)) {
      throw new TypeError(`Release manifest at ${path} is missing field ${key}`);
    }
  }
  const field = (key: (typeof RELEASE_MANIFEST_BASE_KEYS)[number]): string => {
    const fieldValue = manifest[key];
    if (typeof fieldValue !== 'string') {
      throw new TypeError(`Release manifest at ${path} is missing field ${key}`);
    }
    return fieldValue;
  };
  const base: ConfigBuildReleaseManifestBase = {
    brandId: field('brandId'),
    channel: field('channel'),
    configRevisionId: field('configRevisionId'),
    expectedSnapshotSha256: field('expectedSnapshotSha256'),
    platform: field('platform'),
    publicKeyringsSha256: field('publicKeyringsSha256'),
    publisherGitSha: field('publisherGitSha'),
    revisionSha256: field('revisionSha256'),
    sourceGitSha: field('sourceGitSha'),
    telemetryEndpoint: field('telemetryEndpoint'),
  };
  if (version === 1) return { ...base, releaseManifestFormatVersion: 1 };
  if (!('publicationEvidence' in manifest)) {
    return { ...base, releaseManifestFormatVersion: 2 };
  }
  const publicationEvidence = parsePublicationEvidence(
    manifest.publicationEvidence,
    path,
    base.sourceGitSha,
  );
  return { ...base, publicationEvidence, releaseManifestFormatVersion: 2 };
}

function parsePublicationEvidence(
  value: unknown,
  path: string,
  sourceGitSha: string,
): ConfigBuildPublicationEvidence {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Release manifest at ${path} has invalid publication evidence`);
  }
  const evidence = value as Record<string, unknown>;
  const actual = Object.keys(evidence).sort();
  const expected = [...PUBLICATION_EVIDENCE_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Release manifest at ${path} has invalid publication evidence fields`);
  }
  const field = (key: string): string => {
    const result = evidence[key];
    if (typeof result !== 'string' || result.length === 0) {
      throw new TypeError(`Release manifest at ${path} has invalid publication evidence ${key}`);
    }
    return result;
  };
  const publication = {
    activationVersion: field('activationVersion'),
    deploymentId: field('deploymentId'),
    deploymentSourceGitSha: field('deploymentSourceGitSha'),
    keyId: field('keyId'),
    pointerSha256: field('pointerSha256'),
    verifiedAt: field('verifiedAt'),
  };
  if (
    !RE_MONOTONIC_VERSION.test(publication.activationVersion) ||
    publication.activationVersion === '0' ||
    publication.deploymentId.length > 256 ||
    publication.deploymentSourceGitSha !== sourceGitSha ||
    !RE_KEY_ID.test(publication.keyId) ||
    !RE_HEX_SHA256.test(publication.pointerSha256) ||
    !RE_TIMESTAMP.test(publication.verifiedAt) ||
    Number.isNaN(Date.parse(publication.verifiedAt))
  ) {
    throw new TypeError(`Release manifest at ${path} has invalid publication evidence`);
  }
  return publication;
}

/** Re-verifies the release-manifest binding against the loaded bundle and the exact input file
 * bytes, so a bypassed or tampered publisher CLI cannot skip the digest binding. */
export async function assertReleaseManifestBinding(
  manifestPath: string,
  request: ConfigBuildRenderRequest,
  bundle: ConfigBuildBundle,
): Promise<void> {
  let manifestText: string;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(`Release manifest not found or unreadable: ${manifestPath}`);
  }
  const manifest = parseReleaseManifest(JSON.parse(manifestText), manifestPath);
  const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
  const hexDigestFields = [
    'expectedSnapshotSha256',
    'publicKeyringsSha256',
    'revisionSha256',
  ] as const;
  for (let i = 0, len = hexDigestFields.length; i < len; i++) {
    const field = hexDigestFields[i];
    if (!RE_HEX_SHA256.test(manifest[field])) {
      throw new TypeError(`Release manifest ${field} must be a lowercase 64-hex SHA-256`);
    }
  }
  const checks: ReadonlyArray<[field: string, expected: string, got: string]> = [
    ['publisherGitSha', manifest.publisherGitSha, request.publisherGitSha],
    ['sourceGitSha', manifest.sourceGitSha, bundle.provenance.sourceGitSha],
    ['revisionSha256', manifest.revisionSha256, digest(await readFile(request.revisionPath))],
    [
      'publicKeyringsSha256',
      manifest.publicKeyringsSha256,
      digest(await readFile(request.keyringsPath)),
    ],
    ['configRevisionId', manifest.configRevisionId, bundle.provenance.configRevisionId],
    ['brandId', manifest.brandId, bundle.brandId],
    ['platform', manifest.platform, bundle.platform],
    ['channel', manifest.channel, bundle.channel],
    ['telemetryEndpoint', manifest.telemetryEndpoint, bundle.endpoints.telemetry],
    ['expectedSnapshotSha256', manifest.expectedSnapshotSha256, bundle.snapshot.sha256],
  ];
  for (let i = 0, len = checks.length; i < len; i++) {
    const [field, expected, got] = checks[i];
    if (expected !== got) {
      throw new Error(
        `Release manifest binding failed: ${field} is pinned to ${expected} but this build used ${got}`,
      );
    }
  }
}

/** Rejects rendered output that does not answer this exact request — stale or mismatched
 * generated bundles must stop the build instead of shipping. */
export function assertRenderedBundleMatches(
  bundle: ConfigBuildBundle,
  request: Pick<
    ConfigBuildRenderRequest,
    'brandId' | 'channel' | 'platform' | 'sourceGitSha' | 'telemetryEndpoint'
  >,
): void {
  const target = `${bundle.brandId}/${bundle.platform}/${bundle.channel}`;
  const expected = `${request.brandId}/${request.platform}/${request.channel}`;
  if (target !== expected) {
    throw new Error(`Rendered bundle targets ${target}, but this build requires ${expected}`);
  }
  if (bundle.provenance.sourceGitSha !== request.sourceGitSha) {
    throw new Error(
      `Rendered bundle was produced from source commit ${bundle.provenance.sourceGitSha}, ` +
        `but this build pins ${request.sourceGitSha}; regenerate from the pinned commit`,
    );
  }
  if (bundle.endpoints.telemetry !== request.telemetryEndpoint) {
    throw new Error(
      `Rendered bundle carries telemetry endpoint ${bundle.endpoints.telemetry}, ` +
        `but this build requires ${request.telemetryEndpoint}`,
    );
  }
}

/** Renders one build bundle by invoking the publisher CLI from a pinned checkout, then validates
 * the output with the frozen v1 contract. Rendering semantics live in the publisher only. */
export async function renderConfigBundleWithPublisher(
  request: ConfigBuildRenderRequest,
  run: RenderCommandRunner = defaultRenderCommandRunner,
): Promise<ConfigBuildBundle> {
  if (!RE_GIT_SHA.test(request.publisherGitSha)) {
    throw new Error('publisherGitSha must be an exact lowercase 40-hex commit');
  }
  if (!RE_GIT_SHA.test(request.sourceGitSha)) {
    throw new Error('sourceGitSha must be an exact lowercase 40-hex commit');
  }
  await assertPublisherCheckout(
    request.publisherDir,
    request.publisherGitSha,
    PUBLISHER_SCRIPT_PATH,
  );
  await verifyPinnedCheckout(
    request.publisherDir,
    request.publisherGitSha,
    'Config publisher',
    run,
  );
  await verifyPinnedCheckout(request.structuralDir, request.sourceGitSha, 'Config source', run);

  await rm(request.outPath, { force: true });
  try {
    await run('pnpm', configBuildRenderArgs(request), { cwd: request.publisherDir });
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '';
    throw new Error(
      `Config publisher render failed: ${extractErrorMessage(error)}${stderr ? `\n${stderr}` : ''}`,
      { cause: error },
    );
  }

  let text: string;
  try {
    text = await readFile(request.outPath, 'utf8');
  } catch {
    throw new Error(`Config publisher render did not produce ${request.outPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Rendered bundle at ${request.outPath} is not valid JSON`);
  }
  const bundle = parseConfigBuildBundle(parsed);
  assertRenderedBundleMatches(bundle, request);
  if (request.releaseManifestPath !== undefined) {
    await assertReleaseManifestBinding(request.releaseManifestPath, request, bundle);
  }
  return bundle;
}
