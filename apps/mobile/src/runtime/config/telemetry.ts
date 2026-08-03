import type {
  ConfigChannel,
  ConfigEvent,
  ConfigPlatform,
  ConfigStorage,
  ConfigTelemetryRequest,
} from '@linkcode/common/config';
import {
  ConfigTelemetryReporter,
  configTelemetryEventsUrl,
  configTelemetryOutcomeForStatus,
} from '@linkcode/common/config';

/** Structural slice of better-auth's `$fetch`; per-request onResponse runs alongside plugin hooks. */
export type TelemetryAuthFetch = (
  url: string,
  options: {
    readonly body: ConfigTelemetryRequest;
    readonly method: 'POST';
    readonly onResponse: (context: { readonly response: { readonly status: number } }) => void;
  },
) => Promise<unknown>;

export interface MobileConfigTelemetryOptions {
  /** Null when Expo carries no version for this build; telemetry then stays disabled. */
  readonly appVersion: string | null;
  /** The authenticated cloud session boundary (`cloudAuthClient.$fetch`); never a raw fetch. */
  readonly authFetch: TelemetryAuthFetch;
  readonly brandId: string;
  readonly channel: ConfigChannel;
  /** True only while the hydrated durable analytics preference is currently granted. */
  readonly consent: () => boolean;
  /** False when no cloud session cookie exists; events are then retained, never sent unauthenticated. */
  readonly hasSession: () => boolean;
  readonly platform: Extract<ConfigPlatform, 'android' | 'ios'> | null;
  readonly randomUuid: () => string;
  readonly storage: ConfigStorage;
  readonly telemetryEndpoint: string | null;
}

export interface MobileConfigTelemetry {
  flush(): Promise<void>;
  record(event: ConfigEvent): void;
  /** Call on hydration and every consent change; revocation purges the durable queue. */
  syncConsent(): void;
}

/** Null when platform, endpoint, or app version is missing — reporting stays disabled. */
export function createMobileConfigTelemetry(
  options: MobileConfigTelemetryOptions,
): MobileConfigTelemetry | null {
  const { appVersion, platform, telemetryEndpoint } = options;
  if (!platform || !telemetryEndpoint || !appVersion) return null;
  const url = configTelemetryEventsUrl(telemetryEndpoint);
  const reporter = new ConfigTelemetryReporter({
    appVersion,
    consent: options.consent,
    randomUuid: options.randomUuid,
    async send(request) {
      if (!options.hasSession()) return 'unauthenticated';
      let status: number | undefined;
      await options.authFetch(url, {
        body: request,
        method: 'POST',
        onResponse(context) {
          status = context.response.status;
        },
      });
      // No observed response means a transport fault; replay the identical body later.
      return status === undefined ? 'retry' : configTelemetryOutcomeForStatus(status);
    },
    storage: options.storage,
    target: { brandId: options.brandId, channel: options.channel, platform },
  });
  return {
    flush: () => reporter.flush(),
    record: (event) => reporter.record(event),
    syncConsent: () => reporter.syncConsent(),
  };
}
