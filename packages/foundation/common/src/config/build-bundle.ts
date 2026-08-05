// Client half of the frozen build-bundle contract v1 (publisher CONTRACT.md "Build bundle
// contract v1"). Validation only — rendering stays in the publisher; never reimplement it here.

import type { ConfigBuildBundle } from '@linkcode/schema/remote-config';
import { assertConfigBuildBundle as assertConfigBuildBundleContract } from '@linkcode/schema/remote-config';
import { sha256 } from '@noble/hashes/sha2.js';
import { assertConfigSnapshot, canonicalizeJson } from './contract';
import { cloneJson, decodeBase64Url, parseIJson } from './i-json';
import type {
  ConfigDefinitions,
  ConfigSnapshot,
  ConfigValue,
  ConfigValueDefinition,
  JsonValue,
} from './types';

const ED25519_PUBLIC_KEY_BYTES = 32;

export type {
  ConfigBuildBundle,
  ConfigBuildBundleEndpoints,
  ConfigBuildBundleKeyrings,
  ConfigBuildBundleProvenance,
  ConfigBuildBundleSnapshotEnvelope,
} from '@linkcode/schema/remote-config';
export { CONFIG_BUILD_BUNDLE_VERSION } from '@linkcode/schema/remote-config';

function fail(message: string): never {
  throw new TypeError(message);
}

function assertKeyring(keyring: Readonly<Record<string, string>>, label: string): void {
  for (const [keyId, publicKey] of Object.entries(keyring)) {
    let decoded: Uint8Array;
    try {
      decoded = decodeBase64Url(publicKey);
    } catch {
      fail(`${label}.${keyId} must be canonical Base64URL`);
    }
    if (decoded.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
      fail(`${label}.${keyId} must be a raw 32-byte Ed25519 public key`);
    }
  }
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
  assertConfigBuildBundleContract(value);
  const bundle = value;
  assertKeyring(bundle.keyrings.normal, 'bundle.keyrings.normal');
  assertKeyring(bundle.keyrings.emergency, 'bundle.keyrings.emergency');

  const snapshotEnvelope = bundle.snapshot;
  let snapshotBytes: Uint8Array;
  try {
    snapshotBytes = decodeBase64Url(snapshotEnvelope.base64Url);
  } catch {
    fail('bundle.snapshot.base64Url must be canonical Base64URL');
  }
  if (snapshotBytes.byteLength !== snapshotEnvelope.sizeBytes) {
    fail('bundle.snapshot.sizeBytes does not match the snapshot bytes');
  }
  if (sha256Hex(snapshotBytes) !== snapshotEnvelope.sha256) {
    fail('bundle.snapshot.sha256 does not match the snapshot bytes');
  }
  const snapshot = decodeSnapshotBytes(snapshotBytes, 'bundle.snapshot bytes');
  if (
    snapshot.brandId !== bundle.brandId ||
    snapshot.platform !== bundle.platform ||
    snapshot.channel !== bundle.channel
  ) {
    fail('bundle.snapshot target does not match the bundle target');
  }
  if (snapshot.configVersion !== bundle.provenance.configVersion) {
    fail('bundle.provenance.configVersion does not match the snapshot');
  }
  if (snapshot.generatedAt !== bundle.provenance.generatedAt) {
    fail('bundle.provenance.generatedAt does not match the snapshot');
  }
  if (snapshot.schemaVersion !== bundle.provenance.schemaVersion) {
    fail('bundle.provenance.schemaVersion does not match the snapshot');
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
