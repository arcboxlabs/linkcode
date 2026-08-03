import canonicalize from 'canonicalize';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { decodeBase64Url } from './i-json';
import { isConfigKey, normalizeLocale } from './rules';
import { isValidSemver, isValidVersionRange } from './semver';
import type {
  AntiReplayDecision,
  AntiReplayState,
  ConfigChannel,
  ConfigPlatform,
  ConfigPointer,
  ConfigSnapshot,
  ConfigTarget,
  EmergencyDocument,
  JsonValue,
} from './types';
import {
  APPLY_MODES,
  CONFIG_CHANNELS,
  CONFIG_CONTRACT_VERSION,
  CONFIG_PLATFORMS,
  MAX_MONOTONIC_VERSION,
  MAX_SNAPSHOT_SIZE_BYTES,
  OPERATING_SYSTEMS,
} from './types';

const RE_BRAND_ID = /^[a-z][a-z0-9-]{0,62}$/;
const RE_CONFIG_VERSION = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_DECIMAL = /^(?:0|[1-9]\d*)$/;
const RE_HEX_SHA256 = /^[0-9a-f]{64}$/;
const RE_KEY_ID = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const CONFIG_PLATFORM_SET = new Set<string>(CONFIG_PLATFORMS);
const CONFIG_CHANNEL_SET = new Set<string>(CONFIG_CHANNELS);
const APPLY_MODE_SET = new Set<string>(APPLY_MODES);
const OPERATING_SYSTEM_SET = new Set<string>(OPERATING_SYSTEMS);

function fail(message: string): never {
  throw new TypeError(message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) fail(`${label} must be a safe integer`);
  return value as number;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unsupported field ${key}`);
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  const timestamp = requireString(value, label);
  if (!RE_TIMESTAMP.test(timestamp)) fail(`${label} must use RFC 3339 UTC seconds precision`);
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== timestamp.replace('Z', '.000Z')) {
    fail(`${label} is not a valid timestamp`);
  }
}

function assertConfigVersion(value: unknown, label: string): asserts value is string {
  const version = requireString(value, label);
  if (!RE_CONFIG_VERSION.test(version)) fail(`${label} is invalid`);
}

function assertKeyId(value: unknown, label: string): asserts value is string {
  const keyId = requireString(value, label);
  if (!RE_KEY_ID.test(keyId)) fail(`${label} is invalid`);
}

function assertSha256(value: unknown, label: string): asserts value is string {
  const digest = requireString(value, label);
  if (!RE_HEX_SHA256.test(digest)) fail(`${label} must be a lowercase SHA-256 digest`);
}

function assertSignature(value: unknown, label: string): asserts value is string {
  const signature = requireString(value, label);
  if (decodeBase64Url(signature).byteLength !== 64) {
    fail(`${label} must encode a raw 64-byte Ed25519 signature`);
  }
}

function assertContractVersion(value: unknown): asserts value is 1 {
  if (value !== CONFIG_CONTRACT_VERSION) fail(`Unsupported contractVersion ${String(value)}`);
}

function assertPlatform(value: unknown, label: string): asserts value is ConfigPlatform {
  const platform = requireString(value, label);
  if (!CONFIG_PLATFORM_SET.has(platform)) fail(`${label} is invalid`);
}

function assertChannel(value: unknown, label: string): asserts value is ConfigChannel {
  const channel = requireString(value, label);
  if (!CONFIG_CHANNEL_SET.has(channel)) fail(`${label} is invalid`);
}

function assertBrandId(value: unknown, label: string): asserts value is string {
  const brandId = requireString(value, label);
  if (!RE_BRAND_ID.test(brandId)) fail(`${label} is invalid`);
}

function assertSchemaVersion(value: unknown, label: string): asserts value is number {
  const version = requireSafeInteger(value, label);
  if (version < 1) fail(`${label} must be positive`);
}

function assertSignedEnvelopeValue(value: unknown, label: string): void {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail(`${label} numbers must be safe integers`);
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertSignedEnvelopeValue(entry, `${label}[${index}]`);
    }
    return;
  }
  const object = requireRecord(value, label);
  for (const [key, entry] of Object.entries(object)) {
    assertSignedEnvelopeValue(entry, `${label}.${key}`);
  }
}

function assertTarget(value: Record<string, unknown>, label: string): void {
  assertBrandId(value.brandId, `${label}.brandId`);
  assertPlatform(value.platform, `${label}.platform`);
  assertChannel(value.channel, `${label}.channel`);
}

function compareDecimal(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertCondition(value: unknown, label: string): void {
  const condition = requireRecord(value, label);
  assertAllowedKeys(condition, new Set(['appVersion', 'locale', 'os']), label);
  if (isObjectEmpty(condition)) fail(`${label} must not be empty`);
  if (
    condition.appVersion !== undefined &&
    (typeof condition.appVersion !== 'string' || !isValidVersionRange(condition.appVersion))
  ) {
    fail(`${label}.appVersion is invalid`);
  }
  if (
    condition.locale !== undefined &&
    (typeof condition.locale !== 'string' || normalizeLocale(condition.locale) === null)
  ) {
    fail(`${label}.locale is invalid`);
  }
  if (
    condition.os !== undefined &&
    (typeof condition.os !== 'string' || !OPERATING_SYSTEM_SET.has(condition.os))
  ) {
    fail(`${label}.os is invalid`);
  }
}

function assertNotice(value: unknown, label: string): void {
  if (value === null) return;
  const notice = requireRecord(value, label);
  assertAllowedKeys(notice, new Set(['body', 'title', 'url']), label);
  const title = requireString(notice.title, `${label}.title`);
  const body = requireString(notice.body, `${label}.body`);
  if (title.length === 0 || title.length > 120) fail(`${label}.title length is invalid`);
  if (body.length === 0 || body.length > 1000) fail(`${label}.body length is invalid`);
  if (notice.url !== null) {
    const url = requireString(notice.url, `${label}.url`);
    if (url.length > 2048 || !url.startsWith('https://')) {
      fail(`${label}.url must be an HTTPS URL`);
    }
  }
}

export function canonicalizeJson(value: JsonValue): string {
  const result = canonicalize(value);
  if (result === undefined) fail('value cannot be represented as canonical JSON');
  return result;
}

export function assertMonotonicVersion(value: string, label = 'version'): void {
  if (
    !RE_DECIMAL.test(value) ||
    value.length > MAX_MONOTONIC_VERSION.length ||
    (value.length === MAX_MONOTONIC_VERSION.length && value > MAX_MONOTONIC_VERSION)
  ) {
    fail(`${label} must be a canonical uint64 decimal string`);
  }
}

export function compareMonotonicVersions(left: string, right: string): number {
  assertMonotonicVersion(left, 'left version');
  assertMonotonicVersion(right, 'right version');
  return compareDecimal(left, right);
}

export function decideAntiReplay(
  candidate: AntiReplayState,
  accepted: AntiReplayState | null,
): AntiReplayDecision {
  assertMonotonicVersion(candidate.version, 'candidate version');
  assertSha256(candidate.payloadSha256, 'candidate payloadSha256');
  if (!accepted) return 'advance';
  assertMonotonicVersion(accepted.version, 'accepted version');
  assertSha256(accepted.payloadSha256, 'accepted payloadSha256');
  const comparison = compareMonotonicVersions(candidate.version, accepted.version);
  if (comparison < 0) return 'replay';
  if (comparison > 0) return 'advance';
  return candidate.payloadSha256 === accepted.payloadSha256 ? 'idempotent' : 'equivocation';
}

export function canonicalSignedPayload(document: unknown): string {
  const envelope = requireRecord(document, 'signed envelope');
  assertSignature(envelope.sig, 'signed envelope.sig');
  const unsigned = Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'sig'));
  assertSignedEnvelopeValue(unsigned, 'signed envelope payload');
  return canonicalizeJson(unsigned as JsonValue);
}

export function canonicalSignedPayloadBytes(document: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalSignedPayload(document));
}

export function assertConfigPointer(value: unknown): asserts value is ConfigPointer {
  const pointer = requireRecord(value, 'pointer');
  canonicalSignedPayload(pointer);
  assertContractVersion(pointer.contractVersion);
  assertTarget(pointer, 'pointer');
  assertConfigVersion(pointer.configVersion, 'pointer.configVersion');
  assertSchemaVersion(pointer.snapshotSchemaVersion, 'pointer.snapshotSchemaVersion');
  const activationVersion = requireString(pointer.activationVersion, 'pointer.activationVersion');
  assertMonotonicVersion(activationVersion, 'pointer.activationVersion');
  assertSha256(pointer.sha256, 'pointer.sha256');
  const sizeBytes = requireSafeInteger(pointer.sizeBytes, 'pointer.sizeBytes');
  if (sizeBytes < 1 || sizeBytes > MAX_SNAPSHOT_SIZE_BYTES) {
    fail(`pointer.sizeBytes must be between 1 and ${MAX_SNAPSHOT_SIZE_BYTES}`);
  }
  assertTimestamp(pointer.createdAt, 'pointer.createdAt');
  assertKeyId(pointer.keyId, 'pointer.keyId');
  assertSignature(pointer.sig, 'pointer.sig');
}

export function assertConfigSnapshot(value: unknown): asserts value is ConfigSnapshot {
  const snapshot = requireRecord(value, 'snapshot');
  canonicalizeJson(snapshot as JsonValue);
  assertContractVersion(snapshot.contractVersion);
  assertTarget(snapshot, 'snapshot');
  assertConfigVersion(snapshot.configVersion, 'snapshot.configVersion');
  assertSchemaVersion(snapshot.schemaVersion, 'snapshot.schemaVersion');
  assertTimestamp(snapshot.generatedAt, 'snapshot.generatedAt');

  const coveredKeys = new Set<string>();
  const values = requireRecord(snapshot.values, 'snapshot.values');
  for (const [key, entry] of Object.entries(values)) {
    if (!isConfigKey(key)) fail(`snapshot.values key ${key} is invalid`);
    if (entry === null) fail(`snapshot.values.${key} must not be null`);
    canonicalizeJson(entry as JsonValue);
    coveredKeys.add(key);
  }

  if (!Array.isArray(snapshot.overrides)) fail('snapshot.overrides must be an array');
  for (const [index, entry] of snapshot.overrides.entries()) {
    const override = requireRecord(entry, `snapshot.overrides[${index}]`);
    assertCondition(override.when, `snapshot.overrides[${index}].when`);
    const patch = requireRecord(override.set, `snapshot.overrides[${index}].set`);
    for (const [key, patchValue] of Object.entries(patch)) {
      if (!isConfigKey(key)) fail(`snapshot.overrides[${index}].set key ${key} is invalid`);
      canonicalizeJson(patchValue as JsonValue);
      coveredKeys.add(key);
    }
  }

  const rollouts = requireRecord(snapshot.rollouts, 'snapshot.rollouts');
  for (const [key, entry] of Object.entries(rollouts)) {
    if (!key.startsWith('feature.') || !isConfigKey(key)) {
      fail(`snapshot.rollouts key ${key} must be a feature key`);
    }
    const rollout = requireRecord(entry, `snapshot.rollouts.${key}`);
    assertAllowedKeys(
      rollout,
      new Set(['basisPoints', 'salt', 'value']),
      `snapshot.rollouts.${key}`,
    );
    const basisPoints = requireSafeInteger(
      rollout.basisPoints,
      `snapshot.rollouts.${key}.basisPoints`,
    );
    if (basisPoints < 0 || basisPoints > 10000) {
      fail(`snapshot.rollouts.${key}.basisPoints is invalid`);
    }
    const salt = requireString(rollout.salt, `snapshot.rollouts.${key}.salt`);
    const saltLength = new TextEncoder().encode(salt).byteLength;
    if (saltLength < 1 || saltLength > 128) {
      fail(`snapshot.rollouts.${key}.salt length is invalid`);
    }
    if (typeof rollout.value !== 'boolean') {
      fail(`snapshot.rollouts.${key}.value must be boolean`);
    }
    coveredKeys.add(key);
  }

  const applyModes = requireRecord(snapshot.applyModes, 'snapshot.applyModes');
  for (const [key, mode] of Object.entries(applyModes)) {
    if (!isConfigKey(key)) fail(`snapshot.applyModes key ${key} is invalid`);
    if (typeof mode !== 'string' || !APPLY_MODE_SET.has(mode)) {
      fail(`snapshot.applyModes.${key} is invalid`);
    }
  }
  for (const key of coveredKeys) {
    if (!(key in applyModes)) fail(`snapshot.applyModes is missing ${key}`);
  }
}

export function assertEmergencyDocument(value: unknown): asserts value is EmergencyDocument {
  const emergency = requireRecord(value, 'emergency');
  canonicalSignedPayload(emergency);
  assertContractVersion(emergency.contractVersion);
  assertBrandId(emergency.brandId, 'emergency.brandId');
  assertPlatform(emergency.platform, 'emergency.platform');
  const emergencyVersion = requireString(emergency.emergencyVersion, 'emergency.emergencyVersion');
  assertMonotonicVersion(emergencyVersion, 'emergency.emergencyVersion');
  assertTimestamp(emergency.createdAt, 'emergency.createdAt');
  assertKeyId(emergency.keyId, 'emergency.keyId');
  assertSignature(emergency.sig, 'emergency.sig');
  if (!Array.isArray(emergency.disabledFeatures)) {
    fail('emergency.disabledFeatures must be an array');
  }
  const disabledFeatures = emergency.disabledFeatures.map((entry, index) => {
    const key = requireString(entry, `emergency.disabledFeatures[${index}]`);
    if (!key.startsWith('feature.') || !isConfigKey(key)) {
      fail(`emergency.disabledFeatures[${index}] must be a feature key`);
    }
    return key;
  });
  const sortedFeatures = [...new Set(disabledFeatures)].sort();
  if (
    sortedFeatures.length !== disabledFeatures.length ||
    sortedFeatures.some((entry, index) => entry !== disabledFeatures[index])
  ) {
    fail('emergency.disabledFeatures must be sorted and unique');
  }
  if (
    emergency.forceMinVersion !== null &&
    (typeof emergency.forceMinVersion !== 'string' || !isValidSemver(emergency.forceMinVersion))
  ) {
    fail('emergency.forceMinVersion must be SemVer or null');
  }
  assertNotice(emergency.notice, 'emergency.notice');
}

export function targetMatches(
  document: Pick<ConfigTarget, 'brandId' | 'channel' | 'platform'>,
  target: ConfigTarget,
): boolean {
  return (
    document.brandId === target.brandId &&
    document.platform === target.platform &&
    document.channel === target.channel
  );
}

export function emergencyTargetMatches(
  document: Pick<EmergencyDocument, 'brandId' | 'platform'>,
  target: Pick<ConfigTarget, 'brandId' | 'platform'>,
): boolean {
  return document.brandId === target.brandId && document.platform === target.platform;
}

export function configPointerPath(target: ConfigTarget): string {
  assertBrandId(target.brandId, 'target.brandId');
  assertPlatform(target.platform, 'target.platform');
  assertChannel(target.channel, 'target.channel');
  return `/v1/${target.brandId}/${target.platform}/${target.channel}/latest.json`;
}

export function configSnapshotPath(target: ConfigTarget, sha256: string): string {
  assertBrandId(target.brandId, 'target.brandId');
  assertPlatform(target.platform, 'target.platform');
  assertChannel(target.channel, 'target.channel');
  assertSha256(sha256, 'sha256');
  return `/v1/${target.brandId}/${target.platform}/${target.channel}/s/${sha256}.json`;
}

export function emergencyPath(target: Pick<ConfigTarget, 'brandId' | 'platform'>): string {
  assertBrandId(target.brandId, 'target.brandId');
  assertPlatform(target.platform, 'target.platform');
  return `/v1/${target.brandId}/${target.platform}/emergency.json`;
}

export {
  applyConfigPatch,
  applyMergePatch,
  conditionMatches,
  isConfigKey,
  isUuidV4,
  localeMatches,
  murmur3X86_32,
  normalizeLocale,
  rolloutBucket,
  rolloutMatches,
} from './rules';
export { isValidSemver, isValidVersionRange, matchesVersionRange } from './semver';
