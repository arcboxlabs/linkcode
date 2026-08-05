import { setBit } from 'foxts/bitwise';
import { cloneJson } from './i-json';
import { matchesVersionRange } from './semver';
import type { EvaluationContext, JsonValue, OverrideCondition } from './types';

const RE_CONFIG_KEY = /^(?:app|content|feature|modules|params|ui)(?:\.[a-z][A-Za-z0-9]*)+$/;
const RE_LOCALE_SUBTAG = /^[\dA-Z]{1,8}$/i;
const RE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RE_ASCII_UPPER = /[A-Z]/g;

function fail(message: string): never {
  throw new TypeError(message);
}

export function isConfigKey(value: string): boolean {
  return RE_CONFIG_KEY.test(value);
}

export function isUuidV4(value: string): boolean {
  return RE_UUID_V4.test(value);
}

export function applyMergePatch(
  target: JsonValue | undefined,
  patch: JsonValue,
): JsonValue | undefined {
  if (patch === null) return undefined;
  if (typeof patch !== 'object' || Array.isArray(patch)) return cloneJson(patch);
  const result: Record<string, JsonValue> =
    typeof target === 'object' && target !== null && !Array.isArray(target)
      ? cloneJson(target)
      : {};
  for (const [key, patchValue] of Object.entries(patch)) {
    const merged = applyMergePatch(result[key], patchValue);
    if (merged === undefined) Reflect.deleteProperty(result, key);
    else result[key] = merged;
  }
  return result;
}

export function applyConfigPatch(
  values: Readonly<Record<string, JsonValue>>,
  patch: Readonly<Record<string, JsonValue>>,
): Record<string, JsonValue> {
  const result = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, cloneJson(value)]),
  );
  for (const [key, patchValue] of Object.entries(patch)) {
    if (!isConfigKey(key)) fail(`patch key ${key} is invalid`);
    const merged = applyMergePatch(result[key], patchValue);
    if (merged === undefined) Reflect.deleteProperty(result, key);
    else result[key] = merged;
  }
  return result;
}

export function normalizeLocale(value: string): string | null {
  const normalized = value
    .replaceAll('_', '-')
    .replaceAll(RE_ASCII_UPPER, (character) =>
      String.fromCodePoint((character.codePointAt(0) ?? 0) + 32),
    );
  const subtags = normalized.split('-');
  if (subtags.some((subtag) => !RE_LOCALE_SUBTAG.test(subtag))) return null;
  return normalized;
}

export function localeMatches(locale: string, prefix: string): boolean {
  const normalizedLocale = normalizeLocale(locale);
  const normalizedPrefix = normalizeLocale(prefix);
  if (!normalizedLocale || !normalizedPrefix) return false;
  return (
    normalizedLocale === normalizedPrefix || normalizedLocale.startsWith(`${normalizedPrefix}-`)
  );
}

export function conditionMatches(
  condition: OverrideCondition,
  context: EvaluationContext,
): boolean {
  if (
    condition.appVersion !== undefined &&
    !matchesVersionRange(context.appVersion, condition.appVersion)
  ) {
    return false;
  }
  if (condition.os !== undefined && condition.os !== context.os) return false;
  return !(condition.locale !== undefined && !localeMatches(context.locale, condition.locale));
}

// eslint-disable-next-line @typescript-eslint/naming-convention -- x86_32 is the standardized variant name.
export function murmur3X86_32(value: string, seed = 0): number {
  const bytes = new TextEncoder().encode(value);
  let hash = seed >>> 0;
  const blockEnd = bytes.length - (bytes.length % 4);
  for (let index = 0; index < blockEnd; index += 4) {
    let block = setBit(
      setBit(setBit(bytes[index], bytes[index + 1] << 8), bytes[index + 2] << 16),
      bytes[index + 3] << 24,
    );
    block = Math.imul(block, 3_432_918_353);
    block = setBit(block << 15, block >>> 17);
    block = Math.imul(block, 461_845_907);
    hash ^= block;
    hash = setBit(hash << 13, hash >>> 19);
    hash = Math.imul(hash, 5) + 3_864_292_196;
  }
  let tail = 0;
  const remainder = bytes.length % 4;
  if (remainder === 3) tail ^= bytes[blockEnd + 2] << 16;
  if (remainder >= 2) tail ^= bytes[blockEnd + 1] << 8;
  if (remainder >= 1) {
    tail ^= bytes[blockEnd];
    tail = Math.imul(tail, 3_432_918_353);
    tail = setBit(tail << 15, tail >>> 17);
    tail = Math.imul(tail, 461_845_907);
    hash ^= tail;
  }
  hash ^= bytes.length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2_246_822_507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3_266_489_909);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function rolloutBucket(salt: string, deviceId: string): number {
  if (!RE_UUID_V4.test(deviceId)) fail('deviceId must be a UUIDv4');
  const saltBytes = new TextEncoder().encode(salt);
  if (saltBytes.byteLength < 1 || saltBytes.byteLength > 128) {
    fail('salt must contain 1 to 128 UTF-8 bytes');
  }
  return murmur3X86_32(`${salt}:${deviceId.toLowerCase()}`, 0) % 10000;
}

export function rolloutMatches(salt: string, deviceId: string, basisPoints: number): boolean {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    fail('basisPoints must be an integer from 0 through 10000');
  }
  return rolloutBucket(salt, deviceId) < basisPoints;
}
