import type { PluginList } from '@linkcode/client-core';
import type {
  Plugin,
  PluginAvailability,
  PluginComponentKind,
  PluginProvider,
  PluginScope,
  StandaloneSkill,
  StandaloneSkillScope,
} from '@linkcode/schema';

/** Pure projections from the discovery result to presentation view-models. No React, no I/O. */

export interface PluginInstallationRow {
  scope: PluginScope | undefined;
  enabled: boolean;
  version: string | undefined;
  /** Per-plugin management capability; the switch renders only when true. */
  canToggle: boolean;
}

export interface PluginCardView {
  /** `${provider}:${id}` — stable across re-sorts and refreshes. */
  key: string;
  provider: PluginProvider;
  id: string;
  title: string;
  description: string | undefined;
  version: string | undefined;
  marketplaceLabel: string | undefined;
  availability: PluginAvailability;
  installed: boolean;
  installations: PluginInstallationRow[];
  componentCounts: Partial<Record<PluginComponentKind, number>>;
  /** Precomputed lowercase haystack for the client-side filter. */
  searchText: string;
}

export interface PluginProviderGroup {
  provider: PluginProvider;
  /** Discovery for this provider failed (CLI missing/broken) — not the same as zero plugins. */
  discoveryFailed: boolean;
  failureReason: string | undefined;
  plugins: PluginCardView[];
}

export interface SkillRowView {
  key: string;
  provider: PluginProvider;
  /** Present for plugin-bundled skills; undefined for standalone ones. */
  pluginKey: string | undefined;
  pluginTitle: string | undefined;
  name: string;
  description: string | undefined;
  enabled: boolean;
  /** Toggling acts on the whole plugin (no provider has per-skill toggling). */
  canToggle: boolean;
  /** How many skills the owning plugin bundles — >1 shows the "toggles together" note. */
  siblingSkillCount: number;
  standaloneScope: StandaloneSkillScope | undefined;
  searchText: string;
}

export interface PluginMcpServerRow {
  key: string;
  provider: PluginProvider;
  pluginTitle: string;
  serverName: string;
  enabled: boolean;
}

export function pluginCardView(plugin: Plugin): PluginCardView {
  const title = plugin.displayName ?? plugin.name;
  const componentCounts: Partial<Record<PluginComponentKind, number>> = {};
  for (const component of plugin.components) {
    componentCounts[component.kind] = (componentCounts[component.kind] ?? 0) + 1;
  }
  const canToggle = plugin.managementCapabilities.enable && plugin.managementCapabilities.disable;
  return {
    key: `${plugin.provider}:${plugin.id}`,
    provider: plugin.provider,
    id: plugin.id,
    title,
    description: plugin.description,
    version: plugin.installations.find((entry) => entry.version)?.version ?? plugin.version,
    marketplaceLabel: plugin.marketplace?.displayName ?? plugin.marketplace?.name,
    availability: plugin.availability,
    installed: plugin.installations.length > 0,
    installations: plugin.installations.map((entry) => ({
      scope: entry.scope,
      enabled: entry.enabled,
      version: entry.version,
      canToggle,
    })),
    componentCounts,
    searchText: [
      plugin.id,
      title,
      plugin.description ?? '',
      ...plugin.keywords,
      ...plugin.components.map((component) => component.name),
    ]
      .join('\n')
      .toLowerCase(),
  };
}

/** Group cards by provider in the discovery result's provider order, folding in per-provider
 * failure state so an empty group renders "discovery failed", not a bare empty state. */
export function pluginProviderGroups(list: PluginList): PluginProviderGroup[] {
  return list.providerStatus.map((status) => {
    const plugins: PluginCardView[] = [];
    for (const plugin of list.plugins) {
      if (plugin.provider === status.provider) plugins.push(pluginCardView(plugin));
    }
    return {
      provider: status.provider,
      discoveryFailed: !status.ok,
      failureReason: status.reason,
      plugins,
    };
  });
}

export function filterPluginCards(
  cards: readonly PluginCardView[],
  query: string,
): PluginCardView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...cards];
  return cards.filter((card) => card.searchText.includes(needle));
}

/** Plugin-bundled skills (installed plugins only) followed by standalone skills. */
export function skillRows(list: PluginList): SkillRowView[] {
  const rows: SkillRowView[] = [];
  for (const plugin of list.plugins) {
    if (plugin.installations.length === 0) continue;
    const card = pluginCardView(plugin);
    const skills = plugin.components.filter((component) => component.kind === 'skill');
    const pluginEnabled = plugin.installations.some((entry) => entry.enabled);
    for (const skill of skills) {
      rows.push({
        key: `${card.key}:${skill.name}`,
        provider: plugin.provider,
        pluginKey: card.key,
        pluginTitle: card.title,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled ?? pluginEnabled,
        canToggle: plugin.managementCapabilities.enable && plugin.managementCapabilities.disable,
        siblingSkillCount: skills.length,
        standaloneScope: undefined,
        searchText: `${skill.name}\n${skill.description ?? ''}\n${card.title}`.toLowerCase(),
      });
    }
  }
  for (const skill of list.standaloneSkills) {
    rows.push(standaloneSkillRow(skill));
  }
  return rows;
}

function standaloneSkillRow(skill: StandaloneSkill): SkillRowView {
  return {
    key: `${skill.provider}:standalone:${skill.scope}:${skill.id}`,
    provider: skill.provider,
    pluginKey: undefined,
    pluginTitle: undefined,
    name: skill.name,
    description: skill.description,
    enabled: true,
    canToggle: skill.toggleable,
    siblingSkillCount: 1,
    standaloneScope: skill.scope,
    searchText: `${skill.name}\n${skill.description ?? ''}`.toLowerCase(),
  };
}

/** Read-only projection of plugin-provided MCP servers for the MCP tab's lower section. */
export function pluginMcpServerRows(plugins: readonly Plugin[]): PluginMcpServerRow[] {
  const rows: PluginMcpServerRow[] = [];
  for (const plugin of plugins) {
    if (plugin.installations.length === 0) continue;
    const title = plugin.displayName ?? plugin.name;
    const pluginEnabled = plugin.installations.some((entry) => entry.enabled);
    for (const component of plugin.components) {
      if (component.kind !== 'mcp-server') continue;
      rows.push({
        key: `${plugin.provider}:${plugin.id}:${component.name}`,
        provider: plugin.provider,
        pluginTitle: title,
        serverName: component.name,
        enabled: component.enabled ?? pluginEnabled,
      });
    }
  }
  return rows;
}
