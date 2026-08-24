import type {
  ConfigChannel,
  ConfigDefinitions,
  ConfigPlatform,
  ConfigValue,
} from '@linkcode/common/config';
import {
  configBuildBundleDefaults,
  definitionsFromDefaults,
  parseConfigBuildBundle,
} from '@linkcode/common/config';
import type { AgentKind } from '@linkcode/schema';
// Metro resolves bundled.generated.<platform>.ts when scripts/render-config-bundle.mts has run;
// the committed base module must stay the { bundle: null } development sentinel.
import generatedModule from './bundled.generated';

export interface BundledConfigBootstrap {
  /** Build-time agent allowlist (CODE-618); `null` means unrestricted. */
  readonly allowedAgents: readonly AgentKind[] | null;
  /** Build-time service allowlist (CODE-618); `null` means unrestricted. */
  readonly allowedServices: readonly string[] | null;
  readonly brandId: string;
  readonly channel: ConfigChannel;
  readonly emergencyKeyring: Readonly<Record<string, string>>;
  readonly emergencyRemoteBaseUrl: string | null;
  readonly maximumSchemaVersion: number;
  readonly normalKeyring: Readonly<Record<string, string>>;
  /** Target platform of the embedded bundle; null only for the development sentinel. */
  readonly platform: Extract<ConfigPlatform, 'android' | 'ios'> | null;
  readonly remoteBaseUrl: string | null;
  readonly telemetryEndpoint: string | null;
}

export interface BundledConfig {
  readonly bootstrap: BundledConfigBootstrap;
  readonly defaults: Readonly<Record<string, ConfigValue>>;
  readonly definitions: ConfigDefinitions;
}

const DEV_FALLBACK: BundledConfig = {
  bootstrap: {
    allowedAgents: null,
    allowedServices: null,
    brandId: 'linkcode',
    channel: 'stable',
    emergencyKeyring: {},
    emergencyRemoteBaseUrl: null,
    maximumSchemaVersion: 1,
    normalKeyring: {},
    platform: null,
    remoteBaseUrl: null,
    telemetryEndpoint: null,
  },
  defaults: {},
  definitions: {},
};

/** A generated module either holds the development sentinel (bundle: null) or an exact publisher
 * build bundle for this platform; anything else fails closed instead of falling back. */
export function bundledConfigFromModule(module: unknown): BundledConfig {
  if (typeof module !== 'object' || module === null || !('bundle' in module)) {
    throw new TypeError('Generated config module must carry a bundle field');
  }
  const raw: unknown = (module as { readonly bundle: unknown }).bundle;
  if (raw === null) return DEV_FALLBACK;
  const bundle = parseConfigBuildBundle(raw);
  if (bundle.platform !== 'ios' && bundle.platform !== 'android') {
    throw new TypeError(`Bundled configuration targets ${bundle.platform}, not a mobile platform`);
  }
  const defaults = configBuildBundleDefaults(bundle);
  return {
    bootstrap: {
      allowedAgents: bundle.agents ?? null,
      allowedServices: bundle.services ?? null,
      brandId: bundle.brandId,
      channel: bundle.channel,
      emergencyKeyring: bundle.keyrings.emergency,
      emergencyRemoteBaseUrl: bundle.endpoints.emergency,
      maximumSchemaVersion: bundle.maximumSchemaVersion,
      normalKeyring: bundle.keyrings.normal,
      platform: bundle.platform,
      remoteBaseUrl: bundle.endpoints.normal,
      telemetryEndpoint: bundle.endpoints.telemetry,
    },
    defaults,
    definitions: definitionsFromDefaults(defaults),
  };
}

export const { bootstrap: BUNDLED_CONFIG_BOOTSTRAP, definitions: BUNDLED_CONFIG_DEFINITIONS } =
  bundledConfigFromModule(generatedModule);
