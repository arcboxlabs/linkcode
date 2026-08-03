import type { ConfigChannel, ConfigDefinitions } from '@linkcode/common/config';

interface BundledConfigBootstrap {
  readonly brandId: string;
  readonly channel: ConfigChannel;
  readonly emergencyKeyring: Readonly<Record<string, string>>;
  readonly maximumSchemaVersion: number;
  readonly normalKeyring: Readonly<Record<string, string>>;
  readonly remoteBaseUrl: string | null;
}

export const BUNDLED_CONFIG_DEFINITIONS = {} satisfies ConfigDefinitions;
export const BUNDLED_CONFIG_BOOTSTRAP: BundledConfigBootstrap = {
  brandId: 'linkcode',
  channel: 'stable',
  emergencyKeyring: {},
  maximumSchemaVersion: 1,
  normalKeyring: {},
  remoteBaseUrl: null,
};
