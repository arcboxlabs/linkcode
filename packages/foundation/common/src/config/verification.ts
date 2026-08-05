import {
  assertConfigPointer,
  assertConfigSnapshot,
  assertEmergencyDocument,
  canonicalSignedPayloadBytes,
  emergencyTargetMatches,
  isRecord,
  targetMatches,
} from './contract';
import { decodeBase64Url, parseIJson } from './i-json';
import type {
  ConfigCrypto,
  ConfigPointer,
  ConfigSnapshot,
  ConfigTarget,
  EmergencyDocument,
} from './types';
import { CONFIG_CONTRACT_VERSION, ConfigCoreError, MAX_SNAPSHOT_SIZE_BYTES } from './types';

export interface VerifiedPointer {
  readonly document: ConfigPointer;
  readonly payloadSha256: string;
  readonly rawBytes: Uint8Array;
}

export interface VerifiedEmergency {
  readonly document: EmergencyDocument;
  readonly payloadSha256: string;
  readonly rawBytes: Uint8Array;
}

export interface ValidatedSnapshot {
  readonly document: ConfigSnapshot;
  readonly rawBytes: Uint8Array;
}

interface VerificationOptions {
  readonly crypto: ConfigCrypto;
  readonly keyring: Readonly<Record<string, string>>;
  readonly target: ConfigTarget;
}

export async function verifyPointerBytes(
  rawBytes: Uint8Array,
  options: VerificationOptions,
): Promise<VerifiedPointer> {
  const value = parseDocument(rawBytes);
  assertSupportedContract(value);
  assertSignatureEncoding(value);
  try {
    assertConfigPointer(value);
  } catch (error) {
    throw new ConfigCoreError('malformed', 'Invalid signed pointer', { cause: error });
  }
  if (!targetMatches(value, options.target)) {
    throw new ConfigCoreError('target-mismatch', 'Pointer target does not match bootstrap');
  }
  const payloadBytes = canonicalSignedPayloadBytes(value);
  await verifySignature(value.keyId, value.sig, payloadBytes, options);
  return {
    document: value,
    payloadSha256: await sha256Hex(payloadBytes, options.crypto),
    rawBytes: rawBytes.slice(),
  };
}

export async function verifyEmergencyBytes(
  rawBytes: Uint8Array,
  options: VerificationOptions,
): Promise<VerifiedEmergency> {
  const value = parseDocument(rawBytes);
  assertSupportedContract(value);
  assertSignatureEncoding(value);
  try {
    assertEmergencyDocument(value);
  } catch (error) {
    throw new ConfigCoreError('malformed', 'Invalid signed emergency document', { cause: error });
  }
  if (!emergencyTargetMatches(value, options.target)) {
    throw new ConfigCoreError('target-mismatch', 'Emergency target does not match bootstrap');
  }
  const payloadBytes = canonicalSignedPayloadBytes(value);
  await verifySignature(value.keyId, value.sig, payloadBytes, options);
  return {
    document: value,
    payloadSha256: await sha256Hex(payloadBytes, options.crypto),
    rawBytes: rawBytes.slice(),
  };
}

export async function validateSnapshotBytes(
  rawBytes: Uint8Array,
  pointer: ConfigPointer,
  target: ConfigTarget,
  crypto: ConfigCrypto,
): Promise<ValidatedSnapshot> {
  const snapshotBytes = rawBytes.slice();
  if (
    snapshotBytes.byteLength > MAX_SNAPSHOT_SIZE_BYTES ||
    snapshotBytes.byteLength !== pointer.sizeBytes
  ) {
    throw new ConfigCoreError(
      'size-mismatch',
      `Snapshot size ${snapshotBytes.byteLength} does not match ${pointer.sizeBytes}`,
    );
  }
  const digest = await sha256Hex(snapshotBytes, crypto);
  if (digest !== pointer.sha256) {
    throw new ConfigCoreError('hash-mismatch', 'Snapshot SHA-256 does not match pointer');
  }
  const value = parseDocument(snapshotBytes);
  assertSupportedContract(value);
  try {
    assertConfigSnapshot(value);
  } catch (error) {
    throw new ConfigCoreError('schema-invalid', 'Snapshot violates configuration contract', {
      cause: error,
    });
  }
  if (!targetMatches(value, target)) {
    throw new ConfigCoreError('target-mismatch', 'Snapshot target does not match bootstrap');
  }
  if (
    value.configVersion !== pointer.configVersion ||
    value.schemaVersion !== pointer.snapshotSchemaVersion
  ) {
    throw new ConfigCoreError('schema-invalid', 'Snapshot metadata does not match pointer');
  }
  return { document: value, rawBytes: snapshotBytes };
}

export async function sha256Hex(bytes: Uint8Array, crypto: ConfigCrypto): Promise<string> {
  let digest: Uint8Array;
  try {
    digest = await crypto.sha256(bytes.slice());
  } catch (error) {
    throw new ConfigCoreError('crypto-unavailable', 'SHA-256 is unavailable', { cause: error });
  }
  if (digest.byteLength !== 32) {
    throw new ConfigCoreError('crypto-unavailable', 'SHA-256 returned the wrong digest length');
  }
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseDocument(rawBytes: Uint8Array): unknown {
  try {
    return parseIJson(rawBytes);
  } catch (error) {
    throw new ConfigCoreError('malformed', 'Response is not valid I-JSON', { cause: error });
  }
}

function assertSupportedContract(value: unknown): void {
  if (isRecord(value) && value.contractVersion !== CONFIG_CONTRACT_VERSION) {
    throw new ConfigCoreError(
      'unsupported-contract',
      `Unsupported contractVersion ${String(value.contractVersion)}`,
    );
  }
}

function assertSignatureEncoding(value: unknown): void {
  if (!isRecord(value) || typeof value.sig !== 'string') {
    throw new ConfigCoreError('malformed-signature', 'Signature must be a Base64URL string');
  }
  let signature: Uint8Array;
  try {
    signature = decodeBase64Url(value.sig);
  } catch (error) {
    throw new ConfigCoreError('malformed-signature', 'Signature is not canonical Base64URL', {
      cause: error,
    });
  }
  if (signature.byteLength !== 64) {
    throw new ConfigCoreError('invalid-signature-length', 'Signature must contain 64 bytes');
  }
}

async function verifySignature(
  keyId: string,
  encodedSignature: string,
  payloadBytes: Uint8Array,
  options: VerificationOptions,
): Promise<void> {
  if (!Object.hasOwn(options.keyring, keyId)) {
    throw new ConfigCoreError('unknown-key', `Unknown signing key ${keyId}`);
  }
  const encodedKey = options.keyring[keyId];
  let publicKey: Uint8Array;
  try {
    publicKey = decodeBase64Url(encodedKey);
  } catch (error) {
    throw new ConfigCoreError('malformed-key', `Signing key ${keyId} is not canonical Base64URL`, {
      cause: error,
    });
  }
  if (publicKey.byteLength !== 32) {
    throw new ConfigCoreError('invalid-key-length', `Signing key ${keyId} must contain 32 bytes`);
  }
  const signature = decodeBase64Url(encodedSignature);
  let valid: boolean;
  try {
    valid = await options.crypto.verifyEd25519(publicKey, signature, payloadBytes.slice());
  } catch (error) {
    throw new ConfigCoreError('crypto-unavailable', 'Ed25519 verification is unavailable', {
      cause: error,
    });
  }
  if (!valid) throw new ConfigCoreError('invalid-signature', 'Ed25519 signature is invalid');
}
