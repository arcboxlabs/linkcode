import { hashes, verify } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/contract-v1.json';
import {
  applyConfigPatch,
  assertConfigPointer,
  assertConfigSnapshot,
  assertEmergencyDocument,
  assertMonotonicVersion,
  canonicalizeJson,
  canonicalSignedPayload,
  canonicalSignedPayloadBytes,
  compareMonotonicVersions,
  conditionMatches,
  decideAntiReplay,
  emergencyTargetMatches,
  matchesVersionRange,
  murmur3X86_32,
  rolloutBucket,
  rolloutMatches,
  targetMatches,
} from '../contract';
import { cloneJson, decodeBase64Url, encodeBase64Url, parseIJson } from '../i-json';
import type { AntiReplayState, ConfigCrypto, OverrideCondition } from '../types';
import { validateSnapshotBytes, verifyPointerBytes } from '../verification';

interface SignedVector {
  readonly canonicalPayload: string;
  readonly canonicalPayloadBase64Url: string;
  readonly document: Record<string, unknown>;
  readonly payloadSha256: string;
}

const pointers: Record<string, SignedVector> = fixture.pointers;
const emergencies: Record<string, SignedVector> = fixture.emergencies;
const snapshots = fixture.snapshots;
const normalKeys = fixture.keys.normal as Record<string, string>;
const emergencyKeys = fixture.keys.emergency as Record<string, string>;
const encoder = new TextEncoder();
hashes.sha512 = sha512;
const crypto: ConfigCrypto = {
  randomUuid: () => '550e8400-e29b-41d4-a716-446655440000',
  sha256: (bytes) => Promise.resolve(sha256(bytes)),
  verifyEd25519: (publicKey, signature, message) =>
    Promise.resolve(verify(signature, message, publicKey, { zip215: false })),
};

describe('configuration contract v1 golden fixture', () => {
  it('locks exact snapshot bytes, size, and SHA-256', () => {
    for (const name of ['current', 'previous'] as const) {
      const vector = snapshots[name];
      const document = parseIJson(encoder.encode(vector.canonicalPayload));
      assertConfigSnapshot(document);
      expect(document).toEqual(vector.document);
      const canonical = canonicalizeJson(document);
      const bytes = encoder.encode(canonical);
      expect(canonical, name).toBe(vector.canonicalPayload);
      expect(encodeBase64Url(bytes), name).toBe(vector.canonicalPayloadBase64Url);
      expect(bytes.byteLength, name).toBe(vector.sizeBytes);
      expect(toHex(sha256(bytes)), name).toBe(vector.sha256);
    }
    expect(() =>
      assertConfigSnapshot({ ...snapshots.current.document, futureHint: 'optional' }),
    ).not.toThrow();
    const openOverride: Record<string, unknown> = structuredClone(snapshots.current.document);
    openOverride.overrides = [{ futureHint: 'optional', set: {}, when: { os: 'windows' } }];
    expect(() => assertConfigSnapshot(openOverride)).not.toThrow();
  });

  it('cross-checks snapshot metadata against the trusted pointer after raw integrity', async () => {
    const bytes = decodeBase64Url(snapshots.current.canonicalPayloadBase64Url);
    const pointer: unknown = pointers.normal.document;
    assertConfigPointer(pointer);
    const target = { brandId: 'acme', channel: 'canary', platform: 'desktop' } as const;
    await expect(
      validateSnapshotBytes(
        bytes,
        { ...pointer, configVersion: 'opaque-mismatch' },
        target,
        crypto,
      ),
    ).rejects.toMatchObject({ code: 'schema-invalid' });
    await expect(
      validateSnapshotBytes(bytes, { ...pointer, snapshotSchemaVersion: 2 }, target, crypto),
    ).rejects.toMatchObject({ code: 'schema-invalid' });
  });

  it('validates the same snapshot bytes that were covered by the digest', async () => {
    const expectedBytes = decodeBase64Url(snapshots.current.canonicalPayloadBase64Url);
    const rawBytes = expectedBytes.slice();
    let signalDigestStarted!: () => void;
    let releaseDigest!: () => void;
    const digestStarted = new Promise<void>((resolve) => {
      signalDigestStarted = resolve;
    });
    const digestReleased = new Promise<void>((resolve) => {
      releaseDigest = resolve;
    });
    const delayedCrypto: ConfigCrypto = {
      ...crypto,
      async sha256(bytes) {
        signalDigestStarted();
        await digestReleased;
        return sha256(bytes);
      },
    };
    const pointer: unknown = pointers.normal.document;
    assertConfigPointer(pointer);
    const validation = validateSnapshotBytes(
      rawBytes,
      pointer,
      { brandId: 'acme', channel: 'canary', platform: 'desktop' },
      delayedCrypto,
    );
    await digestStarted;
    rawBytes[0] ^= 1;
    releaseDigest();

    const validated = await validation;
    expect(validated.document).toEqual(snapshots.current.document);
    expect(validated.rawBytes).toEqual(expectedBytes);
  });

  it('requires boolean values throughout the feature namespace', () => {
    const snapshot = snapshots.current.document;
    expect(() =>
      assertConfigSnapshot({
        ...snapshot,
        values: { ...snapshot.values, 'feature.aiAssist': 1 },
      }),
    ).toThrow('Feature values must be boolean');
    expect(() =>
      assertConfigSnapshot({
        ...snapshot,
        overrides: [
          {
            ...snapshot.overrides[0],
            set: { ...snapshot.overrides[0].set, 'feature.newEditor': { enabled: true } },
          },
          ...snapshot.overrides.slice(1),
        ],
      }),
    ).toThrow('Feature values must be boolean');
    expect(() =>
      assertConfigSnapshot({
        ...snapshot,
        rollouts: {
          ...snapshot.rollouts,
          'feature.aiAssist': { ...snapshot.rollouts['feature.aiAssist'], value: 'true' },
        },
      }),
    ).toThrow();
  });

  it('verifies pointer signatures while retaining additive root fields', () => {
    for (const name of [
      'normal',
      'rollback',
      'rotationWithoutBump',
      'rotation',
      'additive',
      'schemaTooNew',
    ]) {
      const vector = pointers[name];
      assertConfigPointer(vector.document);
      const payload = canonicalSignedPayloadBytes(vector.document);
      expect(canonicalSignedPayload(vector.document), name).toBe(vector.canonicalPayload);
      expect(encodeBase64Url(payload), name).toBe(vector.canonicalPayloadBase64Url);
      expect(toHex(sha256(payload)), name).toBe(vector.payloadSha256);
      expect(
        verify(
          decodeBase64Url(vector.document.sig),
          payload,
          decodeBase64Url(normalKeys[vector.document.keyId]),
          { zip215: false },
        ),
        name,
      ).toBe(true);
    }
    expect(pointers.additive.document.futureHint).toBe('optional-and-signed');
    expect(canonicalSignedPayload(pointers.additive.document)).toContain('futureHint');
    expect(() => assertConfigPointer(pointers.unsupportedContract.document)).toThrow(
      'contractVersion',
    );
  });

  it('verifies independent emergency signatures and rejects tampering', () => {
    for (const name of ['active', 'clear', 'equivocation']) {
      const vector = emergencies[name];
      assertEmergencyDocument(vector.document);
      const payload = canonicalSignedPayloadBytes(vector.document);
      expect(
        verify(
          decodeBase64Url(vector.document.sig),
          payload,
          decodeBase64Url(emergencyKeys[vector.document.keyId]),
          { zip215: false },
        ),
      ).toBe(true);
    }
    expect(
      verify(
        decodeBase64Url(emergencies.tampered.document.sig as string),
        canonicalSignedPayloadBytes(emergencies.tampered.document),
        decodeBase64Url(emergencyKeys['emergency-rfc8032-1']),
        { zip215: false },
      ),
    ).toBe(false);
  });

  it('freezes normal and emergency anti-replay decisions', () => {
    for (const entry of fixture.cases.pointerAntiReplay) {
      const candidate = pointers[entry.candidate];
      const accepted = entry.accepted === null ? null : pointers[entry.accepted];
      expect(
        decideAntiReplay(
          replayState(candidate, 'activationVersion'),
          accepted ? replayState(accepted, 'activationVersion') : null,
        ),
        entry.name,
      ).toBe(entry.expectedDecision);
    }
    for (const entry of fixture.cases.emergencyAntiReplay) {
      const candidate = emergencies[entry.candidate];
      const accepted = entry.accepted === null ? null : emergencies[entry.accepted];
      expect(
        decideAntiReplay(
          replayState(candidate, 'emergencyVersion'),
          accepted ? replayState(accepted, 'emergencyVersion') : null,
        ),
        entry.name,
      ).toBe(entry.expectedDecision);
    }
    expect(compareMonotonicVersions('9007199254740993', '9007199254740992')).toBeGreaterThan(0);
    for (const value of fixture.cases.monotonicVersionErrors) {
      expect(() => assertMonotonicVersion(value), value).toThrow('uint64');
    }
  });

  it('applies RFC 7386 independently per atomic dotted key', () => {
    const vector = fixture.cases.mergePatch;
    expect(applyConfigPatch(vector.base, vector.patch)).toEqual(vector.expected);
    expect(vector.expected['ui.theme.primary']).toBe('independent');
    expect(vector.expected['ui.theme']).toEqual({
      logoVariant: 'light',
      nested: { add: true, keep: true },
      primary: '#1D9E75',
    });
  });

  it('uses restricted direct SemVer precedence and closed conditions', () => {
    expect(matchesVersionRange('2.4.0-beta.1', '>=2.3.0')).toBe(true);
    expect(matchesVersionRange('2.4.0-beta.1', '>=2.4.0')).toBe(false);
    expect(matchesVersionRange('2.4.0+build.7', '=2.4.0+other')).toBe(true);
    expect(matchesVersionRange('2.4.0', '^2.3.0')).toBe(false);
    expect(
      conditionMatches({ locale: 'k' }, { appVersion: '2.4.0', locale: 'K', os: 'windows' }),
    ).toBe(false);
    for (const entry of fixture.cases.conditions) {
      expect(
        conditionMatches(
          entry.condition as OverrideCondition,
          entry.context as {
            appVersion: string;
            locale: string;
            os: 'android' | 'ios' | 'linux' | 'macos' | 'windows';
          },
        ),
        entry.name,
      ).toBe(entry.expectedMatch);
    }
  });

  it('pins MurmurHash3 x86_32 UTF-8 and rollout boundaries', () => {
    expect(murmur3X86_32('', 0)).toBe(0);
    expect(murmur3X86_32('foo', 0)).toBe(4_138_058_784);
    for (const entry of fixture.cases.rollouts) {
      expect(rolloutBucket(entry.salt, entry.deviceId), entry.salt).toBe(entry.expectedBucket);
      expect(rolloutMatches(entry.salt, entry.deviceId, entry.expectedBucket)).toBe(
        entry.expectedHitAtBoundary,
      );
      expect(rolloutMatches(entry.salt, entry.deviceId, entry.expectedBucket + 1)).toBe(
        entry.expectedHitAboveBoundary,
      );
      expect(rolloutMatches(entry.salt, entry.deviceId, 0)).toBe(entry.expectedHitAtZero);
      expect(rolloutMatches(entry.salt, entry.deviceId, 10000)).toBe(entry.expectedHitAtFull);
    }
  });

  it('rejects cross-target documents independently of valid signatures', () => {
    const pointer: unknown = pointers.normal.document;
    const emergency: unknown = emergencies.active.document;
    assertConfigPointer(pointer);
    assertEmergencyDocument(emergency);
    expect(
      targetMatches(pointer, { brandId: 'acme', channel: 'canary', platform: 'desktop' }),
    ).toBe(true);
    expect(
      targetMatches(pointer, { brandId: 'acme', channel: 'stable', platform: 'desktop' }),
    ).toBe(false);
    expect(emergencyTargetMatches(emergency, { brandId: 'other', platform: 'desktop' })).toBe(
      false,
    );
  });

  it('classifies malformed keys, byte lengths, and unavailable Ed25519 distinctly', async () => {
    const document = pointers.normal.document;
    const keyId = document.keyId as string;
    const target = { brandId: 'acme', channel: 'canary', platform: 'desktop' } as const;
    const rawBytes = encoder.encode(JSON.stringify(document));
    await expect(
      verifyPointerBytes(rawBytes, { crypto, keyring: { [keyId]: 'not+padded=' }, target }),
    ).rejects.toMatchObject({ code: 'malformed-key' });
    await expect(
      verifyPointerBytes(rawBytes, {
        crypto,
        keyring: { [keyId]: encodeBase64Url(new Uint8Array(31)) },
        target,
      }),
    ).rejects.toMatchObject({ code: 'invalid-key-length' });
    await expect(
      verifyPointerBytes(
        encoder.encode(JSON.stringify({ ...document, sig: encodeBase64Url(new Uint8Array(63)) })),
        { crypto, keyring: normalKeys, target },
      ),
    ).rejects.toMatchObject({ code: 'invalid-signature-length' });
    await expect(
      verifyPointerBytes(rawBytes, {
        crypto: { ...crypto, verifyEd25519: () => Promise.reject(new Error('unavailable')) },
        keyring: normalKeys,
        target,
      }),
    ).rejects.toMatchObject({ code: 'crypto-unavailable' });
  });
});

describe('I-JSON trust boundary', () => {
  it.each([
    ['duplicate names', encoder.encode(String.raw`{"a":1,"\u0061":2}`)],
    ['UTF-8 BOM', new Uint8Array([239, 187, 191, 123, 125])],
    ['invalid UTF-8', new Uint8Array([195, 40])],
    ['lone surrogate', encoder.encode(String.raw`{"value":"\ud800"}`)],
  ])('rejects %s', (_name, bytes) => {
    expect(() => parseIJson(bytes)).toThrow();
  });

  it('rejects non-integer signed-envelope extensions', () => {
    expect(() =>
      canonicalSignedPayload({ ...pointers.normal.document, futureNumber: 1.5 }),
    ).toThrow('safe integers');
  });

  it('clones __proto__ as an own JSON member without changing prototypes', () => {
    const parsed = parseIJson(encoder.encode('{"__proto__":{"polluted":true}}'));
    const cloned = cloneJson(parsed) as object;
    expect(Object.hasOwn(cloned, '__proto__')).toBe(true);
    expect(Reflect.get(cloned, '__proto__')).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });
});

function replayState(
  vector: SignedVector,
  field: 'activationVersion' | 'emergencyVersion',
): AntiReplayState {
  return {
    payloadSha256: vector.payloadSha256,
    version: vector.document[field] as string,
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
