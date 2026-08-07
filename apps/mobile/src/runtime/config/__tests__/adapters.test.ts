import type { ConfigDefinitions, ConfigValue } from '@linkcode/common/config';
import { ConfigCore, createNobleConfigCrypto, decodeBase64Url } from '@linkcode/common/config';
import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line import-x/no-relative-packages -- Keep immutable conformance data out of production exports.
import fixture from '../../../../../../packages/foundation/common/src/config/__fixtures__/contract-v1.json';
// eslint-disable-next-line import-x/no-relative-packages -- Keep immutable conformance data out of production exports.
import handoffFixture from '../../../../../../packages/foundation/common/src/config/__fixtures__/emergency-handoff-v1.json';
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

  it.each(['ios', 'android'] as const)(
    'keeps emergency state available through main-channel outage, restart, and release on %s',
    async (os) => {
      const storage = new MemoryAtomicStorage();
      const firstEmergencyFetch = emergencyFixtureFetch('killSwitch', 'forcedMinimum');
      const first = createEmergencyFixtureCore(os, storage, firstEmergencyFetch);

      await first.initialize();
      await expect(first.refresh()).resolves.toMatchObject({ status: 'error' });
      await expect(first.refreshEmergency()).resolves.toEqual({ status: 'updated' });
      await expect(first.refreshEmergency()).resolves.toEqual({ status: 'updated' });
      expect(first.get('feature.aiAssist')).toBe(false);
      expect(first.getState().emergency).toMatchObject({
        emergencyVersion: '2',
        forceMinVersion: '2.4.0',
      });
      expect(firstEmergencyFetch.mock.calls[0]?.[0]).toBe(
        'https://emergency.example.test/v1/acme/desktop/emergency.json',
      );

      const releaseFetch = emergencyFixtureFetch('release');
      const restarted = createEmergencyFixtureCore(os, storage, releaseFetch);
      await expect(restarted.initialize()).resolves.toMatchObject({
        emergency: { emergencyVersion: '2', forceMinVersion: '2.4.0' },
      });
      expect(restarted.get('feature.aiAssist')).toBe(false);
      await expect(restarted.refresh()).resolves.toMatchObject({ status: 'error' });
      await expect(restarted.refreshEmergency()).resolves.toEqual({ status: 'updated' });
      expect(restarted.get('feature.aiAssist')).toBe(true);
      expect(restarted.getState().emergency).toMatchObject({
        disabledFeatures: [],
        emergencyVersion: '3',
        forceMinVersion: null,
      });

      const offline = createEmergencyFixtureCore(os, storage, rejectingFetch);
      await expect(offline.initialize()).resolves.toMatchObject({
        emergency: { disabledFeatures: [], emergencyVersion: '3', forceMinVersion: null },
      });
      expect(offline.get('feature.aiAssist')).toBe(true);
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
      signal: expect.any(AbortSignal),
    });
  });

  it('aborts a fetch after ten seconds and clears the timeout after settlement', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const fetch = vi.fn<ConfigFetch>(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const request = createConfigNetwork('https://config.example.test', fetch).get(
      '/latest.json',
      {},
    );
    const rejection = expect(request).rejects.toThrow('aborted');

    await vi.advanceTimersByTimeAsync(9999);
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('clears the fetch timeout after a successful response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const fetch = vi.fn<ConfigFetch>(() => Promise.resolve(response(new Uint8Array())));
    await createConfigNetwork('https://config.example.test', fetch).get('/latest.json', {});
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
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

function createEmergencyFixtureCore(
  os: 'android' | 'ios',
  storage: AtomicKeyValueStorage,
  emergencyFetch: ConfigFetch,
) {
  return new ConfigCore({
    context: { appVersion: '2.5.0', locale: 'ZH_cn', os },
    crypto: createNobleConfigCrypto(() => DEVICE_ID),
    definitions,
    emergencyKeyring: handoffFixture.keys.emergency,
    emergencyNetwork: createConfigNetwork('https://emergency.example.test', emergencyFetch),
    maximumSchemaVersion: 1,
    network: createConfigNetwork('https://normal.example.test', rejectingFetch),
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

function emergencyFixtureFetch(
  ...names: Array<keyof typeof handoffFixture.documents>
): ReturnType<typeof vi.fn<ConfigFetch>> {
  let index = 0;
  return vi.fn<ConfigFetch>(() => {
    const name = names.at(index++);
    if (!name) return Promise.reject(new Error('offline'));
    return Promise.resolve(
      response(
        jsonBytes(handoffFixture.documents[name].document),
        200,
        `"emergency-${handoffFixture.documents[name].document.emergencyVersion}"`,
      ),
    );
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
