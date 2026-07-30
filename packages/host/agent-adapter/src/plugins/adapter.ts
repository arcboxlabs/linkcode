import type { Plugin, PluginProvider } from '@linkcode/schema';

export interface PluginDiscoveryOptions {
  /** Project root used by providers that expose repository-scoped marketplaces. */
  cwd?: string;
}

/** Read-only provider boundary for discovering native plugin catalogs. */
export interface PluginProviderAdapter {
  readonly provider: PluginProvider;
  list(opts?: PluginDiscoveryOptions): Promise<Plugin[]>;
}

export type PluginProviderAdapterFactory = (provider: PluginProvider) => PluginProviderAdapter;
