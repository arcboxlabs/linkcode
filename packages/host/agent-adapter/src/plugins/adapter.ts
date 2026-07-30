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
  /** Per-skill enable/disable through the provider's own mechanism (claude: `skillOverrides` in
   * settings.json; codex: `skills/config/write`). Both are blind writes — the caller re-reads to
   * confirm. Left undefined by providers without one; `StandaloneSkill.toggleable` must agree. */
  setSkillEnabled?(
    skill: SkillToggleTarget,
    enabled: boolean,
    opts?: PluginDiscoveryOptions,
  ): Promise<void>;
}

/** Both keys travel: claude addresses a skill by name, codex by SKILL.md path. */
export interface SkillToggleTarget {
  id: string;
  path: string;
  scope: StandaloneSkill['scope'];
}

export type PluginProviderAdapterFactory = (provider: PluginProvider) => PluginProviderAdapter;
