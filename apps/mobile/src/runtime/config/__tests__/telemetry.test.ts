import type { ConfigActivationEvent, ConfigStorage } from '@linkcode/common/config';
import { describe, expect, it, vi } from 'vitest';
import type { MobileConfigTelemetryOptions, TelemetryAuthFetch } from '../telemetry';
import { createMobileConfigTelemetry } from '../telemetry';

const ISO_EVENT_TIME_RE = /^\d{4}-\d{2}-\d{2}T/;

const ACTIVATION: ConfigActivationEvent = {
  type: 'activation',
  publication: {
    activationVersion: '100',
    configVersion: '2026.08.03-041',
    sha256: 'f3482464e099c416e92feb19f9492458d0c1c9de8f74c89ca5d2d4a4d47600b9',
  },
};

class MemoryStorage implements ConfigStorage {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

function respondWith(status: number) {
  return (_url: string, init: Parameters<TelemetryAuthFetch>[1]): Promise<unknown> => {
    init.onResponse({ response: { status } });
    return Promise.resolve({});
  };
}

function makeTelemetry(overrides: Partial<MobileConfigTelemetryOptions> = {}) {
  const storage = new MemoryStorage();
  const authFetch = vi.fn<TelemetryAuthFetch>(respondWith(202));
  const options: MobileConfigTelemetryOptions = {
    appVersion: '1.7.0',
    authFetch,
    brandId: 'linkcode',
    channel: 'stable',
    consent: () => true,
    hasSession: () => true,
    platform: 'ios',
    randomUuid: () => '00000000-0000-4000-8000-000000000002',
    storage,
    telemetryEndpoint: 'https://t.example',
    ...overrides,
  };
  return { authFetch, options, storage };
}

describe('mobile config telemetry', () => {
  it('stays disabled when platform, endpoint, or app version is missing', () => {
    expect(createMobileConfigTelemetry(makeTelemetry({ platform: null }).options)).toBeNull();
    expect(
      createMobileConfigTelemetry(makeTelemetry({ telemetryEndpoint: null }).options),
    ).toBeNull();
    expect(createMobileConfigTelemetry(makeTelemetry({ appVersion: null }).options)).toBeNull();
  });

  it('posts the exact mobile identity through the authenticated boundary', async () => {
    const { authFetch, options } = makeTelemetry();
    const telemetry = createMobileConfigTelemetry(options);
    telemetry?.record(ACTIVATION);
    await telemetry?.flush();

    expect(authFetch).toHaveBeenCalledTimes(1);
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('https://t.example/events');
    expect(init.method).toBe('POST');
    expect(init.body).toEqual({
      schemaVersion: 1,
      clientEventId: '00000000-0000-4000-8000-000000000002',
      eventType: 'activation_success',
      consent: 'granted',
      eventTime: expect.stringMatching(ISO_EVENT_TIME_RE) as unknown,
      target: { brand: 'linkcode', platform: 'ios' },
      publication: ACTIVATION.publication,
      rollout: { channel: 'stable' },
      appVersion: '1.7.0',
    });
  });

  it('drops events without hydrated consent and retains them without a cloud session', async () => {
    const noConsent = makeTelemetry({ consent: () => false });
    const silent = createMobileConfigTelemetry(noConsent.options);
    silent?.record(ACTIVATION);
    await silent?.flush();
    expect(noConsent.authFetch).not.toHaveBeenCalled();
    expect(noConsent.storage.values.size).toBe(0);

    const signedOut = makeTelemetry({ hasSession: () => false });
    const retained = createMobileConfigTelemetry(signedOut.options);
    retained?.record(ACTIVATION);
    await retained?.flush();
    expect(signedOut.authFetch).not.toHaveBeenCalled();
    const [stored = ''] = [...signedOut.storage.values.values()];
    expect((JSON.parse(stored) as { events: unknown[] }).events).toHaveLength(1);
  });

  it('retains the identical body after a 401 and drops it after a 409', async () => {
    vi.useFakeTimers();
    try {
      const { authFetch, options, storage } = makeTelemetry();
      authFetch.mockImplementationOnce(respondWith(401));
      const telemetry = createMobileConfigTelemetry(options);
      telemetry?.record(ACTIVATION);
      await telemetry?.flush();
      const [afterUnauthenticated = ''] = [...storage.values.values()];
      expect((JSON.parse(afterUnauthenticated) as { events: unknown[] }).events).toHaveLength(1);

      authFetch.mockImplementationOnce(respondWith(409));
      vi.advanceTimersByTime(31000);
      await telemetry?.flush();
      expect(authFetch).toHaveBeenCalledTimes(2);
      expect(authFetch.mock.calls[1][1].body).toEqual(authFetch.mock.calls[0][1].body);
      const [afterConflict = ''] = [...storage.values.values()];
      expect((JSON.parse(afterConflict) as { events: unknown[] }).events).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dequeues only on the contract 202, not on an unexpected 200', async () => {
    vi.useFakeTimers();
    try {
      const { authFetch, options, storage } = makeTelemetry();
      authFetch.mockImplementationOnce(respondWith(200));
      const telemetry = createMobileConfigTelemetry(options);
      telemetry?.record(ACTIVATION);
      await telemetry?.flush();
      const [after200 = ''] = [...storage.values.values()];
      expect((JSON.parse(after200) as { events: unknown[] }).events).toHaveLength(1);

      vi.advanceTimersByTime(31000);
      await telemetry?.flush();
      const [after202 = ''] = [...storage.values.values()];
      expect((JSON.parse(after202) as { events: unknown[] }).events).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
