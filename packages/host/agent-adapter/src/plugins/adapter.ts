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
  /** Strict preflight for providers whose native plugin and custom MCP namespaces overlap.
   * Rejects rather than returning an incomplete set when installed plugin detail cannot be read. */
  listEnabledMcpServerNames?(opts?: PluginDiscoveryOptions): Promise<string[]>;
  /** Skills living outside any plugin package (e.g. `~/.claude/skills/*`). Plugin-bundled
   * skills stay on `Plugin.components` and never appear here. */
  listStandaloneSkills(opts?: PluginDiscoveryOptions): Promise<StandaloneSkill[]>;
  /** Plugin-level enable/disable. Left undefined by providers with no native toggle —
   * callers gate on presence, and the reported `managementCapabilities` must agree. */
  setPluginEnabled?(id: string, enabled: boolean, opts?: PluginToggleOptions): Promise<void>;
  /** Install a catalog entry the host does not have yet. */
  installPlugin?(id: string, opts?: PluginDiscoveryOptions): Promise<PluginInstallOutcome>;
  /** Remove an installed plugin's local state. The entry itself survives in the provider's
   * marketplace catalog, so the caller re-lists to observe `installations: []`. */
  uninstallPlugin?(id: string, opts?: PluginDiscoveryOptions): Promise<void>;
  /** Per-skill enable/disable through the provider's own mechanism (claude: `skillOverrides` in
   * settings.json; codex: `skills/config/write`). Both are blind writes — the caller re-reads to
   * confirm. Left undefined by providers without one; `StandaloneSkill.toggleable` must agree. */
  setSkillEnabled?(
    skill: SkillToggleTarget,
    enabled: boolean,
    opts?: PluginDiscoveryOptions,
  ): Promise<void>;
}

export interface PluginInstallOutcome {
  /** Provider apps the install left unauthorized (codex reports these for every `ON_INSTALL`
   * plugin, which is most of its catalog). LinkCode runs no OAuth flow, so these names must reach
   * the user rather than be dropped into a "done" that is not. */
  pendingAuthApps: string[];
}

/** Both keys travel: claude addresses a skill by name, codex by SKILL.md path. */
export interface SkillToggleTarget {
  id: string;
  path: string;
  scope: StandaloneSkill['scope'];
}

export type PluginProviderAdapterFactory = (provider: PluginProvider) => PluginProviderAdapter;
