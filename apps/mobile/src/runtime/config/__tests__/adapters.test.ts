import type { ConfigDefinitions, ConfigValue } from '@linkcode/common/config';
import { ConfigCore, createNobleConfigCrypto, decodeBase64Url } from '@linkcode/common/config';
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line import-x/no-relative-packages -- Keep immutable conformance data out of production exports.
import fixture from '../../../../../../packages/foundation/common/src/config/__fixtures__/contract-v1.json';
import type { AtomicKeyValueStorage, ConfigFetch } from '../adapters';
import { createConfigNetwork, createConfigStorage, resolveMobileConfigPlatform } from '../adapters';

const DEVICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const definitions = {
  'app.displayName': definition('Default App'),
  'content.home.banner': definition({ title: 'Default' }),
  'content.items': definition([]),
  'feature.aiAssist': definition(true),
  'feature.legacy': definition(true),
  'feature.newEditor': definition(false),
  'params.upload.maxSizeMb': definition(10),
  'ui.theme': definition({ primary: '#000000' }),
  'ui.theme.primary': definition('default-atomic'),
} satisfies ConfigDefinitions;

class MemoryAtomicStorage implements AtomicKeyValueStorage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.writes.push({ key, value });
    return Promise.resolve();
  }
}

const rejectingFetch: ConfigFetch = () => Promise.reject(new Error('offline'));

describe('mobile configuration adapters', () => {
  it.each(['ios', 'android'] as const)(
    'boots offline defaults, consumes the shared golden fixture, and restores its LKG on %s',
    async (os) => {
      const storage = new MemoryAtomicStorage();
      const fetch = fixtureFetch();
      const core = createFixtureCore(os, storage, fetch);

      await expect(core.initialize()).resolves.toMatchObject({
        configVersion: null,
        source: 'defaults',
        values: { 'app.displayName': 'Default App', 'feature.newEditor': false },
      });
      expect(fetch).not.toHaveBeenCalled();

      await expect(core.refresh()).resolves.toEqual({ status: 'updated' });
      expect(core.getState()).toMatchObject({
        configVersion: '2026.08.03-041',
        source: 'remote',
        stagedColdKeys: [
          'app.displayName',
          'feature.legacy',
          'feature.newEditor',
          'params.upload.maxSizeMb',
        ],
        values: {
          'app.displayName': 'Default App',
          'content.home.banner': { title: '你好', url: 'https://linkcode.ai/docs' },
          'feature.newEditor': false,
          'params.upload.maxSizeMb': 10,
          'ui.theme.primary': 'atomic-dotted-key',
        },
      });
      for (const { key, value } of storage.writes) {
        if (!key.includes(':normal:')) continue;
        expect(() => JSON.parse(value)).not.toThrow();
      }

      const restarted = createFixtureCore(os, storage, rejectingFetch);
      await expect(restarted.initialize()).resolves.toMatchObject({
        configVersion: '2026.08.03-041',
        source: 'lkg',
        values: {
          'app.displayName': 'Acme Studio',
          'feature.newEditor': true,
          'params.upload.maxSizeMb': 200,
        },
      });
    },
  );

  it('forwards ETags and preserves exact response bytes', async () => {
    const body = new Uint8Array([0, 127, 128, 255]);
    const fetch: ConfigFetch = vi.fn(() => Promise.resolve(response(body, 200, '"next"')));
    const network = createConfigNetwork('https://config.example.test/root', fetch);

    await expect(network.get('/pointer.json', { etag: '"prior"' })).resolves.toEqual({
      body,
      etag: '"next"',
      status: 200,
    });
    expect(fetch).toHaveBeenCalledWith('https://config.example.test/root/pointer.json', {
      headers: { 'If-None-Match': '"prior"' },
    });
  });

  it('degrades unsupported runtimes instead of mapping them to a native target', () => {
    expect(resolveMobileConfigPlatform('ios')).toBe('ios');
    expect(resolveMobileConfigPlatform('android')).toBe('android');
    expect(resolveMobileConfigPlatform('web')).toBeNull();
    expect(resolveMobileConfigPlatform('windows')).toBeNull();
  });
});

function createFixtureCore(
  os: 'android' | 'ios',
  storage: AtomicKeyValueStorage,
  fetch: ConfigFetch,
) {
  const network = createConfigNetwork('https://config.example.test', fetch);
  return new ConfigCore({
    context: { appVersion: '2.5.0', locale: 'ZH_cn', os },
    crypto: createNobleConfigCrypto(() => DEVICE_ID),
    definitions,
    emergencyKeyring: fixture.keys.emergency,
    emergencyNetwork: network,
    maximumSchemaVersion: 1,
    network,
    normalKeyring: fixture.keys.normal,
    storage: createConfigStorage(storage),
    target: { brandId: 'acme', channel: 'canary', platform: 'desktop' },
  });
}

function fixtureFetch(): ReturnType<typeof vi.fn<ConfigFetch>> {
  return vi.fn<ConfigFetch>((url) => {
    if (url.endsWith('/latest.json')) {
      return Promise.resolve(response(jsonBytes(fixture.pointers.normal.document), 200, '"p100"'));
    }
    if (url.endsWith(`/${fixture.pointers.normal.document.sha256}.json`)) {
      return Promise.resolve(
        response(decodeBase64Url(fixture.snapshots.current.canonicalPayloadBase64Url)),
      );
    }
    return Promise.resolve(response(new Uint8Array(), 404));
  });
}

function response(body: Uint8Array, status = 200, etag?: string) {
  return {
    arrayBuffer: () => Promise.resolve(body.slice().buffer),
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? (etag ?? null) : null) },
    status,
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function definition(defaultValue: ConfigValue) {
  return { defaultValue, parse: (value: ConfigValue) => value };
}
