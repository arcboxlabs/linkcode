import { readFileSync } from 'node:fs';
import { getPublicKey, hashes, sign, verify } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/emergency-handoff-v1.json';
import {
  assertEmergencyDocument,
  canonicalizeJson,
  canonicalSignedPayload,
  canonicalSignedPayloadBytes,
  decideAntiReplay,
  emergencyPath,
} from '../contract';
import { emergencyHostState } from '../evaluation';
import { decodeBase64Url, encodeBase64Url, parseIJson } from '../i-json';
import type { AntiReplayDecision, ConfigCrypto, ConfigTarget, JsonValue } from '../types';
import { verifyEmergencyBytes } from '../verification';

// Frozen by the cloud half (linkcodehq CODE-554): the client consumes these bytes verbatim.
const FIXTURE_SIZE_BYTES = 14540;
const FIXTURE_SHA256 = '2fa79670900ed6e80c159cd2a569814f6e5c0302059b7c5ffeb2c0a5707af3b4';
// RFC 8032 §7.1 test 1 seed: the fixture keyring is this public conformance key, never production.
const RFC8032_SEED = hexBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');

type DocumentName = keyof typeof fixture.documents;
const DOCUMENT_NAMES = ['killSwitch', 'forcedMinimum', 'release', 'equivocation'] as const;
const PLATFORMS = ['desktop', 'ios', 'android'] as const;

const encoder = new TextEncoder();
hashes.sha512 = sha512;
const crypto: ConfigCrypto = {
  randomUuid: () => '550e8400-e29b-41d4-a716-446655440000',
  sha256: (bytes) => Promise.resolve(sha256(bytes)),
  verifyEd25519: (publicKey, signature, message) =>
    Promise.resolve(verify(signature, message, publicKey, { zip215: false })),
};
const emergencyKeys: Readonly<Record<string, string>> = fixture.keys.emergency;
const TARGET: ConfigTarget = { brandId: 'acme', channel: 'canary', platform: 'desktop' };

describe('emergency handoff fixture integrity', () => {
  it('locks the exact frozen fixture bytes', () => {
    const bytes = readFileSync(
      new URL('../__fixtures__/emergency-handoff-v1.json', import.meta.url),
    );
    expect(bytes.byteLength).toBe(FIXTURE_SIZE_BYTES);
    expect(hex(sha256(bytes))).toBe(FIXTURE_SHA256);
  });

  it('binds the fixture keyring to the RFC 8032 conformance seed, not a production key', () => {
    expect(Object.keys(emergencyKeys)).toEqual(['emergency-rfc8032-1']);
    expect(emergencyKeys['emergency-rfc8032-1']).toBe(encodeBase64Url(getPublicKey(RFC8032_SEED)));
  });

  it('serves the channel-neutral dedicated emergency path', () => {
    expect(fixture.endpoint.pathTemplate).toBe('/v1/{brandId}/{platform}/emergency.json');
    expect(emergencyPath({ brandId: 'acme', platform: 'desktop' })).toBe(
      '/v1/acme/desktop/emergency.json',
    );
  });
});

describe('emergency handoff signed documents', () => {
  it.each(DOCUMENT_NAMES)('locks canonical bytes, digests, and signature of %s', async (name) => {
    const vector = fixture.documents[name];
    const document = parseIJson(documentBytes(name));
    assertEmergencyDocument(document);
    expect(document).toEqual(vector.document);

    expect(canonicalSignedPayload(document)).toBe(vector.canonicalPayload);
    expect(hex(sha256(canonicalSignedPayloadBytes(document)))).toBe(vector.payloadSha256);

    const canonicalDocument = canonicalizeJson(document);
    expect(canonicalDocument).toBe(vector.canonicalDocument);
    const bytes = encoder.encode(canonicalDocument);
    expect(bytes.byteLength).toBe(vector.sizeBytes);
    expect(encodeBase64Url(bytes)).toBe(vector.canonicalDocumentBase64Url);
    expect(hex(sha256(bytes))).toBe(vector.documentSha256);

    const verified = await verifyEmergencyBytes(bytes, {
      crypto,
      keyring: emergencyKeys,
      target: TARGET,
    });
    expect(verified.payloadSha256).toBe(vector.payloadSha256);
  });

  it('accepts the target on both channels: emergency state is channel-neutral', async () => {
    await Promise.all(
      (['canary', 'stable'] as const).map((channel) =>
        expect(
          verifyEmergencyBytes(documentBytes('killSwitch'), {
            crypto,
            keyring: emergencyKeys,
            target: { ...TARGET, channel },
          }),
        ).resolves.toMatchObject({ document: { emergencyVersion: '1' } }),
      ),
    );
  });

  it.each([
    ['brand', { ...TARGET, brandId: 'other' }],
    ['platform (ios)', { ...TARGET, platform: 'ios' }] as const,
    ['platform (android)', { ...TARGET, platform: 'android' }] as const,
  ])('rejects a %s mismatch', async (_name, target) => {
    await expect(
      verifyEmergencyBytes(documentBytes('killSwitch'), {
        crypto,
        keyring: emergencyKeys,
        target,
      }),
    ).rejects.toMatchObject({ code: 'target-mismatch' });
  });

  it('rejects unknown keys and wrong key material — normal keys never verify emergencies', async () => {
    await expect(
      verifyEmergencyBytes(documentBytes('killSwitch'), { crypto, keyring: {}, target: TARGET }),
    ).rejects.toMatchObject({ code: 'unknown-key' });
    await expect(
      verifyEmergencyBytes(documentBytes('killSwitch'), {
        crypto,
        keyring: { 'normal-2026': emergencyKeys['emergency-rfc8032-1'] },
        target: TARGET,
      }),
    ).rejects.toMatchObject({ code: 'unknown-key' });
    const wrongKey = encodeBase64Url(getPublicKey(sha256(RFC8032_SEED)));
    await expect(
      verifyEmergencyBytes(documentBytes('killSwitch'), {
        crypto,
        keyring: { 'emergency-rfc8032-1': wrongKey },
        target: TARGET,
      }),
    ).rejects.toMatchObject({ code: 'invalid-signature' });
  });

  it('rejects signature and payload mutations', async () => {
    const original = fixture.documents.killSwitch.document;
    const flippedSignature = decodeBase64Url(original.sig);
    flippedSignature[0] ^= 1;
    const mutatedSig = { ...original, sig: encodeBase64Url(flippedSignature) };
    await expect(
      verifyEmergencyBytes(encoder.encode(JSON.stringify(mutatedSig)), {
        crypto,
        keyring: emergencyKeys,
        target: TARGET,
      }),
    ).rejects.toMatchObject({ code: 'invalid-signature' });

    const mutatedPayload = { ...original, emergencyVersion: '9' };
    await expect(
      verifyEmergencyBytes(encoder.encode(JSON.stringify(mutatedPayload)), {
        crypto,
        keyring: emergencyKeys,
        target: TARGET,
      }),
    ).rejects.toMatchObject({ code: 'invalid-signature' });

    const truncatedSig = { ...original, sig: encodeBase64Url(flippedSignature.slice(0, 63)) };
    await expect(
      verifyEmergencyBytes(encoder.encode(JSON.stringify(truncatedSig)), {
        crypto,
        keyring: emergencyKeys,
        target: TARGET,
      }),
    ).rejects.toMatchObject({ code: 'invalid-signature-length' });
  });
});

describe('emergency handoff anti-replay decision table', () => {
  it('reproduces every frozen decision', () => {
    expect(fixture.antiReplayCases).toHaveLength(5);
    for (const testCase of fixture.antiReplayCases) {
      expect(
        decideAntiReplay(
          replayState(testCase.candidate as DocumentName),
          testCase.accepted === null ? null : replayState(testCase.accepted as DocumentName),
        ),
        testCase.name,
      ).toBe(testCase.expected as AntiReplayDecision);
    }
  });

  it.each(PLATFORMS)('holds decision-table parity on re-signed %s documents', async (platform) => {
    const target: ConfigTarget = { ...TARGET, platform };
    const states: Record<string, { payloadSha256: string; version: string }> = {};
    for (const name of DOCUMENT_NAMES) {
      const signed = resignForPlatform(name, platform);
      // eslint-disable-next-line no-await-in-loop -- documents verify sequentially by design
      const verified = await verifyEmergencyBytes(encoder.encode(JSON.stringify(signed)), {
        crypto,
        keyring: emergencyKeys,
        target,
      });
      states[name] = {
        payloadSha256: verified.payloadSha256,
        version: verified.document.emergencyVersion,
      };
      if (platform === 'desktop') {
        // Ed25519 is deterministic: re-signing the frozen desktop payload must reproduce it.
        expect(signed.sig).toBe(fixture.documents[name].document.sig);
        expect(verified.payloadSha256).toBe(fixture.documents[name].payloadSha256);
      }
    }
    for (const testCase of fixture.antiReplayCases) {
      expect(
        decideAntiReplay(
          states[testCase.candidate],
          testCase.accepted === null ? null : states[testCase.accepted],
        ),
        `${platform}: ${testCase.name}`,
      ).toBe(testCase.expected as AntiReplayDecision);
    }
  });
});

describe('emergency host enforcement state', () => {
  it('requires an update unless the runtime version proves it satisfies the forced minimum', () => {
    const state = {
      disabledFeatures: ['feature.aiAssist'],
      emergencyVersion: '2',
      forceMinVersion: '2.4.0',
      notice: null,
    };
    expect(emergencyHostState(state, '2.3.9')?.updateRequired).toBe(true);
    expect(emergencyHostState(state, '2.4.0')?.updateRequired).toBe(false);
    expect(emergencyHostState(state, '3.0.0')?.updateRequired).toBe(false);
    expect(emergencyHostState(state, 'not-semver')?.updateRequired).toBe(true);
    expect(
      emergencyHostState({ ...state, forceMinVersion: null }, 'not-semver')?.updateRequired,
    ).toBe(false);
  });
});

function documentBytes(name: DocumentName): Uint8Array {
  return encoder.encode(JSON.stringify(fixture.documents[name].document));
}

function replayState(name: DocumentName): { payloadSha256: string; version: string } {
  return {
    payloadSha256: fixture.documents[name].payloadSha256,
    version: fixture.documents[name].document.emergencyVersion,
  };
}

function resignForPlatform(
  name: DocumentName,
  platform: (typeof PLATFORMS)[number],
): Record<string, unknown> {
  const unsigned: Record<string, unknown> = { ...fixture.documents[name].document, platform };
  delete unsigned.sig;
  const payload = encoder.encode(canonicalizeJson(unsigned as JsonValue));
  return { ...unsigned, sig: encodeBase64Url(sign(payload, RFC8032_SEED)) };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
