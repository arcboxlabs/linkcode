import type { Plugin, PluginProvider, PluginScope, StandaloneSkill } from '@linkcode/schema';

export interface PluginDiscoveryOptions {
  /** Project root used by providers that expose repository-scoped marketplaces. */
  cwd?: string;
}

export interface PluginToggleOptions extends PluginDiscoveryOptions {
  /** The install record being toggled. Passed to the provider explicitly whenever the provider
   * supports it — auto-detection is never relied on for multi-scope installs. */
  scope?: PluginScope;
}

/** Provider boundary for discovering native plugin catalogs and standalone skills. */
export interface PluginProviderAdapter {
  readonly provider: PluginProvider;
  list(opts?: PluginDiscoveryOptions): Promise<Plugin[]>;
  /** Skills living outside any plugin package (e.g. `~/.claude/skills/*`). Plugin-bundled
   * skills stay on `Plugin.components` and never appear here. */
  listStandaloneSkills(opts?: PluginDiscoveryOptions): Promise<StandaloneSkill[]>;
  /** Plugin-level enable/disable. Left undefined by providers with no native toggle (codex) —
   * callers gate on presence, and the reported `managementCapabilities` must agree. */
  setPluginEnabled?(id: string, enabled: boolean, opts?: PluginToggleOptions): Promise<void>;
}

export type PluginProviderAdapterFactory = (provider: PluginProvider) => PluginProviderAdapter;
