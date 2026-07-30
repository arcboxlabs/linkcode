import type { Plugin, PluginProvider, StandaloneSkill } from '@linkcode/schema';

export interface PluginDiscoveryOptions {
  /** Project root used by providers that expose repository-scoped marketplaces. */
  cwd?: string;
}

/** Provider boundary for discovering native plugin catalogs and standalone skills. */
export interface PluginProviderAdapter {
  readonly provider: PluginProvider;
  list(opts?: PluginDiscoveryOptions): Promise<Plugin[]>;
  /** Skills living outside any plugin package (e.g. `~/.claude/skills/*`). Plugin-bundled
   * skills stay on `Plugin.components` and never appear here. */
  listStandaloneSkills(opts?: PluginDiscoveryOptions): Promise<StandaloneSkill[]>;
}

export type PluginProviderAdapterFactory = (provider: PluginProvider) => PluginProviderAdapter;
