import type { ConfigNetwork } from '@linkcode/common/config';
import { ConfigCore, ConfigCoreError, createNobleConfigCrypto } from '@linkcode/common/config';
import { defaultLocale, resolveLocale } from '@linkcode/i18n';
import { fetch as expoFetch } from 'expo/fetch';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';
import { createConfigNetwork, createConfigStorage, resolveMobileConfigPlatform } from './adapters';
import { BUNDLED_CONFIG_BOOTSTRAP, BUNDLED_CONFIG_DEFINITIONS } from './bundled';

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
const emergencyEnabled = BUNDLED_CONFIG_BOOTSTRAP.emergencyRemoteBaseUrl !== null;
const remoteEnabled = normalEnabled || emergencyEnabled;
const unavailableNetwork: ConfigNetwork = {
  get: () =>
    Promise.reject(new ConfigCoreError('fetch', 'Bundled configuration has no remote endpoint')),
};

export const mobileConfiguration = platform
  ? new ConfigCore({
      context: {
        appVersion: Constants.expoConfig?.version ?? '0.0.0',
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
    emergencyEnabled ? mobileConfiguration.refreshEmergency() : undefined,
  ]);
  return normal?.status !== 'error' && emergency?.status !== 'error';
}

function getRuntimeLocale(): string {
  if (typeof Intl === 'undefined') return defaultLocale;
  return resolveLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
}

function configuredNetwork(baseUrl: string | null): ConfigNetwork {
  return baseUrl ? createConfigNetwork(baseUrl, expoFetch) : unavailableNetwork;
}
