import type { ConfigNetwork, EmergencyHostState } from '@linkcode/common/config';
import {
  ConfigCore,
  ConfigCoreError,
  createNobleConfigCrypto,
  emergencyHostState,
} from '@linkcode/common/config';
import { defaultLocale, resolveLocale } from '@linkcode/i18n';
import { fetch as expoFetch } from 'expo/fetch';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { Platform } from 'react-native';
import { useAnalyticsPreferenceStore } from '../../stores/analytics-store';
import { cloudAuthClient } from '../cloud/client';
import { createConfigNetwork, createConfigStorage, resolveMobileConfigPlatform } from './adapters';
import { BUNDLED_CONFIG_BOOTSTRAP, BUNDLED_CONFIG_DEFINITIONS } from './bundled';
import { createMobileConfigTelemetry } from './telemetry';

const platform = resolveMobileConfigPlatform(Platform.OS);
if (
  platform &&
  BUNDLED_CONFIG_BOOTSTRAP.platform &&
  BUNDLED_CONFIG_BOOTSTRAP.platform !== platform
) {
  throw new Error(
    `Bundled configuration targets ${BUNDLED_CONFIG_BOOTSTRAP.platform} but is running on ${platform}`,
  );
}
const normalEnabled = BUNDLED_CONFIG_BOOTSTRAP.remoteBaseUrl !== null;
const emergencyEnabled =
  BUNDLED_CONFIG_BOOTSTRAP.emergencyRemoteBaseUrl !== null &&
  !isObjectEmpty(BUNDLED_CONFIG_BOOTSTRAP.emergencyKeyring);
const remoteEnabled = normalEnabled || emergencyEnabled;
const appVersion = Constants.expoConfig?.version ?? '0.0.0';
let emergencyRefresh: Promise<boolean> | null = null;
const unavailableNetwork: ConfigNetwork = {
  get: () =>
    Promise.reject(new ConfigCoreError('fetch', 'Bundled configuration has no remote endpoint')),
};

const telemetry = createMobileConfigTelemetry({
  appVersion: Constants.expoConfig?.version ?? null,
  brandId: BUNDLED_CONFIG_BOOTSTRAP.brandId,
  channel: BUNDLED_CONFIG_BOOTSTRAP.channel,
  consent: () =>
    useAnalyticsPreferenceStore.persist.hasHydrated() &&
    useAnalyticsPreferenceStore.getState().enabled,
  authFetch: (url, init) => cloudAuthClient.$fetch(url, init),
  hasSession: () => cloudAuthClient.getCookie() !== '',
  platform,
  randomUuid: randomUUID,
  storage: createConfigStorage(Storage),
  telemetryEndpoint: BUNDLED_CONFIG_BOOTSTRAP.telemetryEndpoint,
});

if (telemetry) {
  // Reconcile on hydration (even to a persisted `false`, purging a stale queue from a previous
  // run) and on every later transition; grants drain, revocations discard.
  if (useAnalyticsPreferenceStore.persist.hasHydrated()) telemetry.syncConsent();
  else useAnalyticsPreferenceStore.persist.onFinishHydration(() => telemetry.syncConsent());
  let previousConsent = useAnalyticsPreferenceStore.getState().enabled;
  useAnalyticsPreferenceStore.subscribe((state) => {
    if (state.enabled === previousConsent) return;
    previousConsent = state.enabled;
    if (useAnalyticsPreferenceStore.persist.hasHydrated()) telemetry.syncConsent();
  });
}

export const mobileConfiguration = platform
  ? new ConfigCore({
      context: {
        appVersion,
        locale: getRuntimeLocale(),
        os: platform,
      },
      crypto: createNobleConfigCrypto(randomUUID),
      definitions: BUNDLED_CONFIG_DEFINITIONS,
      emergencyKeyring: BUNDLED_CONFIG_BOOTSTRAP.emergencyKeyring,
      emergencyNetwork: configuredNetwork(BUNDLED_CONFIG_BOOTSTRAP.emergencyRemoteBaseUrl),
      maximumSchemaVersion: BUNDLED_CONFIG_BOOTSTRAP.maximumSchemaVersion,
      network: configuredNetwork(BUNDLED_CONFIG_BOOTSTRAP.remoteBaseUrl),
      normalKeyring: BUNDLED_CONFIG_BOOTSTRAP.normalKeyring,
      ...(telemetry && { report: (event) => telemetry.record(event) }),
      storage: createConfigStorage(Storage),
      target: {
        brandId: BUNDLED_CONFIG_BOOTSTRAP.brandId,
        channel: BUNDLED_CONFIG_BOOTSTRAP.channel,
        platform,
      },
    })
  : null;

export function isMobileConfigRemoteEnabled(): boolean {
  return platform !== null && remoteEnabled;
}

export async function initializeMobileConfiguration(): Promise<void> {
  await mobileConfiguration?.initialize();
}

export async function refreshMobileConfiguration(): Promise<boolean> {
  if (!mobileConfiguration || !remoteEnabled) return false;
  const [normal, emergency] = await Promise.all([
    normalEnabled ? mobileConfiguration.refresh() : undefined,
    emergencyEnabled ? refreshMobileEmergencyConfiguration() : undefined,
  ]);
  if (useAnalyticsPreferenceStore.persist.hasHydrated()) void telemetry?.flush();
  return normal?.status !== 'error' && emergency !== false;
}

export function refreshMobileEmergencyConfiguration(): Promise<boolean> {
  if (!mobileConfiguration || !emergencyEnabled) return Promise.resolve(false);
  if (emergencyRefresh) return emergencyRefresh;
  emergencyRefresh = mobileConfiguration
    .refreshEmergency()
    .then((result) => result.status !== 'error')
    .finally(() => {
      emergencyRefresh = null;
    });
  return emergencyRefresh;
}

export function getMobileEmergencyState(): {
  support: 'active' | 'disabled' | 'unsupported';
  state: EmergencyHostState | null;
} {
  if (!platform) return { support: 'unsupported', state: null };
  if (!emergencyEnabled) return { support: 'disabled', state: null };
  return {
    support: 'active',
    state: emergencyHostState(mobileConfiguration?.getState().emergency ?? null, appVersion),
  };
}

function getRuntimeLocale(): string {
  if (typeof Intl === 'undefined') return defaultLocale;
  return resolveLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
}

function configuredNetwork(baseUrl: string | null): ConfigNetwork {
  return baseUrl ? createConfigNetwork(baseUrl, expoFetch) : unavailableNetwork;
}
