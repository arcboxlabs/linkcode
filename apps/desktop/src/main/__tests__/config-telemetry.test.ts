import type { ConfigActivationEvent, ConfigStorage } from '@linkcode/common/config';
import { telemetryStorageKey } from '@linkcode/common/config';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopConfigTelemetryOptions } from '../config-telemetry';
import { createDesktopConfigTelemetry } from '../config-telemetry';

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

function makeTelemetry(overrides: Partial<DesktopConfigTelemetryOptions> = {}) {
  const storage = new MemoryStorage();
  const fetchImpl = vi.fn(() =>
    Promise.resolve(new Response(null, { status: 202 })),
  ) as unknown as typeof fetch;
  const options: DesktopConfigTelemetryOptions = {
    appVersion: '2.4.0',
    bootstrap: { brandId: 'linkcode', channel: 'stable', telemetryEndpoint: 'https://t.example' },
    fetchImpl,
    getCookie: () => 'session=abc',
    randomUuid: () => '00000000-0000-4000-8000-000000000001',
    storage,
    ...overrides,
  };
  return { fetchImpl: fetchImpl as ReturnType<typeof vi.fn>, options, storage };
}

describe('desktop config telemetry', () => {
  it('stays disabled without a bundled telemetry endpoint', () => {
    const { options } = makeTelemetry({
      bootstrap: { brandId: 'linkcode', channel: 'stable', telemetryEndpoint: null },
    });
    expect(createDesktopConfigTelemetry(options)).toBeNull();
  });

  it('drops events until the renderer grants consent, then posts the exact desktop identity', async () => {
    const { fetchImpl, options, storage } = makeTelemetry();
    const telemetry = createDesktopConfigTelemetry(options);
    expect(telemetry).not.toBeNull();

    telemetry?.record(ACTIVATION);
    await telemetry?.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);

    telemetry?.setConsent(true);
    telemetry?.record(ACTIVATION);
    await telemetry?.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://t.example/events');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', cookie: 'session=abc' });
    expect(JSON.parse(init.body as string)).toEqual({
      schemaVersion: 1,
      clientEventId: '00000000-0000-4000-8000-000000000001',
      eventType: 'activation_success',
      consent: 'granted',
      eventTime: expect.stringMatching(ISO_EVENT_TIME_RE) as unknown,
      target: { brand: 'linkcode', platform: 'desktop' },
      publication: ACTIVATION.publication,
      rollout: { channel: 'stable' },
      appVersion: '2.4.0',
    });
  });

  it('retains events without a cloud session instead of sending unauthenticated', async () => {
    const { fetchImpl, options, storage } = makeTelemetry({ getCookie: () => '' });
    const telemetry = createDesktopConfigTelemetry(options);
    telemetry?.setConsent(true);
    telemetry?.record(ACTIVATION);
    await telemetry?.flush();

    expect(fetchImpl).not.toHaveBeenCalled();
    const stored = storage.values.get(
      telemetryStorageKey({ brandId: 'linkcode', channel: 'stable', platform: 'desktop' }),
    );
    expect(stored).toBeDefined();
    expect((JSON.parse(stored ?? '') as { events: unknown[] }).events).toHaveLength(1);
  });

  it('discards the durable queue when consent is revoked', async () => {
    const { fetchImpl, options, storage } = makeTelemetry({ getCookie: () => '' });
    const telemetry = createDesktopConfigTelemetry(options);
    telemetry?.setConsent(true);
    telemetry?.record(ACTIVATION);
    await telemetry?.flush();

    telemetry?.setConsent(false);
    await telemetry?.flush();
    const key = telemetryStorageKey({
      brandId: 'linkcode',
      channel: 'stable',
      platform: 'desktop',
    });
    expect(
      (JSON.parse(storage.values.get(key) ?? '') as { events: unknown[] }).events,
    ).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
