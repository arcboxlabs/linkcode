import { z } from 'zod';

const SAMPLE_RATE_SCHEMA = z.number().finite().min(0).max(1);
const TELEMETRY_CONFIG_SCHEMA = z.object({
  schemaVersion: z.literal(1),
  sentry: z.object({
    tracesSampleRate: z.object({
      desktopMain: SAMPLE_RATE_SCHEMA,
      desktopRenderer: SAMPLE_RATE_SCHEMA,
      webview: SAMPLE_RATE_SCHEMA,
      mobile: SAMPLE_RATE_SCHEMA,
      daemon: SAMPLE_RATE_SCHEMA,
    }),
    profileSessionSampleRate: z.object({
      daemon: SAMPLE_RATE_SCHEMA,
    }),
  }),
});

export type TelemetryConfig = z.infer<typeof TELEMETRY_CONFIG_SCHEMA>;

interface TelemetryConfigResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type TelemetryConfigFetcher = (
  url: string,
  init: {
    credentials: 'omit';
    headers: Record<string, string>;
    redirect: 'error';
    signal: AbortSignal;
  },
) => Promise<TelemetryConfigResponse>;

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  schemaVersion: 1,
  sentry: {
    tracesSampleRate: {
      desktopMain: 0.1,
      desktopRenderer: 0.1,
      webview: 0.1,
      mobile: 0.1,
      daemon: 0.05,
    },
    profileSessionSampleRate: { daemon: 0.01 },
  },
};

export const TELEMETRY_CONFIG_URL = 'https://api.linkcode.ai/system/telemetry-config';

export function parseTelemetryConfig(value: unknown): TelemetryConfig | null {
  const parsed = TELEMETRY_CONFIG_SCHEMA.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Fetches public sampling configuration without delaying telemetry initialization on failure. */
export async function fetchTelemetryConfig(
  fetcher: TelemetryConfigFetcher = globalThis.fetch,
): Promise<TelemetryConfig | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetcher(TELEMETRY_CONFIG_URL, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseTelemetryConfig(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
