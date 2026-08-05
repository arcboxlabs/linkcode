import { hashes, verify } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import canonicalize from 'canonicalize';
import vector from './__fixtures__/config-signing-vector.json';

export interface ConfigSigningPocResult {
  canonicalPayloadSha256: string;
  emergencySignatureValid: boolean;
  pointerSignatureValid: boolean;
  rfc8032SignatureValid: boolean;
  snapshotSha256: string;
}

const encoder = new TextEncoder();
const BASE64URL_PATTERN = /^[\w-]*$/;
hashes.sha512 = sha512;

export function runNobleConfigSigningPoc(): ConfigSigningPocResult {
  const canonicalRfc8785 = canonicalize(vector.rfc8785.input);
  assertEqual(canonicalRfc8785, vector.rfc8785.canonical, 'RFC 8785 canonical JSON');

  const canonicalPayload = canonicalize(vector.configPointer.payload);
  assertEqual(
    canonicalPayload,
    vector.configPointer.canonicalPayload,
    'config pointer canonical JSON',
  );
  const canonicalPayloadBytes = encoder.encode(canonicalPayload);
  assertBytesEqual(
    decodeBase64Url(vector.configPointer.canonicalPayloadBase64Url),
    canonicalPayloadBytes,
    'config pointer canonical UTF-8 bytes',
  );

  const canonicalSnapshot = canonicalize(vector.snapshot.payload);
  assertEqual(canonicalSnapshot, vector.snapshot.canonicalPayload, 'snapshot canonical JSON');
  const snapshotBytes = encoder.encode(canonicalSnapshot);
  assertBytesEqual(
    decodeBase64Url(vector.snapshot.canonicalPayloadBase64Url),
    snapshotBytes,
    'snapshot canonical UTF-8 bytes',
  );
  assertTrue(snapshotBytes.length === vector.snapshot.sizeBytes, 'snapshot UTF-8 byte length');
  const snapshotSha256 = toHex(sha256(snapshotBytes));
  assertEqual(snapshotSha256, vector.snapshot.sha256, 'snapshot SHA-256 digest');
  assertEqual(
    snapshotSha256,
    vector.configPointer.payload.sha256,
    'config pointer snapshot SHA-256 digest',
  );
  const canonicalEmergency = canonicalize(vector.emergency.payload);
  assertEqual(canonicalEmergency, vector.emergency.canonicalPayload, 'emergency canonical JSON');
  const emergencyBytes = encoder.encode(canonicalEmergency);

  const rfc8032SignatureValid = verifyVector(
    vector.rfc8032.signatureBase64Url,
    decodeBase64Url(vector.rfc8032.messageBase64Url),
    vector.rfc8032.publicKeyBase64Url,
  );
  const pointerSignatureValid = verifyVector(
    vector.configPointer.signatureBase64Url,
    canonicalPayloadBytes,
    vector.configPointer.publicKeyBase64Url,
  );
  const emergencySignatureValid = verifyVector(
    vector.emergency.signatureBase64Url,
    emergencyBytes,
    vector.emergency.publicKeyBase64Url,
  );

  assertTrue(rfc8032SignatureValid, 'RFC 8032 signature');
  assertTrue(pointerSignatureValid, 'config pointer signature');
  assertTrue(emergencySignatureValid, 'emergency signature');

  const mutatedSignature = decodeBase64Url(vector.configPointer.signatureBase64Url);
  mutatedSignature[0] ^= 1;
  assertTrue(
    !verify(
      mutatedSignature,
      canonicalPayloadBytes,
      decodeBase64Url(vector.configPointer.publicKeyBase64Url),
      { zip215: false },
    ),
    'mutated config pointer signature rejection',
  );

  return {
    canonicalPayloadSha256: toHex(sha256(canonicalPayloadBytes)),
    emergencySignatureValid,
    pointerSignatureValid,
    rfc8032SignatureValid,
    snapshotSha256,
  };
}

export async function runWebCryptoConfigSigningPoc(
  subtle: SubtleCrypto,
): Promise<ConfigSigningPocResult> {
  const nobleResult = runNobleConfigSigningPoc();
  const canonicalPayloadBytes = encoder.encode(vector.configPointer.canonicalPayload);
  const nativeDigest = new Uint8Array(
    await subtle.digest('SHA-256', toArrayBuffer(canonicalPayloadBytes)),
  );
  assertEqual(toHex(nativeDigest), nobleResult.canonicalPayloadSha256, 'WebCrypto SHA-256 digest');
  const nativeSnapshotDigest = new Uint8Array(
    await subtle.digest('SHA-256', toArrayBuffer(encoder.encode(vector.snapshot.canonicalPayload))),
  );
  assertEqual(
    toHex(nativeSnapshotDigest),
    vector.snapshot.sha256,
    'WebCrypto snapshot SHA-256 digest',
  );
  const canonicalEmergency = canonicalize(vector.emergency.payload);
  assertEqual(canonicalEmergency, vector.emergency.canonicalPayload, 'emergency canonical JSON');

  const [rfc8032SignatureValid, pointerSignatureValid, emergencySignatureValid] = await Promise.all(
    [
      verifyWebCryptoVector(
        subtle,
        vector.rfc8032.signatureBase64Url,
        decodeBase64Url(vector.rfc8032.messageBase64Url),
        vector.rfc8032.publicKeyBase64Url,
      ),
      verifyWebCryptoVector(
        subtle,
        vector.configPointer.signatureBase64Url,
        canonicalPayloadBytes,
        vector.configPointer.publicKeyBase64Url,
      ),
      verifyWebCryptoVector(
        subtle,
        vector.emergency.signatureBase64Url,
        encoder.encode(canonicalEmergency),
        vector.emergency.publicKeyBase64Url,
      ),
    ],
  );

  assertTrue(rfc8032SignatureValid, 'WebCrypto RFC 8032 signature');
  assertTrue(pointerSignatureValid, 'WebCrypto config pointer signature');
  assertTrue(emergencySignatureValid, 'WebCrypto emergency signature');

  const mutatedSignature = decodeBase64Url(vector.configPointer.signatureBase64Url);
  mutatedSignature[0] ^= 1;
  assertTrue(
    !(await verifyWebCryptoBytes(
      subtle,
      mutatedSignature,
      canonicalPayloadBytes,
      vector.configPointer.publicKeyBase64Url,
    )),
    'WebCrypto mutated config pointer signature rejection',
  );

  return {
    canonicalPayloadSha256: toHex(nativeDigest),
    emergencySignatureValid,
    pointerSignatureValid,
    rfc8032SignatureValid,
    snapshotSha256: toHex(nativeSnapshotDigest),
  };
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new TypeError('Invalid Base64URL value');
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(Math.floor((value.length * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let offset = 0;

  for (const character of value) {
    accumulator = accumulator * 64 + alphabet.indexOf(character);
    bits += 6;
    if (bits < 8) continue;
    bits -= 8;
    bytes[offset] = Math.floor(accumulator / 2 ** bits) % 256;
    accumulator %= 2 ** bits;
    offset += 1;
  }
  if (accumulator !== 0) throw new TypeError('Invalid Base64URL value');

  return bytes;
}

function verifyVector(signature: string, message: Uint8Array, publicKey: string): boolean {
  return verify(decodeBase64Url(signature), message, decodeBase64Url(publicKey), {
    zip215: false,
  });
}

async function verifyWebCryptoVector(
  subtle: SubtleCrypto,
  signature: string,
  message: Uint8Array,
  publicKey: string,
): Promise<boolean> {
  return verifyWebCryptoBytes(subtle, decodeBase64Url(signature), message, publicKey);
}

async function verifyWebCryptoBytes(
  subtle: SubtleCrypto,
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: string,
): Promise<boolean> {
  const key = await subtle.importKey(
    'raw',
    toArrayBuffer(decodeBase64Url(publicKey)),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return subtle.verify({ name: 'Ed25519' }, key, toArrayBuffer(signature), toArrayBuffer(message));
}

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, name: string): void {
  assertTrue(
    actual.length === expected.length && actual.every((byte, index) => byte === expected[index]),
    name,
  );
}

function assertEqual(actual: string | undefined, expected: string, name: string): asserts actual {
  if (actual !== expected) throw new Error(`${name} does not match the CODE-537 fixture`);
}

function assertTrue(value: boolean, name: string): asserts value {
  if (!value) throw new Error(`${name} does not match the CODE-537 fixture`);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}
