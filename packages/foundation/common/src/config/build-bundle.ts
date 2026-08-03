// Client half of the frozen build-bundle contract v1 (publisher CONTRACT.md "Build bundle
// contract v1"). Validation only — rendering stays in the publisher; never reimplement it here.
import { sha256 } from '@noble/hashes/sha2.js';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { assertConfigSnapshot, canonicalizeJson, isRecord } from './contract';
import { cloneJson, decodeBase64Url, parseIJson } from './i-json';
import type {
  ConfigChannel,
  ConfigDefinitions,
  ConfigPlatform,
  ConfigSnapshot,
  ConfigValue,
  ConfigValueDefinition,
  JsonValue,
} from './types';
import { CONFIG_CHANNELS, CONFIG_PLATFORMS, MAX_SNAPSHOT_SIZE_BYTES } from './types';

export const CONFIG_BUILD_BUNDLE_VERSION = 1;

export interface ConfigBuildBundleEndpoints {
  readonly emergency: string | null;
  readonly normal: string | null;
  readonly telemetry: string;
}

export interface ConfigBuildBundleKeyrings {
  readonly emergency: Readonly<Record<string, string>>;
  readonly normal: Readonly<Record<string, string>>;
}

export interface ConfigBuildBundleProvenance {
  readonly configRevisionId: string;
  readonly configVersion: string;
  readonly generatedAt: string;
  readonly schemaVersion: number;
  readonly sourceGitSha: string;
}

export interface ConfigBuildBundleSnapshotEnvelope {
  readonly base64Url: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ConfigBuildBundle {
  readonly brandId: string;
  readonly buildBundleVersion: 1;
  readonly channel: ConfigChannel;
  readonly endpoints: ConfigBuildBundleEndpoints;
  readonly keyrings: ConfigBuildBundleKeyrings;
  readonly maximumSchemaVersion: number;
  readonly platform: ConfigPlatform;
  readonly provenance: ConfigBuildBundleProvenance;
  readonly snapshot: ConfigBuildBundleSnapshotEnvelope;
}

const BUNDLE_KEYS = new Set([
  'brandId',
  'buildBundleVersion',
  'channel',
  'endpoints',
  'keyrings',
  'maximumSchemaVersion',
  'platform',
  'provenance',
  'snapshot',
]);
const ENDPOINT_KEYS = new Set(['emergency', 'normal', 'telemetry']);
const KEYRING_KEYS = new Set(['emergency', 'normal']);
const PROVENANCE_KEYS = new Set([
  'configRevisionId',
  'configVersion',
  'generatedAt',
  'schemaVersion',
  'sourceGitSha',
]);
const SNAPSHOT_KEYS = new Set(['base64Url', 'sha256', 'sizeBytes']);

const RE_BRAND_ID = /^[a-z][a-z0-9-]{0,62}$/;
const RE_KEY_ID = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_REVISION_ID = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_SOURCE_GIT_SHA = /^[0-9a-f]{40}$/;
const RE_HEX_SHA256 = /^[0-9a-f]{64}$/;
const ED25519_PUBLIC_KEY_BYTES = 32;

const CONFIG_PLATFORM_SET = new Set<string>(CONFIG_PLATFORMS);
const CONFIG_CHANNEL_SET = new Set<string>(CONFIG_CHANNELS);

function fail(message: string): never {
  throw new TypeError(message);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unsupported field ${key}`);
  }
  for (const key of allowed) {
    if (!(key in value)) fail(`${label} is missing field ${key}`);
  }
}

function assertEndpoint(value: unknown, label: string): string | null {
  if (value === null) return null;
  const endpoint = requireString(value, label);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    fail(`${label} must be an absolute URL`);
  }
  if (url.protocol !== 'https:') fail(`${label} must use HTTPS`);
  if (url.username || url.password || url.search || url.hash) {
    fail(`${label} must not carry credentials, query, or fragment`);
  }
  return endpoint;
}

function assertKeyring(value: unknown, label: string): Readonly<Record<string, string>> {
  const keyring = requireRecord(value, label);
  for (const [keyId, publicKey] of Object.entries(keyring)) {
    if (!RE_KEY_ID.test(keyId)) fail(`${label} key id ${keyId} is invalid`);
    const encoded = requireString(publicKey, `${label}.${keyId}`);
    let decoded: Uint8Array;
    try {
      decoded = decodeBase64Url(encoded);
    } catch {
      fail(`${label}.${keyId} must be canonical Base64URL`);
    }
    if (decoded.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
      fail(`${label}.${keyId} must be a raw 32-byte Ed25519 public key`);
    }
  }
  return keyring as Readonly<Record<string, string>>;
}

function sha256Hex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of sha256(bytes)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function decodeSnapshotBytes(bytes: Uint8Array, label: string): ConfigSnapshot {
  let parsed: JsonValue;
  try {
    parsed = parseIJson(bytes);
  } catch {
    fail(`${label} must be strict UTF-8 JSON`);
  }
  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(parsed));
  if (
    canonicalBytes.byteLength !== bytes.byteLength ||
    canonicalBytes.some((byte, index) => byte !== bytes[index])
  ) {
    fail(`${label} must be RFC 8785 canonical bytes`);
  }
  assertConfigSnapshot(parsed);
  return parsed;
}

export function assertConfigBuildBundle(value: unknown): asserts value is ConfigBuildBundle {
  const bundle = requireRecord(value, 'bundle');
  requireExactKeys(bundle, BUNDLE_KEYS, 'bundle');
  if (bundle.buildBundleVersion !== CONFIG_BUILD_BUNDLE_VERSION) {
    fail('bundle.buildBundleVersion is unsupported');
  }
  const brandId = requireString(bundle.brandId, 'bundle.brandId');
  if (!RE_BRAND_ID.test(brandId)) fail('bundle.brandId is invalid');
  if (typeof bundle.platform !== 'string' || !CONFIG_PLATFORM_SET.has(bundle.platform)) {
    fail('bundle.platform is invalid');
  }
  if (typeof bundle.channel !== 'string' || !CONFIG_CHANNEL_SET.has(bundle.channel)) {
    fail('bundle.channel is invalid');
  }

  const endpoints = requireRecord(bundle.endpoints, 'bundle.endpoints');
  requireExactKeys(endpoints, ENDPOINT_KEYS, 'bundle.endpoints');
  const normalEndpoint = assertEndpoint(endpoints.normal, 'bundle.endpoints.normal');
  const emergencyEndpoint = assertEndpoint(endpoints.emergency, 'bundle.endpoints.emergency');
  // Every target ships an authenticated telemetry endpoint; null is not a valid build output.
  if (endpoints.telemetry === null) fail('bundle.endpoints.telemetry is required for every target');
  assertEndpoint(endpoints.telemetry, 'bundle.endpoints.telemetry');

  const keyrings = requireRecord(bundle.keyrings, 'bundle.keyrings');
  requireExactKeys(keyrings, KEYRING_KEYS, 'bundle.keyrings');
  const normalKeyring = assertKeyring(keyrings.normal, 'bundle.keyrings.normal');
  const emergencyKeyring = assertKeyring(keyrings.emergency, 'bundle.keyrings.emergency');
  if ((normalEndpoint === null) !== isObjectEmpty(normalKeyring)) {
    fail('bundle normal endpoint and keyring must be enabled together');
  }
  if ((emergencyEndpoint === null) !== isObjectEmpty(emergencyKeyring)) {
    fail('bundle emergency endpoint and keyring must be enabled together');
  }

  const provenance = requireRecord(bundle.provenance, 'bundle.provenance');
  requireExactKeys(provenance, PROVENANCE_KEYS, 'bundle.provenance');
  const configRevisionId = requireString(
    provenance.configRevisionId,
    'bundle.provenance.configRevisionId',
  );
  if (!RE_REVISION_ID.test(configRevisionId)) fail('bundle.provenance.configRevisionId is invalid');
  const sourceGitSha = requireString(provenance.sourceGitSha, 'bundle.provenance.sourceGitSha');
  if (!RE_SOURCE_GIT_SHA.test(sourceGitSha)) {
    fail('bundle.provenance.sourceGitSha must be a lowercase 40-hex commit');
  }

  const snapshotEnvelope = requireRecord(bundle.snapshot, 'bundle.snapshot');
  requireExactKeys(snapshotEnvelope, SNAPSHOT_KEYS, 'bundle.snapshot');
  const digest = requireString(snapshotEnvelope.sha256, 'bundle.snapshot.sha256');
  if (!RE_HEX_SHA256.test(digest)) {
    fail('bundle.snapshot.sha256 must be a lowercase SHA-256 digest');
  }
  const sizeBytes = snapshotEnvelope.sizeBytes;
  if (
    !Number.isSafeInteger(sizeBytes) ||
    (sizeBytes as number) < 1 ||
    (sizeBytes as number) > MAX_SNAPSHOT_SIZE_BYTES
  ) {
    fail('bundle.snapshot.sizeBytes is out of range');
  }
  let snapshotBytes: Uint8Array;
  try {
    snapshotBytes = decodeBase64Url(
      requireString(snapshotEnvelope.base64Url, 'bundle.snapshot.base64Url'),
    );
  } catch {
    fail('bundle.snapshot.base64Url must be canonical Base64URL');
  }
  if (snapshotBytes.byteLength !== sizeBytes) {
    fail('bundle.snapshot.sizeBytes does not match the snapshot bytes');
  }
  if (sha256Hex(snapshotBytes) !== digest) {
    fail('bundle.snapshot.sha256 does not match the snapshot bytes');
  }
  const snapshot = decodeSnapshotBytes(snapshotBytes, 'bundle.snapshot bytes');
  if (
    snapshot.brandId !== brandId ||
    snapshot.platform !== bundle.platform ||
    snapshot.channel !== bundle.channel
  ) {
    fail('bundle.snapshot target does not match the bundle target');
  }
  if (snapshot.configVersion !== provenance.configVersion) {
    fail('bundle.provenance.configVersion does not match the snapshot');
  }
  if (snapshot.generatedAt !== provenance.generatedAt) {
    fail('bundle.provenance.generatedAt does not match the snapshot');
  }
  if (snapshot.schemaVersion !== provenance.schemaVersion) {
    fail('bundle.provenance.schemaVersion does not match the snapshot');
  }
  const maximumSchemaVersion = bundle.maximumSchemaVersion;
  if (
    !Number.isSafeInteger(maximumSchemaVersion) ||
    (maximumSchemaVersion as number) < snapshot.schemaVersion
  ) {
    fail('bundle.maximumSchemaVersion must cover the snapshot schema version');
  }
}

export function parseConfigBuildBundle(value: unknown): ConfigBuildBundle {
  assertConfigBuildBundle(value);
  return value;
}

export function configBuildBundleSnapshot(bundle: ConfigBuildBundle): ConfigSnapshot {
  assertConfigBuildBundle(bundle);
  return decodeSnapshotBytes(decodeBase64Url(bundle.snapshot.base64Url), 'bundle.snapshot bytes');
}

// Bundled defaults are the publisher-rendered base values; snapshot overrides and rollouts stay
// remote-snapshot features evaluated by ConfigCore, never re-evaluated at build time.
export function configBuildBundleDefaults(
  bundle: ConfigBuildBundle,
): Readonly<Record<string, ConfigValue>> {
  return configBuildBundleSnapshot(bundle).values;
}

export function definitionsFromDefaults(
  defaults: Readonly<Record<string, ConfigValue>>,
): ConfigDefinitions {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => [
      key,
      {
        defaultValue,
        parse: (value: ConfigValue) => parseLikeDefault(value, defaultValue),
      } satisfies ConfigValueDefinition,
    ]),
  );
}

function parseLikeDefault(value: ConfigValue, defaultValue: ConfigValue): ConfigValue {
  const expected = Array.isArray(defaultValue) ? 'array' : typeof defaultValue;
  const actual = Array.isArray(value) ? 'array' : typeof value;
  if (actual !== expected) throw new TypeError(`Expected ${expected}, received ${actual}`);
  return cloneJson(value);
}
