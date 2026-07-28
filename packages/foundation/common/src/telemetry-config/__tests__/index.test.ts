import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TELEMETRY_CONFIG,
  fetchTelemetryConfig,
  parseTelemetryConfig,
  TELEMETRY_CONFIG_URL,
} from '..';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseTelemetryConfig', () => {
  it('accepts the production contract', () => {
    expect(parseTelemetryConfig(DEFAULT_TELEMETRY_CONFIG)).toEqual(DEFAULT_TELEMETRY_CONFIG);
  });

  it.each([
    -0.01,
    1.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects an invalid sample rate: %s', (desktopMain) => {
    expect(
      parseTelemetryConfig({
        ...DEFAULT_TELEMETRY_CONFIG,
        sentry: {
          ...DEFAULT_TELEMETRY_CONFIG.sentry,
          tracesSampleRate: {
            ...DEFAULT_TELEMETRY_CONFIG.sentry.tracesSampleRate,
            desktopMain,
          },
        },
      }),
    ).toBeNull();
  });

  it('rejects unknown schema versions', () => {
    expect(parseTelemetryConfig({ ...DEFAULT_TELEMETRY_CONFIG, schemaVersion: 2 })).toBeNull();
  });
});

describe('fetchTelemetryConfig', () => {
  it('does not send ambient credentials to the public endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(DEFAULT_TELEMETRY_CONFIG, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTelemetryConfig()).resolves.toEqual(DEFAULT_TELEMETRY_CONFIG);
    expect(fetchMock).toHaveBeenCalledWith(
      TELEMETRY_CONFIG_URL,
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
  });
});
