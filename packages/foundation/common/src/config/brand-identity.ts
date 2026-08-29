// Client half of the frozen brand identity artifact v1 (publisher CONTRACT.md "Brand identity
// artifact v1"). Validation only — derivation stays in the publisher; never reimplement it here.
import type { ConfigBuildBundle } from './build-bundle';
import { isRecord } from './contract';
import type { ConfigChannel, ConfigPlatform } from './types';
import { CONFIG_CHANNELS, CONFIG_PLATFORMS } from './types';

export const BRAND_IDENTITY_VERSION = 1;

export interface BrandIdentityProvenance {
  readonly manifestSchemaVersion: number;
  readonly sourceGitSha: string;
}

/** Resolved build identity for exactly one brand/platform/channel target. Every field is final:
 * build tooling consumes it verbatim and never re-derives identity from the brand manifest. */
export interface BrandIdentityArtifact {
  readonly applicationId: string;
  readonly assetsPath: string;
  readonly brandId: string;
  readonly brandIdentityVersion: 1;
  readonly channel: ConfigChannel;
  readonly displayName: string;
  readonly platform: ConfigPlatform;
  readonly provenance: BrandIdentityProvenance;
  readonly storageNamespace: string;
  readonly urlScheme: string;
}

const ARTIFACT_KEYS = new Set([
  'applicationId',
  'assetsPath',
  'brandId',
  'brandIdentityVersion',
  'channel',
  'displayName',
  'platform',
  'provenance',
  'storageNamespace',
  'urlScheme',
]);
const PROVENANCE_KEYS = new Set(['manifestSchemaVersion', 'sourceGitSha']);

const RE_BRAND_ID = /^[a-z][a-z0-9-]{0,62}$/;
const RE_SOURCE_GIT_SHA = /^[0-9a-f]{40}$/;
const RE_URL_SCHEME = /^[a-z][a-z0-9+.-]*$/;
// Android application ids reject dashes and uppercase; Apple/desktop ids allow dashes.
const RE_ANDROID_ID_SEGMENT = /^[a-z][a-z0-9_]*$/;
const RE_APPLE_ID_SEGMENT = /^[a-z][a-z0-9-]*$/i;
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const RE_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const RE_STORAGE_FORBIDDEN = /[<>:"/\\|?*]/;

const CONFIG_PLATFORM_SET = new Set<string>(CONFIG_PLATFORMS);
const CONFIG_CHANNEL_SET = new Set<string>(CONFIG_CHANNELS);

const MAX_DISPLAY_NAME_LENGTH = 80;
const MAX_APPLICATION_ID_LENGTH = 155;

function fail(message: string): never {
  throw new TypeError(message);
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const keys = Object.keys(value);
  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i];
    if (!allowed.has(key)) fail(`${label} contains unsupported field ${key}`);
  }
  for (const key of allowed) {
    if (!(key in value)) fail(`${label} is missing field ${key}`);
  }
}

function assertApplicationId(value: string, platform: ConfigPlatform, label: string): void {
  if (value.length > MAX_APPLICATION_ID_LENGTH) fail(`${label} is too long`);
  const segments = value.split('.');
  if (segments.length < 2) fail(`${label} must contain at least two segments`);
  const segmentRule = platform === 'android' ? RE_ANDROID_ID_SEGMENT : RE_APPLE_ID_SEGMENT;
  for (let i = 0, len = segments.length; i < len; i++) {
    const segment = segments[i];
    if (!segmentRule.test(segment)) {
      fail(`${label} segment ${segment || '(empty)'} is invalid for ${platform}`);
    }
  }
}

function assertDisplayName(value: string, label: string): void {
  if (value.length === 0 || value.length > MAX_DISPLAY_NAME_LENGTH) {
    fail(`${label} must be 1..${MAX_DISPLAY_NAME_LENGTH} characters`);
  }
  if (RE_CONTROL_CHARS.test(value)) fail(`${label} must not contain control characters`);
  if (value !== value.trim()) fail(`${label} must not have leading or trailing whitespace`);
}

function assertStorageNamespace(value: string, label: string): void {
  assertDisplayName(value, label);
  if (RE_STORAGE_FORBIDDEN.test(value)) {
    fail(`${label} must not contain path or Windows-reserved characters`);
  }
  if (value.endsWith('.')) fail(`${label} must not end with a dot`);
  if (value === '.' || value === '..') fail(`${label} must not be a relative path segment`);
}

function assertAssetsPath(value: string, label: string): void {
  if (value.length === 0) fail(`${label} must not be empty`);
  if (value[0] === '/' || value.includes('\\')) {
    fail(`${label} must be a forward-slash relative path`);
  }
  const segments = value.split('/');
  for (let i = 0, len = segments.length; i < len; i++) {
    const segment = segments[i];
    if (segment === '' || segment === '.' || segment === '..') {
      fail(`${label} must not contain empty, dot, or parent segments`);
    }
  }
}

export function assertBrandIdentityArtifact(
  value: unknown,
): asserts value is BrandIdentityArtifact {
  if (!isRecord(value)) fail('artifact must be an object');
  requireExactKeys(value, ARTIFACT_KEYS, 'artifact');
  if (value.brandIdentityVersion !== BRAND_IDENTITY_VERSION) {
    fail('artifact.brandIdentityVersion is unsupported');
  }
  if (typeof value.brandId !== 'string' || !RE_BRAND_ID.test(value.brandId)) {
    fail('artifact.brandId is invalid');
  }
  if (typeof value.platform !== 'string' || !CONFIG_PLATFORM_SET.has(value.platform)) {
    fail('artifact.platform is invalid');
  }
  if (typeof value.channel !== 'string' || !CONFIG_CHANNEL_SET.has(value.channel)) {
    fail('artifact.channel is invalid');
  }
  if (typeof value.applicationId !== 'string') fail('artifact.applicationId must be a string');
  assertApplicationId(
    value.applicationId,
    value.platform as ConfigPlatform,
    'artifact.applicationId',
  );
  if (typeof value.displayName !== 'string') fail('artifact.displayName must be a string');
  assertDisplayName(value.displayName, 'artifact.displayName');
  if (typeof value.storageNamespace !== 'string') {
    fail('artifact.storageNamespace must be a string');
  }
  assertStorageNamespace(value.storageNamespace, 'artifact.storageNamespace');
  if (typeof value.urlScheme !== 'string' || !RE_URL_SCHEME.test(value.urlScheme)) {
    fail('artifact.urlScheme is invalid');
  }
  if (typeof value.assetsPath !== 'string') fail('artifact.assetsPath must be a string');
  assertAssetsPath(value.assetsPath, 'artifact.assetsPath');
  if (!isRecord(value.provenance)) fail('artifact.provenance must be an object');
  requireExactKeys(value.provenance, PROVENANCE_KEYS, 'artifact.provenance');
  const { manifestSchemaVersion, sourceGitSha } = value.provenance;
  if (!Number.isSafeInteger(manifestSchemaVersion) || (manifestSchemaVersion as number) < 1) {
    fail('artifact.provenance.manifestSchemaVersion is invalid');
  }
  if (typeof sourceGitSha !== 'string' || !RE_SOURCE_GIT_SHA.test(sourceGitSha)) {
    fail('artifact.provenance.sourceGitSha must be a lowercase 40-hex commit');
  }
}

export function parseBrandIdentityArtifact(value: unknown): BrandIdentityArtifact {
  assertBrandIdentityArtifact(value);
  return value;
}

/** A build embeds exactly one identity and one build bundle; both must answer the same target
 * from the same manifest commit, or one of them is stale and the build must stop. */
export function assertBrandIdentityMatchesBundle(
  identity: BrandIdentityArtifact,
  bundle: ConfigBuildBundle,
): void {
  const identityTarget = `${identity.brandId}/${identity.platform}/${identity.channel}`;
  const bundleTarget = `${bundle.brandId}/${bundle.platform}/${bundle.channel}`;
  if (identityTarget !== bundleTarget) {
    fail(`brand identity targets ${identityTarget}, but the build bundle targets ${bundleTarget}`);
  }
  if (identity.provenance.sourceGitSha !== bundle.provenance.sourceGitSha) {
    fail(
      `brand identity was rendered from source commit ${identity.provenance.sourceGitSha}, ` +
        `but the build bundle came from ${bundle.provenance.sourceGitSha}; ` +
        'regenerate both from the same pinned commit',
    );
  }
}
