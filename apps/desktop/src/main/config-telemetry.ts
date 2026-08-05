import { randomUUID } from 'node:crypto';
import type { ConfigEvent, ConfigStorage } from '@linkcode/common/config';
import {
  ConfigTelemetryReporter,
  configTelemetryEventsUrl,
  configTelemetryOutcomeForStatus,
} from '@linkcode/common/config';
import type { DesktopConfigBootstrap } from './config';

export interface DesktopConfigTelemetry {
  flush(): Promise<void>;
  record(event: ConfigEvent): void;
  setConsent(enabled: boolean): void;
}

export interface DesktopConfigTelemetryOptions {
  readonly appVersion: string;
  readonly bootstrap: Pick<DesktopConfigBootstrap, 'brandId' | 'channel' | 'telemetryEndpoint'>;
  readonly fetchImpl?: typeof fetch;
  readonly getCookie: () => string;
  readonly randomUuid?: () => string;
  readonly storage: ConfigStorage;
}

/** Null when the build bundle carries no telemetry endpoint — reporting stays disabled. */
export function createDesktopConfigTelemetry(
  options: DesktopConfigTelemetryOptions,
): DesktopConfigTelemetry | null {
  const endpoint = options.bootstrap.telemetryEndpoint;
  if (!endpoint) return null;
  const url = configTelemetryEventsUrl(endpoint);
  const fetchImpl = options.fetchImpl ?? fetch;
  // Consent starts revoked; the renderer notifies the hydrated preference and every transition.
  let consentGranted = false;
  const reporter = new ConfigTelemetryReporter({
    appVersion: options.appVersion,
    consent: () => consentGranted,
    randomUuid: options.randomUuid ?? randomUUID,
    async send(request) {
      const cookie = options.getCookie();
      if (!cookie) return 'unauthenticated';
      const response = await fetchImpl(url, {
        body: JSON.stringify(request),
        headers: { 'content-type': 'application/json', cookie },
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      await response.body?.cancel();
      return configTelemetryOutcomeForStatus(response.status);
    },
    storage: options.storage,
    target: {
      brandId: options.bootstrap.brandId,
      channel: options.bootstrap.channel,
      platform: 'desktop',
    },
  });
  return {
    flush: () => reporter.flush(),
    record: (event) => reporter.record(event),
    setConsent(enabled) {
      consentGranted = enabled;
      // Runs even for a repeated value: the renderer's initial `false` must purge any queue a
      // previous run left behind. Grants drain; revocations discard.
      reporter.syncConsent();
    },
  };
}

let telemetry: DesktopConfigTelemetry | null = null;

export function initializeDesktopConfigTelemetry(options: DesktopConfigTelemetryOptions): void {
  telemetry = createDesktopConfigTelemetry(options);
}

export function recordDesktopConfigEvent(event: ConfigEvent): void {
  telemetry?.record(event);
}

export function setDesktopAnalyticsConsent(enabled: boolean): void {
  telemetry?.setConsent(enabled);
}
