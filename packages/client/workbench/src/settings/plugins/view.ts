import type { PluginList } from '@linkcode/client-core';
import type { Plugin, PluginComponentKind, StandaloneSkill } from '@linkcode/schema';
import type {
  PluginCardView,
  PluginMcpServerRow,
  PluginProviderGroup,
  SkillRowView,
} from '@linkcode/ui';

/** Pure projections from the discovery result to presentation view-models. No React, no I/O. */

export type { PluginCardView, PluginMcpServerRow, PluginProviderGroup, SkillRowView };

export function pluginCardView(plugin: Plugin): PluginCardView {
  const title = plugin.displayName ?? plugin.name;
  const componentCounts: Partial<Record<PluginComponentKind, number>> = {};
  for (const component of plugin.components) {
    componentCounts[component.kind] = (componentCounts[component.kind] ?? 0) + 1;
  }
  const available = plugin.availability === 'available';
  const canToggle =
    available && plugin.managementCapabilities.enable && plugin.managementCapabilities.disable;
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
    canInstall: available && plugin.managementCapabilities.install,
    canUninstall: plugin.managementCapabilities.uninstall,
    installations: plugin.installations.map((entry) => ({
      scope: entry.scope,
      enabled: entry.enabled,
      version: entry.version,
      canToggle: canToggle && (entry.scope === undefined || entry.scope === 'user'),
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

/**
 * Group cards by provider in the discovery result's provider order, folding in per-provider
 * failure state so an empty group renders "discovery failed", not a bare empty state.
 *
 * `installed` partitions the catalog: the Plugins tab shows what this host actually has, the
 * Market tab shows the rest (on a real machine that is hundreds of marketplace listings).
 */
export function pluginProviderGroups(
  list: PluginList,
  opts: { installed: boolean },
): PluginProviderGroup[] {
  return list.providerStatus.map((status) => {
    const plugins: PluginCardView[] = [];
    for (const plugin of list.plugins) {
      if (plugin.provider !== status.provider) continue;
      if (plugin.installations.length > 0 !== opts.installed) continue;
      plugins.push(pluginCardView(plugin));
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
    const pluginEnabled =
      plugin.installations.length === 1
        ? plugin.installations[0].enabled
        : plugin.installations.some((entry) => entry.enabled);
    for (const skill of skills) {
      rows.push({
        key: `${card.key}:${skill.name}`,
        provider: plugin.provider,
        skillId: skill.name,
        path: '',
        pluginKey: card.key,
        pluginTitle: card.title,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled ?? pluginEnabled,
        canToggle: false,
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
    key: `${skill.provider}:standalone:${skill.path}`,
    provider: skill.provider,
    skillId: skill.id,
    path: skill.path,
    pluginKey: undefined,
    pluginTitle: undefined,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    canToggle: skill.toggleable,
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
