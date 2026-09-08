import { readFile } from 'node:fs/promises';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import fixture from '../__fixtures__/build-bundle-v1.json';
import fixtureAndroid from '../__fixtures__/build-bundle-v1-android.json';
import fixtureIos from '../__fixtures__/build-bundle-v1-ios.json';
import {
  assertConfigBuildBundle,
  configBuildBundleDefaults,
  configBuildBundleSnapshot,
  definitionsFromDefaults,
  parseConfigBuildBundle,
} from '../build-bundle';
import { decodeBase64Url, encodeBase64Url } from '../i-json';

// Frozen publisher fixture bytes (config-publisher fixtures/build-bundle-v1*.json). Never edit
// the vendored copies; re-vendor from the publisher and update the digests together.
const FIXTURE_SHA256 = {
  android: 'be739a65e7429de4e1c22e32f18fc83c39a75833bddb477b1f420aab65de7331',
  desktop: '32bfda658cc0e75d8898482ae66f04badf68378c9584294c02aa75e9dedd5421',
  ios: 'ffc0c61d61761e6b966f7e2181a979212a7ed0919320b9844712d2b7c4825312',
} as const;

const RE_SOURCE_GIT_SHA = /^[0-9a-f]{40}$/;

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0, len = bytes.length; i < len; i++) {
    const byte = bytes[i];
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tampering requires loose writes
function mutate(change: (bundle: Record<string, any>) => void): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tampering requires loose writes
  const clone = structuredClone(fixture) as Record<string, any>;
  change(clone);
  return clone;
}

describe('build bundle v1 vendored fixtures', () => {
  it('matches the frozen publisher bytes exactly', async () => {
    const fixtureDigests = Object.entries(FIXTURE_SHA256);
    for (let i = 0, len = fixtureDigests.length; i < len; i++) {
      const [name, digest] = fixtureDigests[i];
      const suffix = name === 'desktop' ? '' : `-${name}`;
      // eslint-disable-next-line no-await-in-loop -- three small reads
      const bytes = await readFile(
        new URL(`../__fixtures__/build-bundle-v1${suffix}.json`, import.meta.url),
      );
      expect(toHex(sha256(bytes)), name).toBe(digest);
    }
  });

  it('validates every platform fixture and extracts its defaults', () => {
    const fixtureCases = [
      [fixture, 'desktop'],
      [fixtureIos, 'ios'],
      [fixtureAndroid, 'android'],
    ] as const;
    for (let i = 0, len = fixtureCases.length; i < len; i++) {
      const [raw, platform] = fixtureCases[i];
      const bundle = parseConfigBuildBundle(structuredClone(raw));
      expect(bundle.platform).toBe(platform);
      expect(bundle.brandId).toBe('acme');
      expect(bundle.channel).toBe('stable');
      expect(bundle.endpoints.telemetry).toBe('https://telemetry.example.invalid/acme');
      expect(bundle.provenance.sourceGitSha).toMatch(RE_SOURCE_GIT_SHA);
      const snapshot = configBuildBundleSnapshot(bundle);
      expect(configBuildBundleDefaults(bundle)).toEqual(snapshot.values);
      expect(snapshot.values['app.displayName']).toBe('Acme Studio');
      expect(snapshot.values['modules.terminal.enabled']).toBe(platform === 'desktop');
    }
  });

  it('contains no private key material', () => {
    const text =
      JSON.stringify(fixture) + JSON.stringify(fixtureIos) + JSON.stringify(fixtureAndroid);
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain('privateKey');
    // RFC 8032 test seeds the publisher derives its fixture public keys from.
    expect(text).not.toContain('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    expect(text).not.toContain('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb');
  });
});

describe('assertConfigBuildBundle fails closed', () => {
  it('rejects unknown and missing fields at every level', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.extra = 1;
        }),
      ),
    ).toThrow('extra');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          delete b.provenance;
        }),
      ),
    ).toThrow('provenance');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.endpoints.private = 'x';
        }),
      ),
    ).toThrow('private');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          delete b.endpoints.telemetry;
        }),
      ),
    ).toThrow('telemetry');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.keyrings.privateKeys = {};
        }),
      ),
    ).toThrow('privateKeys');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.provenance.branch = 'main';
        }),
      ),
    ).toThrow('branch');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.snapshot.url = 'x';
        }),
      ),
    ).toThrow('url');
  });

  it('rejects an unsupported bundle version', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.buildBundleVersion = 2;
        }),
      ),
    ).toThrow('buildBundleVersion');
  });

  it('rejects a null or decorated telemetry endpoint', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.endpoints.telemetry = null;
        }),
      ),
    ).toThrow('telemetry');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.endpoints.telemetry = 'https://t.example.invalid/?x=1';
        }),
      ),
    ).toThrow('must not carry credentials, query, or fragment');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.endpoints.telemetry = 'http://t.example.invalid';
        }),
      ),
    ).toThrow('must use HTTPS');
  });

  it('rejects unpaired endpoints and keyrings and malformed keys', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.endpoints.normal = null;
        }),
      ),
    ).toThrow('normal endpoint and keyring must be enabled together');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.keyrings.emergency = {};
        }),
      ),
    ).toThrow('emergency endpoint and keyring must be enabled together');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.keyrings.normal = { 'key-1': 'AAAA' };
        }),
      ),
    ).toThrow('raw 32-byte Ed25519 public key');
  });

  it('rejects snapshot byte, hash, and size drift', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.snapshot.sizeBytes += 1;
        }),
      ),
    ).toThrow('sizeBytes does not match');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.snapshot.sha256 = '0'.repeat(64);
        }),
      ),
    ).toThrow('sha256 does not match');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          const bytes = decodeBase64Url(b.snapshot.base64Url as string);
          bytes[10] ^= 1;
          b.snapshot.base64Url = encodeBase64Url(bytes);
        }),
      ),
    ).toThrow('sha256 does not match');
  });

  it('rejects noncanonical snapshot bytes even when the digest matches', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          const snapshot = configBuildBundleSnapshot(
            parseConfigBuildBundle(structuredClone(fixture)),
          );
          const noncanonical = new TextEncoder().encode(JSON.stringify(snapshot, null, 1));
          b.snapshot.base64Url = encodeBase64Url(noncanonical);
          b.snapshot.sizeBytes = noncanonical.byteLength;
          b.snapshot.sha256 = toHex(sha256(noncanonical));
        }),
      ),
    ).toThrow('RFC 8785 canonical bytes');
  });

  it('rejects target and provenance drift against the snapshot', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.platform = 'ios';
        }),
      ),
    ).toThrow('snapshot target does not match');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.channel = 'canary';
        }),
      ),
    ).toThrow('snapshot target does not match');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.provenance.configVersion = '9';
        }),
      ),
    ).toThrow('configVersion does not match');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.provenance.sourceGitSha = 'HEAD';
        }),
      ),
    ).toThrow('lowercase 40-hex commit');
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.provenance.sourceGitSha = (b.provenance.sourceGitSha as string).toUpperCase();
        }),
      ),
    ).toThrow('lowercase 40-hex commit');
  });

  it('rejects a maximumSchemaVersion below the snapshot schema version', () => {
    expect(() =>
      assertConfigBuildBundle(
        mutate((b) => {
          b.maximumSchemaVersion = 0;
        }),
      ),
    ).toThrow('must cover the snapshot schema version');
  });
});

describe('definitionsFromDefaults', () => {
  it('derives type-checked definitions from bundled defaults', () => {
    const bundle = parseConfigBuildBundle(structuredClone(fixture));
    const defaults = configBuildBundleDefaults(bundle);
    const definitions = definitionsFromDefaults(defaults);
    expect(Object.keys(definitions).sort()).toEqual(Object.keys(defaults).sort());
    const definition = definitions['app.displayName'];
    expect(definition.defaultValue).toBe('Acme Studio');
    expect(definition.parse('Other')).toBe('Other');
    expect(() => definition.parse(42)).toThrow('Expected string');
    expect(() => definitions['modules.terminal.enabled'].parse('yes')).toThrow('Expected boolean');
  });
});
